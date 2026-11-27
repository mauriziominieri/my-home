import React, { useMemo } from 'react';
import { Link2, Paperclip, Trash2, X } from 'lucide-react';
import {
  discardSimulatedFirestoreOps,
  SimulatedFirestoreOp,
} from '../firebase';

export interface SimulatedQueueContext {
  productTitlesById?: Record<string, string>;
  articleTitlesById?: Record<string, string>;
  docLinksById?: Record<
    string,
    {
      parentType: 'research' | 'article';
      parentId: string;
      parentTitle?: string;
      title?: string;
      fileName?: string;
    }
  >;
}

interface ResolvedOpGroupMeta {
  groupKey: string;
  groupSection: string;
  groupTitle: string;
  isParentSubject: boolean;
}

interface DisplayQueueStep {
  key: string;
  opIds: string[];
  createdAt: number;
  tone: 'create' | 'edit' | 'delete' | 'attachment' | 'older_attachment';
  actionLabel: string;
  subTarget?: string;
  details: string[];
  writeCount: number;
}

interface DisplayQueueGroup {
  groupKey: string;
  section: string;
  title: string;
  latestAt: number;
  totalWrites: number;
  allOpIds: string[];
  steps: DisplayQueueStep[];
}

function parseDocRefFromSerial(serial: unknown): {
  parentType: 'research' | 'article';
  parentId: string;
  docType: string;
} | null {
  if (typeof serial !== 'string') return null;
  const parts = serial.split('|');
  if (parts.length !== 3) return null;
  if (parts[0] === 'RESDOC' && parts[1]) {
    return { parentType: 'research', parentId: parts[1], docType: parts[2] };
  }
  if (parts[0] === 'ARTDOC' && parts[1]) {
    return { parentType: 'article', parentId: parts[1], docType: parts[2] };
  }
  return null;
}

