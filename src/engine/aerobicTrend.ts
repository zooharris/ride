import { addDays } from './load';

/**
 * Step 2b, Part B (30 Oct 2026): power at a steady heart rate, week by week, over
 * the last 12 weeks. A week counts only with two or more rides each with 15+
 * steady minutes (records without `steadyAtHr` have fewer); its value is the
 * median of its rides, re-scaled by threshold heart rate when the ride was read
 * against now. Dropped: the median of the last three counted weeks is 5% or more
 * below the median of the three counted weeks ending six weeks earlier; both
 * groups must exist (two weeks at least). Pure. Not charted, not shown.
 */
export interface SteadyRecord { date: string; steadyAtHr?: { watts: number; seconds: number }; lthrAtBuild?: number }
export interface AerobicTrend { dropped: boolean; weeks: Array<{ start: string; watts: number; rides: number }>; recent?: number; earlier?: number }

export const TREND_WEEKS = 12;
export const DROP = 0.05;

const monday = (d: string) => addDays(d, -((new Date(d + 'T00:00:00').getDay() + 6) % 7));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function aerobicTrend(records: SteadyRecord[], lthrNow: number, today: string): AerobicTrend {
  const from = addDays(today, -TREND_WEEKS * 7);
  const byWeek = new Map<string, number[]>();
  for (const r of records) {
    if (!r.steadyAtHr || r.date < from || r.date > today) continue;
    const scale = r.lthrAtBuild && lthrNow > 0 ? lthrNow / r.lthrAtBuild : 1;
    const ws = monday(r.date);
    byWeek.set(ws, [...(byWeek.get(ws) ?? []), r.steadyAtHr.watts * scale]);
  }
  const weeks = [...byWeek.entries()].filter(([, w]) => w.length >= 2).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([start, w]) => ({ start, watts: Math.round(median(w)), rides: w.length }));
  if (weeks.length < 4) return { dropped: false, weeks };
  const recentWeeks = weeks.slice(-3);
  const edge = addDays(recentWeeks[recentWeeks.length - 1].start, -42);
  const earlierWeeks = weeks.filter((w) => w.start <= edge).slice(-3);
  if (recentWeeks.length < 2 || earlierWeeks.length < 2) return { dropped: false, weeks };
  const recent = median(recentWeeks.map((w) => w.watts)), earlier = median(earlierWeeks.map((w) => w.watts));
  return { dropped: recent <= earlier * (1 - DROP), weeks, recent: Math.round(recent), earlier: Math.round(earlier) };
}
