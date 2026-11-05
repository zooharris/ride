import { describe, expect, it } from 'vitest';
import { motionClock, parseStrapReply, STRAP, tagOf } from './breath';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((x) => parseInt(x, 16)));

describe('the strap’s command replies, as captured from the Tymewear app on 4 Nov', () => {
  it('reads a status reply: flag, clock and session', () => {
    const r = parseStrapReply(hex('00800a0080000808002800e61b15000066cdeb6a30caeb6aac0d'))!;
    expect(r.type).toBe('reply');
    if (r.type !== 'reply') return;
    expect(r.tag).toBe(tagOf(STRAP.status));
    expect(r.status).toEqual({ flag: 0xe6, now: 0x6aebcd66, session: 0x6aebca30 });
  });
  it('reads an idle status (no session)', () => {
    const r = parseStrapReply(hex('00800a0080000808002800261b150000edcdeb6a00000000ac0d'))!;
    expect(r.type === 'reply' && r.status).toEqual({ flag: 0x26, now: 0x6aebcded, session: 0 });
  });
  it('reads the stored-session list, and an empty one', () => {
    const r = parseStrapReply(hex('00806c009ebaeb6a20a005008baf050030caeb6a20b00500d0c40500'))!;
    expect(r.type === 'reply' && r.sessions).toEqual([0x6aebba9e, 0x6aebca30]);
    const e = parseStrapReply(hex('00806c00'))!;
    expect(e.type === 'reply' && e.sessions).toEqual([]);
  });
  it('matches each command to its reply by tag', () => {
    expect(tagOf(STRAP.stop)).toBe(0x0c);
    expect((parseStrapReply(hex('00800c00')) as { tag: number }).tag).toBe(0x0c);
    expect((parseStrapReply(hex('00802d00')) as { tag: number }).tag).toBe(tagOf(STRAP.start));
  });
  it('recognises the minute beacon', () => {
    expect(parseStrapReply(hex('02407a1c33550f01'))).toMatchObject({ type: 'beacon', counter: 0x7a });
  });
  it('reads a motion frame’s clock: advancing when healthy, frozen in the stall', () => {
    expect(motionClock(hex('02e63300000000000000000000'))).toBe(0x33e6);
    expect(motionClock(hex('02ff3300000000000000000000'))).toBe(0x33ff);
    expect(motionClock(hex('029fa401000000000000000000'))).toBe(0x01a49f);
    expect(motionClock(hex('01e63300000000000000000000'))).toBeUndefined();
  });
});
