import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Droplets,
  Flame,
  Pencil,
  Plus,
  ShieldCheck,
  Snowflake,
  Thermometer,
  Trash2,
} from 'lucide-react';
import {
  AristonMode,
  AristonProfile,
  ClimateMode,
  ClimateSession,
  EnergyReading,
  HOME_ROOMS,
  HomeSystemConfig,
  NeaSmartFanSpeed,
  RoomId,
} from '../types/home';
import { formatReadingDate } from '../utils/edistribuzioneCsv';

interface DomoticsViewProps {
  config: HomeSystemConfig;
  readings: EnergyReading[];
  climateLogs: ClimateSession[];
  onUpdateConfig: (patch: Partial<HomeSystemConfig>) => Promise<void>;
  onAddClimateLog: (
    session: Omit<ClimateSession, 'id' | 'ownerId'>
  ) => Promise<void>;
  onUpdateClimateLog: (
    id: string,
    session: Omit<ClimateSession, 'id' | 'ownerId'>
  ) => Promise<void>;
  onDeleteClimateLog: (id: string) => Promise<void>;
}

const ARISTON_MODES: { value: AristonMode; label: string }[] = [
  { value: 'riscaldamento', label: 'Riscaldamento' },
  { value: 'raffrescamento', label: 'Raffrescamento' },
  { value: 'acs_solo', label: 'Solo ACS' },
  { value: 'spento', label: 'Spento' },
];

const ARISTON_PROFILES: { value: AristonProfile; label: string }[] = [
  { value: 'eco', label: 'Eco' },
  { value: 'comfort', label: 'Comfort' },
  { value: 'boost', label: 'Boost' },
];

const FAN_SPEEDS: { value: NeaSmartFanSpeed; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'bassa', label: 'Bassa' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
];

const ROOM_LABELS: Record<RoomId, string> = {
  salone: 'Salone',
  roberta: 'Roberta',
  bagno1: 'Bagno 1',
  matrimoniale: 'Matrimoniale',
  bagno2: 'Bagno 2',
  maurizio: 'Maurizio',
};

