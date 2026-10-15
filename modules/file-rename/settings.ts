export interface FileRenameSettings {
  /** Only the same letter pattern is grouped. */
  strictMatch: boolean;
  /** Groups with fewer than SMALL_GROUP_SIZE files join Other files. */
  gatherSmallGroups: boolean;
}

export const DEFAULT_FILE_RENAME_SETTINGS: FileRenameSettings = {
  strictMatch: true,
  gatherSmallGroups: false,
};
