import { useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting, db } from '../../data/db';
import { GARMIN_KEY_SETTING, resultsText, runGarminTest, type SavedGarminKey, type StepResult } from '../../sync/garminPersonal';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';
import { fmtDate } from '../derived';
import { MAC_DOWNLOAD, appKey, garminFetch, inApp, thisDevice } from '../../shell';
import { garminKeyChanged, loadGarminState, setGarminOn, watchGarmin, type GarminState } from '../../sync/garminSource';
import { fetchGarmin } from '../../sync/garminAuto';
import { APP_SHORT_NAME } from '../../appName';

/**
 * Test a Garmin personal key (22 Nov 2026, Stage 0). Garmin shows a key once, when it is made, so the page keeps it
 * on this device where it can be shown and copied again later: in the app's own storage, in Back up everything
 * like the Intervals.icu key, never in the note to other devices, and sent nowhere but Garmin.
 *
 * In the installed app (23 Nov 2026) the key is kept by the app's own side, sealed by the computer's password store,
 * and never in the app's data or a backup; and the test asks Garmin through the app's own side, which Garmin answers.
 * A key that arrived in a restored backup from a browser is moved into the password store the first time this page opens.
 */
export function GarminKey() {
  const [saved, setSaved] = useState<SavedGarminKey | null | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [expires, setExpires] = useState('');
  const [shown, setShown] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const app = inApp();
  const [canSeal, setCanSeal] = useState(true);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    void (async () => {
      const inData = await getSetting<SavedGarminKey | null>(GARMIN_KEY_SETTING, null);
      if (!app) { setSaved(inData); return; }
      const can = await appKey.can().catch(() => false);
      setCanSeal(can);
      let k = await appKey.read().catch(() => null);
      if (!k && inData && can) {
        k = await appKey.save(inData.key, inData.expires).catch(() => null);
        if (k) await db.settings.delete(GARMIN_KEY_SETTING);
      }
      if (!k) setLost(await appKey.unreadable());
      setSaved(k);
    })();
  }, []);

  const save = async () => {
    const key = typed.trim();
    if (!key) return;
    let k: SavedGarminKey = { key, savedAt: new Date().toISOString(), ...(expires ? { expires } : {}) };
    if (app) {
      try { k = await appKey.save(key, expires || undefined); await garminKeyChanged(); }
      catch { toast({ ok: false, text: `The key could not be saved: the password store on ${thisDevice()} did not accept it.` }); return; }
    } else await setSetting(GARMIN_KEY_SETTING, k);
    setSaved(k); setLost(false); setTyped(''); setExpires('');
    toast({ ok: true, text: app ? `Key saved in the password store on ${thisDevice()}. You can show and copy it here any time.` : 'Key saved on this device. You can show and copy it here any time.' });
  };
  const copy = async (text: string, what: string) => {
    // A browser that never answers (a permission it is still asking about) falls back to a box to copy from.
    const wrote = await Promise.race([navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);
    if (wrote) toast({ ok: true, text: `${what} copied.` });
    else if (app) toast({ ok: false, text: `The ${what.toLowerCase()} could not be copied. Click in the app's window and try again.` });
    else window.prompt(`Copy the ${what.toLowerCase()}:`, text);
  };
  const forget = async () => {
    if (!confirm('Forget the Garmin key on this device?\n\nIt is removed from this app. Garmin will not show it again: unless you have it somewhere else, you would have to make a new one in Garmin Connect.')) return;
    if (app) { await appKey.forget(); await setGarminOn(false); await garminKeyChanged(); }
    await db.settings.delete(GARMIN_KEY_SETTING);
    setSaved(null); setShown(false); setSteps([]);
  };
  const run = async () => {
    if (!saved) return;
    setRunning(true); setSteps([]);
    try { await runGarminTest(saved.key, (s) => setSteps((x) => [...x, s]), app ? garminFetch : fetch, new Date(), app ? 'app' : 'page'); }
    finally { setRunning(false); }
  };

  const masked = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}${'•'.repeat(Math.min(24, k.length - 8))}${k.slice(-4)}` : '•'.repeat(k.length));

  return (
    <div>
      <PageHead back={{ label: 'Settings', href: '#/settings' }} title="Garmin, with your personal key" />
      <p class="prose" style="margin-top:0">Garmin now lets anyone make a free personal key in Garmin Connect, which reads your own activities and health data (it can't send workouts to a device). {app
        ? <>With it, and your say-so below, this app brings your activities and daily wellness straight from Garmin.</>
        : <>In the {APP_SHORT_NAME} app (for the Mac, iPhone and iPad), the app can bring your activities and daily wellness straight from Garmin with it. A browser can't: Garmin does not answer one.</>}</p>
      {!app && <div class="panel" style="margin-bottom:14px"><p class="small" style="margin:0"><b>Garmin does not answer a browser.</b> <span class="muted">The test below will stop at its first step here. {APP_SHORT_NAME} for the Mac holds the same pages in an app you download, and Garmin answers it.</span> <a href={MAC_DOWNLOAD} target="_blank" rel="noopener">Download {APP_SHORT_NAME} for the Mac</a></p></div>}
      {app && lost && !saved && <div class="panel" style="margin-bottom:14px"><p class="small" style="margin:0"><b>Please paste your key once more.</b> <span class="muted">An earlier copy of this app saved a key that this copy can't read: the app is now signed by its maker, and {thisDevice()}'s password store treats it as a new app. Paste your key below; this is needed only once. If you don't have the key saved anywhere, make a new one in Garmin Connect (Settings, Personal API Key) and paste that.</span></p></div>}
      {app && !canSeal && <div class="panel" style="margin-bottom:14px"><p class="small" style="margin:0"><b>The password store on {thisDevice()} isn't available to the app,</b> <span class="muted">so a key can't be kept here.</span></p></div>}

      <section class="section">
        <h2>Your key</h2>
        {saved === undefined ? null : saved ? (
          <div class="panel">
            <p class="small muted" style="margin:0 0 8px">Saved on this device on {fmtDate(saved.savedAt.slice(0, 10), { month: 'long', day: 'numeric', year: 'numeric' })}{saved.expires ? `; you noted it expires on ${fmtDate(saved.expires, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}.</p>
            <div class="garmin-key num" aria-label="Your Garmin personal key">{shown ? saved.key : masked(saved.key)}</div>
            <div class="row wrap" style="gap:8px;margin-top:10px">
              <button class="btn sm" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>
              <button class="btn primary sm" onClick={() => copy(saved.key, 'Key')}>Copy the key</button>
              <button class="btn danger sm" onClick={forget}>Forget</button>
            </div>
            {app
              ? <p class="faint small" style="margin:10px 0 0">Kept by the app, sealed by the password store on {thisDevice()}. It is not in the app's data, in a backup or in the note your other devices share, and it is sent nowhere but Garmin. It's also worth keeping in your password manager: a backup restored on another device won't bring it.</p>
              : <p class="faint small" style="margin:10px 0 0">Kept only in this app on this device, and in Back up everything (as your Intervals.icu key is). It never goes in the note your other devices share, and it is sent nowhere but Garmin. It's also worth keeping in your password manager, in case this browser's data is ever cleared.</p>}
          </div>
        ) : (
          <div class="panel"><div class="form">
            <p class="small muted" style="margin:0">In Garmin Connect on the web: Settings, then Personal API Key, then Create Key. Garmin shows the key only once: paste it here straight away and save it. You can show and copy it here again whenever you need it.</p>
            <div class="field"><label>Garmin personal key</label><input aria-label="Garmin personal key" type="password" autocomplete="off" spellcheck={false} value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} placeholder="Paste the key" /></div>
            <div class="field"><label>Expires on (optional, as you chose when making it)</label><input aria-label="Expires on" type="date" value={expires} onInput={(e) => setExpires((e.target as HTMLInputElement).value)} /></div>
            <div class="row"><button class="btn primary" disabled={!typed.trim() || (app && !canSeal)} onClick={save}>Save on this device</button></div>
          </div></div>
        )}
      </section>

      {app && saved && <GarminSource />}

      {saved && (
        <section class="section">
          <h2>The test</h2>
          <p class="faint small" style="margin:4px 0 10px">A check of what the key reads. A few dozen requests to Garmin, reading only. It lists your activities (up to 6,000), opens the newest one's original file, and reads a week of HRV, sleep and daily numbers, then the same week in earlier years.</p>
          <button class="btn primary" disabled={running} onClick={run}>{running ? 'Testing…' : steps.length ? 'Run the test again' : 'Run the test'}</button>
          {steps.length > 0 && (
            <div class="panel" style="margin-top:12px"><div class="stack" style="gap:10px">
              {steps.map((s) => (
                <div key={s.name} class="row" style="gap:10px;align-items:flex-start">
                  <span class="dot" style={`margin-top:7px;width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:${s.ok ? 'var(--good)' : 'var(--bad)'}`} />
                  <div class="small"><b>{s.name}</b><div class="muted">{s.words}</div>{s.detail && <div class="faint">{s.detail}</div>}</div>
                </div>
              ))}
              {running && <p class="small muted" style="margin:0">Still testing…</p>}
            </div>
            {!running && <button class="btn sm" style="margin-top:12px" onClick={() => copy(resultsText(steps, new Date(), app ? 'from the Mac app' : 'from a browser'), 'Results')}>Copy the results</button>}
            {!running && <p class="faint small" style="margin:6px 0 0">The results never include your key. Paste them into a message to Claude.</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Garmin as a source (23 Nov 2026, the Mac app): nothing is fetched until the rider says so here, and it can be turned
 * off here at any time. Says what it is doing and what it has done.
 */
function GarminSource() {
  const [g, setG] = useState<GarminState | null>(null);
  useEffect(() => { void loadGarminState(); return watchGarmin(setG); }, []);
  if (!g) return null;
  const on = async () => { await setGarminOn(true); void fetchGarmin(); };
  const off = async () => { await setGarminOn(false); toast({ ok: true, text: 'Stopped. What was brought in stays.' }); };
  const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  const doing = !g.running ? ''
    : g.phase === 'list' ? "Reading Garmin's list of your activities…"
    : g.phase === 'files' ? `Fetching what is new, one at a time: ${g.done} of ${g.toDo}. You can keep using the app.`
    : g.phase === 'wellness' ? 'Reading your daily wellness…' : '';
  const any = g.added + g.already + g.noFile + g.unread + g.days > 0;
  return (
    <section class="section">
      <h2>Bring from Garmin</h2>
      <div class="panel">
        {!g.on ? (
          <>
            <p class="small muted" style="margin:0 0 10px">The app reads Garmin's list of your activities and fetches the original file of each one that isn't here yet, one at a time in the background, then your daily wellness (HRV, sleep, resting heart rate, steps and the like). An activity already here is never added twice, and what the app already holds for a day is never replaced. Nothing is written to Garmin. The first time it goes back through everything Garmin has; after that it asks only for what is new, a little after the app opens and every few hours.</p>
            <button class="btn primary" onClick={on}>Bring my activities and wellness from Garmin</button>
            {any && <p class="faint small" style="margin:10px 0 0">Turned off. Brought in so far: {n(g.added, 'activity', 'activities')} added, {n(g.days, 'day', 'days')} of wellness filled in.</p>}
          </>
        ) : (
          <>
            <p class="small" style="margin:0 0 4px"><b>On.</b> <span class="muted">{g.last ? `Last fetched ${new Date(g.last).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'Not fetched yet.'}</span></p>
            <p class="small muted" style="margin:0">{n(g.added, 'activity', 'activities')} added from Garmin. {n(g.already, 'was', 'were')} already here{g.noFile ? `; ${n(g.noFile, 'has', 'have')} no file at Garmin (entered by hand, say)` : ''}{g.unread ? `; ${n(g.unread, 'file', 'files')} could not be read as an activity` : ''}. {n(g.days, 'day', 'days')} of wellness filled in.</p>
            {doing && <p class="faint small" role="status" style="margin:6px 0 0">{doing}</p>}
            {g.running && g.phase === 'files' && g.toDo > 0 && <div class="ws-track" style="margin-top:6px"><div class="ws-fill" style={`width:${(g.done / g.toDo) * 100}%`} /></div>}
            {!g.running && g.error && <p class="small" role="status" style="margin:8px 0 0;color:var(--bad)">{g.error}</p>}
            <div class="row wrap" style="gap:8px;margin-top:12px">
              <button class="btn primary sm" disabled={g.running} onClick={() => { void fetchGarmin(); }}>{g.running ? 'Fetching…' : 'Fetch from Garmin now'}</button>
              <button class="btn sm" onClick={off}>Stop bringing from Garmin</button>
            </div>
            <p class="faint small" style="margin:10px 0 0">An activity already here is never added twice; one that was here without its original file gains it. What the app already holds for a day of wellness is never replaced. Everything brought in is kept in the app and is in Back up everything. Nothing is written to Garmin.</p>
          </>
        )}
      </div>
    </section>
  );
}
