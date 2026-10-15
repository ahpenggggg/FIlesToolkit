import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ui.lastPath';
let stored: Promise<string | null> | null = null;

/** The screen that was open when the app was last used (read once per launch). */
export function readLastPath(): Promise<string | null> {
  stored ??= AsyncStorage.getItem(KEY).catch(() => null);
  return stored;
}

/** Remembers the open screen; waits for the launch read so it can't be overwritten first. */
export function rememberPath(path: string) {
  readLastPath()
    .then(() => AsyncStorage.setItem(KEY, path))
    .catch(() => {});
}
