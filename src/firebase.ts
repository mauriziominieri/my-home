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
  FieldValue,
  Firestore,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc as rawSetDoc,
  SetOptions,
  Timestamp,
  writeBatch as rawWriteBatch,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Primary unified Firebase project (Auth, Firestore, Gmail OAuth & Admin SDK)
const app = getApps().some((a) => a.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
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
  errorMessage?: string;
  at: number;
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
    return { section: 'Ricerche', targetTitle: title };
  }
  if (col === 'homeArticles') {
    const room = String(data?.room || '');
    const section =
      room === '__spesa__' || docId.startsWith('spesa_')
        ? 'Spesa'
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

function compactSinglePathOps(
  ops: SimulatedFirestoreOp[],
  targetPath: string
): SimulatedFirestoreOp[] {
  const cleanTarget = targetPath.replace(/^\/+|\/+$/g, '');
  if (!cleanTarget) return ops;

  // Do not reorder across a multi-doc batch op that also touches targetPath.
  const hasConflictingBatch = ops.some(
    (op) =>
      op.kind === 'batch' &&
      op.batchOps?.some((sub) => sub.path.replace(/^\/+|\/+$/g, '') === cleanTarget)
  );
  if (hasConflictingBatch) return ops;

  const { known, baseDoc } = lookupRegisteredBaseDoc(cleanTarget);
  if (!known) return ops;

  const indices: number[] = [];
  const opsForPath: SimulatedFirestoreOp[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (
      (op.kind === 'set' || op.kind === 'delete') &&
      op.path &&
      op.path.replace(/^\/+|\/+$/g, '') === cleanTarget
    ) {
      indices.push(i);
      opsForPath.push(op);
    }
  }
  if (opsForPath.length === 0) return ops;

  let state: Record<string, unknown> | undefined = baseDoc ? { ...baseDoc } : undefined;
  let currentSerializedPatch: Record<string, unknown> = {};
  let isFullOverwrite = false;
  let wasDeleted = false;

  for (const op of opsForPath) {
    if (op.kind === 'delete') {
      wasDeleted = true;
      isFullOverwrite = false;
      currentSerializedPatch = {};
      state = undefined;
    } else if (op.kind === 'set') {
      wasDeleted = false;
      const patch = op.data || {};
      if (!op.options?.merge) {
        isFullOverwrite = true;
        currentSerializedPatch = { ...patch };
        state = applySerializedPatchToRawDoc(undefined, patch, false, op.createdAt);
      } else {
        currentSerializedPatch = { ...currentSerializedPatch, ...patch };
        state = applySerializedPatchToRawDoc(state, patch, true, op.createdAt);
      }
    }
  }

  const firstOp = opsForPath[0];
  const lastOp = opsForPath[opsForPath.length - 1];
  let replacement: SimulatedFirestoreOp | null = null;

  if (wasDeleted) {
    if (!baseDoc) {
      // Created locally and deleted locally before flushing: net zero DB ops.
      replacement = null;
    } else {
      replacement = {
        ...lastOp,
        kind: 'delete',
        writeCount: 1,
      };
    }
  } else if (!baseDoc) {
    if (opsForPath.length === 1) {
      return ops;
    }
    const desc = describePathSectionAndTitle(lastOp.path || cleanTarget, currentSerializedPatch);
    replacement = {
      ...firstOp,
      createdAt: lastOp.createdAt,
      targetTitle: lastOp.targetTitle || desc.targetTitle,
      writeCount: 1,
      data: currentSerializedPatch,
      options: isFullOverwrite ? undefined : { merge: true },
      changedFields: firstOp.changedFields?.includes('__new__')
        ? ['__new__']
        : firstOp.changedFields,
      changedDetails: mergeDetailsForCompactedOp(opsForPath, [], true),
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
      replacement = null;
    } else {
      let compactData: Record<string, unknown>;
      let compactMerge = !isFullOverwrite;

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

      const desc = describePathSectionAndTitle(lastOp.path || cleanTarget, compactData);
      replacement = {
        ...lastOp,
        kind: 'set',
        section: lastOp.section || desc.section,
        actionLabel:
          firstOp.actionLabel === 'Nuovo prodotto' ? 'Nuovo prodotto' : lastOp.actionLabel,
        targetTitle: lastOp.targetTitle || desc.targetTitle,
        writeCount: 1,
        data: compactData,
        options: compactMerge ? { merge: true } : undefined,
        changedFields: netChangedNonMetaKeys,
        changedDetails: mergeDetailsForCompactedOp(opsForPath, netChangedNonMetaKeys, false),
      };
    }
  }

  const lastIndex = indices[indices.length - 1];
  const indexSet = new Set(indices);
  const compacted: SimulatedFirestoreOp[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (!indexSet.has(i)) {
      compacted.push(ops[i]);
    } else if (i === lastIndex && replacement) {
      compacted.push(replacement);
    }
  }
  return compacted;
}

function compactSimulatedOpsList(
  ops: SimulatedFirestoreOp[],
  targetPath?: string
): SimulatedFirestoreOp[] {
  if (targetPath) {
    return compactSinglePathOps(ops, targetPath);
  }
  const uniquePaths = new Set<string>();
  for (const op of ops) {
    if ((op.kind === 'set' || op.kind === 'delete') && op.path) {
      uniquePaths.add(op.path);
    }
  }
  let next = ops;
  for (const path of uniquePaths) {
    next = compactSinglePathOps(next, path);
  }
  return next;
}

function enqueueSimulatedOp(op: SimulatedFirestoreOp): void {
  const appended = [...simulatedFirestoreOps, op];
  simulatedFirestoreOps =
    (op.kind === 'set' || op.kind === 'delete') && op.path
      ? compactSimulatedOpsList(appended, op.path)
      : appended;
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

export async function flushSimulatedFirestoreOps(): Promise<SimulatedFlushResult> {
  if (activeFlushPromise) return activeFlushPromise;

  const compactedBeforeFlush = compactSimulatedOpsList(simulatedFirestoreOps);
  if (compactedBeforeFlush.length !== simulatedFirestoreOps.length || compactedBeforeFlush.some((c, idx) => c !== simulatedFirestoreOps[idx])) {
    simulatedFirestoreOps = compactedBeforeFlush;
    persistAndEmitSimulatedOps();
  }

  const snapshot = [...simulatedFirestoreOps];
  if (snapshot.length === 0) {
    return { total: 0, flushed: 0, failed: 0, at: Date.now() };
  }

  if (firestoreWriteStats.writesDisabled) {
    return { total: snapshot.length, flushed: 0, failed: 0, at: Date.now() };
  }

  if (!auth.currentUser) {
    const res: SimulatedFlushResult = {
      total: snapshot.length,
      flushed: 0,
      failed: snapshot.length,
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

    let flushed = 0;
    let failed = 0;
    let errorMessage: string | undefined;

    for (const op of snapshot) {
      try {
        if (op.kind === 'set' && op.path) {
          const payload = deserializeFirestoreRecord(op.data);
          const ref = doc(db, op.path);
          if (op.options) {
            await raceWithFirestoreQuotaAbort(rawSetDoc(ref, payload, op.options));
          } else {
            await raceWithFirestoreQuotaAbort(rawSetDoc(ref, payload));
          }
          recordFirestoreWritesExecuted(1, `Sync: ${op.targetTitle}`);
        } else if (op.kind === 'delete' && op.path) {
          await raceWithFirestoreQuotaAbort(rawDeleteDoc(doc(db, op.path)));
          recordFirestoreWritesExecuted(1, `Sync eliminazione: ${op.targetTitle}`);
        } else if (op.kind === 'batch' && op.batchOps && op.batchOps.length > 0) {
          const batch = rawWriteBatch(db);
          for (const sub of op.batchOps) {
            const ref = doc(db, sub.path);
            if (sub.op === 'delete') {
              batch.delete(ref);
            } else if (sub.op === 'update') {
              batch.update(ref, deserializeFirestoreRecord(sub.data));
            } else if (sub.options) {
              batch.set(ref, deserializeFirestoreRecord(sub.data), sub.options);
            } else {
              batch.set(ref, deserializeFirestoreRecord(sub.data));
            }
          }
          await raceWithFirestoreQuotaAbort(batch.commit());
          recordFirestoreWritesExecuted(op.writeCount, `Sync batch (${op.writeCount} op)`);
        } else if (op.kind === 'vault_upload' && op.vaultUpload) {
          const { replayVaultUploadToFirestore } = await import('./utils/documentVault');
          await replayVaultUploadToFirestore(op.vaultUpload);
        } else if (op.kind === 'vault_delete' && op.vaultDelete) {
          const { replayVaultDeleteToFirestore } = await import('./utils/documentVault');
          await replayVaultDeleteToFirestore(op.vaultDelete);
        }

        flushed += 1;
        simulatedFirestoreOps = simulatedFirestoreOps.filter((item) => item.id !== op.id);
        persistAndEmitSimulatedOps();
      } catch (err) {
        failed += 1;
        errorMessage =
          err instanceof Error
            ? err.message
            : 'Errore durante la sincronizzazione su Firestore.';
      }
    }

    const finalRes: SimulatedFlushResult = {
      total: snapshot.length,
      flushed,
      failed,
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
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem('myhome_app_settings_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { firestoreWritesDisabled?: unknown };
    return Boolean(parsed?.firestoreWritesDisabled);
  } catch {
    return false;
  }
}

let firestoreWriteStats: FirestoreWriteStats = {
  writesDisabled: readInitialWritesDisabled(),
  writesSavedCount: 0,
  writesExecutedCount: 0,
  lastActionLabel: null,
  lastActionAt: null,
};

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
  firestoreWriteStats = {
    ...firestoreWriteStats,
    writesSavedCount: firestoreWriteStats.writesSavedCount + count,
    lastActionLabel: label || 'Test browser (scrittura ignorata)',
    lastActionAt: Date.now(),
  };
  emitWriteStats();
}

export function recordFirestoreWritesExecuted(count = 1, label?: string): void {
  if (count <= 0) return;
  firestoreWriteStats = {
    ...firestoreWriteStats,
    writesExecutedCount: firestoreWriteStats.writesExecutedCount + count,
    lastActionLabel: label || 'Scrittura Firestore completata',
    lastActionAt: Date.now(),
  };
  emitWriteStats();
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
  recordFirestoreWritesExecuted(1, 'deleteDoc');
}) as typeof rawDeleteDoc;

export function guardedWriteBatch(firestore: Firestore): ReturnType<typeof rawWriteBatch> {
  const batch = rawWriteBatch(firestore);
  let opCount = 0;
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
    recordFirestoreWritesExecuted(opCount, `batch (${opCount} op)`);
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

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
