/**
 * Fitness tests in the ride player: the rules that run during a test, and (Part C)
 * the arithmetic that turns its recording into results. Pure, so it is tested.
 */
import type { Recording, Sample } from './types';
import type { TimelineStep } from './timeline';
import { breathThresholds, cleanBreathing, type BreathTest } from '../engine/breathThresholds';
import { judgeRamp, type RampJudgement } from '../engine/rampJudge';

/** Below this share of the step's target, held for ten seconds, the ramp has given out. */
export const RAMP_GIVE_OUT = 0.85;

/**
 * Whether the Ramp Test should end by itself now: from the second ramp step on,
 * at least five seconds into the step, when at least eight of the last ten
 * readings are each under 85% of the step's target. Legs that have gone read
 * low second after second; a power meter dropping to zero for a few seconds
 * does not, so a dropout never ends the test. A cadence collapse in ERG shows
 * here too (the trainer eases off and the power falls). Fewer than eight
 * readings in the ten seconds decide nothing.
 */
export function rampGaveOut(last10: Array<number | undefined>, target: number, secondsIntoStep: number, rampStep: number): boolean {
  if (rampStep < 2 || secondsIntoStep < 5 || target <= 0) return false;
  const ws = last10.slice(-10).filter((w): w is number => w != null);
  if (ws.length < 8) return false;
  return ws.filter((w) => w < RAMP_GIVE_OUT * target).length >= 8;
}

// ── Results (Part C) ───────────────────────────────────────────────────────


/**
 * What a test found. Kept on the recording (and so general that later steps add
 * breathing thresholds to it). Numbers are rounded for showing; the action
 * fields say what the rider did with each suggestion.
 */
/**
 * 2 (Part A, 4 Nov 2026): judged, reconciled, with the breathing diagnosis. A ramp result before that is read again from its recording when shown.
 * 3 (7 Nov 2026): breathing thresholds read from breathing rate too (a strap that compresses breath size).
 */
export const TEST_RESULT_VERSION = 3;

export interface TestResult {
  kind: 'ramp' | '20min';
  /** How the result was worked out (TEST_RESULT_VERSION). */
  v?: number;
  /** The Ramp Test: watts added each minute. */
  stepWatts?: number;
  /** The Ramp Test: the highest 60-second average power. */
  bestMinuteWatts?: number;
  /** The 20-minute test: average power over the twenty minutes. */
  testWatts?: number;
  /** FTP the test suggests, watts. */
  ftpEstimate?: number;
  /** The FTP setting when the test was ridden. */
  ftpBefore?: number;
  ftpAction?: 'updated' | 'kept';
  /** The Ramp Test: the last full step plus the share of the step it ended in. */
  peakWatts?: number;
  /** VO2max estimated from peak power (litres a minute), and per kilo when the weight is known. */
  vo2maxLmin?: number;
  vo2maxMlKgMin?: number;
  /** The Ramp Test: average heart rate in the minute the ramp first passed the new FTP. Information only. */
  hrAtFtp?: number;
  /** The 20-minute test: threshold heart rate it suggests (the last fifteen minutes' average). */
  lthrEstimate?: number;
  lthrBefore?: number;
  lthrAction?: 'updated' | 'kept';
  endedBy?: 'rider' | 'auto';
  /** Seconds from the start of the ride when the ramp ended. */
  endedAt?: number;
  /** Worked out from Intervals.icu's copy of a ride recorded elsewhere (no step-by-step targets to read). */
  fromStreams?: boolean;
  /**
   * Step 4 (3 Nov 2026): the Ramp Test's breathing thresholds, when a strap was
   * worn (absent: no breathing to read, or read before Step 4, in which case
   * the activity's page reads it once from the recording). On a ramp with a
   * second threshold, lthrEstimate is the heart rate there.
   */
  breath?: BreathTest;
  /** What the rider did with the zones the test suggests. */
  zonesAction?: 'applied' | 'kept';
  /** Part A1 (4 Nov 2026): was the ramp all-out, did it pass the second threshold; the witness lines are for the coach. */
  judge?: RampJudgement;
  /** Part A3: 75% of the best minute, the rule FTP always starts from. */
  ftpFromBestMinute?: number;
  /** Part A3: the witnesses the FTP was built from (each used only when earned), with their weights. */
  ftpWitnesses?: Array<{ source: 'best-minute' | 'vt2' | 'riding'; watts: number; weight: number }>;
  /** Part A3: the witnesses disagreed by more than 8%; the FTP offered is the best-minute figure. */
  ftpDisagree?: boolean;
  /** Part A3: heart rate at the FTP was within 5 bpm of the threshold-heart-rate setting. */
  ftpHrAgrees?: boolean;
  /** Part A6: VO2max's likely range (same unit as vo2maxMlKgMin, or litres a minute without weight), and whether it is a floor (the test was not all-out). */
  vo2maxRange?: [number, number];
  vo2maxAtLeast?: boolean;
}

