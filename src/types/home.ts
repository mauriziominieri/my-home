export type AristonMode = 'riscaldamento' | 'raffrescamento' | 'acs_solo' | 'spento';
export type AristonProfile = 'eco' | 'comfort' | 'boost';
export type NeaSmartFanSpeed = 'auto' | 'bassa' | 'media' | 'alta';
export type ReadingSource = 'e-distribuzione-csv' | 'e-distribuzione-api' | 'manuale';
export type ClimateMode = 'riscaldamento' | 'raffrescamento';

export type NavSection =
  | 'panoramica'
  | 'domotica'
  | 'consumi'
  | 'bollette'
  | 'articoli'
  | 'ricerche'
  | 'documenti'
  | 'macchina'
  | 'promemoria'
  | 'vinted'
  | 'spesa'
  | 'info'
  | 'impostazioni';

export interface BillRecord {
  invoiceNumber: string;
  issueDate: string;
  sortKey: string;
  year: number;
  period: string;
  supplier: string;
  offerName: string;
  kwh: number;
  punText: string;
  variableCostPerKwh: number;
  canoneTv: number;
  electricityOnly: number;
  totalPaid: number;
  note?: string;
  pdfFileKey?: string;
}

export interface WaterBillRecord {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  year: number;
  period: string;
  cubicMeters: number;
  fixedCostEur: number;
  totalPaid: number;
  note?: string;
  pdfFileKey?: string;
}

export interface TariBillRecord {
  id: string;
  noticeNumber: string;
  issueDate: string;
  dueDate: string;
  year: number;
  period: string;
  supplier: string;
  totalPaid: number;
  paid: boolean;
  source: 'gmail-pdf' | 'manuale';
  note?: string;
  pdfFileKey?: string;
}

export type GsePaymentType = 'acconto' | 'conguaglio' | 'altro';

export interface GsePaymentRecord {
  id: string;
  paymentDate: string;
  year: number;
  paymentType: GsePaymentType;
  period: string;
  amountEur: number;
  kwhInjected?: number;
  reference?: string;
  note?: string;
  attachmentFileKey?: string;
}

export type HomeArticleCategory =
  | 'elettrodomestici'
  | 'elettronica'
  | 'sicurezza'
  | 'fotovoltaico'
  | 'clima'
  | 'altro';

export interface HomeArticleRecord {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: HomeArticleCategory;
  room: string;
  purchaseDate?: string;
  purchasePriceEur?: number;
  warrantyEnd?: string;
  familyWarranty: boolean;
  serialNumber?: string;
  specs?: string;
  notes?: string;
  manualFileKey?: string;
  manualFileName?: string;
  manualExtractText?: string;
}

export interface SupplierMarketOffer {
  supplier: string;
  offerName: string;
  rateEurKwh: number | null;
  fixedEurMonth: number | null;
  estAnnualEur: number | null;
  url: string;
  status: 'ok' | 'unavailable';
}

export interface EnergyOffer {
  id: string;
  supplier: string;
  offerName: string;
  yearLabel: string;
  status: 'attuale' | 'prossima' | 'passata';
  pricingType: 'indicizzata' | 'fissa';
  /** Se fissa: prezzo materia energia €/kWh. Se indicizzata: spread sopra il PUN (€/kWh). */
  energyRateOrSpread: number;
  /** Quota fissa commercializzazione fornitore (PCV) €/mese IVA inclusa */
  commercializationEurMonth: number;
  /** Altri fissi (trasporto, contatore 6 kW, IVA) €/mese - fissati da ARERA */
  networkFixedEurMonth: number;
  /** Sconto / bonus una tantum anno (€) */
  annualBonusEur: number;
  billingFrequency: 'Mensile' | 'Bimestrale';
  notes: string;
}

export type RoomId =
  | 'salone'
  | 'roberta'
  | 'bagno1'
  | 'matrimoniale'
  | 'bagno2'
  | 'maurizio';

export const HOME_ROOMS: { id: RoomId; label: string }[] = [
  { id: 'salone', label: 'Salone' },
  { id: 'roberta', label: 'Roberta' },
  { id: 'bagno1', label: 'Bagno 1' },
  { id: 'matrimoniale', label: 'Matrimoniale' },
  { id: 'bagno2', label: 'Bagno 2' },
  { id: 'maurizio', label: 'Maurizio' },
];

