import {
  collection,
  doc,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  directWriteBatch,
  isFirestoreWritesDisabled,
  trackedGetDocs,
} from '../firebase';
import {
  APP_SETTINGS_DOC_ID,
  buildAppSettingsFirestorePayload,
  getAppSettings,
  SYSTEM_ROOM_APP_SETTINGS,
} from './appSettings';
import { resolveApiUrl } from './apiBase';
import {
  CAR_POLICY_ID,
  CAR_PROFILE_ID,
  parseArticleDocumentRef,
  parseResearchDocumentRef,
  SYSTEM_ROOM_CAR,
  SYSTEM_ROOM_GROCERY,
  SYSTEM_ROOM_GROCERY_META,
} from './carGroceryStore';
import {
  CLIMATE_AUTOPILOT_DOC_ID,
  SYSTEM_ROOM_CLIMATE_AUTO,
} from './climateAutopilot';
import {
  notifyVaultUpdated,
  SYSTEM_ROOM_DOCUMENTS,
} from './documentVault';
import {
  MIGRATION_DONE_DOC_ID,
  SYSTEM_ROOM_MIGRATION_META,
} from './legacyMigration';
import {
  REMINDERS_CONFIG_DOC_ID,
  SYSTEM_ROOM_REMINDERS,
} from './remindersStore';
import { SYSTEM_ROOM_TELEMETRY } from './telemetrySync';
import { SYSTEM_ROOM_VINTED } from './vintedStore';

const ACTIVE_HOME_ARTICLES_SYSTEM_ROOMS = new Set<string>([
  SYSTEM_ROOM_CAR,
  SYSTEM_ROOM_GROCERY,
  SYSTEM_ROOM_GROCERY_META,
  SYSTEM_ROOM_DOCUMENTS,
  SYSTEM_ROOM_VINTED,
  SYSTEM_ROOM_REMINDERS,
  SYSTEM_ROOM_CLIMATE_AUTO,
  SYSTEM_ROOM_TELEMETRY,
  SYSTEM_ROOM_APP_SETTINGS,
  SYSTEM_ROOM_MIGRATION_META,
]);

const ACTIVE_HOME_ARTICLES_SPECIAL_IDS = new Set<string>([
  'grocery_seed_v1_done',
  CAR_PROFILE_ID,
  CAR_POLICY_ID,
  REMINDERS_CONFIG_DOC_ID,
  CLIMATE_AUTOPILOT_DOC_ID,
  APP_SETTINGS_DOC_ID,
  MIGRATION_DONE_DOC_ID,
]);

export type CleanupCandidateCategory =
  | 'legacy_article'
  | 'legacy_article_doc'
  | 'orphan_research_doc'
  | 'orphan_vault_chunk'
  | 'legacy_vault_file';

export interface CleanupCandidateItem {
  key: string;
  category: CleanupCandidateCategory;
  collectionName: 'homeArticles' | 'vaultFiles' | 'vaultFileChunks';
  docId: string;
  title: string;
  subtitle: string;
  storageBackend?: string;
}

export interface FirestoreCleanupAuditReport {
  scannedAt: number;
  totalScannedDocs: number;
  activeSummary: {
    products: number;
    documents: number;
    grocery: number;
    car: number;
    reminders: number;
    vinted: number;
    vaultFiles: number;
    vaultChunks: number;
  };
  candidates: CleanupCandidateItem[];
  legacyAppSettingsFieldPresent: boolean;
}

export interface FirestoreCleanupExecutionResult {
  deletedDocs: number;
  updatedSettingsDoc: boolean;
  deletedExternalS3Keys: number;
}

function isProtectedSystemArticle(id: string, room: string): boolean {
  if (ACTIVE_HOME_ARTICLES_SYSTEM_ROOMS.has(room)) return true;
  if (room.startsWith('__')) return true;
  if (ACTIVE_HOME_ARTICLES_SPECIAL_IDS.has(id)) return true;
  if (
    id.startsWith('car_') ||
    id.startsWith('rem_') ||
    id.startsWith('spesa_') ||
    id.startsWith('vinted_') ||
    id.startsWith('telemetry_')
  ) {
    return true;
  }
  return false;
}

