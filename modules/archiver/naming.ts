import { baseName, parentOf } from '../folder-access/paths.ts';

/**
 * Files the Extract picker offers: archives, but of a split set only the first part
 * (name.part1.rar; name.zip.001 / name.rar.001 / name.7z.001 as cut by 7-Zip and other splitters).
 */
export function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  const part = lower.match(/\.part(\d+)\.rar$/);
  if (part) return Number(part[1]) === 1;
  const volume = lower.match(/\.(\d+)$/);
  if (volume) return Number(volume[1]) === 1;
  return /\.(zip|rar|7z|tar|tgz|tar\.gz|tar\.xz|tar\.bz2)$/.test(lower);
}

/** The archive's name without its archive extension(s): "Photos.part1.rar" and "Photos.zip.001" give "Photos". */
export function archiveBaseName(name: string): string {
  const stripped = name.replace(/\.\d+$/, '').replace(/(\.part\d+)?\.(zip|rar|7z|tgz|tar\.gz|tar\.xz|tar\.bz2|tar)$/i, '');
  return stripped === '' ? name : stripped;
}

/** A starting name for a new ZIP: the item's name for one item, else the folder they share. */
export function defaultZipName(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) {
    const name = baseName(items[0]);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }
  return baseName(parentOf(items[0])) || 'Archive';
}

export const SPLIT_PRESETS = [
  { key: '25', label: '25 MB', mb: 25 },
  { key: '100', label: '100 MB', mb: 100 },
  { key: '500', label: '500 MB', mb: 500 },
  { key: '1024', label: '1 GB', mb: 1024 },
  { key: 'custom', label: 'Custom', mb: 0 },
] as const;
export type SplitPreset = (typeof SPLIT_PRESETS)[number]['key'];

/** Bytes per part, or null when a custom size isn't a usable number (at least 1 MB). */
export function splitBytes(preset: SplitPreset, customMb: string): number | null {
  const mb = preset === 'custom' ? Number(customMb.replace(',', '.')) : SPLIT_PRESETS.find((p) => p.key === preset)!.mb;
  if (!Number.isFinite(mb) || mb < 1) return null;
  return Math.round(mb * 1024 * 1024);
}
