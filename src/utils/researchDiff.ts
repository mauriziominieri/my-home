export interface ParsedTechSpecEntry {
  key: string;
  label: string;
  value: string;
}

export interface ParsedResearchSpecs {
  techSpecs: ParsedTechSpecEntry[];
  bullets: string[];
}

export interface ResearchSpecsDiff {
  addedTechSpecs: Array<{ label: string; value: string }>;
  modifiedTechSpecs: Array<{ label: string; prevValue: string; nextValue: string }>;
  removedTechSpecs: Array<{ label: string; prevValue: string }>;
  addedBullets: string[];
  removedBullets: string[];
  details: string[];
}

export interface VariantListDiff {
  added: string[];
  removed: string[];
  details: string[];
}

export interface ResearchSiteRefreshDiff {
  refreshedAt: number;
  addedTechSpecs: Array<{ label: string; value: string }>;
  modifiedTechSpecs: Array<{ label: string; prevValue: string; nextValue: string }>;
  removedTechSpecs: Array<{ label: string; prevValue: string }>;
  addedBullets: string[];
  removedBullets: string[];
  addedColors: string[];
  removedColors: string[];
  addedSizes: string[];
  removedSizes: string[];
  priceChange?: { prev?: number; next?: number };
  titleChanged?: boolean;
  modelChanged?: boolean;
  imageChanged?: boolean;
  addedDocsCount?: number;
}

