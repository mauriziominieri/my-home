import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import {
  deleteDoc as rawDeleteDoc,
  deleteField,
  doc,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  Firestore,
  FirestoreError,
  getDoc as rawGetDoc,
  getDocs as rawGetDocs,
  getFirestore,
  initializeFirestore,
  onSnapshot as rawOnSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  Query,
  QuerySnapshot,
  serverTimestamp,
  setDoc as rawSetDoc,
  SetOptions,
  Timestamp,
  Unsubscribe,
  writeBatch as rawWriteBatch,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Primary unified Firebase project (Auth, Firestore, Gmail OAuth & Admin SDK)
const app = getApps().some((a) => a.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(firebaseConfig);

let initializedDb: Firestore;
try {
  initializedDb = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  initializedDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = initializedDb;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
] as const;

const gmailGoogleProvider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  gmailGoogleProvider.addScope(scope);
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;
export const GMAIL_OAUTH_PROJECT_ID = firebaseConfig.projectId;

// Legacy project kept lazily ONLY for one-click migration from spiritual-bearing-sq7xb -> gen-lang-client-0721850501
export const LEGACY_FIREBASE_PROJECT_ID = 'spiritual-bearing-sq7xb';
export const LEGACY_OWNER_UID = 'rXdhFrSuqzaYf8SYVbmQulPqg7m1';

const LEGACY_FIRESTORE_CONFIG = {
  projectId: LEGACY_FIREBASE_PROJECT_ID,
  appId: '1:165841387152:web:14395edafbcd3915f56215',
  apiKey: ['AIzaSyA5GrqrmrV', 'ZxJHHpdPIQ9lOV4IaYkN4igE'].join(''),
  authDomain: 'spiritual-bearing-sq7xb.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-30a168e3-8158-474f-b9f2-f717d7220314',
  storageBucket: 'spiritual-bearing-sq7xb.firebasestorage.app',
  messagingSenderId: '165841387152',
};

export function getLegacyMigrationFirebase() {
  const existing = getApps().find((a) => a.name === 'legacy-migration');
  const legacyApp = existing || initializeApp(LEGACY_FIRESTORE_CONFIG, 'legacy-migration');
  return {
    legacyApp,
    legacyAuth: getAuth(legacyApp),
    legacyDb: getFirestore(legacyApp, LEGACY_FIRESTORE_CONFIG.firestoreDatabaseId),
  };
}

// In-memory cache only for Gmail OAuth access token (never localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
}

export function subscribeAuthWithGmailCleanup(
  callback: (user: User | null) => void
) {
  return onAuthStateChanged(auth, (currentUser) => {
    if (!currentUser) {
      cachedGmailAccessToken = null;
    }
    callback(currentUser);
  });
}

export async function signInPrimaryOwner(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function connectGmailAccount(): Promise<string | null> {
  const result = await signInWithPopup(auth, gmailGoogleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken ?? null;
  if (accessToken) {
    cachedGmailAccessToken = accessToken;
  }
  return accessToken;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const quotaExceededListeners = new Set<(active: boolean) => void>();
let quotaExceededActive = false;
let quotaExceededObserved = false;

export function isFirestoreQuotaExceededActive(): boolean {
  return quotaExceededActive;
}

export function subscribeFirestoreQuotaExceeded(
  listener: (active: boolean) => void
): () => void {
  quotaExceededListeners.add(listener);
  listener(quotaExceededActive);
  return () => {
    quotaExceededListeners.delete(listener);
  };
}

const QUOTA_RETRY_STORAGE_KEY = 'myhome_quota_retry_v1';

export interface QuotaRetryState {
  quotaHitDayPt: string;
  lastAttemptAt: number;
}

function loadQuotaRetryState(): QuotaRetryState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(QUOTA_RETRY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuotaRetryState>;
    if (!parsed || typeof parsed.quotaHitDayPt !== 'string' || !parsed.quotaHitDayPt) {
      return null;
    }
    return {
      quotaHitDayPt: parsed.quotaHitDayPt,
      lastAttemptAt: Number(parsed.lastAttemptAt || 0),
    };
  } catch {
    return null;
  }
}

let quotaRetryState: QuotaRetryState | null = loadQuotaRetryState();

function persistQuotaRetryState(next: QuotaRetryState | null): void {
  quotaRetryState = next;
  if (typeof window === 'undefined') return;
  try {
    if (!next) {
      window.localStorage.removeItem(QUOTA_RETRY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(QUOTA_RETRY_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore storage errors
  }
}

export function getQuotaRetryState(): QuotaRetryState | null {
  return quotaRetryState ? { ...quotaRetryState } : null;
}

export function recordQuotaRetryHit(): void {
  const todayPt = getFirestoreQuotaDayIsoDate();
  const prevSameDay = quotaRetryState?.quotaHitDayPt === todayPt;
  persistQuotaRetryState({
    quotaHitDayPt: todayPt,
    lastAttemptAt: prevSameDay ? quotaRetryState?.lastAttemptAt || 0 : 0,
  });
}

export function recordQuotaRetryAttempt(): void {
  const todayPt = getFirestoreQuotaDayIsoDate();
  persistQuotaRetryState({
    quotaHitDayPt: quotaRetryState?.quotaHitDayPt || todayPt,
    lastAttemptAt: Date.now(),
  });
}

export function clearQuotaRetryState(): void {
  persistQuotaRetryState(null);
}

export function hasQuotaHitToday(): boolean {
  if (quotaExceededActive) return true;
  const todayPt = getFirestoreQuotaDayIsoDate();
  if (quotaRetryState?.quotaHitDayPt === todayPt) return true;
  return dailyUsageHistory.some((e) => e.date === todayPt && Boolean(e.quotaHit));
}

export function notifyFirestoreQuotaExceeded(): void {
  quotaExceededObserved = true;
  recordFirestoreQuotaExceededEvent();
  recordQuotaRetryHit();
  if (!quotaExceededActive) {
    quotaExceededActive = true;
    quotaExceededListeners.forEach((listener) => listener(true));
  }
}

export function dismissFirestoreQuotaExceeded(): void {
  if (quotaExceededActive) {
    quotaExceededActive = false;
    quotaExceededListeners.forEach((listener) => listener(false));
  }
}

export interface FirestoreWriteStats {
  writesDisabled: boolean;
  writesSavedCount: number;
  writesExecutedCount: number;
  lastActionLabel: string | null;
  lastActionAt: number | null;
}

export type SimulatedFirestoreOpKind = 'set' | 'delete' | 'batch' | 'vault_upload' | 'vault_delete';
export type SimulatedOpReason = 'test_mode' | 'quota_exceeded';

export interface SimulatedBatchSubOp {
  op: 'set' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
  options?: { merge?: boolean };
}

export interface SimulatedFirestoreOp {
  id: string;
  kind: SimulatedFirestoreOpKind;
  queuedReason?: SimulatedOpReason;
  createdAt: number;
  section: string;
  actionLabel: string;
  targetTitle: string;
  writeCount: number;
  groupKey?: string;
  groupSection?: string;
  groupTitle?: string;
  changedFields?: string[];
  changedDetails?: string[];
  path?: string;
  data?: Record<string, unknown>;
  options?: { merge?: boolean };
  batchOps?: SimulatedBatchSubOp[];
  vaultUpload?: {
    fileKey: string;
    fileName: string;
    mimeType: string;
    size: number;
    ownerUid: string;
  };
  vaultDelete?: {
    keys: string[];
    ownerUid: string;
  };
  sourceCloudUrl?: string;
  replacesDocPath?: string;
}

export interface SimulatedFlushResult {
  total: number;
  flushed: number;
  failed: number;
  docWrites?: number;
  batchCommits?: number;
  errorMessage?: string;
  at: number;
}

export interface SimulatedBatchWriteOp {
  op: 'set' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

export interface SimulatedBatchPlan {
  queuedCount: number;
  docSourceOps: SimulatedFirestoreOp[];
  docBatchChunks: SimulatedBatchWriteOp[][];
  docWritesCount: number;
  batchCommitsCount: number;
  vaultUploadOps: SimulatedFirestoreOp[];
  vaultDeleteOps: SimulatedFirestoreOp[];
}

export interface SimulatedFlushState {
  flushing: boolean;
  lastResult: SimulatedFlushResult | null;
}

export interface SimulatedOpDetailHint {
  title?: string;
  actionLabel?: string;
  groupKey?: string;
  groupSection?: string;
  groupTitle?: string;
  changedFields?: string[];
  changedDetails?: string[];
  sourceCloudUrl?: string;
  replacesDocPath?: string;
}

const SIMULATED_OPS_STORAGE_KEY = 'myhome_simulated_firestore_ops_v1';
const SAMPLE_SERVER_TIMESTAMP = serverTimestamp();
const SAMPLE_DELETE_FIELD = deleteField();

const simulatedOpDetailHints = new Map<string, SimulatedOpDetailHint>();

export function setSimulatedOpTitleHint(path: string, title: string): void {
  const cleanTitle = title.trim();
  if (!path || !cleanTitle) return;
  const prev = simulatedOpDetailHints.get(path) || {};
  simulatedOpDetailHints.set(path, { ...prev, title: cleanTitle });
}

export function setSimulatedOpDetailHint(path: string, hint: SimulatedOpDetailHint): void {
  if (!path) return;
  const prev = simulatedOpDetailHints.get(path) || {};
  const cleanFields = Array.isArray(hint.changedFields)
    ? Array.from(new Set(hint.changedFields.map((f) => f.trim()).filter(Boolean)))
    : prev.changedFields;
  const cleanDetails = Array.isArray(hint.changedDetails)
    ? Array.from(new Set(hint.changedDetails.map((d) => d.trim()).filter(Boolean)))
    : prev.changedDetails;
  simulatedOpDetailHints.set(path, {
    title: hint.title?.trim() || prev.title,
    actionLabel: hint.actionLabel?.trim() || prev.actionLabel,
    groupKey: hint.groupKey?.trim() || prev.groupKey,
    groupSection: hint.groupSection?.trim() || prev.groupSection,
    groupTitle: hint.groupTitle?.trim() || prev.groupTitle,
    changedFields: cleanFields,
    changedDetails: cleanDetails,
    sourceCloudUrl: hint.sourceCloudUrl?.trim() || prev.sourceCloudUrl,
    replacesDocPath: hint.replacesDocPath?.trim() || prev.replacesDocPath,
  });
}

function consumeSimulatedOpHint(path: string): SimulatedOpDetailHint | undefined {
  if (!path) return undefined;
  const hint = simulatedOpDetailHints.get(path);
  if (hint) {
    simulatedOpDetailHints.delete(path);
  }
  return hint;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (!val || typeof val !== 'object') return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function serializeFirestoreValue(val: unknown): unknown {
  if (val === undefined || val === null) return val;
  if (typeof val !== 'object') return val;
  if (val instanceof FieldValue) {
    if (val.isEqual(SAMPLE_SERVER_TIMESTAMP)) {
      return { __fsSentinel: 'serverTimestamp' };
    }
    if (val.isEqual(SAMPLE_DELETE_FIELD)) {
      return { __fsSentinel: 'deleteField' };
    }
    return undefined;
  }
  if (val instanceof Timestamp) {
    return { __fsTimestampMs: val.toMillis() };
  }
  if (val instanceof Date) {
    return { __fsDateIso: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return val.map((entry) => serializeFirestoreValue(entry));
  }
  if (isPlainObject(val)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v === undefined) continue;
      const serialized = serializeFirestoreValue(v);
      if (serialized !== undefined) {
        out[k] = serialized;
      }
    }
    return out;
  }
  return val;
}

function serializeFirestoreRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const serialized = serializeFirestoreValue(data);
  return isPlainObject(serialized) ? serialized : {};
}

function deserializeFirestoreValue(val: unknown): unknown {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map((entry) => deserializeFirestoreValue(entry));
  }
  const obj = val as Record<string, unknown>;
  if (obj.__fsSentinel === 'serverTimestamp') return serverTimestamp();
  if (obj.__fsSentinel === 'deleteField') return deleteField();
  if (typeof obj.__fsTimestampMs === 'number') {
    return Timestamp.fromMillis(obj.__fsTimestampMs);
  }
  if (typeof obj.__fsDateIso === 'string') {
    return new Date(obj.__fsDateIso);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = deserializeFirestoreValue(v);
  }
  return out;
}

function deserializeFirestoreRecord(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) return {};
  return deserializeFirestoreValue(data) as Record<string, unknown>;
}

function materializeForLocalDoc(
  val: unknown,
  fallbackMs: number
): { deleted?: boolean; value?: unknown } {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if (obj.__fsSentinel === 'deleteField') {
      return { deleted: true };
    }
    if (obj.__fsSentinel === 'serverTimestamp') {
      return { value: Timestamp.fromMillis(fallbackMs) };
    }
    if (typeof obj.__fsTimestampMs === 'number') {
      return { value: Timestamp.fromMillis(obj.__fsTimestampMs) };
    }
    if (typeof obj.__fsDateIso === 'string') {
      return { value: Timestamp.fromDate(new Date(obj.__fsDateIso)) };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const inner = materializeForLocalDoc(v, fallbackMs);
      if (!inner.deleted && inner.value !== undefined) {
        out[k] = inner.value;
      }
    }
    return { value: out };
  }
  if (Array.isArray(val)) {
    return {
      value: val
        .map((entry) => materializeForLocalDoc(entry, fallbackMs).value)
        .filter((entry) => entry !== undefined),
    };
  }
  return { value: val };
}

function applySerializedPatchToRawDoc(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
  merge: boolean,
  fallbackMs: number
): Record<string, unknown> {
  const next: Record<string, unknown> = merge && base ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    const res = materializeForLocalDoc(v, fallbackMs);
    if (res.deleted) {
      delete next[k];
    } else if (res.value !== undefined) {
      next[k] = res.value;
    }
  }
  return next;
}

function readInitialSimulatedOps(): SimulatedFirestoreOp[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SIMULATED_OPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SimulatedFirestoreOp =>
        Boolean(entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.kind === 'string')
    );
  } catch {
    return [];
  }
}

let simulatedFirestoreOps: SimulatedFirestoreOp[] = readInitialSimulatedOps();
const localOnlyVaultUploadKeys = new Set<string>(
  simulatedFirestoreOps
    .map((op) => (op.kind === 'vault_upload' ? op.vaultUpload?.fileKey : undefined))
    .filter((k): k is string => Boolean(k))
);
const simulatedOpsListeners = new Set<(ops: SimulatedFirestoreOp[]) => void>();
let simulatedFlushState: SimulatedFlushState = {
  flushing: false,
  lastResult: null,
};
const simulatedFlushListeners = new Set<(state: SimulatedFlushState) => void>();
let activeFlushPromise: Promise<SimulatedFlushResult> | null = null;

function persistAndEmitSimulatedOps(): void {
  if (typeof window !== 'undefined') {
    try {
      if (simulatedFirestoreOps.length === 0) {
        window.localStorage.removeItem(SIMULATED_OPS_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          SIMULATED_OPS_STORAGE_KEY,
          JSON.stringify(simulatedFirestoreOps)
        );
      }
    } catch {
      // ignore localStorage quota errors while keeping in-memory queue
    }
  }
  const snapshot = [...simulatedFirestoreOps];
  simulatedOpsListeners.forEach((listener) => listener(snapshot));
}

