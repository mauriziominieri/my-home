import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FileCheck2,
  Mail,
  MessageCircle,
  FileUp,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatFileSize,
  getVaultFile,
  ShareableItemPayload,
  StoredVaultFile,
  VAULT_UPDATED_EVENT,
} from '../utils/documentVault';

interface ShareSheetModalProps {
  item: ShareableItemPayload;
  readOnly?: boolean;
  onClose: () => void;
  onReplaceAttachment?: () => void;
  onDeleteItem?: () => Promise<void>;
}

export function ShareSheetModal({
  item,
  readOnly = false,
  onClose,
  onReplaceAttachment,
  onDeleteItem,
}: ShareSheetModalProps) {
  const [attachedFile, setAttachedFile] = useState<StoredVaultFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshFile = async () => {
      const found =
        !readOnly && item.attachmentKey ? await getVaultFile(item.attachmentKey) : null;
      if (!cancelled) {
        setAttachedFile(found);
        setLoadingFile(false);
      }
    };
    setLoadingFile(!readOnly);
    void refreshFile();
    window.addEventListener(VAULT_UPDATED_EVENT, refreshFile);
    return () => {
      cancelled = true;
      window.removeEventListener(VAULT_UPDATED_EVENT, refreshFile);
    };
  }, [item.attachmentKey, readOnly]);

  async function handleNativeShare() {
    setShareFeedback(null);
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      setShareFeedback('Condivisione diretta di sistema non supportata da questo browser: usa WhatsApp, Email o Scarica.');
      return;
    }

    try {
      const fileObj =
        attachedFile && !readOnly
          ? new File([attachedFile.blob], attachedFile.fileName, {
              type: attachedFile.mimeType || 'application/pdf',
            })
          : new File([item.htmlDocument], item.fallbackFileName, { type: 'text/html' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [fileObj] })) {
        await navigator.share({
          title: item.title,
          text: item.shareText,
          files: [fileObj],
        });
        setShareFeedback(
          attachedFile && !readOnly ? 'PDF originale condiviso.' : 'Riepilogo HTML condiviso.'
        );
        return;
      }

      if (attachedFile && !readOnly) {
        setShareFeedback('Questo browser non consente di condividere il PDF come file: usa Scarica o Email.');
        return;
      }

      await navigator.share({
        title: item.title,
        text: item.shareText,
        ...(item.cloudUrl ? { url: item.cloudUrl } : {}),
      });
      setShareFeedback('Dettagli condivisi.');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setShareFeedback('Usa i pulsanti Copia, WhatsApp o Email qui sotto (oppure Scarica dalla scheda).');
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(item.shareText);
      setCopied(true);
      setShareFeedback('Testo riepilogativo copiato negli appunti.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareFeedback('Impossibile accedere agli appunti su questo browser.');
    }
  }

  async function handleDeleteItem() {
    if (!onDeleteItem || deletingItem) return;
    setConfirmDelete(false);
    setDeletingItem(true);
    setShareFeedback(null);
    try {
      await onDeleteItem();
      onClose();
    } catch (err) {
      setShareFeedback(
        err instanceof Error ? err.message : 'Errore durante l’eliminazione della bolletta.'
      );
    } finally {
      setDeletingItem(false);
    }
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(item.shareText)}`;
  const emailUrl = `mailto:?subject=${encodeURIComponent(item.title)}&body=${encodeURIComponent(
    item.shareText
  )}`;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const sizeLabel = attachedFile ? formatFileSize(attachedFile.size) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 dark:bg-black/75 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-300">
              <Share2 className="w-3.5 h-3.5" />
              Condividi
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-1">{item.title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi finestra condivisione"
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Attachment indicator */}
          <div
            className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2 ${
              attachedFile
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                : 'bg-slate-50 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileCheck2
                className={`w-4 h-4 shrink-0 ${
                  attachedFile ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                }`}
              />
              <span className="truncate">
                {readOnly
                  ? 'Accesso pubblico: PDF originale riservato. Puoi condividere il riepilogo o usare Scarica per l’HTML.'
                  : loadingFile
                  ? 'Verifica file su Firestore...'
                  : attachedFile
                    ? `PDF originale pronto (${
                        attachedFile.origin === 'firestore'
                          ? 'su Firestore · multi-dispositivo'
                          : attachedFile.origin === 'bundled'
                            ? 'incluso nell’app · multi-dispositivo'
                            : 'solo cache locale'
                      }): ${attachedFile.fileName}${sizeLabel ? ` (${sizeLabel})` : ''}`
                    : 'Nessun file allegato: puoi condividere i dettagli o usare Scarica per il riepilogo HTML.'}
              </span>
            </div>
            {!readOnly && onReplaceAttachment && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={onReplaceAttachment}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 dark:text-sky-200 bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/15 dark:hover:bg-sky-500/25 border border-sky-200 dark:border-sky-500/30 rounded-lg"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  {attachedFile ? 'Sostituisci PDF' : 'Allega PDF originale'}
                </button>
                {onDeleteItem && (
                  confirmDelete ? (
                    <div className="inline-flex items-center gap-1 px-2 py-1 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/40 rounded-lg text-[11px]">
                      <span className="text-rose-700 dark:text-rose-200">Confermi?</span>
                      <button
                        type="button"
                        onClick={() => void handleDeleteItem()}
                        disabled={deletingItem}
                        className="px-2 py-0.5 font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded disabled:opacity-50"
                      >
                        {deletingItem ? 'Elimino…' : 'Elimina'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="px-1.5 py-0.5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      disabled={deletingItem}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-200 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 rounded-lg disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deletingItem ? 'Elimino…' : 'Elimina scheda + PDF'}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* Preview text */}
          <div className="bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Anteprima testo di condivisione
            </div>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 dark:text-slate-200 leading-relaxed max-h-40 overflow-y-auto">
              {item.shareText}
            </pre>
          </div>

          {/* Primary actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {canNativeShare && (
              <button
                type="button"
                onClick={() => void handleNativeShare()}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 dark:text-slate-950 dark:bg-sky-500 dark:hover:bg-sky-400 rounded-lg transition-colors"
              >
                <Share2 className="w-4 h-4" />
                {attachedFile && !readOnly
                  ? 'Condividi PDF originale'
                  : 'Condividi riepilogo'}
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleCopy()}
              className={`inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors ${
                canNativeShare ? '' : 'sm:col-span-2'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Copiato!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copia riepilogo
                </>
              )}
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 border border-emerald-200 dark:border-emerald-500/35 rounded-lg transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              Invia su WhatsApp
            </a>

            <a
              href={emailUrl}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-sky-700 dark:text-sky-200 bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/15 dark:hover:bg-sky-500/25 border border-sky-200 dark:border-sky-500/35 rounded-lg transition-colors"
            >
              <Mail className="w-4 h-4" />
              Invia via Email
            </a>
          </div>

          {attachedFile && !readOnly && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Su smartphone o browser compatibili <strong className="text-slate-800 dark:text-slate-200">Condividi PDF originale</strong> allega direttamente il file; su PC da WhatsApp Web o Email clicca prima <strong className="text-slate-800 dark:text-slate-200">Scarica</strong> dalla scheda per allegarlo.
            </p>
          )}

          {item.cloudUrl && (
            <div className="flex justify-end pt-1">
              <a
                href={item.cloudUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Apri link cloud
              </a>
            </div>
          )}

          {shareFeedback && (
            <p className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 rounded-lg px-3 py-2">
              {shareFeedback}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
