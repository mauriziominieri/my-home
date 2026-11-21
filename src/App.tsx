import { useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  BookOpen,
  Database,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  Thermometer,
  WifiOff,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  BillRecord,
  ClimateMode,
  ClimateSession,
  DEFAULT_HOME_CONFIG,
  EnergyReading,
  GsePaymentRecord,
  GsePaymentType,
  HomeArticleCategory,
  HomeArticleRecord,
  HomeSystemConfig,
  NavSection,
  ReadingSource,
  RoomId,
  TariBillRecord,
  WaterBillRecord,
} from './types/home';
import { ParsedReadingInput } from './utils/edistribuzioneCsv';
import { SEED_ELECTRICITY_BILLS, SEED_WATER_BILLS } from './data/billsSeed';
import { SEED_HOME_ARTICLES } from './data/articlesSeed';
import { OverviewView } from './components/OverviewView';
import { DomoticsView } from './components/DomoticsView';
import { EnergyDatabaseView } from './components/EnergyDatabaseView';
import { BillsView } from './components/BillsView';
import { ArticlesView } from './components/ArticlesView';
import { InfoGuideView } from './components/InfoGuideView';

const NAV_ITEMS: { id: NavSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'panoramica', label: 'Panoramica', icon: LayoutDashboard },
  { id: 'consumi', label: 'Consumi Annuali', icon: Database },
  { id: 'domotica', label: 'Clima & Domotica', icon: Thermometer },
  { id: 'bollette', label: 'Bollette', icon: Receipt },
  { id: 'articoli', label: 'Articoli', icon: Package },
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavSection>('consumi');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [syncIntervalHours, setSyncIntervalHours] = useState<number>(6);

  const [readings, setReadings] = useState<EnergyReading[]>([]);
  const [climateLogs, setClimateLogs] = useState<ClimateSession[]>([]);
  const [electricityBills, setElectricityBills] = useState<BillRecord[]>(SEED_ELECTRICITY_BILLS);
  const [waterBills, setWaterBills] = useState<WaterBillRecord[]>(SEED_WATER_BILLS);
  const [tariBills, setTariBills] = useState<TariBillRecord[]>([]);
  const [gsePayments, setGsePayments] = useState<GsePaymentRecord[]>([]);
  const [homeArticles, setHomeArticles] = useState<HomeArticleRecord[]>(SEED_HOME_ARTICLES);
  const [readingsLoading, setReadingsLoading] = useState(true);
  const [firestoreFallbackNotice, setFirestoreFallbackNotice] = useState<string | null>(null);
  const syncedElecBillsRef = useRef(false);
  const syncedWaterBillsRef = useRef(false);
  const syncedTariBillsRef = useRef(false);
  const syncedArticlesRef = useRef(false);
  const [homeConfig, setHomeConfig] = useState<HomeSystemConfig>({
    ownerId: '',
    ...DEFAULT_HOME_CONFIG,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const PUBLIC_OWNER_UID = 'rXdhFrSuqzaYf8SYVbmQulPqg7m1';
  const activeUid = user?.uid ?? PUBLIC_OWNER_UID;
  const canEdit = Boolean(user);

  // Subscribe to Firestore data (read-only for visitors, full edit when signed in)
  useEffect(() => {
    if (!authReady) return;

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
        const todayIso = new Date().toISOString().slice(0, 10);
        const filtered = list.filter((r) => r.date && r.date <= todayIso);
        setReadings(filtered);
        if (!snap.metadata.fromCache) {
          setFirestoreFallbackNotice(null);
        }
        try {
          localStorage.setItem(`myhome_readings_cache_${activeUid}`, JSON.stringify(filtered));
        } catch {
          // ignore storage quota
        }
        setReadingsLoading(false);
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          console.warn('Firestore unavailable/quota for energyReadings; using local cache + data/consumi.json.');
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
          );
          const todayIso = new Date().toISOString().slice(0, 10);
          const byDate = new Map<string, EnergyReading>();
          try {
            const cached = localStorage.getItem(`myhome_readings_cache_${activeUid}`);
            if (cached) {
              const parsed = JSON.parse(cached) as EnergyReading[];
              for (const r of parsed) {
                if (r?.date && r.date <= todayIso) byDate.set(r.date, r);
              }
            }
          } catch {
            // ignore
          }
          void (async () => {
            for (const url of [
              './data/consumi.json',
              'https://mauriziominieri.github.io/my-home/data/consumi.json',
              'https://raw.githubusercontent.com/mauriziominieri/my-home/main/data/consumi.json',
            ]) {
              try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                const json = await res.json();
                const items = Array.isArray(json?.readings) ? json.readings : [];
                for (const item of items as Partial<EnergyReading>[]) {
                  if (!item.date || String(item.date) > todayIso) continue;
                  byDate.set(String(item.date), {
                    id: String(item.date),
                    ownerId: activeUid,
                    date: String(item.date),
                    f1Kwh: Number(item.f1Kwh || 0),
                    f2Kwh: Number(item.f2Kwh || 0),
                    f3Kwh: Number(item.f3Kwh || 0),
                    totalKwh: Number(item.totalKwh || 0),
                    peakKw: Number(item.peakKw || 0),
                    estimatedCostEur: Number(
                      (Number(item.totalKwh || 0) * DEFAULT_HOME_CONFIG.tariffEurPerKwh).toFixed(2)
                    ),
                    source: 'e-distribuzione-api' as ReadingSource,
                  });
                }
                if (items.length > 0) break;
              } catch {
                // try next url
              }
            }
            setReadings(Array.from(byDate.values()));
            setReadingsLoading(false);
          })();
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
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
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
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
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
          };
        });

        if (list.length > 0) {
          setElectricityBills(list);
          try {
            localStorage.setItem(`myhome_elec_bills_cache_${activeUid}`, JSON.stringify(list));
          } catch {
            // ignore
          }
        }

        // One-time sync to Firebase when signed in as owner if any extracted bills are missing in Firestore
        if (user && user.uid === activeUid && !snap.metadata.fromCache && !syncedElecBillsRef.current) {
          syncedElecBillsRef.current = true;
          const existingInvoices = new Set(list.map((b) => b.invoiceNumber));
          void (async () => {
            const mergedMap = new Map<string, BillRecord>();
            for (const b of SEED_ELECTRICITY_BILLS) {
              mergedMap.set(b.invoiceNumber, b);
            }
            for (const url of [
              './data/bollette.json',
              'https://mauriziominieri.github.io/my-home/data/bollette.json',
            ]) {
              try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                const json = await res.json();
                if (Array.isArray(json?.bills)) {
                  for (const b of json.bills as BillRecord[]) {
                    if (b?.invoiceNumber) mergedMap.set(String(b.invoiceNumber), b);
                  }
                  break;
                }
              } catch {
                // try next
              }
            }
            const missing = Array.from(mergedMap.values()).filter(
              (b) => !existingInvoices.has(b.invoiceNumber)
            );
            if (missing.length === 0) return;
            try {
              const batch = writeBatch(db);
              for (const b of missing) {
                const docId = `edison_${b.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '')}`;
                const payload: Record<string, unknown> = {
                  ownerId: user.uid,
                  invoiceNumber: b.invoiceNumber.slice(0, 40),
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
                batch.set(doc(db, elecBillsPath, docId), payload);
              }
              await batch.commit();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (!msg.toLowerCase().includes('quota') && !msg.toLowerCase().includes('resource-exhausted')) {
                handleFirestoreError(err, OperationType.WRITE, elecBillsPath);
              }
            }
          })();
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
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
          };
        });

        if (list.length > 0) {
          setWaterBills(list);
          try {
            localStorage.setItem(`myhome_water_bills_cache_${activeUid}`, JSON.stringify(list));
          } catch {
            // ignore
          }
        }

        if (user && user.uid === activeUid && !snap.metadata.fromCache && !syncedWaterBillsRef.current) {
          syncedWaterBillsRef.current = true;
          const existingInvoices = new Set(list.map((b) => b.invoiceNumber));
          const missing = SEED_WATER_BILLS.filter(
            (b) => !existingInvoices.has(b.invoiceNumber)
          );
          if (missing.length > 0) {
            void (async () => {
              try {
                const batch = writeBatch(db);
                for (const w of missing) {
                  const docId = `acegas_${w.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '')}`;
                  const payload: Record<string, unknown> = {
                    ownerId: user.uid,
                    invoiceNumber: w.invoiceNumber.slice(0, 40),
                    issueDate: w.issueDate.slice(0, 20),
                    year: Number(w.year),
                    period: w.period.slice(0, 80),
                    cubicMeters: Number(w.cubicMeters),
                    fixedCostEur: Number(w.fixedCostEur),
                    totalPaid: Number(w.totalPaid),
                    createdAt: serverTimestamp(),
                  };
                  if (w.note) payload.note = w.note.slice(0, 240);
                  batch.set(doc(db, waterBillsPath, docId), payload);
                }
                await batch.commit();
              } catch (err) {
                if (!isResilientFirestoreOutage(err)) {
                  handleFirestoreError(err, OperationType.WRITE, waterBillsPath);
                }
              }
            })();
          }
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
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
          };
        });
        setTariBills(list);
        try {
          localStorage.setItem(`myhome_tari_bills_cache_${activeUid}`, JSON.stringify(list));
        } catch {
          // ignore
        }

        if (user && user.uid === activeUid && !snap.metadata.fromCache && !syncedTariBillsRef.current) {
          syncedTariBillsRef.current = true;
          const existingNotices = new Set(list.map((t) => t.noticeNumber));
          void (async () => {
            for (const url of [
              './data/bollette.json',
              'https://mauriziominieri.github.io/my-home/data/bollette.json',
            ]) {
              try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                const json = await res.json();
                if (!Array.isArray(json?.tariBills)) break;
                const missing = (json.tariBills as TariBillRecord[]).filter(
                  (t) => t?.noticeNumber && !existingNotices.has(String(t.noticeNumber))
                );
                if (missing.length === 0) break;
                const batch = writeBatch(db);
                for (const t of missing) {
                  const docId = `tari_${String(t.noticeNumber).replace(/[^a-zA-Z0-9_-]/g, '') || Date.now()}`;
                  const payload: Record<string, unknown> = {
                    ownerId: user.uid,
                    noticeNumber: String(t.noticeNumber).slice(0, 50),
                    issueDate: String(t.issueDate || '—').slice(0, 20),
                    dueDate: String(t.dueDate || '—').slice(0, 20),
                    year: Number(t.year || new Date().getFullYear()),
                    period: String(t.period || `TARI ${t.year || ''}`).slice(0, 80),
                    supplier: String(t.supplier || 'AcegasApsAmga').slice(0, 80),
                    totalPaid: Number(t.totalPaid || 0),
                    paid: Boolean(t.paid),
                    source: t.source === 'gmail-pdf' ? 'gmail-pdf' : 'manuale',
                    createdAt: serverTimestamp(),
                  };
                  if (t.note) payload.note = String(t.note).slice(0, 240);
                  batch.set(doc(db, tariBillsPath, docId), payload);
                }
                await batch.commit();
                break;
              } catch {
                // try next
              }
            }
          })();
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
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
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
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
        const list: HomeArticleRecord[] = snap.docs.map((d) => {
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
          };
        });

        if (list.length > 0) {
          setHomeArticles(list);
          try {
            localStorage.setItem(`myhome_articles_cache_${activeUid}`, JSON.stringify(list));
          } catch {
            // ignore
          }
        }

        if (user && user.uid === activeUid && !snap.metadata.fromCache && !syncedArticlesRef.current) {
          syncedArticlesRef.current = true;
          const existingIds = new Set(list.map((a) => a.id));
          const missing = SEED_HOME_ARTICLES.filter((a) => !existingIds.has(a.id));
          if (missing.length > 0) {
            void (async () => {
              try {
                const batch = writeBatch(db);
                for (const art of missing) {
                  const docId = art.id.replace(/[^a-zA-Z0-9_-]/g, '');
                  const payload: Record<string, unknown> = {
                    ownerId: user.uid,
                    name: art.name.slice(0, 80),
                    brand: art.brand.slice(0, 60),
                    model: art.model.slice(0, 80),
                    category: art.category,
                    room: art.room.slice(0, 60),
                    familyWarranty: Boolean(art.familyWarranty),
                    createdAt: serverTimestamp(),
                  };
                  if (art.purchaseDate) payload.purchaseDate = art.purchaseDate.slice(0, 20);
                  if (art.warrantyEnd) payload.warrantyEnd = art.warrantyEnd.slice(0, 20);
                  if (art.serialNumber) payload.serialNumber = art.serialNumber.slice(0, 80);
                  if (art.specs) payload.specs = art.specs.slice(0, 240);
                  if (art.notes) payload.notes = art.notes.slice(0, 240);
                  batch.set(doc(db, articlesPath, docId), payload);
                }
                await batch.commit();
              } catch (err) {
                if (!isResilientFirestoreOutage(err)) {
                  handleFirestoreError(err, OperationType.WRITE, articlesPath);
                }
              }
            })();
          }
        }
      },
      (error) => {
        if (isResilientFirestoreOutage(error)) {
          setFirestoreFallbackNotice(
            'Connessione Firestore temporaneamente non disponibile o quota raggiunta: attivi cache locale, file JSON leggeri su GitHub e dati predefiniti.'
          );
          try {
            const cached = localStorage.getItem(`myhome_articles_cache_${activeUid}`);
            if (cached) setHomeArticles(JSON.parse(cached) as HomeArticleRecord[]);
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
    if (!user || readings.length === 0) return;
    const basePath = `users/${user.uid}/energyReadings`;
    try {
      for (let i = 0; i < readings.length; i += 400) {
        const chunk = readings.slice(i, i + 400);
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

  async function handleSyncFromGithubJson(jsonUrl: string): Promise<number> {
    if (!user) return 0;
    const resp = await fetch(jsonUrl, { cache: 'no-store' });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: file non ancora trovato su GitHub.`);
    }
    const data = await resp.json();
    const list: ParsedReadingInput[] = Array.isArray(data?.readings)
      ? data.readings
      : [];
    if (list.length === 0) {
      throw new Error('Il file data/consumi.json non contiene ancora letture.');
    }
    const basePath = `users/${user.uid}/energyReadings`;
    try {
      for (let i = 0; i < list.length; i += 400) {
        const chunk = list.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const item of chunk) {
          if (!item.date || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
          const docId = `day_${item.date.replace(/-/g, '')}`;
          const totalKwh = Number(item.totalKwh || 0);
          const estimatedCostEur =
            Math.round(totalKwh * homeConfig.tariffEurPerKwh * 100) / 100;
          batch.set(doc(db, basePath, docId), {
            ownerId: user.uid,
            date: item.date,
            f1Kwh: Number(item.f1Kwh || 0),
            f2Kwh: Number(item.f2Kwh || 0),
            f3Kwh: Number(item.f3Kwh || 0),
            totalKwh,
            peakKw: Number(item.peakKw || 0),
            estimatedCostEur,
            source: 'e-distribuzione-api',
            notes: `Sync GitHub POD ${homeConfig.podCode}`,
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      return list.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, basePath);
    }
  }

  async function handleSignIn() {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Accesso Google non completato.'
      );
    }
  }

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

  async function handleAddElectricityBill(bill: BillRecord) {
    if (!user) return;
    const basePath = `users/${user.uid}/electricityBills`;
    const cleanInv = bill.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const docId = `manual_elec_${cleanInv || Date.now()}`;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      invoiceNumber: bill.invoiceNumber.slice(0, 40),
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
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
    }
  }

  async function handleAddWaterBill(bill: Omit<WaterBillRecord, 'id'>) {
    if (!user) return;
    const basePath = `users/${user.uid}/waterBills`;
    const cleanInv = bill.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const docId = `manual_water_${cleanInv || Date.now()}`;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      invoiceNumber: bill.invoiceNumber.slice(0, 40),
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
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
    }
  }

  async function handleAddTariBill(bill: Omit<TariBillRecord, 'id'>) {
    if (!user) return;
    const basePath = `users/${user.uid}/tariBills`;
    const cleanNotice = bill.noticeNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const docId = `tari_${cleanNotice || Date.now()}`;
    const payload: Record<string, unknown> = {
      ownerId: user.uid,
      noticeNumber: bill.noticeNumber.slice(0, 50),
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
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
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
    const path = `users/${user.uid}/tariBills/${id}`;
    try {
      await deleteDoc(doc(db, path));
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
    try {
      await setDoc(doc(db, basePath, docId), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
    }
  }

  async function handleDeleteGsePayment(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/gsePayments/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async function handleAddArticle(article: Omit<HomeArticleRecord, 'id'>) {
    if (!user) return;
    const basePath = `users/${user.uid}/homeArticles`;
    const docId = `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
    try {
      await setDoc(doc(db, basePath, docId), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `${basePath}/${docId}`);
    }
  }

  async function handleUpdateArticle(id: string, article: Omit<HomeArticleRecord, 'id'>) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/homeArticles/${id}`;
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
    try {
      await setDoc(doc(db, path), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async function handleDeleteArticle(id: string) {
    if (!user || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const path = `users/${user.uid}/homeArticles/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
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
            {!canEdit && (
              <button
                type="button"
                onClick={handleSignIn}
                className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap"
              >
                Accedi per modificare
              </button>
            )}
          </div>
        </header>

        {authError && (
          <div className="px-5 py-2 bg-rose-500/10 border-b border-rose-500/30 text-xs text-rose-300">
            {authError}
          </div>
        )}

        {firestoreFallbackNotice && (
          <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/30 text-xs text-amber-200 flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>{firestoreFallbackNotice}</span>
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
              climateLogs={climateLogs}
              homeConfig={homeConfig}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              availableYears={AVAILABLE_YEARS}
              loading={readingsLoading}
              readOnly={!canEdit}
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
              climateLogs={climateLogs}
              readOnly={!canEdit}
              onUpdateConfig={handleUpdateConfig}
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
              onAddElectricityBill={handleAddElectricityBill}
              onAddWaterBill={handleAddWaterBill}
              onAddTariBill={handleAddTariBill}
              onToggleTariPaid={handleToggleTariPaid}
              onDeleteTariBill={handleDeleteTariBill}
              onAddGsePayment={handleAddGsePayment}
              onDeleteGsePayment={handleDeleteGsePayment}
            />
          )}

          {activeNav === 'articoli' && (
            <ArticlesView
              articles={homeArticles}
              readOnly={!canEdit}
              onAddArticle={handleAddArticle}
              onUpdateArticle={handleUpdateArticle}
              onDeleteArticle={handleDeleteArticle}
            />
          )}

          {activeNav === 'info' && <InfoGuideView />}
        </main>
      </div>
    </div>
  );
}
