import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface CoverLanguageEntry {
  lang: string;
  label: string;
  startPage: number;
  explicitEndPage?: number;
}

export interface PdfItalianAnalysis {
  totalPages: number;
  keepPages: number[];
  italianPages: number[];
  coverPages: number[];
  rangeText: string;
  method: 'cover_index' | 'text_detection' | 'already_italian' | 'none';
  confidence: 'alta' | 'media' | 'bassa';
  summary: string;
  detectedIndexEntries: CoverLanguageEntry[];
  pageOffsetApplied: number;
}

export interface PdfExtractResult {
  bytes: Uint8Array;
  file: File;
  pageCount: number;
  originalPageCount: number;
  originalSize: number;
  newSize: number;
  keptPages: number[];
  rangeText: string;
}

interface TextChunkItem {
  str: string;
  x: number;
  y: number;
}

const KNOWN_LANG_TOKENS: Array<{ code: string; pattern: RegExp }> = [
  {
    code: 'IT',
    pattern:
      /^(?:it|ita|italiano|italian)\b|istruzioni\s+per\s+l['’]?uso|manuale\s+(?:utente|d['’]?uso|di\s+istruzioni)|piano\s+cottura/i,
  },
  {
    code: 'EN',
    pattern: /^(?:en|eng|english)\b|user\s+manual|operating\s+instructions/i,
  },
  {
    code: 'FR',
    pattern: /^(?:fr|fra|fran[çc]ais|french)\b|notice\s+d['’]?utilisation|mode\s+d['’]?emploi/i,
  },
  {
    code: 'DE',
    pattern:
      /^(?:de|deu|deutsch|german)\b|benutzerinformation|gebrauchsanweisung|bedienungsanleitung/i,
  },
  {
    code: 'ES',
    pattern: /^(?:es|esp|espa[ñn]ol|spanish)\b|manual\s+de\s+instrucciones/i,
  },
  {
    code: 'PT',
    pattern: /^(?:pt|prt|portugu[êe]s|portuguese)\b|manual\s+de\s+instru[çc][õo]es/i,
  },
  {
    code: 'NL',
    pattern: /^(?:nl|nld|nederlands|dutch)\b|gebruiksaanwijzing/i,
  },
  {
    code: 'PL',
    pattern: /^(?:pl|pol|polski|polish)\b|instrukcja\s+obs[łl]ugi/i,
  },
  {
    code: 'SV',
    pattern: /^(?:sv|swe|svenska|swedish)\b|bruksanvisning/i,
  },
  {
    code: 'NO',
    pattern: /^(?:no|nor|norsk|norwegian)\b|bruksanvisning/i,
  },
  {
    code: 'DA',
    pattern: /^(?:da|dan|dansk|danish)\b|brugsanvisning/i,
  },
  {
    code: 'FI',
    pattern: /^(?:fi|fin|suomi|finnish)\b|k[äa]ytt[öo]ohje/i,
  },
  {
    code: 'CS',
    pattern: /^(?:cs|cz|cze|[čc]e[šs]tina|czech)\b|n[áa]vod\s+k\s+pou[žz]it[íi]/i,
  },
  {
    code: 'SK',
    pattern: /^(?:sk|slk|sloven[čc]ina|slovak)\b/i,
  },
  {
    code: 'HU',
    pattern: /^(?:hu|hun|magyar|hungarian)\b|haszn[áa]lati\s+[úu]tmutat[óo]/i,
  },
  {
    code: 'RO',
    pattern: /^(?:ro|ron|rom[âa]n[ăa]|romanian)\b/i,
  },
  {
    code: 'EL',
    pattern: /^(?:el|gr|gre|greek|ελληνικ[άα])\b/i,
  },
  {
    code: 'TR',
    pattern: /^(?:tr|tur|t[üu]rk[çc]e|turkish)\b|kullanma\s+k[ıi]lavuzu/i,
  },
  {
    code: 'RU',
    pattern: /^(?:ru|rus|russian|русский)\b|руководство/i,
  },
  {
    code: 'BG',
    pattern: /^(?:bg|bul|bulgarian|български)\b/i,
  },
  {
    code: 'HR',
    pattern: /^(?:hr|hrv|hrvatski|croatian)\b/i,
  },
  {
    code: 'SL',
    pattern: /^(?:sl|slv|sloven[šs][čc]ina|slovenian)\b/i,
  },
  {
    code: 'ET',
    pattern: /^(?:et|est|eesti)\b/i,
  },
  {
    code: 'LV',
    pattern: /^(?:lv|lav|latvie[šs]u)\b/i,
  },
  {
    code: 'LT',
    pattern: /^(?:lt|lit|lietuvi[ųu])\b/i,
  },
  {
    code: 'UK',
    pattern: /^(?:uk|ukr|українська)\b/i,
  },
  {
    code: 'AR',
    pattern: /^(?:ar|ara|arabic)\b/i,
  },
  {
    code: 'ZH',
    pattern: /^(?:zh|chs|cht|chinese)\b/i,
  },
];

