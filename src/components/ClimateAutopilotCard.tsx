import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Flame,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Repeat,
  Snowflake,
  Wind,
  X,
} from 'lucide-react';
import {
  ClimateAutopilotConfig,
  ClimateMode,
  ClimateSession,
  ClimateTimeSlot,
  HOME_ROOMS,
  RoomId,
} from '../types/home';
import {
  formatAutopilotSummary,
  getAutopilotSlots,
  getLocalTodayIso,
} from '../utils/climateAutopilot';
import { formatReadingDate } from '../utils/edistribuzioneCsv';
import {
  formatSlotsCompact,
  getDayEffectiveSlots,
  isAllDaySlots,
  normalizeTimeSlots,
} from '../utils/climateTime';

const ROOM_LABELS: Record<RoomId, string> = {
  salone: 'Salone',
  roberta: 'Roberta',
  bagno1: 'Bagno 1',
  matrimoniale: 'Matrimoniale',
  bagno2: 'Bagno 2',
  maurizio: 'Maurizio',
};

export interface ClimateAutopilotInput {
  mode: ClimateMode;
  startTime: string;
  endTime: string;
  timeSlots: ClimateTimeSlot[];
  vmcMax: boolean;
  targetTemp: number;
  rooms: RoomId[];
  startDate: string;
  notes?: string;
}

interface ClimateAutopilotCardProps {
  autopilot: ClimateAutopilotConfig | null;
  todaySessions?: ClimateSession[];
  todayVmcMax?: boolean;
  readOnly?: boolean;
  onActivateAutopilot: (input: ClimateAutopilotInput) => Promise<void>;
  onTurnOffAutopilot: (removeTodayAutoSession: boolean) => Promise<void>;
}

