import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Droplets,
  FileText,
  FileUp,
  Loader2,
  Receipt,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { BillRecord, TariBillRecord, WaterBillRecord } from '../types/home';
import {
  ImportedBillDraft,
  parseBillText,
  parseImportedBillFiles,
} from '../utils/billImporter';
import {
  getElectricityBillFileKey,
  getTariBillFileKey,
  getWaterBillFileKey,
  MAX_CLOUD_FILE_BYTES,
  saveVaultFile,
} from '../utils/documentVault';

interface BillImportModalProps {
  defaultKind?: 'luce' | 'acqua' | 'tari';
  onClose: () => void;
  onSaveElectricityBill?: (bill: BillRecord) => Promise<void>;
  onSaveWaterBill?: (bill: Omit<WaterBillRecord, 'id'>) => Promise<void>;
  onSaveTariBill?: (bill: Omit<TariBillRecord, 'id'>) => Promise<void>;
}

export function BillImportModal({
  defaultKind,
  onClose,
  onSaveElectricityBill,
  onSaveWaterBill,
  onSaveTariBill,
}: BillImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [parsing, setParsing] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ImportedBillDraft[]>([]);
  const [expandedRawId, setExpandedRawId] = useState<string | null>(null);
  const [forceTypeOnUpload, setForceTypeOnUpload] = useState<'auto' | 'luce' | 'acqua' | 'tari'>(
    defaultKind || 'auto'
  );

  function isPdfFile(file: File): boolean {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  }

  function isReadyForAutomaticSave(draft: ImportedBillDraft): boolean {
    if (draft.confidence !== 'alta') return false;
    if (draft.kind === 'luce') {
      return Boolean(
        draft.data.invoiceNumber.trim() &&
          draft.data.period.trim() &&
          draft.data.kwh > 0 &&
          draft.data.totalPaid > 0
      );
    }
    if (draft.kind === 'acqua') {
      return Boolean(
        draft.data.invoiceNumber.trim() &&
          draft.data.period.trim() &&
          draft.data.cubicMeters > 0 &&
          draft.data.totalPaid > 0
      );
    }
    return Boolean(
      draft.data.noticeNumber.trim() && draft.data.period.trim() && draft.data.totalPaid > 0
    );
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setParsing(true);
    setErrorMsg(null);
    setSavedCount(0);
    try {
      const forced = forceTypeOnUpload === 'auto' ? undefined : forceTypeOnUpload;
      const parsed = await parseImportedBillFiles(files, forced);
      if (parsed.length === 0) {
        setErrorMsg(
          'Nessuna bolletta riconosciuta. Verifica che il file contenga periodo e importi: i contratti non vengono importati come bollette.'
        );
      } else {
        const reviewDrafts: ImportedBillDraft[] = [];
        let autoSaved = 0;
        for (const draft of parsed) {
          if (!isReadyForAutomaticSave(draft)) {
            reviewDrafts.push(draft);
            continue;
          }
          try {
            await saveDraft(draft);
            autoSaved++;
          } catch (err) {
            reviewDrafts.push(draft);
            setErrorMsg(
              err instanceof Error
                ? err.message
                : 'Salvataggio automatico non riuscito: controlla i dati e riprova.'
            );
          }
        }
        if (reviewDrafts.length > 0) {
          setDrafts((prev) => [...prev, ...reviewDrafts]);
        }
        if (autoSaved > 0) setSavedCount((count) => count + autoSaved);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Errore durante la lettura del file bolletta.'
      );
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleSwitchKind(draftId: string, nextKind: 'luce' | 'acqua' | 'tari') {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== draftId || d.kind === nextKind) return d;
        const reparsed = parseBillText(d.rawPreview || '', d.fileName, nextKind)[0];
        if (!reparsed) return d;
        return { ...reparsed, id: d.id, sourceFile: d.sourceFile };
      })
    );
  }

  function updateElecField<K extends keyof BillRecord>(
    draftId: string,
    key: K,
    value: BillRecord[K]
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== draftId || d.kind !== 'luce') return d;
        const nextData = { ...d.data, [key]: value };
        if (key === 'totalPaid' || key === 'canoneTv') {
          nextData.electricityOnly = Math.max(
            0,
            Math.round((Number(nextData.totalPaid) - Number(nextData.canoneTv)) * 100) / 100
          );
        }
        if (key === 'issueDate' && typeof value === 'string') {
          const dm = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          if (dm) {
            nextData.year = Number(dm[3]);
            nextData.sortKey = `${dm[3]}-${dm[2]}`;
          }
        }
        return { ...d, data: nextData };
      })
    );
  }

  function updateWaterField<K extends keyof Omit<WaterBillRecord, 'id'>>(
    draftId: string,
    key: K,
    value: Omit<WaterBillRecord, 'id'>[K]
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== draftId || d.kind !== 'acqua') return d;
        return { ...d, data: { ...d.data, [key]: value } };
      })
    );
  }

  function updateTariField<K extends keyof Omit<TariBillRecord, 'id'>>(
    draftId: string,
    key: K,
    value: Omit<TariBillRecord, 'id'>[K]
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== draftId || d.kind !== 'tari') return d;
        return { ...d, data: { ...d.data, [key]: value } };
      })
    );
  }

  async function saveDraft(draft: ImportedBillDraft) {
    if (draft.kind === 'luce' && onSaveElectricityBill) {
      await onSaveElectricityBill(draft.data);
      if (draft.sourceFile && isPdfFile(draft.sourceFile)) {
        await saveVaultFile(
          getElectricityBillFileKey(draft.data.invoiceNumber),
          draft.sourceFile,
          draft.sourceFile.name,
          draft.sourceFile.type
        );
      }
    } else if (draft.kind === 'acqua' && onSaveWaterBill) {
      await onSaveWaterBill(draft.data);
      if (draft.sourceFile && isPdfFile(draft.sourceFile)) {
        await saveVaultFile(
          getWaterBillFileKey(draft.data.invoiceNumber),
          draft.sourceFile,
          draft.sourceFile.name,
          draft.sourceFile.type
        );
      }
    } else if (draft.kind === 'tari' && onSaveTariBill) {
      await onSaveTariBill(draft.data);
      if (draft.sourceFile && isPdfFile(draft.sourceFile)) {
        await saveVaultFile(
          getTariBillFileKey(draft.data.noticeNumber),
          draft.sourceFile,
          draft.sourceFile.name,
          draft.sourceFile.type
        );
      }
    } else {
      throw new Error('Salvataggio non disponibile per questo tipo di bolletta (effettua prima il login).');
    }
  }

  async function handleSaveSingle(draft: ImportedBillDraft) {
    setErrorMsg(null);
    try {
      await saveDraft(draft);
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      setSavedCount((c) => c + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore nel salvataggio su Firebase.');
    }
  }

  async function handleSaveAll() {
    if (drafts.length === 0) return;
    setSavingAll(true);
    setErrorMsg(null);
    let ok = 0;
    try {
      const remaining: ImportedBillDraft[] = [];
      for (const d of drafts) {
        try {
          await saveDraft(d);
          ok++;
        } catch (err) {
          remaining.push(d);
          setErrorMsg(err instanceof Error ? err.message : 'Errore nel salvataggio di una bolletta.');
        }
      }
      setDrafts(remaining);
      setSavedCount((c) => c + ok);
      if (remaining.length === 0) {
        onClose();
      }
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <FileUp className="w-5 h-5 text-sky-400" />
              Importa le tue Bollette (PDF / CSV / JSON)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Rilevo automaticamente utenza e periodo. Le bollette complete vengono archiviate subito; se manca un dato puoi correggere la bozza prima di salvarla. Il PDF originale resta privato su Firestore.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi importazione bollette"
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Upload Bar */}
          <div className="bg-slate-950/70 border border-dashed border-sky-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                <Upload className="w-4 h-4 text-sky-400" />
                Seleziona uno o più file dal dispositivo
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>Tipo rilevamento:</span>
                {(['auto', 'luce', 'acqua', 'tari'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForceTypeOnUpload(t)}
                    className={`px-2 py-0.5 rounded border transition-colors ${
                      forceTypeOnUpload === t
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-semibold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {t === 'auto'
                      ? 'Automatico'
                      : t === 'luce'
                        ? 'Luce'
                        : t === 'acqua'
                          ? 'Acqua'
                          : 'TARI'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.csv,.txt,.json,application/pdf,text/csv,application/json"
                onChange={(e) => void handleFilesSelected(e.target.files)}
                className="hidden"
              />
              <button
                type="button"
                disabled={parsing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-60 rounded-lg transition-colors"
              >
                {parsing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analisi in corso...
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4" />
                    Scegli file (.pdf, .csv, .json)
                  </>
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="px-3.5 py-2.5 rounded-lg bg-rose-500/15 border border-rose-500/35 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          {savedCount > 0 && (
            <div className="px-3.5 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Salvate {savedCount} {savedCount === 1 ? 'bolletta' : 'bollette'} su Firebase!
            </div>
          )}

          {/* Drafts list */}
          {drafts.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 space-y-1">
              <p>Nessun file ancora in coda.</p>
              <p>Puoi caricare PDF Edison, Octopus Energy, Enel, AcegasApsAmga Acqua, TARI oppure CSV/JSON.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold uppercase text-[10px] border ${
                          draft.kind === 'luce'
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                            : draft.kind === 'acqua'
                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                              : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {draft.kind === 'luce' ? (
                          <Zap className="w-3 h-3" />
                        ) : draft.kind === 'acqua' ? (
                          <Droplets className="w-3 h-3" />
                        ) : (
                          <Receipt className="w-3 h-3" />
                        )}
                        {draft.kind}
                      </span>
                      <span className="font-mono text-slate-200 font-medium">{draft.fileName}</span>
                      {draft.sourceFile && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] border ${
                            isPdfFile(draft.sourceFile) &&
                            draft.sourceFile.size > MAX_CLOUD_FILE_BYTES
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : isPdfFile(draft.sourceFile)
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {isPdfFile(draft.sourceFile)
                            ? draft.sourceFile.size > MAX_CLOUD_FILE_BYTES
                              ? 'PDF > 6 MB (solo locale)'
                              : 'PDF originale incluso al salvataggio'
                            : 'File CSV/JSON usato per importazione'}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${
                          draft.confidence === 'alta'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : draft.confidence === 'media'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        Estrazione: {draft.confidence}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={draft.kind}
                        onChange={(e) =>
                          handleSwitchKind(draft.id, e.target.value as 'luce' | 'acqua' | 'tari')
                        }
                        className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 [color-scheme:dark]"
                      >
                        <option value="luce">Tipo: Luce</option>
                        <option value="acqua">Tipo: Acqua</option>
                        <option value="tari">Tipo: TARI</option>
                      </select>

                      {draft.rawPreview && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRawId((prev) => (prev === draft.id ? null : draft.id))
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-300 hover:text-sky-300"
                        >
                          <FileText className="w-3 h-3" />
                          {expandedRawId === draft.id ? 'Nascondi testo' : 'Vedi testo PDF'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setDrafts((prev) => prev.filter((x) => x.id !== draft.id))}
                        aria-label="Rimuovi bozza"
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {expandedRawId === draft.id && draft.rawPreview && (
                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-mono text-slate-400 max-h-40 overflow-y-auto whitespace-pre-wrap">
                      {draft.rawPreview}
                    </pre>
                  )}

                  {draft.kind === 'luce' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Fornitore</span>
                        <input
                          type="text"
                          value={draft.data.supplier}
                          onChange={(e) => updateElecField(draft.id, 'supplier', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Offerta</span>
                        <input
                          type="text"
                          value={draft.data.offerName}
                          onChange={(e) => updateElecField(draft.id, 'offerName', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">N° Fattura</span>
                        <input
                          type="text"
                          value={draft.data.invoiceNumber}
                          onChange={(e) =>
                            updateElecField(draft.id, 'invoiceNumber', e.target.value)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Data emissione</span>
                        <input
                          type="text"
                          value={draft.data.issueDate}
                          onChange={(e) => updateElecField(draft.id, 'issueDate', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Periodo</span>
                        <input
                          type="text"
                          value={draft.data.period}
                          onChange={(e) => updateElecField(draft.id, 'period', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">kWh fatturati</span>
                        <input
                          type="number"
                          value={draft.data.kwh}
                          onChange={(e) => updateElecField(draft.id, 'kwh', Number(e.target.value) || 0)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Canone TV (€)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={draft.data.canoneTv}
                          onChange={(e) =>
                            updateElecField(draft.id, 'canoneTv', Number(e.target.value) || 0)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Totale pagato (€)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={draft.data.totalPaid}
                          onChange={(e) =>
                            updateElecField(draft.id, 'totalPaid', Number(e.target.value) || 0)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-emerald-300 font-semibold"
                        />
                      </label>
                    </div>
                  )}

                  {draft.kind === 'acqua' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">N° Fattura</span>
                        <input
                          type="text"
                          value={draft.data.invoiceNumber}
                          onChange={(e) =>
                            updateWaterField(draft.id, 'invoiceNumber', e.target.value)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Data emissione</span>
                        <input
                          type="text"
                          value={draft.data.issueDate}
                          onChange={(e) => updateWaterField(draft.id, 'issueDate', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Periodo</span>
                        <input
                          type="text"
                          value={draft.data.period}
                          onChange={(e) => updateWaterField(draft.id, 'period', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Consumo (m³)</span>
                        <input
                          type="number"
                          step="0.1"
                          value={draft.data.cubicMeters}
                          onChange={(e) =>
                            updateWaterField(draft.id, 'cubicMeters', Number(e.target.value) || 0)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Quota fissa (€)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={draft.data.fixedCostEur}
                          onChange={(e) =>
                            updateWaterField(draft.id, 'fixedCostEur', Number(e.target.value) || 0)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Totale pagato (€)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={draft.data.totalPaid}
                          onChange={(e) =>
                            updateWaterField(draft.id, 'totalPaid', Number(e.target.value) || 0)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-cyan-300 font-semibold"
                        />
                      </label>
                    </div>
                  )}

                  {draft.kind === 'tari' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">N° Avviso</span>
                        <input
                          type="text"
                          value={draft.data.noticeNumber}
                          onChange={(e) =>
                            updateTariField(draft.id, 'noticeNumber', e.target.value)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Periodo</span>
                        <input
                          type="text"
                          value={draft.data.period}
                          onChange={(e) => updateTariField(draft.id, 'period', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Scadenza</span>
                        <input
                          type="text"
                          value={draft.data.dueDate}
                          onChange={(e) => updateTariField(draft.id, 'dueDate', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">Importo (€)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={draft.data.totalPaid}
                          onChange={(e) =>
                            updateTariField(draft.id, 'totalPaid', Number(e.target.value) || 0)
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded font-mono text-amber-300 font-semibold"
                        />
                      </label>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSaveSingle(draft)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Salva questa bolletta su Firebase
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 flex items-center justify-between gap-3 bg-slate-950/60">
          <span className="text-[11px] text-slate-400">
            {drafts.length > 0
              ? `${drafts.length} ${drafts.length === 1 ? 'bolletta pronta' : 'bollette pronte'} per il salvataggio`
              : 'Puoi importare più bollette insieme'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
            >
              Chiudi
            </button>
            {drafts.length > 1 && (
              <button
                type="button"
                disabled={savingAll}
                onClick={() => void handleSaveAll()}
                className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-lg"
              >
                {savingAll ? 'Salvataggio...' : `Salva tutte (${drafts.length}) su Firebase`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
