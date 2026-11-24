import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileCheck2,
  FileCode2,
  FileText,
  Globe,
  Home,
  LayoutGrid,
  Package,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Tv,
  Upload,
  Utensils,
  X,
} from 'lucide-react';
import {
  ArticleAttachmentType,
  HomeArticleCategory,
  HomeArticleRecord,
  HomeDocumentRecord,
} from '../types/home';
import {
  ARTICLE_ROOM_PRESETS,
  ArticleManualGuide,
  CATALOG_DEPARTMENTS,
  EXTRA_FAMILY_COVERAGE_INFO,
  OnlineArticleSearchResult,
  USER_ELECTROLUX_AEG_PRESETS,
  extractArticleManualDetails,
  formatAllArticlesMarkdown,
  formatArticlesHtmlDossier,
  formatSingleArticleMarkdown,
  getArticleManualGuide,
  getFullArticleCatalog,
  packArticleNotes,
  saveCachedManualGuide,
  triggerTextDownload,
  unpackArticleNotes,
} from '../utils/articleCatalog';
import { extractPdfTextFromBytes } from '../utils/billImporter';
import {
  getDocumentsForArticle,
  parseArticleDocumentRef,
} from '../utils/carGroceryStore';
import {
  buildDocumentSharePayload,
  downloadShareableItem,
  formatFileSize,
  MAX_CLOUD_FILE_BYTES,
  ShareableItemPayload,
} from '../utils/documentVault';
import { searchFreeArticles } from '../utils/freeArticleSearch';
import { AccessUnlockBanner } from './AccessUnlockBanner';
import { ShareSheetModal } from './ShareSheetModal';

interface ArticlesViewProps {
  articles: HomeArticleRecord[];
  articleDocuments: HomeDocumentRecord[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onAddArticle: (
    article: Omit<HomeArticleRecord, 'id'>,
    manualFile?: File
  ) => Promise<string | void>;
  onUpdateArticle: (
    id: string,
    article: Omit<HomeArticleRecord, 'id'>,
    manualFile?: File
  ) => Promise<void>;
  onDeleteArticle: (id: string) => Promise<void>;
  onDownloadManual: (fileKey: string) => Promise<void>;
  onUploadArticleDocument: (
    articleId: string,
    docType: ArticleAttachmentType,
    title: string,
    provider: string,
    file: File
  ) => Promise<void>;
  onDeleteArticleDocument: (docId: string) => Promise<void>;
}

interface QueuedAttachment {
  id: string;
  file: File;
  docType: ArticleAttachmentType;
  label: string;
}

const ATTACHMENT_TYPE_META: Record<
  ArticleAttachmentType,
  { label: string; badgeClass: string }
> = {
  manuale: {
    label: "Manuale d'uso",
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  scontrino_fattura: {
    label: 'Scontrino / Fattura',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  garanzia_extra_family: {
    label: 'Garanzia Extra Family',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  targhetta_pnc: {
    label: 'Foto Targhetta / PNC',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  altro: {
    label: 'Altro documento',
    badgeClass: 'bg-slate-700/60 text-slate-300 border-slate-600/50',
  },
};

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
  articleDocuments,
  readOnly = false,
  onSignIn,
  onAddArticle,
  onUpdateArticle,
  onDeleteArticle,
  onDownloadManual,
  onUploadArticleDocument,
  onDeleteArticleDocument,
}: ArticlesViewProps) {
  const [viewTab, setViewTab] = useState<'casa' | 'catalogo'>('casa');

  // House inventory filters
  const [selectedCategory, setSelectedCategory] = useState<'all' | HomeArticleCategory>('all');
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [onlyExtraFamily, setOnlyExtraFamily] = useState(false);
  const [groupByRoom, setGroupByRoom] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HomeArticleRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

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
  const [queuedAttachments, setQueuedAttachments] = useState<QueuedAttachment[]>([]);
  const [queuedDocType, setQueuedDocType] = useState<ArticleAttachmentType>('scontrino_fattura');

  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [downloadingManualId, setDownloadingManualId] = useState<string | null>(null);
  const [togglingFamilyId, setTogglingFamilyId] = useState<string | null>(null);

  // Amazon-style Catalog Browser states
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogDepartment, setCatalogDepartment] = useState('Tutti i reparti');
  const [catalogBrand, setCatalogBrand] = useState('Tutte');
  const [catalogTargetRoom, setCatalogTargetRoom] = useState('auto');
  const [catalogIncludeExtraFamily, setCatalogIncludeExtraFamily] = useState(true);
  const [webResults, setWebResults] = useState<OnlineArticleSearchResult[]>([]);
  const [webProvider, setWebProvider] = useState('');
  const [webSearching, setWebSearching] = useState(false);
  const [webSearchError, setWebSearchError] = useState('');
  const [quickAddingId, setQuickAddingId] = useState<string | null>(null);
  const [addingAllElectrolux, setAddingAllElectrolux] = useState(false);
  const [failedOnlineImages, setFailedOnlineImages] = useState<Set<string>>(new Set());

  // Article Sheet & Documents modal states
  const [activeSheetArticle, setActiveSheetArticle] = useState<HomeArticleRecord | null>(null);
  const [modalDocType, setModalDocType] = useState<ArticleAttachmentType>('scontrino_fattura');
  const [modalDocTitle, setModalDocTitle] = useState('');
  const [uploadingModalDoc, setUploadingModalDoc] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [shareItem, setShareItem] = useState<ShareableItemPayload | null>(null);
  const modalDocInputRef = useRef<HTMLInputElement | null>(null);

  const [copiedSheet, setCopiedSheet] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [fetchingManualOnline, setFetchingManualOnline] = useState(false);
  const [manualRefreshNonce, setManualRefreshNonce] = useState(0);

  const fullCatalog = useMemo(() => getFullArticleCatalog(), []);

  const catalogBrands = useMemo(() => {
    const set = new Set<string>();
    for (const item of fullCatalog) {
      if (item.brand) set.add(item.brand);
    }
    return ['Tutte', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'it'))];
  }, [fullCatalog]);

