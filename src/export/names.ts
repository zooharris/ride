/**
 * File names for exported files (12 Nov 2026): date, name and kind, so they sort and say what they are
 * ("2026-11-08 Lovettsville ride.fit"), safe on every common computer and phone, and never the same twice in one folder.
 */

/** Characters no common system allows in a name, and control characters. */
const BAD = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
/** Names Windows reserves, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX = 80;

/**
 * A file name that is safe everywhere. Accents and other letters are kept (every current system shows them); only
 * forbidden characters become spaces, and the name is cut so a whole path stays well inside every limit.
 */
export function safeName(base: string, ext: string): string {
  let s = base.normalize('NFC').replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!s || RESERVED.test(s)) s = `Antogo ${s}`.trim();
  if (s.length > MAX) s = s.slice(0, MAX).trim().replace(/[. ]+$/, '');
  return `${s}.${ext}`;
}

/** The kind word in a file name. */
export const KIND_WORD: Record<string, string> = { ride: 'ride', walk: 'walk', run: 'run', strength: 'strength', mobility: 'mobility', other: 'activity' };

/** "2026-11-08 Lovettsville ride", then the extension. A name that already ends in its kind isn't doubled. */
export function exportFileName(date: string | undefined, name: string, kind: string, ext: string): string {
  const word = KIND_WORD[kind] ?? kind;
  const n = name.trim();
  const tail = new RegExp(`\\b${word}$`, 'i').test(n) ? '' : ` ${word}`;
  return safeName(`${date ? `${date} ` : ''}${n}${tail}`, ext);
}

/** Hands out names within one folder: a name already used gets " (2)", " (3)" before its extension. Case is ignored, as on most phones and computers. */
export class NameBook {
  private used = new Set<string>();
  take(name: string): string {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let out = name;
    for (let i = 2; this.used.has(out.toLowerCase()); i++) out = `${stem} (${i})${ext}`;
    this.used.add(out.toLowerCase());
    return out;
  }
}