/** The highest average of `secs` consecutive one-second readings (gaps count as zero). Undefined when the ride is shorter. */
export function bestAverage(values: Array<number | undefined>, secs: number): number | undefined {
  if (values.length < secs || secs <= 0) return undefined;
  let sum = 0;
  for (let i = 0; i < secs; i++) sum += values[i] ?? 0;
  let best = sum;
  for (let i = secs; i < values.length; i++) { sum += (values[i] ?? 0) - (values[i - secs] ?? 0); if (sum > best) best = sum; }
  return best / secs;
}

/**
 * Hawley and Noakes (1992): VO2max in litres a minute from peak power on an incremental test.
 * Part A6 (4 Nov 2026): their protocol added about 20 W a minute; a steeper ramp reaches a higher peak for the
 * same rider, so peak power is corrected to 20 W a minute at 1% for every 5 W a minute of difference
 * (factor 1 - 0.002 × (step - 20)). The likely range is ±8%: nearly all the error is in pedalling efficiency,
 * which the formula assumes is average and which moves every estimate from power together.
 */
export const VO2_STEP_REF = 20;
export const VO2_STEP_PER_WATT = 0.002;
export const VO2_RANGE = 0.08;
export function vo2maxFromPeak(peakWatts: number, weightKg?: number, stepWatts?: number): { lmin: number; mlKgMin?: number; range: [number, number] } {
  const corr = stepWatts && stepWatts > 0 ? 1 - VO2_STEP_PER_WATT * (stepWatts - VO2_STEP_REF) : 1;
  const lmin = 0.01141 * peakWatts * corr + 0.435;
  const per = weightKg && weightKg > 0 ? (lmin * 1000) / weightKg : undefined;
  const v = per ?? lmin;
  const r = per != null ? (x: number) => Math.round(x) : (x: number) => Math.round(x * 10) / 10;
  return { lmin: Math.round(lmin * 100) / 100, mlKgMin: per != null ? Math.round(per * 10) / 10 : undefined, range: [r(v * (1 - VO2_RANGE)), r(v * (1 + VO2_RANGE))] };
}

const avg = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const targetOf = (samples: Sample[], index: number): number | undefined => samples.find((s) => s.s === index && s.tgt != null)?.tgt;

/**
 * What a ramp is read against (Part A, 4 Nov 2026): the rider's settings, the
 * highest heart rate seen in their rides, and the FTP recent riding shows when
 * its critical-power fit is trustworthy. All optional.
 */
export interface RampContext { ftp?: number; lthr?: number; maxHr?: number; learnedMaxHr?: number; cpFtp?: number }

/** Part A3: witnesses further apart than this (highest over lowest) disagree. */
export const FTP_DISAGREE = 0.08;
/** Part A3: heart rate at the FTP within this of the threshold-heart-rate setting agrees. */
export const HR_AGREES_BPM = 5;

