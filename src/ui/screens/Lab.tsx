import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { PageHead } from '../PageHead';
import { Icon } from '../icons';
import { fmtDate } from '../derived';
import { fmtValue, type MeasureDef } from '../../engine/measures';
import { LAB_FAMILIES, PERIOD_LABEL, familyMeasures, labMeta, newest, readings, searchMeasures, type LabFamily } from '../../engine/lab';
import { LargeView, URL_KEYS, type LargeRange, type LargeTarget } from '../LargeView';
import { readQuery, replaceQuery } from '../router';
import { useLab, useOpensOn, usePins, type LabData } from '../lab/useLab';
import { PeriodPicker } from '../lab/PeriodPicker';
import { EmptyFrame, Spark } from '../lab/Spark';
import { LAB_CHARTS, chartById, type LabChart } from '../lab/charts';

const short = (d: string) => fmtDate(d, { month: 'short', day: 'numeric' });
const dated = (d: string, t: string) => (d.slice(0, 4) === t.slice(0, 4) ? short(d) : fmtDate(d, { month: 'short', day: 'numeric', year: 'numeric' }));
const LARGE: Record<string, LargeRange> = { '3m': '3m', '6m': '6m', '1y': '1y', all: 'all' };

/**
 * The Lab (27 Nov 2026): every figure Antogo holds for this rider. The front page has search, the rider's pins,
 * a tile for each designed chart and a tile for each family of measures; a family opens its full list; a measure
 * opens in the one large view, where others can be laid over it. A ride is examined on its own page, not here.
 */
export function Lab({ data, parts }: { data: AppData; parts: string[] }) {
  const L = useLab(data);
  const pins = usePins();
  const [, sub, id] = parts;
  // Which measure is open large: in the address, so Back from a day opened there returns to it.
  const [big, setBig] = useState<LargeTarget | null>(() => { const b = readQuery().get('big'); return b ? { id: b, card: b } : null; });
  const openBig = (m: string) => { replaceQuery({ big: m }, URL_KEYS); setBig({ id: m, card: m }); };
  const closeBig = () => { replaceQuery({}, URL_KEYS); setBig(null); };
  const large = big && L.measures.def(big.id)
    ? <LargeView measures={L.measures} target={big} pageFrom={L.from} pageTo={L.to} pageRange={LARGE[L.period] ?? 'custom'} rides={data.rides} hardDays={L.hardDays}
        testDays={L.tests.map((x) => x.date)} asideDays={data.dayNotes.filter((n) => n.badWellness).map((n) => n.date)} coach={L.coach} onClose={closeBig} />
    : null;
  const chart = sub === 'chart' ? chartById(id) : undefined;
  const family = sub === 'family' ? LAB_FAMILIES.find((f) => f.id === id) : undefined;
  return (
    <div class="lab">
      {chart ? <ChartPage L={L} chart={chart} pins={pins} /> : family ? <FamilyPage L={L} family={family.id} pins={pins} open={openBig} /> : <Front L={L} pins={pins} open={openBig} />}
      {large}
    </div>
  );
}

type Pins = ReturnType<typeof usePins>;

function PinButton({ pins, k, name }: { pins: Pins; k: string; name: string }) {
  const on = pins.has(k);
  return <button class={`lb-pin${on ? ' on' : ''}`} aria-pressed={on} aria-label={on ? `Unpin ${name}` : `Pin ${name} to the top of the Lab`} title={on ? 'Pinned. Press to unpin' : 'Pin to the top of the Lab'}
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); pins.toggle(k); }}><Icon.star size={16} on={on} /></button>;
}

// ---------- the front page ----------

