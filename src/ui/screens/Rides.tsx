import type { AppData } from '../store';
import { findWorkout } from '../store';
import { clock } from '../../engine/workout';
import { distance, elevation, fmtDate } from '../derived';
import { scoreRide } from '../../engine/compliance';
import { ZONE_VAR } from '../Profile';
import type { Ride } from '../../engine/types';

export function Rides({ data, id }: { data: AppData; id?: string }) {
  const profile = data.profile!;
  if (id) {
    const r = data.rides.find((x) => x.id === id);
    if (!r) return <div class="empty">That ride is not synced.</div>;
    return <RideDetail ride={r} data={data} />;
  }
  if (data.rides.length === 0) {
    return (
      <div>
        <div class="page-head"><h1>Rides</h1></div>
        <div class="empty"><b>No rides yet.</b><p class="small" style="margin-top:6px">Connect Intervals.icu in Settings, then press Sync on Today. Your last 120 days of rides arrive on the first sync.</p></div>
      </div>
    );
  }
  const mph = (ms?: number) => ms ? (profile.units === 'imperial' ? `${(ms * 2.237).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`) : '';
  return (
    <div>
      <div class="page-head"><h1>Rides</h1><span class="muted small">{data.rides.length} synced</span></div>
      <div class="stack">
        {data.rides.map((r) => {
          const p = data.planned.find((x) => x.activityId === r.id);
          const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
          const c = w ? scoreRide(w, r) : undefined;
          return (
            <a class="cal-item" key={r.id} href={`#/rides/${r.id}`}>
              <div class="t">
                <b>{r.name}</b>
                <span>{fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {clock(r.seconds)} · {distance(r.distanceM, profile)}{mph(r.averageSpeedMs) ? ` · ${mph(r.averageSpeedMs)}` : ''}</span>
              </div>
              <div style="text-align:right">
                <div class="num" style="font-size:18px">{r.tss ?? '–'}<span class="faint small" style="font-weight:400"> TSS</span></div>
                {c && <span class="pill" style={`border-color:${verdictColor(c.verdict)};color:${verdictColor(c.verdict)}`}>{verdictLabel(c.verdict)}</span>}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function RideDetail({ ride: r, data }: { ride: Ride; data: AppData }) {
  const profile = data.profile!;
  const p = data.planned.find((x) => x.activityId === r.id);
  const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
  const c = w ? scoreRide(w, r) : undefined;
  const items: Array<[string, string | number | undefined]> = [
    ['Moving time', clock(r.seconds)],
    ['Distance', distance(r.distanceM, profile)],
    ['Climbing', elevation(r.elevationM, profile)],
    ['TSS', r.tss],
    ['Normalized power', r.normalizedPower ? `${r.normalizedPower} W` : undefined],
    ['Average power', r.averagePower ? `${r.averagePower} W` : undefined],
    ['Intensity', r.intensityFactor?.toFixed(2)],
    ['Average HR', r.averageHr ? `${Math.round(r.averageHr)} bpm` : undefined],
    ['Max HR', r.maxHr ? `${Math.round(r.maxHr)} bpm` : undefined],
    ['Cadence', r.averageCadence ? `${Math.round(r.averageCadence)} rpm` : undefined],
    ['Efficiency factor', r.efficiencyFactor?.toFixed(2)],
    ['Decoupling', r.decoupling != null ? `${r.decoupling.toFixed(1)}%` : undefined],
    ['Temperature', r.averageTempC != null ? (profile.units === 'imperial' ? `${Math.round(r.averageTempC * 1.8 + 32)}°F` : `${Math.round(r.averageTempC)}°C`) : undefined],
    ['FTP that day', r.ftpAtRide ? `${r.ftpAtRide} W` : undefined],
  ];
  const zones = r.powerZoneSeconds ?? r.hrZoneSeconds;
  const zTotal = zones?.reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <a href="#/rides" class="btn quiet sm" style="margin-left:-10px;margin-bottom:8px">‹ Rides</a>
      <p class="muted small">{fmtDate(r.date)}</p>
      <h1>{r.name}</h1>
      {c && w && (
        <div class="panel" style={`margin-top:14px;border-color:${verdictColor(c.verdict)}`}>
          <b style={`color:${verdictColor(c.verdict)}`}>{verdictLabel(c.verdict)}</b> <span class="muted">against {w.name}</span>
          <p class="muted small" style="margin-top:4px">{c.reason}</p>
        </div>
      )}
      {zones && (
        <section class="section">
          <h2>Time in zone</h2>
          <div style="display:flex;height:14px;border-radius:4px;overflow:hidden;gap:2px">
            {zones.map((s, i) => s > 0 && <div key={i} style={`flex:${s};background:${ZONE_VAR[Math.min(i, 6)]}`} title={`Z${i + 1}: ${clock(s)}`} />)}
          </div>
          <div class="row wrap faint small" style="margin-top:6px;gap:10px">
            {zones.map((s, i) => s / zTotal > 0.03 && <span key={i}><span style={`color:${ZONE_VAR[Math.min(i, 6)]}`}>■</span> Z{i + 1} {Math.round((s / zTotal) * 100)}%</span>)}
          </div>
        </section>
      )}
      <section class="section">
        <h2>Numbers</h2>
        <table class="steps">
          {items.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => <tr key={k}><td colSpan={2} class="muted">{k}</td><td class="r num" colSpan={2}>{v}</td></tr>)}
        </table>
      </section>
    </div>
  );
}

function verdictColor(v: string): string {
  return { nailed: 'var(--good)', done: 'var(--z2)', partial: 'var(--warn)', overcooked: 'var(--z5)', missed: 'var(--bad)' }[v] ?? 'var(--ink-3)';
}
function verdictLabel(v: string): string {
  return { nailed: 'Nailed it', done: 'Done', partial: 'Partial', overcooked: 'Over-cooked', missed: 'Missed' }[v] ?? v;
}
