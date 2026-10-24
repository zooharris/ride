import type { StreamSet } from '../data/db';
import { clock } from '../engine/workout';
import { HR_ZONES, POWER_ZONES, hrZone, powerZone, type Zone } from '../engine/zones';
import { powerHistogram } from '../engine/progress';
import { BarChart } from './BarChart';
import { ZONE_VAR } from './Profile';
import { ZONE_NAMES } from './glossary';

/** Time in each zone as a row of labelled bars: zone, bar, share and time. */
export function ZoneBars({ title, seconds }: { title: string; seconds: number[] }) {
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(1, ...seconds);
  return (
    <div class="zonebars">
      <div class="small" style="margin-bottom:6px"><b>{title}</b></div>
      {seconds.map((s, i) => (
        <div class="zb-row" key={i} title={`Zone ${i + 1}, ${ZONE_NAMES[Math.min(i, 6)]}: ${clock(s)}, ${Math.round((s / total) * 100)}% of the time`}>
          <span class="zb-z">Z{i + 1}</span>
          <span class="zb-track"><span class="zb-fill" style={`width:${(s / max) * 100}%;background:${ZONE_VAR[Math.min(i, 6)]}`} /></span>
          <span class="zb-pct num">{Math.round((s / total) * 100)}%</span>
          <span class="zb-t faint">{s >= 60 ? clock(s) : s > 0 ? `${s}s` : '–'}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The laps you pressed and the efforts Intervals.icu found. Each bar is the
 * lap's average power against your FTP (the tick on every track), coloured by
 * the power zone it falls in, so a lap's effort reads without the numbers.
 * Without power, the bar is heart rate against threshold heart rate.
 */
export function LapsTable({ intervals, ftp, lthr, hrZones = HR_ZONES, powerZones = POWER_ZONES, heartRateOnly = false, distance, time, imperial = false }: { intervals: NonNullable<StreamSet['intervals']>; ftp: number; lthr: number; hrZones?: Zone[]; powerZones?: Zone[]; heartRateOnly?: boolean; distance?: number[]; time?: number[]; imperial?: boolean }) {
  // Runs: each lap's pace from the distance stream. A lap's start and end are seconds into the
  // recording, found in the time stream (or sample indices when there is no time stream).
  const at = (sec: number) => { if (!time?.length) return Math.max(0, Math.min(sec, (distance?.length ?? 1) - 1)); let i = 0; while (i < time.length - 1 && time[i] < sec) i++; return i; };
  const lapPace = (r: { start: number; end: number }) => {
    if (!distance?.length) return undefined;
    const d = (distance[at(r.end)] ?? 0) - (distance[at(r.start)] ?? 0);
    if (d < 20) return undefined;
    const t = Math.round((r.end - r.start) / (d / (imperial ? 1609.344 : 1000)));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const rows = intervals.filter((iv) => iv.end > iv.start);
  if (!rows.length) return null;
  const byW = !heartRateOnly && rows.some((r) => r.avgWatts) && ftp > 0;
  const showPower = !heartRateOnly && rows.some((r) => r.avgWatts);
  const ref = byW ? ftp : lthr || 1;
  const scaleTop = Math.max(ref * 1.25, ...rows.map((r) => (byW ? r.avgWatts ?? 0 : r.avgHr ?? 0)));
  const refPct = (ref / scaleTop) * 100;
  return (
    <>
      <table class="steps laps">
        <tr><td class="faint small"><span class="wide-only">#</span></td><td class="faint small">Lap</td><td class="r faint small">Time</td>{distance?.length ? <td class="r faint small">Pace (per {imperial ? 'mile' : 'km'})</td> : null}{showPower && <td class="r faint small"><span class="wide-only">Avg power</span><span class="narrow-only">Power</span></td>}<td class="r faint small"><span class="wide-only">Avg HR</span><span class="narrow-only">HR</span></td><td class="faint small lap-barcol"><span class="wide-only">{byW ? `Power against FTP ${ftp} W` : `Heart rate against threshold ${lthr} bpm`}</span><span class="narrow-only r">{byW ? '% of FTP' : '% of threshold'}</span></td></tr>
        {rows.map((r, i) => {
          const v = byW ? r.avgWatts ?? 0 : r.avgHr ?? 0;
          const zone = byW ? powerZone(v / ftp, powerZones) : hrZone(v / ref, hrZones);
          const pctOfRef = Math.round((v / ref) * 100);
          return (
            <tr key={i}>
              <td class="faint"><span class="wide-only">{i + 1}</span><span class="z lap-z" style={`background:${ZONE_VAR[zone - 1]}`} /></td>
              <td>{r.label || (r.type ? r.type.charAt(0) + r.type.slice(1).toLowerCase() : `Lap ${i + 1}`)}</td>
              <td class="r num">{clock(Math.round(r.end - r.start))}</td>
              {distance?.length ? <td class="r num">{lapPace(r) ?? '–'}</td> : null}
              {showPower && <td class="r num">{r.avgWatts ? `${Math.round(r.avgWatts)} W` : '–'}</td>}
              <td class="r num">{r.avgHr ? `${Math.round(r.avgHr)} bpm` : '–'}</td>
              <td class="lap-barcol" title={`${pctOfRef}% of ${byW ? 'FTP' : 'threshold heart rate'} · zone ${zone}`}>
                <div class="lap-cell">
                  <span class="lap-bar"><span class="zb-track"><span class="zb-fill" style={`width:${Math.min(100, (v / scaleTop) * 100)}%;background:${ZONE_VAR[zone - 1]}`} /></span><span class="lap-ref" style={`left:${refPct}%`} /></span>
                  <span class="lap-pct faint small">{pctOfRef}%</span>
                </div>
              </td>
            </tr>
          );
        })}
      </table>
      <p class="faint small" style="margin-top:8px"><span class="wide-only">Each bar is the lap's average {byW ? 'power' : 'heart rate'}, coloured by its zone; the upright tick marks {byW ? 'your FTP' : 'your threshold heart rate'}, and the figure is the lap as a share of it.</span><span class="narrow-only">The square is the lap's zone, in the colours of Time in zone above; the figure is its average {byW ? `power as a share of your FTP (${ftp} W)` : `heart rate as a share of your threshold heart rate (${lthr} bpm)`}.</span> Labels such as "Work" and "Recovery" are Intervals.icu's guess from the recording.</p>
    </>
  );
}

/** How the ride's time was spread over power, in 25 W bands coloured by zone, with FTP marked. */
export function PowerDistribution({ streams, ftp, powerZones = POWER_ZONES }: { streams: StreamSet; ftp: number; powerZones?: Zone[] }) {
  if (!streams.watts?.length) return null;
  const bins = powerHistogram(streams.time, streams.watts, 25);
  // Trim the long thin tail of sprint bands that hold almost no time.
  const total = bins.reduce((a, b) => a + b.seconds, 0) || 1;
  let lastUseful = bins.length - 1;
  while (lastUseful > 0 && bins[lastUseful].seconds / total < 0.002) lastUseful--;
  const shown = bins.slice(0, lastUseful + 1);
  if (shown.length < 2) return null;
  return (
    <BarChart
      categories={shown.map((b) => `${b.from}`)}
      series={[{ name: 'time', color: 'var(--info)', values: shown.map((b) => Math.round((b.seconds / 60) * 10) / 10) }]}
      barColor={(i) => ZONE_VAR[powerZone((shown[i].from + 12.5) / (ftp || 1), powerZones) - 1]}
      xTick={(c, i) => (i % Math.ceil(shown.length / 8) === 0 ? `${c} W` : null)}
      yTitle="minutes"
      height={150}
      markers={ftp ? [{ at: ftp / 25, label: `FTP ${ftp}`, color: 'var(--ink-2)' }] : []}
      readout={(i) => `${shown[i].from}–${shown[i].from + 25} W · ${clock(shown[i].seconds)} · ${Math.round((shown[i].seconds / total) * 100)}% of the ride`}
    />
  );
}
