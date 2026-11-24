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
  fuelType: 'Benzina',
  engine: '1.2',
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
