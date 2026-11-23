import {
  ClimateAutopilotConfig,
  ClimateMode,
  ClimateSession,
  HOME_ROOMS,
  HomeArticleRecord,
  RoomId,
} from '../types/home';
import { formatDurationCompact, getSessionDurationHours, isAllDaySession } from './climateTime';

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

export function articleToClimateAutopilot(
  article?: HomeArticleRecord
): ClimateAutopilotConfig | null {
  if (!article) return null;
  const mode: ClimateMode =
    article.brand === 'raffrescamento' ? 'raffrescamento' : 'riscaldamento';
  const [rawStart, rawEnd, rawTemp] = (article.model || '09:00|20:00|21').split('|');
  const startTime = /^\d{2}:\d{2}$/.test(rawStart || '') ? rawStart : '09:00';
  const endTime = /^\d{2}:\d{2}$/.test(rawEnd || '') ? rawEnd : '20:00';
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
  const scheduleStr = `${cfg.startTime}|${cfg.endTime}|${cfg.targetTemp.toFixed(1)}`;
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
    specs: `${modeLabel} · ${
      isAllDaySession(cfg.startTime, cfg.endTime) ? '24h' : `${cfg.startTime}-${cfg.endTime}`
    } · ${cfg.targetTemp.toFixed(1)}°C`.slice(0, 240),
    notes: cfg.notes ? cfg.notes.trim().slice(0, 240) : undefined,
  };
}

export function buildAutopilotSessionForDate(
  dateIso: string,
  cfg: ClimateAutopilotConfig,
  ownerId: string
): ClimateSession {
  return {
    id: getAutoClimateDocId(dateIso),
    ownerId,
    date: dateIso,
    mode: cfg.mode,
    startTime: cfg.startTime,
    endTime: cfg.endTime,
    targetTemp: cfg.targetTemp,
    rooms: [...cfg.rooms],
    notes: cfg.notes
      ? `Auto · ${cfg.notes}`.slice(0, 240)
      : 'Combinazione automatica giornaliera',
  };
}

export function formatAutopilotSummary(cfg: ClimateAutopilotConfig): string {
  const modeStr = cfg.mode === 'riscaldamento' ? 'Riscaldamento' : 'Raffrescamento';
  const timeStr = isAllDaySession(cfg.startTime, cfg.endTime)
    ? 'Tutto il giorno (24h)'
    : `${cfg.startTime} → ${cfg.endTime}${
        formatDurationCompact(getSessionDurationHours(cfg.startTime, cfg.endTime))
          ? ` (${formatDurationCompact(getSessionDurationHours(cfg.startTime, cfg.endTime))})`
          : ''
      }`;
  const tempStr = cfg.targetTemp > 0 ? `${cfg.targetTemp.toFixed(1)} °C` : 'Temp. auto';
  return `${modeStr} · ${timeStr} · ${tempStr}`;
}
