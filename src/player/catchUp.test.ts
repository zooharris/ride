import { describe, expect, it } from 'vitest';
import { catchUp } from './catchUp';
import type { KeptPacket } from './ble/native';

/** Taking a ride back up after the app was not in front: every missed second is run, each reading at its own moment. */
describe('catching a ride up after the app was not in front', () => {
  const run = (from: number, to: number, packets: KeptPacket[]) => {
    const log: string[] = [];
    let clock: number | null = null;
    const r = catchUp({ from, to, packets, deliver: (p) => log.push(`${clock} reading ${p.data}`), second: (at) => log.push(`${clock} second ${at}`), setClock: (ms) => { clock = ms; } });
    return { r, log, clock };
  };
  const v = (t: number, data: string, more: Partial<KeptPacket> = {}): KeptPacket => ({ t, id: 'T', service: 's', characteristic: 'c', data, ...more });

  it('runs every missed second, with each reading handed over at the time it arrived and before the second it belongs to', () => {
    const { r, log, clock } = run(10_000, 13_400, [v(12_100, 'c'), v(10_400, 'a'), v(11_000, 'b'), v(13_300, 'd')]);
    expect(log).toEqual(['10400 reading a', '11000 reading b', '11000 second 11000', '12000 second 12000', '12100 reading c', '13000 second 13000', '13300 reading d']);
    expect(r).toEqual({ seconds: 3, delivered: 4, stillGone: [] });
    expect(clock).toBeNull();
  });
  it('leaves out what the ride already had: readings from before it stopped, and ones handed over live', () => {
    const { log } = run(10_000, 12_000, [v(9_900, 'old'), v(10_500, 'live', { sent: true }), v(11_500, 'kept')]);
    expect(log.filter((l) => l.includes('reading'))).toEqual(['11500 reading kept']);
  });
  it('says which devices dropped and had not come back', () => {
    const { r } = run(0, 5_000, [{ t: 1000, id: 'H', gone: true }, { t: 2000, id: 'T', gone: true }, { t: 3000, id: 'T', back: true }]);
    expect(r.stillGone).toEqual(['H']);
    expect(r.seconds).toBe(5);
  });
  it('gives the real clock back even if a second of the ride fails', () => {
    let clock: number | null = 1;
    expect(() => catchUp({ from: 0, to: 2000, packets: [], deliver: () => undefined, second: () => { throw new Error('x'); }, setClock: (ms) => { clock = ms; } })).toThrow();
    expect(clock).toBeNull();
  });
});
