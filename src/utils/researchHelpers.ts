export type ResearchRoomId =
  | 'salone'
  | 'cucina'
  | 'bagno1'
  | 'bagno2'
  | 'stanza_maurizio'
  | 'stanza_roberta'
  | 'stanza_matrimoniale'
  | 'terrazza_ovest'
  | 'terrazza_est';

export const RESEARCH_ROOMS: { id: ResearchRoomId; label: string }[] = [
  { id: 'salone', label: 'Salone' },
  { id: 'cucina', label: 'Cucina' },
  { id: 'bagno1', label: 'Bagno 1' },
  { id: 'bagno2', label: 'Bagno 2' },
  { id: 'stanza_maurizio', label: 'Stanza Maurizio' },
  { id: 'stanza_roberta', label: 'Stanza Roberta' },
  { id: 'stanza_matrimoniale', label: 'Stanza Matrimoniale' },
  { id: 'terrazza_ovest', label: 'Terrazza Ovest' },
  { id: 'terrazza_est', label: 'Terrazza Est' },
];

const ROOM_ALIASES: Record<string, ResearchRoomId> = {
  salone: 'salone',
  soggiorno: 'salone',
  cucina: 'cucina',
  bagno1: 'bagno1',
  'bagno 1': 'bagno1',
  bagno2: 'bagno2',
  'bagno 2': 'bagno2',
  stanza_maurizio: 'stanza_maurizio',
  'stanza maurizio': 'stanza_maurizio',
  maurizio: 'stanza_maurizio',
  stanza_roberta: 'stanza_roberta',
  'stanza roberta': 'stanza_roberta',
  roberta: 'stanza_roberta',
  stanza_matrimoniale: 'stanza_matrimoniale',
  'stanza matrimoniale': 'stanza_matrimoniale',
  matrimoniale: 'stanza_matrimoniale',
  terrazza_ovest: 'terrazza_ovest',
  'terrazza ovest': 'terrazza_ovest',
  'terrazzo ovest': 'terrazza_ovest',
  terrazza_est: 'terrazza_est',
  'terrazza est': 'terrazza_est',
  'terrazzo est': 'terrazza_est',
};

export function normalizeResearchRoom(raw?: string | null): ResearchRoomId | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key || key === 'nessuna' || key === 'nessuna stanza' || key === 'none') {
    return undefined;
  }
  return ROOM_ALIASES[key];
}

export function getResearchRoomLabel(raw?: string | null): string {
  const normalized = normalizeResearchRoom(raw);
  if (!normalized) return 'Nessuna stanza';
  return RESEARCH_ROOMS.find((r) => r.id === normalized)?.label || 'Nessuna stanza';
}

const NON_ROOM_PRODUCT_RE =
  /\b(?:iphone|smartphone|cellulare|telefono\s+cellulare|galaxy\s+(?:s\d|a\d|m\d|z\s*fold|z\s*flip|tab|buds|watch)|pixel\s*\d|xiaomi\s+(?:\d|redmi|poco)|redmi\s+\d|oneplus\s+\d|ipad|tablet|kindle|kobo|smartwatch|apple\s+watch|garmin|fitbit|airpods|auricolari|cuffie(?:\s+bluetooth|\s+wireless|\s+in-ear|\s+over-ear)?|power\s*bank|cover|custodia|pellicola|vetro\s+temperato|caricabatterie\s+portatile|magsafe|airtag|macbook|notebook|laptop|pc\s+portatile|chromebook|ultrabook|pneumatici|gomme\s+auto|catene\s+da\s+neve|portabici|seggiolino\s+auto|autoradio|dash\s*cam|scarpe|sneakers|stivali|sandali|giacca|giubbotto|cappotto|pantaloni|jeans|maglia|maglietta|t-shirt|felpa|camicia|vestito|gonna|zaino|valigia|trolley|borsa|portafoglio|occhiali\s+da\s+sole|bicicletta|monopattino|tosaerba|tagliaerba|decespugliatore|motosega|barbecue|ombrellone|sdraio)\b/i;

const OUTDOOR_GUARD_RE = /\b(?:da\s+)?(?:giardino|esterno|esterni|terrazzo|balcone)\b|outdoor/i;
const BOOK_GUARD_RE = /\b(?:libro|libri|ricettario|ebook|audiolibro|rivista)\b/i;

