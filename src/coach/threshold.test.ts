import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '../engine/types';
import { readThreshold, thresholdPrompt, type FtpAdvice, type ZoneAdvice } from './claude';
import { db, saveProfile } from '../data/db';
import { applyZones } from '../ui/testService';
import { numbersToPush } from '../sync/intervals';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
const profile: Profile = { name: 'zooharris', ftp: 225, lthr: 160, maxHr: 180, restingHr: 55, weightKg: 80, basis: 'power', masters: true, units: 'imperial', rideDays: [], hoursPerWeek: 8 };
const reply = (o: unknown, stop = 'end_turn') => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: stop });

describe('what the coach is asked (B2)', () => {
  const ev = ['FTP setting now: 225 W', 'Best power in the window: 20 minutes 245 W', 'Tests in the last 12 weeks: none.'];
  it('the FTP question carries every evidence line, the rider’s name as set, and the limits', () => {
    const t = thresholdPrompt(profile, '2026-10-29', ev, 'ftp');
    for (const l of ev) expect(t).toContain(l);
    expect(t).toContain('zooharris');
    expect(t).toContain('best 20-minute power × 0.97');
    expect(t).toContain('needsTest');
  });
  it('the zones question asks for both tables, a reason per moved boundary, and which to trust', () => {
    const t = thresholdPrompt(profile, '2026-10-29', ev, 'zones');
    expect(t).toContain('power zone table');
    expect(t).toContain('heart-rate zone table');
    expect(t).toContain('"trust"');
    expect(t).toContain('what would be enough evidence');
  });
});

describe('reading the coach’s answer (B2)', () => {
  it('a good FTP answer', () => {
    const a = readThreshold('ftp', reply({ ftp: 232, why: 'Your 20 and 60 minutes agree.', confidence: 'settled', needsTest: '' }), { best20: 245, best60: 228 }) as FtpAdvice;
    expect(a).toMatchObject({ ftp: 232, confidence: 'settled' });
    expect(a.failed).toBeUndefined();
    expect(a.needsTest).toBeUndefined();
  });
  it('an FTP above what the best 20 minutes allow is brought down; below the best hour, up', () => {
    expect((readThreshold('ftp', reply({ ftp: 260, why: 'x', confidence: 'mixed', needsTest: '' }), { best20: 245, best60: 228 }) as FtpAdvice).ftp).toBe(238);
    expect((readThreshold('ftp', reply({ ftp: 200, why: 'x', confidence: 'mixed', needsTest: '' }), { best20: 245, best60: 228 }) as FtpAdvice).ftp).toBe(228);
  });
  it('thin evidence: no number, the reason kept', () => {
    const a = readThreshold('ftp', reply({ ftp: 0, why: 'Only three rides with power.', confidence: 'thin', needsTest: 'A ramp test would give a number.' })) as FtpAdvice;
    expect(a.ftp).toBeUndefined();
    expect(a.why).toContain('three rides');
    expect(a.needsTest).toBeDefined();
  });
  it('a reply that isn’t JSON, or was cut off, says why', () => {
    expect(readThreshold('ftp', { content: [{ type: 'text', text: 'Sure! Your FTP is' }], stop_reason: 'end_turn' }).failed).toBeDefined();
    expect(readThreshold('zones', reply({}, 'max_tokens')).failed).toMatch(/cut off/);
  });
  it('zone tables must be six rising tops, heart rate under max; a bad table is dropped, not used', () => {
    const good = readThreshold('zones', reply({ powerTops: [124, 169, 203, 236, 270, 338], hrTops: [130, 142, 152, 160, 167, 172], why: ['Zone 2 top moved from 166 to 169 W.'], trust: 'They agree.', confidence: 'settled', needsTest: '' }), { maxHr: 180 }) as ZoneAdvice;
    expect(good.powerTops).toHaveLength(6);
    expect(good.hrTops).toHaveLength(6);
    const bad = readThreshold('zones', reply({ powerTops: [124, 120, 203, 236, 270, 338], hrTops: [130, 142, 152, 160, 167, 185], why: ['x'], trust: '', confidence: 'mixed', needsTest: '' }), { maxHr: 180 }) as ZoneAdvice;
    expect(bad.powerTops).toBeUndefined();
    expect(bad.hrTops).toBeUndefined();
    expect(bad.failed).toBeUndefined(); // the reasons still show
  });
});

describe('Apply these zones (B3)', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  it('saves both tables as watts and bpm, and Intervals.icu would be sent exactly those tops', async () => {
    await saveProfile(profile);
    const pt = [124, 169, 203, 236, 270, 338], ht = [130, 142, 152, 160, 167, 172];
    const r = await applyZones(pt, ht);
    expect(r.ok).toBe(true);
    const p = (await db.profile.get('me'))!;
    expect(p).toMatchObject({ powerZoneMode: 'abs', powerZoneWatts: pt, hrZoneMode: 'abs', hrZoneTops: ht });
    expect(numbersToPush(p).hrZoneTops).toEqual(ht);
  });
  it('only the table the coach gave is changed', async () => {
    await saveProfile(profile);
    await applyZones(undefined, [130, 142, 152, 160, 167, 172]);
    const p = (await db.profile.get('me'))!;
    expect(p.powerZoneMode).toBeUndefined();
    expect(p.hrZoneMode).toBe('abs');
  });
});
