import React, { useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Calendar, Clock, Trash2, Upload } from 'lucide-react';
import { EnergyReading, NavSection } from '../types/home';
import {
  formatReadingDate,
  getDaysInMonth,
  MONTHS_IT,
  MONTHS_SHORT_IT,
  parseEDistribuzioneCsv,
  ParsedReadingInput,
  summarizeReadings,
} from '../utils/edistribuzioneCsv';

interface EnergyDatabaseViewProps {
  readings: EnergyReading[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  availableYears: number[];
  loading: boolean;
  syncIntervalHours: number;
  onChangeSyncInterval: (hours: number) => void;
  onImportCsv: (items: ParsedReadingInput[]) => Promise<void>;
  onClearAllReadings: () => Promise<void>;
  onNavigate: (section: NavSection) => void;
}

const SYNC_INTERVALS = [
  { hours: 1, label: 'Ogni 1 ora' },
  { hours: 6, label: 'Ogni 6 ore' },
  { hours: 12, label: 'Ogni 12 ore' },
  { hours: 24, label: 'Ogni 24 ore' },
];

function getHeatColor(kwh: number | undefined): string {
  if (kwh === undefined) return 'bg-slate-800/40 text-slate-600';
  if (kwh < 5) return 'bg-emerald-500/25 text-emerald-300 border-emerald-500/30';
  if (kwh < 12) return 'bg-sky-500/30 text-sky-200 border-sky-500/40';
  if (kwh < 20) return 'bg-amber-500/35 text-amber-200 border-amber-500/40';
  return 'bg-rose-500/40 text-rose-200 border-rose-500/50';
}

export function EnergyDatabaseView({
  readings,
  selectedYear,
  onSelectYear,
  availableYears,
  loading,
  syncIntervalHours,
  onChangeSyncInterval,
  onImportCsv,
  onClearAllReadings,
  onNavigate,
}: EnergyDatabaseViewProps) {
  const now = new Date();
  const defaultMonth =
    selectedYear === now.getFullYear() ? now.getMonth() : 0;
  const [selectedMonth, setSelectedMonth] = useState<number>(defaultMonth);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readingsByDate = useMemo(() => {
    const map = new Map<string, EnergyReading>();
    for (const r of readings) {
      map.set(r.date, r);
    }
    return map;
  }, [readings]);

  const yearReadings = useMemo(
    () => readings.filter((r) => r.date.startsWith(`${selectedYear}-`)),
    [readings, selectedYear]
  );

  const monthDays = useMemo(() => {
    const totalDays = getDaysInMonth(selectedYear, selectedMonth);
    const mm = String(selectedMonth + 1).padStart(2, '0');
    const rows: { day: number; iso: string; reading?: EnergyReading }[] = [];
    for (let d = 1; d <= totalDays; d++) {
      const dd = String(d).padStart(2, '0');
      const iso = `${selectedYear}-${mm}-${dd}`;
      rows.push({ day: d, iso, reading: readingsByDate.get(iso) });
    }
    return rows;
  }, [selectedYear, selectedMonth, readingsByDate]);

  const monthReadings = useMemo(
    () =>
      monthDays
        .map((d) => d.reading)
        .filter((r): r is EnergyReading => Boolean(r)),
    [monthDays]
  );

  const monthStats = summarizeReadings(monthReadings);

  const dailyChartData = useMemo(
    () =>
      monthDays.map((d) => ({
        day: String(d.day),
        F1: d.reading?.f1Kwh ?? 0,
        F2: d.reading?.f2Kwh ?? 0,
        F3: d.reading?.f3Kwh ?? 0,
      })),
    [monthDays]
  );

  const activeDayReading = selectedDayIso
    ? readingsByDate.get(selectedDayIso)
    : undefined;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMessage('Importazione file e-distribuzione in corso...');
    try {
      const text = await file.text();
      const parsed = parseEDistribuzioneCsv(text);
      if (parsed.length === 0) {
        setImportMessage('Nessuna riga valida trovata nel CSV.');
        return;
      }
      await onImportCsv(parsed);
      setImportMessage(`Importati ${parsed.length} giorni reali da ${file.name}.`);
    } catch {
      setImportMessage('Errore durante la lettura del file CSV.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header + Year + Real Import / Auto-Sync Config */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-100">
            Consumi Reali e-distribuzione
          </h2>
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
            {availableYears.map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => {
                  onSelectYear(yr);
                  setSelectedDayIso(null);
                }}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors ${
                  selectedYear === yr
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {yr}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-slate-400">Cron GitHub:</span>
            <select
              value={syncIntervalHours}
              onChange={(e) => onChangeSyncInterval(Number(e.target.value))}
              className="bg-transparent text-slate-100 font-medium focus:outline-none cursor-pointer"
            >
              {SYNC_INTERVALS.map((opt) => (
                <option
                  key={opt.hours}
                  value={opt.hours}
                  className="bg-slate-900 text-slate-100"
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Importa CSV e-distribuzione
          </button>

          {readings.length > 0 && (
            <button
              type="button"
              onClick={onClearAllReadings}
              title="Svuota database"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Svuota DB
            </button>
          )}
        </div>
      </div>

      {importMessage && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-xs text-slate-200 flex items-center justify-between">
          <span>{importMessage}</span>
          <button
            type="button"
            onClick={() => setImportMessage(null)}
            className="text-slate-400 hover:text-slate-100 ml-4"
          >
            Chiudi
          </button>
        </div>
      )}

      {readings.length === 0 && !loading && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h3 className="text-sm font-semibold text-slate-100">
              Database pronto per i tuoi consumi reali (POD IT001E11251419 · 6 kW)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Nessun dato simulato presente. Per popolare automaticamente il database con i tuoi veri kWh da e-distribuzione senza caricarli a mano, attiva lo script Python schedulato nella scheda <strong className="text-slate-200">Integrazione GitHub</strong> (oppure importa il CSV esportato dal portale e-distribuzione).
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('integrazione')}
            className="px-4 py-2 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap"
          >
            Configura Sync Automatico
          </button>
        </div>
      )}

      {/* Annual 12 Months x 31 Days Matrix */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              Mappa Annuale {selectedYear} — Tutti i giorni di tutti i 12 mesi
            </h3>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500/30 border border-emerald-500/40" />
              &lt;5 kWh
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-sky-500/35 border border-sky-500/50" />
              5–12
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-500/40 border border-amber-500/50" />
              12–20
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-500/45 border border-rose-500/50" />
              &gt;20 kWh
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[820px] space-y-1">
            <div className="grid grid-cols-[56px_repeat(31,minmax(0,1fr))] gap-1 text-[10px] font-mono text-slate-500 text-center pb-1">
              <div className="text-left">Mese</div>
              {Array.from({ length: 31 }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>

            {MONTHS_SHORT_IT.map((mLabel, mIdx) => {
              const daysCount = getDaysInMonth(selectedYear, mIdx);
              const mm = String(mIdx + 1).padStart(2, '0');
              const isSelectedMonth = selectedMonth === mIdx;

              return (
                <div
                  key={mLabel}
                  className="grid grid-cols-[56px_repeat(31,minmax(0,1fr))] gap-1 items-center"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(mIdx)}
                    className={`text-left text-xs font-medium px-1.5 py-1 rounded transition-colors ${
                      isSelectedMonth
                        ? 'text-sky-400 bg-slate-800'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {mLabel}
                  </button>

                  {Array.from({ length: 31 }, (_, dIdx) => {
                    const dayNum = dIdx + 1;
                    if (dayNum > daysCount) {
                      return <div key={dIdx} className="h-6" />;
                    }
                    const iso = `${selectedYear}-${mm}-${String(dayNum).padStart(2, '0')}`;
                    const r = readingsByDate.get(iso);
                    const isPicked = selectedDayIso === iso;

                    return (
                      <button
                        key={dIdx}
                        type="button"
                        title={
                          r
                            ? `${formatReadingDate(iso)}: ${r.totalKwh.toFixed(2)} kWh (€ ${r.estimatedCostEur.toFixed(2)})`
                            : `${formatReadingDate(iso)}: nessun dato`
                        }
                        onClick={() => {
                          setSelectedMonth(mIdx);
                          setSelectedDayIso(iso);
                        }}
                        className={`h-6 rounded-xs border text-[9px] font-mono tabular-nums flex items-center justify-center transition-transform hover:scale-105 ${getHeatColor(
                          r?.totalKwh
                        )} ${isPicked ? 'ring-2 ring-white' : 'border-transparent'}`}
                      >
                        {r ? r.totalKwh.toFixed(1) : '·'}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {selectedDayIso && (
          <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="text-slate-300">
              Giorno selezionato:{' '}
              <span className="font-mono font-semibold text-slate-100">
                {formatReadingDate(selectedDayIso)}
              </span>
            </div>
            {activeDayReading ? (
              <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-slate-300">
                <span>F1: {activeDayReading.f1Kwh.toFixed(2)} kWh</span>
                <span>F2: {activeDayReading.f2Kwh.toFixed(2)} kWh</span>
                <span>F3: {activeDayReading.f3Kwh.toFixed(2)} kWh</span>
                <span className="text-sky-400 font-semibold">
                  Totale: {activeDayReading.totalKwh.toFixed(2)} kWh
                </span>
                <span>Picco: {activeDayReading.peakKw.toFixed(1)} kW</span>
                <span className="text-emerald-400">
                  € {activeDayReading.estimatedCostEur.toFixed(2)}
                </span>
              </div>
            ) : (
              <span className="text-slate-500">
                Nessuna lettura reale presente per questa data.
              </span>
            )}
          </div>
        )}
      </section>

      {/* Month tabs + Daily Bar Chart + Full Month Table */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1">
            {MONTHS_SHORT_IT.map((mLabel, idx) => (
              <button
                key={mLabel}
                type="button"
                onClick={() => setSelectedMonth(idx)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  selectedMonth === idx
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                {mLabel}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono tabular-nums text-slate-300">
            {MONTHS_IT[selectedMonth]} {selectedYear}:{' '}
            <span className="text-sky-400 font-semibold">
              {monthStats.totalKwh.toFixed(2)} kWh
            </span>{' '}
            · € {monthStats.totalCost.toFixed(2)}
          </div>
        </div>

        <div className="p-5 border-b border-slate-800">
          <div className="h-52">
            {loading ? (
              <div className="h-full w-full bg-slate-800/50 rounded-lg animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={{ stroke: '#1E293B' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#F1F5F9',
                    }}
                  />
                  <Bar dataKey="F1" stackId="a" fill="#38BDF8" />
                  <Bar dataKey="F2" stackId="a" fill="#FBBF24" />
                  <Bar dataKey="F3" stackId="a" fill="#34D399" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-4">Giorno</th>
                <th className="py-2.5 px-4 text-right">F1 (kWh)</th>
                <th className="py-2.5 px-4 text-right">F2 (kWh)</th>
                <th className="py-2.5 px-4 text-right">F3 (kWh)</th>
                <th className="py-2.5 px-4 text-right">Totale (kWh)</th>
                <th className="py-2.5 px-4 text-right">Picco (kW)</th>
                <th className="py-2.5 px-4 text-right">Costo (€)</th>
                <th className="py-2.5 px-4">Sorgente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {monthDays.map(({ iso, reading }) => (
                <tr
                  key={iso}
                  onClick={() => setSelectedDayIso(iso)}
                  className={`cursor-pointer transition-colors ${
                    selectedDayIso === iso
                      ? 'bg-sky-500/10'
                      : 'hover:bg-slate-800/50'
                  }`}
                >
                  <td className="py-2 px-4 font-mono text-slate-200 tabular-nums whitespace-nowrap">
                    {formatReadingDate(iso)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-slate-400 tabular-nums">
                    {reading ? reading.f1Kwh.toFixed(2) : '—'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-slate-400 tabular-nums">
                    {reading ? reading.f2Kwh.toFixed(2) : '—'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-slate-400 tabular-nums">
                    {reading ? reading.f3Kwh.toFixed(2) : '—'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono font-semibold text-slate-100 tabular-nums">
                    {reading ? reading.totalKwh.toFixed(2) : '—'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-slate-400 tabular-nums">
                    {reading ? reading.peakKw.toFixed(1) : '—'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-emerald-400 tabular-nums">
                    {reading ? `€ ${reading.estimatedCostEur.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2 px-4 text-slate-400 max-w-[260px] truncate">
                    {reading ? reading.notes || reading.source : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>
            {yearReadings.length} giorni reali salvati nel {selectedYear}
          </span>
          <span>POD IT001E11251419 · Potenza contrattuale 6 kW</span>
        </div>
      </section>
    </div>
  );
}
