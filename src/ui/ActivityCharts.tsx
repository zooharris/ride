import { useMemo, useState } from 'preact/hooks';
import { useWidth } from './useWidth';
import type { StreamSet } from '../data/db';
import type { Analysis } from '../engine/analysis';
import type { Profile, SessionKind } from '../engine/types';
import { ZONE_VAR } from './Profile';
import { hrZone, powerZone } from '../engine/zones';
import { clock } from '../engine/workout';

/** One evenly spaced sample of the recording, so every chart and the map share an index. */
export interface Sample { t: number; d: number; watts?: number; hr?: number; cad?: number; speed?: number; alt?: number; temp?: number; lat?: number; lng?: number }

export function resample(s: StreamSet, points = 600): Sample[] {
  const n = s.time.length;
  if (n < 2) return [];
  const span = s.time[n - 1] || 1;
  const bucket = Math.max(1, span / points);
  const out: Sample[] = [];
  const acc = { watts: [0, 0], hr: [0, 0], cad: [0, 0], speed: [0, 0], alt: [0, 0], temp: [0, 0] } as Record<string, [number, number]>;
  const addTo = (k: string, v: number | undefined) => { if (typeof v === 'number' && !Number.isNaN(v)) { acc[k][0] += v; acc[k][1]++; } };
  let b = 0, lastI = 0;
  const flush = (i: number) => {
    const mean = (k: string) => (acc[k][1] ? acc[k][0] / acc[k][1] : undefined);
    out.push({ t: s.time[i], d: s.distance?.[i] ?? 0, watts: mean('watts'), hr: mean('hr'), cad: mean('cad'), speed: mean('speed'), alt: mean('alt'), temp: mean('temp'), lat: s.lat?.[i], lng: s.lng?.[i] });
    for (const k of Object.keys(acc)) acc[k] = [0, 0];
  };
  for (let i = 0; i < n; i++) {
    const k = Math.floor(s.time[i] / bucket);
    if (k !== b) { flush(lastI); b = k; }
    addTo('watts', s.watts?.[i]); addTo('hr', s.heartrate?.[i]); addTo('cad', s.cadence?.[i]); addTo('speed', s.velocity?.[i]); addTo('alt', s.altitude?.[i]); addTo('temp', s.temp?.[i]);
    lastI = i;
  }
  flush(lastI);
  return out;
}

type Axis = 'time' | 'distance';

/**
 * The recording as stacked charts that share one cursor: power, heart rate,
 * cadence, speed and elevation against time or distance, with labelled axes
 * and a readout of every value under the cursor. The same cursor index drives
 * the route map, so the parent owns it.
 */
