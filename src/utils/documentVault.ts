import {
  collection,
  doc,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  enqueueSimulatedVaultDelete,
  enqueueSimulatedVaultUpload,
  guardedWriteBatch as writeBatch,
  isFirestoreQuotaExceededActive,
  isFirestoreWritesDisabled,
  recordFirestoreWritesSaved,
  trackedGetDoc as getDoc,
  trackedGetDocs as getDocs,
} from '../firebase';
import {
  ArticleAttachmentType,
  BillRecord,
  HomeArticleRecord,
  HomeDocumentCategory,
  HomeDocumentRecord,
  ProductResearchRecord,
  TariBillRecord,
  WaterBillRecord,
} from '../types/home';
import { resolveApiUrl } from './apiBase';

export const SYSTEM_ROOM_DOCUMENTS = '__documenti__';

export const DOCUMENT_CATEGORIES: HomeDocumentCategory[] = [
  'Mutuo & Casa',
  'Internet & Wi-Fi',
  'Contratti & Utenze',
  'Assicurazioni',
  'Fiscale & Identità',
  'Altro',
];

export interface DocumentStarterTemplate {
  title: string;
  category: HomeDocumentCategory;
  provider: string;
  referenceCode?: string;
  notes?: string;
}

export const DOCUMENT_STARTER_TEMPLATES: DocumentStarterTemplate[] = [
  {
    title: 'Contratto Mutuo Prima Casa',
    category: 'Mutuo & Casa',
    provider: 'Banca / Mutuo',
    notes: 'Atto mutuo, piano ammortamento, IBAN rata mensile.',
  },
  {
    title: 'Contratto Fibra / Wi-Fi WindTre',
    category: 'Internet & Wi-Fi',
    provider: 'WindTre',
    notes: 'SSID Wi-Fi casa, password router, codice migrazione linea fissa.',
  },
  {
    title: 'Rogito Notarile & Planimetria Casa',
    category: 'Mutuo & Casa',
    provider: 'Notaio / Catasto',
    notes: 'Atto di compravendita, visura catastale e APE.',
  },
  {
    title: 'Polizza Casa / Incendio & Scoppio',
    category: 'Assicurazioni',
    provider: 'Compagnia Assicurativa',
    notes: 'Numero polizza, massimali e condizioni sinistri.',
  },
  {
    title: 'Contratto Luce / Acqua / Rifiuti',
    category: 'Contratti & Utenze',
    provider: 'Octopus / Edison / AcegasApsAmga',
    notes: 'POD IT001E11251419, fornitura idrica e condizioni tariffarie.',
  },
  {
    title: 'Documenti Identità & Codice Fiscale',
    category: 'Fiscale & Identità',
    provider: 'Comune / Agenzia Entrate',
    notes: 'CIE, Tessera Sanitaria, Patente o Passaporto famiglia.',
  },
];

// ---------- Bundled real bill PDF assets (served statically on every device, 0 AI credits) ----------

export const VAULT_UPDATED_EVENT = 'myhome-vault-updated';
export const VAULT_CLOUD_STATUS_EVENT = 'myhome-vault-cloud-status';

export const MAX_CLOUD_FILE_BYTES = 6_000_000; // ~6 MB (max 14 chunk <= 600k chars base64)
const CHUNK_CHAR_SIZE = 600_000;

export type VaultCloudStatus = 'idle' | 'ok' | 'rules-required' | 'error';

let currentVaultCloudStatus: VaultCloudStatus = 'idle';

export function getVaultCloudStatus(): VaultCloudStatus {
  return currentVaultCloudStatus;
}

function setVaultCloudStatus(status: VaultCloudStatus): void {
  if (currentVaultCloudStatus === status) return;
  currentVaultCloudStatus = status;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VAULT_CLOUD_STATUS_EVENT, { detail: status }));
  }
}

export function subscribeVaultCloudStatus(listener: (status: VaultCloudStatus) => void): () => void {
  listener(currentVaultCloudStatus);
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener(currentVaultCloudStatus);
  window.addEventListener(VAULT_CLOUD_STATUS_EVENT, handler);
  return () => window.removeEventListener(VAULT_CLOUD_STATUS_EVENT, handler);
}

export function notifyVaultUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VAULT_UPDATED_EVENT));
  }
}

export function resolveStaticAssetUrl(relPath: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relPath.replace(/^\/+/, '')}`;
}

export interface BundledPdfAsset {
  relPath: string;
  fileName: string;
  mimeType: string;
}

export const STATIC_BILL_PDF_ASSETS: Record<string, BundledPdfAsset> = {};

// ---------- Binary vault: Dedicated Backblaze B2 (S3) storage + compressed Firestore fallback + IndexedDB cache ----------

const IDB_NAME = 'myhome_vault_files_v1';
const IDB_STORE = 'files';
const IDB_VERSION = 1;
const META_CACHE_TTL_MS = 10 * 60 * 1000;
const META_CACHE_LS_PREFIX = 'myhome_vault_meta_cache_v1_';
const STORAGE_STATUS_TTL_MS = 2 * 60 * 1000;

export type VaultOrigin = 'firestore' | 'local' | 'bundled';
export type DedicatedVaultStorageBackend = 's3' | 'firestore';

export interface DedicatedVaultStorageStatus {
  configured: boolean;
  backend: DedicatedVaultStorageBackend;
  providerLabel: string;
  freeQuotaLabel: string;
  maxFileBytes: number;
  checkedAt: number;
}

export interface VaultOpAuditHint {
  groupKey?: string;
  groupSection?: string;
  groupTitle?: string;
  actionLabel?: string;
  displayTitle?: string;
  changedDetails?: string[];
  storageMode?: 'auto' | 'local';
}

export interface VaultDeleteAuditHint {
  groupKey?: string;
  groupSection?: string;
  groupTitle?: string;
  actionLabel?: string;
  displayTitle?: string;
  changedDetails?: string[];
}

export interface StoredVaultFile {
  key: string;
  fileName: string;
  mimeType: string;
  size: number;
  updatedAt: number;
  blob: Blob;
  origin?: VaultOrigin;
  storageBackend?: DedicatedVaultStorageBackend;
  cloudSynced?: boolean;
  cloudTooLarge?: boolean;
  savedLocallyOnly?: boolean;
}

export interface VaultFileMeta {
  fileName: string;
  mimeType: string;
  size: number;
  updatedAt: number;
  origin: VaultOrigin;
  chunkCount?: number;
  storageBackend?: DedicatedVaultStorageBackend;
}

interface CloudVaultDocMeta {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  storageBackend?: DedicatedVaultStorageBackend;
  updatedAtMs: number;
}

const cloudMetaCache = new Map<string, CloudVaultDocMeta>();
let cachedStorageStatus: DedicatedVaultStorageStatus | null = null;
let cachedStorageStatusEndpoint: string | null = null;
let inFlightStatusPromise: Promise<DedicatedVaultStorageStatus> | null = null;
const inFlightMetaListByUid = new Map<string, Promise<Record<string, VaultFileMeta>>>();

export function sanitizeVaultFileKey(key: string): string {
  const clean = (key || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return clean || 'file_unknown';
}

function isPermissionDeniedError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${(err as { code?: string }).code || ''} ${err.message}`.toLowerCase()
      : String(err).toLowerCase();
  return msg.includes('permission-denied') || msg.includes('missing or insufficient permissions');
}

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (
    val &&
    typeof val === 'object' &&
    'toMillis' in val &&
    typeof (val as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return Date.now();
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const sliceSize = 0x8000;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const sub = bytes.subarray(i, Math.min(i + sliceSize, bytes.length));
    parts.push(String.fromCharCode(...sub));
  }
  return btoa(parts.join(''));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

async function gzipBlobToPayload(blob: Blob): Promise<string> {
  const rawBytes = new Uint8Array(await blob.arrayBuffer());
  if (typeof CompressionStream !== 'undefined' && rawBytes.length > 512) {
    try {
      const cs = new CompressionStream('gzip');
      const stream = new Blob([rawBytes]).stream().pipeThrough(cs);
      const compressedBuf = await new Response(stream).arrayBuffer();
      const gzBytes = new Uint8Array(compressedBuf);
      if (gzBytes.length + 4 < rawBytes.length) {
        return `GZ:${uint8ArrayToBase64(gzBytes)}`;
      }
    } catch {
      // fallback to plain base64 if browser CompressionStream fails
    }
  }
  return uint8ArrayToBase64(rawBytes);
}

async function payloadToBlob(payload: string, mimeType: string): Promise<Blob> {
  if (payload.startsWith('GZ:')) {
    const gzBytes = base64ToUint8Array(payload.slice(3));
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([new Uint8Array(gzBytes)]).stream().pipeThrough(ds);
        const rawBuf = await new Response(stream).arrayBuffer();
        return new Blob([rawBuf], { type: mimeType || 'application/octet-stream' });
      } catch {
        // fallback if somehow malformed
      }
    }
  }
  const bytes = base64ToUint8Array(payload);
  return new Blob([new Uint8Array(bytes)], { type: mimeType || 'application/octet-stream' });
}

