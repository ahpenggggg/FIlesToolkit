import { Platform, useColorScheme, type TextStyle } from 'react-native';
import { toolOf, type ToolKey } from '@/tools';

/** FileToolkit brand: ink #0F2236, accent #F25C24 (the lit tile), light #EEF1F4. */
export const BRAND = { ink: '#0F2236', accent: '#F25C24', light: '#EEF1F4' } as const;

export interface Palette {
  /** Screen background (matches the logo artwork's background). */
  bg: string;
  /** Cards, bars and sheets. */
  surface: string;
  /** Inputs, tracks and quiet buttons. */
  sunken: string;
  line: string;
  ink: string;
  muted: string;
  faint: string;
  /** Main action buttons. */
  primary: string;
  onPrimary: string;
  /** Orange for text, links and selected icons (darkened in light mode for contrast). */
  accent: string;
  /** Brand orange for fills: progress, switches, checkboxes, the selected tab. */
  lit: string;
  onLit: string;
  accentSoft: string;
  danger: string;
  onDanger: string;
  dangerSoft: string;
  good: string;
  goodSoft: string;
  warn: string;
  warnSoft: string;
}

const light: Palette = {
  bg: BRAND.light,
  surface: '#FFFFFF',
  sunken: '#E5EAEF',
  line: '#D8DFE6',
  ink: BRAND.ink,
  muted: '#4E5D6E',
  faint: '#8795A4',
  primary: BRAND.ink,
  onPrimary: '#FFFFFF',
  accent: '#B83D15',
  lit: BRAND.accent,
  onLit: '#FFFFFF',
  accentSoft: '#FCE6DC',
  danger: '#C8352B',
  onDanger: '#FFFFFF',
  dangerSoft: '#FBE7E5',
  good: '#167A55',
  goodSoft: '#DDF1E8',
  warn: '#9C5300',
  warnSoft: '#FCEDD8',
};

const dark: Palette = {
  bg: BRAND.ink,
  surface: '#162C44',
  sunken: '#1D3550',
  line: '#29425E',
  ink: BRAND.light,
  muted: '#A7B4C2',
  faint: '#7F92A6',
  primary: BRAND.accent,
  onPrimary: BRAND.ink,
  accent: '#FF8A5C',
  lit: BRAND.accent,
  onLit: BRAND.ink,
  accentSoft: '#3A2C33',
  danger: '#FF8B7F',
  onDanger: '#2B0A06',
  dangerSoft: '#3E2430',
  good: '#5ED6A3',
  goodSoft: '#173A3A',
  warn: '#FFB766',
  warnSoft: '#3B3127',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useToolTint(key: ToolKey): string {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return toolOf(key).tint[scheme];
}

/** `color` at the given opacity (0–1); colours are #RRGGBB. */
export function alpha(color: string, opacity: number): string {
  return color + Math.round(opacity * 255).toString(16).padStart(2, '0');
}

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  stat: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  mono: { fontSize: 14, lineHeight: 19, fontWeight: '700', fontFamily: mono },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

/** Names from MaterialCommunityIcons. */
export type IconName = import('react').ComponentProps<typeof import('@expo/vector-icons').MaterialCommunityIcons>['name'];
