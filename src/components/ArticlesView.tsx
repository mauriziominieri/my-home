import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cpu,
  Home,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Thermometer,
  Trash2,
  Tv,
  Utensils,
} from 'lucide-react';
import { HomeArticleCategory, HomeArticleRecord } from '../types/home';
import { FAMILY_WARRANTY_INFO } from '../data/articlesSeed';

interface ArticlesViewProps {
  articles: HomeArticleRecord[];
  readOnly?: boolean;
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
  onAddArticle,
  onUpdateArticle,
  onDeleteArticle,
}: ArticlesViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'family' | HomeArticleCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
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
  const [notes, setNotes] = useState('');

  function resetForm() {
    setEditingId(null);
    setName('');
    setBrand('');
    setModel('');
    setCategory('elettrodomestici');
    setRoom('Cucina');
    setPurchaseDate('');
    setWarrantyEnd('');
    setFamilyWarranty(false);
    setSerialNumber('');
    setSpecs('');
    setNotes('');
  }

  function openNewForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(item: HomeArticleRecord) {
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
    setNotes(item.notes || '');
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !brand.trim() || !model.trim() || !room.trim()) return;
    setSaving(true);
    try {
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
        notes: notes.trim().slice(0, 240) || undefined,
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
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

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
  }, [articles, selectedCategory, searchQuery]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-400" />
            Articoli e Dispositivi di Casa ({articles.length})
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Inventario completo di elettrodomestici, TV, sicurezza, fotovoltaico e coperture assicurative salvato su Firebase.
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Aggiungi articolo
          </button>
        )}
      </div>

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
            <div
              key={item.id}
              className="bg-slate-950/75 border border-emerald-500/25 rounded-lg px-3 py-2 text-xs"
            >
              <div className="font-semibold text-slate-100 truncate">{item.name}</div>
              <div className="text-[11px] font-mono text-emerald-300 truncate">
                {item.brand !== 'Da completare' ? `${item.brand} ${item.model}` : 'Modello da inserire'}
              </div>
            </div>
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
              {editingId ? 'Modifica articolo' : 'Nuovo articolo / dispositivo di casa'}
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
              <label className="block text-slate-400">Ambiente / Stanza *</label>
              <input
                type="text"
                required
                maxLength={60}
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Es. Salone, Cucina, Garage..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500"
              />
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

            <div className="sm:col-span-2 lg:col-span-3 space-y-1">
              <label className="block text-slate-400">Note aggiuntive (opz.)</label>
              <input
                type="text"
                maxLength={240}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Codice installatore, posizione fattura, impostazioni..."
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

      {/* Filtri e Ricerca */}
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
            Tutti ({articles.length})
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

      {/* Griglia Articoli */}
      {filteredArticles.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
          Nessun articolo corrisponde ai filtri selezionati.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredArticles.map((item) => {
            const meta = CATEGORY_META[item.category] || CATEGORY_META.altro;
            const Icon = meta.icon;
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

                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Home className="w-3 h-3 text-slate-500" />
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

                  {item.notes && (
                    <p className="text-[11px] text-slate-500 italic">{item.notes}</p>
                  )}
                </div>

                <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.familyWarranty && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium">
                        <ShieldCheck className="w-3 h-3" />
                        Garanzia Family
                      </span>
                    )}
                    {item.warrantyEnd && (
                      <span className="font-mono text-slate-400">
                        Scad. {item.warrantyEnd}
                      </span>
                    )}
                    {item.serialNumber && (
                      <span className="font-mono text-slate-500">S/N {item.serialNumber}</span>
                    )}
                  </div>

                  {!readOnly && (
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        type="button"
                        onClick={() => openEditForm(item)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-sky-400 hover:text-sky-300 hover:bg-slate-800 rounded transition-colors"
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
              </article>
            );
          })}
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
