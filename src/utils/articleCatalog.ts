import { HomeArticleCategory, HomeArticleRecord } from '../types/home';

export const ARTICLE_ROOM_PRESETS: string[] = [
  'Cucina',
  'Salone',
  'Stanza Maurizio',
  'Stanza Roberta',
  'Matrimoniale',
  'Bagno 1',
  'Bagno 2',
  'Locale Tecnico / Esterno',
  'Casa / Ingresso',
];

export interface ArticleManualGuide {
  manualUrl: string;
  supportSearchUrl: string;
  summary: string;
  keySpecs: string[];
  quickUsage: string[];
  maintenance: string[];
  safetyAndEnergy: string[];
  sourceUrls?: { title: string; url: string }[];
  sourceType: 'curated' | 'online' | 'generated';
}

export interface OnlineArticleSearchResult {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: HomeArticleCategory;
  suggestedRoom: string;
  specs: string;
  manualUrl: string;
  manualSummary: string;
  sourceUrls: { title: string; url: string }[];
  providerLabel: string;
}

const MANUAL_MARKER_RE = /\s*\[Manuale:\s*(https?:\/\/[^\s\]]+)\]\s*/i;
const CUSTOM_GUIDES_STORAGE_KEY = 'myhome_article_manuals_v1';

export function unpackArticleNotes(rawNotes?: string): {
  userNotes: string;
  manualUrl: string;
} {
  if (!rawNotes) return { userNotes: '', manualUrl: '' };
  const match = rawNotes.match(MANUAL_MARKER_RE);
  if (!match) return { userNotes: rawNotes.trim(), manualUrl: '' };
  const manualUrl = match[1].trim();
  const userNotes = rawNotes.replace(MANUAL_MARKER_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  return { userNotes, manualUrl };
}

/**
 * Packs user notes + optional manualUrl inside the 240-char Firestore `notes` field
 * so writes always comply with Firestore security rules.
 */
export function packArticleNotes(userNotes: string, manualUrl?: string): string | undefined {
  const cleanNotes = userNotes.replace(MANUAL_MARKER_RE, ' ').trim();
  const cleanUrl = (manualUrl || '').trim();
  if (!cleanUrl && !cleanNotes) return undefined;
  if (!cleanUrl) return cleanNotes.slice(0, 240);

  const marker = `[Manuale: ${cleanUrl}]`;
  if (marker.length >= 240) {
    return cleanNotes ? cleanNotes.slice(0, 240) : undefined;
  }
  if (!cleanNotes) return marker;
  const maxNotesLen = 240 - marker.length - 1;
  if (maxNotesLen <= 8) return marker;
  return `${cleanNotes.slice(0, maxNotesLen)} ${marker}`;
}

export function buildManufacturerManualSearchUrl(brand: string, model: string): string {
  const b = brand.trim().toLowerCase();
  const q = encodeURIComponent(`${brand} ${model} manuale pdf italiano`.trim());
  if (b.includes('electrolux')) {
    return `https://www.electrolux.it/support/user-manuals/?q=${encodeURIComponent(model)}`;
  }
  if (b.includes('tcl')) {
    return `https://www.tcl.com/it/it/support`;
  }
  if (b.includes('huawei')) {
    return `https://support.huawei.com/enterprise/en/fusionsolar/sun2000l-pid-22352354`;
  }
  if (b.includes('samsung')) {
    return `https://www.samsung.com/it/support/search/?keyword=${encodeURIComponent(model)}`;
  }
  if (b.includes('bosch')) {
    return `https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni`;
  }
  if (b.includes('lg')) {
    return `https://www.lg.com/it/supporto/manuali/`;
  }
  if (b.includes('ariston')) {
    return `https://www.ariston.com/it-it/assistenza/`;
  }
  if (b.includes('rehau')) {
    return `https://www.rehau.com/it-it/downloads`;
  }
  if (b.includes('avs')) {
    return `https://www.avselectronics.it/`;
  }
  return `https://www.google.com/search?q=${q}`;
}

interface CuratedDeviceTemplate {
  match: (key: string) => boolean;
  guide: Omit<ArticleManualGuide, 'supportSearchUrl' | 'sourceType'>;
  catalogCandidate?: Omit<OnlineArticleSearchResult, 'id' | 'providerLabel'>;
}

const CURATED_DEVICES: CuratedDeviceTemplate[] = [
  {
    match: (k) => k.includes('tcl') && k.includes('75q7c'),
    guide: {
      manualUrl: 'https://www.tcl.com/it/it/tvs/75q7c',
      summary:
        'Smart TV 75" QD-Mini LED 4K UHD con Google TV, HDMI 2.1 (eARC / VRR 144Hz), Audio Onkyo Dolby Atmos e gestione risparmio energetico.',
      keySpecs: [
        'Diagonale: 75 pollici · QD-Mini LED 4K (3840x2160)',
        'Sistema operativo: Google TV con Chromecast e Google Assistant',
        'Audio: Sistema Onkyo 2.1 integrato · Dolby Atmos & DTS Virtual:X',
        'Ingressi: HDMI 2.1 (eARC su HDMI 4), Wi-Fi Dual Band, Bluetooth, LAN',
      ],
      quickUsage: [
        'Accedi alle impostazioni Immagine -> Modalità "Film" o "Calibrata" per colori fedeli senza sovrasaturazione.',
        'Per collegare soundbar usa la porta HDMI eARC abilitando CEC nelle impostazioni Ingressi.',
        'Premi a lungo il tasto Home o usa il microfono sul telecomando per comandi vocali rapidi.',
      ],
      maintenance: [
        'Pulisci lo schermo SOLO a TV spenta e fredda con panno in microfibra asciutto (mai alcol o vetril).',
        'Verifica aggiornamenti firmware periodici in Impostazioni -> Sistema -> Informazioni -> Aggiornamento.',
        'Mantieni libere le feritoie posteriori di ventilazione per la longevità della retroilluminazione Mini-LED.',
      ],
      safetyAndEnergy: [
        'Attiva "Sensore luce ambientale" o "Risparmio energetico" in Immagine per ridurre il consumo notturno.',
        'Evita di lasciare immagini statiche ad alta luminosità per molte ore consecutive.',
      ],
    },
    catalogCandidate: {
      name: 'Smart TV 75" Mini-LED',
      brand: 'TCL',
      model: '75Q7C',
      category: 'elettronica',
      suggestedRoom: 'Salone',
      specs: '75 pollici · Pannello QD-Mini LED 4K HDR 144Hz · Google TV · Audio Onkyo',
      manualUrl: 'https://www.tcl.com/it/it/tvs/75q7c',
      manualSummary:
        'Smart TV 75" QD-Mini LED 4K UHD con Google TV, HDMI 2.1 eARC, audio Onkyo e modalità eco.',
      sourceUrls: [{ title: 'TCL Italia Supporto', url: 'https://www.tcl.com/it/it/support' }],
    },
  },
  {
    match: (k) => k.includes('avs') && k.includes('a300'),
    guide: {
      manualUrl: 'https://www.avselectronics.it/',
      summary:
        'Centrale antintrusione professionale AVS Electronics serie A300 (Xtream / A300) con gestione zone parziali (Notte/Perimetrale), tastiera e controllo remoto.',
      keySpecs: [
        'Centrale antintrusione filare/ibrida AVS Electronics A300',
        'Gestione scenari: Totale, Perimetrale/Notte, Aree indipendenti',
        'Batteria tampone interna 12V Piombo/AGM per continuità in caso di blackout',
        'Notifiche allarme / guasto tramite modulo GSM/IP',
      ],
      quickUsage: [
        'Inserimento Totale: digita codice utente (o avvicina chiave/tag) -> premi Totale/ON e attendi il tempo di uscita.',
        'Inserimento Notte/Perimetrale: seleziona lo scenario parziale per proteggere infissi lasciando liberi i sensori interni.',
        'In caso di anomalia ("Batteria bassa", "Sabotaggio", "Mancanza rete") premi OK/Info sulla tastiera per leggere il dettaglio.',
      ],
      maintenance: [
        'Testa annualmente sirena esterna, batteria tampone centrale (durata media 3–5 anni) e pile dei sensori radio.',
        'Pulisci delicatamente le lenti dei sensori volumetrici PIR da polvere e ragnatele.',
        'Non scollegare contemporaneamente rete 230V e batteria tampone senza codice tecnico installatore.',
      ],
      safetyAndEnergy: [
        'Conserva il codice Utente Master e i contatti dell’installatore in luogo sicuro.',
        'Assicurati che eventuali finestre con contatti magnetici siano ben chiuse prima dell’inserimento notturno.',
      ],
    },
  },
  {
    match: (k) => k.includes('huawei') && k.includes('sun2000'),
    guide: {
      manualUrl: 'https://support.huawei.com/enterprise/en/doc/EDOC1100167258',
      summary:
        'Inverter solare ibrido monofase Huawei SUN2000-4KTL-L1 (4 kW) con doppio MPPT, ottimizzatori opzionali, Wi-Fi FusionSolar e predisposizione batteria LUNA2000.',
      keySpecs: [
        'Potenza nominale AC: 4.000 W monofase · Efficienza max ~98,4%',
        '2 inseguitori MPPT indipendenti · Ingresso batteria LUNA2000 integrato',
        'Monitoraggio Smart PV via app FusionSolar (Wi-Fi integrato + Dongle FE)',
        'Protezione arco elettrico AI (AFCI) e grado di protezione esterno IP65',
      ],
      quickUsage: [
        'LED verdi fissi = impianto connesso in rete e in produzione normale.',
        'Monitoraggio produzione, autoconsumo e immissione in rete tramite app FusionSolar.',
        'In caso di manutenzione su quadri elettrici casa, segui sempre la sequenza di spegnimento: prima interruttore AC, poi sezionatore DC.',
      ],
      maintenance: [
        'Controlla semestralmente su FusionSolar assenza di allarmi stringa/rete e pulizia fisica delle alette di raffreddamento posteriori.',
        'Non coprire l’inverter con armadi chiusi: necessita di convezione d’aria naturale attorno al dissipatore.',
        'Verifica una volta l’anno l’eventuale lavaggio dei moduli fotovoltaici in primavera.',
      ],
      safetyAndEnergy: [
        'Alta tensione DC sulle stringhe FV durante il giorno: non aprire mai connettori MC4 sotto carico.',
        'In fascia diurna (10:00–16:00) attiva lavastoviglie/forno/ACS pompa di calore per massimizzare l’autoconsumo diretto.',
      ],
    },
    catalogCandidate: {
      name: 'Inverter Fotovoltaico Ibrido 4 kW',
      brand: 'Huawei',
      model: 'SUN2000-4KTL-L1',
      category: 'fotovoltaico',
      suggestedRoom: 'Locale Tecnico / Esterno',
      specs: 'Inverter ibrido monofase 4 kW · 2 MPPT · Wi-Fi FusionSolar · IP65',
      manualUrl: 'https://support.huawei.com/enterprise/en/doc/EDOC1100167258',
      manualSummary:
        'Inverter solare ibrido monofase 4 kW con monitoraggio FusionSolar e predisposizione accumulo LUNA2000.',
      sourceUrls: [
        {
          title: 'Huawei FusionSolar Manuale',
          url: 'https://support.huawei.com/enterprise/en/doc/EDOC1100167258',
        },
      ],
    },
  },
  {
    match: (k) => k.includes('electrolux') && k.includes('kodgs20tx'),
    guide: {
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=KODGS20TX',
      summary:
        'Forno elettrico da incasso Electrolux KODGS20TX Serie 600 SurroundCook con funzione SteamBake (cottura a vapore assistita), pulizia idrolitica AquaClean e guide telescopiche.',
      keySpecs: [
        'Capacità: 72 litri · Classe energetica A · Grill & Ventilato SurroundCook',
        'Funzione SteamBake: cavità sul fondo per 250 ml d’acqua (lievitati croccanti)',
        'Pulizia: Sistema idrolitico AquaClean con vapore a bassa temperatura',
        'Range temperatura: 50°C – 275°C · Timer digitale con spegnimento programmato',
      ],
      quickUsage: [
        'Funzione SteamBake: versa max 250 ml di acqua nella cavità del fondo a forno freddo, poi attiva Cottura Ventilata + tasto Vapore.',
        'Usa "Ventilato multilivello" per cuocere contemporaneamente su 2–3 ripiani risparmiando preriscaldamento.',
        'Imposta fine cottura automatica con il timer orologio per spegnere il forno in autonomia.',
      ],
      maintenance: [
        'Pulizia AquaClean: versa 200 ml acqua + poche gocce di detersivo sul fondo, imposta funzione Pulizia AquaClean / 90°C per 30 min e asciuga con panno morbido.',
        'Non usare pagliette metalliche o spray abrasivi sullo smalto interno o sul vetro porta.',
        'Pulisci regolarmente la vaschetta SteamBake dopo il raffreddamento per evitare calcare.',
      ],
      safetyAndEnergy: [
        'Sfrutta il calore residuo negli ultimi 5–10 minuti spegnendo le resistenze in anticipo.',
        'Evita di appoggiare teglie pesanti direttamente sul fondo della cavità.',
      ],
    },
  },
  {
    match: (k) => k.includes('electrolux') && k.includes('knr7te75t'),
    guide: {
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=KNR7TE75T',
      summary:
        'Frigorifero combinato da incasso Electrolux KNR7TE75T MaxiSpace (altezza ~189 cm) con tecnologia TwinTech Total No Frost, MultiFlow e cassetto ExtraChill.',
      keySpecs: [
        'Installazione: Incasso MaxiSpace · Tecnologia TwinTech Total No Frost (zero sbrinamento)',
        'Circuiti di raffreddamento indipendenti frigo/congelatore per conservazione umidità ottimale',
        'Funzioni rapide: FastFreeze (congelamento rapido) e Action Cool (raffreddamento spesa)',
        'Allarme acustico/visivo porta aperta e alta temperatura congelatore',
      ],
      quickUsage: [
        'Temperature consigliate: +4°C vano frigorifero e -18°C vano congelatore.',
        'Attiva "Shopping / Action Cool" 2 ore prima di caricare molta spesa fresca.',
        'Usa il cassetto ExtraChill a temperatura inferiore per carne e pesce fresco.',
      ],
      maintenance: [
        'Non è necessario sbrinare manualmente grazie a Total No Frost; pulisci però i ripiani ogni 2–3 mesi con acqua tiepida e bicarbonato.',
        'Controlla le guarnizioni magnetiche delle porte e puliscile con panno umido per tenere perfetta la tenuta termica.',
        'Tieni sgombre le bocchette di ventilazione interne MultiFlow.',
      ],
      safetyAndEnergy: [
        'Non introdurre cibi caldi: aumenta il lavoro del compressore e i consumi.',
        'Riempire il freezer al 60–80% riduce lo sbalzo termico a ogni apertura.',
      ],
    },
  },
  {
    match: (k) => k.includes('ariston') || k.includes('nimbus') || k.includes('pompa di calore'),
    guide: {
      manualUrl: 'https://www.ariston.com/it-it/assistenza/',
      summary:
        'Pompa di calore aria-acqua Ariston (gestione pavimento radiante e ACS) con profili Eco / Comfort / Boost e controllo curva climatica.',
      keySpecs: [
        'Mandata impianto a pavimento consigliata: 30°C – 36°C (riscaldamento) / 16°C – 20°C (raffrescamento)',
        'Produzione Acqua Calda Sanitaria (ACS) consigliata: 46°C – 50°C',
        'Funzionamento continuo a bassa temperatura per COP massimo (efficienza stagionale)',
      ],
      quickUsage: [
        'Preferisci funzionamento continuo con mandata dolce (32–35°C) anziché accensioni brevi ad alta temperatura.',
        'In estate non scendere sotto la soglia di punto di rugiada impostata per evitare condensa sul pavimento.',
      ],
      maintenance: [
        'Controlla ogni autunno il filtro defangatore magnetico e la pressione circuito idronico (1,2 – 1,5 bar).',
        'Verifica che la batteria alettata dell’unità esterna sia libera da foglie e polvere.',
      ],
      safetyAndEnergy: [
        'Pianifica il riscaldamento ACS nelle ore centrali solari (11:00–15:00) per usare energia più mite e fotovoltaico.',
      ],
    },
  },
  {
    match: (k) => k.includes('rehau') || k.includes('neasmart') || k.includes('deumidificatore'),
    guide: {
      manualUrl: 'https://www.rehau.com/it-it/downloads',
      summary:
        'Sistema di termoregolazione ambiente e deumidificazione Rehau NeaSmart 2.0 per controllo zone, umidità relativa e protezione punto di rugiada.',
      keySpecs: [
        'Controllo multi-zona: Salone, Roberta, Bagno 1, Matrimoniale, Bagno 2, Maurizio',
        'Target umidità comfort consigliato: 48% – 55% RH',
        'Protezione punto di rugiada integrata per raffrescamento radiante estivo',
      ],
      quickUsage: [
        'Mantieni attiva la protezione punto di rugiada in modalità raffrescamento.',
        'Seleziona velocità ventola "Auto" per bilanciare silenziosità e capacità di deumidificazione.',
      ],
      maintenance: [
        'Pulisci o aspira il filtro aria del deumidificatore ogni 1–2 mesi durante la stagione estiva.',
        'Verifica lo scarico condensa prima dell’avvio estivo.',
      ],
      safetyAndEnergy: [
        'Tieni chiuse le finestre durante il raffrescamento/deumidificazione per non vanificare il lavoro dell’impianto.',
      ],
    },
  },
];

// Supplemental offline-searchable catalog for common appliances when searching online without Gemini backend
const SUPPLEMENTAL_SEARCH_CATALOG: Omit<OnlineArticleSearchResult, 'id' | 'providerLabel'>[] = [
  {
    name: 'Lavatrice Serie 6 9 kg',
    brand: 'Bosch',
    model: 'WGG244A0IT',
    category: 'elettrodomestici',
    suggestedRoom: 'Bagno 1',
    specs: '9 kg · 1400 giri/min · Classe A · i-DOS dosaggio automatico · Iron Assist',
    manualUrl: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
    manualSummary:
      'Lavatrice frontale da 9 kg a basso consumo con dosaggio automatico detersivo e programma vapore.',
    sourceUrls: [
      {
        title: 'Manuali Bosch Italia',
        url: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
      },
    ],
  },
  {
    name: 'Asciugatrice Pompa di Calore 9 kg',
    brand: 'Bosch',
    model: 'WQG24500IT',
    category: 'elettrodomestici',
    suggestedRoom: 'Locale Tecnico / Esterno',
    specs: '9 kg · Pompa di calore Classe A++ · AutoDry · Condensatore autopulente',
    manualUrl: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
    manualSummary:
      'Asciugatrice a pompa di calore con sensori di umidità AutoDry e pulizia facilitata filtro EasyClean.',
    sourceUrls: [
      {
        title: 'Manuali Bosch Italia',
        url: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
      },
    ],
  },
  {
    name: 'Lavastoviglie Integrata Totale 60 cm',
    brand: 'Electrolux',
    model: 'KEAF7200L',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '13 coperti · AirDry apertura automatica porta · Classe E · 49 dB',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=KEAF7200L',
    manualSummary:
      'Lavastoviglie da incasso 60 cm con tecnologia AirDry (apertura automatica fine ciclo) e programma Eco 50°C.',
    sourceUrls: [
      {
        title: 'Manuali Electrolux',
        url: 'https://www.electrolux.it/support/user-manuals/?q=KEAF7200L',
      },
    ],
  },
  {
    name: 'Piano Cottura a Induzione 60 cm',
    brand: 'Electrolux',
    model: 'LIT60433',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '4 zone induzione · Hob2Hood cappa automatica · PowerBoost · Limitatore kW',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=LIT60433',
    manualSummary:
      'Piano a induzione 4 zone con gestione potenza configurabile (2.5–7.2 kW) e funzione booster rapido.',
    sourceUrls: [
      {
        title: 'Manuali Electrolux',
        url: 'https://www.electrolux.it/support/user-manuals/?q=LIT60433',
      },
    ],
  },
  {
    name: 'Microonde Combinato da Incasso',
    brand: 'Electrolux',
    model: 'LMS4253TMX',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '25 litri · Microonde 900W + Grill 1000W · Piatto rotante 31,5 cm · Inox antimpronta',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=LMS4253TMX',
    manualSummary:
      'Microonde da incasso 25L con funzione grill combinata, scongelamento a peso e blocco sicurezza bambini.',
    sourceUrls: [
      {
        title: 'Manuali Electrolux',
        url: 'https://www.electrolux.it/support/user-manuals/?q=LMS4253TMX',
      },
    ],
  },
  {
    name: 'Lavatrice AI EcoBubble 9 kg',
    brand: 'Samsung',
    model: 'WW90T534DAE',
    category: 'elettrodomestici',
    suggestedRoom: 'Bagno 1',
    specs: '9 kg · 1400 giri · EcoBubble · Wi-Fi SmartThings · Vapore igienizzante',
    manualUrl: 'https://www.samsung.com/it/support/model/WW90T534DAE/S3/',
    manualSummary:
      'Lavatrice smart con tecnologia EcoBubble a freddo, programma igienizzante a vapore e controllo SmartThings.',
    sourceUrls: [
      {
        title: 'Supporto Samsung',
        url: 'https://www.samsung.com/it/support/model/WW90T534DAE/S3/',
      },
    ],
  },
  {
    name: 'Monitor Gaming / Ufficio 27" QHD',
    brand: 'LG',
    model: '27GR75Q-B',
    category: 'elettronica',
    suggestedRoom: 'Stanza Maurizio',
    specs: '27 pollici IPS QHD 2560x1440 · 165Hz · 1ms GtG · DisplayPort + 2x HDMI',
    manualUrl: 'https://www.lg.com/it/supporto/manuali/',
    manualSummary:
      'Monitor IPS 27" QHD ad alta frequenza di aggiornamento adatto a produttività, studio e gaming.',
    sourceUrls: [
      { title: 'Supporto LG Italia', url: 'https://www.lg.com/it/supporto/manuali/' },
    ],
  },
  {
    name: 'Scopa Elettrica Senza Fili V15 Detect',
    brand: 'Dyson',
    model: 'V15 Detect Absolute',
    category: 'elettrodomestici',
    suggestedRoom: 'Salone',
    specs: '240 AW · Spazzola Fluffy Optic laser · Display LCD particelle · Autonomia 60 min',
    manualUrl: 'https://www.dyson.it/support/vacuum-cleaners/cordless/v15',
    manualSummary:
      'Aspirapolvere ciclonico cordless con rilevamento laser della polvere, spazzola anti-groviglio e filtro HEPA lavabile.',
    sourceUrls: [
      {
        title: 'Manuale Dyson V15',
        url: 'https://www.dyson.it/support/vacuum-cleaners/cordless/v15',
      },
    ],
  },
  {
    name: 'MacBook Air 13" M3',
    brand: 'Apple',
    model: 'MacBook Air M3',
    category: 'elettronica',
    suggestedRoom: 'Stanza Maurizio',
    specs: 'Display Liquid Retina 13,6" · Chip Apple M3 · Wi-Fi 6E · MagSafe 3 + 2x Thunderbolt',
    manualUrl: 'https://support.apple.com/it-it/guide/macbook-air/welcome/mac',
    manualSummary:
      'Manuale utente ufficiale Apple MacBook Air con gestione batteria ottimizzata, porte MagSafe e backup Time Machine.',
    sourceUrls: [
      {
        title: 'Manuale Apple MacBook Air',
        url: 'https://support.apple.com/it-it/guide/macbook-air/welcome/mac',
      },
    ],
  },
  {
    name: 'Asciugacapelli Supersonic',
    brand: 'Dyson',
    model: 'HD07 Supersonic',
    category: 'altro',
    suggestedRoom: 'Stanza Roberta',
    specs: '1600W · Controllo intelligente calore · 5 accessori magnetici incluso diffusore e Flyaway',
    manualUrl: 'https://www.dyson.it/support/hair-care/hair-dryers/supersonic',
    manualSummary:
      'Asciugacapelli ad alta velocità con controllo termico 40 volte/sec e filtro inferiore removibile per pulizia periodica.',
    sourceUrls: [
      {
        title: 'Manuale Dyson Supersonic',
        url: 'https://www.dyson.it/support/hair-care/hair-dryers/supersonic',
      },
    ],
  },
  {
    name: 'Router Wi-Fi 6 Mesh / Modem Fibra',
    brand: 'AVM Fritz!Box',
    model: 'FRITZ!Box 7590 AX',
    category: 'elettronica',
    suggestedRoom: 'Casa / Ingresso',
    specs: 'Wi-Fi 6 Dual Band · VDSL/Fibra WAN · 4x LAN Gigabit · Base DECT & NAS USB 3.0',
    manualUrl: 'https://it.avm.de/assistenza/manuali/',
    manualSummary:
      'Modem router Wi-Fi 6 con gestione rete mesh, priorità QoS e monitoraggio energetico porta per porta.',
    sourceUrls: [
      { title: 'Manuali AVM FRITZ!', url: 'https://it.avm.de/assistenza/manuali/' },
    ],
  },
];

function getCachedManualStore(): Record<string, Partial<ArticleManualGuide>> {
  try {
    const raw = localStorage.getItem(CUSTOM_GUIDES_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Partial<ArticleManualGuide>>;
  } catch {
    return {};
  }
}

export function saveCachedManualGuide(
  brand: string,
  model: string,
  patch: Partial<ArticleManualGuide>
): void {
  const key = `${brand.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
  try {
    const store = getCachedManualStore();
    store[key] = { ...(store[key] || {}), ...patch };
    localStorage.setItem(CUSTOM_GUIDES_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage quota errors
  }
}

export function getArticleManualGuide(article: HomeArticleRecord): ArticleManualGuide {
  const { manualUrl: unpackedUrl, userNotes } = unpackArticleNotes(article.notes);
  const supportSearchUrl = buildManufacturerManualSearchUrl(article.brand, article.model);
  const cacheKey = `${article.brand.trim().toLowerCase()}|${article.model.trim().toLowerCase()}`;
  const cached = getCachedManualStore()[cacheKey];
  const fullKey = `${article.brand} ${article.model} ${article.name}`.toLowerCase();

  const curated = CURATED_DEVICES.find((d) => d.match(fullKey));
  if (curated) {
    return {
      ...curated.guide,
      manualUrl: unpackedUrl || cached?.manualUrl || curated.guide.manualUrl,
      summary: cached?.summary || curated.guide.summary,
      keySpecs: cached?.keySpecs?.length ? cached.keySpecs : curated.guide.keySpecs,
      quickUsage: cached?.quickUsage?.length ? cached.quickUsage : curated.guide.quickUsage,
      maintenance: cached?.maintenance?.length ? cached.maintenance : curated.guide.maintenance,
      safetyAndEnergy: cached?.safetyAndEnergy?.length
        ? cached.safetyAndEnergy
        : curated.guide.safetyAndEnergy,
      sourceUrls: cached?.sourceUrls || curated.guide.sourceUrls,
      supportSearchUrl,
      sourceType: cached ? 'online' : 'curated',
    };
  }

  const supplemental = SUPPLEMENTAL_SEARCH_CATALOG.find(
    (item) =>
      item.model.toLowerCase() === article.model.trim().toLowerCase() &&
      item.brand.toLowerCase() === article.brand.trim().toLowerCase()
  );

  const summary =
    cached?.summary ||
    supplemental?.manualSummary ||
    `Scheda tecnica e manuale operativo per ${article.name} (${article.brand} ${article.model}), installato in ${article.room}.`;

  const keySpecs = cached?.keySpecs?.length
    ? cached.keySpecs
    : [
        `Dispositivo: ${article.name}`,
        `Marca / Modello: ${article.brand} · ${article.model}`,
        `Stanza assegnata: ${article.room}`,
        ...(article.specs ? [article.specs] : []),
        ...(article.serialNumber ? [`Numero di serie: ${article.serialNumber}`] : []),
        ...(userNotes ? [`Note casa: ${userNotes}`] : []),
      ];

  const categoryQuickUsage: Record<HomeArticleCategory, string[]> = {
    elettrodomestici: [
      'Seleziona programmi Eco o a pieno carico per ottimizzare acqua ed energia elettrica.',
      'In presenza di fotovoltaico, avvia il ciclo nelle ore di produzione solare (10:30–16:00).',
      'Verifica sullo sportello o sulla targhetta interna il codice PNC/S/N prima di ordinare ricambi.',
    ],
    elettronica: [
      'Mantieni aggiornato il firmware/OS dalle impostazioni di sistema.',
      'Collega eventuali alimentatori critici a una ciabatta filtrata contro sbalzi di tensione.',
    ],
    sicurezza: [
      'Verifica periodicamente notifiche di centrale, stato batterie e connessione primaria/backup.',
      'Conserva codici utente e recapito assistenza separati dalla centrale.',
    ],
    fotovoltaico: [
      'Controlla regolarmente l’app di monitoraggio per verificare assenza di allarmi o cali di stringa.',
      'Non intervenire su sezionatori DC/AC senza seguire l’ordine di manovra previsto dal costruttore.',
    ],
    clima: [
      'Imposta temperature di mandata o setpoint moderati per privilegiare efficienza e comfort.',
      'Verifica che valvole di zona, sonde e deumidificazione lavorino senza ostruzioni.',
    ],
    altro: [
      'Conserva fattura d’acquisto e manuale originale o link PDF direttamente in questa scheda.',
    ],
  };

  const categoryMaintenance: Record<HomeArticleCategory, string[]> = {
    elettrodomestici: [
      'Pulisci filtri, guarnizioni e vaschette ogni 1–2 mesi per evitare cali di rendimento.',
      'Esegui un ciclo periodico di pulizia/decalcificazione come previsto dal produttore.',
    ],
    elettronica: [
      'Spolvera delicatamente feritoie di aerazione e porte con panno asciutto o aria compressa leggera.',
    ],
    sicurezza: [
      'Test annuale batteria tampone e comunicazione allarmi.',
    ],
    fotovoltaico: [
      'Controllo visivo annuale moduli e pulizia dissipatore inverter.',
    ],
    clima: [
      'Pulizia periodica filtri aria e controllo annuale pressioni/filtri idronici.',
    ],
    altro: [
      'Ispezione visiva periodica di cavi, filtri o parti soggette ad usura.',
    ],
  };

  return {
    manualUrl: unpackedUrl || cached?.manualUrl || supplemental?.manualUrl || supportSearchUrl,
    supportSearchUrl,
    summary,
    keySpecs,
    quickUsage: cached?.quickUsage?.length
      ? cached.quickUsage
      : categoryQuickUsage[article.category] || categoryQuickUsage.altro,
    maintenance: cached?.maintenance?.length
      ? cached.maintenance
      : categoryMaintenance[article.category] || categoryMaintenance.altro,
    safetyAndEnergy: cached?.safetyAndEnergy?.length
      ? cached.safetyAndEnergy
      : [
          'Scollegare l’alimentazione elettrica prima di operazioni di pulizia interna o manutenzione.',
          article.warrantyEnd
            ? `Garanzia / copertura registrata fino al ${article.warrantyEnd}.`
            : 'Registra data d’acquisto e numero di serie per far valere la garanzia legale (24 mesi).',
        ],
    sourceUrls: cached?.sourceUrls || supplemental?.sourceUrls,
    sourceType: cached ? 'online' : supplemental ? 'curated' : 'generated',
  };
}

function inferCategoryFromText(text: string): HomeArticleCategory {
  const t = text.toLowerCase();
  if (/(inverter|pannell|fotovolta|solare|sun2000|batteria accumulo)/.test(t)) {
    return 'fotovoltaico';
  }
  if (/(allarme|sirena|telecam|sensor|antifurto|citofon|nvr|avs)/.test(t)) {
    return 'sicurezza';
  }
  if (/(pompa di calore|condizionator|caldaia|termostat|deumidificat|ariston|rehau|neasmart|clima)/.test(t)) {
    return 'clima';
  }
  if (/(tv|televis|monitor|router|modem|laptop|macbook|pc|soundbar|console|stampante|nas|tablet|alexa)/.test(t)) {
    return 'elettronica';
  }
  if (/(forno|frigo|frigorifero|lavatrice|asciugatrice|lavastoviglie|microonde|piano cottura|induzione|cappa|aspirapolvere|dyson|caffe)/.test(t)) {
    return 'elettrodomestici';
  }
  return 'altro';
}

function inferRoomFromText(text: string, cat: HomeArticleCategory): string {
  const t = text.toLowerCase();
  if (/(forno|frigo|frigorifero|lavastoviglie|induzione|piano cottura|microonde|cappa|macchina caffe)/.test(t)) {
    return 'Cucina';
  }
  if (/(tv|televis|soundbar|divano|camino)/.test(t)) {
    return 'Salone';
  }
  if (/(monitor|pc|macbook|laptop|scrivania|stampante)/.test(t)) {
    return 'Stanza Maurizio';
  }
  if (/(asciugacapelli|piastra|supersonic|airwrap)/.test(t)) {
    return 'Stanza Roberta';
  }
  if (/(lavatrice|asciugatrice)/.test(t)) {
    return 'Bagno 1';
  }
  if (cat === 'fotovoltaico' || cat === 'clima') {
    return 'Locale Tecnico / Esterno';
  }
  if (cat === 'sicurezza') {
    return 'Casa / Ingresso';
  }
  return 'Salone';
}

async function searchWikidataFallback(query: string): Promise<OnlineArticleSearchResult[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
    query
  )}&language=it&uselang=it&limit=4&format=json&origin=*`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      search?: { id: string; label?: string; description?: string; concepturi?: string }[];
    };
    const items = data.search || [];
    return items.slice(0, 3).map((item, idx) => {
      const label = (item.label || query).trim();
      const desc = (item.description || '').trim();
      const words = label.split(/\s+/);
      const brand = words[0] || 'Da completare';
      const model = words.slice(1).join(' ') || label;
      const cat = inferCategoryFromText(`${label} ${desc}`);
      const manualUrl = buildManufacturerManualSearchUrl(brand, model);
      return {
        id: `wd_${item.id}_${idx}`,
        name: label.slice(0, 80),
        brand: brand.slice(0, 60),
        model: model.slice(0, 80),
        category: cat,
        suggestedRoom: inferRoomFromText(`${label} ${desc}`, cat),
        specs: (desc || `${label} · scheda trovata online su Wikidata`).slice(0, 240),
        manualUrl,
        manualSummary: desc
          ? `${label}: ${desc}. Consulta il manuale ufficiale o avvia la ricerca PDF diretta.`
          : `Scheda base trovata online per ${label}.`,
        sourceUrls: [
          {
            title: `Wikidata: ${label}`,
            url: item.concepturi || `https://www.wikidata.org/wiki/${item.id}`,
          },
          { title: 'Cerca Manuale PDF', url: manualUrl },
        ],
        providerLabel: 'Ricerca Web / Catalogo',
      };
    });
  } catch {
    return [];
  }
}

