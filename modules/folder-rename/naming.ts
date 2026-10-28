import { javaTrim } from '../folder-access/names.ts';

/** What the default name format looks like: 1 video and 2 photos. */
export const EXAMPLE_BASE = '1V2P';

export interface FolderEntry {
  uri: string;
  name: string;
  videos: number;
  photos: number;
}

export interface FolderScan {
  rootName: string;
  /** Lower-cased names of the files beside the child folders. */
  otherNames: Set<string>;
  entries: FolderEntry[];
}

export interface PlannedFolder extends FolderEntry {
  target: string;
  /** Why the folder is skipped, or null. */
  conflict: string | null;
}

/** The prefix as used in names: "JAMES_" and "JAMES" both produce JAMES_1V2P. */
export function currentPrefix(raw: string): string {
  let prefix = javaTrim(raw);
  while (prefix.endsWith('_')) prefix = javaTrim(prefix.substring(0, prefix.length - 1));
  return prefix;
}

export function withPrefix(prefix: string, base: string): string {
  return prefix === '' ? base : `${prefix}_${base}`;
}

/** videosVphotosP with zero-count segments left out; a folder with no media is "0". */
export function formatTargetName(videos: number, photos: number): string {
  const name = (videos > 0 ? `${videos}V` : '') + (photos > 0 ? `${photos}P` : '');
  return name === '' ? '0' : name;
}

/** Target names and conflicts for every child folder. */
export function planFolderNames(scan: FolderScan, prefix: string): PlannedFolder[] {
  const planned: PlannedFolder[] = scan.entries.map((e) => ({
    ...e,
    target: withPrefix(prefix, formatTargetName(e.videos, e.photos)),
    conflict: null,
  }));
  const folderNames = new Map<string, PlannedFolder>();
  const targetCounts = new Map<string, number>();
  for (const entry of planned) {
    folderNames.set(entry.name.toLowerCase(), entry);
    const key = entry.target.toLowerCase();
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  for (const entry of planned) {
    if (targetCounts.get(entry.target.toLowerCase())! > 1) {
      entry.conflict = 'Another folder has the same media count';
    } else if (scan.otherNames.has(entry.target.toLowerCase())) {
      entry.conflict = 'A file already uses this name';
    }
  }
  for (const entry of planned) {
    const occupant = folderNames.get(entry.target.toLowerCase());
    if (occupant && occupant !== entry && (occupant.conflict != null || occupant.name === occupant.target)) {
      entry.conflict = 'Another folder will keep this name';
    }
  }
  return planned;
}

export function isUnchanged(entry: PlannedFolder): boolean {
  return entry.conflict == null && entry.name === entry.target;
}

export function willRename(entry: PlannedFolder): boolean {
  return entry.conflict == null && entry.name !== entry.target;
}
