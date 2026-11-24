import {
  CarDocumentSlotType,
  CarInsuranceCoverage,
  CarInsurancePolicy,
  CarProfile,
} from '../types/home';
import { parseItNumber } from './billImporter';

export interface InsuranceGlossaryEntry {
  id: string;
  term: string;
  shortTag: string;
  summary: string;
  whyItMatters: string;
}

export const INSURANCE_GLOSSARY: InsuranceGlossaryEntry[] = [
  {
    id: 'rca',
    term: 'RCA (Responsabilità Civile Auto)',
    shortTag: 'Obbligatoria per legge',
    summary:
      'È la copertura base senza cui l’auto non può circolare né restare parcheggiata su strada pubblica. Paga i danni fisici e materiali causati ad ALTRE persone, altri veicoli o cose se provochi un incidente.',
    whyItMatters:
      'Attenzione: l’RCA NON paga i danni alla tua auto né le lesioni di chi era alla guida con colpa (per questo esistono garanzie extra come Infortuni al Conducente o Kasko).',
  },
  {
    id: 'infortuni_conducente',
    term: 'Infortuni al conducente',
    shortTag: 'Protegge chi guida',
    summary:
      'Mentre l’RCA tutela i passeggeri e gli altri automobilisti, chi è al volante e causa un incidente resta scoperto dall’RCA base. Questa garanzia rimborsa spese mediche, invalidità o indennizzi proprio per il guidatore.',
    whyItMatters:
      'Con ~25 €/anno è una delle garanzie accessorie più utili perché copre l’unico occupante dell’auto non protetto dalla legge RCA.',
  },
  {
    id: 'tutela_legale',
    term: 'Tutela Legale',
    shortTag: 'Avvocati & periti',
    summary:
      'Copre le spese di avvocato, periti tecnici e costi processuali in caso di contestazioni su un incidente, ritiro/sospensione patente, ricorsi per multe o procedimenti penali stradali.',
    whyItMatters:
      'Evita di dover pagare di tasca propria parcelle legali costose quando la dinamica di un sinistro è contestata.',
  },
  {
    id: 'assistenza_stradale',
    term: 'Assistenza stradale',
    shortTag: 'Carro attrezzi H24',
    summary:
      'Garantisce l’intervento del carro attrezzi, soccorso sul posto (batteria scarica, foratura, guasto) e traino fino all’officina in caso di fermo improvviso.',
    whyItMatters:
      'Un singolo traino in autostrada o fuori città costa facilmente 150–250 €, molto più dell’intero costo annuale della garanzia.',
  },
  {
    id: 'protezione_satellitare',
    term: 'Protezione Satellitare (Scatola Nera / GPS)',
    shortTag: 'GPS & tracciamento',
    summary:
      'Prevede un dispositivo GPS installato a bordo (o app/box ConTe) che rileva la posizione, ricostruisce eventuali urti/sinistri e aiuta il recupero in caso di furto o emergenza.',
    whyItMatters:
      'In caso di incidente con dinamica dubbia fornisce la prova oggettiva dei movimenti e riduce il rischio di truffe o rincari ingiustificati.',
  },
  {
    id: 'bonus_malus_cu',
    term: 'Bonus Malus, Classe CU e Classe Admiral',
    shortTag: 'Classi di merito (1 migliore → 18)',
    summary:
      'La Classe CU (Conversione Universale) è la classe ufficiale valida in TUTTE le compagnie italiane (va da 18 a 1: più è bassa, meno paghi). Ogni anno senza incidenti con colpa scendi di 1 classe; con un sinistro con colpa sali di 2.',
    whyItMatters:
      'La "Classe interna Admiral" (gruppo di ConTe.it) è invece la scala interna usata solo da ConTe per calcolare la tua tariffa: al cambio compagnia fa fede solo la Classe CU.',
  },
  {
    id: 'attestato_rischio',
    term: 'Attestato di Rischio (ATR)',
    shortTag: 'Pagella ultimi 5–10 anni',
    summary:
      'È il documento digitale ufficiale (consultabile anche in banca dati ANIA) che certifica la tua Classe CU e il numero di sinistri con o senza colpa negli ultimi anni.',
    whyItMatters:
      'Viene rilasciato circa 30 giorni prima della scadenza e ti permette di fare preventivi con altre compagnie senza dover portare carta.',
  },
  {
    id: 'decorrenza_comporto',
    term: 'Decorrenza, Scadenza e 15 giorni di tolleranza',
    shortTag: 'Durata & rinnovo',
    summary:
      'La Decorrenza è il giorno in cui inizia la copertura (20 Novembre 2026) e la Scadenza è l’ultimo giorno valido (20 Novembre 2027). In Italia le polizze annuali RCA non hanno rinnovo tacito automatico, ma godono di 15 giorni di copertura extra dopo la scadenza.',
    whyItMatters:
      'Il periodo di comporto di 15 giorni vale solo per l’RCA in Italia (non per l’estero o garanzie accessorie); conviene sempre rinnovare o cambiare prima della scadenza.',
  },
  {
    id: 'soggetti_polizza',
    term: 'Proprietario, Contraente e Conducente Principale',
    shortTag: 'Chi firma vs chi guida',
    summary:
      'Il Contraente è chi stipula e paga la polizza; il Proprietario è l’intestatario al PRA/libretto; il Conducente Principale è chi usa abitualmente l’auto. In questa polizza coincidono tutti in Roberta Dell’Angelo.',
    whyItMatters:
      'Frazionamento "Annuale" significa pagamento in un’unica rata all’anno (di solito costa meno rispetto al pagamento semestrale o mensile).',
  },
  {
    id: 'dichiarazioni_rivalsa',
    term: 'Modifiche veicolo, Km annui e Ricovero notturno',
    shortTag: 'Attenzione alle clausole',
    summary:
      'I dati dichiarati (es. Box, 5.000 km/anno, antifurto, modifiche veicolo = Sì) servono a calcolare il rischio. Se si verifica un sinistro e un dato dichiarato è falso (es. modifica non dichiarata o guida in stato di ebbrezza), la compagnia può esercitare la "rivalsa" chiedendo indietro parte del risarcimento.',
    whyItMatters:
      'Qui è già dichiarato "Modifiche veicolo: Sì" e "Box": tieni sempre aggiornati i dati reali in caso di variazioni importanti.',
  },
];

