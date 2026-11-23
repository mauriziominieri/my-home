import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Check,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  ShoppingBasket,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { GroceryProduct, SupermarketId } from '../types/home';
import {
  compareSortValues,
  SortableTh,
  SortState,
  toggleSort,
} from './SortableHeader';
import { AccessUnlockBanner } from './AccessUnlockBanner';

interface GroceryViewProps {
  products: GroceryProduct[];
  readOnly?: boolean;
  onSignIn?: () => void;
  onAddProduct: (product: Omit<GroceryProduct, 'id'>) => Promise<void>;
  onUpdateProduct: (id: string, product: Omit<GroceryProduct, 'id'>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
}

const GROCERY_CATEGORIES = [
  'Latticini & Uova',
  'Pasta, Riso & Pane',
  'Carne & Pesce',
  'Frutta & Verdura',
  'Condimenti & Dispensa',
  'Colazione & Dolci',
  'Bevande & Acqua',
  'Surgelati',
  'Casa & Altro',
];

const SUPERMARKET_META: Record<
  SupermarketId,
  { label: string; colorClass: string; badgeClass: string }
> = {
  ins: {
    label: "IN'S",
    colorClass: 'text-amber-300',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
  },
  md: {
    label: 'MD',
    colorClass: 'text-sky-300',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
  },
  conad: {
    label: 'CONAD',
    colorClass: 'text-rose-300',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/35',
  },
};

function parseOptionalPrice(raw: string): number | null {
  const cleaned = raw.trim().replace(/[€\s]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const val = Number.parseFloat(cleaned);
  return Number.isFinite(val) && val >= 0 ? Math.round(val * 100) / 100 : null;
}

function getBestSupermarkets(item: GroceryProduct): {
  bestIds: SupermarketId[];
  minPrice: number | null;
  maxPrice: number | null;
  savingEur: number;
} {
  const entries: { id: SupermarketId; price: number }[] = [];
  if (item.priceIns !== null) entries.push({ id: 'ins', price: item.priceIns });
  if (item.priceMd !== null) entries.push({ id: 'md', price: item.priceMd });
  if (item.priceConad !== null) entries.push({ id: 'conad', price: item.priceConad });

  if (entries.length === 0) {
    return { bestIds: [], minPrice: null, maxPrice: null, savingEur: 0 };
  }
  const minPrice = Math.min(...entries.map((e) => e.price));
  const maxPrice = Math.max(...entries.map((e) => e.price));
  const bestIds = entries.filter((e) => e.price === minPrice).map((e) => e.id);
  const savingEur = Math.max(0, Math.round((maxPrice - minPrice) * 100) / 100);
  return { bestIds, minPrice, maxPrice, savingEur };
}

export function GroceryView({
  products,
  readOnly = false,
  onSignIn,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
}: GroceryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [onlyShoppingList, setOnlyShoppingList] = useState(false);
  const [bestStoreFilter, setBestStoreFilter] = useState<'all' | SupermarketId>('all');

  type SortKey = 'name' | 'category' | 'ins' | 'md' | 'conad' | 'saving';
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'name', dir: 'asc' });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GroceryProduct | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState(GROCERY_CATEGORIES[0]);
  const [unit, setUnit] = useState('1 pz');
  const [priceIns, setPriceIns] = useState('');
  const [priceMd, setPriceMd] = useState('');
  const [priceConad, setPriceConad] = useState('');
  const [inShoppingList, setInShoppingList] = useState(true);
  const [notes, setNotes] = useState('');

  function resetForm() {
    setEditingId(null);
    setName('');
    setCategory(GROCERY_CATEGORIES[0]);
    setUnit('1 pz');
    setPriceIns('');
    setPriceMd('');
    setPriceConad('');
    setInShoppingList(true);
    setNotes('');
  }