const BATHROOM_ROOM_RE =
  /\b(?:lavatrice|lavatrici|lavasciuga|asciugatrice|asciugatrici|washing\s+machine|tumble\s+dryer|colonna\s+bucato|cesta\s+(?:per\s+)?biancheria|portabiancheria|cesto\s+biancheria|stendibiancheria\s+elettrico|asse\s+da\s+stiro|mobile\s+(?:da\s+|per\s+)?bagno|mobili\s+bagno|arredo\s+bagno|sottolavabo|colonna\s+bagno|pensile\s+bagno|specchio\s+(?:da\s+)?bagno|specchiera\s+bagno|lavabo|lavandino\s+(?:da\s+)?bagno|sanitari|vaso\s+wc|wc\s+(?:sospeso|a\s+terra|filo\s+muro)|bidet|copriwater|sedile\s+wc|box\s+doccia|cabina\s+doccia|piatto\s+doccia|colonna\s+doccia|soffione\s+doccia|doccetta|saliscendi\s+doccia|parete\s+doccia|vasca\s+da\s+bagno|rubinetto\s+(?:da\s+)?bagno|miscelatore\s+(?:bagno|lavabo|bidet|doccia|vasca)|termoarredo|scaldasalviette|portasciugamani|porta\s*rotolo|portarotolo|dispenser\s+sapone|portasapone|portaspazzolini|scopino\s+wc|scopino\s+bagno|tenda\s+doccia|tappeto\s+bagno|tappetino\s+bagno|set\s+asciugamani|asciugamani\s+bagno|accappatoio|asciugacapelli|phon\s+capelli|spazzolino\s+elettrico)\b/i;

const KITCHEN_ROOM_RE =
  /\b(?:cucina(?:\s+(?:completa|lineare|angolare|componibile|modulare|moderna|classica|su\s+misura|con\s+elettrodomestici))?|cucine|mobile\s+cucina|basi\s+cucina|pensile\s+cucina|pensili\s+cucina|isola\s+cucina|penisola\s+cucina|top\s+cucina|piano\s+(?:da\s+|di\s+lavoro\s+)?cucina|alzatina\s+cucina|paraschizzi|credenza\s+(?:da\s+)?cucina|carrello\s+(?:da\s+)?cucina|tavolo\s+(?:da\s+)?cucina|sgabelli\s+(?:da\s+)?cucina|piano\s+(?:a\s+|ad\s+)?induzione|piano\s+cottura|piani\s+cottura|piano\s+(?:a\s+)?gas|induction\s+hob|forno\s+(?:da\s+incasso|elettrico|ventilato|pirolitico|a\s+vapore|a\s+microonde|pizza)|fornetto(?:\s+elettrico)?|microonde|lavastoviglie|dishwasher|frigorifero|frigoriferi|frigo(?:\s+(?:combinato|americano|side\s+by\s+side|monoporta|doppia\s+porta|da\s+incasso|sottotop))?|congelatore|freezer|abbattitore|cantinetta\s+vini|cappa(?:\s+(?:aspirante|filtrante|cucina|arredo|telescopica|sottopensile|a\s+isola|da\s+parete|ad\s+incasso))?|lavello(?:\s+cucina)?|vasca\s+lavello|miscelatore\s+(?:da\s+)?cucina|rubinetto\s+(?:da\s+)?cucina|pattumiera\s+(?:cucina|differenziata|sottolavello)|friggitrice(?:\s+ad\s+aria)?|air\s+fryer|macchina\s+(?:da|del|per)\s+caff[eè]|macchina\s+caff[eè]|nespresso|lavazza\s+a\s+modo\s+mio|tostapane|bollitore(?:\s+elettrico)?|robot\s+da\s+cucina|impastatrice|planetaria|frullatore|minipimer|estrattore\s+(?:di\s+)?succo|centrifuga|bimby|thermomix|affettatrice|bilancia\s+(?:da\s+)?cucina|montalatte|vaporiera|cuociriso|pentola|pentole|padella|padelle|casseruola|tegame|wok|bistecchiera|piastra\s+(?:per\s+)?(?:panini|waffle|crepes)|scolapiatti|portaposate|ceppo\s+coltelli|coltelli\s+da\s+cucina|servizio\s+(?:di\s+)?piatti|servizio\s+(?:di\s+)?posate|posate|tagliere)\b/i;

const LIVING_ROOM_RE =
  /\b(?:divano|divani|divano\s+letto|divano\s+angolare|sof[aà]|copridivano|poltrona(?:\s+relax|\s+reclinabile|\s+letto|\s+da\s+salotto)?|chaise\s+longue|pouf(?:\s+contenitore)?|parete\s+attrezzata|mobile\s+(?:tv|porta\s*tv|soggiorno|salotto|salone)|porta\s*tv|tavolino\s+(?:da\s+)?(?:salotto|soggiorno|fumo|caff[eè]|basso|divano)|madia|credenza\s+(?:moderna|soggiorno|salotto|design)|libreria\s+(?:soggiorno|salotto|da\s+parete|modulare)|tavolo\s+da\s+pranzo|tavolo\s+allungabile|tavolo\s+soggiorno|sedie\s+(?:da\s+)?(?:pranzo|soggiorno|salotto)|sedia\s+da\s+pranzo|consolle\s+(?:allungabile|ingresso|soggiorno)|camino|caminetto|bioetanolo|smart\s*tv|oled\s*(?:tv|evo)?|qled|qned|miniled|tv\s+\d{2}\s*(?:pollici|["”])|televisore|televisori|soundbar|home\s+theater|home\s+theatre|home\s+cinema|staffa\s+(?:a\s+muro\s+per\s+)?tv|supporto\s+tv)\b/i;

const MASTER_BEDROOM_RE =
  /\b(?:letto\s+matrimoniale|letto\s+contenitore\s+matrimoniale|testiera\s+matrimoniale|rete\s+matrimoniale|materasso\s+matrimoniale|topper\s+matrimoniale|copripiumino\s+matrimoniale|piumone\s+matrimoniale|lenzuola\s+matrimoniali|completo\s+lenzuola\s+matrimoniale|trapunta\s+matrimoniale|copriletto\s+matrimoniale|king\s*size|materasso\s+(?:160|180)\s*x\s*(?:190|200)|letto\s+(?:160|180)\s*x\s*(?:190|200))\b/i;

function extractResearchUrlSlugText(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return decodeURIComponent(u.pathname)
      .replace(/\/dp\/[A-Z0-9]{10}.*/i, '')
      .replace(/[-_/+.]+/g, ' ');
  } catch {
    return '';
  }
}

function extractStructuredSpecText(specs?: string): string {
  if (!specs) return '';
  return specs
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) =>
      /^(?:tipo(?:\s+di\s+prodotto)?|tipologia|categoria|modello|nome\s+modello|prodotto|stanza|ambiente)\s*:/i.test(
        line
      )
    )
    .join(' ');
}

