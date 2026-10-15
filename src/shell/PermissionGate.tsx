import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { FolderAccess, hasAllFilesAccess } from '@modules/folder-access';
import { checkMediaAccess, ensureMediaAccess, type Access } from '@modules/media-library';
import { Button, Card, IconTile, Pill, Sheet, Txt, usePalette, type IconName } from '@/ui';

/**
 * Android: checks the app's permissions on launch and, if any is missing, explains what each one is
 * for with a button to grant it. Statuses refresh when the user comes back from Settings.
 */
export function PermissionGate() {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<Access | null>(null);
  const [files, setFiles] = useState<boolean | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    /** Reads both statuses; `onLaunch` opens the sheet when anything is missing. */
    const refresh = (onLaunch: boolean) =>
      checkMediaAccess().then((m) => {
        const f = hasAllFilesAccess();
        setMedia(m);
        setFiles(f);
        if (onLaunch && (m !== 'granted' || !f)) setOpen(true);
      });
    refresh(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh(false);
    });
    return () => sub.remove();
  }, []);

  if (Platform.OS !== 'android' || media == null || files == null) return null;

  const allowMedia = async () => {
    if (media === 'limited') {
      Linking.openSettings();
      return;
    }
    const result = await ensureMediaAccess();
    setMedia(result);
    if (result === 'denied') {
      Alert.alert('Permission needed', 'Photo and video access was refused. You can turn it on in Settings.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
    }
  };

  const allowed = media === 'granted' && files;
  return (
    <Sheet
      visible={open}
      title="Allow access"
      closeLabel={null}
      onClose={() => setOpen(false)}
      confirm={{ label: allowed ? 'Continue' : 'Not now', icon: allowed ? 'check' : 'clock-outline', onPress: () => setOpen(false) }}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <Txt v="body" color={c.muted}>
          FileToolkit works on files on this phone and never uploads them. Each tool needs one of these.
        </Txt>
        <PermissionRow
          icon="image-multiple-outline"
          title="Photos and videos"
          body="Used by Duplicates and Compress video to read your library and move items to Trash."
          status={media === 'granted' ? 'allowed' : media === 'limited' ? 'limited' : 'missing'}
          actionLabel={media === 'limited' ? 'Allow all' : 'Allow'}
          onAllow={allowMedia}
        />
        <PermissionRow
          icon="folder-key-outline"
          title="All files access"
          body="Used by Folder names, File names and Archives to browse your folders, rename what you choose, and zip or extract files."
          status={files ? 'allowed' : 'missing'}
          actionLabel="Open Settings"
          onAllow={() => FolderAccess.requestAllFilesAccess()}
        />
      </ScrollView>
    </Sheet>
  );
}

function PermissionRow({
  icon,
  title,
  body,
  status,
  actionLabel,
  onAllow,
}: {
  icon: IconName;
  title: string;
  body: string;
  status: 'allowed' | 'limited' | 'missing';
  actionLabel: string;
  onAllow: () => void;
}) {
  const c = usePalette();
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.row}>
        <IconTile name={icon} tint={c.lit} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="heading">{title}</Txt>
          <Txt v="small" color={c.muted}>
            {body}
          </Txt>
        </View>
      </View>
      {status === 'allowed' ? (
        <View style={styles.row}>
          <Pill label="Allowed" tone="good" icon="check" />
        </View>
      ) : (
        <View style={styles.row}>
          {status === 'limited' ? <Pill label="Limited" tone="warn" /> : <Pill label="Not allowed" tone="danger" />}
          <View style={{ flex: 1 }} />
          <Button label={actionLabel} size="sm" onPress={onAllow} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
