import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signOut, User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  BookOpen,
  Car,
  CheckCircle2,
  Database,
  FolderOpen,
  Home,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Package,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Thermometer,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  auth,
  clearGmailAccessToken,
  connectGmailAccount,
  db,
  FIREBASE_PROJECT_ID,
  getGmailAccessToken,
  GMAIL_OAUTH_PROJECT_ID,
  handleFirestoreError,
  OperationType,
  signInPrimaryOwner,
  subscribeAuthWithGmailCleanup,
} from './firebase';
import {
  BillRecord,
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
  ReadingSource,
  RoomId,
  TariBillRecord,
  WaterBillRecord,
} from './types/home';
import { ParsedReadingInput } from './utils/edistribuzioneCsv';
import {
  GmailAuthExpiredError,
  GmailProcessedMessage,
  scanGmailInbox,
  trashGmailMessages,
} from './utils/gmailSync';
import {
  articleToCarLog,
  articleToCarProfile,
  articleToGroceryProduct,
  CAR_PROFILE_ID,
  carLogToArticlePayload,
  carProfileToArticlePayload,
  groceryProductToArticlePayload,
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
  saveVaultFile,
  SYSTEM_ROOM_DOCUMENTS,
} from './utils/documentVault';
import {
  addDaysIso,
  articleToClimateAutopilot,
  buildAutopilotSessionForDate,
  CLIMATE_AUTOPILOT_DOC_ID,
  climateAutopilotToArticlePayload,
  enumerateIsoDatesInclusive,
  getAutoClimateDocId,
  getLocalTodayIso,
  SYSTEM_ROOM_CLIMATE_AUTO,
} from './utils/climateAutopilot';
import {
  MIGRATION_DONE_DOC_ID,
  migrateFromLegacyProject,
  SYSTEM_ROOM_MIGRATION_META,
} from './utils/legacyMigration';
import { OverviewView } from './components/OverviewView';
import { DomoticsView } from './components/DomoticsView';
import { EnergyDatabaseView } from './components/EnergyDatabaseView';
import { BillsView } from './components/BillsView';
import { ArticlesView } from './components/ArticlesView';
import { CarView } from './components/CarView';
import { GroceryView } from './components/GroceryView';
import { DocumentsView } from './components/DocumentsView';
import { ClimateAutopilotInput } from './components/ClimateAutopilotCard';
import { InfoGuideView } from './components/InfoGuideView';
import { VaultCloudNotice } from './components/VaultCloudNotice';

const NAV_ITEMS: { id: NavSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'panoramica', label: 'Panoramica', icon: LayoutDashboard },
  { id: 'consumi', label: 'Consumi Annuali', icon: Database },
  { id: 'domotica', label: 'Clima & Domotica', icon: Thermometer },
  { id: 'bollette', label: 'Bollette', icon: Receipt },
  { id: 'articoli', label: 'Articoli', icon: Package },
  { id: 'documenti', label: 'Documenti', icon: FolderOpen },
  { id: 'macchina', label: 'Macchina', icon: Car },
  { id: 'spesa', label: 'Spesa', icon: ShoppingCart },
  { id: 'info', label: 'Info Utili', icon: BookOpen },
];

