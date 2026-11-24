import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Car,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Fuel,
  Gauge,
  HelpCircle,
  Lock,
  Pencil,
  Plus,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import {
  CarDocumentSlotType,
  CarEntryType,
  CarInsuranceCoverage,
  CarInsurancePolicy,
  CarLogEntry,
  CarProfile,
  HomeDocumentRecord,
} from '../types/home';
import { extractPdfTextFromBytes } from '../utils/billImporter';
import {
  buildCarDocumentRef,
  parseCarDocumentRef,
} from '../utils/carGroceryStore';
import {
  CAR_DOCUMENT_SLOTS,
  INSURANCE_GLOSSARY,
  parseCarDocumentText,
} from '../utils/carInsuranceParser';
import {
  buildDocumentSharePayload,
  downloadShareableItem,
  formatFileSize,
  MAX_CLOUD_FILE_BYTES,
  ShareableItemPayload,
} from '../utils/documentVault';
import { AccessUnlockBanner } from './AccessUnlockBanner';
import { ShareSheetModal } from './ShareSheetModal';

interface CarViewProps {
  profile: CarProfile;
  insurancePolicy: CarInsurancePolicy;
  logs: CarLogEntry[];
  carDocuments: HomeDocumentRecord[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onSaveProfile: (profile: Omit<CarProfile, 'id'>) => Promise<void>;
  onSaveInsurancePolicy: (policy: CarInsurancePolicy) => Promise<void>;
  onUploadCarDocument: (
    docItem: Omit<HomeDocumentRecord, 'id'>,
    file: File
  ) => Promise<void>;
  onDeleteCarDocument: (docId: string) => Promise<void>;
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

function formatEur(val: number): string {
  return `${val.toFixed(2).replace('.', ',')} €`;
}

export function CarView({
  profile,
  insurancePolicy,
  logs,
  carDocuments,
  readOnly = false,
  onSignIn,
  onSaveProfile,
  onSaveInsurancePolicy,
  onUploadCarDocument,
  onDeleteCarDocument,
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

  // Insurance Policy editor & UX toggles
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<CarInsurancePolicy>(insurancePolicy);
  const [expandedCoverageIds, setExpandedCoverageIds] = useState<Set<string>>(
    () => new Set(['rca', 'infortuni_conducente'])
  );
  const [showGlossary, setShowGlossary] = useState(false);

  // Document upload & auto-fill
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingSlotUpload, setPendingSlotUpload] =
    useState<CarDocumentSlotType>('polizza_contratto');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docNotice, setDocNotice] = useState<{
    tone: 'ok' | 'info' | 'err';
    title: string;
    details?: string[];
  } | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [shareDocItem, setShareDocItem] = useState<ShareableItemPayload | null>(null);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<HomeDocumentRecord | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

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
    setInsuranceCompany(profile.insuranceCompany || insurancePolicy.company || '');
    setInsuranceExpiry(profile.insuranceExpiry || insurancePolicy.endDate || '');
    setBolloExpiry(profile.bolloExpiry || '');
    setRevisioneExpiry(profile.revisioneExpiry || '');
    setProfileNotes(profile.notes || '');
    setEditingProfile(true);
  }

  function openEditPolicy() {
    setPolicyDraft(JSON.parse(JSON.stringify(insurancePolicy)) as CarInsurancePolicy);
    setEditingPolicy(true);
  }

  async function handleSubmitProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const kmVal = currentKm.trim() ? Number(currentKm.replace(/[^\d]/g, '')) : undefined;
      await onSaveProfile({
        brand: brand.trim() || 'Fiat',
        model: model.trim() || 'Panda 2ª serie - Panda 1.2 Dynamic Mamy',
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

  async function handleSubmitPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      const sumCoverages = policyDraft.coverages
        .filter((c) => c.active)
        .reduce((acc, c) => acc + (Number(c.premiumEur) || 0), 0);
      const nextPolicy: CarInsurancePolicy = {
        ...policyDraft,
        totalPremiumEur:
          policyDraft.totalPremiumEur > 0
            ? Math.round(policyDraft.totalPremiumEur * 100) / 100
            : Math.round(sumCoverages * 100) / 100,
        lastDocUpdatedAt: new Date().toLocaleDateString('it-IT'),
      };
      await onSaveInsurancePolicy(nextPolicy);
      await onSaveProfile({
        ...profile,
        insuranceCompany: nextPolicy.company || profile.insuranceCompany,
        insuranceExpiry: nextPolicy.endDate || profile.insuranceExpiry,
        model: nextPolicy.vehicleFullName || profile.model,
      });
      setEditingPolicy(false);
      setDocNotice({
        tone: 'ok',
        title: `Polizza ${nextPolicy.company} aggiornata e salvata su Firestore.`,
      });
    } finally {
      setSavingPolicy(false);
    }
  }

