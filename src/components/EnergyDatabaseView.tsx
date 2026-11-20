import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Calendar,
  ClipboardPaste,
  Copy,
  Flame,
  Pencil,
  Plus,
  Snowflake,
  Trash2,
  Trophy,
} from 'lucide-react';
import {
  ClimateMode,
  ClimateSession,
  EnergyReading,
  HOME_ROOMS,
  NavSection,
  RoomId,
} from '../types/home';
import {
  formatReadingDate,
  getDaysInMonth,
  MONTHS_IT,
  MONTHS_SHORT_IT,
  summarizeReadings,
} from '../utils/edistribuzioneCsv';

const ROOM_LABELS: Record<RoomId, string> = {
  salone: 'Salone',
  roberta: 'Roberta',
  bagno1: 'Bagno 1',
  matrimoniale: 'Matrimoniale',
  bagno2: 'Bagno 2',
  maurizio: 'Maurizio',
};

interface EnergyDatabaseViewProps {
  readings: EnergyReading[];
  climateLogs: ClimateSession[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
  availableYears: number[];
  loading: boolean;
  onAddClimateLog: (
    session: Omit<ClimateSession, 'id' | 'ownerId'>
  ) => Promise<void>;
  onUpdateClimateLog: (
    id: string,
    session: Omit<ClimateSession, 'id' | 'ownerId'>
  ) => Promise<void>;
  onDeleteClimateLog: (id: string) => Promise<void>;
  onNavigate: (section: NavSection) => void;
}

function getHeatColor(kwh: number | undefined): string {
  if (kwh === undefined) return 'bg-slate-800/40 text-slate-600';
  if (kwh < 5) return 'bg-emerald-500/25 text-emerald-300 border-emerald-500/30';
  if (kwh < 12) return 'bg-sky-500/30 text-sky-200 border-sky-500/40';
  if (kwh < 20) return 'bg-amber-500/35 text-amber-200 border-amber-500/40';
  return 'bg-rose-500/40 text-rose-200 border-rose-500/50';
}

function getDefaultModeForIso(iso: string): ClimateMode {
  const month = Number(iso.split('-')[1]);
  // Maggio - Settembre: periodo estivo -> raffrescamento
  return month >= 5 && month <= 9 ? 'raffrescamento' : 'riscaldamento';
}

function getComboKey(log: ClimateSession): string {
  const sortedRooms = [...log.rooms].sort();
  return `${log.mode}|${log.startTime}-${log.endTime}|${log.targetTemp.toFixed(1)}|${sortedRooms.join(',')}`;
}

export function EnergyDatabaseView({
  readings,
  climateLogs,
  selectedYear,
  onSelectYear,
  availableYears,
  loading,
  onAddClimateLog,
  onUpdateClimateLog,
  onDeleteClimateLog,
  onNavigate,
}: EnergyDatabaseViewProps) {
  const now = new Date();
  const defaultMonth =
    selectedYear === now.getFullYear() ? now.getMonth() : 0;
  const [selectedMonth, setSelectedMonth] = useState<number>(defaultMonth);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);

