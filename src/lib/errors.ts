/** Native modules reject with a code: E_CANCELLED after cancel(), E_PASSWORD for a wrong password, … */
export function hasErrorCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === code;
}

/** True when a native job was stopped with cancel() (its promise rejects with E_CANCELLED). */
export function isCancelled(e: unknown): boolean {
  return hasErrorCode(e, 'E_CANCELLED');
}

/** The message of a rejection, to show to the user; `fallback` (or the value itself) when it has none. */
export function errorMessage(e: unknown, fallback?: string): string {
  const message = (e as { message?: unknown } | null)?.message;
  return String(message ?? fallback ?? e);
}