export async function searchArticlesOnline(query: string): Promise<{
  results: OnlineArticleSearchResult[];
  provider: string;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], provider: 'none' };

  // 1. Try server-side Google Search grounded Gemini search (works in AI Studio / Cloud Run)
  try {
    const res = await fetch('/api/articles/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: trimmed }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        results?: OnlineArticleSearchResult[];
        provider?: string;
      };
      if (Array.isArray(json.results) && json.results.length > 0) {
        return {
          results: json.results,
          provider: json.provider || 'Ricerca Online (Google Search)',
        };
      }
    }
  } catch {
    // Static deploy (e.g. GitHub Pages) or backend unavailable -> fallback gracefully
  }

  // 2. Curated + Wikidata CORS fallback (always works offline or on static GitHub Pages)
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const curatedMatches: OnlineArticleSearchResult[] = [];

  for (const item of CURATED_DEVICES) {
    if (!item.catalogCandidate) continue;
    const hay = `${item.catalogCandidate.name} ${item.catalogCandidate.brand} ${item.catalogCandidate.model} ${item.catalogCandidate.specs}`.toLowerCase();
    if (tokens.some((t) => hay.includes(t))) {
      curatedMatches.push({
        id: `cur_${item.catalogCandidate.brand}_${item.catalogCandidate.model}`.replace(/[^a-z0-9_]/gi, '_'),
        ...item.catalogCandidate,
        providerLabel: 'Catalogo Tecnico + Manuale',
      });
    }
  }

  for (const item of SUPPLEMENTAL_SEARCH_CATALOG) {
    const hay = `${item.name} ${item.brand} ${item.model} ${item.specs} ${item.suggestedRoom}`.toLowerCase();
    if (tokens.every((t) => hay.includes(t)) || tokens.some((t) => t.length >= 3 && hay.includes(t))) {
      curatedMatches.push({
        id: `sup_${item.brand}_${item.model}`.replace(/[^a-z0-9_]/gi, '_'),
        ...item,
        providerLabel: 'Catalogo Tecnico + Manuale',
      });
    }
  }

  const wikidataMatches = await searchWikidataFallback(trimmed);

  // Also synthesize a clean smart card from the exact user query so any arbitrary model can be added in 1 click
  const parts = trimmed.split(/\s+/);
  const guessedBrand = parts.length >= 2 ? parts[0] : 'Da completare';
  const guessedModel = parts.length >= 2 ? parts.slice(1).join(' ') : trimmed;
  const guessedCat = inferCategoryFromText(trimmed);
  const directManualUrl = buildManufacturerManualSearchUrl(guessedBrand, guessedModel);

  const syntheticEntry: OnlineArticleSearchResult = {
    id: `custom_web_${Date.now()}`,
    name: trimmed.slice(0, 80),
    brand: (guessedBrand.charAt(0).toUpperCase() + guessedBrand.slice(1)).slice(0, 60),
    model: guessedModel.slice(0, 80),
    category: guessedCat,
    suggestedRoom: inferRoomFromText(trimmed, guessedCat),
    specs: `Articolo aggiunto da ricerca online (${trimmed})`,
    manualUrl: directManualUrl,
    manualSummary: `Scheda generata per "${trimmed}" con link diretto di ricerca manuale ufficiale PDF.`,
    sourceUrls: [{ title: 'Cerca manuale ufficiale PDF', url: directManualUrl }],
    providerLabel: 'Scheda Rapida + Ricerca Manuale',
  };

  const merged = [...curatedMatches, ...wikidataMatches];
  const deduped: OnlineArticleSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of merged) {
    const k = `${r.brand.toLowerCase()}|${r.model.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  if (
    deduped.length === 0 ||
    !deduped.some(
      (r) => `${r.brand} ${r.model}`.toLowerCase() === `${guessedBrand} ${guessedModel}`.toLowerCase()
    )
  ) {
    deduped.push(syntheticEntry);
  }

  return {
    results: deduped.slice(0, 8),
    provider: curatedMatches.length > 0 || wikidataMatches.length > 0 ? 'Ricerca Catalogo & Web' : 'Ricerca Web',
  };
}

export async function fetchOnlineManualDetails(
  article: HomeArticleRecord
): Promise<Partial<ArticleManualGuide> | null> {
  const fullKey = `${article.brand} ${article.model} ${article.name}`.toLowerCase();
  const hasCuratedGuide = CURATED_DEVICES.some((d) => d.match(fullKey));

  try {
    const res = await fetch('/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: article.name,
        brand: article.brand,
        model: article.model,
        category: article.category,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<ArticleManualGuide>;
    if (json && (json.summary || json.manualUrl)) {
      if (json.sourceType === 'online' || !hasCuratedGuide) {
        saveCachedManualGuide(article.brand, article.model, json);
      } else if (json.sourceUrls?.length) {
        saveCachedManualGuide(article.brand, article.model, {
          sourceUrls: json.sourceUrls,
        });
      }
      return json;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- Export utilities (Markdown / Printable HTML / JSON) ----------

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatSingleArticleMarkdown(article: HomeArticleRecord): string {
  const guide = getArticleManualGuide(article);
  const { userNotes } = unpackArticleNotes(article.notes);
  const lines: string[] = [
    `# ${article.name}`,
    '',
    `- **Marca**: ${article.brand}`,
    `- **Modello**: ${article.model}`,
    `- **Stanza**: ${article.room}`,
    `- **Categoria**: ${article.category}`,
    ...(article.purchaseDate ? [`- **Data acquisto**: ${article.purchaseDate}`] : []),
    ...(article.warrantyEnd ? [`- **Scadenza garanzia**: ${article.warrantyEnd}`] : []),
    `- **Garanzia Family**: ${article.familyWarranty ? 'Sì (attiva)' : 'No'}`,
    ...(article.serialNumber ? [`- **Numero di serie**: ${article.serialNumber}`] : []),
    ...(article.specs ? [`- **Specifiche**: ${article.specs}`] : []),
    ...(userNotes ? [`- **Note personali**: ${userNotes}`] : []),
    `- **Link Manuale**: ${guide.manualUrl}`,
    '',
    '## Sintesi Manuale',
    guide.summary,
    '',
    '## Dati & Caratteristiche',
    ...guide.keySpecs.map((s) => `- ${s}`),
    '',
    '## Utilizzo Rapido',
    ...guide.quickUsage.map((s) => `- ${s}`),
    '',
    '## Manutenzione Consigliata',
    ...guide.maintenance.map((s) => `- ${s}`),
    '',
    '## Sicurezza & Risparmio Energetico',
    ...guide.safetyAndEnergy.map((s) => `- ${s}`),
    '',
  ];
  return lines.join('\n');
}

