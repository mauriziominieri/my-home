import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileText,
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
  RotateCcw,
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
  findColorImageUrl,
  findColorNameForHex,
  findSizePrice,
  getResearchRoomLabel,
  inferProductBrand,
  inferResearchRoom,
  normalizeBrandName,
  normalizeResearchRoom,
  replaceColorInTitle,
  replaceSizeInTitle,
  RESEARCH_ROOMS,
  ResearchRoomId,
  resolveColorHex,
  sanitizeColorImagesMap,
  sanitizeSizePricesMap,
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
    value: 'da_acquistare',
    label: 'Da acquistare',
    badgeClass: 'bg-sky-500/15 text-sky-200 border-sky-400/40',
  },
  {
    value: 'acquistato',
    label: 'Acquistato',
    badgeClass: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40',
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
const GROUP_BY_ROOM_STORAGE_KEY = 'myhome_researches_group_by_room';
const SIZE_PRICES_CACHE_STORAGE_KEY = 'myhome_researches_size_prices_v1';

function buildSizePriceCacheKey(rawUrl?: string): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  const asinMatch = trimmed.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (asinMatch?.[1]) {
    try {
      const host = new URL(trimmed).hostname.toLowerCase();
      if (host.includes('amazon.')) return `${host}/dp/${asinMatch[1].toUpperCase()}`;
    } catch {
      // ignore URL parse error
    }
  }
  return trimmed.split('#')[0].slice(0, 300);
}

