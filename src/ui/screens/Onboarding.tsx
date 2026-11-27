import { useState } from 'preact/hooks';
import { DEFAULT_PROFILE, getSetting, saveProfile, setSetting } from '../../data/db';
import type { Profile, Ride, UnsureNumber } from '../../engine/types';
import { notify } from '../store';
import { StackedLogo } from '../Brand';
import { NumberBox } from '../NumberBox';
import { TAGLINE } from '../../appName';
import { applyAthleteNumbers, fetchRides, testConnection, type AthleteNumbers, type IntervalsCredentials } from '../../sync/intervals';
import { syncAll } from '../../sync/syncService';
import { backupSummaryOf, fetchAutoBackup, restoreBackup, restoreBackupFile } from '../../data/backup';
import { DEVICE_CHOICE, DEVICES_ASK } from '../../data/devicesync';
import { backupMade } from '../../data/restoreWords';
import { appKind, inApp, thisDevice } from '../../shell';
import { APP_SHORT_NAME } from '../../appName';
import { addDays, today } from '../../engine/load';
import { deviceRegion, distUnitsOf, legacyUnits, mastersFor, miles, pounds, unitsForRegion, weightUnitsOf, type DistUnits, type WeightUnits } from '../../engine/units';
import { maxHrFromAge, standIns } from '../../engine/known';
import { fmtDate } from '../derived';
import { ask } from '../ask';

/**
 * First run. Nothing is required but the rider's own answers (25 Nov 2026): the first screen leads straight to setup,
 * and offers, as options, restoring from a backup file the rider picks, or connecting Intervals.icu, which
 * may already hold the rider's FTP, heart rates and weight. Where Intervals.icu holds Antogo's saved copy from another
 * device, the rider is told what and where it is and chooses: keep this device in step with the others, keep it
 * separate, or restore from a file instead. (13 Nov 2026: no made-up numbers.) Setup shows each number
 * marked with where it came from, or an empty box with what it is in plain words and
 * an "I don't know" that leads somewhere sensible: a test in the first week, or an
 * estimate marked as one. A rider who knows none of their numbers still gets a plan.
 */

/** How a number in the setup was arrived at. */
type Source = 'service' | 'typed' | 'unknown' | 'estimate';
interface Box { value?: number; source: Source; estimate?: { value: number; from: string } }

/** What the rider's recent history in Intervals.icu shows, for suggestions. */
export interface HistoryHints {
  weeklyHours?: number;
  ridesWithPower: number;
  ftp?: { value: number; from: string };
  lthr?: { value: number; from: string };
  maxHr?: { value: number; from: string };
}

/** Hints from the last eight weeks of activities (pure, for tests). */
export function historyHints(rides: Ride[], todayIso: string): HistoryHints {
  const from = addDays(todayIso, -56);
  const recent = rides.filter((r) => r.date >= from && r.date <= todayIso && !r.notTraining);
  const hours = recent.reduce((s, r) => s + (r.seconds || 0), 0) / 3600 / 8;
  const power = recent.filter((r) => r.sport === 'ride' && (r.averagePower ?? 0) > 0);
  // FTP: Intervals.icu's estimate from the rider's own rides of the last six weeks, the best of them.
  const est = rides.filter((r) => r.date >= addDays(todayIso, -42) && (r.eftp ?? 0) > 0);
  const best = est.length ? est.reduce((a, b) => ((b.eftp ?? 0) > (a.eftp ?? 0) ? b : a)) : undefined;
  // Heart rate: the highest recorded, and a threshold from the hardest steady efforts (a ride of 20 to 60 minutes'
  // average heart rate is close to threshold only if it was ridden hard, so the larger of that and 90% of the highest).
  const withHr = recent.filter((r) => (r.maxHr ?? 0) > 0);
  const top = withHr.length ? withHr.reduce((a, b) => ((b.maxHr ?? 0) > (a.maxHr ?? 0) ? b : a)) : undefined;
  const steady = recent.filter((r) => r.seconds >= 20 * 60 && r.seconds <= 60 * 60 && (r.averageHr ?? 0) > 0).map((r) => r.averageHr!);
  return {
    weeklyHours: recent.length >= 3 ? Math.round(hours * 2) / 2 : undefined,
    ridesWithPower: power.length,
    ftp: best ? { value: Math.round(best.eftp!), from: `Intervals.icu's estimate from your ride of ${fmtDate(best.date)}, the best of ${est.length} recent rides with power` } : undefined,
    maxHr: top && withHr.length >= 5 ? { value: Math.round(top.maxHr!), from: `the highest heart rate in your rides (${fmtDate(top.date)})` } : undefined,
    lthr: top && withHr.length >= 5 ? { value: Math.round(Math.max(0.9 * top.maxHr!, ...steady)), from: `the highest heart rates in your last eight weeks of rides` } : undefined,
  };
}

