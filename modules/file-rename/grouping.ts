/**
 * Groups file names that look alike and numbers the names chosen for each group.
 * Pure TypeScript so the rules can be checked without a device. Strings are walked by UTF-16
 * code unit and characters are classified like Java's Character.isLetter / isDigit.
 */

/** A stem this short or longer groups every stem it starts ("photo" takes "photoboth"). */
const MIN_PREFIX_STEM = 3;
/** Stems that share this many leading letters are grouped even when neither contains the other. */
const MIN_SHARED_PREFIX = 5;
/** Names with fewer letters than this have no pattern worth a group of their own. */
export const MIN_PATTERN_LETTERS = 2;

const LETTER = /^\p{L}$/u;
const DIGIT = /^\p{Nd}$/u;

const isLetter = (c: string) => LETTER.test(c);
const isDigit = (c: string) => DIGIT.test(c);
/** Single-character lower case (İ gives i, as in Java's Character.toLowerCase). */
const lowerChar = (c: string) => c.toLowerCase().charAt(0);
const upperChar = (c: string) => c.toUpperCase().charAt(0);

/**
 * The comparable core of a name: its letters, lower-cased, with repeats collapsed.
 * photo1, photooo123, photo-233 and photo(1) all become "photo"; photobooth~1 becomes "photoboth".
 */
export function stemOf(fileName: string): string {
  const base = baseOf(fileName);
  let stem = '';
  for (let i = 0; i < base.length; i++) {
    let c = base.charAt(i);
    if (!isLetter(c)) continue;
    c = lowerChar(c);
    if (stem.length > 0 && stem.charAt(stem.length - 1) === c) continue;
    stem += c;
  }
  return stem;
}

export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 0 || b.length === 0) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  if (shorter.length >= MIN_PREFIX_STEM && longer.startsWith(shorter)) return true;
  return sharedPrefix(a, b) >= MIN_SHARED_PREFIX;
}

/**
 * Index groups of stems, each in input order, groups ordered by their first member.
 * Strict groups only identical stems (own, ownnn and own_ together; ownxlee apart);
 * otherwise stems that are {@link similar} are joined too.
 */
export function group(stems: string[], strict: boolean): number[][] {
  const unique = [...new Set(stems)];
  const parent = unique.map((_, i) => i);
  for (let i = 0; i < unique.length && !strict; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      if (similar(unique[i], unique[j])) parent[find(parent, j)] = find(parent, i);
    }
  }
  const stemIndex = new Map(unique.map((s, i) => [s, i]));
  const groups = new Map<number, number[]>();
  stems.forEach((stem, i) => {
    const root = find(parent, stemIndex.get(stem)!);
    const members = groups.get(root);
    if (members) members.push(i);
    else groups.set(root, [i]);
  });
  return [...groups.values()];
}

/**
 * Pulls out files that have no pattern worth a group: groups with fewer than `minGroupSize`
 * files (2 takes just the single files), and names with fewer than {@link MIN_PATTERN_LETTERS}
 * letters (a1, x_2024, 2024). They are removed from `groups` and returned together in input order.
 */
export function takePatternless(groups: number[][], stems: string[], minGroupSize: number): number[] {
  const leftovers: number[] = [];
  for (let g = groups.length - 1; g >= 0; g--) {
    const members = groups[g];
    if (members.length >= minGroupSize && stems[members[0]].length >= MIN_PATTERN_LETTERS) continue;
    leftovers.push(...members);
    groups.splice(g, 1);
  }
  return leftovers.sort((a, b) => a - b);
}

/** A starting name for a group, taken from the member with the shortest stem: photo(1).jpg gives "Photo". */
export function suggestionFor(fileNames: string[]): string {
  let best: string | null = null;
  let bestLength = Number.MAX_SAFE_INTEGER;
  for (const name of fileNames) {
    const length = stemOf(name).length;
    if (length > 0 && length < bestLength) {
      best = name;
      bestLength = length;
    }
  }
  if (best == null) return '';
  const base = baseOf(best);
  let start = 0;
  while (start < base.length && !isLetter(base.charAt(start))) start++;
  let end = start;
  while (end < base.length && isLetter(base.charAt(end))) end++;
  const word = base.substring(start, end);
  return word.length === 0 ? '' : word.substring(0, 1).toUpperCase() + word.substring(1);
}

/** Sequence numbers have at least this many digits: Base_00001 (as Sony cameras do: DSC00001). */
export const NUMBER_DIGITS = 5;

