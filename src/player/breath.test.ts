import { afterEach, describe, expect, it, vi } from 'vitest';
import { breathTimestamp, packetLine, parseBreathPacket } from './ble/breath';
import { BREATH_STALE_MS, breathQuiet, pickSources, type SensorSnapshot } from './sources';
import { slotView, SLOTS, reportsOf } from './devices';
import { RideEngine } from './engine';
import { encodeFit, TYME_FIELDS } from './fit';
import { readFitBreathing, breathStreams } from './fitRead';
import { breathFromRecording, fillBreathing, hasBreathing } from './breathRead';
import { SimRider, steadyVe } from './sim';
import { breathShown } from './smooth';
import { totals } from './summary';
import { fetchStreams } from '../sync/intervals';
import { trailingMean } from '../ui/ActivityCharts';
import type { Recording, Sample } from './types';

/** A 0x01 breath packet: timestamp in 40 ms ticks, inhale and exhale in 10 ms, breath size raw (0.01 L). */
function breath(ts: number, inhale: number, exhale: number, raw: number): Uint8Array {
  const b = new Uint8Array(17);
  const v = new DataView(b.buffer);
  b[0] = 0x01;
  v.setUint32(1, ts, true);
  v.setUint16(5, inhale, true);
  v.setUint16(7, exhale, true);
  v.setUint16(9, raw, true);
  v.setUint16(11, raw, true);
  return b;
}

