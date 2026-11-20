export type AristonMode = 'riscaldamento' | 'raffrescamento' | 'acs_solo' | 'spento';
export type AristonProfile = 'eco' | 'comfort' | 'boost';
export type NeaSmartFanSpeed = 'auto' | 'bassa' | 'media' | 'alta';
export type ReadingSource = 'e-distribuzione-csv' | 'e-distribuzione-api' | 'manuale';
export type ClimateMode = 'riscaldamento' | 'raffrescamento';

export type NavSection = 'panoramica' | 'domotica' | 'consumi' | 'bollette';

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

export interface ClimateSession {
  id: string;
  ownerId: string;
  date: string; // YYYY-MM-DD
  mode: ClimateMode;
  startTime: string; // e.g. "09:00"
  endTime: string; // e.g. "20:00"
  targetTemp: number; // °C
  rooms: RoomId[];
  notes?: string;
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