export function ClimateAutopilotCard({
  autopilot,
  todaySessions = [],
  todayVmcMax = false,
  readOnly = false,
  onActivateAutopilot,
  onTurnOffAutopilot,
}: ClimateAutopilotCardProps) {
  const todayIso = getLocalTodayIso();
  const isActive = Boolean(autopilot?.active);

  // Derive today's real active combination (so manual edits to today's log are reflected accurately in the banner)
  const effectiveTodayConfig = useMemo<ClimateAutopilotConfig | null>(() => {
    if (!autopilot) return null;
    if (!isActive || todaySessions.length === 0) return autopilot;
    const primary = todaySessions[0];
    const slots = getDayEffectiveSlots(todaySessions);
    const mergedRooms = Array.from(new Set(todaySessions.flatMap((s) => s.rooms)));
    const firstSlot = slots[0] || { startTime: primary.startTime, endTime: primary.endTime };
    const lastSlot = slots[slots.length - 1] || firstSlot;
    return {
      ...autopilot,
      mode: primary.mode,
      startTime: firstSlot.startTime,
      endTime: lastSlot.endTime,
      timeSlots: slots,
      vmcMax: Boolean(todayVmcMax || todaySessions.some((s) => s.vmcMax)),
      targetTemp: primary.targetTemp,
      rooms: mergedRooms.length > 0 ? mergedRooms : autopilot.rooms,
    };
  }, [autopilot, isActive, todaySessions, todayVmcMax]);

  const hasTodayMismatch = useMemo(() => {
    if (!isActive || !autopilot || !effectiveTodayConfig || todaySessions.length === 0) {
      return false;
    }
    const autoSlots = formatSlotsCompact(getAutopilotSlots(autopilot));
    const todaySlots = formatSlotsCompact(getAutopilotSlots(effectiveTodayConfig));
    const autoRooms = [...autopilot.rooms].sort().join(',');
    const todayRooms = [...effectiveTodayConfig.rooms].sort().join(',');
    return (
      autopilot.mode !== effectiveTodayConfig.mode ||
      autoSlots !== todaySlots ||
      Math.abs(autopilot.targetTemp - effectiveTodayConfig.targetTemp) >= 0.05 ||
      autoRooms !== todayRooms ||
      Boolean(autopilot.vmcMax) !== Boolean(effectiveTodayConfig.vmcMax)
    );
  }, [isActive, autopilot, effectiveTodayConfig, todaySessions.length]);

  const displayCfg = effectiveTodayConfig ?? autopilot;

  const [showEditor, setShowEditor] = useState(false);
  const [mode, setMode] = useState<ClimateMode>(displayCfg?.mode || 'riscaldamento');
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [timeSlots, setTimeSlots] = useState<ClimateTimeSlot[]>(
    displayCfg ? getAutopilotSlots(displayCfg) : [{ startTime: '09:00', endTime: '20:00' }]
  );
  const [vmcMax, setVmcMax] = useState<boolean>(Boolean(displayCfg?.vmcMax));
  const [targetTemp, setTargetTemp] = useState<string>(
    displayCfg ? displayCfg.targetTemp.toFixed(1) : '20.0'
  );
  const [rooms, setRooms] = useState<RoomId[]>(
    displayCfg?.rooms?.length
      ? displayCfg.rooms
      : ['salone', 'roberta', 'matrimoniale', 'maurizio']
  );
  const [notes, setNotes] = useState<string>(displayCfg?.notes || '');
  const [saving, setSaving] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!showEditor && displayCfg) {
      setMode(displayCfg.mode);
      setTimeSlots(getAutopilotSlots(displayCfg));
      setVmcMax(Boolean(displayCfg.vmcMax));
      setTargetTemp(displayCfg.targetTemp.toFixed(1));
      setRooms(displayCfg.rooms);
      setNotes(displayCfg.notes || '');
    }
  }, [displayCfg, showEditor]);

  function openEditorForActivateOrEdit() {
    const base = displayCfg;
    const defaultMode: ClimateMode =
      base?.mode ||
      (new Date().getMonth() + 1 >= 5 && new Date().getMonth() + 1 <= 9
        ? 'raffrescamento'
        : 'riscaldamento');
    setMode(defaultMode);
    setStartDate(todayIso);
    setTimeSlots(
      base ? getAutopilotSlots(base) : [{ startTime: '09:00', endTime: '20:00' }]
    );
    setVmcMax(Boolean(base?.vmcMax));
    setTargetTemp(
      base ? base.targetTemp.toFixed(1) : defaultMode === 'raffrescamento' ? '25.0' : '20.0'
    );
    setRooms(
      base?.rooms?.length ? base.rooms : ['salone', 'roberta', 'matrimoniale', 'maurizio']
    );
    setNotes(base?.notes || '');
    setShowEditor(true);
    setFeedback(null);
  }

  function toggleRoom(id: RoomId) {
    setRooms((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  }

  function updateSlot(index: number, patch: Partial<ClimateTimeSlot>) {
    setTimeSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot))
    );
  }

  function addExtraSlot() {
    setTimeSlots((prev) => {
      if (prev.length >= 6) return prev;
      const last = prev[prev.length - 1];
      const nextStart = last?.endTime && last.endTime < '22:00' ? '15:00' : '18:00';
      return [...prev, { startTime: nextStart, endTime: '20:00' }];
    });
  }

  function removeSlot(index: number) {
    setTimeSlots((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rooms.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return;
    const cleanedSlots = normalizeTimeSlots(timeSlots);
    if (cleanedSlots.length === 0) return;
    const tempNum = Number.parseFloat(targetTemp.replace(',', '.'));
    if (!Number.isFinite(tempNum) || tempNum < 14 || tempNum > 30) return;

    const first = cleanedSlots[0];
    const last = cleanedSlots[cleanedSlots.length - 1];

    setSaving(true);
    setFeedback(null);
    try {
      await onActivateAutopilot({
        mode,
        startTime: first.startTime,
        endTime: last.endTime,
        timeSlots: cleanedSlots,
        vmcMax,
        targetTemp: Math.round(tempNum * 10) / 10,
        rooms,
        startDate,
        notes: notes.trim() || undefined,
      });
      setShowEditor(false);
      setFeedback(
        `Impianto acceso dal ${formatReadingDate(startDate)}: questa combinazione verrà copiata automaticamente ogni giorno finché non spegni o modifichi.`
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncTodayToAutopilot() {
    if (!effectiveTodayConfig) return;
    const slots = getAutopilotSlots(effectiveTodayConfig);
    setSaving(true);
    setFeedback(null);
    try {
      await onActivateAutopilot({
        mode: effectiveTodayConfig.mode,
        startTime: slots[0].startTime,
        endTime: slots[slots.length - 1].endTime,
        timeSlots: slots,
        vmcMax: Boolean(effectiveTodayConfig.vmcMax),
        targetTemp: effectiveTodayConfig.targetTemp,
        rooms: effectiveTodayConfig.rooms,
        startDate: todayIso,
        notes: effectiveTodayConfig.notes,
      });
      setFeedback('Combinazione di oggi sincronizzata anche per tutti i giorni successivi.');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickReenable() {
    if (!autopilot) return;
    const slots = getAutopilotSlots(autopilot);
    setSaving(true);
    setFeedback(null);
    try {
      await onActivateAutopilot({
        mode: autopilot.mode,
        startTime: slots[0].startTime,
        endTime: slots[slots.length - 1].endTime,
        timeSlots: slots,
        vmcMax: Boolean(autopilot.vmcMax),
        targetTemp: autopilot.targetTemp,
        rooms: autopilot.rooms,
        startDate: todayIso,
        notes: autopilot.notes,
      });
      setFeedback(
        `Impianto riacceso da oggi (${formatReadingDate(todayIso)}) con la stessa combinazione.`
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTurnOff(removeToday: boolean) {
    setTurningOff(true);
    setFeedback(null);
    try {
      await onTurnOffAutopilot(removeToday);
      setShowEditor(false);
      setFeedback(
        removeToday
          ? 'Impianto spento e voce automatica di oggi rimossa. Nessuna copia nei prossimi giorni.'
          : 'Impianto spento: lo storico salvato resta intatto e da domani non verrà più copiata nessuna accensione.'
      );
    } finally {
      setTurningOff(false);
    }
  }

  const allDayActive = isAllDaySlots(timeSlots);

  return (
    <section
      className={`rounded-xl border p-4 sm:p-5 space-y-4 transition-colors ${
        isActive
          ? displayCfg?.mode === 'raffrescamento'
            ? 'bg-sky-50/90 dark:bg-sky-500/10 border-sky-300 dark:border-sky-500/40'
            : 'bg-amber-50/90 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40'
          : 'bg-white dark:bg-slate-900/75 border-slate-200 dark:border-slate-800 shadow-xs dark:shadow-none'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {isActive && displayCfg ? (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide rounded-md border ${
                  displayCfg.mode === 'raffrescamento'
                    ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-400/50'
                    : 'bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-400/50'
                }`}
              >
                {displayCfg.mode === 'raffrescamento' ? (
                  <Snowflake className="w-3.5 h-3.5" />
                ) : (
                  <Flame className="w-3.5 h-3.5" />
                )}
                Impianto Acceso · Copia Automatica Attiva
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide rounded-md border bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700">
                <PowerOff className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                Impianto Spento
              </span>
            )}

            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <Repeat className="w-3 h-3 text-sky-600 dark:text-sky-400" />
              Ripetizione automatica giornaliera
            </span>
          </div>

          {isActive && displayCfg ? (
            <div className="space-y-1 pt-1">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
                <span>{formatAutopilotSummary(displayCfg)}</span>
                {displayCfg.vmcMax && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-fuchsia-100 dark:bg-fuchsia-500/20 border border-fuchsia-300 dark:border-fuchsia-400/50 text-fuchsia-800 dark:text-fuchsia-200 rounded-md">
                    <Wind className="w-3 h-3" />
                    VMC al massimo
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Stanze:{' '}
                <span className="text-slate-900 dark:text-slate-100 font-medium">
                  {displayCfg.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                </span>{' '}
                · Attivo dal{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {formatReadingDate(displayCfg.startDate)}
                </span>{' '}
                (applicato fino al{' '}
                <span className="font-mono text-emerald-700 dark:text-emerald-300">
                  {formatReadingDate(displayCfg.lastAppliedDate)}
                </span>
                )
              </div>
              {hasTodayMismatch && !readOnly && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] text-amber-800 dark:text-amber-200">
                    Oggi ({formatReadingDate(todayIso)}) modificato rispetto alla copia automatica salvata ({autopilot?.targetTemp.toFixed(1)} °C):
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSyncTodayToAutopilot()}
                    className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 border border-emerald-300 dark:border-emerald-400/40 text-emerald-800 dark:text-emerald-200 rounded-md"
                  >
                    Copia quella di oggi anche da domani
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-400 pt-0.5">
              Imposta qui se hai acceso l&apos;impianto con una combinazione (orari singoli o multipli, temperatura, VMC Max, stanze): verrà salvata oggi e copiata automaticamente ogni giorno successivo finché non la spegni o la modifichi.
            </p>
          )}
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {isActive ? (
              <>
                <button
                  type="button"
                  disabled={saving || turningOff}
                  onClick={openEditorForActivateOrEdit}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg"
                >
                  <Pencil className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  Modifica combinazione
                </button>
                <button
                  type="button"
                  disabled={saving || turningOff}
                  onClick={() => void handleTurnOff(false)}
                  title="Ferma la copia automatica da domani lasciando salvata la giornata di oggi"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 border border-amber-300 dark:border-amber-500/35 rounded-lg"
                >
                  <PowerOff className="w-3.5 h-3.5" />
                  Spegni da domani
                </button>
                <button
                  type="button"
                  disabled={saving || turningOff}
                  onClick={() => void handleTurnOff(true)}
                  title="Spegni l'impianto subito e rimuovi la sessione automatica di oggi"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-200 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 border border-rose-200 dark:border-rose-500/35 rounded-lg"
                >
                  <PowerOff className="w-3.5 h-3.5" />
                  Spegni ora
                </button>
              </>
            ) : (
              <>
                {autopilot && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleQuickReenable()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 border border-emerald-200 dark:border-emerald-500/35 rounded-lg"
                  >
                    <Power className="w-3.5 h-3.5" />
                    Riaccendi ultima ({formatSlotsCompact(getAutopilotSlots(autopilot))},{' '}
                    {autopilot.targetTemp.toFixed(0)}°C)
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={openEditorForActivateOrEdit}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:text-slate-950 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-lg transition-colors"
                >
                  <Power className="w-3.5 h-3.5" />
                  Accendi con combinazione
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {feedback && (
        <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/35 rounded-lg px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {showEditor && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-slate-50 dark:bg-slate-950/85 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3.5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {isActive
                ? 'Modifica combinazione attiva (aggiorna dalla data scelta e copia nei giorni successivi)'
                : 'Accendi impianto e imposta combinazione giornaliera automatica'}
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMode('riscaldamento');
                  if (Number.parseFloat(targetTemp) > 23) setTargetTemp('20.0');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium ${
                  mode === 'riscaldamento'
                    ? 'bg-amber-500 text-slate-950 dark:bg-amber-400 dark:text-slate-950 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                Riscaldamento
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('raffrescamento');
                  if (Number.parseFloat(targetTemp) < 23) setTargetTemp('25.0');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium ${
                  mode === 'raffrescamento'
                    ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <Snowflake className="w-3.5 h-3.5" />
                Raffrescamento
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-slate-600 dark:text-slate-400">Dal giorno (data inizio)</label>
              <input
                type="date"
                required
                value={startDate}
                max={todayIso}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 font-mono text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-600 dark:text-slate-400">Temperatura (°C)</label>
              <input
                type="number"
                step="0.5"
                min="14"
                max="30"
                required
                value={targetTemp}
                onChange={(e) => setTargetTemp(e.target.value)}
                className="w-full px-3 py-2 font-mono text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-600 dark:text-slate-400">Ventilazione Meccanica (VMC)</label>
              <button
                type="button"
                onClick={() => setVmcMax((v) => !v)}
                className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-semibold transition-colors ${
                  vmcMax
                    ? 'bg-fuchsia-100 dark:bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-800 dark:text-fuchsia-200'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Wind className="w-3.5 h-3.5" />
                {vmcMax ? 'VMC al massimo: ATTIVA' : 'VMC normale (clicca per Max)'}
              </button>
            </div>
          </div>

          {/* Multi-slot fasce orarie */}
          <div className="space-y-2 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-700 dark:text-slate-300 font-medium">
                Fasce orarie giornaliere (puoi aggiungere più accensioni interrotte, es. 09:00–12:00 e 15:00–20:00)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (allDayActive) {
                      setTimeSlots([{ startTime: '09:00', endTime: '20:00' }]);
                    } else {
                      setTimeSlots([{ startTime: '00:00', endTime: '24:00' }]);
                    }
                  }}
                  className={`text-[11px] px-2 py-1 rounded border font-medium ${
                    allDayActive
                      ? 'bg-sky-50 dark:bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {allDayActive ? '✓ Tutto il giorno (24h)' : 'Tutto il giorno (24h)'}
                </button>
                {!allDayActive && timeSlots.length < 6 && (
                  <button
                    type="button"
                    onClick={addExtraSlot}
                    className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border bg-sky-50 dark:bg-sky-500/15 border-sky-300 dark:border-sky-400/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/25 font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    Aggiungi fascia
                  </button>
                )}
              </div>
            </div>

            {allDayActive ? (
              <div className="px-3 py-2 text-center text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 rounded-lg font-medium">
                Impianto acceso tutto il giorno (24h)
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {timeSlots.map((slot, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                      #{idx + 1}
                    </span>
                    <input
                      type="time"
                      required
                      value={slot.startTime}
                      onChange={(e) => updateSlot(idx, { startTime: e.target.value })}
                      className="flex-1 min-w-0 px-1.5 py-1 font-mono text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-slate-400 dark:text-slate-500">→</span>
                    <input
                      type="time"
                      required
                      value={slot.endTime}
                      onChange={(e) => updateSlot(idx, { endTime: e.target.value })}
                      className="flex-1 min-w-0 px-1.5 py-1 font-mono text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                    />
                    {timeSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSlot(idx)}
                        aria-label={`Rimuovi fascia ${idx + 1}`}
                        className="p-1 text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-600 dark:text-slate-400">Stanze attive ({rooms.length} / 6)</label>
              <button
                type="button"
                onClick={() =>
                  setRooms(
                    rooms.length === HOME_ROOMS.length ? [] : HOME_ROOMS.map((r) => r.id)
                  )
                }
                className="text-[11px] text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                {rooms.length === HOME_ROOMS.length ? 'Deseleziona tutte' : 'Seleziona tutte'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {HOME_ROOMS.map((r) => {
                const selected = rooms.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRoom(r.id)}
                    className={`px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                      selected
                        ? mode === 'raffrescamento'
                          ? 'bg-sky-50 dark:bg-sky-500/20 border-sky-400 text-sky-800 dark:text-sky-200'
                          : 'bg-amber-50 dark:bg-amber-500/20 border-amber-400 text-amber-900 dark:text-amber-200'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              type="text"
              maxLength={200}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Note opzionali (es. modalità invernale fissa, piano giorno...)"
              className="w-full sm:flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={() => setShowEditor(false)}
              className="px-3 py-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving || rooms.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 dark:text-slate-950 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg disabled:opacity-50"
            >
              <Power className="w-3.5 h-3.5" />
              {saving
                ? 'Salvataggio...'
                : isActive
                  ? 'Aggiorna combinazione attiva'
                  : 'Accendi & Copia ogni giorno'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
