import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

const MONITORING_CACHE_TTL_MS = 2 * 60 * 1000;
const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface MonitoringServiceAccountCreds {
  clientEmail: string;
  privateKey: string;
  projectId: string;
  dedicatedReadOnly: boolean;
}

type TelemetryPeriodMode = 'day' | 'month' | 'year';

interface BrowserTelemetryRecord {
  browserId: string;
  browserLabel: string;
  ptDate: string;
  reads: number;
  readUnits: number;
  writes: number;
  deletes: number;
  writeUnits: number;
  savedInTestMode: number;
  quotaHit: boolean;
  updatedAt: number;
  activeDays?: number;
}

interface FirestoreCloudQuotaPayload {
  ok: boolean;
  configured: boolean;
  source: 'cloud_monitoring' | 'multi_browser_sync';
  freeSparkFallbackReason?: 'missing_service_account' | 'billing_required';
  periodMode?: TelemetryPeriodMode;
  periodValue?: string;
  activeDays?: number;
  ptDate?: string;
  windowStartIso?: string;
  windowEndIso?: string;
  resetIso?: string;
  projectId: string;
  databaseId: string;
  usedDedicatedReadOnlyVar?: boolean;
  fetchedAt: number;
  cached?: boolean;
  limits?: {
    readUnits: number;
    writeUnits: number;
    deletes: number;
  };
  metrics?: {
    billableReadUnits: number;
    billableRealtimeReadUnits: number;
    totalReadUnits: number;
    billableWriteUnits: number;
    totalWriteUnits: number;
    readOpsCount: number;
    writeOpsCount: number;
    deleteOpsCount: number;
  };
  browsers?: BrowserTelemetryRecord[];
  dailyRecords?: BrowserTelemetryRecord[];
  hasEnterpriseBillingMetrics?: boolean;
  diagnostics?: {
    totalSeriesCount: number;
    failedQueriesCount: number;
    firstError?: string;
    detectedResourceTypes?: string[];
    detectedDatabaseIds?: string[];
    matchedMetrics?: string[];
    availableFirestoreMetricsSample?: string[];
  };
  reason?: string;
  errorCode?: string;
  message?: string;
}

const TELEMETRY_TMP_PATH = '/tmp/myhome-firestore-telemetry-v1.json';
const BILLING_REQUIRED_COOLDOWN_MS = 30 * 60 * 1000;
let billingRequiredCooldownUntil = 0;
let telemetryStoreLoaded = false;
const telemetryByUserAndKey = new Map<string, Map<string, BrowserTelemetryRecord>>();

function loadTelemetryStoreOnce(): void {
  if (telemetryStoreLoaded) return;
  telemetryStoreLoaded = true;
  try {
    if (!fs.existsSync(TELEMETRY_TMP_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(TELEMETRY_TMP_PATH, 'utf8')) as Record<
      string,
      Record<string, BrowserTelemetryRecord>
    >;
    if (!raw || typeof raw !== 'object') return;
    for (const [uid, mapObj] of Object.entries(raw)) {
      if (!mapObj || typeof mapObj !== 'object') continue;
      const inner = new Map<string, BrowserTelemetryRecord>();
      for (const [k, rec] of Object.entries(mapObj)) {
        if (rec && typeof rec === 'object' && typeof rec.ptDate === 'string' && typeof rec.browserId === 'string') {
          inner.set(k, rec);
        }
      }
      telemetryByUserAndKey.set(uid, inner);
    }
  } catch {
    // ignore corrupt temp cache
  }
}

function persistTelemetryStore(): void {
  try {
    const out: Record<string, Record<string, BrowserTelemetryRecord>> = {};
    for (const [uid, inner] of telemetryByUserAndKey.entries()) {
      out[uid] = Object.fromEntries(inner.entries());
    }
    fs.writeFileSync(TELEMETRY_TMP_PATH, JSON.stringify(out), 'utf8');
  } catch {
    // ignore ephemeral disk errors
  }
}

function sanitizeTelemetryInt(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(10_000_000, Math.round(n));
}

interface TelemetryUpsertDayInput {
  ptDate: string;
  reads: unknown;
  readUnits: unknown;
  writes: unknown;
  deletes: unknown;
  writeUnits: unknown;
  savedInTestMode: unknown;
  quotaHit: unknown;
}

function upsertMultiBrowserTelemetry(
  uid: string,
  input: TelemetryUpsertDayInput & {
    browserId: string;
    browserLabel: string;
    extraEntries?: TelemetryUpsertDayInput[];
  }
): BrowserTelemetryRecord[] {
  loadTelemetryStoreOnce();
  let inner = telemetryByUserAndKey.get(uid);
  if (!inner) {
    inner = new Map<string, BrowserTelemetryRecord>();
    telemetryByUserAndKey.set(uid, inner);
  }

  // Prune entries older than 730 days (2 years)
  const cutoffMs = Date.now() - 730 * 24 * 60 * 60 * 1000;
  for (const [k, rec] of inner.entries()) {
    if (rec.updatedAt < cutoffMs) {
      inner.delete(k);
    }
  }

  const now = Date.now();
  const batch: TelemetryUpsertDayInput[] = [input];
  if (Array.isArray(input.extraEntries)) {
    for (const extra of input.extraEntries.slice(0, 730)) {
      if (extra && typeof extra.ptDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extra.ptDate)) {
        batch.push(extra);
      }
    }
  }

  for (const item of batch) {
    const key = `${item.ptDate}:${input.browserId}`;
    const prev = inner.get(key);
    const next: BrowserTelemetryRecord = {
      browserId: input.browserId,
      browserLabel: input.browserLabel || prev?.browserLabel || 'Browser',
      ptDate: item.ptDate,
      reads: Math.max(prev?.reads || 0, sanitizeTelemetryInt(item.reads)),
      readUnits: Math.max(prev?.readUnits || 0, sanitizeTelemetryInt(item.readUnits)),
      writes: Math.max(prev?.writes || 0, sanitizeTelemetryInt(item.writes)),
      deletes: Math.max(prev?.deletes || 0, sanitizeTelemetryInt(item.deletes)),
      writeUnits: Math.max(prev?.writeUnits || 0, sanitizeTelemetryInt(item.writeUnits)),
      savedInTestMode: Math.max(prev?.savedInTestMode || 0, sanitizeTelemetryInt(item.savedInTestMode)),
      quotaHit: Boolean(prev?.quotaHit || item.quotaHit),
      updatedAt: item.ptDate === input.ptDate ? now : prev?.updatedAt || now,
    };
    inner.set(key, next);
  }
  persistTelemetryStore();

  return getMultiBrowserTelemetryForDate(uid, input.ptDate);
}

function getMultiBrowserTelemetryForDate(uid: string, ptDate: string): BrowserTelemetryRecord[] {
  return getMultiBrowserTelemetryForPeriod(uid, 'day', ptDate).browsers;
}

function doesServerDateMatchPeriod(
  ptDate: string,
  mode: TelemetryPeriodMode,
  value: string
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ptDate)) return false;
  if (mode === 'day') return ptDate === value;
  if (mode === 'month') return /^\d{4}-\d{2}$/.test(value) && ptDate.startsWith(`${value}-`);
  if (mode === 'year') return /^\d{4}$/.test(value) && ptDate.startsWith(`${value}-`);
  return false;
}

function getMultiBrowserTelemetryForPeriod(
  uid: string,
  mode: TelemetryPeriodMode,
  value: string
): { browsers: BrowserTelemetryRecord[]; dailyRecords: BrowserTelemetryRecord[]; activeDays: number } {
  loadTelemetryStoreOnce();
  const inner = telemetryByUserAndKey.get(uid);
  if (!inner) return { browsers: [], dailyRecords: [], activeDays: 0 };

  const dailyRecords: BrowserTelemetryRecord[] = [];
  const activeDates = new Set<string>();
  const byBrowser = new Map<string, BrowserTelemetryRecord & { dates: Set<string> }>();

  for (const rec of inner.values()) {
    if (!doesServerDateMatchPeriod(rec.ptDate, mode, value)) continue;
    dailyRecords.push(rec);
    activeDates.add(rec.ptDate);

    const existing = byBrowser.get(rec.browserId);
    if (!existing) {
      byBrowser.set(rec.browserId, {
        ...rec,
        ptDate: value,
        activeDays: 1,
        dates: new Set([rec.ptDate]),
      });
    } else {
      existing.dates.add(rec.ptDate);
      existing.browserLabel =
        rec.updatedAt >= existing.updatedAt && rec.browserLabel
          ? rec.browserLabel
          : existing.browserLabel || rec.browserLabel;
      existing.reads += rec.reads;
      existing.readUnits += rec.readUnits;
      existing.writes += rec.writes;
      existing.deletes += rec.deletes;
      existing.writeUnits += rec.writeUnits;
      existing.savedInTestMode += rec.savedInTestMode;
      existing.quotaHit = existing.quotaHit || rec.quotaHit;
      existing.updatedAt = Math.max(existing.updatedAt, rec.updatedAt);
      existing.activeDays = existing.dates.size;
    }
  }

  const browsers = [...byBrowser.values()]
    .map(({ dates: _d, ...rest }) => rest)
    .sort((a, b) => b.readUnits + b.writeUnits - (a.readUnits + a.writeUnits));

  return {
    browsers,
    dailyRecords,
    activeDays: activeDates.size,
  };
}

function buildFreeSparkQuotaPayload(
  uid: string | null,
  projectId: string,
  databaseId: string,
  reason: 'missing_service_account' | 'billing_required',
  usedDedicatedReadOnlyVar?: boolean,
  periodMode: TelemetryPeriodMode = 'day',
  periodValue?: string
): FirestoreCloudQuotaPayload {
  const now = Date.now();
  const windowRange = getPtQuotaWindowRange(now);
  const resolvedValue = periodValue || windowRange.ptDate;
  const agg = uid
    ? getMultiBrowserTelemetryForPeriod(uid, periodMode, resolvedValue)
    : { browsers: [], dailyRecords: [], activeDays: 0 };
  const browsers = agg.browsers;
  const totalReadUnits = browsers.reduce((s, b) => s + b.readUnits, 0);
  const totalWriteUnits = browsers.reduce((s, b) => s + b.writeUnits, 0);
  const readOpsCount = browsers.reduce((s, b) => s + b.reads, 0);
  const writeOpsCount = browsers.reduce((s, b) => s + b.writes, 0);
  const deleteOpsCount = browsers.reduce((s, b) => s + b.deletes, 0);

  return {
    ok: true,
    configured: true,
    source: 'multi_browser_sync',
    freeSparkFallbackReason: reason,
    periodMode,
    periodValue: resolvedValue,
    activeDays: agg.activeDays,
    ptDate: windowRange.ptDate,
    windowStartIso: windowRange.startIso,
    windowEndIso: windowRange.endIso,
    resetIso: windowRange.resetIso,
    projectId,
    databaseId,
    usedDedicatedReadOnlyVar,
    fetchedAt: now,
    cached: false,
    limits: {
      readUnits: 50_000,
      writeUnits: 20_000,
      deletes: 20_000,
    },
    metrics: {
      billableReadUnits: totalReadUnits,
      billableRealtimeReadUnits: 0,
      totalReadUnits,
      billableWriteUnits: totalWriteUnits,
      totalWriteUnits,
      readOpsCount,
      writeOpsCount,
      deleteOpsCount,
    },
    browsers,
    dailyRecords: agg.dailyRecords,
    hasEnterpriseBillingMetrics: false,
  };
}

let cachedMonitoringQuota: { expiresAt: number; payload: FirestoreCloudQuotaPayload } | null = null;
let cachedMonitoringToken: { expiresAt: number; accessToken: string } | null = null;
let cachedFirebaseCerts: { expiresAt: number; certs: Record<string, string> } | null = null;

function readAppletFirebaseConfig(): { projectId: string; databaseId: string } {
  let fileProjectId = '';
  let fileDatabaseId = '';
  try {
    const cfgPath = path.resolve(import.meta.dirname, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
        projectId?: unknown;
        firestoreDatabaseId?: unknown;
      };
      if (typeof raw.projectId === 'string') fileProjectId = raw.projectId.trim();
      if (typeof raw.firestoreDatabaseId === 'string') {
        fileDatabaseId = raw.firestoreDatabaseId.trim();
      }
    }
  } catch {
    // ignore malformed local config file
  }
  return {
    projectId: (
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCP_PROJECT_ID ||
      fileProjectId ||
      'gen-lang-client-0721850501'
    ).trim(),
    databaseId: (
      process.env.FIRESTORE_DATABASE_ID ||
      fileDatabaseId ||
      'ai-studio-30a168e3-8158-474f-b9f2-f717d7220314'
    ).trim(),
  };
}

function loadMonitoringServiceAccount(): MonitoringServiceAccountCreds | null {
  const dedicatedRaw = (process.env.GCP_MONITORING_SERVICE_ACCOUNT || '').trim();
  const fallbackRaw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const rawInput = dedicatedRaw || fallbackRaw;
  if (!rawInput) return null;

  const tryParseSaJson = (text: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  let parsed = tryParseSaJson(rawInput);
  if (!parsed) {
    try {
      const decoded = Buffer.from(rawInput, 'base64').toString('utf8');
      parsed = tryParseSaJson(decoded);
    } catch {
      parsed = null;
    }
  }
  if (!parsed) return null;

  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
  const privateKeyRaw = typeof parsed.private_key === 'string' ? parsed.private_key : '';
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n').trim();
  const projectId = typeof parsed.project_id === 'string' ? parsed.project_id.trim() : '';
  if (!clientEmail || !privateKey || !privateKey.includes('PRIVATE KEY')) {
    return null;
  }
  return {
    clientEmail,
    privateKey,
    projectId,
    dedicatedReadOnly: Boolean(dedicatedRaw),
  };
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToBuffer(b64u: string): Buffer {
  const normalized = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function isAllowedAuthenticatedOrigin(originHeader: string | undefined, req: express.Request): boolean {
  if (!originHeader) return false;
  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const origin = parsed.origin;

  const staticAllowed = new Set<string>([
    'https://mauriziominieri.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  if (staticAllowed.has(origin)) return true;

  const appUrlRaw = (process.env.APP_URL || '').trim();
  if (appUrlRaw) {
    try {
      if (new URL(appUrlRaw).origin === origin) return true;
    } catch {
      // ignore invalid APP_URL
    }
  }

  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwardedHost && parsed.host.toLowerCase() === forwardedHost) return true;

  if (/^https:\/\/ais-(?:dev|pre)-[a-z0-9-]+\.(?:[a-z0-9-]+\.)+run\.app$/i.test(origin)) {
    return true;
  }
  return false;
}

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedFirebaseCerts && cachedFirebaseCerts.expiresAt > now) {
    return cachedFirebaseCerts.certs;
  }
  const resp = await fetch(FIREBASE_CERTS_URL, {
    method: 'GET',
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching Firebase public certs`);
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cc = String(resp.headers.get('cache-control') || '');
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlSec = maxAgeMatch?.[1] ? Math.max(60, Math.min(86_400, Number(maxAgeMatch[1]))) : 3600;
  cachedFirebaseCerts = {
    certs,
    expiresAt: now + ttlSec * 1000,
  };
  return certs;
}

async function verifyFirebaseIdToken(
  authHeader: string | undefined,
  projectId: string
): Promise<{ uid: string; email: string }> {
  const rawHeader = typeof authHeader === 'string' ? authHeader.trim() : '';
  if (!rawHeader.toLowerCase().startsWith('bearer ')) {
    throw new Error('missing_bearer');
  }
  const token = rawHeader.slice(7).trim();
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new Error('invalid_jwt');
  }

  const [headerB64, payloadB64, sigB64] = segments;
  const header = JSON.parse(base64UrlDecodeToBuffer(headerB64).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(base64UrlDecodeToBuffer(payloadB64).toString('utf8')) as {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('invalid_header');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('invalid_issuer');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('invalid_sub');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('token_expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('invalid_iat');
  }

  const certs = await getFirebasePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error('unknown_kid');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const validSig = verifier.verify(certPem, base64UrlDecodeToBuffer(sigB64));
  if (!validSig) {
    throw new Error('bad_signature');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || payload.email_verified !== true) {
    throw new Error('unverified_email');
  }

  const allowedEnv = (process.env.MONITORING_ALLOWED_EMAILS || '').trim();
  const allowedEmails = new Set(
    (allowedEnv ? allowedEnv.split(',') : ['mauminieri@gmail.com', 'd0ppia3mmec@gmail.com'])
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowedEmails.has(email)) {
    throw new Error('forbidden_email');
  }

  return { uid: payload.sub, email };
}

function getPtOffsetMinutes(utcMs: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  });
  const tzPart = fmt.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value || '';
  const m = tzPart.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return -8 * 60;
  const hours = Number(m[1]);
  const mins = Number(m[2] || 0);
  return hours * 60 + (hours < 0 ? -mins : mins);
}

function getPtQuotaWindowRange(nowMs = Date.now()): {
  ptDate: string;
  startIso: string;
  endIso: string;
  resetIso: string;
} {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const y = Number(dateParts.find((p) => p.type === 'year')?.value || 2026);
  const m = Number(dateParts.find((p) => p.type === 'month')?.value || 1);
  const d = Number(dateParts.find((p) => p.type === 'day')?.value || 1);
  const ptDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const approxMidnightUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMin = getPtOffsetMinutes(approxMidnightUtc - 8 * 60 * 60 * 1000);
  let startMs = approxMidnightUtc - offsetMin * 60 * 1000;
  const refinedOffsetMin = getPtOffsetMinutes(startMs + 60_000);
  startMs = approxMidnightUtc - refinedOffsetMin * 60 * 1000;

  const nextApproxMidnightUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  const nextOffsetMin = getPtOffsetMinutes(nextApproxMidnightUtc - offsetMin * 60 * 1000 + 3 * 3600 * 1000);
  const resetMs = nextApproxMidnightUtc - nextOffsetMin * 60 * 1000;

  return {
    ptDate,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(Math.max(startMs + 60_000, nowMs)).toISOString(),
    resetIso: new Date(resetMs).toISOString(),
  };
}

async function getMonitoringAccessToken(creds: MonitoringServiceAccountCreds): Promise<string> {
  const now = Date.now();
  if (cachedMonitoringToken && cachedMonitoringToken.expiresAt > now + 60_000) {
    return cachedMonitoringToken.accessToken;
  }

  const nowSec = Math.floor(now / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: 'https://www.googleapis.com/auth/monitoring.read',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = base64UrlEncode(signer.sign(creds.privateKey));
  const assertion = `${header}.${claim}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await resp.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  } | null;
  if (!resp.ok || !json?.access_token) {
    const errMsg = json?.error_description || json?.error || `HTTP ${resp.status}`;
    throw new Error(`OAuth token error: ${errMsg}`);
  }
  const expiresInSec = Number(json.expires_in || 3600);
  cachedMonitoringToken = {
    accessToken: json.access_token,
    expiresAt: now + expiresInSec * 1000,
  };
  return json.access_token;
}

interface MetricQueryResult {
  sum: number;
  seriesCount: number;
  resourceTypes: string[];
  databaseIds: string[];
}

function doesSeriesMatchDatabase(
  labels: Record<string, string> | undefined,
  targetDatabaseId: string
): boolean {
  if (!labels) return true;
  const dbLabel =
    typeof labels.database_id === 'string'
      ? labels.database_id.trim()
      : typeof labels.database === 'string'
        ? labels.database.trim()
        : '';
  // Series from resource types without database_id (e.g. firestore_instance) are project-level
  if (!dbLabel) return true;
  if (dbLabel === targetDatabaseId) return true;
  if (dbLabel.endsWith(`/${targetDatabaseId}`)) return true;
  return false;
}

async function queryCloudMonitoringMetricSum(
  accessToken: string,
  projectId: string,
  databaseId: string,
  metricType: string,
  startIso: string,
  endIso: string
): Promise<MetricQueryResult> {
  const executeQuery = async (
    filter: string,
    useAggregation: boolean
  ): Promise<MetricQueryResult> => {
    let pageToken = '';
    let sum = 0;
    let matchedSeriesCount = 0;
    const resourceTypes = new Set<string>();
    const databaseIds = new Set<string>();
    let pages = 0;

    do {
      pages += 1;
      const params = new URLSearchParams({
        filter,
        'interval.startTime': startIso,
        'interval.endTime': endIso,
        view: 'FULL',
      });
      if (useAggregation) {
        params.set('aggregation.alignmentPeriod', '3600s');
        params.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
      }
      if (pageToken) params.set('pageToken', pageToken);

      const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(
        projectId
      )}/timeSeries?${params.toString()}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await resp.json().catch(() => null)) as {
        timeSeries?: Array<{
          resource?: { type?: string; labels?: Record<string, string> };
          points?: Array<{
            value?: { int64Value?: string; doubleValue?: number };
          }>;
        }>;
        nextPageToken?: string;
        error?: { code?: number; status?: string; message?: string };
      } | null;

      if (!resp.ok) {
        const errStatus = json?.error?.status || '';
        const errMessage = json?.error?.message || `HTTP ${resp.status}`;
        const err = new Error(errMessage) as Error & { gcpStatus?: string; httpStatus?: number };
        err.gcpStatus = errStatus;
        err.httpStatus = resp.status;
        throw err;
      }

      const series = Array.isArray(json?.timeSeries) ? json.timeSeries : [];
      for (const s of series) {
        if (s.resource?.type) resourceTypes.add(s.resource.type);
        const dbLabel =
          s.resource?.labels?.database_id || s.resource?.labels?.database || '';
        if (dbLabel) databaseIds.add(dbLabel);

        if (!doesSeriesMatchDatabase(s.resource?.labels, databaseId)) {
          continue;
        }
        matchedSeriesCount += 1;
        for (const p of s.points || []) {
          const valObj = p.value;
          if (!valObj) continue;
          const n =
            typeof valObj.doubleValue === 'number'
              ? valObj.doubleValue
              : valObj.int64Value !== undefined
                ? Number(valObj.int64Value)
                : 0;
          if (Number.isFinite(n) && n > 0) {
            sum += n;
          }
        }
      }
      pageToken = typeof json?.nextPageToken === 'string' ? json.nextPageToken : '';
    } while (pageToken && pages < 8);

    return {
      sum: Math.round(sum),
      seriesCount: matchedSeriesCount,
      resourceTypes: [...resourceTypes],
      databaseIds: [...databaseIds],
    };
  };

  const runWithAggregationFallback = async (filter: string): Promise<MetricQueryResult> => {
    try {
      return await executeQuery(filter, true);
    } catch (err) {
      const gcpErr = err as { httpStatus?: number; gcpStatus?: string };
      if (gcpErr.httpStatus === 400 || gcpErr.gcpStatus === 'INVALID_ARGUMENT') {
        return await executeQuery(filter, false);
      }
      throw err;
    }
  };

  // 1) Try database-filtered query first (fast & targeted for Firestore Database resource)
  if (databaseId) {
    try {
      const dbSpecific = await runWithAggregationFallback(
        `metric.type = "${metricType}" AND resource.labels.database_id = "${databaseId}"`
      );
      if (dbSpecific.seriesCount > 0) return dbSpecific;
    } catch (err) {
      const gcpErr = err as { httpStatus?: number; gcpStatus?: string };
      // If metric resource type does not support database_id label, fall back to metric-only filter
      if (gcpErr.httpStatus !== 400 && gcpErr.gcpStatus !== 'INVALID_ARGUMENT') {
        throw err;
      }
    }
  }

  // 2) Fallback: query project-wide by metric.type (handles firestore_instance or differing label shapes)
  return await runWithAggregationFallback(`metric.type = "${metricType}"`);
}

async function listActiveFirestoreMetricDescriptors(
  accessToken: string,
  projectId: string
): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      filter: 'metric.type = starts_with("firestore.googleapis.com/")',
      pageSize: '60',
    });
    const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(
      projectId
    )}/metricDescriptors?${params.toString()}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return [];
    const json = (await resp.json().catch(() => null)) as {
      metricDescriptors?: Array<{ type?: string }>;
    } | null;
    return (json?.metricDescriptors || [])
      .map((d) => (typeof d.type === 'string' ? d.type.replace('firestore.googleapis.com/', '') : ''))
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

async function fetchFirestoreMonitoringQuota(
  forceRefresh = false,
  uid: string | null = null
): Promise<FirestoreCloudQuotaPayload> {
  const { projectId: cfgProjectId, databaseId } = readAppletFirebaseConfig();
  const creds = loadMonitoringServiceAccount();
  if (!creds) {
    return buildFreeSparkQuotaPayload(uid, cfgProjectId, databaseId, 'missing_service_account');
  }

  const targetProjectId = cfgProjectId || creds.projectId;
  const now = Date.now();
  if (now < billingRequiredCooldownUntil) {
    return buildFreeSparkQuotaPayload(
      uid,
      targetProjectId,
      databaseId,
      'billing_required',
      creds.dedicatedReadOnly
    );
  }
  if (!forceRefresh && cachedMonitoringQuota && cachedMonitoringQuota.expiresAt > now) {
    return {
      ...cachedMonitoringQuota.payload,
      cached: true,
    };
  }

  const windowRange = getPtQuotaWindowRange(now);
  const accessToken = await getMonitoringAccessToken(creds);

  const metricSpecs = [
    { key: 'billableReadUnits', metric: 'firestore.googleapis.com/api/billable_read_units' },
    {
      key: 'billableRealtimeReadUnits',
      metric: 'firestore.googleapis.com/api/billable_realtime_read_units',
    },
    { key: 'billableWriteUnits', metric: 'firestore.googleapis.com/api/billable_write_units' },
    { key: 'readOpsCount', metric: 'firestore.googleapis.com/document/read_ops_count' },
    { key: 'writeOpsCount', metric: 'firestore.googleapis.com/document/write_ops_count' },
    { key: 'deleteOpsCount', metric: 'firestore.googleapis.com/document/delete_ops_count' },
    { key: 'readCount', metric: 'firestore.googleapis.com/document/read_count' },
    { key: 'writeCount', metric: 'firestore.googleapis.com/document/write_count' },
    { key: 'deleteCount', metric: 'firestore.googleapis.com/document/delete_count' },
  ] as const;

  const settled = await Promise.allSettled(
    metricSpecs.map((spec) =>
      queryCloudMonitoringMetricSum(
        accessToken,
        targetProjectId,
        databaseId,
        spec.metric,
        windowRange.startIso,
        windowRange.endIso
      )
    )
  );

  // Check if all queries failed
  const rejectedItems = settled
    .map((r, idx) => ({ r, spec: metricSpecs[idx] }))
    .filter((item): item is { r: PromiseRejectedResult; spec: (typeof metricSpecs)[number] } =>
      item.r.status === 'rejected'
    );

  const getErrText = (item: { r: PromiseRejectedResult }) => {
    const errObj = item.r.reason as { message?: string; gcpStatus?: string; httpStatus?: number } | null;
    return `${errObj?.gcpStatus || ''} ${errObj?.httpStatus || ''} ${errObj?.message || item.r.reason || ''}`;
  };

  const billingErr = rejectedItems.find((item) =>
    /requires billing|billing to be enabled/i.test(getErrText(item))
  );
  const permissionErr = rejectedItems.find((item) =>
    /PERMISSION_DENIED|disabled|not been used in project|SERVICE_DISABLED|403/i.test(
      getErrText(item)
    )
  );

  if (rejectedItems.length === metricSpecs.length) {
    if (billingErr) {
      billingRequiredCooldownUntil = now + BILLING_REQUIRED_COOLDOWN_MS;
      return buildFreeSparkQuotaPayload(
        uid,
        targetProjectId,
        databaseId,
        'billing_required',
        creds.dedicatedReadOnly
      );
    }

    if (permissionErr) {
      const rawMsg = getErrText(permissionErr);
      const isApiDisabled = /disabled|not been used in project|SERVICE_DISABLED/i.test(rawMsg);
      return {
        ok: false,
        configured: true,
        source: 'cloud_monitoring',
        projectId: targetProjectId,
        databaseId,
        usedDedicatedReadOnlyVar: creds.dedicatedReadOnly,
        fetchedAt: now,
        errorCode: isApiDisabled ? 'api_disabled' : 'permission_denied',
        message: isApiDisabled
          ? 'Abilita "Cloud Monitoring API" (monitoring.googleapis.com) sul progetto Google Cloud per leggere le metriche.'
          : 'Il Service Account configurato non ha il permesso roles/monitoring.viewer (Visualizzatore monitoraggio) su Google Cloud.',
      };
    }

    const firstMsg = String(rejectedItems[0]?.r.reason?.message || 'Errore query Cloud Monitoring');
    return {
      ok: false,
      configured: true,
      source: 'cloud_monitoring',
      projectId: targetProjectId,
      databaseId,
      usedDedicatedReadOnlyVar: creds.dedicatedReadOnly,
      fetchedAt: now,
      errorCode: 'monitoring_query_failed',
      message: `Errore interrogazione Cloud Monitoring: ${firstMsg.slice(0, 220)}`,
    };
  }

  const values: Record<string, MetricQueryResult> = {};
  const allResourceTypes = new Set<string>();
  const allDatabaseIds = new Set<string>();
  const matchedMetrics: string[] = [];
  let totalSeriesCount = 0;

  metricSpecs.forEach((spec, idx) => {
    const resItem = settled[idx];
    if (resItem.status === 'fulfilled') {
      values[spec.key] = resItem.value;
      totalSeriesCount += resItem.value.seriesCount;
      resItem.value.resourceTypes.forEach((rt) => allResourceTypes.add(rt));
      resItem.value.databaseIds.forEach((db) => allDatabaseIds.add(db));
      if (resItem.value.seriesCount > 0) {
        matchedMetrics.push(`${spec.key}=${resItem.value.sum}`);
      }
    } else {
      values[spec.key] = { sum: 0, seriesCount: 0, resourceTypes: [], databaseIds: [] };
    }
  });

  const billableReadUnits = values.billableReadUnits.sum;
  const billableRealtimeReadUnits = values.billableRealtimeReadUnits.sum;
  const billableWriteUnits = values.billableWriteUnits.sum;
  const readOpsCount =
    values.readOpsCount.seriesCount > 0 ? values.readOpsCount.sum : values.readCount.sum;
  const writeOpsCount =
    values.writeOpsCount.seriesCount > 0 ? values.writeOpsCount.sum : values.writeCount.sum;
  const deleteOpsCount =
    values.deleteOpsCount.seriesCount > 0 ? values.deleteOpsCount.sum : values.deleteCount.sum;

  const hasEnterpriseBillingMetrics =
    values.billableReadUnits.seriesCount > 0 ||
    values.billableRealtimeReadUnits.seriesCount > 0 ||
    values.billableWriteUnits.seriesCount > 0;

  const totalReadUnits =
    billableReadUnits + billableRealtimeReadUnits > 0
      ? billableReadUnits + billableRealtimeReadUnits
      : readOpsCount;
  const totalWriteUnits =
    billableWriteUnits > 0 ? billableWriteUnits : writeOpsCount + deleteOpsCount;

  let availableFirestoreMetricsSample: string[] | undefined;
  if (totalSeriesCount === 0) {
    availableFirestoreMetricsSample = await listActiveFirestoreMetricDescriptors(
      accessToken,
      targetProjectId
    );
  }

  const payload: FirestoreCloudQuotaPayload = {
    ok: true,
    configured: true,
    source: 'cloud_monitoring',
    ptDate: windowRange.ptDate,
    windowStartIso: windowRange.startIso,
    windowEndIso: windowRange.endIso,
    resetIso: windowRange.resetIso,
    projectId: targetProjectId,
    databaseId,
    usedDedicatedReadOnlyVar: creds.dedicatedReadOnly,
    fetchedAt: now,
    cached: false,
    limits: {
      readUnits: 50_000,
      writeUnits: 20_000,
      deletes: 20_000,
    },
    metrics: {
      billableReadUnits,
      billableRealtimeReadUnits,
      totalReadUnits,
      billableWriteUnits,
      totalWriteUnits,
      readOpsCount,
      writeOpsCount,
      deleteOpsCount,
    },
    hasEnterpriseBillingMetrics,
    diagnostics: {
      totalSeriesCount,
      failedQueriesCount: rejectedItems.length,
      ...(rejectedItems[0]
        ? {
            firstError: `${rejectedItems[0].spec.key}: ${String(
              rejectedItems[0].r.reason?.message || 'error'
            ).slice(0, 140)}`,
          }
        : {}),
      ...(allResourceTypes.size > 0 ? { detectedResourceTypes: [...allResourceTypes] } : {}),
      ...(allDatabaseIds.size > 0 ? { detectedDatabaseIds: [...allDatabaseIds] } : {}),
      ...(matchedMetrics.length > 0 ? { matchedMetrics } : {}),
      ...(availableFirestoreMetricsSample?.length
        ? { availableFirestoreMetricsSample }
        : {}),
    },
  };

  if (totalSeriesCount > 0) {
    cachedMonitoringQuota = {
      payload,
      expiresAt: now + MONITORING_CACHE_TTL_MS,
    };
  }
  return payload;
}

const isProd = process.env.NODE_ENV === 'production';

function resolveServerPort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (!isProd) {
    const devPort = Number(process.env.DEV_PORT || 3000);
    return Number.isFinite(devPort) && devPort > 0 ? devPort : 3000;
  }
  const envPort = Number(process.env.PORT || 3000);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolveServerPort();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const INSPECT_CACHE_TTL_MS = 30 * 60 * 1000;
const GEMINI_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const searchCache = new Map<string, CacheEntry<{ results: SearchResultDto[]; provider: string }>>();
const manualCache = new Map<string, CacheEntry<ManualGuideDto>>();
const inspectCache = new Map<string, CacheEntry<Record<string, unknown>>>();
let geminiBlockedUntil = 0;

interface SourceLinkDto {
  title: string;
  url: string;
}

