import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import type { Profile, Workout } from '../engine/types';
import { buildTimeline } from '../player/timeline';
import { RideEngine, EASE_IN_S } from '../player/engine';
import { LIBRARY, libraryById } from './workouts';
import { flattenSteps, renderIntervalsText, workoutStats } from '../engine/workout';
import { encodeFitWorkout } from '../export/fitWorkout';
import { encodeZwo } from '../export/trainerFiles';
import { workoutOffers } from '../export/formats';
import { ALL_OUT_STANDIN } from './trains';

const profile = { id: 'me', ftp: 240, lthr: 160, maxHr: 180, weightKg: 70, basis: 'power', units: 'metric', masters: false, rideDays: [], hoursPerWeek: 6 } as unknown as Profile;
const sprintRide: Workout = {
  id: 't', name: 'T', kind: 'ride', family: 'anaerobic', purpose: '', phases: ['any'], bases: ['power'], setting: 'any', source: 'mine',
  blocks: [
    { kind: 'step', seconds: 60, intensity: 0.5, label: 'Warm up' },
    { kind: 'step', seconds: 10, intensity: ALL_OUT_STANDIN, allOut: true, label: 'Sprint, all out' },
    { kind: 'step', seconds: 120, intensity: 0.5, label: 'Easy' },
  ],
};

describe('all-out sprints', () => {
  it('the trainer lets go for the sprint and eases back in afterwards', () => {
    const tl = buildTimeline(sprintRide, profile);
    const e = new RideEngine({ timeline: tl, ftp: 240, basis: 'power', mode: 'erg', autoPause: false, guard: false }, 0);
    const live = { watts: 300, cadence: 100, speedKmh: 35 };
    const cmds: Array<unknown> = [];
    for (let i = 1; i <= 3 + 60 + 10 + 12; i++) { const o = e.tick(i * 1000, live); if (o.command) cmds.push({ t: i, ...o.command }); }
    // Warm-up held at 120 W, the sprint released (a flat road), then 60 W rising to 120 W over the first seconds.
    expect(cmds.some((c) => (c as { erg?: number }).erg === 120)).toBe(true);
    const free = cmds.findIndex((c) => (c as { grade?: number }).grade === 0 && (c as { t: number }).t > 10);
    expect(free).toBeGreaterThan(0);
    const after = cmds.slice(free + 1).map((c) => (c as { erg?: number }).erg).filter((x): x is number => x != null);
    expect(after[0]).toBeLessThan(120);
    expect(after[0]).toBeGreaterThanOrEqual(60);
    expect(after[after.length - 1]).toBe(120);
    expect(after.length).toBeLessThanOrEqual(EASE_IN_S + 1);
    // Nothing is recorded as a target during the sprint.
    expect(e.samples.filter((x) => x.s === 1).every((x) => x.tgt == null)).toBe(true);
  });
  it('the load estimate uses the stand-in, 180% of FTP', () => {
    expect(workoutStats([{ kind: 'step', seconds: 36, intensity: ALL_OUT_STANDIN, allOut: true }]).tss).toBe(Math.round((36 * 1.8 * 1.8) / 36));
  });
  it('goes to a bike computer as an open step named "Sprint, all out"', () => {
    expect(renderIntervalsText(sprintRide, 'power')).toContain('- Sprint, all out 10s freeride');
    expect(renderIntervalsText(sprintRide, 'hr')).toContain('- Sprint, all out 10s freeride');
    const msgs: Record<string, unknown[]> = {};
    new Decoder(Stream.fromByteArray(Array.from(encodeFitWorkout(sprintRide, 'power', profile)))).read({ mesgListener: (n: number, m: unknown) => { (msgs[n] ??= []).push(m); } });
    const steps = (msgs[27] ?? []) as Array<Record<string, unknown>>;
    const sprint = steps.find((s) => s.wktStepName === 'Sprint, all out')!;
    expect(sprint).toBeTruthy();
    expect(sprint.targetType).toBe('open');
  });
  it('exports: a free step in .zwo; .mrc and .erg say plainly why they cannot', () => {
    expect(encodeZwo(sprintRide)).toContain('<FreeRide Duration="10"');
    const offers = workoutOffers({ ...sprintRide, source: 'library' });
    const mrc = offers.find((o) => o.format === 'mrc')!;
    expect(mrc.ok).toBe(false);
    expect(mrc.why).toMatch(/all-out sprints/);
  });
  it('the Library sprints with a percentage target became all-out steps', () => {
    const converted = LIBRARY.filter((w) => !w.id.startsWith('g-') && flattenSteps(w.blocks).some((s) => s.allOut)).map((w) => w.id).sort();
    expect(converted).toEqual(['b1-mix-crit-70', 'b1-mix-fastgroup-135', 'b1-mix-granfondo-150', 'b2-breakaway', 'b2-roadrace', 'b2-sprint-flying', 'b2-sprint-standing', 'b2-sprint-tired', 'b2-z2-sprints-70', 'b3-group-sim-100', 'in-race-sim', 'lib-sprints', 'trail-group-150'].sort());
    for (const s of flattenSteps(libraryById('lib-sprints')!.blocks).filter((x) => x.allOut)) { expect(s.intensity).toBe(ALL_OUT_STANDIN); expect(s.intensityHigh).toBeUndefined(); }
  });
});
