import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  db,
  getLegacyMigrationFirebase,
  LEGACY_OWNER_UID,
} from '../firebase';

export const SYSTEM_ROOM_MIGRATION_META = '__migrazione__';
export const MIGRATION_DONE_DOC_ID = 'db_migration_gen_lang_done';

export interface MigrationSummary {
  legacyUid: string;
  targetUid: string;
  counts: Record<string, number>;
  totalDocs: number;
  githubExtraReadings: number;
  githubExtraBills: number;
}

const COLLECTIONS_TO_MIGRATE: {
  name: string;
  label: string;
  timestampField: 'createdAt' | 'updatedAt';
  batchSize: number;
}[] = [
  { name: 'homeConfig', label: 'Configurazione casa', timestampField: 'updatedAt', batchSize: 50 },
  { name: 'energyReadings', label: 'Letture consumi', timestampField: 'createdAt', batchSize: 300 },
  { name: 'climateLogs', label: 'Log clima', timestampField: 'createdAt', batchSize: 300 },
  { name: 'electricityBills', label: 'Bollette luce', timestampField: 'createdAt', batchSize: 200 },
  { name: 'waterBills', label: 'Bollette acqua', timestampField: 'createdAt', batchSize: 200 },
  { name: 'tariBills', label: 'Avvisi TARI', timestampField: 'createdAt', batchSize: 200 },
  { name: 'gsePayments', label: 'Pagamenti GSE', timestampField: 'createdAt', batchSize: 200 },
  { name: 'homeArticles', label: 'Articoli, Spesa, Auto e Documenti', timestampField: 'createdAt', batchSize: 250 },
  { name: 'vaultFiles', label: 'Metadati PDF Vault', timestampField: 'updatedAt', batchSize: 100 },
  { name: 'vaultFileChunks', label: 'File PDF originali (chunk)', timestampField: 'createdAt', batchSize: 3 },
];

