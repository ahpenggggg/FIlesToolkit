import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { bytes } from '@/lib/format';
import { useBlockingTool } from '@/lib/tasks';
import { toolOf, type ToolKey } from '@/tools';
import { alpha, mono, radius, type, usePalette, type IconName, type TypeVariant } from './theme';

// ---------- text & icons ----------

export function Txt({ v = 'body', color, style, ...rest }: TextProps & { v?: TypeVariant; color?: string }) {
  const c = usePalette();
  return <Text {...rest} style={[type[v], { color: color ?? c.ink }, style]} />;
}

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const c = usePalette();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? c.ink} />;
}

/** A rounded tile holding an icon, tinted with `tint`. */
export function IconTile({ name, tint, size = 40 }: { name: IconName; tint: string; size?: number }) {
  return (
    <View style={[styles.iconTile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: alpha(tint, 0.14) }]}>
      <Icon name={name} size={size * 0.55} color={tint} />
    </View>
  );
}

// ---------- layout ----------

export function ToolHeader({ tool, right }: { tool: ToolKey; right?: ReactNode }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: c.bg }]}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        accessibilityRole="button"
        accessibilityLabel="Back to all tools"
        hitSlop={8}
        style={({ pressed }) => [styles.back, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.6 : 1 }]}
      >
        <Icon name="chevron-left" size={24} />
      </Pressable>
      <Txt v="title" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
        {toolOf(tool).title}
      </Txt>
      {right}
    </View>
  );
}

/**
 * The frame of every tool: header, content and an optional action bar at the bottom.
 * Content scrolls by default; pass scroll={false} when it brings its own list.
 */
export function ToolScreen({
  tool,
  children,
  action,
  top,
  scroll = true,
}: {
  tool: ToolKey;
  children: ReactNode;
  action?: ReactNode;
  /** Stays put under the header while the content scrolls, e.g. a search field. */
  top?: ReactNode;
  scroll?: boolean;
}) {
  const c = usePalette();
  // One task at a time: while another tool's task runs, its notice takes the place of this tool's action.
  const blocking = useBlockingTool(tool);
  return (
    // The window doesn't resize for the keyboard (edge-to-edge), so lift the content above it.
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <ToolHeader tool={tool} />
      {top}
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {blocking ? (
        <ActionBar>
          <BusyElsewhere tool={blocking} />
        </ActionBar>
      ) : action ? (
        <ActionBar>{action}</ActionBar>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** Shown instead of a tool's action while another tool's task is running. */
function BusyElsewhere({ tool }: { tool: ToolKey }) {
  const c = usePalette();
  const other = toolOf(tool);
  return (
    <>
      <View style={styles.busyRow}>
        <ActivityIndicator size="small" color={c.accent} />
        <View style={{ flex: 1 }}>
          <Txt v="smallStrong">{`${other.title} is running`}</Txt>
          <Txt v="caption" color={c.muted}>
            One task at a time. This tool is ready once it finishes.
          </Txt>
        </View>
      </View>
      <Button label={`Open ${other.title}`} icon="arrow-right" variant="secondary" onPress={() => router.navigate(other.route)} />
    </>
  );
}

/** "Everything stays on this phone", one tap away behind a shield icon. */
export function DeviceChip() {
  return (
    <InfoTip
      icon="shield-lock-outline"
      size={24}
      label="On device"
      text="Everything runs on this phone. Nothing is uploaded, and no account is needed."
    />
  );
}

/** The tool's opening line; what it does is one tap away in the info tooltip beside it. */
export function Hero({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.hero}>
      <Txt v="title" style={{ flex: 1 }}>
        {title}
      </Txt>
      <View style={styles.heroInfo}>
        <InfoTip text={body} label="What this tool does" />
      </View>
    </View>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'warn' }) {
  const c = usePalette();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.surface, borderColor: tone === 'warn' ? alpha(c.warn, 0.5) : c.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionLabel({ children, right, style }: { children: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return (
    <View style={[styles.sectionLabel, style]}>
      <Txt v="label" color={c.muted} style={{ flex: 1 }}>
        {children}
      </Txt>
      {right}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }, style]} />;
}

/** Sticky bar at the bottom of a tool for its main action. */
export function ActionBar({ children }: { children: ReactNode }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.actionBar, { paddingBottom: 12 + insets.bottom, backgroundColor: c.surface, borderColor: c.line }]}>{children}</View>
  );
}

