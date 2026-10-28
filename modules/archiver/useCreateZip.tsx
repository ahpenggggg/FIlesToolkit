import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { bytes, listSummary } from '@/lib/format';
import { Card, Divider, PasswordField, SectionLabel, Segmented, TextField, ToggleRow, Txt, usePalette, type Action } from '@/ui';
import { baseName, cleanNameInput, createStorageFolderSource, ensureAllFilesAccess, parentOf, storagePathLabel } from '../folder-access';
import { FolderPickerSheet, FolderScopeCard, type FolderSource } from '../folder-picker';
import { Archiver } from './engine';
import { SPLIT_PRESETS, defaultZipName, splitBytes } from './naming';
import type { ArchiverSettings } from './settings';
import type { ArchiveJob } from './useArchiveJob';

const LEVELS = [
  { key: 'store', label: 'Store', note: 'No compression: fastest, largest' },
  { key: 'fast', label: 'Fast', note: 'Quick, a little smaller' },
  { key: 'normal', label: 'Normal', note: 'Good balance of size and speed' },
  { key: 'max', label: 'Max', note: 'Smallest, slowest' },
] as const;

/** Create ZIP: choose items, name and place the ZIP, then compression, password and split options. */
export function useCreateZip(settings: ArchiverSettings, setSettings: (change: Partial<ArchiverSettings>) => void, job: ArchiveJob) {
  const c = usePalette();
  const [items, setItems] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [passwordOn, setPasswordOn] = useState(false);
  const [password, setPassword] = useState('');
  /** Which picker is open: the items, or where to save. */
  const [picker, setPicker] = useState<{ kind: 'items' | 'folder'; source: FolderSource } | null>(null);

  const open = (kind: 'items' | 'folder') => {
    if (ensureAllFilesAccess()) setPicker({ kind, source: createStorageFolderSource(kind === 'items' ? { files: 'all' } : {}) });
  };

  const chooseItems = (ids: string[]) => {
    setPicker(null);
    setItems(ids);
    job.setOutcome(null);
    // Name and place the ZIP after the items until the user picks something else.
    if (ids.length > 0) {
      setName((n) => n || defaultZipName(ids));
      setFolder((f) => f ?? parentOf(ids[0]));
    }
  };

  const split = settings.split ? splitBytes(settings.splitPreset, settings.customMb) : 0;
  const zipName = name.trim().replace(/\.zip$/i, '');

  const create = () =>
    job.run(
      'Adding files',
      () =>
        Archiver!.create({
          items,
          folder: folder!,
          name: zipName,
          level: settings.level,
          password: passwordOn ? password : '',
          splitSize: split ?? 0,
        }),
      (r) => `Created ${r.name}${r.parts > 1 ? ` in ${r.parts} parts` : ''} · ${bytes(r.size)} · in ${storagePathLabel(parentOf(r.path))}.`,
    );

  // The bottom button offers the next step.
  const action: Action = job.running
    ? { label: 'Working…', disabled: true }
    : items.length === 0
      ? { label: 'Choose items', icon: 'file-multiple-outline', onPress: () => open('items') }
      : !folder
        ? { label: 'Choose where to save', icon: 'folder-download-outline', onPress: () => open('folder') }
        : zipName === ''
          ? { label: 'Name the ZIP', disabled: true }
          : passwordOn && password === ''
            ? { label: 'Enter a password', disabled: true }
            : split == null
              ? { label: 'Enter a part size', disabled: true }
              : { label: 'Create ZIP', icon: 'zip-box-outline', onPress: create };

  const summary = items.length === 0 ? 'Nothing chosen' : listSummary(items.map(baseName));

  const content = (
    <>
      <FolderScopeCard
        label="Items"
        icon="file-multiple-outline"
        summary={summary}
        chosen={items.length > 0}
        caption="Folders are added with everything inside."
        prompt="Choose the files and folders to put in the ZIP."
        onPress={() => open('items')}
        disabled={job.running}
      />

      <FolderScopeCard
        label="Save to"
        icon="folder-download-outline"
        summary={folder ? storagePathLabel(folder) : 'No folder chosen'}
        chosen={folder != null}
        caption="The ZIP is saved here; an existing name gets a number added."
        prompt="Choose where to save the ZIP. It defaults to the folder of the first item."
        onPress={() => open('folder')}
        disabled={job.running}
      />

      <Card>
        <SectionLabel>ZIP name</SectionLabel>
        <View style={styles.nameRow}>
          <TextField
            value={name}
            onChangeText={(t) => setName(cleanNameInput(t))}
            placeholder="e.g. Photos"
            maxLength={120}
            autoCapitalize="none"
            autoCorrect={false}
            disabled={job.running}
            style={{ flex: 1 }}
          />
          <Txt v="mono" color={c.muted}>
            .zip
          </Txt>
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <SectionLabel>Compression</SectionLabel>
        <Segmented
          options={LEVELS.map((l) => ({ key: l.key, label: l.label }))}
          value={settings.level}
          onChange={(level) => setSettings({ level })}
          disabled={job.running}
        />
        <Txt v="caption" color={c.muted}>
          {LEVELS.find((l) => l.key === settings.level)!.note}
        </Txt>
        <Divider />
        <ToggleRow
          label="Password"
          icon="lock-outline"
          subtitle="Encrypts every file with AES-256. The password is needed to open them."
          value={passwordOn}
          onChange={setPasswordOn}
          disabled={job.running}
        />
        {passwordOn ? <PasswordField value={password} onChangeText={setPassword} disabled={job.running} /> : null}
        <Divider />
        <ToggleRow
          label="Split into parts"
          icon="call-split"
          subtitle="For big archives: name.z01, name.z02 … name.zip. Keep all parts together to open it."
          value={settings.split}
          onChange={(v) => setSettings({ split: v })}
          disabled={job.running}
        />
        {settings.split ? (
          <>
            <Segmented
              options={SPLIT_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
              value={settings.splitPreset}
              onChange={(splitPreset) => setSettings({ splitPreset })}
              disabled={job.running}
            />
            {settings.splitPreset === 'custom' ? (
              <View style={styles.nameRow}>
                <TextField
                  value={settings.customMb}
                  onChangeText={(t) => setSettings({ customMb: t.replace(/[^0-9.,]/g, '') })}
                  placeholder="Part size"
                  keyboardType="decimal-pad"
                  disabled={job.running}
                  style={{ flex: 1 }}
                />
                <Txt v="mono" color={c.muted}>
                  MB
                </Txt>
              </View>
            ) : null}
          </>
        ) : null}
      </Card>

      {picker?.kind === 'items' ? (
        <FolderPickerSheet
          title="Choose items"
          source={picker.source}
          mode="multiple"
          selectable="both"
          subfolderToggle={false}
          initialIds={items.length ? items : null}
          onClose={() => setPicker(null)}
          onConfirm={chooseItems}
        />
      ) : null}
      {picker?.kind === 'folder' ? (
        <FolderPickerSheet
          title="Save the ZIP in"
          source={picker.source}
          mode="single"
          initialIds={folder ? [folder] : null}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => {
            setPicker(null);
            if (ids[0]) setFolder(ids[0]);
          }}
        />
      ) : null}
    </>
  );

  return { content, action };
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
