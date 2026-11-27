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
  directWriteBatch,
  enqueueSimulatedVaultDelete,
  enqueueSimulatedVaultUpload,
  guardedWriteBatch as writeBatch,
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

// ---------- Binary vault: Firestore cross-device chunked storage + IndexedDB cache ----------

const IDB_NAME = 'myhome_vault_files_v1';
const IDB_STORE = 'files';
const IDB_VERSION = 1;

export type VaultOrigin = 'firestore' | 'local' | 'bundled';

export interface StoredVaultFile {
  key: string;
  fileName: string;
  mimeType: string;
  size: number;
  updatedAt: number;
  blob: Blob;
  origin?: VaultOrigin;
  cloudSynced?: boolean;
  cloudTooLarge?: boolean;
}

export interface VaultFileMeta {
  fileName: string;
  mimeType: string;
  size: number;
  updatedAt: number;
  origin: VaultOrigin;
  chunkCount?: number;
}

interface CloudVaultDocMeta {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  updatedAtMs: number;
}

const cloudMetaCache = new Map<string, CloudVaultDocMeta>();
let syncedVaultMetaUid: string | null = null;
let inFlightVaultMetaSync: Promise<void> | null = null;
let inFlightVaultMetaUid: string | null = null;

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
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return Date.now();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  const sliceSize = 0x8000;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const sub = bytes.subarray(i, Math.min(i + sliceSize, bytes.length));
    parts.push(String.fromCharCode(...sub));
  }
  return btoa(parts.join(''));
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
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
    // ignore IndexedDB cache failures if Firestore succeeded
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

function getAuthenticatedUid(preferredUid?: string): string | null {
  const currentUid = auth.currentUser?.uid || null;
  if (!currentUid) return null;
  if (preferredUid && preferredUid !== currentUid) return null;
  return currentUid;
}

export interface VaultSimulatedHint {
  groupKey?: string;
  groupSection?: string;
  groupTitle?: string;
  actionLabel?: string;
  displayTitle?: string;
  changedDetails?: string[];
}

export async function saveVaultFile(
  key: string,
  file: Blob,
  fileName: string,
  mimeType?: string,
  ownerUid?: string,
  simHint?: VaultSimulatedHint
): Promise<StoredVaultFile> {
  if (file.size <= 0) {
    throw new Error('Il file selezionato è vuoto (0 byte).');
  }

  const cleanKey = sanitizeVaultFileKey(key);
  const safeFileName = (fileName || 'documento.pdf').trim().slice(0, 140) || 'documento.pdf';
  const safeMime = (mimeType || file.type || 'application/octet-stream').trim().slice(0, 80);
  const nowMs = Date.now();

  const uid = getAuthenticatedUid(ownerUid);
  if (!uid) {
    throw new Error('Devi accedere con il tuo account Google per salvare i file su Firestore.');
  }

  if (file.size > MAX_CLOUD_FILE_BYTES) {
    throw new Error(
      `Il file "${safeFileName}" supera il limite di ${Math.floor(
        MAX_CLOUD_FILE_BYTES / 1_000_000
      )} MB supportato su Firestore.`
    );
  }

  const record: StoredVaultFile = {
    key: cleanKey,
    fileName: safeFileName,
    mimeType: safeMime,
    size: file.size,
    updatedAt: nowMs,
    blob: file,
    origin: 'firestore',
    cloudSynced: false,
    cloudTooLarge: false,
  };

  if (isFirestoreWritesDisabled()) {
    const estimatedChunks = Math.max(1, Math.ceil((file.size * 1.35) / CHUNK_CHAR_SIZE));
    recordFirestoreWritesSaved(estimatedChunks + 1, `Allegato (${safeFileName})`);
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
      size: file.size,
      ownerUid: uid,
      ...simHint,
    });
    notifyVaultUpdated();
    return localRecord;
  }

  return await uploadVaultBlobToFirestore(record, file, cleanKey, safeFileName, safeMime, uid);
}

