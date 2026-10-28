import { NativeModule, requireNativeModule } from 'expo';

/**
 * Shared photo/video library access (Kotlin on Android, Swift on iOS), used by Duplicates.
 * Android: real directories via MediaStore. iOS: albums via PhotoKit.
 */

export type MediaKind = 'photo' | 'video';

/** Android: a real directory (id = absolute path). iOS: an album (id = localIdentifier, depth always 0). */
export interface Folder {
  id: string;
  name: string;
  /** Display path, e.g. "Download/Saved/Saved" (Android) or album name (iOS). */
  path: string;
  depth: number;
  photos: number;
  videos: number;
  totalPhotos: number;
  totalVideos: number;
}

export interface MediaAsset {
  /** Android "i:123" / "v:123"; iOS PHAsset localIdentifier. */
  id: string;
  /** content:// (Android) or ph:// (iOS) — both render in expo-image. */
  uri: string;
  kind: MediaKind;
  name: string;
  size: number;
  width: number;
  height: number;
  durationMs: number;
  dateTaken: number;
  folder: string;
}

declare class FTMediaLibraryModule extends NativeModule {
  /** iOS only (Android permissions are requested in TS). */
  requestPermission(): Promise<'granted' | 'limited' | 'denied'>;
  listFolders(): Promise<Folder[]>;
  /** Moves to Trash (Android) / Recently Deleted (iOS) after the system confirmation. Resolves true if confirmed. */
  trash(ids: string[]): Promise<boolean>;
}

export const MediaLibrary = requireNativeModule<FTMediaLibraryModule>('FTMediaLibrary');
