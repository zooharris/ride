import { useEffect, useState } from 'preact/hooks';
import { db, STREAMS_VERSION } from '../data/db';
import { buildThumb, THUMB_VERSION, type Thumb } from '../data/thumbs';
import type { Profile, Ride, Workout } from '../engine/types';
import { hrZone, powerZone, rideHrZones, ridePowerZones } from '../engine/zones';
import { credentials } from '../sync/syncService';
import { fetchThumbStreams } from '../sync/intervals';
import { ZONE_VAR } from './Profile';
import { KindDot } from './screens/Plan';
import { picturesFor } from '../art/pictures';
import { useWidth } from './useWidth';

/* ---------- getting an activity's picture: from this device, else once from Intervals.icu ---------- */

const pictured = (r: Ride) => !r.notTraining && r.sport !== 'strength' && r.sport !== 'mobility';
const memo = new Map<string, Thumb | null>();
const waiting = new Map<string, Set<(t: Thumb | null) => void>>();
const failed = new Set<string>();
const queue: string[] = [];
let running = 0;
const PARALLEL = 2;

function settle(id: string, t: Thumb | null) {
  memo.set(id, t);
  waiting.get(id)?.forEach((fn) => fn(t));
  waiting.delete(id);
}

async function load(id: string): Promise<Thumb | null> {
  const kept = await db.thumbs.get(id);
  if (kept && kept.v === THUMB_VERSION) return kept;
  // A recording already opened on this device has everything needed.
  const st = await db.streams.get(id);
  if (st && st.v === STREAMS_VERSION) { const t = buildThumb(id, st); await db.thumbs.put(t); return t; }
  const c = await credentials();
  if (!c) return null;
  const t = buildThumb(id, await fetchThumbStreams(c, id));
  await db.thumbs.put(t);
  return t;
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const id = queue.shift()!;
    running++;
    load(id).then((t) => settle(id, t)).catch(() => { failed.add(id); settle(id, null); }).finally(() => { running--; pump(); });
  }
}

/** The picture for a done activity; undefined while it is being fetched, null when there is none to be had. */
export function useThumb(r: Ride | undefined): Thumb | null | undefined {
  const id = r && pictured(r) ? r.id : undefined;
  const [t, setT] = useState<Thumb | null | undefined>(id ? memo.get(id) : null);
  useEffect(() => {
    if (!id) { setT(null); return; }
    if (memo.has(id)) { setT(memo.get(id)); return; }
    if (failed.has(id)) { setT(null); return; }
    setT(undefined);
    let alive = true;
    const fn = (x: Thumb | null) => { if (alive) setT(x); };
    if (!waiting.has(id)) { waiting.set(id, new Set()); queue.push(id); pump(); }
    waiting.get(id)!.add(fn);
    return () => { alive = false; waiting.get(id)?.delete(fn); };
  }, [id]);
  return t;
}

/* ---------- the pictures ---------- */

const TILE = 256;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

/** The route on a soft map: OpenStreetMap tiles (kept offline by the app once seen) with the track drawn over them. */
export function RouteThumb({ route, height, width }: { route: Array<[number, number]>; height: number; width?: number }) {
  const [ref, measured] = useWidth<HTMLDivElement>(width ?? 160);
  const W = width ?? measured;
  const H = height;
  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.12));
  const lats = route.map((p) => p[0]), lngs = route.map((p) => p[1]);
  const [n, s, w, e] = [Math.max(...lats), Math.min(...lats), Math.min(...lngs), Math.max(...lngs)];
  let z = 16;
  for (; z > 3; z--) {
    if (worldX(e, z) - worldX(w, z) <= W - 2 * pad && worldY(s, z) - worldY(n, z) <= H - 2 * pad) break;
  }
  const cx = (worldX(w, z) + worldX(e, z)) / 2, cy = (worldY(n, z) + worldY(s, z)) / 2;
  const ox = cx - W / 2, oy = cy - H / 2;
  const tiles: Array<{ x: number; y: number; left: number; top: number }> = [];
  const max = 2 ** z;
  for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++) {
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + H) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue;
      tiles.push({ x: ((tx % max) + max) % max, y: ty, left: tx * TILE - ox, top: ty * TILE - oy });
    }
  }
  const pts = route.map(([a, b]) => `${(worldX(b, z) - ox).toFixed(1)},${(worldY(a, z) - oy).toFixed(1)}`).join(' ');
  const [sx, sy] = pts.split(' ')[0].split(',');
  return (
    <div class="route-thumb" ref={ref} style={`height:${H}px${width ? `;width:${width}px` : ''}`} aria-hidden="true">
      <div class="rt-tiles">
        {tiles.map((t) => <img key={`${t.x}-${t.y}`} src={TILE_URL(z, t.x, t.y)} alt="" width={TILE} height={TILE} loading="lazy" decoding="async" style={`left:${t.left}px;top:${t.top}px`} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />)}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polyline points={pts} fill="none" stroke="var(--rt-halo)" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" />
        <polyline points={pts} fill="none" stroke="var(--rt-line)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx={sx} cy={sy} r="2.8" fill="var(--good)" stroke="var(--rt-halo)" stroke-width="1.2" />
      </svg>
    </div>
  );
}

