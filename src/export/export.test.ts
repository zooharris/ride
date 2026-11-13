import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import type { Profile, Ride, Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import { flattenSteps, NO_FLOOR, stepIntensity, workoutSeconds } from '../engine/workout';
import { powerToHrFraction, rideLadders } from '../engine/zones';
import { versionFor, hasTwoVersions } from '../library/sendWhere';
import { encodeFitWorkout } from './fitWorkout';
import { encodeMrcErg, encodeZwo, heldPower } from './trainerFiles';
import { workoutFile, workoutOffers, workoutExportable, type WorkoutFormat } from './formats';
import { sessionDocument, isOpenEffort } from './workoutText';
import { encodeFitActivity, encodeGpx, encodeTcx, type ActivityStreams } from './activityFiles';
import { crc32, unzip, zip } from './zip';
import { exportFileName, NameBook, safeName } from './names';
import { makerOf, originOf, originalKind, summaryText } from './activity';
import { csv, readMe, runBulk, type ExportItem, type WorkoutItem } from './bulk';
import { encodeFit } from '../player/fit';
import { totals } from '../player/summary';
import type { Recording } from '../player/types';

const profile: Profile = { name: 'Test rider', ftp: 250, lthr: 165, maxHr: 182, restingHr: 52, weightKg: 70, basis: 'power', masters: true, units: 'metric', rideDays: [1, 3, 5], hoursPerWeek: 6 };

function decode(bytes: Uint8Array) {
  const d = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  expect(d.isFIT()).toBe(true);
  expect(d.checkIntegrity()).toBe(true);
  const r = d.read();
  expect(r.errors).toEqual([]);
  return r.messages;
}

/** The workout steps a FIT workout holds, with repeats written out, as [seconds, low, high, target]. */
function playSteps(m: ReturnType<typeof decode>): Array<{ sec: number; low?: number; high?: number; target: string; cad?: number }> {
  const steps = m.workoutStepMesgs ?? [];
  const out: Array<{ sec: number; low?: number; high?: number; target: string; cad?: number }> = [];
  const one = (s: Record<string, unknown>) => out.push({ sec: Number(s.durationTime ?? s.durationValue), low: (s.customTargetPowerLow ?? s.customTargetHeartRateLow) as number | undefined, high: (s.customTargetPowerHigh ?? s.customTargetHeartRateHigh) as number | undefined, target: String(s.targetType), cad: s.secondaryCustomTargetCadenceLow as number | undefined });
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as Record<string, unknown>;
    if (s.durationType !== 'repeatUntilStepsCmplt') { one(s); continue; }
    const from = Number(s.durationStep ?? s.durationValue);
    const times = Number(s.repeatSteps ?? s.targetValue);
    // The steps before this repeat step from `from` were already played once.
    const block = out.slice(out.length - (i - from));
    for (let k = 1; k < times; k++) out.push(...block);
  }
  return out;
}

const rides = LIBRARY.filter((w) => w.kind === 'ride');
const sessions = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars', 'treadmill', 'outdoor-walk']);

