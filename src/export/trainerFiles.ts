/**
 * A ride for trainer apps (12 Nov 2026, export at any time): Zwift's .zwo, and the older .mrc (shares of FTP) and
 * .erg (watts). All three carry power only. Repeats are written out step by step, which every app reads the same
 * way. A range target is written at its middle, since these files hold one number per step; "up to" steps at the
 * effort expected of them. The step's name and cues go in as text, where the format has a place for it.
 */
import type { Workout, WorkoutStep } from '../engine/types';
import { flattenSteps, stepIntensity } from '../engine/workout';
import { isOpenEffort } from './workoutText';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** The power a single-number file holds for a step: a range's middle; for "up to", the effort expected. */
export const heldPower = (s: WorkoutStep): number => (s.noFloor ? s.intensity : stepIntensity(s));

/** Text lines for a step, at seconds into the step: its cues, else its name at the start. */
function stepTexts(s: WorkoutStep): Array<{ at: number; text: string }> {
  const cues = (s.cues ?? []).filter((c) => c.rep == null || c.rep === 1).map((c) => ({ at: c.at < 0 ? Math.max(0, s.seconds + c.at) : Math.min(c.at, Math.max(0, s.seconds - 1)), text: c.text }));
  if (!cues.some((c) => c.at === 0) && s.label) cues.unshift({ at: 0, text: s.label });
  return cues.sort((a, b) => a.at - b.at);
}

/** Zwift's workout file. A test's free effort is a free ride, so Zwift lets the rider set it. */
export function encodeZwo(w: Workout): string {
  const lines = (s: WorkoutStep) => stepTexts(s).map((t) => `      <textevent timeoffset="${Math.round(t.at)}" message="${xml(t.text)}"/>`);
  const steps = flattenSteps(w.blocks).map((s) => {
    const cad = s.cadence ? ` Cadence="${s.cadence}"` : '';
    const inner = lines(s);
    const open = isOpenEffort(w, s) ? `<FreeRide Duration="${s.seconds}"${cad}` : `<SteadyState Duration="${s.seconds}" Power="${r3(heldPower(s))}"${cad}`;
    const close = isOpenEffort(w, s) ? '</FreeRide>' : '</SteadyState>';
    return inner.length ? `    ${open}>\n${inner.join('\n')}\n    ${close}` : `    ${open}/>`;
  });
  const desc = [w.subtitle, w.purpose].filter(Boolean).join('. ');
  return [
    '<workout_file>',
    '  <author>Antogo</author>',
    `  <name>${xml(w.name)}</name>`,
    `  <description>${xml(desc)}</description>`,
    '  <sportType>bike</sportType>',
    '  <tags/>',
    '  <workout>',
    ...steps,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

/** Minutes to two places, as these files write them. */
const mins = (sec: number) => (sec / 60).toFixed(2);

/**
 * The .mrc (shares of FTP) or .erg (watts at `ftp`) file: each step a flat line from its start to its end, then the
 * step names and cues as course text. A free test effort can't be written here (they need a number every step).
 */
export function encodeMrcErg(w: Workout, kind: 'mrc' | 'erg', ftp: number): string {
  const rows: string[] = [];
  const text: string[] = [];
  let t = 0;
  for (const s of flattenSteps(w.blocks)) {
    const v = kind === 'mrc' ? Math.round(heldPower(s) * 100) : Math.round(heldPower(s) * ftp);
    rows.push(`${mins(t)}\t${v}`, `${mins(t + s.seconds)}\t${v}`);
    for (const x of stepTexts(s)) text.push(`${Math.round(t + x.at)}\t${x.text.replace(/\s+/g, ' ')}\t10`);
    t += s.seconds;
  }
  const head = [
    '[COURSE HEADER]',
    'VERSION = 2',
    'UNITS = ENGLISH',
    `DESCRIPTION = ${[w.subtitle, w.purpose].filter(Boolean).join('. ').replace(/\s+/g, ' ')}`,
    `FILE NAME = ${w.name}`,
    ...(kind === 'erg' ? [`FTP = ${Math.round(ftp)}`] : []),
    kind === 'mrc' ? 'MINUTES PERCENT' : 'MINUTES WATTS',
    '[END COURSE HEADER]',
  ];
  return [...head, '[COURSE DATA]', ...rows, '[END COURSE DATA]', ...(text.length ? ['[COURSE TEXT]', ...text, '[END COURSE TEXT]'] : []), ''].join('\r\n');
}
