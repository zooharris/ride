import { relaxFloors } from '../engine/workout';
import type { Basis, Family, Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { withTags, type WorkoutTags } from './tags';

/**
 * The Library grows up, Part C, batch 1 (9 Nov 2026): the 52 rides the depth sweep said plans need so
 * they stop handing a rider the same ride again and again (docs/library-depth.md). Weighted to where
 * plans live: endurance of 45 to 90 minutes, short recovery, threshold and VO2max of under an hour,
 * with heart-rate versions wherever the efforts are long enough for heart rate to follow. Every ride
 * carries in-ride cues for the player, and its name comes from the approved Virginia pool: places
 * for everyday rides, rivers for long steady ones, climbs for the hard ones, landmarks for the
 * signature rides. Intensities are shares of FTP, as everywhere in the Library.
 */

type Cue = { at: number; text: string; rep?: number | 'last' };
type Opts = { label?: string; cadence?: number; cues?: Cue[] };
const m = (minutes: number) => Math.round(minutes * 60);
const st = (minutes: number, lo: number, hi?: number, o: Opts = {}): WorkoutStep =>
  ({ kind: 'step', seconds: m(minutes), intensity: lo, ...(hi != null ? { intensityHigh: hi } : {}), ...o });
const z2 = (minutes: number, o: Opts = {}) => st(minutes, 0.6, 0.72, { label: 'Zone 2', ...o });
const easy = (minutes: number, o: Opts = {}) => st(minutes, 0.5, undefined, { label: 'Easy', ...o });
const warm = (minutes: number, cues?: Cue[]) => st(minutes, 0.5, 0.65, { label: 'Warm up', cues: cues ?? [{ at: 0, text: 'Ease in. Let the legs find their rhythm before anything is asked of them.' }] });
const cool = (minutes: number, text = 'The work is done. Spin it out easy.') => st(minutes, 0.5, undefined, { label: 'Cool down', cues: [{ at: 0, text }] });
const rep = (times: number, label: string, ...steps: WorkoutStep[]): WorkoutBlock => ({ kind: 'repeat', times, label, steps });
/** A line for the last minute of a step, and one for the last repetition of a set. */
const lastMinute = (text: string): Cue => ({ at: -60, text });
const lastRep = (text: string, at = 0): Cue => ({ at, text, rep: 'last' });

const BOTH: Basis[] = ['power', 'hr'];
const POWER: Basis[] = ['power'];

interface Def {
  id: string; name: string; subtitle: string; family: Family; bases: Basis[];
  setting?: Workout['setting']; purpose: string; physiology: string; blocks: WorkoutBlock[];
  tag?: Partial<WorkoutTags>;
}
const ride = (d: Def): Workout => {
  const w: Workout = { id: d.id, name: d.name, subtitle: d.subtitle, family: d.family, bases: d.bases, setting: d.setting ?? 'any', purpose: d.purpose, physiology: d.physiology, blocks: d.blocks, phases: ['any'], source: 'library', kind: 'ride' };
  return withTags(relaxFloors(w), d.tag ?? {});
};

export const BATCH1: Workout[] = [
  // ── Endurance, 45–60 minutes ─────────────────────────────────────────────
  ride({ id: 'b1-z2-cadence-50', name: 'Delaplane', subtitle: 'Endurance 50 with cadence blocks', family: 'endurance', bases: BOTH, tag: { series: { id: 'endurance-cadence', rung: 1 } },
    purpose: 'Fifty minutes of zone 2 broken into three blocks, each finishing with a few minutes at a quicker cadence. Same easy effort throughout; only the leg speed changes.',
    physiology: 'Aerobic base with pedalling efficiency.',
    blocks: [warm(10), rep(3, 'Zone 2', z2(8, { cadence: 88, cues: [{ at: 0, text: 'Settle at a comfortable 85 to 90 rpm.' }] }), z2(4, { cadence: 100, label: 'Quick feet', cues: [{ at: 0, text: 'Same effort, faster legs: about 100 rpm. Keep the hips still.' }] })), cool(4)] }),
  ride({ id: 'b1-z2-touches-55', name: 'Marshall', subtitle: 'Endurance 55 with tempo touches', family: 'endurance', bases: BOTH,
    purpose: 'An easy hour with two five-minute lifts into tempo, the way a rolling road asks you to press a little on the rises. The rest stays easy.',
    physiology: 'Aerobic base; a little muscular endurance without the fatigue of a tempo ride.',
    blocks: [warm(10), z2(15), st(5, 0.76, 0.82, { label: 'Tempo touch', cues: [{ at: 0, text: 'Press into tempo, as if the road tilted up. Breathing deeper but steady.' }, lastMinute('Hold it to the top, then drop back to zone 2.')] }), z2(10), st(5, 0.76, 0.82, { label: 'Tempo touch', cues: [{ at: 0, text: 'Second rise. Same pressure as the first.' }] }), cool(10)] }),
  ride({ id: 'b1-z2-rolling-60', name: 'The Plains', subtitle: 'Rolling endurance 60', family: 'endurance', bases: BOTH,
    purpose: 'An hour that rolls: four repeats of six minutes of zone 2 and three minutes at the top of it, like gentle hills in hunt country. Never hard, never flat.',
    physiology: 'Aerobic base; comfort changing effort inside zone 2.',
    blocks: [warm(10), rep(4, 'Rolling', z2(6, { cues: [{ at: 0, text: 'The flat between rises. Easy and smooth.' }] }), st(3, 0.72, 0.78, { label: 'Rise', cues: [{ at: 0, text: 'A gentle rise: top of zone 2, no higher.' }] })), cool(14)] }),
  ride({ id: 'b1-z2-lowcad-50', name: 'Paris', subtitle: 'Endurance 50, strength on the pedals', family: 'endurance', bases: BOTH,
    purpose: 'Fifty minutes alternating six minutes at a low cadence and four at a normal one, all at an endurance effort. The low-cadence blocks load the legs like a long, gentle climb.',
    physiology: 'Aerobic base with muscular force at low intensity.',
    blocks: [warm(10), rep(3, 'Low cadence', st(6, 0.68, 0.75, { label: 'Low cadence', cadence: 70, cues: [{ at: 0, text: 'About 70 rpm. Push through the whole stroke, upper body quiet.' }] }), z2(4, { cadence: 92, label: 'Spin', cues: [{ at: 0, text: 'Back to a normal cadence. Let the legs loosen.' }] })), cool(10)] }),
  ride({ id: 'b1-z2-descending-45', name: 'Clifton', subtitle: 'Endurance 45, building', family: 'endurance', bases: BOTH,
    purpose: 'Forty-five minutes that build: each block a touch firmer than the last, finishing near the top of zone 2. A short ride that still feels like it went somewhere.',
    physiology: 'Aerobic base.',
    blocks: [warm(8), st(12, 0.62, 0.68, { label: 'Zone 2, low', cues: [{ at: 0, text: 'Bottom of zone 2. Conversational.' }] }), st(12, 0.66, 0.72, { label: 'Zone 2, middle', cues: [{ at: 0, text: 'A little firmer. Still able to talk.' }] }), st(8, 0.7, 0.76, { label: 'Zone 2, top', cues: [{ at: 0, text: 'Top of zone 2. Breathing deeper, never labored.' }] }), cool(5)] }),
  ride({ id: 'b1-z2-spinblocks-60', name: 'Burke', subtitle: 'Endurance 60 with high-cadence blocks', family: 'endurance', bases: BOTH, tag: { series: { id: 'endurance-cadence', rung: 2 } },
    purpose: 'An hour of zone 2 with three minutes of fast pedalling in every ten. The effort never changes; the spin work makes the hour pass and smooths the stroke.',
    physiology: 'Aerobic base with pedalling efficiency.',
    blocks: [warm(10), rep(4, 'Zone 2', z2(7, { cadence: 88 }), z2(3, { cadence: 105, label: 'Spin', cues: [{ at: 0, text: 'Spin up to about 105 rpm at the same effort. Bouncing means too fast.' }] })), cool(10)] }),
  ride({ id: 'b1-z2-negsplit-55', name: 'Lorton', subtitle: 'Endurance 55, negative split', family: 'endurance', bases: BOTH,
    purpose: 'Two twenty-minute halves, the second a little firmer than the first. Start easier than you think; finish feeling you could have gone on.',
    physiology: 'Aerobic base; pacing.',
    blocks: [warm(10), st(20, 0.6, 0.68, { label: 'First half', cues: [{ at: 0, text: 'Hold back. The first half should feel almost too easy.' }] }), st(20, 0.68, 0.75, { label: 'Second half', cues: [{ at: 0, text: 'Now a little more. Same smooth breathing.' }, lastMinute('Last minute. Even to the end; no sprint.')] }), cool(5)] }),

  // ── Endurance, 1–1½ hours ────────────────────────────────────────────────
  ride({ id: 'b1-z2-tiers-75', name: 'Occoquan', subtitle: 'Endurance 75, three tiers', family: 'endurance', bases: BOTH,
    purpose: 'Seventy-five minutes in three twenty-minute tiers, each a little firmer: low, middle and top of zone 2. A steady ride with a shape to it.',
    physiology: 'Aerobic base and durability.',
    blocks: [warm(10), st(20, 0.6, 0.67, { label: 'Low tier', cues: [{ at: 0, text: 'The easy end of zone 2. Drink early.' }] }), st(20, 0.65, 0.72, { label: 'Middle tier', cues: [{ at: 0, text: 'Middle of zone 2. Steady breathing.' }] }), st(20, 0.7, 0.76, { label: 'Top tier', cues: [{ at: 0, text: 'Top of zone 2. This is where the endurance is built.' }] }), cool(5)] }),
  ride({ id: 'b1-z2-ss-touches-80', name: 'Accotink', subtitle: 'Endurance 80 with sweet-spot touches', family: 'endurance', bases: BOTH,
    purpose: 'Eighty minutes of zone 2 with a three-minute lift to sweet spot every quarter hour. The lifts are short enough that the ride stays an endurance ride.',
    physiology: 'Aerobic base with a little threshold work.',
    blocks: [warm(10), rep(4, 'Zone 2', z2(12), st(3, 0.82, 0.88, { label: 'Lift', cues: [{ at: 0, text: 'Lift to sweet spot for three minutes: comfortably hard.' }] })), cool(10)] }),
  ride({ id: 'b1-z2-cadpyramid-70', name: 'Pohick', subtitle: 'Endurance 70, cadence pyramid', family: 'endurance', bases: BOTH, tag: { series: { id: 'endurance-cadence', rung: 3 } },
    purpose: 'Seventy minutes of zone 2 with the cadence climbing and falling in five-minute steps: 85, 95, 105, 95, 85, twice. Easy effort, busy legs.',
    physiology: 'Aerobic base with pedalling efficiency across cadences.',
    blocks: [warm(10), rep(2, 'Cadence pyramid', z2(5, { cadence: 85 }), z2(5, { cadence: 95 }), z2(5, { cadence: 105, cues: [{ at: 0, text: 'Top of the pyramid: 105 rpm. Smooth, not bouncy.' }] }), z2(5, { cadence: 95 }), z2(5, { cadence: 85 })), cool(10)] }),
  ride({ id: 'b1-z2-seated-85', name: 'Cub Run', subtitle: 'Endurance 85 with seated climbs', family: 'endurance', bases: BOTH,
    purpose: 'Eighty-five minutes with five three-minute seated climbs at a low cadence and a firm tempo effort. Strength on the bike without leaving zone 2 for long.',
    physiology: 'Aerobic base; climbing strength.',
    blocks: [warm(10), rep(5, 'Zone 2', z2(10), st(3, 0.8, 0.86, { label: 'Seated climb', cadence: 72, cues: [{ at: 0, text: 'Seated climb: about 72 rpm, firm tempo. Stay in the saddle.' }] })), cool(10)] }),

  // ── Endurance, 1½–3½ hours ───────────────────────────────────────────────
  ride({ id: 'b1-z2-tempofinish-105', name: 'Rapidan', subtitle: 'Endurance 1:45 with a tempo finish', family: 'endurance', bases: BOTH,
    purpose: 'An hour of zone 2, then twenty minutes of tempo on legs that are already tired. Teaches the last part of a long ride.',
    physiology: 'Aerobic base and fatigue resistance.',
    blocks: [warm(15), z2(60, { cues: [{ at: 0, text: 'An hour of zone 2. Eat something in the first half hour.' }] }), st(20, 0.76, 0.83, { label: 'Tempo finish', cues: [{ at: 0, text: 'Tempo now, on tired legs. Steady, not a race.' }, lastMinute('One more minute. Hold the same pressure.')] }), cool(10)] }),
  ride({ id: 'b1-z2-cadence-100', name: 'Rivanna', subtitle: 'Endurance 1:40 with cadence blocks', family: 'endurance', bases: BOTH, tag: { series: { id: 'endurance-cadence', rung: 4 } },
    purpose: 'A hundred minutes of zone 2 in five blocks, each ending with four minutes of quick pedalling. The long version of the cadence rides.',
    physiology: 'Aerobic base with pedalling efficiency.',
    blocks: [warm(15), rep(5, 'Zone 2', z2(12, { cadence: 88 }), z2(4, { cadence: 102, label: 'Spin', cues: [{ at: 0, text: 'Quick feet, same effort. About 100 rpm.' }] })), cool(5)] }),
  ride({ id: 'b1-z2-fastfinish-150', name: 'Rappahannock', subtitle: 'Endurance 2:30 with a fast finish', family: 'endurance', bases: BOTH, setting: 'outdoor',
    purpose: 'Two and a half hours, mostly zone 2, with the last quarter hour at the top of it. For the weekend: fuel on a schedule and finish strong.',
    physiology: 'Aerobic base and durability.',
    blocks: [warm(20), z2(100, { cues: [{ at: 0, text: 'Long and steady. Eat every 30 to 40 minutes, drink every 15.' }, { at: 3000, text: 'Halfway. Check the fuel: have you eaten?' }] }), st(15, 0.72, 0.78, { label: 'Fast finish', cues: [{ at: 0, text: 'The fast finish: top of zone 2 all the way home.' }] }), cool(15)] }),
  ride({ id: 'b1-z2-hilltempo-135', name: 'Appomattox', subtitle: 'Endurance 2:15 with hill tempo', family: 'endurance', bases: BOTH, setting: 'outdoor',
    purpose: 'Two and a quarter hours of zone 2 with a six-minute tempo effort every twenty minutes, where the hills would be. Let the road decide where they fall.',
    physiology: 'Aerobic base with muscular endurance.',
    blocks: [warm(20), rep(4, 'Zone 2', z2(20), st(6, 0.78, 0.86, { label: 'Hill tempo', cues: [{ at: 0, text: 'A hill: tempo, seated if you can.' }] })), cool(11)] }),
  ride({ id: 'b1-z2-long-210', name: 'James', subtitle: 'Long 3:30, steady and fueled', family: 'endurance', bases: BOTH, setting: 'outdoor',
    purpose: 'Three and a half hours of zone 2 in three long blocks, with five easy minutes between to eat, drink and stretch. Practice for a century, without the pressure of one.',
    physiology: 'Aerobic base, durability and fuelling.',
    blocks: [warm(20), rep(3, 'Long block', z2(55, { cues: [{ at: 0, text: 'Settle in for 55 minutes. Eat something every half hour.' }] }), easy(5, { label: 'Refuel', cues: [{ at: 0, text: 'Easy for five minutes: eat, drink, stand and stretch.' }] })), cool(10)] }),

  // ── VO2max ───────────────────────────────────────────────────────────────
  ride({ id: 'b1-vo2-hr-5x4', name: 'Old Rag', subtitle: 'VO2max 5 × 4 by heart rate', family: 'vo2max', bases: BOTH, tag: { series: { id: 'vo2-hr', rung: 3 } },
    purpose: 'Five four-minute efforts above threshold with four minutes easy between, then zone 2. Long enough for heart rate to get where it needs to be.',
    physiology: 'Maximal oxygen uptake.',
    blocks: [warm(15), rep(5, 'VO2max', st(4, 1.08, 1.15, { label: 'VO2max', cues: [{ at: 0, text: 'Go hard from the start; heart rate takes a minute to catch up.' }, lastMinute('Last minute. Hold it even.'), lastRep('The last one. Same as the others; no more.', 0)] }), easy(4, { cues: [{ at: 0, text: 'Easy. Breathe it down.' }] })), z2(15), cool(10)] }),
  ride({ id: 'b1-vo2-hr-3x6', name: 'Spy Rock', subtitle: 'VO2max 3 × 6 by heart rate', family: 'vo2max', bases: BOTH, tag: { series: { id: 'vo2-hr', rung: 4 } },
    purpose: 'Three six-minute efforts just above threshold. The longest VO2max intervals: heart rate has time to settle near the top, and that time is the training.',
    physiology: 'Maximal oxygen uptake; time near maximum heart rate.',
    blocks: [warm(15), rep(3, 'VO2max', st(6, 1.05, 1.12, { label: 'VO2max', cues: [{ at: 0, text: 'Six minutes. Start firm, not flat out.' }, { at: 180, text: 'Halfway. Heart rate should be near its top now.' }, lastMinute('One minute. Hold your form.')] }), easy(5)), z2(15), cool(10)] }),
  ride({ id: 'b1-vo2-hr-4x5', name: 'Three Ridges', subtitle: 'VO2max 4 × 5 by heart rate', family: 'vo2max', bases: BOTH,
    purpose: 'Four five-minute efforts with five minutes easy between, then zone 2. A middle rung between the 4-minute and 6-minute sets.',
    physiology: 'Maximal oxygen uptake.',
    blocks: [warm(15), rep(4, 'VO2max', st(5, 1.06, 1.13, { label: 'VO2max', cues: [{ at: 0, text: 'Five minutes. Commit early.' }, lastMinute('Last minute. Even to the end.')] }), easy(5)), z2(15), cool(10)] }),
  ride({ id: 'b1-vo2-hr-ladder', name: 'Reddish Knob', subtitle: 'VO2max ladder 3-4-5-4-3 by heart rate', family: 'vo2max', bases: BOTH,
    purpose: 'A ladder of efforts: three, four, five, four and three minutes, with the same time easy after each. The middle one is the summit.',
    physiology: 'Maximal oxygen uptake.',
    blocks: [warm(15), st(3, 1.08, 1.15, { label: 'Ladder 3 min', cues: [{ at: 0, text: 'First rung: three minutes.' }] }), easy(3), st(4, 1.07, 1.14, { label: 'Ladder 4 min' }), easy(4), st(5, 1.06, 1.13, { label: 'Ladder 5 min', cues: [{ at: 0, text: 'The summit: five minutes.' }, lastMinute('Over the top. One minute.')] }), easy(5), st(4, 1.07, 1.14, { label: 'Ladder 4 min', cues: [{ at: 0, text: 'Downhill side now. Four minutes.' }] }), easy(4), st(3, 1.08, 1.15, { label: 'Ladder 3 min', cues: [{ at: 0, text: 'Last rung. Three minutes.' }] }), easy(3), z2(10), cool(10)] }),
  ride({ id: 'b1-vo2-hr-3x5', name: "Dragon's Tooth", subtitle: 'Short VO2max 3 × 5 by heart rate', family: 'vo2max', bases: BOTH,
    purpose: 'Three five-minute efforts in under fifty minutes: VO2max for a short day when you train by heart rate.',
    physiology: 'Maximal oxygen uptake.',
    blocks: [warm(12), rep(3, 'VO2max', st(5, 1.06, 1.13, { label: 'VO2max', cues: [{ at: 0, text: 'Hard from the start; heart rate catches up.' }, lastRep('Last one.', 0)] }), easy(4)), cool(8)] }),
  ride({ id: 'b1-vo2-hr-4x4-shrink', name: 'McAfee Knob', subtitle: 'VO2max 4 × 4, shrinking rests, by heart rate', family: 'vo2max', bases: BOTH,
    purpose: 'Four four-minute efforts with rests that get shorter: four, three, then two minutes. Each effort starts with a little less recovery behind it.',
    physiology: 'Maximal oxygen uptake; recovery between hard efforts.',
    blocks: [warm(12), st(4, 1.08, 1.15, { label: 'VO2max 1' }), easy(4), st(4, 1.08, 1.15, { label: 'VO2max 2' }), easy(3, { cues: [{ at: 0, text: 'A shorter rest this time.' }] }), st(4, 1.08, 1.15, { label: 'VO2max 3' }), easy(2, { cues: [{ at: 0, text: 'Two minutes only. Breathe deep.' }] }), st(4, 1.08, 1.15, { label: 'VO2max 4', cues: [{ at: 0, text: 'Last one, on short rest. Hold the same target.' }] }), z2(8), cool(10)] }),
  ride({ id: 'b1-vo2-2sets-5x3', name: 'Mount Rogers', subtitle: 'VO2max two sets of 5 × 3', family: 'vo2max', bases: POWER,
    purpose: 'Two sets of five three-minute efforts, with eight easy minutes between the sets. A big VO2max day for when the plan wants one.',
    physiology: 'Maximal oxygen uptake, with volume.',
    blocks: [warm(15), rep(5, 'Set 1', st(3, 1.12, 1.2, { label: 'VO2max', cues: [{ at: 0, text: 'Set one. Steady and strong.' }] }), easy(3)), easy(8, { label: 'Between sets', cues: [{ at: 0, text: 'Halfway. Eat or drink something.' }] }), rep(5, 'Set 2', st(3, 1.12, 1.2, { label: 'VO2max', cues: [{ at: 0, text: 'Set two. Same watts as set one.' }, lastRep('The very last one. Finish it well.', 0)] }), easy(3)), z2(10), cool(7)] }),
  ride({ id: 'b1-vo2-inside-z2', name: 'Whitetop', subtitle: 'VO2max 6 × 3 inside an endurance ride', family: 'vo2max', bases: POWER, setting: 'outdoor',
    purpose: 'Half an hour of zone 2, six three-minute VO2max efforts, then zone 2 home. The hard work in the middle of a real ride.',
    physiology: 'Maximal oxygen uptake with aerobic volume.',
    blocks: [warm(20), z2(30), rep(6, 'VO2max', st(3, 1.12, 1.2, { label: 'VO2max', cues: [{ at: 0, text: 'Three minutes. Find a quiet stretch of road.' }] }), easy(3)), z2(15), cool(5)] }),
  ride({ id: 'b1-vo2-short-4x3', name: 'Elliott Knob', subtitle: 'Short VO2max 4 × 3', family: 'vo2max', bases: POWER,
    purpose: 'Four three-minute efforts in forty minutes. When the day is short and the plan wants VO2max.',
    physiology: 'Maximal oxygen uptake.',
    blocks: [warm(10), rep(4, 'VO2max', st(3, 1.12, 1.2, { label: 'VO2max', cues: [{ at: 0, text: 'Three minutes. Breathe big.' }, lastRep('Last one.', 0)] }), easy(3)), cool(6)] }),
  ride({ id: 'b1-vo2-short-6x2', name: 'High Knob', subtitle: 'Short VO2max 6 × 2', family: 'vo2max', bases: POWER,
    purpose: 'Six two-minute efforts with two minutes easy between, in forty minutes. Short, sharp and over quickly.',
    physiology: 'Maximal oxygen uptake.',
    blocks: [warm(10), rep(6, 'VO2max', st(2, 1.15, 1.25, { label: 'VO2max', cues: [{ at: 0, text: 'Two minutes. Hard but even.' }, lastRep('The sixth. Empty it, evenly.', 0)] }), easy(2)), cool(6)] }),

  // ── Sweet spot ───────────────────────────────────────────────────────────
  ride({ id: 'b1-ss-long-3x20', name: 'Shenandoah', subtitle: 'Long 3:30 with sweet spot 3 × 20', family: 'sweetspot', bases: BOTH, setting: 'outdoor',
    purpose: 'Three and a half hours with three twenty-minute sweet-spot blocks in the first half, then zone 2 home. A big weekend day for an event that is long and hard.',
    physiology: 'Threshold development with durability.',
    blocks: [warm(25), z2(30), rep(3, 'Sweet spot', st(20, 0.88, 0.93, { label: 'Sweet spot', cues: [{ at: 0, text: 'Twenty minutes of sweet spot: comfortably hard, steady.' }, { at: 600, text: 'Halfway through this block.' }] }), z2(10)), z2(60, { cues: [{ at: 0, text: 'The work is done. Zone 2 home, and keep eating.' }] }), cool(5)] }),
  ride({ id: 'b1-ss-long-second-half', name: 'New River', subtitle: 'Long 3:10, sweet spot in the second half', family: 'sweetspot', bases: BOTH, setting: 'outdoor',
    purpose: 'An hour and a half of zone 2, then two twenty-five-minute sweet-spot blocks on tired legs. Rehearses the second half of a long event.',
    physiology: 'Threshold power under fatigue.',
    blocks: [warm(20), z2(90, { cues: [{ at: 0, text: 'Ninety minutes of zone 2 first. Fuel now for later.' }] }), rep(2, 'Sweet spot', st(25, 0.86, 0.91, { label: 'Sweet spot', cues: [{ at: 0, text: 'Sweet spot on tired legs. Hold it, don’t chase it.' }] }), z2(10)), cool(10)] }),
  ride({ id: 'b1-ss-long-4x15', name: 'Clinch', subtitle: 'Long 3:15 with sweet spot 4 × 15', family: 'sweetspot', bases: BOTH, setting: 'outdoor',
    purpose: 'Three and a quarter hours with four fifteen-minute sweet-spot blocks spread through the middle. Long, with the work broken into pieces you can manage.',
    physiology: 'Threshold development with durability.',
    blocks: [warm(20), z2(40), rep(4, 'Sweet spot', st(15, 0.87, 0.92, { label: 'Sweet spot', cues: [{ at: 0, text: 'Fifteen minutes of sweet spot.' }, lastRep('The last block. Same as the first.', 0)] }), z2(8)), z2(38), cool(5)] }),
  ride({ id: 'b1-ss-stairs-3x9', name: 'Gilberts Corner', subtitle: 'Sweet spot 3 × 9, stepping up', family: 'sweetspot', bases: BOTH,
    purpose: 'Three nine-minute blocks, each climbing through three steps of sweet spot: low, middle, high. Under an hour, with a finish in every block.',
    physiology: 'Threshold development.',
    blocks: [warm(10), rep(3, 'Sweet spot', st(3, 0.86, 0.9, { label: 'Sweet spot, low' }), st(3, 0.89, 0.93, { label: 'Sweet spot, middle' }), st(3, 0.92, 0.96, { label: 'Sweet spot, high', cues: [{ at: 0, text: 'Top step. Hold it to the end of the block.' }] }), easy(3)), cool(8)] }),
  ride({ id: 'b1-ss-2x18', name: 'Evergreen Mills', subtitle: 'Sweet spot 2 × 18', family: 'sweetspot', bases: BOTH,
    purpose: 'Two eighteen-minute sweet-spot blocks in an hour. Long enough to count, short enough for a weekday.',
    physiology: 'Threshold development with manageable fatigue.',
    blocks: [warm(10), rep(2, 'Sweet spot', st(18, 0.88, 0.93, { label: 'Sweet spot', cues: [{ at: 0, text: 'Eighteen minutes. Find a rhythm and keep it.' }, { at: 540, text: 'Halfway. Relax the shoulders.' }] }), easy(4)), cool(6)] }),
  ride({ id: 'b1-ss-rolling-150', name: 'Holston', subtitle: 'Sweet spot 2:30, rolling', family: 'sweetspot', bases: BOTH, setting: 'outdoor',
    purpose: 'Two and a half hours alternating twelve minutes of sweet spot and twelve of zone 2, four times, then zone 2 home. A long ride with real work in it.',
    physiology: 'Threshold development with durability.',
    blocks: [warm(20), rep(4, 'Sweet spot', st(12, 0.87, 0.92, { label: 'Sweet spot', cues: [{ at: 0, text: 'Twelve minutes of sweet spot.' }] }), z2(12)), z2(30), cool(4)] }),

  // ── Recovery ─────────────────────────────────────────────────────────────
  ride({ id: 'b1-rec-spinups-25', name: 'Dyke Marsh', subtitle: 'Recovery 25 with spin-ups', family: 'recovery', bases: BOTH, tag: { series: { id: 'recovery', rung: 1 } },
    purpose: 'Twenty-five easy minutes with a few short spin-ups to wake the legs. The day after a hard one.',
    physiology: 'Circulation and leg speed with almost no training stress.',
    blocks: [st(5, 0.45, 0.55, { label: 'Easy', cues: [{ at: 0, text: 'Truly easy. Lighter than you think.' }] }), rep(4, 'Spin-up', st(1, 0.5, 0.58, { label: 'Spin-up', cadence: 105, cues: [{ at: 0, text: 'Spin up to about 105 rpm, no extra effort.' }] }), st(2, 0.45, 0.55, { label: 'Easy', cadence: 88 })), st(8, 0.45, 0.55, { label: 'Easy' })] }),
  ride({ id: 'b1-rec-35', name: 'Huntley Meadows', subtitle: 'Recovery 35', family: 'recovery', bases: BOTH, tag: { series: { id: 'recovery', rung: 2 } },
    purpose: 'Thirty-five minutes as easy as you can turn the pedals. Nothing to prove today.',
    physiology: 'Recovery: blood flow with almost no stress.',
    blocks: [st(35, 0.45, 0.55, { label: 'Easy', cadence: 90, cues: [{ at: 0, text: 'Easy spinning. If you can’t chat, it’s too hard.' }, { at: 900, text: 'Still easy. Loosen the grip on the bars.' }] })] }),
  ride({ id: 'b1-rec-40', name: 'Daingerfield Island', subtitle: 'Recovery 40, cadence play', family: 'recovery', bases: BOTH, tag: { series: { id: 'recovery', rung: 3 } },
    purpose: 'Forty easy minutes, changing cadence every ten minutes so the legs wake up without working.',
    physiology: 'Recovery with pedalling variety.',
    blocks: [st(10, 0.45, 0.55, { label: 'Easy', cadence: 85 }), st(10, 0.45, 0.55, { label: 'Easy, quicker', cadence: 95, cues: [{ at: 0, text: 'Quicker legs, same easy effort.' }] }), st(10, 0.45, 0.55, { label: 'Easy, quickest', cadence: 102 }), st(10, 0.45, 0.55, { label: 'Easy', cadence: 88, cues: [{ at: 0, text: 'Settle back down. Nearly done.' }] })] }),
  ride({ id: 'b1-rec-30', name: 'Fort Hunt', subtitle: 'Recovery 30, legs only', family: 'recovery', bases: BOTH,
    purpose: 'Thirty easy minutes. The point is to move, not to train.',
    physiology: 'Recovery.',
    blocks: [st(30, 0.45, 0.55, { label: 'Easy', cues: [{ at: 0, text: 'Easy for thirty minutes. Let the legs do nothing much.' }] })] }),
  ride({ id: 'b1-rec-50', name: 'Mason Neck', subtitle: 'Recovery 50 with three spin-ups', family: 'recovery', bases: BOTH, tag: { series: { id: 'recovery', rung: 4 } },
    purpose: 'Fifty easy minutes with three one-minute spin-ups. A longer recovery day that still leaves you fresher.',
    physiology: 'Recovery with leg speed.',
    blocks: [st(12, 0.45, 0.55, { label: 'Easy' }), rep(3, 'Easy', st(1, 0.5, 0.58, { label: 'Spin-up', cadence: 105, cues: [{ at: 0, text: 'Spin up, no extra effort.' }] }), st(10, 0.45, 0.55, { label: 'Easy' })), st(5, 0.45, 0.55, { label: 'Easy' })] }),

  // ── Tempo ────────────────────────────────────────────────────────────────
  ride({ id: 'b1-tempo-3x20', name: 'York', subtitle: 'Tempo 1:45, 3 × 20', family: 'tempo', bases: BOTH,
    purpose: 'Three twenty-minute tempo blocks in an hour and three quarters. Steady, unglamorous and very effective.',
    physiology: 'Muscular endurance.',
    blocks: [warm(15), rep(3, 'Tempo', st(20, 0.78, 0.85, { label: 'Tempo', cues: [{ at: 0, text: 'Twenty minutes of tempo: steady, deep breathing.' }, lastRep('The last block. Even pressure.', 0)] }), easy(5)), cool(15)] }),
  ride({ id: 'b1-tempo-45-block', name: 'Blackwater', subtitle: 'Tempo 1:40, one long block', family: 'tempo', bases: BOTH,
    purpose: 'One forty-five-minute block of tempo, then zone 2. Teaches patience and pacing.',
    physiology: 'Muscular endurance; pacing.',
    blocks: [warm(20), st(45, 0.76, 0.83, { label: 'Tempo', cues: [{ at: 0, text: 'Forty-five minutes. Start at the bottom of the range.' }, { at: 1500, text: 'Twenty-five done. Hold your shape on the bike.' }, lastMinute('Last minute of tempo.')] }), z2(25), cool(10)] }),
  ride({ id: 'b1-tempo-2x15', name: 'Sully', subtitle: 'Tempo 50, 2 × 15', family: 'tempo', bases: BOTH,
    purpose: 'Two fifteen-minute tempo blocks in fifty minutes. A short ride that still builds staying power.',
    physiology: 'Muscular endurance.',
    blocks: [warm(10), rep(2, 'Tempo', st(15, 0.78, 0.84, { label: 'Tempo', cues: [{ at: 0, text: 'Fifteen minutes of tempo.' }] }), easy(3)), cool(4)] }),
  ride({ id: 'b1-tempo-long-150', name: 'Nottoway', subtitle: 'Endurance 2:30 with tempo blocks', family: 'tempo', bases: BOTH, setting: 'outdoor',
    purpose: 'Two and a half hours with three fifteen-minute tempo blocks in the middle. A long ride that asks a little more than zone 2.',
    physiology: 'Muscular endurance with aerobic volume.',
    blocks: [warm(20), z2(30), rep(3, 'Tempo', st(15, 0.78, 0.84, { label: 'Tempo', cues: [{ at: 0, text: 'Fifteen minutes of tempo.' }] }), z2(10)), z2(20), cool(5)] }),
  ride({ id: 'b1-tempo-climb-75', name: 'Bull Run', subtitle: 'Tempo 75, seated climbing', family: 'tempo', bases: BOTH,
    purpose: 'Three twelve-minute tempo blocks at a climbing cadence, with easy spinning between. Strength for the long climbs.',
    physiology: 'Muscular endurance and climbing strength.',
    blocks: [warm(12), rep(3, 'Tempo climb', st(12, 0.78, 0.84, { label: 'Tempo climb', cadence: 74, cues: [{ at: 0, text: 'A long climb: about 74 rpm, seated, steady.' }] }), st(5, 0.55, 0.65, { label: 'Spin', cadence: 95 })), cool(12)] }),

  // ── Threshold ────────────────────────────────────────────────────────────
  ride({ id: 'b1-thr-3x8', name: 'Vesuvius', subtitle: 'Threshold 3 × 8', family: 'threshold', bases: BOTH, tag: { series: { id: 'threshold-short', rung: 2 } },
    purpose: 'Three eight-minute efforts at threshold with four minutes easy between. Named for the climb out of Vesuvius: steady pain, well paced.',
    physiology: 'Lactate threshold; raises FTP directly.',
    blocks: [warm(12), rep(3, 'Threshold', st(8, 0.95, 1.0, { label: 'Threshold', cues: [{ at: 0, text: 'Eight minutes at threshold. Even pacing beats a fast start.' }, lastMinute('Last minute. Hold it.')] }), easy(4)), cool(8)] }),
  ride({ id: 'b1-thr-2x12-climb', name: 'The Priest', subtitle: 'Threshold 2 × 12, climbing', family: 'threshold', bases: BOTH, tag: { series: { id: 'threshold-short', rung: 3 } },
    purpose: 'Two twelve-minute threshold efforts at a climbing cadence. Long, steady and seated, like the climb it’s named for.',
    physiology: 'Lactate threshold and climbing strength.',
    blocks: [warm(12), rep(2, 'Threshold climb', st(12, 0.94, 0.99, { label: 'Threshold climb', cadence: 75, cues: [{ at: 0, text: 'Twelve minutes, seated, about 75 rpm.' }, { at: 360, text: 'Halfway up.' }, lastMinute('The last minute of the climb.')] }), easy(5)), cool(9)] }),
  ride({ id: 'b1-thr-4x6', name: 'Wintergreen', subtitle: 'Threshold 4 × 6', family: 'threshold', bases: BOTH, tag: { series: { id: 'threshold-short', rung: 1 } },
    purpose: 'Four six-minute efforts at threshold with three minutes easy between. The way into threshold work on a short day.',
    physiology: 'Lactate threshold.',
    blocks: [warm(10), rep(4, 'Threshold', st(6, 0.96, 1.01, { label: 'Threshold', cues: [{ at: 0, text: 'Six minutes at threshold.' }, lastRep('The fourth. Finish as strong as you started.', 0)] }), easy(3)), cool(8)] }),
  ride({ id: 'b1-thr-20', name: 'Tinker Cliffs', subtitle: 'Threshold 20 straight', family: 'threshold', bases: BOTH, tag: { series: { id: 'threshold-short', rung: 4 } },
    purpose: 'One twenty-minute effort just under threshold, then zone 2. Simple, honest, and a good test of where you are.',
    physiology: 'Lactate threshold; pacing.',
    blocks: [warm(15), st(20, 0.94, 0.99, { label: 'Threshold', cues: [{ at: 0, text: 'Twenty minutes. The first five should feel too easy.' }, { at: 600, text: 'Halfway. Settle, don’t surge.' }, lastMinute('Last minute. You can hold this.')] }), z2(10), cool(8)] }),

  // ── Race and group rides ─────────────────────────────────────────────────
  ride({ id: 'b1-mix-granfondo-150', name: 'Monticello', subtitle: 'Gran fondo rehearsal 2:30', family: 'threshold', bases: POWER, setting: 'outdoor', tag: { purpose: 'mixed' },
    purpose: 'Two and a half hours shaped like a hilly gran fondo: a long climb, a set of short attacks, more zone 2, a second climb and a sprint for the line. Eat on the schedule you will use on the day.',
    physiology: 'Event-specific pacing, climbing and surge tolerance.',
    blocks: [warm(20), z2(30), st(12, 0.92, 0.98, { label: 'First climb', cues: [{ at: 0, text: 'The first climb: steady, just under threshold.' }] }), z2(10), rep(3, 'Attacks', st(4, 1.0, 1.06, { label: 'Attack', cues: [{ at: 0, text: 'An attack: go with it for four minutes.' }] }), easy(4)), z2(30, { cues: [{ at: 0, text: 'Back in the group. Eat and drink.' }] }), st(10, 0.95, 1.0, { label: 'Second climb', cues: [{ at: 0, text: 'The last climb. Pace it from the bottom.' }] }), z2(10), st(0.33, 1.5, undefined, { label: 'Sprint', cues: [{ at: 0, text: 'Sprint for the line!' }] }), cool(11.67)] }),
  ride({ id: 'b1-mix-fastgroup-135', name: 'Yorktown', subtitle: 'Fast group ride 2:15', family: 'threshold', bases: POWER, setting: 'outdoor', tag: { purpose: 'mixed' },
    purpose: 'Two and a quarter hours like a fast group ride: long pulls at tempo, surges when the pace lifts, two climbs and a town-line sprint. Ride it solo or take it to the group.',
    physiology: 'Variable-intensity tolerance; surge recovery.',
    blocks: [warm(20), st(15, 0.8, 0.86, { label: 'Tempo in the bunch' }), st(2, 1.05, 1.12, { label: 'Surge', cues: [{ at: 0, text: 'The pace lifts. Close the gap.' }] }), st(12, 0.8, 0.86, { label: 'Tempo in the bunch' }), st(5, 0.95, 1.02, { label: 'Climb' }), z2(10), st(3, 1.0, 1.08, { label: 'Pull', cues: [{ at: 0, text: 'Your turn on the front.' }] }), st(15, 0.78, 0.85, { label: 'Tempo in the bunch' }), st(2, 1.05, 1.12, { label: 'Surge' }), st(6, 0.95, 1.02, { label: 'Climb' }), z2(8), st(0.25, 1.6, undefined, { label: 'Town-line sprint', cues: [{ at: 0, text: 'Town-line sprint!' }] }), z2(32.75, { label: 'Zone 2 home' }), cool(5)] }),
  ride({ id: 'b1-mix-crit-70', name: 'Jamestown', subtitle: 'Criterium simulation 70', family: 'threshold', bases: POWER, setting: 'indoor', tag: { purpose: 'mixed' },
    purpose: 'Seventy minutes shaped like a criterium: a fast start, repeated hard accelerations out of corners, a breakaway effort and a final sprint. Best on the trainer, where the accelerations can be exact.',
    physiology: 'Repeated surge tolerance; anaerobic and threshold power together.',
    blocks: [warm(15), st(3, 1.0, 1.08, { label: 'Fast start', cues: [{ at: 0, text: 'The gun goes. Hold the wheel in front.' }] }), rep(6, 'Corners', st(0.25, 1.5, undefined, { label: 'Corner exit', cues: [{ at: 0, text: 'Out of the corner: accelerate!' }] }), st(1.75, 0.85, 0.92, { label: 'In the bunch' })), easy(4), st(5, 1.02, 1.08, { label: 'Breakaway', cues: [{ at: 0, text: 'The break goes. Commit for five minutes.' }] }), easy(5), rep(6, 'Corners', st(0.25, 1.5, undefined, { label: 'Corner exit' }), st(1.75, 0.85, 0.92, { label: 'In the bunch' })), st(0.5, 1.6, undefined, { label: 'Final sprint', cues: [{ at: 0, text: 'Final sprint. Everything.' }] }), cool(13.5)] }),
  ride({ id: 'b1-mix-hillygroup-75', name: 'Luray', subtitle: 'Hilly group ride 75', family: 'threshold', bases: POWER, tag: { purpose: 'mixed' },
    purpose: 'Seventy-five minutes over rolling hills with a group: tempo between, threshold on the climbs, one attack over the top. Hard but varied.',
    physiology: 'Variable-intensity tolerance; climbing.',
    blocks: [warm(12), st(8, 0.78, 0.85, { label: 'Tempo' }), st(4, 0.95, 1.02, { label: 'Climb', cues: [{ at: 0, text: 'A climb: threshold, seated.' }] }), z2(6), st(5, 0.95, 1.02, { label: 'Climb' }), st(1, 1.15, 1.25, { label: 'Over the top', cues: [{ at: 0, text: 'Attack over the top!' }] }), z2(8), st(8, 0.8, 0.86, { label: 'Tempo' }), st(4, 0.97, 1.04, { label: 'Climb', cues: [{ at: 0, text: 'Last climb.' }] }), z2(9), cool(10)] }),

  // ── Anaerobic ────────────────────────────────────────────────────────────
  ride({ id: 'b1-ana-hr-hill-5x2', name: 'Hogback', subtitle: 'Anaerobic hill repeats 5 × 2 by heart rate', family: 'anaerobic', bases: BOTH,
    purpose: 'Five two-minute hill repeats well above threshold, four minutes easy between. Heart rate won’t settle in two minutes, so the target is a floor to pass: go by feel, as hard as you can keep even.',
    physiology: 'Anaerobic capacity; tolerance of hard efforts.',
    blocks: [warm(12), rep(5, 'Hill repeat', st(2, 1.2, 1.3, { label: 'Hill repeat', cues: [{ at: 0, text: 'Hard up the hill, as even as you can.' }, lastRep('The last repeat. Make it your best.', 0)] }), easy(4)), z2(6), cool(10)] }),
  ride({ id: 'b1-ana-3sets-3x1', name: 'Humpback Rocks', subtitle: 'Anaerobic capacity, three sets of 3 × 1', family: 'anaerobic', bases: POWER,
    purpose: 'Three sets of three one-minute efforts far above threshold, two minutes easy between and five between sets. The kind of work that wins a hard finish.',
    physiology: 'Anaerobic capacity and buffering.',
    blocks: [warm(15), rep(3, 'Set 1', st(1, 1.3, 1.45, { label: 'Anaerobic', cues: [{ at: 0, text: 'One minute, very hard.' }] }), easy(2)), easy(5, { label: 'Between sets' }), rep(3, 'Set 2', st(1, 1.3, 1.45, { label: 'Anaerobic' }), easy(2)), easy(5, { label: 'Between sets' }), rep(3, 'Set 3', st(1, 1.3, 1.45, { label: 'Anaerobic', cues: [{ at: 0, text: 'The last set.' }] }), easy(2)), z2(8), cool(8)] }),
];
