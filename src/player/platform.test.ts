import { describe, expect, it } from 'vitest';
import { platformOf } from './platform';

describe('what the app is running on', () => {
  it('knows an iPhone', () => {
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 5)).toBe('iphone');
  });
  it('knows an iPad that says it is an iPad (Bluefy, older Safari)', () => {
    expect(platformOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 5)).toBe('ipad');
  });
  it('knows an iPad in Safari that says it is a Mac, by its touch screen', () => {
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5)).toBe('ipad');
  });
  it('knows a Mac', () => {
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 0)).toBe('computer');
  });
  it('knows Windows', () => {
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 10)).toBe('computer');
  });
  it('knows Android', () => {
    expect(platformOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', 5)).toBe('android');
  });
});
