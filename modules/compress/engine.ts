import { NativeModule, requireNativeModule } from 'expo';
import type { MediaAsset } from '../media-library';

/** Native video compressor: HEVC (H.264 fallback) re-encode, quality check and save. */

export interface VideoAsset extends MediaAsset {
  readable: boolean;
  fps: number;
  /** Video track bitrate, bps (0 = unknown). */
  videoBitrate: number;
  /** 0 / 90 / 180 / 270 */
  rotation: number;
  /** Pre-rotation (encoded) size. */
  codedWidth: number;
  codedHeight: number;
  probedDurationMs: number;
  /** iOS: only in iCloud, would need downloading first. */
  cloudOnly: boolean;
}

export interface ListVideosOptions {
  folderIds: string[];
  includeSubfolders: boolean;
  minSize: number;
}

export interface CompressOptions {
  id: string;
  /** Uniform scale factor (≤ 1). */
  scale: number;
  /** Target fps when dropFrames is true. */
  fps: number;
  dropFrames: boolean;
  /** Video bitrate, bps. */
  bitrate: number;
}

export type CompressResult =
  | {
      status: 'compressed';
      newId: string;
      newSize: number;
      /** Non-null = quality auto-check unsure: saved as "_compressed" copy, original must be kept. */
      review: string | null;
      match: number | null;
      codec: string;
      /** Folder the file was saved to (Android: "Download/Compressed"; iOS: null, saved to the Photos library). */
      savedTo: string | null;
      /** Name to give the new file once the original is trashed (Android). */
      finalName: string;
    }
  | { status: 'skipped' | 'failed'; reason: string };

export type CompressProgressEvent = { id: string; progress: number };

type Events = {
  onCompressProgress(e: CompressProgressEvent): void;
};

declare class FTCompressModule extends NativeModule<Events> {
  hevcSupported(): boolean;
  listVideos(opts: ListVideosOptions): Promise<VideoAsset[]>;
  compressVideo(opts: CompressOptions): Promise<CompressResult>;
  /** Cancels the running compression (its promise rejects with E_CANCELLED). */
  cancel(): void;
  finalizeNames(items: { id: string; name: string }[]): Promise<void>;
}

export const Compressor = requireNativeModule<FTCompressModule>('FTCompress');
