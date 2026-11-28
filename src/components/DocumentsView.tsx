import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
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
  Scissors,
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
  downloadShareableItem,
  formatFileSize,
  getDedicatedVaultStorageStatus,
  getElectricityBillFileKey,
  getTariBillFileKey,
  getWaterBillFileKey,
  inferArticleAttachmentType,
  isOctopusContractRecord,
  isProductUserManualAttachment,
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
import { PdfItalianTrimModal, PdfItalianTrimTarget } from './PdfItalianTrimModal';
import {
  autoTrimMultilingualManualPdf,
  PdfExtractResult,
} from '../utils/pdfItalianExtractor';
import { getResearchRoomLabel } from '../utils/researchHelpers';

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
type OriginFilter = 'all' | OriginKey | 'non_bollette';
type ViewMode = 'list' | 'grid';
type DocumentSortBy = 'pinned_name' | 'name_asc' | 'product_origin' | 'size_desc' | 'date_desc';
type DomainSectionId = 'casa' | 'prodotti' | 'auto' | 'bollette';

const VIEW_MODE_STORAGE_KEY = 'myhome_documents_view_mode_v1';
const GROUP_BY_PRODUCT_STORAGE_KEY = 'myhome_documents_group_by_product_v1';
const SORT_BY_STORAGE_KEY = 'myhome_documents_sort_by_v1';
const COLLAPSED_SECTIONS_STORAGE_KEY = 'myhome_documents_collapsed_sections_v1';
const EXPIRY_SOON_DAYS = 60;

function parseDocExpiryMs(raw?: string): number | null {
  const s = (raw || '').trim();
  if (!s) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const it = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!it) return null;
    day = Number(it[1]);
    month = Number(it[2]);
    year = Number(it[3]);
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

