import type { CleanKind } from './engine';

export interface CleanerSettings {
  /** What to look for. */
  kinds: CleanKind[];
}

export const DEFAULT_CLEANER_SETTINGS: CleanerSettings = {
  kinds: ['orphanApp', 'expiredTrash', 'expiredPending', 'temp', 'emptyFile', 'emptyFolder'],
};
