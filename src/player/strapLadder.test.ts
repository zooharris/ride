/**
 * The strap brief (4 Nov 2026): the start and stop sequences the Tymewear app sends, the stall test, and the
 * recovery ladder, against a stand-in strap.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvents, StrapControl } from './ble/web';
import type { StrapCommand, StrapReply } from './ble/breath';

/** The stand-in strap: records commands; `wakesOn` is the step whose command brings breaths back. */
const fake = vi.hoisted(() => ({
  sent: [] as string[],
  ev: undefined as DriverEvents | undefined,
  wakesOn: undefined as string | undefined,
  sessions: [] as number[],
}));

vi.mock('./ble/web', async (orig) => {
  const real = await orig<typeof import('./ble/web')>();
  const reply = (cmd: StrapCommand): StrapReply => {
    const tag = { status: 0x0a, start: 0x2d, apply: 0x2e, stop: 0x0c, list: 0x6c, erase: 0x2b }[cmd];
    const r: StrapReply = { type: 'reply', tag, bytes: new Uint8Array() };
    if (cmd === 'status') r.status = { flag: 0x26, now: 1_793_838_438, session: 0 };
    if (cmd === 'list') r.sessions = [...fake.sessions];
    if (cmd === 'erase') fake.sessions = [];
    return r;
  };
  const breathe = () => fake.ev?.reading({ ve: 30, br: 25, tv: 1.2, ie: 0.8 });
  return {
    ...real,
    chooseDevice: async () => ({ id: 'strap1', name: 'TYME-TEST' }) as unknown as BluetoothDevice,
    attach: (_d: BluetoothDevice, _k: string, ev: DriverEvents) => {
      fake.ev = ev;
      setTimeout(() => ev.status('connected'), 0);
      const strap: StrapControl = {
        async send(cmd) { fake.sent.push(cmd); if (fake.wakesOn === cmd) setTimeout(breathe, 50); const r = reply(cmd); ev.strap?.(r); return r; },
        async resubscribe() { fake.sent.push('resubscribe'); if (fake.wakesOn === 'resubscribe') setTimeout(breathe, 50); },
        async reconnect() { fake.sent.push('reconnect'); setTimeout(() => ev.status('connected'), 10); if (fake.wakesOn === 'reconnect') setTimeout(breathe, 50); return true; },
      };
      return { strap, dispose() {} };
    },
  };
});

import { addSensor, breathDetails, strapRideDetails, strapRideEnd, strapRideStart, trimRideLog, STRAP_DETAILS_MAX, strapStalled, STALL_FROZEN_CLOCK_MS, STALL_NO_BREATH_MS, wakeStrap } from './hub';

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { fake.sent.length = 0; fake.wakesOn = undefined; fake.sessions = []; });

describe('the strap’s session, as the Tymewear app runs it', () => {
  it('asks the status on connecting; starts with status, start, status, apply, status', async () => {
    await addSensor('breath');
    await settle();
    expect(fake.sent).toEqual(['status']);
    fake.sent.length = 0;
    await strapRideStart();
    expect(fake.sent).toEqual(['status', 'start', 'status', 'apply', 'status']);
  });
  it('stops with status, stop, apply, status; lists, erases what is stored, lists again', async () => {
    fake.sessions = [1, 2];
    await strapRideEnd();
    expect(fake.sent).toEqual(['status', 'stop', 'apply', 'status', 'list', 'erase', 'list', 'status']);
    fake.sent.length = 0;
    await strapRideEnd();
    expect(fake.sent).toEqual(['status', 'stop', 'apply', 'status', 'list', 'status']);
  });
  it('saves the whole ride’s commands for the recording: the start and the stop, with the strap’s name (diagnostics Part A)', async () => {
    await strapRideStart();
    await strapRideEnd();
    const t = strapRideDetails()!;
    expect(t).toContain('Breathing strap: TYME-TEST');
    expect(t).toContain('Status: connected');
    expect(t).toContain('→ start');
    expect(t).toContain('→ stop');
    expect(t.indexOf('→ start')).toBeLessThan(t.indexOf('→ stop'));
    expect(t.length).toBeLessThanOrEqual(STRAP_DETAILS_MAX);
  });
  it('a long ride’s log keeps its first 10 and last 50 lines', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const t = trimRideLog(lines);
    expect(t.length).toBe(61);
    expect(t[0]).toBe('line 0');
    expect(t[10]).toContain('140 lines left out');
    expect(t[60]).toBe('line 199');
    expect(trimRideLog(lines.slice(0, 5))).toEqual(lines.slice(0, 5));
  });
  it('Copy details shows the decoded status and the commands sent', () => {
    const t = breathDetails('strap1');
    expect(t).toContain('Strap status: flag 0x26');
    expect(t).toContain('→ stop');
  });
});

