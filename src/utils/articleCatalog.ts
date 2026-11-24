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
  pnc?: string;
  department?: string;
  category: HomeArticleCategory;
  suggestedRoom: string;
  specs: string;
  manualUrl: string;
  description: string;
  imageUrl?: string;
  imageCredit?: string;
  familyWarrantySuggested?: boolean;
  sourceUrls: { title: string; url: string }[];
  providerLabel: string;
}

export const EXTRA_FAMILY_COVERAGE_INFO = {
  title: 'Assicurazione Extra Family',
  description:
    'Estensione assicurativa di protezione casa su grandi elettrodomestici e TV/elettronica (guasti elettrici, elettronici o meccanici oltre i 2 anni di garanzia legale). Tieni segnati qui i dispositivi assicurati con modello, seriale e scadenza per gestire subito eventuali sinistri o riparazioni.',
};

export interface ExtractedArticleManualDetails {
  name: string;
  brand: string;
  model: string;
  category: HomeArticleCategory;
  room: string;
  specs: string;
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
  if (b.includes('aeg')) {
    return `https://www.aeg.it/support/user-manuals/?q=${encodeURIComponent(model)}`;
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
      name: 'Smart TV 75" QD-Mini LED',
      brand: 'TCL',
      model: '75Q7C',
      category: 'elettronica',
      suggestedRoom: 'Salone',
      specs: '75 pollici · Pannello QD-Mini LED 4K HDR 144Hz · Google TV · Audio Onkyo',
      manualUrl: 'https://www.tcl.com/it/it/tvs/75q7c',
      description:
        'Smart TV 75" QD-Mini LED 4K UHD con Google TV, HDMI 2.1 eARC, audio Onkyo e modalità eco.',
      familyWarrantySuggested: true,
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
    catalogCandidate: {
      name: 'Centrale Allarme Casa',
      brand: 'AVS Electronics',
      model: 'A300',
      category: 'sicurezza',
      suggestedRoom: 'Casa / Ingresso',
      specs: 'Centrale antintrusione filare/ibrida · Gestione Notte & Perimetrale · GSM/IP',
      manualUrl: 'https://www.avselectronics.it/',
      description:
        'Centrale di allarme casa AVS Electronics con gestione zone indipendenti e notifiche remote.',
      familyWarrantySuggested: false,
      sourceUrls: [{ title: 'AVS Electronics', url: 'https://www.avselectronics.it/' }],
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
      description:
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
    catalogCandidate: {
      name: 'Forno Elettrico SteamBake',
      brand: 'Electrolux',
      model: 'KODGS20TX',
      category: 'elettrodomestici',
      suggestedRoom: 'Cucina',
      specs: '72 litri · Serie 600 SurroundCook · Funzione vapore SteamBake · Pulizia AquaClean',
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=KODGS20TX',
      description:
        'Forno da incasso Electrolux con cottura assistita a vapore SteamBake e pulizia idrolitica AquaClean.',
      familyWarrantySuggested: true,
      sourceUrls: [
        {
          title: 'Manuali Electrolux KODGS20TX',
          url: 'https://www.electrolux.it/support/user-manuals/?q=KODGS20TX',
        },
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
    catalogCandidate: {
      name: 'Frigorifero Combinato Incasso MaxiSpace',
      brand: 'Electrolux',
      model: 'KNR7TE75T',
      category: 'elettrodomestici',
      suggestedRoom: 'Cucina',
      specs: 'Incasso 189 cm · TwinTech Total No Frost · MultiFlow · Cassetto ExtraChill',
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=KNR7TE75T',
      description:
        'Frigorifero combinato da incasso Electrolux MaxiSpace Total No Frost con doppia circolazione indipendente.',
      familyWarrantySuggested: true,
      sourceUrls: [
        {
          title: 'Manuali Electrolux KNR7TE75T',
          url: 'https://www.electrolux.it/support/user-manuals/?q=KNR7TE75T',
        },
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
  {
    match: (k) => k.includes('lr7g86xw') || k.includes('914 921 766') || k.includes('914921766'),
    guide: {
      manualUrl: 'https://www.aeg.it/support/user-manuals/?q=LR7G86XW',
      summary:
        'Lavatrice AEG Serie 7000 ProSteam® da 8 kg (Modello LR7G86XW · PNC 914 921 766) con programma vapore ProSteam per ridurre le pieghe, tecnologia PreciseWash e cesto Care.',
      keySpecs: [
        'Modello No.: LR7G86XW · Prodotto No. (PNC): 914 921 766',
        'Capacità: 8 kg · Centrifuga max 1600 giri/min · Classe A',
        'Tecnologia ProSteam®: refresh a vapore in 25 min e fine ciclo anti-piega',
        'Sensore PreciseWash: adatta acqua, tempo ed energia al carico effettivo',
      ],
      quickUsage: [
        'Usa il programma Vapore ProSteam sui capi asciutti per rinfrescare e ridurre le pieghe prima di stirare.',
        'Per capi quotidiani in misto cotone usa UniversalDose / MixLoad 69 min a 30°C.',
        'Sfrutta la partenza ritardata per far lavorare la lavatrice nelle ore di produzione fotovoltaica.',
      ],
      maintenance: [
        'Pulisci ogni mese il filtro scarico in basso a destra e la guarnizione oblò dopo i lavaggi.',
        'Esegui ogni 2–3 mesi un ciclo a vuoto a 60°/90°C per mantenere igienizzato il cestello.',
      ],
      safetyAndEnergy: [
        'Carica l’80% del cestello per massima efficienza e bilanciamento della centrifuga.',
      ],
    },
    catalogCandidate: {
      name: 'Lavatrice 7000 ProSteam® 8 kg',
      brand: 'AEG',
      model: 'LR7G86XW',
      pnc: '914 921 766',
      department: 'Lavaggio & Asciugatura',
      category: 'elettrodomestici',
      suggestedRoom: 'Bagno 1',
      specs: '8 kg · 1600 giri · ProSteam® vapore · PreciseWash · PNC 914 921 766',
      manualUrl: 'https://www.aeg.it/support/user-manuals/?q=LR7G86XW',
      description:
        'Lavatrice AEG Serie 7000 ProSteam® 8 kg con rinfrescamento a vapore, riduzione pieghe e sensore automatico di carico.',
      familyWarrantySuggested: true,
      sourceUrls: [
        {
          title: 'Manuali AEG LR7G86XW',
          url: 'https://www.aeg.it/support/user-manuals/?q=LR7G86XW',
        },
      ],
    },
  },
  {
    match: (k) => k.includes('kesc8310l') || k.includes('911 536 603') || k.includes('911536603'),
    guide: {
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=KESC8310L',
      summary:
        'Lavastoviglie integrata totale Electrolux Serie 600 SatelliteClean® 60 cm da 14 coperti (Modello KESC8310L · PNC 911 536 603) con mulinello a doppio movimento, AirDry e MaxiFlex.',
      keySpecs: [
        'Modello No.: KESC8310L · Prodotto No. (PNC): 911 536 603',
        'Capacità: 14 coperti · Incasso totale 60 cm · Terzo cesto posate MaxiFlex',
        'Mulinello SatelliteClean® con getto multi-angolo + apertura porta AirDry a fine ciclo',
        'Fascio luminoso Beam on Floor rosso/verde sul pavimento per stato lavaggio',
      ],
      quickUsage: [
        'Usa i programmi QuickSelect a barra scorrevole scegliendo solo la durata desiderata.',
        'Lascia libera la corsa di apertura automatica AirDry a fine lavaggio per asciugatura naturale senza aloni.',
      ],
      maintenance: [
        'Pulisci settimanalmente il filtro cilindrico sul fondo vasca sotto acqua corrente.',
        'Controlla spia sale rigenerante e brillantante e verifica che gli ugelli del braccio SatelliteClean ruotino liberi.',
      ],
      safetyAndEnergy: [
        'Il programma Eco 50°C consuma meno energia e acqua; avvialo in fascia solare o serale.',
      ],
    },
    catalogCandidate: {
      name: 'Lavastoviglie Serie 600 SatelliteClean 60 cm 14 coperti',
      brand: 'Electrolux',
      model: 'KESC8310L',
      pnc: '911 536 603',
      department: 'Cucina & Cottura',
      category: 'elettrodomestici',
      suggestedRoom: 'Cucina',
      specs: '14 coperti · Incasso 60 cm · SatelliteClean · AirDry · Beam on Floor · PNC 911 536 603',
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=KESC8310L',
      description:
        'Lavastoviglie integrata totale Serie 600 da 14 coperti con mulinello SatelliteClean®, terzo cesto MaxiFlex e apertura automatica AirDry.',
      familyWarrantySuggested: true,
      sourceUrls: [
        {
          title: 'Manuali Electrolux KESC8310L',
          url: 'https://www.electrolux.it/support/user-manuals/?q=KESC8310L',
        },
      ],
    },
  },
  {
    match: (k) => k.includes('tr7g93w') || k.includes('916 900 033') || k.includes('916900033'),
    guide: {
      manualUrl: 'https://www.aeg.it/support/user-manuals/?q=TR7G93W',
      summary:
        'Asciugatrice AEG Serie 7000 SensiDry® a pompa di calore da 9 kg (Modello TR7G93W · PNC 916 900 033) con asciugatura delicata a bassa temperatura e filtro EasyFlow.',
      keySpecs: [
        'Modello No.: TR7G93W · Prodotto No. (PNC): 916 900 033',
        'Capacità: 9 kg · Pompa di calore SensiDry® a basse temperature',
        'Sensori PreciseDry / ProSense: misura l’umidità residua e ferma al grado esatto',
        'Programma MixDry per asciugare insieme cotone e sintetici senza dividerli',
      ],
      quickUsage: [
        'Imposta "MixDry" per i carichi quotidiani misti senza separare i tessuti.',
        'Svuota il serbatoio condensa (se non collegata a scarico diretto) e pulisci il filtro oblò dopo OGNI ciclo.',
      ],
      maintenance: [
        'Pulisci il filtro principale lanugine a ogni ciclo e il filtro condensatore inferiore ogni 4–5 cicli con spazzola o aspirapolvere.',
      ],
      safetyAndEnergy: [
        'Centrifugare bene in lavatrice (1200–1400 giri) riduce fino al 30% la durata e il consumo dell’asciugatura.',
      ],
    },
    catalogCandidate: {
      name: 'AEG Asciugatrice 9 kg Serie 7000 SensiDry',
      brand: 'AEG',
      model: 'TR7G93W',
      pnc: '916 900 033',
      department: 'Lavaggio & Asciugatura',
      category: 'elettrodomestici',
      suggestedRoom: 'Locale Tecnico / Esterno',
      specs: '9 kg · Pompa di calore SensiDry · MixDry · PreciseDry · PNC 916 900 033',
      manualUrl: 'https://www.aeg.it/support/user-manuals/?q=TR7G93W',
      description:
        'Asciugatrice AEG 9 kg a pompa di calore con controllo umidità PreciseDry e asciugatura delicata a bassa temperatura.',
      familyWarrantySuggested: true,
      sourceUrls: [
        {
          title: 'Manuali AEG TR7G93W',
          url: 'https://www.aeg.it/support/user-manuals/?q=TR7G93W',
        },
      ],
    },
  },
  {
    match: (k) => k.includes('eil63443') || k.includes('949 599 155') || k.includes('949599155'),
    guide: {
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=EIL63443',
      summary:
        'Piano cottura a induzione Electrolux Serie 600 Bridge da 60 cm (Modello EIL63443 · PNC 949 599 155) con 4 zone, funzione Bridge per pentole lunghe e controllo cappa Hob2Hood.',
      keySpecs: [
        'Modello No.: EIL63443 · Prodotto No. (PNC): 949 599 155',
        'Larghezza: 60 cm · 4 zone induzione con comandi touch individuali e PowerBoost',
        'Funzione Bridge: unisce 2 zone di sinistra in un’unica ampia zona cottura (pesciera/piastra)',
        'Hob2Hood® wireless + limitatore potenza configurabile (ideale per contatore 6 kW)',
      ],
      quickUsage: [
        'Premi il tasto Bridge per unire le due zone sinistre e controllarle con un solo slider.',
        'Usa PowerBoost solo per portare rapidamente a bollore acqua o pentole grandi, poi riduci a 6–7.',
      ],
      maintenance: [
        'Pulisci la vetroceramica a piano tiepido/freddo con panno morbido e detergente specifico per vetroceramica.',
        'Usa sempre pentole con fondo ferromagnetico piano e privo di residui per non graffiare il vetro.',
      ],
      safetyAndEnergy: [
        'Verifica nelle impostazioni installazione che il limitatore potenza sia tarato in coerenza con il tuo contatore da 6 kW.',
      ],
    },
    catalogCandidate: {
      name: 'Piano cottura ad induzione 600 Bridge 60cm',
      brand: 'Electrolux',
      model: 'EIL63443',
      pnc: '949 599 155',
      department: 'Cucina & Cottura',
      category: 'elettrodomestici',
      suggestedRoom: 'Cucina',
      specs: '60 cm · 4 zone induzione · Funzione Bridge · Hob2Hood · PowerBoost · PNC 949 599 155',
      manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=EIL63443',
      description:
        'Piano cottura ad induzione Electrolux Serie 600 Bridge 60 cm con unione zone Bridge, connessione automatica cappa Hob2Hood e PowerBoost.',
      familyWarrantySuggested: true,
      sourceUrls: [
        {
          title: 'Manuali Electrolux EIL63443',
          url: 'https://www.electrolux.it/support/user-manuals/?q=EIL63443',
        },
      ],
    },
  },
];

// Catalogo prodotti stile store (Amazon-like) con elettrodomestici ed elettronica reali
const SUPPLEMENTAL_SEARCH_CATALOG: Omit<OnlineArticleSearchResult, 'id' | 'providerLabel'>[] = [
  {
    name: 'Lavatrice Serie 6 9 kg',
    brand: 'Bosch',
    model: 'WGG244A0IT',
    category: 'elettrodomestici',
    suggestedRoom: 'Bagno 1',
    specs: '9 kg · 1400 giri/min · Classe A · i-DOS dosaggio automatico · Iron Assist',
    manualUrl: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
    description:
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
    description:
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
    description:
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
    description:
      'Piano a induzione 4 zone con gestione potenza configurabile (2.5–7.2 kW) e funzione booster rapido.',
    familyWarrantySuggested: true,
    sourceUrls: [
      {
        title: 'Manuali Electrolux LIT60433',
        url: 'https://www.electrolux.it/support/user-manuals/?q=LIT60433',
      },
    ],
  },
  {
    name: 'Piano a Induzione Serie 600 Bridge',
    brand: 'Electrolux',
    model: 'EIS62443',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '4 zone con funzione Bridge · SenseBoil sensore ebollizione · Hob2Hood · 7,35 kW',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=EIS62443',
    description:
      'Piano induzione da incasso 60 cm Electrolux con unione zone Bridge e controllo automatico temperatura.',
    familyWarrantySuggested: true,
    sourceUrls: [
      {
        title: 'Manuali Electrolux EIS62443',
        url: 'https://www.electrolux.it/support/user-manuals/?q=EIS62443',
      },
    ],
  },
  {
    name: 'Frigorifero Combinato No Frost Libera Installazione',
    brand: 'Electrolux',
    model: 'LNT7ME34G2',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '344 litri · TwinTech Total No Frost · CustomFlex · MultiFlow · Compressore Inverter',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=LNT7ME34G2',
    description:
      'Frigorifero combinato da 2 metri Electrolux TwinTech Total No Frost con vano ExtraChill e mensole modulari.',
    familyWarrantySuggested: true,
    sourceUrls: [
      {
        title: 'Manuali Electrolux LNT7ME34G2',
        url: 'https://www.electrolux.it/support/user-manuals/?q=LNT7ME34G2',
      },
    ],
  },
  {
    name: 'Smart TV 65" QD-Mini LED 4K',
    brand: 'TCL',
    model: '65C805',
    category: 'elettronica',
    suggestedRoom: 'Salone',
    specs: '65 pollici · QD-Mini LED 144Hz · Dolby Vision IQ · Google TV · HDMI 2.1',
    manualUrl: 'https://www.tcl.com/it/it/support',
    description:
      'Smart TV TCL Serie C805 QD-Mini LED 4K UHD con Google TV e controllo vocale mani libere.',
    familyWarrantySuggested: true,
    sourceUrls: [
      { title: 'Supporto TCL Italia', url: 'https://www.tcl.com/it/it/support' },
    ],
  },
  {
    name: 'Smart TV 55" QLED Pro 4K',
    brand: 'TCL',
    model: '55C655',
    category: 'elettronica',
    suggestedRoom: 'Matrimoniale',
    specs: '55 pollici · QLED 4K HDR10+ · Audio Onkyo 2.1 · Google TV',
    manualUrl: 'https://www.tcl.com/it/it/support',
    description:
      'Smart TV TCL 55 pollici QLED con processore AiPQ Pro, audio Onkyo e Google TV integrata.',
    familyWarrantySuggested: true,
    sourceUrls: [
      { title: 'Supporto TCL Italia', url: 'https://www.tcl.com/it/it/support' },
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
    description:
      'Microonde da incasso 25L con funzione grill combinata, scongelamento a peso e blocco sicurezza bambini.',
    familyWarrantySuggested: true,
    sourceUrls: [
      {
        title: 'Manuali Electrolux LMS4253TMX',
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
    description:
      'Lavatrice smart con tecnologia EcoBubble a freddo, programma igienizzante a vapore e controllo SmartThings.',
    familyWarrantySuggested: true,
    sourceUrls: [
      {
        title: 'Supporto Samsung',
        url: 'https://www.samsung.com/it/support/model/WW90T534DAE/S3/',
      },
    ],
  },
  {
    name: 'Smart TV OLED 55" 4K',
    brand: 'LG',
    model: 'OLED55C44LA',
    category: 'elettronica',
    suggestedRoom: 'Salone',
    specs: '55 pollici OLED evo 4K · Processore Alpha 9 Gen7 · webOS 24 · 4x HDMI 2.1',
    manualUrl: 'https://www.lg.com/it/supporto/manuali/',
    description:
      'Smart TV LG OLED evo C4 con Dolby Vision, Filmmaker Mode e gestione domotica ThinQ.',
    familyWarrantySuggested: true,
    sourceUrls: [
      { title: 'Supporto LG Italia', url: 'https://www.lg.com/it/supporto/manuali/' },
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
    description:
      'Monitor IPS 27" QHD ad alta frequenza di aggiornamento adatto a produttività, studio e gaming.',
    familyWarrantySuggested: false,
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
    description:
      'Aspirapolvere ciclonico cordless con rilevamento laser della polvere, spazzola anti-groviglio e filtro HEPA lavabile.',
    familyWarrantySuggested: true,
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
    description:
      'Manuale utente ufficiale Apple MacBook Air con gestione batteria ottimizzata, porte MagSafe e backup Time Machine.',
    familyWarrantySuggested: false,
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
    description:
      'Asciugacapelli ad alta velocità con controllo termico 40 volte/sec e filtro inferiore removibile per pulizia periodica.',
    familyWarrantySuggested: false,
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
    description:
      'Modem router Wi-Fi 6 con gestione rete mesh, priorità QoS e monitoraggio energetico porta per porta.',
    familyWarrantySuggested: false,
    sourceUrls: [
      { title: 'Manuali AVM FRITZ!', url: 'https://it.avm.de/assistenza/manuali/' },
    ],
  },
  {
    name: 'Frigorifero Combinato Serie 6 NoFrost',
    brand: 'Bosch',
    model: 'KGN39VLDA',
    department: 'Frigoriferi & Congelatori',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '368 litri · 203 cm · Total NoFrost · VitaFresh 0°C · Inox anti-impronta',
    manualUrl: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
    description:
      'Frigorifero combinato libera installazione Bosch Total NoFrost con cassetti VitaFresh per carne, pesce e verdure.',
    familyWarrantySuggested: true,
    sourceUrls: [
      {
        title: 'Manuali Bosch Italia',
        url: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
      },
    ],
  },
  {
    name: 'Frigorifero Side by Side Total No Frost 635L',
    brand: 'Samsung',
    model: 'RS68A8840B1',
    department: 'Frigoriferi & Congelatori',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '635 litri · Twin Cooling Plus · Dispenser acqua/ghiaccio · Compressore Digital Inverter',
    manualUrl: 'https://www.samsung.com/it/support/',
    description:
      'Frigorifero americano Side by Side Samsung ad alta capacità con doppio circuito Twin Cooling Plus.',
    familyWarrantySuggested: true,
    sourceUrls: [{ title: 'Supporto Samsung', url: 'https://www.samsung.com/it/support/' }],
  },
  {
    name: 'Forno da Incasso Serie 8 Pirolitico',
    brand: 'Bosch',
    model: 'HBG7341B1',
    department: 'Cucina & Cottura',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '71 litri · Display TFT Touch · AirFry · Pulizia EcoClean · Home Connect',
    manualUrl: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
    description:
      'Forno elettrico da incasso Bosch Serie 8 con guida ricette, funzione AirFry e connettività Home Connect.',
    familyWarrantySuggested: true,
    sourceUrls: [
      {
        title: 'Manuali Bosch Italia',
        url: 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni',
      },
    ],
  },
  {
    name: 'Cappa da Incasso Integrata 60/90 cm Hob2Hood',
    brand: 'Electrolux',
    model: 'LFP516X',
    department: 'Cucina & Cottura',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: 'Estraibile 60 cm · Aspirazione 600 m³/h · Illuminazione LED · Filtri alluminio lavabili',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=LFP516X',
    description:
      'Cappa aspirante telescopica Electrolux con elevata portata d’aria e filtri antigrasso lavabili in lavastoviglie.',
    familyWarrantySuggested: false,
    sourceUrls: [
      {
        title: 'Manuali Electrolux',
        url: 'https://www.electrolux.it/support/user-manuals/?q=LFP516X',
      },
    ],
  },
  {
    name: 'Macchina Caffè Automatica Magnifica Evo',
    brand: "De'Longhi",
    model: 'ECAM290.61.B',
    department: 'Pulizia & Piccoli Elettrodomestici',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: 'Macinacaffè conico 13 livelli · LatteCrema System · 5 ricette One-Touch · 1450W',
    manualUrl: 'https://www.delonghi.com/it-it/manuali',
    description:
      'Macchina da caffè superautomatica con montalatte automatico LatteCrema e pulizia caraffa integrata.',
    familyWarrantySuggested: false,
    sourceUrls: [{ title: "Manuali De'Longhi", url: 'https://www.delonghi.com/it-it/manuali' }],
  },
  {
    name: 'Robot Aspirapolvere e Lavapavimenti S8 Pro Ultra',
    brand: 'Roborock',
    model: 'S8 Pro Ultra',
    department: 'Pulizia & Piccoli Elettrodomestici',
    category: 'elettrodomestici',
    suggestedRoom: 'Salone',
    specs: '6000 Pa · Stazione svuotamento e lavaggio panno automatica · Mappatura LiDAR',
    manualUrl: 'https://support.roborock.com/',
    description:
      'Robot aspirapolvere e lavapavimenti autonomo con stazione RockDock Ultra auto-pulente.',
    familyWarrantySuggested: true,
    sourceUrls: [{ title: 'Supporto Roborock', url: 'https://support.roborock.com/' }],
  },
  {
    name: 'Smart TV Neo QLED 55" 4K',
    brand: 'Samsung',
    model: 'QE55QN90D',
    department: 'TV & Audio',
    category: 'elettronica',
    suggestedRoom: 'Salone',
    specs: '55 pollici Neo QLED Mini-LED · 144Hz · Dolby Atmos · Tizen Smart TV · Anti-riflesso',
    manualUrl: 'https://www.samsung.com/it/support/',
    description:
      'Smart TV Samsung Neo QLED 4K con retroilluminazione Quantum Matrix e processore NQ4 AI Gen2.',
    familyWarrantySuggested: true,
    sourceUrls: [{ title: 'Supporto Samsung', url: 'https://www.samsung.com/it/support/' }],
  },
  {
    name: 'Smart TV Bravia OLED 65" 4K',
    brand: 'Sony',
    model: 'XR-65A80L',
    department: 'TV & Audio',
    category: 'elettronica',
    suggestedRoom: 'Salone',
    specs: '65 pollici OLED · Cognitive Processor XR · Acoustic Surface Audio+ · Google TV',
    manualUrl: 'https://www.sony.it/electronics/support',
    description:
      'Smart TV OLED Sony BRAVIA XR con audio direttamente dallo schermo e Google TV integrata.',
    familyWarrantySuggested: true,
    sourceUrls: [{ title: 'Supporto Sony Italia', url: 'https://www.sony.it/electronics/support' }],
  },
  {
    name: 'Soundbar Dolby Atmos 5.1.2 Beam / Arc',
    brand: 'Sonos',
    model: 'Sonos Arc Ultra',
    department: 'TV & Audio',
    category: 'elettronica',
    suggestedRoom: 'Salone',
    specs: 'Dolby Atmos · Sound Motion · HDMI eARC · Wi-Fi + AirPlay 2 · Controllo Trueplay',
    manualUrl: 'https://support.sonos.com/it-it/',
    description:
      'Soundbar premium Wi-Fi con supporto Dolby Atmos su HDMI eARC e calibrazione acustica stanza.',
    familyWarrantySuggested: false,
    sourceUrls: [{ title: 'Supporto Sonos', url: 'https://support.sonos.com/it-it/' }],
  },
  {
    name: 'Batteria Accumulo Fotovoltaico 5/10 kWh',
    brand: 'Huawei',
    model: 'LUNA2000-5-S0',
    department: 'Clima & Fotovoltaico',
    category: 'fotovoltaico',
    suggestedRoom: 'Locale Tecnico / Esterno',
    specs: 'Moduli LiFePO4 5 kWh scalabili fino a 15 kWh · Compatibile SUN2000-L1 · IP66',
    manualUrl: 'https://support.huawei.com/enterprise/en/fusionsolar/luna2000',
    description:
      'Sistema di accumulo al litio ferro fosfato ad alta sicurezza per impianti fotovoltaici Huawei FusionSolar.',
    familyWarrantySuggested: false,
    sourceUrls: [
      { title: 'Huawei FusionSolar', url: 'https://support.huawei.com/enterprise/en/fusionsolar' },
    ],
  },
  {
    name: 'Climatizzatore Inverter Dual/Mono Split Perfera',
    brand: 'Daikin',
    model: 'FTXM35A',
    department: 'Clima & Fotovoltaico',
    category: 'clima',
    suggestedRoom: 'Salone',
    specs: '12000 BTU · Classe A+++ · Wi-Fi Onecta integrato · Purificazione Flash Streamer',
    manualUrl: 'https://www.daikin.it/it_it/clienti/assistenza/manuali.html',
    description:
      'Climatizzatore pompa di calore Daikin Perfera R32 silenzioso (19 dBA) con controllo app Onecta.',
    familyWarrantySuggested: true,
    sourceUrls: [
      { title: 'Manuali Daikin Italia', url: 'https://www.daikin.it/it_it/clienti/assistenza/manuali.html' },
    ],
  },
  {
    name: 'Videocamera Wi-Fi Esterno / Interno Full HD',
    brand: 'TP-Link Tapo',
    model: 'Tapo C320WS',
    department: 'Sicurezza',
    category: 'sicurezza',
    suggestedRoom: 'Casa / Ingresso',
    specs: '2K QHD · Visione notturna a colori · IP66 · Rilevamento movimento · Slot microSD',
    manualUrl: 'https://www.tp-link.com/it/support/',
    description:
      'Telecamera di sorveglianza Wi-Fi/Ethernet resistente alle intemperie con sirena integrata.',
    familyWarrantySuggested: false,
    sourceUrls: [{ title: 'Supporto TP-Link', url: 'https://www.tp-link.com/it/support/' }],
  },
  {
    name: 'Stampante Multifunzione EcoTank Wi-Fi',
    brand: 'Epson',
    model: 'EcoTank ET-2850',
    department: 'Informatica & Rete',
    category: 'elettronica',
    suggestedRoom: 'Stanza Maurizio',
    specs: 'Stampa fronte/retro · Scanner piano · Serbatoi inchiostro ricaricabili · Wi-Fi Direct',
    manualUrl: 'https://www.epson.it/it_IT/support',
    description:
      'Stampante a getto d’inchiostro con serbatoi ad alta capacità senza cartucce e stampa da smartphone.',
    familyWarrantySuggested: false,
    sourceUrls: [{ title: 'Supporto Epson', url: 'https://www.epson.it/it_IT/support' }],
  },
  {
    name: 'PlayStation 5 Slim Console',
    brand: 'Sony',
    model: 'CFI-2016 PlayStation 5',
    department: 'TV & Audio',
    category: 'elettronica',
    suggestedRoom: 'Salone',
    specs: 'SSD 1 TB · Uscita 4K 120Hz HDR HDMI 2.1 · Lettore Ultra HD Blu-ray · DualSense',
    manualUrl: 'https://www.playstation.com/it-it/support/hardware/',
    description:
      'Console di gioco Sony PlayStation 5 con SSD ultraveloce da 1 TB e supporto HDMI 2.1 120Hz.',
    familyWarrantySuggested: true,
    sourceUrls: [
      { title: 'Supporto PlayStation', url: 'https://www.playstation.com/it-it/support/hardware/' },
    ],
  },
  {
    name: 'Lavatrice Serie 600 SensiCare 8 kg',
    brand: 'Electrolux',
    model: 'EW6F482Y',
    department: 'Lavaggio & Asciugatura',
    category: 'elettrodomestici',
    suggestedRoom: 'Bagno 1',
    specs: '8 kg · 1200 giri · SensiCare regola tempi/consumi · Ciclo rapido 14 min · TimeManager',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=EW6F482Y',
    description:
      'Lavatrice a carica frontale Electrolux Serie 600 con autoregolazione del ciclo in base al peso del bucato.',
    familyWarrantySuggested: true,
    sourceUrls: [
      { title: 'Manuali Electrolux EW6F482Y', url: 'https://www.electrolux.it/support/user-manuals/?q=EW6F482Y' },
    ],
  },
  {
    name: 'Asciugatrice Serie 700 GentleCare 8 kg',
    brand: 'Electrolux',
    model: 'EW7H483B',
    department: 'Lavaggio & Asciugatura',
    category: 'elettrodomestici',
    suggestedRoom: 'Locale Tecnico / Esterno',
    specs: '8 kg · Pompa di calore GentleCare · Sistema filtraggio EcoFlow · Partenza ritardata',
    manualUrl: 'https://www.electrolux.it/support/user-manuals/?q=EW7H483B',
    description:
      'Asciugatrice a pompa di calore Electrolux che asciuga i tessuti a temperature dimezzate rispetto alle tradizionali.',
    familyWarrantySuggested: true,
    sourceUrls: [
      { title: 'Manuali Electrolux EW7H483B', url: 'https://www.electrolux.it/support/user-manuals/?q=EW7H483B' },
    ],
  },
  {
    name: 'Lavastoviglie Serie 700 GlassCare 60 cm',
    brand: 'Miele',
    model: 'G 5210 SCi',
    department: 'Cucina & Cottura',
    category: 'elettrodomestici',
    suggestedRoom: 'Cucina',
    specs: '14 coperti · QuickPowerWash 58 min · Cassetto posate 3D MultiFlex · AutoOpen',
    manualUrl: 'https://www.miele.it/c/istruzioni-d-uso-385.htm',
    description:
      'Lavastoviglie Miele da incasso parziale con lavaggio rapido 58 minuti e asciugatura AutoOpen.',
    familyWarrantySuggested: true,
    sourceUrls: [{ title: 'Manuali Miele Italia', url: 'https://www.miele.it/c/istruzioni-d-uso-385.htm' }],
  },
];

export const USER_ELECTROLUX_AEG_PRESETS: OnlineArticleSearchResult[] = [
  'LR7G86XW',
  'KESC8310L',
  'TR7G93W',
  'EIL63443',
]
  .map((model) => CURATED_DEVICES.find((d) => d.catalogCandidate?.model === model)?.catalogCandidate)
  .filter((c): c is Omit<OnlineArticleSearchResult, 'id' | 'providerLabel'> => Boolean(c))
  .map((item) => ({
    ...item,
    id: `user_electrolux_${item.model.toLowerCase()}`,
    providerLabel: 'I tuoi Elettrodomestici Electrolux / AEG',
  }));

export const HOUSEHOLD_EXTRA_FAMILY_STARTERS: Omit<
  OnlineArticleSearchResult,
  'id' | 'providerLabel'
>[] = [
  CURATED_DEVICES[0].catalogCandidate!,
  CURATED_DEVICES[4].catalogCandidate!,
  CURATED_DEVICES.find((d) => d.catalogCandidate?.model === 'LR7G86XW')!.catalogCandidate!,
  CURATED_DEVICES.find((d) => d.catalogCandidate?.model === 'KESC8310L')!.catalogCandidate!,
  CURATED_DEVICES.find((d) => d.catalogCandidate?.model === 'TR7G93W')!.catalogCandidate!,
  CURATED_DEVICES.find((d) => d.catalogCandidate?.model === 'EIL63443')!.catalogCandidate!,
  CURATED_DEVICES[3].catalogCandidate!,
  SUPPLEMENTAL_SEARCH_CATALOG.find((item) => item.model === 'LMS4253TMX')!,
];

function inferCatalogDepartment(item: Omit<OnlineArticleSearchResult, 'id' | 'providerLabel'>): string {
  if (item.department) return item.department;
  const hay = `${item.name} ${item.specs} ${item.category}`.toLowerCase();
  if (/lavatrice|asciugatrice/.test(hay)) return 'Lavaggio & Asciugatura';
  if (/frigo|frigorifero|congelatore/.test(hay)) return 'Frigoriferi & Congelatori';
  if (/forno|lavastoviglie|induzione|piano cottura|microonde|cappa/.test(hay)) {
    return 'Cucina & Cottura';
  }
  if (/tv|oled|qled|soundbar|playstation/.test(hay)) return 'TV & Audio';
  if (/macbook|monitor|router|fritz|stampante/.test(hay)) return 'Informatica & Rete';
  if (item.category === 'fotovoltaico' || item.category === 'clima') {
    return 'Clima & Fotovoltaico';
  }
  if (item.category === 'sicurezza') return 'Sicurezza';
  return 'Pulizia & Piccoli Elettrodomestici';
}

export const CATALOG_DEPARTMENTS: string[] = [
  'Tutti i reparti',
  'Lavaggio & Asciugatura',
  'Cucina & Cottura',
  'Frigoriferi & Congelatori',
  'TV & Audio',
  'Informatica & Rete',
  'Pulizia & Piccoli Elettrodomestici',
  'Clima & Fotovoltaico',
  'Sicurezza',
];

export function getFullArticleCatalog(): OnlineArticleSearchResult[] {
  const allCandidates: Omit<OnlineArticleSearchResult, 'id' | 'providerLabel'>[] = [
    ...USER_ELECTROLUX_AEG_PRESETS,
    ...CURATED_DEVICES.flatMap((d) => (d.catalogCandidate ? [d.catalogCandidate] : [])),
    ...SUPPLEMENTAL_SEARCH_CATALOG,
  ];
  const unique: OnlineArticleSearchResult[] = [];
  allCandidates.forEach((item, idx) => {
    const exists = unique.some(
      (u) =>
        u.brand.toLowerCase() === item.brand.toLowerCase() &&
        u.model.toLowerCase() === item.model.toLowerCase()
    );
    if (!exists) {
      unique.push({
        ...item,
        department: inferCatalogDepartment(item),
        id: `catalog_${idx}_${item.model.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        familyWarrantySuggested:
          item.familyWarrantySuggested ??
          (item.category === 'elettrodomestici' ||
            item.category === 'elettronica' ||
            item.category === 'clima'),
        providerLabel: item.pnc ? `PNC ${item.pnc}` : item.brand,
      });
    }
  });
  return unique;
}

export function saveCachedManualGuide(
  brand: string,
  model: string,
  guide: Partial<ArticleManualGuide>
): void {
  try {
    const store = getCachedManualStore();
    const key = `${brand.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
    store[key] = guide;
    localStorage.setItem(CUSTOM_GUIDES_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage quota
  }
}

export function searchArticleCatalog(rawQuery: string): OnlineArticleSearchResult[] {
  const q = rawQuery
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const fullCatalog = getFullArticleCatalog();
  if (!q) return fullCatalog;
  const compactQ = q.replace(/\s+/g, '');
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return fullCatalog;

  const scored = fullCatalog
    .map((item) => {
      const hay = `${item.name} ${item.brand} ${item.model} ${item.pnc || ''} ${item.department || ''} ${item.category} ${item.specs} ${item.description}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const compactHay = hay.replace(/\s+/g, '');
      let score = 0;
      if (hay.includes(q) || compactHay.includes(compactQ)) score += 12;
      for (const tok of tokens) {
        if (hay.includes(tok) || compactHay.includes(tok)) {
          score += 3;
        } else if (tok === 'frigo' && hay.includes('frigorif')) {
          score += 3;
        } else if (tok === 'tv' && hay.includes('tv')) {
          score += 3;
        } else if (tok === 'induzione' && hay.includes('induzion')) {
          score += 3;
        } else if (tok === 'forno' && hay.includes('forno')) {
          score += 3;
        }
      }
      return { item, score };
    })
    .filter((entry) => entry.score >= (tokens.length === 1 ? 3 : 6))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 24).map((s) => s.item);
}

const ONLINE_GUIDE_TAG_RE = /\[ONLINE_GUIDE_JSON\]([\s\S]*?)\[\/ONLINE_GUIDE_JSON\]\s*/;

export function stripOnlineGuideMarker(raw?: string): string {
  if (!raw) return '';
  return raw.replace(ONLINE_GUIDE_TAG_RE, '').trim();
}

export function extractOnlineGuideFromText(raw?: string): Partial<ArticleManualGuide> | null {
  if (!raw) return null;
  const match = raw.match(ONLINE_GUIDE_TAG_RE);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<ArticleManualGuide>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function embedOnlineGuideInExtractText(
  guide: Partial<ArticleManualGuide>,
  existingExtractText?: string
): string {
  const compactGuide: Partial<ArticleManualGuide> = {
    manualUrl: guide.manualUrl?.slice(0, 300),
    summary: guide.summary?.slice(0, 700),
    keySpecs: Array.isArray(guide.keySpecs)
      ? guide.keySpecs.slice(0, 6).map((s) => s.slice(0, 180))
      : undefined,
    quickUsage: Array.isArray(guide.quickUsage)
      ? guide.quickUsage.slice(0, 5).map((s) => s.slice(0, 180))
      : undefined,
    maintenance: Array.isArray(guide.maintenance)
      ? guide.maintenance.slice(0, 4).map((s) => s.slice(0, 180))
      : undefined,
    safetyAndEnergy: Array.isArray(guide.safetyAndEnergy)
      ? guide.safetyAndEnergy.slice(0, 4).map((s) => s.slice(0, 180))
      : undefined,
    sourceUrls: Array.isArray(guide.sourceUrls)
      ? guide.sourceUrls.slice(0, 4).map((u) => ({
          title: (u.title || 'Fonte Web').slice(0, 80),
          url: (u.url || '').slice(0, 260),
        }))
      : undefined,
    sourceType: 'online',
  };
  const block = `[ONLINE_GUIDE_JSON]${JSON.stringify(compactGuide)}[/ONLINE_GUIDE_JSON]`;
  const pdfText = stripOnlineGuideMarker(existingExtractText);
  if (!pdfText) return block.slice(0, 12_000);
  const available = Math.max(0, 12_000 - block.length - 2);
  return available > 0 ? `${block}\n\n${pdfText.slice(0, available)}` : block.slice(0, 12_000);
}

function getCachedManualStore(): Record<string, Partial<ArticleManualGuide>> {
  try {
    const raw = localStorage.getItem(CUSTOM_GUIDES_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Partial<ArticleManualGuide>>;
  } catch {
    return {};
  }
}

export function getArticleManualGuide(article: HomeArticleRecord): ArticleManualGuide {
  const { manualUrl: unpackedUrl, userNotes } = unpackArticleNotes(article.notes);
  const supportSearchUrl = buildManufacturerManualSearchUrl(article.brand, article.model);
  const cacheKey = `${article.brand.trim().toLowerCase()}|${article.model.trim().toLowerCase()}`;
  const cached = extractOnlineGuideFromText(article.manualExtractText) ?? getCachedManualStore()[cacheKey];
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
    supplemental?.description ||
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

export function extractArticleManualDetails(
  text: string,
  fileName: string
): ExtractedArticleManualDetails {
  const fileLabel = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  const cleanedFileLabel = fileLabel
    .replace(/^(?:manuale|manual|scheda tecnica|scheda|istruzioni|datasheet)\s*/i, '')
    .trim();
  const source = `${fileLabel}\n${text}`.slice(0, 20_000);
  const brands = [
    'AEG', 'Ariston', 'AVS', 'Beko', 'Bosch', 'Candy', 'Daikin', 'DeLonghi',
    'Dyson', 'Electrolux', 'Fender', 'Gibson', 'Haier', 'Hisense', 'Ibanez',
    'Indesit', 'LG', 'Miele', 'Panasonic', 'Samsung', 'Siemens', 'Sony',
    'TCL', 'Whirlpool', 'Yamaha',
  ];
  const brand =
    brands.find((candidate) =>
      new RegExp(`(^|[^a-z0-9])${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(source)
    ) || '';
  const modelMatch = source.match(
    /(?:model(?:lo)?(?:\s*(?:number|n\.?))?|type|codice\s+modello|model\s+code)\s*[:#-]?\s*([a-z0-9][a-z0-9._/-]{2,})/i
  );
  const filenameTokens = fileLabel.split(/\s+/).filter(Boolean);
  const modelFromFile = filenameTokens.find(
    (token) =>
      token.toLowerCase() !== brand.toLowerCase() &&
      token.length >= 4 &&
      /[a-z]/i.test(token) &&
      /\d/.test(token)
  );
  const model = (modelMatch?.[1] || modelFromFile || '').replace(/[.,;:]$/, '').slice(0, 80);
  const category = inferCategoryFromText(`${fileLabel} ${text.slice(0, 4000)}`);
  const room = inferRoomFromText(`${fileLabel} ${text.slice(0, 1000)}`, category);
  const productType =
    /(frigorifero|frigo)/i.test(source) ? 'Frigorifero'
    : /(piano\s+(?:a\s+)?induzione|induction hob)/i.test(source) ? 'Piano a induzione'
      : /lavastoviglie/i.test(source) ? 'Lavastoviglie'
        : /lavatrice/i.test(source) ? 'Lavatrice'
          : /chitarra/i.test(source) ? 'Chitarra'
            : '';
  const specLines = Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(
          (line) =>
            line.length >= 8 &&
            line.length <= 180 &&
            /(specifiche|potenza|capacità|dimension|consumo|classe energetica|efficienza|frequenza|voltaggio|tensione|pressione|temperatura|rumore|dB|kwh|kw\b|w\b|volt|litri|kg\b|mm\b|cm\b|pollici|giri\/min|rpm)/i.test(
              line
            )
        )
    )
  );
  const specs = (specLines.length > 0 ? specLines.join(' · ') : '').slice(0, 240);
  const genericFileLabel = /^(?:manuale?|scheda(?: tecnica)?|istruzioni|datasheet|documento)$/i.test(
    fileLabel
  );
  const name =
    (genericFileLabel
      ? [productType, brand, model].filter(Boolean).join(' ')
      : cleanedFileLabel || [productType, brand, model].filter(Boolean).join(' ')).slice(0, 80);

  return { name, brand, model, category, room, specs };
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