/**
 * Part A3: one FTP from the witnesses the test earned. 75% of the best minute
 * always (weight 1); the second breathing threshold's power when found on a
 * ramp judged all-out (weight 1 when clear, 0.5 when less certain); the FTP the
 * recent riding shows, only when its fit passed its own check (weight 0.5).
 * When they disagree by more than 8%, the best-minute figure is offered.
 */
export function reconcileFtp(bestMinuteFtp: number, breath: BreathTest | undefined, judge: RampJudgement | undefined, cpFtp?: number): Pick<TestResult, 'ftpEstimate' | 'ftpWitnesses' | 'ftpDisagree'> {
  const w: NonNullable<TestResult['ftpWitnesses']> = [{ source: 'best-minute', watts: bestMinuteFtp, weight: 1 }];
  const allOut = judge?.allOut === 'yes' || judge?.allOut === 'probably';
  if (breath?.vt2 && allOut) w.push({ source: 'vt2', watts: breath.vt2.watts, weight: breath.vt2.certainty === 'clear' ? 1 : 0.5 });
  if (cpFtp && cpFtp > 0) w.push({ source: 'riding', watts: cpFtp, weight: 0.5 });
  const xs = w.map((x) => x.watts);
  const disagree = Math.max(...xs) / Math.min(...xs) - 1 > FTP_DISAGREE;
  const blended = Math.round(w.reduce((a, x) => a + x.watts * x.weight, 0) / w.reduce((a, x) => a + x.weight, 0));
  return { ftpEstimate: disagree ? bestMinuteFtp : blended, ftpWitnesses: w, ...(disagree ? { ftpDisagree: true } : {}) };
}

/**
 * The Ramp Test's results from the player's recording and the ride's timeline
 * (as ended): best minute up to the end of the ramp, peak power (last full step
 * plus the share of the unfinished one, from the targets the trainer held), the
 * ramp's judgement (Part A1), the breathing thresholds (A2), one reconciled FTP
 * (A3), VO2max from peak power with its range (A6), and heart rate at the FTP.
 */
export function rampResult(rec: Pick<Recording, 'samples' | 'rampStep' | 'rampEndAt' | 'events'>, timeline: TimelineStep[], weightKg?: number, ctx?: RampContext): TestResult {
  const endP = rec.rampEndAt ?? Infinity;
  const ridden = rec.samples.filter((s) => (s.p ?? 0) < endP);
  const best = bestAverage(ridden.map((s) => s.w), 60);
  const bmFtp = best != null ? Math.round(best * 0.75) : undefined;
  const ramp = timeline.filter((s) => s.ramp);
  const last = ramp[ramp.length - 1];
  let peak: number | undefined;
  if (last) {
    const lastT = targetOf(rec.samples, last.index);
    const partial = last.seconds < 60 ? last.seconds : 0;
    const full = partial ? timeline[last.index - 1] : last;
    const fullT = full ? targetOf(rec.samples, full.index) : undefined;
    if (fullT != null) peak = partial && lastT != null ? fullT + (partial / 60) * (lastT - fullT) : fullT;
  }
  const ev = rec.events.find((e) => e.type === 'test');
  const endedBy: TestResult['endedBy'] = ev?.value === 'auto' ? 'auto' : ev ? 'rider' : undefined;
  const span = rampSpan(rec, timeline);
  const judge = span ? judgeOf(rec.samples, span, { ...ctx, peakWatts: peak, stepWatts: rec.rampStep, endedBy }) : undefined;
  const breath = span ? rampBreathing(rec, timeline, ctx, judge) : undefined;
  const fields = bmFtp != null ? reconcileFtp(bmFtp, breath, judge, ctx?.cpFtp) : {};
  const ftp = fields.ftpEstimate;
  const vo2 = peak != null ? vo2maxFromPeak(peak, weightKg, rec.rampStep) : undefined;
  let hrAtFtp: number | undefined;
  if (ftp != null) {
    const passed = ramp.find((s) => (targetOf(rec.samples, s.index) ?? 0) >= ftp);
    const hrs = passed ? rec.samples.filter((s) => s.s === passed.index && s.hr != null && s.hr > 0).map((s) => s.hr!) : [];
    if (hrs.length >= 30) hrAtFtp = Math.round(avg(hrs)!);
  }
  return {
    kind: 'ramp', v: TEST_RESULT_VERSION, stepWatts: rec.rampStep, ...breathFields(breath),
    bestMinuteWatts: best != null ? Math.round(best) : undefined, ftpFromBestMinute: bmFtp, ...fields,
    peakWatts: peak != null ? Math.round(peak * 10) / 10 : undefined,
    ...vo2Fields(vo2, judge), hrAtFtp,
    ...(hrAtFtp != null && ctx?.lthr ? { ftpHrAgrees: Math.abs(hrAtFtp - ctx.lthr) <= HR_AGREES_BPM } : {}),
    endedBy, endedAt: ev?.t, ...(judge ? { judge } : {}),
  };
}

