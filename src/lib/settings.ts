import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Small persisted-state hook: behaves like useState, saves to AsyncStorage,
 * and reports `ready` once the stored value has been loaded.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const latest = useRef(value);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!alive || raw == null) return;
        try {
          const parsed = { ...initialAsObject(initial), ...JSON.parse(raw) } as T;
          latest.current = parsed;
          setValue(parsed);
        } catch {
          // ignore corrupt value
        }
      })
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(latest.current) : v;
      latest.current = next;
      setValue(next);
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
    },
    [key],
  );

  return [value, set, ready];
}

function initialAsObject<T>(v: T): object {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as object) : {};
}
