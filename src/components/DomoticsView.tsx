import { useState } from 'react';
import { Check, Droplets, Flame, ShieldCheck, Snowflake, Thermometer } from 'lucide-react';
import {
  AristonMode,
  AristonProfile,
  HomeSystemConfig,
  NeaSmartFanSpeed,
} from '../types/home';

interface DomoticsViewProps {
  config: HomeSystemConfig;
  onUpdateConfig: (patch: Partial<HomeSystemConfig>) => Promise<void>;
}

const ARISTON_MODES: { value: AristonMode; label: string }[] = [
  { value: 'riscaldamento', label: 'Riscaldamento' },
  { value: 'raffrescamento', label: 'Raffrescamento' },
  { value: 'acs_solo', label: 'Solo ACS' },
  { value: 'spento', label: 'Spento' },
];

const ARISTON_PROFILES: { value: AristonProfile; label: string }[] = [
  { value: 'eco', label: 'Eco' },
  { value: 'comfort', label: 'Comfort' },
  { value: 'boost', label: 'Boost' },
];

const FAN_SPEEDS: { value: NeaSmartFanSpeed; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'bassa', label: 'Bassa' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
];

export function DomoticsView({ config, onUpdateConfig }: DomoticsViewProps) {
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  async function applyChange(patch: Partial<HomeSystemConfig>) {
    setSaving(true);
    try {
      await onUpdateConfig(patch);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            Controllo Clima & Impianto a Pavimento
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Gestione centralizzata pompa di calore Ariston e deumidificazione NeaSmart sincronizzata su database.
          </p>
        </div>
        {savedNotice && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            <span>Impostazioni salvate</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ariston Heat Pump Panel */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Pompa di Calore Ariston
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Impianto radiante a pavimento e Acqua Calda Sanitaria
              </p>
            </div>
            <div>
              {config.aristonMode === 'raffrescamento' ? (
                <Snowflake className="w-5 h-5 text-sky-400" />
              ) : (
                <Flame className="w-5 h-5 text-amber-400" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Modalità operativa
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              {ARISTON_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const nextFlow =
                      m.value === 'raffrescamento'
                        ? Math.min(config.floorFlowTemp, 19)
                        : m.value === 'riscaldamento'
                          ? Math.max(config.floorFlowTemp, 32)
                          : config.floorFlowTemp;
                    applyChange({ aristonMode: m.value, floorFlowTemp: nextFlow });
                  }}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    config.aristonMode === m.value
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Profilo energetico
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              {ARISTON_PROFILES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={saving}
                  onClick={() => applyChange({ aristonProfile: p.value })}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    config.aristonProfile === p.value
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Temperatura mandata pavimento
              </span>
              <span className="font-mono font-semibold text-slate-100 tabular-nums">
                {config.floorFlowTemp} °C
              </span>
            </div>
            <input
              type="range"
              min={14}
              max={45}
              step={1}
              value={config.floorFlowTemp}
              onChange={(e) =>
                applyChange({ floorFlowTemp: Number(e.target.value) })
              }
              className="w-full accent-sky-400 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>14 °C (Raffrescamento)</span>
              <span>45 °C (Riscaldamento)</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Acqua Calda Sanitaria (ACS)
              </span>
              <span className="font-mono font-semibold text-slate-100 tabular-nums">
                {config.dhwTargetTemp} °C
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={60}
              step={1}
              value={config.dhwTargetTemp}
              onChange={(e) =>
                applyChange({ dhwTargetTemp: Number(e.target.value) })
              }
              className="w-full accent-sky-400 cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-800">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Zona Giorno</span>
                <span className="font-mono font-semibold text-slate-100 tabular-nums">
                  {config.zoneLivingTarget.toFixed(1)} °C
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    applyChange({
                      zoneLivingTarget: Math.max(16, Math.round((config.zoneLivingTarget - 0.5) * 10) / 10),
                    })
                  }
                  className="flex-1 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md"
                >
                  − 0.5°
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyChange({
                      zoneLivingTarget: Math.min(28, Math.round((config.zoneLivingTarget + 0.5) * 10) / 10),
                    })
                  }
                  className="flex-1 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md"
                >
                  + 0.5°
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Zona Notte</span>
                <span className="font-mono font-semibold text-slate-100 tabular-nums">
                  {config.zoneBedroomTarget.toFixed(1)} °C
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    applyChange({
                      zoneBedroomTarget: Math.max(16, Math.round((config.zoneBedroomTarget - 0.5) * 10) / 10),
                    })
                  }
                  className="flex-1 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md"
                >
                  − 0.5°
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyChange({
                      zoneBedroomTarget: Math.min(28, Math.round((config.zoneBedroomTarget + 0.5) * 10) / 10),
                    })
                  }
                  className="flex-1 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md"
                >
                  + 0.5°
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* NeaSmart Dehumidifier Panel */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Deumidificatore NeaSmart
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Controllo igrometrico e sicurezza raffrescamento radiante
              </p>
            </div>
            <Droplets className="w-5 h-5 text-sky-400" />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium text-slate-100">
                Stato unità NeaSmart
              </div>
              <div className="text-xs text-slate-400">
                {config.neasmartPower
                  ? 'Deumidificazione attiva secondo setpoint'
                  : 'Unità spenta / in standby'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.neasmartPower}
              onClick={() => applyChange({ neasmartPower: !config.neasmartPower })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.neasmartPower ? 'bg-sky-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config.neasmartPower ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Umidità relativa target (UR)
              </span>
              <span className="font-mono font-semibold text-slate-100 tabular-nums">
                {config.neasmartTargetHumidity} %
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={65}
              step={1}
              value={config.neasmartTargetHumidity}
              onChange={(e) =>
                applyChange({ neasmartTargetHumidity: Number(e.target.value) })
              }
              className="w-full accent-sky-400 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>40% (Secco)</span>
              <span>50% (Comfort ottimale)</span>
              <span>65%</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Velocità ventilazione
            </label>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              {FAN_SPEEDS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  disabled={saving}
                  onClick={() => applyChange({ neasmartFanSpeed: f.value })}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    config.neasmartFanSpeed === f.value
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-100">
                  Protezione Punto di Rugiada
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Quando Ariston opera in raffrescamento a pavimento, mantiene attiva la deumidificazione NeaSmart per evitare condensa superficiale.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.dewPointProtection}
              onClick={() =>
                applyChange({ dewPointProtection: !config.dewPointProtection })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                config.dewPointProtection ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config.dewPointProtection ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center gap-2 text-xs text-slate-400">
            <Thermometer className="w-4 h-4 text-slate-500 shrink-0" />
            <span>
              Ogni modifica aggiorna in tempo reale il documento Firestore pronto per il bridge locale (Home Assistant / Ariston NET / NeaSmart).
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