const ITALIAN_STOPWORDS_RE =
  /\b(?:il|lo|la|gli|le|del|della|dello|delle|degli|dei|nel|nella|nelle|negli|sul|sulla|sulle|sugli|per|con|che|non|sono|pu[òo]|essere|questo|questa|queste|questi|prima|dopo|sempre|mai|anche|solo|tutti|tutte|istruzioni|sicurezza|avvertenze|utilizzo|installazione|manutenzione|cottura|apparecchio|alimentazione|garanzia|pagina|capitolo|tabella|funzioni|pulizia|errore|risoluzione|premere|spegnere|accendere|temperatura|livello|potenza)\b/gi;

const FOREIGN_STOPWORDS_RE =
  /\b(?:the|and|with|your|this|that|for|warning|caution|appliance|instructions|switching|power|setting|cleaning|maintenance|installation|before|after|never|always|les|des|avec|pour|dans|vous|votre|cette|sont|avant|utilisation|sécurité|nettoyage|und|der|die|das|mit|für|nicht|sie|bitte|gerät|sicherheit|hinweise|reinigung|los|las|para|con|una|este|esta|por|usted|seguridad|limpieza|voor|met|het|een|niet|gebruik|veiligheid|reiniging|jest|nie|do|na|przed|urządzenia|instrukcja)\b/gi;