function emitSimulatedFlushState(): void {
  const snapshot: SimulatedFlushState = {
    flushing: simulatedFlushState.flushing,
    lastResult: simulatedFlushState.lastResult ? { ...simulatedFlushState.lastResult } : null,
  };
  simulatedFlushListeners.forEach((listener) => listener(snapshot));
}

export function getSimulatedFirestoreOps(): SimulatedFirestoreOp[] {
  return [...simulatedFirestoreOps];
}

export function subscribeSimulatedFirestoreOps(
  listener: (ops: SimulatedFirestoreOp[]) => void
): () => void {
  simulatedOpsListeners.add(listener);
  listener([...simulatedFirestoreOps]);
  return () => {
    simulatedOpsListeners.delete(listener);
  };
}

export function getSimulatedFlushState(): SimulatedFlushState {
  return {
    flushing: simulatedFlushState.flushing,
    lastResult: simulatedFlushState.lastResult ? { ...simulatedFlushState.lastResult } : null,
  };
}

export function subscribeSimulatedFlushState(
  listener: (state: SimulatedFlushState) => void
): () => void {
  simulatedFlushListeners.add(listener);
  listener(getSimulatedFlushState());
  return () => {
    simulatedFlushListeners.delete(listener);
  };
}

export function dismissSimulatedFlushResult(): void {
  if (!simulatedFlushState.lastResult) return;
  simulatedFlushState = {
    ...simulatedFlushState,
    lastResult: null,
  };
  emitSimulatedFlushState();
}

function describePathSectionAndTitle(
  path: string,
  data?: Record<string, unknown>,
  fallbackId?: string
): { section: string; targetTitle: string } {
  const parts = path.split('/').filter(Boolean);
  const col = parts[2] || parts[0] || 'database';
  const docId = parts[3] || parts[parts.length - 1] || fallbackId || 'record';
  const hintedTitle = simulatedOpDetailHints.get(path)?.title;

  if (col === 'productResearches') {
    const title = String(data?.title || hintedTitle || docId);
    return { section: 'Prodotti', targetTitle: title };
  }
  if (col === 'homeArticles') {
    const room = String(data?.room || '');
    const section =
      room === '__spesa__' || docId.startsWith('spesa_')
        ? 'Spesa'
        : room === '__app_settings__' ||
            docId === 'app_settings_state' ||
            room === '__telemetry__' ||
            docId.startsWith('telemetry_')
          ? 'Impostazioni'
          : room === '__promemoria__' || docId.startsWith('rem_')
            ? 'Promemoria'
            : room === '__vinted__' || docId.startsWith('vinted_')
              ? 'Vinted'
              : room === '__documenti__' || docId.startsWith('doc_') || docId.startsWith('resdoc_') || docId.startsWith('artdoc_')
                ? 'Documenti'
                : room === '__macchina__' || docId.startsWith('car_')
                  ? 'Macchina'
                  : 'Archivio';
    const title = String(data?.name || hintedTitle || docId);
    return { section, targetTitle: title };
  }
  if (col === 'climateLogs') {
    const mode = data?.mode ? String(data.mode) : 'Clima';
    const date = data?.date ? String(data.date) : '';
    const title = hintedTitle || [mode, date].filter(Boolean).join(' · ') || docId;
    return { section: 'Clima & Domotica', targetTitle: title };
  }
  if (col === 'vmcDays') {
    return {
      section: 'Clima & Domotica',
      targetTitle: String(data?.date ? `VMC ${data.date}` : hintedTitle || docId),
    };
  }
  if (col === 'energyReadings') {
    return {
      section: 'Consumi Annuali',
      targetTitle: String(data?.date || hintedTitle || docId),
    };
  }
  if (col === 'electricityBills') {
    return {
      section: 'Bollette Luce',
      targetTitle: String(data?.period || data?.invoiceNumber || hintedTitle || docId),
    };
  }
  if (col === 'waterBills') {
    return {
      section: 'Bollette Acqua',
      targetTitle: String(data?.period || data?.invoiceNumber || hintedTitle || docId),
    };
  }
  if (col === 'tariBills') {
    return {
      section: 'TARI',
      targetTitle: String(data?.period || data?.noticeNumber || hintedTitle || docId),
    };
  }
  if (col === 'gsePayments') {
    return {
      section: 'GSE',
      targetTitle: String(data?.period || data?.paymentDate || hintedTitle || docId),
    };
  }
  if (col === 'homeConfig') {
    return {
      section: 'Impianto',
      targetTitle: String(data?.podCode ? `POD ${data.podCode}` : 'Configurazione impianto'),
    };
  }
  return {
    section: col,
    targetTitle: String(data?.title || data?.name || hintedTitle || docId),
  };
}

const registeredBaseCollections = new Map<string, Map<string, Record<string, unknown>>>();

function lookupRegisteredBaseDoc(path: string): {
  known: boolean;
  baseDoc: Record<string, unknown> | undefined;
} {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const lastSlash = clean.lastIndexOf('/');
  if (lastSlash <= 0) return { known: false, baseDoc: undefined };
  const colPath = clean.slice(0, lastSlash);
  const docId = clean.slice(lastSlash + 1);
  const colMap = registeredBaseCollections.get(colPath);
  if (!colMap) return { known: false, baseDoc: undefined };
  return { known: true, baseDoc: colMap.get(docId) };
}

export function hasRegisteredBaseDoc(path: string): boolean {
  const res = lookupRegisteredBaseDoc(path);
  return Boolean(res.known && res.baseDoc);
}

export function getRegisteredBaseDocData(path: string): Record<string, unknown> | undefined {
  const res = lookupRegisteredBaseDoc(path);
  return res.known && res.baseDoc ? { ...res.baseDoc } : undefined;
}

function normalizeFirestoreValueForCompare(val: unknown): unknown {
  if (val === undefined || val === null) return val;
  if (typeof val === 'number') return Object.is(val, -0) ? 0 : val;
  if (typeof val !== 'object') return val;
  if (val instanceof Timestamp) {
    return { __fsTsMs: val.toMillis() };
  }
  if (val instanceof Date) {
    return { __fsTsMs: val.getTime() };
  }
  if (
    typeof (val as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return { __fsTsMs: (val as { toMillis: () => number }).toMillis() };
  }
  if (Array.isArray(val)) {
    return val.map((entry) => normalizeFirestoreValueForCompare(entry));
  }
  if (isPlainObject(val)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(val).sort()) {
      const v = val[k];
      if (v === undefined) continue;
      out[k] = normalizeFirestoreValueForCompare(v);
    }
    return out;
  }
  return val;
}

function areFirestoreValuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeFirestoreValueForCompare(a);
  const nb = normalizeFirestoreValueForCompare(b);
  if (na === nb) return true;
  if (na === undefined || nb === undefined || na === null || nb === null) {
    return na === nb;
  }
  if (typeof na !== typeof nb || typeof na !== 'object') return false;
  if (Array.isArray(na) || Array.isArray(nb)) {
    if (!Array.isArray(na) || !Array.isArray(nb) || na.length !== nb.length) return false;
    for (let i = 0; i < na.length; i += 1) {
      if (!areFirestoreValuesEqual(na[i], nb[i])) return false;
    }
    return true;
  }
  const objA = na as Record<string, unknown>;
  const objB = nb as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!(k in objB) || !areFirestoreValuesEqual(objA[k], objB[k])) return false;
  }
  return true;
}

function inferDetailFieldKey(detail: string): string | null {
  const lower = detail.trim().toLowerCase();
  if (lower.startsWith('colore:')) return 'color';
  if (lower.startsWith('taglia:')) return 'size';
  if (lower.startsWith('stanza:')) return 'room';
  if (lower.startsWith('stato:')) return 'status';
  if (lower.startsWith('prezzo:')) return 'priceEur';
  if (lower.startsWith('pagato:')) return 'paidPriceEur';
  if (lower.startsWith('marca:') || lower.startsWith('fornitore:')) return 'brand';
  if (lower.startsWith('negozio:')) return 'store';
  if (lower.startsWith('categoria:')) return 'category';
  if (lower.startsWith('modello:')) return 'model';
  if (lower.startsWith('titolo')) return 'title';
  if (lower.startsWith('immagine')) return 'imageUrl';
  if (lower.startsWith('link url')) return 'url';
  if (
    lower.startsWith('specifiche') ||
    lower.startsWith('specifica ') ||
    lower.startsWith('punto chiave') ||
    lower.startsWith('punti chiave') ||
    lower.startsWith('prezzi supermercati')
  ) {
    return 'specs';
  }
  if (
    lower.startsWith('varianti colore') ||
    lower.startsWith('colore aggiunt') ||
    lower.startsWith('colori aggiunt') ||
    lower.startsWith('colore rimoss') ||
    lower.startsWith('colori rimoss')
  ) {
    return 'availableColors';
  }
  if (
    lower.startsWith('varianti taglia') ||
    lower.startsWith('taglia aggiunt') ||
    lower.startsWith('taglie aggiunt') ||
    lower.startsWith('taglia rimoss') ||
    lower.startsWith('taglie rimoss')
  ) {
    return 'availableSizes';
  }
  if (lower.startsWith('foto per variante')) return 'colorImages';
  if (lower.startsWith('note')) return 'notes';
  if (lower.startsWith('nome:')) return 'name';
  if (lower.startsWith('data ')) return 'purchaseDate';
  if (lower.startsWith('scadenza:') || lower.startsWith('fine garanzia:')) return 'warrantyEnd';
  if (
    lower.startsWith('garanzia extra') ||
    lower.includes('lista spesa') ||
    lower.includes('evidenza')
  ) {
    return 'familyWarranty';
  }
  if (lower.startsWith('tipo allegato:') || lower.startsWith('riferimento') || lower.startsWith('seriale')) {
    return 'serialNumber';
  }
  if (lower.startsWith('manuale:')) return 'manualFileKey';
  if (lower.startsWith('ariston:')) return 'aristonMode';
  if (lower.startsWith('profilo:')) return 'aristonProfile';
  if (lower.startsWith('mandata:')) return 'floorFlowTemp';
  if (lower.startsWith('acs:')) return 'dhwTargetTemp';
  if (lower.startsWith('zona giorno:')) return 'zoneLivingTarget';
  if (lower.startsWith('zona notte:')) return 'zoneBedroomTarget';
  if (lower.startsWith('nea smart:')) return 'neasmartPower';
  if (lower.startsWith('umidità:')) return 'neasmartTargetHumidity';
  if (lower.startsWith('ventole:')) return 'neasmartFanSpeed';
  if (lower.startsWith('tariffa:')) return 'tariffEurPerKwh';
  if (lower.startsWith('pod:')) return 'podCode';
  return null;
}

const MULTI_VALUE_DETAIL_FIELDS = new Set(['specs', 'availableColors', 'availableSizes']);

function mergeDetailsForCompactedOp(
  opsForPath: SimulatedFirestoreOp[],
  netChangedFields: string[],
  isNewDoc: boolean
): string[] | undefined {
  const lastOp = opsForPath[opsForPath.length - 1];
  if (isNewDoc) {
    return lastOp.changedDetails && lastOp.changedDetails.length > 0
      ? lastOp.changedDetails
      : opsForPath[0]?.changedDetails;
  }
  const netSet = new Set(netChangedFields);
  const lastFieldSet = new Set(
    (lastOp.changedFields || []).filter((f) => f !== '__new__' && f !== '__delete__')
  );
  // If the last operation already computed details against the original base doc,
  // its changedFields match netChangedFields directly (excluding ancillary fields without chips).
  const ancillaryFields = new Set([
    'availableColors',
    'availableSizes',
    'colorImages',
    'manualExtractText',
    'manualFileName',
  ]);
  const allLastMatchNet =
    lastFieldSet.size > 0 &&
    Array.from(lastFieldSet).every((f) => netSet.has(f)) &&
    Array.from(netSet).every((f) => lastFieldSet.has(f) || ancillaryFields.has(f));

  if (allLastMatchNet) {
    return lastOp.changedDetails && lastOp.changedDetails.length > 0
      ? lastOp.changedDetails
      : undefined;
  }

  // Fallback: keep only details from earlier ops whose inferred field is still in netSet.
  // For multi-value fields (specs, availableColors, availableSizes), keep all details from the latest op that touched that field.
  const collected: string[] = [];
  const byPrefix = new Map<string, string>();
  const latestMultiFieldDetails = new Map<string, string[]>();
  for (const op of opsForPath) {
    const multiInThisOp = new Map<string, string[]>();
    for (const detail of op.changedDetails || []) {
      const inferredKey = inferDetailFieldKey(detail);
      if (inferredKey && !netSet.has(inferredKey)) {
        // Also support homeArticles using purchasePriceEur for "Prezzo:"
        if (!(inferredKey === 'priceEur' && netSet.has('purchasePriceEur'))) {
          continue;
        }
      }
      if (inferredKey && MULTI_VALUE_DETAIL_FIELDS.has(inferredKey)) {
        const list = multiInThisOp.get(inferredKey) || [];
        if (!list.includes(detail)) list.push(detail);
        multiInThisOp.set(inferredKey, list);
        continue;
      }
      const colonIdx = detail.indexOf(':');
      const prefix = colonIdx > 0 ? detail.slice(0, colonIdx + 1).toLowerCase() : detail.toLowerCase();
      byPrefix.set(prefix, detail);
    }
    multiInThisOp.forEach((vals, key) => {
      latestMultiFieldDetails.set(key, vals);
    });
  }
  byPrefix.forEach((val) => collected.push(val));
  latestMultiFieldDetails.forEach((vals) => {
    for (const v of vals) {
      if (!collected.includes(v)) collected.push(v);
    }
  });
  return collected.length > 0 ? collected : undefined;
}

function finalizeUpdatedBatchOp(
  origBatch: SimulatedFirestoreOp,
  nextSubOps: SimulatedBatchSubOp[]
): SimulatedFirestoreOp | null {
  if (nextSubOps.length === 0) return null;
  if (nextSubOps.length === 1) {
    const sole = nextSubOps[0];
    const desc = describePathSectionAndTitle(sole.path, sole.data);
    if (sole.op === 'delete') {
      return {
        id: origBatch.id,
        kind: 'delete',
        createdAt: origBatch.createdAt,
        section: desc.section,
        actionLabel: 'Eliminazione',
        targetTitle: desc.targetTitle,
        writeCount: 1,
        queuedReason: origBatch.queuedReason,
        path: sole.path,
      };
    }
    if (sole.op === 'set') {
      const keepPrevLabels = origBatch.batchOps?.length === 1;
      return {
        id: origBatch.id,
        kind: 'set',
        createdAt: origBatch.createdAt,
        section: desc.section,
        actionLabel: keepPrevLabels
          ? origBatch.actionLabel
          : sole.options?.merge
            ? 'Modifica'
            : 'Salvataggio',
        targetTitle: desc.targetTitle,
        writeCount: 1,
        queuedReason: origBatch.queuedReason,
        path: sole.path,
        data: sole.data,
        options: sole.options,
        changedFields: keepPrevLabels ? origBatch.changedFields : undefined,
        changedDetails: keepPrevLabels ? origBatch.changedDetails : undefined,
      };
    }
    return {
      ...origBatch,
      section: desc.section,
      targetTitle: desc.targetTitle,
      writeCount: 1,
      batchOps: nextSubOps,
    };
  }

  const first = nextSubOps[0];
  const desc = describePathSectionAndTitle(first.path, first.data);
  return {
    ...origBatch,
    section: desc.section,
    targetTitle: `${desc.targetTitle} (+${nextSubOps.length - 1})`,
    writeCount: nextSubOps.length,
    batchOps: nextSubOps,
  };
}

