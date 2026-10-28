import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { errorMessage, isCancelled } from '@/lib/errors';
import { bytes, plural } from '@/lib/format';
import { toggled } from '@/lib/sets';
import { usePersistentState } from '@/lib/settings';
import { useTaskLock } from '@/lib/tasks';
import {
  ActionButton,
  Button,
  Card,
  Checkbox,
  Divider,
  EmptyState,
  FastList,
  Hero,
  Icon,
  Notice,
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
import { ensureAllFilesAccess, parentOf, storagePathLabel } from '../folder-access';
import { Cleaner, type CleanItem, type CleanKind } from './engine';
import { KINDS, defaultSelection, displayName, needsReview, resultRows, type ResultRow } from './model';
import { ReviewSheet } from './ReviewSheet';
import { DEFAULT_CLEANER_SETTINGS, type CleanerSettings } from './settings';

type Phase = 'setup' | 'scanning' | 'results';

export default function CleanerScreen() {
  const [settings, setSettings] = usePersistentState<CleanerSettings>('cleaner.settings', DEFAULT_CLEANER_SETTINGS);
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState<Progress>({ stage: 'Scanning', done: 0, total: 0 });
  const [items, setItems] = useState<CleanItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Items over 50 MB whose contents were shown; only these can be selected. */
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<CleanItem | null>(null);
  const [cleaning, setCleaning] = useState(false);
  useTaskLock('cleaner', phase === 'scanning' || cleaning);

  useEffect(() => {
    const sub = Cleaner?.addListener('onCleanerProgress', setProgress);
    return () => sub?.remove();
  }, []);

  const scan = async () => {
    if (!ensureAllFilesAccess()) return;
    setPhase('scanning');
    setProgress({ stage: 'Scanning', done: 0, total: 0 });
    try {
      const found = await Cleaner!.scan(settings.kinds);
      setItems(found);
      setSelected(defaultSelection(found));
      setReviewed(new Set());
      setPhase('results');
    } catch (e) {
      setPhase('setup');
      if (!isCancelled(e)) Alert.alert('Scan failed', errorMessage(e));
    }
  };

  const toggleKind = (kind: CleanKind, on: boolean) =>
    setSettings((s) => ({ ...s, kinds: on ? KINDS.map((k) => k.key).filter((k) => k === kind || s.kinds.includes(k)) : s.kinds.filter((k) => k !== kind) }));

  const rows = useMemo(() => resultRows(items), [items]);
  const titles = useMemo(() => new Map(rows.flatMap((r) => (r.type === 'head' ? [[r.section, r.title] as const] : []))), [rows]);
  const chosen = useMemo(() => items.filter((i) => selected.has(i.path)), [items, selected]);
  const chosenBytes = chosen.reduce((n, i) => n + i.size, 0);

  /** Whether an item may be selected: anything up to 50 MB, bigger ones once checked. */
  const selectable = useCallback((item: CleanItem) => !needsReview(item) || reviewed.has(item.path), [reviewed]);

  const pressItem = useCallback(
    (item: CleanItem) => {
      if (cleaning) return;
      if (!selectable(item)) {
        setReviewing(item);
        return;
      }
      setSelected((cur) => toggled(cur, item.path));
    },
    [cleaning, selectable],
  );

  const setSection = useCallback(
    (section: string, on: boolean) =>
      setSelected((cur) => {
        const next = new Set(cur);
        for (const r of rows) {
          if (r.type !== 'item' || r.section !== section) continue;
          if (!on) next.delete(r.item.path);
          else if (selectable(r.item)) next.add(r.item.path);
        }
        return next;
      }),
    [rows, selectable],
  );

  const doClean = async () => {
    setCleaning(true);
    setProgress({ stage: 'Cleaning', done: 0, total: chosen.length });
    try {
      const result = await Cleaner!.clean(chosen.map(({ path, kind }) => ({ path, kind })));
      const gone = new Set(result.cleaned);
      setItems((list) => list.filter((i) => !gone.has(i.path)));
      setSelected((cur) => new Set([...cur].filter((p) => !gone.has(p))));
      const failed =
        result.failed > 0
          ? `\n\n${result.failed} couldn't be cleaned: they changed since the scan or couldn't be deleted. Scan again to see them as they are now.`
          : '';
      Alert.alert('Done', `${result.cleaned.length} cleaned · ${bytes(result.freed)} freed${failed}`);
    } catch (e) {
      if (isCancelled(e)) Alert.alert('Stopped', 'What was already deleted stays deleted. Scan again to see what is left.');
      else Alert.alert('Clean failed', errorMessage(e));
    } finally {
      setCleaning(false);
    }
  };

  const confirmClean = () => {
    const big = chosen.filter(needsReview).length;
    Alert.alert(
      `Delete ${plural(chosen.length, 'item')} for good?`,
      `This frees ${bytes(chosenBytes)}. Cleaned items are deleted, not moved to Trash, and can't be brought back.${
        big > 0 ? ` This includes ${big} over 50 MB that you checked.` : ''
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doClean },
      ],
    );
  };

  // ---------- render ----------

  if (phase === 'scanning') {
    return (
      <ToolScreen tool="cleaner">
        <ProgressCard progress={progress} hint="Reads every folder on this phone's storage. Nothing is deleted until you choose." onCancel={() => Cleaner!.cancel()} />
      </ToolScreen>
    );
  }

  if (phase === 'results') {
    if (items.length === 0) {
      return (
        <ToolScreen tool="cleaner" scroll={false}>
          <EmptyState icon="check-decagram-outline" title="Nothing to clean" body="No leftover, stuck or empty files were found.">
            <Button label="New scan" icon="refresh" onPress={() => setPhase('setup')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
          </EmptyState>
        </ToolScreen>
      );
    }
    const toCheck = items.filter((i) => needsReview(i) && !reviewed.has(i.path)).length;
    return (
      <ToolScreen
        tool="cleaner"
        scroll={false}
        action={
          <Button
            label={`Clean ${chosen.length} · ${bytes(chosenBytes)}`}
            icon="broom"
            variant="danger"
            onPress={confirmClean}
            disabled={chosen.length === 0}
            loading={cleaning}
          />
        }
      >
        <FastList
          data={rows}
          keyExtractor={(r) => r.key}
          getItemType={(r) => r.type}
          extraData={{ selected, reviewed, cleaning }}
          contentContainerStyle={styles.content}
          backToTop
          labelFor={(r) => titles.get(r.section) ?? null}
          ListHeaderComponent={
            <View style={styles.header}>
              <StatRow
                items={[
                  { label: 'Found', value: String(items.length) },
                  { label: 'Selected', value: String(chosen.length), tone: 'danger' },
                  { label: 'To free', value: bytes(chosenBytes), tone: 'accent' },
                ]}
              />
              {cleaning ? <ProgressCard progress={progress} onCancel={() => Cleaner!.cancel()} /> : null}
              {toCheck > 0 ? (
                <Notice tone="warn" message={`${plural(toCheck, 'item is', 'items are')} over 50 MB and not selected. Tap one to check what's inside first.`} />
              ) : null}
              <View style={styles.toolbar}>
                <Button
                  label="Select all"
                  icon="checkbox-multiple-marked-outline"
                  variant="secondary"
                  size="sm"
                  disabled={cleaning}
                  onPress={() => setSelected(new Set(items.filter(selectable).map((i) => i.path)))}
                />
                <Button label="Clear" icon="selection-off" variant="secondary" size="sm" disabled={cleaning} onPress={() => setSelected(new Set())} />
                <View style={{ flex: 1 }} />
                <Button label="New scan" icon="refresh" variant="ghost" size="sm" disabled={cleaning} onPress={() => setPhase('setup')} />
              </View>
            </View>
          }
          renderItem={({ item: r }) =>
            r.type === 'head' ? (
              <SectionHead row={r} allOn={sectionAllOn(rows, r.section, selected, selectable)} disabled={cleaning} onSet={setSection} />
            ) : (
              <ItemRow
                item={r.item}
                review={r.review}
                checked={reviewed.has(r.item.path)}
                selected={selected.has(r.item.path)}
                onPress={pressItem}
                onReview={setReviewing}
              />
            )
          }
        />
        {reviewing ? (
          <ReviewSheet
            item={reviewing}
            onClose={() => {
              setReviewed((cur) => new Set(cur).add(reviewing.path));
              setReviewing(null);
            }}
            onSelect={() => {
              setReviewed((cur) => new Set(cur).add(reviewing.path));
              setSelected((cur) => new Set(cur).add(reviewing.path));
              setReviewing(null);
            }}
          />
        ) : null}
      </ToolScreen>
    );
  }

  return (
    <ToolScreen
      tool="cleaner"
      action={<ActionButton action={{ label: 'Scan', icon: 'magnify-scan', onPress: scan, disabled: settings.kinds.length === 0 }} />}
    >
      <Hero
        title="Clear out leftover files."
        body="Finds files and folders nothing uses any more: leftovers of removed apps, expired Trash, unfinished saves and downloads, and empty files and folders. Anything over 50 MB is listed for you to check before it can be cleaned."
      />
      <Card>
        <SectionLabel>Look for</SectionLabel>
        {KINDS.map((k, i) => (
          <View key={k.key} style={{ gap: 10 }}>
            {i > 0 ? <Divider style={{ marginVertical: 4 }} /> : null}
            <ToggleRow label={k.title} subtitle={k.note} icon={k.icon} value={settings.kinds.includes(k.key)} onChange={(v) => toggleKind(k.key, v)} />
          </View>
        ))}
      </Card>
      <Notice message="Scans all of this phone's storage and SD card. Cleaned items are deleted for good, not moved to Trash. Android/data and Android/obb can't be read by any app, so they are not included." />
    </ToolScreen>
  );
}

