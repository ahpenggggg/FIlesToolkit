import type { IconName } from '@/ui';
import type { CleanItem, CleanKind } from './engine';

/** Items bigger than this are never selected for you: they are listed to be checked first. */
export const REVIEW_BYTES = 50 * 1024 * 1024;

export interface KindInfo {
  key: CleanKind;
  title: string;
  note: string;
  icon: IconName;
}

/** Every kind, in the order the results list them. */
export const KINDS: KindInfo[] = [
  {
    key: 'orphanApp',
    title: 'Leftovers of removed apps',
    note: 'Folders in Android/media of apps that are no longer installed.',
    icon: 'package-variant-remove',
  },
  {
    key: 'expiredTrash',
    title: 'Expired Trash',
    note: 'Files whose 30 days in Trash ran out but that the system never removed.',
    icon: 'delete-clock-outline',
  },
  {
    key: 'expiredPending',
    title: 'Unfinished saves',
    note: 'Files an app started saving but never finished, past their expiry.',
    icon: 'progress-alert',
  },
  {
    key: 'temp',
    title: 'Temporary files',
    note: '.tmp files and unfinished downloads (.crdownload, .part), untouched for a day.',
    icon: 'file-clock-outline',
  },
  {
    key: 'emptyFile',
    title: 'Empty files',
    note: 'Files with nothing in them (0 bytes), untouched for a day. Hidden ones such as .nomedia are kept.',
    icon: 'file-hidden',
  },
  {
    key: 'emptyFolder',
    title: 'Empty folders',
    note: 'Folders without a single file, even in their subfolders. Standard ones such as DCIM and Download are kept.',
    icon: 'folder-remove-outline',
  },
];

export function kindInfo(kind: CleanKind): KindInfo {
  return KINDS.find((k) => k.key === kind)!;
}

/** Too big to clean without checking what it is first. */
export function needsReview(item: CleanItem): boolean {
  return item.size > REVIEW_BYTES;
}

/** Everything up to 50 MB is selected; bigger items wait until they have been checked. */
export function defaultSelection(items: CleanItem[]): Set<string> {
  return new Set(items.filter((i) => !needsReview(i)).map((i) => i.path));
}

/** The name people know: MediaStore's ".trashed-1700000000-IMG_1.jpg" is IMG_1.jpg. */
export function displayName(item: CleanItem): string {
  return item.name.replace(/^\.(pending|trashed)-\d+-/, '');
}

/** One row of the results list: a section header or an item. */
export type ResultRow =
  | { type: 'head'; key: string; title: string; note: string; icon: IconName; count: number; size: number; section: string }
  | { type: 'item'; key: string; item: CleanItem; review: boolean; section: string };

const REVIEW_SECTION = 'review';

/**
 * Flattens the results for the list: first the items over 50 MB to check, biggest first, then each
 * kind's items, biggest first. An item is listed once, in the check section when it's that big.
 */
export function resultRows(items: CleanItem[]): ResultRow[] {
  const rows: ResultRow[] = [];
  const bySize = [...items].sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  const add = (section: string, title: string, note: string, icon: IconName, list: CleanItem[], review: boolean) => {
    if (list.length === 0) return;
    const size = list.reduce((n, i) => n + i.size, 0);
    rows.push({ type: 'head', key: `h:${section}`, title, note, icon, count: list.length, size, section });
    for (const item of list) rows.push({ type: 'item', key: `i:${item.path}`, item, review, section });
  };
  add(
    REVIEW_SECTION,
    'Check before cleaning',
    'Each is over 50 MB. Open it to see what it holds; it can only be selected after that.',
    'file-eye-outline',
    bySize.filter(needsReview),
    true,
  );
  for (const k of KINDS) {
    add(k.key, k.title, k.note, k.icon, bySize.filter((i) => i.kind === k.key && !needsReview(i)), false);
  }
  return rows;
}