function readCachedSizePrices(url?: string): Record<string, number> | undefined {
  if (typeof window === 'undefined' || !url) return undefined;
  const key = buildSizePriceCacheKey(url);
  if (!key) return undefined;
  try {
    const raw = window.localStorage.getItem(SIZE_PRICES_CACHE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return sanitizeSizePricesMap(parsed?.[key]);
  } catch {
    return undefined;
  }
}

function writeCachedSizePrices(url: string | undefined, sizePrices: Record<string, number> | undefined) {
  if (typeof window === 'undefined' || !url || !sizePrices) return;
  const clean = sanitizeSizePricesMap(sizePrices);
  const key = buildSizePriceCacheKey(url);
  if (!clean || !key) return;
  try {
    const raw = window.localStorage.getItem(SIZE_PRICES_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, Record<string, number>>) : {};
    const next: Record<string, Record<string, number>> = { ...parsed, [key]: clean };
    const keys = Object.keys(next);
    if (keys.length > 60) {
      for (const oldKey of keys.slice(0, keys.length - 60)) {
        delete next[oldKey];
      }
    }
    window.localStorage.setItem(SIZE_PRICES_CACHE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
}

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

function parseOptionalPriceInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(1000000, Math.round(parsed * 100) / 100);
}

function formatEuroIt(value: number): string {
  return `${value.toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function ColorFieldInput({
  value,
  onChange,
  onCommit,
  options,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit?: (next: string, prev: string) => void;
  options?: string[];
  compact?: boolean;
}) {
  const focusValueRef = useRef(value);
  const pickerHex = resolveColorHex(value || '#94a3b8');
  const cleanOptions = Array.isArray(options)
    ? options.map((o) => o.trim()).filter(Boolean)
    : [];

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
              const prev = value;
              const chosen = e.target.value;
              const matchedName = findColorNameForHex(chosen);
              const nextVal = matchedName || chosen;
              onChange(nextVal);
              onCommit?.(nextVal, prev);
            }}
            aria-label="Seleziona colore dalla tavolozza"
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>
        <input
          type="text"
          maxLength={60}
          value={value}
          onFocus={() => {
            focusValueRef.current = value;
          }}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const nextVal = e.target.value.trim();
            if (nextVal && nextVal.toLowerCase() !== focusValueRef.current.trim().toLowerCase()) {
              onCommit?.(nextVal, focusValueRef.current);
              focusValueRef.current = nextVal;
            }
          }}
          placeholder="Es. Borgogna, Argento, Glacier, Nero..."
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
      {cleanOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {cleanOptions.map((opt) => {
            const isSelected = value.trim().toLowerCase() === opt.toLowerCase();
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  const prev = value;
                  onChange(opt);
                  onCommit?.(opt, prev);
                  focusValueRef.current = opt;
                }}
                title={opt}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-md border transition-colors ${
                  isSelected
                    ? 'bg-sky-500/20 border-sky-400 text-slate-100 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <ColorSwatchDot color={opt} size="sm" />
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SizeFieldInput({
  value,
  onChange,
  onCommit,
  options,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit?: (next: string, prev: string) => void;
  options?: string[];
  compact?: boolean;
}) {
  const focusValueRef = useRef(value);
  const cleanOptions = Array.isArray(options)
    ? options.map((o) => o.trim()).filter(Boolean)
    : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          maxLength={60}
          value={value}
          onFocus={() => {
            focusValueRef.current = value;
          }}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const nextVal = e.target.value.trim();
            if (nextVal && nextVal.toLowerCase() !== focusValueRef.current.trim().toLowerCase()) {
              onCommit?.(nextVal, focusValueRef.current);
              focusValueRef.current = nextVal;
            }
          }}
          placeholder="Es. 256 GB, 512 GB, 1 TB, M, 42..."
          className={`flex-1 min-w-0 px-2.5 ${
            compact ? 'py-1.5 bg-slate-950' : 'py-2 bg-slate-900'
          } border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Rimuovi taglia"
            className="p-1.5 text-slate-500 hover:text-slate-200 rounded-lg hover:bg-slate-800 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {cleanOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {cleanOptions.map((opt) => {
            const isSelected =
              value.trim().toLowerCase().replace(/\s+/g, '') ===
              opt.toLowerCase().replace(/\s+/g, '');
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  const prev = value;
                  onChange(opt);
                  onCommit?.(opt, prev);
                  focusValueRef.current = opt;
                }}
                className={`px-2 py-0.5 text-[11px] font-mono rounded-md border transition-colors ${
                  isSelected
                    ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
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
  room?: ResearchRoomId;
  brand?: string;
  color?: string;
  availableColors?: string[];
  size?: string;
  availableSizes?: string[];
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
  } else if (/(divano|tavolo|sedia|armadio|lampada|materasso|tappeto|arredo|arredamento|scrivania|scaffale|statuetta|busto|scultura|soprammobile|vaso|cornice|quadro|candela|cuscino|plaid|tenda|poltrona|pouf|libreria|comodino|cemento|ceramica|maisonsdumonde|zarahome|westwing|kavehome|sklum|nardioutdoor)/.test(low)) {
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
  const room = inferResearchRoom({ title, url: validUrl, specs, category });

  return {
    url: validUrl,
    title,
    store: store.slice(0, 60),
    category,
    room,
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
  const paidText =
    item.status === 'acquistato' && typeof item.paidPriceEur === 'number'
      ? `€ ${item.paidPriceEur.toFixed(2)}`
      : '';
  const lines = [
    item.title,
    resolvedBrand ? `Marca: ${resolvedBrand}` : '',
    `Negozio: ${item.store}`,
    `Prezzo: ${priceText}`,
    paidText ? `Prezzo pagato: ${paidText}` : '',
    item.room ? `Stanza: ${roomLabel}` : '',
    item.color ? `Colore: ${item.color}` : '',
    item.size ? `Taglia / Capacità: ${item.size}` : '',
    item.model ? `Modello / Codice: ${item.model}` : '',
    `Categoria: ${getCategoryLabel(item.category)} · Stato: ${statusLabel}`,
    `Link: ${item.url}`,
    item.specs ? `Dettagli:\n${item.specs}` : '',
    item.notes ? `Note: ${item.notes}` : '',
  ].filter(Boolean);

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeHtml = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"/><title>${esc(item.title)}</title></head><body style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f1f5f9"><h1>${esc(item.title)}</h1><p>${resolvedBrand ? `<strong>Marca:</strong> ${esc(resolvedBrand)} · ` : ''}<strong>Negozio:</strong> ${esc(item.store)}</p><p><strong>Prezzo:</strong> ${priceText}${paidText ? ` · <strong>Pagato:</strong> ${paidText}` : ''}</p>${item.room ? `<p><strong>Stanza:</strong> ${esc(roomLabel)}</p>` : ''}${item.color ? `<p><strong>Colore:</strong> ${esc(item.color)}</p>` : ''}${item.size ? `<p><strong>Taglia / Capacità:</strong> ${esc(item.size)}</p>` : ''}${item.model ? `<p><strong>Modello / Codice:</strong> ${esc(item.model)}</p>` : ''}<p><strong>Stato:</strong> ${esc(statusLabel)}</p><p><a href="${item.url}" style="color:#38bdf8">${esc(item.url)}</a></p>${item.specs ? `<h3>Informazioni dal sito</h3><pre style="white-space:pre-wrap;font-family:sans-serif;background:#1e293b;padding:12px;border-radius:8px">${esc(item.specs)}</pre>` : ''}${item.notes ? `<p><strong>Note:</strong> ${esc(item.notes)}</p>` : ''}</body></html>`;

  return {
    title: item.title,
    subtitle: `${resolvedBrand ? `${resolvedBrand} · ` : ''}${item.store} · ${paidText || priceText} · ${statusLabel}`,
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
  const [draftAvailableColors, setDraftAvailableColors] = useState<string[]>([]);
  const [draftColorImages, setDraftColorImages] = useState<Record<string, string> | undefined>(
    undefined
  );
  const [draftSize, setDraftSize] = useState('');
  const [draftAvailableSizes, setDraftAvailableSizes] = useState<string[]>([]);
  const [draftSizePrices, setDraftSizePrices] = useState<Record<string, number> | undefined>(
    undefined
  );
  const [draftModel, setDraftModel] = useState('');
  const [draftCategory, setDraftCategory] = useState<ProductResearchCategory>('altro');
  const [draftStatus, setDraftStatus] = useState<ProductResearchStatus>('da_valutare');
  const [draftRoom, setDraftRoom] = useState<string>('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftPaidPrice, setDraftPaidPrice] = useState('');
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
  const [selectedRooms, setSelectedRooms] = useState<Array<'none' | ResearchRoomId>>([]);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const roomMenuRef = useRef<HTMLDivElement | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<ResearchSortField>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewMode, setViewMode] = useState<ResearchViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'list' || saved === 'grid') return saved;
    }
    return 'list';
  });
  const [groupByRoom, setGroupByRoom] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(GROUP_BY_ROOM_STORAGE_KEY) === 'true';
    }
    return false;
  });

  // Card editing / refresh / attachments / delete / share / copy / move feedback
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editStore, setEditStore] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editAvailableColors, setEditAvailableColors] = useState<string[]>([]);
  const [editColorImages, setEditColorImages] = useState<Record<string, string> | undefined>(
    undefined
  );
  const [editSize, setEditSize] = useState('');
  const [editAvailableSizes, setEditAvailableSizes] = useState<string[]>([]);
  const [editModel, setEditModel] = useState('');
  const [editCategory, setEditCategory] = useState<ProductResearchCategory>('altro');
  const [editStatus, setEditStatus] = useState<ProductResearchStatus>('da_valutare');
  const [editRoom, setEditRoom] = useState<string>('');
  const [editPrice, setEditPrice] = useState('');
  const [editPaidPrice, setEditPaidPrice] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editSpecs, setEditSpecs] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSizePrices, setEditSizePrices] = useState<Record<string, number> | undefined>(
    undefined
  );
  const [savingEdit, setSavingEdit] = useState(false);
  const [inlinePaidEditId, setInlinePaidEditId] = useState<string | null>(null);
  const [inlinePaidValue, setInlinePaidValue] = useState('');
  const [pendingCardEdits, setPendingCardEdits] = useState<
    Record<
      string,
      {
        title?: string;
        color?: string;
        imageUrl?: string;
        colorImages?: Record<string, string>;
        size?: string;
        priceEur?: number | null;
        sizePrices?: Record<string, number>;
        room?: string | null;
        status?: ProductResearchStatus;
        paidPriceEur?: number | null;
      }
    >
  >({});
  const [savingPendingId, setSavingPendingId] = useState<string | null>(null);
  const [lazyColorImages, setLazyColorImages] = useState<
    Record<string, Record<string, string>>
  >({});
  const [lazySizePrices, setLazySizePrices] = useState<
    Record<string, Record<string, number>>
  >({});
  const [lazySizePriceLoadingIds, setLazySizePriceLoadingIds] = useState<
    Record<string, boolean>
  >({});
  const lazyInspectingIdsRef = useRef<Set<string>>(new Set());
  const latestQuickColorRef = useRef<Record<string, string>>({});
  const latestQuickSizeRef = useRef<Record<string, string>>({});

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
  const [pendingRefresh, setPendingRefresh] = useState<ProductResearchRecord | null>(null);
  const [pendingEditSave, setPendingEditSave] = useState<{
    item: ProductResearchRecord;
    payload: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>;
  } | null>(null);
  const [shareItem, setShareItem] = useState<ShareableItemPayload | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [listCopied, setListCopied] = useState(false);
  const [movedArticleIds, setMovedArticleIds] = useState<Record<string, boolean>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [attachedThumbnails, setAttachedThumbnails] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!roomMenuOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (roomMenuRef.current && !roomMenuRef.current.contains(e.target as Node)) {
        setRoomMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setRoomMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [roomMenuOpen]);

  // If a product has no external image URL (or it broke), render any uploaded image attachment as thumbnail
  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    async function hydrateAttachedThumbnails() {
      const next: Record<string, string> = {};
      for (const item of researches) {
        const effectiveImg = pendingCardEdits[item.id]?.imageUrl ?? item.imageUrl;
        const hasWorkingExternalImg = Boolean(effectiveImg) && !brokenImages[item.id];
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
    room?: ResearchRoomId;
    priceEur?: number;
    imageUrl?: string;
    brand?: string;
    color?: string;
    availableColors?: string[];
    colorImages?: Record<string, string>;
    size?: string;
    availableSizes?: string[];
    sizePrices?: Record<string, number>;
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
          room?: string;
          priceEur?: number;
          imageUrl?: string;
          brand?: string;
          color?: string;
          availableColors?: string[];
          colorImages?: Record<string, string>;
          size?: string;
          availableSizes?: string[];
          sizePrices?: Record<string, number>;
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
          const cleanColors = Array.isArray(data.availableColors)
            ? data.availableColors.map((c) => String(c).trim()).filter(Boolean).slice(0, 24)
            : [];
          const cleanSizes = Array.isArray(data.availableSizes)
            ? data.availableSizes.map((s) => String(s).trim()).filter(Boolean).slice(0, 24)
            : [];
          const cleanColorImages = sanitizeColorImagesMap(data.colorImages);
          const cleanSizePrices = sanitizeSizePricesMap(data.sizePrices);
          if (cleanSizePrices) {
            writeCachedSizePrices(validUrl, cleanSizePrices);
            writeCachedSizePrices(data.url, cleanSizePrices);
          }
          const resolvedRoom =
            normalizeResearchRoom(data.room) ||
            inferResearchRoom({
              title: data.title,
              url: data.url,
              specs: data.specs,
              category: validCat,
            });
          return {
            url: data.url,
            title: data.title,
            store: data.store,
            category: validCat,
            room: resolvedRoom,
            priceEur: typeof data.priceEur === 'number' ? data.priceEur : undefined,
            imageUrl:
              typeof data.imageUrl === 'string' && /^https?:\/\/.+/.test(data.imageUrl)
                ? data.imageUrl
                : undefined,
            brand: data.brand || undefined,
            color: data.color || undefined,
            availableColors: cleanColors.length > 0 ? cleanColors : undefined,
            colorImages: cleanColorImages,
            size: data.size || undefined,
            availableSizes: cleanSizes.length > 0 ? cleanSizes : undefined,
            sizePrices: cleanSizePrices,
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
      const resolvedRoom =
        normalizeResearchRoom(inspected.room) ||
        inferResearchRoom({
          title: inspected.title,
          url: inspected.url,
          specs: inspected.specs,
          category: inspected.category,
        });
      await onAddResearch({
        url: inspected.url,
        title: inspected.title,
        store: inspected.store,
        category: inspected.category,
        status: 'da_valutare',
        room: resolvedRoom,
        priceEur: inspected.priceEur,
        imageUrl: inspected.imageUrl,
        brand: resolvedBrand,
        color: inspected.color,
        availableColors: inspected.availableColors,
        colorImages: inspected.colorImages,
        size: inspected.size,
        availableSizes: inspected.availableSizes,
        model: inspected.model,
        specs: inspected.specs,
        notes: inspected.notes,
      });
      setLinkInput('');
      setDraftOpen(false);
      const foundBits = [
        typeof inspected.priceEur === 'number' ? `€ ${inspected.priceEur.toFixed(2)}` : '',
        resolvedRoom ? `stanza ${getResearchRoomLabel(resolvedRoom)}` : '',
        inspected.color ? `colore ${inspected.color}` : '',
        inspected.size ? `taglia ${inspected.size}` : '',
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
      setDraftAvailableColors([]);
      setDraftColorImages(undefined);
      setDraftSize('');
      setDraftAvailableSizes([]);
      setDraftSizePrices(undefined);
      setDraftModel('');
      setDraftCategory('altro');
      setDraftStatus('da_valutare');
      setDraftRoom('');
      setDraftPrice('');
      setDraftPaidPrice('');
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
      setDraftAvailableColors(inspected.availableColors || []);
      setDraftColorImages(inspected.colorImages);
      setDraftSize(inspected.size || '');
      setDraftAvailableSizes(inspected.availableSizes || []);
      setDraftSizePrices(inspected.sizePrices);
      setDraftModel(inspected.model || '');
      setDraftCategory(inspected.category);
      setDraftStatus('da_valutare');
      setDraftRoom(normalizeResearchRoom(inspected.room) || '');
      setDraftPrice(typeof inspected.priceEur === 'number' ? String(inspected.priceEur) : '');
      setDraftPaidPrice('');
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
    const validPrice = parseOptionalPriceInput(draftPrice);
    const validPaidPrice =
      draftStatus === 'acquistato' ? parseOptionalPriceInput(draftPaidPrice) : undefined;
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
        paidPriceEur: validPaidPrice,
        imageUrl: validImg,
        brand: draftBrand.trim() ? draftBrand.trim().slice(0, 60) : undefined,
        color: draftColor.trim() ? draftColor.trim().slice(0, 60) : undefined,
        availableColors: draftAvailableColors.length > 0 ? draftAvailableColors : undefined,
        colorImages: sanitizeColorImagesMap(draftColorImages),
        size: draftSize.trim() ? draftSize.trim().slice(0, 60) : undefined,
        availableSizes: draftAvailableSizes.length > 0 ? draftAvailableSizes : undefined,
        model: draftModel.trim() ? draftModel.trim().slice(0, 80) : undefined,
        specs: draftSpecs.trim() ? draftSpecs.trim().slice(0, 2000) : undefined,
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
      setDraftPaidPrice('');
      setDraftAvailableColors([]);
      setDraftColorImages(undefined);
      setDraftSize('');
      setDraftAvailableSizes([]);
      setDraftSizePrices(undefined);
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
    const effective = getEffectiveItem(item);
    setInlinePaidEditId(null);
    setEditingId(item.id);
    setEditUrl(effective.url);
    setEditTitle(effective.title);
    setEditStore(effective.store);
    setEditBrand(normalizeBrandName(effective.brand) || inferProductBrand(effective) || '');
    setEditColor(effective.color || '');
    setEditAvailableColors(effective.availableColors || []);
    setEditColorImages(effective.colorImages);
    setEditSize(effective.size || '');
    setEditAvailableSizes(effective.availableSizes || []);
    setEditSizePrices(effective.sizePrices);
    setEditModel(effective.model || '');
    setEditCategory(effective.category);
    setEditStatus(effective.status);
    setEditRoom(normalizeResearchRoom(effective.room) || '');
    setEditPrice(typeof effective.priceEur === 'number' ? String(effective.priceEur) : '');
    setEditPaidPrice(
      typeof effective.paidPriceEur === 'number' ? String(effective.paidPriceEur) : ''
    );
    setEditImageUrl(effective.imageUrl || '');
    setEditSpecs(effective.specs || '');
    setEditNotes(effective.notes || '');
  }

  function handleRequestSaveEdit(e: React.FormEvent, item: ProductResearchRecord) {
    e.preventDefault();
    if (readOnly) return;
    setLinkError(null);
    setFeedback(null);
    const validUrl = normalizeUrlInput(editUrl);
    if (!validUrl) {
      setLinkError('Inserisci un link URL valido (es. https://...) prima di salvare.');
      return;
    }
    const cleanTitle = editTitle.trim();
    const cleanStore = editStore.trim();
    if (!cleanTitle || !cleanStore) {
      setLinkError('Titolo prodotto e negozio sono obbligatori.');
      return;
    }
    const validPrice = parseOptionalPriceInput(editPrice);
    const validPaidPrice =
      editStatus === 'acquistato' ? parseOptionalPriceInput(editPaidPrice) : undefined;
    const validImg =
      editImageUrl.trim() && /^https?:\/\/.+/.test(editImageUrl.trim())
        ? editImageUrl.trim().slice(0, 1000)
        : undefined;

    setPendingEditSave({
      item,
      payload: {
        url: validUrl,
        title: cleanTitle.slice(0, 160),
        store: cleanStore.slice(0, 60),
        category: editCategory,
        status: editStatus,
        room: normalizeResearchRoom(editRoom),
        priceEur: validPrice,
        paidPriceEur: validPaidPrice,
        imageUrl: validImg,
        brand: editBrand.trim() ? editBrand.trim().slice(0, 60) : undefined,
        color: editColor.trim() ? editColor.trim().slice(0, 60) : undefined,
        availableColors: editAvailableColors.length > 0 ? editAvailableColors : undefined,
        colorImages: sanitizeColorImagesMap(editColorImages),
        size: editSize.trim() ? editSize.trim().slice(0, 60) : undefined,
        availableSizes: editAvailableSizes.length > 0 ? editAvailableSizes : undefined,
        model: editModel.trim() ? editModel.trim().slice(0, 80) : undefined,
        specs: editSpecs.trim() ? editSpecs.trim().slice(0, 2000) : undefined,
        notes: editNotes.trim() ? editNotes.trim().slice(0, 400) : undefined,
      },
    });
  }

  async function confirmSaveEdit() {
    if (!pendingEditSave || readOnly) return;
    const { item, payload } = pendingEditSave;
    setSavingEdit(true);
    setLinkError(null);
    try {
      await onUpdateResearch(item.id, payload);
      setPendingEditSave(null);
      setEditingId((curr) => (curr === item.id ? null : curr));
      handleDiscardPendingCardEdit(item.id);
      setBrokenImages((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setFeedback(`Prodotto "${payload.title}" aggiornato e salvato su Firestore.`);
    } catch (err) {
      setLinkError(
        err instanceof Error
          ? err.message
          : 'Errore durante il salvataggio delle modifiche su Firestore.'
      );
      setPendingEditSave(null);
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
      const nextColorImages = inspected.colorImages || item.colorImages;
      await onUpdateResearch(item.id, {
        url: item.url,
        title: nextTitle,
        store: nextStore,
        category: inspected.category || item.category,
        status: item.status,
        room: normalizeResearchRoom(item.room) ?? normalizeResearchRoom(inspected.room),
        priceEur: inspected.priceEur ?? item.priceEur,
        paidPriceEur: item.status === 'acquistato' ? item.paidPriceEur : undefined,
        imageUrl: inspected.imageUrl || item.imageUrl,
        brand: nextBrand,
        color: inspected.color || item.color,
        availableColors:
          inspected.availableColors && inspected.availableColors.length > 0
            ? inspected.availableColors
            : item.availableColors,
        colorImages: sanitizeColorImagesMap(nextColorImages),
        size: inspected.size || item.size,
        availableSizes:
          inspected.availableSizes && inspected.availableSizes.length > 0
            ? inspected.availableSizes
            : item.availableSizes,
        model: inspected.model || item.model,
        specs: nextSpecs,
        notes: item.notes || inspected.notes,
      });
      if (inspected.colorImages) {
        setLazyColorImages((prev) => ({ ...prev, [item.id]: inspected.colorImages! }));
      }
      if (inspected.sizePrices) {
        setLazySizePrices((prev) => ({ ...prev, [item.id]: inspected.sizePrices! }));
        writeCachedSizePrices(item.url, inspected.sizePrices);
      }
      handleDiscardPendingCardEdit(item.id);
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

  function buildPreservedUpdatePayload(
    item: ProductResearchRecord,
    overrides: Partial<Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>>
  ): Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'> {
    const next = {
      url: item.url,
      title: item.title,
      store: item.store,
      category: item.category,
      status: item.status,
      room: normalizeResearchRoom(item.room),
      priceEur: item.priceEur,
      paidPriceEur: item.status === 'acquistato' ? item.paidPriceEur : undefined,
      imageUrl: item.imageUrl,
      brand: item.brand,
      color: item.color,
      availableColors: item.availableColors,
      colorImages: item.colorImages,
      size: item.size,
      availableSizes: item.availableSizes,
      model: item.model,
      specs: item.specs,
      notes: item.notes,
      ...overrides,
    };
    if (next.status !== 'acquistato') {
      next.paidPriceEur = undefined;
    }
    return next;
  }

  function getEffectiveItem(item: ProductResearchRecord): ProductResearchRecord {
    const pending = pendingCardEdits[item.id];
    const resolvedColorImages =
      pending?.colorImages || item.colorImages || lazyColorImages[item.id];
    const resolvedSizePrices =
      pending?.sizePrices ||
      item.sizePrices ||
      lazySizePrices[item.id] ||
      readCachedSizePrices(item.url);
    const hasStalePaid = item.status !== 'acquistato' && typeof item.paidPriceEur === 'number';
    if (!pending && !resolvedColorImages && !resolvedSizePrices && !hasStalePaid) return item;
    const effectiveStatus = pending?.status !== undefined ? pending.status : item.status;
    return {
      ...item,
      title: pending?.title !== undefined ? pending.title : item.title,
      color: pending?.color !== undefined ? pending.color : item.color,
      imageUrl: pending?.imageUrl !== undefined ? pending.imageUrl : item.imageUrl,
      colorImages: resolvedColorImages,
      size: pending?.size !== undefined ? pending.size : item.size,
      priceEur:
        pending?.priceEur !== undefined
          ? pending.priceEur === null
            ? undefined
            : pending.priceEur
          : item.priceEur,
      sizePrices: resolvedSizePrices,
      room:
        pending?.room !== undefined
          ? normalizeResearchRoom(pending.room || undefined)
          : item.room,
      status: effectiveStatus,
      paidPriceEur:
        effectiveStatus !== 'acquistato'
          ? undefined
          : pending?.paidPriceEur !== undefined
            ? pending.paidPriceEur === null
              ? undefined
              : pending.paidPriceEur
            : item.paidPriceEur,
    };
  }

  function stageCardEdit(
    item: ProductResearchRecord,
    patch: {
      title?: string;
      color?: string;
      imageUrl?: string;
      colorImages?: Record<string, string>;
      size?: string;
      priceEur?: number | null;
      sizePrices?: Record<string, number>;
      room?: string | null;
      status?: ProductResearchStatus;
      paidPriceEur?: number | null;
    }
  ) {
    setFeedback(null);
    setLinkError(null);
    setPendingCardEdits((prev) => {
      const merged = { ...(prev[item.id] || {}), ...patch };
      const nextTitle = merged.title !== undefined ? merged.title : item.title;
      const nextColor = merged.color !== undefined ? merged.color : item.color;
      const nextImageUrl = merged.imageUrl !== undefined ? merged.imageUrl : item.imageUrl;
      const nextSize = merged.size !== undefined ? merged.size : item.size;
      const nextPrice =
        merged.priceEur !== undefined
          ? merged.priceEur === null
            ? undefined
            : merged.priceEur
          : item.priceEur;
      const nextRoom =
        merged.room !== undefined
          ? normalizeResearchRoom(merged.room || undefined)
          : normalizeResearchRoom(item.room);
      const nextStatus = merged.status !== undefined ? merged.status : item.status;
      if (nextStatus !== 'acquistato') {
        merged.paidPriceEur = item.paidPriceEur !== undefined ? null : undefined;
      }
      const nextPaid =
        nextStatus !== 'acquistato'
          ? undefined
          : merged.paidPriceEur !== undefined
            ? merged.paidPriceEur === null
              ? undefined
              : merged.paidPriceEur
            : item.paidPriceEur;

      const isIdentical =
        nextTitle === item.title &&
        nextColor === item.color &&
        nextImageUrl === item.imageUrl &&
        nextSize === item.size &&
        nextPrice === item.priceEur &&
        nextRoom === normalizeResearchRoom(item.room) &&
        nextStatus === item.status &&
        nextPaid === item.paidPriceEur;

      if (isIdentical) {
        if (!prev[item.id]) return prev;
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      }

      return { ...prev, [item.id]: merged };
    });
  }

  function handleDiscardPendingCardEdit(itemId: string) {
    setPendingCardEdits((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    if (inlinePaidEditId === itemId) {
      setInlinePaidEditId(null);
      setInlinePaidValue('');
    }
  }

  function requestCommitPendingCardEdit(item: ProductResearchRecord) {
    if (readOnly) return;
    if (!pendingCardEdits[item.id]) return;
    setLinkError(null);
    setFeedback(null);
    const effective = getEffectiveItem(item);
    setPendingEditSave({
      item,
      payload: buildPreservedUpdatePayload(item, {
        title: effective.title,
        color: effective.color,
        imageUrl: effective.imageUrl,
        colorImages: effective.colorImages,
        size: effective.size,
        priceEur: effective.priceEur,
        room: normalizeResearchRoom(effective.room),
        status: effective.status,
        paidPriceEur: effective.paidPriceEur,
      }),
    });
  }

  async function handleCommitPendingCardEdit(item: ProductResearchRecord) {
    if (readOnly) return;
    if (!pendingCardEdits[item.id]) return;
    const effective = getEffectiveItem(item);
    setSavingPendingId(item.id);
    setLinkError(null);
    try {
      await onUpdateResearch(
        item.id,
        buildPreservedUpdatePayload(item, {
          title: effective.title,
          color: effective.color,
          imageUrl: effective.imageUrl,
          colorImages: effective.colorImages,
          size: effective.size,
          priceEur: effective.priceEur,
          room: normalizeResearchRoom(effective.room),
          status: effective.status,
          paidPriceEur: effective.paidPriceEur,
        })
      );
      setPendingCardEdits((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setFeedback(`Modifiche a "${effective.title}" salvate su Firestore.`);
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : 'Errore durante il salvataggio delle modifiche.'
      );
    } finally {
      setSavingPendingId(null);
    }
  }

  function handleQuickStatusChange(
    item: ProductResearchRecord,
    nextStatus: ProductResearchStatus
  ) {
    if (readOnly) return;
    if (nextStatus !== 'acquistato' && inlinePaidEditId === item.id) {
      setInlinePaidEditId(null);
      setInlinePaidValue('');
    }
    stageCardEdit(item, {
      status: nextStatus,
      ...(nextStatus !== 'acquistato' ? { paidPriceEur: null } : {}),
    });
  }

  function handleQuickRoomChange(item: ProductResearchRecord, nextRoomRaw: string) {
    if (readOnly) return;
    const normalized = normalizeResearchRoom(nextRoomRaw);
    stageCardEdit(item, { room: normalized ?? null });
  }

  function handleQuickColorSelect(item: ProductResearchRecord, nextColor: string) {
    if (readOnly) return;
    latestQuickColorRef.current[item.id] = nextColor;
    const effective = getEffectiveItem(item);
    const nextTitle = replaceColorInTitle(
      effective.title,
      nextColor,
      effective.color,
      item.availableColors
    ).slice(0, 160);
    const knownColorImages = effective.colorImages || lazyColorImages[item.id];
    const nextVariantImg = findColorImageUrl(knownColorImages, nextColor);
    if (nextVariantImg) {
      setBrokenImages((prev) => {
        if (!prev[item.id]) return prev;
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      });
    }
    stageCardEdit(item, {
      color: nextColor,
      title: nextTitle,
      ...(nextVariantImg ? { imageUrl: nextVariantImg } : {}),
    });

    if (
      (!knownColorImages || Object.keys(knownColorImages).length === 0) &&
      /^https?:\/\/.+/.test(item.url) &&
      !lazyInspectingIdsRef.current.has(item.id)
    ) {
      lazyInspectingIdsRef.current.add(item.id);
      void inspectProductLink(item.url)
        .then((inspected) => {
          if (inspected.sizePrices && Object.keys(inspected.sizePrices).length > 0) {
            setLazySizePrices((prev) => ({ ...prev, [item.id]: inspected.sizePrices! }));
          }
          if (!inspected.colorImages || Object.keys(inspected.colorImages).length === 0) return;
          setLazyColorImages((prev) => ({ ...prev, [item.id]: inspected.colorImages! }));
          const targetColor = latestQuickColorRef.current[item.id] || nextColor;
          const fetchedVariantImg = findColorImageUrl(inspected.colorImages, targetColor);
          if (fetchedVariantImg) {
            setBrokenImages((prev) => {
              if (!prev[item.id]) return prev;
              const copy = { ...prev };
              delete copy[item.id];
              return copy;
            });
          }
          setPendingCardEdits((prev) => {
            if (!prev[item.id]) return prev;
            return {
              ...prev,
              [item.id]: {
                ...prev[item.id],
                colorImages: inspected.colorImages,
                ...(fetchedVariantImg ? { imageUrl: fetchedVariantImg } : {}),
              },
            };
          });
        })
        .catch(() => {
          // ignore lazy variant image lookup failures
        })
        .finally(() => {
          lazyInspectingIdsRef.current.delete(item.id);
        });
    }
  }

  function handleQuickSizeSelect(item: ProductResearchRecord, nextSize: string) {
    if (readOnly) return;
    latestQuickSizeRef.current[item.id] = nextSize;
    const effective = getEffectiveItem(item);
    const nextTitle = replaceSizeInTitle(
      effective.title,
      nextSize,
      effective.size,
      item.availableSizes
    ).slice(0, 160);
    const knownSizePrices =
      effective.sizePrices || lazySizePrices[item.id] || readCachedSizePrices(item.url);
    const nextVariantPrice = findSizePrice(knownSizePrices, nextSize);

    stageCardEdit(item, {
      size: nextSize,
      title: nextTitle,
      ...(typeof nextVariantPrice === 'number' ? { priceEur: nextVariantPrice } : {}),
    });

    if (
      (!knownSizePrices || Object.keys(knownSizePrices).length === 0) &&
      /^https?:\/\/.+/.test(item.url) &&
      !lazyInspectingIdsRef.current.has(item.id)
    ) {
      lazyInspectingIdsRef.current.add(item.id);
      setLazySizePriceLoadingIds((prev) => ({ ...prev, [item.id]: true }));
      void inspectProductLink(item.url)
        .then((inspected) => {
          if (inspected.colorImages && Object.keys(inspected.colorImages).length > 0) {
            setLazyColorImages((prev) => ({ ...prev, [item.id]: inspected.colorImages! }));
          }
          if (!inspected.sizePrices || Object.keys(inspected.sizePrices).length === 0) return;
          setLazySizePrices((prev) => ({ ...prev, [item.id]: inspected.sizePrices! }));
          writeCachedSizePrices(item.url, inspected.sizePrices);
          const targetSize = latestQuickSizeRef.current[item.id] || nextSize;
          const fetchedPrice = findSizePrice(inspected.sizePrices, targetSize);
          setPendingCardEdits((prev) => {
            if (!prev[item.id]) return prev;
            return {
              ...prev,
              [item.id]: {
                ...prev[item.id],
                sizePrices: inspected.sizePrices,
                ...(typeof fetchedPrice === 'number' ? { priceEur: fetchedPrice } : {}),
              },
            };
          });
        })
        .catch(() => {
          // ignore lazy variant price lookup failures
        })
        .finally(() => {
          lazyInspectingIdsRef.current.delete(item.id);
          setLazySizePriceLoadingIds((prev) => {
            if (!prev[item.id]) return prev;
            const copy = { ...prev };
            delete copy[item.id];
            return copy;
          });
        });
    }
  }

  function handleSaveInlinePaidPrice(item: ProductResearchRecord) {
    if (readOnly || getEffectiveItem(item).status !== 'acquistato') return;
    const validPaid = parseOptionalPriceInput(inlinePaidValue);
    stageCardEdit(item, { paidPriceEur: validPaid ?? null });
    setInlinePaidEditId(null);
    setInlinePaidValue('');
  }

  function handleChangeViewMode(mode: ResearchViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  }

  function handleToggleGroupByRoom() {
    setGroupByRoom((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(GROUP_BY_ROOM_STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
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
      handleDiscardPendingCardEdit(id);
      await onDeleteResearch(id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmRefreshResearch() {
    if (!pendingRefresh || readOnly) return;
    try {
      await handleRefreshFromSite(pendingRefresh);
      setPendingRefresh(null);
    } catch {
      setPendingRefresh(null);
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
      const effective = getEffectiveItem(item);
      if (pendingCardEdits[item.id]) {
        await handleCommitPendingCardEdit(item);
      }
      await onMoveToArticles(effective);
      setMovedArticleIds((prev) => ({ ...prev, [item.id]: true }));
      const attachedCount = getDocumentsForResearch(researchDocuments, item.id).length;
      setFeedback(
        `"${effective.title}" aggiunto alla pagina Articoli${
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
    let toBuy = 0;
    let purchased = 0;
    let pendingBudget = 0;
    let purchasedSpent = 0;
    for (const r of researches) {
      if (r.status === 'da_acquistare') toBuy += 1;
      if (r.status === 'acquistato') {
        purchased += 1;
        const paidOrListed = typeof r.paidPriceEur === 'number' ? r.paidPriceEur : r.priceEur;
        if (typeof paidOrListed === 'number') purchasedSpent += paidOrListed;
      }
      if (
        typeof r.priceEur === 'number' &&
        (r.status === 'da_acquistare' || r.status === 'da_valutare')
      ) {
        pendingBudget += r.priceEur;
      }
    }
    return {
      total: researches.length,
      toBuy,
      purchased,
      pendingBudget,
      purchasedSpent,
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
      if (selectedRooms.length > 0) {
        const normalizedItemRoom = normalizeResearchRoom(item.room) || 'none';
        if (!selectedRooms.includes(normalizedItemRoom)) return false;
      }
      if (!q) return true;
      const haystack = [
        item.title,
        effectiveBrand || '',
        item.brand || '',
        item.store,
        item.color || '',
        ...(item.availableColors || []),
        item.size || '',
        ...(item.availableSizes || []),
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
    selectedRooms,
    sortField,
    sortDirection,
  ]);

  const roomStats = useMemo(() => {
    const counts: Record<ResearchRoomId, number> = {
      salone: 0,
      cucina: 0,
      bagno1: 0,
      bagno2: 0,
      stanza_maurizio: 0,
      stanza_roberta: 0,
      stanza_matrimoniale: 0,
      terrazza_ovest: 0,
      terrazza_est: 0,
    };
    let unassigned = 0;
    for (const item of researches) {
      const normalized = normalizeResearchRoom(item.room);
      if (normalized) {
        counts[normalized] += 1;
      } else {
        unassigned += 1;
      }
    }
    return { counts, unassigned };
  }, [researches]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<ProductResearchCategory, number>> = {};
    for (const item of researches) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [researches]);

  const statusCounts = useMemo(() => {
    const counts: Record<ProductResearchStatus, number> = {
      da_valutare: 0,
      da_acquistare: 0,
      acquistato: 0,
    };
    for (const item of researches) {
      counts[item.status] += 1;
    }
    return counts;
  }, [researches]);

  const pageTotals = useMemo(() => {
    let listTotal = 0;
    let paidTotal = 0;
    let paidCount = 0;
    for (const rawItem of filteredResearches) {
      const item = getEffectiveItem(rawItem);
      if (typeof item.priceEur === 'number') {
        listTotal += item.priceEur;
      }
      if (item.status === 'acquistato' && typeof item.paidPriceEur === 'number') {
        paidTotal += item.paidPriceEur;
        paidCount += 1;
      }
    }
    return {
      listTotal,
      paidTotal,
      paidCount,
      itemCount: filteredResearches.length,
    };
  }, [filteredResearches, pendingCardEdits, lazyColorImages, lazySizePrices]);

  const groupedByRoom = useMemo(() => {
    const byRoomMap = new Map<'none' | ResearchRoomId, ProductResearchRecord[]>();
    for (const item of filteredResearches) {
      const effectiveRoom = getEffectiveItem(item).room;
      const key = normalizeResearchRoom(effectiveRoom) || 'none';
      const existing = byRoomMap.get(key);
      if (existing) existing.push(item);
      else byRoomMap.set(key, [item]);
    }

    const groups: {
      key: 'none' | ResearchRoomId;
      label: string;
      items: ProductResearchRecord[];
      listTotal: number;
      paidTotal: number;
      paidCount: number;
    }[] = [];

    const orderedKeys: ('none' | ResearchRoomId)[] = [
      ...RESEARCH_ROOMS.map((rm) => rm.id),
      'none',
    ];

    for (const key of orderedKeys) {
      const items = byRoomMap.get(key);
      if (!items || items.length === 0) continue;
      let listTotal = 0;
      let paidTotal = 0;
      let paidCount = 0;
      for (const rawItem of items) {
        const item = getEffectiveItem(rawItem);
        if (typeof item.priceEur === 'number') listTotal += item.priceEur;
        if (item.status === 'acquistato' && typeof item.paidPriceEur === 'number') {
          paidTotal += item.paidPriceEur;
          paidCount += 1;
        }
      }
      groups.push({
        key,
        label: key === 'none' ? 'Non assegnata' : getResearchRoomLabel(key),
        items,
        listTotal,
        paidTotal,
        paidCount,
      });
    }

    return groups;
  }, [filteredResearches, pendingCardEdits, lazyColorImages, lazySizePrices]);

  async function handleCopyFilteredList() {
    if (filteredResearches.length === 0) return;
    const lines = filteredResearches.map((item, idx) => {
      const effective = getEffectiveItem(item);
      const brand = inferProductBrand(effective);
      const room = getResearchRoomLabel(effective.room);
      const priceStr =
        typeof effective.priceEur === 'number'
          ? formatEuroIt(effective.priceEur)
          : 'Prezzo n/d';
      const paidStr =
        effective.status === 'acquistato' && typeof effective.paidPriceEur === 'number'
          ? ` · Pagato: ${formatEuroIt(effective.paidPriceEur)}`
          : '';
      const meta = [brand, effective.store, room !== 'Nessuna stanza' ? room : '', priceStr]
        .filter(Boolean)
        .join(' · ');
      return `${idx + 1}. ${effective.title} (${meta}${paidStr})\n   ${effective.url}`;
    });
    const header = `Ricerche Prodotti (${filteredResearches.length} articoli · Totale: ${formatEuroIt(
      pageTotals.listTotal
    )}${
      pageTotals.paidCount > 0
        ? ` · Pagato: ${formatEuroIt(pageTotals.paidTotal)} su ${pageTotals.paidCount}`
        : ''
    })`;
    try {
      await navigator.clipboard.writeText(`${header}\n\n${lines.join('\n')}`);
      setListCopied(true);
      window.setTimeout(() => setListCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div className="space-y-6 min-w-0">
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
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:shrink-0">
                <button
                  type="button"
                  disabled={inspecting || savingNew}
                  onClick={() => void handleOpenDraftFromLink()}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5 text-sky-400" />
                  <span>{linkInput.trim() ? 'Anteprima / Modifica' : 'Inserimento manuale'}</span>
                </button>
                <button
                  type="submit"
                  disabled={!linkInput.trim() || inspecting || savingNew}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
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
                    {draftStatus === 'acquistato' && draftPaidPrice && (
                      <span className="text-emerald-300 font-medium">
                        · Pagato € {draftPaidPrice}
                      </span>
                    )}
                    {draftColor && (
                      <span className="inline-flex items-center gap-1" title={`Colore: ${draftColor}`}>
                        <ColorSwatchDot color={draftColor} size="sm" />
                        <span>{draftColor}</span>
                      </span>
                    )}
                    {draftSize && (
                      <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-200 font-mono text-[10px]">
                        {draftSize}
                      </span>
                    )}
                    {draftBrand && <span>· {draftBrand}</span>}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="sm:col-span-2 lg:col-span-1 space-y-1">
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
                <label className="block text-slate-400">Prezzo online (€ opz.)</label>
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

              {draftStatus === 'acquistato' && (
                <div className="space-y-1">
                  <label className="block text-slate-400">Prezzo pagato all&apos;acquisto (€ opz.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1000000"
                    value={draftPaidPrice}
                    onChange={(e) => setDraftPaidPrice(e.target.value)}
                    placeholder="Es. 49.90"
                    className="w-full px-3 py-2 font-mono bg-slate-900 border border-slate-800 rounded-lg text-emerald-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

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
                  placeholder="Es. B0HJB2DT3H"
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
                  onChange={(e) => {
                    const nextStatus = e.target.value as ProductResearchStatus;
                    setDraftStatus(nextStatus);
                    if (nextStatus !== 'acquistato') {
                      setDraftPaidPrice('');
                    }
                  }}
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
                <ColorFieldInput
                  value={draftColor}
                  onChange={setDraftColor}
                  onCommit={(nextVal, prevVal) => {
                    setDraftTitle((prev) =>
                      replaceColorInTitle(prev, nextVal, prevVal, draftAvailableColors).slice(
                        0,
                        160
                      )
                    );
                    const variantImg = findColorImageUrl(draftColorImages, nextVal);
                    if (variantImg) setDraftImageUrl(variantImg);
                  }}
                  options={draftAvailableColors}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                <label className="block text-slate-400">Taglia / Capacità</label>
                <SizeFieldInput
                  value={draftSize}
                  onChange={setDraftSize}
                  onCommit={(nextVal, prevVal) => {
                    setDraftTitle((prev) =>
                      replaceSizeInTitle(prev, nextVal, prevVal, draftAvailableSizes).slice(0, 160)
                    );
                    const variantPrice = findSizePrice(draftSizePrices, nextVal);
                    if (typeof variantPrice === 'number') {
                      setDraftPrice(String(variantPrice));
                    }
                  }}
                  options={draftAvailableSizes}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                <label className="block text-slate-400">
                  Specifiche &amp; Info utili dal sito (una per riga)
                </label>
                <textarea
                  rows={3}
                  maxLength={2000}
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

      {/* Summary Header, Rooms Bar, Filters & View Mode Switcher */}
      {(() => {
        const toggleRoomFilter = (roomKey: 'none' | ResearchRoomId) => {
          setSelectedRooms((prev) =>
            prev.includes(roomKey)
              ? prev.filter((r) => r !== roomKey)
              : [...prev, roomKey]
          );
        };

        const activeFilterCount =
          (searchText.trim() ? 1 : 0) +
          (statusFilter !== 'all' ? 1 : 0) +
          (selectedRooms.length > 0 ? 1 : 0) +
          (categoryFilter !== 'all' ? 1 : 0) +
          (brandFilter !== 'all' ? 1 : 0) +
          (storeFilter !== 'all' ? 1 : 0);
        const hasActiveFilters = activeFilterCount > 0;

        const resetAllFilters = () => {
          setSearchText('');
          setStatusFilter('all');
          setSelectedRooms([]);
          setCategoryFilter('all');
          setBrandFilter('all');
          setStoreFilter('all');
        };

        const activeChips: Array<{ key: string; label: string; onClear: () => void }> = [];
        if (searchText.trim()) {
          activeChips.push({
            key: 'search',
            label: `Ricerca: "${searchText.trim()}"`,
            onClear: () => setSearchText(''),
          });
        }
        selectedRooms.forEach((rmKey) => {
          activeChips.push({
            key: `room_${rmKey}`,
            label: `Stanza: ${
              rmKey === 'none' ? 'Non assegnata' : getResearchRoomLabel(rmKey) || rmKey
            }`,
            onClear: () => setSelectedRooms((prev) => prev.filter((r) => r !== rmKey)),
          });
        });
        if (categoryFilter !== 'all') {
          activeChips.push({
            key: 'category',
            label: `Categoria: ${getCategoryLabel(categoryFilter)}`,
            onClear: () => setCategoryFilter('all'),
          });
        }
        if (brandFilter !== 'all') {
          activeChips.push({
            key: 'brand',
            label: `Marca: ${brandFilter === 'none' ? 'Senza marca' : brandFilter}`,
            onClear: () => setBrandFilter('all'),
          });
        }
        if (storeFilter !== 'all') {
          activeChips.push({
            key: 'store',
            label: `Negozio: ${storeFilter}`,
            onClear: () => setStoreFilter('all'),
          });
        }
        if (statusFilter !== 'all') {
          activeChips.push({
            key: 'status',
            label: `Stato: ${getStatusMeta(statusFilter).label}`,
            onClear: () => setStatusFilter('all'),
          });
        }

        const selectBaseClass =
          'w-full sm:w-auto min-w-0 max-w-full px-3 py-2 text-xs rounded-lg border [color-scheme:dark] focus:outline-none focus:border-sky-500 transition-colors';
        const selectInactiveClass =
          'text-slate-200 bg-slate-950 border-slate-800 hover:border-slate-700';
        const selectActiveClass =
          'text-sky-100 font-semibold bg-sky-500/15 border-sky-400/80 ring-1 ring-sky-400/25';

        const activeSectionTitle =
          selectedRooms.length === 0
            ? 'La mia lista'
            : selectedRooms.length <= 2
            ? selectedRooms
                .map((rmKey) =>
                  rmKey === 'none' ? 'Non assegnata' : getResearchRoomLabel(rmKey)
                )
                .join(' · ')
            : `${selectedRooms.length} stanze selezionate`;

        return (
          <>
            <section
              className={`bg-slate-900 border rounded-xl p-4 sm:p-5 space-y-4 transition-colors ${
                hasActiveFilters
                  ? 'border-sky-500/45 ring-1 ring-sky-500/15'
                  : 'border-slate-800'
              }`}
            >
              {/* Row 1: Summary Title + Page Totals + View Switcher & Copy List */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 min-w-0">
                <div className="min-w-0 md:shrink-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                    <span>Spazio personale</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {researches.length}{' '}
                      {researches.length === 1 ? 'articolo aggiunto' : 'articoli aggiunti'}
                    </span>
                    {kpis.toBuy > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-sky-300 tabular-nums">
                          {kpis.toBuy} da acquistare
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight mt-0.5 truncate">
                    {activeSectionTitle}
                  </h3>
                </div>

                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center md:justify-end gap-3 sm:gap-5 min-w-0">
                  {/* Totals */}
                  <div className="flex items-start justify-between sm:justify-start gap-3 sm:gap-5 min-w-0">
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">
                        Valore totale pagina
                      </div>
                      <div className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-slate-100 leading-tight mt-0.5 whitespace-nowrap">
                        {formatEuroIt(pageTotals.listTotal)}
                      </div>
                    </div>

                    <div className="w-px h-10 bg-slate-800 self-center shrink-0" aria-hidden="true" />

                    <div className="min-w-0 text-right sm:text-left">
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">
                        Totale pagato
                      </div>
                      <div className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-400 leading-tight mt-0.5 whitespace-nowrap">
                        {formatEuroIt(pageTotals.paidTotal)}
                      </div>
                      <div className="text-[11px] text-slate-400 tabular-nums mt-0.5 whitespace-nowrap">
                        su {pageTotals.paidCount} su {pageTotals.itemCount}{' '}
                        {pageTotals.itemCount === 1 ? 'articolo' : 'articoli'}
                      </div>
                    </div>
                  </div>

                  <div
                    className="hidden sm:block w-px h-10 bg-slate-800 shrink-0"
                    aria-hidden="true"
                  />

                  {/* View Mode Toggle + Independent Room Grouping + Copy List */}
                  <div className="w-full sm:w-auto flex flex-wrap items-center gap-2 min-w-0">
                    <div
                      role="group"
                      aria-label="Modalità visualizzazione"
                      className="inline-flex items-center p-1 bg-slate-950 border border-slate-800 rounded-xl shrink-0"
                    >
                      <button
                        type="button"
                        onClick={() => handleChangeViewMode('list')}
                        aria-pressed={viewMode === 'list'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          viewMode === 'list'
                            ? 'bg-slate-800 text-slate-100 font-semibold shadow-sm'
                            : 'text-slate-400 hover:text-slate-100'
                        }`}
                      >
                        <List className="w-3.5 h-3.5" />
                        <span>Elenco</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChangeViewMode('grid')}
                        aria-pressed={viewMode === 'grid'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          viewMode === 'grid'
                            ? 'bg-slate-800 text-slate-100 font-semibold shadow-sm'
                            : 'text-slate-400 hover:text-slate-100'
                        }`}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        <span>Griglia</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleGroupByRoom}
                      aria-pressed={groupByRoom}
                      title="Dividi i risultati per stanze (compatibile sia con Griglia che con Elenco)"
                      className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                        groupByRoom
                          ? 'bg-slate-100 text-slate-950 border-slate-100 font-semibold'
                          : 'text-slate-200 bg-slate-950 hover:bg-slate-800 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <Home className="w-3.5 h-3.5" />
                      <span>Dividi per stanze</span>
                    </button>

                    <button
                      type="button"
                      disabled={filteredResearches.length === 0}
                      onClick={() => void handleCopyFilteredList()}
                      title="Copia riepilogo della lista filtrata negli appunti"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      {listCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">Lista copiata</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-400" />
                          <span>Copia lista</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-800/80" />

              {/* Row 2: Stanze Single-Line Bar (Multi-select Dropdown + Active Quick Chips) */}
              <div className="flex items-center gap-2 min-w-0">
                <div ref={roomMenuRef} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setRoomMenuOpen((prev) => !prev)}
                    aria-expanded={roomMenuOpen}
                    aria-haspopup="listbox"
                    title="Seleziona una o più stanze da filtrare"
                    className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap ${
                      selectedRooms.length > 0
                        ? 'bg-sky-500/15 text-sky-100 border-sky-400/80 ring-1 ring-sky-400/25 font-semibold'
                        : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <Home className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      {selectedRooms.length === 0
                        ? 'Stanze'
                        : selectedRooms.length === 1
                        ? selectedRooms[0] === 'none'
                          ? 'Non assegnata'
                          : getResearchRoomLabel(selectedRooms[0])
                        : `${selectedRooms.length} stanze`}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        roomMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {roomMenuOpen && (
                    <div
                      role="listbox"
                      aria-multiselectable="true"
                      aria-label="Seleziona una o più stanze"
                      className="absolute left-0 top-full mt-1.5 z-40 w-64 max-w-[calc(100vw-2.5rem)] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800/80 mb-1">
                        <span className="text-[11px] font-medium text-slate-400">
                          Seleziona più stanze
                        </span>
                        {selectedRooms.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedRooms([])}
                            className="text-[11px] font-medium text-sky-400 hover:text-sky-300"
                          >
                            Mostra tutte
                          </button>
                        )}
                      </div>

                      <div className="max-h-64 overflow-y-auto space-y-0.5 pr-0.5">
                        {RESEARCH_ROOMS.map((rm) => {
                          const count = roomStats.counts[rm.id] || 0;
                          const isSelected = selectedRooms.includes(rm.id);
                          return (
                            <button
                              key={rm.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => toggleRoomFilter(rm.id)}
                              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-lg transition-colors text-left ${
                                isSelected
                                  ? 'bg-sky-500/20 text-sky-100 font-semibold'
                                  : count > 0
                                  ? 'text-slate-200 hover:bg-slate-800/80'
                                  : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                              }`}
                            >
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                    isSelected
                                      ? 'bg-sky-400 border-sky-400 text-slate-950'
                                      : 'border-slate-700 bg-slate-950'
                                  }`}
                                >
                                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                </span>
                                <span className="truncate">{rm.label}</span>
                              </span>
                              <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                                {count}
                              </span>
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedRooms.includes('none')}
                          onClick={() => toggleRoomFilter('none')}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-lg transition-colors text-left ${
                            selectedRooms.includes('none')
                              ? 'bg-sky-500/20 text-sky-100 font-semibold'
                              : 'text-slate-300 hover:bg-slate-800/80'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                selectedRooms.includes('none')
                                  ? 'bg-sky-400 border-sky-400 text-slate-950'
                                  : 'border-slate-700 bg-slate-950'
                              }`}
                            >
                              {selectedRooms.includes('none') && (
                                <Check className="w-3 h-3 stroke-[3]" />
                              )}
                            </span>
                            <span className="truncate">Non assegnata</span>
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                            {roomStats.unassigned}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-px h-5 bg-slate-800 shrink-0" aria-hidden="true" />

                <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0 flex-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => setSelectedRooms([])}
                    className={`px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap tabular-nums shrink-0 ${
                      selectedRooms.length === 0
                        ? 'bg-slate-100 text-slate-950 border-slate-100 font-semibold'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-slate-100'
                    }`}
                  >
                    Tutte ({researches.length})
                  </button>

                  {RESEARCH_ROOMS.map((rm) => {
                    const count = roomStats.counts[rm.id] || 0;
                    const isActive = selectedRooms.includes(rm.id);
                    if (count === 0 && !isActive) return null;
                    return (
                      <button
                        key={rm.id}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => toggleRoomFilter(rm.id)}
                        title={
                          isActive
                            ? `Rimuovi ${rm.label} dal filtro`
                            : `Aggiungi ${rm.label} al filtro (multi-selezione)`
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap tabular-nums shrink-0 ${
                          isActive
                            ? 'bg-slate-100 text-slate-950 border-slate-100 font-semibold'
                            : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        {isActive && <Check className="w-3 h-3 shrink-0" />}
                        <span>
                          {rm.label}
                          {count > 0 ? ` (${count})` : ''}
                        </span>
                      </button>
                    );
                  })}

                  {(roomStats.unassigned > 0 || selectedRooms.includes('none')) && (
                    <button
                      type="button"
                      aria-pressed={selectedRooms.includes('none')}
                      onClick={() => toggleRoomFilter('none')}
                      title={
                        selectedRooms.includes('none')
                          ? 'Rimuovi Non assegnata dal filtro'
                          : 'Aggiungi Non assegnata al filtro (multi-selezione)'
                      }
                      className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap tabular-nums shrink-0 ${
                        selectedRooms.includes('none')
                          ? 'bg-slate-100 text-slate-950 border-slate-100 font-semibold'
                          : 'bg-slate-800/75 text-slate-300 border-slate-700/80 hover:border-slate-600 hover:text-slate-100'
                      }`}
                    >
                      {selectedRooms.includes('none') && <Check className="w-3 h-3 shrink-0" />}
                      <span>Non assegnata ({roomStats.unassigned})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Row 3: Search + Category + Brand + Store + Status + Sort */}
              <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-2.5 min-w-0">
                <div className="relative w-full lg:flex-1 lg:min-w-[220px]">
                  <Search
                    className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${
                      searchText.trim() ? 'text-sky-300' : 'text-slate-400'
                    }`}
                  />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Filtra tra i tuoi articoli (nome, marca, negozio, stanza, modello)..."
                    className={`w-full pl-9 ${
                      searchText.trim() ? 'pr-8' : 'pr-3'
                    } py-2 text-xs text-slate-100 rounded-lg border focus:outline-none focus:border-sky-500 transition-colors ${
                      searchText.trim()
                        ? 'bg-sky-500/10 border-sky-400/80 ring-1 ring-sky-400/20'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  />
                  {searchText.trim() && (
                    <button
                      type="button"
                      onClick={() => setSearchText('')}
                      aria-label="Cancella ricerca"
                      title="Cancella testo di ricerca"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 w-full lg:w-auto min-w-0">
                  <select
                    value={categoryFilter}
                    onChange={(e) =>
                      setCategoryFilter(e.target.value as 'all' | ProductResearchCategory)
                    }
                    aria-label="Filtra per categoria"
                    className={`${selectBaseClass} ${
                      categoryFilter !== 'all' ? selectActiveClass : selectInactiveClass
                    }`}
                  >
                    <option value="all">Tutte le categorie ({researches.length})</option>
                    {CATEGORY_OPTIONS.map((c) => {
                      const count = categoryCounts[c.value] || 0;
                      return (
                        <option key={c.value} value={c.value}>
                          {c.label}
                          {count > 0 ? ` (${count})` : ''}
                        </option>
                      );
                    })}
                  </select>

                  <select
                    value={brandFilter}
                    onChange={(e) => setBrandFilter(e.target.value)}
                    aria-label="Filtra per marca"
                    className={`${selectBaseClass} ${
                      brandFilter !== 'all' ? selectActiveClass : selectInactiveClass
                    }`}
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
                    className={`${selectBaseClass} ${
                      storeFilter !== 'all' ? selectActiveClass : selectInactiveClass
                    }`}
                  >
                    <option value="all">Tutti i negozi</option>
                    {availableStores.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as 'all' | ProductResearchStatus)
                    }
                    aria-label="Filtra per stato"
                    className={`${selectBaseClass} ${
                      statusFilter !== 'all' ? selectActiveClass : selectInactiveClass
                    }`}
                  >
                    <option value="all">Tutti gli stati ({researches.length})</option>
                    {STATUS_OPTIONS.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label} ({statusCounts[st.value]})
                      </option>
                    ))}
                  </select>

                  <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5 w-full sm:w-auto min-w-0">
                    <select
                      value={sortField}
                      onChange={(e) => setSortField(e.target.value as ResearchSortField)}
                      aria-label="Ordina articoli per"
                      className="flex-1 sm:flex-initial min-w-0 px-3 py-2 text-xs text-slate-200 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg [color-scheme:dark] focus:outline-none focus:border-sky-500 transition-colors"
                    >
                      <option value="title">Ordine: Nome</option>
                      <option value="price">Ordine: Prezzo</option>
                      <option value="brand">Ordine: Marca</option>
                      <option value="store">Ordine: Negozio</option>
                      <option value="room">Ordine: Stanza</option>
                      <option value="status">Ordine: Stato</option>
                      <option value="recent">Ordine: Salvato</option>
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
                      className="inline-flex items-center justify-center p-2 text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors shrink-0"
                    >
                      {sortDirection === 'asc' ? (
                        <ArrowUpNarrowWide className="w-3.5 h-3.5 text-sky-400" />
                      ) : (
                        <ArrowDownWideNarrow className="w-3.5 h-3.5 text-sky-400" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-slate-800/80 text-[11px]">
                  <span className="text-sky-300 font-medium mr-1 tabular-nums">
                    Filtri attivi ({filteredResearches.length}/{researches.length} risultati):
                  </span>
                  {activeChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={chip.onClear}
                      title="Clicca per rimuovere questo filtro"
                      className="inline-flex items-center gap-1 px-2 py-0.5 max-w-full rounded-md bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/50 text-sky-200 font-medium transition-colors"
                    >
                      <span className="truncate">{chip.label}</span>
                      <X className="w-3 h-3 text-sky-300 shrink-0" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-amber-200 hover:text-amber-100 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 transition-colors ml-auto whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Azzera filtri ({activeFilterCount})</span>
                  </button>
                </div>
              )}
            </section>

            {/* Product Grid / List */}
            {filteredResearches.length === 0 ? (
              <div className="bg-slate-900 border border-dashed border-slate-800 rounded-xl p-8 text-center space-y-3">
                <ShoppingBag className="w-8 h-8 text-slate-600 mx-auto" />
                <div className="space-y-1">
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
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rimuovi tutti i filtri</span>
                  </button>
                )}
              </div>
            ) : (() => {
              const renderResearchCard = (item: ProductResearchRecord) => {
            const effectiveItem = getEffectiveItem(item);
            const hasPendingEdits = Boolean(pendingCardEdits[item.id]);
            const isSavingPendingHere = savingPendingId === item.id;
            const statusMeta = getStatusMeta(effectiveItem.status);
            const isEditing = editingId === item.id;
            const imageBroken = Boolean(brokenImages[item.id]);
            const itemDocs = getDocumentsForResearch(researchDocuments, item.id);
            const specEntries = parseSpecLines(item.specs);
            const filteredSpecEntries = specEntries.filter((entry) => {
              const lowL = entry.label?.toLowerCase();
              const isColorSpec = lowL === 'colore' || lowL === 'color';
              if (isColorSpec && effectiveItem.color) {
                const valNorm = entry.value.trim().toLowerCase();
                const knownColors = [
                  effectiveItem.color,
                  item.color,
                  ...(item.availableColors || []),
                ]
                  .filter(Boolean)
                  .map((c) => String(c).trim().toLowerCase());
                if (knownColors.includes(valNorm)) return false;
              }
              const isSizeSpec =
                lowL === 'taglia' ||
                lowL === 'size' ||
                lowL === 'capacità' ||
                lowL === 'capacità memoria' ||
                lowL === 'capacità di memoria' ||
                lowL === 'capacità della memoria' ||
                lowL === 'dimensione memoria' ||
                lowL === 'dimensioni memoria ram';
              if (isSizeSpec && effectiveItem.size) {
                const valCompact = entry.value.trim().toLowerCase().replace(/\s+/g, '');
                const knownSizes = [
                  effectiveItem.size,
                  item.size,
                  ...(item.availableSizes || []),
                ]
                  .filter(Boolean)
                  .map((s) => String(s).trim().toLowerCase().replace(/\s+/g, ''));
                if (knownSizes.includes(valCompact)) return false;
              }
              return true;
            });
            const isSpecsExpanded = Boolean(expandedSpecsIds[item.id]);
            const defaultVisibleSpecsCount = viewMode === 'list' ? 3 : 5;
            const visibleSpecs = isSpecsExpanded
              ? filteredSpecEntries
              : filteredSpecEntries.slice(0, defaultVisibleSpecsCount);
            const visibleTechSpecs = visibleSpecs.filter(
              (entry) => !entry.isBullet && Boolean(entry.label)
            );
            const visibleDescriptiveSpecs = visibleSpecs.filter(
              (entry) => entry.isBullet || !entry.label
            );
            const isAttachOpen = Boolean(openAttachmentsIds[item.id]) || itemDocs.length > 0;
            const selectedAttachType = cardAttachType[item.id] || 'scontrino_fattura';
            const isUploadingHere = uploadingResearchId === item.id;
            const isRefreshingHere = refreshingId === item.id;
            const currentRoomId = normalizeResearchRoom(effectiveItem.room) || '';
            const currentRoomLabel = getResearchRoomLabel(effectiveItem.room);

            if (isEditing && !readOnly) {
              const origBrand = (
                normalizeBrandName(item.brand) ||
                inferProductBrand(item) ||
                ''
              ).trim();
              const origPrice =
                typeof item.priceEur === 'number' ? Math.round(item.priceEur * 100) / 100 : undefined;
              const origPaid =
                item.status === 'acquistato' && typeof item.paidPriceEur === 'number'
                  ? Math.round(item.paidPriceEur * 100) / 100
                  : undefined;
              const nextPrice = parseOptionalPriceInput(editPrice);
              const nextPaid =
                editStatus === 'acquistato' ? parseOptionalPriceInput(editPaidPrice) : undefined;
              const normalizedEditUrl = normalizeUrlInput(editUrl) || editUrl.trim();
              const normalizedOrigUrl = normalizeUrlInput(item.url) || item.url.trim();
              const isEditFormDirty =
                editTitle.trim() !== item.title.trim() ||
                normalizedEditUrl !== normalizedOrigUrl ||
                editStore.trim() !== item.store.trim() ||
                editBrand.trim() !== origBrand ||
                editColor.trim() !== (item.color || '').trim() ||
                editSize.trim() !== (item.size || '').trim() ||
                editModel.trim() !== (item.model || '').trim() ||
                editCategory !== item.category ||
                editStatus !== item.status ||
                (normalizeResearchRoom(editRoom) || '') !== (normalizeResearchRoom(item.room) || '') ||
                nextPrice !== origPrice ||
                nextPaid !== origPaid ||
                editImageUrl.trim() !== (item.imageUrl || '').trim() ||
                editSpecs.trim() !== (item.specs || '').trim() ||
                editNotes.trim() !== (item.notes || '').trim();

              return (
                <form
                  key={item.id}
                  onSubmit={(e) => {
                    if (!isEditFormDirty) {
                      e.preventDefault();
                      return;
                    }
                    handleRequestSaveEdit(e, item);
                  }}
                  className={`bg-slate-900 border border-sky-500/50 rounded-xl p-4 space-y-2.5 text-xs ${
                    viewMode === 'list' ? '' : 'sm:col-span-2'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-semibold text-sky-300">Modifica prodotto</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingEditSave(null);
                        setEditingId(null);
                      }}
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
                      <label className="text-slate-400">Prezzo online (€)</label>
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
                    {editStatus === 'acquistato' && (
                      <div className="space-y-1">
                        <label className="text-slate-400">Prezzo pagato (€)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1000000"
                          value={editPaidPrice}
                          onChange={(e) => setEditPaidPrice(e.target.value)}
                          placeholder="Pagato..."
                          className="w-full px-2.5 py-1.5 font-mono bg-slate-950 border border-slate-800 rounded-lg text-emerald-200"
                        />
                      </div>
                    )}
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
                        onChange={(e) => {
                          const nextStatus = e.target.value as ProductResearchStatus;
                          setEditStatus(nextStatus);
                          if (nextStatus !== 'acquistato') {
                            setEditPaidPrice('');
                          }
                        }}
                        className="w-full px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
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
                    <ColorFieldInput
                      value={editColor}
                      onChange={setEditColor}
                      onCommit={(nextVal, prevVal) => {
                        setEditTitle((prev) =>
                          replaceColorInTitle(prev, nextVal, prevVal, editAvailableColors).slice(
                            0,
                            160
                          )
                        );
                        const variantImg = findColorImageUrl(editColorImages, nextVal);
                        if (variantImg) setEditImageUrl(variantImg);
                      }}
                      options={editAvailableColors}
                      compact
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Taglia / Capacità</label>
                    <SizeFieldInput
                      value={editSize}
                      onChange={setEditSize}
                      onCommit={(nextVal, prevVal) => {
                        setEditTitle((prev) =>
                          replaceSizeInTitle(prev, nextVal, prevVal, editAvailableSizes).slice(
                            0,
                            160
                          )
                        );
                        const variantPrice = findSizePrice(editSizePrices, nextVal);
                        if (typeof variantPrice === 'number') {
                          setEditPrice(String(variantPrice));
                        }
                      }}
                      options={editAvailableSizes}
                      compact
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Specifiche &amp; Info dal sito</label>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={editSpecs}
                      onChange={(e) => setEditSpecs(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 resize-y"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Note personali (opzionale)</label>
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
                      disabled={savingEdit}
                      onClick={() => {
                        setPendingEditSave(null);
                        setEditingId(null);
                      }}
                      className="px-3 py-1.5 text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isEditFormDirty ? 'Annulla' : 'Chiudi'}
                    </button>
                    {isEditFormDirty && (
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{savingEdit ? 'Salvataggio...' : 'Salva modifiche'}</span>
                      </button>
                    )}
                  </div>
                </form>
              );
            }

            const hasExternal = Boolean(effectiveItem.imageUrl) && !imageBroken;
            const displayThumb = hasExternal
              ? effectiveItem.imageUrl!
              : attachedThumbnails[item.id] || '';
            const effectiveBrand = inferProductBrand(effectiveItem);
            const hasUniqueNotes =
              Boolean(item.notes) &&
              (!item.specs || !item.specs.includes(item.notes!.slice(0, 40)));
            const hasExtraDetails = filteredSpecEntries.length > defaultVisibleSpecsCount;
            const isList = viewMode === 'list';

            const renderRoomControl = () =>
              readOnly ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-300 shrink-0">
                  <Home className="w-3 h-3 text-sky-400" />
                  <span>{currentRoomLabel}</span>
                </span>
              ) : (
                <label className="inline-flex items-center gap-1 text-[11px] text-slate-300 shrink-0">
                  <Home className="w-3 h-3 text-sky-400 shrink-0" />
                  <select
                    aria-label={`Stanza per ${effectiveItem.title}`}
                    value={currentRoomId}
                    onChange={(e) => handleQuickRoomChange(item, e.target.value)}
                    className="max-w-[135px] sm:max-w-none bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-md px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] text-slate-200 [color-scheme:dark] focus:outline-none focus:border-sky-500"
                  >
                    <option value="">Nessuna stanza</option>
                    {RESEARCH_ROOMS.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {rm.label}
                      </option>
                    ))}
                  </select>
                </label>
              );

            const renderPaidPriceControl = () => {
              if (effectiveItem.status !== 'acquistato') return null;
              return inlinePaidEditId === item.id && !readOnly ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1000000"
                    autoFocus
                    value={inlinePaidValue}
                    onChange={(e) => setInlinePaidValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveInlinePaidPrice(item);
                      } else if (e.key === 'Escape') {
                        setInlinePaidEditId(null);
                      }
                    }}
                    placeholder="Pagato €"
                    className="w-24 px-2 py-0.5 text-[11px] font-mono bg-slate-950 border border-emerald-500/60 rounded text-emerald-200 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveInlinePaidPrice(item)}
                    className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500 text-slate-950 rounded hover:bg-emerald-400"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setInlinePaidEditId(null)}
                    className="p-0.5 text-slate-500 hover:text-slate-200"
                    aria-label="Annulla prezzo pagato"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : typeof effectiveItem.paidPriceEur === 'number' ? (
                readOnly ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-400 whitespace-nowrap">
                    Pagato: € {effectiveItem.paidPriceEur.toFixed(2)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setInlinePaidEditId(item.id);
                      setInlinePaidValue(String(effectiveItem.paidPriceEur));
                    }}
                    title="Modifica prezzo pagato all'acquisto"
                    className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-400 hover:text-emerald-300 whitespace-nowrap"
                  >
                    <span>Pagato: € {effectiveItem.paidPriceEur.toFixed(2)}</span>
                    <Pencil className="w-2.5 h-2.5 opacity-70" />
                  </button>
                )
              ) : !readOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    setInlinePaidEditId(item.id);
                    setInlinePaidValue(
                      typeof effectiveItem.priceEur === 'number'
                        ? String(effectiveItem.priceEur)
                        : ''
                    );
                  }}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-emerald-300 whitespace-nowrap"
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>Prezzo pagato</span>
                </button>
              ) : null;
            };

            const renderStatusControl = () =>
              readOnly ? (
                <span
                  className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border whitespace-nowrap ${statusMeta.badgeClass}`}
                >
                  {statusMeta.label}
                </span>
              ) : (
                <select
                  aria-label={`Stato per ${effectiveItem.title}`}
                  value={effectiveItem.status}
                  onChange={(e) =>
                    handleQuickStatusChange(item, e.target.value as ProductResearchStatus)
                  }
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md border [color-scheme:dark] focus:outline-none ${statusMeta.badgeClass}`}
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
              );

            const renderCardActionButtons = (inListFooter: boolean) => (
              <div
                className={
                  inListFooter
                    ? 'py-1.5 px-2 sm:pt-2 sm:px-3 sm:pb-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between sm:justify-start gap-1 sm:gap-1.5 bg-slate-950/30'
                    : 'pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2'
                }
              >
                <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-1 ${
                      inListFooter ? 'px-2 py-1 sm:px-2.5 sm:py-1.5' : 'px-2.5 py-1.5'
                    } text-[11px] font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap`}
                  >
                    <ExternalLink className="w-3 h-3" />
                    {inListFooter ? (
                      <>
                        <span className="sm:hidden">Apri</span>
                        <span className="hidden sm:inline">Apri pagina</span>
                      </>
                    ) : (
                      <span>Apri pagina</span>
                    )}
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl(item)}
                    title="Copia link"
                    aria-label="Copia link"
                    className={`inline-flex items-center gap-1 ${
                      inListFooter ? 'p-1.5 sm:px-2 sm:py-1.5' : 'px-2 py-1.5'
                    } text-[11px] font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap`}
                  >
                    {copiedId === item.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span className={inListFooter ? 'hidden sm:inline' : ''}>
                      {copiedId === item.id ? 'Copiato' : 'Copia'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareItem(buildResearchSharePayload(effectiveItem))}
                    title="Condividi prodotto"
                    aria-label="Condividi prodotto"
                    className="p-1.5 text-slate-400 hover:text-sky-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>

                  {inListFooter && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenAttachmentsIds((prev) => ({
                          ...prev,
                          [item.id]: !isAttachOpen,
                        }))
                      }
                      title={`Allegati (${itemDocs.length})`}
                      className="inline-flex items-center gap-1 px-1.5 py-1 sm:px-2 sm:py-1.5 text-[11px] font-medium text-slate-300 hover:text-sky-300 bg-slate-800/80 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Paperclip className="w-3 h-3 text-sky-400" />
                      <span className="sm:hidden tabular-nums">{itemDocs.length}</span>
                      <span className="hidden sm:inline">Allegati ({itemDocs.length})</span>
                    </button>
                  )}
                  {inListFooter && !readOnly && (
                    <button
                      type="button"
                      disabled={isUploadingHere}
                      onClick={() => triggerCardFileUpload(item)}
                      title="Allega file"
                      aria-label="Allega file"
                      className="inline-flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 text-[11px] font-medium text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {isUploadingHere ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                      <span className="hidden sm:inline">
                        {isUploadingHere ? 'Carico...' : 'Allega'}
                      </span>
                    </button>
                  )}
                </div>

                {!readOnly && (
                  <div
                    className={`flex items-center gap-0.5 sm:gap-1 ${
                      inListFooter ? 'sm:pl-1.5 sm:border-l sm:border-slate-800' : ''
                    }`}
                  >
                    <button
                      type="button"
                      disabled={isRefreshingHere}
                      onClick={() => setPendingRefresh(item)}
                      aria-label="Aggiorna prodotto"
                      title="Aggiorna prodotto dal sito (foto, prezzo, colore e dettagli)"
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
                        className={`inline-flex items-center gap-1 px-1.5 py-1 sm:px-2 sm:py-1.5 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap ${
                          movedArticleIds[item.id]
                            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                            : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40'
                        }`}
                      >
                        <PackagePlus className="w-3 h-3" />
                        {inListFooter ? (
                          <>
                            <span className="sm:hidden">
                              {movedArticleIds[item.id] ? 'OK' : 'Articoli'}
                            </span>
                            <span className="hidden sm:inline">
                              {movedArticleIds[item.id] ? 'In Articoli' : 'Ad Articoli'}
                            </span>
                          </>
                        ) : (
                          <span>
                            {movedArticleIds[item.id] ? 'In Articoli' : 'Ad Articoli'}
                          </span>
                        )}
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
            );

            return (
              <article
                key={item.id}
                className={`bg-slate-900 border rounded-xl overflow-hidden flex flex-col transition-colors ${
                  hasPendingEdits
                    ? 'border-amber-400/70 ring-1 ring-amber-400/20'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className={isList ? 'flex flex-row items-start flex-1 min-w-0' : 'flex flex-col flex-1 min-w-0'}>
                  {/* Product Media Showcase */}
                  {displayThumb ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className={
                        isList
                          ? 'group relative w-20 h-20 m-2 sm:w-36 md:w-40 sm:h-36 sm:self-start sm:m-2.5 rounded-lg bg-white border border-slate-800/80 flex items-center justify-center p-1 sm:p-1.5 overflow-hidden shrink-0'
                          : 'group relative h-56 w-full bg-white border-b border-slate-800/80 flex items-center justify-center p-2.5 overflow-hidden shrink-0'
                      }
                    >
                      <img
                        src={displayThumb}
                        alt={effectiveItem.title}
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (hasExternal) {
                            setBrokenImages((prev) => ({ ...prev, [item.id]: true }));
                          }
                        }}
                        className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    </a>
                  ) : (
                    <div
                      className={
                        isList
                          ? 'relative w-20 h-20 m-2 sm:w-36 md:w-40 sm:h-36 sm:self-start sm:m-2.5 rounded-lg bg-gradient-to-b from-slate-800/40 to-slate-950/90 border border-slate-800 flex flex-col items-center justify-center gap-1 p-1.5 sm:p-2.5 text-center shrink-0'
                          : 'relative h-56 w-full bg-gradient-to-b from-slate-800/40 to-slate-950/90 border-b border-slate-800 flex flex-col items-center justify-center gap-2.5 p-4 text-center shrink-0'
                      }
                    >
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex flex-col items-center gap-0.5 sm:gap-1 text-slate-400 hover:text-sky-300 transition-colors"
                      >
                        {effectiveItem.imageUrl ? (
                          <ImageOff className={isList ? 'w-4 h-4 sm:w-6 sm:h-6 text-slate-500' : 'w-8 h-8 text-slate-500'} />
                        ) : (
                          <ShoppingBag className={isList ? 'w-4 h-4 sm:w-6 sm:h-6 text-slate-500' : 'w-8 h-8 text-slate-500'} />
                        )}
                        <span className={isList ? 'text-[10px] sm:text-xs font-semibold text-slate-300 truncate max-w-full' : 'text-xs font-semibold text-slate-300'}>
                          {item.store}
                        </span>
                        <span className={isList ? 'hidden sm:inline text-[10px] text-slate-500 leading-tight' : 'text-[10px] text-slate-500 leading-tight'}>
                          {effectiveItem.imageUrl
                            ? 'Immagine non disponibile'
                            : 'Anteprima foto non disponibile'}
                        </span>
                      </a>
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={isUploadingHere}
                          onClick={() => triggerCardFileUpload(item, 'targhetta_pnc')}
                          className={`inline-flex items-center gap-1 ${
                            isList
                              ? 'px-1.5 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-[11px]'
                              : 'px-2.5 py-1 text-[11px]'
                          } font-medium text-sky-300 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 rounded-md sm:rounded-lg transition-colors disabled:opacity-50`}
                        >
                          <Upload className={isList ? 'w-2.5 h-2.5 sm:w-3 sm:h-3' : 'w-3 h-3'} />
                          {isList ? (
                            <>
                              <span className="sm:hidden">{isUploadingHere ? '...' : 'Foto'}</span>
                              <span className="hidden sm:inline">{isUploadingHere ? 'Carico...' : 'Carica foto'}</span>
                            </>
                          ) : (
                            <span>{isUploadingHere ? 'Carico...' : 'Carica foto'}</span>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Card Body */}
                  <div
                    className={
                      isList
                        ? 'py-2 pr-2.5 pl-0 sm:py-2.5 sm:pr-3 sm:pl-0.5 flex-1 flex flex-col gap-1.5 sm:gap-2 min-w-0'
                        : 'p-3.5 flex-1 flex flex-col gap-2.5 min-w-0'
                    }
                  >
                  {isList ? (
                    /* LIST MODE HEADER: Meta + Title + Room on left, Price + Paid + Status compactly on right */
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-1.5 sm:gap-2 pb-1.5 sm:pb-2 border-b border-slate-800/80">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-0.5 text-[10px] sm:text-[11px] font-medium text-slate-400">
                          {effectiveBrand && (
                            <span
                              className="inline-flex items-center gap-1 text-sky-300 font-semibold"
                              title={`Marca: ${effectiveBrand}`}
                            >
                              <Tag className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                              <span>{effectiveBrand}</span>
                            </span>
                          )}
                          {(!effectiveBrand ||
                            effectiveBrand.toLowerCase() !== item.store.toLowerCase()) && (
                            <span
                              className="inline-flex items-center gap-1 text-slate-200 font-medium"
                              title={`Negozio: ${item.store}`}
                            >
                              <Store className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-400 shrink-0" />
                              <span>{item.store}</span>
                            </span>
                          )}
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span>{getCategoryLabel(item.category)}</span>
                          <span className="text-slate-700 hidden sm:inline" aria-hidden="true">
                            |
                          </span>
                          {renderRoomControl()}
                        </div>

                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[13px] sm:text-sm font-semibold text-slate-100 hover:text-sky-300 leading-snug break-words line-clamp-2 sm:line-clamp-none"
                        >
                          {effectiveItem.title}
                        </a>
                      </div>

                      <div className="flex flex-wrap items-center md:flex-col md:items-end justify-between gap-1.5 shrink-0 md:border-l md:border-slate-800/80 md:pl-3">
                        <div className="flex flex-wrap items-baseline md:justify-end gap-x-2 gap-y-0.5">
                          {typeof effectiveItem.priceEur === 'number' ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-sm sm:text-base md:text-lg font-bold text-white tabular-nums leading-none">
                              <span>€ {effectiveItem.priceEur.toFixed(2)}</span>
                              {lazySizePriceLoadingIds[item.id] && (
                                <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                              )}
                            </span>
                          ) : (
                            <span className="text-[11px] sm:text-xs text-slate-500">Prezzo non rilevato</span>
                          )}
                          {renderPaidPriceControl()}
                        </div>
                        {renderStatusControl()}
                      </div>
                    </div>
                  ) : (
                    /* GRID MODE HEADER: 1. Meta + Room -> 2. Title */
                    <>
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

                        {renderRoomControl()}
                      </div>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-sm font-semibold text-slate-100 hover:text-sky-300 leading-snug break-words"
                      >
                        {effectiveItem.title}
                      </a>
                    </>
                  )}

                  {/* 3. Product Colors + Sizes + Model Code (inline wrap in list mode for compact height) */}
                  {(effectiveItem.color ||
                    (item.availableColors && item.availableColors.length > 0) ||
                    effectiveItem.size ||
                    (item.availableSizes && item.availableSizes.length > 0) ||
                    item.model) && (
                    <div
                      className={
                        isList
                          ? 'flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400'
                          : 'space-y-1.5 text-xs text-slate-400'
                      }
                    >
                      {item.availableColors && item.availableColors.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-0.5">
                            Colori:
                          </span>
                          {item.availableColors.map((colOpt) => {
                            const isActive =
                              effectiveItem.color?.trim().toLowerCase() ===
                              colOpt.trim().toLowerCase();
                            return readOnly ? (
                              <span
                                key={colOpt}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${
                                  isActive
                                    ? 'bg-sky-500/15 border-sky-400/70 text-slate-100 font-semibold'
                                    : 'bg-slate-950/70 border-slate-800 text-slate-400'
                                }`}
                              >
                                <ColorSwatchDot color={colOpt} size="sm" />
                                <span>{colOpt}</span>
                              </span>
                            ) : (
                              <button
                                key={colOpt}
                                type="button"
                                onClick={() => handleQuickColorSelect(item, colOpt)}
                                title={`Seleziona colore ${colOpt}`}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] transition-colors ${
                                  isActive
                                    ? 'bg-sky-500/15 border-sky-400/70 text-slate-100 font-semibold'
                                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
                                }`}
                              >
                                <ColorSwatchDot color={colOpt} size="sm" />
                                <span>{colOpt}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : effectiveItem.color ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="inline-flex items-center gap-1.5 text-slate-200 font-medium"
                            title={`Colore: ${effectiveItem.color}`}
                          >
                            <ColorSwatchDot color={effectiveItem.color} size="md" />
                            <span>{effectiveItem.color}</span>
                          </span>
                        </div>
                      ) : null}

                      {item.availableSizes && item.availableSizes.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-0.5">
                            Taglia:
                          </span>
                          {item.availableSizes.map((sizeOpt) => {
                            const isActive =
                              effectiveItem.size?.trim().toLowerCase().replace(/\s+/g, '') ===
                              sizeOpt.trim().toLowerCase().replace(/\s+/g, '');
                            const optPrice = findSizePrice(effectiveItem.sizePrices, sizeOpt);
                            const sizeTooltip =
                              typeof optPrice === 'number'
                                ? `Seleziona taglia ${sizeOpt} · € ${optPrice.toFixed(2)}`
                                : `Seleziona taglia ${sizeOpt}`;
                            return readOnly ? (
                              <span
                                key={sizeOpt}
                                title={sizeTooltip}
                                className={`px-2 py-0.5 rounded-md border font-mono text-[11px] ${
                                  isActive
                                    ? 'bg-sky-500/15 border-sky-400/70 text-sky-200 font-semibold'
                                    : 'bg-slate-950/70 border-slate-800 text-slate-400'
                                }`}
                              >
                                {sizeOpt}
                              </span>
                            ) : (
                              <button
                                key={sizeOpt}
                                type="button"
                                onClick={() => handleQuickSizeSelect(item, sizeOpt)}
                                title={sizeTooltip}
                                className={`px-2 py-0.5 rounded-md border font-mono text-[11px] transition-colors ${
                                  isActive
                                    ? 'bg-sky-500/15 border-sky-400/70 text-sky-200 font-semibold'
                                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
                                }`}
                              >
                                {sizeOpt}
                              </button>
                            );
                          })}
                        </div>
                      ) : effectiveItem.size ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-md border border-slate-700 bg-slate-950 font-mono text-[11px] text-slate-200">
                            {effectiveItem.size}
                          </span>
                        </div>
                      ) : null}

                      {item.model && (
                        <div className="font-mono text-[11px] text-slate-400">
                          Cod. {item.model}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4. Grid Mode Price + Paid Price + Status Row */}
                  {!isList && (
                    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-y border-slate-800/80">
                      <div className="flex flex-col gap-1 min-w-0">
                        {typeof effectiveItem.priceEur === 'number' ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-lg font-bold text-white tabular-nums leading-none">
                            <span>€ {effectiveItem.priceEur.toFixed(2)}</span>
                            {lazySizePriceLoadingIds[item.id] && (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Prezzo non rilevato</span>
                        )}
                        {renderPaidPriceControl()}
                      </div>

                      {renderStatusControl()}
                    </div>
                  )}

                  {/* 5. Specifications & Notes with Vedi tutti i dettagli / Mostra meno in both Grid & List */}
                  {(filteredSpecEntries.length > 0 || hasUniqueNotes) && (
                    <div className={isList ? 'space-y-1' : 'space-y-2'}>
                      {hasUniqueNotes && (
                        <p
                          className={`text-xs text-slate-300 leading-relaxed whitespace-pre-line break-words ${
                            isList && !isSpecsExpanded ? 'line-clamp-1 sm:line-clamp-none' : ''
                          }`}
                        >
                          {item.notes}
                        </p>
                      )}

                      {visibleTechSpecs.length > 0 && (
                        <ul
                          className={
                            isList
                              ? `${isSpecsExpanded ? 'grid' : 'hidden sm:grid'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5 text-[11px] text-slate-300 leading-snug`
                              : 'space-y-1 text-[11px] text-slate-300 leading-relaxed'
                          }
                        >
                          {visibleTechSpecs.map((entry, idx) => {
                            const isColorSpec =
                              entry.label?.toLowerCase() === 'colore' ||
                              entry.label?.toLowerCase() === 'color';
                            return (
                              <li key={`tech-${idx}`} className="flex items-start gap-1.5 min-w-0">
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
                                  ) : (
                                    <>
                                      <span className="text-slate-400">{entry.label}: </span>
                                      <span className="text-slate-200 font-medium">
                                        {entry.value}
                                      </span>
                                    </>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {visibleDescriptiveSpecs.length > 0 && (
                        <ul
                          className={
                            isList
                              ? `${isSpecsExpanded ? 'grid' : 'hidden sm:grid'} ${
                                  visibleTechSpecs.length > 0
                                    ? 'pt-2 mt-1.5 border-t border-slate-800/70 '
                                    : ''
                                }grid-cols-1 ${
                                  visibleDescriptiveSpecs.length === 2
                                    ? 'md:grid-cols-2'
                                    : visibleDescriptiveSpecs.length >= 3
                                      ? 'md:grid-cols-3'
                                      : ''
                                } gap-x-4 gap-y-1.5 text-[11px] text-slate-300 leading-snug`
                              : `${
                                  visibleTechSpecs.length > 0
                                    ? 'pt-1.5 mt-1.5 border-t border-slate-800/70 '
                                    : ''
                                }space-y-1 text-[11px] text-slate-300 leading-relaxed`
                          }
                        >
                          {visibleDescriptiveSpecs.map((entry, idx) => {
                            const dashIdx = entry.value.indexOf(' — ');
                            const hasLeadHeadline = dashIdx > 2 && dashIdx <= 90;
                            return (
                              <li key={`desc-${idx}`} className="flex items-start gap-1.5 min-w-0">
                                <span className="text-sky-400 shrink-0">·</span>
                                <span className="min-w-0 break-words">
                                  {hasLeadHeadline ? (
                                    <>
                                      <span className="text-slate-100 font-semibold">
                                        {entry.value.slice(0, dashIdx)}
                                      </span>
                                      <span className="text-slate-300">
                                        {entry.value.slice(dashIdx)}
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

                      {(hasExtraDetails || (isList && filteredSpecEntries.length > 0)) && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSpecsIds((prev) => ({
                              ...prev,
                              [item.id]: !prev[item.id],
                            }))
                          }
                          className={`${
                            hasExtraDetails ? 'inline-flex' : 'inline-flex sm:hidden'
                          } items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium`}
                        >
                          {isSpecsExpanded ? (
                            <>
                              <ChevronUp className="w-3 h-3" />
                              Mostra meno
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3" />
                              Vedi tutti i dettagli ({filteredSpecEntries.length})
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Pending Quick Card Edits Confirmation Bar */}
                  {hasPendingEdits && !readOnly && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/40 text-[11px]">
                      <span className="text-amber-200 font-medium inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                        Modifiche non salvate
                      </span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        <button
                          type="button"
                          disabled={isSavingPendingHere}
                          onClick={() => handleDiscardPendingCardEdit(item.id)}
                          className="px-2 py-1 text-slate-300 hover:text-slate-100 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 rounded-md transition-colors disabled:opacity-50"
                        >
                          Annulla
                        </button>
                        <button
                          type="button"
                          disabled={isSavingPendingHere || savingEdit}
                          onClick={() => requestCommitPendingCardEdit(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors disabled:opacity-50"
                        >
                          {isSavingPendingHere ||
                          (savingEdit && pendingEditSave?.item.id === item.id) ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          <span>
                            {isSavingPendingHere ||
                            (savingEdit && pendingEditSave?.item.id === item.id)
                              ? 'Salvataggio...'
                              : 'Salva modifiche'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 6. Bottom-pinned Attachments & Actions */}
                  <div className={isList ? 'mt-auto space-y-2' : 'mt-auto space-y-2.5 pt-1'}>
                    {/* In Grid mode show attachments header row; in List mode show drawer only when expanded/populated */}
                    {(!isList && (isAttachOpen || !readOnly)) || (isList && isAttachOpen) ? (
                      <div className="border-t border-slate-800/70 pt-2 space-y-2">
                        {!isList && (
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
                        )}

                        {!readOnly && isAttachOpen && (
                          <div className="flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="text-slate-400 shrink-0">Tipo allegato:</span>
                            <select
                              value={selectedAttachType}
                              onChange={(e) =>
                                setCardAttachType((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value as ArticleAttachmentType,
                                }))
                              }
                              className="flex-1 min-w-[140px] max-w-xs px-2 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 [color-scheme:dark]"
                            >
                              {ATTACHMENT_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            {isList && (
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
                                <span>{isUploadingHere ? 'Carico...' : 'Carica file'}</span>
                              </button>
                            )}
                          </div>
                        )}

                        {itemDocs.length > 0 && (
                          <div className={isList ? 'grid grid-cols-1 md:grid-cols-2 gap-1.5' : 'space-y-1.5'}>
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
                    ) : null}

                    {!isList && renderCardActionButtons(false)}
                  </div>
                </div>
                </div>

                {isList && renderCardActionButtons(true)}
              </article>
            );
              };

              const listOrGridClass =
                viewMode === 'list'
                  ? 'flex flex-col gap-3'
                  : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 items-stretch';

              if (groupByRoom) {
                return (
                  <div className="space-y-6">
                    {groupedByRoom.map((group) => (
                      <section key={group.key} className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                          <div className="flex items-center gap-2 min-w-0">
                            <Home className="w-4 h-4 text-sky-400 shrink-0" />
                            <h4 className="text-base font-semibold text-slate-100 truncate">
                              {group.label}
                            </h4>
                            <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                              · {group.items.length}{' '}
                              {group.items.length === 1 ? 'articolo' : 'articoli'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                            <span className="text-slate-400">
                              Valore:{' '}
                              <strong className="font-mono text-slate-100">
                                {formatEuroIt(group.listTotal)}
                              </strong>
                            </span>
                            {group.paidCount > 0 && (
                              <span className="text-slate-400">
                                Pagato:{' '}
                                <strong className="font-mono text-emerald-400">
                                  {formatEuroIt(group.paidTotal)}
                                </strong>{' '}
                                <span className="text-slate-500">
                                  ({group.paidCount}/{group.items.length})
                                </span>
                              </span>
                            )}
                            {selectedRooms.length === 0 && (
                              <button
                                type="button"
                                onClick={() => setSelectedRooms([group.key])}
                                className="px-2.5 py-1 text-[11px] font-medium text-sky-300 hover:text-sky-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors whitespace-nowrap"
                              >
                                Filtra stanza
                              </button>
                            )}
                          </div>
                        </div>

                        <div className={listOrGridClass}>
                          {group.items.map((item) => renderResearchCard(item))}
                        </div>
                      </section>
                    ))}
                  </div>
                );
              }

              return (
                <div className={listOrGridClass}>
                  {filteredResearches.map((item) => renderResearchCard(item))}
                </div>
              );
            })()}
          </>
        );
      })()}

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

      {pendingRefresh && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-sky-500/15 text-sky-400 shrink-0">
                <RefreshCw
                  className={`w-5 h-5 ${
                    refreshingId === pendingRefresh.id ? 'animate-spin' : ''
                  }`}
                />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Aggiornare questo prodotto?
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Vuoi ri-analizzare il link di{' '}
                  <span className="font-semibold text-slate-100">
                    {pendingRefresh.title}
                  </span>{' '}
                  ({pendingRefresh.store}) per aggiornare foto, prezzo, varianti e dettagli su Firestore?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={refreshingId === pendingRefresh.id}
                onClick={() => setPendingRefresh(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={refreshingId === pendingRefresh.id}
                onClick={() => void confirmRefreshResearch()}
                className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors"
              >
                {refreshingId === pendingRefresh.id ? 'Aggiornamento...' : 'Aggiorna'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingEditSave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400 shrink-0">
                <Pencil className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Salvare le modifiche al prodotto?
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Vuoi aggiornare{' '}
                  <span className="font-semibold text-slate-100">
                    {pendingEditSave.payload.title}
                  </span>{' '}
                  ({pendingEditSave.payload.store}) salvando i nuovi dati su Firestore?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setPendingEditSave(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void confirmSaveEdit()}
                className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg transition-colors"
              >
                {savingEdit ? 'Salvataggio...' : 'Salva modifiche'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