export interface ClimateTimeSlot {
  startTime: string; // e.g. "09:00"
  endTime: string; // e.g. "12:00"
}

export interface ClimateSession {
  id: string;
  ownerId: string;
  date: string; // YYYY-MM-DD
  mode: ClimateMode;
  startTime: string; // e.g. "09:00"
  endTime: string; // e.g. "20:00" (or "24:00" / "00:00" when all day)
  timeSlots?: string[]; // e.g. ["09:00-12:00", "15:00-20:00"]
  vmcMax?: boolean;
  targetTemp: number; // °C
  rooms: RoomId[];
  notes?: string;
}

export interface VmcDayRecord {
  id: string;
  ownerId: string;
  date: string; // YYYY-MM-DD
  enabled: boolean;
  note?: string;
}

export interface EnergyReading {
  id: string;
  ownerId: string;
  date: string; // YYYY-MM-DD
  f1Kwh: number;
  f2Kwh: number;
  f3Kwh: number;
  totalKwh: number;
  peakKw: number;
  estimatedCostEur: number;
  source: ReadingSource;
  notes?: string;
}

export interface HomeSystemConfig {
  ownerId: string;
  aristonMode: AristonMode;
  aristonProfile: AristonProfile;
  floorFlowTemp: number;
  dhwTargetTemp: number;
  zoneLivingTarget: number;
  zoneBedroomTarget: number;
  neasmartPower: boolean;
  neasmartTargetHumidity: number;
  neasmartFanSpeed: NeaSmartFanSpeed;
  dewPointProtection: boolean;
  tariffEurPerKwh: number;
  podCode: string;
}

export const DEFAULT_HOME_CONFIG: Omit<HomeSystemConfig, 'ownerId'> = {
  aristonMode: 'riscaldamento',
  aristonProfile: 'eco',
  floorFlowTemp: 34,
  dhwTargetTemp: 48,
  zoneLivingTarget: 20.5,
  zoneBedroomTarget: 19.0,
  neasmartPower: true,
  neasmartTargetHumidity: 50,
  neasmartFanSpeed: 'auto',
  dewPointProtection: true,
  tariffEurPerKwh: 0.31,
  podCode: 'IT001E11251419',
};