async function optimizeVaultImageBlob(
  file: Blob,
  fileName: string,
  mimeType: string
): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const lowerMime = mimeType.toLowerCase();
  const compressible =
    lowerMime === 'image/jpeg' || lowerMime === 'image/png' || lowerMime === 'image/webp';
  if (!compressible || file.size <= 140_000 || typeof document === 'undefined') {
    return { blob: file, fileName, mimeType };
  }
  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image decode error'));
        el.src = objectUrl;
      });
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { blob: file, fileName, mimeType };
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const targetMime = lowerMime === 'image/png' ? 'image/webp' : 'image/jpeg';
      const converted = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((res) => resolve(res), targetMime, 0.82)
      );
      if (converted && converted.size > 0 && converted.size < file.size * 0.9) {
        const nextExt = targetMime === 'image/webp' ? '.webp' : '.jpg';
        const nextName = fileName.replace(/\.[a-z0-9]{2,5}$/i, nextExt);
        return {
          blob: converted,
          fileName: nextName === fileName && !fileName.endsWith(nextExt) ? `${fileName}${nextExt}` : nextName,
          mimeType: targetMime,
        };
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    // keep original blob if canvas optimization isn't possible
  }
  return { blob: file, fileName, mimeType };
}

function buildVaultApiUrl(path: string): string | null {
  const resolved = resolveApiUrl(path);
  if (resolved) return resolved;
  const legacyEnvOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)
    ?.trim()
    .replace(/\/+$/, '');
  if (legacyEnvOrigin) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${legacyEnvOrigin}${cleanPath}`;
  }
  return null;
}

async function getFirebaseAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export async function getDedicatedVaultStorageStatus(
  forceRefresh = false
): Promise<DedicatedVaultStorageStatus> {
  const fallback: DedicatedVaultStorageStatus = {
    configured: false,
    backend: 'firestore',
    providerLabel: 'Firestore Vault',
    freeQuotaLabel: '1 GB condiviso (compresso)',
    maxFileBytes: MAX_CLOUD_FILE_BYTES,
    checkedAt: Date.now(),
  };

  const endpoint = buildVaultApiUrl('/api/vault/status');
  if (
    !forceRefresh &&
    cachedStorageStatus &&
    cachedStorageStatusEndpoint === endpoint &&
    Date.now() - cachedStorageStatus.checkedAt < STORAGE_STATUS_TTL_MS
  ) {
    return cachedStorageStatus;
  }
  if (!forceRefresh && inFlightStatusPromise && cachedStorageStatusEndpoint === endpoint) {
    return inFlightStatusPromise;
  }

  const token = await getFirebaseAuthToken();
  if (!endpoint || !token) {
    cachedStorageStatusEndpoint = endpoint;
    cachedStorageStatus = fallback;
    return fallback;
  }

  cachedStorageStatusEndpoint = endpoint;
  inFlightStatusPromise = (async () => {
    try {
      const resp = await fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!resp.ok) {
        cachedStorageStatus = fallback;
        return fallback;
      }
      const json = (await resp.json()) as Partial<DedicatedVaultStorageStatus>;
      const next: DedicatedVaultStorageStatus = {
        configured: Boolean(json.configured),
        backend: json.backend === 's3' ? 's3' : 'firestore',
        providerLabel: String(json.providerLabel || fallback.providerLabel),
        freeQuotaLabel: String(json.freeQuotaLabel || fallback.freeQuotaLabel),
        maxFileBytes:
          typeof json.maxFileBytes === 'number' && json.maxFileBytes > 0
            ? json.maxFileBytes
            : json.configured
              ? 12_000_000
              : MAX_CLOUD_FILE_BYTES,
        checkedAt: Date.now(),
      };
      cachedStorageStatus = next;
      return next;
    } catch {
      cachedStorageStatus = fallback;
      return fallback;
    } finally {
      inFlightStatusPromise = null;
    }
  })();

  return inFlightStatusPromise;
}

function readPersistedMetaCache(uid: string): Record<string, VaultFileMeta> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${META_CACHE_LS_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; items?: Record<string, VaultFileMeta> };
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > META_CACHE_TTL_MS ||
      !parsed.items
    ) {
      return null;
    }
    return parsed.items;
  } catch {
    return null;
  }
}

function writePersistedMetaCache(uid: string, items: Record<string, VaultFileMeta>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      `${META_CACHE_LS_PREFIX}${uid}`,
      JSON.stringify({ savedAt: Date.now(), items })
    );
  } catch {
    // ignore storage full
  }
}

function invalidatePersistedMetaCache(uid?: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (uid) {
      localStorage.removeItem(`${META_CACHE_LS_PREFIX}${uid}`);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(META_CACHE_LS_PREFIX)) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponibile su questo browser.'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Errore apertura archivio locale file.'));
  });
}

async function putLocalCache(record: StoredVaultFile): Promise<void> {
  try {
    const idb = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Errore salvataggio cache locale.'));
    });
    idb.close();
  } catch {
    // ignore IndexedDB cache failures if cloud succeeded
  }
}

async function getLocalCache(key: string): Promise<StoredVaultFile | null> {
  try {
    const idb = await openVaultDb();
    const record = await new Promise<StoredVaultFile | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as StoredVaultFile | undefined) || null);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    return record;
  } catch {
    return null;
  }
}

async function deleteLocalCache(key: string): Promise<void> {
  try {
    const idb = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  } catch {
    // ignore
  }
}

export async function getLocalVaultFile(key: string): Promise<StoredVaultFile | null> {
  if (!key) return null;
  return getLocalCache(sanitizeVaultFileKey(key));
}

export async function listLocalCachedVaultKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const idb = await openVaultDb();
    const allKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    for (const k of allKeys) {
      if (typeof k === 'string' && k) keys.add(k);
    }
  } catch {
    // ignore
  }
  return keys;
}

function getAuthenticatedUid(preferredUid?: string): string | null {
  const currentUid = auth.currentUser?.uid || null;
  if (!currentUid) return null;
  if (preferredUid && preferredUid !== currentUid) return null;
  return currentUid;
}

export async function saveVaultFile(
  key: string,
  file: Blob,
  fileName: string,
  mimeType?: string,
  ownerUid?: string,
  options?: VaultOpAuditHint
): Promise<StoredVaultFile> {
  if (file.size <= 0) {
    throw new Error('Il file selezionato è vuoto (0 byte).');
  }

  const cleanKey = sanitizeVaultFileKey(key);
  const initialFileName = (fileName || 'documento.pdf').trim().slice(0, 140) || 'documento.pdf';
  const initialMime = (mimeType || file.type || 'application/octet-stream').trim().slice(0, 80);
  const optimized = await optimizeVaultImageBlob(file, initialFileName, initialMime);
  const safeFileName = optimized.fileName.slice(0, 140);
  const safeMime = optimized.mimeType.slice(0, 80);
  const blobToStore = optimized.blob;
  const nowMs = Date.now();

  if (options?.storageMode === 'local') {
    const localOnlyRecord: StoredVaultFile = {
      key: cleanKey,
      fileName: safeFileName,
      mimeType: safeMime,
      size: blobToStore.size,
      updatedAt: nowMs,
      blob: blobToStore,
      origin: 'local',
      storageBackend: undefined,
      cloudSynced: false,
      cloudTooLarge: false,
      savedLocallyOnly: true,
    };
    await putLocalCache(localOnlyRecord);
    notifyVaultUpdated();
    return localOnlyRecord;
  }

  const uid = getAuthenticatedUid(ownerUid);
  if (!uid) {
    throw new Error('Devi accedere con il tuo account Google per salvare i file in archivio cloud.');
  }

  const storageStatus = await getDedicatedVaultStorageStatus();
  const maxAllowed = storageStatus.configured ? storageStatus.maxFileBytes : MAX_CLOUD_FILE_BYTES;
  if (blobToStore.size > maxAllowed) {
    throw new Error(
      `Il file "${safeFileName}" supera il limite di ${Math.floor(maxAllowed / 1_000_000)} MB.`
    );
  }

  const record: StoredVaultFile = {
    key: cleanKey,
    fileName: safeFileName,
    mimeType: safeMime,
    size: blobToStore.size,
    updatedAt: nowMs,
    blob: blobToStore,
    origin: 'firestore',
    storageBackend: storageStatus.backend,
    cloudSynced: false,
    cloudTooLarge: false,
  };

  if (isFirestoreWritesDisabled()) {
    const estimatedChunks = storageStatus.configured
      ? 1
      : Math.max(1, Math.ceil((blobToStore.size * 1.15) / CHUNK_CHAR_SIZE)) + 1;
    recordFirestoreWritesSaved(estimatedChunks, `Allegato vault (${safeFileName})`);
    const localRecord: StoredVaultFile = {
      ...record,
      origin: 'local',
      cloudSynced: true,
      cloudTooLarge: false,
    };
    await putLocalCache(localRecord);
    enqueueSimulatedVaultUpload({
      fileKey: cleanKey,
      fileName: safeFileName,
      mimeType: safeMime,
      size: blobToStore.size,
      ownerUid: uid,
      groupKey: options?.groupKey,
      groupSection: options?.groupSection,
      groupTitle: options?.groupTitle,
      actionLabel: options?.actionLabel,
      displayTitle: options?.displayTitle,
      changedDetails: options?.changedDetails,
    });
    notifyVaultUpdated();
    return localRecord;
  }

  invalidatePersistedMetaCache(uid);

  if (storageStatus.configured && storageStatus.backend === 's3') {
    const uploadedExternal = await tryUploadVaultBlobExternal(
      record,
      blobToStore,
      cleanKey,
      safeFileName,
      safeMime,
      uid,
      's3'
    );
    if (uploadedExternal) {
      return uploadedExternal;
    }
  }

  return await uploadVaultBlobToFirestore(record, blobToStore, cleanKey, safeFileName, safeMime, uid);
}

async function tryUploadVaultBlobExternal(
  record: StoredVaultFile,
  file: Blob,
  cleanKey: string,
  safeFileName: string,
  safeMime: string,
  uid: string,
  backend: 's3',
  options?: { throwOnError?: boolean }
): Promise<StoredVaultFile | null> {
  const throwOnError = Boolean(options?.throwOnError);
  const endpoint = buildVaultApiUrl('/api/vault/upload');
  if (!endpoint) {
    if (throwOnError) {
      throw new Error(
        'Endpoint backend /api/vault/upload non disponibile. Verifica URL Server Backend in Impostazioni.'
      );
    }
    return null;
  }
  const token = await getFirebaseAuthToken();
  if (!token) {
    if (throwOnError) {
      throw new Error('Token autenticazione Firebase non disponibile: rieffettua il login Google.');
    }
    return null;
  }

  try {
    const dataBase64 = await blobToBase64(file);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileKey: cleanKey,
        fileName: safeFileName,
        mimeType: safeMime,
        dataBase64,
      }),
    });
    if (!resp.ok) {
      let serverMsg = `HTTP ${resp.status}`;
      try {
        const rawText = await resp.text();
        if (rawText) {
          try {
            const errJson = JSON.parse(rawText) as {
              message?: string;
              details?: string;
              errorCode?: string;
            };
            const parts = [
              errJson.message,
              errJson.details && errJson.details !== errJson.message ? errJson.details : '',
              !errJson.message && errJson.errorCode ? errJson.errorCode : '',
            ].filter(Boolean);
            if (parts.length > 0) {
              serverMsg = `HTTP ${resp.status} — ${parts.join(' · ')}`;
            }
          } catch {
            serverMsg = `HTTP ${resp.status} — ${rawText.slice(0, 180)}`;
          }
        }
      } catch {
        // ignore body read error
      }
      if (throwOnError) {
        throw new Error(serverMsg);
      }
      console.warn(`Upload storage esterno (${backend}) fallito:`, serverMsg);
      return null;
    }

    const filesColPath = `users/${uid}/vaultFiles`;
    const chunksColPath = `users/${uid}/vaultFileChunks`;
    const metaRef = doc(db, filesColPath, cleanKey);

    let prevChunkCount = cloudMetaCache.get(cleanKey)?.chunkCount || 0;
    let persistedFileKey = cleanKey;
    try {
      const prevSnap = await getDoc(metaRef);
      if (prevSnap.exists()) {
        const prevData = prevSnap.data();
        const rawCount = Number(prevData?.chunkCount || 0);
        if (Number.isFinite(rawCount)) prevChunkCount = rawCount;
        const existingFk = String(prevData?.fileKey || '').trim();
        if (existingFk) persistedFileKey = existingFk;
      }
    } catch {
      // ignore pre-check errors
    }

    const boundedFileName =
      (safeFileName || `${cleanKey}.pdf`).trim().slice(0, 140) || 'documento.pdf';
    const boundedMime =
      (safeMime || 'application/pdf').trim().slice(0, 80) || 'application/pdf';

    const batch = writeBatch(db);
    batch.set(metaRef, {
      ownerId: uid,
      fileKey: persistedFileKey,
      fileName: boundedFileName,
      mimeType: boundedMime,
      size: file.size,
      chunkCount: 0,
      storageBackend: backend,
      updatedAt: serverTimestamp(),
    });
    for (let idx = 0; idx < Math.min(16, prevChunkCount); idx++) {
      batch.delete(doc(db, chunksColPath, `${cleanKey}_chunk_${idx}`));
    }
    await batch.commit();

    const syncedAtMs = Date.now();
    cloudMetaCache.set(cleanKey, {
      fileKey: persistedFileKey,
      fileName: boundedFileName,
      mimeType: boundedMime,
      size: file.size,
      chunkCount: 0,
      storageBackend: backend,
      updatedAtMs: syncedAtMs,
    });
    invalidatePersistedMetaCache(uid);
    setVaultCloudStatus('ok');

    const syncedRecord: StoredVaultFile = {
      ...record,
      updatedAt: syncedAtMs,
      origin: 'firestore',
      storageBackend: backend,
      cloudSynced: true,
      cloudTooLarge: false,
    };
    await putLocalCache(syncedRecord);
    notifyVaultUpdated();
    return syncedRecord;
  } catch (err) {
    if (throwOnError) {
      if (isPermissionDeniedError(err)) {
        throw new Error(
          'Permessi Firestore insufficienti durante l’aggiornamento di vaultFiles (verifica il deploy di firestore.rules).'
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
    console.warn(`Upload storage esterno (${backend}) non riuscito, uso fallback Firestore:`, err);
    return null;
  }
}

async function uploadVaultBlobToFirestore(
  record: StoredVaultFile,
  file: Blob,
  cleanKey: string,
  safeFileName: string,
  safeMime: string,
  uid: string
): Promise<StoredVaultFile> {
  try {
    const payloadStr = await gzipBlobToPayload(file);
    const chunks: string[] = [];
    for (let i = 0; i < payloadStr.length; i += CHUNK_CHAR_SIZE) {
      chunks.push(payloadStr.slice(i, i + CHUNK_CHAR_SIZE));
    }

    if (chunks.length === 0 || chunks.length > 16) {
      throw new Error('Il file supera la dimensione massima archiviabile su Firestore (6 MB).');
    }

    const filesColPath = `users/${uid}/vaultFiles`;
    const chunksColPath = `users/${uid}/vaultFileChunks`;
    const metaRef = doc(db, filesColPath, cleanKey);

    let prevChunkCount = cloudMetaCache.get(cleanKey)?.chunkCount || 0;
    try {
      const prevSnap = await getDoc(metaRef);
      if (prevSnap.exists()) {
        const rawCount = Number(prevSnap.data()?.chunkCount || 0);
        if (Number.isFinite(rawCount)) prevChunkCount = rawCount;
      }
    } catch {
      // ignore pre-check errors; permission issues will be caught on batch.commit()
    }

    // Write chunks in <= 4-op batches (~2.4 MB base64 max per commit)
    const CHUNKS_PER_BATCH = 4;
    for (let start = 0; start < chunks.length; start += CHUNKS_PER_BATCH) {
      const slice = chunks.slice(start, start + CHUNKS_PER_BATCH);
      const batch = writeBatch(db);
      slice.forEach((chunkData, offset) => {
        const idx = start + offset;
        const chunkId = `${cleanKey}_chunk_${idx}`;
        batch.set(doc(db, chunksColPath, chunkId), {
          ownerId: uid,
          fileKey: cleanKey,
          chunkIndex: idx,
          data: chunkData,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    // Finalize metadata doc + clean any shrinking surplus chunks
    const finalBatch = writeBatch(db);
    finalBatch.set(metaRef, {
      ownerId: uid,
      fileKey: cleanKey,
      fileName: safeFileName,
      mimeType: safeMime,
      size: file.size,
      chunkCount: chunks.length,
      storageBackend: 'firestore',
      updatedAt: serverTimestamp(),
    });
    for (let idx = chunks.length; idx < prevChunkCount; idx++) {
      finalBatch.delete(doc(db, chunksColPath, `${cleanKey}_chunk_${idx}`));
    }
    await finalBatch.commit();

    const syncedAtMs = Date.now();
    cloudMetaCache.set(cleanKey, {
      fileKey: cleanKey,
      fileName: safeFileName,
      mimeType: safeMime,
      size: file.size,
      chunkCount: chunks.length,
      storageBackend: 'firestore',
      updatedAtMs: syncedAtMs,
    });
    invalidatePersistedMetaCache(uid);
    setVaultCloudStatus('ok');

    const syncedRecord: StoredVaultFile = {
      ...record,
      updatedAt: syncedAtMs,
      origin: 'firestore',
      storageBackend: 'firestore',
      cloudSynced: true,
      cloudTooLarge: false,
    };
    await putLocalCache(syncedRecord);
    notifyVaultUpdated();
    return syncedRecord;
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      setVaultCloudStatus('rules-required');
      throw new Error(
        'Permessi Firestore insufficienti per salvare il file. Verifica l’accesso o le regole Firestore.'
      );
    }
    const errRaw = `${(err as { code?: string })?.code || ''} ${
      err instanceof Error ? err.message : String(err)
    }`.toLowerCase();
    if (
      errRaw.includes('resource-exhausted') ||
      (errRaw.includes('quota') && errRaw.includes('exceeded'))
    ) {
      setVaultCloudStatus('error');
      const { notifyFirestoreQuotaExceeded } = await import('../firebase');
      notifyFirestoreQuotaExceeded();
      throw new Error(
        'Quota giornaliera gratuita di scrittura Firestore esaurita: impossibile caricare il file ora. Il limite si azzera automaticamente il giorno successivo.'
      );
    }
    setVaultCloudStatus('error');
    throw err instanceof Error
      ? err
      : new Error('Errore durante il caricamento del file su Firestore.');
  }
}

export async function replayVaultUploadToFirestore(params: {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  ownerUid: string;
}): Promise<void> {
  const cleanKey = sanitizeVaultFileKey(params.fileKey);
  const uid = getAuthenticatedUid(params.ownerUid);
  if (!uid) {
    throw new Error('Autenticazione richiesta per sincronizzare gli allegati.');
  }
  const localRec = await getLocalCache(cleanKey);
  if (!localRec || !localRec.blob || localRec.blob.size <= 0) {
    return;
  }
  const status = await getDedicatedVaultStorageStatus();
  if (status.configured && status.backend === 's3') {
    const ext = await tryUploadVaultBlobExternal(
      localRec,
      localRec.blob,
      cleanKey,
      params.fileName || localRec.fileName,
      params.mimeType || localRec.mimeType,
      uid,
      's3'
    );
    if (ext) return;
  }
  await uploadVaultBlobToFirestore(
    localRec,
    localRec.blob,
    cleanKey,
    params.fileName || localRec.fileName,
    params.mimeType || localRec.mimeType,
    uid
  );
}

async function fetchExternalVaultBlob(
  cleanKey: string,
  expectedMime: string
): Promise<Blob | null> {
  const endpoint = buildVaultApiUrl(`/api/vault/file/${encodeURIComponent(cleanKey)}`);
  const token = await getFirebaseAuthToken();
  if (!endpoint || !token) return null;
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const rawBlob = await resp.blob();
    const mime = expectedMime || rawBlob.type || 'application/octet-stream';
    return rawBlob.type === mime ? rawBlob : new Blob([rawBlob], { type: mime });
  } catch {
    return null;
  }
}

export async function getVaultFile(key: string, ownerUid?: string): Promise<StoredVaultFile | null> {
  if (!key) return null;
  const cleanKey = sanitizeVaultFileKey(key);
  const localRec = await getLocalCache(cleanKey);

  const uid = getAuthenticatedUid(ownerUid);
  if (uid) {
    try {
      let cloudMeta = cloudMetaCache.get(cleanKey);
      if (!cloudMeta) {
        const metaSnap = await getDoc(doc(db, `users/${uid}/vaultFiles`, cleanKey));
        if (metaSnap.exists()) {
          const d = metaSnap.data();
          const rawBackend = String(d.storageBackend || '').trim();
          cloudMeta = {
            fileKey: String(d.fileKey || cleanKey),
            fileName: String(d.fileName || 'documento.pdf'),
            mimeType: String(d.mimeType || 'application/pdf'),
            size: Number(d.size || 0),
            chunkCount: Number(d.chunkCount || 0),
            storageBackend: rawBackend === 's3' ? 's3' : 'firestore',
            updatedAtMs: timestampToMs(d.updatedAt),
          };
          cloudMetaCache.set(cleanKey, cloudMeta);
          setVaultCloudStatus('ok');
        }
      }

      const localIsFresh =
        localRec &&
        cloudMeta &&
        localRec.origin === 'firestore' &&
        localRec.size === cloudMeta.size &&
        localRec.updatedAt >= cloudMeta.updatedAtMs;

      if (cloudMeta && !localIsFresh) {
        const isExternal = cloudMeta.storageBackend === 's3' || cloudMeta.chunkCount === 0;
        if (isExternal) {
          const extBlob = await fetchExternalVaultBlob(cleanKey, cloudMeta.mimeType);
          if (extBlob) {
            const hydrated: StoredVaultFile = {
              key: cleanKey,
              fileName: cloudMeta.fileName,
              mimeType: cloudMeta.mimeType,
              size: extBlob.size || cloudMeta.size,
              updatedAt: cloudMeta.updatedAtMs,
              blob: extBlob,
              origin: 'firestore',
              storageBackend: cloudMeta.storageBackend || 's3',
              cloudSynced: true,
            };
            await putLocalCache(hydrated);
            setVaultCloudStatus('ok');
            return hydrated;
          }
        }

        if (cloudMeta.chunkCount > 0) {
          const indices = Array.from({ length: cloudMeta.chunkCount }, (_, i) => i);
          const chunkSnaps = await Promise.all(
            indices.map((idx) =>
              getDoc(doc(db, `users/${uid}/vaultFileChunks`, `${cleanKey}_chunk_${idx}`))
            )
          );

          const missing = chunkSnaps.some((s) => !s.exists());
          if (!missing) {
            const joinedPayload = chunkSnaps.map((s) => String(s.data()?.data || '')).join('');
            const blob = await payloadToBlob(joinedPayload, cloudMeta.mimeType);
            const hydrated: StoredVaultFile = {
              key: cleanKey,
              fileName: cloudMeta.fileName,
              mimeType: cloudMeta.mimeType,
              size: blob.size || cloudMeta.size,
              updatedAt: cloudMeta.updatedAtMs,
              blob,
              origin: 'firestore',
              storageBackend: 'firestore',
              cloudSynced: true,
            };
            await putLocalCache(hydrated);
            setVaultCloudStatus('ok');
            return hydrated;
          }
        }
      }
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        setVaultCloudStatus('rules-required');
      } else {
        console.warn('Firestore vault download fallback:', err);
      }
    }
  }

  if (localRec) {
    return {
      ...localRec,
      origin: localRec.origin || 'local',
      cloudSynced: localRec.origin === 'firestore',
      savedLocallyOnly: localRec.origin === 'local',
    };
  }

  const bundled = STATIC_BILL_PDF_ASSETS[key] || STATIC_BILL_PDF_ASSETS[cleanKey];
  if (bundled && typeof fetch === 'function') {
    try {
      const res = await fetch(resolveStaticAssetUrl(bundled.relPath));
      if (res.ok) {
        const rawBlob = await res.blob();
        const ct = rawBlob.type || bundled.mimeType;
        const pdfBlob =
          ct && ct !== 'application/octet-stream'
            ? rawBlob
            : new Blob([rawBlob], { type: bundled.mimeType });
        return {
          key: cleanKey,
          fileName: bundled.fileName,
          mimeType: bundled.mimeType,
          size: pdfBlob.size,
          updatedAt: 0,
          blob: pdfBlob,
          origin: 'bundled',
          cloudSynced: true,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function deleteExternalVaultKeys(cleanKeys: string[]): Promise<void> {
  if (cleanKeys.length === 0) return;
  const token = await getFirebaseAuthToken();
  if (!token) return;
  try {
    if (cleanKeys.length === 1) {
      const ep = buildVaultApiUrl(`/api/vault/file/${encodeURIComponent(cleanKeys[0])}`);
      if (ep) {
        await fetch(ep, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      }
      return;
    }
    const batchEp = buildVaultApiUrl('/api/vault/delete-batch');
    if (batchEp) {
      await fetch(batchEp, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keys: cleanKeys }),
      });
    }
  } catch {
    // best-effort external binary cleanup
  }
}

export async function deleteVaultFile(
  key: string,
  ownerUid?: string,
  auditHint?: VaultDeleteAuditHint
): Promise<void> {
  if (!key) return;
  const cleanKey = sanitizeVaultFileKey(key);

  await deleteLocalCache(cleanKey);
  cloudMetaCache.delete(cleanKey);

  if (isFirestoreWritesDisabled()) {
    recordFirestoreWritesSaved(1, `Eliminazione allegato vault (${cleanKey})`);
    const uid = getAuthenticatedUid(ownerUid);
    if (uid) {
      enqueueSimulatedVaultDelete({
        keys: [cleanKey],
        ownerUid: uid,
        groupKey: auditHint?.groupKey,
        groupSection: auditHint?.groupSection,
        groupTitle: auditHint?.groupTitle,
        actionLabel: auditHint?.actionLabel,
        displayTitle: auditHint?.displayTitle,
        changedDetails: auditHint?.changedDetails,
      });
    }
    notifyVaultUpdated();
    return;
  }

  const uid = getAuthenticatedUid(ownerUid);
  if (uid) {
    invalidatePersistedMetaCache(uid);
    await deleteExternalVaultKeys([cleanKey]);
    try {
      const metaRef = doc(db, `users/${uid}/vaultFiles`, cleanKey);
      const metaSnap = await getDoc(metaRef);
      if (metaSnap.exists()) {
        const chunkCount = Math.min(16, Math.max(0, Number(metaSnap.data()?.chunkCount || 0)));
        const batch = writeBatch(db);
        batch.delete(metaRef);
        for (let i = 0; i < chunkCount; i++) {
          batch.delete(doc(db, `users/${uid}/vaultFileChunks`, `${cleanKey}_chunk_${i}`));
        }
        await batch.commit();
      }
      setVaultCloudStatus('ok');
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        setVaultCloudStatus('rules-required');
      } else {
        console.warn('Firestore vault delete warning:', err);
      }
    }
  }

  notifyVaultUpdated();
}

export async function deleteVaultFiles(
  keys: string[],
  ownerUid?: string,
  auditHint?: VaultDeleteAuditHint
): Promise<void> {
  const cleanKeys = Array.from(new Set(keys.map(sanitizeVaultFileKey)));
  if (cleanKeys.length === 0) return;

  const uid = getAuthenticatedUid(ownerUid);
  if (!uid) {
    throw new Error('È necessario autenticarsi per eliminare i PDF archiviati.');
  }

  for (const key of cleanKeys) {
    await deleteLocalCache(key);
    cloudMetaCache.delete(key);
  }
  invalidatePersistedMetaCache(uid);

  if (isFirestoreWritesDisabled()) {
    recordFirestoreWritesSaved(cleanKeys.length * 2, 'Eliminazione allegati vault (test)');
    enqueueSimulatedVaultDelete({
      keys: cleanKeys,
      ownerUid: uid,
      groupKey: auditHint?.groupKey,
      groupSection: auditHint?.groupSection,
      groupTitle: auditHint?.groupTitle,
      actionLabel: auditHint?.actionLabel,
      displayTitle: auditHint?.displayTitle,
      changedDetails: auditHint?.changedDetails,
    });
    notifyVaultUpdated();
    return;
  }

  await deleteExternalVaultKeys(cleanKeys);
  await deleteVaultKeysFromFirestore(cleanKeys, uid);
}

async function deleteVaultKeysFromFirestore(cleanKeys: string[], uid: string): Promise<void> {
  const keysPerBatch = 23;
  try {
    for (let start = 0; start < cleanKeys.length; start += keysPerBatch) {
      const batch = writeBatch(db);
      for (const key of cleanKeys.slice(start, start + keysPerBatch)) {
        batch.delete(doc(db, `users/${uid}/vaultFiles`, key));
        for (let index = 0; index < 16; index++) {
          batch.delete(doc(db, `users/${uid}/vaultFileChunks`, `${key}_chunk_${index}`));
        }
      }
      await batch.commit();
    }
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      setVaultCloudStatus('rules-required');
    } else {
      setVaultCloudStatus('error');
    }
    throw error;
  }

  setVaultCloudStatus('ok');
  notifyVaultUpdated();
}

export async function replayVaultDeleteToFirestore(params: {
  keys: string[];
  ownerUid: string;
}): Promise<void> {
  const cleanKeys = Array.from(new Set(params.keys.map(sanitizeVaultFileKey)));
  if (cleanKeys.length === 0) return;
  const uid = getAuthenticatedUid(params.ownerUid);
  if (!uid) {
    throw new Error('Autenticazione richiesta per sincronizzare le eliminazioni vault.');
  }
  await deleteExternalVaultKeys(cleanKeys);
  await deleteVaultKeysFromFirestore(cleanKeys, uid);
}

export async function listVaultFileMetadata(
  ownerUid?: string,
  options?: { forceRefresh?: boolean }
): Promise<Record<string, VaultFileMeta>> {
  const map: Record<string, VaultFileMeta> = {};
  for (const [key, asset] of Object.entries(STATIC_BILL_PDF_ASSETS)) {
    map[key] = {
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: 0,
      updatedAt: 0,
      origin: 'bundled',
    };
  }

  const localSyncedKeysToCheck: string[] = [];

  try {
    const idb = await openVaultDb();
    const records = await new Promise<StoredVaultFile[]>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredVaultFile[]) || []);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    for (const r of records) {
      if (r.origin === 'firestore') {
        localSyncedKeysToCheck.push(r.key);
      }
      map[r.key] = {
        fileName: r.fileName,
        mimeType: r.mimeType,
        size: r.size,
        updatedAt: r.updatedAt,
        origin: r.origin || 'local',
        storageBackend: r.storageBackend,
      };
    }
  } catch {
    // keep bundled entries even if IndexedDB fails
  }

  const uid = getAuthenticatedUid(ownerUid);
  if (!uid) {
    return map;
  }

  const cachedCloud = !options?.forceRefresh ? readPersistedMetaCache(uid) : null;
  if (cachedCloud) {
    for (const [fileKey, meta] of Object.entries(cachedCloud)) {
      cloudMetaCache.set(fileKey, {
        fileKey,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        size: meta.size,
        chunkCount: meta.chunkCount || 0,
        storageBackend: meta.storageBackend,
        updatedAtMs: meta.updatedAt,
      });
      map[fileKey] = meta;
    }
    return map;
  }

  const existingInFlight = inFlightMetaListByUid.get(uid);
  if (existingInFlight && !options?.forceRefresh) {
    return existingInFlight;
  }

  const fetchPromise = (async () => {
    try {
      const q = query(collection(db, `users/${uid}/vaultFiles`), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      const seenCloudKeys = new Set<string>();
      const cloudOnlyMap: Record<string, VaultFileMeta> = {};
      cloudMetaCache.clear();

      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const fileKey = String(d.fileKey || docSnap.id);
        const fileName = String(d.fileName || 'documento.pdf');
        const mimeType = String(d.mimeType || 'application/pdf');
        const size = Number(d.size || 0);
        const chunkCount = Number(d.chunkCount || 0);
        const rawBackend = String(d.storageBackend || '').trim();
        const storageBackend: DedicatedVaultStorageBackend =
          rawBackend === 's3' ? 's3' : 'firestore';
        const updatedAtMs = timestampToMs(d.updatedAt);

        seenCloudKeys.add(fileKey);
        cloudMetaCache.set(fileKey, {
          fileKey,
          fileName,
          mimeType,
          size,
          chunkCount,
          storageBackend,
          updatedAtMs,
        });

        const entry: VaultFileMeta = {
          fileName,
          mimeType,
          size,
          updatedAt: updatedAtMs,
          origin: 'firestore',
          chunkCount,
          storageBackend,
        };
        cloudOnlyMap[fileKey] = entry;
        map[fileKey] = entry;
      });

      writePersistedMetaCache(uid, cloudOnlyMap);

      // Prune cached cloud files that were deleted from another device
      for (const cachedKey of localSyncedKeysToCheck) {
        if (!seenCloudKeys.has(cachedKey)) {
          await deleteLocalCache(cachedKey);
          if (STATIC_BILL_PDF_ASSETS[cachedKey]) {
            map[cachedKey] = {
              fileName: STATIC_BILL_PDF_ASSETS[cachedKey].fileName,
              mimeType: STATIC_BILL_PDF_ASSETS[cachedKey].mimeType,
              size: 0,
              updatedAt: 0,
              origin: 'bundled',
            };
          } else {
            delete map[cachedKey];
          }
        }
      }

      setVaultCloudStatus('ok');
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        setVaultCloudStatus('rules-required');
      } else {
        console.warn('Firestore vault metadata list warning:', err);
      }
    } finally {
      inFlightMetaListByUid.delete(uid);
    }

    return map;
  })();

  inFlightMetaListByUid.set(uid, fetchPromise);
  return fetchPromise;
}

export async function precacheAllCloudVaultFiles(
  ownerUid?: string,
  onProgress?: (progress: {
    completed: number;
    total: number;
    currentFileName: string;
  }) => void
): Promise<{
  totalCloud: number;
  alreadyCached: number;
  cached: number;
  errors: number;
  quotaHit: boolean;
}> {
  const uid = getAuthenticatedUid(ownerUid);
  const metaMap = await listVaultFileMetadata(uid || undefined, { forceRefresh: true });
  const localKeys = await listLocalCachedVaultKeys();
  const cloudEntries = Object.entries(metaMap).filter(([, meta]) => meta.origin === 'firestore');

  let completed = 0;
  let cached = 0;
  let alreadyCached = 0;
  let errors = 0;
  let quotaHit = false;
  const totalCloud = cloudEntries.length;

  onProgress?.({ completed: 0, total: totalCloud, currentFileName: '' });

  for (const [key, meta] of cloudEntries) {
    if (localKeys.has(key)) {
      alreadyCached++;
      completed++;
      onProgress?.({ completed, total: totalCloud, currentFileName: meta.fileName || key });
      continue;
    }

    const usesFirestoreChunks =
      meta.storageBackend !== 's3' && (meta.chunkCount || 0) > 0;
    if (usesFirestoreChunks && isFirestoreQuotaExceededActive()) {
      quotaHit = true;
      break;
    }

    onProgress?.({ completed, total: totalCloud, currentFileName: meta.fileName || key });
    try {
      const file = await getVaultFile(key, uid || undefined);
      if (file) {
        cached++;
      } else {
        errors++;
        if (usesFirestoreChunks && isFirestoreQuotaExceededActive()) {
          quotaHit = true;
          break;
        }
      }
    } catch {
      errors++;
      if (usesFirestoreChunks && isFirestoreQuotaExceededActive()) {
        quotaHit = true;
        break;
      }
    }
    completed++;
    onProgress?.({ completed, total: totalCloud, currentFileName: meta.fileName || key });
  }

  return { totalCloud, alreadyCached, cached, errors, quotaHit };
}

export async function migrateFirestoreVaultToDedicatedStorage(
  onProgress?: (done: number, total: number) => void
): Promise<{
  migrated: number;
  failed: number;
  remaining: number;
  stoppedEarly: boolean;
  firstError: string | null;
  providerLabel: string;
}> {
  if (isFirestoreWritesDisabled()) {
    throw new Error(
      'Disattiva temporaneamente la Modalità Test Browser in Impostazioni prima di avviare la migrazione su Backblaze B2.'
    );
  }
  const uid = getAuthenticatedUid();
  if (!uid) {
    throw new Error('Autenticazione richiesta per migrare gli allegati.');
  }
  const status = await getDedicatedVaultStorageStatus(true);
  if (!status.configured || status.backend !== 's3') {
    throw new Error('Configura prima Backblaze B2 (variabili S3_ENDPOINT / S3_BUCKET) sul server.');
  }

  const metaMap = await listVaultFileMetadata(uid, { forceRefresh: true });
  const legacyKeys = Object.entries(metaMap)
    .filter(
      ([, meta]) =>
        meta.origin === 'firestore' &&
        (meta.chunkCount || 0) > 0 &&
        meta.storageBackend !== 's3'
    )
    .map(([key]) => key);

  let done = 0;
  let migrated = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let stoppedEarly = false;
  let firstError: string | null = null;
  const total = legacyKeys.length;
  onProgress?.(0, total);

  const isSystemicFailure = (msg: string): boolean => {
    const low = msg.toLowerCase();
    return (
      low.includes('quota') ||
      low.includes('http 401') ||
      low.includes('http 403') ||
      low.includes('http 404') ||
      low.includes('http 502') ||
      low.includes('http 503') ||
      low.includes('permessi firestore') ||
      low.includes('permission-denied') ||
      low.includes('endpoint backend') ||
      low.includes('token firebase') ||
      low.includes('failed to fetch') ||
      low.includes('networkerror')
    );
  };

  for (const rawKey of legacyKeys) {
    const key = sanitizeVaultFileKey(rawKey);
    try {
      if (isFirestoreQuotaExceededActive()) {
        firstError ||=
          'Quota lettura/scrittura Firestore esaurita durante il trasferimento: riprova dopo il reset alle 09:00 IT.';
        stoppedEarly = true;
        break;
      }

      const loaded = await getVaultFile(key, uid);
      if (!loaded || !loaded.blob || loaded.blob.size <= 0) {
        failed++;
        consecutiveFailures++;
        if (isFirestoreQuotaExceededActive()) {
          firstError ||=
            'Quota lettura Firestore esaurita durante la lettura dei chunk da spostare (riprova dopo il reset alle 09:00 IT).';
          stoppedEarly = true;
          break;
        }
        firstError ||= `Impossibile leggere i chunk Firestore o la cache locale per "${key}".`;
      } else if (loaded.blob.size > status.maxFileBytes) {
        failed++;
        consecutiveFailures++;
        firstError ||= `"${loaded.fileName}" supera il limite di ${formatFileSize(status.maxFileBytes)}.`;
      } else {
        const ext = await tryUploadVaultBlobExternal(
          loaded,
          loaded.blob,
          key,
          loaded.fileName,
          loaded.mimeType,
          uid,
          's3',
          { throwOnError: true }
        );
        if (ext) {
          migrated++;
          consecutiveFailures = 0;
        } else {
          failed++;
          consecutiveFailures++;
          firstError ||= `Upload su ${status.providerLabel} non riuscito per "${loaded.fileName}".`;
        }
      }
    } catch (err) {
      failed++;
      consecutiveFailures++;
      const msg = err instanceof Error ? err.message : String(err);
      if (!firstError && msg) firstError = msg;
      if (migrated === 0 && consecutiveFailures >= 2 && isSystemicFailure(msg)) {
        stoppedEarly = true;
        done++;
        onProgress?.(done, total);
        break;
      }
    }
    done++;
    onProgress?.(done, total);
    if (migrated === 0 && consecutiveFailures >= 3 && firstError && isSystemicFailure(firstError)) {
      stoppedEarly = true;
      break;
    }
  }

  invalidatePersistedMetaCache(uid);
  notifyVaultUpdated();
  return {
    migrated,
    failed,
    remaining: Math.max(0, total - migrated),
    stoppedEarly,
    firstError,
    providerLabel: status.providerLabel,
  };
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

// ---------- Bill file key builders ----------

export function getElectricityBillFileKey(invoiceNumber: string): string {
  const slug = invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  return `bill_elec_${slug || 'unknown'}`;
}

export function getWaterBillFileKey(invoiceNumber: string): string {
  const slug = invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  return `bill_water_${slug || 'unknown'}`;
}

export function getTariBillFileKey(noticeNumber: string): string {
  const slug = noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  return `bill_tari_${slug || 'unknown'}`;
}

// ---------- Firestore HomeArticleRecord <-> HomeDocumentRecord ----------

const LINK_MARKER_RE = /\s*\[Link:\s*(https?:\/\/[^\s\]]+)\]\s*/i;

function sanitizeToken(val: string | undefined): string {
  return (val || '').replace(/[|\r\n]/g, ' ').trim();
}

function parseKv(raw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split('|')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function unpackDocNotes(raw?: string): { notes: string; cloudUrl?: string } {
  if (!raw) return { notes: '' };
  const match = raw.match(LINK_MARKER_RE);
  if (!match) return { notes: raw.trim() };
  const cloudUrl = match[1].trim();
  const notes = raw.replace(LINK_MARKER_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  return { notes, cloudUrl };
}

function packDocNotes(notes?: string, cloudUrl?: string): string | undefined {
  const cleanNotes = (notes || '').replace(LINK_MARKER_RE, ' ').trim();
  const cleanUrl = (cloudUrl || '').trim();
  if (!cleanNotes && !cleanUrl) return undefined;
  if (!cleanUrl) return cleanNotes.slice(0, 240);
  const marker = `[Link: ${cleanUrl}]`;
  if (marker.length >= 240) return cleanNotes ? cleanNotes.slice(0, 240) : undefined;
  if (!cleanNotes) return marker;
  const maxNotes = 240 - marker.length - 1;
  if (maxNotes <= 6) return marker;
  return `${cleanNotes.slice(0, maxNotes)} ${marker}`;
}

export function articleToHomeDocument(article: HomeArticleRecord): HomeDocumentRecord {
  const kv = parseKv(article.specs);
  const unpacked = unpackDocNotes(article.notes);
  const unpackedExtract = unpackDocNotes(article.manualExtractText);
  const category = DOCUMENT_CATEGORIES.includes(article.brand as HomeDocumentCategory)
    ? (article.brand as HomeDocumentCategory)
    : 'Altro';
  const sizeNum = kv.SZ ? Number(kv.SZ) : undefined;

  return {
    id: article.id,
    title: article.name,
    category,
    provider: article.model || 'Casa',
    referenceCode: article.serialNumber || undefined,
    issueDate: article.purchaseDate || undefined,
    expiryDate: article.warrantyEnd || undefined,
    cloudUrl: unpacked.cloudUrl || unpackedExtract.cloudUrl,
    fileName: kv.FILE || undefined,
    fileMime: kv.MIME || undefined,
    fileSize: sizeNum !== undefined && Number.isFinite(sizeNum) ? sizeNum : undefined,
    attachmentKey: kv.KEY || `doc_${article.id}`,
    pinned: Boolean(article.familyWarranty),
    notes: unpacked.notes || undefined,
  };
}

export function homeDocumentToArticlePayload(
  docItem: Omit<HomeDocumentRecord, 'id'>
): Omit<HomeArticleRecord, 'id'> {
  const parts: string[] = [];
  if (docItem.fileName) parts.push(`FILE:${sanitizeToken(docItem.fileName).slice(0, 80)}`);
  if (docItem.fileMime) parts.push(`MIME:${sanitizeToken(docItem.fileMime).slice(0, 48)}`);
  if (typeof docItem.fileSize === 'number' && Number.isFinite(docItem.fileSize) && docItem.fileSize > 0) {
    parts.push(`SZ:${Math.round(docItem.fileSize)}`);
  }
  if (docItem.attachmentKey) {
    parts.push(`KEY:${sanitizeToken(docItem.attachmentKey).slice(0, 64)}`);
  }

  const cleanUrl = (docItem.cloudUrl || '').trim();
  const cleanNotes = (docItem.notes || '').replace(LINK_MARKER_RE, ' ').trim();
  const packedNotes = packDocNotes(cleanNotes, cleanUrl);
  const urlFitsInNotes = !cleanUrl || `[Link: ${cleanUrl}]`.length < 240;

  return {
    name: docItem.title.trim().slice(0, 80),
    brand: (docItem.category || 'Altro').slice(0, 60),
    model: (docItem.provider || 'Casa').trim().slice(0, 80),
    category: 'altro',
    room: SYSTEM_ROOM_DOCUMENTS,
    familyWarranty: Boolean(docItem.pinned),
    purchaseDate: docItem.issueDate ? docItem.issueDate.trim().slice(0, 20) : undefined,
    warrantyEnd: docItem.expiryDate ? docItem.expiryDate.trim().slice(0, 20) : undefined,
    serialNumber: docItem.referenceCode ? docItem.referenceCode.trim().slice(0, 80) : undefined,
    specs: parts.length > 0 ? parts.join('|').slice(0, 240) : undefined,
    notes: urlFitsInNotes ? packedNotes : cleanNotes.slice(0, 240) || undefined,
    manualExtractText: !urlFitsInNotes && cleanUrl ? `[Link: ${cleanUrl.slice(0, 1950)}]` : undefined,
  };
}

const PRODUCT_MATCH_STOPWORDS = new Set([
  'con', 'per', 'del', 'della', 'dei', 'degli', 'il', 'lo', 'la', 'i', 'gli', 'le',
  'di', 'da', 'in', 'su', 'ed', 'e', 'o', 'a', 'uno', 'una', 'un', 'divano',
  'poltrona', 'sedia', 'tavolo', 'prodotto', 'scheda', 'tecnica', 'manuale',
  'istruzioni', 'montaggio', 'manutenzione', 'documento', 'allegato', 'file',
  'pdf', 'htm', 'html', 'http', 'https', 'www', 'com', 'it', 'outdoor', 'esterno',
  'casa', 'colore', 'nero', 'bianco', 'grigio', 'beige', 'tortora', 'antracite',
]);

function normalizeMatchTokens(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isProductUserManualAttachment(
  docType?: ArticleAttachmentType,
  title?: string,
  urlOrNotes?: string
): boolean {
  if (docType !== 'manuale') return false;
  const hay = `${title || ''} ${urlOrNotes || ''}`.toLowerCase();
  if (!hay.trim()) return true;
  if (
    /(?:etichett[ae]?\s*energetic|energy\s*label|\beprel\b|dichiarazion[ei]?\s*(?:di\s*)?conformit|\bbim\b|\b3d\b|\bcad\b|\bdwg\b|\bdxf\b|\brfa\b|\bifc\b|\bstep\b)/.test(
      hay
    )
  ) {
    return false;
  }
  const hasExplicitManualKeyword =
    /(?:manual|istruzion|user\s*guide|libretto|uso\s+e\s+manutenzione|guida\s+(?:rapida|utente|all['’]?uso)|montagg)/.test(
      hay
    );
  const isDatasheetOnly =
    /(?:scheda\s*(?:prodotto|tecnica|informativa)|datasheet|data\s*sheet|brochure|volantino|product\s*fiche|\bfiche\b)/.test(
      hay
    );
  if (isDatasheetOnly && !hasExplicitManualKeyword) {
    return false;
  }
  return true;
}

export function resolveProductOfficialDocAttachmentType(doc: {
  title?: string;
  url?: string;
  kind?: string;
}): ArticleAttachmentType {
  const hay = `${doc.title || ''} ${doc.url || ''}`.toLowerCase();
  if (/(?:scontrin|fattur|ricevut|invoice|receipt|ordine)/.test(hay)) {
    return 'scontrino_fattura';
  }
  if (/(?:garanzi[ae]|warranty|estension[ei]|polizz|assicuraz)/.test(hay)) {
    return 'garanzia_extra_family';
  }
  if (
    /(?:etichett[ae]?\s*energetic|energy\s*label|\beprel\b|dichiarazion[ei]?\s*(?:di\s*)?conformit|\bbim\b|\b3d\b|\bcad\b|\bdwg\b|\bdxf\b|\brfa\b|\bifc\b|\bstep\b)/.test(
      hay
    ) ||
    doc.kind === 'bim_3d'
  ) {
    return 'altro';
  }
  if (/(?:targhett|\bpnc\b|seriale|matricola)/.test(hay)) {
    return 'targhetta_pnc';
  }
  if (doc.kind === 'certificato') {
    return 'altro';
  }
  return 'manuale';
}

export function inferArticleAttachmentType(hints: string): ArticleAttachmentType {
  const h = hints.toLowerCase();
  if (/scontrin|fattur|ricevut|invoice|receipt|ordine|acquisto/.test(h)) {
    return 'scontrino_fattura';
  }
  if (/garanzi[ae]?\s*(?:extra|estesa|convenzionale)|warranty\s*extension|estensione\s*garanzia|polizza|assicuraz/.test(h)) {
    return 'garanzia_extra_family';
  }
  if (/(?:etichett[ae]?\s*energetic|energy\s*label|\beprel\b|dichiarazion[ei]?\s*(?:di\s*)?conformit|\bbim\b|\b3d\b)/.test(h)) {
    return 'altro';
  }
  if (/targhett|\bpnc\b|seriale|matricola/.test(h)) {
    return 'targhetta_pnc';
  }
  if (/manual|istruzion|montagg|manutenz|libretto|scheda|datasheet|brochure|specif/.test(h)) {
    return 'manuale';
  }
  return 'altro';
}

export function matchResearchProductForDocument(
  hints: {
    fileName?: string;
    title?: string;
    provider?: string;
    cloudUrl?: string;
    textContent?: string;
    notes?: string;
  },
  researches: ProductResearchRecord[]
): ProductResearchRecord | null {
  if (!researches || researches.length === 0) return null;

  const strongChannel = normalizeMatchTokens(
    `${hints.fileName || ''} ${hints.title || ''} ${hints.provider || ''} ${hints.cloudUrl || ''}`
  );
  const bodyChannel = normalizeMatchTokens(
    `${hints.notes || ''} ${(hints.textContent || '').slice(0, 8000)}`
  );
  const docUrlClean = (hints.cloudUrl || '').split('#')[0].split('?')[0].toLowerCase();

  let best: ProductResearchRecord | null = null;
  let bestScore = 0;

  for (const item of researches) {
    if (!item.id || !item.title) continue;
    let score = 0;

    const prodUrlClean = (item.url || '').split('#')[0].split('?')[0].toLowerCase();
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
          // ignore URL parse errors
        }
      }
    }

    const brandNorm = normalizeMatchTokens(item.brand || '');
    const modelNorm = normalizeMatchTokens(item.model || '');
    const titleTokens = normalizeMatchTokens(item.title)
      .split(' ')
      .filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !PRODUCT_MATCH_STOPWORDS.has(t));
    const modelTokens = modelNorm
      .split(' ')
      .filter((t) => (t.length >= 2 || /^\d+$/.test(t)) && !PRODUCT_MATCH_STOPWORDS.has(t));
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
      best = item;
    }
  }

  return bestScore >= 55 ? best : null;
}

// ---------- Download & Share payload builders (Documents + Bills) ----------

export interface ShareableItemPayload {
  title: string;
  subtitle: string;
  shareText: string;
  htmlDocument: string;
  fallbackFileName: string;
  attachmentKey?: string;
  cloudUrl?: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPrintableHtml(
  title: string,
  badge: string,
  rows: { label: string; value: string }[],
  notes?: string
): string {
  const rowsHtml = rows
    .filter((r) => r.value && r.value.trim() !== '')
    .map(
      (r) =>
        `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 32px; line-height: 1.5; }
  .badge { display: inline-block; background: #e0f2fe; color: #0369a1; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; }
  h1 { font-size: 20px; margin: 8px 0 4px; }
  .sub { font-size: 12px; color: #475569; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th { text-align: left; width: 34%; padding: 8px 10px; background: #f8fafc; border: 1px solid #cbd5e1; color: #334155; }
  td { padding: 8px 10px; border: 1px solid #cbd5e1; }
  .notes { margin-top: 16px; padding: 12px; background: #f8fafc; border-left: 3px solid #0284c7; font-size: 13px; }
  .footer { margin-top: 24px; font-size: 11px; color: #64748b; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <span class="badge">${escapeHtml(badge)}</span>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">Documento generato dall&apos;archivio casa · ${new Date().toLocaleDateString('it-IT')}</div>
  <table>${rowsHtml}</table>
  ${notes ? `<div class="notes"><strong>Note &amp; Dettagli:</strong><br/>${escapeHtml(notes)}</div>` : ''}
  <div class="footer">Usa Stampa → Salva come PDF per ottenere il PDF pronto per l&apos;invio.</div>
</body>
</html>`;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadShareableItem(item: ShareableItemPayload): Promise<'attached' | 'generated'> {
  if (item.attachmentKey) {
    const stored = await getVaultFile(item.attachmentKey);
    if (stored) {
      triggerBlobDownload(stored.blob, stored.fileName);
      return 'attached';
    }
  }
  const blob = new Blob([item.htmlDocument], { type: 'text/html;charset=utf-8' });
  triggerBlobDownload(blob, item.fallbackFileName);
  return 'generated';
}

export async function openVaultFileInNewTab(
  attachmentKey?: string,
  cloudUrl?: string,
  fallbackName?: string
): Promise<boolean> {
  if (attachmentKey) {
    const stored = await getVaultFile(attachmentKey);
    if (stored) {
      const targetName = (stored.fileName || fallbackName || '').toLowerCase();
      const normalizedMime =
        targetName.endsWith('.pdf') || stored.mimeType === 'application/pdf'
          ? 'application/pdf'
          : stored.mimeType || stored.blob.type || 'application/octet-stream';
      const typedBlob =
        stored.blob.type === normalizedMime
          ? stored.blob
          : new Blob([stored.blob], { type: normalizedMime });
      const blobUrl = URL.createObjectURL(typedBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.target = '_blank';
      a.rel = 'noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return true;
    }
  }
  if (cloudUrl && /^https?:\/\//i.test(cloudUrl.trim())) {
    const a = document.createElement('a');
    a.href = cloudUrl.trim();
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  }
  return false;
}

export function buildDocumentSharePayload(docItem: HomeDocumentRecord): ShareableItemPayload {
  const lines = [
    `📄 *${docItem.title}*`,
    `Categoria: ${docItem.category}`,
    `Ente / Fornitore: ${docItem.provider}`,
    docItem.referenceCode ? `Codice / Riferimento: ${docItem.referenceCode}` : '',
    docItem.issueDate ? `Data: ${docItem.issueDate}` : '',
    docItem.expiryDate ? `Scadenza / Rinnovo: ${docItem.expiryDate}` : '',
    docItem.notes ? `Note: ${docItem.notes}` : '',
    docItem.cloudUrl ? `Link documento: ${docItem.cloudUrl}` : '',
  ].filter(Boolean);

  const slug = docItem.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48) || 'documento';

  return {
    title: docItem.title,
    subtitle: `${docItem.category} · ${docItem.provider}`,
    shareText: lines.join('\n'),
    htmlDocument: renderPrintableHtml(
      docItem.title,
      docItem.category,
      [
        { label: 'Ente / Fornitore', value: docItem.provider },
        { label: 'Codice / Pratica / Riferimento', value: docItem.referenceCode || '' },
        { label: 'Data documento / stipula', value: docItem.issueDate || '' },
        { label: 'Scadenza / Rinnovo', value: docItem.expiryDate || '' },
        { label: 'Link Cloud / Drive', value: docItem.cloudUrl || '' },
        { label: 'File allegato', value: docItem.fileName || 'Scheda digitale' },
      ],
      docItem.notes
    ),
    fallbackFileName: `documento-${slug}.html`,
    attachmentKey: docItem.attachmentKey,
    cloudUrl: docItem.cloudUrl,
  };
}

export function buildElectricityBillSharePayload(bill: BillRecord): ShareableItemPayload {
  const key = getElectricityBillFileKey(bill.invoiceNumber);
  const lines = [
    `⚡ *Bolletta Luce — ${bill.supplier}*`,
    `Periodo: ${bill.period} (Anno ${bill.year})`,
    `N° Fattura: ${bill.invoiceNumber} · Data emissione: ${bill.issueDate}`,
    `Offerta: ${bill.offerName}`,
    `Consumo fatturato: ${bill.kwh} kWh`,
    `Solo Luce: ${bill.electricityOnly.toFixed(2).replace('.', ',')} € | Canone TV: ${bill.canoneTv.toFixed(2).replace('.', ',')} €`,
    `Totale pagato: ${bill.totalPaid.toFixed(2).replace('.', ',')} €`,
    bill.note ? `Note: ${bill.note}` : '',
  ].filter(Boolean);

  const slug = bill.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    title: `Bolletta Luce ${bill.period} (${bill.supplier})`,
    subtitle: `Fattura #${bill.invoiceNumber} · ${bill.totalPaid.toFixed(2).replace('.', ',')} €`,
    shareText: lines.join('\n'),
    htmlDocument: renderPrintableHtml(
      `Bolletta Luce — ${bill.supplier} (${bill.period})`,
      'Bolletta Elettrica',
      [
        { label: 'Fornitore', value: bill.supplier },
        { label: 'Offerta', value: bill.offerName },
        { label: 'N° Fattura', value: bill.invoiceNumber },
        { label: 'Data emissione', value: bill.issueDate },
        { label: 'Periodo di competenza', value: bill.period },
        { label: 'Consumo fatturato', value: `${bill.kwh} kWh` },
        { label: 'Indice PUN / Prezzo', value: bill.punText },
        { label: 'Importo Solo Luce', value: `${bill.electricityOnly.toFixed(2).replace('.', ',')} €` },
        { label: 'Canone TV', value: `${bill.canoneTv.toFixed(2).replace('.', ',')} €` },
        { label: 'Totale Pagato', value: `${bill.totalPaid.toFixed(2).replace('.', ',')} €` },
      ],
      bill.note
    ),
    fallbackFileName: `bolletta-luce-${slug}.html`,
    attachmentKey: key,
  };
}

export function isOctopusContractRecord(
  bill: Pick<BillRecord, 'supplier' | 'year' | 'invoiceNumber' | 'period' | 'note'>
): boolean {
  if (!bill.supplier.toLowerCase().includes('octopus')) return false;
  const descriptor = `${bill.invoiceNumber} ${bill.period} ${bill.note || ''}`.toLowerCase();
  return bill.year < 2027 || descriptor.includes('contratt') || descriptor.includes('contract');
}

export function buildWaterBillSharePayload(bill: WaterBillRecord): ShareableItemPayload {
  const key = getWaterBillFileKey(bill.invoiceNumber);
  const lines = [
    `💧 *Bolletta Acqua — AcegasApsAmga*`,
    `Periodo: ${bill.period} (Anno ${bill.year})`,
    `N° Fattura: ${bill.invoiceNumber} · Data: ${bill.issueDate}`,
    `Consumo: ${bill.cubicMeters.toFixed(1).replace('.', ',')} m³`,
    `Quota Fissa: ${bill.fixedCostEur.toFixed(2).replace('.', ',')} €`,
    `Totale pagato: ${bill.totalPaid.toFixed(2).replace('.', ',')} €`,
    bill.note ? `Note: ${bill.note}` : '',
  ].filter(Boolean);

  const slug = bill.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    title: `Bolletta Acqua ${bill.period}`,
    subtitle: `Fattura #${bill.invoiceNumber} · ${bill.totalPaid.toFixed(2).replace('.', ',')} €`,
    shareText: lines.join('\n'),
    htmlDocument: renderPrintableHtml(
      `Bolletta Acqua — ${bill.period}`,
      'Bolletta Idrica',
      [
        { label: 'Gestore', value: 'AcegasApsAmga' },
        { label: 'N° Fattura', value: bill.invoiceNumber },
        { label: 'Data emissione', value: bill.issueDate },
        { label: 'Periodo', value: bill.period },
        { label: 'Consumo fatturato', value: `${bill.cubicMeters.toFixed(1).replace('.', ',')} m³` },
        { label: 'Quota fissa', value: `${bill.fixedCostEur.toFixed(2).replace('.', ',')} €` },
        { label: 'Totale Pagato', value: `${bill.totalPaid.toFixed(2).replace('.', ',')} €` },
      ],
      bill.note
    ),
    fallbackFileName: `bolletta-acqua-${slug}.html`,
    attachmentKey: key,
  };
}

export function buildTariBillSharePayload(bill: TariBillRecord): ShareableItemPayload {
  const key = getTariBillFileKey(bill.noticeNumber);
  const lines = [
    `🗑️ *Avviso TARI — ${bill.supplier}*`,
    `Periodo: ${bill.period} (Anno ${bill.year})`,
    `N° Avviso: ${bill.noticeNumber}`,
    `Emissione: ${bill.issueDate} · Scadenza: ${bill.dueDate}`,
    `Stato: ${bill.paid ? 'Pagato' : 'Da pagare'}`,
    `Importo: ${bill.totalPaid.toFixed(2).replace('.', ',')} €`,
    bill.note ? `Note: ${bill.note}` : '',
  ].filter(Boolean);

  const slug = bill.noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    title: `Avviso TARI ${bill.period}`,
    subtitle: `Avviso #${bill.noticeNumber} · ${bill.totalPaid.toFixed(2).replace('.', ',')} €`,
    shareText: lines.join('\n'),
    htmlDocument: renderPrintableHtml(
      `Avviso TARI — ${bill.period}`,
      'Tassa Rifiuti TARI',
      [
        { label: 'Ente / Fornitore', value: bill.supplier },
        { label: 'N° Avviso', value: bill.noticeNumber },
        { label: 'Data emissione', value: bill.issueDate },
        { label: 'Scadenza', value: bill.dueDate },
        { label: 'Stato pagamento', value: bill.paid ? 'Pagato' : 'Da pagare' },
        { label: 'Importo Totale', value: `${bill.totalPaid.toFixed(2).replace('.', ',')} €` },
      ],
      bill.note
    ),
    fallbackFileName: `avviso-tari-${slug}.html`,
    attachmentKey: key,
  };
}
