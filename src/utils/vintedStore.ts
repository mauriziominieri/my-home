import {
  HomeArticleRecord,
  VintedItemCategory,
  VintedSaleRecord,
  VintedSaleStatus,
} from '../types/home';

export const SYSTEM_ROOM_VINTED = '__vinted__';

export const VINTED_CATEGORIES: VintedItemCategory[] = [
  'Abbigliamento',
  'Scarpe',
  'Accessori',
  'Elettronica',
  'Casa & Arredo',
  'Libri & Giochi',
  'Altro',
];

export const VINTED_STATUS_META: Record<
  VintedSaleStatus,
  { label: string; badgeClass: string }
> = {
  venduto: {
    label: 'Venduto (da spedire)',
    badgeClass:
      'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  },
  spedito: {
    label: 'Spedito (in transito)',
    badgeClass:
      'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
  },
  completato: {
    label: 'Completato (saldo incassato)',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  },
};

function sanitizeMoney(val: unknown): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val)) return undefined;
  return Math.round(val * 100) / 100;
}

export function articleToVintedSale(article: HomeArticleRecord): VintedSaleRecord {
  if (article.manualExtractText) {
    try {
      const parsed = JSON.parse(article.manualExtractText) as Partial<VintedSaleRecord>;
      const salePriceEur = sanitizeMoney(parsed.salePriceEur) ?? article.purchasePriceEur ?? 0;
      const originalCostEur = sanitizeMoney(parsed.originalCostEur);
      const extraCostsEur = sanitizeMoney(parsed.extraCostsEur);
      const computedNet =
        Math.round(
          (salePriceEur - (originalCostEur || 0) - (extraCostsEur || 0)) * 100
        ) / 100;
      const netProfitEur = sanitizeMoney(parsed.netProfitEur) ?? computedNet;
      return {
        id: article.id,
        title: parsed.title || article.name,
        category: (parsed.category as VintedItemCategory) || 'Abbigliamento',
        brand: parsed.brand || (article.brand !== 'Vinted' ? article.brand : undefined),
        size: parsed.size || (article.model !== '-' ? article.model : undefined),
        saleDate: parsed.saleDate || article.purchaseDate || '',
        salePriceEur,
        originalCostEur,
        extraCostsEur,
        netProfitEur,
        status: (parsed.status as VintedSaleStatus) || 'completato',
        buyerName: parsed.buyerName || article.serialNumber || undefined,
        notes: parsed.notes || article.notes || undefined,
      };
    } catch {
      // fall through
    }
  }

  const salePriceEur = article.purchasePriceEur ?? 0;
  return {
    id: article.id,
    title: article.name,
    category: 'Abbigliamento',
    brand: article.brand !== 'Vinted' ? article.brand : undefined,
    size: article.model !== '-' ? article.model : undefined,
    saleDate: article.purchaseDate || '',
    salePriceEur,
    netProfitEur: salePriceEur,
    status: 'completato',
    buyerName: article.serialNumber || undefined,
    notes: article.notes || undefined,
  };
}

export function vintedSaleToArticlePayload(
  sale: Omit<VintedSaleRecord, 'id'>
): Omit<HomeArticleRecord, 'id'> {
  const salePrice = Math.max(0, sanitizeMoney(sale.salePriceEur) ?? 0);
  const origCost = sanitizeMoney(sale.originalCostEur);
  const extraCost = sanitizeMoney(sale.extraCostsEur);
  const netProfit =
    sanitizeMoney(sale.netProfitEur) ??
    Math.round((salePrice - (origCost || 0) - (extraCost || 0)) * 100) / 100;

  const cleanPayload: Omit<VintedSaleRecord, 'id'> = {
    title: sale.title.trim().slice(0, 80),
    category: sale.category || 'Abbigliamento',
    brand: sale.brand?.trim().slice(0, 60) || undefined,
    size: sale.size?.trim().slice(0, 30) || undefined,
    saleDate: sale.saleDate.trim().slice(0, 20),
    salePriceEur: salePrice,
    originalCostEur: origCost,
    extraCostsEur: extraCost,
    netProfitEur: netProfit,
    status: sale.status || 'completato',
    buyerName: sale.buyerName?.trim().slice(0, 60) || undefined,
    notes: sale.notes?.trim().slice(0, 240) || undefined,
  };

  return {
    name: cleanPayload.title || 'Articolo Vinted',
    brand: (cleanPayload.brand || cleanPayload.category).slice(0, 60),
    model: (cleanPayload.size || cleanPayload.category).slice(0, 80),
    category: 'altro',
    room: SYSTEM_ROOM_VINTED,
    familyWarranty: cleanPayload.status === 'completato',
    purchaseDate: cleanPayload.saleDate || undefined,
    purchasePriceEur: salePrice,
    serialNumber: cleanPayload.buyerName?.slice(0, 80) || undefined,
    specs: `CAT:${cleanPayload.category}|ST:${cleanPayload.status}|NET:${netProfit.toFixed(2)}`.slice(
      0,
      240
    ),
    notes: cleanPayload.notes,
    manualExtractText: JSON.stringify(cleanPayload).slice(0, 12_000),
  };
}
