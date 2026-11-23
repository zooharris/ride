import { db, type OwnRecord } from '../data/db';
import { ownNumbers, OWN_VERSION, perSecond, withOwn, type OwnNumbers } from '../engine/ownNumbers';
import type { ActivityEdit, Profile, Ride } from '../engine/types';
import { footHrZones, rideHrZones, ridePowerZones } from '../engine/zones';
import { NOT_ACTIVITY, readActivityFile } from '../import/readers';
import type { StreamSet } from '../data/db';
import { getThresholdCtx, thresholdsOf } from '../engine/thresholdCtx';
import { applyCorrections, applyTotals, correctionsPending, correctRecording, fixSig, partTotals, validTrim } from '../engine/corrections';
import { durationFor } from './intervals';

/**
 * Stage 1 (22 Nov 2026): Antogo's own numbers for every activity with a recording. Worked out from the activity's
 * original file kept on this device (Stage 0), stored by activity, and laid over the activity wherever it is written:
 * when it arrives from the data service, when a history is loaded, when a file is brought in, and once for every
 * activity already here (the change-over). The fields Antogo can't work out (weather, the rider's rated effort, the
 * device) are kept as the activity came with them.
 *
 * Later the same day: each activity is scored with the FTP and threshold heart rate Antogo's own history has for its
 * day (or the device's FTP, where the rider chose that), and with the rider's corrections to it laid over.
 */

/** The thresholds an activity is scored with (engine/thresholdCtx), and the zone ladders for its kind. */
export function thresholdsFor(r: Pick<Ride, 'id' | 'date' | 'sport'> & Partial<Pick<Ride, 'ftpAtRide' | 'ftpDevice'>>, p: Profile) {
  const onFoot = r.sport === 'walk' || r.sport === 'run';
  const t = thresholdsOf(r, p);
  return {
    ftp: t.ftp?.value ?? 0,
    lthr: t.lthr?.value ?? 0,
    powerZones: ridePowerZones(p),
    hrZones: onFoot ? footHrZones(p) : rideHrZones(p),
  };
}

/** The fields Antogo works out, as an activity came with them (the device's own energy figure is read from here). */
export function cameWith(r: Ride): OwnNumbers {
  const keys: Array<keyof OwnNumbers> = ['normalizedPower', 'averagePower', 'intensityFactor', 'variabilityIndex', 'workKj', 'workAboveFtpKj', 'averageHr', 'maxHr', 'efficiencyFactor', 'decoupling', 'averageCadence', 'coastingSeconds', 'maxSpeedMs', 'powerZoneSeconds', 'hrZoneSeconds', 'sweetSpotSeconds', 'calories', 'carbsUsedG', 'averageTempC', 'elevationM', 'elevationLossM'];
  const out: Record<string, unknown> = {};
  const src = { ...r, ...(r.setAside?.power ?? {}), ...(r.setAside?.hr ?? {}), ...(r.setAside?.whole ?? {}) } as Ride;
  for (const k of keys) if (src[k as keyof Ride] !== undefined) out[k] = src[k as keyof Ride];
  return out as OwnNumbers;
}

/** An activity's whole recording from its kept file, any format, and the FTP the device had set, when the file says. */
export async function recordingAndFtp(id: string): Promise<{ streams?: StreamSet; ftp?: number }> {
  const f = await db.files.get(id);
  if (f?.status !== 'kept' || !f.bytes) return {};
  const parsed = await readActivityFile(id, f.bytes);
  return parsed && parsed !== NOT_ACTIVITY ? { streams: parsed.streams ? { ...parsed.streams, id } : undefined, ftp: parsed.ftp } : {};
}
/** The whole recording, as the device made it. */
export async function wholeRecordingOf(id: string): Promise<StreamSet | undefined> { return (await recordingAndFtp(id)).streams; }
/** The recording as the rider's corrections leave it: the part kept, without a measure left out. What every reader of a recording uses. */
export async function recordingOf(id: string): Promise<StreamSet | undefined> {
  const s = await wholeRecordingOf(id);
  return s ? correctRecording(s, await editOf(id)) : undefined;
}
/** A recording from anywhere (the cache, the data service), as the rider's corrections leave it. Never one already corrected. */
export async function corrected<T extends import('../engine/corrections').Rec>(id: string, s: T): Promise<T> { return correctRecording(s, await editOf(id)); }
/** The recording cached on this device (always the whole one), as the rider's corrections leave it. */
export async function cachedRecording(id: string): Promise<StreamSet | undefined> { const s = await db.streams.get(id); return s ? corrected(id, s) : undefined; }
/** The rider's corrections to an activity. */
export async function editOf(id: string): Promise<ActivityEdit | undefined> { return getThresholdCtx()?.edits.get(id) ?? (await db.activityEdits.get(id)); }

