import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Divider, FastList, Icon, Sheet, ToggleRow, Txt, usePalette } from '@/ui';
import type { FolderNode, FolderSource } from './types';

/** How a row relates to the selection. */
type Mark = 'explicit' | 'implied' | 'inside' | 'none';

/**
 * The one picker every tool uses for folders (and files). Entries are shown one level at a time
 * with a path bar (instead of ever-deeper indentation): tap a row to tick it, tap › to open it.
 *
 * multiple: tick any number; All / None (this level), a count and "Include subfolders" at the top.
 * single: choose exactly one.
 * selectable: what can be ticked; other rows only open.
 */
export function FolderPickerSheet({
  title,
  source,
  mode,
  initialIds,
  initialSub = true,
  selectable = 'folders',
  subfolderToggle = true,
  onConfirm,
  onClose,
}: {
  title: string;
  source: FolderSource;
  mode: 'multiple' | 'single';
  selectable?: 'folders' | 'files' | 'both';
  /** Offer "Include subfolders"; without it a ticked folder always includes what's inside. */
  subfolderToggle?: boolean;
  /** null = nothing chosen yet; [] = all folders (multiple only). */
  initialIds: string[] | null;
  initialSub?: boolean;
  onConfirm: (ids: string[], includeSubfolders: boolean) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  const multiple = mode === 'multiple';
  const [trail, setTrail] = useState<FolderNode[]>([]);
  const [levels, setLevels] = useState<Record<string, FolderNode[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [sub, setSub] = useState(initialSub);
  const [failed, setFailed] = useState(false);
  /** False until the top level, and the way down to the current choice, are read. */
  const [ready, setReady] = useState(false);
  /**
   * The folder being opened. Big folders take a while to read: meanwhile its row shows a spinner and
   * other opens and the path bar wait, so extra taps can't stack levels. The ref guards taps that
   * land before the re-render.
   */
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef(false);
  const includeSub = multiple && source.nested && (subfolderToggle ? sub : true);
  const canSelect = useCallback((n: FolderNode) => !n.blocked && (n.isFile ? selectable !== 'folders' : selectable !== 'files'), [selectable]);

  // Selection lookups as sets, so each row is O(depth) rather than O(selected) to draw.
  const marks = useMemo(() => {
    const chosen = new Set(selected);
    const holders = new Set<string>();
    for (const id of selected) {
      for (let cut = id.lastIndexOf('/'); cut > 0; cut = id.lastIndexOf('/', cut - 1)) holders.add(id.slice(0, cut));
    }
    return (id: string): Mark => {
      if (chosen.has(id)) return 'explicit';
      if (includeSub) {
        for (let cut = id.lastIndexOf('/'); cut > 0; cut = id.lastIndexOf('/', cut - 1)) if (chosen.has(id.slice(0, cut))) return 'implied';
      }
      return holders.has(id) ? 'inside' : 'none';
    };
  }, [selected, includeSub]);

  const load = async (node: FolderNode | null) => {
    const key = node?.id ?? '';
    const list = node ? await source.children(node) : await source.roots();
    setLevels((cur) => ({ ...cur, [key]: list }));
    return list;
  };

  // Mounted only while open: load the top level (and the way down to the current choice).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const roots = await load(null);
        if (!alive) return;
        if (initialIds == null) {
          setSelected([]);
        } else if (initialIds.length === 0 && multiple) {
          setSelected(roots.filter((r) => !r.blocked).map((r) => r.id));
          setSub(true);
        } else {
          setSelected(initialIds);
          if (initialIds.length === 1 && source.trailTo) {
            const path = await source.trailTo(initialIds[0]);
            for (const node of path) await load(node);
            if (alive) setTrail(path);
          }
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
    // Runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = trail[trail.length - 1] ?? null;
  const items = levels[current?.id ?? ''];

  const open = async (node: FolderNode) => {
    if (openingRef.current) return;
    if (!levels[node.id]) {
      openingRef.current = true;
      setOpening(node.id);
      try {
        await load(node);
      } catch {
        setLevels((cur) => ({ ...cur, [node.id]: [] }));
      } finally {
        openingRef.current = false;
        setOpening(null);
      }
    }
    setTrail((t) => [...t, node]);
  };

  const toggle = (id: string) => {
    if (!multiple) setSelected([id]);
    else setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  // One handler for every row, kept stable so unchanged rows skip re-rendering.
  const pressRow = useCallback(
    (n: FolderNode, mark: Mark) => {
      if (!canSelect(n) || mark === 'implied') {
        if (n.hasChildren) open(n);
      } else toggle(n.id);
    },
    // open/toggle only use setters and the loaded levels; re-binding on levels is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canSelect, levels, multiple],
  );
  const openRow = useCallback(
    (n: FolderNode) => {
      open(n);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [levels],
  );

  const confirm = () => {
    if (!multiple) onConfirm(selected.slice(0, 1), false);
    else onConfirm(source.coversAll?.(selected, includeSub) ? [] : selected, source.nested ? sub : false);
  };

  const chosenName = selected[0]?.slice(selected[0].lastIndexOf('/') + 1);
  const rowState = useMemo(() => ({ marks, opening }), [marks, opening]);

  return (
    <Sheet
      visible
      title={title}
      onClose={onClose}
      confirm={{
        label: multiple ? 'Done' : chosenName ? `Use “${chosenName}”` : 'Choose a folder',
        disabled: selected.length === 0,
        onPress: confirm,
      }}
      tools={
        <>
          {multiple && items ? (
            <View style={styles.tools}>
              <Button
                label="All"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setSelected((items ?? []).filter(canSelect).map((n) => n.id));
                  setSub(true);
                }}
              />
              <Button label="None" variant="secondary" size="sm" onPress={() => setSelected([])} />
              <View style={{ flex: 1 }} />
              <Txt v="smallStrong" color={c.muted}>
                {source.describe(selected, includeSub)}
              </Txt>
            </View>
          ) : null}
          {multiple && source.nested && subfolderToggle ? (
            <View style={[styles.subRow, { backgroundColor: c.surface, borderColor: c.line }]}>
              <ToggleRow label="Include subfolders" icon="file-tree-outline" value={sub} onChange={setSub} />
            </View>
          ) : null}
          {source.nested ? (
            <PathBar rootLabel={source.rootLabel} trail={trail} disabled={opening != null} onGo={(depth) => setTrail((t) => t.slice(0, depth))} />
          ) : null}
        </>
      }
    >
      {failed ? (
        <Txt color={c.muted} style={styles.message}>
          Folders could not be read. Check that FileToolkit is allowed to access them.
        </Txt>
      ) : items == null || !ready ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.accent} />
      ) : items.length === 0 ? (
        <Txt color={c.muted} style={styles.message}>
          No folders here.
        </Txt>
      ) : (
        <FastList
          data={items}
          keyExtractor={(n) => n.id}
          extraData={rowState}
          contentContainerStyle={{ paddingBottom: 16 }}
          ItemSeparatorComponent={RowDivider}
          labelFor={(n) => n.name}
          renderItem={({ item: n }) => (
            <PickerRow
              node={n}
              mark={marks(n.id)}
              pickable={canSelect(n)}
              nested={source.nested}
              loading={opening === n.id}
              onPress={pressRow}
              onOpen={openRow}
            />
          )}
        />
      )}
    </Sheet>
  );
}

function RowDivider() {
  return <Divider style={{ marginLeft: 20 }} />;
}

const PickerRow = memo(function PickerRow({
  node: n,
  mark,
  pickable,
  nested,
  loading,
  onPress,
  onOpen,
}: {
  node: FolderNode;
  mark: Mark;
  pickable: boolean;
  nested: boolean;
  /** Opening: its contents are being read. */
  loading: boolean;
  onPress: (n: FolderNode, mark: Mark) => void;
  onOpen: (n: FolderNode) => void;
}) {
  const c = usePalette();
  const blocked = n.blocked ?? null;
  const on = mark === 'explicit' || mark === 'implied';
  return (
    <Pressable onPress={() => onPress(n, mark)} android_ripple={{ color: c.accentSoft }} style={styles.row}>
      {pickable ? (
        <Checkbox checked={on} mixed={mark === 'inside'} disabled={mark === 'implied'} />
      ) : (
        <View style={styles.boxSpace}>{blocked ? <Icon name="lock-outline" size={18} color={c.faint} /> : null}</View>
      )}
      <Icon name={n.icon ?? (n.isFile ? 'file-outline' : 'folder')} size={20} color={on ? c.accent : c.faint} />
      <View style={{ flex: 1 }}>
        <Txt v="bodyStrong" numberOfLines={1}>
          {n.name}
        </Txt>
        {blocked || n.caption || mark === 'inside' ? (
          <Txt v="caption" color={c.muted} numberOfLines={1}>
            {blocked ?? [n.caption, mark === 'inside' ? 'some folders inside chosen' : null].filter(Boolean).join(' · ')}
          </Txt>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.openBtn} accessibilityLabel={`Opening ${n.name}`}>
          <ActivityIndicator size="small" color={c.accent} style={styles.openSpinner} />
        </View>
      ) : n.hasChildren && nested ? (
        <Pressable onPress={() => onOpen(n)} hitSlop={10} style={styles.openBtn} accessibilityLabel={`Open ${n.name}`}>
          <Icon name="chevron-right" size={24} color={c.muted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

/** Where you are: All folders › Android › media. Tap a crumb to go back up. */
function PathBar({ rootLabel, trail, disabled, onGo }: { rootLabel: string; trail: FolderNode[]; disabled: boolean; onGo: (depth: number) => void }) {
  const c = usePalette();
  const crumbs = [rootLabel, ...trail.map((n) => n.name)];
  return (
    <View style={[styles.pathBar, { borderColor: c.line }]}>
      <Pressable
        onPress={() => onGo(Math.max(0, trail.length - 1))}
        disabled={disabled || trail.length === 0}
        hitSlop={8}
        accessibilityLabel="Up one folder"
        style={{ opacity: trail.length === 0 ? 0.3 : 1 }}
      >
        <Icon name="arrow-up" size={20} color={c.accent} />
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
        {crumbs.map((name, i) => {
          const last = i === crumbs.length - 1;
          return (
            <View key={`${i}:${name}`} style={styles.crumbs}>
              {i > 0 ? <Icon name="chevron-right" size={16} color={c.faint} /> : null}
              <Pressable onPress={() => onGo(i)} disabled={disabled || last} hitSlop={6}>
                <Txt v="smallStrong" color={last ? c.ink : c.accent} numberOfLines={1}>
                  {name}
                </Txt>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  subRow: { marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  pathBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 20, paddingRight: 10 },
  boxSpace: { width: 22, alignItems: 'center' },
  openBtn: { padding: 6 },
  // Same footprint as the 24px chevron, so the row doesn't shift.
  openSpinner: { width: 24, height: 24 },
  message: { padding: 20 },
});