function sectionAllOn(rows: ResultRow[], section: string, selected: Set<string>, selectable: (i: CleanItem) => boolean) {
  const own = rows.filter((r): r is Extract<ResultRow, { type: 'item' }> => r.type === 'item' && r.section === section && selectable(r.item));
  return own.length > 0 && own.every((r) => selected.has(r.item.path));
}

const SectionHead = memo(function SectionHead({
  row,
  allOn,
  disabled,
  onSet,
}: {
  row: Extract<ResultRow, { type: 'head' }>;
  allOn: boolean;
  disabled: boolean;
  onSet: (section: string, on: boolean) => void;
}) {
  const c = usePalette();
  return (
    <View style={styles.sectionHead}>
      <View style={styles.row}>
        <Icon name={row.icon} size={18} color={row.section === 'review' ? c.warn : c.muted} />
        <Txt v="label" color={row.section === 'review' ? c.warn : c.muted} style={{ flex: 1 }}>
          {`${row.title} · ${row.count}${row.size > 0 ? ` · ${bytes(row.size)}` : ''}`}
        </Txt>
        <Button label={allOn ? 'None' : 'All'} variant="ghost" size="sm" disabled={disabled} onPress={() => onSet(row.section, !allOn)} />
      </View>
      <Txt v="caption" color={c.muted}>
        {row.note}
      </Txt>
    </View>
  );
});