export async function auditFirestoreCleanup(): Promise<FirestoreCleanupAuditReport> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Devi accedere con il tuo account Google proprietario per analizzare il DB.');
  }
  const uid = user.uid;

  const [
    articlesSnap,
    researchesSnap,
    elecSnap,
    waterSnap,
    tariSnap,
    gseSnap,
    vaultFilesSnap,
    vaultChunksSnap,
  ] = await Promise.all([
    trackedGetDocs(query(collection(db, `users/${uid}/homeArticles`), where('ownerId', '==', uid))),
    trackedGetDocs(query(collection(db, `users/${uid}/productResearches`), where('ownerId', '==', uid))),
    trackedGetDocs(query(collection(db, `users/${uid}/electricityBills`), where('ownerId', '==', uid))),
    trackedGetDocs(query(collection(db, `users/${uid}/waterBills`), where('ownerId', '==', uid))),
    trackedGetDocs(query(collection(db, `users/${uid}/tariBills`), where('ownerId', '==', uid))),
    trackedGetDocs(query(collection(db, `users/${uid}/gsePayments`), where('ownerId', '==', uid))),
    trackedGetDocs(query(collection(db, `users/${uid}/vaultFiles`), where('ownerId', '==', uid))),
    trackedGetDocs(query(collection(db, `users/${uid}/vaultFileChunks`), where('ownerId', '==', uid))),
  ]);

  const activeResearchIds = new Set<string>();
  researchesSnap.forEach((d) => {
    activeResearchIds.add(d.id);
  });

  const activeReferencedVaultKeys = new Set<string>();
  elecSnap.forEach((d) => {
    const k = String(d.data()?.pdfFileKey || '').trim();
    if (k) activeReferencedVaultKeys.add(k);
  });
  waterSnap.forEach((d) => {
    const k = String(d.data()?.pdfFileKey || '').trim();
    if (k) activeReferencedVaultKeys.add(k);
  });
  tariSnap.forEach((d) => {
    const k = String(d.data()?.pdfFileKey || '').trim();
    if (k) activeReferencedVaultKeys.add(k);
  });
  gseSnap.forEach((d) => {
    const k = String(d.data()?.attachmentFileKey || '').trim();
    if (k) activeReferencedVaultKeys.add(k);
  });

  const candidates: CleanupCandidateItem[] = [];
  const removableVaultKeys = new Set<string>();
  let legacyAppSettingsFieldPresent = false;

  const summary = {
    products: activeResearchIds.size,
    documents: 0,
    grocery: 0,
    car: 0,
    reminders: 0,
    vinted: 0,
    vaultFiles: vaultFilesSnap.size,
    vaultChunks: vaultChunksSnap.size,
  };

  articlesSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const id = docSnap.id;
    const room = String(data.room || '').trim();
    const name = String(data.name || id).trim();
    const brand = String(data.brand || '').trim();
    const model = String(data.model || '').trim();
    const serialNumber = String(data.serialNumber || '').trim();
    const manualFileKey = String(data.manualFileKey || '').trim();

    if (id === APP_SETTINGS_DOC_ID && typeof data.specs === 'string') {
      try {
        const parsed = JSON.parse(data.specs) as Record<string, unknown>;
        if ('firestoreWritesDisabled' in parsed) {
          legacyAppSettingsFieldPresent = true;
        }
      } catch {
        // ignore invalid json
      }
    }

    if (!isProtectedSystemArticle(id, room)) {
      candidates.push({
        key: `homeArticles:${id}`,
        category: 'legacy_article',
        collectionName: 'homeArticles',
        docId: id,
        title: [brand, name].filter(Boolean).join(' · ') || id,
        subtitle: `Vecchio Articolo (stanza: ${room || 'non indicata'}${model ? ` · mod. ${model}` : ''})`,
      });
      if (manualFileKey) removableVaultKeys.add(manualFileKey);
      return;
    }

    if (room === SYSTEM_ROOM_DOCUMENTS) {
      const artRef = parseArticleDocumentRef(serialNumber);
      if (artRef || id.startsWith('artdoc_')) {
        candidates.push({
          key: `homeArticles:${id}`,
          category: 'legacy_article_doc',
          collectionName: 'homeArticles',
          docId: id,
          title: name || id,
          subtitle: `Allegato collegato alla vecchia pagina Articoli (${id})`,
        });
        if (manualFileKey) removableVaultKeys.add(manualFileKey);
        return;
      }

      const resRef = parseResearchDocumentRef(serialNumber);
      if (resRef && !activeResearchIds.has(resRef.researchId)) {
        candidates.push({
          key: `homeArticles:${id}`,
          category: 'orphan_research_doc',
          collectionName: 'homeArticles',
          docId: id,
          title: name || id,
          subtitle: `Allegato orfano di prodotto eliminato (${resRef.researchId})`,
        });
        if (manualFileKey) removableVaultKeys.add(manualFileKey);
        return;
      }

      summary.documents += 1;
    } else if (room === SYSTEM_ROOM_GROCERY) {
      summary.grocery += 1;
    } else if (room === SYSTEM_ROOM_CAR) {
      summary.car += 1;
    } else if (room === SYSTEM_ROOM_REMINDERS && id !== REMINDERS_CONFIG_DOC_ID) {
      summary.reminders += 1;
    } else if (room === SYSTEM_ROOM_VINTED) {
      summary.vinted += 1;
    }

    if (manualFileKey) {
      activeReferencedVaultKeys.add(manualFileKey);
    }
  });

  const vaultFileByKey = new Map<
    string,
    { id: string; fileName: string; storageBackend: string; chunkCount: number }
  >();
  vaultFilesSnap.forEach((d) => {
    const data = d.data() || {};
    const fileKey = String(data.fileKey || d.id).trim();
    const info = {
      id: d.id,
      fileName: String(data.fileName || fileKey),
      storageBackend: String(data.storageBackend || 'firestore'),
      chunkCount: Number(data.chunkCount || 0),
    };
    vaultFileByKey.set(fileKey, info);

    if (removableVaultKeys.has(fileKey) && !activeReferencedVaultKeys.has(fileKey)) {
      candidates.push({
        key: `vaultFiles:${d.id}`,
        category: 'legacy_vault_file',
        collectionName: 'vaultFiles',
        docId: d.id,
        title: info.fileName,
        subtitle: `File allegato di vecchio Articolo / documento rimosso (${fileKey})`,
        storageBackend: info.storageBackend,
      });
    }
  });

  const scheduledDeletedVaultFileIds = new Set(
    candidates.filter((c) => c.collectionName === 'vaultFiles').map((c) => c.docId)
  );

  vaultChunksSnap.forEach((d) => {
    const data = d.data() || {};
    const fileKey = String(data.fileKey || '').trim();
    const parent = fileKey ? vaultFileByKey.get(fileKey) : undefined;
    const isOrphan = !parent;
    const isLeftoverFromS3Migration =
      Boolean(parent) && parent?.storageBackend === 's3' && (parent?.chunkCount || 0) === 0;
    const parentScheduledForDelete =
      Boolean(parent) && scheduledDeletedVaultFileIds.has(parent!.id);

    if (isOrphan || isLeftoverFromS3Migration || parentScheduledForDelete) {
      candidates.push({
        key: `vaultFileChunks:${d.id}`,
        category: 'orphan_vault_chunk',
        collectionName: 'vaultFileChunks',
        docId: d.id,
        title: d.id,
        subtitle: isLeftoverFromS3Migration
          ? `Chunk Firestore residuo di file già su Backblaze B2 (${fileKey})`
          : parentScheduledForDelete
            ? `Chunk di file obsoleto selezionato (${fileKey})`
            : `Chunk orfano senza file padre (${fileKey || d.id})`,
      });
    }
  });

  return {
    scannedAt: Date.now(),
    totalScannedDocs:
      articlesSnap.size +
      researchesSnap.size +
      elecSnap.size +
      waterSnap.size +
      tariSnap.size +
      gseSnap.size +
      vaultFilesSnap.size +
      vaultChunksSnap.size,
    activeSummary: summary,
    candidates,
    legacyAppSettingsFieldPresent,
  };
}

