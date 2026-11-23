import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  Mail,
  MessageCircle,
  Share2,
  X,
} from 'lucide-react';
import {
  downloadShareableItem,
  formatFileSize,
  getVaultFile,
  ShareableItemPayload,
  StoredVaultFile,
} from '../utils/documentVault';

interface ShareSheetModalProps {
  item: ShareableItemPayload;
  onClose: () => void;
}

export function ShareSheetModal({ item, onClose }: ShareSheetModalProps) {
  const [attachedFile, setAttachedFile] = useState<StoredVaultFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingFile(true);
    void (async () => {
      const found = item.attachmentKey ? await getVaultFile(item.attachmentKey) : null;
      if (!cancelled) {
        setAttachedFile(found);
        setLoadingFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.attachmentKey]);

  async function handleNativeShare() {
    setShareFeedback(null);
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      setShareFeedback('Condivisione diretta di sistema non supportata da questo browser: usa WhatsApp, Email o Scarica.');
      return;
    }

    try {
      if (attachedFile) {
        const fileObj = new File([attachedFile.blob], attachedFile.fileName, {
          type: attachedFile.mimeType || 'application/pdf',
        });
        if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [fileObj] })) {
          await navigator.share({
            title: item.title,
            text: item.shareText,
            files: [fileObj],
          });
          setShareFeedback('File condiviso con successo.');
          return;
        }
      }

      await navigator.share({
        title: item.title,
        text: item.shareText,
        ...(item.cloudUrl ? { url: item.cloudUrl } : {}),
      });
      setShareFeedback('Dettagli condivisi.');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setShareFeedback('Usa i pulsanti Scarica, WhatsApp o Email qui sotto per inviare il file.');
    }
  }

  async function handleDownload() {
    const mode = await downloadShareableItem(item);
    setShareFeedback(
      mode === 'attached'
        ? `PDF originale "${attachedFile?.fileName}" scaricato.`
        : 'Scheda stampabile scaricata (aprila e salva come PDF se ti serve in formato PDF).'
    );
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

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(item.shareText)}`;
  const emailUrl = `mailto:?subject=${encodeURIComponent(item.title)}&body=${encodeURIComponent(
    item.shareText
  )}`;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const sizeLabel = attachedFile ? formatFileSize(attachedFile.size) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
              <Share2 className="w-3.5 h-3.5" />
              Scarica o Condividi
            </div>
            <h3 className="text-base font-bold text-slate-100 mt-1">{item.title}</h3>
            <p className="text-xs text-slate-400">{item.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi finestra condivisione"
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Attachment indicator */}
          <div
            className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2 ${
              attachedFile
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-slate-950/70 border-slate-800 text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileCheck2
                className={`w-4 h-4 shrink-0 ${
                  attachedFile ? 'text-emerald-400' : 'text-slate-400'
                }`}
              />
              <span className="truncate">
                {loadingFile
                  ? 'Verifica file su Firestore...'
                  : attachedFile
                    ? `PDF originale pronto (${
                        attachedFile.origin === 'firestore'
                          ? 'su Firestore · multi-dispositivo'
                          : attachedFile.origin === 'bundled'
                            ? 'incluso nell’app · multi-dispositivo'
                            : 'solo cache locale'
                      }): ${attachedFile.fileName}${sizeLabel ? ` (${sizeLabel})` : ''}`
                    : 'Nessun PDF allegato: puoi scaricare la scheda stampabile o inviare il riepilogo.'}
              </span>
            </div>
          </div>

          {/* Preview text */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Anteprima testo di condivisione
            </div>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-200 leading-relaxed max-h-40 overflow-y-auto">
              {item.shareText}
            </pre>
          </div>

          {/* Primary actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              {attachedFile ? 'Scarica PDF Originale' : 'Scarica Scheda Stampabile'}
            </button>

            {canNativeShare ? (
              <button
                type="button"
                onClick={() => void handleNativeShare()}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-100 bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors"
              >
                <Share2 className="w-4 h-4" />
                {attachedFile ? 'Invia / Condividi PDF' : 'Condividi dal dispositivo'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    Copiato!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copia riepilogo
                  </>
                )}
              </button>
            )}

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 rounded-lg transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              Invia su WhatsApp
            </a>

            <a
              href={emailUrl}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-sky-200 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 rounded-lg transition-colors"
            >
              <Mail className="w-4 h-4" />
              Invia via Email
            </a>
          </div>

          {attachedFile && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Su smartphone o browser compatibili <strong className="text-slate-200">Invia / Condividi PDF</strong> allega direttamente il file; su PC da WhatsApp Web o Email clicca prima <strong className="text-slate-200">Scarica PDF Originale</strong> per allegarlo.
            </p>
          )}

          {canNativeShare && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800/80 rounded-lg"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copiato!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copia testo
                  </>
                )}
              </button>
              {item.cloudUrl && (
                <a
                  href={item.cloudUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Apri link cloud
                </a>
              )}
            </div>
          )}

          {shareFeedback && (
            <p className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
              {shareFeedback}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