export interface CarDocumentSlotInfo {
  slotType: CarDocumentSlotType;
  title: string;
  categoryHint: string;
  description: string;
  requiredInCar: boolean;
}

export const CAR_DOCUMENT_SLOTS: CarDocumentSlotInfo[] = [
  {
    slotType: 'certificato_assicurazione',
    title: 'Certificato di Assicurazione',
    categoryHint: 'Da tenere in auto (PDF su telefono o stampato)',
    description:
      'Documento ufficiale che prova che l’auto è assicurata per la circolazione su strada. Va esibito in caso di controllo delle Forze dell’Ordine.',
    requiredInCar: true,
  },
  {
    slotType: 'attestato_rischio',
    title: 'Attestato di Rischio (ATR)',
    categoryHint: 'Storico sinistri & Classe CU',
    description:
      'Documento annuale con Classe CU, Classe interna e storia sinistri degli ultimi anni: indispensabile per confrontare preventivi al rinnovo.',
    requiredInCar: false,
  },
  {
    slotType: 'polizza_contratto',
    title: 'Contratto / Riepilogo Polizza ConTe',
    categoryHint: 'Massimali, garanzie e condizioni',
    description:
      'Fascicolo contrattuale con dettaglio premi, massimali RCA, eventuali franchigie, numeri assistenza stradale e clausole.',
    requiredInCar: false,
  },
  {
    slotType: 'carta_verde',
    title: 'Carta Verde (Certificato Internazionale)',
    categoryHint: 'Per viaggi all’estero',
    description:
      'Certificato internazionale di assicurazione necessario per circolare in alcuni Paesi extra-UE (es. Svizzera/Balcani a seconda della copertura).',
    requiredInCar: false,
  },
  {
    slotType: 'quietanza',
    title: 'Quietanza / Ricevuta Pagamento',
    categoryHint: 'Prova del pagamento premio',
    description:
      'Ricevuta fiscale/bancaria del premio versato (€ 511,32) valida per eventuali verifiche amministrative o rimborsi.',
    requiredInCar: false,
  },
  {
    slotType: 'libretto_circolazione',
    title: 'Libretto / Revisione / Bollo',
    categoryHint: 'Carta di circolazione & tagliando revisione',
    description:
      'Copia digitale del Documento Unico / Carta di Circolazione, certificato ultima revisione o ricevuta pagamento bollo auto.',
    requiredInCar: true,
  },
];