function extractVaultKeyFromSpecs(specs: unknown): string | null {
  if (typeof specs !== 'string' || !specs) return null;
  const m = specs.match(/(?:^|\|)KEY:([^|]+)/);
  return m?.[1]?.trim() || null;
}

function isVaultKeyPresentInRegisteredBase(fileKey: string): boolean {
  if (!fileKey) return false;
  for (const [colPath, docsMap] of registeredBaseCollections.entries()) {
    if (colPath.endsWith('/homeArticles')) {
      for (const docData of docsMap.values()) {
        if (
          docData.attachmentKey === fileKey ||
          docData.manualFileKey === fileKey ||
          docData.pdfFileKey === fileKey ||
          extractVaultKeyFromSpecs(docData.specs) === fileKey
        ) {
          return true;
        }
      }
    } else if (colPath.endsWith('/gsePayments')) {
      for (const docData of docsMap.values()) {
        if (docData.attachmentFileKey === fileKey) {
          return true;
        }
      }
    } else if (colPath.endsWith('/electricityBills')) {
      for (const docData of docsMap.values()) {
        if (docData.pdfFileKey === fileKey) return true;
        if (typeof docData.invoiceNumber === 'string' && docData.invoiceNumber) {
          const slug = docData.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
          if (`bill_elec_${slug || 'unknown'}` === fileKey) return true;
        }
      }
    } else if (colPath.endsWith('/waterBills')) {
      for (const docData of docsMap.values()) {
        if (docData.pdfFileKey === fileKey) return true;
        if (typeof docData.invoiceNumber === 'string' && docData.invoiceNumber) {
          const slug = docData.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
          if (`bill_water_${slug || 'unknown'}` === fileKey) return true;
        }
      }
    } else if (colPath.endsWith('/tariBills')) {
      for (const docData of docsMap.values()) {
        if (docData.pdfFileKey === fileKey) return true;
        if (typeof docData.noticeNumber === 'string' && docData.noticeNumber) {
          const slug = docData.noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '');
          if (`bill_tari_${slug || 'unknown'}` === fileKey) return true;
        }
      }
    }
  }
  return false;
}

function compactVaultOps(ops: SimulatedFirestoreOp[]): SimulatedFirestoreOp[] {
  const uploadedIndicesByKey = new Map<string, number[]>();
  const uploadIndicesToDrop = new Set<number>();
  const deletedKeysToDropByOpIndex = new Map<number, Set<string>>();

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (op.kind === 'vault_upload' && op.vaultUpload?.fileKey) {
      const k = op.vaultUpload.fileKey;
      localOnlyVaultUploadKeys.add(k);
      const list = uploadedIndicesByKey.get(k) || [];
      list.push(i);
      uploadedIndicesByKey.set(k, list);
    } else if (op.kind === 'vault_delete' && op.vaultDelete?.keys?.length) {
      for (const k of op.vaultDelete.keys) {
        const prevUploads = uploadedIndicesByKey.get(k);
        const createdLocallyOnly =
          Boolean(prevUploads && prevUploads.length > 0) || localOnlyVaultUploadKeys.has(k);
        if (prevUploads && prevUploads.length > 0) {
          for (const idx of prevUploads) {
            uploadIndicesToDrop.add(idx);
          }
          uploadedIndicesByKey.delete(k);
        }
        if (createdLocallyOnly && !isVaultKeyPresentInRegisteredBase(k)) {
          let dropSet = deletedKeysToDropByOpIndex.get(i);
          if (!dropSet) {
            dropSet = new Set<string>();
            deletedKeysToDropByOpIndex.set(i, dropSet);
          }
          dropSet.add(k);
          localOnlyVaultUploadKeys.delete(k);
        }
      }
    }
  }

  if (uploadIndicesToDrop.size === 0 && deletedKeysToDropByOpIndex.size === 0) {
    return ops;
  }

  const next: SimulatedFirestoreOp[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (uploadIndicesToDrop.has(i)) continue;
    const op = ops[i];
    const keysToDrop = deletedKeysToDropByOpIndex.get(i);
    if (op.kind === 'vault_delete' && op.vaultDelete && keysToDrop && keysToDrop.size > 0) {
      const remainingKeys = op.vaultDelete.keys.filter((k) => !keysToDrop.has(k));
      if (remainingKeys.length === 0) continue;
      next.push({
        ...op,
        targetTitle:
          remainingKeys.length === 1 ? remainingKeys[0] : `${remainingKeys.length} allegati`,
        writeCount: remainingKeys.length * 2,
        vaultDelete: {
          ...op.vaultDelete,
          keys: remainingKeys,
        },
      });
      continue;
    }
    next.push(op);
  }
  return next;
}

function compactSinglePathOps(
  ops: SimulatedFirestoreOp[],
  targetPath: string
): SimulatedFirestoreOp[] {
  const cleanTarget = targetPath.replace(/^\/+|\/+$/g, '');
  if (!cleanTarget) return ops;

  const { known, baseDoc } = lookupRegisteredBaseDoc(cleanTarget);
  if (!known) return ops;

  type PathOccurrence =
    | { kind: 'standalone'; opIndex: number; op: SimulatedFirestoreOp }
    | {
        kind: 'batchSub';
        opIndex: number;
        subIndex: number;
        parentOp: SimulatedFirestoreOp;
        subOp: SimulatedBatchSubOp;
      };

  const occurrences: PathOccurrence[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (
      (op.kind === 'set' || op.kind === 'delete') &&
      op.path &&
      op.path.replace(/^\/+|\/+$/g, '') === cleanTarget
    ) {
      occurrences.push({ kind: 'standalone', opIndex: i, op });
    } else if (op.kind === 'batch' && op.batchOps?.length) {
      for (let j = 0; j < op.batchOps.length; j += 1) {
        const sub = op.batchOps[j];
        if (sub.path.replace(/^\/+|\/+$/g, '') === cleanTarget) {
          occurrences.push({
            kind: 'batchSub',
            opIndex: i,
            subIndex: j,
            parentOp: op,
            subOp: sub,
          });
        }
      }
    }
  }
  if (occurrences.length === 0) return ops;

  let state: Record<string, unknown> | undefined = baseDoc ? { ...baseDoc } : undefined;
  let currentSerializedPatch: Record<string, unknown> = {};
  let isFullOverwrite = false;
  let wasDeleted = false;
  let hasUpdateSubOp = false;

  for (const occ of occurrences) {
    const ts = occ.kind === 'standalone' ? occ.op.createdAt : occ.parentOp.createdAt;
    const opKind = occ.kind === 'standalone' ? occ.op.kind : occ.subOp.op;
    const patch = (occ.kind === 'standalone' ? occ.op.data : occ.subOp.data) || {};
    const mergeOpt =
      occ.kind === 'standalone' ? Boolean(occ.op.options?.merge) : Boolean(occ.subOp.options?.merge);

    if (opKind === 'delete') {
      wasDeleted = true;
      isFullOverwrite = false;
      hasUpdateSubOp = false;
      currentSerializedPatch = {};
      state = undefined;
    } else if (opKind === 'set') {
      wasDeleted = false;
      if (!mergeOpt) {
        isFullOverwrite = true;
        hasUpdateSubOp = false;
        currentSerializedPatch = { ...patch };
        state = applySerializedPatchToRawDoc(undefined, patch, false, ts);
      } else {
        currentSerializedPatch = { ...currentSerializedPatch, ...patch };
        state = applySerializedPatchToRawDoc(state, patch, true, ts);
      }
    } else if (opKind === 'update') {
      wasDeleted = false;
      hasUpdateSubOp = true;
      currentSerializedPatch = { ...currentSerializedPatch, ...patch };
      state = applySerializedPatchToRawDoc(state, patch, true, ts);
    }
  }

  const hasBatchOccurrence = occurrences.some((occ) => occ.kind === 'batchSub');
  const firstOcc = occurrences[0];
  const lastOcc = occurrences[occurrences.length - 1];
  const firstStandalone =
    firstOcc.kind === 'standalone' ? firstOcc.op : firstOcc.parentOp;
  const lastStandalone =
    lastOcc.kind === 'standalone' ? lastOcc.op : lastOcc.parentOp;
  const standaloneOnlyOps = occurrences
    .filter((o): o is Extract<PathOccurrence, { kind: 'standalone' }> => o.kind === 'standalone')
    .map((o) => o.op);

  let netZero = false;
  let compactedStandalone: SimulatedFirestoreOp | null = null;
  let compactedBatchSub: SimulatedBatchSubOp | null = null;

  if (wasDeleted) {
    if (!baseDoc) {
      // Created locally and deleted locally before flushing: net zero DB ops.
      netZero = true;
    } else {
      if (occurrences.length === 1 && !hasBatchOccurrence) return ops;
      compactedStandalone = {
        ...lastStandalone,
        kind: 'delete',
        writeCount: 1,
        path: cleanTarget,
      };
      compactedBatchSub = { op: 'delete', path: cleanTarget };
    }
  } else if (!baseDoc) {
    if (occurrences.length === 1) {
      return ops;
    }
    const desc = describePathSectionAndTitle(cleanTarget, currentSerializedPatch);
    const mergeFlag = isFullOverwrite && !hasUpdateSubOp ? undefined : { merge: true };
    compactedStandalone = {
      ...firstStandalone,
      kind: 'set',
      createdAt: lastStandalone.createdAt,
      path: cleanTarget,
      section: firstStandalone.section || desc.section,
      groupKey: lastStandalone.groupKey || firstStandalone.groupKey,
      groupSection: lastStandalone.groupSection || firstStandalone.groupSection,
      groupTitle: lastStandalone.groupTitle || firstStandalone.groupTitle,
      targetTitle:
        (lastOcc.kind === 'standalone' ? lastOcc.op.targetTitle : undefined) || desc.targetTitle,
      writeCount: 1,
      data: currentSerializedPatch,
      options: mergeFlag,
      changedFields: firstStandalone.changedFields?.includes('__new__')
        ? ['__new__']
        : firstStandalone.changedFields,
      changedDetails:
        standaloneOnlyOps.length > 0
          ? mergeDetailsForCompactedOp(standaloneOnlyOps, [], true)
          : firstStandalone.changedDetails,
    };
    compactedBatchSub = {
      op: hasUpdateSubOp && !isFullOverwrite ? 'update' : 'set',
      path: cleanTarget,
      data: currentSerializedPatch,
      options: mergeFlag,
    };
  } else {
    const finalState = state || {};
    const allKeys = new Set<string>([
      ...Object.keys(baseDoc),
      ...Object.keys(finalState),
    ]);
    const metaKeys = new Set(['updatedAt', 'createdAt']);
    const netChangedNonMetaKeys: string[] = [];

    for (const k of allKeys) {
      if (metaKeys.has(k)) continue;
      if (k === 'ownerId' && areFirestoreValuesEqual(baseDoc.ownerId, finalState.ownerId)) {
        continue;
      }
      const inBase = k in baseDoc && baseDoc[k] !== undefined;
      const inFinal = k in finalState && finalState[k] !== undefined;
      if (!inBase && !inFinal) continue;
      if (inBase && inFinal && areFirestoreValuesEqual(baseDoc[k], finalState[k])) {
        continue;
      }
      netChangedNonMetaKeys.push(k);
    }

    if (netChangedNonMetaKeys.length === 0) {
      // Every real field returned to its exact original Firestore value: net zero DB ops.
      netZero = true;
    } else if (occurrences.length === 1) {
      return ops;
    } else {
      let compactData: Record<string, unknown>;
      const compactMerge = !isFullOverwrite;

      if (!isFullOverwrite) {
        compactData = {};
        if ('ownerId' in currentSerializedPatch) {
          compactData.ownerId = currentSerializedPatch.ownerId;
        } else if (baseDoc.ownerId !== undefined) {
          compactData.ownerId = baseDoc.ownerId;
        }
        for (const k of netChangedNonMetaKeys) {
          if (k in currentSerializedPatch) {
            compactData[k] = currentSerializedPatch[k];
          } else if (k in finalState && finalState[k] !== undefined) {
            compactData[k] = serializeFirestoreValue(finalState[k]);
          } else {
            compactData[k] = { __fsSentinel: 'deleteField' };
          }
        }
        if ('updatedAt' in currentSerializedPatch) {
          compactData.updatedAt = currentSerializedPatch.updatedAt;
        }
      } else {
        compactData = currentSerializedPatch;
      }

      const desc = describePathSectionAndTitle(cleanTarget, compactData);
      compactedStandalone = {
        ...lastStandalone,
        kind: 'set',
        path: cleanTarget,
        section: desc.section,
        groupKey: lastStandalone.groupKey || firstStandalone.groupKey,
        groupSection: lastStandalone.groupSection || firstStandalone.groupSection,
        groupTitle: lastStandalone.groupTitle || firstStandalone.groupTitle,
        actionLabel:
          firstStandalone.actionLabel === 'Nuovo prodotto'
            ? 'Nuovo prodotto'
            : lastOcc.kind === 'standalone'
              ? lastOcc.op.actionLabel
              : 'Modifica',
        targetTitle: desc.targetTitle,
        writeCount: 1,
        data: compactData,
        options: compactMerge ? { merge: true } : undefined,
        changedFields: netChangedNonMetaKeys,
        changedDetails:
          standaloneOnlyOps.length > 0
            ? mergeDetailsForCompactedOp(standaloneOnlyOps, netChangedNonMetaKeys, false)
            : undefined,
      };
      compactedBatchSub = {
        op: hasUpdateSubOp && !isFullOverwrite ? 'update' : 'set',
        path: cleanTarget,
        data: compactData,
        options: compactMerge ? { merge: true } : undefined,
      };
    }
  }

  // Rebuild ops list: remove cleanTarget from all earlier occurrences,
  // and either remove from last occurrence too (if netZero) or replace at last occurrence.
  const compacted: SimulatedFirestoreOp[] = [];
  const lastOpIndex = lastOcc.opIndex;
  const lastSubIndex = lastOcc.kind === 'batchSub' ? lastOcc.subIndex : -1;

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (
      (op.kind === 'set' || op.kind === 'delete') &&
      op.path &&
      op.path.replace(/^\/+|\/+$/g, '') === cleanTarget
    ) {
      if (!netZero && i === lastOpIndex && compactedStandalone) {
        compacted.push(compactedStandalone);
      }
      continue;
    }

    if (
      op.kind === 'batch' &&
      op.batchOps?.some((sub) => sub.path.replace(/^\/+|\/+$/g, '') === cleanTarget)
    ) {
      const nextSubOps: SimulatedBatchSubOp[] = [];
      for (let j = 0; j < op.batchOps.length; j += 1) {
        const sub = op.batchOps[j];
        if (sub.path.replace(/^\/+|\/+$/g, '') !== cleanTarget) {
          nextSubOps.push(sub);
          continue;
        }
        if (!netZero && i === lastOpIndex && j === lastSubIndex && compactedBatchSub) {
          nextSubOps.push(compactedBatchSub);
        }
      }
      const finalized = finalizeUpdatedBatchOp(op, nextSubOps);
      if (finalized) {
        compacted.push(finalized);
      }
      continue;
    }

    compacted.push(op);
  }

  return compacted;
}

