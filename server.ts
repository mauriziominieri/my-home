import 'dotenv/config';
import express from 'express';
import http from 'http';
import https from 'https';
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
      [/\b(?:nardi|nardi\s*outdoor|nardioutdoor)\b/i, 'Nardi'],
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

    // Extract trailing multi-segment numeric catalog IDs (e.g., Nardi _211_300) or single SKU/article number
    const multiNumMatch = slug.match(/^(.+?)[-_](\d{2,6}(?:[-_]\d{2,6})+)$/);
    if (multiNumMatch && multiNumMatch[1].length >= 4) {
      slug = multiNumMatch[1];
      extractedModel = multiNumMatch[2];
    } else {
      const skuMatch = slug.match(/^(.+?)[-_](?:id[-_]?|p[-_]?)?(s?\d{5,10})$/i);
      if (skuMatch && skuMatch[1].length >= 4) {
        slug = skuMatch[1];
        extractedModel = skuMatch[2].toUpperCase();
      }
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
      specs: specsLines.length > 0 ? truncateAtWordBoundary(specsLines.join('\n'), 1850) : undefined,
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
    if (/(divano|tavolo|sedia|armadio|lampada|materasso|tappeto|cucina|arredo|arredamento|mobili|scrivania|scaffale|specchio|statuetta|busto|scultura|soprammobile|vaso|cornice|quadro|candela|portacandele|cuscino|plaid|tenda|poltrona|pouf|libreria|comodino|credenza|cassettiera|mensola|cemento|ceramica|maisonsdumonde|zarahome|westwing|kavehome|sklum|mondoconv|laredoute|conforama|nardioutdoor)/.test(t)) {
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

  type ResearchRoomIdServer =
    | 'salone'
    | 'cucina'
    | 'bagno1'
    | 'bagno2'
    | 'stanza_maurizio'
    | 'stanza_roberta'
    | 'stanza_matrimoniale'
    | 'terrazza_ovest'
    | 'terrazza_est';

  const RESEARCH_ROOM_ALIASES_SERVER: Record<string, ResearchRoomIdServer> = {
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

  function normalizeResearchRoomServer(raw?: string | null): ResearchRoomIdServer | undefined {
    if (!raw) return undefined;
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key || key === 'nessuna' || key === 'nessuna stanza' || key === 'none' || key === 'null') {
      return undefined;
    }
    return RESEARCH_ROOM_ALIASES_SERVER[key];
  }

  const NON_ROOM_PRODUCT_RE_SERVER =
    /\b(?:iphone|smartphone|cellulare|telefono\s+cellulare|galaxy\s+(?:s\d|a\d|m\d|z\s*fold|z\s*flip|tab|buds|watch)|pixel\s*\d|xiaomi\s+(?:\d|redmi|poco)|redmi\s+\d|oneplus\s+\d|ipad|tablet|kindle|kobo|smartwatch|apple\s+watch|garmin|fitbit|airpods|auricolari|cuffie(?:\s+bluetooth|\s+wireless|\s+in-ear|\s+over-ear)?|power\s*bank|cover|custodia|pellicola|vetro\s+temperato|caricabatterie\s+portatile|magsafe|airtag|macbook|notebook|laptop|pc\s+portatile|chromebook|ultrabook|pneumatici|gomme\s+auto|catene\s+da\s+neve|portabici|seggiolino\s+auto|autoradio|dash\s*cam|scarpe|sneakers|stivali|sandali|giacca|giubbotto|cappotto|pantaloni|jeans|maglia|maglietta|t-shirt|felpa|camicia|vestito|gonna|zaino|valigia|trolley|borsa|portafoglio|occhiali\s+da\s+sole|bicicletta|monopattino|tosaerba|tagliaerba|decespugliatore|motosega|barbecue|ombrellone|sdraio)\b/i;

  const OUTDOOR_GUARD_RE_SERVER = /\b(?:da\s+)?(?:giardino|esterno|esterni|terrazzo|balcone)\b|outdoor/i;
  const BOOK_GUARD_RE_SERVER = /\b(?:libro|libri|ricettario|ebook|audiolibro|rivista)\b/i;

  const BATHROOM_ROOM_RE_SERVER =
    /\b(?:lavatrice|lavatrici|lavasciuga|asciugatrice|asciugatrici|washing\s+machine|tumble\s+dryer|colonna\s+bucato|cesta\s+(?:per\s+)?biancheria|portabiancheria|cesto\s+biancheria|stendibiancheria\s+elettrico|asse\s+da\s+stiro|mobile\s+(?:da\s+|per\s+)?bagno|mobili\s+bagno|arredo\s+bagno|sottolavabo|colonna\s+bagno|pensile\s+bagno|specchio\s+(?:da\s+)?bagno|specchiera\s+bagno|lavabo|lavandino\s+(?:da\s+)?bagno|sanitari|vaso\s+wc|wc\s+(?:sospeso|a\s+terra|filo\s+muro)|bidet|copriwater|sedile\s+wc|box\s+doccia|cabina\s+doccia|piatto\s+doccia|colonna\s+doccia|soffione\s+doccia|doccetta|saliscendi\s+doccia|parete\s+doccia|vasca\s+da\s+bagno|rubinetto\s+(?:da\s+)?bagno|miscelatore\s+(?:bagno|lavabo|bidet|doccia|vasca)|termoarredo|scaldasalviette|portasciugamani|porta\s*rotolo|portarotolo|dispenser\s+sapone|portasapone|portaspazzolini|scopino\s+wc|scopino\s+bagno|tenda\s+doccia|tappeto\s+bagno|tappetino\s+bagno|set\s+asciugamani|asciugamani\s+bagno|accappatoio|asciugacapelli|phon\s+capelli|spazzolino\s+elettrico)\b/i;

  const KITCHEN_ROOM_RE_SERVER =
    /\b(?:cucina(?:\s+(?:completa|lineare|angolare|componibile|modulare|moderna|classica|su\s+misura|con\s+elettrodomestici))?|cucine|mobile\s+cucina|basi\s+cucina|pensile\s+cucina|pensili\s+cucina|isola\s+cucina|penisola\s+cucina|top\s+cucina|piano\s+(?:da\s+|di\s+lavoro\s+)?cucina|alzatina\s+cucina|paraschizzi|credenza\s+(?:da\s+)?cucina|carrello\s+(?:da\s+)?cucina|tavolo\s+(?:da\s+)?cucina|sgabelli\s+(?:da\s+)?cucina|piano\s+(?:a\s+|ad\s+)?induzione|piano\s+cottura|piani\s+cottura|piano\s+(?:a\s+)?gas|induction\s+hob|forno\s+(?:da\s+incasso|elettrico|ventilato|pirolitico|a\s+vapore|a\s+microonde|pizza)|fornetto(?:\s+elettrico)?|microonde|lavastoviglie|dishwasher|frigorifero|frigoriferi|frigo(?:\s+(?:combinato|americano|side\s+by\s+side|monoporta|doppia\s+porta|da\s+incasso|sottotop))?|congelatore|freezer|abbattitore|cantinetta\s+vini|cappa(?:\s+(?:aspirante|filtrante|cucina|arredo|telescopica|sottopensile|a\s+isola|da\s+parete|ad\s+incasso))?|lavello(?:\s+cucina)?|vasca\s+lavello|miscelatore\s+(?:da\s+)?cucina|rubinetto\s+(?:da\s+)?cucina|pattumiera\s+(?:cucina|differenziata|sottolavello)|friggitrice(?:\s+ad\s+aria)?|air\s+fryer|macchina\s+(?:da|del|per)\s+caff[eè]|macchina\s+caff[eè]|nespresso|lavazza\s+a\s+modo\s+mio|tostapane|bollitore(?:\s+elettrico)?|robot\s+da\s+cucina|impastatrice|planetaria|frullatore|minipimer|estrattore\s+(?:di\s+)?succo|centrifuga|bimby|thermomix|affettatrice|bilancia\s+(?:da\s+)?cucina|montalatte|vaporiera|cuociriso|pentola|pentole|padella|padelle|casseruola|tegame|wok|bistecchiera|piastra\s+(?:per\s+)?(?:panini|waffle|crepes)|scolapiatti|portaposate|ceppo\s+coltelli|coltelli\s+da\s+cucina|servizio\s+(?:di\s+)?piatti|servizio\s+(?:di\s+)?posate|posate|tagliere)\b/i;

  const LIVING_ROOM_RE_SERVER =
    /\b(?:divano|divani|divano\s+letto|divano\s+angolare|sof[aà]|copridivano|poltrona(?:\s+relax|\s+reclinabile|\s+letto|\s+da\s+salotto)?|chaise\s+longue|pouf(?:\s+contenitore)?|parete\s+attrezzata|mobile\s+(?:tv|porta\s*tv|soggiorno|salotto|salone)|porta\s*tv|tavolino\s+(?:da\s+)?(?:salotto|soggiorno|fumo|caff[eè]|basso|divano)|madia|credenza\s+(?:moderna|soggiorno|salotto|design)|libreria\s+(?:soggiorno|salotto|da\s+parete|modulare)|tavolo\s+da\s+pranzo|tavolo\s+allungabile|tavolo\s+soggiorno|sedie\s+(?:da\s+)?(?:pranzo|soggiorno|salotto)|sedia\s+da\s+pranzo|consolle\s+(?:allungabile|ingresso|soggiorno)|camino|caminetto|bioetanolo|smart\s*tv|oled\s*(?:tv|evo)?|qled|qned|miniled|tv\s+\d{2}\s*(?:pollici|["”])|televisore|televisori|soundbar|home\s+theater|home\s+theatre|home\s+cinema|staffa\s+(?:a\s+muro\s+per\s+)?tv|supporto\s+tv)\b/i;

  const MASTER_BEDROOM_RE_SERVER =
    /\b(?:letto\s+matrimoniale|letto\s+contenitore\s+matrimoniale|testiera\s+matrimoniale|rete\s+matrimoniale|materasso\s+matrimoniale|topper\s+matrimoniale|copripiumino\s+matrimoniale|piumone\s+matrimoniale|lenzuola\s+matrimoniali|completo\s+lenzuola\s+matrimoniale|trapunta\s+matrimoniale|copriletto\s+matrimoniale|king\s*size|materasso\s+(?:160|180)\s*x\s*(?:190|200)|letto\s+(?:160|180)\s*x\s*(?:190|200))\b/i;

  function extractUrlSlugTextServer(rawUrl?: string): string {
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

  function extractStructuredSpecTextServer(specs?: string): string {
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

  function matchRoomFromProductTextServer(text: string): ResearchRoomIdServer | undefined {
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

    if (NON_ROOM_PRODUCT_RE_SERVER.test(clean) || OUTDOOR_GUARD_RE_SERVER.test(clean)) {
      return undefined;
    }

    if (BATHROOM_ROOM_RE_SERVER.test(clean)) return 'bagno1';
    if (!BOOK_GUARD_RE_SERVER.test(clean) && KITCHEN_ROOM_RE_SERVER.test(clean)) return 'cucina';
    if (LIVING_ROOM_RE_SERVER.test(clean)) return 'salone';
    if (MASTER_BEDROOM_RE_SERVER.test(clean)) return 'stanza_matrimoniale';

    return undefined;
  }

  function inferResearchRoomServer(input: {
    title?: string;
    url?: string;
    specs?: string;
    category?: string;
  }): ResearchRoomIdServer | undefined {
    if (input.category === 'auto' || input.category === 'abbigliamento') {
      return undefined;
    }

    const primaryText = `${input.title || ''} ${extractUrlSlugTextServer(input.url)}`.trim();
    const explicitOrKomodo = matchRoomFromProductTextServer(primaryText);
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
      NON_ROOM_PRODUCT_RE_SERVER.test(primaryText) ||
      OUTDOOR_GUARD_RE_SERVER.test(`${primaryText} ${input.url || ''}`)
    ) {
      return undefined;
    }

    if (explicitOrKomodo) return explicitOrKomodo;

    const structuredSpecs = extractStructuredSpecTextServer(input.specs);
    if (structuredSpecs && !NON_ROOM_PRODUCT_RE_SERVER.test(structuredSpecs)) {
      return matchRoomFromProductTextServer(structuredSpecs);
    }

    return undefined;
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

  function truncateAtWordBoundary(raw: string, maxLen: number): string {
    const clean = raw
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (clean.length <= maxLen) return clean;
    const slice = clean.slice(0, maxLen).trimEnd();
    const minSentenceCut = Math.min(45, Math.floor(maxLen * 0.25));
    let lastSentenceEnd = -1;
    const sentenceEndRe = /[.!?](?=\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = sentenceEndRe.exec(slice)) !== null) {
      if (match.index >= minSentenceCut) {
        lastSentenceEnd = match.index;
      }
    }
    if (lastSentenceEnd >= minSentenceCut) {
      return slice.slice(0, lastSentenceEnd + 1).trim();
    }
    const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
    const cut = lastBreak > Math.floor(maxLen * 0.35) ? slice.slice(0, lastBreak) : slice;
    return `${cut.replace(/[,:;—–-]+$/, '').trim()}…`;
  }

  function buildBoundedSpecsText(
    specsList: string[],
    bullets: string[],
    maxLen = 1850
  ): string {
    const lines: string[] = [];
    let currentLen = 0;

    for (const specLine of specsList) {
      const cleanSpec = specLine.replace(/\s+/g, ' ').trim();
      if (!cleanSpec) continue;
      const addedLen = (lines.length > 0 ? 1 : 0) + cleanSpec.length;
      if (currentLen + addedLen > maxLen) break;
      lines.push(cleanSpec);
      currentLen += addedLen;
    }

    const selectedBullets = bullets.slice(0, 4);
    for (let i = 0; i < selectedBullets.length; i += 1) {
      const remaining = maxLen - currentLen - (lines.length > 0 ? 1 : 0);
      if (remaining < 75) break;
      const remainingBullets = selectedBullets.length - i;
      const fairBudget = Math.max(
        240,
        Math.min(450, Math.floor((remaining - (remainingBullets - 1) * 3) / remainingBullets))
      );
      const bulletBudget = Math.min(remaining - 2, fairBudget);
      if (bulletBudget < 65) break;
      const trimmedBullet = truncateAtWordBoundary(selectedBullets[i], bulletBudget);
      const formatted = `• ${trimmedBullet}`;
      lines.push(formatted);
      currentLen += (lines.length > 1 ? 1 : 0) + formatted.length;
    }

    return lines.join('\n');
  }

  function extractBalancedJsonLiteral<T>(
    source: string,
    openChar: '{' | '[',
    closeChar: '}' | ']',
    startIndex: number
  ): T | undefined {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIndex; i < source.length && i < startIndex + 250_000; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === openChar) {
        depth += 1;
      } else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(startIndex, i + 1)) as T;
          } catch {
            return undefined;
          }
        }
      }
    }
    return undefined;
  }

  function extractAllJsonAfterKey<T>(
    source: string,
    keyName: string,
    openChar: '{' | '[',
    closeChar: '}' | ']'
  ): T[] {
    const escapedKey = keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:["']${escapedKey}["']|\\b${escapedKey})\\s*:\\s*\\${openChar}`, 'g');
    const results: T[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const braceIdx = match.index + match[0].length - 1;
      const parsed = extractBalancedJsonLiteral<T>(source, openChar, closeChar, braceIdx);
      if (parsed !== undefined) results.push(parsed);
    }
    return results;
  }

  function extractJsonAfterKey<T>(
    source: string,
    keyName: string,
    openChar: '{' | '[',
    closeChar: '}' | ']'
  ): T | undefined {
    return extractAllJsonAfterKey<T>(source, keyName, openChar, closeChar)[0];
  }

  function extractBestAmazonMediaUrl(entry: {
    hiRes?: unknown;
    large?: unknown;
    main?: unknown;
  }): string | undefined {
    if (typeof entry.hiRes === 'string' && /^https?:\/\//i.test(entry.hiRes)) {
      return entry.hiRes.slice(0, 1000);
    }
    if (entry.main && typeof entry.main === 'object' && !Array.isArray(entry.main)) {
      const bestMain = Object.entries(entry.main as Record<string, unknown>)
        .filter(([u, dims]) => /^https?:\/\//i.test(u) && Array.isArray(dims))
        .sort(([, a], [, b]) => {
          const da = a as number[];
          const db = b as number[];
          return (db[0] || 0) * (db[1] || 0) - (da[0] || 0) * (da[1] || 0);
        });
      if (bestMain[0]?.[0]) return bestMain[0][0].slice(0, 1000);
    }
    if (typeof entry.large === 'string' && /^https?:\/\//i.test(entry.large)) {
      return entry.large.slice(0, 1000);
    }
    return undefined;
  }

  function sanitizeColorImagesMap(raw: unknown): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Object.keys(out).length >= 24) break;
      const cleanKey = stripHtmlTags(String(k)).replace(/\s+/g, ' ').trim().slice(0, 60);
      const cleanVal = typeof v === 'string' ? v.trim().slice(0, 1000) : '';
      if (!cleanKey || !/^https?:\/\/.+/.test(cleanVal)) continue;
      out[cleanKey] = cleanVal;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function sanitizeSizePricesMapServer(raw: unknown): Record<string, number> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Object.keys(out).length >= 24) break;
      const cleanKey = stripHtmlTags(String(k)).replace(/\s+/g, ' ').trim().slice(0, 60);
      const parsed = parsePriceNumber(v);
      if (!cleanKey || parsed === undefined) continue;
      out[cleanKey] = Math.round(parsed * 100) / 100;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function normalizeOptionList(rawList: unknown, maxItems = 24): string[] {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of rawList) {
      if (typeof entry !== 'string' && typeof entry !== 'number') continue;
      const clean = stripHtmlTags(String(entry)).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
      if (out.length >= maxItems) break;
    }
    return out;
  }

  function extractProductFromJsonLd(html: string): {
    title?: string;
    brand?: string;
    color?: string;
    availableColors?: string[];
    colorImages?: Record<string, string>;
    size?: string;
    availableSizes?: string[];
    sizePrices?: Record<string, number>;
    model?: string;
    imageUrl?: string;
    priceEur?: number;
    description?: string;
    specsList?: string[];
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

          const variantColors: string[] = [];
          const color =
            typeof obj.color === 'string' ? decodeHtmlEntities(obj.color).slice(0, 60) : undefined;
          if (Array.isArray(obj.color)) {
            for (const c of obj.color) {
              if (typeof c === 'string' && c.trim()) {
                variantColors.push(decodeHtmlEntities(c).trim());
              }
            }
          }
          const size =
            typeof obj.size === 'string' ? decodeHtmlEntities(obj.size).slice(0, 60) : undefined;
          const variantSizes: string[] = [];
          const variantColorImages: Record<string, string> = {};
          const variantSizePrices: Record<string, number> = {};
          const readLdImg = (rawImg: unknown): string | undefined => {
            if (typeof rawImg === 'string' && /^https?:\/\//i.test(rawImg)) return rawImg.slice(0, 1000);
            if (Array.isArray(rawImg)) {
              const first = rawImg.find((x) => typeof x === 'string' && /^https?:\/\//i.test(x));
              if (typeof first === 'string') return first.slice(0, 1000);
            } else if (
              rawImg &&
              typeof rawImg === 'object' &&
              typeof (rawImg as Record<string, unknown>).url === 'string'
            ) {
              const u = String((rawImg as Record<string, unknown>).url);
              if (/^https?:\/\//i.test(u)) return u.slice(0, 1000);
            }
            return undefined;
          };
          if (Array.isArray(obj.hasVariant)) {
            for (const v of obj.hasVariant) {
              if (!v || typeof v !== 'object') continue;
              const vo = v as Record<string, unknown>;
              if (typeof vo.color === 'string') {
                variantColors.push(vo.color);
                const vCol = stripHtmlTags(vo.color).replace(/\s+/g, ' ').trim().slice(0, 60);
                const vImg = readLdImg(vo.image);
                if (vCol && vImg && !variantColorImages[vCol] && Object.keys(variantColorImages).length < 24) {
                  variantColorImages[vCol] = vImg;
                }
              }
              if (typeof vo.size === 'string') {
                variantSizes.push(vo.size);
                const vSz = stripHtmlTags(vo.size).replace(/\s+/g, ' ').trim().slice(0, 60);
                const voOffers = Array.isArray(vo.offers) ? vo.offers[0] : vo.offers;
                if (vSz && voOffers && typeof voOffers === 'object') {
                  const oo = voOffers as Record<string, unknown>;
                  const vPrice =
                    parsePriceNumber(oo.price) ??
                    parsePriceNumber(oo.lowPrice) ??
                    parsePriceNumber(oo.highPrice);
                  if (vPrice !== undefined && Object.keys(variantSizePrices).length < 24) {
                    variantSizePrices[vSz] = vPrice;
                  }
                }
              }
            }
          }
          const availableColors = normalizeOptionList(variantColors);
          const availableSizes = normalizeOptionList(variantSizes);

          const rawModel = obj.model ?? obj.mpn ?? obj.sku;
          const model =
            typeof rawModel === 'string' ? decodeHtmlEntities(rawModel).slice(0, 80) : undefined;

          const imageUrl = readLdImg(obj.image);

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

          const specsList: string[] = [];
          const seenLdLabels = new Set<string>();
          const pushLdSpec = (label: string, val: unknown) => {
            if (!label || specsList.length >= 16) return;
            let textVal = '';
            if (typeof val === 'string' || typeof val === 'number') {
              textVal = stripHtmlTags(String(val)).replace(/\s+/g, ' ').trim();
            } else if (val && typeof val === 'object' && !Array.isArray(val)) {
              const vo = val as Record<string, unknown>;
              const qVal = vo.value ?? vo.name;
              const qUnit = vo.unitText ?? vo.unitCode;
              if (qVal !== undefined && qVal !== null) {
                textVal = `${stripHtmlTags(String(qVal)).trim()}${
                  typeof qUnit === 'string' && qUnit.trim() ? ` ${qUnit.trim()}` : ''
                }`.trim();
              }
            }
            if (!textVal || textVal.length > 180) return;
            const cleanLabel = stripHtmlTags(label).replace(/:$/, '').trim();
            if (!cleanLabel || cleanLabel.length > 50) return;
            const low = cleanLabel.toLowerCase();
            if (seenLdLabels.has(low)) return;
            seenLdLabels.add(low);
            specsList.push(`${cleanLabel}: ${textVal}`);
          };

          if (obj.material) pushLdSpec('Materiale', obj.material);
          if (obj.pattern) pushLdSpec('Finitura', obj.pattern);
          if (obj.width) pushLdSpec('Larghezza', obj.width);
          if (obj.height) pushLdSpec('Altezza', obj.height);
          if (obj.depth) pushLdSpec('Profondità', obj.depth);
          if (obj.weight) pushLdSpec('Peso', obj.weight);
          if (Array.isArray(obj.additionalProperty)) {
            for (const prop of obj.additionalProperty) {
              if (!prop || typeof prop !== 'object') continue;
              const po = prop as Record<string, unknown>;
              if (typeof po.name === 'string') {
                pushLdSpec(po.name, po.value !== undefined ? po : po.valueText);
              }
            }
          }

          if (title || priceEur || imageUrl || specsList.length > 0) {
            return {
              title,
              brand,
              color,
              availableColors: availableColors.length > 0 ? availableColors : undefined,
              colorImages:
                Object.keys(variantColorImages).length > 0 ? variantColorImages : undefined,
              size,
              availableSizes: availableSizes.length > 0 ? availableSizes : undefined,
              sizePrices:
                Object.keys(variantSizePrices).length > 0 ? variantSizePrices : undefined,
              model,
              imageUrl,
              priceEur,
              description,
              specsList: specsList.length > 0 ? specsList : undefined,
            };
          }
        }
      } catch {
        // ignore invalid JSON-LD block
      }
    }
    return {};
  }

  function extractAmazonAStateJson<T>(html: string, stateKey: string): T | null {
    const regex = /<script\b[^>]*\bdata-a-state=(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(regex)) {
      const attrRaw = match[2].replace(/&quot;/g, '"');
      if (!attrRaw.includes(`"${stateKey}"`)) continue;
      try {
        const meta = JSON.parse(attrRaw) as { key?: string };
        if (meta.key !== stateKey) continue;
        const body = match[3].trim();
        if (!body) continue;
        return JSON.parse(body) as T;
      } catch {
        // ignore malformed a-state block
      }
    }
    return null;
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

  function extractAmazonBuyboxPrice(html: string): number | undefined {
    let priceEur: number | undefined;
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
    return priceEur;
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
    availableColors: string[];
    colorImages: Record<string, string>;
    size?: string;
    availableSizes: string[];
    sizeAsinCandidates: Record<string, string[]>;
    colorAsinCandidates: Record<string, string>;
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

    // 2. High-res Primary Image (#landingImage / #imgBlkFront / #main-image / colorImages.initial[0])
    let imageUrl: string | undefined;
    let heroImgTag = '';
    const landingIdx = html.search(/id=["'](?:landingImage|imgBlkFront|main-image)["']/i);
    if (landingIdx !== -1) {
      const imgOpen = html.lastIndexOf('<img', landingIdx);
      const imgClose = html.indexOf('>', landingIdx);
      if (imgOpen !== -1 && imgClose !== -1 && imgClose - imgOpen < 8000) {
        heroImgTag = html.slice(imgOpen, imgClose + 1);
      }
    }

    if (heroImgTag) {
      const oldHires = heroImgTag.match(/data-old-hires=["'](https?:\/\/[^"']+)["']/i);
      if (oldHires?.[1]) {
        imageUrl = decodeHtmlEntities(oldHires[1]);
      }
      if (!imageUrl) {
        const aHires = heroImgTag.match(/data-a-hires=["'](https?:\/\/[^"']+)["']/i);
        if (aHires?.[1]) {
          imageUrl = decodeHtmlEntities(aHires[1]);
        }
      }
    }

    if (!imageUrl) {
      const colorImagesIdx = html.search(/['"]?colorImages['"]?\s*:\s*\{/i);
      if (colorImagesIdx !== -1) {
        const ciSlice = html.slice(colorImagesIdx, colorImagesIdx + 60_000);
        const initialMatch = ciSlice.match(/['"]initial['"]\s*:\s*(?:A\.\$\.parseJSON\(['"])?\[/);
        if (initialMatch && typeof initialMatch.index === 'number') {
          const arrStart = initialMatch.index + initialMatch[0].length - 1;
          const initialArr = extractBalancedJsonLiteral<
            Array<{
              hiRes?: string;
              large?: string;
              main?: Record<string, [number, number]>;
            }>
          >(ciSlice, '[', ']', arrStart);
          const firstImg = Array.isArray(initialArr) ? initialArr[0] : undefined;
          if (firstImg) {
            if (typeof firstImg.hiRes === 'string' && /^https?:\/\//i.test(firstImg.hiRes)) {
              imageUrl = firstImg.hiRes;
            } else if (firstImg.main && typeof firstImg.main === 'object') {
              const bestMain = Object.entries(firstImg.main)
                .filter(([u, dims]) => /^https?:\/\//i.test(u) && Array.isArray(dims))
                .sort(([, a], [, b]) => (b[0] || 0) * (b[1] || 0) - (a[0] || 0) * (a[1] || 0));
              if (bestMain[0]?.[0]) imageUrl = bestMain[0][0];
            } else if (typeof firstImg.large === 'string' && /^https?:\/\//i.test(firstImg.large)) {
              imageUrl = firstImg.large;
            }
          }
        }
      }
    }

    if (!imageUrl && heroImgTag) {
      const dynAttr = heroImgTag.match(/data-a-dynamic-image=["']([^"']+)["']/i);
      if (dynAttr?.[1]) {
        try {
          const dynJson = JSON.parse(decodeHtmlEntities(dynAttr[1])) as Record<
            string,
            [number, number]
          >;
          const sorted = Object.entries(dynJson)
            .filter(([u, dims]) => /^https?:\/\//i.test(u) && Array.isArray(dims))
            .sort(([, a], [, b]) => (b[0] || 0) * (b[1] || 0) - (a[0] || 0) * (a[1] || 0));
          if (sorted[0]?.[0]) imageUrl = sorted[0][0];
        } catch {
          // ignore
        }
      }
      if (!imageUrl) {
        const srcAttr = heroImgTag.match(
          /(?:data-a-image-source|\bsrc)=["'](https?:\/\/m\.media-amazon\.com\/images\/I\/[^"']+)["']/i
        );
        if (srcAttr?.[1]) imageUrl = decodeHtmlEntities(srcAttr[1]);
      }
    }

    if (!imageUrl) {
      const hiResMatch = html.match(
        /"(?:hiRes|large)"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i
      );
      if (hiResMatch?.[1]) imageUrl = hiResMatch[1];
    }

    // 3. Price (twister-plus-buying-options-price-data / .priceToPay / #corePriceDisplay_desktop_feature_div)
    const priceEur = extractAmazonBuyboxPrice(html);

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
    let overviewSize: string | undefined;
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
          lowLabel === 'taglia' ||
          lowLabel === 'size' ||
          lowLabel === 'capacità' ||
          lowLabel === 'capacità memoria' ||
          lowLabel === 'capacità di memoria' ||
          lowLabel === 'dimensione memoria'
        ) {
          const isMultiCapacityList =
            /\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b.*\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b/i.test(value);
          if (!overviewSize && !isMultiCapacityList) overviewSize = value.slice(0, 60);
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
        if (
          lowLabel === 'taglia' ||
          lowLabel === 'size' ||
          lowLabel === 'capacità' ||
          lowLabel === 'capacità memoria'
        ) {
          const isMultiCapacityList =
            /\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b.*\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb)\b/i.test(value);
          if (!overviewSize && !isMultiCapacityList) overviewSize = value.slice(0, 60);
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

    // 6. Product Variants (Colors & Sizes) from Amazon Twister JSON + Mobile Twister Plus a-state + DOM fallback
    const desktopVariationValues = extractJsonAfterKey<Record<string, unknown>>(
      html,
      'variationValues',
      '{',
      '}'
    );
    const mobileVariationValues = extractAmazonAStateJson<Record<string, unknown>>(
      html,
      'mobile-twister-dim-val-list'
    );
    const variationValues = desktopVariationValues || mobileVariationValues;

    const desktopDimensions = extractJsonAfterKey<string[]>(html, 'dimensions', '[', ']');
    const mobileDimensions = extractAmazonAStateJson<{ key?: string[] }>(
      html,
      'mobile-twister-dim-list'
    )?.key;
    const dimensions =
      Array.isArray(desktopDimensions) && desktopDimensions.length > 0
        ? desktopDimensions
        : Array.isArray(mobileDimensions) && mobileDimensions.length > 0
          ? mobileDimensions
          : null;

    const dimensionValuesDisplayData = extractJsonAfterKey<Record<string, unknown>>(
      html,
      'dimensionValuesDisplayData',
      '{',
      '}'
    );
    const mobileDimsToAsin = extractAmazonAStateJson<Record<string, string>>(
      html,
      'mobile-twister-dims-to-asin-list'
    );

    let availableColors: string[] = [];
    let availableSizes: string[] = [];
    let colorDimKey: string | undefined;
    let sizeDimKey: string | undefined;

    if (variationValues && typeof variationValues === 'object') {
      const colorPriority = ['color_name', 'color', 'colour_name', 'colour', 'colore', 'pattern_name'];
      for (const k of colorPriority) {
        if (Array.isArray(variationValues[k]) && variationValues[k].length > 0) {
          colorDimKey = k;
          availableColors = normalizeOptionList(variationValues[k]);
          break;
        }
      }

      const sizePriority = [
        'size_name',
        'size',
        'memory_storage_capacity',
        'storage_capacity',
        'capacity_name',
        'capacity',
        'ram_memory_installed_size',
        'computer_memory_size',
        'hard_disk_size',
        'taglia',
        'dimensione',
        'format_name',
        'item_package_quantity',
      ];
      for (const k of sizePriority) {
        if (Array.isArray(variationValues[k]) && variationValues[k].length > 0) {
          sizeDimKey = k;
          availableSizes = normalizeOptionList(variationValues[k]);
          break;
        }
      }

      if (availableSizes.length === 0) {
        for (const [k, v] of Object.entries(variationValues)) {
          if (
            k !== colorDimKey &&
            /(?:size|capacity|memory|storage|taglia|dimension|ram|disk|watt|inch|screen)/i.test(k) &&
            Array.isArray(v) &&
            v.length > 0
          ) {
            sizeDimKey = k;
            availableSizes = normalizeOptionList(v);
            break;
          }
        }
      }

      if (availableSizes.length === 0 && Array.isArray(variationValues.style_name)) {
        const styleOpts = normalizeOptionList(variationValues.style_name);
        const looksLikeSizes = styleOpts.some((s) =>
          /\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb|cm|mm|m|kg|g|ml|l|lt|w|pollici|")\b|^(?:xxs|xs|s|m|l|xl|xxl|xxxl)$/i.test(
            s
          )
        );
        if (looksLikeSizes) {
          sizeDimKey = 'style_name';
          availableSizes = styleOpts;
        }
      }
    }

    // Extract active color & size for this ASIN from dimensionValuesDisplayData or mobile-twister-dims-to-asin-list
    let twisterActiveColor: string | undefined;
    let twisterActiveSize: string | undefined;
    if (asin && dimensionValuesDisplayData && Array.isArray(dimensions)) {
      const asinKey = Object.keys(dimensionValuesDisplayData).find(
        (k) => k.toUpperCase() === asin.toUpperCase()
      );
      const activeTuple = asinKey ? dimensionValuesDisplayData[asinKey] : undefined;
      if (Array.isArray(activeTuple)) {
        if (colorDimKey) {
          const cIdx = dimensions.indexOf(colorDimKey);
          if (cIdx !== -1 && typeof activeTuple[cIdx] === 'string') {
            twisterActiveColor = stripHtmlTags(activeTuple[cIdx]).slice(0, 60);
          }
        }
        if (sizeDimKey) {
          const sIdx = dimensions.indexOf(sizeDimKey);
          if (sIdx !== -1 && typeof activeTuple[sIdx] === 'string') {
            twisterActiveSize = stripHtmlTags(activeTuple[sIdx]).slice(0, 60);
          }
        }
      }
    }
    if (
      asin &&
      (!twisterActiveColor || !twisterActiveSize) &&
      mobileDimsToAsin &&
      Array.isArray(dimensions) &&
      variationValues
    ) {
      const activeEntry = Object.entries(mobileDimsToAsin).find(
        ([, valAsin]) => typeof valAsin === 'string' && valAsin.toUpperCase() === asin.toUpperCase()
      );
      if (activeEntry) {
        const parts = activeEntry[0].split(':').map((n) => Number.parseInt(n, 10));
        if (!twisterActiveColor && colorDimKey) {
          const cIdx = dimensions.indexOf(colorDimKey);
          const colorArr = Array.isArray(variationValues[colorDimKey])
            ? (variationValues[colorDimKey] as unknown[])
            : [];
          const valIdx = cIdx !== -1 ? parts[cIdx] : -1;
          if (Number.isInteger(valIdx) && valIdx >= 0 && typeof colorArr[valIdx] === 'string') {
            twisterActiveColor = stripHtmlTags(colorArr[valIdx]).slice(0, 60);
          }
        }
        if (!twisterActiveSize && sizeDimKey) {
          const sIdx = dimensions.indexOf(sizeDimKey);
          const sizeArr = Array.isArray(variationValues[sizeDimKey])
            ? (variationValues[sizeDimKey] as unknown[])
            : [];
          const valIdx = sIdx !== -1 ? parts[sIdx] : -1;
          if (Number.isInteger(valIdx) && valIdx >= 0 && typeof sizeArr[valIdx] === 'string') {
            twisterActiveSize = stripHtmlTags(sizeArr[valIdx]).slice(0, 60);
          }
        }
      }
    }

    // DOM Twister Fallback for Color list
    if (availableColors.length === 0) {
      const colorBlockIdx = html.search(
        /id=["'](?:variation_color_name|inline-twister-row-color_name|inline-twister-expander-content-color_name)["']/i
      );
      if (colorBlockIdx !== -1) {
        const cSlice = html.slice(colorBlockIdx, colorBlockIdx + 25000);
        const extracted: string[] = [];
        for (const m of cSlice.matchAll(
          /(?:swatch-title-text-display[^>]*>([\s\S]*?)<\/span>|twisterTextDiv[^>]*>([\s\S]*?)<\/div>|<img[^>]*\balt=["']([^"']+)["'][^>]*class=["'][^"']*imgSwatch|aria-label=["']Seleziona\s+([^"']+)["'])/gi
        )) {
          const rawVal = m[1] || m[2] || m[3] || m[4] || '';
          const cleaned = stripHtmlTags(rawVal).replace(/\s+/g, ' ').trim();
          if (cleaned && !/^(seleziona|clicca|scegli)/i.test(cleaned)) {
            extracted.push(cleaned);
          }
        }
        availableColors = normalizeOptionList(extracted);
      }
    }

    // DOM Twister Fallback for Size list
    if (availableSizes.length === 0) {
      const sizeBlockIdx = html.search(
        /id=["'](?:variation_size_name|variation_memory_storage_capacity|variation_capacity_name|inline-twister-row-size_name|inline-twister-row-memory_storage_capacity|inline-twister-row-capacity_name|inline-twister-expander-content-size_name|inline-twister-expander-content-memory_storage_capacity|inline-twister-expander-content-capacity_name)["']/i
      );
      if (sizeBlockIdx !== -1) {
        const sSlice = html.slice(sizeBlockIdx, sizeBlockIdx + 25000);
        const extracted: string[] = [];
        for (const m of sSlice.matchAll(
          /(?:swatch-title-text-display[^>]*>([\s\S]*?)<\/span>|twisterTextDiv[^>]*>([\s\S]*?)<\/div>|<span[^>]*class=["'][^"']*a-size-base[^"']*["'][^>]*>([\s\S]*?)<\/span>)/gi
        )) {
          const rawVal = m[1] || m[2] || m[3] || '';
          const cleaned = stripHtmlTags(rawVal).replace(/\s+/g, ' ').trim();
          if (
            cleaned &&
            cleaned.length <= 45 &&
            !/^(seleziona|taglia|capacità|dimensioni|con\s+opzioni|da\s+€|€)/i.test(cleaned)
          ) {
            extracted.push(cleaned);
          }
        }
        availableSizes = normalizeOptionList(extracted);
      }
    }

    const cleanTwisterAriaVal = (raw: string): string =>
      stripHtmlTags(raw)
        .replace(/\.?\s*(?:tocca per espandere|tap to expand)\.?$/i, '')
        .trim()
        .slice(0, 60);

    // Active Color from Twister variation widget if not found yet
    let color = twisterActiveColor || overviewColor;
    if (!color) {
      const twisterAria = html.match(/aria-label=["']La Colore selezionat[ao] è ([^"']+)["']/i);
      if (twisterAria?.[1]) color = cleanTwisterAriaVal(twisterAria[1]);
    }
    if (!color) {
      const twisterDim = html.match(
        /inline-twister-expander-header-color_name[\s\S]{0,1200}?inline-twister-dim-title-value[^>]*>([\s\S]*?)<\/span>/i
      );
      if (twisterDim?.[1]) color = cleanTwisterAriaVal(twisterDim[1]);
    }
    if (!color) {
      const varColor = html.match(
        /id=["']variation_color_name["'][\s\S]{0,1000}?class=["']selection["'][^>]*>([\s\S]*?)<\/span>/i
      );
      if (varColor?.[1]) color = cleanTwisterAriaVal(varColor[1]);
    }

    // Active Size from Twister variation widget / overview if not found yet
    let size = twisterActiveSize || overviewSize;
    if (!size) {
      const twisterSizeAria = html.match(
        /aria-label=["']La (?:Taglia|Capacità(?: memoria)?|Dimensione) selezionat[ao] è ([^"']+)["']/i
      );
      if (twisterSizeAria?.[1]) size = cleanTwisterAriaVal(twisterSizeAria[1]);
    }
    if (!size) {
      const twisterSizeDim = html.match(
        /inline-twister-expander-header-(?:size_name|memory_storage_capacity|capacity_name)[\s\S]{0,1200}?inline-twister-dim-title-value[^>]*>([\s\S]*?)<\/span>/i
      );
      if (twisterSizeDim?.[1]) size = cleanTwisterAriaVal(twisterSizeDim[1]);
    }
    if (!size) {
      const varSize = html.match(
        /id=["']variation_(?:size_name|memory_storage_capacity|capacity_name)["'][\s\S]{0,1000}?class=["']selection["'][^>]*>([\s\S]*?)<\/span>/i
      );
      if (varSize?.[1]) size = cleanTwisterAriaVal(varSize[1]);
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
            bullets.push(truncateAtWordBoundary(text, 450));
          }
        }
      }
    }

    const model =
      overviewModel && asin && !overviewModel.includes(asin)
        ? `${overviewModel} (${asin})`.slice(0, 80)
        : (overviewModel || asin || undefined)?.slice(0, 80);

    // 8. Per-color variant images map from ImageBlockATF colorImages + colorToAsin + dimensionValuesDisplayData
    const colorImages: Record<string, string> = {};
    const colorToAsinCandidates = extractAllJsonAfterKey<Record<string, unknown>>(
      html,
      'colorToAsin',
      '{',
      '}'
    );
    const colorToAsinMap = colorToAsinCandidates.find((obj) =>
      Object.values(obj).some(
        (v) => Boolean(v && typeof v === 'object' && typeof (v as { asin?: unknown }).asin === 'string')
      )
    ) as Record<string, { asin?: string }> | undefined;

    const colorImagesCandidates = extractAllJsonAfterKey<Record<string, unknown>>(
      html,
      'colorImages',
      '{',
      '}'
    );
    const variantColorImagesMap = colorImagesCandidates.find((obj) =>
      Object.entries(obj).some(([k, v]) => k !== 'initial' && Array.isArray(v) && v.length > 0)
    ) as Record<string, Array<{ variant?: unknown; hiRes?: unknown; large?: unknown; main?: unknown }>> | undefined;

    if (variantColorImagesMap) {
      const cIdx = colorDimKey && Array.isArray(dimensions) ? dimensions.indexOf(colorDimKey) : -1;
      const sIdx = sizeDimKey && Array.isArray(dimensions) ? dimensions.indexOf(sizeDimKey) : -1;
      const sortedAvailColors = [...availableColors].sort((a, b) => b.length - a.length);
      const activeSizeNorm = size?.trim().toLowerCase().replace(/\s+/g, '') || '';

      for (const [variantKey, imgArr] of Object.entries(variantColorImagesMap)) {
        if (!Array.isArray(imgArr) || imgArr.length === 0) continue;
        const mainItem =
          imgArr.find((entry) => entry && typeof entry === 'object' && entry.variant === 'MAIN') ||
          imgArr[0];
        if (!mainItem || typeof mainItem !== 'object') continue;
        const bestUrl = extractBestAmazonMediaUrl(mainItem);
        if (!bestUrl) continue;

        let matchedColor: string | undefined;
        let variantSizeNorm = '';

        const mappedAsin = colorToAsinMap?.[variantKey]?.asin;
        if (mappedAsin && dimensionValuesDisplayData) {
          const tuple = dimensionValuesDisplayData[mappedAsin];
          if (Array.isArray(tuple)) {
            if (cIdx !== -1 && typeof tuple[cIdx] === 'string') {
              matchedColor = stripHtmlTags(tuple[cIdx]).replace(/\s+/g, ' ').trim().slice(0, 60);
            }
            if (sIdx !== -1 && typeof tuple[sIdx] === 'string') {
              variantSizeNorm = stripHtmlTags(tuple[sIdx]).trim().toLowerCase().replace(/\s+/g, '');
            }
          }
        }

        if (!matchedColor) {
          const vKeyClean = variantKey.replace(/\s+/g, ' ').trim();
          const vKeyLow = vKeyClean.toLowerCase();
          matchedColor =
            sortedAvailColors.find((col) => {
              const colLow = col.toLowerCase();
              if (vKeyLow === colLow || vKeyLow.startsWith(`${colLow} `) || vKeyLow.endsWith(` ${colLow}`)) {
                return true;
              }
              const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp(`(?:^|[\\s/,-])${escaped}(?=$|[\\s/,-])`, 'i').test(vKeyClean);
            }) || (availableSizes.length === 0 ? vKeyClean.slice(0, 60) : undefined);
        }

        if (!matchedColor) continue;
        if (Object.keys(colorImages).length >= 24 && !colorImages[matchedColor]) continue;

        const matchesActiveSize = Boolean(activeSizeNorm && variantSizeNorm === activeSizeNorm);
        if (!colorImages[matchedColor] || matchesActiveSize) {
          colorImages[matchedColor] = bestUrl;
        }
      }
    }

    if (color && imageUrl && !colorImages[color] && Object.keys(colorImages).length < 24) {
      colorImages[color] = imageUrl;
    }

    // 9. Per-size candidate ASINs (prioritizing active color's ASIN first, with other colors as fallback)
    const sizeAsinCandidates: Record<string, string[]> = {};
    const addSizeAsinCandidate = (sizeLabel: string, candAsin: string, prioritize = false) => {
      const cleanAsin = candAsin.trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) return;
      const existing = sizeAsinCandidates[sizeLabel] || [];
      if (existing.includes(cleanAsin)) {
        if (prioritize && existing[0] !== cleanAsin) {
          sizeAsinCandidates[sizeLabel] = [cleanAsin, ...existing.filter((x) => x !== cleanAsin)];
        }
        return;
      }
      sizeAsinCandidates[sizeLabel] = prioritize ? [cleanAsin, ...existing] : [...existing, cleanAsin];
    };

    const matchCanonicalSize = (rawSz: string): string | undefined => {
      const compact = rawSz.trim().toLowerCase().replace(/\s+/g, '');
      if (!compact) return undefined;
      return availableSizes.find(
        (s) => s.trim().toLowerCase().replace(/\s+/g, '') === compact
      );
    };

    const sizeBlockForAsinsIdx = html.search(
      /id=["'](?:variation_size_name|variation_memory_storage_capacity|variation_capacity_name|inline-twister-row-size_name|inline-twister-row-memory_storage_capacity|inline-twister-row-capacity_name|inline-twister-expander-content-size_name|inline-twister-expander-content-memory_storage_capacity|inline-twister-expander-content-capacity_name)["']/i
    );
    if (sizeBlockForAsinsIdx !== -1 && availableSizes.length > 0) {
      const sSlice = html.slice(sizeBlockForAsinsIdx, sizeBlockForAsinsIdx + 25000);
      for (const liMatch of sSlice.matchAll(
        /<li[^>]*data-asin=["']([A-Z0-9]{10})["'][^>]*>([\s\S]*?)<\/li>/gi
      )) {
        const liAsin = liMatch[1];
        const textM = liMatch[2].match(
          /(?:swatch-title-text-display[^>]*>([\s\S]*?)<\/span>|twisterTextDiv[^>]*>([\s\S]*?)<\/div>|<span[^>]*class=["'][^"']*a-size-base[^"']*["'][^>]*>([\s\S]*?)<\/span>)/i
        );
        const rawText = stripHtmlTags(textM?.[1] || textM?.[2] || textM?.[3] || '').replace(/\s+/g, ' ').trim();
        const canonical = matchCanonicalSize(rawText);
        if (canonical) {
          addSizeAsinCandidate(canonical, liAsin, true);
        }
      }
    }

    if (dimensionValuesDisplayData && Array.isArray(dimensions) && availableSizes.length > 0) {
      const sIdx = sizeDimKey ? dimensions.indexOf(sizeDimKey) : -1;
      const cIdx = colorDimKey ? dimensions.indexOf(colorDimKey) : -1;
      const activeColorNorm = color?.trim().toLowerCase() || '';
      if (sIdx !== -1) {
        for (const [candAsin, tuple] of Object.entries(dimensionValuesDisplayData)) {
          if (!Array.isArray(tuple) || typeof tuple[sIdx] !== 'string') continue;
          const rawSz = stripHtmlTags(tuple[sIdx]).replace(/\s+/g, ' ').trim();
          const canonical = matchCanonicalSize(rawSz);
          if (!canonical) continue;
          const rawCol =
            cIdx !== -1 && typeof tuple[cIdx] === 'string'
              ? stripHtmlTags(tuple[cIdx]).replace(/\s+/g, ' ').trim().toLowerCase()
              : '';
          const isSameColor = Boolean(activeColorNorm && rawCol === activeColorNorm);
          addSizeAsinCandidate(canonical, candAsin, isSameColor);
        }
      }
    }

    const colorAsinCandidates: Record<string, string> = {};
    if (mobileDimsToAsin && Array.isArray(dimensions) && variationValues) {
      const sIdx = sizeDimKey ? dimensions.indexOf(sizeDimKey) : -1;
      const cIdx = colorDimKey ? dimensions.indexOf(colorDimKey) : -1;
      const sizeArr =
        sIdx !== -1 && sizeDimKey && Array.isArray(variationValues[sizeDimKey])
          ? (variationValues[sizeDimKey] as unknown[])
          : [];
      const colorArr =
        cIdx !== -1 && colorDimKey && Array.isArray(variationValues[colorDimKey])
          ? (variationValues[colorDimKey] as unknown[])
          : [];
      const activeColorNorm = color?.trim().toLowerCase() || '';
      const activeSizeCompact = size?.trim().toLowerCase().replace(/\s+/g, '') || '';

      for (const [dimTupleKey, candAsin] of Object.entries(mobileDimsToAsin)) {
        if (typeof candAsin !== 'string' || !/^[A-Z0-9]{10}$/i.test(candAsin)) continue;
        const parts = dimTupleKey.split(':').map((n) => Number.parseInt(n, 10));
        const rawColorVal = cIdx !== -1 && Number.isInteger(parts[cIdx]) ? colorArr[parts[cIdx]] : undefined;
        const colRaw =
          typeof rawColorVal === 'string'
            ? stripHtmlTags(rawColorVal).replace(/\s+/g, ' ').trim()
            : '';
        const rawSizeVal = sIdx !== -1 && Number.isInteger(parts[sIdx]) ? sizeArr[parts[sIdx]] : undefined;
        const szRaw =
          typeof rawSizeVal === 'string'
            ? stripHtmlTags(rawSizeVal).replace(/\s+/g, ' ').trim()
            : '';

        if (szRaw) {
          const canonicalSz = matchCanonicalSize(szRaw) || szRaw;
          const isSameColor = Boolean(activeColorNorm && colRaw.toLowerCase() === activeColorNorm);
          addSizeAsinCandidate(canonicalSz, candAsin, isSameColor);
        }
        if (colRaw) {
          const canonicalCol =
            availableColors.find((c) => c.trim().toLowerCase() === colRaw.toLowerCase()) || colRaw;
          const isSameSize = Boolean(
            activeSizeCompact && szRaw.toLowerCase().replace(/\s+/g, '') === activeSizeCompact
          );
          if (!colorAsinCandidates[canonicalCol] || isSameSize) {
            colorAsinCandidates[canonicalCol] = candAsin.toUpperCase();
          }
        }
      }
    }

    if (
      dimensionValuesDisplayData &&
      Array.isArray(dimensions) &&
      availableColors.length > 0 &&
      Object.keys(colorAsinCandidates).length === 0
    ) {
      const cIdx = colorDimKey ? dimensions.indexOf(colorDimKey) : -1;
      const sIdx = sizeDimKey ? dimensions.indexOf(sizeDimKey) : -1;
      const activeSizeCompact = size?.trim().toLowerCase().replace(/\s+/g, '') || '';
      if (cIdx !== -1) {
        for (const [candAsin, tuple] of Object.entries(dimensionValuesDisplayData)) {
          if (!Array.isArray(tuple) || typeof tuple[cIdx] !== 'string' || !/^[A-Z0-9]{10}$/i.test(candAsin)) {
            continue;
          }
          const rawCol = stripHtmlTags(tuple[cIdx]).replace(/\s+/g, ' ').trim();
          const canonicalCol =
            availableColors.find((c) => c.trim().toLowerCase() === rawCol.toLowerCase()) || rawCol;
          const rawSz =
            sIdx !== -1 && typeof tuple[sIdx] === 'string'
              ? stripHtmlTags(tuple[sIdx]).trim().toLowerCase().replace(/\s+/g, '')
              : '';
          const isSameSize = Boolean(activeSizeCompact && rawSz === activeSizeCompact);
          if (!colorAsinCandidates[canonicalCol] || isSameSize) {
            colorAsinCandidates[canonicalCol] = candAsin.toUpperCase();
          }
        }
      }
    }

    return {
      title,
      brand,
      imageUrl,
      priceEur,
      color,
      availableColors,
      colorImages,
      size,
      availableSizes,
      sizeAsinCandidates,
      colorAsinCandidates,
      model,
      specsList,
      bullets,
    };
  }

  interface InspectedDocumentDto {
    title: string;
    url: string;
    kind: 'manuale' | 'scheda' | 'bim_3d' | 'certificato';
  }

  function inferDocumentKind(text: string, url: string): InspectedDocumentDto['kind'] {
    const hay = `${text} ${url}`.toLowerCase();
    if (/(bim|3d|cad|dwg|dxf|rfa|ifc|step|stp|obj|modello\s*3d)/.test(hay)) return 'bim_3d';
    if (/(certificat|garanzia|etichetta|energy|energetic|conformit|ce\b)/.test(hay)) {
      return 'certificato';
    }
    if (/(scheda\s*(?:prodotto|tecnica)|datasheet|data\s*sheet|brochure)/.test(hay)) {
      return 'scheda';
    }
    return 'manuale';
  }

  function extractDocumentLinksFromHtml(html: string, baseUrl: string): InspectedDocumentDto[] {
    const out: InspectedDocumentDto[] = [];
    const seenUrls = new Set<string>();
    const mainHtml = html
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

    const addCandidate = (rawHref: string, rawText: string) => {
      if (out.length >= 8) return;
      const trimmed = (rawHref || '').trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:')) {
        return;
      }
      let resolvedUrl: string;
      try {
        const u = new URL(decodeHtmlEntities(trimmed), baseUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
        if (isPrivateOrLocalHostname(u.hostname)) return;
        resolvedUrl = u.toString().slice(0, 1000);
      } catch {
        return;
      }
      const normKey = resolvedUrl.split('#')[0].toLowerCase();
      if (seenUrls.has(normKey)) return;

      const cleanText = stripHtmlTags(rawText || '').replace(/\s+/g, ' ').trim();
      const lowerUrl = resolvedUrl.toLowerCase();
      const lowerText = cleanText.toLowerCase();

      const hasDocExt = /\.(?:pdf|zip|dwg|dxf|rfa|ifc|step|stp|obj|doc|docx)(?:[?#]|$)/i.test(
        lowerUrl
      );
      const hasDocKeyword =
        /(?:scheda\s*(?:prodotto|tecnica)|istruzioni(?:\s+di\s+montaggio)?|manutenzione|manuale|libretto|bim|file\s*3d|3d\s*[-–/]\s*bim|cad|etichetta\s+energetica|certificat|dichiarazione|technical\s*sheet|datasheet|assembly\s*instructions|maintenance|user\s*guide|download)/i.test(
          `${lowerText} ${lowerUrl}`
        );

      if (!hasDocExt && !hasDocKeyword) return;
      // If it doesn't have a clear file extension, require explicit download path or strong product doc text
      if (
        !hasDocExt &&
        !/(?:download|allegat|pdf|scheda|manual|istruzion|manutenzion|bim|3d|cad|datasheet)/i.test(
          `${lowerText} ${new URL(resolvedUrl).pathname.toLowerCase()}`
        )
      ) {
        return;
      }

      if (
        /(?:privacy|cookie|gdpr|termini|condizioni|terms|policy|newsletter|catalogo[-_ ]generale|listino[-_ ]prezzi|press[-_ ]kit|bilancio|sostenibilit)/i.test(
          `${lowerText} ${lowerUrl}`
        )
      ) {
        return;
      }

      // Skip links that just point back to the HTML page itself or generic page routes without file hints
      const baseNoHash = baseUrl.split('#')[0].toLowerCase();
      if (normKey === baseNoHash) return;

      let title = cleanText;
      if (!title || /^(download|scarica|apri|pdf|clicca qui|vai)$/i.test(title)) {
        const lastSeg = decodeURIComponent(new URL(resolvedUrl).pathname.split('/').pop() || '');
        title = lastSeg.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim();
      }
      if (!title || title.length < 3) title = 'Documento prodotto';
      title = title.slice(0, 80);

      seenUrls.add(normKey);
      out.push({
        title,
        url: resolvedUrl,
        kind: inferDocumentKind(title, resolvedUrl),
      });
    };

    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(mainHtml)) !== null) {
      const attrs = m[1] || '';
      const inner = m[2] || '';
      const hrefM = attrs.match(/\b(?:href|data-href|data-url|data-file)=["']([^"']+)["']/i);
      const titleM = attrs.match(/\b(?:title|aria-label)=["']([^"']+)["']/i);
      if (!hrefM?.[1]) continue;

      const cleanInner = stripHtmlTags(inner).replace(/\s+/g, ' ').trim();
      let cleanAttrLabel = titleM?.[1]
        ? decodeHtmlEntities(titleM[1])
            .replace(/\s*\((?:si\s+apre\s+in\s+una\s+nuova\s+scheda|opens\s+in\s+(?:a\s+)?new\s+tab|pdf[^)]*)\)\s*$/i, '')
            .replace(/\s+/g, ' ')
            .trim()
        : '';

      // If aria-label has "Product Name - Document Type", keep the descriptive Document Type
      if (cleanAttrLabel && cleanInner) {
        const dashSplit = cleanAttrLabel.split(/\s+[-–|]\s+/);
        if (dashSplit.length >= 2 && dashSplit[dashSplit.length - 1].length >= 4) {
          cleanAttrLabel = dashSplit[dashSplit.length - 1].trim();
        }
      }

      // Check immediately preceding heading (e.g. <h4>Istruzioni di montaggio</h4>)
      const beforeSlice = mainHtml.slice(Math.max(0, m.index - 450), m.index);
      const headingBeforeM = beforeSlice.match(/<h[2-5][^>]*>([\s\S]{3,160})<\/h[2-5]>\s*$/i);
      const headingLabel = headingBeforeM?.[1]
        ? stripHtmlTags(headingBeforeM[1]).replace(/\s+/g, ' ').trim()
        : '';

      let textHint = cleanAttrLabel || headingLabel || cleanInner;
      if (
        cleanInner &&
        cleanAttrLabel &&
        cleanInner.length < 40 &&
        !cleanAttrLabel.toLowerCase().includes(cleanInner.toLowerCase())
      ) {
        textHint = `${cleanAttrLabel} (${cleanInner})`;
      } else if (
        headingLabel &&
        !cleanAttrLabel &&
        cleanInner &&
        !headingLabel.toLowerCase().includes(cleanInner.toLowerCase()) &&
        cleanInner.length < 36
      ) {
        textHint = `${headingLabel} · ${cleanInner}`;
      }
      addCandidate(hrefM[1], textHint);
    }

    // Also inspect direct PDF/BIM URLs embedded inside data attributes or JSON scripts in main body
    const rawDocUrlRe = /["'](https?:\/\/[^"'\s<>]+\.(?:pdf|zip|dwg|dxf|rfa|ifc|step|stp)(?:\?[^"'\s<>]*)?)["']/gi;
    while ((m = rawDocUrlRe.exec(mainHtml)) !== null) {
      addCandidate(m[1], '');
    }

    return out;
  }

  function extractGenericDomDetails(
    html: string,
    finalUrl: string,
    knownColors: string[] = []
  ): {
    specsList: string[];
    bullets: string[];
    documents: InspectedDocumentDto[];
    availableColors: string[];
    colorImages: Record<string, string>;
  } {
    const bodyOnly = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

    const specsList: string[] = [];
    const bullets: string[] = [];
    const seenLabels = new Set<string>();
    const seenBullets = new Set<string>();

    const ignoredLabels = new Set([
      'condividi',
      'share',
      'quantità',
      'qty',
      'prezzo',
      'price',
      'totale',
      'total',
      'menu',
      'cerca',
      'search',
      'cookie',
      'privacy',
      'login',
      'accedi',
      'registrati',
      'carrello',
      'cart',
      'recensione',
      'recensioni',
      'valutazione',
      'rating',
    ]);

    const addSpecPair = (rawLabel: string, rawVal: string) => {
      if (specsList.length >= 16) return;
      const label = stripHtmlTags(rawLabel).replace(/\s+/g, ' ').replace(/[:：]+$/, '').trim();
      const val = stripHtmlTags(rawVal).replace(/\s+/g, ' ').trim();
      if (!label || !val) return;
      if (label.length < 2 || label.length > 52 || val.length > 240) return;
      if (ignoredLabels.has(label.toLowerCase())) return;
      const key = label.toLowerCase();
      if (seenLabels.has(key)) return;
      seenLabels.add(key);
      specsList.push(`${label}: ${val}`);
    };

    const addBulletText = (rawText: string) => {
      if (bullets.length >= 6) return;
      const text = stripHtmlTags(rawText).replace(/\s+/g, ' ').trim();
      if (text.length < 18 || text.length > 480) return;
      if (/(?:cookie|privacy|newsletter|iscriviti|aggiungi al carrello|spedizione gratuita|diritto di recesso|accedi|registrati)/i.test(text)) {
        return;
      }
      const key = text.slice(0, 60).toLowerCase();
      if (seenBullets.has(key)) return;
      seenBullets.add(key);
      bullets.push(truncateAtWordBoundary(text, 440));
    };

    // 1. Definition lists (<dl><dt>...</dt><dd>...</dd></dl>)
    for (const dlMatch of bodyOnly.matchAll(/<dl\b[\s\S]*?<\/dl>/gi)) {
      const pairs = [
        ...dlMatch[0].matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi),
      ];
      for (const p of pairs) {
        addSpecPair(p[1], p[2]);
      }
    }

    // 2. HTML Tables (two-cell rows: th+td or td+td)
    for (const tableMatch of bodyOnly.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
      const rows = [...tableMatch[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const r of rows) {
        const cells = [...r[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)];
        if (cells.length >= 2) {
          addSpecPair(cells[0][1], cells[1][1]);
        }
      }
    }

    // 3. Technical detail / specification sections (headings & containers)
    const sectionHeadingRe =
      /<(?:h[1-6]|div|section|button|summary|p|strong|span)[^>]*(?:id|class)=["'][^"']*(?:spec|tech|detail|dettagl|caratterist|scheda|dimension|misur|feature|descri|info|tab|accordion|product-info)[^"']*["'][^>]*>[\s\S]{0,12000}/gi;
    const textHeadingRe =
      /(?:dettagli\s+tecnici|specifiche\s+tecniche|caratteristiche(?:\s+tecniche)?|scheda\s+tecnica|informazioni\s+prodotto|dimensioni\s+e\s+peso|technical\s+details|specifications)/i;

    const candidateBlocks: string[] = [];
    let hm: RegExpExecArray | null;
    while ((hm = sectionHeadingRe.exec(bodyOnly)) !== null) {
      candidateBlocks.push(hm[0].slice(0, 12000));
      if (candidateBlocks.length >= 8) break;
    }

    const headingMatch = textHeadingRe.exec(bodyOnly);
    if (headingMatch && typeof headingMatch.index === 'number') {
      candidateBlocks.push(bodyOnly.slice(headingMatch.index, headingMatch.index + 14000));
    }

    for (const block of candidateBlocks) {
      // List items inside technical blocks
      for (const liM of block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const liText = stripHtmlTags(liM[1]).replace(/\s+/g, ' ').trim();
        if (!liText) continue;
        const colonIdx = liText.indexOf(':');
        if (colonIdx > 1 && colonIdx < 45 && liText.length < 180) {
          addSpecPair(liText.slice(0, colonIdx), liText.slice(colonIdx + 1));
        } else {
          addBulletText(liText);
        }
      }

      // Nested Label/Value blocks (e.g. <div class="name|description">Altezza in cm</div><div class="value">90</div>)
      for (const pairM of block.matchAll(
        /<div\b[^>]*class=["'][^"']*\b(?:name|description|label|spec-label)\b[^"']*["'][^>]*>([\s\S]{2,260}?)<\/div>\s*<div\b[^>]*class=["'][^"']*\b(?:value|spec-value)\b[^"']*["'][^>]*>([\s\S]{1,220}?)<\/div>/gi
      )) {
        let lbl = stripHtmlTags(pairM[1].replace(/<br\s*\/?>/gi, ' '))
          .replace(/\s+/g, ' ')
          .trim();
        let val = stripHtmlTags(pairM[2].replace(/<br\s*\/?>/gi, ' · '))
          .replace(/\s+/g, ' ')
          .trim();
        const inUnitM = lbl.match(/^(.+?)\s+in\s+(cm|mm|m|kg|g|mc|litri|l)\b$/i);
        if (inUnitM && /^\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?$/.test(val)) {
          lbl = inUnitM[1].trim();
          val = `${val} ${inUnitM[2].toLowerCase()}`;
        }
        addSpecPair(lbl, val);
      }

      // Label/Value pairs inside child divs/spans/p (e.g. <span>Altezza</span><span>90 cm</span>)
      for (const pairM of block.matchAll(
        /<(?:div|p|span|strong|b|td|th)\b[^>]*>([^<]{2,50})<\/(?:div|p|span|strong|b|td|th)>\s*<(?:div|p|span|strong|b|td|dd)\b[^>]*>([^<]{1,140})<\/(?:div|p|span|strong|b|td|dd)>/gi
      )) {
        addSpecPair(pairM[1], pairM[2]);
      }

      // Technical description blocks separated by <br> (e.g. "STRUTTURA: ... <br> CUSCINI: ...")
      for (const descM of block.matchAll(
        /<div\b[^>]*class=["'][^"']*\bdescription\b[^"']*["'][^>]*>([\s\S]{12,1200}?)<\/div>/gi
      )) {
        const lines = descM[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .split(/\n+/)
          .map((l) => stripHtmlTags(l).replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        for (const line of lines) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 1 && colonIdx < 36 && line.length < 280) {
            const rawLbl = line.slice(0, colonIdx).trim();
            const niceLbl =
              rawLbl === rawLbl.toUpperCase() && rawLbl.length > 2
                ? rawLbl.charAt(0).toUpperCase() + rawLbl.slice(1).toLowerCase()
                : rawLbl;
            addSpecPair(niceLbl, line.slice(colonIdx + 1));
          } else if (line.length >= 24 && !seenLabels.has(line.toLowerCase())) {
            addBulletText(line);
          }
        }
      }

      // Informative paragraphs inside technical details section
      for (const pM of block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
        const pText = stripHtmlTags(pM[1]).replace(/\s+/g, ' ').trim();
        if (pText.length >= 24 && pText.length <= 420) {
          addBulletText(pText);
        }
      }
    }

    // 4. General <li> Key: Value fallback if nothing was found inside targeted sections
    if (specsList.length === 0) {
      for (const liM of bodyOnly.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const liText = stripHtmlTags(liM[1]).replace(/\s+/g, ' ').trim();
        const colonIdx = liText.indexOf(':');
        if (colonIdx > 2 && colonIdx < 38 && liText.length < 140) {
          addSpecPair(liText.slice(0, colonIdx), liText.slice(colonIdx + 1));
        }
      }
    }

    const documents = extractDocumentLinksFromHtml(html, finalUrl);

    // 5. Generic per-color variant images (carousel items, color swatches, alt-matched product images)
    const domColors: string[] = [];
    const domColorSeen = new Set<string>();
    const domColorImages: Record<string, string> = {};
    const resolveDomVariantImageUrl = (rawImg?: string): string | undefined => {
      const cleaned = decodeHtmlEntities((rawImg || '').trim());
      if (
        !cleaned ||
        cleaned.startsWith('data:') ||
        cleaned.startsWith('blob:') ||
        /\.svg(?:[?#]|$)/i.test(cleaned) ||
        /(?:placeholder|spinner|loading|blank|spacer|icon_profile)/i.test(cleaned)
      ) {
        return undefined;
      }
      try {
        const resolved = new URL(cleaned, finalUrl);
        if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return undefined;
        return resolved.toString().slice(0, 1000);
      } catch {
        return undefined;
      }
    };
    const recordColorVariantImage = (rawColor: string | undefined, rawImg: string | undefined) => {
      const cleanColor = stripHtmlTags(decodeHtmlEntities(rawColor || ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const cleanImg = resolveDomVariantImageUrl(rawImg);
      if (!cleanColor || cleanColor.length < 2) return;
      const colorLow = cleanColor.toLowerCase();
      if (/^(?:&nbsp;|none|null|undefined|default|cover|main)$/i.test(colorLow)) return;
      if (!domColorSeen.has(colorLow) && domColors.length < 48) {
        domColorSeen.add(colorLow);
        domColors.push(cleanColor);
      }
      if (cleanImg && !domColorImages[cleanColor] && Object.keys(domColorImages).length < 48) {
        domColorImages[cleanColor] = cleanImg;
      }
    };
    const pickBestImgFromTag = (imgTag: string): string | undefined => {
      const attrM = imgTag.match(
        /(?:data-zoom-image|data-large_image|data-hi-res|data-src|data-lazy|data-original|src)=["']([^"']+)["']/i
      );
      const direct = resolveDomVariantImageUrl(attrM?.[1]);
      if (direct) return direct;
      const srcsetM = imgTag.match(/srcset=["']([^"']+)["']/i);
      if (srcsetM?.[1]) {
        const candidates = srcsetM[1]
          .split(',')
          .map((part) => {
            const pieces = part.trim().split(/\s+/);
            const url = pieces[0];
            const width = parseInt(pieces[1] || '0', 10) || 0;
            return { url, width };
          })
          .filter((c) => Boolean(c.url))
          .sort((a, b) => b.width - a.width);
        for (const c of candidates) {
          const resolved = resolveDomVariantImageUrl(c.url);
          if (resolved) return resolved;
        }
      }
      return undefined;
    };

    // 5a. Carousel / variant cards containing an <img> + <div class="color-name">...</div> (e.g. Nardi Outdoor)
    for (const cardM of bodyOnly.matchAll(
      /<div\b[^>]*class=["'][^"']*\bcarousel-item\b[^"']*["'][^>]*>([\s\S]{0,1800}?)(?=<div\b[^>]*class=["'][^"']*\bcarousel-item\b|<\/section>|<\/main>|$)/gi
    )) {
      const chunk = cardM[1];
      const imgTag = chunk.match(/<img\b[^>]*>/i)?.[0];
      if (!imgTag) continue;
      const imgUrl = pickBestImgFromTag(imgTag);
      if (!imgUrl) continue;
      let colorLabel = '';
      const colorNameM = chunk.match(
        /<div\b[^>]*class=["'][^"']*\bcolor-name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
      );
      if (colorNameM?.[1]) {
        colorLabel = colorNameM[1]
          .replace(/<span\b[^>]*class=["'][^"']*\bcolor-code\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ' ')
          .replace(/<br\s*\/?>/gi, ' ');
      } else {
        const dataColM = chunk.match(/data-(?:variant-)?color=["']([^"']+)["']/i);
        if (dataColM?.[1]) colorLabel = dataColM[1];
      }
      if (colorLabel) {
        recordColorVariantImage(colorLabel, imgUrl);
      }
    }

    // 5b. Generic swatch links/buttons/items with explicit color + variant image attributes
    for (const swatchM of bodyOnly.matchAll(
      /<(?:a|button|li|label|div)\b[^>]*?(?:data-(?:variant-)?color|data-swatch-label)=["']([^"']+)["'][^>]*>([\s\S]{0,400}?<\/(?:a|button|li|label|div)>)/gi
    )) {
      const fullTag = swatchM[0];
      const imgAttrM = fullTag.match(
        /data-(?:zoom-image|large_image|image|img|src)=["']([^"']+)["']/i
      );
      const childImgTag = fullTag.match(/<img\b[^>]*>/i)?.[0];
      const imgUrl = imgAttrM?.[1] || (childImgTag ? pickBestImgFromTag(childImgTag) : undefined);
      if (imgUrl) {
        recordColorVariantImage(swatchM[1], imgUrl);
      }
    }

    // 5c. Match remaining knownColors (e.g. from JSON-LD product.color[]) against <img alt="...">
    const mergedKnownColors = normalizeOptionList([...knownColors, ...domColors], 48);
    if (mergedKnownColors.length > 0 && Object.keys(domColorImages).length < mergedKnownColors.length) {
      const sortedKnown = [...mergedKnownColors].sort((a, b) => b.length - a.length);
      for (const imgM of bodyOnly.matchAll(/<img\b[^>]*>/gi)) {
        const tag = imgM[0];
        const altM = tag.match(/alt=["']([^"']+)["']/i);
        if (!altM?.[1]) continue;
        const altClean = decodeHtmlEntities(altM[1]).replace(/\s+/g, ' ').trim();
        if (altClean.length < 3) continue;
        const altLower = altClean.toLowerCase();
        const imgUrl = pickBestImgFromTag(tag);
        if (!imgUrl) continue;
        for (const cand of sortedKnown) {
          if (domColorImages[cand]) continue;
          const candLower = cand.toLowerCase();
          if (candLower.length < 3) continue;
          if (
            altLower === candLower ||
            altLower.endsWith(` ${candLower}`) ||
            altLower.includes(` ${candLower} `)
          ) {
            recordColorVariantImage(cand, imgUrl);
            break;
          }
        }
      }
    }

    return {
      specsList,
      bullets,
      documents,
      availableColors: mergedKnownColors,
      colorImages: domColorImages,
    };
  }

  function isBlockedPageTitle(rawTitle: string): boolean {
    const t = rawTitle.toLowerCase().trim();
    if (!t) return true;
    return (
      t === 'amazon.it' ||
      t === 'amazon.com' ||
      t.includes('403 forbidden') ||
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

  async function resolveWaybackSnapshotUrl(targetUrl: string): Promise<string | undefined> {
    try {
      const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(targetUrl)}`;
      const resp = await fetch(apiUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5500),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MyHomeProductInspector/1.0',
        },
      });
      if (!resp.ok) return undefined;
      const data = (await resp.json()) as {
        archived_snapshots?: {
          closest?: { available?: boolean; status?: string; timestamp?: string; url?: string };
        };
      };
      const closest = data?.archived_snapshots?.closest;
      if (
        closest?.available &&
        closest.status === '200' &&
        closest.timestamp &&
        /^\d{8,14}$/.test(closest.timestamp)
      ) {
        return `https://web.archive.org/web/${closest.timestamp}id_/${targetUrl}`;
      }
    } catch {
      // ignore Wayback availability lookup failures
    }
    return undefined;
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
    const inspectDeadlineMs = Date.now() + 25_000;
    const remainingBudgetMs = () => Math.max(0, inspectDeadlineMs - Date.now());
    const withStepTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const clampedMs = Math.max(500, ms);
        const timer = setTimeout(() => {
          reject(new Error(`Timeout after ${clampedMs}ms (${label})`));
        }, clampedMs);
        promise.then(
          (val) => {
            clearTimeout(timer);
            resolve(val);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          }
        );
      });
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
    let availableColors: string[] = [];
    let colorImages: Record<string, string> | undefined;
    let size = '';
    let availableSizes: string[] = [];
    let sizePrices: Record<string, number> | undefined;
    let model = amazonAsin || urlDetails.model || '';
    let imageUrl = '';
    let priceEur: number | undefined;
    let specs = '';
    let notes = '';
    let documents: InspectedDocumentDto[] = [];
    let extractedFrom: 'page-meta' | 'url-slug' = 'url-slug';
    let blockedBySite = false;

    const resolvePageImageUrl = (rawImg?: string): string | undefined => {
      const trimmed = (rawImg || '').trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return undefined;
      try {
        const resolved = new URL(trimmed, finalUrl);
        if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return undefined;
        return resolved.toString().slice(0, 1000);
      } catch {
        return undefined;
      }
    };

    const extractFallbackHtmlImage = (candidateHtml: string): string | undefined => {
      const metaCandidates = [
        extractMetaContent(candidateHtml, 'itemprop', 'image'),
        extractMetaContent(candidateHtml, 'name', 'msapplication-TileImage'),
      ];
      const linkImageSrcM = candidateHtml.match(
        /<link[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i
      );
      if (linkImageSrcM?.[1]) metaCandidates.push(decodeHtmlEntities(linkImageSrcM[1]));

      for (const cand of metaCandidates) {
        const resolved = resolvePageImageUrl(cand);
        if (resolved && !/(?:favicon|apple-touch-icon|logo)/i.test(resolved)) {
          return resolved;
        }
      }

      const imgSrcMatches = candidateHtml.matchAll(
        /<(?:img|source)[^>]*(?:src|data-src|data-lazy-src|srcset)=["']([^"']+)["'][^>]*>/gi
      );
      let bestUrl: string | undefined;
      let bestScore = -1;
      for (const m of imgSrcMatches) {
        const rawAttr = decodeHtmlEntities(m[1]).split(',')[0].trim().split(/\s+/)[0];
        const resolved = resolvePageImageUrl(rawAttr);
        if (!resolved) continue;
        if (/\.(?:svg|ico)(?:[?#]|$)/i.test(resolved)) continue;
        if (/(?:favicon|sprite|spacer|pixel|tracking|analytics|cookie|gdpr|flag|icon-16|icon-32)/i.test(resolved)) {
          continue;
        }
        let score = 0;
        if (/\.(?:webp|jpg|jpeg|png|avif)(?:[?#]|$)/i.test(resolved)) score += 3;
        if (/\/(?:media|products?|prodotti|catalogo|upload|images?|img|foto)\//i.test(resolved)) score += 2;
        if (urlDetails.title) {
          const words = urlDetails.title
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
          if (words.some((w) => resolved.toLowerCase().includes(w))) score += 4;
        }
        if (/logo/i.test(resolved)) score -= 4;
        if (score > bestScore) {
          bestScore = score;
          bestUrl = resolved;
        }
      }
      return bestScore >= 2 ? bestUrl : undefined;
    };

    const isTlsChainError = (err: unknown): boolean => {
      const code =
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
        (err as { code?: string })?.code ||
        '';
      return (
        code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
        code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
        code === 'CERT_UNTRUSTED'
      );
    };

    const fetchViaNodeHttp = async (
      targetUrl: string,
      headers: Record<string, string>,
      rejectUnauthorized = true,
      hopsLeft = 4,
      deadlineMs = Date.now() + 9000
    ): Promise<{ status: number; contentType: string; text: string }> => {
      const remaining = deadlineMs - Date.now();
      if (remaining <= 200) {
        throw new Error('Request deadline exceeded');
      }
      const u = new URL(targetUrl);
      const client = u.protocol === 'https:' ? https : http;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finishResolve = (val: { status: number; contentType: string; text: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          resolve(val);
        };
        const finishReject = (err: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          reject(err);
        };
        const reqTimeoutMs = Math.max(500, Math.min(9000, remaining));
        const req = client.request(
          u,
          {
            method: 'GET',
            headers,
            timeout: reqTimeoutMs,
            ...(u.protocol === 'https:' ? { rejectUnauthorized } : {}),
          },
          (resp) => {
            const status = resp.statusCode || 0;
            const loc = resp.headers.location;
            if (status >= 300 && status < 400 && loc && hopsLeft > 0) {
              resp.resume();
              try {
                const nextUrl = new URL(loc, u).toString();
                if (!isPrivateOrLocalHostname(new URL(nextUrl).hostname)) {
                  void fetchViaNodeHttp(nextUrl, headers, rejectUnauthorized, hopsLeft - 1, deadlineMs)
                    .then(finishResolve)
                    .catch(finishReject);
                  return;
                }
              } catch {
                // fall through
              }
            }
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            resp.on('data', (chunk: Buffer) => {
              if (totalBytes < 3_000_000) {
                chunks.push(chunk);
                totalBytes += chunk.length;
              }
            });
            resp.on('end', () => {
              finishResolve({
                status,
                contentType: String(resp.headers['content-type'] || '').toLowerCase(),
                text: Buffer.concat(chunks).toString('utf8').slice(0, 3_000_000),
              });
            });
            resp.on('error', finishReject);
          }
        );
        const hardTimer = setTimeout(() => {
          req.destroy(new Error('Request deadline timeout'));
        }, reqTimeoutMs + 300);
        req.on('timeout', () => req.destroy(new Error('Request timeout')));
        req.on('error', finishReject);
        req.end();
      });
    };

    const parseNodeHttpResult = (res: {
      status: number;
      contentType: string;
      text: string;
    }): { html: string; blocked: boolean } => {
      const bodyText = res.contentType.includes('text/html') ? res.text : '';
      const blocked = isBotChallengeHtml(bodyText, res.status);
      if (res.status < 200 || res.status >= 400 || !res.contentType.includes('text/html') || blocked) {
        return { html: '', blocked };
      }
      return { html: bodyText, blocked: false };
    };

    const fetchPageHtml = async (
      targetUrl: string,
      userAgentOverride?: string,
      maxTimeoutMs = 8500
    ): Promise<{ html: string; blocked: boolean }> => {
      const budget = remainingBudgetMs();
      if (budget < 1200) {
        return { html: '', blocked: false };
      }
      const stepTimeoutMs = Math.min(maxTimeoutMs, budget);
      const reqHeaders: Record<string, string> = {
        'User-Agent':
          userAgentOverride ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      };
      try {
        const response = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(stepTimeoutMs),
          headers: reqHeaders,
        });
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const bodyText = contentType.includes('text/html')
          ? (await withStepTimeout(response.text(), stepTimeoutMs, 'response.text')).slice(0, 3_000_000)
          : '';
        const blocked = isBotChallengeHtml(bodyText, response.status);
        if (response.ok && contentType.includes('text/html') && !blocked) {
          return { html: bodyText, blocked: false };
        }
        // Fallback via Node native HTTP/1.1 client when fetch() (undici TLS/ALPN) gets 503/403 bot-challenged
        if ((blocked || response.status === 403 || response.status === 503) && remainingBudgetMs() >= 1800) {
          try {
            const nodeRes = await fetchViaNodeHttp(
              targetUrl,
              reqHeaders,
              true,
              4,
              Date.now() + Math.min(stepTimeoutMs, remainingBudgetMs())
            );
            const parsed = parseNodeHttpResult(nodeRes);
            if (parsed.html) return parsed;
          } catch {
            // fall through
          }
        }
        return { html: '', blocked };
      } catch (err) {
        if (isTlsChainError(err) && remainingBudgetMs() >= 1800) {
          try {
            const fallbackRes = await fetchViaNodeHttp(
              targetUrl,
              reqHeaders,
              false,
              4,
              Date.now() + Math.min(stepTimeoutMs, remainingBudgetMs())
            );
            return parseNodeHttpResult(fallbackRes);
          } catch {
            return { html: '', blocked: false };
          }
        }
        throw err;
      }
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
          {
            url: cleanAmazonUrl,
            ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
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
          if (remainingBudgetMs() < 3000) break;
          try {
            const retryRes = await fetchPageHtml(strat.url, strat.ua, 6000);
            if (hasUsableProductHtml(retryRes.html)) {
              html = retryRes.html;
              blockedBySite = false;
              break;
            }
          } catch {
            // ignore individual strategy failures
          }
        }
      } else if (!amazonAsin && (blockedBySite || !hasUsableProductHtml(html)) && remainingBudgetMs() >= 4500) {
        // Non-Amazon site WAF-blocked datacenter IP (e.g. AWS ELB 403 on manufacturer sites): try Wayback snapshot
        const wbUrl = await resolveWaybackSnapshotUrl(finalUrl);
        if (wbUrl && remainingBudgetMs() >= 2500) {
          try {
            const wbRes = await fetchPageHtml(wbUrl, undefined, 6500);
            if (hasUsableProductHtml(wbRes.html)) {
              html = wbRes.html;
              blockedBySite = false;
            }
          } catch {
            // ignore Wayback HTML fetch failures
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
          (amazonDom?.priceEur === undefined ||
            !amazonDom?.title ||
            !amazonDom?.imageUrl ||
            amazonDom.availableColors.length === 0 ||
            amazonDom.availableSizes.length === 0)
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

        const cleanProductTitle = (rawTitle: string): string => {
          let t = rawTitle
            .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .replace(
              /\s*[:|-]\s*(?:Amazon\.it|Amazon\.com|eBay|MediaWorld|Unieuro|IKEA Italia|Euronics|Electrolux|AEG|Maisons du Monde|Zara Home|Westwing|Kave Home|Sklum)(?:\s*:\s*[^:|]+)?\s*$/i,
              ''
            )
            .trim();

          const colonMatch = t.match(/^(.+?):\s+(.+)$/);
          if (colonMatch) {
            const head = colonMatch[1].trim();
            const tail = colonMatch[2].trim();
            if (
              head.length >= 10 &&
              (tail.length >= 25 ||
                /(?:display|schermo|pollici|chip|processore|batteria|fotocamera|autonomia|promotion|ghz|mhz|ram|ssd|nvme|oled|qled|4k|8k|hdr|bluetooth|wi-?fi|usb|watt|ricaric|compatibil|sbloccato)/i.test(
                  tail
                ))
            ) {
              t = head;
            }
          }

          const pipeIdx = t.indexOf(' | ');
          if (pipeIdx >= 12 && t.length - pipeIdx > 25) {
            t = t.slice(0, pipeIdx).trim();
          }

          return t.slice(0, 160);
        };

        const candidateTitle =
          amazonDom?.title || mobileDom?.title || ld.title || ogTitle || htmlTitle || h1Title;
        if (candidateTitle && !isBlockedPageTitle(candidateTitle)) {
          title = cleanProductTitle(candidateTitle);
          extractedFrom = 'page-meta';
          blockedBySite = false;
        } else if (isBlockedPageTitle(candidateTitle)) {
          blockedBySite = true;
        }

        const rawOgImage =
          amazonDom?.imageUrl ||
          mobileDom?.imageUrl ||
          ld.imageUrl ||
          extractMetaContent(html, 'property', 'og:image') ||
          extractMetaContent(html, 'property', 'og:image:secure_url') ||
          extractMetaContent(html, 'name', 'twitter:image');
        const resolvedOgImage =
          resolvePageImageUrl(rawOgImage) || extractFallbackHtmlImage(html);
        if (resolvedOgImage && !isBlockedPageTitle(candidateTitle)) {
          imageUrl = resolvedOgImage;
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

        availableColors =
          amazonDom?.availableColors.length
            ? amazonDom.availableColors
            : mobileDom?.availableColors.length
              ? mobileDom.availableColors
              : ld.availableColors || [];

        const rawColorImages =
          amazonDom?.colorImages && Object.keys(amazonDom.colorImages).length > 0
            ? amazonDom.colorImages
            : mobileDom?.colorImages && Object.keys(mobileDom.colorImages).length > 0
              ? mobileDom.colorImages
              : ld.colorImages;
        colorImages = sanitizeColorImagesMap(rawColorImages);

        size = (
          amazonDom?.size ||
          mobileDom?.size ||
          ld.size ||
          ''
        )
          .trim()
          .slice(0, 60);

        availableSizes =
          amazonDom?.availableSizes.length
            ? amazonDom.availableSizes
            : mobileDom?.availableSizes.length
              ? mobileDom.availableSizes
              : ld.availableSizes || [];

        const collectedSizePrices: Record<string, number> = {
          ...(ld.sizePrices || {}),
        };
        const resolveCanonicalSizeKey = (rawSz?: string): string | undefined => {
          const trimmed = rawSz?.trim();
          if (!trimmed) return undefined;
          const compact = trimmed.toLowerCase().replace(/\s+/g, '');
          return (
            availableSizes.find((s) => s.trim().toLowerCase().replace(/\s+/g, '') === compact) ||
            trimmed
          );
        };
        const activeSizeKey = resolveCanonicalSizeKey(size);
        if (activeSizeKey && typeof priceEur === 'number') {
          collectedSizePrices[activeSizeKey] = priceEur;
        }

        // Fetch sibling Amazon ASINs (for size prices AND missing color photos) using cached HTML per ASIN
        const siblingDomCache = new Map<
          string,
          { priceEur?: number; imageUrl?: string }
        >();
        const fetchAmazonSiblingDetails = async (candAsin: string) => {
          const upper = candAsin.toUpperCase();
          const cached = siblingDomCache.get(upper);
          if (cached) return cached;
          let sibHtml = '';
          try {
            const sibMobile = await fetchPageHtml(
              `https://${parsedUrl.hostname}/gp/aw/d/${upper}?th=1&psc=1`,
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
            );
            sibHtml = sibMobile.html || '';
            if (!sibHtml || extractAmazonBuyboxPrice(sibHtml) === undefined) {
              const sibDesk = await fetchPageHtml(
                `https://${parsedUrl.hostname}/dp/${upper}?th=1&psc=1`
              );
              if (sibDesk.html && extractAmazonBuyboxPrice(sibDesk.html) !== undefined) {
                sibHtml = sibDesk.html;
              } else if (!sibHtml) {
                sibHtml = sibDesk.html || '';
              }
            }
          } catch {
            // ignore sibling ASIN fetch failures
          }
          const sibDom = sibHtml ? extractAmazonDomDetails(sibHtml, upper) : null;
          const entry = {
            priceEur: sibDom?.priceEur,
            imageUrl: sibDom?.imageUrl,
          };
          siblingDomCache.set(upper, entry);
          return entry;
        };

        const mergedSizeAsins =
          amazonDom?.sizeAsinCandidates && Object.keys(amazonDom.sizeAsinCandidates).length > 0
            ? amazonDom.sizeAsinCandidates
            : mobileDom?.sizeAsinCandidates || {};

        const mergedColorAsins =
          amazonDom?.colorAsinCandidates && Object.keys(amazonDom.colorAsinCandidates).length > 0
            ? amazonDom.colorAsinCandidates
            : mobileDom?.colorAsinCandidates || {};

        const sizeLookupTasks: Array<Promise<void>> = [];
        if (amazonAsin && availableSizes.length > 1 && Object.keys(mergedSizeAsins).length > 0) {
          const sizesToLookup = availableSizes
            .filter((sz) => {
              const compact = sz.trim().toLowerCase().replace(/\s+/g, '');
              const alreadyHas = Object.keys(collectedSizePrices).some(
                (k) => k.trim().toLowerCase().replace(/\s+/g, '') === compact
              );
              return !alreadyHas && (mergedSizeAsins[sz]?.length || 0) > 0;
            })
            .slice(0, 8);

          for (const sz of sizesToLookup) {
            sizeLookupTasks.push(
              (async () => {
                const rawCandidates = mergedSizeAsins[sz] || [];
                const candidates =
                  priceEur === undefined
                    ? rawCandidates.filter((a) => a.toUpperCase() !== amazonAsin.toUpperCase())
                    : rawCandidates;
                const orderedAsins = (candidates.length > 0 ? candidates : rawCandidates).slice(0, 2);
                for (const candAsin of orderedAsins) {
                  if (candAsin.toUpperCase() === amazonAsin.toUpperCase()) continue;
                  const sib = await fetchAmazonSiblingDetails(candAsin);
                  if (typeof sib.priceEur === 'number') {
                    collectedSizePrices[sz] = sib.priceEur;
                    break;
                  }
                }
              })()
            );
          }
        }

        const colorLookupTasks: Array<Promise<void>> = [];
        const collectedColorImages: Record<string, string> = {
          ...(colorImages || {}),
        };
        if (amazonAsin && availableColors.length > 1 && Object.keys(mergedColorAsins).length > 0) {
          const colorsMissingImage = availableColors
            .filter((col) => !collectedColorImages[col] && Boolean(mergedColorAsins[col]))
            .slice(0, 8);
          for (const col of colorsMissingImage) {
            const candAsin = mergedColorAsins[col];
            if (!candAsin || candAsin.toUpperCase() === amazonAsin.toUpperCase()) continue;
            colorLookupTasks.push(
              (async () => {
                const sib = await fetchAmazonSiblingDetails(candAsin);
                if (sib.imageUrl) {
                  collectedColorImages[col] = sib.imageUrl;
                }
              })()
            );
          }
        }

        if ((sizeLookupTasks.length > 0 || colorLookupTasks.length > 0) && remainingBudgetMs() >= 2500) {
          try {
            await withStepTimeout(
              Promise.all([...sizeLookupTasks, ...colorLookupTasks]),
              Math.min(8500, remainingBudgetMs() - 1500),
              'amazon sibling variants'
            );
          } catch {
            // keep partial sibling results collected before timeout
          }
        }
        colorImages = sanitizeColorImagesMap(collectedColorImages);

        sizePrices = sanitizeSizePricesMapServer(collectedSizePrices);
        if (priceEur === undefined && activeSizeKey && sizePrices?.[activeSizeKey] !== undefined) {
          priceEur = sizePrices[activeSizeKey];
        }

        if (amazonDom?.model) {
          model = amazonDom.model;
        } else if (mobileDom?.model) {
          model = mobileDom.model;
        } else if (ld.model) {
          model = ld.model;
        }

        const isAmazonUrl = parsedUrl.hostname.toLowerCase().includes('amazon.');
        const genericDom = !isAmazonUrl
          ? extractGenericDomDetails(html, finalUrl, availableColors)
          : null;

        if (
          !isAmazonUrl &&
          genericDom?.availableColors &&
          genericDom.availableColors.length > availableColors.length
        ) {
          availableColors = genericDom.availableColors;
        }
        if (
          !isAmazonUrl &&
          genericDom?.colorImages &&
          Object.keys(genericDom.colorImages).length > 0
        ) {
          colorImages = sanitizeColorImagesMap({
            ...(colorImages || {}),
            ...genericDom.colorImages,
          });
        }

        const mergedSpecsList = amazonDom?.specsList.length
          ? amazonDom.specsList
          : mobileDom?.specsList.length
            ? mobileDom.specsList
            : genericDom?.specsList.length
              ? genericDom.specsList
              : ld.specsList || [];
        const mergedBullets = amazonDom?.bullets.length
          ? amazonDom.bullets
          : mobileDom?.bullets.length
            ? mobileDom.bullets
            : genericDom?.bullets || [];

        if (genericDom?.documents && genericDom.documents.length > 0) {
          documents = genericDom.documents;
        }

        const metaDesc =
          ld.description ||
          extractMetaContent(html, 'property', 'og:description') ||
          extractMetaContent(html, 'name', 'description');

        if (mergedSpecsList.length > 0 || mergedBullets.length > 0) {
          const descBullet =
            mergedBullets.length === 0 && metaDesc && metaDesc.length > 35
              ? [truncateAtWordBoundary(metaDesc, 380)]
              : mergedBullets;
          specs = buildBoundedSpecsText(mergedSpecsList, descBullet, 1850);
        } else if (metaDesc && !isBlockedPageTitle(candidateTitle)) {
          specs = truncateAtWordBoundary(metaDesc, 1850);
        }
      }
    } catch {
      // Fall back gracefully to online enrichment or URL slug extraction below
    }

    let aiSuggestedRoom: ResearchRoomIdServer | undefined;

    const specsLookSparse = !specs || (!specs.includes('\n') && specs.length < 130);
    // Online grounding fallback via Gemini when page blocked / JS-rendered / sparse specs / missing docs
    if (
      (blockedBySite ||
        extractedFrom !== 'page-meta' ||
        specsLookSparse ||
        (!priceEur && !color) ||
        documents.length === 0) &&
      getGeminiClient()
    ) {
      try {
        const ai = getGeminiClient();
        if (ai) {
          const cleanQueryBrand =
            brand ||
            inferProductBrandServer({
              title: title || urlDetails.title,
              url: finalUrl,
              store,
              specs,
            }) ||
            store;
          const cleanQueryTitle = (title || urlDetails.title).trim();
          const searchPrompt = [
            `Cerca informazioni reali, dettagli tecnici completi e documenti scaricabili ufficiali sul prodotto:`,
            `URL: ${finalUrl}`,
            amazonAsin ? `ASIN Amazon: ${amazonAsin}` : '',
            cleanQueryTitle ? `Prodotto: ${cleanQueryBrand} ${cleanQueryTitle}`.trim() : '',
            'Usa Google Search (e URL Context se accessibile) e restituisci SOLO un oggetto JSON valido con i campi reali trovati nelle fonti ufficiali/rivenditori (ometti o lascia stringa vuota/null ciò che non trovi):',
            '- title: nome completo del prodotto in italiano (max 160 caratteri)',
            '- brand: marca ufficiale (max 60 caratteri)',
            '- color: colore o finitura selezionata in italiano (max 60 caratteri)',
            '- availableColors: array JSON dei soli colori disponibili per questo prodotto se elencati (es. ["Bianco", "Antracite", "Tortora"])',
            '- size: taglia, taglio memoria o capacità selezionata (max 60 caratteri)',
            '- availableSizes: array JSON delle sole taglie o capacità disponibili',
            '- sizePrices: oggetto JSON mappa taglia -> prezzo in EUR se presenti prezzi diversi per taglia',
            '- model: codice modello o ASIN (max 80 caratteri)',
            '- priceEur: numero prezzo attuale in EUR se chiaramente presente (altrimenti null)',
            '- specs: stringa multilinea (max 1750 caratteri) separando con a capo:\\n  1) prima le specifiche tecniche strutturate nel formato "Etichetta: Valore" (es. Struttura: ..., Materiale: ..., Altezza schienale: 90 cm, Altezza seduta: 49 cm, Larghezza: 292,5 cm, Profondità: 78/152,5 cm, Peso prodotto: 60,3/67,3 kg, Imballo: ...)\\n  2) poi eventuali informazioni descrittive/punti chiave iniziando ogni riga con "• "',
            '- documents: array JSON (max 6 elementi) dei soli file ufficiali scaricabili trovati sul sito del produttore per questo prodotto (es. Scheda prodotto, Istruzioni di montaggio, Manutenzione prodotto, Manuale d\'uso, File 3D - BIM), ciascuno come {"title":"Scheda prodotto","url":"https://...pdf","kind":"scheda"|"manuale"|"bim_3d"|"certificato"}. Inserisci SOLO URL reali diretti trovati nelle fonti.',
            '- imageUrl: URL pubblico diretto dell\'immagine principale del prodotto se trovato nella fonte (altrimenti null)',
            '- room: ID stanza della casa solo se è evidente e univoca ("cucina", "salone", "bagno1", "bagno2", "stanza_matrimoniale", "stanza_maurizio", "stanza_roberta", "terrazza_ovest", "terrazza_est"), altrimenti null',
          ]
            .filter(Boolean)
            .join('\n');

          let aiRes: { text?: string } | undefined;
          const comboTimeoutMs = Math.min(12_000, remainingBudgetMs());
          if (comboTimeoutMs >= 3000) {
            try {
              aiRes = await withStepTimeout(
                ai.models.generateContent({
                  model: 'gemini-4-hydrogen',
                  contents: searchPrompt,
                  config: {
                    tools: [{ googleSearch: {} }, { urlContext: {} }],
                  },
                }),
                comboTimeoutMs,
                'gemini inspect combo'
              );
            } catch (comboErr) {
              if (isQuotaOrRateError(comboErr)) throw comboErr;
              const searchTimeoutMs = Math.min(9000, remainingBudgetMs());
              if (searchTimeoutMs >= 3000) {
                aiRes = await withStepTimeout(
                  ai.models.generateContent({
                    model: 'gemini-4-hydrogen',
                    contents: searchPrompt,
                    config: {
                      tools: [{ googleSearch: {} }],
                    },
                  }),
                  searchTimeoutMs,
                  'gemini inspect search'
                );
              }
            }
          }

          const enriched = extractJsonFromText<{
            title?: string;
            brand?: string;
            color?: string;
            availableColors?: string[];
            size?: string;
            availableSizes?: string[];
            sizePrices?: Record<string, number | string>;
            model?: string;
            priceEur?: number | string | null;
            imageUrl?: string | null;
            specs?: string;
            documents?: Array<{ title?: string; url?: string; kind?: string }>;
            room?: string | null;
          }>(aiRes?.text || '');

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
            if (availableColors.length === 0 && Array.isArray(enriched.availableColors)) {
              availableColors = normalizeOptionList(enriched.availableColors);
            }
            if (!size && typeof enriched.size === 'string' && enriched.size.trim()) {
              size = enriched.size.trim().slice(0, 60);
            }
            if (availableSizes.length === 0 && Array.isArray(enriched.availableSizes)) {
              availableSizes = normalizeOptionList(enriched.availableSizes);
            }
            if (!sizePrices && enriched.sizePrices) {
              sizePrices = sanitizeSizePricesMapServer(enriched.sizePrices);
            }
            if (!model && typeof enriched.model === 'string' && enriched.model.trim()) {
              model = enriched.model.trim().slice(0, 80);
            }
            if (priceEur === undefined) {
              priceEur = parsePriceNumber(enriched.priceEur);
            }
            if (!imageUrl && typeof enriched.imageUrl === 'string' && enriched.imageUrl.trim()) {
              const resolvedAiImg = resolvePageImageUrl(enriched.imageUrl);
              if (resolvedAiImg) {
                imageUrl = resolvedAiImg;
              }
            }
            if (typeof enriched.specs === 'string' && enriched.specs.trim()) {
              const aiSpecs = truncateAtWordBoundary(enriched.specs.trim(), 1850);
              if (!specs || (specsLookSparse && aiSpecs.length > specs.length)) {
                specs = aiSpecs;
                if (title) extractedFrom = 'page-meta';
              }
            }
            if (documents.length === 0 && Array.isArray(enriched.documents)) {
              const seenDocUrls = new Set<string>();
              const validAiDocs: InspectedDocumentDto[] = [];
              for (const d of enriched.documents) {
                if (!d || typeof d.url !== 'string') continue;
                try {
                  const u = new URL(d.url.trim());
                  if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
                  if (isPrivateOrLocalHostname(u.hostname)) continue;
                  const cleanDocUrl = u.toString().slice(0, 1000);
                  const low = cleanDocUrl.toLowerCase();
                  if (seenDocUrls.has(low)) continue;
                  seenDocUrls.add(low);
                  const docTitle =
                    typeof d.title === 'string' && d.title.trim()
                      ? d.title.trim().slice(0, 80)
                      : 'Documento prodotto';
                  const kind =
                    d.kind === 'scheda' ||
                    d.kind === 'manuale' ||
                    d.kind === 'bim_3d' ||
                    d.kind === 'certificato'
                      ? d.kind
                      : inferDocumentKind(docTitle, cleanDocUrl);
                  validAiDocs.push({ title: docTitle, url: cleanDocUrl, kind });
                  if (validAiDocs.length >= 6) break;
                } catch {
                  // skip invalid document URL
                }
              }
              if (validAiDocs.length > 0) {
                documents = validAiDocs;
              }
            }
            if (typeof enriched.room === 'string' && enriched.room.trim()) {
              aiSuggestedRoom = normalizeResearchRoomServer(enriched.room);
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
    const deterministicRoom = inferResearchRoomServer({
      title,
      url: finalUrl,
      specs,
      category,
    });
    const isPersonalOrExcludedForRoom =
      category === 'auto' ||
      category === 'abbigliamento' ||
      NON_ROOM_PRODUCT_RE_SERVER.test(`${title} ${extractUrlSlugTextServer(finalUrl)}`);
    const room = deterministicRoom || (!isPersonalOrExcludedForRoom ? aiSuggestedRoom : undefined);

    const payload = {
      url: finalUrl,
      title: title.slice(0, 160),
      store: store.slice(0, 60),
      category,
      room: room || undefined,
      priceEur,
      imageUrl: imageUrl || undefined,
      brand: brand || undefined,
      color: color || undefined,
      availableColors: availableColors.length > 0 ? availableColors.slice(0, 24) : undefined,
      colorImages,
      size: size || undefined,
      availableSizes: availableSizes.length > 0 ? availableSizes.slice(0, 24) : undefined,
      sizePrices,
      model: model || undefined,
      specs: specs || undefined,
      notes: notes || undefined,
      documents: documents.length > 0 ? documents.slice(0, 8) : undefined,
      extractedFrom,
      blockedBySite,
    };

    if (extractedFrom === 'page-meta') {
      inspectCache.set(cacheKey, { expiresAt: Date.now() + INSPECT_CACHE_TTL_MS, data: payload });
    }

    res.json(payload);
  });

  app.post('/api/researches/fetch-document', async (req, res) => {
    const rawDocUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const fallbackTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!rawDocUrl || rawDocUrl.length > 1000) {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL documento non valido.' });
      return;
    }
    let parsedDocUrl: URL;
    try {
      parsedDocUrl = new URL(rawDocUrl);
    } catch {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL documento malformato.' });
      return;
    }
    if (
      (parsedDocUrl.protocol !== 'https:' && parsedDocUrl.protocol !== 'http:') ||
      isPrivateOrLocalHostname(parsedDocUrl.hostname)
    ) {
      res.status(400).json({ ok: false, reason: 'invalid', error: 'URL non consentito.' });
      return;
    }

    const MAX_DOC_BYTES = 6_000_000;
    const reqHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/pdf,application/zip,application/octet-stream,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: `${parsedDocUrl.origin}/`,
    };

    const fetchBinaryWithTlsFallback = async (
      targetUrl: string,
      hopsLeft = 4
    ): Promise<{
      status: number;
      contentType: string;
      contentDisposition: string;
      buffer: Buffer;
      tooLarge: boolean;
    }> => {
      try {
        const resp = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(12000),
          headers: reqHeaders,
        });
        const contentLen = Number(resp.headers.get('content-length') || 0);
        if (Number.isFinite(contentLen) && contentLen > MAX_DOC_BYTES) {
          return {
            status: resp.status,
            contentType: String(resp.headers.get('content-type') || '').toLowerCase(),
            contentDisposition: String(resp.headers.get('content-disposition') || ''),
            buffer: Buffer.alloc(0),
            tooLarge: true,
          };
        }
        const ab = await resp.arrayBuffer();
        const buf = Buffer.from(ab);
        return {
          status: resp.status,
          contentType: String(resp.headers.get('content-type') || '').toLowerCase(),
          contentDisposition: String(resp.headers.get('content-disposition') || ''),
          buffer: buf,
          tooLarge: buf.length > MAX_DOC_BYTES,
        };
      } catch (err) {
        const code =
          (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
          (err as { code?: string })?.code ||
          '';
        if (
          code !== 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' &&
          code !== 'SELF_SIGNED_CERT_IN_CHAIN' &&
          code !== 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' &&
          code !== 'CERT_UNTRUSTED'
        ) {
          throw err;
        }
        return new Promise((resolve, reject) => {
          let settled = false;
          const u = new URL(targetUrl);
          const client = u.protocol === 'https:' ? https : http;
          let hardTimer: ReturnType<typeof setTimeout> | undefined;
          const finishResolve = (val: {
            status: number;
            contentType: string;
            contentDisposition: string;
            buffer: Buffer;
            tooLarge: boolean;
          }) => {
            if (settled) return;
            settled = true;
            if (hardTimer) clearTimeout(hardTimer);
            resolve(val);
          };
          const finishReject = (err: unknown) => {
            if (settled) return;
            settled = true;
            if (hardTimer) clearTimeout(hardTimer);
            reject(err);
          };
          const r = client.request(
            u,
            {
              method: 'GET',
              headers: reqHeaders,
              timeout: 12000,
              ...(u.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
            },
            (resp) => {
              const status = resp.statusCode || 0;
              const loc = resp.headers.location;
              if (status >= 300 && status < 400 && loc && hopsLeft > 0) {
                resp.resume();
                try {
                  const nextUrl = new URL(loc, u).toString();
                  if (!isPrivateOrLocalHostname(new URL(nextUrl).hostname)) {
                    void fetchBinaryWithTlsFallback(nextUrl, hopsLeft - 1)
                      .then(finishResolve)
                      .catch(finishReject);
                    return;
                  }
                } catch {
                  // fall through
                }
              }
              const chunks: Buffer[] = [];
              let total = 0;
              let tooLarge = false;
              resp.on('data', (chunk: Buffer) => {
                total += chunk.length;
                if (total > MAX_DOC_BYTES) {
                  tooLarge = true;
                  resp.destroy();
                  return;
                }
                chunks.push(chunk);
              });
              resp.on('end', () => {
                finishResolve({
                  status,
                  contentType: String(resp.headers['content-type'] || '').toLowerCase(),
                  contentDisposition: String(resp.headers['content-disposition'] || ''),
                  buffer: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks),
                  tooLarge,
                });
              });
              resp.on('close', () => {
                if (tooLarge) {
                  finishResolve({
                    status,
                    contentType: String(resp.headers['content-type'] || '').toLowerCase(),
                    contentDisposition: String(resp.headers['content-disposition'] || ''),
                    buffer: Buffer.alloc(0),
                    tooLarge: true,
                  });
                }
              });
              resp.on('error', finishReject);
            }
          );
          hardTimer = setTimeout(() => {
            r.destroy(new Error('Document fetch hard timeout'));
          }, 12500);
          r.on('timeout', () => r.destroy(new Error('Document fetch timeout')));
          r.on('error', finishReject);
          r.end();
        });
      }
    };

    try {
      let result = await fetchBinaryWithTlsFallback(parsedDocUrl.toString());
      if (result.tooLarge) {
        res.status(200).json({ ok: false, reason: 'too_large', url: parsedDocUrl.toString() });
        return;
      }

      const isHtmlResult = (r: typeof result): boolean => {
        const ct = r.contentType.split(';')[0].trim();
        const head = r.buffer.slice(0, 512).toString('utf8').toLowerCase();
        return ct.includes('text/html') || head.includes('<!doctype html') || head.includes('<html');
      };

      if (
        result.status === 403 ||
        result.status === 503 ||
        result.status === 429 ||
        result.buffer.length === 0 ||
        isHtmlResult(result)
      ) {
        const wbDocUrl = await resolveWaybackSnapshotUrl(parsedDocUrl.toString());
        if (wbDocUrl) {
          const wbResult = await fetchBinaryWithTlsFallback(wbDocUrl);
          if (wbResult.tooLarge) {
            res.status(200).json({ ok: false, reason: 'too_large', url: parsedDocUrl.toString() });
            return;
          }
          if (
            wbResult.status >= 200 &&
            wbResult.status < 400 &&
            wbResult.buffer.length > 0 &&
            !isHtmlResult(wbResult)
          ) {
            result = wbResult;
          }
        }
      }

      if (result.status < 200 || result.status >= 400 || result.buffer.length === 0) {
        res.status(200).json({
          ok: false,
          reason: 'blocked',
          status: result.status,
          url: parsedDocUrl.toString(),
        });
        return;
      }

      const cleanContentType = result.contentType.split(';')[0].trim() || 'application/octet-stream';
      if (isHtmlResult(result)) {
        res.status(200).json({ ok: false, reason: 'html_page', url: parsedDocUrl.toString() });
        return;
      }

      let fileName = '';
      const dispMatch = result.contentDisposition.match(
        /filename\*?=(?:UTF-8''|["']?)([^"';\r\n]+)["']?/i
      );
      if (dispMatch?.[1]) {
        try {
          fileName = decodeURIComponent(dispMatch[1]).trim();
        } catch {
          fileName = dispMatch[1].trim();
        }
      }
      if (!fileName) {
        const seg = decodeURIComponent(parsedDocUrl.pathname.split('/').pop() || '').trim();
        fileName = seg || `${fallbackTitle.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'documento'}`;
      }
      if (!/\.[a-z0-9]{2,5}$/i.test(fileName)) {
        if (cleanContentType === 'application/pdf') fileName += '.pdf';
        else if (cleanContentType.includes('zip')) fileName += '.zip';
      }
      fileName = fileName.replace(/["\r\n\\/:*?<>|]+/g, '_').slice(0, 120);

      res.setHeader('Content-Type', cleanContentType);
      res.setHeader('X-Document-Filename', encodeURIComponent(fileName));
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.buffer);
    } catch {
      res.status(200).json({ ok: false, reason: 'network_error', url: parsedDocUrl.toString() });
    }
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
