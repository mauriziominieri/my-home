import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Droplets, Flame, Snowflake } from 'lucide-react';
import { EnergyReading, HomeSystemConfig, NavSection } from '../types/home';
import { MONTHS_SHORT_IT, summarizeReadings } from '../utils/edistribuzioneCsv';

interface OverviewViewProps {
  config: HomeSystemConfig;
  readings: EnergyReading[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  availableYears: number[];
  loading: boolean;
  onNavigate: (section: NavSection) => void;
}

const MODE_LABELS: Record<HomeSystemConfig['aristonMode'], string> = {
  riscaldamento: 'Riscaldamento',
  raffrescamento: 'Raffrescamento',
  acs_solo: 'Solo ACS',
  spento: 'Spento',
};

export function OverviewView({
  config,
  readings,
  selectedYear,
  onSelectYear,
  availableYears,
  loading,
  onNavigate,
}: OverviewViewProps) {
  const yearPrefix = `${selectedYear}-`;
  const yearReadings = readings.filter((r) => r.date.startsWith(yearPrefix));
  const stats = summarizeReadings(yearReadings);

  const monthlyData = MONTHS_SHORT_IT.map((label, idx) => {
    const monthPrefix = `${selectedYear}-${String(idx + 1).padStart(2, '0')}-`;
    const mReadings = yearReadings.filter((r) => r.date.startsWith(monthPrefix));
    const f1 = Math.round(mReadings.reduce((s, r) => s + r.f1Kwh, 0) * 10) / 10;
    const f2 = Math.round(mReadings.reduce((s, r) => s + r.f2Kwh, 0) * 10) / 10;
    const f3 = Math.round(mReadings.reduce((s, r) => s + r.f3Kwh, 0) * 10) / 10;
    return { label, F1: f1, F2: f2, F3: f3 };
  });

  const isCooling = config.aristonMode === 'raffrescamento';
  const isHeating = config.aristonMode === 'riscaldamento';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Panoramica Energetica {selectedYear}
          </h1>
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs dark:shadow-none">
            {availableYears.map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => onSelectYear(yr)}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors ${
                  selectedYear === yr
                    ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-950'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {yr}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          POD {config.podCode} · 6 kW
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs dark:shadow-none">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Consumo totale {selectedYear}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {loading ? '—' : stats.totalKwh.toFixed(1)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">kWh</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {yearReadings.length} giorni rilevati · Media {stats.avgDailyKwh.toFixed(1)} kWh/g
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs dark:shadow-none">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Costo stimato {selectedYear}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {loading ? '—' : `€ ${stats.totalCost.toFixed(2)}`}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Tariffa € {config.tariffEurPerKwh.toFixed(2)}/kWh · Picco {stats.maxPeakKw.toFixed(1)} / 6.0 kW
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs dark:shadow-none">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Pompa di Calore Ariston
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {config.floorFlowTemp}°C
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">mandata</span>
          </div>
          <div className="mt-2 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            {isHeating && <Flame className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />}
            {isCooling && <Snowflake className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />}
            <span>
              {MODE_LABELS[config.aristonMode]} · {config.aristonProfile} · ACS {config.dhwTargetTemp}°C
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs dark:shadow-none">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Deumidificatore NeaSmart
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {config.neasmartTargetHumidity}%
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">UR target</span>
          </div>
          <div className="mt-2 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Droplets className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>
              {config.neasmartPower ? 'Attivo' : 'In standby'} · Ventola {config.neasmartFanSpeed}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Andamento mensile {selectedYear} (e-distribuzione)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Totale mensile kWh suddiviso per fasce F1, F2 e F3
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                F1 Punta
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                F2 Intermedia
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />
                F3 Fuori punta
              </span>
            </div>
          </div>

          <div className="mt-6 h-72">
            {loading ? (
              <div className="h-full w-full bg-slate-200 dark:bg-slate-800/50 rounded-lg" />
            ) : yearReadings.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Nessun dato reale ancora presente per il {selectedYear}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                  I consumi reali del POD {config.podCode} vengono sincronizzati automaticamente da e-distribuzione.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--chart-tick)' }}
                    axisLine={{ stroke: 'var(--chart-grid)' }}
                    tickLine={false}
                  />
                  <YAxis
                    width={62}
                    tickFormatter={(v) => `${v} kWh`}
                    tick={{ fontSize: 11, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{
                      fill: 'rgba(56, 189, 248, 0.08)',
                      stroke: 'rgba(56, 189, 248, 0.32)',
                      strokeWidth: 1,
                      rx: 4,
                      ry: 4,
                    }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const byKey = new Map(
                        payload.map((entry) => [
                          String(entry.dataKey),
                          Number(entry.value ?? 0),
                        ])
                      );
                      const f1 = byKey.get('F1') ?? 0;
                      const f2 = byKey.get('F2') ?? 0;
                      const f3 = byKey.get('F3') ?? 0;
                      const tot = f1 + f2 + f3;
                      return (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl space-y-1">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1">
                            {label} {selectedYear}
                          </div>
                          <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                            <span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                              <span className="w-2 h-2 rounded-xs bg-sky-400" />
                              F3 (Fuori punta)
                            </span>
                            <span className="text-slate-900 dark:text-slate-100">{f3.toFixed(1)} kWh</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                            <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                              <span className="w-2 h-2 rounded-xs bg-amber-400" />
                              F2 (Intermedia)
                            </span>
                            <span className="text-slate-900 dark:text-slate-100">{f2.toFixed(1)} kWh</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                            <span className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-300">
                              <span className="w-2 h-2 rounded-xs bg-rose-500" />
                              F1 (Punta)
                            </span>
                            <span className="text-slate-900 dark:text-slate-100">{f1.toFixed(1)} kWh</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 font-mono tabular-nums pt-1 border-t border-slate-200 dark:border-slate-800 font-semibold">
                            <span className="text-slate-800 dark:text-slate-200">Totale</span>
                            <span className="text-emerald-700 dark:text-emerald-400">{tot.toFixed(1)} kWh</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="F1" stackId="a" fill="#F43F5E" />
                  <Bar dataKey="F2" stackId="a" fill="#FBBF24" />
                  <Bar dataKey="F3" stackId="a" fill="#38BDF8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between shadow-xs dark:shadow-none">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Stato Impianto Integrato
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Coordinamento Ariston + NeaSmart
            </p>

            <div className="mt-5 divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              <div className="py-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Zona Giorno</span>
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                  {config.zoneLivingTarget.toFixed(1)} °C
                </span>
              </div>
              <div className="py-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Zona Notte</span>
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                  {config.zoneBedroomTarget.toFixed(1)} °C
                </span>
              </div>
              <div className="py-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Acqua Calda (ACS)</span>
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                  {config.dhwTargetTemp} °C
                </span>
              </div>
              <div className="py-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Potenza Contratto</span>
                <span className="font-mono text-xs text-slate-800 dark:text-slate-200 tabular-nums">
                  6.0 kW
                </span>
              </div>
              <div className="py-3 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Codice POD</span>
                <span className="font-mono text-xs text-sky-700 dark:text-sky-400 tabular-nums">
                  {config.podCode}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onNavigate('consumi')}
              className="w-full inline-flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-500 dark:hover:bg-sky-400 rounded-lg transition-colors"
            >
              <span>Calendario giornaliero {selectedYear}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('domotica')}
              className="w-full inline-flex items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <span>Controlla Ariston & NeaSmart</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
