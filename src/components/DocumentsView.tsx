import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Car,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Database,
  Download,
  Droplets,
  ExternalLink,
  FileCheck2,
  FileText,
  FileUp,
  FolderOpen,
  HardDrive,
  Layers,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  Search,
  Share2,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Upload,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import {
  ArticleAttachmentType,
  BillRecord,
  GsePaymentRecord,
  HomeDocumentCategory,
  HomeDocumentRecord,
  ProductResearchRecord,
  TariBillRecord,
  WaterBillRecord,
} from '../types/home';
import {
  isFirestoreQuotaExceededActive,
  subscribeFirestoreQuotaExceeded,
} from '../firebase';
import { resolveApiUrl } from '../utils/apiBase';
import { useAppSettings } from '../utils/appSettings';
import {
  buildDocumentSharePayload,
  buildElectricityBillSharePayload,
  buildTariBillSharePayload,
  buildWaterBillSharePayload,
  DedicatedVaultStorageStatus,
  deleteVaultFile,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STARTER_TEMPLATES,
  DocumentStarterTemplate,
  downloadShareableItem,
  formatFileSize,
  getDedicatedVaultStorageStatus,
  getElectricityBillFileKey,
  getTariBillFileKey,
  getWaterBillFileKey,
  inferArticleAttachmentType,
  isOctopusContractRecord,
  listLocalCachedVaultKeys,
  listVaultFileMetadata,
  matchResearchProductForDocument,
  MAX_CLOUD_FILE_BYTES,
  migrateFirestoreVaultToDedicatedStorage,
  openVaultFileInNewTab,
  precacheAllCloudVaultFiles,
  saveVaultFile,
  ShareableItemPayload,
  VAULT_UPDATED_EVENT,
  VaultFileMeta,
} from '../utils/documentVault';
import {
  BillImportIdentityCandidate,
  extractPdfTextFromBytes,
  getBillImportIdentityKeys,
  ImportedBillDraft,
  parseBillText,
} from '../utils/billImporter';
import {
  buildResearchDocumentRef,
  isCarLinkedDocument,
  parseCarDocumentRef,
  parseResearchDocumentRef,
} from '../utils/carGroceryStore';
import { ShareSheetModal } from './ShareSheetModal';
import { AccessUnlockBanner } from './AccessUnlockBanner';

interface DocumentsViewProps {
  documents: HomeDocumentRecord[];
  electricityBills: BillRecord[];
  waterBills: WaterBillRecord[];
  tariBills: TariBillRecord[];
  gsePayments?: GsePaymentRecord[];
  researches?: ProductResearchRecord[];
  carPlate?: string;
  readOnly?: boolean;
  isGmailConnected?: boolean;
  onSignIn?: () => void;
  onConnectGmail?: () => void;
  onAddDocument: (doc: Omit<HomeDocumentRecord, 'id'>) => Promise<string | void>;
  onUpdateDocument: (id: string, doc: Omit<HomeDocumentRecord, 'id'>) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
  onUploadLinkedDocument?: (doc: Omit<HomeDocumentRecord, 'id'>, file: File) => Promise<void>;
  onAddElectricityBill?: (bill: BillRecord, pdfFile?: File) => Promise<void>;
  onAddWaterBill?: (bill: Omit<WaterBillRecord, 'id'>, pdfFile?: File) => Promise<void>;
  onAddTariBill?: (bill: Omit<TariBillRecord, 'id'>, pdfFile?: File) => Promise<void>;
  onDeleteElectricityBill?: (bill: BillRecord) => Promise<void>;
  onDeleteWaterBill?: (bill: WaterBillRecord) => Promise<void>;
  onDeleteTariBill?: (id: string) => Promise<void>;
  onDeleteGsePayment?: (id: string) => Promise<void>;
}

type OriginKey = 'documenti' | 'ricerche' | 'macchina' | 'bollette';
type OriginFilter = 'all' | OriginKey;
type ViewMode = 'list' | 'grid';

const VIEW_MODE_STORAGE_KEY = 'myhome_documents_view_mode_v1';
const GROUP_BY_PRODUCT_STORAGE_KEY = 'myhome_documents_group_by_product_v1';

interface OriginMeta {
  key: Exclude<OriginKey, 'bollette'>;
  label: string;
  detail: string;
  badgeClass: string;
  groupKey: string;
  groupTitle: string;
  groupSubtitle?: string;
  attachmentTypeLabel?: string;
  imageUrl?: string;
  isApplianceOrArticle?: boolean;
}

interface UnifiedDocumentRow {
  rowKey: string;
  doc: HomeDocumentRecord;
  origin: OriginMeta;
  editable: boolean;
  deletable: boolean;
  fileKey?: string;
  sharePayload: ShareableItemPayload;
}

interface UnifiedBillShareItem {
  id: string;
  kind: 'luce' | 'acqua' | 'tari' | 'gse';
  label: string;
  period: string;
  supplier: string;
  number: string;
  date: string;
  amount: number;
  fileKey: string;
  payload: ShareableItemPayload;
  electricityBill?: BillRecord;
  waterBill?: WaterBillRecord;
  tariBill?: TariBillRecord;
  gsePayment?: GsePaymentRecord;
}

type PendingDeleteTarget =
  | { type: 'document'; doc: HomeDocumentRecord }
  | { type: 'bill'; item: UnifiedBillShareItem };

interface ClassifyApiResponse {
  target: 'bill_luce' | 'bill_acqua' | 'bill_tari' | 'document';
  confidence: 'alta' | 'media' | 'bassa';
  documentCategory: HomeDocumentCategory;
  title: string;
  provider: string;
  referenceCode?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
  matchedProductId?: string;
  attachmentType?: ArticleAttachmentType;
  bill?: {
    supplier?: string;
    offerName?: string;
    invoiceOrNoticeNumber?: string;
    issueDate?: string;
    dueDate?: string;
    period?: string;
    year?: number;
    totalPaid?: number;
    kwh?: number;
    canoneTv?: number;
    cubicMeters?: number;
    fixedCostEur?: number;
  };
  usedAi?: boolean;
}

const PRODUCT_LINK_TYPE_OPTIONS: { value: ArticleAttachmentType; label: string }[] = [
  { value: 'manuale', label: 'Manuale / Scheda tecnica' },
  { value: 'scontrino_fattura', label: 'Scontrino / Fattura' },
  { value: 'garanzia_extra_family', label: 'Garanzia Extra' },
  { value: 'targhetta_pnc', label: 'Targhetta / Seriale' },
  { value: 'altro', label: 'Altro allegato prodotto' },
];

interface SmartImportSummaryItem {
  fileName: string;
  destination: string;
  detail: string;
  status: 'ok' | 'duplicate' | 'error';
}

const CATEGORY_STYLE: Record<
  HomeDocumentCategory,
  { icon: typeof FileText; badge: string }
> = {
  'Mutuo & Casa': {
    icon: Building2,
    badge:
      'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  },
  'Internet & Wi-Fi': {
    icon: Wifi,
    badge:
      'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
  },
  'Contratti & Utenze': {
    icon: FileText,
    badge:
      'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  },
  Assicurazioni: {
    icon: Shield,
    badge:
      'bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30',
  },
  'Fiscale & Identità': {
    icon: FileCheck2,
    badge:
      'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30',
  },
  Altro: {
    icon: FolderOpen,
    badge:
      'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  },
};

function readInitialViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === 'grid' || saved === 'list') return saved;
  } catch {
    // ignore storage errors
  }
  return 'list';
}

function readInitialGroupByProduct(): boolean {
  try {
    const saved = localStorage.getItem(GROUP_BY_PRODUCT_STORAGE_KEY);
    if (saved === 'false') return false;
    if (saved === 'true') return true;
  } catch {
    // ignore storage errors
  }
  return true;
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Impossibile leggere immagine.'));
    reader.readAsDataURL(file);
  });
}

function buildGseSharePayload(payment: GsePaymentRecord): ShareableItemPayload {
  const typeLabel =
    payment.paymentType === 'acconto'
      ? 'Acconto GSE'
      : payment.paymentType === 'conguaglio'
        ? 'Conguaglio GSE'
        : 'Bonifico GSE';
  const amountText = payment.amountEur.toFixed(2).replace('.', ',');
  const lines = [
    `☀️ *${typeLabel} — ${payment.period}*`,
    `Data accredito: ${payment.paymentDate} (Anno ${payment.year})`,
    `Importo accreditato: +${amountText} €`,
    payment.kwhInjected ? `Energia immessa: ${payment.kwhInjected} kWh` : '',
    payment.reference ? `Riferimento: ${payment.reference}` : '',
    payment.note ? `Note: ${payment.note}` : '',
  ].filter(Boolean);

  const html = `<!doctype html>
<html lang="it">
<head><meta charset="utf-8" /><title>${typeLabel} ${payment.period}</title></head>
<body style="font-family:system-ui,sans-serif;margin:32px;color:#0f172a">
  <h1>${typeLabel} — ${payment.period}</h1>
  <p>Data accredito: <strong>${payment.paymentDate}</strong> · Importo: <strong>+${amountText} €</strong></p>
  ${payment.reference ? `<p>Riferimento: ${payment.reference}</p>` : ''}
  ${payment.note ? `<p>Note: ${payment.note}</p>` : ''}
</body>
</html>`;

  const slug = `${payment.year}-${payment.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}`;
  return {
    title: `${typeLabel} ${payment.period}`,
    subtitle: `${payment.paymentDate} · +${amountText} €`,
    shareText: lines.join('\n'),
    htmlDocument: html,
    fallbackFileName: `gse-${slug}.html`,
    attachmentKey: payment.attachmentFileKey,
  };
}

function formatAttachmentTypeLabel(docType?: string): string {
  switch (docType) {
    case 'manuale':
      return 'Manuale';
    case 'scontrino_fattura':
      return 'Scontrino / Fattura';
    case 'garanzia_extra_family':
      return 'Garanzia Extra';
    case 'targhetta_pnc':
      return 'Targhetta / Seriale';
    case 'certificato_assicurazione':
      return 'Certificato Assicurazione';
    case 'attestato_rischio':
      return 'Attestato di Rischio';
    case 'polizza_contratto':
      return 'Polizza / Contratto';
    case 'carta_verde':
      return 'Carta Verde';
    case 'quietanza':
      return 'Quietanza';
    case 'libretto_circolazione':
      return 'Libretto Circolazione';
    default:
      return '';
  }
}

