import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannedWorkout, Profile, Workout } from '../engine/types';
import { renderIntervalsText } from '../engine/workout';
import { libraryById } from './workouts';
import { breathPowerVersion, breathStepText, breathZonesUsed, canSendByBreath, shapedForSend, withBreathText, worksByBreath } from './breathSend';
import { onGarmin, sendDefault, sendWords } from './sendWhere';
import { db, setSetting } from '../data/db';
import { BREATH_TABLE, type BreathPowerTable } from '../player/breathControl';
import { curveRecord } from '../ui/powerCurves';
import sendSrc from '../ui/SendButton.tsx?raw';
import ridesSrc from '../ui/screens/Rides.tsx?raw';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

/** Breathing outdoors (Step 6 brief, 11 Nov 2026). Example numbers, nobody's own. */
const rider = (more: Partial<Profile> = {}) => ({ id: 'me', name: 'R', ftp: 250, lthr: 160, maxHr: 185, restingHr: 50, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6, vt1Ve: 60, vt2Ve: 90, ...more }) as Profile & { id: 'me' };
const ride = libraryById('b2-thr-3x15')!;          // works by heart rate, so by breathing
const powerOnly = libraryById('b2-vo2-8x2')!;      // power only
const fullTable = (p: Profile, w: Workout): BreathPowerTable => Object.fromEntries(breathZonesUsed(w, p).map((z) => [z, { watts: 100 + z * 40, at: '2026-11-01', n: 3 }]));

describe('each step’s breathing target goes in its text', () => {
  it('a range and a ceiling, in words Intervals.icu won’t read as a target', () => {
    const p = rider();
    const t = breathStepText({ kind: 'step', seconds: 900, intensity: 0.91, intensityHigh: 0.96 }, p)!;
    expect(t).toMatch(/^breathing \d+ to \d+ litres a minute$/);
    expect(breathStepText({ kind: 'step', seconds: 600, intensity: 0.55, noFloor: true }, p)).toMatch(/^breathing under \d+ litres a minute$/);
    expect(t).not.toMatch(/%|bpm|\d\s*(w|m|s|h|rpm)\b/i);
  });
  it('added for a rider with zones on a ride that works by breathing; nothing otherwise', () => {
    const text = renderIntervalsText(withBreathText(ride, rider()), 'power');
    expect(text).toMatch(/Threshold · breathing \d+ to \d+ litres a minute 15m 91-96%/);
    expect(renderIntervalsText(withBreathText(ride, rider({ vt2Ve: undefined })), 'power')).not.toMatch(/breathing/);
    expect(renderIntervalsText(withBreathText(powerOnly, rider()), 'power')).not.toMatch(/breathing/);
  });
});

describe('a third way to send: by breathing', () => {
  it('offered only for a ride that works by breathing, and pressable only when the learned watts cover it', () => {
    const p = rider();
    expect(worksByBreath(ride, p)).toBe(true);
    expect(worksByBreath(powerOnly, p)).toBe(false);
    expect(canSendByBreath(ride, p, {})).toBe(false);
    const t = fullTable(p, ride);
    expect(canSendByBreath(ride, p, t)).toBe(true);
    const [first, ...rest] = breathZonesUsed(ride, p);
    expect(canSendByBreath(ride, p, Object.fromEntries(rest.map((z) => [z, t[z]])))).toBe(first == null);
  });
  it('sends power from the table for steered steps; short steps keep their planned watts', () => {
    const p = rider();
    const t = fullTable(p, ride);
    const v = breathPowerVersion(ride, p, t);
    const work = (v.blocks.find((b) => b.kind === 'repeat') as Extract<Workout['blocks'][number], { kind: 'repeat' }>).steps[0];
    const z = breathZonesUsed(ride, p).includes(3) ? 3 : breathZonesUsed(ride, p)[0];
    expect(work.intensity).toBeGreaterThan(0);
    expect(work.intensityHigh).toBeGreaterThan(work.intensity);
    const short = libraryById('b2-vo2-3015')!;   // 30/15s: the efforts are short
    const flat = (w: Workout) => w.blocks.flatMap((b) => (b.kind === 'step' ? [b] : b.steps));
    const before = flat(short), after = flat(breathPowerVersion(short, p, { [z]: { watts: 300, at: 'x', n: 1 }, 1: { watts: 120, at: 'x', n: 1 }, 2: { watts: 160, at: 'x', n: 1 }, 4: { watts: 260, at: 'x', n: 1 } }));
    before.forEach((st, i) => { if (st.seconds < 120) expect(after[i]).toEqual(st); });
    const shaped = shapedForSend(ride, 'breath', p, t);
    expect(shaped.targets).toBe('power');
    expect(renderIntervalsText(shaped.workout, 'power')).toMatch(/breathing \d+ to \d+ litres a minute/);
  });
  it('the words: the button, the page and the Calendar row', () => {
    expect(sendWords({ basis: 'breath' })).toBe('by breathing');
    expect(sendDefault({ date: '2026-11-14' }, ride, 'power', [], true).basis).toBe('breath');
    const sent = { id: 'e', date: '2026-11-14', workoutId: ride.id, basis: 'power', status: 'sent', sentBasis: 'power', sentBreath: true } as PlannedWorkout;
    expect(onGarmin(sent, ride, []).basis).toBe('breath');
    expect(sendSrc).toMatch(/\(as power\)/);
    expect(sendSrc).toMatch(/All by breathing/);
    expect(sendSrc).toMatch(/'breath' \? 'by breathing'/);
  });
});

