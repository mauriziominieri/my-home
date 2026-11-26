import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import {
  getSimulatedFirestoreOps,
  SimulatedFirestoreOp,
  subscribeFirestoreQuotaExceeded,
  subscribeSimulatedFirestoreOps,
} from '../firebase';
import { useAppSettings } from '../utils/appSettings';
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
  computeMissingLiveOptions,
  findColorImageUrl,
  findColorNameForHex,
  findSizePrice,
  getResearchRoomLabel,
  inferProductBrand,
  inferResearchRoom,
  mergePreservedVariantOptions,
  normalizeBrandName,
  normalizeColorOptionKey,
  normalizeResearchRoom,
  normalizeSizeOptionKey,
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

interface InspectedDocumentLink {
  title: string;
  url: string;
  kind?: 'manuale' | 'scheda' | 'bim_3d' | 'certificato';
}

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
  onAddResearchDocumentLink?: (
    researchId: string,
    docType: ArticleAttachmentType,
    title: string,
    provider: string,
    cloudUrl: string,
    noteText?: string
  ) => Promise<void>;
  onUpdateResearchDocumentType?: (
    docId: string,
    researchId: string,
    docType: ArticleAttachmentType
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
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  },
  {
    value: 'manuale',
    label: "Manuale / Scheda PDF",
    badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30',
  },
  {
    value: 'garanzia_extra_family',
    label: 'Garanzia / Extra Family',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  },
  {
    value: 'targhetta_pnc',
    label: 'Foto / Etichetta',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  },
  {
    value: 'altro',
    label: 'Altro allegato',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700/60 dark:text-slate-300 dark:border-slate-600/50',
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
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  },
  {
    value: 'da_acquistare',
    label: 'Da acquistare',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-400/40',
  },
  {
    value: 'acquistato',
    label: 'Acquistato',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/40',
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
const COLOR_IMAGES_CACHE_STORAGE_KEY = 'myhome_researches_color_images_v1';
const UNAVAILABLE_VARIANTS_CACHE_STORAGE_KEY = 'myhome_researches_unavailable_variants_v1';

let backendApiUnavailable =
  typeof window !== 'undefined' &&
  (window.location.hostname.endsWith('.github.io') || import.meta.env.BASE_URL !== '/');

function isBackendApiUnavailable(): boolean {
  return backendApiUnavailable;
}

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
    const existing = sanitizeSizePricesMap(parsed?.[key]) || {};
    const merged = sanitizeSizePricesMap({ ...existing, ...clean }) || clean;
    const next: Record<string, Record<string, number>> = { ...parsed, [key]: merged };
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

function readCachedColorImages(url?: string): Record<string, string> | undefined {
  if (typeof window === 'undefined' || !url) return undefined;
  const key = buildSizePriceCacheKey(url);
  if (!key) return undefined;
  try {
    const raw = window.localStorage.getItem(COLOR_IMAGES_CACHE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return sanitizeColorImagesMap(parsed?.[key]);
  } catch {
    return undefined;
  }
}

function writeCachedColorImages(
  url: string | undefined,
  colorImages: Record<string, string> | undefined
) {
  if (typeof window === 'undefined' || !url || !colorImages) return;
  const clean = sanitizeColorImagesMap(colorImages);
  const key = buildSizePriceCacheKey(url);
  if (!clean || !key) return;
  try {
    const raw = window.localStorage.getItem(COLOR_IMAGES_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, Record<string, string>>) : {};
    const existing = sanitizeColorImagesMap(parsed?.[key]) || {};
    const merged = sanitizeColorImagesMap({ ...existing, ...clean }) || clean;
    const next: Record<string, Record<string, string>> = { ...parsed, [key]: merged };
    const keys = Object.keys(next);
    if (keys.length > 60) {
      for (const oldKey of keys.slice(0, keys.length - 60)) {
        delete next[oldKey];
      }
    }
    window.localStorage.setItem(COLOR_IMAGES_CACHE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
}

interface UnavailableVariantsEntry {
  sizes?: string[];
  colors?: string[];
}

function sanitizeUnavailableVariantsEntry(raw: unknown): UnavailableVariantsEntry | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as { sizes?: unknown; colors?: unknown };
  const sizes = Array.isArray(obj.sizes)
    ? obj.sizes.map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 24)
    : [];
  const colors = Array.isArray(obj.colors)
    ? obj.colors.map((c) => String(c).trim().slice(0, 60)).filter(Boolean).slice(0, 24)
    : [];
  if (sizes.length === 0 && colors.length === 0) return undefined;
  return {
    ...(sizes.length > 0 ? { sizes } : {}),
    ...(colors.length > 0 ? { colors } : {}),
  };
}

function readCachedUnavailableVariants(url?: string): UnavailableVariantsEntry | undefined {
  if (typeof window === 'undefined' || !url) return undefined;
  const key = buildSizePriceCacheKey(url);
  if (!key) return undefined;
  try {
    const raw = window.localStorage.getItem(UNAVAILABLE_VARIANTS_CACHE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return sanitizeUnavailableVariantsEntry(parsed?.[key]);
  } catch {
    return undefined;
  }
}

function writeCachedUnavailableVariants(
  url: string | undefined,
  entry: UnavailableVariantsEntry | undefined
) {
  if (typeof window === 'undefined' || !url) return;
  const key = buildSizePriceCacheKey(url);
  if (!key) return;
  try {
    const raw = window.localStorage.getItem(UNAVAILABLE_VARIANTS_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, UnavailableVariantsEntry>) : {};
    const clean = sanitizeUnavailableVariantsEntry(entry);
    const next: Record<string, UnavailableVariantsEntry> = { ...parsed };
    if (!clean) {
      delete next[key];
    } else {
      next[key] = clean;
    }
    const keys = Object.keys(next);
    if (keys.length > 60) {
      for (const oldKey of keys.slice(0, keys.length - 60)) {
        delete next[oldKey];
      }
    }
    window.localStorage.setItem(UNAVAILABLE_VARIANTS_CACHE_STORAGE_KEY, JSON.stringify(next));
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
        stroke="rgba(148,163,184,0.55)"
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
          className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 hover:border-sky-500 dark:hover:border-sky-400 cursor-pointer shrink-0 overflow-hidden"
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
            compact ? 'py-1.5 bg-white dark:bg-slate-950' : 'py-2 bg-white dark:bg-slate-900'
          } border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Rimuovi colore"
            className="p-1.5 text-slate-400 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
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
                    ? 'bg-sky-50 border-sky-500 text-sky-900 dark:bg-sky-500/20 dark:border-sky-400 dark:text-slate-100 font-semibold'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-600'
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
            compact ? 'py-1.5 bg-white dark:bg-slate-950' : 'py-2 bg-white dark:bg-slate-900'
          } border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Rimuovi taglia"
            className="p-1.5 text-slate-400 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
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
                    ? 'bg-sky-50 border-sky-500 text-sky-800 dark:bg-sky-500/20 dark:border-sky-400 dark:text-sky-200 font-semibold'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-600'
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

const LOCAL_DRAFT_PREFIX = 'local_draft_';

function isLocalDraftId(id: string): boolean {
  return id.startsWith(LOCAL_DRAFT_PREFIX);
}

function canonicalUrlForCompare(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (host.includes('amazon.') && asinMatch?.[1]) {
      const th = parsed.searchParams.get('th') || '';
      const psc = parsed.searchParams.get('psc') || '';
      return `${host}/dp/${asinMatch[1].toUpperCase()}${th ? `?th=${th}` : ''}${psc ? `&psc=${psc}` : ''}`;
    }
    const kept = new URLSearchParams();
    for (const [k, v] of parsed.searchParams.entries()) {
      const kl = k.toLowerCase();
      if (
        kl.startsWith('utm_') ||
        kl.startsWith('pd_rd_') ||
        kl.startsWith('pf_rd_') ||
        [
          'ref',
          'ref_',
          'crid',
          'dib',
          'dib_tag',
          'qid',
          'sprefix',
          'sr',
          'keywords',
          'sbo',
          'content-id',
          'aref',
          '_encoding',
          'fbclid',
          'gclid',
        ].includes(kl)
      ) {
        continue;
      }
      kept.set(k, v);
    }
    const qs = kept.toString();
    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${cleanPath}${qs ? `?${qs}` : ''}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

function normalizeStrArrForCompare(arr?: string[]): string {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return Array.from(
    new Set(arr.map((v) => String(v).trim()).filter(Boolean))
  )
    .slice(0, 24)
    .join('\u0001');
}

function normalizeColorImagesForCompare(map?: Record<string, string>): string {
  const clean = sanitizeColorImagesMap(map);
  if (!clean) return '';
  return JSON.stringify(
    Object.keys(clean)
      .sort()
      .map((k) => [k, clean[k]])
  );
}

function normalizeMoneyForCompare(val?: number): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return undefined;
  return Math.min(1000000, Math.round(val * 100) / 100);
}

function hasResearchPayloadChanges(
  existing: ProductResearchRecord,
  next: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>
): boolean {
  const normStatus = (s?: ProductResearchStatus) => s || 'da_valutare';
  const nextStatus = normStatus(next.status);
  const existingStatus = normStatus(existing.status);
  const existingPaid =
    existingStatus === 'acquistato' ? normalizeMoneyForCompare(existing.paidPriceEur) : undefined;
  const nextPaid =
    nextStatus === 'acquistato' ? normalizeMoneyForCompare(next.paidPriceEur) : undefined;

  return !(
    (normalizeUrlInput(existing.url) || existing.url.trim()) ===
      (normalizeUrlInput(next.url) || next.url.trim()) &&
    existing.title.trim().slice(0, 160) === next.title.trim().slice(0, 160) &&
    existing.store.trim().slice(0, 60) === next.store.trim().slice(0, 60) &&
    existing.category === next.category &&
    existingStatus === nextStatus &&
    (normalizeResearchRoom(existing.room) || '') === (normalizeResearchRoom(next.room) || '') &&
    normalizeMoneyForCompare(existing.priceEur) === normalizeMoneyForCompare(next.priceEur) &&
    existingPaid === nextPaid &&
    (existing.imageUrl || '').trim().slice(0, 1000) === (next.imageUrl || '').trim().slice(0, 1000) &&
    (existing.brand || '').trim().slice(0, 60) === (next.brand || '').trim().slice(0, 60) &&
    (existing.color || '').trim().slice(0, 60) === (next.color || '').trim().slice(0, 60) &&
    normalizeStrArrForCompare(existing.availableColors) ===
      normalizeStrArrForCompare(next.availableColors) &&
    normalizeColorImagesForCompare(existing.colorImages) ===
      normalizeColorImagesForCompare(next.colorImages) &&
    (existing.size || '').trim().slice(0, 60) === (next.size || '').trim().slice(0, 60) &&
    normalizeStrArrForCompare(existing.availableSizes) ===
      normalizeStrArrForCompare(next.availableSizes) &&
    (existing.model || '').trim().slice(0, 80) === (next.model || '').trim().slice(0, 80) &&
    (existing.specs || '').trim().slice(0, 2000) === (next.specs || '').trim().slice(0, 2000) &&
    (existing.notes || '').trim().slice(0, 400) === (next.notes || '').trim().slice(0, 400)
  );
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
      if (colonIdx > 1 && colonIdx < 42 && !/^https?:/i.test(line)) {
        return {
          label: line.slice(0, colonIdx).trim(),
          value: line.slice(colonIdx + 1).trim(),
        };
      }
      return { value: line };
    })
    .filter((entry) => Boolean(entry.value));
}

function splitSpecsAndInfo(raw?: string): { techSpecs: string; infoText: string } {
  if (!raw) return { techSpecs: '', infoText: '' };
  const techLines: string[] = [];
  const infoLines: string[] = [];
  for (const rawLine of raw.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('•') || line.startsWith('- ')) {
      const cleaned = line.replace(/^[•-]\s*/, '').trim();
      if (cleaned) infoLines.push(`• ${cleaned}`);
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx > 1 && colonIdx < 42 && !/^https?:/i.test(line)) {
      techLines.push(line);
    } else {
      infoLines.push(`• ${line}`);
    }
  }
  return {
    techSpecs: techLines.join('\n'),
    infoText: infoLines.join('\n'),
  };
}

function joinSpecsAndInfo(techSpecs: string, infoText: string): string {
  const techLines = techSpecs
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const infoLines = infoText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const cleaned = l.replace(/^[•-]\s*/, '').trim();
      return cleaned ? `• ${cleaned}` : '';
    })
    .filter(Boolean);
  const combined = [...techLines, ...infoLines].join('\n').trim();
  if (combined.length <= 2000) return combined;
  return combined.slice(0, 2000).trim();
}

