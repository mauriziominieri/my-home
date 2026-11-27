import { DailyFirestoreUsageEntry } from '../firebase';
import { HomeArticleRecord } from '../types/home';

export const SYSTEM_ROOM_TELEMETRY = '__telemetry__';
export const TELEMETRY_DOC_PREFIX = 'telemetry_';

const BROWSER_ID_STORAGE_KEY = 'myhome_browser_device_id_v1';
const MAX_HISTORY_TEXT_CHARS = 11_800;

export type TelemetryPeriodMode = 'day' | 'month' | 'year';

export interface BrowserTelemetryDevice {
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

function sanitizeBrowserId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return cleaned.length >= 4 ? cleaned : 'br_default';
}

export function doesPtDateMatchPeriod(
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

export function detectBrowserLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent || '';
  const isIframePreview =
    typeof window !== 'undefined' && window.location.hostname.startsWith('ais-');

  const os = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Dispositivo';

  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Firefox\//i.test(ua)
      ? 'Firefox'
      : /OPR\//i.test(ua)
        ? 'Opera'
        : /CriOS/i.test(ua) || (/Chrome\//i.test(ua) && !/Edg\//i.test(ua))
          ? 'Chrome'
          : /Safari\//i.test(ua) && !/Chrome\//i.test(ua)
            ? 'Safari'
            : 'Browser';

  const base = `${browser} · ${os}`;
  return (isIframePreview ? `${base} (AI Studio)` : base).slice(0, 58);
}

export function getBrowserDeviceInfo(): { browserId: string; browserLabel: string } {
  const browserLabel = detectBrowserLabel();
  if (typeof window === 'undefined') {
    return { browserId: 'br_server', browserLabel };
  }
  try {
    const existing = window.localStorage.getItem(BROWSER_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,32}$/.test(existing)) {
      return { browserId: existing, browserLabel };
    }
    const rand = Math.random().toString(36).slice(2, 10);
    const ts = Date.now().toString(36).slice(-4);
    const created = sanitizeBrowserId(`br_${ts}${rand}`);
    window.localStorage.setItem(BROWSER_ID_STORAGE_KEY, created);
    return { browserId: created, browserLabel };
  } catch {
    return { browserId: 'br_ephemeral', browserLabel };
  }
}

export function getTelemetryDocId(browserId: string): string {
  return `${TELEMETRY_DOC_PREFIX}${sanitizeBrowserId(browserId)}`;
}

export function encodeTelemetryHistoryText(entries: DailyFirestoreUsageEntry[]): string {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const sorted = [...entries]
    .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  const lines: string[] = [];
  let totalLen = 0;
  for (const e of sorted) {
    const line = [
      e.date,
      Math.max(0, Math.round(e.reads || 0)),
      Math.max(0, Math.round(e.readUnits || 0)),
      Math.max(0, Math.round(e.writes || 0)),
      Math.max(0, Math.round(e.deletes || 0)),
      Math.max(0, Math.round(e.writeUnits || 0)),
      Math.max(0, Math.round(e.savedInTestMode || 0)),
      e.quotaHit ? 1 : 0,
    ].join('|');
    const nextLen = totalLen + line.length + (lines.length > 0 ? 1 : 0);
    if (nextLen > MAX_HISTORY_TEXT_CHARS) break;
    lines.push(line);
    totalLen = nextLen;
  }
  return lines.join('\n');
}

export function decodeTelemetryHistoryText(
  raw: string | undefined,
  browserId: string,
  browserLabel: string,
  fallbackUpdatedAt: number
): BrowserTelemetryDevice[] {
  if (!raw || typeof raw !== 'string') return [];
  const safeId = sanitizeBrowserId(browserId);
  const safeLabel = (browserLabel || 'Browser').slice(0, 60);
  const out: BrowserTelemetryDevice[] = [];
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };
  for (const line of raw.split('\n')) {
    const parts = line.trim().split('|');
    if (parts.length < 7) continue;
    const ptDate = parts[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ptDate)) continue;
    out.push({
      browserId: safeId,
      browserLabel: safeLabel,
      ptDate,
      reads: num(parts[1]),
      readUnits: Math.max(num(parts[1]), num(parts[2])),
      writes: num(parts[3]),
      deletes: num(parts[4]),
      writeUnits: Math.max(num(parts[3]) + num(parts[4]), num(parts[5])),
      savedInTestMode: num(parts[6]),
      quotaHit: parts[7] === '1',
      updatedAt: fallbackUpdatedAt,
    });
  }
  return out;
}

