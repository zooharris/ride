import { useState } from 'preact/hooks';
import { useWidth } from './useWidth';
import type { SessionKind } from '../engine/types';
import { today } from '../engine/load';
import { fmtDate } from './derived';
import { hoursLabel, type WeekSummary } from './week';

const KIND_VAR: Record<SessionKind, string> = { ride: 'var(--ride)', strength: 'var(--strength)', mobility: 'var(--mobility)', walk: 'var(--walk)', run: 'var(--run)', other: 'var(--z1)' };
const KIND_WORD: Record<SessionKind, string> = { ride: 'ride', strength: 'strength', mobility: 'mobility', walk: 'walk', run: 'run', other: 'other' };

/**
 * The week at a glance: a cell per day with a block per session (taller is
 * longer), done ticked and missed struck, today outlined; under it the week's
 * load done against planned. A cell opens that day on the calendar.
 */
export function WeekStrip({ week }: { week: WeekSummary }) {
  const t = today();
  const maxMin = Math.max(60, ...week.days.flatMap((d) => d.sessions.map((s) => s.minutes)));
  const pct = week.plannedTss ? Math.min(100, (week.doneTss / week.plannedTss) * 100) : 0;
  return (
    <section class="weekstrip" aria-label="This week">
      <div class="ws-days">
        {week.days.map((d) => {
          const isToday = d.date === t, past = d.date < t;
          const label = `${fmtDate(d.date, { weekday: 'long', month: 'short', day: 'numeric' })}: ${d.sessions.length ? d.sessions.map((s) => `${s.name} (${s.status === 'unscheduled' ? 'done, unscheduled' : s.status === 'completed' ? 'done' : s.status})`).join(', ') : 'nothing planned'}`;
          return (
            <a key={d.date} class={`ws-day${isToday ? ' today' : ''}${past ? ' past' : ''}`} href={`#/calendar?d=${d.date}`} title={label} aria-label={label}>
              <span class="ws-dow">{fmtDate(d.date, { weekday: 'narrow' })}</span>
              <span class="ws-num">{Number(d.date.slice(8))}</span>
              <span class="ws-blocks">
                {d.sessions.slice(0, 3).map((s, i) => {
                  const done = s.status === 'completed' || s.status === 'unscheduled', missed = s.status === 'missed';
                  return <span key={i} class={`ws-block${done ? ' done' : ''}${missed ? ' missed' : ''}`} style={`--c:${KIND_VAR[s.kind]};height:${Math.round(8 + 26 * Math.sqrt(Math.min(1, s.minutes / maxMin)))}px`} />;
                })}
                {d.sessions.length === 0 && <span class="ws-rest" />}
              </span>
              <span class="ws-mark">{d.sessions.some((s) => s.status === 'missed') ? '–' : d.sessions.length && d.sessions.every((s) => s.status === 'completed' || s.status === 'unscheduled') ? '✓' : ''}</span>
            </a>
          );
        })}
      </div>
      <div class="ws-load">
        <div class="ws-track" role="img" aria-label={`${week.doneTss} of ${week.plannedTss} planned training load done`}>
          <div class="ws-fill" style={`width:${pct}%`} />
        </div>
        {week.sessionsPlanned > 0
          ? <p class="small muted"><b class="num" style="color:var(--ink)">{week.doneTss}</b> of {week.plannedTss} TSS planned · {week.sessionsDone} of {week.sessionsPlanned} planned sessions done · {hoursLabel(week.doneMinutes)} of {hoursLabel(week.plannedMinutes)}</p>
          : <p class="small muted">This week: <b class="num" style="color:var(--ink)">{week.doneTss}</b> training load (TSS) in {hoursLabel(week.doneMinutes)}. Nothing planned yet.</p>}
      </div>
    </section>
  );
}

