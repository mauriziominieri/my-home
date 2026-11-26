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

export function notifyFirestoreQuotaExceeded(): void {
  quotaExceededObserved = true;
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

export interface SimulatedBatchSubOp {
  op: 'set' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
  options?: { merge?: boolean };
}

export interface SimulatedFirestoreOp {
  id: string;
  kind: SimulatedFirestoreOpKind;
  createdAt: number;
  section: string;
  actionLabel: string;
  targetTitle: string;
  writeCount: number;
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
  changedFields?: string[];
  changedDetails?: string[];
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
    changedFields: cleanFields,
    changedDetails: cleanDetails,
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
        : room === '__app_settings__' || docId === 'app_settings_state'
          ? 'Impostazioni'
          : room === '__promemoria__' || docId.startsWith('rem_')
            ? 'Promemoria'
            : room === '__vinted__' || docId.startsWith('vinted_')
              ? 'Vinted'
              : room === '__documenti__' || docId.startsWith('doc_') || docId.startsWith('resdoc_') || docId.startsWith('artdoc_')
                ? 'Documenti'
                : room === '__macchina__' || docId.startsWith('car_')
                  ? 'Macchina'
                  : 'Articoli';
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
  if (lower.startsWith('specifiche') || lower.startsWith('prezzi supermercati')) return 'specs';
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
  const collected: string[] = [];
  const byPrefix = new Map<string, string>();
  for (const op of opsForPath) {
    for (const detail of op.changedDetails || []) {
      const inferredKey = inferDetailFieldKey(detail);
      if (inferredKey && !netSet.has(inferredKey)) {
        // Also support homeArticles using purchasePriceEur for "Prezzo:"
        if (!(inferredKey === 'priceEur' && netSet.has('purchasePriceEur'))) {
          continue;
        }
      }
      const colonIdx = detail.indexOf(':');
      const prefix = colonIdx > 0 ? detail.slice(0, colonIdx + 1).toLowerCase() : detail.toLowerCase();
      byPrefix.set(prefix, detail);
    }
  }
  byPrefix.forEach((val) => collected.push(val));
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

function isVaultKeyPresentInRegisteredBase(fileKey: string): boolean {
  for (const [colPath, docsMap] of registeredBaseCollections.entries()) {
    if (
      colPath.endsWith('/homeArticles') ||
      colPath.endsWith('/electricityBills') ||
      colPath.endsWith('/waterBills') ||
      colPath.endsWith('/tariBills')
    ) {
      for (const docData of docsMap.values()) {
        if (
          docData.attachmentKey === fileKey ||
          docData.manualFileKey === fileKey ||
          docData.pdfFileKey === fileKey
        ) {
          return true;
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
      const list = uploadedIndicesByKey.get(k) || [];
      list.push(i);
      uploadedIndicesByKey.set(k, list);
    } else if (op.kind === 'vault_delete' && op.vaultDelete?.keys?.length) {
      for (const k of op.vaultDelete.keys) {
        const prevUploads = uploadedIndicesByKey.get(k);
        if (prevUploads && prevUploads.length > 0) {
          for (const idx of prevUploads) {
            uploadIndicesToDrop.add(idx);
          }
          uploadedIndicesByKey.delete(k);
          if (!isVaultKeyPresentInRegisteredBase(k)) {
            let dropSet = deletedKeysToDropByOpIndex.get(i);
            if (!dropSet) {
              dropSet = new Set<string>();
              deletedKeysToDropByOpIndex.set(i, dropSet);
            }
            dropSet.add(k);
          }
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

function enqueueSimulatedOp(op: SimulatedFirestoreOp): void {
  const appended = [...simulatedFirestoreOps, op];
  if ((op.kind === 'set' || op.kind === 'delete') && op.path) {
    simulatedFirestoreOps = compactSimulatedOpsList(appended, op.path);
  } else if (op.kind === 'batch' && op.batchOps?.length) {
    simulatedFirestoreOps = compactSimulatedOpsList(
      appended,
      Array.from(new Set(op.batchOps.map((s) => s.path).filter(Boolean)))
    );
  } else if (op.kind === 'vault_delete') {
    simulatedFirestoreOps = compactVaultOps(appended);
  } else {
    simulatedFirestoreOps = appended;
  }
  persistAndEmitSimulatedOps();
}

export function enqueueSimulatedVaultUpload(payload: {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  ownerUid: string;
}): void {
  const estimatedOps = Math.max(2, Math.ceil((payload.size * 1.35) / 600_000) + 1);
  enqueueSimulatedOp({
    id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'vault_upload',
    createdAt: Date.now(),
    section: 'Allegati Vault',
    actionLabel: 'Caricamento allegato',
    targetTitle: payload.fileName,
    writeCount: estimatedOps,
    vaultUpload: payload,
  });
}

export function enqueueSimulatedVaultDelete(payload: {
  keys: string[];
  ownerUid: string;
}): void {
  if (payload.keys.length === 0) return;
  enqueueSimulatedOp({
    id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'vault_delete',
    createdAt: Date.now(),
    section: 'Allegati Vault',
    actionLabel: 'Rimozione allegati',
    targetTitle:
      payload.keys.length === 1 ? payload.keys[0] : `${payload.keys.length} allegati`,
    writeCount: payload.keys.length * 2,
    vaultDelete: payload,
  });
}

export function discardSimulatedFirestoreOp(id: string): void {
  const target = simulatedFirestoreOps.find((op) => op.id === id);
  if (!target) return;
  const isCancelledNewDoc =
    target.kind === 'set' &&
    !target.options?.merge &&
    Boolean(target.path) &&
    Boolean(target.changedFields?.includes('__new__'));

  const next = simulatedFirestoreOps.filter((op) => {
    if (op.id === id) return false;
    if (
      isCancelledNewDoc &&
      op.createdAt >= target.createdAt &&
      op.kind === 'set' &&
      op.options?.merge &&
      op.path === target.path
    ) {
      return false;
    }
    return true;
  });
  if (next.length === simulatedFirestoreOps.length) return;
  simulatedFirestoreOps = next;
  persistAndEmitSimulatedOps();
}

export function clearSimulatedFirestoreOps(): void {
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

export async function flushSimulatedFirestoreOps(): Promise<SimulatedFlushResult> {
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
        'Accedi con il tuo account Google per inviare a Firestore le operazioni simulate in locale.',
      at: Date.now(),
    };
    simulatedFlushState = { flushing: false, lastResult: res };
    emitSimulatedFlushState();
    return res;
  }

  activeFlushPromise = (async (): Promise<SimulatedFlushResult> => {
    simulatedFlushState = { flushing: true, lastResult: null };
    emitSimulatedFlushState();

    const plan = getSimulatedBatchPlan(snapshot);
    let flushed = 0;
    let failed = 0;
    let docWrites = 0;
    let batchCommits = 0;
    let errorMessage: string | undefined;

    // 1. Replay queued binary vault uploads first (chunked internally for 10MB payload limits)
    for (const op of plan.vaultUploadOps) {
      if (!op.vaultUpload) continue;
      try {
        const { replayVaultUploadToFirestore } = await import('./utils/documentVault');
        await replayVaultUploadToFirestore(op.vaultUpload);
        flushed += 1;
        simulatedFirestoreOps = simulatedFirestoreOps.filter((item) => item.id !== op.id);
        persistAndEmitSimulatedOps();
      } catch (err) {
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
        failed += 1;
        errorMessage =
          err instanceof Error
            ? err.message
            : 'Errore durante la rimozione degli allegati su Firestore.';
      }
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
    simulatedFlushState = {
      flushing: false,
      lastResult: finalRes,
    };
    emitSimulatedFlushState();
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
const MAX_DAILY_USAGE_DAYS = 30;

export interface DailyFirestoreUsageEntry {
  date: string; // YYYY-MM-DD local
  writes: number;
  deletes: number;
  reads: number;
  savedInTestMode: number;
  settingsWrites: number;
}

function getLocalTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadDailyUsageHistory(): DailyFirestoreUsageEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DAILY_USAGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is DailyFirestoreUsageEntry =>
        Boolean(item && typeof item === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String((item as { date?: unknown }).date || '')))
      )
      .map((item) => ({
        date: String(item.date),
        writes: Math.max(0, Math.round(Number(item.writes || 0))),
        deletes: Math.max(0, Math.round(Number(item.deletes || 0))),
        reads: Math.max(0, Math.round(Number(item.reads || 0))),
        savedInTestMode: Math.max(0, Math.round(Number(item.savedInTestMode || 0))),
        settingsWrites: Math.max(0, Math.round(Number(item.settingsWrites || 0))),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_DAILY_USAGE_DAYS);
  } catch {
    return [];
  }
}

let dailyUsageHistory: DailyFirestoreUsageEntry[] = loadDailyUsageHistory();
const dailyUsageListeners = new Set<(entries: DailyFirestoreUsageEntry[]) => void>();

function saveAndEmitDailyUsage(): void {
  const trimmed = [...dailyUsageHistory]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DAILY_USAGE_DAYS);
  dailyUsageHistory = trimmed;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DAILY_USAGE_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore localStorage quota errors
    }
  }
  const snapshot = trimmed.map((e) => ({ ...e }));
  dailyUsageListeners.forEach((listener) => listener(snapshot));
}

function mutateTodayDailyUsage(
  updater: (entry: DailyFirestoreUsageEntry) => void
): void {
  const today = getLocalTodayIsoDate();
  const nextList = dailyUsageHistory.map((e) => ({ ...e }));
  let todayEntry = nextList.find((e) => e.date === today);
  if (!todayEntry) {
    todayEntry = {
      date: today,
      writes: 0,
      deletes: 0,
      reads: 0,
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
  dailyUsageHistory = [];
  saveAndEmitDailyUsage();
}

export function recordFirestoreReadsExecuted(count = 1): void {
  if (!Number.isFinite(count) || count <= 0) return;
  const cleanCount = Math.round(count);
  mutateTodayDailyUsage((entry) => {
    entry.reads += cleanCount;
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
  options?: { deletes?: number; isSettingsWrite?: boolean }
): void {
  if (count <= 0) return;
  const cleanCount = Math.round(count);
  const cleanDeletes = Math.max(0, Math.min(cleanCount, Math.round(options?.deletes || 0)));
  const cleanWrites = cleanCount - cleanDeletes;
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
    recordFirestoreReadsExecuted(1);
  }
  return snap;
}

export async function trackedGetDocs<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
  queryObj: Query<AppModelType, DbModelType>
): Promise<QuerySnapshot<AppModelType, DbModelType>> {
  const snap = await rawGetDocs(queryObj);
  if (!snap.metadata.fromCache) {
    recordFirestoreReadsExecuted(Math.max(1, snap.size));
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
          // With persistentLocalCache active, if cache emitted first, the server only bills for docs changed/returned in docChanges().
          const serverReads = hadCacheSnapshotBefore
            ? snap.docChanges().length
            : Math.max(1, snap.size);
          if (serverReads > 0) {
            recordFirestoreReadsExecuted(serverReads);
          }
        } else {
          const changesCount = snap.docChanges().length;
          if (changesCount > 0) {
            recordFirestoreReadsExecuted(changesCount);
          }
        }
      } else {
        if (!receivedServerSnap) {
          receivedServerSnap = true;
          if (!hadCacheSnapshotBefore) {
            recordFirestoreReadsExecuted(1);
          }
        } else {
          recordFirestoreReadsExecuted(1);
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

export const guardedSetDoc: typeof rawSetDoc = (async (...args: unknown[]) => {
  const docRef = args[0] as DocumentReference | undefined;
  const path = docRef?.path || '';
  const hint = consumeSimulatedOpHint(path);
  if (firestoreWriteStats.writesDisabled) {
    const rawData = args[1];
    const rawOptions = args[2] as SetOptions | undefined;
    const serializedData = serializeFirestoreRecord(rawData);
    const mergeOpt =
      rawOptions && typeof rawOptions === 'object' && 'merge' in rawOptions
        ? Boolean((rawOptions as { merge?: boolean }).merge)
        : false;
    const desc = describePathSectionAndTitle(path, serializedData);
    const resolvedTitle = hint?.title || desc.targetTitle;
    const resolvedAction = hint?.actionLabel || (mergeOpt ? 'Modifica' : 'Salvataggio');
    if (path) {
      enqueueSimulatedOp({
        id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        kind: 'set',
        createdAt: Date.now(),
        section: desc.section,
        actionLabel: resolvedAction,
        targetTitle: resolvedTitle,
        writeCount: 1,
        changedFields:
          hint?.changedFields && hint.changedFields.length > 0 ? hint.changedFields : undefined,
        changedDetails:
          hint?.changedDetails && hint.changedDetails.length > 0 ? hint.changedDetails : undefined,
        path,
        data: serializedData,
        options: mergeOpt ? { merge: true } : undefined,
      });
    }
    recordFirestoreWritesSaved(1, `${resolvedAction} locale: ${resolvedTitle}`);
    return;
  }
  await raceWithFirestoreQuotaAbort(
    (rawSetDoc as (...inner: unknown[]) => Promise<void>)(...args)
  );
  recordFirestoreWritesExecuted(1, 'setDoc');
}) as typeof rawSetDoc;

export async function saveSystemStateDoc(
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  await raceWithFirestoreQuotaAbort(rawSetDoc(doc(db, path), data));
  recordFirestoreWritesExecuted(1, 'Impostazioni app (cloud)', { isSettingsWrite: true });
}

export const guardedDeleteDoc: typeof rawDeleteDoc = (async (...args: unknown[]) => {
  const docRef = args[0] as DocumentReference | undefined;
  const path = docRef?.path || '';
  const hint = consumeSimulatedOpHint(path);
  if (firestoreWriteStats.writesDisabled) {
    const desc = describePathSectionAndTitle(path);
    const resolvedTitle = hint?.title || desc.targetTitle;
    if (path) {
      enqueueSimulatedOp({
        id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        kind: 'delete',
        createdAt: Date.now(),
        section: desc.section,
        actionLabel: hint?.actionLabel || 'Eliminazione',
        targetTitle: resolvedTitle,
        writeCount: 1,
        changedFields:
          hint?.changedFields && hint.changedFields.length > 0 ? hint.changedFields : undefined,
        changedDetails:
          hint?.changedDetails && hint.changedDetails.length > 0 ? hint.changedDetails : undefined,
        path,
      });
    }
    recordFirestoreWritesSaved(1, `Eliminazione locale: ${resolvedTitle}`);
    return;
  }
  await raceWithFirestoreQuotaAbort(
    (rawDeleteDoc as (...inner: unknown[]) => Promise<void>)(...args)
  );
  recordFirestoreWritesExecuted(1, 'deleteDoc', { deletes: 1 });
}) as typeof rawDeleteDoc;

export function guardedWriteBatch(firestore: Firestore): ReturnType<typeof rawWriteBatch> {
  const batch = rawWriteBatch(firestore);
  let opCount = 0;
  let deleteCount = 0;
  const recordedSubOps: SimulatedBatchSubOp[] = [];

  const origSet = batch.set.bind(batch);
  const origUpdate = batch.update.bind(batch);
  const origDelete = batch.delete.bind(batch);
  const origCommit = batch.commit.bind(batch);

  batch.set = ((...args: unknown[]) => {
    opCount += 1;
    const docRef = args[0] as DocumentReference | undefined;
    const rawData = args[1];
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
      const mergedFields = Array.from(
        new Set(batchHints.flatMap((h) => h.changedFields || []))
      );
      const mergedDetails = Array.from(
        new Set(batchHints.flatMap((h) => h.changedDetails || []))
      );
      enqueueSimulatedOp({
        id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        kind: 'batch',
        createdAt: Date.now(),
        section: desc.section,
        actionLabel:
          batchHints.find((h) => h.actionLabel)?.actionLabel ||
          (recordedSubOps.every((s) => s.op === 'delete')
            ? 'Eliminazione multipla'
            : 'Salvataggio multiplo'),
        targetTitle: summaryTitle,
        writeCount: opCount,
        changedFields: mergedFields.length > 0 ? mergedFields : undefined,
        changedDetails: mergedDetails.length > 0 ? mergedDetails : undefined,
        batchOps: recordedSubOps,
      });
      recordFirestoreWritesSaved(opCount, `Batch (${opCount} op) locale: ${summaryTitle}`);
      return;
    }
    await raceWithFirestoreQuotaAbort(origCommit());
    recordFirestoreWritesExecuted(opCount, `batch (${opCount} op)`, { deletes: deleteCount });
  };

  return batch;
}

export function directWriteBatch(firestore: Firestore): ReturnType<typeof rawWriteBatch> {
  const batch = rawWriteBatch(firestore);
  let opCount = 0;
  let deleteCount = 0;

  const origSet = batch.set.bind(batch);
  const origUpdate = batch.update.bind(batch);
  const origDelete = batch.delete.bind(batch);
  const origCommit = batch.commit.bind(batch);

  batch.set = ((...args: unknown[]) => {
    opCount += 1;
    return (origSet as (...inner: unknown[]) => ReturnType<typeof batch.set>)(...args);
  }) as typeof batch.set;

  batch.update = ((...args: unknown[]) => {
    opCount += 1;
    return (origUpdate as (...inner: unknown[]) => ReturnType<typeof batch.update>)(...args);
  }) as typeof batch.update;

  batch.delete = ((...args: unknown[]) => {
    opCount += 1;
    deleteCount += 1;
    return (origDelete as (...inner: unknown[]) => ReturnType<typeof batch.delete>)(...args);
  }) as typeof batch.delete;

  batch.commit = async () => {
    if (opCount === 0) return;
    await raceWithFirestoreQuotaAbort(origCommit());
    recordFirestoreWritesExecuted(opCount, `sync blocco (${opCount} op)`, { deletes: deleteCount });
  };

  return batch;
}

export function raceWithFirestoreQuotaAbort<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observedAtStart = quotaExceededObserved;
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

    // If quota was already hit earlier in this session and SDK suppresses duplicate backoff logs,
    // abort after a brief window so spinners never keep spinning.
    if (observedAtStart) {
      timer = setTimeout(() => {
        notifyFirestoreQuotaExceeded();
        abortForQuota();
      }, 1500);
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

