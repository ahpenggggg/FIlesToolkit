import { NativeModule, requireNativeModule } from 'expo';
import type { MediaAsset } from '../media-library';

/** Native video compressor (Android): x264 with HandBrake's settings, a quality check, and save. */

export interface VideoAsset extends MediaAsset {
  readable: boolean;
  fps: number;
  /** Video track bitrate, bps (0 = unknown). */
  videoBitrate: number;
  /** Video codec MIME type, when known. */
  videoCodec?: string | null;
  /** HDR (HLG or HDR10): not supported yet. */
  hdr?: boolean;
  /** 0 / 90 / 180 / 270 */
  rotation: number;
  /** Pre-rotation (encoded) size. */
  codedWidth: number;
  codedHeight: number;
  probedDurationMs: number;
  cloudOnly: boolean;
}

export interface ListVideosOptions {
  folderIds: string[];
  includeSubfolders: boolean;
  minSize: number;
}

export interface CompressOptions {
  id: string;
  /** Shown in the notification, e.g. "2 of 5". */
  label: string;
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
      width: number;
      height: number;
      /** Folder the file was saved to. */
      savedTo: string | null;
      /** Name to give the new file once the original is trashed. */
      finalName: string;
    }
  | { status: 'skipped' | 'failed'; reason: string };

export type CompressProgressEvent = { id: string; progress: number };

type Events = {
  onCompressProgress(e: CompressProgressEvent): void;
};

declare class FTCompressModule extends NativeModule<Events> {
  listVideos(opts: ListVideosOptions): Promise<VideoAsset[]>;
  compressVideo(opts: CompressOptions): Promise<CompressResult>;
  /** Cancels the running compression (its promise rejects with E_CANCELLED). */
  cancel(): void;
  /** Foreground service + notification for a batch, so it keeps running in the background. */
  beginSession(text: string): void;
  endSession(): void;
  /** A cached JPEG of the video's system thumbnail (file:// URI), or null. */
  thumbnail(id: string, size: number): Promise<string | null>;
  finalizeNames(items: { id: string; name: string }[]): Promise<void>;
}

export const Compressor = requireNativeModule<FTCompressModule>('FTCompress');
