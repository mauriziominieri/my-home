import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signOut, User } from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  BookOpen,
  Car,
  CheckCircle2,
  Clock,
  CloudUpload,
  Database,
  FlaskConical,
  FolderOpen,
  Home,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  Menu,
  Moon,
  Package,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Sun,
  Thermometer,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  auth,
  clearGmailAccessToken,
  clearSimulatedFirestoreOps,
  connectGmailAccount,
  db,
  discardSimulatedFirestoreOp,
  dismissFirestoreQuotaExceeded,
  dismissSimulatedFlushResult,
  FIREBASE_PROJECT_ID,
  FirestoreWriteStats,
  flushSimulatedFirestoreOps,
  getGmailAccessToken,
  GMAIL_OAUTH_PROJECT_ID,
  guardedDeleteDoc as deleteDoc,
  guardedSetDoc as setDoc,
  guardedWriteBatch as writeBatch,
  handleFirestoreError,
  isFirestoreQuotaExceededActive,
  isFirestoreWritesDisabled,
  mergeSimulatedOpsIntoRawDocs,
  notifyFirestoreQuotaExceeded,
  OperationType,
  setSimulatedOpDetailHint,
  setSimulatedOpTitleHint,
  signInPrimaryOwner,
  SimulatedFirestoreOp,
  SimulatedFlushState,
  subscribeAuthWithGmailCleanup,
  subscribeFirestoreQuotaExceeded,
  subscribeFirestoreWriteStats,
  subscribeSimulatedFirestoreOps,
  subscribeSimulatedFlushState,
} from './firebase';
import {
  ArticleAttachmentType,
  BillRecord,
  CarInsurancePolicy,
  CarLogEntry,
  CarProfile,
  ClimateAutopilotConfig,
  ClimateMode,
  ClimateSession,
  DEFAULT_HOME_CONFIG,
  EnergyReading,
  GroceryProduct,
  GsePaymentRecord,
  GsePaymentType,
  HomeArticleCategory,
  HomeArticleRecord,
  HomeDocumentRecord,
  HomeSystemConfig,
  NavSection,
  ProductResearchCategory,
  ProductResearchRecord,
  ProductResearchStatus,
  ReadingSource,
  RoomId,
  TariBillRecord,
  VmcDayRecord,
  WaterBillRecord,
} from './types/home';

function normalizeResearchStatus(raw: unknown): ProductResearchStatus {
  if (raw === 'da_acquistare' || raw === 'acquistato' || raw === 'da_valutare') {
    return raw;
  }
  return 'da_valutare';
}

const RESEARCH_STATUS_LABELS: Record<ProductResearchStatus, string> = {
  da_valutare: 'Da valutare',
  da_acquistare: 'Da acquistare',
  acquistato: 'Acquistato',
};

const RESEARCH_CATEGORY_LABELS: Record<ProductResearchCategory, string> = {
  elettrodomestici: 'Elettrodomestici',
  elettronica: 'Elettronica & Tech',
  casa_arredo: 'Casa & Arredo',
  fai_da_te: 'Fai da te & Giardino',
  auto: 'Auto & Accessori',
  abbigliamento: 'Abbigliamento',
  altro: 'Altro',
};

function formatSimulatedEuro(val?: number): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
  return `€${val.toFixed(2).replace('.', ',')}`;
}

function normSimulatedMoney(val?: number): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return undefined;
  return Math.min(1000000, Math.round(val * 100) / 100);
}

