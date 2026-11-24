import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Download,
  Droplets,
  ExternalLink,
  FileCheck2,
  FileText,
  FileUp,
  FolderOpen,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  Search,
  Share2,
  Shield,
  Star,
  Trash2,
  Upload,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import {
  BillRecord,
  HomeDocumentCategory,
  HomeDocumentRecord,
  TariBillRecord,
  WaterBillRecord,
} from '../types/home';
import {
  buildDocumentSharePayload,
  buildElectricityBillSharePayload,
  buildTariBillSharePayload,
  buildWaterBillSharePayload,
  deleteVaultFile,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STARTER_TEMPLATES,
  DocumentStarterTemplate,
  downloadShareableItem,
  formatFileSize,
  getElectricityBillFileKey,
  getTariBillFileKey,
  getWaterBillFileKey,
  isOctopusContractRecord,
  listVaultFileMetadata,
  saveVaultFile,
  ShareableItemPayload,
  VAULT_UPDATED_EVENT,
  VaultFileMeta,
} from '../utils/documentVault';
import { ShareSheetModal } from './ShareSheetModal';
import { AccessUnlockBanner } from './AccessUnlockBanner';

interface DocumentsViewProps {
  documents: HomeDocumentRecord[];
  electricityBills: BillRecord[];
  waterBills: WaterBillRecord[];
  tariBills: TariBillRecord[];
  readOnly?: boolean;
  isGmailConnected?: boolean;
  onSignIn?: () => void;
  onConnectGmail?: () => void;
  onAddDocument: (doc: Omit<HomeDocumentRecord, 'id'>) => Promise<string | void>;
  onUpdateDocument: (id: string, doc: Omit<HomeDocumentRecord, 'id'>) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
}

const CATEGORY_STYLE: Record<
  HomeDocumentCategory,
  { icon: typeof FileText; badge: string }
