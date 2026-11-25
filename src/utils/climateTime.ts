import { ClimateSession, ClimateTimeSlot, HomeSystemConfig } from '../types/home';

export function isAllDaySession(startTime: string, endTime: string): boolean {
  const s = startTime.trim();
  const e = endTime.trim();
  return s === '00:00' && (e === '00:00' || e === '24:00');
}

export function parseTimeSlotString(raw: string): ClimateTimeSlot | null {
  const match = raw.trim().match(/^(\d{2}:\d{2})\s*[-–→]\s*(\d{2}:\d{2})$/);
  if (!match) return null;
  return { startTime: match[1], endTime: match[2] };
}

export function formatTimeSlotString(slot: ClimateTimeSlot): string {
  return `${slot.startTime}-${slot.endTime}`;
}

export function normalizeTimeSlots(slots: ClimateTimeSlot[]): ClimateTimeSlot[] {
  const seen = new Set<string>();
  const cleaned: ClimateTimeSlot[] = [];
  for (const s of slots) {
    if (!/^\d{2}:\d{2}$/.test(s.startTime) || !/^\d{2}:\d{2}$/.test(s.endTime)) continue;
    const key = formatTimeSlotString(s);
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push({ startTime: s.startTime, endTime: s.endTime });
    }
  }
  return cleaned.slice(0, 6);
}

export function getSessionTimeSlots(log: {
  startTime: string;
  endTime: string;
  timeSlots?: string[];
}): ClimateTimeSlot[] {
  if (Array.isArray(log.timeSlots) && log.timeSlots.length > 0) {
    const parsed = log.timeSlots
      .map(parseTimeSlotString)
      .filter((s): s is ClimateTimeSlot => Boolean(s));
    if (parsed.length > 0) return parsed;
  }
  return [{ startTime: log.startTime || '09:00', endTime: log.endTime || '20:00' }];
}

export function isAllDaySlots(slots: ClimateTimeSlot[]): boolean {
  return slots.length === 1 && isAllDaySession(slots[0].startTime, slots[0].endTime);
}