interface SearchResultDto {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  suggestedRoom: string;
  specs: string;
  manualUrl: string;
  manualSummary: string;
  sourceUrls: SourceLinkDto[];
  providerLabel: string;
}

interface ManualGuideDto {
  manualUrl: string;
  summary: string;
  keySpecs: string[];
  quickUsage: string[];
  maintenance: string[];
  safetyAndEnergy: string[];
  sourceUrls: SourceLinkDto[];
  sourceType: 'online' | 'curated';
}

interface RawSearchItem {
  name?: string;
  brand?: string;
  model?: string;
  category?: string;
  suggestedRoom?: string;
  specs?: string;
  productUrl?: string;
  manualUrl?: string;
  manualSummary?: string;
}

const VALID_CATEGORIES = new Set([
  'elettrodomestici',
  'elettronica',
  'sicurezza',
  'fotovoltaico',
  'clima',
  'altro',
]);

function getGeminiClient(): GoogleGenAI | null {
  if (Date.now() < geminiBlockedUntil) return null;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaOrRateError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.message} ${JSON.stringify(err)}`
      : typeof err === 'string'
        ? err
        : JSON.stringify(err || '');
  return /(429|RESOURCE_EXHAUSTED|quota|rate[- ]?limit|exceeded|billing|API_KEY_INVALID)/i.test(
    msg
  );
}

function extractJsonFromText<T>(text: string): T | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const startArr = cleaned.indexOf('[');
    const endArr = cleaned.lastIndexOf(']');
    if (startArr !== -1 && endArr > startArr) {
      try {
        return JSON.parse(cleaned.slice(startArr, endArr + 1)) as T;
      } catch {
        // ignore
      }
    }
    const startObj = cleaned.indexOf('{');
    const endObj = cleaned.lastIndexOf('}');
    if (startObj !== -1 && endObj > startObj) {
      try {
        return JSON.parse(cleaned.slice(startObj, endObj + 1)) as T;
      } catch {
        // ignore
      }
    }
    return null;
  }
}

function buildManufacturerSupportUrl(brand: string, model: string): string {
  const b = brand.trim().toLowerCase();
  const cleanModel = model.trim();
  const q = encodeURIComponent(`${brand} ${cleanModel} manuale istruzioni pdf italiano`.trim());

  if (b.includes('electrolux')) {
    return `https://www.electrolux.it/support/user-manuals/?q=${encodeURIComponent(cleanModel)}`;
  }
  if (b.includes('tcl')) {
    return 'https://www.tcl.com/it/it/support';
  }
  if (b.includes('huawei')) {
    return 'https://support.huawei.com/enterprise/en/fusionsolar/sun2000l-pid-22352354';
  }
  if (b.includes('samsung')) {
    return `https://www.samsung.com/it/support/search/?keyword=${encodeURIComponent(cleanModel)}`;
  }
  if (b.includes('bosch')) {
    return 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni';
  }
  if (b.includes('lg')) {
    return 'https://www.lg.com/it/supporto/manuali/';
  }
  if (b.includes('ariston')) {
    return 'https://www.ariston.com/it-it/assistenza/';
  }
  if (b.includes('rehau')) {
    return 'https://www.rehau.com/it-it/downloads';
  }
  if (b.includes('avs')) {
    return 'https://www.avselectronics.it/';
  }
  if (b.includes('dyson')) {
    return 'https://www.dyson.it/support';
  }
  if (b.includes('apple')) {
    return 'https://support.apple.com/it-it/docs';
  }
  if (b.includes('fritz') || b.includes('avm')) {
    return 'https://it.avm.de/assistenza/manuali/';
  }
  if (b.includes('whirlpool')) {
    return `https://www.whirlpool.it/assistenza/manuali-istruzioni`;
  }
  if (b.includes('miele')) {
    return 'https://www.miele.it/c/manuali-d-uso-385.htm';
  }
  if (b.includes('daikin')) {
    return 'https://www.daikin.it/it_it/area-download.html';
  }
  if (b.includes('sony')) {
    return `https://www.sony.it/electronics/support?query=${encodeURIComponent(cleanModel)}`;
  }
  if (b.includes('philips')) {
    return `https://www.philips.it/c-w/support-home/support-search.html?q=${encodeURIComponent(cleanModel)}`;
  }
  return `https://www.google.com/search?q=${q}`;
}

function inferCategoryFromText(text: string): string {
  const t = text.toLowerCase();
  if (/(inverter|pannell|fotovolta|solare|sun2000|batteria accumulo)/.test(t)) {
    return 'fotovoltaico';
  }
  if (/(allarme|sirena|telecam|sensor|antifurto|citofon|nvr|avs)/.test(t)) {
    return 'sicurezza';
  }
  if (/(pompa di calore|condizionator|caldaia|termostat|deumidificat|ariston|rehau|neasmart|clima|daikin)/.test(t)) {
    return 'clima';
  }
  if (/(tv|televis|monitor|router|modem|laptop|macbook|pc|soundbar|console|stampante|nas|tablet|alexa)/.test(t)) {
    return 'elettronica';
  }
  if (/(forno|frigo|frigorifero|lavatrice|asciugatrice|lavastoviglie|microonde|piano cottura|induzione|cappa|aspirapolvere|dyson|caffe)/.test(t)) {
    return 'elettrodomestici';
  }
  return 'altro';
}

function inferRoomFromText(text: string, cat: string): string {
  const t = text.toLowerCase();
  if (/(forno|frigo|frigorifero|lavastoviglie|induzione|piano cottura|microonde|cappa|caffe)/.test(t)) {
    return 'Cucina';
  }
  if (/(tv|televis|soundbar|divano|camino)/.test(t)) {
    return 'Salone';
  }
  if (/(monitor|pc|macbook|laptop|scrivania|stampante)/.test(t)) {
    return 'Stanza Maurizio';
  }
  if (/(asciugacapelli|piastra|supersonic|airwrap)/.test(t)) {
    return 'Stanza Roberta';
  }
  if (/(lavatrice|asciugatrice)/.test(t)) {
    return 'Bagno 1';
  }
  if (cat === 'fotovoltaico' || cat === 'clima') {
    return 'Locale Tecnico / Esterno';
  }
  if (cat === 'sicurezza') {
    return 'Casa / Ingresso';
  }
  return 'Salone';
}

async function lookupWikipediaSummaryIt(query: string): Promise<{
  title: string;
  extract: string;
  pageUrl: string;
} | null> {
  try {
    const searchUrl = `https://it.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&srlimit=1&utf8=1&format=json`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(3500) });
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as {
      query?: { search?: { title?: string }[] };
    };
    const title = searchJson.query?.search?.[0]?.title;
    if (!title) return null;

    const sumRes = await fetch(
      `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (!sumRes.ok) return null;
    const sumJson = (await sumRes.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (!sumJson.extract) return null;
    return {
      title: sumJson.title || title,
      extract: sumJson.extract.slice(0, 320),
      pageUrl:
        sumJson.content_urls?.desktop?.page ||
        `https://it.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return null;
  }
}