/** A small stacked bar of a week's load by kind: done solid, the rest of what was planned faint behind it. */
export function KindStack({ week, width = 140 }: { week: WeekSummary; width?: number }) {
  const kinds = (['ride', 'strength', 'walk', 'run', 'mobility', 'other'] as SessionKind[]).filter((k) => week.byKind[k].done || week.byKind[k].planned);
  const total = Math.max(1, kinds.reduce((a, k) => a + Math.max(week.byKind[k].done, week.byKind[k].planned), 0));
  let x = 0;
  const title = kinds.map((k) => `${KIND_WORD[k]}: ${Math.round(week.byKind[k].done)} done of ${Math.round(week.byKind[k].planned)} planned`).join(' · ');
  return (
    <svg width={width} height="10" viewBox={`0 0 ${width} 10`} role="img" aria-label={title || 'Nothing planned'} style="display:block;flex:0 0 auto">
      <title>{title || 'Nothing planned'}</title>
      <rect x="0" y="0" width={width} height="10" rx="3" fill="var(--bg-3)" />
      {kinds.map((k) => {
        const span = (Math.max(week.byKind[k].done, week.byKind[k].planned) / total) * width;
        const done = (week.byKind[k].done / total) * width;
        const g = <g key={k}><rect x={x} y="0" width={Math.max(0, span - 1)} height="10" fill={KIND_VAR[k]} fill-opacity="0.3" /><rect x={x} y="0" width={Math.max(0, Math.min(span, done) - 1)} height="10" fill={KIND_VAR[k]} /></g>;
        x += span;
        return g;
      })}
    </svg>
  );
}

/** The week header on the calendar: dates, hours and load done against planned, and the stacked bar. */
export function WeekBar({ week, children }: { week: WeekSummary; children?: preact.ComponentChildren }) {
  return (
    <div class="weekbar">
      <div class="wb-title">
        <h2>{fmtDate(week.start, { month: 'short', day: 'numeric' })} – {fmtDate(week.days[6].date, { month: 'short', day: 'numeric' })}</h2>
        <div class="wb-stats small muted">
          <span title="Hours done of hours planned"><b class="num">{hoursLabel(week.doneMinutes)}</b> of {hoursLabel(week.plannedMinutes)}</span>
          <span title="Training load (TSS) done of planned"><b class="num">{week.doneTss}</b> of {week.plannedTss} TSS</span>
          <KindStack week={week} width={120} />
        </div>
      </div>
      {children && <div class="wb-actions">{children}</div>}
    </div>
  );
}

/** A tiny trend line; the last point is dotted. */
export function Sparkline({ values, color = 'var(--aqua)', width = 72, height = 22, label }: { values: Array<number | null>; color?: string; width?: number; height?: number; label?: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null && isFinite(p.v));
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const x = (i: number) => 2 + (i / Math.max(1, values.length - 1)) * (width - 4);
  const y = (v: number) => 2 + (1 - (v - lo) / span) * (height - 4);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? 'trend'} style="display:block;overflow:visible">
      <path d={d} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.4" fill={color} />
    </svg>
  );
}

export type Band = 'go' | 'ease' | 'easy' | 'rest';
export const BAND_COLOR: Record<Band, string> = { go: 'var(--good)', ease: 'var(--accent)', easy: 'var(--warn)', rest: 'var(--bad)' };
/** The arc uses the brighter zone yellow for "easy" so it reads as a colour, not a brown, in the light theme. */
const BAND_ARC: Record<Band, string> = { go: 'var(--good)', ease: 'var(--accent)', easy: 'var(--z4)', rest: 'var(--bad)' };
export const BAND_WORD: Record<Band, string> = { go: 'Ready', ease: 'Ease off a little', easy: 'Keep it easy', rest: 'Rest' };
const BAND_LINES: Record<Band, string[]> = { go: ['Ready'], ease: ['Ease off', 'a little'], easy: ['Keep it', 'easy'], rest: ['Rest'] };

/** The readiness score as the brand's dial: a 270° gauge open at the bottom, filled to the score in the band's colour. */
/**
 * `waiting`: the score rests on form alone because the morning's numbers have not arrived (or were
 * set aside). The dial goes grey and says Waiting, so it does not read as a real verdict.
 */
