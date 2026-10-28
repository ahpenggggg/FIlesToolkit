/** A copy of `set` with `item` added, or removed when it was there (for selection state). */
export function toggled<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
