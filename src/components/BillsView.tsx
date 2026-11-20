import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Droplets,
  HelpCircle,
  Receipt,
  Zap,
} from 'lucide-react';
import { BillRecord, EnergyReading, WaterBillRecord } from '../types/home';

interface BillsViewProps {
  readings: EnergyReading[];
  readOnly?: boolean;
}

const REAL_WATER_BILLS: WaterBillRecord[] = [
  {
    id: 'acegas-722500018753',
    invoiceNumber: '722500018753',
    issueDate: '28/02/2025',
    year: 2025,
    period: 'Feb 2025 (Attivazione)',
    cubicMeters: 0,
    fixedCostEur: 41.97,
    totalPaid: 46.17,
    note: 'Attivazione contatore con installo (una tantum)',
  },
  {
    id: 'acegas-712501028617',
    invoiceNumber: '712501028617',
    issueDate: '14/11/2025',
    year: 2025,
    period: '19 Ago – 12 Nov 2025',
    cubicMeters: 23,
    fixedCostEur: 7.01,
    totalPaid: 60.94,
    note: 'Acconto stimato (86 gg)',
  },
  {
    id: 'acegas-712600216248',
    invoiceNumber: '712600216248',
    issueDate: '13/03/2026',
    year: 2026,
    period: 'Nov 25 – Mar 26',
    cubicMeters: 5,
    fixedCostEur: 9.95,
    totalPaid: 21.63,
    note: 'Conguaglio (25 m³ reali) + 6 € copertura dispersioni idriche',
  },
  {
    id: 'acegas-712600627713',
    invoiceNumber: '712600627713',
    issueDate: '13/07/2026',
    year: 2026,
    period: '12 Mar – 10 Lug 2026',
    cubicMeters: 20,
    fixedCostEur: 10.27,
    totalPaid: 55.57,
    note: 'Acconto stimato (121 gg)',
  },
  {
    id: 'acegas-712601057264',
    invoiceNumber: '712601057264',
    issueDate: '13/11/2026',
    year: 2026,
    period: 'Lug – Nov 2026',
    cubicMeters: 18,
    fixedCostEur: 10.51,
    totalPaid: 50.47,
    note: 'Conguaglio (27 m³ reali) + acconto · Prossima bolletta: 15/03/2027',
  },
];

const FALLBACK_ELECTRICITY_BILLS: BillRecord[] = [
  {
    invoiceNumber: '6091755057',
    issueDate: '18/02/2025',
    sortKey: '2025-01',
    year: 2025,
    period: 'Gen 2025 (Attivazione)',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 2,
    punText: '0,143 €',
    variableCostPerKwh: 0.28,
    canoneTv: 0,
    electricityOnly: 290.26,
    totalPaid: 290.26,
    note: 'Include costi attivazione/aumento potenza 6 kW (248,16 € + IVA)',
  },
  {
    invoiceNumber: '6094158920',
    issueDate: '17/04/2025',
    sortKey: '2025-02',
    year: 2025,
    period: 'Feb – Mar 2025',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 396,
    punText: '0,150 / 0,121 €',
    variableCostPerKwh: 0.291,
    canoneTv: 28.14,
    electricityOnly: 165.83,
    totalPaid: 193.97,
  },
  {
    invoiceNumber: '6096647320',
    issueDate: '17/06/2025',
    sortKey: '2025-04',
    year: 2025,
    period: 'Apr – Mag 2025',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 62,
    punText: '0,100 / 0,094 €',
    variableCostPerKwh: 0.232,
    canoneTv: 18.76,
    electricityOnly: 53.77,
    totalPaid: 72.53,
    note: 'Include sconto Spendi&Riprendi -10,00 € (+IVA)',
  },
  {
    invoiceNumber: '6099082878',
    issueDate: '18/08/2025',
    sortKey: '2025-06',
    year: 2025,
    period: 'Giu – Lug 2025',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 231,
    punText: '0,123 / 0,124 €',
    variableCostPerKwh: 0.258,
    canoneTv: 18.76,
    electricityOnly: 98.27,
    totalPaid: 117.03,
    note: 'Include sconto Spendi&Riprendi -10,00 € (+IVA)',
  },
  {
    invoiceNumber: '6101266591',
    issueDate: '14/10/2025',
    sortKey: '2025-08',
    year: 2025,
    period: 'Ago – Set 2025',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 170,
    punText: '0,120 €',
    variableCostPerKwh: 0.264,
    canoneTv: 18.76,
    electricityOnly: 93.64,
    totalPaid: 112.4,
  },
  {
    invoiceNumber: '6103995031',
    issueDate: '15/12/2025',
    sortKey: '2025-10',
    year: 2025,
    period: 'Ott – Nov 2025',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 405,
    punText: '0,122 / 0,129 €',
    variableCostPerKwh: 0.265,
    canoneTv: 0,
    electricityOnly: 153.75,
    totalPaid: 153.75,
  },
  {
    invoiceNumber: '6106606060',
    issueDate: '16/02/2026',
    sortKey: '2026-01',
    year: 2026,
    period: 'Dic 25 – Gen 26',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 754,
    punText: '0,127 / 0,146 €',
    variableCostPerKwh: 0.272,
    canoneTv: 18,
    electricityOnly: 255.32,
    totalPaid: 273.32,
  },
  {
    invoiceNumber: '6109009993',
    issueDate: '14/04/2026',
    sortKey: '2026-03',
    year: 2026,
    period: 'Feb – Mar 2026',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 426,
    punText: '0,126 / 0,158 €',
    variableCostPerKwh: 0.274,
    canoneTv: 18,
    electricityOnly: 164.76,
    totalPaid: 182.76,
  },
  {
    invoiceNumber: '6111444860',
    issueDate: '11/06/2026',
    sortKey: '2026-05',
    year: 2026,
    period: 'Apr – Mag 2026',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 190,
    punText: '0,131 €',
    variableCostPerKwh: 0.261,
    canoneTv: 18,
    electricityOnly: 65.31,
    totalPaid: 83.31,
    note: 'Include sconto Spendi&Riprendi -30,00 € (+IVA)',
  },
  {
    invoiceNumber: '6113821093',
    issueDate: '11/08/2026',
    sortKey: '2026-07',
    year: 2026,
    period: 'Giu – Lug 2026',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 244,
    punText: '0,146 / 0,173 €',
    variableCostPerKwh: 0.301,
    canoneTv: 18,
    electricityOnly: 122.09,
    totalPaid: 140.09,
  },
  {
    invoiceNumber: '6116408117',
    issueDate: '13/10/2026',
    sortKey: '2026-09',
    year: 2026,
    period: 'Ago – Set 2026',
    supplier: 'Edison Energia',
    offerName: 'EDISON DYNAMIC LUCE',
    kwh: 313,
    punText: '0,198 / 0,228 €',
    variableCostPerKwh: 0.359,
    canoneTv: 18,
    electricityOnly: 160.99,
    totalPaid: 178.99,
  },
];

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

