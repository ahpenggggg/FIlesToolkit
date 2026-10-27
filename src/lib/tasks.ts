import { useEffect, useSyncExternalStore } from 'react';
import type { ToolKey } from '@/tools';

/**
 * The one long task allowed at a time, app-wide: a scan, compression, rename, delete or archive job.
 * Tool screens stay mounted while you're elsewhere (see app/_layout.tsx), so a running task keeps
 * its progress; other tools can't start a task until it ends.
 */
let running: ToolKey | null = null;
const listeners = new Set<() => void>();

function setRunning(next: ToolKey | null) {
  if (running === next) return;
  running = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tool whose task is running, if any. */
export function useRunningTool(): ToolKey | null {
  return useSyncExternalStore(subscribe, () => running);
}

/** Another tool's running task, which keeps [tool] from starting one. */
export function useBlockingTool(tool: ToolKey): ToolKey | null {
  const current = useRunningTool();
  return current != null && current !== tool ? current : null;
}

/** For event handlers: true while another tool's task is running. */
export function isBlocked(tool: ToolKey) {
  return running != null && running !== tool;
}

/** Reports whether [tool] is running a task right now. */
export function useTaskLock(tool: ToolKey, busy: boolean) {
  useEffect(() => {
    if (busy) setRunning(tool);
    else if (running === tool) setRunning(null);
  }, [tool, busy]);
  useEffect(
    () => () => {
      if (running === tool) setRunning(null);
    },
    [tool],
  );
}
