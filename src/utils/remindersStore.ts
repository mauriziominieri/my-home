import {
  CarProfile,
  HomeArticleRecord,
  HomeReminderRecord,
  ReminderCategory,
  ReminderNotificationConfig,
} from '../types/home';

export const SYSTEM_ROOM_REMINDERS = '__promemoria__';
export const REMINDERS_CONFIG_DOC_ID = 'rem_notify_config';

export const REMINDER_CATEGORY_META: Record<
  ReminderCategory,
  { label: string; shortLabel: string; badgeClass: string }
> = {
  auto_manutenzione: {
    label: 'Manutenzione Auto',
    shortLabel: 'Manutenzione',
    badgeClass:
      'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
  },
  auto_pagamento: {
    label: 'Pagamenti & Scadenze Auto',
    shortLabel: 'Pagamenti Auto',
    badgeClass:
      'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  },
  reso_garanzia: {
    label: 'Resi, Trade-in & Garanzie',
    shortLabel: 'Resi / Garanzie',
    badgeClass:
      'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30',
  },
  casa_mutuo: {
    label: 'Casa, Mutuo & Contratti',
    shortLabel: 'Casa / Mutuo',
    badgeClass:
      'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30',
  },
  altro: {
    label: 'Altro Promemoria',
    shortLabel: 'Altro',
    badgeClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700',
  },
};

export const DEFAULT_REMINDER_NOTIFY_CONFIG: ReminderNotificationConfig = {
  defaultEmail: 'mauminieri@gmail.com',
  whatsappPhone: '',
  callmebotApiKey: '',
  autoEmailOnOpen: false,
};

export function normalizeReminderDateIso(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const itMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (itMatch) {
    return `${itMatch[3]}-${itMatch[2].padStart(2, '0')}-${itMatch[1].padStart(2, '0')}`;
  }
  return '';
}

export function formatIsoToItDate(iso?: string): string {
  const norm = normalizeReminderDateIso(iso);
  if (!norm) return '—';
  const [y, m, d] = norm.split('-');
  return `${d}/${m}/${y}`;
}

function parseIsoLocalDate(iso: string): Date | null {
  const norm = normalizeReminderDateIso(iso);
  if (!norm) return null;
  const [y, m, d] = norm.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toIsoLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDurationToDate(
  startDt: Date,
  years = 0,
  months = 0,
  days = 0
): Date {
  const totalMonths = Math.round(years * 12 + months);
  const target = new Date(startDt.getTime());
  if (totalMonths !== 0) {
    const origDay = target.getDate();
    target.setDate(1);
    target.setMonth(target.getMonth() + totalMonths);
    const maxDaysInMonth = new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0
    ).getDate();
    target.setDate(Math.min(origDay, maxDaysInMonth));
  }
  if (days !== 0) {
    target.setDate(target.getDate() + Math.round(days));
  }
  return target;
}

function diffDays(fromDt: Date, toDt: Date): number {
  const utcFrom = Date.UTC(fromDt.getFullYear(), fromDt.getMonth(), fromDt.getDate());
  const utcTo = Date.UTC(toDt.getFullYear(), toDt.getMonth(), toDt.getDate());
  return Math.round((utcTo - utcFrom) / 86_400_000);
}

export interface ReminderLifecycleInfo {
  startDateIso: string;
  dueDateIso: string;
  warningStartIso: string;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  timeProgressPct: number;
  kmElapsed?: number;
  kmRemaining?: number;
  kmProgressPct?: number;
  effectiveProgressPct: number;
  isInWarningWindow: boolean;
  isOverdue: boolean;
  needsNotificationToday: boolean;
  durationLabel: string;
  remainingHumanLabel: string;
}

export function formatDurationLabel(r: Pick<HomeReminderRecord, 'durationYears' | 'durationMonths' | 'durationDays' | 'customEndDate'>): string {
  if (r.customEndDate) return `Scadenza fissa ${formatIsoToItDate(r.customEndDate)}`;
  const y = r.durationYears || 0;
  const m = r.durationMonths || 0;
  const d = r.durationDays || 0;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} ${y === 1 ? 'anno' : 'anni'}`);
  if (m > 0) parts.push(`${m} ${m === 1 ? 'mese' : 'mesi'}`);
  if (d > 0) parts.push(`${d} ${d === 1 ? 'giorno' : 'giorni'}`);
  return parts.length > 0 ? parts.join(' e ') : '1 anno';
}

export function formatRemainingDaysHuman(days: number): string {
  if (days === 0) return 'Scade oggi';
  const abs = Math.abs(days);
  const years = Math.floor(abs / 365);
  const months = Math.floor((abs % 365) / 30);
  const remDays = abs % 30;
  const chunks: string[] = [];
  if (years > 0) chunks.push(`${years} ${years === 1 ? 'anno' : 'anni'}`);
  if (months > 0) chunks.push(`${months} ${months === 1 ? 'mese' : 'mesi'}`);
  if (years === 0 && (months === 0 || remDays > 0)) {
    chunks.push(`${remDays || abs} ${remDays === 1 ? 'giorno' : 'giorni'}`);
  }
  const text = chunks.slice(0, 2).join(' e ');
  return days < 0 ? `Scaduto da ${text} (${abs} gg)` : `Mancano ${text} (${days} gg)`;
}

export function computeReminderLifecycle(
  reminder: HomeReminderRecord,
  todayIso: string,
  carCurrentKm?: number
): ReminderLifecycleInfo {
  const startDt = parseIsoLocalDate(reminder.startDate) || parseIsoLocalDate(todayIso) || new Date();
  const todayDt = parseIsoLocalDate(todayIso) || new Date();
  const explicitEnd = reminder.customEndDate ? parseIsoLocalDate(reminder.customEndDate) : null;
  const dueDt =
    explicitEnd ||
    addDurationToDate(
      startDt,
      reminder.durationYears || 0,
      reminder.durationMonths || 0,
      reminder.durationDays || 0
    );

  const totalDays = Math.max(1, diffDays(startDt, dueDt));
  const elapsedDays = Math.max(0, diffDays(startDt, todayDt));
  const remainingDays = diffDays(todayDt, dueDt);
  const timeProgressPct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));

  const warningStartDt = addDurationToDate(
    dueDt,
    0,
    -(reminder.leadMonths || 0),
    -(reminder.leadDays || 0)
  );
  const warningStartIso = toIsoLocal(warningStartDt);

  let kmElapsed: number | undefined;
  let kmRemaining: number | undefined;
  let kmProgressPct: number | undefined;
  if (
    reminder.trackKm &&
    typeof reminder.intervalKm === 'number' &&
    reminder.intervalKm > 0 &&
    typeof carCurrentKm === 'number'
  ) {
    const baseKm = typeof reminder.startKm === 'number' ? reminder.startKm : carCurrentKm;
    kmElapsed = Math.max(0, Math.round(carCurrentKm - baseKm));
    kmRemaining = Math.round(reminder.intervalKm - kmElapsed);
    kmProgressPct = Math.min(100, Math.max(0, (kmElapsed / reminder.intervalKm) * 100));
  }

  const effectiveProgressPct =
    kmProgressPct !== undefined
      ? Math.max(timeProgressPct, kmProgressPct)
      : timeProgressPct;

  const isKmWarning =
    kmProgressPct !== undefined && reminder.intervalKm
      ? kmProgressPct >= 85 || (kmRemaining !== undefined && kmRemaining <= 1500)
      : false;
  const isKmOverdue = kmRemaining !== undefined && kmRemaining <= 0;

  const isOverdue = !reminder.completed && (remainingDays < 0 || isKmOverdue);
  const isInWarningWindow =
    !reminder.completed &&
    reminder.notifyEnabled &&
    (diffDays(warningStartDt, todayDt) >= 0 || isKmWarning || isOverdue);

  const needsNotificationToday =
    isInWarningWindow &&
    (reminder.notifyEmail || reminder.notifyWhatsapp) &&
    reminder.lastNotifiedDate !== todayIso;

  return {
    startDateIso: toIsoLocal(startDt),
    dueDateIso: toIsoLocal(dueDt),
    warningStartIso,
    totalDays,
    elapsedDays,
    remainingDays,
    timeProgressPct,
    kmElapsed,
    kmRemaining,
    kmProgressPct,
    effectiveProgressPct,
    isInWarningWindow,
    isOverdue,
    needsNotificationToday,
    durationLabel: formatDurationLabel(reminder),
    remainingHumanLabel: reminder.completed
      ? `Completato il ${formatIsoToItDate(reminder.completedDate || todayIso)}`
      : formatRemainingDaysHuman(remainingDays),
  };
}

export function articleToReminderConfig(
  article?: HomeArticleRecord,
  fallbackEmail?: string | null
): ReminderNotificationConfig {
  const base: ReminderNotificationConfig = {
    ...DEFAULT_REMINDER_NOTIFY_CONFIG,
    defaultEmail: fallbackEmail?.trim() || DEFAULT_REMINDER_NOTIFY_CONFIG.defaultEmail,
  };
  if (!article?.manualExtractText) return base;
  try {
    const parsed = JSON.parse(article.manualExtractText) as Partial<ReminderNotificationConfig>;
    return {
      defaultEmail: parsed.defaultEmail?.trim() || base.defaultEmail,
      whatsappPhone: (parsed.whatsappPhone || '').trim(),
      callmebotApiKey: (parsed.callmebotApiKey || '').trim(),
      autoEmailOnOpen: Boolean(parsed.autoEmailOnOpen),
      lastAutoDigestDate: parsed.lastAutoDigestDate || undefined,
    };
  } catch {
    return base;
  }
}

export function reminderConfigToArticlePayload(
  cfg: ReminderNotificationConfig
): Omit<HomeArticleRecord, 'id'> {
  return {
    name: 'Configurazione Notifiche Promemoria',
    brand: 'Sistema',
    model: 'Notifiche',
    category: 'altro',
    room: SYSTEM_ROOM_REMINDERS,
    familyWarranty: Boolean(cfg.autoEmailOnOpen),
    specs: `MAIL:${(cfg.defaultEmail || '').slice(0, 80)}|WA:${(cfg.whatsappPhone || '').slice(0, 24)}`.slice(
      0,
      240
    ),
    manualExtractText: JSON.stringify(cfg).slice(0, 12_000),
  };
}

export function articleToReminder(article: HomeArticleRecord): HomeReminderRecord | null {
  if (article.id === REMINDERS_CONFIG_DOC_ID) return null;
  if (article.manualExtractText) {
    try {
      const parsed = JSON.parse(article.manualExtractText) as Partial<HomeReminderRecord>;
      return {
        id: article.id,
        title: parsed.title || article.name,
        category: (parsed.category as ReminderCategory) || 'altro',
        startDate:
          normalizeReminderDateIso(parsed.startDate) ||
          normalizeReminderDateIso(article.purchaseDate) ||
          toIsoLocal(new Date()),
        durationYears: typeof parsed.durationYears === 'number' ? parsed.durationYears : 1,
        durationMonths: typeof parsed.durationMonths === 'number' ? parsed.durationMonths : 0,
        durationDays: typeof parsed.durationDays === 'number' ? parsed.durationDays : 0,
        customEndDate: normalizeReminderDateIso(parsed.customEndDate) || undefined,
        trackKm: Boolean(parsed.trackKm),
        startKm: typeof parsed.startKm === 'number' ? parsed.startKm : undefined,
        intervalKm: typeof parsed.intervalKm === 'number' ? parsed.intervalKm : undefined,
        notifyEnabled:
          typeof parsed.notifyEnabled === 'boolean'
            ? parsed.notifyEnabled
            : Boolean(article.familyWarranty),
        leadMonths: typeof parsed.leadMonths === 'number' ? parsed.leadMonths : 1,
        leadDays: typeof parsed.leadDays === 'number' ? parsed.leadDays : 0,
        notifyEmail: parsed.notifyEmail !== false,
        notifyWhatsapp: Boolean(parsed.notifyWhatsapp),
        customEmail: parsed.customEmail || undefined,
        customWhatsappPhone: parsed.customWhatsappPhone || undefined,
        renewable: parsed.renewable !== false,
        completed: Boolean(parsed.completed),
        completedDate: parsed.completedDate || undefined,
        renewalCount: typeof parsed.renewalCount === 'number' ? parsed.renewalCount : 0,
        lastNotifiedDate: parsed.lastNotifiedDate || undefined,
        notes: parsed.notes || article.notes || undefined,
      };
    } catch {
      // fall through
    }
  }
  return {
    id: article.id,
    title: article.name,
    category: 'altro',
    startDate: normalizeReminderDateIso(article.purchaseDate) || toIsoLocal(new Date()),
    durationYears: 1,
    durationMonths: 0,
    durationDays: 0,
    notifyEnabled: Boolean(article.familyWarranty),
    leadMonths: 1,
    leadDays: 0,
    notifyEmail: true,
    notifyWhatsapp: false,
    renewable: true,
    completed: false,
    notes: article.notes || undefined,
  };
}

export function reminderToArticlePayload(
  reminder: Omit<HomeReminderRecord, 'id'>
): Omit<HomeArticleRecord, 'id'> {
  const startIso = normalizeReminderDateIso(reminder.startDate) || toIsoLocal(new Date());
  const dueIso = computeReminderLifecycle({ ...reminder, id: 'preview', startDate: startIso }, startIso).dueDateIso;
  const serialized = JSON.stringify({ ...reminder, startDate: startIso }).slice(0, 12_000);
  return {
    name: reminder.title.trim().slice(0, 80) || 'Promemoria',
    brand: reminder.category.slice(0, 60),
    model: formatDurationLabel(reminder).slice(0, 80),
    category: 'altro',
    room: SYSTEM_ROOM_REMINDERS,
    familyWarranty: Boolean(reminder.notifyEnabled),
    purchaseDate: formatIsoToItDate(startIso).slice(0, 20),
    warrantyEnd: formatIsoToItDate(dueIso).slice(0, 20),
    specs: `NOTIFY:${reminder.notifyEnabled ? 'ON' : 'OFF'}|LEAD:${reminder.leadMonths}M${reminder.leadDays}D|DONE:${reminder.completed ? 1 : 0}`.slice(
      0,
      240
    ),
    notes: reminder.notes ? reminder.notes.trim().slice(0, 240) : undefined,
    manualExtractText: serialized,
  };
}

export interface ReminderTemplatePreset {
  key: string;
  label: string;
  description: string;
  build: (todayIso: string, carProfile: CarProfile) => Omit<HomeReminderRecord, 'id'>;
}

export const REMINDER_PRESETS: ReminderTemplatePreset[] = [
  {
    key: 'car_battery',
    label: 'Batteria Auto (4,5 anni)',
    description: 'Cambiata il 26/11/2026 · durata 4 anni e 6 mesi · avviso 3 mesi prima',
    build: (_todayIso, carProfile) => ({
      title: `Batteria Auto (${carProfile.brand} ${carProfile.plate})`,
      category: 'auto_manutenzione',
      startDate: normalizeReminderDateIso(carProfile.batteryInstalledDate) || '2026-11-26',
      durationYears: 4,
      durationMonths: 6,
      durationDays: 0,
      notifyEnabled: true,
      leadMonths: 3,
      leadDays: 0,
      notifyEmail: true,
      notifyWhatsapp: true,
      renewable: true,
      completed: false,
      renewalCount: 0,
      notes: 'Durata media 4 anni e mezzo. Avviso quotidiano fino alla sostituzione.',
    }),
  },
  {
    key: 'iphone_return',
    label: 'Restituzione iPhone (2 anni)',
    description: 'Reso/riscatto dispositivo entro 2 anni · avviso 2 mesi prima',
    build: (todayIso) => ({
      title: 'Restituzione iPhone',
      category: 'reso_garanzia',
      startDate: todayIso,
      durationYears: 2,
      durationMonths: 0,
      durationDays: 0,
      notifyEnabled: true,
      leadMonths: 2,
      leadDays: 0,
      notifyEmail: true,
      notifyWhatsapp: true,
      renewable: false,
      completed: false,
      renewalCount: 0,
      notes: 'Controlla condizioni dispositivo e scadenza restituzione/permuta.',
    }),
  },
  {
    key: 'mortgage_30y',
    label: 'Mutuo Casa (30 anni · solo barra vita)',
    description: 'Avanzamento vita mutuo 30 anni senza notifiche',
    build: (todayIso) => ({
      title: 'Mutuo Casa (30 anni)',
      category: 'casa_mutuo',
      startDate: todayIso,
      durationYears: 30,
      durationMonths: 0,
      durationDays: 0,
      notifyEnabled: false,
      leadMonths: 0,
      leadDays: 0,
      notifyEmail: false,
      notifyWhatsapp: false,
      renewable: false,
      completed: false,
      renewalCount: 0,
      notes: 'Monitoraggio avanzamento piano di ammortamento trentennale (nessuna notifica).',
    }),
  },
  {
    key: 'car_oil',
    label: 'Cambio Olio Auto (12 mesi / 15.000 km)',
    description: 'Avviso per tempo trascorso o chilometri percorsi dall’ultimo cambio',
    build: (todayIso, carProfile) => ({
      title: `Cambio Olio Motore (${carProfile.plate})`,
      category: 'auto_manutenzione',
      startDate: normalizeReminderDateIso(carProfile.lastOilChangeDate) || todayIso,
      durationYears: 1,
      durationMonths: 0,
      durationDays: 0,
      trackKm: true,
      startKm: carProfile.lastOilChangeKm ?? carProfile.currentKm ?? 150000,
      intervalKm: carProfile.oilIntervalKm || 15000,
      notifyEnabled: true,
      leadMonths: 1,
      leadDays: 0,
      notifyEmail: true,
      notifyWhatsapp: true,
      renewable: true,
      completed: false,
      renewalCount: 0,
      notes: carProfile.oilSpec
        ? `Olio ${carProfile.oilSpec} + filtro olio.`
        : 'Cambio olio motore e filtro olio (verifica specifica e km in auto).',
    }),
  },
  {
    key: 'car_insurance',
    label: 'Assicurazione Auto Annuale',
    description: 'Rinnovo annuale polizza con avviso 1 mese prima',
    build: (todayIso, carProfile) => {
      const endIso = normalizeReminderDateIso(carProfile.insuranceExpiry);
      const startIso = endIso
        ? toIsoLocal(addDurationToDate(parseIsoLocalDate(endIso)!, -1, 0, 0))
        : todayIso;
      return {
        title: `Assicurazione RCA (${carProfile.insuranceCompany || 'ConTe.it'})`,
        category: 'auto_pagamento',
        startDate: startIso,
        durationYears: 1,
        durationMonths: 0,
        durationDays: 0,
        notifyEnabled: true,
        leadMonths: 1,
        leadDays: 0,
        notifyEmail: true,
        notifyWhatsapp: true,
        renewable: true,
        completed: false,
        renewalCount: 0,
        notes: `Targa ${carProfile.plate} · Verifica preventivi prima della scadenza.`,
      };
    },
  },
  {
    key: 'car_bollo',
    label: 'Bollo Auto Annuale',
    description: 'Tassa automobilistica annuale con avviso 1 mese prima',
    build: (todayIso, carProfile) => ({
      title: `Pagamento Bollo Auto (${carProfile.plate})`,
      category: 'auto_pagamento',
      startDate: todayIso,
      durationYears: 1,
      durationMonths: 0,
      durationDays: 0,
      customEndDate: normalizeReminderDateIso(carProfile.bolloExpiry) || undefined,
      notifyEnabled: true,
      leadMonths: 1,
      leadDays: 0,
      notifyEmail: true,
      notifyWhatsapp: false,
      renewable: true,
      completed: false,
      renewalCount: 0,
      notes: 'Verifica eventuali riduzioni regionali per impianto GPL.',
    }),
  },
];

export function buildDailyReminderDigestText(
  items: { reminder: HomeReminderRecord; lifecycle: ReminderLifecycleInfo }[],
  carProfile: CarProfile
): { subject: string; body: string } {
  const todayLabel = new Date().toLocaleDateString('it-IT');
  const subject = `[My Home] ${items.length} ${
    items.length === 1 ? 'promemoria in scadenza' : 'promemoria in scadenza'
  } (${todayLabel})`;

  const lines: string[] = [
    `Promemoria giornalieri My Home — ${todayLabel}`,
    `Auto attuale: ${carProfile.brand} ${carProfile.model} (${carProfile.plate}) · ${
      carProfile.currentKm ? `${carProfile.currentKm.toLocaleString('it-IT')} km` : 'km n/d'
    }`,
    '',
  ];

  items.forEach(({ reminder, lifecycle }, idx) => {
    const statusTag = lifecycle.isOverdue ? 'SCADUTO' : 'IN SCADENZA';
    const pct = Math.round(lifecycle.effectiveProgressPct);
    lines.push(
      `${idx + 1}. [${statusTag}] ${reminder.title}`,
      `   Scadenza: ${formatIsoToItDate(lifecycle.dueDateIso)} · ${lifecycle.remainingHumanLabel} · Avanzamento: ${pct}%`
    );
    if (lifecycle.kmProgressPct !== undefined && reminder.intervalKm) {
      lines.push(
        `   Km percorsi dal cambio: ${lifecycle.kmElapsed?.toLocaleString('it-IT')} / ${reminder.intervalKm.toLocaleString('it-IT')} km (restano ${lifecycle.kmRemaining?.toLocaleString('it-IT')} km)`
      );
    }
    if (reminder.notes) {
      lines.push(`   Note: ${reminder.notes}`);
    }
    lines.push('');
  });

  lines.push('Apri l’app My Home → Promemoria per segnare completato o rinnovare il ciclo.');
  return { subject, body: lines.join('\n') };
}
