import type { StreamSet } from '../data/db';
import { clock } from '../engine/workout';
import { hrZone, powerZone } from '../engine/zones';
import { powerHistogram } from '../engine/progress';
import { BarChart } from './BarChart';
import { ZONE_VAR } from './Profile';

/** Time in each zone as a row of labelled bars: zone, bar, share and time. */
export function ZoneBars({ title, seconds }: { title: string; seconds: number[] }) {
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(1, ...seconds);
  return (
    <div class="zonebars">
      <div class="small" style="margin-bottom:6px"><b>{title}</b></div>
      {seconds.map((s, i) => (
        <div class="zb-row" key={i} title={`Zone ${i + 1}: ${clock(s)}, ${Math.round((s / total) * 100)}% of the ride`}>
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
export function LapsTable({ intervals, ftp, lthr, heartRateOnly = false }: { intervals: NonNullable<StreamSet['intervals']>; ftp: number; lthr: number; heartRateOnly?: boolean }) {
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
        <tr><td class="faint small">#</td><td class="faint small">Lap</td><td class="r faint small">Time</td>{showPower && <td class="r faint small">Avg power</td>}<td class="r faint small">Avg HR</td><td class="faint small lap-barcol">{byW ? `Power against FTP ${ftp} W` : `Heart rate against threshold ${lthr} bpm`}</td></tr>
        {rows.map((r, i) => {
          const v = byW ? r.avgWatts ?? 0 : r.avgHr ?? 0;
          const zone = byW ? powerZone(v / ftp) : hrZone(v / ref);
          const pctOfRef = Math.round((v / ref) * 100);
          return (
            <tr key={i}>
              <td class="faint">{i + 1}</td>
              <td>{r.label || (r.type ? r.type.charAt(0) + r.type.slice(1).toLowerCase() : `Lap ${i + 1}`)}</td>
              <td class="r num">{clock(Math.round(r.end - r.start))}</td>
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
      <p class="faint small" style="margin-top:8px">Each bar is the lap's average {byW ? 'power' : 'heart rate'}, coloured by its zone; the upright tick marks {byW ? 'your FTP' : 'your threshold heart rate'}, and the figure is the lap as a share of it. Labels such as "Work" and "Recovery" are Intervals.icu's guess from the recording.</p>
    </>
  );
}

/** How the ride's time was spread over power, in 25 W bands coloured by zone, with FTP marked. */
export function PowerDistribution({ streams, ftp }: { streams: StreamSet; ftp: number }) {
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
      barColor={(i) => ZONE_VAR[powerZone((shown[i].from + 12.5) / (ftp || 1)) - 1]}
      xTick={(c, i) => (i % Math.ceil(shown.length / 8) === 0 ? `${c} W` : null)}
      yTitle="minutes"
      height={150}
      markers={ftp ? [{ at: ftp / 25, label: `FTP ${ftp}`, color: 'var(--ink-2)' }] : []}
      readout={(i) => `${shown[i].from}–${shown[i].from + 25} W · ${clock(shown[i].seconds)} · ${Math.round((shown[i].seconds / total) * 100)}% of the ride`}
    />
  );
}