export function ActivityCharts({ samples, targets, profile, hover, onHover, kind = 'ride', indoor = false }: { samples: Sample[]; targets?: { watts?: Analysis; hr?: Analysis }; profile: Profile; hover: number | null; onHover: (i: number | null) => void; kind?: SessionKind; indoor?: boolean }) {
  const ride = kind === 'ride';
  const onFoot = kind === 'walk' || kind === 'other';
  // By distance suits a ride on the road; walks (often on a treadmill), strength, mobility and indoor rides read by time.
  const timeFirst = kind === 'walk' || kind === 'strength' || kind === 'mobility' || (ride && indoor);
  const [axis, setAxis] = useState<Axis>(() => (!timeFirst && samples.some((s) => s.d > 0) ? 'distance' : 'time'));
  const imperial = profile.units === 'imperial';
  const hasDist = samples.some((s) => s.d > 0);
  const xOf = (p: Sample) => (axis === 'distance' && hasDist ? p.d : p.t);
  const xMax = Math.max(1, ...samples.map(xOf));
  const fmtX = (v: number) => (axis === 'distance' && hasDist ? `${(imperial ? v / 1609.344 : v / 1000).toFixed(1)} ${imperial ? 'mi' : 'km'}` : clock(Math.round(v)));
  const h = hover != null ? samples[hover] : null;
  const panels = useMemo(() => {
    const list: Array<{ key: string; title: string; unit: string; color: string; get: (p: Sample) => number | undefined; area?: boolean; explain: string; refs?: Array<{ v: number; label: string }> }> = [];
    if (ride && samples.some((s) => s.watts != null)) list.push({ key: 'watts', title: 'Power', unit: 'W', color: 'var(--ink)', get: (p) => p.watts, explain: 'Watts at the pedals, smoothed to the chart’s resolution. The dashed line is your FTP; shaded bands are planned targets when the ride was from a plan.', refs: [{ v: profile.ftp, label: `FTP ${profile.ftp}` }] });
    if (samples.some((s) => s.hr != null)) list.push({ key: 'hr', title: 'Heart rate', unit: 'bpm', color: 'var(--z5)', get: (p) => p.hr, explain: ride ? 'Beats per minute. The dashed line is your threshold heart rate; shaded bands are the heart-rate equivalents of the planned targets when the ride was from a plan.' : 'Beats per minute. The dashed line is your threshold heart rate.', refs: profile.lthr ? [{ v: profile.lthr, label: `threshold ${profile.lthr}` }] : [] });
    if (ride && samples.some((s) => s.cad != null)) list.push({ key: 'cad', title: 'Cadence', unit: 'rpm', color: 'var(--z3)', get: (p) => p.cad, explain: 'Pedal revolutions per minute; gaps are coasting.' });
    if ((ride || onFoot) && samples.some((s) => s.speed != null)) list.push({ key: 'speed', title: ride ? 'Speed' : 'Walking speed', unit: imperial ? 'mph' : 'km/h', color: 'var(--z4)', get: (p) => (p.speed == null ? undefined : imperial ? p.speed * 2.23694 : p.speed * 3.6), explain: ride ? 'Ground speed from GPS or the wheel sensor.' : 'Ground speed from GPS or the watch.' });
    if ((ride || onFoot) && samples.some((s) => s.alt != null)) list.push({ key: 'alt', title: 'Elevation', unit: imperial ? 'ft' : 'm', color: 'var(--ink-3)', get: (p) => (p.alt == null ? undefined : imperial ? p.alt * 3.28084 : p.alt), area: true, explain: 'Height above sea level along the route.' });
    if (samples.some((s) => s.temp != null)) list.push({ key: 'temp', title: 'Temperature', unit: imperial ? '°F' : '°C', color: 'var(--z1)', get: (p) => (p.temp == null ? undefined : imperial ? p.temp * 1.8 + 32 : p.temp), explain: 'As measured by the head unit; it lags the air by a few minutes.' });
    return list;
  }, [samples, profile.ftp, profile.lthr, imperial, kind]);

  if (samples.length < 2) return <div class="empty small">No recording to draw.</div>;

  return (
    <div>
      <div class="row between wrap" style="gap:8px;margin-bottom:8px">
        <div class="seg">
          <button class={axis === 'time' ? 'on' : ''} onClick={() => setAxis('time')}>By time</button>
          <button class={axis === 'distance' ? 'on' : ''} onClick={() => setAxis('distance')} disabled={!hasDist} title={hasDist ? '' : 'No distance in this recording'}>By distance</button>
        </div>
      </div>
      <div class="rec-readout panel small" aria-live="off">
        {h ? <>
          <b class="num">{fmtX(xOf(h))}</b>
          {panels.map((p) => { const v = p.get(h); return v == null ? null : <span key={p.key}><span class="faint">{p.title}</span> <b class="num">{p.key === 'speed' ? v.toFixed(1) : Math.round(v)}</b> <span class="faint">{p.unit}</span></span>; })}
        </> : <span class="faint">Move the mouse, or a finger, across any chart to read every value at that point; the map follows.</span>}
      </div>
      <div class="stack" style="gap:4px">
        {panels.map((p, idx) => (
          <Panel key={p.key} samples={samples} panel={p} xOf={xOf} xMax={xMax} fmtX={fmtX} hover={hover} onHover={onHover} analysis={p.key === 'watts' ? targets?.watts : p.key === 'hr' ? targets?.hr : undefined} ftp={profile.ftp} lthr={profile.lthr} basis={p.key === 'watts' ? 'power' : 'hr'} showXAxis={idx === panels.length - 1} />
        ))}
      </div>
    </div>
  );
}

/**
 * One channel of the recording. Drawn at its real pixel width with a fixed,
 * compact height, so a wide window shows more of the ride rather than taller
 * charts, and the text stays the same size at any width.
 */
