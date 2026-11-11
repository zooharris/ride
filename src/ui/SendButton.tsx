import { useState } from 'preact/hooks';
import type { Basis, PlannedWorkout, Profile, Workout } from '../engine/types';
import { basisFor, hasTwoVersions, onGarmin, sendDefault, sendWords, type PlanDays, type SendChoice, type Where } from '../library/sendWhere';
import { sendPlanned } from './planService';
import { credentials } from '../sync/syncService';
import { notify } from './store';
import { toast } from './Toast';

/**
 * How a session goes to the Garmin is chosen when it is sent (10 Nov 2026 evening brief). One design everywhere: a
 * two-part button whose main part sends what its words say, in one tap, and a small arrow that offers the rest. For a
 * ride with two versions the arrow opens a small panel (targets, version, and its own Send); otherwise a short menu.
 * Nothing is chosen anywhere else, and nothing is sent unless the rider presses a Send.
 */

const BASIS_WORD: Record<Basis, string> = { power: 'power', hr: 'heart rate' };
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Where the version's starting choice comes from, in a line for the panel. */
function versionSource(entry: PlannedWorkout, w: Workout, plans: PlanDays[], where: Where): string {
  const word = where === 'outdoor' ? 'Outdoor' : 'As written';
  if (w.source === 'mine') return 'As written: you built this workout.';
  const plan = (entry.planId && plans.find((p) => p.id === entry.planId)) || plans.find((p) => p.start <= entry.date && entry.date <= p.goalDate);
  const day = new Date(entry.date + 'T00:00:00').getDay();
  if (plan && plan.availability?.outdoor?.[day] != null) return `${word} is your plan's choice for a ${WEEKDAY[day]}.`;
  return `${word} is this ride's own setting.`;
}

async function doSend(entry: PlannedWorkout, w: Workout, profile: Profile, choice: SendChoice): Promise<boolean> {
  const c = await credentials();
  if (!c) { toast({ ok: false, text: 'Connect Intervals.icu in Settings to send sessions to your Garmin.' }); return false; }
  const again = entry.status === 'sent';
  try {
    const r = await sendPlanned(c, entry, w, profile, choice);
    notify();
    const words = w.kind === 'ride' ? ` ${sendWords(r.sent)}` : '';
    toast({ ok: true, text: again ? `Sent again${words}: the copy on your Garmin is replaced after its next phone sync.` : `Sent${words}. It will be on your Garmin after the next phone sync, under Training, Workouts.` });
    return true;
  } catch (e) { toast({ ok: false, text: `Could not send: ${(e as Error).message}` }); return false; }
}

