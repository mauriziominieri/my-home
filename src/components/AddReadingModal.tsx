import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ParsedReadingInput } from '../utils/edistribuzioneCsv';

interface AddReadingModalProps {
  open: boolean;
  tariffEurPerKwh: number;
  onClose: () => void;
  onSave: (reading: ParsedReadingInput) => Promise<void>;
}

export function AddReadingModal({
  open,
  tariffEurPerKwh,
  onClose,
  onSave,
}: AddReadingModalProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayIso);
  const [f1, setF1] = useState('4.20');
  const [f2, setF2] = useState('3.40');
  const [f3, setF3] = useState('6.10');
  const [peakKw, setPeakKw] = useState('3.4');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const f1Num = Math.max(0, Number.parseFloat(f1.replace(',', '.')) || 0);
  const f2Num = Math.max(0, Number.parseFloat(f2.replace(',', '.')) || 0);
  const f3Num = Math.max(0, Number.parseFloat(f3.replace(',', '.')) || 0);
  const totalKwh = Math.round((f1Num + f2Num + f3Num) * 100) / 100;
  const estCost = Math.round(totalKwh * tariffEurPerKwh * 100) / 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setSaving(true);
    try {
      await onSave({
        date,
        f1Kwh: Math.min(500, Math.round(f1Num * 100) / 100),
        f2Kwh: Math.min(500, Math.round(f2Num * 100) / 100),
        f3Kwh: Math.min(500, Math.round(f3Num * 100) / 100),
        totalKwh: Math.min(1500, totalKwh),
        peakKw: Math.min(50, Math.max(0, Number.parseFloat(peakKw.replace(',', '.')) || 0)),
        notes: notes.trim().slice(0, 240) || undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Registra consumo giornaliero
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Inserisci i valori kWh rilevati su e-distribuzione
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi finestra"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                Data
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                Picco Potenza (kW)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="50"
                required
                value={peakKw}
                onChange={(e) => setPeakKw(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                F1 (kWh)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="500"
                required
                value={f1}
                onChange={(e) => setF1(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                F2 (kWh)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="500"
                required
                value={f2}
                onChange={(e) => setF2(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                F3 (kWh)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="500"
                required
                value={f3}
                onChange={(e) => setF3(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-700">
              Note (opzionale)
            </label>
            <input
              type="text"
              maxLength={240}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Es. Ciclo ACS boost, giornata fredda..."
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 flex items-center justify-between text-xs">
            <span className="text-slate-600">Totale calcolato</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {totalKwh.toFixed(2)} kWh · € {estCost.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? 'Salvataggio...' : 'Salva nel database'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