function truncateText(val: string, max: number): string {
  const clean = val.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function normalizeSpecLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeBulletCompareKey(bullet: string): string {
  return bullet
    .replace(/^[•-]\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function parseResearchSpecParts(specs?: string): ParsedResearchSpecs {
  if (!specs) return { techSpecs: [], bullets: [] };
  const techSpecs: ParsedTechSpecEntry[] = [];
  const bullets: string[] = [];
  const seenTechKeys = new Set<string>();
  const seenBulletKeys = new Set<string>();

  for (const rawLine of specs.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('•') || line.startsWith('- ')) {
      const cleaned = line.replace(/^[•-]\s*/, '').trim();
      const key = normalizeBulletCompareKey(cleaned);
      if (cleaned && !seenBulletKeys.has(key)) {
        seenBulletKeys.add(key);
        bullets.push(cleaned);
      }
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx > 1 && colonIdx < 42 && !/^https?:/i.test(line)) {
      const label = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (label && value) {
        const key = normalizeSpecLabelKey(label);
        if (!seenTechKeys.has(key)) {
          seenTechKeys.add(key);
          techSpecs.push({ key, label, value });
        } else {
          const existing = techSpecs.find((t) => t.key === key);
          if (existing) existing.value = value;
        }
        continue;
      }
    }
    const cleaned = line.replace(/^[•-]\s*/, '').trim();
    const key = normalizeBulletCompareKey(cleaned);
    if (cleaned && !seenBulletKeys.has(key)) {
      seenBulletKeys.add(key);
      bullets.push(cleaned);
    }
  }

  return { techSpecs, bullets };
}

export function diffResearchSpecs(prevSpecs?: string, nextSpecs?: string): ResearchSpecsDiff {
  const prevParsed = parseResearchSpecParts(prevSpecs);
  const nextParsed = parseResearchSpecParts(nextSpecs);

  const prevTechByKey = new Map<string, ParsedTechSpecEntry>();
  for (const entry of prevParsed.techSpecs) {
    prevTechByKey.set(entry.key, entry);
  }
  const nextTechByKey = new Map<string, ParsedTechSpecEntry>();
  for (const entry of nextParsed.techSpecs) {
    nextTechByKey.set(entry.key, entry);
  }

  const addedTechSpecs: Array<{ label: string; value: string }> = [];
  const modifiedTechSpecs: Array<{ label: string; prevValue: string; nextValue: string }> = [];
  const removedTechSpecs: Array<{ label: string; prevValue: string }> = [];

  for (const nextEntry of nextParsed.techSpecs) {
    const prevEntry = prevTechByKey.get(nextEntry.key);
    if (!prevEntry) {
      addedTechSpecs.push({ label: nextEntry.label, value: nextEntry.value });
    } else if (
      prevEntry.value.replace(/\s+/g, ' ').trim() !==
      nextEntry.value.replace(/\s+/g, ' ').trim()
    ) {
      modifiedTechSpecs.push({
        label: nextEntry.label,
        prevValue: prevEntry.value,
        nextValue: nextEntry.value,
      });
    }
  }

  for (const prevEntry of prevParsed.techSpecs) {
    if (!nextTechByKey.has(prevEntry.key)) {
      removedTechSpecs.push({ label: prevEntry.label, prevValue: prevEntry.value });
    }
  }

  const prevBulletKeys = new Set(prevParsed.bullets.map(normalizeBulletCompareKey));
  const nextBulletKeys = new Set(nextParsed.bullets.map(normalizeBulletCompareKey));

  const addedBullets = nextParsed.bullets.filter(
    (b) => !prevBulletKeys.has(normalizeBulletCompareKey(b))
  );
  const removedBullets = prevParsed.bullets.filter(
    (b) => !nextBulletKeys.has(normalizeBulletCompareKey(b))
  );

  const details: string[] = [];
  for (const mod of modifiedTechSpecs) {
    details.push(
      `Specifica aggiornata (${mod.label}): ${truncateText(mod.prevValue, 45)} → ${truncateText(mod.nextValue, 45)}`
    );
  }
  for (const add of addedTechSpecs) {
    details.push(`Specifica aggiunta: ${add.label}: ${truncateText(add.value, 70)}`);
  }
  for (const rem of removedTechSpecs) {
    details.push(`Specifica rimossa: ${rem.label}: ${truncateText(rem.prevValue, 70)}`);
  }
  for (const addB of addedBullets) {
    details.push(`Punto chiave aggiunto: "${truncateText(addB, 130)}"`);
  }
  for (const remB of removedBullets) {
    details.push(`Punto chiave rimosso: "${truncateText(remB, 130)}"`);
  }

  if (
    details.length === 0 &&
    (prevSpecs || '').trim() !== (nextSpecs || '').trim()
  ) {
    details.push('Specifiche aggiornate');
  }

  return {
    addedTechSpecs,
    modifiedTechSpecs,
    removedTechSpecs,
    addedBullets,
    removedBullets,
    details,
  };
}

export function diffVariantOptionLists(
  prevList: string[] | undefined,
  nextList: string[] | undefined,
  kind: 'color' | 'size'
): VariantListDiff {
  const normKey = (val: string) =>
    kind === 'size'
      ? val.trim().toLowerCase().replace(/\s+/g, '')
      : val.trim().toLowerCase();

  const cleanPrev = Array.isArray(prevList)
    ? prevList.map((v) => String(v).trim()).filter(Boolean)
    : [];
  const cleanNext = Array.isArray(nextList)
    ? nextList.map((v) => String(v).trim()).filter(Boolean)
    : [];

  const prevKeys = new Set(cleanPrev.map(normKey));
  const nextKeys = new Set(cleanNext.map(normKey));

  const added = cleanNext.filter((v) => !prevKeys.has(normKey(v)));
  const removed = cleanPrev.filter((v) => !nextKeys.has(normKey(v)));

  const details: string[] = [];
  if (kind === 'color') {
    if (added.length > 0) {
      details.push(
        `${added.length === 1 ? 'Colore aggiunto' : 'Colori aggiunti'}: ${added.join(', ')}`
      );
    }
    if (removed.length > 0) {
      details.push(
        `${removed.length === 1 ? 'Colore rimosso' : 'Colori rimossi'}: ${removed.join(', ')}`
      );
    }
    if (details.length === 0 && JSON.stringify(cleanPrev) !== JSON.stringify(cleanNext)) {
      details.push(
        cleanNext.length > 0
          ? `Varianti colore: ${cleanNext.length} opzioni`
          : 'Varianti colore rimosse'
      );
    }
  } else {
    if (added.length > 0) {
      details.push(
        `${added.length === 1 ? 'Taglia aggiunta' : 'Taglie aggiunte'}: ${added.join(', ')}`
      );
    }
    if (removed.length > 0) {
      details.push(
        `${removed.length === 1 ? 'Taglia rimossa' : 'Taglie rimosse'}: ${removed.join(', ')}`
      );
    }
    if (details.length === 0 && JSON.stringify(cleanPrev) !== JSON.stringify(cleanNext)) {
      details.push(
        cleanNext.length > 0
          ? `Varianti taglia: ${cleanNext.length} opzioni`
          : 'Varianti taglia rimosse'
      );
    }
  }

  return { added, removed, details };
}

function unwrapQuotedText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Parses `changedDetails` entries back into structured spec/variant diffs so
 * even queued changes from Browser Test Mode (across reloads) highlight exact rows.
 */
export function parseResearchQueueDiffDetails(
  details: string[]
): Partial<ResearchSiteRefreshDiff> {
  const addedTechSpecs: Array<{ label: string; value: string }> = [];
  const modifiedTechSpecs: Array<{ label: string; prevValue: string; nextValue: string }> = [];
  const removedTechSpecs: Array<{ label: string; prevValue: string }> = [];
  const addedBullets: string[] = [];
  const removedBullets: string[] = [];
  const addedColors: string[] = [];
  const removedColors: string[] = [];
  const addedSizes: string[] = [];
  const removedSizes: string[] = [];

  for (const rawDetail of details) {
    const detail = rawDetail.trim();
    if (!detail) continue;

    const modMatch = detail.match(/^Specifica aggiornata \((.+?)\):\s*(.+?)\s*→\s*(.+)$/i);
    if (modMatch) {
      modifiedTechSpecs.push({
        label: modMatch[1].trim(),
        prevValue: modMatch[2].trim(),
        nextValue: modMatch[3].trim(),
      });
      continue;
    }

    const addSpecMatch = detail.match(/^Specifica aggiunta:\s*([^:]+):\s*(.+)$/i);
    if (addSpecMatch) {
      addedTechSpecs.push({
        label: addSpecMatch[1].trim(),
        value: addSpecMatch[2].trim(),
      });
      continue;
    }

    const remSpecMatch = detail.match(/^Specifica rimossa:\s*([^:]+):\s*(.+)$/i);
    if (remSpecMatch) {
      removedTechSpecs.push({
        label: remSpecMatch[1].trim(),
        prevValue: remSpecMatch[2].trim(),
      });
      continue;
    }

    const addBulletMatch = detail.match(/^Punto chiave aggiunto:\s*(.+)$/i);
    if (addBulletMatch) {
      addedBullets.push(unwrapQuotedText(addBulletMatch[1]));
      continue;
    }

    const remBulletMatch = detail.match(/^Punto chiave rimosso:\s*(.+)$/i);
    if (remBulletMatch) {
      removedBullets.push(unwrapQuotedText(remBulletMatch[1]));
      continue;
    }

    const addColorMatch = detail.match(/^Color[ei] aggiunt[oi]:\s*(.+)$/i);
    if (addColorMatch) {
      addedColors.push(
        ...addColorMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      continue;
    }

    const remColorMatch = detail.match(/^Color[ei] rimoss[oi]:\s*(.+)$/i);
    if (remColorMatch) {
      removedColors.push(
        ...remColorMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      continue;
    }

    const addSizeMatch = detail.match(/^Tagli[ae] aggiunt[ae]:\s*(.+)$/i);
    if (addSizeMatch) {
      addedSizes.push(
        ...addSizeMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      continue;
    }

    const remSizeMatch = detail.match(/^Tagli[ae] rimoss[ae]:\s*(.+)$/i);
    if (remSizeMatch) {
      removedSizes.push(
        ...remSizeMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      continue;
    }
  }

  return {
    addedTechSpecs,
    modifiedTechSpecs,
    removedTechSpecs,
    addedBullets,
    removedBullets,
    addedColors,
    removedColors,
    addedSizes,
    removedSizes,
  };
}
