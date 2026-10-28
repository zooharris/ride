import { useEffect, useRef, useState } from 'preact/hooks';
import { askCoach, dailyNote, type ChatTurn, type CoachContext } from '../coach/claude';
import { getSetting, setSetting } from '../data/db';
import type { SavedReview } from './planService';

/** `v` 2: notes written since thinking was turned off; earlier ones may have been cut off mid-sentence and are written again. */
interface SavedNote { date: string; text: string; sig?: string; at?: string; v?: number }
interface SavedChat { date: string; turns: ChatTurn[] }

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

/**
 * The coach, always in one place. The day's note (kept while a newer one is
 * written, so the panel never goes blank), the review of the last sync, and a
 * box for questions. Without a Claude key it says how to turn the coach on.
 */
export function CoachPanel({ ctx, date, daySig, review, onDismissReview, onRetryReview, retrying }: { ctx: CoachContext; date: string; daySig: string; review: SavedReview | null; onDismissReview: () => void; onRetryReview: () => void; retrying: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [note, setNote] = useState<SavedNote | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  // The latest picture of the day, whenever a request goes out.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  async function refresh(apiKey: string) {
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

  useEffect(() => {
    let alive = true;
    (async () => {
      const k = await getSetting<string>('claudeKey', '');
      if (!alive) return;
      setKey(k);
      const chat = await getSetting<SavedChat | null>('coachChat', null);
      if (alive) setTurns(chat?.date === date ? chat.turns : []);
      const cached = await getSetting<SavedNote | null>('coachNote', null);
      // Without a key, this device shows the latest note any device wrote (it travels with the plan), and asks for none.
      if (!k) { if (alive && cached?.date === date && cached.text) setNote(cached); return; }
      if (cached?.date === date && cached.text && cached.v === 2) {
        if (alive) setNote(cached);
        if ((cached.sig ?? '') === daySig) return;      // still current
      }
      if (alive) await refresh(k);                       // the old note stays on screen until this returns
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, daySig]);

  async function ask() {
    const q = question.trim();
    if (!q || !key) return;
    setAsking(true);
    const asked: ChatTurn = { role: 'rider', text: q, at: new Date().toISOString() };
    setTurns((t) => [...t, asked]);
    setQuestion('');
    try {
      const earlier = [note?.text, review && !review.failed ? review.text : undefined].filter((x): x is string => !!x);
      const answer = await askCoach(key, ctxRef.current, turns, q, earlier);
      const next = [...turns, asked, { role: 'coach' as const, text: answer, at: new Date().toISOString() }];
      setTurns(next);
      // Only answered turns are kept: a question that failed, and its error, stay on screen until reload.
      await setSetting('coachChat', { date, turns: next.filter((t, i) => !t.error && !(t.role === 'rider' && next[i + 1]?.error)) } as SavedChat);
    } catch (e) {
      setTurns([...turns, asked, { role: 'coach' as const, text: (e as Error).message, error: true as const }]);
    } finally { setAsking(false); }
  }

  if (key === null) return null;
  if (!key) {
    // The note and the review written on another device, read-only; asking needs this device's own key.
    if (!note && !review) {
      return (
        <section class="section">
          <h2>Coach</h2>
          <p class="muted small" style="margin-top:6px">Add a Claude API key in <a href="#/settings">Settings</a> for a daily note from the coach, a review after each sync, and answers to your questions. A note written on another of your devices shows here too.</p>
        </section>
      );
    }
    return (
      <section class="section">
        <h2>Coach</h2>
        <div class="panel" style="margin-top:8px;padding:14px 16px">
          {note && <>
            <p style="font-size:15px;line-height:1.6;margin:0">{note.text}</p>
            <p class="faint small" style="margin-top:6px">Written at {time(note.at)} on another of your devices.</p>
          </>}
          {review && !review.failed && (
            <div style={note ? 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line)' : ''}>
              <div class="row between"><b class="small">{review.at ? `Review of the activities synced at ${time(review.at)}` : 'Review of the latest synced activities'}</b><button class="btn sm quiet" onClick={onDismissReview}>Dismiss</button></div>
              <p style="margin-top:6px;font-size:15px;line-height:1.6">{review.text}</p>
            </div>
          )}
          <p class="faint small" style="margin:12px 0 0">To ask the coach a question or get a fresh note on this device, add a Claude API key in <a href="#/settings">Settings</a>.</p>
        </div>
      </section>
    );
  }

  return (
    <section class="section">
      <div class="row between">
        <h2>Coach</h2>
        <button class="btn sm" onClick={() => refresh(key)} disabled={updating}>{updating ? 'Writing…' : 'Fresh note'}</button>
      </div>
      <div class="panel" style="margin-top:8px;padding:14px 16px">
        {note ? (
          <>
            <p style="font-size:15px;line-height:1.6;margin:0">{note.text}</p>
            <p class="faint small" style="margin-top:6px">{updating ? 'Updating for the latest changes…' : `Written at ${time(note.at)}${note.sig !== daySig ? '; the day has changed since then' : ''}.`}</p>
          </>
        ) : updating ? <p class="muted small" style="margin:0">The coach is writing today's note…</p> : null}
        {error && <p class="msg err small" style="margin-top:8px">Coach note unavailable: {error}</p>}

        {review && (
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
            <div class="row between"><b class="small">{review.at ? `Review of the activities synced at ${time(review.at)}` : 'Review of the latest synced activities'}</b><button class="btn sm quiet" onClick={onDismissReview}>Dismiss</button></div>
            {review.failed ? (
              <div class="row between wrap" style="gap:8px;margin-top:6px">
                <span class="muted small">The coach's review couldn't be read ({review.failed}).</span>
                <button class="btn sm" onClick={onRetryReview} disabled={retrying}>{retrying ? 'Asking again…' : 'Try again'}</button>
              </div>
            ) : <p style="margin-top:6px;font-size:15px;line-height:1.6">{review.text}</p>}
          </div>
        )}

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
            <input style="flex:1" value={question} placeholder="Ask the coach a question" onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} disabled={asking} aria-label="Question for the coach" />
            <button class="btn sm" type="submit" disabled={asking || !question.trim()}>{asking ? 'Thinking…' : 'Ask'}</button>
          </form>
          <p class="faint small" style="margin-top:6px">The coach answers from today's numbers, calendar and your notes. It cannot change the plan; recommended changes appear with the plan above.</p>
        </div>
      </div>
    </section>
  );
}
