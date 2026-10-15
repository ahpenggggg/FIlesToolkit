import type { IconName } from '@/ui';

/** One folder as the picker shows it. */
export interface FolderNode {
  /** Path-like key: a folder's subfolders have ids that start with `${id}/`. */
  id: string;
  name: string;
  /** Second line, e.g. "56 photos". */
  caption?: string;
  hasChildren: boolean;
  /** A file rather than a folder (sources that list files). */
  isFile?: boolean;
  /** Why it can't be chosen (it can still be opened), or null. */
  blocked?: string | null;
  icon?: IconName;
}

/**
 * Where a tool's folders come from. Implement this to give a new tool the shared folder picker;
 * see createMediaFolderSource (media-library) and createStorageFolderSource (folder-access).
 */
export interface FolderSource {
  /** First crumb of the path bar, e.g. "All folders". */
  rootLabel: string;
  /** Whether folders nest, which enables "Include subfolders" and opening folders. */
  nested: boolean;
  /** Folders at the top level. */
  roots(): Promise<FolderNode[]>;
  children(node: FolderNode): Promise<FolderNode[]>;
  /** The folders from the top level down to the one holding `id`, to open the picker where it is. */
  trailTo?(id: string): Promise<FolderNode[]>;
  /** One line about a selection, e.g. "61 items". */
  describe(ids: string[], includeSubfolders: boolean): string;
  /** Whether a selection covers every folder (then it is saved as "all folders"). */
  coversAll?(ids: string[], includeSubfolders: boolean): boolean;
}

/** True when `id` is inside the folder `ancestor`. */
export function isWithin(id: string, ancestor: string): boolean {
  return id.startsWith(`${ancestor}/`);
}
