import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

const isProd = process.env.NODE_ENV === 'production';

function resolveServerPort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (!isProd) {
    const devPort = Number(process.env.DEV_PORT || 3000);
    return Number.isFinite(devPort) && devPort > 0 ? devPort : 3000;
  }
  const envPort = Number(process.env.PORT || 3000);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolveServerPort();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const INSPECT_CACHE_TTL_MS = 30 * 60 * 1000;
const GEMINI_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const searchCache = new Map<string, CacheEntry<{ results: SearchResultDto[]; provider: string }>>();
const manualCache = new Map<string, CacheEntry<ManualGuideDto>>();
const inspectCache = new Map<string, CacheEntry<Record<string, unknown>>>();
let geminiBlockedUntil = 0;

interface SourceLinkDto {
  title: string;
  url: string;
}

interface SearchResultDto {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  suggestedRoom: string;
  specs: string;
  manualUrl: string;
  manualSummary: string;
  sourceUrls: SourceLinkDto[];
  providerLabel: string;
}

interface ManualGuideDto {
  manualUrl: string;
  summary: string;
  keySpecs: string[];
  quickUsage: string[];
  maintenance: string[];
  safetyAndEnergy: string[];
  sourceUrls: SourceLinkDto[];
  sourceType: 'online' | 'curated';
}

interface RawSearchItem {
  name?: string;
  brand?: string;
  model?: string;
  category?: string;
  suggestedRoom?: string;
  specs?: string;
  productUrl?: string;
  manualUrl?: string;
  manualSummary?: string;
}

const VALID_CATEGORIES = new Set([
  'elettrodomestici',
  'elettronica',
  'sicurezza',
  'fotovoltaico',
  'clima',
  'altro',
]);

function getGeminiClient(): GoogleGenAI | null {
  if (Date.now() < geminiBlockedUntil) return null;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaOrRateError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.message} ${JSON.stringify(err)}`
      : typeof err === 'string'
        ? err
        : JSON.stringify(err || '');
  return /(429|RESOURCE_EXHAUSTED|quota|rate[- ]?limit|exceeded|billing|API_KEY_INVALID)/i.test(
    msg
  );
}

function extractJsonFromText<T>(text: string): T | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const startArr = cleaned.indexOf('[');
    const endArr = cleaned.lastIndexOf(']');
    if (startArr !== -1 && endArr > startArr) {
      try {
        return JSON.parse(cleaned.slice(startArr, endArr + 1)) as T;
      } catch {
        // ignore
      }
    }
    const startObj = cleaned.indexOf('{');
    const endObj = cleaned.lastIndexOf('}');
    if (startObj !== -1 && endObj > startObj) {
      try {
        return JSON.parse(cleaned.slice(startObj, endObj + 1)) as T;
      } catch {
        // ignore
      }
    }
    return null;
  }
}

function buildManufacturerSupportUrl(brand: string, model: string): string {
  const b = brand.trim().toLowerCase();
  const cleanModel = model.trim();
  const q = encodeURIComponent(`${brand} ${cleanModel} manuale istruzioni pdf italiano`.trim());

  if (b.includes('electrolux')) {
    return `https://www.electrolux.it/support/user-manuals/?q=${encodeURIComponent(cleanModel)}`;
  }
  if (b.includes('tcl')) {
    return 'https://www.tcl.com/it/it/support';
  }
  if (b.includes('huawei')) {
    return 'https://support.huawei.com/enterprise/en/fusionsolar/sun2000l-pid-22352354';
  }
  if (b.includes('samsung')) {
    return `https://www.samsung.com/it/support/search/?keyword=${encodeURIComponent(cleanModel)}`;
  }
  if (b.includes('bosch')) {
    return 'https://www.bosch-home.com/it/assistenza/ottieni-assistenza/manuali-di-istruzioni';
  }
  if (b.includes('lg')) {
    return 'https://www.lg.com/it/supporto/manuali/';
  }
  if (b.includes('ariston')) {
    return 'https://www.ariston.com/it-it/assistenza/';
  }
  if (b.includes('rehau')) {
    return 'https://www.rehau.com/it-it/downloads';
  }
  if (b.includes('avs')) {
    return 'https://www.avselectronics.it/';
  }
  if (b.includes('dyson')) {
    return 'https://www.dyson.it/support';
  }
  if (b.includes('apple')) {
    return 'https://support.apple.com/it-it/docs';
  }
  if (b.includes('fritz') || b.includes('avm')) {
    return 'https://it.avm.de/assistenza/manuali/';
  }
  if (b.includes('whirlpool')) {
    return `https://www.whirlpool.it/assistenza/manuali-istruzioni`;
  }
  if (b.includes('miele')) {
    return 'https://www.miele.it/c/manuali-d-uso-385.htm';
  }
  if (b.includes('daikin')) {
    return 'https://www.daikin.it/it_it/area-download.html';
  }
  if (b.includes('sony')) {
    return `https://www.sony.it/electronics/support?query=${encodeURIComponent(cleanModel)}`;
  }
  if (b.includes('philips')) {
    return `https://www.philips.it/c-w/support-home/support-search.html?q=${encodeURIComponent(cleanModel)}`;
  }
  return `https://www.google.com/search?q=${q}`;
}

