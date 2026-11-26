import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gauge,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  CarProfile,
  HomeReminderRecord,
  ReminderCategory,
  ReminderNotificationConfig,
} from '../types/home';
import {
  buildDailyReminderDigestText,
  computeReminderLifecycle,
  formatIsoToItDate,
  normalizeReminderDateIso,
  REMINDER_CATEGORY_META,
  REMINDER_PRESETS,
  ReminderLifecycleInfo,
  ReminderTemplatePreset,
} from '../utils/remindersStore';
import { AccessUnlockBanner } from './AccessUnlockBanner';

interface RemindersViewProps {
  reminders: HomeReminderRecord[];
  notifyConfig: ReminderNotificationConfig;
  carProfile: CarProfile;
  todayIso: string;
  readOnly?: boolean;
  isGmailConnected: boolean;
  sendingEmail: boolean;
  onSignIn?: () => void;
  onAddReminder: (reminder: Omit<HomeReminderRecord, 'id'>) => Promise<void>;
  onUpdateReminder: (id: string, reminder: Omit<HomeReminderRecord, 'id'>) => Promise<void>;
  onDeleteReminder: (id: string) => Promise<void>;
  onSaveNotifyConfig: (cfg: ReminderNotificationConfig) => Promise<void>;
  onSendDailyDigestEmail: (
    dueItems: { reminder: HomeReminderRecord; lifecycle: ReminderLifecycleInfo }[]
  ) => Promise<void>;
  onMarkNotifiedToday: (reminderIds: string[]) => Promise<void>;
}

const APPS_SCRIPT_PROJECT_URL =
  'https://script.google.com/u/1/home/projects/1Xv8LKzCxqu2n05njAGj9iMZLEETUD-uyUkaSkzThum6FmOStyTFiq5kh/edit';

