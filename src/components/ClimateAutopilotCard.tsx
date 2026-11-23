import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Flame,
  Pencil,
  Power,
  PowerOff,
  Repeat,
  Snowflake,
} from 'lucide-react';
import {
  ClimateAutopilotConfig,
  ClimateMode,
  HOME_ROOMS,
  RoomId,
} from '../types/home';
import {
  formatAutopilotSummary,
  getLocalTodayIso,
} from '../utils/climateAutopilot';
import { formatReadingDate } from '../utils/edistribuzioneCsv';
import { isAllDaySession } from '../utils/climateTime';

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
  targetTemp: number;
  rooms: RoomId[];
  startDate: string;
  notes?: string;
}

interface ClimateAutopilotCardProps {
  autopilot: ClimateAutopilotConfig | null;
  readOnly?: boolean;
  onActivateAutopilot: (input: ClimateAutopilotInput) => Promise<void>;
  onTurnOffAutopilot: (removeTodayAutoSession: boolean) => Promise<void>;
}

export function ClimateAutopilotCard({
  autopilot,
  readOnly = false,
  onActivateAutopilot,
  onTurnOffAutopilot,
}: ClimateAutopilotCardProps) {
  const todayIso = getLocalTodayIso();
  const isActive = Boolean(autopilot?.active);

  const [showEditor, setShowEditor] = useState(false);
  const [mode, setMode] = useState<ClimateMode>(autopilot?.mode || 'riscaldamento');
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [startTime, setStartTime] = useState<string>(autopilot?.startTime || '09:00');
  const [endTime, setEndTime] = useState<string>(autopilot?.endTime || '20:00');
  const [targetTemp, setTargetTemp] = useState<string>(
    autopilot ? autopilot.targetTemp.toFixed(1) : '21.0'
  );
  const [rooms, setRooms] = useState<RoomId[]>(
    autopilot?.rooms?.length
      ? autopilot.rooms
      : ['salone', 'roberta', 'matrimoniale', 'maurizio']
  );
  const [notes, setNotes] = useState<string>(autopilot?.notes || '');
  const [saving, setSaving] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!showEditor && autopilot) {
      setMode(autopilot.mode);
      setStartTime(autopilot.startTime);
      setEndTime(autopilot.endTime);
      setTargetTemp(autopilot.targetTemp.toFixed(1));
      setRooms(autopilot.rooms);
      setNotes(autopilot.notes || '');
    }
  }, [autopilot, showEditor]);

  function openEditorForActivateOrEdit() {
    const base = autopilot;
    const defaultMode: ClimateMode =
      base?.mode ||
      (new Date().getMonth() + 1 >= 5 && new Date().getMonth() + 1 <= 9
        ? 'raffrescamento'
        : 'riscaldamento');
    setMode(defaultMode);
    setStartDate(todayIso);
    setStartTime(base?.startTime || '09:00');
    setEndTime(base?.endTime || '20:00');
    setTargetTemp(
      base ? base.targetTemp.toFixed(1) : defaultMode === 'raffrescamento' ? '25.0' : '21.0'
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rooms.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return;
    const tempNum = Number.parseFloat(targetTemp.replace(',', '.'));
    if (!Number.isFinite(tempNum) || tempNum < 14 || tempNum > 30) return;

    setSaving(true);
    setFeedback(null);
    try {
      await onActivateAutopilot({
        mode,
        startTime,
        endTime,
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

  async function handleQuickReenable() {
    if (!autopilot) return;
    setSaving(true);
    setFeedback(null);
    try {
      await onActivateAutopilot({
        mode: autopilot.mode,
        startTime: autopilot.startTime,
        endTime: autopilot.endTime,
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

  return (
    <section
      className={`rounded-xl border p-4 sm:p-5 space-y-4 transition-colors ${
        isActive
          ? autopilot?.mode === 'raffrescamento'
            ? 'bg-sky-500/10 border-sky-500/40'
            : 'bg-amber-500/10 border-amber-500/40'
          : 'bg-slate-900/75 border-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {isActive && autopilot ? (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide rounded-md border ${
                  autopilot.mode === 'raffrescamento'
                    ? 'bg-sky-500/20 text-sky-200 border-sky-400/50'
                    : 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                }`}
              >
                {autopilot.mode === 'raffrescamento' ? (
                  <Snowflake className="w-3.5 h-3.5" />
                ) : (
                  <Flame className="w-3.5 h-3.5" />
                )}
                Impianto Acceso · Copia Automatica Attiva
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide rounded-md border bg-slate-800 text-slate-300 border-slate-700">
                <PowerOff className="w-3.5 h-3.5 text-slate-400" />
                Impianto Spento
              </span>
            )}

            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Repeat className="w-3 h-3 text-sky-400" />
              Ripetizione automatica giornaliera
            </span>
          </div>

          {isActive && autopilot ? (
            <div className="space-y-0.5 pt-1">
              <div className="text-sm font-semibold text-slate-100">
                {formatAutopilotSummary(autopilot)}
              </div>
              <div className="text-xs text-slate-300">
                Stanze:{' '}
                <span className="text-slate-100 font-medium">
                  {autopilot.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                </span>{' '}
                · Attivo dal{' '}
                <span className="font-mono text-slate-200">
                  {formatReadingDate(autopilot.startDate)}
                </span>{' '}
                (applicato fino al{' '}
                <span className="font-mono text-emerald-300">
                  {formatReadingDate(autopilot.lastAppliedDate)}
                </span>
                )
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 pt-0.5">
              Imposta qui se hai acceso l&apos;impianto con una combinazione (orario, temperatura, stanze): verrà salvata oggi e copiata automaticamente ogni giorno successivo finché non la spegni o la modifichi.
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg"
                >
                  <Pencil className="w-3.5 h-3.5 text-sky-400" />
                  Modifica combinazione
                </button>
                <button
                  type="button"
                  disabled={saving || turningOff}
                  onClick={() => void handleTurnOff(false)}
                  title="Ferma la copia automatica da domani lasciando salvata la giornata di oggi"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 rounded-lg"
                >
                  <PowerOff className="w-3.5 h-3.5" />
                  Spegni da domani
                </button>
                <button
                  type="button"
                  disabled={saving || turningOff}
                  onClick={() => void handleTurnOff(true)}
                  title="Spegni l'impianto subito e rimuovi la sessione automatica di oggi"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-200 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 rounded-lg"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 rounded-lg"
                  >
                    <Power className="w-3.5 h-3.5" />
                    Riaccendi ultima ({autopilot.startTime}–{autopilot.endTime},{' '}
                    {autopilot.targetTemp.toFixed(0)}°C)
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={openEditorForActivateOrEdit}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
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
        <div className="bg-emerald-500/15 border border-emerald-500/35 rounded-lg px-3 py-2 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {showEditor && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-slate-950/85 border border-slate-800 rounded-xl p-4 space-y-3.5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="font-semibold text-slate-100">
              {isActive
                ? 'Modifica combinazione attiva (aggiorna dalla data scelta e copia nei giorni successivi)'
                : 'Accendi impianto e imposta combinazione giornaliera automatica'}
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMode('riscaldamento');
                  if (Number.parseFloat(targetTemp) > 23) setTargetTemp('21.0');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium ${
                  mode === 'riscaldamento'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
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
                    ? 'bg-sky-400 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Snowflake className="w-3.5 h-3.5" />
                Raffrescamento
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="block text-slate-400">Dal giorno (data inizio)</label>
              <input
                type="date"
                required
                value={startDate}
                max={todayIso}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 font-mono text-slate-100 bg-slate-900 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-slate-400">Dalle (ora)</label>
                <button
                  type="button"
                  onClick={() => {
                    if (isAllDaySession(startTime, endTime)) {
                      setStartTime('09:00');
                      setEndTime('20:00');
                    } else {
                      setStartTime('00:00');
                      setEndTime('24:00');
                    }
                  }}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    isAllDaySession(startTime, endTime)
                      ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  {isAllDaySession(startTime, endTime) ? '✓ 24h' : '24h'}
                </button>
              </div>
              {isAllDaySession(startTime, endTime) ? (
                <div className="w-full px-3 py-2 text-center text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg">
                  Tutto il giorno (24h)
                </div>
              ) : (
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 font-mono text-slate-100 bg-slate-900 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
                />
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Alle (ora)</label>
              {isAllDaySession(startTime, endTime) ? (
                <button
                  type="button"
                  onClick={() => {
                    setStartTime('09:00');
                    setEndTime('20:00');
                  }}
                  className="w-full px-3 py-2 text-slate-400 bg-slate-900 border border-slate-800 rounded-lg"
                >
                  Imposta fascia oraria
                </button>
              ) : (
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 font-mono text-slate-100 bg-slate-900 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
                />
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Temperatura (°C)</label>
              <input
                type="number"
                step="0.5"
                min="14"
                max="30"
                required
                value={targetTemp}
                onChange={(e) => setTargetTemp(e.target.value)}
                className="w-full px-3 py-2 font-mono text-slate-100 bg-slate-900 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-400">Stanze attive ({rooms.length} / 6)</label>
              <button
                type="button"
                onClick={() =>
                  setRooms(
                    rooms.length === HOME_ROOMS.length ? [] : HOME_ROOMS.map((r) => r.id)
                  )
                }
                className="text-[11px] text-sky-400 hover:text-sky-300"
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
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                          : 'bg-amber-500/20 border-amber-400 text-amber-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
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
              className="w-full sm:flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={() => setShowEditor(false)}
              className="px-3 py-2 text-slate-400 hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving || rooms.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg disabled:opacity-50"
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
