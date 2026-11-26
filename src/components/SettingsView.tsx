import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  CloudUpload,
  Database,
  Download,
  FlaskConical,
  HardDrive,
  Laptop,
  Loader2,
  Mail,
  Moon,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  clearSimulatedFirestoreOps,
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
  subscribeFirestoreQuotaExceeded,
  subscribeFirestoreWriteStats,
  subscribeSimulatedFirestoreOps,
  subscribeSimulatedFlushState,
} from '../firebase';
import { HomeSystemConfig } from '../types/home';
import {
  DefaultStartSection,
  GmailSyncIntervalMinutes,
  useAppSettings,
} from '../utils/appSettings';

interface SettingsViewProps {
  homeConfig: HomeSystemConfig;
  readOnly: boolean;
  userEmail: string | null;
  isGmailConnected: boolean;
  gmailSyncing: boolean;
  onConnectOrSyncGmail: () => void;
  onUpdateConfig: (patch: Partial<HomeSystemConfig>) => Promise<void>;
  onExportBackup: () => void;
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
  { value: 'ricerche', label: 'Ricerche' },
  { value: 'documenti', label: 'Documenti' },
  { value: 'macchina', label: 'Macchina' },
  { value: 'spesa', label: 'Spesa' },
  { value: 'info', label: 'Info Utili' },
];