  function triggerUploadForSlot(slotType: CarDocumentSlotType) {
    setPendingSlotUpload(slotType);
    uploadInputRef.current?.click();
  }

  async function handleCarDocumentUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || readOnly) return;

    if (file.size > MAX_CLOUD_FILE_BYTES) {
      setDocNotice({
        tone: 'err',
        title: `Il file "${file.name}" supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB su Firebase.`,
      });
      return;
    }

    setUploadingDoc(true);
    setDocNotice(null);
    try {
      let extractedText = '';
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          extractedText = (await extractPdfTextFromBytes(bytes, 10)).trim();
        } catch {
          extractedText = '';
        }
      } else if (file.type.startsWith('text/')) {
        extractedText = await file.text();
      }

      const parsed = parseCarDocumentText(extractedText, file.name, pendingSlotUpload);

      // Build merged policy & profile updates if fields were extracted
      const hasPolicyUpdates = Object.keys(parsed.policyPatch).length > 0;
      const hasProfileUpdates = Object.keys(parsed.profilePatch).length > 0;

      if (hasPolicyUpdates) {
        const mergedCoverages = [...insurancePolicy.coverages];
        if (parsed.policyPatch.coverages?.length) {
          for (const incomingCov of parsed.policyPatch.coverages) {
            const idx = mergedCoverages.findIndex((c) => c.id === incomingCov.id);
            if (idx >= 0) {
              mergedCoverages[idx] = { ...mergedCoverages[idx], ...incomingCov };
            } else {
              mergedCoverages.push(incomingCov);
            }
          }
        }
        await onSaveInsurancePolicy({
          ...insurancePolicy,
          ...parsed.policyPatch,
          coverages: mergedCoverages,
          lastDocUpdatedAt: new Date().toLocaleDateString('it-IT'),
        });
      }

      if (hasProfileUpdates) {
        await onSaveProfile({
          ...profile,
          ...parsed.profilePatch,
        });
      }

      const docPayload: Omit<HomeDocumentRecord, 'id'> = {
        title: parsed.documentTitle,
        category: 'Assicurazioni',
        provider: parsed.provider || insurancePolicy.company || 'ConTe.it',
        referenceCode: buildCarDocumentRef(parsed.detectedSlotType, profile.plate),
        issueDate: parsed.issueDate || new Date().toLocaleDateString('it-IT'),
        expiryDate: parsed.expiryDate || insurancePolicy.endDate,
        fileName: file.name,
        fileMime: file.type || 'application/pdf',
        fileSize: file.size,
        pinned:
          parsed.detectedSlotType === 'certificato_assicurazione' ||
          parsed.detectedSlotType === 'libretto_circolazione',
        notes: parsed.referenceCode
          ? `Polizza ${parsed.referenceCode} · Targa ${profile.plate}`
          : `Documento auto targa ${profile.plate}`,
      };

      await onUploadCarDocument(docPayload, file);

      setDocNotice({
        tone: 'ok',
        title:
          parsed.extractedSummary.length > 0
            ? `"${file.name}" archiviato su Firebase e schede aggiornate automaticamente!`
            : `"${file.name}" archiviato nello spazio documenti della Panda (${profile.plate}).`,
        details:
          parsed.extractedSummary.length > 0
            ? parsed.extractedSummary
            : [
                'File salvato nel vault sicuro Firebase (accessibile da tutti i dispositivi e anche nella pagina Documenti).',
              ],
      });
    } catch (err) {
      setDocNotice({
        tone: 'err',
        title: err instanceof Error ? err.message : 'Errore durante il caricamento del documento.',
      });
    } finally {
      setUploadingDoc(false);
    }
  }

  async function handleDownloadDoc(docItem: HomeDocumentRecord) {
    setDownloadingDocId(docItem.id);
    try {
      const payload = buildDocumentSharePayload(docItem);
      await downloadShareableItem(readOnly ? { ...payload, attachmentKey: undefined } : payload);
    } finally {
      setDownloadingDocId(null);
    }
  }

  async function confirmDeleteDoc() {
    if (!pendingDeleteDoc) return;
    setDeletingDoc(true);
    try {
      await onDeleteCarDocument(pendingDeleteDoc.id);
      setPendingDeleteDoc(null);
    } finally {
      setDeletingDoc(false);
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

  function toggleCoverageInfo(id: string) {
    setExpandedCoverageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    const maxLogKm = logs.reduce((max, l) => Math.max(max, l.km || 0), 0);
    const displayKm = Math.max(profile.currentKm || 0, maxLogKm);
    return { totalCost, displayKm };
  }, [logs, profile.currentKm]);

  const formattedPlate = useMemo(() => {
    const clean = (profile.plate || 'EA218ES').replace(/\s+/g, '').toUpperCase();
    return clean.length === 7
      ? `${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5)}`
      : clean;
  }, [profile.plate]);

  const effectiveInsuranceExpiry = profile.insuranceExpiry || insurancePolicy.endDate;
  const effectiveCompany = profile.insuranceCompany || insurancePolicy.company;

  const deadlines = [
    {
      label: 'Assicurazione RCA',
      value: effectiveInsuranceExpiry,
      sub: `${effectiveCompany || 'ConTe.it'} · Decorrenza ${insurancePolicy.startDate}`,
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

  const activeCoverages = insurancePolicy.coverages.filter((c) => c.active);

  return (
    <div className="space-y-5">
      {/* Hidden shared upload input for car documents */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="application/pdf,.pdf,image/*"
        onChange={(e) => void handleCarDocumentUpload(e)}
        className="hidden"
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Car className="w-5 h-5 text-sky-400" />
            Macchina — {insurancePolicy.vehicleFullName || `${profile.brand} ${profile.model}`}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Polizza ConTe.it, garanzie spiegate in modo semplice, archivio documenti auto con compilazione automatica delle schede e storico manutenzioni.
          </p>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openEditPolicy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 rounded-lg transition-colors"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              Modifica polizza
            </button>
            <button
              type="button"
              onClick={openEditProfile}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-sky-400" />
              Dati veicolo
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
              Registra intervento
            </button>
          </div>
        )}
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Macchina & Assicurazione"
        unlockedFeatures={[
          'Visualizza i dati completi del contraente/proprietario e modifica la polizza ConTe.it',
          'Carica Certificato di Assicurazione, Attestato di Rischio e Libretto per aggiornare automaticamente le schede',
          'Registra o modifica tagliandi, pneumatici, rifornimenti e scadenze su Firestore',
        ]}
      />

      {docNotice && (
        <div
          role={docNotice.tone === 'err' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs flex items-start justify-between gap-3 ${
            docNotice.tone === 'err'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : docNotice.tone === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
                : 'bg-sky-500/10 border-sky-500/30 text-sky-200'
          }`}
        >
          <div className="space-y-1.5">
            <div className="font-semibold flex items-center gap-2">
              {docNotice.tone === 'ok' ? (
                <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{docNotice.title}</span>
            </div>
            {docNotice.details && docNotice.details.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {docNotice.details.map((item, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-slate-950/60 border border-emerald-500/25 text-[11px] font-mono text-emerald-200"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDocNotice(null)}
            className="text-slate-400 hover:text-white p-0.5 shrink-0"
            aria-label="Chiudi avviso documento"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hero Scheda Veicolo + Targa Italiana + Scadenze */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/40 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
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
                {insurancePolicy.vehicleFullName || `${profile.brand} ${profile.model}`}
              </div>
              <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 tabular-nums">
                <span>
                  Immatricolazione:{' '}
                  <strong className="text-slate-200">
                    {insurancePolicy.registrationDate || profile.year || '15/02/2010'}
                  </strong>
                </span>
                <span>
                  Alimentazione:{' '}
                  <strong className="text-slate-200">{profile.fuelType || 'Benzina'}</strong>
                </span>
                <span>
                  Valore stimato:{' '}
                  <strong className="text-slate-200 font-mono">
                    {formatEur(insurancePolicy.vehicleValueEur)}
                  </strong>
                </span>
                <span>
                  Ricovero: <strong className="text-slate-200">{insurancePolicy.overnightParking}</strong>
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
                <div className="text-base font-bold font-mono tabular-nums text-slate-100 mt-0.5">
                  {d.value || 'Da inserire'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                  {days !== null ? (
                    expired ? (
                      <span className="text-rose-300 font-medium">
                        Scaduta da {Math.abs(days)} gg · {d.sub}
                      </span>
                    ) : (
                      <span className={urgent ? 'text-amber-300 font-medium' : 'text-emerald-300'}>
                        Tra {days} giorni · {d.sub}
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
              Premio Polizza / Percorrenza
            </div>
            <div className="text-base font-bold font-mono tabular-nums text-emerald-300 mt-0.5">
              {formatEur(insurancePolicy.totalPremiumEur)}{' '}
              <span className="text-xs font-normal text-slate-400">
                / {insurancePolicy.paymentFrequency}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Dichiarati {insurancePolicy.annualKm.toLocaleString('it-IT')} km/anno
              {totals.displayKm > 0
                ? ` · Odometro ${totals.displayKm.toLocaleString('it-IT')} km`
                : ''}
            </div>
          </div>
        </div>

        {(profile.vin || profile.notes || profile.tireSize) && (
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-400">
            {profile.tireSize && (
              <span>
                Pneumatici: <span className="font-mono text-slate-200">{profile.tireSize}</span>
              </span>
            )}
            {profile.vin && (
              <span>
                Telaio / VIN: <span className="font-mono text-slate-200">{profile.vin}</span>
              </span>
            )}
            {profile.notes && <span className="italic">{profile.notes}</span>}
          </div>
        )}
      </section>

      {/* Polizza Assicurativa ConTe.it & Garanzie con spiegazioni */}
      <section className="bg-slate-900/75 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-100">
                Polizza Assicurativa {insurancePolicy.company}
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
                Classe CU {insurancePolicy.classCu} · Classe Admiral {insurancePolicy.classInternal}
              </span>
              {insurancePolicy.policyNumber && (
                <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-800 text-slate-300 rounded">
                  Polizza #{insurancePolicy.policyNumber}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 tabular-nums">
              Decorrenza <strong className="text-slate-200">{insurancePolicy.startDate}</strong> → Scadenza{' '}
              <strong className="text-slate-200">{insurancePolicy.endDate}</strong> · Frazionamento{' '}
              <strong className="text-slate-200">{insurancePolicy.paymentFrequency}</strong> · Premio totale{' '}
              <strong className="text-emerald-300 font-mono">
                {formatEur(insurancePolicy.totalPremiumEur)}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowGlossary((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                showGlossary
                  ? 'bg-sky-500 text-slate-950 border-sky-400'
                  : 'bg-sky-500/10 text-sky-300 border-sky-500/30 hover:bg-sky-500/20'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              {showGlossary ? 'Nascondi guida termini' : 'Guida semplice: cosa significano le voci?'}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={openEditPolicy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg"
              >
                <Pencil className="w-3.5 h-3.5" />
                Modifica voci
              </button>
            )}
          </div>
        </div>

        {/* Garanzie & Costi */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {activeCoverages.map((cov) => {
              const isExpanded = expandedCoverageIds.has(cov.id);
              const pct =
                insurancePolicy.totalPremiumEur > 0
                  ? Math.round((cov.premiumEur / insurancePolicy.totalPremiumEur) * 100)
                  : 0;
              return (
                <div
                  key={cov.id}
                  className="bg-slate-950/75 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-100">{cov.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                        Incidenza sul premio: {pct}%
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold font-mono tabular-nums text-emerald-300">
                        {formatEur(cov.premiumEur)}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCoverageInfo(cov.id)}
                        className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 mt-0.5"
                      >
                        <HelpCircle className="w-3 h-3" />
                        {isExpanded ? 'Nascondi info' : 'Cos’è?'}
                      </button>
                    </div>
                  </div>

                  {cov.note && isExpanded && (
                    <p className="text-[11px] text-slate-300 leading-relaxed pt-2 border-t border-slate-800/80">
                      {cov.note}
                    </p>
                  )}
                </div>
              );
            })}

            {/* Totale riepilogo */}
            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3.5 flex flex-col justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
                  Totale Polizza ({insurancePolicy.paymentFrequency})
                </div>
                <div className="text-xl font-black font-mono tabular-nums text-emerald-300 mt-0.5">
                  {formatEur(insurancePolicy.totalPremiumEur)}
                </div>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Comprende tutte le {activeCoverages.length} garanzie attive. Scadenza il{' '}
                <strong className="text-slate-100">{insurancePolicy.endDate}</strong> (+15 gg di comporto solo RCA in Italia).
              </p>
            </div>
          </div>

          {/* Glossario completo per non esperti */}
          {showGlossary && (
            <div className="bg-slate-950/80 border border-sky-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
                  <BookOpen className="w-4 h-4" />
                  Guida semplice all&apos;assicurazione auto (spiegata senza gergo tecnico)
                </div>
                <button
                  type="button"
                  onClick={() => setShowGlossary(false)}
                  className="text-xs text-slate-400 hover:text-slate-100"
                >
                  Chiudi
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {INSURANCE_GLOSSARY.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-900/75 border border-slate-800 rounded-lg p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-slate-100">{item.term}</h3>
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/10 text-sky-300 rounded">
                        {item.shortTag}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{item.summary}</p>
                    <p className="text-[11px] text-emerald-300/90 leading-relaxed">
                      <strong>Perché conta:</strong> {item.whyItMatters}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3 Schede Dati Polizza: Dati Veicolo | Dati Assicurativi | Soggetti */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
            {/* Dati Veicolo */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-300 border-b border-slate-800 pb-2">
                <Car className="w-4 h-4" />
                Dati Veicolo Dichiarati
              </div>
              <dl className="space-y-1.5 text-xs">
                {[
                  ['Veicolo', insurancePolicy.vehicleFullName],
                  ['Targa', profile.plate],
                  ['Immatricolazione', insurancePolicy.registrationDate],
                  ['Valore Veicolo', formatEur(insurancePolicy.vehicleValueEur)],
                  ['Ricovero notturno', insurancePolicy.overnightParking],
                  ['Km annui dichiarati', `${insurancePolicy.annualKm.toLocaleString('it-IT')} km`],
                  ['Utilizzo veicolo', insurancePolicy.vehicleUsage],
                  ['Modifiche veicolo', insurancePolicy.vehicleModified],
                  ['Alimentazione', profile.fuelType || 'Benzina'],
                  ['Antifurto', insurancePolicy.antiTheft],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-start justify-between gap-2">
                    <dt className="text-slate-400 shrink-0">{label}</dt>
                    <dd className="text-slate-100 font-medium text-right tabular-nums">{val}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Dati Assicurativi */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-300 border-b border-slate-800 pb-2">
                <ShieldCheck className="w-4 h-4" />
                Dati Assicurativi &amp; Bonus Malus
              </div>
              <dl className="space-y-1.5 text-xs">
                {[
                  ['Compagnia', insurancePolicy.company],
                  ['Decorrenza', insurancePolicy.startDate],
                  ['Scadenza', insurancePolicy.endDate],
                  ['Premio totale', formatEur(insurancePolicy.totalPremiumEur)],
                  ['Frazionamento', insurancePolicy.paymentFrequency],
                  ['Situazione assicurativa', insurancePolicy.insuranceSituation],
                  ['Classe CU (universale)', insurancePolicy.classCu],
                  ['Classe Admiral (interna)', insurancePolicy.classInternal],
                  ['Sospensioni patente (5 anni)', String(insurancePolicy.licenseSuspensions5y)],
                  ['Multe guida in stato ebrezza', String(insurancePolicy.duiFines)],
                  ['Sinistri con colpa (5 anni)', String(insurancePolicy.atFaultClaims5y)],
                  ['Sinistri senza colpa (5 anni)', String(insurancePolicy.noFaultClaims5y)],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-start justify-between gap-2">
                    <dt className="text-slate-400 shrink-0">{label}</dt>
                    <dd className="text-slate-100 font-medium text-right tabular-nums">{val}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Soggetti (solo proprietario autenticato) */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 text-xs font-bold text-violet-300">
                  <UserCheck className="w-4 h-4" />
                  Soggetti Polizza
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                  <Lock className="w-3 h-3" />
                  Privato
                </span>
              </div>

              {!readOnly && insurancePolicy.subject ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-violet-200 bg-violet-500/10 border border-violet-500/25 rounded-lg px-2.5 py-1.5">
                    {insurancePolicy.subject.role}
                  </div>
                  <dl className="space-y-1.5 text-xs">
                    {[
                      ['Nome e Cognome', insurancePolicy.subject.fullName],
                      ['Sesso', insurancePolicy.subject.gender],
                      ['Data di nascita', insurancePolicy.subject.birthDate],
                      [
                        'Luogo di nascita',
                        `${insurancePolicy.subject.birthPlace} (${insurancePolicy.subject.birthCountry})`,
                      ],
                      ['Codice Fiscale', insurancePolicy.subject.taxCode],
                      ['Residenza', insurancePolicy.subject.residence],
                      ['Professione', insurancePolicy.subject.profession],
                      ['Stato civile', insurancePolicy.subject.maritalStatus],
                      ['Numero figli', String(insurancePolicy.subject.childrenCount)],
                      ['Titolo di studi', insurancePolicy.subject.education],
                    ].map(([label, val]) => (
                      <div key={label} className="flex items-start justify-between gap-2">
                        <dt className="text-slate-400 shrink-0">{label}</dt>
                        <dd className="text-slate-100 font-medium text-right break-words">
                          {val}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <div className="py-6 text-center space-y-2.5">
                  <Lock className="w-6 h-6 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    I dati anagrafici completi (Codice Fiscale, residenza, data di nascita) di Proprietario, Conducente e Contraente sono protetti e visibili solo dopo l&apos;accesso.
                  </p>
                  {onSignIn && (
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 rounded-lg"
                    >
                      Accedi per visualizzare
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Archivio Documenti Assicurazione & Veicolo (con auto-compilazione schede) */}
      <section className="bg-slate-900/75 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-sky-400" />
              Documenti Assicurazione &amp; Veicolo ({carDocuments.length})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Carica Certificato di Assicurazione, Attestato di Rischio, Polizza, Carta Verde o Libretto: i PDF vengono letti in automatico per aggiornare le schede sopra e salvati nel vault Firebase (anche in Documenti).
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              disabled={uploadingDoc}
              onClick={() => triggerUploadForSlot('polizza_contratto')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-60 rounded-lg shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              {uploadingDoc ? 'Lettura e salvataggio...' : 'Carica documento (PDF/Foto)'}
            </button>
          )}
        </div>

        {/* Checklist documenti consigliati */}
        <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {CAR_DOCUMENT_SLOTS.map((slot) => {
            const matchedDocs = carDocuments.filter(
              (d) => parseCarDocumentRef(d.referenceCode)?.slotType === slot.slotType
            );
            const hasDoc = matchedDocs.length > 0;
            return (
              <div
                key={slot.slotType}
                className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 ${
                  hasDoc
                    ? 'bg-emerald-950/15 border-emerald-500/35'
                    : 'bg-slate-950/60 border-slate-800'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {hasDoc ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <h3 className="text-xs font-bold text-slate-100">{slot.title}</h3>
                    </div>
                    {slot.requiredInCar && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded shrink-0">
                        In auto
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-medium text-sky-300">{slot.categoryHint}</div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{slot.description}</p>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800/70">
                  {matchedDocs.map((docItem) => (
                    <div
                      key={docItem.id}
                      className="flex items-center justify-between gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px]"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-200 truncate">
                          {docItem.fileName || docItem.title}
                        </div>
                        <div className="text-[10px] text-slate-500 tabular-nums">
                          {docItem.fileSize ? formatFileSize(docItem.fileSize) : 'Salvato'}
                          {docItem.expiryDate ? ` · Scad. ${docItem.expiryDate}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={downloadingDocId === docItem.id}
                          onClick={() => void handleDownloadDoc(docItem)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md transition-colors"
                          title="Scarica documento"
                          aria-label={`Scarica ${docItem.fileName || docItem.title}`}
                        >
                          <Download className="w-3 h-3 text-sky-400" />
                          Scarica
                        </button>
                        <button
                          type="button"
                          onClick={() => setShareDocItem(buildDocumentSharePayload(docItem))}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 rounded-md transition-colors"
                          title="Condividi documento"
                          aria-label={`Condividi ${docItem.fileName || docItem.title}`}
                        >
                          <Share2 className="w-3 h-3" />
                          Condividi
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteDoc(docItem)}
                            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded"
                            title="Elimina documento"
                            aria-label={`Elimina ${docItem.fileName || docItem.title}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {!readOnly && (
                    <button
                      type="button"
                      disabled={uploadingDoc}
                      onClick={() => triggerUploadForSlot(slot.slotType)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors disabled:opacity-60"
                    >
                      <Upload className="w-3.5 h-3.5 text-sky-400" />
                      {hasDoc ? 'Carica nuova versione' : `Carica ${slot.title.split(' ')[0]}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Eventuali altri documenti auto caricati senza slot specifico */}
        {carDocuments.some((d) => parseCarDocumentRef(d.referenceCode)?.slotType === 'altro') && (
          <div className="px-4 sm:px-5 pb-4 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Altri documenti auto allegati
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {carDocuments
                .filter((d) => parseCarDocumentRef(d.referenceCode)?.slotType === 'altro')
                .map((docItem) => (
                  <div
                    key={docItem.id}
                    className="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 truncate">{docItem.title}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {docItem.fileName} {docItem.fileSize ? `(${formatFileSize(docItem.fileSize)})` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={downloadingDocId === docItem.id}
                        onClick={() => void handleDownloadDoc(docItem)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-sky-400" />
                        Scarica
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareDocItem(buildDocumentSharePayload(docItem))}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 rounded-lg transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        Condividi
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteDoc(docItem)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg"
                          aria-label="Elimina documento"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* Form Modifica Polizza ConTe.it */}
      {editingPolicy && !readOnly && (
        <form
          onSubmit={handleSubmitPolicy}
          className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 sm:p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Modifica Polizza Assicurativa ({policyDraft.company})
            </h3>
            <button
              type="button"
              onClick={() => setEditingPolicy(false)}
              className="text-slate-400 hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-slate-400">Compagnia</span>
              <input
                type="text"
                value={policyDraft.company}
                onChange={(e) => setPolicyDraft({ ...policyDraft, company: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Numero Polizza (opz.)</span>
              <input
                type="text"
                value={policyDraft.policyNumber || ''}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, policyNumber: e.target.value || undefined })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Decorrenza (GG/MM/AAAA)</span>
              <input
                type="text"
                value={policyDraft.startDate}
                onChange={(e) => setPolicyDraft({ ...policyDraft, startDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Scadenza (GG/MM/AAAA)</span>
              <input
                type="text"
                value={policyDraft.endDate}
                onChange={(e) => setPolicyDraft({ ...policyDraft, endDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Premio totale (€)</span>
              <input
                type="number"
                step="0.01"
                value={policyDraft.totalPremiumEur}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, totalPremiumEur: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Frazionamento</span>
              <input
                type="text"
                value={policyDraft.paymentFrequency}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, paymentFrequency: e.target.value })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Classe CU</span>
              <input
                type="text"
                value={policyDraft.classCu}
                onChange={(e) => setPolicyDraft({ ...policyDraft, classCu: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Classe Admiral</span>
              <input
                type="text"
                value={policyDraft.classInternal}
                onChange={(e) => setPolicyDraft({ ...policyDraft, classInternal: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Valore Veicolo (€)</span>
              <input
                type="number"
                step="1"
                value={policyDraft.vehicleValueEur}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, vehicleValueEur: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Km annui</span>
              <input
                type="number"
                step="100"
                value={policyDraft.annualKm}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, annualKm: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Ricovero notturno</span>
              <input
                type="text"
                value={policyDraft.overnightParking}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, overnightParking: e.target.value })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Modifiche veicolo</span>
              <input
                type="text"
                value={policyDraft.vehicleModified}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, vehicleModified: e.target.value })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="font-semibold text-slate-200">Garanzie attive e premi (€)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {policyDraft.coverages.map((cov, idx) => (
                <div
                  key={cov.id}
                  className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"
                >
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cov.active}
                      onChange={(e) => {
                        const updated = [...policyDraft.coverages];
                        updated[idx] = { ...cov, active: e.target.checked };
                        setPolicyDraft({ ...policyDraft, coverages: updated });
                      }}
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500"
                    />
                    <span className="text-slate-200 truncate">{cov.name}</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={cov.premiumEur}
                    onChange={(e) => {
                      const updated = [...policyDraft.coverages];
                      updated[idx] = { ...cov, premiumEur: Number(e.target.value) || 0 };
                      setPolicyDraft({ ...policyDraft, coverages: updated });
                    }}
                    className="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono text-right text-slate-100"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setEditingPolicy(false)}
              className="px-3.5 py-2 text-slate-400 hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={savingPolicy}
              className="px-4 py-2 font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg"
            >
              {savingPolicy ? 'Salvataggio...' : 'Salva polizza su Firestore'}
            </button>
          </div>
        </form>
      )}

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
                placeholder="Es. Benzina"
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
                placeholder="Es. ConTe.it"
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
                placeholder="Es. Officina Rossi / ConTe.it..."
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
            <Wrench className="w-4 h-4 text-sky-400" />
            Storico Interventi, Tagliandi &amp; Spese ({sortedLogs.length})
          </h2>
          {totals.totalCost > 0 && (
            <span className="text-xs font-mono text-slate-300 tabular-nums">
              Totale spese registrate: <strong className="text-slate-100">{formatEur(totals.totalCost)}</strong>
            </span>
          )}
        </div>

        {sortedLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 space-y-2">
            <p>Nessun intervento o spesa registrata per Fiat Panda {profile.plate}.</p>
            {!readOnly && (
              <p className="text-slate-500">
                Usa <strong className="text-slate-300">&quot;Registra intervento&quot;</strong> per annotare tagliandi, gomme, bollo o spese.
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
                      <span className="font-mono text-slate-400 tabular-nums">{log.date}</span>
                      {log.km !== undefined && (
                        <span className="font-mono text-sky-300 tabular-nums">
                          {log.km.toLocaleString('it-IT')} km
                        </span>
                      )}
                      {log.dueDate && (
                        <span className="font-mono text-amber-300 tabular-nums">
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
                      <div className="font-mono tabular-nums text-sm font-bold text-slate-100">
                        {formatEur(log.costEur)}
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

      {/* Modal Elimina Documento Auto */}
      {pendingDeleteDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Eliminare &quot;{pendingDeleteDoc.fileName || pendingDeleteDoc.title}&quot;?
                </h3>
                <p className="text-xs text-slate-300">
                  Il documento verrà rimosso dall&apos;archivio della macchina e dal vault Firebase.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={deletingDoc}
                onClick={() => setPendingDeleteDoc(null)}
                className="px-3.5 py-2 text-xs text-slate-300 bg-slate-800 rounded-lg"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deletingDoc}
                onClick={() => void confirmDeleteDoc()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg"
              >
                {deletingDoc ? 'Eliminazione...' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Elimina Log */}
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
      {shareDocItem && (
        <ShareSheetModal
          item={shareDocItem}
          readOnly={readOnly}
          onClose={() => setShareDocItem(null)}
        />
      )}
    </div>
  );
}