export function buildBrowserTelemetryArticlePayload(
  ownerId: string,
  browserId: string,
  browserLabel: string,
  entry: DailyFirestoreUsageEntry,
  createdAt: unknown,
  historyEntries?: DailyFirestoreUsageEntry[]
): Record<string, unknown> {
  const compact = {
    d: entry.date,
    r: Math.max(0, Math.round(entry.readUnits)),
    rd: Math.max(0, Math.round(entry.reads)),
    w: Math.max(0, Math.round(entry.writeUnits)),
    wr: Math.max(0, Math.round(entry.writes)),
    dl: Math.max(0, Math.round(entry.deletes)),
    sv: Math.max(0, Math.round(entry.savedInTestMode)),
    q: entry.quotaHit ? 1 : 0,
    ts: Date.now(),
  };
  const payload: Record<string, unknown> = {
    ownerId,
    name: `Telemetria ${sanitizeBrowserId(browserId)}`.slice(0, 80),
    brand: (browserLabel || 'Browser').slice(0, 60),
    model: 'telemetry_pt_v1',
    category: 'altro',
    room: SYSTEM_ROOM_TELEMETRY,
    familyWarranty: false,
    specs: JSON.stringify(compact).slice(0, 240),
    createdAt,
  };
  const mergedHistory = encodeTelemetryHistoryText(
    historyEntries && historyEntries.length > 0 ? historyEntries : [entry]
  );
  if (mergedHistory) {
    payload.manualExtractText = mergedHistory;
  }
  return payload;
}

export function parseAllBrowserTelemetryFromArticles(
  articles: HomeArticleRecord[]
): BrowserTelemetryDevice[] {
  const result: BrowserTelemetryDevice[] = [];
  for (const a of articles) {
    if (a.room !== SYSTEM_ROOM_TELEMETRY || !a.id.startsWith(TELEMETRY_DOC_PREFIX)) {
      continue;
    }
    const browserId = sanitizeBrowserId(a.id.slice(TELEMETRY_DOC_PREFIX.length));
    const browserLabel = (a.brand || 'Browser').slice(0, 60);
    let specsTs = Date.now();

    if (a.specs) {
      try {
        const raw = JSON.parse(a.specs) as Record<string, unknown>;
        const ptDate = typeof raw.d === 'string' ? raw.d : '';
        const num = (k: string) => {
          const v = Number(raw[k]);
          return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
        };
        specsTs = num('ts') || specsTs;
        if (/^\d{4}-\d{2}-\d{2}$/.test(ptDate)) {
          result.push({
            browserId,
            browserLabel,
            ptDate,
            readUnits: num('r'),
            reads: num('rd'),
            writeUnits: num('w'),
            writes: num('wr'),
            deletes: num('dl'),
            savedInTestMode: num('sv'),
            quotaHit: raw.q === 1 || raw.q === true,
            updatedAt: specsTs,
          });
        }
      } catch {
        // ignore malformed entry
      }
    }

    if (a.manualExtractText) {
      result.push(
        ...decodeTelemetryHistoryText(
          a.manualExtractText,
          browserId,
          browserLabel,
          specsTs
        )
      );
    }
  }
  return result;
}

export function parseBrowserTelemetryFromArticles(
  articles: HomeArticleRecord[],
  targetPtDate: string
): BrowserTelemetryDevice[] {
  return parseAllBrowserTelemetryFromArticles(articles).filter(
    (item) => item.ptDate === targetPtDate
  );
}

export function entryToBrowserTelemetryDevice(
  entry: DailyFirestoreUsageEntry,
  browserId: string,
  browserLabel: string
): BrowserTelemetryDevice {
  return {
    browserId: sanitizeBrowserId(browserId),
    browserLabel: browserLabel.slice(0, 60),
    ptDate: entry.date,
    reads: Math.max(0, Math.round(entry.reads)),
    readUnits: Math.max(0, Math.round(entry.readUnits)),
    writes: Math.max(0, Math.round(entry.writes)),
    deletes: Math.max(0, Math.round(entry.deletes)),
    writeUnits: Math.max(0, Math.round(entry.writeUnits)),
    savedInTestMode: Math.max(0, Math.round(entry.savedInTestMode)),
    quotaHit: Boolean(entry.quotaHit),
    updatedAt: Date.now(),
  };
}

