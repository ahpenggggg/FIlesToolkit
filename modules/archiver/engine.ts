import { NativeModule, requireOptionalNativeModule } from 'expo';
import { hasErrorCode } from '@/lib/errors';

/** Native archiver (Android): ZIP via zip4j; RAR, 7Z and others via libarchive. */

export interface ArchiveItem {
  name: string;
  size: number;
  isDirectory: boolean;
}

export interface ArchiveInfo {
  /** e.g. "ZIP", "RAR5", "7Z". */
  format: string;
  parts: number;
  /** Some entries are encrypted. */
  encrypted: boolean;
  /** Even the names are encrypted: the password is needed to see anything. */
  needsPassword: boolean;
  fileCount: number;
  totalSize: number;
  /** Up to 500 entries, for a preview. */
  items: ArchiveItem[];
}

export interface CreateOptions {
  items: string[];
  folder: string;
  /** Without ".zip". */
  name: string;
  level: 'store' | 'fast' | 'normal' | 'max';
  /** Empty = none; otherwise AES-256. */
  password: string;
  /** Bytes per part; 0 = one file. */
  splitSize: number;
}

export interface CreateResult {
  path: string;
  name: string;
  parts: number;
  size: number;
}

export interface ExtractOptions {
  archive: string;
  /** Folder to extract into, or to make the new folder in. */
  destination: string;
  /** Non-empty: a new folder of this name inside destination ("name (1)" if taken). */
  newFolder: string;
  password: string;
  conflict: 'keep' | 'replace' | 'skip';
}

export interface ExtractResult {
  extracted: number;
  skipped: number;
  destination: string;
}

export type ArchiveProgressEvent = { stage: string; done: number; total: number };

type Events = {
  onArchiveProgress(e: ArchiveProgressEvent): void;
};

declare class FTArchiverModule extends NativeModule<Events> {
  inspect(path: string, password: string): Promise<ArchiveInfo>;
  create(opts: CreateOptions): Promise<CreateResult>;
  extract(opts: ExtractOptions): Promise<ExtractResult>;
  /** Stops create/extract (its promise rejects with E_CANCELLED). */
  cancel(): void;
}

/** null where the tool isn't available (iOS). */
export const Archiver = requireOptionalNativeModule<FTArchiverModule>('FTArchiver');

/** A wrong or missing password (the promise rejected with E_PASSWORD). */
export function isPasswordError(e: unknown): boolean {
  return hasErrorCode(e, 'E_PASSWORD');
}
