import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, PermissionsAndroid, Platform, Pressable, StyleSheet, View } from 'react-native';
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
  ProgressBar,
  SectionLabel,
  ToggleRow,
  ToolScreen,
  Txt,
  radius,
  usePalette,
  type Action,
} from '@/ui';
import { bytes, duration, percentSaved } from '@/lib/format';
import { usePersistentState } from '@/lib/settings';
import { useTaskLock } from '@/lib/tasks';
import { MediaLibrary, isCancelled, trashName, useMediaScope } from '../media-library';
import { Compressor, type VideoAsset } from './engine';
import { AUTO_MIN_VIDEO_BYTES, HANDBRAKE, outputSize, skipReason } from './plan';
import { DEFAULT_COMPRESS_SETTINGS, type CompressSettings } from './settings';

type JobStatus =
  | { kind: 'pending' }
  | { kind: 'working'; progress: number | null }
  | { kind: 'done'; newId: string; newSize: number; note: string; review: string | null; finalName: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

type Phase = 'browse' | 'running' | 'done';
const KEEP_AWAKE_TAG = 'filetoolkit-compress';

export default function CompressScreen() {
  const c = usePalette();
  const [settings, setSettings] = usePersistentState<CompressSettings>('compress.settings.v2', DEFAULT_COMPRESS_SETTINGS);
  /** null = loading. */
  const [videos, setVideos] = useState<VideoAsset[] | null>(null);
  /** False until the user asks for the list, so nothing is read on open. */
  const [listed, setListed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, JobStatus>>({});
  const [phase, setPhase] = useState<Phase>('browse');
  const cancelled = useRef(false);
  useTaskLock('compress', phase === 'running');

  const skips = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const v of videos ?? []) m.set(v.id, skipReason(v));
    return m;
  }, [videos]);

  const selected = useMemo(() => new Set([...picked].filter((id) => skips.get(id) == null)), [picked, skips]);
  const setSelected = setPicked;

  const scope = useMediaScope({
    kind: 'video',
    folderIds: settings.folderIds,
    includeSubfolders: settings.includeSubfolders,
    onChange: (folderIds, includeSubfolders) => {
      // New folders replace the old list; it is read again when the user taps Find videos.
      setSettings((s) => ({ ...s, folderIds, includeSubfolders }));
      setVideos(null);
      setStatus({});
      setPicked(new Set());
      setListed(false);
    },
    deniedMessage: 'Allow access to your videos to compress them.',
    caption: 'Videos over 5 MB in these folders are listed.',
    prompt: 'Choose all folders or specific ones to list their videos over 5 MB.',
  });

  /** Clears results and reads the video list again. Only ever runs when the user asks. */
  const listVideos = () =>
    scope.withAccess(async () => {
      const { folderIds, includeSubfolders } = settings;
      if (folderIds == null) return;
      setVideos(null);
      setStatus({});
      setPicked(new Set());
      setPhase('browse');
      setListed(true);
      try {
        setVideos(await Compressor.listVideos({ folderIds, includeSubfolders, minSize: AUTO_MIN_VIDEO_BYTES }));
      } catch (e) {
        Alert.alert('Could not read videos', String((e as Error).message ?? e));
        setVideos([]);
      }
    });

  useEffect(() => {
    const sub = Compressor.addListener('onCompressProgress', (e) =>
      setStatus((s) => ({ ...s, [e.id]: { kind: 'working', progress: e.progress } })),
    );
    return () => sub.remove();
  }, []);

  const toggle = (id: string) => {
    if (phase !== 'browse' || skips.get(id)) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const compressible = (videos ?? []).filter((v) => skips.get(v.id) == null);
  const allOn = compressible.length > 0 && compressible.every((v) => selected.has(v.id));
  const chosen = (videos ?? []).filter((v) => selected.has(v.id));
  const before = chosen.reduce((n, v) => n + v.size, 0);

  const savedBytes = chosen.reduce((n, v) => {
    const s = status[v.id];
    return s?.kind === 'done' && !s.review ? n + v.size - s.newSize : n;
  }, 0);

  const start = async () => {
    cancelled.current = false;
    setPhase('running');
    // The progress notification needs this on Android 13+; compressing works either way.
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
    }
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    Compressor.beginSession(`${chosen.length} video${chosen.length === 1 ? '' : 's'} queued`);
    const results: Record<string, JobStatus> = {};
    try {
      for (const [i, v] of chosen.entries()) {
        if (cancelled.current) break;
        setStatus((s) => ({ ...s, [v.id]: { kind: 'working', progress: null } }));
        let st: JobStatus;
        try {
          const r = await Compressor.compressVideo({ id: v.id, label: `${i + 1} of ${chosen.length}` });
          if (r.status === 'compressed') {
            const parts = [
              r.codec,
              v.rotation === 90 || v.rotation === 270 ? `${r.height}×${r.width}` : `${r.width}×${r.height}`,
              r.match != null ? `match ${r.match.toFixed(2)}` : null,
              r.savedTo ? `saved to ${r.savedTo}` : null,
            ].filter(Boolean);
            st = { kind: 'done', newId: r.newId, newSize: r.newSize, note: parts.join(' · '), review: r.review, finalName: r.finalName };
          } else {
            st = { kind: r.status, reason: r.reason };
          }
        } catch (e) {
          st = isCancelled(e) ? { kind: 'skipped', reason: 'Cancelled' } : { kind: 'failed', reason: String((e as Error).message ?? e) };
        }
        results[v.id] = st;
        setStatus((s) => ({ ...s, [v.id]: st }));
      }
    } finally {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      Compressor.endSession();
    }
    setPhase('done');
    await replaceOriginals(results, settings.deleteOriginals);
  };

  const replaceOriginals = async (results: Record<string, JobStatus>, deleteOriginals: boolean) => {
    const done = Object.entries(results).filter(
      (e): e is [string, Extract<JobStatus, { kind: 'done' }>] => e[1].kind === 'done' && !(e[1] as { review: string | null }).review,
    );
    if (done.length === 0) {
      const anyReview = Object.values(results).some((s) => s.kind === 'done');
      if (!anyReview) Alert.alert('Nothing replaced', 'Nothing could be compressed by at least 1 MB.');
      return;
    }
    if (!deleteOriginals) {
      Alert.alert('Done', `${done.length} compressed · originals kept${Platform.OS === 'android' ? ' · copies in Download/Compressed' : ''}`);
      return;
    }
    try {
      const ok = await MediaLibrary.trash(done.map(([id]) => id));
      if (ok) {
        await Compressor.finalizeNames(done.map(([, s]) => ({ id: s.newId, name: s.finalName }))).catch(() => {});
        const saved = done.reduce((n, [id, s]) => n + ((videos ?? []).find((v) => v.id === id)?.size ?? 0) - s.newSize, 0);
        Alert.alert('Done', `${done.length} replaced · ${bytes(saved)} saved · originals in ${trashName()}`);
      } else {
        Alert.alert('Originals kept', 'Both versions are now in your gallery.');
      }
    } catch (e) {
      Alert.alert('Could not remove originals', String((e as Error).message ?? e));
    }
  };

  const cancel = () => {
    cancelled.current = true;
    Compressor.cancel();
  };

  const visible = phase === 'browse' ? videos ?? [] : chosen;
  const browsing = phase === 'browse';
  // What rows draw besides the video itself, so the list redraws them when it changes.
  const rowState = useMemo(() => ({ selected, status, browsing }), [selected, status, browsing]);

  const header = (
    <View style={{ gap: 12, paddingBottom: 4 }}>
      {browsing ? (
        <>
          <Hero
            title="Shrink big videos."
            body={`Re-encodes videos the way HandBrake does with its default preset at 720p and RF ${HANDBRAKE.rf} (x264). It takes a while, keeps going in the background with a notification, and keeps a result only if it saves at least 10%. Everything runs on your phone.`}
          />
          {scope.card}
        </>
      ) : null}

      {browsing ? (
        <Card style={{ gap: 12 }}>
          <SectionLabel>HandBrake settings</SectionLabel>
          <Txt v="small">{HANDBRAKE.summary}</Txt>
          <Divider />
          <ToggleRow
            label="Delete originals"
            icon="trash-can-outline"
            subtitle={
              settings.deleteOriginals
                ? `After a successful compression, the original goes to ${trashName()}`
                : 'Keep originals alongside the compressed copies'
            }
            value={settings.deleteOriginals}
            onChange={(v) => setSettings((s) => ({ ...s, deleteOriginals: v }))}
          />
        </Card>
      ) : null}

      {videos != null && videos.length > 0 ? (
        <SectionLabel
          style={{ marginTop: 6 }}
          right={
            browsing && compressible.length > 0 ? (
              <Button
                label={allOn ? 'Clear' : 'Select all'}
                variant="ghost"
                size="sm"
                onPress={() => setSelected(allOn ? new Set() : new Set(compressible.map((v) => v.id)))}
              />
            ) : null
          }
        >
          {browsing ? `Videos over 5 MB · ${videos.length}` : `Queue · ${chosen.length}`}
        </SectionLabel>
      ) : null}
    </View>
  );

  // The bottom button always offers the next step: Choose folders → Find videos → Compress.
  const browseAction: Action = !scope.chosen
    ? { label: 'Choose folders', icon: 'folder-multiple-outline', onPress: scope.open }
    : !listed
      ? { label: 'Find videos', icon: 'magnify', onPress: listVideos }
      : videos == null
        ? { label: 'Reading videos…', disabled: true }
        : chosen.length === 0
          ? { label: 'Select videos to compress', disabled: true }
          : { label: `Compress ${chosen.length} · ${bytes(before)}`, icon: 'arrow-collapse-all', onPress: start };

  return (
    <ToolScreen
      tool="compress"
      scroll={false}
      action={
        phase === 'browse' ? (
          <ActionButton action={browseAction} />
        ) : phase === 'running' ? (
          <RunningPanel chosen={chosen} status={status} savedBytes={savedBytes} onCancel={cancel} />
        ) : (
          <DonePanel chosen={chosen} status={status} savedBytes={savedBytes} onDone={listVideos} />
        )
      }
    >
      <FastList
        data={videos == null ? [] : visible}
        keyExtractor={(v) => v.id}
        extraData={rowState}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, flexGrow: 1 }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={Gap}
        backToTop
        labelFor={(v) => v.name}
        ListEmptyComponent={
          !scope.chosen ? (
            <EmptyState icon="folder-search-outline" title="Choose folders first" body="Pick all folders or specific ones to list their videos over 5 MB." />
          ) : !listed ? (
            <EmptyState icon="movie-search-outline" title="Ready when you are" body="Tap Find videos to look for videos over 5 MB in the chosen folders." />
          ) : videos == null ? (
            <View style={styles.loading}>
              <ActivityIndicator color={c.accent} />
              <Txt v="small" color={c.muted}>
                Reading videos…
              </Txt>
            </View>
          ) : (
            <EmptyState icon="movie-search-outline" title="No videos over 5 MB here" />
          )
        }
        renderItem={({ item }) => (
          <VideoRow
            v={item}
            skip={skips.get(item.id) ?? null}
            status={status[item.id] ?? PENDING}
            selected={selected.has(item.id)}
            editable={browsing}
            onToggle={toggle}
          />
        )}
      />
    </ToolScreen>
  );
}

