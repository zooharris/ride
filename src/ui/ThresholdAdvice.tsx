/**
 * Step 2, Part B: the coach's FTP estimate and zone analysis, on request.
 * Each is a button that reads the rider's rides and comes back as a card with
 * the coach's reasoning and Update / Apply or Keep. Nothing changes until the
 * rider presses Update or Apply. The last answer is kept (and synced), so it is
 * still here after a reload or on another device until the rider decides.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Profile } from '../engine/types';
import type { FtpAdvice, ThresholdMode, ZoneAdvice } from '../coach/claude';
import { ladderTops, rideHrZones, ridePowerZones } from '../engine/zones';
import { askCoachThreshold, getAdvice, setAdviceChoice, type StoredAdvice } from './thresholdService';
import { applyZones, resendRides, sentRidesAhead, takeThreshold, zonesFollowFtp } from './testService';
import { loadAppData, type AppData } from './store';
import { db } from '../data/db';
import { fmtDate } from './derived';
import { toast } from './Toast';

const choiceWords = (a: StoredAdvice) => (a.choice === 'updated' || a.choice === 'applied' ? 'taken' : a.choice === 'kept' ? 'kept' : 'not decided');

/** Ask, keep the answer, and the stored answer on mount. */
function useAsk(mode: ThresholdMode, data?: AppData) {
  const [stored, setStored] = useState<StoredAdvice | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void getAdvice(mode).then(setStored); }, [mode]);
  const ask = async () => {
    setBusy(true); setErr(null);
    try {
      const a = await askCoachThreshold(data ?? (await loadAppData()), mode);
      if (a.advice.failed) setErr(`The coach's answer couldn't be read (${a.advice.failed}). Try again.`);
      else setStored(a);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const choose = async (c: StoredAdvice['choice']) => { await setAdviceChoice(mode, c); setStored((s) => (s ? { ...s, choice: c } : s)); };
  return { stored, busy, err, ask, choose };
}

function NeedsTest({ text }: { text?: string }) {
  if (!text) return null;
  return <p class="small" style="margin:8px 0 0">A ramp test would settle this: {text} <a href="#/workout/lib-ramp">Ramp Test</a></p>;
}

/** "Estimate my FTP", and the coach's answer. */
export function CoachFtp({ profile, data, onChanged }: { profile: Profile; data?: AppData; onChanged?: () => void }) {
  const { stored, busy, err, ask, choose } = useAsk('ftp', data);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ahead, setAhead] = useState(0);
  const a = stored?.advice as FtpAdvice | undefined;
  const open = !!a && !stored?.choice;
  const update = async () => {
    if (!a?.ftp) return;
    const r = await takeThreshold({ ftp: a.ftp });
    setMsg(r);
    await choose('updated');
    onChanged?.();
    const [p, w] = await Promise.all([db.planned.toArray(), db.workouts.toArray()]);
    setAhead(sentRidesAhead(p, w).length);
  };
  const resend = async () => {
    const [p, w] = await Promise.all([db.planned.toArray(), db.workouts.toArray()]);
    toast(await resendRides(sentRidesAhead(p, w)));
    setAhead(0);
  };
  return (
    <div class="coach-adv">
      {busy ? <p class="muted small" style="margin:6px 0 0">Reading your rides…</p>
        : <div class="row wrap" style="gap:8px;align-items:center;margin-top:6px">
            <button class="btn sm" onClick={() => void ask()}>Estimate my FTP</button>
            {stored && !open && <span class="faint small">Last asked {fmtDate(stored.date, { month: 'long', day: 'numeric' })}: {a?.ftp ? `${a.ftp} W` : 'no number'}, {choiceWords(stored)}.</span>}
          </div>}
      {err && <p class="small" style="color:var(--bad);margin:6px 0 0">{err}</p>}
      {a && (open || msg) && (
        <div class="panel coach-card">
          <div class="row between wrap" style="gap:8px"><b>{a.ftp ? <>The coach puts your FTP at <span class="num">{a.ftp} W</span></> : 'Not enough to go on yet'}</b></div>
          <p class="small" style="margin:6px 0 0">{a.why}</p>
          <NeedsTest text={a.needsTest} />
          {open && a.ftp && a.ftp !== profile.ftp && (
            <div class="row wrap" style="gap:8px;margin-top:10px">
              <button class="btn primary" onClick={() => void update()}>Update my FTP to {a.ftp} W</button>
              <button class="btn quiet" onClick={() => void choose('kept')}>Keep {profile.ftp} W</button>
            </div>
          )}
          {open && (!a.ftp || a.ftp === profile.ftp) && <div class="row" style="margin-top:8px"><button class="btn quiet sm" onClick={() => void choose('kept')}>Done</button></div>}
          {msg && <p class="small" style={`margin:8px 0 0;color:${msg.ok ? 'var(--ink-2)' : 'var(--bad)'}`}>{msg.text} {msg.ok && (zonesFollowFtp(profile) ? 'Your power zones follow your FTP.' : 'Your power zones are set in watts and stay as they are.')}</p>}
          {ahead > 0 && <button class="btn" style="margin-top:8px" onClick={() => void resend()}>Re-send {ahead} ride{ahead === 1 ? '' : 's'} to Garmin with the new numbers</button>}
        </div>
      )}
    </div>
  );
}