function extractVaultKeyFromOpData(data?: Record<string, unknown>): string | null {
  if (!data) return null;
  if (typeof data.manualFileKey === 'string' && data.manualFileKey) {
    return data.manualFileKey;
  }
  if (typeof data.pdfFileKey === 'string' && data.pdfFileKey) {
    return data.pdfFileKey;
  }
  if (typeof data.specs === 'string') {
    const match = data.specs.match(/(?:^|\|)KEY:([^|]+)/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function stripRedundantGroupTitle(
  subTarget: string | undefined,
  groupTitle: string
): string | undefined {
  const raw = (subTarget || '').trim();
  if (!raw) return undefined;
  const groupLow = groupTitle.trim().toLowerCase();
  if (!groupLow) return raw;
  if (raw.toLowerCase() === groupLow) return undefined;

  let cleaned = raw;
  for (let pass = 0; pass < 2; pass += 1) {
    const sepIdx = cleaned.lastIndexOf(' · ');
    if (sepIdx <= 0) break;
    const left = cleaned.slice(0, sepIdx).trim();
    const right = cleaned.slice(sepIdx + 3).trim();
    const rightLow = right.toLowerCase();
    const leftLow = left.toLowerCase();
    if (rightLow.length >= 4 && (groupLow === rightLow || groupLow.startsWith(rightLow))) {
      cleaned = left;
      continue;
    }
    if (leftLow.length >= 4 && (groupLow === leftLow || groupLow.startsWith(leftLow))) {
      cleaned = right;
      continue;
    }
    break;
  }

  if (!cleaned) return undefined;
  const cleanedLow = cleaned.toLowerCase();
  if (cleanedLow === groupLow || (cleanedLow.length >= 12 && groupLow.startsWith(cleanedLow))) {
    return undefined;
  }
  return cleaned;
}

function isOlderAttachmentOp(op: SimulatedFirestoreOp): boolean {
  const label = (op.actionLabel || '').toLowerCase();
  if (label.includes('versione vecchia') || label.includes('versione precedente')) {
    return true;
  }
  if (
    Array.isArray(op.changedDetails) &&
    op.changedDetails.some((d) => {
      const low = d.toLowerCase();
      return low.includes('versione vecchia') || low.includes('versione precedente');
    })
  ) {
    return true;
  }
  const notes = typeof op.data?.notes === 'string' ? op.data.notes.toLowerCase() : '';
  return notes.includes('versione vecchia inclusa');
}

function inferStepTone(op: SimulatedFirestoreOp): DisplayQueueStep['tone'] {
  if (op.kind === 'delete' || op.kind === 'vault_delete') return 'delete';
  if (op.kind === 'vault_upload') {
    return isOlderAttachmentOp(op) ? 'older_attachment' : 'attachment';
  }
  const label = (op.actionLabel || '').toLowerCase();
  if (
    label.includes('allegat') ||
    label.includes('documento collegato') ||
    label.includes('link documento') ||
    label.includes('manuale pdf')
  ) {
    return isOlderAttachmentOp(op) ? 'older_attachment' : 'attachment';
  }
  if (op.changedFields?.includes('__new__') || label.includes('nuov')) {
    return 'create';
  }
  return 'edit';
}

function resolveOpGroupMeta(
  op: SimulatedFirestoreOp,
  context: SimulatedQueueContext | undefined,
  vaultKeyToMeta: Map<string, ResolvedOpGroupMeta>
): ResolvedOpGroupMeta {
  if (op.groupKey && op.groupSection && op.groupTitle) {
    const isParentSubject = Boolean(
      op.path?.includes('/productResearches/') ||
        (op.groupKey.startsWith('article:') && op.path?.endsWith(`/${op.groupKey.slice(8)}`))
    );
    return {
      groupKey: op.groupKey,
      groupSection: op.groupSection,
      groupTitle: op.groupTitle,
      isParentSubject,
    };
  }

  if (op.path) {
    const resMatch = op.path.match(/\/productResearches\/([^/]+)$/);
    if (resMatch?.[1]) {
      const id = resMatch[1];
      return {
        groupKey: `research:${id}`,
        groupSection: 'Prodotti',
        groupTitle: context?.productTitlesById?.[id] || op.targetTitle,
        isParentSubject: true,
      };
    }

    const artMatch = op.path.match(/\/homeArticles\/([^/]+)$/);
    if (artMatch?.[1]) {
      const docId = artMatch[1];
      const refFromData = parseDocRefFromSerial(op.data?.serialNumber);
      if (refFromData) {
        if (refFromData.parentType === 'research') {
          return {
            groupKey: `research:${refFromData.parentId}`,
            groupSection: 'Prodotti',
            groupTitle:
              context?.productTitlesById?.[refFromData.parentId] || op.groupTitle || 'Prodotto',
            isParentSubject: false,
          };
        }
        return {
          groupKey: `article:${refFromData.parentId}`,
          groupSection: 'Articoli',
          groupTitle:
            context?.articleTitlesById?.[refFromData.parentId] || op.groupTitle || 'Articolo',
          isParentSubject: false,
        };
      }

      const linkedMeta = context?.docLinksById?.[docId];
      if (linkedMeta) {
        if (linkedMeta.parentType === 'research') {
          return {
            groupKey: `research:${linkedMeta.parentId}`,
            groupSection: 'Prodotti',
            groupTitle:
              linkedMeta.parentTitle ||
              context?.productTitlesById?.[linkedMeta.parentId] ||
              'Prodotto',
            isParentSubject: false,
          };
        }
        return {
          groupKey: `article:${linkedMeta.parentId}`,
          groupSection: 'Articoli',
          groupTitle:
            linkedMeta.parentTitle ||
            context?.articleTitlesById?.[linkedMeta.parentId] ||
            'Articolo',
          isParentSubject: false,
        };
      }

      const isSystemOrSpecial =
        docId.startsWith('doc_') ||
        docId.startsWith('resdoc_') ||
        docId.startsWith('artdoc_') ||
        docId.startsWith('spesa_') ||
        docId.startsWith('rem_') ||
        docId.startsWith('vinted_') ||
        docId.startsWith('car_') ||
        docId === 'app_settings_state' ||
        docId === 'climate_autopilot_state' ||
        docId === 'reminders_notify_config';

      if (!isSystemOrSpecial) {
        return {
          groupKey: `article:${docId}`,
          groupSection: 'Articoli',
          groupTitle: context?.articleTitlesById?.[docId] || op.targetTitle,
          isParentSubject: true,
        };
      }
    }
  }

  if (op.kind === 'vault_upload' && op.vaultUpload?.fileKey) {
    const fk = op.vaultUpload.fileKey;
    const paired = vaultKeyToMeta.get(fk);
    if (paired) return { ...paired, isParentSubject: false };
    const manualMatch = fk.match(/^article_manual_(art_[^_]+_[^_]+_[^_]+|\w+)_\d+$/);
    if (manualMatch?.[1] && context?.articleTitlesById?.[manualMatch[1]]) {
      return {
        groupKey: `article:${manualMatch[1]}`,
        groupSection: 'Articoli',
        groupTitle: context.articleTitlesById[manualMatch[1]],
        isParentSubject: false,
      };
    }
  }

  if (op.kind === 'vault_delete' && op.vaultDelete?.keys?.length) {
    for (const k of op.vaultDelete.keys) {
      const paired = vaultKeyToMeta.get(k);
      if (paired) return { ...paired, isParentSubject: false };
      if (k.startsWith('att_')) {
        const docId = k.slice(4);
        const linkedMeta = context?.docLinksById?.[docId];
        if (linkedMeta) {
          return {
            groupKey:
              linkedMeta.parentType === 'research'
                ? `research:${linkedMeta.parentId}`
                : `article:${linkedMeta.parentId}`,
            groupSection: linkedMeta.parentType === 'research' ? 'Prodotti' : 'Articoli',
            groupTitle: linkedMeta.parentTitle || linkedMeta.title || docId,
            isParentSubject: false,
          };
        }
      }
    }
  }

  if (op.kind === 'batch' && op.batchOps?.length) {
    for (const sub of op.batchOps) {
      const resMatch = sub.path.match(/\/productResearches\/([^/]+)$/);
      if (resMatch?.[1]) {
        const id = resMatch[1];
        return {
          groupKey: `research:${id}`,
          groupSection: 'Prodotti',
          groupTitle: context?.productTitlesById?.[id] || op.targetTitle,
          isParentSubject: true,
        };
      }
    }
  }

  return {
    groupKey: `op:${op.id}`,
    groupSection: op.section,
    groupTitle: op.targetTitle,
    isParentSubject: true,
  };
}

function buildSimulatedOpGroups(
  ops: SimulatedFirestoreOp[],
  context?: SimulatedQueueContext
): DisplayQueueGroup[] {
  // First pass: map vault file keys referenced by document/article ops in the queue
  const vaultKeyToMeta = new Map<string, ResolvedOpGroupMeta>();
  for (const op of ops) {
    const fk = extractVaultKeyFromOpData(op.data);
    if (!fk) continue;
    const tempMeta = resolveOpGroupMeta(op, context, vaultKeyToMeta);
    if (!tempMeta.groupKey.startsWith('op:')) {
      vaultKeyToMeta.set(fk, tempMeta);
    }
  }

  const groupsMap = new Map<
    string,
    {
      groupKey: string;
      section: string;
      title: string;
      hasParentTitle: boolean;
      ops: SimulatedFirestoreOp[];
    }
  >();

  for (const op of ops) {
    const meta = resolveOpGroupMeta(op, context, vaultKeyToMeta);
    const existing = groupsMap.get(meta.groupKey);
    if (!existing) {
      groupsMap.set(meta.groupKey, {
        groupKey: meta.groupKey,
        section: meta.groupSection,
        title: meta.groupTitle,
        hasParentTitle: meta.isParentSubject,
        ops: [op],
      });
    } else {
      existing.ops.push(op);
      if (meta.isParentSubject && (!existing.hasParentTitle || op.actionLabel.includes('Nuov'))) {
        existing.title = meta.groupTitle;
        existing.section = meta.groupSection;
        existing.hasParentTitle = true;
      }
    }
  }

  const result: DisplayQueueGroup[] = [];

  for (const group of groupsMap.values()) {
    const sortedOps = [...group.ops].sort((a, b) => a.createdAt - b.createdAt);
    const consumedVaultOpIds = new Set<string>();
    const steps: DisplayQueueStep[] = [];

    // Pre-pass: pair vault_upload / vault_delete ops with their document/article ops
    // BEFORE iterating sortedOps (vault_upload is queued slightly earlier than setDoc).
    const vaultUploadByKey = new Map<string, SimulatedFirestoreOp>();
    const vaultDeleteOps: SimulatedFirestoreOp[] = [];
    for (const op of sortedOps) {
      if (op.kind === 'vault_upload' && op.vaultUpload?.fileKey) {
        vaultUploadByKey.set(op.vaultUpload.fileKey, op);
      } else if (op.kind === 'vault_delete') {
        vaultDeleteOps.push(op);
      }
    }

    const pairedUploadByDocOpId = new Map<string, SimulatedFirestoreOp>();
    for (const op of sortedOps) {
      if (op.kind !== 'set') continue;
      const fk = extractVaultKeyFromOpData(op.data);
      const pairedVault = fk ? vaultUploadByKey.get(fk) : undefined;
      if (pairedVault && pairedVault.id !== op.id && !consumedVaultOpIds.has(pairedVault.id)) {
        pairedUploadByDocOpId.set(op.id, pairedVault);
        consumedVaultOpIds.add(pairedVault.id);
      }
    }

    const deleteOps = sortedOps.filter((op) => op.kind === 'delete');
    const pairedDeletesByDocOpId = new Map<string, SimulatedFirestoreOp[]>();
    if (deleteOps.length > 0 && vaultDeleteOps.length > 0) {
      const remainingVaultDeletes = [...vaultDeleteOps];
      for (const delOp of deleteOps) {
        const fk = extractVaultKeyFromOpData(delOp.data);
        const delDocId = delOp.path?.split('/').pop();
        const candidateKeys = [
          fk,
          delDocId ? `att_${delDocId}` : null,
          delDocId ? `doc_${delDocId}` : null,
        ].filter((k): k is string => Boolean(k));
        const matched: SimulatedFirestoreOp[] = [];
        if (candidateKeys.length > 0) {
          for (let i = remainingVaultDeletes.length - 1; i >= 0; i -= 1) {
            const vKeys = remainingVaultDeletes[i].vaultDelete?.keys || [];
            if (candidateKeys.some((ck) => vKeys.includes(ck))) {
              matched.push(remainingVaultDeletes[i]);
              consumedVaultOpIds.add(remainingVaultDeletes[i].id);
              remainingVaultDeletes.splice(i, 1);
            }
          }
        }
        if (matched.length > 0) {
          pairedDeletesByDocOpId.set(delOp.id, matched);
        }
      }
      if (remainingVaultDeletes.length > 0 && deleteOps.length === 1) {
        const targetDel = deleteOps[0];
        const prev = pairedDeletesByDocOpId.get(targetDel.id) || [];
        remainingVaultDeletes.forEach((v) => consumedVaultOpIds.add(v.id));
        pairedDeletesByDocOpId.set(targetDel.id, [...prev, ...remainingVaultDeletes]);
      }
    }

    for (const op of sortedOps) {
      if (consumedVaultOpIds.has(op.id)) continue;

      const pairedVault = pairedUploadByDocOpId.get(op.id);
      if (pairedVault) {
        const fileName = pairedVault.vaultUpload?.fileName;
        const details = Array.from(
          new Set([
            ...(op.changedDetails || []),
            fileName ? `File: ${fileName}` : '',
          ].filter(Boolean))
        );
        const isOlder = isOlderAttachmentOp(op) || isOlderAttachmentOp(pairedVault);
        const cleanSubTarget = !group.groupKey.startsWith('op:')
          ? stripRedundantGroupTitle(op.targetTitle || pairedVault.targetTitle, group.title)
          : undefined;
        steps.push({
          key: `${op.id}+${pairedVault.id}`,
          opIds: [op.id, pairedVault.id],
          createdAt: Math.max(op.createdAt, pairedVault.createdAt),
          tone: isOlder ? 'older_attachment' : 'attachment',
          actionLabel: isOlder
            ? 'Allegato PDF (versione vecchia)'
            : op.actionLabel === 'Salvataggio'
              ? 'Allegato PDF caricato'
              : op.actionLabel,
          subTarget: cleanSubTarget,
          details,
          writeCount: op.writeCount + pairedVault.writeCount,
        });
        continue;
      }

      if (op.kind === 'delete') {
        const pairedDeletes = pairedDeletesByDocOpId.get(op.id) || [];
        const extraIds = pairedDeletes.map((v) => v.id);
        const extraWrites = pairedDeletes.reduce((sum, v) => sum + v.writeCount, 0);
        const cleanSubTarget = !group.groupKey.startsWith('op:')
          ? stripRedundantGroupTitle(op.targetTitle, group.title)
          : undefined;
        const details = [...(op.changedDetails || [])];
        if (extraIds.length > 0 && !details.some((d) => d.toLowerCase().includes('file'))) {
          details.push('File allegato rimosso dal cloud');
        }
        steps.push({
          key: op.id,
          opIds: [op.id, ...extraIds],
          createdAt: op.createdAt,
          tone: 'delete',
          actionLabel: op.actionLabel,
          subTarget: cleanSubTarget,
          details,
          writeCount: op.writeCount + extraWrites,
        });
        continue;
      }

      const cleanSubTarget = !group.groupKey.startsWith('op:')
        ? stripRedundantGroupTitle(op.targetTitle, group.title)
        : undefined;

      steps.push({
        key: op.id,
        opIds: [op.id],
        createdAt: op.createdAt,
        tone: inferStepTone(op),
        actionLabel: op.actionLabel,
        subTarget: cleanSubTarget,
        details: op.changedDetails || [],
        writeCount: op.writeCount,
      });
    }

    if (steps.length === 0) continue;

    const latestAt = Math.max(...steps.map((s) => s.createdAt));
    const totalWrites = steps.reduce((sum, s) => sum + s.writeCount, 0);
    const allOpIds = Array.from(new Set(group.ops.map((o) => o.id)));

    result.push({
      groupKey: group.groupKey,
      section: group.section,
      title: group.title,
      latestAt,
      totalWrites,
      allOpIds,
      steps,
    });
  }

  return result.sort((a, b) => b.latestAt - a.latestAt);
}

function getToneActionTextClass(tone: DisplayQueueStep['tone']): string {
  switch (tone) {
    case 'delete':
      return 'text-rose-700 dark:text-rose-300';
    case 'create':
      return 'text-indigo-700 dark:text-indigo-300';
    case 'attachment':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'older_attachment':
      return 'text-amber-700 dark:text-amber-300';
    case 'edit':
    default:
      return 'text-sky-700 dark:text-sky-300';
  }
}

function getAttachmentStepRowClass(tone: DisplayQueueStep['tone'], isSingleRow: boolean): string {
  if (tone === 'attachment') {
    return isSingleRow
      ? 'bg-emerald-50/55 dark:bg-emerald-950/20 hover:bg-emerald-50/85 dark:hover:bg-emerald-950/35'
      : 'rounded-md px-2 py-1 bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/80 dark:border-emerald-500/30';
  }
  if (tone === 'older_attachment') {
    return isSingleRow
      ? 'bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50/90 dark:hover:bg-amber-950/35'
      : 'rounded-md px-2 py-1 bg-amber-50/75 dark:bg-amber-950/25 border border-amber-300/80 dark:border-amber-500/35';
  }
  return isSingleRow
    ? 'hover:bg-white/60 dark:hover:bg-slate-900/50'
    : 'py-0.5';
}

interface SimulatedOpsQueueListProps {
  ops: SimulatedFirestoreOp[];
  context?: SimulatedQueueContext;
  flushing?: boolean;
  readOnlyActions?: boolean;
  maxHeightClass?: string;
  onDiscardOpIds?: (ids: string[]) => void;
}

export function SimulatedOpsQueueList({
  ops,
  context,
  flushing = false,
  readOnlyActions = false,
  maxHeightClass = 'max-h-64',
  onDiscardOpIds,
}: SimulatedOpsQueueListProps) {
  const groups = useMemo(() => buildSimulatedOpGroups(ops, context), [ops, context]);

  if (groups.length === 0) return null;

  const handleDiscard = (ids: string[]) => {
    if (flushing || readOnlyActions) return;
    if (onDiscardOpIds) {
      onDiscardOpIds(ids);
    } else {
      discardSimulatedFirestoreOps(ids);
    }
  };

  return (
    <div
      className={`${maxHeightClass} overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 divide-y divide-slate-200 dark:divide-slate-800`}
    >
      {groups.map((group) => {
        const groupTime = new Date(group.latestAt).toLocaleTimeString('it-IT', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        // Single ungrouped or single-step operation
        if (group.steps.length === 1) {
          const step = group.steps[0];
          const actionCls = getToneActionTextClass(step.tone);
          const singleRowCls = getAttachmentStepRowClass(step.tone, true);
          const isAttachmentTone =
            step.tone === 'attachment' || step.tone === 'older_attachment';

          return (
            <div
              key={group.groupKey}
              className={`px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs transition-colors ${singleRowCls}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                  {isAttachmentTone && (
                    <Paperclip
                      className={`w-3 h-3 shrink-0 ${
                        step.tone === 'older_attachment'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    />
                  )}
                  <span className={`font-semibold shrink-0 ${actionCls}`}>
                    {step.actionLabel}
                  </span>
                  <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                    {group.section}
                  </span>
                  <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {group.title}
                  </span>
                  {step.subTarget && (
                    <>
                      <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                        →
                      </span>
                      <span className="text-slate-700 dark:text-slate-300 truncate">
                        {step.subTarget}
                      </span>
                    </>
                  )}
                </div>

                {step.details.length > 0 && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {step.details.join(' · ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {groupTime}
                </span>
                {!readOnlyActions && (
                  <button
                    type="button"
                    disabled={flushing}
                    onClick={() => handleDiscard(step.opIds)}
                    title="Annulla questa operazione in coda"
                    aria-label="Annulla operazione in coda"
                    className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        }

        // Connected multi-operation group (e.g. a Product with edits + linked PDFs + docs)
        return (
          <div key={group.groupKey} className="px-3.5 py-2.5 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 shrink-0">
                  <Link2 className="w-3 h-3" />
                  {group.section}
                </span>
                <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                  {group.title}
                </span>
                <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                  {group.steps.length} operazioni collegate
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {groupTime}
                </span>
                {!readOnlyActions && (
                  <button
                    type="button"
                    disabled={flushing}
                    onClick={() => handleDiscard(group.allOpIds)}
                    title={`Annulla tutte le ${group.steps.length} operazioni su ${group.title}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/15 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Annulla tutto</span>
                  </button>
                )}
              </div>
            </div>

            <div className="ml-1.5 pl-3 border-l border-slate-200 dark:border-slate-700/80 space-y-1.5">
              {group.steps.map((step) => {
                const actionCls = getToneActionTextClass(step.tone);
                const stepRowCls = getAttachmentStepRowClass(step.tone, false);
                const isAttachmentTone =
                  step.tone === 'attachment' || step.tone === 'older_attachment';
                const stepTime = new Date(step.createdAt).toLocaleTimeString('it-IT', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <div
                    key={step.key}
                    className={`flex items-start justify-between gap-2 ${stepRowCls}`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                        {isAttachmentTone && (
                          <Paperclip
                            className={`w-3 h-3 shrink-0 ${
                              step.tone === 'older_attachment'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          />
                        )}
                        <span className={`font-semibold text-[11px] shrink-0 ${actionCls}`}>
                          {step.actionLabel}
                        </span>
                        {step.subTarget && (
                          <>
                            <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                              {step.subTarget}
                            </span>
                          </>
                        )}
                      </div>
                      {step.details.length > 0 && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                          {step.details.join(' · ')}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500">
                        {stepTime}
                      </span>
                      {!readOnlyActions && (
                        <button
                          type="button"
                          disabled={flushing}
                          onClick={() => handleDiscard(step.opIds)}
                          title="Annulla questa operazione"
                          aria-label="Annulla questa operazione"
                          className="p-0.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
