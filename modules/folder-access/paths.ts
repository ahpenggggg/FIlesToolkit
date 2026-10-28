/** The last part of a path: "/storage/emulated/0/Download/a.zip" gives "a.zip". */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The folder an item sits in. */
export function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}
