/**
 * The words said before a backup is restored (25 Nov 2026): when the backup was made and how old it is come first,
 * because an older backup restored without noticing its age is how newer data gets lost.
 */
export function ageWords(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 864e5);
  if (!Number.isFinite(days) || days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `about ${Math.round(days / 30.4)} months ago`;
  return `about ${Math.round(days / 365.25)} years ago`;
}

/** "This backup was made on 12 Nov 2026, 09:41 (13 days ago)." */
export function backupMade(exportedAt?: string, now = Date.now()): string {
  if (!exportedAt || !Number.isFinite(Date.parse(exportedAt))) return 'This backup does not say when it was made.';
  return `This backup was made on ${new Date(exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${ageWords(exportedAt, now)}).`;
}

/** What is added, never replaced, by any restore. */
export const ADDED_WORDS = 'Activities, wellness, original activity files and ride recordings in the backup are added where this device lacks them.';