function buildWhatsAppUrl(phoneRaw: string | undefined, text: string): string {
  const digits = (phoneRaw || '').replace(/[^\d]/g, '');
  const encoded = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function RemindersView({
  reminders,
  notifyConfig,
  carProfile,
  todayIso,
  readOnly = false,
  isGmailConnected,
  sendingEmail,
  onSignIn,
  onAddReminder,
  onUpdateReminder,
  onDeleteReminder,
  onSaveNotifyConfig,
  onSendDailyDigestEmail,
  onMarkNotifiedToday,
}: RemindersViewProps) {
  const [filterCategory, setFilterCategory] = useState<'all' | ReminderCategory | 'in_scadenza' | 'completati'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HomeReminderRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showNotifySettings, setShowNotifySettings] = useState(false);
  const [showAppsScriptModal, setShowAppsScriptModal] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);

  // Notification config draft
  const [cfgEmail, setCfgEmail] = useState(notifyConfig.defaultEmail);
  const [cfgPhone, setCfgPhone] = useState(notifyConfig.whatsappPhone);
  const [cfgCallmebotKey, setCfgCallmebotKey] = useState(notifyConfig.callmebotApiKey || '');
  const [cfgAutoEmail, setCfgAutoEmail] = useState(notifyConfig.autoEmailOnOpen);
  const [savingCfg, setSavingCfg] = useState(false);
  const [sendingWhatsappBot, setSendingWhatsappBot] = useState(false);

  // Form states
  const [fTitle, setFTitle] = useState('');
  const [fCategory, setFCategory] = useState<ReminderCategory>('auto_manutenzione');
  const [fStartDate, setFStartDate] = useState(todayIso);
  const [fDurationYears, setFDurationYears] = useState('1');
  const [fDurationMonths, setFDurationMonths] = useState('0');
  const [fDurationDays, setFDurationDays] = useState('0');
  const [fCustomEndDate, setFCustomEndDate] = useState('');
  const [fTrackKm, setFTrackKm] = useState(false);
  const [fStartKm, setFStartKm] = useState(
    carProfile.currentKm !== undefined ? String(carProfile.currentKm) : '150000'
  );
  const [fIntervalKm, setFIntervalKm] = useState('15000');
  const [fNotifyEnabled, setFNotifyEnabled] = useState(true);
  const [fLeadMonths, setFLeadMonths] = useState('2');
  const [fLeadDays, setFLeadDays] = useState('0');
  const [fNotifyEmail, setFNotifyEmail] = useState(true);
  const [fNotifyWhatsapp, setFNotifyWhatsapp] = useState(true);
  const [fRenewable, setFRenewable] = useState(true);
  const [fNotes, setFNotes] = useState('');

  const enrichedReminders = useMemo(() => {
    return reminders
      .map((r) => ({
        reminder: r,
        lifecycle: computeReminderLifecycle(r, todayIso, carProfile.currentKm),
      }))
      .sort((a, b) => {
        if (a.reminder.completed !== b.reminder.completed) {
          return a.reminder.completed ? 1 : -1;
        }
        if (a.lifecycle.isOverdue !== b.lifecycle.isOverdue) {
          return a.lifecycle.isOverdue ? -1 : 1;
        }
        if (a.lifecycle.isInWarningWindow !== b.lifecycle.isInWarningWindow) {
          return a.lifecycle.isInWarningWindow ? -1 : 1;
        }
        return a.lifecycle.remainingDays - b.lifecycle.remainingDays;
      });
  }, [reminders, todayIso, carProfile.currentKm]);

  const warningItems = useMemo(
    () => enrichedReminders.filter((x) => x.lifecycle.isInWarningWindow),
    [enrichedReminders]
  );

  const dueTodayItems = useMemo(
    () => enrichedReminders.filter((x) => x.lifecycle.needsNotificationToday),
    [enrichedReminders]
  );

  const filteredItems = useMemo(() => {
    return enrichedReminders.filter(({ reminder, lifecycle }) => {
      if (filterCategory === 'in_scadenza') return lifecycle.isInWarningWindow || lifecycle.isOverdue;
      if (filterCategory === 'completati') return reminder.completed;
      if (filterCategory !== 'all') return reminder.category === filterCategory && !reminder.completed;
      return true;
    });
  }, [enrichedReminders, filterCategory]);

  const digestPayload = useMemo(() => {
    const items = dueTodayItems.length > 0 ? dueTodayItems : warningItems;
    return buildDailyReminderDigestText(items, carProfile);
  }, [dueTodayItems, warningItems, carProfile]);

  function openNewForm(preset?: ReminderTemplatePreset) {
    setEditingId(null);
    if (preset) {
      const built = preset.build(todayIso, carProfile);
      setFTitle(built.title);
      setFCategory(built.category);
      setFStartDate(built.startDate);
      setFDurationYears(String(built.durationYears ?? 0));
      setFDurationMonths(String(built.durationMonths ?? 0));
      setFDurationDays(String(built.durationDays ?? 0));
      setFCustomEndDate(built.customEndDate || '');
      setFTrackKm(Boolean(built.trackKm));
      setFStartKm(built.startKm !== undefined ? String(built.startKm) : '150000');
      setFIntervalKm(built.intervalKm !== undefined ? String(built.intervalKm) : '15000');
      setFNotifyEnabled(built.notifyEnabled);
      setFLeadMonths(String(built.leadMonths));
      setFLeadDays(String(built.leadDays));
      setFNotifyEmail(built.notifyEmail);
      setFNotifyWhatsapp(built.notifyWhatsapp);
      setFRenewable(built.renewable);
      setFNotes(built.notes || '');
    } else {
      setFTitle('');
      setFCategory('auto_manutenzione');
      setFStartDate(todayIso);
      setFDurationYears('1');
      setFDurationMonths('0');
      setFDurationDays('0');
      setFCustomEndDate('');
      setFTrackKm(false);
      setFStartKm(carProfile.currentKm !== undefined ? String(carProfile.currentKm) : '150000');
      setFIntervalKm('15000');
      setFNotifyEnabled(true);
      setFLeadMonths('2');
      setFLeadDays('0');
      setFNotifyEmail(true);
      setFNotifyWhatsapp(true);
      setFRenewable(true);
      setFNotes('');
    }
    setShowForm(true);
  }

  function openEditForm(item: HomeReminderRecord) {
    setEditingId(item.id);
    setFTitle(item.title);
    setFCategory(item.category);
    setFStartDate(item.startDate);
    setFDurationYears(String(item.durationYears ?? 0));
    setFDurationMonths(String(item.durationMonths ?? 0));
    setFDurationDays(String(item.durationDays ?? 0));
    setFCustomEndDate(item.customEndDate || '');
    setFTrackKm(Boolean(item.trackKm));
    setFStartKm(item.startKm !== undefined ? String(item.startKm) : '');
    setFIntervalKm(item.intervalKm !== undefined ? String(item.intervalKm) : '15000');
    setFNotifyEnabled(item.notifyEnabled);
    setFLeadMonths(String(item.leadMonths));
    setFLeadDays(String(item.leadDays));
    setFNotifyEmail(item.notifyEmail);
    setFNotifyWhatsapp(item.notifyWhatsapp);
    setFRenewable(item.renewable);
    setFNotes(item.notes || '');
    setShowForm(true);
  }

  async function handleQuickAddPreset(preset: ReminderTemplatePreset) {
    if (readOnly) return;
    setNotice(null);
    const payload = preset.build(todayIso, carProfile);
    await onAddReminder(payload);
    setNotice({
      tone: 'ok',
      text: `Promemoria "${payload.title}" creato con i parametri consigliati. Puoi modificarlo in qualsiasi momento.`,
    });
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!fTitle.trim() || readOnly) return;
    const normStart = normalizeReminderDateIso(fStartDate) || todayIso;
    const normCustomEnd = normalizeReminderDateIso(fCustomEndDate) || undefined;
    const existing = editingId ? reminders.find((r) => r.id === editingId) : undefined;
    const payload: Omit<HomeReminderRecord, 'id'> = {
      title: fTitle.trim(),
      category: fCategory,
      startDate: normStart,
      durationYears: Math.max(0, Number(fDurationYears) || 0),
      durationMonths: Math.max(0, Number(fDurationMonths) || 0),
      durationDays: Math.max(0, Number(fDurationDays) || 0),
      customEndDate: normCustomEnd,
      trackKm: fTrackKm,
      startKm: fTrackKm && fStartKm.trim() ? Number(fStartKm) : undefined,
      intervalKm: fTrackKm && fIntervalKm.trim() ? Number(fIntervalKm) : undefined,
      notifyEnabled: fNotifyEnabled,
      leadMonths: Math.max(0, Number(fLeadMonths) || 0),
      leadDays: Math.max(0, Number(fLeadDays) || 0),
      notifyEmail: fNotifyEnabled && fNotifyEmail,
      notifyWhatsapp: fNotifyEnabled && fNotifyWhatsapp,
      renewable: fRenewable,
      completed: existing?.completed ?? false,
      completedDate: existing?.completedDate,
      renewalCount: existing?.renewalCount ?? 0,
      lastNotifiedDate: existing?.lastNotifiedDate,
      notes: fNotes.trim() || undefined,
    };

    setSaving(true);
    try {
      if (editingId) {
        await onUpdateReminder(editingId, payload);
      } else {
        await onAddReminder(payload);
      }
      setShowForm(false);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleRenewCycle(item: HomeReminderRecord) {
    if (readOnly) return;
    const { id, ...rest } = item;
    await onUpdateReminder(id, {
      ...rest,
      startDate: todayIso,
      startKm: item.trackKm ? (carProfile.currentKm ?? item.startKm) : item.startKm,
      completed: false,
      completedDate: undefined,
      lastNotifiedDate: undefined,
      renewalCount: (item.renewalCount || 0) + 1,
    });
    setNotice({
      tone: 'ok',
      text: `"${item.title}" rinnovato da oggi (${formatIsoToItDate(todayIso)}): nuovo ciclo avviato.`,
    });
  }

  async function handleToggleCompleted(item: HomeReminderRecord) {
    if (readOnly) return;
    const { id, ...rest } = item;
    const nextDone = !item.completed;
    await onUpdateReminder(id, {
      ...rest,
      completed: nextDone,
      completedDate: nextDone ? todayIso : undefined,
    });
    setNotice({
      tone: 'ok',
      text: nextDone
        ? `"${item.title}" segnato come completato: gli avvisi sono stati fermati.`
        : `"${item.title}" riaperto.`,
    });
  }

  async function confirmDelete() {
    if (!pendingDelete || readOnly) return;
    setDeleting(true);
    try {
      await onDeleteReminder(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveNotifyCfg(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSavingCfg(true);
    try {
      await onSaveNotifyConfig({
        ...notifyConfig,
        defaultEmail: cfgEmail.trim() || 'mauminieri@gmail.com',
        whatsappPhone: cfgPhone.trim(),
        callmebotApiKey: cfgCallmebotKey.trim() || undefined,
        autoEmailOnOpen: cfgAutoEmail,
      });
      setNotice({
        tone: 'ok',
        text: 'Preferenze notifiche Email / WhatsApp salvate.',
      });
      setShowNotifySettings(false);
    } finally {
      setSavingCfg(false);
    }
  }

  async function handleSendEmailNow() {
    const targets = dueTodayItems.length > 0 ? dueTodayItems : warningItems;
    if (targets.length === 0) return;
    setNotice(null);
    try {
      await onSendDailyDigestEmail(targets);
      setNotice({
        tone: 'ok',
        text: `Email promemoria inviata a ${notifyConfig.defaultEmail} per ${targets.length} ${
          targets.length === 1 ? 'scadenza' : 'scadenze'
        } e segnata per oggi.`,
      });
    } catch (err) {
      setNotice({
        tone: 'err',
        text: err instanceof Error ? err.message : 'Errore invio email tramite Gmail.',
      });
    }
  }

  async function handleSendCallMeBotWhatsapp() {
    const phoneDigits = notifyConfig.whatsappPhone.replace(/[^\d]/g, '');
    const apiKey = (notifyConfig.callmebotApiKey || '').trim();
    const targets = dueTodayItems.length > 0 ? dueTodayItems : warningItems;
    if (!phoneDigits || !apiKey || targets.length === 0) return;
    setSendingWhatsappBot(true);
    setNotice(null);
    try {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(
        phoneDigits
      )}&text=${encodeURIComponent(digestPayload.body.slice(0, 1400))}&apikey=${encodeURIComponent(
        apiKey
      )}`;
      await fetch(url, { mode: 'no-cors' });
      await onMarkNotifiedToday(targets.map((t) => t.reminder.id));
      setNotice({
        tone: 'ok',
        text: `Richiesta WhatsApp inviata al bot CallMeBot (+${phoneDigits}) e avvisi segnati per oggi.`,
      });
    } catch (err) {
      setNotice({
        tone: 'err',
        text: err instanceof Error ? err.message : 'Impossibile contattare CallMeBot WhatsApp.',
      });
    } finally {
      setSendingWhatsappBot(false);
    }
  }

  const appsScriptSnippet = useMemo(() => {
    const emailTarget = notifyConfig.defaultEmail || 'mauminieri@gmail.com';
    const waPhone = notifyConfig.whatsappPhone.replace(/[^\d]/g, '') || '393XXXXXXXXX';
    const waKey = (notifyConfig.callmebotApiKey || '').trim();
    const listSummary = reminders
      .filter((r) => r.notifyEnabled && !r.completed)
      .map((r) => {
        const lc = computeReminderLifecycle(r, todayIso, carProfile.currentKm);
        return `  { title: ${JSON.stringify(r.title)}, due: "${lc.dueDateIso}", leadDays: ${(r.leadMonths || 0) * 30 + (r.leadDays || 0)}, email: ${r.notifyEmail}, whatsapp: ${r.notifyWhatsapp} }`;
      })
      .join(',\n');

    return `/**
 * Trigger giornaliero 24/7 su Google Apps Script (es. ogni mattina alle 08:30).
 * Invia automaticamente una email (e opzionalmente WhatsApp via CallMeBot) finché non aggiorni la data nell'app.
 */
function checkMyHomeRemindersDaily() {
  var EMAIL_TO = ${JSON.stringify(emailTarget)};
  var WA_PHONE = ${JSON.stringify(waPhone)};
  var CALLMEBOT_KEY = ${JSON.stringify(waKey)}; // Opzionale: chiave gratuita da @CallMeBot_txt
  var reminders = [
${listSummary || '  // Aggiungi qui i tuoi promemoria o esportali dall’app My Home'}
  ];

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var alerts = [];

  reminders.forEach(function (r) {
    var parts = r.due.split('-');
    var dueDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var diffDays = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
    if (diffDays <= r.leadDays) {
      alerts.push('• ' + r.title + ' — Scadenza: ' + r.due + (diffDays < 0 ? ' (SCADUTO da ' + Math.abs(diffDays) + ' gg)' : ' (mancano ' + diffDays + ' gg)'));
    }
  });

  if (alerts.length === 0) return;

  var body = 'Promemoria giornalieri My Home:\\n\\n' + alerts.join('\\n') + '\\n\\nApri https://mauriziominieri.github.io/my-home/ per rinnovare o completare.';
  MailApp.sendEmail(EMAIL_TO, '[My Home] ' + alerts.length + ' scadenze in corso', body);

  if (CALLMEBOT_KEY) {
    UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(WA_PHONE) + '&text=' + encodeURIComponent(body) + '&apikey=' + encodeURIComponent(CALLMEBOT_KEY));
  }
}`;
  }, [reminders, notifyConfig, todayIso, carProfile.currentKm]);

  function handleCopyAppsScript() {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(appsScriptSnippet).then(() => {
        setCopiedScript(true);
        window.setTimeout(() => setCopiedScript(false), 2500);
      });
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <BellRing className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            Promemoria &amp; Barre di Vita
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Monitora scadenze auto (batteria, olio, assicurazione, bollo), resi (es. iPhone 2 anni) e piani a lungo termine (es. mutuo 30 anni senza notifiche) con avvisi quotidiani Email e WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAppsScriptModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-500/15 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 border border-emerald-200 dark:border-emerald-500/35 rounded-lg transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            Automazione 24/7
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => {
                  setCfgEmail(notifyConfig.defaultEmail);
                  setCfgPhone(notifyConfig.whatsappPhone);
                  setCfgCallmebotKey(notifyConfig.callmebotApiKey || '');
                  setCfgAutoEmail(notifyConfig.autoEmailOnOpen);
                  setShowNotifySettings((v) => !v);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                Canali Avviso
              </button>
              <button
                type="button"
                onClick={() => openNewForm()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-brand-600 hover:bg-brand-700 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nuovo promemoria
              </button>
            </>
          )}
        </div>
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Promemoria & Scadenze"
        unlockedFeatures={[
          'Crea promemoria personalizzati con barra della vita che avanza ogni giorno',
          'Invia riepiloghi giornalieri via Gmail o WhatsApp quando sei nella finestra di avviso',
          'Segna come rinnovato o completato per far ripartire subito il nuovo ciclo',
        ]}
      />

      {notice && (
        <div
          role={notice.tone === 'err' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
            notice.tone === 'err'
              ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200'
              : notice.tone === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-800 dark:text-emerald-200'
                : 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30 text-sky-800 dark:text-sky-200'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="p-0.5 opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Daily Notifications Action Banner */}
      {warningItems.length > 0 && (
        <section
          className={`rounded-xl border p-4 space-y-3 ${
            dueTodayItems.length > 0
              ? 'bg-amber-50 dark:bg-amber-950/25 border-amber-300 dark:border-amber-500/40'
              : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-500/35'
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                <BellRing
                  className={`w-4 h-4 ${
                    dueTodayItems.length > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                />
                {dueTodayItems.length > 0
                  ? `${dueTodayItems.length} ${
                      dueTodayItems.length === 1 ? 'promemoria richiede' : 'promemoria richiedono'
                    } la notifica giornaliera di oggi (${formatIsoToItDate(todayIso)})`
                  : `Notifica di oggi già gestita per tutti i ${warningItems.length} promemoria in finestra di avviso`}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                {warningItems.map((w) => `${w.reminder.title} (${w.lifecycle.remainingHumanLabel})`).join(' · ')}
              </p>
            </div>

            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={sendingEmail}
                  onClick={() => void handleSendEmailNow()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {sendingEmail
                    ? 'Invio Gmail...'
                    : isGmailConnected
                      ? 'Invia Email oggi (Gmail)'
                      : 'Connetti Gmail e invia'}
                </button>

                <a
                  href={buildWhatsAppUrl(notifyConfig.whatsappPhone, digestPayload.body)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    if (dueTodayItems.length > 0) {
                      void onMarkNotifiedToday(dueTodayItems.map((d) => d.reminder.id));
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Invia WhatsApp
                </a>

                {notifyConfig.callmebotApiKey && notifyConfig.whatsappPhone && dueTodayItems.length > 0 && (
                  <button
                    type="button"
                    disabled={sendingWhatsappBot}
                    onClick={() => void handleSendCallMeBotWhatsapp()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-500/20 hover:bg-emerald-200 rounded-lg border border-emerald-300 dark:border-emerald-500/35"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingWhatsappBot ? 'Invio bot...' : 'Auto WhatsApp Bot'}
                  </button>
                )}

                {dueTodayItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void onMarkNotifiedToday(dueTodayItems.map((d) => d.reminder.id))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                  >
                    <Check className="w-3 h-3" />
                    Segna avvisati oggi
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Notification Channels Config Form */}
      {showNotifySettings && !readOnly && (
        <form
          onSubmit={handleSaveNotifyCfg}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 sm:p-5 space-y-3 text-xs shadow-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Impostazioni Notifiche Email &amp; WhatsApp
            </h2>
            <button
              type="button"
              onClick={() => setShowNotifySettings(false)}
              className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Email destinatario avvisi</span>
              <input
                type="email"
                required
                value={cfgEmail}
                onChange={(e) => setCfgEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Numero WhatsApp (con prefisso 39...)</span>
              <input
                type="text"
                placeholder="Es. 393401234567"
                value={cfgPhone}
                onChange={(e) => setCfgPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">CallMeBot API Key (opzionale, gratis)</span>
              <input
                type="text"
                placeholder="Per invio WhatsApp automatico"
                value={cfgCallmebotKey}
                onChange={(e) => setCfgCallmebotKey(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={cfgAutoEmail}
              onChange={(e) => setCfgAutoEmail(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 accent-brand-600"
            />
            <span className="text-slate-700 dark:text-slate-300">
              Invia automaticamente una volta al giorno il riepilogo via Gmail all&apos;apertura dell&apos;app (quando Gmail è già connesso)
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={savingCfg}
              className="px-4 py-2 font-semibold text-white dark:text-slate-950 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg"
            >
              {savingCfg ? 'Salvataggio...' : 'Salva preferenze'}
            </button>
          </div>
        </form>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Promemoria attivi</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
            {reminders.filter((r) => !r.completed).length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {reminders.filter((r) => !r.notifyEnabled && !r.completed).length} solo monitoraggio vita
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">In finestra avviso</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-300 mt-0.5">
            {warningItems.length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {dueTodayItems.length} da notificare oggi
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Odometro auto collegato</div>
          <div className="text-xl font-bold font-mono tabular-nums text-sky-700 dark:text-sky-300 mt-0.5">
            {(carProfile.currentKm || 150000).toLocaleString('it-IT')} km
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {carProfile.brand} {carProfile.plate} ({carProfile.fuelType || 'GPL'})
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Completati / Restituiti</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-0.5">
            {reminders.filter((r) => r.completed).length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Storico chiuso senza avvisi
          </div>
        </div>
      </div>

      {/* Modelli Rapidi (1-click presets) */}
      {!readOnly && (
        <section className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
              Modelli pronti (aggiungi in 1 click o personalizza)
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {REMINDER_PRESETS.map((preset) => (
              <div
                key={preset.key}
                className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => void handleQuickAddPreset(preset)}
                  title={preset.description}
                  className="px-2.5 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>{preset.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => openNewForm(preset)}
                  title="Personalizza date prima di salvare"
                  className="px-2 py-1.5 text-[11px] text-slate-500 hover:text-sky-600 dark:hover:text-sky-300 border-l border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Add / Edit Reminder Form */}
      {showForm && !readOnly && (
        <form
          onSubmit={handleSubmitForm}
          className="bg-white dark:bg-slate-900 border border-brand-300 dark:border-brand-500/40 rounded-xl p-4 sm:p-5 space-y-4 text-xs shadow-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {editingId ? 'Modifica promemoria' : 'Nuovo promemoria con barra di vita'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-slate-600 dark:text-slate-400">Titolo promemoria *</span>
              <input
                type="text"
                required
                maxLength={80}
                placeholder="Es. Batteria Auto / Restituzione iPhone / Mutuo Casa"
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Categoria</span>
              <select
                value={fCategory}
                onChange={(e) => setFCategory(e.target.value as ReminderCategory)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
              >
                {(Object.keys(REMINDER_CATEGORY_META) as ReminderCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {REMINDER_CATEGORY_META[cat].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Data inizio / ultimo cambio *</span>
              <input
                type="date"
                required
                value={normalizeReminderDateIso(fStartDate) || todayIso}
                onChange={(e) => setFStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Durata (Anni)</span>
              <input
                type="number"
                min="0"
                max="60"
                value={fDurationYears}
                onChange={(e) => setFDurationYears(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Durata (+ Mesi, es. 6 per 4,5 anni)</span>
              <input
                type="number"
                min="0"
                max="11"
                value={fDurationMonths}
                onChange={(e) => setFDurationMonths(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Durata (+ Giorni)</span>
              <input
                type="number"
                min="0"
                max="365"
                value={fDurationDays}
                onChange={(e) => setFDurationDays(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Oppure data scadenza fissa (opz.)</span>
              <input
                type="date"
                value={normalizeReminderDateIso(fCustomEndDate)}
                onChange={(e) => setFCustomEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
              />
            </label>
          </div>

          {/* Km tracking & Notification window */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="space-y-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
              <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fNotifyEnabled}
                  onChange={(e) => setFNotifyEnabled(e.target.checked)}
                  className="rounded accent-brand-600"
                />
                <span>Attiva notifiche prima della scadenza (disattiva per Mutuo / solo barra vita)</span>
              </label>

              {fNotifyEnabled && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <label className="space-y-1">
                    <span className="text-slate-600 dark:text-slate-400">Avvisa quanti mesi prima</span>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      value={fLeadMonths}
                      onChange={(e) => setFLeadMonths(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600 dark:text-slate-400">+ Giorni prima</span>
                    <input
                      type="number"
                      min="0"
                      max="90"
                      value={fLeadDays}
                      onChange={(e) => setFLeadDays(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fNotifyEmail}
                      onChange={(e) => setFNotifyEmail(e.target.checked)}
                      className="rounded accent-sky-600"
                    />
                    <span className="text-slate-700 dark:text-slate-300">Avviso quotidiano Email</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fNotifyWhatsapp}
                      onChange={(e) => setFNotifyWhatsapp(e.target.checked)}
                      className="rounded accent-emerald-600"
                    />
                    <span className="text-slate-700 dark:text-slate-300">Avviso WhatsApp</span>
                  </label>
                </div>
              )}
            </div>

            <div className="space-y-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fRenewable}
                    onChange={(e) => setFRenewable(e.target.checked)}
                    className="rounded accent-emerald-600"
                  />
                  <span>Ciclo rinnovabile (es. batteria/olio riparte da zero al cambio)</span>
                </label>
                <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fTrackKm}
                    onChange={(e) => setFTrackKm(e.target.checked)}
                    className="rounded accent-sky-600"
                  />
                  <span>Controlla anche i chilometri auto (es. cambio olio)</span>
                </label>
              </div>

              {fTrackKm && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <label className="space-y-1">
                    <span className="text-slate-600 dark:text-slate-400">Km all&apos;ultimo intervento</span>
                    <input
                      type="number"
                      value={fStartKm}
                      onChange={(e) => setFStartKm(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600 dark:text-slate-400">Ogni quanti km avvisare</span>
                    <input
                      type="number"
                      value={fIntervalKm}
                      onChange={(e) => setFIntervalKm(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-slate-900 dark:text-slate-100"
                    />
                  </label>
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-400">Note (opz.)</span>
                <input
                  type="text"
                  maxLength={240}
                  placeholder="Dettagli, modello ricambio, importo rata, condizioni..."
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3.5 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-semibold text-white dark:text-slate-950 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg"
            >
              {saving ? 'Salvataggio...' : editingId ? 'Salva modifiche' : 'Crea promemoria'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-fit">
        {[
          { id: 'all', label: `Tutti (${reminders.length})` },
          { id: 'in_scadenza', label: `In scadenza (${warningItems.length})` },
          { id: 'auto_manutenzione', label: 'Manutenzione Auto' },
          { id: 'auto_pagamento', label: 'Pagamenti Auto' },
          { id: 'reso_garanzia', label: 'Resi / Garanzie' },
          { id: 'casa_mutuo', label: 'Mutuo & Casa' },
          { id: 'completati', label: `Completati (${reminders.filter((r) => r.completed).length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterCategory(tab.id as typeof filterCategory)}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              filterCategory === tab.id
                ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Reminder Cards Grid */}
      {filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-2">
          <Bell className="w-7 h-7 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Nessun promemoria in questa vista.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Usa i <strong className="text-slate-700 dark:text-slate-200">Modelli pronti</strong> qui sopra (es. Batteria Auto 26/11/2026, iPhone 2 anni, Mutuo 30 anni, Cambio Olio) oppure clicca <strong className="text-slate-700 dark:text-slate-200">Nuovo promemoria</strong>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredItems.map(({ reminder, lifecycle }) => {
            const catMeta = REMINDER_CATEGORY_META[reminder.category] || REMINDER_CATEGORY_META.altro;
            const pctRounded = Math.round(lifecycle.effectiveProgressPct * 10) / 10;

            const barColor = reminder.completed
              ? 'bg-emerald-500'
              : !reminder.notifyEnabled
                ? 'bg-indigo-500'
                : lifecycle.isOverdue
                  ? 'bg-rose-500'
                  : lifecycle.isInWarningWindow
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';

            const cardBorder = reminder.completed
              ? 'border-slate-200 dark:border-slate-800 opacity-80'
              : lifecycle.isOverdue
                ? 'border-rose-300 dark:border-rose-500/45'
                : lifecycle.isInWarningWindow
                  ? 'border-amber-300 dark:border-amber-500/45'
                  : 'border-slate-200 dark:border-slate-800';

            return (
              <article
                key={reminder.id}
                className={`bg-white dark:bg-slate-900/80 border ${cardBorder} rounded-xl p-4 space-y-3 shadow-xs`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded-md ${catMeta.badgeClass}`}
                      >
                        {catMeta.shortLabel}
                      </span>
                      {reminder.notifyEnabled ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300">
                          <Bell className="w-3 h-3" />
                          Avviso {reminder.leadMonths > 0 ? `${reminder.leadMonths} mesi` : ''}{' '}
                          {reminder.leadDays > 0 ? `${reminder.leadDays} gg` : ''} prima
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                          <BellOff className="w-3 h-3" />
                          Solo barra vita (no notifiche)
                        </span>
                      )}
                      {(reminder.renewalCount || 0) > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          Rinnovato {reminder.renewalCount}x
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                      {reminder.title}
                    </h3>
                  </div>

                  {!readOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditForm(reminder)}
                        className="p-1.5 text-slate-500 hover:text-sky-600 dark:hover:text-sky-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                        aria-label="Modifica promemoria"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(reminder)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                        aria-label="Elimina promemoria"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Visual Life Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Vita trascorsa: <strong className="font-mono">{pctRounded.toFixed(1).replace('.', ',')}%</strong>
                    </span>
                    <span
                      className={`font-semibold ${
                        reminder.completed
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : lifecycle.isOverdue
                            ? 'text-rose-600 dark:text-rose-300'
                            : lifecycle.isInWarningWindow
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {lifecycle.remainingHumanLabel}
                    </span>
                  </div>

                  <div className="h-3 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${barColor}`}
                      style={{ width: `${Math.max(pctRounded > 0 ? 2 : 0, Math.min(100, pctRounded))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <span>Inizio: {formatIsoToItDate(lifecycle.startDateIso)}</span>
                    <span>Durata: {lifecycle.durationLabel}</span>
                    <span>Scadenza: {formatIsoToItDate(lifecycle.dueDateIso)}</span>
                  </div>
                </div>

                {/* Optional KM Progress Bar */}
                {lifecycle.kmProgressPct !== undefined && reminder.intervalKm && (
                  <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-[11px] tabular-nums">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                        <Gauge className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        Percorrenza olio/intervento:
                      </span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">
                        {lifecycle.kmElapsed?.toLocaleString('it-IT')} / {reminder.intervalKm.toLocaleString('it-IT')} km
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${lifecycle.kmProgressPct >= 90 ? 'bg-rose-500' : 'bg-sky-500'}`}
                        style={{ width: `${Math.min(100, lifecycle.kmProgressPct)}%` }}
                      />
                    </div>
                  </div>
                )}

                {reminder.notes && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {reminder.notes}
                  </p>
                )}

                {/* Card Footer Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px]">
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                    {reminder.notifyEnabled && (
                      <>
                        {reminder.notifyEmail && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                            Email
                          </span>
                        )}
                        {reminder.notifyWhatsapp && (
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            WhatsApp
                          </span>
                        )}
                        {reminder.lastNotifiedDate && (
                          <span className="font-mono">
                            · Ultimo avviso: {formatIsoToItDate(reminder.lastNotifiedDate)}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {!readOnly && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {reminder.renewable && (
                        <button
                          type="button"
                          onClick={() => void handleRenewCycle(reminder)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-white dark:text-slate-950 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Effettuato oggi (nuovo ciclo)
                        </button>
                      )}
                      {(!reminder.renewable || reminder.completed) && (
                        <button
                          type="button"
                          onClick={() => void handleToggleCompleted(reminder)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold rounded-lg transition-colors ${
                            reminder.completed
                              ? 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200'
                              : 'text-white dark:text-slate-950 bg-sky-600 hover:bg-sky-700 dark:bg-sky-400 dark:hover:bg-sky-300'
                          }`}
                        >
                          {reminder.completed ? (
                            <>
                              <RotateCcw className="w-3 h-3" />
                              Riapri
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Segna completato
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Modal Automazione 24/7 Google Apps Script */}
      {showAppsScriptModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          onClick={() => setShowAppsScriptModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Notifiche Automatiche 24/7 a Browser Chiuso (Google Apps Script)
              </h3>
              <button
                type="button"
                onClick={() => setShowAppsScriptModal(false)}
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <p className="leading-relaxed">
                Poiché il sito su GitHub Pages gira solo quando apri il browser, per ricevere email/WhatsApp ogni mattina anche a telefono e PC spenti puoi incollare questo script gratuito nel tuo progetto{' '}
                <a
                  href={APPS_SCRIPT_PROJECT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-600 dark:text-sky-400 underline font-semibold"
                >
                  Google Apps Script
                </a>{' '}
                e impostare un attivatore giornaliero (es. 08:00–09:00).
              </p>
              <div className="relative">
                <pre className="p-3 rounded-xl bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-72 overflow-y-auto border border-slate-800">
                  {appsScriptSnippet}
                </pre>
                <button
                  type="button"
                  onClick={handleCopyAppsScript}
                  className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-md border border-slate-700"
                >
                  {copiedScript ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedScript ? 'Copiato!' : 'Copia codice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Elimina Promemoria */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Eliminare &quot;{pendingDelete.title}&quot;?
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Il promemoria e la relativa barra di vita verranno rimossi dall&apos;archivio.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg"
              >
                {deleting ? 'Eliminazione...' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
