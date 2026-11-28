import { ProgressCoach } from '../ProgressCoach';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import { PageHead } from '../PageHead';
import { getSetting } from '../../data/db';
import { assess, type PowerCurve as AssessCurve } from '../../engine/assessment';
import { addDays } from '../../engine/load';
import { CURVE_SECONDS, bestCurve, weeklyLoad } from '../../engine/progress';
import { QUESTIONS, STRENGTH_BARS, STRENGTH_SENTENCE, STRENGTH_WORD, insights, type Answer, type InsightFacts, type Piece, type QuestionId, type Strength } from '../../engine/insights';
import { labMeta, readings } from '../../engine/lab';
import { pounds } from '../../engine/units';
import { knownFtp } from '../../engine/known';
import { fmtDate, readinessToday, weekStart } from '../derived';
import { weekSummary } from '../week';
import { replaceRoute } from '../router';
import { useLab, useOpensOn, type LabData } from '../lab/useLab';
import { Spark } from '../lab/Spark';
import { Legend, Scope } from '../lab/Scope';
import { chartById } from '../lab/charts';
import { dayN, short } from '../lab/util';

/**
 * Insights (27 Nov 2026): the questions riders ask, each answered in a sentence from the rider's own data, with how
 * strong the evidence is. A card opens the page that explains the answer: the evidence for it and any against,
 * each leading down to the data in the Lab, then a fuller picture where the question has one. A question that
 * cannot be answered for this rider is not a card: it is listed at the foot with the reason.
 */
function useInsights(L: LabData) {
  const [curve, setCurve] = useState<AssessCurve | undefined | null>(null);
  useEffect(() => { getSetting<{ curve: AssessCurve } | null>('powerCurve', null).then((c) => setCurve(c?.curve)); }, [L.rides.length]);
  return useMemo(() => {
    const { data, profile, t } = L;
    // The power curve the plan's assessment already uses; without one, the best of the last year from the rides on this device.
    const year = L.curves.filter((c) => c.w?.length && c.date >= addDays(t, -365));
    const own = year.length ? bestCurve(year.map((c) => c.w)).map((watts, k) => ({ seconds: CURVE_SECONDS[k], watts })).filter((p) => p.watts > 0) : undefined;
    const assessment = assess({ today: t, profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve?.length ? curve : own });
    const facts: InsightFacts = {
      today: t, rides: data.rides, wellness: data.wellness, series: L.series, assessment,
      readiness: L.series.length ? readinessToday(data.wellness, L.series[L.series.length - 1], t, data.rides) : undefined,
      curves: L.curves, tests: L.tests.map((x) => ({ date: x.date, vo2: x.result?.vo2maxMlKgMin, vt1: x.result?.breath?.vt1?.watts, vt2: x.result?.breath?.vt2?.watts })),
      ftpHistory: [...L.measures.values('ftp').entries()].map(([date, ftp]) => ({ date, ftp })).sort((a, b) => a.date.localeCompare(b.date)),
      ftp: knownFtp(profile) ?? undefined, lthr: profile.lthr,
      plan: L.plan ? { goal: L.plan.goal, start: L.plan.start, goalDate: L.plan.goalDate, requiredCtl: L.plan.requiredCtl, projection: L.plan.projection ?? [], name: L.plan.name } : null,
      planned: data.planned.filter((p) => p.planId && findWorkout(data.mine, p.workoutId)).map((p) => ({ date: p.plannedFor ?? p.date, status: p.status })),
      weekStartOf: (d) => weekStart(d), pounds: pounds(profile),
    };
    return insights(facts);
  }, [L.data, L.series, L.curves, L.tests, L.plan, L.measures, curve]);
}

