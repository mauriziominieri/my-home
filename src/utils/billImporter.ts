import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BillRecord, TariBillRecord, WaterBillRecord } from '../types/home';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ImportedBillDraft =
  | {
      id: string;
      kind: 'luce';
      fileName: string;
      sourceFile?: File;
      sourceFileFingerprint?: string;
      confidence: 'alta' | 'media' | 'manuale';
      rawPreview: string;
      data: BillRecord;
    }
  | {
      id: string;
      kind: 'acqua';
      fileName: string;
      sourceFile?: File;
      sourceFileFingerprint?: string;
      confidence: 'alta' | 'media' | 'manuale';
      rawPreview: string;
      data: Omit<WaterBillRecord, 'id'>;
    }
  | {
      id: string;
      kind: 'tari';
      fileName: string;
      sourceFile?: File;
      sourceFileFingerprint?: string;
      confidence: 'alta' | 'media' | 'manuale';
      rawPreview: string;
      data: Omit<TariBillRecord, 'id'>;
    };

export type BillImportIdentityCandidate =
  | { kind: 'luce'; data: BillRecord; sourceFileFingerprint?: string }
  | { kind: 'acqua'; data: Omit<WaterBillRecord, 'id'>; sourceFileFingerprint?: string }
  | { kind: 'tari'; data: Omit<TariBillRecord, 'id'>; sourceFileFingerprint?: string };

