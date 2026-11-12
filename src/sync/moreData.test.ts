import { describe, expect, it } from 'vitest';
import { rideExtras, wellnessExtras, type IcuActivity, type IcuWellness } from './intervals';

describe('more data per activity and per day', () => {
  it('carries only the numbers the service sent, in the app\'s units', () => {
    const a = { id: 'i1', start_date_local: '2026-11-10T08:00:00', calories: 812, icu_joules: 905000, icu_joules_above_ftp: 42000, icu_variability_index: 1.07, max_speed: 15.2, coasting_time: 310, total_elevation_loss: 640, icu_rpe: 6, carbs_used: 180, icu_max_wbal_depletion: 11800, average_weather_temp: 9.5, average_feels_like: 6, average_wind_speed: 4.1, headwind_percent: 38, device_name: ' Edge 840 ' } as IcuActivity;
    expect(rideExtras(a)).toEqual({ calories: 812, workKj: 905, workAboveFtpKj: 42, variabilityIndex: 1.07, maxSpeedMs: 15.2, coastingSeconds: 310, elevationLossM: 640, rpe: 6, carbsUsedG: 180, reserveUsedKj: 11.8, weatherTempC: 9.5, feelsLikeC: 6, windMs: 4.1, headwindPct: 38, device: 'Edge 840' });
  });
  it('adds nothing for an activity without them, and treats zero and null as not known', () => {
    expect(rideExtras({ id: 'i2', start_date_local: '2026-11-10T08:00:00' } as IcuActivity)).toEqual({});
    expect(rideExtras({ id: 'i3', start_date_local: '2026-11-10T08:00:00', calories: 0, icu_joules: null, device_name: '' } as unknown as IcuActivity)).toEqual({});
  });
  it('keeps a freezing day: a temperature of zero or below is a real reading', () => {
    expect(rideExtras({ id: 'i4', start_date_local: '2026-01-10T08:00:00', average_weather_temp: 0, average_feels_like: -6 } as IcuActivity)).toEqual({ weatherTempC: 0, feelsLikeC: -6 });
  });
  it('does the same for the daily numbers', () => {
    expect(wellnessExtras({ id: '2026-11-10', spO2: 96, steps: 8421, vo2max: 47, readiness: 82, hrvSDNN: 61, bodyFat: 18.4 } as IcuWellness)).toEqual({ spO2: 96, steps: 8421, vo2max: 47, deviceReadiness: 82, hrvSdnn: 61, bodyFatPct: 18.4 });
    expect(wellnessExtras({ id: '2026-11-10', spO2: 0 } as IcuWellness)).toEqual({});
  });
});
