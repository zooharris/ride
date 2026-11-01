import { coachConfig } from './coachConfig';
import type { CoachConfig } from '../coach/llm';
import { useEffect, useRef, useState } from 'preact/hooks';
import { askCoach, dailyNote, type ChatTurn, type CoachContext } from '../coach/claude';
import { buildPacket } from '../coach/packet';
import type { Judgment } from '../coach/judge';
import type { Replan } from '../engine/adapt';
import { getSetting, setSetting } from '../data/db';
import { ensureJudgment, getJudgment, judgeInputs, onJudgment } from './judgeService';
import type { AppData } from './store';
import { fmtDate } from './derived';

/** `v` 2: notes written since thinking was turned off; earlier ones may have been cut off mid-sentence and are written again. */
interface SavedNote { date: string; text: string; sig?: string; at?: string; v?: number }
interface SavedChat { date: string; turns: ChatTurn[] }

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

/**
 * The coach, always in one place. With the coach judging (Settings › Coach on,
 * 1 Nov 2026), its judgment of the day: a note and its view of where you are,
 * made from your recent activities, how you performed in them, your overnight
 * numbers, your notes and your plan; Check again asks afresh. Every device shows
 * the latest judgment; asking needs a key on this device. With the coach off and
 * a key, a short daily note as before. Below, a box for questions, answered from
 * the same evidence.
 */
