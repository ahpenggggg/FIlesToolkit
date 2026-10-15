export interface DupeSettings {
  threshold: number;
  photos: boolean;
  videos: boolean;
  /** null = not chosen yet (nothing is scanned), [] = all folders. */
  folderIds: string[] | null;
  includeSubfolders: boolean;
}

export const DEFAULT_DUPE_SETTINGS: DupeSettings = {
  threshold: 80,
  photos: true,
  videos: true,
  folderIds: null,
  includeSubfolders: true,
};