export function EmptyState({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.accentSoft }]}>
        <Icon name={icon} size={34} color={c.accent} />
      </View>
      <Txt v="title" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {body ? (
        <Txt v="body" color={c.muted} style={{ textAlign: 'center' }}>
          {body}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

// ---------- controls ----------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  size = 'lg',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: 'lg' | 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = usePalette();
  const off = disabled && !loading;
  const bg = off
    ? variant === 'ghost'
      ? 'transparent'
      : c.sunken
    : { primary: c.primary, danger: c.danger, secondary: c.sunken, ghost: 'transparent' }[variant];
  const fg = off ? c.faint : { primary: c.onPrimary, danger: c.onDanger, secondary: c.ink, ghost: c.accent }[variant];
  const height = { lg: 54, md: 46, sm: 36 }[size];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          height,
          paddingHorizontal: size === 'sm' ? 12 : 18,
          borderRadius: size === 'sm' ? radius.sm + 2 : radius.md + 2,
          backgroundColor: bg,
          borderColor: variant === 'secondary' && !off ? c.line : 'transparent',
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} color={fg} /> : null}
          <Text numberOfLines={1} style={[size === 'sm' ? type.smallStrong : type.bodyStrong, { color: fg, fontWeight: '700', flexShrink: 1 }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** A tool's next step, shown as its main button. No onPress (or disabled) = shown greyed out. */
export interface Action {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  loading?: boolean;
}

export function ActionButton({ action }: { action: Action }) {
  return (
    <Button
      label={action.label}
      icon={action.icon}
      variant={action.variant}
      loading={action.loading}
      onPress={action.onPress ?? (() => {})}
      disabled={action.disabled || !action.onPress}
    />
  );
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  disabled?: boolean;
}) {
  const c = usePalette();
  return (
    <View style={[styles.segmented, { backgroundColor: c.sunken, opacity: disabled ? 0.5 : 1 }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            disabled={disabled}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && [styles.segmentOn, { backgroundColor: c.surface, shadowColor: '#000' }]]}
          >
            <Txt v="smallStrong" color={on ? c.ink : c.muted} style={{ fontWeight: on ? '700' : '600' }}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({
  label,
  subtitle,
  icon,
  value,
  onChange,
  disabled,
}: {
  label: string;
  subtitle?: string;
  icon?: IconName;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable disabled={disabled} onPress={() => onChange(!value)} style={[styles.toggleRow, { opacity: disabled ? 0.5 : 1 }]}>
      {icon ? <Icon name={icon} size={22} color={value ? c.accent : c.faint} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="bodyStrong">{label}</Txt>
        {subtitle ? (
          <Txt v="caption" color={c.muted}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: c.lit, false: c.line }}
        thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
        ios_backgroundColor={c.line}
      />
    </Pressable>
  );
}

/** `mixed` = not chosen itself, but something inside it is. */
export function Checkbox({
  checked,
  mixed,
  disabled,
  tone = 'accent',
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  tone?: 'accent' | 'danger';
}) {
  const c = usePalette();
  const color = tone === 'danger' ? c.danger : c.lit;
  const filled = checked || mixed;
  return (
    <View
      style={[
        styles.checkbox,
        { borderColor: filled ? color : c.faint, backgroundColor: checked ? color : 'transparent', opacity: disabled ? 0.35 : 1 },
      ]}
    >
      {checked ? <Icon name="check-bold" size={14} color={tone === 'danger' ? c.onDanger : c.onLit} /> : null}
      {!checked && mixed ? <Icon name="minus-thick" size={14} color={color} /> : null}
    </View>
  );
}

export function TextField({ disabled, monospace, style, ...rest }: TextInputProps & { disabled?: boolean; monospace?: boolean }) {
  const c = usePalette();
  return (
    <TextInput
      {...rest}
      editable={!disabled}
      placeholderTextColor={c.faint}
      selectionColor={c.accent}
      cursorColor={c.accent}
      style={[
        styles.field,
        { backgroundColor: c.sunken, borderColor: c.line, color: c.ink, opacity: disabled ? 0.5 : 1 },
        monospace && { fontFamily: mono },
        style,
      ]}
    />
  );
}

/** A search box with a clear button; `note` sits at its end, e.g. "12 of 340". */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  note,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  note?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const c = usePalette();
  return (
    <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.line }, style]}>
      <Icon name="magnify" size={20} color={c.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.faint}
        selectionColor={c.accent}
        cursorColor={c.accent}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={[styles.searchInput, { color: c.ink }]}
      />
      {note ? (
        <Txt v="caption" color={c.muted}>
          {note}
        </Txt>
      ) : null}
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="close-circle" size={18} color={c.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}

export type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'good';

function toneColors(c: ReturnType<typeof usePalette>, tone: Tone) {
  switch (tone) {
    case 'accent':
      return { fg: c.accent, bg: c.accentSoft };
    case 'warn':
      return { fg: c.warn, bg: c.warnSoft };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSoft };
    case 'good':
      return { fg: c.good, bg: c.goodSoft };
    default:
      return { fg: c.muted, bg: c.sunken };
  }
}

export function Pill({ label, tone = 'neutral', icon, onPress }: { label: string; tone?: Tone; icon?: IconName; onPress?: () => void }) {
  const c = usePalette();
  const { fg, bg } = toneColors(c, tone);
  const body = (
    <>
      {icon ? <Icon name={icon} size={13} color={fg} /> : null}
      <Text numberOfLines={1} style={[type.label, { color: fg, letterSpacing: 0.8, flexShrink: 1 }]}>
        {label}
      </Text>
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.pill, { backgroundColor: bg, opacity: pressed ? 0.7 : 1, maxWidth: 190 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={[styles.pill, { backgroundColor: bg }]}>{body}</View>
  );
}

export function Notice({ message, tone = 'neutral' }: { message: string; tone?: 'neutral' | 'warn' | 'accent' }) {
  const c = usePalette();
  const { fg, bg } = toneColors(c, tone);
  const icon: IconName = tone === 'warn' ? 'alert-outline' : 'information-outline';
  return (
    <View style={[styles.notice, { backgroundColor: tone === 'neutral' ? c.surface : bg, borderColor: tone === 'neutral' ? c.line : 'transparent' }]}>
      <Icon name={icon} size={18} color={tone === 'neutral' ? c.muted : fg} />
      <Txt v="small" color={tone === 'neutral' ? c.muted : fg} style={{ flex: 1 }}>
        {message}
      </Txt>
    </View>
  );
}

// ---------- progress & numbers ----------

/** progress null = indeterminate. */
export function ProgressBar({ progress, color }: { progress: number | null; color?: string }) {
  const c = usePalette();
  return (
    <View style={[styles.track, { backgroundColor: c.sunken }]}>
      <View
        style={{
          width: progress == null ? '35%' : `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`,
          height: '100%',
          borderRadius: 3,
          backgroundColor: color ?? c.lit,
          opacity: progress == null ? 0.5 : 1,
        }}
      />
    </View>
  );
}

export interface Progress {
  stage: string;
  done: number;
  total: number;
  /** 'bytes' shows "12 MB of 40 MB" instead of "12/40". */
  unit?: 'bytes';
}

/** "Stage · 3/10" with a bar; total 0 shows "Stage…" and an indeterminate bar. */
export function ProgressCard({ progress, hint, onCancel }: { progress: Progress; hint?: string; onCancel?: () => void }) {
  const c = usePalette();
  const { stage, done, total, unit } = progress;
  const count = unit === 'bytes' ? `${bytes(done)} of ${bytes(total)}` : `${done}/${total}`;
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ActivityIndicator size="small" color={c.accent} />
        <Txt v="smallStrong" style={{ flex: 1 }}>
          {total === 0 ? (stage.endsWith('…') ? stage : `${stage}…`) : `${stage} · ${count}`}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <ProgressBar progress={total > 0 ? done / total : null} />
      </View>
      {hint ? (
        <Txt v="caption" color={c.muted}>
          {hint}
        </Txt>
      ) : null}
      {onCancel ? <Button label="Cancel" variant="secondary" size="md" onPress={onCancel} /> : null}
    </Card>
  );
}

export function StatRow({ items }: { items: { label: string; value: string; tone?: Tone }[] }) {
  const c = usePalette();
  return (
    <View style={styles.stats}>
      {items.map((s) => (
        <View key={s.label} style={[styles.stat, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Txt v="stat" numberOfLines={1} adjustsFontSizeToFit color={s.tone && s.tone !== 'neutral' ? toneColors(c, s.tone).fg : c.ink}>
            {s.value}
          </Txt>
          <Txt v="label" color={c.muted} style={{ fontSize: 9, letterSpacing: 0.9 }} numberOfLines={1}>
            {s.label}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  iconTile: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  scroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 4, paddingTop: 2, paddingBottom: 4 },
  heroInfo: { paddingTop: 2 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: { flex: 1, height: 36, borderRadius: radius.sm + 1, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 46,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  field: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 15 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', flex: 1 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md + 2, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
});

// ---------- tooltip ----------

interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An info icon that shows `text` in a tooltip bubble under it; tap anywhere to close. */
export function InfoTip({
  text,
  label = 'More info',
  size = 22,
  icon: name = 'information-outline',
}: {
  text: string;
  label?: string;
  size?: number;
  /** An outline icon; its filled version shows while the tip is open. */
  icon?: IconName;
}) {
  const c = usePalette();
  const icon = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => icon.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  const close = () => setAnchor(null);

  return (
    <>
      <Pressable
        ref={icon}
        onPress={open}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={text}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Icon name={anchor ? (name.replace(/-outline$/, '') as IconName) : name} size={size} color={anchor ? c.accent : c.muted} />
      </Pressable>
      <Modal transparent visible={anchor != null} animationType="fade" onRequestClose={close} statusBarTranslucent>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close">
          {anchor ? (
            <View style={[tipStyles.bubble, { top: anchor.y + anchor.h + 10, backgroundColor: c.ink }]}>
              {/* Points at the icon. */}
              <View style={[tipStyles.arrow, { left: anchor.x + anchor.w / 2 - BUBBLE_INSET - 7, backgroundColor: c.ink }]} />
              <Txt v="body" color={c.bg}>
                {text}
              </Txt>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const BUBBLE_INSET = 16;

const tipStyles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    left: BUBBLE_INSET,
    right: BUBBLE_INSET,
    padding: 16,
    borderRadius: radius.md + 2,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  arrow: { position: 'absolute', top: -6, width: 14, height: 14, transform: [{ rotate: '45deg' }] },
});
