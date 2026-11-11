import { describe, expect, it } from 'vitest';
import { coachWords, progressSystem, PROGRESS_SCHEMA } from './claude';
import { DEFAULT_PROFILE } from '../data/db';

describe('the coach on Progress', () => {
  it('turns abbreviations into words and makes a shortened name whole', () => {
    expect(coachWords('Tod, your CTL rose and TSB is low.', { name: 'Todd' })).toBe('Todd, your fitness rose and form is low.');
    expect(coachWords('Zoo, rest today.', { name: 'zooharris' })).toBe('zooharris, rest today.');
    expect(coachWords('The durability card shows a smaller fade.', { name: '' })).toBe('The card shows a smaller fade.');
    expect(coachWords('And, more to the point, today is easy.', { name: 'Andrew' })).toBe('And, more to the point, today is easy.');
    expect(coachWords('Rest today, Andy.', { name: 'Andrew' })).toBe('Rest today, Andy.');
  });
  it('leaves ordinary words alone', () => {
    expect(coachWords('Your efficiency improved. Keep the long rides.', { name: 'Todd' })).toBe('Your efficiency improved. Keep the long rides.');
  });
  it('sends only the page numbers it is given', () => {
    const s = progressSystem({ profile: { ...DEFAULT_PROFILE, name: 'Pat' }, date: '2026-11-11', from: '2026-08-13', to: '2026-11-11', context: ['Range shown: Aug 13 to Nov 11.'], ticker: ['Fitness 56 (+1)'], key: ['Fitness: 56 · 55 · +1'], cards: [{ id: 'load', title: 'Weekly training load', readout: 'this week 91' }] });
    expect(s).toContain('- load · Weekly training load: this week 91');
    expect(s).toContain('"Pat"');
    expect(PROGRESS_SCHEMA.required).toEqual(['headline', 'cards']);
  });
});
