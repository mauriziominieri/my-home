import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Cloud,
  CloudUpload,
  Database,
  Download,
  ExternalLink,
  FlaskConical,
  Globe,
  HardDrive,
  Laptop,
  Loader2,
  Mail,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  clearDailyFirestoreUsageHistory,
  clearSimulatedFirestoreOps,
  DAILY_FREE_READS_LIMIT,
  DAILY_FREE_WRITES_LIMIT,
  DailyFirestoreUsageEntry,
  discardSimulatedFirestoreOp,
  dismissSimulatedFlushResult,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  FirestoreWriteStats,
  flushSimulatedFirestoreOps,
  isFirestoreQuotaExceededActive,
  resetFirestoreWriteStats,
  SimulatedFirestoreOp,
  SimulatedFlushState,
  subscribeDailyFirestoreUsage,
  subscribeFirestoreQuotaExceeded,
  subscribeFirestoreWriteStats,
  subscribeSimulatedFirestoreOps,
  subscribeSimulatedFlushState,
} from '../firebase';
import { BillRecord, HomeSystemConfig } from '../types/home';
import {
  AppAccentPalette,
  DefaultStartSection,
  sanitizeBackendApiUrl,
  useAppSettings,
} from '../utils/appSettings';
import {
  isStaticHostingOrigin,
  resetBackendAvailabilityCache,
} from '../utils/apiBase';

const ACCENT_PALETTE_OPTIONS: {
  id: AppAccentPalette;
  label: string;
  hint: string;
  swatchHex: string;
}[] = [
  { id: 'sky', label: 'Blu Cielo', hint: 'Predefinita', swatchHex: '#0ea5e9' },
  { id: 'amber', label: 'Giallo Ambra', hint: 'Calda & classica', swatchHex: '#f59e0b' },
  { id: 'emerald', label: 'Verde Smeraldo', hint: 'Naturale', swatchHex: '#10b981' },
  { id: 'teal', label: 'Ottanio', hint: 'Riposante', swatchHex: '#14b8a6' },
  { id: 'indigo', label: 'Indaco', hint: 'Moderna', swatchHex: '#6366f1' },
];

const APPS_SCRIPT_PROJECT_URL =
  'https://script.google.com/u/1/home/projects/1Xv8LKzCxqu2n05njAGj9iMZLEETUD-uyUkaSkzThum6FmOStyTFiq5kh/edit';

interface SettingsViewProps {
  homeConfig: HomeSystemConfig;
  autoPlantMeta: {
    latestBill: BillRecord | null;
    podFromPdf: boolean;
    tariffFromBill: boolean;
    variableRateEurPerKwh: number | null;
  };
  readOnly: boolean;
  userEmail: string | null;
  isGmailConnected: boolean;
  gmailSyncing: boolean;
  onConnectOrSyncGmail: () => void;
  onExportBackup: () => void;
  onRequestEnableFirestoreWrites?: () => void;
  onRequestFlushFirestoreOps?: () => void;
  countsSummary: {
    readings: number;
    climateLogs: number;
    electricityBills: number;
    waterBills: number;
    tariBills: number;
    gsePayments: number;
    articles: number;
    researches: number;
    documents: number;
    carLogs: number;
    groceries: number;
  };
}

const START_SECTION_OPTIONS: { value: DefaultStartSection; label: string }[] = [
  { value: 'remember_last', label: 'Ricorda ultima pagina aperta' },
  { value: 'panoramica', label: 'Panoramica' },
  { value: 'consumi', label: 'Consumi Annuali' },
  { value: 'domotica', label: 'Clima & Domotica' },
  { value: 'bollette', label: 'Bollette' },
  { value: 'articoli', label: 'Articoli' },
  { value: 'ricerche', label: 'Prodotti' },
  { value: 'documenti', label: 'Documenti' },
  { value: 'macchina', label: 'Macchina' },
  { value: 'spesa', label: 'Spesa' },
  { value: 'info', label: 'Info Utili' },
];

function measureLocalStorageBytes(): { totalBytes: number; keyCount: number; researchKeys: number } {
  if (typeof window === 'undefined') return { totalBytes: 0, keyCount: 0, researchKeys: 0 };
  try {
    let totalBytes = 0;
    let keyCount = 0;
    let researchKeys = 0;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('myhome_') || k.startsWith('research_')) {
        const val = window.localStorage.getItem(k) || '';
        totalBytes += (k.length + val.length) * 2;
        keyCount += 1;
        if (k.includes('research') || k.includes('ricerche')) {
          researchKeys += 1;
        }
      }
    }
    return { totalBytes, keyCount, researchKeys };
  } catch {
    return { totalBytes: 0, keyCount: 0, researchKeys: 0 };
  }
}

