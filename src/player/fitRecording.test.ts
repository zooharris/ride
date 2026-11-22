import { describe, expect, it } from 'vitest';
import { encodeFitActivity, type ActivityStreams } from '../export/activityFiles';
import { readFitRecording } from './fitRecording';
import type { Ride } from '../engine/types';

const ride = { id: 'a1', date: '2026-11-08', startTime: '2026-11-08T09:00:00', name: 'Morning ride', type: 'Ride', sport: 'ride', seconds: 600, movingSeconds: 600, elapsedSeconds: 600, distanceM: 5000 } as Ride;
const n = 600;
const t = Array.from({ length: n }, (_, i) => i);
const streams: ActivityStreams = {
  time: t, watts: t.map((i) => 150 + (i % 60)), heartrate: t.map((i) => 120 + Math.floor(i / 20)), cadence: t.map(() => 88),
  distance: t.map((i) => i * 8.3), altitude: t.map((i) => 100 + Math.sin(i / 50) * 10), velocity: t.map(() => 8.3), temp: t.map(() => -2),
  lat: t.map((i) => 38.9 + i * 0.0001), lng: t.map((i) => -77.3 - i * 0.0001),
};

describe('a recording read from its original FIT file (Stage 0)', () => {
  it('gives back time, power, heart rate, cadence, distance, speed, altitude, temperature and position', () => {
    const s = readFitRecording(encodeFitActivity(ride, streams), 'a1')!;
    expect(s.id).toBe('a1');
    expect(s.time).toHaveLength(600);
    expect(s.time[0]).toBe(0);
    expect(s.watts![300]).toBe(streams.watts![300]);
    expect(s.heartrate![300]).toBe(streams.heartrate![300]);
    expect(s.cadence![10]).toBe(88);
    expect(s.distance![300]).toBeCloseTo(streams.distance![300], 0);
    expect(s.velocity![300]).toBeCloseTo(8.3, 2);
    expect(s.altitude![300]).toBeCloseTo(streams.altitude![300], 0);
    expect(s.temp![300]).toBe(-2);
    expect(s.lat![300]).toBeCloseTo(streams.lat![300], 5);
    expect(s.lng![300]).toBeCloseTo(streams.lng![300], 5);
  });
  it('nothing from a file that is not a recording', () => {
    expect(readFitRecording(new Uint8Array(5))).toBeUndefined();
    expect(readFitRecording(new Uint8Array(200))).toBeUndefined();
  });
});