function Panel({ samples, panel, xOf, xMax, fmtX, hover, onHover, analysis, ftp, lthr, basis, showXAxis }: {
  samples: Sample[]; panel: { title: string; unit: string; color: string; get: (p: Sample) => number | undefined; area?: boolean; explain: string; refs?: Array<{ v: number; label: string }> };
  xOf: (p: Sample) => number; xMax: number; fmtX: (v: number) => string; hover: number | null; onHover: (i: number | null) => void; analysis?: Analysis; ftp: number; lthr: number; basis: 'power' | 'hr'; showXAxis: boolean;
}) {
  const [box, W] = useWidth(480);
  const H = showXAxis ? 86 : 66, padL = 34, padR = 6, padT = 6, padB = showXAxis ? 18 : 4;
  const vals = samples.map(panel.get);
  const present = vals.filter((v): v is number => v != null);
  // Power starts at zero (coasting is real); heart rate, cadence, speed and elevation start just under
  // their own low end, so the trace uses the chart's height instead of floating in the top third.
  const floorAtZero = panel.title === 'Power';
  const sorted = floorAtZero ? [] : [...present].sort((a, b) => a - b);
  const low = sorted.length ? sorted[Math.floor(sorted.length * 0.02)] : 0;
  const lo = floorAtZero ? 0 : Math.max(0, low - Math.max(2, (Math.max(...present) - low) * 0.12));
  const hi0 = Math.max(...present, ...(panel.refs?.map((r) => r.v) ?? []), ...(analysis ? analysis.steps.map((s) => s.targetHigh) : []));
  const hi = hi0 <= lo ? lo + 1 : hi0 + (hi0 - lo) * 0.08;
  const x = (v: number) => padL + (v / xMax) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  let d = '';
  samples.forEach((p, i) => { const v = vals[i]; if (v == null) return; d += `${d && vals[i - 1] != null ? 'L' : 'M'}${x(xOf(p)).toFixed(1)} ${y(Math.max(lo, v)).toFixed(1)}`; });
  const area = panel.area ? `M${x(xOf(samples[0])).toFixed(1)} ${H - padB} ${samples.map((p, i) => `L${x(xOf(p)).toFixed(1)} ${y(vals[i] ?? lo).toFixed(1)}`).join(' ')} L${x(xOf(samples[samples.length - 1])).toFixed(1)} ${H - padB} Z` : '';
  const step = (() => { const raw = (hi - lo) / 2; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const r = raw / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p; })();
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => f * xMax);
  const byTime = analysis ? (sec: number) => { // planned bands are in seconds; map through the sample nearest that time
    let best = 0; for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i].t - sec) < Math.abs(samples[best].t - sec)) best = i; return x(xOf(samples[best]));
  } : null;
  const hv = hover != null ? vals[hover] : undefined;
  // Mouse or finger position → nearest sample along the x axis. Touch keeps the cursor where it was left.
  const pick = (svg: SVGSVGElement, clientX: number) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const xv = ((px - padL) / (W - padL - padR)) * xMax;
    let best = 0;
    for (let i = 0; i < samples.length; i++) if (Math.abs(xOf(samples[i]) - xv) < Math.abs(xOf(samples[best]) - xv)) best = i;
    onHover(best);
  };
  return (
    <div style="position:relative" ref={box}>
      <div class="row between" style="margin-bottom:0"><span class="small" title={panel.explain}><b>{panel.title}</b> <span class="faint">({panel.unit})</span></span>{hv != null && <span class="num small" style="color:var(--ink-2)">{panel.unit === 'mph' || panel.unit === 'km/h' ? hv.toFixed(1) : Math.round(hv)} {panel.unit}</span>}</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style="display:block;width:100%;touch-action:pan-y" aria-label={`${panel.title} chart`}
        onMouseMove={(e) => pick(e.currentTarget as SVGSVGElement, e.clientX)}
        onMouseLeave={() => onHover(null)}
        onTouchStart={(e) => pick(e.currentTarget as SVGSVGElement, e.touches[0].clientX)}
        onTouchMove={(e) => pick(e.currentTarget as SVGSVGElement, e.touches[0].clientX)}>
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={padL - 4} y={y(t) + 3} fill="var(--ink-3)" font-size="10" text-anchor="end">{Math.round(t)}</text></g>)}
        {showXAxis && xt.map((v, i) => <text key={i} x={x(v)} y={H - 4} fill="var(--ink-3)" font-size="10" text-anchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{fmtX(v)}</text>)}
        {analysis && byTime && analysis.steps.map((s) => {
          const zone = basis === 'power' ? powerZone(((s.targetLow + s.targetHigh) / 2) / ftp) : hrZone(((s.targetLow + s.targetHigh) / 2) / (lthr || 1));
          const x1 = byTime(s.startSec), x2 = byTime(s.endSec);
          return <rect key={s.index} x={x1} y={y(Math.min(hi, s.targetHigh))} width={Math.max(0.5, x2 - x1)} height={Math.max(2, y(s.targetLow) - y(Math.min(hi, s.targetHigh)))} fill={ZONE_VAR[zone - 1]} fill-opacity="0.28" />;
        })}
        {panel.refs?.map((r) => <g key={r.label}><line x1={padL} x2={W - padR} y1={y(r.v)} y2={y(r.v)} stroke="var(--line-2)" stroke-dasharray="3 4" /><text x={W - padR - 2} y={y(r.v) - 2} fill="var(--ink-3)" font-size="10" text-anchor="end">{r.label}</text></g>)}
        {area && <path d={area} fill={panel.color} fill-opacity="0.18" />}
        <path d={d} fill="none" stroke={panel.color} stroke-width="1.4" stroke-linejoin="round" />
        {hover != null && <line x1={x(xOf(samples[hover]))} x2={x(xOf(samples[hover]))} y1={padT} y2={H - padB} stroke="var(--accent)" />}
        {hover != null && hv != null && <circle cx={x(xOf(samples[hover]))} cy={y(hv)} r="3" fill="var(--accent)" />}
      </svg>
    </div>
  );
}
