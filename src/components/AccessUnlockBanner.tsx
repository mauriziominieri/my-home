import React from 'react';
import { Lock, Mail, Sparkles } from 'lucide-react';

interface AccessUnlockBannerProps {
  isSignedIn: boolean;
  isGmailConnected?: boolean;
  onSignIn?: () => void;
  onConnectGmail?: () => void;
  unlockedFeatures: string[];
  gmailFeatures?: string[];
  pageName: string;
}

export function AccessUnlockBanner({
  isSignedIn,
  onSignIn,
  unlockedFeatures,
  gmailFeatures,
  pageName,
}: AccessUnlockBannerProps) {
  const hasGmailExtras = Boolean(gmailFeatures && gmailFeatures.length > 0);

  if (isSignedIn) {
    return null;
  }

  return (
    <div className="bg-slate-900/85 border border-sky-500/35 rounded-xl px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
      <div className="space-y-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-md">
            <Lock className="w-3 h-3" />
            Sola Lettura
          </span>
          <span className="font-semibold text-slate-100">
            Accedi con Google per sbloccare tutte le funzioni in {pageName}
          </span>
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
          {unlockedFeatures.map((feat) => (
            <li key={feat} className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-sky-400 shrink-0" />
              <span>{feat}</span>
            </li>
          ))}
        </ul>

        {hasGmailExtras && gmailFeatures && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-300/95 pt-0.5">
            <Mail className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              In più, dalla barra in alto puoi collegare <strong>Gmail</strong>: {gmailFeatures.join(' · ')}
            </span>
          </div>
        )}
      </div>

      {onSignIn && (
        <button
          type="button"
          onClick={onSignIn}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0 self-start md:self-center"
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 48 48"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          <span>Accedi con Google</span>
        </button>
      )}
    </div>
  );
}