export function formatAllArticlesMarkdown(articles: HomeArticleRecord[], scopeLabel = 'Tutte le stanze'): string {
  const byRoom = new Map<string, HomeArticleRecord[]>();
  for (const a of articles) {
    const r = a.room || 'Altra stanza';
    const list = byRoom.get(r) || [];
    list.push(a);
    byRoom.set(r, list);
  }
  const sortedRooms = Array.from(byRoom.keys()).sort((a, b) => a.localeCompare(b, 'it'));

  const out: string[] = [
    `# Inventario Casa — Schede Articoli & Manuali (${scopeLabel})`,
    `Esportato il ${new Date().toLocaleDateString('it-IT')} · Totale articoli: ${articles.length}`,
    '',
  ];

  for (const room of sortedRooms) {
    const list = byRoom.get(room) || [];
    out.push(`---`, '', `## Stanza: ${room} (${list.length})`, '');
    for (const art of list) {
      out.push(formatSingleArticleMarkdown(art).replace(/^# /m, '### '));
    }
  }
  return out.join('\n');
}

export function formatArticlesHtmlDossier(articles: HomeArticleRecord[], title = 'Dossier Casa — Schede Articoli & Manuali'): string {
  const byRoom = new Map<string, HomeArticleRecord[]>();
  for (const a of articles) {
    const r = a.room || 'Altra stanza';
    const list = byRoom.get(r) || [];
    list.push(a);
    byRoom.set(r, list);
  }
  const sortedRooms = Array.from(byRoom.keys()).sort((a, b) => a.localeCompare(b, 'it'));

  const sections = sortedRooms
    .map((room) => {
      const list = byRoom.get(room) || [];
      const cards = list
        .map((art) => {
          const guide = getArticleManualGuide(art);
          const { userNotes } = unpackArticleNotes(art.notes);
          return `
            <div class="card">
              <div class="card-head">
                <div>
                  <h3>${escapeHtml(art.name)}</h3>
                  <div class="meta">${escapeHtml(art.brand)} · <code>${escapeHtml(art.model)}</code> · ${escapeHtml(art.category)}</div>
                </div>
                <span class="room-badge">${escapeHtml(art.room)}</span>
              </div>
              <div class="grid">
                ${art.purchaseDate ? `<div><strong>Acquisto:</strong> ${escapeHtml(art.purchaseDate)}</div>` : ''}
                ${art.warrantyEnd ? `<div><strong>Garanzia:</strong> ${escapeHtml(art.warrantyEnd)}${art.familyWarranty ? ' (Family)' : ''}</div>` : ''}
                ${art.serialNumber ? `<div><strong>S/N:</strong> <code>${escapeHtml(art.serialNumber)}</code></div>` : ''}
                <div><strong>Manuale:</strong> <a href="${escapeHtml(guide.manualUrl)}">${escapeHtml(guide.manualUrl)}</a></div>
              </div>
              ${art.specs ? `<p class="specs">${escapeHtml(art.specs)}</p>` : ''}
              ${userNotes ? `<p class="notes"><strong>Note:</strong> ${escapeHtml(userNotes)}</p>` : ''}
              <div class="manual-box">
                <p><strong>Manuale operativo:</strong> ${escapeHtml(guide.summary)}</p>
                <div class="cols">
                  <div>
                    <strong>Utilizzo rapido</strong>
                    <ul>${guide.quickUsage.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
                  </div>
                  <div>
                    <strong>Manutenzione &amp; Sicurezza</strong>
                    <ul>${[...guide.maintenance, ...guide.safetyAndEnergy].map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join('\n');
      return `<section><h2>${escapeHtml(room)} (${list.length})</h2>${cards}</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 28px; line-height: 1.45; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #475569; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 17px; border-bottom: 2px solid #0284c7; padding-bottom: 4px; margin-top: 26px; color: #0369a1; }
  .card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; margin: 12px 0; break-inside: avoid; }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  h3 { margin: 0; font-size: 15px; }
  .meta { font-size: 12px; color: #334155; margin-top: 2px; }
  .room-badge { background: #e0f2fe; color: #0369a1; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; font-size: 12px; margin-top: 10px; }
  .specs { font-size: 12px; color: #1e293b; margin: 8px 0 4px; }
  .notes { font-size: 12px; color: #475569; margin: 4px 0; }
  .manual-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-top: 10px; font-size: 12px; }
  .cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 6px; }
  ul { margin: 4px 0 0 16px; padding: 0; }
  li { margin-bottom: 3px; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 11px; }
  @media print { body { margin: 12mm; } .card { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">Esportato il ${escapeHtml(new Date().toLocaleString('it-IT'))} · Totale articoli: ${articles.length}</div>
  ${sections}
</body>
</html>`;
}

export function triggerTextDownload(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
