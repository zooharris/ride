import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hrCue, hrSlot, zoneWords, type CueState } from './hrCue';
import { buildTimeline, cueAt } from './timeline';
import { LIBRARY } from '../library/workouts';
import { flattenStepsWithSets } from '../engine/workout';
import type { Profile } from '../engine/types';

/** One message line in the ride player (10 Nov 2026). */

const profile: Profile = { name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 75, basis: 'hr', masters: false, units: 'imperial', rideDays: [], hoursPerWeek: 6 };

describe('the heart-rate card holds one message at most', () => {
  it('out of zone for 20 seconds on a step with a cue: one instruction in the card, one cue under the dial', () => {
    const spyRock = LIBRARY.find((w) => w.name === 'Spy Rock')!;
    const effort = buildTimeline(spyRock, profile).find((s) => s.name === 'VO2max')!;
    // Heart rate low for 25 seconds.
    let st: CueState = {};
    let cue;
    for (let t = 0; t <= 25; t++) ({ state: st, cue } = hrCue(st, 120, { low: 160, high: 168 }, false, t));
    const slot = hrSlot({ adjusting: false, cue });
    expect(slot).toEqual({ kind: 'signal', cue: 'under' });
    expect(cueAt(effort, 25)).toMatch(/Start firm/);
  });

  it('in zone, or before 20 seconds: the slot is empty, not a sentence', () => {
    expect(hrSlot({ adjusting: false })).toEqual({ kind: 'none' });
    let st: CueState = {};
    let cue;
    for (let t = 0; t <= 10; t++) ({ state: st, cue } = hrCue(st, 120, { low: 160, high: 168 }, false, t));
    expect(hrSlot({ adjusting: false, cue })).toEqual({ kind: 'none' });
  });

  it('with the trainer steering, the slot carries the trainer’s own account instead', () => {
    expect(hrSlot({ adjusting: true, status: 'Trainer is holding 185 W to keep you in zone 2.', cue: 'under' })).toEqual({ kind: 'status', text: 'Trainer is holding 185 W to keep you in zone 2.' });
  });

  it('the words under the bar say where heart rate is', () => {
    const band = { low: 160, high: 168 };
    expect(zoneWords(153, band)).toBe('7 bpm below');
    expect(zoneWords(172, band)).toBe('4 bpm above');
    expect(zoneWords(164, band)).toBe('In the zone');
    expect(zoneWords(90, { low: 0, high: 120 })).toBe('In the zone');   // a recovery step: no minimum
  });

  it('the three removed sentences are gone from the ride screen', () => {
    const src = readFileSync(new URL('../ui/screens/RideScreens.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Change your effort now/);
    expect(src).not.toMatch(/you'll be told to/);
    expect(src).not.toMatch(/In the zone\. Hold it steady/);
  });
});

describe('a cue never contradicts the heart-rate bar', () => {
  it('no Library cue tells the rider to increase or reduce intensity: that is the bar’s job', () => {
    for (const w of LIBRARY)
      for (const { step } of flattenStepsWithSets(w.blocks))
        for (const c of step.cues ?? []) expect(c.text, w.name).not.toMatch(/(increase|reduce) intensity/i);
  });
});
