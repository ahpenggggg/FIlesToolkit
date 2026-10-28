import { javaTrim } from '../folder-access/names.ts';
import { assignTargets, extensionOf, group, naturalCompare, stemOf, suggestionFor, takePatternless } from './grouping.ts';

/** With "Gather small groups" on, groups smaller than this go to Other files. */
export const SMALL_GROUP_SIZE = 5;
/** Rows shown per open group before "Show all". */
export const COLLAPSED_FILE_ROWS = 6;

export interface FileItem {
  uri: string;
  name: string;
  stem: string;
}

export interface FileScan {
  rootName: string;
  /** Lower-cased names of everything in the folder, subfolders and hidden files included. */
  allNames: Set<string>;
  /** Files directly in the folder, hidden ones left out, in natural order. */
  files: FileItem[];
}

export interface FileGroup {
  /** Indexes into FileScan.files. */
  files: number[];
  suggestion: string;
  /** The name as typed. */
  name: string;
  /** The Other files group: names with no shared pattern. */
  other: boolean;
  /** Shows every file, not just the first COLLAPSED_FILE_ROWS. */
  expanded: boolean;
  /** Closed by tapping its header: only the header (and its name field) shows. */
  collapsed: boolean;
}

export function buildScan(rootName: string, children: { uri: string; name: string; isDirectory: boolean }[]): FileScan {
  const allNames = new Set<string>();
  const files: FileItem[] = [];
  for (const child of children) {
    allNames.add(child.name.toLowerCase());
    if (child.isDirectory || child.name.startsWith('.')) continue;
    files.push({ uri: child.uri, name: child.name, stem: '' });
  }
  files.sort((a, b) => naturalCompare(a.name, b.name));
  for (const file of files) file.stem = stemOf(file.name);
  return { rootName, allNames, files };
}

/**
 * Rebuilds the groups for the current match mode. A typed name carries over to a new group
 * when one of its files came from a named group with the same suggestion, so merging keeps
 * the name while groups split off by strict matching (ownxlee out of own) start unnamed.
 */
export function regroup(scan: FileScan, previousGroups: FileGroup[], strictMatch: boolean, gatherSmallGroups: boolean): FileGroup[] {
  const previous = new Map<number, FileGroup>();
  for (const g of previousGroups) for (const file of g.files) previous.set(file, g);

  const stems = scan.files.map((f) => f.stem);
  const patterns = group(stems, strictMatch);
  const others = takePatternless(patterns, stems, gatherSmallGroups ? SMALL_GROUP_SIZE : 2);
  if (others.length > 0) patterns.push(others);

  const groups = patterns.map((indexes): FileGroup => {
    const other = indexes === others;
    const suggestion = other ? '' : suggestionFor(indexes.map((i) => scan.files[i].name));
    let name = '';
    for (const file of indexes) {
      const old = previous.get(file);
      if (old && old.name !== '' && old.suggestion.toLowerCase() === suggestion.toLowerCase()) {
        name = old.name;
        break;
      }
    }
    return { files: indexes, suggestion, name, other, expanded: false, collapsed: false };
  });

  // Biggest groups first; the files with no pattern go last.
  return groups.sort((a, b) => {
    if (a.other !== b.other) return a.other ? 1 : -1;
    if ((a.suggestion === '') !== (b.suggestion === '')) return a.suggestion === '' ? 1 : -1;
    if (a.files.length !== b.files.length) return b.files.length - a.files.length;
    return naturalCompare(a.suggestion, b.suggestion);
  });
}

export function cleanGroupName(name: string): string {
  // Trailing dots and spaces are dropped by many file systems, so leave them off.
  return javaTrim(name).replace(/[. \t\n\x0B\f\r]+$/, '');
}

export interface PlannedRename {
  file: FileItem;
  target: string;
}

export interface FileTargets {
  /** New name per file uri; null = left as it is (unnamed group or left out). */
  targets: Map<string, string | null>;
  /** Files whose name changes, in the order shown. */
  pending: PlannedRename[];
}

/** Recomputes every file's new name, since groups that share a name are numbered together. */
export function computeTargets(scan: FileScan, groups: FileGroup[], excluded: Set<string>): FileTargets {
  const ordered: FileItem[] = [];
  const bases: (string | null)[] = [];
  const movingNames = new Set<string>();
  for (const g of groups) {
    const base = cleanGroupName(g.name);
    for (const index of g.files) {
      const file = scan.files[index];
      ordered.push(file);
      const included = base !== '' && !excluded.has(file.uri);
      bases.push(included ? base : null);
      if (included) movingNames.add(file.name.toLowerCase());
    }
  }
  const occupied = new Set([...scan.allNames].filter((n) => !movingNames.has(n)));
  const result = assignTargets(
    bases,
    ordered.map((f) => f.name),
    occupied,
  );

  const targets = new Map<string, string | null>();
  const pending: PlannedRename[] = [];
  ordered.forEach((file, i) => {
    const target = result[i];
    targets.set(file.uri, target);
    if (target != null && target !== file.name) pending.push({ file, target });
  });
  return { targets, pending };
}

/** Files keep their extension while staged so providers do not change their type. */
export const stageSuffixOf = extensionOf;

/** One row of the virtualized group list: a group's header, one of its files, or its footer. */
export type GroupRow =
  | { type: 'head'; key: string; groupIndex: number; matching: number; total: number; collapsed: boolean }
  | { type: 'file'; key: string; groupIndex: number; fileIndex: number; first: boolean }
  | { type: 'foot'; key: string; groupIndex: number; hidden: number; total: number; expanded: boolean };

/** A group's identity across regrouping and edits: its first file. */
export function groupKey(scan: FileScan, group: FileGroup): string {
  return `${group.other ? 'other' : 'group'}:${scan.files[group.files[0]].uri}`;
}

/**
 * Flattens groups into list rows so only what's on screen is drawn. A search keeps only the files
 * whose name contains it (ignoring case), drops groups without any, and shows every match, closed
 * groups too; otherwise a closed group shows no files and an open one its first COLLAPSED_FILE_ROWS.
 */
export function groupRows(scan: FileScan, groups: FileGroup[], query: string): { rows: GroupRow[]; matches: number } {
  const q = query.trim().toLowerCase();
  const rows: GroupRow[] = [];
  let matches = 0;
  groups.forEach((group, groupIndex) => {
    const files = q ? group.files.filter((i) => scan.files[i].name.toLowerCase().includes(q)) : group.files;
    if (files.length === 0) return;
    matches += files.length;
    const collapsed = !q && group.collapsed;
    const shown = collapsed ? [] : q || group.expanded ? files : files.slice(0, COLLAPSED_FILE_ROWS);
    const key = groupKey(scan, group);
    rows.push({ type: 'head', key: `h:${key}`, groupIndex, matching: files.length, total: group.files.length, collapsed });
    shown.forEach((fileIndex, i) => rows.push({ type: 'file', key: `f:${scan.files[fileIndex].uri}`, groupIndex, fileIndex, first: i === 0 }));
    rows.push({
      type: 'foot',
      key: `t:${key}`,
      groupIndex,
      // A closed group's files are behind its header, not a "Show all" link.
      hidden: collapsed ? 0 : files.length - shown.length,
      total: group.files.length,
      expanded: !collapsed && !q && group.expanded && group.files.length > COLLAPSED_FILE_ROWS,
    });
  });
  return { rows, matches };
}