/** The data service's FTP for an activity's day, kept as the one record of what Antogo's FTP was before it had a history. */
const serviceFtpOf = (r: Ride, before?: OwnRecord) => r.ftpService ?? before?.serviceFtp ?? (r.source !== 'file' && r.ftpFrom !== 'device' && !r.ftpDevice && !before ? r.ftpAtRide : undefined);

/** Work out one activity's numbers from its recording, and keep them. Undefined when it has no recording. */
export async function workOut(r: Ride, p: Profile, given?: { streams?: StreamSet; ftp?: number }): Promise<OwnRecord | undefined> {
  const got = given?.streams ? given : await recordingAndFtp(r.id);
  const whole = got.streams;
  if (!whole || whole.time.length < 2) return undefined;
  const edit = await editOf(r.id);
  const span = whole.time[whole.time.length - 1];
  const trimmed = validTrim(edit?.trim, span);
  const s = correctRecording(whole, edit);
  const before = await db.own.get(r.id);
  const deviceFtp = got.ftp ?? before?.deviceFtp ?? r.ftpDevice, serviceFtp = serviceFtpOf(r, before);
  const t = thresholdsFor({ ...r, ftpDevice: deviceFtp }, p);
  const came = before?.came ?? (r.ownNumbers ? undefined : cameWith(r));
  // The device's own energy figure, as the activity came (an earlier working-out may have laid Antogo's over it).
  const wholeKcal = (before?.came ?? came)?.calories ?? (r.ownNumbers ? undefined : r.calories);
  // Under a trim only the part kept counts: its own climbing, and the device's energy figure in proportion to the time kept.
  const share = trimmed ? Math.min(1, (s.time[s.time.length - 1] - s.time[0]) / Math.max(1, span)) : 1;
  const deviceKcal = wholeKcal != null ? (trimmed ? Math.round(wholeKcal * share) : wholeKcal) : undefined;
  const wholeOf = (k: 'elevationM' | 'elevationLossM') => (r.setAside?.whole?.[k] as number | undefined) ?? r[k];
  const nums = ownNumbers(s, { sport: r.sport, ftp: t.ftp, lthr: t.lthr, powerZones: t.powerZones, hrZones: t.hrZones, has: { calories: r.sport === 'ride' && trimmed && s.watts ? undefined : deviceKcal, carbsUsedG: before?.nums.carbsEstimated || trimmed ? undefined : r.carbsUsedG, elevationM: trimmed ? undefined : wholeOf('elevationM'), elevationLossM: trimmed ? undefined : wholeOf('elevationLossM') } });
  if (deviceKcal != null && nums.calories == null) nums.calories = deviceKcal;
  let totals: OwnRecord['totals'];
  if (trimmed) {
    const ridden = perSecond(s.time, s.time.map(() => 1), s.pauses).reduce<number>((n, x) => n + (x != null ? 1 : 0), 0);
    const part = partTotals(s, ridden);
    totals = { ...part, seconds: durationFor(r.sport, part.movingSeconds, part.elapsedSeconds) || part.elapsedSeconds, ...(nums.elevationM != null ? { elevationM: nums.elevationM } : {}), ...(nums.elevationLossM != null ? { elevationLossM: nums.elevationLossM } : {}), ...(nums.calories != null ? { calories: nums.calories } : {}) };
  }
  const cameV = before?.came ? before.cameV : undefined;
  const fix = fixSig(edit);
  const rec: OwnRecord = { id: r.id, v: OWN_VERSION, ftp: t.ftp, lthr: t.lthr, nums, ...(came ? { came } : {}), ...(cameV ? { cameV } : {}),
    ...(deviceFtp ? { deviceFtp } : {}), ...(serviceFtp ? { serviceFtp } : {}), ...(fix ? { fix } : {}), ...(totals ? { totals } : {}), at: new Date().toISOString() };
  await db.own.put(rec);
  return rec;
}

