import { type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Card, Icon, Notice, SectionLabel, Txt, usePalette, type IconName } from '@/ui';

/** The Folders card every tool shows: what is chosen, a Choose / Change link, and a hint. */
export function FolderScopeCard({
  label = 'Folders',
  icon = 'folder-multiple-outline',
  summary,
  chosen,
  caption,
  prompt,
  onPress,
  disabled,
  children,
}: {
  /** e.g. "All folders", "Download / FFF" or "No folders chosen". */
  summary: string;
  chosen: boolean;
  /** Under the summary once something is chosen. */
  caption: string;
  /** Asks for a choice while none is made. */
  prompt: string;
  onPress: () => void;
  disabled?: boolean;
  /** Extra notices, e.g. limited access. */
  children?: ReactNode;
  /** Card title, e.g. "Archive" or "Save to". */
  label?: string;
  icon?: IconName;
}) {
  const c = usePalette();
  return (
    <Card>
      <SectionLabel>{label}</SectionLabel>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={[styles.row, { opacity: disabled ? 0.5 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={`${chosen ? 'Change' : 'Choose'} ${label.toLowerCase()}`}
      >
        <Icon name={icon} size={22} color={chosen ? c.accent : c.faint} />
        <Txt v="bodyStrong" style={{ flex: 1 }} numberOfLines={2} color={chosen ? c.ink : c.muted}>
          {summary}
        </Txt>
        <Txt v="smallStrong" color={c.accent}>
          {chosen ? 'Change' : 'Choose'}
        </Txt>
        <Icon name="chevron-right" size={20} color={c.accent} />
      </Pressable>
      {chosen ? (
        <Txt v="caption" color={c.muted}>
          {caption}
        </Txt>
      ) : (
        <Notice tone="accent" message={prompt} />
      )}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
});
