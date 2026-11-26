import type { MacUpdate } from '../shell';

/** Megabytes as the Finder counts them, whole. */
export const megabytes = (bytes: number): number => Math.round(bytes / 1e6);

/** How far a download has got, 0 to 1; undefined while the size is not known. */
export function fraction(s: MacUpdate): number | undefined {
  if (!s.total || s.received == null) return undefined;
  return Math.max(0, Math.min(1, s.received / s.total));
}

/** The banner's words for each state of the Mac app's own download (26 Nov 2026). */
export function updateWords(s: MacUpdate, app: string): { head: string; text: string } {
  switch (s.state) {
    case 'starting': return { head: 'Starting the download…', text: '' };
    case 'downloading': return { head: `Downloading the newer ${app}…`, text: s.total ? `${megabytes(s.received ?? 0)} of ${megabytes(s.total)} MB` : `${megabytes(s.received ?? 0)} MB so far` };
    case 'checking': return { head: 'Checking the download…', text: '' };
    case 'done': return { head: s.already ? `The newer ${app} is already downloaded.` : `The newer ${app} is downloaded.`, text: `It is in your Downloads folder as ${s.name ?? 'Antogo.dmg'}. Open it, then drag ${app} into Applications, replacing this one. Your data stays.` };
    case 'failed': return { head: 'The download did not finish:', text: `${s.why ?? 'something went wrong'}.` };
    default: return { head: `A newer ${app} for the Mac is ready.`, text: 'Download it, then replace this one in Applications. Your data stays.' };
  }
}
