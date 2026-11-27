import {
  ArticleAttachmentType,
  CarDocumentSlotType,
  CarEntryType,
  CarInsurancePolicy,
  CarLogEntry,
  CarProfile,
  GroceryProduct,
  HomeArticleRecord,
  HomeDocumentRecord,
} from '../types/home';

export const SYSTEM_ROOM_CAR = '__macchina__';
export const SYSTEM_ROOM_GROCERY = '__spesa__';
export const SYSTEM_ROOM_GROCERY_META = '__spesa_meta__';
export const CAR_PROFILE_ID = 'car_profile_ea218es';
export const CAR_POLICY_ID = 'car_policy_ea218es';

export const DEFAULT_PANDA_PROFILE: CarProfile = {
  id: CAR_PROFILE_ID,
  brand: 'Fiat',
  model: 'Panda 2ª serie - Panda 1.2 Dynamic Mamy',
  plate: 'EA218ES',
  year: '2010',
  fuelType: 'Ibrido (Benzina / GPL)',
  engine: '1.2',
  currentKm: 150000,
  lpgTankLiters: 31.84,
  oilIntervalKm: 15000,
  oilIntervalMonths: 12,
  batteryIntervalMonths: 54,
  insuranceCompany: 'ConTe.it',
  insuranceExpiry: '20/11/2027',
};

export const DEFAULT_CONTE_POLICY_PUBLIC: CarInsurancePolicy = {
  company: 'ConTe.it',
  startDate: '20/11/2026',
  endDate: '20/11/2027',
  totalPremiumEur: 511.32,
  paymentFrequency: 'Annuale',
  insuranceSituation: 'Veicolo gia assicurato in forma Bonus Malus',
  classCu: '11',
  classInternal: '11',
  licenseSuspensions5y: 0,
  duiFines: 0,
  atFaultClaims5y: 0,
  noFaultClaims5y: 0,
  vehicleFullName: 'Fiat Panda 2ª serie - Panda 1.2 Dynamic Mamy',
  registrationDate: '15/02/2010',
  vehicleValueEur: 1904,
  overnightParking: 'Box',
  annualKm: 5000,
  vehicleUsage: 'Tempo libero',
  vehicleModified: 'Sì',
  antiTheft: 'Altri tipi di antifurto',
  coverages: [
    {
      id: 'rca',
      name: 'RCA (Responsabilità Civile Auto)',
      premiumEur: 367.08,
      active: true,
      note: 'Obbligatoria per legge: copre i danni causati a terzi (persone, altri veicoli e cose).',
    },
    {
      id: 'infortuni_conducente',
      name: 'Infortuni al conducente',
      premiumEur: 25.71,
      active: true,
      note: 'Protegge chi guida in caso di incidente con colpa (l’RCA normale non copre il guidatore responsabile).',
    },
    {
      id: 'tutela_legale',
      name: 'Tutela Legale',
      premiumEur: 22.9,
      active: true,
      note: 'Copre spese legali, periti e avvocati in caso di controversie stradali o contestazioni.',
    },
    {
      id: 'assistenza_stradale',
      name: 'Assistenza stradale',
      premiumEur: 35.17,
      active: true,
      note: 'Carro attrezzi e soccorso h24 se l’auto resta ferma per guasto, foratura o incidente.',
    },
    {
      id: 'protezione_satellitare',
      name: 'Protezione Satellitare',
      premiumEur: 60.46,
      active: true,
      note: 'Dispositivo GPS/satellitare per localizzazione, assistenza in emergenza e sconto antifurto.',
    },
  ],
};

export const DEFAULT_CONTE_POLICY_OWNER: CarInsurancePolicy = {
  ...DEFAULT_CONTE_POLICY_PUBLIC,
  subject: {
    role: 'Proprietario Principale, Conducente Principale e Contraente',
    fullName: "Roberta Dell' Angelo",
    gender: 'Femminile',
    birthDate: '28 Dicembre 1993',
    birthPlace: 'NAPOLI',
    taxCode: 'DLLRRT93T68F839V',
    birthCountry: 'ITALIA',
    residence: 'PIAZZALE SANTA CROCE 16, 35123 PADOVA (PD)',
    profession: 'Insegnante del coro',
    maritalStatus: 'Celibe/Nubile',
    childrenCount: 0,
    education: 'Laurea',
  },
};

export function articleToCarInsurance(
  article: HomeArticleRecord | undefined,
  includePrivateFallback: boolean
): CarInsurancePolicy {
  const fallback = includePrivateFallback
    ? DEFAULT_CONTE_POLICY_OWNER
    : DEFAULT_CONTE_POLICY_PUBLIC;
  if (!article?.manualExtractText) return fallback;
  try {
    const parsed = JSON.parse(article.manualExtractText) as Partial<CarInsurancePolicy>;
    return {
      ...fallback,
      ...parsed,
      coverages:
        Array.isArray(parsed.coverages) && parsed.coverages.length > 0
          ? parsed.coverages
          : fallback.coverages,
      subject: includePrivateFallback
        ? parsed.subject
          ? { ...fallback.subject!, ...parsed.subject }
          : fallback.subject
        : undefined,
    };
  } catch {
    return fallback;
  }
}

