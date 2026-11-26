export interface CatalogDocumentDto {
  title: string;
  url: string;
  kind: 'manuale' | 'scheda' | 'bim_3d' | 'certificato';
  isOlderVersion?: boolean;
  updatedDate?: string;
}

export interface ClientCatalogInspectResult {
  url: string;
  title: string;
  store: string;
  brand?: string;
  model?: string;
  color?: string;
  imageUrl?: string;
  specs?: string;
  documents?: CatalogDocumentDto[];
  extractedFrom: 'page-meta';
  blockedBySite: false;
}

function stripHtmlTagsClient(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferClientDocumentKind(
  text: string,
  url: string
): CatalogDocumentDto['kind'] {
  const hay = `${text} ${url}`.toLowerCase();
  if (
    /(?:\bbim\b|\b3d\b|\bcad\b|\bdwg\b|\bdxf\b|\brfa\b|\bifc\b|\bstep\b|\bstp\b|\.obj\b|\bobj\b|modello\s*3d)/.test(
      hay
    )
  ) {
    return 'bim_3d';
  }
  if (/(certificat|garanzia|etichetta|energy|energetic|conformit|\bce\b)/.test(hay)) {
    return 'certificato';
  }
  if (
    /(scheda\s*(?:prodotto|tecnica)|datasheet|data\s*sheet|brochure|volantino|product\s*fiche|\bfiche\b)/.test(
      hay
    )
  ) {
    return 'scheda';
  }
  return 'manuale';
}

function parseVersionDateTimestamp(
  updatedRaw?: string,
  title?: string,
  url?: string
): { ts: number; formattedDate: string } {
  if (updatedRaw) {
    const isoMatch = updatedRaw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoMatch) {
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]);
      const d = Number(isoMatch[3]);
      const parsed = Date.parse(updatedRaw.replace(' ', 'T'));
      const ts = Number.isFinite(parsed) ? parsed : Date.UTC(y, m - 1, d);
      return {
        ts,
        formattedDate: `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`,
      };
    }
    const dmyMatch = updatedRaw.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (dmyMatch) {
      const d = Number(dmyMatch[1]);
      const m = Number(dmyMatch[2]);
      const y = Number(dmyMatch[3]);
      return {
        ts: Date.UTC(y, m - 1, d),
        formattedDate: `${dmyMatch[1]}/${dmyMatch[2]}/${dmyMatch[3]}`,
      };
    }
  }
  if (title) {
    const titleDate = title.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);
    if (titleDate) {
      const d = Number(titleDate[1]);
      const m = Number(titleDate[2]);
      const y = Number(titleDate[3]);
      return {
        ts: Date.UTC(y, m - 1, d),
        formattedDate: `${titleDate[1]}/${titleDate[2]}/${titleDate[3]}`,
      };
    }
  }
  if (url) {
    const mmoUnix = url.match(/mmo_\d+_(\d{10})_/i);
    if (mmoUnix?.[1]) {
      const sec = Number(mmoUnix[1]);
      if (Number.isFinite(sec) && sec > 1_000_000_000) {
        const dt = new Date(sec * 1000);
        const dd = String(dt.getUTCDate()).padStart(2, '0');
        const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = dt.getUTCFullYear();
        return { ts: sec * 1000, formattedDate: `${dd}/${mm}/${yyyy}` };
      }
    }
  }
  return { ts: 0, formattedDate: '' };
}

function normalizeDocBaseTitleKey(title: string): string {
  return title
    .replace(/\s*\(\d{2}\/\d{2}\/\d{4}\)\s*/g, ' ')
    .replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*/g, ' ')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function markOlderDocumentVersions<
  T extends {
    title: string;
    url: string;
    isOlderVersion?: boolean;
    updatedDate?: string;
  },
