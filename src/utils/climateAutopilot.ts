import {
  ClimateAutopilotConfig,
  ClimateMode,
  ClimateSession,
  ClimateTimeSlot,
  HOME_ROOMS,
  HomeArticleRecord,
  RoomId,
} from '../types/home';
import {
  formatDurationCompact,
  formatSlotsCompact,
  formatSlotsSummary,
  formatTimeSlotString,
  getTotalSlotsDurationHours,
  isAllDaySlots,
  normalizeTimeSlots,
  parseTimeSlotString,
} from './climateTime';

export const SYSTEM_ROOM_CLIMATE_AUTO = '__clima_auto__';
export const CLIMATE_AUTOPILOT_DOC_ID = 'climate_autopilot_state';

const VALID_ROOM_IDS = new Set<RoomId>(HOME_ROOMS.map((r) => r.id));

export function getLocalTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Returns every YYYY-MM-DD from startIso through endIso inclusive (max 366 days safeguard).
 */
export function enumerateIsoDatesInclusive(
  startIso: string,
  endIso: string,
  maxDays = 366
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) {
    return [];
  }
  if (startIso > endIso) return [];
  const out: string[] = [];
  let cursor = startIso;
  while (cursor <= endIso && out.length < maxDays) {
    out.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return out;
}

export function getAutoClimateDocId(dateIso: string): string {
  return `auto_${dateIso.replace(/[^0-9]/g, '')}`;
}

export function getAutopilotSlots(cfg: {
  startTime: string;
  endTime: string;
  timeSlots?: ClimateTimeSlot[];
}): ClimateTimeSlot[] {
  if (Array.isArray(cfg.timeSlots) && cfg.timeSlots.length > 0) {
    const clean = normalizeTimeSlots(cfg.timeSlots);
    if (clean.length > 0) return clean;
  }
  return [{ startTime: cfg.startTime || '09:00', endTime: cfg.endTime || '20:00' }];
}

export function articleToClimateAutopilot(
  article?: HomeArticleRecord
): ClimateAutopilotConfig | null {
  if (!article) return null;
  const mode: ClimateMode =
    article.brand === 'raffrescamento' ? 'raffrescamento' : 'riscaldamento';

  const parts = (article.model || '09:00|20:00|21').split('|');
  let slots: ClimateTimeSlot[] = [];
  let rawTemp = '21';
  let vmcMax = false;

  // Format v2: "09:00-12:00,15:00-20:00|20.0" or "09:00-12:00,15:00-20:00|20.0|vmc"
  if (parts[0]?.includes('-')) {
    slots = parts[0]
      .split(',')
      .map(parseTimeSlotString)
      .filter((s): s is ClimateTimeSlot => Boolean(s));
    rawTemp = parts[1] || '21';
    vmcMax = parts[2] === 'vmc';
  } else {
    // Legacy v1: "09:00|20:00|21.0" (+ optional "|vmc")
    const rawStart = parts[0];
    const rawEnd = parts[1];
    rawTemp = parts[2] || '21';
    vmcMax = parts[3] === 'vmc';
    const startTime = /^\d{2}:\d{2}$/.test(rawStart || '') ? rawStart : '09:00';
    const endTime = /^\d{2}:\d{2}$/.test(rawEnd || '') ? rawEnd : '20:00';
    slots = [{ startTime, endTime }];
  }

  const normalizedSlots =
    slots.length > 0 ? normalizeTimeSlots(slots) : [{ startTime: '09:00', endTime: '20:00' }];
  const startTime = normalizedSlots[0].startTime;
  const endTime = normalizedSlots[normalizedSlots.length - 1].endTime;

  const parsedTemp = Number.parseFloat(rawTemp || '21');
  const targetTemp =
    Number.isFinite(parsedTemp) && (parsedTemp === 0 || (parsedTemp >= 14 && parsedTemp <= 30))
      ? Math.round(parsedTemp * 10) / 10
      : 21;

  const parsedRooms = (article.serialNumber || '')
    .split(',')
    .map((s) => s.trim() as RoomId)
    .filter((id) => VALID_ROOM_IDS.has(id));
  const rooms: RoomId[] =
    parsedRooms.length > 0 ? parsedRooms : ['salone', 'roberta', 'matrimoniale', 'maurizio'];

  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(article.purchaseDate || '')
    ? String(article.purchaseDate)
    : getLocalTodayIso();
  const lastAppliedDate = /^\d{4}-\d{2}-\d{2}$/.test(article.warrantyEnd || '')
    ? String(article.warrantyEnd)
    : startDate;

  return {
    active: Boolean(article.familyWarranty),
    mode,
    startTime,
    endTime,
    timeSlots: normalizedSlots,
    vmcMax,
    targetTemp,
    rooms,
    startDate,
    lastAppliedDate,
    notes: article.notes?.trim() || undefined,
  };
}