> = {
  'Mutuo & Casa': {
    icon: Building2,
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  'Internet & Wi-Fi': {
    icon: Wifi,
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  'Contratti & Utenze': {
    icon: FileText,
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  Assicurazioni: {
    icon: Shield,
    badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  'Fiscale & Identità': {
    icon: FileCheck2,
    badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  Altro: {
    icon: FolderOpen,
    badge: 'bg-slate-700/60 text-slate-300 border-slate-600/50',
  },
};

export function DocumentsView({
  documents,
  electricityBills,
  waterBills,
  tariBills,
  readOnly = false,
  isGmailConnected = false,
  onSignIn,
  onConnectGmail,
  onAddDocument,
  onUpdateDocument,
  onDeleteDocument,
}: DocumentsViewProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'bollette' | HomeDocumentCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [vaultMeta, setVaultMeta] = useState<Record<string, VaultFileMeta>>({});

  // Add/Edit modal states
  const [showForm, setShowForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState<HomeDocumentRecord | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<HomeDocumentCategory>('Mutuo & Casa');
  const [provider, setProvider] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [pinned, setPinned] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [shareItem, setShareItem] = useState<ShareableItemPayload | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HomeDocumentRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const formFileInputRef = useRef<HTMLInputElement | null>(null);
  const billAttachInputRef = useRef<HTMLInputElement | null>(null);
  const [attachingBillKey, setAttachingBillKey] = useState<string | null>(null);

  useEffect(() => {
    void reloadVaultMeta();
    const onVaultChange = () => {
      void reloadVaultMeta();
    };
    window.addEventListener(VAULT_UPDATED_EVENT, onVaultChange);
    return () => window.removeEventListener(VAULT_UPDATED_EVENT, onVaultChange);
  }, [documents.length]);

  async function reloadVaultMeta() {
    const meta = await listVaultFileMetadata();
    setVaultMeta(meta);
  }

  function resetForm() {
    setEditingDoc(null);
    setTitle('');
    setCategory('Mutuo & Casa');
    setProvider('');
    setReferenceCode('');
    setIssueDate('');
    setExpiryDate('');
    setCloudUrl('');
    setNotes('');
    setPinned(false);
    setPendingFile(null);
  }

  function openNewForm(template?: DocumentStarterTemplate) {
    resetForm();
    if (template) {
      setTitle(template.title);
      setCategory(template.category);
      setProvider(template.provider);
      setReferenceCode(template.referenceCode || '');
      setNotes(template.notes || '');
      setPinned(true);
    } else if (activeTab !== 'all' && activeTab !== 'bollette') {
      setCategory(activeTab);
    }
    setShowForm(true);
  }

  function openEditForm(doc: HomeDocumentRecord) {
    setEditingDoc(doc);
    setTitle(doc.title);
    setCategory(doc.category);
    setProvider(doc.provider);
    setReferenceCode(doc.referenceCode || '');
    setIssueDate(doc.issueDate || '');
    setExpiryDate(doc.expiryDate || '');
    setCloudUrl(doc.cloudUrl || '');
    setNotes(doc.notes || '');
    setPinned(Boolean(doc.pinned));
    setPendingFile(null);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !provider.trim()) return;
    setSaving(true);
    setStatusNotice(null);
    try {
      const attachmentKey =
        editingDoc?.attachmentKey ||
        `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      let fileName = editingDoc?.fileName;
      let fileMime = editingDoc?.fileMime;
      let fileSize = editingDoc?.fileSize;

      let cloudInfo = '';
      if (pendingFile) {
        const stored = await saveVaultFile(
          attachmentKey,
          pendingFile,
          pendingFile.name,
          pendingFile.type
        );
        if (!stored.cloudSynced) {
          throw new Error('Il file allegato non è stato salvato su Firestore. Nessuna modifica salvata.');
        }
        fileName = pendingFile.name;
        fileMime = pendingFile.type || 'application/octet-stream';
        fileSize = pendingFile.size;
        cloudInfo = ' File salvato su Firestore (scaricabile da ogni dispositivo).';
      }

      const payload: Omit<HomeDocumentRecord, 'id'> = {
        title: title.trim().slice(0, 80),
        category,
        provider: provider.trim().slice(0, 80),
        referenceCode: referenceCode.trim().slice(0, 80) || undefined,
        issueDate: issueDate.trim().slice(0, 20) || undefined,
        expiryDate: expiryDate.trim().slice(0, 20) || undefined,
        cloudUrl: cloudUrl.trim() || undefined,
        fileName,
        fileMime,
        fileSize,
        attachmentKey,
        pinned,
        notes: notes.trim() || undefined,
      };

      if (editingDoc) {
        await onUpdateDocument(editingDoc.id, payload);
        setStatusNotice(`Documento "${payload.title}" aggiornato.${cloudInfo}`);
      } else {
        await onAddDocument(payload);
        setStatusNotice(`Documento "${payload.title}" salvato nell'archivio.${cloudInfo}`);
      }

      await reloadVaultMeta();
      setShowForm(false);
      resetForm();
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Errore nel salvataggio del documento.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.attachmentKey) {
        await deleteVaultFile(pendingDelete.attachmentKey);
      }
      await onDeleteDocument(pendingDelete.id);
      setPendingDelete(null);
      await reloadVaultMeta();
    } finally {
      setDeleting(false);
    }
  }

  async function handleAttachFileToBill(files: FileList | null) {
    if (!files || files.length === 0 || !attachingBillKey) return;
    const file = files[0];
    try {
      const stored = await saveVaultFile(attachingBillKey, file, file.name, file.type);
      if (!stored.cloudSynced) {
        throw new Error(`Il file "${file.name}" non è stato salvato su Firestore.`);
      }
      setStatusNotice(
        `PDF "${file.name}" salvato su Firestore: pronto per download/invio da qualsiasi dispositivo.`
      );
      await reloadVaultMeta();
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Errore durante il caricamento del file.');
    } finally {
      setAttachingBillKey(null);
      if (billAttachInputRef.current) billAttachInputRef.current.value = '';
    }
  }

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...documents]
      .filter((d) => {
        if (activeTab !== 'all' && activeTab !== 'bollette' && d.category !== activeTab) {
          return false;
        }
        if (!q) return true;
        return [d.title, d.category, d.provider, d.referenceCode, d.notes, d.fileName]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.title.localeCompare(b.title, 'it');
      });
  }, [documents, activeTab, searchQuery]);

  interface UnifiedBillShareItem {
    id: string;
    kind: 'luce' | 'acqua' | 'tari';
    label: string;
    period: string;
    supplier: string;
    number: string;
    date: string;
    amount: number;
    fileKey: string;
    payload: ShareableItemPayload;
  }

  const shareableElectricityBills = useMemo(
    () =>
      electricityBills.filter(
        (bill) =>
          !isOctopusContractRecord(bill) &&
          (readOnly
            ? Boolean(bill.pdfFileKey)
            : Boolean(bill.pdfFileKey || vaultMeta[getElectricityBillFileKey(bill.invoiceNumber)]))
      ),
    [electricityBills, readOnly, vaultMeta]
  );

  const shareableWaterBills = useMemo(
    () =>
      waterBills.filter((bill) =>
        readOnly
          ? Boolean(bill.pdfFileKey)
          : Boolean(bill.pdfFileKey || vaultMeta[getWaterBillFileKey(bill.invoiceNumber)])
      ),
    [waterBills, readOnly, vaultMeta]
  );

  const shareableTariBills = useMemo(
    () =>
      tariBills.filter((bill) =>
        readOnly
          ? Boolean(bill.pdfFileKey)
          : Boolean(bill.pdfFileKey || vaultMeta[getTariBillFileKey(bill.noticeNumber)])
      ),
    [tariBills, readOnly, vaultMeta]
  );

  const totalShareableBillsCount =
    shareableElectricityBills.length + shareableWaterBills.length + shareableTariBills.length;

  const allBillsForSharing = useMemo<UnifiedBillShareItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const list: UnifiedBillShareItem[] = [
      ...shareableElectricityBills.map((b) => ({
        id: `elec_${b.invoiceNumber}`,
        kind: 'luce' as const,
        label: 'Luce',
        period: b.period,
        supplier: b.supplier,
        number: b.invoiceNumber,
        date: b.issueDate,
        amount: b.totalPaid,
        fileKey: b.pdfFileKey || getElectricityBillFileKey(b.invoiceNumber),
        payload: buildElectricityBillSharePayload(b),
      })),
      ...shareableWaterBills.map((w) => ({
        id: `water_${w.id || w.invoiceNumber}`,
        kind: 'acqua' as const,
        label: 'Acqua',
        period: w.period,
        supplier: 'AcegasApsAmga Acqua',
        number: w.invoiceNumber,
        date: w.issueDate,
        amount: w.totalPaid,
        fileKey: w.pdfFileKey || getWaterBillFileKey(w.invoiceNumber),
        payload: buildWaterBillSharePayload(w),
      })),
      ...shareableTariBills.map((t) => ({
        id: `tari_${t.id || t.noticeNumber}`,
        kind: 'tari' as const,
        label: 'TARI',
        period: t.period,
        supplier: t.supplier,
        number: t.noticeNumber,
        date: t.issueDate || t.dueDate,
        amount: t.totalPaid,
        fileKey: t.pdfFileKey || getTariBillFileKey(t.noticeNumber),
        payload: buildTariBillSharePayload(t),
      })),
    ];

    return list
      .filter((item) => {
        if (!q) return true;
        return [item.label, item.period, item.supplier, item.number, item.date]
          .some((x) => x.toLowerCase().includes(q));
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  }, [shareableElectricityBills, shareableWaterBills, shareableTariBills, searchQuery]);

  const attachedDocsCount = useMemo(
    () =>
      documents.filter(
        (d) => (d.attachmentKey && vaultMeta[d.attachmentKey]) || d.fileName
      ).length,
    [documents, vaultMeta]
  );

  const pinnedDocsCount = useMemo(
    () => documents.filter((d) => d.pinned).length,
    [documents]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-sky-400" />
            Archivio Documenti Casa &amp; Contratti
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Mutuo, contratto Wi-Fi WindTre, rogito, assicurazioni, identità e tutte le bollette pronti da scaricare o condividere.
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={() => openNewForm()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Aggiungi Documento
          </button>
        )}
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        isGmailConnected={isGmailConnected}
        onSignIn={onSignIn}
        onConnectGmail={onConnectGmail}
        pageName="Documenti"
        unlockedFeatures={[
          'Carica PDF/scansioni (Mutuo, WindTre, Contratti, Assicurazioni) su Firestore per scaricarli da ogni dispositivo',
          'Allega PDF originali alle singole bollette da condividere',
          'Modifica, fissa in evidenza o elimina documenti dell’archivio',
        ]}
        gmailFeatures={[
          'Archiviazione automatica su Firestore dei PDF bollette ricevuti in INBOX Gmail',
        ]}
      />

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/75 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Documenti Salvati
          </div>
          <div className="text-xl font-bold font-mono text-slate-100 mt-0.5">
            {documents.length}
          </div>
        </div>
        <div className="bg-slate-900/75 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Con File Allegato
          </div>
          <div className="text-xl font-bold font-mono text-emerald-300 mt-0.5">
            {attachedDocsCount}
          </div>
        </div>
        <div className="bg-slate-900/75 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            In Evidenza
          </div>
          <div className="text-xl font-bold font-mono text-amber-300 mt-0.5">
            {pinnedDocsCount}
          </div>
        </div>
        <div className="bg-slate-900/75 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Bollette Condivisibili
          </div>
          <div className="text-xl font-bold font-mono text-sky-300 mt-0.5">
            {totalShareableBillsCount}
          </div>
        </div>
      </div>

      {statusNotice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5 text-xs text-emerald-200 flex items-center justify-between gap-2">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-400 hover:text-slate-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Quick Starter Templates */}
      {!readOnly && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Aggiunta rapida documenti essenziali di casa
          </div>
          <div className="flex flex-wrap gap-2">
            {DOCUMENT_STARTER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.title}
                type="button"
                onClick={() => openNewForm(tpl)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-slate-950/80 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/40 text-slate-200 rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3 text-sky-400" />
                {tpl.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Tabs + Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeTab === 'all'
                ? 'bg-sky-500 text-slate-950 border-sky-400'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-slate-100'
            }`}
          >
            Tutti i Documenti ({documents.length + totalShareableBillsCount})
          </button>

          {DOCUMENT_CATEGORIES.map((cat) => {
            const count = documents.filter((d) => d.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveTab(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  activeTab === cat
                    ? 'bg-sky-500 text-slate-950 border-sky-400'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-slate-100'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setActiveTab('bollette')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              activeTab === 'bollette'
                ? 'bg-amber-400 text-slate-950 border-amber-300'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            Bollette da Inviare ({totalShareableBillsCount})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca mutuo, WindTre, fattura..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showForm && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-sky-500/40 rounded-xl p-4 sm:p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-100">
              {editingDoc ? `Modifica "${editingDoc.title}"` : 'Nuovo Documento Utile'}
            </h2>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="text-slate-400 hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-slate-400">Titolo documento *</label>
              <input
                type="text"
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Es. Contratto Fibra WindTre"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Categoria *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as HomeDocumentCategory)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Ente / Banca / Fornitore *</label>
              <input
                type="text"
                required
                maxLength={80}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="Es. WindTre, Intesa Sanpaolo..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">N° Contratto / Pratica / SSID</label>
              <input
                type="text"
                maxLength={80}
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                placeholder="Es. Cod. cliente o pratica mutuo"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Data stipula / documento</label>
              <input
                type="text"
                maxLength={20}
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                placeholder="Es. 15/03/2024"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Scadenza / Rinnovo</label>
              <input
                type="text"
                maxLength={20}
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                placeholder="Es. 15/03/2026"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="block text-slate-400">Link Google Drive / Cloud (opz.)</label>
              <input
                type="url"
                value={cloudUrl}
                onChange={(e) => setCloudUrl(e.target.value)}
                placeholder="https://drive.google.com/..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">In evidenza</label>
              <label className="flex items-center gap-2 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                Fissa in alto tra i documenti importanti
              </label>
            </div>

            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <label className="block text-slate-400">
                Note / Dati utili (password Wi-Fi, codice migrazione, IBAN, rata mutuo...)
              </label>
              <input
                type="text"
                maxLength={180}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Inserisci annotazioni rapide o credenziali utili da trovare subito..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* File upload picker */}
            <div className="sm:col-span-2 lg:col-span-3 bg-slate-950/75 border border-dashed border-sky-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-sky-400" />
                  Allega File (PDF, foto, scansione, documento)
                </div>
                <div className="text-[11px] text-slate-400">
                  {pendingFile
                    ? `Pronto per Firestore: ${pendingFile.name} (${formatFileSize(pendingFile.size)})`
                    : editingDoc?.fileName
                      ? `File attuale: ${editingDoc.fileName} (scegline un altro per sostituirlo)`
                      : 'Salvato su Firestore (fino a 6 MB) per poterlo scaricare e inviare da tutti i tuoi dispositivi.'}
                </div>
              </div>

              <div>
                <input
                  ref={formFileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.csv,.json"
                  onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => formFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 rounded-lg"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {pendingFile || editingDoc?.fileName ? 'Cambia File' : 'Scegli File'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="px-3.5 py-2 text-slate-400 hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
            >
              {saving ? 'Salvataggio...' : editingDoc ? 'Salva modifiche' : 'Salva documento'}
            </button>
          </div>
        </form>
      )}

      {/* Hidden input for attaching PDF directly to any bill */}
      <input
        ref={billAttachInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.txt"
        onChange={(e) => void handleAttachFileToBill(e.target.files)}
        className="hidden"
      />

      {/* Content: Documents Grid + Shareable Bills Table */}
      {(() => {
        const showBillsSection =
          activeTab === 'bollette' || (activeTab === 'all' && allBillsForSharing.length > 0);
        const showDocsSection = activeTab !== 'bollette';
        const hasAnyContent =
          (showDocsSection && filteredDocuments.length > 0) ||
          (showBillsSection && allBillsForSharing.length > 0);

        const billsTable = showBillsSection && (
          <section className="bg-slate-900/75 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  {activeTab === 'all'
                    ? `Bollette dell'Archivio (${allBillsForSharing.length})`
                    : `Tutte le Bollette Pronte da Scaricare o Condividere (${allBillsForSharing.length})`}
                </h2>
                <p className="text-[11px] text-slate-400">
                  {readOnly
                    ? 'Senza accesso puoi scaricare o condividere il riepilogo HTML; i PDF originali restano privati.'
                    : 'Usa Scarica per ottenere il file (PDF originale se presente, oppure riepilogo HTML) e Condividi per inviarlo.'}
                </p>
              </div>
            </div>

            {allBillsForSharing.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400">
                Nessuna bolletta trovata con questo filtro.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Utenza</th>
                      <th className="px-3 py-2.5 font-medium">Periodo</th>
                      <th className="px-3 py-2.5 font-medium">Fornitore</th>
                      <th className="px-3 py-2.5 font-medium">N° Documento</th>
                      <th className="px-3 py-2.5 font-medium text-right">Totale</th>
                      <th className="px-3 py-2.5 font-medium">PDF Allegato</th>
                      <th className="px-4 py-2.5 font-medium text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {allBillsForSharing.map((b) => {
                      const localFile = vaultMeta[b.fileKey];
                      return (
                        <tr key={b.id} className="hover:bg-slate-800/30">
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                b.kind === 'luce'
                                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                  : b.kind === 'acqua'
                                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {b.kind === 'luce' ? (
                                <Zap className="w-3 h-3" />
                              ) : b.kind === 'acqua' ? (
                                <Droplets className="w-3 h-3" />
                              ) : (
                                <Receipt className="w-3 h-3" />
                              )}
                              {b.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-medium text-slate-100">{b.period}</td>
                          <td className="px-3 py-2.5 text-slate-300">{b.supplier}</td>
                          <td className="px-3 py-2.5 font-mono text-slate-400">
                            <div>#{b.number}</div>
                            <div className="text-[10px]">{b.date}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-100">
                            {b.amount.toFixed(2).replace('.', ',')} €
                          </td>
                          <td className="px-3 py-2.5">
                            {localFile ? (
                              <span
                                title={
                                  localFile.origin === 'firestore'
                                    ? 'Salvato su Firestore (accessibile da tutti i tuoi dispositivi)'
                                    : localFile.origin === 'bundled'
                                      ? 'PDF incluso nell’app (accessibile da tutti i dispositivi)'
                                      : 'Solo cache locale su questo browser'
                                }
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium"
                              >
                                <FileCheck2 className="w-3 h-3" />
                                {readOnly
                                  ? 'PDF originale privato'
                                  : localFile.size > 0
                                    ? `${localFile.origin === 'firestore' ? 'Firestore' : 'PDF'} (${formatFileSize(localFile.size)})`
                                    : 'PDF pronto'}
                              </span>
                            ) : !readOnly ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAttachingBillKey(b.fileKey);
                                  billAttachInputRef.current?.click();
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                              >
                                <FileUp className="w-3 h-3 text-sky-400" />
                                Allega PDF
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-500">Scheda pronta</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  void downloadShareableItem(
                                    readOnly ? { ...b.payload, attachmentKey: undefined } : b.payload
                                  )
                                }
                                title={
                                  readOnly
                                    ? 'Scarica riepilogo HTML'
                                    : localFile
                                      ? `Scarica PDF originale (${localFile.fileName})`
                                      : 'Scarica riepilogo HTML'
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
                              >
                                <Download className="w-3.5 h-3.5 text-sky-400" />
                                Scarica
                              </button>
                              <button
                                type="button"
                                onClick={() => setShareItem(b.payload)}
                                title={
                                  readOnly
                                    ? 'Condividi il riepilogo della bolletta'
                                    : localFile
                                      ? `Condividi bolletta e PDF (${localFile.fileName})`
                                      : 'Condividi riepilogo bolletta'
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 rounded-lg transition-colors"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                Condividi
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );

        if (!hasAnyContent) {
          return (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-3">
              <FolderOpen className="w-8 h-8 text-slate-500 mx-auto" />
              <div className="text-sm font-semibold text-slate-200">
                Nessun documento trovato in questa sezione
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Aggiungi qui i documenti importanti della casa: contratto del mutuo, contratto Wi-Fi WindTre, rogito, polizze assicurative o documenti d&apos;identità per poterli scaricare e inviare in qualsiasi momento.
              </p>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => openNewForm(DOCUMENT_STARTER_TEMPLATES[0])}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Inserisci primo documento
                </button>
              )}
            </div>
          );
        }

        return (
          <div className="space-y-6">
            {showDocsSection && filteredDocuments.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredDocuments.map((doc) => {
                  const meta = CATEGORY_STYLE[doc.category] || CATEGORY_STYLE.Altro;
                  const Icon = meta.icon;
                  const localFile = doc.attachmentKey ? vaultMeta[doc.attachmentKey] : undefined;
                  const sharePayload = buildDocumentSharePayload(doc);

                  return (
                    <article
                      key={doc.id}
                      className="bg-slate-900/75 border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded-md ${meta.badge}`}
                          >
                            <Icon className="w-3 h-3" />
                            {doc.category}
                          </span>

                          <div className="flex items-center gap-1.5">
                            {doc.pinned && (
                              <span
                                title="In evidenza"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded"
                              >
                                <Star className="w-2.5 h-2.5 fill-amber-300" />
                                Top
                              </span>
                            )}
                            {localFile ? (
                              <span
                                title={
                                  localFile.origin === 'firestore'
                                    ? 'Salvato su Firestore (scaricabile anche da altri dispositivi)'
                                    : 'Solo cache locale su questo browser'
                                }
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded"
                              >
                                <FileCheck2 className="w-3 h-3" />
                                {localFile.origin === 'firestore' ? 'Cloud · ' : ''}
                                {formatFileSize(localFile.size) || 'File'}
                              </span>
                            ) : doc.fileName ? (
                              <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-400 rounded">
                                {doc.fileName}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div>
                          <h3 className="text-sm font-bold text-slate-100">{doc.title}</h3>
                          <div className="text-xs text-sky-300 font-medium mt-0.5">{doc.provider}</div>
                        </div>

                        {(doc.referenceCode || doc.issueDate || doc.expiryDate) && (
                          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5 text-[11px] space-y-1">
                            {doc.referenceCode && (
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500">Codice / Pratica:</span>
                                <span className="font-mono text-slate-200 truncate">
                                  {doc.referenceCode}
                                </span>
                              </div>
                            )}
                            {doc.issueDate && (
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500">Data:</span>
                                <span className="font-mono text-slate-300">{doc.issueDate}</span>
                              </div>
                            )}
                            {doc.expiryDate && (
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500">Scadenza:</span>
                                <span className="font-mono text-amber-300">{doc.expiryDate}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {doc.notes && (
                          <p className="text-xs text-slate-400 leading-relaxed">{doc.notes}</p>
                        )}

                        {doc.cloudUrl && (
                          <a
                            href={doc.cloudUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Apri su Cloud / Drive
                          </a>
                        )}
                      </div>

                      <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void downloadShareableItem(
                                readOnly
                                  ? { ...sharePayload, attachmentKey: undefined }
                                  : sharePayload
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
                          >
                            <Download className="w-3.5 h-3.5 text-sky-400" />
                            Scarica
                          </button>
                          <button
                            type="button"
                            onClick={() => setShareItem(sharePayload)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 rounded-lg"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            Condividi
                          </button>
                        </div>

                        {!readOnly && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditForm(doc)}
                              aria-label="Modifica documento"
                              className="p-1.5 text-slate-400 hover:text-sky-300 rounded-lg"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(doc)}
                              aria-label="Elimina documento"
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {billsTable}
          </div>
        );
      })()}

      {shareItem && (
        <ShareSheetModal item={shareItem} readOnly={readOnly} onClose={() => setShareItem(null)} />
      )}

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
                <p className="text-xs text-slate-300 leading-relaxed">
                  Verrà rimosso sia dall&apos;archivio su Firebase che l&apos;eventuale file allegato locale.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
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
