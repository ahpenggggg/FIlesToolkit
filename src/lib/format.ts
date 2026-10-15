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