describe('Garmin workout files', () => {
  it('every Library ride, each way it works and in each version, is a valid file matching its steps', () => {
    let files = 0;
    for (const w of rides) {
      if (!workoutExportable(w).ok) continue;
      for (const basis of w.bases) {
        for (const where of hasTwoVersions(w) ? (['outdoor', 'trainer'] as const) : (['trainer'] as const)) {
          const v = versionFor(w, where).workout;
          const m = decode(encodeFitWorkout(v, basis, profile));
          files++;
          expect(m.fileIdMesgs![0]).toMatchObject({ type: 'workout', manufacturer: 'development' });
          expect(m.workoutMesgs![0]).toMatchObject({ sport: 'cycling' });
          const played = playSteps(m);
          const flat = flattenSteps(v.blocks);
          expect(played.map((s) => s.sec), w.name).toEqual(flat.map((s) => s.seconds));
          flat.forEach((s, i) => {
            const p = played[i];
            if (isOpenEffort(w, s)) { expect(p.target).toBe('open'); return; }
            if (basis === 'power') {
              expect(p.target).toBe('power');
              expect(p.high).toBe(Math.round((s.intensityHigh ?? s.intensity) * 100));
              expect(p.low).toBe(Math.round((s.noFloor ? NO_FLOOR.power : s.intensity) * 100));
            } else {
              const l = rideLadders(profile);
              expect(p.target).toBe('heartRate');
              expect(p.high! - 100).toBe(Math.round(powerToHrFraction(s.intensityHigh ?? s.intensity, l.hr, l.power) * profile.lthr));
            }
            if (s.cadence) expect(p.cad).toBe(s.cadence);
          });
        }
      }
    }
    expect(files).toBeGreaterThan(150);
  });

  it('runs and walks go by heart rate on the foot table', () => {
    const runs = sessions.filter((w) => w.kind === 'run');
    const walks = sessions.filter((w) => w.kind === 'walk');
    expect(runs.length).toBeGreaterThan(0);
    for (const w of [...runs, ...walks]) {
      const m = decode(encodeFitWorkout(w, 'hr', profile));
      expect(m.workoutMesgs![0].sport).toBe(w.kind === 'run' ? 'running' : 'walking');
      for (const s of m.workoutStepMesgs!) if ((s as { durationType: string }).durationType !== 'repeatUntilStepsCmplt') expect(['heartRate', 'open']).toContain((s as { targetType: string }).targetType);
    }
  });

  it('carries the step names and cues', () => {
    const w = rides.find((x) => flattenSteps(x.blocks).some((s) => s.cues?.length && s.label))!;
    const m = decode(encodeFitWorkout(w, 'power', profile));
    const names = m.workoutStepMesgs!.map((s) => (s as { wktStepName?: string }).wktStepName).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    expect(m.workoutStepMesgs!.some((s) => !!(s as { notes?: string }).notes)).toBe(true);
  });
});

describe('Zwift, .mrc and .erg files', () => {
  it('every power ride writes all three, step for step', () => {
    for (const w of rides.filter((x) => x.bases.includes('power') && workoutExportable(x).ok)) {
      const flat = flattenSteps(w.blocks);
      const zwo = encodeZwo(w);
      expect(zwo.startsWith('<workout_file>')).toBe(true);
      const steps = [...zwo.matchAll(/<(SteadyState|FreeRide) Duration="(\d+)"(?: Power="([\d.]+)")?/g)];
      expect(steps.map((m) => Number(m[2])), w.name).toEqual(flat.map((s) => s.seconds));
      steps.forEach((m, i) => { if (m[1] === 'SteadyState') expect(Number(m[3])).toBeCloseTo(heldPower(flat[i]), 3); else expect(isOpenEffort(w, flat[i])).toBe(true); });
      if (flat.some((s) => isOpenEffort(w, s))) continue;
      const mrc = encodeMrcErg(w, 'mrc', profile.ftp);
      const erg = encodeMrcErg(w, 'erg', profile.ftp);
      const rows = (t: string) => t.split('[COURSE DATA]')[1].split('[END COURSE DATA]')[0].trim().split(/\r\n/).map((l) => l.split('\t').map(Number));
      const m = rows(mrc), e = rows(erg);
      expect(m.length).toBe(flat.length * 2);
      expect(m[m.length - 1][0]).toBeCloseTo(workoutSeconds(w.blocks) / 60, 1);
      flat.forEach((s, i) => { expect(m[i * 2][1]).toBe(Math.round(heldPower(s) * 100)); expect(e[i * 2][1]).toBe(Math.round(heldPower(s) * profile.ftp)); });
      expect(erg).toContain(`FTP = ${profile.ftp}`);
    }
  });
  it('escapes names and cues safely', () => {
    const w: Workout = { ...rides[0], name: 'Tom & Jerry <fast> "ride"', blocks: [{ kind: 'step', seconds: 60, intensity: 0.6, label: 'A & B', cues: [{ at: 10, text: 'Say "go" & <push>' }] }] };
    const z = encodeZwo(w);
    expect(z).toContain('Tom &amp; Jerry &lt;fast&gt; &quot;ride&quot;');
    expect(z).toContain('message="Say &quot;go&quot; &amp; &lt;push&gt;"');
  });
});

