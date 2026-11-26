import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Download,
  Droplets,
  ExternalLink,
  FileUp,
  HelpCircle,
  Mail,
  Paperclip,
  PenLine,
  Pencil,
  Plus,
  Receipt,
  Share2,
  Sun,
  Trash2,
  Zap,
} from 'lucide-react';
import { BillImportModal } from './BillImportModal';
import { ShareSheetModal } from './ShareSheetModal';
import { AccessUnlockBanner } from './AccessUnlockBanner';
import {
  buildElectricityBillSharePayload,
  buildTariBillSharePayload,
  buildWaterBillSharePayload,
  downloadShareableItem,
  deleteVaultFiles,
  getElectricityBillFileKey,
  getTariBillFileKey,
  getWaterBillFileKey,
  isOctopusContractRecord,
  listVaultFileMetadata,
  saveVaultFile,
  ShareableItemPayload,
  VAULT_UPDATED_EVENT,
  VaultFileMeta,
} from '../utils/documentVault';
import {
  BillRecord,
  EnergyReading,
  GsePaymentRecord,
  SupplierMarketOffer,
  TariBillRecord,
  WaterBillRecord,
} from '../types/home';
import {
  compareSortValues,
  parseFirstPunNumber,
  parseItDateToIso,
  SortableTh,
  SortState,
  toggleSort,
} from './SortableHeader';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