function compactSimulatedOpsList(
  ops: SimulatedFirestoreOp[],
  targetPaths?: string | string[]
): SimulatedFirestoreOp[] {
  let next = compactVaultOps(ops);
  if (targetPaths) {
    const paths = Array.isArray(targetPaths) ? targetPaths : [targetPaths];
    for (const p of paths) {
      next = compactSinglePathOps(next, p);
    }
    return next;
  }

  const uniquePaths = new Set<string>();
  for (const op of next) {
    if ((op.kind === 'set' || op.kind === 'delete') && op.path) {
      uniquePaths.add(op.path);
    } else if (op.kind === 'batch' && op.batchOps) {
      for (const sub of op.batchOps) {
        if (sub.path) uniquePaths.add(sub.path);
      }
    }
  }
  for (const path of uniquePaths) {
    next = compactSinglePathOps(next, path);
  }
  return next;
}

const SIMULATED_META_KEYS = new Set(['ownerId', 'updatedAt', 'createdAt']);
const RESEARCH_ROOM_LABELS_MAP: Record<string, string> = {
  cucina: 'Cucina',
  bagno1: 'Bagno 1',
  bagno2: 'Bagno 2',
  soggiorno: 'Soggiorno',
  camera_matrimoniale: 'Camera matrimoniale',
  studio_gaming: 'Studio / Camera gaming',
  ripostiglio: 'Ripostiglio',
  terrazza_ovest: 'Terrazza Ovest',
  terrazza_est: 'Terrazza Est',
};
const RESEARCH_STATUS_LABELS_MAP: Record<string, string> = {
  da_valutare: 'Da valutare',
  acquistato: 'Acquistato',
  scartato: 'Scartato',
};

function formatFoldedEuro(val: unknown): string {
  return typeof val === 'number' && Number.isFinite(val)
    ? `${val.toFixed(2).replace('.', ',')} €`
    : '—';
}

function getOpNonMetaKeys(op: SimulatedFirestoreOp): string[] {
  if (!op.data) return [];
  return Object.keys(op.data).filter((k) => !SIMULATED_META_KEYS.has(k));
}

function isDocTypeMergeOp(cleanPath: string, op: SimulatedFirestoreOp): boolean {
  if (!cleanPath.includes('/homeArticles/')) return false;
  if (op.actionLabel === 'Tipo allegato aggiornato') return true;
  const keys = getOpNonMetaKeys(op);
  return (
    keys.includes('serialNumber') &&
    keys.every((k) => k === 'serialNumber' || k === 'category' || k === 'familyWarranty')
  );
}

function canFoldMergeOps(
  cleanPath: string,
  earlierOp: SimulatedFirestoreOp,
  incomingOp: SimulatedFirestoreOp
): boolean {
  if (isDocTypeMergeOp(cleanPath, earlierOp) && isDocTypeMergeOp(cleanPath, incomingOp)) {
    return true;
  }
  const earlierSet = new Set(getOpNonMetaKeys(earlierOp));
  const incomingKeys = getOpNonMetaKeys(incomingOp);
  return incomingKeys.some((k) => earlierSet.has(k));
}

function applySingleOpToState(
  state: Record<string, unknown> | undefined,
  op: SimulatedFirestoreOp,
  cleanTarget: string
): Record<string, unknown> | undefined {
  if (
    (op.kind === 'set' || op.kind === 'delete') &&
    op.path &&
    op.path.replace(/^\/+|\/+$/g, '') === cleanTarget
  ) {
    if (op.kind === 'delete') return undefined;
    const mergeOpt = Boolean(op.options?.merge);
    return applySerializedPatchToRawDoc(mergeOpt ? state : undefined, op.data || {}, mergeOpt, op.createdAt);
  }
  if (op.kind === 'batch' && op.batchOps?.length) {
    let nextState = state;
    for (const sub of op.batchOps) {
      if (sub.path.replace(/^\/+|\/+$/g, '') !== cleanTarget) continue;
      if (sub.op === 'delete') {
        nextState = undefined;
      } else {
        const mergeOpt = sub.op === 'update' || Boolean(sub.options?.merge);
        nextState = applySerializedPatchToRawDoc(
          mergeOpt ? nextState : undefined,
          sub.data || {},
          mergeOpt,
          op.createdAt
        );
      }
    }
    return nextState;
  }
  return state;
}

function parseDocTypeFromSerialVal(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const parts = val.split('|');
  if (parts.length === 3 && (parts[0] === 'RESDOC' || parts[0] === 'ARTDOC')) {
    return parts[2] || null;
  }
  return null;
}

function buildFoldedChangedDetails(
  cleanPath: string,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
  netKeys: string[],
  earlierOp: SimulatedFirestoreOp,
  incomingOp: SimulatedFirestoreOp
): string[] | undefined {
  const details: string[] = [];
  const handled = new Set<string>();
  const isResearch = cleanPath.includes('/productResearches/');
  const isDocArticle =
    cleanPath.includes('/homeArticles/doc_') ||
    cleanPath.includes('/homeArticles/resdoc_') ||
    cleanPath.includes('/homeArticles/artdoc_') ||
    String(afterState.room || beforeState.room || '') === '__documenti__';

  if (isResearch) {
    for (const key of netKeys) {
      const prev = beforeState[key];
      const next = afterState[key];
      if (key === 'color') {
        handled.add(key);
        const p = typeof prev === 'string' && prev.trim() ? prev.trim() : 'Nessuno';
        const n = typeof next === 'string' && next.trim() ? next.trim() : 'Rimosso';
        details.push(`Colore: ${p} → ${n}`);
      } else if (key === 'size') {
        handled.add(key);
        const p = typeof prev === 'string' && prev.trim() ? prev.trim() : 'Nessuna';
        const n = typeof next === 'string' && next.trim() ? next.trim() : 'Rimossa';
        details.push(`Taglia: ${p} → ${n}`);
      } else if (key === 'room') {
        handled.add(key);
        const pKey = typeof prev === 'string' ? prev.trim() : '';
        const nKey = typeof next === 'string' ? next.trim() : '';
        const pLabel = pKey ? RESEARCH_ROOM_LABELS_MAP[pKey] || pKey : 'Senza stanza';
        const nLabel = nKey ? RESEARCH_ROOM_LABELS_MAP[nKey] || nKey : 'Senza stanza';
        details.push(`Stanza: ${pLabel} → ${nLabel}`);
      } else if (key === 'status') {
        handled.add(key);
        const pKey = typeof prev === 'string' ? prev : 'da_valutare';
        const nKey = typeof next === 'string' ? next : 'da_valutare';
        details.push(
          `Stato: ${RESEARCH_STATUS_LABELS_MAP[pKey] || pKey} → ${RESEARCH_STATUS_LABELS_MAP[nKey] || nKey}`
        );
      } else if (key === 'priceEur') {
        handled.add(key);
        details.push(`Prezzo: ${formatFoldedEuro(prev)} → ${formatFoldedEuro(next)}`);
      } else if (key === 'paidPriceEur') {
        handled.add(key);
        details.push(`Pagato: ${formatFoldedEuro(prev)} → ${formatFoldedEuro(next)}`);
      } else if (key === 'title') {
        handled.add(key);
        details.push('Titolo aggiornato');
      } else if (key === 'imageUrl') {
        handled.add(key);
        details.push('Immagine aggiornata');
      } else if (key === 'notes') {
        handled.add(key);
        const nStr = typeof next === 'string' ? next.trim() : '';
        details.push(nStr ? `Note: "${nStr.length > 26 ? `${nStr.slice(0, 25)}…` : nStr}"` : 'Note rimosse');
      } else if (key === 'specs') {
        handled.add(key);
        details.push('Specifiche aggiornate');
      } else if (key === 'familyWarranty') {
        handled.add(key);
        details.push(
          next === true
            ? 'Assicurazione Extra Family attivata'
            : 'Assicurazione Extra Family disattivata'
        );
      } else if (key === 'availableColors' || key === 'availableSizes' || key === 'colorImages') {
        handled.add(key);
      }
    }
  } else if (cleanPath.includes('/homeArticles/')) {
    for (const key of netKeys) {
      const prev = beforeState[key];
      const next = afterState[key];
      if (key === 'serialNumber') {
        const pType = parseDocTypeFromSerialVal(prev);
        const nType = parseDocTypeFromSerialVal(next);
        if (pType && nType && pType !== nType) {
          handled.add(key);
          details.push(`Tipo allegato: ${pType} → ${nType}`);
        }
      } else if (key === 'category' && isDocArticle) {
        handled.add(key);
        details.push(`Categoria: ${String(prev || '—')} → ${String(next || '—')}`);
      } else if (key === 'familyWarranty' && isDocArticle) {
        handled.add(key);
        details.push(next ? 'Documento in evidenza' : 'Rimosso da evidenza');
      } else if (key === 'room') {
        handled.add(key);
        details.push(`Stanza: ${String(prev || '—')} → ${String(next || '—')}`);
      }
    }
  }

  const remainingKeys = netKeys.filter((k) => !handled.has(k));
  if (remainingKeys.length > 0) {
    const fallback = mergeDetailsForCompactedOp([earlierOp, incomingOp], remainingKeys, false) || [];
    for (const item of fallback) {
      if (!details.includes(item)) details.push(item);
    }
  }

  return details.length > 0 ? details : undefined;
}

function isPathNetZeroAgainstBase(
  ops: SimulatedFirestoreOp[],
  cleanTarget: string
): boolean {
  const { known, baseDoc } = lookupRegisteredBaseDoc(cleanTarget);
  if (!known || !baseDoc) return false;

  let state: Record<string, unknown> | undefined = { ...baseDoc };
  let wasDeleted = false;
  let touched = false;

  for (const op of ops) {
    if (
      (op.kind === 'set' || op.kind === 'delete') &&
      op.path?.replace(/^\/+|\/+$/g, '') === cleanTarget
    ) {
      touched = true;
      wasDeleted = op.kind === 'delete';
      state = applySingleOpToState(state, op, cleanTarget);
    } else if (
      op.kind === 'batch' &&
      op.batchOps?.some((s) => s.path.replace(/^\/+|\/+$/g, '') === cleanTarget)
    ) {
      touched = true;
      for (const s of op.batchOps) {
        if (s.path.replace(/^\/+|\/+$/g, '') === cleanTarget) {
          wasDeleted = s.op === 'delete';
        }
      }
      state = applySingleOpToState(state, op, cleanTarget);
    }
  }

  if (!touched || wasDeleted) return false;
  const finalState = state || {};
  const allKeys = new Set([...Object.keys(baseDoc), ...Object.keys(finalState)]);
  for (const k of allKeys) {
    if (SIMULATED_META_KEYS.has(k)) continue;
    const inBase = k in baseDoc && baseDoc[k] !== undefined;
    const inFinal = k in finalState && finalState[k] !== undefined;
    if (!inBase && !inFinal) continue;
    if (inBase && inFinal && areFirestoreValuesEqual(baseDoc[k], finalState[k])) continue;
    return false;
  }
  return true;
}

function stripPathFromOps(ops: SimulatedFirestoreOp[], cleanTarget: string): SimulatedFirestoreOp[] {
  const next: SimulatedFirestoreOp[] = [];
  for (const op of ops) {
    if (
      (op.kind === 'set' || op.kind === 'delete') &&
      op.path?.replace(/^\/+|\/+$/g, '') === cleanTarget
    ) {
      continue;
    }
    if (
      op.kind === 'batch' &&
      op.batchOps?.some((sub) => sub.path.replace(/^\/+|\/+$/g, '') === cleanTarget)
    ) {
      const remaining = op.batchOps.filter(
        (sub) => sub.path.replace(/^\/+|\/+$/g, '') !== cleanTarget
      );
      const finalized = finalizeUpdatedBatchOp(op, remaining);
      if (finalized) next.push(finalized);
      continue;
    }
    next.push(op);
  }
  return next;
}

function foldOrEnqueueSimulatedOp(
  currentOps: SimulatedFirestoreOp[],
  incoming: SimulatedFirestoreOp
): SimulatedFirestoreOp[] {
  if (incoming.kind === 'vault_delete') {
    return compactVaultOps([...currentOps, incoming]);
  }

  const cleanPath = incoming.path?.replace(/^\/+|\/+$/g, '') || '';
  if (!cleanPath) {
    return [...currentOps, incoming];
  }

  if (incoming.kind === 'delete') {
    const withDelete = [...currentOps, incoming];
    const { known, baseDoc } = lookupRegisteredBaseDoc(cleanPath);
    const hadLocalCreation = currentOps.some(
      (o) =>
        (o.kind === 'set' &&
          !o.options?.merge &&
          o.path?.replace(/^\/+|\/+$/g, '') === cleanPath) ||
        (o.kind === 'batch' &&
          Boolean(
            o.batchOps?.some(
              (sub) =>
                sub.op === 'set' &&
                !sub.options?.merge &&
                sub.path.replace(/^\/+|\/+$/g, '') === cleanPath
            )
          ))
    );
    if ((known && !baseDoc) || (!known && hadLocalCreation)) {
      const pairedKeys = new Set<string>();
      for (const o of currentOps) {
        if (o.kind === 'set' && o.path?.replace(/^\/+|\/+$/g, '') === cleanPath) {
          for (const fk of collectPairedVaultFileKeys(o)) pairedKeys.add(fk);
        } else if (o.kind === 'batch' && o.batchOps?.length) {
          for (const sub of o.batchOps) {
            if (sub.path.replace(/^\/+|\/+$/g, '') === cleanPath) {
              for (const fk of collectVaultKeysFromRecord(sub.data)) pairedKeys.add(fk);
            }
          }
        }
      }
      for (const fk of pairedKeys) {
        localOnlyVaultUploadKeys.add(fk);
      }
      const stripped = stripPathFromOps(withDelete, cleanPath).filter(
        (o) => !(o.kind === 'vault_upload' && o.vaultUpload?.fileKey && pairedKeys.has(o.vaultUpload.fileKey))
      );
      return compactVaultOps(stripped);
    }
    return withDelete;
  }

  if (incoming.kind === 'set' && incoming.options?.merge) {
    const incomingNonMetaKeys = getOpNonMetaKeys(incoming);
    if (incomingNonMetaKeys.length > 0) {
      const laterTouchedKeys = new Set<string>();

      for (let i = currentOps.length - 1; i >= 0; i -= 1) {
        const cand = currentOps[i];
        const candCleanPath = cand.path?.replace(/^\/+|\/+$/g, '') || '';
        const touchesTarget =
          ((cand.kind === 'set' || cand.kind === 'delete') && candCleanPath === cleanPath) ||
          (cand.kind === 'batch' &&
            Boolean(cand.batchOps?.some((s) => s.path.replace(/^\/+|\/+$/g, '') === cleanPath)));

        if (!touchesTarget) continue;

        if (cand.kind !== 'set' || !cand.options?.merge) {
          // Reached creation / full-overwrite / delete boundary for this path
          break;
        }

        const candKeys = getOpNonMetaKeys(cand);
        const unionKeys = Array.from(new Set([...candKeys, ...incomingNonMetaKeys]));
        const hasInterveningConflict = unionKeys.some((k) => laterTouchedKeys.has(k));

        if (!hasInterveningConflict && canFoldMergeOps(cleanPath, cand, incoming)) {
          const { baseDoc } = lookupRegisteredBaseDoc(cleanPath);
          let beforeState: Record<string, unknown> | undefined = baseDoc ? { ...baseDoc } : undefined;
          for (let j = 0; j < i; j += 1) {
            beforeState = applySingleOpToState(beforeState, currentOps[j], cleanPath);
          }

          if (beforeState) {
            let afterState = applySingleOpToState(beforeState, cand, cleanPath);
            afterState = applySingleOpToState(afterState, incoming, cleanPath);
            const safeAfter = afterState || {};
            const netKeys: string[] = [];

            for (const k of unionKeys) {
              const inBefore = k in beforeState && beforeState[k] !== undefined;
              const inAfter = k in safeAfter && safeAfter[k] !== undefined;
              if (!inBefore && !inAfter) continue;
              if (inBefore && inAfter && areFirestoreValuesEqual(beforeState[k], safeAfter[k])) {
                continue;
              }
              netKeys.push(k);
            }

            if (netKeys.length === 0) {
              const withoutPair = currentOps.filter((_, idx) => idx !== i);
              return isPathNetZeroAgainstBase(withoutPair, cleanPath)
                ? stripPathFromOps(withoutPair, cleanPath)
                : withoutPair;
            }

            const mergedData: Record<string, unknown> = {};
            const ownerVal = incoming.data?.ownerId ?? cand.data?.ownerId;
            if (ownerVal !== undefined) mergedData.ownerId = ownerVal;
            const updatedVal = incoming.data?.updatedAt ?? cand.data?.updatedAt;
            if (updatedVal !== undefined) mergedData.updatedAt = updatedVal;

            for (const k of netKeys) {
              if (k in safeAfter && safeAfter[k] !== undefined) {
                mergedData[k] = serializeFirestoreValue(safeAfter[k]);
              } else {
                mergedData[k] = { __fsSentinel: 'deleteField' };
              }
            }

            const ancillaryKeys = new Set(['availableColors', 'availableSizes', 'colorImages']);
            const displayFields = netKeys.filter((k) => !ancillaryKeys.has(k));
            const resolvedDetails = buildFoldedChangedDetails(
              cleanPath,
              beforeState,
              safeAfter,
              netKeys,
              cand,
              incoming
            );
            const desc = describePathSectionAndTitle(cleanPath, mergedData);

            const foldedOp: SimulatedFirestoreOp = {
              ...cand,
              queuedReason:
                incoming.queuedReason === 'quota_exceeded' || cand.queuedReason === 'quota_exceeded'
                  ? 'quota_exceeded'
                  : incoming.queuedReason || cand.queuedReason,
              createdAt: incoming.createdAt,
              targetTitle: incoming.targetTitle || cand.targetTitle || desc.targetTitle,
              actionLabel: isDocTypeMergeOp(cleanPath, incoming)
                ? 'Tipo allegato aggiornato'
                : cand.actionLabel || incoming.actionLabel,
              data: mergedData,
              changedFields: displayFields.length > 0 ? displayFields : netKeys,
              changedDetails: resolvedDetails,
            };

            const updatedOps = currentOps.map((item, idx) => (idx === i ? foldedOp : item));
            return isPathNetZeroAgainstBase(updatedOps, cleanPath)
              ? stripPathFromOps(updatedOps, cleanPath)
              : updatedOps;
          }
        }

        for (const k of candKeys) {
          laterTouchedKeys.add(k);
        }
      }
    }
  }

  const nextOps = [...currentOps, incoming];
  if (isPathNetZeroAgainstBase(nextOps, cleanPath)) {
    return stripPathFromOps(nextOps, cleanPath);
  }
  return nextOps;
}

