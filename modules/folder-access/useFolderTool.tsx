import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { usePersistentState } from '@/lib/settings';
import { isBlocked, useBlockingTool, useTaskLock } from '@/lib/tasks';
import type { ToolKey } from '@/tools';
import type { Progress } from '@/ui';
import { FolderPickerSheet, FolderScopeCard, type FolderSource } from '../folder-picker';
import { FolderAccess, READ_FAILED, ensureAllFilesAccess, type RenameRequest } from './native';
import { createStorageFolderSource, storagePathLabel } from './storageSource';

/** The chosen folder, remembered between launches but only read when the user asks. */
export interface SavedFolder {
  uri: string | null;
  /** Its name from the last read (iOS shows it, as its bookmark has no readable path). */
  name: string | null;
}

interface Options<T> {
  /** The tool using it, for the one-task-at-a-time lock. */
  tool: ToolKey;
  /** Where the chosen folder is remembered. */
  storageKey: string;
  /** Tags this tool's rename progress events. */
  task: string;
  noun: string;
  plural: string;
  /** Title of the folder picker. */
  chooseTitle: string;
  /** Folders card text once a folder is chosen, and while none is. */
  caption: string;
  prompt: string;
  /** Progress label while the folder is read. */
  readStage: string;
  /** Reads the chosen folder; its result becomes `data`. */
  read: (uri: string) => Promise<T>;
}

/**
 * Everything the rename tools share: the Folders card and picker (one folder), reading the folder
 * when the user taps Scan (never on launch or on choosing), progress, and the two-phase rename
 * followed by a fresh read.
 */
export function useFolderTool<T extends { rootName: string }>(options: Options<T>) {
  const [folder, setFolder] = usePersistentState<SavedFolder>(options.storageKey, { uri: null, name: null });
  const [data, setData] = useState<T | null>(null);
  /** True once a read has run, so a folder that was never read isn't reported as broken. */
  const [attempted, setAttempted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: '', done: 0, total: 0 });
  /** Set while the picker is open; a fresh source each time so new folders show up. */
  const [picker, setPicker] = useState<FolderSource | null>(null);
  /** Progress events only count while a job is running. */
  const tracking = useRef(false);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  /** Feeds a progress event from the tool's own native module. */
  const track = useCallback((e: Progress) => {
    if (tracking.current) setProgress({ stage: e.stage, done: e.done, total: e.total });
  }, []);

  useEffect(() => {
    const sub = FolderAccess.addListener('onRenameProgress', (e) => {
      if (e.task === latest.current.task) track(e);
    });
    return () => sub.remove();
  }, [track]);

  const read = useCallback(
    async (uri: string) => {
      if (!ensureAllFilesAccess()) return;
      setAttempted(true);
      setScanning(true);
      setData(null);
      tracking.current = true;
      setProgress({ stage: latest.current.readStage, done: 0, total: 0 });
      try {
        const result = await latest.current.read(uri);
        setData(result);
        setFolder({ uri, name: result.rootName });
      } catch {
        setData(null);
        setMessage(READ_FAILED);
      } finally {
        tracking.current = false;
        setScanning(false);
      }
    },
    [setFolder],
  );

  /** Reads the chosen folder (Scan / Rescan). */
  const scan = () => {
    if (!folder.uri || isBlocked(latest.current.tool)) return;
    setMessage(null);
    read(folder.uri);
  };

  /** A new folder replaces the old one and its results; it is read when the user taps Scan. */
  const pick = (uri: string) => {
    setPicker(null);
    setFolder({ uri, name: Platform.OS === 'android' ? uri.slice(uri.lastIndexOf('/') + 1) : null });
    setData(null);
    setAttempted(false);
    setMessage(null);
  };

  const choose = () => {
    if (Platform.OS !== 'android') {
      // iOS has no shared storage to browse: use the Files folder picker.
      FolderAccess.pickFolder()
        .then((picked) => picked && pick(picked.uri))
        .catch((e) => Alert.alert('Folder access', String((e as Error).message ?? e)));
      return;
    }
    if (ensureAllFilesAccess()) setPicker(createStorageFolderSource({ protect: true }));
  };

  /** Renames the items, shows the outcome and reads the folder again. */
  const rename = async (items: RenameRequest[]) => {
    if (!folder.uri || items.length === 0 || isBlocked(latest.current.tool)) return;
    const uri = folder.uri;
    const { task, noun, plural } = latest.current;
    setRenaming(true);
    setMessage(null);
    tracking.current = true;
    setProgress({ stage: `Preparing ${plural}`, done: 0, total: items.length });
    let result: string;
    try {
      result = await FolderAccess.renameDocuments({ treeUri: uri, task, noun, plural, items });
    } catch {
      result = `Rename stopped before completion. Some ${plural} may need a rescan.`;
    }
    tracking.current = false;
    setRenaming(false);
    setMessage(result);
    await read(uri);
  };

  const busy = scanning || renaming;
  useTaskLock(options.tool, busy);
  /** Another tool's task is running, so this one can't scan or rename yet. */
  const blocked = useBlockingTool(options.tool) != null;
  const summary = !folder.uri
    ? 'No folder chosen'
    : Platform.OS === 'android'
      ? storagePathLabel(folder.uri)
      : (folder.name ?? 'Chosen folder');

  const card = (
    <>
      <FolderScopeCard summary={summary} chosen={folder.uri != null} caption={options.caption} prompt={options.prompt} onPress={choose} disabled={busy} />
      {picker ? (
        <FolderPickerSheet
          title={options.chooseTitle}
          source={picker}
          mode="single"
          initialIds={folder.uri ? [folder.uri] : null}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => ids[0] && pick(ids[0])}
        />
      ) : null}
    </>
  );

  return {
    blocked,
    folder,
    chosen: folder.uri != null,
    data,
    setData,
    attempted,
    scanning,
    renaming,
    busy,
    message,
    progress,
    track,
    choose,
    scan,
    rename,
    card,
  };
}
