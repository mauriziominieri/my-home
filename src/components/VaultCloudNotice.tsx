import React, { useEffect, useState } from 'react';
import { Check, CloudOff, Copy, ExternalLink, X } from 'lucide-react';
import firestoreRulesRaw from '../../firestore.rules?raw';
import { subscribeVaultCloudStatus, VaultCloudStatus } from '../utils/documentVault';

const CONSOLE_RULES_URL =
  'https://console.firebase.google.com/project/spiritual-bearing-sq7xb/firestore/databases/ai-studio-30a168e3-8158-474f-b9f2-f717d7220314/rules';

export function VaultCloudNotice() {
  const [status, setStatus] = useState<VaultCloudStatus>('idle');
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribeVaultCloudStatus((next) => {
      setStatus(next);
      if (next === 'ok') setDismissed(false);
    });
  }, []);

  if (status !== 'rules-required' || dismissed) return null;

  async function handleCopyRules() {
    try {
      await navigator.clipboard.writeText(firestoreRulesRaw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/30 text-xs text-amber-100 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-start sm:items-center gap-2 min-w-0">
        <CloudOff className="w-4 h-4 text-amber-300 shrink-0 mt-0.5 sm:mt-0" />
        <span>
          Per sincronizzare e scaricare i PDF caricati anche su <strong>altri dispositivi</strong>, pubblica una volta le regole aggiornate di <code className="font-mono text-amber-200">vaultFiles</code> su Firebase Console (nel frattempo i file restano salvati in locale su questo browser).
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void handleCopyRules()}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-md transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Regole copiate!' : 'Copia firestore.rules'}</span>
        </button>
        <a
          href={CONSOLE_RULES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          <span>Apri Firebase Rules</span>
        </a>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Chiudi avviso regole Firestore"
          className="p-1 text-amber-200/70 hover:text-amber-100"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
