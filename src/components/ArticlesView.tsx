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
  Package,
  Pencil,
  Plus,
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
import {
  ARTICLE_ROOM_PRESETS,
  ArticleManualGuide,
  OnlineArticleSearchResult,
  extractArticleManualDetails,
  formatAllArticlesMarkdown,
  formatArticlesHtmlDossier,
  formatSingleArticleMarkdown,
  getArticleManualGuide,
  packArticleNotes,
  searchArticlesOnline,
  triggerTextDownload,
  unpackArticleNotes,
} from '../utils/articleCatalog';
import { extractPdfTextFromBytes } from '../utils/billImporter';
import { MAX_CLOUD_FILE_BYTES } from '../utils/documentVault';

import { AccessUnlockBanner } from './AccessUnlockBanner';

interface ArticlesViewProps {
  articles: HomeArticleRecord[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onAddArticle: (article: Omit<HomeArticleRecord, 'id'>, manualFile?: File) => Promise<void>;
  onUpdateArticle: (
    id: string,
    article: Omit<HomeArticleRecord, 'id'>,
    manualFile?: File
  ) => Promise<void>;
  onDeleteArticle: (id: string) => Promise<void>;
  onDownloadManual: (fileKey: string) => Promise<void>;
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
  onDownloadManual,
}: ArticlesViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | HomeArticleCategory>('all');
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
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [manualProcessing, setManualProcessing] = useState(false);
  const [manualStatus, setManualStatus] = useState('');
  const [manualExtractText, setManualExtractText] = useState('');
  const [actionError, setActionError] = useState('');
  const [downloadingManualId, setDownloadingManualId] = useState<string | null>(null);

