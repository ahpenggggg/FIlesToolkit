export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  return `${Math.round(n / 1024)} KB`;
}

export function duration(ms: number): string | null {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s / 60) % 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function percentSaved(before: number, after: number): number {
  return before > 0 ? Math.round((1 - after / before) * 100) : 0;
}

/** "1 file", "3 files"; `many` for irregular words, e.g. plural(n, 'folder has', 'folders have'). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The first `shown` names, then how many more: "a, b +3 more". */
export function listSummary(names: string[], shown = 2): string {
  return names.length <= shown ? names.join(', ') : `${names.slice(0, shown).join(', ')} +${names.length - shown} more`;
}