async function uploadVaultBlobToFirestore(
  record: StoredVaultFile,
  file: Blob,
  cleanKey: string,
  safeFileName: string,
  safeMime: string,
  uid: string,
  useDirectBatch = false
): Promise<StoredVaultFile> {
  try {
    const base64 = await blobToBase64(file);
    const chunks: string[] = [];
    for (let i = 0; i < base64.length; i += CHUNK_CHAR_SIZE) {
      chunks.push(base64.slice(i, i + CHUNK_CHAR_SIZE));
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
    const batchFactory = useDirectBatch ? directWriteBatch : writeBatch;
    const CHUNKS_PER_BATCH = 4;
    for (let start = 0; start < chunks.length; start += CHUNKS_PER_BATCH) {
      const slice = chunks.slice(start, start + CHUNKS_PER_BATCH);
      const batch = batchFactory(db);
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
    const finalBatch = batchFactory(db);
    finalBatch.set(metaRef, {
      ownerId: uid,
      fileKey: cleanKey,
      fileName: safeFileName,
      mimeType: safeMime,
      size: file.size,
      chunkCount: chunks.length,
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
      updatedAtMs: syncedAtMs,
    });
    setVaultCloudStatus('ok');

    const syncedRecord: StoredVaultFile = {
      ...record,
      updatedAt: syncedAtMs,
      origin: 'firestore',
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
    throw new Error('Autenticazione richiesta per sincronizzare gli allegati su Firestore.');
  }
  const localRec = await getLocalCache(cleanKey);
  if (!localRec || !localRec.blob || localRec.blob.size <= 0) {
    // Already deleted locally before flush
    return;
  }
  await uploadVaultBlobToFirestore(
    localRec,
    localRec.blob,
    cleanKey,
    params.fileName || localRec.fileName,
    params.mimeType || localRec.mimeType,
    uid,
    true
  );
}

export async function getVaultFile(key: string, ownerUid?: string): Promise<StoredVaultFile | null> {
  if (!key) return null;
  const cleanKey = sanitizeVaultFileKey(key);
  const localRec = await getLocalCache(cleanKey);

  const uid = getAuthenticatedUid(ownerUid);
  if (uid) {
    try {
      let cloudMeta = cloudMetaCache.get(cleanKey);
      // Batch-sync cloud metadata once per session instead of firing N separate getDoc calls on view mounts
      if (!cloudMeta && syncedVaultMetaUid !== uid) {
        await listVaultFileMetadata(uid);
        cloudMeta = cloudMetaCache.get(cleanKey);
      }
      if (!cloudMeta && syncedVaultMetaUid !== uid) {
        const metaSnap = await getDoc(doc(db, `users/${uid}/vaultFiles`, cleanKey));
        if (metaSnap.exists()) {
          const d = metaSnap.data();
          cloudMeta = {
            fileKey: String(d.fileKey || cleanKey),
            fileName: String(d.fileName || 'documento.pdf'),
            mimeType: String(d.mimeType || 'application/pdf'),
            size: Number(d.size || 0),
            chunkCount: Number(d.chunkCount || 0),
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

      if (cloudMeta && cloudMeta.chunkCount > 0 && !localIsFresh) {
        const indices = Array.from({ length: cloudMeta.chunkCount }, (_, i) => i);
        const chunkSnaps = await Promise.all(
          indices.map((idx) =>
            getDoc(doc(db, `users/${uid}/vaultFileChunks`, `${cleanKey}_chunk_${idx}`))
          )
        );

        const missing = chunkSnaps.some((s) => !s.exists());
        if (!missing) {
          const joinedBase64 = chunkSnaps.map((s) => String(s.data()?.data || '')).join('');
          const blob = base64ToBlob(joinedBase64, cloudMeta.mimeType);
          const hydrated: StoredVaultFile = {
            key: cleanKey,
            fileName: cloudMeta.fileName,
            mimeType: cloudMeta.mimeType,
            size: blob.size || cloudMeta.size,
            updatedAt: cloudMeta.updatedAtMs,
            blob,
            origin: 'firestore',
            cloudSynced: true,
          };
          await putLocalCache(hydrated);
          setVaultCloudStatus('ok');
          return hydrated;
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

export async function deleteVaultFile(
  key: string,
  ownerUid?: string,
  simHint?: VaultSimulatedHint
): Promise<void> {
  if (!key) return;
  const cleanKey = sanitizeVaultFileKey(key);

  await deleteLocalCache(cleanKey);
  cloudMetaCache.delete(cleanKey);

  if (isFirestoreWritesDisabled()) {
    recordFirestoreWritesSaved(1, `Rimozione allegato (${simHint?.displayTitle || cleanKey})`);
    const uid = getAuthenticatedUid(ownerUid);
    if (uid) {
      enqueueSimulatedVaultDelete({
        keys: [cleanKey],
        ownerUid: uid,
        ...simHint,
      });
    }
    notifyVaultUpdated();
    return;
  }

  const uid = getAuthenticatedUid(ownerUid);
  if (uid) {
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
  simHint?: VaultSimulatedHint
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

  if (isFirestoreWritesDisabled()) {
    recordFirestoreWritesSaved(
      cleanKeys.length * 2,
      `Rimozione allegati (${simHint?.displayTitle || cleanKeys.length})`
    );
    enqueueSimulatedVaultDelete({
      keys: cleanKeys,
      ownerUid: uid,
      ...simHint,
    });
    notifyVaultUpdated();
    return;
  }

  await deleteVaultKeysFromFirestore(cleanKeys, uid);
}

async function deleteVaultKeysFromFirestore(
  cleanKeys: string[],
  uid: string,
  useDirectBatch = false
): Promise<void> {
  const keysPerBatch = 23;
  const batchFactory = useDirectBatch ? directWriteBatch : writeBatch;
  try {
    for (let start = 0; start < cleanKeys.length; start += keysPerBatch) {
      const batch = batchFactory(db);
      for (const key of cleanKeys.slice(start, start + keysPerBatch)) {
        batch.delete(doc(db, `users/${uid}/vaultFiles`, key));
        for (let index = 0; index < 16; index++) {
          batch.delete(
            doc(db, `users/${uid}/vaultFileChunks`, `${key}_chunk_${index}`)
          );
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
  await deleteVaultKeysFromFirestore(cleanKeys, uid, true);
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
      };
    }
  } catch {
    // keep bundled entries even if IndexedDB fails
  }

  const uid = getAuthenticatedUid(ownerUid);
  if (!uid) {
    syncedVaultMetaUid = null;
    cloudMetaCache.clear();
    return map;
  }

  const forceRefresh = Boolean(options?.forceRefresh);
  const needsCloudSync = forceRefresh || syncedVaultMetaUid !== uid;

  if (needsCloudSync) {
    if (inFlightVaultMetaSync && inFlightVaultMetaUid === uid) {
      await inFlightVaultMetaSync;
    } else {
      inFlightVaultMetaUid = uid;
      inFlightVaultMetaSync = (async () => {
        try {
          const q = query(
            collection(db, `users/${uid}/vaultFiles`),
            where('ownerId', '==', uid)
          );
          const snap = await getDocs(q);
          const seenCloudKeys = new Set<string>();
          cloudMetaCache.clear();

          snap.forEach((docSnap) => {
            const d = docSnap.data();
            const fileKey = String(d.fileKey || docSnap.id);
            const fileName = String(d.fileName || 'documento.pdf');
            const mimeType = String(d.mimeType || 'application/pdf');
            const size = Number(d.size || 0);
            const chunkCount = Number(d.chunkCount || 0);
            const updatedAtMs = timestampToMs(d.updatedAt);

            seenCloudKeys.add(fileKey);
            cloudMetaCache.set(fileKey, {
              fileKey,
              fileName,
              mimeType,
              size,
              chunkCount,
              updatedAtMs,
            });
          });

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

          syncedVaultMetaUid = uid;
          setVaultCloudStatus('ok');
        } catch (err) {
          if (isPermissionDeniedError(err)) {
            setVaultCloudStatus('rules-required');
          } else {
            console.warn('Firestore vault metadata list warning:', err);
          }
        } finally {
          inFlightVaultMetaSync = null;
          inFlightVaultMetaUid = null;
        }
      })();
      await inFlightVaultMetaSync;
    }
  }

  for (const [fileKey, cloudMeta] of cloudMetaCache.entries()) {
    map[fileKey] = {
      fileName: cloudMeta.fileName,
      mimeType: cloudMeta.mimeType,
      size: cloudMeta.size,
      updatedAt: cloudMeta.updatedAtMs,
      origin: 'firestore',
      chunkCount: cloudMeta.chunkCount,
    };
  }

  return map;
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

export function inferArticleAttachmentType(hints: string): ArticleAttachmentType {
  const h = hints.toLowerCase();
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