export function Insights({ data, parts, params }: { data: AppData; parts: string[]; params: URLSearchParams }) {
  const L = useLab(data);
  const all = useInsights(L);
  const [opens] = useOpensOn();
  // On a phone the menu has one entry for Insights and the Lab: it opens on whichever the rider chose.
  useEffect(() => {
    if (opens === 'lab' && !parts[1] && !params.get('here') && typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches) replaceRoute('lab');
  }, [opens]);
  const one = parts[1] ? all.answers.find((a) => a.id === parts[1]) : undefined;
  const missing = parts[1] && !one ? all.notShown.find((n) => n.id === parts[1]) : undefined;
  return (
    <div class="insights">
      {one ? <Explain L={L} a={one} all={all.answers} />
        : parts[1] ? <NoAnswer id={parts[1]} reason={missing?.reason} />
        : <Home L={L} answers={all.answers} notShown={all.notShown} />}
    </div>
  );
}

function Meter({ s }: { s: Strength }) {
  return <span class="in-mt" aria-hidden="true">{[1, 2, 3].map((k) => <i key={k} class={k <= STRENGTH_BARS[s] ? 'on' : ''} />)}</span>;
}

const sparkSpan = (L: LabData) => ({ from: addDays(L.t, -83), to: L.t });
function Small({ L, id, h }: { L: LabData; id?: string; h?: number }) {
  const def = id ? L.measures.def(id) : undefined;
  if (!def || readings(L.measures, def.id) < 3) return null;
  const { from, to } = sparkSpan(L);
  if (readings(L.measures, def.id, from, to) < 2) return null;
  return <div class="in-spark"><Spark def={def} values={L.measures.values(def.id)} from={from} to={to} h={h ?? 56} label={`Your ${def.word} over the last twelve weeks`} /></div>;
}

// ---------- the first screen ----------

function Home({ L, answers, notShown }: { L: LabData; answers: Answer[]; notShown: Array<{ id: string; ask: string; reason: string }> }) {
  const hour = new Date().getHours();
  const name = (L.profile.name ?? '').trim().split(/\s+/)[0];
  const hello = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}.`;
  const can = answers.filter((a) => a.strength !== 'early').length;
  return (
    <>
      <PageHead eyebrow={fmtDate(L.t)} title="Insights" help="insights"><a class="lb-jump" href="#/lab">The Lab: every chart and measure</a></PageHead>
      <p class="in-hello">{hello} {answers.length ? (can ? `Here is what your data can answer today.` : 'It is early days: here is what Antogo will answer as your rides come in.') : 'Nothing is recorded yet.'}</p>
      <div class="progress in-coach"><ProgressCoach coach={L.coach} /></div>
      <div class="in-cards">
        {answers.map((a) => (
          <a key={a.id} class={`in-card${a.strength === 'early' ? ' early' : ''}`} href={`#/insights/${a.id}`} data-question={a.id} data-strength={a.strength}>
            <div class="in-ask">{a.ask}</div>
            <div class="in-ans">{a.answer}</div>
            <div class="in-conf"><Meter s={a.strength} />Evidence: <b>{STRENGTH_WORD[a.strength]}</b></div>
            {a.card && <div class="in-num"><b>{a.card.value}</b><span>{a.card.label}</span></div>}
            {a.strength !== 'early' && <Small L={L} id={a.spark} />}
            {a.strength === 'early' && a.needs && <p class="in-need">{a.needs}</p>}
            <div class="in-more">{a.strength === 'early' ? 'What Antogo needs' : 'Why Antogo says so'}</div>
          </a>
        ))}
      </div>
      {!!notShown.length && (
        <section class="in-foot">
          <h2 class="lb-h">Questions Antogo cannot answer for you yet</h2>
          <ul>{notShown.map((n) => <li key={n.id} data-not-shown={n.id}><b>{n.ask}</b> {n.reason}</li>)}</ul>
        </section>
      )}
      <p class="lb-note">Every answer is worked out on this device from your own rides and readings. None compares you with other riders.</p>
    </>
  );
}

