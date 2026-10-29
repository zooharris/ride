/**
 * Fitness tests in the ride player: the rules that run during a test, and (Part C)
 * the arithmetic that turns its recording into results. Pure, so it is tested.
 */
import type { Recording, Sample } from './types';
import type { TimelineStep } from './timeline';

/** Below this share of the step's target, held for ten seconds, the ramp has given out. */
export const RAMP_GIVE_OUT = 0.85;

/**
 * Whether the Ramp Test should end by itself now: from the second ramp step on,
 * at least five seconds into the step, the last ten seconds' average power under
 * 85% of the step's target. A cadence collapse in ERG shows here too (the
 * trainer eases off and the power falls). Ten seconds with fewer than eight
 * power readings (a sensor dropping out) decide nothing.
 */
export function rampGaveOut(last10: Array<number | undefined>, target: number, secondsIntoStep: number, rampStep: number): boolean {
  if (rampStep < 2 || secondsIntoStep < 5 || target <= 0) return false;
  const ws = last10.slice(-10).filter((w): w is number => w != null);
  if (ws.length < 8) return false;
  return ws.reduce((a, b) => a + b, 0) / ws.length < RAMP_GIVE_OUT * target;
}

// ── Results (Part C) ───────────────────────────────────────────────────────


/**
 * What a test found. Kept on the recording (and so general that later steps add
 * breathing thresholds to it). Numbers are rounded for showing; the action
 * fields say what the rider did with each suggestion.
 */
export interface TestResult {
  kind: 'ramp' | '20min';
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

/** Hawley and Noakes (1992): VO2max in litres a minute from peak power on an incremental test. */
export function vo2maxFromPeak(peakWatts: number, weightKg?: number): { lmin: number; mlKgMin?: number } {
  const lmin = 0.01141 * peakWatts + 0.435;
  return { lmin: Math.round(lmin * 100) / 100, mlKgMin: weightKg && weightKg > 0 ? Math.round((lmin * 1000 / weightKg) * 10) / 10 : undefined };
}

const avg = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const targetOf = (samples: Sample[], index: number): number | undefined => samples.find((s) => s.s === index && s.tgt != null)?.tgt;

/**
 * The Ramp Test's results from the player's recording and the ride's timeline
 * (as ended): best minute up to the end of the ramp, FTP at 75% of it, peak
 * power (last full step plus the share of the unfinished one, from the targets
 * the trainer held), VO2max from peak power, and heart rate at the new FTP.
 */
export function rampResult(rec: Pick<Recording, 'samples' | 'rampStep' | 'rampEndAt' | 'events'>, timeline: TimelineStep[], weightKg?: number): TestResult {
  const endP = rec.rampEndAt ?? Infinity;
  const ridden = rec.samples.filter((s) => (s.p ?? 0) < endP);
  const best = bestAverage(ridden.map((s) => s.w), 60);
  const ftp = best != null ? Math.round(best * 0.75) : undefined;
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
  const vo2 = peak != null ? vo2maxFromPeak(peak, weightKg) : undefined;
  let hrAtFtp: number | undefined;
  if (ftp != null) {
    const passed = ramp.find((s) => (targetOf(rec.samples, s.index) ?? 0) >= ftp);
    const hrs = passed ? rec.samples.filter((s) => s.s === passed.index && s.hr != null && s.hr > 0).map((s) => s.hr!) : [];
    if (hrs.length >= 30) hrAtFtp = Math.round(avg(hrs)!);
  }
  const ev = rec.events.find((e) => e.type === 'test');
  return {
    kind: 'ramp', stepWatts: rec.rampStep,
    bestMinuteWatts: best != null ? Math.round(best) : undefined, ftpEstimate: ftp,
    peakWatts: peak != null ? Math.round(peak * 10) / 10 : undefined, vo2maxLmin: vo2?.lmin, vo2maxMlKgMin: vo2?.mlKgMin, hrAtFtp,
    endedBy: ev?.value === 'auto' ? 'auto' : ev ? 'rider' : undefined, endedAt: ev?.t,
  };
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
export function resultFromStreams(kind: 'ramp' | '20min', watts: number[] | undefined, heartrate: number[] | undefined, weightKg?: number): TestResult {
  if (!watts?.length) return { kind, fromStreams: true };
  if (kind === 'ramp') {
    const best = bestAverage(watts, 60);
    if (best == null) return { kind, fromStreams: true };
    const vo2 = vo2maxFromPeak(best, weightKg);
    return { kind, fromStreams: true, bestMinuteWatts: Math.round(best), ftpEstimate: Math.round(best * 0.75), peakWatts: Math.round(best), vo2maxLmin: vo2.lmin, vo2maxMlKgMin: vo2.mlKgMin };
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

/** The result in lines of plain text, for the activity's description in Intervals.icu. */
export function testLines(r: TestResult): string[] {
  const out: string[] = [];
  if (r.kind === 'ramp') {
    if (r.bestMinuteWatts != null) out.push(`Best minute: ${r.bestMinuteWatts} W`);
    if (r.ftpEstimate != null) out.push(`FTP estimate: ${r.ftpEstimate} W (75% of the best minute)`);
    if (r.vo2maxMlKgMin != null) out.push(`VO2max estimate: ${r.vo2maxMlKgMin} ml/kg/min`); else if (r.vo2maxLmin != null) out.push(`VO2max estimate: ${r.vo2maxLmin} litres a minute`);
    if (r.hrAtFtp != null) out.push(`Heart rate when passing the new FTP: ${r.hrAtFtp} bpm`);
    if (r.stepWatts) out.push(`Step size: ${r.stepWatts} W a minute${r.endedBy ? `, ended ${r.endedBy === 'auto' ? 'by itself when the power fell away' : 'by the rider'}` : ''}`);
  } else {
    if (r.testWatts != null) out.push(`Average power over the 20 minutes: ${r.testWatts} W`);
    if (r.ftpEstimate != null) out.push(`FTP estimate: ${r.ftpEstimate} W (95% of the 20 minutes)`);
    if (r.lthrEstimate != null) out.push(`Threshold heart rate estimate: ${r.lthrEstimate} bpm (the last 15 minutes)`);
  }
  return out;
}

/** Where a test's results are kept once its ride is in Intervals.icu: a setting per activity, so they outlast the recording (tidied after 30 days) and travel to the rider's other devices. */
export const testResultKey = (activityId: string): string => `testResult:${activityId}`;
