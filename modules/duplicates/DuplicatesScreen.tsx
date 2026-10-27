import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActionButton,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Hero,
  Icon,
  Pill,
  ProgressCard,
  SectionLabel,
  StatRow,
  ToggleRow,
  ToolScreen,
  Txt,
  radius,
  usePalette,
  type Progress,
} from '@/ui';
import { bytes, duration } from '@/lib/format';
import { usePersistentState } from '@/lib/settings';
import { useTaskLock } from '@/lib/tasks';
import { MediaLibrary, isCancelled, trashName, useMediaScope } from '../media-library';
import { Duplicates, type DupGroup, type DupMember } from './engine';
import { DEFAULT_DUPE_SETTINGS, type DupeSettings } from './settings';

type Phase = 'setup' | 'scanning' | 'results';

export default function DuplicatesScreen() {
  const c = usePalette();
  const [settings, setSettings] = usePersistentState<DupeSettings>('dupes.settings.v2', DEFAULT_DUPE_SETTINGS);
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState<Progress>({ stage: 'Reading media library…', done: 0, total: 0 });
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  useTaskLock('duplicates', phase === 'scanning' || deleting);

  const scope = useMediaScope({
    kind: 'any',
    folderIds: settings.folderIds,
    includeSubfolders: settings.includeSubfolders,
    onChange: (folderIds, includeSubfolders) => setSettings((s) => ({ ...s, folderIds, includeSubfolders })),
    deniedMessage: 'Allow access to your photos and videos to scan for duplicates.',
    caption: 'Items are only compared with others inside the chosen folders.',
    prompt: 'Choose all folders or specific ones to scan. Items are only compared with others inside the chosen folders.',
  });

  useEffect(() => {
    const sub = Duplicates.addListener('onScanProgress', setProgress);
    return () => sub.remove();
  }, []);

  const scan = () =>
    scope.withAccess(async () => {
      if (settings.folderIds == null) return;
      setPhase('scanning');
      setProgress({ stage: 'Reading media library…', done: 0, total: 0 });
      try {
        const result = await Duplicates.scanDuplicates({
          folderIds: settings.folderIds,
          includeSubfolders: settings.includeSubfolders,
          threshold: settings.threshold / 100,
          photos: settings.photos,
          videos: settings.videos,
        });
        setGroups(result);
        setSelected(defaultSelection(result));
        setPhase('results');
      } catch (e) {
        setPhase('setup');
        if (!isCancelled(e)) Alert.alert('Scan failed', String((e as Error).message ?? e));
      }
    });

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedBytes = useMemo(
    () => groups.flatMap((g) => g.members).filter((m) => selected.has(m.id)).reduce((n, m) => n + m.size, 0),
    [groups, selected],
  );
  const orphanGroups = useMemo(() => groups.filter((g) => g.members.every((m) => selected.has(m.id))).length, [groups, selected]);

  const doDelete = async () => {
    const ids = [...selected];
    setDeleting(true);
    try {
      const ok = await MediaLibrary.trash(ids);
      if (!ok) return;
      const gone = new Set(ids);
      setGroups((gs) =>
        gs
          .map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m.id)) }))
          .filter((g) => g.members.length >= 2),
      );
      setSelected(new Set());
      Alert.alert('Done', `${ids.length} items moved to ${trashName()} · ${bytes(selectedBytes)} freed`);
    } catch (e) {
      Alert.alert('Delete failed', String((e as Error).message ?? e));
    } finally {
      setDeleting(false);
    }
  };

  const onDelete = () => {
    if (orphanGroups > 0) {
      Alert.alert('No copy kept', `In ${orphanGroups} group(s) every copy is selected, so nothing from them will be kept.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete anyway', style: 'destructive', onPress: doDelete },
      ]);
    } else doDelete();
  };

  // ---------- render ----------

  if (phase === 'scanning') {
    return (
      <ToolScreen tool="duplicates">
        <ProgressCard
          progress={progress}
          hint="First scan is slowest; results are cached so rescans are quick."
          onCancel={() => Duplicates.cancel()}
        />
      </ToolScreen>
    );
  }

  if (phase === 'results') {
    if (groups.length === 0) {
      return (
        <ToolScreen tool="duplicates" scroll={false}>
          <EmptyState icon="check-decagram-outline" title="All clean" body={`No items at or above ${settings.threshold}% similarity.`}>
            <Button label="New scan" icon="refresh" onPress={() => setPhase('setup')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
          </EmptyState>
        </ToolScreen>
      );
    }
    return (
      <ToolScreen
        tool="duplicates"
        scroll={false}
        action={
          <Button
            label={`Move ${selected.size} to ${trashName()} · ${bytes(selectedBytes)}`}
            icon="trash-can-outline"
            variant="danger"
            onPress={onDelete}
            disabled={selected.size === 0}
            loading={deleting}
          />
        }
      >
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 12 }}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              <StatRow
                items={[
                  { label: 'Groups', value: String(groups.length) },
                  { label: 'Selected', value: String(selected.size), tone: 'danger' },
                  { label: 'To free', value: bytes(selectedBytes), tone: 'accent' },
                ]}
              />
              <View style={styles.toolbar}>
                <Button label="Auto-select" icon="auto-fix" variant="secondary" size="sm" onPress={() => setSelected(defaultSelection(groups))} />
                <Button label="Clear" icon="selection-off" variant="secondary" size="sm" onPress={() => setSelected(new Set())} />
                <View style={{ flex: 1 }} />
                <Button label="New scan" icon="refresh" variant="ghost" size="sm" onPress={() => setPhase('setup')} />
              </View>
            </View>
          }
          renderItem={({ item }) => <GroupCard group={item} selected={selected} onToggle={toggle} />}
        />
      </ToolScreen>
    );
  }

  return (
    <ToolScreen
      tool="duplicates"
      action={
        // The bottom button always offers the next step: Choose folders → Scan.
        <ActionButton
          action={
            scope.chosen
              ? { label: 'Scan', icon: 'magnify-scan', onPress: scan, disabled: !settings.photos && !settings.videos }
              : { label: 'Choose folders', icon: 'folder-multiple-outline', onPress: scope.open }
          }
        />
      }
    >
      <Hero
        title="Find look-alike photos & videos."
        body="Groups near-identical items, keeps the best copy of each group (highest resolution, then largest file) and pre-selects the rest. Everything runs on your phone."
      />
      {scope.card}

      <Card>
        <SectionLabel
          right={
            <Txt v="stat" color={c.accent}>
              {`${settings.threshold}%`}
            </Txt>
          }
        >
          Similarity threshold
        </SectionLabel>
        <Slider
          minimumValue={50}
          maximumValue={100}
          step={1}
          value={settings.threshold}
          onValueChange={(v) => setSettings((s) => ({ ...s, threshold: Math.round(v) }))}
          minimumTrackTintColor={c.lit}
          maximumTrackTintColor={c.line}
          thumbTintColor={c.lit}
        />
        <View style={styles.scale}>
          <Txt v="caption" color={c.faint}>
            50% · looser
          </Txt>
          <Txt v="caption" color={c.faint}>
            stricter · 100%
          </Txt>
        </View>
        <Txt v="caption" color={c.muted}>
          Both shape and colour must match. 90%+ ≈ same photo resized/re-saved/re-shared (WhatsApp etc.). 80% also catches near-identical
          shots. 60–70% catches burst shots — review before deleting.
        </Txt>
      </Card>

      <Card>
        <SectionLabel>Include</SectionLabel>
        <ToggleRow label="Photos" icon="image-outline" value={settings.photos} onChange={(v) => setSettings((s) => ({ ...s, photos: v }))} />
        <ToggleRow label="Videos" icon="video-outline" value={settings.videos} onChange={(v) => setSettings((s) => ({ ...s, videos: v }))} />
      </Card>
    </ToolScreen>
  );
}

function GroupCard({ group, selected, onToggle }: { group: DupGroup; selected: Set<string>; onToggle: (id: string) => void }) {
  const c = usePalette();
  const all = group.members.every((m) => selected.has(m.id));
  const reclaim = group.members.filter((m) => selected.has(m.id)).reduce((n, m) => n + m.size, 0);
  const folders = [...new Set(group.members.map((m) => m.folder))];
  const isVideo = group.members[0].kind === 'video';
  return (
    <Card tone={all ? 'warn' : undefined} style={{ paddingHorizontal: 0, gap: 8 }}>
      <View style={[styles.groupHead, { paddingHorizontal: 16 }]}>
        <Icon name={isVideo ? 'video-outline' : 'image-outline'} size={20} color={c.muted} />
        <Txt v="heading" style={{ flex: 1 }}>{`${group.members.length} similar ${isVideo ? 'videos' : 'photos'}`}</Txt>
        {all ? <Pill label="Nothing kept" tone="warn" icon="alert-outline" /> : <Pill label={`Frees ${bytes(reclaim)}`} tone="accent" />}
      </View>
      <Txt v="caption" color={c.muted} numberOfLines={1} style={{ paddingHorizontal: 16 }}>
        {folders.join(' · ')}
      </Txt>
      {all ? (
        <Txt v="caption" color={c.warn} style={{ paddingHorizontal: 16 }}>
          Every copy selected — nothing will be kept
        </Txt>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 4, paddingHorizontal: 16 }}>
        {group.members.map((m, i) => (
          <Tile key={m.id} m={m} keeper={i === 0} selected={selected.has(m.id)} onPress={() => onToggle(m.id)} />
        ))}
      </ScrollView>
    </Card>
  );
}

function Tile({ m, keeper, selected, onPress }: { m: DupMember; keeper: boolean; selected: boolean; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} style={{ width: 120 }}>
      <View style={[styles.tile, { borderColor: selected ? c.danger : keeper ? c.good : 'transparent', backgroundColor: c.sunken }]}>
        <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={m.id} />
        {selected ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.38)' }]} /> : null}
        {keeper ? (
          <View style={[styles.badge, { backgroundColor: c.good }]}>
            <Icon name="star" size={11} color="#fff" />
            <Txt v="label" color="#fff" style={{ fontSize: 9, letterSpacing: 0.6 }}>
              Best
            </Txt>
          </View>
        ) : null}
        <View style={styles.check}>
          <Checkbox checked={selected} tone="danger" />
        </View>
        {m.kind === 'video' ? (
          <View style={styles.dur}>
            <Icon name="play" size={11} color="#fff" />
            <Txt v="caption" color="#fff" style={{ fontSize: 11, fontWeight: '600' }}>
              {duration(m.durationMs) ?? ''}
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt v="smallStrong" style={{ marginTop: 6 }} color={selected ? c.danger : c.ink}>
        {keeper ? 'Kept by default' : `${m.similarity}% match`}
      </Txt>
      <Txt v="caption" color={c.muted} numberOfLines={1}>
        {m.width > 0 ? `${m.width}×${m.height} · ` : ''}
        {bytes(m.size)}
      </Txt>
    </Pressable>
  );
}

function defaultSelection(groups: DupGroup[]) {
  return new Set(groups.flatMap((g) => g.members.slice(1).map((m) => m.id)));
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tile: { width: 120, height: 120, borderRadius: radius.md + 2, overflow: 'hidden', borderWidth: 3 },
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  check: { position: 'absolute', top: 6, right: 6 },
  dur: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
});
