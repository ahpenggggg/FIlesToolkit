export interface CompressSettings {
  /** null = not chosen yet (nothing is scanned), [] = all folders. */
  folderIds: string[] | null;
  includeSubfolders: boolean;
  /** Trash each original once its compressed copy is saved and passed the quality check. */
  deleteOriginals: boolean;
}

export const DEFAULT_COMPRESS_SETTINGS: CompressSettings = {
  folderIds: null,
  includeSubfolders: true,
  deleteOriginals: true,
};