const ITALIAN_MONTHS: Record<string, string> = {
  gennaio: '01',
  febbraio: '02',
  marzo: '03',
  aprile: '04',
  maggio: '05',
  giugno: '06',
  luglio: '07',
  agosto: '08',
  settembre: '09',
  ottobre: '10',
  novembre: '11',
  dicembre: '12',
};

function normalizeDateToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const slash = trimmed.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const dd = slash[1].padStart(2, '0');
    const mm = slash[2].padStart(2, '0');
    const yyyy = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${dd}/${mm}/${yyyy}`;
  }
  const verbal = trimmed.match(
    /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i
  );
  if (verbal) {
    const dd = verbal[1].padStart(2, '0');
    const mm = ITALIAN_MONTHS[verbal[2].toLowerCase()] || '01';
    return `${dd}/${mm}/${verbal[3]}`;
  }
  return undefined;
}

export function inferCarDocumentSlot(
  fileName: string,
  text = '',
  fallback: CarDocumentSlotType = 'altro'
): CarDocumentSlotType {
  const hay = `${fileName} ${text.slice(0, 2500)}`.toLowerCase();
  if (/attestato\s+di\s+rischio|classe\s+di\s+merito.*sinistri/i.test(hay)) {
    return 'attestato_rischio';
  }
  if (/carta\s+verde|international\s+motor\s+insurance/i.test(hay)) {
    return 'carta_verde';
  }
  if (/certificato\s+di\s+assicurazione|certificato\s+assicurativo|contrassegno/i.test(hay)) {
    return 'certificato_assicurazione';
  }
  if (/quietanza|ricevuta\s+di\s+pagamento/i.test(hay)) {
    return 'quietanza';
  }
  if (/libretto|carta\s+di\s+circolazione|revisione|bollo\s+auto|tassa\s+automobilistica/i.test(hay)) {
    return 'libretto_circolazione';
  }
  if (/polizza|condizioni\s+di\s+assicurazione|riepilogo\s+polizza|conte\.it|admiral/i.test(hay)) {
    return 'polizza_contratto';
  }
  return fallback;
}

export interface ParsedCarDocumentResult {
  detectedSlotType: CarDocumentSlotType;
  documentTitle: string;
  provider: string;
  issueDate?: string;
  expiryDate?: string;
  referenceCode?: string;
  policyPatch: Partial<CarInsurancePolicy>;
  profilePatch: Partial<CarProfile>;
  extractedSummary: string[];
}

export function parseCarDocumentText(
  rawText: string,
  fileName: string,
  chosenSlot: CarDocumentSlotType
): ParsedCarDocumentResult {
  const cleanText = rawText.replace(/\u00a0/g, ' ');
  const combined = `${fileName}\n${cleanText}`;
  const detectedSlotType =
    chosenSlot !== 'altro' ? chosenSlot : inferCarDocumentSlot(fileName, cleanText, 'polizza_contratto');

  const slotMeta = CAR_DOCUMENT_SLOTS.find((s) => s.slotType === detectedSlotType);
  const extractedSummary: string[] = [];
  const policyPatch: Partial<CarInsurancePolicy> = {};
  const profilePatch: Partial<CarProfile> = {};

  // Company
  const companies: [RegExp, string][] = [
    [/\bconte(?:\.it)?\b|admiral/i, 'ConTe.it'],
    [/\bprima(?:\s+assicurazioni)?\b/i, 'Prima Assicurazioni'],
    [/\bunipol(?:sai)?\b/i, 'UnipolSai'],
    [/\ballianz\b/i, 'Allianz'],
    [/\bgenerali\b/i, 'Generali'],
    [/\blinear\b/i, 'Linear'],
    [/\bgenertel\b/i, 'Genertel'],
    [/\baxa\b/i, 'AXA'],
    [/\bzurich\b/i, 'Zurich'],
    [/\bquixa\b/i, 'Quixa'],
  ];
  let detectedCompany = '';
  for (const [re, label] of companies) {
    if (re.test(combined)) {
      detectedCompany = label;
      break;
    }
  }
  if (detectedCompany) {
    policyPatch.company = detectedCompany;
    profilePatch.insuranceCompany = detectedCompany;
    extractedSummary.push(`Compagnia: ${detectedCompany}`);
  }

  // Policy number
  const polNumMatch = cleanText.match(
    /(?:polizza\s*(?:n\.?|numero|n°)|contratto\s*(?:n\.?|numero))\s*[:#-]?\s*([A-Z0-9/-]{5,24})/i
  );
  if (polNumMatch?.[1]) {
    policyPatch.policyNumber = polNumMatch[1].trim();
    extractedSummary.push(`N° Polizza: ${policyPatch.policyNumber}`);
  }

  // Plate
  const plateMatch = combined.match(/\b([A-Z]{2}\s*\d{3}\s*[A-Z]{2})\b/);
  if (plateMatch?.[1]) {
    const cleanPlate = plateMatch[1].replace(/\s+/g, '').toUpperCase();
    profilePatch.plate = cleanPlate;
    extractedSummary.push(`Targa: ${cleanPlate}`);
  }

  // Decorrenza / Scadenza
  const decMatch = cleanText.match(
    /(?:decorrenza|effetto(?:\s+dal)?|valida\s+dal)\s*[:#-]?\s*([^\n]{6,28})/i
  );
  const startDate = normalizeDateToken(decMatch?.[1]);
  if (startDate) {
    policyPatch.startDate = startDate;
    extractedSummary.push(`Decorrenza: ${startDate}`);
  }

  const scadMatch = cleanText.match(
    /(?:scadenza(?:\s+copertura|\s+polizza)?|valida\s+fino\s+al|fino\s+alle\s+24(?::00)?\s+del)\s*[:#-]?\s*([^\n]{6,28})/i
  );
  const endDate = normalizeDateToken(scadMatch?.[1]);
  if (endDate) {
    policyPatch.endDate = endDate;
    profilePatch.insuranceExpiry = endDate;
    extractedSummary.push(`Scadenza assicurazione: ${endDate}`);
  }

  // Revisione / Bollo if present
  const revMatch = cleanText.match(
    /(?:prossima\s+revisione|scadenza\s+revisione|revisione\s+entro)\s*[:#-]?\s*([^\n]{6,24})/i
  );
  const revDate = normalizeDateToken(revMatch?.[1]);
  if (revDate) {
    profilePatch.revisioneExpiry = revDate;
    extractedSummary.push(`Scadenza revisione: ${revDate}`);
  }

  const bolloMatch = cleanText.match(
    /(?:scadenza\s+bollo|tassa\s+automobilistica.*?scad[a-z]*)\s*[:#-]?\s*([^\n]{6,24})/i
  );
  const bolloDate = normalizeDateToken(bolloMatch?.[1]);
  if (bolloDate) {
    profilePatch.bolloExpiry = bolloDate;
    extractedSummary.push(`Scadenza bollo: ${bolloDate}`);
  }

  // Total premium
  const totalMatch = cleanText.match(
    /(?:premio\s+totale(?:\s+annuo)?|totale\s+(?:da\s+pagare|premio))\s*[:€\s]*([\d.,]{2,12})\s*€?/i
  );
  if (totalMatch?.[1]) {
    const val = parseItNumber(totalMatch[1]);
    if (val > 50 && val < 20000) {
      policyPatch.totalPremiumEur = Math.round(val * 100) / 100;
      extractedSummary.push(`Premio totale: € ${policyPatch.totalPremiumEur.toFixed(2).replace('.', ',')}`);
    }
  }

  // Individual coverages
  const coverageRules: { id: string; name: string; re: RegExp; note: string }[] = [
    {
      id: 'rca',
      name: 'RCA (Responsabilità Civile Auto)',
      re: /\bRCA\b[^\d€\n]{0,36}?([\d.,]{2,10})\s*€/i,
      note: 'Obbligatoria per legge: copre i danni causati a terzi (persone, altri veicoli e cose).',
    },
    {
      id: 'infortuni_conducente',
      name: 'Infortuni al conducente',
      re: /Infortuni\s+(?:al\s+)?conducente[^\d€\n]{0,36}?([\d.,]{2,10})\s*€/i,
      note: 'Protegge chi guida in caso di incidente con colpa.',
    },
    {
      id: 'tutela_legale',
      name: 'Tutela Legale',
      re: /Tutela\s+Legale[^\d€\n]{0,36}?([\d.,]{2,10})\s*€/i,
      note: 'Copre spese legali, periti e avvocati in caso di controversie stradali.',
    },
    {
      id: 'assistenza_stradale',
      name: 'Assistenza stradale',
      re: /Assistenza\s+stradale[^\d€\n]{0,36}?([\d.,]{2,10})\s*€/i,
      note: 'Carro attrezzi e soccorso h24 in caso di guasto o incidente.',
    },
    {
      id: 'protezione_satellitare',
      name: 'Protezione Satellitare',
      re: /Protezione\s+Satellitare[^\d€\n]{0,36}?([\d.,]{2,10})\s*€/i,
      note: 'Dispositivo GPS/satellitare per localizzazione e sicurezza.',
    },
  ];

  const extractedCoverages: CarInsuranceCoverage[] = [];
  for (const rule of coverageRules) {
    const m = cleanText.match(rule.re);
    if (m?.[1]) {
      const val = parseItNumber(m[1]);
      if (val > 0 && val < 10000) {
        extractedCoverages.push({
          id: rule.id,
          name: rule.name,
          premiumEur: Math.round(val * 100) / 100,
          active: true,
          note: rule.note,
        });
      }
    }
  }
  if (extractedCoverages.length > 0) {
    policyPatch.coverages = extractedCoverages;
    extractedSummary.push(`Garanzie lette: ${extractedCoverages.length}`);
  }

  // Classes CU / Internal
  const cuMatch = cleanText.match(/Classe\s+(?:CU|universale)\s*[:#-]?\s*(\d{1,2})/i);
  if (cuMatch?.[1]) {
    policyPatch.classCu = cuMatch[1];
    extractedSummary.push(`Classe CU: ${cuMatch[1]}`);
  }
  const admMatch = cleanText.match(/Classe\s+(?:Admiral|interna)\s*[:#-]?\s*(\d{1,2})/i);
  if (admMatch?.[1]) {
    policyPatch.classInternal = admMatch[1];
    extractedSummary.push(`Classe interna: ${admMatch[1]}`);
  }

  // Claims
  const faultMatch = cleanText.match(/Sinistri\s+con\s+colpa[^\d\n]{0,20}(\d{1,2})/i);
  if (faultMatch?.[1]) policyPatch.atFaultClaims5y = Number(faultMatch[1]);
  const noFaultMatch = cleanText.match(/Sinistri\s+senza\s+colpa[^\d\n]{0,20}(\d{1,2})/i);
  if (noFaultMatch?.[1]) policyPatch.noFaultClaims5y = Number(noFaultMatch[1]);

  // Vehicle specs
  const valMatch = cleanText.match(/Valore\s+Veicolo\s*[:€\s]*([\d.,]{3,12})/i);
  if (valMatch?.[1]) {
    const val = parseItNumber(valMatch[1]);
    if (val >= 200 && val <= 300000) {
      policyPatch.vehicleValueEur = Math.round(val * 100) / 100;
      extractedSummary.push(`Valore veicolo: € ${policyPatch.vehicleValueEur.toLocaleString('it-IT')}`);
    }
  }
  const kmMatch = cleanText.match(/Km\s+annui\s*[:#-]?\s*(\d{3,6})/i);
  if (kmMatch?.[1]) {
    policyPatch.annualKm = Number(kmMatch[1]);
  }
  const odoMatch = cleanText.match(/(?:chilometraggio|odometro|km\s+attuali)\s*[:#-]?\s*(\d{3,6})/i);
  if (odoMatch?.[1]) {
    profilePatch.currentKm = Number(odoMatch[1]);
    extractedSummary.push(`Chilometraggio: ${profilePatch.currentKm.toLocaleString('it-IT')} km`);
  }
  const vinMatch = cleanText.match(/\b(ZFA[A-Z0-9]{14})\b/i);
  if (vinMatch?.[1]) {
    profilePatch.vin = vinMatch[1].toUpperCase();
    extractedSummary.push(`Telaio VIN: ${profilePatch.vin}`);
  }
  const boxMatch = cleanText.match(/Ricovero\s+notturno\s*[:#-]?\s*([A-Za-zÀ-ù ]{2,25})/i);
  if (boxMatch?.[1]) {
    policyPatch.overnightParking = boxMatch[1].trim();
  }
  const frazMatch = cleanText.match(/Frazionamento\s*[:#-]?\s*(Annuale|Semestrale|Mensile)/i);
  if (frazMatch?.[1]) {
    policyPatch.paymentFrequency = frazMatch[1];
  }

  const baseName = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const documentTitle = (
    slotMeta?.title ? `${slotMeta.title} · ${profilePatch.plate || 'EA218ES'}` : baseName
  ).slice(0, 80);

  return {
    detectedSlotType,
    documentTitle,
    provider: detectedCompany || 'ConTe.it / Auto',
    issueDate: startDate,
    expiryDate: endDate || revDate || bolloDate,
    referenceCode: policyPatch.policyNumber,
    policyPatch,
    profilePatch,
    extractedSummary,
  };
}