/** An activity with Antogo's numbers, the thresholds of its day and the rider's corrections laid over it, as the record has them. */
export function applyRec(r: Ride, rec: OwnRecord, edit: ActivityEdit | undefined = getThresholdCtx()?.edits.get(r.id)): Ride {
  // The whole recording's totals are set aside (or put back) before the numbers are laid over, so what is set aside is the whole's.
  const next = withOwn(applyTotals({ ...r }, rec.totals), rec.nums);
  if (rec.deviceFtp) next.ftpDevice = rec.deviceFtp;
  if (rec.serviceFtp) next.ftpService = rec.serviceFtp;
  // Kept on the activity once Antogo's own history is what scores it (before that, it keeps the FTP it came with).
  if (rec.ftp && (getThresholdCtx()?.ftp || edit?.ftp)) next.ftpAtRide = rec.ftp;
  if (rec.lthr) next.lthrAtRide = rec.lthr;
  applyCorrections(next, edit);
  return next;
}

/** Whether a kept record still holds for the thresholds and corrections the activity would be worked out with now. */
export function current(rec: OwnRecord | undefined, r: Ride, p: Profile): boolean {
  if (!rec || rec.v !== OWN_VERSION) return false;
  const t = thresholdsFor({ ...r, ftpDevice: rec.deviceFtp ?? r.ftpDevice }, p);
  return rec.ftp === t.ftp && rec.lthr === t.lthr && (rec.fix ?? '') === fixSig(getThresholdCtx()?.edits.get(r.id));
}

/**
 * Lay Antogo's numbers over activities about to be written (from the data service): the kept record where there is
 * one, and what the data service sent is remembered as what the activity came with. Corrections are laid over every
 * activity, with a record or not, since the data service sends each one as it was recorded.
 */
export async function applyOwnTo(rides: Ride[]): Promise<Ride[]> {
  if (!rides.length) return rides;
  const recs = new Map((await db.own.bulkGet(rides.map((r) => r.id))).filter((x): x is OwnRecord => !!x).map((x) => [x.id, x]));
  const edits = getThresholdCtx()?.edits ?? new Map((await db.activityEdits.bulkGet(rides.map((r) => r.id))).filter((x): x is ActivityEdit => !!x).map((x) => [x.id, x]));
  const out: Ride[] = [];
  for (const r of rides) {
    const rec = recs.get(r.id);
    if (!rec) { out.push(edits.get(r.id) ? applyCorrections(r, edits.get(r.id)) : r); continue; }
    // What the data service says now is remembered: its figures, and the FTP it has for the day (which it may have changed).
    if (!r.ownNumbers) await db.own.update(r.id, { came: cameWith(r), cameV: 3, ...(r.ftpService ? { serviceFtp: r.ftpService } : {}) });
    out.push(applyRec(r, r.ftpService ? { ...rec, serviceFtp: r.ftpService } : rec, edits.get(r.id)));
  }
  return out;
}

export interface ChangeOverState { running: boolean; done: number; total: number; /** The last run that changed anything: how many activities, and when (ISO). */ last?: { changed: number; at: string } }
let state: ChangeOverState = { running: false, done: 0, total: 0 };
const listeners = new Set<(s: ChangeOverState) => void>();
const emit = (patch: Partial<ChangeOverState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };
export function watchChangeOver(fn: (s: ChangeOverState) => void): () => void { listeners.add(fn); fn(state); return () => listeners.delete(fn); }

let running: Promise<number> | null = null;
let again = false;

/**
 * Whether an activity is out of step with how it would be worked out now: a recording not yet on Antogo's numbers,
 * numbers worked out with thresholds or corrections that have since changed, or (with no recording here) an FTP,
 * threshold heart rate or correction that is not the one in force.
 */
export function outOfStep(r: Ride, p: Profile, kept: boolean, rec: OwnRecord | undefined): boolean {
  const edit = getThresholdCtx()?.edits.get(r.id);
  if (correctionsPending(r, edit)) return true;
  if (kept && r.noRecV !== OWN_VERSION) return !r.ownNumbers || !current(rec, r, p);
  if (!getThresholdCtx()?.ftp) return r.tss == null;
  const t = thresholdsOf(r, p);
  const usesFtp = r.sport === 'ride' && !!r.normalizedPower;
  const usesHr = !!r.averageHr;
  return r.tss == null || (usesFtp && !!t.ftp && r.ftpAtRide !== t.ftp.value) || (usesHr && !!t.lthr && r.lthrAtRide !== t.lthr.value);
}