  // Stato form inline per registrare o modificare accensione NeaSmart sul giorno selezionato
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [pendingDeleteLog, setPendingDeleteLog] = useState<ClimateSession | null>(null);
  const [deletingLog, setDeletingLog] = useState(false);
  const [rankingFilter, setRankingFilter] = useState<'all' | ClimateMode>('all');
  const [copiedSession, setCopiedSession] = useState<{
    mode: ClimateMode;
    startTime: string;
    endTime: string;
    targetTemp: number;
    rooms: RoomId[];
    notes?: string;
    sourceDate: string;
  } | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [inlineMode, setInlineMode] = useState<ClimateMode>('riscaldamento');
  const [inlineStartTime, setInlineStartTime] = useState('09:00');
  const [inlineEndTime, setInlineEndTime] = useState('20:00');
  const [inlineTargetTemp, setInlineTargetTemp] = useState('21.0');
  const [inlineRooms, setInlineRooms] = useState<RoomId[]>([
    'salone',
    'roberta',
    'matrimoniale',
    'maurizio',
  ]);
  const [inlineNotes, setInlineNotes] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);

  function openNewInlineForm(iso: string) {
    const defaultMode = getDefaultModeForIso(iso);
    setEditingLogId(null);
    setInlineMode(defaultMode);
    setInlineStartTime('09:00');
    setInlineEndTime('20:00');
    setInlineTargetTemp(defaultMode === 'raffrescamento' ? '25.0' : '21.0');
    setInlineRooms(['salone', 'roberta', 'matrimoniale', 'maurizio']);
    setInlineNotes('');
    setShowInlineForm(true);
  }

  function openEditInlineForm(log: ClimateSession) {
    setEditingLogId(log.id);
    setInlineMode(log.mode);
    setInlineStartTime(log.startTime);
    setInlineEndTime(log.endTime);
    setInlineTargetTemp(log.targetTemp.toFixed(1));
    setInlineRooms([...log.rooms]);
    setInlineNotes(log.notes || '');
    setShowInlineForm(true);
  }

  function toggleInlineRoom(roomId: RoomId) {
    setInlineRooms((prev) =>
      prev.includes(roomId)
        ? prev.filter((r) => r !== roomId)
        : [...prev, roomId]
    );
  }

  async function handleSaveInlineClimate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDayIso || inlineRooms.length === 0) return;
    setInlineSaving(true);
    try {
      const payload = {
        date: selectedDayIso,
        mode: inlineMode,
        startTime: inlineStartTime,
        endTime: inlineEndTime,
        targetTemp: Math.max(15, Math.min(30, Number(inlineTargetTemp) || 21)),
        rooms: inlineRooms,
        notes: inlineNotes.trim() || undefined,
      };
      if (editingLogId) {
        await onUpdateClimateLog(editingLogId, payload);
      } else {
        await onAddClimateLog(payload);
      }
      setShowInlineForm(false);
      setEditingLogId(null);
      setInlineNotes('');
    } finally {
      setInlineSaving(false);
    }
  }

  async function confirmDeleteClimateLog() {
    if (!pendingDeleteLog) return;
    setDeletingLog(true);
    try {
      const id = pendingDeleteLog.id;
      if (editingLogId === id) {
        setShowInlineForm(false);
        setEditingLogId(null);
      }
      await onDeleteClimateLog(id);
      setPendingDeleteLog(null);
    } finally {
      setDeletingLog(false);
    }
  }

  function showClipboardFeedback(msg: string) {
    setClipboardNotice(msg);
    window.setTimeout(() => {
      setClipboardNotice((curr) => (curr === msg ? null : curr));
    }, 2800);
  }

  function copySessionFromLog(log: ClimateSession) {
    setCopiedSession({
      mode: log.mode,
      startTime: log.startTime,
      endTime: log.endTime,
      targetTemp: log.targetTemp,
      rooms: [...log.rooms],
      notes: log.notes,
      sourceDate: log.date,
    });
    showClipboardFeedback(
      `Combinazione del ${formatReadingDate(log.date)} copiata (premi Ctrl+V su un altro giorno per incollarla).`
    );
  }

  async function pasteSessionToDay(targetIso: string) {
    if (!copiedSession) return;
    const existingLogs = climateByDate.get(targetIso) || [];
    const payload = {
      date: targetIso,
      mode: copiedSession.mode,
      startTime: copiedSession.startTime,
      endTime: copiedSession.endTime,
      targetTemp: copiedSession.targetTemp,
      rooms: [...copiedSession.rooms],
      notes: copiedSession.notes,
    };
    if (existingLogs.length > 0) {
      await onUpdateClimateLog(existingLogs[0].id, payload);
    } else {
      await onAddClimateLog(payload);
    }
    setShowInlineForm(false);
    setEditingLogId(null);
    showClipboardFeedback(
      `Combinazione del ${formatReadingDate(copiedSession.sourceDate)} incollata sul ${formatReadingDate(targetIso)}.`
    );
  }

  const readingsByDate = useMemo(() => {
    const map = new Map<string, EnergyReading>();
    for (const r of readings) {
      map.set(r.date, r);
    }
    return map;
  }, [readings]);

  const climateByDate = useMemo(() => {
    const map = new Map<string, ClimateSession[]>();
    for (const log of climateLogs) {
      const prev = map.get(log.date) || [];
      prev.push(log);
      map.set(log.date, prev);
    }
    return map;
  }, [climateLogs]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'c' && selectedDayIso) {
        const dayLogs = climateByDate.get(selectedDayIso);
        if (dayLogs && dayLogs.length > 0) {
          e.preventDefault();
          copySessionFromLog(dayLogs[0]);
        }
      } else if (key === 'v' && selectedDayIso && copiedSession) {
        e.preventDefault();
        void pasteSessionToDay(selectedDayIso);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDayIso, copiedSession, climateByDate]);

  // Calcola fase termica impianto a pavimento (1° giorno: Prima accensione, 2°: Assestamento, 3°+: A regime)
  const phaseByDate = useMemo(() => {
    const map = new Map<string, 'prima_accensione' | 'assestamento' | 'a_regime'>();
    const shiftIso = (iso: string, deltaDays: number) => {
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
      return dt.toISOString().slice(0, 10);
    };
    for (const [iso, logs] of climateByDate.entries()) {
      const mode = logs[0]?.mode;
      if (!mode) continue;
      const prev1 = climateByDate.get(shiftIso(iso, -1))?.some((l) => l.mode === mode);
      const prev2 = climateByDate.get(shiftIso(iso, -2))?.some((l) => l.mode === mode);
      if (!prev1) {
        map.set(iso, 'prima_accensione');
      } else if (!prev2) {
        map.set(iso, 'assestamento');
      } else {
        map.set(iso, 'a_regime');
      }
    }
    return map;
  }, [climateByDate]);

  const yearReadings = useMemo(
    () => readings.filter((r) => r.date.startsWith(`${selectedYear}-`)),
    [readings, selectedYear]
  );

  const monthlyTotals = useMemo(() => {
    const totals = new Array<number>(12).fill(0);
    const counts = new Array<number>(12).fill(0);
    for (const r of yearReadings) {
      const mIdx = Number(r.date.slice(5, 7)) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        totals[mIdx] += r.totalKwh;
        counts[mIdx] += 1;
      }
    }
    return totals.map((kwh, idx) => ({ kwh, count: counts[idx] }));
  }, [yearReadings]);

  const annualTotalKwh = useMemo(
    () => yearReadings.reduce((acc, r) => acc + r.totalKwh, 0),
    [yearReadings]
  );

  // Classifica combinazioni NeaSmart ordinate dal consumo medio più basso al più alto
  const combinationRanking = useMemo(() => {
    interface ComboBucket {
      key: string;
      mode: ClimateMode;
      startTime: string;
      endTime: string;
      targetTemp: number;
      rooms: RoomId[];
      totalKwh: number;
      totalCostEur: number;
      daysCount: number;
      months: Set<string>;
      sampleDate: string;
    }

    const buckets = new Map<string, ComboBucket>();

    for (const log of climateLogs) {
      if (!log.date.startsWith(`${selectedYear}-`)) continue;
      if (rankingFilter !== 'all' && log.mode !== rankingFilter) continue;
      const reading = readingsByDate.get(log.date);
      if (!reading) continue;

      const sortedRooms = [...log.rooms].sort();
      const key = `${log.mode}|${log.startTime}-${log.endTime}|${log.targetTemp.toFixed(1)}|${sortedRooms.join(',')}`;
      const mIdx = Number(log.date.slice(5, 7)) - 1;
      const mLabel = MONTHS_SHORT_IT[mIdx] || '';

      const existing = buckets.get(key);
      if (existing) {
        existing.totalKwh += reading.totalKwh;
        existing.totalCostEur += reading.estimatedCostEur;
        existing.daysCount += 1;
        if (mLabel) existing.months.add(mLabel);
      } else {
        buckets.set(key, {
          key,
          mode: log.mode,
          startTime: log.startTime,
          endTime: log.endTime,
          targetTemp: log.targetTemp,
          rooms: sortedRooms,
          totalKwh: reading.totalKwh,
          totalCostEur: reading.estimatedCostEur,
          daysCount: 1,
          months: new Set(mLabel ? [mLabel] : []),
          sampleDate: log.date,
        });
      }
    }

    return Array.from(buckets.values())
      .map((b) => ({
        ...b,
        avgKwh: b.totalKwh / b.daysCount,
        avgCostEur: b.totalCostEur / b.daysCount,
        monthsList: Array.from(b.months),
      }))
      .sort((a, b) => a.avgKwh - b.avgKwh);
  }, [climateLogs, selectedYear, rankingFilter, readingsByDate]);

  // Mappa ogni combinazione univoca dell'anno a una lettera (A, B, C...) con i 2 colori di modalità
  const comboMetaByKey = useMemo(() => {
    const map = new Map<string, { code: string; badgeClass: string }>();
    const entries: { key: string; mode: ClimateMode }[] = [];
    for (const c of combinationRanking) {
      if (!entries.some((e) => e.key === c.key)) {
        entries.push({ key: c.key, mode: c.mode });
      }
    }
    for (const log of climateLogs) {
      if (!log.date.startsWith(`${selectedYear}-`)) continue;
      const k = getComboKey(log);
      if (!entries.some((e) => e.key === k)) {
        entries.push({ key: k, mode: log.mode });
      }
    }
    entries.forEach((entry, idx) => {
      const code = String.fromCharCode(65 + (idx % 26)); // A, B, C...
      const badgeClass =
        entry.mode === 'riscaldamento'
          ? 'bg-amber-400 text-slate-950'
          : 'bg-cyan-400 text-slate-950';
      map.set(entry.key, { code, badgeClass });
    });
    return map;
  }, [combinationRanking, climateLogs, selectedYear]);

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

  return (
    <div className="space-y-6">
      {/* Header + Year + Real Import / Auto-Sync Config */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-100">
            Consumi Reali e-distribuzione
          </h2>
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
            {availableYears.map((yr) => {
              const yrCount = readings.filter((r) => r.date.startsWith(`${yr}-`)).length;
              return (
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
                  {yrCount > 0 ? ` (${yrCount})` : ''}
                </button>
              );
            })}
          </div>
        </div>
      </div>

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
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
              <span className="relative w-3 h-3 rounded-xs bg-slate-800 border-2 border-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]">
                <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
              </span>
              Riscaldamento ON
            </span>
            <span className="inline-flex items-center gap-1.5 text-cyan-300 font-medium">
              <span className="relative w-3 h-3 rounded-xs bg-slate-800 border-2 border-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]">
                <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-cyan-400" />
              </span>
              Raffrescamento ON
            </span>
            <span className="text-slate-700">|</span>
            <span className="inline-flex items-center gap-1.5 text-rose-300">
              <span className="relative w-3.5 h-3.5 rounded-xs bg-slate-800/80 border-2 border-dashed border-amber-400/80 overflow-hidden">
                <span className="absolute bottom-0 inset-x-0 h-[2.5px] bg-rose-400" />
              </span>
              1° Prima accensione
            </span>
            <span className="inline-flex items-center gap-1.5 text-amber-200">
              <span className="relative w-3.5 h-3.5 rounded-xs bg-slate-800/80 border-2 border-dotted border-amber-400/80 overflow-hidden">
                <span className="absolute bottom-0 inset-x-0 h-[2.5px] bg-amber-300" />
              </span>
              2° Assestamento
            </span>
            <span className="text-slate-700">|</span>
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
          <div className="min-w-[1120px] space-y-1.5">
            <div className="grid grid-cols-[44px_repeat(31,minmax(0,1fr))_64px] gap-1 text-[11px] font-mono text-slate-500 text-center pb-1">
              <div className="text-left">Mese</div>
              {Array.from({ length: 31 }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
              <div className="text-right pr-1 text-sky-400/90 font-semibold">
                Media
              </div>
            </div>

            {MONTHS_SHORT_IT.map((mLabel, mIdx) => {
              const daysCount = getDaysInMonth(selectedYear, mIdx);
              const mm = String(mIdx + 1).padStart(2, '0');
              const isSelectedMonth = selectedMonth === mIdx;
              const monthTotal = monthlyTotals[mIdx];

              return (
                <div
                  key={mLabel}
                  className="grid grid-cols-[44px_repeat(31,minmax(0,1fr))_64px] gap-1 items-center"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(mIdx)}
                    className={`text-left text-xs sm:text-sm font-medium px-1.5 py-1.5 rounded transition-colors ${
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
                      return <div key={dIdx} className="h-8 sm:h-9" />;
                    }
                    const iso = `${selectedYear}-${mm}-${String(dayNum).padStart(2, '0')}`;
                    const r = readingsByDate.get(iso);
                    const isPicked = selectedDayIso === iso;

                    const dayClimate = climateByDate.get(iso);
                    const hasClimate = Boolean(dayClimate && dayClimate.length > 0);
                    const climateMode = dayClimate?.[0]?.mode;
                    const dayPhase = phaseByDate.get(iso);
                    const comboMeta = dayClimate?.[0]
                      ? comboMetaByKey.get(getComboKey(dayClimate[0]))
                      : undefined;
                    const hasData = Boolean(r) || hasClimate;
                    const phaseLabel =
                      dayPhase === 'prima_accensione'
                        ? ' · 1° Prima accensione'
                        : dayPhase === 'assestamento'
                          ? ' · 2° Assestamento'
                          : dayPhase === 'a_regime'
                            ? ' · A regime'
                            : '';

                    return (
                      <button
                        key={dIdx}
                        type="button"
                        disabled={!hasData}
                        title={
                          r
                            ? `${formatReadingDate(iso)}: ${r.totalKwh.toFixed(2)} kWh (€ ${r.estimatedCostEur.toFixed(2)})${hasClimate ? ` · ${climateMode === 'riscaldamento' ? 'Riscaldamento ON' : 'Raffrescamento ON'}${comboMeta ? ` [Combo ${comboMeta.code}]` : ''}${phaseLabel}` : ''}`
                            : `${formatReadingDate(iso)}: nessun dato`
                        }
                        onClick={() => {
                          if (!hasData) return;
                          setSelectedMonth(mIdx);
                          setSelectedDayIso(iso);
                          setShowInlineForm(false);
                          setEditingLogId(null);
                        }}
                        className={`relative h-8 sm:h-9 rounded text-[10px] xl:text-[11px] leading-none tracking-tight font-mono tabular-nums flex items-center justify-center transition-transform ${
                          hasData
                            ? hasClimate
                              ? 'hover:scale-105 cursor-pointer font-bold opacity-100'
                              : 'hover:scale-105 cursor-pointer font-medium opacity-70 hover:opacity-100'
                            : 'cursor-default opacity-45'
                        } ${getHeatColor(
                          r?.totalKwh
                        )} ${
                          hasClimate
                            ? `${
                                dayPhase === 'prima_accensione'
                                  ? 'border-2 border-dashed'
                                  : dayPhase === 'assestamento'
                                    ? 'border-2 border-dotted'
                                    : 'border-2 border-solid'
                              } ${
                                climateMode === 'riscaldamento'
                                  ? 'border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)]'
                                  : 'border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                              }`
                            : 'border border-transparent'
                        } ${isPicked ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 z-10' : ''}`}
                      >
                        {r ? r.totalKwh.toFixed(1) : '·'}
                        {hasClimate && comboMeta && (
                          <span
                            className={`absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full ring-2 ring-slate-900 text-[8px] font-sans font-extrabold flex items-center justify-center leading-none ${comboMeta.badgeClass}`}
                          >
                            {comboMeta.code}
                          </span>
                        )}
                        {hasClimate && dayPhase === 'prima_accensione' && (
                          <span className="absolute bottom-0.5 inset-x-1 h-[2.5px] rounded-full bg-rose-400" />
                        )}
                        {hasClimate && dayPhase === 'assestamento' && (
                          <span className="absolute bottom-0.5 inset-x-1 h-[2.5px] rounded-full bg-amber-300" />
                        )}
                      </button>
                    );
                  })}

                  <div className="text-right pr-1 font-mono text-xs tabular-nums whitespace-nowrap">
                    {monthTotal.count > 0 ? (
                      <span className="text-sky-300 font-semibold">
                        {(monthTotal.kwh / monthTotal.count).toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="pt-2 mt-1 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">
                Media giornaliera {selectedYear} ({yearReadings.length} giorni)
              </span>
              <span className="text-sky-400 font-semibold tabular-nums pr-1">
                {yearReadings.length > 0
                  ? `${(annualTotalKwh / yearReadings.length).toFixed(1)} kWh/g`
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {selectedDayIso && (
          <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
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

            {(() => {
              const inlineFormElement = (
                <form
                  onSubmit={handleSaveInlineClimate}
                  className="bg-slate-950/90 border border-slate-700/80 rounded-lg p-3.5 space-y-3"
                >
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] text-slate-400">
                        Modalità
                      </label>
                      <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5">
                        <button
                          type="button"
                          onClick={() => setInlineMode('riscaldamento')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            inlineMode === 'riscaldamento'
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-slate-400 hover:text-slate-100'
                          }`}
                        >
                          <Flame className="w-3.5 h-3.5" />
                          Riscaldamento
                        </button>
                        <button
                          type="button"
                          onClick={() => setInlineMode('raffrescamento')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            inlineMode === 'raffrescamento'
                              ? 'bg-sky-500 text-slate-950'
                              : 'text-slate-400 hover:text-slate-100'
                          }`}
                        >
                          <Snowflake className="w-3.5 h-3.5" />
                          Raffrescamento
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] text-slate-400">
                        Dalle
                      </label>
                      <input
                        type="time"
                        value={inlineStartTime}
                        onChange={(e) => setInlineStartTime(e.target.value)}
                        required
                        className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] text-slate-400">
                        Alle
                      </label>
                      <input
                        type="time"
                        value={inlineEndTime}
                        onChange={(e) => setInlineEndTime(e.target.value)}
                        required
                        className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] text-slate-400">
                        Temp. (°C)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="15"
                        max="30"
                        value={inlineTargetTemp}
                        onChange={(e) => setInlineTargetTemp(e.target.value)}
                        required
                        className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                      />
                    </div>

                    <div className="flex-1 min-w-[160px] space-y-1">
                      <label className="block text-[11px] text-slate-400">
                        Note (opzionale)
                      </label>
                      <input
                        type="text"
                        value={inlineNotes}
                        onChange={(e) => setInlineNotes(e.target.value)}
                        placeholder="Es. prima accensione, ospiti..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 mr-1">
                        Stanze:
                      </span>
                      {HOME_ROOMS.map((room) => {
                        const active = inlineRooms.includes(room.id);
                        return (
                          <button
                            key={room.id}
                            type="button"
                            onClick={() => toggleInlineRoom(room.id)}
                            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                              active
                                ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-medium'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {room.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() =>
                          setInlineRooms(
                            inlineRooms.length === HOME_ROOMS.length
                              ? []
                              : HOME_ROOMS.map((r) => r.id)
                          )
                        }
                        className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 underline"
                      >
                        {inlineRooms.length === HOME_ROOMS.length
                          ? 'Nessuna'
                          : 'Tutte'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowInlineForm(false);
                          setEditingLogId(null);
                        }}
                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 rounded-lg"
                      >
                        Annulla
                      </button>
                      <button
                        type="submit"
                        disabled={inlineSaving || inlineRooms.length === 0}
                        className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        {inlineSaving
                          ? 'Salvataggio...'
                          : editingLogId
                            ? 'Aggiorna accensione'
                            : 'Salva accensione'}
                      </button>
                    </div>
                  </div>
                </form>
              );

              return (
                <>
                  {(climateByDate.get(selectedDayIso) || []).length > 0 ? (
                    <div className="space-y-2">
                      {(climateByDate.get(selectedDayIso) || []).map((log) =>
                        showInlineForm && editingLogId === log.id ? (
                          <div key={log.id}>{inlineFormElement}</div>
                        ) : (
                          <div
                            key={log.id}
                            className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                          >
                            <div className="flex flex-wrap items-center gap-2.5">
                              {log.mode === 'riscaldamento' ? (
                                <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                                  <Flame className="w-3.5 h-3.5" />
                                  Riscaldamento
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-medium text-sky-400">
                                  <Snowflake className="w-3.5 h-3.5" />
                                  Raffrescamento
                                </span>
                              )}
                              <span className="font-mono text-slate-200">
                                {log.startTime}–{log.endTime}
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="font-mono font-semibold text-slate-100">
                                {log.targetTemp.toFixed(1)} °C
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-300">
                                {log.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                              </span>
                              {phaseByDate.get(selectedDayIso) && (
                                <>
                                  <span className="text-slate-600">·</span>
                                  <span className="text-[11px] font-medium text-emerald-400">
                                    {phaseByDate.get(selectedDayIso) === 'prima_accensione'
                                      ? '1° giorno (Prima accensione)'
                                      : phaseByDate.get(selectedDayIso) === 'assestamento'
                                        ? '2° giorno (Assestamento)'
                                        : '3°+ giorno (A regime affidabile)'}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => copySessionFromLog(log)}
                                title="Copia combinazione (Ctrl+C)"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"
                              >
                                <Copy className="w-3 h-3" />
                                Copia
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditInlineForm(log)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-sky-400 hover:text-sky-300 hover:bg-slate-800 rounded transition-colors"
                              >
                                <Pencil className="w-3 h-3" />
                                Modifica
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteLog(log)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-slate-800 rounded transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                                Elimina
                              </button>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    !showInlineForm && (
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-400">
                        <span>
                          Nessuna accensione NeaSmart registrata per il{' '}
                          {formatReadingDate(selectedDayIso)}.
                        </span>
                        <div className="flex items-center gap-3">
                          {copiedSession && (
                            <button
                              type="button"
                              onClick={() => void pasteSessionToDay(selectedDayIso)}
                              title="Incolla combinazione copiata (Ctrl+V)"
                              className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap"
                            >
                              <ClipboardPaste className="w-3.5 h-3.5" />
                              Incolla ({formatReadingDate(copiedSession.sourceDate)})
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openNewInlineForm(selectedDayIso)}
                            className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-medium whitespace-nowrap"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Registra accensione NeaSmart
                          </button>
                        </div>
                      </div>
                    )
                  )}

                  {clipboardNotice && (
                    <div className="text-[11px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5">
                      {clipboardNotice}
                    </div>
                  )}

                  {showInlineForm && !editingLogId && inlineFormElement}
                </>
              );
            })()}
          </div>
        )}
      </section>

      {/* Classifica Combinazioni Migliori (minor consumo medio giornaliero) */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Classifica Combinazioni Migliori {selectedYear}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Ordinate dal minor consumo medio giornaliero: la #1 è la combinazione più conveniente.
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-lg bg-slate-950 border border-slate-800 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setRankingFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                rankingFilter === 'all'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Tutte
            </button>
            <button
              type="button"
              onClick={() => setRankingFilter('riscaldamento')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${
                rankingFilter === 'riscaldamento'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Flame className="w-3 h-3" />
              Riscaldamento
            </button>
            <button
              type="button"
              onClick={() => setRankingFilter('raffrescamento')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${
                rankingFilter === 'raffrescamento'
                  ? 'bg-cyan-400 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Snowflake className="w-3 h-3" />
              Raffrescamento
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-4">#</th>
                <th className="py-2.5 px-4">Modalità</th>
                <th className="py-2.5 px-4">Fascia Oraria</th>
                <th className="py-2.5 px-4 text-right">Temp.</th>
                <th className="py-2.5 px-4">Stanze</th>
                <th className="py-2.5 px-4">Periodo</th>
                <th className="py-2.5 px-4 text-right">Media Giornaliera</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {combinationRanking.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 px-4 text-center text-slate-500">
                    Nessuna combinazione con consumi reali disponibili per il {selectedYear}. Registra le accensioni NeaSmart sui giorni della mappa per confrontarle.
                  </td>
                </tr>
              ) : (
                combinationRanking.map((combo, idx) => {
                  const isBest = idx === 0;
                  const bestAvg = combinationRanking[0].avgKwh;
                  const diffKwh = combo.avgKwh - bestAvg;

                  return (
                    <tr
                      key={combo.key}
                      onClick={() => {
                        const mIdx = Number(combo.sampleDate.slice(5, 7)) - 1;
                        if (mIdx >= 0 && mIdx < 12) setSelectedMonth(mIdx);
                        setSelectedDayIso(combo.sampleDate);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isBest
                          ? 'bg-emerald-500/10 hover:bg-emerald-500/15'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {comboMetaByKey.get(combo.key) && (
                            <span
                              className={`w-5 h-5 rounded-full text-[10px] font-extrabold flex items-center justify-center shrink-0 ${
                                comboMetaByKey.get(combo.key)!.badgeClass
                              }`}
                            >
                              {comboMetaByKey.get(combo.key)!.code}
                            </span>
                          )}
                          {isBest ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-mono font-bold text-[11px]">
                              <Trophy className="w-3 h-3" />
                              #1 Migliore
                            </span>
                          ) : (
                            <span className="font-mono text-slate-400 font-semibold">
                              #{idx + 1}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {combo.mode === 'riscaldamento' ? (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                            <Flame className="w-3.5 h-3.5" />
                            Riscaldamento
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-cyan-400 font-medium">
                            <Snowflake className="w-3.5 h-3.5" />
                            Raffrescamento
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-200 tabular-nums whitespace-nowrap">
                        {combo.startTime}–{combo.endTime}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-100 tabular-nums whitespace-nowrap">
                        {combo.targetTemp.toFixed(1)} °C
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {combo.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                      </td>
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {combo.monthsList.join(', ')} ·{' '}
                        <span className="font-mono text-slate-300">
                          {combo.daysCount} {combo.daysCount === 1 ? 'giorno' : 'giorni'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            isBest ? 'text-emerald-300' : 'text-sky-400'
                          }`}
                        >
                          {combo.avgKwh.toFixed(2)} kWh/g
                        </span>
                        <span className="text-slate-500 ml-1.5">
                          (€ {combo.avgCostEur.toFixed(2)})
                        </span>
                        {!isBest && diffKwh > 0.05 && (
                          <span className="ml-2 text-[11px] text-rose-400/90">
                            +{diffKwh.toFixed(1)} kWh
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Registro Accensioni NeaSmart */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Accensioni NeaSmart {selectedYear}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Riepilogo giorni accesi, fascia oraria, temperatura, stanze e fase termica a confronto con i kWh reali.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('domotica')}
            className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap"
          >
            + Nuova accensione
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-4">Data</th>
                <th className="py-2.5 px-4">Modalità</th>
                <th className="py-2.5 px-4">Fascia Oraria</th>
                <th className="py-2.5 px-4 text-right">Temp.</th>
                <th className="py-2.5 px-4">Stanze</th>
                <th className="py-2.5 px-4">Fase</th>
                <th className="py-2.5 px-4 text-right">Consumo Reale</th>
                <th className="py-2.5 px-4 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {climateLogs
                .filter((l) => l.date.startsWith(`${selectedYear}-`))
                .sort((a, b) => b.date.localeCompare(a.date)).length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 px-4 text-center text-slate-500">
                    Nessuna accensione NeaSmart registrata nel {selectedYear}.
                  </td>
                </tr>
              ) : (
                climateLogs
                  .filter((l) => l.date.startsWith(`${selectedYear}-`))
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((log) => {
                    const dayReading = readingsByDate.get(log.date);
                    const phase = phaseByDate.get(log.date);
                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedDayIso(log.date)}
                        className="hover:bg-slate-800/40 cursor-pointer"
                      >
                        <td className="py-2.5 px-4 font-mono text-slate-200 tabular-nums whitespace-nowrap">
                          {formatReadingDate(log.date)}
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          {log.mode === 'riscaldamento' ? (
                            <span className="inline-flex items-center gap-1 text-amber-400">
                              <Flame className="w-3.5 h-3.5" />
                              Riscaldamento
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sky-400">
                              <Snowflake className="w-3.5 h-3.5" />
                              Raffrescamento
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                          {log.startTime}–{log.endTime}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-100 tabular-nums">
                          {log.targetTemp.toFixed(1)} °C
                        </td>
                        <td className="py-2.5 px-4 text-slate-300">
                          {log.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                        </td>
                        <td className="py-2.5 px-4 text-[11px] font-medium text-emerald-400 whitespace-nowrap">
                          {phase === 'prima_accensione'
                            ? 'Prima accensione'
                            : phase === 'assestamento'
                              ? 'Assestamento'
                              : phase === 'a_regime'
                                ? 'A regime'
                                : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {dayReading ? (
                            <span className="text-sky-400 font-semibold">
                              {dayReading.totalKwh.toFixed(2)} kWh
                              <span className="text-slate-500 font-normal">
                                {' '}
                                (€ {dayReading.estimatedCostEur.toFixed(2)})
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteLog(log);
                            }}
                            aria-label="Elimina accensione"
                            className="p-1 text-slate-500 hover:text-rose-400 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
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
                <th className="py-2.5 px-4">Clima NeaSmart (Fascia · °C · Stanze)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {monthDays.map(({ iso, reading }) => {
                const dayLogs = climateByDate.get(iso) || [];
                return (
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
                    <td className="py-2 px-4 text-slate-300">
                      {dayLogs.length > 0 ? (
                        <div className="space-y-0.5">
                          {dayLogs.map((log) => (
                            <div key={log.id} className="flex items-center gap-1.5 whitespace-nowrap">
                              {log.mode === 'riscaldamento' ? (
                                <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              ) : (
                                <Snowflake className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                              )}
                              <span className="font-mono text-slate-200">
                                {log.startTime}–{log.endTime}
                              </span>
                              <span className="text-slate-500">·</span>
                              <span className="font-mono font-medium text-slate-100">
                                {log.targetTemp.toFixed(0)}°C
                              </span>
                              <span className="text-slate-500">·</span>
                              <span className="text-slate-400 truncate max-w-[200px]">
                                {log.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                              </span>
                              {phaseByDate.get(iso) && (
                                <span className="text-[11px] text-emerald-400">
                                  ·{' '}
                                  {phaseByDate.get(iso) === 'prima_accensione'
                                    ? 'Prima accensione'
                                    : phaseByDate.get(iso) === 'assestamento'
                                      ? 'Assestamento'
                                      : 'A regime'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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

      {pendingDeleteLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Attenzione: conferma eliminazione
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Vuoi davvero eliminare l&apos;accensione{' '}
                  <span className="font-medium text-slate-100">
                    {pendingDeleteLog.mode === 'riscaldamento'
                      ? 'Riscaldamento'
                      : 'Raffrescamento'}
                  </span>{' '}
                  del{' '}
                  <span className="font-mono font-semibold text-slate-100">
                    {formatReadingDate(pendingDeleteLog.date)}
                  </span>{' '}
                  ({pendingDeleteLog.startTime}–{pendingDeleteLog.endTime} ·{' '}
                  {pendingDeleteLog.targetTemp.toFixed(1)} °C)?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={deletingLog}
                onClick={() => setPendingDeleteLog(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deletingLog}
                onClick={confirmDeleteClimateLog}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition-colors"
              >
                {deletingLog ? 'Eliminazione...' : 'Elimina definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