describe('what is offered, and why not', () => {
  const powerOnly = rides.find((w) => w.bases.length === 1 && w.bases[0] === 'power' && !w.trainerOnly)!;
  const hrOnly = rides.find((w) => w.bases.length === 1 && w.bases[0] === 'hr')!;
  const both = rides.find((w) => w.bases.length === 2 && !w.family.startsWith('test'))!;
  const ok = (w: Workout, b: 'power' | 'hr', f: WorkoutFormat) => workoutOffers(w, b).find((o) => o.format === f)!;
  it('a heart-rate download offers only the Garmin file', () => {
    expect(ok(both, 'hr', 'fit').ok).toBe(true);
    for (const f of ['zwo', 'mrc', 'erg'] as const) { expect(ok(both, 'hr', f).ok).toBe(false); expect(ok(both, 'hr', f).why).toMatch(/heart-rate/); }
  });
  it('a heart-rate-only ride offers only the Garmin file', () => {
    expect(ok(hrOnly, 'hr', 'zwo').ok).toBe(false);
    expect(ok(hrOnly, 'hr', 'zwo').why).toMatch(/heart rate only/);
  });
  it('a power ride offers all four', () => {
    expect(workoutOffers(powerOnly, 'power').every((o) => o.ok)).toBe(true);
  });
  it('the Ramp Test is not offered, with the reason', () => {
    const ramp = LIBRARY.find((w) => w.test === 'ramp')!;
    expect(workoutExportable(ramp).ok).toBe(false);
    expect(workoutOffers(ramp)).toEqual([]);
  });
  it('the 20-minute test leaves its effort free, and the formats that can’t are refused', () => {
    const t = LIBRARY.find((w) => w.test === '20min')!;
    expect(ok(t, 'power', 'zwo').ok).toBe(true);
    expect(ok(t, 'power', 'erg').ok).toBe(false);
    const m = decode(encodeFitWorkout(t, 'power', profile));
    expect(m.workoutStepMesgs!.some((s) => (s as { targetType: string }).targetType === 'open')).toBe(true);
  });
  it('strength and mobility go as a readable list', () => {
    const s = sessions.find((w) => w.kind === 'strength')!;
    expect(workoutOffers(s)).toEqual([{ format: 'text', ok: true }]);
    const doc = sessionDocument(s, { date: '2026-11-14' });
    expect(doc).toContain(s.name);
    for (const e of s.exercises!) expect(doc).toContain(e.name);
    const f = workoutFile(s, 'text', { basis: 'power' }, profile, {}, '2026-11-14');
    expect(f.name).toBe(`2026-11-14 ${s.name}${/strength$/i.test(s.name) ? '' : ' strength'}.txt`);
  });
});

const ride: Ride = {
  id: 'a1', date: '2026-11-08', startTime: '2026-11-08T09:00:00', name: 'Morning ride', type: 'Ride', sport: 'ride', seconds: 600, movingSeconds: 600, elapsedSeconds: 600,
  distanceM: 5000, tss: 12, averagePower: 180, averageHr: 130, maxHr: 150, normalizedPower: 185, elevationM: 40, device: 'Garmin Edge 840',
};
const streams: ActivityStreams = (() => {
  const n = 600;
  const t = Array.from({ length: n }, (_, i) => i);
  return {
    time: t, watts: t.map((i) => 150 + (i % 60)), heartrate: t.map((i) => 120 + Math.floor(i / 20)), cadence: t.map(() => 88),
    distance: t.map((i) => i * 8.3), altitude: t.map((i) => 100 + Math.sin(i / 50) * 10), velocity: t.map(() => 8.3), temp: t.map(() => -2),
    lat: t.map((i) => 38.9 + i * 0.0001), lng: t.map((i) => -77.3 - i * 0.0001),
  };
})();