export function carInsuranceToArticlePayload(
  policy: CarInsurancePolicy
): Omit<HomeArticleRecord, 'id'> {
  const sanitized = JSON.stringify(policy).slice(0, 12_000);
  return {
    name: `Polizza ${policy.company || 'ConTe.it'} · EA218ES`.slice(0, 80),
    brand: (policy.company || 'ConTe.it').slice(0, 60),
    model: (policy.vehicleFullName || 'Fiat Panda 1.2 Dynamic Mamy').slice(0, 80),
    category: 'altro',
    room: SYSTEM_ROOM_CAR,
    familyWarranty: false,
    serialNumber: `CU ${policy.classCu || '11'} / Int ${policy.classInternal || '11'}`.slice(0, 80),
    purchaseDate: (policy.startDate || '').slice(0, 20) || undefined,
    warrantyEnd: (policy.endDate || '').slice(0, 20) || undefined,
    specs: `PREMIO:${policy.totalPremiumEur.toFixed(2)}|FRAZ:${sanitizeToken(policy.paymentFrequency).slice(0, 20)}|VAL:${Math.round(policy.vehicleValueEur)}|KM:${Math.round(policy.annualKm)}`.slice(
      0,
      240
    ),
    notes: `${policy.insuranceSituation || 'Bonus Malus'} · Box ${policy.overnightParking}`.slice(
      0,
      240
    ),
    manualExtractText: sanitized,
  };
}

export function buildCarDocumentRef(slotType: CarDocumentSlotType, plate = 'EA218ES'): string {
  return `AUTO:${plate.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)}:${slotType}`.slice(
    0,
    80
  );
}

export function parseCarDocumentRef(
  referenceCode?: string
): { plate: string; slotType: CarDocumentSlotType } | null {
  if (!referenceCode) return null;
  const match = referenceCode.match(/^AUTO:([A-Z0-9]+):([a-z0-9_]+)$/i);
  if (!match) return null;
  return {
    plate: match[1].toUpperCase(),
    slotType: match[2] as CarDocumentSlotType,
  };
}

export function buildArticleDocumentRef(
  articleId: string,
  docType: ArticleAttachmentType = 'altro'
): string {
  const cleanId = articleId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return `ART:${cleanId}:${docType}`.slice(0, 80);
}

export function parseArticleDocumentRef(
  referenceCode?: string
): { articleId: string; docType: ArticleAttachmentType } | null {
  if (!referenceCode) return null;
  const match = referenceCode.match(/^ART:([a-zA-Z0-9_-]+):([a-z0-9_]+)$/);
  if (!match) return null;
  return {
    articleId: match[1],
    docType: match[2] as ArticleAttachmentType,
  };
}

export function isCarLinkedDocument(doc: HomeDocumentRecord): boolean {
  return Boolean(parseCarDocumentRef(doc.referenceCode));
}

export function getDocumentsForArticle(
  documents: HomeDocumentRecord[],
  articleId: string
): HomeDocumentRecord[] {
  return documents.filter((d) => parseArticleDocumentRef(d.referenceCode)?.articleId === articleId);
}

export function buildResearchDocumentRef(
  researchId: string,
  docType: ArticleAttachmentType = 'altro'
): string {
  const cleanId = researchId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return `RES:${cleanId}:${docType}`.slice(0, 80);
}

export function parseResearchDocumentRef(
  referenceCode?: string
): { researchId: string; docType: ArticleAttachmentType } | null {
  if (!referenceCode) return null;
  const match = referenceCode.match(/^RES:([a-zA-Z0-9_-]+):([a-z0-9_]+)$/);
  if (!match) return null;
  return {
    researchId: match[1],
    docType: match[2] as ArticleAttachmentType,
  };
}

export function getDocumentsForResearch(
  documents: HomeDocumentRecord[],
  researchId: string
): HomeDocumentRecord[] {
  return documents.filter(
    (d) => parseResearchDocumentRef(d.referenceCode)?.researchId === researchId
  );
}

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

