import { useEffect, useRef, useState } from 'react';
import { errorMessage, isCancelled } from '@/lib/errors';
import type { Progress } from '@/ui';
import { Archiver, isPasswordError } from './engine';

export interface JobOutcome {
  text: string;
  tone: 'good' | 'warn';
}

/** One create or extract at a time: progress, cancel, and how it ended. */
export function useArchiveJob() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({ stage: '', done: 0, total: 0, unit: 'bytes' });
  const [outcome, setOutcome] = useState<JobOutcome | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const sub = Archiver?.addListener('onArchiveProgress', (e) => {
      if (active.current) setProgress({ ...e, unit: 'bytes' });
    });
    return () => sub?.remove();
  }, []);

  /** Runs `job`; its result becomes the outcome text. Errors become a warning outcome. */
  const run = async <T,>(stage: string, job: () => Promise<T>, describe: (result: T) => string) => {
    active.current = true;
    setRunning(true);
    setOutcome(null);
    setProgress({ stage, done: 0, total: 0, unit: 'bytes' });
    try {
      setOutcome({ text: describe(await job()), tone: 'good' });
    } catch (e) {
      const text = isCancelled(e)
        ? 'Stopped. Anything half-written was removed.'
        : isPasswordError(e)
          ? errorMessage(e, 'Wrong password.')
          : `Couldn't finish: ${errorMessage(e)}`;
      setOutcome({ text, tone: 'warn' });
    } finally {
      active.current = false;
      setRunning(false);
    }
  };

  return { running, progress, outcome, setOutcome, run, cancel: () => Archiver?.cancel() };
}

export type ArchiveJob = ReturnType<typeof useArchiveJob>;
