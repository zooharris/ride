/**
 * Obsidian, the seasonal look (12 Nov 2026). The graphite surfaces are fixed all
 * year; three colours change with the season and the logo takes them. By night
 * the three are used as they are; by day they are darkened so they can sit on a
 * light page. Every role is then checked against the contrast standard and
 * nudged darker (by day) or lighter (by night) until it passes, so no season can
 * ship an unreadable colour.
 *
 * Nothing here knows who the rider is or where: the season comes from the date,
 * the hemisphere from the device's time zone unless the rider sets it.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type SeasonChoice = 'auto' | Season;
export type Hemisphere = 'north' | 'south';
export type Mode = 'dark' | 'light';

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Lead, second, third. */
export const SEASON_COLOURS: Record<Season, [string, string, string]> = {
  spring: ['#5FD38D', '#36C2CE', '#F58CB0'],
  summer: ['#3BA4FF', '#2ED3C4', '#FFD23F'],
  autumn: ['#F59E0B', '#F4745E', '#E85D9E'],
  winter: ['#8FB8FF', '#7C83F7', '#C59BFF'],
};

/** The fixed graphite surfaces the seasonal colours are checked against. */
export const SURFACES: Record<Mode, { bgBase: string; panel: string; sub: string; ink: string; inkOnAccent: string }> = {
  light: { bgBase: '#ECEEF1', panel: '#FAFBFC', sub: '#F2F4F7', ink: '#14181F', inkOnAccent: '#FFFFFF' },
  dark: { bgBase: '#0B0E14', panel: '#141922', sub: '#181E29', ink: '#EEF1F6', inkOnAccent: '#0B0E14' },
};

/* ---------- which season ---------- */

/** Meteorological seasons: whole months, switching at local midnight on the 1st. */
export function seasonFor(date: Date, hemisphere: Hemisphere): Season {
  const m = date.getMonth(); // 0 = January
  const north: Season = m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
  if (hemisphere === 'north') return north;
  return ({ spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' } as const)[north];
}

/**
 * A guess from the device's time zone. Only a default: Settings can change it.
 * Zones south of the equator, by region; anything not listed is taken as northern.
 */
const SOUTH = [
  /^Australia\//, /^Antarctica\//,
  /^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea|Efate|Port_Moresby|Bougainville|Guadalcanal|Tahiti|Marquesas|Gambier|Rarotonga|Pago_Pago|Niue|Norfolk|Easter|Galapagos|Fakaofo|Wallis|Funafuti|Nauru)$/,
  /^America\/(Argentina\/.*|Buenos_Aires|Cordoba|Mendoza|Catamarca|Jujuy|Santiago|Punta_Arenas|Sao_Paulo|Rio_Branco|Porto_Velho|Manaus|Cuiaba|Campo_Grande|Belem|Fortaleza|Recife|Maceio|Bahia|Araguaina|Santarem|Noronha|Eirunepe|Porto_Acre|Montevideo|Asuncion|La_Paz|Lima|Guayaquil)$/,
  /^Atlantic\/(Stanley|South_Georgia|St_Helena)$/,
  /^Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Blantyre|Lubumbashi|Kinshasa|Brazzaville|Luanda|Dar_es_Salaam|Bujumbura|Kigali|Nairobi)$/,
  /^Indian\/(Antananarivo|Mauritius|Reunion|Mayotte|Comoro|Chagos|Kerguelen|Cocos|Christmas)$/,
  /^Asia\/(Jakarta|Makassar|Jayapura|Dili|Ujung_Pandang)$/,
  /^(NZ|NZ-CHAT|Brazil\/.*|Chile\/.*)$/,
];
export function guessHemisphere(timeZone: string | undefined): Hemisphere {
  if (!timeZone) return 'north';
  return SOUTH.some((r) => r.test(timeZone)) ? 'south' : 'north';
}
export function deviceTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
}

