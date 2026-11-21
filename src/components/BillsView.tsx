import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Droplets,
  HelpCircle,
  Mail,
  PenLine,
  Plus,
  Receipt,
  Sun,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  BillRecord,
  EnergyReading,
  GsePaymentRecord,
  GsePaymentType,
  SupplierMarketOffer,
  TariBillRecord,
  WaterBillRecord,
} from '../types/home';
import { SEED_ELECTRICITY_BILLS, SEED_WATER_BILLS } from '../data/billsSeed';
import {
  compareSortValues,
  parseFirstPunNumber,
  parseItDateToIso,
  SortableTh,
  SortState,
  toggleSort,
} from './SortableHeader';

interface BillsViewProps {
  readings: EnergyReading[];
  electricityBills?: BillRecord[];
  waterBills?: WaterBillRecord[];
  tariBills?: TariBillRecord[];
  gsePayments?: GsePaymentRecord[];
  readOnly?: boolean;
  onAddElectricityBill?: (bill: BillRecord) => Promise<void>;
  onAddWaterBill?: (bill: Omit<WaterBillRecord, 'id'>) => Promise<void>;
  onAddTariBill?: (bill: Omit<TariBillRecord, 'id'>) => Promise<void>;
  onToggleTariPaid?: (bill: TariBillRecord) => Promise<void>;
  onDeleteTariBill?: (id: string) => Promise<void>;
  onAddGsePayment?: (payment: Omit<GsePaymentRecord, 'id'>) => Promise<void>;
  onDeleteGsePayment?: (id: string) => Promise<void>;
}

interface SupplierOfferSummary {
  key: string;
  year: number;
  supplier: string;
  offerName: string;
  billCount: number;
  totalKwh: number;
  totalElectricityOnly: number;
  totalCanoneTv: number;
  totalPaid: number;
  avgRealPerKwh: number;
  avgVariablePerKwh: number;
}

