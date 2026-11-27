import { describe, expect, it } from 'vitest';
import { isPadSide, isPadUpright } from './usePad';

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

describe('a tablet held on its side', () => {
  it('is a touch screen of a tablet\'s size, wider than tall', () => {
    expect(isPadSide(1180, 820, true)).toBe(true);
    expect(isPadSide(1133, 744, true)).toBe(true);
    expect(isPadSide(1376, 1032, true)).toBe(true);
  });
  it('is not a computer\'s window, a phone on its side, or an upright tablet', () => {
    expect(isPadSide(1180, 820, false)).toBe(false);
    expect(isPadSide(874, 402, true)).toBe(false);
    expect(isPadSide(820, 1180, true)).toBe(false);
    expect(isPadSide(1920, 1080, true)).toBe(false);
  });
});
