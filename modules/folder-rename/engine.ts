import { NativeModule, requireNativeModule } from 'expo';
import type { FolderEntry } from './naming';

/** Native media counter: photos and videos inside each child folder, counted recursively. */

export interface ChildFolderScan {
  rootName: string;
  /** Lower-cased names of the files beside the child folders. */
  otherNames: string[];
  /** Sorted by name, ignoring case. */
  entries: FolderEntry[];
}

export type FolderScanProgressEvent = { stage: string; done: number; total: number };

type Events = {
  onScanProgress(e: FolderScanProgressEvent): void;
};

declare class FTFolderRenameModule extends NativeModule<Events> {
  scanChildFolders(treeUri: string): Promise<ChildFolderScan>;
}

export const FolderRename = requireNativeModule<FTFolderRenameModule>('FTFolderRename');