/** "Analyse my zones", and the coach's proposed tables beside the current ones. */
export function CoachZones({ profile, data, label = 'Analyse my zones', onEditFirst, onChanged }: { profile: Profile; data?: AppData; label?: string; onEditFirst?: (powerTops?: number[], hrTops?: number[]) => void; onChanged?: () => void }) {
  const { stored, busy, err, ask, choose } = useAsk('zones', data);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const a = stored?.advice as ZoneAdvice | undefined;
  const open = !!a && !stored?.choice;
  const nowP = ladderTops(ridePowerZones(profile), profile.ftp);
  const nowH = ladderTops(rideHrZones(profile), profile.lthr);
  const changed = (a?.powerTops && a.powerTops.some((t, i) => t !== nowP[i])) || (a?.hrTops && a.hrTops.some((t, i) => t !== nowH[i]));
  const apply = async () => { setMsg(await applyZones(a?.powerTops, a?.hrTops)); await choose('applied'); onChanged?.(); };
  return (
    <div class="coach-adv">
      {busy ? <p class="muted small" style="margin:6px 0 0">Reading your rides…</p>
        : <div class="row wrap" style="gap:8px;align-items:center;margin-top:6px">
            <button class="btn sm" onClick={() => void ask()}>{label}</button>
            {stored && !open && !msg && <span class="faint small">Last asked {fmtDate(stored.date, { month: 'long', day: 'numeric' })}: {choiceWords(stored)}.</span>}
          </div>}
      {err && <p class="small" style="color:var(--bad);margin:6px 0 0">{err}</p>}
      {a && (open || msg) && (
        <div class="panel coach-card">
          <div class="row between wrap" style="gap:8px"><b>{changed ? 'The coach suggests these zones' : 'The coach would keep your zones'}</b></div>
          {changed && (
            <div class="coach-tables">
              {a.powerTops && <ZoneCompare title="Power zones (top of each, watts)" now={nowP} next={a.powerTops} unit="W" />}
              {a.hrTops && <ZoneCompare title="Heart-rate zones (top of each, bpm)" now={nowH} next={a.hrTops} unit="bpm" />}
            </div>
          )}
          {a.why.length > 0 && <ul class="small coach-why">{a.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {a.trust && <p class="small" style="margin:6px 0 0">{a.trust}</p>}
          <NeedsTest text={a.needsTest} />
          {open && changed && (
            <div class="row wrap" style="gap:8px;margin-top:10px">
              <button class="btn primary" onClick={() => void apply()}>Apply these zones</button>
              {onEditFirst ? <button class="btn" onClick={() => { onEditFirst(a.powerTops, a.hrTops); void choose('applied'); }}>Edit first</button> : <a class="btn" href="#/settings">Edit first in Settings</a>}
              <button class="btn quiet" onClick={() => void choose('kept')}>Keep my zones</button>
            </div>
          )}
          {open && !changed && <div class="row" style="margin-top:8px"><button class="btn quiet sm" onClick={() => void choose('kept')}>Done</button></div>}
          {msg && <p class="small" style={`margin:8px 0 0;color:${msg.ok ? 'var(--ink-2)' : 'var(--bad)'}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}

function ZoneCompare({ title, now, next, unit }: { title: string; now: number[]; next: number[]; unit: string }) {
  return (
    <table class="coach-zt">
      <caption>{title}</caption>
      <thead><tr><th>Zone</th><th>Now</th><th>Suggested</th></tr></thead>
      <tbody>{next.map((t, i) => (
        <tr key={i} class={t !== now[i] ? 'moved' : ''}><td>{i + 1}</td><td class="num">{now[i]} {unit}</td><td class="num">{t} {unit}{t !== now[i] ? <span class="faint"> ({t > now[i] ? '+' : ''}{t - now[i]})</span> : null}</td></tr>
      ))}</tbody>
    </table>
  );
}