  function openNewForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(item: GroceryProduct) {
    setEditingId(item.id);
    setName(item.name);
    setCategory(item.category);
    setUnit(item.unit);
    setPriceIns(item.priceIns !== null ? item.priceIns.toFixed(2).replace('.', ',') : '');
    setPriceMd(item.priceMd !== null ? item.priceMd.toFixed(2).replace('.', ',') : '');
    setPriceConad(item.priceConad !== null ? item.priceConad.toFixed(2).replace('.', ',') : '');
    setInShoppingList(item.inShoppingList);
    setNotes(item.notes || '');
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload: Omit<GroceryProduct, 'id'> = {
        name: name.trim().slice(0, 80),
        category: category.trim() || 'Dispensa',
        unit: unit.trim() || '1 pz',
        priceIns: parseOptionalPrice(priceIns),
        priceMd: parseOptionalPrice(priceMd),
        priceConad: parseOptionalPrice(priceConad),
        inShoppingList,
        notes: notes.trim().slice(0, 240) || undefined,
      };
      if (editingId) {
        await onUpdateProduct(editingId, payload);
      } else {
        await onAddProduct(payload);
      }
      setShowForm(false);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function toggleShoppingList(item: GroceryProduct) {
    if (readOnly) return;
    await onUpdateProduct(item.id, {
      name: item.name,
      category: item.category,
      unit: item.unit,
      priceIns: item.priceIns,
      priceMd: item.priceMd,
      priceConad: item.priceConad,
      inShoppingList: !item.inShoppingList,
      notes: item.notes,
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDeleteProduct(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const basketSource = useMemo(() => {
    const activeList = products.filter((p) => p.inShoppingList);
    return activeList.length > 0 ? activeList : products;
  }, [products]);

  const basketSummary = useMemo(() => {
    let insTotal = 0;
    let insCount = 0;
    let mdTotal = 0;
    let mdCount = 0;
    let conadTotal = 0;
    let conadCount = 0;
    let optimalTotal = 0;
    let optimalCount = 0;

    for (const p of basketSource) {
      if (p.priceIns !== null) {
        insTotal += p.priceIns;
        insCount++;
      }
      if (p.priceMd !== null) {
        mdTotal += p.priceMd;
        mdCount++;
      }
      if (p.priceConad !== null) {
        conadTotal += p.priceConad;
        conadCount++;
      }
      const best = getBestSupermarkets(p);
      if (best.minPrice !== null) {
        optimalTotal += best.minPrice;
        optimalCount++;
      }
    }

    return {
      totalItems: basketSource.length,
      isShoppingList: products.some((p) => p.inShoppingList),
      insTotal,
      insCount,
      mdTotal,
      mdCount,
      conadTotal,
      conadCount,
      optimalTotal,
      optimalCount,
    };
  }, [basketSource, products]);

  const categoriesPresent = useMemo(() => {
    const set = new Set<string>(GROCERY_CATEGORIES);
    for (const p of products) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products
      .filter((p) => {
        if (onlyShoppingList && !p.inShoppingList) return false;
        if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
        if (bestStoreFilter !== 'all') {
          const best = getBestSupermarkets(p);
          if (!best.bestIds.includes(bestStoreFilter)) return false;
        }
        if (!q) return true;
        return [p.name, p.category, p.unit, p.notes]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        switch (sort.key) {
          case 'name':
            return compareSortValues(a.name, b.name, sort.dir);
          case 'category':
            return compareSortValues(a.category, b.category, sort.dir);
          case 'ins':
            return compareSortValues(a.priceIns, b.priceIns, sort.dir);
          case 'md':
            return compareSortValues(a.priceMd, b.priceMd, sort.dir);
          case 'conad':
            return compareSortValues(a.priceConad, b.priceConad, sort.dir);
          case 'saving':
            return compareSortValues(
              getBestSupermarkets(a).savingEur,
              getBestSupermarkets(b).savingEur,
              sort.dir
            );
        }
      });
  }, [products, onlyShoppingList, selectedCategory, bestStoreFilter, searchQuery, sort]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-400" />
            Spesa Alimentare — IN&apos;S · MD · CONAD ({products.length})
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Lista prodotti alimentari con confronto prezzi su IN&apos;S, MD e CONAD salvata su Firebase Firestore.
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Aggiungi prodotto alimentare
          </button>
        )}
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        onSignIn={onSignIn}
        pageName="Spesa"
        unlockedFeatures={[
          'Aggiungi nuovi prodotti alimentari e salva i prezzi di IN’S, MD e CONAD su Firestore',
          'Spunta prodotti dentro/fuori lista spesa e aggiorna i prezzi in tempo reale',
        ]}
      />

      {/* KPI Confronto Carrello 3 Supermercati */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900/70 border border-amber-500/30 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-amber-300 font-semibold">
            <span>IN&apos;S Mercato</span>
            <span>
              {basketSummary.insCount}/{basketSummary.totalItems} prezzi
            </span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100 mt-1">
            {basketSummary.insCount > 0
              ? `${basketSummary.insTotal.toFixed(2).replace('.', ',')} €`
              : '—'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {basketSummary.isShoppingList ? 'Su lista da comprare' : 'Su tutti i prodotti'}
          </div>
        </div>

        <div className="bg-slate-900/70 border border-sky-500/30 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-sky-300 font-semibold">
            <span>MD</span>
            <span>
              {basketSummary.mdCount}/{basketSummary.totalItems} prezzi
            </span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100 mt-1">
            {basketSummary.mdCount > 0
              ? `${basketSummary.mdTotal.toFixed(2).replace('.', ',')} €`
              : '—'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {basketSummary.isShoppingList ? 'Su lista da comprare' : 'Su tutti i prodotti'}
          </div>
        </div>

        <div className="bg-slate-900/70 border border-rose-500/30 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-rose-300 font-semibold">
            <span>CONAD</span>
            <span>
              {basketSummary.conadCount}/{basketSummary.totalItems} prezzi
            </span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100 mt-1">
            {basketSummary.conadCount > 0
              ? `${basketSummary.conadTotal.toFixed(2).replace('.', ',')} €`
              : '—'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {basketSummary.isShoppingList ? 'Su lista da comprare' : 'Su tutti i prodotti'}
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-500/40 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
            <span className="inline-flex items-center gap-1">
              <Award className="w-3.5 h-3.5" />
              Spesa Ottimale
            </span>
            <span>{basketSummary.optimalCount} prezzati</span>
          </div>
          <div className="text-lg font-bold font-mono text-emerald-300 mt-1">
            {basketSummary.optimalCount > 0
              ? `${basketSummary.optimalTotal.toFixed(2).replace('.', ',')} €`
              : '—'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Prendendo ogni prodotto dove costa meno
          </div>
        </div>
      </div>

      {/* Form Aggiunta / Modifica Prodotto */}
      {showForm && !readOnly && (
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 sm:p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              {editingId ? 'Modifica prodotto alimentare' : 'Nuovo prodotto alimentare'}
            </h3>
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
            <label className="space-y-1">
              <span className="text-slate-400">Nome prodotto *</span>
              <input
                type="text"
                required
                maxLength={80}
                placeholder="Es. Latte Intero UHT, Pasta 500g..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Categoria</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
              >
                {categoriesPresent.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Formato / Quantità</span>
              <input
                type="text"
                maxLength={80}
                placeholder="Es. 1 L, 500 g, 1 kg, 6 pz"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-amber-300 font-semibold">Prezzo IN&apos;S (€)</span>
              <input
                type="text"
                placeholder="Es. 1,19 (lascia vuoto se non presente)"
                value={priceIns}
                onChange={(e) => setPriceIns(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-amber-500/30 rounded-lg font-mono text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sky-300 font-semibold">Prezzo MD (€)</span>
              <input
                type="text"
                placeholder="Es. 1,09 (lascia vuoto se non presente)"
                value={priceMd}
                onChange={(e) => setPriceMd(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-sky-500/30 rounded-lg font-mono text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-rose-300 font-semibold">Prezzo CONAD (€)</span>
              <input
                type="text"
                placeholder="Es. 1,45 (lascia vuoto se non presente)"
                value={priceConad}
                onChange={(e) => setPriceConad(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-rose-500/30 rounded-lg font-mono text-slate-100"
              />
            </label>

            <label className="space-y-1 sm:col-span-2">
              <span className="text-slate-400">Note / Marca preferita</span>
              <input
                type="text"
                maxLength={240}
                placeholder="Es. Marca Granarolo, spesso in offerta il giovedì..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
              />
            </label>

            <label className="flex items-center gap-2.5 pt-5 cursor-pointer">
              <input
                type="checkbox"
                checked={inShoppingList}
                onChange={(e) => setInShoppingList(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-500"
              />
              <span className="text-slate-200">Includi nella lista da comprare</span>
            </label>
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
              className="px-4 py-2 font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg"
            >
              {saving ? 'Salvataggio...' : editingId ? 'Salva modifiche' : 'Salva prodotto'}
            </button>
          </div>
        </form>
      )}

      {/* Filtri & Ricerca */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyShoppingList((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              onlyShoppingList
                ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <ShoppingBasket className="w-3.5 h-3.5" />
            Solo lista da comprare ({products.filter((p) => p.inShoppingList).length})
          </button>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 [color-scheme:dark]"
          >
            <option value="all">Tutte le categorie</option>
            {categoriesPresent.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setBestStoreFilter('all')}
              className={`px-2 py-1 rounded ${
                bestStoreFilter === 'all'
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tutti
            </button>
            {(['ins', 'md', 'conad'] as SupermarketId[]).map((sid) => (
              <button
                key={sid}
                type="button"
                onClick={() => setBestStoreFilter(sid)}
                className={`px-2 py-1 rounded font-semibold ${
                  bestStoreFilter === sid
                    ? 'bg-emerald-500 text-slate-950'
                    : `${SUPERMARKET_META[sid].colorClass} hover:bg-slate-800`
                }`}
              >
                Conviene {SUPERMARKET_META[sid].label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full lg:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca prodotto alimentare..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Tabella Confronto Prezzi */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5 font-medium w-10 text-center">Lista</th>
                <SortableTh
                  sortKey="name"
                  currentSort={sort}
                  onSort={(k) => setSort((prev) => toggleSort(prev, k, 'asc'))}
                  className="px-3 py-2.5 font-medium"
                >
                  Prodotto
                </SortableTh>
                <SortableTh
                  sortKey="category"
                  currentSort={sort}
                  onSort={(k) => setSort((prev) => toggleSort(prev, k, 'asc'))}
                  className="px-3 py-2.5 font-medium"
                >
                  Categoria
                </SortableTh>
                <SortableTh
                  sortKey="ins"
                  currentSort={sort}
                  onSort={(k) => setSort((prev) => toggleSort(prev, k, 'asc'))}
                  align="right"
                  className="px-3 py-2.5 font-medium text-right text-amber-300"
                >
                  IN&apos;S
                </SortableTh>
                <SortableTh
                  sortKey="md"
                  currentSort={sort}
                  onSort={(k) => setSort((prev) => toggleSort(prev, k, 'asc'))}
                  align="right"
                  className="px-3 py-2.5 font-medium text-right text-sky-300"
                >
                  MD
                </SortableTh>
                <SortableTh
                  sortKey="conad"
                  currentSort={sort}
                  onSort={(k) => setSort((prev) => toggleSort(prev, k, 'asc'))}
                  align="right"
                  className="px-3 py-2.5 font-medium text-right text-rose-300"
                >
                  CONAD
                </SortableTh>
                <SortableTh
                  sortKey="saving"
                  currentSort={sort}
                  onSort={(k) => setSort((prev) => toggleSort(prev, k, 'desc'))}
                  className="px-3 py-2.5 font-medium"
                >
                  Migliore
                </SortableTh>
                {!readOnly && <th className="px-3 py-2.5 font-medium text-right">Azioni</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400 space-y-2">
                    <p>Nessun prodotto alimentare ancora inserito o trovato.</p>
                    {!readOnly && products.length === 0 && (
                      <p className="text-[11px] text-slate-500">
                        Clicca <strong className="text-emerald-300">&quot;Aggiungi prodotto alimentare&quot;</strong> per inserire il primo alimento con i prezzi di IN&apos;S, MD e CONAD.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                filteredProducts.map((item) => {
                  const best = getBestSupermarkets(item);
                  const renderPriceCell = (sid: SupermarketId, val: number | null) => {
                    const isBest = val !== null && best.bestIds.includes(sid);
                    return (
                      <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                        {val !== null ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${
                              isBest
                                ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/35'
                                : 'text-slate-200'
                            }`}
                          >
                            {isBest && <Check className="w-3 h-3" />}
                            {val.toFixed(2).replace('.', ',')} €
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    );
                  };

                  return (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => void toggleShoppingList(item)}
                          title={
                            item.inShoppingList
                              ? 'Rimuovi dalla lista da comprare'
                              : 'Aggiungi alla lista da comprare'
                          }
                          className={`p-1 rounded transition-colors ${
                            item.inShoppingList
                              ? 'text-emerald-400 hover:bg-emerald-500/15'
                              : 'text-slate-600 hover:text-slate-300'
                          }`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-100">
                          {item.name}{' '}
                          <span className="text-[11px] font-normal text-slate-400">
                            ({item.unit})
                          </span>
                        </div>
                        {item.notes && (
                          <div className="text-[10px] text-slate-400">{item.notes}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">{item.category}</td>
                      {renderPriceCell('ins', item.priceIns)}
                      {renderPriceCell('md', item.priceMd)}
                      {renderPriceCell('conad', item.priceConad)}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {best.bestIds.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {best.bestIds.map((id) => (
                              <span
                                key={id}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${SUPERMARKET_META[id].badgeClass}`}
                              >
                                {SUPERMARKET_META[id].label}
                              </span>
                            ))}
                            {best.savingEur > 0 && (
                              <span className="text-[10px] font-mono text-emerald-300">
                                (-{best.savingEur.toFixed(2).replace('.', ',')}€)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      {!readOnly && (
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditForm(item)}
                              aria-label={`Modifica ${item.name}`}
                              className="p-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(item)}
                              aria-label={`Elimina ${item.name}`}
                              className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                <p className="text-xs text-slate-300">
                  Verrà rimosso dalla tua lista spesa su Firebase.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-2 text-xs text-slate-300 bg-slate-800 rounded-lg"
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
