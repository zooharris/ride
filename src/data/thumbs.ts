/**
 * The small picture of a done activity, for the calendar and the activity
 * lists: the route's shape when it was recorded with GPS, and the effort
 * through the ride (power, else heart rate) for anything without a route.
 * Built once from the recording and kept on this device only; it is never
 * synced or backed up, since it can always be rebuilt from Intervals.icu.
 */
export const THUMB_VERSION = 1;

export interface Thumb {
  id: string;
  v: number;
  /** The route as [lat, lng] pairs, simplified to a couple of hundred points at most. */
  route?: Array<[number, number]>;
  /** The effort through the activity in even slices of time. */
  profile?: { basis: 'power' | 'hr'; values: number[] };
}

export interface ThumbSource { time: number[]; watts?: number[]; heartrate?: number[]; lat?: number[]; lng?: number[] }

const SLICES = 60;
const MAX_ROUTE = 220;

export function buildThumb(id: string, s: ThumbSource): Thumb {
  const t: Thumb = { id, v: THUMB_VERSION };
  const route = routeOf(s.lat, s.lng);
  if (route) t.route = route;
  const profile = profileOf(s);
  if (profile) t.profile = profile;
  return t;
}

function routeOf(lat?: number[], lng?: number[]): Array<[number, number]> | undefined {
  if (!lat?.length || !lng?.length) return undefined;
  let pts: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(lat.length, lng.length); i++) {
    const a = lat[i], b = lng[i];
    if (typeof a !== 'number' || typeof b !== 'number' || !isFinite(a) || !isFinite(b) || (a === 0 && b === 0) || Math.abs(a) > 85) continue;
    pts.push([a, b]);
  }
  if (pts.length < 2) return undefined;
  // A treadmill or trainer that logged a fixed position is not a route.
  const [minA, maxA, minB, maxB] = pts.reduce(([a0, a1, b0, b1], [a, b]) => [Math.min(a0, a), Math.max(a1, a), Math.min(b0, b), Math.max(b1, b)], [90, -90, 180, -180]);
  if (maxA - minA < 0.0008 && maxB - minB < 0.0008) return undefined;
  if (pts.length > 4000) { const step = Math.ceil(pts.length / 4000); pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1); }
  const diag = Math.hypot(maxA - minA, (maxB - minB) * Math.cos(((minA + maxA) / 2) * Math.PI / 180));
  let tol = diag * 0.003;
  let out = simplify(pts, tol);
  while (out.length > MAX_ROUTE) { tol *= 1.6; out = simplify(pts, tol); }
  return out.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
}

/** Douglas–Peucker, iterative so a long ride cannot overflow the stack. */
function simplify(pts: Array<[number, number]>, tol: number): Array<[number, number]> {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = pts[s], [bx, by] = pts[e];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1, at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol && at > 0) { keep[at] = 1; stack.push([s, at], [at, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function profileOf(s: ThumbSource): Thumb['profile'] {
  const pick = (arr: number[] | undefined) => (arr && arr.filter((v) => v > 0).length >= Math.max(10, arr.length * 0.2) ? arr : undefined);
  const watts = pick(s.watts);
  const values = watts ?? pick(s.heartrate);
  if (!values) return undefined;
  const n = values.length;
  const slices = Math.min(SLICES, n);
  const out: number[] = [];
  for (let k = 0; k < slices; k++) {
    const a = Math.floor((k * n) / slices), b = Math.max(a + 1, Math.floor(((k + 1) * n) / slices));
    let sum = 0, cnt = 0;
    for (let i = a; i < b; i++) { const v = values[i]; if (typeof v === 'number' && v > 0) { sum += v; cnt++; } }
    out.push(cnt ? Math.round(sum / cnt) : 0);
  }
  return { basis: watts ? 'power' : 'hr', values: out };
}
