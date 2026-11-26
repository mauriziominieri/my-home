import { EnergyReading } from '../types/home';

export interface ParsedReadingInput {
  date: string;
  f1Kwh: number;
  f2Kwh: number;
  f3Kwh: number;
  totalKwh: number;
  peakKw: number;
  notes?: string;
}

export const MONTHS_IT = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

export const MONTHS_SHORT_IT = [
  'Gen',
  'Feb',
  'Mar',
  'Apr',
  'Mag',
  'Giu',
  'Lug',
  'Ago',
  'Set',
  'Ott',
  'Nov',
  'Dic',
];

function parseItalianNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.trim().replace(/"/g, '').replace(/\s+/g, '').replace(',', '.');
  const val = Number.parseFloat(cleaned);
  return Number.isFinite(val) && val >= 0 ? Math.round(val * 1000) / 1000 : 0;
}

function isValidCalendarDate(y: number, m: number, d: number, maxIsoDate: string): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return iso <= maxIsoDate ? iso : null;
}

function normalizeDateFlexible(
  raw: string | undefined,
  preferMdy: boolean,
  maxIsoDate: string
): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/"/g, '').split(' ')[0];
  if (!cleaned) return null;

  const ymd = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    return isValidCalendarDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), maxIsoDate);
  }

  const dmyOrMdy = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyOrMdy) {
    const p1 = Number(dmyOrMdy[1]);
    const p2 = Number(dmyOrMdy[2]);
    const y = Number(dmyOrMdy[3]);
    if (preferMdy) {
      return (
        isValidCalendarDate(y, p1, p2, maxIsoDate) ||
        isValidCalendarDate(y, p2, p1, maxIsoDate)
      );
    }
    return (
      isValidCalendarDate(y, p2, p1, maxIsoDate) ||
      isValidCalendarDate(y, p1, p2, maxIsoDate)
    );
  }

  const compact = cleaned.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return isValidCalendarDate(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
      maxIsoDate
    );
  }

  return null;
}

function getAreraBand(isoDate: string, hour: number): 'F1' | 'F2' | 'F3' {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  const day = dt.getUTCDay(); // 0=Sun, 1=Mon .. 6=Sat
  if (day === 0) return 'F3';
  if (day === 6) return hour >= 7 && hour < 23 ? 'F2' : 'F3';
  if (hour >= 8 && hour < 19) return 'F1';
  if ((hour >= 7 && hour < 8) || (hour >= 19 && hour < 23)) return 'F2';
  return 'F3';
}

/**
 * Parses CSV files exported from e-distribuzione (Area Clienti or Gmail load-curve attachments).
 * Supports both 96-slot quarter-hour / 24-slot hourly curves (calculating F1/F2/F3 ARERA bands)
 * and compact F1/F2/F3/Total summary CSV rows.
 */
