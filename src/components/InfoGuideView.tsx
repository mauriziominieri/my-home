import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Flame,
  Info,
  Power,
  ShieldCheck,
  Snowflake,
  Thermometer,
  Zap,
} from 'lucide-react';

type GuideTab = 'all' | 'neasmart' | 'ariston' | 'edistribuzione';

export function InfoGuideView() {
  const [activeTab, setActiveTab] = useState<GuideTab>('all');

  const showNea = activeTab === 'all' || activeTab === 'neasmart';
  const showAriston = activeTab === 'all' || activeTab === 'ariston';
  const showEdist = activeTab === 'all' || activeTab === 'edistribuzione';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            Info Utili — App di Casa
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Guida pratica per usare al meglio Rehau Nea Smart 2.0, Ariston NET ed e-distribuzione insieme a questa dashboard.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="inline-flex flex-wrap gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg self-start">
          {(
            [
              { id: 'all', label: 'Tutte (3)' },
              { id: 'neasmart', label: 'Nea Smart 2.0' },
              { id: 'ariston', label: 'Ariston NET' },
              { id: 'edistribuzione', label: 'e-distribuzione' },
            ] as { id: GuideTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === tab.id
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Come lavorano insieme le 3 app */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Info className="w-4 h-4 text-sky-400 shrink-0" />
          <span>Come lavorano insieme le 3 app</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-amber-300 flex items-center gap-1.5">
              <Thermometer className="w-3.5 h-3.5 shrink-0" />
              1. Rehau Nea Smart 2.0
            </div>
            <p className="text-slate-400 leading-relaxed">
              Gestisce <strong className="text-slate-200">le singole stanze</strong>: temperature target, fasce orarie giornaliere, modalità Comfort/Eco e apertura delle valvole di zona.
            </p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-rose-300 flex items-center gap-1.5">
              <Power className="w-3.5 h-3.5 shrink-0" />
              2. Ariston NET
            </div>
            <p className="text-slate-400 leading-relaxed">
              Gestisce <strong className="text-slate-200">la macchina centrale</strong> (pompa di calore / caldaia): accensione/spegnimento generale dell&apos;impianto, acqua calda sanitaria (ACS) e cambio stagione.
            </p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-sky-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              3. e-distribuzione
            </div>
            <p className="text-slate-400 leading-relaxed">
              Legge il <strong className="text-slate-200">contatore da 6 kW</strong>: consumi giornalieri F1/F2/F3, picchi di potenza e invio dei CSV che alimentano in automatico questa dashboard.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
          <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-200">Nota sull&apos;integrazione diretta:</strong> Nea Smart 2.0 e Ariston NET usano API cloud private che non sono accessibili direttamente da un sito web statico senza un server domestico dedicato (es. Home Assistant). Per questo le accensioni si registrano manualmente nella sezione <strong className="text-slate-200">Consumi Annuali</strong>, mentre i consumi e-distribuzione e le bollette si sincronizzano in automatico.
          </span>
        </div>
      </div>

      {/* SEZIONE 1: REHAU NEA SMART 2.0 */}
      {showNea && (
        <section className="bg-slate-900/70 border border-amber-500/25 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
                <Thermometer className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  Rehau Nea Smart 2.0 — Controllo Stanze
                </h2>
                <p className="text-[11px] text-slate-400">
                  Zone di casa: Salone · Roberta · Matrimoniale · Maurizio · Bagno 1 · Bagno 2
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-md">
              Termostati di zona
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                Modalità principali nell&apos;app
              </div>
              <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-200">Normale (Sole / Comfort):</strong> temperatura piena desiderata quando sei in casa (es. 20,5–21 °C in inverno, 25–26 °C in estate).
                </li>
                <li>
                  <strong className="text-slate-200">Ridotto (Luna / Eco):</strong> temperatura attenuata per la notte o quando sei fuori casa. Su impianto radiante tieni uno scarto massimo di <strong className="text-slate-200">1,5–2 °C</strong>, altrimenti consumi di più per riportare in temperatura.
                </li>
                <li>
                  <strong className="text-slate-200">Auto (Orologio):</strong> segue il programma orario settimanale impostato stanza per stanza.
                </li>
                <li>
                  <strong className="text-slate-200">Standby / Assenza:</strong> chiude le valvole mantenendo solo la protezione antigelo.
                </li>
              </ul>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Consigli pratici per consumare meno
              </div>
              <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-200">Evita accendi-spegni continui:</strong> il 1° giorno di accensione e il 2° di assestamento consumano molto di più; a regime il consumo giornaliero scende drasticamente (come vedi nella Mappa Annuale).
                </li>
                <li>
                  <strong className="text-slate-200">Sincronia con Ariston:</strong> se Ariston è spento, aprire le stanze su Nea Smart non scalda/raffresca. In cambio stagione imposta <strong className="text-slate-200">Inverno/Estate su entrambe le app</strong>.
                </li>
                <li>
                  <strong className="text-slate-200">Estate &amp; Umidità:</strong> in raffrescamento controlla che l&apos;umidità non salga troppo (oltre 60–65% il sistema limita o blocca per evitare condensa a pavimento).
                </li>
                <li>
                  <strong className="text-slate-200">Se una stanza non risponde:</strong> verifica sull&apos;app che la zona non sia in <em>Override manuale</em> o <em>Blocco bambini</em> e controlla l&apos;icona di connessione della base Nea Smart.
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* SEZIONE 2: ARISTON NET */}
      {showAriston && (
        <section className="bg-slate-900/70 border border-rose-500/25 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-300">
                <Power className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  Ariston NET — Macchina &amp; Spegnimento Impianto
                </h2>
                <p className="text-[11px] text-slate-400">
                  Generatore centrale · Riscaldamento / Raffrescamento / Acqua Calda Sanitaria (ACS)
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-rose-500/15 text-rose-300 border border-rose-500/30 rounded-md">
              Impianto centrale
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Power className="w-3.5 h-3.5 text-rose-400" />
                Come spegnere l&apos;impianto senza restare senza acqua calda
              </div>
              <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-200">Solo Acqua Calda (Estate / ACS):</strong> è la modalità corretta quando vuoi <strong className="text-slate-200">spegnere riscaldamento o raffrescamento</strong> ma continuare ad avere acqua calda nei rubinetti e doccia.
                </li>
                <li>
                  <strong className="text-slate-200">OFF totale (Standby):</strong> spegne tutto, inclusa l&apos;acqua calda sanitaria (lascia attiva solo la funzione antigelo). Usala solo se parti per molti giorni.
                </li>
                <li>
                  <strong className="text-slate-200">Inverno / Raffrescamento:</strong> abilita la climatizzazione verso le zone gestite da Nea Smart 2.0.
                </li>
              </ul>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Snowflake className="w-3.5 h-3.5 text-sky-400" />
                Altre funzioni utili su Ariston NET
              </div>
              <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-200">Temperatura di mandata:</strong> più è bassa in inverno (es. 32–38 °C su radiante), più alta è l&apos;efficienza (COP) e meno kWh consuma la macchina.
                </li>
                <li>
                  <strong className="text-slate-200">Notifiche e codici errore:</strong> l&apos;app ti avvisa subito se c&apos;è un blocco, un calo di pressione o una anomalia, permettendoti in alcuni casi il reset da remoto.
                </li>
                <li>
                  <strong className="text-slate-200">Profilo Eco vs Comfort (ACS):</strong> in <em>Eco</em> scalda l&apos;acqua solo quando serve o in fasce programmate; in <em>Comfort</em> la mantiene sempre pronta.
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* SEZIONE 3: E-DISTRIBUZIONE */}
      {showEdist && (
        <section className="bg-slate-900/70 border border-sky-500/25 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-300">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  e-distribuzione — Contatore 6 kW &amp; Consumi Reali
                </h2>
                <p className="text-[11px] text-slate-400">
                  POD <span className="font-mono text-sky-300">IT001E11251419</span> · Potenza impegnata 6,0 kW · Open Meter 2G
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded-md">
              Sync automatico
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                Fasce orarie F1 / F2 / F3 e Potenza 6 kW
              </div>
              <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-200">F1 (punta):</strong> Lun–Ven 08:00–19:00.
                </li>
                <li>
                  <strong className="text-slate-200">F2 (intermedia):</strong> Lun–Ven 07:00–08:00 e 19:00–23:00; Sabato 07:00–23:00.
                </li>
                <li>
                  <strong className="text-slate-200">F3 (fuori punta):</strong> Lun–Sab 23:00–07:00; Domenica e festivi tutto il giorno.
                </li>
                <li>
                  <strong className="text-slate-200">Nota tariffa monoraria:</strong> con Octopus Fissa 24M paghi <span className="font-mono text-emerald-300">0,1595 €/kWh</span> in tutte le fasce, quindi l&apos;orario non cambia il prezzo al kWh.
                </li>
                <li>
                  <strong className="text-slate-200">Soglia contatore 6 kW:</strong> puoi assorbire fino a <strong className="text-slate-200">6,6 kW</strong> senza limiti di tempo e fino a circa <strong className="text-slate-200">8,0 kW</strong> per massimo 3 ore prima dello scatto.
                </li>
              </ul>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Come si sincronizza con questa dashboard
              </div>
              <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-200">Richiesta curve di carico:</strong> dall&apos;app o dal portale e-distribuzione puoi richiedere il report CSV dei consumi quartorari/giornalieri via email.
                </li>
                <li>
                  <strong className="text-slate-200">Importazione automatica:</strong> ogni 30 minuti lo script GitHub Actions controlla la tua Gmail, legge i CSV di e-distribuzione (anche se spostati nel cestino) e aggiorna automaticamente la pagina <strong className="text-slate-200">Consumi Annuali</strong>.
                </li>
                <li>
                  <strong className="text-slate-200">Verifica picchi e guasti:</strong> nell&apos;app e-distribuzione puoi anche controllare in tempo reale eventuali interruzioni di corrente programmate o guasti nella tua zona.
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