function RunningPanel({ chosen, status, savedBytes, onCancel }: { chosen: VideoAsset[]; status: Record<string, JobStatus>; savedBytes: number; onCancel: () => void }) {
  const c = usePalette();
  const processed = chosen.filter((v) => {
    const k = status[v.id]?.kind;
    return k && k !== 'pending' && k !== 'working';
  }).length;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ActivityIndicator size="small" color={c.accent} />
        <Txt v="bodyStrong" style={{ flex: 1 }}>{`Compressing ${Math.min(processed + 1, chosen.length)} of ${chosen.length}`}</Txt>
        <Txt v="smallStrong" color={c.good}>{`${bytes(savedBytes)} saved`}</Txt>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <ProgressBar progress={chosen.length ? processed / chosen.length : 0} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="bell-outline" size={16} color={c.muted} />
        <Txt v="caption" color={c.muted} style={{ flex: 1 }}>
          Slow but thorough. You can leave the app: progress shows in the notification.
        </Txt>
        <Button label="Cancel" variant="secondary" size="sm" onPress={onCancel} />
      </View>
    </>
  );
}

function DonePanel({ chosen, status, savedBytes, onDone }: { chosen: VideoAsset[]; status: Record<string, JobStatus>; savedBytes: number; onDone: () => void }) {
  const c = usePalette();
  let done = 0;
  let review = 0;
  for (const v of chosen) {
    const s = status[v.id];
    if (s?.kind === 'done') {
      if (s.review) review++;
      else done++;
    }
  }
  const other = chosen.length - done - review;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="check-circle" size={22} color={c.good} />
        <Txt v="bodyStrong" style={{ flex: 1 }}>
          {`${done} compressed · ${bytes(savedBytes)} saved`}
          {review > 0 ? ` · ${review} to review` : ''}
          {other > 0 ? ` · ${other} skipped/failed` : ''}
        </Txt>
      </View>
      <Button label="Done" onPress={onDone} />
    </>
  );
}

