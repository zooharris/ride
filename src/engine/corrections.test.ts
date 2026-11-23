import { describe, expect, it } from 'vitest';
import { applyCorrections, applyTotals, correctionsPending, correctRecording, fixSig, fixWords, partTotals, trimRecording, validTrim, withoutMeasure } from './corrections';
import type { Ride } from './types';

const T = Array.from({ length: 601 }, (_, i) => i);
const rec = { time: T, watts: T.map((i) => (i < 100 ? 0 : 200)), heartrate: T.map(() => 140), distance: T.map((i) => i * 8), altitude: T.map(() => 100),
  intervals: [{ start: 0, end: 100, avgWatts: 0 }, { start: 100, end: 400, avgWatts: 200 }, { start: 400, end: 600, avgWatts: 200 }], pauses: [[50, 80]] as Array<[number, number]> };
const ride = (): Ride => ({ id: 'a', date: '2026-07-24', startTime: '2026-07-24T16:47:13', name: 'Loudoun', type: 'Ride', sport: 'ride', seconds: 3600, elapsedSeconds: 3700, distanceM: 30000, normalizedPower: 200, averagePower: 190, intensityFactor: 0.8, averageHr: 140, maxHr: 165, efficiencyFactor: 1.43, decoupling: 2.1, powerZoneSeconds: [1, 2, 3], hrZoneSeconds: [4, 5] });

describe('the part of a recording kept', () => {
  it('time and distance start again from zero; laps and pauses are cut to fit', () => {
    const part = trimRecording(rec, 100, 500);
    expect(part.time[0]).toBe(0);
    expect(part.time[part.time.length - 1]).toBe(400);
    expect(part.watts!.every((w) => w === 200)).toBe(true);
    expect(part.distance![0]).toBe(0);
    expect(part.distance![part.distance!.length - 1]).toBe(3200);
    expect(part.intervals).toMatchObject([{ start: 0, end: 300, avgWatts: 200 }, { start: 300, end: 400 }]);
    expect(part.intervals![1].avgWatts).toBeUndefined();   // a lap cut short no longer has the whole lap's average
    expect(part.pauses).toEqual([]);
    expect(rec.time).toHaveLength(601);                    // the recording itself is not changed
  });
  it('totals of the part kept', () => {
    expect(partTotals(trimRecording(rec, 100, 500), 401)).toEqual({ elapsedSeconds: 400, movingSeconds: 400, distanceM: 3200, averageSpeedMs: 8 });
  });
  it('a sensible trim: inside the recording, at least ten seconds, and not the whole of it', () => {
    expect(validTrim({ from: 100, to: 500 }, 600)).toBe(true);
    expect(validTrim({ from: 0, to: 600 }, 600)).toBe(false);
    expect(validTrim({ from: 300, to: 305 }, 600)).toBe(false);
    expect(validTrim({ from: -5, to: 500 }, 600)).toBe(false);
    expect(validTrim(undefined, 600)).toBe(false);
  });
  it('a measure left out is gone from the recording and from its laps', () => {
    const noP = withoutMeasure(rec, { power: true });
    expect(noP.watts).toBeUndefined();
    expect(noP.heartrate).toBeDefined();
    expect(noP.intervals!.every((iv) => iv.avgWatts === undefined)).toBe(true);
    expect(correctRecording(rec, { trim: { from: 100, to: 500 }, noHr: true }).heartrate).toBeUndefined();
    expect(correctRecording(rec, {})).toBe(rec);
  });
  it('one word says what changes the numbers', () => {
    expect(fixSig(undefined)).toBe('');
    expect(fixSig({ ftp: 240, start: '2026-07-24T10:00:00' })).toBe('');
    expect(fixSig({ trim: { from: 100, to: 500 }, noPower: true })).toBe('t100-500p');
  });
});

describe('corrections laid over an activity, and taken away', () => {
  it('power left out: its numbers are set aside, and come back when the correction goes', () => {
    const r = applyCorrections(ride(), { noPower: true });
    expect(r.normalizedPower).toBeUndefined();
    expect(r.intensityFactor).toBeUndefined();
    expect(r.powerZoneSeconds).toBeUndefined();
    expect(r.efficiencyFactor).toBeUndefined();     // needs both power and heart rate
    expect(r.averageHr).toBe(140);
    expect(correctionsPending(r, { noPower: true })).toBe(false);
    expect(correctionsPending(r, {})).toBe(true);
    const back = applyCorrections(r, {});
    expect(back).toEqual(ride());
  });
  it('heart rate left out, and both at once', () => {
    const r = applyCorrections(ride(), { noHr: true });
    expect([r.averageHr, r.maxHr, r.hrZoneSeconds, r.decoupling]).toEqual([undefined, undefined, undefined, undefined]);
    expect(r.normalizedPower).toBe(200);
    const both = applyCorrections(r, { noHr: true, noPower: true });
    expect(both.normalizedPower).toBeUndefined();
    // Power counted again while heart rate is still out: what needs both stays hidden.
    const one = applyCorrections(both, { noHr: true });
    expect(one.normalizedPower).toBe(200);
    expect(one.efficiencyFactor).toBeUndefined();
    expect(applyCorrections(one, {})).toEqual(ride());
  });
  it('the start moved: the activity is on its new day, and back on its own when undone', () => {
    const r = applyCorrections(ride(), { start: '2026-07-23T18:47:00' });
    expect([r.date, r.startTime]).toEqual(['2026-07-23', '2026-07-23T18:47:00']);
    expect(r.setAside?.start).toEqual({ date: '2026-07-24', startTime: '2026-07-24T16:47:13' });
    // Laid over again (after a sync): nothing more changes.
    expect(applyCorrections({ ...r }, { start: '2026-07-23T18:47:00' })).toEqual(r);
    expect(applyCorrections(r, {})).toEqual(ride());
  });
  it("the part's totals laid over, with the whole recording's set aside; and put back", () => {
    const r = applyTotals(ride(), { elapsedSeconds: 3000, movingSeconds: 2990, distanceM: 24000, averageSpeedMs: 8, seconds: 2990 });
    expect([r.seconds, r.elapsedSeconds, r.distanceM]).toEqual([2990, 3000, 24000]);
    expect(r.setAside?.whole).toMatchObject({ seconds: 3600, elapsedSeconds: 3700, distanceM: 30000 });
    const back = applyTotals(r, undefined);
    expect(back).toEqual(ride());
  });
  it('each correction in force is said in a few words', () => {
    const w = fixWords({ ftp: 240, noPower: true, start: '2026-07-23T18:47:00', trim: { from: 600, to: 3500 } }, { clock: (s) => `${Math.floor(s / 60)}:00`, when: (iso) => iso.slice(0, 16) });
    expect(w.map((x) => x.text)).toEqual(['FTP for this ride set to 240 W by you', 'Power left out', 'Start moved to 2026-07-23T18:47', 'Trimmed to the part from 10:00 to 58:00 of the recording']);
  });
});
