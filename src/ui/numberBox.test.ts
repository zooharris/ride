import { describe, expect, it } from 'vitest';
import { cleanNumberText, parseNumberText, showNumber } from './NumberBox';

// What happens to the text as Todd types 7.5 into a weight box (31 Oct): the point must survive.
const type = (keys: string, decimals: boolean) => [...keys].reduce((t, k) => cleanNumberText(t + k, decimals), '');

describe('the number box', () => {
  it('typing 7 then . then 5 keeps the text and ends at 7.5', () => {
    expect(type('7.', true)).toBe('7.');
    expect(type('7.5', true)).toBe('7.5');
    expect(parseNumberText(type('7.5', true))).toBe(7.5);
  });
  it('a comma is a decimal point', () => {
    expect(type('7,5', true)).toBe('7.5');
    expect(parseNumberText('7,5'.replace(',', '.'))).toBe(7.5);
  });
  it('letters are ignored, and only one point is kept', () => {
    expect(type('1a2b.5.3', true)).toBe('12.53');
  });
  it('a whole-number box ignores the point', () => {
    expect(type('1.2', false)).toBe('12');
  });
  it('an empty box, or just a point, is no number', () => {
    expect(parseNumberText('')).toBeUndefined();
    expect(parseNumberText('.')).toBeUndefined();
    expect(parseNumberText('7.')).toBe(7);
  });
  it('shows 7.5, never 7.50, and whole numbers plain', () => {
    expect(showNumber(7.5, true)).toBe('7.5');
    expect(showNumber(7.25, true)).toBe('7.25');
    expect(showNumber(20, true)).toBe('20');
    expect(showNumber(3.4, false)).toBe('3');
    expect(showNumber(undefined, true)).toBe('');
  });
});