function enqueueSimulatedOp(op: SimulatedFirestoreOp): void {
  simulatedFirestoreOps = foldOrEnqueueSimulatedOp(simulatedFirestoreOps, op);
  persistAndEmitSimulatedOps();
}

export function enqueueSimulatedVaultUpload(payload: {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  ownerUid: string;
  groupKey?: string;
  groupSection?: string;
  groupTitle?: string;
  actionLabel?: string;
  displayTitle?: string;
  changedDetails?: string[];
  queuedReason?: SimulatedOpReason;
}): void {
  localOnlyVaultUploadKeys.add(payload.fileKey);
  const estimatedOps = Math.max(2, Math.ceil((payload.size * 1.35) / 600_000) + 1);
  enqueueSimulatedOp({
    id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'vault_upload',
    queuedReason: payload.queuedReason || 'test_mode',
    createdAt: Date.now(),
    section: payload.groupSection || 'Allegati',
    actionLabel: payload.actionLabel || 'File allegato',
    targetTitle: payload.displayTitle || payload.fileName,
    groupKey: payload.groupKey,
    groupSection: payload.groupSection,
    groupTitle: payload.groupTitle,
    changedDetails: payload.changedDetails,
    writeCount: estimatedOps,
    vaultUpload: {
      fileKey: payload.fileKey,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      size: payload.size,
      ownerUid: payload.ownerUid,
    },
  });
}

export function enqueueSimulatedVaultDelete(payload: {
  keys: string[];
  ownerUid: string;
  groupKey?: string;
  groupSection?: string;
  groupTitle?: string;
  actionLabel?: string;
  displayTitle?: string;
  changedDetails?: string[];
  queuedReason?: SimulatedOpReason;
}): void {
  if (payload.keys.length === 0) return;
  enqueueSimulatedOp({
    id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'vault_delete',
    queuedReason: payload.queuedReason || 'test_mode',
    createdAt: Date.now(),
    section: payload.groupSection || 'Allegati',
    actionLabel: payload.actionLabel || 'Rimozione allegati',
    targetTitle:
      payload.displayTitle ||
      (payload.keys.length === 1 ? payload.keys[0] : `${payload.keys.length} allegati`),
    groupKey: payload.groupKey,
    groupSection: payload.groupSection,
    groupTitle: payload.groupTitle,
    changedDetails: payload.changedDetails,
    writeCount: payload.keys.length * 2,
    vaultDelete: {
      keys: payload.keys,
      ownerUid: payload.ownerUid,
    },
  });
}

function collectVaultKeysFromRecord(data?: Record<string, unknown>): string[] {
  const keys: string[] = [];
  if (!data) return keys;
  if (typeof data.attachmentKey === 'string' && data.attachmentKey) {
    keys.push(data.attachmentKey);
  }
  if (typeof data.manualFileKey === 'string' && data.manualFileKey) {
    keys.push(data.manualFileKey);
  }
  if (typeof data.pdfFileKey === 'string' && data.pdfFileKey) {
    keys.push(data.pdfFileKey);
  }
  if (typeof data.attachmentFileKey === 'string' && data.attachmentFileKey) {
    keys.push(data.attachmentFileKey);
  }
  const specsKey = extractVaultKeyFromSpecs(data.specs);
  if (specsKey) keys.push(specsKey);
  return keys;
}

function collectPairedVaultFileKeys(op: SimulatedFirestoreOp): string[] {
  const keys: string[] = [];
  if (op.kind === 'set' && op.data) {
    keys.push(...collectVaultKeysFromRecord(op.data));
  } else if (op.kind === 'batch' && op.batchOps?.length) {
    for (const sub of op.batchOps) {
      keys.push(...collectVaultKeysFromRecord(sub.data));
    }
  }
  return keys;
}

export function discardSimulatedFirestoreOps(ids: string[]): void {
  const idSet = new Set(ids.filter(Boolean));
  if (idSet.size === 0) return;

  const targets = simulatedFirestoreOps.filter((op) => idSet.has(op.id));
  if (targets.length === 0) return;

  const pairedVaultKeys = new Set<string>();
  const cancelledNewPaths = new Map<string, number>();
  const cancelledReplacePaths = new Set<string>();
  const cancelledReplaceVaultKeys = new Set<string>();

  for (const target of targets) {
    const isLocalCreation =
      target.kind === 'set' &&
      !target.options?.merge &&
      Boolean(target.path) &&
      (Boolean(target.changedFields?.includes('__new__')) ||
        !lookupRegisteredBaseDoc(target.path!).baseDoc);
    if (isLocalCreation) {
      cancelledNewPaths.set(target.path!, target.createdAt);
    }
    if (target.kind === 'set' && !target.options?.merge) {
      for (const fk of collectPairedVaultFileKeys(target)) {
        pairedVaultKeys.add(fk);
      }
    }
    if (target.replacesDocPath) {
      const cleanReplace = target.replacesDocPath.replace(/^\/+|\/+$/g, '');
      if (cleanReplace) {
        cancelledReplacePaths.add(cleanReplace);
        const docId = cleanReplace.split('/').pop();
        if (docId) {
          cancelledReplaceVaultKeys.add(`att_${docId}`);
          cancelledReplaceVaultKeys.add(`doc_${docId}`);
        }
      }
    }
  }

  const next: SimulatedFirestoreOp[] = [];
  for (const op of simulatedFirestoreOps) {
    if (idSet.has(op.id)) continue;
    if (
      op.kind === 'set' &&
      op.options?.merge &&
      op.path &&
      cancelledNewPaths.has(op.path) &&
      op.createdAt >= (cancelledNewPaths.get(op.path) ?? 0)
    ) {
      continue;
    }
    if (
      op.kind === 'vault_upload' &&
      op.vaultUpload?.fileKey &&
      pairedVaultKeys.has(op.vaultUpload.fileKey)
    ) {
      continue;
    }
    if (
      op.kind === 'delete' &&
      op.path &&
      cancelledReplacePaths.has(op.path.replace(/^\/+|\/+$/g, ''))
    ) {
      continue;
    }
    if (op.kind === 'vault_delete' && op.vaultDelete?.keys?.length) {
      const remainingKeys = op.vaultDelete.keys.filter(
        (k) => !cancelledReplaceVaultKeys.has(k)
      );
      if (remainingKeys.length === 0) continue;
      if (remainingKeys.length !== op.vaultDelete.keys.length) {
        next.push({
          ...op,
          targetTitle:
            remainingKeys.length === 1 ? remainingKeys[0] : `${remainingKeys.length} allegati`,
          writeCount: remainingKeys.length * 2,
          vaultDelete: {
            ...op.vaultDelete,
            keys: remainingKeys,
          },
        });
        continue;
      }
    }
    next.push(op);
  }

  if (next.length === simulatedFirestoreOps.length && next.every((o, idx) => o === simulatedFirestoreOps[idx])) {
    return;
  }
  simulatedFirestoreOps = next;
  persistAndEmitSimulatedOps();
}

export function restoreSimulatedDeletedAttachment(
  researchId: string,
  cloudUrl: string,
  preferredDocId?: string,
  preferredAttachmentKey?: string
): boolean {
  const normTargetUrl = cloudUrl.trim().split('#')[0].toLowerCase();
  const targetGroupKey = `research:${researchId}`;
  const matchingDeleteOps = simulatedFirestoreOps.filter((op) => {
    if (op.kind !== 'delete' || !op.path) return false;
    if (preferredDocId && op.path.endsWith(`/homeArticles/${preferredDocId}`)) {
      return true;
    }
    if (normTargetUrl && op.groupKey === targetGroupKey && op.sourceCloudUrl) {
      return op.sourceCloudUrl.trim().split('#')[0].toLowerCase() === normTargetUrl;
    }
    return false;
  });

  if (matchingDeleteOps.length === 0) return false;

  const delIds = new Set(matchingDeleteOps.map((o) => o.id));
  const vaultKeysToRestore = new Set<string>();
  if (preferredAttachmentKey) vaultKeysToRestore.add(preferredAttachmentKey);
  if (preferredDocId) {
    vaultKeysToRestore.add(`att_${preferredDocId}`);
    vaultKeysToRestore.add(`doc_${preferredDocId}`);
  }
  for (const delOp of matchingDeleteOps) {
    const docId = delOp.path?.split('/').pop();
    if (docId) {
      vaultKeysToRestore.add(`att_${docId}`);
      vaultKeysToRestore.add(`doc_${docId}`);
    }
  }

  const next: SimulatedFirestoreOp[] = [];
  for (const op of simulatedFirestoreOps) {
    if (delIds.has(op.id)) continue;
    if (op.kind === 'vault_delete' && op.vaultDelete?.keys?.length) {
      const remainingKeys = op.vaultDelete.keys.filter((k) => !vaultKeysToRestore.has(k));
      if (remainingKeys.length === 0) continue;
      if (remainingKeys.length !== op.vaultDelete.keys.length) {
        next.push({
          ...op,
          targetTitle:
            remainingKeys.length === 1 ? remainingKeys[0] : `${remainingKeys.length} allegati`,
          writeCount: remainingKeys.length * 2,
          vaultDelete: {
            ...op.vaultDelete,
            keys: remainingKeys,
          },
        });
        continue;
      }
    }
    next.push(op);
  }

  simulatedFirestoreOps = next;
  persistAndEmitSimulatedOps();
  return true;
}

export function discardSimulatedFirestoreOp(id: string): void {
  discardSimulatedFirestoreOps([id]);
}

export function clearSimulatedFirestoreOps(): void {
  localOnlyVaultUploadKeys.clear();
  if (simulatedFirestoreOps.length === 0) return;
  simulatedFirestoreOps = [];
  persistAndEmitSimulatedOps();
}

export function mergeSimulatedOpsIntoRawDocs(
  collectionPath: string,
  baseDocs: { id: string; data: DocumentData }[]
): { id: string; data: DocumentData }[] {
  const cleanColPath = collectionPath.replace(/\/+$/, '');
  const baseRecordMap = new Map<string, Record<string, unknown>>();
  for (const item of baseDocs) {
    baseRecordMap.set(item.id, { ...item.data });
  }
  registeredBaseCollections.set(cleanColPath, baseRecordMap);

  if (simulatedFirestoreOps.length === 0) return baseDocs;
  const prefix = `${cleanColPath}/`;
  const map = new Map<string, Record<string, unknown>>();
  for (const item of baseDocs) {
    map.set(item.id, { ...item.data });
  }

  let matchedAny = false;
  const applySubOp = (
    path: string,
    opKind: 'set' | 'update' | 'delete',
    data: Record<string, unknown> | undefined,
    merge: boolean,
    ts: number
  ) => {
    if (!path.startsWith(prefix)) return;
    const remainder = path.slice(prefix.length);
    if (!remainder || remainder.includes('/')) return;
    matchedAny = true;
    if (opKind === 'delete') {
      map.delete(remainder);
      return;
    }
    const existing = map.get(remainder);
    map.set(
      remainder,
      applySerializedPatchToRawDoc(existing, data || {}, merge, ts)
    );
  };

  for (const op of simulatedFirestoreOps) {
    if (op.kind === 'set' && op.path) {
      applySubOp(op.path, 'set', op.data, Boolean(op.options?.merge), op.createdAt);
    } else if (op.kind === 'delete' && op.path) {
      applySubOp(op.path, 'delete', undefined, false, op.createdAt);
    } else if (op.kind === 'batch' && op.batchOps) {
      for (const sub of op.batchOps) {
        applySubOp(
          sub.path,
          sub.op,
          sub.data,
          sub.op === 'update' || Boolean(sub.options?.merge),
          op.createdAt
        );
      }
    }
  }

  if (!matchedAny) return baseDocs;
  return Array.from(map.entries()).map(([id, data]) => ({ id, data }));
}

const MAX_FIRESTORE_BATCH_OPS = 450;