interface CarProfileExtraJson {
  v?: number;
  lpgTankLiters?: number;
  petrolTankLiters?: number;
  lpgSystemBrand?: string;
  lpgTankExpiry?: string;
  euroClass?: string;
  oilSpec?: string;
  oilCapacityLiters?: number;
  lastOilChangeDate?: string;
  lastOilChangeKm?: number;
  oilIntervalKm?: number;
  oilIntervalMonths?: number;
  batterySpec?: string;
  batteryInstalledDate?: string;
  batteryIntervalMonths?: number;
  batteryCapacityPct?: number;
  batteryCapacityDate?: string;
  timingBeltDate?: string;
  timingBeltKm?: number;
  sparkPlugsDate?: string;
  sparkPlugsKm?: number;
  brakeFluidDate?: string;
  coolantDate?: string;
  tirePressure?: string;
  paintCode?: string;
  radioCode?: string;
  spareKeyNote?: string;
}

function parseCarExtraJson(raw?: string): CarProfileExtraJson | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CarProfileExtraJson) : null;
  } catch {
    return null;
  }
}

function optNum(val: unknown): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return undefined;
  return Math.round(val * 100) / 100;
}

function optStr(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed ? trimmed : undefined;
}

export function articleToCarProfile(article?: HomeArticleRecord): CarProfile {
  if (!article) return DEFAULT_PANDA_PROFILE;
  const kv = parseKvString(article.specs);
  const kmNum = kv.KM ? Number(kv.KM) : undefined;
  const extra = parseCarExtraJson(article.manualExtractText);
  const isV2 = extra?.v === 2;

  const rawFuel = kv.FUEL || undefined;
  const resolvedFuel = isV2
    ? rawFuel || DEFAULT_PANDA_PROFILE.fuelType
    : !rawFuel || rawFuel.toLowerCase() === 'benzina'
      ? DEFAULT_PANDA_PROFILE.fuelType
      : rawFuel;

  const resolvedKm =
    kmNum !== undefined && Number.isFinite(kmNum) && (isV2 || kmNum > 0)
      ? kmNum
      : DEFAULT_PANDA_PROFILE.currentKm;

  return {
    id: article.id,
    brand: article.brand || 'Fiat',
    model: article.model || 'Panda',
    plate: (kv.PLT || article.serialNumber || 'EA218ES').toUpperCase(),
    year: kv.YR || undefined,
    fuelType: resolvedFuel,
    engine: kv.ENG || undefined,
    vin: kv.VIN || undefined,
    tireSize: kv.TIRE || undefined,
    currentKm: resolvedKm,
    insuranceCompany: kv.ASS || undefined,
    insuranceExpiry: article.purchaseDate || undefined,
    bolloExpiry: kv.BOL || undefined,
    revisioneExpiry: article.warrantyEnd || undefined,
    notes: article.notes || undefined,
    lpgTankLiters: optNum(extra?.lpgTankLiters) ?? (isV2 ? undefined : DEFAULT_PANDA_PROFILE.lpgTankLiters),
    petrolTankLiters: optNum(extra?.petrolTankLiters),
    lpgSystemBrand: optStr(extra?.lpgSystemBrand),
    lpgTankExpiry: optStr(extra?.lpgTankExpiry),
    euroClass: optStr(extra?.euroClass),
    oilSpec: optStr(extra?.oilSpec),
    oilCapacityLiters: optNum(extra?.oilCapacityLiters),
    lastOilChangeDate: optStr(extra?.lastOilChangeDate),
    lastOilChangeKm: optNum(extra?.lastOilChangeKm),
    oilIntervalKm: optNum(extra?.oilIntervalKm) ?? DEFAULT_PANDA_PROFILE.oilIntervalKm,
    oilIntervalMonths: optNum(extra?.oilIntervalMonths) ?? DEFAULT_PANDA_PROFILE.oilIntervalMonths,
    batterySpec: optStr(extra?.batterySpec),
    batteryInstalledDate: optStr(extra?.batteryInstalledDate),
    batteryIntervalMonths:
      optNum(extra?.batteryIntervalMonths) ?? DEFAULT_PANDA_PROFILE.batteryIntervalMonths,
    batteryCapacityPct:
      optNum(extra?.batteryCapacityPct) !== undefined
        ? Math.min(100, optNum(extra?.batteryCapacityPct)!)
        : undefined,
    batteryCapacityDate: optStr(extra?.batteryCapacityDate),
    timingBeltDate: optStr(extra?.timingBeltDate),
    timingBeltKm: optNum(extra?.timingBeltKm),
    sparkPlugsDate: optStr(extra?.sparkPlugsDate),
    sparkPlugsKm: optNum(extra?.sparkPlugsKm),
    brakeFluidDate: optStr(extra?.brakeFluidDate),
    coolantDate: optStr(extra?.coolantDate),
    tirePressure: optStr(extra?.tirePressure),
    paintCode: optStr(extra?.paintCode),
    radioCode: optStr(extra?.radioCode),
    spareKeyNote: optStr(extra?.spareKeyNote),
  };
}