export function DocumentsView({
  documents,
  electricityBills,
  waterBills,
  tariBills,
  gsePayments = [],
  researches = [],
  carPlate = 'EA218ES',
  readOnly = false,
  isGmailConnected = false,
  onSignIn,
  onConnectGmail,
  onAddDocument,
  onUpdateDocument,
  onDeleteDocument,
  onUploadLinkedDocument,
  onAddElectricityBill,
  onAddWaterBill,
  onAddTariBill,
  onDeleteElectricityBill,
  onDeleteWaterBill,
  onDeleteTariBill,
  onDeleteGsePayment,
}: DocumentsViewProps) {
  const { settings: appSettings } = useAppSettings();
  const [activeTab, setActiveTab] = useState<'all' | 'bollette' | 'ricerche' | HomeDocumentCategory>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [groupByProduct, setGroupByProduct] = useState<boolean>(readInitialGroupByProduct);
  const [viewMode, setViewMode] = useState<ViewMode>(readInitialViewMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [vaultMeta, setVaultMeta] = useState<Record<string, VaultFileMeta>>({});
  const [localCachedKeys, setLocalCachedKeys] = useState<Set<string>>(() => new Set());
  const [quotaExceeded, setQuotaExceeded] = useState(() => isFirestoreQuotaExceededActive());
  const [vaultStorageStatus, setVaultStorageStatus] = useState<DedicatedVaultStorageStatus | null>(null);
  const [migratingStorage, setMigratingStorage] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<{ done: number; total: number } | null>(null);
  const [precachingAll, setPrecachingAll] = useState(false);
  const [precacheProgress, setPrecacheProgress] = useState<{
    completed: number;
    total: number;
    currentFileName: string;
  } | null>(null);
  const [openingAttachmentKey, setOpeningAttachmentKey] = useState<string | null>(null);

  // Mobile UX states (< 768px)
  const [showMobileUtilities, setShowMobileUtilities] = useState(false);
  const [mobileFilterSheetOpen, setMobileFilterSheetOpen] = useState(false);
  const [mobileActionTarget, setMobileActionTarget] = useState<
    | { kind: 'doc'; row: UnifiedDocumentRow }
    | { kind: 'bill'; bill: UnifiedBillShareItem }
    | null
  >(null);

  // Add/Edit modal states
  const [showForm, setShowForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState<HomeDocumentRecord | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<HomeDocumentCategory>('Mutuo & Casa');
  const [provider, setProvider] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [linkedResearchId, setLinkedResearchId] = useState('');
  const [linkedDocType, setLinkedDocType] = useState<ArticleAttachmentType>('manuale');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [pinned, setPinned] = useState(false);
  const [localOnlySave, setLocalOnlySave] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Smart Auto-Import states (Files + Link)
  const [autoImporting, setAutoImporting] = useState(false);
  const [importProgressLabel, setImportProgressLabel] = useState<string | null>(null);
  const [smartImportResults, setSmartImportResults] = useState<SmartImportSummaryItem[]>([]);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [importLinkUrl, setImportLinkUrl] = useState('');
  const [importLinkProductChoice, setImportLinkProductChoice] = useState<string>('auto');

  const [shareItem, setShareItem] = useState<ShareableItemPayload | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const formFileInputRef = useRef<HTMLInputElement | null>(null);
  const smartImportInputRef = useRef<HTMLInputElement | null>(null);
  const billAttachInputRef = useRef<HTMLInputElement | null>(null);
  const [attachingBillKey, setAttachingBillKey] = useState<string | null>(null);

  useEffect(() => {
    return subscribeFirestoreQuotaExceeded(setQuotaExceeded);
  }, []);

  useEffect(() => {
    if (readOnly) {
      setVaultStorageStatus(null);
      return;
    }
    let active = true;
    void getDedicatedVaultStorageStatus(true)
      .then((status) => {
        if (active) setVaultStorageStatus(status);
      })
      .catch(() => {
        // fallback cleanly
      });
    return () => {
      active = false;
    };
  }, [readOnly, appSettings.backendApiUrl]);

  useEffect(() => {
    void reloadVaultMeta();
    const onVaultChange = () => {
      void reloadVaultMeta();
    };
    window.addEventListener(VAULT_UPDATED_EVENT, onVaultChange);
    return () => window.removeEventListener(VAULT_UPDATED_EVENT, onVaultChange);
  }, [documents.length, electricityBills.length, waterBills.length, tariBills.length, gsePayments.length]);

  function handleChangeViewMode(nextMode: ViewMode) {
    setViewMode(nextMode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, nextMode);
    } catch {
      // ignore storage errors
    }
  }

  function handleToggleGroupByProduct() {
    setGroupByProduct((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GROUP_BY_PRODUCT_STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  async function reloadVaultMeta() {
    const [meta, cached] = await Promise.all([
      listVaultFileMetadata(),
      listLocalCachedVaultKeys(),
    ]);
    setVaultMeta(meta);
    setLocalCachedKeys(cached);
  }

  async function handleMigrateLegacyStorage() {
    if (migratingStorage || readOnly) return;
    setMigratingStorage(true);
    setStatusNotice(null);
    setMigrationProgress({ done: 0, total: 0 });
    try {
      const res = await migrateFirestoreVaultToDedicatedStorage((done, total) => {
        setMigrationProgress({ done, total });
      });
      await reloadVaultMeta();
      setStatusNotice(
        `Migrazione verso ${res.providerLabel} completata: ${res.migrated} file trasferiti da Firestore (${res.failed} errori). Ora puoi risparmiare spazio e quota su Firebase!`
      );
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Errore durante la migrazione verso storage esterno.'
      );
    } finally {
      setMigratingStorage(false);
      setMigrationProgress(null);
    }
  }

  async function handlePrecacheAllOffline() {
    if (precachingAll) return;
    if (isFirestoreQuotaExceededActive()) {
      setStatusNotice(
        'Quota lettura/scrittura Firebase attualmente esaurita: impossibile scaricare ora i file mancanti dal cloud. I file già in cache locale restano subito apribili; riprova dopo il reset alle 09:00 IT.'
      );
      return;
    }
    setPrecachingAll(true);
    setStatusNotice(null);
    setPrecacheProgress({ completed: 0, total: 0, currentFileName: 'Verifica archivio...' });
    try {
      const res = await precacheAllCloudVaultFiles(undefined, setPrecacheProgress);
      await reloadVaultMeta();
      if (res.quotaHit) {
        setStatusNotice(
          `Download offline interrotto per esaurimento quota Firebase (${res.cached} nuovi salvati in cache; totale locale ${res.alreadyCached + res.cached}/${res.totalCloud}). I rimanenti potranno essere scaricati al ripristino alle 09:00 IT.`
        );
      } else if (res.cached === 0 && res.errors === 0) {
        setStatusNotice(
          `Tutti i ${res.totalCloud} file presenti su cloud sono già salvati offline su questo dispositivo.`
        );
      } else {
        setStatusNotice(
          `Cache offline aggiornata: scaricati ${res.cached} nuovi file (disponibili offline ${res.alreadyCached + res.cached}/${res.totalCloud}${res.errors > 0 ? `, ${res.errors} non disponibili` : ''}).`
        );
      }
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Errore durante il download offline dei documenti.'
      );
    } finally {
      setPrecachingAll(false);
      setPrecacheProgress(null);
    }
  }

  function resetForm() {
    setEditingDoc(null);
    setTitle('');
    setCategory('Mutuo & Casa');
    setProvider('');
    setReferenceCode('');
    setLinkedResearchId('');
    setLinkedDocType('manuale');
    setIssueDate('');
    setExpiryDate('');
    setCloudUrl('');
    setNotes('');
    setPinned(false);
    setLocalOnlySave(false);
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
    } else if (activeTab !== 'all' && activeTab !== 'bollette' && activeTab !== 'ricerche') {
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
    const parsedResearch = parseResearchDocumentRef(doc.referenceCode);
    if (parsedResearch) {
      setLinkedResearchId(parsedResearch.researchId);
      setLinkedDocType(parsedResearch.docType || 'manuale');
    } else {
      setLinkedResearchId('');
      setLinkedDocType('manuale');
    }
    setIssueDate(doc.issueDate || '');
    setExpiryDate(doc.expiryDate || '');
    setCloudUrl(doc.cloudUrl || '');
    setNotes(doc.notes || '');
    setPinned(Boolean(doc.pinned));
    setLocalOnlySave(false);
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
          pendingFile.type,
          undefined,
          localOnlySave ? { storageMode: 'local' } : undefined
        );
        if (!localOnlySave && !stored.cloudSynced) {
          throw new Error(
            'Il file allegato non è stato salvato sul cloud. Nessuna modifica salvata.'
          );
        }
        fileName = stored.fileName;
        fileMime = stored.mimeType || 'application/octet-stream';
        fileSize = stored.size;
        if (localOnlySave) {
          cloudInfo = ' File salvato SOLO in locale su questo dispositivo (0 operazioni Firestore).';
        } else if (stored.storageBackend === 's3') {
          cloudInfo = ` File salvato su ${vaultStorageStatus?.providerLabel || 'Backblaze B2'} (0 MB su Firestore).`;
        } else {
          cloudInfo = isFirestoreQuotaExceededActive()
            ? ' File salvato in locale per quota Firestore esaurita (invio automatico al ripristino).'
            : ' File salvato e compresso sul cloud (scaricabile da ogni dispositivo).';
        }
      }

      const effectiveReferenceCode = linkedResearchId
        ? buildResearchDocumentRef(linkedResearchId, linkedDocType)
        : referenceCode.trim().startsWith('RES:')
          ? undefined
          : referenceCode.trim().slice(0, 80) || undefined;

      const payload: Omit<HomeDocumentRecord, 'id'> = {
        title: title.trim().slice(0, 80),
        category,
        provider: provider.trim().slice(0, 80),
        referenceCode: effectiveReferenceCode,
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
        setStatusNotice(
          isFirestoreQuotaExceededActive() && !cloudInfo
            ? `Quota Firestore esaurita: "${payload.title}" aggiornato in locale (invio automatico al ripristino).`
            : `Documento "${payload.title}" aggiornato.${cloudInfo}`
        );
      } else {
        await onAddDocument(payload);
        setStatusNotice(
          isFirestoreQuotaExceededActive() && !cloudInfo
            ? `Quota Firestore esaurita: "${payload.title}" salvato in locale (invio automatico al ripristino).`
            : `Documento "${payload.title}" salvato nell'archivio.${cloudInfo}`
        );
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

  async function handleOpenAttachment(
    attachmentKey?: string,
    cloudUrl?: string,
    fallbackName?: string
  ) {
    const busyId = attachmentKey || cloudUrl || fallbackName || 'opening';
    setOpeningAttachmentKey(busyId);
    setStatusNotice(null);
    try {
      const opened = await openVaultFileInNewTab(attachmentKey, cloudUrl, fallbackName);
      if (!opened) {
        setStatusNotice(
          attachmentKey && isFirestoreQuotaExceededActive()
            ? 'Allegato non ancora presente nella cache locale di questo dispositivo e quota lettura Firebase esaurita: usa "Scarica tutti offline" quando la quota si resetta.'
            : 'Allegato originale non disponibile in archivio: usa Scarica per generare il riepilogo HTML.'
        );
      }
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Impossibile aprire il file in una nuova scheda.'
      );
    } finally {
      setOpeningAttachmentKey(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setStatusNotice(null);
    try {
      if (pendingDelete.type === 'document') {
        const target = pendingDelete.doc;
        if (target.attachmentKey) {
          await deleteVaultFile(target.attachmentKey);
        }
        await onDeleteDocument(target.id);
        setStatusNotice(
          isFirestoreQuotaExceededActive()
            ? `Quota Firestore esaurita: "${target.title}" rimosso in locale (sincronizzazione eliminazione al ripristino).`
            : `Documento "${target.title}" eliminato definitivamente.`
        );
      } else {
        const item = pendingDelete.item;
        if (item.kind === 'luce' && item.electricityBill && onDeleteElectricityBill) {
          await onDeleteElectricityBill(item.electricityBill);
          setStatusNotice(
            `Bolletta Luce #${item.number} (${item.period}) rimossa da Bollette e Documenti.`
          );
        } else if (item.kind === 'acqua' && item.waterBill && onDeleteWaterBill) {
          await onDeleteWaterBill(item.waterBill);
          setStatusNotice(
            `Bolletta Acqua #${item.number} (${item.period}) rimossa da Bollette e Documenti.`
          );
        } else if (item.kind === 'tari' && item.tariBill && onDeleteTariBill) {
          if (item.fileKey) await deleteVaultFile(item.fileKey);
          await onDeleteTariBill(item.tariBill.id);
          setStatusNotice(
            `Avviso TARI #${item.number} (${item.period}) rimosso da Bollette e Documenti.`
          );
        } else if (item.kind === 'gse' && item.gsePayment && onDeleteGsePayment) {
          if (item.fileKey) await deleteVaultFile(item.fileKey);
          await onDeleteGsePayment(item.gsePayment.id);
          setStatusNotice(`Bonifico GSE "${item.period}" rimosso da Bollette e Documenti.`);
        } else if (item.fileKey) {
          await deleteVaultFile(item.fileKey);
          setStatusNotice(`Allegato "${item.period}" rimosso dall'archivio.`);
        }
      }
      setPendingDelete(null);
      await reloadVaultMeta();
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Errore durante l’eliminazione.');
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
        isFirestoreQuotaExceededActive()
          ? `Quota Firestore esaurita: file "${file.name}" salvato in locale (invio automatico su Firestore al ripristino).`
          : `File "${file.name}" salvato su Firestore: disponibile in Bollette e Documenti da qualsiasi dispositivo.`
      );
      await reloadVaultMeta();
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Errore durante il caricamento del file.');
    } finally {
      setAttachingBillKey(null);
      if (billAttachInputRef.current) billAttachInputRef.current.value = '';
    }
  }

  function isStrongLocalBillMatch(draft: ImportedBillDraft, rawText: string, fileName: string): boolean {
    if (draft.confidence !== 'alta') return false;
    const lowerText = rawText.toLowerCase();
    const lowerName = fileName.toLowerCase();
    if (draft.kind === 'luce') {
      if (isOctopusContractRecord(draft.data)) return false;
      return Boolean(
        draft.data.invoiceNumber.trim() &&
          draft.data.kwh > 0 &&
          draft.data.totalPaid > 0 &&
          (lowerText.includes('energia') ||
            lowerText.includes('bolletta') ||
            lowerText.includes('fattura') ||
            lowerText.includes('kwh') ||
            lowerText.includes('pod') ||
            lowerName.includes('bolletta') ||
            lowerName.includes('luce'))
      );
    }
    if (draft.kind === 'acqua') {
      return Boolean(
        draft.data.invoiceNumber.trim() &&
          draft.data.cubicMeters > 0 &&
          draft.data.totalPaid > 0
      );
    }
    return Boolean(
      draft.data.noticeNumber.trim() &&
        draft.data.totalPaid > 0 &&
        (lowerText.includes('tari') ||
          lowerText.includes('rifiuti') ||
          lowerName.includes('tari'))
    );
  }

  async function saveClassifiedBill(
    kind: 'luce' | 'acqua' | 'tari',
    file: File,
    extractedText: string,
    classification: ClassifyApiResponse | null,
    seenBillKeys: Set<string>
  ): Promise<{ saved: boolean; duplicate?: boolean; label: string; detail: string }> {
    const parsedDraft = parseBillText(extractedText, file.name, kind)[0];
    const aiBill = classification?.bill;

    if (kind === 'luce') {
      const baseData: BillRecord = parsedDraft && parsedDraft.kind === 'luce'
        ? { ...parsedDraft.data }
        : {
            invoiceNumber: (aiBill?.invoiceOrNoticeNumber || `LUCE_${Date.now().toString().slice(-6)}`).slice(0, 40),
            issueDate: (aiBill?.issueDate || classification?.issueDate || new Date().toLocaleDateString('it-IT')).slice(0, 20),
            sortKey: `${aiBill?.year || new Date().getFullYear()}-01`,
            year: Number(aiBill?.year) > 2000 ? Number(aiBill?.year) : new Date().getFullYear(),
            period: (aiBill?.period || classification?.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 80),
            supplier: (aiBill?.supplier || classification?.provider || 'Fornitore Luce').slice(0, 80),
            offerName: (aiBill?.offerName || 'Importata Auto').slice(0, 80),
            kwh: Number(aiBill?.kwh) > 0 ? Math.round(Number(aiBill?.kwh)) : 0,
            punText: '—',
            variableCostPerKwh: 0.16,
            canoneTv: Number(aiBill?.canoneTv) >= 0 ? Number(aiBill?.canoneTv) : 0,
            electricityOnly: 0,
            totalPaid: Number(aiBill?.totalPaid) > 0 ? Number(aiBill?.totalPaid) : 0,
            note: `Importata automaticamente da Documenti (${file.name})`.slice(0, 240),
          };

      if (aiBill) {
        if (baseData.totalPaid <= 0 && Number(aiBill.totalPaid) > 0) baseData.totalPaid = Number(aiBill.totalPaid);
        if (baseData.kwh <= 0 && Number(aiBill.kwh) > 0) baseData.kwh = Math.round(Number(aiBill.kwh));
        if (!baseData.supplier && aiBill.supplier) baseData.supplier = aiBill.supplier.slice(0, 80);
        if (aiBill.invoiceOrNoticeNumber && /^IMP_|^LUCE_/i.test(baseData.invoiceNumber)) {
          baseData.invoiceNumber = aiBill.invoiceOrNoticeNumber.slice(0, 40);
        }
        if (aiBill.period && /^Bolletta \d{4}$/i.test(baseData.period)) {
          baseData.period = aiBill.period.slice(0, 80);
        }
      }
      baseData.electricityOnly = Math.max(
        0,
        Math.round((baseData.totalPaid - baseData.canoneTv) * 100) / 100
      );
      if (baseData.kwh > 0 && baseData.electricityOnly > 0) {
        baseData.variableCostPerKwh =
          Math.round((baseData.electricityOnly / baseData.kwh) * 1000) / 1000;
      }

      const keys = getBillImportIdentityKeys({ kind: 'luce', data: baseData });
      if (keys.some((k) => seenBillKeys.has(k))) {
        return { saved: false, duplicate: true, label: 'Bollette Luce & Documenti', detail: `Fattura #${baseData.invoiceNumber} già presente.` };
      }
      if (!onAddElectricityBill || baseData.totalPaid <= 0) {
        return { saved: false, label: 'Documenti', detail: 'Importo luce non leggibile: salvata nei documenti.' };
      }
      await onAddElectricityBill(baseData, file);
      keys.forEach((k) => seenBillKeys.add(k));
      return {
        saved: true,
        label: 'Bollette Luce + Documenti',
        detail: `${baseData.supplier} · ${baseData.period} (${baseData.totalPaid.toFixed(2).replace('.', ',')} €)`,
      };
    }

    if (kind === 'acqua') {
      const baseData: Omit<WaterBillRecord, 'id'> = parsedDraft && parsedDraft.kind === 'acqua'
        ? { ...parsedDraft.data }
        : {
            invoiceNumber: (aiBill?.invoiceOrNoticeNumber || `H2O_${Date.now().toString().slice(-6)}`).slice(0, 40),
            issueDate: (aiBill?.issueDate || classification?.issueDate || new Date().toLocaleDateString('it-IT')).slice(0, 20),
            year: Number(aiBill?.year) > 2000 ? Number(aiBill?.year) : new Date().getFullYear(),
            period: (aiBill?.period || classification?.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 80),
            cubicMeters: Number(aiBill?.cubicMeters) >= 0 ? Number(aiBill?.cubicMeters) : 0,
            fixedCostEur: Number(aiBill?.fixedCostEur) >= 0 ? Number(aiBill?.fixedCostEur) : 0,
            totalPaid: Number(aiBill?.totalPaid) > 0 ? Number(aiBill?.totalPaid) : 0,
            note: `Importata automaticamente da Documenti (${file.name})`.slice(0, 240),
          };

      if (aiBill) {
        if (baseData.totalPaid <= 0 && Number(aiBill.totalPaid) > 0) baseData.totalPaid = Number(aiBill.totalPaid);
        if (baseData.cubicMeters <= 0 && Number(aiBill.cubicMeters) > 0) baseData.cubicMeters = Number(aiBill.cubicMeters);
        if (aiBill.invoiceOrNoticeNumber && /^H2O_/i.test(baseData.invoiceNumber)) {
          baseData.invoiceNumber = aiBill.invoiceOrNoticeNumber.slice(0, 40);
        }
      }

      const keys = getBillImportIdentityKeys({ kind: 'acqua', data: baseData });
      if (keys.some((k) => seenBillKeys.has(k))) {
        return { saved: false, duplicate: true, label: 'Bollette Acqua & Documenti', detail: `Fattura #${baseData.invoiceNumber} già presente.` };
      }
      if (!onAddWaterBill || baseData.totalPaid <= 0) {
        return { saved: false, label: 'Documenti', detail: 'Importo acqua non leggibile: salvata nei documenti.' };
      }
      await onAddWaterBill(baseData, file);
      keys.forEach((k) => seenBillKeys.add(k));
      return {
        saved: true,
        label: 'Bollette Acqua + Documenti',
        detail: `${baseData.period} · ${baseData.cubicMeters} m³ (${baseData.totalPaid.toFixed(2).replace('.', ',')} €)`,
      };
    }

    const baseData: Omit<TariBillRecord, 'id'> = parsedDraft && parsedDraft.kind === 'tari'
      ? { ...parsedDraft.data }
      : {
          noticeNumber: (aiBill?.invoiceOrNoticeNumber || `TARI_${Date.now().toString().slice(-6)}`).slice(0, 50),
          issueDate: (aiBill?.issueDate || classification?.issueDate || new Date().toLocaleDateString('it-IT')).slice(0, 20),
          dueDate: (aiBill?.dueDate || classification?.expiryDate || new Date().toLocaleDateString('it-IT')).slice(0, 20),
          year: Number(aiBill?.year) > 2000 ? Number(aiBill?.year) : new Date().getFullYear(),
          period: (aiBill?.period || classification?.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 80),
          supplier: (aiBill?.supplier || classification?.provider || 'AcegasApsAmga / TARI').slice(0, 80),
          totalPaid: Number(aiBill?.totalPaid) > 0 ? Number(aiBill?.totalPaid) : 0,
          paid: false,
          source: 'manuale',
          note: `Importata automaticamente da Documenti (${file.name})`.slice(0, 240),
        };

    if (aiBill) {
      if (baseData.totalPaid <= 0 && Number(aiBill.totalPaid) > 0) baseData.totalPaid = Number(aiBill.totalPaid);
      if (aiBill.invoiceOrNoticeNumber && /^TARI_/i.test(baseData.noticeNumber)) {
        baseData.noticeNumber = aiBill.invoiceOrNoticeNumber.slice(0, 50);
      }
    }

    const keys = getBillImportIdentityKeys({ kind: 'tari', data: baseData });
    if (keys.some((k) => seenBillKeys.has(k))) {
      return { saved: false, duplicate: true, label: 'Bollette TARI & Documenti', detail: `Avviso #${baseData.noticeNumber} già presente.` };
    }
    if (!onAddTariBill || baseData.totalPaid <= 0) {
      return { saved: false, label: 'Documenti', detail: 'Importo TARI non leggibile: salvato nei documenti.' };
    }
    await onAddTariBill(baseData, file);
    keys.forEach((k) => seenBillKeys.add(k));
    return {
      saved: true,
      label: 'Bollette TARI + Documenti',
      detail: `${baseData.period} (${baseData.totalPaid.toFixed(2).replace('.', ',')} €)`,
    };
  }

  function getProductsClassifyPayload() {
    return researches.slice(0, 80).map((r) => ({
      id: r.id,
      title: r.title,
      brand: r.brand,
      model: r.model,
      url: r.url,
    }));
  }

  function resolveProductMatchAndType(
    choice: string,
    classification: ClassifyApiResponse | null,
    hints: {
      fileName?: string;
      title?: string;
      provider?: string;
      cloudUrl?: string;
      textContent?: string;
      notes?: string;
    }
  ): { product: ProductResearchRecord | null; attachType: ArticleAttachmentType } {
    let product: ProductResearchRecord | null = null;
    if (choice === 'none') {
      product = null;
    } else if (choice && choice !== 'auto') {
      product = researches.find((r) => r.id === choice) || null;
    } else {
      if (classification?.matchedProductId) {
        product = researches.find((r) => r.id === classification.matchedProductId) || null;
      }
      if (!product) {
        product = matchResearchProductForDocument(hints, researches);
      }
    }

    const combinedHints = [
      hints.fileName,
      hints.title,
      classification?.title,
      hints.cloudUrl,
      hints.notes,
      (hints.textContent || '').slice(0, 2000),
    ]
      .filter(Boolean)
      .join(' ');
    const attachType: ArticleAttachmentType =
      classification?.attachmentType && classification.attachmentType !== 'altro'
        ? classification.attachmentType
        : inferArticleAttachmentType(combinedHints);

    return { product, attachType };
  }

  async function saveClassifiedAsDocument(
    file: File,
    classification: ClassifyApiResponse,
    matchedProduct?: ProductResearchRecord | null,
    attachType?: ArticleAttachmentType,
    cloudUrl?: string
  ): Promise<void> {
    const cleanTitle = (classification.title || file.name.replace(/\.[^.]+$/, '') || 'Documento casa').slice(0, 80);
    const effectiveType = attachType || 'manuale';
    const cleanProvider = (
      matchedProduct?.brand ||
      classification.provider ||
      (matchedProduct ? 'Prodotti' : 'Archivio Casa')
    ).slice(0, 80);
    const effectiveCategory: HomeDocumentCategory = matchedProduct
      ? effectiveType === 'garanzia_extra_family'
        ? 'Assicurazioni'
        : DOCUMENT_CATEGORIES.includes(classification.documentCategory) &&
            classification.documentCategory !== 'Altro'
          ? classification.documentCategory
          : 'Altro'
      : DOCUMENT_CATEGORIES.includes(classification.documentCategory)
        ? classification.documentCategory
        : 'Altro';
    const docPayload: Omit<HomeDocumentRecord, 'id'> = {
      title: cleanTitle,
      category: effectiveCategory,
      provider: cleanProvider,
      referenceCode: matchedProduct
        ? buildResearchDocumentRef(matchedProduct.id, effectiveType)
        : classification.referenceCode?.trim().slice(0, 80) || undefined,
      issueDate:
        classification.issueDate?.trim().slice(0, 20) ||
        (matchedProduct ? new Date().toLocaleDateString('it-IT') : undefined),
      expiryDate: classification.expiryDate?.trim().slice(0, 20) || undefined,
      cloudUrl: cloudUrl?.trim() || undefined,
      notes: classification.notes?.trim().slice(0, 180) || undefined,
      pinned: Boolean(
        matchedProduct &&
          (effectiveType === 'scontrino_fattura' || effectiveType === 'garanzia_extra_family')
      ),
      fileName: file.name,
      fileMime: file.type || 'application/octet-stream',
      fileSize: file.size,
    };

    if (onUploadLinkedDocument) {
      await onUploadLinkedDocument(docPayload, file);
      return;
    }

    const attachmentKey = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const stored = await saveVaultFile(attachmentKey, file, file.name, file.type);
    if (!stored.cloudSynced) {
      throw new Error(`Il file "${file.name}" non è stato salvato su Firestore.`);
    }
    await onAddDocument({
      ...docPayload,
      attachmentKey,
      fileName: stored.fileName,
      fileMime: stored.mimeType,
      fileSize: stored.size,
    });
  }

  async function handleSmartImportFiles(files: FileList | null) {
    if (!files || files.length === 0 || readOnly) return;
    const selectedFiles = Array.from(files);
    setAutoImporting(true);
    setStatusNotice(null);
    setSmartImportResults([]);

    const existingCandidates: BillImportIdentityCandidate[] = [
      ...electricityBills.map((data) => ({ kind: 'luce' as const, data })),
      ...waterBills.map((data) => ({ kind: 'acqua' as const, data })),
      ...tariBills.map((data) => ({ kind: 'tari' as const, data })),
    ];
    const seenBillKeys = new Set(
      existingCandidates.flatMap((c) => getBillImportIdentityKeys(c))
    );
    const productsPayload = getProductsClassifyPayload();

    const summary: SmartImportSummaryItem[] = [];

    try {
      for (let idx = 0; idx < selectedFiles.length; idx++) {
        const file = selectedFiles[idx];
        setImportProgressLabel(
          `Analisi e archiviazione (${idx + 1}/${selectedFiles.length}): ${file.name}`
        );

        const maxImportBytes = vaultStorageStatus?.configured
          ? vaultStorageStatus.maxFileBytes
          : MAX_CLOUD_FILE_BYTES;
        if (file.size > maxImportBytes) {
          summary.push({
            fileName: file.name,
            destination: 'Non importato',
            detail: `Supera il limite di ${Math.floor(maxImportBytes / 1_000_000)} MB su ${
              vaultStorageStatus?.configured ? vaultStorageStatus.providerLabel : 'Firestore'
            }.`,
            status: 'error',
          });
          continue;
        }

        try {
          let extractedText = '';
          let imageBase64 = '';
          const pdfFile = isPdfFile(file);

          if (pdfFile) {
            try {
              const buffer = await file.arrayBuffer();
              extractedText = await extractPdfTextFromBytes(new Uint8Array(buffer), 6);
            } catch {
              extractedText = '';
            }

            // 1) Zero-AI local check for clear utility bills (Luce / Acqua / TARI)
            if (extractedText.trim()) {
              const localDrafts = parseBillText(extractedText, file.name);
              const strongDraft = localDrafts.find((d) =>
                isStrongLocalBillMatch(d, extractedText, file.name)
              );
              if (strongDraft) {
                const resBill = await saveClassifiedBill(
                  strongDraft.kind,
                  file,
                  extractedText,
                  null,
                  seenBillKeys
                );
                if (resBill.duplicate) {
                  summary.push({
                    fileName: file.name,
                    destination: resBill.label,
                    detail: resBill.detail,
                    status: 'duplicate',
                  });
                  continue;
                }
                if (resBill.saved) {
                  summary.push({
                    fileName: file.name,
                    destination: resBill.label,
                    detail: `${resBill.detail} · riconoscimento locale 0 crediti AI`,
                    status: 'ok',
                  });
                  continue;
                }
              }
            }
          } else if (file.type.startsWith('image/')) {
            try {
              imageBase64 = await readFileAsDataUrl(file);
            } catch {
              imageBase64 = '';
            }
          } else if (
            file.type.startsWith('text/') ||
            /\.(txt|csv|json|md)$/i.test(file.name)
          ) {
            try {
              extractedText = (await file.text()).slice(0, 18_000);
            } catch {
              extractedText = '';
            }
          }

          // 2) Server-side smart classifier (AI Gemini con fallback deterministico + abbinamento prodotti)
          const classifyApiUrl = resolveApiUrl('/api/documents/classify');
          const response = classifyApiUrl
            ? await fetch(classifyApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileName: file.name,
                  mimeType: file.type || (pdfFile ? 'application/pdf' : 'application/octet-stream'),
                  textContent: extractedText.slice(0, 18_000),
                  imageBase64: imageBase64 || undefined,
                  products: productsPayload,
                }),
              })
            : null;

          const classification: ClassifyApiResponse = response?.ok
            ? ((await response.json()) as ClassifyApiResponse)
            : {
                target: 'document',
                confidence: 'bassa',
                documentCategory: 'Altro',
                title: file.name.replace(/\.[^.]+$/, '') || 'Documento casa',
                provider: 'Archivio Casa',
                notes: 'Importato automaticamente.',
              };

          if (
            (classification.target === 'bill_luce' ||
              classification.target === 'bill_acqua' ||
              classification.target === 'bill_tari') &&
            pdfFile &&
            classification.confidence !== 'bassa'
          ) {
            const billKind =
              classification.target === 'bill_luce'
                ? 'luce'
                : classification.target === 'bill_acqua'
                  ? 'acqua'
                  : 'tari';
            const resBill = await saveClassifiedBill(
              billKind,
              file,
              extractedText,
              classification,
              seenBillKeys
            );
            if (resBill.duplicate) {
              summary.push({
                fileName: file.name,
                destination: resBill.label,
                detail: resBill.detail,
                status: 'duplicate',
              });
              continue;
            }
            if (resBill.saved) {
              summary.push({
                fileName: file.name,
                destination: resBill.label,
                detail: resBill.detail,
                status: 'ok',
              });
              continue;
            }
            await saveClassifiedAsDocument(file, {
              ...classification,
              target: 'document',
              documentCategory: 'Contratti & Utenze',
              notes:
                classification.notes ||
                'Documento bolletta archiviato in Documenti (importo/consumo non completo per registro numerico Bollette).',
            });
            summary.push({
              fileName: file.name,
              destination: 'Documenti · Contratti & Utenze',
              detail: resBill.detail,
              status: 'ok',
            });
            continue;
          }

          const { product: matchedProduct, attachType } = resolveProductMatchAndType(
            'auto',
            classification,
            {
              fileName: file.name,
              title: classification.title,
              provider: classification.provider,
              textContent: extractedText,
              notes: classification.notes,
            }
          );

          await saveClassifiedAsDocument(
            file,
            {
              ...classification,
              documentCategory:
                classification.target !== 'document'
                  ? 'Contratti & Utenze'
                  : classification.documentCategory,
              notes:
                classification.target !== 'document' && !pdfFile
                  ? `${classification.notes ? `${classification.notes} · ` : ''}Foto/scansione salvata in Documenti (il registro Bollette accetta PDF originali).`.slice(0, 180)
                  : classification.notes,
            },
            matchedProduct,
            attachType
          );

          if (matchedProduct) {
            summary.push({
              fileName: file.name,
              destination: `Documenti · Prodotti → ${matchedProduct.title}`,
              detail: `${classification.title} (${formatAttachmentTypeLabel(attachType) || 'Allegato prodotto'})`,
              status: 'ok',
            });
          } else {
            summary.push({
              fileName: file.name,
              destination: `Documenti · ${
                classification.target !== 'document'
                  ? 'Contratti & Utenze'
                  : classification.documentCategory
              }`,
              detail: `${classification.title} (${classification.provider})`,
              status: 'ok',
            });
          }
        } catch (fileErr) {
          summary.push({
            fileName: file.name,
            destination: 'Errore importazione',
            detail:
              fileErr instanceof Error ? fileErr.message : 'Errore imprevisto durante il caricamento.',
            status: 'error',
          });
        }
      }

      await reloadVaultMeta();
      setSmartImportResults(summary);
    } finally {
      setAutoImporting(false);
      setImportProgressLabel(null);
      if (smartImportInputRef.current) smartImportInputRef.current.value = '';
    }
  }

  async function handleSmartImportUrl(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const rawTrim = importLinkUrl.trim();
    if (!rawTrim) return;
    let cleanUrl = '';
    try {
      const candidate = /^https?:\/\//i.test(rawTrim) ? rawTrim : `https://${rawTrim}`;
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        cleanUrl = parsed.toString();
      }
    } catch {
      cleanUrl = '';
    }
    if (!cleanUrl) {
      setStatusNotice('Inserisci un link HTTP/HTTPS valido (es. https://...).');
      return;
    }

    setAutoImporting(true);
    setStatusNotice(null);
    setSmartImportResults([]);
    setImportProgressLabel(`Analisi del link: ${cleanUrl}`);

    const productsPayload = getProductsClassifyPayload();
    const existingCandidates: BillImportIdentityCandidate[] = [
      ...electricityBills.map((data) => ({ kind: 'luce' as const, data })),
      ...waterBills.map((data) => ({ kind: 'acqua' as const, data })),
      ...tariBills.map((data) => ({ kind: 'tari' as const, data })),
    ];
    const seenBillKeys = new Set(
      existingCandidates.flatMap((c) => getBillImportIdentityKeys(c))
    );

    try {
      // 1) Try binary download first (e.g. direct PDF / datasheet / ZIP / image link)
      let downloadedFile: File | null = null;
      const fetchDocApiUrl = resolveApiUrl('/api/researches/fetch-document');
      try {
        const dlResp = fetchDocApiUrl
          ? await fetch(fetchDocApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: cleanUrl }),
            })
          : await fetch(cleanUrl, { method: 'GET', mode: 'cors' });
        const dlCt = (dlResp.headers.get('content-type') || '').toLowerCase();
        if (dlResp.ok && !dlCt.includes('application/json') && !dlCt.includes('text/html')) {
          const blob = await dlResp.blob();
          const maxImportBytes = vaultStorageStatus?.configured
            ? vaultStorageStatus.maxFileBytes
            : MAX_CLOUD_FILE_BYTES;
          if (blob.size > 0 && blob.size <= maxImportBytes) {
            const rawHeaderName =
              dlResp.headers.get('x-document-filename') ||
              dlResp.headers.get('content-disposition')?.match(
                /filename\*?=(?:UTF-8''|["']?)([^"';\r\n]+)["']?/i
              )?.[1];
            let fileName = '';
            if (rawHeaderName) {
              try {
                fileName = decodeURIComponent(rawHeaderName).trim();
              } catch {
                fileName = rawHeaderName.trim();
              }
            }
            if (!fileName) {
              try {
                const seg = decodeURIComponent(new URL(cleanUrl).pathname.split('/').pop() || '').trim();
                if (seg && seg.includes('.')) fileName = seg;
              } catch {
                // ignore URL parse error
              }
            }
            if (!fileName) {
              fileName = `documento-link-${Date.now().toString().slice(-5)}.${dlCt.includes('zip') ? 'zip' : 'pdf'}`;
            }
            downloadedFile = new File([blob], fileName, {
              type: dlCt.split(';')[0] || 'application/pdf',
            });
          }
        }
      } catch {
        // Fallback to HTML metadata inspection below
      }

      if (downloadedFile) {
        const pdfFile = isPdfFile(downloadedFile);
        let extractedText = '';
        let imageBase64 = '';
        if (pdfFile) {
          try {
            const buf = await downloadedFile.arrayBuffer();
            extractedText = await extractPdfTextFromBytes(new Uint8Array(buf), 6);
          } catch {
            extractedText = '';
          }
          if (extractedText.trim() && importLinkProductChoice === 'auto') {
            const localDrafts = parseBillText(extractedText, downloadedFile.name);
            const strongDraft = localDrafts.find((d) =>
              isStrongLocalBillMatch(d, extractedText, downloadedFile!.name)
            );
            if (strongDraft) {
              const resBill = await saveClassifiedBill(
                strongDraft.kind,
                downloadedFile,
                extractedText,
                null,
                seenBillKeys
              );
              if (resBill.duplicate || resBill.saved) {
                setSmartImportResults([
                  {
                    fileName: downloadedFile.name,
                    destination: resBill.label,
                    detail: resBill.detail,
                    status: resBill.duplicate ? 'duplicate' : 'ok',
                  },
                ]);
                if (resBill.saved) setImportLinkUrl('');
                await reloadVaultMeta();
                return;
              }
            }
          }
        } else if (downloadedFile.type.startsWith('image/')) {
          try {
            imageBase64 = await readFileAsDataUrl(downloadedFile);
          } catch {
            imageBase64 = '';
          }
        }

        const classifyApiUrl = resolveApiUrl('/api/documents/classify');
        const clsResp = classifyApiUrl
          ? await fetch(classifyApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileName: downloadedFile.name,
                mimeType: downloadedFile.type || (pdfFile ? 'application/pdf' : 'application/octet-stream'),
                textContent: extractedText.slice(0, 18_000),
                imageBase64: imageBase64 || undefined,
                cloudUrl: cleanUrl,
                products: productsPayload,
              }),
            })
          : null;
        const classification: ClassifyApiResponse = clsResp?.ok
          ? ((await clsResp.json()) as ClassifyApiResponse)
          : {
              target: 'document',
              confidence: 'bassa',
              documentCategory: 'Altro',
              title: downloadedFile.name.replace(/\.[^.]+$/, '') || 'Documento da link',
              provider: new URL(cleanUrl).hostname.replace(/^www\./, ''),
              notes: 'Scaricato automaticamente da link.',
            };

        if (
          importLinkProductChoice === 'auto' &&
          (classification.target === 'bill_luce' ||
            classification.target === 'bill_acqua' ||
            classification.target === 'bill_tari') &&
          pdfFile &&
          classification.confidence !== 'bassa'
        ) {
          const billKind =
            classification.target === 'bill_luce'
              ? 'luce'
              : classification.target === 'bill_acqua'
                ? 'acqua'
                : 'tari';
          const resBill = await saveClassifiedBill(
            billKind,
            downloadedFile,
            extractedText,
            classification,
            seenBillKeys
          );
          if (resBill.duplicate || resBill.saved) {
            setSmartImportResults([
              {
                fileName: downloadedFile.name,
                destination: resBill.label,
                detail: resBill.detail,
                status: resBill.duplicate ? 'duplicate' : 'ok',
              },
            ]);
            if (resBill.saved) setImportLinkUrl('');
            await reloadVaultMeta();
            return;
          }
        }

        const { product: matchedProduct, attachType } = resolveProductMatchAndType(
          importLinkProductChoice,
          classification,
          {
            fileName: downloadedFile.name,
            title: classification.title,
            provider: classification.provider,
            cloudUrl: cleanUrl,
            textContent: extractedText,
            notes: classification.notes,
          }
        );

        await saveClassifiedAsDocument(
          downloadedFile,
          classification,
          matchedProduct,
          attachType,
          cleanUrl
        );
        await reloadVaultMeta();
        setImportLinkUrl('');
        setSmartImportResults([
          {
            fileName: downloadedFile.name,
            destination: matchedProduct
              ? `Documenti · Prodotti → ${matchedProduct.title}`
              : `Documenti · ${classification.documentCategory}`,
            detail: matchedProduct
              ? `${classification.title} (${formatAttachmentTypeLabel(attachType) || 'Allegato prodotto'})`
              : `${classification.title} (${classification.provider})`,
            status: 'ok',
          },
        ]);
        return;
      }

      // 2) Link-only HTML / Google Drive / Web page path
      let inspectedTitle = '';
      let inspectedSite = '';
      let inspectedDesc = '';
      let inspectedSnippet = '';
      const inspectLinkApiUrl = resolveApiUrl('/api/documents/inspect-link');
      if (inspectLinkApiUrl) {
        try {
          const inspectResp = await fetch(inspectLinkApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cleanUrl }),
          });
          if (inspectResp.ok) {
            const meta = (await inspectResp.json()) as {
              title?: string;
              siteName?: string;
              description?: string;
              textSnippet?: string;
            };
            inspectedTitle = (meta.title || '').trim();
            inspectedSite = (meta.siteName || '').trim();
            inspectedDesc = (meta.description || '').trim();
            inspectedSnippet = (meta.textSnippet || '').trim();
          }
        } catch {
          // fallback cleanly to URL heuristics below
        }
      }

      let urlSlugName = 'Documento da Link';
      let urlHostProvider = 'Link Esterno';
      try {
        const parsed = new URL(cleanUrl);
        urlHostProvider = parsed.hostname.replace(/^www\./i, '') || 'Link Esterno';
        const seg = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim();
        if (seg) urlSlugName = seg.slice(0, 80);
      } catch {
        // ignore URL parse error
      }

      const combinedText = [inspectedTitle, inspectedDesc, inspectedSnippet].filter(Boolean).join('\n');
      const classifyLinkApiUrl = resolveApiUrl('/api/documents/classify');
      const clsResp = classifyLinkApiUrl
        ? await fetch(classifyLinkApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: inspectedTitle || urlSlugName,
              mimeType: 'text/html',
              textContent: combinedText.slice(0, 18_000),
              cloudUrl: cleanUrl,
              products: productsPayload,
            }),
          })
        : null;
      const classification: ClassifyApiResponse = clsResp?.ok
        ? ((await clsResp.json()) as ClassifyApiResponse)
        : {
            target: 'document',
            confidence: 'bassa',
            documentCategory: 'Altro',
            title: (inspectedTitle || urlSlugName).slice(0, 80),
            provider: (inspectedSite || urlHostProvider).slice(0, 80),
            notes: inspectedDesc.slice(0, 180) || 'Documento collegato tramite link.',
          };

      const { product: matchedProduct, attachType } = resolveProductMatchAndType(
        importLinkProductChoice,
        classification,
        {
          fileName: urlSlugName,
          title: inspectedTitle || classification.title,
          provider: inspectedSite || classification.provider,
          cloudUrl: cleanUrl,
          textContent: combinedText,
          notes: inspectedDesc || classification.notes,
        }
      );

      const finalTitle = (inspectedTitle || classification.title || urlSlugName).slice(0, 80);
      const finalProvider = (
        matchedProduct?.brand ||
        inspectedSite ||
        classification.provider ||
        urlHostProvider
      ).slice(0, 80);
      const finalCategory: HomeDocumentCategory = matchedProduct
        ? attachType === 'garanzia_extra_family'
          ? 'Assicurazioni'
          : DOCUMENT_CATEGORIES.includes(classification.documentCategory) &&
              classification.documentCategory !== 'Altro'
            ? classification.documentCategory
            : 'Altro'
        : DOCUMENT_CATEGORIES.includes(classification.documentCategory)
          ? classification.documentCategory
          : 'Altro';

      await onAddDocument({
        title: finalTitle,
        category: finalCategory,
        provider: finalProvider,
        referenceCode: matchedProduct
          ? buildResearchDocumentRef(matchedProduct.id, attachType)
          : classification.referenceCode?.trim().slice(0, 80) || undefined,
        issueDate:
          classification.issueDate?.trim().slice(0, 20) || new Date().toLocaleDateString('it-IT'),
        expiryDate: classification.expiryDate?.trim().slice(0, 20) || undefined,
        cloudUrl: cleanUrl,
        pinned: Boolean(
          matchedProduct &&
            (attachType === 'scontrino_fattura' || attachType === 'garanzia_extra_family')
        ),
        notes: (
          classification.notes ||
          inspectedDesc ||
          (matchedProduct
            ? `Link associato a ${matchedProduct.title}`
            : `Link importato da ${urlHostProvider}`)
        ).slice(0, 180),
      });

      setImportLinkUrl('');
      setSmartImportResults([
        {
          fileName: finalTitle,
          destination: matchedProduct
            ? `Documenti · Prodotti → ${matchedProduct.title}`
            : `Documenti · ${finalCategory}`,
          detail: matchedProduct
            ? `Link collegato (${formatAttachmentTypeLabel(attachType) || 'Allegato prodotto'})`
            : `Link diretto (${finalProvider})`,
          status: 'ok',
        },
      ]);
    } catch (err) {
      setSmartImportResults([
        {
          fileName: cleanUrl,
          destination: 'Errore importazione link',
          detail: err instanceof Error ? err.message : 'Impossibile importare il link indicato.',
          status: 'error',
        },
      ]);
    } finally {
      setAutoImporting(false);
      setImportProgressLabel(null);
    }
  }

  const researchesMap = useMemo(() => {
    const map = new Map<string, ProductResearchRecord>();
    for (const res of researches) map.set(res.id, res);
    return map;
  }, [researches]);

  function resolveDocumentOrigin(doc: HomeDocumentRecord): OriginMeta {
    const resRef = parseResearchDocumentRef(doc.referenceCode);
    if (resRef) {
      const res = researchesMap.get(resRef.researchId);
      const typeLabel = formatAttachmentTypeLabel(resRef.docType);
      const groupTitle = res?.title || 'Prodotto';
      const groupSubtitle = [res?.brand, res?.model, res?.room].filter(Boolean).join(' · ') || undefined;
      return {
        key: 'ricerche',
        label: 'Prodotti',
        detail: [groupTitle, typeLabel].filter(Boolean).join(' · '),
        badgeClass:
          'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30',
        groupKey: `res:${resRef.researchId}`,
        groupTitle,
        groupSubtitle,
        attachmentTypeLabel: typeLabel || undefined,
        imageUrl: res?.imageUrl,
        isApplianceOrArticle: true,
      };
    }

    const carRef = parseCarDocumentRef(doc.referenceCode);
    if (carRef || isCarLinkedDocument(doc)) {
      const typeLabel = formatAttachmentTypeLabel(carRef?.slotType);
      return {
        key: 'macchina',
        label: `Macchina ${carRef?.plate || carPlate}`,
        detail: typeLabel || 'Documento veicolo',
        badgeClass:
          'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30',
        groupKey: `car:${carRef?.plate || carPlate}`,
        groupTitle: `Macchina ${carRef?.plate || carPlate}`,
        attachmentTypeLabel: typeLabel || 'Documento veicolo',
      };
    }

    return {
      key: 'documenti',
      label: 'Documenti Casa',
      detail: '',
      badgeClass:
        'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
      groupKey: 'house',
      groupTitle: 'Documenti Casa & Generali',
    };
  }

  const allUnifiedDocumentRows = useMemo<UnifiedDocumentRow[]>(() => {
    return documents.map((doc) => ({
      rowKey: `doc_${doc.id}`,
      doc,
      origin: resolveDocumentOrigin(doc),
      editable: true,
      deletable: true,
      fileKey: doc.attachmentKey,
      sharePayload: buildDocumentSharePayload(doc),
    }));
  }, [documents, researchesMap, carPlate]);

  const linkedProductFilterOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        groupKey: string;
        title: string;
        subtitle?: string;
        imageUrl?: string;
        kind: 'ricerche';
        count: number;
      }
    >();
    let otherCount = 0;
    for (const row of allUnifiedDocumentRows) {
      if (row.origin.isApplianceOrArticle) {
        const existing = map.get(row.origin.groupKey);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(row.origin.groupKey, {
            groupKey: row.origin.groupKey,
            title: row.origin.groupTitle,
            subtitle: row.origin.groupSubtitle,
            imageUrl: row.origin.imageUrl,
            kind: 'ricerche',
            count: 1,
          });
        }
      } else {
        otherCount += 1;
      }
    }
    const items = [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'it'));
    return { items, otherCount };
  }, [allUnifiedDocumentRows]);

  const filteredDocumentRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...allUnifiedDocumentRows]
      .filter((row) => {
        if (originFilter === 'bollette') return false;
        if (originFilter !== 'all' && row.origin.key !== originFilter) return false;
        if (productFilter === 'unlinked' && row.origin.isApplianceOrArticle) return false;
        if (
          productFilter !== 'all' &&
          productFilter !== 'unlinked' &&
          row.origin.groupKey !== productFilter
        ) {
          return false;
        }
        if (
          activeTab !== 'all' &&
          activeTab !== 'bollette' &&
          activeTab !== 'ricerche' &&
          row.doc.category !== activeTab
        ) {
          return false;
        }
        if (!q) return true;
        return [
          row.doc.title,
          row.doc.category,
          row.doc.provider,
          row.doc.referenceCode,
          row.doc.notes,
          row.doc.fileName,
          row.origin.label,
          row.origin.detail,
          row.origin.groupTitle,
          row.origin.groupSubtitle,
          row.origin.attachmentTypeLabel,
        ]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (a.doc.pinned !== b.doc.pinned) return a.doc.pinned ? -1 : 1;
        return a.doc.title.localeCompare(b.doc.title, 'it');
      });
  }, [allUnifiedDocumentRows, activeTab, originFilter, productFilter, searchQuery]);

  const groupedDocumentSections = useMemo(() => {
    const productBuckets = new Map<
      string,
      {
        groupKey: string;
        title: string;
        subtitle?: string;
        imageUrl?: string;
        originKey: Exclude<OriginKey, 'bollette'>;
        rows: UnifiedDocumentRow[];
      }
    >();
    const otherRows: UnifiedDocumentRow[] = [];

    for (const row of filteredDocumentRows) {
      if (row.origin.isApplianceOrArticle) {
        const existing = productBuckets.get(row.origin.groupKey);
        if (existing) {
          existing.rows.push(row);
        } else {
          productBuckets.set(row.origin.groupKey, {
            groupKey: row.origin.groupKey,
            title: row.origin.groupTitle,
            subtitle: row.origin.groupSubtitle,
            imageUrl: row.origin.imageUrl,
            originKey: row.origin.key,
            rows: [row],
          });
        }
      } else {
        otherRows.push(row);
      }
    }

    const sections = [...productBuckets.values()].sort((a, b) =>
      a.title.localeCompare(b.title, 'it')
    );

    if (otherRows.length > 0) {
      sections.push({
        groupKey: 'other_house',
        title: 'Documenti Casa & Altri',
        subtitle: 'Contratti, assicurazioni, documenti casa e veicolo non collegati a un prodotto',
        originKey: 'documenti',
        rows: otherRows,
      });
    }

    return sections;
  }, [filteredDocumentRows]);

  const shareableElectricityBills = useMemo(
    () =>
      electricityBills.filter((bill) => {
        const key = bill.pdfFileKey || getElectricityBillFileKey(bill.invoiceNumber);
        return readOnly ? Boolean(bill.pdfFileKey) : Boolean(bill.pdfFileKey || vaultMeta[key]);
      }),
    [electricityBills, readOnly, vaultMeta]
  );

  const shareableWaterBills = useMemo(
    () =>
      waterBills.filter((bill) => {
        const key = bill.pdfFileKey || getWaterBillFileKey(bill.invoiceNumber);
        return readOnly ? Boolean(bill.pdfFileKey) : Boolean(bill.pdfFileKey || vaultMeta[key]);
      }),
    [waterBills, readOnly, vaultMeta]
  );

  const shareableTariBills = useMemo(
    () =>
      tariBills.filter((bill) => {
        const key = bill.pdfFileKey || getTariBillFileKey(bill.noticeNumber);
        return readOnly ? Boolean(bill.pdfFileKey) : Boolean(bill.pdfFileKey || vaultMeta[key]);
      }),
    [tariBills, readOnly, vaultMeta]
  );

  const shareableGsePayments = useMemo(
    () =>
      gsePayments.filter((payment) =>
        Boolean(payment.attachmentFileKey && (readOnly || vaultMeta[payment.attachmentFileKey]))
      ),
    [gsePayments, readOnly, vaultMeta]
  );

  const totalShareableBillsCount =
    shareableElectricityBills.length +
    shareableWaterBills.length +
    shareableTariBills.length +
    shareableGsePayments.length;

  const allBillsForSharing = useMemo<UnifiedBillShareItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const list: UnifiedBillShareItem[] = [
      ...shareableElectricityBills.map((b) => ({
        id: `elec_${b.invoiceNumber}`,
        kind: 'luce' as const,
        label: isOctopusContractRecord(b) ? 'Contratto Luce' : 'Luce',
        period: b.period,
        supplier: b.supplier,
        number: b.invoiceNumber,
        date: b.issueDate,
        amount: b.totalPaid,
        fileKey: b.pdfFileKey || getElectricityBillFileKey(b.invoiceNumber),
        payload: buildElectricityBillSharePayload(b),
        electricityBill: b,
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
        waterBill: w,
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
        tariBill: t,
      })),
      ...shareableGsePayments.map((g) => ({
        id: `gse_${g.id}`,
        kind: 'gse' as const,
        label: 'GSE',
        period: g.period,
        supplier: 'GSE Ritiro Dedicato',
        number: g.reference || g.id.slice(-8),
        date: g.paymentDate,
        amount: g.amountEur,
        fileKey: g.attachmentFileKey || '',
        payload: buildGseSharePayload(g),
        gsePayment: g,
      })),
    ];

    return list
      .filter((item) => {
        if (!q) return true;
        return [item.label, item.period, item.supplier, item.number, item.date].some((x) =>
          x.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  }, [
    shareableElectricityBills,
    shareableWaterBills,
    shareableTariBills,
    shareableGsePayments,
    searchQuery,
  ]);

  const attachedDocsCount = useMemo(
    () =>
      allUnifiedDocumentRows.filter(
        (r) => (r.fileKey && vaultMeta[r.fileKey]) || r.doc.fileName || r.doc.cloudUrl
      ).length,
    [allUnifiedDocumentRows, vaultMeta]
  );

  const originCounts = useMemo(() => {
    const counts = {
      documenti: 0,
      ricerche: 0,
      macchina: 0,
    };
    for (const row of allUnifiedDocumentRows) {
      counts[row.origin.key]++;
    }
    return counts;
  }, [allUnifiedDocumentRows]);

  const pinnedDocsCount = useMemo(
    () => documents.filter((d) => d.pinned).length,
    [documents]
  );

  function canDeleteUnifiedBill(item: UnifiedBillShareItem): boolean {
    if (readOnly) return false;
    if (item.kind === 'luce' && item.electricityBill) return Boolean(onDeleteElectricityBill);
    if (item.kind === 'acqua' && item.waterBill) return Boolean(onDeleteWaterBill);
    if (item.kind === 'tari' && item.tariBill) return Boolean(onDeleteTariBill);
    if (item.kind === 'gse' && item.gsePayment) return Boolean(onDeleteGsePayment);
    return false;
  }

  const vaultStats = useMemo(() => {
    const entries = Object.entries(vaultMeta);
    const totalFiles = entries.length;
    const cachedCount = entries.filter(([k]) => localCachedKeys.has(k)).length;
    const missingOffline = Math.max(0, totalFiles - cachedCount);
    const legacyFirestoreCount = entries.filter(
      ([, meta]) =>
        meta.origin === 'firestore' &&
        (meta.chunkCount || 0) > 0 &&
        meta.storageBackend !== 's3'
    ).length;
    const externalCount = entries.filter(
      ([, meta]) => meta.storageBackend === 's3'
    ).length;
    return { totalFiles, cachedCount, missingOffline, legacyFirestoreCount, externalCount };
  }, [vaultMeta, localCachedKeys]);

  const activeMobileFilterCount =
    (activeTab !== 'all' ? 1 : 0) +
    (originFilter !== 'all' && originFilter !== activeTab ? 1 : 0) +
    (productFilter !== 'all' ? 1 : 0);

  function formatStorageBadgeText(localFile?: VaultFileMeta): string {
    if (!localFile) return '';
    const sizeText = formatFileSize(localFile.size);
    if (localFile.storageBackend === 's3') return sizeText ? `Backblaze B2 · ${sizeText}` : 'Backblaze B2';
    if (localFile.origin === 'firestore') return sizeText ? `Cloud · ${sizeText}` : 'Cloud';
    if (localFile.origin === 'bundled') return sizeText ? `PDF · ${sizeText}` : 'PDF';
    return sizeText ? `Locale · ${sizeText}` : 'Locale';
  }

  return (
    <div className="space-y-4 md:space-y-6 pb-8 md:pb-0">
      {/* Mobile Header (<768px) */}
      <div className="md:hidden space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-brand-600 dark:text-brand-400 shrink-0" />
              <span className="truncate">Documenti</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {allUnifiedDocumentRows.length + totalShareableBillsCount} elementi ·{' '}
              {vaultStats.cachedCount}/{vaultStats.totalFiles} offline
            </p>
          </div>
          {vaultStorageStatus?.configured && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 shrink-0">
              <Cloud className="w-3.5 h-3.5" />
              {vaultStorageStatus.providerLabel}
            </span>
          )}
        </div>

        {!readOnly && (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={autoImporting}
              onClick={() => smartImportInputRef.current?.click()}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 dark:text-slate-950 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-xl transition-colors disabled:opacity-60"
            >
              {autoImporting ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Sparkles className="w-4 h-4 shrink-0" />
              )}
              <span>{autoImporting ? 'Carico...' : 'Auto'}</span>
            </button>
            <button
              type="button"
              disabled={autoImporting}
              onClick={() => setLinkImportOpen((prev) => !prev)}
              className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-xl border transition-colors disabled:opacity-60 ${
                linkImportOpen
                  ? 'bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-400 dark:text-slate-950 dark:border-indigo-400'
                  : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 border-indigo-200 dark:border-indigo-500/35'
              }`}
            >
              <Link2 className="w-4 h-4 shrink-0" />
              <span>Da Link</span>
            </button>
            <button
              type="button"
              onClick={() => openNewForm()}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Nuovo</span>
            </button>
          </div>
        )}
      </div>

      {/* Desktop Header (>=768px) */}
      <div className="hidden md:flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            Archivio Unificato Documenti &amp; Allegati
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Tutti i documenti e allegati di Casa, Bollette &amp; GSE, Prodotti e Macchina in un unico archivio sincronizzato.
          </p>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={smartImportInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.csv,.json"
              onChange={(e) => void handleSmartImportFiles(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              disabled={autoImporting}
              onClick={() => smartImportInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 text-white bg-emerald-600 hover:bg-emerald-700 dark:text-slate-950 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg transition-colors disabled:opacity-60"
            >
              {autoImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {autoImporting ? 'Classificazione...' : 'Importa Documenti (Auto)'}
            </button>
            <button
              type="button"
              disabled={autoImporting}
              onClick={() => setLinkImportOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 rounded-lg border transition-colors disabled:opacity-60 ${
                linkImportOpen
                  ? 'bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-400 dark:text-slate-950 dark:border-indigo-400'
                  : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 border-indigo-200 dark:border-indigo-500/35'
              }`}
            >
              <Link2 className="w-4 h-4" />
              Importa da Link
            </button>
            <button
              type="button"
              onClick={() => openNewForm()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Aggiungi a Mano
            </button>
          </div>
        )}
      </div>

      {/* Shared hidden file input for mobile when desktop header is hidden */}
      {!readOnly && (
        <input
          ref={smartImportInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.csv,.json"
          onChange={(e) => void handleSmartImportFiles(e.target.files)}
          className="hidden md:hidden"
        />
      )}

      {linkImportOpen && !readOnly && (
        <form
          onSubmit={(e) => void handleSmartImportUrl(e)}
          className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/40 rounded-2xl md:rounded-xl p-4 space-y-3 shadow-xs dark:shadow-none"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm md:text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Link2 className="w-4 h-4 md:w-3.5 md:h-3.5 text-indigo-600 dark:text-indigo-400" />
                Importa Documento da Link Online
              </h2>
              <p className="text-xs md:text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                Incolla un link diretto (PDF scheda tecnica, manuale, link pubblico): scarica o collega il documento e lo abbina al prodotto corrispondente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLinkImportOpen(false)}
              className="min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Chiudi pannello link"
            >
              <X className="w-5 h-5 md:w-4 md:h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 md:gap-2">
            <input
              type="url"
              required
              disabled={autoImporting}
              value={importLinkUrl}
              onChange={(e) => setImportLinkUrl(e.target.value)}
              placeholder="https://... (PDF, manuale o pagina prodotto)"
              className="flex-1 min-w-0 min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
            />
            {researches.length > 0 && (
              <select
                aria-label="Associazione prodotto"
                disabled={autoImporting}
                value={importLinkProductChoice}
                onChange={(e) => setImportLinkProductChoice(e.target.value)}
                className="sm:w-64 min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-800 dark:text-slate-200 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-indigo-500"
              >
                <option value="auto">Riconoscimento automatico prodotto</option>
                <option value="none">Nessun collegamento prodotto</option>
                {researches.map((res) => (
                  <option key={res.id} value={res.id}>
                    Collega a: {res.title.slice(0, 42)}
                    {res.brand ? ` (${res.brand})` : ''}
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              disabled={autoImporting || !importLinkUrl.trim()}
              className="min-h-[44px] md:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm md:text-xs font-semibold whitespace-nowrap shrink-0 text-white bg-indigo-600 hover:bg-indigo-700 dark:text-slate-950 dark:bg-indigo-400 dark:hover:bg-indigo-300 rounded-xl md:rounded-lg transition-colors disabled:opacity-60"
            >
              {autoImporting ? (
                <Loader2 className="w-4 h-4 md:w-3.5 md:h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 md:w-3.5 md:h-3.5" />
              )}
              {autoImporting ? 'Analisi...' : 'Analizza e Importa'}
            </button>
          </div>
        </form>
      )}

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        isGmailConnected={isGmailConnected}
        onSignIn={onSignIn}
        onConnectGmail={onConnectGmail}
        pageName="Documenti"
        unlockedFeatures={[
          'Importazione automatica da file o da link: riconosce bollette, documenti casa e associa gli allegati ai prodotti esistenti',
          'Vista unica di tutti gli allegati (Documenti Casa, Bollette & GSE, Prodotti, Macchina)',
          'Apri in nuova scheda, Scarica, Condividi o Elimina ogni allegato da qualsiasi dispositivo',
        ]}
        gmailFeatures={[
          'Archiviazione automatica su Firestore / Storage dei PDF bollette ricevuti in INBOX Gmail',
        ]}
      />

      {/* Mobile Collapsible Utilities Accordion (<768px) so real content starts right away */}
      <div className="md:hidden space-y-2.5">
        <button
          type="button"
          onClick={() => setShowMobileUtilities((prev) => !prev)}
          aria-expanded={showMobileUtilities}
          className="w-full min-h-[44px] px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Database className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate tabular-nums">
              Offline {vaultStats.cachedCount}/{vaultStats.totalFiles} ·{' '}
              {vaultStorageStatus?.configured ? vaultStorageStatus.providerLabel : 'Firestore'}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-300 shrink-0">
            Strumenti
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showMobileUtilities ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        {showMobileUtilities && (
          <div className="space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-50 dark:bg-slate-950/70 rounded-xl p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Archivio totale</div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {allUnifiedDocumentRows.length + totalShareableBillsCount}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950/70 rounded-xl p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Con file</div>
                <div className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-300">
                  {attachedDocsCount + totalShareableBillsCount}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950/70 rounded-xl p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">In evidenza</div>
                <div className="text-lg font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                  {pinnedDocsCount}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950/70 rounded-xl p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Bollette &amp; GSE</div>
                <div className="text-lg font-bold font-mono tabular-nums text-sky-600 dark:text-sky-300">
                  {totalShareableBillsCount}
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <strong>Storage allegati:</strong>{' '}
                {vaultStorageStatus?.configured
                  ? `${vaultStorageStatus.providerLabel} (${vaultStorageStatus.freeQuotaLabel}) — i file vanno fuori da Firestore.`
                  : 'Firestore compresso (1 GB condiviso). Per 10 GB sempre gratuiti senza carta collega Backblaze B2 (variabili S3_* su Render).'}
              </div>

              {!readOnly && vaultStats.totalFiles > 0 && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={precachingAll || (quotaExceeded && vaultStats.missingOffline > 0)}
                    onClick={() => void handlePrecacheAllOffline()}
                    className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl border border-sky-300 dark:border-sky-500/40 bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200 disabled:opacity-55"
                  >
                    {precachingAll ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    <span>
                      {precachingAll
                        ? `Scarico ${precacheProgress?.completed || 0}/${precacheProgress?.total || 0}...`
                        : vaultStats.missingOffline === 0
                          ? 'Tutti i file già salvati offline'
                          : `Salva ${vaultStats.missingOffline} file offline`}
                    </span>
                  </button>

                  {vaultStorageStatus?.configured && vaultStats.legacyFirestoreCount > 0 && (
                    <button
                      type="button"
                      disabled={migratingStorage}
                      onClick={() => void handleMigrateLegacyStorage()}
                      className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200 disabled:opacity-55"
                    >
                      {migratingStorage ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <HardDrive className="w-4 h-4" />
                      )}
                      <span>
                        {migratingStorage && migrationProgress
                          ? `Sposto ${migrationProgress.done}/${migrationProgress.total}...`
                          : `Sposta ${vaultStats.legacyFirestoreCount} PDF su ${vaultStorageStatus.providerLabel}`}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!readOnly && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Modelli rapidi casa
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {DOCUMENT_STARTER_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.title}
                      type="button"
                      onClick={() => openNewForm(tpl)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap shrink-0 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-xl"
                    >
                      <Plus className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      {tpl.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop KPI (>=768px) */}
      <div className="hidden md:grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Totale Archivio Unico
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-0.5">
            {allUnifiedDocumentRows.length + totalShareableBillsCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Con File Allegato
          </div>
          <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-300 mt-0.5">
            {attachedDocsCount + totalShareableBillsCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            In Evidenza
          </div>
          <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
            {pinnedDocsCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Bollette &amp; GSE
          </div>
          <div className="text-xl font-bold font-mono text-sky-600 dark:text-sky-300 mt-0.5">
            {totalShareableBillsCount}
          </div>
        </div>
      </div>

      {/* Desktop Offline Cache & Dedicated Storage Bar (>=768px) */}
      <div className="hidden md:block space-y-2.5">
        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xs dark:shadow-none">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <Database className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5 sm:mt-0" />
            <div className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Cache Offline su questo dispositivo:
              </span>{' '}
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                {vaultStats.cachedCount} / {vaultStats.totalFiles}
              </span>{' '}
              file salvati in locale (i file in cache si aprono e scaricano sempre con{' '}
              <strong>0 letture Firebase</strong> anche a quota esaurita).
              {precacheProgress && precacheProgress.total > 0 && (
                <span className="block text-[11px] text-sky-700 dark:text-sky-300 mt-0.5">
                  Scaricamento {precacheProgress.completed}/{precacheProgress.total}:{' '}
                  {precacheProgress.currentFileName}
                </span>
              )}
            </div>
          </div>
          {!readOnly && vaultStats.totalFiles > 0 && (
            <button
              type="button"
              disabled={precachingAll || (quotaExceeded && vaultStats.missingOffline > 0)}
              onClick={() => void handlePrecacheAllOffline()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-sky-300 dark:border-sky-500/40 bg-sky-50 hover:bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:hover:bg-sky-500/25 dark:text-sky-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-55"
            >
              {precachingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>
                {precachingAll
                  ? 'Scaricamento...'
                  : vaultStats.missingOffline === 0
                    ? 'Tutti già offline'
                    : `Scarica ${vaultStats.missingOffline} offline`}
              </span>
            </button>
          )}
        </div>

        {!readOnly && vaultStorageStatus && (
          <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs dark:shadow-none">
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              <Cloud
                className={`w-4 h-4 shrink-0 mt-0.5 sm:mt-0 ${
                  vaultStorageStatus.configured
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              />
              <div className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
                {vaultStorageStatus.configured ? (
                  <>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Storage file dedicato attivo: {vaultStorageStatus.providerLabel}
                    </span>{' '}
                    ({vaultStorageStatus.freeQuotaLabel}) — {vaultStats.externalCount} su {vaultStorageStatus.providerLabel} · {vaultStats.legacyFirestoreCount} da spostare da Firestore.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Archiviazione compatta su Firestore:
                    </span>{' '}
                    se hai già configurato <strong>Backblaze B2</strong> (<code className="font-mono text-[11px]">S3_*</code>) su Render, salva l&apos;URL HTTPS di Render in <strong>Impostazioni → Server Backend</strong> (oppure apri l&apos;app da Render) per attivarlo anche qui.
                  </>
                )}
              </div>
            </div>
            {vaultStorageStatus.configured && vaultStats.legacyFirestoreCount > 0 && (
              <button
                type="button"
                disabled={migratingStorage}
                onClick={() => void handleMigrateLegacyStorage()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:text-emerald-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-55"
              >
                {migratingStorage ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <HardDrive className="w-3.5 h-3.5" />
                )}
                <span>
                  {migratingStorage && migrationProgress
                    ? `Migrazione ${migrationProgress.done}/${migrationProgress.total}...`
                    : `Sposta ${vaultStats.legacyFirestoreCount} PDF su ${vaultStorageStatus.providerLabel}`}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {importProgressLabel && (
        <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 rounded-xl px-4 py-2.5 text-xs text-sky-800 dark:text-sky-200 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>{importProgressLabel}</span>
        </div>
      )}

      {smartImportResults.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/35 rounded-xl p-3.5 space-y-2 shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Esito importazione automatica ({smartImportResults.length}{' '}
              {smartImportResults.length === 1 ? 'elemento' : 'elementi'})
            </div>
            <button
              type="button"
              onClick={() => setSmartImportResults([])}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {smartImportResults.map((item, idx) => (
              <div
                key={`${item.fileName}_${idx}`}
                className={`flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[11px] border ${
                  item.status === 'ok'
                    ? 'bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                    : item.status === 'duplicate'
                      ? 'bg-amber-50/70 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200'
                      : 'bg-rose-50/70 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-900 dark:text-rose-200'
                }`}
              >
                <div className="font-semibold truncate max-w-xs">{item.fileName}</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{item.destination}</span>
                  <span className="opacity-80">· {item.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {statusNotice && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
          </button>
        </div>
      )}

      {/* Desktop Quick Starter Templates (>=768px) */}
      {!readOnly && (
        <section className="hidden md:block bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2 shadow-xs dark:shadow-none">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Aggiunta rapida documenti essenziali di casa
          </div>
          <div className="flex flex-wrap gap-2">
            {DOCUMENT_STARTER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.title}
                type="button"
                onClick={() => openNewForm(tpl)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 hover:border-sky-500/40 text-slate-800 dark:text-slate-200 rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                {tpl.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Mobile Search + Filter Sheet Trigger + Single-Row Category Strip (<768px) */}
      <div className="md:hidden space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca documento, prodotto o bolletta..."
              className="w-full h-11 pl-9 pr-9 text-base bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Svuota ricerca"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMobileFilterSheetOpen(true)}
            className={`min-h-[44px] px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl border shrink-0 transition-colors ${
              activeMobileFilterCount > 0
                ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-400 dark:text-slate-950 dark:border-sky-400'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Filtri</span>
            {activeMobileFilterCount > 0 && (
              <span className="font-mono font-bold tabular-nums">({activeMobileFilterCount})</span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('all');
              setOriginFilter('all');
              setProductFilter('all');
            }}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl border transition-colors ${
              activeTab === 'all' && originFilter === 'all' && productFilter === 'all'
                ? 'bg-brand-600 text-white border-brand-600 dark:bg-brand-400 dark:text-slate-950 dark:border-brand-400'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
            }`}
          >
            Tutti ({allUnifiedDocumentRows.length + totalShareableBillsCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('ricerche');
              setOriginFilter('ricerche');
            }}
            className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl border transition-colors ${
              activeTab === 'ricerche' || originFilter === 'ricerche'
                ? 'bg-violet-600 text-white border-violet-600 dark:bg-violet-400 dark:text-slate-950 dark:border-violet-400'
                : 'bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300 border-slate-200 dark:border-slate-800'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Prodotti ({originCounts.ricerche})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('bollette');
              setOriginFilter('bollette');
            }}
            className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl border transition-colors ${
              activeTab === 'bollette' || originFilter === 'bollette'
                ? 'bg-amber-500 text-slate-950 border-amber-500 dark:bg-amber-400 dark:text-slate-950 dark:border-amber-400'
                : 'bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 border-slate-200 dark:border-slate-800'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            Bollette ({totalShareableBillsCount})
          </button>
          {DOCUMENT_CATEGORIES.map((cat) => {
            const count = allUnifiedDocumentRows.filter((r) => r.doc.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setActiveTab(cat);
                  if (originFilter === 'bollette') setOriginFilter('all');
                }}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 rounded-xl border transition-colors ${
                  activeTab === cat
                    ? 'bg-brand-600 text-white border-brand-600 dark:bg-brand-400 dark:text-slate-950 dark:border-brand-400'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop Tabs + Origin Filter + Search + List/Grid Toggle (>=768px) */}
      <div className="hidden md:block space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('all');
                setOriginFilter('all');
                setProductFilter('all');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                activeTab === 'all' && originFilter === 'all' && productFilter === 'all'
                  ? 'bg-brand-600 text-white border-brand-600 dark:bg-brand-400 dark:text-slate-950 dark:border-brand-400'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Tutti ({allUnifiedDocumentRows.length + totalShareableBillsCount})
            </button>

            {DOCUMENT_CATEGORIES.map((cat) => {
              const count = allUnifiedDocumentRows.filter((r) => r.doc.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setActiveTab(cat);
                    if (originFilter === 'bollette') setOriginFilter('all');
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    activeTab === cat
                      ? 'bg-brand-600 text-white border-brand-600 dark:bg-brand-400 dark:text-slate-950 dark:border-brand-400'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}

              <button
                type="button"
                onClick={() => {
                  setActiveTab('ricerche');
                  setOriginFilter('ricerche');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  activeTab === 'ricerche' || originFilter === 'ricerche'
                    ? 'bg-violet-600 text-white border-violet-600 dark:bg-violet-400 dark:text-slate-950 dark:border-violet-400'
                    : 'bg-violet-50 dark:bg-violet-500/10 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-500/30 hover:bg-violet-100 dark:hover:bg-violet-500/20'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                Prodotti ({originCounts.ricerche})
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('bollette');
                  setOriginFilter('bollette');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  activeTab === 'bollette' || originFilter === 'bollette'
                    ? 'bg-amber-500 text-slate-950 border-amber-500 dark:bg-amber-400 dark:text-slate-950 dark:border-amber-400'
                    : 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                Bollette &amp; GSE ({totalShareableBillsCount})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                aria-label="Filtra per pagina di origine"
                value={originFilter}
                onChange={(e) => {
                  const next = e.target.value as OriginFilter;
                  setOriginFilter(next);
                  if (next === 'bollette') {
                    setActiveTab('bollette');
                    setProductFilter('all');
                  } else if (next === 'ricerche') {
                    setActiveTab('ricerche');
                  } else if (activeTab === 'bollette' || activeTab === 'ricerche') {
                    setActiveTab('all');
                  }
                }}
                className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
              >
                <option value="all">
                  Tutte le origini ({allUnifiedDocumentRows.length + totalShareableBillsCount})
                </option>
                <option value="documenti">Documenti Casa ({originCounts.documenti})</option>
                <option value="ricerche">Prodotti ({originCounts.ricerche})</option>
                <option value="bollette">Bollette &amp; GSE ({totalShareableBillsCount})</option>
                <option value="macchina">
                  Macchina {carPlate} ({originCounts.macchina})
                </option>
              </select>

            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cerca lavatrice, documento, bolletta..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>

            {linkedProductFilterOptions.items.length > 0 &&
              activeTab !== 'bollette' &&
              originFilter !== 'bollette' && (
                <button
                  type="button"
                  onClick={handleToggleGroupByProduct}
                  aria-pressed={groupByProduct}
                  title="Raggruppa i documenti per prodotto / elettrodomestico"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                    groupByProduct
                      ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-400 dark:text-slate-950 dark:border-sky-400'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Divisi per prodotto
                </button>
              )}

            <div className="inline-flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/70">
              <button
                type="button"
                onClick={() => handleChangeViewMode('list')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                Elenco
              </button>
              <button
                type="button"
                onClick={() => handleChangeViewMode('grid')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Griglia
              </button>
            </div>
          </div>
        </div>

        {/* Quick Appliance / Product Filter Bar */}
        {linkedProductFilterOptions.items.length > 0 &&
          activeTab !== 'bollette' &&
          originFilter !== 'bollette' && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1">
                Elettrodomestico / Prodotto:
              </span>
              <button
                type="button"
                onClick={() => setProductFilter('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                  productFilter === 'all'
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-950 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                Tutti ({allUnifiedDocumentRows.length})
              </button>
              {linkedProductFilterOptions.items.map((item) => {
                const active = productFilter === item.groupKey;
                return (
                  <button
                    key={item.groupKey}
                    type="button"
                    onClick={() => {
                      setProductFilter(active ? 'all' : item.groupKey);
                      if (originFilter !== 'all' && originFilter !== item.kind) {
                        setOriginFilter('all');
                      }
                    }}
                    title={item.subtitle ? `${item.title} — ${item.subtitle}` : item.title}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors max-w-[260px] ${
                      active
                        ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-400 dark:text-slate-950 dark:border-sky-400'
                        : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-sky-400 dark:hover:border-sky-500/50'
                    }`}
                  >
                    <ShoppingBag className="w-3 h-3 shrink-0 opacity-80" />
                    <span className="truncate">{item.title}</span>
                    <span className="font-mono text-[11px] opacity-75 shrink-0">
                      ({item.count})
                    </span>
                  </button>
                );
              })}
              {linkedProductFilterOptions.otherCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setProductFilter(productFilter === 'unlinked' ? 'all' : 'unlinked')
                  }
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                    productFilter === 'unlinked'
                      ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-950 dark:border-slate-200'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Altri documenti ({linkedProductFilterOptions.otherCount})
                </button>
              )}
            </div>
          )}
      </div>

      {/* Add / Edit Modal (touch optimized on mobile) */}
      {showForm && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-900 border border-sky-500/40 rounded-2xl md:rounded-xl p-4 sm:p-5 space-y-4 text-sm md:text-xs shadow-sm dark:shadow-none"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <h2 className="text-base md:text-sm font-bold text-slate-900 dark:text-slate-100">
              {editingDoc ? `Modifica "${editingDoc.title}"` : 'Nuovo Documento Utile'}
            </h2>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="min-h-[40px] md:min-h-0 px-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 md:gap-3">
            <div className="space-y-1">
              <label className="block text-xs text-slate-600 dark:text-slate-400">
                Titolo documento *
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Es. Contratto Fibra WindTre"
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-slate-600 dark:text-slate-400">Categoria *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as HomeDocumentCategory)}
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-slate-600 dark:text-slate-400">
                Ente / Banca / Fornitore *
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="Es. WindTre, Intesa Sanpaolo..."
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-slate-600 dark:text-slate-400">
                N° Contratto / Pratica / SSID
              </label>
              <input
                type="text"
                maxLength={80}
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                placeholder="Es. Cod. cliente o pratica mutuo"
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-slate-600 dark:text-slate-400">
                Data stipula / documento
              </label>
              <input
                type="text"
                maxLength={20}
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                placeholder="Es. 15/03/2024"
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-slate-600 dark:text-slate-400">
                Scadenza / Rinnovo
              </label>
              <input
                type="text"
                maxLength={20}
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                placeholder="Es. 15/03/2026"
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="block text-xs text-slate-600 dark:text-slate-400">
                Link esterno / Cloud (opz.)
              </label>
              <input
                type="url"
                value={cloudUrl}
                onChange={(e) => setCloudUrl(e.target.value)}
                placeholder="https://..."
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-slate-600 dark:text-slate-400">In evidenza</label>
              <label className="min-h-[44px] md:min-h-0 flex items-center gap-2.5 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                  className="h-4 w-4 rounded accent-sky-600 dark:accent-sky-400"
                />
                Fissa in alto tra i documenti importanti
              </label>
            </div>

            {researches.length > 0 && (
              <>
                <div className="space-y-1 sm:col-span-2">
                  <label className="block text-xs text-slate-600 dark:text-slate-400">
                    Collega a un Prodotto (opz.)
                  </label>
                  <select
                    value={linkedResearchId}
                    onChange={(e) => setLinkedResearchId(e.target.value)}
                    className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Nessun prodotto collegato</option>
                    {researches.map((res) => (
                      <option key={res.id} value={res.id}>
                        {res.title}
                        {res.brand ? ` (${res.brand})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {linkedResearchId && (
                  <div className="space-y-1">
                    <label className="block text-xs text-slate-600 dark:text-slate-400">
                      Tipo allegato prodotto
                    </label>
                    <select
                      value={linkedDocType}
                      onChange={(e) => setLinkedDocType(e.target.value as ArticleAttachmentType)}
                      className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-violet-500"
                    >
                      {PRODUCT_LINK_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <label className="block text-xs text-slate-600 dark:text-slate-400">
                Note / Dati utili (password Wi-Fi, codice migrazione, IBAN, rata mutuo...)
              </label>
              <input
                type="text"
                maxLength={180}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Inserisci annotazioni rapide o credenziali utili da trovare subito..."
                className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* File upload picker */}
            <div className="sm:col-span-2 lg:col-span-3 bg-slate-50 dark:bg-slate-950/75 border border-dashed border-sky-400/60 dark:border-sky-500/40 rounded-xl p-3.5 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    Allega File (PDF, foto, scansione, documento)
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    {pendingFile
                      ? `Pronto (${localOnlySave ? 'solo locale' : vaultStorageStatus?.configured ? vaultStorageStatus.providerLabel : 'cloud compresso'}): ${pendingFile.name} (${formatFileSize(pendingFile.size)})`
                      : editingDoc?.fileName
                        ? `File attuale: ${editingDoc.fileName} (scegline un altro per sostituirlo)`
                        : vaultStorageStatus?.configured
                          ? `Salvato su ${vaultStorageStatus.providerLabel} (fino a ${Math.floor(vaultStorageStatus.maxFileBytes / 1_000_000)} MB) senza consumare spazio su Firestore.`
                          : 'Salvato su cloud (fino a 6 MB compressi) o solo in locale per risparmiare quota.'}
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
                    className="min-h-[44px] md:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 md:py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15 hover:bg-sky-100 dark:hover:bg-sky-500/25 border border-sky-200 dark:border-sky-500/35 rounded-xl md:rounded-lg"
                  >
                    <Upload className="w-4 h-4 md:w-3.5 md:h-3.5" />
                    {pendingFile || editingDoc?.fileName ? 'Cambia File' : 'Scegli File'}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer pt-1 border-t border-slate-200/70 dark:border-slate-800">
                <input
                  type="checkbox"
                  checked={localOnlySave}
                  onChange={(e) => setLocalOnlySave(e.target.checked)}
                  className="h-4 w-4 rounded accent-sky-600 dark:accent-sky-400"
                />
                <span>
                  Salva allegato solo su questo dispositivo (0 byte cloud e 0 operazioni Firestore)
                </span>
              </label>
            </div>
          </div>

          <div className="sticky bottom-2 md:static flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="min-h-[44px] md:min-h-0 px-4 py-2 text-sm md:text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] md:min-h-0 flex-1 md:flex-none px-5 py-2 text-sm md:text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 dark:text-slate-950 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-xl md:rounded-lg"
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

      {/* Main Content */}
      {(() => {
        const showBillsSection =
          activeTab === 'bollette' ||
          originFilter === 'bollette' ||
          (activeTab === 'all' && originFilter === 'all' && allBillsForSharing.length > 0);
        const showDocsSection = activeTab !== 'bollette' && originFilter !== 'bollette';
        const hasAnyContent =
          (showDocsSection && filteredDocumentRows.length > 0) ||
          (showBillsSection && allBillsForSharing.length > 0);

        const renderMobileBillsCards = () => (
          <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
            {allBillsForSharing.map((b) => {
              const localFile = b.fileKey ? vaultMeta[b.fileKey] : undefined;
              const canOpen = !readOnly && Boolean(localFile);
              return (
                <article key={b.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {b.kind === 'luce' ? (
                          <Zap className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                        ) : b.kind === 'acqua' ? (
                          <Droplets className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                        ) : b.kind === 'gse' ? (
                          <Sun className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <Receipt className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        )}
                        <span>{b.label}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate text-slate-500 dark:text-slate-400 font-normal">
                          {b.supplier}
                        </span>
                      </div>
                      <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {b.period}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        #{b.number}
                        {b.date ? ` · ${b.date}` : ''}
                        {localFile ? ` · ${formatStorageBadgeText(localFile)}` : ''}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {b.kind === 'gse' ? '+' : ''}
                        {b.amount.toFixed(2).replace('.', ',')} €
                      </div>
                    </div>
                  </div>

                  {!localFile && !readOnly && b.fileKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setAttachingBillKey(b.fileKey);
                        billAttachInputRef.current?.click();
                      }}
                      className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                      <FileUp className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      Allega PDF originale
                    </button>
                  )}

                  <div
                    className={`grid gap-2 pt-1 ${
                      canOpen ? 'grid-cols-[1fr_1fr_44px]' : 'grid-cols-[1fr_44px]'
                    }`}
                  >
                    {canOpen && (
                      <button
                        type="button"
                        disabled={openingAttachmentKey === b.fileKey}
                        onClick={() =>
                          void handleOpenAttachment(
                            b.fileKey,
                            undefined,
                            localFile?.fileName || `${b.label}-${b.number}.pdf`
                          )
                        }
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-500/35 rounded-xl disabled:opacity-50"
                      >
                        {openingAttachmentKey === b.fileKey ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ExternalLink className="w-4 h-4" />
                        )}
                        Apri
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void downloadShareableItem(
                          readOnly ? { ...b.payload, attachmentKey: undefined } : b.payload
                        )
                      }
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <Download className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      Scarica
                    </button>
                    <button
                      type="button"
                      aria-label="Altre azioni bolletta"
                      onClick={() => setMobileActionTarget({ kind: 'bill', bill: b })}
                      className="min-h-[44px] w-[44px] inline-flex items-center justify-center text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        );

        const billsSection = showBillsSection && (
          <section className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl overflow-hidden shadow-xs dark:shadow-none">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Bollette &amp; GSE ({allBillsForSharing.length})
                </h2>
                <p className="hidden md:block text-[11px] text-slate-500 dark:text-slate-400">
                  {readOnly
                    ? 'Senza accesso puoi scaricare o condividere il riepilogo HTML; i PDF originali restano privati.'
                    : 'Sincronizzate automaticamente con la pagina Bollette: apri in nuova scheda, scarica, condividi o elimina.'}
                </p>
              </div>
            </div>

            {allBillsForSharing.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Nessuna bolletta o ricevuta GSE trovata con questo filtro.
              </div>
            ) : (
              <>
                {renderMobileBillsCards()}
                <div className="hidden md:block">
                  {viewMode === 'grid' ? (
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {allBillsForSharing.map((b) => {
                  const localFile = b.fileKey ? vaultMeta[b.fileKey] : undefined;
                  const canOpen = !readOnly && Boolean(localFile);
                  const canDelete = canDeleteUnifiedBill(b);
                  return (
                    <article
                      key={b.id}
                      className="bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                              b.kind === 'luce'
                                ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30'
                                : b.kind === 'acqua'
                                  ? 'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30'
                                  : b.kind === 'gse'
                                    ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                    : 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30'
                            }`}
                          >
                            {b.kind === 'luce' ? (
                              <Zap className="w-3 h-3" />
                            ) : b.kind === 'acqua' ? (
                              <Droplets className="w-3 h-3" />
                            ) : b.kind === 'gse' ? (
                              <Sun className="w-3 h-3" />
                            ) : (
                              <Receipt className="w-3 h-3" />
                            )}
                            {b.label}
                          </span>
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                            {b.kind === 'gse' ? '+' : ''}
                            {b.amount.toFixed(2).replace('.', ',')} €
                          </span>
                        </div>

                        <div>
                          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {b.period}
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-400">
                            {b.supplier} · #{b.number} ({b.date})
                          </div>
                        </div>

                        {localFile ? (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-[10px] font-medium">
                            <FileCheck2 className="w-3 h-3" />
                            {readOnly
                              ? 'PDF privato'
                              : `${localFile.fileName}${localFile.size > 0 ? ` (${formatFileSize(localFile.size)})` : ''}`}
                          </div>
                        ) : !readOnly && b.fileKey ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAttachingBillKey(b.fileKey);
                              billAttachInputRef.current?.click();
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[10px]"
                          >
                            <FileUp className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                            Allega PDF
                          </button>
                        ) : null}
                      </div>

                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1">
                          {canOpen && (
                            <button
                              type="button"
                              disabled={openingAttachmentKey === b.fileKey}
                              onClick={() =>
                                void handleOpenAttachment(
                                  b.fileKey,
                                  undefined,
                                  localFile?.fileName || `${b.label}-${b.number}.pdf`
                                )
                              }
                              title="Apri in nuova scheda"
                              aria-label="Apri in nuova scheda"
                              className="p-1.5 text-sky-600 hover:bg-slate-200/70 dark:text-sky-300 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {openingAttachmentKey === b.fileKey ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ExternalLink className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void downloadShareableItem(
                                readOnly ? { ...b.payload, attachmentKey: undefined } : b.payload
                              )
                            }
                            title="Scarica"
                            aria-label="Scarica allegato"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg"
                          >
                            <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                            Scarica
                          </button>
                          <button
                            type="button"
                            onClick={() => setShareItem(b.payload)}
                            title="Condividi"
                            aria-label="Condividi allegato"
                            className="p-1.5 bg-sky-50 dark:bg-sky-500/15 hover:bg-sky-100 dark:hover:bg-sky-500/25 border border-sky-200 dark:border-sky-500/35 text-sky-700 dark:text-sky-300 rounded-lg"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setPendingDelete({ type: 'bill', item: b })}
                            title="Elimina"
                            aria-label="Elimina"
                            className="p-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Utenza</th>
                      <th className="px-3 py-2.5 font-medium">Periodo</th>
                      <th className="px-3 py-2.5 font-medium">Fornitore</th>
                      <th className="px-3 py-2.5 font-medium">N° Documento</th>
                      <th className="px-3 py-2.5 font-medium text-right">Importo</th>
                      <th className="px-3 py-2.5 font-medium">File Allegato</th>
                      <th className="px-4 py-2.5 font-medium text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/70">
                    {allBillsForSharing.map((b) => {
                      const localFile = b.fileKey ? vaultMeta[b.fileKey] : undefined;
                      const canOpen = !readOnly && Boolean(localFile);
                      const canDelete = canDeleteUnifiedBill(b);
                      return (
                        <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                                b.kind === 'luce'
                                  ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30'
                                  : b.kind === 'acqua'
                                    ? 'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30'
                                    : b.kind === 'gse'
                                      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                      : 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30'
                              }`}
                            >
                              {b.kind === 'luce' ? (
                                <Zap className="w-3 h-3" />
                              ) : b.kind === 'acqua' ? (
                                <Droplets className="w-3 h-3" />
                              ) : b.kind === 'gse' ? (
                                <Sun className="w-3 h-3" />
                              ) : (
                                <Receipt className="w-3 h-3" />
                              )}
                              {b.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                            {b.period}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                            {b.supplier}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-500 dark:text-slate-400">
                            <div>#{b.number}</div>
                            <div className="text-[10px]">{b.date}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {b.kind === 'gse' ? '+' : ''}
                            {b.amount.toFixed(2).replace('.', ',')} €
                          </td>
                          <td className="px-3 py-2.5">
                            {localFile ? (
                              <span
                                title={
                                  localFile.origin === 'firestore'
                                    ? 'Salvato su Firestore (accessibile da tutti i tuoi dispositivi)'
                                    : localFile.origin === 'bundled'
                                      ? 'PDF incluso nell’app (accessibile da tutti i tuoi dispositivi)'
                                      : 'Solo cache locale su questo browser'
                                }
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-[10px] font-medium"
                              >
                                <FileCheck2 className="w-3 h-3" />
                                {readOnly
                                  ? 'PDF originale privato'
                                  : localFile.size > 0
                                    ? `${localFile.origin === 'firestore' ? 'Cloud' : 'PDF'} (${formatFileSize(localFile.size)})`
                                    : 'PDF pronto'}
                              </span>
                            ) : !readOnly && b.fileKey ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAttachingBillKey(b.fileKey);
                                  billAttachInputRef.current?.click();
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px]"
                              >
                                <FileUp className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                                Allega PDF
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-500">Scheda pronta</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1">
                              {canOpen && (
                                <button
                                  type="button"
                                  disabled={openingAttachmentKey === b.fileKey}
                                  onClick={() =>
                                    void handleOpenAttachment(
                                      b.fileKey,
                                      undefined,
                                      localFile?.fileName || `${b.label}-${b.number}.pdf`
                                    )
                                  }
                                  title="Apri in nuova scheda"
                                  aria-label="Apri in nuova scheda"
                                  className="p-1.5 text-sky-600 hover:bg-slate-200/70 dark:text-sky-300 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {openingAttachmentKey === b.fileKey ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
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
                                      ? `Scarica (${localFile.fileName})`
                                      : 'Scarica riepilogo HTML'
                                }
                                aria-label="Scarica"
                                className="p-1.5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setShareItem(b.payload)}
                                title="Condividi"
                                aria-label="Condividi"
                                className="p-1.5 text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/15 rounded-lg transition-colors"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => setPendingDelete({ type: 'bill', item: b })}
                                  title="Elimina"
                                  aria-label="Elimina"
                                  className="p-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
                  )}
                </div>
              </>
            )}
          </section>
        );

        if (!hasAnyContent) {
          return (
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3 shadow-xs dark:shadow-none">
              <FolderOpen className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Nessun documento trovato in questa sezione
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                Usa &quot;Importa Documenti (Auto)&quot; per caricare qualsiasi PDF, bolletta o foto: l&apos;app riconosce automaticamente di cosa si tratta e lo archivia nel posto giusto.
              </p>
              {!readOnly && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => smartImportInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 dark:text-slate-950 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Importa Documenti (Auto)
                  </button>
                  <button
                    type="button"
                    onClick={() => openNewForm(DOCUMENT_STARTER_TEMPLATES[0])}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Inserisci a mano
                  </button>
                </div>
              )}
            </div>
          );
        }

        const renderDocsTable = (rows: UnifiedDocumentRow[], hideLinkedOriginColumn = false) => (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Documento</th>
                  <th className="px-3 py-2.5 font-medium">
                    {hideLinkedOriginColumn ? 'Tipo / Origine' : 'Prodotto / Origine'}
                  </th>
                  <th className="px-3 py-2.5 font-medium">Categoria</th>
                  <th className="px-3 py-2.5 font-medium">Ente / Fornitore</th>
                  <th className="px-3 py-2.5 font-medium">Allegato / Link</th>
                  <th className="px-4 py-2.5 font-medium text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/70">
                {rows.map((row) => {
                  const { doc, origin, fileKey, sharePayload, editable, deletable } = row;
                  const catMeta = CATEGORY_STYLE[doc.category] || CATEGORY_STYLE.Altro;
                  const CatIcon = catMeta.icon;
                  const localFile = fileKey ? vaultMeta[fileKey] : undefined;
                  const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
                  const openBusyKey = fileKey || doc.cloudUrl || doc.id;
                  return (
                    <tr key={row.rowKey} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                          {doc.pinned && (
                            <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                          )}
                          <span className="truncate">{doc.title}</span>
                        </div>
                        {origin.attachmentTypeLabel && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {origin.attachmentTypeLabel}
                          </div>
                        )}
                        {(doc.issueDate || doc.expiryDate) && (
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            {doc.issueDate ? `Data: ${doc.issueDate}` : ''}
                            {doc.issueDate && doc.expiryDate ? ' · ' : ''}
                            {doc.expiryDate ? `Scad: ${doc.expiryDate}` : ''}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2.5 max-w-[240px]">
                        {origin.isApplianceOrArticle && !hideLinkedOriginColumn ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                              <ShoppingBag className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                              <span className="truncate">{origin.groupTitle}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {[origin.label, origin.attachmentTypeLabel, origin.groupSubtitle]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border rounded-md ${origin.badgeClass}`}
                            >
                              {origin.key === 'macchina' ? (
                                <Car className="w-3 h-3" />
                              ) : origin.key === 'ricerche' ? (
                                <ShoppingBag className="w-3 h-3" />
                              ) : (
                                <FolderOpen className="w-3 h-3" />
                              )}
                              {origin.attachmentTypeLabel || origin.label}
                            </span>
                            {hideLinkedOriginColumn && origin.isApplianceOrArticle && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                {origin.label}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border rounded-md ${catMeta.badge}`}
                        >
                          <CatIcon className="w-3 h-3" />
                          {doc.category}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                        <div className="font-medium">{doc.provider}</div>
                        {doc.referenceCode &&
                          !doc.referenceCode.startsWith('ART:') &&
                          !doc.referenceCode.startsWith('RES:') &&
                          !doc.referenceCode.startsWith('AUTO:') && (
                            <div className="text-[10px] font-mono text-slate-500">
                              {doc.referenceCode}
                            </div>
                          )}
                      </td>

                      <td className="px-3 py-2.5">
                        {localFile ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-[10px] font-medium">
                            <FileCheck2 className="w-3 h-3" />
                            {localFile.origin === 'firestore' ? 'Cloud · ' : ''}
                            {formatFileSize(localFile.size) || 'File'}
                          </span>
                        ) : doc.fileName ? (
                          <span className="text-[10px] text-slate-600 dark:text-slate-400 truncate max-w-[160px] inline-block">
                            {doc.fileName}
                          </span>
                        ) : doc.cloudUrl ? (
                          <span className="text-[10px] text-sky-600 dark:text-sky-400">
                            Link Cloud
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Scheda digitale</span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {canOpen && (
                            <button
                              type="button"
                              disabled={openingAttachmentKey === openBusyKey}
                              onClick={() =>
                                void handleOpenAttachment(
                                  readOnly ? undefined : fileKey,
                                  doc.cloudUrl,
                                  doc.fileName || doc.title
                                )
                              }
                              title="Apri in nuova scheda"
                              aria-label="Apri in nuova scheda"
                              className="p-1.5 text-sky-600 hover:bg-slate-200/70 dark:text-sky-300 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {openingAttachmentKey === openBusyKey ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ExternalLink className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void downloadShareableItem(
                                readOnly ? { ...sharePayload, attachmentKey: undefined } : sharePayload
                              )
                            }
                            title="Scarica"
                            aria-label="Scarica"
                            className="p-1.5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShareItem(sharePayload)}
                            title="Condividi"
                            aria-label="Condividi"
                            className="p-1.5 text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/15 rounded-lg transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                          {!readOnly && editable && (
                            <button
                              type="button"
                              onClick={() => openEditForm(doc)}
                              title="Modifica documento"
                              aria-label="Modifica documento"
                              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-300 rounded-lg"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!readOnly && deletable && (
                            <button
                              type="button"
                              onClick={() => setPendingDelete({ type: 'document', doc })}
                              title="Elimina documento"
                              aria-label="Elimina documento"
                              className="p-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );

        const renderDocsGrid = (rows: UnifiedDocumentRow[], hideLinkedOriginBanner = false) => (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((row) => {
              const { doc, origin, fileKey, sharePayload, editable, deletable } = row;
              const meta = CATEGORY_STYLE[doc.category] || CATEGORY_STYLE.Altro;
              const Icon = meta.icon;
              const localFile = fileKey ? vaultMeta[fileKey] : undefined;
              const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
              const openBusyKey = fileKey || doc.cloudUrl || doc.id;

              return (
                <article
                  key={row.rowKey}
                  className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors shadow-xs dark:shadow-none"
                >
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200">
                          <Icon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          {doc.category}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{origin.attachmentTypeLabel || origin.label}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {doc.pinned && (
                          <span
                            title="In evidenza"
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 rounded"
                          >
                            <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500 dark:fill-amber-300 dark:text-amber-300" />
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
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded"
                          >
                            <FileCheck2 className="w-3 h-3" />
                            {localFile.origin === 'firestore' ? 'Cloud · ' : ''}
                            {formatFileSize(localFile.size) || 'File'}
                          </span>
                        ) : doc.fileName ? (
                          <span className="px-2 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded">
                            {doc.fileName}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {origin.isApplianceOrArticle && !hideLinkedOriginBanner && (
                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                        {origin.imageUrl ? (
                          <img
                            src={origin.imageUrl}
                            alt=""
                            className="w-6 h-6 rounded object-cover shrink-0 bg-white"
                          />
                        ) : (
                          <ShoppingBag className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {origin.groupTitle}
                          </div>
                          {origin.groupSubtitle && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {origin.groupSubtitle}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {doc.title}
                      </h3>
                      <div className="text-xs text-sky-700 dark:text-sky-300 font-medium mt-0.5">
                        {doc.provider}
                      </div>
                    </div>

                    {(doc.referenceCode || doc.issueDate || doc.expiryDate) && (
                      <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5 text-[11px] space-y-1">
                        {doc.referenceCode &&
                          !doc.referenceCode.startsWith('ART:') &&
                          !doc.referenceCode.startsWith('RES:') &&
                          !doc.referenceCode.startsWith('AUTO:') && (
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-500">Codice / Pratica:</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200 truncate">
                                {doc.referenceCode}
                              </span>
                            </div>
                          )}
                        {doc.issueDate && (
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-500">Data:</span>
                            <span className="font-mono text-slate-700 dark:text-slate-300">
                              {doc.issueDate}
                            </span>
                          </div>
                        )}
                        {doc.expiryDate && (
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-500">Scadenza:</span>
                            <span className="font-mono text-amber-700 dark:text-amber-300">
                              {doc.expiryDate}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {doc.notes && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {doc.notes}
                      </p>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {canOpen && (
                        <button
                          type="button"
                          disabled={openingAttachmentKey === openBusyKey}
                          onClick={() =>
                            void handleOpenAttachment(
                              readOnly ? undefined : fileKey,
                              doc.cloudUrl,
                              doc.fileName || doc.title
                            )
                          }
                          title="Apri in nuova scheda"
                          aria-label="Apri in nuova scheda"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/15 dark:hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/35 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {openingAttachmentKey === openBusyKey ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ExternalLink className="w-3.5 h-3.5" />
                          )}
                          Apri
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void downloadShareableItem(
                            readOnly
                              ? { ...sharePayload, attachmentKey: undefined }
                              : sharePayload
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        Scarica
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareItem(sharePayload)}
                        aria-label="Condividi documento"
                        title="Condividi"
                        className="p-1.5 bg-sky-50 dark:bg-sky-500/15 hover:bg-sky-100 dark:hover:bg-sky-500/25 border border-sky-200 dark:border-sky-500/35 text-sky-700 dark:text-sky-300 rounded-lg"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {!readOnly && (editable || deletable) && (
                      <div className="flex items-center gap-1">
                        {editable && (
                          <button
                            type="button"
                            onClick={() => openEditForm(doc)}
                            aria-label="Modifica documento"
                            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-300 rounded-lg"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {deletable && (
                          <button
                            type="button"
                            onClick={() => setPendingDelete({ type: 'document', doc })}
                            aria-label="Elimina documento"
                            className="p-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        );

        const renderMobileDocsCards = (rows: UnifiedDocumentRow[], hideLinkedProduct = false) => (
          <div className="md:hidden space-y-3">
            {rows.map((row) => {
              const { doc, origin, fileKey, sharePayload } = row;
              const catMeta = CATEGORY_STYLE[doc.category] || CATEGORY_STYLE.Altro;
              const CatIcon = catMeta.icon;
              const localFile = fileKey ? vaultMeta[fileKey] : undefined;
              const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
              const openBusyKey = fileKey || doc.cloudUrl || doc.id;
              const displayRefCode =
                doc.referenceCode &&
                !doc.referenceCode.startsWith('ART:') &&
                !doc.referenceCode.startsWith('RES:') &&
                !doc.referenceCode.startsWith('AUTO:')
                  ? doc.referenceCode
                  : '';

              return (
                <article
                  key={row.rowKey}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-xs dark:shadow-none"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                      <CatIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {doc.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{origin.attachmentTypeLabel || origin.label}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {doc.pinned && (
                        <Star
                          aria-label="In evidenza"
                          className="w-4 h-4 fill-amber-500 text-amber-500 shrink-0"
                        />
                      )}
                      {localFile ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-[11px] font-medium tabular-nums">
                          <FileCheck2 className="w-3 h-3" />
                          {formatStorageBadgeText(localFile)}
                        </span>
                      ) : doc.cloudUrl ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/30 text-[11px] font-medium">
                          Link Cloud
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {origin.isApplianceOrArticle && !hideLinkedProduct && (
                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      {origin.imageUrl ? (
                        <img
                          src={origin.imageUrl}
                          alt=""
                          className="w-6 h-6 rounded-md object-cover shrink-0 bg-white border border-slate-200 dark:border-slate-700"
                        />
                      ) : (
                        <ShoppingBag className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                      )}
                      <span className="font-semibold truncate">{origin.groupTitle}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                      {doc.title}
                    </h3>
                    <div className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      <span className="font-medium text-sky-700 dark:text-sky-300">
                        {doc.provider}
                      </span>
                      {displayRefCode ? ` · #${displayRefCode}` : ''}
                      {doc.issueDate ? ` · ${doc.issueDate}` : ''}
                      {doc.expiryDate ? ` · Scad. ${doc.expiryDate}` : ''}
                    </div>
                    {doc.notes && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2 pt-0.5">
                        {doc.notes}
                      </p>
                    )}
                  </div>

                  <div
                    className={`grid gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 ${
                      canOpen ? 'grid-cols-[1fr_1fr_44px]' : 'grid-cols-[1fr_44px]'
                    }`}
                  >
                    {canOpen && (
                      <button
                        type="button"
                        disabled={openingAttachmentKey === openBusyKey}
                        onClick={() =>
                          void handleOpenAttachment(
                            readOnly ? undefined : fileKey,
                            doc.cloudUrl,
                            doc.fileName || doc.title
                          )
                        }
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-500/35 rounded-xl disabled:opacity-50"
                      >
                        {openingAttachmentKey === openBusyKey ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ExternalLink className="w-4 h-4" />
                        )}
                        Apri
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void downloadShareableItem(
                          readOnly
                            ? { ...sharePayload, attachmentKey: undefined }
                            : sharePayload
                        )
                      }
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <Download className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      Scarica
                    </button>
                    <button
                      type="button"
                      aria-label="Altre azioni documento"
                      onClick={() => setMobileActionTarget({ kind: 'doc', row })}
                      className="min-h-[44px] w-[44px] inline-flex items-center justify-center text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        );

        const useGroupedLayout =
          groupByProduct && linkedProductFilterOptions.items.length > 0 && productFilter === 'all';

        return (
          <div className="space-y-6">
            {showDocsSection &&
              filteredDocumentRows.length > 0 &&
              (useGroupedLayout ? (
                <div className="space-y-5">
                  {groupedDocumentSections.map((section) => (
                    <section key={section.groupKey} className="space-y-3 md:space-y-0">
                      {/* Mobile Group Header + Cards (<768px) */}
                      <div className="md:hidden space-y-2.5">
                        <div className="flex items-center gap-2.5 px-1">
                          {section.imageUrl ? (
                            <img
                              src={section.imageUrl}
                              alt=""
                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                              {section.originKey === 'ricerche' ? (
                                <ShoppingBag className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                              ) : (
                                <FolderOpen className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                              )}
                            </div>
                          )}
                          <div className="min-w-0">
                            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                              {section.title}{' '}
                              <span className="font-mono text-xs font-normal text-slate-500 dark:text-slate-400">
                                ({section.rows.length})
                              </span>
                            </h2>
                            {section.subtitle && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {section.subtitle}
                              </p>
                            )}
                          </div>
                        </div>
                        {renderMobileDocsCards(section.rows, true)}
                      </div>

                      {/* Desktop Grouped Table/Grid (>=768px) */}
                      <div className="hidden md:block bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs dark:shadow-none">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {section.imageUrl ? (
                              <img
                                src={section.imageUrl}
                                alt=""
                                className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                                {section.originKey === 'ricerche' ? (
                                  <ShoppingBag className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                                ) : (
                                  <FolderOpen className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                                )}
                              </div>
                            )}
                            <div className="min-w-0">
                              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                                {section.title}{' '}
                                <span className="font-mono text-xs font-normal text-slate-500 dark:text-slate-400">
                                  ({section.rows.length})
                                </span>
                              </h2>
                              {section.subtitle && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {section.subtitle}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {viewMode === 'list' ? (
                          renderDocsTable(section.rows, true)
                        ) : (
                          <div className="p-4">{renderDocsGrid(section.rows, true)}</div>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <>
                  {renderMobileDocsCards(filteredDocumentRows, false)}
                  <div className="hidden md:block">
                    {viewMode === 'list' ? (
                      <section className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs dark:shadow-none">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            Documenti &amp; Allegati dalle Pagine ({filteredDocumentRows.length})
                          </h2>
                        </div>
                        {renderDocsTable(filteredDocumentRows, false)}
                      </section>
                    ) : (
                      renderDocsGrid(filteredDocumentRows, false)
                    )}
                  </div>
                </>
              ))}

            {billsSection}
          </div>
        );
      })()}

      {/* Mobile Filter Bottom Sheet (<768px) */}
      {mobileFilterSheetOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden flex items-end bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setMobileFilterSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Filtra Archivio Documenti
              </h2>
              <button
                type="button"
                aria-label="Chiudi filtri"
                onClick={() => setMobileFilterSheetOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Sezione / Origine
              </label>
              <select
                value={originFilter}
                onChange={(e) => {
                  const next = e.target.value as OriginFilter;
                  setOriginFilter(next);
                  if (next === 'bollette') {
                    setActiveTab('bollette');
                    setProductFilter('all');
                  } else if (next === 'ricerche') {
                    setActiveTab('ricerche');
                  } else if (activeTab === 'bollette' || activeTab === 'ricerche') {
                    setActiveTab('all');
                  }
                }}
                className="w-full min-h-[44px] px-3 py-2 text-base bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
              >
                <option value="all">
                  Tutte le origini ({allUnifiedDocumentRows.length + totalShareableBillsCount})
                </option>
                <option value="documenti">Documenti Casa ({originCounts.documenti})</option>
                <option value="ricerche">Prodotti ({originCounts.ricerche})</option>
                <option value="bollette">Bollette &amp; GSE ({totalShareableBillsCount})</option>
                <option value="macchina">
                  Macchina {carPlate} ({originCounts.macchina})
                </option>
              </select>
            </div>

            {linkedProductFilterOptions.items.length > 0 &&
              activeTab !== 'bollette' &&
              originFilter !== 'bollette' && (
                <>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Prodotto / Elettrodomestico
                    </label>
                    <select
                      value={productFilter}
                      onChange={(e) => setProductFilter(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 text-base bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
                    >
                      <option value="all">Tutti i prodotti ({allUnifiedDocumentRows.length})</option>
                      {linkedProductFilterOptions.items.map((item) => (
                        <option key={item.groupKey} value={item.groupKey}>
                          {item.title} ({item.count})
                        </option>
                      ))}
                      {linkedProductFilterOptions.otherCount > 0 && (
                        <option value="unlinked">
                          Solo documenti non collegati ({linkedProductFilterOptions.otherCount})
                        </option>
                      )}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleGroupByProduct}
                    aria-pressed={groupByProduct}
                    className={`min-h-[44px] w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-semibold ${
                      groupByProduct
                        ? 'bg-sky-50 dark:bg-sky-500/15 border-sky-300 dark:border-sky-500/40 text-sky-800 dark:text-sky-200'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Layers className="w-4 h-4" />
                      Divisi per prodotto
                    </span>
                    <span>{groupByProduct ? 'Attivo' : 'Disattivo'}</span>
                  </button>
                </>
              )}

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('all');
                  setOriginFilter('all');
                  setProductFilter('all');
                }}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800"
              >
                Reimposta
              </button>
              <button
                type="button"
                onClick={() => setMobileFilterSheetOpen(false)}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold rounded-xl bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-950"
              >
                Mostra risultati
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Quick Action Bottom Sheet (<768px) */}
      {mobileActionTarget && (
        <div
          className="fixed inset-0 z-50 md:hidden flex items-end bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setMobileActionTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl p-4 space-y-2 shadow-2xl"
          >
            {mobileActionTarget.kind === 'doc' ? (
              (() => {
                const { row } = mobileActionTarget;
                const { doc, fileKey, sharePayload, editable, deletable } = row;
                const localFile = fileKey ? vaultMeta[fileKey] : undefined;
                const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
                return (
                  <>
                    <div className="px-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {doc.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {doc.provider} · {doc.category}
                      </div>
                    </div>

                    {canOpen && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          void handleOpenAttachment(
                            readOnly ? undefined : fileKey,
                            doc.cloudUrl,
                            doc.fileName || doc.title
                          );
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-sky-700 dark:text-sky-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <ExternalLink className="w-4 h-4 shrink-0" />
                        Apri in nuova scheda
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setMobileActionTarget(null);
                        void downloadShareableItem(
                          readOnly
                            ? { ...sharePayload, attachmentKey: undefined }
                            : sharePayload
                        );
                      }}
                      className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Download className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                      Scarica sul telefono
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileActionTarget(null);
                        setShareItem(sharePayload);
                      }}
                      className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Share2 className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                      Condividi
                    </button>

                    {!readOnly && editable && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          openEditForm(doc);
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4 shrink-0 text-slate-500" />
                        Modifica dettagli / file
                      </button>
                    )}

                    {!readOnly && deletable && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          setPendingDelete({ type: 'document', doc });
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4 shrink-0" />
                        Elimina documento
                      </button>
                    )}
                  </>
                );
              })()
            ) : (
              (() => {
                const { bill } = mobileActionTarget;
                const localFile = bill.fileKey ? vaultMeta[bill.fileKey] : undefined;
                const canOpen = !readOnly && Boolean(localFile);
                const canDelete = canDeleteUnifiedBill(bill);
                return (
                  <>
                    <div className="px-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {bill.label} · {bill.period}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {bill.supplier} · #{bill.number}
                      </div>
                    </div>

                    {canOpen && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          void handleOpenAttachment(
                            bill.fileKey,
                            undefined,
                            localFile?.fileName || `${bill.label}-${bill.number}.pdf`
                          );
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-sky-700 dark:text-sky-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <ExternalLink className="w-4 h-4 shrink-0" />
                        Apri PDF in nuova scheda
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setMobileActionTarget(null);
                        void downloadShareableItem(
                          readOnly
                            ? { ...bill.payload, attachmentKey: undefined }
                            : bill.payload
                        );
                      }}
                      className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Download className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                      Scarica sul telefono
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileActionTarget(null);
                        setShareItem(bill.payload);
                      }}
                      className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Share2 className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                      Condividi
                    </button>

                    {!readOnly && bill.fileKey && !localFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          setAttachingBillKey(bill.fileKey);
                          billAttachInputRef.current?.click();
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <FileUp className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                        Allega PDF originale
                      </button>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          setPendingDelete({ type: 'bill', item: bill });
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4 shrink-0" />
                        Elimina
                      </button>
                    )}
                  </>
                );
              })()
            )}

            <button
              type="button"
              onClick={() => setMobileActionTarget(null)}
              className="min-h-[44px] w-full rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {shareItem && (
        <ShareSheetModal
          item={shareItem}
          readOnly={readOnly}
          onClose={() => setShareItem(null)}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl md:rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {pendingDelete.type === 'document'
                    ? `Eliminare "${pendingDelete.doc.title}"?`
                    : `Eliminare "${pendingDelete.item.label} · ${pendingDelete.item.period}"?`}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {pendingDelete.type === 'document'
                    ? 'Verrà rimosso sia dall’archivio su Firebase (e dalla eventuale pagina collegata) sia il file allegato.'
                    : 'Verrà rimossa sia dalla pagina Bollette che dall’archivio Documenti insieme all’eventuale PDF su Firebase.'}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="min-h-[44px] md:min-h-0 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl md:rounded-lg"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="min-h-[44px] md:min-h-0 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl md:rounded-lg"
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
