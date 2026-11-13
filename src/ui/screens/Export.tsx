import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { allWorkouts, findWorkout } from '../store';
import type { Ride, Workout } from '../../engine/types';
import { PageHead } from '../PageHead';
import { addDays, today } from '../../engine/load';
import { fmtDate } from '../derived';
import { clock } from '../../engine/workout';
import { db } from '../../data/db';
import type { Recording } from '../../player/types';
import { originOf, UNKNOWN_SOURCE, type Origin } from '../../export/activity';
import { ACTIVITY_FORMAT_LABEL, ACTIVITY_FORMAT_WHAT, WORKOUT_FORMAT_LABEL, WORKOUT_FORMAT_WHAT, type ActivityFormat, type FileOut, type WorkoutFormat } from '../../export/formats';
import { estimateBytes, fallbackFormat, runBulk, sizeWords, workoutFits, type BulkResult, type ExportItem, type WorkoutItem } from '../../export/bulk';
import { workoutExportable } from '../../export/formats';
import { deliver } from '../../export/deliver';
import { applyFilters, FilterBar, useFilters } from '../LibraryFilters';
import { useMine } from '../favorites';
import { KIND_LABEL } from './Plan';
import { defaultWhere, basisFor, type PlanDays, type SendBasis, type Where } from '../../library/sendWhere';
import { breathZones } from '../../engine/zones';
import { canSendByBreath } from '../../library/breathSend';
import { useBreathTable } from '../SendButton';
import { getPlans } from '../planService';
import { credentials } from '../../sync/syncService';
import { toast } from '../Toast';
import { APP_SHORT_NAME } from '../../appName';

/**
 * The Export page (12 Nov 2026, export at any time): finished activities, workouts to ride, or both, into one
 * folder. The rider chooses what, which and the format; sees what will be left out and why before it starts; and
 * gets a folder with a note and a list. Nothing is left out unless the rider asks for it.
 */