function normalizeBillIdentity(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function amountIdentity(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

export function getBillImportIdentityKeys(candidate: BillImportIdentityCandidate): string[] {
  const keys: string[] = [];
  const { kind, data, sourceFileFingerprint } = candidate;
  if (sourceFileFingerprint) keys.push(`file:${sourceFileFingerprint}`);

  if (kind === 'luce') {
    const supplier = normalizeBillIdentity(data.supplier);
    const invoice = normalizeBillIdentity(data.invoiceNumber);
    if (supplier && invoice) keys.push(`luce:invoice:${supplier}:${invoice}`);
    const period = normalizeBillIdentity(data.sortKey || data.period);
    if (supplier && period && data.kwh > 0 && data.totalPaid > 0) {
      keys.push(
        `luce:bill:${supplier}:${period}:${data.kwh}:${amountIdentity(data.totalPaid)}`
      );
    }
  } else if (kind === 'acqua') {
    const invoice = normalizeBillIdentity(data.invoiceNumber);
    if (invoice) keys.push(`acqua:invoice:${invoice}`);
    const period = normalizeBillIdentity(data.period || String(data.year));
    if (period && data.cubicMeters > 0 && data.totalPaid > 0) {
      keys.push(
        `acqua:bill:${period}:${data.cubicMeters}:${amountIdentity(data.totalPaid)}`
      );
    }
  } else {
    const supplier = normalizeBillIdentity(data.supplier);
    const notice = normalizeBillIdentity(data.noticeNumber);
    if (supplier && notice) keys.push(`tari:notice:${supplier}:${notice}`);
    const period = normalizeBillIdentity(data.period || String(data.year));
    if (supplier && period && data.totalPaid > 0) {
      keys.push(`tari:bill:${supplier}:${data.year}:${period}:${amountIdentity(data.totalPaid)}`);
    }
  }

  return keys;
}

const IT_MONTHS_SHORT: Record<string, string> = {
  GEN: '01',
  GENNAIO: '01',
  FEB: '02',
  FEBBRAIO: '02',
  MAR: '03',
  MARZO: '03',
  APR: '04',
  APRILE: '04',
  MAG: '05',
  MAGGIO: '05',
  GIU: '06',
  GIUGNO: '06',
  LUG: '07',
  LUGLIO: '07',
  AGO: '08',
  AGOSTO: '08',
  SET: '09',
  SETTEMBRE: '09',
  OTT: '10',
  OTTOBRE: '10',
  NOV: '11',
  NOVEMBRE: '11',
  DIC: '12',
  DICEMBRE: '12',
};

export function parseItNumber(raw: string | undefined): number {
  if (!raw) return 0;
  let cleaned = raw.trim().replace(/[€"\s]/g, '');
  // Handle European formatting like 1.234,56 vs 123.45
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const val = Number.parseFloat(cleaned);
  return Number.isFinite(val) && val >= 0 ? val : 0;
}

export async function extractPdfTextFromBytes(
  pdfBytes: Uint8Array,
  maxPages = 5
): Promise<string> {
  // Clone bytes because pdfjs transfers the underlying ArrayBuffer to its worker (detaching it).
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  const pdf = await loadingTask.promise;
  const pageLimit = Math.min(maxPages, pdf.numPages);
  const pageTexts: string[] = [];

  for (let p = 1; p <= pageLimit; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += (line ? ' ' : '') + item.str;
      if ('hasEOL' in item && item.hasEOL) {
        lines.push(line.trim());
        line = '';
      }
    }
    if (line.trim()) lines.push(line.trim());
    pageTexts.push(lines.join('\n'));
  }

  return pageTexts.join('\n');
}

export function extractPodCodeFromText(text: string): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').toUpperCase();
  const labeled = normalized.match(/\bPOD\b[^A-Z0-9]{0,20}(IT\d{3}E[A-Z0-9]{6,12})\b/);
  if (labeled?.[1]) return labeled[1];
  const generic = normalized.match(/\b(IT00[12]E[A-Z0-9]{6,12})\b/);
  return generic?.[1] || null;
}

function parseItDateSortable(raw: string): number {
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  return Number(`${m[3]}${m[2]}${m[1]}`);
}

export interface DerivedPlantParamsFromBills {
  latestBill: BillRecord | null;
  tariffEurPerKwh: number | null;
  variableRateEurPerKwh: number | null;
}

export function derivePlantParamsFromBills(
  bills: BillRecord[]
): DerivedPlantParamsFromBills {
  const realBills = bills.filter((b) => {
    const invLower = (b.invoiceNumber || '').toLowerCase();
    const offerLower = (b.offerName || '').toLowerCase();
    if (invLower.includes('contratto') || offerLower.includes('contratto')) {
      return false;
    }
    return b.kwh > 0 || b.electricityOnly > 0 || b.variableCostPerKwh > 0;
  });

  if (realBills.length === 0) {
    return { latestBill: null, tariffEurPerKwh: null, variableRateEurPerKwh: null };
  }

  const sorted = [...realBills].sort((a, b) => {
    const keyCmp = (b.sortKey || '').localeCompare(a.sortKey || '');
    if (keyCmp !== 0) return keyCmp;
    return parseItDateSortable(b.issueDate) - parseItDateSortable(a.issueDate);
  });

  const latest = sorted[0];
  let tariffEurPerKwh: number | null = null;
  if (latest.kwh > 0 && latest.electricityOnly > 0) {
    const effective = Math.round((latest.electricityOnly / latest.kwh) * 1000) / 1000;
    if (effective >= 0.05 && effective <= 2.5) {
      tariffEurPerKwh = effective;
    }
  }
  if (tariffEurPerKwh === null && latest.variableCostPerKwh > 0 && latest.variableCostPerKwh <= 2.5) {
    tariffEurPerKwh = Math.round(latest.variableCostPerKwh * 1000) / 1000;
  }

  const variableRateEurPerKwh =
    latest.variableCostPerKwh > 0
      ? Math.round(latest.variableCostPerKwh * 1000) / 1000
      : null;

  return {
    latestBill: latest,
    tariffEurPerKwh,
    variableRateEurPerKwh,
  };
}

export function parseEdisonPdfText(text: string): BillRecord | null {
  if (!text.trim()) return null;

  let invMatch = text.match(/Bolletta\s+n\.?\s*(\d+)\s+del\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (!invMatch) {
    invMatch = text.match(/Fattura\s+N°?\s*(\d+)\s+del\s+(\d{2}\/\d{2}\/\d{4})/i);
  }
  if (!invMatch) return null;

  const invoiceNumber = invMatch[1].slice(0, 40);
  const issueDate = invMatch[2].slice(0, 20);

  const periodMatch = text.match(/Periodo\s+([A-Z]{3}\s+\d{4}\s*-\s*[A-Z]{3}\s+\d{4})/i);
  const rawPeriod = periodMatch ? periodMatch[1].trim() : issueDate;

  let year = new Date().getFullYear();
  let sortKey = `${year}-01`;
  const endMatch = rawPeriod.match(/-\s*([A-Z]{3})\s+(\d{4})/i);
  if (endMatch) {
    year = Number(endMatch[2]);
    const mm = IT_MONTHS_SHORT[endMatch[1].toUpperCase()] || '01';
    sortKey = `${year}-${mm}`;
  } else {
    const parts = issueDate.split('/');
    if (parts.length === 3) {
      year = Number(parts[2]);
      sortKey = `${parts[2]}-${parts[1]}`;
    }
  }

  let kwhMatch = text.match(/(\d+(?:\.\d+)?)\s*kWh\s+0,\d+\s*€\/kWh/);
  if (!kwhMatch) {
    kwhMatch = text.match(/TOTALI\s+(\d+(?:\.\d+)?)\s*kWh/i);
  }
  const kwh = kwhMatch ? Math.round(parseItNumber(kwhMatch[1])) : 0;

  const varMatch = text.match(/\d+\s*kWh\s+(0,\d+)\s*€\/kWh/);
  const varNet = varMatch ? parseItNumber(varMatch[1]) : 0;
  const variableCostPerKwh =
    varNet > 0 ? Math.round((varNet + 0.0227) * 1.1 * 1000) / 1000 : 0;

  const totMatch = text.match(/TOTALE\s+DA\s+PAGARE\s+([\d.,]+)\s*€/i);
  const totalPaid = totMatch ? Math.round(parseItNumber(totMatch[1]) * 100) / 100 : 0;

  const tvMatch = text.match(
    /Canone\s+di\s+abbonamento\s+alla\s+televisione[^\n]*?([\d.,]+)\s*€/i
  );
  const canoneTv = tvMatch ? Math.round(parseItNumber(tvMatch[1]) * 100) / 100 : 0;

  const elecMatch = text.match(/TOTALE\s+BOLLETTA\s+([\d.,]+)\s*€/i);
  const electricityOnly = elecMatch
    ? Math.round(parseItNumber(elecMatch[1]) * 100) / 100
    : Math.round(Math.max(0, totalPaid - canoneTv) * 100) / 100;

  const punMatches = [...text.matchAll(/\d{2}\/\d{4}\s+(0,\d{4,6})/g)];
  const punVals = punMatches
    .slice(0, 2)
    .map((m) => parseItNumber(m[1]).toFixed(3).replace('.', ','));
  const punText = punVals.length > 0 ? `${punVals.join(' / ')} €` : '—';

  const offerMatch = text.match(/Nome\s+Offerta:\s*([^\n]+)/i);
  const offerName = offerMatch ? offerMatch[1].trim().slice(0, 100) : 'EDISON DYNAMIC LUCE';

  const formattedPeriod = rawPeriod
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(' - ', ' – ')
    .slice(0, 80);

  return {
    invoiceNumber,
    issueDate,
    sortKey,
    year,
    period: formattedPeriod,
    supplier: 'Edison Energia',
    offerName,
    kwh,
    punText: punText.slice(0, 60),
    variableCostPerKwh,
    canoneTv,
    electricityOnly,
    totalPaid,
  };
}

export function parseTariPdfText(
  text: string,
  msgSubject = '',
  msgDate = ''
): Omit<TariBillRecord, 'id'> | null {
  if (!text.trim()) return null;

  const noticeMatch = text.match(
    /(?:Avviso(?:\s+di\s+pagamento)?|Documento|N°|Numero|Codice\s+Avviso)\s*(?:n\.?|numero)?\s*[:#]?\s*([A-Z0-9/-]{5,30})/i
  );
  let noticeNumber = noticeMatch ? noticeMatch[1].trim() : '';

  const issueMatch = text.match(
    /(?:data\s+emissione|emesso\s+il|del)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i
  );
  const dueMatch = text.match(
    /(?:scadenza|entro\s+il|pagare\s+entro\s+il)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i
  );
  const allDates = [...text.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)].map((m) => m[1]);
  const issueDate = issueMatch ? issueMatch[1] : allDates[0] || '—';
  const dueDate = dueMatch ? dueMatch[1] : allDates[allDates.length - 1] || issueDate;

  let yearMatch = `${text} ${msgSubject}`.match(/TARI\s+(20\d{2})/i);
  if (!yearMatch) {
    yearMatch = text.match(/Anno(?:\s+d['’]imposta)?\s*[:.]?\s*(20\d{2})/i);
  }
  const year = yearMatch
    ? Number(yearMatch[1])
    : dueDate.includes('/')
      ? Number(dueDate.split('/').pop()) || new Date().getFullYear()
      : new Date().getFullYear();

  const amountPatterns = [
    /(?:TOTALE\s+DA\s+PAGARE|IMPORTO\s+DA\s+PAGARE|TOTALE\s+AVVISO|TOTALE\s+DOVUTO)\s*[:€\s]*([\d.,]+)/i,
    /(?:Importo|Totale)\s*[:\s]*€?\s*([\d.,]+)\s*€/i,
    /€\s*([\d]{1,4}[.,]\d{2})/,
  ];
  let totalPaid = 0;
  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m) {
      const cand = Math.round(parseItNumber(m[1]) * 100) / 100;
      if (cand > 0) {
        totalPaid = cand;
        break;
      }
    }
  }

  if (totalPaid <= 0 && !noticeNumber) return null;

  if (!noticeNumber) {
    const cleanDue = dueDate.replace(/\//g, '');
    noticeNumber = `TARI_${year}_${cleanDue || Math.round(totalPaid * 100)}`;
  }

  const rataMatch = text.match(/(Rata\s+\d+|Unica\s+Soluzione|Saldo|Acconto)/i);
  const rataLabel = rataMatch
    ? rataMatch[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Avviso di pagamento';

  const supplier = text.toLowerCase().includes('acegas')
    ? 'AcegasApsAmga (TARI)'
    : text.toLowerCase().includes('comune di padova')
      ? 'Comune di Padova (TARI)'
      : 'Ente / TARI';

  return {
    noticeNumber: noticeNumber.slice(0, 50),
    issueDate: issueDate.slice(0, 20),
    dueDate: dueDate.slice(0, 20),
    year,
    period: `TARI ${year} – ${rataLabel}`.slice(0, 80),
    supplier,
    totalPaid,
    paid: false,
    source: msgDate ? 'gmail-pdf' : 'manuale',
    note: msgDate
      ? `Estratto da Gmail (${msgDate.slice(0, 16)})`.slice(0, 240)
      : undefined,
  };
}

function detectElectricitySupplier(text: string, fileName: string): {
  supplier: string;
  defaultOffer: string;
} {
  const hay = `${text}\n${fileName}`.toLowerCase();
  if (hay.includes('octopus')) {
    return { supplier: 'Octopus Energy', defaultOffer: 'Octopus Fissa 24M' };
  }
  if (hay.includes('edison')) {
    return { supplier: 'Edison Energia', defaultOffer: 'Edison Dynamic Luce' };
  }
  if (hay.includes('enel')) {
    return { supplier: 'Enel Energia', defaultOffer: 'Offerta Enel Luce' };
  }
  if (hay.includes('plenitude') || hay.includes('eni ')) {
    return { supplier: 'Eni Plenitude', defaultOffer: 'Fixa / Trend Luce' };
  }
  if (hay.includes('engie')) {
    return { supplier: 'ENGIE', defaultOffer: 'Energia PuntoFisso' };
  }
  if (hay.includes('sorgenia')) {
    return { supplier: 'Sorgenia', defaultOffer: 'Next Energy Luce' };
  }
  if (hay.includes('nen')) {
    return { supplier: 'NeN', defaultOffer: 'Luce Prezzo Bloccato' };
  }
  if (hay.includes('a2a')) {
    return { supplier: 'A2A Energia', defaultOffer: 'A2A Luce' };
  }
  if (hay.includes('hera')) {
    return { supplier: 'Hera Comm', defaultOffer: 'Hera Luce' };
  }
  if (hay.includes('acea')) {
    return { supplier: 'Acea Energia', defaultOffer: 'Acea Luce' };
  }
  if (hay.includes('illumia')) {
    return { supplier: 'Illumia', defaultOffer: 'Illumia Luce' };
  }
  return { supplier: 'Fornitore Luce', defaultOffer: 'Offerta Energia Elettrica' };
}

function extractSortKeyAndYear(
  text: string,
  issueDate: string
): { year: number; sortKey: string; period: string } {
  const dateParts = issueDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const isoDateParts = issueDate.match(/^(20\d{2})[-/](\d{2})[-/]\d{2}$/);
  let year = dateParts
    ? Number(dateParts[3])
    : isoDateParts
      ? Number(isoDateParts[1])
      : new Date().getFullYear();
  let month = dateParts
    ? dateParts[2]
    : isoDateParts
      ? isoDateParts[2]
      : String(new Date().getMonth() + 1).padStart(2, '0');

  const monthRange = text.match(
    /\b(GEN(?:NAIO)?|FEB(?:BRAIO)?|MAR(?:ZO)?|APR(?:ILE)?|MAG(?:GIO)?|GIU(?:GNO)?|LUG(?:LIO)?|AGO(?:STO)?|SET(?:TEMBRE)?|OTT(?:OBRE)?|NOV(?:EMBRE)?|DIC(?:EMBRE)?)\s+(20\d{2})\s*[-–]\s*(GEN(?:NAIO)?|FEB(?:BRAIO)?|MAR(?:ZO)?|APR(?:ILE)?|MAG(?:GIO)?|GIU(?:GNO)?|LUG(?:LIO)?|AGO(?:STO)?|SET(?:TEMBRE)?|OTT(?:OBRE)?|NOV(?:EMBRE)?|DIC(?:EMBRE)?)\s+(20\d{2})\b/i
  );
  if (monthRange) {
    const startMonth = monthRange[1].slice(0, 3);
    const endMonth = monthRange[3].slice(0, 3);
    year = Number(monthRange[4]);
    month = IT_MONTHS_SHORT[monthRange[3].toUpperCase()] || month;
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return {
      year,
      sortKey: `${year}-${month}`,
      period: `${cap(startMonth)} ${monthRange[2]} – ${cap(endMonth)} ${monthRange[4]}`,
    };
  }

  const dateRange = text.match(
    /(?:periodo(?:\s+di\s+fatturazione)?|dal)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})\s*(?:al|-|–)\s*(\d{2}\/\d{2}\/\d{4})/i
  );
  if (dateRange) {
    const endParts = dateRange[2].split('/');
    if (endParts.length === 3) {
      year = Number(endParts[2]);
      month = endParts[1];
      const monthNames = [
        'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
      ];
      const startParts = dateRange[1].split('/');
      const sLabel =
        startParts.length === 3
          ? `${monthNames[Math.max(0, Number(startParts[1]) - 1)] || startParts[1]} ${startParts[2]}`
          : dateRange[1];
      const eLabel = `${monthNames[Math.max(0, Number(endParts[1]) - 1)] || endParts[1]} ${endParts[2]}`;
      return {
        year,
        sortKey: `${year}-${month}`,
        period: sLabel === eLabel ? sLabel : `${sLabel} – ${eLabel}`,
      };
    }
  }

  const numericMonth = text.match(
    /(?:mese\s+di|competenza|periodo)\s*[:.]?\s*(0?[1-9]|1[0-2])[-/](20\d{2})\b/i
  );
  if (numericMonth) {
    year = Number(numericMonth[2]);
    month = numericMonth[1].padStart(2, '0');
    const monthNames = [
      'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
    ];
    return {
      year,
      sortKey: `${year}-${month}`,
      period: `${monthNames[Number(month) - 1]} ${year}`,
    };
  }

  const singleMonth = text.match(
    /(?:mese\s+di|competenza|periodo)\s*[:.]?\s*(gen(?:naio)?|feb(?:braio)?|mar(?:zo)?|apr(?:ile)?|mag(?:gio)?|giu(?:gno)?|lug(?:lio)?|ago(?:sto)?|set(?:tembre)?|ott(?:obre)?|nov(?:embre)?|dic(?:embre)?)\s+(20\d{2})/i
  );
  if (singleMonth) {
    year = Number(singleMonth[2]);
    month = IT_MONTHS_SHORT[singleMonth[1].toUpperCase()] || month;
    const cap = singleMonth[1].charAt(0).toUpperCase() + singleMonth[1].slice(1).toLowerCase();
    return {
      year,
      sortKey: `${year}-${month}`,
      period: `${cap} ${year}`,
    };
  }

  const isoMonth = text.match(
    /(?:mese\s+di|competenza|periodo)\s*[:.]?\s*(20\d{2})[-/](0?[1-9]|1[0-2])\b/i
  );
  if (isoMonth) {
    year = Number(isoMonth[1]);
    month = isoMonth[2].padStart(2, '0');
    const monthNames = [
      'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
    ];
    return {
      year,
      sortKey: `${year}-${month}`,
      period: `${monthNames[Number(month) - 1]} ${year}`,
    };
  }

  return {
    year,
    sortKey: `${year}-${month}`,
    period: issueDate !== '—' ? `Fattura ${issueDate}` : `Bolletta ${year}`,
  };
}

export function parseGenericElectricityPdfText(
  text: string,
  fileName: string
): { bill: BillRecord; confidence: 'alta' | 'media' | 'manuale' } {
  const edison = parseEdisonPdfText(text);
  if (edison) {
    return { bill: edison, confidence: 'alta' };
  }

  const { supplier, defaultOffer } = detectElectricitySupplier(text, fileName);

  const invPatterns = [
    /(?:fattura|bolletta|documento)\s*(?:elettronica)?\s*(?:n\.?|numero|n°)\s*[:#]?\s*([A-Z0-9/_-]{4,35})/i,
    /n°?\s*fattura\s*[:#]?\s*([A-Z0-9/_-]{4,35})/i,
    /codice\s+fattura\s*[:#]?\s*([A-Z0-9/_-]{4,35})/i,
  ];
  let invoiceNumber = '';
  for (const pat of invPatterns) {
    const m = text.match(pat);
    if (m && /\d/.test(m[1])) {
      invoiceNumber = m[1].trim();
      break;
    }
  }

  const issueMatch = text.match(
    /(?:data\s+(?:di\s+)?emissione|emessa\s+il|del)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i
  );
  const allDates = [...text.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)].map((m) => m[1]);
  const issueDate = issueMatch ? issueMatch[1] : allDates[0] || new Date().toLocaleDateString('it-IT');

  if (!invoiceNumber) {
    const baseName = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '');
    invoiceNumber = baseName.slice(0, 24) || `IMP_${Date.now().toString().slice(-6)}`;
  }

  const { year, sortKey, period } = extractSortKeyAndYear(text, issueDate);

  // Total paid
  const totPatterns = [
    /(?:totale\s+da\s+pagare|importo\s+totale\s+da\s+pagare|totale\s+fattura|importo\s+fattura|totale\s+addebito)\s*[:€\s]*([\d.,]+)/i,
    /totale\s*[:€\s]+([\d]{1,4}[.,]\d{2})\s*€?/i,
  ];
  let totalPaid = 0;
  for (const pat of totPatterns) {
    const m = text.match(pat);
    if (m) {
      const cand = Math.round(parseItNumber(m[1]) * 100) / 100;
      if (cand > 0 && cand < 20000) {
        totalPaid = cand;
        break;
      }
    }
  }

  // Canone TV
  const tvMatch = text.match(
    /canone(?:\s+di\s+abbonamento)?(?:\s+alla)?\s*(?:tv|rai|televisione)[^\n\r]{0,60}?([\d]{1,3}[.,]\d{2})\s*€?/i
  );
  const canoneTv = tvMatch ? Math.round(parseItNumber(tvMatch[1]) * 100) / 100 : 0;

  // kWh
  const kwhPatterns = [
    /(?:energia\s+fatturata|consumo\s+totale|consumo\s+fatturato|totale\s+kwh|energia\s+attiva)\s*[:\s]*([\d.,]+)\s*kWh/i,
    /([\d]{1,5}(?:[.,]\d+)?)\s*kWh\b/i,
  ];
  let kwh = 0;
  for (const pat of kwhPatterns) {
    const m = text.match(pat);
    if (m) {
      const cand = Math.round(parseItNumber(m[1]));
      if (cand > 0 && cand < 50000) {
        kwh = cand;
        break;
      }
    }
  }

  const electricityOnly = Math.round(Math.max(0, totalPaid - canoneTv) * 100) / 100;
  const variableMatch = text.match(/(0[.,]\d{3,5})\s*€\/kWh/i);
  const variableCostPerKwh = variableMatch
    ? Math.round(parseItNumber(variableMatch[1]) * 1000) / 1000
    : kwh > 0 && electricityOnly > 0
      ? Math.round((electricityOnly / kwh) * 1000) / 1000
      : 0.16;

  const punMatch = text.match(/\bPUN\b[^\n]{0,30}(0[.,]\d{3,5})/i);
  const punText = punMatch
    ? `${parseItNumber(punMatch[1]).toFixed(3).replace('.', ',')} €`
    : text.toLowerCase().includes('fiss')
      ? 'Fissa'
      : '—';

  const offerMatch = text.match(/(?:nome\s+offerta|offerta|tariffa)\s*[:\-]\s*([^\n]{3,60})/i);
  const offerName = offerMatch ? offerMatch[1].trim().slice(0, 100) : defaultOffer;

  const hits = [totalPaid > 0, kwh > 0, Boolean(invPatterns.some((p) => p.test(text)))].filter(
    Boolean
  ).length;

  return {
    bill: {
      invoiceNumber: invoiceNumber.slice(0, 40),
      issueDate: issueDate.slice(0, 20),
      sortKey,
      year,
      period: period.slice(0, 80),
      supplier: supplier.slice(0, 80),
      offerName,
      kwh,
      punText: punText.slice(0, 60),
      variableCostPerKwh,
      canoneTv,
      electricityOnly,
      totalPaid,
      note: `Importata da ${fileName}`.slice(0, 240),
    },
    confidence: hits >= 2 ? 'alta' : hits === 1 ? 'media' : 'manuale',
  };
}

export function parseGenericWaterPdfText(
  text: string,
  fileName: string
): { bill: Omit<WaterBillRecord, 'id'>; confidence: 'alta' | 'media' | 'manuale' } {
  const invMatch = text.match(
    /(?:fattura|bolletta|documento)\s*(?:n\.?|numero|n°)\s*[:#]?\s*([A-Z0-9/_-]{4,35})/i
  );
  const allDates = [...text.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)].map((m) => m[1]);
  const issueMatch = text.match(
    /(?:data\s+(?:di\s+)?emissione|emessa\s+il|del)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i
  );
  const issueDate = issueMatch ? issueMatch[1] : allDates[0] || new Date().toLocaleDateString('it-IT');
  const { year, period } = extractSortKeyAndYear(text, issueDate);

  const mcMatch = text.match(/([\d.,]+)\s*(?:m³|mc|metri\s+cubi)\b/i);
  const cubicMeters = mcMatch ? Math.round(parseItNumber(mcMatch[1]) * 10) / 10 : 0;

  const fixedMatch = text.match(/quota\s+fissa[^\n\r]{0,50}?([\d.,]+)\s*€?/i);
  const fixedCostEur = fixedMatch ? Math.round(parseItNumber(fixedMatch[1]) * 100) / 100 : 0;

  const totMatch = text.match(
    /(?:totale\s+da\s+pagare|totale\s+fattura|totale\s+bolletta|importo\s+totale)\s*[:€\s]*([\d.,]+)/i
  );
  const totalPaid = totMatch ? Math.round(parseItNumber(totMatch[1]) * 100) / 100 : 0;

  const baseName = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  const invoiceNumber = invMatch?.[1]
    ? invMatch[1].trim().slice(0, 40)
    : (baseName || `H2O_${Date.now().toString().slice(-6)}`).slice(0, 40);

  const hits = [totalPaid > 0, cubicMeters > 0, Boolean(invMatch)].filter(Boolean).length;
  return {
    bill: {
      invoiceNumber,
      issueDate: issueDate.slice(0, 20),
      year,
      period: period.slice(0, 80),
      cubicMeters,
      fixedCostEur,
      totalPaid,
      note: `Importata da ${fileName}`.slice(0, 240),
    },
    confidence: hits >= 2 ? 'alta' : hits === 1 ? 'media' : 'manuale',
  };
}

function detectUtilityKind(text: string, fileName: string): 'luce' | 'acqua' | 'tari' {
  const hay = `${fileName}\n${text.slice(0, 3500)}`.toLowerCase();
  if (
    hay.includes('tari') ||
    hay.includes('tassa rifiuti') ||
    hay.includes('tassa sui rifiuti') ||
    hay.includes('f24')
  ) {
    return 'tari';
  }
  if (
    hay.includes('servizio idrico') ||
    hay.includes('acquedotto') ||
    hay.includes('fognatura') ||
    hay.includes('depurazione') ||
    hay.includes('metri cubi') ||
    hay.includes('m³') ||
    (hay.includes('acqua') && !hay.includes('kwh'))
  ) {
    return 'acqua';
  }
  return 'luce';
}

function isContractDocument(text: string, fileName: string): boolean {
  const hay = `${fileName}\n${text.slice(0, 5000)}`.toLowerCase();
  const contractSignal =
    fileName.toLowerCase().includes('contratt') ||
    /\b(proposta\s+di\s+contratto|contratto\s+di\s+fornitura|modulo\s+di\s+adesione|contract)\b/.test(hay);
  const billSignal =
    /\b(bolletta|fattura|totale\s+da\s+pagare|importo\s+da\s+pagare|consumo\s+fatturato)\b/.test(
      hay
    );
  return contractSignal && !billSignal;
}

function parseCsvOrJsonText(
  content: string,
  fileName: string,
  forcedKind?: 'luce' | 'acqua' | 'tari'
): ImportedBillDraft[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && 'electricityBills' in parsed
          ? (parsed as { electricityBills?: unknown[] }).electricityBills || []
          : [parsed];

      const drafts: ImportedBillDraft[] = [];
      list.forEach((item, idx) => {
        if (!item || typeof item !== 'object') return;
        const rec = item as Record<string, unknown>;
        if ('cubicMeters' in rec) {
          drafts.push({
            id: `imp_${Date.now()}_${idx}`,
            kind: 'acqua',
            fileName,
            confidence: 'alta',
            rawPreview: JSON.stringify(rec, null, 2).slice(0, 900),
            data: {
              invoiceNumber: String(rec.invoiceNumber || `H2O_${idx + 1}`).slice(0, 40),
              issueDate: String(rec.issueDate || new Date().toLocaleDateString('it-IT')).slice(0, 20),
              year: Number(rec.year || new Date().getFullYear()),
              period: String(rec.period || 'Periodo importato').slice(0, 80),
              cubicMeters: Number(rec.cubicMeters || 0),
              fixedCostEur: Number(rec.fixedCostEur || 0),
              totalPaid: Number(rec.totalPaid || 0),
              note: rec.note ? String(rec.note).slice(0, 240) : undefined,
            },
          });
        } else if ('noticeNumber' in rec) {
          drafts.push({
            id: `imp_${Date.now()}_${idx}`,
            kind: 'tari',
            fileName,
            confidence: 'alta',
            rawPreview: JSON.stringify(rec, null, 2).slice(0, 900),
            data: {
              noticeNumber: String(rec.noticeNumber || `TARI_${idx + 1}`).slice(0, 50),
              issueDate: String(rec.issueDate || '—').slice(0, 20),
              dueDate: String(rec.dueDate || '—').slice(0, 20),
              year: Number(rec.year || new Date().getFullYear()),
              period: String(rec.period || 'TARI importata').slice(0, 80),
              supplier: String(rec.supplier || 'AcegasApsAmga / TARI').slice(0, 80),
              totalPaid: Number(rec.totalPaid || 0),
              paid: Boolean(rec.paid),
              source: 'manuale',
              note: rec.note ? String(rec.note).slice(0, 240) : undefined,
            },
          });
        } else {
          const totalPaid = Number(rec.totalPaid || 0);
          const canoneTv = Number(rec.canoneTv || 0);
          const electricityOnly = Number(
            rec.electricityOnly ?? Math.max(0, totalPaid - canoneTv)
          );
          const year = Number(rec.year || new Date().getFullYear());
          drafts.push({
            id: `imp_${Date.now()}_${idx}`,
            kind: 'luce',
            fileName,
            confidence: 'alta',
            rawPreview: JSON.stringify(rec, null, 2).slice(0, 900),
            data: {
              invoiceNumber: String(rec.invoiceNumber || `IMP_${idx + 1}`).slice(0, 40),
              issueDate: String(rec.issueDate || new Date().toLocaleDateString('it-IT')).slice(0, 20),
              sortKey: String(rec.sortKey || `${year}-01`).slice(0, 16),
              year,
              period: String(rec.period || `Bolletta ${year}`).slice(0, 80),
              supplier: String(rec.supplier || 'Fornitore Luce').slice(0, 80),
              offerName: String(rec.offerName || 'Tariffa Luce').slice(0, 100),
              kwh: Math.round(Number(rec.kwh || 0)),
              punText: String(rec.punText || '—').slice(0, 60),
              variableCostPerKwh: Number(rec.variableCostPerKwh || 0.16),
              canoneTv,
              electricityOnly,
              totalPaid,
              note: rec.note ? String(rec.note).slice(0, 240) : undefined,
            },
          });
        }
      });
      if (drafts.length > 0) return drafts;
    } catch {
      // fall through to text parsing
    }
  }

  // CSV line-by-line check
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0]?.includes(';') ? ';' : ',';
  if (lines.length >= 2 && lines[0].includes(sep)) {
    const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/"/g, ''));
    const hasBillHeader = headers.some((h) =>
      [
        'fattura',
        'invoice',
        'avviso',
        'totale',
        'total',
        'importo',
        'kwh',
        'fornitore',
        'periodo',
        'mc',
        'm3',
        'tari',
        'rifiuti',
      ].some((k) => h.includes(k))
    );
    if (hasBillHeader) {
      const idx = (keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
      const iInv = idx(['fattura', 'invoice', 'avviso', 'numero']);
      const iDate = idx(['data', 'emissione', 'date']);
      const iPeriod = idx(['periodo', 'period']);
      const iSupp = idx(['fornitore', 'supplier', 'ente']);
      const iKwh = idx(['kwh', 'consumo']);
      const iMc = idx(['mc', 'm3', 'metri']);
      const iTot = idx(['totale', 'total', 'importo']);
      const iTv = idx(['canone', 'tv']);
      const iDue = idx(['scadenza', 'due']);
      const iYear = idx(['anno', 'year']);
      const tariColumns =
        headers.some((h) => ['tari', 'rifiuti', 'tributo'].some((k) => h.includes(k))) ||
        (headers.some((h) => h.includes('avviso')) && iDue >= 0);
      const waterColumns = headers.some((h) =>
        ['m3', 'm³', 'mc', 'metri cubi'].some((k) => h.includes(k))
      );
      const drafts: ImportedBillDraft[] = [];

      for (let r = 1; r < lines.length; r++) {
        const cols = lines[r].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
        if (cols.every((c) => !c)) continue;
        const rowKind =
          forcedKind ||
          (tariColumns
            ? 'tari'
            : waterColumns
              ? 'acqua'
              : detectUtilityKind(lines[r], fileName));
        const issueDate = (iDate >= 0 ? cols[iDate] : '') || new Date().toLocaleDateString('it-IT');
        const dm = issueDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const periodValue = iPeriod >= 0 ? cols[iPeriod] : '';
        const periodInfo = extractSortKeyAndYear(
          `periodo ${periodValue}\n${lines[r]}`,
          issueDate
        );
        const yearValue = iYear >= 0 ? Number(cols[iYear]) : NaN;
        const year =
          Number.isFinite(yearValue) && yearValue > 0
            ? yearValue
            : periodValue
              ? periodInfo.year
              : dm
                ? Number(dm[3])
                : periodInfo.year;
        const sortKey = periodValue
          ? periodInfo.sortKey
          : dm
            ? `${dm[3]}-${dm[2]}`
            : periodInfo.sortKey || `${year}-01`;
        const totalPaid = iTot >= 0 ? parseItNumber(cols[iTot]) : 0;

        if (rowKind === 'tari') {
          const dueDate = (iDue >= 0 ? cols[iDue] : '') || issueDate;
          const dueYearMatch =
            dueDate.match(/\b(\d{2})\/\d{2}\/(20\d{2})\b/) ||
            dueDate.match(/\b(20\d{2})[-/]\d{2}[-/]\d{2}\b/);
          const tariYear =
            Number.isFinite(yearValue) && yearValue > 0
              ? yearValue
              : periodValue
                ? periodInfo.year
                : dueYearMatch
                  ? Number(dueYearMatch[dueYearMatch.length - 1])
                  : year;
          const noticeNumber = iInv >= 0 ? cols[iInv] : `TARI_${tariYear}_${r}`;
          drafts.push({
            id: `imp_${Date.now()}_${r}`,
            kind: 'tari',
            fileName,
            confidence: noticeNumber && totalPaid > 0 ? 'alta' : 'media',
            rawPreview: lines[r],
            data: {
              noticeNumber: noticeNumber.slice(0, 50),
              issueDate: issueDate.slice(0, 20),
              dueDate: dueDate.slice(0, 20),
              year: tariYear,
              period: (periodValue || `TARI ${tariYear}`).slice(0, 80),
              supplier: (iSupp >= 0 ? cols[iSupp] : 'Ente / TARI').slice(0, 80),
              totalPaid,
              paid: false,
              source: 'manuale',
              note: `Importata da ${fileName}`.slice(0, 240),
            },
          });
        } else if (rowKind === 'acqua' || (iMc >= 0 && cols[iMc])) {
          drafts.push({
            id: `imp_${Date.now()}_${r}`,
            kind: 'acqua',
            fileName,
            confidence: 'alta',
            rawPreview: lines[r],
            data: {
              invoiceNumber: (iInv >= 0 ? cols[iInv] : `H2O_${r}`).slice(0, 40),
              issueDate: issueDate.slice(0, 20),
              year,
              period: (periodValue || periodInfo.period || `Periodo ${year}`).slice(0, 80),
              cubicMeters: parseItNumber(cols[iMc]),
              fixedCostEur: 0,
              totalPaid,
              note: `Importata da ${fileName}`.slice(0, 240),
            },
          });
        } else {
          const canoneTv = iTv >= 0 ? parseItNumber(cols[iTv]) : 0;
          const kwh = iKwh >= 0 ? Math.round(parseItNumber(cols[iKwh])) : 0;
          const electricityOnly = Math.round(Math.max(0, totalPaid - canoneTv) * 100) / 100;
          drafts.push({
            id: `imp_${Date.now()}_${r}`,
            kind: 'luce',
            fileName,
            confidence: 'alta',
            rawPreview: lines[r],
            data: {
              invoiceNumber: (iInv >= 0 ? cols[iInv] : `IMP_${r}`).slice(0, 40),
              issueDate: issueDate.slice(0, 20),
              sortKey,
              year,
              period: (periodValue || periodInfo.period || `Bolletta ${year}`).slice(0, 80),
              supplier: ((iSupp >= 0 ? cols[iSupp] : '') || 'Fornitore Luce').slice(0, 80),
              offerName: 'Importata CSV',
              kwh,
              punText: '—',
              variableCostPerKwh:
                kwh > 0 && electricityOnly > 0
                  ? Math.round((electricityOnly / kwh) * 1000) / 1000
                  : 0.16,
              canoneTv,
              electricityOnly,
              totalPaid,
              note: `Importata da ${fileName}`.slice(0, 240),
            },
          });
        }
      }
      if (drafts.length > 0) return drafts;
    }
  }

  return parseBillText(trimmed, fileName);
}

export function parseBillText(
  text: string,
  fileName: string,
  forcedKind?: 'luce' | 'acqua' | 'tari'
): ImportedBillDraft[] {
  if (!forcedKind && isContractDocument(text, fileName)) return [];
  const kind = forcedKind || detectUtilityKind(text, fileName);
  const rawPreview = text.trim().slice(0, 1800);

  if (kind === 'tari') {
    const parsed = parseTariPdfText(text);
    if (parsed) {
      return [
        {
          id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: 'tari',
          fileName,
          confidence: parsed.totalPaid > 0 ? 'alta' : 'media',
          rawPreview,
          data: {
            ...parsed,
            source: 'manuale',
            note: `Importata da ${fileName}`.slice(0, 240),
          },
        },
      ];
    }
    const year = new Date().getFullYear();
    return [
      {
        id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: 'tari',
        fileName,
        confidence: 'manuale',
        rawPreview,
        data: {
          noticeNumber: `TARI_${year}_${Date.now().toString().slice(-4)}`,
          issueDate: new Date().toLocaleDateString('it-IT'),
          dueDate: new Date().toLocaleDateString('it-IT'),
          year,
          period: `TARI ${year} – Avviso importato`,
          supplier: 'AcegasApsAmga / TARI',
          totalPaid: 0,
          paid: false,
          source: 'manuale',
          note: `Importata da ${fileName}`.slice(0, 240),
        },
      },
    ];
  }

  if (kind === 'acqua') {
    const { bill, confidence } = parseGenericWaterPdfText(text, fileName);
    return [
      {
        id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: 'acqua',
        fileName,
        confidence,
        rawPreview,
        data: bill,
      },
    ];
  }

  const { bill, confidence } = parseGenericElectricityPdfText(text, fileName);
  return [
    {
      id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'luce',
      fileName,
      confidence,
      rawPreview,
      data: bill,
    },
  ];
}

async function fingerprintBytes(bytes: ArrayBuffer): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function parseImportedBillFiles(
  files: FileList | File[],
  forcedKind?: 'luce' | 'acqua' | 'tari'
): Promise<ImportedBillDraft[]> {
  const results: ImportedBillDraft[] = [];
  const fileArr = Array.from(files);

  for (const file of fileArr) {
    const lower = file.name.toLowerCase();
    let draftsForFile: ImportedBillDraft[] = [];
    let sourceFileFingerprint: string | undefined;
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
      try {
        const buffer = await file.arrayBuffer();
        sourceFileFingerprint = await fingerprintBytes(buffer);
        const text = await extractPdfTextFromBytes(new Uint8Array(buffer), 5);
        draftsForFile = parseBillText(text, file.name, forcedKind);
      } catch (err) {
        console.warn('Errore lettura PDF bolletta:', err);
        draftsForFile = [];
      }
    } else {
      const content = await file.text();
      sourceFileFingerprint = await fingerprintBytes(new TextEncoder().encode(content).buffer);
      draftsForFile = parseCsvOrJsonText(content, file.name, forcedKind);
    }
    for (const d of draftsForFile) {
      results.push({ ...d, sourceFile: file, sourceFileFingerprint });
    }
  }

  return results;
}
