import { describe, expect, it } from 'vitest';
import { destinationWords, lastUploadWords, nameList, pushErrorWords, readDestinations, readPushErrors } from './destinations';

/** Connections and switches shaped like the live account checked on 13 Nov 2026 (Garmin connected with uploads on). */
const conn = (over: Record<string, boolean> = {}) => ({ garmin_health_connected: true, garmin_training_connected: true, wahoo_connected: false, coros_connected: false, suunto_connected: false, zwift_connected: false, strava_connected: false, polar_connected: false, hammerhead_connected: false, ...over });
const ath = (over: Record<string, unknown> = {}) => ({ icu_garmin_upload_workouts: true, icu_garmin_last_upload: '2026-11-13T15:00:26.160+00:00', icu_garmin_upload_filters: null, wahoo_upload_workouts: false, coros_upload_workouts: false, suunto_upload_workouts: null, zwift_upload_workouts: false, strava_sync_activities: true, ...over });

describe('where a sent workout goes (13 Nov 2026)', () => {
  it('Garmin connected with uploads on: the app says so, and nothing else changes', () => {
    const d = readDestinations(conn(), ath());
    expect(d.receiving.map((x) => x.name)).toEqual(['Garmin']);
    expect(destinationWords(d, '2026-11-14', '2026-11-13')).toEqual({ none: false, line: 'Intervals.icu will pass this to your Garmin.', extra: [] });
  });
  it('nothing connected: nothing receives it', () => {
    const d = readDestinations(conn({ garmin_training_connected: false, garmin_health_connected: false }), ath({ icu_garmin_upload_workouts: false }));
    expect(d.makers).toEqual([]);
    expect(destinationWords(d)).toMatchObject({ none: true, line: "Intervals.icu isn't set to upload workouts to any device." });
  });
  it('connected with uploads off: said, and it receives nothing', () => {
    const d = readDestinations(conn(), ath({ icu_garmin_upload_workouts: false }));
    const w = destinationWords(d);
    expect(w.none).toBe(true);
    expect(w.extra).toEqual(['Your Garmin is connected in Intervals.icu, but uploading planned workouts to it is off.']);
  });
  it('a switch on without the connection counts for nothing', () => {
    const d = readDestinations(conn({ garmin_training_connected: false }), ath());
    expect(d.receiving).toEqual([]);
    expect(d.makers[0]).toMatchObject({ name: 'Garmin', connected: false, uploads: true });
  });
  it('Garmin and Wahoo both receive it', () => {
    const d = readDestinations(conn({ wahoo_connected: true }), ath({ wahoo_upload_workouts: true }));
    expect(destinationWords(d).line).toBe('Intervals.icu will pass this to your Garmin and Wahoo.');
    expect(nameList([{ name: 'Garmin' }, { name: 'Wahoo' }, { name: 'Coros' }])).toBe('Garmin, Wahoo and Coros');
  });
  it('a filter is warned of, never interpreted; three weeks ahead says nearer the day', () => {
    const d = readDestinations(conn(), ath({ icu_garmin_upload_filters: [{ field: 'type', value: 'Ride' }] }));
    const w = destinationWords(d, '2026-12-04', '2026-11-13');
    expect(w.extra).toEqual([
      'Intervals.icu has an upload filter for your Garmin, so it may skip this workout. Check it in Intervals.icu settings.',
      'Intervals.icu uploads about a week ahead, so this reaches your devices nearer the day.',
    ]);
  });
  it('the last upload time, in words', () => {
    const d = readDestinations(conn(), ath({ icu_garmin_last_upload: '2026-11-13T15:00:00Z' }));
    const [line] = lastUploadWords(d, new Date('2026-11-13T15:00:00Z').toLocaleDateString('en-CA'));
    expect(line).toMatch(/^Intervals\.icu last uploaded to Garmin today at /);
  });
});

describe('delivery errors', () => {
  it('none recorded: nothing shown', () => {
    expect(readPushErrors({ push_errors: null })).toEqual([]);
    expect(readPushErrors({})).toEqual([]);
  });
  it("shown in Intervals.icu's own words", () => {
    const [e] = readPushErrors({ push_errors: [{ service: 'GARMIN', message: 'Workout has no steps', date: '2026-11-13T10:00:00Z' }] });
    const w = pushErrorWords(e);
    expect(w.head).toMatch(/^Intervals\.icu couldn't deliver this to Garmin \(/);
    expect(w.message).toBe('Workout has no steps');
  });
});
