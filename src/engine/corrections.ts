import type { ActivityEdit, Ride } from './types';

/**
 * Corrections to one activity (22 Nov 2026, Part C), as they are laid over it. The recording is never changed: the
 * part kept and the measures left out are taken from a copy of it each time the activity is worked out. Pure.
 */

/** The numbers that come from power, and those that come from heart rate. Efficiency and drift need both. */
export const POWER_FIELDS: Array<keyof Ride> = ['normalizedPower', 'averagePower', 'intensityFactor', 'variabilityIndex', 'workKj', 'workAboveFtpKj', 'powerZoneSeconds', 'sweetSpotSeconds', 'powerCoverage', 'reserveUsedKj', 'carbsUsedG', 'carbsEstimated', 'eftp', 'efficiencyFactor', 'decoupling'];
export const HR_FIELDS: Array<keyof Ride> = ['averageHr', 'maxHr', 'hrZoneSeconds', 'efficiencyFactor', 'decoupling'];

export type Fix = Pick<ActivityEdit, 'ftp' | 'lthr' | 'noPower' | 'noHr' | 'start' | 'trim'>;
export const hasFix = (e?: Fix | null): boolean => !!e && !!(e.ftp || e.lthr || e.noPower || e.noHr || e.start || e.trim);

/** What of an edit changes the numbers worked out from the recording, as one word to compare. */
export function fixSig(e?: Fix | null): string {
  if (!e || !(e.trim || e.noPower || e.noHr)) return '';
  return [e.trim ? `t${Math.round(e.trim.from)}-${Math.round(e.trim.to)}` : '', e.noPower ? 'p' : '', e.noHr ? 'h' : ''].join('');
}

export interface Rec {
  time: number[];
  watts?: number[]; heartrate?: number[]; cadence?: number[]; distance?: number[]; altitude?: number[]; velocity?: number[]; temp?: number[];
  lat?: number[]; lng?: number[]; ve?: number[]; br?: number[]; tv?: number[];
  intervals?: Array<{ label?: string; type?: string; start: number; end: number; avgWatts?: number; avgHr?: number }>;
  pauses?: Array<[number, number]>;
}
const SERIES = ['watts', 'heartrate', 'cadence', 'distance', 'altitude', 'velocity', 'temp', 'lat', 'lng', 've', 'br', 'tv'] as const;

/** A sensible part to keep: inside the recording, at least ten seconds long. */
export function validTrim(t: { from: number; to: number } | undefined, span: number): t is { from: number; to: number } {
  return !!t && isFinite(t.from) && isFinite(t.to) && t.from >= 0 && t.to <= span + 1 && t.to - t.from >= 10 && (t.from > 0.5 || t.to < span - 0.5);
}

/**
 * The part of a recording between two moments (seconds from its start), as a recording of its own: time and distance
 * start again from zero, laps and pauses are cut to fit, and a lap wholly outside is gone.
 */
export function trimRecording<T extends Rec>(s: T, from: number, to: number): T {
  const idx: number[] = [];
  for (let i = 0; i < s.time.length; i++) if (s.time[i] >= from && s.time[i] <= to) idx.push(i);
  if (idx.length < 2) return s;
  const t0 = s.time[idx[0]];
  const out: Rec = { ...s, time: idx.map((i) => s.time[i] - t0) };
  for (const k of SERIES) { const v = s[k]; if (v) out[k] = idx.map((i) => v[i]); }
  if (out.distance) { const d0 = out.distance.find((x) => x != null && isFinite(x)) ?? 0; out.distance = out.distance.map((x) => (x != null && isFinite(x) ? x - d0 : x)); }
  const end = out.time[out.time.length - 1];
  const cut = (a: number, b: number): [number, number] | undefined => { const x = Math.max(0, a - t0), y = Math.min(end, b - t0); return y - x >= 1 ? [x, y] : undefined; };
  if (s.intervals) out.intervals = s.intervals.flatMap((iv) => { const c = cut(iv.start, iv.end); return c ? [{ ...iv, start: c[0], end: c[1], ...(c[1] - c[0] < iv.end - iv.start - 1 ? { avgWatts: undefined, avgHr: undefined } : {}) }] : []; });
  if (s.pauses) out.pauses = s.pauses.flatMap(([a, b]) => { const c = cut(a, b); return c ? [c] : []; });
  return out as T;
}

/** A recording with a measure left out. Laps lose that measure's averages too. */
export function withoutMeasure<T extends Rec>(s: T, what: { power?: boolean; hr?: boolean }): T {
  if (!what.power && !what.hr) return s;
  const out: Rec = { ...s };
  if (what.power) delete out.watts;
  if (what.hr) delete out.heartrate;
  if (out.intervals) out.intervals = out.intervals.map((iv) => ({ ...iv, ...(what.power ? { avgWatts: undefined } : {}), ...(what.hr ? { avgHr: undefined } : {}) }));
  return out as T;
}

/** A recording as the rider's corrections leave it: the part kept, without the measures left out. */
export function correctRecording<T extends Rec>(s: T, e?: Fix | null): T {
  if (!e) return s;
  const span = s.time.length ? s.time[s.time.length - 1] : 0;
  const part = validTrim(e.trim, span) ? trimRecording(s, e.trim.from, e.trim.to) : s;
  return withoutMeasure(part, { power: e.noPower, hr: e.noHr });
}