export function SettingsView({
  homeConfig,
  autoPlantMeta,
  readOnly,
  userEmail,
  isGmailConnected,
  gmailSyncing,
  onConnectOrSyncGmail,
  onExportBackup,
  onRequestEnableFirestoreWrites,
  onRequestFlushFirestoreOps,
  countsSummary,
}: SettingsViewProps) {
  const { settings, updateSettings, resetSettings } = useAppSettings();
  const [writeStats, setWriteStats] = useState<FirestoreWriteStats>({
    writesDisabled: settings.firestoreWritesDisabled,
    writesSavedCount: 0,
    writesExecutedCount: 0,
    lastActionLabel: null,
    lastActionAt: null,
  });
  const [quotaExceeded, setQuotaExceeded] = useState(() => isFirestoreQuotaExceededActive());
  const [simulatedOps, setSimulatedOps] = useState<SimulatedFirestoreOp[]>([]);
  const [flushState, setFlushState] = useState<SimulatedFlushState>({
    flushing: false,
    lastResult: null,
  });
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'info' | 'warn'; text: string } | null>(
    null
  );
  const [storageStats, setStorageStats] = useState(() => measureLocalStorageBytes());
  const [dailyUsage, setDailyUsage] = useState<DailyFirestoreUsageEntry[]>([]);
  const [confirmClearUsageHistory, setConfirmClearUsageHistory] = useState(false);
  const [backendUrlInput, setBackendUrlInput] = useState(() => settings.backendApiUrl || '');
  const [testingBackend, setTestingBackend] = useState(false);
  const isStaticHost = useMemo(() => isStaticHostingOrigin(), []);

  useEffect(() => {
    setBackendUrlInput(settings.backendApiUrl || '');
  }, [settings.backendApiUrl]);

  useEffect(() => {
    return subscribeFirestoreWriteStats(setWriteStats);
  }, []);

  useEffect(() => {
    return subscribeDailyFirestoreUsage(setDailyUsage);
  }, []);

  useEffect(() => {
    return subscribeFirestoreQuotaExceeded(setQuotaExceeded);
  }, []);

  useEffect(() => {
    return subscribeSimulatedFirestoreOps(setSimulatedOps);
  }, []);

  useEffect(() => {
    return subscribeSimulatedFlushState(setFlushState);
  }, []);

  const todayUsage = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    return (
      dailyUsage.find((d) => d.date === todayKey) ?? {
        date: todayKey,
        writes: 0,
        deletes: 0,
        reads: 0,
        savedInTestMode: 0,
        settingsWrites: 0,
      }
    );
  }, [dailyUsage]);

  const todayWriteOps = todayUsage.writes + todayUsage.deletes;
  const remainingWriteQuota = Math.max(0, DAILY_FREE_WRITES_LIMIT - todayWriteOps);
  const remainingReadQuota = Math.max(0, DAILY_FREE_READS_LIMIT - todayUsage.reads);
  const writeUsagePct = Math.min(100, (todayWriteOps / DAILY_FREE_WRITES_LIMIT) * 100);
  const readUsagePct = Math.min(100, (todayUsage.reads / DAILY_FREE_READS_LIMIT) * 100);

  const totalRecords = useMemo(
    () =>
      Object.values(countsSummary).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0),
    [countsSummary]
  );

  const storageFormatted = useMemo(() => {
    if (storageStats.totalBytes < 1024) return `${storageStats.totalBytes} B`;
    if (storageStats.totalBytes < 1024 * 1024) {
      return `${(storageStats.totalBytes / 1024).toFixed(1).replace('.', ',')} KB`;
    }
    return `${(storageStats.totalBytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
  }, [storageStats.totalBytes]);

  function handleClearResearchCaches() {
    if (typeof window === 'undefined') return;
    let removed = 0;
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (
          key.startsWith('myhome_research_') ||
          key.startsWith('myhome_ricerche_') ||
          key.startsWith('research_variants_')
        ) {
          toRemove.push(key);
        }
      }
      for (const k of toRemove) {
        window.localStorage.removeItem(k);
        removed += 1;
      }
    } catch {
      // ignore
    }
    setStorageStats(measureLocalStorageBytes());
    setFeedback({
      tone: 'info',
      text:
        removed > 0
          ? `Cache locale prodotti pulita (${removed} voci rimosse).`
          : 'Nessuna cache locale prodotti da rimuovere.',
    });
  }

  function handleResetAllSettings() {
    resetSettings();
    setStorageStats(measureLocalStorageBytes());
    setFeedback({
      tone: 'ok',
      text: 'Impostazioni ripristinate ai valori predefiniti (Dark Mode, Modalità Test e Densità compatta attive) e sincronizzate sul cloud.',
    });
  }

  const cardCls =
    'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs transition-colors';
  const subSurfaceCls =
    'bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-lg';
  const selectCls =
    'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <SlidersHorizontal className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            <span>Impostazioni Sistema & Aspetto</span>
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Le preferenze dell’app vengono salvate automaticamente su Firebase per ritrovarle identiche su ogni dispositivo. Gestisci Modalità Test, aspetto, sincronizzazione Gmail e backup.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onExportBackup();
              setFeedback({
                tone: 'ok',
                text: 'Backup JSON completo esportato con successo.',
              });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>Esporta Backup JSON</span>
          </button>
          <button
            type="button"
            onClick={handleResetAllSettings}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Ripristina predefinite</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.tone === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-200'
              : feedback.tone === 'warn'
                ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-200'
                : 'bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-semibold opacity-70 hover:opacity-100"
          >
            Chiudi
          </button>
        </div>
      )}

      {/* 1. Primary Card: Firestore Write Gate / Browser Test Mode */}
      <section
        className={`rounded-xl p-5 border transition-colors ${
          settings.firestoreWritesDisabled
            ? 'bg-amber-50/80 border-amber-300 dark:bg-amber-950/25 dark:border-amber-500/40'
            : cardCls
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  settings.firestoreWritesDisabled
                    ? 'bg-amber-500 text-slate-950 dark:bg-amber-400 dark:text-slate-950'
                    : 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                }`}
              >
                <FlaskConical className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Modalità Test Browser (Blocca Scritture Firestore)
              </h2>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md ${
                  settings.firestoreWritesDisabled
                    ? 'bg-amber-500 text-slate-950 dark:bg-amber-400 dark:text-slate-950'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                }`}
              >
                {settings.firestoreWritesDisabled ? (
                  <>
                    <ShieldAlert className="w-3 h-3" />
                    Scritture DB Disattivate
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3 h-3" />
                    Scritture DB Attive
                  </>
                )}
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Attiva questa opzione quando vuoi fare test nel browser (aggiungere articoli, cambiare varianti su Prodotti, provare la domotica o caricare allegati) senza consumare la quota giornaliera gratuita di Firebase Firestore. Tutte le operazioni simulate restano salvate e visibili in locale e, dopo tua conferma, vengono inviate a Firestore in un unico blocco batch quando riattivi le scritture.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={settings.firestoreWritesDisabled}
              disabled={flushState.flushing}
              onClick={() => {
                const next = !settings.firestoreWritesDisabled;
                if (!next) {
                  if (onRequestEnableFirestoreWrites) {
                    onRequestEnableFirestoreWrites();
                    return;
                  }
                }
                const pendingBefore = simulatedOps.length;
                updateSettings({ firestoreWritesDisabled: next });
                setFeedback({
                  tone: next ? 'info' : 'ok',
                  text: next
                    ? 'Modalità Test attivata: ogni modifica verrà simulata e salvata in coda in locale con 0 scritture su Firestore.'
                    : pendingBefore > 0
                      ? `Modalità Test disattivata: invio in blocco di ${pendingBefore} operazioni simulate su Firestore in corso...`
                      : 'Modalità Test disattivata: le modifiche tornano a essere salvate regolarmente su Firestore.',
                });
              }}
              className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                settings.firestoreWritesDisabled
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-400 dark:hover:bg-emerald-300 dark:text-slate-950'
                  : 'bg-amber-500 hover:bg-amber-600 text-slate-950 dark:bg-amber-400 dark:hover:bg-amber-300 dark:text-slate-950'
              }`}
            >
              <span
                className={`w-8 h-4.5 rounded-full p-0.5 flex items-center transition-colors ${
                  settings.firestoreWritesDisabled
                    ? 'bg-white/30 dark:bg-slate-950/30 justify-end'
                    : 'bg-white/40 dark:bg-slate-950/25 justify-start'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-white shadow-xs" />
              </span>
              <span>
                {settings.firestoreWritesDisabled
                  ? 'Modalità Test ATTIVA (Riattiva DB)'
                  : 'Disattiva Scritture Firestore'}
              </span>
            </button>
          </div>
        </div>

        {/* Real Session Write Counters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-800/80">
          <div className={`${subSurfaceCls} px-3.5 py-2.5`}>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              In coda locale / risparmiate
            </div>
            <div className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300 mt-0.5">
              {simulatedOps.length} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">in coda · {writeStats.writesSavedCount} sess.</span>
            </div>
          </div>

          <div className={`${subSurfaceCls} px-3.5 py-2.5`}>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Scritture inviate a Firestore (sessione)
            </div>
            <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {writeStats.writesExecutedCount}
            </div>
          </div>

          <div className={`${subSurfaceCls} px-3.5 py-2.5 flex items-center justify-between gap-2`}>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Ultima operazione tracciata
              </div>
              <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate mt-0.5">
                {writeStats.lastActionLabel || 'Nessuna operazione in questa sessione'}
              </div>
            </div>
            {(writeStats.writesSavedCount > 0 || writeStats.writesExecutedCount > 0) && (
              <button
                type="button"
                onClick={() => resetFirestoreWriteStats()}
                title="Azzera contatori sessione"
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Flush Progress / Result */}
        {(flushState.flushing || flushState.lastResult) && (
          <div
            className={`mt-3 px-3.5 py-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
              flushState.flushing
                ? 'bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-200'
                : flushState.lastResult?.failed
                  ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-200'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {flushState.flushing ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <CloudUpload className="w-4 h-4 shrink-0" />
              )}
              <span>
                {flushState.flushing
                  ? 'Sincronizzazione in blocco su Firestore in corso...'
                  : flushState.lastResult?.failed
                    ? `${flushState.lastResult.flushed} su ${flushState.lastResult.total} operazioni salvate su Firestore. ${flushState.lastResult.errorMessage || ''}`
                    : `Sincronizzazione completata: ${flushState.lastResult?.flushed || 0} ${(flushState.lastResult?.flushed || 0) === 1 ? 'operazione salvata' : 'operazioni salvate'} su Firestore${
                        flushState.lastResult?.batchCommits
                          ? ` (${flushState.lastResult.docWrites || 0} scritture in ${flushState.lastResult.batchCommits} ${flushState.lastResult.batchCommits === 1 ? 'unico blocco batch' : 'blocchi batch'})`
                          : ''
                      }.`}
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

        {/* Visible Queue of Simulated Local Operations */}
        {(simulatedOps.length > 0 || settings.firestoreWritesDisabled) && (
          <div className="mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>
                  Operazioni simulate salvate in locale ({simulatedOps.length})
                </span>
              </div>

              {simulatedOps.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {!settings.firestoreWritesDisabled && (
                    <button
                      type="button"
                      disabled={flushState.flushing || readOnly}
                      onClick={() => {
                        if (onRequestFlushFirestoreOps) {
                          onRequestFlushFirestoreOps();
                        } else {
                          void flushSimulatedFirestoreOps();
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-400 dark:hover:bg-emerald-300 dark:text-slate-950 transition-colors disabled:opacity-50"
                    >
                      <CloudUpload className="w-3 h-3" />
                      <span>Invia su Firestore ({simulatedOps.length})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={flushState.flushing}
                    onClick={() => clearSimulatedFirestoreOps()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3 text-rose-500" />
                    <span>Svuota coda</span>
                  </button>
                </div>
              )}
            </div>

            {simulatedOps.length === 0 ? (
              <div className={`${subSurfaceCls} px-3.5 py-2.5 text-xs text-slate-500 dark:text-slate-400`}>
                Nessuna operazione simulata in attesa. Le modifiche che farai ora nelle varie sezioni appariranno qui e verranno salvate su Firestore appena riattiverai le scritture.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
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
                      className={`${subSurfaceCls} px-3 py-2 flex items-start justify-between gap-2 text-xs`}
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
            )}
          </div>
        )}
      </section>

      {/* 1b. Daily Firestore Quota & Settings Writes Transparency */}
      <section className={cardCls}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Database className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <span>Quota Giornaliera Firestore &amp; Storico Consumi</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Ogni modifica effettiva di un&apos;impostazione (da loggato) esegue{' '}
              <strong className="text-slate-900 dark:text-slate-100">1 scrittura</strong> su Firebase (documento{' '}
              <span className="font-mono text-[11px]">app_settings_state</span>) e{' '}
              <strong className="text-slate-900 dark:text-slate-100">0 letture</strong>; se clicchi lo stesso valore già attivo o sei sloggato consuma{' '}
              <strong className="text-emerald-700 dark:text-emerald-300">0 scritture</strong>. Qui vedi il consumo registrato su questo browser rispetto ai limiti gratuiti giornalieri Spark (reset ~09:00 ora italiana / 00:00 Pacifico).
            </p>
          </div>

          {dailyUsage.length > 0 && (
            <div className="shrink-0">
              {confirmClearUsageHistory ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/10 border border-rose-500/30 rounded-lg text-[11px]">
                  <span className="text-rose-700 dark:text-rose-200 font-medium">Azzerare storico?</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearDailyFirestoreUsageHistory();
                      setConfirmClearUsageHistory(false);
                      setFeedback({ tone: 'info', text: 'Storico giornaliero Firestore azzerato su questo browser.' });
                    }}
                    className="px-2 py-0.5 font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded"
                  >
                    Conferma
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearUsageHistory(false)}
                    className="px-2 py-0.5 text-slate-600 dark:text-slate-300"
                  >
                    Annulla
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearUsageHistory(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Azzera storico</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Today's Quota Meters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className={`${subSurfaceCls} p-3.5 space-y-2`}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Scritture + Eliminazioni Oggi
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {todayWriteOps.toLocaleString('it-IT')} / {DAILY_FREE_WRITES_LIMIT.toLocaleString('it-IT')}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  writeUsagePct >= 85
                    ? 'bg-rose-500'
                    : writeUsagePct >= 60
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.max(todayWriteOps > 0 ? 2 : 0, writeUsagePct)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                Restanti stimate:{' '}
                <strong className="font-mono text-emerald-700 dark:text-emerald-300">
                  {remainingWriteQuota.toLocaleString('it-IT')}
                </strong>{' '}
                ({(100 - writeUsagePct).toFixed(1).replace('.', ',')}%)
              </span>
              <span className="font-mono">
                {todayUsage.writes} scr. · {todayUsage.deletes} elim. · {todayUsage.settingsWrites} imp.
              </span>
            </div>
          </div>

          <div className={`${subSurfaceCls} p-3.5 space-y-2`}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Letture Listener &amp; Query Oggi
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {todayUsage.reads.toLocaleString('it-IT')} / {DAILY_FREE_READS_LIMIT.toLocaleString('it-IT')}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  readUsagePct >= 85
                    ? 'bg-rose-500'
                    : readUsagePct >= 60
                      ? 'bg-amber-500'
                      : 'bg-sky-500'
                }`}
                style={{ width: `${Math.max(todayUsage.reads > 0 ? 2 : 0, readUsagePct)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                Restanti stimate:{' '}
                <strong className="font-mono text-sky-700 dark:text-sky-300">
                  {remainingReadQuota.toLocaleString('it-IT')}
                </strong>{' '}
                ({(100 - readUsagePct).toFixed(1).replace('.', ',')}%)
              </span>
              <span className="font-mono text-amber-700 dark:text-amber-300">
                Risparmiate (Test Mode): {todayUsage.savedInTestMode.toLocaleString('it-IT')}
              </span>
            </div>
          </div>
        </div>

        {/* 30-day Daily Table */}
        {dailyUsage.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium text-right">Scritture</th>
                  <th className="px-3 py-2 font-medium text-right">Eliminazioni</th>
                  <th className="px-3 py-2 font-medium text-right">Impostazioni</th>
                  <th className="px-3 py-2 font-medium text-right">Letture</th>
                  <th className="px-3 py-2 font-medium text-right">Risparmiate (Test)</th>
                  <th className="px-3 py-2 font-medium text-right">% Quota Scritture</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                {dailyUsage.map((row) => {
                  const totalW = row.writes + row.deletes;
                  const pct = (totalW / DAILY_FREE_WRITES_LIMIT) * 100;
                  const [y, m, d] = row.date.split('-');
                  return (
                    <tr key={row.date} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-3 py-1.5 font-mono text-slate-800 dark:text-slate-200">
                        {d}/{m}/{y}
                        {row.date === todayUsage.date && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-sans font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 rounded">
                            Oggi
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {row.writes}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-300">
                        {row.deletes}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-indigo-700 dark:text-indigo-300">
                        {row.settingsWrites}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-sky-700 dark:text-sky-300">
                        {row.reads}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
                        {row.savedInTestMode}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {pct.toFixed(2).replace('.', ',')}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
          Nota tecnica: Firebase non fornisce un&apos;API client per leggere il contatore ufficiale di fatturazione del progetto, quindi questo pannello misura tutte le operazioni reali eseguite da questo browser (cache locale di Firestore esclusa). Gli script automatici esterni (Google Apps Script 24/7 per e-distribuzione) scrivono separatamente lato server senza passare dal browser.
        </p>
      </section>

      {/* Main 2-column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 2. Theme & Appearance */}
        <section className={cardCls}>
          <div className="flex items-center gap-2 mb-4">
            {settings.theme === 'dark' ? (
              <Moon className="w-4 h-4 text-brand-600 dark:text-brand-400" />
            ) : (
              <Sun className="w-4 h-4 text-brand-600 dark:text-brand-400" />
            )}
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Tema Visivo, Colori &amp; Interfaccia
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Modalità sfondo
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateSettings({ theme: 'dark' })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    settings.theme === 'dark'
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/12 ring-2 ring-brand-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <Moon className="w-3.5 h-3.5 text-brand-500" />
                      Dark Mode
                    </span>
                    {settings.theme === 'dark' && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-950">
                        Attiva
                      </span>
                    )}
                  </div>
                  <div className="h-8 rounded-md bg-slate-950 border border-slate-800 p-1.5 flex items-center gap-1.5">
                    <span className="w-2.5 h-full rounded-xs bg-brand-400" />
                    <span className="flex-1 h-2 rounded-xs bg-slate-800" />
                    <span className="w-6 h-2 rounded-xs bg-emerald-500/70" />
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Predefinita · Blu notte riposante
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => updateSettings({ theme: 'light' })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    settings.theme === 'light'
                      ? 'border-brand-600 bg-brand-50 dark:bg-brand-500/12 ring-2 ring-brand-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <Sun className="w-3.5 h-3.5 text-brand-600" />
                      Light Mode
                    </span>
                    {settings.theme === 'light' && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-950">
                        Attiva
                      </span>
                    )}
                  </div>
                  <div className="h-8 rounded-md bg-slate-100 border border-slate-300 p-1.5 flex items-center gap-1.5">
                    <span className="w-2.5 h-full rounded-xs bg-brand-600" />
                    <span className="flex-1 h-2 rounded-xs bg-white border border-slate-200" />
                    <span className="w-6 h-2 rounded-xs bg-emerald-600/80" />
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Chiara · Alta leggibilità diurna
                  </div>
                </button>
              </div>
            </div>

            {/* Accent Color Picker + Semantic Pattern Guide */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Palette className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                  <span>Colore principale dell&apos;app</span>
                </label>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Menu laterale, pulsanti guida e filtri attivi
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {ACCENT_PALETTE_OPTIONS.map((opt) => {
                  const selected = settings.accentPalette === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateSettings({ accentPalette: opt.id })}
                      className={`px-2.5 py-2 rounded-lg border text-left transition-all flex items-center gap-2 ${
                        selected
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15 ring-2 ring-brand-500/25'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/15 dark:border-white/20"
                        style={{ backgroundColor: opt.swatchHex }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {opt.label}
                        </span>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {selected ? 'Selezionato' : opt.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className={`${subSurfaceCls} p-2.5 space-y-1.5`}>
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Schema colori semantico coerente (fisso in tutta l&apos;app)
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 shrink-0" />
                    <span><strong className="text-emerald-700 dark:text-emerald-300">Verde:</strong> Salva, Conferma, Pagato</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 shrink-0" />
                    <span><strong className="text-rose-700 dark:text-rose-300">Rosso:</strong> Elimina, Spegni ora</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 shrink-0" />
                    <span><strong className="text-amber-700 dark:text-amber-300">Giallo Ambra:</strong> Riscaldamento, Evidenza, Test</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 shrink-0" />
                    <span><strong className="text-sky-700 dark:text-sky-300">Azzurro:</strong> Raffrescamento, Acqua</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Sidebar desktop sempre espansa
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Mostra sempre le etichette del menu laterale invece di espanderle solo al passaggio del mouse.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.sidebarAlwaysExpanded}
                  onChange={(e) => updateSettings({ sidebarAlwaysExpanded: e.target.checked })}
                  className="w-4 h-4 accent-brand-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Densità layout compatta
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Riduce i margini esterni dell’area contenuti per visualizzare più dati su schermi ampi.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.compactDensity}
                  onChange={(e) => updateSettings({ compactDensity: e.target.checked })}
                  className="w-4 h-4 accent-brand-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Mostra suggerimenti operativi nelle pagine
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Visualizza i riquadri informativi contestuali (es. regole email e guide rapide).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showInlineTooltips}
                  onChange={(e) => updateSettings({ showInlineTooltips: e.target.checked })}
                  className="w-4 h-4 accent-brand-600 rounded"
                />
              </label>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <label
                htmlFor="settings-start-page"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Pagina iniziale all’apertura dell’app
              </label>
              <select
                id="settings-start-page"
                value={settings.defaultStartSection}
                onChange={(e) =>
                  updateSettings({
                    defaultStartSection: e.target.value as DefaultStartSection,
                  })
                }
                className={selectCls}
              >
                {START_SECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 3. Gmail Sync & Electric Plant */}
        <div className="space-y-5">
          <section className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Sincronizzazione Gmail INBOX
                </h2>
              </div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                Apps Script 24/7
              </span>
            </div>

            <div className="space-y-3.5">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/20 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-950 dark:text-emerald-200">
                    <Cloud className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Controllo automatico 24/7 su Google Apps Script</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-emerald-900/85 dark:text-emerald-100/80">
                    La INBOX viene controllata in cloud sui server Google anche a PC e browser spenti, salvando i dati direttamente su Firestore.
                  </p>
                </div>

                <a
                  href={APPS_SCRIPT_PROJECT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Apri progetto Apps Script</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className={`${subSurfaceCls} p-3 flex flex-wrap items-center justify-between gap-2`}>
                <span className="text-[11px] text-slate-600 dark:text-slate-400">
                  Sincronizzazione manuale istantanea dal browser (utile per importare subito anche PDF bollette):
                </span>
                <button
                  type="button"
                  onClick={onConnectOrSyncGmail}
                  disabled={gmailSyncing || readOnly}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${gmailSyncing ? 'animate-spin' : ''}`} />
                  <span>{isGmailConnected ? 'Controlla INBOX ora' : 'Sincronizza Gmail'}</span>
                </button>
              </div>
            </div>
          </section>

          <section className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Contatore POD &amp; Tariffa (Automatici dalle Bollette)
                </h2>
              </div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
                Rilevamento automatico
              </span>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className={`${subSurfaceCls} p-3 space-y-1`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      Codice POD contatore
                    </span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {autoPlantMeta.podFromPdf ? 'Da PDF bolletta' : 'Archivio impianto'}
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                    {homeConfig.podCode}
                  </div>
                </div>

                <div className={`${subSurfaceCls} p-3 space-y-1`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      Tariffa effettiva stima consumi
                    </span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {autoPlantMeta.tariffFromBill ? 'Da ultima bolletta' : 'Predefinita'}
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                    {homeConfig.tariffEurPerKwh.toFixed(3).replace('.', ',')} €/kWh
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                {autoPlantMeta.latestBill ? (
                  <>
                    Valori ricavati automaticamente dall&apos;ultima bolletta Luce:{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {autoPlantMeta.latestBill.supplier} · {autoPlantMeta.latestBill.period} (n° {autoPlantMeta.latestBill.invoiceNumber})
                    </span>
                    {autoPlantMeta.variableRateEurPerKwh !== null && (
                      <>
                        {' '}· Quota energia variabile:{' '}
                        <span className="font-mono text-slate-800 dark:text-slate-200">
                          {autoPlantMeta.variableRateEurPerKwh.toFixed(3).replace('.', ',')} €/kWh
                        </span>
                      </>
                    )}
                    . Si aggiornano da soli a ogni nuova bolletta importata.
                  </>
                ) : (
                  'Nessuna bolletta Luce importata: POD e tariffa si aggiorneranno automaticamente non appena importerai la prima bolletta Luce (da Gmail o PDF).'
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 4. Data Archive, Local Cache & Firebase Diagnostics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className={cardCls}>
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Cache Locale & Manutenzione Browser
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`${subSurfaceCls} p-3`}>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Spazio cache locale app
              </div>
              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {storageFormatted}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {storageStats.keyCount} chiavi salvate sul browser
              </div>
            </div>

            <div className={`${subSurfaceCls} p-3`}>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Record caricati in memoria
              </div>
              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {totalRecords}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {countsSummary.readings} giorni · {countsSummary.researches} prodotti · {countsSummary.articles} articoli
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Chiavi locali prodotti: {storageStats.researchKeys}
            </div>
            <button
              type="button"
              onClick={handleClearResearchCaches}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>Pulisci cache locale prodotti</span>
            </button>
          </div>
        </section>

        <section className={cardCls}>
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Stato Connessione & Progetto Firebase
            </h2>
          </div>

          <div className="space-y-2 text-xs">
            <div className={`${subSurfaceCls} px-3 py-2 flex items-center justify-between gap-2`}>
              <span className="text-slate-500 dark:text-slate-400">Progetto Firebase</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {FIREBASE_PROJECT_ID}
              </span>
            </div>
            <div className={`${subSurfaceCls} px-3 py-2 flex items-center justify-between gap-2`}>
              <span className="text-slate-500 dark:text-slate-400">Database Firestore</span>
              <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200 truncate">
                {FIRESTORE_DATABASE_ID}
              </span>
            </div>
            <div className={`${subSurfaceCls} px-3 py-2 flex items-center justify-between gap-2`}>
              <span className="text-slate-500 dark:text-slate-400">Account proprietario</span>
              <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                {userEmail || 'Modalità sola lettura (ospite)'}
              </span>
            </div>
            <div className={`${subSurfaceCls} px-3 py-2 flex items-center justify-between gap-2`}>
              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Laptop className="w-3.5 h-3.5" />
                <span>Stato quota Firestore</span>
              </span>
              <span
                className={`font-semibold ${
                  quotaExceeded
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {quotaExceeded ? 'Quota giornaliera esaurita' : 'Operativa'}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* 5. Backend Server URL for GitHub Pages / Mobile Safari & Chrome */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Server Backend Ricerche (GitHub Pages / iPhone Safari / Chrome)
            </h2>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
              !isStaticHost || settings.backendApiUrl
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
                : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30'
            }`}
          >
            <Globe className="w-3 h-3" />
            {!isStaticHost
              ? 'Server locale / cloud attivo su questo dominio'
              : settings.backendApiUrl
                ? 'Backend remoto configurato'
                : 'Modalità browser (Icecat attivo)'}
          </span>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
          I cataloghi ufficiali compatibili (Electrolux, AEG, Zanussi, Bosch, ecc. via Open Icecat) funzionano{' '}
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            già direttamente dal browser
          </span>{' '}
          anche su GitHub Pages, iPhone Safari e Chrome senza alcun server. Per importare anche siti con blocco CORS (Amazon, MediaWorld, Leroy Merlin, IKEA) da GitHub Pages o cellulare, collega qui l&apos;URL HTTPS del tuo server Node (`server.ts`): verrà sincronizzato automaticamente su tutti i tuoi dispositivi.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={backendUrlInput}
            onChange={(e) => setBackendUrlInput(e.target.value)}
            placeholder="https://tuo-server-myhome.onrender.com (opzionale)"
            className="flex-1 min-w-[220px] px-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
          />
          <button
            type="button"
            disabled={testingBackend}
            onClick={async () => {
              const cleaned = sanitizeBackendApiUrl(backendUrlInput);
              if (backendUrlInput.trim() && !cleaned) {
                setFeedback({
                  tone: 'warn',
                  text: 'Inserisci un URL HTTPS/HTTP valido (es. https://mio-server.onrender.com).',
                });
                return;
              }
              if (!cleaned) {
                updateSettings({ backendApiUrl: '' });
                resetBackendAvailabilityCache();
                setFeedback({
                  tone: 'info',
                  text: 'URL server backend rimosso: su GitHub Pages resta attiva la ricerca diretta browser (Icecat/Wikipedia).',
                });
                return;
              }
              setTestingBackend(true);
              try {
                const resp = await fetch(`${cleaned}/api/health`, {
                  method: 'GET',
                  mode: 'cors',
                  signal: AbortSignal.timeout(7_000),
                });
                const ct = (resp.headers.get('content-type') || '').toLowerCase();
                if (!resp.ok || !ct.includes('application/json')) {
                  throw new Error(`Risposta non valida (HTTP ${resp.status})`);
                }
                const data = (await resp.json()) as { ok?: boolean };
                if (!data.ok) throw new Error('Healthcheck negativo');
                updateSettings({ backendApiUrl: cleaned });
                resetBackendAvailabilityCache();
                setBackendUrlInput(cleaned);
                setFeedback({
                  tone: 'ok',
                  text: `Backend connesso e salvato (${cleaned}): ora le ricerche complete funzionano anche su GitHub Pages, Chrome e iPhone Safari.`,
                });
              } catch (err) {
                updateSettings({ backendApiUrl: cleaned });
                resetBackendAvailabilityCache();
                setFeedback({
                  tone: 'warn',
                  text: `URL salvato (${cleaned}), ma il test di connessione non ha risposto (${
                    err instanceof Error ? err.message : 'errore rete/CORS'
                  }). Verifica che il server sia acceso e pubblico.`,
                });
              } finally {
                setTestingBackend(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {testingBackend ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            <span>{backendUrlInput.trim() ? 'Testa e salva URL' : 'Ripristina predefinito'}</span>
          </button>
          {settings.backendApiUrl && (
            <button
              type="button"
              onClick={() => {
                setBackendUrlInput('');
                updateSettings({ backendApiUrl: '' });
                resetBackendAvailabilityCache();
                setFeedback({
                  tone: 'info',
                  text: 'URL backend remoto scollegato.',
                });
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Rimuovi</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