async function extractPageLines(page: pdfjsLib.PDFPageProxy): Promise<string[]> {
  const textContent = await page.getTextContent();
  const chunks: TextChunkItem[] = [];
  for (const rawItem of textContent.items) {
    if (!('str' in rawItem)) continue;
    const str = (rawItem.str || '').replace(/\s+/g, ' ').trim();
    if (!str) continue;
    const tr = rawItem.transform || [1, 0, 0, 1, 0, 0];
    chunks.push({
      str,
      x: Number(tr[4] || 0),
      y: Number(tr[5] || 0),
    });
  }

  // Group items sharing roughly the same horizontal baseline (within 4.5 PDF units)
  chunks.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextChunkItem[][] = [];
  for (const item of chunks) {
    const existingRow = rows.find((r) => Math.abs(r[0].y - item.y) <= 4.5);
    if (existingRow) {
      existingRow.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      return row.map((r) => r.str).join(' ').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

function detectLanguageCodeForLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  for (const entry of KNOWN_LANG_TOKENS) {
    if (entry.pattern.test(trimmed)) {
      return entry.code;
    }
  }
  return null;
}

function parseLanguageIndexFromLines(
  lines: string[],
  totalPages: number
): CoverLanguageEntry[] {
  const entries: CoverLanguageEntry[] = [];
  const seenLangs = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.replace(/[._·•]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 3 || line.length > 140) continue;

    // Pattern A: "IT Istruzioni per l'uso | Piano cottura 65" or "IT 65-85"
    let matchedLang: string | null = null;
    let startPage = 0;
    let explicitEndPage: number | undefined;
    let label = line;

    const trailingRangeMatch = line.match(
      /^(.*?)\s+(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?$/
    );
    if (trailingRangeMatch) {
      const prefix = trailingRangeMatch[1].trim();
      const num1 = Number(trailingRangeMatch[2]);
      const num2 = trailingRangeMatch[3] ? Number(trailingRangeMatch[3]) : undefined;
      const lang = detectLanguageCodeForLine(prefix);
      if (lang && num1 >= 1 && num1 <= totalPages) {
        matchedLang = lang;
        startPage = num1;
        if (num2 && num2 >= num1 && num2 <= totalPages) {
          explicitEndPage = num2;
        }
        label = prefix;
      }
    }

    // Pattern B: "65 IT Istruzioni per l'uso"
    if (!matchedLang) {
      const leadingNumMatch = line.match(/^(\d{1,4})\s+(.+)$/);
      if (leadingNumMatch) {
        const num1 = Number(leadingNumMatch[1]);
        const rest = leadingNumMatch[2].trim();
        const lang = detectLanguageCodeForLine(rest);
        if (lang && num1 >= 1 && num1 <= totalPages) {
          matchedLang = lang;
          startPage = num1;
          label = rest;
        }
      }
    }

    if (!matchedLang || startPage < 1 || startPage > totalPages) continue;
    if (seenLangs.has(matchedLang)) continue;
    seenLangs.add(matchedLang);
    entries.push({
      lang: matchedLang,
      label: label.slice(0, 70),
      startPage,
      explicitEndPage,
    });
  }

  // Fallback for multi-column cover index tables merged on the same Y coordinate
  if (entries.length < 2 || !entries.some((e) => e.lang === 'IT')) {
    const joined = lines.join(' ').replace(/[._·•]+/g, ' ').replace(/\s+/g, ' ');
    const pairRe =
      /\b(IT|ITA|ITALIANO|EN|ENG|ENGLISH|FR|FRA|FRAN[ÇC]AIS|DE|DEU|DEUTSCH|ES|ESP|ESPA[ÑN]OL|PT|PRT|PORTUGU[ÊE]S|NL|NEDERLANDS|PL|POLSKI|SV|SVENSKA|DA|DANSK|FI|SUOMI|CS|[ČC]E[ŠS]TINA|HU|MAGYAR|RO|ROM[ÂA]N[ĂA]|TR|T[ÜU]RK[ÇC]E|RU|RUSSIAN)\b(?:\s+[^0-9]{1,42}?)?\s+(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?(?=\s|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(joined)) !== null) {
      const token = m[1];
      const num1 = Number(m[2]);
      const num2 = m[3] ? Number(m[3]) : undefined;
      const lang = detectLanguageCodeForLine(token);
      if (!lang || num1 < 1 || num1 > totalPages) continue;
      if (seenLangs.has(lang)) continue;
      seenLangs.add(lang);
      entries.push({
        lang,
        label: token.toUpperCase(),
        startPage: num1,
        explicitEndPage: num2 && num2 >= num1 && num2 <= totalPages ? num2 : undefined,
      });
    }
  }

  entries.sort((a, b) => a.startPage - b.startPage);
  return entries;
}

function scorePageLanguage(text: string): { itScore: number; otherScore: number; wordsCount: number } {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return { itScore: 0, otherScore: 0, wordsCount: 0 };
  const words = normalized.split(' ').filter((w) => w.length >= 2);
  const itMatches = normalized.match(ITALIAN_STOPWORDS_RE) || [];
  const foreignMatches = normalized.match(FOREIGN_STOPWORDS_RE) || [];
  return {
    itScore: itMatches.length,
    otherScore: foreignMatches.length,
    wordsCount: words.length,
  };
}

export function formatPageRangesSummary(pages: number[]): string {
  const unique = Array.from(
    new Set(pages.filter((p) => Number.isInteger(p) && p >= 1))
  ).sort((a, b) => a - b);
  if (unique.length === 0) return '';

  const parts: string[] = [];
  let rangeStart = unique[0];
  let prev = unique[0];

  for (let i = 1; i < unique.length; i++) {
    const curr = unique[i];
    if (curr === prev + 1) {
      prev = curr;
      continue;
    }
    parts.push(rangeStart === prev ? String(rangeStart) : `${rangeStart}-${prev}`);
    rangeStart = curr;
    prev = curr;
  }
  parts.push(rangeStart === prev ? String(rangeStart) : `${rangeStart}-${prev}`);
  return parts.join(', ');
}

export function parsePageRangesInput(input: string, totalPages: number): number[] {
  const out = new Set<number>();
  const tokens = input
    .split(/[,\s;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const a = Math.max(1, Math.min(totalPages, Number(rangeMatch[1])));
      const b = Math.max(1, Math.min(totalPages, Number(rangeMatch[2])));
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let p = lo; p <= hi; p++) {
        out.add(p);
      }
      continue;
    }
    if (/^\d+$/.test(token)) {
      const p = Number(token);
      if (p >= 1 && p <= totalPages) {
        out.add(p);
      }
    }
  }

  return Array.from(out).sort((a, b) => a - b);
}

async function readPdfBytesFromSource(source: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  const buf = await source.arrayBuffer();
  return new Uint8Array(buf);
}

export async function analyzePdfItalianPages(
  source: Blob | ArrayBuffer | Uint8Array
): Promise<PdfItalianAnalysis> {
  const rawBytes = await readPdfBytesFromSource(source);
  const loadingTask = pdfjsLib.getDocument({ data: rawBytes.slice() });
  const pdf = await loadingTask.promise;

  try {
    const totalPages = pdf.numPages;
    if (totalPages <= 1) {
      return {
        totalPages,
        keepPages: totalPages === 1 ? [1] : [],
        italianPages: totalPages === 1 ? [1] : [],
        coverPages: totalPages === 1 ? [1] : [],
        rangeText: totalPages === 1 ? '1' : '',
        method: 'already_italian',
        confidence: 'media',
        summary: 'Documento di una sola pagina.',
        detectedIndexEntries: [],
        pageOffsetApplied: 0,
      };
    }

    // Check Page 1 (and Page 2 if Page 1 doesn't contain a language index)
    const coverPageIndicesToScan = totalPages >= 2 ? [1, 2] : [1];
    let indexPageNum = 1;
    let indexEntries: CoverLanguageEntry[] = [];

    for (const pNum of coverPageIndicesToScan) {
      const page = await pdf.getPage(pNum);
      const lines = await extractPageLines(page);
      const parsed = parseLanguageIndexFromLines(lines, totalPages);
      if (parsed.length >= 2 && parsed.some((e) => e.lang === 'IT')) {
        indexEntries = parsed;
        indexPageNum = pNum;
        break;
      }
    }

    const itIdx = indexEntries.findIndex((e) => e.lang === 'IT');
    if (itIdx !== -1 && indexEntries.length >= 2) {
      const itEntry = indexEntries[itIdx];
      const nextEntry = indexEntries[itIdx + 1];
      const rawStart = itEntry.startPage;
      const rawEnd = itEntry.explicitEndPage
        ? itEntry.explicitEndPage
        : nextEntry
          ? Math.max(rawStart, nextEntry.startPage - 1)
          : totalPages;

      // Verify if printed numbering matches PDF 1-based numbering or is offset by +1..+4 cover pages
      let bestOffset = 0;
      const startPageScore = async (pdfPageNum: number) => {
        if (pdfPageNum < 1 || pdfPageNum > totalPages) return { itScore: 0, otherScore: 0 };
        const p = await pdf.getPage(pdfPageNum);
        const lines = await extractPageLines(p);
        return scorePageLanguage(lines.join(' '));
      };

      const scoreAtZero = await startPageScore(rawStart);
      if (scoreAtZero.otherScore > scoreAtZero.itScore + 2) {
        for (let off = 1; off <= 4; off++) {
          const candidateScore = await startPageScore(rawStart + off);
          if (candidateScore.itScore >= candidateScore.otherScore && candidateScore.itScore >= 2) {
            bestOffset = off;
            break;
          }
        }
      }

      const finalStart = Math.max(1, Math.min(totalPages, rawStart + bestOffset));
      const finalEnd = Math.max(finalStart, Math.min(totalPages, rawEnd + bestOffset));

      const coverPages = indexPageNum === 2 ? [1, 2] : [1];
      const italianPages: number[] = [];
      for (let p = finalStart; p <= finalEnd; p++) {
        italianPages.push(p);
      }

      const keepPages = Array.from(new Set([...coverPages, ...italianPages])).sort(
        (a, b) => a - b
      );
      const rangeText = formatPageRangesSummary(keepPages);
      const nextInfo = nextEntry
        ? ` (${nextEntry.lang} da pag. ${nextEntry.startPage + bestOffset})`
        : ' (fino a fine PDF)';

      return {
        totalPages,
        keepPages,
        italianPages,
        coverPages,
        rangeText,
        method: 'cover_index',
        confidence: 'alta',
        summary: `Indice lingue rilevato a pag. ${indexPageNum}: IT da pag. ${finalStart}${nextInfo} → ${keepPages.length}/${totalPages} pagine (${rangeText}).`,
        detectedIndexEntries: indexEntries,
        pageOffsetApplied: bestOffset,
      };
    }

    // Strategy B: Fallback page-by-page language detection across the PDF
    const pageScores: Array<{
      page: number;
      isIt: boolean;
      isForeign: boolean;
      itScore: number;
      otherScore: number;
    }> = [];

    for (let pNum = 1; pNum <= totalPages; pNum++) {
      const p = await pdf.getPage(pNum);
      const lines = await extractPageLines(p);
      const { itScore, otherScore } = scorePageLanguage(lines.join(' '));
      const isIt = itScore >= 3 && itScore >= otherScore * 1.15;
      const isForeign = otherScore >= 4 && otherScore > itScore * 1.25;
      pageScores.push({ page: pNum, isIt, isForeign, itScore, otherScore });
    }

    // Bridge 1-2 page gaps (e.g. diagram-only pages) inside an Italian sequence when no foreign text dominates
    const italianSet = new Set<number>();
    for (const s of pageScores) {
      if (s.isIt) italianSet.add(s.page);
    }

    for (let pNum = 2; pNum < totalPages; pNum++) {
      if (italianSet.has(pNum)) continue;
      const prevIn = italianSet.has(pNum - 1);
      const nextIn1 = italianSet.has(pNum + 1);
      const nextIn2 = pNum + 2 <= totalPages && italianSet.has(pNum + 2);
      const curScore = pageScores[pNum - 1];
      if (prevIn && (nextIn1 || nextIn2) && !curScore.isForeign) {
        italianSet.add(pNum);
      }
    }

    const italianPages = Array.from(italianSet).sort((a, b) => a - b);
    const foreignCount = pageScores.filter((s) => s.isForeign && !italianSet.has(s.page)).length;

    if (italianPages.length === 0) {
      const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);
      return {
        totalPages,
        keepPages: allPages,
        italianPages: [],
        coverPages: [1],
        rangeText: formatPageRangesSummary(allPages),
        method: 'none',
        confidence: 'bassa',
        summary: `Nessuna sezione esclusivamente in italiano rilevata su ${totalPages} pagine. Puoi inserire manualmente l'intervallo (es. 1, 65-85).`,
        detectedIndexEntries: [],
        pageOffsetApplied: 0,
      };
    }

    const keepPages = Array.from(new Set([1, ...italianPages])).sort((a, b) => a - b);
    const rangeText = formatPageRangesSummary(keepPages);

    if (foreignCount <= 1 && italianPages.length >= Math.max(2, totalPages - 3)) {
      return {
        totalPages,
        keepPages,
        italianPages,
        coverPages: [1],
        rangeText,
        method: 'already_italian',
        confidence: 'alta',
        summary: `Il PDF risulta già quasi interamente in italiano (${keepPages.length}/${totalPages} pagine).`,
        detectedIndexEntries: [],
        pageOffsetApplied: 0,
      };
    }

    const highConf = italianPages.length >= 3 && foreignCount >= 5;
    return {
      totalPages,
      keepPages,
      italianPages,
      coverPages: [1],
      rangeText,
      method: 'text_detection',
      confidence: highConf ? 'alta' : 'media',
      summary: `Rilevato testo italiano su ${italianPages.length} pagine (${foreignCount} pagine in altre lingue) → selezionate ${keepPages.length}/${totalPages} pagine (${rangeText}).`,
      detectedIndexEntries: [],
      pageOffsetApplied: 0,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractPdfPagesToFile(
  source: Blob | ArrayBuffer | Uint8Array,
  pageNumbers1Based: number[],
  outputFileName: string,
  outputSuffix = 'IT'
): Promise<PdfExtractResult> {
  const rawBytes = await readPdfBytesFromSource(source);
  const srcPdf = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
  const originalPageCount = srcPdf.getPageCount();

  const validPages = Array.from(
    new Set(
      pageNumbers1Based.filter(
        (p) => Number.isInteger(p) && p >= 1 && p <= originalPageCount
      )
    )
  ).sort((a, b) => a - b);

  if (validPages.length === 0) {
    throw new Error('Seleziona almeno una pagina valida da mantenere nel PDF.');
  }

  const outPdf = await PDFDocument.create();
  const title = srcPdf.getTitle();
  const cleanSuffix = outputSuffix.replace(/[^A-Za-z0-9+-]/g, '') || 'IT';
  if (title) outPdf.setTitle(`${title} (${cleanSuffix})`);

  const indices0Based = validPages.map((p) => p - 1);
  const copiedPages = await outPdf.copyPages(srcPdf, indices0Based);
  for (const copied of copiedPages) {
    outPdf.addPage(copied);
  }

  const outBytes = await outPdf.save({ useObjectStreams: true });
  const normalizedBase = outputFileName
    .replace(/\.pdf$/i, '')
    .replace(/(?:-[A-Z]{2}(?:\+[A-Z]{2})*)+$/i, '')
    .trim();
  const finalName = `${normalizedBase || 'manuale'}-${cleanSuffix.replace(/\+/g, '-')}.pdf`;
  const copyBuffer = new Uint8Array(outBytes.byteLength);
  copyBuffer.set(outBytes);
  const outFile = new File([copyBuffer.buffer], finalName, {
    type: 'application/pdf',
    lastModified: Date.now(),
  });

  return {
    bytes: outBytes,
    file: outFile,
    pageCount: validPages.length,
    originalPageCount,
    originalSize: rawBytes.byteLength,
    newSize: outBytes.byteLength,
    keptPages: validPages,
    rangeText: formatPageRangesSummary(validPages),
  };
}

export interface AutoTrimResult {
  trimmed: boolean;
  file: File;
  analysis?: PdfItalianAnalysis;
  extract?: PdfExtractResult;
}

/**
 * Automatically reduces multilingual PDF manuals (>= 8 pages) to
 * cover page + Italian pages only when multilingual detection finds clear Italian
 * and foreign sections. Never modifies single-language Italian PDFs.
 */
export async function autoTrimMultilingualManualPdf(
  file: File
): Promise<AutoTrimResult> {
  const isPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf || file.size <= 0) {
    return { trimmed: false, file };
  }

  try {
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    const analysis = await analyzePdfItalianPages(rawBytes);

    if (
      analysis.totalPages < 8 ||
      (analysis.method !== 'cover_index' && analysis.method !== 'text_detection') ||
      (analysis.method === 'text_detection' && analysis.confidence === 'bassa') ||
      analysis.italianPages.length < 2 ||
      analysis.keepPages.length >= Math.floor(analysis.totalPages * 0.85)
    ) {
      return { trimmed: false, file, analysis };
    }

    const extract = await extractPdfPagesToFile(
      rawBytes,
      analysis.keepPages,
      file.name || 'manuale.pdf'
    );

    const substantialPageReduction =
      extract.pageCount <= Math.floor(analysis.totalPages * 0.75);
    if (
      extract.newSize >= file.size * 0.92 &&
      !(substantialPageReduction && extract.newSize <= file.size)
    ) {
      return { trimmed: false, file, analysis };
    }

    return {
      trimmed: true,
      file: extract.file,
      analysis,
      extract,
    };
  } catch {
    return { trimmed: false, file };
  }
}