/** The profile the setup saves: the rider's own numbers, estimates marked, unknowns marked with stand-ins for the maths. */
export function setupProfile(base: Profile, boxes: Record<UnsureNumber, Box>, hours: number, hasPower: boolean | undefined, hasHr: boolean | undefined, historyPower: boolean): Profile {
  const unsure: NonNullable<Profile['unsure']> = {};
  const p: Profile = { ...base, hoursPerWeek: hours, hasPower, hasHr };
  delete p.unsure;
  const keys = Object.keys(boxes) as UnsureNumber[];
  for (const k of keys) {
    const b = boxes[k];
    if ((b.source === 'typed' || b.source === 'service') && b.value) p[k] = b.value;
    else if (b.source === 'estimate' && b.estimate) { p[k] = b.estimate.value; unsure[k] = { estimate: b.estimate.from }; }
    else unsure[k] = {};
  }
  if (Object.keys(unsure).length) p.unsure = unsure;
  // Stand-ins for the unknowns, for the maths only: never shown, never sent.
  const s = standIns(p);
  for (const k of keys) if (unsure[k] && !unsure[k]!.estimate) p[k] = s[k];
  // Targets start on heart rate unless the rider's history shows power, or they said they ride with power, and the FTP is not unknown.
  const power = (historyPower || hasPower === true) && !(p.unsure?.ftp && !p.unsure.ftp.estimate);
  p.basis = power ? 'power' : 'hr';
  return p;
}

const BLANK: Box = { source: 'unknown' };
const EMPTY = (): Record<UnsureNumber, Box> => ({ ftp: { ...BLANK }, lthr: { ...BLANK }, maxHr: { ...BLANK }, weightKg: { ...BLANK } });
/** A box the rider has not answered yet: no number typed and "I don't know" not pressed. */
type Answered = Record<UnsureNumber, boolean>;