function NoAnswer({ id, reason }: { id: string; reason?: string }) {
  const ask = QUESTIONS[id as QuestionId];
  return (
    <>
      <PageHead back={{ label: 'Insights', href: '#/insights?here=1' }} title={ask ?? 'Insights'} help="insights" />
      <div class="lb-panel"><p class="lb-lead" style="margin:0">{reason ?? 'This question does not apply to you at present. It appears when you have what it is about: a plan, a goal, an event, or the readings it needs.'}</p></div>
    </>
  );
}

// ---------- the explanation page (layout B: the evidence, then the fuller picture) ----------

function seeHref(p: Piece, L: LabData): string | undefined {
  if (p.see?.chart && chartById(p.see.chart)) return `#/lab/chart/${p.see.chart}`;
  if (p.see?.measure && L.measures.def(p.see.measure)) { const fam = labMeta(L.measures, p.see.measure)?.family; return fam ? `#/lab/family/${fam}?big=${p.see.measure}` : undefined; }
  return undefined;
}

function Evidence({ L, p, n, kind }: { L: LabData; p: Piece; n: number; kind: 'Supporting' | 'Contra' }) {
  const href = seeHref(p, L);
  return (
    <div class={`in-ev ${kind === 'Contra' ? 'contra' : ''}`} data-evidence={p.id}>
      <div class="in-ev-k">{kind} evidence {n}{p.support === 'thin' ? ' · thinly supported' : ''}{p.indirect ? ' · indirect' : ''}</div>
      <h3>{p.title}</h3>
      <p>{p.text}</p>
      {p.figure && <div class="in-num"><b>{p.figure.value}</b><span>{p.figure.label}</span></div>}
      <Small L={L} id={p.spark} h={64} />
      {href && <a class="in-see" href={href}>See the data: {p.see!.label}</a>}
    </div>
  );
}

function Explain({ L, a, all }: { L: LabData; a: Answer; all: Answer[] }) {
  const related = a.related.map((id) => all.find((x) => x.id === id)).filter((x): x is Answer => !!x);
  return (
    <>
      <PageHead back={{ label: 'Insights', href: '#/insights?here=1' }} eyebrow="Why Antogo says so" title={a.ask} help="insights" />
      <p class="in-big" data-strength={a.strength}>{a.answer}</p>
      <p class="in-sure"><Meter s={a.strength} /><b>{STRENGTH_SENTENCE[a.strength]}</b> {a.why}</p>
      {a.caution && <p class="in-caution">{a.caution}</p>}
      {a.strength === 'early' ? (
        <div class="in-ev-grid">
          <div class="in-ev"><div class="in-ev-k">What Antogo needs</div><p>{a.needs}</p></div>
          {a.soFar && <div class="in-ev"><div class="in-ev-k">What it can say so far</div><p>{a.soFar}</p>{a.card && <div class="in-num"><b>{a.card.value}</b><span>{a.card.label}</span></div>}</div>}
        </div>
      ) : (
        <div class="in-ev-grid">
          {a.supporting.map((p, k) => <Evidence key={p.id} L={L} p={p} n={k + 1} kind="Supporting" />)}
          {a.contra.map((p, k) => <Evidence key={p.id} L={L} p={p} n={k + 1} kind="Contra" />)}
        </div>
      )}
      {a.strength !== 'early' && a.id === 'fitter' && <BuiltFitness L={L} />}
      {a.strength !== 'early' && a.id === 'plan' && <AgainstPlan L={L} />}
      {a.act && (
        <div class="in-act"><p><b>{a.act.title}</b>{a.act.text}</p>{a.act.href && <a class="btn primary" href={a.act.href}>{a.act.label}</a>}</div>
      )}
      {!!related.length && <><h2 class="lb-h">Related questions</h2><div class="in-rel">{related.map((r) => <a key={r.id} href={`#/insights/${r.id}`}>{r.ask}</a>)}</div></>}
      <p class="lb-note"><a href="#/lab">Go straight to the Lab</a> for every chart and measure.</p>
    </>
  );
}

// ---------- the fuller pictures ----------

