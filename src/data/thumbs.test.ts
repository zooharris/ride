import { describe, expect, it } from 'vitest';
import { buildThumb } from './thumbs';

describe('activity pictures', () => {
  it('keeps the route, simplified, and the power through the ride', () => {
    const n = 3600;
    const lat = Array.from({ length: n }, (_, i) => 38.97 + Math.sin(i / 300) * 0.02);
    const lng = Array.from({ length: n }, (_, i) => -77.38 + i * 0.00005);
    const watts = Array.from({ length: n }, (_, i) => (i > 1200 && i < 1800 ? 260 : 150));
    const t = buildThumb('a1', { time: lat.map((_, i) => i), lat, lng, watts });
    expect(t.route!.length).toBeGreaterThan(5);
    expect(t.route!.length).toBeLessThanOrEqual(220);
    expect(t.route![0]).toEqual([38.97, -77.38]);
    expect(t.profile!.basis).toBe('power');
    expect(t.profile!.values).toHaveLength(60);
    expect(Math.max(...t.profile!.values)).toBe(260);
  });
  it('a trainer ride with a fixed GPS position has no route, and falls back to heart rate without power', () => {
    const n = 1200;
    const t = buildThumb('a2', { time: Array.from({ length: n }, (_, i) => i), lat: Array(n).fill(38.9), lng: Array(n).fill(-77.4), watts: Array(n).fill(0), heartrate: Array(n).fill(128) });
    expect(t.route).toBeUndefined();
    expect(t.profile).toEqual({ basis: 'hr', values: Array(60).fill(128) });
  });
  it('drops missing and zero positions', () => {
    const t = buildThumb('a3', { time: [0, 1, 2, 3], lat: [0, 38.9, 38.95, 39.0], lng: [0, -77.4, -77.35, -77.3] });
    expect(t.route!.every(([a]) => a !== 0)).toBe(true);
    expect(t.profile).toBeUndefined();
  });
});