export async function migrateFromLegacyProject(
  targetUid: string,
  onProgress?: (statusText: string) => void
): Promise<MigrationSummary> {
  if (!targetUid) {
    throw new Error('Devi prima accedere con Google sul nuovo progetto.');
  }

  onProgress?.('Connessione al vecchio database Firebase (spiritual-bearing-sq7xb)...');
  const { legacyAuth, legacyDb } = getLegacyMigrationFirebase();

  let legacyUser = legacyAuth.currentUser;
  if (!legacyUser) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(legacyAuth, provider);
    legacyUser = cred.user;
  }

  const legacyUid = legacyUser?.uid || LEGACY_OWNER_UID;
  const counts: Record<string, number> = {};
  const migratedDates = new Set<string>();
  const migratedElecInvoices = new Set<string>();
  const migratedTariNotices = new Set<string>();
  let totalDocs = 0;

  for (const colCfg of COLLECTIONS_TO_MIGRATE) {
    onProgress?.(`Lettura ${colCfg.label}...`);
    const srcColRef = collection(legacyDb, `users/${legacyUid}/${colCfg.name}`);
    const snap = await getDocs(srcColRef);
    const docs = snap.docs.filter((d) => d.id !== MIGRATION_DONE_DOC_ID);
    counts[colCfg.name] = docs.length;

    if (docs.length === 0) continue;

    const dstPath = `users/${targetUid}/${colCfg.name}`;
    for (let i = 0; i < docs.length; i += colCfg.batchSize) {
      const slice = docs.slice(i, i + colCfg.batchSize);
      const batch = writeBatch(db);
      for (const srcDoc of slice) {
        const raw = srcDoc.data();
        const payload: Record<string, unknown> = {
          ...raw,
          ownerId: targetUid,
          [colCfg.timestampField]: serverTimestamp(),
        };
        if (colCfg.name === 'energyReadings' && typeof raw.date === 'string') {
          migratedDates.add(raw.date);
        }
        if (colCfg.name === 'electricityBills' && typeof raw.invoiceNumber === 'string') {
          migratedElecInvoices.add(raw.invoiceNumber);
        }
        if (colCfg.name === 'tariBills' && typeof raw.noticeNumber === 'string') {
          migratedTariNotices.add(raw.noticeNumber);
        }
        batch.set(doc(db, dstPath, srcDoc.id), payload);
      }
      await batch.commit();
      totalDocs += slice.length;
      onProgress?.(
        `Migrazione ${colCfg.label}: ${Math.min(i + slice.length, docs.length)}/${docs.length}...`
      );
    }
  }

  // Extra safety net: merge any newer items stored only on GitHub branch `data`
  let githubExtraReadings = 0;
  let githubExtraBills = 0;
  try {
    onProgress?.('Controllo eventuali aggiornamenti recenti dal branch GitHub data...');
    const [consumiRes, bolletteRes] = await Promise.all([
      fetch(`https://raw.githubusercontent.com/mauriziominieri/my-home/data/data/consumi.json?v=${Date.now()}`).catch(() => null),
      fetch(`https://raw.githubusercontent.com/mauriziominieri/my-home/data/data/bollette.json?v=${Date.now()}`).catch(() => null),
    ]);

    if (consumiRes && consumiRes.ok) {
      const json = (await consumiRes.json()) as {
        readings?: Array<{
          date: string;
          f1Kwh: number;
          f2Kwh: number;
          f3Kwh: number;
          totalKwh: number;
          peakKw: number;
        }>;
      };
      const missing = (json.readings || []).filter(
        (r) => typeof r?.date === 'string' && !migratedDates.has(r.date)
      );
      for (let i = 0; i < missing.length; i += 350) {
        const chunk = missing.slice(i, i + 350);
        const batch = writeBatch(db);
        for (const r of chunk) {
          const total = Math.round(Number(r.totalKwh || 0) * 100) / 100;
          batch.set(doc(db, `users/${targetUid}/energyReadings`, `day_${r.date.replace(/-/g, '')}`), {
            ownerId: targetUid,
            date: r.date.slice(0, 10),
            f1Kwh: Math.round(Number(r.f1Kwh || 0) * 100) / 100,
            f2Kwh: Math.round(Number(r.f2Kwh || 0) * 100) / 100,
            f3Kwh: Math.round(Number(r.f3Kwh || 0) * 100) / 100,
            totalKwh: total,
            peakKw: Math.round(Number(r.peakKw || 0) * 100) / 100,
            estimatedCostEur: Math.round(total * 0.1595 * 100) / 100,
            source: 'e-distribuzione-api',
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
        githubExtraReadings += chunk.length;
      }
    }

    if (bolletteRes && bolletteRes.ok) {
      const json = (await bolletteRes.json()) as {
        electricityBills?: Array<Record<string, unknown>>;
        tariBills?: Array<Record<string, unknown>>;
      };
      const missingElec = (json.electricityBills || []).filter(
        (b) => typeof b?.invoiceNumber === 'string' && !migratedElecInvoices.has(b.invoiceNumber)
      );
      if (missingElec.length > 0) {
        const batch = writeBatch(db);
        for (const b of missingElec) {
          const inv = String(b.invoiceNumber);
          const docId = `edison_${inv.replace(/[^a-zA-Z0-9_-]/g, '')}`;
          batch.set(doc(db, `users/${targetUid}/electricityBills`, docId), {
            ...b,
            ownerId: targetUid,
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
        githubExtraBills += missingElec.length;
      }

      const missingTari = (json.tariBills || []).filter(
        (t) => typeof t?.noticeNumber === 'string' && !migratedTariNotices.has(t.noticeNumber)
      );
      if (missingTari.length > 0) {
        const batch = writeBatch(db);
        for (const t of missingTari) {
          const notice = String(t.noticeNumber);
          const docId = `tari_${notice.replace(/[^a-zA-Z0-9_-]/g, '')}`;
          batch.set(doc(db, `users/${targetUid}/tariBills`, docId), {
            ...t,
            ownerId: targetUid,
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
        githubExtraBills += missingTari.length;
      }
    }
  } catch {
    // ignore if branch data is not present
  }

  onProgress?.('Finalizzazione puntatore proprietario su Firestore...');
  await setDoc(doc(db, 'appMeta', 'owner'), {
    ownerUid: targetUid,
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(db, `users/${targetUid}/homeArticles`, MIGRATION_DONE_DOC_ID), {
    ownerId: targetUid,
    name: 'Migrazione Database Completata',
    brand: 'firebase',
    model: 'gen-lang-client-0721850501',
    category: 'altro',
    room: SYSTEM_ROOM_MIGRATION_META,
    familyWarranty: false,
    notes: `Migrati ${totalDocs} documenti da ${legacyUid} (${new Date().toISOString().slice(0, 10)})`,
    createdAt: serverTimestamp(),
  });

  return {
    legacyUid,
    targetUid,
    counts,
    totalDocs,
    githubExtraReadings,
    githubExtraBills,
  };
}