const KINDS: Array<{ k: 'ride' | 'run' | 'walk' | 'strength' | 'mobility' | 'other'; name: string; color: string }> = [
  { k: 'ride', name: 'Rides', color: 'var(--ride)' }, { k: 'run', name: 'Runs', color: 'var(--run)' }, { k: 'walk', name: 'Walks', color: 'var(--walk)' },
  { k: 'strength', name: 'Strength', color: 'var(--strength)' }, { k: 'mobility', name: 'Mobility', color: 'var(--mobility)' }, { k: 'other', name: 'Other', color: 'var(--ink-3)' },
];
const thirteen = (L: LabData) => { const to = L.t, from = addDays(weekStart(to), -7 * 12); return { from, to }; };

/** What built your fitness: each week's training load by kind of session, with the fitness line it produced. */
function BuiltFitness({ L }: { L: LabData }) {
  const { from, to } = thirteen(L);
  const [at, setAt] = useState<number | null>(null);
  const weeks = useMemo(() => weeklyLoad(L.rides, from, to, (d) => weekStart(d)), [L.rides, from, to]);
  const kinds = KINDS.filter((k) => weeks.some((w) => (w.byKind[k.k as keyof typeof w.byKind] ?? 0) > 0));
  const fit = L.series.filter((f) => f.date >= from && f.date <= to);
  const x = (d: string) => dayN(from, d);
  const wk = at != null ? weeks.find((w) => x(w.start) + 3 === at) : undefined;
  const ticks = weeks.filter((_, k) => k % 2 === 0).map((w) => [x(w.start) + 3, short(w.start)] as [number, string]);
  const best = weeks.reduce((m, w) => (w.total > m.total ? w : m), weeks[0]);
  const fAt = (d: string) => L.series.find((f) => f.date === d)?.ctl;
  return (
    <section class="in-full" data-picture="built">
      <h2 class="in-full-h">What built your fitness</h2>
      <p class="in-full-lead">The last thirteen weeks: what you did each week, and the fitness it left you with.{best?.total ? ` Your biggest week was the week of ${short(best.start)}, at ${Math.round(best.total)} TSS.` : ''}</p>
      <div class="lc-body"><div class="lc-plot">
        <Scope label="Each week's training load by kind of session, with your fitness" height={250} x0={0} x1={dayN(from, to)} xTicks={ticks} yUnit="TSS" y2Unit="fitness" yMin={0} y2Min={0}
          stack={{ xs: weeks.map((w) => x(w.start) + 3), barW: 5, parts: kinds.map((k) => ({ name: k.name, color: k.color, vals: weeks.map((w) => w.byKind[k.k as keyof typeof w.byKind] ?? 0) })) }}
          series={[{ name: 'Fitness', kind: 'line', pts: fit.map((f) => [x(f.date), f.ctl]), color: 'var(--ink)', width: 1.9, axis: 1 }]}
          snap={weeks.map((w) => x(w.start) + 3)} at={at} onAt={setAt} />
        <Legend items={[...kinds.map((k) => ({ name: k.name, color: k.color, kind: 'block' as const })), { name: 'Fitness (right-hand scale)', color: 'var(--ink)' }]} />
      </div>
      <aside class="lc-read" aria-live="polite">{wk ? <>
        <div class="lc-when">Week of {short(wk.start)}</div>
        <div class="lc-big">{Math.round(wk.total)} <small>TSS</small></div>
        <div class="lc-kv">{kinds.map((k) => <div key={k.k}><span><i class="sc-key" style={`background:${k.color}`} />{k.name}</span><b>{Math.round(wk.byKind[k.k as keyof typeof wk.byKind] ?? 0)}</b></div>)}</div>
        <p>Fitness at the end of that week: {Math.round(fAt(addDays(wk.start, 6) > to ? to : addDays(wk.start, 6)) ?? 0)}.</p>
      </> : <p>Run a finger across the weeks to read any one.</p>}</aside></div>
      <div class="lc-how"><b>How to read this</b><span>Each bar is a week of training, split by kind of session; taller means more training load. The line is your fitness, on the right-hand scale. Fitness follows the bars, late and smoothed: it is the average of about six weeks of them.</span>
        <b>In plain words</b><span>Fitness rises while the bars stay as tall as, or taller than, the weeks before, and falls after short ones. A single tall week barely moves the line; several in a row do.</span></div>
      <a class="in-see" href="#/lab/chart/fitness">See the data: fitness, fatigue and form</a>
    </section>
  );
}