export function climateAutopilotToArticlePayload(
  cfg: ClimateAutopilotConfig
): Omit<HomeArticleRecord, 'id'> {
  const modeLabel = cfg.mode === 'riscaldamento' ? 'Riscaldamento' : 'Raffrescamento';
  const slots = getAutopilotSlots(cfg);
  const slotsEncoded = slots.map(formatTimeSlotString).join(',');
  const scheduleStr = cfg.vmcMax
    ? `${slotsEncoded}|${cfg.targetTemp.toFixed(1)}|vmc`
    : `${slotsEncoded}|${cfg.targetTemp.toFixed(1)}`;
  const roomsStr = cfg.rooms.join(',');
  return {
    name: cfg.active ? `Clima Attivo (${modeLabel})` : 'Clima Spento',
    brand: cfg.mode,
    model: scheduleStr.slice(0, 80),
    category: 'clima',
    room: SYSTEM_ROOM_CLIMATE_AUTO,
    familyWarranty: Boolean(cfg.active),
    purchaseDate: cfg.startDate.slice(0, 20),
    warrantyEnd: cfg.lastAppliedDate.slice(0, 20),
    serialNumber: roomsStr.slice(0, 80),
    specs: `${modeLabel} · ${formatSlotsCompact(slots)} · ${cfg.targetTemp.toFixed(1)}°C${
      cfg.vmcMax ? ' · VMC Max' : ''
    }`.slice(0, 240),
    notes: cfg.notes ? cfg.notes.trim().slice(0, 240) : undefined,
  };
}

export function buildAutopilotSessionForDate(
  dateIso: string,
  cfg: ClimateAutopilotConfig,
  ownerId: string
): ClimateSession {
  const slots = getAutopilotSlots(cfg);
  const first = slots[0];
  const last = slots[slots.length - 1];
  return {
    id: getAutoClimateDocId(dateIso),
    ownerId,
    date: dateIso,
    mode: cfg.mode,
    startTime: first.startTime,
    endTime: last.endTime,
    timeSlots: slots.length > 1 ? slots.map(formatTimeSlotString) : undefined,
    vmcMax: Boolean(cfg.vmcMax),
    targetTemp: cfg.targetTemp,
    rooms: [...cfg.rooms],
    notes: cfg.notes
      ? `Auto · ${cfg.notes}`.slice(0, 240)
      : 'Combinazione automatica giornaliera',
  };
}

export function formatAutopilotSummary(cfg: ClimateAutopilotConfig): string {
  const modeStr = cfg.mode === 'riscaldamento' ? 'Riscaldamento' : 'Raffrescamento';
  const slots = getAutopilotSlots(cfg);
  const durationLabel = formatDurationCompact(getTotalSlotsDurationHours(slots));
  const timeStr = isAllDaySlots(slots)
    ? 'Tutto il giorno (24h)'
    : `${formatSlotsSummary(slots)}${durationLabel ? ` (${durationLabel})` : ''}`;
  const tempStr = cfg.targetTemp > 0 ? `${cfg.targetTemp.toFixed(1)} °C` : 'Temp. auto';
  const vmcStr = cfg.vmcMax ? ' · VMC Max' : '';
  return `${modeStr} · ${timeStr} · ${tempStr}${vmcStr}`;
}
