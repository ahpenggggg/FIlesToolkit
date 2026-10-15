/** Characters that are not allowed in file or folder names. */
export const INVALID_NAME_CHARS = '/\\:*?"<>|';

/** Drops characters a name can't hold (invalid ones and control characters), as they are typed. */
export function cleanNameInput(text: string): string {
  let kept = '';
  for (const c of text) {
    const code = c.charCodeAt(0);
    const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (!INVALID_NAME_CHARS.includes(c) && !control) kept += c;
  }
  return kept;
}