describe('activity files from the record', () => {
  it('FIT reads back with the record and the totals', () => {
    const m = decode(encodeFitActivity(ride, streams));
    expect(m.fileIdMesgs![0].type).toBe('activity');
    expect(m.recordMesgs!).toHaveLength(600);
    const r = m.recordMesgs![300] as Record<string, number>;
    expect(r.power).toBe(streams.watts![300]);
    expect(r.heartRate).toBe(streams.heartrate![300]);
    expect(r.temperature).toBe(-2);
    expect(r.positionLat / (2 ** 31 / 180)).toBeCloseTo(streams.lat![300], 5);
    expect(r.positionLong / (2 ** 31 / 180)).toBeCloseTo(streams.lng![300], 5);
    expect(r.altitude).toBeCloseTo(streams.altitude![300], 0);
    const s = m.sessionMesgs![0] as Record<string, unknown>;
    expect(s.sport).toBe('cycling');
    expect(s.totalDistance).toBeCloseTo(5000, 0);
    expect(s.avgPower).toBe(180);
    expect(s.normalizedPower).toBe(185);
    expect(s.totalTimerTime).toBe(600);
  });
  it('a walk and a strength session keep their kind', () => {
    expect((decode(encodeFitActivity({ ...ride, sport: 'walk', type: 'Walk' }, streams)).sessionMesgs![0] as { sport: string }).sport).toBe('walking');
    const st = decode(encodeFitActivity({ ...ride, sport: 'strength', type: 'WeightTraining' }, { time: streams.time, heartrate: streams.heartrate })).sessionMesgs![0] as { sport: string; subSport: string };
    expect(st).toMatchObject({ sport: 'training', subSport: 'strengthTraining' });
  });
  it('breathing goes in as the strap maker’s own fields', () => {
    const withBreath = { ...streams, ve: streams.time.map(() => 60), br: streams.time.map(() => 30), tv: streams.time.map(() => 2) };
    const m = decode(encodeFitActivity(ride, withBreath));
    expect(m.fieldDescriptionMesgs!.map((f) => (f as { fieldName: string }).fieldName)).toContain('tyme_minute_volume');
  });
  it('TCX and GPX carry the points', () => {
    const tcx = encodeTcx(ride, streams);
    expect((tcx.match(/<Trackpoint>/g) ?? []).length).toBe(600);
    expect(tcx).toContain('<ns3:Watts>');
    expect(tcx).toContain('Sport="Biking"');
    const gpx = encodeGpx(ride, streams);
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(600);
    expect(gpx).toContain('<gpxtpx:hr>');
  });
  it('the player’s file for a player ride is the same file the player gives', async () => {
    const rec: Recording = { id: 'p', status: 'uploaded', startedAt: '2026-11-08T09:00:00', startMs: Date.UTC(2026, 10, 8, 14), date: '2026-11-08', name: 'Indoor', basis: 'power', ftp: 250, lthr: 165, samples: [{ t: 0, w: 100 }, { t: 1, w: 110 }], laps: [{ start: 0, end: 2 }], events: [], timerSeconds: 2, distanceM: 0, savedMs: 0 };
    const { activityFile } = await import('./activity');
    const got = await activityFile(null, { ...ride, id: 'p' }, 'fit', { antogo: true, source: 'Antogo’s ride player' }, rec);
    expect(got.how).toBe('player');
    expect(Array.from(got.file.data as Uint8Array)).toEqual(Array.from(encodeFit(rec, totals(rec.samples, rec.ftp, rec.lthr, undefined, rec.basis))));
  });
});

