import { NativeModule, requireNativeModule } from 'expo';
import { Alert, Platform } from 'react-native';

/**
 * Shared folder access (Kotlin on Android, Swift on iOS), used by Folder names and File names.
 * Android: direct file access with "All files access"; folders are chosen in the shared picker (storageSource)
 * and identified by absolute path.
 * iOS: a folder picked in Files, kept as a bookmark ("bookmark:<base64>").
 */

export interface PickedFolder {
  uri: string;
  /** False when access could not be kept for later launches. */
  persisted: boolean;
}

export interface StorageRoot {
  path: string;
  name: string;
}

export interface DirectoryNode {
  path: string;
  name: string;
  hasSubfolders: boolean;
}

export interface StorageEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  /** Bytes; 0 for folders. */
  size: number;
  /** Folders: whether anything visible is inside. */
  hasEntries: boolean;
}

export interface FolderChild {
  uri: string;
  name: string;
  isDirectory: boolean;
}

export interface FolderListing {
  rootName: string;
  children: FolderChild[];
}

export interface RenameRequest {
  uri: string;
  /** Current name. */
  name: string;
  target: string;
  /** Kept on the temporary name, e.g. a file's extension. */
  stageSuffix: string;
}

export interface RenameOptions {
  treeUri: string;
  /** Echoed in progress events. */
  task: string;
  noun: string;
  plural: string;
  items: RenameRequest[];
}

export type RenameProgressEvent = { task: string; stage: string; done: number; total: number };

type Events = {
  onRenameProgress(e: RenameProgressEvent): void;
};

declare class FTFolderAccessModule extends NativeModule<Events> {
  /** Android: whether "All files access" is on. */
  hasAllFilesAccess(): boolean;
  /** Android: opens the app's "All files access" page in Settings. */
  requestAllFilesAccess(): void;
  /** Android: internal storage and removable volumes. */
  storageRoots(): Promise<StorageRoot[]>;
  /** Android: visible subfolders of a folder. */
  listDirectories(path: string): Promise<DirectoryNode[]>;
  /** Android: visible files and subfolders of a folder (folders first). */
  listEntries(path: string): Promise<StorageEntry[]>;
  /** iOS: the Files folder picker; resolves null when dismissed. */
  pickFolder(): Promise<PickedFolder | null>;
  listFolder(treeUri: string): Promise<FolderListing>;
  /** Two-phase rename (temporary names first). Resolves with the message to show. */
  renameDocuments(opts: RenameOptions): Promise<string>;
}

export const FolderAccess = requireNativeModule<FTFolderAccessModule>('FTFolderAccess');

export const READ_FAILED = 'Could not read this folder. Check its access and try choosing it again.';

/** Android: whether the rename tools can read and rename folders. iOS uses per-folder access instead. */
export function hasAllFilesAccess(): boolean {
  if (Platform.OS !== 'android') return true;
  try {
    return FolderAccess.hasAllFilesAccess();
  } catch {
    return false;
  }
}

/** Returns true when access is on; otherwise explains and offers to open Settings. */
export function ensureAllFilesAccess(): boolean {
  if (hasAllFilesAccess()) return true;
  Alert.alert(
    'Allow all files access',
    'FileToolkit needs "All files access" to list folders and rename them. Turn it on in Settings, then come back.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => FolderAccess.requestAllFilesAccess() },
    ],
  );
  return false;
}
