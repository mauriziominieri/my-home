import { HomeArticleCategory } from '../types/home';
import {
  buildManufacturerManualSearchUrl,
  OnlineArticleSearchResult,
  searchArticleCatalog,
} from './articleCatalog';

interface WikipediaPage {
  pageid: number;
  index?: number;
  title: string;
  fullurl?: string;
  pageimage?: string;
  extract?: string;
}

interface CommonsMetadataValue {
  value?: string;
}

interface CommonsPage {
  pageid: number;
  index?: number;
  title: string;
  imageinfo?: {
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, CommonsMetadataValue>;
  }[];
}

interface WikipediaResponse {
  query?: { pages?: Record<string, WikipediaPage> };
}

interface CommonsResponse {
  query?: { pages?: Record<string, CommonsPage> };
}

interface ServerSearchItemDto {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  suggestedRoom: string;
  specs: string;
  manualUrl: string;
  manualSummary?: string;
  sourceUrls?: { title: string; url: string }[];
  providerLabel?: string;
}

interface ServerSearchResponse {
  results?: ServerSearchItemDto[];
  provider?: string;
}

export interface FreeArticleSearchResponse {
  results: OnlineArticleSearchResult[];
  provider: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; data: FreeArticleSearchResponse }>();

const PRODUCT_WORDS = new Set([
  'acoustic',
  'appliance',
  'asciugatrice',
  'bass',
  'chitarra',
  'condizionatore',
  'forno',
  'fridge',
  'frigo',
  'frigorifero',
  'guitar',
  'induzione',
  'lavastoviglie',
  'lavatrice',
  'microonde',
  'monitor',
  'piano',
  'prodotto',
  'router',
  'smart',
  'tv',
  'washer',
]);

const KNOWN_BRANDS = [
  'Ibanez',
  'TCL',
  'Bosch',
  'Samsung',
  'Electrolux',
  'Whirlpool',
  'Miele',
  'Dyson',
  'Sony',
  'Apple',
  'LG',
  'Philips',
  'Fender',
  'Gibson',
  'Yamaha',
  'Marshall',
  'Panasonic',
  'Hisense',
  'Haier',
  'Smeg',
  'Ariston',
  'Huawei',
  'Rehau',
  'AVS',
  'Daikin',
];

const VALID_CATEGORIES = new Set<HomeArticleCategory>([
  'elettrodomestici',
  'elettronica',
  'sicurezza',
  'fotovoltaico',
  'clima',
  'altro',
]);

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Servizio catalogo non disponibile (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

function getWikipediaSearch(query: string, lang: 'it' | 'en' = 'it'): Promise<WikipediaPage[]> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '0',
    gsrlimit: '6',
    prop: 'pageimages|extracts|info',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '640',
    format: 'json',
    origin: '*',
  }).toString();
  return fetchJson<WikipediaResponse>(url).then((response) =>
    Object.values(response.query?.pages || {}).sort(
      (left, right) => (left.index || 0) - (right.index || 0)
    )
  );
}

function getCommonsSearch(query: string): Promise<CommonsPage[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  }).toString();
  return fetchJson<CommonsResponse>(url).then((response) =>
    Object.values(response.query?.pages || {}).sort(
      (left, right) => (left.index || 0) - (right.index || 0)
    )
  );
}

function getCommonsFiles(fileNames: string[]): Promise<CommonsPage[]> {
  if (fileNames.length === 0) return Promise.resolve([]);
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    titles: fileNames.map((name) => `File:${name}`).join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  }).toString();
  return fetchJson<CommonsResponse>(url).then((response) =>
    Object.values(response.query?.pages || {})
  );
}