function vo2Fields(vo2: ReturnType<typeof vo2maxFromPeak> | undefined, judge: RampJudgement | undefined): Pick<TestResult, 'vo2maxLmin' | 'vo2maxMlKgMin' | 'vo2maxRange' | 'vo2maxAtLeast'> {
  if (!vo2) return {};
  return { vo2maxLmin: vo2.lmin, vo2maxMlKgMin: vo2.mlKgMin, vo2maxRange: vo2.range, ...(judge?.allOut === 'no' ? { vo2maxAtLeast: true } : {}) };
}

/** The ramp's first and last seconds in the recording: its steps only, up to where it ended. */
function rampSpan(rec: Pick<Recording, 'samples' | 'rampEndAt'>, timeline: TimelineStep[]): { from: number; to: number } | undefined {
  const rampSteps = new Set(timeline.filter((s) => s.ramp).map((s) => s.index));
  const endP = rec.rampEndAt ?? Infinity;
  const on = rec.samples.filter((x) => x.s != null && rampSteps.has(x.s) && (x.p ?? 0) < endP);
  return on.length ? { from: on[0].t, to: on[on.length - 1].t + 1 } : undefined;
}

function judgeOf(ss: Sample[], span: { from: number; to: number }, o: RampContext & { peakWatts?: number; stepWatts?: number; endedBy?: 'rider' | 'auto' }): RampJudgement {
  const time = ss.map((x) => x.t);
  const clean = cleanBreathing(time, ss.map((x) => x.ve ?? NaN), ss.map((x) => x.br ?? NaN), ss.map((x) => x.tv ?? NaN));
  return judgeRamp({ time, watts: ss.map((x) => x.w), hr: ss.map((x) => x.hr), ve: clean.ve, ...span, ...o });
}

/** What the rider did with a result, carried onto the same test read again. */
export function withActions(next: TestResult, was: TestResult | undefined): TestResult {
  if (!was) return next;
  return { ...next, ftpBefore: was.ftpBefore ?? next.ftpBefore, ftpAction: was.ftpAction, lthrBefore: was.lthrBefore ?? next.lthrBefore, lthrAction: was.lthrAction, zonesAction: was.zonesAction };
}

/** The breathing fields of a ramp's result: the thresholds, and threshold heart rate from the second one. */
export function breathFields(breath: BreathTest | undefined): Pick<TestResult, 'breath' | 'lthrEstimate'> {
  if (!breath) return {};
  return { breath, ...(breath.vt2?.hr ? { lthrEstimate: breath.vt2.hr } : {}) };
}

