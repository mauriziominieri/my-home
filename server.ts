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
const GEMINI_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const searchCache = new Map<string, CacheEntry<{ results: SearchResultDto[]; provider: string }>>();
const manualCache = new Map<string, CacheEntry<ManualGuideDto>>();
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