  // Online Search states
  const [showOnlineSearch, setShowOnlineSearch] = useState(false);
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineSearchDone, setOnlineSearchDone] = useState(false);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineResults, setOnlineResults] = useState<OnlineArticleSearchResult[]>([]);
  const [onlineProvider, setOnlineProvider] = useState('');
  const [onlineUnavailable, setOnlineUnavailable] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [onlineTargetRooms, setOnlineTargetRooms] = useState<Record<string, string>>({});
  const [addingOnlineId, setAddingOnlineId] = useState<string | null>(null);
  const [onlineAddedIds, setOnlineAddedIds] = useState<string[]>([]);

  // Article Sheet & Manual modal states
  const [activeSheetArticle, setActiveSheetArticle] = useState<HomeArticleRecord | null>(null);
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
    setManualFile(null);
    setManualProcessing(false);
    setManualStatus('');
    setManualExtractText('');
    setActionError('');
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
    setManualFile(null);
    setManualProcessing(false);
    setManualStatus(
      item.manualFileName ? `Manuale archiviato: ${item.manualFileName}` : ''
    );
    setManualExtractText(item.manualExtractText || '');
    setActionError('');
    setShowForm(true);
  }

  async function handleManualFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setActionError('Carica un manuale o una scheda tecnica in formato PDF.');
      return;
    }
    if (file.size > MAX_CLOUD_FILE_BYTES) {
      setActionError(
        `Il PDF supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB per il salvataggio su Firebase.`
      );
      return;
    }

    setActionError('');
    setManualFile(file);
    setManualProcessing(true);
    setManualStatus('Lettura del PDF e compilazione della scheda...');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfText = (await extractPdfTextFromBytes(bytes, 10)).trim();
      if (!pdfText) {
        setManualExtractText('');
        setManualStatus(
          'PDF caricato, ma non contiene testo estraibile (probabile scansione). Completa i campi della scheda manualmente.'
        );
        return;
      }

      const details = extractArticleManualDetails(pdfText, file.name);
      setName(details.name || '');
      setBrand(details.brand);
      setModel(details.model);
      setCategory(details.category);
      setRoom(details.room);
      setSpecs(details.specs);
      setManualExtractText(pdfText.slice(0, 12_000));
      setManualStatus('Dati estratti dal PDF: controllali e completa quelli mancanti prima di salvare.');
    } catch (error) {
      setManualStatus('PDF selezionato, ma non è stato possibile estrarne il testo.');
      setActionError(error instanceof Error ? error.message : 'Errore durante la lettura del PDF.');
    } finally {
      setManualProcessing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !brand.trim() || !model.trim() || !room.trim()) return;
    if (manualProcessing) return;
    setSaving(true);
    setActionError('');
    try {
      const packedNotes = packArticleNotes(notes, manualUrlInput);
      const existingArticle = editingId
        ? articles.find((article) => article.id === editingId)
        : undefined;
      const payload: Omit<HomeArticleRecord, 'id'> = {
        name: name.trim().slice(0, 80),
        brand: brand.trim().slice(0, 60),
        model: model.trim().slice(0, 80),
        category,
        room: room.trim().slice(0, 60),
        familyWarranty,
        purchaseDate: purchaseDate.trim().slice(0, 20) || undefined,
        warrantyEnd: warrantyEnd.trim().slice(0, 20) || undefined,
        serialNumber: serialNumber.trim().slice(0, 80) || undefined,
        specs: specs.trim().slice(0, 240) || undefined,
        notes: packedNotes,
        manualFileKey: existingArticle?.manualFileKey,
        manualFileName: existingArticle?.manualFileName,
        manualExtractText: manualExtractText.trim().slice(0, 12_000) || undefined,
      };
      if (editingId) {
        await onUpdateArticle(editingId, payload, manualFile || undefined);
      } else {
        await onAddArticle(payload, manualFile || undefined);
      }
      setShowForm(false);
      resetForm();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Non è stato possibile salvare la scheda.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setActionError('');
    try {
      await onDeleteArticle(pendingDelete.id);
      if (activeSheetArticle?.id === pendingDelete.id) {
        setActiveSheetArticle(null);
      }
      setPendingDelete(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Non è stato possibile eliminare l’articolo.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleOnlineSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!onlineQuery.trim()) return;
    setOnlineLoading(true);
    setOnlineSearchDone(false);
    setOnlineResults([]);
    setOnlineError('');
    setOnlineAddedIds([]);
    setOnlineProvider('');
    setOnlineUnavailable(false);
    try {
      const response = await searchArticlesOnline(onlineQuery);
      setOnlineResults(response.results);
      setOnlineProvider(response.provider);
      setOnlineUnavailable(Boolean(response.unavailable));
      setOnlineTargetRooms(
        Object.fromEntries(response.results.map((result) => [result.id, result.suggestedRoom]))
      );
    } catch (error) {
      setOnlineUnavailable(true);
      setOnlineError(
        error instanceof Error ? error.message : 'La ricerca online non è riuscita.'
      );
    } finally {
      setOnlineLoading(false);
      setOnlineSearchDone(true);
    }
  }

  async function handleAddOnlineResult(result: OnlineArticleSearchResult) {
    const targetRoom = onlineTargetRooms[result.id] || result.suggestedRoom;
    setAddingOnlineId(result.id);
    setOnlineError('');
    try {
      await onAddArticle({
        name: result.name,
        brand: result.brand,
        model: result.model,
        category: result.category,
        room: targetRoom,
        familyWarranty: false,
        specs: result.specs || undefined,
        notes: packArticleNotes('', result.manualUrl),
      });
      setOnlineAddedIds((current) => [...current, result.id]);
    } catch (error) {
      setOnlineError(
        error instanceof Error ? error.message : 'Non è stato possibile aggiungere l’articolo.'
      );
    } finally {
      setAddingOnlineId(null);
    }
  }

  function openSearchResultAsNewArticle() {
    const initialName = onlineQuery.trim().slice(0, 80);
    openNewForm();
    setName(initialName);
  }

  async function handleDownloadManual(article: HomeArticleRecord) {
    if (!article.manualFileKey) return;
    setDownloadingManualId(article.id);
    setActionError('');
    try {
      await onDownloadManual(article.manualFileKey);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Non è stato possibile scaricare il manuale.');
    } finally {
      setDownloadingManualId(null);
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

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return articles.filter((a) => {
      if (selectedRoom !== 'all' && a.room.trim().toLowerCase() !== selectedRoom.toLowerCase()) {
        return false;
      }
      if (selectedCategory !== 'all' && a.category !== selectedCategory) {
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
    return getArticleManualGuide(activeSheetArticle);
  }, [activeSheetArticle]);

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
            {(item.manualFileKey || manualUrl || guide.sourceType !== 'generated') && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px]">
                <BookOpen className="w-3 h-3" />
                {item.manualFileKey ? 'PDF archiviato' : 'Manuale online'}
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
                {item.manualFileKey && (
                  <button
                    type="button"
                    disabled={downloadingManualId === item.id}
                    onClick={() => void handleDownloadManual(item)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-300 hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                  >
                    <Download className="w-3 h-3" />
                    {downloadingManualId === item.id ? 'Download...' : 'Scarica PDF'}
                  </button>
                )}
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
      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError('')}
            aria-label="Chiudi messaggio di errore"
            className="text-rose-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
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
                La ricerca AI parte solo quando la invii e usa la cache per le query recenti. L’estrazione dai PDF resta locale; se la ricerca integrata non è disponibile puoi aprire Google Shopping.
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

          <form onSubmit={handleOnlineSearch} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={onlineQuery}
                maxLength={140}
                onChange={(e) => {
                  setOnlineQuery(e.target.value);
                  setOnlineSearchDone(false);
                  setOnlineResults([]);
                  setOnlineError('');
                }}
                placeholder="Es. chitarra Ibanez, frigo Bosch, LG OLED C4..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              />
            </div>
            <button
              type="submit"
              disabled={!onlineQuery.trim() || onlineLoading}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-violet-400 hover:bg-violet-300 disabled:opacity-50 rounded-lg transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              {onlineLoading ? 'Ricerca in corso...' : 'Cerca modelli'}
            </button>
          </form>

          {onlineSearchDone && onlineProvider && (
            <p className="text-[11px] text-slate-400">{onlineProvider}</p>
          )}
          {onlineError && (
            <p role="alert" className="text-xs text-rose-300">{onlineError}</p>
          )}
          {onlineResults.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {onlineResults.map((result) => {
                const added = onlineAddedIds.includes(result.id);
                return (
                  <article
                    key={result.id}
                    className="rounded-lg border border-slate-700 bg-slate-950/70 p-3 space-y-2"
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-slate-100">{result.name}</h3>
                      <p className="text-xs text-slate-400">{result.brand} · {result.model}</p>
                    </div>
                    {result.specs && <p className="text-xs text-slate-300">{result.specs}</p>}
                    {result.sourceUrls.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[11px] text-sky-300 hover:text-sky-200 underline"
                      >
                        Fonte: {source.title}
                      </a>
                    ))}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={onlineTargetRooms[result.id] || result.suggestedRoom}
                        onChange={(event) =>
                          setOnlineTargetRooms((current) => ({
                            ...current,
                            [result.id]: event.target.value,
                          }))
                        }
                        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-100"
                        aria-label={`Stanza per ${result.name}`}
                      >
                        {allRooms.map((roomOption) => (
                          <option key={roomOption} value={roomOption}>{roomOption}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={added || addingOnlineId === result.id}
                        onClick={() => void handleAddOnlineResult(result)}
                        className="rounded-lg bg-sky-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-60"
                      >
                        {added ? 'Aggiunto' : addingOnlineId === result.id ? 'Salvataggio...' : 'Aggiungi alla casa'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {onlineSearchDone && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-3 text-xs">
              <p className="text-slate-300">
                {onlineUnavailable
                  ? 'La ricerca integrata non è configurata in questa versione del sito.'
                  : onlineResults.length
                    ? 'Scegli un modello e la stanza per aggiungerlo alla casa.'
                    : 'Nessun modello verificabile trovato. Puoi provare su Google Shopping e creare la scheda manualmente.'}
              </p>
              <div className="flex shrink-0 flex-wrap gap-2">
                <a
                  href={`https://www.google.com/search?tbm=shop&q=${encodeURIComponent(onlineQuery.trim())}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 font-semibold text-slate-950 hover:bg-amber-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Apri Google Shopping
                </a>
                {(onlineUnavailable || onlineResults.length === 0) && (
                  <button
                    type="button"
                    onClick={openSearchResultAsNewArticle}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Crea scheda
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

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
                onChange={(e) => setFamilyWarranty(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-500"
              />
              <label htmlFor="familyWarrantyToggle" className="text-slate-200 cursor-pointer">
                Coperto da garanzia aggiuntiva
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

            <div className="sm:col-span-2 lg:col-span-3 space-y-1">
              <label className="block text-slate-400">Carica manuale o scheda tecnica PDF</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => void handleManualFileChange(event)}
                disabled={manualProcessing || saving}
                className="block w-full text-xs text-slate-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-sky-500/15 file:text-sky-300 hover:file:bg-sky-500/25"
              />
              <p className="text-[10px] text-slate-500">
                Il PDF viene archiviato nel vault Firebase (max {Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB). Se contiene testo selezionabile, la scheda viene compilata automaticamente e puoi correggerla prima di salvarla.
              </p>
              {manualFile && (
                <p className="text-[11px] text-sky-300">Nuovo file: {manualFile.name}</p>
              )}
              {manualStatus && (
                <p className="text-[11px] text-slate-400" role="status">{manualStatus}</p>
              )}
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
              disabled={saving || manualProcessing}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors"
            >
              {manualProcessing
                ? 'Lettura PDF...'
                : saving
                  ? 'Salvataggio...'
                  : editingId
                    ? 'Salva modifiche'
                    : 'Crea scheda articolo'}
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
                  {activeSheetArticle.manualFileKey && (
                    <button
                      type="button"
                      disabled={downloadingManualId === activeSheetArticle.id}
                      onClick={() => void handleDownloadManual(activeSheetArticle)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-lg"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {downloadingManualId === activeSheetArticle.id
                        ? 'Download...'
                        : `Scarica ${activeSheetArticle.manualFileName || 'manuale PDF'}`}
                    </button>
                  )}
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
                </div>
                {actionError && (
                  <p role="alert" className="text-[11px] text-rose-300">
                    {actionError}
                  </p>
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

              {activeSheetArticle.manualExtractText && (
                <details className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                  <summary className="cursor-pointer font-semibold text-slate-200">
                    Testo estratto dal manuale caricato
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-400">
                    {activeSheetArticle.manualExtractText}
                  </pre>
                </details>
              )}

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
                  {pendingDelete.model}) e il manuale archiviato, se presente.
                </p>
              </div>
            </div>
            {actionError && (
              <p role="alert" className="text-xs text-rose-300">
                {actionError}
              </p>
            )}
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