const PENDING: JobStatus = { kind: 'pending' };
const Gap = () => <View style={{ height: 8 }} />;

/** The video's system thumbnail, fetched once and cached as a small JPEG (cheap when scrolling fast). */
function useThumbnail(id: string): string | null {
  const [uri, setUri] = useState<{ id: string; uri: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    Compressor.thumbnail(id, 160)
      .then((u) => live && setUri({ id, uri: u }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return uri?.id === id ? uri.uri : null;
}

const VideoRow = memo(function VideoRow({
  v,
  skip,
  status,
  selected,
  editable,
  onToggle,
}: {
  v: VideoAsset;
  skip: string | null;
  status: JobStatus;
  selected: boolean;
  editable: boolean;
  onToggle: (id: string) => void;
}) {
  const c = usePalette();
  const thumb = useThumbnail(v.id);
  const dim = editable && skip != null;
  const short = Math.min(v.codedWidth || v.width, v.codedHeight || v.height);
  return (
    <Pressable
      onPress={() => onToggle(v.id)}
      disabled={!editable || dim}
      style={[styles.row, { backgroundColor: c.surface, borderColor: selected ? c.accent : c.line, opacity: dim ? 0.6 : 1 }]}
    >
      {editable ? <Checkbox checked={selected} disabled={dim} /> : null}
      <View style={[styles.thumb, { backgroundColor: c.sunken }]}>
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={v.id} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="smallStrong" numberOfLines={1}>
          {v.name}
        </Txt>
        <Txt v="caption" color={c.muted}>
          {[bytes(v.size), short > 0 ? `${short}p` : null, duration(v.durationMs)].filter(Boolean).join(' · ')}
        </Txt>
        <StatusLine v={v} skip={skip} status={status} />
      </View>
    </Pressable>
  );
});

function StatusLine({ v, skip, status }: { v: VideoAsset; skip: string | null; status: JobStatus }) {
  const c = usePalette();
  switch (status.kind) {
    case 'pending': {
      if (skip) {
        return (
          <Txt v="caption" color={c.faint} numberOfLines={2}>
            {skip}
          </Txt>
        );
      }
      const out = outputSize(v);
      return <Txt v="caption" color={c.accent} style={{ fontWeight: '700' }}>{`→ ${out.width}×${out.height} · RF ${HANDBRAKE.rf}`}</Txt>;
    }
    case 'working': {
      const p = status.progress;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <ProgressBar progress={p} />
          <Txt v="caption" style={{ fontWeight: '700', minWidth: 64, textAlign: 'right' }}>
            {p == null ? 'Preparing…' : p >= 0.995 ? 'Finishing…' : `${Math.floor(p * 100)}%`}
          </Txt>
        </View>
      );
    }
    case 'done':
      return (
        <>
          <Txt v="caption" color={status.review ? c.warn : c.good} style={{ fontWeight: '700' }}>
            {`→ ${bytes(status.newSize)} (−${percentSaved(v.size, status.newSize)}%)`}
            {status.review ? ' · saved as _compressed copy, original kept' : ''}
          </Txt>
          <Txt v="caption" color={c.muted} style={{ fontSize: 11 }} numberOfLines={3}>
            {status.review ? `${status.review} · ${status.note}` : status.note}
          </Txt>
        </>
      );
    case 'skipped':
      return (
        <Txt v="caption" color={c.muted} numberOfLines={2}>
          {`Skipped: ${status.reason}`}
        </Txt>
      );
    case 'failed':
      return (
        <Txt v="caption" color={c.danger} numberOfLines={2}>
          {`Failed: ${status.reason}`}
        </Txt>
      );
  }
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md + 2,
    borderWidth: 1,
  },
  thumb: { width: 60, height: 60, borderRadius: radius.md, overflow: 'hidden' },
});