export function carProfileToArticlePayload(
  profile: Omit<CarProfile, 'id'>
): Omit<HomeArticleRecord, 'id'> {
  const parts: string[] = [];
  const plate = sanitizeToken(profile.plate).toUpperCase() || 'EA218ES';
  parts.push(`PLT:${plate.slice(0, 16)}`);
  if (profile.year) parts.push(`YR:${sanitizeToken(profile.year).slice(0, 12)}`);
  if (profile.fuelType) parts.push(`FUEL:${sanitizeToken(profile.fuelType).slice(0, 28)}`);
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

  const extra: CarProfileExtraJson = {
    v: 2,
    ...(optNum(profile.lpgTankLiters) !== undefined
      ? { lpgTankLiters: optNum(profile.lpgTankLiters) }
      : {}),
    ...(optNum(profile.petrolTankLiters) !== undefined
      ? { petrolTankLiters: optNum(profile.petrolTankLiters) }
      : {}),
    ...(optStr(profile.lpgSystemBrand) ? { lpgSystemBrand: optStr(profile.lpgSystemBrand) } : {}),
    ...(optStr(profile.lpgTankExpiry) ? { lpgTankExpiry: optStr(profile.lpgTankExpiry) } : {}),
    ...(optStr(profile.euroClass) ? { euroClass: optStr(profile.euroClass) } : {}),
    ...(optStr(profile.oilSpec) ? { oilSpec: optStr(profile.oilSpec) } : {}),
    ...(optNum(profile.oilCapacityLiters) !== undefined
      ? { oilCapacityLiters: optNum(profile.oilCapacityLiters) }
      : {}),
    ...(optStr(profile.lastOilChangeDate)
      ? { lastOilChangeDate: optStr(profile.lastOilChangeDate) }
      : {}),
    ...(optNum(profile.lastOilChangeKm) !== undefined
      ? { lastOilChangeKm: optNum(profile.lastOilChangeKm) }
      : {}),
    ...(optNum(profile.oilIntervalKm) !== undefined
      ? { oilIntervalKm: optNum(profile.oilIntervalKm) }
      : {}),
    ...(optNum(profile.oilIntervalMonths) !== undefined
      ? { oilIntervalMonths: optNum(profile.oilIntervalMonths) }
      : {}),
    ...(optStr(profile.batterySpec) ? { batterySpec: optStr(profile.batterySpec) } : {}),
    ...(optStr(profile.batteryInstalledDate)
      ? { batteryInstalledDate: optStr(profile.batteryInstalledDate) }
      : {}),
    ...(optNum(profile.batteryIntervalMonths) !== undefined
      ? { batteryIntervalMonths: optNum(profile.batteryIntervalMonths) }
      : {}),
    ...(optNum(profile.batteryCapacityPct) !== undefined
      ? { batteryCapacityPct: Math.min(100, optNum(profile.batteryCapacityPct)!) }
      : {}),
    ...(optStr(profile.batteryCapacityDate)
      ? { batteryCapacityDate: optStr(profile.batteryCapacityDate) }
      : {}),
    ...(optStr(profile.timingBeltDate) ? { timingBeltDate: optStr(profile.timingBeltDate) } : {}),
    ...(optNum(profile.timingBeltKm) !== undefined
      ? { timingBeltKm: optNum(profile.timingBeltKm) }
      : {}),
    ...(optStr(profile.sparkPlugsDate) ? { sparkPlugsDate: optStr(profile.sparkPlugsDate) } : {}),
    ...(optNum(profile.sparkPlugsKm) !== undefined
      ? { sparkPlugsKm: optNum(profile.sparkPlugsKm) }
      : {}),
    ...(optStr(profile.brakeFluidDate) ? { brakeFluidDate: optStr(profile.brakeFluidDate) } : {}),
    ...(optStr(profile.coolantDate) ? { coolantDate: optStr(profile.coolantDate) } : {}),
    ...(optStr(profile.tirePressure) ? { tirePressure: optStr(profile.tirePressure) } : {}),
    ...(optStr(profile.paintCode) ? { paintCode: optStr(profile.paintCode) } : {}),
    ...(optStr(profile.radioCode) ? { radioCode: optStr(profile.radioCode) } : {}),
    ...(optStr(profile.spareKeyNote) ? { spareKeyNote: optStr(profile.spareKeyNote) } : {}),
  };

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
    manualExtractText: JSON.stringify(extra).slice(0, 12_000),
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
    category: article.brand || 'Condimenti & Dispensa',
    unit: article.model || '1 kg',
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
    brand: (item.category || 'Condimenti & Dispensa').trim().slice(0, 60),
    model: (item.unit || '1 kg').trim().slice(0, 80),
    category: 'altro',
    room: SYSTEM_ROOM_GROCERY,
    familyWarranty: Boolean(item.inShoppingList),
    specs: `INS:${ins}|MD:${md}|CONAD:${conad}`.slice(0, 240),
    notes: item.notes ? item.notes.trim().slice(0, 240) : undefined,
  };
}
