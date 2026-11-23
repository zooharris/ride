import { describe, expect, it } from 'vitest';
import { dayAfter, dayBefore, earlierSeed, EMPTY_HISTORY, entryOn, ftpFor, importFtpWords, lthrFor, mergeHistories, periodsOf, seedFtp, sorted, sourceWords, suggestions, usedWords, usePeriod, withEntry, withoutEntry, type ThresholdHistory } from './thresholdHistory';

const H = (rows: Array<[string, number, string?]>): ThresholdHistory => rows.reduce<ThresholdHistory>((h, [from, value, at]) => withEntry(h, { from, value, source: 'typed', at: at ?? '2026-01-01T00:00:00Z' }), EMPTY_HISTORY);

describe('the entry in force on a day', () => {
  const h = H([['2026-03-01', 222], ['2026-11-07', 251]]);
  it('at the edges: the day of an entry, the day before the first, between two', () => {
    expect(entryOn(h, '2026-03-01')?.value).toBe(222);            // the day of an entry
    expect(entryOn(h, '2026-02-28')).toBeUndefined();              // the day before the first
    expect(entryOn(h, '2026-07-15')?.value).toBe(222);            // between two
    expect(entryOn(h, '2026-11-06')?.value).toBe(222);            // the day before the second
    expect(entryOn(h, '2026-11-07')?.value).toBe(251);            // the day of the second
    expect(entryOn(h, '2030-01-01')?.value).toBe(251);            // long after the last
    expect(entryOn(EMPTY_HISTORY, '2026-07-15')).toBeUndefined();
  });
  it('one entry a day: a second on the same day replaces the first; a removal is remembered', () => {
    const again = withEntry(h, { from: '2026-03-01', value: 230, source: 'typed' });
    expect(sorted(again).map((e) => e.value)).toEqual([230, 251]);
    const gone = withoutEntry(again, '2026-11-07', '2026-11-22T10:00:00Z');
    expect(sorted(gone).map((e) => e.from)).toEqual(['2026-03-01']);
    expect(gone.removed).toEqual({ '2026-11-07': '2026-11-22T10:00:00Z' });
    // Adding that day again forgets the removal.
    expect(withEntry(gone, { from: '2026-11-07', value: 251, source: 'typed' }).removed).toBeUndefined();
  });
  it('days step over month and year ends', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
  });
});

describe('which FTP scores a ride (Part B)', () => {
  const history = H([['2026-03-01', 222], ['2026-11-07', 251]]);
  it("Antogo's (the default): the entry in force; before the first entry, the device's from the file, else the first entry", () => {
    expect(ftpFor('2026-07-01', { history, device: 244 })).toEqual({ value: 222, why: { kind: 'history', entry: sorted(history)[0] } });
    expect(ftpFor('2026-11-08', { history, device: 210 })?.value).toBe(251);
    expect(ftpFor('2025-06-01', { history, device: 230 })).toEqual({ value: 230, why: { kind: 'device-before' } });
    expect(ftpFor('2025-06-01', { history })).toEqual({ value: 222, why: { kind: 'first', entry: sorted(history)[0] } });
  });
  it("the device's: the FTP in the file where there is one, else Antogo's history", () => {
    expect(ftpFor('2026-07-01', { history, scoring: 'device', device: 244 })).toEqual({ value: 244, why: { kind: 'device' } });
    expect(ftpFor('2025-06-01', { history, scoring: 'device', device: 230 })?.value).toBe(230);
    expect(ftpFor('2026-07-01', { history, scoring: 'device' })?.value).toBe(222);
    expect(ftpFor('2026-11-08', { history, scoring: 'device' })?.value).toBe(251);
    expect(ftpFor('2025-06-01', { history, scoring: 'device' })?.why.kind).toBe('first');
  });
  it("the rider's own figure for one ride comes before either; with no history at all, the device's or the setting", () => {
    expect(ftpFor('2026-07-01', { history, scoring: 'device', device: 244, own: 240 })).toEqual({ value: 240, why: { kind: 'you' } });
    expect(ftpFor('2026-07-01', { history: EMPTY_HISTORY, device: 244, now: 250 })?.why.kind).toBe('device-before');
    expect(ftpFor('2026-07-01', { history: EMPTY_HISTORY, now: 250 })).toEqual({ value: 250, why: { kind: 'now' } });
    expect(ftpFor('2026-07-01', {})).toBeUndefined();
  });
  it('threshold heart rate: the history only, and the first entry for anything older', () => {
    const lthr = H([['2026-11-22', 166]]);
    expect(lthrFor('2026-11-23', { history: lthr })?.value).toBe(166);
    expect(lthrFor('2024-05-25', { history: lthr })).toMatchObject({ value: 166, why: { kind: 'first' } });
    expect(lthrFor('2024-05-25', { history: lthr, own: 158 })).toEqual({ value: 158, why: { kind: 'you' } });
    expect(lthrFor('2024-05-25', { now: 160 })).toEqual({ value: 160, why: { kind: 'now' } });
  });
  it('says what was used and why, as the ride page words it', () => {
    const t = '2026-11-22';
    expect(usedWords({ value: 244, why: { kind: 'device' } }, 'W', t)).toBe("244 W · your device's setting that day");
    expect(usedWords({ value: 251, why: { kind: 'history', entry: { from: '2026-11-07', value: 251, source: 'test', note: 'Ramp Test', at: '' } } }, 'W', t)).toBe("251 W · Antogo's history (Ramp Test, 7 Nov)");
    expect(usedWords({ value: 240, why: { kind: 'you' } }, 'W', t)).toBe('240 W · set by you for this ride');
    expect(usedWords({ value: 166, why: { kind: 'history', entry: { from: '2025-09-12', value: 166, source: 'settings', at: '' } } }, 'bpm', t)).toBe("166 bpm · Antogo's history (set in Settings, 12 Sep 2025)");
    expect(sourceWords({ source: 'test', note: 'Ramp Test' })).toBe('Ramp Test in Antogo');
    expect(['settings', 'service', 'activities', 'device', 'typed'].map((s) => sourceWords({ source: s as never }))).toEqual(['set in Settings', 'from Intervals.icu', 'filled in from your activities', 'from your device', 'typed by you']);
  });
});

