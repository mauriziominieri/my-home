import { ClimateSession, HomeSystemConfig } from '../types/home';

export function isAllDaySession(startTime: string, endTime: string): boolean {
  const s = startTime.trim();
  const e = endTime.trim();
  return s === '00:00' && (e === '00:00' || e === '24:00');
}

export function getComboKey(log: ClimateSession): string {
  const sortedRooms = [...log.rooms].sort();
  const slotKey = isAllDaySession(log.startTime, log.endTime)
    ? 'ALL_DAY'
    : `${log.startTime}-${log.endTime}`;
  return `${log.mode}|${slotKey}|${log.targetTemp.toFixed(1)}|${sortedRooms.join(',')}`;
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

export function formatDurationCompact(hours: number | null): string {
  if (hours === null) return '';
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(1).replace('.', ',')}h`;
}

export function isVmcAnomalyDate(isoDate: string): boolean {
  const mmdd = isoDate.slice(5, 10);
  return mmdd >= '08-20' && mmdd <= '08-30';
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

export function computeLiveClimateStatus(
  climateLogs: ClimateSession[],
  homeConfig?: HomeSystemConfig,
  nowDate: Date = new Date()
): LiveClimateStatus {
  const { isoDate, hhmm } = getRomeDateAndTime(nowDate);
  const nowMin = toMinutes(hhmm);
  const todaySessions = climateLogs.filter((l) => l.date === isoDate);

  const activeSession =
    todaySessions.find((s) => {
      if (isAllDaySession(s.startTime, s.endTime)) return true;
      const startMin = toMinutes(s.startTime);
      const endMin = toMinutes(s.endTime);
      if (endMin >= startMin) {
        return nowMin >= startMin && nowMin < endMin;
      }
      // Overnight span
      return nowMin >= startMin || nowMin < endMin;
    }) ?? null;

  if (activeSession) {
    const modeLabel =
      activeSession.mode === 'riscaldamento' ? 'Riscaldamento ON' : 'Raffrescamento ON';
    const fascia = isAllDaySession(activeSession.startTime, activeSession.endTime)
      ? 'Tutto il giorno (24h)'
      : `${activeSession.startTime}–${activeSession.endTime}`;
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

  // Fallback check on config when there are today sessions outside current time or none
  if (todaySessions.length > 0) {
    const slots = todaySessions
      .map((s) =>
        isAllDaySession(s.startTime, s.endTime) ? '24h' : `${s.startTime}–${s.endTime}`
      )
      .join(', ');
    return {
      isOn: false,
      isoDate,
      hhmm,
      activeSession: null,
      todaySessions,
      modeLabel: 'Impianto Spento ORA',
      detailLabel: `Fuori fascia oraria alle ${hhmm} (oggi registrato: ${slots})`,
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
