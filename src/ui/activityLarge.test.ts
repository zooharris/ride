import { describe, expect, it } from 'vitest';
import { channelsOf, partSummary } from './ActivityLarge';
import type { PanelDef, Sample } from './ActivityCharts';

const samples: Sample[] = Array.from({ length: 10 }, (_, i) => ({ t: i, d: 0, watts: 100 + i * 10, hr: i < 5 ? undefined : 120 + i, br: 20 }));
const panels: PanelDef[] = [{ key: 'watts', title: 'Power', unit: 'W', color: '', get: (p) => p.watts, explain: '' }, { key: 'hr', title: 'Heart rate', unit: 'bpm', color: '', get: (p) => p.hr, explain: '' }];

describe('an activity chart opened large (13 Nov 2026)', () => {
  it('offers the recording\'s own measures, and breathing rate when there is one', () => {
    expect(channelsOf(panels, samples).map((c) => c.key)).toEqual(['watts', 'hr', 'br']);
    expect(channelsOf(panels, samples.map((s) => ({ ...s, br: undefined }))).map((c) => c.key)).toEqual(['watts', 'hr']);
  });
  it('low, high and average over the part shown, by hand', () => {
    expect(partSummary(samples, (p) => p.watts, 2, 5)).toEqual({ low: 120, high: 150, avg: 135, n: 4 });
    expect(partSummary(samples, (p) => p.hr, 0, 9)).toEqual({ low: 125, high: 129, avg: 127, n: 5 });
    expect(partSummary(samples, (p) => p.hr, 0, 3)).toBeUndefined();
  });
});
