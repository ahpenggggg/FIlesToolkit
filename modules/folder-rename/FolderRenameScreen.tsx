import { useEffect, useMemo } from 'react';
import { Alert, Keyboard, StyleSheet, View } from 'react-native';
import { plural } from '@/lib/format';
import { usePersistentState } from '@/lib/settings';
import { ActionButton, Button, Card, FastList, Hero, Icon, Notice, Pill, ProgressCard, SectionLabel, StatRow, TextField, ToolScreen, Txt, mono, radius, usePalette, type Action } from '@/ui';
import { cleanNameInput, useFolderTool } from '../folder-access';
import { FolderRename } from './engine';
import { EXAMPLE_BASE, currentPrefix, isUnchanged, planFolderNames, willRename, withPrefix, type FolderScan, type PlannedFolder } from './naming';
import { DEFAULT_FOLDER_RENAME_SETTINGS, type FolderRenameSettings } from './settings';

export default function FolderRenameScreen() {
  const c = usePalette();
  const [settings, setSettings] = usePersistentState<FolderRenameSettings>('folders.settings', DEFAULT_FOLDER_RENAME_SETTINGS);
  const tool = useFolderTool<FolderScan>({
    storageKey: 'folders.folder',
    tool: 'folders',
    task: 'folders',
    noun: 'folder',
    plural: 'folders',
    chooseTitle: 'Choose a parent folder',
    caption: 'Each folder directly inside is renamed by the videos and photos it holds.',
    prompt: 'Choose the parent folder, such as Download / FFF. The folders directly inside it get renamed.',
    readStage: 'Scanning folders',
    read: async (uri) => {
      const result = await FolderRename.scanChildFolders(uri);
      return { rootName: result.rootName, otherNames: new Set(result.otherNames), entries: result.entries };
    },
  });
  const { track } = tool;

  useEffect(() => {
    const sub = FolderRename.addListener('onScanProgress', track);
    return () => sub.remove();
  }, [track]);

  const prefix = currentPrefix(settings.prefix);
  const scan = tool.data;
  const planned = useMemo(() => (scan ? planFolderNames(scan, prefix) : null), [scan, prefix]);
  const renameable = planned?.filter(willRename).length ?? 0;
  const conflicts = planned?.filter((e) => e.conflict != null).length ?? 0;

  const confirmRename = () => {
    if (!planned || tool.busy) return;
    Keyboard.dismiss();
    const count = renameable;
    if (count === 0) return;
    const format =
      prefix === ''
        ? `its video and photo count (e.g. ${EXAMPLE_BASE})`
        : `its video and photo count with the prefix ${prefix} (e.g. ${withPrefix(prefix, EXAMPLE_BASE)})`;
    Alert.alert(
      `Rename ${plural(count, 'folder')}?`,
      `Each child folder will be renamed to ${format}. Folders with duplicate target names or name conflicts will be skipped.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: () => tool.rename(planned.filter(willRename).map((e) => ({ uri: e.uri, name: e.name, target: e.target, stageSuffix: '' }))),
        },
      ],
    );
  };

  // ---------- render ----------

  let notice: { text: string; warn: boolean } | null = null;
  // The bottom button always offers the next step: Choose folder → Scan → Rename.
  let action: Action = { label: 'Choose folder', icon: 'folder-multiple-outline', onPress: tool.choose };
  if (tool.busy) {
    action = { label: 'Working…', disabled: true };
  } else if (!scan) {
    const idle = tool.chosen && !tool.attempted ? 'Tap Scan to read its child folders.' : 'Choose a parent folder to see its child folders here.';
    notice = { text: tool.message ?? idle, warn: false };
    if (tool.chosen) action = { label: 'Scan', icon: 'magnify-scan', onPress: tool.scan };
  } else {
    if (scan.entries.length === 0) {
      notice = { text: 'No child folders found here. Choose the folder that contains the targets you want to rename.', warn: false };
    } else if (tool.message) {
      notice = { text: tool.message, warn: false };
    } else if (conflicts > 0) {
      notice = { text: `${plural(conflicts, 'folder has', 'folders have')} a name conflict and will be left unchanged.`, warn: true };
    }
    action =
      renameable === 0
        ? { label: 'Nothing to rename', disabled: true }
        : { label: `Rename ${plural(renameable, 'folder')}`, icon: 'rename-box', onPress: confirmRename };
  }
  const showList = !tool.busy && planned != null;

  const header = (
    <View style={styles.header}>
      <Hero
        title="Rename folders by what's inside them."
        body="Pick a parent folder, preview the video and photo count of every child folder, then rename them in one go."
      />

      {tool.card}

      <Card>
        <SectionLabel right={<Pill label="Optional" />}>Name prefix</SectionLabel>
        <TextField
          value={settings.prefix}
          onChangeText={(t) => setSettings((s) => ({ ...s, prefix: cleanNameInput(t) }))}
          placeholder="e.g. JAMES"
          maxLength={40}
          monospace
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          disabled={tool.renaming}
        />
        <View style={styles.exampleRow}>
          <Txt v="small" color={c.muted}>
            Result
          </Txt>
          <View style={[styles.exampleChip, { backgroundColor: c.accentSoft }]}>
            <Txt v="mono" color={c.accent} style={{ fontSize: 13 }}>
              {withPrefix(prefix, EXAMPLE_BASE)}
            </Txt>
          </View>
        </View>
        <Txt v="caption" color={c.muted}>
          Default format is videosVphotosP. A prefix is joined with an underscore.
        </Txt>
      </Card>

      <StatRow
        items={[
          { label: 'Folders', value: showList ? String(planned!.length) : '–' },
          { label: 'To rename', value: showList ? String(renameable) : '–', tone: 'accent' },
          { label: 'Skipped', value: showList ? String(conflicts) : '–', tone: 'warn' },
        ]}
      />

      <SectionLabel
        style={{ marginTop: 10 }}
        right={scan && !tool.busy && !tool.blocked ? <Button label="Rescan" icon="refresh" variant="ghost" size="sm" onPress={tool.scan} /> : null}
      >
        Preview
      </SectionLabel>
      {notice ? <Notice message={notice.text} tone={notice.warn ? 'warn' : 'neutral'} /> : null}
      {tool.busy ? <ProgressCard progress={tool.progress} /> : null}
    </View>
  );

  return (
    <ToolScreen tool="folders" scroll={false} action={<ActionButton action={action} />}>
      <FastList
        data={showList ? planned! : EMPTY}
        keyExtractor={(e) => e.uri}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={Gap}
        keyboardShouldPersistTaps="handled"
        backToTop
        labelFor={(e) => e.name}
        renderItem={({ item }) => <EntryRow entry={item} />}
      />
    </ToolScreen>
  );
}

const EMPTY: PlannedFolder[] = [];
const Gap = () => <View style={{ height: 12 }} />;

function EntryRow({ entry }: { entry: PlannedFolder }) {
  const c = usePalette();
  const unchanged = isUnchanged(entry);
  const conflict = entry.conflict != null;
  const targetColor = conflict ? c.warn : unchanged ? c.muted : c.accent;
  return (
    <Card tone={conflict ? 'warn' : undefined} style={{ gap: 10, padding: 14 }}>
      <View style={styles.entryTop}>
        <Icon name="folder" size={20} color={unchanged ? c.faint : c.muted} />
        <Txt v="bodyStrong" color={unchanged ? c.muted : c.ink} numberOfLines={2} style={{ flex: 1 }}>
          {entry.name}
        </Txt>
        {conflict ? <Pill label="Skip" tone="warn" /> : unchanged ? <Pill label="Done" /> : <Pill label="Ready" tone="accent" />}
      </View>
      <View style={styles.targetRow}>
        <Icon name="arrow-right" size={16} color={c.faint} />
        <View style={[styles.targetChip, { backgroundColor: c.sunken, borderColor: c.line }]}>
          <Txt v="mono" color={targetColor} numberOfLines={1} ellipsizeMode="middle" style={{ fontFamily: mono }}>
            {entry.target}
          </Txt>
        </View>
      </View>
      <View style={styles.mediaRow}>
        <Icon name="video-outline" size={15} color={c.muted} />
        <Txt v="caption" color={c.muted}>
          {plural(entry.videos, 'video')}
        </Txt>
        <View style={{ width: 8 }} />
        <Icon name="image-outline" size={15} color={c.muted} />
        <Txt v="caption" color={c.muted}>
          {plural(entry.photos, 'photo')}
        </Txt>
      </View>
      {conflict ? (
        <Txt v="caption" color={c.warn}>
          {entry.conflict}
        </Txt>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { gap: 12, paddingBottom: 12 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exampleChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm - 2 },
  entryTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetChip: { flexShrink: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
