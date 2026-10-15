import { Platform } from 'react-native';
import type { IconName } from '@/ui/theme';

/**
 * Every tool in the app. The home screen and the tool headers are built from this list.
 * To add a tool: create its folder under modules/, add a route file in src/app/ that
 * re-exports its screen, and add an entry here (the route must match the file name).
 */

export interface Tool {
  key: ToolKey;
  /** Expo Router path of the tool's screen. */
  route: `/${string}`;
  title: string;
  /** One line on the home screen. */
  summary: string;
  group: ToolGroup;
  icon: IconName;
  /** Identity colour per scheme. */
  tint: { light: string; dark: string };
  /** Where the tool exists; all platforms when left out. */
  platforms?: ('android' | 'ios')[];
}

export type ToolKey = 'duplicates' | 'compress' | 'folders' | 'files' | 'archives';

/** Home screen sections, in order. */
export const TOOL_GROUPS = ['Media cleanup', 'Organize', 'Archive'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const TOOLS: Tool[] = [
  {
    key: 'duplicates',
    route: '/duplicates',
    title: 'Duplicates',
    summary: 'Find look-alike photos and videos, keep the best copy',
    group: 'Media cleanup',
    icon: 'content-copy',
    tint: { light: '#C23A64', dark: '#FF8BAD' },
  },
  {
    key: 'compress',
    route: '/compress',
    title: 'Compress video',
    summary: 'Re-encode large videos to HEVC and free up space',
    group: 'Media cleanup',
    icon: 'movie-open-outline',
    tint: { light: '#6A47D1', dark: '#BBA6FF' },
  },
  {
    key: 'folders',
    route: '/folders',
    title: 'Folder names',
    summary: 'Rename folders by the videos and photos inside',
    group: 'Organize',
    icon: 'folder-edit-outline',
    tint: { light: '#1F67C2', dark: '#7DB8FF' },
  },
  {
    key: 'files',
    route: '/files',
    title: 'File names',
    summary: 'Group look-alike file names and number them',
    group: 'Organize',
    icon: 'file-document-edit-outline',
    tint: { light: '#0A7D73', dark: '#57D9CB' },
  },
  {
    key: 'archives',
    route: '/archives',
    title: 'Archives',
    summary: 'Create ZIPs (password, split parts) and extract ZIP, RAR and 7Z',
    group: 'Archive',
    icon: 'zip-box-outline',
    tint: { light: '#8A5A00', dark: '#F2C45C' },
    platforms: ['android'],
  },
];

/** The tools available on this device. */
export function availableTools(): Tool[] {
  return TOOLS.filter((t) => !t.platforms || t.platforms.includes(Platform.OS as 'android' | 'ios'));
}

export function toolOf(key: ToolKey): Tool {
  return TOOLS.find((t) => t.key === key)!;
}