type What = 'activities' | 'workouts' | 'both';
type Range = '30' | 'year' | 'all' | 'dates';
type WkSource = 'library' | 'mine' | 'calendar';
type Kind = 'ride' | 'strength' | 'mobility' | 'walk' | 'run';
const KINDS: Array<[Kind, string]> = [['ride', 'Rides'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['walk', 'Walks'], ['run', 'Runs']];

const startOfYear = () => `${today().slice(0, 4)}-01-01`;

function Seg<T extends string>({ value, set, options, label }: { value: T; set: (v: T) => void; options: Array<[T, string]>; label: string }) {
  return <div class="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} class={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => set(v)}>{l}</button>)}</div>;
}

/** A list with a tick box per row, all ticked to start, and Tick all / Untick all. */
function TickList<T>({ items, keyOf, label, detail, off, setOff }: { items: T[]; keyOf: (x: T) => string; label: (x: T) => string; detail: (x: T) => string; off: Set<string>; setOff: (s: Set<string>) => void }) {
  const ticked = items.filter((x) => !off.has(keyOf(x))).length;
  return (
    <>
      <div class="row between" style="margin:6px 0">
        <span class="small muted">{ticked} of {items.length} ticked</span>
        <span class="row" style="gap:6px"><button class="btn quiet sm" onClick={() => setOff(new Set())}>Tick all</button><button class="btn quiet sm" onClick={() => setOff(new Set(items.map(keyOf)))}>Untick all</button></span>
      </div>
      {items.length > 0 ? (
        <div class="ex-list">
          {items.map((x) => {
            const k = keyOf(x);
            return (
              <label class="ex-row" key={k}>
                <input type="checkbox" checked={!off.has(k)} onChange={() => { const n = new Set(off); if (n.has(k)) n.delete(k); else n.add(k); setOff(n); }} />
                <span class="t">{label(x)}</span><span class="d">{detail(x)}</span>
              </label>
            );
          })}
        </div>
      ) : <p class="faint small">Nothing matches.</p>}
    </>
  );
}

export function Export({ data }: { data: AppData }) {
  const profile = data.profile!;
  const [what, setWhat] = useState<What>('activities');
  const wantActs = what !== 'workouts', wantWks = what !== 'activities';
  // ---- activities
  const [range, setRange] = useState<Range>('30');
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const [notTraining, setNotTraining] = useState(false);
  const [actOff, setActOff] = useState<Set<string>>(new Set());
  const [leaveOut, setLeaveOut] = useState(false);
  const [actFormat, setActFormat] = useState<ActivityFormat>('fit');
  const [noRoute, setNoRoute] = useState<'skip' | 'fit'>('skip');
  const [recs, setRecs] = useState<Recording[]>([]);
  // Not connected to the account the activities come from: only recordings on this device can become files.
  const [connected, setConnected] = useState(true);
  useEffect(() => { void credentials().then((c) => setConnected(!!c)).catch(() => {}); }, []);
  useEffect(() => { void db.recordings.toArray().then(setRecs).catch(() => {}); }, []);
  const playerIds = useMemo(() => new Set(recs.map((r) => r.activityId).filter((x): x is string => !!x)), [recs]);
  const [lo, hi] = range === '30' ? [addDays(today(), -30), today()] : range === 'year' ? [startOfYear(), today()] : range === 'all' ? ['0000-01-01', '9999-12-31'] : [from, to];
  const acts = useMemo(() => (notTraining ? data.ridesAll : data.rides).filter((r) => r.date >= lo && r.date <= hi).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)), [data.rides, data.ridesAll, notTraining, lo, hi]);
  const origins = useMemo(() => new Map<string, Origin>(acts.map((r) => [r.id, originOf(r, data.edits, data.planned, playerIds)])), [acts, data.edits, data.planned, playerIds]);
  const pickedActs = acts.filter((r) => !actOff.has(r.id));
  const outside = [...new Set(pickedActs.map((r) => origins.get(r.id)!).filter((o) => !o.antogo).map((o) => o.source))].sort((a, b) => (a === UNKNOWN_SOURCE ? 1 : b === UNKNOWN_SOURCE ? -1 : a.localeCompare(b)));
  const namedOutside = outside.filter((s) => s !== UNKNOWN_SOURCE);
  const keptActs = leaveOut ? pickedActs.filter((r) => { const o = origins.get(r.id)!; return o.antogo || o.source === UNKNOWN_SOURCE; }) : pickedActs;
  const routeless = (r: Ride) => /Virtual|Indoor|Treadmill|WeightTraining|Yoga|Workout/i.test(r.type) || !r.distanceM;
  const gpxMisses = actFormat === 'gpx' ? keptActs.filter(routeless) : [];

  // ---- workouts
  const [src, setSrc] = useState<WkSource>('library');
  const [kind, setKind] = useState<Kind>('ride');
  const [f, setF] = useFilters();
  const mineSets = useMine(data.planned, (id) => findWorkout(data.mine, id), data);
  const [calFrom, setCalFrom] = useState(today());
  const [calTo, setCalTo] = useState(addDays(today(), 13));
  const [wkOff, setWkOff] = useState<Set<string>>(new Set());
  const [wkFormat, setWkFormat] = useState<WorkoutFormat>('fit');
  const breathy = !!breathZones(profile);
  const [targets, setTargets] = useState<SendBasis>(profile.preferBreath && breathy ? 'breath' : profile.basis);
  const [version, setVersion] = useState<'usual' | Where>('usual');
  const [unfit, setUnfit] = useState<'skip' | 'fallback'>('fallback');
  const [plans, setPlans] = useState<PlanDays[]>([]);
  useEffect(() => { void getPlans().then(setPlans).catch(() => {}); }, [data.planned]);
  const table = useBreathTable();
  const wkList: Array<{ key: string; w: Workout; date?: string; from: string }> = useMemo(() => {
    if (src === 'calendar') return data.planned.filter((p) => p.date >= calFrom && p.date <= calTo).sort((a, b) => a.date.localeCompare(b.date)).flatMap((p) => { const w = findWorkout(data.mine, p.workoutId); return w ? [{ key: p.id, w, date: p.date, from: 'Your calendar' }] : []; });
    if (src === 'mine') return data.mine.filter((w) => w.source === 'mine').map((w) => ({ key: w.id, w, from: 'Your own workout' }));
    return applyFilters(allWorkouts(data.mine).filter((w) => w.kind === kind && w.source === 'library'), f, kind, mineSets).map((w) => ({ key: w.id, w, from: 'Antogo Library' }));
  }, [src, kind, f, data.mine, data.planned, calFrom, calTo, mineSets]);
  useEffect(() => setWkOff(new Set()), [src, kind]);
  const pickedWks = wkList.filter((x) => !wkOff.has(x.key));
  const choiceFor = (w: Workout, date?: string): WorkoutItem['choice'] => {
    if (w.kind !== 'ride') return { basis: 'hr' };
    const basis: SendBasis = targets === 'breath' ? (canSendByBreath(w, profile, table) ? 'breath' : basisFor(w, profile.basis)) : basisFor(w, targets);
    const entry = date ? data.planned.find((p) => p.date === date && p.workoutId === w.id) : undefined;
    return { basis, where: version === 'usual' ? defaultWhere(entry, w, plans) : version };
  };
  const wkItems: WorkoutItem[] = pickedWks.map((x) => ({ kind: 'workout', w: x.w, date: x.date, from: x.from, choice: choiceFor(x.w, x.date) }));
  const otherWay = wkItems.filter((it) => it.w.kind === 'ride' && targets !== 'breath' && it.choice.basis !== targets);
  const misfits = wkItems.map((it) => ({ it, fit: workoutFits(it, wkFormat) })).filter((x) => !x.fit.ok);
  const never = misfits.filter((x) => !workoutExportable(x.it.w).ok);
  const fixable = misfits.filter((x) => workoutExportable(x.it.w).ok);

  // ---- the run
  const items: ExportItem[] = [
    ...(wantActs ? keptActs.filter((r) => !(gpxMisses.includes(r) && noRoute === 'skip')).map((r): ExportItem => ({ kind: 'activity', ride: r, origin: origins.get(r.id)!, local: recs.find((x) => x.activityId === r.id), ...(gpxMisses.includes(r) ? { format: 'fit' as ActivityFormat } : {}) })) : []),
    ...(wantWks ? wkItems : []),
  ];
  const bytes = items.reduce((n, it) => n + estimateBytes(it, actFormat, wkFormat), 0);
  const [run, setRun] = useState<{ done: number; total: number; now: string } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const stop = useRef(false);
  const start = async () => {
    stop.current = false;
    setResult(null);
    setRun({ done: 0, total: items.length, now: '' });
    try {
      const res = await runBulk({ items, actFormat, wkFormat, unfit, profile, table, credentials: wantActs ? await credentials() : null, onProgress: (done, total, now) => setRun({ done, total, now }), cancelled: () => stop.current });
      setResult(res);
    } catch (e) { toast({ ok: false, text: `The export stopped: ${(e as Error).message}` }); }
    setRun(null);
  };
  const save = async (parts: FileOut[]) => { if (await deliver(parts)) toast({ ok: true, text: parts.length > 1 ? `Saved ${parts.length} folders.` : `Saved ${parts[0].name}.` }); };

  if (run || result) return (
    <div class="ex-page">
      <PageHead title="Export" back={{ label: 'Settings', href: '#/settings' }} help="export" />
      {run && (
        <section class="section">
          <p class="small" style="margin:0 0 8px">Exporting {Math.min(run.done + 1, run.total)} of {run.total}{run.now ? `: ${run.now}` : ''}</p>
          <div class="ex-bar" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done}><span style={`width:${run.total ? Math.round((run.done / run.total) * 100) : 0}%`} /></div>
          <p class="faint small" style="margin:8px 0 12px">Keep this page open until it finishes. Activities are fetched one at a time.</p>
          <button class="btn" onClick={() => { stop.current = true; }}>Cancel</button>
        </section>
      )}
      {result && (
        <section class="section">
          <h2>{result.cancelled ? 'Stopped' : 'Ready'}</h2>
          <p class="small" style="margin:6px 0">{result.done} {result.done === 1 ? 'file' : 'files'}{result.parts.length > 1 ? ` in ${result.parts.length} folders, because together they are too large for one` : ' in one folder'}, {sizeWords(result.parts.reduce((n, p) => n + (p.data as Uint8Array).length, 0))}.{result.cancelled ? ' You cancelled part-way; what was ready is in the folder.' : ''}</p>
          {result.how.summary > 0 && <p class="faint small" style="margin:4px 0">{result.how.summary} {result.how.summary === 1 ? 'activity has' : 'activities have'} only a summary (no recording was ever kept), so {result.how.summary === 1 ? 'it is' : 'they are'} a short text file.</p>}
          {result.skipped.length > 0 && <details style="margin:6px 0"><summary class="small">{result.skipped.length} left out</summary><ul class="small muted">{result.skipped.map((p, i) => <li key={i}>{p.date ? `${fmtDate(p.date)}: ` : ''}{p.name}: {p.why}</li>)}</ul></details>}
          {result.failed.length > 0 && <div style="margin:6px 0"><p class="small" style="color:var(--warn);margin:0">{result.failed.length} could not be exported:</p><ul class="small muted">{result.failed.map((p, i) => <li key={i}>{p.date ? `${fmtDate(p.date)}: ` : ''}{p.name}: {p.why}</li>)}</ul><p class="faint small">The folder's note lists them too. Export them again later.</p></div>}
          <div class="row wrap" style="gap:8px;margin-top:12px">
            {result.parts.length === 1 ? <button class="btn primary" onClick={() => void save(result.parts)}>Save the folder</button>
              : result.parts.map((p, i) => <button key={i} class={`btn${i === 0 ? ' primary' : ''}`} onClick={() => void save([p])}>Save part {i + 1} of {result.parts.length}</button>)}
            <button class="btn" onClick={() => setResult(null)}>Start again</button>
          </div>
          <p class="faint small" style="margin-top:10px">The folder is zipped. Open it to get the files: most apps import them one at a time. "Read me first" says where each kind can go.</p>
        </section>
      )}
    </div>
  );

  return (
    <div class="ex-page">
      <PageHead title="Export" back={{ label: 'Settings', href: '#/settings' }} help="export" />
      <p class="muted small" style="margin:0 0 6px;max-width:64ch">Take your activities and workouts to other apps, as files. For moving or protecting {APP_SHORT_NAME} itself, use Back up everything in Settings instead.</p>

      <h2 class="ex-step">What</h2>
      <Seg value={what} set={setWhat} label="What" options={[['activities', 'Finished activities'], ['workouts', 'Workouts to ride'], ['both', 'Both']]} />

      {wantActs && (
        <section class="section">
          <h2>Finished activities</h2>
          <div class="ex-dates" style="margin-top:8px">
            <Seg value={range} set={setRange} label="Which dates" options={[['30', 'Last 30 days'], ['year', 'This year'], ['all', 'Everything'], ['dates', 'Choose dates']]} />
            {range === 'dates' && <><label class="small muted">From <input type="date" value={from} max={to} onChange={(e) => setFrom((e.target as HTMLInputElement).value)} /></label><label class="small muted">to <input type="date" value={to} min={from} onChange={(e) => setTo((e.target as HTMLInputElement).value)} /></label></>}
          </div>
          {!connected && <p class="small" style="margin:8px 0 0;color:var(--warn)">This device isn't connected to your account, so only rides recorded here by the ride player can be files; every other activity will be a short summary. Connect in Settings first for full files.</p>}
          {range === 'all' && <p class="faint small" style="margin:6px 0 0">Everything on this device. To go further back, load more history in Settings first.</p>}
          {data.ridesAll.length > data.rides.length && <label class="row small muted" style="gap:8px;margin:8px 0 0;cursor:pointer"><input type="checkbox" checked={notTraining} onChange={() => setNotTraining(!notTraining)} />Include recordings that aren't training (under five minutes, or at car speed)</label>}
          <TickList items={acts} keyOf={(r) => r.id} off={actOff} setOff={setActOff} label={(r) => `${r.name}${r.sport !== 'ride' ? ` · ${KIND_LABEL[r.sport]}` : ''}`} detail={(r) => `${fmtDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${clock(r.seconds)} · ${origins.get(r.id)?.source ?? ''}`} />
          {outside.length > 0 && (
            <div class="panel" style="margin-top:12px;padding:10px 14px">
              <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start"><input type="checkbox" checked={leaveOut} onChange={() => setLeaveOut(!leaveOut)} style="margin-top:3px" />
                <span>Leave out activities that came from {namedOutside.length ? namedOutside.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'outside Antogo'}</span></label>
              <p class="faint small" style="margin:4px 0 0 26px">You might want this if the files are going back to {namedOutside.length === 1 ? namedOutside[0] : 'where they came from'}: importing them there again would create duplicates.{outside.includes(UNKNOWN_SOURCE) ? ' Activities whose source can’t be told are kept either way.' : ''}</p>
            </div>
          )}
          <h3 class="ex-step small">Format</h3>
          <div class="stack" style="gap:6px" role="radiogroup" aria-label="Format for activities">
            {(['fit', 'tcx', 'gpx'] as ActivityFormat[]).map((x) => (
              <label key={x} class="dl-opt"><input type="radio" name="ex-act" checked={actFormat === x} onChange={() => setActFormat(x)} /><span><b>{ACTIVITY_FORMAT_LABEL[x]}</b><span class="faint small" style="display:block">{ACTIVITY_FORMAT_WHAT[x]}</span></span></label>
            ))}
          </div>
          {gpxMisses.length > 0 && (
            <div class="panel" style="margin-top:10px;padding:10px 14px">
              <p class="small" style="margin:0">{gpxMisses.length} of these {gpxMisses.length === 1 ? 'activity has' : 'activities have'} no route (indoors, or no GPS), so {gpxMisses.length === 1 ? 'it' : 'they'} can't be a GPS file{gpxMisses.length <= 4 ? `: ${gpxMisses.map((r) => r.name).join(', ')}` : ''}.</p>
              <div class="row" style="gap:8px;margin-top:8px"><Seg value={noRoute} set={setNoRoute} label="Activities without a route" options={[['skip', 'Leave them out'], ['fit', 'Take them as .fit']]} /></div>
            </div>
          )}
        </section>
      )}

      {wantWks && (
        <section class="section">
          <h2>Workouts to ride</h2>
          <div style="margin-top:8px"><Seg value={src} set={setSrc} label="Which workouts" options={[['library', 'From the Library'], ['mine', 'Your own'], ['calendar', 'On the calendar']]} /></div>
          {src === 'library' && <>
            <div class="seg kinds" style="margin:10px 0">{KINDS.map(([k, l]) => <button key={k} class={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>
            <FilterBar kind={kind} f={f} set={setF} />
          </>}
          {src === 'calendar' && <div class="ex-dates" style="margin-top:10px"><label class="small muted">From <input type="date" value={calFrom} max={calTo} onChange={(e) => setCalFrom((e.target as HTMLInputElement).value)} /></label><label class="small muted">to <input type="date" value={calTo} min={calFrom} onChange={(e) => setCalTo((e.target as HTMLInputElement).value)} /></label></div>}
          <TickList items={wkList} keyOf={(x) => x.key} off={wkOff} setOff={setWkOff} label={(x) => `${x.w.name}${x.w.kind !== 'ride' ? ` · ${KIND_LABEL[x.w.kind]}` : ''}`} detail={(x) => (x.date ? fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' }) : x.w.kind === 'ride' ? (x.w.bases.length > 1 ? 'power or heart rate' : x.w.bases[0] === 'hr' ? 'heart rate only' : 'power only') : '')} />
          {wkItems.some((it) => it.w.kind === 'ride') && <>
            <div class="send-row" style="margin-top:12px"><span class="small muted">Targets for rides</span><Seg value={targets} set={setTargets} label="Targets" options={[['power', 'Power'], ['hr', 'Heart rate'], ...(breathy ? [['breath', 'Breathing'] as [SendBasis, string]] : [])]} /></div>
            <div class="send-row" style="margin-top:8px"><span class="small muted">Version</span><Seg value={version} set={setVersion} label="Version" options={[['usual', 'Each ride’s usual'], ['outdoor', 'Outdoor'], ['trainer', 'As written']]} /></div>
            {otherWay.length > 0 && <p class="faint small" style="margin:6px 0 0">{otherWay.length} {otherWay.length === 1 ? 'ride works' : 'rides work'} only {targets === 'hr' ? 'by power' : 'by heart rate'}, so {otherWay.length === 1 ? 'it goes' : 'they go'} that way.</p>}
          </>}
          <h3 class="ex-step small">Format</h3>
          <div class="stack" style="gap:6px" role="radiogroup" aria-label="Format for workouts">
            {(['fit', 'zwo', 'mrc', 'erg'] as WorkoutFormat[]).map((x) => (
              <label key={x} class="dl-opt"><input type="radio" name="ex-wk" checked={wkFormat === x} onChange={() => setWkFormat(x)} /><span><b>{WORKOUT_FORMAT_LABEL[x]}</b><span class="faint small" style="display:block">{WORKOUT_FORMAT_WHAT[x]}</span></span></label>
            ))}
          </div>
          <p class="faint small" style="margin:6px 0 0">Strength and mobility sessions always go as a readable list (.txt).</p>
          {wkFormat === 'erg' && <p class="faint small" style="margin:6px 0 0">Watts from your FTP today, {profile.ftp} W.</p>}
          {fixable.length > 0 && (
            <div class="panel" style="margin-top:10px;padding:10px 14px">
              <p class="small" style="margin:0">{fixable.length} {fixable.length === 1 ? 'workout' : 'workouts'} can't go as {WORKOUT_FORMAT_LABEL[wkFormat]}:</p>
              <ul class="small muted" style="margin:6px 0">{fixable.slice(0, 5).map((x, i) => <li key={i}>{x.it.w.name}: {x.fit.why}</li>)}{fixable.length > 5 && <li>and {fixable.length - 5} more</li>}</ul>
              <Seg value={unfit} set={setUnfit} label="Workouts the format can't carry" options={[['fallback', `Take them in a format that can (${[...new Set(fixable.map((x) => fallbackFormat(x.it.w)))].map((ff) => (ff === 'fit' ? '.fit' : '.txt')).join(' or ')})`], ['skip', 'Leave them out']]} />
            </div>
          )}
          {never.length > 0 && <p class="faint small" style="margin:8px 0 0">Left out: {never.map((x) => x.it.w.name).join(', ')}. {never[0].fit.why}</p>}
        </section>
      )}

      <section class="section">
        <p class="small" style="margin:0 0 10px">{items.length ? <>{items.length} {items.length === 1 ? 'item' : 'items'} will be exported, {sizeWords(bytes)}.{wantActs && keptActs.length ? ` Activities are fetched one at a time, so ${keptActs.length > 100 ? 'this takes a few minutes' : 'this takes a moment'}.` : ''}</> : 'Nothing is ticked yet.'}</p>
        <button class="btn primary" disabled={!items.length} onClick={() => void start()}>Export {items.length || ''}</button>
      </section>
    </div>
  );
}
