import { db, getSetting, type OwnRecord } from '../data/db';
import { ownNumbers, OWN_VERSION, withOwn, type OwnNumbers } from '../engine/ownNumbers';
import type { Profile, Ride } from '../engine/types';
import { footHrZones, footLthr, rideHrZones, ridePowerZones } from '../engine/zones';
import { NOT_ACTIVITY, readActivityFile } from '../import/readers';
import type { StreamSet } from '../data/db';

/**
 * Stage 1 (22 Nov 2026): Antogo's own numbers for every activity with a recording. Worked out from the activity's
 * original file kept on this device (Stage 0), stored by activity, and laid over the activity wherever it is written:
 * when it arrives from the data service, when a history is loaded, when a file is brought in, and once for every
 * activity already here (the change-over). The fields Antogo can't work out (weather, the rider's rated effort, the
 * device) are kept as the activity came with them.
 */

/** The thresholds an activity is scored with: the FTP of its day where the activity carries it, else the current settings. */
export function thresholdsFor(r: Pick<Ride, 'sport' | 'ftpAtRide'>, p: Profile) {
  const onFoot = r.sport === 'walk' || r.sport === 'run';
  return {
    ftp: r.ftpAtRide || p.ftp || 0,
    lthr: onFoot ? footLthr(p) : p.lthr || 0,
    powerZones: ridePowerZones(p),
    hrZones: onFoot ? footHrZones(p) : rideHrZones(p),
  };
}

/** The fields Antogo works out, as an activity came with them (for the one-time check against the data service). */
export function cameWith(r: Ride): OwnNumbers {
  const keys: Array<keyof OwnNumbers> = ['normalizedPower', 'averagePower', 'intensityFactor', 'variabilityIndex', 'workKj', 'workAboveFtpKj', 'averageHr', 'maxHr', 'efficiencyFactor', 'decoupling', 'averageCadence', 'coastingSeconds', 'maxSpeedMs', 'powerZoneSeconds', 'hrZoneSeconds', 'sweetSpotSeconds', 'calories', 'carbsUsedG', 'averageTempC', 'elevationM', 'elevationLossM'];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (r[k as keyof Ride] !== undefined) out[k] = r[k as keyof Ride];
  return out as OwnNumbers;
}

/** The setting: which FTP of the day scores the rider's rides, where both the device and the data service have one. */
export const FTP_SOURCE = 'ftpSource';
export type FtpSource = 'device' | 'service';

/**
 * The FTP of an activity's day, from the two places that may have it. The rider's choice decides where both do; with
 * no choice made, the data service's stands where there is one (as it always has), and the device's otherwise.
 */
export function chooseFtp(device: number | undefined, service: number | undefined, source: FtpSource | undefined): { ftp?: number; from?: FtpSource } {
  const first: FtpSource = source ?? 'service';
  const order: FtpSource[] = first === 'device' ? ['device', 'service'] : ['service', 'device'];
  for (const k of order) { const v = k === 'device' ? device : service; if (v) return { ftp: v, from: k }; }
  return {};
}

/** An activity's recording from its kept file, any format, and the FTP the device had set, when the file says. */
export async function recordingAndFtp(id: string): Promise<{ streams?: StreamSet; ftp?: number }> {
  const f = await db.files.get(id);
  if (f?.status !== 'kept' || !f.bytes) return {};
  const parsed = await readActivityFile(id, f.bytes);
  return parsed && parsed !== NOT_ACTIVITY ? { streams: parsed.streams ? { ...parsed.streams, id } : undefined, ftp: parsed.ftp } : {};
}
export async function recordingOf(id: string): Promise<StreamSet | undefined> { return (await recordingAndFtp(id)).streams; }

/** The data service's FTP for an activity's day: what it carries as such, or what it came with before the two were told apart. */
const serviceFtpOf = (r: Ride, before?: OwnRecord) => r.ftpService ?? before?.serviceFtp ?? (r.source !== 'file' && r.ftpFrom !== 'device' ? r.ftpAtRide : undefined);

/** Work out one activity's numbers from its recording, and keep them. Undefined when it has no recording. */
export async function workOut(r: Ride, p: Profile, given?: { streams?: StreamSet; ftp?: number }, source?: FtpSource): Promise<OwnRecord | undefined> {
  const got = given?.streams ? given : await recordingAndFtp(r.id);
  const s = got.streams;
  if (!s || s.time.length < 2) return undefined;
  const before = await db.own.get(r.id);
  const src = source ?? (await getSetting<FtpSource | undefined>(FTP_SOURCE, undefined));
  const deviceFtp = got.ftp ?? before?.deviceFtp ?? r.ftpDevice, serviceFtp = serviceFtpOf(r, before);
  const chosen = chooseFtp(deviceFtp, serviceFtp, src);
  const t = thresholdsFor(chosen.ftp ? { ...r, ftpAtRide: chosen.ftp } : r, p);
  const came = before?.came ?? (r.ownNumbers ? undefined : cameWith(r));
  // The device's own energy figure, as the activity came (an earlier working-out may have laid Antogo's over it).
  const deviceKcal = (before?.came ?? came)?.calories ?? (r.ownNumbers ? undefined : r.calories);
  const nums = ownNumbers(s, { sport: r.sport, ftp: t.ftp, lthr: t.lthr, powerZones: t.powerZones, hrZones: t.hrZones, has: { calories: deviceKcal, carbsUsedG: before?.nums.carbsEstimated ? undefined : r.carbsUsedG, elevationM: r.elevationM, elevationLossM: r.elevationLossM } });
  if (deviceKcal != null) nums.calories = deviceKcal;
  const cameV = before?.came ? before.cameV : undefined;
  const rec: OwnRecord = { id: r.id, v: OWN_VERSION, ftp: t.ftp, lthr: t.lthr, nums, ...(came ? { came } : {}), ...(cameV ? { cameV } : {}),
    ...(deviceFtp ? { deviceFtp } : {}), ...(serviceFtp ? { serviceFtp } : {}), ...(chosen.from ? { ftpFrom: chosen.from } : {}), at: new Date().toISOString() };
  await db.own.put(rec);
  return rec;
}

