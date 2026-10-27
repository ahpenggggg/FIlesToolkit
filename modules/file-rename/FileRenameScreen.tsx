import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { usePersistentState } from '@/lib/settings';
import {
  ActionButton,
  Button,
  Card,
  Divider,
  FastList,
  Hero,
  Icon,
  Notice,
  Pill,
  ProgressCard,
  SearchField,
  SectionLabel,
  StatRow,
  TextField,
  ToggleRow,
  ToolScreen,
  Txt,
  radius,
  usePalette,
  type Action,
} from '@/ui';
import { FolderAccess, cleanNameInput, useFolderTool } from '../folder-access';
import {
  SMALL_GROUP_SIZE,
  buildScan,
  computeTargets,
  groupRows,
  regroup,
  stageSuffixOf,
  type FileGroup,
  type FileItem,
  type FileScan,
  type GroupRow,
} from './model';
import { DEFAULT_FILE_RENAME_SETTINGS, type FileRenameSettings } from './settings';

/** A read folder: its files, their groups, and the files left out by tapping them. */
interface FilesData {
  rootName: string;
  scan: FileScan;
  groups: FileGroup[];
  excluded: Set<string>;
}

export default function FileRenameScreen() {
  const [settings, setSettings] = usePersistentState<FileRenameSettings>('files.settings', DEFAULT_FILE_RENAME_SETTINGS);
  const tool = useFolderTool<FilesData>({
    storageKey: 'files.folder',
    tool: 'files',
    task: 'files',
    noun: 'file',
    plural: 'files',
    chooseTitle: 'Choose a folder',
    caption: 'Files directly inside are grouped by name; subfolders and hidden files are left alone.',
    prompt: 'Choose the folder that holds the files to rename.',
    readStage: 'Reading files',
    read: async (uri) => {
      const listing = await FolderAccess.listFolder(uri);
      const scan = buildScan(listing.rootName, listing.children);
      return { rootName: listing.rootName, scan, groups: regroup(scan, [], settings.strictMatch, settings.gatherSmallGroups), excluded: new Set() };
    },
  });
  const data = tool.data;
  const { setData } = tool;

  const targets = useMemo(() => (data ? computeTargets(data.scan, data.groups, data.excluded) : null), [data]);
  const renameable = targets?.pending.length ?? 0;

  const setGrouping = (change: Partial<FileRenameSettings>) => {
    const next = { ...settings, ...change };
    setSettings(next);
    if (tool.busy) return;
    setData((d) => (d ? { ...d, groups: regroup(d.scan, d.groups, next.strictMatch, next.gatherSmallGroups) } : d));
  };

  // Stable callbacks, so rows that didn't change skip re-rendering.
  const updateGroup = useCallback(
    (index: number, change: Partial<FileGroup>) =>
      setData((d) => (d ? { ...d, groups: d.groups.map((g, i) => (i === index ? { ...g, ...change } : g)) } : d)),
    [setData],
  );
  const nameGroup = useCallback((index: number, name: string) => updateGroup(index, { name }), [updateGroup]);
  const toggleExpanded = useCallback(
    (index: number) => setData((d) => (d ? { ...d, groups: d.groups.map((g, i) => (i === index ? { ...g, expanded: !g.expanded } : g)) } : d)),
    [setData],
  );

  const busy = tool.busy;
  const toggleFile = useCallback(
    (uri: string) => {
      if (busy) return;
      setData((d) => {
        if (!d) return d;
        const excluded = new Set(d.excluded);
        if (excluded.has(uri)) excluded.delete(uri);
        else excluded.add(uri);
        return { ...d, excluded };
      });
    },
    [busy, setData],
  );

  // Searching filters what is shown (not what is renamed); typing stays smooth while the list catches up.
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const listed = useMemo(() => (data ? groupRows(data.scan, data.groups, search) : { rows: [], matches: 0 }), [data, search]);

  const confirmRename = () => {
    if (!data || tool.busy) return;
    Keyboard.dismiss();
    const pending = targets?.pending ?? [];
    if (pending.length === 0) return;
    const count = pending.length;
    Alert.alert(
      `Rename ${count}${count === 1 ? ' file?' : ' files?'}`,
      `Files in each named group will be numbered with their group name, keeping their extensions (e.g. ${pending[0].file.name} → ${pending[0].target}). Unnamed groups and left-out files stay as they are.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: () =>
            tool.rename(pending.map((p) => ({ uri: p.file.uri, name: p.file.name, target: p.target, stageSuffix: stageSuffixOf(p.file.name) }))),
        },
      ],
    );
  };

  // ---------- render ----------

  // The list stays visible while renaming, as it did before.
  const showGroups = !tool.scanning && data != null;
  const totalFiles = data?.scan.files.length ?? 0;
  const searching = search.trim() !== '';
  let notice: string | null = null;
  // The bottom button always offers the next step: Choose folder → Scan → Rename.
  let action: Action = tool.busy
    ? { label: 'Working…', disabled: true }
    : tool.chosen
      ? { label: 'Scan', icon: 'magnify-scan', onPress: tool.scan }
      : { label: 'Choose folder', icon: 'folder-multiple-outline', onPress: tool.choose };
  if (!showGroups) {
    if (!tool.scanning) {
      notice = tool.message ?? (tool.chosen && !tool.attempted ? 'Tap Scan to group its files.' : 'Choose a folder to group its files here.');
    }
  } else {
    if (data.groups.length === 0) notice = 'No files found directly in this folder. Files inside subfolders are not included.';
    else if (searching && listed.matches === 0) notice = `No files match “${search.trim()}”.`;
    else if (tool.message) notice = tool.message;
    else notice = 'Name a group to rename its files. Tap a file to leave it out.';
    if (!tool.renaming) {
      action =
        renameable === 0
          ? { label: 'Name a group to rename', disabled: true }
          : { label: `Rename ${renameable}${renameable === 1 ? ' file' : ' files'}`, icon: 'rename-box', onPress: confirmRename };
    }
  }

  const header = (
    <View style={styles.header}>
      <Hero
        title="Tidy up files with look-alike names."
        body="Similar names such as file1, file(2) and fileee12 are grouped. Name a group and its files become Name_00001, Name_00002 and so on."
      />

      {tool.card}

      <Card>
        <SectionLabel>Matching</SectionLabel>
        <ToggleRow
          label="Strict pattern match"
          icon="format-letter-matches"
          subtitle={
            settings.strictMatch
              ? 'Only the same letter pattern is grouped: file1, fileee_2 and File(3) together, filexyz apart.'
              : 'Names that start alike are grouped too: file1, fileee_2 and filexyz together.'
          }
          value={settings.strictMatch}
          onChange={(v) => setGrouping({ strictMatch: v })}
          disabled={tool.busy}
        />
        <Divider style={{ marginVertical: 4 }} />
        <ToggleRow
          label="Gather small groups"
          icon="tray-full"
          subtitle={`Groups with fewer than ${SMALL_GROUP_SIZE} files join Other files, so only the big patterns get their own card.`}
          value={settings.gatherSmallGroups}
          onChange={(v) => setGrouping({ gatherSmallGroups: v })}
          disabled={tool.busy}
        />
      </Card>

      <StatRow
        items={[
          { label: 'Files', value: showGroups ? String(totalFiles) : '–' },
          { label: 'Groups', value: showGroups ? String(data.groups.length) : '–' },
          { label: 'To rename', value: showGroups ? String(renameable) : '–', tone: 'accent' },
        ]}
      />

      <SectionLabel
        style={{ marginTop: 10 }}
        right={data && !tool.busy && !tool.blocked ? <Button label="Rescan" icon="refresh" variant="ghost" size="sm" onPress={tool.scan} /> : null}
      >
        Groups
      </SectionLabel>
      {notice ? <Notice message={notice} /> : null}
      {tool.busy ? <ProgressCard progress={tool.progress} /> : null}
    </View>
  );

  const rows = showGroups ? listed.rows : EMPTY_ROWS;

  return (
    <ToolScreen
      tool="files"
      scroll={false}
      action={<ActionButton action={action} />}
      top={
        showGroups && totalFiles > 0 ? (
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search files"
            note={searching ? `${listed.matches} of ${totalFiles}` : null}
          />
        ) : null
      }
    >
      <FastList
        data={rows}
        keyExtractor={(r) => r.key}
        getItemType={(r) => r.type}
        extraData={targets}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        backToTop
        resetKey={search.trim().toLowerCase()}
        labelFor={(r) => (data ? groupLabel(data.groups[r.groupIndex]) : null)}
        renderItem={({ item: r }) => {
          if (!data) return null;
          const group = data.groups[r.groupIndex];
          if (r.type === 'head') {
            return (
              <GroupHead
                index={r.groupIndex}
                name={group.name}
                suggestion={group.suggestion}
                other={group.other}
                matching={r.matching}
                total={r.total}
                searching={searching}
                disabled={tool.busy}
                onName={nameGroup}
              />
            );
          }
          if (r.type === 'file') {
            const file = data.scan.files[r.fileIndex];
            return (
              <FileRow
                file={file}
                target={targets?.targets.get(file.uri) ?? null}
                excluded={data.excluded.has(file.uri)}
                first={r.first}
                onToggle={toggleFile}
              />
            );
          }
          return <GroupFoot index={r.groupIndex} hidden={r.hidden} total={r.total} expanded={r.expanded} onExpand={toggleExpanded} />;
        }}
      />
    </ToolScreen>
  );
}

const EMPTY_ROWS: GroupRow[] = [];

/** What the fast scroller shows for a group: its name, its suggestion, or what it is. */
function groupLabel(group: FileGroup | undefined): string | null {
  if (!group) return null;
  return group.name.trim() || group.suggestion || (group.other ? 'Other files' : 'Group');
}

// Each group is drawn as a card cut into rows (header, files, footer) so the list can recycle them.

const GroupHead = memo(function GroupHead({
  index,
  name,
  suggestion,
  other,
  matching,
  total,
  searching,
  disabled,
  onName,
}: {
  index: number;
  name: string;
  suggestion: string;
  other: boolean;
  matching: number;
  total: number;
  searching: boolean;
  disabled: boolean;
  onName: (index: number, name: string) => void;
}) {
  const c = usePalette();
  const count = total === 1 ? '1 file' : `${total} files`;
  const label = searching ? `${matching} of ${count} match` : count;
  const placeholder = other ? 'Name these files' : suggestion === '' ? 'Name this group' : `e.g. ${suggestion}`;
  return (
    <View style={[styles.segment, styles.head, { backgroundColor: c.surface, borderColor: c.line }]}>
      <View style={styles.groupHead}>
        <Icon name={other ? 'tray-full' : 'file-multiple-outline'} size={18} color={c.muted} />
        <Txt v="label" color={c.muted} style={{ flex: 1 }}>
          {other ? `Other files · ${label}` : label}
        </Txt>
        {suggestion !== '' ? (
          <Pill label={`Use ${suggestion}`} tone="accent" icon="auto-fix" onPress={disabled ? undefined : () => onName(index, suggestion)} />
        ) : null}
      </View>
      {other ? (
        <Txt v="caption" color={c.muted}>
          Files with no shared name pattern, gathered here.
        </Txt>
      ) : null}
      <TextField
        value={name}
        onChangeText={(t) => onName(index, cleanNameInput(t))}
        placeholder={placeholder}
        maxLength={60}
        monospace
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        disabled={disabled}
        style={{ marginTop: 2, marginBottom: 4 }}
      />
    </View>
  );
});

const FileRow = memo(function FileRow({
  file,
  target,
  excluded,
  first,
  onToggle,
}: {
  file: FileItem;
  target: string | null;
  excluded: boolean;
  first: boolean;
  onToggle: (uri: string) => void;
}) {
  const c = usePalette();
  let line: string;
  let color = c.muted;
  if (excluded) line = 'left out · tap to include';
  else if (target == null) line = '→ waiting for a group name';
  else if (target === file.name) line = '→ already named';
  else {
    line = `→ ${target}`;
    color = c.accent;
  }
  return (
    <View style={[styles.segment, styles.joined, { backgroundColor: c.surface, borderColor: c.line }]}>
      {first ? null : <Divider />}
      <Pressable onPress={() => onToggle(file.uri)} style={styles.fileRow}>
        <Icon name={excluded ? 'minus-circle-outline' : 'file-outline'} size={18} color={excluded ? c.faint : c.muted} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt
            v="small"
            color={excluded ? c.muted : c.ink}
            numberOfLines={1}
            ellipsizeMode="middle"
            style={excluded ? { textDecorationLine: 'line-through' } : undefined}
          >
            {file.name}
          </Txt>
          <Txt v="mono" color={color} numberOfLines={1} ellipsizeMode="middle" style={{ fontSize: 12, lineHeight: 16 }}>
            {line}
          </Txt>
        </View>
      </Pressable>
    </View>
  );
});

const GroupFoot = memo(function GroupFoot({
  index,
  hidden,
  total,
  expanded,
  onExpand,
}: {
  index: number;
  hidden: number;
  total: number;
  expanded: boolean;
  onExpand: (index: number) => void;
}) {
  const c = usePalette();
  const canToggle = hidden > 0 || expanded;
  return (
    <View style={[styles.segment, styles.joined, styles.foot, { backgroundColor: c.surface, borderColor: c.line }]}>
      {canToggle ? (
        <Pressable onPress={() => onExpand(index)} style={styles.expand} hitSlop={6}>
          <Txt v="smallStrong" color={c.accent}>
            {expanded ? 'Show fewer' : `Show all ${total} files`}
          </Txt>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.accent} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  header: { gap: 12, paddingBottom: 12 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  // Rows of one group share side borders; the header and footer round the card's corners.
  segment: { paddingHorizontal: 16, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  // Each segment after the header tucks 1px under the one above, so no seam shows between rows.
  joined: { marginTop: -1, paddingTop: 1 },
  head: {
    paddingTop: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  foot: {
    paddingBottom: 12,
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 6 },
});