export async function executeFirestoreCleanup(
  itemsToDelete: CleanupCandidateItem[],
  options?: { cleanLegacyAppSettingsField?: boolean }
): Promise<FirestoreCleanupExecutionResult> {
  if (isFirestoreWritesDisabled()) {
    throw new Error(
      'Disattiva temporaneamente la Modalità Test Browser (in cima a questa pagina) per poter applicare la pulizia su Firestore.'
    );
  }
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Autenticazione Google proprietario richiesta per pulire il DB.');
  }
  const uid = user.uid;

  const s3KeysToDelete = itemsToDelete
    .filter((i) => i.collectionName === 'vaultFiles' && i.storageBackend === 's3')
    .map((i) => i.docId);

  let deletedExternalS3Keys = 0;
  if (s3KeysToDelete.length > 0) {
    const deleteEndpoint = resolveApiUrl('/api/vault/delete-batch');
    if (deleteEndpoint) {
      try {
        const token = await user.getIdToken();
        const resp = await fetch(deleteEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ keys: s3KeysToDelete }),
        });
        if (resp.ok) {
          const json = (await resp.json()) as { deletedCount?: number };
          deletedExternalS3Keys = Number(json.deletedCount || 0);
        }
      } catch {
        // best-effort S3 cleanup
      }
    }
  }

  let deletedDocs = 0;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < itemsToDelete.length; i += CHUNK_SIZE) {
    const slice = itemsToDelete.slice(i, i + CHUNK_SIZE);
    const batch = directWriteBatch(db);
    for (const item of slice) {
      batch.delete(doc(db, `users/${uid}/${item.collectionName}`, item.docId));
      deletedDocs += 1;
    }
    await batch.commit();
  }

  let updatedSettingsDoc = false;
  if (options?.cleanLegacyAppSettingsField) {
    const batch = directWriteBatch(db);
    batch.set(
      doc(db, `users/${uid}/homeArticles`, APP_SETTINGS_DOC_ID),
      buildAppSettingsFirestorePayload(uid, getAppSettings(), serverTimestamp())
    );
    await batch.commit();
    updatedSettingsDoc = true;
  }

  if (itemsToDelete.some((i) => i.collectionName === 'vaultFiles')) {
    notifyVaultUpdated();
  }

  return {
    deletedDocs,
    updatedSettingsDoc,
    deletedExternalS3Keys,
  };
}