export function BillsView({
  electricityBills: propElectricityBills,
  waterBills: propWaterBills,
  tariBills: propTariBills = [],
  gsePayments: propGsePayments = [],
  readOnly = false,
  onAddElectricityBill,
  onAddWaterBill,
  onAddTariBill,
  onToggleTariPaid,
  onDeleteTariBill,
  onAddGsePayment,
  onDeleteGsePayment,
}: BillsViewProps) {
  const [utilityTab, setUtilityTab] = useState<'luce' | 'acqua' | 'tari' | 'gse'>('luce');
  const [fetchedBills, setFetchedBills] = useState<BillRecord[] | null>(null);
  const [fetchedTariBills, setFetchedTariBills] = useState<TariBillRecord[]>([]);

  const bills = useMemo(() => {
    const base =
      propElectricityBills && propElectricityBills.length > 0
        ? propElectricityBills
        : SEED_ELECTRICITY_BILLS;
    if (!fetchedBills || fetchedBills.length === 0) return base;
    const map = new Map<string, BillRecord>();
    for (const b of base) map.set(b.invoiceNumber, b);
    for (const b of fetchedBills) {
      if (!map.has(b.invoiceNumber)) map.set(b.invoiceNumber, b);
    }
    return Array.from(map.values());
  }, [propElectricityBills, fetchedBills]);

  const waterBills = useMemo(() => {
    const list =
      propWaterBills && propWaterBills.length > 0 ? propWaterBills : SEED_WATER_BILLS;
    return [...list].sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
  }, [propWaterBills]);

  const tariBills = useMemo(() => {
    const map = new Map<string, TariBillRecord>();
    for (const t of propTariBills) map.set(t.noticeNumber, t);
    for (const t of fetchedTariBills) {
      if (!map.has(t.noticeNumber)) map.set(t.noticeNumber, t);
    }
    return Array.from(map.values()).sort((a, b) => b.year - a.year || a.noticeNumber.localeCompare(b.noticeNumber));
  }, [propTariBills, fetchedTariBills]);

  const gsePayments = useMemo(
    () => [...propGsePayments].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate)),
    [propGsePayments]
  );

  const [selectedBillYear, setSelectedBillYear] = useState<string>('all');
  const [selectedWaterYear, setSelectedWaterYear] = useState<string>('all');

  type ElecSortKey =
    | 'period'
    | 'supplier'
    | 'invoice'
    | 'kwh'
    | 'pun'
    | 'elecOnly'
    | 'tv'
    | 'total';
  type WaterSortKey = 'period' | 'invoice' | 'mc' | 'fixed' | 'total';
  type TariSortKey = 'period' | 'notice' | 'due' | 'source' | 'paid' | 'total';
  type GseSortKey = 'date' | 'type' | 'period' | 'reference' | 'kwh' | 'amount';

  const [elecSort, setElecSort] = useState<SortState<ElecSortKey>>({
    key: 'period',
    dir: 'desc',
  });
  const [waterSort, setWaterSort] = useState<SortState<WaterSortKey>>({
    key: 'period',
    dir: 'desc',
  });
  const [tariSort, setTariSort] = useState<SortState<TariSortKey>>({
    key: 'period',
    dir: 'desc',
  });
  const [gseSort, setGseSort] = useState<SortState<GseSortKey>>({
    key: 'date',
    dir: 'desc',
  });

  const [marketMonitor, setMarketMonitor] = useState<{
    myLockedRate: number;
    myFixedEurMonth: number;
    currentRate: number | null;
    updatedAt: string | null;
    competitors: SupplierMarketOffer[];
    bestCompetitor: SupplierMarketOffer | null;
  }>({
    myLockedRate: 0.1595,
    myFixedEurMonth: 6.0,
    currentRate: 0.1727,
    updatedAt: null,
    competitors: [],
    bestCompetitor: null,
  });

  // Form states per caricamenti manuali
  const [showElecForm, setShowElecForm] = useState(false);
  const [elecSaving, setElecSaving] = useState(false);
  const [eInvoice, setEInvoice] = useState('');
  const [eDate, setEDate] = useState('');
  const [ePeriod, setEPeriod] = useState('');
  const [eSupplier, setESupplier] = useState('Octopus Energy');
  const [eOffer, setEOffer] = useState('Octopus Fissa 24M');
  const [eKwh, setEKwh] = useState('');
  const [eTotal, setETotal] = useState('');
  const [eCanone, setECanone] = useState('0');
  const [eNote, setENote] = useState('');

  const [showWaterForm, setShowWaterForm] = useState(false);
  const [waterSaving, setWaterSaving] = useState(false);
  const [wInvoice, setWInvoice] = useState('');
  const [wDate, setWDate] = useState('');
  const [wYear, setWYear] = useState(String(new Date().getFullYear()));
  const [wPeriod, setWPeriod] = useState('');
  const [wMc, setWMc] = useState('');
  const [wFixed, setWFixed] = useState('');
  const [wTotal, setWTotal] = useState('');
  const [wNote, setWNote] = useState('');

  const [showTariForm, setShowTariForm] = useState(false);
  const [tariSaving, setTariSaving] = useState(false);
  const [tNotice, setTNotice] = useState('');
  const [tIssueDate, setTIssueDate] = useState('');
  const [tDueDate, setTDueDate] = useState('');
  const [tYear, setTYear] = useState(String(new Date().getFullYear()));
  const [tPeriod, setTPeriod] = useState(`TARI ${new Date().getFullYear()} - Rata Unica`);
  const [tSupplier, setTSupplier] = useState('AcegasApsAmga / Comune di Padova');
  const [tTotal, setTTotal] = useState('');
  const [tPaid, setTPaid] = useState(false);
  const [tNote, setTNote] = useState('');

  const [showGseForm, setShowGseForm] = useState(false);
  const [gseSaving, setGseSaving] = useState(false);
  const [gDate, setGDate] = useState('');
  const [gYear, setGYear] = useState(String(new Date().getFullYear()));
  const [gType, setGType] = useState<GsePaymentType>('acconto');
  const [gPeriod, setGPeriod] = useState('');
  const [gAmount, setGAmount] = useState('');
  const [gKwh, setGKwh] = useState('');
  const [gRef, setGRef] = useState('');
  const [gNote, setGNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    const loadMonitor = async () => {
      const urls = [
        './data/octopus_tariff.json',
        'https://mauriziominieri.github.io/my-home/data/octopus_tariff.json',
      ];
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const json = await res.json();
          if (!cancelled && json && typeof json.myLockedRate === 'number') {
            setMarketMonitor({
              myLockedRate: json.myLockedRate,
              myFixedEurMonth:
                typeof json.myFixedEurMonth === 'number' ? json.myFixedEurMonth : 6.0,
              currentRate: typeof json.currentRate === 'number' ? json.currentRate : null,
              updatedAt: json.updatedAt ?? null,
              competitors: Array.isArray(json.competitors) ? json.competitors : [],
              bestCompetitor: json.bestCompetitor ?? null,
            });
            return;
          }
        } catch {
          // try next url
        }
      }
    };
    loadMonitor();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBills = async () => {
      const urls = [
        './data/bollette.json',
        'https://mauriziominieri.github.io/my-home/data/bollette.json',
      ];
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const json = await res.json();
          if (!cancelled && json) {
            if (Array.isArray(json.bills) && json.bills.length > 0) {
              setFetchedBills(json.bills);
            }
            if (Array.isArray(json.tariBills) && json.tariBills.length > 0) {
              setFetchedTariBills(json.tariBills);
            }
            return;
          }
        } catch {
          // try next url
        }
      }
    };
    loadBills();
    return () => {
      cancelled = true;
    };
  }, []);

  const offerSummaries = useMemo<SupplierOfferSummary[]>(() => {
    const map = new Map<string, BillRecord[]>();
    for (const b of bills) {
      const key = `${b.year}|${b.supplier}|${b.offerName}`;
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, list]) => {
        const first = list[0];
        const totalKwh = list.reduce((s, b) => s + b.kwh, 0);
        const totalElectricityOnly = list.reduce((s, b) => s + b.electricityOnly, 0);
        const totalCanoneTv = list.reduce((s, b) => s + b.canoneTv, 0);
        const totalPaid = list.reduce((s, b) => s + b.totalPaid, 0);
        const avgVariablePerKwh =
          list.reduce((s, b) => s + b.variableCostPerKwh, 0) / Math.max(1, list.length);
        return {
          key,
          year: first.year,
          supplier: first.supplier,
          offerName: first.offerName,
          billCount: list.length,
          totalKwh,
          totalElectricityOnly,
          totalCanoneTv,
          totalPaid,
          avgRealPerKwh: totalKwh > 0 ? totalElectricityOnly / totalKwh : 0,
          avgVariablePerKwh,
        };
      })
      .sort((a, b) => b.year - a.year);
  }, [bills]);

  const octopusEstimate = useMemo(() => {
    const ref = offerSummaries[0];
    if (!ref || ref.totalKwh <= 0) {
      return { allInPerKwh: 0.285, monthlyEur: null as number | null };
    }
    const monthsCovered = Math.max(1, ref.billCount * 2);
    const avgMonthlyKwh = ref.totalKwh / monthsCovered;
    const overheadPerKwh = Math.max(0.08, ref.avgRealPerKwh - ref.avgVariablePerKwh);
    const fixedFeeSavingPerKwh = (8.33 - 6.0) / Math.max(50, avgMonthlyKwh);
    const allInPerKwh = Math.max(
      marketMonitor.myLockedRate,
      marketMonitor.myLockedRate + overheadPerKwh - fixedFeeSavingPerKwh
    );
    return {
      allInPerKwh,
      monthlyEur: allInPerKwh * avgMonthlyKwh,
    };
  }, [offerSummaries, marketMonitor.myLockedRate]);

  const billYears = useMemo(
    () => Array.from(new Set(bills.map((b) => String(b.year)))).sort().reverse(),
    [bills]
  );

  const filteredBills = useMemo(() => {
    const list =
      selectedBillYear === 'all'
        ? bills
        : bills.filter((b) => String(b.year) === selectedBillYear);
    return [...list].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [bills, selectedBillYear]);

  const billsTotals = useMemo(() => {
    const kwh = filteredBills.reduce((s, b) => s + b.kwh, 0);
    const elec = filteredBills.reduce((s, b) => s + b.electricityOnly, 0);
    const tv = filteredBills.reduce((s, b) => s + b.canoneTv, 0);
    const total = filteredBills.reduce((s, b) => s + b.totalPaid, 0);
    return {
      kwh,
      elec,
      tv,
      total,
      avgElecPerKwh: kwh > 0 ? elec / kwh : 0,
    };
  }, [filteredBills]);

  const waterYears = useMemo(
    () => Array.from(new Set(waterBills.map((b) => String(b.year)))).sort().reverse(),
    [waterBills]
  );

  const filteredWaterBills = useMemo(() => {
    return selectedWaterYear === 'all'
      ? waterBills
      : waterBills.filter((b) => String(b.year) === selectedWaterYear);
  }, [waterBills, selectedWaterYear]);

  const waterTotals = useMemo(() => {
    const mc = filteredWaterBills.reduce((s, b) => s + b.cubicMeters, 0);
    const total = filteredWaterBills.reduce((s, b) => s + b.totalPaid, 0);
    return {
      mc,
      total,
      avgPerMc: mc > 0 ? total / mc : 0,
    };
  }, [filteredWaterBills]);

  const tariTotals = useMemo(() => {
    const total = tariBills.reduce((s, b) => s + b.totalPaid, 0);
    const unpaidCount = tariBills.filter((b) => !b.paid).length;
    return { total, unpaidCount };
  }, [tariBills]);

  const gseTotals = useMemo(() => {
    const totalEur = gsePayments.reduce((s, p) => s + p.amountEur, 0);
    const totalKwh = gsePayments.reduce((s, p) => s + (p.kwhInjected ?? 0), 0);
    return { totalEur, totalKwh };
  }, [gsePayments]);

  const sortedElecBills = useMemo(() => {
    return [...filteredBills].sort((a, b) => {
      switch (elecSort.key) {
        case 'period':
          return compareSortValues(a.sortKey, b.sortKey, elecSort.dir);
        case 'supplier':
          return compareSortValues(
            `${a.supplier} ${a.offerName}`,
            `${b.supplier} ${b.offerName}`,
            elecSort.dir
          );
        case 'invoice':
          return compareSortValues(a.invoiceNumber, b.invoiceNumber, elecSort.dir);
        case 'kwh':
          return compareSortValues(a.kwh, b.kwh, elecSort.dir);
        case 'pun':
          return compareSortValues(
            parseFirstPunNumber(a.punText),
            parseFirstPunNumber(b.punText),
            elecSort.dir
          );
        case 'elecOnly':
          return compareSortValues(a.electricityOnly, b.electricityOnly, elecSort.dir);
        case 'tv':
          return compareSortValues(a.canoneTv, b.canoneTv, elecSort.dir);
        case 'total':
          return compareSortValues(a.totalPaid, b.totalPaid, elecSort.dir);
      }
    });
  }, [filteredBills, elecSort]);

  const sortedWaterBills = useMemo(() => {
    return [...filteredWaterBills].sort((a, b) => {
      switch (waterSort.key) {
        case 'period':
          return compareSortValues(
            parseItDateToIso(a.issueDate) ?? `${a.year}-${a.period}`,
            parseItDateToIso(b.issueDate) ?? `${b.year}-${b.period}`,
            waterSort.dir
          );
        case 'invoice':
          return compareSortValues(a.invoiceNumber, b.invoiceNumber, waterSort.dir);
        case 'mc':
          return compareSortValues(a.cubicMeters, b.cubicMeters, waterSort.dir);
        case 'fixed':
          return compareSortValues(a.fixedCostEur, b.fixedCostEur, waterSort.dir);
        case 'total':
          return compareSortValues(a.totalPaid, b.totalPaid, waterSort.dir);
      }
    });
  }, [filteredWaterBills, waterSort]);

  const sortedTariBills = useMemo(() => {
    return [...tariBills].sort((a, b) => {
      switch (tariSort.key) {
        case 'period':
          return compareSortValues(
            `${a.year}-${parseItDateToIso(a.dueDate) ?? a.period}`,
            `${b.year}-${parseItDateToIso(b.dueDate) ?? b.period}`,
            tariSort.dir
          );
        case 'notice':
          return compareSortValues(a.noticeNumber, b.noticeNumber, tariSort.dir);
        case 'due':
          return compareSortValues(
            parseItDateToIso(a.dueDate),
            parseItDateToIso(b.dueDate),
            tariSort.dir
          );
        case 'source':
          return compareSortValues(a.source, b.source, tariSort.dir);
        case 'paid':
          return compareSortValues(a.paid, b.paid, tariSort.dir);
        case 'total':
          return compareSortValues(a.totalPaid, b.totalPaid, tariSort.dir);
      }
    });
  }, [tariBills, tariSort]);

  const sortedGsePayments = useMemo(() => {
    return [...gsePayments].sort((a, b) => {
      switch (gseSort.key) {
        case 'date':
          return compareSortValues(
            parseItDateToIso(a.paymentDate) ?? a.paymentDate,
            parseItDateToIso(b.paymentDate) ?? b.paymentDate,
            gseSort.dir
          );
        case 'type':
          return compareSortValues(a.paymentType, b.paymentType, gseSort.dir);
        case 'period':
          return compareSortValues(a.period, b.period, gseSort.dir);
        case 'reference':
          return compareSortValues(
            a.reference || null,
            b.reference || null,
            gseSort.dir
          );
        case 'kwh':
          return compareSortValues(a.kwhInjected ?? null, b.kwhInjected ?? null, gseSort.dir);
        case 'amount':
          return compareSortValues(a.amountEur, b.amountEur, gseSort.dir);
      }
    });
  }, [gsePayments, gseSort]);

  const myAnnualBenchmarkEur =
    marketMonitor.myLockedRate * 2300 + marketMonitor.myFixedEurMonth * 12;

  async function handleSubmitElec(e: React.FormEvent) {
    e.preventDefault();
    if (!onAddElectricityBill || !eInvoice.trim() || !eDate.trim() || !ePeriod.trim()) return;
    setElecSaving(true);
    try {
      const kwhNum = Number(eKwh.replace(',', '.')) || 0;
      const totNum = Number(eTotal.replace(',', '.')) || 0;
      const tvNum = Number(eCanone.replace(',', '.')) || 0;
      const elecOnly = Math.max(0, Math.round((totNum - tvNum) * 100) / 100);
      const dm = eDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const yearNum = dm ? Number(dm[3]) : new Date().getFullYear();
      const sortKey = dm ? `${dm[3]}-${dm[2]}` : `${yearNum}-01`;
      await onAddElectricityBill({
        invoiceNumber: eInvoice.trim().slice(0, 40),
        issueDate: eDate.trim().slice(0, 20),
        sortKey,
        year: yearNum,
        period: ePeriod.trim().slice(0, 80),
        supplier: eSupplier.trim().slice(0, 80),
        offerName: eOffer.trim().slice(0, 100),
        kwh: Math.round(kwhNum),
        punText: 'Fissa',
        variableCostPerKwh: kwhNum > 0 ? Math.round((elecOnly / kwhNum) * 1000) / 1000 : 0.16,
        canoneTv: tvNum,
        electricityOnly: elecOnly,
        totalPaid: totNum,
        note: eNote.trim().slice(0, 240) || undefined,
      });
      setShowElecForm(false);
      setEInvoice('');
      setEDate('');
      setEPeriod('');
      setEKwh('');
      setETotal('');
      setENote('');
    } finally {
      setElecSaving(false);
    }
  }

  async function handleSubmitWater(e: React.FormEvent) {
    e.preventDefault();
    if (!onAddWaterBill || !wInvoice.trim() || !wDate.trim() || !wPeriod.trim()) return;
    setWaterSaving(true);
    try {
      await onAddWaterBill({
        invoiceNumber: wInvoice.trim().slice(0, 40),
        issueDate: wDate.trim().slice(0, 20),
        year: Number(wYear) || new Date().getFullYear(),
        period: wPeriod.trim().slice(0, 80),
        cubicMeters: Number(wMc.replace(',', '.')) || 0,
        fixedCostEur: Number(wFixed.replace(',', '.')) || 0,
        totalPaid: Number(wTotal.replace(',', '.')) || 0,
        note: wNote.trim().slice(0, 240) || undefined,
      });
      setShowWaterForm(false);
      setWInvoice('');
      setWDate('');
      setWPeriod('');
      setWMc('');
      setWFixed('');
      setWTotal('');
      setWNote('');
    } finally {
      setWaterSaving(false);
    }
  }

  async function handleSubmitTari(e: React.FormEvent) {
    e.preventDefault();
    if (!onAddTariBill || !tNotice.trim() || !tPeriod.trim()) return;
    setTariSaving(true);
    try {
      await onAddTariBill({
        noticeNumber: tNotice.trim().slice(0, 50),
        issueDate: tIssueDate.trim().slice(0, 20) || '—',
        dueDate: tDueDate.trim().slice(0, 20) || '—',
        year: Number(tYear) || new Date().getFullYear(),
        period: tPeriod.trim().slice(0, 80),
        supplier: tSupplier.trim().slice(0, 80) || 'AcegasApsAmga / TARI',
        totalPaid: Number(tTotal.replace(',', '.')) || 0,
        paid: tPaid,
        source: 'manuale',
        note: tNote.trim().slice(0, 240) || undefined,
      });
      setShowTariForm(false);
      setTNotice('');
      setTIssueDate('');
      setTDueDate('');
      setTTotal('');
      setTNote('');
    } finally {
      setTariSaving(false);
    }
  }

  async function handleSubmitGse(e: React.FormEvent) {
    e.preventDefault();
    if (!onAddGsePayment || !gDate.trim() || !gPeriod.trim()) return;
    setGseSaving(true);
    try {
      await onAddGsePayment({
        paymentDate: gDate.trim().slice(0, 20),
        year: Number(gYear) || new Date().getFullYear(),
        paymentType: gType,
        period: gPeriod.trim().slice(0, 80),
        amountEur: Number(gAmount.replace(',', '.')) || 0,
        kwhInjected: gKwh ? Number(gKwh.replace(',', '.')) : undefined,
        reference: gRef.trim().slice(0, 80) || undefined,
        note: gNote.trim().slice(0, 240) || undefined,
      });
      setShowGseForm(false);
      setGDate('');
      setGPeriod('');
      setGAmount('');
      setGKwh('');
      setGRef('');
      setGNote('');
    } finally {
      setGseSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sky-400" />
            Bollette, TARI &amp; Fotovoltaico GSE
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Archivio completo su Firebase: bollette auto da Gmail (Luce, TARI) e caricamento manuale semplice (Acqua, GSE Scambio sul Posto).
          </p>
        </div>

        <div className="inline-flex flex-wrap bg-slate-900 border border-slate-800 rounded-lg p-0.5 self-start sm:self-auto gap-0.5">
          <button
            type="button"
            onClick={() => setUtilityTab('luce')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              utilityTab === 'luce'
                ? 'bg-sky-500/20 text-sky-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Elettricità
          </button>
          <button
            type="button"
            onClick={() => setUtilityTab('acqua')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              utilityTab === 'acqua'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Droplets className="w-3.5 h-3.5" />
            Acqua
          </button>
          <button
            type="button"
            onClick={() => setUtilityTab('tari')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              utilityTab === 'tari'
                ? 'bg-amber-500/20 text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            TARI
          </button>
          <button
            type="button"
            onClick={() => setUtilityTab('gse')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              utilityTab === 'gse'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            Fotovoltaico / GSE
          </button>
        </div>
      </div>

      {/* TAB ACQUA */}
      {utilityTab === 'acqua' && (
        <div className="space-y-5">
          {/* Strategia di caricamento + Scheda fornitura Acqua */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 rounded-md">
                  Servizio Idrico · Padova
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-800 text-slate-300 border border-slate-700 rounded-md">
                  <PenLine className="w-3 h-3 text-amber-300" />
                  Caricamento manuale → Firebase
                </span>
                <span className="text-xs font-mono text-slate-400">
                  Contratto <span className="text-cyan-300">3040787553</span> · Cliente{' '}
                  <span className="text-slate-300">1014119052</span>
                </span>
              </div>

              {!readOnly && onAddWaterBill && (
                <button
                  type="button"
                  onClick={() => setShowWaterForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Registra bolletta acqua
                </button>
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                AcegasApsAmga — Servizio Acqua (Quadrimestrale)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Uso domestico residente (2 componenti) · Contatore{' '}
                <span className="font-mono text-slate-300">365230000000152556</span> · Addebito
                diretto ING · Prossima bolletta prevista:{' '}
                <span className="text-slate-200 font-medium">15/03/2027</span> (autolettura dal
                28/02 al 05/03/2027).
              </p>
            </div>
          </div>

          {showWaterForm && !readOnly && (
            <form
              onSubmit={handleSubmitWater}
              className="bg-slate-900 border border-cyan-500/40 rounded-xl p-4 space-y-3 text-xs"
            >
              <div className="font-semibold text-slate-100">
                Aggiungi bolletta Acqua AcegasApsAmga (salvata su Firebase)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  placeholder="N° Fattura (es. 712700123456)"
                  value={wInvoice}
                  onChange={(e) => setWInvoice(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Data emissione (es. 15/03/2027)"
                  value={wDate}
                  onChange={(e) => setWDate(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="number"
                  required
                  placeholder="Anno (es. 2027)"
                  value={wYear}
                  onChange={(e) => setWYear(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Periodo (es. Nov 26 – Mar 27)"
                  value={wPeriod}
                  onChange={(e) => setWPeriod(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Consumo m³ (es. 22)"
                  value={wMc}
                  onChange={(e) => setWMc(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Quota fissa € (es. 10.50)"
                  value={wFixed}
                  onChange={(e) => setWFixed(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Totale pagato € (es. 58.40)"
                  value={wTotal}
                  onChange={(e) => setWTotal(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Note (es. conguaglio reale)"
                  value={wNote}
                  onChange={(e) => setWNote(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowWaterForm(false)}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-100"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={waterSaving}
                  className="px-4 py-1.5 font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg"
                >
                  {waterSaving ? 'Salvataggio...' : 'Salva bolletta Acqua'}
                </button>
              </div>
            </form>
          )}

          {/* KPI Acqua */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Totale Pagato</div>
              <div className="text-lg font-bold font-mono text-slate-100 mt-0.5">
                {waterTotals.total.toFixed(2).replace('.', ',')} €
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Consumo Fatturato
              </div>
              <div className="text-lg font-bold font-mono text-cyan-300 mt-0.5">
                {waterTotals.mc.toFixed(1).replace('.', ',')} m³
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Costo Medio Reale
              </div>
              <div className="text-lg font-bold font-mono text-emerald-300 mt-0.5">
                {waterTotals.avgPerMc > 0
                  ? `${waterTotals.avgPerMc.toFixed(2).replace('.', ',')} €/m³`
                  : '—'}
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Bollette</div>
              <div className="text-lg font-bold font-mono text-slate-100 mt-0.5">
                {filteredWaterBills.length}
              </div>
            </div>
          </div>

          {/* Tabella Bollette Acqua */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">
                Storico Bollette Acqua ({filteredWaterBills.length})
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedWaterYear('all')}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    selectedWaterYear === 'all'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tutti
                </button>
                {waterYears.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setSelectedWaterYear(y)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      selectedWaterYear === y
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <SortableTh
                      sortKey="period"
                      currentSort={waterSort}
                      onSort={(k) => setWaterSort((prev) => toggleSort(prev, k, 'desc'))}
                      className="px-4 py-2.5 font-medium"
                    >
                      Periodo
                    </SortableTh>
                    <SortableTh
                      sortKey="invoice"
                      currentSort={waterSort}
                      onSort={(k) => setWaterSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Fattura
                    </SortableTh>
                    <SortableTh
                      sortKey="mc"
                      currentSort={waterSort}
                      onSort={(k) => setWaterSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-3 py-2.5 font-medium text-right"
                    >
                      Consumo (m³)
                    </SortableTh>
                    <SortableTh
                      sortKey="fixed"
                      currentSort={waterSort}
                      onSort={(k) => setWaterSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-3 py-2.5 font-medium text-right"
                    >
                      Quota Fissa
                    </SortableTh>
                    <SortableTh
                      sortKey="total"
                      currentSort={waterSort}
                      onSort={(k) => setWaterSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-4 py-2.5 font-medium text-right"
                    >
                      Totale Pagato
                    </SortableTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {sortedWaterBills.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-medium text-slate-100">
                        <div>{w.period}</div>
                        {w.note && <div className="text-[10px] text-slate-400">{w.note}</div>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-400">
                        <div>#{w.invoiceNumber}</div>
                        <div className="text-[10px]">{w.issueDate}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-cyan-300">
                        {w.cubicMeters.toFixed(1).replace('.', ',')} m³
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {w.fixedCostEur.toFixed(2).replace('.', ',')} €
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-100">
                        {w.totalPaid.toFixed(2).replace('.', ',')} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB TARI */}
      {utilityTab === 'tari' && (
        <div className="space-y-5">
          <div className="bg-slate-900/70 border border-amber-500/30 rounded-xl p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-md">
                  Tassa Rifiuti (TARI)
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-md">
                  <Mail className="w-3 h-3" />
                  Auto da Gmail + Manuale
                </span>
              </div>

              {!readOnly && onAddTariBill && (
                <button
                  type="button"
                  onClick={() => setShowTariForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Aggiungi avviso TARI
                </button>
              )}
            </div>

            <h2 className="text-base font-bold text-slate-100">
              AcegasApsAmga / TARI — Avvisi di Pagamento
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              <strong className="text-slate-200">Strategia automatica Gmail:</strong> ogni 15 minuti lo script GitHub Actions cerca nella tua casella Gmail le email da{' '}
              <span className="font-mono text-amber-300">tassa_rifiuti@acegasapsamga.it</span>{' '}
              con oggetto contenente{' '}
              <span className="font-mono text-slate-200">&quot;Avviso di pagamento TARI&quot;</span>, estrae importo, scadenza e numero documento dal PDF allegato (senza eliminare l&apos;email) e salva tutto in{' '}
              <span className="font-mono text-slate-300">data/bollette.json</span> + Firebase.
            </p>
          </div>

          {showTariForm && !readOnly && (
            <form
              onSubmit={handleSubmitTari}
              className="bg-slate-900 border border-amber-500/40 rounded-xl p-4 space-y-3 text-xs"
            >
              <div className="font-semibold text-slate-100">
                Registra manualmente avviso TARI (salvato su Firebase)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  placeholder="N° Avviso / Documento *"
                  value={tNotice}
                  onChange={(e) => setTNotice(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Periodo (es. TARI 2026 - Rata Unica)"
                  value={tPeriod}
                  onChange={(e) => setTPeriod(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
                <input
                  type="number"
                  required
                  placeholder="Anno (es. 2026)"
                  value={tYear}
                  onChange={(e) => setTYear(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Importo € (es. 285.00)"
                  value={tTotal}
                  onChange={(e) => setTTotal(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Data emissione (es. 10/05/2026)"
                  value={tIssueDate}
                  onChange={(e) => setTIssueDate(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Scadenza (es. 30/06/2026)"
                  value={tDueDate}
                  onChange={(e) => setTDueDate(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Ente / Fornitore"
                  value={tSupplier}
                  onChange={(e) => setTSupplier(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
                <label className="flex items-center gap-2 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tPaid}
                    onChange={(e) => setTPaid(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  Già pagato
                </label>
                <input
                  type="text"
                  placeholder="Note opzionali (es. F24 / PagoPA)"
                  value={tNote}
                  onChange={(e) => setTNote(e.target.value)}
                  className="sm:col-span-2 lg:col-span-4 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTariForm(false)}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-100"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={tariSaving}
                  className="px-4 py-1.5 font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg"
                >
                  {tariSaving ? 'Salvataggio...' : 'Salva avviso TARI'}
                </button>
              </div>
            </form>
          )}

          {/* KPI TARI */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Totale TARI</div>
              <div className="text-lg font-bold font-mono text-slate-100 mt-0.5">
                {tariTotals.total.toFixed(2).replace('.', ',')} €
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Avvisi Caricati</div>
              <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">
                {tariBills.length}
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Da Pagare</div>
              <div className="text-lg font-bold font-mono text-rose-300 mt-0.5">
                {tariTotals.unpaidCount}
              </div>
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-100">
                Storico Avvisi TARI ({tariBills.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <SortableTh
                      sortKey="period"
                      currentSort={tariSort}
                      onSort={(k) => setTariSort((prev) => toggleSort(prev, k, 'desc'))}
                      className="px-4 py-2.5 font-medium"
                    >
                      Periodo / Anno
                    </SortableTh>
                    <SortableTh
                      sortKey="notice"
                      currentSort={tariSort}
                      onSort={(k) => setTariSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      N° Avviso
                    </SortableTh>
                    <SortableTh
                      sortKey="due"
                      currentSort={tariSort}
                      onSort={(k) => setTariSort((prev) => toggleSort(prev, k, 'desc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Scadenza
                    </SortableTh>
                    <SortableTh
                      sortKey="source"
                      currentSort={tariSort}
                      onSort={(k) => setTariSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Origine
                    </SortableTh>
                    <SortableTh
                      sortKey="paid"
                      currentSort={tariSort}
                      onSort={(k) => setTariSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Stato
                    </SortableTh>
                    <SortableTh
                      sortKey="total"
                      currentSort={tariSort}
                      onSort={(k) => setTariSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-4 py-2.5 font-medium text-right"
                    >
                      Importo
                    </SortableTh>
                    {!readOnly && <th className="px-3 py-2.5 font-medium text-right">Azioni</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {sortedTariBills.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        Nessun avviso TARI ancora salvato. Appena arriva la prossima email da{' '}
                        <span className="font-mono text-slate-300">tassa_rifiuti@acegasapsamga.it</span>{' '}
                        verrà estratta automaticamente, oppure puoi inserirne una manualmente qui sopra.
                      </td>
                    </tr>
                  ) : (
                    sortedTariBills.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-medium text-slate-100">
                          <div>{t.period}</div>
                          {t.note && <div className="text-[10px] text-slate-400">{t.note}</div>}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-400">
                          <div>#{t.noticeNumber}</div>
                          <div className="text-[10px]">{t.issueDate}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-amber-300">{t.dueDate}</td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                            {t.source === 'gmail-pdf' ? 'Auto Gmail PDF' : 'Manuale'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            disabled={readOnly || !onToggleTariPaid}
                            onClick={() => onToggleTariPaid && void onToggleTariPaid(t)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                              t.paid
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {t.paid ? 'Pagato' : 'Da pagare'}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-100">
                          {t.totalPaid.toFixed(2).replace('.', ',')} €
                        </td>
                        {!readOnly && (
                          <td className="px-3 py-2.5 text-right">
                            {onDeleteTariBill && (
                              <button
                                type="button"
                                onClick={() => void onDeleteTariBill(t.id)}
                                className="p-1 text-slate-500 hover:text-rose-400"
                                aria-label="Elimina avviso TARI"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB FOTOVOLTAICO / GSE SCAMBIO SUL POSTO */}
      {utilityTab === 'gse' && (
        <div className="space-y-5">
          <div className="bg-slate-900/70 border border-emerald-500/30 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-md">
                  Fotovoltaico + Scambio sul Posto (SSP)
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-800 text-slate-300 border border-slate-700 rounded-md">
                  <PenLine className="w-3 h-3 text-amber-300" />
                  Inserimento manuale bonifici GSE → Firebase
                </span>
              </div>

              {!readOnly && onAddGsePayment && (
                <button
                  type="button"
                  onClick={() => setShowGseForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Registra bonifico GSE
                </button>
              )}
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-100">
                Inverter Huawei SUN2000-4KTL-L1 (4 kW) · Scambio sul Posto GSE
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Con lo <strong className="text-slate-200">Scambio sul Posto (SSP)</strong> il GSE rimborsa parte dell&apos;energia che immetti in rete rispetto a quella prelevata. I bonifici GSE seguono in genere <strong className="text-slate-200">2 acconti semestrali</strong> (giugno e novembre) e <strong className="text-slate-200">1 conguaglio annuale</strong> (maggio/giugno dell&apos;anno successivo). Questa sezione raccoglie ogni accredito GSE per sottrarlo mentalmente dalla spesa annua netta di casa.
              </p>
            </div>
          </div>

          {showGseForm && !readOnly && (
            <form
              onSubmit={handleSubmitGse}
              className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 space-y-3 text-xs"
            >
              <div className="font-semibold text-slate-100">
                Registra nuovo bonifico GSE Scambio sul Posto (salvato su Firebase)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Data accredito (es. 18/06/2026)"
                  value={gDate}
                  onChange={(e) => setGDate(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="number"
                  required
                  placeholder="Anno di competenza"
                  value={gYear}
                  onChange={(e) => setGYear(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <select
                  value={gType}
                  onChange={(e) => setGType(e.target.value as GsePaymentType)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 [color-scheme:dark]"
                >
                  <option value="acconto">Acconto semestrale SSP</option>
                  <option value="conguaglio">Conguaglio annuale SSP</option>
                  <option value="altro">Altro accredito GSE</option>
                </select>
                <input
                  type="text"
                  required
                  placeholder="Periodo (es. 1° Acconto 2026)"
                  value={gPeriod}
                  onChange={(e) => setGPeriod(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Importo bonifico € (es. 142.50)"
                  value={gAmount}
                  onChange={(e) => setGAmount(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="kWh immessi (opzionale)"
                  value={gKwh}
                  onChange={(e) => setGKwh(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Riferimento / CRO / Pratica SSP (opz.)"
                  value={gRef}
                  onChange={(e) => setGRef(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Note opzionali"
                  value={gNote}
                  onChange={(e) => setGNote(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGseForm(false)}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-100"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={gseSaving}
                  className="px-4 py-1.5 font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg"
                >
                  {gseSaving ? 'Salvataggio...' : 'Salva bonifico GSE'}
                </button>
              </div>
            </form>
          )}

          {/* KPI Fotovoltaico / GSE */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Totale Incassato GSE
              </div>
              <div className="text-lg font-bold font-mono text-emerald-300 mt-0.5">
                +{gseTotals.totalEur.toFixed(2).replace('.', ',')} €
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Bonifici Registrati
              </div>
              <div className="text-lg font-bold font-mono text-slate-100 mt-0.5">
                {gsePayments.length}
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                kWh Immessi Segnati
              </div>
              <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">
                {gseTotals.totalKwh > 0 ? `${gseTotals.totalKwh} kWh` : '—'}
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Inverter</div>
              <div className="text-sm font-bold font-mono text-sky-300 mt-1">
                Huawei SUN2000-4KTL-L1
              </div>
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-100">
                Storico Bonifici GSE — Scambio sul Posto ({gsePayments.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <SortableTh
                      sortKey="date"
                      currentSort={gseSort}
                      onSort={(k) => setGseSort((prev) => toggleSort(prev, k, 'desc'))}
                      className="px-4 py-2.5 font-medium"
                    >
                      Data Bonifico
                    </SortableTh>
                    <SortableTh
                      sortKey="type"
                      currentSort={gseSort}
                      onSort={(k) => setGseSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Tipo
                    </SortableTh>
                    <SortableTh
                      sortKey="period"
                      currentSort={gseSort}
                      onSort={(k) => setGseSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Periodo
                    </SortableTh>
                    <SortableTh
                      sortKey="reference"
                      currentSort={gseSort}
                      onSort={(k) => setGseSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Riferimento
                    </SortableTh>
                    <SortableTh
                      sortKey="kwh"
                      currentSort={gseSort}
                      onSort={(k) => setGseSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-3 py-2.5 font-medium text-right"
                    >
                      kWh Immessi
                    </SortableTh>
                    <SortableTh
                      sortKey="amount"
                      currentSort={gseSort}
                      onSort={(k) => setGseSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-4 py-2.5 font-medium text-right"
                    >
                      Importo Ricevuto
                    </SortableTh>
                    {!readOnly && <th className="px-3 py-2.5 font-medium text-right">Azioni</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {sortedGsePayments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        Nessun bonifico GSE ancora registrato. Quando ricevi un acconto o conguaglio Scambio sul Posto in banca, premi{' '}
                        <strong className="text-slate-300">Registra bonifico GSE</strong> qui sopra per salvarlo su Firebase.
                      </td>
                    </tr>
                  ) : (
                    sortedGsePayments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-mono text-slate-200">{p.paymentDate}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              p.paymentType === 'conguaglio'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {p.paymentType === 'acconto'
                              ? 'Acconto SSP'
                              : p.paymentType === 'conguaglio'
                                ? 'Conguaglio SSP'
                                : 'Altro GSE'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-200">
                          <div>{p.period}</div>
                          {p.note && <div className="text-[10px] text-slate-400">{p.note}</div>}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-400">
                          {p.reference || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-amber-300">
                          {p.kwhInjected ? `${p.kwhInjected} kWh` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-300">
                          +{p.amountEur.toFixed(2).replace('.', ',')} €
                        </td>
                        {!readOnly && (
                          <td className="px-3 py-2.5 text-right">
                            {onDeleteGsePayment && (
                              <button
                                type="button"
                                onClick={() => void onDeleteGsePayment(p.id)}
                                className="p-1 text-slate-500 hover:text-rose-400"
                                aria-label="Elimina bonifico GSE"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB ELETTRICITA */}
      {utilityTab === 'luce' && (
        <div className="space-y-5">
          {/* Banner Strategia Caricamento Luce */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-300">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-md">
                <Mail className="w-3 h-3" />
                Sync automatico Gmail
              </span>
              <span>
                Estrazione PDF automatica da <span className="font-mono text-sky-300">fatturazione@edisonenergia.it</span> ogni 15 min + salvataggio su Firebase (le email non vengono eliminate).
              </span>
            </div>

            {!readOnly && onAddElectricityBill && (
              <button
                type="button"
                onClick={() => setShowElecForm((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Inserisci bolletta manuale
              </button>
            )}
          </div>

          {showElecForm && !readOnly && (
            <form
              onSubmit={handleSubmitElec}
              className="bg-slate-900 border border-sky-500/40 rounded-xl p-4 space-y-3 text-xs"
            >
              <div className="font-semibold text-slate-100">
                Inserimento manuale bolletta luce (es. nuova fattura Octopus Energy)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  placeholder="N° Fattura *"
                  value={eInvoice}
                  onChange={(e) => setEInvoice(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Data emissione (DD/MM/YYYY) *"
                  value={eDate}
                  onChange={(e) => setEDate(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Periodo (es. Gen 2027) *"
                  value={ePeriod}
                  onChange={(e) => setEPeriod(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Fornitore"
                  value={eSupplier}
                  onChange={(e) => setESupplier(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Offerta"
                  value={eOffer}
                  onChange={(e) => setEOffer(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="kWh fatturati *"
                  value={eKwh}
                  onChange={(e) => setEKwh(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  required
                  placeholder="Totale pagato € *"
                  value={eTotal}
                  onChange={(e) => setETotal(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Canone TV € (0 se assente)"
                  value={eCanone}
                  onChange={(e) => setECanone(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-slate-100"
                />
                <input
                  type="text"
                  placeholder="Note opzionali"
                  value={eNote}
                  onChange={(e) => setENote(e.target.value)}
                  className="sm:col-span-2 lg:col-span-4 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowElecForm(false)}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-100"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={elecSaving}
                  className="px-4 py-1.5 font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg"
                >
                  {elecSaving ? 'Salvataggio...' : 'Salva bolletta Luce'}
                </button>
              </div>
            </form>
          )}

          {/* Riepilogo reale per Fornitore / Offerta */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {offerSummaries.map((item) => (
              <div
                key={item.key}
                className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3 min-w-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded-md">
                        Anno {item.year}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {item.billCount} {item.billCount === 1 ? 'bolletta reale' : 'bollette reali'}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-100 mt-1.5">
                      {item.supplier} — {item.offerName}
                    </h2>
                    {item.supplier.toLowerCase().includes('edison') && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Mercato Libero · Variabile (PUN Index GME) · 6 kW
                        {item.year === 2026 ? ' · Scadenza condizioni: 07/01/2027' : ''}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Materia Prima (PUN)
                    </div>
                    <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5">
                      ~{item.avgVariablePerKwh.toFixed(3).replace('.', ',')} €/kWh
                    </div>
                    <div className="text-[10px] text-slate-500">variabile · segue il PUN</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Fisso Fornitore
                    </div>
                    <div className="text-sm font-bold font-mono text-sky-300 mt-0.5">
                      {item.supplier.toLowerCase().includes('edison') ? '8,33 €/mese' : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {item.supplier.toLowerCase().includes('edison')
                        ? '100 €/anno (+28 €/a vs Octopus)'
                        : 'commercializzazione'}
                    </div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Costo Reale / kWh
                    </div>
                    <div className="text-sm font-bold font-mono text-violet-300 mt-0.5">
                      {item.avgRealPerKwh.toFixed(3).replace('.', ',')} €/kWh
                    </div>
                    <div className="text-[10px] text-slate-500">tutto incluso · no TV</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Speso Solo Luce
                    </div>
                    <div className="text-sm font-bold font-mono text-slate-100 mt-0.5">
                      {item.totalElectricityOnly.toFixed(2).replace('.', ',')} €
                    </div>
                    <div className="text-[10px] text-slate-500">{item.totalKwh} kWh</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Media Mensile
                    </div>
                    <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">
                      {(item.totalElectricityOnly / Math.max(1, item.billCount * 2)).toFixed(0)}{' '}
                      €/mese
                    </div>
                    <div className="text-[10px] text-slate-500">
                      su {item.billCount} {item.billCount === 1 ? 'bolletta' : 'bollette'} bimestrali
                    </div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Scadenza / Vincoli
                    </div>
                    <div className="text-sm font-bold font-mono text-slate-200 mt-0.5">
                      {item.year === 2026 ? '07/01/2027' : 'Concluso'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {item.year === 2026 ? '0 € penali recesso' : `anno ${item.year}`}
                    </div>
                  </div>
                </div>

                {item.supplier.toLowerCase().includes('edison') && (
                  <p className="text-[11px] text-slate-400 leading-relaxed pt-2 border-t border-slate-800/80">
                    Tariffa <strong className="text-slate-200">variabile</strong> legata al <strong className="text-slate-200">PUN</strong>, più dispacciamento (~0,015 €/kWh) e oneri/imposte di legge.
                  </p>
                )}
              </div>
            ))}

            {!offerSummaries.some((o) => o.supplier.toLowerCase().includes('octopus')) && (
              <div className="bg-slate-900/70 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-md">
                        Prossima · 2027 (24 mesi)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Prezzo Fisso · Fatturazione Mensile
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-100 mt-1.5">
                      Octopus Energy — Octopus Fissa 24M
                    </h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Cod. <span className="font-mono text-slate-300">OCTOFIX24v09</span> · 100% rinnovabile · DispBT gratuito · 0 € penali di recesso
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Materia Prima (Fissa)
                    </div>
                    <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5">
                      0,1595 €/kWh
                    </div>
                    <div className="text-[10px] text-slate-500">bloccato 24m · no PUN</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Fisso Fornitore
                    </div>
                    <div className="text-sm font-bold font-mono text-sky-300 mt-0.5">
                      6,00 €/mese
                    </div>
                    <div className="text-[10px] text-slate-500">72 €/anno (-28 €/a vs Edison)</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Costo Reale / kWh
                    </div>
                    <div className="text-sm font-bold font-mono text-violet-300 mt-0.5">
                      ~{octopusEstimate.allInPerKwh.toFixed(3).replace('.', ',')} €/kWh
                    </div>
                    <div className="text-[10px] text-slate-500">stima tutto incluso · no TV</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Speso Solo Luce
                    </div>
                    <div className="text-sm font-bold font-mono text-slate-400 mt-0.5">
                      In attesa
                    </div>
                    <div className="text-[10px] text-slate-500">bollette 2027 · SDD</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Media Mensile
                    </div>
                    <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">
                      {octopusEstimate.monthlyEur !== null
                        ? `~${octopusEstimate.monthlyEur.toFixed(0)} €/mese`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500">stima ai tuoi consumi</div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Scadenza / Vincoli
                    </div>
                    <div className="text-sm font-bold font-mono text-slate-200 mt-0.5">
                      24 mesi
                    </div>
                    <div className="text-[10px] text-slate-500">0 € penali · ribasso libero</div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <strong className="text-slate-200">0,1595 €/kWh non è il PUN</strong>: è il prezzo fisso della materia prima energia (perdite incluse), bloccato per <strong className="text-slate-200">24 mesi</strong>. Si aggiungono solo i 6 €/mese di commercializzazione, il dispacciamento (0,0146 €/kWh) e gli oneri/imposte di legge.
                </p>

                <div className="space-y-2 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>
                        Monitor automatico ogni <strong className="text-slate-100">15 minuti</strong> (Octopus + altri fornitori) vs tua{' '}
                        <span className="font-mono text-emerald-300">
                          {marketMonitor.myLockedRate.toFixed(4).replace('.', ',')} €/kWh
                        </span>
                      </span>
                    </div>
                    {marketMonitor.currentRate !== null && (
                      <span className="font-mono text-[11px] text-slate-400">
                        Octopus oggi:{' '}
                        <strong
                          className={
                            marketMonitor.currentRate < marketMonitor.myLockedRate
                              ? 'text-emerald-300'
                              : 'text-amber-300'
                          }
                        >
                          {marketMonitor.currentRate.toFixed(4).replace('.', ',')} €/kWh
                        </strong>
                      </span>
                    )}
                  </div>

                  {marketMonitor.competitors.length > 0 && (
                    <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-slate-400">
                        <span>Confronto Altri Fornitori (stima annua su 2.300 kWh + PCV)</span>
                        <span className="font-mono text-slate-300">
                          Tuo benchmark: {myAnnualBenchmarkEur.toFixed(0)} €/anno
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {marketMonitor.competitors.map((comp) => {
                          const isCheaper =
                            comp.estAnnualEur !== null && comp.estAnnualEur < myAnnualBenchmarkEur - 5;
                          return (
                            <a
                              key={comp.supplier}
                              href={comp.url}
                              target="_blank"
                              rel="noreferrer"
                              className={`flex items-center justify-between gap-2 px-2 py-1 rounded border transition-colors ${
                                isCheaper
                                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                                  : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              <span className="truncate">
                                <strong>{comp.supplier}</strong>{' '}
                                <span className="text-[10px] text-slate-400">{comp.offerName}</span>
                              </span>
                              <span className="font-mono text-[11px] shrink-0">
                                {comp.rateEurKwh !== null
                                  ? `${comp.rateEurKwh.toFixed(4).replace('.', ',')} €`
                                  : 'N/D'}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                      {marketMonitor.bestCompetitor &&
                        marketMonitor.bestCompetitor.estAnnualEur !== null &&
                        marketMonitor.bestCompetitor.estAnnualEur < myAnnualBenchmarkEur - 5 && (
                          <div className="text-[11px] text-emerald-300 font-medium">
                            Offerta migliore rilevata: {marketMonitor.bestCompetitor.supplier} a{' '}
                            {marketMonitor.bestCompetitor.rateEurKwh?.toFixed(4).replace('.', ',')} €/kWh!
                          </div>
                        )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Storico Bollette Reali */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Storico Bollette Luce ({filteredBills.length})
                </h3>
                <p className="text-[11px] text-slate-400">
                  Aggiornate automaticamente dai PDF ricevuti via email su Gmail.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedBillYear('all')}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    selectedBillYear === 'all'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tutti
                </button>
                {billYears.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setSelectedBillYear(y)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      selectedBillYear === y
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>

            {/* KPI Bollette */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-slate-800/80 bg-slate-950/30">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Totale Pagato
                </div>
                <div className="text-base font-bold font-mono text-slate-100 mt-0.5">
                  {billsTotals.total.toFixed(2).replace('.', ',')} €
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Solo Luce</div>
                <div className="text-base font-bold font-mono text-sky-300 mt-0.5">
                  {billsTotals.elec.toFixed(2).replace('.', ',')} €
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Canone TV</div>
                <div className="text-base font-bold font-mono text-amber-300 mt-0.5">
                  {billsTotals.tv.toFixed(2).replace('.', ',')} €
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  kWh / Media Reale
                </div>
                <div className="text-base font-bold font-mono text-emerald-300 mt-0.5">
                  {billsTotals.kwh} kWh · {billsTotals.avgElecPerKwh.toFixed(2).replace('.', ',')}{' '}
                  €/kWh
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <SortableTh
                      sortKey="period"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'desc'))}
                      className="px-4 py-2.5 font-medium"
                    >
                      Periodo
                    </SortableTh>
                    <SortableTh
                      sortKey="supplier"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Fornitore
                    </SortableTh>
                    <SortableTh
                      sortKey="invoice"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'asc'))}
                      className="px-3 py-2.5 font-medium"
                    >
                      Fattura
                    </SortableTh>
                    <SortableTh
                      sortKey="kwh"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-3 py-2.5 font-medium text-right"
                    >
                      kWh
                    </SortableTh>
                    <SortableTh
                      sortKey="pun"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-3 py-2.5 font-medium text-right"
                    >
                      PUN
                    </SortableTh>
                    <SortableTh
                      sortKey="elecOnly"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-3 py-2.5 font-medium text-right"
                    >
                      Solo Luce
                    </SortableTh>
                    <SortableTh
                      sortKey="tv"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-3 py-2.5 font-medium text-right"
                    >
                      Canone TV
                    </SortableTh>
                    <SortableTh
                      sortKey="total"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-4 py-2.5 font-medium text-right"
                    >
                      Totale
                    </SortableTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {sortedElecBills.map((b) => (
                    <tr key={b.invoiceNumber} className="hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-medium text-slate-100">
                        <div>{b.period}</div>
                        {b.note && <div className="text-[10px] text-emerald-400">{b.note}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">
                        <div>{b.supplier}</div>
                        <div className="text-[10px] text-slate-500">{b.offerName}</div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-400">
                        <div>#{b.invoiceNumber}</div>
                        <div className="text-[10px]">{b.issueDate}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-200">{b.kwh}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {b.punText}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-sky-300">
                        {b.electricityOnly.toFixed(2).replace('.', ',')} €
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-amber-300">
                        {b.canoneTv.toFixed(2).replace('.', ',')} €
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-100">
                        {b.totalPaid.toFixed(2).replace('.', ',')} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Guida semplice alla bolletta */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2 mb-3">
              <HelpCircle className="w-4 h-4 text-sky-400" />
              La tua bolletta in parole semplici
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300 leading-relaxed">
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                <div className="font-semibold text-sky-300 mb-1">1. Prezzo Energia (PUN vs Fisso)</div>
                <p className="text-slate-400">
                  Il <strong className="text-slate-200">PUN</strong> è il prezzo all&apos;ingrosso della luce in Italia (cambia ogni mese). Con Edison 2026 la tariffa è monoraria (stesso prezzo giorno e notte) e variabile sul PUN; con una tariffa fissa invece blocchi il prezzo per 12–24 mesi.
                </p>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                <div className="font-semibold text-emerald-300 mb-1">2. Costi Fissi (33,35 €/mese)</div>
                <p className="text-slate-400">
                  Anche a 0 kWh paghi <strong className="text-slate-200">24,35 €/mese</strong> di luce (fisso fornitore + rete + potenza 6 kW, IVA incl.) + <strong className="text-slate-200">9,00 €/mese</strong> di Canone TV. Quando cambi fornitore cambia solo la quota fissa del fornitore.
                </p>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                <div className="font-semibold text-amber-300 mb-1">3. Cosa NON cambia mai</div>
                <p className="text-slate-400">
                  <strong className="text-slate-200">Canone TV</strong> (90 €/anno in 10 rate da 9 €) e <strong className="text-slate-200">costi di rete/potenza 6 kW</strong> sono fissati dallo Stato/ARERA: restano identici con qualsiasi fornitore.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