function matchRoomFromProductText(text: string): ResearchRoomId | undefined {
  const clean = text.trim();
  if (!clean) return undefined;

  if (/\b(?:bagno\s*2|secondo\s+bagno)\b/i.test(clean)) return 'bagno2';
  if (/\b(?:bagno\s*1|primo\s+bagno|bagno\s+principale)\b/i.test(clean)) return 'bagno1';
  if (/\b(?:stanza|camera)\s*(?:di\s*)?maurizio\b/i.test(clean)) return 'stanza_maurizio';
  if (/\b(?:stanza|camera)\s*(?:di\s*)?roberta\b/i.test(clean)) return 'stanza_roberta';
  if (/\b(?:stanza|camera)\s*matrimoniale\b/i.test(clean)) return 'stanza_matrimoniale';
  if (/\bterrazz[ao]\s*(?:a\s*)?ovest\b/i.test(clean)) return 'terrazza_ovest';
  if (/\bterrazz[ao]\s*(?:a\s*)?est\b/i.test(clean)) return 'terrazza_est';
  if (/\bkomodo(?:\s*5)?\b/i.test(clean)) return 'terrazza_ovest';

  if (NON_ROOM_PRODUCT_RE.test(clean) || OUTDOOR_GUARD_RE.test(clean)) {
    return undefined;
  }

  if (BATHROOM_ROOM_RE.test(clean)) return 'bagno1';
  if (!BOOK_GUARD_RE.test(clean) && KITCHEN_ROOM_RE.test(clean)) return 'cucina';
  if (LIVING_ROOM_RE.test(clean)) return 'salone';
  if (MASTER_BEDROOM_RE.test(clean)) return 'stanza_matrimoniale';

  return undefined;
}

export function inferResearchRoom(input: {
  title?: string;
  url?: string;
  specs?: string;
  category?: string;
}): ResearchRoomId | undefined {
  if (input.category === 'auto' || input.category === 'abbigliamento') {
    return undefined;
  }

  const primaryText = `${input.title || ''} ${extractResearchUrlSlugText(input.url)}`.trim();
  const explicitOrKomodo = matchRoomFromProductText(primaryText);
  if (
    explicitOrKomodo === 'terrazza_ovest' ||
    explicitOrKomodo === 'terrazza_est' ||
    /\b(?:bagno\s*[12]|(?:primo|secondo)\s+bagno|bagno\s+principale|(?:stanza|camera)\s*(?:di\s*)?(?:maurizio|roberta|matrimoniale))\b/i.test(
      primaryText
    )
  ) {
    return explicitOrKomodo;
  }

  if (
    NON_ROOM_PRODUCT_RE.test(primaryText) ||
    OUTDOOR_GUARD_RE.test(`${primaryText} ${input.url || ''}`)
  ) {
    return undefined;
  }

  if (explicitOrKomodo) return explicitOrKomodo;

  const structuredSpecs = extractStructuredSpecText(input.specs);
  if (structuredSpecs && !NON_ROOM_PRODUCT_RE.test(structuredSpecs)) {
    return matchRoomFromProductText(structuredSpecs);
  }

  return undefined;
}

export interface ColorPreset {
  name: string;
  hex: string;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { name: 'Nero', hex: '#18181b' },
  { name: 'Bianco', hex: '#f8fafc' },
  { name: 'Grigio', hex: '#64748b' },
  { name: 'Antracite', hex: '#334155' },
  { name: 'Argento', hex: '#cbd5e1' },
  { name: 'Oro', hex: '#d4af37' },
  { name: 'Ottone', hex: '#b59410' },
  { name: 'Bronzo', hex: '#8c5a32' },
  { name: 'Rame', hex: '#b87333' },
  { name: 'Beige', hex: '#d6c7b2' },
  { name: 'Tortora', hex: '#9c8c7e' },
  { name: 'Marrone', hex: '#78350f' },
  { name: 'Arancione Cosmico', hex: '#e85d24' },
  { name: 'Arancione', hex: '#f97316' },
  { name: 'Rosso', hex: '#dc2626' },
  { name: 'Borgogna', hex: '#7f1d1d' },
  { name: 'Rosa', hex: '#ec4899' },
  { name: 'Viola', hex: '#7c3aed' },
  { name: 'Blu', hex: '#2563eb' },
  { name: 'Blu Notte', hex: '#1e3a8a' },
  { name: 'Azzurro', hex: '#0ea5e9' },
  { name: 'Verde', hex: '#16a34a' },
  { name: 'Verde Salvia', hex: '#7d9b76' },
  { name: 'Giallo', hex: '#eab308' },
];

