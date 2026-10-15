import { type ReactNode } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Txt } from './components';
import { usePalette, type IconName } from './theme';

/**
 * Full-screen sheet used everywhere a choice is made (folders, permissions), so they all look and
 * behave the same: title and a close button on top, optional tools, the content, a confirm button below.
 */
export function Sheet({
  visible,
  title,
  onClose,
  closeLabel = 'Cancel',
  tools,
  children,
  confirm,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** null hides the top close button (when the confirm button already closes). */
  closeLabel?: string | null;
  /** Row under the title, e.g. All / None and a count. */
  tools?: ReactNode;
  children: ReactNode;
  confirm: { label: string; icon?: IconName; disabled?: boolean; onPress: () => void };
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={[styles.root, { backgroundColor: c.bg, paddingTop: Platform.OS === 'android' ? insets.top + 8 : 16 }]}>
        <View style={styles.header}>
          <Txt v="title" style={{ flex: 1 }}>
            {title}
          </Txt>
          {closeLabel ? <Button label={closeLabel} variant="ghost" size="sm" onPress={onClose} /> : null}
        </View>
        {tools}
        <View style={{ flex: 1 }}>{children}</View>
        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom, backgroundColor: c.surface, borderColor: c.line }]}>
          <Button label={confirm.label} icon={confirm.icon ?? 'check'} onPress={confirm.onPress} disabled={confirm.disabled} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
  footer: { padding: 16, paddingHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth },
});