/**
 * The change-over, and every working-out-again since: each activity out of step with the thresholds and corrections in
 * force is worked out again (from its recording where one is kept) and written back, scored by the app's own rules.
 * Only those: an activity nothing has changed for is not touched. In the background, a few at a time; carried on the
 * next time if stopped. A call while one runs makes it run once more when it ends. Returns how many changed.
 */
export function changeOver(score: (r: Ride, p: Profile) => void | Promise<void>, onChanged: () => void): Promise<number> {
  if (running) { again = true; return running; }
  running = (async () => {
    let total = 0;
    do {
      again = false;
      const p = await db.profile.get('me');
      if (!p) return 0;
      const kept = new Set((await db.files.where('status').equals('kept').primaryKeys()) as string[]);
      const recs = new Map((await db.own.toArray()).map((x) => [x.id, x]));
      const todo = (await db.rides.toArray()).filter((r) => outOfStep(r, p, kept.has(r.id), recs.get(r.id))).sort((a, b) => b.date.localeCompare(a.date));
      emit({ running: true, done: 0, total: todo.length });
      let changed = 0;
      for (let i = 0; i < todo.length; i++) {
        try {
          // Read again at the moment of writing: a sync or the rider may have changed the activity since the list was made.
          const r = (await db.rides.get(todo[i].id)) ?? todo[i];
          if (await workOutOne(r, p, kept.has(r.id), recs.get(r.id), score)) changed++;
        } catch { /* an unreadable file: left as it came */ }
        emit({ done: i + 1 });
        if (i % 25 === 24) { onChanged(); await new Promise((res) => setTimeout(res, 0)); }
      }
      total += changed;
      if (changed) onChanged();
    } while (again);
    emit({ running: false, ...(total ? { last: { changed: total, at: new Date().toISOString() } } : {}) });
    return total;
  })().finally(() => { running = null; });
  return running;
}

/** One activity worked out again and written back. */
async function workOutOne(r: Ride, p: Profile, kept: boolean, known: OwnRecord | undefined, score: (r: Ride, p: Profile) => void | Promise<void>): Promise<boolean> {
  const edit = getThresholdCtx()?.edits.get(r.id) ?? (await db.activityEdits.get(r.id));
  let next: Ride;
  // The activity as its corrections leave it comes first: a start that was moved (or moved back) decides which day's
  // thresholds it is worked out with.
  const base = applyCorrections({ ...((await db.rides.get(r.id)) ?? r) }, edit);
  const rec = kept && r.noRecV !== OWN_VERSION ? (base.ownNumbers && current(known, base, p) ? known : await workOut(base, p)) : undefined;
  if (rec) next = applyRec(base, rec, edit);
  else {
    // No recording to work from (none kept, or a file that holds only totals): the activity's own figures, corrected and scored.
    next = base;
    if (kept) next.noRecV = OWN_VERSION;
  }
  const moved = next.date !== r.date;
  await score(next, p);
  await db.rides.put(next);
  // What is kept by the activity's day follows it to its new day; what was read from the recording is read again.
  if (moved) { await db.files.update(r.id, { date: next.date }); await db.activityEdits.update(r.id, { date: next.date }); }
  if (moved || (known?.fix ?? '') !== fixSig(edit) || correctionsPending(r, edit)) await forgetReadings(r.id);
  // Counted as changed only when something about the activity is different afterwards.
  return JSON.stringify(next) !== JSON.stringify(r);
}

/** What was read from an activity's recording and kept (its power curve, small picture, the coach's reading): dropped, to be read again. */
export async function forgetReadings(id: string): Promise<void> {
  await Promise.all([db.powerCurves.delete(id), db.thumbs.delete(id), db.reads.delete(id)]);
  const hr20 = (await db.settings.get('hr20Best'))?.value as Record<string, number> | undefined;
  if (hr20 && id in hr20) { const { [id]: _gone, ...rest } = hr20; await db.settings.put({ key: 'hr20Best', value: rest }); }
}

/** One activity changed over, as soon as its file is kept (Stage 1), or as soon as the rider corrects it. */
export async function changeOne(id: string, score: (r: Ride, p: Profile) => void | Promise<void>, onChanged: () => void): Promise<boolean> {
  const [r, p] = await Promise.all([db.rides.get(id), db.profile.get('me')]);
  if (!r || !p) return false;
  const kept = (await db.files.get(id))?.status === 'kept';
  const done = await workOutOne(r, p, kept, await db.own.get(id), score);
  if (done) onChanged();
  return done;
}
