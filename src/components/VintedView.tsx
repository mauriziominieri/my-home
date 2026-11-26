import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Euro,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  VintedItemCategory,
  VintedSaleRecord,
  VintedSaleStatus,
} from '../types/home';
import { VINTED_CATEGORIES, VINTED_STATUS_META } from '../utils/vintedStore';
import { AccessUnlockBanner } from './AccessUnlockBanner';

interface VintedViewProps {
  sales: VintedSaleRecord[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onAddSale: (sale: Omit<VintedSaleRecord, 'id'>) => Promise<void>;
  onUpdateSale: (id: string, sale: Omit<VintedSaleRecord, 'id'>) => Promise<void>;
  onDeleteSale: (id: string) => Promise<void>;
}

type SortKey = 'date_desc' | 'profit_desc' | 'price_desc';

function parseItDateTs(raw: string): number {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

function getSaleYear(raw: string): string {
  const m = raw.trim().match(/(\d{4})$/);
  return m ? m[1] : 'Altro';
}

function formatEur(val: number): string {
  return `${val.toFixed(2).replace('.', ',')} €`;
}

export function VintedView({
  sales,
  readOnly = false,
  onSignIn,
  onAddSale,
  onUpdateSale,
  onDeleteSale,
}: VintedViewProps) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<'all' | VintedItemCategory>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | VintedSaleStatus>('all');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('date_desc');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VintedSaleRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<VintedItemCategory>('Abbigliamento');
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [saleDate, setSaleDate] = useState(new Date().toLocaleDateString('it-IT'));
  const [salePrice, setSalePrice] = useState('');
  const [originalCost, setOriginalCost] = useState('');
  const [extraCosts, setExtraCosts] = useState('');
  const [manualProfitOverride, setManualProfitOverride] = useState(false);
  const [manualProfit, setManualProfit] = useState('');
  const [status, setStatus] = useState<VintedSaleStatus>('completato');
  const [buyerName, setBuyerName] = useState('');
  const [notes, setNotes] = useState('');

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const s of sales) {
      const y = getSaleYear(s.saleDate);
      if (y !== 'Altro') set.add(y);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [sales]);

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales
      .filter((s) => {
        if (filterCat !== 'all' && s.category !== filterCat) return false;
        if (filterStatus !== 'all' && s.status !== filterStatus) return false;
        if (filterYear !== 'all' && getSaleYear(s.saleDate) !== filterYear) return false;
        if (q) {
          const hay = `${s.title} ${s.brand || ''} ${s.size || ''} ${s.buyerName || ''} ${s.notes || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'profit_desc') return b.netProfitEur - a.netProfitEur;
        if (sortBy === 'price_desc') return b.salePriceEur - a.salePriceEur;
        return parseItDateTs(b.saleDate) - parseItDateTs(a.saleDate);
      });
  }, [sales, search, filterCat, filterStatus, filterYear, sortBy]);

  const stats = useMemo(() => {
    let grossRevenue = 0;
    let totalProfit = 0;
    let pendingBalance = 0;
    let bestSale: VintedSaleRecord | null = null;
    const byCategory = new Map<string, { count: number; profit: number }>();

    for (const s of filteredSales) {
      grossRevenue += s.salePriceEur;
      totalProfit += s.netProfitEur;
      if (s.status !== 'completato') {
        pendingBalance += s.salePriceEur;
      }
      if (!bestSale || s.netProfitEur > bestSale.netProfitEur) {
        bestSale = s;
      }
      const prev = byCategory.get(s.category) || { count: 0, profit: 0 };
      byCategory.set(s.category, {
        count: prev.count + 1,
        profit: prev.profit + s.netProfitEur,
      });
    }

    const avgProfit = filteredSales.length > 0 ? totalProfit / filteredSales.length : 0;
    const categoryBreakdown = Array.from(byCategory.entries())
      .map(([cat, v]) => ({ cat, ...v }))
      .sort((a, b) => b.profit - a.profit);

    return {
      count: filteredSales.length,
      grossRevenue,
      totalProfit,
      pendingBalance,
      avgProfit,
      bestSale,
      categoryBreakdown,
    };
  }, [filteredSales]);

  const computedPreviewProfit = useMemo(() => {
    const p = Number(salePrice.replace(',', '.')) || 0;
    const c = Number(originalCost.replace(',', '.')) || 0;
    const e = Number(extraCosts.replace(',', '.')) || 0;
    return Math.round((p - c - e) * 100) / 100;
  }, [salePrice, originalCost, extraCosts]);

  function openNewForm() {
    setEditingId(null);
    setTitle('');
    setCategory('Abbigliamento');
    setBrand('');
    setSize('');
    setSaleDate(new Date().toLocaleDateString('it-IT'));
    setSalePrice('');
    setOriginalCost('');
    setExtraCosts('');
    setManualProfitOverride(false);
    setManualProfit('');
    setStatus('completato');
    setBuyerName('');
    setNotes('');
    setShowForm(true);
  }

  function openEditForm(item: VintedSaleRecord) {
    setEditingId(item.id);
    setTitle(item.title);
    setCategory(item.category);
    setBrand(item.brand || '');
    setSize(item.size || '');
    setSaleDate(item.saleDate);
    setSalePrice(String(item.salePriceEur));
    setOriginalCost(item.originalCostEur !== undefined ? String(item.originalCostEur) : '');
    setExtraCosts(item.extraCostsEur !== undefined ? String(item.extraCostsEur) : '');
    const autoNet =
      Math.round(
        (item.salePriceEur - (item.originalCostEur || 0) - (item.extraCostsEur || 0)) * 100
      ) / 100;
    const isCustom = Math.abs(autoNet - item.netProfitEur) > 0.01;
    setManualProfitOverride(isCustom);
    setManualProfit(isCustom ? String(item.netProfitEur) : '');
    setStatus(item.status);
    setBuyerName(item.buyerName || '');
    setNotes(item.notes || '');
    setShowForm(true);
  }

  function parseMoney(raw: string): number | undefined {
    const clean = raw.trim().replace(',', '.');
    if (!clean) return undefined;
    const n = Number(clean);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || readOnly) return;
    const salePriceNum = Math.max(0, parseMoney(salePrice) ?? 0);
    const origNum = parseMoney(originalCost);
    const extraNum = parseMoney(extraCosts);
    const autoNet =
      Math.round((salePriceNum - (origNum || 0) - (extraNum || 0)) * 100) / 100;
    const netNum = manualProfitOverride
      ? (parseMoney(manualProfit) ?? autoNet)
      : autoNet;

    const payload: Omit<VintedSaleRecord, 'id'> = {
      title: title.trim(),
      category,
      brand: brand.trim() || undefined,
      size: size.trim() || undefined,
      saleDate: saleDate.trim() || new Date().toLocaleDateString('it-IT'),
      salePriceEur: salePriceNum,
      originalCostEur: origNum,
      extraCostsEur: extraNum,
      netProfitEur: netNum,
      status,
      buyerName: buyerName.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    setSaving(true);
    try {
      if (editingId) {
        await onUpdateSale(editingId, payload);
      } else {
        await onAddSale(payload);
      }
      setShowForm(false);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || readOnly) return;
    setDeleting(true);
    try {
      await onDeleteSale(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Tag className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            Vinted — Articoli Venduti &amp; Profitto
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Registra ogni articolo venduto su Vinted, eventuali costi originali o di imballaggio e monitora il guadagno netto totale.
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-teal-600 hover:bg-teal-700 dark:bg-teal-400 dark:hover:bg-teal-300 rounded-lg transition-colors self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Aggiungi vendita Vinted
          </button>
        )}
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Vendite Vinted"
        unlockedFeatures={[
          'Registra articoli venduti con prezzo di vendita, costi e profitto netto automatico',
          'Tieni traccia di stato spedizione, saldo in arrivo e statistiche per categoria',
        ]}
      />

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-emerald-50/80 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-500/35 rounded-xl p-3.5">
          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Profitto Netto Totale
          </div>
          <div
            className={`text-xl font-black font-mono tabular-nums mt-0.5 ${
              stats.totalProfit >= 0
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatEur(stats.totalProfit)}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 tabular-nums">
            Media: {formatEur(stats.avgProfit)} / articolo
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Euro className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            Incasso Vendite Vinted
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
            {formatEur(stats.grossRevenue)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {stats.pendingBalance > 0
              ? `In transito/attesa: ${formatEur(stats.pendingBalance)}`
              : 'Tutto incassato'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <PackageCheck className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            Articoli Venduti
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
            {stats.count}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {sales.filter((s) => s.status === 'completato').length} completati in totale
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Vendita migliore</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5 truncate">
            {stats.bestSale ? formatEur(stats.bestSale.netProfitEur) : '—'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {stats.bestSale ? stats.bestSale.title : 'Nessuna vendita'}
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      {stats.categoryBreakdown.length > 0 && (
        <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1">
            Profitto per categoria:
          </span>
          {stats.categoryBreakdown.map((c) => (
            <span
              key={c.cat}
              className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-200 tabular-nums"
            >
              {c.cat} ({c.count}):{' '}
              <strong className="font-mono text-emerald-700 dark:text-emerald-300">
                {formatEur(c.profit)}
              </strong>
            </span>
          ))}
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-500/40 rounded-xl p-4 sm:p-5 space-y-4 text-xs shadow-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {editingId ? 'Modifica vendita Vinted' : 'Registra articolo venduto su Vinted'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Chiudi
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-slate-600 dark:text-slate-400">Articolo venduto *</span>
              <input
                type="text"
                required
                maxLength={80}
                placeholder="Es. Giacca Zara / Scarpe Nike Air / Cuffie..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Categoria</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as VintedItemCategory)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
              >
                {VINTED_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Data vendita *</span>
              <input
                type="text"
                required
                placeholder="GG/MM/AAAA"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Prezzo di vendita (€) *</span>
              <input
                type="text"
                required
                placeholder="Es. 25.00"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Costo acquisto originale (€ opz.)</span>
              <input
                type="text"
                placeholder="Es. 0 o 10.00"
                value={originalCost}
                onChange={(e) => setOriginalCost(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Spese imballo / boost (€ opz.)</span>
              <input
                type="text"
                placeholder="Es. 1.50"
                value={extraCosts}
                onChange={(e) => setExtraCosts(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Profitto netto (€)</span>
                <label className="inline-flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualProfitOverride}
                    onChange={(e) => {
                      setManualProfitOverride(e.target.checked);
                      if (e.target.checked && !manualProfit) {
                        setManualProfit(String(computedPreviewProfit));
                      }
                    }}
                    className="rounded accent-teal-600"
                  />
                  Manuale
                </label>
              </div>
              {manualProfitOverride ? (
                <input
                  type="text"
                  value={manualProfit}
                  onChange={(e) => setManualProfit(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-emerald-400 dark:border-emerald-500/50 rounded-lg font-mono font-bold text-emerald-700 dark:text-emerald-300"
                />
              ) : (
                <div className="w-full px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/30 rounded-lg font-mono font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {formatEur(computedPreviewProfit)}
                </div>
              )}
            </div>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Brand / Marca</span>
              <input
                type="text"
                maxLength={60}
                placeholder="Es. Nike / Zara / Apple"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Taglia / Misura</span>
              <input
                type="text"
                maxLength={30}
                placeholder="Es. M / 42 / Unica"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Stato ordine</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as VintedSaleStatus)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
              >
                {(Object.keys(VINTED_STATUS_META) as VintedSaleStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {VINTED_STATUS_META[st].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Acquirente Vinted (opz.)</span>
              <input
                type="text"
                maxLength={60}
                placeholder="Username acquirente"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1 sm:col-span-2 lg:col-span-4">
              <span className="text-slate-600 dark:text-slate-400">Note (opz.)</span>
              <input
                type="text"
                maxLength={240}
                placeholder="Es. Venduto con bundle, sconto accettato, corriere InPost..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3.5 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-semibold text-white dark:text-slate-950 bg-teal-600 hover:bg-teal-700 dark:bg-teal-400 dark:hover:bg-teal-300 rounded-lg"
            >
              {saving ? 'Salvataggio...' : editingId ? 'Salva modifiche' : 'Salva vendita'}
            </button>
          </div>
        </form>
      )}

      {/* Search & Filters Bar */}
      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cerca articolo, brand, acquirente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
          />
        </div>

        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value as typeof filterCat)}
          className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 dark:[color-scheme:dark]"
        >
          <option value="all">Tutte le categorie</option>
          {VINTED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 dark:[color-scheme:dark]"
        >
          <option value="all">Tutti gli stati</option>
          {(Object.keys(VINTED_STATUS_META) as VintedSaleStatus[]).map((st) => (
            <option key={st} value={st}>
              {VINTED_STATUS_META[st].label}
            </option>
          ))}
        </select>

        {years.length > 0 && (
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 dark:[color-scheme:dark]"
          >
            <option value="all">Tutti gli anni</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 dark:[color-scheme:dark]"
        >
          <option value="date_desc">Più recenti</option>
          <option value="profit_desc">Profitto più alto</option>
          <option value="price_desc">Prezzo più alto</option>
        </select>
      </div>

      {/* Sold Items List */}
      <div className="bg-white dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Elenco Articoli Venduti ({filteredSales.length})
          </h2>
          <span className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-300 font-bold">
            Totale profitto: {formatEur(stats.totalProfit)}
          </span>
        </div>

        {filteredSales.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
            <Tag className="w-7 h-7 text-slate-400 mx-auto" />
            <p className="font-medium text-slate-700 dark:text-slate-300">
              Nessun articolo Vinted trovato.
            </p>
            {!readOnly && (
              <p>Clicca &quot;Aggiungi vendita Vinted&quot; per registrare il primo articolo venduto e il profitto.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800/70">
            {filteredSales.map((sale) => {
              const stMeta = VINTED_STATUS_META[sale.status] || VINTED_STATUS_META.completato;
              return (
                <div
                  key={sale.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/25 text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded-md ${stMeta.badgeClass}`}
                      >
                        {stMeta.label}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                        {sale.category}
                      </span>
                      <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {sale.saleDate}
                      </span>
                      {sale.brand && (
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          · {sale.brand}
                        </span>
                      )}
                      {sale.size && (
                        <span className="text-slate-500 dark:text-slate-400">
                          (Taglia {sale.size})
                        </span>
                      )}
                    </div>

                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {sale.title}
                    </div>

                    {(sale.buyerName || sale.notes || sale.originalCostEur || sale.extraCostsEur) && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
                        {sale.originalCostEur !== undefined && sale.originalCostEur > 0 && (
                          <span>Acquisto: {formatEur(sale.originalCostEur)}</span>
                        )}
                        {sale.extraCostsEur !== undefined && sale.extraCostsEur > 0 && (
                          <span>Spese extra: {formatEur(sale.extraCostsEur)}</span>
                        )}
                        {sale.buyerName && <span>Acquirente: @{sale.buyerName}</span>}
                        {sale.notes && <span className="italic">{sale.notes}</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-center shrink-0">
                    <div className="text-right tabular-nums">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        Vendita: {formatEur(sale.salePriceEur)}
                      </div>
                      <div
                        className={`text-sm font-black font-mono ${
                          sale.netProfitEur >= 0
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        +{formatEur(sale.netProfitEur)} netto
                      </div>
                    </div>

                    {!readOnly && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditForm(sale)}
                          className="p-1.5 text-slate-500 hover:text-sky-600 dark:hover:text-sky-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                          aria-label="Modifica vendita"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(sale)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                          aria-label="Elimina vendita"
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

      {/* Modal Elimina */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Eliminare &quot;{pendingDelete.title}&quot;?
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  La vendita verrà rimossa dallo storico Vinted su Firebase.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
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