>(docs: T[]): T[] {
  if (docs.length <= 1) return docs;
  const annotated = docs.map((doc) => {
    const baseKey = normalizeDocBaseTitleKey(doc.title);
    const parsed = parseVersionDateTimestamp(doc.updatedDate, doc.title, doc.url);
    return { doc, baseKey, ts: parsed.ts, formattedDate: parsed.formattedDate };
  });

  const maxTsByBase = new Map<string, number>();
  const distinctTsCountByBase = new Map<string, Set<number>>();
  for (const item of annotated) {
    if (!item.baseKey || item.ts <= 0) continue;
    const prevMax = maxTsByBase.get(item.baseKey) ?? 0;
    if (item.ts > prevMax) maxTsByBase.set(item.baseKey, item.ts);
    let tsSet = distinctTsCountByBase.get(item.baseKey);
    if (!tsSet) {
      tsSet = new Set<number>();
      distinctTsCountByBase.set(item.baseKey, tsSet);
    }
    tsSet.add(item.ts);
  }

  const marked = annotated.map(({ doc, baseKey, ts, formattedDate }) => {
    const maxTs = maxTsByBase.get(baseKey) ?? 0;
    const distinctDates = distinctTsCountByBase.get(baseKey)?.size ?? 0;
    const isOlder =
      Boolean(doc.isOlderVersion) ||
      (distinctDates >= 2 && ts > 0 && maxTs > 0 && ts < maxTs);
    return {
      ...doc,
      ...(formattedDate && !doc.updatedDate ? { updatedDate: formattedDate } : {}),
      ...(isOlder ? { isOlderVersion: true } : { isOlderVersion: false }),
    };
  });

  // Keep latest/active versions first so slice caps never cut off current revisions
  return [
    ...marked.filter((d) => !d.isOlderVersion),
    ...marked.filter((d) => Boolean(d.isOlderVersion)),
  ];
}

function buildBoundedSpecs(orderedSpecs: string[], bullets: string[], maxLen = 1850): string {
  const parts: string[] = [];
  if (orderedSpecs.length > 0) {
    parts.push(orderedSpecs.join('\n'));
  }
  if (bullets.length > 0) {
    const bulletBlock = bullets.map((b) => `• ${b}`).join('\n');
    parts.push(bulletBlock);
  }
  const combined = parts.join('\n\n').trim();
  if (combined.length <= maxLen) return combined;
  return combined.slice(0, maxLen - 1).trimEnd() + '…';
}