const ItemRow = memo(function ItemRow({
  item,
  review,
  checked,
  selected,
  onPress,
  onReview,
}: {
  item: CleanItem;
  review: boolean;
  /** Its contents were shown (items over 50 MB). */
  checked: boolean;
  selected: boolean;
  onPress: (item: CleanItem) => void;
  onReview: (item: CleanItem) => void;
}) {
  const c = usePalette();
  const detail = item.isDirectory ? (item.files > 0 ? `${bytes(item.size)} · ${plural(item.files, 'file')}` : 'Empty') : bytes(item.size);
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={[styles.item, { backgroundColor: c.surface, borderColor: selected ? c.danger : review ? c.warn : c.line }]}
    >
      {review && !checked ? <Icon name="lock-outline" size={22} color={c.warn} /> : <Checkbox checked={selected} tone="danger" />}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="smallStrong" numberOfLines={1} ellipsizeMode="middle">
          {displayName(item)}
        </Txt>
        <Txt v="caption" color={c.muted} numberOfLines={1} ellipsizeMode="head">
          {storagePathLabel(parentOf(item.path))}
        </Txt>
        <Txt v="caption" color={c.muted}>
          {detail}
        </Txt>
      </View>
      {review ? (
        checked ? (
          <Button label="View" icon="file-eye-outline" variant="ghost" size="sm" onPress={() => onReview(item)} />
        ) : (
          <Pill label="Check" tone="warn" icon="file-eye-outline" onPress={() => onReview(item)} />
        )
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { gap: 12, paddingBottom: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHead: { gap: 2, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: radius.md + 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