function isResilientFirestoreOutage(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? `${(error as { code?: string }).code || ''} ${error.message}`
      : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('unauthenticated')) {
    return false;
  }
  return (
    lower.includes('quota') ||
    lower.includes('resource-exhausted') ||
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
const LEGACY_DEMO_ARTICLE_IDS = new Set([
  'art_tcl_75q7c',
  'art_avs_a300',
  'art_huawei_sun2000',
  'art_electrolux_forno',
  'art_electrolux_frigo',
  'art_piano_induzione',
  'art_lavastoviglie',
  'art_microonde',
]);

function isLegacyDemoArticleId(id: string): boolean {
  return (
    LEGACY_DEMO_ARTICLE_IDS.has(id) ||
    id === 'grocery_seed_v1_done' ||
    /^spesa_[a-z][a-z0-9_]*$/.test(id)
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavSection>('consumi');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  const [firestoreReadings, setFirestoreReadings] = useState<EnergyReading[]>([]);
  const [climateLogs, setClimateLogs] = useState<ClimateSession[]>([]);
  const [publicOwnerUid, setPublicOwnerUid] = useState<string | null>(null);
  const [publicClimateAutopilot, setPublicClimateAutopilot] =
    useState<ClimateAutopilotConfig | null>(null);
  const [electricityBills, setElectricityBills] = useState<BillRecord[]>([]);
  const [waterBills, setWaterBills] = useState<WaterBillRecord[]>([]);
  const [tariBills, setTariBills] = useState<TariBillRecord[]>([]);
  const [gsePayments, setGsePayments] = useState<GsePaymentRecord[]>([]);
  const [homeArticles, setHomeArticles] = useState<HomeArticleRecord[]>([]);
  const [readingsLoading, setReadingsLoading] = useState(true);
  const [firestoreFallbackNotice, setFirestoreFallbackNotice] = useState<string | null>(null);
  const [migratingDb, setMigratingDb] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<string | null>(null);
  const [migrationDismissed, setMigrationDismissed] = useState(false);
  const clearingBillArchiveRef = useRef(false);
  const skippedTrashIdsRef = useRef<Set<string>>(new Set());
  const gmailSyncInFlightRef = useRef(false);
  const autopilotSyncInFlightRef = useRef(false);
  const lastAutopilotSyncKeyRef = useRef<string | null>(null);
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
        setHomeArticles([]);
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

  // Registra automaticamente l'ownerUid corrente su appMeta/owner per GitHub Actions -> Firestore
  useEffect(() => {
    if (!authReady || !user || user.email !== 'mauminieri@gmail.com') return;
    void setDoc(
      doc(db, 'appMeta', 'owner'),
      { ownerUid: user.uid, updatedAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  }, [authReady, user]);

  // Subscribe to private Firestore data when signed in as owner.
  useEffect(() => {
    if (!authReady) return;
    if (!activeUid) {
      setFirestoreReadings([]);
      setClimateLogs([]);
      setPublicClimateAutopilot(null);
      setHomeConfig({ ownerId: '', ...DEFAULT_HOME_CONFIG });
      setReadingsLoading(true);
      return;
    }

    setReadingsLoading(true);
    const readingsPath = `users/${activeUid}/energyReadings`;
    const readingsQuery = query(
      collection(db, readingsPath),
      where('ownerId', '==', activeUid)
    );

    const unsubReadings = onSnapshot(
      readingsQuery,
      (snap) => {
        const list: EnergyReading[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || activeUid),
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
        });
        const currentTodayIso = getLocalTodayIso();
        const filtered = list.filter((r) => r.date && r.date <= currentTodayIso);
        setFirestoreReadings(filtered);
        if (!snap.metadata.fromCache) {
          setFirestoreFallbackNotice(null);
        }
        try {
          const serialized = JSON.stringify(filtered);
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
          setFirestoreReadings(Array.from(byDate.values()));
          setReadingsLoading(false);
          return;
        }
        handleFirestoreError(error, OperationType.LIST, readingsPath);
      }
    );

    const configPath = `users/${activeUid}/homeConfig/main`;
    const unsubConfig = onSnapshot(
      doc(db, configPath),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setHomeConfig({
            ownerId: activeUid,
            aristonMode: data.aristonMode || DEFAULT_HOME_CONFIG.aristonMode,
            aristonProfile: data.aristonProfile || DEFAULT_HOME_CONFIG.aristonProfile,
            floorFlowTemp: Number(data.floorFlowTemp ?? DEFAULT_HOME_CONFIG.floorFlowTemp),
            dhwTargetTemp: Number(data.dhwTargetTemp ?? DEFAULT_HOME_CONFIG.dhwTargetTemp),
            zoneLivingTarget: Number(data.zoneLivingTarget ?? DEFAULT_HOME_CONFIG.zoneLivingTarget),
            zoneBedroomTarget: Number(data.zoneBedroomTarget ?? DEFAULT_HOME_CONFIG.zoneBedroomTarget),
            neasmartPower: Boolean(data.neasmartPower ?? DEFAULT_HOME_CONFIG.neasmartPower),
            neasmartTargetHumidity: Number(data.neasmartTargetHumidity ?? DEFAULT_HOME_CONFIG.neasmartTargetHumidity),
            neasmartFanSpeed: data.neasmartFanSpeed || DEFAULT_HOME_CONFIG.neasmartFanSpeed,
            dewPointProtection: Boolean(data.dewPointProtection ?? DEFAULT_HOME_CONFIG.dewPointProtection),
            tariffEurPerKwh: Number(data.tariffEurPerKwh ?? DEFAULT_HOME_CONFIG.tariffEurPerKwh),
            podCode: String(data.podCode || DEFAULT_HOME_CONFIG.podCode),
          });
        } else {
          setHomeConfig({ ownerId: activeUid, ...DEFAULT_HOME_CONFIG });
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          console.warn('Firestore unavailable/quota for homeConfig; using local cache / defaults.');
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale e dei dati predefiniti.'
          );
          try {
            const cached = localStorage.getItem(`myhome_config_cache_${activeUid}`);
            if (cached) {
              setHomeConfig(JSON.parse(cached) as HomeSystemConfig);
              return;
            }
          } catch {
            // ignore
          }
          setHomeConfig({ ownerId: activeUid, ...DEFAULT_HOME_CONFIG });
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
        const list: ClimateSession[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || activeUid),
            date: String(data.date || ''),
            mode: (data.mode as ClimateMode) || 'riscaldamento',
            startTime: String(data.startTime || '09:00'),
            endTime: String(data.endTime || '20:00'),
            targetTemp: typeof data.targetTemp === 'number' ? data.targetTemp : 21,
            rooms: Array.isArray(data.rooms) ? (data.rooms as RoomId[]) : [],
            notes: data.notes ? String(data.notes) : undefined,
          };
        });
        setClimateLogs(list);
        try {
          localStorage.setItem(`myhome_climate_cache_${activeUid}`, JSON.stringify(list));
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
          try {
            const cached = localStorage.getItem(`myhome_climate_cache_${activeUid}`);
            if (cached) setClimateLogs(JSON.parse(cached) as ClimateSession[]);
          } catch {
            // ignore
          }
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
        const list: BillRecord[] = snap.docs.map((d) => {
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
            pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : undefined,
          };
        });

        setElectricityBills(list);
        try {
          localStorage.setItem(`myhome_elec_bills_cache_${activeUid}`, JSON.stringify(list));
        } catch {
          // ignore
        }

      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale.'
          );
          try {
            const cached = localStorage.getItem(`myhome_elec_bills_cache_${activeUid}`);
            if (cached) setElectricityBills(JSON.parse(cached) as BillRecord[]);
          } catch {
            // ignore
          }
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
        const list: WaterBillRecord[] = snap.docs.map((d) => {
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
            pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : undefined,
          };
        });

        setWaterBills(list);
        try {
          localStorage.setItem(`myhome_water_bills_cache_${activeUid}`, JSON.stringify(list));
        } catch {
          // ignore
        }

      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale e dei dati predefiniti.'
          );
          try {
            const cached = localStorage.getItem(`myhome_water_bills_cache_${activeUid}`);
            if (cached) setWaterBills(JSON.parse(cached) as WaterBillRecord[]);
          } catch {
            // ignore
          }
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
        const list: TariBillRecord[] = snap.docs.map((d) => {
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
            source: data.source === 'gmail-pdf' ? 'gmail-pdf' : 'manuale',
            note: data.note ? String(data.note) : undefined,
            pdfFileKey: data.pdfFileKey ? String(data.pdfFileKey) : undefined,
          };
        });
        setTariBills(list);
        try {
          localStorage.setItem(`myhome_tari_bills_cache_${activeUid}`, JSON.stringify(list));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale.'
          );
          try {
            const cached = localStorage.getItem(`myhome_tari_bills_cache_${activeUid}`);
            if (cached) setTariBills(JSON.parse(cached) as TariBillRecord[]);
          } catch {
            // ignore
          }
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
        const list: GsePaymentRecord[] = snap.docs.map((d) => {
          const data = d.data();
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
        setGsePayments(list);
        try {
          localStorage.setItem(`myhome_gse_payments_cache_${activeUid}`, JSON.stringify(list));
        } catch {
          // ignore
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale e dei dati predefiniti.'
          );
          try {
            const cached = localStorage.getItem(`myhome_gse_payments_cache_${activeUid}`);
            if (cached) setGsePayments(JSON.parse(cached) as GsePaymentRecord[]);
          } catch {
            // ignore
          }
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
        const legacyDemoDocs = snap.docs.filter((d) => isLegacyDemoArticleId(d.id));
        const list: HomeArticleRecord[] = snap.docs
          .filter((d) => !isLegacyDemoArticleId(d.id))
          .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name || ''),
            brand: String(data.brand || ''),
            model: String(data.model || ''),
            category: (data.category as HomeArticleCategory) || 'altro',
            room: String(data.room || 'Casa'),
            purchaseDate: data.purchaseDate ? String(data.purchaseDate) : undefined,
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

        setHomeArticles(list);
        try {
          localStorage.setItem(`myhome_articles_cache_${activeUid}`, JSON.stringify(list));
        } catch {
          // ignore
        }
        if (user?.uid === activeUid && !snap.metadata.fromCache && legacyDemoDocs.length > 0) {
          void (async () => {
            try {
              for (let start = 0; start < legacyDemoDocs.length; start += 400) {
                const batch = writeBatch(db);
                legacyDemoDocs
                  .slice(start, start + 400)
                  .forEach((articleDoc) => batch.delete(articleDoc.ref));
                await batch.commit();
              }
            } catch (error) {
              handleFirestoreError(error, OperationType.DELETE, articlesPath);
            }
          })();
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: utilizzo della cache locale.'
          );
          try {
            const cached = localStorage.getItem(`myhome_articles_cache_${activeUid}`);
            if (cached) {
              const articles = JSON.parse(cached) as HomeArticleRecord[];
              setHomeArticles(articles.filter((article) => !isLegacyDemoArticleId(article.id)));
            }
          } catch {
            // ignore
          }
          return;
        }
        handleFirestoreError(error, OperationType.LIST, articlesPath);
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
    };
  }, [authReady, activeUid, user]);

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

    const publicElectricityBillsPath = `users/${publicOwnerUid}/electricityBills`;
    const publicElectricityBillsQuery = query(
      collection(db, publicElectricityBillsPath),
      where('ownerId', '==', publicOwnerUid),
      where('pdfFileKey', '>', '')
    );
    const unsubPublicElectricityBills = onSnapshot(
      publicElectricityBillsQuery,
      (snap) => {
        setElectricityBills(
          snap.docs.map((d) => {
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
              pdfFileKey: String(data.pdfFileKey),
            };
          })
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, publicElectricityBillsPath)
    );

    const publicWaterBillsPath = `users/${publicOwnerUid}/waterBills`;
    const publicWaterBillsQuery = query(
      collection(db, publicWaterBillsPath),
      where('ownerId', '==', publicOwnerUid),
      where('pdfFileKey', '>', '')
    );
    const unsubPublicWaterBills = onSnapshot(
      publicWaterBillsQuery,
      (snap) => {
        setWaterBills(
          snap.docs.map((d) => {
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
              pdfFileKey: String(data.pdfFileKey),
            };
          })
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, publicWaterBillsPath)
    );

    const publicTariBillsPath = `users/${publicOwnerUid}/tariBills`;
    const publicTariBillsQuery = query(
      collection(db, publicTariBillsPath),
      where('ownerId', '==', publicOwnerUid),
      where('pdfFileKey', '>', '')
    );
    const unsubPublicTariBills = onSnapshot(
      publicTariBillsQuery,
      (snap) => {
        setTariBills(
          snap.docs.map((d) => {
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
              source: data.source === 'gmail-pdf' ? 'gmail-pdf' : 'manuale',
              note: data.note ? String(data.note) : undefined,
              pdfFileKey: String(data.pdfFileKey),
            };
          })
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, publicTariBillsPath)
    );

    return () => {
      unsubReadings();
      unsubClimate();
      unsubAutopilot();
      unsubPublicElectricityBills();
      unsubPublicWaterBills();
      unsubPublicTariBills();
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

  const runGmailSyncWithToken = useCallback(
    async (currentUser: User, token: string, isAuto = false) => {
      if (gmailSyncInFlightRef.current) return;
      gmailSyncInFlightRef.current = true;
      setGmailSyncing(true);
      if (!isAuto) setGmailNotice(null);

      try {
        const scan = await scanGmailInbox(token);

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
              text: 'INBOX Gmail controllata: nessuna nuova email di consumi o bollette da importare.',
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

        setGmailNotice({
          tone: 'ok',
          text: `Dati salvati: ${savedParts.join(', ')}.`,
        });

        const toPrompt = scan.processedMessages.filter(
          (m) => !skippedTrashIdsRef.current.has(m.id)
        );
        if (toPrompt.length > 0) {
          setPendingTrashMessages(toPrompt);
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

  // Periodic automatic Gmail INBOX scan every 10 minutes while user & Gmail token are active
  useEffect(() => {
    if (!user || !gmailToken) return;
    const intervalId = window.setInterval(() => {
      void runGmailSyncWithToken(user, gmailToken, true);
    }, 10 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [user, gmailToken, runGmailSyncWithToken]);

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
      targetTemp: session.targetTemp,
      rooms: session.rooms,
      createdAt: serverTimestamp(),
    };
    if (session.notes) {
      payload.notes = session.notes.slice(0, 240);
    }
    try {
      await setDoc(doc(db, basePath, docId), payload);
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
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      date: session.date,
      mode: session.mode,
      startTime: session.startTime,
      endTime: session.endTime,
      targetTemp: session.targetTemp,
      rooms: session.rooms,
      notes: session.notes ? session.notes.slice(0, 240) : '',
    };
    try {
      await setDoc(doc(db, path), payload, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async function handleDeleteClimateLog(id: string) {
    if (!user) return;
    const path = `users/${user.uid}/climateLogs/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
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
    setHomeConfig(nextConfig);
    try {
      localStorage.setItem(`myhome_config_cache_${user.uid}`, JSON.stringify(nextConfig));
    } catch {
      // ignore
    }
    try {
      await setDoc(doc(db, configPath), {
        ...nextConfig,
        updatedAt: serverTimestamp(),
      });
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
    } catch (error) {
      await deleteVaultFiles([pdfFileKey], user.uid);
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
      throw error;
    }
  }

  async function handleDeleteElectricityBill(bill: BillRecord) {
    if (!user) return;
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

    const fileKey = getElectricityBillFileKey(bill.invoiceNumber);
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
      try {
        localStorage.setItem(`myhome_elec_bills_cache_${uid}`, '[]');
        localStorage.setItem(`myhome_water_bills_cache_${uid}`, '[]');
        localStorage.setItem(`myhome_tari_bills_cache_${uid}`, '[]');
        localStorage.setItem(`myhome_gse_payments_cache_${uid}`, '[]');
      } catch {
        // Firebase remains the source of truth if the local cache is unavailable.
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
      await setDoc(doc(db, basePath, docId), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${basePath}/${docId}`);
    }
  }

  async function handleDeleteTariBill(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const target = tariBills.find((t) => t.id === id);
    const path = `users/${user.uid}/tariBills/${id}`;
    try {
      await deleteDoc(doc(db, path));
      if (target) {
        await deleteVaultFile(getTariBillFileKey(target.noticeNumber), user.uid);
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
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
      throw error;
    }
  }

  async function handleDeleteGsePayment(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/gsePayments/${id}`;
    const payment = gsePayments.find((entry) => entry.id === id);
    try {
      await deleteDoc(doc(db, path));
      if (payment?.attachmentFileKey) {
        await deleteVaultFiles([payment.attachmentFileKey], user.uid);
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
  ) {
    if (!user) return;
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
      await setDoc(doc(db, basePath, docId), payload);
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
    await handleAddArticle(homeDocumentToArticlePayload(docItem), 'doc');
  }

  async function handleUpdateDocument(id: string, docItem: Omit<HomeDocumentRecord, 'id'>) {
    await handleUpdateArticle(id, homeDocumentToArticlePayload(docItem));
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

  const carLogs = useMemo(
    () =>
      homeArticles
        .filter((a) => a.room === SYSTEM_ROOM_CAR && a.id !== CAR_PROFILE_ID)
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
    const existingIds = new Set(climateLogs.map((l) => l.id));
    const dates = enumerateIsoDatesInclusive(climateAutopilot.startDate, todayIso);
    if (dates.length === 0) return climateLogs;
    const missing = dates
      .filter((d) => !existingIds.has(getAutoClimateDocId(d)))
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
      targetTemp: input.targetTemp,
      rooms: input.rooms,
      startDate: input.startDate,
      lastAppliedDate,
      notes: input.notes,
    };

    const batch = writeBatch(db);
    const logsPath = `users/${user.uid}/climateLogs`;
    for (const dateIso of datesToApply) {
      const session = buildAutopilotSessionForDate(dateIso, nextCfg, user.uid);
      const logPayload: Record<string, unknown> = {
        ownerId: user.uid,
        date: session.date,
        mode: session.mode,
        startTime: session.startTime,
        endTime: session.endTime,
        targetTemp: session.targetTemp,
        rooms: session.rooms,
        createdAt: serverTimestamp(),
      };
      if (session.notes) {
        logPayload.notes = session.notes.slice(0, 240);
      }
      batch.set(doc(db, logsPath, session.id), logPayload);
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

    try {
      lastAutopilotSyncKeyRef.current = `${user.uid}:${todayIso}:${nextCfg.startDate}:${nextCfg.mode}:${nextCfg.startTime}:${nextCfg.endTime}:${nextCfg.targetTemp}`;
      await batch.commit();
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
      const todayDocId = getAutoClimateDocId(todayIso);
      batch.delete(doc(db, `users/${user.uid}/climateLogs/${todayDocId}`));
    }

    try {
      await batch.commit();
    } catch (error) {
      if (!isResilientFirestoreOutage(error)) {
        handleFirestoreError(error, OperationType.WRITE, statePath);
      }
    }
  }

  // Automatic daily propagation of the active climate combination across subsequent days
  useEffect(() => {
    if (!user || !climateAutopilot || !climateAutopilot.active) return;
    if (climateAutopilot.startDate > todayIso) return;
    if (autopilotSyncInFlightRef.current) return;

    const existingIds = new Set(climateLogs.map((l) => l.id));
    const dates = enumerateIsoDatesInclusive(climateAutopilot.startDate, todayIso);
    const missingDates = dates.filter((d) => !existingIds.has(getAutoClimateDocId(d)));
    const needsStateAdvance = climateAutopilot.lastAppliedDate < todayIso;

    if (missingDates.length === 0 && !needsStateAdvance) return;

    const syncKey = `${user.uid}:${todayIso}:${climateAutopilot.startDate}:${missingDates.length}:${climateAutopilot.mode}:${climateAutopilot.startTime}:${climateAutopilot.endTime}:${climateAutopilot.targetTemp}`;
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
        targetTemp: session.targetTemp,
        rooms: session.rooms,
        createdAt: serverTimestamp(),
      };
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
      await setDoc(doc(db, path), payload);
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

  async function handleDeleteArticle(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/homeArticles/${id}`;
    const article = homeArticles.find((entry) => entry.id === id);
    try {
      await deleteDoc(doc(db, path));
      if (article?.manualFileKey) {
        await deleteVaultFiles([article.manualFileKey], user.uid);
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

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-xs text-slate-400">Caricamento sistema domotico...</div>
      </div>
    );
  }

  const currentNavLabel =
    NAV_ITEMS.find((n) => n.id === activeNav)?.label || 'Consumi Annuali';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Desktop Sidebar (chiusa di default, si apre al passaggio del mouse) */}
      <aside className="group hidden md:flex md:w-14 hover:md:w-60 md:flex-col md:fixed md:inset-y-0 left-0 z-40 bg-slate-900/95 backdrop-blur-sm border-r border-slate-800 transition-all duration-200 overflow-hidden hover:shadow-2xl hover:shadow-black/60">
        <div className="h-14 px-3.5 flex items-center border-b border-slate-800">
          <button
            type="button"
            onClick={() => setActiveNav('panoramica')}
            className="inline-flex items-center gap-3 text-slate-100 font-bold tracking-tight text-base whitespace-nowrap"
          >
            <Home className="w-5 h-5 text-sky-400 shrink-0" />
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              my-home
            </span>
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-3 px-2.5 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-2.5 border-t border-slate-800 flex items-center justify-between gap-2">
          {user ? (
            <>
              <div className="min-w-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pl-1">
                <div className="text-xs font-medium text-slate-100 truncate">
                  {user.displayName || 'Proprietario'}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {user.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => signOut(auth)}
                aria-label="Esci"
                title="Esci"
                className="p-2 text-slate-400 hover:text-slate-100 rounded-lg transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              title="Accedi con Google per modificare"
              className="w-full flex items-center justify-center gap-2 py-2 px-2 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap overflow-hidden"
            >
              <span className="group-hover:hidden font-bold">G</span>
              <span className="hidden group-hover:inline">Accedi con Google</span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-slate-900 h-full flex flex-col border-r border-slate-800 z-50">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800">
              <span className="font-bold text-slate-100 text-sm">my-home</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg ${
                      active
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:bg-slate-800'
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
      <div className="flex-1 md:pl-14 flex flex-col min-w-0">
        <header className="h-14 bg-slate-900/90 backdrop-blur-xs border-b border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Apri menu"
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400 truncate">
              <span className="hidden sm:inline">mauriziominieri.github.io</span>
              <span className="hidden sm:inline">/</span>
              <span className="hidden sm:inline">my-home</span>
              <span className="hidden sm:inline">/</span>
              <span className="font-semibold text-slate-100 truncate">
                {currentNavLabel}
              </span>
            </div>
          </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden sm:block text-xs font-mono text-slate-400 whitespace-nowrap">
                POD <span className="text-sky-400">{homeConfig.podCode}</span> · 6 kW
              </div>
              {canEdit ? (
                <button
                  type="button"
                  onClick={handleManualGmailSync}
                  disabled={gmailSyncing}
                  title={
                    gmailToken
                      ? 'Controlla ora la INBOX di Gmail (auto ogni 10 min)'
                      : 'Collega e sincronizza ora la INBOX di Gmail'
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  {gmailSyncing ? (
                    <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                  ) : (
                    <Mail className="w-3.5 h-3.5 text-sky-400" />
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

        {authError && (
          <div className="px-5 py-2 bg-rose-500/10 border-b border-rose-500/30 text-xs text-rose-200 flex items-center justify-between gap-2">
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-rose-300/80 hover:text-rose-100 p-0.5 shrink-0"
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
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : gmailNotice.tone === 'warn'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-sky-500/10 border-sky-500/30 text-sky-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{gmailNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setGmailNotice(null)}
              className="text-slate-400 hover:text-slate-100 p-0.5"
              aria-label="Chiudi avviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {firestoreFallbackNotice && (
          <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/30 text-xs text-amber-200 flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>{firestoreFallbackNotice}</span>
          </div>
        )}

        <VaultCloudNotice />

        {user && !readingsLoading && !migrationCompleted && !migrationDismissed && (
          <div className="px-5 py-2.5 bg-sky-500/10 border-b border-sky-500/30 text-xs text-sky-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              <Database className="w-4 h-4 text-sky-300 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-semibold text-sky-200">
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md transition-colors disabled:opacity-60"
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
                className="p-1 text-sky-200/70 hover:text-sky-100"
                aria-label="Nascondi banner migrazione"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {pendingTrashMessages.length > 0 && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-300 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-100">
                      Spostare {pendingTrashMessages.length}{' '}
                      {pendingTrashMessages.length === 1 ? 'email' : 'email'} nel Cestino di Gmail?
                    </h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      I dati estratti sono già stati salvati su Firebase Firestore.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleKeepMessagesInInbox}
                  disabled={trashingEmails}
                  className="p-1 text-slate-400 hover:text-slate-100 rounded"
                  aria-label="Annulla"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                {pendingTrashMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 text-xs space-y-0.5"
                  >
                    <div className="font-medium text-slate-100 truncate">{msg.subject}</div>
                    <div className="text-[11px] text-emerald-300">{msg.summary}</div>
                    <div className="text-[10px] text-slate-500 truncate">{msg.from}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleKeepMessagesInInbox}
                  disabled={trashingEmails}
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
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

        <main className="flex-1 min-w-0 overflow-x-hidden px-3 sm:px-5 py-4 sm:py-5 max-w-[1800px] w-full mx-auto">
          {activeNav === 'panoramica' && (
            <OverviewView
              config={homeConfig}
              readings={readings}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              availableYears={AVAILABLE_YEARS}
              loading={readingsLoading}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'consumi' && (
            <EnergyDatabaseView
              readings={readings}
              climateLogs={effectiveClimateLogs}
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
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'domotica' && (
            <DomoticsView
              config={homeConfig}
              readings={readings}
              climateLogs={effectiveClimateLogs}
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
              readOnly={!canEdit}
              onSignIn={handleSignIn}
              onAddArticle={(art, manualFile) => handleAddArticle(art, 'art', manualFile)}
              onUpdateArticle={handleUpdateArticle}
              onDeleteArticle={handleDeleteArticle}
              onDownloadManual={handleDownloadArticleManual}
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
              onDeleteDocument={handleDeleteArticle}
            />
          )}

          {activeNav === 'macchina' && (
            <CarView
              profile={carProfile}
              logs={carLogs}
              readOnly={!canEdit}
              onSignIn={handleSignIn}
              onSaveProfile={handleSaveCarProfile}
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
        </main>
      </div>
    </div>
  );
}
