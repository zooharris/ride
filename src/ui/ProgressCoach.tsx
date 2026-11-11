import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppData } from './store';
import type { RangeKey } from './FitnessChart';
import type { CoachConfig } from '../coach/llm';
import { askProgress, askProgressCard, writeProgress, type PageFacts as SentFacts } from '../coach/claude';
import { coachConfig } from './coachConfig';
import { getSetting, setSetting } from '../data/db';
import { today } from '../engine/load';
import type { PageFacts } from './screens/Progress';

/**
 * The coach on Progress (brief 3, 11 Nov 2026). Only with an AI connected; without one nothing here renders
 * and the page is exactly as it is without it. One request writes the headline and every card's line, sent the
 * first time the page is opened after new data, or on a range not yet written today; questions about the page
 * and about one card are one request each. Everything is kept on this device.
 */

export const CARD_TITLE: Record<string, string> = {
  fitness: 'Fitness, fatigue and form', key: 'Key numbers', load: 'Weekly training load', zones: 'Time in zone by week', power: 'Power curve',
  records: 'Records', durability: 'Durability', aerobic: 'Aerobic fitness', wellness: 'Wellness', morning: 'The morning after',
  consistency: 'Consistency', totals: 'Totals by month', weight: 'Weight and power to weight', tests: 'Tests and goal', body: 'Whole body', breathing: 'Breathing',
};

interface Written { sig: string; headline: string; lines: Record<string, string>; at: string }
interface Answer { q: string; a: string; at: string }

export interface ProgressCoachState {
  on: boolean;
  status: 'idle' | 'waiting' | 'error';
  error?: string;
  written: Written | null;
  refresh: () => void;
  /** A question about the page, for this range. */
  answer: Answer | null;
  showAnswer: boolean;
  setShowAnswer: (v: boolean) => void;
  askBusy: boolean;
  pending: string;
  askError?: string;
  ask: (q: string) => void;
  ready: string[];
  /** Which card's question box is open. */
  asking: string | null;
  setAsking: (id: string | null) => void;
  cardAnswers: Record<string, Answer>;
  cardBusy: string | null;
  cardError: { id: string; text: string } | null;
  askCard: (id: string, q: string) => void;
  /** What is switched on in a card (its chips, its comparison), sent with a question about it. */
  setExtra: (id: string, words: string) => void;
}

/** What changes when new data arrives: a new recording, a new morning, a new FTP, a session marked done. */
function dataSig(data: AppData): string {
  const r = data.rides[0];
  const w = data.wellness.reduce((m, x) => (x.date > m ? x.date : m), '');
  const done = data.planned.filter((p) => p.status === 'completed').length;
  return `${today()}|${data.rides.length}|${r?.id ?? ''}|${w}|${data.profile?.ftp}|${done}`;
}

/** The page's numbers as the coach is sent them: only what the page shows. */
export function sentFacts(data: AppData, facts: PageFacts, from: string, to: string): SentFacts {
  return {
    profile: data.profile!, date: to, from, to,
    context: facts.context,
    ticker: facts.ticker.map((c) => `${c.label} ${c.value}${c.change ? ` (${c.change})` : ''}`),
    key: facts.key.map((k) => `${k.label}: ${k.now} · ${k.was} · ${k.change}`),
    cards: Object.entries(facts.readouts).filter(([id, v]) => !!v && CARD_TITLE[id]).map(([id, readout]) => ({ id, title: CARD_TITLE[id], readout: id === 'tests' && facts.readouts.testsGoal ? `${readout} · ${facts.readouts.testsGoal}` : readout }))
      .concat(facts.key.length >= 3 ? [{ id: 'key', title: CARD_TITLE.key, readout: facts.key.map((k) => `${k.label} ${k.now} (${k.change} in four weeks)`).join('; ') }] : []),
  };
}

