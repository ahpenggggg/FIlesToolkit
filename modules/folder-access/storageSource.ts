import { bytes } from '@/lib/format';
import type { FolderNode, FolderSource } from '../folder-picker';
import { FolderAccess, type StorageRoot } from './native';

const PRIMARY = /^\/storage\/emulated\/\d+$/;

interface Options {
  /** Also list files: all of them, or those whose name passes the test. Folders only by default. */
  files?: 'all' | ((name: string) => boolean);
  /**
   * Keep folders that must not be changed out of reach, as the system picker does: Download itself
   * and the Android folder. Whole volumes can never be chosen.
   */
  protect?: boolean;
}

/** Android storage as a source for the shared picker (needs All files access). */
export function createStorageFolderSource(options: Options = {}): FolderSource {
  let roots: StorageRoot[] | null = null;
  const loadRoots = async () => (roots ??= await FolderAccess.storageRoots());
  const rootOf = (path: string) => roots?.find((r) => path === r.path || path.startsWith(`${r.path}/`));
  const showFile = options.files === 'all' ? () => true : (options.files ?? null);

  const rootNode = (r: StorageRoot): FolderNode => ({
    id: r.path,
    name: r.name,
    hasChildren: true,
    blocked: 'Choose something inside',
    icon: PRIMARY.test(r.path) ? 'cellphone' : 'sd',
  });

  const folderNode = (path: string, name: string, hasChildren: boolean): FolderNode => ({
    id: path,
    name,
    hasChildren,
    blocked: options.protect ? protectedReason(path, rootOf(path)?.path ?? '') : null,
  });

  return {
    rootLabel: 'Storage',
    nested: true,
    roots: async () => (await loadRoots()).map(rootNode),
    children: async (node) => {
      if (!showFile) {
        return (await FolderAccess.listDirectories(node.id)).map((d) => folderNode(d.path, d.name, d.hasSubfolders));
      }
      return (await FolderAccess.listEntries(node.id))
        .filter((e) => e.isDirectory || showFile(e.name))
        .map((e) =>
          e.isDirectory
            ? folderNode(e.path, e.name, e.hasEntries)
            : { id: e.path, name: e.name, hasChildren: false, isFile: true, caption: bytes(e.size), icon: fileIcon(e.name) },
        );
    },
    trailTo: async (id) => {
      const root = (await loadRoots()).find((r) => id.startsWith(`${r.path}/`));
      if (!root) return [];
      const trail = [rootNode(root)];
      let path = root.path;
      for (const part of id.slice(root.path.length + 1).split('/').slice(0, -1)) {
        path = `${path}/${part}`;
        trail.push(folderNode(path, part, true));
      }
      return trail;
    },
    describe: (ids) => (ids.length === 0 ? 'Nothing chosen' : ids.length === 1 ? storagePathLabel(ids[0]) : `${ids.length} chosen`),
  };
}

/** A path as people know it: "Download / FFF", or "SD card / DCIM" on removable storage. */
export function storagePathLabel(path: string): string {
  const internal = path.match(/^\/storage\/emulated\/\d+\/(.+)$/);
  if (internal) return internal[1].split('/').join(' / ');
  if (PRIMARY.test(path)) return 'Internal storage';
  const external = path.match(/^\/storage\/[^/]+\/(.+)$/);
  if (external) return ['SD card', ...external[1].split('/')].join(' / ');
  return path;
}

function protectedReason(path: string, rootPath: string): string | null {
  const rel = path.slice(rootPath.length + 1);
  if (rel === 'Download') return 'Choose a folder inside';
  if (rel === 'Android' || rel.startsWith('Android/')) return "Can't be used: app data";
  return null;
}

function fileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz', 'z01'].includes(ext)) return 'zip-box-outline' as const;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext)) return 'file-image-outline' as const;
  if (['mp4', 'mov', 'mkv', 'avi', 'webm', '3gp'].includes(ext)) return 'file-video-outline' as const;
  if (['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac'].includes(ext)) return 'file-music-outline' as const;
  if (['pdf'].includes(ext)) return 'file-pdf-box' as const;
  return 'file-outline' as const;
}
