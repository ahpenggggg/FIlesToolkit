import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { bytes } from '@/lib/format';
import { Button, Card, Divider, Icon, Notice, SectionLabel, Segmented, TextField, Txt, usePalette, type Action } from '@/ui';
import { createStorageFolderSource, ensureAllFilesAccess, storagePathLabel } from '../folder-access';
import { FolderPickerSheet, FolderScopeCard, type FolderSource } from '../folder-picker';
import { Archiver, isPasswordError, type ArchiveInfo } from './engine';
import { archiveBaseName, isArchiveName, parentOf } from './naming';
import type { ArchiverSettings } from './settings';
import type { ArchiveJob } from './useArchiveJob';

const PREVIEW_ROWS = 6;

/** Extract: choose an archive (its contents are listed), a password if needed, where and how to extract. */
export function useExtractArchive(settings: ArchiverSettings, setSettings: (change: Partial<ArchiverSettings>) => void, job: ArchiveJob) {
  const c = usePalette();
  const [archive, setArchive] = useState<string | null>(null);
  const [info, setInfo] = useState<ArchiveInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  /** Where to extract; defaults to the archive's folder. */
  const [base, setBase] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<{ kind: 'archive' | 'folder'; source: FolderSource } | null>(null);

  const open = (kind: 'archive' | 'folder') => {
    if (ensureAllFilesAccess()) setPicker({ kind, source: createStorageFolderSource(kind === 'archive' ? { files: isArchiveName } : {}) });
  };

  /** Lists the archive's contents (also used to unlock one whose names are encrypted). */
  const read = async (path: string, pwd: string) => {
    setReading(true);
    setReadError(null);
    try {
      setInfo(await Archiver!.inspect(path, pwd));
    } catch (e) {
      setInfo(null);
      setReadError(isPasswordError(e) ? 'Wrong password.' : `Couldn't read this archive: ${String((e as Error).message ?? e)}`);
    } finally {
      setReading(false);
    }
  };

  const chooseArchive = (path: string) => {
    setPicker(null);
    setArchive(path);
    setBase(parentOf(path));
    setPassword('');
    setExpanded(false);
    job.setOutcome(null);
    // Choosing an archive lists what's in it; nothing is extracted until Extract is tapped.
    read(path, '');
  };

  const archiveName = archive ? archive.slice(archive.lastIndexOf('/') + 1) : '';
  const folderName = archiveBaseName(archiveName);
  const destination = base ? (settings.extractInto === 'folder' ? `${base}/${folderName}` : base) : null;
  const locked = info?.needsPassword ?? false;

  const extract = () =>
    job.run(
      'Extracting',
      () =>
        Archiver!.extract({
          archive: archive!,
          destination: base!,
          newFolder: settings.extractInto === 'folder' ? folderName : '',
          password,
          conflict: settings.conflict,
        }),
      (r) =>
        `Extracted ${r.extracted} file${r.extracted === 1 ? '' : 's'} to ${storagePathLabel(r.destination)}` +
        (r.skipped > 0 ? ` · ${r.skipped} skipped (already there)` : '') +
        '.',
    );

  // The bottom button offers the next step.
  const action: Action = job.running
    ? { label: 'Working…', disabled: true }
    : !archive
      ? { label: 'Choose archive', icon: 'zip-box-outline', onPress: () => open('archive') }
      : reading
        ? { label: 'Reading archive…', disabled: true }
        : locked || readError
          ? password === ''
            ? { label: 'Enter the password', disabled: true }
            : { label: 'Unlock', icon: 'lock-open-variant-outline', onPress: () => read(archive, password) }
          : info?.encrypted && password === ''
            ? { label: 'Enter the password', disabled: true }
            : { label: 'Extract', icon: 'package-variant', onPress: extract };

  const files = (info?.items ?? []).filter((i) => !i.isDirectory);
  const shown = expanded ? files : files.slice(0, PREVIEW_ROWS);

  const content = (
    <>
      <FolderScopeCard
        label="Archive"
        icon="zip-box-outline"
        summary={archive ? archiveName : 'No archive chosen'}
        chosen={archive != null}
        caption={
          reading
            ? 'Reading…'
            : info && !locked
              ? `${info.format} · ${info.fileCount} file${info.fileCount === 1 ? '' : 's'} · ${bytes(info.totalSize)}${info.parts > 1 ? ` · ${info.parts} parts` : ''}${info.encrypted ? ' · password protected' : ''}`
              : locked
                ? `${info!.format} · password protected, contents hidden`
                : ''
        }
        prompt="Choose a ZIP, RAR or 7Z file. For split archives choose the first part: the .zip, the .part1.rar or the .001."
        onPress={() => open('archive')}
        disabled={job.running}
      >
        {readError ? <Notice tone="warn" message={readError} /> : null}
      </FolderScopeCard>

      {archive && (locked || info?.encrypted || isPasswordReadError(readError)) ? (
        <Card>
          <SectionLabel>Password</SectionLabel>
          <View style={styles.row}>
            <TextField
              value={password}
              onChangeText={setPassword}
              placeholder="Archive password"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              disabled={job.running}
              style={{ flex: 1 }}
            />
            <Button label={showPassword ? 'Hide' : 'Show'} variant="ghost" size="sm" onPress={() => setShowPassword((s) => !s)} />
          </View>
          <Txt v="caption" color={c.muted}>
            {locked ? 'Even the file names are encrypted. Enter the password and tap Unlock.' : 'Needed to extract the encrypted files.'}
          </Txt>
        </Card>
      ) : null}

      {info && files.length > 0 ? (
        <Card style={{ gap: 6 }}>
          <SectionLabel>{`Contents · ${info.fileCount}`}</SectionLabel>
          {shown.map((f, i) => (
            <View key={`${i}:${f.name}`}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.entry}>
                <Icon name="file-outline" size={18} color={c.muted} />
                <Txt v="small" numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>
                  {f.name}
                </Txt>
                <Txt v="caption" color={c.muted}>
                  {bytes(f.size)}
                </Txt>
              </View>
            </View>
          ))}
          {files.length > PREVIEW_ROWS ? (
            <Pressable onPress={() => setExpanded((e) => !e)} style={styles.row}>
              <Txt v="smallStrong" color={c.accent}>
                {expanded ? 'Show fewer' : `Show all ${files.length}${info.fileCount > files.length ? ` of ${info.fileCount}` : ''}`}
              </Txt>
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.accent} />
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {archive ? (
        <>
          <FolderScopeCard
            label="Extract to"
            icon="folder-download-outline"
            summary={destination ? storagePathLabel(destination) : 'No folder chosen'}
            chosen={destination != null}
            caption={
              settings.extractInto === 'folder'
                ? `A new folder named “${folderName}” is made for the files (with a number added if that name is taken).`
                : 'Files go straight into this folder.'
            }
            prompt="Choose where to extract the files."
            onPress={() => open('folder')}
            disabled={job.running}
          />
          <Card style={{ gap: 12 }}>
            <SectionLabel>Options</SectionLabel>
            <Segmented
              options={[
                { key: 'folder', label: 'New folder' },
                { key: 'here', label: 'Here' },
              ]}
              value={settings.extractInto}
              onChange={(extractInto) => setSettings({ extractInto })}
              disabled={job.running}
            />
            <Txt v="smallStrong">If a file already exists</Txt>
            <Segmented
              options={[
                { key: 'keep', label: 'Keep both' },
                { key: 'replace', label: 'Replace' },
                { key: 'skip', label: 'Skip' },
              ]}
              value={settings.conflict}
              onChange={(conflict) => setSettings({ conflict })}
              disabled={job.running}
            />
          </Card>
        </>
      ) : null}

      {picker?.kind === 'archive' ? (
        <FolderPickerSheet
          title="Choose an archive"
          source={picker.source}
          mode="single"
          selectable="files"
          initialIds={archive ? [archive] : null}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => ids[0] && chooseArchive(ids[0])}
        />
      ) : null}
      {picker?.kind === 'folder' ? (
        <FolderPickerSheet
          title="Extract into"
          source={picker.source}
          mode="single"
          initialIds={base ? [base] : null}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => {
            setPicker(null);
            if (ids[0]) setBase(ids[0]);
          }}
        />
      ) : null}
    </>
  );

  return { content, action };
}

function isPasswordReadError(error: string | null) {
  return error === 'Wrong password.';
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
});
