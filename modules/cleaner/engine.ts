import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Native cleaner (Android): finds leftover and stuck files on shared storage and deletes the ones chosen. */

/** Why an item can be cleaned. Keep in step with Kind in Rules.kt. */
export type CleanKind = 'orphanApp' | 'expiredTrash' | 'expiredPending' | 'temp' | 'emptyFile' | 'emptyFolder';

export interface CleanItem {
  path: string;
  name: string;
  kind: CleanKind;
  isDirectory: boolean;
  /** Bytes; for folders, everything inside. */
  size: number;
  /** Files inside (folders), or 1. */
  files: number;
  /** Last modified, ms since 1970. */
  modified: number;
}

export interface FolderContents {
  /** Every file inside, at any depth. */
  total: number;
  /** The biggest ones (up to 300), with their path inside the folder. */
  items: { name: string; size: number }[];
}

export interface CleanResult {
  /** Paths that are gone. */
  cleaned: string[];
  /** Items that couldn't be deleted, or changed since the scan and were left alone. */
  failed: number;
  freed: number;
}

export type CleanerProgressEvent = { stage: string; done: number; total: number };

type Events = {
  onCleanerProgress(e: CleanerProgressEvent): void;
};

declare class FTCleanerModule extends NativeModule<Events> {
  scan(kinds: CleanKind[]): Promise<CleanItem[]>;
  contents(path: string): Promise<FolderContents>;
  /** Opens a file in another app (with a chooser). */
  open(path: string): Promise<void>;
  /** Each item is checked again before it's deleted, for good. */
  clean(items: { path: string; kind: CleanKind }[]): Promise<CleanResult>;
  /** Stops scan or clean (its promise rejects with E_CANCELLED). */
  cancel(): void;
}

/** null where the tool isn't available (iOS). */
export const Cleaner = requireOptionalNativeModule<FTCleanerModule>('FTCleaner');