export function CoachPanel({ ctx, date, daySig, data, check }: { ctx: CoachContext; date: string; daySig: string; data: AppData; check: Replan | null }) {
  const [key, setKey] = useState<CoachConfig | '' | null>(null);
  const [judging, setJudging] = useState<boolean | null>(null);
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<SavedNote | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [answering, setAnswering] = useState(false);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    let alive = true;
    const load = () => void getJudgment().then((j) => alive && setJudgment(j));
    load();
    const off = onJudgment(load);
    return () => { alive = false; off(); };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void getJudgment().then(setJudgment); }, [data]);

  async function refresh(apiKey: CoachConfig) {
    setUpdating(true);
    try {
      const text = await dailyNote(apiKey, ctxRef.current);
      const saved: SavedNote = { date, text, sig: daySig, at: new Date().toISOString(), v: 2 };
      await setSetting('coachNote', saved);
      setNote(saved);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally { setUpdating(false); }
  }

  async function checkAgain() {
    setAsking(true);
    setError(null);
    try { const j = await ensureJudgment(dataRef.current, { force: true, check }); if (j) setJudgment(j); }
    catch (e) { setError((e as Error).message); }
    finally { setAsking(false); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const k = (await coachConfig()) ?? '';
      const auto = await getSetting<boolean>('coachAuto', false);
      if (!alive) return;
      setKey(k);
      setJudging(auto);
      const chat = await getSetting<SavedChat | null>('coachChat', null);
      if (alive) setTurns(chat?.date === date ? chat.turns : []);
      if (auto) return;   // the judgment is the note; it is asked for by the recommendations and after each pull
      const cached = await getSetting<SavedNote | null>('coachNote', null);
      if (!k) { if (alive && cached?.date === date && cached.text) setNote(cached); return; }
      if (cached?.date === date && cached.text && cached.v === 2) {
        if (alive) setNote(cached);
        if ((cached.sig ?? '') === daySig) return;
      }
      if (alive) await refresh(k);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, daySig]);

  async function ask() {
    const q = question.trim();
    if (!q || !key) return;
    setAnswering(true);
    const asked: ChatTurn = { role: 'rider', text: q, at: new Date().toISOString() };
    setTurns((t) => [...t, asked]);
    setQuestion('');
    try {
      const earlier = [judging && judgment && !judgment.failed ? `${judgment.note} ${judgment.assessment}` : note?.text].filter((x): x is string => !!x);
      // Questions are answered from the same evidence the judgment uses.
      let packet: string | undefined;
      try { packet = buildPacket((await judgeInputs(dataRef.current, check)).packet); } catch { packet = undefined; }
      const answer = await askCoach(key, ctxRef.current, turns, q, earlier, packet);
      const next = [...turns, asked, { role: 'coach' as const, text: answer, at: new Date().toISOString() }];
      setTurns(next);
      await setSetting('coachChat', { date, turns: next.filter((t, i) => !t.error && !(t.role === 'rider' && next[i + 1]?.error)) } as SavedChat);
    } catch (e) {
      setTurns([...turns, asked, { role: 'coach' as const, text: (e as Error).message, error: true as const }]);
    } finally { setAnswering(false); }
  }

  if (key === null || judging === null) return null;

  const shownJudgment = judgment && !judgment.failed && judgment.date >= fmtIso(date, -1) ? judgment : null;
  const yesterdays = shownJudgment && shownJudgment.date !== date;

  const judgmentBody = shownJudgment ? (
    <>
      <p style="font-size:15px;line-height:1.6;margin:0">{shownJudgment.note}</p>
      {shownJudgment.assessment && <p class="small" style="margin-top:8px;line-height:1.55;color:var(--ink-2)"><b style="font-weight:600">Where you are:</b> {shownJudgment.assessment}</p>}
      <p class="faint small" style="margin-top:6px">{asking ? 'Looking at your latest data…' : yesterdays ? `Yesterday's view (${fmtDate(shownJudgment.date, { weekday: 'long' })}, ${time(shownJudgment.at)}); a new one comes when this morning's numbers arrive.` : `Made at ${time(shownJudgment.at)}${key ? '' : ' on another of your devices'} from your recent activities, how you rode them, your overnight numbers, your notes and your plan.`}</p>
    </>
  ) : asking ? <p class="muted small" style="margin:0">The coach is looking at your data…</p> : null;

  if (!key) {
    const body = judging ? judgmentBody : note ? <><p style="font-size:15px;line-height:1.6;margin:0">{note.text}</p><p class="faint small" style="margin-top:6px">Written at {time(note.at)} on another of your devices.</p></> : null;
    return (
      <section class="section">
        <h2>Coach</h2>
        {body ? (
          <div class="panel" style="margin-top:8px;padding:14px 16px">
            {body}
            <p class="faint small" style="margin:12px 0 0">To ask the coach a question or have it look again from this device, add an API key in <a href="#/settings">Settings</a>.</p>
          </div>
        ) : <p class="muted small" style="margin-top:6px">Add an API key (Claude, ChatGPT or Gemini) in <a href="#/settings">Settings</a> for the coach's daily view of your training and answers to your questions. A view made on another of your devices shows here too.</p>}
      </section>
    );
  }

  return (
    <section class="section">
      <div class="row between">
        <h2>Coach</h2>
        {judging
          ? <button class="btn sm" onClick={checkAgain} disabled={asking}>{asking ? 'Looking…' : 'Check again'}</button>
          : <button class="btn sm" onClick={() => refresh(key)} disabled={updating}>{updating ? 'Writing…' : 'Fresh note'}</button>}
      </div>
      <div class="panel" style="margin-top:8px;padding:14px 16px">
        {judging ? (judgmentBody ?? <p class="muted small" style="margin:0">The coach's view of today comes once this morning's numbers are in, or press Check again.</p>) : note ? (
          <>
            <p style="font-size:15px;line-height:1.6;margin:0">{note.text}</p>
            <p class="faint small" style="margin-top:6px">{updating ? 'Updating for the latest changes…' : `Written at ${time(note.at)}${note.sig !== daySig ? '; the day has changed since then' : ''}.`}</p>
          </>
        ) : updating ? <p class="muted small" style="margin:0">The coach is writing today's note…</p> : null}
        {error && <p class="msg err small" style="margin-top:8px">The coach couldn't answer: {error}</p>}

        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
          {turns.length > 0 && (
            <div class="stack" style="gap:8px;margin-bottom:10px">
              {turns.map((t, i) => t.error
                ? <div key={i} class="msg err small">No answer: {t.text}</div>
                : (
                  <div key={i} class="small" style={`line-height:1.55;${t.role === 'rider' ? 'color:var(--ink-2)' : ''}`}>
                    <b>{t.role === 'rider' ? 'You' : 'Coach'}:</b> {t.text}
                  </div>
                ))}
            </div>
          )}
          <form class="row" style="gap:8px" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <input style="flex:1" value={question} placeholder="Ask the coach a question" onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} disabled={answering} aria-label="Question for the coach" />
            <button class="btn sm" type="submit" disabled={answering || !question.trim()}>{answering ? 'Thinking…' : 'Ask'}</button>
          </form>
          <p class="faint small" style="margin-top:6px">The coach answers from your recent activities, overnight numbers, calendar and notes. It cannot change the plan itself; its recommended changes appear with the plan above, for you to accept or not.</p>
        </div>
      </div>
    </section>
  );
}

function fmtIso(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
