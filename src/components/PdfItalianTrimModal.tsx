import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Languages,
  Loader2,
  RotateCcw,
  Scissors,
  Sparkles,
  X,
} from 'lucide-react';
import { formatFileSize, getVaultFile } from '../utils/documentVault';
import { resolveApiUrl } from '../utils/apiBase';
import {
  analyzePdfItalianPages,
  extractPdfPagesToFile,
  formatPageRangesSummary,
  parsePageRangesInput,
  PdfExtractResult,
  PdfItalianAnalysis,
} from '../utils/pdfItalianExtractor';

export interface PdfItalianTrimTarget {
  title: string;
  fileName?: string;
  fileKey?: string;
  cloudUrl?: string;
  file?: File;
}

interface PdfItalianTrimModalProps {
  target: PdfItalianTrimTarget | null;
  onClose: () => void;
  onSaveTrimmedFile: (result: PdfExtractResult) => Promise<void>;
}

export const PdfItalianTrimModal: React.FC<PdfItalianTrimModalProps> = ({
  target,
  onClose,
  onSaveTrimmedFile,
}) => {
  const [loading, setLoading] = useState(false);
  const [buildingPreview, setBuildingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [sourceName, setSourceName] = useState<string>('manuale.pdf');
  const [analysis, setAnalysis] = useState<PdfItalianAnalysis | null>(null);
  const [rangeInput, setRangeInput] = useState('');
  const [previewResult, setPreviewResult] = useState<PdfExtractResult | null>(null);
  const previewSeqRef = useRef(0);

  useEffect(() => {
    if (!target) {
      setSourceBytes(null);
      setAnalysis(null);
      setRangeInput('');
      setPreviewResult(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSourceBytes(null);
    setAnalysis(null);
    setPreviewResult(null);

    void (async () => {
      try {
        let bytes: Uint8Array | null = null;
        let resolvedName = target.file?.name || target.fileName || `${target.title || 'manuale'}.pdf`;

        if (target.file) {
          bytes = new Uint8Array(await target.file.arrayBuffer());
        } else {
          if (target.fileKey) {
            const vaultItem = await getVaultFile(target.fileKey);
            if (vaultItem?.blob && vaultItem.blob.size > 0) {
              bytes = new Uint8Array(await vaultItem.blob.arrayBuffer());
              resolvedName = vaultItem.fileName || resolvedName;
            }
          }

          if (!bytes && target.cloudUrl) {
            const dlApi = resolveApiUrl('/api/researches/fetch-document');
            if (dlApi) {
              const resp = await fetch(dlApi, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: target.cloudUrl,
                  title: target.title || resolvedName,
                  allowLargePdf: true,
                }),
              });
              const ct = (resp.headers.get('content-type') || '').toLowerCase();
              if (resp.ok && !ct.includes('application/json') && !ct.includes('text/html')) {
                const ab = await resp.arrayBuffer();
                if (ab.byteLength > 0) {
                  bytes = new Uint8Array(ab);
                }
              }
            }
          }
        }

        if (cancelled) return;

        if (!bytes || bytes.byteLength === 0) {
          throw new Error(
            'Impossibile caricare il file PDF dal vault o dal link esterno per l’analisi.'
          );
        }

        const pdfHeader = String.fromCharCode(...bytes.slice(0, 5));
        if (!pdfHeader.startsWith('%PDF')) {
          throw new Error('Questo allegato non è un file PDF valido.');
        }

        const parsed = await analyzePdfItalianPages(bytes);
        if (cancelled) return;

        setSourceBytes(bytes);
        setSourceName(resolvedName);
        setAnalysis(parsed);
        setRangeInput(parsed.rangeText || (parsed.totalPages > 0 ? `1-${parsed.totalPages}` : ''));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Errore durante la lettura o analisi del PDF.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target]);

  const parsedPages = useMemo(() => {
    if (!analysis) return [];
    return parsePageRangesInput(rangeInput, analysis.totalPages);
  }, [rangeInput, analysis]);

  const languageSections = useMemo(() => {
    if (!analysis || analysis.detectedIndexEntries.length === 0) return [];
    const entries = analysis.detectedIndexEntries;
    const off = analysis.pageOffsetApplied;
    return entries.map((entry, idx) => {
      const nextEntry = entries[idx + 1];
      const start = Math.max(1, Math.min(analysis.totalPages, entry.startPage + off));
      const end = entry.explicitEndPage
        ? Math.max(start, Math.min(analysis.totalPages, entry.explicitEndPage + off))
        : nextEntry
          ? Math.max(start, Math.min(analysis.totalPages, nextEntry.startPage - 1 + off))
          : analysis.totalPages;
      const pages: number[] = [];
      for (let p = start; p <= end; p++) {
        pages.push(p);
      }
      return {
        lang: entry.lang,
        label: entry.label,
        start,
        end,
        pages,
      };
    });
  }, [analysis]);

  const parsedPageSet = useMemo(() => new Set(parsedPages), [parsedPages]);

  const activeLanguageCodes = useMemo(() => {
    const selected = languageSections
      .filter((sec) => sec.pages.length > 0 && sec.pages.every((p) => parsedPageSet.has(p)))
      .map((sec) => sec.lang);
    selected.sort((a, b) => {
      if (a === 'IT') return -1;
      if (b === 'IT') return 1;
      return 0;
    });
    return selected;
  }, [languageSections, parsedPageSet]);

  const activeLangTag = activeLanguageCodes.length > 0 ? activeLanguageCodes.join('+') : 'IT';

  useEffect(() => {
    if (!sourceBytes || !analysis || parsedPages.length === 0) {
      setPreviewResult(null);
      return;
    }

    const seq = ++previewSeqRef.current;
    const timer = window.setTimeout(() => {
      setBuildingPreview(true);
      void extractPdfPagesToFile(sourceBytes, parsedPages, sourceName, activeLangTag)
        .then((res) => {
          if (previewSeqRef.current === seq) {
            setPreviewResult(res);
          }
        })
        .catch((err) => {
          if (previewSeqRef.current === seq) {
            setPreviewResult(null);
            setError(
              err instanceof Error ? err.message : 'Errore durante l’anteprima del PDF ridotto.'
            );
          }
        })
        .finally(() => {
          if (previewSeqRef.current === seq) {
            setBuildingPreview(false);
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [sourceBytes, analysis, parsedPages, sourceName, activeLangTag]);

  if (!target) return null;

  const savingsPct =
    previewResult && previewResult.originalSize > 0
      ? Math.round(
          ((previewResult.originalSize - previewResult.newSize) /
            previewResult.originalSize) *
            100
        )
      : 0;

  function handleToggleLanguageSection(section: {
    lang: string;
    start: number;
    end: number;
    pages: number[];
  }) {
    if (!analysis) return;
    const nextSet = new Set(parsedPages);
    const isSelected = section.pages.length > 0 && section.pages.every((p) => nextSet.has(p));
    if (isSelected) {
      for (const p of section.pages) {
        if (!analysis.coverPages.includes(p)) {
          nextSet.delete(p);
        }
      }
    } else {
      for (const c of analysis.coverPages) nextSet.add(c);
      for (const p of section.pages) nextSet.add(p);
    }
    const nextSorted = Array.from(nextSet).sort((a, b) => a - b);
    setRangeInput(formatPageRangesSummary(nextSorted));
  }

  function handleOpenPreviewInNewTab() {
    if (!previewResult) return;
    const typedBlob = new Blob([previewResult.file], { type: 'application/pdf' });
    const url = URL.createObjectURL(typedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function handleDownloadCopy() {
    if (!previewResult) return;
    const url = URL.createObjectURL(previewResult.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = previewResult.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleConfirmSave() {
    if (!previewResult || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveTrimmedFile(previewResult);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Errore durante il salvataggio del PDF ridotto.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/65 backdrop-blur-xs md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 border-t md:border border-slate-200 dark:border-slate-800 rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="md:hidden pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center shrink-0">
              <Scissors className="w-4 h-4 text-brand-700 dark:text-brand-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Estrai solo Italiano + copertina
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {target.title}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Chiudi"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {loading && (
            <div className="py-10 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin text-brand-600 dark:text-brand-400" />
              <div className="text-xs font-medium text-center">
                Analisi indice lingue e pagine del PDF in corso...
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-500/35 bg-rose-50 dark:bg-rose-950/35 p-3.5 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {!loading && analysis && sourceBytes && (
            <>
              {/* Detection summary */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <Languages className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {analysis.method === 'cover_index'
                        ? 'Indice multilingua trovato in copertina'
                        : analysis.method === 'text_detection'
                          ? 'Lingua italiana rilevata nelle pagine'
                          : analysis.method === 'already_italian'
                            ? 'Manuale già in italiano'
                            : 'Selezione manuale delle pagine'}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {analysis.summary}
                    </p>
                  </div>
                </div>

                {languageSections.length > 0 && (
                  <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Clicca una o più lingue per includerle o rimuoverle:
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px] font-mono tabular-nums">
                      {languageSections.map((sec) => {
                        const isSelected =
                          sec.pages.length > 0 && sec.pages.every((p) => parsedPageSet.has(p));
                        return (
                          <button
                            key={`${sec.lang}-${sec.start}`}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => handleToggleLanguageSection(sec)}
                            title={
                              isSelected
                                ? `Rimuovi ${sec.lang} (pag. ${sec.start}–${sec.end})`
                                : `Includi anche ${sec.lang} (pag. ${sec.start}–${sec.end})`
                            }
                            className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-400 dark:border-emerald-500/50 text-emerald-800 dark:text-emerald-200 font-bold'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {sec.lang} p.{sec.start}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Editable page selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Pagine da mantenere (su {analysis.totalPages} totali)
                  </label>
                  {analysis.rangeText && rangeInput !== analysis.rangeText && (
                    <button
                      type="button"
                      onClick={() => setRangeInput(analysis.rangeText)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 dark:text-brand-300 hover:underline"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Ripristina ({analysis.rangeText})
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  placeholder="Es. 1, 65-85"
                  className="w-full min-h-[44px] md:min-h-0 px-3.5 py-2 text-base md:text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Puoi separare pagine o intervalli con la virgola (es.{' '}
                  <span className="font-mono">1, 65-85</span>). Mantenere la pagina{' '}
                  <span className="font-mono">1</span> conserva la copertina col modello.
                </p>
              </div>

              {/* Size & page savings comparison */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 grid grid-cols-2 gap-3 tabular-nums">
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    File attuale
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {formatFileSize(sourceBytes.byteLength)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {analysis.totalPages} pagine
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <span>
                      {activeLangTag === 'IT'
                        ? 'Nuovo file (solo IT)'
                        : `Nuovo file (${activeLangTag})`}
                    </span>
                    {buildingPreview && <Loader2 className="w-3 h-3 animate-spin" />}
                  </div>
                  {previewResult ? (
                    <>
                      <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 flex items-center gap-1.5">
                        <span>{formatFileSize(previewResult.newSize)}</span>
                        {savingsPct > 0 && (
                          <span className="text-xs font-mono">(-{savingsPct}%)</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        {previewResult.pageCount} pagine · {formatPageRangesSummary(previewResult.keptPages)}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-slate-400 mt-1">
                      {parsedPages.length === 0
                        ? 'Nessuna pagina valida selezionata'
                        : 'Calcolo dimensioni...'}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!previewResult || saving || loading || buildingPreview}
              onClick={handleOpenPreviewInNewTab}
              className="min-h-[44px] md:min-h-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/15 dark:hover:bg-brand-500/25 rounded-xl disabled:opacity-50 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Vedi copia {activeLangTag}</span>
            </button>

            <button
              type="button"
              disabled={!previewResult || saving || loading || buildingPreview}
              onClick={handleDownloadCopy}
              className="min-h-[44px] md:min-h-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Scarica copia {activeLangTag}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] md:min-h-0 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={!previewResult || saving || loading || buildingPreview}
              onClick={() => void handleConfirmSave()}
              className="min-h-[44px] md:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:text-slate-950 dark:bg-brand-400 dark:hover:bg-brand-300 rounded-xl disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvataggio...</span>
                </>
              ) : (
                <>
                  {target.file ? (
                    <Sparkles className="w-3.5 h-3.5" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {target.file
                      ? 'Applica al file selezionato'
                      : activeLangTag === 'IT'
                        ? 'Salva solo IT nel DB'
                        : `Salva ${activeLangTag} nel DB`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