/** The totals of the part kept: start to finish, time moving, distance and average speed. */
export function partTotals(s: Rec, ridden: number): { elapsedSeconds: number; movingSeconds: number; distanceM?: number; averageSpeedMs?: number } {
  const elapsed = Math.round(s.time[s.time.length - 1] - s.time[0]);
  const d = s.distance?.filter((x) => x != null && isFinite(x));
  const dist = d?.length ? Math.max(0, d[d.length - 1] - d[0]) : undefined;
  const moving = Math.max(1, Math.min(elapsed, ridden));
  return { elapsedSeconds: elapsed, movingSeconds: moving, ...(dist != null ? { distanceM: Math.round(dist), averageSpeedMs: dist / moving } : {}) };
}

function setAsideOf(r: Ride): NonNullable<Ride['setAside']> { return { ...(r.setAside ?? {}) }; }
function tidy(r: Ride, aside: NonNullable<Ride['setAside']>): void {
  for (const k of Object.keys(aside) as Array<keyof typeof aside>) if (aside[k] == null || (typeof aside[k] === 'object' && !Object.keys(aside[k]!).length)) delete aside[k];
  if (Object.keys(aside).length) r.setAside = aside; else delete r.setAside;
}

/**
 * Lay the rider's corrections over an activity (in place): the measures left out are taken off and set aside, the
 * start is moved, and whatever a correction no longer asks for is put back from what was set aside.
 */
export function applyCorrections(r: Ride, e?: Fix | null): Ride {
  const aside = setAsideOf(r);
  const rec = r as unknown as Record<string, unknown>;
  const leave = (on: boolean | undefined, fields: Array<keyof Ride>, key: 'power' | 'hr') => {
    if (on) {
      const kept: Record<string, unknown> = { ...(aside[key] ?? {}) };
      for (const k of fields) if (rec[k] !== undefined) { kept[k] = rec[k]; delete rec[k]; }
      aside[key] = kept as Partial<Ride>;
    } else if (aside[key]) {
      // Put back only what is still missing, and never a figure the other correction is leaving out.
      const other = key === 'power' ? (e?.noHr ? HR_FIELDS : []) : (e?.noPower ? POWER_FIELDS : []);
      for (const [k, v] of Object.entries(aside[key]!)) if (rec[k] === undefined && !other.includes(k as keyof Ride)) rec[k] = v;
      delete aside[key];
    }
  };
  leave(e?.noPower, POWER_FIELDS, 'power');
  leave(e?.noHr, HR_FIELDS, 'hr');
  if (e?.start && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.start)) {
    if (r.startTime.slice(0, 16) !== e.start.slice(0, 16)) {
      aside.start = aside.start ?? { date: r.date, startTime: r.startTime };
      r.startTime = e.start.length === 16 ? `${e.start}:00` : e.start;
      r.date = e.start.slice(0, 10);
    }
  } else if (aside.start) { r.date = aside.start.date; r.startTime = aside.start.startTime; delete aside.start; }
  tidy(r, aside);
  return r;
}

/** The totals of the part kept laid over an activity, with the whole recording's set aside; or the whole put back. */
export function applyTotals(r: Ride, totals: Partial<Ride> | undefined, seconds?: number): Ride {
  const aside = setAsideOf(r);
  const rec = r as unknown as Record<string, unknown>;
  const KEYS = ['seconds', 'elapsedSeconds', 'movingSeconds', 'distanceM', 'averageSpeedMs', 'elevationM', 'elevationLossM', 'calories'] as const;
  if (totals) {
    if (!aside.whole) { const w: Record<string, unknown> = {}; for (const k of KEYS) if (rec[k] !== undefined) w[k] = rec[k]; aside.whole = w as Partial<Ride>; }
    for (const k of KEYS) { const v = (totals as Record<string, unknown>)[k]; if (v !== undefined) rec[k] = v; else if (k !== 'seconds') delete rec[k]; }
    if (seconds != null) r.seconds = seconds;
  } else if (aside.whole) {
    // What the whole recording had comes back; what only the part had goes.
    for (const k of KEYS) { const v = (aside.whole as Record<string, unknown>)[k]; if (v !== undefined) rec[k] = v; else delete rec[k]; }
    delete aside.whole;
  }
  tidy(r, aside);
  return r;
}

/** Whether laying the corrections over an activity again would change it (without looking at its recording). */
export function correctionsPending(r: Ride, e?: Fix | null): boolean {
  const rec = r as unknown as Record<string, unknown>;
  if (e?.noPower ? POWER_FIELDS.some((k) => rec[k] !== undefined) : !!r.setAside?.power) return true;
  if (e?.noHr ? HR_FIELDS.some((k) => rec[k] !== undefined) : !!r.setAside?.hr) return true;
  if (e?.start ? r.startTime.slice(0, 16) !== e.start.slice(0, 16) : !!r.setAside?.start) return true;
  return !e?.trim && !!r.setAside?.whole;
}

/** The corrections in force on an activity, each in a few words, for the list on its page. */
export function fixWords(e: Fix | undefined | null, o: { clock: (s: number) => string; when: (iso: string) => string; onFoot?: boolean }): Array<{ key: keyof Fix; text: string }> {
  if (!e) return [];
  const out: Array<{ key: keyof Fix; text: string }> = [];
  if (e.ftp) out.push({ key: 'ftp', text: `FTP for this ride set to ${e.ftp} W by you` });
  if (e.lthr) out.push({ key: 'lthr', text: `Threshold heart rate for this activity set to ${e.lthr} bpm by you` });
  if (e.noPower) out.push({ key: 'noPower', text: 'Power left out' });
  if (e.noHr) out.push({ key: 'noHr', text: 'Heart rate left out' });
  if (e.start) out.push({ key: 'start', text: `Start moved to ${o.when(e.start)}` });
  if (e.trim) out.push({ key: 'trim', text: `Trimmed to the part from ${o.clock(Math.round(e.trim.from))} to ${o.clock(Math.round(e.trim.to))} of the recording` });
  return out;
}