/** The ramp's breathing thresholds from the player's recording: the ramp steps only, up to where it ended. */
export function rampBreathing(rec: Pick<Recording, 'samples' | 'rampEndAt'>, timeline: TimelineStep[], ctx?: RampContext, judge?: RampJudgement): BreathTest | undefined {
  if (!rec.samples.some((x) => x.ve != null && x.ve > 0)) return undefined;
  const span = rampSpan(rec, timeline);
  if (!span) return undefined;
  const ss = rec.samples;
  return breathThresholds({
    time: ss.map((x) => x.t), watts: ss.map((x) => x.w ?? NaN), hr: ss.map((x) => x.hr ?? NaN),
    ve: ss.map((x) => x.ve ?? NaN), br: ss.map((x) => x.br ?? NaN), tv: ss.map((x) => x.tv ?? NaN),
    ...span, ...ctx, judge,
  });
}

/** The warm-up before the first ramp step, seconds: what a ramp ridden in the player starts with. */
export const RAMP_WARMUP_SECONDS = 300;

/**
 * A Ramp Test's breathing thresholds from one-second streams (a test ridden
 * before Step 4, or seen on a device without its recording): the ramp taken as
 * from the end of the five-minute warm-up to where it ended (the result's own
 * record of it, or the end of the best minute).
 */
export function rampBreathingFromStreams(s: { time: number[]; watts?: number[]; heartrate?: number[]; ve?: number[]; br?: number[]; tv?: number[] }, endedAt?: number, ctx?: RampContext): BreathTest | undefined {
  if (!s.ve?.some((v) => v != null && isFinite(v) && v > 0) || !s.watts?.length) return undefined;
  let to = endedAt;
  if (to == null) {
    // The end of the best minute: where the legs gave out.
    let sum = 0, best = -1;
    for (let i = 0; i < s.watts.length; i++) {
      sum += s.watts[i] ?? 0;
      if (i >= 60) sum -= s.watts[i - 60] ?? 0;
      if (i >= 59 && sum > best) { best = sum; to = s.time[i]; }
    }
  }
  if (to == null) return undefined;
  return breathThresholds({ time: s.time, watts: s.watts, hr: s.heartrate, ve: s.ve, br: s.br, tv: s.tv, from: RAMP_WARMUP_SECONDS, to, ...ctx });
}

/** The 20-minute test's twenty minutes, at least nineteen of them ridden: the step named "Test". */
const TEST_STEP = /^test$/i;
const MIN_TEST_SECONDS = 19 * 60;

/**
 * The 20-minute test's results: FTP at 95% of the average power over the
 * twenty minutes, and threshold heart rate as the average over its last
 * fifteen minutes. Nothing when the twenty minutes weren't ridden.
 */
export function twentyMinResult(rec: Pick<Recording, 'samples'>, timeline: TimelineStep[]): TestResult {
  const step = timeline.find((s) => TEST_STEP.test(s.name));
  const inStep = step ? rec.samples.filter((s) => s.s === step.index) : [];
  if (!step || inStep.length < MIN_TEST_SECONDS) return { kind: '20min' };
  return twentyMinFrom(inStep.map((s) => s.w), inStep.map((s) => s.hr));
}

function twentyMinFrom(watts: Array<number | undefined>, hr: Array<number | undefined>): TestResult {
  const ws = watts.filter((w): w is number => w != null);
  const testWatts = ws.length >= MIN_TEST_SECONDS * 0.9 ? avg(ws) : undefined;
  const lastHr = hr.slice(-15 * 60).filter((h): h is number => h != null && h > 0);
  return {
    kind: '20min',
    testWatts: testWatts != null ? Math.round(testWatts) : undefined,
    ftpEstimate: testWatts != null ? Math.round(testWatts * 0.95) : undefined,
    lthrEstimate: lastHr.length >= 12 * 60 ? Math.round(avg(lastHr)!) : undefined,
  };
}

/**
 * A test ridden on something else (the Garmin), from Intervals.icu's
 * one-second streams: the Ramp Test's best minute (its peak power is close to
 * it on one-minute steps, so VO2max is estimated from that), or the
 * 20-minute test's best twenty minutes and the heart rate over their last fifteen.
 */