export async function clientInspectWithOpenCatalogs(params: {
  url: string;
  store: string;
  brand?: string;
  model?: string;
  title?: string;
  specs?: string;
  timeoutMs?: number;
}): Promise<ClientCatalogInspectResult | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.url);
  } catch {
    return null;
  }

  const getQueryParamCI = (names: string[]): string | undefined => {
    for (const [k, v] of parsedUrl.searchParams.entries()) {
      if (names.includes(k.toLowerCase())) {
        const clean = v.trim();
        if (clean) return clean.slice(0, 60);
      }
    }
    return undefined;
  };

  const queryPnc = getQueryParamCI([
    'pnc',
    'productnumber',
    'product_number',
    'productcode',
    'product_code',
  ]);
  const queryModel = getQueryParamCI([
    'model',
    'modello',
    'sku',
    'mpn',
    'prodid',
    'productid',
    'product_id',
    'code',
    'codice',
    'artnr',
    'partnumber',
    'part_number',
  ]);

  const cleanText = `${params.title || ''} ${params.specs || ''} ${params.url}`;
  const eanMatch = cleanText.match(/\b(\d{13})\b/);
  const ean = eanMatch?.[1];

  const brandCandidates: string[] = [];
  const pushBrand = (b?: string) => {
    const t = (b || '').trim();
    if (t && !brandCandidates.some((x) => x.toLowerCase() === t.toLowerCase())) {
      brandCandidates.push(t);
    }
  };
  const baseBrand = (params.brand || '').trim() || (params.store || '').trim();
  if (/electrolux/i.test(baseBrand) || /electrolux\./i.test(params.url)) {
    pushBrand('AEG');
    pushBrand('Electrolux');
    pushBrand('Zanussi');
  } else if (/\baeg\b/i.test(baseBrand) || /\baeg\./i.test(params.url)) {
    pushBrand('AEG');
    pushBrand('Electrolux');
  } else if (/bosch/i.test(baseBrand) || /bosch/i.test(params.url)) {
    pushBrand('Bosch');
    pushBrand('Siemens');
  } else if (/whirlpool|hotpoint|indesit/i.test(baseBrand)) {
    pushBrand(baseBrand);
    pushBrand('Whirlpool');
    pushBrand('Hotpoint');
  } else if (
    baseBrand &&
    !/^(amazon|ebay|mediaworld|unieuro|euronics|google)$/i.test(baseBrand)
  ) {
    pushBrand(baseBrand);
  }

  const codeCandidates: string[] = [];
  const pushCode = (c?: string) => {
    const t = (c || '').trim();
    if (t && t.length >= 4 && !/^B0[A-Z0-9]{8}$/i.test(t) && !codeCandidates.includes(t)) {
      codeCandidates.push(t);
    }
  };
  const rawCode = (queryPnc || queryModel || params.model || '').trim();
  if (rawCode) {
    if (/^\d{9}$/.test(rawCode)) {
      pushCode(`${rawCode.slice(0, 3)} ${rawCode.slice(3, 6)} ${rawCode.slice(6, 9)}`);
    }
    pushCode(rawCode);
  }
  const titleCodeMatch = (params.title || '').match(/\b([A-Z]{2,}[0-9][A-Z0-9-]{2,})\b/);
  if (titleCodeMatch?.[1]) {
    pushCode(titleCodeMatch[1]);
  }
  const urlCodeMatch = parsedUrl.pathname.match(/\/([A-Z]{2,}[0-9][A-Z0-9-]{2,})(?:[/?#]|$)/i);
  if (urlCodeMatch?.[1]) {
    pushCode(urlCodeMatch[1].toUpperCase());
  }

  const lookupUrls: string[] = [];
  if (ean) {
    lookupUrls.push(
      `https://live.icecat.biz/api/?UserName=openIcecat-live&Language=it&GTIN=${encodeURIComponent(ean)}`
    );
  }
  for (const b of brandCandidates.slice(0, 3)) {
    for (const c of codeCandidates.slice(0, 2)) {
      if (lookupUrls.length >= 6) break;
      lookupUrls.push(
        `https://live.icecat.biz/api/?UserName=openIcecat-live&Language=it&Brand=${encodeURIComponent(b)}&ProductCode=${encodeURIComponent(c)}`
      );
    }
  }

  if (lookupUrls.length === 0) return null;

  const timeoutMs = Math.max(2500, Math.min(8000, params.timeoutMs ?? 6000));

  type IcecatApiResponse = {
    msg?: string;
    data?: {
      GeneralInfo?: {
        Title?: string;
        Brand?: string;
        ProductName?: string;
        BrandPartCode?: string;
        GTIN?: string[];
        Description?: {
          ManualPDFURL?: string;
          LeafletPDFURL?: string;
        };
        BulletPoints?: {
          Values?: string[];
        };
      };
      Image?: {
        HighPic?: string;
        Pic500x500?: string;
      };
      Gallery?: Array<{ Pic?: string; Pic500x500?: string }>;
      Multimedia?: Array<{
        Description?: string;
        Type?: string;
        URL?: string;
        ContentType?: string;
        Updated?: string;
      }>;
      FeaturesGroups?: Array<{
        FeatureGroup?: { Name?: { Value?: string } };
        Features?: Array<{
          Feature?: { Name?: { Value?: string } };
          PresentationValue?: string;
        }>;
      }>;
    };
  };

  try {
    const results = await Promise.allSettled(
      lookupUrls.map(async (u) => {
        const resp = await fetch(u, {
          method: 'GET',
          mode: 'cors',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) return null;
        const json = (await resp.json()) as IcecatApiResponse;
        if (json?.msg === 'OK' && json.data?.GeneralInfo?.Title) {
          return json.data;
        }
        return null;
      })
    );

    const hit = results.find(
      (r): r is PromiseFulfilledResult<NonNullable<IcecatApiResponse['data']>> =>
        r.status === 'fulfilled' && Boolean(r.value)
    )?.value;
    if (!hit || !hit.GeneralInfo) return null;

    const gi = hit.GeneralInfo;
    const icTitle =
      (gi.Title || '').replace(/\s+/g, ' ').trim().slice(0, 160) ||
      params.title ||
      `Prodotto ${params.store}`;
    const icBrand = (gi.Brand || '').trim().slice(0, 60) || undefined;
    const prodCodeToken = (gi.ProductName || '').trim().split(/\s+/)[0];
    const partCode = (gi.BrandPartCode || '').trim();
    const icModel =
      prodCodeToken &&
      /^[A-Z0-9-]{4,}$/i.test(prodCodeToken) &&
      partCode &&
      prodCodeToken !== partCode
        ? `${prodCodeToken} (${partCode})`.slice(0, 80)
        : (partCode || prodCodeToken || '').slice(0, 80) || undefined;

    const rawImg =
      hit.Image?.HighPic ||
      hit.Image?.Pic500x500 ||
      hit.Gallery?.[0]?.Pic ||
      hit.Gallery?.[0]?.Pic500x500;
    const icImage = rawImg && /^https?:\/\/.+/.test(rawImg) ? rawImg.slice(0, 1000) : undefined;

    const orderedSpecs: string[] = [];
    const seenSpecLabels = new Set<string>();
    const pushSpec = (label: string, value: string) => {
      const cleanL = stripHtmlTagsClient(label);
      const cleanV = stripHtmlTagsClient(value);
      if (!cleanL || !cleanV) return;
      const key = cleanL.toLowerCase();
      if (seenSpecLabels.has(key)) return;
      seenSpecLabels.add(key);
      orderedSpecs.push(`${cleanL}: ${cleanV}`);
    };

    if (params.specs) {
      for (const line of params.specs.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          pushSpec(line.slice(0, idx), line.slice(idx + 1));
        }
      }
    }
    if (partCode && !seenSpecLabels.has('codice pnc') && !seenSpecLabels.has('codice articolo')) {
      pushSpec('Codice prodotto', partCode);
    }
    if (Array.isArray(gi.GTIN) && gi.GTIN[0]) {
      pushSpec('Codice EAN', gi.GTIN[0]);
    }

    let icColor: string | undefined;
    const groupPriority = (groupName: string): number => {
      const g = groupName.toLowerCase();
      if (/dimensioni|peso/.test(g)) return 0;
      if (/energetic|potenza|alimentazione/.test(g)) return 1;
      if (/prestazion/.test(g)) return 2;
      if (/caratteristiche/.test(g)) return 3;
      if (/design/.test(g)) return 4;
      if (/ergonomia|tecnici/.test(g)) return 5;
      return 6;
    };

    const sortedGroups = [...(hit.FeaturesGroups || [])].sort(
      (a, b) =>
        groupPriority(a.FeatureGroup?.Name?.Value || '') -
        groupPriority(b.FeatureGroup?.Name?.Value || '')
    );

    for (const fg of sortedGroups) {
      for (const f of fg.Features || []) {
        const fname = (f.Feature?.Name?.Value || '').trim();
        const fval = (f.PresentationValue || '').trim();
        if (!icColor && /^colore del prodotto$/i.test(fname) && fval) {
          icColor = fval.slice(0, 60);
        }
      }
    }

    for (const fg of sortedGroups) {
      const groupName = (fg.FeatureGroup?.Name?.Value || '').toLowerCase();
      if (/imballaggio|logistici/.test(groupName)) continue;
      for (const f of fg.Features || []) {
        const fname = f.Feature?.Name?.Value || '';
        const fval = f.PresentationValue || '';
        if (!fname || !fval) continue;
        if (
          /^(scala di efficienza|indice di efficienza|efficacia del risciacquo|certificazione|certificati|consumi \(modalità|partenza ritardata)/i.test(
            fname.trim()
          )
        ) {
          continue;
        }
        pushSpec(fname, fval);
        if (orderedSpecs.length >= 28) break;
      }
      if (orderedSpecs.length >= 28) break;
    }

    const rawBullets = (gi.BulletPoints?.Values || [])
      .map((b) => stripHtmlTagsClient(b).replace(/\s*\[\d+\]/g, '').trim())
      .filter((b) => b.length >= 12);

    const icSpecs =
      orderedSpecs.length > 0 || rawBullets.length > 0
        ? buildBoundedSpecs(orderedSpecs, rawBullets, 1850)
        : params.specs;

    const rawDocs: CatalogDocumentDto[] = [];
    const seenDocUrls = new Set<string>();
    const pdfMedia = (hit.Multimedia || []).filter((m) => {
      const ct = (m.ContentType || '').toLowerCase();
      return ct === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(m.URL || '');
    });

    const baseTitleCounts = new Map<string, number>();
    for (const m of pdfMedia) {
      const key = stripHtmlTagsClient(m.Description || m.Type || 'Documento PDF').toLowerCase();
      baseTitleCounts.set(key, (baseTitleCounts.get(key) || 0) + 1);
    }

    const usedDocTitles = new Map<string, number>();
    const pushIcecatDoc = (rawTitle: string, docUrl?: string, updatedRaw?: string) => {
      const cleanU = (docUrl || '').trim();
      if (!cleanU || !/^https?:\/\/.+/i.test(cleanU)) return;
      const norm = cleanU.split('#')[0].toLowerCase();
      if (seenDocUrls.has(norm)) return;
      seenDocUrls.add(norm);

      const baseClean = stripHtmlTagsClient(rawTitle || 'Documento prodotto');
      const baseKey = baseClean.toLowerCase();
      const hasDupBase = (baseTitleCounts.get(baseKey) || 0) > 1;
      const parsedDate = parseVersionDateTimestamp(updatedRaw, undefined, cleanU);
      const dateSuffix = hasDupBase ? parsedDate.formattedDate : '';
      let candidateTitle = dateSuffix ? `${baseClean} (${dateSuffix})` : baseClean;
      const candKey = candidateTitle.toLowerCase();
      const seenCount = (usedDocTitles.get(candKey) || 0) + 1;
      usedDocTitles.set(candKey, seenCount);
      if (seenCount > 1) {
        candidateTitle = `${candidateTitle} (${seenCount})`;
      }
      rawDocs.push({
        title: candidateTitle.slice(0, 80),
        url: cleanU.slice(0, 1000),
        kind: inferClientDocumentKind(candidateTitle, cleanU),
        ...(parsedDate.formattedDate ? { updatedDate: parsedDate.formattedDate } : {}),
      });
    };

    for (const m of pdfMedia) {
      pushIcecatDoc(m.Description || m.Type || 'Documento PDF', m.URL, m.Updated);
    }
    if (gi.Description?.ManualPDFURL) {
      pushIcecatDoc("Manuale dell'utente", gi.Description.ManualPDFURL);
    }
    if (gi.Description?.LeafletPDFURL) {
      pushIcecatDoc('Scheda prodotto / Volantino', gi.Description.LeafletPDFURL);
    }

    const versionedDocs = markOlderDocumentVersions(rawDocs).slice(0, 12);

    return {
      url: params.url,
      title: icTitle,
      store: params.store,
      brand: icBrand,
      model: icModel,
      color: icColor,
      imageUrl: icImage,
      specs: icSpecs,
      documents: versionedDocs.length > 0 ? versionedDocs : undefined,
      extractedFrom: 'page-meta',
      blockedBySite: false,
    };
  } catch {
    return null;
  }
}