export function activeSeason(choice: SeasonChoice, hemisphere: Hemisphere, now: Date = new Date()): Season {
  return choice === 'auto' ? seasonFor(now, hemisphere) : choice;
}

/* ---------- colour arithmetic ---------- */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function hex(c: number[]): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** a at p% over b, as CSS color-mix in srgb would give. */
export function mix(a: string, p: number, b: string): string {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((v, i) => v * p / 100 + y[i] * (100 - p) / 100));
}
function lum(h: string): number {
  return rgb(h).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a: string, b: string): number {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Darken toward black (day) or lighten toward white (night) in small steps until it reaches `need` against every background. */
function fit(colour: string, against: string[], need: number, mode: Mode): string {
  let c = colour;
  for (let i = 0; i < 60 && against.some((b) => contrast(c, b) < need); i++) c = mix(c, 96, mode === 'light' ? '#000000' : '#FFFFFF');
  return c;
}

/* ---------- the palette for one season, by day or by night ---------- */

export type SeasonVars = Record<string, string>;

/**
 * The CSS custom properties that change with the season. Everything else
 * (graphite surfaces, zones, every session kind including rides, good/warning/bad)
 * lives in the stylesheet and never changes: a seasonal ride colour would come too
 * close to a fixed kind (spring green to mobility, autumn amber to walks).
 */
export function seasonVars(season: Season, mode: Mode): SeasonVars {
  const [lead, second, third] = SEASON_COLOURS[season];
  const S = SURFACES[mode];
  const day = mode === 'light';
  const bg = day ? mix(lead, 5, S.bgBase) : mix(lead, 4, S.bgBase);
  const surfaces = [S.panel, S.sub, bg];
  // Accent: the main button, links, focus. Its own text must read on it, and it must read as a link on panels.
  let accent = day ? mix(lead, 54, '#000000') : lead;
  accent = fit(accent, surfaces, 4.5, mode);
  if (contrast(S.inkOnAccent, accent) < 4.5) accent = fit(accent, [S.inkOnAccent], 4.5, day ? 'light' : 'dark');
  const wash = mix(accent, 15, S.panel);
  const selInk = fit(day ? mix(lead, 46, '#000000') : mix(lead, 70, '#FFFFFF'), [wash, S.panel], 4.5, mode);
  // Data colours: lines, bars, dots. 3 to 1 against what they are drawn on.
  const info = fit(day ? mix(lead, 84, '#000000') : lead, surfaces, 3, mode);
  const fat = fit(day ? mix(second, 84, '#000000') : second, surfaces, 3, mode);
  const aqua = fit(day ? mix(third, 80, '#000000') : third, surfaces, 3, mode);
  // Today and attention: used as text, so 4.5.
  const today = fit(day ? mix(third, 58, '#000000') : third, surfaces, 4.5, mode);
  // The logo takes the season. The wordmark's own ink is fixed.
  const logo = day
    ? { teal: mix(second, 86, '#000000'), blue: mix(lead, 86, '#000000'), orange: mix(third, 86, '#000000'), anto: '#14181F', go: mix(lead, 66, '#000000'), tag: '#677080' }
    : { teal: second, blue: lead, orange: third, anto: '#EEF1F6', go: lead, tag: '#8B94A6' };
  return {
    '--bg': bg,
    '--accent': accent,
    '--accent-ink': S.inkOnAccent,
    '--sel-ink': selInk,
    '--info': info,
    '--fat': fat,
    '--aqua': aqua,
    '--today': today,
    '--brand-blue': info,
    '--rt-line': info,
    '--logo-teal': logo.teal,
    '--logo-blue': logo.blue,
    '--logo-orange': logo.orange,
    '--logo-anto': logo.anto,
    '--logo-go': logo.go,
    '--logo-tag': logo.tag,
  };
}

/** The colour the phone's status bar takes: the top bar is a graphite panel. */
export function statusBarColour(mode: Mode): string {
  return SURFACES[mode].panel;
}

export const SEASON_NAME: Record<Season, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