describe('where an activity came from', () => {
  it('reads the maker from the device', () => {
    expect(makerOf('Garmin Edge 840')).toBe('Garmin');
    expect(makerOf('ELEMNT ROAM')).toBe('Wahoo');
    expect(makerOf('Apple Watch Series 9')).toBe('Apple');
    expect(makerOf('Some New Thing')).toBe('Some New Thing');
    expect(makerOf(undefined)).toBeUndefined();
  });
  it('knows Antogo’s own, and says "unknown source" otherwise', () => {
    expect(originOf({ id: 'x', device: 'Garmin Edge' }, [{ id: 'x', date: '', source: 'veloiq' }], [], new Set()).antogo).toBe(true);
    expect(originOf({ id: 'y' }, [], [{ id: 'p', date: '', workoutId: 'w', basis: 'power', status: 'completed', manualActivityId: 'y' }], new Set()).antogo).toBe(true);
    expect(originOf({ id: 'z' }, [], [], new Set())).toEqual({ antogo: false, source: 'unknown source' });
  });
  it('recognises an original file’s kind', () => {
    expect(originalKind(encodeFitActivity(ride, streams))).toBe('fit');
    expect(originalKind(new TextEncoder().encode(encodeTcx(ride, streams)))).toBe('tcx');
    expect(originalKind(new TextEncoder().encode(encodeGpx(ride, streams)))).toBe('gpx');
  });
  it('a summary-only activity is said to be one', () => {
    expect(summaryText(ride, { antogo: false, source: 'Garmin' })).toMatch(/Only a summary/);
  });
});

