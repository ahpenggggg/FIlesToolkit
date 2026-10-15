import type { SplitPreset } from './naming';

export interface ArchiverSettings {
  mode: 'create' | 'extract';
  /** store | fast | normal | max */
  level: 'store' | 'fast' | 'normal' | 'max';
  split: boolean;
  splitPreset: SplitPreset;
  customMb: string;
  /** Extract into a new folder named after the archive, or straight into the chosen folder. */
  extractInto: 'folder' | 'here';
  /** When a file already exists. */
  conflict: 'keep' | 'replace' | 'skip';
}

export const DEFAULT_ARCHIVER_SETTINGS: ArchiverSettings = {
  mode: 'create',
  level: 'normal',
  split: false,
  splitPreset: '100',
  customMb: '',
  extractInto: 'folder',
  conflict: 'keep',
};
