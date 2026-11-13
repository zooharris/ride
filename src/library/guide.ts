import type { Basis, CueKind, Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { relaxFloors } from '../engine/workout';
import { m, rep, type Cue } from './batch1';
import { withTags } from './tags';
import { ALL_OUT_STANDIN, familyFor, trainsOf, type Skill } from './trains';

/**
 * The twelve sample rides of the ride design guide (12 Nov 2026), each built as a family of four levels: 48 rides.
 * The sample is level 2; each level differs from the one before by exactly the one thing its `change` says. Every
 * ride carries its steps as in the guide, a descriptive subtitle, why it is built in this order, how it can be
 * ridden, its skills, and written cues of the five kinds. Intensities are shares of FTP; an all-out step has no
 * target at all. Names approved by Todd, 12 Nov 2026.
 */

const c = (kind: CueKind, at: number, text: string, rep?: number | 'last'): Cue => ({ kind, at, text, ...(rep != null ? { rep } : {}) });
type O = { label?: string; cadence?: number; cues?: Cue[] };
const st = (minutes: number, lo: number, hi?: number, o: O = {}): WorkoutStep => ({ kind: 'step', seconds: m(minutes), intensity: lo, ...(hi != null ? { intensityHigh: hi } : {}), ...o });
const secs = (seconds: number, lo: number, o: O = {}): WorkoutStep => ({ kind: 'step', seconds, intensity: lo, ...o });
/** An all-out step: no target; the stand-in is for load estimates only. */
const allOut = (seconds: number, label: string, cues: Cue[]): WorkoutStep => ({ kind: 'step', seconds, intensity: ALL_OUT_STANDIN, allOut: true, label, cues });
const easy = (minutes: number, cues: Cue[] = [], cadence?: number): WorkoutStep => st(minutes, 0.5, undefined, { label: 'Easy', cues, ...(cadence ? { cadence } : {}) });
const easyS = (seconds: number, cues: Cue[] = []): WorkoutStep => secs(seconds, 0.5, { label: 'Easy', cues });
const cool = (minutes: number, cues: Cue[] = [c('focus', 0, 'The work is done. Spin it out easy and let the breathing come all the way down.')], cadence?: number): WorkoutStep =>
  st(minutes, 0.5, undefined, { label: 'Cool down', cues, ...(cadence ? { cadence } : {}) });

/** A warm-up for work above threshold (the guide's limit: ten minutes or more, with a minute near threshold). */
const warmHard = (minutes = 14): WorkoutStep[] => [
  st(minutes - 4, 0.5, 0.65, { label: 'Warm up', cues: [c('focus', 0, 'Ease in. Let the legs find their rhythm before anything is asked of them.')] }),
  st(2, 0.7, undefined, { label: 'Warm up, building', cues: [c('focus', 0, 'Build a little. Breathing deeper, still easy to talk.')] }),
  st(1, 0.95, undefined, { label: 'Warm up, opener', cues: [c('why', 0, 'One minute near threshold to open the legs. It makes the first hard effort feel less of a shock.')] }),
  st(1, 0.5, undefined, { label: 'Warm up, easy', cues: [c('next', 0, 'Easy for a minute. The work starts next.')] }),
];
const warmEasy = (minutes: number, cadence?: number): WorkoutStep[] => [st(minutes, 0.5, 0.6, { label: 'Warm up', cues: [c('focus', 0, 'Ease in. Light gear, smooth circles.')], ...(cadence ? { cadence } : {}) })];

interface Level { change: string; blocks: WorkoutBlock[] }
interface FamilyDef {
  key: string; name: string; subtitle: string; bases: Basis[]; purpose: string; physiology: string; why: string;
  skills?: Skill[]; indoorWhy?: string; easyDay?: boolean;
  levels: [Level, Level, Level, Level];
}

// ── 1. Signal Knob: sprints, then VO2max, then threshold ─────────────────────────────────────────────
const sk = (vo2: number, thrMin: number, thrN: number): WorkoutBlock[] => [
  ...warmHard(14),
  rep(4, 'Sprints',
    allOut(10, 'Sprint, all out', [c('hard', 0, 'No number to hit. Out of the saddle, everything you have, for ten seconds.'), c('why', 0, 'Sprints first, while the legs are fresh enough to make them real sprints.', 1)]),
    secs(140, 0.5, { label: 'Easy', cues: [c('focus', 0, 'Easy. Let the legs come back completely before the next one.'), c('next', -30, 'Next: VO2max, two minutes. Settle your breathing now.', 'last')] })),
  rep(vo2, 'VO2max',
    st(2, 1.15, undefined, { label: 'VO2max', cues: [c('why', 0, 'Two minutes well over threshold: this is the work that raises your ceiling.', 1), c('focus', 0, 'Breathe out hard and keep the cadence up. Even pressure all the way through.'), c('hard', 0, 'This is the one that counts. Breathe out hard and hold the cadence.', 'last')] }),
    easy(2, [c('lesson', 30, 'Easy spells are part of the session: the next effort is only as good as this rest.', 1), c('next', -30, 'Next effort in thirty seconds.')])),
  rep(thrN, 'Threshold',
    st(thrMin, 0.98, undefined, { label: 'Threshold', cues: [c('focus', 0, 'Threshold: hard and steady. Settle in; do not spike the start.'), c('hard', -120, 'Tired legs, steady power. This is what the end of a hard climb asks of you.', 'last')] }),
    easy(3, [c('next', -30, 'Another threshold effort next. Same power as the last.')])),
  cool(5),
];

// ── 2. Woodstock Tower: a pyramid, then sweet spot ─────────────────────────────────────────────────
const pyramid = (top: 3 | 4): WorkoutStep[] => {
  const up: Array<[number, number, number]> = top === 4 ? [[1, 1.18, 1], [2, 1.12, 1], [3, 1.07, 2], [4, 1.0, 3]] : [[1, 1.18, 1], [2, 1.12, 1], [3, 1.07, 2]];
  const down: Array<[number, number, number]> = top === 4 ? [[3, 1.07, 2], [2, 1.12, 1], [1, 1.18, 4]] : [[2, 1.12, 1], [1, 1.18, 4]];
  const out: WorkoutStep[] = [];
  [...up, ...down].forEach(([min, x, rest], i) => {
    const isTop = top === 4 ? i === 3 : i === 2;
    const cues: Cue[] = i === 0 ? [c('focus', 0, "Each step up is longer and a little gentler. Don't win the first minute.")]
      : isTop ? [c('hard', 0, top === 4 ? 'Top of the pyramid. Settle at threshold and breathe; it gets shorter from here.' : 'Top of the pyramid. Three minutes, then every step is shorter.')]
      : i > (top === 4 ? 3 : 2) ? [c('focus', 0, 'Shorter now, and a little harder. Lift the pressure, keep it smooth.')]
      : [c('focus', 0, 'Longer, slightly lower. Find a pace you can hold to the end of this step.')];
    out.push(st(min, x, undefined, { label: `Pyramid, ${min} min`, cues }));
    const last = i === up.length + down.length - 1;
    out.push(easy(rest, i === 0 ? [c('why', 0, 'The longer the effort, the lower its target: every step is hard but possible.')]
      : last ? [c('lesson', 20, 'Pyramids teach pacing: the same hard feeling, held for longer or for less.'), c('next', -30, 'Sweet spot next: steady, firm, no surge at the start.')]
      : rest >= 3 ? [c('lesson', 20, 'Breathing comes down before the legs do. Wait for both before the next step.')] : []));
  });
  return out;
};
const wt = (top: 3 | 4, ssMin: number, ssN: number): WorkoutBlock[] => [
  ...warmHard(14),
  ...pyramid(top),
  rep(ssN, 'Sweet spot',
    st(ssMin, 0.92, undefined, { label: 'Sweet spot', cues: [c('why', 0, 'The sharp work is done. This is steady work on used legs, which is how fitness is built.', 1), c('focus', 0, 'Firm but sustainable. Smooth pedalling, relaxed shoulders.'), c('hard', -120, 'Two minutes left. Hold it exactly where it is.', 'last')] }),
    easy(3, [c('next', -30, 'Another sweet-spot block next. Settle into it; no surge at the start.')])),
  cool(5),
];

// ── 3. Goshen Pass: over-unders ────────────────────────────────────────────────────────────────────
const ouSet = (overs: number, over: number): WorkoutStep[] => {
  const out: WorkoutStep[] = [];
  for (let k = 0; k < overs; k++) {
    out.push(st(2, 0.95, undefined, { label: 'Under', cues: k === 0 ? [c('focus', 0, "Under: just below threshold. Don't ease off further than the target.")] : [c('focus', 0, "Back under. Don't ease off further than the target: recovering while working is the whole point.")] }));
    out.push(st(1, over, undefined, { label: 'Over', cues: k === 0 ? [c('hard', 0, 'One minute over threshold. It should sting, not break you.'), c('why', 0, 'The over floods the legs; the under teaches them to clear it while still working.', 1)] : [c('hard', 0, 'Over. Seated, smooth, one minute.')] }));
  }
  out.push(st(1, 0.95, undefined, { label: 'Under', cues: [c('focus', 0, 'Last under of the set. Hold it to the end.'), c('hard', 0, "Last set. The overs felt longer; they weren't.", 'last')] }));
  out.push(easy(5, [c('lesson', 60, 'A surging climb or a fast group asks for exactly this: recovering without stopping.', 1), c('next', -30, 'Next set in thirty seconds. Start it under, not over.')]));
  return out;
};
const gp = (sets: number, over: number, overs: number): WorkoutBlock[] => [...warmHard(14), rep(sets, 'Over-unders', ...ouSet(overs, over)), cool(6)];

// ── 4. Edinburg Gap: 30/15s, then tempo on tired legs ───────────────────────────────────────────────
const onOff = (n: number, set: string): WorkoutBlock => rep(n, set,
  secs(30, 1.25, { label: 'On', cues: [c('hard', 0, 'Thirty on. Hard, seated, even.'), c('focus', 0, 'Thirty seconds on, fifteen off. The first four feel easy. They are meant to.', 1), c('hard', 0, 'Breathing is high now and it stays there. That is the training.', 9)] }),
  easyS(15, [c('focus', 0, 'Off. Soft pedals, keep them turning.')]));
const eg = (reps: number, tempoMin: number): WorkoutBlock[] => [
  ...warmHard(14),
  onOff(reps, 'Set 1'),
  easy(5, [c('why', 0, 'The rests were too short to recover, so breathing stayed high the whole set. That is the point.'), c('lesson', 90, 'Short rests keep the heart and lungs working near their top, for longer than one effort could.'), c('next', -30, 'Second set next. Same as the first.')]),
  onOff(reps, 'Set 2'),
  easy(4, [c('focus', 0, 'Easy. Breathe it all the way down.'), c('next', -30, `Next: ${tempoMin} minutes of tempo on loaded legs. Smooth, no surges.`)]),
  st(tempoMin, 0.82, undefined, { label: 'Tempo', cues: [c('focus', 0, `${tempoMin === 15 ? 'Fifteen' : 'Twenty'} steady minutes. Smooth pedalling, relaxed shoulders, no surges.`), c('why', 90, 'Riding well on legs that have already worked is a skill of its own. This trains it.')] }),
  cool(4),
];

// ── 5. Thunder Ridge: hard starts ─────────────────────────────────────────────────────────────────
const tr = (n: number, startS: number, effortMin: number): WorkoutBlock[] => [
  ...warmHard(14),
  rep(n, 'Hard starts',
    secs(startS, 1.3, { label: 'Hard start', cues: [c('hard', 0, `Go. ${startS === 40 ? 'Forty' : 'Fifty'} seconds, well over threshold.`), c('why', 0, 'A hard start fills the legs first, so the threshold minutes that follow are ridden under pressure.', 1), c('hard', 0, 'Last one. Start it as hard as the first.', 'last')] }),
    secs(effortMin * 60 - startS, 0.97, { label: 'Threshold', cues: [c('focus', 0, "Now settle. Don't drop below the target: the legs clear it while you work.")] }),
    secs(210, 0.5, { label: 'Easy', cues: [c('lesson', 40, 'It is the start of a climb or a breakaway: you go hard, then have to keep going.', 2), c('next', -30, 'Next hard start in thirty seconds.')] })),
  cool(7),
];

// ── 6. Damascus: race simulation ──────────────────────────────────────────────────────────────────
const warmRace = (): WorkoutStep[] => [
  st(8, 0.5, 0.65, { label: 'Warm up', cues: [c('focus', 0, 'Ease in. A race warm-up is gentle until the last few minutes.')] }),
  st(2, 0.7, undefined, { label: 'Warm up, building', cues: [c('focus', 0, 'Build a little.')] }),
  st(1, 1.0, undefined, { label: 'Warm up, opener', cues: [c('why', 0, 'A minute at threshold pace, as before a start line, so the first surge does not shock the legs.')] }),
  st(1, 0.5, undefined, { label: 'Warm up, easy', cues: [c('next', 0, 'Easy. The bunch rolls out next.')] }),
];
const attack = (n: number): WorkoutBlock => rep(n, 'Attack',
  st(1, 1.3, undefined, { label: 'Attack', cues: [c('hard', 0, 'One minute to get clear, five to stay clear. Commit.')] }),
  st(5, 1.0, undefined, { label: 'Stay clear', cues: [c('focus', 0, 'Now hold threshold. Low on the bike, smooth, do not look back.')] }),
  easy(3, [c('lesson', 30, 'An attack is won in the minutes after it, not the first seconds. That is why the hold is long.', 1)]));
const dm = (attacks: number, climbMin: 8 | 10): WorkoutBlock[] => [
  ...warmRace(),
  rep(4, 'In the bunch',
    secs(210, 0.8, { label: 'In the bunch', cues: [c('focus', 0, 'Sit in. Each surge is thirty seconds to close a gap, then straight back to tempo.'), c('why', 0, 'A race in the order a race happens: surges first, the decisive moves later.', 1)] }),
    secs(30, 1.25, { label: 'Close the gap', cues: [c('hard', 0, 'Gap! Thirty seconds to close it.')] })),
  easy(3, [c('next', -30, 'The attacks are next. One minute hard, then hold threshold.')]),
  attack(attacks),
  st(climbMin === 8 ? 4 : 5, 0.95, undefined, { label: 'The climb', cues: [c('focus', 0, 'The climb. It steepens as it goes: start at threshold and save something.')] }),
  st(climbMin === 8 ? 3 : 4, 1.02, undefined, { label: 'The climb, steeper', cues: [c('focus', 0, 'Steeper. Lift the pressure a notch.')] }),
  st(1, 1.1, undefined, { label: 'The climb, top', cues: [c('hard', 0, 'The top. One minute, everything you can hold.')] }),
  easy(4, [c('lesson', 60, 'Eat and drink in the quiet moments of a race; there are fewer of them than you think.'), c('next', -30, 'The run-in is next. Tempo, a lift, then the sprint.')]),
  st(3, 0.85, undefined, { label: 'Run-in', cues: [c('focus', 0, 'Run-in at tempo. Stay near the front, smooth.')] }),
  st(1, 1.05, undefined, { label: 'Run-in, lift', cues: [c('hard', 0, 'Lift it. The sprint comes at the end of this minute.')] }),
  allOut(15, 'Sprint, all out', [c('hard', 0, 'Fifteen seconds. Everything that is left.')]),
  cool(climbMin === 8 ? 9.75 : 9.75),
];

// ── 7. High Bridge: threshold late, on tired legs ─────────────────────────────────────────────────
const hb = (thrN: number, endRounds: number, extraEnd: boolean, thrMin: number): WorkoutBlock[] => [
  st(10, 0.5, 0.6, { label: 'Warm up', cues: [c('focus', 0, 'Ease in. Long day; nothing hard for nearly an hour.')] }),
  rep(endRounds, 'Endurance',
    st(6, 0.65, undefined, { label: 'Endurance', cues: [c('why', 0, 'Easy riding has a job today: it loads the legs for what comes later. Eat and drink now.', 2), c('focus', 0, 'All-day pace. Full sentences, steady breathing.')] }),
    st(4, 0.72, undefined, { label: 'Endurance, brisker', cues: [c('focus', 0, 'A little brisker, still easy. Top of zone 2.')] })),
  ...(extraEnd ? [st(5, 0.65, undefined, { label: 'Endurance', cues: [c('focus', 0, 'Five more steady minutes before the work.')] })] : []),
  easy(2, [c('next', -30, `Next: ${thrN} threshold efforts on tired legs.`)]),
  rep(thrN - 1, 'Threshold',
    st(thrMin, 0.97, undefined, { label: 'Threshold', cues: [c('hard', 0, 'You have an hour in your legs. Hold the same power you would fresh.', 1), c('focus', 0, 'Threshold. Settle in, smooth and steady.')] }),
    easy(4, [c('lesson', 60, 'Holding power when tired is its own ability, and it is only trained on tired legs.', 1), c('next', -30, 'Another threshold effort next. Same power.')])),
  st(thrMin, 0.97, undefined, { label: 'Threshold', cues: [c('focus', 0, 'The last threshold effort. Settle in, smooth and steady.'), c('hard', -120, 'Two minutes. This is the part the ride is for.')] }),
  easy(3, [c('focus', 0, 'Easy. Let the breathing come down.'), c('next', -30, 'Two short sprints to finish.')]),
  rep(2, 'Sprints',
    allOut(10, 'Sprint, all out', [c('hard', 0, 'Two short sprints to finish. They are a reminder to the legs, not the point of the ride.')]),
    secs(170, 0.5, { label: 'Easy', cues: [c('focus', 0, 'Easy. Let it all come down.')] })),
  cool(4),
];

// ── 8. Seven Bends: a climb that steepens ────────────────────────────────────────────────────────
const sb = (thrMin: number, ssMin: number, tempoMin: number): WorkoutBlock[] => [
  st(9, 0.5, 0.65, { label: 'Warm up', cues: [c('focus', 0, 'Ease in. Three long blocks today, each harder than the last.')] }),
  st(3, 0.7, undefined, { label: 'Warm up, building', cues: [c('next', -30, 'Next: tempo. Comfortably hard.')] }),
  st(tempoMin, 0.82, undefined, { label: 'Tempo', cues: [c('focus', 0, 'Comfortably hard. You could talk in short sentences.'), c('why', 60, 'Each block is shorter and harder than the last, so you finish strongest.')] }),
  easy(4, [c('lesson', 60, 'Heart rate needs two or three minutes to settle on a new effort; long blocks give it time.'), c('next', -30, 'Next: sweet spot, one notch up.')]),
  st(ssMin, 0.9, undefined, { label: 'Sweet spot', cues: [c('focus', 0, 'One notch up. The most fitness for the least recovery.')] }),
  easy(4, [c('next', -30, 'Last block: threshold. The steepest part of the climb.')]),
  st(thrMin, 0.98, undefined, { label: 'Threshold', cues: [c('focus', 0, 'Threshold. Settle in; the climb is steepest here.'), c('hard', -180, 'Three minutes. Hold the power, breathe out hard.')] }),
  cool(8),
];

// ── 9. Back Bay: rolling endurance with short sprints ─────────────────────────────────────────────
const SPRINT_NEXT = c('next', -30, 'Sprint next: eight seconds, all out, from a rolling start.');
const sprintBB = (first: boolean): WorkoutStep[] => [
  allOut(8, 'Sprint, all out', [c('hard', 0, 'Eight seconds, from a rolling start, all out. Then right back to easy.')]),
  secs(232, 0.5, { label: 'Easy', cues: [c('focus', 0, 'Easy. Let the legs settle completely.'), ...(first ? [c('why', 60, 'Short sprints cost almost nothing but keep the top end awake on an easy day.')] : [])] }),
];
const bb = (minutes: 60 | 75 | 90, sprints: 4 | 6): WorkoutBlock[] => {
  const out: WorkoutBlock[] = [
    ...warmEasy(8, 90),
    st(minutes === 60 ? 8 : 10, 0.65, undefined, { label: 'Endurance', cadence: 90, cues: [c('focus', 0, "All-day pace. If you can't talk in full sentences, ease off."), SPRINT_NEXT] }),
    ...sprintBB(true),
    st(8, 0.7, undefined, { label: 'Endurance, lower cadence', cadence: 80, cues: [c('focus', 0, 'A touch firmer at 80 rpm. Still easy breathing.'), SPRINT_NEXT] }),
    ...sprintBB(false),
    st(6, 0.6, undefined, { label: 'Endurance, quick feet', cadence: 100, cues: [c('focus', 0, 'Lighter and quicker: 100 rpm. Hips still on the saddle.'), SPRINT_NEXT] }),
    ...sprintBB(false),
    st(10, 0.68, undefined, { label: 'Endurance', cadence: 90, cues: [c('focus', 0, 'Back to all-day pace at 90 rpm.'), c('lesson', 300, 'Lesson for an easy spell: easy days are where the body builds what the hard days asked for.'), SPRINT_NEXT] }),
    ...sprintBB(false),
  ];
  if (minutes >= 75) out.push(
    st(8, 0.72, undefined, { label: 'Endurance, brisker', cadence: 85, cues: [c('focus', 0, 'Top of zone 2 at 85 rpm. Brisk, not hard.')] }),
    st(5, 0.62, undefined, { label: 'Endurance, spin', cadence: 95, cues: [c('focus', 0, 'Back down a touch, spin at 95.')] }));
  if (minutes >= 90) out.push(st(15, 0.66, undefined, { label: 'Endurance', cadence: 90, cues: [c('focus', 0, 'Fifteen more steady minutes. Eat something if you have not.')] }));
  if (sprints === 6) { const last = out[out.length - 1] as WorkoutStep; last.cues = [...(last.cues ?? []), SPRINT_NEXT]; }
  if (sprints === 6) out.push(...sprintBB(false), st(4, 0.65, undefined, { label: 'Endurance', cadence: 90, cues: [c('focus', 0, 'Steady again.'), SPRINT_NEXT] }), ...sprintBB(false));
  out.push(cool(4));
  return out;
};

// ── 10. Belle Isle: leg speed ─────────────────────────────────────────────────────────────────────
const ladder = (top: 110 | 120, x: number): WorkoutBlock => rep(3, 'Cadence ladder',
  ...([100, 110, 120] as const).filter((r) => r <= top).map((r, i) => st(1, x, undefined, { label: `Cadence ${r}`, cadence: r, cues: [
    r === 100 ? c('focus', 0, 'Fast feet, quiet hips. If you bounce on the saddle, back off 5 rpm.') : r === 120 ? c('focus', 0, 'Think of pulling your foot back through the bottom of the stroke, like scraping mud.') : c('focus', 0, 'Up ten rpm. Same light gear, quicker feet.'),
    ...(i === 0 ? [c('why', 0, 'Ladders wake the legs up in steps, so speed comes before any load.', 1)] : []),
  ] })),
  easy(2, [c('lesson', 30, 'Leg speed is a skill of the nervous system: it is trained by quality, not by tiredness.', 2), c('next', -20, 'Next rung starts at 100 rpm.')]));
const bi = (top: 110 | 120, spins: 6 | 8, x: number): WorkoutBlock[] => [
  ...warmEasy(8, 90),
  ladder(top, x),
  st(5, 0.6, undefined, { label: 'Endurance', cadence: 90, cues: [c('focus', 0, 'Five steady minutes at 90. Let the pedalling settle.'), c('next', -30, 'Spin-ups next: twenty seconds as fast as you can pedal smoothly.')] }),
  rep(spins, 'Spin-ups',
    secs(20, x, { label: 'Spin-up', cues: [c('hard', 0, 'Wind it up over twenty seconds. Stop the moment it gets rough.')] }),
    secs(100, 0.5, { label: 'Easy', cues: [c('focus', 0, 'Easy, own cadence.')] })),
  cool(5, undefined, 90),
];

// ── 11. Crabtree Falls: climbing strength ────────────────────────────────────────────────────────
const cf = (climbs: number, standS: number, seatedRpm: 60 | 55): WorkoutBlock[] => {
  const seated = (first: boolean) => secs(180, 0.84, { label: 'Seated climb', cadence: seatedRpm, cues: [c('focus', 0, `${seatedRpm === 60 ? 'Sixty' : 'Fifty-five'} rpm. Hands light on the bars, hips still, push through the whole stroke.`), ...(first ? [c('why', 0, 'Seated first, to load the legs at low cadence; standing then shares the work out.', 1)] : [])] });
  const stand = secs(standS, 0.9, { label: 'Standing', cadence: 55, cues: [c('hard', 0, "Up a gear as you stand, so the power doesn't dip. Let the bike move under you.")] });
  return [
    ...warmEasy(12, 90),
    rep(climbs, 'Climb', seated(true), stand, seated(false), { ...stand },
      easy(3, [c('focus', 0, 'Spin at 95. Knees that ache at low cadence are a reason to stop this ride, not push through.'), c('lesson', 60, 'Low cadence builds force without the speed; it is strength work on the bike.', 2), c('next', -30, 'Next climb: seated, low cadence.')], 95)),
    cool(7, undefined, 95),
  ];
};

// ── 12. First Landing: steady hands ──────────────────────────────────────────────────────────────
const fl = (blocks: 2 | 3, band: [number, number] | number, legS: 30 | 45): WorkoutBlock[] => {
  const steady = typeof band === 'number' ? st(5, band, undefined, { label: 'Steady', cues: [] }) : st(5, band[0], band[1], { label: 'Steady', cues: [] });
  steady.cues = [c('focus', 0, 'Keep the number still. Small corrections, early. A steady rider wastes nothing.'), c('why', 0, 'Steadiness first, while you are fresh and can feel the small changes.', 1), c('hard', -60, 'Last minute of the block: the stillest minute of all.')];
  return [
    ...warmEasy(7),
    rep(blocks, 'Steady', steady, secs(90, 0.5, { label: 'Easy', cues: [c('lesson', 20, 'Every surge costs more than it gives back; even power is the cheapest way to go fast.', 2)] })),
    rep(5, 'One leg',
      secs(legS, 0.45, { label: 'Left leg only', cues: [c('focus', 0, 'Rest the other foot. Feel for the dead spot at the top and smooth it out.')] }),
      secs(legS, 0.45, { label: 'Right leg only', cues: [c('focus', 0, 'Switch legs. Pull through the top of the stroke.')] }),
      st(1, 0.5, undefined, { label: 'Both legs', cues: [c('focus', 0, 'Both legs. Keep the smoothness you just found.')] })),
    rep(2, 'Breathing',
      st(4, 0.68, undefined, { label: 'Breathing to a count', cues: [c('focus', 0, 'Out for three strokes, in for two. Long breaths out slow everything down.'), c('why', 30, 'Breathing last, when the mind is calm. It is a habit you can use on any hard climb.', 1)] }),
      easy(2, [c('next', -20, 'Another breathing block next.')])),
    cool(5),
  ];
};

const FAMILIES: FamilyDef[] = [
  { key: 'signal-knob', name: 'Signal Knob', subtitle: 'Sprints, then VO2max, then threshold', bases: ['power'],
    purpose: 'Three systems in one hour, sharpest first: four all-out sprints, VO2max efforts, then threshold. Mixed work that covers more of the week than one kind of effort could.',
    physiology: 'Sprint power, maximal oxygen uptake and threshold, in one session.',
    why: 'Sharpest first. Sprints need fresh legs to be real sprints, VO2max work comes next, and threshold is the work you can still do well when tired.',
    levels: [
      { change: 'three VO2max efforts', blocks: sk(3, 6, 2) },
      { change: 'a fourth VO2max effort', blocks: sk(4, 6, 2) },
      { change: 'threshold efforts of 8 minutes', blocks: sk(4, 8, 2) },
      { change: 'a third threshold effort', blocks: sk(4, 8, 3) },
    ] },
  { key: 'woodstock-tower', name: 'Woodstock Tower', subtitle: 'A pyramid, then sweet spot', bases: ['power'],
    purpose: 'A pyramid of efforts that grow then shrink, the target easing as they lengthen, then two blocks of sweet spot on used legs.',
    physiology: 'Maximal oxygen uptake, then sub-threshold endurance.',
    why: 'The longer the effort, the lower its target, so every step is hard but possible. The top of the pyramid is the hinge: after it, each effort is shorter and you are asked for more again.',
    levels: [
      { change: 'a pyramid to 3 minutes', blocks: wt(3, 8, 2) },
      { change: 'a pyramid to 4 minutes', blocks: wt(4, 8, 2) },
      { change: 'sweet-spot efforts of 10 minutes', blocks: wt(4, 10, 2) },
      { change: 'a third sweet-spot effort', blocks: wt(4, 10, 3) },
    ] },
  { key: 'goshen-pass', name: 'Goshen Pass', subtitle: 'Over-unders, 3 × 10 minutes', bases: ['power'],
    purpose: 'Sets of ten minutes switching between two minutes just under threshold and one minute well over it, with no rest between: the unders are where you recover while still working.',
    physiology: 'Threshold power and clearing the burn of hard surges.',
    why: 'The "over" floods the legs; the "under" teaches them to clear it while still working. That is what a surging climb or a fast group asks for.',
    levels: [
      { change: 'two sets', blocks: gp(2, 1.08, 3) },
      { change: 'a third set', blocks: gp(3, 1.08, 3) },
      { change: 'overs at 110%', blocks: gp(3, 1.1, 3) },
      { change: 'sets of 13 minutes, four overs each', blocks: gp(3, 1.1, 4) },
    ] },
  { key: 'edinburg-gap', name: 'Edinburg Gap', subtitle: '30/15s, then tempo on tired legs', bases: ['power'],
    purpose: 'Two sets of thirty seconds hard and fifteen easy, where breathing stays high the whole way, then a block of tempo on loaded legs.',
    physiology: 'Maximal oxygen uptake through short repeats; muscular endurance when tired.',
    why: 'The rests are too short to recover, so breathing stays high for the whole set. The tempo block afterwards trains you to keep riding well on loaded legs.',
    levels: [
      { change: 'sets of 9 repeats', blocks: eg(9, 15) },
      { change: 'sets of 12 repeats', blocks: eg(12, 15) },
      { change: 'a tempo block of 20 minutes', blocks: eg(12, 20) },
      { change: 'sets of 14 repeats', blocks: eg(14, 20) },
    ] },
  { key: 'thunder-ridge', name: 'Thunder Ridge', subtitle: 'Hard starts, 5 × 5 minutes', bases: ['power'],
    purpose: 'Five efforts that open well over threshold for forty seconds and then settle to just under it: the start of a climb or a breakaway.',
    physiology: 'Anaerobic capacity and threshold power, ridden together.',
    why: 'A hard start fills the legs first, so the threshold minutes that follow are ridden under pressure from the first second. It is the start of a climb or a breakaway.',
    levels: [
      { change: 'four efforts', blocks: tr(4, 40, 5) },
      { change: 'a fifth effort', blocks: tr(5, 40, 5) },
      { change: 'hard starts of 50 seconds', blocks: tr(5, 50, 5) },
      { change: 'efforts of 6 minutes', blocks: tr(5, 50, 6) },
    ] },
  { key: 'damascus', name: 'Damascus', subtitle: 'Race simulation, 75 minutes', bases: ['power'],
    purpose: 'The efforts of a road race in the order a race has them: surges in the bunch, attacks you have to hold, a climb that steepens, and a sprint on what is left.',
    physiology: 'Repeated surges, threshold and anaerobic capacity, as racing asks for them.',
    why: 'In the order a race happens: surges in the bunch, an attack you have to hold, a climb that steepens, a sprint on what is left.',
    levels: [
      { change: 'one attack', blocks: dm(1, 8) },
      { change: 'a second attack', blocks: dm(2, 8) },
      { change: 'a climb of 10 minutes', blocks: dm(2, 10) },
      { change: 'a third attack', blocks: dm(3, 10) },
    ] },
  { key: 'high-bridge', name: 'High Bridge', subtitle: 'Threshold late, on tired legs', bases: ['power', 'hr'],
    purpose: 'Fifty minutes of endurance riding first, then threshold efforts on the legs it leaves you, and two short sprints to finish.',
    physiology: 'Threshold power when tired, and aerobic endurance.',
    why: 'The deliberate reverse. The hard work comes after 50 minutes of riding, because holding power when tired is its own ability and has to be trained on tired legs.',
    levels: [
      { change: 'two threshold efforts', blocks: hb(2, 5, false, 8) },
      { change: 'a third threshold effort', blocks: hb(3, 5, false, 8) },
      { change: 'endurance first for 65 minutes', blocks: hb(3, 6, true, 8) },
      { change: 'threshold efforts of 10 minutes', blocks: hb(3, 6, true, 10) },
    ] },
  { key: 'seven-bends', name: 'Seven Bends', subtitle: 'Tempo, sweet spot, threshold: a climb that steepens', bases: ['power', 'hr'],
    purpose: 'Three long blocks, each shorter and harder than the last: tempo, sweet spot and threshold. Long enough for heart rate to settle in every one.',
    physiology: 'Threshold, sweet spot and tempo, in long steady blocks.',
    why: 'The deliberate reverse: each block is shorter and harder than the last, so you finish strongest. Built with long blocks so riders who train by heart rate have a mixed ride too.',
    levels: [
      { change: 'a threshold block of 8 minutes', blocks: sb(8, 12, 15) },
      { change: 'a threshold block of 10 minutes', blocks: sb(10, 12, 15) },
      { change: 'a sweet-spot block of 15 minutes', blocks: sb(10, 15, 15) },
      { change: 'a tempo block of 20 minutes', blocks: sb(10, 15, 20) },
    ] },
  { key: 'back-bay', name: 'Back Bay', subtitle: 'Rolling endurance with four short sprints', bases: ['power', 'hr'], easyDay: true,
    purpose: 'Easy riding with small changes of pace and cadence inside zone 2, and four eight-second sprints spread through it. An easy day that never goes stale.',
    physiology: 'Aerobic endurance, with a touch of top-end speed.',
    why: 'An easy day stays easy. The interest comes from small changes of pace and cadence inside zone 2 and from four 8-second sprints, which are too short to cost anything but keep the top end awake.',
    levels: [
      { change: '60 minutes', blocks: bb(60, 4) },
      { change: '75 minutes', blocks: bb(75, 4) },
      { change: '90 minutes', blocks: bb(90, 4) },
      { change: 'six sprints', blocks: bb(90, 6) },
    ] },
  { key: 'belle-isle', name: 'Belle Isle', subtitle: 'Leg speed', bases: ['power', 'hr'], easyDay: true, skills: ['leg-speed', 'smooth'],
    indoorWhy: 'Holding 120 rpm at light resistance needs the steady surface of a trainer.',
    purpose: 'Cadence ladders and spin-ups at light resistance: the legs learn speed without load. Nothing here is hard; all of it takes attention.',
    physiology: 'Pedalling speed and smoothness; no energy system.',
    why: 'Ladders first, to wake the legs up in steps; spin-ups last, once the pedalling is smooth. Light resistance throughout, so the legs learn speed without load.',
    levels: [
      { change: 'ladders to 110 rpm', blocks: bi(110, 6, 0.55) },
      { change: 'ladders to 120 rpm', blocks: bi(120, 6, 0.55) },
      { change: 'eight spin-ups', blocks: bi(120, 8, 0.55) },
      { change: 'ladders and spin-ups at 65%', blocks: bi(120, 8, 0.65) },
    ] },
  { key: 'crabtree-falls', name: 'Crabtree Falls', subtitle: 'Climbing strength', bases: ['power', 'hr'], skills: ['low-cadence', 'standing'],
    purpose: 'Eight-minute climbs at tempo and low cadence, seated and standing in turn: strength work on the bike, with fast easy spins between.',
    physiology: 'Force at low cadence; tempo endurance.',
    why: 'Seated first, to load the legs at low cadence; standing second, to change which muscles carry the work without letting the effort drop. Easy spells are spun fast to clear the legs.',
    levels: [
      { change: 'three climbs', blocks: cf(3, 60, 60) },
      { change: 'a fourth climb', blocks: cf(4, 60, 60) },
      { change: 'standing spells of 90 seconds', blocks: cf(4, 90, 60) },
      { change: 'seated at 55 rpm', blocks: cf(4, 90, 55) },
    ] },
  { key: 'first-landing', name: 'First Landing', subtitle: 'Steady hands', bases: ['power', 'hr'], easyDay: true, skills: ['steady-power', 'single-leg', 'breathing'],
    indoorWhy: 'Pedalling with one leg is not safe on the road.',
    purpose: 'Easy riding that takes attention: holding power inside a narrow band, single-leg pedalling at no load, and breathing to a count.',
    physiology: 'Pedalling control and breathing; no energy system.',
    why: 'Steadiness first while fresh, single-leg work in the middle at no load, breathing last when the mind is calm. Nothing here is hard; all of it takes attention.',
    levels: [
      { change: 'two steady blocks', blocks: fl(2, [0.64, 0.66], 30) },
      { change: 'a third steady block', blocks: fl(3, [0.64, 0.66], 30) },
      { change: 'a narrower band', blocks: fl(3, 0.65, 30) },
      { change: 'single-leg spells of 45 seconds', blocks: fl(3, 0.65, 45) },
    ] },
];

/** Every guide ride, levels 1 to 4 of each family. */
export const GUIDE_RIDES: Workout[] = FAMILIES.flatMap((f) => f.levels.map((lv, i) => {
  const base: Workout = {
    id: `g-${f.key}-${i + 1}`, name: `${f.name}, level ${i + 1}`, subtitle: f.subtitle, kind: 'ride', source: 'library', setting: 'any',
    family: 'endurance', bases: f.bases, phases: ['any'], purpose: f.purpose, physiology: f.physiology, blocks: lv.blocks,
    why: f.why, levelChange: i === 0 ? undefined : lv.change, ...(f.skills ? { skills: f.skills } : {}), ...(f.indoorWhy ? { indoorWhy: f.indoorWhy } : {}),
  };
  const t = trainsOf(base);
  // Filed under the family of the hardest system it counts toward; an easy-day ride stays with the easy rides.
  const family = f.easyDay ? 'endurance' : familyFor(t, 'endurance');
  return withTags(relaxFloors({ ...base, family }), { series: { id: `g-${f.key}`, rung: i + 1 }, ...(f.indoorWhy ? { outdoor: 'indoor' as const } : {}) });
}));

/** What each level of a family changes (level 1 is where it starts). */
export function familyLevels(seriesId: string, pool: Workout[]): Workout[] {
  return pool.filter((w) => w.tags?.series?.id === seriesId).sort((a, b) => (a.tags!.series!.rung - b.tags!.series!.rung));
}