  const filteredCatalogItems = useMemo(() => {
    const q = catalogQuery
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const compactQ = q.replace(/\s+/g, '');
    const merged = [...fullCatalog];
    for (const w of webResults) {
      const exists = merged.some(
        (m) =>
          m.brand.toLowerCase() === w.brand.toLowerCase() &&
          m.model.toLowerCase() === w.model.toLowerCase()
      );
      if (!exists) merged.push(w);
    }

    return merged.filter((item) => {
      if (
        catalogDepartment !== 'Tutti i reparti' &&
        (item.department || 'Altro') !== catalogDepartment
      ) {
        return false;
      }
      if (catalogBrand !== 'Tutte' && item.brand.toLowerCase() !== catalogBrand.toLowerCase()) {
        return false;
      }
      if (!q) return true;
      const hay = `${item.name} ${item.brand} ${item.model} ${item.pnc || ''} ${item.department || ''} ${item.specs} ${item.description}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const compactHay = hay.replace(/\s+/g, '');
      if (hay.includes(q) || compactHay.includes(compactQ)) return true;
      const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
      return tokens.length > 0 && tokens.every((t) => hay.includes(t) || compactHay.includes(t));
    });
  }, [fullCatalog, webResults, catalogDepartment, catalogBrand, catalogQuery]);

  function isAlreadyInHouse(candidate: { brand: string; model: string; pnc?: string }): boolean {
    const normModel = candidate.model.trim().toLowerCase();
    const normPnc = (candidate.pnc || '').replace(/\s+/g, '');
    return articles.some((a) => {
      if (a.model.trim().toLowerCase() === normModel) return true;
      if (normPnc && (a.serialNumber || '').replace(/\s+/g, '').includes(normPnc)) return true;
      return false;
    });
  }

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
    setQueuedAttachments([]);
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
      item.manualFileName ? `Manuale PDF principale: ${item.manualFileName}` : ''
    );
    setManualExtractText(item.manualExtractText || '');
    setQueuedAttachments([]);
    setActionError('');
    setShowForm(true);
  }

  async function handleManualFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_CLOUD_FILE_BYTES) {
      setActionError(
        `Il file "${file.name}" supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB su Firebase.`
      );
      return;
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      // Non-PDF goes directly into queuedAttachments so users can attach images/scans cleanly
      setQueuedAttachments((prev) => [
        ...prev,
        {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          file,
          docType: queuedDocType,
          label: file.name.replace(/\.[^.]+$/, ''),
        },
      ]);
      setManualStatus(`Allegato "${file.name}" aggiunto alla coda documenti dell'articolo.`);
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
          'PDF caricato, ma non contiene testo estraibile (probabile scansione). Completa i campi manualmente.'
        );
        return;
      }

      const details = extractArticleManualDetails(pdfText, file.name);
      if (!name.trim()) setName(details.name || '');
      if (!brand.trim()) setBrand(details.brand);
      if (!model.trim()) setModel(details.model);
      if (!editingId) {
        setCategory(details.category);
        setRoom(details.room);
      }
      if (!specs.trim()) setSpecs(details.specs);
      setManualExtractText(pdfText.slice(0, 12_000));
      setManualStatus('Dati letti dal PDF: controlla e salva.');
    } catch (error) {
      setManualStatus('PDF selezionato, ma non è stato possibile estrarne il testo.');
      setActionError(error instanceof Error ? error.message : 'Errore durante la lettura del PDF.');
    } finally {
      setManualProcessing(false);
    }
  }

  function handleQueueExtraFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    setActionError('');