describe('filling the history in from activities already here (A3)', () => {
  const points = [
    { date: '2026-03-01', value: 222 }, { date: '2026-03-04', value: 222 }, { date: '2026-06-20', value: 222 },
    { date: '2026-11-09', value: 251 }, { date: '2026-11-12', value: 251 }, { date: '2026-01-10', value: undefined },
  ];
  it('each change in the FTP kept with the activities becomes an entry', () => {
    const h = seedFtp({ points, now: { value: 251 }, today: '2026-11-22' });
    expect(sorted(h).map((e) => [e.from, e.value, e.source])).toEqual([['2026-03-01', 222, 'activities'], ['2026-11-09', 251, 'activities']]);
  });
  it('a change that matches a test the rider took is dated on the day of the test, and says so', () => {
    const h = seedFtp({ points, tests: [{ date: '2026-11-07', value: 251, name: 'Ramp Test' }], now: { value: 251 }, today: '2026-11-22' });
    expect(sorted(h).map((e) => [e.from, e.value, e.source, e.note])).toEqual([['2026-03-01', 222, 'activities', undefined], ['2026-11-07', 251, 'test', 'Ramp Test']]);
  });
  it("ends on the rider's FTP as it is now; with no activities, starts from it", () => {
    const later = seedFtp({ points, now: { value: 260, setOn: '2026-11-20' }, today: '2026-11-22' });
    expect(sorted(later).pop()).toMatchObject({ from: '2026-11-20', value: 260, source: 'settings' });
    const none = seedFtp({ points: [], now: { value: 200, setOn: '2026-10-01' }, today: '2026-11-22' });
    expect(sorted(none)).toMatchObject([{ from: '2026-10-01', value: 200, source: 'start' }]);
    expect(sorted(seedFtp({ points: [], today: '2026-11-22' }))).toEqual([]);
  });
  it('a longer history loaded later adds the earlier entries in front, and never brings back one the rider removed', () => {
    const short = seedFtp({ points: points.filter((p) => p.date >= '2026-06-01'), now: { value: 251 }, today: '2026-11-22' });
    expect(sorted(short)[0].from).toBe('2026-06-20');
    const full = seedFtp({ points: [{ date: '2025-05-01', value: 205 }, ...points], now: { value: 251 }, today: '2026-11-22' });
    const more = earlierSeed(short, full);
    expect(sorted(more).map((e) => [e.from, e.value])).toEqual([['2025-05-01', 205], ['2026-03-01', 222], ['2026-11-09', 251]]);
    const edited = withEntry(short, { from: '2026-06-20', value: 230, source: 'typed' });
    expect(earlierSeed(edited, full)).toEqual(edited);   // its first entry is the rider's own now: nothing is added in front
  });
});