function buildResearchSharePayload(item: ProductResearchRecord): ShareableItemPayload {
  const statusLabel = getStatusMeta(item.status).label;
  const roomLabel = getResearchRoomLabel(item.room);
  const resolvedBrand = inferProductBrand(item);
  const priceText = typeof item.priceEur === 'number' ? formatEuroIt(item.priceEur) : 'Non indicato';
  const paidText =
    item.status === 'acquistato' && typeof item.paidPriceEur === 'number'
      ? formatEuroIt(item.paidPriceEur)
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

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

interface CollapsibleColorChipsProps {
  colors: string[];
  activeColor?: string;
  unavailableColors?: string[];
  expanded: boolean;
  onToggleExpand: () => void;
  readOnly?: boolean;
  highlightActive?: boolean;
  onSelectColor: (color: string) => void;
}

function CollapsibleColorChips({
  colors,
  activeColor,
  unavailableColors,
  expanded,
  onToggleExpand,
  readOnly = false,
  highlightActive = false,
  onSelectColor,
}: CollapsibleColorChipsProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fitCount, setFitCount] = useState<number | null>(null);
  const [promotedColor, setPromotedColor] = useState<string | null>(null);

  const activeNorm = activeColor?.trim().toLowerCase() || '';

  useEffect(() => {
    if (expanded || !activeNorm) {
      setPromotedColor(null);
      return;
    }
    setPromotedColor((curr) =>
      curr && curr.trim().toLowerCase() === activeNorm ? curr : null
    );
  }, [expanded, activeNorm]);

  const orderedColors = useMemo(() => {
    if (!promotedColor || expanded) return colors;
    const promoNorm = promotedColor.trim().toLowerCase();
    const matched = colors.find((c) => c.trim().toLowerCase() === promoNorm);
    if (!matched) return colors;
    return [matched, ...colors.filter((c) => c !== matched)];
  }, [colors, promotedColor, expanded]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const computeFit = () => {
      const measureEl = measureRef.current;
      if (!measureEl) return;
      const parentEl = wrapper.parentElement;
      const availableWidth =
        parentEl && parentEl.clientWidth > 0 ? parentEl.clientWidth : wrapper.clientWidth;
      if (availableWidth > 0) {
        measureEl.style.width = `${availableWidth}px`;
      }
      const chipEls = Array.from(measureEl.querySelectorAll<HTMLElement>('[data-color-chip]'));
      if (chipEls.length === 0) {
        setFitCount(colors.length);
        return;
      }
      const firstTop = chipEls[0].offsetTop;
      let count = 0;
      for (const el of chipEls) {
        if (el.offsetTop <= firstTop + 3) {
          count += 1;
        } else {
          break;
        }
      }
      const safeCount = Math.max(1, count);
      setFitCount(safeCount);

      if (!expanded && activeNorm && safeCount < orderedColors.length) {
        const activeIdx = orderedColors.findIndex(
          (c) => c.trim().toLowerCase() === activeNorm
        );
        if (activeIdx >= safeCount) {
          setPromotedColor(orderedColors[activeIdx]);
        }
      }
    };

    computeFit();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => computeFit());
      ro.observe(wrapper.parentElement || wrapper);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', computeFit);
    return () => window.removeEventListener('resize', computeFit);
  }, [orderedColors, colors.length, expanded, activeNorm]);

  if (colors.length === 0) return null;

  const hasExtraColors = fitCount !== null && fitCount < orderedColors.length;
  const shownColors =
    expanded || fitCount === null ? orderedColors : orderedColors.slice(0, fitCount);

  return (
    <div ref={wrapperRef} className="relative space-y-1 shrink-0 max-w-full">
      {/* Hidden mirror row at parent available width to measure how many chips fit cleanly on 1 line */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="flex flex-wrap items-center gap-1 min-h-[24px] invisible absolute left-0 top-0 h-0 overflow-hidden pointer-events-none select-none"
      >
        <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-0.5 leading-none">
          Colori:
        </span>
        {orderedColors.map((colOpt) => (
          <span
            key={colOpt}
            data-color-chip="1"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] leading-4 font-semibold"
          >
            <ColorSwatchDot color={colOpt} size="sm" />
            <span>{colOpt}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
        <span
          className={`text-[10px] uppercase tracking-wide mr-0.5 leading-none ${
            highlightActive
              ? 'text-amber-700 dark:text-amber-300 font-semibold'
              : 'text-slate-500 dark:text-slate-500'
          }`}
        >
          Colori:
        </span>
        {shownColors.map((colOpt) => {
          const isActive = activeNorm === colOpt.trim().toLowerCase();
          const isMissingOnSite = Boolean(
            unavailableColors?.some(
              (u) => normalizeColorOptionKey(u) === normalizeColorOptionKey(colOpt)
            )
          );
          const activeClasses = highlightActive
            ? 'bg-amber-50 border-amber-500 text-amber-900 dark:bg-amber-500/20 dark:border-amber-400 dark:text-amber-100 font-semibold ring-1 ring-amber-400/60'
            : 'bg-sky-50 border-sky-500/80 text-sky-900 dark:bg-sky-500/15 dark:border-sky-400/70 dark:text-slate-100 font-semibold';
          const colorTitle = isMissingOnSite
            ? `Seleziona colore ${colOpt} (non più presente sul sito all'ultimo aggiornamento · opzione mantenuta)`
            : `Seleziona colore ${colOpt}`;
          return readOnly ? (
            <span
              key={colOpt}
              title={colorTitle}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] leading-4 ${
                isMissingOnSite ? 'border-dashed ' : ''
              }${
                isActive
                  ? activeClasses
                  : isMissingOnSite
                    ? 'bg-slate-50/70 border-slate-300 text-slate-500 dark:bg-slate-950/40 dark:border-slate-700 dark:text-slate-400 opacity-85'
                    : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-950/70 dark:border-slate-800 dark:text-slate-400'
              }`}
            >
              <ColorSwatchDot color={colOpt} size="sm" />
              <span>{colOpt}</span>
              {isMissingOnSite && (
                <span className="text-[9px] font-medium opacity-75">(storico)</span>
              )}
            </span>
          ) : (
            <button
              key={colOpt}
              type="button"
              onClick={() => onSelectColor(colOpt)}
              title={colorTitle}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] leading-4 transition-colors ${
                isMissingOnSite ? 'border-dashed ' : ''
              }${
                isActive
                  ? activeClasses
                  : isMissingOnSite
                    ? 'bg-slate-50/70 border-slate-300 text-slate-600 hover:border-slate-400 dark:bg-slate-950/40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 opacity-85'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 dark:bg-slate-950/70 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <ColorSwatchDot color={colOpt} size="sm" />
              <span>{colOpt}</span>
              {isMissingOnSite && (
                <span className="text-[9px] font-medium opacity-75">(storico)</span>
              )}
            </button>
          );
        })}
      </div>

      {hasExtraColors && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 font-medium"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Mostra meno
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Vedi tutti i colori ({colors.length})
            </>
          )}
        </button>
      )}
    </div>
  );
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
  onAddResearchDocumentLink,
  onUpdateResearchDocumentType,
  onDeleteResearchDocument,
  onMoveToArticles,
}: ResearchesViewProps) {
  const [linkInput, setLinkInput] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingDraftItems, setPendingDraftItems] = useState<ProductResearchRecord[]>([]);
  const [pendingDraftFoundDocs, setPendingDraftFoundDocs] = useState<
    Record<string, InspectedDocumentLink[]>
  >({});

  const allResearches = useMemo(
    () => [...pendingDraftItems, ...researches],
    [pendingDraftItems, researches]
  );

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
  const [draftTechSpecs, setDraftTechSpecs] = useState('');
  const [draftInfoText, setDraftInfoText] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<QueuedDraftAttachment[]>([]);
  const [draftFoundDocuments, setDraftFoundDocuments] = useState<InspectedDocumentLink[]>([]);
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
  const [editTechSpecs, setEditTechSpecs] = useState('');
  const [editInfoText, setEditInfoText] = useState('');
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
        docTypes?: Record<string, ArticleAttachmentType>;
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
  const [unavailableVariantsById, setUnavailableVariantsById] = useState<
    Record<string, UnavailableVariantsEntry>
  >({});
  const [lazySizePriceLoadingIds, setLazySizePriceLoadingIds] = useState<
    Record<string, boolean>
  >({});
  const lazyInspectingIdsRef = useRef<Set<string>>(new Set());
  const latestQuickColorRef = useRef<Record<string, string>>({});
  const latestQuickSizeRef = useRef<Record<string, string>>({});

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [expandedSpecsIds, setExpandedSpecsIds] = useState<Record<string, boolean>>({});
  const [expandedColorsIds, setExpandedColorsIds] = useState<Record<string, boolean>>({});
  const [openAttachmentsIds, setOpenAttachmentsIds] = useState<Record<string, boolean>>({});
  const [cardAttachType, setCardAttachType] = useState<Record<string, ArticleAttachmentType>>({});
  const [uploadingResearchId, setUploadingResearchId] = useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const cardFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetItemRef = useRef<ProductResearchRecord | null>(null);
  const uploadTargetDocTypeRef = useRef<ArticleAttachmentType | null>(null);
  const replaceLinkDocTargetRef = useRef<HomeDocumentRecord | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ProductResearchRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<{
    doc: HomeDocumentRecord;
    productTitle: string;
  } | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const [vaultDocUrls, setVaultDocUrls] = useState<Record<string, string>>({});
  const [pendingRefresh, setPendingRefresh] = useState<ProductResearchRecord | null>(null);
  const [pendingEditSave, setPendingEditSave] = useState<{
    item: ProductResearchRecord;
    payload: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'>;
    isNewDraft?: boolean;
    skipProductUpdate?: boolean;
    docTypeChanges?: Array<{
      docId: string;
      researchId: string;
      nextType: ArticleAttachmentType;
    }>;
  } | null>(null);
  const [shareItem, setShareItem] = useState<ShareableItemPayload | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [listCopied, setListCopied] = useState(false);
  const [movedArticleIds, setMovedArticleIds] = useState<Record<string, boolean>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const { settings: appSettings } = useAppSettings();
  const writesDisabled = appSettings.firestoreWritesDisabled;
  const [simulatedOps, setSimulatedOps] = useState<SimulatedFirestoreOp[]>([]);
  const [brokenImages, setBrokenImages] = useState<Record<string, string>>({});
  const [attachedThumbnails, setAttachedThumbnails] = useState<Record<string, string>>({});

  useEffect(() => {
    return subscribeSimulatedFirestoreOps(setSimulatedOps);
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!linkNotice) return;
    const timer = window.setTimeout(() => {
      setLinkNotice(null);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [linkNotice]);

  useEffect(() => {
    if (!linkError) return;
    const timer = window.setTimeout(() => {
      setLinkError(null);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [linkError]);

  const localQueueChangesById = useMemo(() => {
    const map: Record<
      string,
      { isNew: boolean; changedFields: Set<string>; details: string[] }
    > = {};
    const ensureEntry = (id: string) => {
      if (!map[id]) {
        map[id] = { isNew: false, changedFields: new Set<string>(), details: [] };
      }
      return map[id];
    };
    const pushDetail = (entry: { details: string[] }, detail: string) => {
      const colonIdx = detail.indexOf(':');
      if (colonIdx > 0) {
        const prefix = detail.slice(0, colonIdx + 1).toLowerCase();
        const existingIdx = entry.details.findIndex((d) =>
          d.toLowerCase().startsWith(prefix)
        );
        if (existingIdx >= 0) {
          entry.details[existingIdx] = detail;
          return;
        }
      }
      if (!entry.details.includes(detail)) {
        entry.details.push(detail);
      }
    };
    const handleTargetPath = (
      path: string | undefined,
      opFields?: string[],
      opDetails?: string[],
      opKind?: string,
      opData?: Record<string, unknown>
    ) => {
      if (!path) return;
      const resMatch = path.match(/\/productResearches\/([^/]+)$/);
      if (resMatch?.[1]) {
        const resId = resMatch[1];
        const entry = ensureEntry(resId);
        if (opFields?.includes('__new__')) {
          entry.isNew = true;
        }
        (opFields || []).forEach((f) => {
          if (f !== '__new__' && f !== '__delete__') {
            entry.changedFields.add(f);
          }
        });
        (opDetails || []).forEach((d) => pushDetail(entry, d));
        return;
      }
      const artMatch = path.match(/\/homeArticles\/([^/]+)$/);
      if (artMatch?.[1]) {
        const docId = artMatch[1];
        const serial = typeof opData?.serialNumber === 'string' ? opData.serialNumber : '';
        const parsedRef = parseResearchDocumentRef(serial);
        let targetResId = parsedRef?.researchId;
        if (!targetResId) {
          const matchedDoc = researchDocuments.find((d) => d.id === docId);
          targetResId = parseResearchDocumentRef(matchedDoc?.referenceCode)?.researchId;
        }
        if (targetResId) {
          const entry = ensureEntry(targetResId);
          entry.changedFields.add('attachments');
          pushDetail(
            entry,
            opKind === 'delete' ? 'Allegato rimosso' : 'Allegati aggiornati'
          );
        }
      }
    };

    for (const op of simulatedOps) {
      if (op.kind === 'set' || op.kind === 'delete') {
        handleTargetPath(op.path, op.changedFields, op.changedDetails, op.kind, op.data);
      } else if (op.kind === 'batch' && op.batchOps) {
        for (const sub of op.batchOps) {
          handleTargetPath(sub.path, op.changedFields, op.changedDetails, sub.op, sub.data);
        }
      }
    }
    return map;
  }, [simulatedOps, researchDocuments]);

  function hasQueuedOpForResearch(researchId: string): boolean {
    const ops = getSimulatedFirestoreOps();
    const targetSuffix = `/productResearches/${researchId}`;
    const linkedDocIds = new Set(
      researchDocuments
        .filter((d) => parseResearchDocumentRef(d.referenceCode)?.researchId === researchId)
        .map((d) => d.id)
    );
    const touchesPath = (path?: string, data?: Record<string, unknown>) => {
      if (!path) return false;
      if (path.endsWith(targetSuffix)) return true;
      const artMatch = path.match(/\/homeArticles\/([^/]+)$/);
      if (artMatch?.[1]) {
        if (linkedDocIds.has(artMatch[1])) return true;
        const serial = typeof data?.serialNumber === 'string' ? data.serialNumber : '';
        if (parseResearchDocumentRef(serial)?.researchId === researchId) return true;
      }
      return false;
    };
    return ops.some((op) => {
      if (op.kind === 'set' || op.kind === 'delete') {
        return touchesPath(op.path, op.data);
      }
      if (op.kind === 'batch' && op.batchOps) {
        return op.batchOps.some((sub) => touchesPath(sub.path, sub.data));
      }
      return false;
    });
  }

  useEffect(() => {
    return subscribeFirestoreQuotaExceeded((active) => {
      if (!active) return;
      setRefreshingId(null);
      setSavingPendingId(null);
      setSavingEdit(false);
      setSavingNew(false);
      setInspecting(false);
      setDeleting(false);
      setDeletingDocId(null);
      setUploadingResearchId(null);
      setMovingId(null);
      setLazySizePriceLoadingIds({});
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    async function hydrateVaultDocUrls() {
      const next: Record<string, string> = {};
      for (const docItem of researchDocuments) {
        const isLinkOnlyDoc = !docItem.fileSize && Boolean(docItem.cloudUrl);
        if (isLinkOnlyDoc || !docItem.attachmentKey) continue;
        try {
          const stored = await getVaultFile(docItem.attachmentKey);
          if (cancelled || !stored?.blob) continue;
          const fileName = stored.fileName || docItem.fileName || docItem.title;
          const rawMime = (
            stored.mimeType ||
            docItem.fileMime ||
            stored.blob.type ||
            ''
          ).toLowerCase();
          const isPdf = rawMime.includes('pdf') || /\.pdf$/i.test(fileName);
          const normalizedMime = isPdf
            ? 'application/pdf'
            : rawMime || 'application/octet-stream';
          const typedBlob =
            stored.blob.type === normalizedMime
              ? stored.blob
              : new Blob([stored.blob], { type: normalizedMime });
          const objUrl = URL.createObjectURL(typedBlob);
          createdUrls.push(objUrl);
          next[docItem.id] = objUrl;
        } catch {
          // fallback to on-demand fetch when user clicks
        }
      }
      if (!cancelled) {
        setVaultDocUrls(next);
      } else {
        createdUrls.forEach((u) => URL.revokeObjectURL(u));
      }
    }

    void hydrateVaultDocUrls();

    return () => {
      cancelled = true;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [researchDocuments]);

  useEffect(() => {
    if (!pendingDeleteDoc) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && deletingDocId !== pendingDeleteDoc?.doc.id) {
        setPendingDeleteDoc(null);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [pendingDeleteDoc, deletingDocId]);

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
      for (const item of allResearches) {
        if (isLocalDraftId(item.id)) continue;
        const effectiveImg = pendingCardEdits[item.id]?.imageUrl ?? item.imageUrl;
        const hasWorkingExternalImg = Boolean(effectiveImg) && brokenImages[item.id] !== effectiveImg;
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
  }, [allResearches, researchDocuments, brokenImages]);

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
    documents?: InspectedDocumentLink[];
    extractedFrom?: 'page-meta' | 'url-slug';
    blockedBySite?: boolean;
  }> {
    if (isBackendApiUnavailable()) {
      return clientFallbackInspectUrl(validUrl);
    }
    try {
      const resp = await fetchWithTimeout(
        '/api/researches/inspect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: validUrl, refresh }),
        },
        29_000
      );
      if (resp.status === 405 || resp.status === 404) {
        backendApiUnavailable = true;
        return clientFallbackInspectUrl(validUrl);
      }
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
          documents?: Array<{ title?: string; url?: string; kind?: string }>;
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
          const cleanDocs: InspectedDocumentLink[] = [];
          const seenDocUrls = new Set<string>();
          if (Array.isArray(data.documents)) {
            for (const d of data.documents) {
              const dUrl = typeof d?.url === 'string' ? d.url.trim() : '';
              const dTitle = typeof d?.title === 'string' ? d.title.trim() : '';
              if (!dUrl || !/^https?:\/\/.+/.test(dUrl) || !dTitle) continue;
              const norm = dUrl.split('#')[0].toLowerCase();
              if (seenDocUrls.has(norm)) continue;
              seenDocUrls.add(norm);
              const kind =
                d.kind === 'scheda' ||
                d.kind === 'bim_3d' ||
                d.kind === 'certificato' ||
                d.kind === 'manuale'
                  ? d.kind
                  : 'manuale';
              cleanDocs.push({
                title: dTitle.slice(0, 80),
                url: dUrl.slice(0, 1000),
                kind,
              });
              if (cleanDocs.length >= 8) break;
            }
          }
          const cleanColorImages = sanitizeColorImagesMap(data.colorImages);
          if (cleanColorImages) {
            writeCachedColorImages(validUrl, cleanColorImages);
            writeCachedColorImages(data.url, cleanColorImages);
          }
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
            documents: cleanDocs.length > 0 ? cleanDocs : undefined,
            extractedFrom: data.extractedFrom,
            blockedBySite: Boolean(data.blockedBySite),
          };
        }
      }
    } catch (err) {
      if (
        refresh &&
        err instanceof DOMException &&
        err.name === 'AbortError'
      ) {
        throw new Error(
          'Il sito ha impiegato troppo tempo a rispondere. Riprova tra qualche istante.'
        );
      }
      // Fallback to client URL slug parsing below
    }
    return clientFallbackInspectUrl(validUrl);
  }

  async function autoAttachInspectedDocuments(
    researchId: string,
    productTitle: string,
    provider: string,
    docs: InspectedDocumentLink[]
  ): Promise<{ downloaded: number; linked: number }> {
    if (!researchId || docs.length === 0) return { downloaded: 0, linked: 0 };
    const existingDocs = getDocumentsForResearch(researchDocuments, researchId);
    const existingUrlSet = new Set(
      existingDocs
        .map((d) => (d.cloudUrl || '').split('#')[0].toLowerCase())
        .filter(Boolean)
    );
    const existingFileNameSet = new Set(
      existingDocs.map((d) => (d.fileName || '').trim().toLowerCase()).filter(Boolean)
    );
    const existingTitleList = existingDocs
      .map((d) => d.title.trim().toLowerCase())
      .filter(Boolean);

    const extractUniqueUrlFileName = (rawUrl: string): string => {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.search && /[?&](id|file|doc|document|attachment|key)=/i.test(parsed.search)) {
          return '';
        }
        const segment = decodeURIComponent(parsed.pathname.split('/').pop() || '')
          .trim()
          .toLowerCase();
        if (/\.(pdf|zip|dwg|obj|3ds|fbx|rfa|ifc|doc|docx)$/i.test(segment)) {
          return segment;
        }
      } catch {
        // ignore URL parse errors
      }
      return '';
    };

    let downloaded = 0;
    let linked = 0;

    for (const docItem of docs.slice(0, 6)) {
      const normUrl = docItem.url.split('#')[0].toLowerCase();
      if (existingUrlSet.has(normUrl)) continue;
      const urlFileName = extractUniqueUrlFileName(docItem.url);
      if (urlFileName && existingFileNameSet.has(urlFileName)) continue;

      const docType: ArticleAttachmentType =
        docItem.kind === 'certificato' ? 'garanzia_extra_family' : 'manuale';
      const cleanDocTitle = docItem.title.trim().slice(0, 48);
      const cleanProd = productTitle.trim().slice(0, 28);
      const fullTitle = cleanProd
        ? `${cleanDocTitle} · ${cleanProd}`.slice(0, 80)
        : cleanDocTitle.slice(0, 80);
      const cleanDocTitleLow = cleanDocTitle.toLowerCase();
      const fullTitleLow = fullTitle.toLowerCase();
      const alreadyHasSameTitle = existingTitleList.some(
        (existingTitle) =>
          existingTitle === fullTitleLow ||
          existingTitle === cleanDocTitleLow ||
          existingTitle.startsWith(`${cleanDocTitleLow} · `)
      );
      if (alreadyHasSameTitle) {
        continue;
      }

      const tryUploadBlobToVault = async (
        blob: Blob,
        contentTypeHeader: string,
        rawHeaderName?: string | null
      ): Promise<'uploaded' | 'duplicate' | 'failed'> => {
        if (blob.size <= 0 || blob.size > MAX_CLOUD_FILE_BYTES) return 'failed';
        const ctLow = contentTypeHeader.toLowerCase();
        if (ctLow.includes('text/html') || ctLow.includes('application/json')) return 'failed';
        let fileName = '';
        if (rawHeaderName) {
          try {
            fileName = decodeURIComponent(rawHeaderName).trim();
          } catch {
            fileName = rawHeaderName.trim();
          }
        }
        if (!fileName) {
          const urlSeg = extractUniqueUrlFileName(docItem.url);
          if (urlSeg) fileName = urlSeg;
        }
        if (!fileName) {
          const slug = cleanDocTitle.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'documento';
          fileName = `${slug}.${ctLow.includes('zip') ? 'zip' : 'pdf'}`;
        }
        if (existingFileNameSet.has(fileName.toLowerCase())) {
          existingUrlSet.add(normUrl);
          return 'duplicate';
        }
        const file = new File([blob], fileName, {
          type: blob.type || ctLow || 'application/pdf',
        });
        await onUploadResearchDocument(
          researchId,
          docType,
          fullTitle,
          provider,
          file
        );
        downloaded += 1;
        existingFileNameSet.add(fileName.toLowerCase());
        existingUrlSet.add(normUrl);
        existingTitleList.push(fullTitleLow);
        return 'uploaded';
      };

      let uploadOutcome: 'uploaded' | 'duplicate' | 'failed' = 'failed';
      if (!isBackendApiUnavailable()) {
        try {
          const resp = await fetchWithTimeout(
            '/api/researches/fetch-document',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: docItem.url, title: cleanDocTitle }),
            },
            18_000
          );
          if (resp.status === 405 || resp.status === 404) {
            backendApiUnavailable = true;
          } else {
            const ct = String(resp.headers.get('content-type') || '').toLowerCase();
            if (resp.ok && !ct.includes('application/json')) {
              const blob = await resp.blob();
              uploadOutcome = await tryUploadBlobToVault(
                blob,
                ct,
                resp.headers.get('x-document-filename')
              );
            }
          }
        } catch {
          // Fall through to browser direct fetch fallback
        }
      }

      // Direct browser fetch fallback (uses user's residential IP when server datacenter IP is WAF-blocked or on static host)
      if (uploadOutcome === 'failed') {
        try {
          const directResp = await fetchWithTimeout(
            docItem.url,
            { method: 'GET', mode: 'cors' },
            10_000
          );
          const directCt = String(directResp.headers.get('content-type') || '').toLowerCase();
          if (directResp.ok && !directCt.includes('text/html')) {
            const directBlob = await directResp.blob();
            uploadOutcome = await tryUploadBlobToVault(
              directBlob,
              directCt,
              directResp.headers.get('content-disposition')?.match(
                /filename\*?=(?:UTF-8''|["']?)([^"';\r\n]+)["']?/i
              )?.[1]
            );
          }
        } catch {
          // CORS or network block on direct fetch -> fall back to direct link below
        }
      }

      if (uploadOutcome === 'failed' && onAddResearchDocumentLink && docItem.url.length <= 231) {
        try {
          const kindLabel =
            docItem.kind === 'bim_3d'
              ? 'File 3D / BIM ufficiale'
              : docItem.kind === 'scheda'
                ? 'Scheda tecnica ufficiale'
                : 'Documento ufficiale';
          await onAddResearchDocumentLink(
            researchId,
            docType,
            fullTitle,
            provider,
            docItem.url,
            `${kindLabel} da ${provider}`
          );
          linked += 1;
          existingUrlSet.add(normUrl);
          existingTitleList.push(fullTitleLow);
        } catch {
          // Ignore individual link-save errors
        }
      }
    }

    return { downloaded, linked };
  }

  function hasNewInspectedDocuments(
    researchId: string,
    productTitle: string,
    docs?: InspectedDocumentLink[]
  ): boolean {
    if (!researchId || !docs || docs.length === 0) return false;
    const existingDocs = getDocumentsForResearch(researchDocuments, researchId);
    const existingUrlSet = new Set(
      existingDocs
        .map((d) => (d.cloudUrl || '').split('#')[0].toLowerCase())
        .filter(Boolean)
    );
    const existingFileNameSet = new Set(
      existingDocs.map((d) => (d.fileName || '').trim().toLowerCase()).filter(Boolean)
    );
    const existingTitleList = existingDocs
      .map((d) => d.title.trim().toLowerCase())
      .filter(Boolean);
    const cleanProd = productTitle.trim().slice(0, 28);

    for (const docItem of docs.slice(0, 6)) {
      const normUrl = docItem.url.split('#')[0].toLowerCase();
      if (existingUrlSet.has(normUrl)) continue;
      let urlFileName = '';
      try {
        const parsed = new URL(docItem.url);
        if (!parsed.search || !/[?&](id|file|doc|document|attachment|key)=/i.test(parsed.search)) {
          const seg = decodeURIComponent(parsed.pathname.split('/').pop() || '')
            .trim()
            .toLowerCase();
          if (/\.(pdf|zip|dwg|obj|3ds|fbx|rfa|ifc|doc|docx)$/i.test(seg)) {
            urlFileName = seg;
          }
        }
      } catch {
        // ignore URL parse error
      }
      if (urlFileName && existingFileNameSet.has(urlFileName)) continue;

      const cleanDocTitle = docItem.title.trim().slice(0, 48);
      const fullTitle = cleanProd
        ? `${cleanDocTitle} · ${cleanProd}`.slice(0, 80)
        : cleanDocTitle.slice(0, 80);
      const cleanDocTitleLow = cleanDocTitle.toLowerCase();
      const fullTitleLow = fullTitle.toLowerCase();
      const alreadyHasSameTitle = existingTitleList.some(
        (existingTitle) =>
          existingTitle === fullTitleLow ||
          existingTitle === cleanDocTitleLow ||
          existingTitle.startsWith(`${cleanDocTitleLow} · `)
      );
      if (!alreadyHasSameTitle) return true;
    }
    return false;
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
      const resolvedBrand = inferProductBrand(inspected);
      const resolvedRoom =
        normalizeResearchRoom(inspected.room) ||
        inferResearchRoom({
          title: inspected.title,
          url: inspected.url,
          specs: inspected.specs,
          category: inspected.category,
        });
      const candidatePayload: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'> = {
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
        colorImages: sanitizeColorImagesMap(inspected.colorImages),
        size: inspected.size,
        availableSizes: inspected.availableSizes,
        sizePrices: inspected.sizePrices,
        model: inspected.model,
        specs: inspected.specs,
        notes: inspected.notes,
      };

      const candCanonUrl = canonicalUrlForCompare(candidatePayload.url);
      const duplicateExisting = allResearches.find((existing) => {
        const effectiveExisting = getEffectiveItem(existing);
        const sameCanonUrl =
          Boolean(candCanonUrl) &&
          canonicalUrlForCompare(effectiveExisting.url) === candCanonUrl;
        const comparableCandidate: Omit<
          ProductResearchRecord,
          'id' | 'ownerId' | 'createdAtMs'
        > = {
          ...candidatePayload,
          url: effectiveExisting.url,
          status: effectiveExisting.status,
          room: effectiveExisting.room ?? candidatePayload.room,
          paidPriceEur: effectiveExisting.paidPriceEur,
          notes: effectiveExisting.notes || candidatePayload.notes,
        };
        if (sameCanonUrl && !hasResearchPayloadChanges(effectiveExisting, comparableCandidate)) {
          return true;
        }
        return !hasResearchPayloadChanges(effectiveExisting, {
          ...candidatePayload,
          status: effectiveExisting.status,
          room: effectiveExisting.room ?? candidatePayload.room,
          paidPriceEur: effectiveExisting.paidPriceEur,
        });
      });

      if (duplicateExisting) {
        setLinkInput('');
        setDraftOpen(false);
        setLinkNotice(
          `Il prodotto "${inspected.title}" è già presente nella pagina con gli stessi dati: nessuna nuova bozza aggiunta.`
        );
        return;
      }

      const draftId = `${LOCAL_DRAFT_PREFIX}${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const draftRecord: ProductResearchRecord = {
        id: draftId,
        ownerId: 'local_draft',
        createdAtMs: Date.now(),
        ...candidatePayload,
      };

      setPendingDraftItems((prev) => [draftRecord, ...prev]);
      if (inspected.documents?.length) {
        setPendingDraftFoundDocs((prev) => ({
          ...prev,
          [draftId]: inspected.documents!,
        }));
      }
      if (inspected.sizePrices) {
        setLazySizePrices((prev) => ({ ...prev, [draftId]: inspected.sizePrices! }));
      }
      if (inspected.colorImages) {
        setLazyColorImages((prev) => ({ ...prev, [draftId]: inspected.colorImages! }));
      }

      setLinkInput('');
      setDraftOpen(false);
      const foundBits = [
        typeof inspected.priceEur === 'number' ? `€ ${inspected.priceEur.toFixed(2)}` : '',
        resolvedRoom ? `stanza ${getResearchRoomLabel(resolvedRoom)}` : '',
        inspected.color ? `colore ${inspected.color}` : '',
        inspected.size ? `taglia ${inspected.size}` : '',
        inspected.imageUrl ? 'immagine' : '',
        inspected.specs ? 'dettagli tecnici' : '',
        inspected.documents?.length
          ? `${inspected.documents.length} ${inspected.documents.length === 1 ? 'documento' : 'documenti'}`
          : '',
      ].filter(Boolean);

      if (
        inspected.blockedBySite &&
        inspected.extractedFrom !== 'page-meta' &&
        !inspected.documents?.length &&
        !inspected.specs
      ) {
        setLinkNotice(
          `Bozza "${inspected.title}" inserita in pagina da ${inspected.store} (${
            writesDisabled ? 'non ancora salvata nella coda locale' : 'non ancora salvata su Firestore'
          }). Il sito blocca la lettura automatica: completa eventuali dettagli e clicca "Salva modifiche" sulla scheda.`
        );
      } else {
        setFeedback(
          foundBits.length > 0
            ? `"${inspected.title}" inserito in pagina in bozza (${foundBits.join(', ')}). ${
                writesDisabled
                  ? 'Nessun salvataggio finché non clicchi "Salva modifiche".'
                  : 'Nessuna scrittura su Firestore finché non clicchi "Salva modifiche".'
              }`
            : `Link di ${inspected.store} inserito in pagina in bozza: clicca "Salva modifiche" sulla scheda per ${
                writesDisabled ? 'simularlo in locale' : 'salvarlo'
              }.`
        );
      }
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : 'Errore durante l’analisi del link prodotto.'
      );
    } finally {
      setInspecting(false);
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
      setDraftTechSpecs('');
      setDraftInfoText('');
      setDraftNotes('');
      setDraftAttachments([]);
      setDraftFoundDocuments([]);
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
      const split = splitSpecsAndInfo(inspected.specs);
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
      setDraftTechSpecs(split.techSpecs);
      setDraftInfoText(split.infoText);
      setDraftNotes(inspected.notes || '');
      setDraftAttachments([]);
      setDraftFoundDocuments(inspected.documents || []);
      setDraftOpen(true);
      if (inspected.blockedBySite && inspected.extractedFrom !== 'page-meta' && !inspected.specs) {
        setLinkNotice(
          `${inspected.store} usa una protezione anti-bot: titolo, negozio e codice articolo dal link sono già precompilati; completa prezzo/foto o dettagli manualmente.`
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
    const combinedSpecs = joinSpecsAndInfo(draftTechSpecs, draftInfoText);

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
        specs: combinedSpecs || undefined,
        notes: draftNotes.trim() ? draftNotes.trim().slice(0, 400) : undefined,
      });

      let attachedTotal = 0;
      if (typeof createdId === 'string' && createdId && draftAttachments.length > 0) {
        for (const att of draftAttachments) {
          await onUploadResearchDocument(
            createdId,
            att.docType,
            `${cleanTitle.slice(0, 42)} · ${att.label}`.slice(0, 80),
            draftBrand.trim() || cleanStore,
            att.file
          );
          attachedTotal += 1;
        }
        setOpenAttachmentsIds((prev) => ({ ...prev, [createdId]: true }));
      }
      if (typeof createdId === 'string' && createdId && draftFoundDocuments.length > 0) {
        const autoStats = await autoAttachInspectedDocuments(
          createdId,
          cleanTitle,
          draftBrand.trim() || cleanStore,
          draftFoundDocuments
        );
        attachedTotal += autoStats.downloaded + autoStats.linked;
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
      setDraftTechSpecs('');
      setDraftInfoText('');
      setDraftAttachments([]);
      setDraftFoundDocuments([]);
      setFeedback(
        writesDisabled
          ? `Prodotto "${cleanTitle}" salvato in locale (in coda per Firestore)${
              attachedTotal > 0
                ? ` con ${attachedTotal} ${attachedTotal === 1 ? 'allegato' : 'allegati'}`
                : ''
            }.`
          : `Prodotto "${cleanTitle}" salvato su Firestore${
              attachedTotal > 0
                ? ` con ${attachedTotal} ${attachedTotal === 1 ? 'allegato' : 'allegati'}`
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
    const split = splitSpecsAndInfo(effective.specs);
    setInlinePaidEditId(null);
    setEditingId(item.id);
    setEditUrl(effective.url);
    setEditTitle(effective.title);
    setEditStore(effective.store);
    setEditBrand(normalizeBrandName(effective.brand) || inferProductBrand(effective) || '');
    setEditColor(effective.color || '');
    setEditAvailableColors(
      effective.availableColors && effective.availableColors.length > 0
        ? mergePreservedVariantOptions({
            previousOptions: effective.availableColors,
            extraOptions: [effective.color, item.color],
            normalizeKey: normalizeColorOptionKey,
          }) || []
        : []
    );
    setEditColorImages(effective.colorImages);
    setEditSize(effective.size || '');
    setEditAvailableSizes(
      effective.availableSizes && effective.availableSizes.length > 0
        ? mergePreservedVariantOptions({
            previousOptions: effective.availableSizes,
            extraOptions: [effective.size, item.size],
            normalizeKey: normalizeSizeOptionKey,
          }) || []
        : []
    );
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
    setEditTechSpecs(split.techSpecs);
    setEditInfoText(split.infoText);
    setEditNotes(effective.notes || '');
  }

  function handleRequestSaveEdit(e: React.FormEvent, item: ProductResearchRecord) {
    e.preventDefault();
    if (readOnly) return;
    setLinkError(null);
    setLinkNotice(null);
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
    const combinedSpecs = joinSpecsAndInfo(editTechSpecs, editInfoText);

    const cleanEditColor = editColor.trim().slice(0, 60);
    const cleanEditSize = editSize.trim().slice(0, 60);
    const mergedEditColors =
      editAvailableColors.length > 0
        ? mergePreservedVariantOptions({
            previousOptions: editAvailableColors,
            extraOptions: [cleanEditColor || undefined],
            normalizeKey: normalizeColorOptionKey,
          })
        : undefined;
    const mergedEditSizes =
      editAvailableSizes.length > 0
        ? mergePreservedVariantOptions({
            previousOptions: editAvailableSizes,
            extraOptions: [cleanEditSize || undefined],
            normalizeKey: normalizeSizeOptionKey,
          })
        : undefined;

    const payload: Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'> = {
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
      color: cleanEditColor || undefined,
      availableColors: mergedEditColors,
      colorImages: sanitizeColorImagesMap(editColorImages),
      size: cleanEditSize || undefined,
      availableSizes: mergedEditSizes,
      model: editModel.trim() ? editModel.trim().slice(0, 80) : undefined,
      specs: combinedSpecs || undefined,
      notes: editNotes.trim() ? editNotes.trim().slice(0, 400) : undefined,
    };

    if (isLocalDraftId(item.id)) {
      setPendingEditSave({
        item,
        isNewDraft: true,
        payload,
      });
      return;
    }

    if (!hasResearchPayloadChanges(item, payload)) {
      setEditingId((curr) => (curr === item.id ? null : curr));
      setLinkNotice(
        `Nessuna modifica rilevata per "${cleanTitle}": nessuna scrittura effettuata su Firestore.`
      );
      return;
    }

    setPendingEditSave({
      item,
      payload,
    });
  }

  async function confirmSaveEdit() {
    if (!pendingEditSave || readOnly) return;
    const { item, payload, isNewDraft, skipProductUpdate, docTypeChanges } = pendingEditSave;
    setSavingEdit(true);
    setLinkError(null);
    setLinkNotice(null);
    try {
      if (isNewDraft || isLocalDraftId(item.id)) {
        const createdId = await onAddResearch(payload);
        let docStats = { downloaded: 0, linked: 0 };
        const queuedFoundDocs = pendingDraftFoundDocs[item.id];
        if (typeof createdId === 'string' && createdId && queuedFoundDocs?.length) {
          docStats = await autoAttachInspectedDocuments(
            createdId,
            payload.title,
            payload.brand || payload.store,
            queuedFoundDocs
          );
        }
        setPendingDraftItems((prev) => prev.filter((d) => d.id !== item.id));
        setPendingDraftFoundDocs((prev) => {
          if (!prev[item.id]) return prev;
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setPendingEditSave(null);
        setEditingId((curr) => (curr === item.id ? null : curr));
        handleDiscardPendingCardEdit(item.id);
        const totalDocs = docStats.downloaded + docStats.linked;
        setFeedback(
          writesDisabled
            ? `Prodotto "${payload.title}" salvato in locale (in coda per Firestore)${
                totalDocs > 0 ? ` con ${totalDocs} ${totalDocs === 1 ? 'allegato' : 'allegati'}` : ''
              }.`
            : `Prodotto "${payload.title}" salvato su Firestore${
                totalDocs > 0 ? ` con ${totalDocs} ${totalDocs === 1 ? 'allegato' : 'allegati'}` : ''
              }.`
        );
        return;
      }

      const actuallyChanged = !skipProductUpdate && hasResearchPayloadChanges(item, payload);
      if (actuallyChanged) {
        await onUpdateResearch(item.id, payload);
      }
      if (docTypeChanges && docTypeChanges.length > 0 && onUpdateResearchDocumentType) {
        for (const chg of docTypeChanges) {
          await onUpdateResearchDocumentType(chg.docId, chg.researchId, chg.nextType);
        }
      }
      setPendingEditSave(null);
      setEditingId((curr) => (curr === item.id ? null : curr));
      handleDiscardPendingCardEdit(item.id);
      setBrokenImages((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      if (!actuallyChanged && (!docTypeChanges || docTypeChanges.length === 0)) {
        setLinkNotice(
          `Nessuna modifica rilevata per "${payload.title}": nessuna operazione effettuata.`
        );
      } else if (writesDisabled && !hasQueuedOpForResearch(item.id)) {
        setLinkNotice(
          `"${payload.title}" è tornato allo stato originale: modifiche locali annullate, nessuna operazione in coda per Firestore.`
        );
      } else {
        setFeedback(
          !actuallyChanged && docTypeChanges && docTypeChanges.length > 0
            ? writesDisabled
              ? `Tipologia degli allegati per "${payload.title}" salvata in locale (in coda per Firestore).`
              : `Tipologia degli allegati per "${payload.title}" salvata su Firestore.`
            : writesDisabled
              ? `Modifiche a "${payload.title}" salvate in locale (in coda per Firestore).`
              : `Prodotto "${payload.title}" aggiornato e salvato su Firestore.`
        );
      }
    } catch (err) {
      setLinkError(
        err instanceof Error
          ? err.message
          : 'Errore durante il salvataggio delle modifiche.'
      );
      setPendingEditSave(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRefreshFromSite(item: ProductResearchRecord) {
    if (readOnly) return;
    if (isBackendApiUnavailable()) {
      setLinkNotice(
        `L'aggiornamento automatico dal sito richiede il server backend (app AI Studio o server locale): su GitHub Pages statico non è disponibile l'API /api/researches/inspect.`
      );
      return;
    }
    setRefreshingId(item.id);
    setLinkError(null);
    setLinkNotice(null);
    setFeedback(null);
    try {
      const inspected = await inspectProductLink(item.url, true);
      const hasMultiColorSource =
        (item.availableColors?.length || 0) > 0 ||
        (inspected.availableColors?.length || 0) > 0;
      const nextAvailableColors = hasMultiColorSource
        ? mergePreservedVariantOptions({
            previousOptions: item.availableColors,
            liveOptions: inspected.availableColors,
            extraOptions: [item.color, inspected.color],
            normalizeKey: normalizeColorOptionKey,
          })
        : item.availableColors;

      const hasMultiSizeSource =
        (item.availableSizes?.length || 0) > 0 ||
        (inspected.availableSizes?.length || 0) > 0;
      const nextAvailableSizes = hasMultiSizeSource
        ? mergePreservedVariantOptions({
            previousOptions: item.availableSizes,
            liveOptions: inspected.availableSizes,
            extraOptions: [item.size, inspected.size],
            normalizeKey: normalizeSizeOptionKey,
          })
        : item.availableSizes;

      const prevUnavailable =
        unavailableVariantsById[item.id] ?? readCachedUnavailableVariants(item.url);
      const missingColorsNow =
        inspected.availableColors && inspected.availableColors.length > 0
          ? computeMissingLiveOptions(
              nextAvailableColors,
              inspected.availableColors,
              normalizeColorOptionKey
            )
          : prevUnavailable?.colors || [];
      const missingSizesNow =
        inspected.availableSizes && inspected.availableSizes.length > 0
          ? computeMissingLiveOptions(
              nextAvailableSizes,
              inspected.availableSizes,
              normalizeSizeOptionKey
            )
          : prevUnavailable?.sizes || [];
      const nextUnavailableEntry = sanitizeUnavailableVariantsEntry({
        colors: missingColorsNow,
        sizes: missingSizesNow,
      });
      writeCachedUnavailableVariants(item.url, nextUnavailableEntry);
      setUnavailableVariantsById((prev) => {
        const next = { ...prev };
        if (nextUnavailableEntry) {
          next[item.id] = nextUnavailableEntry;
        } else {
          delete next[item.id];
        }
        return next;
      });

      const cachedColorImages = readCachedColorImages(item.url);
      const nextColorImages = sanitizeColorImagesMap({
        ...(cachedColorImages || {}),
        ...(lazyColorImages[item.id] || {}),
        ...(item.colorImages || {}),
        ...(inspected.colorImages || {}),
      });
      const cachedSizePrices = readCachedSizePrices(item.url);
      const mergedSizePrices = sanitizeSizePricesMap({
        ...(cachedSizePrices || {}),
        ...(lazySizePrices[item.id] || {}),
        ...(item.sizePrices || {}),
        ...(inspected.sizePrices || {}),
      });

      if (nextColorImages) {
        setLazyColorImages((prev) => ({ ...prev, [item.id]: nextColorImages }));
        writeCachedColorImages(item.url, nextColorImages);
      }
      if (mergedSizePrices) {
        setLazySizePrices((prev) => ({ ...prev, [item.id]: mergedSizePrices }));
        writeCachedSizePrices(item.url, mergedSizePrices);
      }

      const rawNextTitle = inspected.title || item.title;
      const nextStore = inspected.store || item.store;
      const nextSpecs = inspected.specs || item.specs;

      const resolvePreservedFields = (
        userBase: ProductResearchRecord
      ): Omit<ProductResearchRecord, 'id' | 'ownerId' | 'createdAtMs'> => {
        const preservedColor = (userBase.color || '').trim() || undefined;
        const preservedSize = (userBase.size || '').trim() || undefined;
        const nextColor = preservedColor || inspected.color || undefined;
        const nextSize = preservedSize || inspected.size || undefined;

        let nextTitle = rawNextTitle;
        if (preservedColor) {
          nextTitle = replaceColorInTitle(
            nextTitle,
            preservedColor,
            inspected.color || userBase.color,
            nextAvailableColors
          ).slice(0, 160);
        }
        if (preservedSize) {
          nextTitle = replaceSizeInTitle(
            nextTitle,
            preservedSize,
            inspected.size || userBase.size,
            nextAvailableSizes
          ).slice(0, 160);
        }

        const variantColorImg = nextColor
          ? findColorImageUrl(nextColorImages, nextColor)
          : undefined;
        const inspectedMatchesPreservedColor =
          Boolean(preservedColor) &&
          Boolean(inspected.color) &&
          preservedColor!.toLowerCase() === inspected.color!.trim().toLowerCase();

        const nextImageUrl = preservedColor
          ? variantColorImg ||
            (inspectedMatchesPreservedColor
              ? inspected.imageUrl || userBase.imageUrl
              : userBase.imageUrl || inspected.imageUrl)
          : variantColorImg || inspected.imageUrl || userBase.imageUrl;

        const variantSizePrice = nextSize
          ? findSizePrice(mergedSizePrices, nextSize)
          : undefined;
        const inspectedMatchesPreservedSize =
          Boolean(preservedSize) &&
          Boolean(inspected.size) &&
          preservedSize!.toLowerCase().replace(/\s+/g, '') ===
            inspected.size!.trim().toLowerCase().replace(/\s+/g, '');

        const nextPriceEur = preservedSize
          ? typeof variantSizePrice === 'number'
            ? variantSizePrice
            : inspectedMatchesPreservedSize || !inspected.size
              ? inspected.priceEur ?? userBase.priceEur
              : userBase.priceEur ?? inspected.priceEur
          : typeof variantSizePrice === 'number'
            ? variantSizePrice
            : inspected.priceEur ?? userBase.priceEur;

        const nextBrand =
          normalizeBrandName(userBase.brand) ||
          inferProductBrand({
            title: nextTitle,
            url: item.url,
            store: nextStore,
            brand: inspected.brand || userBase.brand,
            specs: nextSpecs,
          });

        return {
          url: item.url,
          title: nextTitle,
          store: nextStore,
          category: userBase.category || inspected.category,
          status: userBase.status,
          room: normalizeResearchRoom(userBase.room),
          priceEur: nextPriceEur,
          paidPriceEur: userBase.status === 'acquistato' ? userBase.paidPriceEur : undefined,
          imageUrl: nextImageUrl,
          brand: nextBrand,
          color: nextColor,
          availableColors: nextAvailableColors,
          colorImages: nextColorImages,
          size: nextSize,
          availableSizes: nextAvailableSizes,
          model: inspected.model || userBase.model,
          specs: nextSpecs,
          notes: userBase.notes || inspected.notes,
        };
      };

      if (isLocalDraftId(item.id)) {
        const effectiveDraft = getEffectiveItem(item);
        const proposedDraftPayload = resolvePreservedFields(effectiveDraft);
        const draftChanged = hasResearchPayloadChanges(effectiveDraft, proposedDraftPayload);
        if (draftChanged) {
          setPendingDraftItems((prev) =>
            prev.map((d) =>
              d.id === item.id
                ? {
                    ...d,
                    ...proposedDraftPayload,
                    sizePrices: mergedSizePrices ?? d.sizePrices,
                  }
                : d
            )
          );
          handleDiscardPendingCardEdit(item.id);
          if (inspected.documents?.length) {
            setPendingDraftFoundDocs((prev) => ({
              ...prev,
              [item.id]: inspected.documents!,
            }));
          }
          setFeedback(
            `Bozza "${proposedDraftPayload.title}" aggiornata dal sito (selezioni mantenute, ancora non salvata su Firestore).`
          );
        } else {
          setLinkNotice(
            `Nessuna modifica trovata online per la bozza "${effectiveDraft.title}".`
          );
        }
        return;
      }

      const proposedPayload = resolvePreservedFields(item);
      const nextTitle = proposedPayload.title;
      const nextBrand = proposedPayload.brand;

      const fieldsChanged = hasResearchPayloadChanges(item, proposedPayload);
      const otherIdenticalItem = researches.find(
        (other) => other.id !== item.id && !hasResearchPayloadChanges(other, proposedPayload)
      );
      const willUpdateBase = fieldsChanged && !otherIdenticalItem;
      const hasNewDocs = hasNewInspectedDocuments(
        item.id,
        nextTitle,
        inspected.documents
      );

      const baseAfterRefresh: ProductResearchRecord = willUpdateBase
        ? { ...item, ...proposedPayload }
        : item;

      const preservePendingSelectionsAfterRefresh = () => {
        setPendingCardEdits((prev) => {
          const existingPending = prev[item.id];
          if (!existingPending) return prev;
          const nextEntry = { ...existingPending };
          if (nextEntry.color !== undefined) {
            const stagedColor = nextEntry.color.trim();
            if (stagedColor) {
              const stagedImg = findColorImageUrl(nextColorImages, stagedColor);
              if (stagedImg) {
                nextEntry.imageUrl = stagedImg;
              }
            }
          }
          if (nextEntry.size !== undefined) {
            const stagedSize = nextEntry.size.trim();
            if (stagedSize) {
              const stagedPrice = findSizePrice(mergedSizePrices, stagedSize);
              if (typeof stagedPrice === 'number') {
                nextEntry.priceEur = stagedPrice;
              }
            }
          }
          if (nextEntry.color !== undefined || nextEntry.size !== undefined) {
            let stagedTitle = baseAfterRefresh.title;
            const targetColor =
              nextEntry.color !== undefined ? nextEntry.color : baseAfterRefresh.color;
            const targetSize =
              nextEntry.size !== undefined ? nextEntry.size : baseAfterRefresh.size;
            if (targetColor) {
              stagedTitle = replaceColorInTitle(
                stagedTitle,
                targetColor,
                baseAfterRefresh.color,
                nextAvailableColors
              ).slice(0, 160);
            }
            if (targetSize) {
              stagedTitle = replaceSizeInTitle(
                stagedTitle,
                targetSize,
                baseAfterRefresh.size,
                nextAvailableSizes
              ).slice(0, 160);
            }
            nextEntry.title = stagedTitle;
          }
          const stillHasFields = hasPendingFieldDiff(baseAfterRefresh, nextEntry);
          const stillHasDocs = Boolean(
            nextEntry.docTypes && Object.keys(nextEntry.docTypes).length > 0
          );
          if (!stillHasFields && !stillHasDocs) {
            const copy = { ...prev };
            delete copy[item.id];
            return copy;
          }
          return { ...prev, [item.id]: nextEntry };
        });
      };

      if ((!fieldsChanged || Boolean(otherIdenticalItem)) && !hasNewDocs) {
        preservePendingSelectionsAfterRefresh();
        setBrokenImages((prev) => {
          if (!prev[item.id]) return prev;
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setLinkNotice(
          otherIdenticalItem
            ? `Nessuna riscrittura effettuata: i dati trovati online coincidono già con l'articolo "${otherIdenticalItem.title}" già presente (0 operazioni Firestore).`
            : `Nessuna modifica online per "${item.title}": i dati sul sito coincidono già con la scheda salvata (0 operazioni Firestore).`
        );
        return;
      }

      if (willUpdateBase) {
        await onUpdateResearch(item.id, proposedPayload);
      }
      preservePendingSelectionsAfterRefresh();

      let docStats = { downloaded: 0, linked: 0 };
      if (hasNewDocs && inspected.documents?.length) {
        docStats = await autoAttachInspectedDocuments(
          item.id,
          nextTitle,
          nextBrand || nextStore,
          inspected.documents
        );
      }

      setBrokenImages((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      const totalDocs = docStats.downloaded + docStats.linked;
      if (
        inspected.blockedBySite &&
        inspected.extractedFrom !== 'page-meta' &&
        totalDocs === 0 &&
        !inspected.specs
      ) {
        setLinkNotice(
          `Scheda "${nextTitle || item.title}" aggiornata dai dati del link, ma ${
            inspected.store || item.store
          } blocca l'accesso automatico (anti-bot): eventuali foto, prezzi o documenti vanno inseriti manualmente.`
        );
      } else {
        const docSummaryParts = [
          docStats.downloaded > 0
            ? `${docStats.downloaded} ${
                docStats.downloaded === 1 ? 'allegato scaricato' : 'allegati scaricati'
              }`
            : '',
          docStats.linked > 0 ? `${docStats.linked} link aggiunti` : '',
        ].filter(Boolean);
        const preservedMissingLabels = [
          ...(nextUnavailableEntry?.sizes || []),
          ...(nextUnavailableEntry?.colors || []),
        ];
        const preservedMissingText =
          preservedMissingLabels.length > 0
            ? ` · Mantenute anche le opzioni non più sul sito: ${preservedMissingLabels.join(', ')}.`
            : '';
        setFeedback(
          willUpdateBase
            ? `Scheda "${nextTitle || item.title}" aggiornata dal sito${
                docSummaryParts.length > 0 ? ` (${docSummaryParts.join(', ')})` : ''
              } e ${
                writesDisabled
                  ? 'salvata in locale in coda per Firestore'
                  : 'salvata su Firestore'
              } (selezioni utente mantenute).${preservedMissingText}`
            : `Aggiunti solo i nuovi allegati (${docSummaryParts.join(', ')}) a "${
                nextTitle || item.title
              }" senza riscrivere la scheda.${preservedMissingText}`
        );
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
      pending?.colorImages ||
      item.colorImages ||
      lazyColorImages[item.id] ||
      readCachedColorImages(item.url);
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

  function hasPendingFieldDiff(
    item: ProductResearchRecord,
    merged: {
      title?: string;
      color?: string;
      imageUrl?: string;
      size?: string;
      priceEur?: number | null;
      room?: string | null;
      status?: ProductResearchStatus;
      paidPriceEur?: number | null;
    }
  ): boolean {
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
    const nextPaid =
      nextStatus !== 'acquistato'
        ? undefined
        : merged.paidPriceEur !== undefined
          ? merged.paidPriceEur === null
            ? undefined
            : merged.paidPriceEur
          : item.paidPriceEur;

    return !(
      nextTitle === item.title &&
      nextColor === item.color &&
      nextImageUrl === item.imageUrl &&
      nextSize === item.size &&
      nextPrice === item.priceEur &&
      nextRoom === normalizeResearchRoom(item.room) &&
      nextStatus === item.status &&
      nextPaid === item.paidPriceEur
    );
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
      const nextStatus = merged.status !== undefined ? merged.status : item.status;
      if (nextStatus !== 'acquistato') {
        merged.paidPriceEur = item.paidPriceEur !== undefined ? null : undefined;
      }

      const fieldsChanged = hasPendingFieldDiff(item, merged);
      const hasDocTypeChanges = Boolean(merged.docTypes && Object.keys(merged.docTypes).length > 0);

      if (!fieldsChanged && !hasDocTypeChanges) {
        if (!prev[item.id]) return prev;
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      }

      return { ...prev, [item.id]: merged };
    });
  }

  function handleQuickDocTypeChange(
    item: ProductResearchRecord,
    docItem: HomeDocumentRecord,
    nextType: ArticleAttachmentType
  ) {
    if (readOnly || !onUpdateResearchDocumentType) return;
    setFeedback(null);
    setLinkError(null);
    const savedType = parseResearchDocumentRef(docItem.referenceCode)?.docType || 'altro';
    setPendingCardEdits((prev) => {
      const existingEntry = prev[item.id] || {};
      const nextDocTypes = { ...(existingEntry.docTypes || {}) };
      if (nextType === savedType) {
        delete nextDocTypes[docItem.id];
      } else {
        nextDocTypes[docItem.id] = nextType;
      }
      const cleanedDocTypes = Object.keys(nextDocTypes).length > 0 ? nextDocTypes : undefined;
      const fieldsChanged = hasPendingFieldDiff(item, existingEntry);
      if (!fieldsChanged && !cleanedDocTypes) {
        if (!prev[item.id]) return prev;
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      }
      return {
        ...prev,
        [item.id]: {
          ...existingEntry,
          docTypes: cleanedDocTypes,
        },
      };
    });
  }

  function collectPendingDocTypeChanges(item: ProductResearchRecord) {
    const pendingDocTypes = pendingCardEdits[item.id]?.docTypes;
    if (!pendingDocTypes) return [];
    const itemDocsList = getDocumentsForResearch(researchDocuments, item.id);
    const changes: Array<{
      docId: string;
      researchId: string;
      nextType: ArticleAttachmentType;
    }> = [];
    for (const [docId, nextType] of Object.entries(pendingDocTypes)) {
      const docObj = itemDocsList.find((d) => d.id === docId);
      if (!docObj) continue;
      const parsedRef = parseResearchDocumentRef(docObj.referenceCode);
      const savedType = parsedRef?.docType || 'altro';
      if (savedType !== nextType) {
        changes.push({
          docId,
          researchId: parsedRef?.researchId || item.id,
          nextType,
        });
      }
    }
    return changes;
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

  function handleDiscardLocalDraft(draftId: string) {
    setPendingDraftItems((prev) => prev.filter((d) => d.id !== draftId));
    setPendingDraftFoundDocs((prev) => {
      if (!prev[draftId]) return prev;
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
    if (editingId === draftId) {
      setEditingId(null);
    }
    handleDiscardPendingCardEdit(draftId);
    setFeedback('Bozza rimossa dalla pagina (nessuna operazione su Firestore).');
  }

  function requestCommitLocalDraft(item: ProductResearchRecord) {
    if (readOnly) return;
    setLinkError(null);
    setLinkNotice(null);
    setFeedback(null);
    const effective = getEffectiveItem(item);
    setPendingEditSave({
      item,
      isNewDraft: true,
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

  function requestCommitPendingCardEdit(item: ProductResearchRecord) {
    if (readOnly) return;
    if (isLocalDraftId(item.id)) {
      requestCommitLocalDraft(item);
      return;
    }
    const pending = pendingCardEdits[item.id];
    if (!pending) return;
    setLinkError(null);
    setLinkNotice(null);
    setFeedback(null);
    const effective = getEffectiveItem(item);
    const fieldsChanged = hasPendingFieldDiff(item, pending);
    const docTypeChanges = collectPendingDocTypeChanges(item);
    if (!fieldsChanged && docTypeChanges.length === 0) {
      handleDiscardPendingCardEdit(item.id);
      return;
    }
    setPendingEditSave({
      item,
      skipProductUpdate: !fieldsChanged,
      docTypeChanges,
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
    const pending = pendingCardEdits[item.id];
    if (!pending) return;
    const effective = getEffectiveItem(item);
    const fieldsChanged = hasPendingFieldDiff(item, pending);
    const docTypeChanges = collectPendingDocTypeChanges(item);
    setSavingPendingId(item.id);
    setLinkError(null);
    try {
      if (fieldsChanged) {
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
      }
      if (docTypeChanges.length > 0 && onUpdateResearchDocumentType) {
        for (const chg of docTypeChanges) {
          await onUpdateResearchDocumentType(chg.docId, chg.researchId, chg.nextType);
        }
      }
      setPendingCardEdits((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      if (writesDisabled && !hasQueuedOpForResearch(item.id)) {
        setLinkNotice(
          `"${effective.title}" è tornato allo stato originale: modifiche locali annullate, nessuna operazione in coda per Firestore.`
        );
      } else {
        setFeedback(
          writesDisabled
            ? `Modifiche a "${effective.title}" salvate in locale (in coda per Firestore).`
            : `Modifiche a "${effective.title}" salvate su Firestore.`
        );
      }
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
    const mergedColorChoices = mergePreservedVariantOptions({
      previousOptions: effective.availableColors || item.availableColors,
      extraOptions: [effective.color, item.color, nextColor],
      normalizeKey: normalizeColorOptionKey,
    });
    const nextTitle = replaceColorInTitle(
      effective.title,
      nextColor,
      effective.color,
      mergedColorChoices
    ).slice(0, 160);
    const knownColorImages =
      effective.colorImages ||
      lazyColorImages[item.id] ||
      readCachedColorImages(item.url);
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
      /^https?:\/\/.+/.test(item.url)
    ) {
      if (isBackendApiUnavailable()) {
        setLinkNotice(
          `Le foto dei singoli colori per "${item.title}" non sono ancora salvate su Firestore. Seleziona un colore o usa "Aggiorna dal sito" una volta dall'app AI Studio per sincronizzarle anche su questo browser.`
        );
        return;
      }
      if (!lazyInspectingIdsRef.current.has(item.id)) {
        lazyInspectingIdsRef.current.add(item.id);
        void inspectProductLink(item.url)
          .then(async (inspected) => {
            if (inspected.sizePrices && Object.keys(inspected.sizePrices).length > 0) {
              setLazySizePrices((prev) => ({
                ...prev,
                [item.id]: { ...(prev[item.id] || {}), ...inspected.sizePrices! },
              }));
              writeCachedSizePrices(item.url, inspected.sizePrices);
            }
            if (!inspected.colorImages || Object.keys(inspected.colorImages).length === 0) return;
            setLazyColorImages((prev) => ({
              ...prev,
              [item.id]: { ...(prev[item.id] || {}), ...inspected.colorImages! },
            }));
            writeCachedColorImages(item.url, inspected.colorImages);
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
  }

  function handleQuickSizeSelect(item: ProductResearchRecord, nextSize: string) {
    if (readOnly) return;
    latestQuickSizeRef.current[item.id] = nextSize;
    const effective = getEffectiveItem(item);
    const mergedSizeChoices = mergePreservedVariantOptions({
      previousOptions: effective.availableSizes || item.availableSizes,
      extraOptions: [effective.size, item.size, nextSize],
      normalizeKey: normalizeSizeOptionKey,
    });
    const nextTitle = replaceSizeInTitle(
      effective.title,
      nextSize,
      effective.size,
      mergedSizeChoices
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
      /^https?:\/\/.+/.test(item.url)
    ) {
      if (isBackendApiUnavailable()) {
        setLinkNotice(
          `I prezzi delle singole taglie per "${item.title}" non sono ancora salvati su Firestore. Usa "Aggiorna dal sito" una volta dall'app AI Studio per sincronizzarli anche su questo browser.`
        );
        return;
      }
      if (!lazyInspectingIdsRef.current.has(item.id)) {
        lazyInspectingIdsRef.current.add(item.id);
        setLazySizePriceLoadingIds((prev) => ({ ...prev, [item.id]: true }));
        void inspectProductLink(item.url)
          .then(async (inspected) => {
            if (inspected.colorImages && Object.keys(inspected.colorImages).length > 0) {
              setLazyColorImages((prev) => ({
                ...prev,
                [item.id]: { ...(prev[item.id] || {}), ...inspected.colorImages! },
              }));
              writeCachedColorImages(item.url, inspected.colorImages);
            }
            if (!inspected.sizePrices || Object.keys(inspected.sizePrices).length === 0) return;
            setLazySizePrices((prev) => ({
              ...prev,
              [item.id]: { ...(prev[item.id] || {}), ...inspected.sizePrices! },
            }));
            writeCachedSizePrices(item.url, inspected.sizePrices);
            const targetSize = latestQuickSizeRef.current[item.id] || nextSize;
            const fetchedPrice = findSizePrice(inspected.sizePrices, targetSize);
            setPendingCardEdits((prev) => {
              if (!prev[item.id]) return prev;
              return {
                ...prev,
                [item.id]: {
                  ...prev[item.id],
                  sizePrices: {
                    ...(prev[item.id].sizePrices || item.sizePrices || {}),
                    ...inspected.sizePrices,
                  },
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
    overrideDocType?: ArticleAttachmentType,
    replaceLinkDoc?: HomeDocumentRecord
  ) {
    if (readOnly) return;
    if (isLocalDraftId(item.id)) {
      setLinkNotice(
        'Salva prima il prodotto su Firestore con "Salva modifiche" per poter allegare file.'
      );
      return;
    }
    uploadTargetItemRef.current = item;
    uploadTargetDocTypeRef.current = overrideDocType || null;
    replaceLinkDocTargetRef.current = replaceLinkDoc || null;
    cardFileInputRef.current?.click();
  }

  async function handleCardFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const targetItem = uploadTargetItemRef.current;
    const overrideDocType = uploadTargetDocTypeRef.current;
    const replaceLinkDoc = replaceLinkDocTargetRef.current;
    uploadTargetItemRef.current = null;
    uploadTargetDocTypeRef.current = null;
    replaceLinkDocTargetRef.current = null;
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
    const docTitle = replaceLinkDoc?.title
      ? replaceLinkDoc.title.slice(0, 80)
      : `${targetItem.title.slice(0, 36)} · ${baseName || typeLabel}`.slice(0, 80);
    setUploadingResearchId(targetItem.id);
    setLinkError(null);
    try {
      await onUploadResearchDocument(
        targetItem.id,
        docType,
        docTitle,
        replaceLinkDoc?.provider || targetItem.brand || targetItem.store,
        file
      );
      if (replaceLinkDoc) {
        try {
          await onDeleteResearchDocument(replaceLinkDoc.id);
        } catch {
          // ignore cleanup failure if replacement succeeded
        }
      }
      setOpenAttachmentsIds((prev) => ({ ...prev, [targetItem.id]: true }));
      setFeedback(
        replaceLinkDoc
          ? `File "${file.name}" salvato nell'archivio al posto del link diretto.`
          : writesDisabled
            ? `File "${file.name}" allegato a "${targetItem.title}" in locale (in coda per Firestore).`
            : `File "${file.name}" allegato a "${targetItem.title}" su Firestore.`
      );
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : 'Errore durante il caricamento dell’allegato.'
      );
    } finally {
      setUploadingResearchId(null);
    }
  }

  async function handleOpenDocInNewTab(docItem: HomeDocumentRecord) {
    const existingUrl = vaultDocUrls[docItem.id];
    if (existingUrl) {
      const link = document.createElement('a');
      link.href = existingUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    if (!docItem.attachmentKey) return;
    setOpeningDocId(docItem.id);
    setLinkError(null);
    try {
      const stored = await getVaultFile(docItem.attachmentKey);
      if (!stored) {
        setLinkError('File allegato non disponibile nel vault locale o su Firestore.');
        return;
      }
      const fileName = stored.fileName || docItem.fileName || docItem.title;
      const rawMime = (stored.mimeType || docItem.fileMime || stored.blob.type || '').toLowerCase();
      const isPdf = rawMime.includes('pdf') || /\.pdf$/i.test(fileName);
      const normalizedMime = isPdf
        ? 'application/pdf'
        : rawMime || 'application/octet-stream';
      const typedBlob =
        stored.blob.type === normalizedMime
          ? stored.blob
          : new Blob([stored.blob], { type: normalizedMime });
      const objectUrl = URL.createObjectURL(typedBlob);
      setVaultDocUrls((prev) => ({ ...prev, [docItem.id]: objectUrl }));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Impossibile aprire il file allegato.');
    } finally {
      setOpeningDocId(null);
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
      const deletedResearchId = parseResearchDocumentRef(docItem.referenceCode)?.researchId;
      if (deletedResearchId) {
        setPendingCardEdits((prev) => {
          const entry = prev[deletedResearchId];
          if (!entry?.docTypes || !(docItem.id in entry.docTypes)) return prev;
          const nextDocTypes = { ...entry.docTypes };
          delete nextDocTypes[docItem.id];
          const remainingDocTypes =
            Object.keys(nextDocTypes).length > 0 ? nextDocTypes : undefined;
          const copy = { ...prev };
          const targetItem = allResearches.find((r) => r.id === deletedResearchId);
          if (!remainingDocTypes && (!targetItem || !hasPendingFieldDiff(targetItem, entry))) {
            delete copy[deletedResearchId];
          } else {
            copy[deletedResearchId] = { ...entry, docTypes: remainingDocTypes };
          }
          return copy;
        });
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Impossibile eliminare l’allegato.');
    } finally {
      setDeletingDocId(null);
    }
  }

  async function confirmDeleteDoc() {
    if (!pendingDeleteDoc || readOnly) return;
    const targetDoc = pendingDeleteDoc.doc;
    await handleDeleteDoc(targetDoc);
    setPendingDeleteDoc(null);
  }

  async function confirmDeleteResearch() {
    if (!pendingDelete || readOnly) return;
    setDeleting(true);
    try {
      const id = pendingDelete.id;
      if (editingId === id) setEditingId(null);
      handleDiscardPendingCardEdit(id);
      if (isLocalDraftId(id)) {
        handleDiscardLocalDraft(id);
      } else {
        await onDeleteResearch(id);
      }
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmRefreshResearch() {
    if (!pendingRefresh || readOnly) return;
    const target = pendingRefresh;
    setPendingRefresh(null);
    await handleRefreshFromSite(target);
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
      if (!isLocalDraftId(item.id) && pendingCardEdits[item.id]) {
        await handleCommitPendingCardEdit(item);
      }
      await onMoveToArticles(effective);
      if (isLocalDraftId(item.id)) {
        setPendingDraftItems((prev) => prev.filter((d) => d.id !== item.id));
        setPendingDraftFoundDocs((prev) => {
          if (!prev[item.id]) return prev;
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        handleDiscardPendingCardEdit(item.id);
      } else {
        setMovedArticleIds((prev) => ({ ...prev, [item.id]: true }));
      }
      const attachedCount = isLocalDraftId(item.id)
        ? 0
        : getDocumentsForResearch(researchDocuments, item.id).length;
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
    for (const r of allResearches) {
      if (r.store) set.add(r.store);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it'));
  }, [allResearches]);

  const { availableBrands, hasUnbranded } = useMemo(() => {
    const set = new Set<string>();
    let missingBrand = false;
    for (const r of allResearches) {
      const b = inferProductBrand(r);
      if (b) set.add(b);
      else missingBrand = true;
    }
    return {
      availableBrands: Array.from(set).sort((a, b) => a.localeCompare(b, 'it')),
      hasUnbranded: missingBrand,
    };
  }, [allResearches]);

  const kpis = useMemo(() => {
    let toBuy = 0;
    let purchased = 0;
    let pendingBudget = 0;
    let purchasedSpent = 0;
    for (const r of allResearches) {
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
      total: allResearches.length,
      toBuy,
      purchased,
      pendingBudget,
      purchasedSpent,
    };
  }, [allResearches]);

  const filteredResearches = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const filtered = allResearches.filter((item) => {
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
      const aDraft = isLocalDraftId(a.id);
      const bDraft = isLocalDraftId(b.id);
      if (aDraft !== bDraft) return aDraft ? -1 : 1;
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
    allResearches,
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
    for (const item of allResearches) {
      const normalized = normalizeResearchRoom(item.room);
      if (normalized) {
        counts[normalized] += 1;
      } else {
        unassigned += 1;
      }
    }
    return { counts, unassigned };
  }, [allResearches]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<ProductResearchCategory, number>> = {};
    for (const item of allResearches) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [allResearches]);

  const statusCounts = useMemo(() => {
    const counts: Record<ProductResearchStatus, number> = {
      da_valutare: 0,
      da_acquistare: 0,
      acquistato: 0,
    };
    for (const item of allResearches) {
      counts[item.status] += 1;
    }
    return counts;
  }, [allResearches]);

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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            Ricerche Prodotti &amp; Link Online
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
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
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5 shadow-xs dark:shadow-none">
        <form onSubmit={handleQuickAddSubmit} className="space-y-3">
          <label
            htmlFor="research-url-input"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
          >
            <Link2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
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
                className="w-full pl-10 pr-9 py-2.5 text-sm text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500 dark:focus:border-sky-400 disabled:opacity-60"
              />
              {linkInput && !readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setLinkInput('');
                    setLinkError(null);
                  }}
                  aria-label="Svuota link"
                  className="p-1 text-slate-400 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-200 absolute right-2.5 top-1/2 -translate-y-1/2"
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
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <span>{linkInput.trim() ? 'Anteprima / Modifica' : 'Inserimento manuale'}</span>
                </button>
                <button
                  type="submit"
                  disabled={!linkInput.trim() || inspecting || savingNew}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
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

        {/* Optional Draft Review Form */}
        {draftOpen && !readOnly && (
          <form
            onSubmit={handleSaveDraft}
            className="mt-3 bg-slate-50 dark:bg-slate-950/90 border border-sky-300 dark:border-sky-500/30 rounded-xl p-4 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <span className="font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Anteprima &amp; Dettagli prodotto prima del salvataggio
              </span>
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {draftImageUrl && /^https?:\/\/.+/.test(draftImageUrl) && (
              <div className="flex items-center gap-3 p-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="w-16 h-16 rounded-lg bg-white border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 flex items-center justify-center p-1">
                  <img
                    src={draftImageUrl}
                    alt={draftTitle || 'Anteprima'}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-200">
                    {draftTitle || 'Anteprima immagine trovata dal sito'}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">{draftPrice ? `${draftPrice} €` : 'Prezzo non rilevato'}</span>
                    {draftStatus === 'acquistato' && draftPaidPrice && (
                      <span className="text-emerald-700 dark:text-emerald-300 font-medium tabular-nums">
                        · Pagato {draftPaidPrice} €
                      </span>
                    )}
                    {draftColor && (
                      <span className="inline-flex items-center gap-1" title={`Colore: ${draftColor}`}>
                        <ColorSwatchDot color={draftColor} size="sm" />
                        <span>{draftColor}</span>
                      </span>
                    )}
                    {draftSize && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[10px]">
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
                <label className="block text-slate-600 dark:text-slate-400">Titolo prodotto *</label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Es. Apple Custodia MagSafe in tessuto TechWoven..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Prezzo online (€ opz.)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1000000"
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(e.target.value)}
                  placeholder="Es. 58.00"
                  className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {draftStatus === 'acquistato' && (
                <div className="space-y-1">
                  <label className="block text-slate-600 dark:text-slate-400">Prezzo pagato all&apos;acquisto (€ opz.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1000000"
                    value={draftPaidPrice}
                    onChange={(e) => setDraftPaidPrice(e.target.value)}
                    placeholder="Es. 49.90"
                    className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-emerald-700 dark:text-emerald-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

              <div className="sm:col-span-2 lg:col-span-2 space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Link URL prodotto *</label>
                <input
                  type="text"
                  required
                  maxLength={1000}
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Negozio / Sito *</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={draftStore}
                  onChange={(e) => setDraftStore(e.target.value)}
                  placeholder="Es. Amazon, MediaWorld"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Marca</label>
                <input
                  type="text"
                  maxLength={60}
                  value={draftBrand}
                  onChange={(e) => setDraftBrand(e.target.value)}
                  placeholder="Es. Apple, Electrolux..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Modello / Codice / ASIN</label>
                <input
                  type="text"
                  maxLength={80}
                  value={draftModel}
                  onChange={(e) => setDraftModel(e.target.value)}
                  placeholder="Es. B0HJB2DT3H"
                  className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Stanza di casa</label>
                <select
                  value={draftRoom}
                  onChange={(e) => setDraftRoom(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
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
                <label className="block text-slate-600 dark:text-slate-400">Categoria</label>
                <select
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value as ProductResearchCategory)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Stato</label>
                <select
                  value={draftStatus}
                  onChange={(e) => {
                    const nextStatus = e.target.value as ProductResearchStatus;
                    setDraftStatus(nextStatus);
                    if (nextStatus !== 'acquistato') {
                      setDraftPaidPrice('');
                    }
                  }}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">URL Immagine</label>
                <input
                  type="text"
                  maxLength={1000}
                  value={draftImageUrl}
                  onChange={(e) => setDraftImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Colore / Finitura</label>
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
                <label className="block text-slate-600 dark:text-slate-400">Taglia / Capacità</label>
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

              <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-slate-600 dark:text-slate-400">
                    Specifiche tecniche (Etichetta: Valore, una per riga)
                  </label>
                  <textarea
                    rows={5}
                    value={draftTechSpecs}
                    onChange={(e) => setDraftTechSpecs(e.target.value)}
                    placeholder="Es. Sistema operativo: iOS&#10;Capacità della memoria: 1 TB&#10;Materiale: Polipropilene fiberglass&#10;Altezza schienale: 90 cm"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 resize-y"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-slate-600 dark:text-slate-400">
                      Informazioni &amp; Punti chiave (descrizioni dal sito)
                    </label>
                    <span
                      className={`text-[10px] font-mono tabular-nums ${
                        joinSpecsAndInfo(draftTechSpecs, draftInfoText).length > 1900
                          ? 'text-indigo-600 dark:text-indigo-300 font-semibold'
                          : 'text-slate-500'
                      }`}
                    >
                      {joinSpecsAndInfo(draftTechSpecs, draftInfoText).length}/2000
                    </span>
                  </div>
                  <textarea
                    rows={5}
                    value={draftInfoText}
                    onChange={(e) => setDraftInfoText(e.target.value)}
                    placeholder="Es. • DESIGN UNIBODY — In alluminio forgiato a caldo...&#10;• CUSCINI — Sfoderabili con zip, piedini antiscivolo"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 resize-y"
                  />
                </div>
              </div>

              <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                <label className="block text-slate-600 dark:text-slate-400">Note personali (opzionale)</label>
                <input
                  type="text"
                  maxLength={400}
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="Es. misure, confronto con altro modello, codice sconto..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Draft Attachments Queue & Detected Official Documents */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  Allega file a questo prodotto (PDF, ricevute, foto)
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={draftAttachmentType}
                    onChange={(e) => setDraftAttachmentType(e.target.value as ArticleAttachmentType)}
                    className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-[11px] text-slate-800 dark:text-slate-200 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                  >
                    {ATTACHMENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer transition-colors">
                    <Upload className="w-3 h-3 text-sky-600 dark:text-sky-400" />
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
              {draftFoundDocuments.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                    Documenti ufficiali rilevati dal sito (verranno scaricati/allegati al salvataggio):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {draftFoundDocuments.map((docLink) => (
                      <span
                        key={docLink.url}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30 rounded-lg text-[11px] text-emerald-800 dark:text-emerald-200"
                      >
                        <FileText className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <a
                          href={docLink.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate max-w-[200px] hover:underline"
                        >
                          {docLink.title}
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftFoundDocuments((prev) =>
                              prev.filter((d) => d.url !== docLink.url)
                            )
                          }
                          title="Non allegare questo documento"
                          className="text-emerald-600/70 hover:text-rose-600 dark:text-emerald-300/70 dark:hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {draftAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {draftAttachments.map((att) => {
                    const attMeta = getAttachmentTypeMeta(att.docType);
                    return (
                      <span
                        key={att.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-[11px] text-slate-800 dark:text-slate-200"
                      >
                        <FileText className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                        <span className="truncate max-w-[140px]">{att.file.name}</span>
                        <select
                          value={att.docType}
                          aria-label={`Tipo per ${att.file.name}`}
                          onChange={(e) => {
                            const nextType = e.target.value as ArticleAttachmentType;
                            setDraftAttachments((prev) =>
                              prev.map((x) =>
                                x.id === att.id ? { ...x, docType: nextType } : x
                              )
                            );
                          }}
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-medium cursor-pointer dark:[color-scheme:dark] focus:outline-none ${attMeta.badgeClass}`}
                        >
                          {ATTACHMENT_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-slate-500">({formatFileSize(att.file.size)})</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftAttachments((prev) => prev.filter((x) => x.id !== att.id))
                          }
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="px-3 py-1.5 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={savingNew}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg disabled:opacity-50"
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
          'w-full sm:w-auto min-w-0 max-w-full px-3 py-2 text-xs rounded-lg border dark:[color-scheme:dark] focus:outline-none focus:border-sky-500 transition-colors';
        const selectInactiveClass =
          'text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700';
        const selectActiveClass =
          'text-sky-800 dark:text-sky-100 font-semibold bg-sky-50 dark:bg-sky-500/15 border-sky-500 dark:border-sky-400/80 ring-1 ring-sky-500/25 dark:ring-sky-400/25';

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
              className={`bg-white dark:bg-slate-900 border rounded-xl p-4 sm:p-5 space-y-4 transition-colors shadow-xs dark:shadow-none ${
                hasActiveFilters
                  ? 'border-sky-400 dark:border-sky-500/45 ring-1 ring-sky-500/15'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              {/* Row 1: Summary Title + Page Totals + View Switcher & Copy List */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 min-w-0">
                <div className="min-w-0 md:shrink-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>Spazio personale</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {allResearches.length}{' '}
                      {allResearches.length === 1 ? 'articolo aggiunto' : 'articoli aggiunti'}
                    </span>
                    {kpis.toBuy > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-sky-600 dark:text-sky-300 tabular-nums font-medium">
                          {kpis.toBuy} da acquistare
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight mt-0.5 truncate">
                    {activeSectionTitle}
                  </h3>
                </div>

                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center md:justify-end gap-3 sm:gap-5 min-w-0">
                  {/* Totals */}
                  <div className="flex items-start justify-between sm:justify-start gap-3 sm:gap-5 min-w-0">
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        Valore totale pagina
                      </div>
                      <div className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 leading-tight mt-0.5 whitespace-nowrap">
                        {formatEuroIt(pageTotals.listTotal)}
                      </div>
                    </div>

                    <div className="w-px h-10 bg-slate-200 dark:bg-slate-800 self-center shrink-0" aria-hidden="true" />

                    <div className="min-w-0 text-right sm:text-left">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        Totale pagato
                      </div>
                      <div className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 leading-tight mt-0.5 whitespace-nowrap">
                        {formatEuroIt(pageTotals.paidTotal)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5 whitespace-nowrap">
                        su {pageTotals.paidCount} su {pageTotals.itemCount}{' '}
                        {pageTotals.itemCount === 1 ? 'articolo' : 'articoli'}
                      </div>
                    </div>
                  </div>

                  <div
                    className="hidden sm:block w-px h-10 bg-slate-200 dark:bg-slate-800 shrink-0"
                    aria-hidden="true"
                  />

                  {/* View Mode Toggle + Independent Room Grouping + Copy List */}
                  <div className="w-full sm:w-auto flex flex-wrap items-center gap-2 min-w-0">
                    <div
                      role="group"
                      aria-label="Modalità visualizzazione"
                      className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shrink-0"
                    >
                      <button
                        type="button"
                        onClick={() => handleChangeViewMode('list')}
                        aria-pressed={viewMode === 'list'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          viewMode === 'list'
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-xs'
                            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
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
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-xs'
                            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
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
                          ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-500 dark:text-slate-950 dark:border-sky-500 font-semibold'
                          : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      {listCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-700 dark:text-emerald-300">Lista copiata</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          <span>Copia lista</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800/80" />

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
                        ? 'bg-sky-50 text-sky-800 border-sky-500 dark:bg-sky-500/15 dark:text-sky-100 dark:border-sky-400/80 ring-1 ring-sky-500/25 dark:ring-sky-400/25 font-semibold'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400 dark:bg-slate-950 dark:text-slate-200 dark:border-slate-800 dark:hover:border-slate-700'
                    }`}
                  >
                    <Home className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
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
                      className="absolute left-0 top-full mt-1.5 z-40 w-64 max-w-[calc(100vw-2.5rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between px-2 py-1 border-b border-slate-200 dark:border-slate-800/80 mb-1">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Seleziona più stanze
                        </span>
                        {selectedRooms.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedRooms([])}
                            className="text-[11px] font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
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
                                  ? 'bg-sky-50 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100 font-semibold'
                                  : count > 0
                                  ? 'text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/80'
                                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800/60 dark:hover:text-slate-300'
                              }`}
                            >
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                    isSelected
                                      ? 'bg-sky-600 border-sky-600 text-white dark:bg-sky-400 dark:border-sky-400 dark:text-slate-950'
                                      : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950'
                                  }`}
                                >
                                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                </span>
                                <span className="truncate">{rm.label}</span>
                              </span>
                              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
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
                              ? 'bg-sky-50 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100 font-semibold'
                              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                selectedRooms.includes('none')
                                  ? 'bg-sky-600 border-sky-600 text-white dark:bg-sky-400 dark:border-sky-400 dark:text-slate-950'
                                  : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950'
                              }`}
                            >
                              {selectedRooms.includes('none') && (
                                <Check className="w-3 h-3 stroke-[3]" />
                              )}
                            </span>
                            <span className="truncate">Non assegnata</span>
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                            {roomStats.unassigned}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 shrink-0" aria-hidden="true" />

                <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0 flex-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => setSelectedRooms([])}
                    className={`px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap tabular-nums shrink-0 ${
                      selectedRooms.length === 0
                        ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-500 dark:text-slate-950 dark:border-sky-500 font-semibold'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400 hover:text-slate-900 dark:bg-slate-950 dark:text-slate-300 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:text-slate-100'
                    }`}
                  >
                    Tutte ({allResearches.length})
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
                            ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-500 dark:text-slate-950 dark:border-sky-500 font-semibold'
                            : 'bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400 hover:text-slate-900 dark:bg-slate-950 dark:text-slate-200 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:text-white'
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
                          ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-500 dark:text-slate-950 dark:border-sky-500 font-semibold'
                          : 'bg-slate-100 text-slate-700 border-slate-300 hover:border-slate-400 hover:text-slate-900 dark:bg-slate-800/75 dark:text-slate-300 dark:border-slate-700/80 dark:hover:border-slate-600 dark:hover:text-slate-100'
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
                      searchText.trim() ? 'text-sky-600 dark:text-sky-300' : 'text-slate-400'
                    }`}
                  />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Filtra tra i tuoi articoli (nome, marca, negozio, stanza, modello)..."
                    className={`w-full pl-9 ${
                      searchText.trim() ? 'pr-8' : 'pr-3'
                    } py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg border focus:outline-none focus:border-sky-500 transition-colors ${
                      searchText.trim()
                        ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-500 dark:border-sky-400/80 ring-1 ring-sky-500/20'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-800'
                    }`}
                  />
                  {searchText.trim() && (
                    <button
                      type="button"
                      onClick={() => setSearchText('')}
                      aria-label="Cancella ricerca"
                      title="Cancella testo di ricerca"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
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
                    <option value="all">Tutte le categorie ({allResearches.length})</option>
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
                    <option value="all">Tutti gli stati ({allResearches.length})</option>
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
                      className="flex-1 sm:flex-initial min-w-0 px-3 py-2 text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 rounded-lg dark:[color-scheme:dark] focus:outline-none focus:border-sky-500 transition-colors"
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
                      className="inline-flex items-center justify-center p-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 rounded-lg transition-colors shrink-0"
                    >
                      {sortDirection === 'asc' ? (
                        <ArrowUpNarrowWide className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      ) : (
                        <ArrowDownWideNarrow className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-slate-200 dark:border-slate-800/80 text-[11px]">
                  <span className="text-sky-700 dark:text-sky-300 font-medium mr-1 tabular-nums">
                    Filtri attivi ({filteredResearches.length}/{allResearches.length} risultati):
                  </span>
                  {activeChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={chip.onClear}
                      title="Clicca per rimuovere questo filtro"
                      className="inline-flex items-center gap-1 px-2 py-0.5 max-w-full rounded-md bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-800 dark:bg-sky-500/15 dark:hover:bg-sky-500/25 dark:border-sky-400/50 dark:text-sky-200 font-medium transition-colors"
                    >
                      <span className="truncate">{chip.label}</span>
                      <X className="w-3 h-3 text-sky-600 dark:text-sky-300 shrink-0" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 dark:text-indigo-200 dark:hover:text-indigo-100 dark:bg-indigo-500/15 dark:hover:bg-indigo-500/25 dark:border-indigo-400/40 transition-colors ml-auto whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Azzera filtri ({activeFilterCount})</span>
                  </button>
                </div>
              )}
            </section>

            {/* Product Grid / List */}
            {filteredResearches.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
                <ShoppingBag className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {allResearches.length === 0
                      ? 'Nessun prodotto salvato nelle ricerche'
                      : 'Nessun prodotto corrisponde ai filtri selezionati'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {allResearches.length === 0
                      ? 'Incolla un link prodotto nella barra in alto per aggiungerlo subito a questa pagina.'
                      : 'Prova a cambiare ricerca, stanza, negozio o stato.'}
                  </p>
                </div>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rimuovi tutti i filtri</span>
                  </button>
                )}
              </div>
            ) : (() => {
              const renderResearchCard = (item: ProductResearchRecord) => {
            const isLocalDraft = isLocalDraftId(item.id);
            const effectiveItem = getEffectiveItem(item);
            const hasPendingEdits = Boolean(pendingCardEdits[item.id]);
            const isSavingPendingHere = savingPendingId === item.id;
            const statusMeta = getStatusMeta(effectiveItem.status);
            const isEditing = editingId === item.id;
            const imageBroken = Boolean(effectiveItem.imageUrl) && brokenImages[item.id] === effectiveItem.imageUrl;
            const itemDocs = isLocalDraft ? [] : getDocumentsForResearch(researchDocuments, item.id);
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

            const baseColorsList = effectiveItem.availableColors || item.availableColors;
            const allAvailableColors =
              baseColorsList && baseColorsList.length > 0
                ? mergePreservedVariantOptions({
                    previousOptions: baseColorsList,
                    extraOptions: [effectiveItem.color, item.color],
                    normalizeKey: normalizeColorOptionKey,
                  }) || []
                : [];
            const baseSizesList = effectiveItem.availableSizes || item.availableSizes;
            const allAvailableSizes =
              baseSizesList && baseSizesList.length > 0
                ? mergePreservedVariantOptions({
                    previousOptions: baseSizesList,
                    extraOptions: [effectiveItem.size, item.size],
                    normalizeKey: normalizeSizeOptionKey,
                  }) || []
                : [];
            const unavailableVariants =
              unavailableVariantsById[item.id] ?? readCachedUnavailableVariants(item.url);
            const unavailableColorList = unavailableVariants?.colors;
            const unavailableSizeKeys = new Set(
              (unavailableVariants?.sizes || []).map(normalizeSizeOptionKey)
            );
            const isColorsExpanded = Boolean(expandedColorsIds[item.id]);
            const isAttachOpen = Boolean(openAttachmentsIds[item.id]);
            const selectedAttachType = cardAttachType[item.id] || 'scontrino_fattura';
            const isUploadingHere = uploadingResearchId === item.id;
            const isRefreshingHere = refreshingId === item.id;
            const currentRoomId = normalizeResearchRoom(effectiveItem.room) || '';
            const currentRoomLabel = getResearchRoomLabel(effectiveItem.room);
            const localQueueChange = isLocalDraft ? undefined : localQueueChangesById[item.id];
            const pendingEdit = pendingCardEdits[item.id];
            const isFieldQueued = (field: string): boolean =>
              Boolean(localQueueChange?.changedFields.has(field));
            const isFieldStaged = (field: string): boolean => {
              if (!pendingEdit) return false;
              switch (field) {
                case 'color':
                  return pendingEdit.color !== undefined;
                case 'size':
                  return pendingEdit.size !== undefined;
                case 'room':
                  return pendingEdit.room !== undefined;
                case 'status':
                  return pendingEdit.status !== undefined;
                case 'priceEur':
                  return pendingEdit.priceEur !== undefined;
                case 'paidPriceEur':
                  return pendingEdit.paidPriceEur !== undefined;
                case 'title':
                  return pendingEdit.title !== undefined;
                case 'imageUrl':
                  return pendingEdit.imageUrl !== undefined;
                case 'attachments':
                  return Boolean(
                    pendingEdit.docTypes && Object.keys(pendingEdit.docTypes).length > 0
                  );
                default:
                  return false;
              }
            };
            const isRoomChanged = isFieldQueued('room');
            const isRoomStaged = isFieldStaged('room');
            const isColorChanged = isFieldQueued('color');
            const isSizeChanged = isFieldQueued('size');
            const isStatusChanged = isFieldQueued('status');
            const isPriceChanged = isFieldQueued('priceEur');
            const isPaidPriceChanged = isFieldQueued('paidPriceEur');
            const isTitleChanged = isFieldQueued('title');
            const isBrandChanged = isFieldQueued('brand');
            const isStoreChanged = isFieldQueued('store');
            const isCategoryChanged = isFieldQueued('category');
            const isModelChanged = isFieldQueued('model');
            const isImageChanged = isFieldQueued('imageUrl');
            const isNotesChanged = isFieldQueued('notes');
            const isSpecsChanged = isFieldQueued('specs');
            const isAttachChanged = isFieldQueued('attachments');

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
              const origSplit = splitSpecsAndInfo(item.specs);
              const isEditFormDirty =
                isLocalDraft ||
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
                editTechSpecs.trim() !== origSplit.techSpecs.trim() ||
                editInfoText.trim() !== origSplit.infoText.trim() ||
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
                  className={`bg-white dark:bg-slate-900 border border-sky-400 dark:border-sky-500/50 rounded-xl p-4 space-y-2.5 text-xs shadow-xs dark:shadow-none ${
                    viewMode === 'list' ? '' : 'sm:col-span-2'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                    <span className="font-semibold text-sky-700 dark:text-sky-300">Modifica prodotto</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingEditSave(null);
                        setEditingId(null);
                      }}
                      className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-600 dark:text-slate-400">Titolo *</label>
                    <input
                      type="text"
                      required
                      maxLength={160}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-600 dark:text-slate-400">Link URL *</label>
                    <input
                      type="text"
                      required
                      maxLength={1000}
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">Negozio *</label>
                      <input
                        type="text"
                        required
                        maxLength={60}
                        value={editStore}
                        onChange={(e) => setEditStore(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">Prezzo online (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1000000"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    {editStatus === 'acquistato' && (
                      <div className="space-y-1">
                        <label className="text-slate-600 dark:text-slate-400">Prezzo pagato (€)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1000000"
                          value={editPaidPrice}
                          onChange={(e) => setEditPaidPrice(e.target.value)}
                          placeholder="Pagato..."
                          className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-emerald-700 dark:text-emerald-200 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">Marca</label>
                      <input
                        type="text"
                        maxLength={60}
                        value={editBrand}
                        onChange={(e) => setEditBrand(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">Modello / Codice</label>
                      <input
                        type="text"
                        maxLength={80}
                        value={editModel}
                        onChange={(e) => setEditModel(e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">Stanza di casa</label>
                      <select
                        value={editRoom}
                        onChange={(e) => setEditRoom(e.target.value)}
                        className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
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
                      <label className="text-slate-600 dark:text-slate-400">Categoria</label>
                      <select
                        value={editCategory}
                        onChange={(e) =>
                          setEditCategory(e.target.value as ProductResearchCategory)
                        }
                        className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">Stato</label>
                      <select
                        value={editStatus}
                        onChange={(e) => {
                          const nextStatus = e.target.value as ProductResearchStatus;
                          setEditStatus(nextStatus);
                          if (nextStatus !== 'acquistato') {
                            setEditPaidPrice('');
                          }
                        }}
                        className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">URL Immagine</label>
                      <input
                        type="text"
                        maxLength={1000}
                        value={editImageUrl}
                        onChange={(e) => setEditImageUrl(e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-600 dark:text-slate-400">Colore (scegli o scrivi)</label>
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
                    <label className="text-slate-600 dark:text-slate-400">Taglia / Capacità</label>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400">
                        Specifiche tecniche (Etichetta: Valore)
                      </label>
                      <textarea
                        rows={5}
                        value={editTechSpecs}
                        onChange={(e) => setEditTechSpecs(e.target.value)}
                        placeholder="Es. Sistema operativo: iOS&#10;Capacità della memoria: 1 TB&#10;Dimensioni schermo: 6,9 Pollici"
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 resize-y"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-slate-600 dark:text-slate-400">
                          Informazioni &amp; Punti chiave
                        </label>
                        <span
                          className={`text-[10px] font-mono tabular-nums ${
                            joinSpecsAndInfo(editTechSpecs, editInfoText).length > 1900
                              ? 'text-indigo-600 dark:text-indigo-300 font-semibold'
                              : 'text-slate-500'
                          }`}
                        >
                          {joinSpecsAndInfo(editTechSpecs, editInfoText).length}/2000
                        </span>
                      </div>
                      <textarea
                        rows={5}
                        value={editInfoText}
                        onChange={(e) => setEditInfoText(e.target.value)}
                        placeholder="Es. • DESIGN UNIBODY — Il design unibody in alluminio..."
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 resize-y"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-600 dark:text-slate-400">Note personali (opzionale)</label>
                    <textarea
                      rows={2}
                      maxLength={400}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 resize-y"
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
                      className="px-3 py-1.5 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isEditFormDirty ? 'Annulla' : 'Chiudi'}
                    </button>
                    {isEditFormDirty && (
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg disabled:opacity-50 transition-colors"
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
                <span
                  className={`inline-flex items-center gap-1 text-[11px] shrink-0 ${
                    isRoomChanged
                      ? 'px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-400 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/70 font-semibold'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Home
                    className={`w-3 h-3 ${
                      isRoomChanged
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-sky-600 dark:text-sky-400'
                    }`}
                  />
                  <span>{currentRoomLabel}</span>
                </span>
              ) : (
                <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
                  <Home
                    className={`w-3 h-3 shrink-0 ${
                      isRoomChanged
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-sky-600 dark:text-sky-400'
                    }`}
                  />
                  <select
                    aria-label={`Stanza per ${effectiveItem.title}`}
                    value={currentRoomId}
                    onChange={(e) => handleQuickRoomChange(item, e.target.value)}
                    className={`max-w-[135px] sm:max-w-none border rounded-md px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] dark:[color-scheme:dark] focus:outline-none ${
                      isRoomChanged
                        ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-400 dark:border-amber-400/80 text-amber-900 dark:text-amber-200 font-semibold ring-1 ring-amber-400/50 focus:border-amber-500'
                        : isRoomStaged
                          ? 'bg-sky-50 dark:bg-sky-500/15 border-sky-400 dark:border-sky-400/80 text-sky-900 dark:text-sky-200 font-semibold ring-1 ring-sky-400/50 focus:border-sky-500'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 text-slate-800 dark:text-slate-200 focus:border-sky-500'
                    }`}
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
                    className="w-24 px-2 py-0.5 text-[11px] font-mono bg-slate-50 dark:bg-slate-950 border border-emerald-500/70 rounded text-emerald-700 dark:text-emerald-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveInlinePaidPrice(item)}
                    className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:text-slate-950 rounded dark:hover:bg-emerald-400"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setInlinePaidEditId(null)}
                    className="p-0.5 text-slate-400 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-200"
                    aria-label="Annulla prezzo pagato"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : typeof effectiveItem.paidPriceEur === 'number' ? (
                readOnly ? (
                  <span
                    className={`inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap ${
                      isPaidPriceChanged
                        ? 'px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/15 ring-1 ring-amber-400/70'
                        : ''
                    }`}
                  >
                    <span>Pagato:</span>
                    <span className="font-mono tabular-nums">
                      {formatEuroIt(effectiveItem.paidPriceEur)}
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setInlinePaidEditId(item.id);
                      setInlinePaidValue(String(effectiveItem.paidPriceEur));
                    }}
                    title="Modifica prezzo pagato all'acquisto"
                    className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 whitespace-nowrap ${
                      isPaidPriceChanged
                        ? 'px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/15 ring-1 ring-amber-400/70'
                        : isFieldStaged('paidPriceEur')
                          ? 'px-1.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-500/15 ring-1 ring-sky-400/70'
                          : ''
                    }`}
                  >
                    <span>Pagato:</span>
                    <span className="font-mono tabular-nums">
                      {formatEuroIt(effectiveItem.paidPriceEur)}
                    </span>
                    <Pencil className="w-3.5 h-3.5 opacity-75 shrink-0" />
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
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300 whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" />
                  <span>Prezzo pagato</span>
                </button>
              ) : null;
            };

            const renderPriceBlock = (alignRightOnDesktop: boolean) => {
              const hasListPrice = typeof effectiveItem.priceEur === 'number';
              const stackAlignClass = alignRightOnDesktop
                ? 'items-start md:items-end'
                : 'items-start';

              return (
                <div className={`flex flex-col ${stackAlignClass} gap-1 min-w-0`}>
                  {hasListPrice ? (
                    <span
                      className={`inline-flex items-center gap-1.5 font-mono ${
                        alignRightOnDesktop
                          ? 'text-base sm:text-lg md:text-xl'
                          : 'text-lg sm:text-xl'
                      } font-bold tabular-nums leading-none ${
                        isPriceChanged
                          ? 'px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200 ring-1 ring-amber-400/70'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      <span>{formatEuroIt(effectiveItem.priceEur!)}</span>
                      {lazySizePriceLoadingIds[item.id] && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600 dark:text-sky-400" />
                      )}
                    </span>
                  ) : (
                    <span
                      className={
                        alignRightOnDesktop
                          ? 'text-[11px] sm:text-xs text-slate-500'
                          : 'text-xs text-slate-500'
                      }
                    >
                      Prezzo non rilevato
                    </span>
                  )}
                  {renderPaidPriceControl()}
                </div>
              );
            };

            const renderStatusControl = (compact = false) =>
              readOnly ? (
                <span
                  className={`${
                    compact ? 'px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px]' : 'px-2 py-0.5 text-[11px]'
                  } font-semibold rounded-md border whitespace-nowrap ${statusMeta.badgeClass} ${
                    isStatusChanged ? 'ring-2 ring-amber-400/85 dark:ring-amber-400/80' : ''
                  }`}
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
                  className={`${
                    compact
                      ? 'px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px]'
                      : 'px-2 py-1 text-[11px]'
                  } font-semibold rounded-md border dark:[color-scheme:dark] focus:outline-none ${statusMeta.badgeClass} ${
                    isStatusChanged
                      ? 'ring-2 ring-amber-400/85 dark:ring-amber-400/80'
                      : isFieldStaged('status')
                        ? 'ring-2 ring-sky-400/85 dark:ring-sky-400/80'
                        : ''
                  }`}
                >
                  {STATUS_OPTIONS.map((st) => (
                    <option
                      key={st.value}
                      value={st.value}
                      className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
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
                    ? 'py-1.5 px-2 sm:pt-2 sm:px-3 sm:pb-2.5 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between sm:justify-start gap-1 sm:gap-1.5 bg-slate-50/80 dark:bg-slate-950/30'
                    : 'pt-2.5 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2'
                }
              >
                <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-1 ${
                      inListFooter ? 'px-2 py-1 sm:px-2.5 sm:py-1.5' : 'px-2.5 py-1.5'
                    } text-[11px] font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap`}
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
                    } text-[11px] font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap`}
                  >
                    {copiedId === item.id ? (
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
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
                    className="p-1.5 text-slate-500 hover:text-sky-600 bg-slate-100 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-sky-300 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
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
                      className={`inline-flex items-center gap-1 px-1.5 py-1 sm:px-2 sm:py-1.5 text-[11px] rounded-lg border transition-colors whitespace-nowrap ${
                        itemDocs.length > 0
                          ? isAttachOpen
                            ? 'font-semibold text-emerald-900 bg-emerald-100 border-emerald-400 dark:text-emerald-100 dark:bg-emerald-500/30 dark:border-emerald-400/80 shadow-sm shadow-emerald-500/20'
                            : 'font-semibold text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 border-emerald-300 dark:text-emerald-200 dark:hover:text-emerald-100 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 dark:border-emerald-400/60'
                          : 'font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 border-transparent'
                      } ${isAttachChanged ? 'ring-2 ring-amber-400/80' : ''}`}
                    >
                      <Paperclip
                        className={`w-3 h-3 ${
                          itemDocs.length > 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      />
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
                      className="inline-flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 text-[11px] font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 dark:text-sky-300 dark:bg-sky-500/10 dark:hover:bg-sky-500/20 dark:border-sky-500/30 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
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
                      inListFooter ? 'sm:pl-1.5 sm:border-l sm:border-slate-200 dark:sm:border-slate-800' : ''
                    }`}
                  >
                    <button
                      type="button"
                      disabled={isRefreshingHere}
                      onClick={() => setPendingRefresh(item)}
                      aria-label="Aggiorna prodotto"
                      title="Aggiorna prodotto dal sito (foto, prezzo, colore e dettagli)"
                      className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-sky-300 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          isRefreshingHere ? 'animate-spin text-sky-600 dark:text-sky-400' : ''
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
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-500/15 dark:border-emerald-500/35 dark:text-emerald-300'
                            : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-emerald-700 hover:border-emerald-400 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300 dark:hover:text-emerald-300 dark:hover:border-emerald-500/40'
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
                      className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-sky-400 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        isLocalDraft ? handleDiscardLocalDraft(item.id) : setPendingDelete(item)
                      }
                      aria-label={isLocalDraft ? 'Scarta bozza' : 'Elimina prodotto'}
                      title={isLocalDraft ? 'Scarta bozza' : 'Elimina'}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-slate-800 rounded-lg transition-colors"
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
                className={`bg-white dark:bg-slate-900 border rounded-xl overflow-hidden flex flex-col transition-colors shadow-xs dark:shadow-none ${
                  isLocalDraft || hasPendingEdits
                    ? 'border-sky-400 dark:border-sky-400/75 ring-1 ring-sky-500/20'
                    : localQueueChange
                      ? 'border-amber-400/85 dark:border-amber-500/65 ring-1 ring-amber-400/25'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
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
                          ? `group relative w-20 h-20 m-2 sm:w-36 md:w-40 sm:h-36 sm:self-start sm:my-2 sm:mx-2.5 rounded-lg bg-white border flex items-center justify-center p-1 sm:p-1.5 overflow-hidden shrink-0 ${
                              isImageChanged
                                ? 'border-amber-400 dark:border-amber-400 ring-2 ring-amber-400/75'
                                : 'border-slate-200 dark:border-slate-800/80'
                            }`
                          : `group relative h-56 w-full bg-white border-b flex items-center justify-center p-2.5 overflow-hidden shrink-0 ${
                              isImageChanged
                                ? 'border-amber-400 dark:border-amber-400 ring-2 ring-inset ring-amber-400/65'
                                : 'border-slate-200 dark:border-slate-800/80'
                            }`
                      }
                    >
                      <img
                        src={displayThumb}
                        alt={effectiveItem.title}
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (hasExternal && effectiveItem.imageUrl) {
                            setBrokenImages((prev) => ({ ...prev, [item.id]: effectiveItem.imageUrl! }));
                          }
                        }}
                        className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                      {isImageChanged && (
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-white dark:text-slate-950 text-[9px] font-bold shadow-xs">
                          Foto
                        </span>
                      )}
                    </a>
                  ) : (
                    <div
                      className={
                        isList
                          ? 'relative w-20 h-20 m-2 sm:w-36 md:w-40 sm:h-36 sm:self-start sm:my-2 sm:mx-2.5 rounded-lg bg-gradient-to-b from-slate-100 to-slate-200/70 dark:from-slate-800/40 dark:to-slate-950/90 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-1 p-1.5 sm:p-2.5 text-center shrink-0'
                          : 'relative h-56 w-full bg-gradient-to-b from-slate-100 to-slate-200/70 dark:from-slate-800/40 dark:to-slate-950/90 border-b border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-2.5 p-4 text-center shrink-0'
                      }
                    >
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex flex-col items-center gap-0.5 sm:gap-1 text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300 transition-colors"
                      >
                        {effectiveItem.imageUrl ? (
                          <ImageOff className={isList ? 'w-4 h-4 sm:w-6 sm:h-6 text-slate-400 dark:text-slate-500' : 'w-8 h-8 text-slate-400 dark:text-slate-500'} />
                        ) : (
                          <ShoppingBag className={isList ? 'w-4 h-4 sm:w-6 sm:h-6 text-slate-400 dark:text-slate-500' : 'w-8 h-8 text-slate-400 dark:text-slate-500'} />
                        )}
                        <span className={isList ? 'text-[10px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 truncate max-w-full' : 'text-xs font-semibold text-slate-700 dark:text-slate-300'}>
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
                          } font-medium text-sky-700 bg-white hover:bg-slate-50 border border-slate-300 dark:text-sky-300 dark:bg-slate-900/90 dark:hover:bg-slate-800 dark:border-slate-700 rounded-md sm:rounded-lg transition-colors disabled:opacity-50`}
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
                        ? 'pt-2 pb-1.5 pr-2.5 pl-0 sm:pt-2.5 sm:pb-1.5 sm:pr-3 sm:pl-0.5 flex-1 flex flex-col gap-1.5 sm:gap-2 min-w-0'
                        : 'p-3.5 pb-3 flex-1 flex flex-col gap-2 min-w-0'
                    }
                  >
                  {isList ? (
                    /* LIST MODE HEADER: Meta + Room + Status + Title on left, Price + Paid cleanly on right */
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-1.5 sm:gap-2 pb-1.5 sm:pb-2 border-b border-slate-200 dark:border-slate-800/80">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-1 text-[10px] sm:text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {effectiveBrand && (
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                isBrandChanged
                                  ? 'px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/60'
                                  : 'text-sky-600 dark:text-sky-300'
                              }`}
                              title={`Marca: ${effectiveBrand}`}
                            >
                              <Tag className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                              <span>{effectiveBrand}</span>
                            </span>
                          )}
                          {(!effectiveBrand ||
                            effectiveBrand.toLowerCase() !== item.store.toLowerCase()) && (
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                isStoreChanged
                                  ? 'px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/60'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                              title={`Negozio: ${item.store}`}
                            >
                              <Store className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-400 shrink-0" />
                              <span>{item.store}</span>
                            </span>
                          )}
                          <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={
                              isCategoryChanged
                                ? 'px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/60 font-semibold'
                                : ''
                            }
                          >
                            {getCategoryLabel(item.category)}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700 hidden sm:inline" aria-hidden="true">
                            |
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {renderRoomControl()}
                            {renderStatusControl(true)}
                          </div>
                        </div>

                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`block text-[13px] sm:text-sm font-semibold leading-snug break-words line-clamp-2 sm:line-clamp-none ${
                            isTitleChanged
                              ? 'pl-2 border-l-2 border-amber-400 text-amber-900 hover:text-amber-700 dark:text-amber-200 dark:hover:text-amber-100'
                              : 'text-slate-900 hover:text-sky-600 dark:text-slate-100 dark:hover:text-sky-300'
                          }`}
                        >
                          {effectiveItem.title}
                        </a>
                      </div>

                      <div className="flex flex-col items-start md:items-end justify-center shrink-0 md:border-l md:border-slate-200 dark:md:border-slate-800/80 md:pl-3">
                        {renderPriceBlock(true)}
                      </div>
                    </div>
                  ) : (
                    /* GRID MODE HEADER: 1. Meta + Room -> 2. Title */
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                          {effectiveBrand && (
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                isBrandChanged
                                  ? 'px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/60'
                                  : 'text-sky-600 dark:text-sky-300'
                              }`}
                              title={`Marca: ${effectiveBrand}`}
                            >
                              <Tag className="w-3 h-3 shrink-0" />
                              <span>{effectiveBrand}</span>
                            </span>
                          )}
                          {(!effectiveBrand ||
                            effectiveBrand.toLowerCase() !== item.store.toLowerCase()) && (
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                isStoreChanged
                                  ? 'px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/60'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                              title={`Negozio: ${item.store}`}
                            >
                              <Store className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>{item.store}</span>
                            </span>
                          )}
                          <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={
                              isCategoryChanged
                                ? 'px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/60 font-semibold'
                                : ''
                            }
                          >
                            {getCategoryLabel(item.category)}
                          </span>
                        </div>

                        {renderRoomControl()}
                      </div>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`block text-sm font-semibold leading-snug break-words ${
                          isTitleChanged
                            ? 'pl-2 border-l-2 border-amber-400 text-amber-900 hover:text-amber-700 dark:text-amber-200 dark:hover:text-amber-100'
                            : 'text-slate-900 hover:text-sky-600 dark:text-slate-100 dark:hover:text-sky-300'
                        }`}
                      >
                        {effectiveItem.title}
                      </a>
                    </>
                  )}

                  {/* 3. Product Colors + Sizes + Model Code (inline wrap in list mode for compact height) */}
                  {(effectiveItem.color ||
                    allAvailableColors.length > 0 ||
                    effectiveItem.size ||
                    allAvailableSizes.length > 0 ||
                    item.model) && (
                    <div
                      className={
                        isList
                          ? 'flex flex-wrap items-start gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400'
                          : 'space-y-1.5 text-xs text-slate-500 dark:text-slate-400'
                      }
                    >
                      {allAvailableColors.length > 0 ? (
                        <CollapsibleColorChips
                          colors={allAvailableColors}
                          activeColor={effectiveItem.color}
                          unavailableColors={unavailableColorList}
                          expanded={isColorsExpanded}
                          highlightActive={isColorChanged}
                          onToggleExpand={() =>
                            setExpandedColorsIds((prev) => ({
                              ...prev,
                              [item.id]: !prev[item.id],
                            }))
                          }
                          readOnly={readOnly}
                          onSelectColor={(colOpt) => handleQuickColorSelect(item, colOpt)}
                        />
                      ) : effectiveItem.color ? (
                        <div className="flex flex-wrap items-center gap-1.5 min-h-[24px]">
                          <span
                            className={`inline-flex items-center gap-1.5 font-medium ${
                              isColorChanged
                                ? 'px-2 py-0.5 rounded-md border border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-500/20 dark:text-amber-100 font-semibold ring-1 ring-amber-400/60'
                                : 'text-slate-700 dark:text-slate-200'
                            }`}
                            title={`Colore: ${effectiveItem.color}`}
                          >
                            <ColorSwatchDot color={effectiveItem.color} size="md" />
                            <span>{effectiveItem.color}</span>
                          </span>
                        </div>
                      ) : null}

                      {allAvailableSizes.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
                          <span
                            className={`text-[10px] uppercase tracking-wide mr-0.5 leading-none ${
                              isSizeChanged
                                ? 'text-amber-700 dark:text-amber-300 font-semibold'
                                : 'text-slate-500'
                            }`}
                          >
                            Taglia:
                          </span>
                          {allAvailableSizes.map((sizeOpt) => {
                            const sizeOptKey = normalizeSizeOptionKey(sizeOpt);
                            const isActive =
                              Boolean(effectiveItem.size) &&
                              normalizeSizeOptionKey(effectiveItem.size!) === sizeOptKey;
                            const isMissingOnSite = unavailableSizeKeys.has(sizeOptKey);
                            const optPrice = findSizePrice(effectiveItem.sizePrices, sizeOpt);
                            const missingHint = isMissingOnSite
                              ? " · non più disponibile sul sito all'ultimo aggiornamento (opzione mantenuta)"
                              : '';
                            const sizeTooltip =
                              typeof optPrice === 'number'
                                ? `Seleziona taglia ${sizeOpt} · ${formatEuroIt(optPrice)}${missingHint}`
                                : `Seleziona taglia ${sizeOpt}${missingHint}`;
                            const activeSizeCls = isSizeChanged
                              ? 'bg-amber-50 border-amber-500 text-amber-900 dark:bg-amber-500/20 dark:border-amber-400 dark:text-amber-100 font-semibold ring-1 ring-amber-400/60'
                              : 'bg-sky-50 border-sky-500 text-sky-800 dark:bg-sky-500/15 dark:border-sky-400/70 dark:text-sky-200 font-semibold';
                            const dashedCls = isMissingOnSite ? 'border-dashed ' : '';
                            return readOnly ? (
                              <span
                                key={sizeOpt}
                                title={sizeTooltip}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[11px] leading-4 ${dashedCls}${
                                  isActive
                                    ? activeSizeCls
                                    : isMissingOnSite
                                      ? 'bg-slate-50/70 border-slate-300 text-slate-500 dark:bg-slate-950/40 dark:border-slate-700 dark:text-slate-400 opacity-85'
                                      : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-950/70 dark:border-slate-800 dark:text-slate-400'
                                }`}
                              >
                                <span>{sizeOpt}</span>
                                {isMissingOnSite && (
                                  <span className="text-[9px] font-sans font-medium opacity-75">
                                    (storico)
                                  </span>
                                )}
                              </span>
                            ) : (
                              <button
                                key={sizeOpt}
                                type="button"
                                onClick={() => handleQuickSizeSelect(item, sizeOpt)}
                                title={sizeTooltip}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[11px] leading-4 transition-colors ${dashedCls}${
                                  isActive
                                    ? activeSizeCls
                                    : isMissingOnSite
                                      ? 'bg-slate-50/70 border-slate-300 text-slate-600 hover:border-slate-400 dark:bg-slate-950/40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 opacity-85'
                                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 dark:bg-slate-950/70 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-600'
                                }`}
                              >
                                <span>{sizeOpt}</span>
                                {isMissingOnSite && (
                                  <span className="text-[9px] font-sans font-medium opacity-75">
                                    (storico)
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : effectiveItem.size ? (
                        <div className="flex flex-wrap items-center gap-1.5 min-h-[24px]">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md border font-mono text-[11px] leading-4 ${
                              isSizeChanged
                                ? 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-500/20 dark:text-amber-100 font-semibold ring-1 ring-amber-400/60'
                                : 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {effectiveItem.size}
                          </span>
                        </div>
                      ) : null}

                      {item.model && (
                        <div
                          className={`inline-flex items-center min-h-[24px] font-mono text-[11px] ${
                            isModelChanged
                              ? 'px-1.5 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 dark:bg-amber-500/15 dark:border-amber-400/60 dark:text-amber-200'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          Cod. {item.model}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4. Grid Mode Price + Paid Price + Status Row */}
                  {!isList && (
                    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-y border-slate-200 dark:border-slate-800/80">
                      {renderPriceBlock(false)}

                      {renderStatusControl()}
                    </div>
                  )}

                  {/* 5. Specifications & Notes with Vedi tutti i dettagli / Mostra meno in both Grid & List */}
                  {(filteredSpecEntries.length > 0 || hasUniqueNotes) && (
                    <div
                      className={`${isList ? 'space-y-1' : 'space-y-2'} ${
                        isSpecsChanged
                          ? 'pl-2 border-l-2 border-amber-400 bg-amber-50/40 dark:bg-amber-500/10 rounded-r-md py-0.5'
                          : ''
                      }`}
                    >
                      {hasUniqueNotes && (
                        <p
                          className={`text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line break-words ${
                            isList && !isSpecsExpanded ? 'line-clamp-1 sm:line-clamp-none' : ''
                          } ${
                            isNotesChanged && !isSpecsChanged
                              ? 'pl-2 border-l-2 border-amber-400 bg-amber-50/40 dark:bg-amber-500/10 rounded-r-md py-0.5'
                              : ''
                          }`}
                        >
                          {item.notes}
                        </p>
                      )}

                      {visibleTechSpecs.length > 0 && (
                        <ul
                          className={
                            isList
                              ? `${isSpecsExpanded ? 'grid' : 'hidden sm:grid'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-300 leading-snug`
                              : 'space-y-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed'
                          }
                        >
                          {visibleTechSpecs.map((entry, idx) => {
                            const isColorSpec =
                              entry.label?.toLowerCase() === 'colore' ||
                              entry.label?.toLowerCase() === 'color';
                            return (
                              <li key={`tech-${idx}`} className="flex items-start gap-1.5 min-w-0">
                                <span className="text-sky-600 dark:text-sky-400 shrink-0">·</span>
                                <span className="min-w-0 break-words">
                                  {isColorSpec ? (
                                    <span
                                      className="inline-flex items-center gap-1.5"
                                      title={`Colore: ${entry.value}`}
                                    >
                                      <ColorSwatchDot color={entry.value} size="sm" />
                                      <span className="text-slate-800 dark:text-slate-200 font-medium">
                                        {entry.value}
                                      </span>
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-slate-500 dark:text-slate-400">{entry.label}: </span>
                                      <span className="text-slate-800 dark:text-slate-200 font-medium">
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
                              ? `${isSpecsExpanded ? 'block' : 'hidden sm:block'} ${
                                  visibleTechSpecs.length > 0
                                    ? 'pt-2 mt-1.5 border-t border-slate-200 dark:border-slate-800/70 '
                                    : ''
                                }columns-1 ${
                                  visibleDescriptiveSpecs.length === 2 ||
                                  visibleDescriptiveSpecs.length === 4
                                    ? 'md:columns-2'
                                    : visibleDescriptiveSpecs.length >= 3
                                      ? 'md:columns-2 xl:columns-3'
                                      : ''
                                } gap-x-5 text-[11px] text-slate-600 dark:text-slate-300 leading-snug`
                              : `${
                                  visibleTechSpecs.length > 0
                                    ? 'pt-1.5 mt-1.5 border-t border-slate-200 dark:border-slate-800/70 '
                                    : ''
                                }space-y-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed`
                          }
                        >
                          {visibleDescriptiveSpecs.map((entry, idx) => {
                            const dashIdx = entry.value.indexOf(' — ');
                            const hasLeadHeadline = dashIdx > 2 && dashIdx <= 90;
                            return (
                              <li
                                key={`desc-${idx}`}
                                className={
                                  isList
                                    ? 'break-inside-avoid mb-1.5 last:mb-0'
                                    : 'flex items-start gap-1.5 min-w-0'
                                }
                              >
                                <div className="flex items-start gap-1.5 min-w-0">
                                  <span className="text-sky-600 dark:text-sky-400 shrink-0">·</span>
                                  <span className="min-w-0 break-words">
                                    {hasLeadHeadline ? (
                                      <>
                                        <span className="text-slate-900 dark:text-slate-100 font-semibold">
                                          {entry.value.slice(0, dashIdx)}
                                        </span>
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {entry.value.slice(dashIdx)}
                                        </span>
                                      </>
                                    ) : (
                                      <span>{entry.value}</span>
                                    )}
                                  </span>
                                </div>
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
                          } items-center gap-1 text-[11px] text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 font-medium`}
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

                  {/* 6. Bottom-pinned Attachments & Actions */}
                  {(!isList || isAttachOpen) && (
                  <div className="mt-auto space-y-2">
                    {/* In Grid mode show attachments header row; in List mode show drawer only when expanded/populated */}
                    {(!isList && (itemDocs.length > 0 || !readOnly || isAttachOpen)) ||
                    (isList && isAttachOpen) ? (
                      <div className="border-t border-slate-200 dark:border-slate-800/70 pt-2 space-y-2">
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
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] transition-colors ${
                                itemDocs.length > 0
                                  ? isAttachOpen
                                    ? 'font-semibold text-emerald-900 bg-emerald-100 border-emerald-400 dark:text-emerald-100 dark:bg-emerald-500/30 dark:border-emerald-400/80'
                                    : 'font-semibold text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 border-emerald-300 dark:text-emerald-200 dark:hover:text-emerald-100 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 dark:border-emerald-400/60'
                                  : 'font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70'
                              } ${isAttachChanged ? 'ring-2 ring-amber-400/80' : ''}`}
                            >
                              <Paperclip
                                className={`w-3.5 h-3.5 ${
                                  itemDocs.length > 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'
                                }`}
                              />
                              <span>Allegati ({itemDocs.length})</span>
                              {isAttachOpen ? (
                                <ChevronUp
                                  className={`w-3 h-3 ${
                                    itemDocs.length > 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                />
                              ) : (
                                <ChevronDown
                                  className={`w-3 h-3 ${
                                    itemDocs.length > 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                />
                              )}
                            </button>

                            {!readOnly && (
                              <button
                                type="button"
                                disabled={isUploadingHere}
                                onClick={() => triggerCardFileUpload(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 dark:text-sky-300 dark:bg-sky-500/10 dark:hover:bg-sky-500/20 dark:border-sky-500/30 rounded-md transition-colors disabled:opacity-50"
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
                            <span className="text-slate-500 dark:text-slate-400 shrink-0">Tipo allegato:</span>
                            <select
                              value={selectedAttachType}
                              onChange={(e) =>
                                setCardAttachType((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value as ArticleAttachmentType,
                                }))
                              }
                              className="flex-1 min-w-[140px] max-w-xs px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
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
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 dark:text-sky-300 dark:bg-sky-500/10 dark:hover:bg-sky-500/20 dark:border-sky-500/30 rounded-md transition-colors disabled:opacity-50"
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

                        {isAttachOpen && itemDocs.length > 0 && (
                          <div className={isList ? 'grid grid-cols-1 md:grid-cols-2 gap-1.5' : 'space-y-1.5'}>
                            {itemDocs.map((docItem) => {
                                const parsedRef = parseResearchDocumentRef(docItem.referenceCode);
                                const savedDocType = parsedRef?.docType || 'altro';
                                const effectiveDocType =
                                  pendingCardEdits[item.id]?.docTypes?.[docItem.id] ?? savedDocType;
                                const docMeta = getAttachmentTypeMeta(effectiveDocType);
                                const isImg = docItem.fileMime?.startsWith('image/');
                                const isLinkOnlyDoc = !docItem.fileSize && Boolean(docItem.cloudUrl);
                                const openTabHref = isLinkOnlyDoc
                                  ? docItem.cloudUrl
                                  : vaultDocUrls[docItem.id];
                                return (
                                  <div
                                    key={docItem.id}
                                    className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-md px-2 py-1.5 text-[11px]"
                                  >
                                    <div className="min-w-0 flex items-center gap-1.5">
                                      {isImg ? (
                                        <ImageIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300 shrink-0" />
                                      ) : isLinkOnlyDoc ? (
                                        <Link2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                                      ) : (
                                        <FileText className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        {openTabHref ? (
                                          <a
                                            href={openTabHref}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block text-slate-800 hover:text-sky-600 dark:text-slate-200 dark:hover:text-sky-300 font-medium truncate transition-colors"
                                            title={`Apri in nuova scheda: ${docItem.fileName || docItem.title}`}
                                          >
                                            {docItem.fileName || docItem.title}
                                          </a>
                                        ) : (
                                          <button
                                            type="button"
                                            disabled={openingDocId === docItem.id}
                                            onClick={() => void handleOpenDocInNewTab(docItem)}
                                            className="block w-full text-left text-slate-800 hover:text-sky-600 dark:text-slate-200 dark:hover:text-sky-300 font-medium truncate transition-colors disabled:opacity-50"
                                            title={`Apri in nuova scheda: ${docItem.fileName || docItem.title}`}
                                          >
                                            {docItem.fileName || docItem.title}
                                          </button>
                                        )}
                                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                                          {!readOnly && onUpdateResearchDocumentType ? (
                                            <select
                                              value={effectiveDocType}
                                              disabled={
                                                isSavingPendingHere ||
                                                (savingEdit && pendingEditSave?.item.id === item.id)
                                              }
                                              title="Modifica tipo allegato"
                                              aria-label={`Modifica tipo per ${docItem.fileName || docItem.title}`}
                                              onChange={(e) =>
                                                handleQuickDocTypeChange(
                                                  item,
                                                  docItem,
                                                  e.target.value as ArticleAttachmentType
                                                )
                                              }
                                              className={`px-1.5 py-0.5 rounded border text-[10px] font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-500/60 disabled:opacity-50 dark:[color-scheme:dark] ${docMeta.badgeClass}`}
                                            >
                                              {ATTACHMENT_TYPE_OPTIONS.map((opt) => (
                                                <option
                                                  key={opt.value}
                                                  value={opt.value}
                                                  className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                                                >
                                                  {opt.label}
                                                </option>
                                              ))}
                                            </select>
                                          ) : (
                                            <span
                                              className={`px-1.5 py-0.5 rounded border ${docMeta.badgeClass}`}
                                            >
                                              {docMeta.label}
                                            </span>
                                          )}
                                          {docItem.fileSize ? (
                                            <span>{formatFileSize(docItem.fileSize)}</span>
                                          ) : isLinkOnlyDoc ? (
                                            <span
                                              className="text-sky-700 dark:text-sky-300/90"
                                              title="Il sito di origine ha bloccato il download automatico: puoi caricare il file manualmente nell'archivio"
                                            >
                                              Link diretto
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                      {openTabHref ? (
                                        <a
                                          href={openTabHref}
                                          target="_blank"
                                          rel="noreferrer"
                                          title="Apri in nuova scheda"
                                          className="p-1 text-sky-600 hover:bg-slate-200/70 dark:text-sky-300 dark:hover:bg-slate-800 rounded transition-colors"
                                        >
                                          <ExternalLink className="w-3.5 h-3.5" />
                                        </a>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={openingDocId === docItem.id}
                                          onClick={() => void handleOpenDocInNewTab(docItem)}
                                          title="Apri in nuova scheda"
                                          className="p-1 text-sky-600 hover:bg-slate-200/70 dark:text-sky-300 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                                        >
                                          {openingDocId === docItem.id ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          ) : (
                                            <ExternalLink className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      )}
                                      {isLinkOnlyDoc && !readOnly && (
                                        <button
                                          type="button"
                                          disabled={isUploadingHere}
                                          onClick={() =>
                                            triggerCardFileUpload(
                                              item,
                                              parsedRef?.docType || 'manuale',
                                              docItem
                                            )
                                          }
                                          title="Salva file nell'archivio al posto del link diretto"
                                          className="p-1 text-indigo-600 hover:bg-slate-200/70 dark:text-indigo-300 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                                        >
                                          {isUploadingHere ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          ) : (
                                            <Upload className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      )}
                                      {!isLinkOnlyDoc && (
                                        <button
                                          type="button"
                                          disabled={downloadingDocId === docItem.id}
                                          onClick={() => void handleDownloadDoc(docItem)}
                                          title="Scarica allegato"
                                          className="p-1 text-emerald-600 hover:bg-slate-200/70 dark:text-emerald-300 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                                        >
                                          {downloadingDocId === docItem.id ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          ) : (
                                            <Download className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      )}
                                      {!readOnly && (
                                        <button
                                          type="button"
                                          disabled={deletingDocId === docItem.id}
                                          onClick={() =>
                                            setPendingDeleteDoc({
                                              doc: docItem,
                                              productTitle: effectiveItem.title,
                                            })
                                          }
                                          title="Rimuovi allegato"
                                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-200/70 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
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
                  )}
                </div>
                </div>

                {isList && renderCardActionButtons(true)}

                {(isLocalDraft || hasPendingEdits) && !readOnly && (
                  <div className="px-3 py-2 border-t border-sky-200 dark:border-sky-500/35 bg-sky-50 dark:bg-sky-950/35 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-sky-800 dark:text-sky-200 font-medium inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400 animate-pulse shrink-0" />
                      {isLocalDraft
                        ? writesDisabled
                          ? 'Bozza in pagina · Non ancora salvata in coda locale'
                          : 'Bozza in pagina · Non ancora salvata su Firestore'
                        : 'Modifiche non salvate'}
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        disabled={isSavingPendingHere || savingEdit}
                        onClick={() =>
                          isLocalDraft
                            ? handleDiscardLocalDraft(item.id)
                            : handleDiscardPendingCardEdit(item.id)
                        }
                        className="px-2 py-1 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 dark:text-slate-300 dark:hover:text-slate-100 dark:bg-slate-900/90 dark:hover:bg-slate-800 dark:border-slate-700 rounded-md transition-colors disabled:opacity-50"
                      >
                        {isLocalDraft ? 'Scarta' : 'Annulla'}
                      </button>
                      <button
                        type="button"
                        disabled={isSavingPendingHere || savingEdit}
                        onClick={() => requestCommitPendingCardEdit(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-md transition-colors disabled:opacity-50"
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

                {!isLocalDraft && !hasPendingEdits && localQueueChange && (
                  <div className="px-3 py-1.5 border-t border-amber-200 dark:border-amber-500/35 bg-amber-50/90 dark:bg-amber-950/30 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 shrink-0" />
                      {localQueueChange.isNew
                        ? 'Nuovo in locale · Non ancora su Firestore'
                        : 'Modificato in locale · Non ancora su Firestore'}
                    </span>
                    {localQueueChange.details.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {localQueueChange.details.map((detail, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-900/80 border border-amber-300/80 dark:border-amber-500/40 text-[10px] font-medium text-amber-900 dark:text-amber-200"
                          >
                            {detail}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800/80">
                          <div className="flex items-center gap-2 min-w-0">
                            <Home className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                            <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {group.label}
                            </h4>
                            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                              · {group.items.length}{' '}
                              {group.items.length === 1 ? 'articolo' : 'articoli'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                            <span className="text-slate-600 dark:text-slate-400">
                              Valore:{' '}
                              <strong className="font-mono text-slate-900 dark:text-slate-100">
                                {formatEuroIt(group.listTotal)}
                              </strong>
                            </span>
                            {group.paidCount > 0 && (
                              <span className="text-slate-600 dark:text-slate-400">
                                Pagato:{' '}
                                <strong className="font-mono text-emerald-600 dark:text-emerald-400">
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
                                className="px-2.5 py-1 text-[11px] font-medium text-sky-700 hover:text-sky-900 bg-white hover:bg-slate-100 border border-slate-300 dark:text-sky-300 dark:hover:text-sky-200 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-800 rounded-lg transition-colors whitespace-nowrap"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isLocalDraftId(pendingDelete.id)
                    ? 'Scartare questa bozza?'
                    : writesDisabled
                      ? 'Eliminare in locale (Modalità Test)?'
                      : 'Eliminare questa ricerca?'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {isLocalDraftId(pendingDelete.id) ? (
                    <>
                      Vuoi davvero rimuovere la bozza{' '}
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {pendingDelete.title}
                      </span>{' '}
                      ({pendingDelete.store}) dalla pagina?
                    </>
                  ) : writesDisabled ? (
                    <>
                      Modalità Test attiva (scritture Firestore disattivate): vuoi simulare la rimozione di{' '}
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {pendingDelete.title}
                      </span>{' '}
                      ({pendingDelete.store}) e degli eventuali file allegati in locale? L’eliminazione verrà inviata a Firestore solo quando riattiverai le scritture.
                    </>
                  ) : (
                    <>
                      Vuoi davvero rimuovere{' '}
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {pendingDelete.title}
                      </span>{' '}
                      ({pendingDelete.store}) e gli eventuali file allegati da Firestore?
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDeleteResearch()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition-colors"
              >
                {deleting
                  ? 'Eliminazione...'
                  : writesDisabled && !isLocalDraftId(pendingDelete.id)
                    ? 'Elimina in locale'
                    : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {writesDisabled
                    ? 'Eliminare allegato in locale (Modalità Test)?'
                    : 'Eliminare questo allegato?'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {writesDisabled ? 'Modalità Test attiva: vuoi rimuovere in locale ' : 'Vuoi davvero rimuovere '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100 break-words">
                    {pendingDeleteDoc.doc.fileName || pendingDeleteDoc.doc.title}
                  </span>{' '}
                  da{' '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {pendingDeleteDoc.productTitle}
                  </span>{' '}
                  {writesDisabled
                    ? '(verrà rimosso da Firestore quando riattiverai le scritture)?'
                    : 'su Firestore?'}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={deletingDocId === pendingDeleteDoc.doc.id}
                onClick={() => setPendingDeleteDoc(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deletingDocId === pendingDeleteDoc.doc.id}
                onClick={() => void confirmDeleteDoc()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition-colors"
              >
                {deletingDocId === pendingDeleteDoc.doc.id
                  ? 'Eliminazione...'
                  : writesDisabled
                    ? 'Elimina in locale'
                    : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRefresh && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400 shrink-0">
                <RefreshCw
                  className={`w-5 h-5 ${
                    refreshingId === pendingRefresh.id ? 'animate-spin' : ''
                  }`}
                />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {writesDisabled && !isLocalDraftId(pendingRefresh.id)
                    ? 'Aggiornare il prodotto in locale?'
                    : 'Aggiornare questo prodotto?'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Vuoi ri-analizzare il link di{' '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {getEffectiveItem(pendingRefresh).title}
                  </span>{' '}
                  ({pendingRefresh.store}) per aggiornare i dati dal sito
                  {isLocalDraftId(pendingRefresh.id)
                    ? ' sulla bozza'
                    : writesDisabled
                      ? ' in locale (Modalità Test attiva: salvataggio su Firestore rimandato alla riattivazione)'
                      : ' su Firestore'}{' '}
                  mantenendo colore, taglia, stanza e stato selezionati?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={refreshingId === pendingRefresh.id}
                onClick={() => setPendingRefresh(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={refreshingId === pendingRefresh.id}
                onClick={() => void confirmRefreshResearch()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-400 dark:hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors"
              >
                {refreshingId === pendingRefresh.id ? 'Aggiornamento...' : 'Aggiorna'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingEditSave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400 shrink-0">
                <Pencil className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {writesDisabled
                    ? pendingEditSave.isNewDraft
                      ? 'Salvare il nuovo prodotto in locale?'
                      : 'Salvare le modifiche in locale?'
                    : pendingEditSave.isNewDraft
                      ? 'Salvare il nuovo prodotto su Firestore?'
                      : 'Salvare le modifiche al prodotto?'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {writesDisabled ? (
                    <>
                      Modalità Test attiva (scritture su Firestore disattivate).{' '}
                      {pendingEditSave.isNewDraft ? 'Vuoi salvare in locale ' : 'Vuoi aggiornare in locale '}
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {pendingEditSave.payload.title}
                      </span>{' '}
                      ({pendingEditSave.payload.store})
                      {pendingEditSave.isNewDraft
                        ? ' nella coda locale? '
                        : pendingEditSave.skipProductUpdate &&
                            pendingEditSave.docTypeChanges &&
                            pendingEditSave.docTypeChanges.length > 0
                          ? ' con la nuova tipologia degli allegati? '
                          : ' con i nuovi dati? '}
                      L’operazione resterà visibile e verrà salvata su Firestore quando riattiverai le scritture.
                    </>
                  ) : (
                    <>
                      {pendingEditSave.isNewDraft ? 'Vuoi salvare ' : 'Vuoi aggiornare '}
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {pendingEditSave.payload.title}
                      </span>{' '}
                      ({pendingEditSave.payload.store})
                      {pendingEditSave.isNewDraft
                        ? ' tra i tuoi prodotti '
                        : pendingEditSave.skipProductUpdate &&
                            pendingEditSave.docTypeChanges &&
                            pendingEditSave.docTypeChanges.length > 0
                          ? ' salvando la nuova tipologia degli allegati '
                          : ' salvando i nuovi dati '}
                      su Firestore?
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setPendingEditSave(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void confirmSaveEdit()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 dark:text-slate-950 dark:bg-emerald-400 dark:hover:bg-emerald-300 disabled:opacity-50 rounded-lg transition-colors"
              >
                {savingEdit
                  ? 'Salvataggio...'
                  : writesDisabled
                    ? 'Salva in locale'
                    : 'Salva modifiche'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(feedback || linkNotice || linkError) && (
        <div
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:bottom-6 sm:right-6 sm:w-full sm:max-w-md z-50 flex flex-col gap-2 pointer-events-none"
          aria-live="polite"
        >
          {feedback && (
            <div
              role="status"
              className="pointer-events-auto bg-emerald-50/95 dark:bg-emerald-950/95 backdrop-blur-md border border-emerald-300 dark:border-emerald-500/50 text-emerald-900 dark:text-emerald-100 rounded-xl px-3.5 py-2.5 text-xs shadow-xl flex items-start justify-between gap-2.5"
            >
              <div className="flex items-start gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed break-words">{feedback}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-emerald-700 hover:text-emerald-950 dark:text-emerald-300/80 dark:hover:text-emerald-100 p-0.5 shrink-0"
                aria-label="Chiudi notifica"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {linkNotice && (
            <div
              role="status"
              className="pointer-events-auto bg-sky-50/95 dark:bg-sky-950/95 backdrop-blur-md border border-sky-300 dark:border-sky-500/50 text-sky-900 dark:text-sky-100 rounded-xl px-3.5 py-2.5 text-xs shadow-xl flex items-start justify-between gap-2.5"
            >
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed break-words">{linkNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setLinkNotice(null)}
                className="text-sky-600 hover:text-sky-900 dark:text-sky-300/80 dark:hover:text-sky-100 p-0.5 shrink-0"
                aria-label="Chiudi avviso"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {linkError && (
            <div
              role="alert"
              className="pointer-events-auto bg-rose-50/95 dark:bg-rose-950/95 backdrop-blur-md border border-rose-300 dark:border-rose-500/50 text-rose-900 dark:text-rose-100 rounded-xl px-3.5 py-2.5 text-xs shadow-xl flex items-start justify-between gap-2.5"
            >
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed break-words">{linkError}</span>
              </div>
              <button
                type="button"
                onClick={() => setLinkError(null)}
                className="text-rose-700 hover:text-rose-950 dark:text-rose-300/80 dark:hover:text-rose-100 p-0.5 shrink-0"
                aria-label="Chiudi errore"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
