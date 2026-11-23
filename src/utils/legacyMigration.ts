import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  getLegacyMigrationFirebase,
  LEGACY_OWNER_UID,
} from '../firebase';

export const SYSTEM_ROOM_MIGRATION_META = '__migrazione__';
export const MIGRATION_DONE_DOC_ID = 'db_migration_gen_lang_done';

const OWNER_EMAIL = 'mauminieri@gmail.com';

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
  batchSize: number;
}[] = [
  { name: 'homeConfig', label: 'Configurazione casa', batchSize: 50 },
  { name: 'energyReadings', label: 'Letture consumi', batchSize: 300 },
  { name: 'climateLogs', label: 'Log clima', batchSize: 300 },
  { name: 'electricityBills', label: 'Bollette luce', batchSize: 200 },
  { name: 'waterBills', label: 'Bollette acqua', batchSize: 200 },
  { name: 'tariBills', label: 'Avvisi TARI', batchSize: 200 },
  { name: 'gsePayments', label: 'Pagamenti GSE', batchSize: 200 },
  { name: 'homeArticles', label: 'Articoli, Spesa, Auto e Documenti', batchSize: 250 },
  { name: 'vaultFiles', label: 'Metadati PDF Vault', batchSize: 100 },
  { name: 'vaultFileChunks', label: 'File PDF originali (chunk)', batchSize: 3 },
];