describe("the device's figures, as suggestions (A5)", () => {
  const device = periodsOf([
    { date: '2024-05-25', value: 230 }, { date: '2025-08-01', value: 230 },
    { date: '2026-06-03', value: 244 }, { date: '2026-09-01', value: 244 }, { date: '2026-11-06', value: 244 },
    { date: '2026-11-08', value: 210 }, { date: '2026-11-20', value: 210 },
  ]);
  const history = withEntry(H([['2026-03-01', 222]]), { from: '2026-11-07', value: 251, source: 'test', note: 'Ramp Test' });
  it('periods: each change of figure starts one, running to the last ride that carried it; the last is open', () => {
    expect(device).toEqual([
      { value: 230, from: '2024-05-25', to: '2025-08-01', rides: 2 },
      { value: 244, from: '2026-06-03', to: '2026-11-06', rides: 3 },
      { value: 210, from: '2026-11-08', rides: 2 },
    ]);
  });
  it("offered where the device differs from the history over the stretch, with what the history has there", () => {
    const s = suggestions(history, device, '2026-11-22');
    expect(s.map((x) => [x.value, x.antogo])).toEqual([[244, [222]], [210, [251]]]);   // the 230 W stretch is older than the history: its rides already use their files' figure
    expect(suggestions(H([['2024-01-01', 230]]), device.slice(0, 1), '2026-11-22')).toEqual([]);
    expect(suggestions(EMPTY_HISTORY, device, '2026-11-22')).toHaveLength(3);   // no history yet: every stretch is offered   // they agree: nothing to offer
  });
  it('"Use the device\'s for this period": the stretch takes it, and the history carries on after as it was', () => {
    // The device had 244 from 3 June to 6 November; the Ramp Test's entry, the day after, is untouched.
    const used = usePeriod(history, device[1]);
    expect(sorted(used).map((e) => [e.from, e.value, e.source])).toEqual([['2026-03-01', 222, 'typed'], ['2026-06-03', 244, 'device'], ['2026-11-07', 251, 'test']]);
    expect(entryOn(used, '2026-06-02')?.value).toBe(222);
    expect(entryOn(used, '2026-08-15')?.value).toBe(244);
    expect(entryOn(used, '2026-11-20')?.value).toBe(251);
  });
  it('an entry inside the stretch is replaced; what was in force the day after carries on from that day', () => {
    const h = H([['2026-03-01', 222], ['2026-08-01', 228]]);
    const used = usePeriod(h, { value: 244, from: '2026-06-03', to: '2026-09-30', rides: 5 });
    expect(sorted(used).map((e) => [e.from, e.value])).toEqual([['2026-03-01', 222], ['2026-06-03', 244], ['2026-10-01', 228]]);
  });
  it("the stretch that still holds replaces everything from its first day on", () => {
    const used = usePeriod(history, { value: 210, from: '2026-11-08', rides: 2 });
    expect(sorted(used).map((e) => [e.from, e.value])).toEqual([['2026-03-01', 222], ['2026-11-07', 251], ['2026-11-08', 210]]);
    expect(entryOn(used, '2026-11-22')?.value).toBe(210);
  });
});

describe("two devices' histories made one", () => {
  const base = H([['2026-03-01', 222, '2026-01-01T00:00:00Z']]);
  it('an entry added on one device and one corrected on the other both stand', () => {
    const phone = withEntry(base, { from: '2026-11-07', value: 251, source: 'test', note: 'Ramp Test', at: '2026-11-07T10:00:00Z' });
    const laptop = withEntry(base, { from: '2026-03-01', value: 225, source: 'typed', at: '2026-11-20T10:00:00Z' });
    const both = mergeHistories(phone, laptop);
    expect(sorted(both).map((e) => [e.from, e.value])).toEqual([['2026-03-01', 225], ['2026-11-07', 251]]);
    expect(mergeHistories(laptop, phone)).toEqual(both);
  });
  it('a removal carries, unless the day was written again after it', () => {
    const removed = withoutEntry(base, '2026-03-01', '2026-11-20T10:00:00Z');
    expect(sorted(mergeHistories(base, removed))).toEqual([]);
    const again = withEntry(base, { from: '2026-03-01', value: 230, source: 'typed', at: '2026-11-21T10:00:00Z' });
    expect(sorted(mergeHistories(removed, again)).map((e) => e.value)).toEqual([230]);
  });
  it('the same figure on the same day keeps the entry that says how it first got there', () => {
    const settings = withEntry(EMPTY_HISTORY, { from: '2026-11-22', value: 251, source: 'settings', at: '2026-11-22T09:00:00Z' });
    const service = withEntry(EMPTY_HISTORY, { from: '2026-11-22', value: 251, source: 'service', at: '2026-11-22T09:05:00Z' });
    expect(sorted(mergeHistories(service, settings))[0].source).toBe('settings');
  });
});

describe('what the files brought in say about FTP (Part E)', () => {
  const found = { periods: [{ value: 230, from: '2024-05-25', to: '2026-06-02', rides: 300 }, { value: 244, from: '2026-06-03', to: '2026-11-07', rides: 60 }, { value: 210, from: '2026-11-08', rides: 10 }], byDevice: 250, byHistory: 60, byFirst: 40 };
  const history = H([['2026-03-01', 222]]);
  it('what was found, in periods', () => {
    expect(importFtpWords(found, 'antogo', history).found).toBe('Your files say your FTP was 230 W from May 2024, 244 W from June 2026, then 210 W from November 2026.');
  });
  it("how they will be used under Antogo's history, and under the device's", () => {
    expect(importFtpWords(found, 'antogo', history).used).toBe("Your setting is to score rides with Antogo's FTP history. 60 new rides are from 1 Mar 2026 or later, where Antogo's history begins, and will use the history; 250 are older than that and will use the figure from their own file; 40 older ones whose files carry none will use the history's first entry (222 W).");
    expect(importFtpWords(found, 'device', history).used).toBe("Your setting is to score rides with the FTP your device had set that day. 250 new rides carry one in their file and will use it. The other 100 will use Antogo's FTP history.");
  });
});
