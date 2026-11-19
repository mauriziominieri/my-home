export type AristonMode = 'riscaldamento' | 'raffrescamento' | 'acs_solo' | 'spento';
export type AristonProfile = 'eco' | 'comfort' | 'boost';
export type NeaSmartFanSpeed = 'auto' | 'bassa' | 'media' | 'alta';
export type ReadingSource = 'e-distribuzione-csv' | 'e-distribuzione-api' | 'manuale';

export type NavSection = 'panoramica' | 'domotica' | 'consumi' | 'integrazione';

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
  tariffEurPerKwh: 0.24,
  podCode: 'IT001E11251419',
};