export function getDayEffectiveSlots(logs: ClimateSession[]): ClimateTimeSlot[] {
  if (logs.length === 0) return [];
  const all = logs.flatMap((l) => getSessionTimeSlots(l));
  const normalized = normalizeTimeSlots(all);
  if (normalized.some((s) => isAllDaySession(s.startTime, s.endTime))) {
    return [{ startTime: '00:00', endTime: '24:00' }];
  }
  return normalized.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function getSessionDurationHours(startTime: string, endTime: string): number | null {
  if (isAllDaySession(startTime, endTime)) return 24;
  const startMin = toMinutes(startTime);
  const endMin = toMinutes(endTime);
  const diff = endMin >= startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
  return diff > 0 ? Math.round((diff / 60) * 10) / 10 : null;
}

export function getTotalSlotsDurationHours(slots: ClimateTimeSlot[]): number | null {
  if (slots.length === 0) return null;
  if (isAllDaySlots(slots)) return 24;
  let total = 0;
  for (const s of slots) {
    const h = getSessionDurationHours(s.startTime, s.endTime);
    if (h !== null) total += h;
  }
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

export function formatDurationCompact(hours: number | null): string {
  if (hours === null) return '';
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(1).replace('.', ',')}h`;
}

export function formatSlotsSummary(slots: ClimateTimeSlot[]): string {
  if (slots.length === 0) return '';
  if (isAllDaySlots(slots)) return 'Tutto il giorno · 24h';
  return slots.map((s) => `${s.startTime} → ${s.endTime}`).join(' + ');
}

export function formatSlotsCompact(slots: ClimateTimeSlot[]): string {
  if (slots.length === 0) return '';
  if (isAllDaySlots(slots)) return '24h';
  return slots.map((s) => `${s.startTime}–${s.endTime}`).join(', ');
}

export function getComboKey(log: ClimateSession): string {
  const sortedRooms = [...log.rooms].sort();
  const slots = getSessionTimeSlots(log);
  const slotKey = isAllDaySlots(slots)
    ? 'ALL_DAY'
    : slots.map((s) => `${s.startTime}-${s.endTime}`).join('+');
  return `${log.mode}|${slotKey}|${log.targetTemp.toFixed(1)}|${sortedRooms.join(',')}`;
}

export function getDayComboKey(logs: ClimateSession[]): string {
  if (logs.length === 0) return '__OFF__';
  if (logs.length === 1) return getComboKey(logs[0]);
  const primary = logs[0];
  const sortedRooms = Array.from(new Set(logs.flatMap((l) => l.rooms))).sort();
  const slots = getDayEffectiveSlots(logs);
  const slotKey = isAllDaySlots(slots)
    ? 'ALL_DAY'
    : slots.map((s) => `${s.startTime}-${s.endTime}`).join('+');
  return `${primary.mode}|${slotKey}|${primary.targetTemp.toFixed(1)}|${sortedRooms.join(',')}`;
}

export function isVmcAnomalyDate(isoDate: string): boolean {
  const mmdd = isoDate.slice(5, 10);
  return mmdd >= '08-20' && mmdd <= '08-30';
}

export function isVmcMaxForDate(
  isoDate: string,
  vmcDaysMap?: Map<string, boolean>,
  dayLogs?: ClimateSession[]
): boolean {
  if (vmcDaysMap && vmcDaysMap.has(isoDate)) {
    return Boolean(vmcDaysMap.get(isoDate));
  }
  if (dayLogs && dayLogs.some((l) => Boolean(l.vmcMax))) {
    return true;
  }
  return isVmcAnomalyDate(isoDate);
}

export function getRomeDateAndTime(date: Date = new Date()): {
  isoDate: string;
  hhmm: string;
} {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return {
    isoDate: dateFmt.format(date),
    hhmm: timeFmt.format(date),
  };
}

export interface LiveClimateStatus {
  isOn: boolean;
  isoDate: string;
  hhmm: string;
  activeSession: ClimateSession | null;
  todaySessions: ClimateSession[];
  modeLabel: string;
  detailLabel: string;
}

function isTimeInSlot(nowMin: number, slot: ClimateTimeSlot): boolean {
  if (isAllDaySession(slot.startTime, slot.endTime)) return true;
  const startMin = toMinutes(slot.startTime);
  const endMin = toMinutes(slot.endTime);
  if (endMin >= startMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}

export function computeLiveClimateStatus(
  climateLogs: ClimateSession[],
  homeConfig?: HomeSystemConfig,
  nowDate: Date = new Date()
): LiveClimateStatus {
  const { isoDate, hhmm } = getRomeDateAndTime(nowDate);
  const nowMin = toMinutes(hhmm);
  const todaySessions = climateLogs.filter((l) => l.date === isoDate);

  const activeSession =
    todaySessions.find((s) =>
      getSessionTimeSlots(s).some((slot) => isTimeInSlot(nowMin, slot))
    ) ?? null;

  if (activeSession) {
    const modeLabel =
      activeSession.mode === 'riscaldamento' ? 'Riscaldamento ON' : 'Raffrescamento ON';
    const slots = getDayEffectiveSlots(todaySessions);
    const fascia = formatSlotsCompact(slots);
    const temp =
      activeSession.targetTemp > 0 ? `${activeSession.targetTemp.toFixed(1)} °C` : '? °C';
    return {
      isOn: true,
      isoDate,
      hhmm,
      activeSession,
      todaySessions,
      modeLabel,
      detailLabel: `Attivo oggi (${fascia} · ${temp})`,
    };
  }

  if (todaySessions.length > 0) {
    const slots = getDayEffectiveSlots(todaySessions);
    const fascia = formatSlotsCompact(slots);
    return {
      isOn: false,
      isoDate,
      hhmm,
      activeSession: null,
      todaySessions,
      modeLabel: 'Impianto Spento ORA',
      detailLabel: `Fuori fascia oraria alle ${hhmm} (oggi registrato: ${fascia})`,
    };
  }

  if (homeConfig && (homeConfig.aristonMode === 'riscaldamento' || homeConfig.aristonMode === 'raffrescamento')) {
    return {
      isOn: false,
      isoDate,
      hhmm,
      activeSession: null,
      todaySessions,
      modeLabel: 'Nessuna accensione registrata oggi',
      detailLabel: `Nessuna sessione NeaSmart per oggi (profilo Ariston salvato: ${homeConfig.aristonMode})`,
    };
  }

  return {
    isOn: false,
    isoDate,
    hhmm,
    activeSession: null,
    todaySessions,
    modeLabel: 'Impianto Spento ORA',
    detailLabel: `Clima fermo alle ${hhmm} · ${homeConfig?.aristonMode === 'acs_solo' ? 'Ariston Solo ACS' : 'Standby / Solo ACS'}`,
  };
}