    const valid: QueuedAttachment[] = [];
    for (const f of files) {
      if (f.size > MAX_CLOUD_FILE_BYTES) {
        setActionError(
          `"${f.name}" supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB su Firebase.`
        );
        continue;
      }
      valid.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        docType: queuedDocType,
        label: f.name.replace(/\.[^.]+$/, '').slice(0, 60),
      });
    }
    if (valid.length > 0) {
      setQueuedAttachments((prev) => [...prev, ...valid]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !brand.trim() || !model.trim() || !room.trim()) return;
    if (manualProcessing) return;
    setSaving(true);
    setActionError('');
    setActionNotice('');
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

      let savedArticleId = editingId || '';
      if (editingId) {
        await onUpdateArticle(editingId, payload, manualFile || undefined);
      } else {
        const createdId = await onAddArticle(payload, manualFile || undefined);
        if (typeof createdId === 'string') savedArticleId = createdId;
      }

      if (savedArticleId && queuedAttachments.length > 0) {
        for (const att of queuedAttachments) {
          await onUploadArticleDocument(
            savedArticleId,
            att.docType,
            `${payload.name} · ${att.label}`.slice(0, 80),
            payload.brand,
            att.file
          );
        }
      }

      setActionNotice(
        `"${payload.name}" salvato su Firestore${
          queuedAttachments.length > 0
            ? ` con ${queuedAttachments.length} ${
                queuedAttachments.length === 1 ? 'documento allegato' : 'documenti allegati'
              }`
            : ''
        }.`
      );
      setShowForm(false);
      resetForm();
      setViewTab('casa');
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Non è stato possibile salvare la scheda.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setActionError('');
    try {
      const linkedDocs = getDocumentsForArticle(articleDocuments, pendingDelete.id);
      for (const docItem of linkedDocs) {
        await onDeleteArticleDocument(docItem.id);
      }
      await onDeleteArticle(pendingDelete.id);
      if (activeSheetArticle?.id === pendingDelete.id) {
        setActiveSheetArticle(null);
      }
      setPendingDelete(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Non è stato possibile eliminare l’articolo.'
      );
    } finally {
      setDeleting(false);
    }
  }

  async function runWebCatalogSearch(rawQuery: string) {
    const q = rawQuery.trim();
    if (q.length < 2) {
      setWebSearchError('Inserisci almeno 2 caratteri per cercare sul web.');
      return;
    }

    setWebSearching(true);
    setWebSearchError('');
    setFailedOnlineImages(new Set());
    try {
      const response = await searchFreeArticles(q);
      setWebResults(response.results);
      setWebProvider(response.provider);
    } catch (error) {
      setWebSearchError(
        error instanceof Error ? error.message : 'La ricerca web non è disponibile al momento.'
      );
    } finally {
      setWebSearching(false);
    }
  }

  function buildPayloadFromSearchResult(
    result: OnlineArticleSearchResult,
    includeExtraFamily: boolean,
    overrideRoom?: string
  ): Omit<HomeArticleRecord, 'id'> {
    const sourceUrl = result.sourceUrls[0]?.url;
    const descParts = [
      result.description ? result.description.slice(0, 125) : '',
      sourceUrl ? `Fonte: ${sourceUrl}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const chosenRoom =
      overrideRoom && overrideRoom !== 'auto'
        ? overrideRoom
        : selectedRoom !== 'all'
          ? selectedRoom
          : result.suggestedRoom || 'Cucina';
    return {
      name: result.name.slice(0, 80),
      brand: result.brand.slice(0, 60),
      model: result.model.slice(0, 80),
      category: result.category,
      room: chosenRoom.slice(0, 60),
      familyWarranty: includeExtraFamily,
      serialNumber: result.pnc ? `PNC ${result.pnc}`.slice(0, 80) : undefined,
      specs: result.specs.slice(0, 240) || undefined,
      notes: packArticleNotes(descParts, result.manualUrl),
    };
  }

  async function quickSaveSearchResultToFirestore(
    result: OnlineArticleSearchResult,
    includeExtraFamily: boolean,
    overrideRoom?: string
  ) {
    if (readOnly) return;
    setQuickAddingId(result.id);
    setActionError('');
    setActionNotice('');
    try {
      const payload = buildPayloadFromSearchResult(result, includeExtraFamily, overrideRoom);
      await onAddArticle(payload);
      setActionNotice(
        `"${payload.name}" (${payload.brand} ${payload.model}) aggiunto su Firestore in ${payload.room}${
          payload.familyWarranty ? ' · Assicurazione Extra Family attiva' : ''
        }.`
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Errore durante il salvataggio su Firestore.'
      );
    } finally {
      setQuickAddingId(null);
    }
  }

  async function handleAddAllMissingElectrolux() {
    if (readOnly) return;
    const missing = USER_ELECTROLUX_AEG_PRESETS.filter((item) => !isAlreadyInHouse(item));
    if (missing.length === 0) return;
    setAddingAllElectrolux(true);
    setActionError('');
    try {
      for (const item of missing) {
        const payload = buildPayloadFromSearchResult(item, true, item.suggestedRoom);
        await onAddArticle(payload);
      }
      setActionNotice(
        `Aggiunti ${missing.length} elettrodomestici Electrolux / AEG su Firestore con i relativi codici modello e Prodotto No. (PNC).`
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Errore durante il salvataggio multiplo.'
      );
    } finally {
      setAddingAllElectrolux(false);
    }
  }

  function openSearchResultForCustomization(result: OnlineArticleSearchResult) {
    const targetRoom =
      catalogTargetRoom !== 'auto'
        ? catalogTargetRoom
        : selectedRoom !== 'all'
          ? selectedRoom
          : result.suggestedRoom || 'Cucina';
    resetForm(targetRoom);
    setName(result.name);
    setBrand(result.brand);
    setModel(result.model);
    setCategory(result.category);
    setRoom(targetRoom);
    setFamilyWarranty(
      catalogIncludeExtraFamily ? Boolean(result.familyWarrantySuggested ?? true) : false
    );
    setSerialNumber(result.pnc ? `PNC ${result.pnc}` : '');
    setSpecs(result.specs);
    setManualUrlInput(result.manualUrl);
    const sourceNote = result.sourceUrls[0]?.url ? `Fonte: ${result.sourceUrls[0].url}` : '';
    setNotes(
      `${result.description.slice(0, Math.max(0, 239 - sourceNote.length))} ${sourceNote}`
        .trim()
        .slice(0, 240)
    );
    setShowForm(true);
  }

  function openCustomDraftFromQuery(rawQuery: string) {
    const cleaned = rawQuery.trim();
    if (!cleaned) return;
    const words = cleaned.split(/\s+/);
    const inferredBrand = words[0] || '';
    const inferredModel = words.slice(1).join(' ') || cleaned;
    resetForm(selectedRoom !== 'all' ? selectedRoom : 'Cucina');
    setName(cleaned.slice(0, 80));
    setBrand(inferredBrand.slice(0, 60));
    setModel(inferredModel.slice(0, 80));
    setFamilyWarranty(true);
    setShowForm(true);
  }

  async function handleToggleExtraFamily(item: HomeArticleRecord) {
    if (readOnly) return;
    setTogglingFamilyId(item.id);
    setActionError('');
    try {
      const { id: _id, ...rest } = item;
      await onUpdateArticle(item.id, {
        ...rest,
        familyWarranty: !item.familyWarranty,
      });
      setActionNotice(
        !item.familyWarranty
          ? `"${item.name}" aggiunto ai dispositivi coperti da Assicurazione Extra Family.`
          : `"${item.name}" rimosso dalla copertura Assicurazione Extra Family.`
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Impossibile aggiornare stato Assicurazione Extra Family.'
      );
    } finally {
      setTogglingFamilyId(null);
    }
  }

  async function handleUploadModalDoc(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !activeSheetArticle || readOnly) return;
    if (file.size > MAX_CLOUD_FILE_BYTES) {
      setActionError(
        `Il file "${file.name}" supera il limite di ${Math.floor(MAX_CLOUD_FILE_BYTES / 1_000_000)} MB.`
      );
      return;
    }

    setUploadingModalDoc(true);
    setActionError('');
    try {
      const label =
        modalDocTitle.trim() ||
        `${ATTACHMENT_TYPE_META[modalDocType].label} · ${file.name.replace(/\.[^.]+$/, '')}`;
      await onUploadArticleDocument(
        activeSheetArticle.id,
        modalDocType,
        `${activeSheetArticle.name} (${label})`.slice(0, 80),
        activeSheetArticle.brand,
        file
      );
      setModalDocTitle('');
      setActionNotice(`Documento "${file.name}" allegato a "${activeSheetArticle.name}" su Firebase.`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Errore durante caricamento documento.'
      );
    } finally {
      setUploadingModalDoc(false);
    }
  }

  async function handleDownloadArticleDoc(docItem: HomeDocumentRecord) {
    setDownloadingDocId(docItem.id);
    try {
      await downloadShareableItem(buildDocumentSharePayload(docItem));
    } finally {
      setDownloadingDocId(null);
    }
  }

  async function handleDeleteArticleDoc(docItem: HomeDocumentRecord) {
    setDeletingDocId(docItem.id);
    try {
      await onDeleteArticleDocument(docItem.id);
    } finally {
      setDeletingDocId(null);
    }
  }

  async function handleFetchOnlineManualForActive() {
    if (!activeSheetArticle) return;
    setFetchingManualOnline(true);
    setActionError('');
    try {
      const res = await fetch('/api/articles/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: activeSheetArticle.name,
          brand: activeSheetArticle.brand,
          model: activeSheetArticle.model,
          category: activeSheetArticle.category,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error('Servizio scheda manuale online non disponibile.');
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error('Servizio scheda manuale online disponibile solo con server locale attivo.');
      }
      const guide = (await res.json()) as Partial<ArticleManualGuide>;
      saveCachedManualGuide(activeSheetArticle.brand, activeSheetArticle.model, guide);
      setManualRefreshNonce((n) => n + 1);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Impossibile recuperare la scheda online.'
      );
    } finally {
      setFetchingManualOnline(false);
    }
  }

  async function handleDownloadManual(article: HomeArticleRecord) {
    if (!article.manualFileKey) return;
    setDownloadingManualId(article.id);
    setActionError('');
    try {
      await onDownloadManual(article.manualFileKey);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Non è stato possibile scaricare il manuale.'
      );
    } finally {
      setDownloadingManualId(null);
    }
  }

  const extraFamilyCount = useMemo(
    () => articles.filter((a) => a.familyWarranty).length,
    [articles]
  );

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
      if (onlyExtraFamily && !a.familyWarranty) return false;
      if (selectedRoom !== 'all' && a.room.trim().toLowerCase() !== selectedRoom.toLowerCase()) {
        return false;
      }
      if (selectedCategory !== 'all' && a.category !== selectedCategory) return false;
      if (!q) return true;
      return [a.name, a.brand, a.model, a.room, a.specs, a.notes, a.serialNumber]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [articles, onlyExtraFamily, selectedRoom, selectedCategory, searchQuery]);

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
    void manualRefreshNonce;
    return getArticleManualGuide(activeSheetArticle);
  }, [activeSheetArticle, manualRefreshNonce]);

  const activeSheetDocs = useMemo(() => {
    if (!activeSheetArticle) return [];
    return getDocumentsForArticle(articleDocuments, activeSheetArticle.id);
  }, [activeSheetArticle, articleDocuments]);

  const missingElectroluxCount = useMemo(
    () => USER_ELECTROLUX_AEG_PRESETS.filter((item) => !isAlreadyInHouse(item)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [articles]
  );

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
    const attachedDocs = getDocumentsForArticle(articleDocuments, item.id);
    const totalDocsCount = attachedDocs.length + (item.manualFileKey ? 1 : 0);

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
            {item.familyWarranty ? (
              <button
                type="button"
                disabled={readOnly || togglingFamilyId === item.id}
                onClick={() => void handleToggleExtraFamily(item)}
                title={
                  readOnly
                    ? 'Coperto da Assicurazione Extra Family'
                    : 'Clicca per modificare copertura Assicurazione Extra Family'
                }
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-medium hover:bg-emerald-500/25 disabled:hover:bg-emerald-500/15"
              >
                <ShieldCheck className="w-3 h-3" />
                Extra Family
              </button>
            ) : (
              !readOnly && (
                <button
                  type="button"
                  disabled={togglingFamilyId === item.id}
                  onClick={() => void handleToggleExtraFamily(item)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/35 text-[10px] transition-colors"
                >
                  <ShieldCheck className="w-3 h-3" />
                  {togglingFamilyId === item.id ? 'Salvataggio...' : '+ Extra Family'}
                </button>
              )
            )}
            {item.warrantyEnd && (
              <span className="font-mono text-slate-400">Scad. {item.warrantyEnd}</span>
            )}
            {item.serialNumber && (
              <span className="font-mono text-slate-400">{item.serialNumber}</span>
            )}
            {totalDocsCount > 0 ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/25 text-[10px] font-medium">
                <Paperclip className="w-3 h-3" />
                {totalDocsCount} {totalDocsCount === 1 ? 'documento' : 'documenti'}
              </span>
            ) : (
              (manualUrl || guide.sourceType !== 'generated') && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px]">
                  <BookOpen className="w-3 h-3" />
                  Manuale online
                </span>
              )
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
              <FileCheck2 className="w-3.5 h-3.5" />
              Scheda &amp; Documenti ({totalDocsCount})
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
                    PDF
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
      <input
        ref={modalDocInputRef}
        type="file"
        accept="application/pdf,.pdf,image/*,.doc,.docx"
        onChange={(e) => void handleUploadModalDoc(e)}
        className="hidden"
      />

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
      {actionNotice && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
        >
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice('')}
            aria-label="Chiudi avviso"
            className="text-emerald-300 hover:text-white"
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
            Articoli di Casa, Catalogo Prodotti &amp; Documenti ({articles.length})
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Sfoglia il catalogo stile store, aggiungi i tuoi elettrodomestici (inclusi codici Modello e PNC) e allega manuali, scontrini, certificati Extra Family o foto targhetta su Firestore.
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
              Esporta Schede
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
                    <div className="text-[10px] text-slate-400">Schede + manuali divisi per stanza</div>
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
                    <div className="text-[10px] text-slate-400">Ideale per Note, Notion, Obsidian</div>
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
            <button
              type="button"
              onClick={() => openNewForm()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nuovo articolo personalizzato
            </button>
          )}
        </div>
      </div>

      {/* Switcher principale: I miei Articoli in Casa vs Catalogo stile Store */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-xl p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewTab('casa')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
              viewTab === 'casa'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Home className="w-4 h-4" />
            I miei Articoli in Casa ({articles.length})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('catalogo')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
              viewTab === 'catalogo'
                ? 'bg-violet-400 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            Catalogo Prodotti &amp; Ricerca Store ({fullCatalog.length}+)
          </button>
        </div>

        <div className="text-[11px] text-slate-400 px-2">
          Assicurazione Extra Family:{' '}
          <strong className="text-emerald-300 font-mono">
            {extraFamilyCount}/{articles.length}
          </strong>{' '}
          attivi ·{' '}
          <strong className="text-sky-300 font-mono">{articleDocuments.length}</strong> allegati salvati
        </div>
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Articoli & Catalogo Casa"
        unlockedFeatures={[
          'Aggiungi con 1 click i tuoi elettrodomestici Electrolux / AEG o altri prodotti dal catalogo store',
          'Crea articoli personalizzati con codice modello, PNC e più documenti allegati (manuali, fatture, certificati)',
          'Attiva e monitora la copertura Assicurazione Extra Family su ogni dispositivo di casa',
        ]}
      />

      {/* Scheda Informativa Assicurazione Extra Family */}
      <section className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-emerald-200">
              {EXTRA_FAMILY_COVERAGE_INFO.title}
            </h2>
            <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
              {extraFamilyCount} / {articles.length} articoli assicurati
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
            {EXTRA_FAMILY_COVERAGE_INFO.description}
          </p>
        </div>

        {viewTab === 'casa' && (
          <button
            type="button"
            onClick={() => setOnlyExtraFamily((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border shrink-0 transition-colors ${
              onlyExtraFamily
                ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                : 'bg-slate-900/90 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/15'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {onlyExtraFamily
              ? `Mostra tutti (${articles.length})`
              : `Solo Extra Family (${extraFamilyCount})`}
          </button>
        )}
      </section>

      {/* Banner dedicato ai 4 Elettrodomestici Electrolux / AEG recuperati dall'utente */}
      {!readOnly && (
        <section className="bg-slate-900/75 border border-sky-500/30 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
                <Sparkles className="w-4 h-4" />
                I tuoi 4 Elettrodomestici Electrolux / AEG (con Modello No. &amp; Prodotto No. PNC)
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Aggiungili subito a Firestore in 1 click oppure personalizzali per allegare scontrino, foto targhetta e manuale.
              </p>
            </div>
            {missingElectroluxCount > 0 && (
              <button
                type="button"
                disabled={addingAllElectrolux}
                onClick={() => void handleAddAllMissingElectrolux()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-60 rounded-lg shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {addingAllElectrolux
                  ? 'Salvataggio...'
                  : `Aggiungi tutti i ${missingElectroluxCount} mancanti`}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {USER_ELECTROLUX_AEG_PRESETS.map((item) => {
              const saved = isAlreadyInHouse(item);
              return (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 flex flex-col justify-between gap-2 ${
                    saved
                      ? 'bg-emerald-950/20 border-emerald-500/35'
                      : 'bg-slate-950/75 border-slate-800'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                      <span className="text-sky-300 font-semibold">{item.brand}</span>
                      <span className="text-slate-400">PNC {item.pnc}</span>
                    </div>
                    <div className="text-xs font-bold text-slate-100 leading-snug">{item.name}</div>
                    <div className="text-[11px] font-mono text-slate-400">Mod. {item.model}</div>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    {saved ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
                        <Check className="w-3.5 h-3.5" />
                        Salvato in Casa
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={quickAddingId === item.id}
                          onClick={() =>
                            void quickSaveSearchResultToFirestore(item, true, item.suggestedRoom)
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 rounded"
                        >
                          <Plus className="w-3 h-3" />
                          Aggiungi
                        </button>
                        <button
                          type="button"
                          onClick={() => openSearchResultForCustomization(item)}
                          className="px-2 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
                          title="Personalizza e allega documenti"
                        >
                          + Doc
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Form Aggiunta / Modifica Articolo + Documenti Associati */}
      {showForm && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-sky-500/40 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              {editingId
                ? 'Modifica articolo, specifiche e documenti associati'
                : 'Nuovo articolo di casa con documenti associati'}
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
                placeholder='Es. Lavatrice ProSteam 8 kg, Smart TV 75"...'
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
                placeholder="Es. Electrolux, AEG, TCL, Bosch..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Modello No. *</label>
              <input
                type="text"
                required
                maxLength={80}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Es. LR7G86XW, KESC8310L, EIL63443..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Prodotto No. (PNC) / Seriale</label>
              <input
                type="text"
                maxLength={80}
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder="Es. PNC 914 921 766 / S/N..."
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
                placeholder="Es. Cucina, Salone, Bagno 1..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
              <datalist id="room-presets-datalist">
                {allRooms.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Data acquisto (opz.)</label>
              <input
                type="text"
                maxLength={20}
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                placeholder="GG/MM/AAAA"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Scadenza garanzia (opz.)</label>
              <input
                type="text"
                maxLength={20}
                value={warrantyEnd}
                onChange={(e) => setWarrantyEnd(e.target.value)}
                placeholder="GG/MM/AAAA"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-start gap-2.5 pt-4">
              <input
                id="familyWarrantyToggle"
                type="checkbox"
                checked={familyWarranty}
                onChange={(e) => setFamilyWarranty(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-slate-700 bg-slate-950 text-emerald-500"
              />
              <div>
                <label
                  htmlFor="familyWarrantyToggle"
                  className="text-slate-200 font-medium cursor-pointer block"
                >
                  Coperto da Assicurazione Extra Family
                </label>
                <span className="text-[10px] text-slate-500">
                  Estensione guasti elettrodomestici e TV di casa
                </span>
              </div>
            </div>

            <div className="sm:col-span-2 lg:col-span-3 space-y-1">
              <label className="block text-slate-400">Specifiche tecniche</label>
              <input
                type="text"
                maxLength={240}
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                placeholder="Es. 8 kg · ProSteam · Classe A · 60 cm..."
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
                placeholder="Negozio, codice installatore..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Sezione Upload Documenti Associati (PDF + Multi-Allegato) */}
            <div className="sm:col-span-2 lg:col-span-3 bg-slate-950/75 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-sky-400" />
                Documenti associati all&apos;articolo (Manuale, Scontrino, Certificato Extra Family, Foto Targhetta)
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-400">
                    1. Manuale PDF principale (compila i campi dal PDF)
                  </label>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => void handleManualFileChange(event)}
                    disabled={manualProcessing || saving}
                    className="block w-full text-xs text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-sky-500/15 file:text-sky-300 hover:file:bg-sky-500/25"
                  />
                  {manualFile && (
                    <p className="text-[11px] text-sky-300">PDF manuale: {manualFile.name}</p>
                  )}
                  {manualStatus && (
                    <p className="text-[11px] text-slate-400" role="status">
                      {manualStatus}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] text-slate-400">
                    2. Altri documenti allegati (Scontrino, Fattura, Foto targhetta PNC, Extra Family)
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={queuedDocType}
                      onChange={(e) => setQueuedDocType(e.target.value as ArticleAttachmentType)}
                      className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-100 [color-scheme:dark]"
                    >
                      {Object.entries(ATTACHMENT_TYPE_META).map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="file"
                      multiple
                      accept="application/pdf,.pdf,image/*,.doc,.docx"
                      onChange={handleQueueExtraFiles}
                      className="flex-1 min-w-[180px] text-xs text-slate-300 file:mr-2 file:px-2.5 file:py-1.5 file:rounded-lg file:border-0 file:bg-emerald-500/15 file:text-emerald-300 hover:file:bg-emerald-500/25"
                    />
                  </div>
                </div>
              </div>

              {queuedAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {queuedAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px]"
                    >
                      <span
                        className={`px-1.5 py-0.5 text-[10px] rounded border ${
                          ATTACHMENT_TYPE_META[att.docType].badgeClass
                        }`}
                      >
                        {ATTACHMENT_TYPE_META[att.docType].label}
                      </span>
                      <span className="text-slate-200 truncate max-w-[180px]">{att.file.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setQueuedAttachments((prev) => prev.filter((x) => x.id !== att.id))
                        }
                        className="text-slate-400 hover:text-rose-400"
                        aria-label={`Rimuovi ${att.file.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                  ? 'Salvataggio su Firebase...'
                  : editingId
                    ? 'Salva modifiche'
                    : 'Salva articolo e documenti'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: CATALOGO PRODOTTI STILE AMAZON */}
      {viewTab === 'catalogo' && (
        <section className="space-y-4">
          {/* Barra di ricerca stile Store */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="Cerca nel catalogo: es. Electrolux, AEG, LR7G86XW, 914921766, lavastoviglie, TCL, frigo..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>
              <button
                type="button"
                disabled={webSearching || catalogQuery.trim().length < 2}
                onClick={() => void runWebCatalogSearch(catalogQuery)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-violet-400 text-slate-950 hover:bg-violet-300 disabled:opacity-50"
              >
                <Globe className={`w-3.5 h-3.5 ${webSearching ? 'animate-spin' : ''}`} />
                {webSearching ? 'Ricerca Web...' : 'Cerca anche online (Web)'}
              </button>
              {!readOnly && catalogQuery.trim().length >= 2 && (
                <button
                  type="button"
                  onClick={() => openCustomDraftFromQuery(catalogQuery)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 hover:bg-emerald-500/25"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Crea nuovo &quot;{catalogQuery.trim().slice(0, 22)}&quot;
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-slate-400">
                  <span>Marca:</span>
                  <select
                    value={catalogBrand}
                    onChange={(e) => setCatalogBrand(e.target.value)}
                    className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
                  >
                    {catalogBrands.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>

                {!readOnly && (
                  <>
                    <label className="inline-flex items-center gap-1.5 text-slate-400">
                      <span>Aggiungi in stanza:</span>
                      <select
                        value={catalogTargetRoom}
                        onChange={(e) => setCatalogTargetRoom(e.target.value)}
                        className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
                      >
                        <option value="auto">Automatica per tipo</option>
                        {allRooms.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={catalogIncludeExtraFamily}
                        onChange={(e) => setCatalogIncludeExtraFamily(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-emerald-500"
                      />
                      <span>Attiva Extra Family</span>
                    </label>
                  </>
                )}
              </div>

              <div className="text-[11px] text-slate-400">
                Mostrati <strong className="text-slate-200">{filteredCatalogItems.length}</strong>{' '}
                prodotti{webProvider ? ` · ${webProvider}` : ''}
              </div>
            </div>

            {webSearchError && (
              <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
                {webSearchError}
              </p>
            )}
          </div>

          {/* Layout Sidebar Reparti + Griglia Prodotti Store */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <aside className="lg:col-span-3 bg-slate-900/75 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 pb-1">
                Reparti Casa
              </div>
              <div className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
                {CATALOG_DEPARTMENTS.map((dept) => {
                  const count =
                    dept === 'Tutti i reparti'
                      ? fullCatalog.length
                      : fullCatalog.filter((x) => (x.department || 'Altro') === dept).length;
                  const active = catalogDepartment === dept;
                  return (
                    <button
                      key={dept}
                      type="button"
                      onClick={() => setCatalogDepartment(dept)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 text-xs rounded-lg whitespace-nowrap transition-colors ${
                        active
                          ? 'bg-violet-400 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{dept}</span>
                      <span
                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                          active ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="lg:col-span-9 space-y-3">
              {filteredCatalogItems.length === 0 ? (
                <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400 space-y-3">
                  <p>
                    Nessun prodotto nel catalogo locale corrisponde a &quot;{catalogQuery}&quot;.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runWebCatalogSearch(catalogQuery)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-400 text-slate-950 font-semibold"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Cerca sul Web
                    </button>
                    {!readOnly && catalogQuery.trim() && (
                      <button
                        type="button"
                        onClick={() => openCustomDraftFromQuery(catalogQuery)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-400 text-slate-950 font-semibold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Aggiungi manualmente
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                  {filteredCatalogItems.map((item) => {
                    const meta = CATEGORY_META[item.category] || CATEGORY_META.altro;
                    const Icon = meta.icon;
                    const alreadyOwned = isAlreadyInHouse(item);
                    const specBullets = item.specs
                      .split('·')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 4);

                    return (
                      <article
                        key={item.id}
                        className={`bg-slate-900/80 border rounded-xl overflow-hidden flex flex-col justify-between transition-colors ${
                          alreadyOwned
                            ? 'border-emerald-500/40'
                            : 'border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="h-28 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-center relative px-4">
                            {item.imageUrl && !failedOnlineImages.has(item.id) ? (
                              <img
                                src={item.imageUrl}
                                alt={`${item.brand} ${item.model}`}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-contain py-2"
                                onError={() =>
                                  setFailedOnlineImages((cur) => new Set(cur).add(item.id))
                                }
                              />
                            ) : (
                              <div className="flex flex-col items-center gap-1 text-slate-500">
                                <Icon className="w-8 h-8 text-sky-400/80" />
                                <span className="text-[10px] font-mono uppercase tracking-wider">
                                  {item.department || meta.label}
                                </span>
                              </div>
                            )}
                            <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-semibold bg-slate-900/90 text-slate-300 border border-slate-700 rounded">
                              {item.brand}
                            </span>
                            {alreadyOwned ? (
                              <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 rounded">
                                <Check className="w-3 h-3" />
                                In Casa
                              </span>
                            ) : (
                              item.familyWarrantySuggested && (
                                <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
                                  Extra Family
                                </span>
                              )
                            )}
                          </div>

                          <div className="p-3.5 space-y-2">
                            <div>
                              <h3 className="text-sm font-bold text-slate-100 leading-snug">
                                {item.name}
                              </h3>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-sky-300 mt-0.5">
                                <span>Mod. {item.model}</span>
                                {item.pnc && (
                                  <span className="text-amber-300">PNC {item.pnc}</span>
                                )}
                              </div>
                            </div>

                            {item.description && (
                              <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
                                {item.description}
                              </p>
                            )}

                            {specBullets.length > 0 && (
                              <ul className="space-y-0.5 text-[11px] text-slate-300 list-disc pl-4">
                                {specBullets.map((sp, i) => (
                                  <li key={i}>{sp}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>

                        <div className="p-3.5 pt-2 border-t border-slate-800/80 space-y-2">
                          {!readOnly ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                disabled={quickAddingId === item.id}
                                onClick={() =>
                                  void quickSaveSearchResultToFirestore(
                                    item,
                                    catalogIncludeExtraFamily &&
                                      Boolean(item.familyWarrantySuggested ?? true),
                                    catalogTargetRoom
                                  )
                                }
                                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-sky-400 hover:bg-sky-300 px-2.5 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-60"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {quickAddingId === item.id
                                  ? 'Salvataggio...'
                                  : alreadyOwned
                                    ? 'Aggiungi copia'
                                    : 'Aggiungi a Casa'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openSearchResultForCustomization(item)}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200"
                                title="Personalizza stanza, data acquisto e allega documenti"
                              >
                                <Paperclip className="h-3 w-3 text-sky-400" />
                                + Doc
                              </button>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500">
                              Stanza suggerita: <strong className="text-slate-300">{item.suggestedRoom}</strong>
                            </div>
                          )}

                          {item.manualUrl && (
                            <a
                              href={item.manualUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-sky-300"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Manuale / Supporto ufficiale {item.brand}
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB 1: I MIEI ARTICOLI IN CASA */}
      {viewTab === 'casa' && (
        <>
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

            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cerca nei miei articoli (modello, PNC, stanza...)"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Lista Articoli */}
          {filteredArticles.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400 space-y-3">
              <p>
                {selectedRoom !== 'all'
                  ? `Nessun articolo ancora assegnato alla stanza "${selectedRoom}".`
                  : 'Nessun articolo corrisponde ai filtri selezionati.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewTab('catalogo')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-violet-400 hover:bg-violet-300 rounded-lg"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Sfoglia Catalogo Prodotti
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      openNewForm(selectedRoom !== 'all' ? selectedRoom : 'Cucina')
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Crea articolo personalizzato
                  </button>
                )}
              </div>
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
        </>
      )}

      {/* Modal Scheda Tecnica, Manuale & Documenti Associati */}
      {activeSheetArticle && activeGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded">
                    Scheda Articolo, Manuale &amp; Documenti
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-800 text-slate-300 rounded">
                    {activeSheetArticle.room}
                  </span>
                  {activeSheetArticle.familyWarranty && (
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
                      Assicurazione Extra Family
                    </span>
                  )}
                </div>
                <h2 className="text-base font-bold text-slate-100 mt-1.5">
                  {activeSheetArticle.name}
                </h2>
                <div className="text-xs font-mono text-sky-300">
                  {activeSheetArticle.brand} · {activeSheetArticle.model}
                  {activeSheetArticle.serialNumber
                    ? ` · ${activeSheetArticle.serialNumber}`
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
              {/* Documenti Associati (Multi-file Cloud Vault) */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-slate-100 flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-sky-400" />
                    Documenti Associati ({activeSheetDocs.length + (activeSheetArticle.manualFileKey ? 1 : 0)})
                  </div>
                  {!readOnly && (
                    <span className="text-[11px] text-slate-400">
                      Sincronizzati nel Vault Firebase e nella pagina Documenti
                    </span>
                  )}
                </div>

                {/* Uploader rapido direttamente dalla scheda */}
                {!readOnly && (
                  <div className="flex flex-wrap items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
                    <select
                      value={modalDocType}
                      onChange={(e) => setModalDocType(e.target.value as ArticleAttachmentType)}
                      className="px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 [color-scheme:dark]"
                    >
                      {Object.entries(ATTACHMENT_TYPE_META).map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      maxLength={40}
                      value={modalDocTitle}
                      onChange={(e) => setModalDocTitle(e.target.value)}
                      placeholder="Etichetta opz. (es. Fattura Unieuro)"
                      className="flex-1 min-w-[160px] px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100"
                    />
                    <button
                      type="button"
                      disabled={uploadingModalDoc}
                      onClick={() => modalDocInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-400 hover:bg-emerald-300 text-slate-950 rounded-lg disabled:opacity-60"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingModalDoc ? 'Caricamento...' : 'Allega PDF / Foto'}
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  {activeSheetArticle.manualFileKey && (
                    <div className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 text-[10px] rounded border bg-sky-500/15 text-sky-300 border-sky-500/30">
                            Manuale PDF
                          </span>
                          <span className="font-medium text-slate-200 truncate">
                            {activeSheetArticle.manualFileName || 'manuale.pdf'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={downloadingManualId === activeSheetArticle.id}
                        onClick={() => void handleDownloadManual(activeSheetArticle)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-slate-800 rounded"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Scarica
                      </button>
                    </div>
                  )}

                  {activeSheetDocs.map((docItem) => {
                    const parsedRef = parseArticleDocumentRef(docItem.referenceCode);
                    const typeMeta =
                      ATTACHMENT_TYPE_META[parsedRef?.docType || 'altro'] ||
                      ATTACHMENT_TYPE_META.altro;
                    return (
                      <div
                        key={docItem.id}
                        className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] rounded border ${typeMeta.badgeClass}`}
                            >
                              {typeMeta.label}
                            </span>
                            <span className="font-semibold text-slate-100 truncate">
                              {docItem.title}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {docItem.fileName}{' '}
                            {docItem.fileSize ? `(${formatFileSize(docItem.fileSize)})` : ''} ·{' '}
                            {docItem.issueDate || ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={downloadingDocId === docItem.id}
                            onClick={() => void handleDownloadArticleDoc(docItem)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
                          >
                            <Download className="w-3.5 h-3.5 text-sky-400" />
                            Scarica
                          </button>
                          <button
                            type="button"
                            onClick={() => setShareItem(buildDocumentSharePayload(docItem))}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 rounded-lg transition-colors"
                            aria-label="Condividi documento"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            Condividi
                          </button>
                          {!readOnly && (
                            <button
                              type="button"
                              disabled={deletingDocId === docItem.id}
                              onClick={() => void handleDeleteArticleDoc(docItem)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg"
                              aria-label="Elimina allegato"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {!activeSheetArticle.manualFileKey && activeSheetDocs.length === 0 && (
                    <p className="text-[11px] text-slate-500">
                      Nessun file ancora caricato per questo articolo. Usa il pulsante qui sopra per allegare manuale PDF, scontrino, fattura o foto targhetta PNC.
                    </p>
                  )}
                </div>
              </div>

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
                    disabled={fetchingManualOnline}
                    onClick={() => void handleFetchOnlineManualForActive()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-300 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 rounded-lg disabled:opacity-50"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {fetchingManualOnline ? 'Ricerca guida...' : 'Aggiorna scheda online'}
                  </button>
                </div>
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
                  Stampabile (.html)
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
                  Eliminare {pendingDelete.name}?
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Verrà rimosso dall&apos;inventario su Firebase ({pendingDelete.brand}{' '}
                  {pendingDelete.model}) insieme ai documenti associati.
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