describe('the stall test', () => {
  const now = 1_000_000;
  it('20 s without a breath from a strap that has breathed', () => {
    expect(strapStalled({ lastBreathAt: now - STALL_NO_BREATH_MS + 1000 }, now)).toBe(false);
    expect(strapStalled({ lastBreathAt: now - STALL_NO_BREATH_MS }, now)).toBe(true);
    expect(strapStalled({}, now)).toBe(false);
  });
  it('motion frames arriving with a clock frozen for 10 s (the 4 Nov stall), breaths or not', () => {
    expect(strapStalled({ motionAt: now - 500, clockAt: now - STALL_FROZEN_CLOCK_MS }, now)).toBe(true);
    expect(strapStalled({ motionAt: now - 500, clockAt: now - 2000 }, now)).toBe(false);
    // Motion frames stopped too: that is a lost connection, handled by reconnecting, not a stall.
    expect(strapStalled({ motionAt: now - 8000, clockAt: now - 20_000 }, now)).toBe(false);
  });
});

describe('the recovery ladder', () => {
  it('stops at the first step that brings breaths back, and says which', async () => {
    fake.wakesOn = 'start';
    expect(await wakeStrap('strap1', undefined, 300)).toBe('start');
    expect(breathDetails('strap1')).toContain('breathing back after: session started again');
  });
  it('climbs: start, then stop and start, then notifications, then reconnect', async () => {
    fake.wakesOn = 'resubscribe';
    const steps: string[] = [];
    expect(await wakeStrap('strap1', (s) => steps.push(s), 300)).toBe('resubscribe');
    expect(steps).toEqual(['start', 'stop-start', 'resubscribe']);
    expect(fake.sent.filter((x) => x === 'stop')).toHaveLength(1);
  });
  it('reports failure when nothing works, after all four steps', async () => {
    const steps: string[] = [];
    expect(await wakeStrap('strap1', (s) => steps.push(s), 200)).toBeUndefined();
    expect(steps).toEqual(['start', 'stop-start', 'resubscribe', 'reconnect']);
    expect(fake.sent).toContain('reconnect');
    expect(breathDetails('strap1')).toContain('nothing brought breathing back');
  });
});

describe('the strap’s details never reach the ride file (diagnostics Part A)', () => {
  it('a recording with strapLog encodes to the same bytes as without', async () => {
    const { encodeFit } = await import('./fit');
    const rec = {
      id: 'r1', status: 'finished', startedAt: '2026-11-07T11:00:00', startMs: Date.UTC(2026, 10, 7, 16), date: '2026-11-07', name: 'Test', basis: 'power', ftp: 238, lthr: 154,
      samples: Array.from({ length: 30 }, (_, t) => ({ t, watts: 150, bpm: 120, cadence: 90, ve: 30, br: 25, tv: 1.2 })),
      laps: [], events: [], timerSeconds: 30, distanceM: 200, savedMs: 0, breathing: true,
    } as unknown as import('./types').Recording;
    const totals = { seconds: 30, tss: 1, avgPower: 150, avgHr: 120 } as unknown as Parameters<typeof encodeFit>[1];
    const a = encodeFit(rec, totals), b = encodeFit({ ...rec, strapLog: 'Breathing strap: X\n→ start' }, totals);
    expect([...b]).toEqual([...a]);
  });
});