export function DomoticsView({
  config,
  readings,
  climateLogs,
  onUpdateConfig,
  onAddClimateLog,
  onUpdateClimateLog,
  onDeleteClimateLog,
}: DomoticsViewProps) {
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // NeaSmart session form state
  const [date, setDate] = useState('2026-11-18');
  const [mode, setMode] = useState<ClimateMode>('riscaldamento');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('20:00');
  const [targetTemp, setTargetTemp] = useState('21');
  const [selectedRooms, setSelectedRooms] = useState<RoomId[]>([
    'salone',
    'roberta',
    'matrimoniale',
    'maurizio',
  ]);
  const [notes, setNotes] = useState('');
  const [submittingLog, setSubmittingLog] = useState(false);

  // Stato modifica inline sulla riga della tabella + conferma eliminazione
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editMode, setEditMode] = useState<ClimateMode>('riscaldamento');
  const [editStartTime, setEditStartTime] = useState('09:00');
  const [editEndTime, setEditEndTime] = useState('20:00');
  const [editTemp, setEditTemp] = useState('21.0');
  const [editRooms, setEditRooms] = useState<RoomId[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingDeleteLog, setPendingDeleteLog] = useState<ClimateSession | null>(null);
  const [deletingLog, setDeletingLog] = useState(false);

  const readingsByDate = useMemo(() => {
    const map = new Map<string, EnergyReading>();
    for (const r of readings) {
      map.set(r.date, r);
    }
    return map;
  }, [readings]);

  const sortedLogs = useMemo(
    () => [...climateLogs].sort((a, b) => b.date.localeCompare(a.date)),
    [climateLogs]
  );

  async function applyChange(patch: Partial<HomeSystemConfig>) {
    setSaving(true);
    try {
      await onUpdateConfig(patch);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
    } finally {
      setSaving(false);
    }
  }

  function toggleRoom(roomId: RoomId) {
    setSelectedRooms((prev) =>
      prev.includes(roomId)
        ? prev.filter((r) => r !== roomId)
        : [...prev, roomId]
    );
  }

  async function handleSaveSession(e: React.FormEvent) {
    e.preventDefault();
    if (selectedRooms.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const tempNum = Number.parseFloat(targetTemp.replace(',', '.'));
    if (!Number.isFinite(tempNum) || tempNum < 14 || tempNum > 30) return;

    setSubmittingLog(true);
    try {
      await onAddClimateLog({
        date,
        mode,
        startTime,
        endTime,
        targetTemp: Math.round(tempNum * 10) / 10,
        rooms: selectedRooms,
        notes: notes.trim().slice(0, 240) || undefined,
      });
      setNotes('');
    } finally {
      setSubmittingLog(false);
    }
  }

  function startEditRow(log: ClimateSession) {
    setEditingId(log.id);
    setEditDate(log.date);
    setEditMode(log.mode);
    setEditStartTime(log.startTime);
    setEditEndTime(log.endTime);
    setEditTemp(log.targetTemp.toFixed(1));
    setEditRooms([...log.rooms]);
    setEditNotes(log.notes || '');
  }

  function toggleEditRoom(roomId: RoomId) {
    setEditRooms((prev) =>
      prev.includes(roomId)
        ? prev.filter((r) => r !== roomId)
        : [...prev, roomId]
    );
  }

  async function saveEditRow(logId: string) {
    if (editRooms.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(editDate)) return;
    const tempNum = Number.parseFloat(editTemp.replace(',', '.'));
    if (!Number.isFinite(tempNum) || tempNum < 14 || tempNum > 30) return;
    setSavingEdit(true);
    try {
      await onUpdateClimateLog(logId, {
        date: editDate,
        mode: editMode,
        startTime: editStartTime,
        endTime: editEndTime,
        targetTemp: Math.round(tempNum * 10) / 10,
        rooms: editRooms,
        notes: editNotes.trim().slice(0, 240) || undefined,
      });
      setEditingId(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDeleteRow() {
    if (!pendingDeleteLog) return;
    setDeletingLog(true);
    try {
      const id = pendingDeleteLog.id;
      if (editingId === id) setEditingId(null);
      await onDeleteClimateLog(id);
      setPendingDeleteLog(null);
    } finally {
      setDeletingLog(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            NeaSmart & Pompa di Calore Ariston
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Registro accensioni riscaldamento/raffrescamento per le 6 stanze correlato ai consumi reali e-distribuzione.
          </p>
        </div>
        {savedNotice && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            <span>Impostazioni salvate</span>
          </div>
        )}
      </div>

      {/* NeaSmart 6-Room Session Logger */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Registro Accensioni NeaSmart (6 Stanze)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Registra quando accendi riscaldamento o raffrescamento, fascia oraria, temperatura e stanze attive.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('riscaldamento')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
              onClick={() => setMode('raffrescamento')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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

        <form onSubmit={handleSaveSession} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">
                Data
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">
                Dalle (ora)
              </label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">
                Alle (ora)
              </label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">
                Temperatura (°C)
              </label>
              <input
                type="number"
                step="0.5"
                min="14"
                max="30"
                required
                value={targetTemp}
                onChange={(e) => setTargetTemp(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* 6 Rooms Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-300">
                Stanze attive ({selectedRooms.length} / 6)
              </label>
              <button
                type="button"
                onClick={() =>
                  setSelectedRooms(
                    selectedRooms.length === HOME_ROOMS.length
                      ? []
                      : HOME_ROOMS.map((r) => r.id)
                  )
                }
                className="text-[11px] text-sky-400 hover:text-sky-300"
              >
                {selectedRooms.length === HOME_ROOMS.length
                  ? 'Deseleziona tutte'
                  : 'Seleziona tutte'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {HOME_ROOMS.map((room) => {
                const active = selectedRooms.includes(room.id);
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => toggleRoom(room.id)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      active
                        ? mode === 'riscaldamento'
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                          : 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {room.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              maxLength={240}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Note opzionali (es. prima accensione invernale, deumidificatore attivo...)"
              className="flex-1 min-w-[220px] px-3 py-2 text-xs text-slate-100 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={submittingLog || selectedRooms.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {submittingLog ? 'Salvataggio...' : 'Salva accensione'}
            </button>
          </div>
        </form>

        {/* Sessions Table correlated with real e-distribuzione kWh */}
        <div className="pt-4 border-t border-slate-800 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                <th className="py-2 px-3">Data</th>
                <th className="py-2 px-3">Modalità</th>
                <th className="py-2 px-3">Fascia Oraria</th>
                <th className="py-2 px-3 text-right">Temp.</th>
                <th className="py-2 px-3">Stanze</th>
                <th className="py-2 px-3 text-right">Consumo Reale</th>
                <th className="py-2 px-3 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {sortedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 px-3 text-center text-slate-500">
                    Nessuna accensione NeaSmart registrata. Inserisci ad esempio il 18/11 (09:00–20:00, 21°C) per confrontarla subito con i tuoi kWh reali.
                  </td>
                </tr>
              ) : (
                sortedLogs.map((log) => {
                  const dayReading = readingsByDate.get(log.date);
                  if (editingId === log.id) {
                    return (
                      <tr key={log.id} className="bg-slate-950/90">
                        <td colSpan={7} className="p-3">
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                              />
                              <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5">
                                <button
                                  type="button"
                                  onClick={() => setEditMode('riscaldamento')}
                                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                                    editMode === 'riscaldamento'
                                      ? 'bg-amber-500 text-slate-950'
                                      : 'text-slate-400 hover:text-slate-100'
                                  }`}
                                >
                                  <Flame className="w-3.5 h-3.5" />
                                  Risc.
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditMode('raffrescamento')}
                                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                                    editMode === 'raffrescamento'
                                      ? 'bg-sky-500 text-slate-950'
                                      : 'text-slate-400 hover:text-slate-100'
                                  }`}
                                >
                                  <Snowflake className="w-3.5 h-3.5" />
                                  Raffr.
                                </button>
                              </div>
                              <input
                                type="time"
                                value={editStartTime}
                                onChange={(e) => setEditStartTime(e.target.value)}
                                className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                              />
                              <span className="text-slate-500">–</span>
                              <input
                                type="time"
                                value={editEndTime}
                                onChange={(e) => setEditEndTime(e.target.value)}
                                className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                              />
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  step="0.5"
                                  min="14"
                                  max="30"
                                  value={editTemp}
                                  onChange={(e) => setEditTemp(e.target.value)}
                                  className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                                />
                                <span className="text-slate-400 font-mono">°C</span>
                              </div>
                              <input
                                type="text"
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                placeholder="Note..."
                                className="flex-1 min-w-[140px] bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                              />
                              <div className="flex items-center gap-1.5 ml-auto">
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-100 rounded-lg"
                                >
                                  Annulla
                                </button>
                                <button
                                  type="button"
                                  disabled={savingEdit || editRooms.length === 0}
                                  onClick={() => void saveEditRow(log.id)}
                                  className="px-3 py-1 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors"
                                >
                                  {savingEdit ? 'Salvo...' : 'Salva'}
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-slate-400 mr-1">
                                Stanze:
                              </span>
                              {HOME_ROOMS.map((room) => {
                                const active = editRooms.includes(room.id);
                                return (
                                  <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => toggleEditRoom(room.id)}
                                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                      active
                                        ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-medium'
                                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    {room.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono text-slate-200 tabular-nums whitespace-nowrap">
                        {formatReadingDate(log.date)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
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
                      <td className="py-2.5 px-3 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {log.startTime}–{log.endTime}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-100 tabular-nums">
                        {log.targetTemp > 0 ? `${log.targetTemp.toFixed(1)} °C` : '? °C'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {log.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
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
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEditRow(log)}
                            aria-label="Modifica sessione"
                            title="Modifica"
                            className="p-1 text-slate-400 hover:text-sky-400 rounded"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteLog(log)}
                            aria-label="Elimina sessione"
                            title="Elimina"
                            className="p-1 text-slate-500 hover:text-rose-400 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ariston Heat Pump Panel */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Pompa di Calore Ariston
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Impianto radiante a pavimento e Acqua Calda Sanitaria
              </p>
            </div>
            <div>
              {config.aristonMode === 'raffrescamento' ? (
                <Snowflake className="w-5 h-5 text-sky-400" />
              ) : (
                <Flame className="w-5 h-5 text-amber-400" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Modalità operativa
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              {ARISTON_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const nextFlow =
                      m.value === 'raffrescamento'
                        ? Math.min(config.floorFlowTemp, 19)
                        : m.value === 'riscaldamento'
                          ? Math.max(config.floorFlowTemp, 32)
                          : config.floorFlowTemp;
                    applyChange({ aristonMode: m.value, floorFlowTemp: nextFlow });
                  }}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    config.aristonMode === m.value
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Profilo energetico
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              {ARISTON_PROFILES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={saving}
                  onClick={() => applyChange({ aristonProfile: p.value })}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    config.aristonProfile === p.value
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Temperatura mandata pavimento
              </span>
              <span className="font-mono font-semibold text-slate-100 tabular-nums">
                {config.floorFlowTemp} °C
              </span>
            </div>
            <input
              type="range"
              min={14}
              max={45}
              step={1}
              value={config.floorFlowTemp}
              onChange={(e) =>
                applyChange({ floorFlowTemp: Number(e.target.value) })
              }
              className="w-full accent-sky-400 cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Acqua Calda Sanitaria (ACS)
              </span>
              <span className="font-mono font-semibold text-slate-100 tabular-nums">
                {config.dhwTargetTemp} °C
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={60}
              step={1}
              value={config.dhwTargetTemp}
              onChange={(e) =>
                applyChange({ dhwTargetTemp: Number(e.target.value) })
              }
              className="w-full accent-sky-400 cursor-pointer"
            />
          </div>
        </section>

        {/* NeaSmart Dehumidifier Panel */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Deumidificatore NeaSmart
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Controllo igrometrico e sicurezza raffrescamento radiante
              </p>
            </div>
            <Droplets className="w-5 h-5 text-sky-400" />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium text-slate-100">
                Stato unità NeaSmart
              </div>
              <div className="text-xs text-slate-400">
                {config.neasmartPower
                  ? 'Deumidificazione attiva secondo setpoint'
                  : 'Unità spenta / in standby'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.neasmartPower}
              onClick={() => applyChange({ neasmartPower: !config.neasmartPower })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.neasmartPower ? 'bg-sky-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config.neasmartPower ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Umidità relativa target (UR)
              </span>
              <span className="font-mono font-semibold text-slate-100 tabular-nums">
                {config.neasmartTargetHumidity} %
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={65}
              step={1}
              value={config.neasmartTargetHumidity}
              onChange={(e) =>
                applyChange({ neasmartTargetHumidity: Number(e.target.value) })
              }
              className="w-full accent-sky-400 cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Velocità ventilazione
            </label>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              {FAN_SPEEDS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  disabled={saving}
                  onClick={() => applyChange({ neasmartFanSpeed: f.value })}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    config.neasmartFanSpeed === f.value
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-100">
                  Protezione Punto di Rugiada
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Mantiene attiva la deumidificazione durante il raffrescamento a pavimento.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.dewPointProtection}
              onClick={() =>
                applyChange({ dewPointProtection: !config.dewPointProtection })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                config.dewPointProtection ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config.dewPointProtection ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="pt-2 flex items-center gap-2 text-xs text-slate-500">
            <Thermometer className="w-4 h-4 shrink-0" />
            <span>Dati sincronizzati in tempo reale su Firestore.</span>
          </div>
        </section>
      </div>

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
                onClick={confirmDeleteRow}
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
