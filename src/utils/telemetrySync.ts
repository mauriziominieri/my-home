import { DailyFirestoreUsageEntry } from '../firebase';
import { HomeArticleRecord } from '../types/home';

export const SYSTEM_ROOM_TELEMETRY = '__telemetry__';
export const TELEMETRY_DOC_PREFIX = 'telemetry_';

const BROWSER_ID_STORAGE_KEY = 'myhome_browser_device_id_v1';

export interface BrowserTelemetryDevice {
  browserId: string;
  browserLabel: string;
  ptDate: string;
  reads: number;
  readUnits: number;
  writes: number;
  deletes: number;
  writeUnits: number;
  savedInTestMode: number;
  quotaHit: boolean;
  updatedAt: number;
}

function sanitizeBrowserId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return cleaned.length >= 4 ? cleaned : 'br_default';
}

export function detectBrowserLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent || '';
  const isIframePreview =
    typeof window !== 'undefined' && window.location.hostname.startsWith('ais-');

  const os = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Dispositivo';

  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Firefox\//i.test(ua)
      ? 'Firefox'
      : /OPR\//i.test(ua)
        ? 'Opera'
        : /CriOS/i.test(ua) || (/Chrome\//i.test(ua) && !/Edg\//i.test(ua))
          ? 'Chrome'
          : /Safari\//i.test(ua) && !/Chrome\//i.test(ua)
            ? 'Safari'
            : 'Browser';

  const base = `${browser} · ${os}`;
  return (isIframePreview ? `${base} (AI Studio)` : base).slice(0, 58);
}

export function getBrowserDeviceInfo(): { browserId: string; browserLabel: string } {
  const browserLabel = detectBrowserLabel();
  if (typeof window === 'undefined') {
    return { browserId: 'br_server', browserLabel };
  }
  try {
    const existing = window.localStorage.getItem(BROWSER_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,32}$/.test(existing)) {
      return { browserId: existing, browserLabel };
    }
    const rand = Math.random().toString(36).slice(2, 10);
    const ts = Date.now().toString(36).slice(-4);
    const created = sanitizeBrowserId(`br_${ts}${rand}`);
    window.localStorage.setItem(BROWSER_ID_STORAGE_KEY, created);
    return { browserId: created, browserLabel };
  } catch {
    return { browserId: 'br_ephemeral', browserLabel };
  }
}

export function getTelemetryDocId(browserId: string): string {
  return `${TELEMETRY_DOC_PREFIX}${sanitizeBrowserId(browserId)}`;
}

export function buildBrowserTelemetryArticlePayload(
  ownerId: string,
  browserId: string,
  browserLabel: string,
  entry: DailyFirestoreUsageEntry,
  createdAt: unknown
): Record<string, unknown> {
  const compact = {
    d: entry.date,
    r: Math.max(0, Math.round(entry.readUnits)),
    rd: Math.max(0, Math.round(entry.reads)),
    w: Math.max(0, Math.round(entry.writeUnits)),
    wr: Math.max(0, Math.round(entry.writes)),
    dl: Math.max(0, Math.round(entry.deletes)),
    sv: Math.max(0, Math.round(entry.savedInTestMode)),
    q: entry.quotaHit ? 1 : 0,
    ts: Date.now(),
  };
  return {
    ownerId,
    name: `Telemetria ${sanitizeBrowserId(browserId)}`.slice(0, 80),
    brand: (browserLabel || 'Browser').slice(0, 60),
    model: 'telemetry_pt_v1',
    category: 'altro',
    room: SYSTEM_ROOM_TELEMETRY,
    familyWarranty: false,
    specs: JSON.stringify(compact).slice(0, 240),
    createdAt,
  };
}

export function parseBrowserTelemetryFromArticles(
  articles: HomeArticleRecord[],
  targetPtDate: string
): BrowserTelemetryDevice[] {
  const result: BrowserTelemetryDevice[] = [];
  for (const a of articles) {
    if (a.room !== SYSTEM_ROOM_TELEMETRY || !a.id.startsWith(TELEMETRY_DOC_PREFIX)) {
      continue;
    }
    if (!a.specs) continue;
    try {
      const raw = JSON.parse(a.specs) as Record<string, unknown>;
      if (raw.d !== targetPtDate) continue;
      const browserId = sanitizeBrowserId(a.id.slice(TELEMETRY_DOC_PREFIX.length));
      const num = (k: string) => {
        const v = Number(raw[k]);
        return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
      };
      result.push({
        browserId,
        browserLabel: (a.brand || 'Browser').slice(0, 60),
        ptDate: targetPtDate,
        readUnits: num('r'),
        reads: num('rd'),
        writeUnits: num('w'),
        writes: num('wr'),
        deletes: num('dl'),
        savedInTestMode: num('sv'),
        quotaHit: raw.q === 1 || raw.q === true,
        updatedAt: num('ts') || Date.now(),
      });
    } catch {
      // ignore malformed entry
    }
  }
  return result;
}

export function entryToBrowserTelemetryDevice(
  entry: DailyFirestoreUsageEntry,
  browserId: string,
  browserLabel: string
): BrowserTelemetryDevice {
  return {
    browserId: sanitizeBrowserId(browserId),
    browserLabel: browserLabel.slice(0, 60),
    ptDate: entry.date,
    reads: Math.max(0, Math.round(entry.reads)),
    readUnits: Math.max(0, Math.round(entry.readUnits)),
    writes: Math.max(0, Math.round(entry.writes)),
    deletes: Math.max(0, Math.round(entry.deletes)),
    writeUnits: Math.max(0, Math.round(entry.writeUnits)),
    savedInTestMode: Math.max(0, Math.round(entry.savedInTestMode)),
    quotaHit: Boolean(entry.quotaHit),
    updatedAt: Date.now(),
  };
}

export function mergeBrowserTelemetryDevices(
  lists: BrowserTelemetryDevice[][],
  targetPtDate: string
): BrowserTelemetryDevice[] {
  const byId = new Map<string, BrowserTelemetryDevice>();
  for (const list of lists) {
    for (const item of list) {
      if (!item || item.ptDate !== targetPtDate) continue;
      const id = sanitizeBrowserId(item.browserId);
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, { ...item, browserId: id });
      } else {
        byId.set(id, {
          browserId: id,
          browserLabel:
            item.updatedAt >= prev.updatedAt && item.browserLabel
              ? item.browserLabel
              : prev.browserLabel || item.browserLabel,
          ptDate: targetPtDate,
          reads: Math.max(prev.reads, item.reads),
          readUnits: Math.max(prev.readUnits, item.readUnits),
          writes: Math.max(prev.writes, item.writes),
          deletes: Math.max(prev.deletes, item.deletes),
          writeUnits: Math.max(prev.writeUnits, item.writeUnits),
          savedInTestMode: Math.max(prev.savedInTestMode, item.savedInTestMode),
          quotaHit: prev.quotaHit || item.quotaHit,
          updatedAt: Math.max(prev.updatedAt, item.updatedAt),
        });
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.readUnits + b.writeUnits - (a.readUnits + a.writeUnits)
  );
}