export function resultFromStreams(kind: 'ramp' | '20min', watts: number[] | undefined, heartrate: number[] | undefined, weightKg?: number, time?: number[], ctx?: RampContext): TestResult {
  if (!watts?.length) return { kind, fromStreams: true };
  // A file that is not one reading a second (Garmin's smart recording skips quiet seconds): lay it out second by second first.
  if (time && time.length === watts.length && !isOneHz(time)) {
    const laid = perSecond(time, watts, heartrate);
    watts = laid.watts; heartrate = laid.heartrate;
  }
  if (kind === 'ramp') {
    const best = bestAverage(watts, 60);
    if (best == null) return { kind, fromStreams: true };
    // Part A1: judged from the five-minute warm-up to the end of the best minute, with no breathing and no step size to go on.
    let judge: RampJudgement | undefined;
    if (ctx) {
      let sum = 0, top = -1, end = 0;
      for (let i = 0; i < watts.length; i++) { sum += watts[i] ?? 0; if (i >= 60) sum -= watts[i - 60] ?? 0; if (i >= 59 && sum > top) { top = sum; end = i + 1; } }
      const t = watts.map((_, i) => i);
      judge = judgeRamp({ time: t, watts, hr: heartrate, from: RAMP_WARMUP_SECONDS, to: end, peakWatts: best, ...ctx });
    }
    const bm = Math.round(best * 0.75);
    const fields = reconcileFtp(bm, undefined, judge, ctx?.cpFtp);
    const vo2 = vo2maxFromPeak(best, weightKg);
    return { kind, v: TEST_RESULT_VERSION, fromStreams: true, bestMinuteWatts: Math.round(best), ftpFromBestMinute: bm, ...fields, peakWatts: Math.round(best), ...vo2Fields(vo2, judge), ...(judge ? { judge } : {}) };
  }
  const N = 20 * 60;
  if (watts.length < N) return { kind, fromStreams: true };
  let sum = 0, best = -1, at = 0;
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i] ?? 0;
    if (i >= N) sum -= watts[i - N] ?? 0;
    if (i >= N - 1 && sum > best) { best = sum; at = i - N + 1; }
  }
  return { ...twentyMinFrom(watts.slice(at, at + N), (heartrate ?? []).slice(at, at + N)), fromStreams: true };
}

/** Whether a stream's timestamps are one a second with no gaps. */
function isOneHz(time: number[]): boolean {
  for (let i = 1; i < time.length; i++) if (time[i] - time[i - 1] !== 1) return false;
  return true;
}

/** A stream laid out one reading a second: a gap repeats the reading before it (a pause or a skipped quiet second), capped at ten minutes of gap. */
export function perSecond(time: number[], watts: number[], heartrate?: number[]): { watts: number[]; heartrate?: number[] } {
  const w: number[] = [], h: number[] = [];
  const gap = (i: number) => Math.max(1, Math.min(600, Math.round(time[i + 1] - time[i])));
  for (let i = 0; i < time.length; i++) {
    // A reading holds until the next one; the last holds as long as the one before it did.
    const span = i < time.length - 1 ? gap(i) : i > 0 ? gap(i - 1) : 1;
    for (let k = 0; k < span; k++) { w.push(watts[i] ?? 0); if (heartrate) h.push(heartrate[i] ?? 0); }
  }
  return { watts: w, heartrate: heartrate ? h : undefined };
}

