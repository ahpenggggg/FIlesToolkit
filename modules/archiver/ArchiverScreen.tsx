import { usePersistentState } from '@/lib/settings';
import { useTaskLock } from '@/lib/tasks';
import { ActionButton, Hero, Notice, ProgressCard, Segmented, ToolScreen } from '@/ui';
import { DEFAULT_ARCHIVER_SETTINGS, type ArchiverSettings } from './settings';
import { useArchiveJob } from './useArchiveJob';
import { useCreateZip } from './useCreateZip';
import { useExtractArchive } from './useExtractArchive';

export default function ArchiverScreen() {
  const [settings, setAll] = usePersistentState<ArchiverSettings>('archives.settings', DEFAULT_ARCHIVER_SETTINGS);
  const setSettings = (change: Partial<ArchiverSettings>) => setAll((s) => ({ ...s, ...change }));
  const job = useArchiveJob();
  useTaskLock('archives', job.running);
  const create = useCreateZip(settings, setSettings, job);
  const extract = useExtractArchive(settings, setSettings, job);
  const pane = settings.mode === 'create' ? create : extract;

  return (
    <ToolScreen tool="archives" action={<ActionButton action={pane.action} />}>
      <Hero
        title="Zip it up, or unpack it."
        body="Create ZIP files, with a password or split into parts, and extract ZIP, RAR and 7Z archives, password-protected ones too."
      />
      <Segmented
        options={[
          { key: 'create', label: 'Create ZIP' },
          { key: 'extract', label: 'Extract' },
        ]}
        value={settings.mode}
        onChange={(mode) => {
          job.setOutcome(null);
          setSettings({ mode });
        }}
        disabled={job.running}
      />
      {job.running ? <ProgressCard progress={job.progress} onCancel={job.cancel} /> : null}
      {job.outcome ? <Notice tone={job.outcome.tone === 'good' ? 'accent' : 'warn'} message={job.outcome.text} /> : null}
      {pane.content}
    </ToolScreen>
  );
}