function buildFallbackManualPayload(
  name: string,
  brand: string,
  model: string,
  category: string,
  wikiInfo: { title: string; extract: string; pageUrl: string } | null
): ManualGuideDto {
  const cat = VALID_CATEGORIES.has(category.toLowerCase())
    ? category.toLowerCase()
    : inferCategoryFromText(`${name} ${brand} ${model}`);
  const manualUrl = buildManufacturerSupportUrl(brand, model);
  const pdfSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${brand} ${model} manuale istruzioni pdf italiano`.trim()
  )}`;

  const categoryUsage: Record<string, string[]> = {
    elettrodomestici: [
      'Usa programmi Eco o a pieno carico per ottimizzare acqua ed energia elettrica.',
      'In presenza di impianto fotovoltaico, avvia i cicli principali tra le 10:30 e le 16:00.',
      'Annota il codice seriale/PNC dalla targhetta interna per assistenza o ricambi rapidi.',
    ],
    elettronica: [
      'Mantieni aggiornato il firmware/software dal menu Impostazioni del dispositivo.',
      'Collega eventuali alimentatori sensibili a ciabatta filtrata contro sbalzi di tensione.',
    ],
    sicurezza: [
      'Verifica periodicamente notifiche della centrale, stato batterie e connessione primaria/backup.',
      'Conserva i codici utente/installatore in un luogo sicuro separato dall’impianto.',
    ],
    fotovoltaico: [
      'Monitora produzione e autoconsumo dall’app dedicata verificando assenza di allarmi stringa.',
      'Segui sempre la sequenza di sicurezza del costruttore prima di manovrare sezionatori AC/DC.',
    ],
    clima: [
      'Privilegia setpoint stabili e funzionamento continuo a bassa mandata per massimizzare il rendimento.',
      'Controlla che bocchette di ripresa, filtri e scarichi condensa siano sempre liberi.',
    ],
    altro: [
      'Conserva fattura d’acquisto e link diretto al manuale PDF ufficiale direttamente nella scheda.',
    ],
  };

  const categoryMaintenance: Record<string, string[]> = {
    elettrodomestici: [
      'Pulisci filtri, guarnizioni e vaschette ogni 1–2 mesi per evitare odori e cali di resa.',
      'Esegui i cicli periodici di pulizia/decalcificazione indicati dal costruttore.',
    ],
    elettronica: [
      'Spolvera regolarmente feritoie di aerazione, schermo e porte con panno in microfibra asciutto.',
    ],
    sicurezza: [
      'Controlla annualmente batteria tampone e comunicazione allarmi su rete mobile/IP.',
    ],
    fotovoltaico: [
      'Verifica annualmente la pulizia delle alette di dissipazione dell’inverter e la resa dei moduli.',
    ],
    clima: [
      'Pulisci i filtri aria ogni 1–2 mesi e controlla pressione/filtri impianto prima di ogni stagione.',
    ],
    altro: [
      'Ispezione visiva periodica di cavi, alimentatori e componenti soggetti ad usura.',
    ],
  };

  const summaryParts = [
    `Scheda tecnica e riferimenti ufficiali per ${name || `${brand} ${model}`} (${brand} · ${model}).`,
    wikiInfo ? wikiInfo.extract : '',
  ].filter(Boolean);

  const sourceUrls: SourceLinkDto[] = [
    { title: `Manuali ${brand}`, url: manualUrl },
    { title: 'Cerca PDF manuale in italiano', url: pdfSearchUrl },
    ...(wikiInfo ? [{ title: `Wikipedia: ${wikiInfo.title}`, url: wikiInfo.pageUrl }] : []),
  ];

  return {
    manualUrl,
    summary: summaryParts.join(' '),
    keySpecs: [
      `Dispositivo: ${name || `${brand} ${model}`}`,
      `Produttore: ${brand}`,
      `Codice modello: ${model}`,
      `Categoria impianto/casa: ${cat}`,
    ],
    quickUsage: categoryUsage[cat] || categoryUsage.altro,
    maintenance: categoryMaintenance[cat] || categoryMaintenance.altro,
    safetyAndEnergy: [
      'Scollega l’alimentazione elettrica prima di operazioni di pulizia interna o manutenzione.',
      'Verifica sul portale supporto del produttore eventuali aggiornamenti firmware o bollettini tecnici.',
    ],
    sourceUrls,
    sourceType: 'curated',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.use('/api', (req, res, next) => {
    const isAuthenticatedQuotaRoute =
      req.path === '/firestore/quota' ||
      req.path.startsWith('/firestore/quota/') ||
      req.path === '/firestore/telemetry' ||
      req.path.startsWith('/firestore/telemetry/');
    if (isAuthenticatedQuotaRoute) {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
      const originAllowed = !origin || isAllowedAuthenticatedOrigin(origin, req);
      if (origin && originAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
      }
      if (req.method === 'OPTIONS') {
        res.status(originAllowed ? 204 : 403).end();
        return;
      }
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Document-Filename, Content-Disposition'
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'my-home',
      timestamp: Date.now(),
      telemetrySync: true,
    });
  });

  app.post('/api/articles/search', async (req, res) => {
    const rawQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!rawQuery || rawQuery.length > 140) {
      res.status(400).json({ error: 'Query non valida.' });
      return;
    }

    const cacheKey = rawQuery.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const ai = getGeminiClient();
    if (ai) {
      try {
        const prompt = [
          `Usa Google Search per trovare prodotti reali in vendita in Italia che corrispondono a: "${rawQuery}".`,
          'Comportati come un catalogo di prodotti: restituisci da 3 a 5 modelli distinti e specifici, come una ricerca in un negozio online.',
          'Per strumenti musicali come chitarre, includi modelli reali e distinti della marca richiesta (es. serie e codice esatto), non la pagina generica della marca.',
          'Usa esclusivamente modelli e URL di prodotto supportati dalle fonti Google Search citate. Non inventare nomi, codici, prezzi o caratteristiche; ometti i prodotti senza una fonte verificabile.',
          'Restituisci SOLO un array JSON valido (massimo 5 elementi) senza testo extra, con questi campi per ciascun risultato:',
          '- name: nome prodotto in italiano con tipo e modello esatto (max 80 caratteri)',
          '- brand: marca ufficiale',
          '- model: codice o nome modello esatto, non la query dell’utente',
          '- category: uno solo tra ["elettrodomestici", "elettronica", "sicurezza", "fotovoltaico", "clima", "altro"]',
          '- suggestedRoom: stanza tipica tra ["Cucina", "Salone", "Stanza Maurizio", "Stanza Roberta", "Matrimoniale", "Bagno 1", "Bagno 2", "Locale Tecnico / Esterno", "Casa / Ingresso"]',
          '- specs: breve sintesi delle caratteristiche che compaiono nella fonte (max 210 caratteri)',
          '- productUrl: URL esatto della pagina del prodotto in una fonte Google Search citata, preferibilmente rivenditore con pagina modello specifica',
          '- manualUrl: URL del manuale/supporto ufficiale, solo se trovato; altrimenti stringa vuota',
          '- manualSummary: breve descrizione basata sulla pagina prodotto, senza istruzioni o dati non verificati',
        ].join('\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const groundingChunks =
          response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sourceUrls = groundingChunks
          .map((chunk) => ({
            title: chunk.web?.title || 'Fonte Web',
            url: chunk.web?.uri || '',
          }))
          .filter((s) => s.url.startsWith('http'))
          .slice(0, 6);

        const parsed = extractJsonFromText<RawSearchItem[]>(response.text || '');
        const normalizeUrl = (value: string) => value.replace(/\/+$/, '').toLowerCase();
        const verifiedSources = new Map(
          sourceUrls.map((source) => [normalizeUrl(source.url), source])
        );
        const results: SearchResultDto[] = Array.isArray(parsed)
          ? parsed
              .slice(0, 10)
              .flatMap((item, idx) => {
                const brand = String(item.brand || '').trim().slice(0, 60);
                const model = String(item.model || '').trim().slice(0, 80);
                const name = String(item.name || `${brand} ${model}`).trim().slice(0, 80);
                if (!brand || !model) return [];

                const rawProductUrl =
                  typeof item.productUrl === 'string' && item.productUrl.startsWith('https://')
                    ? item.productUrl.trim()
                    : '';
                const matchedSource = rawProductUrl
                  ? verifiedSources.get(normalizeUrl(rawProductUrl))
                  : undefined;

                const itemSources: SourceLinkDto[] = [];
                if (matchedSource) {
                  itemSources.push(matchedSource);
                } else if (rawProductUrl) {
                  itemSources.push({ title: `${brand} ${model}`, url: rawProductUrl });
                }
                for (const src of sourceUrls) {
                  if (itemSources.length >= 3) break;
                  if (!itemSources.some((s) => normalizeUrl(s.url) === normalizeUrl(src.url))) {
                    itemSources.push(src);
                  }
                }
                if (itemSources.length === 0) return [];

                const category = VALID_CATEGORIES.has(String(item.category || '').toLowerCase())
                  ? String(item.category).toLowerCase()
                  : inferCategoryFromText(`${name} ${brand} ${model}`);
                const manualUrl =
                  typeof item.manualUrl === 'string' && item.manualUrl.startsWith('https://')
                    ? item.manualUrl
                    : buildManufacturerSupportUrl(brand, model);

                return [{
                  id: `web_${Date.now()}_${idx}`,
                  name,
                  brand,
                  model,
                  category,
                  suggestedRoom: String(
                    item.suggestedRoom || inferRoomFromText(`${name} ${brand} ${model}`, category)
                  ).trim().slice(0, 60),
                  specs: String(item.specs || '').trim().slice(0, 240),
                  manualUrl,
                  manualSummary: String(item.manualSummary || '').trim().slice(0, 240),
                  sourceUrls: itemSources,
                  providerLabel: 'Google Search · Gemini',
                }];
              })
          : [];

        const uniqueResults = results.filter(
          (item, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.brand.toLowerCase() === item.brand.toLowerCase() &&
                candidate.model.toLowerCase() === item.model.toLowerCase()
            ) === index
        );
        if (uniqueResults.length > 0) {
          const payload = {
            results: uniqueResults.slice(0, 5),
            provider: 'Ricerca prodotti live · Google Search',
          };
          searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: payload });
          res.json(payload);
          return;
        }
      } catch (err) {
        if (isQuotaOrRateError(err)) {
          geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
      }
    }

    const emptyResult = {
      results: [],
      provider: 'Nessun prodotto verificabile trovato; prova con marca e categoria o usa Google Shopping.',
    };
    searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: emptyResult });
    res.json(emptyResult);
  });

  app.post('/api/articles/manual', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const brand = typeof req.body?.brand === 'string' ? req.body.brand.trim() : '';
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : 'altro';

    if (!brand || !model) {
      res.status(400).json({ error: 'Marca e modello obbligatori.' });
      return;
    }

    const cacheKey = `${brand.toLowerCase()}|${model.toLowerCase()}`;
    const cached = manualCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const ai = getGeminiClient();
    if (ai) {
      try {
        const prompt = [
          `Trova online la scheda tecnica e il manuale operativo ufficiale per: ${brand} ${model} (${name}).`,
          'Rispondi SOLO con un oggetto JSON valido con questi campi in italiano:',
          '- manualUrl: URL diretto o pagina ufficiale supporto/manuali del produttore',
          '- summary: riepilogo chiaro del dispositivo e funzioni principali (2-3 frasi)',
          '- keySpecs: array di 4-5 stringhe con le specifiche tecniche principali',
          '- quickUsage: array di 3-4 consigli pratici d’uso dal manuale',
          '- maintenance: array di 2-3 operazioni di pulizia/manutenzione periodica',
          '- safetyAndEnergy: array di 2-3 consigli di sicurezza e risparmio energetico',
        ].join('\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const groundingChunks =
          response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sourceUrls = groundingChunks
          .map((chunk) => ({
            title: chunk.web?.title || 'Fonte Web',
            url: chunk.web?.uri || '',
          }))
          .filter((s) => s.url.startsWith('http'))
          .slice(0, 6);

        const parsed = extractJsonFromText<{
          manualUrl?: string;
          summary?: string;
          keySpecs?: string[];
          quickUsage?: string[];
          maintenance?: string[];
          safetyAndEnergy?: string[];
        }>(response.text || '');

        if (parsed && (parsed.summary || parsed.manualUrl)) {
          const payload: ManualGuideDto = {
            manualUrl:
              parsed.manualUrl && parsed.manualUrl.startsWith('http')
                ? parsed.manualUrl
                : sourceUrls[0]?.url || buildManufacturerSupportUrl(brand, model),
            summary: parsed.summary || '',
            keySpecs: Array.isArray(parsed.keySpecs) ? parsed.keySpecs.slice(0, 6) : [],
            quickUsage: Array.isArray(parsed.quickUsage) ? parsed.quickUsage.slice(0, 5) : [],
            maintenance: Array.isArray(parsed.maintenance) ? parsed.maintenance.slice(0, 4) : [],
            safetyAndEnergy: Array.isArray(parsed.safetyAndEnergy)
              ? parsed.safetyAndEnergy.slice(0, 4)
              : [],
            sourceUrls,
            sourceType: 'online',
          };
          manualCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: payload });
          res.json(payload);
          return;
        }
      } catch (err) {
        if (isQuotaOrRateError(err)) {
          geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
      }
    }

    // Free zero-quota fallback (Wikipedia IT + official manufacturer support links)
    const wikiInfo = await lookupWikipediaSummaryIt(`${brand} ${model}`);
    const fallbackManual = buildFallbackManualPayload(name, brand, model, category, wikiInfo);
    manualCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: fallbackManual });
    res.json(fallbackManual);
  });

  function decodeHtmlEntities(input: string): string {
    return input
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&euro;/gi, '€')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#(\d+);/g, (_m, dec) => {
        const code = Number(dec);
        return Number.isFinite(code) && code > 0 && code < 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      })
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 && code < 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isPrivateOrLocalHostname(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      h.endsWith('.local') ||
      h.endsWith('.internal')
    ) {
      return true;
    }
    const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const a = Number(ipv4[1]);
      const b = Number(ipv4[2]);
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
    }
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) {
      return true;
    }
    return false;
  }

  function formatStoreFromHostname(hostname: string): string {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('amazon.')) return 'Amazon';
    if (host.includes('maisonsdumonde.')) return 'Maisons du Monde';
    if (host.includes('zarahome.')) return 'Zara Home';
    if (host.includes('westwing.')) return 'Westwing';
    if (host.includes('kavehome.')) return 'Kave Home';
    if (host.includes('sklum.')) return 'Sklum';
    if (host.includes('mondoconv')) return 'Mondo Convenienza';
    if (host.includes('laredoute.')) return 'La Redoute';
    if (host.includes('conforama.')) return 'Conforama';
    if (host.includes('casashops.')) return 'CASA';
    if (host.includes('jysk.')) return 'JYSK';
    if (host.includes('electrolux.')) return 'Electrolux';
    if (host.includes('aeg.')) return 'AEG';
    if (host.includes('dyson.')) return 'Dyson';
    if (host.includes('mediaworld.')) return 'MediaWorld';
    if (host.includes('unieuro.')) return 'Unieuro';
    if (host.includes('ikea.')) return 'IKEA';
    if (host.includes('leroymerlin.')) return 'Leroy Merlin';
    if (host.includes('euronics.')) return 'Euronics';
    if (host.includes('eprice.')) return 'ePrice';
    if (host.includes('decathlon.')) return 'Decathlon';
    if (host.includes('apple.')) return 'Apple';
    if (host.includes('samsung.')) return 'Samsung';
    if (host.includes('philips.')) return 'Philips';
    if (host.includes('bosch')) return 'Bosch';
    if (host.includes('subito.')) return 'Subito';
    if (host.includes('ebay.')) return 'eBay';
    if (host.includes('aliexpress.')) return 'AliExpress';
    if (host.includes('obi-italia') || host.startsWith('obi.')) return 'OBI';
    if (host.includes('bricoio.')) return 'Brico io';
    if (host.includes('bricocenter.')) return 'Bricocenter';
    if (host.includes('bricoman') || host.includes('tecno') || host.includes('tecnomat')) {
      return host.includes('tecnomat') ? 'Tecnomat' : host;
    }
    return host.slice(0, 60);
  }

  function inferProductBrandServer(input: {
    title?: string;
    url?: string;
    store?: string;
    brand?: string;
    specs?: string;
  }): string | undefined {
    const genericOrMarketplace = new Set([
      'amazon',
      'amazon.it',
      'amazon.com',
      'amazon renewed',
      'amazon ricondizionato',
      'ricondizionato',
      'renewed',
      'mediaworld',
      'unieuro',
      'euronics',
      'ebay',
      'aliexpress',
      'subito',
      'eprice',
      'generico',
      'generic',
      'senza marca',
      'unbranded',
      'altro',
    ]);
    const rules: [RegExp, string][] = [
      [/\b(?:apple|iphone|ipad|macbook|imac|mac\s+mini|mac\s+studio|airpods|airtag|homepod|magsafe|techwoven|finewoven)\b/i, 'Apple'],
      [/\b(?:samsung|galaxy\s+(?:s\d|a\d|m\d|z\s*fold|z\s*flip|tab|buds|watch|book)|odyssey|the\s+frame)\b/i, 'Samsung'],
      [/\b(?:dyson|airwrap|supersonic|corrale|airstrait|gen5detect|v15\s+detect|v12\s+detect)\b/i, 'Dyson'],
      [/\b(?:electrolux)\b/i, 'Electrolux'],
      [/\b(?:aeg)\b/i, 'AEG'],
      [/\b(?:philips|hue|sonicare|ambilight|lumea|senseo|oneblade)\b/i, 'Philips'],
      [/\b(?:sony|playstation|ps5|ps4|bravia|dualsense|xperia)\b/i, 'Sony'],
      [/\b(?:lg\b|oled\s+evo|qned|lg\s+gram)\b/i, 'LG'],
      [/\b(?:bosch)\b/i, 'Bosch'],
      [/\b(?:siemens)\b/i, 'Siemens'],
      [/\b(?:miele)\b/i, 'Miele'],
      [/\b(?:whirlpool)\b/i, 'Whirlpool'],
      [/\b(?:hotpoint|ariston\s+hotpoint)\b/i, 'Hotpoint'],
      [/\b(?:indesit)\b/i, 'Indesit'],
      [/\b(?:beko)\b/i, 'Beko'],
      [/\b(?:candy)\b/i, 'Candy'],
      [/\b(?:haier)\b/i, 'Haier'],
      [/\b(?:hisense)\b/i, 'Hisense'],
      [/\b(?:tcl)\b/i, 'TCL'],
      [/\b(?:smeg)\b/i, 'Smeg'],
      [/\b(?:de['’ ]?longhi|delonghi|magnifica|dinamica)\b/i, "De'Longhi"],
      [/\b(?:nespresso)\b/i, 'Nespresso'],
      [/\b(?:lavazza)\b/i, 'Lavazza'],
      [/\b(?:bialetti)\b/i, 'Bialetti'],
      [/\b(?:kitchenaid)\b/i, 'KitchenAid'],
      [/\b(?:kenwood)\b/i, 'Kenwood'],
      [/\b(?:oral[- ]?b)\b/i, 'Oral-B'],
      [/\b(?:braun)\b/i, 'Braun'],
      [/\b(?:rowenta)\b/i, 'Rowenta'],
      [/\b(?:tefal)\b/i, 'Tefal'],
      [/\b(?:moulinex)\b/i, 'Moulinex'],
      [/\b(?:ariete)\b/i, 'Ariete'],
      [/\b(?:imetec)\b/i, 'Imetec'],
      [/\b(?:ninja)\b/i, 'Ninja'],
      [/\b(?:shark)\b/i, 'Shark'],
      [/\b(?:irobot|roomba)\b/i, 'iRobot'],
      [/\b(?:roborock)\b/i, 'Roborock'],
      [/\b(?:dreame)\b/i, 'Dreame'],
      [/\b(?:ecovacs|deebot)\b/i, 'Ecovacs'],
      [/\b(?:k[aä]rcher)\b/i, 'Kärcher'],
      [/\b(?:vorwerk|folletto|bimby)\b/i, 'Vorwerk'],
      [/\b(?:xiaomi|redmi|poco|mijia)\b/i, 'Xiaomi'],
      [/\b(?:google\s+(?:pixel|nest|tv)|pixel\s+\d|chromecast)\b/i, 'Google'],
      [/\b(?:huawei|fusionsolar)\b/i, 'Huawei'],
      [/\b(?:oneplus)\b/i, 'OnePlus'],
      [/\b(?:oppo)\b/i, 'Oppo'],
      [/\b(?:motorola|moto\s+g|razr)\b/i, 'Motorola'],
      [/\b(?:nothing\s+(?:phone|ear))\b/i, 'Nothing'],
      [/\b(?:garmin|fenix|forerunner)\b/i, 'Garmin'],
      [/\b(?:fitbit)\b/i, 'Fitbit'],
      [/\b(?:bose|quietcomfort|soundlink)\b/i, 'Bose'],
      [/\b(?:jbl)\b/i, 'JBL'],
      [/\b(?:sonos)\b/i, 'Sonos'],
      [/\b(?:marshall)\b/i, 'Marshall'],
      [/\b(?:sennheiser)\b/i, 'Sennheiser'],
      [/\b(?:anker|soundcore|eufy)\b/i, 'Anker'],
      [/\b(?:belkin)\b/i, 'Belkin'],
      [/\b(?:logitech)\b/i, 'Logitech'],
      [/\b(?:spigen)\b/i, 'Spigen'],
      [/\b(?:otterbox)\b/i, 'OtterBox'],
      [/\b(?:torras)\b/i, 'TORRAS'],
      [/\b(?:hp|hewlett[- ]?packard|omen|pavilion|envy)\b/i, 'HP'],
      [/\b(?:dell|alienware|xps)\b/i, 'Dell'],
      [/\b(?:lenovo|thinkpad|ideapad|yoga)\b/i, 'Lenovo'],
      [/\b(?:asus|zenbook|vivobook|rog)\b/i, 'Asus'],
      [/\b(?:acer|predator|nitro)\b/i, 'Acer'],
      [/\b(?:msi)\b/i, 'MSI'],
      [/\b(?:nintendo|joy[- ]?con)\b/i, 'Nintendo'],
      [/\b(?:dji|mavic|osmo)\b/i, 'DJI'],
      [/\b(?:gopro)\b/i, 'GoPro'],
      [/\b(?:canon)\b/i, 'Canon'],
      [/\b(?:nikon)\b/i, 'Nikon'],
      [/\b(?:fujifilm)\b/i, 'Fujifilm'],
      [/\b(?:tp[- ]?link|tapo|deco)\b/i, 'TP-Link'],
      [/\b(?:fritz!?(?:box|repeater)|avm)\b/i, 'AVM FRITZ!'],
      [/\b(?:ariston|lydos|velis|nimbus)\b/i, 'Ariston'],
      [/\b(?:daikin)\b/i, 'Daikin'],
      [/\b(?:rehau|neasmart)\b/i, 'REHAU'],
      [/\b(?:artemide)\b/i, 'Artemide'],
      [/\b(?:flos)\b/i, 'Flos'],
      [/\b(?:foscarini)\b/i, 'Foscarini'],
      [/\b(?:kartell)\b/i, 'Kartell'],
      [/\b(?:luceplan)\b/i, 'Luceplan'],
      [/\b(?:ideal\s*lux)\b/i, 'Ideal Lux'],
      [/\b(?:eglo)\b/i, 'Eglo'],
      [/\b(?:slamp)\b/i, 'Slamp'],
      [/\b(?:ferroluce)\b/i, 'Ferroluce'],
      [/\b(?:ledvance)\b/i, 'Ledvance'],
      [/\b(?:osram)\b/i, 'Osram'],
      [/\b(?:grohe)\b/i, 'Grohe'],
      [/\b(?:hansgrohe)\b/i, 'Hansgrohe'],
      [/\b(?:geberit)\b/i, 'Geberit'],
      [/\b(?:ideal\s*standard)\b/i, 'Ideal Standard'],
      [/\b(?:bticino)\b/i, 'BTicino'],
      [/\b(?:vimar)\b/i, 'Vimar'],
      [/\b(?:gewiss)\b/i, 'Gewiss'],
      [/\b(?:makita)\b/i, 'Makita'],
      [/\b(?:dewalt)\b/i, 'DeWalt'],
      [/\b(?:milwaukee)\b/i, 'Milwaukee'],
      [/\b(?:einhell)\b/i, 'Einhell'],
      [/\b(?:ryobi)\b/i, 'Ryobi'],
      [/\b(?:black\s*\+\s*decker|black\s*and\s*decker)\b/i, 'Black+Decker'],
      [/\b(?:stanley)\b/i, 'Stanley'],
      [/\b(?:dremel)\b/i, 'Dremel'],
      [/\b(?:maisons\s*du\s*monde)\b/i, 'Maisons du Monde'],
      [/\b(?:zara\s*home)\b/i, 'Zara Home'],
      [/\b(?:westwing)\b/i, 'Westwing'],
      [/\b(?:kave\s*home)\b/i, 'Kave Home'],
      [/\b(?:sklum)\b/i, 'Sklum'],
      [/\b(?:mondo\s*convenienza)\b/i, 'Mondo Convenienza'],
      [/\b(?:nardi|nardi\s*outdoor|nardioutdoor)\b/i, 'Nardi'],
      [/\b(?:ikea)\b/i, 'IKEA'],
    ];
    const cleanExplicit = (input.brand || '')
      .trim()
      .replace(/^(?:visita\s+lo\s+store\s+di|marca:|brand:|produttore:)\s*/i, '')
      .replace(/\s+store$/i, '')
      .trim();
    if (cleanExplicit && !genericOrMarketplace.has(cleanExplicit.toLowerCase())) {
      for (const [pattern, canonical] of rules) {
        if (pattern.test(cleanExplicit) && cleanExplicit.length <= canonical.length + 12) {
          return canonical;
        }
      }
      return cleanExplicit.slice(0, 60);
    }

    const combinedText = `${input.title || ''} ${input.url || ''} ${input.specs || ''}`;
    if (
      /\b(?:amazon\s+basics|amazonbasics|kindle|echo\s+(?:dot|show|pop|spot|studio)|fire\s+(?:tv|hd|stick)|ring|blink|eero)\b/i.test(
        combinedText
      )
    ) {
      return 'Amazon';
    }
    for (const [pattern, canonical] of rules) {
      if (pattern.test(combinedText)) return canonical;
    }

    const monoBrands = new Set([
      'Maisons du Monde',
      'Zara Home',
      'Westwing',
      'Kave Home',
      'Sklum',
      'Mondo Convenienza',
      'Conforama',
      'CASA',
      'JYSK',
      'IKEA',
      'Electrolux',
      'AEG',
      'Dyson',
      'Apple',
      'Samsung',
      'Philips',
      'Bosch',
    ]);
    return input.store && monoBrands.has(input.store) ? input.store : undefined;
  }

  function extractDetailsFromProductUrl(
    parsedUrl: URL,
    store: string
  ): {
    title: string;
    model?: string;
    color?: string;
    specs?: string;
  } {
    const segments = parsedUrl.pathname
      .split('/')
      .map((s) => decodeURIComponent(s).trim())
      .filter(Boolean);
    const ignored = new Set([
      'dp', 'gp', 'product', 'products', 'p', 'it', 'it-it', 'fr', 'en', 'de', 'es',
      'shop', 'catalog', 'prodotto', 'prodotti', 'scheda', 'item', 'items', 'buy', 'ref',
      'support', 'supporto', 'assistenza', 'go', 'redirect', 'manuals', 'manual', 'manuali',
      'qr', 'search', 'find', 'ricerca', 'lookup', 'view', 'detail', 'details',
    ]);
    const candidates = segments.filter((seg) => {
      const lower = seg.toLowerCase();
      if (ignored.has(lower)) return false;
      if (/^b0[a-z0-9]{8}$/i.test(seg)) return false; // ASIN
      if (/^[0-9]+$/.test(seg)) return false;
      if (seg.length < 3) return false;
      return true;
    });
    const best = candidates.sort((a, b) => b.length - a.length)[0];

    const getQueryParamCI = (names: string[]): string | undefined => {
      for (const [k, v] of parsedUrl.searchParams.entries()) {
        if (names.includes(k.toLowerCase())) {
          const clean = v.trim();
          if (clean) return clean.slice(0, 60);
        }
      }
      return undefined;
    };

    const queryPnc = getQueryParamCI(['pnc', 'productnumber', 'product_number', 'productcode', 'product_code']);
    const queryModel = getQueryParamCI(['model', 'modello', 'sku', 'mpn', 'prodid', 'productid', 'product_id', 'code', 'codice', 'artnr', 'partnumber', 'part_number']);
    const queryMachineNo = getQueryParamCI(['machineno', 'machine_no', 'serial', 'serialno', 'sn', 'matricola']);
    const queryElc = getQueryParamCI(['elc']);

    if (!best && !queryPnc && !queryModel) {
      return { title: `Prodotto ${store}`.slice(0, 160) };
    }

    let slug = best ? best.replace(/\.(html?|php|aspx?)$/i, '').trim() : '';
    let extractedModel: string | undefined = queryPnc?.toUpperCase() || queryModel?.toUpperCase();

    if (slug) {
      // Extract trailing multi-segment numeric catalog IDs (e.g., Nardi _211_300) or single SKU/article number
      const multiNumMatch = slug.match(/^(.+?)[-_](\d{2,6}(?:[-_]\d{2,6})+)$/);
      if (multiNumMatch && multiNumMatch[1].length >= 4) {
        slug = multiNumMatch[1];
        if (!extractedModel) extractedModel = multiNumMatch[2];
      } else {
        const skuMatch = slug.match(/^(.+?)[-_](?:id[-_]?|p[-_]?)?(s?\d{5,10})$/i);
        if (skuMatch && skuMatch[1].length >= 4) {
          slug = skuMatch[1];
          if (!extractedModel) extractedModel = skuMatch[2].toUpperCase();
        }
      }
    }

    const rawTokens = slug
      .replace(/[-_+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    const lowercaseWords = new Set([
      'in', 'di', 'a', 'da', 'con', 'per', 'su', 'tra', 'fra', 'e', 'ed', 'o',
      'del', 'della', 'dei', 'degli', 'delle', 'al', 'alla', 'nel', 'nella',
      'sul', 'sulla', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno',
    ]);
    const unitWords = new Set([
      'cm', 'mm', 'm', 'kg', 'gr', 'g', 'ml', 'l', 'lt', 'w', 'kw', 'v', 'mah', 'gb', 'tb', 'hz',
    ]);
    const dimAbbrev: Record<string, string> = {
      alt: 'Alt.',
      larg: 'Larg.',
      prof: 'Prof.',
      diam: 'Diam.',
      lungh: 'Lungh.',
    };

    const formattedWords = rawTokens.map((tok, idx) => {
      const low = tok.toLowerCase();
      if (unitWords.has(low)) return low;
      if (dimAbbrev[low] && idx + 1 < rawTokens.length && /^\d/.test(rawTokens[idx + 1])) {
        return dimAbbrev[low];
      }
      if (idx > 0 && lowercaseWords.has(low)) return low;
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    });

    const fallbackTitle = queryPnc
      ? `Prodotto ${store} PNC ${queryPnc.toUpperCase()}`
      : extractedModel
        ? `Prodotto ${store} ${extractedModel}`
        : `Prodotto ${store}`;
    const title = (formattedWords.join(' ') || fallbackTitle).slice(0, 160);

    // Extract useful specs & explicit color from slug/query
    const slugLower = slug.toLowerCase();
    const specsLines: string[] = [];
    if (queryPnc) {
      specsLines.push(`Codice PNC: ${queryPnc.toUpperCase()}`);
    } else if (extractedModel) {
      specsLines.push(`Codice articolo: ${extractedModel}`);
    }
    if (queryMachineNo) {
      specsLines.push(`Matricola / Machine No.: ${queryMachineNo}`);
    }
    if (queryElc) {
      specsLines.push(`ELC: ${queryElc.toUpperCase()}`);
    }

    const materialMatch = slugLower.match(
      /\bin-(cemento|legno-massello|legno|metallo|ceramica|porcellana|vetro|ottone|marmo|ferro|acciaio|lino|velluto|cotone|resina|terracotta|rattan|bambu|bambù|pelle|similpelle|juta|poliestere|plastica)\b/
    );
    if (materialMatch?.[1]) {
      const mat = materialMatch[1].replace(/-/g, ' ');
      specsLines.push(`Materiale: ${mat.charAt(0).toUpperCase() + mat.slice(1)}`);
    }

    const heightMatch = slugLower.match(/(?:^|-)alt-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (heightMatch) specsLines.push(`Altezza: ${heightMatch[1]} ${heightMatch[2]}`);

    const widthMatch = slugLower.match(/(?:^|-)larg-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (widthMatch) specsLines.push(`Larghezza: ${widthMatch[1]} ${widthMatch[2]}`);

    const depthMatch = slugLower.match(/(?:^|-)prof-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (depthMatch) specsLines.push(`Profondità: ${depthMatch[1]} ${depthMatch[2]}`);

    const diamMatch = slugLower.match(/(?:^|-)diam-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (diamMatch) specsLines.push(`Diametro: ${diamMatch[1]} ${diamMatch[2]}`);

    const dimMxMatch = slugLower.match(
      /(?:^|-)(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)(?:x(\d+(?:[.,]\d+)?))?(?:-(cm|mm))?\b/
    );
    if (dimMxMatch) {
      const dims = [dimMxMatch[1], dimMxMatch[2], dimMxMatch[3]].filter(Boolean).join(' × ');
      specsLines.push(`Dimensioni: ${dims}${dimMxMatch[4] ? ` ${dimMxMatch[4]}` : ''}`);
    }

    const colorMap: Record<string, string> = {
      bianco: 'Bianco',
      bianca: 'Bianco',
      nero: 'Nero',
      nera: 'Nero',
      grigio: 'Grigio',
      grigia: 'Grigio',
      beige: 'Beige',
      avorio: 'Avorio',
      ecru: 'Écru',
      oro: 'Oro',
      dorato: 'Dorato',
      argento: 'Argento',
      bronzo: 'Bronzo',
      rame: 'Rame',
      rosso: 'Rosso',
      rossa: 'Rosso',
      blu: 'Blu',
      azzurro: 'Azzurro',
      verde: 'Verde',
      salvia: 'Verde salvia',
      rosa: 'Rosa',
      giallo: 'Giallo',
      marrone: 'Marrone',
      tortora: 'Tortora',
      antracite: 'Antracite',
      borgogna: 'Borgogna',
      bordeaux: 'Bordeaux',
    };
    let extractedColor: string | undefined;
    for (const tok of rawTokens) {
      const hit = colorMap[tok.toLowerCase()];
      if (hit) {
        extractedColor = hit;
        break;
      }
    }

    return {
      title,
      model: extractedModel,
      color: extractedColor,
      specs: specsLines.length > 0 ? truncateAtWordBoundary(specsLines.join('\n'), 1850) : undefined,
    };
  }

  function inferResearchCategory(text: string): string {
    const t = text.toLowerCase();
    if (/(forno|frigo|frigorifero|lavatrice|asciugatrice|lavastoviglie|microonde|induzione|cappa|aspirapolvere|dyson|caffe|folletto|bimby|electrolux|\baeg\b|whirlpool|miele|hotpoint|indesit|beko|smeg|candy|haier|\bpnc\b)/.test(t)) {
      return 'elettrodomestici';
    }
    if (/(tv|televis|monitor|laptop|macbook|pc|ipad|tablet|iphone|smartphone|cellulare|sbloccato|ricondizionato|cuffie|airpods|router|modem|ssd|mouse|tastiera|soundbar|console|ps5|custodia|magsafe|5g|apple)/.test(t)) {
      return 'elettronica';
    }
    if (/(divano|tavolo|sedia|armadio|lampada|materasso|tappeto|cucina|arredo|arredamento|mobili|scrivania|scaffale|specchio|statuetta|busto|scultura|soprammobile|vaso|cornice|quadro|candela|portacandele|cuscino|plaid|tenda|poltrona|pouf|libreria|comodino|credenza|cassettiera|mensola|cemento|ceramica|maisonsdumonde|zarahome|westwing|kavehome|sklum|mondoconv|laredoute|conforama|nardioutdoor)/.test(t)) {
      return 'casa_arredo';
    }
    if (/(trapano|avvitatore|sega|vernice|silicone|martello|makita|dewalt|utensil|scala|giardino|tagliaerba|idropulitrice)/.test(t)) {
      return 'fai_da_te';
    }
    if (/(auto|gomme|pneumatici|tergicristall|olio motore|catene|portabici|caricabatterie auto|panda|fiat)/.test(t)) {
      return 'auto';
    }
    if (/(scarpe|giacca|maglia|pantaloni|zaino|borsa|felpa|t-shirt|vestito)/.test(t)) {
      return 'abbigliamento';
    }
    return 'altro';
  }

  type ResearchRoomIdServer =
    | 'salone'
    | 'cucina'
    | 'bagno1'
    | 'bagno2'
    | 'stanza_maurizio'
    | 'stanza_roberta'
    | 'stanza_matrimoniale'
    | 'terrazza_ovest'
    | 'terrazza_est';

  const RESEARCH_ROOM_ALIASES_SERVER: Record<string, ResearchRoomIdServer> = {
    salone: 'salone',
    soggiorno: 'salone',
    cucina: 'cucina',
    bagno1: 'bagno1',
    'bagno 1': 'bagno1',
    bagno2: 'bagno2',
    'bagno 2': 'bagno2',
    stanza_maurizio: 'stanza_maurizio',
    'stanza maurizio': 'stanza_maurizio',
    maurizio: 'stanza_maurizio',
    stanza_roberta: 'stanza_roberta',
    'stanza roberta': 'stanza_roberta',
    roberta: 'stanza_roberta',
    stanza_matrimoniale: 'stanza_matrimoniale',
    'stanza matrimoniale': 'stanza_matrimoniale',
    matrimoniale: 'stanza_matrimoniale',
    terrazza_ovest: 'terrazza_ovest',
    'terrazza ovest': 'terrazza_ovest',
    'terrazzo ovest': 'terrazza_ovest',
    terrazza_est: 'terrazza_est',
    'terrazza est': 'terrazza_est',
    'terrazzo est': 'terrazza_est',
  };

  function normalizeResearchRoomServer(raw?: string | null): ResearchRoomIdServer | undefined {
    if (!raw) return undefined;
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key || key === 'nessuna' || key === 'nessuna stanza' || key === 'none' || key === 'null') {
      return undefined;
    }
    return RESEARCH_ROOM_ALIASES_SERVER[key];
  }

  const NON_ROOM_PRODUCT_RE_SERVER =
    /\b(?:iphone|smartphone|cellulare|telefono\s+cellulare|galaxy\s+(?:s\d|a\d|m\d|z\s*fold|z\s*flip|tab|buds|watch)|pixel\s*\d|xiaomi\s+(?:\d|redmi|poco)|redmi\s+\d|oneplus\s+\d|ipad|tablet|kindle|kobo|smartwatch|apple\s+watch|garmin|fitbit|airpods|auricolari|cuffie(?:\s+bluetooth|\s+wireless|\s+in-ear|\s+over-ear)?|power\s*bank|cover|custodia|pellicola|vetro\s+temperato|caricabatterie\s+portatile|magsafe|airtag|macbook|notebook|laptop|pc\s+portatile|chromebook|ultrabook|pneumatici|gomme\s+auto|catene\s+da\s+neve|portabici|seggiolino\s+auto|autoradio|dash\s*cam|scarpe|sneakers|stivali|sandali|giacca|giubbotto|cappotto|pantaloni|jeans|maglia|maglietta|t-shirt|felpa|camicia|vestito|gonna|zaino|valigia|trolley|borsa|portafoglio|occhiali\s+da\s+sole|bicicletta|monopattino|tosaerba|tagliaerba|decespugliatore|motosega|barbecue|ombrellone|sdraio)\b/i;

  const OUTDOOR_GUARD_RE_SERVER = /\b(?:da\s+)?(?:giardino|esterno|esterni|terrazzo|balcone)\b|outdoor/i;
  const BOOK_GUARD_RE_SERVER = /\b(?:libro|libri|ricettario|ebook|audiolibro|rivista)\b/i;

  const BATHROOM_ROOM_RE_SERVER =
    /\b(?:lavatrice|lavatrici|lavasciuga|asciugatrice|asciugatrici|washing\s+machine|tumble\s+dryer|colonna\s+bucato|cesta\s+(?:per\s+)?biancheria|portabiancheria|cesto\s+biancheria|stendibiancheria\s+elettrico|asse\s+da\s+stiro|mobile\s+(?:da\s+|per\s+)?bagno|mobili\s+bagno|arredo\s+bagno|sottolavabo|colonna\s+bagno|pensile\s+bagno|specchio\s+(?:da\s+)?bagno|specchiera\s+bagno|lavabo|lavandino\s+(?:da\s+)?bagno|sanitari|vaso\s+wc|wc\s+(?:sospeso|a\s+terra|filo\s+muro)|bidet|copriwater|sedile\s+wc|box\s+doccia|cabina\s+doccia|piatto\s+doccia|colonna\s+doccia|soffione\s+doccia|doccetta|saliscendi\s+doccia|parete\s+doccia|vasca\s+da\s+bagno|rubinetto\s+(?:da\s+)?bagno|miscelatore\s+(?:bagno|lavabo|bidet|doccia|vasca)|termoarredo|scaldasalviette|portasciugamani|porta\s*rotolo|portarotolo|dispenser\s+sapone|portasapone|portaspazzolini|scopino\s+wc|scopino\s+bagno|tenda\s+doccia|tappeto\s+bagno|tappetino\s+bagno|set\s+asciugamani|asciugamani\s+bagno|accappatoio|asciugacapelli|phon\s+capelli|spazzolino\s+elettrico)\b/i;

  const KITCHEN_ROOM_RE_SERVER =
    /\b(?:cucina(?:\s+(?:completa|lineare|angolare|componibile|modulare|moderna|classica|su\s+misura|con\s+elettrodomestici))?|cucine|mobile\s+cucina|basi\s+cucina|pensile\s+cucina|pensili\s+cucina|isola\s+cucina|penisola\s+cucina|top\s+cucina|piano\s+(?:da\s+|di\s+lavoro\s+)?cucina|alzatina\s+cucina|paraschizzi|credenza\s+(?:da\s+)?cucina|carrello\s+(?:da\s+)?cucina|tavolo\s+(?:da\s+)?cucina|sgabelli\s+(?:da\s+)?cucina|piano\s+(?:a\s+|ad\s+)?induzione|piano\s+cottura|piani\s+cottura|piano\s+(?:a\s+)?gas|induction\s+hob|forno\s+(?:da\s+incasso|elettrico|ventilato|pirolitico|a\s+vapore|a\s+microonde|pizza)|fornetto(?:\s+elettrico)?|microonde|lavastoviglie|dishwasher|frigorifero|frigoriferi|frigo(?:\s+(?:combinato|americano|side\s+by\s+side|monoporta|doppia\s+porta|da\s+incasso|sottotop))?|congelatore|freezer|abbattitore|cantinetta\s+vini|cappa(?:\s+(?:aspirante|filtrante|cucina|arredo|telescopica|sottopensile|a\s+isola|da\s+parete|ad\s+incasso))?|lavello(?:\s+cucina)?|vasca\s+lavello|miscelatore\s+(?:da\s+)?cucina|rubinetto\s+(?:da\s+)?cucina|pattumiera\s+(?:cucina|differenziata|sottolavello)|friggitrice(?:\s+ad\s+aria)?|air\s+fryer|macchina\s+(?:da|del|per)\s+caff[eè]|macchina\s+caff[eè]|nespresso|lavazza\s+a\s+modo\s+mio|tostapane|bollitore(?:\s+elettrico)?|robot\s+da\s+cucina|impastatrice|planetaria|frullatore|minipimer|estrattore\s+(?:di\s+)?succo|centrifuga|bimby|thermomix|affettatrice|bilancia\s+(?:da\s+)?cucina|montalatte|vaporiera|cuociriso|pentola|pentole|padella|padelle|casseruola|tegame|wok|bistecchiera|piastra\s+(?:per\s+)?(?:panini|waffle|crepes)|scolapiatti|portaposate|ceppo\s+coltelli|coltelli\s+da\s+cucina|servizio\s+(?:di\s+)?piatti|servizio\s+(?:di\s+)?posate|posate|tagliere)\b/i;

  const LIVING_ROOM_RE_SERVER =
    /\b(?:divano|divani|divano\s+letto|divano\s+angolare|sof[aà]|copridivano|poltrona(?:\s+relax|\s+reclinabile|\s+letto|\s+da\s+salotto)?|chaise\s+longue|pouf(?:\s+contenitore)?|parete\s+attrezzata|mobile\s+(?:tv|porta\s*tv|soggiorno|salotto|salone)|porta\s*tv|tavolino\s+(?:da\s+)?(?:salotto|soggiorno|fumo|caff[eè]|basso|divano)|madia|credenza\s+(?:moderna|soggiorno|salotto|design)|libreria\s+(?:soggiorno|salotto|da\s+parete|modulare)|tavolo\s+da\s+pranzo|tavolo\s+allungabile|tavolo\s+soggiorno|sedie\s+(?:da\s+)?(?:pranzo|soggiorno|salotto)|sedia\s+da\s+pranzo|consolle\s+(?:allungabile|ingresso|soggiorno)|camino|caminetto|bioetanolo|smart\s*tv|oled\s*(?:tv|evo)?|qled|qned|miniled|tv\s+\d{2}\s*(?:pollici|["”])|televisore|televisori|soundbar|home\s+theater|home\s+theatre|home\s+cinema|staffa\s+(?:a\s+muro\s+per\s+)?tv|supporto\s+tv)\b/i;

  const MASTER_BEDROOM_RE_SERVER =
    /\b(?:letto\s+matrimoniale|letto\s+contenitore\s+matrimoniale|testiera\s+matrimoniale|rete\s+matrimoniale|materasso\s+matrimoniale|topper\s+matrimoniale|copripiumino\s+matrimoniale|piumone\s+matrimoniale|lenzuola\s+matrimoniali|completo\s+lenzuola\s+matrimoniale|trapunta\s+matrimoniale|copriletto\s+matrimoniale|king\s*size|materasso\s+(?:160|180)\s*x\s*(?:190|200)|letto\s+(?:160|180)\s*x\s*(?:190|200))\b/i;

  function extractUrlSlugTextServer(rawUrl?: string): string {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      return decodeURIComponent(u.pathname)
        .replace(/\/dp\/[A-Z0-9]{10}.*/i, '')
        .replace(/[-_/+.]+/g, ' ');
    } catch {
      return '';
    }
  }

  function extractStructuredSpecTextServer(specs?: string): string {
    if (!specs) return '';
    return specs
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) =>
        /^(?:tipo(?:\s+di\s+prodotto)?|tipologia|categoria|modello|nome\s+modello|prodotto|stanza|ambiente)\s*:/i.test(
          line
        )
      )
      .join(' ');
  }

  function matchRoomFromProductTextServer(text: string): ResearchRoomIdServer | undefined {
    const clean = text.trim();
    if (!clean) return undefined;

    if (/\b(?:bagno\s*2|secondo\s+bagno)\b/i.test(clean)) return 'bagno2';
    if (/\b(?:bagno\s*1|primo\s+bagno|bagno\s+principale)\b/i.test(clean)) return 'bagno1';
    if (/\b(?:stanza|camera)\s*(?:di\s*)?maurizio\b/i.test(clean)) return 'stanza_maurizio';
    if (/\b(?:stanza|camera)\s*(?:di\s*)?roberta\b/i.test(clean)) return 'stanza_roberta';
    if (/\b(?:stanza|camera)\s*matrimoniale\b/i.test(clean)) return 'stanza_matrimoniale';
    if (/\bterrazz[ao]\s*(?:a\s*)?ovest\b/i.test(clean)) return 'terrazza_ovest';
    if (/\bterrazz[ao]\s*(?:a\s*)?est\b/i.test(clean)) return 'terrazza_est';
    if (/\bkomodo(?:\s*5)?\b/i.test(clean)) return 'terrazza_ovest';

    if (NON_ROOM_PRODUCT_RE_SERVER.test(clean) || OUTDOOR_GUARD_RE_SERVER.test(clean)) {
      return undefined;
    }

    if (BATHROOM_ROOM_RE_SERVER.test(clean)) return 'bagno1';
    if (!BOOK_GUARD_RE_SERVER.test(clean) && KITCHEN_ROOM_RE_SERVER.test(clean)) return 'cucina';
    if (LIVING_ROOM_RE_SERVER.test(clean)) return 'salone';
    if (MASTER_BEDROOM_RE_SERVER.test(clean)) return 'stanza_matrimoniale';

    return undefined;
  }

  function inferResearchRoomServer(input: {
    title?: string;
    url?: string;
    specs?: string;
    category?: string;
  }): ResearchRoomIdServer | undefined {
    if (input.category === 'auto' || input.category === 'abbigliamento') {
      return undefined;
    }

    const primaryText = `${input.title || ''} ${extractUrlSlugTextServer(input.url)}`.trim();
    const explicitOrKomodo = matchRoomFromProductTextServer(primaryText);
    if (
      explicitOrKomodo === 'terrazza_ovest' ||
      explicitOrKomodo === 'terrazza_est' ||
      /\b(?:bagno\s*[12]|(?:primo|secondo)\s+bagno|bagno\s+principale|(?:stanza|camera)\s*(?:di\s*)?(?:maurizio|roberta|matrimoniale))\b/i.test(
        primaryText
      )
    ) {
      return explicitOrKomodo;
    }

    if (
      NON_ROOM_PRODUCT_RE_SERVER.test(primaryText) ||
      OUTDOOR_GUARD_RE_SERVER.test(`${primaryText} ${input.url || ''}`)
    ) {
      return undefined;
    }

    if (explicitOrKomodo) return explicitOrKomodo;

    const structuredSpecs = extractStructuredSpecTextServer(input.specs);
    if (structuredSpecs && !NON_ROOM_PRODUCT_RE_SERVER.test(structuredSpecs)) {
      return matchRoomFromProductTextServer(structuredSpecs);
    }

    return undefined;
  }

  function extractMetaContent(html: string, attrName: string, attrValue: string): string {
    const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp(
      `<meta[^>]*${attrName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      'i'
    );
    const m1 = html.match(re1);
    if (m1?.[1]) return decodeHtmlEntities(m1[1]);
    const re2 = new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escaped}["'][^>]*>`,
      'i'
    );
    const m2 = html.match(re2);
    return m2?.[1] ? decodeHtmlEntities(m2[1]) : '';
  }

  function parsePriceNumber(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1000000) {
      return Math.round(raw * 100) / 100;
    }
    if (typeof raw !== 'string') return undefined;
    const cleaned = raw.replace(/[^0-9.,]/g, '').trim();
    if (!cleaned) return undefined;
    // Handle Italian decimal comma or US decimal dot
    let normalized = cleaned;
    if (cleaned.includes(',') && cleaned.includes('.')) {
      normalized =
        cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
          ? cleaned.replace(/\./g, '').replace(',', '.')
          : cleaned.replace(/,/g, '');
    } else if (cleaned.includes(',')) {
      const parts = cleaned.split(',');
      normalized = parts[1] && parts[1].length <= 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
    }
    const num = Number.parseFloat(normalized);
    if (!Number.isFinite(num) || num <= 0 || num > 1000000) return undefined;
    return Math.round(num * 100) / 100;
  }

  function stripHtmlTags(raw: string): string {
    return decodeHtmlEntities(
      raw
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    );
  }

  function truncateAtWordBoundary(raw: string, maxLen: number): string {
    const clean = raw
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (clean.length <= maxLen) return clean;
    const slice = clean.slice(0, maxLen).trimEnd();
    const minSentenceCut = Math.min(45, Math.floor(maxLen * 0.25));
    let lastSentenceEnd = -1;
    const sentenceEndRe = /[.!?](?=\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = sentenceEndRe.exec(slice)) !== null) {
      if (match.index >= minSentenceCut) {
        lastSentenceEnd = match.index;
      }
    }
    if (lastSentenceEnd >= minSentenceCut) {
      return slice.slice(0, lastSentenceEnd + 1).trim();
    }
    const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
    const cut = lastBreak > Math.floor(maxLen * 0.35) ? slice.slice(0, lastBreak) : slice;
    return `${cut.replace(/[,:;—–-]+$/, '').trim()}…`;
  }

  function buildBoundedSpecsText(
    specsList: string[],
    bullets: string[],
    maxLen = 1850
  ): string {
    const lines: string[] = [];
    let currentLen = 0;

    for (const specLine of specsList) {
      const cleanSpec = specLine.replace(/\s+/g, ' ').trim();
      if (!cleanSpec) continue;
      const addedLen = (lines.length > 0 ? 1 : 0) + cleanSpec.length;
      if (currentLen + addedLen > maxLen) break;
      lines.push(cleanSpec);
      currentLen += addedLen;
    }

    const selectedBullets = bullets.slice(0, 4);
    for (let i = 0; i < selectedBullets.length; i += 1) {
      const remaining = maxLen - currentLen - (lines.length > 0 ? 1 : 0);
      if (remaining < 75) break;
      const remainingBullets = selectedBullets.length - i;
      const fairBudget = Math.max(
        240,
        Math.min(450, Math.floor((remaining - (remainingBullets - 1) * 3) / remainingBullets))
      );
      const bulletBudget = Math.min(remaining - 2, fairBudget);
      if (bulletBudget < 65) break;
      const trimmedBullet = truncateAtWordBoundary(selectedBullets[i], bulletBudget);
      const formatted = `• ${trimmedBullet}`;
      lines.push(formatted);
      currentLen += (lines.length > 1 ? 1 : 0) + formatted.length;
    }

    return lines.join('\n');
  }

  function extractBalancedJsonLiteral<T>(
    source: string,
    openChar: '{' | '[',
    closeChar: '}' | ']',
    startIndex: number
  ): T | undefined {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIndex; i < source.length && i < startIndex + 250_000; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === openChar) {
        depth += 1;
      } else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(startIndex, i + 1)) as T;
          } catch {
            return undefined;
          }
        }
      }
    }
    return undefined;
  }

  function extractAllJsonAfterKey<T>(
    source: string,
    keyName: string,
    openChar: '{' | '[',
    closeChar: '}' | ']'
  ): T[] {
    const escapedKey = keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:["']${escapedKey}["']|\\b${escapedKey})\\s*:\\s*\\${openChar}`, 'g');
    const results: T[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const braceIdx = match.index + match[0].length - 1;
      const parsed = extractBalancedJsonLiteral<T>(source, openChar, closeChar, braceIdx);
      if (parsed !== undefined) results.push(parsed);
    }
    return results;
  }

  function extractJsonAfterKey<T>(
    source: string,
    keyName: string,
    openChar: '{' | '[',
    closeChar: '}' | ']'
  ): T | undefined {
    return extractAllJsonAfterKey<T>(source, keyName, openChar, closeChar)[0];
  }

  function extractBestAmazonMediaUrl(entry: {
    hiRes?: unknown;
    large?: unknown;
    main?: unknown;
  }): string | undefined {
    if (typeof entry.hiRes === 'string' && /^https?:\/\//i.test(entry.hiRes)) {
      return entry.hiRes.slice(0, 1000);
    }
    if (entry.main && typeof entry.main === 'object' && !Array.isArray(entry.main)) {
      const bestMain = Object.entries(entry.main as Record<string, unknown>)
        .filter(([u, dims]) => /^https?:\/\//i.test(u) && Array.isArray(dims))
        .sort(([, a], [, b]) => {
          const da = a as number[];
          const db = b as number[];
          return (db[0] || 0) * (db[1] || 0) - (da[0] || 0) * (da[1] || 0);
        });
      if (bestMain[0]?.[0]) return bestMain[0][0].slice(0, 1000);
    }
    if (typeof entry.large === 'string' && /^https?:\/\//i.test(entry.large)) {
      return entry.large.slice(0, 1000);
    }
    return undefined;
  }

  function sanitizeColorImagesMap(raw: unknown): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Object.keys(out).length >= 24) break;
      const cleanKey = stripHtmlTags(String(k)).replace(/\s+/g, ' ').trim().slice(0, 60);
      const cleanVal = typeof v === 'string' ? v.trim().slice(0, 1000) : '';
      if (!cleanKey || !/^https?:\/\/.+/.test(cleanVal)) continue;
      out[cleanKey] = cleanVal;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function sanitizeSizePricesMapServer(raw: unknown): Record<string, number> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Object.keys(out).length >= 24) break;
      const cleanKey = stripHtmlTags(String(k)).replace(/\s+/g, ' ').trim().slice(0, 60);
      const parsed = parsePriceNumber(v);
      if (!cleanKey || parsed === undefined) continue;
      out[cleanKey] = Math.round(parsed * 100) / 100;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function normalizeOptionList(rawList: unknown, maxItems = 24): string[] {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of rawList) {
      if (typeof entry !== 'string' && typeof entry !== 'number') continue;
      const clean = stripHtmlTags(String(entry)).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
      if (out.length >= maxItems) break;
    }
    return out;
  }

  function extractProductFromJsonLd(html: string): {
    title?: string;
    brand?: string;
    color?: string;
    availableColors?: string[];
    colorImages?: Record<string, string>;
    size?: string;
    availableSizes?: string[];
    sizePrices?: Record<string, number>;
    model?: string;
    imageUrl?: string;
    priceEur?: number;
    description?: string;
    specsList?: string[];
  } {
    const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim()) as unknown;
        const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length > 0) {
          const node = queue.shift();
          if (!node || typeof node !== 'object') continue;
          const obj = node as Record<string, unknown>;
          if (Array.isArray(obj['@graph'])) {
            queue.push(...(obj['@graph'] as unknown[]));
          }
          const rawType = obj['@type'];
          const types = Array.isArray(rawType) ? rawType : [rawType];
          const isProduct = types.some(
            (t) => typeof t === 'string' && t.toLowerCase().includes('product')
          );
          if (!isProduct) continue;

          const title = typeof obj.name === 'string' ? decodeHtmlEntities(obj.name) : undefined;
          let brand: string | undefined;
          if (typeof obj.brand === 'string') {
            brand = decodeHtmlEntities(obj.brand);
          } else if (
            obj.brand &&
            typeof obj.brand === 'object' &&
            typeof (obj.brand as Record<string, unknown>).name === 'string'
          ) {
            brand = decodeHtmlEntities(String((obj.brand as Record<string, unknown>).name));
          }

          const variantColors: string[] = [];
          const color =
            typeof obj.color === 'string' ? decodeHtmlEntities(obj.color).slice(0, 60) : undefined;
          if (Array.isArray(obj.color)) {
            for (const c of obj.color) {
              if (typeof c === 'string' && c.trim()) {
                variantColors.push(decodeHtmlEntities(c).trim());
              }
            }
          }
          const size =
            typeof obj.size === 'string' ? decodeHtmlEntities(obj.size).slice(0, 60) : undefined;
          const variantSizes: string[] = [];
          const variantColorImages: Record<string, string> = {};
          const variantSizePrices: Record<string, number> = {};
          const readLdImg = (rawImg: unknown): string | undefined => {
            if (typeof rawImg === 'string' && /^https?:\/\//i.test(rawImg)) return rawImg.slice(0, 1000);
            if (Array.isArray(rawImg)) {
              const first = rawImg.find((x) => typeof x === 'string' && /^https?:\/\//i.test(x));
              if (typeof first === 'string') return first.slice(0, 1000);
            } else if (
              rawImg &&
              typeof rawImg === 'object' &&
              typeof (rawImg as Record<string, unknown>).url === 'string'
            ) {
              const u = String((rawImg as Record<string, unknown>).url);
              if (/^https?:\/\//i.test(u)) return u.slice(0, 1000);
            }
            return undefined;
          };
          if (Array.isArray(obj.hasVariant)) {
            for (const v of obj.hasVariant) {
              if (!v || typeof v !== 'object') continue;
              const vo = v as Record<string, unknown>;
              if (typeof vo.color === 'string') {
                variantColors.push(vo.color);
                const vCol = stripHtmlTags(vo.color).replace(/\s+/g, ' ').trim().slice(0, 60);
                const vImg = readLdImg(vo.image);
                if (vCol && vImg && !variantColorImages[vCol] && Object.keys(variantColorImages).length < 24) {
                  variantColorImages[vCol] = vImg;
                }
              }
              if (typeof vo.size === 'string') {
                variantSizes.push(vo.size);
                const vSz = stripHtmlTags(vo.size).replace(/\s+/g, ' ').trim().slice(0, 60);
                const voOffers = Array.isArray(vo.offers) ? vo.offers[0] : vo.offers;
                if (vSz && voOffers && typeof voOffers === 'object') {
                  const oo = voOffers as Record<string, unknown>;
                  const vPrice =
                    parsePriceNumber(oo.price) ??
                    parsePriceNumber(oo.lowPrice) ??
                    parsePriceNumber(oo.highPrice);
                  if (vPrice !== undefined && Object.keys(variantSizePrices).length < 24) {
                    variantSizePrices[vSz] = vPrice;
                  }
                }
              }
            }
          }
          const availableColors = normalizeOptionList(variantColors);
          const availableSizes = normalizeOptionList(variantSizes);

          const rawModel = obj.model ?? obj.mpn ?? obj.sku;
          const model =
            typeof rawModel === 'string' ? decodeHtmlEntities(rawModel).slice(0, 80) : undefined;

          const imageUrl = readLdImg(obj.image);

          let priceEur: number | undefined;
          const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
          if (offers && typeof offers === 'object') {
            const o = offers as Record<string, unknown>;
            priceEur =
              parsePriceNumber(o.price) ??
              parsePriceNumber(o.lowPrice) ??
              parsePriceNumber(o.highPrice);
          }
          const description =
            typeof obj.description === 'string' ? decodeHtmlEntities(obj.description) : undefined;

          const specsList: string[] = [];
          const seenLdLabels = new Set<string>();
          const pushLdSpec = (label: string, val: unknown) => {
            if (!label || specsList.length >= 16) return;
            let textVal = '';
            if (typeof val === 'string' || typeof val === 'number') {
              textVal = stripHtmlTags(String(val)).replace(/\s+/g, ' ').trim();
            } else if (val && typeof val === 'object' && !Array.isArray(val)) {
              const vo = val as Record<string, unknown>;
              const qVal = vo.value ?? vo.name;
              const qUnit = vo.unitText ?? vo.unitCode;
              if (qVal !== undefined && qVal !== null) {
                textVal = `${stripHtmlTags(String(qVal)).trim()}${
                  typeof qUnit === 'string' && qUnit.trim() ? ` ${qUnit.trim()}` : ''
                }`.trim();
              }
            }
            if (!textVal || textVal.length > 180) return;
            const cleanLabel = stripHtmlTags(label).replace(/:$/, '').trim();
            if (!cleanLabel || cleanLabel.length > 50) return;
            const low = cleanLabel.toLowerCase();
            if (seenLdLabels.has(low)) return;
            seenLdLabels.add(low);
            specsList.push(`${cleanLabel}: ${textVal}`);
          };

          if (obj.material) pushLdSpec('Materiale', obj.material);
          if (obj.pattern) pushLdSpec('Finitura', obj.pattern);
          if (obj.width) pushLdSpec('Larghezza', obj.width);
          if (obj.height) pushLdSpec('Altezza', obj.height);
          if (obj.depth) pushLdSpec('Profondità', obj.depth);
          if (obj.weight) pushLdSpec('Peso', obj.weight);
          if (Array.isArray(obj.additionalProperty)) {
            for (const prop of obj.additionalProperty) {
              if (!prop || typeof prop !== 'object') continue;
              const po = prop as Record<string, unknown>;
              if (typeof po.name === 'string') {
                pushLdSpec(po.name, po.value !== undefined ? po : po.valueText);
              }
            }
          }

          if (title || priceEur || imageUrl || specsList.length > 0) {
            return {
              title,
              brand,
              color,
              availableColors: availableColors.length > 0 ? availableColors : undefined,
              colorImages:
                Object.keys(variantColorImages).length > 0 ? variantColorImages : undefined,
              size,
              availableSizes: availableSizes.length > 0 ? availableSizes : undefined,
              sizePrices:
                Object.keys(variantSizePrices).length > 0 ? variantSizePrices : undefined,
              model,
              imageUrl,
              priceEur,
              description,
              specsList: specsList.length > 0 ? specsList : undefined,
            };
          }
        }
      } catch {
        // ignore invalid JSON-LD block
      }
    }
    return {};
  }

  function extractAmazonAStateJson<T>(html: string, stateKey: string): T | null {
    const regex = /<script\b[^>]*\bdata-a-state=(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(regex)) {
      const attrRaw = match[2].replace(/&quot;/g, '"');
      if (!attrRaw.includes(`"${stateKey}"`)) continue;
      try {
        const meta = JSON.parse(attrRaw) as { key?: string };
        if (meta.key !== stateKey) continue;
        const body = match[3].trim();
        if (!body) continue;
        return JSON.parse(body) as T;
      } catch {
        // ignore malformed a-state block
      }
    }
    return null;
  }

  function extractAmazonAsin(parsedUrl: URL): string | undefined {
    const m = parsedUrl.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return m?.[1]?.toUpperCase();
  }

  function canonicalInspectCacheKey(parsedUrl: URL): string {
    const asin = extractAmazonAsin(parsedUrl);
    if (parsedUrl.hostname.toLowerCase().includes('amazon.') && asin) {
      return `${parsedUrl.hostname.toLowerCase()}/dp/${asin}`;
    }
    const clean = new URL(parsedUrl.toString());
    for (const key of Array.from(clean.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|pd_rd_|pf_rd_|ref_?|content-id|_encoding)/i.test(key)) {
        clean.searchParams.delete(key);
      }
    }
    return clean.toString();
  }

  function extractAmazonBuyboxPrice(html: string): number | undefined {
    let priceEur: number | undefined;
    const twisterJsonMatch = html.match(
      /twister-plus-(?:buying-options-)?price-data["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (twisterJsonMatch?.[1]) {
      const twAmountM = twisterJsonMatch[1].match(/"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
      if (twAmountM?.[1]) {
        priceEur = parsePriceNumber(twAmountM[1]);
      }
    }

    const priceBlockRegions: string[] = [];
    const priceDisplayIdx = html.indexOf('corePriceDisplay_desktop_feature_div');
    if (priceDisplayIdx !== -1) priceBlockRegions.push(html.slice(priceDisplayIdx, priceDisplayIdx + 16000));
    const corePriceIdx = html.indexOf('id="corePrice_feature_div"');
    if (corePriceIdx !== -1) priceBlockRegions.push(html.slice(corePriceIdx, corePriceIdx + 14000));
    const buyboxPriceIdx = html.indexOf('id="price_inside_buybox"');
    if (buyboxPriceIdx !== -1) priceBlockRegions.push(html.slice(buyboxPriceIdx, buyboxPriceIdx + 1500));

    for (const region of priceBlockRegions) {
      if (priceEur !== undefined) break;
      const toPayMatch = region.match(
        /class=["'][^"']*(?:priceToPay|apex-pricetopay-value)[^"']*["'][\s\S]{0,1000}/i
      );
      const targetSlice = toPayMatch?.[0] || region;

      const offscreenMatches = [
        ...targetSlice.matchAll(/class=["'](?:a-offscreen|aok-offscreen)["'][^>]*>([\s\S]*?)<\/span>/gi),
      ];
      for (const om of offscreenMatches) {
        const parsed = parsePriceNumber(stripHtmlTags(om[1]));
        if (parsed !== undefined) {
          priceEur = parsed;
          break;
        }
      }
      if (priceEur === undefined) {
        const wholeM = targetSlice.match(/class=["']a-price-whole["'][^>]*>([\d.]+)/i);
        const fracM = targetSlice.match(/class=["']a-price-fraction["'][^>]*>(\d{1,2})/i);
        if (wholeM?.[1]) {
          const cleanWhole = wholeM[1].replace(/\./g, '');
          const candidate = fracM?.[1] ? `${cleanWhole}.${fracM[1]}` : cleanWhole;
          priceEur = parsePriceNumber(candidate);
        }
      }
      if (priceEur === undefined) {
        const regionAmountM = targetSlice.match(/"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
        if (regionAmountM?.[1]) {
          priceEur = parsePriceNumber(regionAmountM[1]);
        }
      }
    }
    return priceEur;
  }

  function extractAmazonDomDetails(
    html: string,
    asin?: string
  ): {
    title?: string;
    brand?: string;
    imageUrl?: string;
    priceEur?: number;
    color?: string;
    availableColors: string[];
    colorImages: Record<string, string>;
    size?: string;
    availableSizes: string[];
    sizeAsinCandidates: Record<string, string[]>;
    colorAsinCandidates: Record<string, string>;
    model?: string;
    specsList: string[];
    bullets: string[];
  } {
    // 1. Product Title (#productTitle desktop or #title mobile)
    let title: string | undefined;
    const titleMatch = html.match(/id=["'](?:productTitle|title)["'][^>]*>([\s\S]*?)<\/span>/i);
    if (titleMatch?.[1]) {
      const cleaned = stripHtmlTags(titleMatch[1]);
      if (cleaned) title = cleaned.slice(0, 160);
    }

    // 2. High-res Primary Image (#landingImage / #imgBlkFront / #main-image / colorImages.initial[0])
    let imageUrl: string | undefined;
    let heroImgTag = '';
    const landingIdx = html.search(/id=["'](?:landingImage|imgBlkFront|main-image)["']/i);
    if (landingIdx !== -1) {
      const imgOpen = html.lastIndexOf('<img', landingIdx);
      const imgClose = html.indexOf('>', landingIdx);
      if (imgOpen !== -1 && imgClose !== -1 && imgClose - imgOpen < 8000) {
        heroImgTag = html.slice(imgOpen, imgClose + 1);
      }
    }

    if (heroImgTag) {
      const oldHires = heroImgTag.match(/data-old-hires=["'](https?:\/\/[^"']+)["']/i);
      if (oldHires?.[1]) {
        imageUrl = decodeHtmlEntities(oldHires[1]);
      }
      if (!imageUrl) {
        const aHires = heroImgTag.match(/data-a-hires=["'](https?:\/\/[^"']+)["']/i);
        if (aHires?.[1]) {
          imageUrl = decodeHtmlEntities(aHires[1]);
        }
      }
    }

    if (!imageUrl) {
      const colorImagesIdx = html.search(/['"]?colorImages['"]?\s*:\s*\{/i);
      if (colorImagesIdx !== -1) {
        const ciSlice = html.slice(colorImagesIdx, colorImagesIdx + 60_000);
        const initialMatch = ciSlice.match(/['"]initial['"]\s*:\s*(?:A\.\$\.parseJSON\(['"])?\[/);
        if (initialMatch && typeof initialMatch.index === 'number') {
          const arrStart = initialMatch.index + initialMatch[0].length - 1;
          const initialArr = extractBalancedJsonLiteral<
            Array<{
              hiRes?: string;
              large?: string;
              main?: Record<string, [number, number]>;
            }>
          >(ciSlice, '[', ']', arrStart);
          const firstImg = Array.isArray(initialArr) ? initialArr[0] : undefined;
          if (firstImg) {
            if (typeof firstImg.hiRes === 'string' && /^https?:\/\//i.test(firstImg.hiRes)) {
              imageUrl = firstImg.hiRes;
            } else if (firstImg.main && typeof firstImg.main === 'object') {
              const bestMain = Object.entries(firstImg.main)
                .filter(([u, dims]) => /^https?:\/\//i.test(u) && Array.isArray(dims))
                .sort(([, a], [, b]) => (b[0] || 0) * (b[1] || 0) - (a[0] || 0) * (a[1] || 0));
              if (bestMain[0]?.[0]) imageUrl = bestMain[0][0];
            } else if (typeof firstImg.large === 'string' && /^https?:\/\//i.test(firstImg.large)) {
              imageUrl = firstImg.large;
            }
          }
        }
      }
    }

    if (!imageUrl && heroImgTag) {
      const dynAttr = heroImgTag.match(/data-a-dynamic-image=["']([^"']+)["']/i);
      if (dynAttr?.[1]) {
        try {
          const dynJson = JSON.parse(decodeHtmlEntities(dynAttr[1])) as Record<
            string,
            [number, number]
          >;
          const sorted = Object.entries(dynJson)
            .filter(([u, dims]) => /^https?:\/\//i.test(u) && Array.isArray(dims))
            .sort(([, a], [, b]) => (b[0] || 0) * (b[1] || 0) - (a[0] || 0) * (a[1] || 0));
          if (sorted[0]?.[0]) imageUrl = sorted[0][0];
        } catch {
          // ignore
        }
      }
      if (!imageUrl) {
        const srcAttr = heroImgTag.match(
          /(?:data-a-image-source|\bsrc)=["'](https?:\/\/m\.media-amazon\.com\/images\/I\/[^"']+)["']/i
        );
        if (srcAttr?.[1]) imageUrl = decodeHtmlEntities(srcAttr[1]);
      }
    }

    if (!imageUrl) {
      const hiResMatch = html.match(
        /"(?:hiRes|large)"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i
      );
      if (hiResMatch?.[1]) imageUrl = hiResMatch[1];
    }

    // 3. Price (twister-plus-buying-options-price-data / .priceToPay / #corePriceDisplay_desktop_feature_div)
    const priceEur = extractAmazonBuyboxPrice(html);

    // 4. Brand (#bylineInfo, overridden by explicit Marchio/Marca in Product Overview if Renewed/Amazon)
    let bylineBrand: string | undefined;
    const bylineMatch = html.match(/id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i);
    if (bylineMatch?.[1]) {
      const rawByline = stripHtmlTags(bylineMatch[1])
        .replace(/^(?:Visita lo Store di|Marca:|Brand:)\s*/i, '')
        .replace(/\s+Store$/i, '')
        .trim();
      if (rawByline && rawByline.length <= 60) bylineBrand = rawByline;
    }
    let overviewBrand: string | undefined;

    // 5. Product Overview Table (#productOverview_feature_div) + Technical Specs Table
    const specsList: string[] = [];
    const seenLabels = new Set<string>();
    let overviewColor: string | undefined;
    let overviewSize: string | undefined;
    let overviewModel: string | undefined;

    const overviewIdx = html.indexOf('id="productOverview_feature_div"');
    if (overviewIdx !== -1) {
      const ovSlice = html.slice(overviewIdx, overviewIdx + 35000);
      const tableMatch = ovSlice.match(/<table[\s\S]*?<\/table>/i);
      const tableHtml = tableMatch?.[0] || ovSlice;
      const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
      for (const row of rows) {
        const tds = [...row[0].matchAll(/<td[\s\S]*?<\/td>/gi)];
        if (tds.length < 2) continue;
        const label = stripHtmlTags(tds[0][0]).replace(/:$/, '').trim();
        const value = stripHtmlTags(tds[1][0]).trim();
        if (!label || !value || label.length > 60 || value.length > 140) continue;
        const lowLabel = label.toLowerCase();
        if (lowLabel === 'marchio' || lowLabel === 'marca' || lowLabel === 'brand') {
          if (!overviewBrand) overviewBrand = value.slice(0, 60);
          continue;
        }
        if (lowLabel === 'colore' || lowLabel === 'color' || lowLabel === 'colour') {
          if (!overviewColor) overviewColor = value.slice(0, 60);
          continue;
        }
        if (
          lowLabel === 'taglia' ||
          lowLabel === 'size' ||
          lowLabel === 'capacità' ||
          lowLabel === 'capacità memoria' ||
          lowLabel === 'capacità di memoria' ||
          lowLabel === 'dimensione memoria'
        ) {
          const isMultiCapacityList =
            /\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b.*\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b/i.test(value);
          if (!overviewSize && !isMultiCapacityList) overviewSize = value.slice(0, 60);
        }
        if (
          lowLabel.includes('nome modello') ||
          lowLabel.includes('numero modello') ||
          lowLabel === 'modello'
        ) {
          if (!overviewModel) overviewModel = value.slice(0, 80);
        }
        if (!seenLabels.has(lowLabel)) {
          seenLabels.add(lowLabel);
          specsList.push(`${label}: ${value}`);
        }
      }
    }

    // Also parse #productDetails_techSpec_section_1 if present
    const techSpecIdx = html.indexOf('id="productDetails_techSpec_section_1"');
    if (techSpecIdx !== -1) {
      const tsSlice = html.slice(techSpecIdx, techSpecIdx + 35000);
      const tsMatch = tsSlice.match(/<table[\s\S]*?<\/table>/i);
      const tsHtml = tsMatch?.[0] || tsSlice;
      const rows = [...tsHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
      for (const row of rows) {
        const thM = row[0].match(/<th[\s\S]*?<\/th>/i);
        const tdM = row[0].match(/<td[\s\S]*?<\/td>/i);
        if (!thM || !tdM) continue;
        const label = stripHtmlTags(thM[0]).replace(/:$/, '').trim();
        const value = stripHtmlTags(tdM[0]).trim();
        if (!label || !value || label.length > 60 || value.length > 140) continue;
        const lowLabel = label.toLowerCase();
        if (lowLabel === 'marchio' || lowLabel === 'marca' || lowLabel === 'brand') {
          if (!overviewBrand) overviewBrand = value.slice(0, 60);
          continue;
        }
        if (lowLabel === 'colore' || lowLabel === 'color') {
          if (!overviewColor) overviewColor = value.slice(0, 60);
          continue;
        }
        if (
          lowLabel === 'taglia' ||
          lowLabel === 'size' ||
          lowLabel === 'capacità' ||
          lowLabel === 'capacità memoria'
        ) {
          const isMultiCapacityList =
            /\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b.*\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b/i.test(value);
          if (!overviewSize && !isMultiCapacityList) overviewSize = value.slice(0, 60);
        }
        if (lowLabel.includes('numero modello') || lowLabel.includes('modello')) {
          if (!overviewModel) overviewModel = value.slice(0, 80);
        }
        if (!seenLabels.has(lowLabel) && specsList.length < 12) {
          seenLabels.add(lowLabel);
          specsList.push(`${label}: ${value}`);
        }
      }
    }

    const brand =
      overviewBrand && (!bylineBrand || /amazon|renewed|ricondizionat/i.test(bylineBrand))
        ? overviewBrand
        : bylineBrand || overviewBrand;

    // 6. Product Variants (Colors & Sizes) from Amazon Twister JSON + Mobile Twister Plus a-state + DOM fallback
    const desktopVariationValues = extractJsonAfterKey<Record<string, unknown>>(
      html,
      'variationValues',
      '{',
      '}'
    );
    const mobileVariationValues = extractAmazonAStateJson<Record<string, unknown>>(
      html,
      'mobile-twister-dim-val-list'
    );
    const variationValues = desktopVariationValues || mobileVariationValues;

    const desktopDimensions = extractJsonAfterKey<string[]>(html, 'dimensions', '[', ']');
    const mobileDimensions = extractAmazonAStateJson<{ key?: string[] }>(
      html,
      'mobile-twister-dim-list'
    )?.key;
    const dimensions =
      Array.isArray(desktopDimensions) && desktopDimensions.length > 0
        ? desktopDimensions
        : Array.isArray(mobileDimensions) && mobileDimensions.length > 0
          ? mobileDimensions
          : null;

    const dimensionValuesDisplayData = extractJsonAfterKey<Record<string, unknown>>(
      html,
      'dimensionValuesDisplayData',
      '{',
      '}'
    );
    const mobileDimsToAsin = extractAmazonAStateJson<Record<string, string>>(
      html,
      'mobile-twister-dims-to-asin-list'
    );

    let availableColors: string[] = [];
    let availableSizes: string[] = [];
    let colorDimKey: string | undefined;
    let sizeDimKey: string | undefined;

    if (variationValues && typeof variationValues === 'object') {
      const colorPriority = ['color_name', 'color', 'colour_name', 'colour', 'colore', 'pattern_name'];
      for (const k of colorPriority) {
        if (Array.isArray(variationValues[k]) && variationValues[k].length > 0) {
          colorDimKey = k;
          availableColors = normalizeOptionList(variationValues[k]);
          break;
        }
      }

      const sizePriority = [
        'size_name',
        'size',
        'memory_storage_capacity',
        'storage_capacity',
        'capacity_name',
        'capacity',
        'ram_memory_installed_size',
        'computer_memory_size',
        'hard_disk_size',
        'taglia',
        'dimensione',
        'format_name',
        'item_package_quantity',
      ];
      for (const k of sizePriority) {
        if (Array.isArray(variationValues[k]) && variationValues[k].length > 0) {
          sizeDimKey = k;
          availableSizes = normalizeOptionList(variationValues[k]);
          break;
        }
      }

      if (availableSizes.length === 0) {
        for (const [k, v] of Object.entries(variationValues)) {
          if (
            k !== colorDimKey &&
            /(?:size|capacity|memory|storage|taglia|dimension|ram|disk|watt|inch|screen)/i.test(k) &&
            Array.isArray(v) &&
            v.length > 0
          ) {
            sizeDimKey = k;
            availableSizes = normalizeOptionList(v);
            break;
          }
        }
      }

      if (availableSizes.length === 0 && Array.isArray(variationValues.style_name)) {
        const styleOpts = normalizeOptionList(variationValues.style_name);
        const looksLikeSizes = styleOpts.some((s) =>
          /\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb|cm|mm|m|kg|g|ml|l|lt|w|pollici|")\b|^(?:xxs|xs|s|m|l|xl|xxl|xxxl)$/i.test(
            s
          )
        );
        if (looksLikeSizes) {
          sizeDimKey = 'style_name';
          availableSizes = styleOpts;
        }
      }
    }

    // Extract active color & size for this ASIN from dimensionValuesDisplayData or mobile-twister-dims-to-asin-list
    let twisterActiveColor: string | undefined;
    let twisterActiveSize: string | undefined;
    if (asin && dimensionValuesDisplayData && Array.isArray(dimensions)) {
      const asinKey = Object.keys(dimensionValuesDisplayData).find(
        (k) => k.toUpperCase() === asin.toUpperCase()
      );
      const activeTuple = asinKey ? dimensionValuesDisplayData[asinKey] : undefined;
      if (Array.isArray(activeTuple)) {
        if (colorDimKey) {
          const cIdx = dimensions.indexOf(colorDimKey);
          if (cIdx !== -1 && typeof activeTuple[cIdx] === 'string') {
            twisterActiveColor = stripHtmlTags(activeTuple[cIdx]).slice(0, 60);
          }
        }
        if (sizeDimKey) {
          const sIdx = dimensions.indexOf(sizeDimKey);
          if (sIdx !== -1 && typeof activeTuple[sIdx] === 'string') {
            twisterActiveSize = stripHtmlTags(activeTuple[sIdx]).slice(0, 60);
          }
        }
      }
    }
    if (
      asin &&
      (!twisterActiveColor || !twisterActiveSize) &&
      mobileDimsToAsin &&
      Array.isArray(dimensions) &&
      variationValues
    ) {
      const activeEntry = Object.entries(mobileDimsToAsin).find(
        ([, valAsin]) => typeof valAsin === 'string' && valAsin.toUpperCase() === asin.toUpperCase()
      );
      if (activeEntry) {
        const parts = activeEntry[0].split(':').map((n) => Number.parseInt(n, 10));
        if (!twisterActiveColor && colorDimKey) {
          const cIdx = dimensions.indexOf(colorDimKey);
          const colorArr = Array.isArray(variationValues[colorDimKey])
            ? (variationValues[colorDimKey] as unknown[])
            : [];
          const valIdx = cIdx !== -1 ? parts[cIdx] : -1;
          if (Number.isInteger(valIdx) && valIdx >= 0 && typeof colorArr[valIdx] === 'string') {
            twisterActiveColor = stripHtmlTags(colorArr[valIdx]).slice(0, 60);
          }
        }
        if (!twisterActiveSize && sizeDimKey) {
          const sIdx = dimensions.indexOf(sizeDimKey);
          const sizeArr = Array.isArray(variationValues[sizeDimKey])
            ? (variationValues[sizeDimKey] as unknown[])
            : [];
          const valIdx = sIdx !== -1 ? parts[sIdx] : -1;
          if (Number.isInteger(valIdx) && valIdx >= 0 && typeof sizeArr[valIdx] === 'string') {
            twisterActiveSize = stripHtmlTags(sizeArr[valIdx]).slice(0, 60);
          }
        }
      }
    }

    // DOM Twister Fallback for Color list
    if (availableColors.length === 0) {
      const colorBlockIdx = html.search(
        /id=["'](?:variation_color_name|inline-twister-row-color_name|inline-twister-expander-content-color_name)["']/i
      );
      if (colorBlockIdx !== -1) {
        const cSlice = html.slice(colorBlockIdx, colorBlockIdx + 25000);
        const extracted: string[] = [];
        for (const m of cSlice.matchAll(
          /(?:swatch-title-text-display[^>]*>([\s\S]*?)<\/span>|twisterTextDiv[^>]*>([\s\S]*?)<\/div>|<img[^>]*\balt=["']([^"']+)["'][^>]*class=["'][^"']*imgSwatch|aria-label=["']Seleziona\s+([^"']+)["'])/gi
        )) {
          const rawVal = m[1] || m[2] || m[3] || m[4] || '';
          const cleaned = stripHtmlTags(rawVal).replace(/\s+/g, ' ').trim();
          if (cleaned && !/^(seleziona|clicca|scegli)/i.test(cleaned)) {
            extracted.push(cleaned);
          }
        }
        availableColors = normalizeOptionList(extracted);
      }
    }

    // DOM Twister Fallback for Size list
    if (availableSizes.length === 0) {
      const sizeBlockIdx = html.search(
        /id=["'](?:variation_size_name|variation_memory_storage_capacity|variation_capacity_name|inline-twister-row-size_name|inline-twister-row-memory_storage_capacity|inline-twister-row-capacity_name|inline-twister-expander-content-size_name|inline-twister-expander-content-memory_storage_capacity|inline-twister-expander-content-capacity_name)["']/i
      );
      if (sizeBlockIdx !== -1) {
        const sSlice = html.slice(sizeBlockIdx, sizeBlockIdx + 25000);
        const extracted: string[] = [];
        for (const m of sSlice.matchAll(
          /(?:swatch-title-text-display[^>]*>([\s\S]*?)<\/span>|twisterTextDiv[^>]*>([\s\S]*?)<\/div>|<span[^>]*class=["'][^"']*a-size-base[^"']*["'][^>]*>([\s\S]*?)<\/span>)/gi
        )) {
          const rawVal = m[1] || m[2] || m[3] || '';
          const cleaned = stripHtmlTags(rawVal).replace(/\s+/g, ' ').trim();
          if (
            cleaned &&
            cleaned.length <= 45 &&
            !/^(seleziona|taglia|capacità|dimensioni|con\s+opzioni|da\s+€|€)/i.test(cleaned)
          ) {
            extracted.push(cleaned);
          }
        }
        availableSizes = normalizeOptionList(extracted);
      }
    }

    const cleanTwisterAriaVal = (raw: string): string =>
      stripHtmlTags(raw)
        .replace(/\.?\s*(?:tocca per espandere|tap to expand)\.?$/i, '')
        .trim()
        .slice(0, 60);

    // Active Color from Twister variation widget if not found yet
    let color = twisterActiveColor || overviewColor;
    if (!color) {
      const twisterAria = html.match(/aria-label=["']La Colore selezionat[ao] è ([^"']+)["']/i);
      if (twisterAria?.[1]) color = cleanTwisterAriaVal(twisterAria[1]);
    }
    if (!color) {
      const twisterDim = html.match(
        /inline-twister-expander-header-color_name[\s\S]{0,1200}?inline-twister-dim-title-value[^>]*>([\s\S]*?)<\/span>/i
      );
      if (twisterDim?.[1]) color = cleanTwisterAriaVal(twisterDim[1]);
    }
    if (!color) {
      const varColor = html.match(
        /id=["']variation_color_name["'][\s\S]{0,1000}?class=["']selection["'][^>]*>([\s\S]*?)<\/span>/i
      );
      if (varColor?.[1]) color = cleanTwisterAriaVal(varColor[1]);
    }

    // Active Size from Twister variation widget / overview if not found yet
    let size = twisterActiveSize || overviewSize;
    if (!size) {
      const twisterSizeAria = html.match(
        /aria-label=["']La (?:Taglia|Capacità(?: memoria)?|Dimensione) selezionat[ao] è ([^"']+)["']/i
      );
      if (twisterSizeAria?.[1]) size = cleanTwisterAriaVal(twisterSizeAria[1]);
    }
    if (!size) {
      const twisterSizeDim = html.match(
        /inline-twister-expander-header-(?:size_name|memory_storage_capacity|capacity_name)[\s\S]{0,1200}?inline-twister-dim-title-value[^>]*>([\s\S]*?)<\/span>/i
      );
      if (twisterSizeDim?.[1]) size = cleanTwisterAriaVal(twisterSizeDim[1]);
    }
    if (!size) {
      const varSize = html.match(
        /id=["']variation_(?:size_name|memory_storage_capacity|capacity_name)["'][\s\S]{0,1000}?class=["']selection["'][^>]*>([\s\S]*?)<\/span>/i
      );
      if (varSize?.[1]) size = cleanTwisterAriaVal(varSize[1]);
    }

    // 7. Feature bullets (#feature-bullets)
    const bullets: string[] = [];
    const bulletsIdx = html.indexOf('id="feature-bullets"');
    if (bulletsIdx !== -1) {
      const bSlice = html.slice(bulletsIdx, bulletsIdx + 12000);
      const listMatch = bSlice.match(/<ul[\s\S]*?<\/ul>/i);
      if (listMatch?.[0]) {
        const lis = [...listMatch[0].matchAll(/<li[\s\S]*?<\/li>/gi)];
        for (const li of lis) {
          if (/id=["']replacementPartsFitmentBullet/i.test(li[0])) continue;
          const text = stripHtmlTags(li[0]);
          if (text && text.length >= 6) {
            bullets.push(truncateAtWordBoundary(text, 450));
          }
        }
      }
    }

    const model =
      overviewModel && asin && !overviewModel.includes(asin)
        ? `${overviewModel} (${asin})`.slice(0, 80)
        : (overviewModel || asin || undefined)?.slice(0, 80);

    // 8. Per-color variant images map from ImageBlockATF colorImages + colorToAsin + dimensionValuesDisplayData
    const colorImages: Record<string, string> = {};
    const colorToAsinCandidates = extractAllJsonAfterKey<Record<string, unknown>>(
      html,
      'colorToAsin',
      '{',
      '}'
    );
    const colorToAsinMap = colorToAsinCandidates.find((obj) =>
      Object.values(obj).some(
        (v) => Boolean(v && typeof v === 'object' && typeof (v as { asin?: unknown }).asin === 'string')
      )
    ) as Record<string, { asin?: string }> | undefined;

    const colorImagesCandidates = extractAllJsonAfterKey<Record<string, unknown>>(
      html,
      'colorImages',
      '{',
      '}'
    );
    const variantColorImagesMap = colorImagesCandidates.find((obj) =>
      Object.entries(obj).some(([k, v]) => k !== 'initial' && Array.isArray(v) && v.length > 0)
    ) as Record<string, Array<{ variant?: unknown; hiRes?: unknown; large?: unknown; main?: unknown }>> | undefined;

    if (variantColorImagesMap) {
      const cIdx = colorDimKey && Array.isArray(dimensions) ? dimensions.indexOf(colorDimKey) : -1;
      const sIdx = sizeDimKey && Array.isArray(dimensions) ? dimensions.indexOf(sizeDimKey) : -1;
      const sortedAvailColors = [...availableColors].sort((a, b) => b.length - a.length);
      const activeSizeNorm = size?.trim().toLowerCase().replace(/\s+/g, '') || '';

      for (const [variantKey, imgArr] of Object.entries(variantColorImagesMap)) {
        if (!Array.isArray(imgArr) || imgArr.length === 0) continue;
        const mainItem =
          imgArr.find((entry) => entry && typeof entry === 'object' && entry.variant === 'MAIN') ||
          imgArr[0];
        if (!mainItem || typeof mainItem !== 'object') continue;
        const bestUrl = extractBestAmazonMediaUrl(mainItem);
        if (!bestUrl) continue;

        let matchedColor: string | undefined;
        let variantSizeNorm = '';

        const mappedAsin = colorToAsinMap?.[variantKey]?.asin;
        if (mappedAsin && dimensionValuesDisplayData) {
          const tuple = dimensionValuesDisplayData[mappedAsin];
          if (Array.isArray(tuple)) {
            if (cIdx !== -1 && typeof tuple[cIdx] === 'string') {
              matchedColor = stripHtmlTags(tuple[cIdx]).replace(/\s+/g, ' ').trim().slice(0, 60);
            }
            if (sIdx !== -1 && typeof tuple[sIdx] === 'string') {
              variantSizeNorm = stripHtmlTags(tuple[sIdx]).trim().toLowerCase().replace(/\s+/g, '');
            }
          }
        }

        if (!matchedColor) {
          const vKeyClean = variantKey.replace(/\s+/g, ' ').trim();
          const vKeyLow = vKeyClean.toLowerCase();
          matchedColor =
            sortedAvailColors.find((col) => {
              const colLow = col.toLowerCase();
              if (vKeyLow === colLow || vKeyLow.startsWith(`${colLow} `) || vKeyLow.endsWith(` ${colLow}`)) {
                return true;
              }
              const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp(`(?:^|[\\s/,-])${escaped}(?=$|[\\s/,-])`, 'i').test(vKeyClean);
            }) || (availableSizes.length === 0 ? vKeyClean.slice(0, 60) : undefined);
        }

        if (!matchedColor) continue;
        if (Object.keys(colorImages).length >= 24 && !colorImages[matchedColor]) continue;

        const matchesActiveSize = Boolean(activeSizeNorm && variantSizeNorm === activeSizeNorm);
        if (!colorImages[matchedColor] || matchesActiveSize) {
          colorImages[matchedColor] = bestUrl;
        }
      }
    }

    if (color && imageUrl && !colorImages[color] && Object.keys(colorImages).length < 24) {
      colorImages[color] = imageUrl;
    }

    // 9. Per-size candidate ASINs (prioritizing active color's ASIN first, with other colors as fallback)
    const sizeAsinCandidates: Record<string, string[]> = {};
    const addSizeAsinCandidate = (sizeLabel: string, candAsin: string, prioritize = false) => {
      const cleanAsin = candAsin.trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) return;
      const existing = sizeAsinCandidates[sizeLabel] || [];
      if (existing.includes(cleanAsin)) {
        if (prioritize && existing[0] !== cleanAsin) {
          sizeAsinCandidates[sizeLabel] = [cleanAsin, ...existing.filter((x) => x !== cleanAsin)];
        }
        return;
      }
      sizeAsinCandidates[sizeLabel] = prioritize ? [cleanAsin, ...existing] : [...existing, cleanAsin];
    };

    const matchCanonicalSize = (rawSz: string): string | undefined => {
      const compact = rawSz.trim().toLowerCase().replace(/\s+/g, '');
      if (!compact) return undefined;
      return availableSizes.find(
        (s) => s.trim().toLowerCase().replace(/\s+/g, '') === compact
      );
    };

    const sizeBlockForAsinsIdx = html.search(
      /id=["'](?:variation_size_name|variation_memory_storage_capacity|variation_capacity_name|inline-twister-row-size_name|inline-twister-row-memory_storage_capacity|inline-twister-row-capacity_name|inline-twister-expander-content-size_name|inline-twister-expander-content-memory_storage_capacity|inline-twister-expander-content-capacity_name)["']/i
    );
    if (sizeBlockForAsinsIdx !== -1 && availableSizes.length > 0) {
      const sSlice = html.slice(sizeBlockForAsinsIdx, sizeBlockForAsinsIdx + 25000);
      for (const liMatch of sSlice.matchAll(
        /<li[^>]*data-asin=["']([A-Z0-9]{10})["'][^>]*>([\s\S]*?)<\/li>/gi
      )) {
        const liAsin = liMatch[1];
        const textM = liMatch[2].match(
          /(?:swatch-title-text-display[^>]*>([\s\S]*?)<\/span>|twisterTextDiv[^>]*>([\s\S]*?)<\/div>|<span[^>]*class=["'][^"']*a-size-base[^"']*["'][^>]*>([\s\S]*?)<\/span>)/i
        );
        const rawText = stripHtmlTags(textM?.[1] || textM?.[2] || textM?.[3] || '').replace(/\s+/g, ' ').trim();
        const canonical = matchCanonicalSize(rawText);
        if (canonical) {
          addSizeAsinCandidate(canonical, liAsin, true);
        }
      }
    }

    if (dimensionValuesDisplayData && Array.isArray(dimensions) && availableSizes.length > 0) {
      const sIdx = sizeDimKey ? dimensions.indexOf(sizeDimKey) : -1;
      const cIdx = colorDimKey ? dimensions.indexOf(colorDimKey) : -1;
      const activeColorNorm = color?.trim().toLowerCase() || '';
      if (sIdx !== -1) {
        for (const [candAsin, tuple] of Object.entries(dimensionValuesDisplayData)) {
          if (!Array.isArray(tuple) || typeof tuple[sIdx] !== 'string') continue;
          const rawSz = stripHtmlTags(tuple[sIdx]).replace(/\s+/g, ' ').trim();
          const canonical = matchCanonicalSize(rawSz);
          if (!canonical) continue;
          const rawCol =
            cIdx !== -1 && typeof tuple[cIdx] === 'string'
              ? stripHtmlTags(tuple[cIdx]).replace(/\s+/g, ' ').trim().toLowerCase()
              : '';
          const isSameColor = Boolean(activeColorNorm && rawCol === activeColorNorm);
          addSizeAsinCandidate(canonical, candAsin, isSameColor);
        }
      }
    }

    const colorAsinCandidates: Record<string, string> = {};
    if (mobileDimsToAsin && Array.isArray(dimensions) && variationValues) {
      const sIdx = sizeDimKey ? dimensions.indexOf(sizeDimKey) : -1;
      const cIdx = colorDimKey ? dimensions.indexOf(colorDimKey) : -1;
      const sizeArr =
        sIdx !== -1 && sizeDimKey && Array.isArray(variationValues[sizeDimKey])
          ? (variationValues[sizeDimKey] as unknown[])
          : [];
      const colorArr =
        cIdx !== -1 && colorDimKey && Array.isArray(variationValues[colorDimKey])
          ? (variationValues[colorDimKey] as unknown[])
          : [];
      const activeColorNorm = color?.trim().toLowerCase() || '';
      const activeSizeCompact = size?.trim().toLowerCase().replace(/\s+/g, '') || '';

      for (const [dimTupleKey, candAsin] of Object.entries(mobileDimsToAsin)) {
        if (typeof candAsin !== 'string' || !/^[A-Z0-9]{10}$/i.test(candAsin)) continue;
        const parts = dimTupleKey.split(':').map((n) => Number.parseInt(n, 10));
        const rawColorVal = cIdx !== -1 && Number.isInteger(parts[cIdx]) ? colorArr[parts[cIdx]] : undefined;
        const colRaw =
          typeof rawColorVal === 'string'
            ? stripHtmlTags(rawColorVal).replace(/\s+/g, ' ').trim()
            : '';
        const rawSizeVal = sIdx !== -1 && Number.isInteger(parts[sIdx]) ? sizeArr[parts[sIdx]] : undefined;
        const szRaw =
          typeof rawSizeVal === 'string'
            ? stripHtmlTags(rawSizeVal).replace(/\s+/g, ' ').trim()
            : '';

        if (szRaw) {
          const canonicalSz = matchCanonicalSize(szRaw) || szRaw;
          const isSameColor = Boolean(activeColorNorm && colRaw.toLowerCase() === activeColorNorm);
          addSizeAsinCandidate(canonicalSz, candAsin, isSameColor);
        }
        if (colRaw) {
          const canonicalCol =
            availableColors.find((c) => c.trim().toLowerCase() === colRaw.toLowerCase()) || colRaw;
          const isSameSize = Boolean(
            activeSizeCompact && szRaw.toLowerCase().replace(/\s+/g, '') === activeSizeCompact
          );
          if (!colorAsinCandidates[canonicalCol] || isSameSize) {
            colorAsinCandidates[canonicalCol] = candAsin.toUpperCase();
          }
        }
      }
    }

    if (
      dimensionValuesDisplayData &&
      Array.isArray(dimensions) &&
      availableColors.length > 0 &&
      Object.keys(colorAsinCandidates).length === 0
    ) {
      const cIdx = colorDimKey ? dimensions.indexOf(colorDimKey) : -1;
      const sIdx = sizeDimKey ? dimensions.indexOf(sizeDimKey) : -1;
      const activeSizeCompact = size?.trim().toLowerCase().replace(/\s+/g, '') || '';
      if (cIdx !== -1) {
        for (const [candAsin, tuple] of Object.entries(dimensionValuesDisplayData)) {
          if (!Array.isArray(tuple) || typeof tuple[cIdx] !== 'string' || !/^[A-Z0-9]{10}$/i.test(candAsin)) {
            continue;
          }
          const rawCol = stripHtmlTags(tuple[cIdx]).replace(/\s+/g, ' ').trim();
          const canonicalCol =
            availableColors.find((c) => c.trim().toLowerCase() === rawCol.toLowerCase()) || rawCol;
          const rawSz =
            sIdx !== -1 && typeof tuple[sIdx] === 'string'
              ? stripHtmlTags(tuple[sIdx]).trim().toLowerCase().replace(/\s+/g, '')
              : '';
          const isSameSize = Boolean(activeSizeCompact && rawSz === activeSizeCompact);
          if (!colorAsinCandidates[canonicalCol] || isSameSize) {
            colorAsinCandidates[canonicalCol] = candAsin.toUpperCase();
          }
        }
      }
    }

    return {
      title,
      brand,
      imageUrl,
      priceEur,
      color,
      availableColors,
      colorImages,
      size,
      availableSizes,
      sizeAsinCandidates,
      colorAsinCandidates,
      model,
      specsList,
      bullets,
    };
  }

  interface InspectedDocumentDto {
    title: string;
    url: string;
    kind: 'manuale' | 'scheda' | 'bim_3d' | 'certificato';
    isOlderVersion?: boolean;
    updatedDate?: string;
  }

  function parseDocVersionDateServer(
    updatedRaw?: string,
    title?: string,
    url?: string
  ): { ts: number; formattedDate: string } {
    if (updatedRaw) {
      const isoMatch = updatedRaw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (isoMatch) {
        const y = Number(isoMatch[1]);
        const m = Number(isoMatch[2]);
        const d = Number(isoMatch[3]);
        const parsed = Date.parse(updatedRaw.replace(' ', 'T'));
        const ts = Number.isFinite(parsed) ? parsed : Date.UTC(y, m - 1, d);
        return {
          ts,
          formattedDate: `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`,
        };
      }
      const dmyMatch = updatedRaw.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
      if (dmyMatch) {
        return {
          ts: Date.UTC(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1])),
          formattedDate: `${dmyMatch[1]}/${dmyMatch[2]}/${dmyMatch[3]}`,
        };
      }
    }
    if (title) {
      const titleDate = title.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);
      if (titleDate) {
        return {
          ts: Date.UTC(Number(titleDate[3]), Number(titleDate[2]) - 1, Number(titleDate[1])),
          formattedDate: `${titleDate[1]}/${titleDate[2]}/${titleDate[3]}`,
        };
      }
    }
    if (url) {
      const mmoUnix = url.match(/mmo_\d+_(\d{10})_/i);
      if (mmoUnix?.[1]) {
        const sec = Number(mmoUnix[1]);
        if (Number.isFinite(sec) && sec > 1_000_000_000) {
          const dt = new Date(sec * 1000);
          const dd = String(dt.getUTCDate()).padStart(2, '0');
          const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
          const yyyy = dt.getUTCFullYear();
          return { ts: sec * 1000, formattedDate: `${dd}/${mm}/${yyyy}` };
        }
      }
    }
    return { ts: 0, formattedDate: '' };
  }

  function normalizeDocBaseTitleServer(title: string): string {
    return title
      .replace(/\s*\(\d{2}\/\d{2}\/\d{4}\)\s*/g, ' ')
      .replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*/g, ' ')
      .replace(/\s*\(\d+\)\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function markOlderDocumentVersionsServer(
    docs: InspectedDocumentDto[]
  ): InspectedDocumentDto[] {
    if (docs.length <= 1) return docs;
    const annotated = docs.map((doc) => {
      const baseKey = normalizeDocBaseTitleServer(doc.title);
      const parsed = parseDocVersionDateServer(doc.updatedDate, doc.title, doc.url);
      return { doc, baseKey, ts: parsed.ts, formattedDate: parsed.formattedDate };
    });

    const maxTsByBase = new Map<string, number>();
    const distinctTsByBase = new Map<string, Set<number>>();
    for (const item of annotated) {
      if (!item.baseKey || item.ts <= 0) continue;
      const prevMax = maxTsByBase.get(item.baseKey) ?? 0;
      if (item.ts > prevMax) maxTsByBase.set(item.baseKey, item.ts);
      let set = distinctTsByBase.get(item.baseKey);
      if (!set) {
        set = new Set<number>();
        distinctTsByBase.set(item.baseKey, set);
      }
      set.add(item.ts);
    }

    const marked = annotated.map(({ doc, baseKey, ts, formattedDate }) => {
      const maxTs = maxTsByBase.get(baseKey) ?? 0;
      const distinctDates = distinctTsByBase.get(baseKey)?.size ?? 0;
      const isOlder =
        Boolean(doc.isOlderVersion) ||
        (distinctDates >= 2 && ts > 0 && maxTs > 0 && ts < maxTs);
      return {
        ...doc,
        ...(formattedDate && !doc.updatedDate ? { updatedDate: formattedDate } : {}),
        isOlderVersion: isOlder,
      };
    });

    return [
      ...marked.filter((d) => !d.isOlderVersion),
      ...marked.filter((d) => Boolean(d.isOlderVersion)),
    ];
  }

  function inferDocumentKind(text: string, url: string): InspectedDocumentDto['kind'] {
    const hay = `${text} ${url}`.toLowerCase();
    if (/(?:\bbim\b|\b3d\b|\bcad\b|\bdwg\b|\bdxf\b|\brfa\b|\bifc\b|\bstep\b|\bstp\b|\.obj\b|\bobj\b|modello\s*3d)/.test(hay)) {
      return 'bim_3d';
    }
    if (/(certificat|garanzia|etichetta|energy|energetic|conformit|\bce\b)/.test(hay)) {
      return 'certificato';
    }
    if (/(scheda\s*(?:prodotto|tecnica)|datasheet|data\s*sheet|brochure|volantino|product\s*fiche|\bfiche\b)/.test(hay)) {
      return 'scheda';
    }
    return 'manuale';
  }

  function extractDocumentLinksFromHtml(html: string, baseUrl: string): InspectedDocumentDto[] {
    const out: InspectedDocumentDto[] = [];
    const seenUrls = new Set<string>();
    const mainHtml = html
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

    const addCandidate = (rawHref: string, rawText: string) => {
      if (out.length >= 8) return;
      const trimmed = (rawHref || '').trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:')) {
        return;
      }
      let resolvedUrl: string;
      try {
        const u = new URL(decodeHtmlEntities(trimmed), baseUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
        if (isPrivateOrLocalHostname(u.hostname)) return;
        resolvedUrl = u.toString().slice(0, 1000);
      } catch {
        return;
      }
      const normKey = resolvedUrl.split('#')[0].toLowerCase();
      if (seenUrls.has(normKey)) return;

      const cleanText = stripHtmlTags(rawText || '').replace(/\s+/g, ' ').trim();
      const lowerUrl = resolvedUrl.toLowerCase();
      const lowerText = cleanText.toLowerCase();

      const hasDocExt = /\.(?:pdf|zip|dwg|dxf|rfa|ifc|step|stp|obj|doc|docx)(?:[?#]|$)/i.test(
        lowerUrl
      );
      const hasDocKeyword =
        /(?:scheda\s*(?:prodotto|tecnica)|istruzioni(?:\s+di\s+montaggio)?|manutenzione|manuale|libretto|bim|file\s*3d|3d\s*[-–/]\s*bim|cad|etichetta\s+energetica|certificat|dichiarazione|technical\s*sheet|datasheet|assembly\s*instructions|maintenance|user\s*guide|download)/i.test(
          `${lowerText} ${lowerUrl}`
        );

      if (!hasDocExt && !hasDocKeyword) return;
      // If it doesn't have a clear file extension, require explicit download path or strong product doc text
      if (
        !hasDocExt &&
        !/(?:download|allegat|pdf|scheda|manual|istruzion|manutenzion|bim|3d|cad|datasheet)/i.test(
          `${lowerText} ${new URL(resolvedUrl).pathname.toLowerCase()}`
        )
      ) {
        return;
      }

      if (
        /(?:privacy|cookie|gdpr|termini|condizioni|terms|policy|newsletter|catalogo[-_ ]generale|listino[-_ ]prezzi|press[-_ ]kit|bilancio|sostenibilit)/i.test(
          `${lowerText} ${lowerUrl}`
        )
      ) {
        return;
      }

      // Skip links that just point back to the HTML page itself or generic page routes without file hints
      const baseNoHash = baseUrl.split('#')[0].toLowerCase();
      if (normKey === baseNoHash) return;

      let title = cleanText;
      if (!title || /^(download|scarica|apri|pdf|clicca qui|vai)$/i.test(title)) {
        const lastSeg = decodeURIComponent(new URL(resolvedUrl).pathname.split('/').pop() || '');
        title = lastSeg.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim();
      }
      if (!title || title.length < 3) title = 'Documento prodotto';
      title = title.slice(0, 80);

      seenUrls.add(normKey);
      out.push({
        title,
        url: resolvedUrl,
        kind: inferDocumentKind(title, resolvedUrl),
      });
    };

    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(mainHtml)) !== null) {
      const attrs = m[1] || '';
      const inner = m[2] || '';
      const hrefM = attrs.match(/\b(?:href|data-href|data-url|data-file)=["']([^"']+)["']/i);
      const titleM = attrs.match(/\b(?:title|aria-label)=["']([^"']+)["']/i);
      if (!hrefM?.[1]) continue;

      const cleanInner = stripHtmlTags(inner).replace(/\s+/g, ' ').trim();
      let cleanAttrLabel = titleM?.[1]
        ? decodeHtmlEntities(titleM[1])
            .replace(/\s*\((?:si\s+apre\s+in\s+una\s+nuova\s+scheda|opens\s+in\s+(?:a\s+)?new\s+tab|pdf[^)]*)\)\s*$/i, '')
            .replace(/\s+/g, ' ')
            .trim()
        : '';

      // If aria-label has "Product Name - Document Type", keep the descriptive Document Type
      if (cleanAttrLabel && cleanInner) {
        const dashSplit = cleanAttrLabel.split(/\s+[-–|]\s+/);
        if (dashSplit.length >= 2 && dashSplit[dashSplit.length - 1].length >= 4) {
          cleanAttrLabel = dashSplit[dashSplit.length - 1].trim();
        }
      }

      // Check immediately preceding heading (e.g. <h4>Istruzioni di montaggio</h4>)
      const beforeSlice = mainHtml.slice(Math.max(0, m.index - 450), m.index);
      const headingBeforeM = beforeSlice.match(/<h[2-5][^>]*>([\s\S]{3,160})<\/h[2-5]>\s*$/i);
      const headingLabel = headingBeforeM?.[1]
        ? stripHtmlTags(headingBeforeM[1]).replace(/\s+/g, ' ').trim()
        : '';

      let textHint = cleanAttrLabel || headingLabel || cleanInner;
      if (
        cleanInner &&
        cleanAttrLabel &&
        cleanInner.length < 40 &&
        !cleanAttrLabel.toLowerCase().includes(cleanInner.toLowerCase())
      ) {
        textHint = `${cleanAttrLabel} (${cleanInner})`;
      } else if (
        headingLabel &&
        !cleanAttrLabel &&
        cleanInner &&
        !headingLabel.toLowerCase().includes(cleanInner.toLowerCase()) &&
        cleanInner.length < 36
      ) {
        textHint = `${headingLabel} · ${cleanInner}`;
      }
      addCandidate(hrefM[1], textHint);
    }

    // Also inspect direct PDF/BIM URLs embedded inside data attributes or JSON scripts in main body
    const rawDocUrlRe = /["'](https?:\/\/[^"'\s<>]+\.(?:pdf|zip|dwg|dxf|rfa|ifc|step|stp)(?:\?[^"'\s<>]*)?)["']/gi;
    while ((m = rawDocUrlRe.exec(mainHtml)) !== null) {
      addCandidate(m[1], '');
    }

    return out;
  }

  function extractGenericDomDetails(
    html: string,
    finalUrl: string,
    knownColors: string[] = []
  ): {
    specsList: string[];
    bullets: string[];
    documents: InspectedDocumentDto[];
    availableColors: string[];
    colorImages: Record<string, string>;
  } {
    const bodyOnly = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

    const specsList: string[] = [];
    const bullets: string[] = [];
    const seenLabels = new Set<string>();
    const seenBullets = new Set<string>();

    const ignoredLabels = new Set([
      'condividi',
      'share',
      'quantità',
      'qty',
      'prezzo',
      'price',
      'totale',
      'total',
      'menu',
      'cerca',
      'search',
      'cookie',
      'privacy',
      'login',
      'accedi',
      'registrati',
      'carrello',
      'cart',
      'recensione',
      'recensioni',
      'valutazione',
      'rating',
    ]);

    const addSpecPair = (rawLabel: string, rawVal: string) => {
      if (specsList.length >= 16) return;
      const label = stripHtmlTags(rawLabel).replace(/\s+/g, ' ').replace(/[:：]+$/, '').trim();
      const val = stripHtmlTags(rawVal).replace(/\s+/g, ' ').trim();
      if (!label || !val) return;
      if (label.length < 2 || label.length > 52 || val.length > 240) return;
      if (ignoredLabels.has(label.toLowerCase())) return;
      const key = label.toLowerCase();
      if (seenLabels.has(key)) return;
      seenLabels.add(key);
      specsList.push(`${label}: ${val}`);
    };

    const addBulletText = (rawText: string) => {
      if (bullets.length >= 6) return;
      const text = stripHtmlTags(rawText).replace(/\s+/g, ' ').trim();
      if (text.length < 18 || text.length > 480) return;
      if (/(?:cookie|privacy|newsletter|iscriviti|aggiungi al carrello|spedizione gratuita|diritto di recesso|accedi|registrati)/i.test(text)) {
        return;
      }
      const key = text.slice(0, 60).toLowerCase();
      if (seenBullets.has(key)) return;
      seenBullets.add(key);
      bullets.push(truncateAtWordBoundary(text, 440));
    };

    // 1. Definition lists (<dl><dt>...</dt><dd>...</dd></dl>)
    for (const dlMatch of bodyOnly.matchAll(/<dl\b[\s\S]*?<\/dl>/gi)) {
      const pairs = [
        ...dlMatch[0].matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi),
      ];
      for (const p of pairs) {
        addSpecPair(p[1], p[2]);
      }
    }

    // 2. HTML Tables (two-cell rows: th+td or td+td)
    for (const tableMatch of bodyOnly.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
      const rows = [...tableMatch[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const r of rows) {
        const cells = [...r[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)];
        if (cells.length >= 2) {
          addSpecPair(cells[0][1], cells[1][1]);
        }
      }
    }

    // 3. Technical detail / specification sections (headings & containers)
    const sectionHeadingRe =
      /<(?:h[1-6]|div|section|button|summary|p|strong|span)[^>]*(?:id|class)=["'][^"']*(?:spec|tech|detail|dettagl|caratterist|scheda|dimension|misur|feature|descri|info|tab|accordion|product-info)[^"']*["'][^>]*>[\s\S]{0,12000}/gi;
    const textHeadingRe =
      /(?:dettagli\s+tecnici|specifiche\s+tecniche|caratteristiche(?:\s+tecniche)?|scheda\s+tecnica|informazioni\s+prodotto|dimensioni\s+e\s+peso|technical\s+details|specifications)/i;

    const candidateBlocks: string[] = [];
    let hm: RegExpExecArray | null;
    while ((hm = sectionHeadingRe.exec(bodyOnly)) !== null) {
      candidateBlocks.push(hm[0].slice(0, 12000));
      if (candidateBlocks.length >= 8) break;
    }

    const headingMatch = textHeadingRe.exec(bodyOnly);
    if (headingMatch && typeof headingMatch.index === 'number') {
      candidateBlocks.push(bodyOnly.slice(headingMatch.index, headingMatch.index + 14000));
    }

    for (const block of candidateBlocks) {
      // List items inside technical blocks
      for (const liM of block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const liText = stripHtmlTags(liM[1]).replace(/\s+/g, ' ').trim();
        if (!liText) continue;
        const colonIdx = liText.indexOf(':');
        if (colonIdx > 1 && colonIdx < 45 && liText.length < 180) {
          addSpecPair(liText.slice(0, colonIdx), liText.slice(colonIdx + 1));
        } else {
          addBulletText(liText);
        }
      }

      // Nested Label/Value blocks (e.g. <div class="name|description">Altezza in cm</div><div class="value">90</div>)
      for (const pairM of block.matchAll(
        /<div\b[^>]*class=["'][^"']*\b(?:name|description|label|spec-label)\b[^"']*["'][^>]*>([\s\S]{2,260}?)<\/div>\s*<div\b[^>]*class=["'][^"']*\b(?:value|spec-value)\b[^"']*["'][^>]*>([\s\S]{1,220}?)<\/div>/gi
      )) {
        let lbl = stripHtmlTags(pairM[1].replace(/<br\s*\/?>/gi, ' '))
          .replace(/\s+/g, ' ')
          .trim();
        let val = stripHtmlTags(pairM[2].replace(/<br\s*\/?>/gi, ' · '))
          .replace(/\s+/g, ' ')
          .trim();
        const inUnitM = lbl.match(/^(.+?)\s+in\s+(cm|mm|m|kg|g|mc|litri|l)\b$/i);
        if (inUnitM && /^\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?$/.test(val)) {
          lbl = inUnitM[1].trim();
          val = `${val} ${inUnitM[2].toLowerCase()}`;
        }
        addSpecPair(lbl, val);
      }

      // Label/Value pairs inside child divs/spans/p (e.g. <span>Altezza</span><span>90 cm</span>)
      for (const pairM of block.matchAll(
        /<(?:div|p|span|strong|b|td|th)\b[^>]*>([^<]{2,50})<\/(?:div|p|span|strong|b|td|th)>\s*<(?:div|p|span|strong|b|td|dd)\b[^>]*>([^<]{1,140})<\/(?:div|p|span|strong|b|td|dd)>/gi
      )) {
        addSpecPair(pairM[1], pairM[2]);
      }

      // Technical description blocks separated by <br> (e.g. "STRUTTURA: ... <br> CUSCINI: ...")
      for (const descM of block.matchAll(
        /<div\b[^>]*class=["'][^"']*\bdescription\b[^"']*["'][^>]*>([\s\S]{12,1200}?)<\/div>/gi
      )) {
        const lines = descM[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .split(/\n+/)
          .map((l) => stripHtmlTags(l).replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        for (const line of lines) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 1 && colonIdx < 36 && line.length < 280) {
            const rawLbl = line.slice(0, colonIdx).trim();
            const niceLbl =
              rawLbl === rawLbl.toUpperCase() && rawLbl.length > 2
                ? rawLbl.charAt(0).toUpperCase() + rawLbl.slice(1).toLowerCase()
                : rawLbl;
            addSpecPair(niceLbl, line.slice(colonIdx + 1));
          } else if (line.length >= 24 && !seenLabels.has(line.toLowerCase())) {
            addBulletText(line);
          }
        }
      }

      // Informative paragraphs inside technical details section
      for (const pM of block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
        const pText = stripHtmlTags(pM[1]).replace(/\s+/g, ' ').trim();
        if (pText.length >= 24 && pText.length <= 420) {
          addBulletText(pText);
        }
      }
    }

    // 4. General <li> Key: Value fallback if nothing was found inside targeted sections
    if (specsList.length === 0) {
      for (const liM of bodyOnly.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const liText = stripHtmlTags(liM[1]).replace(/\s+/g, ' ').trim();
        const colonIdx = liText.indexOf(':');
        if (colonIdx > 2 && colonIdx < 38 && liText.length < 140) {
          addSpecPair(liText.slice(0, colonIdx), liText.slice(colonIdx + 1));
        }
      }
    }

    const documents = extractDocumentLinksFromHtml(html, finalUrl);

    // 5. Generic per-color variant images (carousel items, color swatches, alt-matched product images)
    const domColors: string[] = [];
    const domColorSeen = new Set<string>();
    const domColorImages: Record<string, string> = {};
    const resolveDomVariantImageUrl = (rawImg?: string): string | undefined => {
      const cleaned = decodeHtmlEntities((rawImg || '').trim());
      if (
        !cleaned ||
        cleaned.startsWith('data:') ||
        cleaned.startsWith('blob:') ||
        /\.svg(?:[?#]|$)/i.test(cleaned) ||
        /(?:placeholder|spinner|loading|blank|spacer|icon_profile)/i.test(cleaned)
      ) {
        return undefined;
      }
      try {
        const resolved = new URL(cleaned, finalUrl);
        if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return undefined;
        return resolved.toString().slice(0, 1000);
      } catch {
        return undefined;
      }
    };
    const recordColorVariantImage = (rawColor: string | undefined, rawImg: string | undefined) => {
      const cleanColor = stripHtmlTags(decodeHtmlEntities(rawColor || ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const cleanImg = resolveDomVariantImageUrl(rawImg);
      if (!cleanColor || cleanColor.length < 2) return;
      const colorLow = cleanColor.toLowerCase();
      if (/^(?:&nbsp;|none|null|undefined|default|cover|main)$/i.test(colorLow)) return;
      if (!domColorSeen.has(colorLow) && domColors.length < 48) {
        domColorSeen.add(colorLow);
        domColors.push(cleanColor);
      }
      if (cleanImg && !domColorImages[cleanColor] && Object.keys(domColorImages).length < 48) {
        domColorImages[cleanColor] = cleanImg;
      }
    };
    const pickBestImgFromTag = (imgTag: string): string | undefined => {
      const attrM = imgTag.match(
        /(?:data-zoom-image|data-large_image|data-hi-res|data-src|data-lazy|data-original|src)=["']([^"']+)["']/i
      );
      const direct = resolveDomVariantImageUrl(attrM?.[1]);
      if (direct) return direct;
      const srcsetM = imgTag.match(/srcset=["']([^"']+)["']/i);
      if (srcsetM?.[1]) {
        const candidates = srcsetM[1]
          .split(',')
          .map((part) => {
            const pieces = part.trim().split(/\s+/);
            const url = pieces[0];
            const width = parseInt(pieces[1] || '0', 10) || 0;
            return { url, width };
          })
          .filter((c) => Boolean(c.url))
          .sort((a, b) => b.width - a.width);
        for (const c of candidates) {
          const resolved = resolveDomVariantImageUrl(c.url);
          if (resolved) return resolved;
        }
      }
      return undefined;
    };

    // 5a. Carousel / variant cards containing an <img> + <div class="color-name">...</div> (e.g. Nardi Outdoor)
    for (const cardM of bodyOnly.matchAll(
      /<div\b[^>]*class=["'][^"']*\bcarousel-item\b[^"']*["'][^>]*>([\s\S]{0,1800}?)(?=<div\b[^>]*class=["'][^"']*\bcarousel-item\b|<\/section>|<\/main>|$)/gi
    )) {
      const chunk = cardM[1];
      const imgTag = chunk.match(/<img\b[^>]*>/i)?.[0];
      if (!imgTag) continue;
      const imgUrl = pickBestImgFromTag(imgTag);
      if (!imgUrl) continue;
      let colorLabel = '';
      const colorNameM = chunk.match(
        /<div\b[^>]*class=["'][^"']*\bcolor-name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
      );
      if (colorNameM?.[1]) {
        colorLabel = colorNameM[1]
          .replace(/<span\b[^>]*class=["'][^"']*\bcolor-code\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ' ')
          .replace(/<br\s*\/?>/gi, ' ');
      } else {
        const dataColM = chunk.match(/data-(?:variant-)?color=["']([^"']+)["']/i);
        if (dataColM?.[1]) colorLabel = dataColM[1];
      }
      if (colorLabel) {
        recordColorVariantImage(colorLabel, imgUrl);
      }
    }

    // 5b. Generic swatch links/buttons/items with explicit color + variant image attributes
    for (const swatchM of bodyOnly.matchAll(
      /<(?:a|button|li|label|div)\b[^>]*?(?:data-(?:variant-)?color|data-swatch-label)=["']([^"']+)["'][^>]*>([\s\S]{0,400}?<\/(?:a|button|li|label|div)>)/gi
    )) {
      const fullTag = swatchM[0];
      const imgAttrM = fullTag.match(
        /data-(?:zoom-image|large_image|image|img|src)=["']([^"']+)["']/i
      );
      const childImgTag = fullTag.match(/<img\b[^>]*>/i)?.[0];
      const imgUrl = imgAttrM?.[1] || (childImgTag ? pickBestImgFromTag(childImgTag) : undefined);
      if (imgUrl) {
        recordColorVariantImage(swatchM[1], imgUrl);
      }
    }

    // 5c. Match remaining knownColors (e.g. from JSON-LD product.color[]) against <img alt="...">
    const mergedKnownColors = normalizeOptionList([...knownColors, ...domColors], 48);
    if (mergedKnownColors.length > 0 && Object.keys(domColorImages).length < mergedKnownColors.length) {
      const sortedKnown = [...mergedKnownColors].sort((a, b) => b.length - a.length);
      for (const imgM of bodyOnly.matchAll(/<img\b[^>]*>/gi)) {
        const tag = imgM[0];
        const altM = tag.match(/alt=["']([^"']+)["']/i);
        if (!altM?.[1]) continue;
        const altClean = decodeHtmlEntities(altM[1]).replace(/\s+/g, ' ').trim();
        if (altClean.length < 3) continue;
        const altLower = altClean.toLowerCase();
        const imgUrl = pickBestImgFromTag(tag);
        if (!imgUrl) continue;
        for (const cand of sortedKnown) {
          if (domColorImages[cand]) continue;
          const candLower = cand.toLowerCase();
          if (candLower.length < 3) continue;
          if (
            altLower === candLower ||
            altLower.endsWith(` ${candLower}`) ||
            altLower.includes(` ${candLower} `)
          ) {
            recordColorVariantImage(cand, imgUrl);
            break;
          }
        }
      }
    }

    return {
      specsList,
      bullets,
      documents,
      availableColors: mergedKnownColors,
      colorImages: domColorImages,
    };
  }

  function isBlockedPageTitle(rawTitle: string): boolean {
    const t = rawTitle.toLowerCase().trim();
    if (!t) return true;
    return (
      t === 'amazon.it' ||
      t === 'amazon.com' ||
      t.includes('403 forbidden') ||
      t.includes('robot check') ||
      t.includes('captcha') ||
      t.includes('just a moment') ||
      t.includes('attention required') ||
      t.includes('access denied') ||
      t.includes('pardon our interruption') ||
      t.includes('verifica di sicurezza') ||
      t.includes('controllo di sicurezza') ||
      t.includes('page not found')
    );
  }

  function isBotChallengeHtml(html: string, status: number): boolean {
    if (status === 403 || status === 429 || status === 503) return true;
    const sample = html.slice(0, 15000).toLowerCase();
    return (
      sample.includes('validatecaptcha') ||
      sample.includes('captcha-delivery.com') ||
      sample.includes('datadome') ||
      sample.includes('please enable js and disable any ad blocker') ||
      sample.includes('cf-challenge') ||
      sample.includes('challenge-platform') ||
      sample.includes('px-captcha') ||
      sample.includes('enable javascript and cookies to continue')
    );
  }

  async function resolveWaybackSnapshotUrl(targetUrl: string): Promise<string | undefined> {
    try {
      const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(targetUrl)}`;
      const resp = await fetch(apiUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(7500),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MyHomeProductInspector/1.0',
        },
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          archived_snapshots?: {
            closest?: { available?: boolean; status?: string; timestamp?: string; url?: string };
          };
        };
        const closest = data?.archived_snapshots?.closest;
        if (
          closest?.available &&
          closest.status === '200' &&
          closest.timestamp &&
          /^\d{8,14}$/.test(closest.timestamp)
        ) {
          return `https://web.archive.org/web/${closest.timestamp}id_/${targetUrl}`;
        }
      }
    } catch {
      // Fall through to Wayback CDX API fallback below
    }
    try {
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
        targetUrl
      )}&output=json&limit=1&filter=statuscode:200&sort=reverse`;
      const cdxResp = await fetch(cdxUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(6500),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MyHomeProductInspector/1.0',
        },
      });
      if (cdxResp.ok) {
        const rows = (await cdxResp.json()) as string[][];
        const ts = Array.isArray(rows) && rows.length > 1 ? String(rows[1]?.[1] || '') : '';
        if (/^\d{8,14}$/.test(ts)) {
          return `https://web.archive.org/web/${ts}id_/${targetUrl}`;
        }
      }
    } catch {
      // ignore Wayback CDX lookup failures
    }
    return undefined;
  }

  async function lookupIcecatProduct(params: {
    brand?: string;
    store?: string;
    model?: string;
    title?: string;
    specs?: string;
    url?: string;
    timeoutMs?: number;
  }): Promise<{
    title?: string;
    brand?: string;
    model?: string;
    color?: string;
    imageUrl?: string;
    specs?: string;
    documents?: InspectedDocumentDto[];
  } | null> {
    const cleanText = `${params.title || ''} ${params.specs || ''} ${params.url || ''}`;
    const eanMatch = cleanText.match(/\b(\d{13})\b/);
    const ean = eanMatch?.[1];

    const brandCandidates: string[] = [];
    const pushBrand = (b?: string) => {
      const t = (b || '').trim();
      if (t && !brandCandidates.some((x) => x.toLowerCase() === t.toLowerCase())) {
        brandCandidates.push(t);
      }
    };
    const baseBrand = (params.brand || '').trim() || (params.store || '').trim();
    if (/electrolux/i.test(baseBrand) || /electrolux\./i.test(params.url || '')) {
      pushBrand('AEG');
      pushBrand('Electrolux');
      pushBrand('Zanussi');
    } else if (/\baeg\b/i.test(baseBrand)) {
      pushBrand('AEG');
      pushBrand('Electrolux');
    } else if (/bosch/i.test(baseBrand)) {
      pushBrand('Bosch');
      pushBrand('Siemens');
    } else if (/whirlpool|hotpoint|indesit/i.test(baseBrand)) {
      pushBrand(baseBrand);
      pushBrand('Whirlpool');
      pushBrand('Hotpoint');
    } else if (
      baseBrand &&
      !/^(amazon|ebay|mediaworld|unieuro|euronics|google)$/i.test(baseBrand)
    ) {
      pushBrand(baseBrand);
    }

    const codeCandidates: string[] = [];
    const pushCode = (c?: string) => {
      const t = (c || '').trim();
      if (t && t.length >= 4 && !/^B0[A-Z0-9]{8}$/i.test(t) && !codeCandidates.includes(t)) {
        codeCandidates.push(t);
      }
    };
    if (params.model) {
      const rawModel = params.model.trim();
      if (/^\d{9}$/.test(rawModel)) {
        pushCode(`${rawModel.slice(0, 3)} ${rawModel.slice(3, 6)} ${rawModel.slice(6, 9)}`);
      }
      pushCode(rawModel);
    }
    const titleCodeMatch = (params.title || '').match(/\b([A-Z]{2,}[0-9][A-Z0-9-]{2,})\b/);
    if (titleCodeMatch?.[1]) {
      pushCode(titleCodeMatch[1]);
    }

    const lookupUrls: string[] = [];
    if (ean) {
      lookupUrls.push(
        `https://live.icecat.biz/api/?UserName=openIcecat-live&Language=it&GTIN=${encodeURIComponent(ean)}`
      );
    }
    for (const b of brandCandidates.slice(0, 3)) {
      for (const c of codeCandidates.slice(0, 2)) {
        if (lookupUrls.length >= 6) break;
        lookupUrls.push(
          `https://live.icecat.biz/api/?UserName=openIcecat-live&Language=it&Brand=${encodeURIComponent(b)}&ProductCode=${encodeURIComponent(c)}`
        );
      }
    }

    if (lookupUrls.length === 0) return null;

    const timeoutMs = Math.max(2000, Math.min(5000, params.timeoutMs ?? 4500));

    type IcecatApiResponse = {
      msg?: string;
      data?: {
        GeneralInfo?: {
          Title?: string;
          Brand?: string;
          ProductName?: string;
          BrandPartCode?: string;
          GTIN?: string[];
          Description?: {
            ManualPDFURL?: string;
            LeafletPDFURL?: string;
          };
          BulletPoints?: {
            Values?: string[];
          };
        };
        Image?: {
          HighPic?: string;
          Pic500x500?: string;
        };
        Gallery?: Array<{ Pic?: string; Pic500x500?: string }>;
        Multimedia?: Array<{
          Description?: string;
          URL?: string;
          ContentType?: string;
          Updated?: string;
        }>;
        FeaturesGroups?: Array<{
          FeatureGroup?: { Name?: { Value?: string } };
          Features?: Array<{
            Feature?: { Name?: { Value?: string } };
            PresentationValue?: string;
          }>;
        }>;
      };
    };

    try {
      const results = await Promise.allSettled(
        lookupUrls.map(async (u) => {
          const resp = await fetch(u, {
            method: 'GET',
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              Accept: 'application/json',
              'User-Agent': 'MyHomeProductInspector/1.0',
            },
          });
          if (!resp.ok) return null;
          const json = (await resp.json()) as IcecatApiResponse;
          if (json?.msg === 'OK' && json.data?.GeneralInfo?.Title) {
            return json.data;
          }
          return null;
        })
      );

      const hit = results.find(
        (r): r is PromiseFulfilledResult<NonNullable<IcecatApiResponse['data']>> =>
          r.status === 'fulfilled' && Boolean(r.value)
      )?.value;
      if (!hit || !hit.GeneralInfo) return null;

      const gi = hit.GeneralInfo;
      const icTitle = (gi.Title || '').replace(/\s+/g, ' ').trim().slice(0, 160) || undefined;
      const icBrand = (gi.Brand || '').trim().slice(0, 60) || undefined;
      const prodCodeToken = (gi.ProductName || '').trim().split(/\s+/)[0];
      const partCode = (gi.BrandPartCode || '').trim();
      const icModel =
        prodCodeToken && /^[A-Z0-9-]{4,}$/i.test(prodCodeToken) && partCode && prodCodeToken !== partCode
          ? `${prodCodeToken} (${partCode})`.slice(0, 80)
          : (partCode || prodCodeToken || '').slice(0, 80) || undefined;

      const rawImg =
        hit.Image?.HighPic ||
        hit.Image?.Pic500x500 ||
        hit.Gallery?.[0]?.Pic ||
        hit.Gallery?.[0]?.Pic500x500;
      const icImage = rawImg && /^https?:\/\/.+/.test(rawImg) ? rawImg.slice(0, 1000) : undefined;

      const orderedSpecs: string[] = [];
      const seenSpecLabels = new Set<string>();
      const pushSpec = (label: string, value: string) => {
        const cleanL = decodeHtmlEntities(stripHtmlTags(label)).replace(/\s+/g, ' ').trim();
        const cleanV = decodeHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, ' ').trim();
        if (!cleanL || !cleanV) return;
        const key = cleanL.toLowerCase();
        if (seenSpecLabels.has(key)) return;
        seenSpecLabels.add(key);
        orderedSpecs.push(`${cleanL}: ${cleanV}`);
      };

      // Keep URL-extracted metadata (e.g. Codice PNC, Matricola, ELC) at top
      if (params.specs) {
        for (const line of params.specs.split('\n')) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            pushSpec(line.slice(0, idx), line.slice(idx + 1));
          }
        }
      }
      if (partCode && !seenSpecLabels.has('codice pnc') && !seenSpecLabels.has('codice articolo')) {
        pushSpec('Codice prodotto', partCode);
      }
      if (Array.isArray(gi.GTIN) && gi.GTIN[0]) {
        pushSpec('Codice EAN', gi.GTIN[0]);
      }

      let icColor: string | undefined;
      const groupPriority = (groupName: string): number => {
        const g = groupName.toLowerCase();
        if (/dimensioni|peso/.test(g)) return 0;
        if (/energetic|potenza|alimentazione/.test(g)) return 1;
        if (/prestazion/.test(g)) return 2;
        if (/caratteristiche/.test(g)) return 3;
        if (/design/.test(g)) return 4;
        if (/ergonomia|tecnici/.test(g)) return 5;
        return 6;
      };

      const sortedGroups = [...(hit.FeaturesGroups || [])].sort(
        (a, b) =>
          groupPriority(a.FeatureGroup?.Name?.Value || '') -
          groupPriority(b.FeatureGroup?.Name?.Value || '')
      );

      for (const fg of sortedGroups) {
        for (const f of fg.Features || []) {
          const fname = (f.Feature?.Name?.Value || '').trim();
          const fval = (f.PresentationValue || '').trim();
          if (!icColor && /^colore del prodotto$/i.test(fname) && fval) {
            icColor = fval.slice(0, 60);
          }
        }
      }

      for (const fg of sortedGroups) {
        const groupName = (fg.FeatureGroup?.Name?.Value || '').toLowerCase();
        if (/imballaggio|logistici/.test(groupName)) continue;
        for (const f of fg.Features || []) {
          const fname = f.Feature?.Name?.Value || '';
          const fval = f.PresentationValue || '';
          if (!fname || !fval) continue;
          if (/^(scala di efficienza|indice di efficienza|efficacia del risciacquo|certificazione|certificati|consumi \(modalità|partenza ritardata)/i.test(fname.trim())) {
            continue;
          }
          pushSpec(fname, fval);
          if (orderedSpecs.length >= 28) break;
        }
        if (orderedSpecs.length >= 28) break;
      }

      const rawBullets = (gi.BulletPoints?.Values || [])
        .map((b) => decodeHtmlEntities(stripHtmlTags(b)).replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim())
        .filter((b) => b.length >= 12);

      const icSpecs =
        orderedSpecs.length > 0 || rawBullets.length > 0
          ? buildBoundedSpecsText(orderedSpecs, rawBullets, 1850)
          : undefined;

      const icDocs: InspectedDocumentDto[] = [];
      const seenDocUrls = new Set<string>();
      const pushDoc = (docTitle: string, docUrl?: string, updatedDate?: string) => {
        const cleanU = (docUrl || '').trim();
        if (!cleanU || !/^https?:\/\/.+/i.test(cleanU)) return;
        let parsedU: URL;
        try {
          parsedU = new URL(cleanU);
        } catch {
          return;
        }
        if (isPrivateOrLocalHostname(parsedU.hostname)) return;
        const norm = cleanU.split('#')[0].toLowerCase();
        if (seenDocUrls.has(norm)) return;
        seenDocUrls.add(norm);
        const cleanTitle = decodeHtmlEntities(stripHtmlTags(docTitle || 'Documento prodotto'))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
        icDocs.push({
          title: cleanTitle || 'Documento prodotto',
          url: cleanU.slice(0, 1000),
          kind: inferDocumentKind(cleanTitle, cleanU),
          ...(updatedDate ? { updatedDate } : {}),
        });
      };

      const pdfMedia = (hit.Multimedia || []).filter((m) => {
        const ct = (m.ContentType || '').toLowerCase();
        return ct === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(m.URL || '');
      });
      const baseTitleCounts = new Map<string, number>();
      for (const m of pdfMedia) {
        const key = decodeHtmlEntities(stripHtmlTags(m.Description || 'Documento PDF'))
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        baseTitleCounts.set(key, (baseTitleCounts.get(key) || 0) + 1);
      }

      const usedDocTitles = new Map<string, number>();
      const pushUniqueIcecatDoc = (rawTitle: string, docUrl?: string, updatedRaw?: string) => {
        const baseClean = decodeHtmlEntities(stripHtmlTags(rawTitle || 'Documento prodotto'))
          .replace(/\s+/g, ' ')
          .trim();
        const baseKey = baseClean.toLowerCase();
        const hasDupBase = (baseTitleCounts.get(baseKey) || 0) > 1;
        const parsedDate = parseDocVersionDateServer(updatedRaw, undefined, docUrl);
        const dateSuffix = hasDupBase ? parsedDate.formattedDate : '';
        let candidateTitle = dateSuffix ? `${baseClean} (${dateSuffix})` : baseClean;
        const candKey = candidateTitle.toLowerCase();
        const seenCount = (usedDocTitles.get(candKey) || 0) + 1;
        usedDocTitles.set(candKey, seenCount);
        if (seenCount > 1) {
          candidateTitle = `${candidateTitle} (${seenCount})`;
        }
        pushDoc(candidateTitle, docUrl, parsedDate.formattedDate || undefined);
      };

      for (const m of pdfMedia) {
        pushUniqueIcecatDoc(m.Description || 'Documento PDF', m.URL, m.Updated);
      }
      if (gi.Description?.ManualPDFURL) {
        pushUniqueIcecatDoc("Manuale dell'utente", gi.Description.ManualPDFURL);
      }
      if (gi.Description?.LeafletPDFURL) {
        pushUniqueIcecatDoc('Scheda prodotto / Volantino', gi.Description.LeafletPDFURL);
      }

      const versionedIcDocs = markOlderDocumentVersionsServer(icDocs);

      return {
        title: icTitle,
        brand: icBrand,
        model: icModel,
        color: icColor,
        imageUrl: icImage,
        specs: icSpecs,
        documents: versionedIcDocs.length > 0 ? versionedIcDocs.slice(0, 12) : undefined,
      };
    } catch {
      return null;
    }
  }

  async function fetchViaJinaReader(targetUrl: string, timeoutMs = 6500): Promise<string> {
    try {
      const u = new URL(targetUrl);
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || isPrivateOrLocalHostname(u.hostname)) {
        return '';
      }
      const jinaUrl = `https://r.jina.ai/${u.toString()}`;
      const resp = await fetch(jinaUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(Math.max(1500, timeoutMs)),
        headers: {
          Accept: 'text/plain, text/markdown;q=0.9',
          'User-Agent': 'MyHomeProductInspector/1.0',
        },
      });
      if (!resp.ok) return '';
      const text = (await resp.text()).slice(0, 500_000);
      if (!text || text.length < 80) return '';
      const low = text.slice(0, 2000).toLowerCase();
      if (
        low.includes('403 forbidden') ||
        low.includes('access denied') ||
        low.includes('just a moment') ||
        low.includes('attention required')
      ) {
        return '';
      }
      return text;
    } catch {
      return '';
    }
  }

  function extractDetailsFromJinaMarkdown(
    markdown: string,
    store: string
  ): {
    title?: string;
    brand?: string;
    model?: string;
    imageUrl?: string;
    specsList: string[];
    documents: InspectedDocumentDto[];
  } {
    const cleanMd = markdown.replace(/\r\n?/g, '\n');
    const titleLineM = cleanMd.match(/^Title:\s*(.+)$/m);
    const rawPageTitle = titleLineM?.[1] ? titleLineM[1].replace(/\s+URL Source:.*$/i, '').trim() : '';

    const genericTitles = new Set([
      'il mio prodotto',
      'my product',
      'support',
      'assistenza',
      'home',
      'ricambi',
      'manuali utenti',
      'user manuals',
    ]);

    const bodyStartIdx = cleanMd.indexOf('Markdown Content:');
    const body = bodyStartIdx !== -1 ? cleanMd.slice(bodyStartIdx + 17) : cleanMd;

    const pncM = body.match(/Codice prodotto\s+([0-9][0-9\s]{5,18})/i);
    const cleanPnc = pncM?.[1] ? pncM[1].replace(/\s+/g, '').trim() : '';
    const modelLineM = body.match(/Numero modello\s+([A-Z0-9][A-Z0-9\-_/]{2,30})/i);
    const serialLineM = body.match(/Numero seriale\s+([A-Z0-9\-_]{2,30})/i);
    const mlLineM = body.match(/Codice ML\s+([A-Z0-9\-_]{1,12})/i);

    let extractedModel = modelLineM?.[1]?.trim() || '';
    if (!extractedModel) {
      const preMasterM = body.match(/([A-Z0-9]{5,18})\s*#\s*Padroneggiare/i);
      if (preMasterM?.[1]) extractedModel = preMasterM[1].trim();
    }

    const infoHeaderM = body.match(/##\s*Informazioni sul prodotto\s*\n+([^\n#*[\]]{3,120})/i);
    const preInfoNameM = body.match(/([0-9]{3,4}\s+[A-Za-z0-9®™+.\- ]{3,80}?)\s+Informazioni sul prodotto/i);
    const seriesName = (infoHeaderM?.[1] || preInfoNameM?.[1] || '').replace(/\s+/g, ' ').trim();

    const productSliceStart = Math.max(
      0,
      body.search(/(?:Padroneggiare l'elettrodomestico|services\/eml\/transform|##\s*Informazioni sul prodotto)/i) - 400
    );
    const productSliceEnd = body.search(/##\s*Crea un account|##\s*Questo sito utilizza cookies/i);
    const productSlice =
      productSliceEnd > productSliceStart
        ? body.slice(productSliceStart, productSliceEnd)
        : body.slice(productSliceStart, productSliceStart + 5000);

    let applianceTypeHint: string | undefined;
    if (/(?:before-first-use-wm--wd|washing[-_ ]?machine|lavatric|prosteam)/i.test(productSlice)) {
      applianceTypeHint = 'Lavatrice';
    } else if (/(?:lavasciuga|washer[-_ ]?dryer)/i.test(productSlice)) {
      applianceTypeHint = 'Lavasciuga';
    } else if (/(?:asciugatric|heat-pump-dryer|tumble[-_ ]?dryer)/i.test(productSlice)) {
      applianceTypeHint = 'Asciugatrice';
    } else if (/(?:lavastoviglie|dishwasher)/i.test(productSlice)) {
      applianceTypeHint = 'Lavastoviglie';
    } else if (/(?:frigorifer|frigocongelator|fridge|refrigerator)/i.test(productSlice)) {
      applianceTypeHint = 'Frigorifero';
    } else if (/(?:induzione|induction-hob|piano\s+cottura)/i.test(productSlice)) {
      applianceTypeHint = 'Piano cottura';
    } else if (/(?:forno|ovens?\b)/i.test(productSlice)) {
      applianceTypeHint = 'Forno';
    }

    let title = '';
    if (seriesName && extractedModel) {
      const typePrefix =
        applianceTypeHint && !seriesName.toLowerCase().includes(applianceTypeHint.toLowerCase())
          ? `${applianceTypeHint} `
          : '';
      const brandPrefix =
        store && !seriesName.toLowerCase().includes(store.toLowerCase()) ? `${store} ` : '';
      title = `${typePrefix}${brandPrefix}${seriesName} ${extractedModel}`
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
    } else if (seriesName) {
      title = seriesName.slice(0, 160);
    } else if (rawPageTitle && !genericTitles.has(rawPageTitle.toLowerCase()) && !isBlockedPageTitle(rawPageTitle)) {
      title = rawPageTitle.slice(0, 160);
    } else {
      const h1M = productSlice.match(/^#\s+([^\n]{4,140})$/m);
      if (
        h1M?.[1] &&
        !/^(?:menu|padroneggiare l'elettrodomestico|trova il manuale)/i.test(h1M[1].trim())
      ) {
        title = h1M[1].trim().slice(0, 160);
      }
    }

    let bestImg: string | undefined;
    let bestImgScore = -1;
    for (const imgM of body.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi)) {
      const alt = (imgM[1] || '').trim();
      const rawUrl = (imgM[2] || '').trim();
      if (!rawUrl || /\.(?:svg|ico)(?:[?#]|$)/i.test(rawUrl)) continue;
      if (
        /(?:visa-logo|mastercard|americanexpress|maestro|discover|diners|paypal|geodis|cookielaw|electrolux-logo|aeg-logo|before-first-use|favicon|sprite|spacer|pixel)/i.test(
          rawUrl
        )
      ) {
        continue;
      }
      let score = 0;
      if (/\/services\/eml\/transform\/WS_ZO\//i.test(rawUrl)) score += 12;
      else if (/\/services\/eml\/transform\/WS_TN\//i.test(rawUrl)) score += 5;
      if (/\/(?:media|products?|prodotti|catalog|images?|img|upload|globalassets)\//i.test(rawUrl)) {
        score += 3;
      }
      if (extractedModel && `${alt} ${rawUrl}`.toLowerCase().includes(extractedModel.toLowerCase())) {
        score += 6;
      }
      if (score > bestImgScore) {
        bestImgScore = score;
        bestImg = rawUrl.slice(0, 1000);
      }
    }

    const specsList: string[] = [];
    if (extractedModel) specsList.push(`Numero modello: ${extractedModel}`);
    if (cleanPnc) specsList.push(`Codice PNC: ${cleanPnc}`);
    if (serialLineM?.[1]) specsList.push(`Matricola / Machine No.: ${serialLineM[1].trim()}`);
    if (mlLineM?.[1]) specsList.push(`ELC: ${mlLineM[1].trim()}`);
    if (applianceTypeHint) specsList.push(`Tipo prodotto: ${applianceTypeHint}`);

    const documents: InspectedDocumentDto[] = [];
    const seenDocUrls = new Set<string>();
    for (const linkM of body.matchAll(/\[([^\]]{2,100})\]\((https?:\/\/[^\s)]+)\)/gi)) {
      if (documents.length >= 6) break;
      const linkLabel = linkM[1].replace(/\s+/g, ' ').trim();
      const linkUrl = linkM[2].trim();
      if (!/\.(?:pdf|zip|dwg|dxf|rfa|ifc|step|stp)(?:[?#]|$)/i.test(linkUrl)) continue;
      if (
        /(?:urldefense\.com|protezione\.extra|riparazioni\.a\.prezzo\.fisso|polizza|privacy|cookie|termini|condizioni|terms|policy|newsletter)/i.test(
          `${linkLabel} ${linkUrl}`
        )
      ) {
        continue;
      }
      const norm = linkUrl.split('#')[0].toLowerCase();
      if (seenDocUrls.has(norm)) continue;
      seenDocUrls.add(norm);
      documents.push({
        title: linkLabel.slice(0, 80) || 'Documento prodotto',
        url: linkUrl.slice(0, 1000),
        kind: inferDocumentKind(linkLabel, linkUrl),
      });
    }

    return {
      title: title || undefined,
      brand: store || undefined,
      model: extractedModel || cleanPnc || undefined,
      imageUrl: bestImgScore >= 3 ? bestImg : undefined,
      specsList,
      documents,
    };
  }

  app.post('/api/researches/inspect', async (req, res) => {
    const rawInput = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawInput || rawInput.length > 1000) {
      res.status(400).json({ error: 'Incolla un link prodotto valido (max 1000 caratteri).' });
      return;
    }

    const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(withProtocol);
    } catch {
      res.status(400).json({ error: 'Il link inserito non sembra un URL valido.' });
      return;
    }

    if (
      (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') ||
      isPrivateOrLocalHostname(parsedUrl.hostname)
    ) {
      res.status(400).json({ error: 'URL non consentito.' });
      return;
    }

    const finalUrl = parsedUrl.toString().slice(0, 1000);
    const cacheKey = canonicalInspectCacheKey(parsedUrl);
    const forceRefresh = Boolean(req.body?.refresh);
    const inspectDeadlineMs = Date.now() + 26_500;
    const remainingBudgetMs = () => Math.max(0, inspectDeadlineMs - Date.now());
    const withStepTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const clampedMs = Math.max(500, ms);
        const timer = setTimeout(() => {
          reject(new Error(`Timeout after ${clampedMs}ms (${label})`));
        }, clampedMs);
        promise.then(
          (val) => {
            clearTimeout(timer);
            resolve(val);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    if (!forceRefresh) {
      const cached = inspectCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({ ...cached.data, url: finalUrl });
        return;
      }
    }

    const store = formatStoreFromHostname(parsedUrl.hostname);
    const urlDetails = extractDetailsFromProductUrl(parsedUrl, store);
    const amazonAsin = parsedUrl.hostname.toLowerCase().includes('amazon.')
      ? extractAmazonAsin(parsedUrl)
      : undefined;

    let title = '';
    let brand = '';
    let color = '';
    let availableColors: string[] = [];
    let colorImages: Record<string, string> | undefined;
    let size = '';
    let availableSizes: string[] = [];
    let sizePrices: Record<string, number> | undefined;
    let model = amazonAsin || urlDetails.model || '';
    let imageUrl = '';
    let priceEur: number | undefined;
    let specs = '';
    let notes = '';
    let documents: InspectedDocumentDto[] = [];
    let extractedFrom: 'page-meta' | 'url-slug' = 'url-slug';
    let blockedBySite = false;
    let directSiteHtmlFetched = false;

    const resolvePageImageUrl = (rawImg?: string): string | undefined => {
      const trimmed = (rawImg || '').trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return undefined;
      try {
        const resolved = new URL(trimmed, finalUrl);
        if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return undefined;
        return resolved.toString().slice(0, 1000);
      } catch {
        return undefined;
      }
    };

    const extractFallbackHtmlImage = (candidateHtml: string): string | undefined => {
      const metaCandidates = [
        extractMetaContent(candidateHtml, 'itemprop', 'image'),
        extractMetaContent(candidateHtml, 'name', 'msapplication-TileImage'),
      ];
      const linkImageSrcM = candidateHtml.match(
        /<link[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i
      );
      if (linkImageSrcM?.[1]) metaCandidates.push(decodeHtmlEntities(linkImageSrcM[1]));

      for (const cand of metaCandidates) {
        const resolved = resolvePageImageUrl(cand);
        if (resolved && !/(?:favicon|apple-touch-icon|logo)/i.test(resolved)) {
          return resolved;
        }
      }

      const imgSrcMatches = candidateHtml.matchAll(
        /<(?:img|source)[^>]*(?:src|data-src|data-lazy-src|srcset)=["']([^"']+)["'][^>]*>/gi
      );
      let bestUrl: string | undefined;
      let bestScore = -1;
      for (const m of imgSrcMatches) {
        const rawAttr = decodeHtmlEntities(m[1]).split(',')[0].trim().split(/\s+/)[0];
        const resolved = resolvePageImageUrl(rawAttr);
        if (!resolved) continue;
        if (/\.(?:svg|ico)(?:[?#]|$)/i.test(resolved)) continue;
        if (/(?:favicon|sprite|spacer|pixel|tracking|analytics|cookie|gdpr|flag|icon-16|icon-32)/i.test(resolved)) {
          continue;
        }
        let score = 0;
        if (/\.(?:webp|jpg|jpeg|png|avif)(?:[?#]|$)/i.test(resolved)) score += 3;
        if (/\/(?:media|products?|prodotti|catalogo|upload|images?|img|foto)\//i.test(resolved)) score += 2;
        if (urlDetails.title) {
          const words = urlDetails.title
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
          if (words.some((w) => resolved.toLowerCase().includes(w))) score += 4;
        }
        if (/logo/i.test(resolved)) score -= 4;
        if (score > bestScore) {
          bestScore = score;
          bestUrl = resolved;
        }
      }
      return bestScore >= 2 ? bestUrl : undefined;
    };

    const isTlsChainError = (err: unknown): boolean => {
      const code =
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
        (err as { code?: string })?.code ||
        '';
      return (
        code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
        code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
        code === 'CERT_UNTRUSTED'
      );
    };

    const fetchViaNodeHttp = async (
      targetUrl: string,
      headers: Record<string, string>,
      rejectUnauthorized = true,
      hopsLeft = 4,
      deadlineMs = Date.now() + 9000
    ): Promise<{ status: number; contentType: string; text: string }> => {
      const remaining = deadlineMs - Date.now();
      if (remaining <= 200) {
        throw new Error('Request deadline exceeded');
      }
      const u = new URL(targetUrl);
      const client = u.protocol === 'https:' ? https : http;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finishResolve = (val: { status: number; contentType: string; text: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          resolve(val);
        };
        const finishReject = (err: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          reject(err);
        };
        const reqTimeoutMs = Math.max(500, Math.min(9000, remaining));
        const req = client.request(
          u,
          {
            method: 'GET',
            headers,
            timeout: reqTimeoutMs,
            ...(u.protocol === 'https:' ? { rejectUnauthorized } : {}),
          },
          (resp) => {
            const status = resp.statusCode || 0;
            const loc = resp.headers.location;
            if (status >= 300 && status < 400 && loc && hopsLeft > 0) {
              resp.resume();
              try {
                const nextUrl = new URL(loc, u).toString();
                if (!isPrivateOrLocalHostname(new URL(nextUrl).hostname)) {
                  void fetchViaNodeHttp(nextUrl, headers, rejectUnauthorized, hopsLeft - 1, deadlineMs)
                    .then(finishResolve)
                    .catch(finishReject);
                  return;
                }
              } catch {
                // fall through
              }
            }
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            resp.on('data', (chunk: Buffer) => {
              if (totalBytes < 3_000_000) {
                chunks.push(chunk);
                totalBytes += chunk.length;
              }
            });
            resp.on('end', () => {
              finishResolve({
                status,
                contentType: String(resp.headers['content-type'] || '').toLowerCase(),
                text: Buffer.concat(chunks).toString('utf8').slice(0, 3_000_000),
              });
            });
            resp.on('error', finishReject);
          }
        );
        const hardTimer = setTimeout(() => {
          req.destroy(new Error('Request deadline timeout'));
        }, reqTimeoutMs + 300);
        req.on('timeout', () => req.destroy(new Error('Request timeout')));
        req.on('error', finishReject);
        req.end();
      });
    };

    const parseNodeHttpResult = (res: {
      status: number;
      contentType: string;
      text: string;
    }): { html: string; blocked: boolean } => {
      const bodyText = res.contentType.includes('text/html') ? res.text : '';
      const blocked = isBotChallengeHtml(bodyText, res.status);
      if (res.status < 200 || res.status >= 400 || !res.contentType.includes('text/html') || blocked) {
        return { html: '', blocked };
      }
      return { html: bodyText, blocked: false };
    };

    const fetchPageHtml = async (
      targetUrl: string,
      userAgentOverride?: string,
      maxTimeoutMs = 6000
    ): Promise<{ html: string; blocked: boolean }> => {
      const budget = remainingBudgetMs();
      if (budget < 1200) {
        return { html: '', blocked: false };
      }
      const stepTimeoutMs = Math.min(maxTimeoutMs, budget);
      const reqHeaders: Record<string, string> = {
        'User-Agent':
          userAgentOverride ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      };
      try {
        const response = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(stepTimeoutMs),
          headers: reqHeaders,
        });
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const bodyText = contentType.includes('text/html')
          ? (await withStepTimeout(response.text(), stepTimeoutMs, 'response.text')).slice(0, 3_000_000)
          : '';
        const blocked = isBotChallengeHtml(bodyText, response.status);
        if (response.ok && contentType.includes('text/html') && !blocked) {
          return { html: bodyText, blocked: false };
        }
        // Fallback via Node native HTTP/1.1 client when fetch() (undici TLS/ALPN) gets 503/403 bot-challenged
        if ((blocked || response.status === 403 || response.status === 503) && remainingBudgetMs() >= 1800) {
          try {
            const nodeRes = await fetchViaNodeHttp(
              targetUrl,
              reqHeaders,
              true,
              4,
              Date.now() + Math.min(4500, remainingBudgetMs())
            );
            const parsed = parseNodeHttpResult(nodeRes);
            if (parsed.html) return parsed;
          } catch {
            // fall through
          }
        }
        return { html: '', blocked };
      } catch (err) {
        const errName = (err as { name?: string })?.name || '';
        const errMsg = (err as { message?: string })?.message || '';
        const errCode =
          (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
          (err as { code?: string })?.code ||
          '';
        const isTimeout = errName === 'TimeoutError' || /timeout|aborted/i.test(errMsg);
        const shouldTryNodeHttp1 =
          !isTimeout &&
          (isTlsChainError(err) ||
            /HTTP2|ECONNRESET|EPROTO|UND_ERR|fetch failed/i.test(`${errCode} ${errMsg}`));
        if (shouldTryNodeHttp1 && remainingBudgetMs() >= 1800) {
          try {
            const fallbackRes = await fetchViaNodeHttp(
              targetUrl,
              reqHeaders,
              !isTlsChainError(err),
              4,
              Date.now() + Math.min(4500, remainingBudgetMs())
            );
            const parsed = parseNodeHttpResult(fallbackRes);
            if (parsed.html || parsed.blocked) return parsed;
            return { html: '', blocked: true };
          } catch {
            return { html: '', blocked: true };
          }
        }
        // Timeouts / HTTP2 resets / connection drops from WAF tarpits indicate site-level blocking
        return { html: '', blocked: true };
      }
    };

    const hasUsableProductHtml = (candidateHtml: string): boolean => {
      if (!candidateHtml) return false;
      const pageTitle =
        extractMetaContent(candidateHtml, 'property', 'og:title') ||
        (candidateHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
      return !isBlockedPageTitle(pageTitle) || candidateHtml.includes('id="productTitle"');
    };

    try {
      const isKnownSlowSpaSupport = /\/support\/go\b/i.test(parsedUrl.pathname);
      const fetchRes = await fetchPageHtml(finalUrl, undefined, isKnownSlowSpaSupport ? 4000 : 5500);
      if (fetchRes.blocked) blockedBySite = true;
      let html = fetchRes.html;

      if (amazonAsin && !hasUsableProductHtml(html)) {
        const cleanAmazonUrl = `https://${parsedUrl.hostname}/dp/${amazonAsin}?th=1&psc=1`;
        const retryStrategies = [
          {
            url: cleanAmazonUrl,
            ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
          { url: cleanAmazonUrl, ua: 'WhatsApp/2.23.20.0' },
          {
            url: cleanAmazonUrl,
            ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          },
          {
            url: `https://${parsedUrl.hostname}/gp/aw/d/${amazonAsin}?th=1&psc=1`,
            ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
          },
        ];
        for (const strat of retryStrategies) {
          if (remainingBudgetMs() < 3000) break;
          try {
            const retryRes = await fetchPageHtml(strat.url, strat.ua, 6000);
            if (hasUsableProductHtml(retryRes.html)) {
              html = retryRes.html;
              blockedBySite = false;
              break;
            }
          } catch {
            // ignore individual strategy failures
          }
        }
      } else if (!amazonAsin && (blockedBySite || !hasUsableProductHtml(html))) {
        if (remainingBudgetMs() >= 4500) {
          const jinaMd = await fetchViaJinaReader(
            finalUrl,
            Math.min(6500, Math.max(3000, remainingBudgetMs() - 8000))
          );
          if (jinaMd) {
            const jinaData = extractDetailsFromJinaMarkdown(jinaMd, store);
            if (jinaData.title) {
              title = jinaData.title;
              extractedFrom = 'page-meta';
            }
            if (jinaData.brand && !brand) brand = jinaData.brand.slice(0, 60);
            if (jinaData.model) model = jinaData.model.slice(0, 80);
            if (jinaData.imageUrl) imageUrl = jinaData.imageUrl;
            if (jinaData.specsList.length > 0) {
              specs = buildBoundedSpecsText(jinaData.specsList, [], 1850);
            }
            if (jinaData.documents.length > 0) {
              documents = jinaData.documents;
            }
            if (jinaData.title || jinaData.model || jinaData.imageUrl) {
              blockedBySite = false;
            }
          }
        }

        if (!title && !imageUrl && remainingBudgetMs() >= 4500) {
          const wbUrl = await resolveWaybackSnapshotUrl(finalUrl);
          if (wbUrl && remainingBudgetMs() >= 2500) {
            try {
              const wbRes = await fetchPageHtml(wbUrl, undefined, 5500);
              if (hasUsableProductHtml(wbRes.html)) {
                html = wbRes.html;
                blockedBySite = false;
              }
            } catch {
              // ignore Wayback HTML fetch failures
            }
          }
        }
      }

      if (html) {
        directSiteHtmlFetched = true;
        const ld = extractProductFromJsonLd(html);
        const ogTitle =
          extractMetaContent(html, 'property', 'og:title') ||
          extractMetaContent(html, 'name', 'twitter:title');
        const htmlTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const htmlTitle = htmlTitleMatch?.[1] ? decodeHtmlEntities(htmlTitleMatch[1]) : '';
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const h1Title = h1Match?.[1] ? stripHtmlTags(h1Match[1]) : '';

        const amazonDom = parsedUrl.hostname.toLowerCase().includes('amazon.')
          ? extractAmazonDomDetails(html, amazonAsin)
          : null;

        // If Amazon desktop succeeded (image/specs) but price/color/title came back incomplete (e.g. Renewed / multi-seller BuyBox),
        // supplement missing fields from Mobile Amazon BuyBox (/gp/aw/d/{ASIN})
        let mobileDom: ReturnType<typeof extractAmazonDomDetails> | null = null;
        if (
          amazonAsin &&
          (amazonDom?.priceEur === undefined ||
            !amazonDom?.title ||
            !amazonDom?.imageUrl ||
            amazonDom.availableColors.length === 0 ||
            amazonDom.availableSizes.length === 0)
        ) {
          try {
            const mobileRes = await fetchPageHtml(
              `https://${parsedUrl.hostname}/gp/aw/d/${amazonAsin}?th=1&psc=1`,
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
            );
            if (mobileRes.html) {
              mobileDom = extractAmazonDomDetails(mobileRes.html, amazonAsin);
            }
          } catch {
            // ignore mobile fallback failure
          }
        }

        const cleanProductTitle = (rawTitle: string): string => {
          let t = rawTitle
            .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .replace(
              /\s*[:|-]\s*(?:Amazon\.it|Amazon\.com|eBay|MediaWorld|Unieuro|IKEA Italia|Euronics|Electrolux|AEG|Maisons du Monde|Zara Home|Westwing|Kave Home|Sklum)(?:\s*:\s*[^:|]+)?\s*$/i,
              ''
            )
            .trim();

          const colonMatch = t.match(/^(.+?):\s+(.+)$/);
          if (colonMatch) {
            const head = colonMatch[1].trim();
            const tail = colonMatch[2].trim();
            if (
              head.length >= 10 &&
              (tail.length >= 25 ||
                /(?:display|schermo|pollici|chip|processore|batteria|fotocamera|autonomia|promotion|ghz|mhz|ram|ssd|nvme|oled|qled|4k|8k|hdr|bluetooth|wi-?fi|usb|watt|ricaric|compatibil|sbloccato)/i.test(
                  tail
                ))
            ) {
              t = head;
            }
          }

          const pipeIdx = t.indexOf(' | ');
          if (pipeIdx >= 12 && t.length - pipeIdx > 25) {
            t = t.slice(0, pipeIdx).trim();
          }

          return t.slice(0, 160);
        };

        const candidateTitle =
          amazonDom?.title || mobileDom?.title || ld.title || ogTitle || htmlTitle || h1Title;
        if (candidateTitle && !isBlockedPageTitle(candidateTitle)) {
          title = cleanProductTitle(candidateTitle);
          extractedFrom = 'page-meta';
          blockedBySite = false;
        } else if (isBlockedPageTitle(candidateTitle)) {
          blockedBySite = true;
        }

        const rawOgImage =
          amazonDom?.imageUrl ||
          mobileDom?.imageUrl ||
          ld.imageUrl ||
          extractMetaContent(html, 'property', 'og:image') ||
          extractMetaContent(html, 'property', 'og:image:secure_url') ||
          extractMetaContent(html, 'name', 'twitter:image');
        const resolvedOgImage =
          resolvePageImageUrl(rawOgImage) || extractFallbackHtmlImage(html);
        if (resolvedOgImage && !isBlockedPageTitle(candidateTitle)) {
          imageUrl = resolvedOgImage;
        }

        const itemPropPriceM = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
        priceEur =
          amazonDom?.priceEur ??
          mobileDom?.priceEur ??
          ld.priceEur ??
          parsePriceNumber(extractMetaContent(html, 'property', 'product:price:amount')) ??
          parsePriceNumber(extractMetaContent(html, 'property', 'og:price:amount')) ??
          parsePriceNumber(itemPropPriceM?.[1]);

        brand = (
          amazonDom?.brand ||
          mobileDom?.brand ||
          ld.brand ||
          extractMetaContent(html, 'property', 'product:brand') ||
          extractMetaContent(html, 'name', 'brand') ||
          ''
        )
          .trim()
          .slice(0, 60);

        const itemPropColorM = html.match(/itemprop=["']color["'][^>]*content=["']([^"']+)["']/i);
        color = (
          amazonDom?.color ||
          mobileDom?.color ||
          ld.color ||
          extractMetaContent(html, 'property', 'product:color') ||
          itemPropColorM?.[1] ||
          ''
        )
          .trim()
          .slice(0, 60);

        availableColors =
          amazonDom?.availableColors.length
            ? amazonDom.availableColors
            : mobileDom?.availableColors.length
              ? mobileDom.availableColors
              : ld.availableColors || [];

        const rawColorImages =
          amazonDom?.colorImages && Object.keys(amazonDom.colorImages).length > 0
            ? amazonDom.colorImages
            : mobileDom?.colorImages && Object.keys(mobileDom.colorImages).length > 0
              ? mobileDom.colorImages
              : ld.colorImages;
        colorImages = sanitizeColorImagesMap(rawColorImages);

        size = (
          amazonDom?.size ||
          mobileDom?.size ||
          ld.size ||
          ''
        )
          .trim()
          .slice(0, 60);

        availableSizes =
          amazonDom?.availableSizes.length
            ? amazonDom.availableSizes
            : mobileDom?.availableSizes.length
              ? mobileDom.availableSizes
              : ld.availableSizes || [];

        const collectedSizePrices: Record<string, number> = {
          ...(ld.sizePrices || {}),
        };
        const resolveCanonicalSizeKey = (rawSz?: string): string | undefined => {
          const trimmed = rawSz?.trim();
          if (!trimmed) return undefined;
          const compact = trimmed.toLowerCase().replace(/\s+/g, '');
          return (
            availableSizes.find((s) => s.trim().toLowerCase().replace(/\s+/g, '') === compact) ||
            trimmed
          );
        };
        const activeSizeKey = resolveCanonicalSizeKey(size);
        if (activeSizeKey && typeof priceEur === 'number') {
          collectedSizePrices[activeSizeKey] = priceEur;
        }

        // Fetch sibling Amazon ASINs (for size prices AND missing color photos) using cached HTML per ASIN
        const siblingDomCache = new Map<
          string,
          { priceEur?: number; imageUrl?: string }
        >();
        const fetchAmazonSiblingDetails = async (candAsin: string) => {
          const upper = candAsin.toUpperCase();
          const cached = siblingDomCache.get(upper);
          if (cached) return cached;
          let sibHtml = '';
          try {
            const sibMobile = await fetchPageHtml(
              `https://${parsedUrl.hostname}/gp/aw/d/${upper}?th=1&psc=1`,
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
            );
            sibHtml = sibMobile.html || '';
            if (!sibHtml || extractAmazonBuyboxPrice(sibHtml) === undefined) {
              const sibDesk = await fetchPageHtml(
                `https://${parsedUrl.hostname}/dp/${upper}?th=1&psc=1`
              );
              if (sibDesk.html && extractAmazonBuyboxPrice(sibDesk.html) !== undefined) {
                sibHtml = sibDesk.html;
              } else if (!sibHtml) {
                sibHtml = sibDesk.html || '';
              }
            }
          } catch {
            // ignore sibling ASIN fetch failures
          }
          const sibDom = sibHtml ? extractAmazonDomDetails(sibHtml, upper) : null;
          const entry = {
            priceEur: sibDom?.priceEur,
            imageUrl: sibDom?.imageUrl,
          };
          siblingDomCache.set(upper, entry);
          return entry;
        };

        const mergedSizeAsins =
          amazonDom?.sizeAsinCandidates && Object.keys(amazonDom.sizeAsinCandidates).length > 0
            ? amazonDom.sizeAsinCandidates
            : mobileDom?.sizeAsinCandidates || {};

        const mergedColorAsins =
          amazonDom?.colorAsinCandidates && Object.keys(amazonDom.colorAsinCandidates).length > 0
            ? amazonDom.colorAsinCandidates
            : mobileDom?.colorAsinCandidates || {};

        const sizeLookupTasks: Array<Promise<void>> = [];
        if (amazonAsin && availableSizes.length > 1 && Object.keys(mergedSizeAsins).length > 0) {
          const sizesToLookup = availableSizes
            .filter((sz) => {
              const compact = sz.trim().toLowerCase().replace(/\s+/g, '');
              const alreadyHas = Object.keys(collectedSizePrices).some(
                (k) => k.trim().toLowerCase().replace(/\s+/g, '') === compact
              );
              return !alreadyHas && (mergedSizeAsins[sz]?.length || 0) > 0;
            })
            .slice(0, 8);

          for (const sz of sizesToLookup) {
            sizeLookupTasks.push(
              (async () => {
                const rawCandidates = mergedSizeAsins[sz] || [];
                const candidates =
                  priceEur === undefined
                    ? rawCandidates.filter((a) => a.toUpperCase() !== amazonAsin.toUpperCase())
                    : rawCandidates;
                const orderedAsins = (candidates.length > 0 ? candidates : rawCandidates).slice(0, 2);
                for (const candAsin of orderedAsins) {
                  if (candAsin.toUpperCase() === amazonAsin.toUpperCase()) continue;
                  const sib = await fetchAmazonSiblingDetails(candAsin);
                  if (typeof sib.priceEur === 'number') {
                    collectedSizePrices[sz] = sib.priceEur;
                    break;
                  }
                }
              })()
            );
          }
        }

        const colorLookupTasks: Array<Promise<void>> = [];
        const collectedColorImages: Record<string, string> = {
          ...(colorImages || {}),
        };
        if (amazonAsin && availableColors.length > 1 && Object.keys(mergedColorAsins).length > 0) {
          const colorsMissingImage = availableColors
            .filter((col) => !collectedColorImages[col] && Boolean(mergedColorAsins[col]))
            .slice(0, 8);
          for (const col of colorsMissingImage) {
            const candAsin = mergedColorAsins[col];
            if (!candAsin || candAsin.toUpperCase() === amazonAsin.toUpperCase()) continue;
            colorLookupTasks.push(
              (async () => {
                const sib = await fetchAmazonSiblingDetails(candAsin);
                if (sib.imageUrl) {
                  collectedColorImages[col] = sib.imageUrl;
                }
              })()
            );
          }
        }

        if ((sizeLookupTasks.length > 0 || colorLookupTasks.length > 0) && remainingBudgetMs() >= 2500) {
          try {
            await withStepTimeout(
              Promise.all([...sizeLookupTasks, ...colorLookupTasks]),
              Math.min(8500, remainingBudgetMs() - 1500),
              'amazon sibling variants'
            );
          } catch {
            // keep partial sibling results collected before timeout
          }
        }
        colorImages = sanitizeColorImagesMap(collectedColorImages);

        sizePrices = sanitizeSizePricesMapServer(collectedSizePrices);
        if (priceEur === undefined && activeSizeKey && sizePrices?.[activeSizeKey] !== undefined) {
          priceEur = sizePrices[activeSizeKey];
        }

        if (amazonDom?.model) {
          model = amazonDom.model;
        } else if (mobileDom?.model) {
          model = mobileDom.model;
        } else if (ld.model) {
          model = ld.model;
        }

        const isAmazonUrl = parsedUrl.hostname.toLowerCase().includes('amazon.');
        const genericDom = !isAmazonUrl
          ? extractGenericDomDetails(html, finalUrl, availableColors)
          : null;

        if (
          !isAmazonUrl &&
          genericDom?.availableColors &&
          genericDom.availableColors.length > availableColors.length
        ) {
          availableColors = genericDom.availableColors;
        }
        if (
          !isAmazonUrl &&
          genericDom?.colorImages &&
          Object.keys(genericDom.colorImages).length > 0
        ) {
          colorImages = sanitizeColorImagesMap({
            ...(colorImages || {}),
            ...genericDom.colorImages,
          });
        }

        const mergedSpecsList = amazonDom?.specsList.length
          ? amazonDom.specsList
          : mobileDom?.specsList.length
            ? mobileDom.specsList
            : genericDom?.specsList.length
              ? genericDom.specsList
              : ld.specsList || [];
        const mergedBullets = amazonDom?.bullets.length
          ? amazonDom.bullets
          : mobileDom?.bullets.length
            ? mobileDom.bullets
            : genericDom?.bullets || [];

        if (genericDom?.documents && genericDom.documents.length > 0) {
          documents = genericDom.documents;
        }

        const metaDesc =
          ld.description ||
          extractMetaContent(html, 'property', 'og:description') ||
          extractMetaContent(html, 'name', 'description');

        if (mergedSpecsList.length > 0 || mergedBullets.length > 0) {
          const descBullet =
            mergedBullets.length === 0 && metaDesc && metaDesc.length > 35
              ? [truncateAtWordBoundary(metaDesc, 380)]
              : mergedBullets;
          specs = buildBoundedSpecsText(mergedSpecsList, descBullet, 1850);
        } else if (metaDesc && !isBlockedPageTitle(candidateTitle)) {
          specs = truncateAtWordBoundary(metaDesc, 1850);
        }
      }
    } catch {
      // Fall back gracefully to online enrichment or URL slug extraction below
    }

    let aiSuggestedRoom: ResearchRoomIdServer | undefined;

    const computeSpecsLookSparse = (candidateSpecs: string): boolean => {
      const nonIdLines = (candidateSpecs || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            Boolean(l) &&
            !/^(?:numero\s+modello|codice\s+(?:prodotto|pnc|articolo|ml)|matricola(?:\s*\/\s*machine\s*no\.)?|elc|numero\s+di\s+serie|tipo\s+prodotto)\s*:/i.test(
              l
            )
        );
      return !candidateSpecs || (!candidateSpecs.includes('\n') && candidateSpecs.length < 130) || nonIdLines.length < 2;
    };

    let specsLookSparse = computeSpecsLookSparse(specs);

    // Public Open Icecat catalog lookup when site is blocked or specs/image/docs are missing
    if (
      (blockedBySite ||
        extractedFrom !== 'page-meta' ||
        !imageUrl ||
        specsLookSparse ||
        documents.length === 0) &&
      remainingBudgetMs() >= 2500
    ) {
      const icecatHit = await lookupIcecatProduct({
        brand,
        store,
        model,
        title: title || urlDetails.title,
        specs: specs || urlDetails.specs,
        url: finalUrl,
        timeoutMs: Math.min(4500, remainingBudgetMs()),
      });
      if (icecatHit) {
        if ((!title || extractedFrom !== 'page-meta') && icecatHit.title) {
          title = icecatHit.title;
          extractedFrom = 'page-meta';
          blockedBySite = false;
        }
        if (icecatHit.brand && (!brand || /^electrolux$/i.test(brand))) {
          brand = icecatHit.brand;
        }
        if (icecatHit.model && (!model || /^\d+$/.test(model.trim()))) {
          model = icecatHit.model;
        }
        if (!color && icecatHit.color) {
          color = icecatHit.color;
        }
        if (!imageUrl && icecatHit.imageUrl) {
          imageUrl = icecatHit.imageUrl;
        }
        if (icecatHit.specs && (specsLookSparse || !specs)) {
          specs = icecatHit.specs;
          if (title) {
            extractedFrom = 'page-meta';
            blockedBySite = false;
          }
        }
        if (icecatHit.documents?.length) {
          const seenIce = new Set(documents.map((d) => d.url.split('#')[0].toLowerCase()));
          const mergedIce = [...icecatHit.documents.filter((d) => !seenIce.has(d.url.split('#')[0].toLowerCase())), ...documents];
          documents = mergedIce.slice(0, 8);
        }
        specsLookSparse = computeSpecsLookSparse(specs);
      }
    }

    const directHtmlUnavailable = blockedBySite || !directSiteHtmlFetched;

    // Online grounding fallback via Gemini when page blocked / JS-rendered / sparse specs / missing docs
    if (
      (blockedBySite ||
        extractedFrom !== 'page-meta' ||
        specsLookSparse ||
        (!priceEur && !color) ||
        documents.length === 0) &&
      getGeminiClient()
    ) {
      try {
        const ai = getGeminiClient();
        if (ai) {
          const cleanQueryBrand =
            brand ||
            inferProductBrandServer({
              title: title || urlDetails.title,
              url: finalUrl,
              store,
              specs,
            }) ||
            store;
          const cleanQueryTitle = (title || urlDetails.title).trim();
          const searchPrompt = [
            `Cerca informazioni reali, dettagli tecnici completi e documenti scaricabili ufficiali sul prodotto:`,
            `URL: ${finalUrl}`,
            amazonAsin ? `ASIN Amazon: ${amazonAsin}` : '',
            model ? `Codice modello / PNC: ${model}` : '',
            cleanQueryTitle ? `Prodotto: ${cleanQueryBrand} ${cleanQueryTitle}`.trim() : '',
            model
              ? `Nota: se l'URL è un link QR/supporto con codice PNC o modello (es. ${model}), cerca il codice esatto "${model}" su Google insieme a ${cleanQueryBrand} / AEG per identificare il marchio commerciale reale, il nome modello completo, immagine prodotto, specifiche tecniche e manuali PDF ufficiali.`
              : '',
            'Usa Google Search (e URL Context se accessibile) e restituisci SOLO un oggetto JSON valido con i campi reali trovati nelle fonti ufficiali/rivenditori (ometti o lascia stringa vuota/null ciò che non trovi):',
            '- title: nome completo del prodotto in italiano (max 160 caratteri)',
            '- brand: marca ufficiale (max 60 caratteri)',
            '- color: colore o finitura selezionata in italiano (max 60 caratteri)',
            '- availableColors: array JSON dei soli colori disponibili per questo prodotto se elencati (es. ["Bianco", "Antracite", "Tortora"])',
            '- size: taglia, taglio memoria o capacità selezionata (max 60 caratteri)',
            '- availableSizes: array JSON delle sole taglie o capacità disponibili',
            '- sizePrices: oggetto JSON mappa taglia -> prezzo in EUR se presenti prezzi diversi per taglia',
            '- model: codice modello o ASIN (max 80 caratteri)',
            '- priceEur: numero prezzo attuale in EUR se chiaramente presente (altrimenti null)',
            '- specs: stringa multilinea (max 1750 caratteri) separando con a capo:\\n  1) prima le specifiche tecniche strutturate nel formato "Etichetta: Valore" includendo tutti i dati reperibili (es. Codice PNC: ..., Dimensioni (AxLxP): ..., Altezza: ..., Larghezza: ..., Profondità: ..., Peso prodotto: ..., Tensione: ..., Frequenza: ..., Potenza: ..., Lunghezza cavo: ..., Capacità: ..., Velocità centrifuga: ..., Classe energetica: ..., Rumorosità: ..., Materiale: ...)\\n  2) poi eventuali informazioni descrittive/punti chiave iniziando ogni riga con "• "',
            '- documents: array JSON (max 6 elementi) dei soli file ufficiali scaricabili trovati sul sito del produttore per questo prodotto (es. Scheda prodotto, Istruzioni di montaggio, Manutenzione prodotto, Manuale d\'uso, File 3D - BIM), ciascuno come {"title":"Scheda prodotto","url":"https://...pdf","kind":"scheda"|"manuale"|"bim_3d"|"certificato"}. Inserisci SOLO URL reali diretti trovati nelle fonti.',
            '- imageUrl: URL pubblico diretto dell\'immagine principale del prodotto se trovato nella fonte (altrimenti null)',
            '- room: ID stanza della casa solo se è evidente e univoca ("cucina", "salone", "bagno1", "bagno2", "stanza_matrimoniale", "stanza_maurizio", "stanza_roberta", "terrazza_ovest", "terrazza_est"), altrimenti null',
          ]
            .filter(Boolean)
            .join('\n');

          let aiRes: { text?: string } | undefined;
          const comboTimeoutMs = Math.min(10_500, remainingBudgetMs());
          if (comboTimeoutMs >= 3000) {
            if (directHtmlUnavailable) {
              aiRes = await withStepTimeout(
                ai.models.generateContent({
                  model: 'gemini-4-hydrogen',
                  contents: searchPrompt,
                  config: {
                    tools: [{ googleSearch: {} }],
                  },
                }),
                comboTimeoutMs,
                'gemini inspect search direct'
              );
            } else {
              try {
                aiRes = await withStepTimeout(
                  ai.models.generateContent({
                    model: 'gemini-4-hydrogen',
                    contents: searchPrompt,
                    config: {
                      tools: [{ googleSearch: {} }, { urlContext: {} }],
                    },
                  }),
                  comboTimeoutMs,
                  'gemini inspect combo'
                );
              } catch (comboErr) {
                if (isQuotaOrRateError(comboErr)) throw comboErr;
                const searchTimeoutMs = Math.min(8500, remainingBudgetMs());
                if (searchTimeoutMs >= 2500) {
                  aiRes = await withStepTimeout(
                    ai.models.generateContent({
                      model: 'gemini-4-hydrogen',
                      contents: searchPrompt,
                      config: {
                        tools: [{ googleSearch: {} }],
                      },
                    }),
                    searchTimeoutMs,
                    'gemini inspect search'
                  );
                }
              }
            }
          }

          const enriched = extractJsonFromText<{
            title?: string;
            brand?: string;
            color?: string;
            availableColors?: string[];
            size?: string;
            availableSizes?: string[];
            sizePrices?: Record<string, number | string>;
            model?: string;
            priceEur?: number | string | null;
            imageUrl?: string | null;
            specs?: string;
            documents?: Array<{ title?: string; url?: string; kind?: string }>;
            room?: string | null;
          }>(aiRes?.text || '');

          if (enriched) {
            if (typeof enriched.title === 'string' && enriched.title.trim()) {
              const aiTitle = enriched.title.trim().slice(0, 160);
              if (
                !title ||
                (aiTitle.length > title.length &&
                  (!model || aiTitle.toLowerCase().includes(model.toLowerCase())))
              ) {
                title = aiTitle;
                extractedFrom = 'page-meta';
              }
            }
            if (!brand && typeof enriched.brand === 'string' && enriched.brand.trim()) {
              brand = enriched.brand.trim().slice(0, 60);
            }
            if (!color && typeof enriched.color === 'string' && enriched.color.trim()) {
              color = enriched.color.trim().slice(0, 60);
            }
            if (availableColors.length === 0 && Array.isArray(enriched.availableColors)) {
              availableColors = normalizeOptionList(enriched.availableColors);
            }
            if (!size && typeof enriched.size === 'string' && enriched.size.trim()) {
              size = enriched.size.trim().slice(0, 60);
            }
            if (availableSizes.length === 0 && Array.isArray(enriched.availableSizes)) {
              availableSizes = normalizeOptionList(enriched.availableSizes);
            }
            if (!sizePrices && enriched.sizePrices) {
              sizePrices = sanitizeSizePricesMapServer(enriched.sizePrices);
            }
            if (!model && typeof enriched.model === 'string' && enriched.model.trim()) {
              model = enriched.model.trim().slice(0, 80);
            }
            if (priceEur === undefined) {
              priceEur = parsePriceNumber(enriched.priceEur);
            }
            if (!imageUrl && typeof enriched.imageUrl === 'string' && enriched.imageUrl.trim()) {
              const resolvedAiImg = resolvePageImageUrl(enriched.imageUrl);
              if (resolvedAiImg) {
                imageUrl = resolvedAiImg;
              }
            }
            if (typeof enriched.specs === 'string' && enriched.specs.trim()) {
              const existingIdLines = (specs || '')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) =>
                  /^(?:numero\s+modello|codice\s+(?:prodotto|pnc|ml)|matricola(?:\s*\/\s*machine\s*no\.)?|elc|numero\s+di\s+serie)\s*:/i.test(
                    l
                  )
                );
              const aiLines = enriched.specs
                .trim()
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean);
              const mergedLines = [...existingIdLines];
              for (const al of aiLines) {
                const lbl = al.split(':')[0]?.trim().toLowerCase();
                if (
                  lbl &&
                  mergedLines.some((ml) => ml.split(':')[0]?.trim().toLowerCase() === lbl)
                ) {
                  continue;
                }
                mergedLines.push(al);
              }
              const mergedSpecs = truncateAtWordBoundary(mergedLines.join('\n'), 1850);
              if (!specs || (specsLookSparse && mergedSpecs.length > specs.length)) {
                specs = mergedSpecs;
                if (title) extractedFrom = 'page-meta';
              }
            }
            if (documents.length < 6 && Array.isArray(enriched.documents)) {
              const seenDocUrls = new Set<string>(
                documents.map((doc) => doc.url.split('#')[0].toLowerCase())
              );
              const validAiDocs: InspectedDocumentDto[] = [];
              for (const d of enriched.documents) {
                if (!d || typeof d.url !== 'string') continue;
                try {
                  const u = new URL(d.url.trim());
                  if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
                  if (isPrivateOrLocalHostname(u.hostname)) continue;
                  const cleanDocUrl = u.toString().slice(0, 1000);
                  const low = cleanDocUrl.split('#')[0].toLowerCase();
                  if (seenDocUrls.has(low)) continue;
                  seenDocUrls.add(low);
                  const docTitle =
                    typeof d.title === 'string' && d.title.trim()
                      ? d.title.trim().slice(0, 80)
                      : 'Documento prodotto';
                  const kind =
                    d.kind === 'scheda' ||
                    d.kind === 'manuale' ||
                    d.kind === 'bim_3d' ||
                    d.kind === 'certificato'
                      ? d.kind
                      : inferDocumentKind(docTitle, cleanDocUrl);
                  validAiDocs.push({ title: docTitle, url: cleanDocUrl, kind });
                  if (documents.length + validAiDocs.length >= 6) break;
                } catch {
                  // skip invalid document URL
                }
              }
              if (validAiDocs.length > 0) {
                documents = [...validAiDocs, ...documents].slice(0, 8);
              }
            }
            if (typeof enriched.room === 'string' && enriched.room.trim()) {
              aiSuggestedRoom = normalizeResearchRoomServer(enriched.room);
            }
          }
        }
      } catch (err) {
        if (isQuotaOrRateError(err)) {
          geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
      }
    }

    if (!title) {
      title = urlDetails.title;
    }
    if (!color && urlDetails.color) {
      color = urlDetails.color;
    }
    if (!specs && urlDetails.specs) {
      specs = urlDetails.specs;
    }
    brand =
      inferProductBrandServer({
        title,
        url: finalUrl,
        store,
        brand,
        specs,
      }) || '';

    const category = inferResearchCategory(`${title} ${brand} ${specs} ${finalUrl}`);
    const deterministicRoom = inferResearchRoomServer({
      title,
      url: finalUrl,
      specs,
      category,
    });
    const isPersonalOrExcludedForRoom =
      category === 'auto' ||
      category === 'abbigliamento' ||
      NON_ROOM_PRODUCT_RE_SERVER.test(`${title} ${extractUrlSlugTextServer(finalUrl)}`);
    const room = deterministicRoom || (!isPersonalOrExcludedForRoom ? aiSuggestedRoom : undefined);

    const payload = {
      url: finalUrl,
      title: title.slice(0, 160),
      store: store.slice(0, 60),
      category,
      room: room || undefined,
      priceEur,
      imageUrl: imageUrl || undefined,
      brand: brand || undefined,
      color: color || undefined,
      availableColors: availableColors.length > 0 ? availableColors.slice(0, 24) : undefined,
      colorImages,
      size: size || undefined,
      availableSizes: availableSizes.length > 0 ? availableSizes.slice(0, 24) : undefined,
      sizePrices,
      model: model || undefined,
      specs: specs || undefined,
      notes: notes || undefined,
      documents:
        documents.length > 0
          ? markOlderDocumentVersionsServer(documents).slice(0, 12)
          : undefined,
      extractedFrom,
      blockedBySite,
      aiKeyMissing: blockedBySite && extractedFrom !== 'page-meta' && !getGeminiClient() ? true : undefined,
    };

    if (extractedFrom === 'page-meta') {
      inspectCache.set(cacheKey, { expiresAt: Date.now() + INSPECT_CACHE_TTL_MS, data: payload });
    }

    res.json(payload);
  });

  app.post('/api/researches/fetch-document', async (req, res) => {
    const rawDocUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const fallbackTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!rawDocUrl || rawDocUrl.length > 1000) {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL documento non valido.' });
      return;
    }
    let parsedDocUrl: URL;
    try {
      parsedDocUrl = new URL(rawDocUrl);
    } catch {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL documento malformato.' });
      return;
    }
    if (
      (parsedDocUrl.protocol !== 'https:' && parsedDocUrl.protocol !== 'http:') ||
      isPrivateOrLocalHostname(parsedDocUrl.hostname)
    ) {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL non consentito.' });
      return;
    }

    const MAX_DOC_BYTES = 6_000_000;
    const reqHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/pdf,application/zip,application/octet-stream,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: `${parsedDocUrl.origin}/`,
    };

    const fetchBinaryWithTlsFallback = async (
      targetUrl: string,
      hopsLeft = 4,
      attemptTimeoutMs = 9500
    ): Promise<{
      status: number;
      contentType: string;
      contentDisposition: string;
      buffer: Buffer;
      tooLarge: boolean;
    }> => {
      try {
        const resp = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(attemptTimeoutMs),
          headers: reqHeaders,
        });
        const contentLen = Number(resp.headers.get('content-length') || 0);
        if (Number.isFinite(contentLen) && contentLen > MAX_DOC_BYTES) {
          return {
            status: resp.status,
            contentType: String(resp.headers.get('content-type') || '').toLowerCase(),
            contentDisposition: String(resp.headers.get('content-disposition') || ''),
            buffer: Buffer.alloc(0),
            tooLarge: true,
          };
        }
        const ab = await resp.arrayBuffer();
        const buf = Buffer.from(ab);
        return {
          status: resp.status,
          contentType: String(resp.headers.get('content-type') || '').toLowerCase(),
          contentDisposition: String(resp.headers.get('content-disposition') || ''),
          buffer: buf,
          tooLarge: buf.length > MAX_DOC_BYTES,
        };
      } catch (err) {
        const code =
          (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
          (err as { code?: string })?.code ||
          '';
        if (
          code !== 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' &&
          code !== 'SELF_SIGNED_CERT_IN_CHAIN' &&
          code !== 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' &&
          code !== 'CERT_UNTRUSTED'
        ) {
          throw err;
        }
        return new Promise((resolve, reject) => {
          let settled = false;
          const u = new URL(targetUrl);
          const client = u.protocol === 'https:' ? https : http;
          let hardTimer: ReturnType<typeof setTimeout> | undefined;
          const finishResolve = (val: {
            status: number;
            contentType: string;
            contentDisposition: string;
            buffer: Buffer;
            tooLarge: boolean;
          }) => {
            if (settled) return;
            settled = true;
            if (hardTimer) clearTimeout(hardTimer);
            resolve(val);
          };
          const finishReject = (err: unknown) => {
            if (settled) return;
            settled = true;
            if (hardTimer) clearTimeout(hardTimer);
            reject(err);
          };
          const r = client.request(
            u,
            {
              method: 'GET',
              headers: reqHeaders,
              timeout: attemptTimeoutMs,
              ...(u.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
            },
            (resp) => {
              const status = resp.statusCode || 0;
              const loc = resp.headers.location;
              if (status >= 300 && status < 400 && loc && hopsLeft > 0) {
                resp.resume();
                try {
                  const nextUrl = new URL(loc, u).toString();
                  if (!isPrivateOrLocalHostname(new URL(nextUrl).hostname)) {
                    void fetchBinaryWithTlsFallback(nextUrl, hopsLeft - 1, attemptTimeoutMs)
                      .then(finishResolve)
                      .catch(finishReject);
                    return;
                  }
                } catch {
                  // fall through
                }
              }
              const chunks: Buffer[] = [];
              let total = 0;
              let tooLarge = false;
              resp.on('data', (chunk: Buffer) => {
                total += chunk.length;
                if (total > MAX_DOC_BYTES) {
                  tooLarge = true;
                  resp.destroy();
                  return;
                }
                chunks.push(chunk);
              });
              resp.on('end', () => {
                finishResolve({
                  status,
                  contentType: String(resp.headers['content-type'] || '').toLowerCase(),
                  contentDisposition: String(resp.headers['content-disposition'] || ''),
                  buffer: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks),
                  tooLarge,
                });
              });
              resp.on('close', () => {
                if (tooLarge) {
                  finishResolve({
                    status,
                    contentType: String(resp.headers['content-type'] || '').toLowerCase(),
                    contentDisposition: String(resp.headers['content-disposition'] || ''),
                    buffer: Buffer.alloc(0),
                    tooLarge: true,
                  });
                }
              });
              resp.on('error', finishReject);
            }
          );
          hardTimer = setTimeout(() => {
            r.destroy(new Error('Document fetch hard timeout'));
          }, Math.max(12500, attemptTimeoutMs + 3000));
          r.on('timeout', () => r.destroy(new Error('Document fetch timeout')));
          r.on('error', finishReject);
          r.end();
        });
      }
    };

    try {
      let result: {
        status: number;
        contentType: string;
        contentDisposition: string;
        buffer: Buffer;
        tooLarge: boolean;
      };
      try {
        result = await fetchBinaryWithTlsFallback(parsedDocUrl.toString(), 4, 8000);
      } catch {
        result = {
          status: 0,
          contentType: '',
          contentDisposition: '',
          buffer: Buffer.alloc(0),
          tooLarge: false,
        };
      }
      if (result.tooLarge) {
        res.status(200).json({ ok: false, reason: 'too_large', url: parsedDocUrl.toString() });
        return;
      }

      const isHtmlResult = (r: typeof result): boolean => {
        const ct = r.contentType.split(';')[0].trim();
        const head = r.buffer.slice(0, 512).toString('utf8').toLowerCase();
        return ct.includes('text/html') || head.includes('<!doctype html') || head.includes('<html');
      };

      if (
        result.status === 0 ||
        result.status === 403 ||
        result.status === 503 ||
        result.status === 429 ||
        result.buffer.length === 0 ||
        isHtmlResult(result)
      ) {
        const wbDocUrl = await resolveWaybackSnapshotUrl(parsedDocUrl.toString());
        if (wbDocUrl) {
          const wbResult = await fetchBinaryWithTlsFallback(wbDocUrl, 4, 14000);
          if (wbResult.tooLarge) {
            res.status(200).json({ ok: false, reason: 'too_large', url: parsedDocUrl.toString() });
            return;
          }
          if (
            wbResult.status >= 200 &&
            wbResult.status < 400 &&
            wbResult.buffer.length > 0 &&
            !isHtmlResult(wbResult)
          ) {
            result = wbResult;
          }
        }
      }

      if (result.status < 200 || result.status >= 400 || result.buffer.length === 0) {
        res.status(200).json({
          ok: false,
          reason: 'blocked',
          status: result.status,
          url: parsedDocUrl.toString(),
        });
        return;
      }

      const cleanContentType = result.contentType.split(';')[0].trim() || 'application/octet-stream';
      if (isHtmlResult(result)) {
        res.status(200).json({ ok: false, reason: 'html_page', url: parsedDocUrl.toString() });
        return;
      }

      const isOpaqueFileName = (candidate: string): boolean => {
        const base = candidate.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
        if (!base || base.length < 3) return true;
        if (/^(?:mmo|doc|file|attachment|download|asset)[_-]?\d[\d_-]*$/i.test(base)) return true;
        if (/^[a-f0-9-]{12,}$/i.test(base)) return true;
        if (/^[a-z]{0,4}[_-]?\d{5,}(?:[_-][a-z0-9]+)*$/i.test(base)) return true;
        if (/^\d[\d_-]*$/.test(base)) return true;
        const letters = (base.match(/[a-zA-Z]/g) || []).length;
        const digits = (base.match(/\d/g) || []).length;
        return digits > letters && digits >= 6;
      };
      const buildReadableBaseFromTitle = (rawTitle: string): string =>
        rawTitle
          .replace(/\//g, '-')
          .replace(/["\r\n\\:?*<>|]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 72);

      let fileName = '';
      let rawExt = '';
      const dispMatch = result.contentDisposition.match(
        /filename\*?=(?:UTF-8''|["']?)([^"';\r\n]+)["']?/i
      );
      if (dispMatch?.[1]) {
        try {
          fileName = decodeURIComponent(dispMatch[1]).trim();
        } catch {
          fileName = dispMatch[1].trim();
        }
      }
      if (!fileName) {
        const seg = decodeURIComponent(parsedDocUrl.pathname.split('/').pop() || '').trim();
        fileName = seg;
      }
      const extMatch = fileName.match(/(\.[a-z0-9]{2,5})$/i);
      if (extMatch?.[1]) {
        rawExt = extMatch[1].toLowerCase();
      } else if (cleanContentType === 'application/pdf') {
        rawExt = '.pdf';
      } else if (cleanContentType.includes('zip')) {
        rawExt = '.zip';
      }

      const readableTitleBase = fallbackTitle ? buildReadableBaseFromTitle(fallbackTitle) : '';
      if ((!fileName || isOpaqueFileName(fileName)) && readableTitleBase.length >= 3) {
        fileName = `${readableTitleBase}${rawExt || '.pdf'}`;
      } else if (!fileName) {
        fileName = `documento${rawExt || '.pdf'}`;
      } else if (!/\.[a-z0-9]{2,5}$/i.test(fileName) && rawExt) {
        fileName += rawExt;
      }
      fileName = fileName.replace(/["\r\n\\/:*?<>|]+/g, '-').slice(0, 120);

      res.setHeader('Content-Type', cleanContentType);
      res.setHeader('X-Document-Filename', encodeURIComponent(fileName));
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.buffer);
    } catch {
      res.status(200).json({ ok: false, reason: 'network_error', url: parsedDocUrl.toString() });
    }
  });

  function classifyDocumentDeterministic(fileName: string, textContent: string, cloudUrl = '') {
    const cleanName = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();
    const hay = `${fileName}\n${cloudUrl}\n${textContent}`.toLowerCase();

    const isOctopusContract =
      hay.includes('octopus') &&
      (hay.includes('condizioni') || hay.includes('contratto') || hay.includes('proposta') || hay.includes('octofix'));

    const isTari =
      hay.includes('tassa sui rifiuti') ||
      hay.includes('tassa rifiuti') ||
      /\btari\b/.test(hay) ||
      hay.includes('tassa_rifiuti');

    const isElecBill =
      !isOctopusContract &&
      (hay.includes('fattura') || hay.includes('bolletta') || hay.includes('totale da pagare') || hay.includes('pod')) &&
      (hay.includes('energia elettrica') || hay.includes('edison energia') || hay.includes('enel energia') || hay.includes('octopus energy') || hay.includes('kwh') || hay.includes('it001e'));

    const isWaterBill =
      (hay.includes('servizio idrico') || hay.includes('acquedotto') || hay.includes('fognatura') || hay.includes('depurazione') || (hay.includes('acegas') && !hay.includes('kwh') && !isTari));

    if (isTari) {
      return {
        target: 'bill_tari' as const,
        confidence: 'alta' as const,
        documentCategory: 'Contratti & Utenze' as const,
        title: cleanName || 'Avviso TARI',
        provider: hay.includes('acegas') ? 'AcegasApsAmga TARI' : 'Comune / TARI',
        notes: 'Riconosciuto automaticamente come avviso TARI.',
        usedAi: false,
      };
    }

    if (isElecBill) {
      let supplier = 'Fornitore Luce';
      if (hay.includes('edison')) supplier = 'Edison Energia';
      else if (hay.includes('octopus')) supplier = 'Octopus Energy';
      else if (hay.includes('enel')) supplier = 'Enel Energia';
      return {
        target: 'bill_luce' as const,
        confidence: 'alta' as const,
        documentCategory: 'Contratti & Utenze' as const,
        title: cleanName || `Bolletta Luce ${supplier}`,
        provider: supplier,
        notes: 'Riconosciuto automaticamente come bolletta energia elettrica.',
        usedAi: false,
      };
    }

    if (isWaterBill) {
      return {
        target: 'bill_acqua' as const,
        confidence: 'alta' as const,
        documentCategory: 'Contratti & Utenze' as const,
        title: cleanName || 'Bolletta Acqua AcegasApsAmga',
        provider: 'AcegasApsAmga',
        notes: 'Riconosciuto automaticamente come bolletta servizio idrico.',
        usedAi: false,
      };
    }

    if (hay.includes('mutuo') || hay.includes('rogito') || hay.includes('catasto') || hay.includes('planimetria') || hay.includes('notaio') || hay.includes('ape ')) {
      return {
        target: 'document' as const,
        confidence: 'media' as const,
        documentCategory: 'Mutuo & Casa' as const,
        title: cleanName || 'Documento Casa / Mutuo',
        provider: hay.includes('intesa') ? 'Intesa Sanpaolo' : hay.includes('unicredit') ? 'UniCredit' : 'Banca / Casa',
        notes: 'Classificato automaticamente in Mutuo & Casa.',
        usedAi: false,
      };
    }

    if (hay.includes('windtre') || hay.includes('fibra') || hay.includes('wi-fi') || hay.includes('wifi') || hay.includes('tim ') || hay.includes('vodafone') || hay.includes('fastweb') || hay.includes('iliad')) {
      const prov = hay.includes('wind')
        ? 'WindTre'
        : hay.includes('vodafone')
          ? 'Vodafone'
          : hay.includes('fastweb')
            ? 'Fastweb'
            : hay.includes('tim')
              ? 'TIM'
              : 'Operatore Internet';
      return {
        target: 'document' as const,
        confidence: 'media' as const,
        documentCategory: 'Internet & Wi-Fi' as const,
        title: cleanName || `Contratto ${prov}`,
        provider: prov,
        notes: 'Classificato automaticamente in Internet & Wi-Fi.',
        usedAi: false,
      };
    }

    if (hay.includes('polizza') || hay.includes('assicuraz') || hay.includes('conte.it') || hay.includes('rca') || hay.includes('sinistr') || hay.includes('garanzia')) {
      return {
        target: 'document' as const,
        confidence: 'media' as const,
        documentCategory: 'Assicurazioni' as const,
        title: cleanName || 'Polizza / Assicurazione',
        provider: hay.includes('conte') ? 'ConTe.it' : 'Compagnia Assicurativa',
        notes: 'Classificato automaticamente in Assicurazioni.',
        usedAi: false,
      };
    }

    if (hay.includes('identit') || hay.includes('codice fiscale') || hay.includes('tessera sanitaria') || hay.includes('patente') || hay.includes('passaporto') || hay.includes('730') || hay.includes('isee') || hay.includes('agenzia delle entrate') || hay.includes('f24')) {
      return {
        target: 'document' as const,
        confidence: 'media' as const,
        documentCategory: 'Fiscale & Identità' as const,
        title: cleanName || 'Documento Fiscale / Identità',
        provider: 'Ente / Famiglia',
        notes: 'Classificato automaticamente in Fiscale & Identità.',
        usedAi: false,
      };
    }

    if (isOctopusContract || hay.includes('contratto') || hay.includes('fornitura') || hay.includes('utenz') || hay.includes('gse')) {
      return {
        target: 'document' as const,
        confidence: 'media' as const,
        documentCategory: 'Contratti & Utenze' as const,
        title: cleanName || 'Contratto Utenza',
        provider: isOctopusContract ? 'Octopus Energy' : hay.includes('gse') ? 'GSE' : 'Fornitore Utenza',
        notes: 'Classificato automaticamente in Contratti & Utenze.',
        usedAi: false,
      };
    }

    return {
      target: 'document' as const,
      confidence: 'bassa' as const,
      documentCategory: 'Altro' as const,
      title: cleanName || 'Documento casa',
      provider: 'Archivio Casa',
      notes: 'Documento generico classificato automaticamente.',
      usedAi: false,
    };
  }

  interface ClassifyProductHint {
    id: string;
    title: string;
    brand?: string;
    model?: string;
    url?: string;
  }

  function inferAttachmentTypeServer(
    hayRaw: string
  ): 'manuale' | 'scontrino_fattura' | 'garanzia_extra_family' | 'targhetta_pnc' | 'altro' {
    const h = hayRaw.toLowerCase();
    if (/scontrin|fattur|ricevut|invoice|receipt|ordine|acquisto/.test(h)) {
      return 'scontrino_fattura';
    }
    if (/garanzi|warranty|estensione|polizza/.test(h)) {
      return 'garanzia_extra_family';
    }
    if (/targhett|pnc\b|etichett|seriale|matricola/.test(h)) {
      return 'targhetta_pnc';
    }
    if (/manual|istruzion|montagg|manutenz|scheda|datasheet|brochure|specif|3d|bim|dwg/.test(h)) {
      return 'manuale';
    }
    return 'altro';
  }

  function matchDocumentProductServer(
    fileName: string,
    cloudUrl: string,
    textContent: string,
    products: ClassifyProductHint[]
  ): ClassifyProductHint | null {
    if (!Array.isArray(products) || products.length === 0) return null;
    const norm = (v: string) =>
      v
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const stopwords = new Set([
      'con', 'per', 'del', 'della', 'dei', 'degli', 'il', 'lo', 'la', 'i', 'gli', 'le',
      'di', 'da', 'in', 'su', 'ed', 'e', 'o', 'a', 'uno', 'una', 'un', 'divano',
      'poltrona', 'sedia', 'tavolo', 'prodotto', 'scheda', 'tecnica', 'manuale',
      'istruzioni', 'montaggio', 'manutenzione', 'documento', 'allegato', 'file',
      'pdf', 'htm', 'html', 'http', 'https', 'www', 'com', 'it', 'outdoor', 'esterno',
      'casa', 'colore', 'nero', 'bianco', 'grigio', 'beige', 'tortora', 'antracite',
    ]);

    const strongChannel = norm(`${fileName} ${cloudUrl}`);
    const bodyChannel = norm(textContent.slice(0, 6000));
    const docUrlClean = cloudUrl.split('#')[0].split('?')[0].toLowerCase();

    let bestProduct: ClassifyProductHint | null = null;
    let bestScore = 0;

    for (const p of products) {
      if (!p.id || !p.title) continue;
      let score = 0;
      const prodUrlClean = (p.url || '').split('#')[0].split('?')[0].toLowerCase();
      if (prodUrlClean && docUrlClean) {
        if (prodUrlClean === docUrlClean) {
          score += 140;
        } else {
          try {
            const pUrl = new URL(prodUrlClean);
            const dUrl = new URL(docUrlClean);
            const pSlug = pUrl.pathname.split('/').filter((s) => s.length >= 5).pop() || '';
            if (pUrl.hostname === dUrl.hostname && pSlug && dUrl.pathname.toLowerCase().includes(pSlug)) {
              score += 100;
            }
          } catch {
            // ignore URL parse
          }
        }
      }

      const brandNorm = norm(p.brand || '');
      const modelNorm = norm(p.model || '');
      const titleTokens = norm(p.title)
        .split(' ')
        .filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !stopwords.has(t));
      const modelTokens = modelNorm
        .split(' ')
        .filter((t) => (t.length >= 2 || /^\d+$/.test(t)) && !stopwords.has(t));
      const distinctiveTokens = Array.from(new Set([...modelTokens, ...titleTokens]));

      if (modelNorm && modelNorm.length >= 3) {
        if (strongChannel.includes(modelNorm)) score += 65;
        else if (bodyChannel.includes(modelNorm)) score += 45;
      }

      let matchedDistinctive = 0;
      for (const tok of distinctiveTokens) {
        if (/^\d{1,2}$/.test(tok) && tok.length < 2 && distinctiveTokens.length > 1) continue;
        const re = new RegExp(`(?:^| )${tok}(?: |$)`);
        if (re.test(strongChannel)) {
          score += tok.length >= 4 ? 32 : 18;
          matchedDistinctive += 1;
        } else if (re.test(bodyChannel)) {
          score += tok.length >= 4 ? 20 : 10;
          matchedDistinctive += 1;
        }
      }

      if (brandNorm && brandNorm.length >= 3 && matchedDistinctive >= 1) {
        const bRe = new RegExp(`(?:^| )${brandNorm}(?: |$)`);
        if (bRe.test(strongChannel)) score += 28;
        else if (bRe.test(bodyChannel)) score += 16;
      }

      if (score > bestScore) {
        bestScore = score;
        bestProduct = p;
      }
    }

    return bestScore >= 55 ? bestProduct : null;
  }

  app.post('/api/documents/inspect-link', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl || rawUrl.length > 1500) {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL non valido.' });
      return;
    }

    let currentUrl: URL;
    try {
      currentUrl = new URL(rawUrl);
    } catch {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL malformato.' });
      return;
    }

    if (
      (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') ||
      isPrivateOrLocalHostname(currentUrl.hostname)
    ) {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'Host URL non consentito.' });
      return;
    }

    try {
      let targetStr = currentUrl.toString();
      let finalResp: Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        const hopUrl = new URL(targetStr);
        if (
          (hopUrl.protocol !== 'http:' && hopUrl.protocol !== 'https:') ||
          isPrivateOrLocalHostname(hopUrl.hostname)
        ) {
          res.status(400).json({ ok: false, reason: 'invalid', error: 'Redirect non consentito.' });
          return;
        }
        const resp = await fetch(targetStr, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get('location');
          if (!loc) {
            finalResp = resp;
            break;
          }
          targetStr = new URL(loc, hopUrl).toString();
          continue;
        }
        finalResp = resp;
        break;
      }

      if (!finalResp || !finalResp.ok) {
        res.status(200).json({
          ok: false,
          reason: 'blocked',
          status: finalResp?.status || 0,
          url: targetStr,
        });
        return;
      }

      const rawText = (await finalResp.text()).slice(0, 250_000);
      const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const ogTitleMatch = rawText.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
      );
      const ogSiteMatch = rawText.match(
        /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i
      );
      const descMatch = rawText.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
      );

      const pageTitle = decodeHtmlEntities(
        stripHtmlTags(ogTitleMatch?.[1] || titleMatch?.[1] || '')
      ).slice(0, 160);
      const siteName = decodeHtmlEntities(
        stripHtmlTags(ogSiteMatch?.[1] || new URL(targetStr).hostname.replace(/^www\./, ''))
      ).slice(0, 80);
      const description = decodeHtmlEntities(stripHtmlTags(descMatch?.[1] || '')).slice(0, 400);

      const cleanBody = rawText
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
      const textSnippet = decodeHtmlEntities(cleanBody).replace(/\s+/g, ' ').trim().slice(0, 10_000);

      res.json({
        ok: true,
        url: targetStr,
        title: pageTitle,
        siteName,
        description,
        textSnippet,
      });
    } catch {
      res.status(200).json({ ok: false, reason: 'network_error', url: currentUrl.toString() });
    }
  });

  app.post('/api/documents/classify', async (req, res) => {
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim().slice(0, 180) : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim().slice(0, 100) : '';
    const cloudUrl = typeof req.body?.cloudUrl === 'string' ? req.body.cloudUrl.trim().slice(0, 1500) : '';
    const textContent =
      typeof req.body?.textContent === 'string' ? req.body.textContent.slice(0, 18_000) : '';
    const rawImageBase64 =
      typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.slice(0, 8_000_000) : '';
    const rawProducts: unknown[] = Array.isArray(req.body?.products)
      ? (req.body.products as unknown[])
      : [];
    const products: ClassifyProductHint[] = rawProducts
      .filter((p: unknown): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
      .slice(0, 40)
      .map((p: Record<string, unknown>): ClassifyProductHint => ({
        id: typeof p.id === 'string' ? p.id.slice(0, 80) : '',
        title: typeof p.title === 'string' ? p.title.slice(0, 120) : '',
        brand: typeof p.brand === 'string' ? p.brand.slice(0, 60) : undefined,
        model: typeof p.model === 'string' ? p.model.slice(0, 80) : undefined,
        url: typeof p.url === 'string' ? p.url.slice(0, 300) : undefined,
      }))
      .filter((p: ClassifyProductHint) => Boolean(p.id && p.title));

    if (!fileName && !cloudUrl) {
      res.status(400).json({ error: 'fileName o cloudUrl obbligatorio.' });
      return;
    }

    const effectiveName = fileName || decodeURIComponent(cloudUrl.split('/').pop() || 'link-documento').slice(0, 140);
    const deterministicProduct = matchDocumentProductServer(effectiveName, cloudUrl, textContent, products);
    const deterministicAttachType = inferAttachmentTypeServer(`${effectiveName}\n${cloudUrl}\n${textContent.slice(0, 3000)}`);
    const baseFallback = classifyDocumentDeterministic(effectiveName, textContent, cloudUrl);
    const fallback = {
      ...baseFallback,
      ...(deterministicProduct
        ? {
            provider: deterministicProduct.brand || baseFallback.provider,
            matchedProductId: deterministicProduct.id,
            attachmentType: deterministicAttachType,
          }
        : {}),
    };
    const ai = getGeminiClient();

    if (!ai || (!textContent.trim() && !rawImageBase64 && !cloudUrl)) {
      res.json(fallback);
      return;
    }

    try {
      const productsPromptList =
        products.length > 0
          ? [
              'Prodotti presenti in archivio Prodotti (se il documento appartiene chiaramente a uno di essi, imposta "matchedProductId" al suo id, altrimenti ""):',
              ...products.map(
                (p) =>
                  `- id="${p.id}" | titolo="${p.title}"${p.brand ? ` | marca="${p.brand}"` : ''}${p.model ? ` | modello="${p.model}"` : ''}`
              ),
            ].join('\n')
          : '';

      const prompt = [
        'Classifica questo documento domestico italiano e restituisci SOLO JSON valido senza testo aggiuntivo.',
        'Valori ammessi per "target":',
        '- "bill_luce": SOLO bolletta/fattura periodica energia elettrica (Edison, Octopus, Enel, ecc.). NON usare per contratti firmati o preventivi.',
        '- "bill_acqua": SOLO bolletta/fattura periodica acqua / servizio idrico (AcegasApsAmga, ecc.).',
        '- "bill_tari": SOLO avviso di pagamento TARI / tassa sui rifiuti.',
        '- "document": qualsiasi altro documento (contratti luce/internet/mutuo, rogito, polizze, documenti identità, fiscali, manuali/schede prodotto, bonifici GSE, ricevute).',
        'Valori ammessi per "documentCategory": "Mutuo & Casa" | "Internet & Wi-Fi" | "Contratti & Utenze" | "Assicurazioni" | "Fiscale & Identità" | "Altro".',
        'Valori ammessi per "attachmentType": "manuale" | "scontrino_fattura" | "garanzia_extra_family" | "targhetta_pnc" | "altro".',
        'Valori ammessi per "confidence": "alta" | "media" | "bassa".',
        'Schema JSON:',
        '{',
        '  "target": "bill_luce" | "bill_acqua" | "bill_tari" | "document",',
        '  "confidence": "alta" | "media" | "bassa",',
        '  "documentCategory": "Mutuo & Casa" | "Internet & Wi-Fi" | "Contratti & Utenze" | "Assicurazioni" | "Fiscale & Identità" | "Altro",',
        '  "matchedProductId": "id del prodotto corrispondente o stringa vuota",',
        '  "attachmentType": "manuale" | "scontrino_fattura" | "garanzia_extra_family" | "targhetta_pnc" | "altro",',
        '  "title": "titolo conciso max 75 caratteri",',
        '  "provider": "ente, banca o fornitore max 60 caratteri",',
        '  "referenceCode": "numero contratto/fattura/pratica/targa se visibile o stringa vuota",',
        '  "issueDate": "GG/MM/AAAA o stringa vuota",',
        '  "expiryDate": "GG/MM/AAAA o stringa vuota",',
        '  "notes": "breve descrizione max 150 caratteri",',
        '  "bill": { "supplier": "", "offerName": "", "invoiceOrNoticeNumber": "", "issueDate": "", "dueDate": "", "period": "", "year": 2026, "totalPaid": 0, "kwh": 0, "canoneTv": 0, "cubicMeters": 0, "fixedCostEur": 0 }',
        '}',
        `Nome file: ${effectiveName}`,
        cloudUrl ? `URL sorgente: ${cloudUrl}` : '',
        mimeType ? `MIME type: ${mimeType}` : '',
        productsPromptList,
        textContent.trim()
          ? `Testo estratto:\n${textContent.slice(0, 12_000)}`
          : rawImageBase64
            ? 'Analizza immagine allegata.'
            : 'Classifica in base a nome file ed URL.',
      ]
        .filter(Boolean)
        .join('\n');

      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [{ text: prompt }];

      if (rawImageBase64) {
        const cleanBase64 = rawImageBase64.replace(/^data:[^;]+;base64,/, '');
        const resolvedImgMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
        parts.push({
          inlineData: {
            mimeType: resolvedImgMime,
            data: cleanBase64,
          },
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts }],
      });

      const rawText = (response.text || '').trim();
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        res.json(fallback);
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const validTargets = new Set(['bill_luce', 'bill_acqua', 'bill_tari', 'document']);
      const validCategories = new Set([
        'Mutuo & Casa',
        'Internet & Wi-Fi',
        'Contratti & Utenze',
        'Assicurazioni',
        'Fiscale & Identità',
        'Altro',
      ]);
      const validConfidence = new Set(['alta', 'media', 'bassa']);
      const validAttachTypes = new Set([
        'manuale',
        'scontrino_fattura',
        'garanzia_extra_family',
        'targhetta_pnc',
        'altro',
      ]);
      const validProductIds = new Set(products.map((p) => p.id));

      const target = validTargets.has(String(parsed.target || ''))
        ? (String(parsed.target) as 'bill_luce' | 'bill_acqua' | 'bill_tari' | 'document')
        : fallback.target;
      const documentCategory = validCategories.has(String(parsed.documentCategory || ''))
        ? (String(parsed.documentCategory) as
            | 'Mutuo & Casa'
            | 'Internet & Wi-Fi'
            | 'Contratti & Utenze'
            | 'Assicurazioni'
            | 'Fiscale & Identità'
            | 'Altro')
        : fallback.documentCategory;
      const confidence = validConfidence.has(String(parsed.confidence || ''))
        ? (String(parsed.confidence) as 'alta' | 'media' | 'bassa')
        : fallback.confidence;

      const aiProductId =
        typeof parsed.matchedProductId === 'string' && validProductIds.has(parsed.matchedProductId.trim())
          ? parsed.matchedProductId.trim()
          : '';
      const matchedProductId =
        target === 'document' ? aiProductId || deterministicProduct?.id || '' : '';
      const attachmentType = validAttachTypes.has(String(parsed.attachmentType || ''))
        ? (String(parsed.attachmentType) as
            | 'manuale'
            | 'scontrino_fattura'
            | 'garanzia_extra_family'
            | 'targhetta_pnc'
            | 'altro')
        : deterministicAttachType;

      res.json({
        target,
        confidence,
        documentCategory,
        matchedProductId: matchedProductId || undefined,
        attachmentType,
        title:
          typeof parsed.title === 'string' && parsed.title.trim()
            ? parsed.title.trim().slice(0, 80)
            : fallback.title,
        provider:
          typeof parsed.provider === 'string' && parsed.provider.trim()
            ? parsed.provider.trim().slice(0, 80)
            : fallback.provider,
        referenceCode:
          typeof parsed.referenceCode === 'string' ? parsed.referenceCode.trim().slice(0, 80) : '',
        issueDate:
          typeof parsed.issueDate === 'string' ? parsed.issueDate.trim().slice(0, 20) : '',
        expiryDate:
          typeof parsed.expiryDate === 'string' ? parsed.expiryDate.trim().slice(0, 20) : '',
        notes:
          typeof parsed.notes === 'string' && parsed.notes.trim()
            ? parsed.notes.trim().slice(0, 180)
            : fallback.notes,
        bill: parsed.bill && typeof parsed.bill === 'object' ? parsed.bill : undefined,
        usedAi: true,
      });
    } catch (error) {
      if (!isQuotaOrRateError(error)) {
        console.warn('Errore classificazione documento AI, uso fallback locale:', error);
      }
      res.json(fallback);
    }
  });

  app.post('/api/firestore/telemetry', async (req, res) => {
    const { projectId } = readAppletFirebaseConfig();
    let verified: { uid: string; email: string };
    try {
      verified = await verifyFirebaseIdToken(req.headers.authorization, projectId);
    } catch (authErr) {
      const code = authErr instanceof Error ? authErr.message : 'unauthorized';
      res.status(code === 'forbidden_email' ? 403 : 401).json({
        ok: false,
        errorCode: code,
        message:
          code === 'forbidden_email'
            ? 'Account non autorizzato a sincronizzare la telemetria.'
            : 'Accesso richiesto: effettua il login con Google.',
      });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const rawPtDate = typeof body.ptDate === 'string' ? body.ptDate.trim() : '';
    const ptDate = /^\d{4}-\d{2}-\d{2}$/.test(rawPtDate)
      ? rawPtDate
      : getPtQuotaWindowRange().ptDate;
    const rawBrowserId = typeof body.browserId === 'string' ? body.browserId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{4,40}$/.test(rawBrowserId)) {
      res.status(400).json({ ok: false, message: 'browserId non valido.' });
      return;
    }
    const browserLabel =
      typeof body.browserLabel === 'string'
        ? body.browserLabel.replace(/[<>]/g, '').trim().slice(0, 60) || 'Browser'
        : 'Browser';

    const rawEntries = Array.isArray(body.entries) ? body.entries : [];
    const extraEntries: TelemetryUpsertDayInput[] = rawEntries
      .slice(0, 730)
      .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
      .map((e) => ({
        ptDate: typeof e.ptDate === 'string' ? e.ptDate.trim() : typeof e.date === 'string' ? e.date.trim() : '',
        reads: e.reads,
        readUnits: e.readUnits,
        writes: e.writes,
        deletes: e.deletes,
        writeUnits: e.writeUnits,
        savedInTestMode: e.savedInTestMode,
        quotaHit: e.quotaHit,
      }))
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.ptDate));

    const browsers = upsertMultiBrowserTelemetry(verified.uid, {
      ptDate,
      browserId: rawBrowserId,
      browserLabel,
      reads: body.reads,
      readUnits: body.readUnits,
      writes: body.writes,
      deletes: body.deletes,
      writeUnits: body.writeUnits,
      savedInTestMode: body.savedInTestMode,
      quotaHit: body.quotaHit,
      extraEntries,
    });

    res.json({ ok: true, ptDate, browsers });
  });

  app.get('/api/firestore/quota', async (req, res) => {
    const { projectId, databaseId } = readAppletFirebaseConfig();
    let verified: { uid: string; email: string };
    try {
      verified = await verifyFirebaseIdToken(req.headers.authorization, projectId);
    } catch (authErr) {
      const code = authErr instanceof Error ? authErr.message : 'unauthorized';
      res.status(code === 'forbidden_email' ? 403 : 401).json({
        ok: false,
        errorCode: code,
        message:
          code === 'forbidden_email'
            ? 'Account non autorizzato a consultare le statistiche quota.'
            : 'Accesso richiesto: effettua il login con Google per consultare la quota reale.',
      });
      return;
    }

    const todayPt = getPtQuotaWindowRange().ptDate;
    const rawPeriod = typeof req.query.period === 'string' ? req.query.period.trim() : 'day';
    const periodMode: TelemetryPeriodMode =
      rawPeriod === 'month' || rawPeriod === 'year' ? rawPeriod : 'day';
    const rawValue = typeof req.query.value === 'string' ? req.query.value.trim() : '';
    const periodValue =
      periodMode === 'month'
        ? /^\d{4}-\d{2}$/.test(rawValue)
          ? rawValue
          : todayPt.slice(0, 7)
        : periodMode === 'year'
          ? /^\d{4}$/.test(rawValue)
            ? rawValue
            : todayPt.slice(0, 4)
          : /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
            ? rawValue
            : todayPt;

    if (periodMode !== 'day' || periodValue !== todayPt) {
      res.json(
        buildFreeSparkQuotaPayload(
          verified.uid,
          projectId,
          databaseId,
          'missing_service_account',
          undefined,
          periodMode,
          periodValue
        )
      );
      return;
    }

    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    try {
      const result = await fetchFirestoreMonitoringQuota(forceRefresh, verified.uid);
      res.json(result);
    } catch (err) {
      console.error('Errore interrogazione quota Firestore:', err instanceof Error ? err.message : err);
      res.json(
        buildFreeSparkQuotaPayload(verified.uid, projectId, databaseId, 'billing_required')
      );
    }
  });

  const httpServer = http.createServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
