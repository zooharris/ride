import type { Phase, PlannedWorkout } from '../engine/types';
import { addDays } from '../engine/load';
import { newId } from '../engine/workout';

/**
 * Plan templates: a week-by-week structure that the app lays onto the calendar
 * from a start date. Phase 3 replaces these with a generator; until then a
 * well-built template is what a coach would hand you anyway.
 */
export interface TemplateWeek {
  phase: Phase | 'recovery' | 'test';
  label: string;
  quality?: string;   // library workout id for the quality day
  long?: string;      // library workout id for the long day
  note?: string;
}

export interface PlanTemplate {
  id: string;
  name: string;
  summary: string;
  description: string;
  weeks: TemplateWeek[];
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'winter-block-12',
    name: 'Winter Block, 12 weeks',
    summary: 'Two rides a week: a quality ride and a long ride. Base, recovery, build, recovery, sharpen, retest.',
    description: 'A base-to-sharpen block for a masters rider training on weekends with strength during the week. Sweet spot grows through three base weeks, a recovery week, then two sweet-spot and three threshold weeks of build, another recovery week, two weeks of VO2max to sharpen, and a 20-minute FTP retest on the final Saturday. Long rides climb from two hours to three and a quarter. Every quality ride opens with a 25-minute warm-up and two pickups, and finishes in zone 2.',
    weeks: [
      { phase: 'base', label: 'Base 1', quality: 'trail-ss-3x10', long: 'trail-long-120' },
      { phase: 'base', label: 'Base 2', quality: 'trail-ss-3x12', long: 'trail-long-135' },
      { phase: 'base', label: 'Base 3', quality: 'trail-ss-3x15', long: 'trail-long-150' },
      { phase: 'recovery', label: 'Recovery', quality: 'trail-long-90', long: 'trail-long-90', note: 'No intervals. Lighter strength.' },
      { phase: 'build', label: 'Build 1', quality: 'trail-ss-2x20', long: 'trail-long-165' },
      { phase: 'build', label: 'Build 2', quality: 'trail-ss-2x20', long: 'trail-long-150' },
      { phase: 'build', label: 'Build 3', quality: 'trail-thr-3x8', long: 'trail-long-180' },
      { phase: 'build', label: 'Build 4', quality: 'trail-thr-4x8', long: 'trail-long-180' },
      { phase: 'build', label: 'Build 5', quality: 'trail-thr-3x10', long: 'trail-long-195' },
      { phase: 'recovery', label: 'Recovery', quality: 'trail-long-90', long: 'trail-long-90', note: 'No intervals. Light strength.' },
      { phase: 'peak', label: 'Sharpen 1', quality: 'trail-vo2-4x4', long: 'trail-long-180' },
      { phase: 'peak', label: 'Sharpen 2', quality: 'trail-vo2-5x4', long: 'trail-long-195' },
      { phase: 'test', label: 'Retest', quality: 'trail-20min-test', note: 'FTP retest, then update your numbers in Settings.' },
    ],
  },
];

export function templateById(id: string): PlanTemplate | undefined {
  return PLAN_TEMPLATES.find((t) => t.id === id);
}

/**
 * Lay a template onto dates. `start` is the first quality day. The long ride
 * lands `longOffset` days after each quality day (1 = the next day). Dates
 * before `notBefore` are skipped so a block already under way picks up mid-stream.
 */
export function layOutPlan(t: PlanTemplate, start: string, longOffset: number, basis: 'power' | 'hr', notBefore: string): PlannedWorkout[] {
  const out: PlannedWorkout[] = [];
  t.weeks.forEach((w, i) => {
    const q = addDays(start, i * 7);
    const l = addDays(q, longOffset);
    if (w.quality && q >= notBefore) out.push({ id: newId(), date: q, workoutId: w.quality, basis, status: 'planned', note: w.label });
    if (w.long && l >= notBefore) out.push({ id: newId(), date: l, workoutId: w.long, basis, status: 'planned', note: w.label });
  });
  return out;
}
