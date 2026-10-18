import type { StreamSet } from '../data/db';
import { downsample, type Analysis } from '../engine/analysis';
import { ZONE_VAR } from './Profile';
import { powerZone } from '../engine/zones';

/**
 * The ride as it happened: power (or heart rate) through time, with the planned
 * targets drawn as a stepped band underneath when the ride had a plan.
 */
export function RideTrace({ streams, analysis, ftp, basis }: { streams: StreamSet; analysis?: Analysis; ftp: number; basis: 'power' | 'hr' }) {
  const series = basis === 'power' ? streams.watts : streams.heartrate;
  if (!series || !streams.time.length) return <div class="empty small">No {basis === 'power' ? 'power' : 'heart-rate'} data in this recording.</div>;
  const pts = downsample(streams.time, series, 420);
  if (pts.length < 2) return null;
  const W = 420, H = 150, pad = 4;
  const span = streams.time[streams.time.length - 1] || 1;
  const top = Math.max(...pts.map((p) => p.v), ...(analysis?.steps.map((s) => s.targetHigh) ?? [0])) * 1.1;
  const x = (t: number) => pad + (t / span) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / top) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts[pts.length - 1].t).toFixed(1)} ${H - pad} L${x(pts[0].t).toFixed(1)} ${H - pad} Z`;
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} aria-label="Ride trace">
        {analysis?.steps.map((s) => {
          const zone = basis === 'power' ? powerZone(((s.targetLow + s.targetHigh) / 2) / ftp) : 2;
          return <rect key={s.index} x={x(s.startSec)} y={y(s.targetHigh)} width={Math.max(0.5, x(s.endSec) - x(s.startSec))} height={Math.max(2, y(s.targetLow) - y(s.targetHigh))} fill={ZONE_VAR[zone - 1]} fill-opacity="0.28" />;
        })}
        {basis === 'power' && <line x1={pad} x2={W - pad} y1={y(ftp)} y2={y(ftp)} stroke="var(--line-2)" stroke-dasharray="3 4" />}
        <path d={area} fill="var(--ink)" fill-opacity="0.08" />
        <path d={line} fill="none" stroke="var(--ink)" stroke-width="1.1" />
      </svg>
      <div class="row faint small" style="gap:14px;margin-top:6px">
        <span>— {basis === 'power' ? 'power' : 'heart rate'} as ridden</span>
        {analysis && <span>▮ planned target bands</span>}
        {basis === 'power' && <span>- - FTP</span>}
      </div>
    </div>
  );
}
