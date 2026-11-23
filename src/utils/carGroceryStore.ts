import {
  CarEntryType,
  CarLogEntry,
  CarProfile,
  GroceryProduct,
  HomeArticleRecord,
} from '../types/home';

export const SYSTEM_ROOM_CAR = '__macchina__';
export const SYSTEM_ROOM_GROCERY = '__spesa__';
export const CAR_PROFILE_ID = 'car_profile_ea218es';

export const DEFAULT_PANDA_PROFILE: CarProfile = {
  id: CAR_PROFILE_ID,
  brand: 'Fiat',
  model: 'Panda',
  plate: 'EA218ES',
};

function sanitizeToken(val: string | undefined): string {
  return (val || '').replace(/[|\r\n]/g, ' ').trim();
}

function parseKvString(raw?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!raw) return map;
  for (const part of raw.split('|')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) map[key] = val;
  }
  return map;
}

export function articleToCarProfile(article?: HomeArticleRecord): CarProfile {
  if (!article) return DEFAULT_PANDA_PROFILE;
  const kv = parseKvString(article.specs);
  const kmNum = kv.KM ? Number(kv.KM) : undefined;
  return {
    id: article.id,
    brand: article.brand || 'Fiat',
    model: article.model || 'Panda',
    plate: (kv.PLT || article.serialNumber || 'EA218ES').toUpperCase(),
    year: kv.YR || undefined,
    fuelType: kv.FUEL || undefined,
    engine: kv.ENG || undefined,
    vin: kv.VIN || undefined,
    tireSize: kv.TIRE || undefined,
    currentKm: kmNum !== undefined && Number.isFinite(kmNum) ? kmNum : undefined,
    insuranceCompany: kv.ASS || undefined,
    insuranceExpiry: article.purchaseDate || undefined,
    bolloExpiry: kv.BOL || undefined,
    revisioneExpiry: article.warrantyEnd || undefined,
    notes: article.notes || undefined,
  };
}

export function carProfileToArticlePayload(
  profile: Omit<CarProfile, 'id'>
): Omit<HomeArticleRecord, 'id'> {
  const parts: string[] = [];
  const plate = sanitizeToken(profile.plate).toUpperCase() || 'EA218ES';
  parts.push(`PLT:${plate.slice(0, 16)}`);
  if (profile.year) parts.push(`YR:${sanitizeToken(profile.year).slice(0, 12)}`);
  if (profile.fuelType) parts.push(`FUEL:${sanitizeToken(profile.fuelType).slice(0, 24)}`);
  if (profile.engine) parts.push(`ENG:${sanitizeToken(profile.engine).slice(0, 28)}`);
  if (profile.tireSize) parts.push(`TIRE:${sanitizeToken(profile.tireSize).slice(0, 24)}`);
  if (typeof profile.currentKm === 'number' && Number.isFinite(profile.currentKm)) {
    parts.push(`KM:${Math.round(profile.currentKm)}`);
  }
  if (profile.bolloExpiry) parts.push(`BOL:${sanitizeToken(profile.bolloExpiry).slice(0, 16)}`);
  if (profile.insuranceCompany) {
    parts.push(`ASS:${sanitizeToken(profile.insuranceCompany).slice(0, 32)}`);
  }
  if (profile.vin) parts.push(`VIN:${sanitizeToken(profile.vin).slice(0, 24)}`);

  return {
    name: `${profile.brand || 'Fiat'} ${profile.model || 'Panda'}`.slice(0, 80),
    brand: (profile.brand || 'Fiat').slice(0, 60),
    model: (profile.model || 'Panda').slice(0, 80),
    category: 'altro',
    room: SYSTEM_ROOM_CAR,
    familyWarranty: false,
    serialNumber: plate.slice(0, 80),
    purchaseDate: profile.insuranceExpiry ? profile.insuranceExpiry.slice(0, 20) : undefined,
    warrantyEnd: profile.revisioneExpiry ? profile.revisioneExpiry.slice(0, 20) : undefined,
    specs: parts.join('|').slice(0, 240),
    notes: profile.notes ? profile.notes.slice(0, 240) : undefined,
  };
}

export function articleToCarLog(article: HomeArticleRecord): CarLogEntry {
  const kv = parseKvString(article.specs);
  const kmNum = kv.KM ? Number(kv.KM) : undefined;
  const costNum = kv.COST ? Number(kv.COST) : undefined;
  return {
    id: article.id,
    entryType: (article.brand as CarEntryType) || 'manutenzione',
    title: article.name,
    date: article.purchaseDate || '',
    dueDate: article.warrantyEnd || undefined,
    km: kmNum !== undefined && Number.isFinite(kmNum) ? kmNum : undefined,
    costEur: costNum !== undefined && Number.isFinite(costNum) ? costNum : undefined,
    workshop: article.serialNumber || undefined,
    notes: article.notes || undefined,
  };
}

export function carLogToArticlePayload(
  entry: Omit<CarLogEntry, 'id'>
): Omit<HomeArticleRecord, 'id'> {
  const parts: string[] = [];
  if (typeof entry.km === 'number' && Number.isFinite(entry.km)) {
    parts.push(`KM:${Math.round(entry.km)}`);
  }
  if (typeof entry.costEur === 'number' && Number.isFinite(entry.costEur)) {
    parts.push(`COST:${Math.round(entry.costEur * 100) / 100}`);
  }
  return {
    name: entry.title.trim().slice(0, 80),
    brand: entry.entryType.slice(0, 60),
    model: 'EA218ES',
    category: 'altro',
    room: SYSTEM_ROOM_CAR,
    familyWarranty: false,
    purchaseDate: entry.date ? entry.date.trim().slice(0, 20) : undefined,
    warrantyEnd: entry.dueDate ? entry.dueDate.trim().slice(0, 20) : undefined,
    serialNumber: entry.workshop ? entry.workshop.trim().slice(0, 80) : undefined,
    specs: parts.length > 0 ? parts.join('|').slice(0, 240) : undefined,
    notes: entry.notes ? entry.notes.trim().slice(0, 240) : undefined,
  };
}

function parsePriceVal(raw: string | undefined): number | null {
  if (!raw || raw === '-' || raw === 'null') return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function articleToGroceryProduct(article: HomeArticleRecord): GroceryProduct {
  const kv = parseKvString(article.specs);
  return {
    id: article.id,
    name: article.name,
    category: article.brand || 'Dispensa',
    unit: article.model || 'pz',
    priceIns: parsePriceVal(kv.INS),
    priceMd: parsePriceVal(kv.MD),
    priceConad: parsePriceVal(kv.CONAD),
    inShoppingList: Boolean(article.familyWarranty),
    notes: article.notes || undefined,
  };
}

export function groceryProductToArticlePayload(
  item: Omit<GroceryProduct, 'id'>
): Omit<HomeArticleRecord, 'id'> {
  const ins = item.priceIns !== null ? item.priceIns.toFixed(2) : '-';
  const md = item.priceMd !== null ? item.priceMd.toFixed(2) : '-';
  const conad = item.priceConad !== null ? item.priceConad.toFixed(2) : '-';
  return {
    name: item.name.trim().slice(0, 80),
    brand: (item.category || 'Dispensa').trim().slice(0, 60),
    model: (item.unit || 'pz').trim().slice(0, 80),
    category: 'altro',
    room: SYSTEM_ROOM_GROCERY,
    familyWarranty: Boolean(item.inShoppingList),
    specs: `INS:${ins}|MD:${md}|CONAD:${conad}`.slice(0, 240),
    notes: item.notes ? item.notes.trim().slice(0, 240) : undefined,
  };
}