/** The effort through a ride without a route: power (or heart rate) in even slices of time, each coloured by its zone, in the style of the ride diagrams. */
export function EffortThumb({ thumb, profile, height }: { thumb: NonNullable<Thumb['profile']>; profile: Profile; height: number }) {
  const v = thumb.values, N = v.length;
  const threshold = thumb.basis === 'power' ? profile.ftp : profile.lthr;
  if (!threshold || !N) return null;
  const zones = thumb.basis === 'power' ? ridePowerZones(profile) : rideHrZones(profile);
  const top = Math.max(threshold * (thumb.basis === 'power' ? 1.25 : 1.08), ...v);
  const floor = thumb.basis === 'hr' ? threshold * 0.55 : 0;   // heart rate never falls to zero: start the scale where easy riding sits
  return (
    <div class="profile effort-thumb" aria-hidden="true">
      <svg viewBox={`0 0 ${N} ${height}`} preserveAspectRatio="none" style={`height:${height}px`}>
        <line x1="0" x2={N} y1={height - ((threshold - floor) / (top - floor)) * height} y2={height - ((threshold - floor) / (top - floor)) * height} stroke="var(--line-2)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" />
        {v.map((x, i) => {
          if (!x) return null;
          const h = Math.max(1.5, ((x - floor) / (top - floor)) * height);
          const zone = thumb.basis === 'power' ? powerZone(x / threshold, zones) : hrZone(x / threshold, zones);
          return <rect key={i} x={i} y={height - h} width={1.04} height={h} fill={ZONE_VAR[zone - 1]} />;
        })}
      </svg>
    </div>
  );
}

/** Up to `max` start pictures of a session's exercises, then "+N". */
export function ExerciseRow({ w, max }: { w?: Workout; max: number }) {
  const pics = (w?.exercises ?? []).map((e) => ({ name: e.name, src: picturesFor(e.name).a })).filter((p): p is { name: string; src: string } => !!p.src);
  if (!pics.length) return null;
  const more = pics.length - max;
  return (
    <span class="ex-row" aria-hidden="true">
      {pics.slice(0, max).map((p, i) => <span class="ex-tile" key={i} title={p.name}><img src={p.src} alt="" width={80} height={80} loading="lazy" decoding="async" /></span>)}
      {more > 0 && <span class="ex-tile ex-more">+{more}</span>}
    </span>
  );
}

/**
 * The picture of a done activity: its route on a map, else its effort profile,
 * else its exercises (strength and mobility), else the kind's tile. `width`
 * fixes the size (list rows); without it the picture fills its box (month cells).
 */
export function ActivityPicture({ ride, w, profile, height, width, exMax = 3 }: { ride: Ride; w?: Workout; profile: Profile; height: number; width?: number; exMax?: number }) {
  const t = useThumb(ride);
  const kind = ride.sport === 'other' ? 'ride' : ride.sport;
  if (ride.sport === 'strength' || ride.sport === 'mobility') {
    const row = <ExerciseRow w={w} max={exMax} />;
    if (w?.exercises?.some((e) => picturesFor(e.name).a)) return <span class="act-pic ex" style={width ? `width:${width}px` : ''}>{row}</span>;
    return width ? <span class="act-pic" style={`width:${width}px;height:${height}px`}><KindDot kind={kind} big /></span> : null;
  }
  if (t === undefined) return <span class="act-pic skeleton" style={`height:${height}px${width ? `;width:${width}px` : ''}`} />;
  if (t?.route) return <span class="act-pic" style={width ? `width:${width}px` : ''}><RouteThumb route={t.route} height={height} width={width} /></span>;
  if (t?.profile) return <span class="act-pic eff" style={`height:${height}px${width ? `;width:${width}px` : ''}`}><EffortThumb thumb={t.profile} profile={profile} height={height - 6} /></span>;
  return width ? <span class="act-pic" style={`width:${width}px;height:${height}px`}><KindDot kind={kind} big /></span> : null;
}