const COLOR_KEYWORDS: [RegExp, string][] = [
  [/arancione\s*cosmico|cosmic\s*orange/i, '#e85d24'],
  [/oro\s*rosa|rose\s*gold|rame\s*rosato/i, '#e0a99b'],
  [/titanio\s*naturale|natural\s*titanium/i, '#a8a29e'],
  [/titanio\s*sabbia|desert\s*titanium|champagne/i, '#c9b18e'],
  [/titanio\s*nero|black\s*titanium|space\s*black|nero\s*siderale|ossidiana/i, '#18181b'],
  [/titanio\s*bianco|white\s*titanium/i, '#f1f5f9'],
  [/titanio|titanium/i, '#8e8a84'],
  [/blu\s*notte|mezzanotte|midnight|navy|blu\s*scuro/i, '#1e3a8a'],
  [/verde\s*salvia|salvia|sage/i, '#7d9b76'],
  [/verde\s*oliva|oliva|olive/i, '#556b2f'],
  [/verde\s*bosco|smeraldo|emerald|forest|giungla/i, '#15803d'],
  [/agave/i, '#6d7e60'],
  [/avocado/i, '#687d47'],
  [/glacier|ice\s*blue|blu\s*ghiaccio/i, '#93c5fd'],
  [/azzurro|celeste|sky|ciano|cyan|ghiaccio/i, '#0ea5e9'],
  [/turchese|ottanio|petrolio|teal|adriatic/i, '#0f766e'],
  [/borgogna|bordeaux|burgundy|vinaccia|amaranto|vino|wine/i, '#7f1d1d'],
  [/terracotta|mattone|corallo/i, '#c25e3e'],
  [/arancione|arancio|orange/i, '#f97316'],
  [/fucsia|magenta/i, '#d946ef'],
  [/rosa|pink|cipria|pesca/i, '#ec4899'],
  [/viola|purple|lavanda|lilla|prugna|melanzana|violet/i, '#7c3aed'],
  [/rosso|red|scarlatto|ciliegia|rubino/i, '#dc2626'],
  [/blu|blue|oltremare|cobalto|zaffiro|denim/i, '#2563eb'],
  [/verde|green|menta/i, '#16a34a'],
  [/giallo|yellow|senape|ocra|limone|amber|ambra/i, '#eab308'],
  [/ottone|brass/i, '#b59410'],
  [/oro|dorato|gold/i, '#d4af37'],
  [/rame|copper/i, '#b87333'],
  [/bronzo|bronze/i, '#8c5a32'],
  [/argento|silver|inox|acciaio|cromo|cromato|nichel|nickel|platino|satinato|alluminio/i, '#cbd5e1'],
  [/antracite|grafite|carbone|piombo|ardesia|charcoal/i, '#334155'],
  [/tortora|taupe/i, '#9c8c7e'],
  [/cemento|pietra|grigio|grey|gray|siderale/i, '#64748b'],
  [/avorio|panna|crema|ecru|écru|latte|perla|off[- ]?white/i, '#f5f0e1'],
  [/beige|sabbia|sand|linen|lino|corda|canvas|panama/i, '#d6c7b2'],
  [/legno|rovere|noce|quercia|faggio|bamb[uù]|teak|castagno|weng[eé]|marrone|brown|cuoio|cognac|caff[eè]|cioccolato|tabacco/i, '#78350f'],
  [/bianco|white|transparent|trasparente|vetro|cristallo/i, '#f8fafc'],
  [/nero|black|ebano/i, '#18181b'],
];

export function resolveColorHex(colorText?: string): string {
  const raw = (colorText || '').trim();
  if (!raw) return '#94a3b8';

  const hexMatch = raw.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (hexMatch) {
    const code = hexMatch[1];
    if (code.length === 3) {
      return `#${code[0]}${code[0]}${code[1]}${code[1]}${code[2]}${code[2]}`.toLowerCase();
    }
    return `#${code.toLowerCase()}`;
  }

  for (const [pattern, hex] of COLOR_KEYWORDS) {
    if (pattern.test(raw)) return hex;
  }

  // Deterministic pleasant muted fallback based on string hash
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  const palette = [
    '#38bdf8',
    '#a78bfa',
    '#f472b6',
    '#fb923c',
    '#34d399',
    '#facc15',
    '#94a3b8',
  ];
  return palette[hash % palette.length];
}

export function findColorNameForHex(hex: string): string | undefined {
  const norm = hex.trim().toLowerCase();
  return COLOR_PRESETS.find((p) => p.hex.toLowerCase() === norm)?.name;
}