export function mergeBrowserTelemetryDevices(
  lists: BrowserTelemetryDevice[][],
  targetPtDate: string
): BrowserTelemetryDevice[] {
  return mergeBrowserTelemetryForPeriod(lists, 'day', targetPtDate);
}

export function mergeBrowserTelemetryForPeriod(
  lists: BrowserTelemetryDevice[][],
  periodMode: TelemetryPeriodMode,
  periodValue: string
): BrowserTelemetryDevice[] {
  // First deduplicate per (browserId, ptDate) taking Math.max across sources
  const byBrowserAndDate = new Map<string, BrowserTelemetryDevice>();
  for (const list of lists) {
    for (const item of list) {
      if (!item || !doesPtDateMatchPeriod(item.ptDate, periodMode, periodValue)) {
        continue;
      }
      const id = sanitizeBrowserId(item.browserId);
      const key = `${id}:${item.ptDate}`;
      const prev = byBrowserAndDate.get(key);
      if (!prev) {
        byBrowserAndDate.set(key, { ...item, browserId: id });
      } else {
        byBrowserAndDate.set(key, {
          browserId: id,
          browserLabel:
            item.updatedAt >= prev.updatedAt && item.browserLabel
              ? item.browserLabel
              : prev.browserLabel || item.browserLabel,
          ptDate: item.ptDate,
          reads: Math.max(prev.reads, item.reads),
          readUnits: Math.max(prev.readUnits, item.readUnits),
          writes: Math.max(prev.writes, item.writes),
          deletes: Math.max(prev.deletes, item.deletes),
          writeUnits: Math.max(prev.writeUnits, item.writeUnits),
          savedInTestMode: Math.max(prev.savedInTestMode, item.savedInTestMode),
          quotaHit: prev.quotaHit || item.quotaHit,
          updatedAt: Math.max(prev.updatedAt, item.updatedAt),
        });
      }
    }
  }

  // Then sum across matching dates for each browserId
  const byBrowser = new Map<string, BrowserTelemetryDevice & { dates: Set<string> }>();
  for (const rec of byBrowserAndDate.values()) {
    const existing = byBrowser.get(rec.browserId);
    if (!existing) {
      byBrowser.set(rec.browserId, {
        ...rec,
        ptDate: periodValue,
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

  return [...byBrowser.values()]
    .map(({ dates: _dates, ...rest }) => rest)
    .sort((a, b) => b.readUnits + b.writeUnits - (a.readUnits + a.writeUnits));
}

const renderTelemetrySupportCache = new Map<
  string,
  { supported: boolean; checkedAt: number }
>();

export function invalidateRenderTelemetrySupportCache(healthEndpoint?: string): void {
  if (healthEndpoint) {
    renderTelemetrySupportCache.delete(healthEndpoint);
  } else {
    renderTelemetrySupportCache.clear();
  }
}

/**
 * Checks GET /api/health (plain CORS request with zero preflight headers)
 * before attempting POST /api/firestore/telemetry with Authorization.
 * Avoids Chrome console CORS errors if an older backend build is running.
 */
export async function checkRenderTelemetrySupport(
  healthEndpoint: string | null | undefined
): Promise<boolean> {
  if (!healthEndpoint) return false;
  const now = Date.now();
  const cached = renderTelemetrySupportCache.get(healthEndpoint);
  if (cached) {
    const ttlMs = cached.supported ? 10 * 60 * 1000 : 90 * 1000;
    if (now - cached.checkedAt < ttlMs) {
      return cached.supported;
    }
  }
  try {
    const resp = await fetch(healthEndpoint, {
      method: 'GET',
      mode: 'cors',
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) {
      renderTelemetrySupportCache.set(healthEndpoint, { supported: false, checkedAt: now });
      return false;
    }
    const json = (await resp.json().catch(() => null)) as {
      ok?: boolean;
      telemetrySync?: boolean;
    } | null;
    const supported = Boolean(json?.ok && json?.telemetrySync === true);
    renderTelemetrySupportCache.set(healthEndpoint, { supported, checkedAt: now });
    return supported;
  } catch {
    renderTelemetrySupportCache.set(healthEndpoint, { supported: false, checkedAt: now });
    return false;
  }
}