export function BillsView(_props: BillsViewProps) {
  const [utilityTab, setUtilityTab] = useState<'luce' | 'acqua'>('luce');
  const [bills, setBills] = useState<BillRecord[]>(FALLBACK_ELECTRICITY_BILLS);
  const [selectedBillYear, setSelectedBillYear] = useState<string>('all');
  const [selectedWaterYear, setSelectedWaterYear] = useState<string>('all');
  const [octopusMonitor, setOctopusMonitor] = useState<{
    myLockedRate: number;
    currentRate: number | null;
    updatedAt: string | null;
  }>({
    myLockedRate: 0.1595,
    currentRate: 0.1727,
    updatedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    const loadOctopusMonitor = async () => {
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
            setOctopusMonitor({
              myLockedRate: json.myLockedRate,
              currentRate: typeof json.currentRate === 'number' ? json.currentRate : null,
              updatedAt: json.updatedAt ?? null,
            });
            return;
          }
        } catch {
          // try next url
        }
      }
    };
    loadOctopusMonitor();
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
          if (!cancelled && Array.isArray(json?.bills) && json.bills.length > 0) {
            setBills(json.bills);
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

  // Raggruppa automaticamente le bollette reali per (anno, fornitore, offerta) per il confronto reale tra fornitori
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

  // Stima realistica tutto-incluso per Octopus basata sui consumi e sugli oneri reali delle ultime bollette Edison
  const octopusEstimate = useMemo(() => {
    const ref = offerSummaries[0];
    if (!ref || ref.totalKwh <= 0) {
      return { allInPerKwh: 0.285, monthlyEur: null as number | null };
    }
    const monthsCovered = Math.max(1, ref.billCount * 2); // bollette Edison bimestrali
    const avgMonthlyKwh = ref.totalKwh / monthsCovered;
    const overheadPerKwh = Math.max(0.08, ref.avgRealPerKwh - ref.avgVariablePerKwh);
    const fixedFeeSavingPerKwh = (8.33 - 6.0) / Math.max(50, avgMonthlyKwh);
    const allInPerKwh = Math.max(
      octopusMonitor.myLockedRate,
      octopusMonitor.myLockedRate + overheadPerKwh - fixedFeeSavingPerKwh
    );
    return {
      allInPerKwh,
      monthlyEur: allInPerKwh * avgMonthlyKwh,
    };
  }, [offerSummaries, octopusMonitor.myLockedRate]);

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
    () => Array.from(new Set(REAL_WATER_BILLS.map((b) => String(b.year)))).sort().reverse(),
    []
  );

  const filteredWaterBills = useMemo(() => {
    return selectedWaterYear === 'all'
      ? REAL_WATER_BILLS
      : REAL_WATER_BILLS.filter((b) => String(b.year) === selectedWaterYear);
  }, [selectedWaterYear]);

  const waterTotals = useMemo(() => {
    const mc = filteredWaterBills.reduce((s, b) => s + b.cubicMeters, 0);
    const total = filteredWaterBills.reduce((s, b) => s + b.totalPaid, 0);
    return {
      mc,
      total,
      avgPerMc: mc > 0 ? total / mc : 0,
    };
  }, [filteredWaterBills]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sky-400" />
            Bollette Reali
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Tutti i dati sono estratti esclusivamente dalle tue bollette reali di Luce e Acqua.
          </p>
        </div>

        <div className="inline-flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 self-start sm:self-auto">
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
        </div>
      </div>

      {utilityTab === 'acqua' ? (
        <div className="space-y-5">
          {/* Scheda fornitura Acqua */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 rounded-md">
                Servizio Idrico · Padova
              </span>
              <span className="text-xs font-mono text-slate-400">
                Contratto <span className="text-cyan-300">3040787553</span> · Cliente{' '}
                <span className="text-slate-300">1014119052</span>
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-1.5">
              AcegasApsAmga — Servizio Acqua (Quadrimestrale)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Uso domestico residente (2 componenti) · Contatore{' '}
              <span className="font-mono text-slate-300">365230000000152556</span> · Addebito
              diretto ING · Prossima bolletta prevista:{' '}
              <span className="text-slate-200 font-medium">15/03/2027</span> (autolettura dal
              28/02 al 05/03/2027).
            </p>
          </div>

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
                    <th className="px-4 py-2.5 font-medium">Periodo</th>
                    <th className="px-3 py-2.5 font-medium">Fattura</th>
                    <th className="px-3 py-2.5 font-medium text-right">Consumo (m³)</th>
                    <th className="px-3 py-2.5 font-medium text-right">Quota Fissa</th>
                    <th className="px-4 py-2.5 font-medium text-right">Totale Pagato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredWaterBills.map((w) => (
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
      ) : (
        <div className="space-y-5">
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
                    <div className="text-[10px] text-slate-500">
                      {item.totalKwh} kWh
                    </div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Media Mensile
                    </div>
                    <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">
                      {(item.totalElectricityOnly / Math.max(1, item.billCount * 2))
                        .toFixed(0)}{' '}
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

            {!offerSummaries.some((o) =>
              o.supplier.toLowerCase().includes('octopus')
            ) && (
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

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>
                      Controllo automatico ogni <strong className="text-slate-100">30 minuti</strong> su{' '}
                      <a
                        href="https://octopusenergy.it/offerta/tariffe"
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:underline"
                      >
                        octopusenergy.it
                      </a>
                      : avviso email se scende sotto{' '}
                      <span className="font-mono text-emerald-300">
                        {octopusMonitor.myLockedRate.toFixed(4).replace('.', ',')} €/kWh
                      </span>
                    </span>
                  </div>
                  {octopusMonitor.currentRate !== null && (
                    <span className="font-mono text-[11px] text-slate-400">
                      Attuale:{' '}
                      <strong
                        className={
                          octopusMonitor.currentRate < octopusMonitor.myLockedRate
                            ? 'text-emerald-300'
                            : 'text-amber-300'
                        }
                      >
                        {octopusMonitor.currentRate.toFixed(4).replace('.', ',')} €/kWh
                      </strong>
                    </span>
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
                    <th className="px-4 py-2.5 font-medium">Periodo</th>
                    <th className="px-3 py-2.5 font-medium">Fornitore</th>
                    <th className="px-3 py-2.5 font-medium">Fattura</th>
                    <th className="px-3 py-2.5 font-medium text-right">kWh</th>
                    <th className="px-3 py-2.5 font-medium text-right">PUN</th>
                    <th className="px-3 py-2.5 font-medium text-right">Solo Luce</th>
                    <th className="px-3 py-2.5 font-medium text-right">Canone TV</th>
                    <th className="px-4 py-2.5 font-medium text-right">Totale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredBills.map((b) => (
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
                  Il <strong className="text-slate-200">PUN</strong> è il prezzo all&apos;ingrosso della luce in Italia (cambia ogni mese). Con Edison 2026 la tariffa è monoraria (stesso prezzo giorno e notte) e variabile sul PUN; con una tariffa fissa invece blocchi il prezzo per 12 mesi.
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