/**
 * New names for the given files. `bases[i]` is the name chosen for file i, or null to leave it.
 * Files sharing a base (ignoring case) are numbered together in array order as Base_00001,
 * Base_00002, … keeping their extensions; a base used once keeps the bare name when it is free.
 * Numbers that would collide with `occupied` (lower-cased names that stay put) are skipped.
 * Numbers are zero-padded to NUMBER_DIGITS, or wider when a sequence goes past 99999, so every
 * name in a sequence has the same width and they sort in order everywhere.
 */
export function assignTargets(bases: (string | null)[], fileNames: string[], occupied: Set<string>): (string | null)[] {
  const uses = new Map<string, number>();
  for (const base of bases) {
    if (base != null) uses.set(base.toLowerCase(), (uses.get(base.toLowerCase()) ?? 0) + 1);
  }
  const widths = new Map<string, number>();
  for (const [key, count] of uses) widths.set(key, Math.max(NUMBER_DIGITS, String(count).length));
  // Skipped numbers can push a sequence past its width; widen it and number again until all fit.
  for (;;) {
    const { targets, highest } = numberTargets(bases, fileNames, occupied, uses, widths);
    let widened = false;
    for (const [key, number] of highest) {
      if (String(number).length > widths.get(key)!) {
        widths.set(key, String(number).length);
        widened = true;
      }
    }
    if (!widened) return targets;
  }
}

function numberTargets(
  bases: (string | null)[],
  fileNames: string[],
  occupied: Set<string>,
  uses: Map<string, number>,
  widths: Map<string, number>,
) {
  const taken = new Set(occupied);
  const nextNumber = new Map<string, number>();
  const highest = new Map<string, number>();
  const targets: (string | null)[] = bases.map(() => null);
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    if (base == null) continue;
    const key = base.toLowerCase();
    const extension = extensionOf(fileNames[i]);
    let target = base + extension;
    if (uses.get(key)! > 1 || taken.has(target.toLowerCase())) {
      let number = nextNumber.get(key) ?? 1;
      do {
        target = `${base}_${String(number++).padStart(widths.get(key)!, '0')}${extension}`;
      } while (taken.has(target.toLowerCase()));
      nextNumber.set(key, number);
      highest.set(key, number - 1);
    }
    taken.add(target.toLowerCase());
    targets[i] = target;
  }
  return { targets, highest };
}

/** The extension including its dot ("photo.JPG" gives ".JPG"), or "" when there is none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '';
  // Keep compound archive extensions whole: backup.tar.gz gives ".tar.gz".
  if (regionMatchesIgnoreCase(fileName, Math.max(0, dot - 4), '.tar') && dot - 4 > 0) return fileName.substring(dot - 4);
  return fileName.substring(dot);
}

function baseOf(fileName: string): string {
  return fileName.substring(0, fileName.length - extensionOf(fileName).length);
}

function regionMatchesIgnoreCase(s: string, offset: number, other: string): boolean {
  if (offset + other.length > s.length) return false;
  for (let k = 0; k < other.length; k++) {
    const a = s.charAt(offset + k);
    const b = other.charAt(k);
    if (a === b) continue;
    const ua = upperChar(a);
    const ub = upperChar(b);
    if (ua === ub || lowerChar(ua) === lowerChar(ub)) continue;
    return false;
  }
  return true;
}

function sharedPrefix(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let i = 0;
  while (i < length && a.charAt(i) === b.charAt(i)) i++;
  return i;
}

function find(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function compareUnits(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let k = 0; k < length; k++) {
    const d = a.charCodeAt(k) - b.charCodeAt(k);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Case-insensitive order that compares digit runs by value, so file2 sorts before file10. */
export function naturalCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.charAt(i);
    const cb = b.charAt(j);
    if (isDigit(ca) && isDigit(cb)) {
      const startA = i;
      const startB = j;
      while (i < a.length && isDigit(a.charAt(i))) i++;
      while (j < b.length && isDigit(b.charAt(j))) j++;
      const numberA = a.substring(startA, i).replace(/^0+(?=.)/, '');
      const numberB = b.substring(startB, j).replace(/^0+(?=.)/, '');
      if (numberA.length !== numberB.length) return numberA.length - numberB.length;
      const compared = compareUnits(numberA, numberB);
      if (compared !== 0) return compared;
    } else {
      const compared = lowerChar(ca).charCodeAt(0) - lowerChar(cb).charCodeAt(0);
      if (compared !== 0) return compared;
      i++;
      j++;
    }
  }
  return a.length - i - (b.length - j);
}