const MARKETPLACE_OR_GENERIC_BRANDS = new Set([
  'amazon',
  'amazon.it',
  'amazon.com',
  'amazon renewed',
  'amazon ricondizionato',
  'ricondizionato',
  'renewed',
  'mediaworld',
  'unieuro',
  'euronics',
  'ebay',
  'aliexpress',
  'subito',
  'eprice',
  'generico',
  'generic',
  'senza marca',
  'unbranded',
  'altro',
  'n/a',
  'na',
  'sconosciuto',
  'unknown',
]);

const AMAZON_OWN_HARDWARE_RE =
  /\b(?:amazon\s+basics|amazonbasics|kindle|echo\s+(?:dot|show|pop|spot|studio|auto|flex|hub|frames)|fire\s+(?:tv|hd|stick)|ring\s+(?:video|doorbell|chime|alarm|cam)|blink\s+(?:outdoor|indoor|mini)|eero)\b/i;

const KNOWN_BRAND_RULES: [RegExp, string][] = [
  [/\b(?:apple|iphone|ipad|macbook|imac|mac\s+mini|mac\s+studio|airpods|airtag|homepod|magsafe|techwoven|finewoven)\b/i, 'Apple'],
  [/\b(?:samsung|galaxy\s+(?:s\d|a\d|m\d|z\s*fold|z\s*flip|tab|buds|watch|book)|odyssey|the\s+frame)\b/i, 'Samsung'],
  [/\b(?:dyson|airwrap|supersonic|corrale|airstrait|gen5detect|v15\s+detect|v12\s+detect)\b/i, 'Dyson'],
  [/\b(?:electrolux)\b/i, 'Electrolux'],
  [/\b(?:aeg)\b/i, 'AEG'],
  [/\b(?:philips|hue|sonicare|ambilight|lumea|senseo|oneblade)\b/i, 'Philips'],
  [/\b(?:sony|playstation|ps5|ps4|bravia|dualsense|xperia)\b/i, 'Sony'],
  [/\b(?:lg\b|oled\s+evo|qned|lg\s+gram)\b/i, 'LG'],
  [/\b(?:bosch)\b/i, 'Bosch'],
  [/\b(?:siemens)\b/i, 'Siemens'],
  [/\b(?:miele)\b/i, 'Miele'],
  [/\b(?:whirlpool)\b/i, 'Whirlpool'],
  [/\b(?:hotpoint|ariston\s+hotpoint)\b/i, 'Hotpoint'],
  [/\b(?:indesit)\b/i, 'Indesit'],
  [/\b(?:beko)\b/i, 'Beko'],
  [/\b(?:candy)\b/i, 'Candy'],
  [/\b(?:haier)\b/i, 'Haier'],
  [/\b(?:hisense)\b/i, 'Hisense'],
  [/\b(?:tcl)\b/i, 'TCL'],
  [/\b(?:smeg)\b/i, 'Smeg'],
  [/\b(?:de['’ ]?longhi|delonghi|magnifica|dinamica)\b/i, "De'Longhi"],
  [/\b(?:nespresso)\b/i, 'Nespresso'],
  [/\b(?:lavazza)\b/i, 'Lavazza'],
  [/\b(?:bialetti)\b/i, 'Bialetti'],
  [/\b(?:kitchenaid)\b/i, 'KitchenAid'],
  [/\b(?:kenwood)\b/i, 'Kenwood'],
  [/\b(?:oral[- ]?b)\b/i, 'Oral-B'],
  [/\b(?:braun)\b/i, 'Braun'],
  [/\b(?:rowenta)\b/i, 'Rowenta'],
  [/\b(?:tefal)\b/i, 'Tefal'],
  [/\b(?:moulinex)\b/i, 'Moulinex'],
  [/\b(?:ariete)\b/i, 'Ariete'],
  [/\b(?:imetec)\b/i, 'Imetec'],
  [/\b(?:ninja)\b/i, 'Ninja'],
  [/\b(?:shark)\b/i, 'Shark'],
  [/\b(?:irobot|roomba)\b/i, 'iRobot'],
  [/\b(?:roborock)\b/i, 'Roborock'],
  [/\b(?:dreame)\b/i, 'Dreame'],
  [/\b(?:ecovacs|deebot)\b/i, 'Ecovacs'],
  [/\b(?:k[aä]rcher)\b/i, 'Kärcher'],
  [/\b(?:vorwerk|folletto|bimby)\b/i, 'Vorwerk'],
  [/\b(?:xiaomi|redmi|poco|mijia)\b/i, 'Xiaomi'],
  [/\b(?:google\s+(?:pixel|nest|tv)|pixel\s+\d|chromecast)\b/i, 'Google'],
  [/\b(?:huawei|fusionsolar)\b/i, 'Huawei'],
  [/\b(?:oneplus)\b/i, 'OnePlus'],
  [/\b(?:oppo)\b/i, 'Oppo'],
  [/\b(?:motorola|moto\s+g|razr)\b/i, 'Motorola'],
  [/\b(?:nothing\s+(?:phone|ear))\b/i, 'Nothing'],
  [/\b(?:garmin|fenix|forerunner)\b/i, 'Garmin'],
  [/\b(?:fitbit)\b/i, 'Fitbit'],
  [/\b(?:bose|quietcomfort|soundlink)\b/i, 'Bose'],
  [/\b(?:jbl)\b/i, 'JBL'],
  [/\b(?:sonos)\b/i, 'Sonos'],
  [/\b(?:marshall)\b/i, 'Marshall'],
  [/\b(?:sennheiser)\b/i, 'Sennheiser'],
  [/\b(?:anker|soundcore|eufy)\b/i, 'Anker'],
  [/\b(?:belkin)\b/i, 'Belkin'],
  [/\b(?:logitech)\b/i, 'Logitech'],
  [/\b(?:spigen)\b/i, 'Spigen'],
  [/\b(?:otterbox)\b/i, 'OtterBox'],
  [/\b(?:torras)\b/i, 'TORRAS'],
  [/\b(?:hp|hewlett[- ]?packard|omen|pavilion|envy)\b/i, 'HP'],
  [/\b(?:dell|alienware|xps)\b/i, 'Dell'],
  [/\b(?:lenovo|thinkpad|ideapad|yoga)\b/i, 'Lenovo'],
  [/\b(?:asus|zenbook|vivobook|rog)\b/i, 'Asus'],
  [/\b(?:acer|predator|nitro)\b/i, 'Acer'],
  [/\b(?:msi)\b/i, 'MSI'],
  [/\b(?:nintendo|joy[- ]?con)\b/i, 'Nintendo'],
  [/\b(?:dji|mavic|osmo)\b/i, 'DJI'],
  [/\b(?:gopro)\b/i, 'GoPro'],
  [/\b(?:canon)\b/i, 'Canon'],
  [/\b(?:nikon)\b/i, 'Nikon'],
  [/\b(?:fujifilm)\b/i, 'Fujifilm'],
  [/\b(?:tp[- ]?link|tapo|deco)\b/i, 'TP-Link'],
  [/\b(?:fritz!?(?:box|repeater)|avm)\b/i, 'AVM FRITZ!'],
  [/\b(?:netgear)\b/i, 'Netgear'],
  [/\b(?:ubiquiti|unifi)\b/i, 'Ubiquiti'],
  [/\b(?:synology)\b/i, 'Synology'],
  [/\b(?:sandisk)\b/i, 'SanDisk'],
  [/\b(?:crucial)\b/i, 'Crucial'],
  [/\b(?:seagate)\b/i, 'Seagate'],
  [/\b(?:western\s+digital)\b/i, 'Western Digital'],
  [/\b(?:ariston|lydos|velis|nimbus)\b/i, 'Ariston'],
  [/\b(?:daikin)\b/i, 'Daikin'],
  [/\b(?:rehau|neasmart)\b/i, 'REHAU'],
  [/\b(?:artemide)\b/i, 'Artemide'],
  [/\b(?:flos)\b/i, 'Flos'],
  [/\b(?:foscarini)\b/i, 'Foscarini'],
  [/\b(?:kartell)\b/i, 'Kartell'],
  [/\b(?:luceplan)\b/i, 'Luceplan'],
  [/\b(?:ideal\s*lux)\b/i, 'Ideal Lux'],
  [/\b(?:eglo)\b/i, 'Eglo'],
  [/\b(?:slamp)\b/i, 'Slamp'],
  [/\b(?:ferroluce)\b/i, 'Ferroluce'],
  [/\b(?:ledvance)\b/i, 'Ledvance'],
  [/\b(?:osram)\b/i, 'Osram'],
  [/\b(?:grohe)\b/i, 'Grohe'],
  [/\b(?:hansgrohe)\b/i, 'Hansgrohe'],
  [/\b(?:geberit)\b/i, 'Geberit'],
  [/\b(?:ideal\s*standard)\b/i, 'Ideal Standard'],
  [/\b(?:bticino)\b/i, 'BTicino'],
  [/\b(?:vimar)\b/i, 'Vimar'],
  [/\b(?:gewiss)\b/i, 'Gewiss'],
  [/\b(?:makita)\b/i, 'Makita'],
  [/\b(?:dewalt)\b/i, 'DeWalt'],
  [/\b(?:milwaukee)\b/i, 'Milwaukee'],
  [/\b(?:einhell)\b/i, 'Einhell'],
  [/\b(?:ryobi)\b/i, 'Ryobi'],
  [/\b(?:black\s*\+\s*decker|black\s*and\s*decker)\b/i, 'Black+Decker'],
  [/\b(?:stanley)\b/i, 'Stanley'],
  [/\b(?:dremel)\b/i, 'Dremel'],
  [/\b(?:thule)\b/i, 'Thule'],
  [/\b(?:brembo)\b/i, 'Brembo'],
  [/\b(?:michelin)\b/i, 'Michelin'],
  [/\b(?:pirelli)\b/i, 'Pirelli'],
  [/\b(?:maisons\s*du\s*monde)\b/i, 'Maisons du Monde'],
  [/\b(?:zara\s*home)\b/i, 'Zara Home'],
  [/\b(?:westwing)\b/i, 'Westwing'],
  [/\b(?:kave\s*home)\b/i, 'Kave Home'],
  [/\b(?:sklum)\b/i, 'Sklum'],
  [/\b(?:mondo\s*convenienza)\b/i, 'Mondo Convenienza'],
  [/\b(?:nardi|nardi\s*outdoor|nardioutdoor)\b/i, 'Nardi'],
  [/\b(?:ikea)\b/i, 'IKEA'],
];

const MONO_BRAND_STORES = new Set([
  'Maisons du Monde',
  'Zara Home',
  'Westwing',
  'Kave Home',
  'Sklum',
  'Mondo Convenienza',
  'Conforama',
  'CASA',
  'JYSK',
  'IKEA',
  'Electrolux',
  'AEG',
  'Dyson',
  'Apple',
  'Samsung',
  'Philips',
  'Bosch',
]);

export function normalizeBrandName(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let cleaned = raw
    .trim()
    .replace(/^(?:visita\s+lo\s+store\s+di|marca:|brand:|produttore:)\s*/i, '')
    .replace(/\s+store$/i, '')
    .trim();
  if (!cleaned) return undefined;
  const low = cleaned.toLowerCase();
  if (MARKETPLACE_OR_GENERIC_BRANDS.has(low)) return undefined;
  for (const [pattern, canonical] of KNOWN_BRAND_RULES) {
    if (pattern.test(cleaned) && cleaned.length <= canonical.length + 12) {
      return canonical;
    }
  }
  return cleaned.slice(0, 60);
}

export function inferProductBrand(input: {
  title?: string;
  url?: string;
  store?: string;
  brand?: string;
  specs?: string;
}): string | undefined {
  const combinedText = `${input.title || ''} ${input.url || ''} ${input.specs || ''}`;

  // Always check explicit real brand first if it's not a marketplace placeholder
  const cleanExplicit = normalizeBrandName(input.brand);
  if (cleanExplicit) {
    return cleanExplicit;
  }

  // Amazon Basics / Echo / Kindle / Ring / Blink / Eero are genuine Amazon brand devices
  if (AMAZON_OWN_HARDWARE_RE.test(combinedText)) {
    return 'Amazon';
  }

  // Detect brand from title / URL / specs keywords
  for (const [pattern, canonical] of KNOWN_BRAND_RULES) {
    if (pattern.test(combinedText)) {
      return canonical;
    }
  }

  // Fallback to mono-brand direct storefronts (e.g. Maisons du Monde, IKEA, Dyson)
  if (input.store && MONO_BRAND_STORES.has(input.store.trim())) {
    return input.store.trim();
  }

  return undefined;
}

function escapeRegExpChars(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatVariantReplacement(matched: string, nextValue: string): string {
  const cleanNext = nextValue.trim();
  if (!cleanNext) return matched;
  if (
    /^\p{Lu}/u.test(matched) &&
    /^\p{Ll}/u.test(cleanNext)
  ) {
    return cleanNext.charAt(0).toUpperCase() + cleanNext.slice(1);
  }
  return cleanNext;
}

const FALLBACK_TITLE_COLORS: string[] = [
  'Arancione cosmico',
  'Blu profondo',
  'Blu notte',
  'Verde salvia',
  'Oro rosa',
  'Titanio naturale',
  'Titanio sabbia',
  'Titanio bianco',
  'Titanio nero',
  'Galassia',
  'Mezzanotte',
  'Starlight',
  'Midnight',
  'Borgogna',
  'Bordeaux',
  'Glacier',
  'Argento',
  'Antracite',
  'Azzurro',
  'Arancione',
  'Tortora',
  'Corallo',
  'Lavanda',
  'Siderale',
  'Grafite',
  'Nero',
  'Bianco',
  'Rosso',
  'Giallo',
  'Viola',
  'Verde',
  'Beige',
  'Bronzo',
  'Grigio',
  'Salvia',
  'Blu',
  'Rosa',
  'Oro',
];

export function replaceColorInTitle(
  title: string,
  nextColor: string,
  prevColor?: string,
  availableColors?: string[]
): string {
  const cleanTitle = title.trim();
  const cleanNext = nextColor.trim();
  if (!cleanTitle || !cleanNext) return title;

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (val?: string) => {
    const trimmed = (val || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  pushCandidate(prevColor);
  const sortedAvailable = [...(availableColors || [])]
    .map((c) => c.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const col of sortedAvailable) pushCandidate(col);
  for (const col of FALLBACK_TITLE_COLORS) pushCandidate(col);

  for (const cand of candidates) {
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escapeRegExpChars(cand)})(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    );
    if (re.test(cleanTitle)) {
      return cleanTitle.replace(
        re,
        (_full, prefix: string, matched: string) =>
          `${prefix}${formatVariantReplacement(matched, cleanNext)}`
      );
    }
  }

  return title;
}

export function replaceSizeInTitle(
  title: string,
  nextSize: string,
  prevSize?: string,
  availableSizes?: string[]
): string {
  const cleanTitle = title.trim();
  const cleanNext = nextSize.trim();
  if (!cleanTitle || !cleanNext) return title;

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (val?: string) => {
    const trimmed = (val || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  pushCandidate(prevSize);
  const sortedAvailable = [...(availableSizes || [])]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const sz of sortedAvailable) pushCandidate(sz);

  for (const cand of candidates) {
    const pattern = escapeRegExpChars(cand)
      .replace(/\\?\s+/g, '\\s*')
      .replace(/(\d)([a-zA-Z])/g, '$1\\s*$2');
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${pattern})(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    );
    if (re.test(cleanTitle)) {
      return cleanTitle.replace(re, (_full, prefix: string) => `${prefix}${cleanNext}`);
    }
  }

  // Unit-family fallback (e.g. title has "128GB" and user switches to "256 GB" without prior size)
  if (/^\d+(?:[.,]\d+)?\s*(?:tb|gb|mb)$/i.test(cleanNext)) {
    const storageRe = /(^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?\s*(?:TB|GB|MB))(?=$|[^\p{L}\p{N}])/iu;
    if (storageRe.test(cleanTitle)) {
      return cleanTitle.replace(storageRe, (_full, prefix: string) => `${prefix}${cleanNext}`);
    }
  } else if (/^\d+(?:[.,]\d+)?\s*(?:cm|mm)$/i.test(cleanNext)) {
    const lenRe = /(^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?\s*(?:cm|mm))(?=$|[^\p{L}\p{N}])/iu;
    if (lenRe.test(cleanTitle)) {
      return cleanTitle.replace(lenRe, (_full, prefix: string) => `${prefix}${cleanNext}`);
    }
  } else if (/^\d+(?:[.,]\d+)?\s*(?:kg|gr|g)$/i.test(cleanNext)) {
    const weightRe = /(^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?\s*(?:kg|gr|g))(?=$|[^\p{L}\p{N}])/iu;
    if (weightRe.test(cleanTitle)) {
      return cleanTitle.replace(weightRe, (_full, prefix: string) => `${prefix}${cleanNext}`);
    }
  } else if (/^\d+(?:[.,]\d+)?\s*(?:ml|lt|l)$/i.test(cleanNext)) {
    const volRe = /(^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?\s*(?:ml|lt|l))(?=$|[^\p{L}\p{N}])/iu;
    if (volRe.test(cleanTitle)) {
      return cleanTitle.replace(volRe, (_full, prefix: string) => `${prefix}${cleanNext}`);
    }
  }

  return title;
}

export function sanitizeColorImagesMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 24) break;
    const cleanKey = String(k).replace(/\s+/g, ' ').trim().slice(0, 60);
    const cleanVal = typeof v === 'string' ? v.trim().slice(0, 1000) : '';
    if (!cleanKey || !/^https?:\/\/.+/.test(cleanVal)) continue;
    out[cleanKey] = cleanVal;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function findColorImageUrl(
  colorImages: Record<string, string> | undefined,
  color?: string
): string | undefined {
  if (!colorImages || !color) return undefined;
  const target = color.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!target) return undefined;
  const entries = Object.entries(colorImages).filter(
    ([k, v]) => Boolean(k.trim()) && typeof v === 'string' && /^https?:\/\/.+/.test(v.trim())
  );
  if (entries.length === 0) return undefined;
  const exact = entries.find(([k]) => k.trim().toLowerCase().replace(/\s+/g, ' ') === target);
  if (exact) return exact[1].trim();
  const partial = entries.find(([k]) => {
    const kNorm = k.trim().toLowerCase().replace(/\s+/g, ' ');
    return kNorm.includes(target) || target.includes(kNorm);
  });
  return partial ? partial[1].trim() : undefined;
}

export function sanitizeSizePricesMap(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 24) break;
    const cleanKey = String(k).replace(/\s+/g, ' ').trim().slice(0, 60);
    const num = typeof v === 'number' ? v : Number(v);
    if (!cleanKey || !Number.isFinite(num) || num < 0 || num > 1_000_000) continue;
    out[cleanKey] = Math.round(num * 100) / 100;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function findSizePrice(
  sizePrices: Record<string, number> | undefined,
  size?: string
): number | undefined {
  if (!sizePrices || !size) return undefined;
  const targetTrim = size.trim().toLowerCase().replace(/\s+/g, ' ');
  const targetCompact = targetTrim.replace(/\s+/g, '');
  if (!targetCompact) return undefined;
  const entries = Object.entries(sizePrices).filter(
    ([k, v]) => Boolean(k.trim()) && typeof v === 'number' && Number.isFinite(v) && v >= 0
  );
  if (entries.length === 0) return undefined;
  const exact = entries.find(
    ([k]) => k.trim().toLowerCase().replace(/\s+/g, ' ') === targetTrim
  );
  if (exact) return exact[1];
  const compactMatch = entries.find(
    ([k]) => k.trim().toLowerCase().replace(/\s+/g, '') === targetCompact
  );
  return compactMatch ? compactMatch[1] : undefined;
}