function stripDeleteFieldSentinels(
  record: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      (v as { __fsSentinel?: unknown }).__fsSentinel === 'deleteField'
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

function isDeleteFieldSentinel(val: unknown): boolean {
  return Boolean(
    val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      (val as { __fsSentinel?: unknown }).__fsSentinel === 'deleteField'
  );
}

export function getSimulatedBatchPlan(
  ops: SimulatedFirestoreOp[] = simulatedFirestoreOps
): SimulatedBatchPlan {
  const compacted = compactSimulatedOpsList(ops);
  const docSourceOps: SimulatedFirestoreOp[] = [];
  const vaultUploadOps: SimulatedFirestoreOp[] = [];
  const vaultDeleteOps: SimulatedFirestoreOp[] = [];

  const foldedByPath = new Map<string, SimulatedBatchWriteOp>();
  const overflowSequentialOps: SimulatedBatchWriteOp[] = [];

  const applyAtomicDocOp = (
    rawPath: string,
    opKind: 'set' | 'update' | 'delete',
    rawData?: Record<string, unknown>,
    mergeOpt = false
  ) => {
    const cleanPath = rawPath.replace(/^\/+|\/+$/g, '');
    if (!cleanPath) return;

    const prev = foldedByPath.get(cleanPath);
    if (opKind === 'delete') {
      foldedByPath.set(cleanPath, { op: 'delete', path: cleanPath });
      return;
    }

    const incomingData = rawData ? { ...rawData } : {};

    if (opKind === 'set' && !mergeOpt) {
      foldedByPath.set(cleanPath, {
        op: 'set',
        path: cleanPath,
        data: stripDeleteFieldSentinels(incomingData),
        merge: false,
      });
      return;
    }

    if (opKind === 'set' && mergeOpt) {
      if (!prev) {
        foldedByPath.set(cleanPath, {
          op: 'set',
          path: cleanPath,
          data: incomingData,
          merge: true,
        });
        return;
      }
      if (prev.op === 'delete') {
        foldedByPath.set(cleanPath, {
          op: 'set',
          path: cleanPath,
          data: stripDeleteFieldSentinels(incomingData),
          merge: false,
        });
        return;
      }
      if (prev.op === 'set') {
        const mergedData: Record<string, unknown> = { ...(prev.data || {}) };
        for (const [k, v] of Object.entries(incomingData)) {
          if (!prev.merge && isDeleteFieldSentinel(v)) {
            delete mergedData[k];
          } else {
            mergedData[k] = v;
          }
        }
        foldedByPath.set(cleanPath, {
          op: 'set',
          path: cleanPath,
          data: mergedData,
          merge: prev.merge,
        });
        return;
      }
      // prev.op === 'update'
      const hasDots = Object.keys(incomingData).some((k) => k.includes('.'));
      if (!hasDots) {
        foldedByPath.set(cleanPath, {
          op: 'update',
          path: cleanPath,
          data: { ...(prev.data || {}), ...incomingData },
        });
      } else {
        overflowSequentialOps.push({
          op: 'set',
          path: cleanPath,
          data: incomingData,
          merge: true,
        });
      }
      return;
    }

    // opKind === 'update'
    if (!prev) {
      foldedByPath.set(cleanPath, {
        op: 'update',
        path: cleanPath,
        data: incomingData,
      });
      return;
    }
    const hasDots = Object.keys(incomingData).some((k) => k.includes('.'));
    if (prev.op === 'update') {
      foldedByPath.set(cleanPath, {
        op: 'update',
        path: cleanPath,
        data: { ...(prev.data || {}), ...incomingData },
      });
      return;
    }
    if (prev.op === 'set' && !hasDots) {
      const mergedData: Record<string, unknown> = { ...(prev.data || {}) };
      for (const [k, v] of Object.entries(incomingData)) {
        if (!prev.merge && isDeleteFieldSentinel(v)) {
          delete mergedData[k];
        } else {
          mergedData[k] = v;
        }
      }
      foldedByPath.set(cleanPath, {
        op: 'set',
        path: cleanPath,
        data: mergedData,
        merge: prev.merge,
      });
      return;
    }
    overflowSequentialOps.push({
      op: 'update',
      path: cleanPath,
      data: incomingData,
    });
  };

  for (const op of compacted) {
    if (op.kind === 'set' && op.path) {
      docSourceOps.push(op);
      applyAtomicDocOp(op.path, 'set', op.data, Boolean(op.options?.merge));
    } else if (op.kind === 'delete' && op.path) {
      docSourceOps.push(op);
      applyAtomicDocOp(op.path, 'delete');
    } else if (op.kind === 'batch' && op.batchOps && op.batchOps.length > 0) {
      docSourceOps.push(op);
      for (const sub of op.batchOps) {
        applyAtomicDocOp(
          sub.path,
          sub.op,
          sub.data,
          sub.op === 'set' ? Boolean(sub.options?.merge) : false
        );
      }
    } else if (op.kind === 'vault_upload' && op.vaultUpload) {
      vaultUploadOps.push(op);
    } else if (op.kind === 'vault_delete' && op.vaultDelete) {
      vaultDeleteOps.push(op);
    }
  }

  const docBatchChunks: SimulatedBatchWriteOp[][] = [];
  const foldedList = Array.from(foldedByPath.values());
  for (let i = 0; i < foldedList.length; i += MAX_FIRESTORE_BATCH_OPS) {
    docBatchChunks.push(foldedList.slice(i, i + MAX_FIRESTORE_BATCH_OPS));
  }
  for (let i = 0; i < overflowSequentialOps.length; i += MAX_FIRESTORE_BATCH_OPS) {
    docBatchChunks.push(overflowSequentialOps.slice(i, i + MAX_FIRESTORE_BATCH_OPS));
  }

  const docWritesCount = docBatchChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  return {
    queuedCount: compacted.length,
    docSourceOps,
    docBatchChunks,
    docWritesCount,
    batchCommitsCount: docBatchChunks.length,
    vaultUploadOps,
    vaultDeleteOps,
  };
}

export function hasQuotaPendingSyncOps(): boolean {
  return simulatedFirestoreOps.some((op) => op.queuedReason === 'quota_exceeded');
}

export function shouldAutoFlushQuotaQueue(nowMs = Date.now()): boolean {
  if (!auth.currentUser || firestoreWriteStats.writesDisabled || activeFlushPromise) {
    return false;
  }
  if (!hasQuotaPendingSyncOps()) return false;
  const todayPt = getFirestoreQuotaDayIsoDate(nowMs);
  if (quotaRetryState && quotaRetryState.quotaHitDayPt !== todayPt) {
    // New PT quota window: probe once per minute until sync succeeds
    return nowMs - (quotaRetryState.lastAttemptAt || 0) >= 60_000;
  }
  // Same exhausted PT day: back off for 15 minutes between silent recovery probes
  return nowMs - (quotaRetryState?.lastAttemptAt || 0) >= 15 * 60 * 1000;
}

export async function flushSimulatedFirestoreOps(options?: {
  silentQuotaProbe?: boolean;
}): Promise<SimulatedFlushResult> {
  if (activeFlushPromise) return activeFlushPromise;

  const compactedBeforeFlush = compactSimulatedOpsList(simulatedFirestoreOps);
  if (
    compactedBeforeFlush.length !== simulatedFirestoreOps.length ||
    compactedBeforeFlush.some((c, idx) => c !== simulatedFirestoreOps[idx])
  ) {
    simulatedFirestoreOps = compactedBeforeFlush;
    persistAndEmitSimulatedOps();
  }

  const snapshot = [...simulatedFirestoreOps];
  if (snapshot.length === 0) {
    if (!options?.silentQuotaProbe) {
      dismissFirestoreQuotaExceeded();
      clearQuotaRetryState();
    }
    return { total: 0, flushed: 0, failed: 0, docWrites: 0, batchCommits: 0, at: Date.now() };
  }

  if (!auth.currentUser) {
    const res: SimulatedFlushResult = {
      total: snapshot.length,
      flushed: 0,
      failed: snapshot.length,
      docWrites: 0,
      batchCommits: 0,
      errorMessage:
        'Accedi con il tuo account Google per inviare a Firestore le operazioni salvate in locale.',
      at: Date.now(),
    };
    if (!options?.silentQuotaProbe) {
      simulatedFlushState = { flushing: false, lastResult: res };
      emitSimulatedFlushState();
    }
    return res;
  }

  activeFlushPromise = (async (): Promise<SimulatedFlushResult> => {
    const silentProbe = Boolean(options?.silentQuotaProbe);
    // Allow a clean live probe (e.g. right after PT daily quota reset) without early 1.5s abort
    quotaExceededObserved = false;
    recordQuotaRetryAttempt();

    if (!silentProbe) {
      simulatedFlushState = { flushing: true, lastResult: null };
      emitSimulatedFlushState();
    }

    const plan = getSimulatedBatchPlan(snapshot);
    let flushed = 0;
    let failed = 0;
    let docWrites = 0;
    let batchCommits = 0;
    let errorMessage: string | undefined;
    let hitQuotaDuringFlush = false;

    // 1. Replay queued binary vault uploads first (chunked internally for 10MB payload limits)
    for (const op of plan.vaultUploadOps) {
      if (!op.vaultUpload) continue;
      try {
        const { replayVaultUploadToFirestore } = await import('./utils/documentVault');
        await replayVaultUploadToFirestore(op.vaultUpload);
        localOnlyVaultUploadKeys.delete(op.vaultUpload.fileKey);
        flushed += 1;
        simulatedFirestoreOps = simulatedFirestoreOps.filter((item) => item.id !== op.id);
        persistAndEmitSimulatedOps();
      } catch (err) {
        if (isFirestoreQuotaError(err)) hitQuotaDuringFlush = true;
        failed += 1;
        errorMessage =
          err instanceof Error
            ? err.message
            : 'Errore durante il caricamento degli allegati su Firestore.';
      }
    }

    // 2. Execute ALL queued Firestore document writes/deletes in a single unified WriteBatch block
    //    (chunked at 450 ops only if the queue exceeds a single Firestore WriteBatch limit)
    if (plan.docBatchChunks.length > 0) {
      let allDocChunksCommitted = true;
      for (const chunk of plan.docBatchChunks) {
        try {
          const batch = rawWriteBatch(db);
          for (const item of chunk) {
            const ref = doc(db, item.path);
            if (item.op === 'delete') {
              batch.delete(ref);
            } else if (item.op === 'update') {
              batch.update(ref, deserializeFirestoreRecord(item.data));
            } else if (item.merge) {
              batch.set(ref, deserializeFirestoreRecord(item.data), { merge: true });
            } else {
              batch.set(ref, deserializeFirestoreRecord(item.data));
            }
          }
          await raceWithFirestoreQuotaAbort(batch.commit());
          batchCommits += 1;
          docWrites += chunk.length;
        } catch (err) {
          if (isFirestoreQuotaError(err)) hitQuotaDuringFlush = true;
          allDocChunksCommitted = false;
          failed += plan.docSourceOps.length;
          errorMessage =
            err instanceof Error
              ? err.message
              : 'Errore durante la sincronizzazione in blocco su Firestore.';
          break;
        }
      }

      if (allDocChunksCommitted) {
        const flushedIds = new Set(plan.docSourceOps.map((op) => op.id));
        flushed += plan.docSourceOps.length;
        simulatedFirestoreOps = simulatedFirestoreOps.filter((item) => !flushedIds.has(item.id));
        persistAndEmitSimulatedOps();
        if (docWrites > 0) {
          recordFirestoreWritesExecuted(
            docWrites,
            `Sync blocco batch (${plan.docSourceOps.length} op → ${docWrites} scritture in ${batchCommits} batch)`
          );
        }
      }
    }

    // 3. Replay queued vault deletions
    for (const op of plan.vaultDeleteOps) {
      if (!op.vaultDelete) continue;
      try {
        const { replayVaultDeleteToFirestore } = await import('./utils/documentVault');
        await replayVaultDeleteToFirestore(op.vaultDelete);
        flushed += 1;
        simulatedFirestoreOps = simulatedFirestoreOps.filter((item) => item.id !== op.id);
        persistAndEmitSimulatedOps();
      } catch (err) {
        if (isFirestoreQuotaError(err)) hitQuotaDuringFlush = true;
        failed += 1;
        errorMessage =
          err instanceof Error
            ? err.message
            : 'Errore durante la rimozione degli allegati su Firestore.';
      }
    }

    if (failed === 0) {
      quotaExceededObserved = false;
      dismissFirestoreQuotaExceeded();
      clearQuotaRetryState();
    } else if (hitQuotaDuringFlush) {
      notifyFirestoreQuotaExceeded();
    }

    const finalRes: SimulatedFlushResult = {
      total: snapshot.length,
      flushed,
      failed,
      docWrites,
      batchCommits,
      errorMessage,
      at: Date.now(),
    };
    if (!silentProbe || failed === 0) {
      simulatedFlushState = {
        flushing: false,
        lastResult: finalRes,
      };
      emitSimulatedFlushState();
    } else {
      simulatedFlushState = {
        ...simulatedFlushState,
        flushing: false,
      };
      emitSimulatedFlushState();
    }
    return finalRes;
  })();

  try {
    return await activeFlushPromise;
  } finally {
    activeFlushPromise = null;
  }
}

function readInitialWritesDisabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem('myhome_app_settings_v2');
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { firestoreWritesDisabled?: unknown };
    return typeof parsed?.firestoreWritesDisabled === 'boolean'
      ? parsed.firestoreWritesDisabled
      : true;
  } catch {
    return true;
  }
}

let firestoreWriteStats: FirestoreWriteStats = {
  writesDisabled: readInitialWritesDisabled(),
  writesSavedCount: 0,
  writesExecutedCount: 0,
  lastActionLabel: null,
  lastActionAt: null,
};

export const DAILY_FREE_WRITES_LIMIT = 20_000;
export const DAILY_FREE_READS_LIMIT = 50_000;
const DAILY_USAGE_STORAGE_KEY = 'myhome_firestore_daily_usage_v1';
const TELEMETRY_IDB_NAME = 'myhome_firestore_telemetry_db';
const TELEMETRY_IDB_STORE = 'telemetry_store';
const TELEMETRY_IDB_KEY = 'daily_usage_history_v1';
const MAX_DAILY_USAGE_DAYS = 730;

export interface DailyFirestoreUsageEntry {
  date: string; // YYYY-MM-DD in America/Los_Angeles (matches Firebase daily reset at 00:00 PT / ~09:00 IT)
  writes: number;
  deletes: number;
  reads: number;
  readUnits: number;
  writeUnits: number;
  savedInTestMode: number;
  settingsWrites: number;
  quotaHit?: boolean;
  quotaHitAt?: number;
}