/** An activity with Antogo's numbers and the FTP of its day laid over it, as the record has them. */
export function applyRec(r: Ride, rec: OwnRecord): Ride {
  const next = withOwn(r, rec.nums);
  if (rec.deviceFtp) next.ftpDevice = rec.deviceFtp;
  if (rec.serviceFtp) next.ftpService = rec.serviceFtp;
  if (rec.ftpFrom && rec.ftp) { next.ftpAtRide = rec.ftp; next.ftpFrom = rec.ftpFrom; }
  return next;
}

/** Whether a kept record still holds for the thresholds the activity would be scored with now. */
export function current(rec: OwnRecord | undefined, r: Ride, p: Profile, source?: FtpSource): boolean {
  if (!rec || rec.v !== OWN_VERSION) return false;
  const chosen = chooseFtp(rec.deviceFtp, serviceFtpOf(r, rec), source);
  const t = thresholdsFor(chosen.ftp ? { ...r, ftpAtRide: chosen.ftp } : r, p);
  return rec.ftp === t.ftp && rec.lthr === t.lthr;
}

/**
 * Lay Antogo's numbers over activities about to be written (from the data service): the kept record where it is
 * current, and what the data service sent is remembered as what the activity came with.
 */
export async function applyOwnTo(rides: Ride[]): Promise<Ride[]> {
  if (!rides.length) return rides;
  const recs = new Map((await db.own.bulkGet(rides.map((r) => r.id))).filter((x): x is OwnRecord => !!x).map((x) => [x.id, x]));
  const out: Ride[] = [];
  for (const r of rides) {
    const rec = recs.get(r.id);
    if (!rec) { out.push(r); continue; }
    // The data service's figures, fresh, are what the activity came with.
    // What the data service says now is remembered: its figures, and the FTP it has for the day (which it may have changed).
    if (!r.ownNumbers) await db.own.update(r.id, { came: cameWith(r), cameV: 3, ...(r.ftpService ? { serviceFtp: r.ftpService } : {}) });
    out.push(applyRec(r, r.ftpService ? { ...rec, serviceFtp: r.ftpService } : rec));
  }
  return out;
}

export interface ChangeOverState { running: boolean; done: number; total: number }
let state: ChangeOverState = { running: false, done: 0, total: 0 };
const listeners = new Set<(s: ChangeOverState) => void>();
const emit = (patch: Partial<ChangeOverState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };
export function watchChangeOver(fn: (s: ChangeOverState) => void): () => void { listeners.add(fn); fn(state); return () => listeners.delete(fn); }

let running: Promise<number> | null = null;

/**
 * The change-over: every activity with a kept file whose numbers are not yet Antogo's, or were worked out with
 * thresholds that have since changed, is worked out again and written back, scored by the app's own rules. In the
 * background, a few at a time; carried on the next time if stopped. Returns how many changed.
 */
export function changeOver(score: (r: Ride, p: Profile) => void, onChanged: () => void): Promise<number> {
  if (running) return running;
  running = (async () => {
    const p = await db.profile.get('me');
    if (!p) return 0;
    const source = await getSetting<FtpSource | undefined>(FTP_SOURCE, undefined);
    const kept = new Set((await db.files.where('status').equals('kept').primaryKeys()) as string[]);
    const recs = new Map((await db.own.toArray()).map((x) => [x.id, x]));
    const todo = (await db.rides.toArray()).filter((r) => kept.has(r.id) && (!r.ownNumbers || !current(recs.get(r.id), r, p, source)))
      .sort((a, b) => b.date.localeCompare(a.date));
    emit({ running: true, done: 0, total: todo.length });
    let changed = 0;
    for (let i = 0; i < todo.length; i++) {
      try {
        // Read again at the moment of writing: a sync or the rider may have changed the activity since the list was made.
        const r = (await db.rides.get(todo[i].id)) ?? todo[i];
        const rec = current(recs.get(r.id), r, p, source) ? recs.get(r.id) : await workOut(r, p, undefined, source);
        if (rec) {
          const next = applyRec((await db.rides.get(r.id)) ?? r, rec);
          score(next, p);
          await db.rides.put(next);
          changed++;
        }
      } catch { /* an unreadable file: left as it came */ }
      emit({ done: i + 1 });
      if (i % 25 === 24) { onChanged(); await new Promise((res) => setTimeout(res, 0)); }
    }
    emit({ running: false });
    if (changed) onChanged();
    return changed;
  })().finally(() => { running = null; });
  return running;
}

/** One activity changed over, as soon as its file is kept (Stage 1). */
export async function changeOne(id: string, score: (r: Ride, p: Profile) => void, onChanged: () => void): Promise<boolean> {
  const [r, p] = await Promise.all([db.rides.get(id), db.profile.get('me')]);
  if (!r || !p) return false;
  const rec = await workOut(r, p);
  if (!rec) return false;
  const next = applyRec(r, rec);
  score(next, p);
  await db.rides.put(next);
  onChanged();
  return true;
}