function truncateDetailVal(val: string, max = 30): string {
  const clean = val.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function diffProductResearchFields(
  prev: ProductResearchRecord | undefined,
  next: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>
): { changedFields: string[]; changedDetails: string[] } {
  const nextStatus = normalizeResearchStatus(next.status);
  const nextRoom = normalizeResearchRoom(next.room);
  const nextPrice = normSimulatedMoney(next.priceEur);
  const nextPaid =
    nextStatus === 'acquistato' ? normSimulatedMoney(next.paidPriceEur) : undefined;

  if (!prev) {
    const details = [
      nextRoom ? `Stanza: ${getResearchRoomLabel(nextRoom)}` : '',
      next.color?.trim() ? `Colore: ${next.color.trim()}` : '',
      next.size?.trim() ? `Taglia: ${next.size.trim()}` : '',
      typeof nextPrice === 'number' ? `Prezzo: ${formatSimulatedEuro(nextPrice)}` : '',
      `Stato: ${RESEARCH_STATUS_LABELS[nextStatus]}`,
    ].filter(Boolean);
    return {
      changedFields: ['__new__'],
      changedDetails: details,
    };
  }

  const changedFields: string[] = [];
  const changedDetails: string[] = [];

  const prevColor = (prev.color || '').trim();
  const nextColor = (next.color || '').trim();
  if (prevColor !== nextColor) {
    changedFields.push('color');
    changedDetails.push(`Colore: ${prevColor || 'Nessuno'} → ${nextColor || 'Rimosso'}`);
  }

  const prevSize = (prev.size || '').trim();
  const nextSize = (next.size || '').trim();
  if (prevSize !== nextSize) {
    changedFields.push('size');
    changedDetails.push(`Taglia: ${prevSize || 'Nessuna'} → ${nextSize || 'Rimossa'}`);
  }

  const prevRoom = normalizeResearchRoom(prev.room);
  if ((prevRoom || '') !== (nextRoom || '')) {
    changedFields.push('room');
    changedDetails.push(
      `Stanza: ${getResearchRoomLabel(prevRoom)} → ${getResearchRoomLabel(nextRoom)}`
    );
  }

  const prevStatus = normalizeResearchStatus(prev.status);
  if (prevStatus !== nextStatus) {
    changedFields.push('status');
    changedDetails.push(
      `Stato: ${RESEARCH_STATUS_LABELS[prevStatus]} → ${RESEARCH_STATUS_LABELS[nextStatus]}`
    );
  }

  const prevPrice = normSimulatedMoney(prev.priceEur);
  if (prevPrice !== nextPrice) {
    changedFields.push('priceEur');
    changedDetails.push(
      `Prezzo: ${formatSimulatedEuro(prevPrice)} → ${formatSimulatedEuro(nextPrice)}`
    );
  }

  const prevPaid =
    prevStatus === 'acquistato' ? normSimulatedMoney(prev.paidPriceEur) : undefined;
  if (prevPaid !== nextPaid) {
    changedFields.push('paidPriceEur');
    changedDetails.push(
      `Pagato: ${formatSimulatedEuro(prevPaid)} → ${formatSimulatedEuro(nextPaid)}`
    );
  }

  const prevBrand = (prev.brand || '').trim().slice(0, 60);
  const nextBrand = (next.brand || '').trim().slice(0, 60);
  if (prevBrand !== nextBrand) {
    changedFields.push('brand');
    changedDetails.push(`Marca: ${prevBrand || '—'} → ${nextBrand || '—'}`);
  }

  const prevStore = (prev.store || '').trim().slice(0, 60);
  const nextStore = (next.store || '').trim().slice(0, 60);
  if (prevStore !== nextStore) {
    changedFields.push('store');
    changedDetails.push(`Negozio: ${prevStore || '—'} → ${nextStore || '—'}`);
  }

  if (prev.category !== next.category) {
    changedFields.push('category');
    changedDetails.push(
      `Categoria: ${RESEARCH_CATEGORY_LABELS[prev.category]} → ${RESEARCH_CATEGORY_LABELS[next.category]}`
    );
  }

  const prevModel = (prev.model || '').trim().slice(0, 80);
  const nextModel = (next.model || '').trim().slice(0, 80);
  if (prevModel !== nextModel) {
    changedFields.push('model');
    changedDetails.push(`Modello: ${prevModel || '—'} → ${nextModel || '—'}`);
  }

  const prevTitle = (prev.title || '').trim().slice(0, 160);
  const nextTitle = (next.title || '').trim().slice(0, 160);
  if (prevTitle !== nextTitle) {
    changedFields.push('title');
    changedDetails.push('Titolo aggiornato');
  }

  const prevImg = (prev.imageUrl || '').trim().slice(0, 1000);
  const nextImg = (next.imageUrl || '').trim().slice(0, 1000);
  if (prevImg !== nextImg) {
    changedFields.push('imageUrl');
    changedDetails.push('Immagine aggiornata');
  }

  const prevUrl = (prev.url || '').trim().slice(0, 1000);
  const nextUrl = (next.url || '').trim().slice(0, 1000);
  if (prevUrl !== nextUrl) {
    changedFields.push('url');
    changedDetails.push('Link URL aggiornato');
  }

  const prevSpecs = (prev.specs || '').trim().slice(0, 2000);
  const nextSpecs = (next.specs || '').trim().slice(0, 2000);
  if (prevSpecs !== nextSpecs) {
    changedFields.push('specs');
    changedDetails.push('Specifiche aggiornate');
  }

  const prevNotes = (prev.notes || '').trim().slice(0, 400);
  const nextNotes = (next.notes || '').trim().slice(0, 400);
  if (prevNotes !== nextNotes) {
    changedFields.push('notes');
    changedDetails.push(
      nextNotes ? `Note: "${truncateDetailVal(nextNotes, 26)}"` : 'Note rimosse'
    );
  }

  return { changedFields, changedDetails };
}

function diffHomeArticleFields(
  prev: HomeArticleRecord | undefined,
  next: Omit<HomeArticleRecord, 'id'>,
  docId: string
): { changedFields: string[]; changedDetails: string[] } {
  if (!prev) {
    const details = [
      next.room && !next.room.startsWith('__') ? `Stanza: ${next.room}` : '',
      next.brand?.trim() && next.room !== '__spesa__' ? `Marca: ${next.brand.trim()}` : '',
      typeof next.purchasePriceEur === 'number'
        ? `Prezzo: ${formatSimulatedEuro(next.purchasePriceEur)}`
        : '',
    ].filter(Boolean);
    return {
      changedFields: ['__new__'],
      changedDetails: details,
    };
  }

  const changedFields: string[] = [];
  const changedDetails: string[] = [];
  const isDocRecord =
    next.room === '__documenti__' ||
    docId.startsWith('doc_') ||
    docId.startsWith('resdoc_') ||
    docId.startsWith('artdoc_');
  const isSpesaRecord = next.room === '__spesa__' || docId.startsWith('spesa_');

  if (prev.name.trim() !== next.name.trim()) {
    changedFields.push('name');
    changedDetails.push(`Nome: ${truncateDetailVal(next.name, 26)}`);
  }
  if ((prev.brand || '').trim() !== (next.brand || '').trim()) {
    changedFields.push('brand');
    changedDetails.push(
      `${isDocRecord ? 'Fornitore' : isSpesaRecord ? 'Categoria' : 'Marca'}: ${next.brand?.trim() || '—'}`
    );
  }
  if ((prev.model || '').trim() !== (next.model || '').trim()) {
    changedFields.push('model');
    changedDetails.push(`${isDocRecord ? 'Categoria' : 'Modello'}: ${next.model?.trim() || '—'}`);
  }
  if ((prev.room || '').trim() !== (next.room || '').trim()) {
    changedFields.push('room');
    changedDetails.push(`Stanza: ${prev.room || '—'} → ${next.room || '—'}`);
  }
  if (prev.category !== next.category) {
    changedFields.push('category');
    changedDetails.push(`Categoria: ${prev.category} → ${next.category}`);
  }
  if ((prev.purchaseDate || '').trim() !== (next.purchaseDate || '').trim()) {
    changedFields.push('purchaseDate');
    changedDetails.push(
      `${isDocRecord ? 'Data emissione' : 'Data acquisto'}: ${next.purchaseDate?.trim() || 'Rimossa'}`
    );
  }
  if (normSimulatedMoney(prev.purchasePriceEur) !== normSimulatedMoney(next.purchasePriceEur)) {
    changedFields.push('purchasePriceEur');
    changedDetails.push(
      `Prezzo: ${formatSimulatedEuro(normSimulatedMoney(prev.purchasePriceEur))} → ${formatSimulatedEuro(normSimulatedMoney(next.purchasePriceEur))}`
    );
  }
  if ((prev.warrantyEnd || '').trim() !== (next.warrantyEnd || '').trim()) {
    changedFields.push('warrantyEnd');
    changedDetails.push(
      `${isDocRecord ? 'Scadenza' : 'Fine garanzia'}: ${next.warrantyEnd?.trim() || 'Rimossa'}`
    );
  }
  if (Boolean(prev.familyWarranty) !== Boolean(next.familyWarranty)) {
    changedFields.push('familyWarranty');
    changedDetails.push(
      isSpesaRecord
        ? next.familyWarranty
          ? 'Aggiunto a lista spesa'
          : 'Rimosso da lista spesa'
        : isDocRecord
          ? next.familyWarranty
            ? 'Documento in evidenza'
            : 'Rimosso da evidenza'
          : next.familyWarranty
            ? 'Garanzia Extra Family attivata'
            : 'Garanzia Extra Family disattivata'
    );
  }
  if ((prev.serialNumber || '').trim() !== (next.serialNumber || '').trim()) {
    changedFields.push('serialNumber');
    const nextResDoc = parseResearchDocumentRef(next.serialNumber);
    const prevResDoc = parseResearchDocumentRef(prev.serialNumber);
    if (nextResDoc && prevResDoc && nextResDoc.docType !== prevResDoc.docType) {
      changedDetails.push(`Tipo allegato: ${prevResDoc.docType} → ${nextResDoc.docType}`);
    } else {
      changedDetails.push(isDocRecord ? 'Riferimento aggiornato' : 'Seriale aggiornato');
    }
  }
  if ((prev.specs || '').trim() !== (next.specs || '').trim()) {
    changedFields.push('specs');
    changedDetails.push(isSpesaRecord ? 'Prezzi supermercati aggiornati' : 'Specifiche aggiornate');
  }
  if ((prev.notes || '').trim() !== (next.notes || '').trim()) {
    changedFields.push('notes');
    changedDetails.push(
      next.notes?.trim() ? `Note: "${truncateDetailVal(next.notes.trim(), 24)}"` : 'Note rimosse'
    );
  }
  if ((prev.manualFileKey || '') !== (next.manualFileKey || '')) {
    changedFields.push('manualFileKey');
    changedDetails.push(next.manualFileName ? `Manuale: ${truncateDetailVal(next.manualFileName, 24)}` : 'Manuale aggiornato');
  }

  return { changedFields, changedDetails };
}
import { ParsedReadingInput } from './utils/edistribuzioneCsv';
import {
  GmailAuthExpiredError,
  GmailProcessedMessage,
  scanGmailInbox,
  trashGmailMessages,
} from './utils/gmailSync';
import {
  articleToCarInsurance,
  articleToCarLog,
  articleToCarProfile,
  articleToGroceryProduct,
  buildArticleDocumentRef,
  buildResearchDocumentRef,
  CAR_POLICY_ID,
  CAR_PROFILE_ID,
  carInsuranceToArticlePayload,
  carLogToArticlePayload,
  carProfileToArticlePayload,
  DEFAULT_CONTE_POLICY_OWNER,
  getDocumentsForResearch,
  groceryProductToArticlePayload,
  isCarLinkedDocument,
  parseArticleDocumentRef,
  parseResearchDocumentRef,
  SYSTEM_ROOM_CAR,
  SYSTEM_ROOM_GROCERY,
  SYSTEM_ROOM_GROCERY_META,
} from './utils/carGroceryStore';
import {
  articleToHomeDocument,
  deleteVaultFiles,
  deleteVaultFile,
  getElectricityBillFileKey,
  getVaultFile,
  getTariBillFileKey,
  getWaterBillFileKey,
  isOctopusContractRecord,
  listVaultFileMetadata,
  homeDocumentToArticlePayload,
  MAX_CLOUD_FILE_BYTES,
  notifyVaultUpdated,
  sanitizeVaultFileKey,
  saveVaultFile,
  SYSTEM_ROOM_DOCUMENTS,
  triggerBlobDownload,
} from './utils/documentVault';
import {
  addDaysIso,
  articleToClimateAutopilot,
  buildAutopilotSessionForDate,
  CLIMATE_AUTOPILOT_DOC_ID,
  climateAutopilotToArticlePayload,
  enumerateIsoDatesInclusive,
  getAutopilotSlots,
  getAutoClimateDocId,
  getLocalTodayIso,
  SYSTEM_ROOM_CLIMATE_AUTO,
} from './utils/climateAutopilot';
import { formatTimeSlotString } from './utils/climateTime';
import {
  MIGRATION_DONE_DOC_ID,
  migrateFromLegacyProject,
  SYSTEM_ROOM_MIGRATION_META,
} from './utils/legacyMigration';
import {
  getResearchRoomLabel,
  inferProductBrand,
  normalizeResearchRoom,
  ResearchRoomId,
  sanitizeColorImagesMap,
} from './utils/researchHelpers';
import { getAppSettings, useAppSettings } from './utils/appSettings';
import { OverviewView } from './components/OverviewView';
import { DomoticsView } from './components/DomoticsView';
import { EnergyDatabaseView } from './components/EnergyDatabaseView';
import { BillsView } from './components/BillsView';
import { ArticlesView } from './components/ArticlesView';
import { ResearchesView } from './components/ResearchesView';
import { CarView } from './components/CarView';
import { GroceryView } from './components/GroceryView';
import { DocumentsView } from './components/DocumentsView';
import { ClimateAutopilotInput } from './components/ClimateAutopilotCard';
import { InfoGuideView } from './components/InfoGuideView';
import { SettingsView } from './components/SettingsView';
import { VaultCloudNotice } from './components/VaultCloudNotice';

const EXTENDED_ROOM_OVERRIDES_KEY = 'myhome_research_terrace_rooms_v1';

function readExtendedRoomOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(EXTENDED_ROOM_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeExtendedRoomOverride(
  docId: string,
  url: string,
  value: ResearchRoomId | '__none__' | 'clear'
) {
  try {
    const map = readExtendedRoomOverrides();
    const idKey = `id:${docId}`;
    const urlKey = `url:${url.trim()}`;
    if (value === 'clear') {
      delete map[idKey];
      delete map[urlKey];
    } else {
      map[idKey] = value;
      if (url.trim()) map[urlKey] = value;
    }
    window.localStorage.setItem(EXTENDED_ROOM_OVERRIDES_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function resolveResearchRoomWithFallback(
  docId: string,
  url: string,
  firestoreRoom: string | undefined,
  title: string
): ResearchRoomId | undefined {
  const fromDoc = normalizeResearchRoom(firestoreRoom);
  if (fromDoc) return fromDoc;

  const overrides = readExtendedRoomOverrides();
  const overrideVal = overrides[`id:${docId}`] || overrides[`url:${url.trim()}`];
  if (overrideVal === '__none__') return undefined;
  const fromOverride = normalizeResearchRoom(overrideVal);
  if (fromOverride) return fromOverride;

  if (/\bkomodo(?:\s*5)?\b/i.test(`${title} ${url}`)) {
    return 'terrazza_ovest';
  }
  return undefined;
}

function isFirestorePermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    code === 'permission-denied' ||
    /permission[-_ ]denied|insufficient permissions/i.test(msg)
  );
}

const NAV_ITEMS: { id: NavSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'panoramica', label: 'Panoramica', icon: LayoutDashboard },
  { id: 'consumi', label: 'Consumi Annuali', icon: Database },
  { id: 'domotica', label: 'Clima & Domotica', icon: Thermometer },
  { id: 'bollette', label: 'Bollette', icon: Receipt },
  { id: 'articoli', label: 'Articoli', icon: Package },
  { id: 'ricerche', label: 'Ricerche', icon: Search },
  { id: 'documenti', label: 'Documenti', icon: FolderOpen },
  { id: 'macchina', label: 'Macchina', icon: Car },
  { id: 'spesa', label: 'Spesa', icon: ShoppingCart },
  { id: 'info', label: 'Info Utili', icon: BookOpen },
  { id: 'impostazioni', label: 'Impostazioni', icon: Settings },
];

const VALID_NAV_SECTIONS = new Set<NavSection>(NAV_ITEMS.map((item) => item.id));
const ACTIVE_NAV_STORAGE_KEY = 'myhome_active_nav';

function resolveInitialNavSection(): NavSection {
  if (typeof window !== 'undefined') {
    const hashRaw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase() as NavSection;
    if (VALID_NAV_SECTIONS.has(hashRaw)) {
      return hashRaw;
    }
    const startSetting = getAppSettings().defaultStartSection;
    if (startSetting !== 'remember_last' && VALID_NAV_SECTIONS.has(startSetting)) {
      return startSetting;
    }
    try {
      const saved = window.localStorage.getItem(ACTIVE_NAV_STORAGE_KEY) as NavSection | null;
      if (saved && VALID_NAV_SECTIONS.has(saved)) {
        return saved;
      }
    } catch {
      // ignore storage access issues
    }
  }
  return 'consumi';
}

function isResilientFirestoreOutage(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? `${(error as { code?: string }).code || ''} ${error.message}`
      : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('unauthenticated')) {
    return false;
  }
  if (lower.includes('resource-exhausted') || (lower.includes('quota') && lower.includes('exceeded'))) {
    notifyFirestoreQuotaExceeded();
    return true;
  }
  return (
    lower.includes('quota') ||
    lower.includes('unavailable') ||
    lower.includes('deadline-exceeded') ||
    lower.includes('internal') ||
    lower.includes('unknown') ||
    lower.includes('failed-precondition') ||
    lower.includes('offline') ||
    lower.includes('network') ||
    lower.includes('aborted')
  );
}

const CURRENT_YEAR = new Date().getFullYear();
const MIN_HOME_YEAR = 2025;
const AVAILABLE_YEARS = Array.from(
  { length: Math.max(1, CURRENT_YEAR - MIN_HOME_YEAR + 1) },
  (_, idx) => CURRENT_YEAR - idx
);
const PUBLIC_GROCERY_CACHE_KEY = 'myhome_spesa_cache_public';

interface RawDocEntry {
  id: string;
  data: DocumentData;
}

function mapRawReadings(docs: RawDocEntry[], ownerUid: string): EnergyReading[] {
  const currentTodayIso = getLocalTodayIso();
  return docs
    .map((d) => {
      const data = d.data;
      return {
        id: d.id,
        ownerId: String(data.ownerId || ownerUid),
        date: String(data.date || ''),
        f1Kwh: Number(data.f1Kwh || 0),
        f2Kwh: Number(data.f2Kwh || 0),
        f3Kwh: Number(data.f3Kwh || 0),
        totalKwh: Number(data.totalKwh || 0),
        peakKw: Number(data.peakKw || 0),
        estimatedCostEur: Number(data.estimatedCostEur || 0),
        source: (data.source as ReadingSource) || 'e-distribuzione-api',
        notes: data.notes ? String(data.notes) : undefined,
      };
    })
    .filter((r) => Boolean(r.date) && r.date <= currentTodayIso);
}

function mapRawHomeConfig(docs: RawDocEntry[], ownerUid: string): HomeSystemConfig {
  const mainDoc = docs.find((d) => d.id === 'main');
  if (!mainDoc) {
    return { ownerId: ownerUid, ...DEFAULT_HOME_CONFIG };
  }
  const data = mainDoc.data;
  return {
    ownerId: ownerUid,
    aristonMode: data.aristonMode || DEFAULT_HOME_CONFIG.aristonMode,
    aristonProfile: data.aristonProfile || DEFAULT_HOME_CONFIG.aristonProfile,
    floorFlowTemp: Number(data.floorFlowTemp ?? DEFAULT_HOME_CONFIG.floorFlowTemp),
    dhwTargetTemp: Number(data.dhwTargetTemp ?? DEFAULT_HOME_CONFIG.dhwTargetTemp),
    zoneLivingTarget: Number(data.zoneLivingTarget ?? DEFAULT_HOME_CONFIG.zoneLivingTarget),
    zoneBedroomTarget: Number(data.zoneBedroomTarget ?? DEFAULT_HOME_CONFIG.zoneBedroomTarget),
    neasmartPower: Boolean(data.neasmartPower ?? DEFAULT_HOME_CONFIG.neasmartPower),
    neasmartTargetHumidity: Number(
      data.neasmartTargetHumidity ?? DEFAULT_HOME_CONFIG.neasmartTargetHumidity
    ),
    neasmartFanSpeed: data.neasmartFanSpeed || DEFAULT_HOME_CONFIG.neasmartFanSpeed,
    dewPointProtection: Boolean(
      data.dewPointProtection ?? DEFAULT_HOME_CONFIG.dewPointProtection
    ),
    tariffEurPerKwh: Number(data.tariffEurPerKwh ?? DEFAULT_HOME_CONFIG.tariffEurPerKwh),
    podCode: String(data.podCode || DEFAULT_HOME_CONFIG.podCode),
  };
}

function mapRawClimateLogs(docs: RawDocEntry[], ownerUid: string): ClimateSession[] {
  return docs
    .filter((d) => Boolean(d.data?.date))
    .map((d) => {
      const data = d.data;
      return {
        id: d.id,
        ownerId: String(data.ownerId || ownerUid),
        date: String(data.date || ''),
        mode: (data.mode as ClimateMode) || 'riscaldamento',
        startTime: String(data.startTime || '09:00'),
        endTime: String(data.endTime || '20:00'),
        timeSlots: Array.isArray(data.timeSlots)
          ? data.timeSlots.map((s) => String(s))
          : undefined,
        vmcMax: typeof data.vmcMax === 'boolean' ? data.vmcMax : undefined,
        targetTemp: typeof data.targetTemp === 'number' ? data.targetTemp : 21,
        rooms: Array.isArray(data.rooms) ? (data.rooms as RoomId[]) : [],
        notes: data.notes ? String(data.notes) : undefined,
      };
    });
}

function mapRawElectricityBills(docs: RawDocEntry[]): BillRecord[] {
  return docs.map((d) => {
    const data = d.data;
    return {
      invoiceNumber: String(data.invoiceNumber || ''),
      issueDate: String(data.issueDate || ''),
      sortKey: String(data.sortKey || ''),
      year: Number(data.year || 2025),
      period: String(data.period || ''),
      supplier: String(data.supplier || ''),
      offerName: String(data.offerName || ''),
      kwh: Number(data.kwh || 0),
      punText: String(data.punText || ''),
      variableCostPerKwh: Number(data.variableCostPerKwh || 0),
      canoneTv: Number(data.canoneTv || 0),
      electricityOnly: Number(data.electricityOnly || 0),
      totalPaid: Number(data.totalPaid || 0),
      note: data.note ? String(data.note) : undefined,
      pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : undefined,
    };
  });
}

function mapRawWaterBills(docs: RawDocEntry[]): WaterBillRecord[] {
  return docs.map((d) => {
    const data = d.data;
    return {
      id: d.id,
      invoiceNumber: String(data.invoiceNumber || ''),
      issueDate: String(data.issueDate || ''),
      year: Number(data.year || 2025),
      period: String(data.period || ''),
      cubicMeters: Number(data.cubicMeters || 0),
      fixedCostEur: Number(data.fixedCostEur || 0),
      totalPaid: Number(data.totalPaid || 0),
      note: data.note ? String(data.note) : undefined,
      pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : undefined,
    };
  });
}

function mapRawTariBills(docs: RawDocEntry[]): TariBillRecord[] {
  return docs.map((d) => {
    const data = d.data;
    return {
      id: d.id,
      noticeNumber: String(data.noticeNumber || ''),
      issueDate: String(data.issueDate || ''),
      dueDate: String(data.dueDate || ''),
      year: Number(data.year || new Date().getFullYear()),
      period: String(data.period || ''),
      supplier: String(data.supplier || 'AcegasApsAmga / TARI'),
      totalPaid: Number(data.totalPaid || 0),
      paid: Boolean(data.paid),
      source: data.source === 'gmail-pdf' ? 'gmail-pdf' : 'manuale',
      note: data.note ? String(data.note) : undefined,
      pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : undefined,
    };
  });
}

function mapRawGsePayments(docs: RawDocEntry[]): GsePaymentRecord[] {
  return docs.map((d) => {
    const data = d.data;
    return {
      id: d.id,
      paymentDate: String(data.paymentDate || ''),
      year: Number(data.year || new Date().getFullYear()),
      paymentType: (data.paymentType as GsePaymentType) || 'acconto',
      period: String(data.period || ''),
      amountEur: Number(data.amountEur || 0),
      kwhInjected:
        typeof data.kwhInjected === 'number' ? Number(data.kwhInjected) : undefined,
      reference: data.reference ? String(data.reference) : undefined,
      note: data.note ? String(data.note) : undefined,
      attachmentFileKey: data.attachmentFileKey
        ? String(data.attachmentFileKey)
        : undefined,
    };
  });
}

function mapRawHomeArticles(docs: RawDocEntry[]): HomeArticleRecord[] {
  return docs
    .filter((d) => d.id !== 'grocery_seed_v1_done' && Boolean(d.data?.name))
    .map((d) => {
      const data = d.data;
      return {
        id: d.id,
        name: String(data.name || ''),
        brand: String(data.brand || ''),
        model: String(data.model || ''),
        category: (data.category as HomeArticleCategory) || 'altro',
        room: String(data.room || 'Casa'),
        purchaseDate: data.purchaseDate ? String(data.purchaseDate) : undefined,
        purchasePriceEur:
          typeof data.purchasePriceEur === 'number'
            ? Number(data.purchasePriceEur)
            : undefined,
        warrantyEnd: data.warrantyEnd ? String(data.warrantyEnd) : undefined,
        familyWarranty: Boolean(data.familyWarranty),
        serialNumber: data.serialNumber ? String(data.serialNumber) : undefined,
        specs: data.specs ? String(data.specs) : undefined,
        notes: data.notes ? String(data.notes) : undefined,
        manualFileKey: data.manualFileKey ? String(data.manualFileKey) : undefined,
        manualFileName: data.manualFileName ? String(data.manualFileName) : undefined,
        manualExtractText: data.manualExtractText
          ? String(data.manualExtractText)
          : undefined,
      };
    });
}

function mapRawVmcDays(docs: RawDocEntry[], ownerUid: string): VmcDayRecord[] {
  return docs
    .filter((d) => Boolean(d.data?.date))
    .map((d) => {
      const data = d.data;
      return {
        id: d.id,
        ownerId: String(data.ownerId || ownerUid),
        date: String(data.date || ''),
        enabled: Boolean(data.enabled),
        note: data.note ? String(data.note) : undefined,
      };
    });
}

function mapRawProductResearches(
  docs: RawDocEntry[],
  ownerUid: string
): ProductResearchRecord[] {
  return docs
    .filter((d) => Boolean(d.data?.url) && Boolean(d.data?.title))
    .map((d) => {
      const data = d.data;
      const createdTs = data.createdAt as { toMillis?: () => number } | undefined;
      const urlStr = String(data.url || '');
      const titleStr = String(data.title || '');
      const normalizedStatus = normalizeResearchStatus(data.status);
      return {
        id: d.id,
        ownerId: String(data.ownerId || ownerUid),
        url: urlStr,
        title: titleStr,
        store: String(data.store || ''),
        category: (data.category as ProductResearchCategory) || 'altro',
        status: normalizedStatus,
        room: resolveResearchRoomWithFallback(
          d.id,
          urlStr,
          data.room ? String(data.room) : undefined,
          titleStr
        ),
        priceEur: typeof data.priceEur === 'number' ? Number(data.priceEur) : undefined,
        paidPriceEur:
          normalizedStatus === 'acquistato' && typeof data.paidPriceEur === 'number'
            ? Number(data.paidPriceEur)
            : undefined,
        imageUrl: data.imageUrl ? String(data.imageUrl) : undefined,
        brand: data.brand ? String(data.brand) : undefined,
        color: data.color ? String(data.color) : undefined,
        availableColors: Array.isArray(data.availableColors)
          ? data.availableColors.map((c) => String(c).trim()).filter(Boolean).slice(0, 24)
          : undefined,
        colorImages: sanitizeColorImagesMap(data.colorImages),
        size: data.size ? String(data.size) : undefined,
        availableSizes: Array.isArray(data.availableSizes)
          ? data.availableSizes.map((s) => String(s).trim()).filter(Boolean).slice(0, 24)
          : undefined,
        model: data.model ? String(data.model) : undefined,
        specs: data.specs ? String(data.specs) : undefined,
        notes: data.notes ? String(data.notes) : undefined,
        createdAtMs:
          typeof createdTs?.toMillis === 'function'
            ? createdTs.toMillis()
            : typeof data.createdAtMs === 'number'
              ? data.createdAtMs
              : 0,
      };
    });
}

export default function App() {
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings();
  const [writeStats, setWriteStats] = useState<FirestoreWriteStats>({
    writesDisabled: appSettings.firestoreWritesDisabled,
    writesSavedCount: 0,
    writesExecutedCount: 0,
    lastActionLabel: null,
    lastActionAt: null,
  });
  const [simulatedOps, setSimulatedOps] = useState<SimulatedFirestoreOp[]>([]);
  const [flushState, setFlushState] = useState<SimulatedFlushState>({
    flushing: false,
    lastResult: null,
  });
  const [showSimulatedQueuePanel, setShowSimulatedQueuePanel] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firestoreQuotaExceeded, setFirestoreQuotaExceeded] = useState(() =>
    isFirestoreQuotaExceededActive()
  );
  const [activeNav, setActiveNav] = useState<NavSection>(() => resolveInitialNavSection());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    return subscribeFirestoreQuotaExceeded((active) => {
      setFirestoreQuotaExceeded(active);
    });
  }, []);

  useEffect(() => {
    return subscribeFirestoreWriteStats(setWriteStats);
  }, []);

  useEffect(() => {
    return subscribeSimulatedFirestoreOps((ops) => {
      setSimulatedOps(ops);
      if (ops.length === 0) {
        setShowSimulatedQueuePanel(false);
      }
    });
  }, []);

  useEffect(() => {
    return subscribeSimulatedFlushState(setFlushState);
  }, []);

  const navigateToSection = useCallback((section: NavSection) => {
    setActiveNav(section);
    try {
      window.localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, section);
    } catch {
      // ignore storage errors
    }
    if (typeof window !== 'undefined' && window.location.hash !== `#${section}`) {
      window.location.hash = `#${section}`;
    }
  }, []);

  useEffect(() => {
    const syncFromHash = () => {
      const hashRaw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase() as NavSection;
      if (VALID_NAV_SECTIONS.has(hashRaw)) {
        setActiveNav(hashRaw);
        try {
          window.localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, hashRaw);
        } catch {
          // ignore
        }
      }
    };
    if (!window.location.hash) {
      try {
        window.history.replaceState(null, '', `#${activeNav}`);
      } catch {
        // ignore
      }
    }
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  const [firestoreReadings, setFirestoreReadings] = useState<EnergyReading[]>([]);
  const [climateLogs, setClimateLogs] = useState<ClimateSession[]>([]);
  const [vmcDays, setVmcDays] = useState<VmcDayRecord[]>([]);
  const [productResearches, setProductResearches] = useState<ProductResearchRecord[]>([]);
  const [publicOwnerUid, setPublicOwnerUid] = useState<string | null>(null);
  const [publicClimateAutopilot, setPublicClimateAutopilot] =
    useState<ClimateAutopilotConfig | null>(null);
  const [electricityBills, setElectricityBills] = useState<BillRecord[]>([]);
  const [waterBills, setWaterBills] = useState<WaterBillRecord[]>([]);
  const [tariBills, setTariBills] = useState<TariBillRecord[]>([]);
  const [gsePayments, setGsePayments] = useState<GsePaymentRecord[]>([]);
  const [homeArticles, setHomeArticles] = useState<HomeArticleRecord[]>([]);
  const [homeArticlesLoaded, setHomeArticlesLoaded] = useState(false);
  const [readingsLoading, setReadingsLoading] = useState(true);
  const [firestoreFallbackNotice, setFirestoreFallbackNotice] = useState<string | null>(null);
  const [migratingDb, setMigratingDb] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<string | null>(null);
  const [migrationDismissed, setMigrationDismissed] = useState(false);
  const clearingBillArchiveRef = useRef(false);
  const carPolicySeededRef = useRef(false);
  const skippedTrashIdsRef = useRef<Set<string>>(new Set());
  const gmailSyncInFlightRef = useRef(false);
  const autopilotSyncInFlightRef = useRef(false);
  const lastAutopilotSyncKeyRef = useRef<string | null>(null);
  const rawSnapshotsRef = useRef<{
    uid: string | null;
    energyReadings: RawDocEntry[] | null;
    homeConfig: RawDocEntry[] | null;
    climateLogs: RawDocEntry[] | null;
    electricityBills: RawDocEntry[] | null;
    waterBills: RawDocEntry[] | null;
    tariBills: RawDocEntry[] | null;
    gsePayments: RawDocEntry[] | null;
    homeArticles: RawDocEntry[] | null;
    vmcDays: RawDocEntry[] | null;
    productResearches: RawDocEntry[] | null;
  }>({
    uid: null,
    energyReadings: null,
    homeConfig: null,
    climateLogs: null,
    electricityBills: null,
    waterBills: null,
    tariBills: null,
    gsePayments: null,
    homeArticles: null,
    vmcDays: null,
    productResearches: null,
  });
  const [todayIso, setTodayIso] = useState<string>(() => getLocalTodayIso());
  const [gmailToken, setGmailToken] = useState<string | null>(() => getGmailAccessToken());
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [gmailNotice, setGmailNotice] = useState<{
    tone: 'ok' | 'info' | 'warn';
    text: string;
  } | null>(null);
  const [pendingTrashMessages, setPendingTrashMessages] = useState<GmailProcessedMessage[]>([]);
  const [trashingEmails, setTrashingEmails] = useState(false);
  const [homeConfig, setHomeConfig] = useState<HomeSystemConfig>({
    ownerId: '',
    ...DEFAULT_HOME_CONFIG,
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = getLocalTodayIso();
      setTodayIso((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAuthWithGmailCleanup((currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setPublicOwnerUid(null);
        setPublicClimateAutopilot(null);
      }
      if (!currentUser) {
        // Non svuotiamo homeArticles: la spesa è pubblica e viene
        // ricaricata dal listener pubblico (publicOwnerUid) anche senza login.
        setGmailToken(null);
        setPendingTrashMessages([]);
      }
      setAuthReady(true);
      notifyVaultUpdated();
    });
    return () => unsubscribe();
  }, []);

  const activeUid = user?.uid ?? null;
  const canEdit = Boolean(user);

  useEffect(() => {
    if (!authReady || activeUid) return;

    const ownerPath = 'appMeta/owner';
    const unsubscribe = onSnapshot(
      doc(db, ownerPath),
      (snap) => {
        const ownerUid = snap.exists() ? snap.data().ownerUid : null;
        if (typeof ownerUid !== 'string' || ownerUid.length === 0) {
          setPublicOwnerUid(null);
          setFirestoreReadings([]);
          setClimateLogs([]);
          setReadingsLoading(false);
          return;
        }
        setPublicOwnerUid(ownerUid);
      },
      (error) => {
        setPublicOwnerUid(null);
        setFirestoreReadings([]);
        setClimateLogs([]);
        setReadingsLoading(false);
        handleFirestoreError(error, OperationType.GET, ownerPath);
      }
    );

    return () => unsubscribe();
  }, [authReady, activeUid]);

  // Registra l'ownerUid su appMeta/owner solo se mancante o diverso, evitando scritture ridondanti a ogni avvio
  useEffect(() => {
    if (!authReady || !user || user.email !== 'mauminieri@gmail.com') return;
    if (isFirestoreWritesDisabled()) return;
    let cancelled = false;
    const ownerRef = doc(db, 'appMeta', 'owner');
    void getDoc(ownerRef)
      .then((snap) => {
        if (cancelled) return;
        const currentOwner = snap.exists() ? snap.data()?.ownerUid : null;
        if (currentOwner === user.uid) return;
        return setDoc(
          ownerRef,
          { ownerUid: user.uid, updatedAt: serverTimestamp() },
          { merge: true }
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  // Subscribe to private Firestore data when signed in as owner.
  useEffect(() => {
    if (!authReady) return;
    if (!activeUid) {
      rawSnapshotsRef.current = {
        uid: null,
        energyReadings: null,
        homeConfig: null,
        climateLogs: null,
        electricityBills: null,
        waterBills: null,
        tariBills: null,
        gsePayments: null,
        homeArticles: null,
        vmcDays: null,
        productResearches: null,
      };
      setFirestoreReadings([]);
      setClimateLogs([]);
      setVmcDays([]);
      setProductResearches([]);
      setPublicClimateAutopilot(null);
      setHomeConfig({ ownerId: '', ...DEFAULT_HOME_CONFIG });
      setHomeArticlesLoaded(false);
      carPolicySeededRef.current = false;
      // homeArticles NON viene svuotato: la spesa è pubblica,
      // viene gestita dal listener publicOwnerUid qui sotto.
      setReadingsLoading(true);
      return;
    }

    rawSnapshotsRef.current = {
      uid: activeUid,
      energyReadings: null,
      homeConfig: null,
      climateLogs: null,
      electricityBills: null,
      waterBills: null,
      tariBills: null,
      gsePayments: null,
      homeArticles: null,
      vmcDays: null,
      productResearches: null,
    };

    setReadingsLoading(true);
    const readingsPath = `users/${activeUid}/energyReadings`;
    const readingsQuery = query(
      collection(db, readingsPath),
      where('ownerId', '==', activeUid)
    );

    const unsubReadings = onSnapshot(
      readingsQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.energyReadings = rawDocs;
        const baseFiltered = mapRawReadings(rawDocs, activeUid);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(readingsPath, rawDocs);
        setFirestoreReadings(mapRawReadings(mergedDocs, activeUid));
        if (!snap.metadata.fromCache) {
          setFirestoreFallbackNotice(null);
        }
        try {
          const serialized = JSON.stringify(baseFiltered);
          localStorage.setItem(`myhome_readings_cache_${activeUid}`, serialized);
          localStorage.setItem('myhome_readings_cache_last', serialized);
        } catch {
          // ignore storage quota
        }
        setReadingsLoading(false);
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          console.warn('Firestore unavailable/quota for energyReadings; using local cache.');
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale.'
          );
          const currentTodayIso = getLocalTodayIso();
          const byDate = new Map<string, EnergyReading>();
          try {
            const cached = localStorage.getItem(`myhome_readings_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as EnergyReading[];
              for (const r of parsed) {
                if (r?.date && r.date <= currentTodayIso) byDate.set(r.date, r);
              }
            }
          } catch {
            // ignore
          }
          const rawFallback: RawDocEntry[] = Array.from(byDate.values()).map((r) => ({
            id: r.id,
            data: { ...r },
          }));
          rawSnapshotsRef.current.energyReadings = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(readingsPath, rawFallback);
          setFirestoreReadings(mapRawReadings(mergedDocs, activeUid));
          setReadingsLoading(false);
          return;
        }
        handleFirestoreError(error, OperationType.LIST, readingsPath);
      }
    );

    const configCollectionPath = `users/${activeUid}/homeConfig`;
    const configPath = `${configCollectionPath}/main`;
    const unsubConfig = onSnapshot(
      doc(db, configPath),
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.exists()
          ? [{ id: 'main', data: snap.data() }]
          : [];
        rawSnapshotsRef.current.homeConfig = rawDocs;
        const baseCfg = mapRawHomeConfig(rawDocs, activeUid);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(configCollectionPath, rawDocs);
        setHomeConfig(mapRawHomeConfig(mergedDocs, activeUid));
        try {
          localStorage.setItem(`myhome_config_cache_${activeUid}`, JSON.stringify(baseCfg));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          console.warn('Firestore unavailable/quota for homeConfig; using local cache / defaults.');
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale e dei dati predefiniti.'
          );
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_config_cache_${activeUid}`);
            if (cached) {
              const parsedCfg = JSON.parse(cached) as HomeSystemConfig;
              rawFallback = [{ id: 'main', data: { ...parsedCfg } }];
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.homeConfig = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(configCollectionPath, rawFallback);
          setHomeConfig(mapRawHomeConfig(mergedDocs, activeUid));
          return;
        }
        handleFirestoreError(error, OperationType.GET, configPath);
      }
    );

    const climatePath = `users/${activeUid}/climateLogs`;
    const climateQuery = query(
      collection(db, climatePath),
      where('ownerId', '==', activeUid)
    );
    const unsubClimate = onSnapshot(
      climateQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.climateLogs = rawDocs;
        const baseList = mapRawClimateLogs(rawDocs, activeUid);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(climatePath, rawDocs);
        setClimateLogs(mapRawClimateLogs(mergedDocs, activeUid));
        try {
          localStorage.setItem(`myhome_climate_cache_${activeUid}`, JSON.stringify(baseList));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          console.warn('Firestore unavailable/quota for climateLogs; using local cache.');
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale e dei dati predefiniti.'
          );
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_climate_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as ClimateSession[];
              rawFallback = parsed.map((c) => ({ id: c.id, data: { ...c } }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.climateLogs = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(climatePath, rawFallback);
          setClimateLogs(mapRawClimateLogs(mergedDocs, activeUid));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, climatePath);
      }
    );

    const elecBillsPath = `users/${activeUid}/electricityBills`;
    const elecBillsQuery = query(
      collection(db, elecBillsPath),
      where('ownerId', '==', activeUid)
    );
    const unsubElecBills = onSnapshot(
      elecBillsQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.electricityBills = rawDocs;
        const baseList = mapRawElectricityBills(rawDocs);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(elecBillsPath, rawDocs);
        setElectricityBills(mapRawElectricityBills(mergedDocs));
        try {
          localStorage.setItem(`myhome_elec_bills_cache_${activeUid}`, JSON.stringify(baseList));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale.'
          );
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_elec_bills_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as BillRecord[];
              rawFallback = parsed.map((b, idx) => ({
                id: `manual_elec_${b.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '') || idx}`,
                data: { ...b },
              }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.electricityBills = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(elecBillsPath, rawFallback);
          setElectricityBills(mapRawElectricityBills(mergedDocs));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, elecBillsPath);
      }
    );

    const waterBillsPath = `users/${activeUid}/waterBills`;
    const waterBillsQuery = query(
      collection(db, waterBillsPath),
      where('ownerId', '==', activeUid)
    );
    const unsubWaterBills = onSnapshot(
      waterBillsQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.waterBills = rawDocs;
        const baseList = mapRawWaterBills(rawDocs);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(waterBillsPath, rawDocs);
        setWaterBills(mapRawWaterBills(mergedDocs));
        try {
          localStorage.setItem(`myhome_water_bills_cache_${activeUid}`, JSON.stringify(baseList));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale e dei dati predefiniti.'
          );
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_water_bills_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as WaterBillRecord[];
              rawFallback = parsed.map((w) => ({ id: w.id, data: { ...w } }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.waterBills = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(waterBillsPath, rawFallback);
          setWaterBills(mapRawWaterBills(mergedDocs));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, waterBillsPath);
      }
    );

    const tariBillsPath = `users/${activeUid}/tariBills`;
    const tariBillsQuery = query(
      collection(db, tariBillsPath),
      where('ownerId', '==', activeUid)
    );
    const unsubTariBills = onSnapshot(
      tariBillsQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.tariBills = rawDocs;
        const baseList = mapRawTariBills(rawDocs);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(tariBillsPath, rawDocs);
        setTariBills(mapRawTariBills(mergedDocs));
        try {
          localStorage.setItem(`myhome_tari_bills_cache_${activeUid}`, JSON.stringify(baseList));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale.'
          );
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_tari_bills_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as TariBillRecord[];
              rawFallback = parsed.map((t) => ({ id: t.id, data: { ...t } }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.tariBills = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(tariBillsPath, rawFallback);
          setTariBills(mapRawTariBills(mergedDocs));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, tariBillsPath);
      }
    );

    const gsePath = `users/${activeUid}/gsePayments`;
    const gseQuery = query(collection(db, gsePath), where('ownerId', '==', activeUid));
    const unsubGse = onSnapshot(
      gseQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.gsePayments = rawDocs;
        const baseList = mapRawGsePayments(rawDocs);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(gsePath, rawDocs);
        setGsePayments(mapRawGsePayments(mergedDocs));
        try {
          localStorage.setItem(`myhome_gse_payments_cache_${activeUid}`, JSON.stringify(baseList));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale e dei dati predefiniti.'
          );
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_gse_payments_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as GsePaymentRecord[];
              rawFallback = parsed.map((g) => ({ id: g.id, data: { ...g } }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.gsePayments = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(gsePath, rawFallback);
          setGsePayments(mapRawGsePayments(mergedDocs));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, gsePath);
      }
    );

    const articlesPath = `users/${activeUid}/homeArticles`;
    const articlesQuery = query(
      collection(db, articlesPath),
      where('ownerId', '==', activeUid)
    );
    const unsubArticles = onSnapshot(
      articlesQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.homeArticles = rawDocs;
        const baseList = mapRawHomeArticles(rawDocs);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(articlesPath, rawDocs);
        setHomeArticles(mapRawHomeArticles(mergedDocs));
        setHomeArticlesLoaded(true);
        try {
          localStorage.setItem(`myhome_articles_cache_${activeUid}`, JSON.stringify(baseList));
          localStorage.setItem(
            PUBLIC_GROCERY_CACHE_KEY,
            JSON.stringify(baseList.filter((item) => item.room === SYSTEM_ROOM_GROCERY))
          );
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale.'
          );
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_articles_cache_${activeUid}`);
            if (cached) {
              const articles = (JSON.parse(cached) as HomeArticleRecord[]).filter(
                (article) => article.id !== 'grocery_seed_v1_done'
              );
              rawFallback = articles.map((a) => ({ id: a.id, data: { ...a } }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.homeArticles = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(articlesPath, rawFallback);
          setHomeArticles(mapRawHomeArticles(mergedDocs));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, articlesPath);
      }
    );

    const vmcPath = `users/${activeUid}/vmcDays`;
    const vmcQuery = query(collection(db, vmcPath), where('ownerId', '==', activeUid));
    const unsubVmcDays = onSnapshot(
      vmcQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.vmcDays = rawDocs;
        const baseList = mapRawVmcDays(rawDocs, activeUid);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(vmcPath, rawDocs);
        setVmcDays(mapRawVmcDays(mergedDocs, activeUid));
        try {
          localStorage.setItem(`myhome_vmc_cache_${activeUid}`, JSON.stringify(baseList));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_vmc_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as VmcDayRecord[];
              rawFallback = parsed.map((v) => ({ id: v.id, data: { ...v } }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.vmcDays = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(vmcPath, rawFallback);
          setVmcDays(mapRawVmcDays(mergedDocs, activeUid));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, vmcPath);
      }
    );

    const researchesPath = `users/${activeUid}/productResearches`;
    const researchesQuery = query(
      collection(db, researchesPath),
      where('ownerId', '==', activeUid)
    );
    const unsubResearches = onSnapshot(
      researchesQuery,
      (snap) => {
        const rawDocs: RawDocEntry[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        rawSnapshotsRef.current.productResearches = rawDocs;
        const baseList = mapRawProductResearches(rawDocs, activeUid);
        const mergedDocs = mergeSimulatedOpsIntoRawDocs(researchesPath, rawDocs);
        setProductResearches(mapRawProductResearches(mergedDocs, activeUid));
        try {
          localStorage.setItem(`myhome_ricerche_cache_${activeUid}`, JSON.stringify(baseList));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          let rawFallback: RawDocEntry[] = [];
          try {
            const cached = localStorage.getItem(`myhome_ricerche_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as ProductResearchRecord[];
              rawFallback = parsed.map((r) => ({ id: r.id, data: { ...r } }));
            }
          } catch {
            // ignore
          }
          rawSnapshotsRef.current.productResearches = rawFallback;
          const mergedDocs = mergeSimulatedOpsIntoRawDocs(researchesPath, rawFallback);
          setProductResearches(mapRawProductResearches(mergedDocs, activeUid));
          return;
        }
        handleFirestoreError(error, OperationType.LIST, researchesPath);
      }
    );

    return () => {
      unsubReadings();
      unsubConfig();
      unsubClimate();
      unsubElecBills();
      unsubWaterBills();
      unsubTariBills();
      unsubGse();
      unsubArticles();
      unsubVmcDays();
      unsubResearches();
    };
  }, [authReady, activeUid, user]);

  // Recompute all state immediately whenever simulatedOps changes (add, discard, clear, flush)
  useEffect(() => {
    if (!authReady || !activeUid) return;
    const raw = rawSnapshotsRef.current;
    if (raw.uid !== activeUid) return;

    if (raw.energyReadings) {
      setFirestoreReadings(
        mapRawReadings(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/energyReadings`, raw.energyReadings),
          activeUid
        )
      );
    }
    if (raw.homeConfig) {
      setHomeConfig(
        mapRawHomeConfig(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/homeConfig`, raw.homeConfig),
          activeUid
        )
      );
    }
    if (raw.climateLogs) {
      setClimateLogs(
        mapRawClimateLogs(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/climateLogs`, raw.climateLogs),
          activeUid
        )
      );
    }
    if (raw.electricityBills) {
      setElectricityBills(
        mapRawElectricityBills(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/electricityBills`, raw.electricityBills)
        )
      );
    }
    if (raw.waterBills) {
      setWaterBills(
        mapRawWaterBills(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/waterBills`, raw.waterBills)
        )
      );
    }
    if (raw.tariBills) {
      setTariBills(
        mapRawTariBills(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/tariBills`, raw.tariBills)
        )
      );
    }
    if (raw.gsePayments) {
      setGsePayments(
        mapRawGsePayments(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/gsePayments`, raw.gsePayments)
        )
      );
    }
    if (raw.homeArticles) {
      setHomeArticles(
        mapRawHomeArticles(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/homeArticles`, raw.homeArticles)
        )
      );
    }
    if (raw.vmcDays) {
      setVmcDays(
        mapRawVmcDays(
          mergeSimulatedOpsIntoRawDocs(`users/${activeUid}/vmcDays`, raw.vmcDays),
          activeUid
        )
      );
    }
    if (raw.productResearches) {
      setProductResearches(
        mapRawProductResearches(
          mergeSimulatedOpsIntoRawDocs(
            `users/${activeUid}/productResearches`,
            raw.productResearches
          ),
          activeUid
        )
      );
    }
  }, [simulatedOps, authReady, activeUid]);

  useEffect(() => {
    if (!authReady || activeUid || !publicOwnerUid) return;

    setReadingsLoading(true);
    const readingsPath = `users/${publicOwnerUid}/energyReadings`;
    const readingsQuery = query(
      collection(db, readingsPath),
      where('ownerId', '==', publicOwnerUid)
    );
    const unsubReadings = onSnapshot(
      readingsQuery,
      (snap) => {
        const currentTodayIso = getLocalTodayIso();
        const list: EnergyReading[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || publicOwnerUid),
              date: String(data.date || ''),
              f1Kwh: Number(data.f1Kwh || 0),
              f2Kwh: Number(data.f2Kwh || 0),
              f3Kwh: Number(data.f3Kwh || 0),
              totalKwh: Number(data.totalKwh || 0),
              peakKw: Number(data.peakKw || 0),
              estimatedCostEur: Number(data.estimatedCostEur || 0),
              source: (data.source as ReadingSource) || 'e-distribuzione-api',
              notes: data.notes ? String(data.notes) : undefined,
            };
          })
          .filter((reading) => reading.date && reading.date <= currentTodayIso);
        setFirestoreReadings(list);
        setReadingsLoading(false);
      },
      (error) => {
        setReadingsLoading(false);
        handleFirestoreError(error, OperationType.LIST, readingsPath);
      }
    );

    const climatePath = `users/${publicOwnerUid}/climateLogs`;
    const climateQuery = query(
      collection(db, climatePath),
      where('ownerId', '==', publicOwnerUid)
    );
    const unsubClimate = onSnapshot(
      climateQuery,
      (snap) => {
        const list: ClimateSession[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || publicOwnerUid),
            date: String(data.date || ''),
            mode: (data.mode as ClimateMode) || 'riscaldamento',
            startTime: String(data.startTime || '09:00'),
            endTime: String(data.endTime || '20:00'),
            timeSlots: Array.isArray(data.timeSlots)
              ? data.timeSlots.map((s) => String(s))
              : undefined,
            vmcMax: typeof data.vmcMax === 'boolean' ? data.vmcMax : undefined,
            targetTemp: typeof data.targetTemp === 'number' ? data.targetTemp : 21,
            rooms: Array.isArray(data.rooms) ? (data.rooms as RoomId[]) : [],
            notes: data.notes ? String(data.notes) : undefined,
          };
        });
        setClimateLogs(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, climatePath);
      }
    );

    const autopilotPath =
      `users/${publicOwnerUid}/homeArticles/${CLIMATE_AUTOPILOT_DOC_ID}`;
    const unsubAutopilot = onSnapshot(
      doc(db, autopilotPath),
      (snap) => {
        if (!snap.exists()) {
          setPublicClimateAutopilot(null);
          return;
        }
        const data = snap.data();
        setPublicClimateAutopilot(
          articleToClimateAutopilot({
            id: snap.id,
            name: String(data.name || ''),
            brand: String(data.brand || ''),
            model: String(data.model || ''),
            category: (data.category as HomeArticleCategory) || 'clima',
            room: String(data.room || SYSTEM_ROOM_CLIMATE_AUTO),
            purchaseDate: data.purchaseDate ? String(data.purchaseDate) : undefined,
            warrantyEnd: data.warrantyEnd ? String(data.warrantyEnd) : undefined,
            familyWarranty: Boolean(data.familyWarranty),
            serialNumber: data.serialNumber ? String(data.serialNumber) : undefined,
            specs: data.specs ? String(data.specs) : undefined,
            notes: data.notes ? String(data.notes) : undefined,
          })
        );
      },
      (error) => {
        setPublicClimateAutopilot(null);
        handleFirestoreError(error, OperationType.GET, autopilotPath);
      }
    );

    const publicGroceryPath = `users/${publicOwnerUid}/homeArticles`;
    const publicGroceryQuery = query(
      collection(db, publicGroceryPath),
      where('room', '==', SYSTEM_ROOM_GROCERY)
    );
    const unsubPublicGroceries = onSnapshot(
      publicGroceryQuery,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name || ''),
            brand: String(data.brand || ''),
            model: String(data.model || ''),
            category: (data.category as HomeArticleCategory) || 'altro',
            room: SYSTEM_ROOM_GROCERY,
            familyWarranty: Boolean(data.familyWarranty),
            specs: data.specs ? String(data.specs) : undefined,
            notes: data.notes ? String(data.notes) : undefined,
          };
        });
        setHomeArticles(list);
        try {
          localStorage.setItem(PUBLIC_GROCERY_CACHE_KEY, JSON.stringify(list));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          try {
            const cached = localStorage.getItem(PUBLIC_GROCERY_CACHE_KEY);
            if (cached) setHomeArticles(JSON.parse(cached) as HomeArticleRecord[]);
          } catch {
            // ignore
          }
          return;
        }
        handleFirestoreError(error, OperationType.LIST, publicGroceryPath);
      }
    );

    const publicElectricityBillsPath = `users/${publicOwnerUid}/electricityBills`;
    const publicElectricityBillsQuery = query(
      collection(db, publicElectricityBillsPath),
      where('ownerId', '==', publicOwnerUid)
    );
    const unsubPublicElectricityBills = onSnapshot(
      publicElectricityBillsQuery,
      (snap) => {
        setElectricityBills(
          snap.docs
            .map((d) => {
              const data = d.data();
              return {
                invoiceNumber: String(data.invoiceNumber || ''),
                issueDate: String(data.issueDate || ''),
                sortKey: String(data.sortKey || ''),
                year: Number(data.year || 2025),
                period: String(data.period || ''),
                supplier: String(data.supplier || ''),
                offerName: String(data.offerName || ''),
                kwh: Number(data.kwh || 0),
                punText: String(data.punText || ''),
                variableCostPerKwh: Number(data.variableCostPerKwh || 0),
                canoneTv: Number(data.canoneTv || 0),
                electricityOnly: Number(data.electricityOnly || 0),
                totalPaid: Number(data.totalPaid || 0),
                note: data.note ? String(data.note) : undefined,
                pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : '',
              };
            })
            .filter((b) => Boolean(b.pdfFileKey))
        );
      },
      (error) => {
        console.warn('Public electricityBills listener warning:', error);
      }
    );

    const publicWaterBillsPath = `users/${publicOwnerUid}/waterBills`;
    const publicWaterBillsQuery = query(
      collection(db, publicWaterBillsPath),
      where('ownerId', '==', publicOwnerUid)
    );
    const unsubPublicWaterBills = onSnapshot(
      publicWaterBillsQuery,
      (snap) => {
        setWaterBills(
          snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                invoiceNumber: String(data.invoiceNumber || ''),
                issueDate: String(data.issueDate || ''),
                year: Number(data.year || 2025),
                period: String(data.period || ''),
                cubicMeters: Number(data.cubicMeters || 0),
                fixedCostEur: Number(data.fixedCostEur || 0),
                totalPaid: Number(data.totalPaid || 0),
                note: data.note ? String(data.note) : undefined,
                pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : '',
              };
            })
            .filter((b) => Boolean(b.pdfFileKey))
        );
      },
      (error) => {
        console.warn('Public waterBills listener warning:', error);
      }
    );

    const publicTariBillsPath = `users/${publicOwnerUid}/tariBills`;
    const publicTariBillsQuery = query(
      collection(db, publicTariBillsPath),
      where('ownerId', '==', publicOwnerUid)
    );
    const unsubPublicTariBills = onSnapshot(
      publicTariBillsQuery,
      (snap) => {
        setTariBills(
          snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                noticeNumber: String(data.noticeNumber || ''),
                issueDate: String(data.issueDate || ''),
                dueDate: String(data.dueDate || ''),
                year: Number(data.year || new Date().getFullYear()),
                period: String(data.period || ''),
                supplier: String(data.supplier || 'AcegasApsAmga / TARI'),
                totalPaid: Number(data.totalPaid || 0),
                paid: Boolean(data.paid),
                source: data.source === 'gmail-pdf' ? ('gmail-pdf' as const) : ('manuale' as const),
                note: data.note ? String(data.note) : undefined,
                pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : '',
              };
            })
            .filter((b) => Boolean(b.pdfFileKey))
        );
      },
      (error) => {
        console.warn('Public tariBills listener warning:', error);
      }
    );

    const publicVmcPath = `users/${publicOwnerUid}/vmcDays`;
    const publicVmcQuery = query(
      collection(db, publicVmcPath),
      where('ownerId', '==', publicOwnerUid)
    );
    const unsubPublicVmcDays = onSnapshot(
      publicVmcQuery,
      (snap) => {
        setVmcDays(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || publicOwnerUid),
              date: String(data.date || ''),
              enabled: Boolean(data.enabled),
              note: data.note ? String(data.note) : undefined,
            };
          })
        );
      },
      (error) => {
        console.warn('Public vmcDays listener warning:', error);
      }
    );

    const publicResearchesPath = `users/${publicOwnerUid}/productResearches`;
    const publicResearchesQuery = query(
      collection(db, publicResearchesPath),
      where('ownerId', '==', publicOwnerUid)
    );
    const unsubPublicResearches = onSnapshot(
      publicResearchesQuery,
      (snap) => {
        setProductResearches(
          snap.docs.map((d) => {
            const data = d.data();
            const createdTs = data.createdAt as { toMillis?: () => number } | undefined;
            const urlStr = String(data.url || '');
            const titleStr = String(data.title || '');
            const normalizedStatus = normalizeResearchStatus(data.status);
            return {
              id: d.id,
              ownerId: String(data.ownerId || publicOwnerUid),
              url: urlStr,
              title: titleStr,
              store: String(data.store || ''),
              category: (data.category as ProductResearchCategory) || 'altro',
              status: normalizedStatus,
              room: resolveResearchRoomWithFallback(
                d.id,
                urlStr,
                data.room ? String(data.room) : undefined,
                titleStr
              ),
              priceEur: typeof data.priceEur === 'number' ? Number(data.priceEur) : undefined,
              paidPriceEur:
                normalizedStatus === 'acquistato' && typeof data.paidPriceEur === 'number'
                  ? Number(data.paidPriceEur)
                  : undefined,
              imageUrl: data.imageUrl ? String(data.imageUrl) : undefined,
              brand: data.brand ? String(data.brand) : undefined,
              color: data.color ? String(data.color) : undefined,
              availableColors: Array.isArray(data.availableColors)
                ? data.availableColors.map((c) => String(c).trim()).filter(Boolean).slice(0, 24)
                : undefined,
              colorImages: sanitizeColorImagesMap(data.colorImages),
              size: data.size ? String(data.size) : undefined,
              availableSizes: Array.isArray(data.availableSizes)
                ? data.availableSizes.map((s) => String(s).trim()).filter(Boolean).slice(0, 24)
                : undefined,
              model: data.model ? String(data.model) : undefined,
              specs: data.specs ? String(data.specs) : undefined,
              notes: data.notes ? String(data.notes) : undefined,
              createdAtMs: typeof createdTs?.toMillis === 'function' ? createdTs.toMillis() : 0,
            };
          })
        );
      },
      (error) => {
        console.warn('Public productResearches listener warning:', error);
      }
    );

    return () => {
      unsubReadings();
      unsubClimate();
      unsubAutopilot();
      unsubPublicGroceries();
      unsubPublicElectricityBills();
      unsubPublicWaterBills();
      unsubPublicTariBills();
      unsubPublicVmcDays();
      unsubPublicResearches();
    };
  }, [authReady, activeUid, publicOwnerUid]);

  const readings = useMemo(
    () => firestoreReadings.filter((r) => r.date && r.date <= todayIso),
    [firestoreReadings, todayIso]
  );

  async function handleRunLegacyMigration() {
    if (!user || migratingDb) return;
    setMigratingDb(true);
    setAuthError(null);
    setMigrationProgress('Avvio migrazione...');
    try {
      const res = await migrateFromLegacyProject(user.uid, (msg) =>
        setMigrationProgress(msg)
      );
      setGmailNotice({
        tone: 'ok',
        text: `Migrazione completata su gen-lang-client-0721850501: importati ${res.totalDocs} documenti${res.githubExtraReadings > 0 ? ` (+${res.githubExtraReadings} giorni recenti)` : ''}${res.githubExtraBills > 0 ? ` (+${res.githubExtraBills} bollette recenti)` : ''}.`,
      });
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? `Migrazione non completata: ${err.message}`
          : 'Migrazione dal vecchio database non completata.'
      );
    } finally {
      setMigratingDb(false);
      setMigrationProgress(null);
    }
  }

  async function handleImportCsv(items: ParsedReadingInput[]) {
    if (!user || items.length === 0) return;
    const basePath = `users/${user.uid}/energyReadings`;
    try {
      // Chunk into batches of 400 to stay safely below Firestore's 500-op limit
      for (let i = 0; i < items.length; i += 400) {
        const chunk = items.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const item of chunk) {
          const docId = `day_${item.date.replace(/-/g, '')}`;
          const estimatedCostEur =
            Math.round(item.totalKwh * homeConfig.tariffEurPerKwh * 100) / 100;
          const payload: Record<string, unknown> = {
            ownerId: user.uid,
            date: item.date,
            f1Kwh: item.f1Kwh,
            f2Kwh: item.f2Kwh,
            f3Kwh: item.f3Kwh,
            totalKwh: item.totalKwh,
            peakKw: item.peakKw,
            estimatedCostEur,
            source: 'e-distribuzione-csv',
            createdAt: serverTimestamp(),
          };
          if (item.notes) {
            payload.notes = item.notes.slice(0, 240);
          }
          batch.set(doc(db, basePath, docId), payload);
        }
        await batch.commit();
      }
      if (isFirestoreWritesDisabled()) {
        setFirestoreReadings((prev) => {
          const map = new Map(prev.map((r) => [r.date, r]));
          for (const item of items) {
            const docId = `day_${item.date.replace(/-/g, '')}`;
            map.set(item.date, {
              id: docId,
              ownerId: user.uid,
              date: item.date,
              f1Kwh: item.f1Kwh,
              f2Kwh: item.f2Kwh,
              f3Kwh: item.f3Kwh,
              totalKwh: item.totalKwh,
              peakKw: item.peakKw,
              estimatedCostEur:
                Math.round(item.totalKwh * homeConfig.tariffEurPerKwh * 100) / 100,
              source: 'e-distribuzione-csv',
              notes: item.notes ? item.notes.slice(0, 240) : undefined,
            });
          }
          return Array.from(map.values());
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, basePath);
    }
  }

  async function handleClearAllReadings() {
    if (!user || firestoreReadings.length === 0) return;
    const basePath = `users/${user.uid}/energyReadings`;
    try {
      for (let i = 0; i < firestoreReadings.length; i += 400) {
        const chunk = firestoreReadings.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const r of chunk) {
          batch.delete(doc(db, basePath, r.id));
        }
        await batch.commit();
      }
      if (isFirestoreWritesDisabled()) {
        setFirestoreReadings([]);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, basePath);
    }
  }



  function formatFirebaseAuthError(err: unknown, mode: 'primary' | 'gmail'): string {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    const message = err instanceof Error ? err.message : String(err ?? '');
    const host =
      typeof window !== 'undefined' && window.location?.hostname
        ? window.location.hostname
        : 'questo dominio';
    const projectId = mode === 'gmail' ? GMAIL_OAUTH_PROJECT_ID : FIREBASE_PROJECT_ID;

    if (code === 'auth/unauthorized-domain' || message.includes('auth/unauthorized-domain')) {
      return `Dominio "${host}" non autorizzato su Firebase Authentication (progetto ${projectId}). Aggiungi "${host}" in Firebase Console -> ${projectId} -> Authentication -> Settings -> Authorized domains.`;
    }
    if (code === 'auth/popup-blocked' || message.includes('auth/popup-blocked')) {
      return `Popup bloccato da Chrome per "${host}". Consenti i popup per questo sito e riprova.`;
    }
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      message.includes('popup-closed-by-user')
    ) {
      return mode === 'gmail'
        ? 'Finestra di autorizzazione Gmail chiusa prima del completamento.'
        : 'Finestra di accesso Google chiusa prima del completamento.';
    }
    if (message) return message;
    return mode === 'gmail'
      ? 'Autorizzazione Gmail non completata.'
      : 'Accesso Google non completato.';
  }

  async function handleSignIn() {
    setAuthError(null);
    try {
      await signInPrimaryOwner();
    } catch (err) {
      setAuthError(formatFirebaseAuthError(err, 'primary'));
    }
  }

  const latestReadingsRef = useRef<EnergyReading[]>(firestoreReadings);
  const latestElecBillsRef = useRef<BillRecord[]>(electricityBills);
  const latestWaterBillsRef = useRef<WaterBillRecord[]>(waterBills);
  const latestTariBillsRef = useRef<TariBillRecord[]>(tariBills);

  useEffect(() => {
    latestReadingsRef.current = firestoreReadings;
  }, [firestoreReadings]);

  useEffect(() => {
    latestElecBillsRef.current = electricityBills;
  }, [electricityBills]);

  useEffect(() => {
    latestWaterBillsRef.current = waterBills;
  }, [waterBills]);

  useEffect(() => {
    latestTariBillsRef.current = tariBills;
  }, [tariBills]);

  const runGmailSyncWithToken = useCallback(
    async (currentUser: User, token: string, isAuto = false) => {
      if (gmailSyncInFlightRef.current) return;
      gmailSyncInFlightRef.current = true;
      setGmailSyncing(true);
      if (!isAuto) setGmailNotice(null);

      try {
        const existingReadingDates = new Set(
          latestReadingsRef.current
            .map((r) => r.date)
            .filter((d): d is string => Boolean(d))
        );
        const maxExistingDate = latestReadingsRef.current.reduce(
          (max, r) => (r.date && r.date > max ? r.date : max),
          ''
        );
        const existingElectricityInvoices = new Set(
          latestElecBillsRef.current
            .filter((b) => Boolean(b.pdfFileKey) && Boolean(b.invoiceNumber))
            .map((b) => b.invoiceNumber.trim())
        );
        const existingWaterInvoices = new Set(
          latestWaterBillsRef.current
            .filter((b) => Boolean(b.pdfFileKey) && Boolean(b.invoiceNumber))
            .map((b) => b.invoiceNumber.trim())
        );
        const existingTariNotices = new Set(
          latestTariBillsRef.current
            .filter((b) => Boolean(b.pdfFileKey) && Boolean(b.noticeNumber))
            .map((b) => b.noticeNumber.trim())
        );

        const scan = await scanGmailInbox(token, {
          minReadingDateExclusive: maxExistingDate || undefined,
          existingReadingDates,
          existingElectricityInvoices,
          existingWaterInvoices,
          existingTariNotices,
        });

        if (
          scan.readings.length === 0 &&
          scan.electricityBills.length === 0 &&
          scan.waterBills.length === 0 &&
          scan.tariBills.length === 0 &&
          scan.pdfAttachments.length === 0
        ) {
          if (!isAuto) {
            setGmailNotice({
              tone: 'info',
              text:
                scan.ignoredReadingsCount > 0 && maxExistingDate
                  ? `INBOX Gmail controllata: nessun nuovo consumo dopo il ${maxExistingDate} (ignorate ${scan.ignoredReadingsCount} giornate già presenti su Firestore, 0 scritture DB).`
                  : 'INBOX Gmail controllata: nessuna nuova email di consumi o bollette da importare.',
            });
          }
          return;
        }

        const availablePdfKeys = new Set(scan.pdfAttachments.map((attachment) => attachment.key));
        const billPdfKeys = [
          ...scan.electricityBills.map((bill) => getElectricityBillFileKey(bill.invoiceNumber)),
          ...scan.waterBills.map((bill) => getWaterBillFileKey(bill.invoiceNumber)),
          ...scan.tariBills.map((bill) => getTariBillFileKey(bill.noticeNumber)),
        ];
        if (billPdfKeys.some((key) => !availablePdfKeys.has(key))) {
          throw new Error('Una o più bollette non hanno il PDF originale: non sono state importate.');
        }

        // Archive original PDF binaries on Firestore (chunked, 0 AI credits) + local cache
        if (scan.pdfAttachments.length > 0) {
          try {
            for (const pdfAtt of scan.pdfAttachments) {
              const pdfBlob = new Blob([new Uint8Array(pdfAtt.bytes)], {
                type: pdfAtt.mimeType || 'application/pdf',
              });
              const saved = await saveVaultFile(
                pdfAtt.key,
                pdfBlob,
                pdfAtt.fileName,
                pdfAtt.mimeType || 'application/pdf',
                currentUser.uid
              );
              if (!saved.cloudSynced) {
                throw new Error(
                  saved.cloudTooLarge
                    ? `Il PDF "${pdfAtt.fileName}" supera il limite Firebase e la bolletta non è stata importata.`
                    : `Il PDF "${pdfAtt.fileName}" non è stato salvato su Firebase; la bolletta non è stata importata.`
                );
              }
            }
          } catch (error) {
            await deleteVaultFiles(
              scan.pdfAttachments.map((attachment) => attachment.key),
              currentUser.uid
            );
            throw error;
          }
        }

        // 1. Save energy readings to Firestore in <=400-op batches
        if (scan.readings.length > 0) {
          const basePath = `users/${currentUser.uid}/energyReadings`;
          for (let i = 0; i < scan.readings.length; i += 400) {
            const chunk = scan.readings.slice(i, i + 400);
            const batch = writeBatch(db);
            for (const item of chunk) {
              const docId = `day_${item.date.replace(/-/g, '')}`;
              const estimatedCostEur =
                Math.round(item.totalKwh * homeConfig.tariffEurPerKwh * 100) / 100;
              const payload: Record<string, unknown> = {
                ownerId: currentUser.uid,
                date: item.date.slice(0, 20),
                f1Kwh: item.f1Kwh,
                f2Kwh: item.f2Kwh,
                f3Kwh: item.f3Kwh,
                totalKwh: item.totalKwh,
                peakKw: item.peakKw,
                estimatedCostEur,
                source: 'e-distribuzione-api',
                createdAt: serverTimestamp(),
              };
              if (item.notes) {
                payload.notes = item.notes.slice(0, 240);
              }
              batch.set(doc(db, basePath, docId), payload);
            }
            await batch.commit();
          }
        }

        // 2. Save electricity bills to Firestore
        if (scan.electricityBills.length > 0) {
          const elecPath = `users/${currentUser.uid}/electricityBills`;
          const batch = writeBatch(db);
          for (const b of scan.electricityBills) {
            const cleanInv = b.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
            const docId = `edison_${cleanInv || Date.now()}`;
            const payload: Record<string, unknown> = {
              ownerId: currentUser.uid,
              invoiceNumber: b.invoiceNumber.slice(0, 40),
              pdfFileKey: getElectricityBillFileKey(b.invoiceNumber),
              issueDate: b.issueDate.slice(0, 20),
              sortKey: b.sortKey.slice(0, 16),
              year: Number(b.year),
              period: b.period.slice(0, 80),
              supplier: b.supplier.slice(0, 80),
              offerName: b.offerName.slice(0, 100),
              kwh: Number(b.kwh),
              punText: b.punText.slice(0, 60),
              variableCostPerKwh: Number(b.variableCostPerKwh),
              canoneTv: Number(b.canoneTv),
              electricityOnly: Number(b.electricityOnly),
              totalPaid: Number(b.totalPaid),
              createdAt: serverTimestamp(),
            };
            if (b.note) payload.note = b.note.slice(0, 240);
            batch.set(doc(db, elecPath, docId), payload);
          }
          await batch.commit();
        }

        // 3. Save water bills to Firestore
        if (scan.waterBills.length > 0) {
          const waterPath = `users/${currentUser.uid}/waterBills`;
          const batch = writeBatch(db);
          for (const w of scan.waterBills) {
            const cleanInv = w.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
            const docId = `acegas_${cleanInv || Date.now()}`;
            const payload: Record<string, unknown> = {
              ownerId: currentUser.uid,
              invoiceNumber: w.invoiceNumber.slice(0, 40),
              pdfFileKey: getWaterBillFileKey(w.invoiceNumber),
              issueDate: w.issueDate.slice(0, 20),
              year: Number(w.year),
              period: w.period.slice(0, 80),
              cubicMeters: Number(w.cubicMeters),
              fixedCostEur: Number(w.fixedCostEur),
              totalPaid: Number(w.totalPaid),
              createdAt: serverTimestamp(),
            };
            if (w.note) payload.note = w.note.slice(0, 240);
            batch.set(doc(db, waterPath, docId), payload);
          }
          await batch.commit();
        }

        // 4. Save TARI bills to Firestore
        if (scan.tariBills.length > 0) {
          const tariPath = `users/${currentUser.uid}/tariBills`;
          const batch = writeBatch(db);
          for (const t of scan.tariBills) {
            const cleanNotice = t.noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '');
            const docId = `tari_${cleanNotice || Date.now()}`;
            const payload: Record<string, unknown> = {
              ownerId: currentUser.uid,
              noticeNumber: t.noticeNumber.slice(0, 50),
              pdfFileKey: getTariBillFileKey(t.noticeNumber),
              issueDate: (t.issueDate || t.dueDate || '—').slice(0, 20),
              dueDate: (t.dueDate || t.issueDate || '—').slice(0, 20),
              year: Number(t.year),
              period: t.period.slice(0, 80),
              supplier: t.supplier.slice(0, 80),
              totalPaid: Number(t.totalPaid),
              paid: Boolean(t.paid),
              source: 'gmail-pdf',
              createdAt: serverTimestamp(),
            };
            if (t.note) payload.note = t.note.slice(0, 240);
            batch.set(doc(db, tariPath, docId), payload);
          }
          await batch.commit();
        }

        const savedParts: string[] = [];
        if (scan.readings.length > 0) savedParts.push(`${scan.readings.length} giorni consumi`);
        if (scan.electricityBills.length > 0) {
          savedParts.push(`${scan.electricityBills.length} bollette luce`);
        }
        if (scan.waterBills.length > 0) {
          savedParts.push(`${scan.waterBills.length} bollette acqua`);
        }
        if (scan.tariBills.length > 0) savedParts.push(`${scan.tariBills.length} avvisi TARI`);
        if (scan.pdfAttachments.length > 0) {
          savedParts.push(`${scan.pdfAttachments.length} PDF archiviati`);
        }

        const skippedNote =
          scan.ignoredReadingsCount > 0 && maxExistingDate
            ? ` (ignorati ${scan.ignoredReadingsCount} giorni già salvati fino al ${maxExistingDate})`
            : '';

        if (isFirestoreWritesDisabled()) {
          if (scan.readings.length > 0) {
            setFirestoreReadings((prev) => {
              const map = new Map(prev.map((r) => [r.date, r]));
              for (const item of scan.readings) {
                map.set(item.date, {
                  id: `day_${item.date.replace(/-/g, '')}`,
                  ownerId: currentUser.uid,
                  date: item.date.slice(0, 20),
                  f1Kwh: item.f1Kwh,
                  f2Kwh: item.f2Kwh,
                  f3Kwh: item.f3Kwh,
                  totalKwh: item.totalKwh,
                  peakKw: item.peakKw,
                  estimatedCostEur:
                    Math.round(item.totalKwh * homeConfig.tariffEurPerKwh * 100) / 100,
                  source: 'e-distribuzione-api',
                  notes: item.notes ? item.notes.slice(0, 240) : undefined,
                });
              }
              return Array.from(map.values());
            });
          }
          if (scan.electricityBills.length > 0) {
            setElectricityBills((prev) => [
              ...prev,
              ...scan.electricityBills.map((b) => ({
                ...b,
                pdfFileKey: getElectricityBillFileKey(b.invoiceNumber),
              })),
            ]);
          }
          if (scan.waterBills.length > 0) {
            setWaterBills((prev) => [
              ...prev,
              ...scan.waterBills.map((w) => ({
                ...w,
                id: `acegas_${w.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '') || Date.now()}`,
                pdfFileKey: getWaterBillFileKey(w.invoiceNumber),
              })),
            ]);
          }
          if (scan.tariBills.length > 0) {
            setTariBills((prev) => [
              ...prev,
              ...scan.tariBills.map((t) => ({
                ...t,
                id: `tari_${t.noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '') || Date.now()}`,
                pdfFileKey: getTariBillFileKey(t.noticeNumber),
              })),
            ]);
          }
          setGmailNotice({
            tone: 'info',
            text: `Modalità Test attiva — simulati in locale: ${savedParts.join(', ')}${skippedNote} (0 scritture su Firestore).`,
          });
        } else {
          setGmailNotice({
            tone: 'ok',
            text: `Dati salvati: ${savedParts.join(', ')}${skippedNote}.`,
          });

          const toPrompt = scan.processedMessages.filter(
            (m) => !m.isBill && !skippedTrashIdsRef.current.has(m.id)
          );
          if (toPrompt.length > 0) {
            setPendingTrashMessages(toPrompt);
          }
        }
      } catch (err) {
        if (err instanceof GmailAuthExpiredError) {
          clearGmailAccessToken();
          setGmailToken(null);
          setGmailNotice({
            tone: 'warn',
            text: 'Sessione Gmail scaduta: clicca "Sincronizza Gmail" per ricollegare la casella.',
          });
        } else {
          setGmailNotice({
            tone: 'warn',
            text:
              err instanceof Error
                ? `Errore sincronizzazione Gmail: ${err.message}`
                : 'Errore durante la sincronizzazione Gmail.',
          });
        }
      } finally {
        gmailSyncInFlightRef.current = false;
        setGmailSyncing(false);
      }
    },
    [homeConfig.tariffEurPerKwh]
  );

  async function handleManualGmailSync() {
    setAuthError(null);
    let activeUser = user;
    if (!activeUser) {
      try {
        activeUser = await signInPrimaryOwner();
      } catch (err) {
        setAuthError(formatFirebaseAuthError(err, 'primary'));
        return;
      }
    }

    let token = gmailToken || getGmailAccessToken();
    if (!token) {
      try {
        token = await connectGmailAccount();
        if (token) setGmailToken(token);
      } catch (err) {
        setAuthError(formatFirebaseAuthError(err, 'gmail'));
        return;
      }
    }

    if (!activeUser || !token) {
      setGmailNotice({
        tone: 'warn',
        text: 'Accesso Gmail non ottenuto: riprova a collegare la casella.',
      });
      return;
    }

    await runGmailSyncWithToken(activeUser, token, false);
  }

  async function handleConfirmTrashMessages() {
    const token = gmailToken || getGmailAccessToken();
    if (!token || pendingTrashMessages.length === 0) {
      setPendingTrashMessages([]);
      return;
    }
    setTrashingEmails(true);
    try {
      const count = await trashGmailMessages(
        token,
        pendingTrashMessages.map((m) => m.id)
      );
      setPendingTrashMessages([]);
      setGmailNotice({
        tone: 'ok',
        text: `Spostate ${count} email nel Cestino di Gmail dopo il salvataggio su Firestore.`,
      });
    } catch (err) {
      if (err instanceof GmailAuthExpiredError) {
        clearGmailAccessToken();
        setGmailToken(null);
      }
      setGmailNotice({
        tone: 'warn',
        text:
          err instanceof Error
            ? `Impossibile spostare nel Cestino: ${err.message}`
            : 'Errore spostamento email nel Cestino.',
      });
    } finally {
      setTrashingEmails(false);
    }
  }

  function handleKeepMessagesInInbox() {
    for (const m of pendingTrashMessages) {
      skippedTrashIdsRef.current.add(m.id);
    }
    setPendingTrashMessages([]);
  }

  // Periodic automatic Gmail INBOX scan while user & Gmail token are active
  useEffect(() => {
    if (!user || !gmailToken || !appSettings.autoGmailSyncEnabled) return;
    const intervalMs = appSettings.autoGmailSyncIntervalMinutes * 60 * 1000;
    const intervalId = window.setInterval(() => {
      void runGmailSyncWithToken(user, gmailToken, true);
    }, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [
    user,
    gmailToken,
    appSettings.autoGmailSyncEnabled,
    appSettings.autoGmailSyncIntervalMinutes,
    runGmailSyncWithToken,
  ]);

  async function handleAddClimateLog(
    session: Omit<ClimateSession, 'id' | 'ownerId'>
  ) {
    if (!user) return;
    const basePath = `users/${user.uid}/climateLogs`;
    const docId = `log_${session.date.replace(/-/g, '')}_${Date.now()}`;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      date: session.date,
      mode: session.mode,
      startTime: session.startTime,
      endTime: session.endTime,
      vmcMax: Boolean(session.vmcMax),
      targetTemp: session.targetTemp,
      rooms: session.rooms,
      createdAt: serverTimestamp(),
    };
    if (Array.isArray(session.timeSlots) && session.timeSlots.length > 1) {
      payload.timeSlots = session.timeSlots.slice(0, 6);
    }
    if (session.notes) {
      payload.notes = session.notes.slice(0, 240);
    }
    try {
      const batch = writeBatch(db);
      setSimulatedOpDetailHint(`${basePath}/${docId}`, {
        title: `${session.mode} · ${session.date}`,
        actionLabel: 'Nuova sessione',
        changedFields: ['__new__'],
        changedDetails: [
          `Modalità: ${session.mode}`,
          `Orario: ${session.startTime}–${session.endTime}`,
          `Target: ${session.targetTemp}°C`,
        ],
      });
      batch.set(doc(db, basePath, docId), payload);
      if (typeof session.vmcMax === 'boolean') {
        const vmcDocId = `vmc_${session.date.replace(/-/g, '')}`;
        batch.set(doc(db, `users/${user.uid}/vmcDays`, vmcDocId), {
          ownerId: user.uid,
          date: session.date,
          enabled: Boolean(session.vmcMax),
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      if (isFirestoreWritesDisabled()) {
        setClimateLogs((prev) => [
          ...prev,
          {
            id: docId,
            ownerId: user.uid,
            ...session,
          },
        ]);
        if (typeof session.vmcMax === 'boolean') {
          const vmcDocId = `vmc_${session.date.replace(/-/g, '')}`;
          setVmcDays((prev) => {
            const filtered = prev.filter((v) => v.date !== session.date);
            return [
              ...filtered,
              { id: vmcDocId, ownerId: user.uid, date: session.date, enabled: Boolean(session.vmcMax) },
            ];
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
    }
  }

  async function handleUpdateClimateLog(
    id: string,
    session: Omit<ClimateSession, 'id' | 'ownerId'>
  ) {
    if (!user) return;
    const path = `users/${user.uid}/climateLogs/${id}`;
    const prevLog = climateLogs.find((l) => l.id === id);
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      date: session.date,
      mode: session.mode,
      startTime: session.startTime,
      endTime: session.endTime,
      timeSlots:
        Array.isArray(session.timeSlots) && session.timeSlots.length > 1
          ? session.timeSlots.slice(0, 6)
          : deleteField(),
      vmcMax: Boolean(session.vmcMax),
      targetTemp: session.targetTemp,
      rooms: session.rooms,
      notes: session.notes ? session.notes.slice(0, 240) : '',
    };
    const climateDetails: string[] = [];
    const climateFields: string[] = [];
    if (prevLog) {
      if (prevLog.mode !== session.mode) {
        climateFields.push('mode');
        climateDetails.push(`Modalità: ${prevLog.mode} → ${session.mode}`);
      }
      if (prevLog.startTime !== session.startTime || prevLog.endTime !== session.endTime) {
        climateFields.push('time');
        climateDetails.push(`Orario: ${session.startTime}–${session.endTime}`);
      }
      if (prevLog.targetTemp !== session.targetTemp) {
        climateFields.push('targetTemp');
        climateDetails.push(`Target: ${prevLog.targetTemp}°C → ${session.targetTemp}°C`);
      }
      if (Boolean(prevLog.vmcMax) !== Boolean(session.vmcMax)) {
        climateFields.push('vmcMax');
        climateDetails.push(`VMC Max: ${session.vmcMax ? 'Attiva' : 'Spenta'}`);
      }
    }
    try {
      const batch = writeBatch(db);
      setSimulatedOpDetailHint(path, {
        title: `${session.mode} · ${session.date}`,
        actionLabel: 'Modifica',
        changedFields: climateFields.length > 0 ? climateFields : undefined,
        changedDetails: climateDetails.length > 0 ? climateDetails : undefined,
      });
      batch.set(doc(db, path), payload, { merge: true });
      if (typeof session.vmcMax === 'boolean') {
        const vmcDocId = `vmc_${session.date.replace(/-/g, '')}`;
        batch.set(doc(db, `users/${user.uid}/vmcDays`, vmcDocId), {
          ownerId: user.uid,
          date: session.date,
          enabled: Boolean(session.vmcMax),
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      if (isFirestoreWritesDisabled()) {
        setClimateLogs((prev) =>
          prev.map((log) => (log.id === id ? { ...log, ...session } : log))
        );
        if (typeof session.vmcMax === 'boolean') {
          const vmcDocId = `vmc_${session.date.replace(/-/g, '')}`;
          setVmcDays((prev) => {
            const filtered = prev.filter((v) => v.date !== session.date);
            return [
              ...filtered,
              { id: vmcDocId, ownerId: user.uid, date: session.date, enabled: Boolean(session.vmcMax) },
            ];
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async function handleDeleteClimateLog(id: string) {
    if (!user) return;
    const path = `users/${user.uid}/climateLogs/${id}`;
    const existingLog = climateLogs.find((l) => l.id === id);
    if (existingLog) {
      setSimulatedOpTitleHint(path, `${existingLog.mode} · ${existingLog.date}`);
    }
    try {
      await deleteDoc(doc(db, path));
      if (isFirestoreWritesDisabled()) {
        setClimateLogs((prev) => prev.filter((l) => l.id !== id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async function handleToggleVmcDays(dates: string[], enabled: boolean) {
    if (!user || dates.length === 0) return;
    const validDates = Array.from(
      new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))
    );
    if (validDates.length === 0) return;
    const vmcPath = `users/${user.uid}/vmcDays`;
    try {
      const batch = writeBatch(db);
      for (const dateIso of validDates) {
        const docId = `vmc_${dateIso.replace(/-/g, '')}`;
        batch.set(doc(db, vmcPath, docId), {
          ownerId: user.uid,
          date: dateIso,
          enabled: Boolean(enabled),
          createdAt: serverTimestamp(),
        });
        for (const log of climateLogs.filter((l) => l.date === dateIso)) {
          batch.set(
            doc(db, `users/${user.uid}/climateLogs`, log.id),
            { vmcMax: Boolean(enabled) },
            { merge: true }
          );
        }
      }
      await batch.commit();
      if (isFirestoreWritesDisabled()) {
        const dateSet = new Set(validDates);
        setVmcDays((prev) => {
          const kept = prev.filter((v) => !dateSet.has(v.date));
          const added = validDates.map((d) => ({
            id: `vmc_${d.replace(/-/g, '')}`,
            ownerId: user.uid,
            date: d,
            enabled: Boolean(enabled),
          }));
          return [...kept, ...added];
        });
        setClimateLogs((prev) =>
          prev.map((l) => (dateSet.has(l.date) ? { ...l, vmcMax: Boolean(enabled) } : l))
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, vmcPath);
    }
  }

  async function handleAddProductResearch(
    item: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>
  ): Promise<string> {
    if (!user) throw new Error('Accedi con Google per salvare le ricerche.');
    const urlTrim = item.url.trim().slice(0, 1000);
    if (!/^https?:\/\/.+/.test(urlTrim)) {
      throw new Error('Link non valido: deve iniziare con http:// o https://.');
    }
    const basePath = `users/${user.uid}/productResearches`;
    const docId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const normalizedRoom = normalizeResearchRoom(item.room);
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      url: urlTrim,
      title: item.title.trim().slice(0, 160),
      store: item.store.trim().slice(0, 60),
      category: item.category,
      status: normalizeResearchStatus(item.status),
      createdAt: serverTimestamp(),
    };
    if (normalizedRoom) {
      payload.room = normalizedRoom;
    }
    const cleanColors = Array.isArray(item.availableColors)
      ? Array.from(
          new Set(
            item.availableColors
              .map((c) => String(c).trim().slice(0, 60))
              .filter(Boolean)
          )
        ).slice(0, 24)
      : [];
    const cleanSizes = Array.isArray(item.availableSizes)
      ? Array.from(
          new Set(
            item.availableSizes
              .map((s) => String(s).trim().slice(0, 60))
              .filter(Boolean)
          )
        ).slice(0, 24)
      : [];
    if (typeof item.priceEur === 'number' && Number.isFinite(item.priceEur) && item.priceEur >= 0) {
      payload.priceEur = Math.min(1000000, Math.round(item.priceEur * 100) / 100);
    }
    if (
      payload.status === 'acquistato' &&
      typeof item.paidPriceEur === 'number' &&
      Number.isFinite(item.paidPriceEur) &&
      item.paidPriceEur >= 0
    ) {
      payload.paidPriceEur = Math.min(1000000, Math.round(item.paidPriceEur * 100) / 100);
    }
    if (item.imageUrl && /^https?:\/\/.+/.test(item.imageUrl.trim())) {
      payload.imageUrl = item.imageUrl.trim().slice(0, 1000);
    }
    const cleanColorImages = sanitizeColorImagesMap(item.colorImages);
    if (item.brand && item.brand.trim()) {
      payload.brand = item.brand.trim().slice(0, 60);
    }
    if (item.color && item.color.trim()) {
      payload.color = item.color.trim().slice(0, 60);
    }
    if (cleanColors.length > 0) {
      payload.availableColors = cleanColors;
    }
    if (cleanColorImages) {
      payload.colorImages = cleanColorImages;
    }
    if (item.size && item.size.trim()) {
      payload.size = item.size.trim().slice(0, 60);
    }
    if (cleanSizes.length > 0) {
      payload.availableSizes = cleanSizes;
    }
    if (item.model && item.model.trim()) {
      payload.model = item.model.trim().slice(0, 80);
    }
    if (item.specs && item.specs.trim()) {
      payload.specs = item.specs.trim().slice(0, 2000);
    }
    if (item.notes && item.notes.trim()) {
      payload.notes = item.notes.trim().slice(0, 400);
    }
    try {
      const newDiff = diffProductResearchFields(undefined, {
        ...item,
        url: urlTrim,
        title: String(payload.title),
        store: String(payload.store),
        status: payload.status as ProductResearchStatus,
        room: normalizedRoom,
        priceEur: typeof payload.priceEur === 'number' ? payload.priceEur : undefined,
        paidPriceEur:
          typeof payload.paidPriceEur === 'number' ? payload.paidPriceEur : undefined,
        imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
        brand: typeof payload.brand === 'string' ? payload.brand : undefined,
        color: typeof payload.color === 'string' ? payload.color : undefined,
        availableColors: cleanColors.length > 0 ? cleanColors : undefined,
        colorImages: cleanColorImages || undefined,
        size: typeof payload.size === 'string' ? payload.size : undefined,
        availableSizes: cleanSizes.length > 0 ? cleanSizes : undefined,
        model: typeof payload.model === 'string' ? payload.model : undefined,
        specs: typeof payload.specs === 'string' ? payload.specs : undefined,
        notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      });
      setSimulatedOpDetailHint(`${basePath}/${docId}`, {
        title: String(payload.title),
        actionLabel: 'Nuovo prodotto',
        changedFields: newDiff.changedFields,
        changedDetails: newDiff.changedDetails,
      });
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setProductResearches((prev) => [
          {
            id: docId,
            ownerId: user.uid,
            url: urlTrim,
            title: String(payload.title),
            store: String(payload.store),
            category: item.category,
            status: payload.status as ProductResearchStatus,
            room: normalizedRoom,
            priceEur: typeof payload.priceEur === 'number' ? payload.priceEur : undefined,
            paidPriceEur:
              typeof payload.paidPriceEur === 'number' ? payload.paidPriceEur : undefined,
            imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
            brand: typeof payload.brand === 'string' ? payload.brand : undefined,
            color: typeof payload.color === 'string' ? payload.color : undefined,
            availableColors: cleanColors.length > 0 ? cleanColors : undefined,
            colorImages: cleanColorImages || undefined,
            size: typeof payload.size === 'string' ? payload.size : undefined,
            availableSizes: cleanSizes.length > 0 ? cleanSizes : undefined,
            model: typeof payload.model === 'string' ? payload.model : undefined,
            specs: typeof payload.specs === 'string' ? payload.specs : undefined,
            notes: typeof payload.notes === 'string' ? payload.notes : undefined,
            createdAtMs: Date.now(),
          },
          ...prev,
        ]);
      } else {
        writeExtendedRoomOverride(docId, urlTrim, 'clear');
      }
      return docId;
    } catch (error) {
      if (
        (normalizedRoom === 'terrazza_ovest' || normalizedRoom === 'terrazza_est') &&
        isFirestorePermissionDenied(error)
      ) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.room;
        try {
          writeExtendedRoomOverride(docId, urlTrim, normalizedRoom);
          await setDoc(doc(db, basePath, docId), fallbackPayload);
          setProductResearches((prev) =>
            prev.map((r) => (r.id === docId ? { ...r, room: normalizedRoom } : r))
          );
          return docId;
        } catch (fallbackErr) {
          writeExtendedRoomOverride(docId, urlTrim, 'clear');
          handleFirestoreError(fallbackErr, OperationType.CREATE, `${basePath}/${docId}`);
          throw fallbackErr;
        }
      }
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleUpdateProductResearch(
    id: string,
    item: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>
  ) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const urlTrim = item.url.trim().slice(0, 1000);
    if (!/^https?:\/\/.+/.test(urlTrim)) return;
    const path = `users/${user.uid}/productResearches/${id}`;
    const normalizedRoom = normalizeResearchRoom(item.room);
    const cleanColors = Array.isArray(item.availableColors)
      ? Array.from(
          new Set(
            item.availableColors
              .map((c) => String(c).trim().slice(0, 60))
              .filter(Boolean)
          )
        ).slice(0, 24)
      : [];
    const cleanSizes = Array.isArray(item.availableSizes)
      ? Array.from(
          new Set(
            item.availableSizes
              .map((s) => String(s).trim().slice(0, 60))
              .filter(Boolean)
          )
        ).slice(0, 24)
      : [];
    const cleanColorImages = sanitizeColorImagesMap(item.colorImages);
    const normalizedStatus = normalizeResearchStatus(item.status);
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      url: urlTrim,
      title: item.title.trim().slice(0, 160),
      store: item.store.trim().slice(0, 60),
      category: item.category,
      status: normalizedStatus,
      room: normalizedRoom ? normalizedRoom : deleteField(),
      priceEur:
        typeof item.priceEur === 'number' && Number.isFinite(item.priceEur) && item.priceEur >= 0
          ? Math.min(1000000, Math.round(item.priceEur * 100) / 100)
          : deleteField(),
      paidPriceEur:
        normalizedStatus === 'acquistato' &&
        typeof item.paidPriceEur === 'number' &&
        Number.isFinite(item.paidPriceEur) &&
        item.paidPriceEur >= 0
          ? Math.min(1000000, Math.round(item.paidPriceEur * 100) / 100)
          : deleteField(),
      imageUrl:
        item.imageUrl && /^https?:\/\/.+/.test(item.imageUrl.trim())
          ? item.imageUrl.trim().slice(0, 1000)
          : deleteField(),
      brand: item.brand && item.brand.trim() ? item.brand.trim().slice(0, 60) : deleteField(),
      color: item.color && item.color.trim() ? item.color.trim().slice(0, 60) : deleteField(),
      availableColors: cleanColors.length > 0 ? cleanColors : deleteField(),
      colorImages: cleanColorImages ? cleanColorImages : deleteField(),
      size: item.size && item.size.trim() ? item.size.trim().slice(0, 60) : deleteField(),
      availableSizes: cleanSizes.length > 0 ? cleanSizes : deleteField(),
      model: item.model && item.model.trim() ? item.model.trim().slice(0, 80) : deleteField(),
      specs: item.specs && item.specs.trim() ? item.specs.trim().slice(0, 2000) : deleteField(),
      notes: item.notes && item.notes.trim() ? item.notes.trim().slice(0, 400) : deleteField(),
    };
    const prevResearch = productResearches.find((r) => r.id === id);
    const nextSnapshotForDiff: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'> = {
      ...item,
      url: urlTrim,
      title: String(payload.title),
      store: String(payload.store),
      status: normalizedStatus,
      room: normalizedRoom,
      priceEur: typeof payload.priceEur === 'number' ? payload.priceEur : undefined,
      paidPriceEur: typeof payload.paidPriceEur === 'number' ? payload.paidPriceEur : undefined,
      imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
      brand: typeof payload.brand === 'string' ? payload.brand : undefined,
      color: typeof payload.color === 'string' ? payload.color : undefined,
      availableColors: cleanColors.length > 0 ? cleanColors : undefined,
      colorImages: cleanColorImages || undefined,
      size: typeof payload.size === 'string' ? payload.size : undefined,
      availableSizes: cleanSizes.length > 0 ? cleanSizes : undefined,
      model: typeof payload.model === 'string' ? payload.model : undefined,
      specs: typeof payload.specs === 'string' ? payload.specs : undefined,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
    };
    const updateDiff = diffProductResearchFields(prevResearch, nextSnapshotForDiff);
    const changedKeys = new Set(updateDiff.changedFields);
    if (prevResearch) {
      if (
        JSON.stringify(prevResearch.availableColors || []) !== JSON.stringify(cleanColors)
      ) {
        changedKeys.add('availableColors');
      }
      if (
        JSON.stringify(prevResearch.availableSizes || []) !== JSON.stringify(cleanSizes)
      ) {
        changedKeys.add('availableSizes');
      }
      if (
        JSON.stringify(prevResearch.colorImages || {}) !==
        JSON.stringify(cleanColorImages || {})
      ) {
        changedKeys.add('colorImages');
      }
    }
    if (prevResearch && changedKeys.size === 0) {
      return;
    }
    const baseResearchRaw = rawSnapshotsRef.current.productResearches?.find((d) => d.id === id);
    const baseResearch =
      isFirestoreWritesDisabled() && baseResearchRaw
        ? mapRawProductResearches([baseResearchRaw], user.uid)[0]
        : undefined;
    const queueDiff = baseResearch
      ? diffProductResearchFields(baseResearch, nextSnapshotForDiff)
      : updateDiff;
    let writePayload: Record<string, unknown> = payload;
    if (prevResearch && changedKeys.size > 0) {
      const partialPayload: Record<string, unknown> = {
        ownerId: user.uid,
      };
      for (const key of changedKeys) {
        if (key in payload) {
          partialPayload[key] = payload[key];
        }
      }
      writePayload = partialPayload;
    }
    try {
      setSimulatedOpDetailHint(path, {
        title: String(payload.title),
        actionLabel: 'Modifica',
        changedFields: queueDiff.changedFields,
        changedDetails: queueDiff.changedDetails,
      });
      await setDoc(doc(db, path), writePayload, { merge: true });
      if (isFirestoreWritesDisabled()) {
        setProductResearches((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  url: urlTrim,
                  title: String(payload.title),
                  store: String(payload.store),
                  category: item.category,
                  status: normalizedStatus,
                  room: normalizedRoom,
                  priceEur: typeof payload.priceEur === 'number' ? payload.priceEur : undefined,
                  paidPriceEur:
                    typeof payload.paidPriceEur === 'number' ? payload.paidPriceEur : undefined,
                  imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
                  brand: typeof payload.brand === 'string' ? payload.brand : undefined,
                  color: typeof payload.color === 'string' ? payload.color : undefined,
                  availableColors: cleanColors.length > 0 ? cleanColors : undefined,
                  colorImages: cleanColorImages || undefined,
                  size: typeof payload.size === 'string' ? payload.size : undefined,
                  availableSizes: cleanSizes.length > 0 ? cleanSizes : undefined,
                  model: typeof payload.model === 'string' ? payload.model : undefined,
                  specs: typeof payload.specs === 'string' ? payload.specs : undefined,
                  notes: typeof payload.notes === 'string' ? payload.notes : undefined,
                }
              : r
          )
        );
      } else if (!normalizedRoom && /\bkomodo(?:\s*5)?\b/i.test(`${item.title} ${urlTrim}`)) {
        writeExtendedRoomOverride(id, urlTrim, '__none__');
      } else {
        writeExtendedRoomOverride(id, urlTrim, 'clear');
      }
    } catch (error) {
      if (
        (normalizedRoom === 'terrazza_ovest' || normalizedRoom === 'terrazza_est') &&
        isFirestorePermissionDenied(error)
      ) {
        try {
          writeExtendedRoomOverride(id, urlTrim, normalizedRoom);
          await setDoc(
            doc(db, path),
            { ...writePayload, room: deleteField() },
            { merge: true }
          );
          setProductResearches((prev) =>
            prev.map((r) => (r.id === id ? { ...r, room: normalizedRoom } : r))
          );
          return;
        } catch (fallbackErr) {
          handleFirestoreError(fallbackErr, OperationType.UPDATE, path);
          throw fallbackErr;
        }
      }
      handleFirestoreError(error, OperationType.UPDATE, path);
      throw error;
    }
  }

  async function handleDeleteProductResearch(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/productResearches/${id}`;
    const targetResearch = productResearches.find((r) => r.id === id);
    if (targetResearch) {
      setSimulatedOpTitleHint(path, targetResearch.title);
    }
    const linkedDocs = getDocumentsForResearch(homeDocuments, id);
    try {
      await deleteDoc(doc(db, path));
      const keysToDelete: string[] = [];
      for (const linked of linkedDocs) {
        if (/^[a-zA-Z0-9_-]+$/.test(linked.id)) {
          const linkedPath = `users/${user.uid}/homeArticles/${linked.id}`;
          setSimulatedOpTitleHint(linkedPath, linked.title || linked.fileName || linked.id);
          await deleteDoc(doc(db, linkedPath));
        }
        if (linked.attachmentKey) keysToDelete.push(linked.attachmentKey);
      }
      if (keysToDelete.length > 0) {
        await deleteVaultFiles(keysToDelete, user.uid);
      }
      if (isFirestoreWritesDisabled()) {
        setProductResearches((prev) => prev.filter((r) => r.id !== id));
        if (linkedDocs.length > 0) {
          const linkedIds = new Set(linkedDocs.map((d) => d.id));
          setHomeArticles((prev) => prev.filter((a) => !linkedIds.has(a.id)));
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
      throw error;
    }
  }

  async function handleUpdateConfig(patch: Partial<HomeSystemConfig>) {
    if (!user) return;
    const configPath = `users/${user.uid}/homeConfig/main`;
    const nextConfig: HomeSystemConfig = {
      ...homeConfig,
      ...patch,
      ownerId: user.uid,
    };
    const cfgFields: string[] = [];
    const cfgDetails: string[] = [];
    if (patch.aristonMode !== undefined && patch.aristonMode !== homeConfig.aristonMode) {
      cfgFields.push('aristonMode');
      cfgDetails.push(`Ariston: ${homeConfig.aristonMode} → ${patch.aristonMode}`);
    }
    if (patch.aristonProfile !== undefined && patch.aristonProfile !== homeConfig.aristonProfile) {
      cfgFields.push('aristonProfile');
      cfgDetails.push(`Profilo: ${homeConfig.aristonProfile} → ${patch.aristonProfile}`);
    }
    if (patch.floorFlowTemp !== undefined && patch.floorFlowTemp !== homeConfig.floorFlowTemp) {
      cfgFields.push('floorFlowTemp');
      cfgDetails.push(`Mandata: ${homeConfig.floorFlowTemp}°C → ${patch.floorFlowTemp}°C`);
    }
    if (patch.dhwTargetTemp !== undefined && patch.dhwTargetTemp !== homeConfig.dhwTargetTemp) {
      cfgFields.push('dhwTargetTemp');
      cfgDetails.push(`ACS: ${homeConfig.dhwTargetTemp}°C → ${patch.dhwTargetTemp}°C`);
    }
    if (patch.zoneLivingTarget !== undefined && patch.zoneLivingTarget !== homeConfig.zoneLivingTarget) {
      cfgFields.push('zoneLivingTarget');
      cfgDetails.push(`Zona giorno: ${homeConfig.zoneLivingTarget}°C → ${patch.zoneLivingTarget}°C`);
    }
    if (patch.zoneBedroomTarget !== undefined && patch.zoneBedroomTarget !== homeConfig.zoneBedroomTarget) {
      cfgFields.push('zoneBedroomTarget');
      cfgDetails.push(`Zona notte: ${homeConfig.zoneBedroomTarget}°C → ${patch.zoneBedroomTarget}°C`);
    }
    if (patch.neasmartPower !== undefined && patch.neasmartPower !== homeConfig.neasmartPower) {
      cfgFields.push('neasmartPower');
      cfgDetails.push(`Nea Smart: ${patch.neasmartPower ? 'Acceso' : 'Spento'}`);
    }
    if (patch.neasmartTargetHumidity !== undefined && patch.neasmartTargetHumidity !== homeConfig.neasmartTargetHumidity) {
      cfgFields.push('neasmartTargetHumidity');
      cfgDetails.push(`Umidità: ${patch.neasmartTargetHumidity}%`);
    }
    if (patch.neasmartFanSpeed !== undefined && patch.neasmartFanSpeed !== homeConfig.neasmartFanSpeed) {
      cfgFields.push('neasmartFanSpeed');
      cfgDetails.push(`Ventole: ${patch.neasmartFanSpeed}`);
    }
    if (patch.tariffEurPerKwh !== undefined && patch.tariffEurPerKwh !== homeConfig.tariffEurPerKwh) {
      cfgFields.push('tariffEurPerKwh');
      cfgDetails.push(`Tariffa: €${patch.tariffEurPerKwh}/kWh`);
    }
    if (patch.podCode !== undefined && patch.podCode !== homeConfig.podCode) {
      cfgFields.push('podCode');
      cfgDetails.push(`POD: ${patch.podCode}`);
    }
    if (!isFirestoreWritesDisabled() || !rawSnapshotsRef.current.homeConfig) {
      setHomeConfig(nextConfig);
    }
    if (!isFirestoreWritesDisabled()) {
      try {
        localStorage.setItem(`myhome_config_cache_${user.uid}`, JSON.stringify(nextConfig));
      } catch {
        // ignore
      }
    }
    const configExistsInBase = (rawSnapshotsRef.current.homeConfig?.length ?? 0) > 0;
    if (configExistsInBase && cfgFields.length === 0) {
      return;
    }
    const baseConfig =
      isFirestoreWritesDisabled() && configExistsInBase && rawSnapshotsRef.current.homeConfig
        ? mapRawHomeConfig(rawSnapshotsRef.current.homeConfig, user.uid)
        : homeConfig;
    const queueCfgFields: string[] = [];
    const queueCfgDetails: string[] = [];
    if (nextConfig.aristonMode !== baseConfig.aristonMode) {
      queueCfgFields.push('aristonMode');
      queueCfgDetails.push(`Ariston: ${baseConfig.aristonMode} → ${nextConfig.aristonMode}`);
    }
    if (nextConfig.aristonProfile !== baseConfig.aristonProfile) {
      queueCfgFields.push('aristonProfile');
      queueCfgDetails.push(`Profilo: ${baseConfig.aristonProfile} → ${nextConfig.aristonProfile}`);
    }
    if (nextConfig.floorFlowTemp !== baseConfig.floorFlowTemp) {
      queueCfgFields.push('floorFlowTemp');
      queueCfgDetails.push(`Mandata: ${baseConfig.floorFlowTemp}°C → ${nextConfig.floorFlowTemp}°C`);
    }
    if (nextConfig.dhwTargetTemp !== baseConfig.dhwTargetTemp) {
      queueCfgFields.push('dhwTargetTemp');
      queueCfgDetails.push(`ACS: ${baseConfig.dhwTargetTemp}°C → ${nextConfig.dhwTargetTemp}°C`);
    }
    if (nextConfig.zoneLivingTarget !== baseConfig.zoneLivingTarget) {
      queueCfgFields.push('zoneLivingTarget');
      queueCfgDetails.push(`Zona giorno: ${baseConfig.zoneLivingTarget}°C → ${nextConfig.zoneLivingTarget}°C`);
    }
    if (nextConfig.zoneBedroomTarget !== baseConfig.zoneBedroomTarget) {
      queueCfgFields.push('zoneBedroomTarget');
      queueCfgDetails.push(`Zona notte: ${baseConfig.zoneBedroomTarget}°C → ${nextConfig.zoneBedroomTarget}°C`);
    }
    if (nextConfig.neasmartPower !== baseConfig.neasmartPower) {
      queueCfgFields.push('neasmartPower');
      queueCfgDetails.push(`Nea Smart: ${nextConfig.neasmartPower ? 'Acceso' : 'Spento'}`);
    }
    if (nextConfig.neasmartTargetHumidity !== baseConfig.neasmartTargetHumidity) {
      queueCfgFields.push('neasmartTargetHumidity');
      queueCfgDetails.push(`Umidità: ${nextConfig.neasmartTargetHumidity}%`);
    }
    if (nextConfig.neasmartFanSpeed !== baseConfig.neasmartFanSpeed) {
      queueCfgFields.push('neasmartFanSpeed');
      queueCfgDetails.push(`Ventole: ${nextConfig.neasmartFanSpeed}`);
    }
    if (nextConfig.tariffEurPerKwh !== baseConfig.tariffEurPerKwh) {
      queueCfgFields.push('tariffEurPerKwh');
      queueCfgDetails.push(`Tariffa: €${nextConfig.tariffEurPerKwh}/kWh`);
    }
    if (nextConfig.podCode !== baseConfig.podCode) {
      queueCfgFields.push('podCode');
      queueCfgDetails.push(`POD: ${nextConfig.podCode}`);
    }
    try {
      setSimulatedOpDetailHint(configPath, {
        title: nextConfig.podCode ? `POD ${nextConfig.podCode}` : 'Configurazione impianto',
        actionLabel: 'Modifica',
        changedFields: queueCfgFields.length > 0 ? queueCfgFields : undefined,
        changedDetails: queueCfgDetails.length > 0 ? queueCfgDetails : undefined,
      });
      if (configExistsInBase) {
        await setDoc(
          doc(db, configPath),
          {
            ...patch,
            ownerId: user.uid,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await setDoc(doc(db, configPath), {
          ...nextConfig,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, configPath);
    }
  }

  async function saveBillPdfFile(fileKey: string, file: File, uid: string) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('Puoi archiviare una bolletta soltanto partendo dal suo PDF originale.');
    }
    const pdfHeader = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
    if (!pdfHeader.includes('%PDF-')) {
      throw new Error('Il file selezionato non contiene un’intestazione PDF valida.');
    }

    const saved = await saveVaultFile(
      fileKey,
      file,
      file.name,
      file.type || 'application/pdf',
      uid
    );
    if (!saved.cloudSynced) {
      await deleteVaultFiles([fileKey], uid);
      throw new Error(
        saved.cloudTooLarge
          ? 'Il PDF supera il limite Firebase: la bolletta non è stata registrata.'
          : 'Il PDF non è stato salvato su Firebase: la bolletta non è stata registrata.'
      );
    }
  }

  async function handleAddElectricityBill(bill: BillRecord, pdfFile?: File) {
    if (!user) throw new Error('È necessario autenticarsi per importare bollette.');
    if (!pdfFile) throw new Error('Per registrare una bolletta è necessario caricare il PDF originale.');
    const basePath = `users/${user.uid}/electricityBills`;
    const cleanInv = bill.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const docId = `manual_elec_${cleanInv || Date.now()}`;
    const pdfFileKey = getElectricityBillFileKey(bill.invoiceNumber);
    await saveBillPdfFile(pdfFileKey, pdfFile, user.uid);
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      invoiceNumber: bill.invoiceNumber.slice(0, 40),
      pdfFileKey,
      issueDate: bill.issueDate.slice(0, 20),
      sortKey: bill.sortKey.slice(0, 16),
      year: Number(bill.year),
      period: bill.period.slice(0, 80),
      supplier: bill.supplier.slice(0, 80),
      offerName: bill.offerName.slice(0, 100),
      kwh: Number(bill.kwh),
      punText: bill.punText.slice(0, 60),
      variableCostPerKwh: Number(bill.variableCostPerKwh),
      canoneTv: Number(bill.canoneTv),
      electricityOnly: Number(bill.electricityOnly),
      totalPaid: Number(bill.totalPaid),
      createdAt: serverTimestamp(),
    };
    if (bill.note && bill.note.trim()) {
      payload.note = bill.note.trim().slice(0, 240);
    }
    try {
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setElectricityBills((prev) => [...prev, { ...bill, pdfFileKey }]);
      }
    } catch (error) {
      await deleteVaultFiles([pdfFileKey], user.uid);
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleDeleteElectricityBill(bill: BillRecord) {
    if (!user) return;
    const fileKey = getElectricityBillFileKey(bill.invoiceNumber);
    if (isFirestoreWritesDisabled()) {
      await deleteVaultFile(fileKey, user.uid);
      setElectricityBills((prev) =>
        prev.filter((b) => b.invoiceNumber !== bill.invoiceNumber)
      );
      return;
    }

    const basePath = `users/${user.uid}/electricityBills`;
    const billsSnap = await getDocs(
      query(collection(db, basePath), where('ownerId', '==', user.uid))
    );
    const matchingDocs = billsSnap.docs.filter(
      (billDoc) => String(billDoc.data().invoiceNumber || '') === bill.invoiceNumber
    );
    if (matchingDocs.length === 0) {
      throw new Error('La bolletta non è stata trovata nell’archivio Firebase.');
    }

    const fileMetaRef = doc(db, `users/${user.uid}/vaultFiles`, fileKey);
    const fileMetaSnap = await getDoc(fileMetaRef);
    const batch = writeBatch(db);
    for (const billDoc of matchingDocs) batch.delete(billDoc.ref);

    if (fileMetaSnap.exists()) {
      const chunkCount = Math.min(16, Math.max(0, Number(fileMetaSnap.data()?.chunkCount || 0)));
      batch.delete(fileMetaRef);
      for (let i = 0; i < chunkCount; i++) {
        batch.delete(doc(db, `users/${user.uid}/vaultFileChunks`, `${fileKey}_chunk_${i}`));
      }
    }

    try {
      await batch.commit();
      await deleteVaultFile(fileKey, user.uid);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${basePath}/${fileKey}`);
    }
  }

  async function handleClearAllBills() {
    if (!user) throw new Error('È necessario autenticarsi per eliminare le bollette.');
    if (clearingBillArchiveRef.current) return;

    clearingBillArchiveRef.current = true;
    try {
      const uid = user.uid;
      const electricityPath = `users/${uid}/electricityBills`;
      const waterPath = `users/${uid}/waterBills`;
      const tariPath = `users/${uid}/tariBills`;
      const gsePath = `users/${uid}/gsePayments`;
      const vaultPath = `users/${uid}/vaultFiles`;
      const vaultChunksPath = `users/${uid}/vaultFileChunks`;
      const [
        electricitySnap,
        waterSnap,
        tariSnap,
        gseSnap,
        vaultSnap,
        vaultChunksSnap,
        localVaultFiles,
      ] = await Promise.all([
        getDocs(query(collection(db, electricityPath), where('ownerId', '==', uid))),
        getDocs(query(collection(db, waterPath), where('ownerId', '==', uid))),
        getDocs(query(collection(db, tariPath), where('ownerId', '==', uid))),
        getDocs(query(collection(db, gsePath), where('ownerId', '==', uid))),
        getDocs(query(collection(db, vaultPath), where('ownerId', '==', uid))),
        getDocs(query(collection(db, vaultChunksPath), where('ownerId', '==', uid))),
        listVaultFileMetadata(uid),
      ]);

      const contractFileKeys = new Set<string>();
      const electricityDocs = electricitySnap.docs.filter((billDoc) => {
        const data = billDoc.data();
        const record = {
          supplier: String(data.supplier || ''),
          year: Number(data.year || 0),
          invoiceNumber: String(data.invoiceNumber || ''),
          period: String(data.period || ''),
          note: data.note ? String(data.note) : undefined,
        };
        if (!isOctopusContractRecord(record)) return true;
        contractFileKeys.add(getElectricityBillFileKey(record.invoiceNumber));
        return false;
      });

      const billFileKeys = new Set<string>([
        ...electricityDocs.map((billDoc) =>
          getElectricityBillFileKey(String(billDoc.data().invoiceNumber || ''))
        ),
        ...waterSnap.docs.map((billDoc) =>
          getWaterBillFileKey(String(billDoc.data().invoiceNumber || ''))
        ),
        ...tariSnap.docs.map((billDoc) =>
          getTariBillFileKey(String(billDoc.data().noticeNumber || ''))
        ),
      ]);
      const billFilePrefixes = ['bill_elec_', 'bill_water_', 'bill_tari_', 'gse_payment_'];
      const isBillFileKey = (key: string) =>
        billFilePrefixes.some((prefix) => key.startsWith(prefix)) &&
        !contractFileKeys.has(key);

      vaultSnap.docs.forEach((fileDoc) => {
        const key = String(fileDoc.data().fileKey || fileDoc.id);
        if (isBillFileKey(key)) billFileKeys.add(key);
      });
      vaultChunksSnap.docs.forEach((chunkDoc) => {
        const key = String(chunkDoc.data().fileKey || '');
        if (isBillFileKey(key)) billFileKeys.add(key);
      });
      Object.keys(localVaultFiles).forEach((key) => {
        if (isBillFileKey(key)) billFileKeys.add(key);
      });

      await deleteVaultFiles(Array.from(billFileKeys), uid);

      const recordRefs = [
        ...electricityDocs.map((billDoc) => billDoc.ref),
        ...waterSnap.docs.map((billDoc) => billDoc.ref),
        ...tariSnap.docs.map((billDoc) => billDoc.ref),
        ...gseSnap.docs.map((paymentDoc) => paymentDoc.ref),
      ];
      for (let start = 0; start < recordRefs.length; start += 400) {
        const batch = writeBatch(db);
        recordRefs.slice(start, start + 400).forEach((billRef) => batch.delete(billRef));
        await batch.commit();
      }

      setElectricityBills((current) => current.filter(isOctopusContractRecord));
      setWaterBills([]);
      setTariBills([]);
      setGsePayments([]);
      if (!isFirestoreWritesDisabled()) {
        try {
          localStorage.setItem(`myhome_elec_bills_cache_${uid}`, '[]');
          localStorage.setItem(`myhome_water_bills_cache_${uid}`, '[]');
          localStorage.setItem(`myhome_tari_bills_cache_${uid}`, '[]');
          localStorage.setItem(`myhome_gse_payments_cache_${uid}`, '[]');
        } catch {
          // Firebase remains the source of truth if the local cache is unavailable.
        }
      }
    } finally {
      clearingBillArchiveRef.current = false;
    }
  }

  async function handleAddWaterBill(bill: Omit<WaterBillRecord, 'id'>, pdfFile?: File) {
    if (!user) throw new Error('È necessario autenticarsi per importare bollette.');
    if (!pdfFile) throw new Error('Per registrare una bolletta è necessario caricare il PDF originale.');
    const basePath = `users/${user.uid}/waterBills`;
    const cleanInv = bill.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const docId = `manual_water_${cleanInv || Date.now()}`;
    const pdfFileKey = getWaterBillFileKey(bill.invoiceNumber);
    await saveBillPdfFile(pdfFileKey, pdfFile, user.uid);
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      invoiceNumber: bill.invoiceNumber.slice(0, 40),
      pdfFileKey,
      issueDate: bill.issueDate.slice(0, 20),
      year: Number(bill.year),
      period: bill.period.slice(0, 80),
      cubicMeters: Number(bill.cubicMeters),
      fixedCostEur: Number(bill.fixedCostEur),
      totalPaid: Number(bill.totalPaid),
      createdAt: serverTimestamp(),
    };
    if (bill.note && bill.note.trim()) {
      payload.note = bill.note.trim().slice(0, 240);
    }
    try {
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setWaterBills((prev) => [...prev, { ...bill, id: docId, pdfFileKey }]);
      }
    } catch (error) {
      await deleteVaultFiles([pdfFileKey], user.uid);
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleAddTariBill(bill: Omit<TariBillRecord, 'id'>, pdfFile?: File) {
    if (!user) throw new Error('È necessario autenticarsi per importare bollette.');
    if (!pdfFile) throw new Error('Per registrare una bolletta è necessario caricare il PDF originale.');
    const basePath = `users/${user.uid}/tariBills`;
    const cleanNotice = bill.noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const docId = `tari_${cleanNotice || Date.now()}`;
    const pdfFileKey = getTariBillFileKey(bill.noticeNumber);
    await saveBillPdfFile(pdfFileKey, pdfFile, user.uid);
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      noticeNumber: bill.noticeNumber.slice(0, 50),
      pdfFileKey,
      issueDate: (bill.issueDate || bill.dueDate || '—').slice(0, 20),
      dueDate: (bill.dueDate || bill.issueDate || '—').slice(0, 20),
      year: Number(bill.year),
      period: bill.period.slice(0, 80),
      supplier: bill.supplier.slice(0, 80),
      totalPaid: Number(bill.totalPaid),
      paid: Boolean(bill.paid),
      source: bill.source === 'gmail-pdf' ? 'gmail-pdf' : 'manuale',
      createdAt: serverTimestamp(),
    };
    if (bill.note && bill.note.trim()) {
      payload.note = bill.note.trim().slice(0, 240);
    }
    try {
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setTariBills((prev) => [...prev, { ...bill, id: docId, pdfFileKey }]);
      }
    } catch (error) {
      await deleteVaultFiles([pdfFileKey], user.uid);
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleToggleTariPaid(bill: TariBillRecord) {
    if (!user) return;
    const basePath = `users/${user.uid}/tariBills`;
    const cleanNotice = bill.noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const docId =
      bill.id && /^[a-zA-Z0-9_-]+$/.test(bill.id)
        ? bill.id
        : `tari_${cleanNotice || Date.now()}`;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      noticeNumber: bill.noticeNumber.slice(0, 50),
      pdfFileKey: bill.pdfFileKey || getTariBillFileKey(bill.noticeNumber),
      issueDate: (bill.issueDate || bill.dueDate || '—').slice(0, 20),
      dueDate: (bill.dueDate || bill.issueDate || '—').slice(0, 20),
      year: Number(bill.year),
      period: bill.period.slice(0, 80),
      supplier: bill.supplier.slice(0, 80),
      totalPaid: Number(bill.totalPaid),
      paid: !bill.paid,
      source: bill.source === 'gmail-pdf' ? 'gmail-pdf' : 'manuale',
      createdAt: serverTimestamp(),
    };
    if (bill.note && bill.note.trim()) {
      payload.note = bill.note.trim().slice(0, 240);
    }
    try {
      setSimulatedOpDetailHint(`${basePath}/${docId}`, {
        title: bill.period || bill.noticeNumber,
        actionLabel: 'Modifica',
        changedFields: ['paid'],
        changedDetails: [`Stato TARI: ${bill.paid ? 'Pagata → Da pagare' : 'Da pagare → Pagata'}`],
      });
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setTariBills((prev) =>
          prev.map((t) =>
            t.id === bill.id || t.noticeNumber === bill.noticeNumber ? { ...t, paid: !t.paid } : t
          )
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${basePath}/${docId}`);
    }
  }

  async function handleDeleteTariBill(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const target = tariBills.find((t) => t.id === id);
    const path = `users/${user.uid}/tariBills/${id}`;
    if (target) {
      setSimulatedOpTitleHint(path, target.period || target.noticeNumber || id);
    }
    try {
      await deleteDoc(doc(db, path));
      if (target) {
        await deleteVaultFile(
          target.pdfFileKey || getTariBillFileKey(target.noticeNumber),
          user.uid
        );
      }
      if (isFirestoreWritesDisabled()) {
        setTariBills((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async function handleAddGsePayment(payment: Omit<GsePaymentRecord, 'id'>) {
    if (!user) return;
    const basePath = `users/${user.uid}/gsePayments`;
    const dateSlug = payment.paymentDate.replace(/[^0-9]/g, '');
    const docId = `gse_${dateSlug || Date.now()}_${Date.now().toString().slice(-4)}`;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      paymentDate: payment.paymentDate.slice(0, 20),
      year: Number(payment.year),
      paymentType: payment.paymentType,
      period: payment.period.slice(0, 80),
      amountEur: Number(payment.amountEur),
      createdAt: serverTimestamp(),
    };
    if (typeof payment.kwhInjected === 'number' && !Number.isNaN(payment.kwhInjected)) {
      payload.kwhInjected = Number(payment.kwhInjected);
    }
    if (payment.reference && payment.reference.trim()) {
      payload.reference = payment.reference.trim().slice(0, 80);
    }
    if (payment.note && payment.note.trim()) {
      payload.note = payment.note.trim().slice(0, 240);
    }
    if (payment.attachmentFileKey) {
      payload.attachmentFileKey = payment.attachmentFileKey;
    }
    try {
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setGsePayments((prev) => [...prev, { ...payment, id: docId }]);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleUpdateGsePayment(
    id: string,
    payment: Omit<GsePaymentRecord, 'id'>
  ) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('Non è stato possibile aggiornare il bonifico GSE.');
    }
    const path = `users/${user.uid}/gsePayments/${id}`;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      paymentDate: payment.paymentDate.slice(0, 20),
      year: Number(payment.year),
      paymentType: payment.paymentType,
      period: payment.period.slice(0, 80),
      amountEur: Number(payment.amountEur),
      createdAt: serverTimestamp(),
    };
    if (typeof payment.kwhInjected === 'number' && !Number.isNaN(payment.kwhInjected)) {
      payload.kwhInjected = Number(payment.kwhInjected);
    }
    if (payment.reference?.trim()) payload.reference = payment.reference.trim().slice(0, 80);
    if (payment.note?.trim()) payload.note = payment.note.trim().slice(0, 240);
    if (payment.attachmentFileKey) {
      payload.attachmentFileKey = payment.attachmentFileKey;
    }
    try {
      await setDoc(doc(db, path), payload);
      if (isFirestoreWritesDisabled()) {
        setGsePayments((prev) =>
          prev.map((p) => (p.id === id ? { ...payment, id } : p))
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
      throw error;
    }
  }

  async function handleDeleteGsePayment(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/gsePayments/${id}`;
    const payment = gsePayments.find((entry) => entry.id === id);
    if (payment) {
      setSimulatedOpTitleHint(path, payment.period || payment.paymentDate || id);
    }
    try {
      await deleteDoc(doc(db, path));
      if (payment?.attachmentFileKey) {
        await deleteVaultFiles([payment.attachmentFileKey], user.uid);
      }
      if (isFirestoreWritesDisabled()) {
        setGsePayments((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
      throw error;
    }
  }

  async function saveArticleManual(
    file: File,
    articleId: string
  ): Promise<{ key: string; fileName: string }> {
    if (!user) throw new Error('Accedi per archiviare il manuale su Firebase.');
    if (file.size > MAX_CLOUD_FILE_BYTES) {
      throw new Error(`Il manuale supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB.`);
    }

    const key = `article_manual_${articleId}_${Date.now()}`;
    const stored = await saveVaultFile(key, file, file.name, 'application/pdf', user.uid);
    if (!stored.cloudSynced) {
      await deleteVaultFile(key, user.uid);
      throw new Error('Il manuale non è stato salvato su Firebase. Verifica la connessione e le regole del vault.');
    }
    return { key, fileName: stored.fileName };
  }

  async function handleAddArticle(
    article: Omit<HomeArticleRecord, 'id'>,
    customPrefix = 'art',
    manualFile?: File
  ): Promise<string | undefined> {
    if (!user) return undefined;
    const basePath = `users/${user.uid}/homeArticles`;
    const safePrefix = customPrefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'art';
    const docId = `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const uploadedManual = manualFile ? await saveArticleManual(manualFile, docId) : undefined;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      name: article.name.slice(0, 80),
      brand: article.brand.slice(0, 60),
      model: article.model.slice(0, 80),
      category: article.category,
      room: article.room.slice(0, 60),
      familyWarranty: Boolean(article.familyWarranty),
      createdAt: serverTimestamp(),
    };
    if (article.purchaseDate && article.purchaseDate.trim()) {
      payload.purchaseDate = article.purchaseDate.trim().slice(0, 20);
    }
    if (
      typeof article.purchasePriceEur === 'number' &&
      Number.isFinite(article.purchasePriceEur) &&
      article.purchasePriceEur >= 0
    ) {
      payload.purchasePriceEur = Math.min(
        1000000,
        Math.round(article.purchasePriceEur * 100) / 100
      );
    }
    if (article.warrantyEnd && article.warrantyEnd.trim()) {
      payload.warrantyEnd = article.warrantyEnd.trim().slice(0, 20);
    }
    if (article.serialNumber && article.serialNumber.trim()) {
      payload.serialNumber = article.serialNumber.trim().slice(0, 80);
    }
    if (article.specs && article.specs.trim()) {
      payload.specs = article.specs.trim().slice(0, 240);
    }
    if (article.notes && article.notes.trim()) {
      payload.notes = article.notes.trim().slice(0, 240);
    }
    if (uploadedManual) {
      payload.manualFileKey = uploadedManual.key;
      payload.manualFileName = uploadedManual.fileName;
    } else if (article.manualFileKey) {
      payload.manualFileKey = article.manualFileKey;
      if (article.manualFileName) payload.manualFileName = article.manualFileName;
    }
    if (article.manualExtractText?.trim()) {
      payload.manualExtractText = article.manualExtractText.trim().slice(0, 12_000);
    }
    try {
      const artDiff = diffHomeArticleFields(undefined, article, docId);
      setSimulatedOpDetailHint(`${basePath}/${docId}`, {
        title: article.name.slice(0, 80),
        actionLabel: 'Nuovo elemento',
        changedFields: artDiff.changedFields,
        changedDetails: artDiff.changedDetails,
      });
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setHomeArticles((prev) => [
          ...prev,
          {
            ...article,
            id: docId,
            manualFileKey: uploadedManual?.key ?? article.manualFileKey,
            manualFileName: uploadedManual?.fileName ?? article.manualFileName,
          },
        ]);
      }
      return docId;
    } catch (error) {
      if (uploadedManual) {
        await deleteVaultFile(uploadedManual.key, user.uid);
      }
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleSaveCarProfile(profile: Omit<CarProfile, 'id'>) {
    if (!user) return;
    await handleUpdateArticle(CAR_PROFILE_ID, carProfileToArticlePayload(profile));
  }

  async function handleSaveCarPolicy(policy: CarInsurancePolicy) {
    if (!user) return;
    await handleUpdateArticle(CAR_POLICY_ID, carInsuranceToArticlePayload(policy));
  }

  async function handleAddCarLog(entry: Omit<CarLogEntry, 'id'>) {
    await handleAddArticle(carLogToArticlePayload(entry), 'car_log');
  }

  async function handleUpdateCarLog(id: string, entry: Omit<CarLogEntry, 'id'>) {
    await handleUpdateArticle(id, carLogToArticlePayload(entry));
  }

  async function handleAddGroceryProduct(product: Omit<GroceryProduct, 'id'>) {
    await handleAddArticle(groceryProductToArticlePayload(product), 'spesa');
  }

  async function handleUpdateGroceryProduct(id: string, product: Omit<GroceryProduct, 'id'>) {
    await handleUpdateArticle(id, groceryProductToArticlePayload(product));
  }

  async function handleAddDocument(docItem: Omit<HomeDocumentRecord, 'id'>) {
    return handleAddArticle(homeDocumentToArticlePayload(docItem), 'doc');
  }

  async function handleUpdateDocument(id: string, docItem: Omit<HomeDocumentRecord, 'id'>) {
    await handleUpdateArticle(id, homeDocumentToArticlePayload(docItem));
  }

  async function handleUploadLinkedDocument(
    docItem: Omit<HomeDocumentRecord, 'id'>,
    file: File
  ) {
    if (!user) throw new Error('Accedi per archiviare il documento su Firebase.');
    const basePath = `users/${user.uid}/homeArticles`;
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const attachmentKey = docItem.attachmentKey
      ? sanitizeVaultFileKey(docItem.attachmentKey)
      : sanitizeVaultFileKey(`att_${docId}`);

    const stored = await saveVaultFile(
      attachmentKey,
      file,
      file.name,
      file.type || 'application/octet-stream',
      user.uid
    );
    if (!stored.cloudSynced) {
      await deleteVaultFiles([attachmentKey], user.uid);
      throw new Error(
        stored.cloudTooLarge
          ? `Il file supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB su Firebase.`
          : 'Il file non è stato salvato su Firebase. Verifica connessione e permessi.'
      );
    }

    const articlePayload = homeDocumentToArticlePayload({
      ...docItem,
      attachmentKey,
      fileName: stored.fileName,
      fileMime: stored.mimeType,
      fileSize: stored.size,
    });

    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      name: articlePayload.name.slice(0, 80),
      brand: articlePayload.brand.slice(0, 60),
      model: articlePayload.model.slice(0, 80),
      category: articlePayload.category,
      room: articlePayload.room.slice(0, 60),
      familyWarranty: Boolean(articlePayload.familyWarranty),
      createdAt: serverTimestamp(),
    };
    if (articlePayload.purchaseDate) payload.purchaseDate = articlePayload.purchaseDate.slice(0, 20);
    if (articlePayload.warrantyEnd) payload.warrantyEnd = articlePayload.warrantyEnd.slice(0, 20);
    if (articlePayload.serialNumber) payload.serialNumber = articlePayload.serialNumber.slice(0, 80);
    if (articlePayload.specs) payload.specs = articlePayload.specs.slice(0, 240);
    if (articlePayload.notes) payload.notes = articlePayload.notes.slice(0, 240);

    try {
      await setDoc(doc(db, basePath, docId), payload);
      if (isFirestoreWritesDisabled()) {
        setHomeArticles((prev) => [
          ...prev,
          {
            ...articlePayload,
            id: docId,
          },
        ]);
      }
    } catch (error) {
      await deleteVaultFiles([attachmentKey], user.uid);
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleUploadArticleDocument(
    articleId: string,
    docType: ArticleAttachmentType,
    title: string,
    provider: string,
    file: File
  ) {
    const todayIt = new Date().toLocaleDateString('it-IT');
    await handleUploadLinkedDocument(
      {
        title: title.slice(0, 80),
        category: docType === 'garanzia_extra_family' ? 'Assicurazioni' : 'Altro',
        provider: (provider || 'Casa').slice(0, 80),
        referenceCode: buildArticleDocumentRef(articleId, docType),
        issueDate: todayIt,
        pinned: docType === 'garanzia_extra_family' || docType === 'scontrino_fattura',
        notes: `Documento associato ad articolo casa (${docType})`,
      },
      file
    );
  }

  async function handleUploadResearchDocument(
    researchId: string,
    docType: ArticleAttachmentType,
    title: string,
    provider: string,
    file: File
  ) {
    const todayIt = new Date().toLocaleDateString('it-IT');
    await handleUploadLinkedDocument(
      {
        title: title.slice(0, 80),
        category: docType === 'garanzia_extra_family' ? 'Assicurazioni' : 'Altro',
        provider: (provider || 'Ricerche').slice(0, 80),
        referenceCode: buildResearchDocumentRef(researchId, docType),
        issueDate: todayIt,
        pinned: docType === 'scontrino_fattura' || docType === 'garanzia_extra_family',
        notes: `File allegato a prodotto ricercato (${docType})`,
      },
      file
    );
  }

  async function handleAddResearchDocumentLink(
    researchId: string,
    docType: ArticleAttachmentType,
    title: string,
    provider: string,
    cloudUrl: string,
    noteText?: string
  ) {
    const todayIt = new Date().toLocaleDateString('it-IT');
    await handleAddDocument({
      title: title.slice(0, 80),
      category: docType === 'garanzia_extra_family' ? 'Assicurazioni' : 'Altro',
      provider: (provider || 'Ricerche').slice(0, 80),
      referenceCode: buildResearchDocumentRef(researchId, docType),
      issueDate: todayIt,
      pinned: docType === 'scontrino_fattura' || docType === 'garanzia_extra_family',
      cloudUrl: cloudUrl.trim(),
      notes: noteText || `Documento ufficiale collegato (${docType})`,
    });
  }

  async function handleUpdateResearchDocumentType(
    docId: string,
    researchId: string,
    docType: ArticleAttachmentType
  ) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(docId)) return;
    const existingDoc = homeDocuments.find((d) => d.id === docId);
    if (!existingDoc) return;
    const { id: _ignoredId, ...rest } = existingDoc;
    const isLinkOnlyDoc = !existingDoc.fileSize && Boolean(existingDoc.cloudUrl);
    await handleUpdateDocument(docId, {
      ...rest,
      attachmentKey: isLinkOnlyDoc ? undefined : existingDoc.attachmentKey,
      category: docType === 'garanzia_extra_family' ? 'Assicurazioni' : 'Altro',
      referenceCode: buildResearchDocumentRef(researchId, docType),
      pinned: docType === 'scontrino_fattura' || docType === 'garanzia_extra_family',
    });
  }

  async function handleUpdateArticleDocumentType(
    docId: string,
    articleId: string,
    docType: ArticleAttachmentType
  ) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(docId)) return;
    const existingDoc = homeDocuments.find((d) => d.id === docId);
    if (!existingDoc) return;
    const { id: _ignoredId, ...rest } = existingDoc;
    const isLinkOnlyDoc = !existingDoc.fileSize && Boolean(existingDoc.cloudUrl);
    await handleUpdateDocument(docId, {
      ...rest,
      attachmentKey: isLinkOnlyDoc ? undefined : existingDoc.attachmentKey,
      category: docType === 'garanzia_extra_family' ? 'Assicurazioni' : 'Altro',
      referenceCode: buildArticleDocumentRef(articleId, docType),
      pinned: docType === 'garanzia_extra_family' || docType === 'scontrino_fattura',
    });
  }

  const migrationCompleted = useMemo(
    () => homeArticles.some((a) => a.id === MIGRATION_DONE_DOC_ID),
    [homeArticles]
  );

  const visibleHomeArticles = useMemo(
    () =>
      homeArticles.filter(
        (a) =>
          a.room !== SYSTEM_ROOM_CAR &&
          a.room !== SYSTEM_ROOM_GROCERY &&
          a.room !== SYSTEM_ROOM_GROCERY_META &&
          a.room !== SYSTEM_ROOM_DOCUMENTS &&
          a.room !== SYSTEM_ROOM_CLIMATE_AUTO &&
          a.room !== SYSTEM_ROOM_MIGRATION_META
      ),
    [homeArticles]
  );

  const carProfile = useMemo(
    () => articleToCarProfile(homeArticles.find((a) => a.id === CAR_PROFILE_ID)),
    [homeArticles]
  );

  const carPolicy = useMemo(
    () =>
      articleToCarInsurance(
        homeArticles.find((a) => a.id === CAR_POLICY_ID),
        Boolean(canEdit)
      ),
    [homeArticles, canEdit]
  );

  const carLogs = useMemo(
    () =>
      homeArticles
        .filter(
          (a) =>
            a.room === SYSTEM_ROOM_CAR &&
            a.id !== CAR_PROFILE_ID &&
            a.id !== CAR_POLICY_ID
        )
        .map(articleToCarLog),
    [homeArticles]
  );

  const groceryProducts = useMemo(
    () =>
      homeArticles
        .filter((a) => a.room === SYSTEM_ROOM_GROCERY)
        .map(articleToGroceryProduct),
    [homeArticles]
  );

  const homeDocuments = useMemo(
    () =>
      homeArticles
        .filter((a) => a.room === SYSTEM_ROOM_DOCUMENTS)
        .map(articleToHomeDocument),
    [homeArticles]
  );

  const carDocuments = useMemo(
    () => homeDocuments.filter(isCarLinkedDocument),
    [homeDocuments]
  );

  const articleDocuments = useMemo(
    () => homeDocuments.filter((d) => Boolean(parseArticleDocumentRef(d.referenceCode))),
    [homeDocuments]
  );

  const researchDocuments = useMemo(
    () => homeDocuments.filter((d) => Boolean(parseResearchDocumentRef(d.referenceCode))),
    [homeDocuments]
  );

  // Auto-seed ConTe.it car policy once for owner if not yet persisted
  useEffect(() => {
    if (!user || !homeArticlesLoaded || carPolicySeededRef.current) return;
    if (isFirestoreWritesDisabled()) return;
    if (homeArticles.some((a) => a.id === CAR_POLICY_ID)) {
      carPolicySeededRef.current = true;
      return;
    }
    carPolicySeededRef.current = true;
    const artPayload = carInsuranceToArticlePayload(DEFAULT_CONTE_POLICY_OWNER);
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      name: artPayload.name.slice(0, 80),
      brand: artPayload.brand.slice(0, 60),
      model: artPayload.model.slice(0, 80),
      category: artPayload.category,
      room: artPayload.room.slice(0, 60),
      familyWarranty: false,
      createdAt: serverTimestamp(),
    };
    if (artPayload.purchaseDate) payload.purchaseDate = artPayload.purchaseDate.slice(0, 20);
    if (artPayload.warrantyEnd) payload.warrantyEnd = artPayload.warrantyEnd.slice(0, 20);
    if (artPayload.serialNumber) payload.serialNumber = artPayload.serialNumber.slice(0, 80);
    if (artPayload.specs) payload.specs = artPayload.specs.slice(0, 240);
    if (artPayload.notes) payload.notes = artPayload.notes.slice(0, 240);
    if (artPayload.manualExtractText) {
      payload.manualExtractText = artPayload.manualExtractText.slice(0, 12_000);
    }
    void setDoc(doc(db, `users/${user.uid}/homeArticles/${CAR_POLICY_ID}`), payload).catch(
      (err) => {
        console.warn('Auto-seed polizza ConTe.it saltato:', err);
      }
    );
  }, [user, homeArticlesLoaded, homeArticles]);

  const vmcDaysMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const v of vmcDays) {
      if (v.date) map.set(v.date, Boolean(v.enabled));
    }
    return map;
  }, [vmcDays]);

  const climateAutopilot = useMemo<ClimateAutopilotConfig | null>(
    () =>
      articleToClimateAutopilot(
        homeArticles.find((a) => a.id === CLIMATE_AUTOPILOT_DOC_ID)
      ) ?? (!activeUid ? publicClimateAutopilot : null),
    [homeArticles, activeUid, publicClimateAutopilot]
  );

  const effectiveClimateLogs = useMemo(() => {
    const logsOwnerUid = activeUid ?? publicOwnerUid;
    if (!climateAutopilot?.active || !logsOwnerUid) return climateLogs;
    const existingDates = new Set(climateLogs.map((l) => l.date));
    const dates = enumerateIsoDatesInclusive(climateAutopilot.startDate, todayIso);
    if (dates.length === 0) return climateLogs;
    const missing = dates
      .filter((d) => !existingDates.has(d))
      .map((d) => buildAutopilotSessionForDate(d, climateAutopilot, logsOwnerUid));
    if (missing.length === 0) return climateLogs;
    return [...climateLogs, ...missing];
  }, [climateLogs, climateAutopilot, todayIso, activeUid, publicOwnerUid]);

  async function handleActivateClimateAutopilot(input: ClimateAutopilotInput) {
    if (!user) return;
    const datesToApply =
      input.startDate <= todayIso ? enumerateIsoDatesInclusive(input.startDate, todayIso) : [];
    const lastAppliedDate =
      datesToApply.length > 0 ? datesToApply[datesToApply.length - 1] : addDaysIso(input.startDate, -1);

    const nextCfg: ClimateAutopilotConfig = {
      active: true,
      mode: input.mode,
      startTime: input.startTime,
      endTime: input.endTime,
      timeSlots: input.timeSlots,
      vmcMax: input.vmcMax,
      targetTemp: input.targetTemp,
      rooms: input.rooms,
      startDate: input.startDate,
      lastAppliedDate,
      notes: input.notes,
    };

    const batch = writeBatch(db);
    const logsPath = `users/${user.uid}/climateLogs`;
    const applyDateSet = new Set(datesToApply);
    for (const dateIso of datesToApply) {
      const session = buildAutopilotSessionForDate(dateIso, nextCfg, user.uid);
      const logPayload: Record<string, unknown> = {
        ownerId: user.uid,
        date: session.date,
        mode: session.mode,
        startTime: session.startTime,
        endTime: session.endTime,
        vmcMax: Boolean(session.vmcMax),
        targetTemp: session.targetTemp,
        rooms: session.rooms,
        createdAt: serverTimestamp(),
      };
      if (Array.isArray(session.timeSlots) && session.timeSlots.length > 1) {
        logPayload.timeSlots = session.timeSlots.slice(0, 6);
      }
      if (session.notes) {
        logPayload.notes = session.notes.slice(0, 240);
      }
      batch.set(doc(db, logsPath, session.id), logPayload);

      if (vmcDaysMap.has(dateIso) || nextCfg.vmcMax) {
        batch.set(doc(db, `users/${user.uid}/vmcDays`, `vmc_${dateIso.replace(/-/g, '')}`), {
          ownerId: user.uid,
          date: dateIso,
          enabled: Boolean(nextCfg.vmcMax),
          createdAt: serverTimestamp(),
        });
      }
    }

    // Remove older manual/duplicate logs on explicitly applied autopilot dates so the banner and table stay 1:1
    for (const existing of climateLogs) {
      if (applyDateSet.has(existing.date) && existing.id !== getAutoClimateDocId(existing.date)) {
        batch.delete(doc(db, logsPath, existing.id));
      }
    }

    const artPayload = climateAutopilotToArticlePayload(nextCfg);
    const statePayload: Record<string, unknown> = {
      ownerId: user.uid,
      name: artPayload.name.slice(0, 80),
      brand: artPayload.brand.slice(0, 60),
      model: artPayload.model.slice(0, 80),
      category: artPayload.category,
      room: artPayload.room.slice(0, 60),
      familyWarranty: Boolean(artPayload.familyWarranty),
      createdAt: serverTimestamp(),
    };
    if (artPayload.purchaseDate) statePayload.purchaseDate = artPayload.purchaseDate.slice(0, 20);
    if (artPayload.warrantyEnd) statePayload.warrantyEnd = artPayload.warrantyEnd.slice(0, 20);
    if (artPayload.serialNumber) statePayload.serialNumber = artPayload.serialNumber.slice(0, 80);
    if (artPayload.specs) statePayload.specs = artPayload.specs.slice(0, 240);
    if (artPayload.notes) statePayload.notes = artPayload.notes.slice(0, 240);

    const statePath = `users/${user.uid}/homeArticles/${CLIMATE_AUTOPILOT_DOC_ID}`;
    batch.set(doc(db, statePath), statePayload);

    const slotsKey = getAutopilotSlots(nextCfg).map(formatTimeSlotString).join(',');
    try {
      lastAutopilotSyncKeyRef.current = `${user.uid}:${todayIso}:${nextCfg.startDate}:${nextCfg.mode}:${slotsKey}:${nextCfg.vmcMax ? 1 : 0}:${nextCfg.targetTemp}`;
      await batch.commit();
      if (isFirestoreWritesDisabled()) {
        setHomeArticles((prev) => {
          const rest = prev.filter((a) => a.id !== CLIMATE_AUTOPILOT_DOC_ID);
          return [...rest, { ...artPayload, id: CLIMATE_AUTOPILOT_DOC_ID }];
        });
        setClimateLogs((prev) => {
          const filtered = prev.filter(
            (l) => !(applyDateSet.has(l.date) && l.id !== getAutoClimateDocId(l.date))
          );
          const existingAutoIds = new Set(filtered.map((l) => l.id));
          const additions = datesToApply
            .map((d) => buildAutopilotSessionForDate(d, nextCfg, user.uid))
            .filter((s) => !existingAutoIds.has(s.id));
          return [...filtered, ...additions];
        });
      }
    } catch (error) {
      if (!isResilientFirestoreOutage(error)) {
        handleFirestoreError(error, OperationType.WRITE, statePath);
      }
    }
  }

  async function handleTurnOffClimateAutopilot(removeTodayAutoSession: boolean) {
    if (!user || !climateAutopilot) return;
    const nextCfg: ClimateAutopilotConfig = {
      ...climateAutopilot,
      active: false,
    };
    const batch = writeBatch(db);
    const artPayload = climateAutopilotToArticlePayload(nextCfg);
    const statePayload: Record<string, unknown> = {
      ownerId: user.uid,
      name: artPayload.name.slice(0, 80),
      brand: artPayload.brand.slice(0, 60),
      model: artPayload.model.slice(0, 80),
      category: artPayload.category,
      room: artPayload.room.slice(0, 60),
      familyWarranty: false,
      createdAt: serverTimestamp(),
    };
    if (artPayload.purchaseDate) statePayload.purchaseDate = artPayload.purchaseDate.slice(0, 20);
    if (artPayload.warrantyEnd) statePayload.warrantyEnd = artPayload.warrantyEnd.slice(0, 20);
    if (artPayload.serialNumber) statePayload.serialNumber = artPayload.serialNumber.slice(0, 80);
    if (artPayload.specs) statePayload.specs = artPayload.specs.slice(0, 240);
    if (artPayload.notes) statePayload.notes = artPayload.notes.slice(0, 240);

    const statePath = `users/${user.uid}/homeArticles/${CLIMATE_AUTOPILOT_DOC_ID}`;
    batch.set(doc(db, statePath), statePayload);

    if (removeTodayAutoSession) {
      for (const log of climateLogs.filter((l) => l.date === todayIso)) {
        batch.delete(doc(db, `users/${user.uid}/climateLogs/${log.id}`));
      }
      const todayDocId = getAutoClimateDocId(todayIso);
      batch.delete(doc(db, `users/${user.uid}/climateLogs/${todayDocId}`));
    }

    try {
      await batch.commit();
      if (isFirestoreWritesDisabled()) {
        setHomeArticles((prev) => {
          const rest = prev.filter((a) => a.id !== CLIMATE_AUTOPILOT_DOC_ID);
          return [...rest, { ...artPayload, id: CLIMATE_AUTOPILOT_DOC_ID, familyWarranty: false }];
        });
        if (removeTodayAutoSession) {
          setClimateLogs((prev) => prev.filter((l) => l.date !== todayIso));
        }
      }
    } catch (error) {
      if (!isResilientFirestoreOutage(error)) {
        handleFirestoreError(error, OperationType.WRITE, statePath);
      }
    }
  }

  // Automatic daily propagation of the active climate combination across subsequent days
  useEffect(() => {
    if (!user || !climateAutopilot || !climateAutopilot.active) return;
    if (isFirestoreWritesDisabled()) return;
    if (climateAutopilot.startDate > todayIso) return;
    if (autopilotSyncInFlightRef.current) return;

    const existingDates = new Set(climateLogs.map((l) => l.date));
    const dates = enumerateIsoDatesInclusive(climateAutopilot.startDate, todayIso);
    const missingDates = dates.filter((d) => !existingDates.has(d));
    const needsStateAdvance = climateAutopilot.lastAppliedDate < todayIso;

    if (missingDates.length === 0 && !needsStateAdvance) return;

    const slotsKey = getAutopilotSlots(climateAutopilot).map(formatTimeSlotString).join(',');
    const syncKey = `${user.uid}:${todayIso}:${climateAutopilot.startDate}:${missingDates.length}:${climateAutopilot.mode}:${slotsKey}:${climateAutopilot.vmcMax ? 1 : 0}:${climateAutopilot.targetTemp}`;
    if (lastAutopilotSyncKeyRef.current === syncKey) return;
    lastAutopilotSyncKeyRef.current = syncKey;
    autopilotSyncInFlightRef.current = true;

    const updatedCfg: ClimateAutopilotConfig = {
      ...climateAutopilot,
      lastAppliedDate: todayIso,
    };

    const batch = writeBatch(db);
    const logsPath = `users/${user.uid}/climateLogs`;
    for (const dateIso of missingDates) {
      const session = buildAutopilotSessionForDate(dateIso, updatedCfg, user.uid);
      const logPayload: Record<string, unknown> = {
        ownerId: user.uid,
        date: session.date,
        mode: session.mode,
        startTime: session.startTime,
        endTime: session.endTime,
        vmcMax: Boolean(session.vmcMax),
        targetTemp: session.targetTemp,
        rooms: session.rooms,
        createdAt: serverTimestamp(),
      };
      if (Array.isArray(session.timeSlots) && session.timeSlots.length > 1) {
        logPayload.timeSlots = session.timeSlots.slice(0, 6);
      }
      if (session.notes) {
        logPayload.notes = session.notes.slice(0, 240);
      }
      batch.set(doc(db, logsPath, session.id), logPayload);
    }

    const artPayload = climateAutopilotToArticlePayload(updatedCfg);
    const statePayload: Record<string, unknown> = {
      ownerId: user.uid,
      name: artPayload.name.slice(0, 80),
      brand: artPayload.brand.slice(0, 60),
      model: artPayload.model.slice(0, 80),
      category: artPayload.category,
      room: artPayload.room.slice(0, 60),
      familyWarranty: true,
      createdAt: serverTimestamp(),
    };
    if (artPayload.purchaseDate) statePayload.purchaseDate = artPayload.purchaseDate.slice(0, 20);
    if (artPayload.warrantyEnd) statePayload.warrantyEnd = artPayload.warrantyEnd.slice(0, 20);
    if (artPayload.serialNumber) statePayload.serialNumber = artPayload.serialNumber.slice(0, 80);
    if (artPayload.specs) statePayload.specs = artPayload.specs.slice(0, 240);
    if (artPayload.notes) statePayload.notes = artPayload.notes.slice(0, 240);

    batch.set(doc(db, `users/${user.uid}/homeArticles/${CLIMATE_AUTOPILOT_DOC_ID}`), statePayload);

    batch
      .commit()
      .catch((err) => {
        console.warn('Autopilot daily propagation warning:', err);
      })
      .finally(() => {
        autopilotSyncInFlightRef.current = false;
      });
  }, [user, climateAutopilot, climateLogs, todayIso]);

  async function handleUpdateArticle(
    id: string,
    article: Omit<HomeArticleRecord, 'id'>,
    manualFile?: File
  ) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/homeArticles/${id}`;
    const existingManualKey = homeArticles.find((entry) => entry.id === id)?.manualFileKey;
    const uploadedManual = manualFile ? await saveArticleManual(manualFile, id) : undefined;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      name: article.name.slice(0, 80),
      brand: article.brand.slice(0, 60),
      model: article.model.slice(0, 80),
      category: article.category,
      room: article.room.slice(0, 60),
      familyWarranty: Boolean(article.familyWarranty),
      createdAt: serverTimestamp(),
    };
    if (article.purchaseDate && article.purchaseDate.trim()) {
      payload.purchaseDate = article.purchaseDate.trim().slice(0, 20);
    }
    if (
      typeof article.purchasePriceEur === 'number' &&
      Number.isFinite(article.purchasePriceEur) &&
      article.purchasePriceEur >= 0
    ) {
      payload.purchasePriceEur = Math.min(
        1000000,
        Math.round(article.purchasePriceEur * 100) / 100
      );
    }
    if (article.warrantyEnd && article.warrantyEnd.trim()) {
      payload.warrantyEnd = article.warrantyEnd.trim().slice(0, 20);
    }
    if (article.serialNumber && article.serialNumber.trim()) {
      payload.serialNumber = article.serialNumber.trim().slice(0, 80);
    }
    if (article.specs && article.specs.trim()) {
      payload.specs = article.specs.trim().slice(0, 240);
    }
    if (article.notes && article.notes.trim()) {
      payload.notes = article.notes.trim().slice(0, 240);
    }
    if (uploadedManual) {
      payload.manualFileKey = uploadedManual.key;
      payload.manualFileName = uploadedManual.fileName;
    } else if (article.manualFileKey) {
      payload.manualFileKey = article.manualFileKey;
      if (article.manualFileName) payload.manualFileName = article.manualFileName;
    }
    if (article.manualExtractText?.trim()) {
      payload.manualExtractText = article.manualExtractText.trim().slice(0, 12_000);
    }
    const prevArticle = homeArticles.find((entry) => entry.id === id);
    const artUpdateDiff = diffHomeArticleFields(prevArticle, article, id);
    const changedArticleKeys = new Set(artUpdateDiff.changedFields);
    if (prevArticle) {
      if ((prevArticle.manualFileName || '') !== (uploadedManual?.fileName || article.manualFileName || '')) {
        changedArticleKeys.add('manualFileKey');
        changedArticleKeys.add('manualFileName');
      }
      if ((prevArticle.manualExtractText || '').trim() !== (article.manualExtractText || '').trim()) {
        changedArticleKeys.add('manualExtractText');
      }
    }
    const optionalArticleFields = [
      'purchaseDate',
      'purchasePriceEur',
      'warrantyEnd',
      'serialNumber',
      'specs',
      'notes',
      'manualFileKey',
      'manualFileName',
      'manualExtractText',
    ];
    if (prevArticle && changedArticleKeys.size === 0 && !manualFile) {
      return;
    }
    const baseArticleRaw = rawSnapshotsRef.current.homeArticles?.find((d) => d.id === id);
    const baseArticle =
      isFirestoreWritesDisabled() && baseArticleRaw
        ? mapRawHomeArticles([baseArticleRaw])[0]
        : undefined;
    const queueArtDiff = baseArticle
      ? diffHomeArticleFields(
          baseArticle,
          {
            ...article,
            manualFileKey: uploadedManual?.key ?? article.manualFileKey,
            manualFileName: uploadedManual?.fileName ?? article.manualFileName,
          },
          id
        )
      : artUpdateDiff;
    let useArticleMerge = false;
    let articleWritePayload: Record<string, unknown> = payload;
    if (prevArticle && changedArticleKeys.size > 0) {
      useArticleMerge = true;
      const partialArticlePayload: Record<string, unknown> = {
        ownerId: user.uid,
      };
      if (changedArticleKeys.has('manualFileKey')) {
        changedArticleKeys.add('manualFileName');
      }
      for (const key of changedArticleKeys) {
        if (key in payload) {
          partialArticlePayload[key] = payload[key];
        } else if (optionalArticleFields.includes(key)) {
          partialArticlePayload[key] = deleteField();
        }
      }
      articleWritePayload = partialArticlePayload;
    }
    try {
      setSimulatedOpDetailHint(path, {
        title: article.name.slice(0, 80),
        actionLabel: 'Modifica',
        changedFields: queueArtDiff.changedFields,
        changedDetails: queueArtDiff.changedDetails,
      });
      if (useArticleMerge) {
        await setDoc(doc(db, path), articleWritePayload, { merge: true });
      } else {
        await setDoc(doc(db, path), articleWritePayload);
      }
      if (isFirestoreWritesDisabled()) {
        setHomeArticles((prev) => {
          const exists = prev.some((entry) => entry.id === id);
          const updated: HomeArticleRecord = {
            ...article,
            id,
            manualFileKey: uploadedManual?.key ?? article.manualFileKey,
            manualFileName: uploadedManual?.fileName ?? article.manualFileName,
          };
          return exists
            ? prev.map((entry) => (entry.id === id ? updated : entry))
            : [...prev, updated];
        });
      }
    } catch (error) {
      if (uploadedManual) {
        await deleteVaultFile(uploadedManual.key, user.uid);
      }
      handleFirestoreError(error, OperationType.UPDATE, path);
      throw error;
    }
    const newManualKey = uploadedManual?.key || article.manualFileKey;
    if (existingManualKey && existingManualKey !== newManualKey) {
      await deleteVaultFiles([existingManualKey], user.uid);
    }
  }

  async function handleDeleteLinkedDocument(docId: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(docId)) return;
    const targetDoc = homeDocuments.find((d) => d.id === docId);
    const path = `users/${user.uid}/homeArticles/${docId}`;
    if (targetDoc) {
      setSimulatedOpTitleHint(path, targetDoc.title || targetDoc.fileName || docId);
    }
    try {
      await deleteDoc(doc(db, path));
      if (targetDoc?.attachmentKey) {
        await deleteVaultFiles([targetDoc.attachmentKey], user.uid);
      }
      if (isFirestoreWritesDisabled()) {
        setHomeArticles((prev) => prev.filter((a) => a.id !== docId));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
      throw error;
    }
  }

  async function handleDeleteArticle(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/homeArticles/${id}`;
    const article = homeArticles.find((entry) => entry.id === id);
    if (article) {
      setSimulatedOpTitleHint(path, article.name || id);
    }
    const linkedDocs = articleDocuments.filter(
      (d) => parseArticleDocumentRef(d.referenceCode)?.articleId === id
    );
    try {
      await deleteDoc(doc(db, path));
      const keysToDelete: string[] = [];
      if (article?.manualFileKey) keysToDelete.push(article.manualFileKey);
      for (const linked of linkedDocs) {
        if (/^[a-zA-Z0-9_-]+$/.test(linked.id)) {
          const linkedPath = `users/${user.uid}/homeArticles/${linked.id}`;
          setSimulatedOpTitleHint(linkedPath, linked.title || linked.fileName || linked.id);
          await deleteDoc(doc(db, linkedPath));
        }
        if (linked.attachmentKey) keysToDelete.push(linked.attachmentKey);
      }
      if (keysToDelete.length > 0) {
        await deleteVaultFiles(keysToDelete, user.uid);
      }
      if (isFirestoreWritesDisabled()) {
        const deletedIds = new Set([id, ...linkedDocs.map((d) => d.id)]);
        setHomeArticles((prev) => prev.filter((a) => !deletedIds.has(a.id)));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
      throw error;
    }
  }

  async function handleDownloadArticleManual(fileKey: string): Promise<void> {
    if (!user) throw new Error('Accedi per scaricare il manuale archiviato.');
    const stored = await getVaultFile(fileKey, user.uid);
    if (!stored) throw new Error('Il manuale non è stato trovato nel vault Firebase.');

    const downloadUrl = URL.createObjectURL(stored.blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = stored.fileName || 'manuale.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
  }

  function handleExportFullBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      projectId: FIREBASE_PROJECT_ID,
      homeConfig,
      settings: appSettings,
      readings,
      climateLogs,
      vmcDays,
      electricityBills,
      waterBills,
      tariBills,
      gsePayments,
      articles: visibleHomeArticles,
      researches: productResearches,
      documents: homeDocuments,
      carProfile,
      carPolicy,
      carLogs,
      groceries: groceryProducts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    triggerBlobDownload(blob, `my-home-backup-${getLocalTodayIso()}.json`);
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-xs text-slate-600 dark:text-slate-400">
          Caricamento sistema domotico...
        </div>
      </div>
    );
  }

  const currentNavLabel =
    NAV_ITEMS.find((n) => n.id === activeNav)?.label || 'Consumi Annuali';
  const sidebarPinned = appSettings.sidebarAlwaysExpanded;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex transition-colors duration-150">
      {/* Desktop Sidebar */}
      <aside
        className={`group hidden md:flex md:flex-col md:fixed md:inset-y-0 left-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-r border-slate-200 dark:border-slate-800 transition-all duration-200 overflow-hidden ${
          sidebarPinned
            ? 'md:w-60'
            : 'md:w-14 hover:md:w-60 hover:shadow-2xl hover:shadow-slate-900/15 dark:hover:shadow-black/60'
        }`}
      >
        <div className="h-14 px-3.5 flex items-center border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => navigateToSection('panoramica')}
            className="inline-flex items-center gap-3 text-slate-900 dark:text-slate-100 font-bold tracking-tight text-base whitespace-nowrap"
          >
            <Home className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
            <span
              className={`transition-opacity duration-150 ${
                sidebarPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              my-home
            </span>
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => navigateToSection(item.id)}
                className={`w-full flex items-center gap-3 px-2.5 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap overflow-hidden ${
                  active
                    ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span
                  className={`min-w-0 truncate transition-opacity duration-150 ${
                    sidebarPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          {user ? (
            <>
              <div
                className={`min-w-0 transition-opacity duration-150 pl-1 ${
                  sidebarPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  {user.displayName || 'Proprietario'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {user.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => signOut(auth)}
                aria-label="Esci"
                title="Esci"
                className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              title="Accedi con Google per modificare"
              className="w-full flex items-center justify-center gap-2 py-2 px-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap overflow-hidden"
            >
              <span className={`${sidebarPinned ? 'hidden' : 'group-hover:hidden'} font-bold`}>
                G
              </span>
              <span className={sidebarPinned ? 'inline' : 'hidden group-hover:inline'}>
                Accedi con Google
              </span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 dark:bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-50">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">my-home</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 dark:text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigateToSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg ${
                      active
                        ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[padding] duration-200 ${
          sidebarPinned ? 'md:pl-60' : 'md:pl-14'
        }`}
      >
        <header className="h-14 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Apri menu"
              className="md:hidden p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 truncate">
              <span className="hidden sm:inline">mauriziominieri.github.io</span>
              <span className="hidden sm:inline">/</span>
              <span className="hidden sm:inline">my-home</span>
              <span className="hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {currentNavLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden md:block text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
              POD <span className="text-sky-600 dark:text-sky-400">{homeConfig.podCode}</span> · 6 kW
            </div>

            {(appSettings.firestoreWritesDisabled || simulatedOps.length > 0) && (
              <button
                type="button"
                onClick={() =>
                  simulatedOps.length > 0
                    ? setShowSimulatedQueuePanel((prev) => !prev)
                    : navigateToSection('impostazioni')
                }
                aria-expanded={simulatedOps.length > 0 ? showSimulatedQueuePanel : undefined}
                title={
                  appSettings.firestoreWritesDisabled
                    ? 'Modalità Test attiva: clicca per aprire l’elenco delle operazioni simulate'
                    : 'Operazioni simulate in locale in attesa di invio a Firestore'
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                  showSimulatedQueuePanel && simulatedOps.length > 0
                    ? 'bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-500 dark:text-slate-950 dark:border-indigo-400 shadow-xs'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-500/35 dark:hover:bg-indigo-500/25'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">
                  {appSettings.firestoreWritesDisabled
                    ? `Test DB (${simulatedOps.length})`
                    : `Coda DB (${simulatedOps.length})`}
                </span>
                <span className="sm:hidden">{simulatedOps.length}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                updateAppSettings({
                  theme: appSettings.theme === 'dark' ? 'light' : 'dark',
                })
              }
              title={
                appSettings.theme === 'dark'
                  ? 'Passa a Light Mode'
                  : 'Passa a Dark Mode'
              }
              aria-label={
                appSettings.theme === 'dark'
                  ? 'Passa a Light Mode'
                  : 'Passa a Dark Mode'
              }
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/80 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              {appSettings.theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5 text-sky-400" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-sky-600" />
              )}
            </button>

            {canEdit ? (
              <button
                type="button"
                onClick={handleManualGmailSync}
                disabled={gmailSyncing}
                title={
                  gmailToken
                    ? appSettings.autoGmailSyncEnabled
                      ? `Controlla ora la INBOX di Gmail (auto ogni ${appSettings.autoGmailSyncIntervalMinutes} min)`
                      : 'Controlla ora la INBOX di Gmail'
                    : 'Collega e sincronizza ora la INBOX di Gmail'
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
              >
                {gmailSyncing ? (
                  <RefreshCw className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin" />
                ) : (
                  <Mail className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                )}
                <span>
                  {gmailSyncing
                    ? 'Controllo Gmail...'
                    : gmailToken
                      ? 'Sincronizza Gmail'
                      : 'Collega Gmail'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-xs transition-colors whitespace-nowrap"
              >
                <svg
                  className="w-3.5 h-3.5 shrink-0"
                  viewBox="0 0 48 48"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>Sign in with Google</span>
              </button>
            )}
          </div>
        </header>

        {(appSettings.firestoreWritesDisabled ||
          simulatedOps.length > 0 ||
          flushState.flushing ||
          flushState.lastResult ||
          firestoreQuotaExceeded) && (
          <div className="sticky top-14 z-30 shadow-xs">
            {appSettings.firestoreWritesDisabled && (
              <div className="px-4 sm:px-6 py-1.5 sm:py-2 bg-indigo-50/95 border-b border-indigo-200 text-xs text-indigo-900 dark:bg-indigo-950/90 backdrop-blur-md dark:border-indigo-500/35 dark:text-indigo-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FlaskConical className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300 shrink-0" />
                  <span className="truncate sm:whitespace-normal">
                    <strong>Modalità Test Browser attiva:</strong>{' '}
                    <span className="hidden md:inline">
                      tutte le modifiche sono salvate in locale con 0 quota consumata{' '}
                    </span>
                    ({simulatedOps.length}{' '}
                    {simulatedOps.length === 1
                      ? 'operazione simulata in coda'
                      : 'operazioni simulate in coda'}
                    {writeStats.writesSavedCount > 0
                      ? ` · ${writeStats.writesSavedCount} scritture risparmiate`
                      : ''}
                    ).
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
                  {simulatedOps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSimulatedQueuePanel((prev) => !prev)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-indigo-300 dark:border-indigo-400/50 bg-white/85 hover:bg-white text-indigo-800 dark:bg-indigo-900/60 dark:hover:bg-indigo-900 dark:text-indigo-100 transition-colors"
                    >
                      {showSimulatedQueuePanel
                        ? 'Nascondi operazioni'
                        : `Vedi operazioni (${simulatedOps.length})`}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={flushState.flushing}
                    onClick={() => updateAppSettings({ firestoreWritesDisabled: false })}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950 transition-colors disabled:opacity-60"
                  >
                    {simulatedOps.length > 0
                      ? `Riattiva DB e salva (${simulatedOps.length})`
                      : 'Riattiva scritture DB'}
                  </button>
                  {activeNav !== 'impostazioni' && (
                    <button
                      type="button"
                      onClick={() => navigateToSection('impostazioni')}
                      className="hidden sm:inline-block px-2 py-1 text-[11px] font-medium underline text-indigo-700 dark:text-indigo-300 hover:opacity-80"
                    >
                      Impostazioni
                    </button>
                  )}
                </div>
              </div>
            )}

            {!appSettings.firestoreWritesDisabled && simulatedOps.length > 0 && (
              <div className="px-4 sm:px-6 py-1.5 sm:py-2 bg-sky-50/95 border-b border-sky-200 text-xs text-sky-900 dark:bg-sky-950/90 backdrop-blur-md dark:border-sky-500/35 dark:text-sky-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300 shrink-0" />
                  <span>
                    <strong>Operazioni simulate in attesa:</strong>{' '}
                    {simulatedOps.length}{' '}
                    {simulatedOps.length === 1
                      ? 'operazione salvata in locale non è ancora su Firestore.'
                      : 'operazioni salvate in locale non sono ancora su Firestore.'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowSimulatedQueuePanel((prev) => !prev)}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-sky-300 dark:border-sky-400/50 bg-white/85 hover:bg-white text-sky-800 dark:bg-sky-900/60 dark:hover:bg-sky-900 dark:text-sky-100 transition-colors"
                  >
                    {showSimulatedQueuePanel
                      ? 'Nascondi coda'
                      : `Vedi operazioni (${simulatedOps.length})`}
                  </button>
                  <button
                    type="button"
                    disabled={flushState.flushing || !canEdit}
                    onClick={() => void flushSimulatedFirestoreOps()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 transition-colors disabled:opacity-50"
                  >
                    <CloudUpload className="w-3 h-3" />
                    <span>Invia ora su Firestore</span>
                  </button>
                </div>
              </div>
            )}

            {showSimulatedQueuePanel && simulatedOps.length > 0 && (
              <div className="px-4 sm:px-6 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-lg space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>
                      Operazioni simulate salvate in locale ({simulatedOps.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={flushState.flushing}
                      onClick={() => clearSimulatedFirestoreOps()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3 text-rose-500" />
                      <span>Svuota coda</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSimulatedQueuePanel(false)}
                      className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      Chiudi
                    </button>
                  </div>
                </div>
                <div className="max-h-[45vh] sm:max-h-60 overflow-y-auto space-y-1.5 pr-1">
                  {simulatedOps.map((op) => {
                    const timeStr = new Date(op.createdAt).toLocaleTimeString('it-IT', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    });
                    const badgeCls =
                      op.kind === 'delete' || op.kind === 'vault_delete'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                        : op.kind === 'vault_upload'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                          : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300';
                    return (
                      <div
                        key={op.id}
                        className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${badgeCls}`}>
                              {op.actionLabel}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                              {op.section}
                            </span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {op.targetTitle}
                            </span>
                          </div>
                          {op.changedDetails && op.changedDetails.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {op.changedDetails.map((detail, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-500/12 dark:text-amber-300 dark:border-amber-500/30 text-[10px] font-medium"
                                >
                                  {detail}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {timeStr} · {op.writeCount} op
                          </span>
                          <button
                            type="button"
                            disabled={flushState.flushing}
                            onClick={() => discardSimulatedFirestoreOp(op.id)}
                            title="Rimuovi questa operazione dalla coda"
                            className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(flushState.flushing || flushState.lastResult) && (
              <div
                className={`px-4 sm:px-6 py-2 border-b text-xs backdrop-blur-md flex flex-wrap items-center justify-between gap-2 ${
                  flushState.flushing
                    ? 'bg-sky-50/95 border-sky-200 text-sky-900 dark:bg-sky-950/90 dark:border-sky-500/35 dark:text-sky-100'
                    : flushState.lastResult?.failed
                      ? 'bg-amber-50/95 border-amber-200 text-amber-950 dark:bg-amber-950/90 dark:border-amber-500/35 dark:text-amber-100'
                      : 'bg-emerald-50/95 border-emerald-200 text-emerald-950 dark:bg-emerald-950/90 dark:border-emerald-500/35 dark:text-emerald-100'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {flushState.flushing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>
                    {flushState.flushing
                      ? 'Sincronizzazione su Firestore delle operazioni simulate in locale in corso...'
                      : flushState.lastResult?.failed
                        ? `Sincronizzate ${flushState.lastResult.flushed} su ${flushState.lastResult.total} operazioni su Firestore. ${flushState.lastResult.errorMessage || ''}`
                        : `Sincronizzazione completata: ${flushState.lastResult?.flushed || 0} ${(flushState.lastResult?.flushed || 0) === 1 ? 'operazione simulata salvata' : 'operazioni simulate salvate'} su Firestore.`}
                  </span>
                </div>
                {!flushState.flushing && flushState.lastResult && (
                  <button
                    type="button"
                    onClick={() => dismissSimulatedFlushResult()}
                    className="text-xs font-semibold opacity-75 hover:opacity-100"
                  >
                    Chiudi
                  </button>
                )}
              </div>
            )}

            {firestoreQuotaExceeded && (
              <div
                role="alert"
                className="px-4 sm:px-6 py-2.5 bg-amber-50/95 border-b border-amber-300 text-amber-950 dark:bg-amber-950/95 backdrop-blur-sm dark:border-amber-500/50 text-xs dark:text-amber-100 flex flex-wrap items-center justify-between gap-2.5 shadow-md"
              >
                <div className="flex items-start sm:items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                  <span className="leading-relaxed">
                    <strong className="font-semibold text-amber-900 dark:text-amber-200">
                      Quota gratuita giornaliera Firestore esaurita:
                    </strong>{' '}
                    i nuovi salvataggi e il caricamento file su cloud sono bloccati fino al reset automatico di domani.{' '}
                    <a
                      href="https://firebase.google.com/pricing#cloud-firestore"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 font-medium"
                    >
                      Dettagli limiti Spark
                    </a>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => dismissFirestoreQuotaExceeded()}
                  className="text-amber-700 hover:text-amber-950 dark:text-amber-200/80 dark:hover:text-amber-100 p-1 rounded shrink-0"
                  aria-label="Chiudi avviso quota Firestore"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {authError && (
          <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/30 text-xs dark:text-rose-200 flex items-center justify-between gap-2">
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-rose-600 hover:text-rose-900 dark:text-rose-300/80 dark:hover:text-rose-100 p-0.5 shrink-0"
              aria-label="Chiudi errore autenticazione"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {gmailNotice && (
          <div
            className={`px-5 py-2 border-b text-xs flex items-center justify-between gap-2 ${
              gmailNotice.tone === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-200'
                : gmailNotice.tone === 'warn'
                  ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-200'
                  : 'bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{gmailNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setGmailNotice(null)}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 p-0.5"
              aria-label="Chiudi avviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {firestoreFallbackNotice && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 text-xs dark:text-amber-200 flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0" />
            <span>{firestoreFallbackNotice}</span>
          </div>
        )}

        <VaultCloudNotice />

        {user && !readingsLoading && !migrationCompleted && !migrationDismissed && (
          <div className="px-5 py-2.5 bg-sky-50 border-b border-sky-200 text-sky-900 dark:bg-sky-500/10 dark:border-sky-500/30 text-xs dark:text-sky-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              <Database className="w-4 h-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-semibold text-sky-800 dark:text-sky-200">
                  Nuovo DB unificato attivo (gen-lang-client-0721850501):
                </span>{' '}
                <span>
                  {migrationProgress
                    ? migrationProgress
                    : 'importa con 1 click tutti i dati storici, bollette, spesa, auto, clima e PDF dal vecchio database (spiritual-bearing-sq7xb).'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleRunLegacyMigration()}
                disabled={migratingDb}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-md transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${migratingDb ? 'animate-spin' : ''}`} />
                <span>
                  {migratingDb ? 'Migrazione in corso...' : 'Migra dati e PDF dal vecchio DB'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMigrationDismissed(true)}
                disabled={migratingDb}
                className="p-1 text-sky-700/70 hover:text-sky-900 dark:text-sky-200/70 dark:hover:text-sky-100"
                aria-label="Nascondi banner migrazione"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {pendingTrashMessages.length > 0 && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:border-rose-500/30 flex items-center justify-center dark:text-rose-300 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Spostare {pendingTrashMessages.length}{' '}
                      {pendingTrashMessages.length === 1 ? 'email' : 'email'} nel Cestino di Gmail?
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      I dati estratti sono già stati salvati su Firebase Firestore.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleKeepMessagesInInbox}
                  disabled={trashingEmails}
                  className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded"
                  aria-label="Annulla"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                {pendingTrashMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="bg-slate-50 border border-slate-200 dark:bg-slate-950/70 dark:border-slate-800 rounded-lg p-2.5 text-xs space-y-0.5"
                  >
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {msg.subject}
                    </div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                      {msg.summary}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{msg.from}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleKeepMessagesInInbox}
                  disabled={trashingEmails}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  Mantieni in INBOX
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTrashMessages}
                  disabled={trashingEmails}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {trashingEmails
                      ? 'Spostamento...'
                      : `Sposta nel Cestino (${pendingTrashMessages.length})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        <main
          className={`flex-1 min-w-0 overflow-x-hidden max-w-[1800px] w-full mx-auto ${
            appSettings.compactDensity ? 'px-2.5 sm:px-4 py-3' : 'px-3 sm:px-5 py-4 sm:py-5'
          }`}
        >
          {activeNav === 'panoramica' && (
            <OverviewView
              config={homeConfig}
              readings={readings}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              availableYears={AVAILABLE_YEARS}
              loading={readingsLoading}
              onNavigate={navigateToSection}
            />
          )}

          {activeNav === 'consumi' && (
            <EnergyDatabaseView
              readings={readings}
              climateLogs={effectiveClimateLogs}
              vmcDaysMap={vmcDaysMap}
              climateAutopilot={climateAutopilot}
              homeConfig={homeConfig}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              availableYears={AVAILABLE_YEARS}
              loading={readingsLoading}
              readOnly={!canEdit}
              isGmailConnected={Boolean(gmailToken)}
              onSignIn={handleSignIn}
              onConnectGmail={handleManualGmailSync}
              onActivateAutopilot={handleActivateClimateAutopilot}
              onTurnOffAutopilot={handleTurnOffClimateAutopilot}
              onAddClimateLog={handleAddClimateLog}
              onUpdateClimateLog={handleUpdateClimateLog}
              onDeleteClimateLog={handleDeleteClimateLog}
              onToggleVmcDays={handleToggleVmcDays}
              onNavigate={navigateToSection}
            />
          )}

          {activeNav === 'domotica' && (
            <DomoticsView
              config={homeConfig}
              readings={readings}
              climateLogs={effectiveClimateLogs}
              vmcDaysMap={vmcDaysMap}
              climateAutopilot={climateAutopilot}
              readOnly={!canEdit}
              onSignIn={handleSignIn}
              onUpdateConfig={handleUpdateConfig}
              onActivateAutopilot={handleActivateClimateAutopilot}
              onTurnOffAutopilot={handleTurnOffClimateAutopilot}
              onAddClimateLog={handleAddClimateLog}
              onUpdateClimateLog={handleUpdateClimateLog}
              onDeleteClimateLog={handleDeleteClimateLog}
            />
          )}

          {activeNav === 'bollette' && (
            <BillsView
              readings={readings}
              electricityBills={electricityBills}
              waterBills={waterBills}
              tariBills={tariBills}
              gsePayments={gsePayments}
              readOnly={!canEdit}
              isGmailConnected={Boolean(gmailToken)}
              onSignIn={handleSignIn}
              onConnectGmail={handleManualGmailSync}
              onAddElectricityBill={handleAddElectricityBill}
              onDeleteElectricityBill={handleDeleteElectricityBill}
              onClearAllBills={handleClearAllBills}
              onAddWaterBill={handleAddWaterBill}
              onAddTariBill={handleAddTariBill}
              onToggleTariPaid={handleToggleTariPaid}
              onDeleteTariBill={handleDeleteTariBill}
              onAddGsePayment={handleAddGsePayment}
              onDeleteGsePayment={handleDeleteGsePayment}
              onUpdateGsePayment={handleUpdateGsePayment}
            />
          )}

          {activeNav === 'articoli' && (
            <ArticlesView
              articles={visibleHomeArticles}
              articleDocuments={articleDocuments}
              readOnly={!canEdit}
              onSignIn={handleSignIn}
              onAddArticle={(art, manualFile) => handleAddArticle(art, 'art', manualFile)}
              onUpdateArticle={handleUpdateArticle}
              onDeleteArticle={handleDeleteArticle}
              onDownloadManual={handleDownloadArticleManual}
              onUploadArticleDocument={handleUploadArticleDocument}
              onUpdateArticleDocumentType={handleUpdateArticleDocumentType}
              onDeleteArticleDocument={handleDeleteLinkedDocument}
            />
          )}

          {activeNav === 'ricerche' && (
            <ResearchesView
              researches={productResearches}
              researchDocuments={researchDocuments}
              readOnly={!canEdit}
              onSignIn={handleSignIn}
              onAddResearch={handleAddProductResearch}
              onUpdateResearch={handleUpdateProductResearch}
              onDeleteResearch={handleDeleteProductResearch}
              onUploadResearchDocument={handleUploadResearchDocument}
              onAddResearchDocumentLink={handleAddResearchDocumentLink}
              onUpdateResearchDocumentType={handleUpdateResearchDocumentType}
              onDeleteResearchDocument={handleDeleteLinkedDocument}
              onMoveToArticles={async (item) => {
                const resolvedBrand = (inferProductBrand(item) || item.store).slice(0, 60);
                const mappedCategory: HomeArticleCategory =
                  item.category === 'elettrodomestici' || item.category === 'elettronica'
                    ? item.category
                    : 'altro';
                const effectivePaidEur =
                  item.status === 'acquistato' && typeof item.paidPriceEur === 'number'
                    ? item.paidPriceEur
                    : undefined;
                const effectivePaidPrice =
                  typeof effectivePaidEur === 'number' ? effectivePaidEur : item.priceEur;
                const specsParts = [
                  typeof effectivePaidEur === 'number'
                    ? `Pagato: € ${effectivePaidEur.toFixed(2)}`
                    : typeof item.priceEur === 'number'
                      ? `Prezzo: € ${item.priceEur.toFixed(2)}`
                      : '',
                  item.color ? `Colore: ${item.color}` : '',
                  item.size ? `Taglia / Capacità: ${item.size}` : '',
                  item.specs ? item.specs.replace(/\n+/g, ' · ') : '',
                  `Negozio: ${item.store}`,
                ].filter(Boolean);
                const newArticleId = await handleAddArticle(
                  {
                    name: item.title.slice(0, 80),
                    brand: resolvedBrand,
                    model: (item.model || item.store).slice(0, 80),
                    category: mappedCategory,
                    room: getResearchRoomLabel(item.room),
                    purchasePriceEur: effectivePaidPrice,
                    familyWarranty: false,
                    specs: specsParts.join(' · ').slice(0, 240),
                    notes: (item.notes || item.url).slice(0, 240),
                    manualExtractText: item.specs ? `${item.specs}\nFonte: ${item.url}`.slice(0, 12_000) : undefined,
                  },
                  'art'
                );
                if (newArticleId && user) {
                  const linkedDocs = getDocumentsForResearch(researchDocuments, item.id);
                  for (const linkedDoc of linkedDocs) {
                    const parsedRef = parseResearchDocumentRef(linkedDoc.referenceCode);
                    const stored =
                      linkedDoc.attachmentKey && linkedDoc.fileSize
                        ? await getVaultFile(linkedDoc.attachmentKey, user.uid)
                        : null;
                    if (stored) {
                      const fileCopy = new File([stored.blob], stored.fileName, {
                        type: stored.mimeType || 'application/octet-stream',
                      });
                      await handleUploadArticleDocument(
                        newArticleId,
                        parsedRef?.docType || 'altro',
                        linkedDoc.title,
                        resolvedBrand,
                        fileCopy
                      );
                    } else if (linkedDoc.cloudUrl) {
                      await handleAddDocument({
                        title: linkedDoc.title.slice(0, 80),
                        category:
                          parsedRef?.docType === 'garanzia_extra_family'
                            ? 'Assicurazioni'
                            : 'Altro',
                        provider: resolvedBrand.slice(0, 80),
                        referenceCode: buildArticleDocumentRef(
                          newArticleId,
                          parsedRef?.docType || 'manuale'
                        ),
                        issueDate: linkedDoc.issueDate || new Date().toLocaleDateString('it-IT'),
                        pinned: Boolean(linkedDoc.pinned),
                        cloudUrl: linkedDoc.cloudUrl,
                        notes: linkedDoc.notes,
                      });
                    }
                  }
                }
              }}
            />
          )}

          {activeNav === 'documenti' && (
            <DocumentsView
              documents={homeDocuments}
              electricityBills={electricityBills}
              waterBills={waterBills}
              tariBills={tariBills}
              readOnly={!canEdit}
              isGmailConnected={Boolean(gmailToken)}
              onSignIn={handleSignIn}
              onConnectGmail={handleManualGmailSync}
              onAddDocument={handleAddDocument}
              onUpdateDocument={handleUpdateDocument}
              onDeleteDocument={handleDeleteLinkedDocument}
            />
          )}

          {activeNav === 'macchina' && (
            <CarView
              profile={carProfile}
              insurancePolicy={carPolicy}
              logs={carLogs}
              carDocuments={carDocuments}
              readOnly={!canEdit}
              onSignIn={handleSignIn}
              onSaveProfile={handleSaveCarProfile}
              onSaveInsurancePolicy={handleSaveCarPolicy}
              onUploadCarDocument={handleUploadLinkedDocument}
              onDeleteCarDocument={handleDeleteLinkedDocument}
              onAddLog={handleAddCarLog}
              onUpdateLog={handleUpdateCarLog}
              onDeleteLog={handleDeleteArticle}
            />
          )}

          {activeNav === 'spesa' && (
            <GroceryView
              products={groceryProducts}
              readOnly={!canEdit}
              onSignIn={handleSignIn}
              onAddProduct={handleAddGroceryProduct}
              onUpdateProduct={handleUpdateGroceryProduct}
              onDeleteProduct={handleDeleteArticle}
            />
          )}

          {activeNav === 'info' && <InfoGuideView />}

          {activeNav === 'impostazioni' && (
            <SettingsView
              homeConfig={homeConfig}
              readOnly={!canEdit}
              userEmail={user?.email || null}
              isGmailConnected={Boolean(gmailToken)}
              gmailSyncing={gmailSyncing}
              onConnectOrSyncGmail={handleManualGmailSync}
              onUpdateConfig={handleUpdateConfig}
              onExportBackup={handleExportFullBackup}
              countsSummary={{
                readings: readings.length,
                climateLogs: climateLogs.length,
                electricityBills: electricityBills.length,
                waterBills: waterBills.length,
                tariBills: tariBills.length,
                gsePayments: gsePayments.length,
                articles: visibleHomeArticles.length,
                researches: productResearches.length,
                documents: homeDocuments.length,
                carLogs: carLogs.length,
                groceries: groceryProducts.length,
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
