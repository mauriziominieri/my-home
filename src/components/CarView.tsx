import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Car,
  ExternalLink,
  Fuel,
  Gauge,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { CarEntryType, CarLogEntry, CarProfile } from '../types/home';
import { AccessUnlockBanner } from './AccessUnlockBanner';

interface CarViewProps {
  profile: CarProfile;
  logs: CarLogEntry[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onSaveProfile: (profile: Omit<CarProfile, 'id'>) => Promise<void>;
  onAddLog: (entry: Omit<CarLogEntry, 'id'>) => Promise<void>;
  onUpdateLog: (id: string, entry: Omit<CarLogEntry, 'id'>) => Promise<void>;
  onDeleteLog: (id: string) => Promise<void>;
}

const ENTRY_TYPE_META: Record<
  CarEntryType,
  { label: string; badgeClass: string; icon: typeof Wrench }
> = {
  manutenzione: {
    label: 'Tagliando / Manutenzione',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    icon: Wrench,
  },
  scadenza: {
    label: 'Bollo / Assicurazione / Revisione',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon: Calendar,
  },
  gomme: {
    label: 'Pneumatici',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    icon: Gauge,
  },
  rifornimento: {
    label: 'Rifornimento',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    icon: Fuel,
  },
  spesa_auto: {
    label: 'Altra spesa / Accessori',
    badgeClass: 'bg-slate-700/60 text-slate-300 border-slate-600/50',
    icon: Car,
  },
};

function parseItDate(raw?: string): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getDaysRemaining(raw?: string): number | null {
  const dt = parseItDate(raw);
  if (!dt) return null;
  return Math.ceil((dt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function CarView({
  profile,
  logs,
  readOnly = false,
  onSignIn,
  onSaveProfile,
  onAddLog,
  onUpdateLog,
  onDeleteLog,
}: CarViewProps) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [brand, setBrand] = useState(profile.brand);
  const [model, setModel] = useState(profile.model);
  const [plate, setPlate] = useState(profile.plate);
  const [year, setYear] = useState(profile.year || '');
  const [fuelType, setFuelType] = useState(profile.fuelType || '');
  const [engine, setEngine] = useState(profile.engine || '');
  const [vin, setVin] = useState(profile.vin || '');
  const [tireSize, setTireSize] = useState(profile.tireSize || '');
  const [currentKm, setCurrentKm] = useState(
    profile.currentKm !== undefined ? String(profile.currentKm) : ''
  );
  const [insuranceCompany, setInsuranceCompany] = useState(profile.insuranceCompany || '');
  const [insuranceExpiry, setInsuranceExpiry] = useState(profile.insuranceExpiry || '');
  const [bolloExpiry, setBolloExpiry] = useState(profile.bolloExpiry || '');
  const [revisioneExpiry, setRevisioneExpiry] = useState(profile.revisioneExpiry || '');
  const [profileNotes, setProfileNotes] = useState(profile.notes || '');

  // Log form
  const [showLogForm, setShowLogForm] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [savingLog, setSavingLog] = useState(false);
  const [filterType, setFilterType] = useState<'all' | CarEntryType>('all');
  const [pendingDelete, setPendingDelete] = useState<CarLogEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [lType, setLType] = useState<CarEntryType>('manutenzione');
  const [lTitle, setLTitle] = useState('');
  const [lDate, setLDate] = useState(new Date().toLocaleDateString('it-IT'));
  const [lDueDate, setLDueDate] = useState('');
  const [lKm, setLKm] = useState('');
  const [lCost, setLCost] = useState('');
  const [lWorkshop, setLWorkshop] = useState('');
  const [lNotes, setLNotes] = useState('');

  function openEditProfile() {
    setBrand(profile.brand);
    setModel(profile.model);
    setPlate(profile.plate);
    setYear(profile.year || '');
    setFuelType(profile.fuelType || '');
    setEngine(profile.engine || '');
    setVin(profile.vin || '');
    setTireSize(profile.tireSize || '');
    setCurrentKm(profile.currentKm !== undefined ? String(profile.currentKm) : '');
    setInsuranceCompany(profile.insuranceCompany || '');
    setInsuranceExpiry(profile.insuranceExpiry || '');
    setBolloExpiry(profile.bolloExpiry || '');
    setRevisioneExpiry(profile.revisioneExpiry || '');
    setProfileNotes(profile.notes || '');
    setEditingProfile(true);
  }

  async function handleSubmitProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const kmVal = currentKm.trim() ? Number(currentKm.replace(/[^\d]/g, '')) : undefined;
      await onSaveProfile({
        brand: brand.trim() || 'Fiat',
        model: model.trim() || 'Panda',
        plate: plate.trim().toUpperCase() || 'EA218ES',
        year: year.trim() || undefined,
        fuelType: fuelType.trim() || undefined,
        engine: engine.trim() || undefined,
        vin: vin.trim().toUpperCase() || undefined,
        tireSize: tireSize.trim() || undefined,
        currentKm: kmVal !== undefined && Number.isFinite(kmVal) ? kmVal : undefined,
        insuranceCompany: insuranceCompany.trim() || undefined,
        insuranceExpiry: insuranceExpiry.trim() || undefined,
        bolloExpiry: bolloExpiry.trim() || undefined,
        revisioneExpiry: revisioneExpiry.trim() || undefined,
        notes: profileNotes.trim() || undefined,
      });
      setEditingProfile(false);
    } finally {
      setSavingProfile(false);
    }
  }

  function resetLogForm() {
    setEditingLogId(null);
    setLType('manutenzione');
    setLTitle('');
    setLDate(new Date().toLocaleDateString('it-IT'));
    setLDueDate('');
    setLKm(profile.currentKm !== undefined ? String(profile.currentKm) : '');
    setLCost('');
    setLWorkshop('');
    setLNotes('');
  }

  function openEditLog(item: CarLogEntry) {
    setEditingLogId(item.id);
    setLType(item.entryType);
    setLTitle(item.title);
    setLDate(item.date);
    setLDueDate(item.dueDate || '');
    setLKm(item.km !== undefined ? String(item.km) : '');
    setLCost(item.costEur !== undefined ? String(item.costEur) : '');
    setLWorkshop(item.workshop || '');
    setLNotes(item.notes || '');
    setShowLogForm(true);
  }

  async function handleSubmitLog(e: React.FormEvent) {
    e.preventDefault();
    if (!lTitle.trim()) return;
    setSavingLog(true);
    try {
      const kmVal = lKm.trim() ? Number(lKm.replace(/[^\d]/g, '')) : undefined;
      const costVal = lCost.trim() ? Number(lCost.replace(',', '.')) : undefined;
      const payload: Omit<CarLogEntry, 'id'> = {
        entryType: lType,
        title: lTitle.trim(),
        date: lDate.trim() || new Date().toLocaleDateString('it-IT'),
        dueDate: lDueDate.trim() || undefined,
        km: kmVal !== undefined && Number.isFinite(kmVal) ? kmVal : undefined,
        costEur: costVal !== undefined && Number.isFinite(costVal) ? costVal : undefined,
        workshop: lWorkshop.trim() || undefined,
        notes: lNotes.trim() || undefined,
      };
      if (editingLogId) {
        await onUpdateLog(editingLogId, payload);
      } else {
        await onAddLog(payload);
      }
      setShowLogForm(false);
      resetLogForm();
    } finally {
      setSavingLog(false);
    }
  }

  async function confirmDeleteLog() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDeleteLog(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const sortedLogs = useMemo(() => {
    return [...logs]
      .filter((l) => filterType === 'all' || l.entryType === filterType)
      .sort((a, b) => {
        const da = parseItDate(a.date)?.getTime() || 0;
        const db = parseItDate(b.date)?.getTime() || 0;
        return db - da;
      });
  }, [logs, filterType]);

  const totals = useMemo(() => {
    const totalCost = logs.reduce((s, l) => s + (l.costEur || 0), 0);
    const maintCount = logs.filter((l) => l.entryType === 'manutenzione' || l.entryType === 'gomme').length;
    const maxLogKm = logs.reduce((max, l) => Math.max(max, l.km || 0), 0);
    const displayKm = Math.max(profile.currentKm || 0, maxLogKm);
    return { totalCost, maintCount, displayKm };
  }, [logs, profile.currentKm]);

  const formattedPlate = useMemo(() => {
    const clean = (profile.plate || 'EA218ES').replace(/\s+/g, '').toUpperCase();
    return clean.length === 7
      ? `${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5)}`
      : clean;
  }, [profile.plate]);

  const deadlines = [
    {
      label: 'Assicurazione RCA',
      value: profile.insuranceExpiry,
      sub: profile.insuranceCompany || 'Compagnia da inserire',
    },
    {
      label: 'Bollo Auto',
      value: profile.bolloExpiry,
      sub: 'Tassa automobilistica annuale',
    },
    {
      label: 'Revisione Ministeriale',
      value: profile.revisioneExpiry,
      sub: 'Controllo periodico biennale',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Car className="w-5 h-5 text-sky-400" />
            Macchina — {profile.brand} {profile.model}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Scheda completa veicolo, scadenze assicurazione/bollo/revisione, manutenzioni e spese salvate su Firebase.
          </p>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openEditProfile}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-sky-400" />
              Modifica dati Panda
            </button>
            <button
              type="button"
              onClick={() => {
                resetLogForm();
                setShowLogForm(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Registra intervento / spesa
            </button>
          </div>
        )}
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Macchina"
        unlockedFeatures={[
          'Aggiorna dati veicolo, km e scadenze (Assicurazione, Bollo, Revisione)',
          'Registra, modifica o elimina tagliandi, pneumatici e rifornimenti',
        ]}
      />

      {/* Hero Scheda Veicolo + Targa Italiana */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/40 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Autentico badge targa italiana */}
            <div className="inline-flex items-stretch rounded-md overflow-hidden border-2 border-slate-300 bg-white shadow-md select-all shrink-0">
              <div className="w-5 bg-blue-700 flex flex-col items-center justify-end pb-1 text-[9px] font-bold text-white leading-none">
                I
              </div>
              <div className="px-3 py-1.5 font-mono text-lg font-black tracking-wider text-slate-950">
                {formattedPlate}
              </div>
              <div className="w-4 bg-blue-700" />
            </div>

            <div>
              <div className="text-base font-bold text-slate-100">
                {profile.brand} {profile.model}
                {profile.year ? ` (${profile.year})` : ''}
              </div>
              <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                <span>
                  Alimentazione:{' '}
                  <strong className="text-slate-200">
                    {profile.fuelType || 'Da completare'}
                  </strong>
                </span>
                <span>
                  Motore:{' '}
                  <strong className="text-slate-200">
                    {profile.engine || 'Da completare'}
                  </strong>
                </span>
                <span>
                  Pneumatici:{' '}
                  <strong className="text-slate-200 font-mono">
                    {profile.tireSize || 'Da completare'}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://www.ilportaledellautomobilista.it/web/portale-automobilista/verifica-ultima-revisione"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-lg"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Verifica Revisione ({profile.plate})
            </a>
            <a
              href="https://online.aci.it/acinet/calcolobollo/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-lg"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Calcolo Bollo ACI
            </a>
          </div>
        </div>

        {/* Scadenze principali + Dati tecnici */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {deadlines.map((d) => {
            const days = getDaysRemaining(d.value);
            const urgent = days !== null && days <= 30;
            const expired = days !== null && days < 0;
            return (
              <div
                key={d.label}
                className={`rounded-xl p-3.5 border ${
                  expired
                    ? 'bg-rose-950/30 border-rose-500/40'
                    : urgent
                      ? 'bg-amber-950/30 border-amber-500/40'
                      : 'bg-slate-950/70 border-slate-800'
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  {d.label}
                </div>
                <div className="text-base font-bold font-mono text-slate-100 mt-0.5">
                  {d.value || 'Da inserire'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                  {days !== null ? (
                    expired ? (
                      <span className="text-rose-300 font-medium">
                        Scaduta da {Math.abs(days)} gg
                      </span>
                    ) : (
                      <span className={urgent ? 'text-amber-300 font-medium' : 'text-emerald-300'}>
                        Tra {days} giorni
                      </span>
                    )
                  ) : (
                    d.sub
                  )}
                </div>
              </div>
            );
          })}

          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">
              Chilometraggio / Spese
            </div>
            <div className="text-base font-bold font-mono text-sky-300 mt-0.5">
              {totals.displayKm > 0 ? `${totals.displayKm.toLocaleString('it-IT')} km` : '— km'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Storico spese: <strong className="text-slate-200 font-mono">{totals.totalCost.toFixed(2).replace('.', ',')} €</strong> ({logs.length} voci)
            </div>
          </div>
        </div>

        {(profile.vin || profile.notes) && (
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-400">
            {profile.vin && (
              <span>
                Telaio / VIN: <span className="font-mono text-slate-200">{profile.vin}</span>
              </span>
            )}
            {profile.notes && <span className="italic">{profile.notes}</span>}
          </div>
        )}
      </section>

      {/* Form Modifica Profilo Veicolo */}
      {editingProfile && !readOnly && (
        <form
          onSubmit={handleSubmitProfile}
          className="bg-slate-900 border border-sky-500/40 rounded-xl p-4 sm:p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Modifica Scheda Veicolo ({profile.plate})
            </h3>
            <button
              type="button"
              onClick={() => setEditingProfile(false)}
              className="text-slate-400 hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-slate-400">Marca *</span>
              <input
                type="text"
                required
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Modello *</span>
              <input
                type="text"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Targa *</span>
              <input
                type="text"
                required
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 uppercase"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Anno immatricolazione</span>
              <input
                type="text"
                placeholder="Es. 2010"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Alimentazione</span>
              <input
                type="text"
                placeholder="Es. Benzina / GPL / Diesel"
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Motorizzazione / CV</span>
              <input
                type="text"
                placeholder="Es. 1.2 69 CV"
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Misura Pneumatici</span>
              <input
                type="text"
                placeholder="Es. 175/65 R14"
                value={tireSize}
                onChange={(e) => setTireSize(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Chilometraggio attuale (km)</span>
              <input
                type="number"
                placeholder="Es. 135000"
                value={currentKm}
                onChange={(e) => setCurrentKm(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Compagnia Assicurazione</span>
              <input
                type="text"
                placeholder="Es. Prima / Allianz / Unipol"
                value={insuranceCompany}
                onChange={(e) => setInsuranceCompany(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Scadenza Assicurazione</span>
              <input
                type="text"
                placeholder="GG/MM/AAAA"
                value={insuranceExpiry}
                onChange={(e) => setInsuranceExpiry(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Scadenza Bollo</span>
              <input
                type="text"
                placeholder="GG/MM/AAAA"
                value={bolloExpiry}
                onChange={(e) => setBolloExpiry(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Scadenza Revisione</span>
              <input
                type="text"
                placeholder="GG/MM/AAAA"
                value={revisioneExpiry}
                onChange={(e) => setRevisioneExpiry(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-slate-400">Telaio (VIN)</span>
              <input
                type="text"
                placeholder="ZFA169..."
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-slate-400">Note libretto / dotazioni</span>
              <input
                type="text"
                maxLength={240}
                placeholder="Es. Classe Euro, pressione gomme, codice autoradio, officina..."
                value={profileNotes}
                onChange={(e) => setProfileNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setEditingProfile(false)}
              className="px-3.5 py-2 text-slate-400 hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
            >
              {savingProfile ? 'Salvataggio...' : 'Salva dati Panda'}
            </button>
          </div>
        </form>
      )}

      {/* Form Nuovo Intervento / Spesa Auto */}
      {showLogForm && !readOnly && (
        <form
          onSubmit={handleSubmitLog}
          className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 sm:p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              {editingLogId ? 'Modifica voce veicolo' : 'Nuovo intervento, tagliando o spesa Panda EA218ES'}
            </h3>
            <button
              type="button"
              onClick={() => {
                setShowLogForm(false);
                resetLogForm();
              }}
              className="text-slate-400 hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-slate-400">Categoria *</span>
              <select
                value={lType}
                onChange={(e) => setLType(e.target.value as CarEntryType)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
              >
                {Object.entries(ENTRY_TYPE_META).map(([k, m]) => (
                  <option key={k} value={k}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-slate-400">Descrizione *</span>
              <input
                type="text"
                required
                maxLength={80}
                placeholder="Es. Tagliando completo olio + filtri / Cambio gomme..."
                value={lTitle}
                onChange={(e) => setLTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Data *</span>
              <input
                type="text"
                required
                placeholder="GG/MM/AAAA"
                value={lDate}
                onChange={(e) => setLDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Km al momento</span>
              <input
                type="number"
                placeholder="Es. 135400"
                value={lKm}
                onChange={(e) => setLKm(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Costo (€)</span>
              <input
                type="text"
                placeholder="Es. 145.00"
                value={lCost}
                onChange={(e) => setLCost(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Officina / Ente</span>
              <input
                type="text"
                placeholder="Es. Officina Rossi / Unipol..."
                value={lWorkshop}
                onChange={(e) => setLWorkshop(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Prossima scadenza (opz.)</span>
              <input
                type="text"
                placeholder="GG/MM/AAAA"
                value={lDueDate}
                onChange={(e) => setLDueDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1 sm:col-span-2 lg:col-span-4">
              <span className="text-slate-400">Note dettagliate (opz.)</span>
              <input
                type="text"
                maxLength={240}
                placeholder="Ricambi sostituiti, olio 5W-40, garanzia..."
                value={lNotes}
                onChange={(e) => setLNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setShowLogForm(false);
                resetLogForm();
              }}
              className="px-3.5 py-2 text-slate-400 hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={savingLog}
              className="px-4 py-2 font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg"
            >
              {savingLog ? 'Salvataggio...' : editingLogId ? 'Salva modifiche' : 'Salva su Firebase'}
            </button>
          </div>
        </form>
      )}

      {/* Filtri Storico Veicolo */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setFilterType('all')}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            filterType === 'all'
              ? 'bg-sky-500 text-slate-950'
              : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          Tutti ({logs.length})
        </button>
        {(Object.keys(ENTRY_TYPE_META) as CarEntryType[]).map((t) => {
          const count = logs.filter((l) => l.entryType === t).length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filterType === t
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {ENTRY_TYPE_META[t].label.split(' / ')[0]} ({count})
            </button>
          );
        })}
      </div>

      {/* Storico Manutenzioni & Spese */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            Storico Interventi, Tagliandi &amp; Scadenze ({sortedLogs.length})
          </h2>
        </div>

        {sortedLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 space-y-2">
            <p>Nessun intervento o spesa registrata per Fiat Panda {profile.plate}.</p>
            {!readOnly && (
              <p className="text-slate-500">
                Usa <strong className="text-slate-300">&quot;Modifica dati Panda&quot;</strong> per inserire le scadenze di bollo/assicurazione/revisione o <strong className="text-slate-300">&quot;Registra intervento / spesa&quot;</strong> per lo storico officina.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {sortedLogs.map((log) => {
              const meta = ENTRY_TYPE_META[log.entryType] || ENTRY_TYPE_META.manutenzione;
              const Icon = meta.icon;
              return (
                <div
                  key={log.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/25 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded-md ${meta.badgeClass}`}
                      >
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                      <span className="font-mono text-slate-400">{log.date}</span>
                      {log.km !== undefined && (
                        <span className="font-mono text-sky-300">
                          {log.km.toLocaleString('it-IT')} km
                        </span>
                      )}
                      {log.dueDate && (
                        <span className="font-mono text-amber-300">
                          Prossima: {log.dueDate}
                        </span>
                      )}
                    </div>

                    <div className="text-sm font-semibold text-slate-100">{log.title}</div>
                    {(log.workshop || log.notes) && (
                      <div className="text-[11px] text-slate-400">
                        {log.workshop ? `${log.workshop}${log.notes ? ' · ' : ''}` : ''}
                        {log.notes}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-center">
                    {log.costEur !== undefined && (
                      <div className="font-mono text-sm font-bold text-slate-100">
                        {log.costEur.toFixed(2).replace('.', ',')} €
                      </div>
                    )}
                    {!readOnly && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditLog(log)}
                          className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded"
                          aria-label="Modifica voce"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(log)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded"
                          aria-label="Elimina voce"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Eliminare &quot;{pendingDelete.title}&quot;?
                </h3>
                <p className="text-xs text-slate-300">
                  Verrà rimossa dallo storico della Panda ({profile.plate}) su Firebase.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs text-slate-300 bg-slate-800 rounded-lg"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDeleteLog()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg"
              >
                {deleting ? 'Eliminazione...' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
