import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

export function toggleSort<K extends string>(
  current: SortState<K> | null,
  key: K,
  initialDir: SortDir = 'asc'
): SortState<K> {
  if (current && current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: initialDir };
}

export function parseItDateToIso(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

export function parseFirstPunNumber(raw?: string | null): number | null {
  if (!raw) return null;
  const m = /(\d+[.,]\d+)/.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function compareSortValues(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
  dir: SortDir
): number {
  const aMissing =
    a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a));
  const bMissing =
    b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b));

  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp = 0;
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a - b;
  } else if (typeof a === 'boolean' && typeof b === 'boolean') {
    cmp = Number(a) - Number(b);
  } else {
    cmp = String(a).localeCompare(String(b), 'it', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  return dir === 'asc' ? cmp : -cmp;
}

interface SortableThProps<K extends string> {
  sortKey: K;
  currentSort: SortState<K> | null;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
  className?: string;
  title?: string;
  children: React.ReactNode;
}

export function SortableTh<K extends string>({
  sortKey,
  currentSort,
  onSort,
  align = 'left',
  className = '',
  title,
  children,
}: SortableThProps<K>) {
  const isActive = currentSort?.key === sortKey;
  const dir = isActive ? currentSort.dir : null;

  return (
    <th
      title={title}
      aria-sort={
        isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group/sort inline-flex items-center gap-1 font-medium transition-colors hover:text-slate-900 dark:hover:text-slate-100 focus:outline-none ${
          align === 'right' ? 'justify-end w-full text-right' : 'justify-start text-left'
        } ${isActive ? 'text-sky-700 dark:text-sky-300' : ''}`}
      >
        <span>{children}</span>
        {dir === 'asc' ? (
          <ArrowUp className="w-3 h-3 shrink-0 text-sky-600 dark:text-sky-400" />
        ) : dir === 'desc' ? (
          <ArrowDown className="w-3 h-3 shrink-0 text-sky-600 dark:text-sky-400" />
        ) : (
          <ArrowUpDown className="w-3 h-3 shrink-0 opacity-35 group-hover/sort:opacity-80 transition-opacity" />
        )}
      </button>
    </th>
  );
}