export function getFirestoreQuotaDayIsoDate(nowMs = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(nowMs));
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback below
  }
  const dt = new Date(nowMs - 8 * 60 * 60 * 1000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeDailyUsageEntries(rawList: unknown): DailyFirestoreUsageEntry[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((item): item is DailyFirestoreUsageEntry =>
      Boolean(
        item &&
          typeof item === 'object' &&
          /^\d{4}-\d{2}-\d{2}$/.test(String((item as { date?: unknown }).date || ''))
      )
    )
    .map((item) => {
      const writes = Math.max(0, Math.round(Number(item.writes || 0)));
      const deletes = Math.max(0, Math.round(Number(item.deletes || 0)));
      const reads = Math.max(0, Math.round(Number(item.reads || 0)));
      const readUnits = Math.max(reads, Math.round(Number(item.readUnits || 0)));
      const writeUnits = Math.max(writes + deletes, Math.round(Number(item.writeUnits || 0)));
      const rawQuotaHitAt = Number(item.quotaHitAt || 0);
      return {
        date: String(item.date),
        writes,
        deletes,
        reads,
        readUnits,
        writeUnits,
        savedInTestMode: Math.max(0, Math.round(Number(item.savedInTestMode || 0))),
        settingsWrites: Math.max(0, Math.round(Number(item.settingsWrites || 0))),
        ...(item.quotaHit ? { quotaHit: true } : {}),
        ...(Number.isFinite(rawQuotaHitAt) && rawQuotaHitAt > 0
          ? { quotaHitAt: Math.round(rawQuotaHitAt) }
          : {}),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DAILY_USAGE_DAYS);
}

function mergeDailyUsageLists(
  primary: DailyFirestoreUsageEntry[],
  secondary: DailyFirestoreUsageEntry[]
): DailyFirestoreUsageEntry[] {
  const byDate = new Map<string, DailyFirestoreUsageEntry>();
  for (const entry of [...secondary, ...primary]) {
    const existing = byDate.get(entry.date);
    if (!existing) {
      byDate.set(entry.date, { ...entry });
    } else {
      byDate.set(entry.date, {
        date: entry.date,
        writes: Math.max(existing.writes, entry.writes),
        deletes: Math.max(existing.deletes, entry.deletes),
        reads: Math.max(existing.reads, entry.reads),
        readUnits: Math.max(existing.readUnits, entry.readUnits),
        writeUnits: Math.max(existing.writeUnits, entry.writeUnits),
        savedInTestMode: Math.max(existing.savedInTestMode, entry.savedInTestMode),
        settingsWrites: Math.max(existing.settingsWrites, entry.settingsWrites),
        ...(existing.quotaHit || entry.quotaHit ? { quotaHit: true } : {}),
        ...(existing.quotaHitAt || entry.quotaHitAt
          ? { quotaHitAt: Math.max(existing.quotaHitAt || 0, entry.quotaHitAt || 0) }
          : {}),
      });
    }
  }
  return Array.from(byDate.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DAILY_USAGE_DAYS);
}

function loadDailyUsageHistory(): DailyFirestoreUsageEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DAILY_USAGE_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeDailyUsageEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

function openTelemetryIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(TELEMETRY_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(TELEMETRY_IDB_STORE)) {
        idb.createObjectStore(TELEMETRY_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

async function readDailyUsageFromIdb(): Promise<DailyFirestoreUsageEntry[]> {
  try {
    const idb = await openTelemetryIdb();
    const result = await new Promise<unknown>((resolve, reject) => {
      const tx = idb.transaction(TELEMETRY_IDB_STORE, 'readonly');
      const req = tx.objectStore(TELEMETRY_IDB_STORE).get(TELEMETRY_IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    return sanitizeDailyUsageEntries(result);
  } catch {
    return [];
  }
}

async function writeDailyUsageToIdb(entries: DailyFirestoreUsageEntry[]): Promise<void> {
  try {
    const idb = await openTelemetryIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(TELEMETRY_IDB_STORE, 'readwrite');
      tx.objectStore(TELEMETRY_IDB_STORE).put(entries, TELEMETRY_IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  } catch {
    // ignore IndexedDB errors
  }
}

let dailyUsageHistory: DailyFirestoreUsageEntry[] = loadDailyUsageHistory();
let dailyUsageClearedManually = false;
const dailyUsageListeners = new Set<(entries: DailyFirestoreUsageEntry[]) => void>();

// Hydrate from IndexedDB on boot so counts survive page reloads even if localStorage hits 5MB limit
if (typeof window !== 'undefined') {
  void readDailyUsageFromIdb().then((idbEntries) => {
    if (dailyUsageClearedManually || idbEntries.length === 0) return;
    const merged = mergeDailyUsageLists(dailyUsageHistory, idbEntries);
    if (JSON.stringify(merged) !== JSON.stringify(dailyUsageHistory)) {
      dailyUsageHistory = merged;
      try {
        window.localStorage.setItem(DAILY_USAGE_STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // ignore localStorage quota errors; IndexedDB has the source of truth
      }
      const snapshot = merged.map((e) => ({ ...e }));
      dailyUsageListeners.forEach((listener) => listener(snapshot));
    }
  });
}

function saveAndEmitDailyUsage(): void {
  const trimmed = [...dailyUsageHistory]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DAILY_USAGE_DAYS);
  dailyUsageHistory = trimmed;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DAILY_USAGE_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore localStorage quota errors (IndexedDB still persists reliably)
    }
    void writeDailyUsageToIdb(trimmed);
  }
  const snapshot = trimmed.map((e) => ({ ...e }));
  dailyUsageListeners.forEach((listener) => listener(snapshot));
}

function mutateTodayDailyUsage(
  updater: (entry: DailyFirestoreUsageEntry) => void
): void {
  dailyUsageClearedManually = false;
  const today = getFirestoreQuotaDayIsoDate();
  const nextList = dailyUsageHistory.map((e) => ({ ...e }));
  let todayEntry = nextList.find((e) => e.date === today);
  if (!todayEntry) {
    todayEntry = {
      date: today,
      writes: 0,
      deletes: 0,
      reads: 0,
      readUnits: 0,
      writeUnits: 0,
      savedInTestMode: 0,
      settingsWrites: 0,
    };
    nextList.unshift(todayEntry);
  }
  updater(todayEntry);
  dailyUsageHistory = nextList;
  saveAndEmitDailyUsage();
}

export function getDailyFirestoreUsage(): DailyFirestoreUsageEntry[] {
  return dailyUsageHistory.map((e) => ({ ...e }));
}

export function subscribeDailyFirestoreUsage(
  listener: (entries: DailyFirestoreUsageEntry[]) => void
): () => void {
  dailyUsageListeners.add(listener);
  listener(getDailyFirestoreUsage());
  return () => {
    dailyUsageListeners.delete(listener);
  };
}

export function clearDailyFirestoreUsageHistory(): void {
  dailyUsageClearedManually = true;
  dailyUsageHistory = [];
  saveAndEmitDailyUsage();
}

function estimatePayloadBytes(data: unknown): number {
  if (!data || typeof data !== 'object') return 256;
  try {
    return Math.max(256, JSON.stringify(data).length + 64);
  } catch {
    return 512;
  }
}

function bytesToReadUnits(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4096));
}

function bytesToWriteUnits(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 1024));
}

function recordFirestoreQuotaExceededEvent(): void {
  const now = Date.now();
  mutateTodayDailyUsage((entry) => {
    entry.quotaHit = true;
    entry.quotaHitAt = now;
  });
}

export function recordFirestoreReadsExecuted(count = 1, readUnits?: number): void {
  if (!Number.isFinite(count) || count <= 0) return;
  const cleanCount = Math.round(count);
  const cleanUnits =
    typeof readUnits === 'number' && Number.isFinite(readUnits) && readUnits > 0
      ? Math.max(cleanCount, Math.round(readUnits))
      : cleanCount;
  mutateTodayDailyUsage((entry) => {
    entry.reads += cleanCount;
    entry.readUnits += cleanUnits;
  });
}

const writeStatsListeners = new Set<(stats: FirestoreWriteStats) => void>();

function emitWriteStats(): void {
  const snapshot = { ...firestoreWriteStats };
  writeStatsListeners.forEach((listener) => listener(snapshot));
}

export function isFirestoreWritesDisabled(): boolean {
  return firestoreWriteStats.writesDisabled;
}

export function setFirestoreWritesDisabled(disabled: boolean): void {
  const next = Boolean(disabled);
  const prev = firestoreWriteStats.writesDisabled;
  if (prev === next) return;
  firestoreWriteStats = {
    ...firestoreWriteStats,
    writesDisabled: next,
  };
  emitWriteStats();
  if (prev && !next && simulatedFirestoreOps.length > 0) {
    queueMicrotask(() => {
      void flushSimulatedFirestoreOps();
    });
  }
}

export function getFirestoreWriteStats(): FirestoreWriteStats {
  return { ...firestoreWriteStats };
}

export function subscribeFirestoreWriteStats(
  listener: (stats: FirestoreWriteStats) => void
): () => void {
  writeStatsListeners.add(listener);
  listener({ ...firestoreWriteStats });
  return () => {
    writeStatsListeners.delete(listener);
  };
}

export function resetFirestoreWriteStats(): void {
  firestoreWriteStats = {
    ...firestoreWriteStats,
    writesSavedCount: 0,
    writesExecutedCount: 0,
    lastActionLabel: null,
    lastActionAt: null,
  };
  emitWriteStats();
}

export function recordFirestoreWritesSaved(count = 1, label?: string): void {
  if (count <= 0) return;
  const cleanCount = Math.round(count);
  firestoreWriteStats = {
    ...firestoreWriteStats,
    writesSavedCount: firestoreWriteStats.writesSavedCount + cleanCount,
    lastActionLabel: label || 'Test browser (scrittura ignorata)',
    lastActionAt: Date.now(),
  };
  emitWriteStats();
  mutateTodayDailyUsage((entry) => {
    entry.savedInTestMode += cleanCount;
  });
}

export function recordFirestoreWritesExecuted(
  count = 1,
  label?: string,
  options?: { deletes?: number; isSettingsWrite?: boolean; writeUnits?: number }
): void {
  if (count <= 0) return;
  const cleanCount = Math.round(count);
  const cleanDeletes = Math.max(0, Math.min(cleanCount, Math.round(options?.deletes || 0)));
  const cleanWrites = cleanCount - cleanDeletes;
  const cleanUnits =
    typeof options?.writeUnits === 'number' &&
    Number.isFinite(options.writeUnits) &&
    options.writeUnits > 0
      ? Math.max(cleanCount, Math.round(options.writeUnits))
      : cleanCount;
  firestoreWriteStats = {
    ...firestoreWriteStats,
    writesExecutedCount: firestoreWriteStats.writesExecutedCount + cleanCount,
    lastActionLabel: label || 'Scrittura Firestore completata',
    lastActionAt: Date.now(),
  };
  emitWriteStats();
  mutateTodayDailyUsage((entry) => {
    entry.writes += cleanWrites;
    entry.deletes += cleanDeletes;
    entry.writeUnits += cleanUnits;
    if (options?.isSettingsWrite) {
      entry.settingsWrites += cleanCount;
    }
  });
}

export async function trackedGetDoc<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>
): Promise<DocumentSnapshot<AppModelType, DbModelType>> {
  const snap = await rawGetDoc(reference);
  if (!snap.metadata.fromCache) {
    const units = snap.exists() ? bytesToReadUnits(estimatePayloadBytes(snap.data())) : 1;
    recordFirestoreReadsExecuted(1, units);
  }
  return snap;
}

export async function trackedGetDocs<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
  queryObj: Query<AppModelType, DbModelType>
): Promise<QuerySnapshot<AppModelType, DbModelType>> {
  const snap = await rawGetDocs(queryObj);
  if (!snap.metadata.fromCache) {
    const docsCount = Math.max(1, snap.size);
    const units =
      snap.size > 0
        ? snap.docs.reduce((sum, d) => sum + bytesToReadUnits(estimatePayloadBytes(d.data())), 0)
        : 1;
    recordFirestoreReadsExecuted(docsCount, units);
  }
  return snap;
}

export function trackedOnSnapshot<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>,
  onNext: (snapshot: DocumentSnapshot<AppModelType, DbModelType>) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe;
export function trackedOnSnapshot<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
  queryObj: Query<AppModelType, DbModelType>,
  onNext: (snapshot: QuerySnapshot<AppModelType, DbModelType>) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe;
export function trackedOnSnapshot<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
  target: DocumentReference<AppModelType, DbModelType> | Query<AppModelType, DbModelType>,
  onNext:
    | ((snapshot: DocumentSnapshot<AppModelType, DbModelType>) => void)
    | ((snapshot: QuerySnapshot<AppModelType, DbModelType>) => void),
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  let sawAnySnapshot = false;
  let receivedServerSnap = false;
  const wrappedNext = (
    snap: DocumentSnapshot<AppModelType, DbModelType> | QuerySnapshot<AppModelType, DbModelType>
  ) => {
    const hadCacheSnapshotBefore = sawAnySnapshot;
    sawAnySnapshot = true;
    if (!snap.metadata.fromCache) {
      if ('docs' in snap) {
        if (!receivedServerSnap) {
          receivedServerSnap = true;
          if (hadCacheSnapshotBefore) {
            const changes = snap.docChanges();
            const changedUnits = changes.reduce(
              (sum, c) => sum + bytesToReadUnits(estimatePayloadBytes(c.doc.data())),
              0
            );
            // At least 1 query check read when connecting listener to server after cache hydration
            recordFirestoreReadsExecuted(Math.max(1, changes.length), Math.max(1, changedUnits));
          } else {
            const serverReads = Math.max(1, snap.size);
            const totalUnits =
              snap.size > 0
                ? snap.docs.reduce(
                    (sum, d) => sum + bytesToReadUnits(estimatePayloadBytes(d.data())),
                    0
                  )
                : 1;
            recordFirestoreReadsExecuted(serverReads, totalUnits);
          }
        } else {
          const changes = snap.docChanges();
          if (changes.length > 0) {
            const units = changes.reduce(
              (sum, c) => sum + bytesToReadUnits(estimatePayloadBytes(c.doc.data())),
              0
            );
            recordFirestoreReadsExecuted(changes.length, units);
          }
        }
      } else {
        const docUnits = snap.exists() ? bytesToReadUnits(estimatePayloadBytes(snap.data())) : 1;
        if (!receivedServerSnap) {
          receivedServerSnap = true;
          recordFirestoreReadsExecuted(1, hadCacheSnapshotBefore ? 1 : docUnits);
        } else {
          recordFirestoreReadsExecuted(1, docUnits);
        }
      }
    }
    (onNext as (s: typeof snap) => void)(snap);
  };
  if ('type' in target && target.type === 'document') {
    return rawOnSnapshot(
      target as DocumentReference<AppModelType, DbModelType>,
      wrappedNext as (s: DocumentSnapshot<AppModelType, DbModelType>) => void,
      onError
    );
  }
  return rawOnSnapshot(
    target as Query<AppModelType, DbModelType>,
    wrappedNext as (s: QuerySnapshot<AppModelType, DbModelType>) => void,
    onError
  );
}

function queueLocalFallbackSetDoc(
  path: string,
  serializedData: Record<string, unknown>,
  mergeOpt: boolean,
  hint: SimulatedOpDetailHint | undefined,
  reason: SimulatedOpReason
): void {
  const desc = describePathSectionAndTitle(path, serializedData);
  const resolvedTitle = hint?.title || desc.targetTitle;
  const resolvedAction = hint?.actionLabel || (mergeOpt ? 'Modifica' : 'Salvataggio');
  if (path) {
    enqueueSimulatedOp({
      id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind: 'set',
      queuedReason: reason,
      createdAt: Date.now(),
      section: desc.section,
      actionLabel: resolvedAction,
      targetTitle: resolvedTitle,
      groupKey: hint?.groupKey,
      groupSection: hint?.groupSection,
      groupTitle: hint?.groupTitle,
      writeCount: 1,
      changedFields:
        hint?.changedFields && hint.changedFields.length > 0 ? hint.changedFields : undefined,
      changedDetails:
        hint?.changedDetails && hint.changedDetails.length > 0 ? hint.changedDetails : undefined,
      path,
      data: serializedData,
      options: mergeOpt ? { merge: true } : undefined,
      ...(hint?.sourceCloudUrl ? { sourceCloudUrl: hint.sourceCloudUrl } : {}),
      ...(hint?.replacesDocPath ? { replacesDocPath: hint.replacesDocPath } : {}),
    });
  }
  recordFirestoreWritesSaved(
    1,
    reason === 'quota_exceeded'
      ? `${resolvedAction} locale (quota esaurita): ${resolvedTitle}`
      : `${resolvedAction} locale: ${resolvedTitle}`
  );
}