export interface CarProfile {
  id: string;
  brand: string;
  model: string;
  plate: string;
  year?: string;
  fuelType?: string;
  engine?: string;
  vin?: string;
  tireSize?: string;
  currentKm?: number;
  insuranceCompany?: string;
  insuranceExpiry?: string;
  bolloExpiry?: string;
  revisioneExpiry?: string;
  notes?: string;
  // Dettagli tecnici, impianto GPL & manutenzione programmata
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

export interface CarInsuranceCoverage {
  id: string;
  name: string;
  premiumEur: number;
  active: boolean;
  note?: string;
}

export interface CarInsuranceSubject {
  role: string;
  fullName: string;
  gender: string;
  birthDate: string;
  birthPlace: string;
  taxCode: string;
  birthCountry: string;
  residence: string;
  profession: string;
  maritalStatus: string;
  childrenCount: number;
  education: string;
}

export interface CarInsurancePolicy {
  company: string;
  policyNumber?: string;
  startDate: string;
  endDate: string;
  totalPremiumEur: number;
  paymentFrequency: string;
  insuranceSituation: string;
  classCu: string;
  classInternal: string;
  licenseSuspensions5y: number;
  duiFines: number;
  atFaultClaims5y: number;
  noFaultClaims5y: number;
  vehicleFullName: string;
  registrationDate: string;
  vehicleValueEur: number;
  overnightParking: string;
  annualKm: number;
  vehicleUsage: string;
  vehicleModified: string;
  antiTheft: string;
  coverages: CarInsuranceCoverage[];
  subject?: CarInsuranceSubject;
  lastDocUpdatedAt?: string;
}

export type CarDocumentSlotType =
  | 'certificato_assicurazione'
  | 'attestato_rischio'
  | 'polizza_contratto'
  | 'carta_verde'
  | 'quietanza'
  | 'libretto_circolazione'
  | 'altro';

export type ArticleAttachmentType =
  | 'manuale'
  | 'scontrino_fattura'
  | 'garanzia_extra_family'
  | 'targhetta_pnc'
  | 'altro';

export type CarEntryType =
  | 'manutenzione'
  | 'scadenza'
  | 'gomme'
  | 'rifornimento'
  | 'spesa_auto';

export interface CarLogEntry {
  id: string;
  entryType: CarEntryType;
  title: string;
  date: string;
  dueDate?: string;
  km?: number;
  costEur?: number;
  workshop?: string;
  notes?: string;
}

export type SupermarketId = 'ins' | 'md' | 'conad';

export interface GroceryProduct {
  id: string;
  name: string;
  category: string;
  unit: string;
  priceIns: number | null;
  priceMd: number | null;
  priceConad: number | null;
  inShoppingList: boolean;
  notes?: string;
}

export type HomeDocumentCategory =
  | 'Mutuo & Casa'
  | 'Internet & Wi-Fi'
  | 'Contratti & Utenze'
  | 'Assicurazioni'
  | 'Fiscale & Identità'
  | 'Altro';

export interface HomeDocumentRecord {
  id: string;
  title: string;
  category: HomeDocumentCategory;
  provider: string;
  referenceCode?: string;
  issueDate?: string;
  expiryDate?: string;
  cloudUrl?: string;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
  attachmentKey?: string;
  pinned: boolean;
  notes?: string;
}

export interface ClimateAutopilotConfig {
  active: boolean;
  mode: ClimateMode;
  startTime: string;
  endTime: string;
  timeSlots?: ClimateTimeSlot[];
  vmcMax?: boolean;
  targetTemp: number;
  rooms: RoomId[];
  startDate: string; // YYYY-MM-DD
  lastAppliedDate: string; // YYYY-MM-DD
  notes?: string;
}

export type ProductResearchCategory =
  | 'elettrodomestici'
  | 'elettronica'
  | 'casa_arredo'
  | 'fai_da_te'
  | 'auto'
  | 'abbigliamento'
  | 'altro';

export type ProductResearchStatus =
  | 'da_valutare'
  | 'da_acquistare'
  | 'acquistato';

export interface ProductResearchRecord {
  id: string;
  ownerId: string;
  url: string;
  title: string;
  store: string;
  category: ProductResearchCategory;
  status: ProductResearchStatus;
  room?: string;
  priceEur?: number;
  paidPriceEur?: number;
  imageUrl?: string;
  brand?: string;
  color?: string;
  availableColors?: string[];
  colorImages?: Record<string, string>;
  size?: string;
  availableSizes?: string[];
  sizePrices?: Record<string, number>;
  model?: string;
  specs?: string;
  notes?: string;
  createdAtMs?: number;
}

export type ReminderCategory =
  | 'auto_manutenzione'
  | 'auto_pagamento'
  | 'reso_garanzia'
  | 'casa_mutuo'
  | 'altro';

export interface HomeReminderRecord {
  id: string;
  title: string;
  category: ReminderCategory;
  startDate: string; // YYYY-MM-DD
  durationYears?: number;
  durationMonths?: number;
  durationDays?: number;
  customEndDate?: string; // YYYY-MM-DD (opzionale, sovrascrive durata)
  trackKm?: boolean;
  startKm?: number;
  intervalKm?: number;
  notifyEnabled: boolean;
  leadMonths: number;
  leadDays: number;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  customEmail?: string;
  customWhatsappPhone?: string;
  renewable: boolean;
  completed: boolean;
  completedDate?: string;
  renewalCount?: number;
  lastNotifiedDate?: string; // YYYY-MM-DD
  capacityPct?: number; // 0-100 (es. stato capacità batteria auto)
  capacityCheckedDate?: string; // YYYY-MM-DD
  notes?: string;
}

export interface ReminderNotificationConfig {
  defaultEmail: string;
  whatsappPhone: string;
  callmebotApiKey?: string;
  autoEmailOnOpen: boolean;
  lastAutoDigestDate?: string; // YYYY-MM-DD
}

export type VintedItemCategory =
  | 'Abbigliamento'
  | 'Scarpe'
  | 'Accessori'
  | 'Elettronica'
  | 'Casa & Arredo'
  | 'Libri & Giochi'
  | 'Altro';

export type VintedSaleStatus = 'venduto' | 'spedito' | 'completato';

export interface VintedSaleRecord {
  id: string;
  title: string;
  category: VintedItemCategory;
  brand?: string;
  size?: string;
  saleDate: string; // DD/MM/YYYY
  salePriceEur: number;
  originalCostEur?: number;
  extraCostsEur?: number;
  netProfitEur: number;
  status: VintedSaleStatus;
  buyerName?: string;
  notes?: string;
}