export function ReadinessDial({ score, band, size = 156, waiting = false }: { score: number; band: Band; size?: number; waiting?: boolean }) {
  const r = 40, cx = 50, cy = 50, sweep = 270, start = 135;   // degrees, measured clockwise from 3 o'clock
  const arc = (from: number, to: number) => {
    const a0 = (from * Math.PI) / 180, a1 = (to * Math.PI) / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const end = start + (sweep * Math.max(0, Math.min(100, score))) / 100;
  const ticks = [55, 75].map((v) => start + (sweep * v) / 100);
  // The band word must fit inside the ring: anything longer than one short word goes on two lines.
  const lines = waiting ? ['Waiting'] : BAND_LINES[band];
  const arcColour = waiting ? 'var(--ink-3)' : BAND_ARC[band];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={waiting ? `Readiness ${score} of 100, from form alone: waiting for this morning's numbers` : `Readiness ${score} of 100: ${BAND_WORD[band]}`} style="display:block;flex:0 0 auto">
      <path d={arc(start, start + sweep)} fill="none" stroke="var(--bg-3)" stroke-width="9" stroke-linecap="round" />
      {score > 0 && <path d={arc(start, Math.max(start + 0.5, end))} fill="none" stroke={arcColour} stroke-width="9" stroke-linecap="round" class="dial-fill" opacity={waiting ? 0.35 : undefined} />}
      {ticks.map((a) => { const t = (a * Math.PI) / 180; return <line key={a} x1={cx + 33 * Math.cos(t)} y1={cy + 33 * Math.sin(t)} x2={cx + 36 * Math.cos(t)} y2={cy + 36 * Math.sin(t)} stroke="var(--ink-3)" stroke-width="1" />; })}
      <text x="50" y={lines.length > 1 ? 50 : 53} text-anchor="middle" font-size="25" font-weight="700" fill={waiting ? 'var(--ink-3)' : 'var(--ink)'} style="letter-spacing:-0.02em;font-variant-numeric:tabular-nums">{score}</text>
      <text x="50" y={lines.length > 1 ? 61 : 66} text-anchor="middle" font-size="6.4" font-weight="600" fill={waiting ? 'var(--ink-3)' : BAND_COLOR[band]} style="text-transform:uppercase;letter-spacing:.05em">
        {lines.map((l, i) => <tspan key={i} x="50" dy={i ? 7.4 : 0}>{l}</tspan>)}
      </text>
      <text x="50" y="92" text-anchor="middle" font-size="6" fill="var(--ink-3)">of 100</text>
    </svg>
  );
}

export type PlanPhaseKey = 'base' | 'build' | 'peak' | 'taper' | 'recovery';
export const PHASE_COLOR: Record<Exclude<PlanPhaseKey, 'recovery'>, string> = { base: 'var(--info)', build: 'var(--accent)', peak: 'var(--today)', taper: 'var(--z1)' };
export const PHASE_WORD: Record<PlanPhaseKey, string> = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', recovery: 'Recovery' };
interface TLWeek { start: string; phase: PlanPhaseKey; label?: string; tss: number }

/** A recovery week takes the colour of the block it sits in, drawn lower; the first block's colour if it opens the plan. */
function phaseColours(weeks: TLWeek[]): string[] {
  let prev: Exclude<PlanPhaseKey, 'recovery'> = 'base';
  const firstReal = weeks.find((w) => w.phase !== 'recovery');
  if (firstReal) prev = firstReal.phase as Exclude<PlanPhaseKey, 'recovery'>;
  return weeks.map((w) => { if (w.phase !== 'recovery') prev = w.phase; return PHASE_COLOR[prev]; });
}

/**
 * The plan's shape, one cell per week coloured by phase. `bars` draws each
 * week's planned load as a bar on a labelled axis (recovery weeks fall out of
 * it naturally); without it, a slim strip with recovery weeks at half height.
 * Today is marked, the event is flagged at the end, and hovering a week names it.
 */