function queueLocalFallbackDeleteDoc(
  path: string,
  hint: SimulatedOpDetailHint | undefined,
  reason: SimulatedOpReason
): void {
  const desc = describePathSectionAndTitle(path);
  const resolvedTitle = hint?.title || desc.targetTitle;
  if (path) {
    enqueueSimulatedOp({
      id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind: 'delete',
      queuedReason: reason,
      createdAt: Date.now(),
      section: desc.section,
      actionLabel: hint?.actionLabel || 'Eliminazione',
      targetTitle: resolvedTitle,
      groupKey: hint?.groupKey,
      groupSection: hint?.groupSection,
      groupTitle: hint?.groupTitle,
      writeCount: 1,
      changedFields:
        hint?.changedFields && hint.changedFields.length > 0 ? hint.changedFields : undefined,
      changedDetails:
        hint?.changedDetails && hint.changedDetails.length > 0 ? hint.changedDetails : undefined,
      path,
      ...(hint?.sourceCloudUrl ? { sourceCloudUrl: hint.sourceCloudUrl } : {}),
    });
  }
  recordFirestoreWritesSaved(
    1,
    reason === 'quota_exceeded'
      ? `Eliminazione locale (quota esaurita): ${resolvedTitle}`
      : `Eliminazione locale: ${resolvedTitle}`
  );
}

function queueLocalFallbackBatchOps(
  recordedSubOps: SimulatedBatchSubOp[],
  batchHints: SimulatedOpDetailHint[],
  opCount: number,
  reason: SimulatedOpReason
): void {
  const firstOp = recordedSubOps[0];
  const desc = firstOp
    ? describePathSectionAndTitle(firstOp.path, firstOp.data)
    : { section: 'Batch', targetTitle: `${opCount} operazioni` };
  const firstHintTitle = batchHints.find((h) => h.title)?.title;
  const baseTitle = firstHintTitle || desc.targetTitle;
  const summaryTitle =
    recordedSubOps.length === 1
      ? baseTitle
      : `${baseTitle} (+${recordedSubOps.length - 1})`;
  const mergedFields = Array.from(new Set(batchHints.flatMap((h) => h.changedFields || [])));
  const mergedDetails = Array.from(new Set(batchHints.flatMap((h) => h.changedDetails || [])));
  const firstGroupHint = batchHints.find((h) => h.groupKey);
  enqueueSimulatedOp({
    id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'batch',
    queuedReason: reason,
    createdAt: Date.now(),
    section: desc.section,
    actionLabel:
      batchHints.find((h) => h.actionLabel)?.actionLabel ||
      (recordedSubOps.every((s) => s.op === 'delete')
        ? 'Eliminazione multipla'
        : 'Salvataggio multiplo'),
    targetTitle: summaryTitle,
    groupKey: firstGroupHint?.groupKey,
    groupSection: firstGroupHint?.groupSection,
    groupTitle: firstGroupHint?.groupTitle,
    writeCount: opCount,
    changedFields: mergedFields.length > 0 ? mergedFields : undefined,
    changedDetails: mergedDetails.length > 0 ? mergedDetails : undefined,
    batchOps: recordedSubOps,
  });
  recordFirestoreWritesSaved(
    opCount,
    reason === 'quota_exceeded'
      ? `Batch (${opCount} op) locale (quota esaurita): ${summaryTitle}`
      : `Batch (${opCount} op) locale: ${summaryTitle}`
  );
}

export const guardedSetDoc: typeof rawSetDoc = (async (...args: unknown[]) => {
  const docRef = args[0] as DocumentReference | undefined;
  const path = docRef?.path || '';
  const hint = consumeSimulatedOpHint(path);
  const rawData = args[1];
  const rawOptions = args[2] as SetOptions | undefined;
  const serializedData = serializeFirestoreRecord(rawData);
  const mergeOpt =
    rawOptions && typeof rawOptions === 'object' && 'merge' in rawOptions
      ? Boolean((rawOptions as { merge?: boolean }).merge)
      : false;

  if (firestoreWriteStats.writesDisabled) {
    queueLocalFallbackSetDoc(path, serializedData, mergeOpt, hint, 'test_mode');
    return;
  }

  if (quotaExceededActive) {
    notifyFirestoreQuotaExceeded();
    queueLocalFallbackSetDoc(path, serializedData, mergeOpt, hint, 'quota_exceeded');
    return;
  }

  try {
    await raceWithFirestoreQuotaAbort(
      (rawSetDoc as (...inner: unknown[]) => Promise<void>)(...args)
    );
    recordFirestoreWritesExecuted(1, 'setDoc', {
      writeUnits: bytesToWriteUnits(estimatePayloadBytes(args[1])),
    });
  } catch (err) {
    if (isFirestoreQuotaError(err) || quotaExceededActive) {
      notifyFirestoreQuotaExceeded();
      queueLocalFallbackSetDoc(path, serializedData, mergeOpt, hint, 'quota_exceeded');
      return;
    }
    throw err;
  }
}) as typeof rawSetDoc;

export async function saveSystemStateDoc(
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  if (firestoreWriteStats.writesDisabled || quotaExceededActive) {
    return;
  }
  try {
    await raceWithFirestoreQuotaAbort(rawSetDoc(doc(db, path), data));
    recordFirestoreWritesExecuted(1, 'Impostazioni app (cloud)', {
      isSettingsWrite: true,
      writeUnits: bytesToWriteUnits(estimatePayloadBytes(data)),
    });
  } catch (err) {
    if (isFirestoreQuotaError(err) || quotaExceededActive) {
      notifyFirestoreQuotaExceeded();
      return;
    }
    throw err;
  }
}

export const guardedDeleteDoc: typeof rawDeleteDoc = (async (...args: unknown[]) => {
  const docRef = args[0] as DocumentReference | undefined;
  const path = docRef?.path || '';
  const hint = consumeSimulatedOpHint(path);

  if (firestoreWriteStats.writesDisabled) {
    queueLocalFallbackDeleteDoc(path, hint, 'test_mode');
    return;
  }

  if (quotaExceededActive) {
    notifyFirestoreQuotaExceeded();
    queueLocalFallbackDeleteDoc(path, hint, 'quota_exceeded');
    return;
  }

  try {
    await raceWithFirestoreQuotaAbort(
      (rawDeleteDoc as (...inner: unknown[]) => Promise<void>)(...args)
    );
    recordFirestoreWritesExecuted(1, 'deleteDoc', { deletes: 1, writeUnits: 1 });
  } catch (err) {
    if (isFirestoreQuotaError(err) || quotaExceededActive) {
      notifyFirestoreQuotaExceeded();
      queueLocalFallbackDeleteDoc(path, hint, 'quota_exceeded');
      return;
    }
    throw err;
  }
}) as typeof rawDeleteDoc;

export function guardedWriteBatch(firestore: Firestore): ReturnType<typeof rawWriteBatch> {
  const batch = rawWriteBatch(firestore);
  let opCount = 0;
  let deleteCount = 0;
  let totalWriteUnits = 0;
  const recordedSubOps: SimulatedBatchSubOp[] = [];

  const origSet = batch.set.bind(batch);
  const origUpdate = batch.update.bind(batch);
  const origDelete = batch.delete.bind(batch);
  const origCommit = batch.commit.bind(batch);

  batch.set = ((...args: unknown[]) => {
    opCount += 1;
    const docRef = args[0] as DocumentReference | undefined;
    const rawData = args[1];
    totalWriteUnits += bytesToWriteUnits(estimatePayloadBytes(rawData));
    const rawOptions = args[2] as SetOptions | undefined;
    const mergeOpt =
      rawOptions && typeof rawOptions === 'object' && 'merge' in rawOptions
        ? Boolean((rawOptions as { merge?: boolean }).merge)
        : false;
    if (docRef?.path) {
      recordedSubOps.push({
        op: 'set',
        path: docRef.path,
        data: serializeFirestoreRecord(rawData),
        options: mergeOpt ? { merge: true } : undefined,
      });
    }
    return (origSet as (...inner: unknown[]) => ReturnType<typeof batch.set>)(...args);
  }) as typeof batch.set;

  batch.update = ((...args: unknown[]) => {
    opCount += 1;
    const docRef = args[0] as DocumentReference | undefined;
    let updateObj: Record<string, unknown> = {};
    if (args.length >= 2 && isPlainObject(args[1])) {
      updateObj = serializeFirestoreRecord(args[1]);
    } else if (args.length >= 3) {
      const flat: Record<string, unknown> = {};
      for (let i = 1; i + 1 < args.length; i += 2) {
        flat[String(args[i])] = args[i + 1];
      }
      updateObj = serializeFirestoreRecord(flat);
    }
    totalWriteUnits += bytesToWriteUnits(estimatePayloadBytes(updateObj));
    if (docRef?.path) {
      recordedSubOps.push({
        op: 'update',
        path: docRef.path,
        data: updateObj,
      });
    }
    return (origUpdate as (...inner: unknown[]) => ReturnType<typeof batch.update>)(...args);
  }) as typeof batch.update;

  batch.delete = ((...args: unknown[]) => {
    opCount += 1;
    deleteCount += 1;
    totalWriteUnits += 1;
    const docRef = args[0] as DocumentReference | undefined;
    if (docRef?.path) {
      recordedSubOps.push({
        op: 'delete',
        path: docRef.path,
      });
    }
    return (origDelete as (...inner: unknown[]) => ReturnType<typeof batch.delete>)(...args);
  }) as typeof batch.delete;

  batch.commit = async () => {
    if (opCount === 0) return;
    const batchHints = recordedSubOps
      .map((s) => consumeSimulatedOpHint(s.path))
      .filter((h): h is SimulatedOpDetailHint => Boolean(h));

    if (firestoreWriteStats.writesDisabled) {
      queueLocalFallbackBatchOps(recordedSubOps, batchHints, opCount, 'test_mode');
      return;
    }

    if (quotaExceededActive) {
      notifyFirestoreQuotaExceeded();
      queueLocalFallbackBatchOps(recordedSubOps, batchHints, opCount, 'quota_exceeded');
      return;
    }

    try {
      await raceWithFirestoreQuotaAbort(origCommit());
      recordFirestoreWritesExecuted(opCount, `batch (${opCount} op)`, {
        deletes: deleteCount,
        writeUnits: totalWriteUnits,
      });
    } catch (err) {
      if (isFirestoreQuotaError(err) || quotaExceededActive) {
        notifyFirestoreQuotaExceeded();
        queueLocalFallbackBatchOps(recordedSubOps, batchHints, opCount, 'quota_exceeded');
        return;
      }
      throw err;
    }
  };

  return batch;
}

export function directWriteBatch(firestore: Firestore): ReturnType<typeof rawWriteBatch> {
  const batch = rawWriteBatch(firestore);
  let opCount = 0;
  let deleteCount = 0;
  let totalWriteUnits = 0;

  const origSet = batch.set.bind(batch);
  const origUpdate = batch.update.bind(batch);
  const origDelete = batch.delete.bind(batch);
  const origCommit = batch.commit.bind(batch);

  batch.set = ((...args: unknown[]) => {
    opCount += 1;
    totalWriteUnits += bytesToWriteUnits(estimatePayloadBytes(args[1]));
    return (origSet as (...inner: unknown[]) => ReturnType<typeof batch.set>)(...args);
  }) as typeof batch.set;

  batch.update = ((...args: unknown[]) => {
    opCount += 1;
    const rawUpdate = args.length >= 2 && isPlainObject(args[1]) ? args[1] : undefined;
    totalWriteUnits += bytesToWriteUnits(estimatePayloadBytes(rawUpdate));
    return (origUpdate as (...inner: unknown[]) => ReturnType<typeof batch.update>)(...args);
  }) as typeof batch.update;

  batch.delete = ((...args: unknown[]) => {
    opCount += 1;
    deleteCount += 1;
    totalWriteUnits += 1;
    return (origDelete as (...inner: unknown[]) => ReturnType<typeof batch.delete>)(...args);
  }) as typeof batch.delete;

  batch.commit = async () => {
    if (opCount === 0) return;
    await raceWithFirestoreQuotaAbort(origCommit());
    recordFirestoreWritesExecuted(opCount, `sync blocco (${opCount} op)`, {
      deletes: deleteCount,
      writeUnits: totalWriteUnits,
    });
  };

  return batch;
}

export function raceWithFirestoreQuotaAbort<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observedAtStart = quotaExceededObserved;
    const hitTodayAtStart = hasQuotaHitToday();
    let unsubscribe = () => {};

    const cleanup = () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };

    const abortForQuota = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          'Quota giornaliera gratuita di scrittura Firestore esaurita. Il limite si azzera automaticamente domani.'
        )
      );
    };

    let isInitialEmission = true;
    unsubscribe = subscribeFirestoreQuotaExceeded((active) => {
      if (isInitialEmission) {
        isInitialEmission = false;
        return;
      }
      if (active) {
        abortForQuota();
      }
    });

    // If quota was already hit earlier today and SDK suppresses duplicate backoff logs,
    // abort after a brief window so saves switch to local queue instead of hanging.
    if (observedAtStart || hitTodayAtStart) {
      timer = setTimeout(() => {
        notifyFirestoreQuotaExceeded();
        abortForQuota();
      }, observedAtStart ? 1500 : 3500);
    }

    promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        quotaExceededObserved = false;
        dismissFirestoreQuotaExceeded();
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    );
  });
}

function textLooksLikeFirestoreQuotaError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('resource-exhausted') ||
    (lower.includes('quota') && lower.includes('exceeded'))
  );
}

// Intercept @firebase/firestore SDK backoff/quota logs so UI alerts appear even when promises stay pending in retry backoff
if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  const win = window as unknown as { __myHomeQuotaLogHooked?: boolean };
  if (!win.__myHomeQuotaLogHooked) {
    win.__myHomeQuotaLogHooked = true;
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const inspectLogArgs = (args: unknown[]) => {
      try {
        const joined = args
          .map((a) => (a instanceof Error ? `${a.message}` : String(a)))
          .join(' ');
        if (
          (joined.includes('@firebase/firestore') || joined.includes('firestore.googleapis.com')) &&
          textLooksLikeFirestoreQuotaError(joined)
        ) {
          notifyFirestoreQuotaExceeded();
        }
      } catch {
        // ignore log inspection failures
      }
    };
    console.error = (...args: unknown[]) => {
      inspectLogArgs(args);
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      inspectLogArgs(args);
      origWarn(...args);
    };
  }
}

export function isFirestoreQuotaError(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const msg = error instanceof Error ? error.message : String(error);
  const matched = textLooksLikeFirestoreQuotaError(`${code} ${msg}`);
  if (matched) {
    notifyFirestoreQuotaExceeded();
  }
  return matched;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isFirestoreQuotaError(error)) {
    const quotaMsg =
      'Quota giornaliera gratuita di scrittura Firestore raggiunta. Il limite si azzera automaticamente domani; nel frattempo le modifiche locali restano temporanee.';
    console.warn('Firestore Quota Exceeded:', { operationType, path });
    throw new Error(quotaMsg);
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