describe('the send itself', () => {
  const bodies: Array<{ description: string }> = [];
  beforeEach(async () => {
    await db.delete(); await db.open();
    bodies.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { if (init?.method === 'POST' && init.body) bodies.push(JSON.parse(init.body as string)); return new Response(JSON.stringify({ id: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }));
  });
  afterEach(() => vi.unstubAllGlobals());
  it('by breathing goes as power and is recorded as by breathing; a re-send keeps it', async () => {
    const p = rider();
    await db.profile.put(p);
    await setSetting(BREATH_TABLE, fullTable(p, ride));
    const { sendPlanned } = await import('../ui/planService');
    const e: PlannedWorkout = { id: 'e1', date: '2026-11-14', workoutId: ride.id, basis: 'power', status: 'planned' };
    await db.planned.put(e);
    const r = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, e, ride, p, { basis: 'breath' });
    expect(r.sent.basis).toBe('breath');
    expect(bodies[0].description).toMatch(/breathing \d+ to \d+ litres a minute/);
    const after = (await db.planned.get('e1'))!;
    expect(after).toMatchObject({ status: 'sent', sentBasis: 'power', sentBreath: true });
    const again = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, after, ride, p);
    expect(again.sent.basis).toBe('breath');
  });
  it('asked by breathing without the learned watts: it goes the rider’s usual way', async () => {
    const p = rider();
    await db.profile.put(p);
    const { sendPlanned } = await import('../ui/planService');
    const e: PlannedWorkout = { id: 'e2', date: '2026-11-14', workoutId: ride.id, basis: 'power', status: 'planned' };
    await db.planned.put(e);
    const r = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, e, ride, p, { basis: 'breath' });
    expect(r.sent.basis).toBe('power');
    expect((await db.planned.get('e2'))!.sentBreath).toBeUndefined();
  });
});

describe('Garmin-recorded breathing counts', () => {
  it('a ride’s breathing feeds the learning whatever recorded it, with a frozen stretch cut', () => {
    const p = rider();
    const n = 1800;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = time.map((t) => (t < 600 ? 150 : 200));
    const ve = time.map((t) => (t < 1500 ? (t < 600 ? 40 : 55) + (t % 7) * 0.1 : 55));     // frozen at 55 from 1500 s
    const rec = curveRecord({ id: 'g1', date: '2026-11-10' }, { time, watts, heartrate: time.map(() => 140), ve, br: time.map((t) => (t < 1500 ? 25 + (t % 5) * 0.1 : 25)), tv: time.map(() => 2) }, { profile: p, sessionOf: () => undefined });
    expect(rec.breathAtPower?.length).toBeGreaterThan(0);
    expect(rec.veAtPower?.length).toBeGreaterThan(0);
  });
  it('a ride sent or ridden by breathing, with breathing, is judged by it on its page', () => {
    expect(ridesSrc).toMatch(/Intervals against plan, by breathing/);
    expect(ridesSrc).toMatch(/p\?\.rodeByBreath \|\| p\?\.sentBreath/);
  });
});
