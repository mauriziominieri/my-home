import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  Droplets,
  Info,
  Lock,
  Moon,
  Power,
  ShieldCheck,
  SlidersHorizontal,
  Snowflake,
  Sun,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import aiHandoffContent from '../../AI_HANDOFF.md?raw';
import { triggerBlobDownload } from '../utils/documentVault';

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
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Info Utili — App di Casa
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Guida pratica per usare al meglio Rehau Nea Smart 2.0, Ariston NET ed e-distribuzione insieme a questa dashboard.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="inline-flex flex-wrap gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg self-start shadow-xs dark:shadow-none">
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
                  ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Passaggio di consegne per un'altra AI */}
      <div className="bg-gradient-to-r from-sky-50 via-white to-emerald-50/70 dark:from-sky-950/60 dark:via-slate-900/90 dark:to-emerald-950/40 border border-sky-200 dark:border-sky-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs dark:shadow-none">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-400/30 flex items-center justify-center text-sky-700 dark:text-sky-300 shrink-0 mt-0.5">
            <Bot className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Istruzioni &amp; Passaggio di Consegne per un&apos;altra AI
              </div>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200 border border-sky-200 dark:border-sky-500/30">
                Aggiornate manualmente al 27/11/2026
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
              Se finiscono i crediti o cambi assistente AI, scarica questo file <span className="font-mono text-sky-700 dark:text-sky-300">.md</span> e allegalo nella nuova chat: contiene architettura unificata Firebase, schema Firestore/Rules, sync 24/7 con Google Apps Script, Modalità Test, tracker quota, regole anti-spreco crediti e mappa completa dei file (viene aggiornato manualmente alle modifiche principali).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([aiHandoffContent], {
              type: 'text/markdown;charset=utf-8',
            });
            triggerBlobDownload(blob, 'my-home-ai-handoff.md');
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-sky-600 hover:bg-sky-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Scarica Istruzioni AI (.md)</span>
        </button>
      </div>

      {/* Come lavorano insieme le 3 app */}
      <div className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 shadow-xs dark:shadow-none">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
          <span>Come lavorano insieme le 3 app</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <Thermometer className="w-3.5 h-3.5 shrink-0" />
              1. Rehau Nea Smart 2.0
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Gestisce <strong className="text-slate-800 dark:text-slate-200">le singole stanze</strong>: temperature target, fasce orarie giornaliere, modalità Comfort/Eco e apertura delle valvole di zona.
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
              <Power className="w-3.5 h-3.5 shrink-0" />
              2. Ariston NET
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Gestisce <strong className="text-slate-800 dark:text-slate-200">la macchina centrale</strong> (pompa di calore / caldaia): accensione/spegnimento generale dell&apos;impianto, acqua calda sanitaria (ACS) e cambio stagione.
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              3. e-distribuzione
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Legge il <strong className="text-slate-800 dark:text-slate-200">contatore da 6 kW</strong>: consumi giornalieri F1/F2/F3, picchi di potenza e invio dei CSV che alimentano in automatico questa dashboard.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400">
          <AlertCircle className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-800 dark:text-slate-200">Nota sull&apos;integrazione diretta:</strong> Nea Smart 2.0 e Ariston NET usano API cloud private che non sono accessibili direttamente da un sito web statico senza un server domestico dedicato (es. Home Assistant). Per questo le accensioni si registrano manualmente nella sezione <strong className="text-slate-800 dark:text-slate-200">Consumi Annuali</strong>, mentre i consumi e-distribuzione e le bollette si sincronizzano in automatico.
          </span>
        </div>
      </div>

      {/* Cos'è la VMC (Ventilazione Meccanica Controllata) */}
      <div className="bg-white dark:bg-slate-900/70 border border-fuchsia-200 dark:border-fuchsia-500/25 rounded-xl p-4 space-y-3 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Wind className="w-4 h-4 text-fuchsia-600 dark:text-fuchsia-400 shrink-0" />
            <span>Cos&apos;è la VMC (Ventilazione Meccanica Controllata)</span>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-500/30 rounded-md">
            Ricambio d&apos;aria casa
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-slate-900 dark:text-slate-100">A cosa serve</div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              È il sistema di <strong className="text-slate-800 dark:text-slate-200">ricambio d&apos;aria continuo 24 ore su 24</strong>: aspira aria umida e viziata (soprattutto da bagni e cucina) ed immette aria nuova filtrata dall&apos;esterno senza aprire le finestre, riducendo umidità, odori, CO₂ e rischio muffe.
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-slate-900 dark:text-slate-100">Recupero di calore</div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Prima di espellere l&apos;aria interna, uno scambiatore trasferisce gran parte della sua temperatura all&apos;aria nuova in ingresso: in inverno non entra aria gelida e in estate non entra aria bollente, proteggendo il lavoro del radiante.
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-fuchsia-700 dark:text-fuchsia-300">Perché incide sui kWh</div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              A velocità normale consuma pochissimo (<span className="font-mono text-slate-800 dark:text-slate-200">~20–40 W</span>, meno di 1 kWh al giorno). Se però resta impostata alla <strong className="text-slate-800 dark:text-slate-200">velocità massima</strong> h24 (come dal 20 al 30 agosto), le ventole assorbono molta più corrente alzando i consumi anche a clima spento.
            </p>
          </div>
        </div>
      </div>

      {/* SEZIONE 1: REHAU NEA SMART 2.0 */}
      {showNea && (
        <section className="bg-white dark:bg-slate-900/70 border border-amber-200 dark:border-amber-500/25 rounded-xl p-5 space-y-4 shadow-xs dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-700 dark:text-amber-300">
                <Thermometer className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Rehau Nea Smart 2.0 — Controllo Stanze
                </h2>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Zone di casa: Salone · Roberta · Matrimoniale · Maurizio · Bagno 1 · Bagno 2
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 rounded-md">
              Termostati di zona
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                Schermata Principale — Zone e simboli visibili
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">In alto a sinistra (Temperatura + simbolo stagione/meteo):</strong> mostra la <strong className="text-slate-800 dark:text-slate-200">temperatura esterna</strong> rilevata dalla sonda/meteo locale e l&apos;icona della modalità stagionale attiva (sole/fiamma = riscaldamento inverno; fiocco di neve = raffrescamento estate; goccia se deumidifica attiva).
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">In alto a destra (Icona casa / omino / stato globale):</strong> stato globale dell&apos;abitazione (<strong className="text-slate-800 dark:text-slate-200">Presente, Assenza/Vacanza, Party, Standby</strong>). Cambiandola qui applichi l&apos;attenuazione o lo spegnimento a tutta la casa contemporaneamente.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Al centro (Righe delle stanze):</strong> sulla sinistra leggi il nome della stanza e la <strong className="text-slate-800 dark:text-slate-200">temperatura reale attuale</strong> misurata dal termostato a muro (con icona fiamma/fiocco o onde attive quando la valvola sta effettivamente aprendo il circuito).
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">A destra delle stanze (&minus; · Temperatura · +):</strong> è il <strong className="text-slate-800 dark:text-slate-200">setpoint target desiderato</strong>. Toccando <span className="font-mono text-slate-800 dark:text-slate-200">-</span> o <span className="font-mono text-slate-800 dark:text-slate-200">+</span> imponi subito un cambio manuale della temperatura desiderata (override fino al cambio fascia successivo o fisso, in base al profilo della stanza).
                </li>
              </ul>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                Pagina della singola stanza — Cosa trovi cliccandoci sopra
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li className="flex items-start gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-800 dark:text-slate-200">Sole (Normale / Comfort):</strong> temperatura piena quando la stanza è vissuta (es. 20,5–21 °C inverno / 25–26 °C estate).
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Moon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-800 dark:text-slate-200">Luna (Ridotto / Eco):</strong> temperatura attenuata notturna o quando sei fuori casa (su pavimento radiante meglio restare entro 1,5–2 °C dal Sole).
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-800 dark:text-slate-200">Orologio (Auto / Programma orario):</strong> segue le fasce orarie settimanali della stanza alternando in automatico Sole e Luna.
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Power className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-800 dark:text-slate-200">Standby / Antigelo (Off):</strong> chiude la valvola di quella stanza mantenendo solo la soglia di sicurezza antigelo (~6–8 °C).
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Droplets className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-800 dark:text-slate-200">Goccia / Umidità (%):</strong> umidità relativa della stanza; se in raffrescamento supera la soglia di sicurezza condensa, attiva la deumidificazione o ferma l&apos;acqua fredda a pavimento.
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-300 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-800 dark:text-slate-200">Lucchetto / Mano (Blocco o Manuale):</strong> blocco tasti sul termostato fisico oppure variazione manuale attiva fuori programma orario.
                  </span>
                </li>
              </ul>
            </div>

            {/* Bottom bar -> Impostazioni -> Riscaldamento/Raffrescamento */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Bottom bar → Impostazioni → Riscaldamento / Raffrescamento
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">
                    &quot;Offset in K limite riscaldamento in modo normale&quot; (impostato a{' '}
                    <span className="font-mono text-amber-700 dark:text-amber-300">-2</span>):
                  </strong>{' '}
                  <strong className="text-slate-800 dark:text-slate-200">K</strong> sta per Kelvin (= °C di scostamento rispetto alla soglia base). Impostato a <span className="font-mono text-slate-800 dark:text-slate-200">-2 K</span> anticipa di <strong className="text-slate-800 dark:text-slate-200">2 °C</strong> il blocco/spegnimento del riscaldamento quando ci si avvicina alla temperatura limite esterna/stagionale (es. se il limite base è 18 °C esterni, con -2 K smette già a 16 °C). È una regolazione da <strong className="text-slate-800 dark:text-slate-200">risparmio energetico</strong> per evitare che la pompa di calore continui a spingere nelle giornate miti di mezza stagione. Se in primavera/autunno senti la casa tiepida troppo presto, puoi portarlo verso <span className="font-mono text-slate-800 dark:text-slate-200">0</span>; così com&apos;è a <span className="font-mono text-slate-800 dark:text-slate-200">-2</span> evita sprechi.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Compensazione estiva:</strong> durante il raffrescamento alza leggermente in automatico il setpoint interno quando fuori fa molto caldo (es. oltre 30–32 °C), riducendo lo sbalzo termico entrando in casa, limitando l&apos;umidità relativa e diminuendo i picchi di consumo della pompa di calore.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Curva climatica / Mandata / Limite rugiada:</strong> regolano la temperatura dell&apos;acqua inviata al pavimento in base al clima esterno e impediscono di scendere sotto il punto di rugiada in estate (protezione pavimento da condensa).
                </li>
              </ul>
            </div>

            {/* Bottom bar -> Diagnosi -> Elenco stanze -> Stanza */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2.5">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                Bottom bar → Diagnosi → Elenco stanze → Stanza (Grafico)
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Asse Y (verticale — Temperatura °C):</strong> mostra la curva della temperatura reale registrata in stanza nell&apos;arco della giornata a confronto con il target impostato.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Asse X (orizzontale — Orario 00–24 + fascia colorata):</strong> oltre all&apos;ora, la barra colorata sotto l&apos;asse X indica la <strong className="text-slate-800 dark:text-slate-200">modalità / stato in cui si trovava la stanza</strong> in ogni intervallo orario:
                </li>
              </ul>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900/90 border border-sky-200 dark:border-sky-500/30 rounded-md px-2.5 py-1.5">
                  <span className="w-3 h-3 rounded-xs bg-sky-500 dark:bg-sky-400 shrink-0" />
                  <span className="text-slate-700 dark:text-slate-300">
                    <strong className="text-sky-700 dark:text-sky-300">Azzurro:</strong> modalità <strong>Ridotta / Eco</strong> (o stato di raffrescamento / attesa attenuata)
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900/90 border border-amber-200 dark:border-amber-400/30 rounded-md px-2.5 py-1.5">
                  <span className="w-3 h-3 rounded-xs bg-amber-400 dark:bg-amber-300 shrink-0" />
                  <span className="text-slate-700 dark:text-slate-300">
                    <strong className="text-amber-700 dark:text-amber-200">Giallo:</strong> modalità <strong>Normale / Comfort</strong> (fascia attiva piena)
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900/90 border border-purple-200 dark:border-purple-400/30 rounded-md px-2.5 py-1.5">
                  <span className="w-3 h-3 rounded-xs bg-purple-500 dark:bg-purple-400 shrink-0" />
                  <span className="text-slate-700 dark:text-slate-300">
                    <strong className="text-purple-700 dark:text-purple-300">Viola:</strong> <strong>Override manuale</strong> (modifica da +/- o app) o stato speciale / protezione
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5">
                  <span className="w-3 h-3 rounded-xs bg-slate-500 shrink-0" />
                  <span className="text-slate-700 dark:text-slate-300">
                    <strong className="text-slate-900 dark:text-slate-200">Grigio / Scuro:</strong> Standby / Antigelo / Circuito chiuso
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 pt-1">
                Vuoi verificare al 100% ogni iconcina e colore preciso del tuo modello di centralina? Invia 2–3 screenshot della tua app Nea Smart (schermata iniziale, Impostazioni Riscaldamento/Raffrescamento e Grafico Diagnosi) e li mappo uno per uno.
              </p>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2 text-xs">
            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Consigli pratici per consumare meno con Nea Smart 2.0
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-600 dark:text-slate-400 leading-relaxed">
              <ul className="space-y-1.5">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Evita accendi-spegni continui:</strong> il 1° giorno di accensione e il 2° di assestamento consumano molto di più; a regime il consumo giornaliero scende drasticamente (come vedi nella Mappa Annuale).
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Sincronia con Ariston:</strong> se Ariston è spento, aprire le stanze su Nea Smart non scalda/raffresca. In cambio stagione imposta <strong className="text-slate-800 dark:text-slate-200">Inverno/Estate su entrambe le app</strong>.
                </li>
              </ul>
              <ul className="space-y-1.5">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Estate &amp; Umidità:</strong> in raffrescamento controlla che l&apos;umidità non salga troppo (oltre 60–65% il sistema limita o blocca per evitare condensa a pavimento).
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Se una stanza non risponde:</strong> verifica nella pagina della stanza che non sia in <em>Override manuale</em> o <em>Blocco bambini</em> (icona lucchetto) e controlla la connessione della base Nea Smart.
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* SEZIONE 2: ARISTON NET */}
      {showAriston && (
        <section className="bg-white dark:bg-slate-900/70 border border-rose-200 dark:border-rose-500/25 rounded-xl p-5 space-y-4 shadow-xs dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center text-rose-700 dark:text-rose-300">
                <Power className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Ariston NET — Macchina &amp; Spegnimento Impianto
                </h2>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Generatore centrale · Riscaldamento / Raffrescamento / Acqua Calda Sanitaria (ACS)
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 rounded-md">
              Impianto centrale
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Power className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                Come spegnere l&apos;impianto senza restare senza acqua calda
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Solo Acqua Calda (Estate / ACS):</strong> è la modalità corretta quando vuoi <strong className="text-slate-800 dark:text-slate-200">spegnere riscaldamento o raffrescamento</strong> ma continuare ad avere acqua calda nei rubinetti e doccia.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">OFF totale (Standby):</strong> spegne tutto, inclusa l&apos;acqua calda sanitaria (lascia attiva solo la funzione antigelo). Usala solo se parti per molti giorni.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Inverno / Raffrescamento:</strong> abilita la climatizzazione verso le zone gestite da Nea Smart 2.0.
                </li>
              </ul>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Snowflake className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                Altre funzioni utili su Ariston NET
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Temperatura di mandata:</strong> più è bassa in inverno (es. 32–38 °C su radiante), più alta è l&apos;efficienza (COP) e meno kWh consuma la macchina.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Notifiche e codici errore:</strong> l&apos;app ti avvisa subito se c&apos;è un blocco, un calo di pressione o una anomalia, permettendoti in alcuni casi il reset da remoto.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Profilo Eco vs Comfort (ACS):</strong> in <em>Eco</em> scalda l&apos;acqua solo quando serve o in fasce programmate; in <em>Comfort</em> la mantiene sempre pronta.
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* SEZIONE 3: E-DISTRIBUZIONE */}
      {showEdist && (
        <section className="bg-white dark:bg-slate-900/70 border border-sky-200 dark:border-sky-500/25 rounded-xl p-5 space-y-4 shadow-xs dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-500/30 flex items-center justify-center text-sky-700 dark:text-sky-300">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  e-distribuzione — Contatore 6 kW &amp; Consumi Reali
                </h2>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  POD <span className="font-mono text-sky-700 dark:text-sky-300">IT001E11251419</span> · Potenza impegnata 6,0 kW · Open Meter 2G
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/30 rounded-md">
              Sync automatico
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                Fasce orarie F1 / F2 / F3 e Potenza 6 kW
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">F1 (punta):</strong> Lun–Ven 08:00–19:00.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">F2 (intermedia):</strong> Lun–Ven 07:00–08:00 e 19:00–23:00; Sabato 07:00–23:00.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">F3 (fuori punta):</strong> Lun–Sab 23:00–07:00; Domenica e festivi tutto il giorno.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Nota tariffa monoraria:</strong> con Octopus Fissa 24M paghi <span className="font-mono text-emerald-700 dark:text-emerald-300">0,1595 €/kWh</span> in tutte le fasce, quindi l&apos;orario non cambia il prezzo al kWh.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Soglia contatore 6 kW:</strong> puoi assorbire fino a <strong className="text-slate-800 dark:text-slate-200">6,6 kW</strong> senza limiti di tempo e fino a circa <strong className="text-slate-800 dark:text-slate-200">8,0 kW</strong> per massimo 3 ore prima dello scatto.
                </li>
              </ul>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Come si sincronizza con questa dashboard
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Richiesta curve di carico:</strong> dall&apos;app o dal portale e-distribuzione puoi richiedere il report CSV dei consumi quartorari/giornalieri via email.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Verifica picchi e guasti:</strong> nell&apos;app e-distribuzione puoi anche controllare in tempo reale eventuali interruzioni di corrente programmate o guasti nella tua zona.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">Database Unico su Firebase Firestore:</strong> tutti i consumi, le bollette (Luce, Acqua, TARI), i PDF originali nel Vault, i documenti, le tariffe e i prodotti vivono direttamente sul tuo progetto Firebase (<span className="font-mono text-sky-700 dark:text-sky-300">gen-lang-client-0721850501</span>), senza file JSON intermedi né branch secondari su GitHub.
                </li>
              </ul>
            </div>
          </div>

          {/* Flusso Automatico Email -> Firestore + Mappa Script Chi Fa Cosa */}
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-sky-200 dark:border-sky-500/25 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                Automazioni 24/7 (ogni 10 minuti): Chi fa cosa &amp; File di riferimento
              </div>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/30 rounded">
                Apps Script + GitHub Actions · Solo INBOX · 0 crediti AI
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
              <div className="bg-white dark:bg-slate-900/80 border border-emerald-200 dark:border-emerald-500/30 rounded-lg p-3 space-y-1.5">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                  1. Bollette Luce, Acqua &amp; TARI (ogni 10 min · Restano in INBOX)
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Scansiona la INBOX per nuove bollette in <strong className="text-slate-800 dark:text-slate-200">qualsiasi formato</strong> (PDF, ZIP, CSV, XML FatturaPA, TXT, JSON, HTML o testo email), archivia il PDF su Firestore Vault e ti avvisa subito via <strong className="text-slate-800 dark:text-slate-200">Email + WhatsApp</strong>. <strong className="text-emerald-700 dark:text-emerald-300">Le email delle bollette NON vengono mai spostate nel Cestino.</strong>
                </p>
                <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 break-all">
                  scripts/sync_gmail_consumi_e_bollette.py · src/utils/gmailSync.ts (manuale browser)
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900/80 border border-sky-200 dark:border-sky-500/30 rounded-lg p-3 space-y-1.5">
                <div className="font-semibold text-sky-700 dark:text-sky-300">
                  2. Consumi Giornalieri kWh (ogni 10 min · Spostati nel Cestino)
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Legge le email <strong className="text-slate-800 dark:text-slate-200">&quot;Dettaglio curve di carico&quot;</strong> da <span className="font-mono">notifichemailped@enel.com</span> (CSV/ZIP F1/F2/F3), salva i giorni mancanti su Firestore e <strong className="text-rose-700 dark:text-rose-300">sposta nel Cestino</strong> solo queste email dopo il salvataggio.
                </p>
                <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 break-all">
                  apps-script/sync_consumi_edistribuzione.js + scripts/sync_gmail_consumi_e_bollette.py
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900/80 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3 space-y-1.5">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  3. Confronto Fornitori Esterni vs Octopus 2027 (Email + WhatsApp)
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Controlla automaticamente i principali fornitori luce rispetto alla tua <strong className="text-slate-800 dark:text-slate-200">Octopus Fissa 24M 2027</strong> (0,1595 €/kWh + 6 €/mese). Se trova un risparmio &ge; 5 €/anno invia avviso <strong className="text-slate-800 dark:text-slate-200">Email + WhatsApp</strong>.
                </p>
                <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 break-all">
                  scripts/check_octopus_tariff.py (.github/workflows/sync-gmail-consumi-bollette-tariffe.yml)
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900/80 border border-indigo-200 dark:border-indigo-500/30 rounded-lg p-3 space-y-1.5">
                <div className="font-semibold text-indigo-700 dark:text-indigo-300">
                  4. Promemoria Casa &amp; Manutenzione Auto (1 volta al giorno)
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Legge live da Firestore scadenze casa e km/batteria Panda EA218ES inviando gli avvisi giornalieri via <strong className="text-slate-800 dark:text-slate-200">Email + WhatsApp</strong>.
                </p>
                <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 break-all">
                  apps-script/notifiche_promemoria_giornaliere.js
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2 text-[11px]">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Caselle e oggetti monitorati ogni 10 minuti (solo INBOX):
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-slate-700 dark:text-slate-300">
                <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-2">
                  <div className="font-semibold text-sky-700 dark:text-sky-300">e-distribuzione / Enel</div>
                  <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">notifichemailped@enel.com</div>
                  <div className="text-slate-600 dark:text-slate-400">Oggetto &quot;Dettaglio curve di carico&quot; · CSV/ZIP · Spostata nel Cestino dopo import</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-2">
                  <div className="font-semibold text-sky-700 dark:text-sky-300">Edison Energia (Luce)</div>
                  <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">fatturazione@edisonenergia.it</div>
                  <div className="text-slate-600 dark:text-slate-400">PDF/CSV/XML/Email · Avviso Email+WA · Resta in INBOX</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-2">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-300">Octopus Energy (Luce)</div>
                  <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">octopusenergy.it</div>
                  <div className="text-slate-600 dark:text-slate-400">PDF/CSV/XML/Email · Avviso Email+WA · Resta in INBOX</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-2">
                  <div className="font-semibold text-cyan-700 dark:text-cyan-300">AcegasApsAmga (Acqua)</div>
                  <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">acegasapsamga.it</div>
                  <div className="text-slate-600 dark:text-slate-400">&quot;servizio idrico / acquedotto&quot; (qualsiasi formato) · Avviso Email+WA · Resta in INBOX</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-2">
                  <div className="font-semibold text-amber-700 dark:text-amber-300">AcegasApsAmga (TARI)</div>
                  <div className="font-mono text-[10px] text-slate-800 dark:text-slate-200 break-all">tassa_rifiuti@acegasapsamga.it</div>
                  <div className="text-slate-600 dark:text-slate-400">&quot;Avviso di pagamento TARI&quot; / &quot;tassa rifiuti&quot; (qualsiasi formato) · Avviso Email+WA · Resta in INBOX</div>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
              <div className="bg-white dark:bg-slate-900/60 border border-emerald-200 dark:border-emerald-500/25 rounded-lg p-3 space-y-1">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Link diretti Apps Script + GitHub Actions
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Puoi aprire il{' '}
                  <a
                    href="https://script.google.com/u/1/home/projects/1Xv8LKzCxqu2n05njAGj9iMZLEETUD-uyUkaSkzThum6FmOStyTFiq5kh/edit"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-emerald-700 dark:text-emerald-300 underline hover:opacity-80"
                  >
                    progetto Google Apps Script
                  </a>{' '}
                  oppure usare in qualsiasi momento il tasto <strong className="text-slate-800 dark:text-slate-200">&quot;Sincronizza Gmail&quot;</strong> nell&apos;app.
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900/60 border border-sky-200 dark:border-sky-500/25 rounded-lg p-3 space-y-1">
                <div className="font-semibold text-sky-700 dark:text-sky-300">
                  Migrazione 1-click dal vecchio DB
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Accedendo con Google su questo progetto unificato, l&apos;eventuale banner iniziale in alto permette di copiare in un colpo solo tutto lo storico (consumi, bollette, PDF, spesa, auto e log clima) dal vecchio database al nuovo.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