/** The last thirteen weeks against the plan: what the calendar asked for each week, and what was done. */
function AgainstPlan({ L }: { L: LabData }) {
  const { from, to } = thirteen(L);
  const [at, setAt] = useState<number | null>(null);
  const weeks = useMemo(() => { const out = []; for (let w = from; w <= to; w = addDays(w, 7)) out.push(weekSummary(w, L.data.planned, L.rides, L.data.mine)); return out; }, [L.data.planned, L.rides, L.data.mine, from, to]);
  const x = (d: string) => dayN(from, d);
  const asked = weeks.filter((w) => w.plannedTss > 0);
  if (!asked.length) return null;
  const wk = at != null ? weeks.find((w) => x(w.start) + 3 === at) : undefined;
  const doneAll = asked.reduce((s, w) => s + w.doneTss, 0), askedAll = asked.reduce((s, w) => s + w.plannedTss, 0);
  return (
    <section class="in-full" data-picture="plan">
      <h2 class="in-full-h">The last thirteen weeks against the plan</h2>
      <p class="in-full-lead">Over the {asked.length === 1 ? 'one week' : `${asked.length} weeks`} your calendar asked for something, you did {Math.round(doneAll / Math.max(1, askedAll) * 100)}% of the training load it asked for.</p>
      <div class="lc-body"><div class="lc-plot">
        <Scope label="Training load done each week against what the calendar asked for" height={240} x0={0} x1={dayN(from, to)} xTicks={weeks.filter((_, k) => k % 2 === 0).map((w) => [x(w.start) + 3, short(w.start)] as [number, string])} yUnit="TSS" yMin={0}
          series={[{ name: 'Done', kind: 'bars', pts: weeks.map((w) => [x(w.start) + 3, Math.round(w.doneTss)]), color: 'var(--ink-2)', barW: 4.4 },
            { name: 'Asked for', kind: 'step', pts: weeks.flatMap((w) => [[x(w.start), Math.round(w.plannedTss)], [x(w.start) + 6.99, Math.round(w.plannedTss)]] as Array<[number, number]>), color: 'var(--accent)', width: 1.8 }]}
          snap={weeks.map((w) => x(w.start) + 3)} at={at} onAt={setAt} />
        <Legend items={[{ name: 'Done', color: 'var(--ink-2)', kind: 'block' }, { name: 'Asked for by your calendar', color: 'var(--accent)' }]} />
      </div>
      <aside class="lc-read" aria-live="polite">{wk ? <>
        <div class="lc-when">Week of {short(wk.start)}</div>
        <div class="lc-big">{Math.round(wk.doneTss)} <small>TSS done</small></div>
        <div class="lc-kv"><div><span>Asked for</span><b>{Math.round(wk.plannedTss)} TSS</b></div><div><span>Sessions done</span><b>{wk.sessionsDone} of {wk.sessionsPlanned}</b></div></div>
      </> : <p>Run a finger across the weeks to read any one.</p>}</aside></div>
      <div class="lc-how"><b>How to read this</b><span>Each bar is the training load you did in a week. The stepped line is what your calendar asked for that week. A bar that reaches the line is a week done as planned.</span>
        <b>In plain words</b><span>Bars a little under the line now and then are normal life. Bars well under it for weeks running mean the plan is asking for more than you are doing, and Check the plan will rebuild it from where you are.</span></div>
      <a class="in-see" href="#/lab/chart/zones">See the data: time in zones, against the plan</a>
    </section>
  );
}