const INTERVAL_OPTIONS: { value: GmailSyncIntervalMinutes; label: string }[] = [
  { value: 5, label: 'Ogni 5 minuti' },
  { value: 10, label: 'Ogni 10 minuti (predefinito)' },
  { value: 15, label: 'Ogni 15 minuti' },
  { value: 30, label: 'Ogni 30 minuti' },
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
  readOnly,
  userEmail,
  isGmailConnected,
  gmailSyncing,
  onConnectOrSyncGmail,
  onUpdateConfig,
  onExportBackup,
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
  const [podDraft, setPodDraft] = useState(homeConfig.podCode);
  const [tariffDraft, setTariffDraft] = useState(String(homeConfig.tariffEurPerKwh));
  const [savingConfig, setSavingConfig] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'info' | 'warn'; text: string } | null>(
    null
  );
  const [storageStats, setStorageStats] = useState(() => measureLocalStorageBytes());

  useEffect(() => {
    setPodDraft(homeConfig.podCode);
    setTariffDraft(String(homeConfig.tariffEurPerKwh));
  }, [homeConfig.podCode, homeConfig.tariffEurPerKwh]);

  useEffect(() => {
    return subscribeFirestoreWriteStats(setWriteStats);
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

  async function handleSaveEnergyConfig(e: React.FormEvent) {
    e.preventDefault();
    const parsedTariff = Number(tariffDraft.replace(',', '.'));
    if (!Number.isFinite(parsedTariff) || parsedTariff <= 0 || parsedTariff > 5) {
      setFeedback({
        tone: 'warn',
        text: 'Inserisci una tariffa €/kWh valida (es. 0,31).',
      });
      return;
    }
    const cleanPod = podDraft.trim().toUpperCase();
    if (cleanPod.length < 8) {
      setFeedback({
        tone: 'warn',
        text: 'Inserisci un codice POD valido.',
      });
      return;
    }
    setSavingConfig(true);
    try {
      await onUpdateConfig({
        podCode: cleanPod,
        tariffEurPerKwh: Math.round(parsedTariff * 10000) / 10000,
      });
      setFeedback({
        tone: 'ok',
        text: settings.firestoreWritesDisabled
          ? 'Parametri impianto aggiornati in locale (Modalità Test attiva: 0 scritture Firestore).'
          : 'Parametri impianto salvati su Firestore.',
      });
    } catch (err) {
      setFeedback({
        tone: 'warn',
        text:
          err instanceof Error
            ? err.message
            : 'Errore durante il salvataggio dei parametri impianto.',
      });
    } finally {
      setSavingConfig(false);
    }
  }

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
          ? `Cache locale ricerche pulita (${removed} voci rimosse).`
          : 'Nessuna cache locale di ricerche da rimuovere.',
    });
  }

  function handleResetAllSettings() {
    resetSettings();
    setStorageStats(measureLocalStorageBytes());
    setFeedback({
      tone: 'ok',
      text: 'Impostazioni ripristinate ai valori predefiniti (Dark Mode attiva, scritture Firestore abilitate).',
    });
  }

  const cardCls =
    'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs transition-colors';
  const subSurfaceCls =
    'bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-lg';
  const inputCls =
    'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500';
  const selectCls =
    'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <SlidersHorizontal className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <span>Impostazioni Sistema & Aspetto</span>
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Gestisci tema visivo, protezione quota Firebase per test nel browser, sincronizzazione Gmail, backup e preferenze interfaccia.
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
            ? 'bg-indigo-50/80 border-indigo-300 dark:bg-indigo-950/35 dark:border-indigo-500/45'
            : cardCls
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  settings.firestoreWritesDisabled
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-slate-950'
                    : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
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
                    ? 'bg-indigo-600 text-white dark:bg-indigo-400 dark:text-slate-950'
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
              Attiva questa opzione quando vuoi fare test nel browser (aggiungere articoli, cambiare varianti su Ricerche, provare la domotica o caricare allegati) senza consumare la quota giornaliera gratuita di Firebase Firestore. Tutte le operazioni simulate restano salvate e visibili in locale e vengono inserite automaticamente su Firestore quando riattivi le scritture.
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
                const pendingBefore = simulatedOps.length;
                updateSettings({ firestoreWritesDisabled: next });
                setFeedback({
                  tone: next ? 'info' : 'ok',
                  text: next
                    ? 'Modalità Test attivata: ogni modifica verrà simulata e salvata in coda in locale con 0 scritture su Firestore.'
                    : pendingBefore > 0
                      ? `Modalità Test disattivata: invio di ${pendingBefore} operazioni simulate su Firestore in corso...`
                      : 'Modalità Test disattivata: le modifiche tornano a essere salvate regolarmente su Firestore.',
                });
              }}
              className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                settings.firestoreWritesDisabled
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-400 dark:hover:bg-indigo-300 dark:text-slate-950'
                  : 'bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950'
              }`}
            >
              <span
                className={`w-8 h-4.5 rounded-full p-0.5 flex items-center transition-colors ${
                  settings.firestoreWritesDisabled
                    ? 'bg-white/30 dark:bg-slate-950/30 justify-end'
                    : 'bg-white/25 dark:bg-slate-950/25 justify-start'
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
            <div className="text-lg font-bold tabular-nums text-indigo-700 dark:text-indigo-300 mt-0.5">
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
                  ? 'Sincronizzazione delle operazioni simulate su Firestore in corso...'
                  : flushState.lastResult?.failed
                    ? `${flushState.lastResult.flushed} su ${flushState.lastResult.total} operazioni salvate su Firestore. ${flushState.lastResult.errorMessage || ''}`
                    : `Sincronizzazione completata: ${flushState.lastResult?.flushed || 0} ${(flushState.lastResult?.flushed || 0) === 1 ? 'operazione salvata' : 'operazioni salvate'} su Firestore.`}
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
                <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
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
                      onClick={() => void flushSimulatedFirestoreOps()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 transition-colors disabled:opacity-50"
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

      {/* Main 2-column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 2. Theme & Appearance */}
        <section className={cardCls}>
          <div className="flex items-center gap-2 mb-4">
            {settings.theme === 'dark' ? (
              <Moon className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            ) : (
              <Sun className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            )}
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Tema Visivo & Interfaccia
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Modalità colore
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateSettings({ theme: 'dark' })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    settings.theme === 'dark'
                      ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/12 ring-2 ring-sky-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <Moon className="w-3.5 h-3.5 text-sky-500" />
                      Dark Mode
                    </span>
                    {settings.theme === 'dark' && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950">
                        Attiva
                      </span>
                    )}
                  </div>
                  <div className="h-8 rounded-md bg-slate-950 border border-slate-800 p-1.5 flex items-center gap-1.5">
                    <span className="w-2.5 h-full rounded-xs bg-sky-500" />
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
                      ? 'border-sky-600 bg-sky-50 dark:bg-sky-500/12 ring-2 ring-sky-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <Sun className="w-3.5 h-3.5 text-sky-600" />
                      Light Mode
                    </span>
                    {settings.theme === 'light' && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-600 text-white">
                        Attiva
                      </span>
                    )}
                  </div>
                  <div className="h-8 rounded-md bg-slate-100 border border-slate-300 p-1.5 flex items-center gap-1.5">
                    <span className="w-2.5 h-full rounded-xs bg-sky-600" />
                    <span className="flex-1 h-2 rounded-xs bg-white border border-slate-200" />
                    <span className="w-6 h-2 rounded-xs bg-emerald-600/80" />
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Chiara · Alta leggibilità diurna
                  </div>
                </button>
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
                  className="w-4 h-4 accent-sky-600 rounded"
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
                  className="w-4 h-4 accent-sky-600 rounded"
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
                  className="w-4 h-4 accent-sky-600 rounded"
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
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Sincronizzazione Gmail INBOX
                </h2>
              </div>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                  isGmailConnected
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {isGmailConnected ? 'Sessione Gmail attiva' : 'Non collegata in questa sessione'}
              </span>
            </div>

            <div className="space-y-3.5">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Controllo automatico in background
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Quando Gmail è collegato, controlla automaticamente la INBOX a intervalli regolari.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoGmailSyncEnabled}
                  onChange={(e) => updateSettings({ autoGmailSyncEnabled: e.target.checked })}
                  className="w-4 h-4 accent-sky-600 rounded"
                />
              </label>

              <div>
                <label
                  htmlFor="settings-gmail-interval"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Frequenza controllo automatico
                </label>
                <select
                  id="settings-gmail-interval"
                  value={settings.autoGmailSyncIntervalMinutes}
                  disabled={!settings.autoGmailSyncEnabled}
                  onChange={(e) =>
                    updateSettings({
                      autoGmailSyncIntervalMinutes: Number(
                        e.target.value
                      ) as GmailSyncIntervalMinutes,
                    })
                  }
                  className={`${selectCls} disabled:opacity-50`}
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  I giorni già salvati fino all’ultima data su Firestore vengono ignorati automaticamente.
                </span>
                <button
                  type="button"
                  onClick={onConnectOrSyncGmail}
                  disabled={gmailSyncing || readOnly}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${gmailSyncing ? 'animate-spin' : ''}`} />
                  <span>{isGmailConnected ? 'Controlla INBOX ora' : 'Collega Gmail'}</span>
                </button>
              </div>
            </div>
          </section>

          <section className={cardCls}>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Parametri Contatore & Tariffa
              </h2>
            </div>

            <form onSubmit={handleSaveEnergyConfig} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="settings-pod-code"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Codice POD contatore
                  </label>
                  <input
                    id="settings-pod-code"
                    type="text"
                    value={podDraft}
                    disabled={readOnly}
                    onChange={(e) => setPodDraft(e.target.value)}
                    placeholder="IT001E..."
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div>
                  <label
                    htmlFor="settings-tariff"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Tariffa stima consumi (€/kWh)
                  </label>
                  <input
                    id="settings-tariff"
                    type="number"
                    step="0.0001"
                    min="0.01"
                    max="5"
                    value={tariffDraft}
                    disabled={readOnly}
                    onChange={(e) => setTariffDraft(e.target.value)}
                    className={`${inputCls} font-mono`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Usata per calcolare la stima costi nelle nuove letture importate.
                </span>
                <button
                  type="submit"
                  disabled={readOnly || savingConfig}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingConfig ? 'Salvataggio...' : 'Salva parametri'}</span>
                </button>
              </div>
            </form>
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
                {countsSummary.readings} giorni · {countsSummary.researches} ricerche · {countsSummary.articles} articoli
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Chiavi locali ricerche: {storageStats.researchKeys}
            </div>
            <button
              type="button"
              onClick={handleClearResearchCaches}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>Pulisci cache locale ricerche</span>
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
    </div>
  );
}
