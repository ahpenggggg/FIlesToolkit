import { Platform } from 'react-native';
import type { FolderNode, FolderSource } from '../folder-picker';
import { MediaLibrary, type Folder } from './native';

/** Which folders a scan covers. Empty ids = all. Mirrors the Kotlin FolderFilter. */
export function folderMatches(folderId: string, ids: string[], includeSubfolders: boolean): boolean {
  if (ids.length === 0) return true;
  if (ids.includes(folderId)) return true;
  return includeSubfolders && ids.some((p) => folderId.startsWith(`${p}/`));
}

/** ids: null = nothing chosen yet, [] = all folders. */
export function folderSummary(ids: string[] | null, folders: Folder[] | null, includeSubfolders: boolean): string {
  if (ids == null) return 'No folders chosen';
  if (ids.length === 0) return 'All folders';
  const byId = new Map((folders ?? []).map((f) => [f.id, f]));
  const names = ids.map((id) => byId.get(id)?.path ?? id.split('/').pop() ?? id).sort();
  const list = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  return includeSubfolders && Platform.OS === 'android' ? `${list} (incl. subfolders)` : list;
}

/**
 * The photo library as a folder source for the shared picker. Android: the real folder tree of
 * folders that hold photos or videos (and their parents). iOS: albums, which don't nest.
 * 'video' keeps only folders with videos somewhere inside.
 */
export function createMediaFolderSource(kind: 'any' | 'video'): FolderSource {
  let folders: Folder[] = [];
  const byParent = new Map<string, Folder[]>();
  let loaded: Promise<void> | null = null;

  const ensure = () =>
    (loaded ??= MediaLibrary.listFolders().then((all) => {
      folders = kind === 'video' ? all.filter((f) => f.totalVideos > 0) : all;
      const ids = new Set(folders.map((f) => f.id));
      for (const f of folders) {
        const cut = f.id.lastIndexOf('/');
        const parent = f.depth > 0 && cut > 0 && ids.has(f.id.slice(0, cut)) ? f.id.slice(0, cut) : '';
        byParent.set(parent, [...(byParent.get(parent) ?? []), f]);
      }
    }));

  const toNode = (f: Folder, top: boolean): FolderNode => {
    const inside = f.totalPhotos + f.totalVideos - f.photos - f.videos;
    return {
      id: f.id,
      name: top ? f.path : f.name,
      caption: counts(f.photos, f.videos) + (Platform.OS === 'android' && inside > 0 ? `  (+${inside} in subfolders)` : ''),
      hasChildren: (byParent.get(f.id)?.length ?? 0) > 0,
    };
  };

  return {
    rootLabel: Platform.OS === 'android' ? 'All folders' : 'Albums',
    nested: Platform.OS === 'android',
    roots: async () => {
      await ensure();
      return (byParent.get('') ?? []).map((f) => toNode(f, true));
    },
    children: async (node) => {
      await ensure();
      return (byParent.get(node.id) ?? []).map((f) => toNode(f, false));
    },
    describe: (ids, includeSubfolders) => {
      // An empty selection here is "nothing yet", not "all folders".
      const n = ids.length === 0 ? 0 : folders.filter((f) => folderMatches(f.id, ids, includeSubfolders)).reduce((sum, f) => sum + f.photos + f.videos, 0);
      return `${n} items`;
    },
    coversAll: (ids, includeSubfolders) => ids.length > 0 && folders.every((f) => folderMatches(f.id, ids, includeSubfolders)),
  };
}

function counts(p: number, v: number) {
  const parts = [p > 0 ? `${p} photo${p === 1 ? '' : 's'}` : null, v > 0 ? `${v} video${v === 1 ? '' : 's'}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No media directly';
}
