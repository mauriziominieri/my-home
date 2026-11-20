import { useEffect, useState } from 'react';
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
  Receipt,
  Thermometer,
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
  ClimateMode,
  ClimateSession,
  DEFAULT_HOME_CONFIG,
  EnergyReading,
  HomeSystemConfig,
  NavSection,
  ReadingSource,
  RoomId,
} from './types/home';
import { ParsedReadingInput } from './utils/edistribuzioneCsv';
import { OverviewView } from './components/OverviewView';
import { DomoticsView } from './components/DomoticsView';
import { EnergyDatabaseView } from './components/EnergyDatabaseView';
import { BillsView } from './components/BillsView';
import { InfoGuideView } from './components/InfoGuideView';

const NAV_ITEMS: { id: NavSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'panoramica', label: 'Panoramica', icon: LayoutDashboard },
  { id: 'consumi', label: 'Consumi Annuali', icon: Database },
  { id: 'domotica', label: 'Clima & Domotica', icon: Thermometer },
  { id: 'bollette', label: 'Bollette', icon: Receipt },
  { id: 'info', label: 'Info Utili', icon: BookOpen },
];

const CURRENT_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

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
  const [readingsLoading, setReadingsLoading] = useState(true);
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
        try {
          localStorage.setItem(`myhome_readings_cache_${activeUid}`, JSON.stringify(filtered));
        } catch {
          // ignore storage quota
        }
        setReadingsLoading(false);
      },
      (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource-exhausted')) {
          console.warn('Firestore quota exceeded for energyReadings; using local cache + data/consumi.json.');
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
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource-exhausted')) {
          console.warn('Firestore quota exceeded for homeConfig; using defaults.');
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
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource-exhausted')) {
          console.warn('Firestore quota exceeded for climateLogs; using local cache.');
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

    return () => {
      unsubReadings();
      unsubConfig();
      unsubClimate();
    };
  }, [authReady, activeUid]);

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
      await setDoc(doc(db, configPath), {
        ...nextConfig,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, configPath);
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
              readOnly={!canEdit}
            />
          )}

          {activeNav === 'info' && <InfoGuideView />}
        </main>
      </div>
    </div>
  );
}
