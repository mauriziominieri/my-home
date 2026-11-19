import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Si è verificato un errore imprevisto.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-base font-semibold text-slate-100">
                Errore di sincronizzazione
              </h1>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">
              Si è verificato un problema durante l&apos;accesso ai dati. Ricarica la
              pagina o verifica la tua sessione Google.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-400 break-all max-h-32 overflow-auto">
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Ricarica applicazione
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