export function SendButton({ w, entry, profile, plans, large, primary }: { w: Workout; entry: PlannedWorkout; profile: Profile; plans: PlanDays[]; large?: boolean; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sent = entry.status === 'sent';
  const ride = w.kind === 'ride';
  const two = ride && hasTwoVersions(w);
  const twoWay = ride && w.bases.length > 1;
  const now = sent ? onGarmin(entry, w, plans) : undefined;
  const def = sendDefault(entry, w, profile.basis, plans);
  const main = now ?? def;
  const [pick, setPick] = useState<SendChoice>(main);
  const go = async (choice: SendChoice) => { setBusy(true); setOpen(false); await doSend(entry, w, profile, choice); setBusy(false); };
  const label = busy ? 'Sending…' : sent ? 'Send again' : ride ? `Send to Garmin ${sendWords(def)}` : 'Send to Garmin';
  const arrow = twoWay || two;
  const size = `${large ? '' : ' sm'}${primary ? ' primary' : ''}`;
  return (
    <span class="send-wrap">
      {sent && ride && <span class="send-has">On your Garmin, {sendWords(now!)}.</span>}
      <span class="split">
        <button class={`btn${size} split-main${arrow ? '' : ' alone'}`} disabled={busy} onClick={() => void go(main)}>{label}</button>
        {arrow && <button class={`btn${size} split-arrow${open ? ' open' : ''}`} disabled={busy} aria-label={two ? 'Choose how to send' : 'Choose power or heart rate'} aria-expanded={open} onClick={() => { setPick(main); setOpen(!open); }}>▾</button>}
      </span>
      {open && (
        <>
          <button class="send-pop-bg" aria-label="Close" onClick={() => setOpen(false)} />
          <div class="send-pop" role="dialog" aria-label="How to send">
            {!two ? (['power', 'hr'] as Basis[]).map((b) => (
              <button key={b} class={`send-item${b === main.basis ? ' on' : ''}`} onClick={() => void go({ basis: b })}>
                <span>{sent ? 'Send again' : 'Send'} by {BASIS_WORD[b]}</span>
                {b === main.basis && <span class="send-note">{sent ? 'on your Garmin now' : 'your default'}</span>}
              </button>
            )) : (
              <div class="send-panel">
                {twoWay && <div class="send-row"><span class="small muted">Targets</span>
                  <div class="seg" role="group" aria-label="Targets">{(['power', 'hr'] as Basis[]).map((b) => <button key={b} class={pick.basis === b ? 'on' : ''} aria-pressed={pick.basis === b} onClick={() => setPick({ ...pick, basis: b })}>{b === 'hr' ? 'Heart rate' : 'Power'}</button>)}</div></div>}
                <div class="send-row"><span class="small muted">Version</span>
                  <div class="seg" role="group" aria-label="Version">{(['outdoor', 'trainer'] as Where[]).map((x) => <button key={x} class={pick.where === x ? 'on' : ''} aria-pressed={pick.where === x} onClick={() => setPick({ ...pick, where: x })}>{x === 'outdoor' ? 'Outdoor' : 'As written'}</button>)}</div></div>
                <p class="faint small" style="margin:0">{sent ? `On your Garmin now: ${sendWords(now!)}.` : versionSource(entry, w, plans, def.where ?? 'trainer')}</p>
                <button class="btn sm" style="align-self:flex-end" onClick={() => void go({ basis: basisFor(w, pick.basis), where: pick.where })}>{sent ? 'Send again' : 'Send'}</button>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}

/** A session's row word on the calendar: a sent ride says how it went (10 Nov 2026 evening brief). */
export function sentRowWord(entry: PlannedWorkout, w: Workout | undefined, plans: PlanDays[]): string | undefined {
  if (entry.status !== 'sent' || !w || w.kind !== 'ride') return undefined;
  const g = onGarmin(entry, w, plans);
  return `On Garmin, ${g.basis === 'hr' ? 'by heart rate' : 'by power'}${g.where === 'outdoor' ? ', outdoor' : ''}`;
}

/** Whether a session has anything to choose when sent: two kinds of target, or two versions. */
export const hasSendChoice = (w: Workout | undefined): boolean => !!w && w.kind === 'ride' && (w.bases.length > 1 || hasTwoVersions(w));

/**
 * The week's send (Calendar option 1 and 2, tidied 10 Nov 2026). One tap sends every unsent session with the defaults.
 * The arrow appears only when a ride has something to choose: with one such ride it offers that ride's own choices,
 * named; with several, all by one kind of target, or a sheet listing just those rides. Everything else goes as it is.
 */
export function WeekSendButton({ items, profile, plans }: { items: Array<{ p: PlannedWorkout; w: Workout }>; profile: Profile; plans: PlanDays[] }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Record<string, SendChoice> | null>(null);
  const [pick, setPick] = useState<SendChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const n = items.length;
  const choosers = items.filter(({ w }) => hasSendChoice(w));
  const only = choosers.length === 1 ? choosers[0] : undefined;
  const anyTwoWay = choosers.some(({ w }) => w.bases.length > 1);
  const other: Basis = profile.basis === 'hr' ? 'power' : 'hr';
  async function send(pickFor: (p: PlannedWorkout, w: Workout) => SendChoice | undefined) {
    setOpen(false); setSheet(null);
    const c = await credentials();
    if (!c) { toast({ ok: false, text: 'Connect Intervals.icu in Settings to send sessions to your Garmin.' }); return; }
    setBusy(true);
    let sent = 0;
    try {
      for (const { p, w } of items) { await sendPlanned(c, p, w, profile, pickFor(p, w)); sent++; }
      toast({ ok: true, text: `Sent ${sent}.` });
    } catch (e) { toast({ ok: false, text: `Sent ${sent}, then: ${(e as Error).message}` }); }
    finally { setBusy(false); notify(); }
  }
  const allBy = (b: Basis) => (p: PlannedWorkout, w: Workout) => (w.kind === 'ride' ? { ...sendDefault(p, w, profile.basis, plans), basis: basisFor(w, b) } : undefined);
  /** The whole week, with one ride as chosen and everything else on its defaults. */
  const withOnly = (c: SendChoice) => (p: PlannedWorkout) => (only && p.id === only.p.id ? c : undefined);
  const openSheet = () => { setOpen(false); setSheet(Object.fromEntries(choosers.map(({ p, w }) => [p.id, sendDefault(p, w, profile.basis, plans)]))); };
  const toggle = () => { if (only) setPick(sendDefault(only.p, only.w, profile.basis, plans)); setOpen(!open); };
  const label = busy ? 'Sending…' : `Send ${n} to Garmin${choosers.length ? ` by ${BASIS_WORD[profile.basis]}` : ''}`;
  const rest = n - choosers.length;
  return (
    <span class="send-wrap">
      <span class="split">
        <button class={`btn sm split-main${choosers.length ? '' : ' alone'}`} disabled={busy} onClick={() => void send(() => undefined)}>{label}</button>
        {choosers.length > 0 && <button class={`btn sm split-arrow${open ? ' open' : ''}`} disabled={busy} aria-label={only ? `Choose how to send ${only.w.name}` : 'Choose how to send the week'} aria-expanded={open} onClick={toggle}>▾</button>}
      </span>
      {choosers.length === 0 && <span class="faint small">nothing to choose this week</span>}
      {open && (
        <>
          <button class="send-pop-bg" aria-label="Close" onClick={() => setOpen(false)} />
          <div class="send-pop right" role="dialog" aria-label={only ? `How to send ${only.w.name}` : 'How to send the week'}>
            {only && !hasTwoVersions(only.w) ? (['power', 'hr'] as Basis[]).map((b) => (
              <button key={b} class={`send-item${b === profile.basis ? ' on' : ''}`} onClick={() => void send(withOnly({ basis: b }))}>
                <span>{only.w.name} by {BASIS_WORD[b]}</span>{b === profile.basis && <span class="send-note">your default</span>}
              </button>
            )) : only && pick ? (
              <div class="send-panel">
                <b>{only.w.name}</b>
                {only.w.bases.length > 1 && <div class="send-row"><span class="small muted">Targets</span>
                  <div class="seg" role="group" aria-label="Targets">{(['power', 'hr'] as Basis[]).map((b) => <button key={b} class={pick.basis === b ? 'on' : ''} aria-pressed={pick.basis === b} onClick={() => setPick({ ...pick, basis: b })}>{b === 'hr' ? 'Heart rate' : 'Power'}</button>)}</div></div>}
                <div class="send-row"><span class="small muted">Version</span>
                  <div class="seg" role="group" aria-label="Version">{(['outdoor', 'trainer'] as Where[]).map((x) => <button key={x} class={pick.where === x ? 'on' : ''} aria-pressed={pick.where === x} onClick={() => setPick({ ...pick, where: x })}>{x === 'outdoor' ? 'Outdoor' : 'As written'}</button>)}</div></div>
                <p class="faint small" style="margin:0">{versionSource(only.p, only.w, plans, sendDefault(only.p, only.w, profile.basis, plans).where ?? 'trainer')}{rest > 0 ? ` The other ${rest} ${rest === 1 ? 'session goes' : 'sessions go'} as ${rest === 1 ? 'it is' : 'they are'}.` : ''}</p>
                <button class="btn sm" style="align-self:flex-end" onClick={() => void send(withOnly({ basis: basisFor(only.w, pick.basis), where: pick.where }))}>Send {n}</button>
              </div>
            ) : (
              <>
                {anyTwoWay && <button class="send-item on" onClick={() => void send(allBy(profile.basis))}><span>All by {BASIS_WORD[profile.basis]}</span><span class="send-note">your default</span></button>}
                {anyTwoWay && <button class="send-item" onClick={() => void send(allBy(other))}><span>All by {BASIS_WORD[other]}</span></button>}
                <button class={`send-item${anyTwoWay ? ' sep' : ''}`} onClick={openSheet}><span>Choose for each ride…</span></button>
              </>
            )}
          </div>
        </>
      )}
      {sheet && (
        <div class="modal-bg" onClick={() => setSheet(null)}>
          <div class="modal" style="max-width:560px" role="dialog" aria-label={`Send ${n} to your Garmin`} onClick={(e) => e.stopPropagation()}>
            <h2 style="margin:0">Send {n} {n === 1 ? 'session' : 'sessions'} to your Garmin</h2>
            <p class="muted small" style="margin:4px 0 12px">Each ride starts on your default. Change any you like.</p>
            <div class="send-sheet">
              {choosers.map(({ p, w }) => {
                const c = sheet[p.id];
                const set = (x: Partial<SendChoice>) => setSheet({ ...sheet, [p.id]: { ...c, ...x } });
                return (
                  <div class="send-sheet-row" key={p.id}>
                    <span class="faint small" style="width:34px">{WEEKDAY[new Date(p.date + 'T00:00:00').getDay()].slice(0, 3)}</span>
                    <b style="flex:1;min-width:0">{w.name}</b>
                    <span class="send-sheet-picks">
                      {w.bases.length > 1 ? <span class="seg" role="group" aria-label={`${w.name}: targets`}>{(['power', 'hr'] as Basis[]).map((b) => <button key={b} class={c.basis === b ? 'on' : ''} aria-pressed={c.basis === b} onClick={() => set({ basis: b })}>{b === 'hr' ? 'Heart rate' : 'Power'}</button>)}</span>
                        : <span class="faint small">{w.bases[0] === 'hr' ? 'heart rate only' : 'power only'}</span>}
                      {hasTwoVersions(w) && <span class="seg" role="group" aria-label={`${w.name}: version`}>{(['outdoor', 'trainer'] as Where[]).map((x) => <button key={x} class={c.where === x ? 'on' : ''} aria-pressed={c.where === x} onClick={() => set({ where: x })}>{x === 'outdoor' ? 'Outdoor' : 'As written'}</button>)}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {rest > 0 && <p class="faint small" style="margin:10px 0 0">Plus {rest} other {rest === 1 ? 'session, sent as it is' : 'sessions, sent as they are'}.</p>}
            <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">
              <button class="btn" onClick={() => setSheet(null)}>Cancel</button>
              <button class="btn primary" onClick={() => void send((p) => sheet[p.id])}>Send {n}</button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
