import { describe, expect, it } from 'vitest';
import { isPadUpright } from './usePad';

describe('an upright iPad', () => {
  it('is each size of iPad held upright', () => {
    expect(isPadUpright(744, 1133)).toBe(true); // mini
    expect(isPadUpright(820, 1180)).toBe(true); // 11-inch
    expect(isPadUpright(1032, 1376)).toBe(true); // 13-inch
  });
  it('is not an iPad on its side, a phone, or a laptop', () => {
    expect(isPadUpright(1180, 820)).toBe(false);
    expect(isPadUpright(402, 874)).toBe(false);
    expect(isPadUpright(1440, 900)).toBe(false);
    expect(isPadUpright(1280, 1600)).toBe(false);
  });
});
