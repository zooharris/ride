import { breathRatePlateau } from './breathThresholds';

/**
 * Diagnostics brief, Part C (7 Nov 2026): the ride's breathing at its height, when a strap was worn: the highest
 * 30-second ventilation and breathing rate. When the readings showed a plateau (the sensor's ceiling, read from the ride), the rate reads "N+".
 */
export function breathNumbers(s: { ve?: Array<number | null | undefined>; br?: Array<number | null | undefined> } | null | undefined): Array<[string, string | number | undefined, string?]> {
  if (!s?.ve?.some((v) => v != null && v > 0)) return [];
  const top30 = (xs: Array<number | null | undefined> | undefined) => {
    if (!xs) return undefined;
    let best: number | undefined;
    for (let i = 0; i + 30 <= xs.length; i += 5) {
      const w = xs.slice(i, i + 30).filter((x): x is number => x != null && isFinite(x) && x > 0);
      if (w.length >= 15) { const m = w.reduce((a, b) => a + b, 0) / w.length; if (best == null || m > best) best = m; }
    }
    return best;
  };
  const ve = top30(s.ve), br = top30(s.br);
  const plateau = s.br ? breathRatePlateau(s.br) : undefined;
  return [
    ['Highest breathing', ve != null ? `${Math.round(ve)} L/min` : undefined, 'The most air you breathed in any 30 seconds, from your breathing strap'],
    ['Highest breathing rate', plateau != null ? `${Math.round(plateau)}+ a minute` : br != null ? `${Math.round(br)} a minute` : undefined, plateau != null ? `Your strap’s readings stopped climbing at ${Math.round(plateau)} a minute, so the true rate was at least that` : 'The most breaths a minute in any 30 seconds'],
  ];
}

