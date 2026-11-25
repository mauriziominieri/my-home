import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Heart,
  Home,
  Image as ImageIcon,
  ImageOff,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  PackagePlus,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  ArticleAttachmentType,
  HomeDocumentRecord,
  ProductResearchCategory,
  ProductResearchRecord,
  ProductResearchStatus,
} from '../types/home';
import { getDocumentsForResearch, parseResearchDocumentRef } from '../utils/carGroceryStore';
import {
  buildDocumentSharePayload,
  downloadShareableItem,
  formatFileSize,
  getVaultFile,
  MAX_CLOUD_FILE_BYTES,
  ShareableItemPayload,
} from '../utils/documentVault';
import {
  COLOR_PRESETS,
  findColorNameForHex,
  getResearchRoomLabel,
  inferProductBrand,
  normalizeBrandName,
  normalizeResearchRoom,
  RESEARCH_ROOMS,
  ResearchRoomId,
  resolveColorHex,
} from '../utils/researchHelpers';
import { AccessUnlockBanner } from './AccessUnlockBanner';
import { ShareSheetModal } from './ShareSheetModal';

interface ResearchesViewProps {
  researches: ProductResearchRecord[];
  researchDocuments: HomeDocumentRecord[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onAddResearch: (
    item: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>
  ) => Promise<string | void>;
  onUpdateResearch: (
    id: string,
    item: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>
  ) => Promise<void>;
  onDeleteResearch: (id: string) => Promise<void>;
  onUploadResearchDocument: (
    researchId: string,
    docType: ArticleAttachmentType,
    title: string,
    provider: string,
    file: File
  ) => Promise<void>;
  onDeleteResearchDocument: (docId: string) => Promise<void>;
  onMoveToArticles?: (item: ProductResearchRecord) => Promise<void>;
}

interface QueuedDraftAttachment {
  id: string;
  file: File;
  docType: ArticleAttachmentType;
  label: string;
}

const ATTACHMENT_TYPE_OPTIONS: {
  value: ArticleAttachmentType;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: 'scontrino_fattura',
    label: 'Scontrino / Fattura',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  {
    value: 'manuale',
    label: "Manuale / Scheda PDF",
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  {
    value: 'garanzia_extra_family',
    label: 'Garanzia / Extra Family',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  {
    value: 'targhetta_pnc',
    label: 'Foto / Etichetta',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  {
    value: 'altro',
    label: 'Altro allegato',
    badgeClass: 'bg-slate-700/60 text-slate-300 border-slate-600/50',
  },
];

function getAttachmentTypeMeta(docType?: ArticleAttachmentType) {
  return (
    ATTACHMENT_TYPE_OPTIONS.find((opt) => opt.value === docType) || ATTACHMENT_TYPE_OPTIONS[4]
  );
}

const CATEGORY_OPTIONS: { value: ProductResearchCategory; label: string }[] = [
  { value: 'elettrodomestici', label: 'Elettrodomestici' },
  { value: 'elettronica', label: 'Elettronica & Tech' },
  { value: 'casa_arredo', label: 'Casa & Arredo' },
  { value: 'fai_da_te', label: 'Fai da te & Giardino' },
  { value: 'auto', label: 'Auto & Accessori' },
  { value: 'abbigliamento', label: 'Abbigliamento' },
  { value: 'altro', label: 'Altro' },
];

const STATUS_OPTIONS: {
  value: ProductResearchStatus;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: 'da_valutare',
    label: 'Da valutare',
    badgeClass: 'bg-slate-800 text-slate-200 border-slate-700',
  },
  {
    value: 'preferito',
    label: 'Preferito',
    badgeClass: 'bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/40',
  },
  {
    value: 'da_acquistare',
    label: 'Da acquistare',
    badgeClass: 'bg-sky-500/15 text-sky-200 border-sky-400/40',
  },
  {
    value: 'acquistato',
    label: 'Acquistato',
    badgeClass: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40',
  },
  {
    value: 'scartato',
    label: 'Scartato',
    badgeClass: 'bg-rose-500/15 text-rose-200 border-rose-400/40',
  },
];

type ResearchSortField =
  | 'title'
  | 'price'
  | 'brand'
  | 'store'
  | 'room'
  | 'status'
  | 'recent';
type SortDirection = 'asc' | 'desc';
type ResearchViewMode = 'grid' | 'list';
const VIEW_MODE_STORAGE_KEY = 'myhome_researches_view_mode';

function ColorSwatchDot({
  color,
  size = 'md',
}: {
  color?: string;
  size?: 'sm' | 'md';
}) {
  const hex = resolveColorHex(color);
  const cls = size === 'sm' ? 'w-3 h-3 shrink-0' : 'w-3.5 h-3.5 shrink-0';
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cls}>
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill={hex}
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function ColorFieldInput({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  compact?: boolean;
}) {
  const pickerHex = resolveColorHex(value || '#94a3b8');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label
          title="Scegli un colore dalla tavolozza"
          className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-950 border border-slate-700 hover:border-sky-400 cursor-pointer shrink-0 overflow-hidden"
        >
          <ColorSwatchDot color={value || pickerHex} size="md" />
          <input
            type="color"
            value={pickerHex}
            onChange={(e) => {
              const chosen = e.target.value;
              const matchedName = findColorNameForHex(chosen);
              onChange(matchedName || chosen);
            }}
            aria-label="Seleziona colore dalla tavolozza"
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>
        <input
          type="text"
          maxLength={60}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Es. Oro, Nero, Arancione Cosmico..."
          className={`flex-1 min-w-0 px-2.5 ${
            compact ? 'py-1.5 bg-slate-950' : 'py-2 bg-slate-900'
          } border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Rimuovi colore"
            className="p-1.5 text-slate-500 hover:text-slate-200 rounded-lg hover:bg-slate-800 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {COLOR_PRESETS.slice(0, 16).map((preset) => {
          const isSelected = value.trim().toLowerCase() === preset.name.toLowerCase();
          return (
            <button
              key={preset.name}
              type="button"
              onClick={() => onChange(preset.name)}
              title={preset.name}
              aria-label={`Seleziona colore ${preset.name}`}
              className={`p-0.5 rounded-full transition-transform hover:scale-110 ${
                isSelected ? 'ring-2 ring-sky-400 bg-slate-800' : 'opacity-85 hover:opacity-100'
              }`}
            >
              <ColorSwatchDot color={preset.hex} size="sm" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getCategoryLabel(cat: ProductResearchCategory): string {
  return CATEGORY_OPTIONS.find((c) => c.value === cat)?.label || 'Altro';
}

function getStatusMeta(status: ProductResearchStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];
}

function normalizeUrlInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname.includes('.')) return null;
    return parsed.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

function clientFallbackInspectUrl(validUrl: string): {
  url: string;
  title: string;
  store: string;
  category: ProductResearchCategory;
  brand?: string;
  color?: string;
  model?: string;
  specs?: string;
  blockedBySite?: boolean;
} {
  const parsed = new URL(validUrl);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let store = host;
  if (host.includes('amazon.')) store = 'Amazon';
  else if (host.includes('maisonsdumonde.')) store = 'Maisons du Monde';
  else if (host.includes('zarahome.')) store = 'Zara Home';
  else if (host.includes('westwing.')) store = 'Westwing';
  else if (host.includes('kavehome.')) store = 'Kave Home';
  else if (host.includes('sklum.')) store = 'Sklum';
  else if (host.includes('mondoconv')) store = 'Mondo Convenienza';
  else if (host.includes('laredoute.')) store = 'La Redoute';
  else if (host.includes('conforama.')) store = 'Conforama';
  else if (host.includes('casashops.')) store = 'CASA';
  else if (host.includes('jysk.')) store = 'JYSK';
  else if (host.includes('electrolux.')) store = 'Electrolux';
  else if (host.includes('aeg.')) store = 'AEG';
  else if (host.includes('dyson.')) store = 'Dyson';
  else if (host.includes('mediaworld.')) store = 'MediaWorld';
  else if (host.includes('unieuro.')) store = 'Unieuro';
  else if (host.includes('ikea.')) store = 'IKEA';
  else if (host.includes('leroymerlin.')) store = 'Leroy Merlin';
  else if (host.includes('euronics.')) store = 'Euronics';
  else if (host.includes('decathlon.')) store = 'Decathlon';
  else if (host.includes('apple.')) store = 'Apple';
  else if (host.includes('samsung.')) store = 'Samsung';
  else if (host.includes('philips.')) store = 'Philips';
  else if (host.includes('ebay.')) store = 'eBay';

  let brand: string | undefined;

  const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  let model = asinMatch?.[1]?.toUpperCase();

  const segments = parsed.pathname
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s).trim();
      } catch {
        return s.trim();
      }
    })
    .filter(
      (s) =>
        s.length >= 3 &&
        !/^(dp|gp|product|products|p|it|it-it|fr|en|de|es|shop|catalog|prodotto|prodotti|item)$/i.test(
          s
        ) &&
        !/^b0[a-z0-9]{8}$/i.test(s) &&
        !/^[0-9]+$/.test(s)
    );
  const rawSlug = segments.sort((a, b) => b.length - a.length)[0] || '';
  let slug = rawSlug.replace(/\.(html?|php|aspx?)$/i, '').trim();
  const skuMatch = slug.match(/^(.+?)[-_](?:id[-_]?|p[-_]?)?(s?\d{5,10})$/i);
  if (skuMatch && skuMatch[1].length >= 4) {
    slug = skuMatch[1];
    if (!model) model = skuMatch[2].toUpperCase();
  }

  const rawTokens = slug
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lowercaseWords = new Set([
    'in', 'di', 'a', 'da', 'con', 'per', 'su', 'tra', 'fra', 'e', 'ed', 'o',
    'del', 'della', 'dei', 'degli', 'delle', 'al', 'alla', 'nel', 'nella',
    'sul', 'sulla', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno',
  ]);
  const unitWords = new Set(['cm', 'mm', 'm', 'kg', 'gr', 'g', 'ml', 'l', 'lt', 'w', 'kw', 'v']);
  const dimAbbrev: Record<string, string> = {
    alt: 'Alt.',
    larg: 'Larg.',
    prof: 'Prof.',
    diam: 'Diam.',
    lungh: 'Lungh.',
  };

  const formatted = rawTokens.map((tok, idx) => {
    const low = tok.toLowerCase();
    if (unitWords.has(low)) return low;
    if (dimAbbrev[low] && idx + 1 < rawTokens.length && /^\d/.test(rawTokens[idx + 1])) {
      return dimAbbrev[low];
    }
    if (idx > 0 && lowercaseWords.has(low)) return low;
    return tok.charAt(0).toUpperCase() + tok.slice(1);
  });

  const title = (formatted.join(' ') || `Prodotto ${store}`).slice(0, 160);

  const slugLower = slug.toLowerCase();
  const specsLines: string[] = [];
  if (model && !asinMatch) specsLines.push(`Codice articolo: ${model}`);
  const matM = slugLower.match(
    /\bin-(cemento|legno-massello|legno|metallo|ceramica|porcellana|vetro|ottone|marmo|ferro|acciaio|lino|velluto|cotone|resina|terracotta|rattan|bambu|bambù)\b/
  );
  if (matM?.[1]) {
    const m = matM[1].replace(/-/g, ' ');
    specsLines.push(`Materiale: ${m.charAt(0).toUpperCase() + m.slice(1)}`);
  }
  const hM = slugLower.match(/(?:^|-)alt-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
  if (hM) specsLines.push(`Altezza: ${hM[1]} ${hM[2]}`);

  const low = `${title} ${brand || ''} ${validUrl}`.toLowerCase();
  let category: ProductResearchCategory = 'altro';
  if (/(forno|frigo|frigorifero|lavatrice|asciugatrice|lavastoviglie|induzione|microonde|aspirapolvere|dyson|cappa)/.test(low)) {
    category = 'elettrodomestici';
  } else if (/(tv|monitor|laptop|macbook|pc|ipad|tablet|iphone|custodia|magsafe|cuffie|router|ssd|tastiera|mouse)/.test(low)) {
    category = 'elettronica';
  } else if (/(divano|tavolo|sedia|armadio|lampada|materasso|tappeto|arredo|arredamento|scrivania|scaffale|statuetta|busto|scultura|soprammobile|vaso|cornice|quadro|candela|cuscino|plaid|tenda|poltrona|pouf|libreria|comodino|cemento|ceramica|maisonsdumonde|zarahome|westwing|kavehome|sklum)/.test(low)) {
    category = 'casa_arredo';
  } else if (/(trapano|avvitatore|makita|utensil|scala|giardino|vernice|silicone|idropulitrice)/.test(low)) {
    category = 'fai_da_te';
  } else if (/(auto|gomme|pneumatici|panda|fiat|tergicristall|portabici)/.test(low)) {
    category = 'auto';
  } else if (/(scarpe|giacca|maglia|pantaloni|zaino|felpa)/.test(low)) {
    category = 'abbigliamento';
  }

  const specs = specsLines.length > 0 ? specsLines.join('\n') : undefined;
  brand = inferProductBrand({ title, url: validUrl, store, specs });

  return {
    url: validUrl,
    title,
    store: store.slice(0, 60),
    category,
    brand,
    model,
    specs,
  };
}

function parseSpecLines(specs?: string): { label?: string; value: string; isBullet?: boolean }[] {
  if (!specs) return [];
  return specs
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('•') || line.startsWith('- ')) {
        return { value: line.replace(/^[•-]\s*/, '').trim(), isBullet: true };
      }
      const colonIdx = line.indexOf(':');
      if (colonIdx > 1 && colonIdx < 42) {
        return {
          label: line.slice(0, colonIdx).trim(),
          value: line.slice(colonIdx + 1).trim(),
        };
      }
      return { value: line };
    })
    .filter((entry) => Boolean(entry.value));
}

function buildResearchSharePayload(item: ProductResearchRecord): ShareableItemPayload {
  const statusLabel = getStatusMeta(item.status).label;
  const roomLabel = getResearchRoomLabel(item.room);
  const resolvedBrand = inferProductBrand(item);
  const priceText = typeof item.priceEur === 'number' ? `€ ${item.priceEur.toFixed(2)}` : 'Non indicato';
  const lines = [
    item.title,
    resolvedBrand ? `Marca: ${resolvedBrand}` : '',
    `Negozio: ${item.store}`,
    `Prezzo: ${priceText}`,
    item.room ? `Stanza: ${roomLabel}` : '',
    item.color ? `Colore: ${item.color}` : '',
    item.model ? `Modello / Codice: ${item.model}` : '',
    `Categoria: ${getCategoryLabel(item.category)} · Stato: ${statusLabel}`,
    `Link: ${item.url}`,
    item.specs ? `Dettagli:\n${item.specs}` : '',
    item.notes ? `Note: ${item.notes}` : '',
  ].filter(Boolean);

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeHtml = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"/><title>${esc(item.title)}</title></head><body style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f1f5f9"><h1>${esc(item.title)}</h1><p>${resolvedBrand ? `<strong>Marca:</strong> ${esc(resolvedBrand)} · ` : ''}<strong>Negozio:</strong> ${esc(item.store)}</p><p><strong>Prezzo:</strong> ${priceText}</p>${item.room ? `<p><strong>Stanza:</strong> ${esc(roomLabel)}</p>` : ''}${item.color ? `<p><strong>Colore:</strong> ${esc(item.color)}</p>` : ''}${item.model ? `<p><strong>Modello / Codice:</strong> ${esc(item.model)}</p>` : ''}<p><strong>Stato:</strong> ${esc(statusLabel)}</p><p><a href="${item.url}" style="color:#38bdf8">${esc(item.url)}</a></p>${item.specs ? `<h3>Informazioni dal sito</h3><pre style="white-space:pre-wrap;font-family:sans-serif;background:#1e293b;padding:12px;border-radius:8px">${esc(item.specs)}</pre>` : ''}${item.notes ? `<p><strong>Note:</strong> ${esc(item.notes)}</p>` : ''}</body></html>`;

  return {
    title: item.title,
    subtitle: `${resolvedBrand ? `${resolvedBrand} · ` : ''}${item.store} · ${priceText} · ${statusLabel}`,
    cloudUrl: item.url,
    shareText: lines.join('\n'),
    fallbackFileName: `ricerca-${item.store.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`,
    htmlDocument: safeHtml,
  };
}

export function ResearchesView({
  researches,
  researchDocuments,
  readOnly = false,
  onSignIn,
  onAddResearch,
  onUpdateResearch,
  onDeleteResearch,
  onUploadResearchDocument,
  onDeleteResearchDocument,
  onMoveToArticles,
}: ResearchesViewProps) {
  const [linkInput, setLinkInput] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Optional draft preview state (if user clicks "Anteprima / Modifica")
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftStore, setDraftStore] = useState('');
  const [draftBrand, setDraftBrand] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [draftModel, setDraftModel] = useState('');
  const [draftCategory, setDraftCategory] = useState<ProductResearchCategory>('altro');
  const [draftStatus, setDraftStatus] = useState<ProductResearchStatus>('da_valutare');
  const [draftRoom, setDraftRoom] = useState<string>('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftImageUrl, setDraftImageUrl] = useState('');
  const [draftSpecs, setDraftSpecs] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<QueuedDraftAttachment[]>([]);
  const [draftAttachmentType, setDraftAttachmentType] =
    useState<ArticleAttachmentType>('scontrino_fattura');

  // Filters, sorting & layout mode (grid vs list)
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProductResearchStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ProductResearchCategory>('all');
  const [roomFilter, setRoomFilter] = useState<'all' | 'none' | ResearchRoomId>('all');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<ResearchSortField>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewMode, setViewMode] = useState<ResearchViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'list' || saved === 'grid') return saved;
    }
    return 'grid';
  });

  // Card editing / refresh / attachments / delete / share / copy / move feedback
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editStore, setEditStore] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editCategory, setEditCategory] = useState<ProductResearchCategory>('altro');
  const [editStatus, setEditStatus] = useState<ProductResearchStatus>('da_valutare');
  const [editRoom, setEditRoom] = useState<string>('');
  const [editPrice, setEditPrice] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editSpecs, setEditSpecs] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [expandedSpecsIds, setExpandedSpecsIds] = useState<Record<string, boolean>>({});
  const [openAttachmentsIds, setOpenAttachmentsIds] = useState<Record<string, boolean>>({});
  const [cardAttachType, setCardAttachType] = useState<Record<string, ArticleAttachmentType>>({});
  const [uploadingResearchId, setUploadingResearchId] = useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const cardFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetItemRef = useRef<ProductResearchRecord | null>(null);
  const uploadTargetDocTypeRef = useRef<ArticleAttachmentType | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ProductResearchRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [shareItem, setShareItem] = useState<ShareableItemPayload | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [movedArticleIds, setMovedArticleIds] = useState<Record<string, boolean>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [attachedThumbnails, setAttachedThumbnails] = useState<Record<string, string>>({});

  // If a product has no external image URL (or it broke), render any uploaded image attachment as thumbnail
  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    async function hydrateAttachedThumbnails() {
      const next: Record<string, string> = {};
      for (const item of researches) {
        const hasWorkingExternalImg = Boolean(item.imageUrl) && !brokenImages[item.id];
        if (hasWorkingExternalImg) continue;
        const itemDocs = getDocumentsForResearch(researchDocuments, item.id);
        const imgDoc = itemDocs.find(
          (d) => Boolean(d.attachmentKey) && Boolean(d.fileMime?.startsWith('image/'))
        );
        if (!imgDoc?.attachmentKey) continue;
        try {
          const stored = await getVaultFile(imgDoc.attachmentKey);
          if (cancelled || !stored?.blob) continue;
          const objUrl = URL.createObjectURL(stored.blob);
          createdUrls.push(objUrl);
          next[item.id] = objUrl;
        } catch {
          // ignore vault read error for thumbnail
        }
      }
      if (!cancelled) {
        setAttachedThumbnails(next);
      } else {
        createdUrls.forEach((u) => URL.revokeObjectURL(u));
      }
    }

    void hydrateAttachedThumbnails();

    return () => {
      cancelled = true;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [researches, researchDocuments, brokenImages]);

  async function inspectProductLink(
    validUrl: string,
    refresh = false
  ): Promise<{
    url: string;
    title: string;
    store: string;
    category: ProductResearchCategory;
    priceEur?: number;
    imageUrl?: string;
    brand?: string;
    color?: string;
    model?: string;
    specs?: string;
    notes?: string;
    extractedFrom?: 'page-meta' | 'url-slug';
    blockedBySite?: boolean;
  }> {
    try {
      const resp = await fetch('/api/researches/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validUrl, refresh }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          url?: string;
          title?: string;
          store?: string;
          category?: string;
          priceEur?: number;
          imageUrl?: string;
          brand?: string;
          color?: string;
          model?: string;
          specs?: string;
          notes?: string;
          extractedFrom?: 'page-meta' | 'url-slug';
          blockedBySite?: boolean;
        };
        const validCat = CATEGORY_OPTIONS.some((c) => c.value === data.category)
          ? (data.category as ProductResearchCategory)
          : 'altro';
        if (data.url && data.title && data.store) {
          return {
            url: data.url,
            title: data.title,
            store: data.store,
            category: validCat,
            priceEur: typeof data.priceEur === 'number' ? data.priceEur : undefined,
            imageUrl:
              typeof data.imageUrl === 'string' && /^https?:\/\/.+/.test(data.imageUrl)
                ? data.imageUrl
                : undefined,
            brand: data.brand || undefined,
            color: data.color || undefined,
            model: data.model || undefined,
            specs: data.specs || undefined,
            notes: data.notes || undefined,
            extractedFrom: data.extractedFrom,
            blockedBySite: Boolean(data.blockedBySite),
          };
        }
      }
    } catch {
      // Fallback to client URL slug parsing below
    }
    return clientFallbackInspectUrl(validUrl);
  }

  async function handleQuickAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setLinkError(null);
    setLinkNotice(null);
    setFeedback(null);

    const validUrl = normalizeUrlInput(linkInput);
    if (!validUrl) {
      setLinkError(
        'Incolla un link valido (es. https://www.amazon.it/... oppure www.mediaworld.it/...).'
      );
      return;
    }

    setInspecting(true);
    try {
      const inspected = await inspectProductLink(validUrl);
      setSavingNew(true);
      const resolvedBrand = inferProductBrand(inspected);
      await onAddResearch({
        url: inspected.url,
        title: inspected.title,
        store: inspected.store,
        category: inspected.category,
        status: 'da_valutare',
        priceEur: inspected.priceEur,
        imageUrl: inspected.imageUrl,
        brand: resolvedBrand,
        color: inspected.color,
        model: inspected.model,
        specs: inspected.specs,
        notes: inspected.notes,
      });
      setLinkInput('');
      setDraftOpen(false);
      const foundBits = [
        typeof inspected.priceEur === 'number' ? `€ ${inspected.priceEur.toFixed(2)}` : '',
        inspected.color ? `colore ${inspected.color}` : '',
        inspected.imageUrl ? 'immagine' : '',
        inspected.specs ? 'specifiche' : '',
      ].filter(Boolean);
      if (inspected.blockedBySite && inspected.extractedFrom !== 'page-meta') {
        setLinkNotice(
          `Scheda "${inspected.title}" salvata da ${inspected.store} (${getCategoryLabel(inspected.category)}). Il sito blocca la lettura automatica (protezione anti-bot): prezzo e foto non sono accessibili automaticamente, puoi aggiungerli con «Modifica» o allegare un'immagine sulla scheda.`
        );
      } else {
        setFeedback(
          inspected.extractedFrom === 'page-meta' && foundBits.length > 0
            ? `Aggiunto "${inspected.title}" da ${inspected.store} su Firestore (${foundBits.join(', ')}).`
            : `Link di ${inspected.store} salvato su Firestore: puoi rifinire dettagli o allegare file direttamente nella scheda.`
        );
      }
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : 'Errore durante il salvataggio del link prodotto.'
      );
    } finally {
      setInspecting(false);
      setSavingNew(false);
    }
  }

  async function handleOpenDraftFromLink() {
    if (readOnly) return;
    setLinkError(null);
    setLinkNotice(null);
    setFeedback(null);

    const trimmed = linkInput.trim();
    if (!trimmed) {
      setDraftUrl('');
      setDraftTitle('');
      setDraftStore('');
      setDraftBrand('');
      setDraftColor('');
      setDraftModel('');
      setDraftCategory('altro');
      setDraftStatus('da_valutare');
      setDraftRoom('');
      setDraftPrice('');
      setDraftImageUrl('');
      setDraftSpecs('');
      setDraftNotes('');
      setDraftAttachments([]);
      setDraftOpen(true);
      return;
    }

    const validUrl = normalizeUrlInput(trimmed);
    if (!validUrl) {
      setLinkError('Incolla un URL valido prima di aprire l’anteprima.');
      return;
    }

    setInspecting(true);
    try {
      const inspected = await inspectProductLink(validUrl);
      const resolvedBrand = inferProductBrand(inspected) || '';
      setDraftUrl(inspected.url);
      setDraftTitle(inspected.title);
      setDraftStore(inspected.store);
      setDraftBrand(resolvedBrand);
      setDraftColor(inspected.color || '');
      setDraftModel(inspected.model || '');
      setDraftCategory(inspected.category);
      setDraftStatus('da_valutare');
      setDraftRoom('');
      setDraftPrice(typeof inspected.priceEur === 'number' ? String(inspected.priceEur) : '');
      setDraftImageUrl(inspected.imageUrl || '');
      setDraftSpecs(inspected.specs || '');
      setDraftNotes(inspected.notes || '');
      setDraftAttachments([]);
      setDraftOpen(true);
      if (inspected.blockedBySite && inspected.extractedFrom !== 'page-meta') {
        setLinkNotice(
          `${inspected.store} usa una protezione anti-bot: titolo, negozio, codice articolo e dettagli dal link sono già precompilati; completa prezzo/URL foto oppure allega uno screenshot.`
        );
      }
    } finally {
      setInspecting(false);
    }
  }

  function handleQueueDraftFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    setLinkError(null);
    const valid: QueuedDraftAttachment[] = [];
    for (const file of files) {
      if (file.size > MAX_CLOUD_FILE_BYTES) {
        setLinkError(
          `Il file "${file.name}" supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB.`
        );
        continue;
      }
      valid.push({
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        file,
        docType: draftAttachmentType,
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 50),
      });
    }
    if (valid.length > 0) {
      setDraftAttachments((prev) => [...prev, ...valid]);
    }
  }

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setLinkError(null);
    const validUrl = normalizeUrlInput(draftUrl);
    if (!validUrl) {
      setLinkError('Inserisci un link http(s) valido.');
      return;
    }
    const cleanTitle = draftTitle.trim();
    const cleanStore = draftStore.trim();
    if (!cleanTitle || !cleanStore) {
      setLinkError('Titolo prodotto e negozio sono obbligatori.');
      return;
    }
    const parsedPrice = draftPrice.trim()
      ? Number.parseFloat(draftPrice.replace(',', '.'))
      : undefined;
    const validPrice =
      parsedPrice !== undefined && Number.isFinite(parsedPrice) && parsedPrice >= 0
        ? Math.min(1000000, Math.round(parsedPrice * 100) / 100)
        : undefined;
    const validImg =
      draftImageUrl.trim() && /^https?:\/\/.+/.test(draftImageUrl.trim())
        ? draftImageUrl.trim().slice(0, 1000)
        : undefined;

    setSavingNew(true);
    try {
      const createdId = await onAddResearch({
        url: validUrl,
        title: cleanTitle.slice(0, 160),
        store: cleanStore.slice(0, 60),
        category: draftCategory,
        status: draftStatus,
        room: normalizeResearchRoom(draftRoom),
        priceEur: validPrice,
        imageUrl: validImg,
        brand: draftBrand.trim() ? draftBrand.trim().slice(0, 60) : undefined,
        color: draftColor.trim() ? draftColor.trim().slice(0, 60) : undefined,
        model: draftModel.trim() ? draftModel.trim().slice(0, 80) : undefined,
        specs: draftSpecs.trim() ? draftSpecs.trim().slice(0, 800) : undefined,
        notes: draftNotes.trim() ? draftNotes.trim().slice(0, 400) : undefined,
      });

      if (typeof createdId === 'string' && createdId && draftAttachments.length > 0) {
        for (const att of draftAttachments) {
          await onUploadResearchDocument(
            createdId,
            att.docType,
            `${cleanTitle.slice(0, 42)} · ${att.label}`.slice(0, 80),
            draftBrand.trim() || cleanStore,
            att.file
          );
        }
        setOpenAttachmentsIds((prev) => ({ ...prev, [createdId]: true }));
      }

      setLinkInput('');
      setDraftOpen(false);
      setDraftRoom('');
      setDraftAttachments([]);
      setFeedback(
        `Prodotto "${cleanTitle}" salvato su Firestore${
          draftAttachments.length > 0
            ? ` con ${draftAttachments.length} ${draftAttachments.length === 1 ? 'allegato' : 'allegati'}`
            : ''
        }.`
      );
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Salvataggio non riuscito.');
    } finally {
      setSavingNew(false);
    }
  }

  function startEditItem(item: ProductResearchRecord) {
    setEditingId(item.id);
    setEditUrl(item.url);
    setEditTitle(item.title);
    setEditStore(item.store);
    setEditBrand(normalizeBrandName(item.brand) || inferProductBrand(item) || '');
    setEditColor(item.color || '');
    setEditModel(item.model || '');
    setEditCategory(item.category);
    setEditStatus(item.status);
    setEditRoom(normalizeResearchRoom(item.room) || '');
    setEditPrice(typeof item.priceEur === 'number' ? String(item.priceEur) : '');
    setEditImageUrl(item.imageUrl || '');
    setEditSpecs(item.specs || '');
    setEditNotes(item.notes || '');
  }

  async function handleSaveEdit(e: React.FormEvent, item: ProductResearchRecord) {
    e.preventDefault();
    if (readOnly) return;
    const validUrl = normalizeUrlInput(editUrl);
    if (!validUrl || !editTitle.trim() || !editStore.trim()) return;
    const parsedPrice = editPrice.trim()
      ? Number.parseFloat(editPrice.replace(',', '.'))
      : undefined;
    const validPrice =
      parsedPrice !== undefined && Number.isFinite(parsedPrice) && parsedPrice >= 0
        ? Math.min(1000000, Math.round(parsedPrice * 100) / 100)
        : undefined;
    const validImg =
      editImageUrl.trim() && /^https?:\/\/.+/.test(editImageUrl.trim())
        ? editImageUrl.trim().slice(0, 1000)
        : undefined;

    setSavingEdit(true);
    try {
      await onUpdateResearch(item.id, {
        url: validUrl,
        title: editTitle.trim().slice(0, 160),
        store: editStore.trim().slice(0, 60),
        category: editCategory,
        status: editStatus,
        room: normalizeResearchRoom(editRoom),
        priceEur: validPrice,
        imageUrl: validImg,
        brand: editBrand.trim() ? editBrand.trim().slice(0, 60) : undefined,
        color: editColor.trim() ? editColor.trim().slice(0, 60) : undefined,
        model: editModel.trim() ? editModel.trim().slice(0, 80) : undefined,
        specs: editSpecs.trim() ? editSpecs.trim().slice(0, 800) : undefined,
        notes: editNotes.trim() ? editNotes.trim().slice(0, 400) : undefined,
      });
      setEditingId(null);
      setBrokenImages((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRefreshFromSite(item: ProductResearchRecord) {
    if (readOnly) return;
    setRefreshingId(item.id);
    setLinkError(null);
    setLinkNotice(null);
    setFeedback(null);
    try {
      const inspected = await inspectProductLink(item.url, true);
      const nextTitle = inspected.title || item.title;
      const nextStore = inspected.store || item.store;
      const nextSpecs = inspected.specs || item.specs;
      const nextBrand = inferProductBrand({
        title: nextTitle,
        url: item.url,
        store: nextStore,
        brand: inspected.brand || item.brand,
        specs: nextSpecs,
      });
      await onUpdateResearch(item.id, {
        url: item.url,
        title: nextTitle,
        store: nextStore,
        category: inspected.category || item.category,
        status: item.status,
        room: normalizeResearchRoom(item.room),
        priceEur: inspected.priceEur ?? item.priceEur,
        imageUrl: inspected.imageUrl || item.imageUrl,
        brand: nextBrand,
        color: inspected.color || item.color,
        model: inspected.model || item.model,
        specs: nextSpecs,
        notes: item.notes || inspected.notes,
      });
      setBrokenImages((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      if (inspected.blockedBySite && inspected.extractedFrom !== 'page-meta') {
        setLinkNotice(
          `Scheda "${inspected.title || item.title}" aggiornata dai dati del link, ma ${inspected.store || item.store} blocca l'accesso automatico (anti-bot): eventuali foto o prezzi vanno inseriti manualmente o via allegato.`
        );
      } else {
        setFeedback(`Scheda "${inspected.title || item.title}" aggiornata dal sito e salvata su Firestore.`);
      }
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : 'Non è stato possibile aggiornare i dati dal link.'
      );
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleQuickStatusChange(
    item: ProductResearchRecord,
    nextStatus: ProductResearchStatus
  ) {
    if (readOnly) return;
    await onUpdateResearch(item.id, {
      url: item.url,
      title: item.title,
      store: item.store,
      category: item.category,
      status: nextStatus,
      room: normalizeResearchRoom(item.room),
      priceEur: item.priceEur,
      imageUrl: item.imageUrl,
      brand: item.brand,
      color: item.color,
      model: item.model,
      specs: item.specs,
      notes: item.notes,
    });
  }

  async function handleQuickRoomChange(item: ProductResearchRecord, nextRoomRaw: string) {
    if (readOnly) return;
    await onUpdateResearch(item.id, {
      url: item.url,
      title: item.title,
      store: item.store,
      category: item.category,
      status: item.status,
      room: normalizeResearchRoom(nextRoomRaw),
      priceEur: item.priceEur,
      imageUrl: item.imageUrl,
      brand: item.brand,
      color: item.color,
      model: item.model,
      specs: item.specs,
      notes: item.notes,
    });
  }

  function handleChangeViewMode(mode: ResearchViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  }

  function triggerCardFileUpload(
    item: ProductResearchRecord,
    overrideDocType?: ArticleAttachmentType
  ) {
    if (readOnly) return;
    uploadTargetItemRef.current = item;
    uploadTargetDocTypeRef.current = overrideDocType || null;
    cardFileInputRef.current?.click();
  }

  async function handleCardFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const targetItem = uploadTargetItemRef.current;
    const overrideDocType = uploadTargetDocTypeRef.current;
    uploadTargetItemRef.current = null;
    uploadTargetDocTypeRef.current = null;
    if (!file || !targetItem || readOnly) return;

    if (file.size > MAX_CLOUD_FILE_BYTES) {
      setLinkError(
        `Il file "${file.name}" supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB su Firestore.`
      );
      return;
    }

    const docType =
      overrideDocType || cardAttachType[targetItem.id] || 'scontrino_fattura';
    const typeLabel = getAttachmentTypeMeta(docType).label;
    const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 36);
    setUploadingResearchId(targetItem.id);
    setLinkError(null);
    try {
      await onUploadResearchDocument(
        targetItem.id,
        docType,
        `${targetItem.title.slice(0, 36)} · ${baseName || typeLabel}`.slice(0, 80),
        targetItem.brand || targetItem.store,
        file
      );
      setOpenAttachmentsIds((prev) => ({ ...prev, [targetItem.id]: true }));
      setFeedback(`File "${file.name}" allegato a "${targetItem.title}" su Firestore.`);
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : 'Errore durante il caricamento dell’allegato.'
      );
    } finally {
      setUploadingResearchId(null);
    }
  }

  async function handleDownloadDoc(docItem: HomeDocumentRecord) {
    setDownloadingDocId(docItem.id);
    setLinkError(null);
    try {
      await downloadShareableItem(buildDocumentSharePayload(docItem));
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Impossibile scaricare il file allegato.');
    } finally {
      setDownloadingDocId(null);
    }
  }

  async function handleDeleteDoc(docItem: HomeDocumentRecord) {
    if (readOnly) return;
    setDeletingDocId(docItem.id);
    setLinkError(null);
    try {
      await onDeleteResearchDocument(docItem.id);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Impossibile eliminare l’allegato.');
    } finally {
      setDeletingDocId(null);
    }
  }

  async function confirmDeleteResearch() {
    if (!pendingDelete || readOnly) return;
    setDeleting(true);
    try {
      const id = pendingDelete.id;
      if (editingId === id) setEditingId(null);
      await onDeleteResearch(id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCopyUrl(item: ProductResearchRecord) {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopiedId(item.id);
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === item.id ? null : curr));
      }, 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  async function handleMoveItemToArticles(item: ProductResearchRecord) {
    if (!onMoveToArticles || readOnly) return;
    setMovingId(item.id);
    setLinkError(null);
    try {
      await onMoveToArticles(item);
      setMovedArticleIds((prev) => ({ ...prev, [item.id]: true }));
      const attachedCount = getDocumentsForResearch(researchDocuments, item.id).length;
      setFeedback(
        `"${item.title}" aggiunto alla pagina Articoli${
          attachedCount > 0 ? ` con ${attachedCount} file allegati` : ''
        }.`
      );
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : 'Errore durante il trasferimento in Articoli.'
      );
    } finally {
      setMovingId(null);
    }
  }

  const availableStores = useMemo(() => {
    const set = new Set<string>();
    for (const r of researches) {
      if (r.store) set.add(r.store);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it'));
  }, [researches]);

  const { availableBrands, hasUnbranded } = useMemo(() => {
    const set = new Set<string>();
    let missingBrand = false;
    for (const r of researches) {
      const b = inferProductBrand(r);
      if (b) set.add(b);
      else missingBrand = true;
    }
    return {
      availableBrands: Array.from(set).sort((a, b) => a.localeCompare(b, 'it')),
      hasUnbranded: missingBrand,
    };
  }, [researches]);

  const kpis = useMemo(() => {
    let favorites = 0;
    let toBuy = 0;
    let purchased = 0;
    let pendingBudget = 0;
    for (const r of researches) {
      if (r.status === 'preferito') favorites += 1;
      if (r.status === 'da_acquistare') toBuy += 1;
      if (r.status === 'acquistato') purchased += 1;
      if (
        typeof r.priceEur === 'number' &&
        (r.status === 'preferito' || r.status === 'da_acquistare' || r.status === 'da_valutare')
      ) {
        pendingBudget += r.priceEur;
      }
    }
    return {
      total: researches.length,
      favorites,
      toBuy,
      purchased,
      pendingBudget,
    };
  }, [researches]);

  const filteredResearches = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const filtered = researches.filter((item) => {
      const effectiveBrand = inferProductBrand(item);
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (storeFilter !== 'all' && item.store !== storeFilter) return false;
      if (brandFilter === 'none' && effectiveBrand) return false;
      if (
        brandFilter !== 'all' &&
        brandFilter !== 'none' &&
        (effectiveBrand || '').toLowerCase() !== brandFilter.toLowerCase()
      ) {
        return false;
      }
      if (roomFilter === 'none' && normalizeResearchRoom(item.room)) return false;
      if (
        roomFilter !== 'all' &&
        roomFilter !== 'none' &&
        normalizeResearchRoom(item.room) !== roomFilter
      ) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.title,
        effectiveBrand || '',
        item.brand || '',
        item.store,
        item.color || '',
        item.model || '',
        item.specs || '',
        item.notes || '',
        item.url,
        getCategoryLabel(item.category),
        getResearchRoomLabel(item.room),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    const compareTitles = (a: ProductResearchRecord, b: ProductResearchRecord) =>
      a.title.localeCompare(b.title, 'it', { numeric: true, sensitivity: 'base' });

    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case 'price': {
          const aHas = typeof a.priceEur === 'number';
          const bHas = typeof b.priceEur === 'number';
          if (aHas !== bHas) return aHas ? -1 : 1;
          if (!aHas && !bHas) return compareTitles(a, b);
          const diff = (a.priceEur! - b.priceEur!) * dir;
          return diff !== 0 ? diff : compareTitles(a, b);
        }
        case 'brand': {
          const ab = inferProductBrand(a) || '';
          const bb = inferProductBrand(b) || '';
          if (Boolean(ab) !== Boolean(bb)) return ab ? -1 : 1;
          if (!ab && !bb) return compareTitles(a, b);
          const diff = ab.localeCompare(bb, 'it', { sensitivity: 'base' }) * dir;
          return diff !== 0 ? diff : compareTitles(a, b);
        }
        case 'store': {
          const diff = a.store.localeCompare(b.store, 'it', { sensitivity: 'base' }) * dir;
          return diff !== 0 ? diff : compareTitles(a, b);
        }
        case 'room': {
          const aRoom = normalizeResearchRoom(a.room);
          const bRoom = normalizeResearchRoom(b.room);
          if (Boolean(aRoom) !== Boolean(bRoom)) return aRoom ? -1 : 1;
          if (!aRoom && !bRoom) return compareTitles(a, b);
          const diff =
            getResearchRoomLabel(aRoom).localeCompare(getResearchRoomLabel(bRoom), 'it') * dir;
          return diff !== 0 ? diff : compareTitles(a, b);
        }
        case 'status': {
          const ai = STATUS_OPTIONS.findIndex((s) => s.value === a.status);
          const bi = STATUS_OPTIONS.findIndex((s) => s.value === b.status);
          const diff = (ai - bi) * dir;
          return diff !== 0 ? diff : compareTitles(a, b);
        }
        case 'recent': {
          const diff = ((a.createdAtMs ?? 0) - (b.createdAtMs ?? 0)) * dir;
          return diff !== 0 ? diff : compareTitles(a, b);
        }
        case 'title':
        default:
          return compareTitles(a, b) * dir;
      }
    });
  }, [
    researches,
    searchText,
    statusFilter,
    categoryFilter,
    brandFilter,
    storeFilter,
    roomFilter,
    sortField,
    sortDirection,
  ]);

  return (
    <div className="space-y-6">
      {/* Hidden input for uploading attachments directly onto any card */}
      <input
        ref={cardFileInputRef}
        type="file"
        accept="application/pdf,.pdf,image/*,.doc,.docx,.txt"
        onChange={(e) => void handleCardFileSelected(e)}
        className="hidden"
      />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-sky-400" />
            Ricerche Prodotti &amp; Link Online
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Incolla un link da Amazon, MediaWorld, Electrolux, IKEA o qualsiasi negozio: estrae foto, prezzo, colore, modello e specifiche tecniche del sito e ti permette di allegare PDF, fatture o immagini su Firestore.
          </p>
        </div>
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Ricerche"
        unlockedFeatures={[
          'Incolla link per ottenere scheda completa con foto, prezzo, colore e specifiche',
          'Allega file PDF, ricevute, garanzie o foto direttamente a ciascun prodotto',
          'Sposta con 1 click prodotto e allegati nella pagina Articoli di casa',
        ]}
      />

      {/* Hero URL Paste Searchbar */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5">
        <form onSubmit={handleQuickAddSubmit} className="space-y-3">
          <label
            htmlFor="research-url-input"
            className="block text-xs font-semibold text-slate-200 flex items-center gap-1.5"
          >
            <Link2 className="w-3.5 h-3.5 text-sky-400" />
            Incolla il link di un prodotto da aggiungere alle ricerche
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="research-url-input"
                type="text"
                disabled={readOnly || inspecting || savingNew}
                value={linkInput}
                onChange={(e) => {
                  setLinkInput(e.target.value);
                  if (linkError) setLinkError(null);
                }}
                placeholder={
                  readOnly
                    ? 'Accedi con Google per incollare nuovi link prodotto...'
                    : 'https://www.amazon.it/dp/... oppure link MediaWorld, Electrolux, IKEA...'
                }
                className="w-full pl-10 pr-9 py-2.5 text-sm text-slate-100 bg-slate-950 border border-slate-700 rounded-xl placeholder:text-slate-500 focus:outline-none focus:border-sky-400 disabled:opacity-60"
              />
              {linkInput && !readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setLinkInput('');
                    setLinkError(null);
                  }}
                  aria-label="Svuota link"
                  className="p-1 text-slate-500 hover:text-slate-200 absolute right-2.5 top-1/2 -translate-y-1/2"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {!readOnly && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={inspecting || savingNew}
                  onClick={() => void handleOpenDraftFromLink()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5 text-sky-400" />
                  <span>{linkInput.trim() ? 'Anteprima / Modifica' : 'Inserimento manuale'}</span>
                </button>
                <button
                  type="submit"
                  disabled={!linkInput.trim() || inspecting || savingNew}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {inspecting || savingNew ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{inspecting && !savingNew ? 'Estraggo dati...' : 'Salvo...'}</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>Aggiungi link</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </form>

        {linkError && (
          <div className="bg-rose-500/10 border border-rose-500/35 rounded-lg px-3 py-2 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{linkError}</span>
          </div>
        )}

        {linkNotice && (
          <div className="bg-amber-500/10 border border-amber-500/35 rounded-lg px-3 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{linkNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setLinkNotice(null)}
              className="text-amber-300/80 hover:text-amber-100 p-0.5 shrink-0"
              aria-label="Chiudi avviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {feedback && (
          <div className="bg-emerald-500/10 border border-emerald-500/35 rounded-lg px-3 py-2 text-xs text-emerald-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{feedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-emerald-300/80 hover:text-emerald-100 p-0.5"
              aria-label="Chiudi avviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Optional Draft Review Form */}
        {draftOpen && !readOnly && (
          <form
            onSubmit={handleSaveDraft}
            className="mt-3 bg-slate-950/90 border border-sky-500/30 rounded-xl p-4 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Anteprima &amp; Dettagli prodotto prima del salvataggio
              </span>
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {draftImageUrl && /^https?:\/\/.+/.test(draftImageUrl) && (
              <div className="flex items-center gap-3 p-2.5 bg-slate-900/80 border border-slate-800 rounded-lg">
                <div className="w-16 h-16 rounded-lg bg-white/95 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center p-1">
                  <img
                    src={draftImageUrl}
                    alt={draftTitle || 'Anteprima'}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-200">
                    {draftTitle || 'Anteprima immagine trovata dal sito'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
                    <span>{draftPrice ? `€ ${draftPrice}` : 'Prezzo non rilevato'}</span>
                    {draftColor && (
                      <span className="inline-flex items-center gap-1" title={`Colore: ${draftColor}`}>
                        <ColorSwatchDot color={draftColor} size="sm" />
                        <span>{draftColor}</span>
                      </span>
                    )}
                    {draftBrand && <span>· {draftBrand}</span>}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="sm:col-span-2 lg:col-span-2 space-y-1">
                <label className="block text-slate-400">Titolo prodotto *</label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Es. Apple Custodia MagSafe in tessuto TechWoven..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Prezzo (€ opzionale)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1000000"
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(e.target.value)}
                  placeholder="Es. 58.00"
                  className="w-full px-3 py-2 font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-2 space-y-1">
                <label className="block text-slate-400">Link URL prodotto *</label>
                <input
                  type="text"
                  required
                  maxLength={1000}
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Negozio / Sito *</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={draftStore}
                  onChange={(e) => setDraftStore(e.target.value)}
                  placeholder="Es. Amazon, MediaWorld"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Marca</label>
                <input
                  type="text"
                  maxLength={60}
                  value={draftBrand}
                  onChange={(e) => setDraftBrand(e.target.value)}
                  placeholder="Es. Apple, Electrolux..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Modello / Codice / ASIN</label>
                <input
                  type="text"
                  maxLength={80}
                  value={draftModel}
                  onChange={(e) => setDraftModel(e.target.value)}
                  placeholder="Es. B0HJ9QMTYM"
                  className="w-full px-3 py-2 font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Stanza di casa</label>
                <select
                  value={draftRoom}
                  onChange={(e) => setDraftRoom(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                >
                  <option value="">Nessuna stanza</option>
                  {RESEARCH_ROOMS.map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      {rm.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Categoria</label>
                <select
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value as ProductResearchCategory)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Stato</label>
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value as ProductResearchStatus)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">URL Immagine</label>
                <input
                  type="text"
                  maxLength={1000}
                  value={draftImageUrl}
                  onChange={(e) => setDraftImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                <label className="block text-slate-400">Colore / Finitura</label>
                <ColorFieldInput value={draftColor} onChange={setDraftColor} />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                <label className="block text-slate-400">
                  Specifiche &amp; Info utili dal sito (una per riga)
                </label>
                <textarea
                  rows={3}
                  maxLength={800}
                  value={draftSpecs}
                  onChange={(e) => setDraftSpecs(e.target.value)}
                  placeholder="Es. Materiale: TechWoven&#10;Modelli compatibili: iPhone 18 Pro Max&#10;Dimensioni: 19,8 x 9,6 x 2,1 cm"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500 resize-y"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                <label className="block text-slate-400">Note personali (opzionale)</label>
                <input
                  type="text"
                  maxLength={400}
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="Es. misure, confronto con altro modello, codice sconto..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Draft Attachments Queue */}
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-300 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-sky-400" />
                  Allega file a questo prodotto (PDF, ricevute, foto)
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={draftAttachmentType}
                    onChange={(e) => setDraftAttachmentType(e.target.value as ArticleAttachmentType)}
                    className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-200 [color-scheme:dark]"
                  >
                    {ATTACHMENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg cursor-pointer transition-colors">
                    <Upload className="w-3 h-3 text-sky-400" />
                    <span>Scegli file</span>
                    <input
                      type="file"
                      multiple
                      accept="application/pdf,.pdf,image/*,.doc,.docx,.txt"
                      onChange={handleQueueDraftFiles}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              {draftAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {draftAttachments.map((att) => (
                    <span
                      key={att.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-200"
                    >
                      <FileText className="w-3 h-3 text-sky-400" />
                      <span className="truncate max-w-[160px]">{att.file.name}</span>
                      <span className="text-slate-500">({formatFileSize(att.file.size)})</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftAttachments((prev) => prev.filter((x) => x.id !== att.id))
                        }
                        className="text-slate-400 hover:text-rose-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="px-3 py-1.5 text-slate-400 hover:text-slate-100"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={savingNew}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingNew ? 'Salvataggio...' : 'Salva prodotto'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Link salvati</div>
          <div className="text-xl font-bold font-mono text-slate-100 mt-1 tabular-nums">
            {kpis.total}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Heart className="w-3 h-3 text-fuchsia-400" />
            Preferiti &amp; Da acquistare
          </div>
          <div className="text-xl font-bold font-mono text-sky-300 mt-1 tabular-nums">
            {kpis.favorites + kpis.toBuy}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Spesa stimata attiva</div>
          <div className="text-xl font-bold font-mono text-amber-300 mt-1 tabular-nums">
            € {kpis.pendingBudget.toFixed(2)}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <BookmarkCheck className="w-3 h-3 text-emerald-400" />
            Acquistati
          </div>
          <div className="text-xl font-bold font-mono text-emerald-300 mt-1 tabular-nums">
            {kpis.purchased}
          </div>
        </div>
      </div>

      {/* Filters, Room & View Mode Switcher */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Cerca nei prodotti salvati (nome, marca, negozio, stanza, colore, modello...)"
              className="w-full pl-8 pr-3 py-1.5 text-xs text-slate-100 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-sky-500"
            />
          </div>

          <select
            value={roomFilter}
            onChange={(e) =>
              setRoomFilter(e.target.value as 'all' | 'none' | ResearchRoomId)
            }
            aria-label="Filtra per stanza"
            className="px-2.5 py-1.5 text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
          >
            <option value="all">Tutte le stanze</option>
            <option value="none">Nessuna stanza</option>
            {RESEARCH_ROOMS.map((rm) => (
              <option key={rm.id} value={rm.id}>
                {rm.label}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as 'all' | ProductResearchCategory)
            }
            aria-label="Filtra per categoria"
            className="px-2.5 py-1.5 text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
          >
            <option value="all">Tutte le categorie</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            aria-label="Filtra per marca"
            className="px-2.5 py-1.5 text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
          >
            <option value="all">Tutte le marche</option>
            {hasUnbranded && <option value="none">Senza marca</option>}
            {availableBrands.map((br) => (
              <option key={br} value={br}>
                {br}
              </option>
            ))}
          </select>

          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            aria-label="Filtra per negozio"
            className="px-2.5 py-1.5 text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
          >
            <option value="all">Tutti i negozi</option>
            {availableStores.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center gap-1 shrink-0">
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as ResearchSortField)}
              aria-label="Ordina articoli per"
              className="px-2.5 py-1.5 text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500"
            >
              <option value="title">Ordina: Nome</option>
              <option value="price">Ordina: Prezzo</option>
              <option value="brand">Ordina: Marca</option>
              <option value="store">Ordina: Negozio</option>
              <option value="room">Ordina: Stanza</option>
              <option value="status">Ordina: Stato</option>
              <option value="recent">Ordina: Data aggiunta</option>
            </select>
            <button
              type="button"
              onClick={() =>
                setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
              }
              title={
                sortDirection === 'asc'
                  ? 'Ordine crescente — clicca per invertire in decrescente'
                  : 'Ordine decrescente — clicca per invertire in crescente'
              }
              aria-label="Inverti ordine"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors whitespace-nowrap"
            >
              {sortDirection === 'asc' ? (
                <>
                  <ArrowUpNarrowWide className="w-3.5 h-3.5 text-sky-400" />
                  <span>Crescente</span>
                </>
              ) : (
                <>
                  <ArrowDownWideNarrow className="w-3.5 h-3.5 text-sky-400" />
                  <span>Decrescente</span>
                </>
              )}
            </button>
          </div>

          {/* Grid vs List View Toggle */}
          <div
            role="group"
            aria-label="Modalità visualizzazione"
            className="inline-flex items-center p-0.5 bg-slate-950 border border-slate-800 rounded-lg shrink-0"
          >
            <button
              type="button"
              onClick={() => handleChangeViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'grid'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Griglia</span>
            </button>
            <button
              type="button"
              onClick={() => handleChangeViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Elenco</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-1">
            <Filter className="w-3 h-3" />
            Stato:
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
              statusFilter === 'all'
                ? 'bg-sky-500 text-slate-950 border-sky-400'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-100'
            }`}
          >
            Tutti ({researches.length})
          </button>
          {STATUS_OPTIONS.map((st) => {
            const count = researches.filter((r) => r.status === st.value).length;
            return (
              <button
                key={st.value}
                type="button"
                onClick={() => setStatusFilter(st.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                  statusFilter === st.value
                    ? 'bg-sky-500 text-slate-950 border-sky-400'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-100'
                }`}
              >
                {st.label} ({count})
              </button>
            );
          })}
        </div>
      </section>

      {/* Product Grid / List */}
      {filteredResearches.length === 0 ? (
        <div className="bg-slate-900 border border-dashed border-slate-800 rounded-xl p-8 text-center space-y-2">
          <ShoppingBag className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-medium text-slate-300">
            {researches.length === 0
              ? 'Nessun prodotto salvato nelle ricerche'
              : 'Nessun prodotto corrisponde ai filtri selezionati'}
          </p>
          <p className="text-xs text-slate-500">
            {researches.length === 0
              ? 'Incolla un link prodotto nella barra in alto per aggiungerlo subito a questa pagina.'
              : 'Prova a cambiare ricerca, stanza, negozio o stato.'}
          </p>
        </div>
      ) : (
        <div
          className={
            viewMode === 'list'
              ? 'flex flex-col gap-4'
              : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-stretch'
          }
        >
          {filteredResearches.map((item) => {
            const statusMeta = getStatusMeta(item.status);
            const isEditing = editingId === item.id;
            const imageBroken = Boolean(brokenImages[item.id]);
            const itemDocs = getDocumentsForResearch(researchDocuments, item.id);
            const specEntries = parseSpecLines(item.specs);
            const isSpecsExpanded = Boolean(expandedSpecsIds[item.id]);
            const gridDefaultVisibleCount = 5;
            const visibleSpecs =
              viewMode === 'list' || isSpecsExpanded
                ? specEntries
                : specEntries.slice(0, gridDefaultVisibleCount);
            const isAttachOpen = Boolean(openAttachmentsIds[item.id]) || itemDocs.length > 0;
            const selectedAttachType = cardAttachType[item.id] || 'scontrino_fattura';
            const isUploadingHere = uploadingResearchId === item.id;
            const isRefreshingHere = refreshingId === item.id;
            const currentRoomId = normalizeResearchRoom(item.room) || '';
            const currentRoomLabel = getResearchRoomLabel(item.room);

            if (isEditing && !readOnly) {
              return (
                <form
                  key={item.id}
                  onSubmit={(e) => void handleSaveEdit(e, item)}
                  className="bg-slate-900 border border-sky-500/50 rounded-xl p-4 space-y-2.5 text-xs"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-semibold text-sky-300">Modifica prodotto</span>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-slate-400 hover:text-slate-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Titolo *</label>
                    <input
                      type="text"
                      required
                      maxLength={160}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Link URL *</label>
                    <input
                      type="text"
                      required
                      maxLength={1000}
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-slate-400">Negozio *</label>
                      <input
                        type="text"
                        required
                        maxLength={60}
                        value={editStore}
                        onChange={(e) => setEditStore(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">Prezzo (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1000000"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">Marca</label>
                      <input
                        type="text"
                        maxLength={60}
                        value={editBrand}
                        onChange={(e) => setEditBrand(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">Modello / Codice</label>
                      <input
                        type="text"
                        maxLength={80}
                        value={editModel}
                        onChange={(e) => setEditModel(e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">Stanza di casa</label>
                      <select
                        value={editRoom}
                        onChange={(e) => setEditRoom(e.target.value)}
                        className="w-full px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
                      >
                        <option value="">Nessuna stanza</option>
                        {RESEARCH_ROOMS.map((rm) => (
                          <option key={rm.id} value={rm.id}>
                            {rm.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">Categoria</label>
                      <select
                        value={editCategory}
                        onChange={(e) =>
                          setEditCategory(e.target.value as ProductResearchCategory)
                        }
                        className="w-full px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">Stato</label>
                      <select
                        value={editStatus}
                        onChange={(e) =>
                          setEditStatus(e.target.value as ProductResearchStatus)
                        }
                        className="w-full px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">URL Immagine</label>
                      <input
                        type="text"
                        maxLength={1000}
                        value={editImageUrl}
                        onChange={(e) => setEditImageUrl(e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Colore (scegli o scrivi)</label>
                    <ColorFieldInput value={editColor} onChange={setEditColor} compact />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Specifiche &amp; Info dal sito</label>
                    <textarea
                      rows={3}
                      maxLength={800}
                      value={editSpecs}
                      onChange={(e) => setEditSpecs(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 resize-y"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Note personali / Descrizione</label>
                    <textarea
                      rows={2}
                      maxLength={400}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 resize-y"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-2.5 py-1 text-slate-400 hover:text-slate-100"
                    >
                      Annulla
                    </button>
                    <button
                      type="submit"
                      disabled={savingEdit}
                      className="px-3 py-1 font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg disabled:opacity-50"
                    >
                      {savingEdit ? 'Salvo...' : 'Salva'}
                    </button>
                  </div>
                </form>
              );
            }

            const hasExternal = Boolean(item.imageUrl) && !imageBroken;
            const displayThumb = hasExternal
              ? item.imageUrl!
              : attachedThumbnails[item.id] || '';
            const effectiveBrand = inferProductBrand(item);
            const hasUniqueNotes =
              Boolean(item.notes) &&
              (!item.specs || !item.specs.includes(item.notes!.slice(0, 40)));
            const hasExtraDetails =
              viewMode === 'grid' && specEntries.length > gridDefaultVisibleCount;

            return (
              <article
                key={item.id}
                className={
                  viewMode === 'list'
                    ? 'bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl overflow-hidden flex flex-col sm:flex-row transition-colors'
                    : 'bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl overflow-hidden flex flex-col transition-colors'
                }
              >
                {/* Product Media Showcase */}
                {displayThumb ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className={
                      viewMode === 'list'
                        ? 'group relative h-48 sm:h-auto sm:w-52 md:w-60 sm:min-h-[12rem] bg-white border-b sm:border-b-0 sm:border-r border-slate-800/80 flex items-center justify-center p-4 overflow-hidden shrink-0'
                        : 'group relative h-56 w-full bg-white border-b border-slate-800/80 flex items-center justify-center p-5 overflow-hidden shrink-0'
                    }
                  >
                    <img
                      src={displayThumb}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      onError={() => {
                        if (hasExternal) {
                          setBrokenImages((prev) => ({ ...prev, [item.id]: true }));
                        }
                      }}
                      className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  </a>
                ) : (
                  <div
                    className={
                      viewMode === 'list'
                        ? 'relative h-44 sm:h-auto sm:w-52 md:w-60 sm:min-h-[12rem] bg-gradient-to-b from-slate-800/40 to-slate-950/90 border-b sm:border-b-0 sm:border-r border-slate-800 flex flex-col items-center justify-center gap-2.5 p-4 text-center shrink-0'
                        : 'relative h-56 w-full bg-gradient-to-b from-slate-800/40 to-slate-950/90 border-b border-slate-800 flex flex-col items-center justify-center gap-2.5 p-5 text-center shrink-0'
                    }
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex flex-col items-center gap-1.5 text-slate-400 hover:text-sky-300 transition-colors"
                    >
                      {item.imageUrl ? (
                        <ImageOff className="w-8 h-8 text-slate-500" />
                      ) : (
                        <ShoppingBag className="w-8 h-8 text-slate-500" />
                      )}
                      <span className="text-xs font-semibold text-slate-300">{item.store}</span>
                      <span className="text-[11px] text-slate-500">
                        {item.imageUrl
                          ? 'Immagine non disponibile dal sito'
                          : 'Anteprima foto non disponibile'}
                      </span>
                    </a>
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={isUploadingHere}
                        onClick={() => triggerCardFileUpload(item, 'targhetta_pnc')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-sky-300 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Upload className="w-3 h-3" />
                        <span>{isUploadingHere ? 'Carico...' : 'Carica foto'}</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col gap-3 min-w-0">
                  {/* 1. Brand · Store · Category + Room */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-400">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                      {effectiveBrand && (
                        <span
                          className="inline-flex items-center gap-1 text-sky-300 font-semibold"
                          title={`Marca: ${effectiveBrand}`}
                        >
                          <Tag className="w-3 h-3 shrink-0" />
                          <span>{effectiveBrand}</span>
                        </span>
                      )}
                      {(!effectiveBrand ||
                        effectiveBrand.toLowerCase() !== item.store.toLowerCase()) && (
                        <span
                          className="inline-flex items-center gap-1 text-slate-200 font-medium"
                          title={`Negozio: ${item.store}`}
                        >
                          <Store className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{item.store}</span>
                        </span>
                      )}
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>{getCategoryLabel(item.category)}</span>
                    </div>

                    {readOnly ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-300 shrink-0">
                        <Home className="w-3 h-3 text-sky-400" />
                        <span>{currentRoomLabel}</span>
                      </span>
                    ) : (
                      <label className="inline-flex items-center gap-1 text-[11px] text-slate-300 shrink-0">
                        <Home className="w-3 h-3 text-sky-400 shrink-0" />
                        <select
                          aria-label={`Stanza per ${item.title}`}
                          value={currentRoomId}
                          onChange={(e) => void handleQuickRoomChange(item, e.target.value)}
                          className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-md px-2 py-0.5 text-[11px] text-slate-200 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                        >
                          <option value="">Nessuna stanza</option>
                          {RESEARCH_ROOMS.map((rm) => (
                            <option key={rm.id} value={rm.id}>
                              {rm.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  {/* 2. Full Product Title / Description (no ugly ellipsis truncation) */}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[15px] font-semibold text-slate-100 hover:text-sky-300 leading-snug break-words"
                  >
                    {item.title}
                  </a>

                  {/* 3. Color Swatch Dot + Model Code */}
                  {(item.color || item.model) && (
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
                      {item.color && (
                        <span
                          className="inline-flex items-center gap-1.5 text-slate-200 font-medium"
                          title={`Colore: ${item.color}`}
                        >
                          <ColorSwatchDot color={item.color} size="md" />
                          <span>{item.color}</span>
                        </span>
                      )}
                      {item.color && item.model && (
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                      )}
                      {item.model && (
                        <span className="font-mono text-[11px] text-slate-400">
                          Cod. {item.model}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 4. Aligned Price + Status Row */}
                  <div className="flex items-center justify-between gap-2 py-2.5 border-y border-slate-800/80">
                    {typeof item.priceEur === 'number' ? (
                      <span className="font-mono text-lg font-bold text-emerald-300 tabular-nums">
                        € {item.priceEur.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Prezzo non rilevato</span>
                    )}

                    {readOnly ? (
                      <span
                        className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border whitespace-nowrap ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                    ) : (
                      <select
                        value={item.status}
                        onChange={(e) =>
                          void handleQuickStatusChange(
                            item,
                            e.target.value as ProductResearchStatus
                          )
                        }
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border [color-scheme:dark] focus:outline-none ${statusMeta.badgeClass}`}
                      >
                        {STATUS_OPTIONS.map((st) => (
                          <option
                            key={st.value}
                            value={st.value}
                            className="bg-slate-900 text-slate-100"
                          >
                            {st.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* 5. Full Readable Specifications & Notes */}
                  {(specEntries.length > 0 || hasUniqueNotes) && (
                    <div className="space-y-2">
                      {hasUniqueNotes && (
                        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line break-words">
                          {item.notes}
                        </p>
                      )}

                      {visibleSpecs.length > 0 && (
                        <ul
                          className={
                            viewMode === 'list'
                              ? 'grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-300 leading-relaxed'
                              : 'space-y-1 text-[11px] text-slate-300 leading-relaxed'
                          }
                        >
                          {visibleSpecs
                            .filter((entry) => {
                              const isColorSpec =
                                entry.label?.toLowerCase() === 'colore' ||
                                entry.label?.toLowerCase() === 'color';
                              if (
                                isColorSpec &&
                                item.color &&
                                entry.value.trim().toLowerCase() ===
                                  item.color.trim().toLowerCase()
                              ) {
                                return false;
                              }
                              return true;
                            })
                            .map((entry, idx) => {
                              const isColorSpec =
                                entry.label?.toLowerCase() === 'colore' ||
                                entry.label?.toLowerCase() === 'color';
                              return (
                                <li key={idx} className="flex items-start gap-1.5">
                                  <span className="text-sky-400 shrink-0">·</span>
                                  <span className="min-w-0 break-words">
                                    {isColorSpec ? (
                                      <span
                                        className="inline-flex items-center gap-1.5"
                                        title={`Colore: ${entry.value}`}
                                      >
                                        <ColorSwatchDot color={entry.value} size="sm" />
                                        <span className="text-slate-200 font-medium">
                                          {entry.value}
                                        </span>
                                      </span>
                                    ) : entry.label ? (
                                      <>
                                        <span className="text-slate-400">{entry.label}: </span>
                                        <span className="text-slate-200 font-medium">
                                          {entry.value}
                                        </span>
                                      </>
                                    ) : (
                                      <span>{entry.value}</span>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                        </ul>
                      )}

                      {hasExtraDetails && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSpecsIds((prev) => ({
                              ...prev,
                              [item.id]: !prev[item.id],
                            }))
                          }
                          className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium"
                        >
                          {isSpecsExpanded ? (
                            <>
                              <ChevronUp className="w-3 h-3" />
                              Mostra meno
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3" />
                              Vedi tutti i dettagli ({specEntries.length})
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* 6. Bottom-pinned Attachments & Actions */}
                  <div className="mt-auto space-y-2.5 pt-1">
                    {(isAttachOpen || !readOnly) && (
                      <div className="border-t border-slate-800/70 pt-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenAttachmentsIds((prev) => ({
                                ...prev,
                                [item.id]: !isAttachOpen,
                              }))
                            }
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300 hover:text-sky-300"
                          >
                            <Paperclip className="w-3.5 h-3.5 text-sky-400" />
                            <span>Allegati ({itemDocs.length})</span>
                          </button>

                          {!readOnly && (
                            <button
                              type="button"
                              disabled={isUploadingHere}
                              onClick={() => triggerCardFileUpload(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-md transition-colors disabled:opacity-50"
                            >
                              {isUploadingHere ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Upload className="w-3 h-3" />
                              )}
                              <span>{isUploadingHere ? 'Carico...' : 'Allega file'}</span>
                            </button>
                          )}
                        </div>

                        {!readOnly && isAttachOpen && (
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-slate-400 shrink-0">Tipo allegato:</span>
                            <select
                              value={selectedAttachType}
                              onChange={(e) =>
                                setCardAttachType((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value as ArticleAttachmentType,
                                }))
                              }
                              className="flex-1 min-w-0 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 [color-scheme:dark]"
                            >
                              {ATTACHMENT_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {itemDocs.length > 0 && (
                          <div className="space-y-1.5">
                            {itemDocs.map((docItem) => {
                              const parsedRef = parseResearchDocumentRef(docItem.referenceCode);
                              const docMeta = getAttachmentTypeMeta(parsedRef?.docType);
                              const isImg = docItem.fileMime?.startsWith('image/');
                              return (
                                <div
                                  key={docItem.id}
                                  className="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800 rounded-md px-2 py-1.5 text-[11px]"
                                >
                                  <div className="min-w-0 flex items-center gap-1.5">
                                    {isImg ? (
                                      <ImageIcon className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                                    ) : (
                                      <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <div
                                        className="text-slate-200 font-medium truncate"
                                        title={docItem.fileName || docItem.title}
                                      >
                                        {docItem.fileName || docItem.title}
                                      </div>
                                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                        <span
                                          className={`px-1.5 py-0.2 rounded border ${docMeta.badgeClass}`}
                                        >
                                          {docMeta.label}
                                        </span>
                                        {docItem.fileSize ? (
                                          <span>{formatFileSize(docItem.fileSize)}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      disabled={downloadingDocId === docItem.id}
                                      onClick={() => void handleDownloadDoc(docItem)}
                                      title="Scarica allegato"
                                      className="p-1 text-emerald-300 hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                                    >
                                      {downloadingDocId === docItem.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Download className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    {!readOnly && (
                                      <button
                                        type="button"
                                        disabled={deletingDocId === docItem.id}
                                        onClick={() => void handleDeleteDoc(docItem)}
                                        title="Rimuovi allegato"
                                        className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Apri pagina
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleCopyUrl(item)}
                          title="Copia link"
                          className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {copiedId === item.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedId === item.id ? 'Copiato' : 'Copia'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShareItem(buildResearchSharePayload(item))}
                          title="Condividi prodotto"
                          className="p-1.5 text-slate-400 hover:text-sky-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {!readOnly && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isRefreshingHere}
                            onClick={() => void handleRefreshFromSite(item)}
                            title="Ri-analizza il link per aggiornare foto, prezzo, colore e dettagli"
                            className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                isRefreshingHere ? 'animate-spin text-sky-400' : ''
                              }`}
                            />
                          </button>
                          {onMoveToArticles && (
                            <button
                              type="button"
                              disabled={movingId === item.id || movedArticleIds[item.id]}
                              onClick={() => void handleMoveItemToArticles(item)}
                              title="Copia questo prodotto (con dettagli e allegati) nella pagina Articoli di casa"
                              className={`inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap ${
                                movedArticleIds[item.id]
                                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                  : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40'
                              }`}
                            >
                              <PackagePlus className="w-3 h-3" />
                              <span>
                                {movedArticleIds[item.id] ? 'In Articoli' : 'Ad Articoli'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startEditItem(item)}
                            aria-label="Modifica prodotto"
                            title="Modifica"
                            className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(item)}
                            aria-label="Elimina prodotto"
                            title="Elimina"
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Eliminare questa ricerca?
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Vuoi davvero rimuovere{' '}
                  <span className="font-semibold text-slate-100">
                    {pendingDelete.title}
                  </span>{' '}
                  ({pendingDelete.store}) e gli eventuali file allegati da Firestore?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDeleteResearch()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition-colors"
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