export function Onboarding() {
  const [step, setStep] = useState<'welcome' | 'connect' | 'note' | 'review'>('welcome');
  const [creds, setCreds] = useState<IntervalsCredentials>({ athleteId: '', apiKey: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<AthleteNumbers | null>(null);
  const [hints, setHints] = useState<HistoryHints | null>(null);
  const [backup, setBackup] = useState<{ text: string; exportedAt: string } | null>(null);
  // The starting guess for units comes from the device's region; the rider chooses distance and weight separately.
  const [p, setP] = useState<Profile>(() => { const u = unitsForRegion(deviceRegion()); return { ...DEFAULT_PROFILE, ...u, units: legacyUnits(u.distUnits, u.weightUnits) }; });
  const [boxes, setBoxes] = useState<Record<UnsureNumber, Box>>(EMPTY);
  const [answered, setAnswered] = useState<Answered>({ ftp: false, lthr: false, maxHr: false, weightKg: false });
  const [hours, setHours] = useState<number | undefined>(undefined);
  // The birth year as typed. The box shows this, not the year the profile holds: a year is only a year once all four
  // digits are in, and showing the profile's value wiped each digit as it was typed (found 27 Nov 2026).
  const [birth, setBirth] = useState<string | null>(null);
  const [hasPower, setHasPower] = useState<boolean | undefined>(undefined);
  const [hasHr, setHasHr] = useState<boolean | undefined>(undefined);
  const setUnits = (d: DistUnits, w: WeightUnits) => setP({ ...p, distUnits: d, weightUnits: w, units: legacyUnits(d, w) });
  const thisYear = Number(today().slice(0, 4));
  const upd = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const setBox = (k: UnsureNumber, b: Box, done = true) => { setBoxes({ ...boxes, [k]: b }); setAnswered({ ...answered, [k]: done }); };

  async function connect() {
    setBusy(true); setErr(null);
    try {
      const c = { athleteId: creds.athleteId.trim(), apiKey: creds.apiKey.trim() };
      const a = await testConnection(c);
      await setSetting('intervals', c);
      setFound(a);
      let note: { text: string; exportedAt: string } | null = null;
      try { note = await fetchAutoBackup(c); setBackup(note); } catch { /* none, or unreadable */ }
      let h: HistoryHints | null = null;
      try { h = historyHints(await fetchRides(c, addDays(today(), -56), today()), today()); setHints(h); } catch { /* suggestions only */ }
      setP(applyAthleteNumbers({ ...p, name: a.name }, a));
      // Numbers Intervals.icu holds are the rider's own; the rest start empty.
      const fromService = (v?: number): Box => (v ? { value: v, source: 'service' } : { ...BLANK });
      const b = { ftp: fromService(a.ftp), lthr: fromService(a.lthr), maxHr: fromService(a.maxHr), weightKg: fromService(a.weight) };
      setBoxes(b);
      setAnswered({ ftp: !!a.ftp, lthr: !!a.lthr, maxHr: !!a.maxHr, weightKg: !!a.weight });
      if (h && h.ridesWithPower > 0) setHasPower(true);
      setStep(note ? 'note' : 'review');
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  /** Restore from a backup file the rider picks, from anywhere their device can reach; it says what the file holds and asks first. */
  async function restoreFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    setErr(null);
    try {
      const sum = await backupSummaryOf(f);
      if (!sum.ok) { setErr(sum.words); input.value = ''; return; }
      if (!await ask(`${backupMade(sum.exportedAt)}\n\nIt holds ${sum.words}.\n\nRestore it? Everything in it is brought onto ${thisDevice()} as it was then, and ${APP_SHORT_NAME} opens with it.\n\nYour other devices are not changed. If ${APP_SHORT_NAME} finds its saved copy from them, it asks what to do, and if you keep this device in step, the newer version of each thing is kept.`)) { input.value = ''; return; }
      setBusy(true);
      await restoreBackupFile(f, 'device');
      // If a saved copy from the rider's other devices turns up, the choice is asked at once.
      if (!(await getSetting<string | null>(DEVICE_CHOICE, null))) await setSetting(DEVICES_ASK, true);
      notify();
      location.hash = '/today';
      location.reload();
    } catch (x) { setErr((x as Error).message); input.value = ''; } finally { setBusy(false); }
  }
  /** The saved copy in Intervals.icu: this device takes it and stays in step with the rider's others. */
  async function joinDevices() {
    if (!backup) return;
    setBusy(true);
    try { await restoreBackup(backup.text, 'device'); await setSetting(DEVICE_CHOICE, 'sync'); notify(); location.hash = '/today'; location.reload(); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  /** This device keeps its own data: it never reads or writes the saved copy. */
  async function staySeparate() { await setSetting(DEVICE_CHOICE, 'separate'); setStep('review'); }
  const noteDevice = (() => { try { return backup ? (JSON.parse(backup.text) as { device?: string }).device : undefined; } catch { return undefined; } })();
  const filePick = (label: string, cls = 'btn') => (
    <label class={cls} style="position:relative;overflow:hidden">{label}<input type="file" aria-label={label} accept="application/zip,.zip,application/json,.json" style="position:absolute;inset:0;opacity:0;cursor:pointer" onChange={restoreFile} disabled={busy} /></label>
  );

  const historyPower = (hints?.ridesWithPower ?? 0) > 0;
  const ready = !!hours && hours > 0 && (Object.keys(answered) as UnsureNumber[]).every((k) => answered[k]);
  const notAnswered = (Object.keys(answered) as UnsureNumber[]).filter((k) => !answered[k]);

  async function start() {
    if (!hours) return;
    const prof = setupProfile(p, boxes, hours, hasPower, hasHr, historyPower);
    // Masters recovery from the birth year: on from 40, off when younger or not given.
    await saveProfile({ ...prof, masters: mastersFor(prof.birthYear, today()) });
    notify();
    location.hash = '/today';
    if (found) syncAll().then(notify).catch(() => { /* Today shows the sync state; a failed first pull is retried from the Sync button */ });
  }

  const W = pounds(p) ? 'lb' : 'kg';
  const toShown = (k: UnsureNumber, v: number | undefined) => (v == null ? undefined : k === 'weightKg' && pounds(p) ? Math.round(v * 2.2046) : Math.round(v));
  const fromShown = (k: UnsureNumber, v: number) => (k === 'weightKg' && pounds(p) ? v / 2.2046 : v);
  const within = (lo: number, hi: number, what: string) => (v: number) => (v < lo || v > hi ? `${what} is usually between ${lo} and ${hi}.` : undefined);

  /** One number: its box, where it came from, and "I don't know" with what that leads to. */
  const numberField = (k: UnsureNumber, label: string, what: string, check: (v: number) => string | undefined, unknownPanel: () => preact.JSX.Element) => {
    const b = boxes[k];
    const typedOrService = b.source === 'typed' || b.source === 'service';
    return (
      <div class="ob-number" key={k}>
        <label for={`ob-${k}`}>{label}</label>
        <p class="faint small ob-what">{what}</p>
        {b.source === 'estimate' && b.estimate ? (
          <div class="ob-estimate"><span class="num">{toShown(k, b.estimate.value)} {k === 'ftp' ? 'W' : k === 'weightKg' ? W : 'bpm'}</span> <span class="tag">estimate</span>
            <span class="faint small"> from {b.estimate.from}</span>
            <button class="btn sm quiet" onClick={() => setBox(k, { ...BLANK }, false)}>Type my own instead</button></div>
        ) : b.source === 'unknown' && answered[k] ? (
          <div class="ob-unknown">{unknownPanel()}<button class="btn sm quiet" onClick={() => setBox(k, { ...BLANK }, false)}>I know it after all</button></div>
        ) : (
          <div class="row wrap" style="gap:8px;align-items:flex-start">
            <NumberBox ariaLabel={label} style="max-width:140px" value={typedOrService ? toShown(k, b.value) : undefined} check={check}
              onValue={(v) => setBox(k, v ? { value: fromShown(k, v), source: 'typed' } : { ...BLANK }, !!v)} />
            <button class="btn quiet" onClick={() => setBox(k, { ...BLANK }, true)}>I don't know</button>
            {b.source === 'service' && <span class="faint small" style="align-self:center">from your Intervals.icu settings</span>}
          </div>
        )}
      </div>
    );
  };

  const ageEstimate = p.birthYear ? { value: maxHrFromAge(p.birthYear, today()), from: 'your age' } : undefined;

  return (
    <main class="main onboard">
      <div class="ob-brand"><StackedLogo width={240} /><p class="ob-tagline">{TAGLINE}</p></div>
      <p class="ob-lede">Plan your training from your own data, send every session to your bike computer or watch, and see what each one did for you.</p>
      {step === 'welcome' ? (
        <div class="panel ob-card">
          <h2>Welcome</h2>
          <p class="muted small" style="margin:6px 0 16px">A few questions about you and your riding, and {APP_SHORT_NAME} makes your plan. There is no account to make and nothing you have to connect.</p>
          {err && <div class="msg err" style="margin-bottom:12px">{err}</div>}
          <button class="btn primary block" onClick={() => setStep('review')} disabled={busy}>Set up {APP_SHORT_NAME}</button>
          <h3 style="margin:26px 0 4px;font-size:15px">Optional</h3>
          <p class="faint small" style="margin:0 0 12px">Only if they apply to you. Each can also be done later, in Settings.</p>
          <div class="stack" style="gap:16px">
            <div>
              <b class="small">Used {APP_SHORT_NAME} before? Restore from a backup file</b>
              <p class="muted small" style="margin:2px 0 8px">Choose a backup file you made with <i>Back up everything</i>, from wherever you keep it: this device, iCloud Drive, OneDrive, Google Drive, Dropbox. You are shown what it holds before anything is restored.</p>
              {filePick('Choose a backup file')}
            </div>
            <div>
              <b class="small">Use Intervals.icu? Connect it</b>
              <p class="muted small" style="margin:2px 0 8px">Intervals.icu is a free service many riders already use. Connected, it brings your history and your numbers, takes in recordings from many makes of bike computer and watch (Garmin, Wahoo, Polar, Coros, Suunto and others), sends your sessions to those devices, and can keep {APP_SHORT_NAME} in step between your own devices. {APP_SHORT_NAME} works without it.</p>
              <button class="btn" onClick={() => { setErr(null); setStep('connect'); }} disabled={busy}>Connect Intervals.icu</button>
            </div>
            <div>
              <b class="small">Have a Garmin personal key? Bring your activities straight from Garmin</b>
              <p class="muted small" style="margin:2px 0 0">{inApp() ? `After setup, in Settings, under History. The key is typed into ${APP_SHORT_NAME} and kept on ${thisDevice()}.` : `This needs the ${APP_SHORT_NAME} app for the Mac, iPhone or iPad: Garmin does not answer a web browser. After setup, see Settings, under History.`}</p>
            </div>
          </div>
        </div>
      ) : step === 'note' && backup ? (
        <div class="panel ob-card">
          <h2>Your other devices</h2>
          <p class="small" style="margin:6px 0 10px"><b>{APP_SHORT_NAME} found its saved copy in your Intervals.icu account.</b></p>
          <ul class="small muted" style="margin:0 0 16px;padding-left:18px">
            <li><b>What it is:</b> a private note in your own Intervals.icu calendar (dated 31 Dec 2099), written by {APP_SHORT_NAME} on {noteDevice ? <>another of your devices ({noteDevice})</> : 'another of your devices'}.</li>
            <li><b>What it holds:</b> your profile, settings, plans, calendar and your own workouts.</li>
            <li><b>What it doesn't hold:</b> your rides and recordings. Each device fetches those for itself.</li>
            <li><b>Last saved:</b> {new Date(backup.exportedAt).toLocaleString()}.</li>
          </ul>
          {err && <div class="msg err" style="margin-bottom:12px">{err}</div>}
          <div class="stack" style="gap:16px">
            <div>
              <button class="btn primary" onClick={joinDevices} disabled={busy}>Keep this device in step with my others</button>
              <p class="muted small" style="margin:6px 0 0">{thisDevice().replace(/^t/, 'T')} takes the saved copy now and opens with your plan and settings. From then on, a change you make on any of your devices reaches the others through that note.</p>
            </div>
            <div>
              <button class="btn" onClick={staySeparate} disabled={busy}>Keep this device separate</button>
              <p class="muted small" style="margin:6px 0 0">You set up {thisDevice()} afresh. It still uses Intervals.icu for your history and for sending sessions to your devices, but it does not read or change the saved copy: a plan you make here stays here, and changes on your other devices don't arrive. You can turn keeping in step on later, in Settings.</p>
            </div>
            <div>
              {filePick('Restore from a file I choose instead')}
              <p class="muted small" style="margin:6px 0 0">A backup file you made with <i>Back up everything</i>, from wherever you keep it.</p>
            </div>
          </div>
        </div>
      ) : step === 'connect' ? (
        <div class="panel ob-card">
          <h2>Connect Intervals.icu</h2>
          <p class="muted small" style="margin:6px 0 14px">Intervals.icu is the free service that links the app to your devices: workouts go out through it to the bike computers and watches you connect there, and your recordings, sleep and HRV come back through it. If it already has your FTP and heart rates, the app uses them. On intervals.icu, open <b>Settings</b> and scroll to <b>Developer</b>: your athlete ID is there, and a button makes the API key.</p>
          <details class="ob-help">
            <summary>New to Intervals.icu? How to set it up</summary>
            <ol class="small muted">
              <li>Go to <b>intervals.icu</b> and sign up (free).</li>
              <li>In Intervals.icu, open <b>Settings</b> and connect the maker of your bike computer or watch (Garmin, Wahoo, Coros, Suunto and others), letting it import your activities and wellness (sleep, HRV, resting heart rate). Then tick <b>Upload planned workouts</b> for it on the same page: that is how sessions from this app reach your device. If you use an Oura ring or Strava, connect them there too.</li>
              <li>Give it a little while to pull your history. If you know your FTP and threshold heart rate, you can set them in its cycling sport settings; if you don't, this app finds them with a test.</li>
              <li>Still in Settings, scroll to <b>Developer</b>. Copy your <b>athlete ID</b> (it starts with i) and press the button to make an <b>API key</b>. Paste both here. The key stays on this device; the app sends it only to Intervals.icu.</li>
            </ol>
          </details>
          {err && <div class="msg err" style="margin-bottom:12px">{err}</div>}
          <div class="form">
            <div class="field"><label for="ob-aid">Athlete ID</label><input id="ob-aid" placeholder="i123456" value={creds.athleteId} onInput={(e) => setCreds({ ...creds, athleteId: (e.target as HTMLInputElement).value })} autofocus /></div>
            <div class="field"><label for="ob-key">API key</label><input id="ob-key" type="password" autocomplete="off" value={creds.apiKey} onInput={(e) => setCreds({ ...creds, apiKey: (e.target as HTMLInputElement).value })} /></div>
          </div>
          <button class="btn primary block" style="margin-top:22px" onClick={connect} disabled={busy || !creds.athleteId || !creds.apiKey}>{busy ? 'Connecting…' : 'Connect'}</button>
          <button class="btn quiet block" style="margin-top:8px" onClick={() => { setErr(null); setStep('welcome'); }}>Back</button>
        </div>
      ) : (
        <div class="panel ob-card">
          <h2>Your numbers</h2>
          <p class="muted small" style="margin:6px 0 18px">
            {found ? `Connected as ${found.name}. Numbers Intervals.icu holds are filled in; check them. ` : ''}Type any number you know. For one you don't, press <b>I don't know</b>: the app finds it with a test in your first week, or estimates it and marks it as an estimate. You can change any of them later in Settings.
          </p>
          <div class="form">
            <div class="field"><label for="ob-name">Name</label><input id="ob-name" value={p.name} onInput={(e) => upd('name', (e.target as HTMLInputElement).value)} /></div>
            <div class="field"><label for="ob-birth">Birth year (optional)</label>
              <input id="ob-birth" type="number" inputMode="numeric" placeholder="e.g. 1975" value={birth ?? p.birthYear ?? ''} onInput={(e) => { const t = (e.target as HTMLInputElement).value; setBirth(t); const v = Number(t); upd('birthYear', v >= 1920 && v <= thisYear - 10 ? v : undefined); }} /></div>
          </div>

          <div class="field" style="margin-top:16px"><label>What do you ride with?</label>
            <p class="faint small ob-what">This decides how targets are given. Pick each that applies.</p>
            <div class="chips">
              <button class={`chip${hasPower ? ' on' : ''}`} aria-pressed={!!hasPower} onClick={() => setHasPower(hasPower ? false : true)}>A power meter or smart trainer</button>
              <button class={`chip${hasHr ? ' on' : ''}`} aria-pressed={!!hasHr} onClick={() => setHasHr(hasHr ? false : true)}>A heart-rate strap or a watch that reads heart rate</button>
            </div>
            {historyPower && <p class="faint small" style="margin:6px 0 0">{hints!.ridesWithPower} of your recent rides have power.</p>}
          </div>

          <div class="ob-numbers">
            {numberField('ftp', 'FTP (watts)', 'The most power you can hold for about an hour. Power targets are shares of it.', within(50, 600, 'FTP'), () => (
              <p class="small" style="margin:0">
                {hints?.ftp
                  ? <>Your history has an estimate: <b>{hints.ftp.value} W</b>, {hints.ftp.from}. <button class="btn sm" onClick={() => setBox('ftp', { source: 'estimate', estimate: hints.ftp! })}>Use this estimate</button><br /></>
                  : null}
                {hasPower || historyPower
                  ? 'Your plan puts an FTP test in your first week, and rides go by heart rate until it is done.'
                  : 'Without a power meter or smart trainer there is nothing to set it from, and you don\'t need it: rides go by heart rate.'}
              </p>
            ))}
            {numberField('lthr', 'Threshold heart rate (bpm)', 'The heart rate you can hold for about an hour, flat out. Heart-rate targets are shares of it.', within(80, 220, 'Threshold heart rate'), () => (
              <p class="small" style="margin:0">
                {hints?.lthr ? <>Your history has an estimate: <b>{hints.lthr.value} bpm</b>, from {hints.lthr.from}. <button class="btn sm" onClick={() => setBox('lthr', { source: 'estimate', estimate: hints.lthr! })}>Use this estimate</button><br /></> : null}
                {(hasPower || historyPower) && isFtpPending(boxes)
                  ? 'The FTP test in your first week finds it too, if you wear a heart-rate strap for it.'
                  : hasHr || hasPower || historyPower ? 'Your plan puts a threshold heart-rate test in your first week. Until then, rides show zones without beats per minute.'
                  : 'Without a heart-rate strap or watch there is nothing to measure it with yet. Rides show zones and how they should feel.'}
              </p>
            ))}
            {numberField('maxHr', 'Max heart rate (bpm)', 'The highest your heart reaches flat out. Used to read your rides, not for targets.', within(100, 230, 'Max heart rate'), () => (
              <p class="small" style="margin:0">
                {hints?.maxHr ? <><b>{hints.maxHr.value} bpm</b> is {hints.maxHr.from}. <button class="btn sm" onClick={() => setBox('maxHr', { source: 'estimate', estimate: hints.maxHr! })}>Use it</button><br /></> : null}
                {ageEstimate ? <><b>{ageEstimate.value} bpm</b> is an estimate from your age. <button class="btn sm" onClick={() => setBox('maxHr', { source: 'estimate', estimate: ageEstimate })}>Use this estimate</button><br /></> : null}
                Left unknown, it is set the first time a recording shows it. {ageEstimate || hints?.maxHr ? '' : 'Add your birth year above for an estimate from your age.'}
              </p>
            ))}
            {numberField('weightKg', `Weight (${W})`, 'For watts per kilogram and for how hard a trainer starts when riding by heart rate.', pounds(p) ? within(66, 550, 'Weight in pounds') : within(30, 250, 'Weight in kilograms'), () => (
              <p class="small" style="margin:0">Left unknown, watts per kilogram are not shown. You can add it in Settings at any time.</p>
            ))}
          </div>

          <div class="field" style="margin-top:16px"><label>Hours a week you can train</label>
            <p class="faint small ob-what">Your plan is built to fit this. It is needed to make a plan.</p>
            {hints?.weeklyHours ? <p class="small" style="margin:0 0 6px">You have averaged <b>{hints.weeklyHours} hours</b> a week over the last eight weeks. <button class="btn sm" onClick={() => setHours(hints.weeklyHours)}>Use {hints.weeklyHours}</button></p> : null}
            <div class="chips" role="group" aria-label="Hours a week">
              {[3, 4, 5, 6, 8, 10, 12].map((h) => <button key={h} class={`chip${hours === h ? ' on' : ''}`} aria-pressed={hours === h} onClick={() => setHours(h)}>{h} h</button>)}
              <span class="row" style="gap:6px;align-items:center"><span class="faint small">or</span><NumberBox decimals ariaLabel="Hours a week, typed" style="width:80px" value={hours && ![3, 4, 5, 6, 8, 10, 12].includes(hours) ? hours : undefined} placeholder="other" check={within(1, 30, 'Hours a week')} onValue={(v) => setHours(v)} /></span>
            </div>
          </div>

          <div class="row wrap" style="margin-top:16px;gap:18px">
            <div class="field"><label>Distance</label>
              <div class="seg"><button class={miles(p) ? 'on' : ''} aria-pressed={miles(p)} onClick={() => setUnits('mi', weightUnitsOf(p))}>Miles</button><button class={!miles(p) ? 'on' : ''} aria-pressed={!miles(p)} onClick={() => setUnits('km', weightUnitsOf(p))}>Kilometres</button></div></div>
            <div class="field"><label>Weight</label>
              <div class="seg"><button class={pounds(p) ? 'on' : ''} aria-pressed={pounds(p)} onClick={() => setUnits(distUnitsOf(p), 'lb')}>Pounds</button><button class={!pounds(p) ? 'on' : ''} aria-pressed={!pounds(p)} onClick={() => setUnits(distUnitsOf(p), 'kg')}>Kilograms</button></div></div>
          </div>
          <p class="faint small" style="margin:10px 0 0">{p.birthYear
            ? (mastersFor(p.birthYear, today()) ? 'Masters recovery will be on: from 40, plans give you a lighter week every third week. You can turn it off in Settings.' : 'Masters recovery will be off: it is for riders of 40 and over. You can turn it on in Settings.')
            : 'Masters recovery, a lighter week every third week for riders of 40 and over, starts off. Turn it on in Settings, under You, if you want it.'}</p>
          <p class="faint small" style="margin:6px 0 0">Targets start {setupProfile(p, boxes, hours ?? 1, hasPower, hasHr, historyPower).basis === 'power' ? 'on power' : 'on heart rate'}. You can change this in Settings.</p>
          {!ready && <p class="small" style="margin:18px 0 0;color:var(--ink-2)">Still to answer: {[...notAnswered.map((k) => ({ ftp: 'FTP', lthr: 'threshold heart rate', maxHr: 'max heart rate', weightKg: 'weight' }[k])), !hours && 'hours a week'].filter(Boolean).join(', ')}. A number or “I don't know” for each.</p>}
          <button class="btn primary block" style="margin-top:14px" onClick={start} disabled={!ready}>{found ? 'Start and pull my rides' : 'Start'}</button>
          {!found && <button class="btn quiet block" style="margin-top:8px" onClick={() => setStep('welcome')}>Back</button>}
        </div>
      )}
      <p class="faint small ob-foot">Your data stays on {appKind() ? thisDevice() : 'this device'}. {APP_SHORT_NAME} contacts another service only when you connect it.</p>
    </main>
  );
}

const isFtpPending = (b: Record<UnsureNumber, Box>) => b.ftp.source === 'unknown';