/** The result in lines of plain text, for the activity's description in Intervals.icu. */
export function testLines(r: TestResult): string[] {
  const out: string[] = [];
  if (r.kind === 'ramp') {
    if (r.bestMinuteWatts != null) out.push(`Best minute: ${r.bestMinuteWatts} W`);
    if (r.ftpEstimate != null) out.push(`FTP estimate: ${r.ftpEstimate} W (${ftpBasisWords(r)})`);
    const range = r.vo2maxRange ? ` (likely ${r.vo2maxRange[0]} to ${r.vo2maxRange[1]})` : '';
    if (r.vo2maxMlKgMin != null) out.push(`VO2max estimate: ${r.vo2maxAtLeast ? 'at least ' : 'about '}${Math.round(r.vo2maxMlKgMin)} ml/kg/min${range}`); else if (r.vo2maxLmin != null) out.push(`VO2max estimate: ${r.vo2maxAtLeast ? 'at least ' : 'about '}${r.vo2maxLmin} litres a minute${range}`);
    if (r.hrAtFtp != null) out.push(`Heart rate when passing the new FTP: ${r.hrAtFtp} bpm`);
    const b = r.breath;
    const vt = (name: string, v?: import('../engine/breathThresholds').VtPoint) => v ? out.push(`${name}: ${v.watts} W${v.hr ? `, ${v.hr} bpm` : ''}, breathing ${Math.round(v.ve)} L/min${v.certainty === 'unsure' ? ' (less certain)' : ''}`) : undefined;
    vt('First breathing threshold (VT1, close to the first lactate threshold)', b?.vt1);
    vt('Second breathing threshold (VT2, close to the second lactate threshold)', b?.vt2);
    if (b?.peakVe != null && breathCoveredRamp(b)) out.push(`Peak breathing: ${b.peakVe} L/min${b.brCapped ? ', breathing rate at the strap’s ceiling of 60 a minute' : ''}`);
    if (b?.readBy === 'br' && (b.vt1 || b.vt2)) out.push('Breathing thresholds read from how fast you breathed (this strap records how much air you move only faintly)');
    if (b?.missing === 'strap-stopped' && b.breathEndAt != null && b.rampEndAt != null) out.push(`Breathing strap stopped sending readings at ${clockOf(b.breathEndAt)}, ${spanWords(b.rampEndAt - b.breathEndAt)} before the ramp ended`);
    if (r.lthrEstimate != null) out.push(`Threshold heart rate estimate: ${r.lthrEstimate} bpm (from the second breathing threshold)`);
    if (r.stepWatts) out.push(`Step size: ${r.stepWatts} W a minute${r.endedBy ? `, ended ${r.endedBy === 'auto' ? 'by itself when the power fell away' : 'by the rider'}` : ''}`);
  } else {
    if (r.testWatts != null) out.push(`Average power over the 20 minutes: ${r.testWatts} W`);
    if (r.ftpEstimate != null) out.push(`FTP estimate: ${r.ftpEstimate} W (95% of the 20 minutes)`);
    if (r.lthrEstimate != null) out.push(`Threshold heart rate estimate: ${r.lthrEstimate} bpm (the last 15 minutes)`);
  }
  return out;
}

/** What the FTP figure was built from, in words. */
export function ftpBasisWords(r: TestResult): string {
  const w = r.ftpWitnesses;
  if (!w || r.ftpDisagree || w.length === 1) return '75% of the best minute';
  const names = w.map((x) => (x.source === 'best-minute' ? '75% of the best minute' : x.source === 'vt2' ? 'the second breathing threshold' : 'recent riding'));
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}, weighed together`;
}

/** Whether the strap's readings covered the whole ramp, so its peak means something (Part A6). */
export function breathCoveredRamp(b: BreathTest): boolean {
  return b.missing !== 'strap-stopped' && b.missing !== 'patchy' && b.missing !== 'flat' && b.missing !== 'no-breathing';
}

/** Seconds as the ride clock shows them: 13:35, or 1:02:05. */
export function clockOf(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** A length of time in words: "2 min 35 s", "45 s". */
export function spanWords(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m} min${r ? ` ${r} s` : ''}` : `${r} s`;
}

/** Where a test's results are kept once its ride is in Intervals.icu: a setting per activity, so they outlast the recording (tidied after 30 days) and travel to the rider's other devices. */
export const testResultKey = (activityId: string): string => `testResult:${activityId}`;