interface BillsViewProps {
  readings: EnergyReading[];
  electricityBills?: BillRecord[];
  waterBills?: WaterBillRecord[];
  tariBills?: TariBillRecord[];
  gsePayments?: GsePaymentRecord[];
  readOnly?: boolean;
  isGmailConnected?: boolean;
  onSignIn?: () => void;
  onConnectGmail?: () => void;
  onAddElectricityBill?: (bill: BillRecord, pdfFile?: File) => Promise<void>;
  onDeleteElectricityBill?: (bill: BillRecord) => Promise<void>;
  onClearAllBills?: () => Promise<void>;
  onAddWaterBill?: (bill: Omit<WaterBillRecord, 'id'>, pdfFile?: File) => Promise<void>;
  onAddTariBill?: (bill: Omit<TariBillRecord, 'id'>, pdfFile?: File) => Promise<void>;
  onToggleTariPaid?: (bill: TariBillRecord) => Promise<void>;
  onDeleteTariBill?: (id: string) => Promise<void>;
  onAddGsePayment?: (payment: Omit<GsePaymentRecord, 'id'>) => Promise<void>;
  onDeleteGsePayment?: (id: string) => Promise<void>;
  onUpdateGsePayment?: (id: string, payment: Omit<GsePaymentRecord, 'id'>) => Promise<void>;
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
  isGmailConnected = false,
  onSignIn,
  onConnectGmail,
  onAddElectricityBill,
  onDeleteElectricityBill,
  onClearAllBills,
  onAddWaterBill,
  onAddTariBill,
  onToggleTariPaid,
  onDeleteTariBill,
  onAddGsePayment,
  onDeleteGsePayment,
  onUpdateGsePayment,
}: BillsViewProps) {
  const [utilityTab, setUtilityTab] = useState<'luce' | 'acqua' | 'tari' | 'gse'>('luce');
  const [vaultMeta, setVaultMeta] = useState<Record<string, VaultFileMeta>>({});

  const allElectricityRecords = useMemo(() => {
    return propElectricityBills ?? [];
  }, [propElectricityBills]);

  const octopusContractRecords = useMemo(
    () => allElectricityRecords.filter(isOctopusContractRecord),
    [allElectricityRecords]
  );
  const octopusContractToManage = useMemo(
    () => propElectricityBills?.find(isOctopusContractRecord) ?? null,
    [propElectricityBills]
  );
  const bills = useMemo(
    () =>
      allElectricityRecords.filter(
        (bill) => {
          const fileKey = bill.pdfFileKey || getElectricityBillFileKey(bill.invoiceNumber);
          return (
            !isOctopusContractRecord(bill) &&
            (readOnly ? Boolean(bill.pdfFileKey) : Boolean(vaultMeta[fileKey]))
          );
        }
      ),
    [allElectricityRecords, readOnly, vaultMeta]
  );

  const waterBills = useMemo(() => {
    return [...(propWaterBills ?? [])]
      .filter((bill) =>
        readOnly
          ? Boolean(bill.pdfFileKey)
          : Boolean(
              vaultMeta[bill.pdfFileKey || getWaterBillFileKey(bill.invoiceNumber)]
            )
      )
      .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
  }, [propWaterBills, readOnly, vaultMeta]);

  const tariBills = useMemo(() => {
    return [...propTariBills]
      .filter((bill) =>
        readOnly
          ? Boolean(bill.pdfFileKey)
          : Boolean(vaultMeta[bill.pdfFileKey || getTariBillFileKey(bill.noticeNumber)])
      )
      .sort((a, b) => b.year - a.year || a.noticeNumber.localeCompare(b.noticeNumber));
  }, [propTariBills, readOnly, vaultMeta]);

  const gsePayments = useMemo(
    () => [...propGsePayments].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate)),
    [propGsePayments]
  );

  const [selectedBillYear, setSelectedBillYear] = useState<string>('all');
  const [selectedBillSupplier, setSelectedBillSupplier] = useState<string>('all');
  const [selectedWaterYear, setSelectedWaterYear] = useState<string>('all');

  type ElecSortKey =
    | 'period'
    | 'supplier'
    | 'invoice'
    | 'kwh'
    | 'pun'
    | 'elecOnly'
    | 'total';
  type WaterSortKey = 'period' | 'invoice' | 'mc' | 'fixed' | 'total';
  type TariSortKey = 'period' | 'notice' | 'due' | 'source' | 'paid' | 'total';
  type GseSortKey = 'date' | 'amount';

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

  const TRACKED_SUPPLIERS_DEFAULT: SupplierMarketOffer[] = [
    {
      supplier: 'Octopus Energy',
      offerName: 'Octopus Fissa 12M / 24M',
      rateEurKwh: 0.1727,
      fixedEurMonth: 6.0,
      estAnnualEur: 469.21,
      url: 'https://octopusenergy.it/offerta/tariffe',
      status: 'ok',
    },
    {
      supplier: 'ENGIE',
      offerName: 'Energia PuntoFisso 24M Solo Luce',
      rateEurKwh: 0.158,
      fixedEurMonth: 7.0,
      estAnnualEur: 447.4,
      url: 'https://www.engie.it/casa/offerte-luce-gas/energia-puntofisso-24mesi-singleele/',
      status: 'ok',
    },
    {
      supplier: 'Eni Plenitude',
      offerName: 'Fixa Time Luce',
      rateEurKwh: 0.2339,
      fixedEurMonth: 8.0,
      estAnnualEur: 633.97,
      url: 'https://eniplenitude.com/offerta/casa/gas-e-luce/fixa-time',
      status: 'ok',
    },
    {
      supplier: 'E.ON Energia',
      offerName: 'LuceClick 24M Verde',
      rateEurKwh: 0.1507,
      fixedEurMonth: 9.09,
      estAnnualEur: 455.69,
      url: 'https://www.eon-energia.com/luce/casa/offerta-luce-prezzo-fisso-24-mesi.html',
      status: 'ok',
    },
    {
      supplier: 'NeN',
      offerName: 'Luce Due 24M (Dieci 10A: 0.129 €/kWh)',
      rateEurKwh: 0.179,
      fixedEurMonth: 9.0,
      estAnnualEur: 519.7,
      url: 'https://nen.it/offerte-e-prezzi/prezzo-bloccato',
      status: 'ok',
    },
    {
      supplier: 'Sorgenia',
      offerName: 'Next Energy Luce Casa',
      rateEurKwh: 0.17,
      fixedEurMonth: 9.5,
      estAnnualEur: 505.0,
      url: 'https://www.sorgenia.it/offerte-luce-casa',
      status: 'ok',
    },
    {
      supplier: 'Enel Energia',
      offerName: 'Enel Fix Web Luce',
      rateEurKwh: 0.199,
      fixedEurMonth: 12.0,
      estAnnualEur: 601.7,
      url: 'https://www.enel.it/it-it/offerte-luce/enel-fix-web-luce',
      status: 'ok',
    },
  ];

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
    updatedAt: '2026-11-21T23:45:01Z',
    competitors: TRACKED_SUPPLIERS_DEFAULT,
    bestCompetitor: TRACKED_SUPPLIERS_DEFAULT[1],
  });

  const [importModalKind, setImportModalKind] = useState<'auto' | 'luce' | 'acqua' | 'tari' | null>(null);
  const [shareBillItem, setShareBillItem] = useState<ShareableItemPayload | null>(null);
  const [deleteBillFromShare, setDeleteBillFromShare] = useState<BillRecord | null>(null);
  const attachFileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachingFileKey, setAttachingFileKey] = useState<string | null>(null);
  const gseAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [attachingGsePaymentId, setAttachingGsePaymentId] = useState<string | null>(null);

  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [clearingAllBills, setClearingAllBills] = useState(false);
  const [confirmClearAllBills, setConfirmClearAllBills] = useState(false);
  const [confirmDeleteOctopus, setConfirmDeleteOctopus] = useState(false);
  const [confirmDeleteGseId, setConfirmDeleteGseId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      void listVaultFileMetadata().then(setVaultMeta);
    };
    refresh();
    window.addEventListener(VAULT_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(VAULT_UPDATED_EVENT, refresh);
  }, [importModalKind, bills.length, waterBills.length, tariBills.length]);

  async function handleAttachPdfToBill(files: FileList | null) {
    if (!files || files.length === 0 || !attachingFileKey) return;
    const f = files[0];
    setAttachNotice(null);
    try {
      const saved = await saveVaultFile(attachingFileKey, f, f.name, f.type);
      if (!saved.cloudSynced) {
        throw new Error(`Il PDF "${f.name}" non è stato salvato su Firestore.`);
      }
      setAttachNotice(
        `PDF "${f.name}" salvato su Firestore: scaricabile da tutti i tuoi dispositivi.`
      );
      const updated = await listVaultFileMetadata();
      setVaultMeta(updated);
    } catch (err) {
      setAttachNotice(err instanceof Error ? err.message : 'Errore nel salvataggio del file PDF.');
    } finally {
      setAttachingFileKey(null);
      if (attachFileInputRef.current) attachFileInputRef.current.value = '';
    }
  }

  async function handleAttachGseFile(files: FileList | null) {
    if (!files?.length || !attachingGsePaymentId || !onUpdateGsePayment) return;
    const file = files[0];
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setAttachNotice('Allega uno screenshot o un PDF del bonifico.');
      return;
    }

    const payment = gsePayments.find((entry) => entry.id === attachingGsePaymentId);
    if (!payment) {
      setAttachNotice('Il bonifico selezionato non è più presente nell’archivio.');
      return;
    }

    const previousFileKey = payment.attachmentFileKey;
    const nextFileKey = `gse_payment_${payment.id}_${Date.now()}`;
    let recordUpdated = false;
    setAttachNotice(null);
    try {
      const saved = await saveVaultFile(nextFileKey, file, file.name, file.type);
      if (!saved.cloudSynced) {
        throw new Error(
          saved.cloudTooLarge
            ? 'L’allegato supera il limite Firebase e non è stato collegato al bonifico.'
            : 'L’allegato non è stato salvato su Firebase e non è stato collegato al bonifico.'
        );
      }

      await onUpdateGsePayment(payment.id, {
        ...payment,
        attachmentFileKey: nextFileKey,
      });
      recordUpdated = true;
      if (previousFileKey && previousFileKey !== nextFileKey) {
        await deleteVaultFiles([previousFileKey]);
      }
      setVaultMeta(await listVaultFileMetadata());
      setAttachNotice(`Allegato "${file.name}" salvato con il bonifico GSE.`);
    } catch (error) {
      let message =
        error instanceof Error ? error.message : 'Errore durante il salvataggio dell’allegato GSE.';
      if (!recordUpdated) {
        try {
          await deleteVaultFiles([nextFileKey]);
        } catch (cleanupError) {
          const cleanupMessage =
            cleanupError instanceof Error ? cleanupError.message : 'errore non specificato';
          message += ` Inoltre non è stato possibile rimuovere il file temporaneo: ${cleanupMessage}`;
        }
      }
      setAttachNotice(message);
    } finally {
      setAttachingGsePaymentId(null);
      if (gseAttachmentInputRef.current) gseAttachmentInputRef.current.value = '';
    }
  }

  async function handleDeleteOctopusContract() {
    if (!octopusContractToManage || !onDeleteElectricityBill) return;
    setConfirmDeleteOctopus(false);
    try {
      await onDeleteElectricityBill(octopusContractToManage);
      setAttachNotice('Contratto Octopus rimosso dall’archivio.');
    } catch (err) {
      setAttachNotice(
        err instanceof Error ? err.message : 'Errore durante la rimozione del contratto Octopus.'
      );
    }
  }

  async function handleClearAllBills() {
    if (!onClearAllBills || clearingAllBills) return;
    setConfirmClearAllBills(false);
    setClearingAllBills(true);
    setAttachNotice(null);
    try {
      await onClearAllBills();
      setAttachNotice(
        'Archivio svuotato: bollette, PDF e bonifici GSE sono stati eliminati da Firebase.'
      );
    } catch (error) {
      setAttachNotice(
        error instanceof Error ? error.message : 'Errore durante l’eliminazione delle bollette.'
      );
    } finally {
      setClearingAllBills(false);
    }
  }

  const [showGseForm, setShowGseForm] = useState(false);
  const [gseSaving, setGseSaving] = useState(false);
  const [gDate, setGDate] = useState('');
  const [gAmount, setGAmount] = useState('');
  const [editingGsePayment, setEditingGsePayment] = useState<GsePaymentRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMonitor = async () => {
      if (!auth.currentUser) return;
      try {
        const snap = await getDoc(doc(db, 'appMeta', 'octopusTariff'));
        if (cancelled || !snap.exists()) return;
        const json = snap.data();
        if (json && typeof json.myLockedRate === 'number') {
          const fetchedList: SupplierMarketOffer[] = Array.isArray(json.competitors)
            ? (json.competitors as SupplierMarketOffer[])
            : [];
          const fetchedBySupplier = new Map(fetchedList.map((c) => [c.supplier, c]));
          const mergedCompetitors = TRACKED_SUPPLIERS_DEFAULT.map((def) => {
            const live = fetchedBySupplier.get(def.supplier);
            return live ? { ...def, ...live, url: def.url || live.url } : def;
          });
          for (const extra of fetchedList) {
            if (!mergedCompetitors.some((c) => c.supplier === extra.supplier)) {
              mergedCompetitors.push(extra);
            }
          }
          setMarketMonitor({
            myLockedRate: json.myLockedRate,
            myFixedEurMonth:
              typeof json.myFixedEurMonth === 'number' ? json.myFixedEurMonth : 6.0,
            currentRate: typeof json.currentRate === 'number' ? json.currentRate : null,
            updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null,
            competitors: mergedCompetitors,
            bestCompetitor:
              (json.bestCompetitor as SupplierMarketOffer | null) ?? TRACKED_SUPPLIERS_DEFAULT[1],
          });
        }
      } catch {
        // ignore if appMeta/octopusTariff has not been written yet
      }
    };
    void loadMonitor();
    return () => {
      cancelled = true;
    };
  }, [readOnly]);

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
      return { allInPerKwh: null as number | null, monthlyEur: null as number | null };
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

  const billSuppliers = useMemo(
    () => Array.from(new Set(bills.map((bill) => bill.supplier))).sort((a, b) => a.localeCompare(b)),
    [bills]
  );

  const filteredBills = useMemo(() => {
    const list = bills.filter(
      (bill) =>
        (selectedBillYear === 'all' || String(bill.year) === selectedBillYear) &&
        (selectedBillSupplier === 'all' || bill.supplier === selectedBillSupplier)
    );
    return [...list].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [bills, selectedBillYear, selectedBillSupplier]);

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
        case 'amount':
          return compareSortValues(a.amountEur, b.amountEur, gseSort.dir);
      }
    });
  }, [gsePayments, gseSort]);

  const myAnnualBenchmarkEur =
    marketMonitor.myLockedRate * 2300 + marketMonitor.myFixedEurMonth * 12;

  async function handleSubmitGse(e: React.FormEvent) {
    e.preventDefault();
    if (
      (editingGsePayment ? !onUpdateGsePayment : !onAddGsePayment) ||
      !gDate ||
      !gAmount.trim()
    ) {
      return;
    }
    const amountEur = Number(gAmount.replace(',', '.'));
    if (!Number.isFinite(amountEur) || amountEur < 0) {
      setAttachNotice('Inserisci un importo valido e non negativo.');
      return;
    }
    setGseSaving(true);
    try {
      const [year, month, day] = gDate.split('-');
      const payment: Omit<GsePaymentRecord, 'id'> = {
        paymentDate: `${day}/${month}/${year}`,
        year: Number(year),
        paymentType: editingGsePayment?.paymentType ?? 'altro',
        period: editingGsePayment?.period || 'Bonifico GSE',
        amountEur,
        kwhInjected: editingGsePayment?.kwhInjected,
        reference: editingGsePayment?.reference,
        note: editingGsePayment?.note,
        attachmentFileKey: editingGsePayment?.attachmentFileKey,
      };
      if (editingGsePayment) {
        await onUpdateGsePayment?.(editingGsePayment.id, payment);
      } else {
        await onAddGsePayment?.(payment);
      }
      setShowGseForm(false);
      setEditingGsePayment(null);
      setGDate('');
      setGAmount('');
    } catch (error) {
      setAttachNotice(error instanceof Error ? error.message : 'Errore nel salvataggio del bonifico GSE.');
    } finally {
      setGseSaving(false);
    }
  }

  function openGsePaymentEditor(payment?: GsePaymentRecord) {
    setEditingGsePayment(payment ?? null);
    setGDate(payment ? parseItDateToIso(payment.paymentDate) ?? '' : '');
    setGAmount(payment ? String(payment.amountEur) : '');
    setShowGseForm(true);
  }

  async function handleDeleteGsePayment(id: string) {
    if (!onDeleteGsePayment) return;
    try {
      await onDeleteGsePayment(id);
      setAttachNotice('Bonifico GSE e relativo allegato eliminati.');
    } catch (error) {
      setAttachNotice(
        error instanceof Error ? error.message : 'Errore durante l’eliminazione del bonifico GSE.'
      );
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            Bollette, TARI &amp; Fotovoltaico GSE
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Archivio completo su Firebase: ricerca INBOX Gmail per Luce, Acqua e TARI (tasto &quot;Sincronizza Gmail&quot;), caricamento manuale PDF e registro bonifici GSE.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {!readOnly && (onAddElectricityBill || onAddWaterBill || onAddTariBill) && (
            <button
              type="button"
              onClick={() => setImportModalKind('auto')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 bg-sky-600 hover:bg-sky-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors"
            >
              <FileUp className="w-3.5 h-3.5" />
              Importa bolletta
            </button>
          )}
          {!readOnly && onClearAllBills && (
            confirmClearAllBills ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-rose-500/10 dark:bg-rose-500/15 border border-rose-500/30 dark:border-rose-500/40 rounded-lg">
                <span className="text-rose-700 dark:text-rose-200 font-medium">Confermi? (mantiene Octopus)</span>
                <button
                  type="button"
                  onClick={() => void handleClearAllBills()}
                  disabled={clearingAllBills}
                  className="px-2 py-0.5 font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded transition-colors disabled:opacity-50"
                >
                  Sì, svuota
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearAllBills(false)}
                  className="px-2 py-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded"
                >
                  Annulla
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClearAllBills(true)}
                disabled={clearingAllBills}
                title="Elimina bollette Luce, Acqua, TARI, bonifici GSE e relativi PDF; mantiene il contratto Octopus"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {clearingAllBills ? 'Eliminazione...' : 'Svuota archivio'}
              </button>
            )
          )}

          <div className="inline-flex flex-wrap bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setUtilityTab('luce')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                utilityTab === 'luce'
                  ? 'bg-sky-500/15 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                  ? 'bg-cyan-500/15 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                  ? 'bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                  ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              Fotovoltaico / GSE
            </button>
          </div>
        </div>
      </div>

      <AccessUnlockBanner
        isSignedIn={!readOnly}
        isGmailConnected={isGmailConnected}
        onSignIn={onSignIn}
        onConnectGmail={onConnectGmail}
        pageName="Bollette"
        unlockedFeatures={[
          'Importa bollette da PDF/CSV/JSON',
          'Allega i PDF originali su Firestore (scaricabili da ogni dispositivo)',
          'Registra bollette Luce, Acqua, TARI e bonifici GSE',
          'Segna lo stato pagato/da pagare degli avvisi TARI',
        ]}
        gmailFeatures={[
          'Scansione automatica INBOX Gmail per nuove bollette Luce/Acqua/TARI (le bollette restano sempre in INBOX, mai nel Cestino)',
        ]}
      />

      {/* Riepilogo Email Controllate & Strategia Ricerca */}
      <details className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-xs shadow-xs dark:shadow-none">
        <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-200 flex flex-wrap items-center justify-between gap-2 select-none">
          <span className="inline-flex items-center gap-2">
            <Mail className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <span>Strategia di ricerca email Gmail &amp; sincronizzazione</span>
          </span>
          <span className="px-2 py-0.5 text-[10px] font-mono bg-sky-500/10 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/25 dark:border-sky-500/30 rounded">
            Apps Script 24/7 (consumi) + Sync Gmail (bollette PDF) · Solo INBOX
          </span>
        </summary>
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800/80 space-y-2.5 text-[11px] text-slate-600 dark:text-slate-300">
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            I consumi e-distribuzione vengono sincronizzati 24/7 su{' '}
            <a
              href="https://script.google.com/u/1/home/projects/1Xv8LKzCxqu2n05njAGj9iMZLEETUD-uyUkaSkzThum6FmOStyTFiq5kh/edit"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-sky-700 dark:text-sky-300 underline hover:opacity-80"
            >
              Google Apps Script
            </a>
            ; cliccando <strong className="text-slate-900 dark:text-slate-200">&quot;Sincronizza Gmail&quot;</strong> in alto l&apos;app controlla la sola <strong className="text-slate-900 dark:text-slate-200">INBOX</strong> (mai Spam o Cestino) ed estrae le bollette PDF di Luce, Acqua e TARI (puoi comunque sempre usare anche &quot;Importa bolletta&quot;). Le email delle bollette vengono <strong className="text-emerald-700 dark:text-emerald-300">solo lette e lasciate sempre nella tua INBOX</strong>.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <div className="bg-slate-50 dark:bg-slate-950/75 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-0.5">
              <div className="font-semibold text-sky-700 dark:text-sky-300">Luce — Edison Energia</div>
              <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">
                from:fatturazione@edisonenergia.it · subject:&quot;Fattura Edison Energia&quot;
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                PDF con parole chiave &quot;edison&quot;, &quot;energia elettrica&quot; o &quot;kwh&quot; · Resta in INBOX
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950/75 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-0.5">
              <div className="font-semibold text-emerald-700 dark:text-emerald-300">Luce — Octopus Energy</div>
              <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">
                from:octopusenergy.it · subject:&quot;Octopus Energy&quot;
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                PDF bolletta con &quot;octopus&quot; o &quot;kwh&quot; (contratti esclusi) · Resta in INBOX
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950/75 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-0.5">
              <div className="font-semibold text-cyan-700 dark:text-cyan-300">Acqua — AcegasApsAmga</div>
              <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">
                from:acegasapsamga.it (non TARI)
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                PDF con &quot;servizio idrico&quot;, &quot;acquedotto&quot;, &quot;fognatura&quot;, &quot;depurazione&quot; o &quot;acegas&quot; senza kWh · Resta in INBOX
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950/75 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-0.5">
              <div className="font-semibold text-indigo-700 dark:text-indigo-300">TARI — AcegasApsAmga</div>
              <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">
                from:tassa_rifiuti@acegasapsamga.it · subject:&quot;Avviso di pagamento TARI&quot;
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                Oppure from:acegasapsamga.it + PDF con &quot;tassa rifiuti&quot; / &quot;TARI&quot; · Resta in INBOX
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950/75 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-0.5 sm:col-span-2 lg:col-span-2">
              <div className="font-semibold text-slate-800 dark:text-slate-200">Consumi Elettrici — e-distribuzione (CSV / ZIP, Apps Script 24/7)</div>
              <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">
                from:notifichemailped@enel.com · from:e-distribuzione.it/.com · subject:&quot;curve di carico&quot;
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                Unico tipo di email spostato nel Cestino dopo il salvataggio delle letture su Firestore
              </div>
            </div>
          </div>
        </div>
      </details>

      {attachNotice && (
        <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl px-4 py-2.5 text-xs text-sky-800 dark:text-sky-200 flex items-center justify-between gap-2">
          <span>{attachNotice}</span>
          <button
            type="button"
            onClick={() => setAttachNotice(null)}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          >
            Chiudi
          </button>
        </div>
      )}

      {/* TAB ACQUA */}
      {utilityTab === 'acqua' && (
        <div className="space-y-5">
          {/* Strategia di caricamento + Scheda fornitura Acqua */}
          <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 shadow-xs dark:shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-cyan-500/10 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25 dark:border-cyan-500/30 rounded-md">
                  Servizio Idrico · Padova
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 dark:border-emerald-500/30 rounded-md">
                  <Mail className="w-3 h-3" />
                  Gmail INBOX + PDF manuale
                </span>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  Contratto <span className="text-cyan-700 dark:text-cyan-300">3040787553</span> · Cliente{' '}
                  <span className="text-slate-700 dark:text-slate-300">1014119052</span>
                </span>
              </div>

              {!readOnly && onAddWaterBill && (
                <button
                  type="button"
                  onClick={() => setImportModalKind('acqua')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 bg-sky-600 hover:bg-sky-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  Importa PDF bolletta acqua
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                AcegasApsAmga — Servizio Acqua (Quadrimestrale)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                <strong className="text-slate-800 dark:text-slate-200">Strategia ricerca Gmail:</strong> cliccando <em>Sincronizza Gmail</em> la scansione cerca nella sola INBOX le email dal dominio{' '}
                <span className="font-mono text-cyan-700 dark:text-cyan-300">acegasapsamga.it</span>{' '}
                (escludendo quelle TARI) con PDF allegato contenente{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">&quot;servizio idrico&quot;</span>,{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">&quot;acquedotto&quot;</span>,{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">&quot;fognatura&quot;</span>,{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">&quot;depurazione&quot;</span> oppure{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">&quot;acegas&quot;</span> senza <span className="font-mono">kwh</span>.{' '}
                <strong className="text-emerald-700 dark:text-emerald-300">L&apos;email resta sempre in INBOX</strong> e il PDF viene salvato su Firebase (oppure usa &quot;Importa PDF bolletta acqua&quot;).
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Uso domestico residente (2 componenti) · Contatore{' '}
                <span className="font-mono text-slate-700 dark:text-slate-300">365230000000152556</span> · Addebito
                diretto ING · Prossima bolletta prevista:{' '}
                <span className="text-slate-800 dark:text-slate-200 font-medium">15/03/2027</span> (autolettura dal
                28/02 al 05/03/2027).
              </p>
            </div>
          </div>

          {filteredWaterBills.length > 0 ? (
            <>
          {/* KPI Acqua */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Totale Pagato</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {waterTotals.total.toFixed(2).replace('.', ',')} €
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Consumo Fatturato
              </div>
              <div className="text-lg font-bold font-mono tabular-nums text-cyan-700 dark:text-cyan-300 mt-0.5">
                {waterTotals.mc.toFixed(1).replace('.', ',')} m³
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Costo Medio Reale
              </div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-0.5">
                {waterTotals.avgPerMc > 0
                  ? `${waterTotals.avgPerMc.toFixed(2).replace('.', ',')} €/m³`
                  : '—'}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Bollette</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {filteredWaterBills.length}
              </div>
            </div>
          </div>

          {/* Tabella Bollette Acqua */}
          <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs dark:shadow-none">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Storico Bollette Acqua ({filteredWaterBills.length})
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedWaterYear('all')}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    selectedWaterYear === 'all'
                      ? 'bg-cyan-500/15 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/35 dark:border-cyan-500/40'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                        ? 'bg-cyan-500/15 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/35 dark:border-cyan-500/40'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
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
                    <th className="px-3 py-2.5 font-medium text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                  {sortedWaterBills.map((w) => {
                    const fileKey = getWaterBillFileKey(w.invoiceNumber);
                    const hasPdf = Boolean(vaultMeta[fileKey]);
                    const sharePayload = buildWaterBillSharePayload(w);
                    return (
                      <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                          <div>{w.period}</div>
                          {w.note && <div className="text-[10px] text-slate-500 dark:text-slate-400">{w.note}</div>}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-500 dark:text-slate-400">
                          <div>#{w.invoiceNumber}</div>
                          <div className="text-[10px]">{w.issueDate}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                          {w.cubicMeters.toFixed(1).replace('.', ',')} m³
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {w.fixedCostEur.toFixed(2).replace('.', ',')} €
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {w.totalPaid.toFixed(2).replace('.', ',')} €
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                void downloadShareableItem(
                                  readOnly
                                    ? { ...sharePayload, attachmentKey: undefined }
                                    : sharePayload
                                )
                              }
                              title={
                                readOnly
                                  ? 'Scarica riepilogo HTML'
                                  : hasPdf
                                    ? `Scarica PDF originale (${vaultMeta[fileKey]?.fileName})`
                                    : 'Scarica riepilogo HTML'
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg transition-colors"
                            >
                              <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                              Scarica
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteBillFromShare(null);
                                setShareBillItem(sharePayload);
                              }}
                              title={
                                readOnly
                                  ? 'Condividi il riepilogo della bolletta'
                                  : hasPdf
                                    ? `Condividi bolletta e PDF originale (${vaultMeta[fileKey]?.fileName})`
                                    : 'Condividi riepilogo della bolletta'
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-500/10 dark:bg-sky-500/15 hover:bg-sky-500/20 dark:hover:bg-sky-500/25 border border-sky-500/30 dark:border-sky-500/35 text-sky-700 dark:text-sky-300 rounded-lg transition-colors"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              Condividi
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nessuna bolletta acqua con PDF presente per il periodo selezionato.
              {!readOnly && ' Importa il PDF originale per aggiungerla allo storico.'}
            </div>
          )}
        </div>
      )}

      {/* TAB TARI */}
      {utilityTab === 'tari' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 shadow-xs dark:shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25 dark:border-indigo-500/30 rounded-md">
                  Tassa Rifiuti (TARI)
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 dark:border-emerald-500/30 rounded-md">
                  <Mail className="w-3 h-3" />
                  Gmail INBOX + PDF manuale
                </span>
              </div>

              {!readOnly && onAddTariBill && (
                <button
                  type="button"
                  onClick={() => setImportModalKind('tari')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 bg-sky-600 hover:bg-sky-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  Importa PDF TARI
                </button>
              )}
            </div>

            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              AcegasApsAmga / TARI — Avvisi di Pagamento
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <strong className="text-slate-800 dark:text-slate-200">Strategia ricerca Gmail:</strong> con <em>Sincronizza Gmail</em> la scansione cerca nella sola INBOX le email da{' '}
              <span className="font-mono text-indigo-700 dark:text-indigo-300">tassa_rifiuti@acegasapsamga.it</span> o{' '}
              <span className="font-mono text-indigo-700 dark:text-indigo-300">acegasapsamga.it</span>{' '}
              con oggetto/testo contenente{' '}
              <span className="font-mono text-slate-800 dark:text-slate-200">&quot;Avviso di pagamento TARI&quot;</span>,{' '}
              <span className="font-mono text-slate-800 dark:text-slate-200">&quot;tassa rifiuti&quot;</span> o{' '}
              <span className="font-mono text-slate-800 dark:text-slate-200">&quot;tassa sui rifiuti&quot;</span>, estrae i PDF validi ignorando allegati diversi, evita duplicati su Firebase e <strong className="text-emerald-700 dark:text-emerald-300">lascia sempre l&apos;email nella tua INBOX</strong>.
            </p>
          </div>

          {tariBills.length > 0 ? (
            <>
          {/* KPI TARI */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Totale TARI</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {tariTotals.total.toFixed(2).replace('.', ',')} €
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Avvisi Caricati</div>
              <div className="text-lg font-bold font-mono tabular-nums text-indigo-700 dark:text-indigo-300 mt-0.5">
                {tariBills.length}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs dark:shadow-none">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Da Pagare</div>
              <div className="text-lg font-bold font-mono tabular-nums text-rose-600 dark:text-rose-300 mt-0.5">
                {tariTotals.unpaidCount}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs dark:shadow-none">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Storico Avvisi TARI ({tariBills.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
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
                    <th className="px-3 py-2.5 font-medium text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                  {sortedTariBills.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        Nessun avviso TARI ancora salvato. Appena arriva la prossima email da{' '}
                        <span className="font-mono text-slate-700 dark:text-slate-300">tassa_rifiuti@acegasapsamga.it</span>{' '}
                        verrà estratta automaticamente, oppure puoi inserirne una manualmente qui sopra.
                      </td>
                    </tr>
                  ) : (
                    sortedTariBills.map((t) => {
                      const fileKey = getTariBillFileKey(t.noticeNumber);
                      const hasPdf = Boolean(vaultMeta[fileKey]);
                      const sharePayload = buildTariBillSharePayload(t);
                      return (
                        <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                            <div>{t.period}</div>
                            {t.note && <div className="text-[10px] text-slate-500 dark:text-slate-400">{t.note}</div>}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-500 dark:text-slate-400">
                            <div>#{t.noticeNumber}</div>
                            <div className="text-[10px]">{t.issueDate}</div>
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-amber-700 dark:text-amber-300">{t.dueDate}</td>
                          <td className="px-3 py-2.5">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
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
                                  ? 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 dark:border-emerald-500/30'
                                  : 'bg-rose-500/10 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25 dark:border-rose-500/30'
                              }`}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {t.paid ? 'Pagato' : 'Da pagare'}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                            {t.totalPaid.toFixed(2).replace('.', ',')} €
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  void downloadShareableItem(
                                    readOnly
                                      ? { ...sharePayload, attachmentKey: undefined }
                                      : sharePayload
                                  )
                                }
                                title={
                                  readOnly
                                    ? 'Scarica riepilogo HTML'
                                    : hasPdf
                                      ? `Scarica PDF originale (${vaultMeta[fileKey]?.fileName})`
                                      : 'Scarica riepilogo HTML'
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg transition-colors"
                              >
                                <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                                Scarica
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteBillFromShare(null);
                                  setShareBillItem(sharePayload);
                                }}
                                title={
                                  readOnly
                                    ? 'Condividi il riepilogo dell’avviso TARI'
                                    : hasPdf
                                      ? `Condividi avviso e PDF originale (${vaultMeta[fileKey]?.fileName})`
                                      : 'Condividi riepilogo dell’avviso TARI'
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-500/10 dark:bg-sky-500/15 hover:bg-sky-500/20 dark:hover:bg-sky-500/25 border border-sky-500/30 dark:border-sky-500/35 text-sky-700 dark:text-sky-300 rounded-lg transition-colors"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                Condividi
                              </button>
                              {!readOnly && onDeleteTariBill && (
                                <button
                                  type="button"
                                  onClick={() => void onDeleteTariBill(t.id)}
                                  className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg"
                                  aria-label="Elimina avviso TARI"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nessun avviso TARI con PDF presente nell&apos;archivio.
              {!readOnly && ' Importa il PDF originale per aggiungerlo.'}
            </div>
          )}
        </div>
      )}

      {/* TAB FOTOVOLTAICO / GSE SCAMBIO SUL POSTO */}
      {utilityTab === 'gse' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900/70 border border-emerald-500/30 rounded-xl p-4 sm:p-5 space-y-3 shadow-xs dark:shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 dark:border-emerald-500/30 rounded-md">
                  Fotovoltaico + Scambio sul Posto (SSP)
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md">
                  <PenLine className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                  Inserimento manuale bonifici GSE → Firebase
                </span>
              </div>

              {!readOnly && onAddGsePayment && (
                <button
                  type="button"
                  onClick={() => openGsePaymentEditor()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Registra bonifico GSE
                </button>
              )}
            </div>

            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Inverter Huawei SUN2000-4KTL-L1 (4 kW) · Scambio sul Posto GSE
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Con lo <strong className="text-slate-800 dark:text-slate-200">Scambio sul Posto (SSP)</strong> il GSE rimborsa parte dell&apos;energia che immetti in rete rispetto a quella prelevata. I bonifici GSE seguono in genere <strong className="text-slate-800 dark:text-slate-200">2 acconti semestrali</strong> (giugno e novembre) e <strong className="text-slate-800 dark:text-slate-200">1 conguaglio annuale</strong> (maggio/giugno dell&apos;anno successivo). Questa sezione raccoglie ogni accredito GSE per sottrarlo mentalmente dalla spesa annua netta di casa.
              </p>
            </div>
          </div>

          {showGseForm && !readOnly && (
            <form
              onSubmit={handleSubmitGse}
              className="bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-xl p-4 space-y-3 text-xs shadow-xs dark:shadow-none"
            >
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {editingGsePayment ? 'Modifica bonifico GSE' : 'Registra bonifico GSE'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="date"
                  required
                  value={gDate}
                  onChange={(e) => setGDate(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  placeholder="Importo (€)"
                  value={gAmount}
                  onChange={(e) => setGAmount(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowGseForm(false);
                    setEditingGsePayment(null);
                    setGDate('');
                    setGAmount('');
                  }}
                  className="px-3 py-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={gseSaving}
                  className="px-4 py-1.5 font-semibold text-white dark:text-slate-950 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-lg"
                >
                  {gseSaving ? 'Salvataggio...' : editingGsePayment ? 'Salva modifiche' : 'Salva bonifico'}
                </button>
              </div>
            </form>
          )}

          <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs dark:shadow-none">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Storico Bonifici GSE — Scambio sul Posto ({gsePayments.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
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
                      sortKey="amount"
                      currentSort={gseSort}
                      onSort={(k) => setGseSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-4 py-2.5 font-medium text-right"
                    >
                      Importo
                    </SortableTh>
                    <th className="px-3 py-2.5 font-medium text-right">Allegato</th>
                    {!readOnly && <th className="px-3 py-2.5 font-medium text-right">Azioni</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                  {sortedGsePayments.length === 0 ? (
                    <tr>
                      <td colSpan={readOnly ? 3 : 4} className="px-4 py-6 text-center text-slate-500">
                        Nessun bonifico GSE registrato.
                      </td>
                    </tr>
                  ) : (
                    sortedGsePayments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">{p.paymentDate}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                          {p.amountEur.toFixed(2).replace('.', ',')} €
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {p.attachmentFileKey && vaultMeta[p.attachmentFileKey] ? (
                            <button
                              type="button"
                              onClick={() =>
                                void downloadShareableItem({
                                  title: `Bonifico GSE ${p.paymentDate}`,
                                  subtitle: `${p.amountEur.toFixed(2)} €`,
                                  shareText: `Bonifico GSE del ${p.paymentDate}: ${p.amountEur.toFixed(2)} €`,
                                  htmlDocument: '',
                                  fallbackFileName: `bonifico-gse-${p.id}.html`,
                                  attachmentKey: p.attachmentFileKey,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg transition-colors"
                            >
                              <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                              Scarica
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">Nessun allegato</span>
                          )}
                        </td>
                        {!readOnly && (
                          <td className="px-3 py-2.5 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                title={p.attachmentFileKey ? 'Sostituisci allegato' : 'Allega screenshot o PDF'}
                                onClick={() => {
                                  setAttachingGsePaymentId(p.id);
                                  gseAttachmentInputRef.current?.click();
                                }}
                                className="inline-flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300 hover:text-sky-600 dark:hover:text-sky-200"
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                                {p.attachmentFileKey ? 'Sostituisci' : 'Allega file'}
                              </button>
                              {onUpdateGsePayment && (
                                <button
                                  type="button"
                                  title="Modifica bonifico"
                                  onClick={() => openGsePaymentEditor(p)}
                                  className="p-1 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-300"
                                  aria-label="Modifica bonifico GSE"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {onDeleteGsePayment && (
                                confirmDeleteGseId === p.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmDeleteGseId(null);
                                        void handleDeleteGsePayment(p.id);
                                      }}
                                      className="px-1.5 py-0.5 text-[10px] font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded"
                                    >
                                      Elimina
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteGseId(null)}
                                      className="px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                                    >
                                      No
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    title="Elimina bonifico"
                                    onClick={() => setConfirmDeleteGseId(p.id)}
                                    className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                                    aria-label="Elimina bonifico GSE"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )
                              )}
                            </div>
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
          <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs dark:shadow-none">
            <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300 leading-relaxed">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 dark:border-emerald-500/30 rounded-md">
                <Mail className="w-3 h-3" />
                Strategia ricerca Gmail INBOX
              </span>
              <span>
                Con <em>Sincronizza Gmail</em> la scansione cerca nella sola INBOX email da{' '}
                <span className="font-mono text-sky-700 dark:text-sky-300">fatturazione@edisonenergia.it</span> (oggetto &quot;Fattura Edison Energia&quot;) e{' '}
                <span className="font-mono text-emerald-700 dark:text-emerald-300">octopusenergy.it</span> (oggetto &quot;Octopus Energy&quot;), analizzando PDF con <span className="font-mono">edison / octopus / enel / energia elettrica / kwh</span> (contratti esclusi; le email restano sempre in INBOX). I consumi giornalieri e-distribuzione girano 24/7 su Apps Script.
              </span>
            </div>

            {!readOnly && onAddElectricityBill && (
              <button
                type="button"
                onClick={() => setImportModalKind('luce')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-300 bg-sky-500/10 dark:bg-sky-500/15 hover:bg-sky-500/20 dark:hover:bg-sky-500/25 border border-sky-500/25 dark:border-sky-500/30 rounded-lg transition-colors"
              >
                <FileUp className="w-3.5 h-3.5" />
                Importa PDF bolletta
              </button>
            )}
          </div>

          {/* Contratto Octopus e riepilogo storico */}
          <div className="space-y-4">
            {(!offerSummaries.some((o) => o.supplier.toLowerCase().includes('octopus')) ||
              octopusContractToManage) && (
              <div className="bg-white dark:bg-slate-900/70 border border-emerald-500/30 rounded-xl p-4 space-y-3 shadow-xs dark:shadow-none">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 dark:border-emerald-500/30 rounded-md">
                        Contratto sottoscritto · avvio 2027
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {offerSummaries.some((o) => o.supplier.toLowerCase().includes('octopus'))
                          ? 'Fornitura attiva · bollette disponibili nello storico'
                          : 'Fornitura in attivazione · bollette dal 2027'}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
                      Contratto Octopus Energy — Octopus Fissa 24M
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Cod. <span className="font-mono text-slate-700 dark:text-slate-300">OCTOFIX24v09</span> · 100% rinnovabile · DispBT gratuito · 0 € penali di recesso.{' '}
                      {octopusContractRecords.length > 0
                        ? 'Il documento Octopus archiviato è il contratto, non una bolletta.'
                        : offerSummaries.some((o) => o.supplier.toLowerCase().includes('octopus'))
                          ? 'Le bollette sono consultabili nello storico.'
                          : 'Le bollette saranno registrate quando partirà la fornitura nel 2027.'}
                    </p>
                  </div>
                  {octopusContractToManage && !readOnly && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {vaultMeta[
                        getElectricityBillFileKey(octopusContractToManage.invoiceNumber)
                      ] && (
                        <button
                          type="button"
                          onClick={() =>
                            void downloadShareableItem(
                              buildElectricityBillSharePayload(octopusContractToManage)
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200 bg-emerald-500/10 dark:bg-emerald-500/15 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/25 border border-emerald-500/25 dark:border-emerald-500/30 rounded-lg"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Scarica contratto PDF
                        </button>
                      )}
                      {confirmDeleteOctopus ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/10 dark:bg-rose-500/15 border border-rose-500/30 dark:border-rose-500/40 rounded-lg text-[11px]">
                          <span className="text-rose-700 dark:text-rose-200">Rimuovere contratto + PDF?</span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteOctopusContract()}
                            className="px-2 py-0.5 font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded"
                          >
                            Conferma
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteOctopus(false)}
                            className="px-2 py-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                          >
                            Annulla
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteOctopus(true)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Rimuovi contratto
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Materia Prima (Fissa)
                    </div>
                    <div className="text-sm font-bold font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                      0,1595 €/kWh
                    </div>
                    <div className="text-[10px] text-slate-500">bloccato 24m · no PUN</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Fisso Fornitore
                    </div>
                    <div className="text-sm font-bold font-mono text-sky-700 dark:text-sky-300 mt-0.5">
                      6,00 €/mese
                    </div>
                    <div className="text-[10px] text-slate-500">72 €/anno (-28 €/a vs Edison)</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Costo Reale / kWh
                    </div>
                    <div className="text-sm font-bold font-mono text-violet-700 dark:text-violet-300 mt-0.5">
                      {octopusEstimate.allInPerKwh !== null
                        ? `~${octopusEstimate.allInPerKwh.toFixed(3).replace('.', ',')} €/kWh`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500">stima tutto incluso · no TV</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Speso Solo Luce
                    </div>
                    <div className="text-sm font-bold font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      In attesa
                    </div>
                    <div className="text-[10px] text-slate-500">bollette 2027 · SDD</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Media Mensile
                    </div>
                    <div className="text-sm font-bold font-mono text-amber-700 dark:text-amber-300 mt-0.5">
                      {octopusEstimate.monthlyEur !== null
                        ? `~${octopusEstimate.monthlyEur.toFixed(0)} €/mese`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500">stima ai tuoi consumi</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Scadenza / Vincoli
                    </div>
                    <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                      24 mesi
                    </div>
                    <div className="text-[10px] text-slate-500">0 € penali · ribasso libero</div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  <strong className="text-slate-800 dark:text-slate-200">0,1595 €/kWh non è il PUN</strong>: è il prezzo fisso della materia prima energia (perdite incluse), bloccato per <strong className="text-slate-800 dark:text-slate-200">24 mesi</strong>. Si aggiungono solo i 6 €/mese di commercializzazione, il dispacciamento (0,0146 €/kWh) e gli oneri/imposte di legge.
                </p>

                <div className="space-y-2 pt-2.5 border-t border-slate-200 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        Confronto tariffe mercato (Solo Luce ·{' '}
                        <strong className="text-slate-900 dark:text-slate-100">{marketMonitor.competitors.length}</strong> fornitori di riferimento) vs tua{' '}
                        <span className="font-mono text-emerald-700 dark:text-emerald-300">
                          {marketMonitor.myLockedRate.toFixed(4).replace('.', ',')} €/kWh
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {marketMonitor.currentRate !== null && (
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          Octopus oggi:{' '}
                          <strong
                            className={
                              marketMonitor.currentRate < marketMonitor.myLockedRate
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-amber-700 dark:text-amber-300'
                            }
                          >
                            {marketMonitor.currentRate.toFixed(4).replace('.', ',')} €/kWh
                          </strong>
                        </span>
                      )}
                      {marketMonitor.updatedAt && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(marketMonitor.updatedAt).toLocaleDateString('it-IT')}
                        </span>
                      )}
                    </div>
                  </div>

                  {marketMonitor.competitors.length > 0 && (
                    <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span>Siti Tracciati Solo Luce (clicca per aprire l&apos;offerta ufficiale)</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300">
                          Tuo benchmark: {myAnnualBenchmarkEur.toFixed(0)} €/anno (2.300 kWh + PCV)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {marketMonitor.competitors.map((comp) => {
                          const isCheaper =
                            comp.estAnnualEur !== null && comp.estAnnualEur < myAnnualBenchmarkEur - 5;
                          let hostname = '';
                          try {
                            hostname = new URL(comp.url).hostname.replace(/^www\./, '');
                          } catch {
                            hostname = '';
                          }
                          return (
                            <a
                              key={comp.supplier}
                              href={comp.url}
                              target="_blank"
                              rel="noreferrer"
                              title={`Apri ${comp.offerName} su ${hostname}`}
                              className={`group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border transition-colors ${
                                isCheaper
                                  ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/35 dark:border-emerald-400/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/15 dark:hover:bg-emerald-500/20'
                                  : 'bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-sky-500/40 hover:bg-slate-50 dark:hover:bg-slate-900'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 truncate">
                                  <strong className="text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors">
                                    {comp.supplier}
                                  </strong>
                                  <ExternalLink className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-sky-600 dark:group-hover:text-sky-400 shrink-0 transition-colors" />
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                  {comp.offerName}
                                  {hostname ? ` · ${hostname}` : ''}
                                </div>
                              </div>
                              <div className="text-right font-mono shrink-0">
                                {comp.rateEurKwh !== null ? (
                                  <>
                                    <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                                      {comp.rateEurKwh.toFixed(4).replace('.', ',')} €/kWh
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                      {comp.fixedEurMonth !== null
                                        ? `+ ${comp.fixedEurMonth.toFixed(0)} €/m`
                                        : ''}
                                      {comp.estAnnualEur !== null
                                        ? ` · ~${comp.estAnnualEur.toFixed(0)} €/a`
                                        : ''}
                                    </div>
                                  </>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-[10px] text-slate-600 dark:text-slate-400 group-hover:text-sky-700 dark:group-hover:text-sky-300">
                                    Vedi sul sito
                                  </span>
                                )}
                              </div>
                            </a>
                          );
                        })}
                      </div>
                      {marketMonitor.bestCompetitor &&
                        marketMonitor.bestCompetitor.estAnnualEur !== null &&
                        marketMonitor.bestCompetitor.estAnnualEur < myAnnualBenchmarkEur - 5 && (
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
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
          {filteredBills.length > 0 ? (
            <div
              id="storico-bollette-luce"
              className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden scroll-mt-16 shadow-xs dark:shadow-none"
            >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Storico Bollette Luce ({filteredBills.length})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {readOnly ? (
                    <>
                      Senza accesso puoi scaricare o condividere il <strong className="text-sky-700 dark:text-sky-300">riepilogo HTML</strong>; il PDF originale non è accessibile pubblicamente.
                    </>
                  ) : (
                    <>
                      Scarica l&apos;originale se presente, importalo se manca e usa <strong className="text-sky-700 dark:text-sky-300">Condividi</strong> per inviare il riepilogo.
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Anno
                  <select
                    value={selectedBillYear}
                    onChange={(event) => setSelectedBillYear(event.target.value)}
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-200 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                  >
                    <option value="all">Tutti</option>
                    {billYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Fornitore
                  <select
                    value={selectedBillSupplier}
                    onChange={(event) => setSelectedBillSupplier(event.target.value)}
                    className="max-w-48 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-200 dark:[color-scheme:dark] focus:outline-none focus:border-sky-500"
                  >
                    <option value="all">Tutti</option>
                    {billSuppliers.map((supplier) => (
                      <option key={supplier} value={supplier}>
                        {supplier}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* KPI Bollette */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/30">
              <div className="col-span-2 sm:col-span-4 text-[11px] text-slate-500 dark:text-slate-400">
                Riepilogo filtrato · {selectedBillYear === 'all' ? 'tutti gli anni' : selectedBillYear}
                {' · '}
                {selectedBillSupplier === 'all' ? 'tutti i fornitori' : selectedBillSupplier}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Totale Pagato
                </div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {billsTotals.total.toFixed(2).replace('.', ',')} €
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Solo Luce</div>
                <div className="text-base font-bold font-mono tabular-nums text-sky-700 dark:text-sky-300 mt-0.5">
                  {billsTotals.elec.toFixed(2).replace('.', ',')} €
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Canone TV</div>
                <div className="text-base font-bold font-mono tabular-nums text-amber-700 dark:text-amber-300 mt-0.5">
                  {billsTotals.tv.toFixed(2).replace('.', ',')} €
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  kWh / Media Reale
                </div>
                <div className="text-base font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {billsTotals.kwh} kWh · {billsTotals.avgElecPerKwh.toFixed(2).replace('.', ',')}{' '}
                  €/kWh
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
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
                      sortKey="total"
                      currentSort={elecSort}
                      onSort={(k) => setElecSort((prev) => toggleSort(prev, k, 'desc'))}
                      align="right"
                      className="px-4 py-2.5 font-medium text-right"
                    >
                      Totale
                    </SortableTh>
                    <th className="px-3 py-2.5 font-medium text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                  {sortedElecBills.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                        Nessuna bolletta corrisponde ai filtri selezionati.
                      </td>
                    </tr>
                  )}
                  {sortedElecBills.map((b) => {
                    const fileKey = getElectricityBillFileKey(b.invoiceNumber);
                    const hasPdf = Boolean(vaultMeta[fileKey]);
                    const canDeleteBill = Boolean(
                      onDeleteElectricityBill &&
                        propElectricityBills?.some(
                          (persistedBill) => persistedBill.invoiceNumber === b.invoiceNumber
                        )
                    );
                    const sharePayload = buildElectricityBillSharePayload(b);
                    return (
                      <tr key={b.invoiceNumber} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                          <div>{b.period}</div>
                          {b.note && <div className="text-[10px] text-emerald-700 dark:text-emerald-400">{b.note}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                          <div>{b.supplier}</div>
                          <div className="text-[10px] text-slate-500">{b.offerName}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-500 dark:text-slate-400">
                          <div>#{b.invoiceNumber}</div>
                          <div className="text-[10px]">{b.issueDate}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">{b.kwh}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {b.punText}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-sky-700 dark:text-sky-300">
                          {b.electricityOnly.toFixed(2).replace('.', ',')} €
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {b.totalPaid.toFixed(2).replace('.', ',')} €
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {!readOnly && !hasPdf ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAttachingFileKey(fileKey);
                                  attachFileInputRef.current?.click();
                                }}
                                title="Importa il PDF originale di questa bolletta"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 dark:text-sky-200 bg-sky-500/10 dark:bg-sky-500/15 hover:bg-sky-500/20 dark:hover:bg-sky-500/25 border border-sky-500/30 rounded-lg transition-colors"
                              >
                                <FileUp className="w-3.5 h-3.5" />
                                Importa
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  void downloadShareableItem(
                                    readOnly
                                      ? { ...sharePayload, attachmentKey: undefined }
                                      : sharePayload
                                  )
                                }
                                title={
                                  readOnly
                                    ? 'Scarica riepilogo HTML'
                                    : `Scarica il PDF originale (${vaultMeta[fileKey]?.fileName})`
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg transition-colors"
                              >
                                <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                                Scarica
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteBillFromShare(canDeleteBill ? b : null);
                                setShareBillItem(sharePayload);
                              }}
                              title="Condividi il riepilogo o il PDF della bolletta"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-500/10 dark:bg-sky-500/15 hover:bg-sky-500/20 dark:hover:bg-sky-500/25 border border-sky-500/30 dark:border-sky-500/35 text-sky-700 dark:text-sky-300 rounded-lg transition-colors"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              Condividi
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nessuna bolletta luce con PDF presente per i filtri selezionati.
              {!readOnly && ' Importa il PDF originale per aggiungerla allo storico.'}
            </div>
          )}

          {/* Guida semplice alla bolletta */}
          <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs dark:shadow-none">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
              <HelpCircle className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              La tua bolletta in parole semplici
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3">
                <div className="font-semibold text-sky-700 dark:text-sky-300 mb-1">1. Prezzo Energia (PUN vs Fisso)</div>
                <p className="text-slate-600 dark:text-slate-400">
                  Il <strong className="text-slate-900 dark:text-slate-200">PUN</strong> è il prezzo all&apos;ingrosso della luce in Italia (cambia ogni mese). Con Edison 2026 la tariffa è monoraria (stesso prezzo giorno e notte) e variabile sul PUN; con una tariffa fissa invece blocchi il prezzo per 12–24 mesi.
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1">2. Costi Fissi (33,35 €/mese)</div>
                <p className="text-slate-600 dark:text-slate-400">
                  Anche a 0 kWh paghi <strong className="text-slate-900 dark:text-slate-200">24,35 €/mese</strong> di luce (fisso fornitore + rete + potenza 6 kW, IVA incl.) + <strong className="text-slate-900 dark:text-slate-200">9,00 €/mese</strong> di Canone TV. Quando cambi fornitore cambia solo la quota fissa del fornitore.
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3">
                <div className="font-semibold text-indigo-700 dark:text-indigo-300 mb-1">3. Cosa NON cambia mai</div>
                <p className="text-slate-600 dark:text-slate-400">
                  <strong className="text-slate-900 dark:text-slate-200">Canone TV</strong> (90 €/anno in 10 rate da 9 €) e <strong className="text-slate-900 dark:text-slate-200">costi di rete/potenza 6 kW</strong> sono fissati dallo Stato/ARERA: restano identici con qualsiasi fornitore.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <input
        ref={attachFileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={(e) => void handleAttachPdfToBill(e.target.files)}
        className="hidden"
      />
      <input
        ref={gseAttachmentInputRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        onChange={(e) => void handleAttachGseFile(e.target.files)}
        className="hidden"
      />

      {shareBillItem && (
        <ShareSheetModal
          item={shareBillItem}
          readOnly={readOnly}
          onClose={() => {
            setShareBillItem(null);
            setDeleteBillFromShare(null);
          }}
          onReplaceAttachment={() => {
            if (!shareBillItem.attachmentKey) return;
            setAttachingFileKey(shareBillItem.attachmentKey);
            attachFileInputRef.current?.click();
          }}
          onDeleteItem={
            deleteBillFromShare && onDeleteElectricityBill
              ? () => onDeleteElectricityBill(deleteBillFromShare)
              : undefined
          }
        />
      )}

      {importModalKind && (
        <BillImportModal
          defaultKind={importModalKind === 'auto' ? undefined : importModalKind}
          existingElectricityBills={allElectricityRecords.filter(
            (bill) => !isOctopusContractRecord(bill)
          )}
          existingWaterBills={propWaterBills}
          existingTariBills={propTariBills}
          onClose={() => setImportModalKind(null)}
          onSaveElectricityBill={onAddElectricityBill}
          onSaveWaterBill={onAddWaterBill}
          onSaveTariBill={onAddTariBill}
        />
      )}
    </div>
  );
}
