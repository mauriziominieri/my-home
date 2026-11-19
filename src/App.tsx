import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  Database,
  Globe,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
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
  DEFAULT_HOME_CONFIG,
  EnergyReading,
  HomeSystemConfig,
  NavSection,
  ReadingSource,
} from './types/home';
import { ParsedReadingInput } from './utils/edistribuzioneCsv';
import { OverviewView } from './components/OverviewView';
import { DomoticsView } from './components/DomoticsView';
import { EnergyDatabaseView } from './components/EnergyDatabaseView';
import { IntegrationView } from './components/IntegrationView';

const NAV_ITEMS: { id: NavSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'panoramica', label: 'Panoramica', icon: LayoutDashboard },
  { id: 'consumi', label: 'Consumi Annuali', icon: Database },
  { id: 'domotica', label: 'Clima & Domotica', icon: Thermometer },
  { id: 'integrazione', label: 'Integrazione GitHub', icon: Globe },
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

  // Subscribe to user's real Firestore data only when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setReadings([]);
      setReadingsLoading(false);
      return;
    }

    setReadingsLoading(true);
    const readingsPath = `users/${user.uid}/energyReadings`;
    const readingsQuery = query(
      collection(db, readingsPath),
      where('ownerId', '==', user.uid)
    );

    const unsubReadings = onSnapshot(
      readingsQuery,
      (snap) => {
        const list: EnergyReading[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || user.uid),
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
        setReadings(list);
        setReadingsLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, readingsPath);
      }
    );

    const configPath = `users/${user.uid}/homeConfig/main`;
    const unsubConfig = onSnapshot(
      doc(db, configPath),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setHomeConfig({
            ownerId: user.uid,
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
          setHomeConfig({ ownerId: user.uid, ...DEFAULT_HOME_CONFIG });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, configPath);
      }
    );

    return () => {
      unsubReadings();
      unsubConfig();
    };
  }, [authReady, user]);

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

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-sky-400">
              <Home className="w-5 h-5" />
              <span className="text-base font-bold tracking-tight text-slate-100">
                my-home
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              Centro Domotico & Energia
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Monitoraggio reale giornaliero e-distribuzione (POD IT001E11251419 · 6 kW), pompa di calore Ariston e deumidificatore NeaSmart.
            </p>
          </div>

          <div className="border-t border-slate-800 pt-5 space-y-3">
            <button
              type="button"
              onClick={handleSignIn}
              className="w-full py-2.5 px-4 text-sm font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
            >
              Accedi con Google
            </button>
            {authError && (
              <p className="text-xs text-rose-400">{authError}</p>
            )}
            <p className="text-xs text-slate-500">
              I tuoi dati energetici e i setpoint domotici sono protetti e accessibili solo dal tuo account Google.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentNavLabel =
    NAV_ITEMS.find((n) => n.id === activeNav)?.label || 'Consumi Annuali';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-slate-900 border-r border-slate-800">
        <div className="h-14 px-5 flex items-center border-b border-slate-800">
          <button
            type="button"
            onClick={() => setActiveNav('panoramica')}
            className="inline-flex items-center gap-2 text-slate-100 font-bold tracking-tight text-base whitespace-nowrap"
          >
            <Home className="w-4 h-4 text-sky-400" />
            <span>my-home</span>
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
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
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
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
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
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
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

          <div className="text-xs font-mono text-slate-400 whitespace-nowrap shrink-0">
            POD <span className="text-sky-400">{homeConfig.podCode}</span> · 6 kW
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto">
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
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              availableYears={AVAILABLE_YEARS}
              loading={readingsLoading}
              syncIntervalHours={syncIntervalHours}
              onChangeSyncInterval={setSyncIntervalHours}
              onImportCsv={handleImportCsv}
              onClearAllReadings={handleClearAllReadings}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'domotica' && (
            <DomoticsView
              config={homeConfig}
              onUpdateConfig={handleUpdateConfig}
            />
          )}

          {activeNav === 'integrazione' && (
            <IntegrationView
              config={homeConfig}
              syncIntervalHours={syncIntervalHours}
              onUpdateConfig={handleUpdateConfig}
              onSyncFromGithubJson={handleSyncFromGithubJson}
            />
          )}
        </main>
      </div>
    </div>
  );
}