export function PlanTimeline({ weeks, goalDate, event, bars = false, height }: { weeks: TLWeek[]; goalDate?: string; event?: string; bars?: boolean; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, Wm] = useWidth(480);
  if (!weeks.length) return null;
  const t = today();
  const colours = phaseColours(weeks);
  const W = Wm, H = height ?? (bars ? 150 : 36), padL = bars ? 36 : 0, padR = event ? 14 : 2, padT = bars ? 10 : 4, padB = bars ? 22 : 12;
  const n = weeks.length, cw = (W - padL - padR) / n, gap = Math.min(3, cw * 0.18);
  const maxT = Math.max(1, ...weeks.map((w) => w.tss));
  const step = niceStep(maxT / 3);
  const top = Math.ceil(maxT / step) * step;
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const todayIdx = weeks.findIndex((w, i) => t >= w.start && (i === n - 1 || t < weeks[i + 1].start));
  const phasesUsed = Array.from(new Set(weeks.map((w) => w.phase)));
  const h = hover;
  return (
    <div class="timeline" style="position:relative" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style="display:block;width:100%" role="img" aria-label={`Plan of ${n} weeks: ${phasesUsed.map((p) => PHASE_WORD[p]).join(', ')}`}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.floor((px - padL) / cw); setHover(i >= 0 && i < n ? i : null); }}
        onMouseLeave={() => setHover(null)}>
        {bars && [0, step, 2 * step, 3 * step].filter((v) => v <= top).map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={padL - 5} y={y(v) + 3} font-size="10" text-anchor="end" fill="var(--ink-3)">{v}</text></g>)}
        {bars && <text transform={`translate(9 ${(H - padB) / 2 + padT}) rotate(-90)`} fill="var(--ink-3)" font-size="10" text-anchor="middle">planned TSS a week</text>}
        {weeks.map((w, i) => {
          const x = padL + i * cw + gap / 2, cwid = cw - gap;
          if (bars) { const yy = y(w.tss); return <rect key={w.start} x={x} y={yy} width={cwid} height={Math.max(1, H - padB - yy)} rx="2" fill={colours[i]} fill-opacity={i < todayIdx ? 0.45 : h === i ? 1 : 0.85} />; }
          const full = H - padT - padB, hh = w.phase === 'recovery' ? full * 0.5 : full;
          return <rect key={w.start} x={x} y={padT + full - hh} width={cwid} height={hh} rx="2" fill={colours[i]} fill-opacity={i < todayIdx ? 0.45 : h === i ? 1 : 0.85} />;
        })}
        {todayIdx >= 0 && (() => { const x = padL + todayIdx * cw + cw / 2; return <g><line x1={x} x2={x} y1={padT - 2} y2={H - padB + 2} stroke="var(--ink)" stroke-width="1.5" /><text x={x} y={H - 1} font-size="10" text-anchor="middle" fill="var(--ink-2)">today</text></g>; })()}
        {event && <g><line x1={W - padR + 4} x2={W - padR + 4} y1={padT} y2={H - padB} stroke="var(--today)" stroke-width="1.5" /><path d={`M${W - padR + 4} ${padT}l8 3.5l-8 3.5z`} fill="var(--today)" /></g>}
        {bars && weeks.map((w, i) => (i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0) && i !== todayIdx ? <text key={`x${i}`} x={padL + i * cw + cw / 2} y={H - 6} font-size="10" text-anchor="middle" fill="var(--ink-3)">{new Date(w.start + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text> : null)}
      </svg>
      <div class="row wrap faint small" style="gap:4px 14px;margin-top:4px">
        {phasesUsed.filter((p) => p !== 'recovery').map((p) => <span key={p}><span class="sw-dot" style={`background:${PHASE_COLOR[p as Exclude<PlanPhaseKey, 'recovery'>]}`} /> {PHASE_WORD[p]}</span>)}
        {phasesUsed.includes('recovery') && <span>{bars ? 'Lower weeks are recovery weeks' : 'Short cells are recovery weeks'}</span>}
        {event && <span><span class="sw-dot" style="background:var(--today)" /> {event}{goalDate ? `, ${fmtDate(goalDate, { month: 'short', day: 'numeric' })}` : ''}</span>}
      </div>
      {h != null && (
        <div class="panel small" style="position:absolute;top:0;right:0;padding:6px 10px;pointer-events:none;max-width:75%">
          <b>Week of {fmtDate(weeks[h].start, { month: 'short', day: 'numeric' })}</b> · {weeks[h].label || PHASE_WORD[weeks[h].phase]} · {weeks[h].tss} TSS planned
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}