function Front({ L, pins, open }: { L: LabData; pins: Pins; open: (m: string) => void }) {
  const [q, setQ] = useState(() => readQuery().get('q') ?? '');
  useEffect(() => { replaceQuery({ q: q.trim() || undefined }); }, [q]);
  const [opens, setOpens] = useOpensOn();
  const M = L.measures;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const foundCharts = words.length ? LAB_CHARTS.filter((c) => words.every((w) => `${c.name} ${c.about} ${c.words ?? ''}`.toLowerCase().includes(w))) : [];
  const foundMeasures = useMemo(() => searchMeasures(M, q), [M, q]);
  const pinned = pins.pins.map((k) => (k.startsWith('c:') ? { chart: chartById(k.slice(2)) } : { measure: M.def(k.slice(2)) })).filter((p) => p.chart || p.measure);
  const withData = M.defs.filter((d) => readings(M, d.id) > 0).length;
  return (
    <>
      <PageHead eyebrow={`${withData} of ${M.defs.length} measures have data`} title="The Lab"><PeriodPicker L={L} /></PageHead>
      <p class="lb-lead">Every figure Antogo holds for you, over any period, as a chart and as a table. Nothing here is estimated for you from other riders: a measure you have no data for stays empty, and says what it needs.</p>
      <div class="lb-top">
        <label class="lb-search"><span class="sr-only">Search the Lab</span><Icon.search size={16} />
          <input type="search" value={q} placeholder="Search every chart and measure" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>
        <div class="lb-opens" title="Where the Insights tab takes you first on a phone, and where links from other pages land.">
          <span>This part of Antogo opens on</span>
          <div class="seg" role="radiogroup" aria-label="This part of Antogo opens on">
            <button role="radio" aria-checked={opens === 'insights'} class={opens === 'insights' ? 'on' : ''} onClick={() => setOpens('insights')}>Insights</button>
            <button role="radio" aria-checked={opens === 'lab'} class={opens === 'lab' ? 'on' : ''} onClick={() => setOpens('lab')}>The Lab</button>
          </div>
        </div>
        <a class="lb-jump" href="#/insights?here=1">Insights: your questions, answered</a>
      </div>

      {words.length ? (
        <section aria-live="polite">
          <h2 class="lb-h">Found <em>{foundCharts.length + foundMeasures.length ? `${foundCharts.length + foundMeasures.length} for “${q.trim()}”` : `nothing for “${q.trim()}”`}</em></h2>
          {!foundCharts.length && !foundMeasures.length && <p class="lb-note">Try a plainer word: “sleep”, “zone”, “20 minutes”, “weight”. Single rides are on the Activities page.</p>}
          {!!foundCharts.length && <div class="lb-tiles">{foundCharts.map((c) => <ChartTile key={c.id} L={L} chart={c} pins={pins} />)}</div>}
          {!!foundMeasures.length && <div class="lb-rows">{foundMeasures.map((d) => <MeasureRow key={d.id} L={L} def={d} pins={pins} open={open} showFamily />)}</div>}
        </section>
      ) : (
        <>
          {!!pinned.length && (
            <section>
              <h2 class="lb-h">Pinned <em>by you</em></h2>
              {pinned.some((p) => p.chart) && <div class="lb-tiles">{pinned.map((p) => p.chart && <ChartTile key={p.chart.id} L={L} chart={p.chart} pins={pins} />)}</div>}
              {pinned.some((p) => p.measure) && <div class="lb-rows">{pinned.map((p) => p.measure && <MeasureRow key={p.measure.id} L={L} def={p.measure} pins={pins} open={open} showFamily />)}</div>}
            </section>
          )}
          {!!LAB_CHARTS.length && (
            <section>
              <h2 class="lb-h">Charts <em>each one built for its subject, drawn here from your own data</em></h2>
              <div class="lb-tiles">{LAB_CHARTS.map((c) => <ChartTile key={c.id} L={L} chart={c} pins={pins} />)}</div>
            </section>
          )}
          <section>
            <h2 class="lb-h">Every measure, by family <em>each opens as a chart and a table, and can be laid over any other</em></h2>
            <div class="lb-fams">{LAB_FAMILIES.map((f) => <FamilyTile key={f.id} L={L} family={f.id} />)}</div>
            <p class="lb-note">A single ride is examined on its own page: open it from <a href="#/rides">Activities</a>.</p>
          </section>
        </>
      )}
    </>
  );
}

function ChartTile({ L, chart, pins }: { L: LabData; chart: LabChart; pins: Pins }) {
  const ready = chart.ready(L);
  const tile = ready.state === 'none' ? null : chart.tile(L);
  return (
    <a class={`lb-tile${ready.state === 'none' ? ' wait' : ''}`} href={`#/lab/chart/${chart.id}`} data-chart={chart.id}>
      <div class="lb-tile-pic">{tile ? tile.mini : <EmptyFrame label={`${chart.name}: nothing to draw yet`} />}</div>
      <div class="lb-tile-h"><b>{chart.name}</b><PinButton pins={pins} k={`c:${chart.id}`} name={chart.name} /></div>
      {ready.state === 'ok' && tile?.figure && <div class="lb-fig"><b>{tile.figure}</b>{tile.label && <span>{tile.label}</span>}</div>}
      {ready.state === 'ok' && !tile?.figure && <small>{chart.about}</small>}
      {ready.state === 'some' && <small class="lb-st part">{ready.so}</small>}
      {ready.state === 'none' && <small class="lb-st">{ready.why}</small>}
    </a>
  );
}

function FamilyTile({ L, family }: { L: LabData; family: LabFamily }) {
  const M = L.measures;
  const f = LAB_FAMILIES.find((x) => x.id === family)!;
  const list = familyMeasures(M, family);
  const have = list.filter((d) => readings(M, d.id) > 0).length;
  // Why the family is empty, when it is: what most of its measures need.
  const why = have ? '' : mostNeeded(M, list);
  return (
    <a class="lb-fam" href={`#/lab/family/${family}`} data-family={family}>
      <div class="lb-fam-h"><b>{f.name}</b><u>{list.length} measures</u></div>
      {list.slice(0, 4).map((d) => { const n = newest(M, d.id); return <div key={d.id} class="lb-fam-r"><i>{d.name}</i><em class={n ? '' : 'no'}>{n ? fmtValue(d, n.value) : '–'}</em></div>; })}
      {have < list.length && <small class={`lb-st${have ? ' part' : ''}`}>{have ? `${have} of ${list.length} have data so far` : why}</small>}
      <div class="lb-all">All {list.length} measures</div>
    </a>
  );
}

