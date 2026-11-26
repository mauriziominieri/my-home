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
  Wind,
  X,
} from 'lucide-react';
import {
  AristonMode,
  AristonProfile,
  ClimateAutopilotConfig,
  ClimateMode,
  ClimateSession,
  ClimateTimeSlot,
  EnergyReading,
  HOME_ROOMS,
  HomeSystemConfig,
  NeaSmartFanSpeed,
  RoomId,
} from '../types/home';
import {
  ClimateAutopilotCard,
  ClimateAutopilotInput,
} from './ClimateAutopilotCard';
import { getLocalTodayIso } from '../utils/climateAutopilot';
import { formatReadingDate } from '../utils/edistribuzioneCsv';
import {
  formatDurationCompact,
  formatSlotsCompact,
  formatSlotsSummary,
  formatTimeSlotString,
  getSessionTimeSlots,
  getTotalSlotsDurationHours,
  isAllDaySlots,
  isVmcMaxForDate,
  normalizeTimeSlots,
} from '../utils/climateTime';
import {
  compareSortValues,
  SortableTh,
  SortState,
  toggleSort,
} from './SortableHeader';
import { AccessUnlockBanner } from './AccessUnlockBanner';

interface DomoticsViewProps {
  config: HomeSystemConfig;
  readings: EnergyReading[];
  climateLogs: ClimateSession[];
  vmcDaysMap?: Map<string, boolean>;
  climateAutopilot?: ClimateAutopilotConfig | null;
  readOnly?: boolean;
  onSignIn?: () => void;
  onUpdateConfig: (patch: Partial<HomeSystemConfig>) => Promise<void>;
  onActivateAutopilot?: (input: ClimateAutopilotInput) => Promise<void>;
  onTurnOffAutopilot?: (removeTodayAutoSession: boolean) => Promise<void>;
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
  vmcDaysMap,
  climateAutopilot = null,
  readOnly = false,
  onSignIn,
  onUpdateConfig,
  onActivateAutopilot,
  onTurnOffAutopilot,
  onAddClimateLog,
  onUpdateClimateLog,
  onDeleteClimateLog,
}: DomoticsViewProps) {
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const todayIso = getLocalTodayIso();
  const todaySessions = useMemo(
    () => climateLogs.filter((l) => l.date === todayIso),
    [climateLogs, todayIso]
  );
  const todayVmcMax = useMemo(
    () => isVmcMaxForDate(todayIso, vmcDaysMap, todaySessions),
    [todayIso, vmcDaysMap, todaySessions]
  );

  // NeaSmart session form state
  const [date, setDate] = useState(todayIso);
  const [mode, setMode] = useState<ClimateMode>('riscaldamento');
  const [timeSlots, setTimeSlots] = useState<ClimateTimeSlot[]>([
    { startTime: '09:00', endTime: '20:00' },
  ]);
  const [vmcMax, setVmcMax] = useState(false);
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
  const [editTimeSlots, setEditTimeSlots] = useState<ClimateTimeSlot[]>([
    { startTime: '09:00', endTime: '20:00' },
  ]);
  const [editVmcMax, setEditVmcMax] = useState(false);
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

  type DomoticsSortKey = 'date' | 'mode' | 'time' | 'targetTemp' | 'rooms' | 'totalKwh';
  const [domoticsSort, setDomoticsSort] = useState<SortState<DomoticsSortKey>>({
    key: 'date',
    dir: 'desc',
  });

  const sortedLogs = useMemo(() => {
    return [...climateLogs].sort((a, b) => {
      const aSlots = getSessionTimeSlots(a);
      const bSlots = getSessionTimeSlots(b);
      switch (domoticsSort.key) {
        case 'date':
          return compareSortValues(a.date, b.date, domoticsSort.dir);
        case 'mode':
          return compareSortValues(a.mode, b.mode, domoticsSort.dir);
        case 'time':
          return compareSortValues(
            isAllDaySlots(aSlots) ? '00:00-24:00' : formatSlotsCompact(aSlots),
            isAllDaySlots(bSlots) ? '00:00-24:00' : formatSlotsCompact(bSlots),
            domoticsSort.dir
          );
        case 'targetTemp':
          return compareSortValues(
            a.targetTemp > 0 ? a.targetTemp : null,
            b.targetTemp > 0 ? b.targetTemp : null,
            domoticsSort.dir
          );
        case 'rooms':
          return compareSortValues(
            a.rooms.map((r) => ROOM_LABELS[r] || r).join(', '),
            b.rooms.map((r) => ROOM_LABELS[r] || r).join(', '),
            domoticsSort.dir
          );
        case 'totalKwh':
          return compareSortValues(
            readingsByDate.get(a.date)?.totalKwh ?? null,
            readingsByDate.get(b.date)?.totalKwh ?? null,
            domoticsSort.dir
          );
      }
    });
  }, [climateLogs, domoticsSort, readingsByDate]);

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

  function updateSlot(idx: number, patch: Partial<ClimateTimeSlot>) {
    setTimeSlots((prev) =>
      prev.map((slot, i) => (i === idx ? { ...slot, ...patch } : slot))
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

  function removeSlot(idx: number) {
    setTimeSlots((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  function updateEditSlot(idx: number, patch: Partial<ClimateTimeSlot>) {
    setEditTimeSlots((prev) =>
      prev.map((slot, i) => (i === idx ? { ...slot, ...patch } : slot))
    );
  }

  function addEditExtraSlot() {
    setEditTimeSlots((prev) => {
      if (prev.length >= 6) return prev;
      const last = prev[prev.length - 1];
      const nextStart = last?.endTime && last.endTime < '22:00' ? '15:00' : '18:00';
      return [...prev, { startTime: nextStart, endTime: '20:00' }];
    });
  }

  function removeEditSlot(idx: number) {
    setEditTimeSlots((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  async function handleSaveSession(e: React.FormEvent) {
    e.preventDefault();
    if (selectedRooms.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const cleanedSlots = normalizeTimeSlots(timeSlots);
    if (cleanedSlots.length === 0) return;
    const tempNum = Number.parseFloat(targetTemp.replace(',', '.'));
    if (!Number.isFinite(tempNum) || tempNum < 14 || tempNum > 30) return;

    const first = cleanedSlots[0];
    const last = cleanedSlots[cleanedSlots.length - 1];

    setSubmittingLog(true);
    try {
      await onAddClimateLog({
        date,
        mode,
        startTime: first.startTime,
        endTime: last.endTime,
        timeSlots:
          cleanedSlots.length > 1
            ? cleanedSlots.map(formatTimeSlotString)
            : undefined,
        vmcMax,
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
    setEditTimeSlots(getSessionTimeSlots(log));
    setEditVmcMax(isVmcMaxForDate(log.date, vmcDaysMap, [log]));
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
    const cleanedSlots = normalizeTimeSlots(editTimeSlots);
    if (cleanedSlots.length === 0) return;
    const tempNum = Number.parseFloat(editTemp.replace(',', '.'));
    if (!Number.isFinite(tempNum) || tempNum < 14 || tempNum > 30) return;

    const first = cleanedSlots[0];
    const last = cleanedSlots[cleanedSlots.length - 1];

    setSavingEdit(true);
    try {
      await onUpdateClimateLog(logId, {
        date: editDate,
        mode: editMode,
        startTime: first.startTime,
        endTime: last.endTime,
        timeSlots:
          cleanedSlots.length > 1
            ? cleanedSlots.map(formatTimeSlotString)
            : undefined,
        vmcMax: editVmcMax,
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            NeaSmart & Pompa di Calore Ariston
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Registro accensioni riscaldamento/raffrescamento per le 6 stanze correlato ai consumi reali e-distribuzione.
          </p>
        </div>
        {savedNotice && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            <span>Impostazioni salvate</span>
          </div>
        )}
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Clima & Domotica"
        unlockedFeatures={[
          'Modifica impostazioni Ariston, deumidificatore NeaSmart e tariffa kWh',
          'Imposta o spegni l’Autopilot Clima giornaliero con copia automatica',
          'Registra, modifica o elimina sessioni clima per le 6 stanze',
        ]}
      />

      {onActivateAutopilot && onTurnOffAutopilot && (
        <ClimateAutopilotCard
          autopilot={climateAutopilot}
          todaySessions={todaySessions}
          todayVmcMax={todayVmcMax}
          readOnly={readOnly}
          onActivateAutopilot={onActivateAutopilot}
          onTurnOffAutopilot={onTurnOffAutopilot}
        />
      )}

      {/* NeaSmart 6-Room Session Logger */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Registro Accensioni NeaSmart (6 Stanze)
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Registra quando accendi riscaldamento o raffrescamento, fascia oraria, temperatura e stanze attive.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('riscaldamento')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'riscaldamento'
                  ? 'bg-orange-600 text-white dark:bg-orange-500/25 dark:text-orange-200 dark:border dark:border-orange-400/50'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
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
                  ? 'bg-sky-600 text-white dark:bg-sky-400 dark:text-slate-950'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Snowflake className="w-3.5 h-3.5" />
              Raffrescamento
            </button>
          </div>
        </div>

        {!readOnly && (() => {
          const allDayForm = isAllDaySlots(timeSlots);
          return (
        <form onSubmit={handleSaveSession} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Data
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
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
                className="w-full px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Ventilazione Meccanica (VMC)
              </label>
              <button
                type="button"
                onClick={() => setVmcMax((v) => !v)}
                className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                  vmcMax
                    ? 'bg-fuchsia-100 dark:bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-800 dark:text-fuchsia-200'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Wind className="w-3.5 h-3.5" />
                {vmcMax ? 'VMC al massimo: ATTIVA' : 'VMC normale (clicca per Max)'}
              </button>
            </div>
          </div>

          {/* Multi-slot fasce orarie */}
          <div className="space-y-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Fasce Orarie (aggiungi più fasce se hai interrotto e riacceso, es. 09:00–12:00 e 15:00–20:00)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (allDayForm) {
                      setTimeSlots([{ startTime: '09:00', endTime: '20:00' }]);
                    } else {
                      setTimeSlots([{ startTime: '00:00', endTime: '24:00' }]);
                    }
                  }}
                  className={`text-[10px] px-2 py-1 rounded border font-medium transition-colors ${
                    allDayForm
                      ? 'bg-sky-100 dark:bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300'
                      : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {allDayForm ? '✓ 24h Attivo' : 'Tutto il giorno (24h)'}
                </button>
                {!allDayForm && timeSlots.length < 6 && (
                  <button
                    type="button"
                    onClick={addExtraSlot}
                    className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded border bg-sky-50 dark:bg-sky-500/15 border-sky-300 dark:border-sky-400/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/25 font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    Aggiungi fascia
                  </button>
                )}
              </div>
            </div>

            {allDayForm ? (
              <div className="w-full px-3 py-2 text-xs font-medium text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 rounded-lg text-center">
                Tutto il giorno (24h)
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {timeSlots.map((slot, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                      #{idx + 1}
                    </span>
                    <input
                      type="time"
                      required
                      value={slot.startTime}
                      onChange={(e) => updateSlot(idx, { startTime: e.target.value })}
                      className="flex-1 min-w-0 px-1.5 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-slate-500">→</span>
                    <input
                      type="time"
                      required
                      value={slot.endTime}
                      onChange={(e) => updateSlot(idx, { endTime: e.target.value })}
                      className="flex-1 min-w-0 px-1.5 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                    />
                    {timeSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSlot(idx)}
                        aria-label={`Rimuovi fascia ${idx + 1}`}
                        className="p-1 text-slate-500 hover:text-rose-500 dark:hover:text-rose-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 6 Rooms Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
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
                className="text-[11px] text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300"
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
                          ? 'bg-orange-50 dark:bg-orange-500/20 border-orange-300 dark:border-orange-500/50 text-orange-800 dark:text-orange-200'
                          : 'bg-sky-50 dark:bg-sky-500/20 border-sky-300 dark:border-sky-500/50 text-sky-800 dark:text-sky-200'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
              className="w-full sm:flex-1 min-w-0 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={submittingLog || selectedRooms.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-sky-600 hover:bg-sky-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {submittingLog ? 'Salvataggio...' : 'Salva accensione'}
            </button>
          </div>
        </form>
          );
        })()}

        {/* Sessions Table correlated with real e-distribuzione kWh */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                <SortableTh
                  sortKey="date"
                  currentSort={domoticsSort}
                  onSort={(k) => setDomoticsSort((prev) => toggleSort(prev, k, 'desc'))}
                  className="py-2 px-3"
                >
                  Data
                </SortableTh>
                <SortableTh
                  sortKey="mode"
                  currentSort={domoticsSort}
                  onSort={(k) => setDomoticsSort((prev) => toggleSort(prev, k, 'asc'))}
                  className="py-2 px-3"
                >
                  Modalità
                </SortableTh>
                <SortableTh
                  sortKey="time"
                  currentSort={domoticsSort}
                  onSort={(k) => setDomoticsSort((prev) => toggleSort(prev, k, 'asc'))}
                  className="py-2 px-3"
                >
                  Fascia Oraria
                </SortableTh>
                <SortableTh
                  sortKey="targetTemp"
                  currentSort={domoticsSort}
                  onSort={(k) => setDomoticsSort((prev) => toggleSort(prev, k, 'asc'))}
                  align="right"
                  className="py-2 px-3 text-right"
                >
                  Temp.
                </SortableTh>
                <SortableTh
                  sortKey="rooms"
                  currentSort={domoticsSort}
                  onSort={(k) => setDomoticsSort((prev) => toggleSort(prev, k, 'asc'))}
                  className="py-2 px-3"
                >
                  Stanze
                </SortableTh>
                <SortableTh
                  sortKey="totalKwh"
                  currentSort={domoticsSort}
                  onSort={(k) => setDomoticsSort((prev) => toggleSort(prev, k, 'desc'))}
                  align="right"
                  className="py-2 px-3 text-right"
                >
                  Consumo Reale
                </SortableTh>
                {!readOnly && <th className="py-2 px-3 text-right">Azioni</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70 text-xs">
              {sortedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 px-3 text-center text-slate-500">
                    Nessuna accensione NeaSmart registrata. Inserisci ad esempio il 18/11 (09:00–20:00, 21°C) per confrontarla subito con i tuoi kWh reali.
                  </td>
                </tr>
              ) : (
                sortedLogs.map((log) => {
                  const dayReading = readingsByDate.get(log.date);
                  const slots = getSessionTimeSlots(log);
                  const durationStr = formatDurationCompact(
                    getTotalSlotsDurationHours(slots)
                  );
                  const rowVmcMax = isVmcMaxForDate(log.date, vmcDaysMap, [log]);
                  if (editingId === log.id) {
                    const allDayEdit = isAllDaySlots(editTimeSlots);
                    return (
                      <tr key={log.id} className="bg-slate-50 dark:bg-slate-950/90">
                        <td colSpan={7} className="p-3">
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                              />
                              <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-0.5">
                                <button
                                  type="button"
                                  onClick={() => setEditMode('riscaldamento')}
                                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                                    editMode === 'riscaldamento'
                                      ? 'bg-orange-600 text-white dark:bg-orange-500/25 dark:text-orange-200'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
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
                                      ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                                  }`}
                                >
                                  <Snowflake className="w-3.5 h-3.5" />
                                  Raffr.
                                </button>
                              </div>
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  step="0.5"
                                  min="14"
                                  max="30"
                                  value={editTemp}
                                  onChange={(e) => setEditTemp(e.target.value)}
                                  className="w-16 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                                />
                                <span className="text-slate-500 dark:text-slate-400 font-mono">°C</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditVmcMax((v) => !v)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border font-semibold transition-colors ${
                                  editVmcMax
                                    ? 'bg-fuchsia-100 dark:bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-800 dark:text-fuchsia-200'
                                    : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                              >
                                <Wind className="w-3.5 h-3.5" />
                                {editVmcMax ? 'VMC Max: SÌ' : 'VMC normale'}
                              </button>
                              <input
                                type="text"
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                placeholder="Note..."
                                className="flex-1 min-w-[140px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                              />
                              <div className="flex items-center gap-1.5 ml-auto">
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg"
                                >
                                  Annulla
                                </button>
                                <button
                                  type="button"
                                  disabled={savingEdit || editRooms.length === 0}
                                  onClick={() => void saveEditRow(log.id)}
                                  className="px-3 py-1 text-xs font-semibold text-white dark:text-slate-950 bg-sky-600 hover:bg-sky-700 dark:bg-sky-400 dark:hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors"
                                >
                                  {savingEdit ? 'Salvo...' : 'Salva'}
                                </button>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (allDayEdit) {
                                    setEditTimeSlots([{ startTime: '09:00', endTime: '20:00' }]);
                                  } else {
                                    setEditTimeSlots([{ startTime: '00:00', endTime: '24:00' }]);
                                  }
                                }}
                                className={`px-2 py-1 text-xs rounded-lg border font-medium transition-colors ${
                                  allDayEdit
                                    ? 'bg-sky-100 dark:bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300'
                                    : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                              >
                                Tutto il giorno (24h)
                              </button>
                              {!allDayEdit &&
                                editTimeSlots.map((slot, idx) => (
                                  <div
                                    key={idx}
                                    className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-1"
                                  >
                                    <span className="text-[10px] font-mono text-slate-500">
                                      #{idx + 1}
                                    </span>
                                    <input
                                      type="time"
                                      value={slot.startTime}
                                      onChange={(e) =>
                                        updateEditSlot(idx, { startTime: e.target.value })
                                      }
                                      className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded px-1.5 py-0.5 text-xs font-mono text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                                    />
                                    <span className="text-slate-500">–</span>
                                    <input
                                      type="time"
                                      value={slot.endTime}
                                      onChange={(e) =>
                                        updateEditSlot(idx, { endTime: e.target.value })
                                      }
                                      className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded px-1.5 py-0.5 text-xs font-mono text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                                    />
                                    {editTimeSlots.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => removeEditSlot(idx)}
                                        aria-label={`Rimuovi fascia ${idx + 1}`}
                                        className="p-0.5 text-slate-500 hover:text-rose-500 dark:hover:text-rose-400"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              {!allDayEdit && editTimeSlots.length < 6 && (
                                <button
                                  type="button"
                                  onClick={addEditExtraSlot}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border bg-sky-50 dark:bg-sky-500/15 border-sky-300 dark:border-sky-400/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/25 font-medium"
                                >
                                  <Plus className="w-3 h-3" />
                                  Aggiungi fascia
                                </button>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-slate-600 dark:text-slate-400 mr-1">
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
                                        ? 'bg-sky-100 dark:bg-sky-500/20 border-sky-400 text-sky-800 dark:text-sky-200 font-medium'
                                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono text-slate-800 dark:text-slate-200 tabular-nums whitespace-nowrap">
                        {formatReadingDate(log.date)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {log.mode === 'riscaldamento' ? (
                          <span className="inline-flex items-center gap-1 text-orange-600 dark:text-amber-400 font-medium">
                            <Flame className="w-3.5 h-3.5" />
                            Riscaldamento
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 font-medium">
                            <Snowflake className="w-3.5 h-3.5" />
                            Raffrescamento
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {isAllDaySlots(slots) ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 text-[11px] font-medium">
                              <Clock className="w-3 h-3" />
                              Tutto il giorno · 24h
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 font-mono">
                              <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                              <span>{formatSlotsSummary(slots)}</span>
                              {durationStr && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                  {durationStr}
                                </span>
                              )}
                            </span>
                          )}
                          {rowVmcMax && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-fuchsia-100 dark:bg-fuchsia-500/20 border border-fuchsia-300 dark:border-fuchsia-400/50 text-fuchsia-800 dark:text-fuchsia-200 text-[10px] font-semibold">
                              <Wind className="w-2.5 h-2.5" />
                              VMC Max
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                        {log.targetTemp > 0 ? `${log.targetTemp.toFixed(1)} °C` : '? °C'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {log.rooms.map((r) => ROOM_LABELS[r] || r).join(', ')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {dayReading ? (
                          <span className="text-sky-600 dark:text-sky-400 font-semibold">
                            {dayReading.totalKwh.toFixed(2)} kWh
                            <span className="text-slate-500 font-normal">
                              {' '}
                              (€ {dayReading.estimatedCostEur.toFixed(2)})
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      {!readOnly && (
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEditRow(log)}
                            aria-label="Modifica sessione"
                            title="Modifica"
                            className="p-1 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 rounded"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteLog(log)}
                            aria-label="Elimina sessione"
                            title="Elimina"
                            className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${readOnly ? 'pointer-events-none opacity-85' : ''}`}>
        {/* Ariston Heat Pump Panel */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-xs dark:shadow-none">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Pompa di Calore Ariston
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Impianto radiante a pavimento e Acqua Calda Sanitaria
              </p>
            </div>
            <div>
              {config.aristonMode === 'raffrescamento' ? (
                <Snowflake className="w-5 h-5 text-sky-600 dark:text-sky-400" />
              ) : (
                <Flame className="w-5 h-5 text-orange-500 dark:text-amber-400" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Modalità operativa
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
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
                      ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Profilo energetico
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
              {ARISTON_PROFILES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={saving}
                  onClick={() => applyChange({ aristonProfile: p.value })}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    config.aristonProfile === p.value
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs dark:shadow-none'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Temperatura mandata pavimento
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
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
              className="w-full accent-sky-600 dark:accent-sky-400 cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Acqua Calda Sanitaria (ACS)
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
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
              className="w-full accent-sky-600 dark:accent-sky-400 cursor-pointer"
            />
          </div>
        </section>

        {/* NeaSmart Dehumidifier Panel */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-xs dark:shadow-none">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Deumidificatore NeaSmart
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Controllo igrometrico e sicurezza raffrescamento radiante
              </p>
            </div>
            <Droplets className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Stato unità NeaSmart
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
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
                config.neasmartPower ? 'bg-sky-600 dark:bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'
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
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Umidità relativa target (UR)
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
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
              className="w-full accent-sky-600 dark:accent-sky-400 cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Velocità ventilazione
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
              {FAN_SPEEDS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  disabled={saving}
                  onClick={() => applyChange({ neasmartFanSpeed: f.value })}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    config.neasmartFanSpeed === f.value
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs dark:shadow-none'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Protezione Punto di Rugiada
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
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
                config.dewPointProtection ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Attenzione: conferma eliminazione
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Vuoi davvero eliminare l&apos;accensione{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {pendingDeleteLog.mode === 'riscaldamento'
                      ? 'Riscaldamento'
                      : 'Raffrescamento'}
                  </span>{' '}
                  del{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {formatReadingDate(pendingDeleteLog.date)}
                  </span>{' '}
                  ({formatSlotsSummary(getSessionTimeSlots(pendingDeleteLog))} ·{' '}
                  {pendingDeleteLog.targetTemp.toFixed(1)} °C)?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={deletingLog}
                onClick={() => setPendingDeleteLog(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
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