function inferCategoryFromText(text: string): string {
  const t = text.toLowerCase();
  if (/(inverter|pannell|fotovolta|solare|sun2000|batteria accumulo)/.test(t)) {
    return 'fotovoltaico';
  }
  if (/(allarme|sirena|telecam|sensor|antifurto|citofon|nvr|avs)/.test(t)) {
    return 'sicurezza';
  }
  if (/(pompa di calore|condizionator|caldaia|termostat|deumidificat|ariston|rehau|neasmart|clima|daikin)/.test(t)) {
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

function inferRoomFromText(text: string, cat: string): string {
  const t = text.toLowerCase();
  if (/(forno|frigo|frigorifero|lavastoviglie|induzione|piano cottura|microonde|cappa|caffe)/.test(t)) {
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

async function lookupWikipediaSummaryIt(query: string): Promise<{
  title: string;
  extract: string;
  pageUrl: string;
} | null> {
  try {
    const searchUrl = `https://it.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&srlimit=1&utf8=1&format=json`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(3500) });
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as {
      query?: { search?: { title?: string }[] };
    };
    const title = searchJson.query?.search?.[0]?.title;
    if (!title) return null;

    const sumRes = await fetch(
      `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (!sumRes.ok) return null;
    const sumJson = (await sumRes.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (!sumJson.extract) return null;
    return {
      title: sumJson.title || title,
      extract: sumJson.extract.slice(0, 320),
      pageUrl:
        sumJson.content_urls?.desktop?.page ||
        `https://it.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return null;
  }
}

function buildFallbackManualPayload(
  name: string,
  brand: string,
  model: string,
  category: string,
  wikiInfo: { title: string; extract: string; pageUrl: string } | null
): ManualGuideDto {
  const cat = VALID_CATEGORIES.has(category.toLowerCase())
    ? category.toLowerCase()
    : inferCategoryFromText(`${name} ${brand} ${model}`);
  const manualUrl = buildManufacturerSupportUrl(brand, model);
  const pdfSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${brand} ${model} manuale istruzioni pdf italiano`.trim()
  )}`;

  const categoryUsage: Record<string, string[]> = {
    elettrodomestici: [
      'Usa programmi Eco o a pieno carico per ottimizzare acqua ed energia elettrica.',
      'In presenza di impianto fotovoltaico, avvia i cicli principali tra le 10:30 e le 16:00.',
      'Annota il codice seriale/PNC dalla targhetta interna per assistenza o ricambi rapidi.',
    ],
    elettronica: [
      'Mantieni aggiornato il firmware/software dal menu Impostazioni del dispositivo.',
      'Collega eventuali alimentatori sensibili a ciabatta filtrata contro sbalzi di tensione.',
    ],
    sicurezza: [
      'Verifica periodicamente notifiche della centrale, stato batterie e connessione primaria/backup.',
      'Conserva i codici utente/installatore in un luogo sicuro separato dall’impianto.',
    ],
    fotovoltaico: [
      'Monitora produzione e autoconsumo dall’app dedicata verificando assenza di allarmi stringa.',
      'Segui sempre la sequenza di sicurezza del costruttore prima di manovrare sezionatori AC/DC.',
    ],
    clima: [
      'Privilegia setpoint stabili e funzionamento continuo a bassa mandata per massimizzare il rendimento.',
      'Controlla che bocchette di ripresa, filtri e scarichi condensa siano sempre liberi.',
    ],
    altro: [
      'Conserva fattura d’acquisto e link diretto al manuale PDF ufficiale direttamente nella scheda.',
    ],
  };

  const categoryMaintenance: Record<string, string[]> = {
    elettrodomestici: [
      'Pulisci filtri, guarnizioni e vaschette ogni 1–2 mesi per evitare odori e cali di resa.',
      'Esegui i cicli periodici di pulizia/decalcificazione indicati dal costruttore.',
    ],
    elettronica: [
      'Spolvera regolarmente feritoie di aerazione, schermo e porte con panno in microfibra asciutto.',
    ],
    sicurezza: [
      'Controlla annualmente batteria tampone e comunicazione allarmi su rete mobile/IP.',
    ],
    fotovoltaico: [
      'Verifica annualmente la pulizia delle alette di dissipazione dell’inverter e la resa dei moduli.',
    ],
    clima: [
      'Pulisci i filtri aria ogni 1–2 mesi e controlla pressione/filtri impianto prima di ogni stagione.',
    ],
    altro: [
      'Ispezione visiva periodica di cavi, alimentatori e componenti soggetti ad usura.',
    ],
  };

  const summaryParts = [
    `Scheda tecnica e riferimenti ufficiali per ${name || `${brand} ${model}`} (${brand} · ${model}).`,
    wikiInfo ? wikiInfo.extract : '',
  ].filter(Boolean);

  const sourceUrls: SourceLinkDto[] = [
    { title: `Manuali ${brand}`, url: manualUrl },
    { title: 'Cerca PDF manuale in italiano', url: pdfSearchUrl },
    ...(wikiInfo ? [{ title: `Wikipedia: ${wikiInfo.title}`, url: wikiInfo.pageUrl }] : []),
  ];

  return {
    manualUrl,
    summary: summaryParts.join(' '),
    keySpecs: [
      `Dispositivo: ${name || `${brand} ${model}`}`,
      `Produttore: ${brand}`,
      `Codice modello: ${model}`,
      `Categoria impianto/casa: ${cat}`,
    ],
    quickUsage: categoryUsage[cat] || categoryUsage.altro,
    maintenance: categoryMaintenance[cat] || categoryMaintenance.altro,
    safetyAndEnergy: [
      'Scollega l’alimentazione elettrica prima di operazioni di pulizia interna o manutenzione.',
      'Verifica sul portale supporto del produttore eventuali aggiornamenti firmware o bollettini tecnici.',
    ],
    sourceUrls,
    sourceType: 'curated',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/articles/search', async (req, res) => {
    const rawQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!rawQuery || rawQuery.length > 140) {
      res.status(400).json({ error: 'Query non valida.' });
      return;
    }

    const cacheKey = rawQuery.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const ai = getGeminiClient();
    if (ai) {
      try {
        const prompt = [
          `Usa Google Search per trovare prodotti reali in vendita in Italia che corrispondono a: "${rawQuery}".`,
          'Comportati come un catalogo di prodotti: restituisci da 3 a 5 modelli distinti e specifici, come una ricerca in un negozio online.',
          'Per strumenti musicali come chitarre, includi modelli reali e distinti della marca richiesta (es. serie e codice esatto), non la pagina generica della marca.',
          'Usa esclusivamente modelli e URL di prodotto supportati dalle fonti Google Search citate. Non inventare nomi, codici, prezzi o caratteristiche; ometti i prodotti senza una fonte verificabile.',
          'Restituisci SOLO un array JSON valido (massimo 5 elementi) senza testo extra, con questi campi per ciascun risultato:',
          '- name: nome prodotto in italiano con tipo e modello esatto (max 80 caratteri)',
          '- brand: marca ufficiale',
          '- model: codice o nome modello esatto, non la query dell’utente',
          '- category: uno solo tra ["elettrodomestici", "elettronica", "sicurezza", "fotovoltaico", "clima", "altro"]',
          '- suggestedRoom: stanza tipica tra ["Cucina", "Salone", "Stanza Maurizio", "Stanza Roberta", "Matrimoniale", "Bagno 1", "Bagno 2", "Locale Tecnico / Esterno", "Casa / Ingresso"]',
          '- specs: breve sintesi delle caratteristiche che compaiono nella fonte (max 210 caratteri)',
          '- productUrl: URL esatto della pagina del prodotto in una fonte Google Search citata, preferibilmente rivenditore con pagina modello specifica',
          '- manualUrl: URL del manuale/supporto ufficiale, solo se trovato; altrimenti stringa vuota',
          '- manualSummary: breve descrizione basata sulla pagina prodotto, senza istruzioni o dati non verificati',
        ].join('\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const groundingChunks =
          response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sourceUrls = groundingChunks
          .map((chunk) => ({
            title: chunk.web?.title || 'Fonte Web',
            url: chunk.web?.uri || '',
          }))
          .filter((s) => s.url.startsWith('http'))
          .slice(0, 6);

        const parsed = extractJsonFromText<RawSearchItem[]>(response.text || '');
        const normalizeUrl = (value: string) => value.replace(/\/+$/, '').toLowerCase();
        const verifiedSources = new Map(
          sourceUrls.map((source) => [normalizeUrl(source.url), source])
        );
        const results: SearchResultDto[] = Array.isArray(parsed)
          ? parsed
              .slice(0, 10)
              .flatMap((item, idx) => {
                const brand = String(item.brand || '').trim().slice(0, 60);
                const model = String(item.model || '').trim().slice(0, 80);
                const name = String(item.name || `${brand} ${model}`).trim().slice(0, 80);
                if (!brand || !model) return [];

                const rawProductUrl =
                  typeof item.productUrl === 'string' && item.productUrl.startsWith('https://')
                    ? item.productUrl.trim()
                    : '';
                const matchedSource = rawProductUrl
                  ? verifiedSources.get(normalizeUrl(rawProductUrl))
                  : undefined;

                const itemSources: SourceLinkDto[] = [];
                if (matchedSource) {
                  itemSources.push(matchedSource);
                } else if (rawProductUrl) {
                  itemSources.push({ title: `${brand} ${model}`, url: rawProductUrl });
                }
                for (const src of sourceUrls) {
                  if (itemSources.length >= 3) break;
                  if (!itemSources.some((s) => normalizeUrl(s.url) === normalizeUrl(src.url))) {
                    itemSources.push(src);
                  }
                }
                if (itemSources.length === 0) return [];

                const category = VALID_CATEGORIES.has(String(item.category || '').toLowerCase())
                  ? String(item.category).toLowerCase()
                  : inferCategoryFromText(`${name} ${brand} ${model}`);
                const manualUrl =
                  typeof item.manualUrl === 'string' && item.manualUrl.startsWith('https://')
                    ? item.manualUrl
                    : buildManufacturerSupportUrl(brand, model);

                return [{
                  id: `web_${Date.now()}_${idx}`,
                  name,
                  brand,
                  model,
                  category,
                  suggestedRoom: String(
                    item.suggestedRoom || inferRoomFromText(`${name} ${brand} ${model}`, category)
                  ).trim().slice(0, 60),
                  specs: String(item.specs || '').trim().slice(0, 240),
                  manualUrl,
                  manualSummary: String(item.manualSummary || '').trim().slice(0, 240),
                  sourceUrls: itemSources,
                  providerLabel: 'Google Search · Gemini',
                }];
              })
          : [];

        const uniqueResults = results.filter(
          (item, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.brand.toLowerCase() === item.brand.toLowerCase() &&
                candidate.model.toLowerCase() === item.model.toLowerCase()
            ) === index
        );
        if (uniqueResults.length > 0) {
          const payload = {
            results: uniqueResults.slice(0, 5),
            provider: 'Ricerca prodotti live · Google Search',
          };
          searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: payload });
          res.json(payload);
          return;
        }
      } catch (err) {
        if (isQuotaOrRateError(err)) {
          geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
      }
    }

    const emptyResult = {
      results: [],
      provider: 'Nessun prodotto verificabile trovato; prova con marca e categoria o usa Google Shopping.',
    };
    searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: emptyResult });
    res.json(emptyResult);
  });

  app.post('/api/articles/manual', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const brand = typeof req.body?.brand === 'string' ? req.body.brand.trim() : '';
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : 'altro';

    if (!brand || !model) {
      res.status(400).json({ error: 'Marca e modello obbligatori.' });
      return;
    }

    const cacheKey = `${brand.toLowerCase()}|${model.toLowerCase()}`;
    const cached = manualCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const ai = getGeminiClient();
    if (ai) {
      try {
        const prompt = [
          `Trova online la scheda tecnica e il manuale operativo ufficiale per: ${brand} ${model} (${name}).`,
          'Rispondi SOLO con un oggetto JSON valido con questi campi in italiano:',
          '- manualUrl: URL diretto o pagina ufficiale supporto/manuali del produttore',
          '- summary: riepilogo chiaro del dispositivo e funzioni principali (2-3 frasi)',
          '- keySpecs: array di 4-5 stringhe con le specifiche tecniche principali',
          '- quickUsage: array di 3-4 consigli pratici d’uso dal manuale',
          '- maintenance: array di 2-3 operazioni di pulizia/manutenzione periodica',
          '- safetyAndEnergy: array di 2-3 consigli di sicurezza e risparmio energetico',
        ].join('\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const groundingChunks =
          response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sourceUrls = groundingChunks
          .map((chunk) => ({
            title: chunk.web?.title || 'Fonte Web',
            url: chunk.web?.uri || '',
          }))
          .filter((s) => s.url.startsWith('http'))
          .slice(0, 6);

        const parsed = extractJsonFromText<{
          manualUrl?: string;
          summary?: string;
          keySpecs?: string[];
          quickUsage?: string[];
          maintenance?: string[];
          safetyAndEnergy?: string[];
        }>(response.text || '');

        if (parsed && (parsed.summary || parsed.manualUrl)) {
          const payload: ManualGuideDto = {
            manualUrl:
              parsed.manualUrl && parsed.manualUrl.startsWith('http')
                ? parsed.manualUrl
                : sourceUrls[0]?.url || buildManufacturerSupportUrl(brand, model),
            summary: parsed.summary || '',
            keySpecs: Array.isArray(parsed.keySpecs) ? parsed.keySpecs.slice(0, 6) : [],
            quickUsage: Array.isArray(parsed.quickUsage) ? parsed.quickUsage.slice(0, 5) : [],
            maintenance: Array.isArray(parsed.maintenance) ? parsed.maintenance.slice(0, 4) : [],
            safetyAndEnergy: Array.isArray(parsed.safetyAndEnergy)
              ? parsed.safetyAndEnergy.slice(0, 4)
              : [],
            sourceUrls,
            sourceType: 'online',
          };
          manualCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: payload });
          res.json(payload);
          return;
        }
      } catch (err) {
        if (isQuotaOrRateError(err)) {
          geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
      }
    }

    // Free zero-quota fallback (Wikipedia IT + official manufacturer support links)
    const wikiInfo = await lookupWikipediaSummaryIt(`${brand} ${model}`);
    const fallbackManual = buildFallbackManualPayload(name, brand, model, category, wikiInfo);
    manualCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: fallbackManual });
    res.json(fallbackManual);
  });

  function decodeHtmlEntities(input: string): string {
    return input
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&euro;/gi, '€')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#(\d+);/g, (_m, dec) => {
        const code = Number(dec);
        return Number.isFinite(code) && code > 0 && code < 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      })
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 && code < 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isPrivateOrLocalHostname(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      h.endsWith('.local') ||
      h.endsWith('.internal')
    ) {
      return true;
    }
    const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const a = Number(ipv4[1]);
      const b = Number(ipv4[2]);
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
    }
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) {
      return true;
    }
    return false;
  }

  function formatStoreFromHostname(hostname: string): string {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('amazon.')) return 'Amazon';
    if (host.includes('maisonsdumonde.')) return 'Maisons du Monde';
    if (host.includes('zarahome.')) return 'Zara Home';
    if (host.includes('westwing.')) return 'Westwing';
    if (host.includes('kavehome.')) return 'Kave Home';
    if (host.includes('sklum.')) return 'Sklum';
    if (host.includes('mondoconv')) return 'Mondo Convenienza';
    if (host.includes('laredoute.')) return 'La Redoute';
    if (host.includes('conforama.')) return 'Conforama';
    if (host.includes('casashops.')) return 'CASA';
    if (host.includes('jysk.')) return 'JYSK';
    if (host.includes('electrolux.')) return 'Electrolux';
    if (host.includes('aeg.')) return 'AEG';
    if (host.includes('dyson.')) return 'Dyson';
    if (host.includes('mediaworld.')) return 'MediaWorld';
    if (host.includes('unieuro.')) return 'Unieuro';
    if (host.includes('ikea.')) return 'IKEA';
    if (host.includes('leroymerlin.')) return 'Leroy Merlin';
    if (host.includes('euronics.')) return 'Euronics';
    if (host.includes('eprice.')) return 'ePrice';
    if (host.includes('decathlon.')) return 'Decathlon';
    if (host.includes('apple.')) return 'Apple';
    if (host.includes('samsung.')) return 'Samsung';
    if (host.includes('philips.')) return 'Philips';
    if (host.includes('bosch')) return 'Bosch';
    if (host.includes('subito.')) return 'Subito';
    if (host.includes('ebay.')) return 'eBay';
    if (host.includes('aliexpress.')) return 'AliExpress';
    if (host.includes('obi-italia') || host.startsWith('obi.')) return 'OBI';
    if (host.includes('bricoio.')) return 'Brico io';
    if (host.includes('bricocenter.')) return 'Bricocenter';
    if (host.includes('bricoman') || host.includes('tecno') || host.includes('tecnomat')) {
      return host.includes('tecnomat') ? 'Tecnomat' : host;
    }
    return host.slice(0, 60);
  }

  function inferProductBrandServer(input: {
    title?: string;
    url?: string;
    store?: string;
    brand?: string;
    specs?: string;
  }): string | undefined {
    const genericOrMarketplace = new Set([
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
    ]);
    const rules: [RegExp, string][] = [
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
      [/\b(?:maisons\s*du\s*monde)\b/i, 'Maisons du Monde'],
      [/\b(?:zara\s*home)\b/i, 'Zara Home'],
      [/\b(?:westwing)\b/i, 'Westwing'],
      [/\b(?:kave\s*home)\b/i, 'Kave Home'],
      [/\b(?:sklum)\b/i, 'Sklum'],
      [/\b(?:mondo\s*convenienza)\b/i, 'Mondo Convenienza'],
      [/\b(?:ikea)\b/i, 'IKEA'],
    ];
    const cleanExplicit = (input.brand || '')
      .trim()
      .replace(/^(?:visita\s+lo\s+store\s+di|marca:|brand:|produttore:)\s*/i, '')
      .replace(/\s+store$/i, '')
      .trim();
    if (cleanExplicit && !genericOrMarketplace.has(cleanExplicit.toLowerCase())) {
      for (const [pattern, canonical] of rules) {
        if (pattern.test(cleanExplicit) && cleanExplicit.length <= canonical.length + 12) {
          return canonical;
        }
      }
      return cleanExplicit.slice(0, 60);
    }

    const combinedText = `${input.title || ''} ${input.url || ''} ${input.specs || ''}`;
    if (
      /\b(?:amazon\s+basics|amazonbasics|kindle|echo\s+(?:dot|show|pop|spot|studio)|fire\s+(?:tv|hd|stick)|ring|blink|eero)\b/i.test(
        combinedText
      )
    ) {
      return 'Amazon';
    }
    for (const [pattern, canonical] of rules) {
      if (pattern.test(combinedText)) return canonical;
    }

    const monoBrands = new Set([
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
    return input.store && monoBrands.has(input.store) ? input.store : undefined;
  }

  function extractDetailsFromProductUrl(
    parsedUrl: URL,
    store: string
  ): {
    title: string;
    model?: string;
    color?: string;
    specs?: string;
  } {
    const segments = parsedUrl.pathname
      .split('/')
      .map((s) => decodeURIComponent(s).trim())
      .filter(Boolean);
    const ignored = new Set([
      'dp', 'gp', 'product', 'products', 'p', 'it', 'it-it', 'fr', 'en', 'de', 'es',
      'shop', 'catalog', 'prodotto', 'prodotti', 'scheda', 'item', 'items', 'buy', 'ref',
    ]);
    const candidates = segments.filter((seg) => {
      const lower = seg.toLowerCase();
      if (ignored.has(lower)) return false;
      if (/^b0[a-z0-9]{8}$/i.test(seg)) return false; // ASIN
      if (/^[0-9]+$/.test(seg)) return false;
      if (seg.length < 3) return false;
      return true;
    });
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    if (!best) return { title: `Prodotto ${store}`.slice(0, 160) };

    let slug = best.replace(/\.(html?|php|aspx?)$/i, '').trim();
    let extractedModel: string | undefined;

    // Extract trailing catalog SKU / article number (e.g., Maisons du Monde -173485, IKEA -80275885 / -s19123456)
    const skuMatch = slug.match(/^(.+?)[-_](?:id[-_]?|p[-_]?)?(s?\d{5,10})$/i);
    if (skuMatch && skuMatch[1].length >= 4) {
      slug = skuMatch[1];
      extractedModel = skuMatch[2].toUpperCase();
    }

    const rawTokens = slug
      .replace(/[-_+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    const lowercaseWords = new Set([
      'in', 'di', 'a', 'da', 'con', 'per', 'su', 'tra', 'fra', 'e', 'ed', 'o',
      'del', 'della', 'dei', 'degli', 'delle', 'al', 'alla', 'nel', 'nella',
      'sul', 'sulla', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno',
    ]);
    const unitWords = new Set([
      'cm', 'mm', 'm', 'kg', 'gr', 'g', 'ml', 'l', 'lt', 'w', 'kw', 'v', 'mah', 'gb', 'tb', 'hz',
    ]);
    const dimAbbrev: Record<string, string> = {
      alt: 'Alt.',
      larg: 'Larg.',
      prof: 'Prof.',
      diam: 'Diam.',
      lungh: 'Lungh.',
    };

    const formattedWords = rawTokens.map((tok, idx) => {
      const low = tok.toLowerCase();
      if (unitWords.has(low)) return low;
      if (dimAbbrev[low] && idx + 1 < rawTokens.length && /^\d/.test(rawTokens[idx + 1])) {
        return dimAbbrev[low];
      }
      if (idx > 0 && lowercaseWords.has(low)) return low;
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    });

    const title = (formattedWords.join(' ') || `Prodotto ${store}`).slice(0, 160);

    // Extract useful specs & explicit color from slug
    const slugLower = slug.toLowerCase();
    const specsLines: string[] = [];
    if (extractedModel) {
      specsLines.push(`Codice articolo: ${extractedModel}`);
    }

    const materialMatch = slugLower.match(
      /\bin-(cemento|legno-massello|legno|metallo|ceramica|porcellana|vetro|ottone|marmo|ferro|acciaio|lino|velluto|cotone|resina|terracotta|rattan|bambu|bambù|pelle|similpelle|juta|poliestere|plastica)\b/
    );
    if (materialMatch?.[1]) {
      const mat = materialMatch[1].replace(/-/g, ' ');
      specsLines.push(`Materiale: ${mat.charAt(0).toUpperCase() + mat.slice(1)}`);
    }

    const heightMatch = slugLower.match(/(?:^|-)alt-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (heightMatch) specsLines.push(`Altezza: ${heightMatch[1]} ${heightMatch[2]}`);

    const widthMatch = slugLower.match(/(?:^|-)larg-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (widthMatch) specsLines.push(`Larghezza: ${widthMatch[1]} ${widthMatch[2]}`);

    const depthMatch = slugLower.match(/(?:^|-)prof-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (depthMatch) specsLines.push(`Profondità: ${depthMatch[1]} ${depthMatch[2]}`);

    const diamMatch = slugLower.match(/(?:^|-)diam-(\d+(?:[.,]\d+)?)-(cm|mm|m)\b/);
    if (diamMatch) specsLines.push(`Diametro: ${diamMatch[1]} ${diamMatch[2]}`);

    const dimMxMatch = slugLower.match(
      /(?:^|-)(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)(?:x(\d+(?:[.,]\d+)?))?(?:-(cm|mm))?\b/
    );
    if (dimMxMatch) {
      const dims = [dimMxMatch[1], dimMxMatch[2], dimMxMatch[3]].filter(Boolean).join(' × ');
      specsLines.push(`Dimensioni: ${dims}${dimMxMatch[4] ? ` ${dimMxMatch[4]}` : ''}`);
    }

    const colorMap: Record<string, string> = {
      bianco: 'Bianco',
      bianca: 'Bianco',
      nero: 'Nero',
      nera: 'Nero',
      grigio: 'Grigio',
      grigia: 'Grigio',
      beige: 'Beige',
      avorio: 'Avorio',
      ecru: 'Écru',
      oro: 'Oro',
      dorato: 'Dorato',
      argento: 'Argento',
      bronzo: 'Bronzo',
      rame: 'Rame',
      rosso: 'Rosso',
      rossa: 'Rosso',
      blu: 'Blu',
      azzurro: 'Azzurro',
      verde: 'Verde',
      salvia: 'Verde salvia',
      rosa: 'Rosa',
      giallo: 'Giallo',
      marrone: 'Marrone',
      tortora: 'Tortora',
      antracite: 'Antracite',
      borgogna: 'Borgogna',
      bordeaux: 'Bordeaux',
    };
    let extractedColor: string | undefined;
    for (const tok of rawTokens) {
      const hit = colorMap[tok.toLowerCase()];
      if (hit) {
        extractedColor = hit;
        break;
      }
    }

    return {
      title,
      model: extractedModel,
      color: extractedColor,
      specs: specsLines.length > 0 ? specsLines.join('\n').slice(0, 780) : undefined,
    };
  }

  function inferResearchCategory(text: string): string {
    const t = text.toLowerCase();
    if (/(forno|frigo|frigorifero|lavatrice|asciugatrice|lavastoviglie|microonde|induzione|cappa|aspirapolvere|dyson|caffe|folletto|bimby)/.test(t)) {
      return 'elettrodomestici';
    }
    if (/(tv|televis|monitor|laptop|macbook|pc|ipad|tablet|iphone|smartphone|cellulare|sbloccato|ricondizionato|cuffie|airpods|router|modem|ssd|mouse|tastiera|soundbar|console|ps5|custodia|magsafe|5g|apple)/.test(t)) {
      return 'elettronica';
    }
    if (/(divano|tavolo|sedia|armadio|lampada|materasso|tappeto|cucina|arredo|arredamento|mobili|scrivania|scaffale|specchio|statuetta|busto|scultura|soprammobile|vaso|cornice|quadro|candela|portacandele|cuscino|plaid|tenda|poltrona|pouf|libreria|comodino|credenza|cassettiera|mensola|cemento|ceramica|maisonsdumonde|zarahome|westwing|kavehome|sklum|mondoconv|laredoute|conforama)/.test(t)) {
      return 'casa_arredo';
    }
    if (/(trapano|avvitatore|sega|vernice|silicone|martello|makita|dewalt|utensil|scala|giardino|tagliaerba|idropulitrice)/.test(t)) {
      return 'fai_da_te';
    }
    if (/(auto|gomme|pneumatici|tergicristall|olio motore|catene|portabici|caricabatterie auto|panda|fiat)/.test(t)) {
      return 'auto';
    }
    if (/(scarpe|giacca|maglia|pantaloni|zaino|borsa|felpa|t-shirt|vestito)/.test(t)) {
      return 'abbigliamento';
    }
    return 'altro';
  }

  function extractMetaContent(html: string, attrName: string, attrValue: string): string {
    const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp(
      `<meta[^>]*${attrName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      'i'
    );
    const m1 = html.match(re1);
    if (m1?.[1]) return decodeHtmlEntities(m1[1]);
    const re2 = new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escaped}["'][^>]*>`,
      'i'
    );
    const m2 = html.match(re2);
    return m2?.[1] ? decodeHtmlEntities(m2[1]) : '';
  }

  function parsePriceNumber(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1000000) {
      return Math.round(raw * 100) / 100;
    }
    if (typeof raw !== 'string') return undefined;
    const cleaned = raw.replace(/[^0-9.,]/g, '').trim();
    if (!cleaned) return undefined;
    // Handle Italian decimal comma or US decimal dot
    let normalized = cleaned;
    if (cleaned.includes(',') && cleaned.includes('.')) {
      normalized =
        cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
          ? cleaned.replace(/\./g, '').replace(',', '.')
          : cleaned.replace(/,/g, '');
    } else if (cleaned.includes(',')) {
      const parts = cleaned.split(',');
      normalized = parts[1] && parts[1].length <= 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
    }
    const num = Number.parseFloat(normalized);
    if (!Number.isFinite(num) || num <= 0 || num > 1000000) return undefined;
    return Math.round(num * 100) / 100;
  }

  function stripHtmlTags(raw: string): string {
    return decodeHtmlEntities(
      raw
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    );
  }

  function extractProductFromJsonLd(html: string): {
    title?: string;
    brand?: string;
    color?: string;
    model?: string;
    imageUrl?: string;
    priceEur?: number;
    description?: string;
  } {
    const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim()) as unknown;
        const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length > 0) {
          const node = queue.shift();
          if (!node || typeof node !== 'object') continue;
          const obj = node as Record<string, unknown>;
          if (Array.isArray(obj['@graph'])) {
            queue.push(...(obj['@graph'] as unknown[]));
          }
          const rawType = obj['@type'];
          const types = Array.isArray(rawType) ? rawType : [rawType];
          const isProduct = types.some(
            (t) => typeof t === 'string' && t.toLowerCase().includes('product')
          );
          if (!isProduct) continue;

          const title = typeof obj.name === 'string' ? decodeHtmlEntities(obj.name) : undefined;
          let brand: string | undefined;
          if (typeof obj.brand === 'string') {
            brand = decodeHtmlEntities(obj.brand);
          } else if (
            obj.brand &&
            typeof obj.brand === 'object' &&
            typeof (obj.brand as Record<string, unknown>).name === 'string'
          ) {
            brand = decodeHtmlEntities(String((obj.brand as Record<string, unknown>).name));
          }

          const color =
            typeof obj.color === 'string' ? decodeHtmlEntities(obj.color).slice(0, 60) : undefined;
          const rawModel = obj.model ?? obj.mpn ?? obj.sku;
          const model =
            typeof rawModel === 'string' ? decodeHtmlEntities(rawModel).slice(0, 80) : undefined;

          let imageUrl: string | undefined;
          if (typeof obj.image === 'string' && obj.image.startsWith('http')) {
            imageUrl = obj.image;
          } else if (Array.isArray(obj.image)) {
            const firstImg = obj.image.find((x) => typeof x === 'string' && x.startsWith('http'));
            if (typeof firstImg === 'string') imageUrl = firstImg;
          } else if (
            obj.image &&
            typeof obj.image === 'object' &&
            typeof (obj.image as Record<string, unknown>).url === 'string'
          ) {
            const u = String((obj.image as Record<string, unknown>).url);
            if (u.startsWith('http')) imageUrl = u;
          }

          let priceEur: number | undefined;
          const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
          if (offers && typeof offers === 'object') {
            const o = offers as Record<string, unknown>;
            priceEur =
              parsePriceNumber(o.price) ??
              parsePriceNumber(o.lowPrice) ??
              parsePriceNumber(o.highPrice);
          }
          const description =
            typeof obj.description === 'string' ? decodeHtmlEntities(obj.description) : undefined;
          if (title || priceEur || imageUrl) {
            return { title, brand, color, model, imageUrl, priceEur, description };
          }
        }
      } catch {
        // ignore invalid JSON-LD block
      }
    }
    return {};
  }

  function extractAmazonAsin(parsedUrl: URL): string | undefined {
    const m = parsedUrl.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return m?.[1]?.toUpperCase();
  }

  function canonicalInspectCacheKey(parsedUrl: URL): string {
    const asin = extractAmazonAsin(parsedUrl);
    if (parsedUrl.hostname.toLowerCase().includes('amazon.') && asin) {
      return `${parsedUrl.hostname.toLowerCase()}/dp/${asin}`;
    }
    const clean = new URL(parsedUrl.toString());
    for (const key of Array.from(clean.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|pd_rd_|pf_rd_|ref_?|content-id|_encoding)/i.test(key)) {
        clean.searchParams.delete(key);
      }
    }
    return clean.toString();
  }

  function extractAmazonDomDetails(
    html: string,
    asin?: string
  ): {
    title?: string;
    brand?: string;
    imageUrl?: string;
    priceEur?: number;
    color?: string;
    model?: string;
    specsList: string[];
    bullets: string[];
  } {
    // 1. Product Title (#productTitle desktop or #title mobile)
    let title: string | undefined;
    const titleMatch = html.match(/id=["'](?:productTitle|title)["'][^>]*>([\s\S]*?)<\/span>/i);
    if (titleMatch?.[1]) {
      const cleaned = stripHtmlTags(titleMatch[1]);
      if (cleaned) title = cleaned.slice(0, 160);
    }

    // 2. High-res Image (#landingImage / data-old-hires / data-a-dynamic-image / hiRes)
    let imageUrl: string | undefined;
    const landingIdx = html.search(/id=["'](?:landingImage|imgBlkFront|main-image)["']/i);
    if (landingIdx !== -1) {
      const tagSlice = html.slice(Math.max(0, landingIdx - 400), landingIdx + 2400);
      const oldHires = tagSlice.match(/data-old-hires=["'](https?:\/\/[^"']+)["']/i);
      if (oldHires?.[1]) {
        imageUrl = decodeHtmlEntities(oldHires[1]);
      }
      if (!imageUrl) {
        const dynAttr = tagSlice.match(/data-a-dynamic-image=["']([^"']+)["']/i);
        if (dynAttr?.[1]) {
          try {
            const dynJson = JSON.parse(decodeHtmlEntities(dynAttr[1])) as Record<string, [number, number]>;
            const sorted = Object.entries(dynJson)
              .filter(([u, dims]) => /^https?:\/\//i.test(u) && Array.isArray(dims))
              .sort(([, a], [, b]) => (b[0] || 0) * (b[1] || 0) - (a[0] || 0) * (a[1] || 0));
            if (sorted[0]?.[0]) imageUrl = sorted[0][0];
          } catch {
            // ignore
          }
        }
      }
      if (!imageUrl) {
        const srcAttr = tagSlice.match(/(?:data-a-image-source|\bsrc)=["'](https?:\/\/m\.media-amazon\.com\/images\/I\/[^"']+)["']/i);
        if (srcAttr?.[1]) imageUrl = decodeHtmlEntities(srcAttr[1]);
      }
    }
    if (!imageUrl) {
      const hiResMatch = html.match(/"(?:hiRes|large)"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i);
      if (hiResMatch?.[1]) imageUrl = hiResMatch[1];
    }

    // 3. Price (twister-plus-buying-options-price-data / .priceToPay / #corePriceDisplay_desktop_feature_div)
    let priceEur: number | undefined;

    // 3a. Mobile / Modern Twister BuyBox JSON (cleanest, avoids trade-in widget false positives)
    const twisterJsonMatch = html.match(
      /twister-plus-(?:buying-options-)?price-data["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (twisterJsonMatch?.[1]) {
      const twAmountM = twisterJsonMatch[1].match(/"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
      if (twAmountM?.[1]) {
        priceEur = parsePriceNumber(twAmountM[1]);
      }
    }

    const priceBlockRegions: string[] = [];
    const priceDisplayIdx = html.indexOf('corePriceDisplay_desktop_feature_div');
    if (priceDisplayIdx !== -1) priceBlockRegions.push(html.slice(priceDisplayIdx, priceDisplayIdx + 16000));
    const corePriceIdx = html.indexOf('id="corePrice_feature_div"');
    if (corePriceIdx !== -1) priceBlockRegions.push(html.slice(corePriceIdx, corePriceIdx + 14000));
    const buyboxPriceIdx = html.indexOf('id="price_inside_buybox"');
    if (buyboxPriceIdx !== -1) priceBlockRegions.push(html.slice(buyboxPriceIdx, buyboxPriceIdx + 1500));

    for (const region of priceBlockRegions) {
      if (priceEur !== undefined) break;
      const toPayMatch = region.match(
        /class=["'][^"']*(?:priceToPay|apex-pricetopay-value)[^"']*["'][\s\S]{0,1000}/i
      );
      const targetSlice = toPayMatch?.[0] || region;

      const offscreenMatches = [
        ...targetSlice.matchAll(/class=["'](?:a-offscreen|aok-offscreen)["'][^>]*>([\s\S]*?)<\/span>/gi),
      ];
      for (const om of offscreenMatches) {
        const parsed = parsePriceNumber(stripHtmlTags(om[1]));
        if (parsed !== undefined) {
          priceEur = parsed;
          break;
        }
      }
      if (priceEur === undefined) {
        const wholeM = targetSlice.match(/class=["']a-price-whole["'][^>]*>([\d.]+)/i);
        const fracM = targetSlice.match(/class=["']a-price-fraction["'][^>]*>(\d{1,2})/i);
        if (wholeM?.[1]) {
          const cleanWhole = wholeM[1].replace(/\./g, '');
          const candidate = fracM?.[1] ? `${cleanWhole}.${fracM[1]}` : cleanWhole;
          priceEur = parsePriceNumber(candidate);
        }
      }
      if (priceEur === undefined) {
        const regionAmountM = targetSlice.match(/"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
        if (regionAmountM?.[1]) {
          priceEur = parsePriceNumber(regionAmountM[1]);
        }
      }
    }

    // 4. Brand (#bylineInfo, overridden by explicit Marchio/Marca in Product Overview if Renewed/Amazon)
    let bylineBrand: string | undefined;
    const bylineMatch = html.match(/id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i);
    if (bylineMatch?.[1]) {
      const rawByline = stripHtmlTags(bylineMatch[1])
        .replace(/^(?:Visita lo Store di|Marca:|Brand:)\s*/i, '')
        .replace(/\s+Store$/i, '')
        .trim();
      if (rawByline && rawByline.length <= 60) bylineBrand = rawByline;
    }
    let overviewBrand: string | undefined;

    // 5. Product Overview Table (#productOverview_feature_div) + Technical Specs Table
    const specsList: string[] = [];
    const seenLabels = new Set<string>();
    let overviewColor: string | undefined;
    let overviewModel: string | undefined;

    const overviewIdx = html.indexOf('id="productOverview_feature_div"');
    if (overviewIdx !== -1) {
      const ovSlice = html.slice(overviewIdx, overviewIdx + 35000);
      const tableMatch = ovSlice.match(/<table[\s\S]*?<\/table>/i);
      const tableHtml = tableMatch?.[0] || ovSlice;
      const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
      for (const row of rows) {
        const tds = [...row[0].matchAll(/<td[\s\S]*?<\/td>/gi)];
        if (tds.length < 2) continue;
        const label = stripHtmlTags(tds[0][0]).replace(/:$/, '').trim();
        const value = stripHtmlTags(tds[1][0]).trim();
        if (!label || !value || label.length > 60 || value.length > 140) continue;
        const lowLabel = label.toLowerCase();
        if (lowLabel === 'marchio' || lowLabel === 'marca' || lowLabel === 'brand') {
          if (!overviewBrand) overviewBrand = value.slice(0, 60);
          continue;
        }
        if (lowLabel === 'colore' || lowLabel === 'color' || lowLabel === 'colour') {
          if (!overviewColor) overviewColor = value.slice(0, 60);
          continue;
        }
        if (
          lowLabel.includes('nome modello') ||
          lowLabel.includes('numero modello') ||
          lowLabel === 'modello'
        ) {
          if (!overviewModel) overviewModel = value.slice(0, 80);
        }
        if (!seenLabels.has(lowLabel)) {
          seenLabels.add(lowLabel);
          specsList.push(`${label}: ${value}`);
        }
      }
    }

    // Also parse #productDetails_techSpec_section_1 if present
    const techSpecIdx = html.indexOf('id="productDetails_techSpec_section_1"');
    if (techSpecIdx !== -1) {
      const tsSlice = html.slice(techSpecIdx, techSpecIdx + 35000);
      const tsMatch = tsSlice.match(/<table[\s\S]*?<\/table>/i);
      const tsHtml = tsMatch?.[0] || tsSlice;
      const rows = [...tsHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
      for (const row of rows) {
        const thM = row[0].match(/<th[\s\S]*?<\/th>/i);
        const tdM = row[0].match(/<td[\s\S]*?<\/td>/i);
        if (!thM || !tdM) continue;
        const label = stripHtmlTags(thM[0]).replace(/:$/, '').trim();
        const value = stripHtmlTags(tdM[0]).trim();
        if (!label || !value || label.length > 60 || value.length > 140) continue;
        const lowLabel = label.toLowerCase();
        if (lowLabel === 'marchio' || lowLabel === 'marca' || lowLabel === 'brand') {
          if (!overviewBrand) overviewBrand = value.slice(0, 60);
          continue;
        }
        if (lowLabel === 'colore' || lowLabel === 'color') {
          if (!overviewColor) overviewColor = value.slice(0, 60);
          continue;
        }
        if (lowLabel.includes('numero modello') || lowLabel.includes('modello')) {
          if (!overviewModel) overviewModel = value.slice(0, 80);
        }
        if (!seenLabels.has(lowLabel) && specsList.length < 12) {
          seenLabels.add(lowLabel);
          specsList.push(`${label}: ${value}`);
        }
      }
    }

    const brand =
      overviewBrand && (!bylineBrand || /amazon|renewed|ricondizionat/i.test(bylineBrand))
        ? overviewBrand
        : bylineBrand || overviewBrand;

    // 6. Color from Twister variation widget if not found in overview
    let color = overviewColor;
    if (!color) {
      const twisterAria = html.match(/aria-label=["']La Colore selezionat[ao] è ([^"']+)["']/i);
      if (twisterAria?.[1]) color = stripHtmlTags(twisterAria[1]).slice(0, 60);
    }
    if (!color) {
      const twisterDim = html.match(
        /inline-twister-expander-header-color_name[\s\S]{0,1200}?inline-twister-dim-title-value[^>]*>([\s\S]*?)<\/span>/i
      );
      if (twisterDim?.[1]) color = stripHtmlTags(twisterDim[1]).slice(0, 60);
    }
    if (!color) {
      const varColor = html.match(
        /id=["']variation_color_name["'][\s\S]{0,1000}?class=["']selection["'][^>]*>([\s\S]*?)<\/span>/i
      );
      if (varColor?.[1]) color = stripHtmlTags(varColor[1]).slice(0, 60);
    }

    // 7. Feature bullets (#feature-bullets)
    const bullets: string[] = [];
    const bulletsIdx = html.indexOf('id="feature-bullets"');
    if (bulletsIdx !== -1) {
      const bSlice = html.slice(bulletsIdx, bulletsIdx + 12000);
      const listMatch = bSlice.match(/<ul[\s\S]*?<\/ul>/i);
      if (listMatch?.[0]) {
        const lis = [...listMatch[0].matchAll(/<li[\s\S]*?<\/li>/gi)];
        for (const li of lis) {
          if (/id=["']replacementPartsFitmentBullet/i.test(li[0])) continue;
          const text = stripHtmlTags(li[0]);
          if (text && text.length >= 6) {
            bullets.push(text.slice(0, 220));
          }
        }
      }
    }

    const model =
      overviewModel && asin && !overviewModel.includes(asin)
        ? `${overviewModel} (${asin})`.slice(0, 80)
        : (overviewModel || asin || undefined)?.slice(0, 80);

    return {
      title,
      brand,
      imageUrl,
      priceEur,
      color,
      model,
      specsList,
      bullets,
    };
  }

  function isBlockedPageTitle(rawTitle: string): boolean {
    const t = rawTitle.toLowerCase().trim();
    if (!t) return true;
    return (
      t === 'amazon.it' ||
      t === 'amazon.com' ||
      t.includes('robot check') ||
      t.includes('captcha') ||
      t.includes('just a moment') ||
      t.includes('attention required') ||
      t.includes('access denied') ||
      t.includes('pardon our interruption') ||
      t.includes('verifica di sicurezza') ||
      t.includes('controllo di sicurezza') ||
      t.includes('page not found')
    );
  }

  function isBotChallengeHtml(html: string, status: number): boolean {
    if (status === 403 || status === 429 || status === 503) return true;
    const sample = html.slice(0, 15000).toLowerCase();
    return (
      sample.includes('validatecaptcha') ||
      sample.includes('captcha-delivery.com') ||
      sample.includes('datadome') ||
      sample.includes('please enable js and disable any ad blocker') ||
      sample.includes('cf-challenge') ||
      sample.includes('challenge-platform') ||
      sample.includes('px-captcha') ||
      sample.includes('enable javascript and cookies to continue')
    );
  }

  app.post('/api/researches/inspect', async (req, res) => {
    const rawInput = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawInput || rawInput.length > 1000) {
      res.status(400).json({ error: 'Incolla un link prodotto valido (max 1000 caratteri).' });
      return;
    }

    const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(withProtocol);
    } catch {
      res.status(400).json({ error: 'Il link inserito non sembra un URL valido.' });
      return;
    }

    if (
      (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') ||
      isPrivateOrLocalHostname(parsedUrl.hostname)
    ) {
      res.status(400).json({ error: 'URL non consentito.' });
      return;
    }

    const finalUrl = parsedUrl.toString().slice(0, 1000);
    const cacheKey = canonicalInspectCacheKey(parsedUrl);
    const forceRefresh = Boolean(req.body?.refresh);
    if (!forceRefresh) {
      const cached = inspectCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({ ...cached.data, url: finalUrl });
        return;
      }
    }

    const store = formatStoreFromHostname(parsedUrl.hostname);
    const urlDetails = extractDetailsFromProductUrl(parsedUrl, store);
    const amazonAsin = parsedUrl.hostname.toLowerCase().includes('amazon.')
      ? extractAmazonAsin(parsedUrl)
      : undefined;

    let title = '';
    let brand = '';
    let color = '';
    let model = amazonAsin || urlDetails.model || '';
    let imageUrl = '';
    let priceEur: number | undefined;
    let specs = '';
    let notes = '';
    let extractedFrom: 'page-meta' | 'url-slug' = 'url-slug';
    let blockedBySite = false;

    const fetchPageHtml = async (
      targetUrl: string,
      userAgentOverride?: string
    ): Promise<{ html: string; blocked: boolean }> => {
      const response = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(9500),
        headers: {
          'User-Agent':
            userAgentOverride ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache',
        },
      });
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const bodyText = contentType.includes('text/html')
        ? (await response.text()).slice(0, 3_000_000)
        : '';
      const blocked = isBotChallengeHtml(bodyText, response.status);
      if (!response.ok || !contentType.includes('text/html') || blocked) {
        return { html: '', blocked };
      }
      return { html: bodyText, blocked: false };
    };

    const hasUsableProductHtml = (candidateHtml: string): boolean => {
      if (!candidateHtml) return false;
      const pageTitle =
        extractMetaContent(candidateHtml, 'property', 'og:title') ||
        (candidateHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
      return !isBlockedPageTitle(pageTitle) || candidateHtml.includes('id="productTitle"');
    };

    try {
      const fetchRes = await fetchPageHtml(finalUrl);
      if (fetchRes.blocked) blockedBySite = true;
      let html = fetchRes.html;

      if (amazonAsin && !hasUsableProductHtml(html)) {
        const cleanAmazonUrl = `https://${parsedUrl.hostname}/dp/${amazonAsin}?th=1&psc=1`;
        const retryStrategies = [
          { url: cleanAmazonUrl, ua: 'WhatsApp/2.23.20.0' },
          {
            url: cleanAmazonUrl,
            ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          },
          {
            url: `https://${parsedUrl.hostname}/gp/aw/d/${amazonAsin}?th=1&psc=1`,
            ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
          },
        ];
        for (const strat of retryStrategies) {
          const retryRes = await fetchPageHtml(strat.url, strat.ua);
          if (hasUsableProductHtml(retryRes.html)) {
            html = retryRes.html;
            blockedBySite = false;
            break;
          }
        }
      }

      if (html) {
        const ld = extractProductFromJsonLd(html);
        const ogTitle =
          extractMetaContent(html, 'property', 'og:title') ||
          extractMetaContent(html, 'name', 'twitter:title');
        const htmlTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const htmlTitle = htmlTitleMatch?.[1] ? decodeHtmlEntities(htmlTitleMatch[1]) : '';
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const h1Title = h1Match?.[1] ? stripHtmlTags(h1Match[1]) : '';

        const amazonDom = parsedUrl.hostname.toLowerCase().includes('amazon.')
          ? extractAmazonDomDetails(html, amazonAsin)
          : null;

        // If Amazon desktop succeeded (image/specs) but price/color/title came back incomplete (e.g. Renewed / multi-seller BuyBox),
        // supplement missing fields from Mobile Amazon BuyBox (/gp/aw/d/{ASIN})
        let mobileDom: ReturnType<typeof extractAmazonDomDetails> | null = null;
        if (
          amazonAsin &&
          (amazonDom?.priceEur === undefined || !amazonDom?.title || !amazonDom?.imageUrl)
        ) {
          try {
            const mobileRes = await fetchPageHtml(
              `https://${parsedUrl.hostname}/gp/aw/d/${amazonAsin}?th=1&psc=1`,
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
            );
            if (mobileRes.html) {
              mobileDom = extractAmazonDomDetails(mobileRes.html, amazonAsin);
            }
          } catch {
            // ignore mobile fallback failure
          }
        }

        const candidateTitle =
          amazonDom?.title || mobileDom?.title || ld.title || ogTitle || htmlTitle || h1Title;
        if (candidateTitle && !isBlockedPageTitle(candidateTitle)) {
          title = candidateTitle
            .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
            .replace(
              /\s*[:|-]\s*(?:Amazon\.it|Amazon\.com|eBay|MediaWorld|Unieuro|IKEA Italia|Euronics|Electrolux|AEG|Maisons du Monde|Zara Home|Westwing|Kave Home|Sklum)(?:\s*:\s*[^:|]+)?\s*$/i,
              ''
            )
            .trim()
            .slice(0, 160);
          extractedFrom = 'page-meta';
          blockedBySite = false;
        } else if (isBlockedPageTitle(candidateTitle)) {
          blockedBySite = true;
        }

        const ogImage =
          amazonDom?.imageUrl ||
          mobileDom?.imageUrl ||
          ld.imageUrl ||
          extractMetaContent(html, 'property', 'og:image') ||
          extractMetaContent(html, 'property', 'og:image:secure_url') ||
          extractMetaContent(html, 'name', 'twitter:image');
        if (ogImage && /^https?:\/\//i.test(ogImage) && !isBlockedPageTitle(candidateTitle)) {
          imageUrl = ogImage.slice(0, 1000);
        }

        const itemPropPriceM = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
        priceEur =
          amazonDom?.priceEur ??
          mobileDom?.priceEur ??
          ld.priceEur ??
          parsePriceNumber(extractMetaContent(html, 'property', 'product:price:amount')) ??
          parsePriceNumber(extractMetaContent(html, 'property', 'og:price:amount')) ??
          parsePriceNumber(itemPropPriceM?.[1]);

        brand = (
          amazonDom?.brand ||
          mobileDom?.brand ||
          ld.brand ||
          extractMetaContent(html, 'property', 'product:brand') ||
          extractMetaContent(html, 'name', 'brand') ||
          ''
        )
          .trim()
          .slice(0, 60);

        const itemPropColorM = html.match(/itemprop=["']color["'][^>]*content=["']([^"']+)["']/i);
        color = (
          amazonDom?.color ||
          mobileDom?.color ||
          ld.color ||
          extractMetaContent(html, 'property', 'product:color') ||
          itemPropColorM?.[1] ||
          ''
        )
          .trim()
          .slice(0, 60);

        if (amazonDom?.model) {
          model = amazonDom.model;
        } else if (mobileDom?.model) {
          model = mobileDom.model;
        } else if (ld.model) {
          model = ld.model;
        }

        const mergedSpecsList =
          amazonDom?.specsList.length ? amazonDom.specsList : mobileDom?.specsList || [];
        const mergedBullets =
          amazonDom?.bullets.length ? amazonDom.bullets : mobileDom?.bullets || [];

        const specsLines: string[] = [];
        if (mergedSpecsList.length) {
          specsLines.push(...mergedSpecsList);
        }
        if (mergedBullets.length) {
          for (const b of mergedBullets.slice(0, 4)) {
            specsLines.push(`• ${b}`);
          }
        }
        const metaDesc =
          ld.description ||
          extractMetaContent(html, 'property', 'og:description') ||
          extractMetaContent(html, 'name', 'description');

        if (specsLines.length > 0) {
          specs = specsLines.join('\n').slice(0, 780);
        } else if (metaDesc && !isBlockedPageTitle(candidateTitle)) {
          specs = metaDesc.slice(0, 780);
        }

        if (metaDesc && !isBlockedPageTitle(candidateTitle)) {
          const cleanMeta = metaDesc
            .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const titleHead = title.slice(0, 32).toLowerCase();
          const isRedundantAmazonTitle =
            cleanMeta.toLowerCase().includes(': amazon.') ||
            (titleHead.length >= 10 && cleanMeta.toLowerCase().startsWith(titleHead));
          if (cleanMeta && !isRedundantAmazonTitle) {
            notes = cleanMeta.slice(0, 360);
          }
        }
        if (!notes && mergedBullets.length && !specs) {
          notes = mergedBullets[0].slice(0, 360);
        }
      }
    } catch {
      // Fall back gracefully to online enrichment or URL slug extraction below
    }

    // Online grounding fallback via Gemini when page blocked / JS-rendered / sparse
    if (
      (extractedFrom !== 'page-meta' || (!priceEur && !specs && !color)) &&
      getGeminiClient()
    ) {
      try {
        const ai = getGeminiClient();
        if (ai) {
          const searchPrompt = [
            `Cerca informazioni reali e verificabili sul prodotto a questo URL: ${finalUrl}`,
            amazonAsin ? `ASIN Amazon: ${amazonAsin}` : '',
            urlDetails.title ? `Parole chiave dall'URL: ${urlDetails.title}` : '',
            'Usa Google Search e restituisci SOLO un oggetto JSON valido con i soli campi realmente trovati nelle fonti (ometti o lascia stringa vuota/null ciò che non trovi):',
            '- title: nome completo del prodotto in italiano (max 160 caratteri)',
            '- brand: marca ufficiale (max 60 caratteri)',
            '- color: colore o finitura del prodotto in italiano (max 60 caratteri)',
            '- model: codice modello o ASIN (max 80 caratteri)',
            '- priceEur: numero prezzo attuale in EUR se chiaramente presente nella fonte (altrimenti null)',
            '- specs: 3-5 righe sintetiche con specifiche utili dal sito: compatibilità, materiale, dimensioni, caratteristiche principali (max 750 caratteri)',
          ]
            .filter(Boolean)
            .join('\n');

          const aiRes = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: searchPrompt,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });

          const enriched = extractJsonFromText<{
            title?: string;
            brand?: string;
            color?: string;
            model?: string;
            priceEur?: number | string | null;
            specs?: string;
          }>(aiRes.text || '');

          if (enriched) {
            if (!title && typeof enriched.title === 'string' && enriched.title.trim()) {
              title = enriched.title.trim().slice(0, 160);
              extractedFrom = 'page-meta';
            }
            if (!brand && typeof enriched.brand === 'string' && enriched.brand.trim()) {
              brand = enriched.brand.trim().slice(0, 60);
            }
            if (!color && typeof enriched.color === 'string' && enriched.color.trim()) {
              color = enriched.color.trim().slice(0, 60);
            }
            if (!model && typeof enriched.model === 'string' && enriched.model.trim()) {
              model = enriched.model.trim().slice(0, 80);
            }
            if (priceEur === undefined) {
              priceEur = parsePriceNumber(enriched.priceEur);
            }
            if (!specs && typeof enriched.specs === 'string' && enriched.specs.trim()) {
              specs = enriched.specs.trim().slice(0, 780);
            }
          }
        }
      } catch (err) {
        if (isQuotaOrRateError(err)) {
          geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
      }
    }

    if (!title) {
      title = urlDetails.title;
    }
    if (!color && urlDetails.color) {
      color = urlDetails.color;
    }
    if (!specs && urlDetails.specs) {
      specs = urlDetails.specs;
    }
    brand =
      inferProductBrandServer({
        title,
        url: finalUrl,
        store,
        brand,
        specs,
      }) || '';

    const category = inferResearchCategory(`${title} ${brand} ${specs} ${finalUrl}`);

    const payload = {
      url: finalUrl,
      title: title.slice(0, 160),
      store: store.slice(0, 60),
      category,
      priceEur,
      imageUrl: imageUrl || undefined,
      brand: brand || undefined,
      color: color || undefined,
      model: model || undefined,
      specs: specs || undefined,
      notes: notes || undefined,
      extractedFrom,
      blockedBySite,
    };

    if (extractedFrom === 'page-meta') {
      inspectCache.set(cacheKey, { expiresAt: Date.now() + INSPECT_CACHE_TTL_MS, data: payload });
    }

    res.json(payload);
  });

  const httpServer = http.createServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
