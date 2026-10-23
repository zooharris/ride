import { describe, expect, it } from 'vitest';
import { chartSystem, chatHistory, dayFacts, driverWords, noteSignature, notePrompt, questionSystem, readReview, reviewPrompt, riderLine, type CoachContext, type ReviewContext } from './claude';
import { readiness } from '../engine/readiness';
import { changeWords } from '../ui/planService';
import { coachFieldsChanged } from '../ui/screens/Settings';
import type { Profile, Wellness } from '../engine/types';

const todd: Profile = { name: 'Todd Harris', ftp: 222, lthr: 165, maxHr: 180, restingHr: 52, weightKg: 98, birthYear: 1966, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const angie: Profile = { ...todd, name: 'Angie', birthYear: undefined, masters: false, units: 'metric', basis: 'hr' };
const base: Wellness[] = Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(7 + i).padStart(2, '0')}`, hrv: 26, sleepSeconds: 7 * 3600, restingHr: 54 }));
const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
  profile: todd, date: '2026-10-21', fitness: { date: '2026-10-21', ctl: 40, atl: 52, tsb: -12 },
  readiness: readiness({ date: '2026-10-21', hrv: 25, sleepSeconds: 7 * 3600, restingHr: 54 }, base, -12),
  todaySessions: [], recentRides: [], missedThisWeek: 0,
  plan: { name: 'Spring century', goal: 'Hunter Mill Century on 2027-04-18 (a century)', phase: 'Base 2', recoveryWeek: false, daysToGo: 179, eventName: 'Hunter Mill Century' },
  tomorrow: ['Reston (ride); planned duration 1 h 00 min'],
  ...over,
});
const review: ReviewContext = { profile: angie, date: '2026-10-21', assessmentNotes: [], goal: 'general fitness over 12 weeks', verdict: 'on-track', advice: '', lastWeek: [], proposedChanges: [], newActivities: [], riderNotes: [] };
const chart = { profile: todd, date: '2026-10-21', from: '2026-09-10', to: '2026-10-21', lines: ['HRV (ms): first 26'], sessions: [] };

describe('one rider, one voice', () => {
  it('describes the rider from the profile', () => {
    expect(riderLine(todd, '2026-10-21')).toMatch(/^Todd is a 60-year-old road cyclist training on a masters recovery rhythm, imperial units/);
    const a = riderLine(angie, '2026-10-21');
    expect(a).toMatch(/^Angie is a road cyclist, metric units/);
    expect(a).not.toMatch(/year-old|masters/);
    expect(a).toMatch(/workouts sent by heart rate/);
    expect(riderLine({ ...todd, name: '  ' }, '2026-10-21')).toMatch(/^The rider is a/);
  });
  it('never assumes "over 50", in any of the four prompts', () => {
    const all = [notePrompt(ctx()), questionSystem(ctx()), chartSystem(chart), reviewPrompt(review)];
    for (const p of all) {
      expect(p).not.toMatch(/over 50|masters road cyclist/);
      expect(p).toMatch(/not a doctor/);
      expect(p).toMatch(/Form between −30 and −10 is a normal training build/);
    }
    expect(notePrompt(ctx())).toMatch(/^You are Todd's cycling coach\. Todd is a 60-year-old/);
    expect(reviewPrompt(review)).toMatch(/^You are Angie's cycling coach\. Angie is a road cyclist/);
  });
  it('gives the note-only rules to the note alone', () => {
    expect(notePrompt(ctx())).toMatch(/Speak to every session listed/);
    expect(notePrompt(ctx())).toMatch(/addressed to Todd by first name/);
    for (const p of [questionSystem(ctx()), chartSystem(chart), reviewPrompt(review)]) expect(p).not.toMatch(/Speak to every session/);
  });
});

describe('the day in words that cannot be misread', () => {
  it('readiness drivers name the normal and say better or worse, never up or down', () => {
    const facts = dayFacts(ctx());
    expect(facts).toMatch(/HRV 25 ms vs 2-week normal 26 ms \(normal\)/);
    expect(facts).toMatch(/Resting HR 54 bpm vs 2-week normal 54 bpm \(normal\)/);
    expect(facts).toMatch(/Form -12 \(normal\)/);
    expect(facts).not.toMatch(/\((up|down)\)/);
  });
  it('a normal from fewer than five mornings is said to be no normal yet', () => {
    const r = readiness({ date: '2026-10-21', hrv: 20 }, base.slice(0, 3), 0);
    expect(driverWords(r.drivers.find((d) => d.name === 'HRV')!)).toBe('HRV 20 ms (no normal yet: 3 days of history)');
  });
  it('the plan and tomorrow are in the facts', () => {
    const facts = dayFacts(ctx());
    expect(facts).toMatch(/Plan: Spring century, Hunter Mill Century on 2027-04-18 \(a century\); this week Base 2; 179 days to Hunter Mill Century\./);
    expect(facts).toMatch(/Tomorrow: Reston \(ride\)/);
    expect(dayFacts(ctx({ plan: undefined, tomorrow: [] }))).toMatch(/Plan: none; the rider places sessions by hand\.\nTomorrow: nothing planned\./);
    expect(dayFacts(ctx({ plan: { name: 'P', goal: 'g', phase: 'Recovery', recoveryWeek: true, daysToGo: 30 } }))).toMatch(/this week Recovery \(recovery week\); 30 days to the end of the plan/);
  });
  it('questions get four weeks of load; the note does not', () => {
    expect(questionSystem(ctx({ recentWeeks: [310, 355.4, 290, 120] }))).toMatch(/last 4 weeks, oldest first: 310 \/ 355 \/ 290 \/ 120 TSS/);
    expect(notePrompt(ctx({ recentWeeks: [310, 355, 290, 120] }))).not.toMatch(/Weekly training load/);
  });
});

describe('the review answers per change', () => {
  it('reads all, some with dates to skip, and none', () => {
    const r = readReview('2026-10-21', { content: [{ type: 'text', text: '{"text":"Good week.","applyChanges":"some","skip":["2026-10-23","not a date"],"reason":"Keep Thursday."}' }], stop_reason: 'end_turn' });
    expect(r).toMatchObject({ applyChanges: 'some', skip: ['2026-10-23'], reason: 'Keep Thursday.' });
    const none = readReview('2026-10-21', { content: [{ type: 'text', text: '{"text":"Hold.","applyChanges":"none","skip":["2026-10-23"],"reason":"r"}' }] });
    expect(none).toMatchObject({ applyChanges: 'none', skip: [] });
    // enum capitalisation is not promised; "some" naming no date is all of them
    expect(readReview('d', { content: [{ type: 'text', text: '{"text":"t","applyChanges":"All","skip":[],"reason":"r"}' }] }).applyChanges).toBe('all');
    expect(readReview('d', { content: [{ type: 'text', text: '{"text":"t","applyChanges":"some","skip":[],"reason":"r"}' }] }).applyChanges).toBe('all');
  });
  it('reads past a thinking block to the answer', () => {
    const r = readReview('2026-10-21', { content: [{ type: 'thinking', text: '{"text":"not this"}' }, { type: 'text', text: '{"text":"This one.","applyChanges":"all","skip":[],"reason":"r"}' }], stop_reason: 'end_turn' });
    expect(r).toMatchObject({ text: 'This one.', applyChanges: 'all' });
  });
  it('proposed changes are written in words', () => {
    expect(changeWords({ date: '2026-10-23', kind: 'ride', after: 'Oatlands', note: 'added' })).toBe('2026-10-23 ride: add Oatlands');
    expect(changeWords({ date: '2026-10-24', kind: 'ride', before: 'Reston', note: 'removed' })).toBe('2026-10-24 ride: remove Reston');
    expect(changeWords({ date: '2026-10-25', kind: 'ride', before: 'Reston', after: 'Vienna', note: 'changed', userEdited: true })).toBe('2026-10-25 ride: replace Reston with Vienna [the rider changed this day by hand; offered, not pre-selected]');
    expect(changeWords({ date: '2026-10-23', kind: 'ride', after: 'Oatlands', note: 'added' })).not.toMatch(/→/);
  });
});

describe('the note is rewritten for the right reasons', () => {
  const sig = (over: Partial<Parameters<typeof noteSignature>[0]> = {}) => noteSignature({ sessions: ['w1:planned::'], wellnessToday: true, band: 'go', ...over });
  it('changes when the morning wellness arrives or moves the band', () => {
    expect(sig({ wellnessToday: false })).not.toBe(sig());
    expect(sig({ band: 'easy' })).not.toBe(sig());
    expect(sig({ wellnessToday: false, band: 'easy' })).toBe(sig({ wellnessToday: false, band: 'go' }));   // no wellness: the band is form alone and does not count
    expect(sig({ plan: { name: 'P', goal: 'g', phase: 'Base 1' } })).not.toBe(sig());                        // a plan applied during the day
    expect(sig({ plan: { name: 'P', goal: 'g', phase: 'Base 1' } })).not.toBe(sig({ plan: { name: 'P', goal: 'g', phase: 'Recovery' } }));
  });
  it('Settings clears the note only for a field the coach reads', () => {
    expect(coachFieldsChanged(todd, { ...todd, name: 'Todd W. Harris' })).toBe(true);
    expect(coachFieldsChanged(todd, { ...todd, ftp: 230 })).toBe(true);
    expect(coachFieldsChanged(todd, { ...todd, weekStartsOn: 0, maxHr: 182, rideDays: [1] })).toBe(false);
  });
});

describe('a question with no answer is an error, not advice', () => {
  it('is never sent back as history, and neither is its question', () => {
    const h = chatHistory([
      { role: 'rider', text: 'q1' }, { role: 'coach', text: 'a1' },
      { role: 'rider', text: 'q2' }, { role: 'coach', text: 'Failed to fetch', error: true },
    ]);
    expect(h).toEqual([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }]);
  });
});