describe('file names and folders', () => {
  it('names sort and identify themselves, and are safe', () => {
    expect(exportFileName('2026-11-08', 'Lovettsville', 'ride', 'fit')).toBe('2026-11-08 Lovettsville ride.fit');
    expect(exportFileName('2026-11-08', 'Easy walk', 'walk', 'fit')).toBe('2026-11-08 Easy walk.fit');
    expect(safeName('a/b:c*d?"e<f>g|h', 'fit')).toBe('a b c d e f g h.fit');
    expect(safeName('Café Élan', 'tcx')).toBe('Café Élan.tcx');
    expect(safeName('CON', 'fit')).toBe('Antogo CON.fit');
    expect(safeName('x'.repeat(200), 'fit').length).toBeLessThanOrEqual(84);
    expect(safeName('trailing dots...', 'fit')).toBe('trailing dots.fit');
  });
  it('two activities with the same name on the same day never collide', () => {
    const b = new NameBook();
    expect(b.take('2026-11-08 Ride ride.fit')).toBe('2026-11-08 Ride ride.fit');
    expect(b.take('2026-11-08 Ride ride.fit')).toBe('2026-11-08 Ride ride (2).fit');
    expect(b.take('2026-11-08 RIDE ride.fit')).toBe('2026-11-08 RIDE ride (3).fit');
  });
  it('the zip folder reads back exactly', () => {
    const files = [{ name: 'f/one.txt', data: 'hello' }, { name: 'f/Café.fit', data: new Uint8Array([1, 2, 3, 255]) }];
    const back = unzip(zip(files));
    expect(back.map((x) => x.name)).toEqual(['f/one.txt', 'f/Café.fit']);
    expect(new TextDecoder().decode(back[0].data)).toBe('hello');
    expect(Array.from(back[1].data)).toEqual([1, 2, 3, 255]);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('the list escapes what a spreadsheet would misread', () => {
    const t = csv([{ date: '2026-11-08', name: 'Ride, "fast"', kind: 'Ride', length: '1:00:00', load: '50', from: 'Garmin', file: 'x.fit', how: 'record' }, { date: '', name: '=SUM(A1)', kind: 'Ride', length: '', load: '', from: '', file: '', how: '' }]);
    expect(t).toContain('"Ride, ""fast"""');
    expect(t).toContain(`"'=SUM(A1)"`);
  });
});

describe('the bulk export', () => {
  it('mixed kinds and sources: a folder with the note, the list and every file', async () => {
    const strength = sessions.find((w) => w.kind === 'strength')!;
    const both = rides.find((w) => w.bases.length === 2 && !w.family.startsWith('test'))!;
    const ramp = LIBRARY.find((w) => w.test === 'ramp')!;
    const items: ExportItem[] = [
      { kind: 'workout', w: both, date: '2026-11-14', choice: { basis: 'hr' }, from: 'Antogo Library' },
      { kind: 'workout', w: strength, choice: { basis: 'power' }, from: 'Antogo Library' },
      { kind: 'workout', w: ramp, choice: { basis: 'power' }, from: 'Antogo Library' },
    ];
    const res = await runBulk({ items, actFormat: 'fit', wkFormat: 'zwo', unfit: 'fallback', profile, table: {}, credentials: null, gapMs: 0, now: new Date(2026, 10, 12, 20, 0) });
    expect(res.parts).toHaveLength(1);
    const files = unzip(res.parts[0].data as Uint8Array);
    const names = files.map((f) => f.name.replace(/^Antogo export 2026-11-12\//, ''));
    expect(names).toContain('Read me first.txt');
    expect(names).toContain('List of everything.csv');
    // The heart-rate ride can't go to Zwift, so it falls back to the Garmin file; strength is a list; the ramp is left out.
    expect(names.some((n) => n.endsWith(' ride.fit'))).toBe(true);
    expect(names.some((n) => n.endsWith('.txt') && n !== 'Read me first.txt')).toBe(true);
    expect(res.skipped.map((s) => s.name)).toEqual([ramp.name]);
    const note = new TextDecoder().decode(files.find((f) => f.name.endsWith('Read me first.txt'))!.data);
    expect(note).toMatch(/LEFT OUT/);
    expect(note).toMatch(/Ramp Test/);
    expect(note).toMatch(/beats per minute/);
  });
  it('skip leaves out what the format can’t carry', async () => {
    const both = rides.find((w) => w.bases.length === 2 && !w.family.startsWith('test'))!;
    const res = await runBulk({ items: [{ kind: 'workout', w: both, choice: { basis: 'hr' }, from: 'x' }], actFormat: 'fit', wkFormat: 'erg', unfit: 'skip', profile, table: {}, credentials: null, gapMs: 0 });
    expect(res.done).toBe(0);
    expect(res.skipped).toHaveLength(1);
  });
  it('a cancel stops part-way and keeps what was made', async () => {
    let n = 0;
    const items: ExportItem[] = rides.slice(0, 10).map((w) => ({ kind: 'workout', w, choice: { basis: 'power' }, from: 'x' }));
    const res = await runBulk({ items, actFormat: 'fit', wkFormat: 'fit', unfit: 'fallback', profile, table: {}, credentials: null, gapMs: 0, cancelled: () => ++n > 4 });
    expect(res.cancelled).toBe(true);
    expect(res.done).toBe(4);
  });
  it('a failing item is listed and the rest carry on', async () => {
    const bad = { ...rides[0], blocks: null as unknown as Workout['blocks'] };
    const res = await runBulk({ items: [{ kind: 'workout', w: bad, choice: { basis: 'power' }, from: 'x' }, { kind: 'workout', w: rides[1], choice: { basis: 'power' }, from: 'x' }], actFormat: 'fit', wkFormat: 'fit', unfit: 'fallback', profile, table: {}, credentials: null, gapMs: 0 });
    expect(res.failed).toHaveLength(1);
    expect(res.done).toBe(1);
  });
  it('the note lists where activities came from', () => {
    const note = readMe({ at: new Date(2026, 10, 12), rows: [{ date: '2026-11-08', name: 'x', kind: 'Ride', length: '', load: '', from: 'Garmin', file: 'x.fit', how: 'original' }], failed: [], skipped: [], ftp: 250, ergUsed: true, hrUsed: false, how: { original: 1, player: 0, record: 0, summary: 0 }, sources: { Garmin: 1 } });
    expect(note).toMatch(/1 from Garmin/);
    expect(note).toMatch(/duplicate/);
    expect(note).toMatch(/FTP of 250 W/);
  });
  it('splits a very large history into numbered folders, each with its note and list', async () => {
    const items: ExportItem[] = rides.slice(0, 6).map((w) => ({ kind: 'workout', w, choice: { basis: 'power' }, from: 'x' }));
    const res = await runBulk({ items, actFormat: 'fit', wkFormat: 'zwo', unfit: 'fallback', profile, table: {}, credentials: null, gapMs: 0, partBytes: 3000 });
    expect(res.parts.length).toBeGreaterThan(1);
    expect(res.parts[0].name).toMatch(/part 1\.zip$/);
    expect(res.parts[res.parts.length - 1].name).toMatch(/part \d+ \(the last\)\.zip$/);
    let total = 0;
    for (const p of res.parts) {
      const files = unzip(p.data as Uint8Array);
      expect(files.some((f) => f.name.endsWith('Read me first.txt'))).toBe(true);
      expect(new TextDecoder().decode(files.find((f) => f.name.endsWith('Read me first.txt'))!.data)).toMatch(/\(part \d/);
      total += files.length - 2;
    }
    expect(total).toBe(6);
  });
  it('hands over each folder as it fills, before the last is built, and keeps none of it (12 Nov 2026)', async () => {
    const items: ExportItem[] = rides.slice(0, 6).map((w) => ({ kind: 'workout', w, choice: { basis: 'power' }, from: 'x' }));
    const order: string[] = [];
    const res = await runBulk({ items, actFormat: 'fit', wkFormat: 'zwo', unfit: 'fallback', profile, table: {}, credentials: null, gapMs: 0, partBytes: 3000,
      onProgress: (done, total, now) => { if (now) order.push(`item ${done + 1}`); }, onPart: (f, n, last) => order.push(`part ${n}${last ? ' last' : ''}`) });
    expect(res.parts).toEqual([]);   // nothing held: every folder went to the page as it was made
    expect(res.partCount).toBeGreaterThan(1);
    expect(order.indexOf('part 1')).toBeGreaterThan(-1);
    expect(order.indexOf('part 1')).toBeLessThan(order.indexOf('item 6'));
    expect(order[order.length - 1]).toMatch(/last$/);
  });
  it('a device that runs short stops cleanly, keeping the folders made, and says where to carry on', async () => {
    const items: ExportItem[] = rides.slice(0, 6).map((w) => ({ kind: 'workout', w, choice: { basis: 'power' }, from: 'x' }));
    // The fourth workout's file cannot be made: the device is out of memory.
    const w3 = { ...(items[3] as WorkoutItem).w };
    Object.defineProperty(w3, 'blocks', { get() { throw new RangeError('Array buffer allocation failed'); } });
    items[3] = { ...(items[3] as WorkoutItem), w: w3 };
    const got: string[] = [];
    const res = await runBulk({ items, actFormat: 'fit', wkFormat: 'zwo', unfit: 'fallback', profile, table: {}, credentials: null, gapMs: 0, partBytes: 3000, onPart: (f) => got.push(f.name) });
    expect(res.stoppedAt).toBe(3);
    expect(res.done).toBe(3);
    expect(got.length).toBeGreaterThan(0);
    expect(res.failed).toEqual([]);
  });
});

describe('every held power is a real step', () => {
  it('a range is held at its middle, "up to" at the effort expected', () => {
    expect(heldPower({ kind: 'step', seconds: 60, intensity: 0.88, intensityHigh: 0.92 })).toBeCloseTo(0.9);
    expect(heldPower({ kind: 'step', seconds: 60, intensity: 0.5, intensityHigh: 0.55, noFloor: true })).toBe(0.5);
    expect(stepIntensity({ kind: 'step', seconds: 60, intensity: 0.7 })).toBe(0.7);
  });
});