function mostNeeded(M: LabData['measures'], list: MeasureDef[]): string {
  const n = new Map<string, number>();
  for (const d of list) { const w = labMeta(M, d.id)?.needs ?? ''; n.set(w, (n.get(w) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// ---------- a family's full list ----------

function FamilyPage({ L, family, pins, open }: { L: LabData; family: LabFamily; pins: Pins; open: (m: string) => void }) {
  const M = L.measures;
  const f = LAB_FAMILIES.find((x) => x.id === family)!;
  const list = familyMeasures(M, family);
  const have = list.filter((d) => readings(M, d.id) > 0);
  const none = list.filter((d) => readings(M, d.id) === 0);
  return (
    <>
      <PageHead back={{ label: 'The Lab', href: '#/lab' }} eyebrow={`${have.length} of ${list.length} measures have data`} title={f.name}><PeriodPicker L={L} /></PageHead>
      <p class="lb-lead">{f.about} Open any measure to see it large, lay others over it, mark days, compare periods and download its figures.</p>
      {!!have.length && <div class="lb-rows">{have.map((d) => <MeasureRow key={d.id} L={L} def={d} pins={pins} open={open} />)}</div>}
      {!!none.length && (
        <>
          <h2 class="lb-h">Nothing recorded yet <em>these fill in when you have what they need</em></h2>
          <div class="lb-rows">{none.map((d) => <MeasureRow key={d.id} L={L} def={d} pins={pins} open={open} />)}</div>
        </>
      )}
    </>
  );
}

/** One measure as a row: its name and what it is, the rider's own readings in miniature for the period, and its newest value. */
function MeasureRow({ L, def, pins, open, showFamily }: { L: LabData; def: MeasureDef; pins: Pins; open: (m: string) => void; showFamily?: boolean }) {
  const M = L.measures;
  const all = readings(M, def.id);
  const inPeriod = readings(M, def.id, L.from, L.to);
  const n = newest(M, def.id);
  const meta = labMeta(M, def.id);
  const fam = showFamily && meta ? LAB_FAMILIES.find((x) => x.id === meta.family)?.name : undefined;
  const unit = def.cadence === 'week' ? 'week' : 'reading';
  if (!all) {
    return (
      <div class="lb-row wait" data-measure={def.id}>
        <div class="lb-row-t"><b>{def.name}</b>{fam && <u>{fam}</u>}<p>{def.desc}</p></div>
        <div class="lb-row-pic"><EmptyFrame label={`${def.name}: nothing recorded yet`} /></div>
        <div class="lb-row-v"><em class="no">–</em><small class="lb-st">{meta?.needs}</small></div>
      </div>
    );
  }
  return (
    <div class="lb-row" data-measure={def.id} role="button" tabIndex={0} onClick={() => open(def.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(def.id); } }} aria-label={`${def.name}: open large`}>
      <div class="lb-row-t"><b>{def.name}</b>{fam && <u>{fam}</u>}<p>{def.desc}</p></div>
      <div class="lb-row-pic">
        <Spark def={def} values={M.values(def.id)} from={L.from} to={L.to} />
        <small class={all < 3 ? 'lb-st part' : ''}>{all < 3 ? `Your data so far: ${all} ${unit}${all === 1 ? '' : 's'}` : inPeriod ? `${inPeriod} ${unit}${inPeriod === 1 ? '' : 's'} in ${PERIOD_LABEL[L.period].toLowerCase()}` : `None in ${PERIOD_LABEL[L.period].toLowerCase()}: the newest is from ${dated(n!.date, L.t)}`}</small>
      </div>
      <div class="lb-row-v"><em>{fmtValue(def, n!.value)}</em><small>{def.cadence === 'week' ? `week of ${dated(n!.date, L.t)}` : dated(n!.date, L.t)}</small></div>
      <PinButton pins={pins} k={`m:${def.id}`} name={def.name} />
    </div>
  );
}

// ---------- a designed chart's own screen ----------

function ChartPage({ L, chart, pins }: { L: LabData; chart: LabChart; pins: Pins }) {
  const ready = chart.ready(L);
  return (
    <>
      <PageHead back={{ label: 'The Lab', href: '#/lab' }} title={chart.name}><PinButton pins={pins} k={`c:${chart.id}`} name={chart.name} /><PeriodPicker L={L} /></PageHead>
      {ready.state === 'none'
        ? <div class="lb-panel"><p class="lb-lead" style="margin:0 0 10px">There is nothing to draw here yet. {ready.why}.</p><EmptyFrame h={120} label={`${chart.name}: nothing to draw yet`} /></div>
        : <chart.Page L={L} />}
    </>
  );
}