function sanitizeDocId(rawId: string): string {
  const cleaned = (rawId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || 'doc_migrated';
}

function clampNum(val: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function nonEmptyStr(val: unknown, maxLen: number, fallback: string): string {
  const s = typeof val === 'string' ? val.trim() : '';
  return (s || fallback).slice(0, maxLen);
}

function optionalStr(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  const s = val.trim();
  return s ? s.slice(0, maxLen) : undefined;
}

function sanitizeHomeConfig(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> {
  const aristonModes = ['riscaldamento', 'raffrescamento', 'acs_solo', 'spento'];
  const aristonProfiles = ['eco', 'comfort', 'boost'];
  const fanSpeeds = ['auto', 'bassa', 'media', 'alta'];
  return {
    ownerId: targetUid,
    aristonMode: aristonModes.includes(String(raw.aristonMode)) ? String(raw.aristonMode) : 'spento',
    aristonProfile: aristonProfiles.includes(String(raw.aristonProfile)) ? String(raw.aristonProfile) : 'eco',
    floorFlowTemp: clampNum(raw.floorFlowTemp, 12, 55, 35),
    dhwTargetTemp: clampNum(raw.dhwTargetTemp, 35, 65, 48),
    zoneLivingTarget: clampNum(raw.zoneLivingTarget, 15, 30, 21),
    zoneBedroomTarget: clampNum(raw.zoneBedroomTarget, 15, 30, 20),
    neasmartPower: Boolean(raw.neasmartPower ?? true),
    neasmartTargetHumidity: clampNum(raw.neasmartTargetHumidity, 35, 75, 55),
    neasmartFanSpeed: fanSpeeds.includes(String(raw.neasmartFanSpeed)) ? String(raw.neasmartFanSpeed) : 'auto',
    dewPointProtection: Boolean(raw.dewPointProtection ?? true),
    tariffEurPerKwh: clampNum(raw.tariffEurPerKwh, 0.05, 2.0, 0.1595),
    podCode: nonEmptyStr(raw.podCode, 32, 'IT001E11251419'),
    updatedAt: serverTimestamp(),
  };
}

function sanitizeEnergyReading(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> | null {
  const dateStr = typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : '';
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) return null;
  const sources = ['e-distribuzione-csv', 'e-distribuzione-api', 'manuale'];
  const src = sources.includes(String(raw.source)) ? String(raw.source) : 'e-distribuzione-api';
  const payload: Record<string, unknown> = {
    ownerId: targetUid,
    date: dateStr,
    f1Kwh: clampNum(raw.f1Kwh, 0, 500, 0),
    f2Kwh: clampNum(raw.f2Kwh, 0, 500, 0),
    f3Kwh: clampNum(raw.f3Kwh, 0, 500, 0),
    totalKwh: clampNum(raw.totalKwh, 0, 1500, 0),
    peakKw: clampNum(raw.peakKw, 0, 50, 0),
    estimatedCostEur: clampNum(raw.estimatedCostEur, 0, 1000, 0),
    source: src,
    createdAt: serverTimestamp(),
  };
  const notes = optionalStr(raw.notes, 240);
  if (notes) payload.notes = notes;
  return payload;
}

function sanitizeClimateLog(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> | null {
  const dateStr = typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : '';
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) return null;
  const rooms = Array.isArray(raw.rooms)
    ? raw.rooms.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).slice(0, 6)
    : [];
  if (rooms.length === 0) return null;
  const mode = String(raw.mode) === 'raffrescamento' ? 'raffrescamento' : 'riscaldamento';
  const rawTemp = Number(raw.targetTemp);
  const targetTemp = rawTemp === 0 ? 0 : clampNum(rawTemp, 14, 30, 21);
  const payload: Record<string, unknown> = {
    ownerId: targetUid,
    date: dateStr,
    mode,
    startTime: nonEmptyStr(raw.startTime, 10, '09:00'),
    endTime: nonEmptyStr(raw.endTime, 10, '20:00'),
    targetTemp,
    rooms,
    createdAt: serverTimestamp(),
  };
  const notes = optionalStr(raw.notes, 240);
  if (notes) payload.notes = notes;
  return payload;
}

function sanitizeElectricityBill(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> | null {
  const inv = nonEmptyStr(raw.invoiceNumber, 40, '');
  if (!inv) return null;
  let issueDate = nonEmptyStr(raw.issueDate, 20, '2025-01-01');
  if (issueDate.length < 8) issueDate = issueDate.padEnd(8, '0');
  let sortKey = typeof raw.sortKey === 'string' ? raw.sortKey.trim().slice(0, 7) : '';
  if (!/^[0-9]{4}-[0-9]{2}$/.test(sortKey)) {
    const yr = clampNum(raw.year, 2020, 2100, 2025);
    sortKey = `${yr}-01`;
  }
  const payload: Record<string, unknown> = {
    ownerId: targetUid,
    invoiceNumber: inv,
    issueDate,
    sortKey,
    year: Math.round(clampNum(raw.year, 2020, 2100, Number(sortKey.slice(0, 4)) || 2025)),
    period: nonEmptyStr(raw.period, 80, sortKey),
    supplier: nonEmptyStr(raw.supplier, 80, 'Edison Energia'),
    offerName: nonEmptyStr(raw.offerName, 100, 'Fornitura Luce'),
    kwh: clampNum(raw.kwh, 0, 100000, 0),
    punText: typeof raw.punText === 'string' ? raw.punText.trim().slice(0, 60) : '—',
    variableCostPerKwh: clampNum(raw.variableCostPerKwh, 0, 10, 0),
    canoneTv: clampNum(raw.canoneTv, 0, 500, 0),
    electricityOnly: clampNum(raw.electricityOnly, 0, 50000, 0),
    totalPaid: clampNum(raw.totalPaid, 0, 50000, 0),
    createdAt: serverTimestamp(),
  };
  const note = optionalStr(raw.note, 240);
  if (note) payload.note = note;
  return payload;
}

function sanitizeWaterBill(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> | null {
  const inv = nonEmptyStr(raw.invoiceNumber, 40, '');
  if (!inv) return null;
  let issueDate = nonEmptyStr(raw.issueDate, 20, '2025-01-01');
  if (issueDate.length < 8) issueDate = issueDate.padEnd(8, '0');
  const payload: Record<string, unknown> = {
    ownerId: targetUid,
    invoiceNumber: inv,
    issueDate,
    year: Math.round(clampNum(raw.year, 2020, 2100, 2025)),
    period: nonEmptyStr(raw.period, 80, 'Periodo'),
    cubicMeters: clampNum(raw.cubicMeters, 0, 10000, 0),
    fixedCostEur: clampNum(raw.fixedCostEur, 0, 5000, 0),
    totalPaid: clampNum(raw.totalPaid, 0, 50000, 0),
    createdAt: serverTimestamp(),
  };
  const note = optionalStr(raw.note, 240);
  if (note) payload.note = note;
  return payload;
}

function sanitizeTariBill(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> | null {
  const notice = nonEmptyStr(raw.noticeNumber, 50, '');
  if (!notice) return null;
  const source = String(raw.source) === 'gmail-pdf' ? 'gmail-pdf' : 'manuale';
  const payload: Record<string, unknown> = {
    ownerId: targetUid,
    noticeNumber: notice,
    issueDate: nonEmptyStr(raw.issueDate, 20, '—'),
    dueDate: nonEmptyStr(raw.dueDate, 20, '—'),
    year: Math.round(clampNum(raw.year, 2020, 2100, 2025)),
    period: nonEmptyStr(raw.period, 80, 'TARI'),
    supplier: nonEmptyStr(raw.supplier, 80, 'AcegasApsAmga (TARI)'),
    totalPaid: clampNum(raw.totalPaid, 0, 50000, 0),
    paid: Boolean(raw.paid),
    source,
    createdAt: serverTimestamp(),
  };
  const note = optionalStr(raw.note, 240);
  if (note) payload.note = note;
  return payload;
}

function sanitizeGsePayment(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> {
  const types = ['acconto', 'conguaglio', 'altro'];
  const paymentType = types.includes(String(raw.paymentType)) ? String(raw.paymentType) : 'acconto';
  const payload: Record<string, unknown> = {
    ownerId: targetUid,
    paymentDate: nonEmptyStr(raw.paymentDate, 20, '—'),
    year: Math.round(clampNum(raw.year, 2020, 2100, 2025)),
    paymentType,
    period: nonEmptyStr(raw.period, 80, 'GSE'),
    amountEur: clampNum(raw.amountEur, 0, 50000, 0),
    createdAt: serverTimestamp(),
  };
  if (typeof raw.kwhInjected === 'number' && Number.isFinite(raw.kwhInjected)) {
    payload.kwhInjected = clampNum(raw.kwhInjected, 0, 100000, 0);
  }
  const reference = optionalStr(raw.reference, 80);
  if (reference) payload.reference = reference;
  const note = optionalStr(raw.note, 240);
  if (note) payload.note = note;
  return payload;
}

function sanitizeHomeArticle(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> {
  const categories = ['elettrodomestici', 'elettronica', 'sicurezza', 'fotovoltaico', 'clima', 'altro'];
  const category = categories.includes(String(raw.category)) ? String(raw.category) : 'altro';
  const payload: Record<string, unknown> = {
    ownerId: targetUid,
    name: nonEmptyStr(raw.name, 80, 'Articolo'),
    brand: nonEmptyStr(raw.brand, 60, '—'),
    model: nonEmptyStr(raw.model, 80, '—'),
    category,
    room: nonEmptyStr(raw.room, 60, 'Casa'),
    familyWarranty: Boolean(raw.familyWarranty),
    createdAt: serverTimestamp(),
  };
  const purchaseDate = optionalStr(raw.purchaseDate, 20);
  if (purchaseDate) payload.purchaseDate = purchaseDate;
  const warrantyEnd = optionalStr(raw.warrantyEnd, 20);
  if (warrantyEnd) payload.warrantyEnd = warrantyEnd;
  const serialNumber = optionalStr(raw.serialNumber, 80);
  if (serialNumber) payload.serialNumber = serialNumber;
  const specs = optionalStr(raw.specs, 240);
  if (specs) payload.specs = specs;
  const notes = optionalStr(raw.notes, 240);
  if (notes) payload.notes = notes;
  return payload;
}

function sanitizeVaultFile(raw: Record<string, unknown>, docId: string, targetUid: string): Record<string, unknown> | null {
  const rawKey = typeof raw.fileKey === 'string' && raw.fileKey.trim() ? raw.fileKey.trim() : docId;
  const fileKey = rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  if (!fileKey || !/^[a-zA-Z0-9_-]+$/.test(fileKey)) return null;
  const size = clampNum(raw.size, 1, 6500000, 1);
  const chunkCount = Math.round(clampNum(raw.chunkCount, 1, 16, 1));
  return {
    ownerId: targetUid,
    fileKey,
    fileName: nonEmptyStr(raw.fileName, 140, 'documento.pdf'),
    mimeType: nonEmptyStr(raw.mimeType, 80, 'application/pdf'),
    size,
    chunkCount,
    updatedAt: serverTimestamp(),
  };
}

function sanitizeVaultFileChunk(raw: Record<string, unknown>, targetUid: string): Record<string, unknown> | null {
  const rawKey = typeof raw.fileKey === 'string' ? raw.fileKey.trim() : '';
  const fileKey = rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const data = typeof raw.data === 'string' ? raw.data : '';
  const idx = Math.round(Number(raw.chunkIndex));
  if (!fileKey || !data || data.length > 700000 || !Number.isFinite(idx) || idx < 0 || idx > 15) {
    return null;
  }
  return {
    ownerId: targetUid,
    fileKey,
    chunkIndex: idx,
    data,
    createdAt: serverTimestamp(),
  };
}

function sanitizeRecordForCollection(
  colName: string,
  docId: string,
  raw: Record<string, unknown>,
  targetUid: string
): Record<string, unknown> | null {
  switch (colName) {
    case 'homeConfig':
      return sanitizeHomeConfig(raw, targetUid);
    case 'energyReadings':
      return sanitizeEnergyReading(raw, targetUid);
    case 'climateLogs':
      return sanitizeClimateLog(raw, targetUid);
    case 'electricityBills':
      return sanitizeElectricityBill(raw, targetUid);
    case 'waterBills':
      return sanitizeWaterBill(raw, targetUid);
    case 'tariBills':
      return sanitizeTariBill(raw, targetUid);
    case 'gsePayments':
      return sanitizeGsePayment(raw, targetUid);
    case 'homeArticles':
      return sanitizeHomeArticle(raw, targetUid);
    case 'vaultFiles':
      return sanitizeVaultFile(raw, docId, targetUid);
    case 'vaultFileChunks':
      return sanitizeVaultFileChunk(raw, targetUid);
    default:
      return null;
  }
}

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
  if (legacyUser && legacyUser.email && legacyUser.email !== OWNER_EMAIL) {
    await signOut(legacyAuth);
    legacyUser = null;
  }
  if (!legacyUser) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account',
      login_hint: OWNER_EMAIL,
    });
    const cred = await signInWithPopup(legacyAuth, provider);
    legacyUser = cred.user;
  }

  const legacyUid = legacyUser?.uid || LEGACY_OWNER_UID;
  const counts: Record<string, number> = {};
  const migratedDates = new Set<string>();
  const migratedElecInvoices = new Set<string>();
  const migratedTariNotices = new Set<string>();
  const migratedVaultFiles: Array<{ fileKey: string; chunkCount: number }> = [];
  let totalDocs = 0;

  for (const colCfg of COLLECTIONS_TO_MIGRATE) {
    onProgress?.(`Lettura ${colCfg.label}...`);
    let docsList: Array<{ id: string; data: Record<string, unknown> }> = [];

    if (colCfg.name === 'vaultFileChunks' && migratedVaultFiles.length > 0) {
      // Fetch each PDF chunk directly via `get` (avoids list-query limits on large base64 chunks)
      for (let fIdx = 0; fIdx < migratedVaultFiles.length; fIdx++) {
        const vf = migratedVaultFiles[fIdx];
        onProgress?.(`Lettura PDF ${fIdx + 1}/${migratedVaultFiles.length} (${vf.fileKey})...`);
        const chunkIndices = Array.from({ length: vf.chunkCount }, (_, idx) => idx);
        const snaps = await Promise.all(
          chunkIndices.map((idx) =>
            getDoc(doc(legacyDb, `users/${legacyUid}/vaultFileChunks`, `${vf.fileKey}_chunk_${idx}`))
          )
        );
        for (const s of snaps) {
          if (s.exists()) {
            docsList.push({ id: s.id, data: s.data() });
          }
        }
      }
    } else {
      try {
        const q = query(
          collection(legacyDb, `users/${legacyUid}/${colCfg.name}`),
          where('ownerId', '==', legacyUid)
        );
        const snap = await getDocs(q);
        docsList = snap.docs
          .filter((d) => d.id !== MIGRATION_DONE_DOC_ID)
          .map((d) => ({ id: d.id, data: d.data() }));
      } catch (readErr) {
        if (colCfg.name === 'homeConfig') {
          try {
            const mainSnap = await getDoc(doc(legacyDb, `users/${legacyUid}/homeConfig/main`));
            if (mainSnap.exists()) {
              docsList = [{ id: mainSnap.id, data: mainSnap.data() }];
            }
          } catch {
            // fallback empty
          }
        } else {
          const msg = readErr instanceof Error ? readErr.message : String(readErr);
          throw new Error(`[Lettura ${colCfg.label}] ${msg}`);
        }
      }
    }

    counts[colCfg.name] = docsList.length;
    if (docsList.length === 0) continue;

    const dstPath = `users/${targetUid}/${colCfg.name}`;
    for (let i = 0; i < docsList.length; i += colCfg.batchSize) {
      const slice = docsList.slice(i, i + colCfg.batchSize);
      const batch = writeBatch(db);
      let opsInBatch = 0;

      for (const srcDoc of slice) {
        const cleanId = sanitizeDocId(srcDoc.id);
        const payload = sanitizeRecordForCollection(colCfg.name, cleanId, srcDoc.data, targetUid);
        if (!payload) continue;

        if (colCfg.name === 'energyReadings' && typeof payload.date === 'string') {
          migratedDates.add(payload.date);
        }
        if (colCfg.name === 'electricityBills' && typeof payload.invoiceNumber === 'string') {
          migratedElecInvoices.add(payload.invoiceNumber);
        }
        if (colCfg.name === 'tariBills' && typeof payload.noticeNumber === 'string') {
          migratedTariNotices.add(payload.noticeNumber);
        }
        if (
          colCfg.name === 'vaultFiles' &&
          typeof payload.fileKey === 'string' &&
          typeof payload.chunkCount === 'number'
        ) {
          migratedVaultFiles.push({ fileKey: payload.fileKey, chunkCount: payload.chunkCount });
        }

        batch.set(doc(db, dstPath, cleanId), payload);
        opsInBatch++;
      }

      if (opsInBatch > 0) {
        try {
          await batch.commit();
        } catch (writeErr) {
          const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
          throw new Error(`[Scrittura ${colCfg.label}] ${msg}`);
        }
        totalDocs += opsInBatch;
      }

      onProgress?.(
        `Migrazione ${colCfg.label}: ${Math.min(i + slice.length, docsList.length)}/${docsList.length}...`
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
        let ops = 0;
        for (const r of chunk) {
          const total = Math.round(Number(r.totalKwh || 0) * 100) / 100;
          const payload = sanitizeEnergyReading(
            {
              date: r.date.slice(0, 10),
              f1Kwh: Math.round(Number(r.f1Kwh || 0) * 100) / 100,
              f2Kwh: Math.round(Number(r.f2Kwh || 0) * 100) / 100,
              f3Kwh: Math.round(Number(r.f3Kwh || 0) * 100) / 100,
              totalKwh: total,
              peakKw: Math.round(Number(r.peakKw || 0) * 100) / 100,
              estimatedCostEur: Math.round(total * 0.1595 * 100) / 100,
              source: 'e-distribuzione-api',
            },
            targetUid
          );
          if (!payload) continue;
          batch.set(doc(db, `users/${targetUid}/energyReadings`, `day_${r.date.replace(/-/g, '')}`), payload);
          ops++;
        }
        if (ops > 0) {
          await batch.commit();
          githubExtraReadings += ops;
        }
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
        let ops = 0;
        for (const b of missingElec) {
          const inv = String(b.invoiceNumber);
          const docId = sanitizeDocId(`edison_${inv.replace(/[^a-zA-Z0-9_-]/g, '')}`);
          const payload = sanitizeElectricityBill(b, targetUid);
          if (!payload) continue;
          batch.set(doc(db, `users/${targetUid}/electricityBills`, docId), payload);
          ops++;
        }
        if (ops > 0) {
          await batch.commit();
          githubExtraBills += ops;
        }
      }

      const missingTari = (json.tariBills || []).filter(
        (t) => typeof t?.noticeNumber === 'string' && !migratedTariNotices.has(t.noticeNumber)
      );
      if (missingTari.length > 0) {
        const batch = writeBatch(db);
        let ops = 0;
        for (const t of missingTari) {
          const notice = String(t.noticeNumber);
          const docId = sanitizeDocId(`tari_${notice.replace(/[^a-zA-Z0-9_-]/g, '')}`);
          const payload = sanitizeTariBill({ ...t, source: t.source || 'gmail-pdf' }, targetUid);
          if (!payload) continue;
          batch.set(doc(db, `users/${targetUid}/tariBills`, docId), payload);
          ops++;
        }
        if (ops > 0) {
          await batch.commit();
          githubExtraBills += ops;
        }
      }
    }
  } catch {
    // ignore if branch data is not present
  }

  onProgress?.('Finalizzazione puntatore proprietario su Firestore...');
  if (auth.currentUser?.email === OWNER_EMAIL) {
    try {
      await setDoc(doc(db, 'appMeta', 'owner'), {
        ownerUid: targetUid,
        updatedAt: serverTimestamp(),
      });
    } catch (metaErr) {
      const msg = metaErr instanceof Error ? metaErr.message : String(metaErr);
      throw new Error(`[Finalizzazione appMeta/owner] ${msg}`);
    }
  }

  try {
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
  } catch (markerErr) {
    const msg = markerErr instanceof Error ? markerErr.message : String(markerErr);
    throw new Error(`[Marker migrazione] ${msg}`);
  }

  return {
    legacyUid,
    targetUid,
    counts,
    totalDocs,
    githubExtraReadings,
    githubExtraBills,
  };
}
