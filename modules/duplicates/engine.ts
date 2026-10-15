import { NativeModule, requireNativeModule } from 'expo';
import type { MediaAsset } from '../media-library';

/** Native duplicate finder: fingerprints (256-bit DCT pHash + 8×8 colour, cached) and grouping. */

export interface DupMember extends MediaAsset {
  /** 0–100, vs the group's first member (the keeper). */
  similarity: number;
}

export interface DupGroup {
  id: string;
  /** members[0] is the best copy (kept by default). */
  members: DupMember[];
}

export interface ScanOptions {
  folderIds: string[];
  includeSubfolders: boolean;
  /** 0–1 */
  threshold: number;
  photos: boolean;
  videos: boolean;
}

export type ScanProgressEvent = { stage: string; done: number; total: number };

type Events = {
  onScanProgress(e: ScanProgressEvent): void;
};

declare class FTDuplicatesModule extends NativeModule<Events> {
  scanDuplicates(opts: ScanOptions): Promise<DupGroup[]>;
  /** Cancels the running scan (its promise rejects with E_CANCELLED). */
  cancel(): void;
}

export const Duplicates = requireNativeModule<FTDuplicatesModule>('FTDuplicates');