export function useProgressCoach({ data, range, from, to, facts }: { data: AppData; range: RangeKey; from: string; to: string; facts: PageFacts }): ProgressCoachState {
  const [cfg, setCfg] = useState<CoachConfig | null>(null);
  const [written, setWritten] = useState<Written | null>(null);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [askError, setAskError] = useState<string>();
  const [asking, setAsking] = useState<string | null>(null);
  const [cardAnswers, setCardAnswers] = useState<Record<string, Answer>>({});
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ id: string; text: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const extras = useRef<Record<string, string>>({});
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const sig = dataSig(data);

  useEffect(() => { void coachConfig().then(setCfg); getSetting<Record<string, Answer>>('progressCardAsk', {}).then(setCardAnswers); }, []);

  // The headline and the cards' lines: the kept ones for this range when nothing has changed, else one request.
  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    setError(undefined);
    (async () => {
      const kept = (await getSetting<Record<string, Written>>('progressCoach', {}))[range];
      if (kept && kept.sig === sig && nonce === 0) { if (alive) { setWritten(kept); setStatus('idle'); } return; }
      if (alive) { setWritten(kept && kept.sig === sig ? kept : null); setStatus('waiting'); }
      // A moment for the page's numbers to settle (the power curves load from this device), then one request.
      await new Promise((r) => setTimeout(r, 900));
      if (!alive) return;
      try {
        const r = await writeProgress(cfg, sentFacts(data, factsRef.current, from, to));
        const w: Written = { sig, headline: r.headline, lines: r.cards, at: new Date().toISOString() };
        const all = await getSetting<Record<string, Written>>('progressCoach', {});
        await setSetting('progressCoach', { ...all, [range]: w });
        if (alive) { setWritten(w); setStatus('idle'); }
      } catch (e) {
        if (alive) { setWritten(null); setStatus('error'); setError((e as Error).message); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, range, sig, nonce]);

  // The last question about the page for this range.
  useEffect(() => { setShowAnswer(false); setAskError(undefined); getSetting<Record<string, Answer>>('progressAsk', {}).then((m) => setAnswer(m[range] ?? null)); }, [range]);

  const ready = useMemo(() => {
    const out: string[] = [];
    const form = facts.ticker.find((c) => c.label === 'Form');
    if (form && form.value.startsWith('−')) out.push('Why is my form negative?');
    if (facts.context.some((l) => l.startsWith('Goal:'))) out.push('Am I on track for my goal?');
    out.push('What should I change this week?');
    if (facts.readouts.durability && !facts.readouts.durability.includes('are needed')) out.push('How is my durability changing?');
    else if (facts.readouts.wellness) out.push('Am I recovering well between sessions?');
    return out.slice(0, 4);
  }, [facts]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!cfg || !question || askBusy) return;
    setAskBusy(true); setPending(question); setAskError(undefined); setShowAnswer(true);
    askProgress(cfg, sentFacts(data, factsRef.current, from, to), question).then(async (a) => {
      const saved: Answer = { q: question, a, at: new Date().toISOString() };
      const all = await getSetting<Record<string, Answer>>('progressAsk', {});
      await setSetting('progressAsk', { ...all, [range]: saved });
      setAnswer(saved);
    }).catch((e) => setAskError((e as Error).message)).finally(() => setAskBusy(false));
  };

  const askCard = (id: string, q: string) => {
    const question = q.trim();
    if (!cfg || !question || cardBusy) return;
    setCardBusy(id); setCardError(null);
    const f = factsRef.current;
    const readout = id === 'tests' && f.readouts.testsGoal ? `${f.readouts.tests} · ${f.readouts.testsGoal}` : id === 'key' ? f.key.map((k) => `${k.label}: ${k.now} now, ${k.was} four weeks ago, change ${k.change}`).join('; ') : f.readouts[id] ?? '';
    askProgressCard(cfg, sentFacts(data, f, from, to), { title: CARD_TITLE[id] ?? id, readout, extra: extras.current[id] }, question).then(async (a) => {
      const saved: Answer = { q: question, a, at: new Date().toISOString() };
      const all = await getSetting<Record<string, Answer>>('progressCardAsk', {});
      const next = { ...all, [id]: saved };
      await setSetting('progressCardAsk', next);
      setCardAnswers(next);
    }).catch((e) => setCardError({ id, text: (e as Error).message })).finally(() => setCardBusy(null));
  };

  return {
    on: !!cfg, status, error, written, refresh: () => setNonce((n) => n + 1),
    answer, showAnswer, setShowAnswer, askBusy, pending, askError, ask, ready,
    asking, setAsking: (id) => { setAsking(id); setCardError(null); }, cardAnswers, cardBusy, cardError, askCard,
    setExtra: (id, words) => { extras.current[id] = words; },
  };
}

const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** The headline panel: between the ticker and the cards, with the ready questions and a box for the rider's own. */
export function ProgressCoach({ coach }: { coach: ProgressCoachState }) {
  const [q, setQ] = useState('');
  if (!coach.on) return null;
  const send = (text: string) => { coach.ask(text); setQ(''); };
  const answering = coach.showAnswer && (coach.askBusy || coach.askError || coach.answer);
  return (
    <section class="pcoach panel" aria-label="The coach on this page" aria-live="polite">
      <div class="pcoach-head">
        <b class="coach-mark">Coach</b>
        {coach.written && !answering && <span class="faint small">written {when(coach.written.at)}</span>}
        <span style="flex:1" />
        {answering ? <button class="btn quiet sm" onClick={() => coach.setShowAnswer(false)}>Summary</button>
          : coach.answer ? <button class="btn quiet sm" onClick={() => coach.setShowAnswer(true)}>Last answer</button> : null}
        {!answering && coach.status === 'idle' && <button class="btn quiet sm" onClick={coach.refresh}>Refresh</button>}
      </div>
      <div class="pcoach-body">
        {answering ? (
          <>
            <p class="faint small" style="margin:0 0 4px">You asked: {coach.askBusy || coach.askError ? coach.pending : coach.answer?.q}</p>
            {coach.askBusy ? <p class="muted" style="margin:0">The coach is reading the page…</p>
              : coach.askError ? <p style="margin:0;color:var(--bad)">No answer came: {coach.askError}</p>
              : <p style="margin:0">{coach.answer!.a}</p>}
          </>
        ) : coach.status === 'waiting' && !coach.written ? <p class="muted" style="margin:0">The coach is reading the page…</p>
          : coach.status === 'error' ? <p style="margin:0">No answer came: {coach.error} <button class="btn sm" style="margin-left:6px" onClick={coach.refresh}>Try again</button></p>
          : coach.written ? <p style="margin:0">{coach.written.headline}</p> : null}
      </div>
      <div class="pcoach-ask">
        {coach.ready.map((r) => <button key={r} class="chip sm" disabled={coach.askBusy} onClick={() => { setQ(r); send(r); }}>{r}</button>)}
        <div class="pcoach-box">
          <input value={q} aria-label="Ask the coach about this page" placeholder="Ask about this page" onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') send(q); }} disabled={coach.askBusy} />
          <button class={`btn sm${q.trim() ? ' primary' : ''}`} onClick={() => send(q)} disabled={coach.askBusy || !q.trim()}>Ask</button>
        </div>
      </div>
    </section>
  );
}

/** "Ask the coach" in a card's heading: only with an AI connected. */
export function CardAsk({ coach, id, short }: { coach: ProgressCoachState; id: string; short?: boolean }) {
  if (!coach.on) return null;
  const open = coach.asking === id;
  return <button class={`pc-ask${open ? ' on' : ''}`} aria-expanded={open} aria-label={`Ask the coach about ${CARD_TITLE[id]?.toLowerCase() ?? 'this card'}`} onClick={() => coach.setAsking(open ? null : id)}>{short ? 'Ask' : 'Ask the coach'}</button>;
}

/** The foot of a card: the coach's line, or the open question box with the last answer. Nothing at all when there is neither. */
export function CardCoachLine({ coach, id, asking }: { coach: ProgressCoachState; id: string; asking: boolean }) {
  const [q, setQ] = useState('');
  if (!coach.on) return null;
  // The fitness chart keeps its own question box (with the lines on screen): see Progress.
  if (asking && id !== 'fitness') {
    const busy = coach.cardBusy === id;
    const err = coach.cardError?.id === id ? coach.cardError.text : null;
    const a = coach.cardAnswers[id];
    return (
      <div class="card-ask">
        <div class="row" style="gap:8px">
          <input value={q} aria-label={`Ask the coach about ${CARD_TITLE[id]?.toLowerCase()}`} placeholder="Ask about this card" onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { coach.askCard(id, q); setQ(''); } }} style="flex:1;min-width:0" disabled={busy} />
          <button class="btn primary sm" onClick={() => { coach.askCard(id, q); setQ(''); }} disabled={busy || !q.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
          <button class="btn quiet sm" onClick={() => coach.setAsking(null)}>Close</button>
        </div>
        {busy && <p class="small muted" style="margin:6px 0 0">The coach is reading this card…</p>}
        {err && <p class="small" style="margin:6px 0 0;color:var(--bad)">No answer came: {err}</p>}
        {a && !busy && !err && <div class="coach-line small" style="margin-top:6px"><div class="faint" style="margin-bottom:2px">You asked: {a.q}</div><div><b class="coach-mark">Coach</b> {a.a}</div></div>}
      </div>
    );
  }
  if (asking) return null;
  const line = coach.status === 'idle' ? coach.written?.lines[id] : undefined;
  // "Ask the coach" sits at the foot, with the coach's line when there is one, so a card's heading never wraps.
  if (!line) return <div class="coach-foot"><CardAsk coach={coach} id={id} /></div>;
  return <p class="coach-line small"><b class="coach-mark">Coach</b> {line} <CardAsk coach={coach} id={id} short /></p>;
}