export function parseEDistribuzioneCsv(csvText: string): ParsedReadingInput[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  let delimiter = lines[0].split(';').length >= lines[0].split(',').length ? ';' : ',';
  for (const ln of lines.slice(0, 10)) {
    if (ln.split(';').length >= 11) {
      delimiter = ';';
      break;
    }
  }

  const rows = lines.map((line) => line.split(delimiter));
  const now = new Date();
  const maxIsoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Detect MDY vs DMY across file
  let mdyVotes = 0;
  let dmyVotes = 0;
  for (const row of rows) {
    for (let idx = 0; idx < Math.min(3, row.length); idx++) {
      const cleaned = row[idx].trim().replace(/"/g, '').split(' ')[0];
      const m = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (m) {
        const p1 = Number(m[1]);
        const p2 = Number(m[2]);
        if (p1 > 12) dmyVotes++;
        else if (p2 > 12) mdyVotes++;
      }
    }
  }
  const preferMdy = mdyVotes > dmyVotes;

  // Check for compact summary header first
  const headerCols = rows[0].map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const dateHeaderIdx = headerCols.findIndex(
    (h) => h.includes('data') || h.includes('date') || h.includes('giorno')
  );
  const f1HeaderIdx = headerCols.findIndex((h) => h === 'f1' || h.includes('f1'));
  const f2HeaderIdx = headerCols.findIndex((h) => h === 'f2' || h.includes('f2'));
  const f3HeaderIdx = headerCols.findIndex((h) => h === 'f3' || h.includes('f3'));
  const totalHeaderIdx = headerCols.findIndex(
    (h) => h.includes('tot') || h.includes('kwh') || h.includes('consumo')
  );
  const peakHeaderIdx = headerCols.findIndex(
    (h) => h.includes('picco') || h.includes('potenza') || h.includes('kw')
  );
  const notesHeaderIdx = headerCols.findIndex((h) => h.includes('note'));

  if (
    dateHeaderIdx !== -1 &&
    (f1HeaderIdx !== -1 || f2HeaderIdx !== -1 || f3HeaderIdx !== -1 || totalHeaderIdx !== -1) &&
    headerCols.length < 24
  ) {
    const compactResults: ParsedReadingInput[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const iso = normalizeDateFlexible(cols[dateHeaderIdx], preferMdy, maxIsoDate);
      if (!iso) continue;
      let f1Kwh = f1HeaderIdx !== -1 ? Math.round(parseItalianNumber(cols[f1HeaderIdx]) * 100) / 100 : 0;
      let f2Kwh = f2HeaderIdx !== -1 ? Math.round(parseItalianNumber(cols[f2HeaderIdx]) * 100) / 100 : 0;
      let f3Kwh = f3HeaderIdx !== -1 ? Math.round(parseItalianNumber(cols[f3HeaderIdx]) * 100) / 100 : 0;
      let totalKwh = Math.round((f1Kwh + f2Kwh + f3Kwh) * 100) / 100;
      if (totalKwh === 0 && totalHeaderIdx !== -1) {
        totalKwh = Math.round(parseItalianNumber(cols[totalHeaderIdx]) * 100) / 100;
        f3Kwh = totalKwh;
      }
      const peakKw =
        peakHeaderIdx !== -1 ? Math.round(parseItalianNumber(cols[peakHeaderIdx]) * 100) / 100 : 0;
      const notes =
        notesHeaderIdx !== -1
          ? cols[notesHeaderIdx]?.trim().replace(/"/g, '').slice(0, 240)
          : undefined;
      compactResults.push({
        date: iso,
        f1Kwh,
        f2Kwh,
        f3Kwh,
        totalKwh,
        peakKw: Math.min(6.0, peakKw),
        notes: notes || 'Import CSV e-distribuzione',
      });
    }
    if (compactResults.length > 0) return compactResults;
  }

  // Otherwise parse quarter-hour (96 cols) / hourly (24 cols) load-curve rows
  const byDate = new Map<string, ParsedReadingInput>();
  for (const row of rows) {
    if (row.length < 2) continue;

    let dateIdx = -1;
    let iso: string | null = null;
    for (let idx = 0; idx < Math.min(3, row.length); idx++) {
      const cand = normalizeDateFlexible(row[idx], preferMdy, maxIsoDate);
      if (cand) {
        dateIdx = idx;
        iso = cand;
        break;
      }
    }
    if (!iso || dateIdx === -1) continue;

    const valueCells = row.slice(dateIdx + 1);
    if (valueCells.length >= 24) {
      const isHourly = valueCells.length < 48;
      let f1 = 0;
      let f2 = 0;
      let f3 = 0;
      let maxSlot = 0;

      for (let slotIdx = 0; slotIdx < Math.min(96, valueCells.length); slotIdx++) {
        const val = parseItalianNumber(valueCells[slotIdx]);
        if (val > maxSlot) maxSlot = val;
        const hour = isHourly ? slotIdx : Math.min(23, Math.floor(slotIdx / 4));
        const band = getAreraBand(iso, hour);
        if (band === 'F1') f1 += val;
        else if (band === 'F2') f2 += val;
        else f3 += val;
      }

      const f1Rounded = Math.round(f1 * 100) / 100;
      const f2Rounded = Math.round(f2 * 100) / 100;
      const f3Rounded = Math.round(f3 * 100) / 100;
      const totalRounded = Math.round((f1Rounded + f2Rounded + f3Rounded) * 100) / 100;
      const peakKw = Math.round(Math.min(6.0, isHourly ? maxSlot : maxSlot * 4) * 100) / 100;

      byDate.set(iso, {
        date: iso,
        f1Kwh: f1Rounded,
        f2Kwh: f2Rounded,
        f3Kwh: f3Rounded,
        totalKwh: totalRounded,
        peakKw,
        notes: 'Sync automatico Gmail e-distribuzione',
      });
    } else {
      const nums = valueCells
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => parseItalianNumber(c));
      if (nums.length === 0) continue;
      const f1Rounded = nums.length >= 3 ? Math.round(nums[0] * 100) / 100 : 0;
      const f2Rounded = nums.length >= 3 ? Math.round(nums[1] * 100) / 100 : 0;
      const f3Rounded = nums.length >= 3 ? Math.round(nums[2] * 100) / 100 : Math.round(nums[0] * 100) / 100;
      const totalRounded = Math.round((f1Rounded + f2Rounded + f3Rounded) * 100) / 100;
      byDate.set(iso, {
        date: iso,
        f1Kwh: f1Rounded,
        f2Kwh: f2Rounded,
        f3Kwh: f3Rounded,
        totalKwh: totalRounded,
        peakKw: 0,
        notes: 'Sync automatico Gmail e-distribuzione',
      });
    }
  }

  return Array.from(byDate.values());
}

export function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function formatReadingDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function summarizeReadings(readings: EnergyReading[]) {
  const totalKwh = readings.reduce((acc, r) => acc + r.totalKwh, 0);
  const totalCost = readings.reduce((acc, r) => acc + r.estimatedCostEur, 0);
  const maxPeakKw = readings.reduce((acc, r) => Math.max(acc, r.peakKw), 0);
  const avgDailyKwh = readings.length > 0 ? totalKwh / readings.length : 0;
  return {
    totalKwh: Math.round(totalKwh * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    maxPeakKw: Math.round(maxPeakKw * 100) / 100,
    avgDailyKwh: Math.round(avgDailyKwh * 100) / 100,
  };
}
