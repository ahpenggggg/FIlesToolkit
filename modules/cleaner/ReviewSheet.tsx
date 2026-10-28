import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { bytes } from '@/lib/format';
import { Button, Card, Divider, FastList, Icon, IconTile, Notice, SectionLabel, Sheet, Txt, usePalette } from '@/ui';
import { storagePathLabel } from '../folder-access';
import { Cleaner, type CleanItem, type FolderContents } from './engine';
import { displayName, kindInfo } from './model';

/**
 * An item over 50 MB, shown before it can be selected: what it is, where, and what it holds (a folder's
 * biggest files, or the file itself opened in another app).
 */
export function ReviewSheet({ item, onClose, onSelect }: { item: CleanItem; onClose: () => void; onSelect: () => void }) {
  const c = usePalette();
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item.isDirectory) return;
    let live = true;
    Cleaner!
      .contents(item.path)
      .then((r) => live && setContents(r))
      .catch((e) => live && setError(String((e as Error).message ?? e)));
    return () => {
      live = false;
    };
  }, [item]);

  const open = () => Cleaner!.open(item.path).catch((e) => setError(String((e as Error).message ?? e)));

  const kind = kindInfo(item.kind);
  const parent = item.path.slice(0, item.path.lastIndexOf('/'));
  const header = (
    <View style={styles.header}>
      <Card style={{ gap: 12 }}>
        <View style={styles.row}>
          <IconTile name={kind.icon} tint={c.warn} size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="heading" numberOfLines={2} ellipsizeMode="middle">
              {displayName(item)}
            </Txt>
            <Txt v="caption" color={c.muted} numberOfLines={2}>
              {storagePathLabel(parent)}
            </Txt>
          </View>
        </View>
        <Divider />
        <Txt v="bodyStrong">
          {bytes(item.size)}
          {item.isDirectory ? ` · ${item.files} ${item.files === 1 ? 'file' : 'files'}` : ''}
          {` · changed ${new Date(item.modified).toLocaleDateString()}`}
        </Txt>
        <Txt v="small" color={c.muted}>
          {`${kind.title}: ${kind.note}`}
        </Txt>
      </Card>
      <Notice tone="warn" message="Cleaning deletes this for good; it doesn't go to Trash. Make sure nothing in it is worth keeping." />
      {error ? <Notice tone="warn" message={error} /> : null}
      {item.isDirectory ? (
        <SectionLabel>{contents ? `Inside · biggest ${contents.items.length} of ${contents.total}` : 'Inside'}</SectionLabel>
      ) : (
        <Button label="Open file" icon="open-in-new" variant="secondary" onPress={open} />
      )}
      {item.isDirectory && !contents && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: 16 }} /> : null}
    </View>
  );

  return (
    <Sheet
      visible
      title="Check before cleaning"
      closeLabel="Keep"
      onClose={onClose}
      confirm={{ label: 'Select for cleaning', icon: 'checkbox-marked-outline', onPress: onSelect }}
    >
      <FastList
        data={contents?.items ?? []}
        keyExtractor={(f) => f.name}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ItemSeparatorComponent={Divider}
        labelFor={(f) => f.name.slice(f.name.lastIndexOf('/') + 1)}
        renderItem={({ item: f }) => (
          <View style={styles.entry}>
            <Icon name="file-outline" size={18} color={c.muted} />
            <Txt v="small" numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>
              {f.name}
            </Txt>
            <Txt v="caption" color={c.muted}>
              {bytes(f.size)}
            </Txt>
          </View>
        )}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 12, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
});
