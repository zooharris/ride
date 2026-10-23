/**
 * The app's words for its numbers, in one place: Help's "The numbers,
 * explained" reads `long`, the hover texts on Today, the fitness chart and the
 * activity page read `short`, so the two can never drift apart. Change a
 * definition here and both follow.
 */

/** The seven zones, named; the key under every zone chart. */
export const ZONE_NAMES = ['recovery', 'endurance', 'tempo', 'threshold', 'VO2max', 'anaerobic', 'sprint'] as const;
export const ZONE_KEY = ZONE_NAMES.map((n, i) => `Z${i + 1} ${n}`).join(' · ');

export interface Term { term: string; short: string; long: string }

export const GLOSSARY = {
  runLoad: {
    term: 'Run load',
    short: 'A run scored from heart rate and time, then Intervals.icu, then 55 an hour',
    long: 'A run is scored from heart rate and time, the same way an HR-only ride is. With no heart rate it takes Intervals.icu\'s own load; with neither, 55 an hour, marked ≈ as an estimate.',
  },
  tss: {
    term: 'Training load (TSS)',
    short: 'How much the ride cost you, from power. An hour flat out at FTP is 100',
    long: 'How much a session cost. An hour flat out at FTP is 100. Rides compute it from power, or from heart rate when there was no meter (a zone-2 heart rate costs what zone-2 power costs); a ride with neither is estimated from its time and marked ≈; a recording under five minutes, or a "ride" at car speed, is not training and counts 0; strength, mobility and walks are estimated from duration and effort, and a logged effort rating replaces the estimate.',
  },
  ftp: {
    term: 'FTP',
    short: 'Functional threshold power: the highest power you can hold for about an hour',
    long: 'Functional threshold power: the highest power you can hold for about an hour. Every power zone is a share of it.',
  },
  lthr: {
    term: 'Threshold heart rate',
    short: 'The heart rate that goes with FTP',
    long: 'The heart rate that goes with FTP (sometimes written LTHR). Runs and walks have their own, usually a few beats higher. Heart-rate zone tops are set in Settings, in beats per minute, and start out as shares of it; walk targets are shares of max heart rate.',
  },
  zones: {
    term: 'Zones',
    short: ZONE_KEY,
    long: `Seven zones (${ZONE_NAMES.map((n, i) => `${i + 1} ${n}`).join(', ')}), by power as shares of FTP and by heart rate as the zone tops set in Settings (on the bike, and on foot for runs and walks), always in the same colours: grey, blue, green, yellow, orange, red, purple. Charts write them Z1 to Z7 with the key underneath. Intervals.icu may report heart-rate zones of its own on an activity; those are shown as it gives them.`,
  },
  np: {
    term: 'Normalized power',
    short: 'What the ride felt like in steady watts; surges count more than coasting',
    long: 'What a ride felt like in steady watts; surges count more than coasting. Calendar rows show it as "180 W normalized".',
  },
  intensity: {
    term: 'Intensity',
    short: 'Normalized power over FTP. 0.70 is endurance, 1.00 is threshold',
    long: 'Normalized power over FTP (the intensity factor, sometimes written IF). 0.70 is endurance, 1.00 is threshold. A ride without power has none; the app then judges it by heart rate.',
  },
  fitness: {
    term: 'Fitness',
    short: '42-day weighted average of daily training load',
    long: 'A 42-day weighted average of daily training load. It rises slowly with consistent training and is what a goal needs on the day.',
  },
  fatigue: {
    term: 'Fatigue',
    short: '7-day weighted average of daily training load',
    long: 'A 7-day weighted average of daily training load. It rises fast after hard days and falls fast with rest.',
  },
  form: {
    term: 'Form',
    short: 'fitness minus fatigue; negative while building, positive when fresh',
    long: 'Fitness minus fatigue, today. Fitness moves slowly and fatigue fast, so on the chart form is the mirror of fatigue: a hard week pushes it down, a rest week lets it climb. Fitness only rises while fatigue is above it, so form is negative through any build: −10 to −30 is the productive "building" band, below −30 is overreaching and a rest week is due, −10 to +5 is neutral (recovery weeks), and +5 to +25 is fresh, where you want to be on an event day but not for long. The charts shade these bands.',
  },
  ramp: {
    term: 'Ramp rate',
    short: 'How many fitness points a week you are adding',
    long: 'How many fitness points a week you are adding. The planner caps it (4 a week for a masters rider, more with evidence you recover well).',
  },
  powerCurve: {
    term: 'Power curve, W/kg',
    short: 'Your best average power for each length of effort',
    long: 'Your best average power held for each length of effort; watts per kilogram divides it by your weight, the fairer way to compare climbing ability.',
  },
  ef: {
    term: 'Efficiency factor',
    short: 'Normalized power per heartbeat. Rising over months on the same kind of ride means aerobic fitness is improving',
    long: 'Normalized power per heartbeat. Rising over months on the same kind of ride means aerobic fitness is improving.',
  },
  drift: {
    term: 'Heart-rate drift',
    short: 'How much heart rate rose for the same power in the second half. Under 5% on a long ride is a sign of good aerobic base',
    long: 'How much heart rate rose for the same power in the second half of a ride. Under 5% on a steady long ride is a sign of a good aerobic base. Only steady endurance rides of an hour or more count, and a drift reading beyond ±15% means the ride was not steady (stops, a tailwind home), so it is left out.',
  },
  hrv: {
    term: 'HRV',
    short: 'Heart-rate variability this morning against your two-week average. Higher than normal means recovered; lower means stress or fatigue.',
    long: 'Heart-rate variability overnight, in milliseconds. Higher than your normal usually means recovered; lower means stress, fatigue or illness.',
  },
  sleep: {
    term: 'Sleep',
    short: 'Last night against your two-week average.',
    long: 'Last night’s sleep against your two-week average.',
  },
  restingHr: {
    term: 'Resting heart rate',
    short: 'Resting heart rate this morning against your two-week average. Higher than normal is a fatigue or illness signal.',
    long: 'Resting heart rate this morning against your two-week average. Higher than normal is a fatigue or illness signal.',
  },
  readiness: {
    term: 'Readiness',
    short: 'HRV, sleep, resting heart rate and form against your own two-week normal, as a score out of 100',
    long: 'HRV (40%), sleep (30%), resting heart rate (15%) and form (15%), each against your own two-week normal, as a score out of 100: 75 and up Ready, 55–74 Ease off a little, 35–54 Keep it easy, under 35 Rest.',
  },
  effort: {
    term: 'Effort',
    short: 'How hard a session felt, 1 easy to 10 all-out',
    long: 'How hard a session felt, 1 easy to 10 all-out (sometimes called RPE). Used when you log a session by hand and to set a strength session’s training load.',
  },
} satisfies Record<string, Term>;

/** The order of Help's "The numbers, explained". */
export const NUMBERS_ORDER: Array<keyof typeof GLOSSARY> = ['tss', 'ftp', 'lthr', 'zones', 'np', 'intensity', 'fitness', 'fatigue', 'form', 'ramp', 'powerCurve', 'ef', 'drift', 'hrv', 'readiness', 'effort', 'runLoad'];

/** The hover text on each readiness row on Today. */
export const READINESS_HELP: Record<string, string> = {
  HRV: GLOSSARY.hrv.short,
  Sleep: GLOSSARY.sleep.short,
  'Resting HR': GLOSSARY.restingHr.short,
  Form: 'Fitness minus fatigue. Negative while building, positive when fresh; +5 to +20 is the window for an event.',
};
