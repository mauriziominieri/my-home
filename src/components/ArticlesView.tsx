import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Globe,
  Home,
  LayoutGrid,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Tv,
  Utensils,
  Cpu,
  X,
} from 'lucide-react';
import { HomeArticleCategory, HomeArticleRecord } from '../types/home';
import { FAMILY_WARRANTY_INFO } from '../data/articlesSeed';
import {
  ARTICLE_ROOM_PRESETS,
  ArticleManualGuide,
  OnlineArticleSearchResult,
  fetchOnlineManualDetails,
  formatAllArticlesMarkdown,
  formatArticlesHtmlDossier,
  formatSingleArticleMarkdown,
  getArticleManualGuide,
  packArticleNotes,
  searchArticlesOnline,
  triggerTextDownload,
  unpackArticleNotes,
} from '../utils/articleCatalog';

import { AccessUnlockBanner } from './AccessUnlockBanner';

interface ArticlesViewProps {
  articles: HomeArticleRecord[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onAddArticle: (article: Omit<HomeArticleRecord, 'id'>) => Promise<void>;
  onUpdateArticle: (id: string, article: Omit<HomeArticleRecord, 'id'>) => Promise<void>;
  onDeleteArticle: (id: string) => Promise<void>;
}

const CATEGORY_META: Record<
  HomeArticleCategory,
  { label: string; icon: typeof Package; badgeClass: string }
> = {
  elettrodomestici: {
    label: 'Elettrodomestici',
    icon: Utensils,
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  elettronica: {
    label: 'Elettronica & TV',
    icon: Tv,
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  sicurezza: {
    label: 'Sicurezza & Allarme',
    icon: ShieldCheck,
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  fotovoltaico: {
    label: 'Fotovoltaico',
    icon: Sun,
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  clima: {
    label: 'Clima & Impianti',
    icon: Thermometer,
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  altro: {
    label: 'Altro',
    icon: Cpu,
    badgeClass: 'bg-slate-700/60 text-slate-300 border-slate-600/50',
  },
};

export function ArticlesView({
  articles,
  readOnly = false,
  onSignIn,
  onAddArticle,
  onUpdateArticle,
  onDeleteArticle,
}: ArticlesViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'family' | HomeArticleCategory>('all');
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [groupByRoom, setGroupByRoom] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HomeArticleRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState<HomeArticleCategory>('elettrodomestici');
  const [room, setRoom] = useState('Cucina');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [warrantyEnd, setWarrantyEnd] = useState('');
  const [familyWarranty, setFamilyWarranty] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [specs, setSpecs] = useState('');
  const [manualUrlInput, setManualUrlInput] = useState('');
  const [notes, setNotes] = useState('');

  // Online Search states
  const [showOnlineSearch, setShowOnlineSearch] = useState(false);
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineProvider, setOnlineProvider] = useState('');
  const [onlineResults, setOnlineResults] = useState<OnlineArticleSearchResult[]>([]);
  const [onlineTargetRooms, setOnlineTargetRooms] = useState<Record<string, string>>({});
  const [addingOnlineId, setAddingOnlineId] = useState<string | null>(null);
  const [onlineAddedIds, setOnlineAddedIds] = useState<Record<string, boolean>>({});

  // Article Sheet & Manual modal states
  const [activeSheetArticle, setActiveSheetArticle] = useState<HomeArticleRecord | null>(null);
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const [manualRefreshVersion, setManualRefreshVersion] = useState(0);
  const [manualRefreshStatus, setManualRefreshStatus] = useState<string | null>(null);
  const [copiedSheet, setCopiedSheet] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  function resetForm(presetRoom = 'Cucina') {
    setEditingId(null);
    setName('');
    setBrand('');
    setModel('');
    setCategory('elettrodomestici');
    setRoom(presetRoom);
    setPurchaseDate('');
    setWarrantyEnd('');
    setFamilyWarranty(false);
    setSerialNumber('');
    setSpecs('');
    setManualUrlInput('');
    setNotes('');
  }

  function openNewForm(presetRoom?: string) {
    resetForm(presetRoom || (selectedRoom !== 'all' ? selectedRoom : 'Cucina'));
    setShowForm(true);
  }

  function openEditForm(item: HomeArticleRecord) {
    const unpacked = unpackArticleNotes(item.notes);
    setEditingId(item.id);
    setName(item.name);
    setBrand(item.brand);
    setModel(item.model);
    setCategory(item.category);
    setRoom(item.room);
    setPurchaseDate(item.purchaseDate || '');
    setWarrantyEnd(item.warrantyEnd || '');
    setFamilyWarranty(Boolean(item.familyWarranty));
    setSerialNumber(item.serialNumber || '');
    setSpecs(item.specs || '');
    setManualUrlInput(unpacked.manualUrl);
    setNotes(unpacked.userNotes);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !brand.trim() || !model.trim() || !room.trim()) return;
    setSaving(true);
    try {
      const packedNotes = packArticleNotes(notes, manualUrlInput);
      const payload: Omit<HomeArticleRecord, 'id'> = {
        name: name.trim().slice(0, 80),
        brand: brand.trim().slice(0, 60),
        model: model.trim().slice(0, 80),
        category,
        room: room.trim().slice(0, 60),
        familyWarranty,
        purchaseDate: purchaseDate.trim().slice(0, 20) || undefined,
        warrantyEnd:
          warrantyEnd.trim().slice(0, 20) ||
          (familyWarranty ? FAMILY_WARRANTY_INFO.expiryDate : undefined),
        serialNumber: serialNumber.trim().slice(0, 80) || undefined,
        specs: specs.trim().slice(0, 240) || undefined,
        notes: packedNotes,
      };
      if (editingId) {
        await onUpdateArticle(editingId, payload);
      } else {
        await onAddArticle(payload);
      }
      setShowForm(false);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDeleteArticle(pendingDelete.id);
      if (activeSheetArticle?.id === pendingDelete.id) {
        setActiveSheetArticle(null);
      }
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleOnlineSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!onlineQuery.trim()) return;
    setOnlineLoading(true);
    try {
      const { results, provider } = await searchArticlesOnline(onlineQuery);
      setOnlineResults(results);
      setOnlineProvider(provider);
      const roomMap: Record<string, string> = {};
      const preselected = selectedRoom !== 'all' ? selectedRoom : '';
      for (const r of results) {
        roomMap[r.id] = preselected || r.suggestedRoom || 'Cucina';
      }
      setOnlineTargetRooms(roomMap);
    } finally {
      setOnlineLoading(false);
    }
  }

  async function handleAddOnlineResult(item: OnlineArticleSearchResult) {
    const targetRoom = (onlineTargetRooms[item.id] || item.suggestedRoom || 'Cucina').trim();
    setAddingOnlineId(item.id);
    try {
      const packedNotes = packArticleNotes(
        item.manualSummary ? item.manualSummary.slice(0, 120) : '',
        item.manualUrl
      );
      await onAddArticle({
        name: item.name.slice(0, 80),
        brand: item.brand.slice(0, 60),
        model: item.model.slice(0, 80),
        category: item.category,
        room: targetRoom.slice(0, 60),
        familyWarranty: false,
        specs: item.specs.slice(0, 240) || undefined,
        notes: packedNotes,
      });
      setOnlineAddedIds((prev) => ({ ...prev, [item.id]: true }));
    } finally {
      setAddingOnlineId(null);
    }
  }

  async function handleRefreshOnlineManual(article: HomeArticleRecord) {
    setManualRefreshLoading(true);
    setManualRefreshStatus(null);
    try {
      const fetched = await fetchOnlineManualDetails(article);
      if (fetched) {
        setManualRefreshVersion((v) => v + 1);
        setManualRefreshStatus(
          fetched.sourceType === 'online'
            ? 'Scheda tecnica aggiornata dal web.'
            : 'Link ufficiali e scheda verificati (senza consumo crediti).'
        );
      } else {
        setManualRefreshStatus('Scheda locale verificata.');
      }
    } finally {
      setManualRefreshLoading(false);
    }
  }

  const allRooms = useMemo(() => {
    const set = new Set<string>(ARTICLE_ROOM_PRESETS);
    for (const a of articles) {
      if (a.room?.trim()) set.add(a.room.trim());
    }
    return Array.from(set);
  }, [articles]);

  const roomsWithCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of ARTICLE_ROOM_PRESETS) {
      counts.set(r, 0);
    }
    for (const a of articles) {
      const r = (a.room || 'Altro').trim();
      counts.set(r, (counts.get(r) || 0) + 1);
    }
    return Array.from(counts.entries());
  }, [articles]);

  const familyCovered = useMemo(
    () => articles.filter((a) => a.familyWarranty),
    [articles]
  );

  const daysUntilWarrantyEnd = useMemo(() => {
    const now = new Date();
    const target = new Date(`${FAMILY_WARRANTY_INFO.expiryIso}T23:59:59`);
    return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }, []);

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return articles.filter((a) => {
      if (selectedRoom !== 'all' && a.room.trim().toLowerCase() !== selectedRoom.toLowerCase()) {
        return false;
      }
      if (selectedCategory === 'family' && !a.familyWarranty) return false;
      if (
        selectedCategory !== 'all' &&
        selectedCategory !== 'family' &&
        a.category !== selectedCategory
      ) {
        return false;
      }
      if (!q) return true;
      return [a.name, a.brand, a.model, a.room, a.specs, a.notes]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [articles, selectedRoom, selectedCategory, searchQuery]);

  const groupedByRoom = useMemo(() => {
    const map = new Map<string, HomeArticleRecord[]>();
    for (const a of filteredArticles) {
      const key = a.room?.trim() || 'Altra stanza';
      const list = map.get(key) || [];
      list.push(a);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([ra], [rb]) => {
      const ia = ARTICLE_ROOM_PRESETS.indexOf(ra);
      const ib = ARTICLE_ROOM_PRESETS.indexOf(rb);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return ra.localeCompare(rb, 'it');
    });
  }, [filteredArticles]);

  const activeGuide: ArticleManualGuide | null = useMemo(() => {
    if (!activeSheetArticle) return null;
    void manualRefreshVersion;
    return getArticleManualGuide(activeSheetArticle);
  }, [activeSheetArticle, manualRefreshVersion]);

  function handleExportScope(format: 'html' | 'md' | 'json') {
    const scopeName = selectedRoom === 'all' ? 'Tutte le stanze' : selectedRoom;
    const list = filteredArticles.length > 0 ? filteredArticles : articles;
    const dateStamp = new Date().toISOString().slice(0, 10);
    const slug =
      selectedRoom === 'all'
        ? 'casa-completa'
        : selectedRoom.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    if (format === 'md') {
      triggerTextDownload(
        formatAllArticlesMarkdown(list, scopeName),
        `schede-manuali-${slug}-${dateStamp}.md`,
        'text/markdown;charset=utf-8'
      );
    } else if (format === 'html') {
      triggerTextDownload(
        formatArticlesHtmlDossier(list, `Dossier Casa & Manuali (${scopeName})`),
        `dossier-casa-${slug}-${dateStamp}.html`,
        'text/html;charset=utf-8'
      );
    } else {
      const enriched = list.map((a) => ({
        ...a,
        manual: getArticleManualGuide(a),
      }));
      triggerTextDownload(
        JSON.stringify(enriched, null, 2),
        `inventario-casa-${slug}-${dateStamp}.json`,
        'application/json;charset=utf-8'
      );
    }
    setShowExportMenu(false);
  }

  function renderArticleCard(item: HomeArticleRecord) {
    const meta = CATEGORY_META[item.category] || CATEGORY_META.altro;
    const Icon = meta.icon;
    const { userNotes, manualUrl } = unpackArticleNotes(item.notes);
    const guide = getArticleManualGuide(item);

    return (
      <article
        key={item.id}
        className="bg-slate-900/75 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3 hover:border-slate-700 transition-colors"
      >
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded-md ${meta.badgeClass}`}
            >
              <Icon className="w-3 h-3" />
              {meta.label}
            </span>

            <span className="inline-flex items-center gap-1 text-[11px] text-slate-300 bg-slate-800/70 px-2 py-0.5 rounded-md">
              <Home className="w-3 h-3 text-sky-400" />
              {item.room}
            </span>
          </div>

          <div>
            <h3 className="text-sm font-bold text-slate-100">{item.name}</h3>
            <div className="text-xs font-mono text-sky-300 mt-0.5">
              {item.brand} · {item.model}
            </div>
          </div>

          {item.specs && (
            <p className="text-xs text-slate-400 leading-relaxed">{item.specs}</p>
          )}

          {userNotes && <p className="text-[11px] text-slate-500 italic">{userNotes}</p>}
        </div>

        <div className="pt-2.5 border-t border-slate-800/80 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {item.familyWarranty && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium">
                <ShieldCheck className="w-3 h-3" />
                Garanzia Family
              </span>
            )}
            {item.warrantyEnd && (
              <span className="font-mono text-slate-400">Scad. {item.warrantyEnd}</span>
            )}
            {item.serialNumber && (
              <span className="font-mono text-slate-500">S/N {item.serialNumber}</span>
            )}
            {(manualUrl || guide.sourceType !== 'generated') && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px]">
                <BookOpen className="w-3 h-3" />
                Manuale pronto
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setCopiedSheet(false);
                setActiveSheetArticle(item);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 rounded-lg transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Scheda &amp; Manuale
            </button>

            {!readOnly && (
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  onClick={() => openEditForm(item)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-sky-300 hover:bg-slate-800 rounded transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Modifica
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(item)}
                  aria-label={`Elimina ${item.name}`}
                  className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-400" />
            Articoli di Casa, Stanze &amp; Manuali ({articles.length})
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Inventario diviso per stanze (Cucina, Salone, Stanza Maurizio, Stanza Roberta...), schede tecniche con manuali esportabili e ricerca prodotti online.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Export Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowExportMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              Esporta Schede &amp; Manuali
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1.5 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-30 text-xs">
                <button
                  type="button"
                  onClick={() => handleExportScope('html')}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                >
                  <FileText className="w-4 h-4 text-sky-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Dossier Stampabile / PDF (.html)</div>
                    <div className="text-[10px] text-slate-400">Tutte le schede + manuali divisi per stanza</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportScope('md')}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                >
                  <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Manuale Unico Markdown (.md)</div>
                    <div className="text-[10px] text-slate-400">Ideale per Note, Notion, Obsidian, Docs</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportScope('json')}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                >
                  <FileCode2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Archivio Dati (.json)</div>
                    <div className="text-[10px] text-slate-400">Backup completo strutturato</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => setShowOnlineSearch((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                  showOnlineSearch
                    ? 'bg-violet-500 text-slate-950 border-violet-400'
                    : 'bg-violet-500/15 text-violet-300 border-violet-500/35 hover:bg-violet-500/25'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                Cerca online &amp; aggiungi
              </button>

              <button
                type="button"
                onClick={() => openNewForm()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Aggiungi articolo
              </button>
            </>
          )}
        </div>
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Articoli & Manuali"
        unlockedFeatures={[
          'Cerca nuovi articoli online e aggiungili alle stanze di casa',
          'Registra nuovi elettrodomestici, garanzie e link manuali su Firestore',
          'Modifica o elimina schede articoli esistenti',
        ]}
      />

      {/* Ricerca Articoli Online */}
      {showOnlineSearch && !readOnly && (
        <section className="bg-gradient-to-br from-violet-950/45 via-slate-900 to-slate-900 border border-violet-500/40 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                Cerca Articoli &amp; Manuali Online
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Cerca marca o modello (es. &quot;Bosch lavastoviglie&quot;, &quot;Samsung lavatrice WW90&quot;, &quot;Dyson V15&quot;, &quot;Monitor LG 27&quot;), scegli la stanza di casa e aggiungilo con manuale su Firebase.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowOnlineSearch(false)}
              className="text-xs text-slate-400 hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <form onSubmit={(e) => void handleOnlineSearch(e)} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={onlineQuery}
                onChange={(e) => setOnlineQuery(e.target.value)}
                placeholder="Es. Lavatrice Bosch Serie 6, LG OLED C4, Dyson Supersonic..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              />
            </div>
            <button
              type="submit"
              disabled={onlineLoading || !onlineQuery.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-violet-400 hover:bg-violet-300 disabled:opacity-50 rounded-lg transition-colors"
            >
              {onlineLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Ricerca online...
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  Cerca prodotto
                </>
              )}
            </button>
          </form>

          {onlineResults.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  Trovati <strong className="text-slate-200">{onlineResults.length}</strong> risultati
                  {onlineProvider ? ` · ${onlineProvider}` : ''}
                </span>
                <span>Seleziona la stanza e clicca &quot;Aggiungi in casa&quot;</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {onlineResults.map((res) => {
                  const chosenRoom = onlineTargetRooms[res.id] || res.suggestedRoom || 'Cucina';
                  const isAdded = Boolean(onlineAddedIds[res.id]);
                  const isAdding = addingOnlineId === res.id;
                  return (
                    <div
                      key={res.id}
                      className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-100">{res.name}</div>
                          <div className="font-mono text-violet-300 text-[11px]">
                            {res.brand} · {res.model}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-300">
                          {CATEGORY_META[res.category]?.label || res.category}
                        </span>
                      </div>

                      {res.specs && <p className="text-slate-400 text-[11px]">{res.specs}</p>}
                      {res.manualSummary && (
                        <p className="text-slate-500 text-[11px] leading-relaxed">
                          {res.manualSummary}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <a
                          href={res.manualUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Manuale / Scheda
                        </a>
                        {res.sourceUrls.slice(0, 2).map((src) => (
                          <a
                            key={src.url}
                            href={src.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 underline"
                          >
                            {src.title.slice(0, 26)}
                          </a>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
                        <select
                          value={chosenRoom}
                          onChange={(e) =>
                            setOnlineTargetRooms((prev) => ({ ...prev, [res.id]: e.target.value }))
                          }
                          className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-xs [color-scheme:dark]"
                        >
                          {allRooms.map((r) => (
                            <option key={r} value={r}>
                              Stanza: {r}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          disabled={isAdding || isAdded}
                          onClick={() => void handleAddOnlineResult(res)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                            isAdded
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-sky-400 hover:bg-sky-300 text-slate-950'
                          }`}
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Aggiunto in {chosenRoom}
                            </>
                          ) : isAdding ? (
                            'Salvataggio...'
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              Aggiungi in casa
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Card Garanzia Family */}
      <section className="bg-gradient-to-br from-emerald-950/50 via-slate-900 to-slate-900 border border-emerald-500/35 rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 rounded-md">
                <ShieldCheck className="w-3.5 h-3.5" />
                Assicurazione Attiva
              </span>
              <span className="text-xs font-mono text-emerald-300 font-semibold">
                {FAMILY_WARRANTY_INFO.monthlyEur.toFixed(2).replace('.', ',')} €/mese
              </span>
              <span className="text-xs text-slate-400">
                ({(FAMILY_WARRANTY_INFO.monthlyEur * 12).toFixed(2).replace('.', ',')} €/anno)
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-100">
              {FAMILY_WARRANTY_INFO.planName} — Danni Accidentali (4 dispositivi)
            </h2>
            <p className="text-xs text-slate-300">
              Copertura per danni accidentali valida fino alla fine della garanzia legale:{' '}
              <span className="font-mono font-semibold text-emerald-300">
                {FAMILY_WARRANTY_INFO.expiryDate}
              </span>
              {daysUntilWarrantyEnd > 0 ? (
                <span className="text-slate-400"> ({daysUntilWarrantyEnd} giorni rimanenti)</span>
              ) : (
                <span className="text-rose-300"> (Scaduta)</span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              setSelectedCategory((prev) => (prev === 'family' ? 'all' : 'family'))
            }
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              selectedCategory === 'family'
                ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                : 'bg-slate-900/80 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15'
            }`}
          >
            {selectedCategory === 'family'
              ? 'Mostra tutti gli articoli'
              : `Filtra i ${familyCovered.length} assicurati`}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          {familyCovered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSheetArticle(item)}
              className="text-left bg-slate-950/75 hover:bg-slate-950 border border-emerald-500/25 hover:border-emerald-400/50 rounded-lg px-3 py-2 text-xs transition-colors"
            >
              <div className="font-semibold text-slate-100 truncate">{item.name}</div>
              <div className="text-[11px] font-mono text-emerald-300 truncate">
                {item.brand !== 'Da completare' ? `${item.brand} ${item.model}` : 'Modello da inserire'}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Form Aggiunta / Modifica Articolo */}
      {showForm && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-sky-500/40 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              {editingId ? 'Modifica articolo e scheda manuale' : 'Nuovo articolo / dispositivo di casa'}
            </h3>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="text-xs text-slate-400 hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div className="space-y-1">
              <label className="block text-slate-400">Nome dispositivo *</label>
              <input
                type="text"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Smart TV 75&quot; Mini-LED"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Marca *</label>
              <input
                type="text"
                required
                maxLength={60}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Es. TCL, Electrolux, Huawei..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Modello *</label>
              <input
                type="text"
                required
                maxLength={80}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Es. 75Q7C, KODGS20TX..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Categoria *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as HomeArticleCategory)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark] focus:outline-none focus:border-sky-500"
              >
                {Object.entries(CATEGORY_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Stanza di casa *</label>
              <input
                type="text"
                required
                list="room-presets-datalist"
                maxLength={60}
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Es. Cucina, Salone, Stanza Maurizio, Stanza Roberta..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
              <datalist id="room-presets-datalist">
                {allRooms.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <div className="flex flex-wrap gap-1 pt-1">
                {['Cucina', 'Salone', 'Stanza Maurizio', 'Stanza Roberta'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRoom(preset)}
                    className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                      room === preset
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Scadenza garanzia</label>
              <input
                type="text"
                maxLength={20}
                value={warrantyEnd}
                onChange={(e) => setWarrantyEnd(e.target.value)}
                placeholder="Es. 07/03/2027"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Data acquisto (opz.)</label>
              <input
                type="text"
                maxLength={20}
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                placeholder="Es. 07/03/2025"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Numero di serie (opz.)</label>
              <input
                type="text"
                maxLength={80}
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder="S/N dispositivo"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center gap-2.5 pt-5">
              <input
                id="familyWarrantyToggle"
                type="checkbox"
                checked={familyWarranty}
                onChange={(e) => {
                  setFamilyWarranty(e.target.checked);
                  if (e.target.checked && !warrantyEnd) {
                    setWarrantyEnd(FAMILY_WARRANTY_INFO.expiryDate);
                  }
                }}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-500"
              />
              <label htmlFor="familyWarrantyToggle" className="text-slate-200 cursor-pointer">
                Incluso in Garanzia Family (2,90 €/mese)
              </label>
            </div>

            <div className="sm:col-span-2 lg:col-span-3 space-y-1">
              <label className="block text-slate-400">Specifiche tecniche</label>
              <input
                type="text"
                maxLength={240}
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                placeholder="Es. 75 pollici Mini-LED / Inverter ibrido monofase 4 kW..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="sm:col-span-2 space-y-1">
              <label className="block text-slate-400">Link manuale PDF / Supporto (opz.)</label>
              <input
                type="url"
                maxLength={190}
                value={manualUrlInput}
                onChange={(e) => setManualUrlInput(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Note aggiuntive (opz.)</label>
              <input
                type="text"
                maxLength={180}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Codice installatore, posizione fattura..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="px-3.5 py-2 text-xs text-slate-400 hover:text-slate-100 rounded-lg"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors"
            >
              {saving ? 'Salvataggio...' : editingId ? 'Salva modifiche' : 'Salva articolo'}
            </button>
          </div>
        </form>
      )}

      {/* Barra Stanze */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Home className="w-4 h-4 text-sky-400" />
            Stanze di Casa
          </div>

          <button
            type="button"
            onClick={() => setGroupByRoom((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
              groupByRoom
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {groupByRoom ? 'Vista divisa per stanze: Attiva' : 'Vista griglia unica'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedRoom('all')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              selectedRoom === 'all'
                ? 'bg-sky-500 text-slate-950 border-sky-400 font-semibold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            Tutte le stanze ({articles.length})
          </button>
          {roomsWithCounts.map(([roomName, count]) => (
            <button
              key={roomName}
              type="button"
              onClick={() => setSelectedRoom(roomName)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                selectedRoom.toLowerCase() === roomName.toLowerCase()
                  ? 'bg-sky-500 text-slate-950 border-sky-400 font-semibold'
                  : count === 0
                    ? 'bg-slate-950/60 text-slate-500 border-slate-800/80 hover:text-slate-300'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              {roomName} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Filtri Categoria e Ricerca */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              selectedCategory === 'all'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Tutte le categorie
          </button>
          {(Object.keys(CATEGORY_META) as HomeArticleCategory[]).map((cat) => {
            const count = articles.filter((a) => a.category === cat).length;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  selectedCategory === cat
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {CATEGORY_META[cat].label} ({count})
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca marca, modello, stanza..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Lista Articoli (Divisi per Stanza o Griglia Unica) */}
      {filteredArticles.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400 space-y-3">
          <p>
            {selectedRoom !== 'all'
              ? `Nessun articolo ancora assegnato alla stanza "${selectedRoom}".`
              : 'Nessun articolo corrisponde ai filtri selezionati.'}
          </p>
          {!readOnly && selectedRoom !== 'all' && (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => openNewForm(selectedRoom)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                Aggiungi in {selectedRoom}
              </button>
              <button
                type="button"
                onClick={() => setShowOnlineSearch(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-300 bg-violet-500/15 border border-violet-500/35 rounded-lg"
              >
                <Globe className="w-3.5 h-3.5" />
                Cerca online per {selectedRoom}
              </button>
            </div>
          )}
        </div>
      ) : groupByRoom && selectedRoom === 'all' ? (
        <div className="space-y-6">
          {groupedByRoom.map(([roomName, list]) => (
            <section key={roomName} className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Home className="w-4 h-4 text-sky-400" />
                  <h2 className="text-sm font-bold text-slate-100">{roomName}</h2>
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-800 text-slate-300 rounded-md">
                    {list.length} {list.length === 1 ? 'articolo' : 'articoli'}
                  </span>
                </div>

                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => openNewForm(roomName)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300"
                  >
                    <Plus className="w-3 h-3" />
                    Aggiungi in {roomName}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {list.map((item) => renderArticleCard(item))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredArticles.map((item) => renderArticleCard(item))}
        </div>
      )}

      {/* Modal Scheda Tecnica & Manuale */}
      {activeSheetArticle && activeGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded">
                    Scheda Articolo &amp; Manuale
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-800 text-slate-300 rounded">
                    {activeSheetArticle.room}
                  </span>
                  {activeSheetArticle.familyWarranty && (
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
                      Garanzia Family
                    </span>
                  )}
                </div>
                <h2 className="text-base font-bold text-slate-100 mt-1.5">
                  {activeSheetArticle.name}
                </h2>
                <div className="text-xs font-mono text-sky-300">
                  {activeSheetArticle.brand} · {activeSheetArticle.model}
                  {activeSheetArticle.serialNumber
                    ? ` · S/N ${activeSheetArticle.serialNumber}`
                    : ''}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveSheetArticle(null);
                  setManualRefreshStatus(null);
                  setCopiedSheet(false);
                }}
                aria-label="Chiudi scheda manuale"
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Summary & Links */}
              <div className="bg-slate-950/75 border border-slate-800 rounded-xl p-4 space-y-3">
                <p className="text-slate-200 leading-relaxed">{activeGuide.summary}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={activeGuide.manualUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Apri Manuale Ufficiale / PDF
                  </a>
                  <a
                    href={activeGuide.supportSearchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg"
                  >
                    <Search className="w-3.5 h-3.5" />
                    Cerca manuale produttore
                  </a>
                  <button
                    type="button"
                    disabled={manualRefreshLoading}
                    onClick={() => void handleRefreshOnlineManual(activeSheetArticle)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-300 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 rounded-lg"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${manualRefreshLoading ? 'animate-spin' : ''}`}
                    />
                    {manualRefreshLoading ? 'Ricerca online...' : 'Aggiorna manuale online'}
                  </button>
                </div>
                {manualRefreshStatus && (
                  <p className="text-[11px] text-emerald-300">{manualRefreshStatus}</p>
                )}
                {activeGuide.sourceUrls && activeGuide.sourceUrls.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
                    <span>Riferimenti:</span>
                    {activeGuide.sourceUrls.map((src, idx) => (
                      <a
                        key={`${src.url}_${idx}`}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 underline"
                      >
                        {src.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Technical Specs & Warranty */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="font-semibold text-sky-300">Specifiche &amp; Dati Casa</div>
                  <ul className="space-y-1 text-slate-300 list-disc pl-4">
                    {activeGuide.keySpecs.map((spec, i) => (
                      <li key={i}>{spec}</li>
                    ))}
                  </ul>
                  {(activeSheetArticle.purchaseDate || activeSheetArticle.warrantyEnd) && (
                    <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
                      {activeSheetArticle.purchaseDate
                        ? `Acquisto: ${activeSheetArticle.purchaseDate} · `
                        : ''}
                      {activeSheetArticle.warrantyEnd
                        ? `Garanzia fino al ${activeSheetArticle.warrantyEnd}`
                        : ''}
                    </div>
                  )}
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="font-semibold text-emerald-300">Utilizzo Rapido</div>
                  <ul className="space-y-1 text-slate-300 list-disc pl-4">
                    {activeGuide.quickUsage.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="font-semibold text-amber-300">Manutenzione Periodica</div>
                  <ul className="space-y-1 text-slate-300 list-disc pl-4">
                    {activeGuide.maintenance.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="font-semibold text-violet-300">Sicurezza &amp; Risparmio Energia</div>
                  <ul className="space-y-1 text-slate-300 list-disc pl-4">
                    {activeGuide.safetyAndEnergy.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Export footer for single article */}
            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const slug = `${activeSheetArticle.brand}-${activeSheetArticle.model}`
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-');
                    triggerTextDownload(
                      formatSingleArticleMarkdown(activeSheetArticle),
                      `manuale-${slug}.md`,
                      'text/markdown;charset=utf-8'
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  Esporta Scheda (.md)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const slug = `${activeSheetArticle.brand}-${activeSheetArticle.model}`
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-');
                    triggerTextDownload(
                      formatArticlesHtmlDossier(
                        [activeSheetArticle],
                        `${activeSheetArticle.name} (${activeSheetArticle.brand} ${activeSheetArticle.model})`
                      ),
                      `scheda-${slug}.html`,
                      'text/html;charset=utf-8'
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg"
                >
                  <FileText className="w-3.5 h-3.5 text-sky-400" />
                  Esporta Stampabile / PDF (.html)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        formatSingleArticleMarkdown(activeSheetArticle)
                      );
                      setCopiedSheet(true);
                    } catch {
                      // ignore clipboard restrictions
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 hover:text-slate-100 rounded-lg"
                >
                  {copiedSheet ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copiata!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copia scheda
                    </>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveSheetArticle(null);
                  setManualRefreshStatus(null);
                  setCopiedSheet(false);
                }}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
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
                  Eliminare {pendingDelete.name}?
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Verrà rimosso dall&apos;inventario su Firebase ({pendingDelete.brand}{' '}
                  {pendingDelete.model}).
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
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