function parseFlexibleDateMs(raw?: string): number | null {
  const exact = parseDocExpiryMs(raw);
  if (exact !== null) return exact;
  const s = (raw || '').trim();
  if (!s) return null;
  const ym = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (m >= 1 && m <= 12) return new Date(y, m - 1, 1).getTime();
  }
  const my = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (my) {
    const m = Number(my[1]);
    const y = Number(my[2]);
    if (m >= 1 && m <= 12) return new Date(y, m - 1, 1).getTime();
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

interface OriginMeta {
  key: Exclude<OriginKey, 'bollette'>;
  label: string;
  detail: string;
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

const CATEGORY_ICON_STYLE: Record<
  HomeDocumentCategory,
  { icon: typeof FileText; iconColor: string; surfaceBg: string }
> = {
  'Mutuo & Casa': {
    icon: Building2,
    iconColor: 'text-amber-600 dark:text-amber-400',
    surfaceBg: 'bg-amber-500/10 dark:bg-amber-400/10',
  },
  'Internet & Wi-Fi': {
    icon: Wifi,
    iconColor: 'text-sky-600 dark:text-sky-400',
    surfaceBg: 'bg-sky-500/10 dark:bg-sky-400/10',
  },
  'Contratti & Utenze': {
    icon: FileText,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    surfaceBg: 'bg-emerald-500/10 dark:bg-emerald-400/10',
  },
  Assicurazioni: {
    icon: Shield,
    iconColor: 'text-teal-600 dark:text-teal-400',
    surfaceBg: 'bg-teal-500/10 dark:bg-teal-400/10',
  },
  'Fiscale & Identità': {
    icon: FileCheck2,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    surfaceBg: 'bg-cyan-500/10 dark:bg-cyan-400/10',
  },
  Altro: {
    icon: FolderOpen,
    iconColor: 'text-slate-600 dark:text-slate-300',
    surfaceBg: 'bg-slate-200/70 dark:bg-slate-800',
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

function readInitialSortBy(): DocumentSortBy {
  try {
    const saved = localStorage.getItem(SORT_BY_STORAGE_KEY);
    if (
      saved === 'pinned_name' ||
      saved === 'name_asc' ||
      saved === 'product_origin' ||
      saved === 'size_desc' ||
      saved === 'date_desc'
    ) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'pinned_name';
}

function readInitialCollapsedSections(): Record<DomainSectionId, boolean> {
  const defaults: Record<DomainSectionId, boolean> = {
    casa: false,
    prodotti: false,
    auto: false,
    bollette: false,
  };
  try {
    const saved = localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved) as Partial<Record<DomainSectionId, unknown>>;
    return {
      casa: Boolean(parsed.casa),
      prodotti: Boolean(parsed.prodotti),
      auto: Boolean(parsed.auto),
      bollette: Boolean(parsed.bollette),
    };
  } catch {
    return defaults;
  }
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
    `${typeLabel} — ${payment.period}`,
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

function formatScopedDocumentTitle(rawTitle: string, groupTitle?: string): string {
  const title = rawTitle.trim();
  if (!title || !groupTitle) return title;
  const cleanGroup = groupTitle.trim().toLowerCase();
  if (!cleanGroup) return title;

  for (const sep of [' · ', ' — ', ' - ']) {
    const idx = title.indexOf(sep);
    if (idx <= 0) continue;
    const prefix = title.slice(0, idx).trim();
    const suffix = title.slice(idx + sep.length).trim().toLowerCase();
    if (!prefix || suffix.length < 6) continue;
    if (
      cleanGroup.startsWith(suffix) ||
      suffix.startsWith(cleanGroup) ||
      cleanGroup.includes(suffix)
    ) {
      return prefix;
    }
  }
  return title;
}

function formatDisplayDocumentNotes(rawNotes?: string): string | null {
  if (!rawNotes) return null;
  const parts = rawNotes
    .split(/[·\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter(
      (p) =>
        !/^file\s+allegato\s+a\s+prodotto\b/i.test(p) &&
        !/^documento\s+ufficiale\s+collegato\b/i.test(p) &&
        !/^documenti\s+ufficiali\b/i.test(p) &&
        !/^allegato\s+(?:auto|prodotto)\b/i.test(p)
    );
  return parts.length > 0 ? parts.join(' · ') : null;
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
  const [expiryOnlyFilter, setExpiryOnlyFilter] = useState<boolean>(false);
  const [groupByProduct, setGroupByProduct] = useState<boolean>(readInitialGroupByProduct);
  const [viewMode, setViewMode] = useState<ViewMode>(readInitialViewMode);
  const [sortBy, setSortBy] = useState<DocumentSortBy>(readInitialSortBy);
  const [collapsedSections, setCollapsedSections] = useState<Record<DomainSectionId, boolean>>(
    readInitialCollapsedSections
  );
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

  // Mobile sheets (< 768px)
  const [mobileFilterSheetOpen, setMobileFilterSheetOpen] = useState(false);
  const [mobileStorageSheetOpen, setMobileStorageSheetOpen] = useState(false);
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
  const [trimPdfModal, setTrimPdfModal] = useState<{
    target: PdfItalianTrimTarget;
    existingDoc?: HomeDocumentRecord;
    isPendingFormFile?: boolean;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const formFileInputRef = useRef<HTMLInputElement | null>(null);
  const smartImportInputRef = useRef<HTMLInputElement | null>(null);
  const billAttachInputRef = useRef<HTMLInputElement | null>(null);
  const manuallyTrimmedFileRef = useRef<File | null>(null);
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

  function handleChangeSortBy(nextSort: DocumentSortBy) {
    setSortBy(nextSort);
    try {
      localStorage.setItem(SORT_BY_STORAGE_KEY, nextSort);
    } catch {
      // ignore storage errors
    }
  }

  function toggleDomainSection(sectionId: DomainSectionId) {
    setCollapsedSections((prev) => {
      const next = { ...prev, [sectionId]: !prev[sectionId] };
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  function setDomainSectionCollapsed(sectionId: DomainSectionId, collapsed: boolean) {
    setCollapsedSections((prev) => {
      if (prev[sectionId] === collapsed) return prev;
      const next = { ...prev, [sectionId]: collapsed };
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(next));
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
      if (res.migrated === 0 && res.failed > 0) {
        const stopHint = res.stoppedEarly ? ' (migrazione interrotta subito per evitare errori ripetuti)' : '';
        const errHint = res.firstError ? ` Motivo rilevato: ${res.firstError}` : '';
        setStatusNotice(
          `Migrazione verso ${res.providerLabel} non riuscita: 0 file trasferiti su ${res.remaining} da spostare${stopHint}.${errHint}`
        );
      } else if (res.failed > 0 || res.stoppedEarly || res.remaining > 0) {
        const errHint = res.firstError ? ` Motivo: ${res.firstError}` : '';
        setStatusNotice(
          `Migrazione parziale verso ${res.providerLabel}: ${res.migrated} file trasferiti, ${res.remaining} ancora su Firestore.${errHint}`
        );
      } else {
        setStatusNotice(
          `Migrazione verso ${res.providerLabel} completata: ${res.migrated} file trasferiti da Firestore (0 errori). Ora puoi risparmiare spazio e quota su Firebase!`
        );
      }
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
    manuallyTrimmedFileRef.current = null;
  }

  function openNewForm() {
    resetForm();
    if (activeTab !== 'all' && activeTab !== 'bollette' && activeTab !== 'ricerche') {
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
    manuallyTrimmedFileRef.current = null;
    setShowForm(true);
  }

  async function handleFormFileSelected(file: File | null) {
    manuallyTrimmedFileRef.current = null;
    if (!file) {
      setPendingFile(null);
      return;
    }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const shouldAutoTrim =
      isPdf &&
      (Boolean(linkedResearchId && (linkedDocType === 'manuale' || linkedDocType === 'altro')) ||
        category === 'Altro' ||
        /(?:manual|istruzion|guida|libretto|uso|manutenzione|montagg|user\s*guide)/i.test(
          `${title} ${file.name}`
        ));
    if (!shouldAutoTrim) {
      setPendingFile(file);
      return;
    }

    setPendingFile(file);
    const preTrim = await autoTrimMultilingualManualPdf(file);
    if (preTrim.trimmed && preTrim.extract) {
      setPendingFile(preTrim.file);
      const trimNote = `Solo IT (pag. ${preTrim.extract.rangeText})`;
      setNotes((prev) => (prev.trim() ? prev : trimNote));
      setStatusNotice(
        `Manuale multilingua impostato automaticamente in versione italiana (pag. ${preTrim.extract.rangeText}: ${formatFileSize(
          preTrim.extract.originalSize
        )} → ${formatFileSize(preTrim.extract.newSize)}).`
      );
    }
  }

  async function handleTogglePinned(doc: HomeDocumentRecord) {
    if (readOnly) return;
    const nextPinned = !doc.pinned;
    const { id: _ignoredId, ...rest } = doc;
    try {
      await onUpdateDocument(doc.id, {
        ...rest,
        pinned: nextPinned,
      });
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Errore nell’aggiornamento dei preferiti.');
    }
  }

  function isPdfDocumentCandidate(doc: HomeDocumentRecord, localFile?: VaultFileMeta): boolean {
    if (doc.fileMime === 'application/pdf' || localFile?.mimeType === 'application/pdf') return true;
    const names = [doc.fileName, localFile?.fileName, doc.cloudUrl].filter(Boolean).join(' ').toLowerCase();
    return /\.pdf(?:[?#]|$)/.test(names);
  }

  function openPdfTrimForDocument(doc: HomeDocumentRecord, fileKey?: string) {
    const localFile = fileKey ? vaultMeta[fileKey] : undefined;
    setTrimPdfModal({
      target: {
        title: doc.title,
        fileName: localFile?.fileName || doc.fileName || `${doc.title}.pdf`,
        fileKey: fileKey || doc.attachmentKey,
        cloudUrl: doc.cloudUrl,
      },
      existingDoc: doc,
    });
  }

  async function handleSaveTrimmedDocument(result: PdfExtractResult) {
    if (!trimPdfModal) return;
    if (trimPdfModal.isPendingFormFile) {
      manuallyTrimmedFileRef.current = result.file;
      setPendingFile(result.file);
      setStatusNotice(
        `File ridotto (pag. ${result.rangeText}: ${formatFileSize(
          result.originalSize
        )} → ${formatFileSize(result.newSize)}). Ora puoi salvare il documento.`
      );
      return;
    }

    const existingDoc = trimPdfModal.existingDoc;
    if (!existingDoc) return;

    const targetKey =
      existingDoc.attachmentKey ||
      `doc_${existingDoc.id}_${Date.now().toString(36).slice(-4)}`;
    const stored = await saveVaultFile(
      targetKey,
      result.file,
      result.file.name,
      'application/pdf',
      undefined,
      {
        actionLabel: 'PDF ridotto a solo Italiano',
        displayTitle: existingDoc.title,
        changedDetails: [
          `Pagine: ${result.rangeText} (${result.pageCount}/${result.originalPageCount})`,
          `${formatFileSize(result.originalSize)} → ${formatFileSize(result.newSize)}`,
        ],
      }
    );
    if (!stored.cloudSynced && !stored.savedLocallyOnly) {
      throw new Error('Impossibile salvare il PDF ridotto sul cloud.');
    }

    const { id: _ignoredId, ...rest } = existingDoc;
    const baseNote = (existingDoc.notes || '')
      .replace(/\s*·?\s*Solo IT \([^)]+\)/gi, '')
      .trim();
    const trimTag = `Solo IT (pag. ${result.rangeText})`;
    const nextNotes = baseNote ? `${baseNote} · ${trimTag}` : trimTag;

    await onUpdateDocument(existingDoc.id, {
      ...rest,
      attachmentKey: stored.key,
      fileName: stored.fileName,
      fileMime: stored.mimeType || 'application/pdf',
      fileSize: stored.size,
      notes: nextNotes.slice(0, 180),
    });
    await reloadVaultMeta();
    setStatusNotice(
      `PDF "${existingDoc.title}" ridotto a solo Italiano (pag. ${result.rangeText}): ${formatFileSize(
        result.originalSize
      )} → ${formatFileSize(result.newSize)}.`
    );
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
        let effectivePendingFile = pendingFile;
        const isPdf =
          pendingFile.type === 'application/pdf' || /\.pdf$/i.test(pendingFile.name);
        const isManuallyCustomized = manuallyTrimmedFileRef.current === pendingFile;
        if (
          isPdf &&
          !isManuallyCustomized &&
          (Boolean(linkedResearchId && (linkedDocType === 'manuale' || linkedDocType === 'altro')) ||
            /(?:manual|istruzion|guida|libretto|uso|manutenzione|montagg|user\s*guide)/i.test(
              `${title} ${pendingFile.name}`
            ))
        ) {
          const trimmed = await autoTrimMultilingualManualPdf(pendingFile);
          if (trimmed.trimmed && trimmed.extract) {
            effectivePendingFile = trimmed.file;
          }
        }
        const stored = await saveVaultFile(
          attachmentKey,
          effectivePendingFile,
          effectivePendingFile.name,
          effectivePendingFile.type,
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
    cloudUrlValue?: string,
    fallbackName?: string
  ) {
    const busyId = attachmentKey || cloudUrlValue || fallbackName || 'opening';
    setOpeningAttachmentKey(busyId);
    setStatusNotice(null);
    try {
      const opened = await openVaultFileInNewTab(attachmentKey, cloudUrlValue, fallbackName);
      if (!opened) {
        setStatusNotice(
          attachmentKey && isFirestoreQuotaExceededActive()
            ? 'Allegato non ancora presente nella cache locale di questo dispositivo e quota lettura Firebase esaurita: usa "Scarica offline" quando la quota si resetta.'
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
        throw new Error(`Il file "${file.name}" non è stato salvato su cloud.`);
      }
      setStatusNotice(
        isFirestoreQuotaExceededActive()
          ? `Quota Firestore esaurita: file "${file.name}" salvato in locale (invio automatico al ripristino).`
          : `File "${file.name}" salvato (${stored.storageBackend === 's3' ? vaultStorageStatus?.providerLabel || 'Backblaze B2' : 'Cloud'}): disponibile in Bollette e Documenti.`
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
    cloudUrlValue?: string
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
            classification.documentCategory !== 'Altro' &&
            classification.documentCategory !== 'Assicurazioni'
          ? classification.documentCategory
          : 'Altro'
      : DOCUMENT_CATEGORIES.includes(classification.documentCategory)
        ? classification.documentCategory
        : 'Altro';
    const pinHintText = [
      file.name,
      cleanTitle,
      cloudUrlValue,
      classification.notes,
    ]
      .filter(Boolean)
      .join(' ');
    const autoPinned = matchedProduct
      ? isProductUserManualAttachment(effectiveType, cleanTitle, pinHintText)
      : effectiveType === 'manuale' &&
        effectiveCategory === 'Altro' &&
        /(?:manual|istruzion|user\s*guide|libretto|uso\s+e\s+manutenzione|guida\s+(?:rapida|utente|all['’]?uso)|montagg)/i.test(
          pinHintText
        ) &&
        isProductUserManualAttachment(effectiveType, cleanTitle, pinHintText);
    let fileToStore = file;
    let trimNoteSuffix = '';
    const isPdfSource = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (
      isPdfSource &&
      (effectiveType === 'manuale' ||
        (matchedProduct && effectiveType === 'altro') ||
        effectiveCategory === 'Altro')
    ) {
      const trimmed = await autoTrimMultilingualManualPdf(file);
      if (trimmed.trimmed && trimmed.extract) {
        fileToStore = trimmed.file;
        trimNoteSuffix = `Solo IT (pag. ${trimmed.extract.rangeText}, ${formatFileSize(
          trimmed.extract.originalSize
        )} → ${formatFileSize(trimmed.extract.newSize)})`;
      }
    }

    const combinedNotes = [classification.notes?.trim(), trimNoteSuffix]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 180);

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
      cloudUrl: cloudUrlValue?.trim() || undefined,
      notes: combinedNotes || undefined,
      pinned: autoPinned,
      fileName: fileToStore.name,
      fileMime: fileToStore.type || 'application/octet-stream',
      fileSize: fileToStore.size,
    };

    if (onUploadLinkedDocument) {
      await onUploadLinkedDocument(docPayload, fileToStore);
      return;
    }

    const attachmentKey = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const stored = await saveVaultFile(attachmentKey, fileToStore, fileToStore.name, fileToStore.type);
    if (!stored.cloudSynced) {
      throw new Error(`Il file "${fileToStore.name}" non è stato salvato sul cloud.`);
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
          `Analisi (${idx + 1}/${selectedFiles.length}): ${file.name}`
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
                    detail: `${resBill.detail} · riconoscimento locale`,
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
              destination: `Prodotti → ${matchedProduct.title}`,
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
      let downloadedFile: File | null = null;
      const fetchDocApiUrl = resolveApiUrl('/api/researches/fetch-document');
      try {
        const dlResp = fetchDocApiUrl
          ? await fetch(fetchDocApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: cleanUrl, allowLargePdf: true }),
            })
          : await fetch(cleanUrl, { method: 'GET', mode: 'cors' });
        const dlCt = (dlResp.headers.get('content-type') || '').toLowerCase();
        if (dlResp.ok && !dlCt.includes('application/json') && !dlCt.includes('text/html')) {
          const blob = await dlResp.blob();
          const maxImportBytes = Math.max(
            24_000_000,
            vaultStorageStatus?.configured
              ? vaultStorageStatus.maxFileBytes
              : MAX_CLOUD_FILE_BYTES
          );
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
                if (resBill.saved) {
                  setImportLinkUrl('');
                  setLinkImportOpen(false);
                }
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
            if (resBill.saved) {
              setImportLinkUrl('');
              setLinkImportOpen(false);
            }
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
        setLinkImportOpen(false);
        setSmartImportResults([
          {
            fileName: downloadedFile.name,
            destination: matchedProduct
              ? `Prodotti → ${matchedProduct.title}`
              : `Documenti · ${classification.documentCategory}`,
            detail: matchedProduct
              ? `${classification.title} (${formatAttachmentTypeLabel(attachType) || 'Allegato prodotto'})`
              : `${classification.title} (${classification.provider})`,
            status: 'ok',
          },
        ]);
        return;
      }

      // Link-only HTML / Google Drive / Web page path
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
          // fallback cleanly
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
              classification.documentCategory !== 'Altro' &&
              classification.documentCategory !== 'Assicurazioni'
            ? classification.documentCategory
            : 'Altro'
        : DOCUMENT_CATEGORIES.includes(classification.documentCategory)
          ? classification.documentCategory
          : 'Altro';
      const linkPinHints = [
        finalTitle,
        cleanUrl,
        inspectedDesc,
        classification.notes,
      ]
        .filter(Boolean)
        .join(' ');
      const autoPinnedLink = matchedProduct
        ? isProductUserManualAttachment(attachType, finalTitle, linkPinHints)
        : attachType === 'manuale' &&
          finalCategory === 'Altro' &&
          /(?:manual|istruzion|user\s*guide|libretto|uso\s+e\s+manutenzione|guida\s+(?:rapida|utente|all['’]?uso)|montagg)/i.test(
            linkPinHints
          ) &&
          isProductUserManualAttachment(attachType, finalTitle, linkPinHints);

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
        pinned: autoPinnedLink,
        notes: (
          classification.notes ||
          inspectedDesc ||
          (matchedProduct
            ? `Link associato a ${matchedProduct.title}`
            : `Link importato da ${urlHostProvider}`)
        ).slice(0, 180),
      });

      setImportLinkUrl('');
      setLinkImportOpen(false);
      setSmartImportResults([
        {
          fileName: finalTitle,
          destination: matchedProduct
            ? `Prodotti → ${matchedProduct.title}`
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
      const brandClean = res?.brand?.trim();
      const brandRedundant =
        Boolean(brandClean) &&
        groupTitle.toLowerCase().startsWith(brandClean!.toLowerCase());
      const rawRoomLabel = res?.room ? getResearchRoomLabel(res.room) : '';
      const roomLabel =
        rawRoomLabel && rawRoomLabel !== 'Nessuna stanza' ? rawRoomLabel : undefined;
      const groupSubtitle =
        [brandRedundant ? undefined : brandClean, res?.model, roomLabel]
          .filter(Boolean)
          .join(' · ') || undefined;
      return {
        key: 'ricerche',
        label: 'Prodotti',
        detail: [groupTitle, typeLabel].filter(Boolean).join(' · '),
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
        label: `Auto ${carRef?.plate || carPlate}`,
        detail: typeLabel || 'Documento veicolo',
        groupKey: `car:${carRef?.plate || carPlate}`,
        groupTitle: `Auto ${carRef?.plate || carPlate}`,
        attachmentTypeLabel: typeLabel || 'Documento veicolo',
      };
    }

    return {
      key: 'documenti',
      label: 'Casa',
      detail: '',
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

  const expiryStats = useMemo(() => {
    const now = new Date();
    const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const soonCutoffMs = todayStartMs + EXPIRY_SOON_DAYS * 86_400_000;
    let expiredCount = 0;
    let expiringSoonCount = 0;
    const attentionIds = new Set<string>();
    const expiryMsById = new Map<string, number>();

    for (const row of allUnifiedDocumentRows) {
      const ms = parseDocExpiryMs(row.doc.expiryDate);
      if (ms === null) continue;
      expiryMsById.set(row.doc.id, ms);
      if (ms < todayStartMs) {
        expiredCount += 1;
        attentionIds.add(row.doc.id);
      } else if (ms <= soonCutoffMs) {
        expiringSoonCount += 1;
        attentionIds.add(row.doc.id);
      }
    }

    return {
      todayStartMs,
      expiredCount,
      expiringSoonCount,
      totalAttentionCount: attentionIds.size,
      attentionIds,
      expiryMsById,
    };
  }, [allUnifiedDocumentRows]);

  const filteredDocumentRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...allUnifiedDocumentRows]
      .filter((row) => {
        if (originFilter === 'bollette') return false;
        if (originFilter !== 'all' && originFilter !== 'non_bollette' && row.origin.key !== originFilter) {
          return false;
        }
        if (expiryOnlyFilter && !expiryStats.attentionIds.has(row.doc.id)) return false;
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
        if (expiryOnlyFilter) {
          const ma = expiryStats.expiryMsById.get(a.doc.id) ?? Number.MAX_SAFE_INTEGER;
          const mb = expiryStats.expiryMsById.get(b.doc.id) ?? Number.MAX_SAFE_INTEGER;
          if (ma !== mb) return ma - mb;
        }

        const sizeA = (a.fileKey ? vaultMeta[a.fileKey]?.size : undefined) ?? a.doc.fileSize ?? 0;
        const sizeB = (b.fileKey ? vaultMeta[b.fileKey]?.size : undefined) ?? b.doc.fileSize ?? 0;

        switch (sortBy) {
          case 'name_asc': {
            const cmp = a.doc.title.localeCompare(b.doc.title, 'it');
            if (cmp !== 0) return cmp;
            return a.doc.pinned === b.doc.pinned ? 0 : a.doc.pinned ? -1 : 1;
          }
          case 'product_origin': {
            const origCmp = a.origin.groupTitle.localeCompare(b.origin.groupTitle, 'it');
            if (origCmp !== 0) return origCmp;
            if (a.doc.pinned !== b.doc.pinned) return a.doc.pinned ? -1 : 1;
            return a.doc.title.localeCompare(b.doc.title, 'it');
          }
          case 'size_desc': {
            if (sizeA !== sizeB) return sizeB - sizeA;
            if (a.doc.pinned !== b.doc.pinned) return a.doc.pinned ? -1 : 1;
            return a.doc.title.localeCompare(b.doc.title, 'it');
          }
          case 'date_desc': {
            const da = parseFlexibleDateMs(a.doc.issueDate) ?? 0;
            const db = parseFlexibleDateMs(b.doc.issueDate) ?? 0;
            if (da !== db) return db - da;
            if (a.doc.pinned !== b.doc.pinned) return a.doc.pinned ? -1 : 1;
            return a.doc.title.localeCompare(b.doc.title, 'it');
          }
          case 'pinned_name':
          default: {
            if (a.doc.pinned !== b.doc.pinned) return a.doc.pinned ? -1 : 1;
            return a.doc.title.localeCompare(b.doc.title, 'it');
          }
        }
      });
  }, [
    allUnifiedDocumentRows,
    activeTab,
    originFilter,
    productFilter,
    expiryOnlyFilter,
    expiryStats,
    searchQuery,
    sortBy,
    vaultMeta,
  ]);

  const domainDocumentBuckets = useMemo(() => {
    const houseRows: UnifiedDocumentRow[] = [];
    const productRows: UnifiedDocumentRow[] = [];
    const carRows: UnifiedDocumentRow[] = [];
    const productMap = new Map<
      string,
      {
        groupKey: string;
        title: string;
        subtitle?: string;
        imageUrl?: string;
        rows: UnifiedDocumentRow[];
        totalSize: number;
        latestDateMs: number;
      }
    >();

    for (const row of filteredDocumentRows) {
      if (row.origin.key === 'macchina') {
        carRows.push(row);
      } else if (row.origin.key === 'ricerche') {
        productRows.push(row);
        const size = (row.fileKey ? vaultMeta[row.fileKey]?.size : undefined) ?? row.doc.fileSize ?? 0;
        const dateMs = parseFlexibleDateMs(row.doc.issueDate) ?? 0;
        const existing = productMap.get(row.origin.groupKey);
        if (existing) {
          existing.rows.push(row);
          existing.totalSize += size;
          if (dateMs > existing.latestDateMs) existing.latestDateMs = dateMs;
        } else {
          productMap.set(row.origin.groupKey, {
            groupKey: row.origin.groupKey,
            title: row.origin.groupTitle,
            subtitle: row.origin.groupSubtitle,
            imageUrl: row.origin.imageUrl,
            rows: [row],
            totalSize: size,
            latestDateMs: dateMs,
          });
        }
      } else {
        houseRows.push(row);
      }
    }

    const productGroups = [...productMap.values()].sort((a, b) => {
      if (sortBy === 'size_desc' && a.totalSize !== b.totalSize) {
        return b.totalSize - a.totalSize;
      }
      if (sortBy === 'date_desc' && a.latestDateMs !== b.latestDateMs) {
        return b.latestDateMs - a.latestDateMs;
      }
      return a.title.localeCompare(b.title, 'it');
    });

    return {
      houseRows,
      productRows,
      carRows,
      productGroups,
    };
  }, [filteredDocumentRows, sortBy, vaultMeta]);

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
      .sort((a, b) => {
        const sizeA = (a.fileKey ? vaultMeta[a.fileKey]?.size : undefined) ?? 0;
        const sizeB = (b.fileKey ? vaultMeta[b.fileKey]?.size : undefined) ?? 0;
        const dateA = parseFlexibleDateMs(a.date) ?? 0;
        const dateB = parseFlexibleDateMs(b.date) ?? 0;

        switch (sortBy) {
          case 'size_desc': {
            if (sizeA !== sizeB) return sizeB - sizeA;
            if (dateA !== dateB) return dateB - dateA;
            return a.period.localeCompare(b.period, 'it');
          }
          case 'name_asc': {
            const cmp = `${a.label} ${a.period}`.localeCompare(`${b.label} ${b.period}`, 'it');
            if (cmp !== 0) return cmp;
            return dateB - dateA;
          }
          case 'product_origin': {
            const kindCmp = a.label.localeCompare(b.label, 'it');
            if (kindCmp !== 0) return kindCmp;
            if (dateA !== dateB) return dateB - dateA;
            return a.period.localeCompare(b.period, 'it');
          }
          case 'date_desc':
          case 'pinned_name':
          default: {
            if (dateA !== dateB) return dateB - dateA;
            const labelCmp = a.label.localeCompare(b.label, 'it');
            if (labelCmp !== 0) return labelCmp;
            return b.period.localeCompare(a.period, 'it');
          }
        }
      });
  }, [
    shareableElectricityBills,
    shareableWaterBills,
    shareableTariBills,
    shareableGsePayments,
    searchQuery,
    sortBy,
    vaultMeta,
  ]);

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

  const categoryCounts = useMemo(() => {
    const counts = new Map<HomeDocumentCategory, number>();
    for (const cat of DOCUMENT_CATEGORIES) {
      counts.set(cat, 0);
    }
    for (const row of allUnifiedDocumentRows) {
      counts.set(row.doc.category, (counts.get(row.doc.category) || 0) + 1);
    }
    return counts;
  }, [allUnifiedDocumentRows]);

  const visibleCategoryOptions = useMemo(
    () =>
      DOCUMENT_CATEGORIES.filter(
        (cat) => (categoryCounts.get(cat) || 0) > 0 || activeTab === cat
      ),
    [categoryCounts, activeTab]
  );

  const showProductGroupingControls =
    linkedProductFilterOptions.items.length > 0 &&
    (originFilter === 'all' || originFilter === 'ricerche') &&
    activeTab !== 'bollette';

  const hasAnyActiveFilter =
    activeTab !== 'all' ||
    originFilter !== 'all' ||
    productFilter !== 'all' ||
    expiryOnlyFilter ||
    searchQuery.trim() !== '';

  function resetAllFilters() {
    setActiveTab('all');
    setOriginFilter('all');
    setProductFilter('all');
    setExpiryOnlyFilter(false);
    setSearchQuery('');
  }

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
    (activeTab !== 'all' && activeTab !== originFilter ? 1 : 0) +
    (productFilter !== 'all' ? 1 : 0) +
    (expiryOnlyFilter ? 1 : 0);

  function formatStorageStatusLabel(localFile?: VaultFileMeta): string {
    if (!localFile) return '';
    const sizeText = formatFileSize(localFile.size);
    if (localFile.storageBackend === 's3') return sizeText ? `Backblaze B2 · ${sizeText}` : 'Backblaze B2';
    if (localFile.origin === 'firestore') return sizeText ? `Cloud · ${sizeText}` : 'Cloud';
    if (localFile.origin === 'bundled') return sizeText ? `PDF · ${sizeText}` : 'PDF';
    return sizeText ? `Locale · ${sizeText}` : 'Locale';
  }

  function formatExpiryNotice(doc: HomeDocumentRecord): { text: string; tone: 'expired' | 'soon' | 'ok' } | null {
    if (!doc.expiryDate) return null;
    const ms = parseDocExpiryMs(doc.expiryDate);
    if (ms === null) return { text: `Scad. ${doc.expiryDate}`, tone: 'ok' };
    if (ms < expiryStats.todayStartMs) {
      return { text: `Scaduto (${doc.expiryDate})`, tone: 'expired' };
    }
    const diffDays = Math.ceil((ms - expiryStats.todayStartMs) / 86_400_000);
    if (diffDays <= EXPIRY_SOON_DAYS) {
      return {
        text: diffDays === 0 ? 'Scade oggi' : `Scade tra ${diffDays} gg (${doc.expiryDate})`,
        tone: 'soon',
      };
    }
    return { text: `Scad. ${doc.expiryDate}`, tone: 'ok' };
  }

  function renderBillIcon(kind: UnifiedBillShareItem['kind'], sizeClass = 'w-4 h-4') {
    if (kind === 'luce') return <Zap className={`${sizeClass} text-sky-600 dark:text-sky-400`} />;
    if (kind === 'acqua') return <Droplets className={`${sizeClass} text-cyan-600 dark:text-cyan-400`} />;
    if (kind === 'gse') return <Sun className={`${sizeClass} text-emerald-600 dark:text-emerald-400`} />;
    return <Receipt className={`${sizeClass} text-amber-600 dark:text-amber-400`} />;
  }

  function getBillIconBg(kind: UnifiedBillShareItem['kind']): string {
    if (kind === 'luce') return 'bg-sky-500/10 dark:bg-sky-400/10';
    if (kind === 'acqua') return 'bg-cyan-500/10 dark:bg-cyan-400/10';
    if (kind === 'gse') return 'bg-emerald-500/10 dark:bg-emerald-400/10';
    return 'bg-amber-500/10 dark:bg-amber-400/10';
  }

  const totalItemsCount = allUnifiedDocumentRows.length + totalShareableBillsCount;

  return (
    <div className="space-y-5 pb-10 md:pb-4">
      {/* Single shared hidden file input for Auto-Import (desktop + mobile) */}
      {!readOnly && (
        <input
          ref={smartImportInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.csv,.json"
          onChange={(e) => void handleSmartImportFiles(e.target.files)}
          className="hidden"
        />
      )}

      {/* Hidden input for attaching PDF directly to any bill */}
      <input
        ref={billAttachInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.txt"
        onChange={(e) => void handleAttachFileToBill(e.target.files)}
        className="hidden"
      />

      {/* ==================== MOBILE HEADER (<768px) ==================== */}
      <header className="md:hidden space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Documenti
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums truncate">
              {totalItemsCount} {totalItemsCount === 1 ? 'elemento' : 'elementi'} ·{' '}
              {vaultStats.cachedCount}/{vaultStats.totalFiles} offline
              {vaultStorageStatus?.configured
                ? ` · ${vaultStorageStatus.providerLabel}`
                : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMobileStorageSheetOpen(true)}
            aria-label="Stato storage e cache offline"
            className="relative min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 active:scale-[0.97] transition-transform shrink-0"
          >
            <Cloud className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            {(vaultStats.missingOffline > 0 || (vaultStorageStatus?.configured && vaultStats.legacyFirestoreCount > 0)) && (
              <span
                className={`absolute top-2.5 right-2.5 w-2 h-2 rounded-full ${
                  vaultStorageStatus?.configured && vaultStats.legacyFirestoreCount > 0
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                }`}
              />
            )}
          </button>
        </div>

        {!readOnly && (
          <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-2">
            <button
              type="button"
              disabled={autoImporting}
              onClick={() => smartImportInputRef.current?.click()}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:text-slate-950 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-2xl shadow-xs active:scale-[0.98] transition-all disabled:opacity-60 whitespace-nowrap"
            >
              {autoImporting ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Sparkles className="w-4 h-4 shrink-0" />
              )}
              <span>{autoImporting ? 'Analisi...' : 'Importa Auto'}</span>
            </button>
            <button
              type="button"
              disabled={autoImporting}
              onClick={() => setLinkImportOpen((prev) => !prev)}
              className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-2xl border active:scale-[0.98] transition-all disabled:opacity-60 whitespace-nowrap ${
                linkImportOpen
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-950 dark:border-white'
                  : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-800'
              }`}
            >
              <Link2 className="w-4 h-4 shrink-0 text-brand-600 dark:text-brand-400" />
              <span>Da Link</span>
            </button>
            <button
              type="button"
              onClick={openNewForm}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl active:scale-[0.98] transition-all whitespace-nowrap"
            >
              <Plus className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <span>Nuovo</span>
            </button>
          </div>
        )}
      </header>

      {/* ==================== DESKTOP HEADER (>=768px) ==================== */}
      <header className="hidden md:block space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Archivio Documenti
              </h1>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {allUnifiedDocumentRows.length} documenti · {totalShareableBillsCount} bollette/GSE
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Casa, contratti, utenze, auto e allegati prodotto in un archivio unico sincronizzato.
            </p>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={autoImporting}
                onClick={() => smartImportInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 text-white bg-brand-600 hover:bg-brand-700 dark:text-slate-950 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-xl shadow-xs transition-colors disabled:opacity-60"
              >
                {autoImporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>{autoImporting ? 'Classificazione...' : 'Importa Documenti (Auto)'}</span>
              </button>
              <button
                type="button"
                disabled={autoImporting}
                onClick={() => setLinkImportOpen((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl border transition-colors disabled:opacity-60 ${
                  linkImportOpen
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-950 dark:border-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800'
                }`}
              >
                <Link2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                <span>Da Link</span>
              </button>
              <button
                type="button"
                onClick={openNewForm}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nuovo</span>
              </button>
            </div>
          )}
        </div>

        {/* Quiet Single-Line Storage & Offline Strip (no stacked cards) */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 min-w-0">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 tabular-nums">
              <Database className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 shrink-0" />
              <span>
                Offline su questo dispositivo:{' '}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">
                  {vaultStats.cachedCount}/{vaultStats.totalFiles}
                </strong>
              </span>
              {precacheProgress && precacheProgress.total > 0 && (
                <span className="text-brand-600 dark:text-brand-400 font-medium">
                  · Scarico {precacheProgress.completed}/{precacheProgress.total} ({precacheProgress.currentFileName})
                </span>
              )}
            </div>

            {!readOnly && vaultStorageStatus && (
              <>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                  |
                </span>
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 tabular-nums">
                  <Cloud
                    className={`w-3.5 h-3.5 shrink-0 ${
                      vaultStorageStatus.configured
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-400'
                    }`}
                  />
                  {vaultStorageStatus.configured ? (
                    <span>
                      Storage:{' '}
                      <strong className="font-semibold text-emerald-700 dark:text-emerald-300">
                        {vaultStorageStatus.providerLabel}
                      </strong>{' '}
                      · {vaultStats.externalCount} su B2
                      {vaultStats.legacyFirestoreCount > 0
                        ? ` · ${vaultStats.legacyFirestoreCount} ancora su Firestore`
                        : ''}
                    </span>
                  ) : (
                    <span>
                      Storage: <strong className="font-semibold text-slate-800 dark:text-slate-200">Firestore compresso</strong>
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {!readOnly && (
            <div className="flex items-center gap-3 shrink-0">
              {vaultStats.totalFiles > 0 && vaultStats.missingOffline > 0 && (
                <button
                  type="button"
                  disabled={precachingAll || quotaExceeded}
                  onClick={() => void handlePrecacheAllOffline()}
                  className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {precachingAll ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {precachingAll
                      ? 'Scaricamento...'
                      : `Scarica ${vaultStats.missingOffline} offline`}
                  </span>
                </button>
              )}

              {vaultStorageStatus?.configured && vaultStats.legacyFirestoreCount > 0 && (
                <button
                  type="button"
                  disabled={migratingStorage}
                  onClick={() => void handleMigrateLegacyStorage()}
                  className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {migratingStorage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <HardDrive className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {migratingStorage && migrationProgress
                      ? `Migrazione ${migrationProgress.done}/${migrationProgress.total}...`
                      : `Sposta ${vaultStats.legacyFirestoreCount} su ${vaultStorageStatus.providerLabel}`}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ==================== INLINE LINK IMPORT PANEL ==================== */}
      {linkImportOpen && !readOnly && (
        <form
          onSubmit={(e) => void handleSmartImportUrl(e)}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-xs dark:shadow-none"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                Importa Documento da Link Online
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Incolla il link diretto a un PDF, manuale o pagina: scarica o collega il documento al prodotto giusto.
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
              className="flex-1 min-w-0 min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-brand-500"
            />
            {researches.length > 0 && (
              <select
                aria-label="Associazione prodotto"
                disabled={autoImporting}
                value={importLinkProductChoice}
                onChange={(e) => setImportLinkProductChoice(e.target.value)}
                className="sm:w-60 min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-brand-500"
              >
                <option value="auto">Riconoscimento automatico prodotto</option>
                <option value="none">Nessun collegamento prodotto</option>
                {researches.map((res) => (
                  <option key={res.id} value={res.id}>
                    {res.title.slice(0, 42)}
                    {res.brand ? ` (${res.brand})` : ''}
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              disabled={autoImporting || !importLinkUrl.trim()}
              className="min-h-[44px] md:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm md:text-xs font-semibold whitespace-nowrap shrink-0 text-white bg-brand-600 hover:bg-brand-700 dark:text-slate-950 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-xl transition-colors disabled:opacity-60"
            >
              {autoImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>{autoImporting ? 'Analisi...' : 'Importa'}</span>
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
          'Importazione automatica da file o da link: riconosce bollette, documenti casa e abbina i prodotti esistenti',
          'Vista unica di tutti gli allegati (Casa, Bollette & GSE, Prodotti, Auto)',
          'Apri, Scarica, Condividi o Elimina ogni file da qualsiasi dispositivo',
        ]}
        gmailFeatures={[
          'Archiviazione automatica dei PDF bollette ricevuti in Gmail',
        ]}
      />

      {/* ==================== STATUS & IMPORT PROGRESS NOTICES ==================== */}
      {importProgressLabel && (
        <div className="bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-500/30 rounded-xl px-4 py-2.5 text-xs text-brand-800 dark:text-brand-200 flex items-center gap-2.5">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span className="truncate">{importProgressLabel}</span>
        </div>
      )}

      {smartImportResults.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/35 rounded-2xl p-4 space-y-2.5 shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                Esito importazione ({smartImportResults.length}{' '}
                {smartImportResults.length === 1 ? 'file' : 'file'})
              </span>
            </div>
            <button
              type="button"
              aria-label="Chiudi riepilogo importazione"
              onClick={() => setSmartImportResults([])}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {smartImportResults.map((item, idx) => (
              <div
                key={`${item.fileName}_${idx}`}
                className="py-2 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
              >
                <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {item.fileName}
                </span>
                <span
                  className={`truncate ${
                    item.status === 'ok'
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : item.status === 'duplicate'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {item.destination} · {item.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {statusNotice && (() => {
        const isErrorNotice =
          /non riuscit|errore|esaurit|mancant|insufficient|disattiva|configura prima/i.test(
            statusNotice
          );
        const isWarningNotice = !isErrorNotice && /parzial|interrott/i.test(statusNotice);
        const noticeToneClass = isErrorNotice
          ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200'
          : isWarningNotice
            ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200'
            : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200';
        return (
          <div className={`border rounded-xl px-4 py-2.5 text-xs flex items-center justify-between gap-2 ${noticeToneClass}`}>
            <span>{statusNotice}</span>
            <button
              type="button"
              aria-label="Chiudi avviso"
              onClick={() => setStatusNotice(null)}
              className="min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center opacity-70 hover:opacity-100 shrink-0"
            >
              <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
            </button>
          </div>
        );
      })()}

      {/* ==================== MOBILE SEARCH + HORIZONTAL TABS (<768px) ==================== */}
      <div className="md:hidden space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca documento, prodotto o bolletta..."
              className="w-full h-11 pl-10 pr-10 text-base bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Svuota ricerca"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileFilterSheetOpen(true)}
            aria-label="Filtri avanzati"
            className={`relative min-h-[44px] min-w-[44px] px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-2xl border shrink-0 transition-colors ${
              activeMobileFilterCount > 0
                ? 'bg-brand-600 text-white border-brand-600 dark:bg-brand-400 dark:text-slate-950 dark:border-brand-400'
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

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('all');
              setOriginFilter('all');
              setProductFilter('all');
              setExpiryOnlyFilter(false);
            }}
            className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl transition-colors tabular-nums ${
              activeTab === 'all' && originFilter === 'all' && productFilter === 'all' && !expiryOnlyFilter
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            Tutti · {totalItemsCount}
          </button>

          <button
            type="button"
            onClick={() => {
              setDomainSectionCollapsed('casa', false);
              setOriginFilter('documenti');
              setProductFilter('all');
              setExpiryOnlyFilter(false);
              if (activeTab === 'bollette' || activeTab === 'ricerche') setActiveTab('all');
            }}
            className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl transition-colors tabular-nums ${
              originFilter === 'documenti'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            Casa · {originCounts.documenti}
          </button>

          <button
            type="button"
            onClick={() => {
              setDomainSectionCollapsed('auto', false);
              setOriginFilter('macchina');
              setProductFilter('all');
              setExpiryOnlyFilter(false);
              if (activeTab === 'bollette' || activeTab === 'ricerche') setActiveTab('all');
            }}
            className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl transition-colors tabular-nums ${
              originFilter === 'macchina'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Car className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Auto · {originCounts.macchina}
          </button>

          <button
            type="button"
            onClick={() => {
              setDomainSectionCollapsed('prodotti', false);
              setActiveTab('ricerche');
              setOriginFilter('ricerche');
              setExpiryOnlyFilter(false);
            }}
            className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl transition-colors tabular-nums ${
              activeTab === 'ricerche' || originFilter === 'ricerche'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            Prodotti · {originCounts.ricerche}
          </button>

          <button
            type="button"
            onClick={() => {
              setDomainSectionCollapsed('bollette', false);
              setActiveTab('bollette');
              setOriginFilter('bollette');
              setProductFilter('all');
              setExpiryOnlyFilter(false);
            }}
            className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl transition-colors tabular-nums ${
              activeTab === 'bollette' || originFilter === 'bollette'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Receipt className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            Bollette · {totalShareableBillsCount}
          </button>

          {(expiryStats.totalAttentionCount > 0 || expiryOnlyFilter) && (
            <button
              type="button"
              onClick={() => {
                const next = !expiryOnlyFilter;
                setExpiryOnlyFilter(next);
                if (next && (activeTab === 'bollette' || originFilter === 'bollette')) {
                  setActiveTab('all');
                  setOriginFilter('all');
                }
              }}
              className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl transition-colors tabular-nums ${
                expiryOnlyFilter
                  ? 'bg-rose-600 text-white dark:bg-rose-500 dark:text-white'
                  : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 border border-slate-200 dark:border-slate-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              Scadenze · {expiryStats.totalAttentionCount}
            </button>
          )}
        </div>

        {/* Mobile quick sort & visible count bar */}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {(() => {
              const showB =
                !expiryOnlyFilter &&
                (activeTab === 'bollette' ||
                  originFilter === 'bollette' ||
                  (activeTab === 'all' && originFilter === 'all'));
              const showD = activeTab !== 'bollette' && originFilter !== 'bollette';
              const count =
                (showD ? filteredDocumentRows.length : 0) +
                (showB ? allBillsForSharing.length : 0);
              return `${count} ${count === 1 ? 'risultato' : 'risultati'}`;
            })()}
          </span>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              aria-label="Ordina documenti"
              value={sortBy}
              onChange={(e) => handleChangeSortBy(e.target.value as DocumentSortBy)}
              className="bg-transparent text-xs font-semibold text-slate-700 dark:text-slate-200 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none py-1 pr-1"
            >
              <option value="pinned_name">Preferiti e Nome</option>
              <option value="name_asc">Nome (A → Z)</option>
              <option value="product_origin">Prodotto / Origine</option>
              <option value="size_desc">Dimensione file</option>
              <option value="date_desc">Più recenti</option>
            </select>
          </label>
        </div>
      </div>

      {/* ==================== DESKTOP UNIFIED COMMAND BAR (>=768px) ==================== */}
      <div className="hidden md:flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          {/* Segmented Origin Control */}
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100/90 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setActiveTab('all');
                setOriginFilter('all');
                setProductFilter('all');
                setExpiryOnlyFilter(false);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap tabular-nums ${
                activeTab === 'all' && originFilter === 'all' && productFilter === 'all' && !expiryOnlyFilter
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Tutti ({totalItemsCount})
            </button>

            <button
              type="button"
              onClick={() => {
                setDomainSectionCollapsed('casa', false);
                setOriginFilter('documenti');
                setProductFilter('all');
                setExpiryOnlyFilter(false);
                if (activeTab === 'bollette' || activeTab === 'ricerche') setActiveTab('all');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap tabular-nums ${
                originFilter === 'documenti'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              Casa ({originCounts.documenti})
            </button>

            <button
              type="button"
              onClick={() => {
                setDomainSectionCollapsed('auto', false);
                setOriginFilter('macchina');
                setProductFilter('all');
                setExpiryOnlyFilter(false);
                if (activeTab === 'bollette' || activeTab === 'ricerche') setActiveTab('all');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap tabular-nums ${
                originFilter === 'macchina'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Car className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Auto ({originCounts.macchina})
            </button>

            <button
              type="button"
              onClick={() => {
                setDomainSectionCollapsed('prodotti', false);
                setActiveTab('ricerche');
                setOriginFilter('ricerche');
                setExpiryOnlyFilter(false);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap tabular-nums ${
                activeTab === 'ricerche' || originFilter === 'ricerche'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              Prodotti ({originCounts.ricerche})
            </button>

            <button
              type="button"
              onClick={() => {
                setDomainSectionCollapsed('bollette', false);
                setActiveTab('bollette');
                setOriginFilter('bollette');
                setProductFilter('all');
                setExpiryOnlyFilter(false);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap tabular-nums ${
                activeTab === 'bollette' || originFilter === 'bollette'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Receipt className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Bollette ({totalShareableBillsCount})
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca documento, prodotto, bolletta..."
              className="w-full h-9 pl-8 pr-7 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Svuota ricerca"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {activeTab !== 'bollette' && originFilter !== 'bollette' && visibleCategoryOptions.length > 0 && (
            <select
              aria-label="Filtra per categoria documento"
              value={activeTab !== 'all' && activeTab !== 'ricerche' ? activeTab : 'all'}
              onChange={(e) => {
                const next = e.target.value;
                if (next === 'all') {
                  setActiveTab(originFilter === 'ricerche' ? 'ricerche' : 'all');
                } else {
                  setActiveTab(next as HomeDocumentCategory);
                }
              }}
              className="h-9 px-3 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-200 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-brand-500"
            >
              <option value="all">Tutte le categorie</option>
              {visibleCategoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat} ({categoryCounts.get(cat) || 0})
                </option>
              ))}
            </select>
          )}

          {(expiryStats.totalAttentionCount > 0 || expiryOnlyFilter) && (
            <button
              type="button"
              onClick={() => {
                const next = !expiryOnlyFilter;
                setExpiryOnlyFilter(next);
                if (next && (activeTab === 'bollette' || originFilter === 'bollette')) {
                  setActiveTab('all');
                  setOriginFilter('all');
                }
              }}
              className={`h-9 inline-flex items-center gap-1.5 px-3 text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap tabular-nums ${
                expiryOnlyFilter
                  ? 'bg-rose-600 text-white border-rose-600 dark:bg-rose-500 dark:border-rose-500'
                  : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Scadenze ({expiryStats.totalAttentionCount})</span>
            </button>
          )}

          {hasAnyActiveFilter && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="h-9 inline-flex items-center gap-1 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white rounded-xl transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Azzera
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-1.5 h-9 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              aria-label="Ordina documenti"
              value={sortBy}
              onChange={(e) => handleChangeSortBy(e.target.value as DocumentSortBy)}
              className="text-xs font-medium bg-transparent text-slate-700 dark:text-slate-200 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none pr-1"
            >
              <option value="pinned_name">Ordine: Preferiti e Nome</option>
              <option value="name_asc">Ordine: Nome (A → Z)</option>
              <option value="product_origin">Ordine: Prodotto / Origine</option>
              <option value="size_desc">Ordine: Dimensione file</option>
              <option value="date_desc">Ordine: Più recenti</option>
            </select>
          </div>

          {showProductGroupingControls && (
            <button
              type="button"
              onClick={handleToggleGroupByProduct}
              aria-pressed={groupByProduct}
              title="Raggruppa i documenti per prodotto / elettrodomestico"
              className={`h-9 inline-flex items-center gap-1.5 px-3 text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                groupByProduct
                  ? 'bg-brand-600 text-white border-brand-600 dark:bg-brand-400 dark:text-slate-950 dark:border-brand-400'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Per prodotto</span>
            </button>
          )}

          <div className="inline-flex items-center p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => handleChangeViewMode('list')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Elenco
            </button>
            <button
              type="button"
              onClick={() => handleChangeViewMode('grid')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Griglia
            </button>
          </div>
        </div>
      </div>

      {/* ==================== MAIN CONTENT AREA ==================== */}
      {(() => {
        const showBillsSection =
          !expiryOnlyFilter &&
          (activeTab === 'bollette' ||
            originFilter === 'bollette' ||
            (activeTab === 'all' && originFilter === 'all' && allBillsForSharing.length > 0));
        const showDocsSection = activeTab !== 'bollette' && originFilter !== 'bollette';
        const hasAnyContent =
          (showDocsSection && filteredDocumentRows.length > 0) ||
          (showBillsSection && allBillsForSharing.length > 0);

        const renderMobileDocsList = (
          rows: UnifiedDocumentRow[],
          hideLinkedProduct = false,
          insideGroupContainer = false
        ) => (
          <div
            className={
              insideGroupContainer
                ? 'md:hidden divide-y divide-slate-100 dark:divide-slate-800/80'
                : 'md:hidden bg-white dark:bg-slate-900/85 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden'
            }
          >
            {rows.map((row) => {
              const { doc, origin, fileKey, sharePayload } = row;
              const catStyle = CATEGORY_ICON_STYLE[doc.category] || CATEGORY_ICON_STYLE.Altro;
              const CatIcon = catStyle.icon;
              const localFile = fileKey ? vaultMeta[fileKey] : undefined;
              const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
              const openBusyKey = fileKey || doc.cloudUrl || doc.id;
              const expiryNotice = formatExpiryNotice(doc);
              const cleanRef =
                doc.referenceCode &&
                !doc.referenceCode.startsWith('ART:') &&
                !doc.referenceCode.startsWith('RES:') &&
                !doc.referenceCode.startsWith('AUTO:')
                  ? doc.referenceCode
                  : '';
              const scopedTitle =
                hideLinkedProduct && origin.isApplianceOrArticle
                  ? formatScopedDocumentTitle(doc.title, origin.groupTitle)
                  : doc.title;
              const displayNotes = formatDisplayDocumentNotes(doc.notes);
              const providerRedundantInGroup =
                hideLinkedProduct &&
                origin.isApplianceOrArticle &&
                Boolean(doc.provider?.trim()) &&
                origin.groupTitle
                  .toLowerCase()
                  .startsWith(doc.provider.trim().toLowerCase());
              const showCategoryInMeta =
                !(hideLinkedProduct && origin.isApplianceOrArticle) ||
                (doc.category !== 'Altro' && doc.category !== origin.attachmentTypeLabel);
              const metaItems: string[] = [];
              if (!providerRedundantInGroup && doc.provider) metaItems.push(doc.provider);
              if (origin.isApplianceOrArticle && !hideLinkedProduct) {
                metaItems.push(origin.groupTitle);
              } else if (showCategoryInMeta) {
                metaItems.push(doc.category);
              }
              if (origin.attachmentTypeLabel) metaItems.push(origin.attachmentTypeLabel);
              if (cleanRef) metaItems.push(`#${cleanRef}`);
              if (doc.issueDate) metaItems.push(doc.issueDate);

              return (
                <article key={row.rowKey} className="p-4 space-y-3">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (canOpen) {
                        void handleOpenAttachment(
                          readOnly ? undefined : fileKey,
                          doc.cloudUrl,
                          doc.fileName || doc.title
                        );
                      } else {
                        setMobileActionTarget({ kind: 'doc', row });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (canOpen) {
                          void handleOpenAttachment(
                            readOnly ? undefined : fileKey,
                            doc.cloudUrl,
                            doc.fileName || doc.title
                          );
                        } else {
                          setMobileActionTarget({ kind: 'doc', row });
                        }
                      }
                    }}
                    className="flex items-start gap-3 text-left cursor-pointer active:opacity-80 transition-opacity"
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${catStyle.surfaceBg}`}
                    >
                      {origin.isApplianceOrArticle && !hideLinkedProduct && origin.imageUrl ? (
                        <img
                          src={origin.imageUrl}
                          alt=""
                          className="w-9 h-9 rounded-lg object-cover bg-white"
                        />
                      ) : (
                        <CatIcon className={`w-4 h-4 ${catStyle.iconColor}`} />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          {scopedTitle}
                        </h3>
                        {doc.pinned && (
                          <Star
                            aria-label="In evidenza"
                            className="w-4 h-4 fill-amber-500 text-amber-500 shrink-0 mt-0.5"
                          />
                        )}
                      </div>

                      {metaItems.length > 0 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed tabular-nums">
                          {metaItems.map((item, idx) => (
                            <React.Fragment key={`${row.rowKey}-mm-${idx}`}>
                              {idx > 0 && <span aria-hidden="true"> · </span>}
                              <span
                                className={
                                  idx === 0 && !providerRedundantInGroup
                                    ? 'font-medium text-brand-700 dark:text-brand-300'
                                    : undefined
                                }
                              >
                                {item}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                      )}

                      {(localFile || doc.cloudUrl || expiryNotice) && (
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] tabular-nums">
                          {localFile ? (
                            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              <FileCheck2 className="w-3.5 h-3.5 text-emerald-600/85 dark:text-emerald-400/85 shrink-0" />
                              {formatStorageStatusLabel(localFile)}
                            </span>
                          ) : doc.cloudUrl ? (
                            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              <Link2 className="w-3.5 h-3.5 text-sky-600/85 dark:text-sky-400/85 shrink-0" />
                              Link esterno
                            </span>
                          ) : null}

                          {expiryNotice && (
                            <span
                              className={
                                expiryNotice.tone === 'expired'
                                  ? 'font-semibold text-rose-600 dark:text-rose-400'
                                  : expiryNotice.tone === 'soon'
                                    ? 'font-semibold text-amber-600 dark:text-amber-400'
                                    : 'text-slate-500 dark:text-slate-400'
                              }
                            >
                              {expiryNotice.text}
                            </span>
                          )}
                        </div>
                      )}

                      {displayNotes && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 pt-0.5">
                          {displayNotes}
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    className={`grid gap-2 ${
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
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/15 hover:bg-brand-100 dark:hover:bg-brand-500/25 rounded-xl transition-colors disabled:opacity-50"
                      >
                        {openingAttachmentKey === openBusyKey ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ExternalLink className="w-4 h-4" />
                        )}
                        <span>Apri</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        void downloadShareableItem(
                          readOnly ? { ...sharePayload, attachmentKey: undefined } : sharePayload
                        )
                      }
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100/90 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      <Download className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      <span>Scarica</span>
                    </button>

                    <button
                      type="button"
                      aria-label="Altre azioni documento"
                      onClick={() => setMobileActionTarget({ kind: 'doc', row })}
                      className="min-h-[44px] w-[44px] inline-flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-100/90 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        );

        const renderDesktopDocsList = (rows: UnifiedDocumentRow[], hideLinkedOriginColumn = false) => (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {rows.map((row) => {
              const { doc, origin, fileKey, sharePayload, editable, deletable } = row;
              const catStyle = CATEGORY_ICON_STYLE[doc.category] || CATEGORY_ICON_STYLE.Altro;
              const CatIcon = catStyle.icon;
              const localFile = fileKey ? vaultMeta[fileKey] : undefined;
              const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
              const openBusyKey = fileKey || doc.cloudUrl || doc.id;
              const expiryNotice = formatExpiryNotice(doc);
              const cleanRef =
                doc.referenceCode &&
                !doc.referenceCode.startsWith('ART:') &&
                !doc.referenceCode.startsWith('RES:') &&
                !doc.referenceCode.startsWith('AUTO:')
                  ? doc.referenceCode
                  : '';

              const scopedTitle =
                hideLinkedOriginColumn && origin.isApplianceOrArticle
                  ? formatScopedDocumentTitle(doc.title, origin.groupTitle)
                  : doc.title;
              const displayNotes = formatDisplayDocumentNotes(doc.notes);
              const providerRedundantInGroup =
                hideLinkedOriginColumn &&
                origin.isApplianceOrArticle &&
                Boolean(doc.provider?.trim()) &&
                origin.groupTitle
                  .toLowerCase()
                  .startsWith(doc.provider.trim().toLowerCase());
              const showCategoryInMeta =
                !(hideLinkedOriginColumn && origin.isApplianceOrArticle) ||
                (doc.category !== 'Altro' && doc.category !== origin.attachmentTypeLabel);
              const compactProductListRow =
                hideLinkedOriginColumn && origin.isApplianceOrArticle;

              return (
                <div
                  key={row.rowKey}
                  className={`group px-4 ${
                    compactProductListRow ? 'py-2.5' : 'py-3.5'
                  } flex items-center justify-between gap-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`${
                        compactProductListRow ? 'w-9 h-9 rounded-lg' : 'w-10 h-10 rounded-xl'
                      } flex items-center justify-center shrink-0 ${catStyle.surfaceBg}`}
                    >
                      {origin.isApplianceOrArticle && !hideLinkedOriginColumn && origin.imageUrl ? (
                        <img
                          src={origin.imageUrl}
                          alt=""
                          className="w-10 h-10 rounded-xl object-cover bg-white"
                        />
                      ) : (
                        <CatIcon className={`w-4 h-4 ${catStyle.iconColor}`} />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {doc.pinned && (
                          <Star
                            aria-label="In evidenza"
                            className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0"
                          />
                        )}
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {scopedTitle}
                        </h3>
                        {expiryNotice && (
                          <span
                            className={`text-[11px] font-medium whitespace-nowrap shrink-0 tabular-nums ${
                              expiryNotice.tone === 'expired'
                                ? 'text-rose-600 dark:text-rose-400'
                                : expiryNotice.tone === 'soon'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            · {expiryNotice.text}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {!providerRedundantInGroup && doc.provider && (
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {doc.provider}
                          </span>
                        )}
                        {showCategoryInMeta && (
                          <>
                            {!providerRedundantInGroup && doc.provider && (
                              <span aria-hidden="true">·</span>
                            )}
                            <span>{doc.category}</span>
                          </>
                        )}
                        {!hideLinkedOriginColumn && origin.isApplianceOrArticle && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {origin.groupTitle}
                            </span>
                          </>
                        )}
                        {origin.attachmentTypeLabel && (
                          <>
                            {(showCategoryInMeta || (!providerRedundantInGroup && doc.provider)) && (
                              <span aria-hidden="true">·</span>
                            )}
                            <span>{origin.attachmentTypeLabel}</span>
                          </>
                        )}
                        {!origin.isApplianceOrArticle && origin.key === 'macchina' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{origin.label}</span>
                          </>
                        )}
                        {cleanRef && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">#{cleanRef}</span>
                          </>
                        )}
                        {doc.issueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{doc.issueDate}</span>
                          </>
                        )}
                        {localFile ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              <FileCheck2 className="w-3 h-3 text-emerald-600/85 dark:text-emerald-400/85" />
                              {formatStorageStatusLabel(localFile)}
                            </span>
                          </>
                        ) : doc.cloudUrl ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              <Link2 className="w-3 h-3 text-sky-600/85 dark:text-sky-400/85" />
                              Link Cloud
                            </span>
                          </>
                        ) : null}
                      </div>

                      {displayNotes && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-2xl">
                          {displayNotes}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
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
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/15 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {openingAttachmentKey === openBusyKey ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        <span>Apri</span>
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
                      className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShareItem(sharePayload)}
                      title="Condividi"
                      aria-label="Condividi"
                      className="p-2 text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>

                    {!readOnly && editable && isPdfDocumentCandidate(doc, localFile) && (
                      <button
                        type="button"
                        onClick={() => openPdfTrimForDocument(doc, fileKey)}
                        title="Estrai solo pagine in italiano + copertina (riduci dimensione PDF)"
                        aria-label="Estrai solo italiano da PDF"
                        className="p-2 text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <Scissors className="w-4 h-4" />
                      </button>
                    )}

                    {!readOnly && editable && (
                      <button
                        type="button"
                        onClick={() => void handleTogglePinned(doc)}
                        title={doc.pinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                        aria-label={doc.pinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                        className={`p-2 rounded-lg transition-colors ${
                          doc.pinned
                            ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                            : 'text-slate-400 hover:text-amber-500 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Star className={`w-4 h-4 ${doc.pinned ? 'fill-amber-500' : ''}`} />
                      </button>
                    )}

                    {!readOnly && editable && (
                      <button
                        type="button"
                        onClick={() => openEditForm(doc)}
                        title="Modifica documento"
                        aria-label="Modifica documento"
                        className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}

                    {!readOnly && deletable && (
                      <button
                        type="button"
                        onClick={() => setPendingDelete({ type: 'document', doc })}
                        title="Elimina documento"
                        aria-label="Elimina documento"
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );

        const renderDocsGrid = (rows: UnifiedDocumentRow[], hideLinkedOriginBanner = false) => (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((row) => {
              const { doc, origin, fileKey, sharePayload, editable, deletable } = row;
              const catStyle = CATEGORY_ICON_STYLE[doc.category] || CATEGORY_ICON_STYLE.Altro;
              const Icon = catStyle.icon;
              const localFile = fileKey ? vaultMeta[fileKey] : undefined;
              const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
              const openBusyKey = fileKey || doc.cloudUrl || doc.id;
              const expiryNotice = formatExpiryNotice(doc);
              const cleanRef =
                doc.referenceCode &&
                !doc.referenceCode.startsWith('ART:') &&
                !doc.referenceCode.startsWith('RES:') &&
                !doc.referenceCode.startsWith('AUTO:')
                  ? doc.referenceCode
                  : '';

              const scopedTitle =
                hideLinkedOriginBanner && origin.isApplianceOrArticle
                  ? formatScopedDocumentTitle(doc.title, origin.groupTitle)
                  : doc.title;
              const displayNotes = formatDisplayDocumentNotes(doc.notes);
              const showCategoryInGrid =
                !(hideLinkedOriginBanner && origin.isApplianceOrArticle) ||
                (doc.category !== 'Altro' && doc.category !== origin.attachmentTypeLabel);
              const providerRedundantInGrid =
                hideLinkedOriginBanner &&
                origin.isApplianceOrArticle &&
                Boolean(doc.provider?.trim()) &&
                origin.groupTitle
                  .toLowerCase()
                  .startsWith(doc.provider.trim().toLowerCase());

              return (
                <article
                  key={row.rowKey}
                  className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-4 flex flex-col justify-between gap-3.5 transition-colors shadow-xs dark:shadow-none"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${catStyle.surfaceBg}`}>
                          <Icon className={`w-4 h-4 ${catStyle.iconColor}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                            {showCategoryInGrid ? doc.category : origin.attachmentTypeLabel || doc.category}
                            {showCategoryInGrid && origin.attachmentTypeLabel
                              ? ` · ${origin.attachmentTypeLabel}`
                              : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {doc.pinned && (
                          <Star
                            aria-label="In evidenza"
                            className="w-3.5 h-3.5 fill-amber-500 text-amber-500"
                          />
                        )}
                        {localFile ? (
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                            {formatStorageStatusLabel(localFile)}
                          </span>
                        ) : doc.cloudUrl ? (
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Link Cloud
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {origin.isApplianceOrArticle && !hideLinkedOriginBanner && (
                      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        {origin.imageUrl ? (
                          <img
                            src={origin.imageUrl}
                            alt=""
                            className="w-5 h-5 rounded object-cover shrink-0 bg-white"
                          />
                        ) : (
                          <ShoppingBag className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 shrink-0" />
                        )}
                        <span className="font-medium truncate">{origin.groupTitle}</span>
                      </div>
                    )}

                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {scopedTitle}
                      </h3>
                      {(!providerRedundantInGrid || cleanRef || doc.issueDate) && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {!providerRedundantInGrid && doc.provider && (
                            <span className="font-medium text-brand-700 dark:text-brand-300">
                              {doc.provider}
                            </span>
                          )}
                          {cleanRef
                            ? `${!providerRedundantInGrid && doc.provider ? ' · ' : ''}#${cleanRef}`
                            : ''}
                          {doc.issueDate
                            ? `${!providerRedundantInGrid && doc.provider || cleanRef ? ' · ' : ''}${doc.issueDate}`
                            : ''}
                        </div>
                      )}
                      {expiryNotice && (
                        <div
                          className={`text-[11px] font-medium tabular-nums ${
                            expiryNotice.tone === 'expired'
                              ? 'text-rose-600 dark:text-rose-400'
                              : expiryNotice.tone === 'soon'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {expiryNotice.text}
                        </div>
                      )}
                    </div>

                    {displayNotes && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                        {displayNotes}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/15 dark:hover:bg-brand-500/25 rounded-lg transition-colors disabled:opacity-50"
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
                            readOnly ? { ...sharePayload, attachmentKey: undefined } : sharePayload
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Scarica
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareItem(sharePayload)}
                        aria-label="Condividi documento"
                        title="Condividi"
                        className="p-1.5 text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {!readOnly && (editable || deletable) && (
                      <div className="flex items-center gap-0.5">
                        {editable && isPdfDocumentCandidate(doc, localFile) && (
                          <button
                            type="button"
                            onClick={() => openPdfTrimForDocument(doc, fileKey)}
                            title="Estrai solo pagine in italiano + copertina"
                            aria-label="Estrai solo italiano da PDF"
                            className="p-1.5 text-slate-400 hover:text-brand-600 dark:hover:text-brand-300 rounded-lg transition-colors"
                          >
                            <Scissors className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => void handleTogglePinned(doc)}
                            title={doc.pinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                            aria-label={doc.pinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                            className={`p-1.5 rounded-lg transition-colors ${
                              doc.pinned
                                ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                                : 'text-slate-400 hover:text-amber-500'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${doc.pinned ? 'fill-amber-500' : ''}`} />
                          </button>
                        )}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => openEditForm(doc)}
                            aria-label="Modifica documento"
                            className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {deletable && (
                          <button
                            type="button"
                            onClick={() => setPendingDelete({ type: 'document', doc })}
                            aria-label="Elimina documento"
                            className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-colors"
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

        const renderMobileBillsCards = () => (
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
            {allBillsForSharing.map((b) => {
              const localFile = b.fileKey ? vaultMeta[b.fileKey] : undefined;
              const canOpen = !readOnly && Boolean(localFile);
              return (
                <article key={b.id} className="p-4 space-y-3">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (canOpen) {
                        void handleOpenAttachment(
                          b.fileKey,
                          undefined,
                          localFile?.fileName || `${b.label}-${b.number}.pdf`
                        );
                      } else {
                        setMobileActionTarget({ kind: 'bill', bill: b });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (canOpen) {
                          void handleOpenAttachment(
                            b.fileKey,
                            undefined,
                            localFile?.fileName || `${b.label}-${b.number}.pdf`
                          );
                        } else {
                          setMobileActionTarget({ kind: 'bill', bill: b });
                        }
                      }
                    }}
                    className="flex items-start justify-between gap-3 cursor-pointer active:opacity-80"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${getBillIconBg(
                          b.kind
                        )}`}
                      >
                        {renderBillIcon(b.kind, 'w-5 h-5')}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          {b.period}
                        </h3>
                        <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed tabular-nums">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {b.label}
                          </span>
                          {' · '}
                          {b.supplier}
                          {' · '}
                          #{b.number}
                          {b.date ? ` · ${b.date}` : ''}
                        </div>
                        {localFile && (
                          <div className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                            <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
                            <span>{formatStorageStatusLabel(localFile)}</span>
                          </div>
                        )}
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
                      <FileUp className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                      <span>Allega PDF originale</span>
                    </button>
                  )}

                  <div
                    className={`grid gap-2 ${
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
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/15 hover:bg-brand-100 dark:hover:bg-brand-500/25 rounded-xl transition-colors disabled:opacity-50"
                      >
                        {openingAttachmentKey === b.fileKey ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ExternalLink className="w-4 h-4" />
                        )}
                        <span>Apri</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        void downloadShareableItem(
                          readOnly ? { ...b.payload, attachmentKey: undefined } : b.payload
                        )
                      }
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100/90 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      <Download className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      <span>Scarica</span>
                    </button>

                    <button
                      type="button"
                      aria-label="Altre azioni bolletta"
                      onClick={() => setMobileActionTarget({ kind: 'bill', bill: b })}
                      className="min-h-[44px] w-[44px] inline-flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-100/90 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        );

        const isSearchExpandingSections = searchQuery.trim().length > 0;
        const isSectionCollapsed = (sectionId: DomainSectionId) =>
          !isSearchExpandingSections && collapsedSections[sectionId];

        const renderDomainHeader = ({
          sectionId,
          icon,
          iconSurfaceClass,
          title,
          count,
          subtitle,
          onFilterOnly,
        }: {
          sectionId: DomainSectionId;
          icon: React.ReactNode;
          iconSurfaceClass: string;
          title: string;
          count: number;
          subtitle: string;
          onFilterOnly?: () => void;
        }) => {
          const isCollapsed = isSectionCollapsed(sectionId);
          const contentId = `documents-domain-section-${sectionId}`;
          return (
            <div className="flex items-center justify-between gap-2 px-1">
              <button
                type="button"
                onClick={() => toggleDomainSection(sectionId)}
                aria-expanded={!isCollapsed}
                aria-controls={contentId}
                className="group flex items-center gap-3 min-w-0 flex-1 text-left min-h-[44px] py-0.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 transition-opacity hover:opacity-85"
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconSurfaceClass}`}
                >
                  {icon}
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {title}{' '}
                    <span className="font-mono text-xs font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                      ({count})
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {subtitle}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {onFilterOnly && originFilter === 'all' && activeTab === 'all' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDomainSectionCollapsed(sectionId, false);
                      onFilterOnly();
                    }}
                    className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <span>Solo questa sezione</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => toggleDomainSection(sectionId)}
                  aria-expanded={!isCollapsed}
                  aria-controls={contentId}
                  aria-label={isCollapsed ? `Espandi ${title}` : `Chiudi ${title}`}
                  title={isCollapsed ? `Espandi ${title}` : `Chiudi ${title}`}
                  className="min-w-[40px] min-h-[40px] md:min-w-[32px] md:min-h-[32px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-150 ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        };

        const billsSection = showBillsSection && (
          <section className="space-y-3">
            {renderDomainHeader({
              sectionId: 'bollette',
              icon: <Receipt className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
              iconSurfaceClass: 'bg-amber-500/10 dark:bg-amber-400/10',
              title: 'Bollette & GSE',
              count: allBillsForSharing.length,
              subtitle: readOnly
                ? 'Riepilogo HTML disponibile; PDF originali privati'
                : 'Luce, acqua, TARI e ricevute GSE sincronizzate',
              onFilterOnly: () => {
                setActiveTab('bollette');
                setOriginFilter('bollette');
                setProductFilter('all');
                setExpiryOnlyFilter(false);
              },
            })}

            {!isSectionCollapsed('bollette') && (
              <div id="documents-domain-section-bollette">
                {allBillsForSharing.length === 0 ? (
                  <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Nessuna bolletta o ricevuta GSE trovata con questo filtro.
                  </div>
                ) : (
                  <>
                    <div className="md:hidden bg-white dark:bg-slate-900/85 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                      {renderMobileBillsCards()}
                    </div>

                <div className="hidden md:block">
                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {allBillsForSharing.map((b) => {
                        const localFile = b.fileKey ? vaultMeta[b.fileKey] : undefined;
                        const canOpen = !readOnly && Boolean(localFile);
                        const canDelete = canDeleteUnifiedBill(b);
                        return (
                          <article
                            key={b.id}
                            className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-2xl p-4 flex flex-col justify-between gap-3.5 transition-colors shadow-xs dark:shadow-none"
                          >
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getBillIconBg(b.kind)}`}>
                                    {renderBillIcon(b.kind)}
                                  </div>
                                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                    {b.label}
                                  </span>
                                </div>
                                <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                                  {b.kind === 'gse' ? '+' : ''}
                                  {b.amount.toFixed(2).replace('.', ',')} €
                                </span>
                              </div>

                              <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                  {b.period}
                                </h3>
                                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                                  {b.supplier} · #{b.number} {b.date ? `· ${b.date}` : ''}
                                </div>
                              </div>

                              {localFile ? (
                                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                                  <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    {readOnly
                                      ? 'PDF privato'
                                      : formatStorageStatusLabel(localFile)}
                                  </span>
                                </div>
                              ) : !readOnly && b.fileKey ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAttachingBillKey(b.fileKey);
                                    billAttachInputRef.current?.click();
                                  }}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline"
                                >
                                  <FileUp className="w-3.5 h-3.5" />
                                  <span>Allega PDF originale</span>
                                </button>
                              ) : null}
                            </div>

                            <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
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
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/15 dark:hover:bg-brand-500/25 rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    {openingAttachmentKey === b.fileKey ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    )}
                                    <span>Apri</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    void downloadShareableItem(
                                      readOnly ? { ...b.payload, attachmentKey: undefined } : b.payload
                                    )
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Scarica</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShareItem(b.payload)}
                                  title="Condividi"
                                  aria-label="Condividi"
                                  className="p-1.5 text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
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
                                  className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-colors"
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
                    <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden shadow-xs dark:shadow-none">
                      {allBillsForSharing.map((b) => {
                        const localFile = b.fileKey ? vaultMeta[b.fileKey] : undefined;
                        const canOpen = !readOnly && Boolean(localFile);
                        const canDelete = canDeleteUnifiedBill(b);
                        return (
                          <div
                            key={b.id}
                            className="px-4 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/90 dark:hover:bg-slate-800/35 transition-colors"
                          >
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getBillIconBg(
                                  b.kind
                                )}`}
                              >
                                {renderBillIcon(b.kind, 'w-4.5 h-4.5')}
                              </div>
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {b.period}
                                  </h3>
                                  <span className="text-xs text-slate-400">·</span>
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">
                                    {b.label}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                  <span>{b.supplier}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono">#{b.number}</span>
                                  {b.date && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>{b.date}</span>
                                    </>
                                  )}
                                  {localFile ? (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                                        <FileCheck2 className="w-3 h-3" />
                                        {readOnly
                                          ? 'PDF privato'
                                          : formatStorageStatusLabel(localFile)}
                                      </span>
                                    </>
                                  ) : !readOnly && b.fileKey ? (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAttachingBillKey(b.fileKey);
                                          billAttachInputRef.current?.click();
                                        }}
                                        className="inline-flex items-center gap-1 font-medium text-brand-700 dark:text-brand-300 hover:underline"
                                      >
                                        <FileUp className="w-3 h-3" />
                                        Allega PDF
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 shrink-0">
                              <div className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                {b.kind === 'gse' ? '+' : ''}
                                {b.amount.toFixed(2).replace('.', ',')} €
                              </div>

                              <div className="flex items-center gap-1 whitespace-nowrap">
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
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/15 rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    {openingAttachmentKey === b.fileKey ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    )}
                                    <span>Apri</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    void downloadShareableItem(
                                      readOnly
                                        ? { ...b.payload, attachmentKey: undefined }
                                        : b.payload
                                    )
                                  }
                                  title="Scarica"
                                  aria-label="Scarica"
                                  className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShareItem(b.payload)}
                                  title="Condividi"
                                  aria-label="Condividi"
                                  className="p-2 text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                >
                                  <Share2 className="w-4 h-4" />
                                </button>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => setPendingDelete({ type: 'bill', item: b })}
                                    title="Elimina"
                                    aria-label="Elimina"
                                    className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                  </>
                )}
              </div>
            )}
          </section>
        );

        if (!hasAnyContent) {
          return (
            <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 md:p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto">
                <FolderOpen className="w-6 h-6 text-slate-400 dark:text-slate-500" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {hasAnyActiveFilter
                    ? 'Nessun documento corrisponde ai filtri selezionati'
                    : 'Nessun documento archiviato'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                  {hasAnyActiveFilter
                    ? 'Prova a modificare la ricerca oppure azzera i filtri per vedere tutto l’archivio.'
                    : 'Carica un PDF, una bolletta o una foto con Importa Documenti (Auto): riconosce il file e lo salva nella sezione corretta.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {hasAnyActiveFilter && (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="min-h-[44px] md:min-h-0 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl"
                  >
                    Azzera filtri
                  </button>
                )}
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => smartImportInputRef.current?.click()}
                      className="min-h-[44px] md:min-h-0 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:text-slate-950 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-xl"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Importa Documenti (Auto)
                    </button>
                    <button
                      type="button"
                      onClick={openNewForm}
                      className="min-h-[44px] md:min-h-0 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Inserisci a mano
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        }

        const useGroupedProductLayout =
          showProductGroupingControls && groupByProduct && productFilter === 'all';
        const { houseRows, productRows, carRows, productGroups } = domainDocumentBuckets;

        const renderFlatDocCollection = (
          rows: UnifiedDocumentRow[],
          hideLinkedOrigin = false
        ) => (
          <>
            <div className="md:hidden bg-white dark:bg-slate-900/85 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              {renderMobileDocsList(rows, hideLinkedOrigin, true)}
            </div>

            <div className="hidden md:block">
              {viewMode === 'list' ? (
                <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs dark:shadow-none">
                  {renderDesktopDocsList(rows, hideLinkedOrigin)}
                </div>
              ) : (
                renderDocsGrid(rows, hideLinkedOrigin)
              )}
            </div>
          </>
        );

        return (
          <div className="space-y-6">
            {showDocsSection && houseRows.length > 0 && (
              <section className="space-y-3">
                {renderDomainHeader({
                  sectionId: 'casa',
                  icon: <Building2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />,
                  iconSurfaceClass: 'bg-sky-500/10 dark:bg-sky-400/10',
                  title: 'Documenti Casa',
                  count: houseRows.length,
                  subtitle: 'Mutuo, contratti, utenze, identità e documenti personali',
                  onFilterOnly: () => {
                    setOriginFilter('documenti');
                    setProductFilter('all');
                    setExpiryOnlyFilter(false);
                    if (activeTab === 'ricerche') setActiveTab('all');
                  },
                })}
                {!isSectionCollapsed('casa') && (
                  <div id="documents-domain-section-casa">
                    {renderFlatDocCollection(houseRows, false)}
                  </div>
                )}
              </section>
            )}

            {showDocsSection && productRows.length > 0 && (
              <section className="space-y-3">
                {renderDomainHeader({
                  sectionId: 'prodotti',
                  icon: <ShoppingBag className="w-4 h-4 text-violet-600 dark:text-violet-400" />,
                  iconSurfaceClass: 'bg-violet-500/10 dark:bg-violet-400/10',
                  title: 'Prodotti & Elettrodomestici',
                  count: productRows.length,
                  subtitle: 'Manuali utente, etichette energetiche, ricevute e garanzie',
                  onFilterOnly: () => {
                    setActiveTab('ricerche');
                    setOriginFilter('ricerche');
                    setExpiryOnlyFilter(false);
                  },
                })}

                {!isSectionCollapsed('prodotti') && (
                  <div id="documents-domain-section-prodotti">
                    {useGroupedProductLayout ? (
                      <>
                        {/* Mobile & Desktop List: ONE unified card container divided cleanly by product header strips */}
                        <div
                          className={`${
                            viewMode === 'grid' ? 'md:hidden' : ''
                          } bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs dark:shadow-none divide-y divide-slate-200 dark:divide-slate-800`}
                        >
                          {productGroups.map((group) => (
                            <div key={group.groupKey}>
                              <div className="px-4 py-2.5 bg-slate-50/90 dark:bg-slate-800/45 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  {group.imageUrl ? (
                                    <img
                                      src={group.imageUrl}
                                      alt=""
                                      className="w-9 h-9 rounded-lg object-cover border border-slate-200/80 dark:border-slate-700/70 bg-white shrink-0"
                                    />
                                  ) : (
                                    <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/70 flex items-center justify-center shrink-0">
                                      <ShoppingBag className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <h3 className="text-[13px] font-bold text-slate-900 dark:text-slate-100 truncate">
                                      {group.title}
                                    </h3>
                                    {group.subtitle && (
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                        {group.subtitle}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                                  {group.rows.length} file
                                </span>
                              </div>

                              {renderMobileDocsList(group.rows, true, true)}
                              <div className="hidden md:block">
                                {renderDesktopDocsList(group.rows, true)}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Grid: clean product subheaders above crisp card grids */}
                        {viewMode === 'grid' && (
                          <div className="hidden md:block space-y-6">
                            {productGroups.map((group) => (
                              <div key={group.groupKey} className="space-y-3">
                                <div className="flex items-center justify-between gap-3 px-1">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {group.imageUrl ? (
                                      <img
                                        src={group.imageUrl}
                                        alt=""
                                        className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-800 bg-white shrink-0"
                                      />
                                    ) : (
                                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                                        <ShoppingBag className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                        {group.title}
                                      </h3>
                                      {group.subtitle && (
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                          {group.subtitle}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                                    {group.rows.length} file
                                  </span>
                                </div>

                                {renderDocsGrid(group.rows, true)}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      renderFlatDocCollection(productRows, false)
                    )}
                  </div>
                )}
              </section>
            )}

            {showDocsSection && carRows.length > 0 && (
              <section className="space-y-3">
                {renderDomainHeader({
                  sectionId: 'auto',
                  icon: <Car className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
                  iconSurfaceClass: 'bg-emerald-500/10 dark:bg-emerald-400/10',
                  title: `Auto · ${carPlate}`,
                  count: carRows.length,
                  subtitle: 'Polizza, certificato, attestato di rischio, libretto e scadenze',
                  onFilterOnly: () => {
                    setOriginFilter('macchina');
                    setProductFilter('all');
                    setExpiryOnlyFilter(false);
                    if (activeTab === 'ricerche') setActiveTab('all');
                  },
                })}
                {!isSectionCollapsed('auto') && (
                  <div id="documents-domain-section-auto">
                    {renderFlatDocCollection(carRows, true)}
                  </div>
                )}
              </section>
            )}

            {billsSection}
          </div>
        );
      })()}

      {/* ==================== ADD / EDIT MODAL (Responsive Sheet on Mobile, Dialog on Desktop) ==================== */}
      {showForm && !readOnly && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/60 backdrop-blur-xs md:p-4"
          onClick={() => {
            setShowForm(false);
            resetForm();
          }}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full md:max-w-3xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 border-t md:border border-slate-200 dark:border-slate-800 rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Mobile grab handle */}
            <div className="md:hidden pt-3 pb-1 flex justify-center">
              <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
            </div>

            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingDoc ? `Modifica "${editingDoc.title}"` : 'Nuovo Documento'}
              </h2>
              <button
                type="button"
                aria-label="Chiudi"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm md:text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Titolo documento *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Es. Contratto Fibra WindTre"
                    className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Categoria *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as HomeDocumentCategory)}
                    className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-brand-500"
                  >
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Ente / Banca / Fornitore *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="Es. WindTre, Intesa Sanpaolo..."
                    className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    N° Contratto / Pratica
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={referenceCode}
                    onChange={(e) => setReferenceCode(e.target.value)}
                    placeholder="Es. Cod. cliente o pratica"
                    className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Data documento
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    placeholder="Es. 15/03/2024"
                    className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Scadenza / Rinnovo
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    placeholder="Es. 15/03/2027"
                    className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Link esterno / Cloud (opzionale)
                  </label>
                  <input
                    type="url"
                    value={cloudUrl}
                    onChange={(e) => setCloudUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Priorità
                  </label>
                  <label className="min-h-[44px] md:min-h-[34px] flex items-center gap-2.5 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pinned}
                      onChange={(e) => setPinned(e.target.checked)}
                      className="h-4 w-4 rounded accent-brand-600 dark:accent-brand-400"
                    />
                    <span>Fissa in alto</span>
                  </label>
                </div>

                {researches.length > 0 && (
                  <>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Collega a un Prodotto (opzionale)
                      </label>
                      <select
                        value={linkedResearchId}
                        onChange={(e) => setLinkedResearchId(e.target.value)}
                        className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-brand-500"
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
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                          Tipo allegato prodotto
                        </label>
                        <select
                          value={linkedDocType}
                          onChange={(e) => setLinkedDocType(e.target.value as ArticleAttachmentType)}
                          className="w-full min-h-[44px] md:min-h-0 px-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-brand-500"
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Note / Dati utili
                  </label>
                  <input
                    type="text"
                    maxLength={180}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Annotazioni rapide, codice migrazione, IBAN, credenziali..."
                    className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>

                {/* File upload picker */}
                <div className="sm:col-span-2 lg:col-span-3 bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 shrink-0" />
                        <span>Allega File (PDF, foto, documento)</span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {pendingFile
                          ? `Pronto (${localOnlySave ? 'solo locale' : vaultStorageStatus?.configured ? vaultStorageStatus.providerLabel : 'cloud compresso'}): ${pendingFile.name} (${formatFileSize(pendingFile.size)})`
                          : editingDoc?.fileName
                            ? `File attuale: ${editingDoc.fileName}`
                            : vaultStorageStatus?.configured
                              ? `Salvato su ${vaultStorageStatus.providerLabel} (fino a ${Math.floor(vaultStorageStatus.maxFileBytes / 1_000_000)} MB).`
                              : 'Salvato su cloud (fino a 6 MB compressi) o solo in locale.'}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <input
                        ref={formFileInputRef}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.csv,.json"
                        onChange={(e) => void handleFormFileSelected(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => formFileInputRef.current?.click()}
                        className="min-h-[44px] md:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/15 hover:bg-brand-100 dark:hover:bg-brand-500/25 rounded-xl"
                      >
                        <Upload className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        <span>{pendingFile || editingDoc?.fileName ? 'Cambia File' : 'Scegli File'}</span>
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer pt-2 border-t border-slate-200/70 dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={localOnlySave}
                      onChange={(e) => setLocalOnlySave(e.target.checked)}
                      className="h-4 w-4 rounded accent-brand-600 dark:accent-brand-400"
                    />
                    <span>Salva allegato solo su questo dispositivo (0 byte cloud)</span>
                  </label>

                  {((pendingFile &&
                    (pendingFile.type === 'application/pdf' ||
                      /\.pdf$/i.test(pendingFile.name))) ||
                    (!pendingFile &&
                      editingDoc &&
                      isPdfDocumentCandidate(
                        editingDoc,
                        editingDoc.attachmentKey ? vaultMeta[editingDoc.attachmentKey] : undefined
                      ))) && (
                    <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Manuale multilingua lungo? Estrai solo copertina e italiano.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (pendingFile) {
                            setTrimPdfModal({
                              target: {
                                title: title.trim() || pendingFile.name,
                                fileName: pendingFile.name,
                                file: pendingFile,
                              },
                              isPendingFormFile: true,
                            });
                          } else if (editingDoc) {
                            openPdfTrimForDocument(editingDoc, editingDoc.attachmentKey);
                          }
                        }}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/15 dark:hover:bg-brand-500/25 rounded-lg"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                        <span>Solo IT (riduci PDF)</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="min-h-[44px] md:min-h-0 px-4 py-2 text-sm md:text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] md:min-h-0 flex-1 md:flex-none px-5 py-2.5 md:py-2 text-sm md:text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:text-slate-950 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-xl disabled:opacity-60"
              >
                {saving ? 'Salvataggio...' : editingDoc ? 'Salva modifiche' : 'Salva documento'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MOBILE STORAGE & OFFLINE BOTTOM SHEET (<768px) ==================== */}
      {mobileStorageSheetOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden flex items-end bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setMobileStorageSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl p-5 space-y-4 shadow-2xl"
          >
            <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto -mt-1" />

            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Storage &amp; Cache Offline
              </h2>
              <button
                type="button"
                aria-label="Chiudi stato storage"
                onClick={() => setMobileStorageSheetOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              <div className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                  <Database className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                  <span>File salvati offline</span>
                </div>
                <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {vaultStats.cachedCount} / {vaultStats.totalFiles}
                </span>
              </div>

              {!readOnly && vaultStorageStatus && (
                <div className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                    <Cloud
                      className={`w-4 h-4 shrink-0 ${
                        vaultStorageStatus.configured
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400'
                      }`}
                    />
                    <span>Storage Cloud</span>
                  </div>
                  <span className="font-semibold text-xs text-slate-800 dark:text-slate-100 tabular-nums">
                    {vaultStorageStatus.configured
                      ? `${vaultStorageStatus.providerLabel} (${vaultStats.externalCount})`
                      : 'Firestore compresso'}
                  </span>
                </div>
              )}
            </div>

            {precacheProgress && precacheProgress.total > 0 && (
              <div className="text-xs text-brand-700 dark:text-brand-300 tabular-nums">
                Scarico {precacheProgress.completed}/{precacheProgress.total}:{' '}
                {precacheProgress.currentFileName}
              </div>
            )}

            {!readOnly && vaultStats.totalFiles > 0 && (
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={precachingAll || (quotaExceeded && vaultStats.missingOffline > 0)}
                  onClick={() => void handlePrecacheAllOffline()}
                  className="min-h-[48px] w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 disabled:opacity-55"
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
                    className="min-h-[48px] w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 disabled:opacity-55"
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
        </div>
      )}

      {/* ==================== MOBILE FILTER BOTTOM SHEET (<768px) ==================== */}
      {mobileFilterSheetOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden flex items-end bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setMobileFilterSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl shadow-2xl overflow-hidden"
          >
            <div className="pt-3 pb-1 flex justify-center shrink-0">
              <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full" />
            </div>

            <div className="px-5 py-2.5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Filtra e Ordina
              </h2>
              <button
                type="button"
                aria-label="Chiudi filtri"
                onClick={() => setMobileFilterSheetOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Ordina per
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => handleChangeSortBy(e.target.value as DocumentSortBy)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-base bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
                >
                  <option value="pinned_name">Preferiti in alto e Nome (A → Z)</option>
                  <option value="name_asc">Nome (A → Z)</option>
                  <option value="product_origin">Prodotto / Origine</option>
                  <option value="size_desc">Dimensione file (più grandi prima)</option>
                  <option value="date_desc">Data più recente</option>
                </select>
              </div>
              {activeTab !== 'bollette' &&
                originFilter !== 'bollette' &&
                visibleCategoryOptions.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Categoria documento
                    </label>
                    <select
                      value={activeTab !== 'all' && activeTab !== 'ricerche' ? activeTab : 'all'}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === 'all') {
                          setActiveTab(originFilter === 'ricerche' ? 'ricerche' : 'all');
                        } else {
                          setActiveTab(next as HomeDocumentCategory);
                        }
                      }}
                      className="w-full min-h-[44px] px-3.5 py-2 text-base bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
                    >
                      <option value="all">Tutte le categorie</option>
                      {visibleCategoryOptions.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat} ({categoryCounts.get(cat) || 0})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              {showProductGroupingControls && (
                <>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Prodotto / Elettrodomestico
                      </label>
                      <select
                        value={productFilter}
                        onChange={(e) => setProductFilter(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 py-2 text-base bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
                      >
                        <option value="all">Tutti i prodotti ({allUnifiedDocumentRows.length})</option>
                        {linkedProductFilterOptions.items.map((item) => (
                          <option key={item.groupKey} value={item.groupKey}>
                            {item.title} ({item.count})
                          </option>
                        ))}
                        {linkedProductFilterOptions.otherCount > 0 && (
                          <option value="unlinked">
                            Solo non collegati ({linkedProductFilterOptions.otherCount})
                          </option>
                        )}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleGroupByProduct}
                      aria-pressed={groupByProduct}
                      className={`min-h-[48px] w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs font-semibold ${
                        groupByProduct
                          ? 'bg-brand-50 dark:bg-brand-500/15 border-brand-300 dark:border-brand-500/40 text-brand-800 dark:text-brand-200'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Layers className="w-4 h-4" />
                        <span>Divisi per prodotto</span>
                      </span>
                      <span>{groupByProduct ? 'Attivo' : 'Disattivo'}</span>
                    </button>
                  </>
                )}

              {(expiryStats.totalAttentionCount > 0 || expiryOnlyFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !expiryOnlyFilter;
                    setExpiryOnlyFilter(next);
                    if (next && (activeTab === 'bollette' || originFilter === 'bollette')) {
                      setActiveTab('all');
                      setOriginFilter('all');
                    }
                  }}
                  aria-pressed={expiryOnlyFilter}
                  className={`min-h-[48px] w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs font-semibold ${
                    expiryOnlyFilter
                      ? 'bg-rose-50 dark:bg-rose-500/15 border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>Solo scaduti / in scadenza (≤{EXPIRY_SOON_DAYS} gg)</span>
                  </span>
                  <span className="font-mono tabular-nums">{expiryStats.totalAttentionCount}</span>
                </button>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2.5 shrink-0">
              <button
                type="button"
                onClick={resetAllFilters}
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

      {/* ==================== MOBILE QUICK ACTION BOTTOM SHEET (<768px) ==================== */}
      {mobileActionTarget && (
        <div
          className="fixed inset-0 z-50 md:hidden flex items-end bg-slate-950/60 backdrop-blur-xs"
          onClick={() => setMobileActionTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl p-4 space-y-1.5 shadow-2xl"
          >
            <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-2" />

            {mobileActionTarget.kind === 'doc' ? (
              (() => {
                const { row } = mobileActionTarget;
                const { doc, fileKey, sharePayload, editable, deletable } = row;
                const localFile = fileKey ? vaultMeta[fileKey] : undefined;
                const canOpen = Boolean((!readOnly && (localFile || doc.fileName)) || doc.cloudUrl);
                return (
                  <>
                    <div className="px-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {doc.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
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
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-semibold text-brand-700 dark:text-brand-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <ExternalLink className="w-4 h-4 shrink-0" />
                        <span>Apri in nuova scheda</span>
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
                      <Download className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                      <span>Scarica sul telefono</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileActionTarget(null);
                        setShareItem(sharePayload);
                      }}
                      className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Share2 className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                      <span>Condividi</span>
                    </button>

                    {!readOnly && editable && isPdfDocumentCandidate(doc, localFile) && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          openPdfTrimForDocument(doc, fileKey);
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Scissors className="w-4 h-4 shrink-0" />
                        <span>Estrai solo Italiano + copertina (PDF)</span>
                      </button>
                    )}

                    {!readOnly && editable && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          void handleTogglePinned(doc);
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Star
                          className={`w-4 h-4 shrink-0 ${
                            doc.pinned ? 'fill-amber-500 text-amber-500' : 'text-slate-500 dark:text-slate-400'
                          }`}
                        />
                        <span>{doc.pinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}</span>
                      </button>
                    )}

                    {!readOnly && editable && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionTarget(null);
                          openEditForm(doc);
                        }}
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                        <span>Modifica dettagli / file</span>
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
                        <span>Elimina documento</span>
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
                    <div className="px-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {bill.label} · {bill.period}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
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
                        className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-semibold text-brand-700 dark:text-brand-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <ExternalLink className="w-4 h-4 shrink-0" />
                        <span>Apri PDF in nuova scheda</span>
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
                      <Download className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                      <span>Scarica sul telefono</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileActionTarget(null);
                        setShareItem(bill.payload);
                      }}
                      className="min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Share2 className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                      <span>Condividi</span>
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
                        <FileUp className="w-4 h-4 shrink-0 text-brand-600 dark:text-brand-400" />
                        <span>Allega PDF originale</span>
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
                        <span>Elimina</span>
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

      <PdfItalianTrimModal
        target={trimPdfModal?.target || null}
        onClose={() => setTrimPdfModal(null)}
        onSaveTrimmedFile={handleSaveTrimmedDocument}
      />

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {pendingDelete.type === 'document'
                    ? `Eliminare "${pendingDelete.doc.title}"?`
                    : `Eliminare "${pendingDelete.item.label} · ${pendingDelete.item.period}"?`}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {pendingDelete.type === 'document'
                    ? 'Verrà rimosso sia dall’archivio su Firebase (e dalla eventuale pagina collegata) sia il file allegato.'
                    : 'Verrà rimossa sia dalla pagina Bollette che dall’archivio Documenti insieme all’eventuale PDF allegato.'}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="min-h-[44px] md:min-h-0 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="min-h-[44px] md:min-h-0 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl"
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
