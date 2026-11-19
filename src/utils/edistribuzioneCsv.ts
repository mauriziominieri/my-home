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
  return Number.isFinite(val) && val >= 0 ? Math.round(val * 100) / 100 : 0;
}

function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/"/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  const itMatch = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (itMatch) {
    return `${itMatch[3]}-${itMatch[2]}-${itMatch[1]}`;
  }
  return null;
}

/**
 * Parses real CSV files exported from the e-distribuzione Area Clienti portal.
 * Supports semicolon (;) or comma (,) delimiters, Italian decimal commas (e.g. 2,30),
 * and both F1/F2/F3 columns or a single daily total kWh column.
 */
export function parseEDistribuzioneCsv(csvText: string): ParsedReadingInput[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/"/g, ''));

  const dateIdx = headers.findIndex((h) => h.includes('data') || h.includes('date') || h.includes('giorno'));
  const f1Idx = headers.findIndex((h) => h === 'f1' || h.includes('f1'));
  const f2Idx = headers.findIndex((h) => h === 'f2' || h.includes('f2'));
  const f3Idx = headers.findIndex((h) => h === 'f3' || h.includes('f3'));
  const totalIdx = headers.findIndex((h) => h.includes('tot') || h.includes('kwh') || h.includes('consumo'));
  const peakIdx = headers.findIndex((h) => h.includes('picco') || h.includes('potenza') || h.includes('kw'));
  const notesIdx = headers.findIndex((h) => h.includes('note'));

  if (dateIdx === -1) return [];

  const results: ParsedReadingInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter);
    const date = normalizeDate(cols[dateIdx]);
    if (!date) continue;

    let f1Kwh = f1Idx !== -1 ? parseItalianNumber(cols[f1Idx]) : 0;
    let f2Kwh = f2Idx !== -1 ? parseItalianNumber(cols[f2Idx]) : 0;
    let f3Kwh = f3Idx !== -1 ? parseItalianNumber(cols[f3Idx]) : 0;
    let totalKwh = Math.round((f1Kwh + f2Kwh + f3Kwh) * 100) / 100;

    if (totalKwh === 0 && totalIdx !== -1) {
      totalKwh = parseItalianNumber(cols[totalIdx]);
      f3Kwh = totalKwh;
    }

    const peakKw = peakIdx !== -1 ? parseItalianNumber(cols[peakIdx]) : 0;
    const notes = notesIdx !== -1 ? cols[notesIdx]?.trim().replace(/"/g, '').slice(0, 240) : undefined;

    results.push({
      date,
      f1Kwh,
      f2Kwh,
      f3Kwh,
      totalKwh,
      peakKw: Math.min(6.0, peakKw),
      notes: notes || 'Import CSV e-distribuzione',
    });
  }

  return results;
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