async function tryServerLiveSearch(query: string): Promise<FreeArticleSearchResponse | null> {
  try {
    const res = await fetch('/api/articles/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8_500),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;

    const json = (await res.json()) as ServerSearchResponse;
    if (!Array.isArray(json.results) || json.results.length === 0) return null;

    const mapped: OnlineArticleSearchResult[] = json.results.map((item, idx) => {
      const cat = VALID_CATEGORIES.has(item.category as HomeArticleCategory)
        ? (item.category as HomeArticleCategory)
        : inferCategory(`${item.name} ${item.brand} ${item.model}`);
      return {
        id: item.id || `web_${idx}`,
        name: String(item.name || `${item.brand} ${item.model}`).slice(0, 80),
        brand: String(item.brand || '').slice(0, 60),
        model: String(item.model || '').slice(0, 80),
        category: cat,
        suggestedRoom: String(item.suggestedRoom || inferRoom(cat)).slice(0, 60),
        specs: String(item.specs || '').slice(0, 240),
        manualUrl:
          item.manualUrl || buildManufacturerManualSearchUrl(item.brand || '', item.model || ''),
        description: String(item.manualSummary || item.specs || '').slice(0, 320),
        familyWarrantySuggested:
          cat === 'elettrodomestici' || cat === 'elettronica' || cat === 'clima',
        sourceUrls: Array.isArray(item.sourceUrls) ? item.sourceUrls : [],
        providerLabel: item.providerLabel || 'Google Search',
      };
    });

    return {
      results: mapped,
      provider: json.provider || 'Ricerca online live · Google Search',
    };
  } catch {
    return null;
  }
}

function cleanHtml(value?: string): string {
  if (!value) return '';
  return (
    new DOMParser()
      .parseFromString(value, 'text/html')
      .body.textContent?.replace(/\s+/g, ' ')
      .trim() || ''
  );
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferBrand(query: string, title: string, description: string): string {
  const searchableText = normalize(`${query} ${title} ${description}`);
  const knownBrand = KNOWN_BRANDS.find((brand) =>
    searchableText.includes(normalize(brand))
  );
  if (knownBrand) return knownBrand;

  const candidate = query
    .split(/\s+/)
    .find((word) => word.length > 1 && !PRODUCT_WORDS.has(normalize(word)));
  return candidate
    ? `${candidate[0].toLocaleUpperCase('it-IT')}${candidate.slice(1)}`
    : 'Altro';
}

function inferCategory(text: string): HomeArticleCategory {
  const value = normalize(text);
  if (/\b(tv|television|televisore|monitor|router|modem|laptop|computer|tablet)\b/.test(value)) {
    return 'elettronica';
  }
  if (
    /\b(fridge|frigo|frigorifero|refrigerator|lavatrice|washer|forno|oven|dishwasher|lavastoviglie|induzione|microonde|asciugatrice|dyson)\b/.test(
      value
    )
  ) {
    return 'elettrodomestici';
  }
  if (/\b(alarm|allarme|camera|telecamera|security|avs)\b/.test(value)) return 'sicurezza';
  if (/\b(heat pump|pompa di calore|air conditioner|condizionatore|ariston|rehau|daikin)\b/.test(value)) {
    return 'clima';
  }
  if (/\b(solar|fotovoltaico|inverter|huawei)\b/.test(value)) return 'fotovoltaico';
  return 'altro';
}

function inferRoom(category: HomeArticleCategory): string {
  if (category === 'elettrodomestici') return 'Cucina';
  if (category === 'sicurezza') return 'Casa / Ingresso';
  if (category === 'clima' || category === 'fotovoltaico') return 'Locale Tecnico / Esterno';
  return 'Salone';
}

function imageName(page: CommonsPage): string {
  const title = page.imageinfo?.[0]?.extmetadata?.ObjectName?.value;
  return cleanHtml(title) || page.title.replace(/^File:/i, '').replace(/\.[^.]+$/, '');
}

function extractModel(title: string, brand: string): string {
  const withoutExtension = title
    .replace(/^File:\s*/i, '')
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/[_-]+/g, ' ');
  const model = withoutExtension
    .replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    .replace(/\b(photo|image|guitar|chitarra|electric|acoustic|by|from)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return model.slice(0, 80) || withoutExtension.slice(0, 80);
}

function matchWikipediaPage(
  title: string,
  pages: WikipediaPage[]
): WikipediaPage | undefined {
  const normalizedTitle = normalize(title);
  return pages.find((page) => {
    const normalizedPageTitle = normalize(page.title);
    const words = normalizedPageTitle
      .split(' ')
      .filter(
        (word) =>
          word.length >= 2 &&
          !KNOWN_BRANDS.some((brand) => normalize(brand) === word)
      );
    return words.some((word) => normalizedTitle.includes(word));
  });
}

function toProductResult(
  query: string,
  page: CommonsPage,
  wikipediaPages: WikipediaPage[]
): OnlineArticleSearchResult | null {
  const image = page.imageinfo?.[0];
  const imageUrl = image?.thumburl || image?.url;
  const sourceUrl = image?.descriptionurl;
  if (!imageUrl || !sourceUrl) return null;

  const name = imageName(page);
  const commonsDescription = cleanHtml(image.extmetadata?.ImageDescription?.value);
  const wikipediaPage = matchWikipediaPage(`${name} ${page.title}`, wikipediaPages);
  const description =
    commonsDescription || wikipediaPage?.extract?.replace(/\s+/g, ' ').trim() || name;
  const brand = inferBrand(query, name, description);
  const model = extractModel(name, brand);
  if (!model || normalize(model) === normalize(brand)) return null;

  const artist = cleanHtml(image.extmetadata?.Artist?.value);
  const license = cleanHtml(image.extmetadata?.LicenseShortName?.value);
  const imageCredit = [artist, license].filter(Boolean).join(' · ');
  const category = inferCategory(`${query} ${name} ${description}`);

  return {
    id: `commons-${page.pageid}`,
    name: name.slice(0, 80),
    brand,
    model,
    category,
    suggestedRoom: inferRoom(category),
    specs: '',
    manualUrl: buildManufacturerManualSearchUrl(brand, model),
    description: description.slice(0, 360),
    imageUrl,
    imageCredit: imageCredit || 'Wikimedia Commons · attribuzione nella fonte',
    familyWarrantySuggested:
      category === 'elettrodomestici' || category === 'elettronica' || category === 'clima',
    sourceUrls: [
      { title: 'Immagine e licenza su Wikimedia Commons', url: sourceUrl },
      ...(wikipediaPage?.fullurl
        ? [{ title: `Descrizione: Wikipedia · ${wikipediaPage.title}`, url: wikipediaPage.fullurl }]
        : []),
    ],
    providerLabel: 'Wikimedia Commons',
  };
}

export async function searchFreeArticles(
  rawQuery: string
): Promise<FreeArticleSearchResponse> {
  const query = rawQuery.trim();
  if (query.length < 2 || query.length > 140) {
    throw new Error('Inserisci una ricerca tra 2 e 140 caratteri.');
  }

  const cacheKey = query.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const catalogMatches = searchArticleCatalog(query);

  const searchQuery =
    /\bibanez\b/i.test(query) && !/\b(guitar|chitarra|guitars|chitarre)\b/i.test(query)
      ? `${query} guitar`
      : query;

  const [serverRes, commonsResult, wikiItResult, wikiEnResult] = await Promise.all([
    tryServerLiveSearch(query),
    getCommonsSearch(searchQuery).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: [] as CommonsPage[] })
    ),
    getWikipediaSearch(searchQuery, 'it').then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: [] as WikipediaPage[] })
    ),
    getWikipediaSearch(searchQuery, 'en').then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: [] as WikipediaPage[] })
    ),
  ]);

  const commonsPages = commonsResult.value;
  const wikipediaPages = [...wikiItResult.value, ...wikiEnResult.value];
  const missingImagePages = wikipediaPages
    .filter((page) => page.pageimage)
    .filter(
      (page) =>
        !commonsPages.some((commons) =>
          normalize(commons.title).includes(normalize(page.pageimage || ''))
        )
    )
    .slice(0, 4);

  let extraImages: CommonsPage[] = [];
  if (missingImagePages.length > 0) {
    try {
      extraImages = await getCommonsFiles(
        missingImagePages.map((page) => page.pageimage as string)
      );
    } catch {
      // ignore extra image fetch errors
    }
  }

  const allCommonsPages = [...commonsPages, ...extraImages];
  const wikimediaResults = allCommonsPages
    .map((page) => toProductResult(query, page, wikipediaPages))
    .filter((result): result is OnlineArticleSearchResult => result !== null);

  const combined: OnlineArticleSearchResult[] = [
    ...(serverRes?.results || []),
    ...catalogMatches,
    ...wikimediaResults,
  ];

  const deduped = combined
    .filter(
      (result, index, all) =>
        all.findIndex(
          (candidate) =>
            normalize(candidate.brand) === normalize(result.brand) &&
            normalize(candidate.model) === normalize(result.model)
        ) === index
    )
    .slice(0, 24);

  const providerParts: string[] = [];
  if (serverRes?.results.length) providerParts.push('Google Search');
  if (catalogMatches.length) providerParts.push('Catalogo Casa & Elettrodomestici');
  if (wikimediaResults.length) providerParts.push('Wikimedia / Wikipedia');

  const provider =
    providerParts.length > 0
      ? `Fonti utilizzate: ${providerParts.join(' · ')}`
      : 'Ricerca completata (usa il pulsante sotto per creare la scheda personalizzata)';

  const response: FreeArticleSearchResponse = { results: deduped, provider };
  if (deduped.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: response });
  }
  return response;
}