describe('1A: the strap\'s packets', () => {
  it('a first packet: the rate from its own inhale and exhale', () => {
    const b = parseBreathPacket(breath(1000, 120, 180, 180))!;   // 3.0 s a breath: 20 a minute; 1.8 L
    expect(b.rate).toBeCloseTo(20, 5);
    expect(b.size).toBeCloseTo(1.8, 5);
    expect(b.ventilation).toBeCloseTo(36, 5);
    expect(b.ieRatio).toBeCloseTo(120 / 180, 5);
  });
  it('two in a row: the rate from the time between them', () => {
    const b = parseBreathPacket(breath(1075, 120, 180, 200), 1000)!;   // 75 ticks = 3.0 s
    expect(b.rate).toBeCloseTo(20, 5);
    expect(b.ventilation).toBeCloseTo(40, 5);
  });
  it('a dropped packet (the gap gives under 4 a minute): back to its own times', () => {
    const b = parseBreathPacket(breath(1000 + 400, 100, 150, 150), 1000)!;   // 16 s apart: 3.75 a minute
    expect(b.rate).toBeCloseTo(24, 5);
  });
  it('accelerometer (0x02) and raw peaks (0x06) are ignored; a short packet too', () => {
    const acc = new Uint8Array(13); acc[0] = 0x02;
    const peaks = new Uint8Array(17); peaks[0] = 0x06;
    expect(parseBreathPacket(acc)).toBeNull();
    expect(parseBreathPacket(peaks)).toBeNull();
    expect(parseBreathPacket(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(breathTimestamp(peaks)).toBeUndefined();
  });
  it('noise is rejected: over 80 a minute, or over 300 L/min', () => {
    expect(parseBreathPacket(breath(1010, 20, 20, 100), 1000)).toBeNull();   // 0.4 s apart: 150 a minute
    expect(parseBreathPacket(breath(1050, 80, 120, 2000), 1000)).toBeNull();   // 30 a minute × 20 L
    expect(breathTimestamp(breath(1010, 20, 20, 100))).toBe(1010);   // the clock still moves on
  });
  it('the clock wrapping past 2^32 still gives the right gap', () => {
    expect(parseBreathPacket(breath(10, 120, 180, 180), 0xffffffff - 64)!.rate).toBeCloseTo(20, 5);
  });
  it('Copy details shows each packet\'s length, first byte and bytes', () => {
    expect(packetLine(new Uint8Array([2, 0xab, 0]))).toBe('3 bytes, type 0x02: 02 ab 00');
  });
});

const strap = (at: number, extra: Partial<SensorSnapshot> = {}): SensorSnapshot => ({ id: 's', kind: 'breath', name: 'VitalPro 1234', status: 'connected', reading: { ve: 30, br: 20, tv: 1.5, at }, ...extra });

describe('1A: the hub\'s rules for breathing', () => {
  it('a breath stays live for 15 seconds (one every 2-4 s), heart rate only 3', () => {
    const hr: SensorSnapshot = { id: 'h', kind: 'hr', name: 'HRM', status: 'connected', reading: { bpm: 120, at: 0 } };
    const src = pickSources([strap(0), hr], 10_000);
    expect(src.ve?.value).toBe(30);
    expect(src.br?.value).toBe(20);
    expect(src.bpm).toBeUndefined();
    expect(pickSources([strap(0)], BREATH_STALE_MS + 1).ve).toBeUndefined();
  });
  it('"None for this ride" in the breathing box turns off all of its numbers', () => {
    const src = pickSources([strap(0)], 1000, { ve: 'none' });
    expect(src.ve).toBeUndefined();
    expect(src.br).toBeUndefined();
    expect(src.tv).toBeUndefined();
  });
  it('quiet: connected 30 seconds with no breath', () => {
    expect(breathQuiet({ ...strap(0), reading: undefined, connectedAt: 0 }, 29_000)).toBe(false);
    expect(breathQuiet({ ...strap(0), reading: undefined, connectedAt: 0 }, 30_000)).toBe(true);
    expect(breathQuiet({ ...strap(5_000), connectedAt: 0 }, 30_000)).toBe(false);
    expect(breathQuiet({ ...strap(5_000), connectedAt: 0 }, 35_000)).toBe(true);
    expect(breathQuiet({ ...strap(0), kind: 'hr' }, 99_000)).toBe(false);
  });
  it('a sixth box, Breathing strap, connected between breaths and while silent', () => {
    expect(SLOTS).toEqual(['trainer', 'watts', 'bpm', 'cadence', 'speedKmh', 've']);
    expect(reportsOf({ kind: 'breath' })).toContain('ve');
    const silent = { ...strap(0), reading: undefined };
    expect(slotView('ve', [silent], [], {}, {}).state).toBe('connected');
    expect(slotView('ve', [], [], {}, {}).state).toBe('empty');
    expect(slotView('ve', [silent], [], {}, { ve: 'none' }).state).toBe('off');
  });
});

describe('1C: samples and the tile', () => {
  it('each second keeps the last breath; a ride without a strap has none', () => {
    const e = new RideEngine({ timeline: [], ftp: 240, basis: 'power', mode: 'erg', autoPause: false, guard: false }, 0);
    for (let s = 1; s <= 12; s++) e.tick(s * 1000, { watts: 150, cadence: 90, ...(s > 5 ? { ve: 31.24, br: 20.04, tv: 1.567, ie: 0.8 } : {}) });
    const withBreath = e.samples.filter((x) => x.ve != null);
    expect(withBreath.length).toBeGreaterThan(3);
    expect(withBreath[0]).toMatchObject({ ve: 31.2, br: 20, tv: 1.57, ie: 0.8 });
    expect(e.samples.some((x) => x.ve == null)).toBe(true);
  });
  it('the tile: ventilation over the last 30 seconds, rate and size over the last 10', () => {
    const xs = [...Array.from({ length: 20 }, () => ({ ve: 20, br: 15, tv: 1.3 })), ...Array.from({ length: 10 }, () => ({ ve: 50, br: 30, tv: 1.7 }))];
    const s = breathShown(xs);
    expect(s.ve).toBeCloseTo(30, 5);
    expect(s.br).toBeCloseTo(30, 5);
    expect(s.tv).toBeCloseTo(1.7, 5);
  });
  it('the simulated strap: ventilation follows power with a lag, at plausible numbers', () => {
    const r = new SimRider({ ftp: 220, lthr: 160, restingHr: 55, maxHr: 180 });
    r.target = 150;
    let last = r.tick(1);
    for (let i = 0; i < 240; i++) last = r.tick(1);
    expect(last.ve).toBeGreaterThan(steadyVe(150) * 0.85);
    expect(last.ve).toBeLessThan(steadyVe(150) * 1.15);
    expect(last.br).toBeGreaterThanOrEqual(13);
    expect(last.br).toBeLessThanOrEqual(46);
    expect(last.tv).toBeCloseTo(last.ve / last.br, 1);
    r.target = 300;
    const soon = r.tick(1);
    expect(soon.ve).toBeLessThan(steadyVe(300) * 0.8);   // the lag
  });
});

/** A recording of `n` seconds, breathing from second `from` on. */
function rec(n: number, from = 0): Recording {
  const samples: Sample[] = Array.from({ length: n }, (_, t) => ({ t, w: 150, hr: 120, cad: 90, spd: 28, d: t * 8, ...(t >= from ? { ve: 30 + t / 10, br: 20, tv: 1.5, ie: 0.8 } : {}) }));
  return { id: 'r1', status: 'finished', startedAt: '2026-10-30T10:00:00', startMs: Date.UTC(2026, 9, 30, 10), date: '2026-10-30', name: 'Free ride', basis: 'power', ftp: 220, lthr: 160, samples, laps: [{ start: 0, end: n }], events: [{ t: 0, type: 'start' }], timerSeconds: n, distanceM: n * 8, savedMs: 0, breathing: true, breathSensor: 'VitalPro' };
}

describe('1D: breathing in the ride file, and read back', () => {
  it('encoded in Tymewear\'s layout and decoded again: names, values, definitions before records', () => {
    const r = rec(120, 10);
    const file = encodeFit(r, totals(r.samples, r.ftp, r.lthr, undefined, r.basis));
    const fb = readFitBreathing(file);
    expect(fb.fields).toEqual(TYME_FIELDS.map((f) => f.name));
    expect(fb.records).toHaveLength(110);
    expect(fb.records[0].ve).toBeCloseTo(31, 3);
    expect(fb.records[0]).toMatchObject({ br: 20, ie: expect.closeTo(0.8, 3) });
    expect(fb.records[0].tv).toBeCloseTo(1.5, 3);
    // The developer's id comes before the field descriptions, and both before the first record definition.
    const ascii = Array.from(file, (b) => String.fromCharCode(b)).join('');
    expect(ascii.indexOf('tyme_breath_rate')).toBeGreaterThan(0);
    const firstRecordDef = (() => { for (let i = 14; i < file.length - 5; i++) if ((file[i] & 0xe0) === 0x60 && file[i + 3] === 20 && file[i + 4] === 0) return i; return -1; })();
    expect(firstRecordDef).toBeGreaterThan(ascii.indexOf('tyme_inhale_exhale_ratio'));
    // Laid against the activity's time: the first ten seconds have none.
    const s = breathStreams(fb, Array.from({ length: 120 }, (_, t) => t))!;
    expect(Number.isNaN(s.ve[5])).toBe(true);
    expect(s.ve[10]).toBeCloseTo(31, 2);
  });
  it('a ride without breathing has no developer fields', () => {
    const r = { ...rec(60, 999), breathing: undefined };
    const file = encodeFit(r, totals(r.samples, r.ftp, r.lthr, undefined, r.basis));
    expect(readFitBreathing(file)).toMatchObject({ records: [], fields: [] });
  });
});

describe('1D: read-back from Intervals.icu', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('fetchStreams asks for the custom streams by name and picks them up', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const body = url.includes('/streams') ? [{ type: 'time', data: [0, 1, 2] }, { type: 'tyme_minute_volume', data: [30, 31, 32] }, { type: 'tyme_breath_rate', data: [20, 20, 21] }, { type: 'tyme_tidal_volume', data: [1.5, 1.55, 1.52] }] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const st = await fetchStreams({ athleteId: 'i1', apiKey: 'k' }, 'a1', { breathing: true });
    expect(urls[0]).toContain('tyme_minute_volume');
    expect(st.ve).toEqual([30, 31, 32]);
    expect(st.br).toEqual([20, 20, 21]);
    const plain = await fetchStreams({ athleteId: 'i1', apiKey: 'k' }, 'a1');
    expect(urls[2]).not.toContain('tyme');
    expect(plain.ve).toBeUndefined();
  });
  it('without the streams: the original file is read; a recording on this computer goes first', async () => {
    const r = rec(90, 0);
    const file = encodeFit(r, totals(r.samples, r.ftp, r.lthr, undefined, r.basis));
    const set = { id: 'a1', time: Array.from({ length: 90 }, (_, t) => t) };
    let fetched = 0;
    const fromFile = await fillBreathing(set, undefined, async () => { fetched++; return file; });
    expect(fetched).toBe(1);
    expect(hasBreathing(fromFile)).toBe(true);
    expect(fromFile.ve![20]).toBeCloseTo(32, 2);
    const fromLocal = await fillBreathing(set, r, async () => { fetched++; return file; });
    expect(fetched).toBe(1);
    expect(fromLocal.ve![20]).toBeCloseTo(32, 5);
    expect(breathFromRecording({ ...r, samples: r.samples.map(({ ve, ...x }) => x) }, set.time)).toBeUndefined();
    // A file with no breathing leaves the set as it was.
    const none = await fillBreathing(set, undefined, async () => encodeFit({ ...r, samples: r.samples.map(({ ve, ...x }) => x) }, totals(r.samples, r.ftp, r.lthr, undefined, r.basis)));
    expect(none.ve).toBeUndefined();
  });
});

describe('1E: the Breathing chart\'s 30-second average', () => {
  it('a trailing mean that steps over gaps', () => {
    const t = Array.from({ length: 40 }, (_, i) => i);
    const v = t.map((i) => (i < 30 ? 30 : i === 35 ? NaN : 60));
    const m = trailingMean(t, v, 30);
    expect(m[29]).toBe(30);
    expect(m[39]).toBeCloseTo((20 * 30 + 9 * 60) / 29, 5);
  });
});
