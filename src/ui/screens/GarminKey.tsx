import { useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting, db } from '../../data/db';
import { GARMIN_KEY_SETTING, resultsText, runGarminTest, type SavedGarminKey, type StepResult } from '../../sync/garminPersonal';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';
import { fmtDate } from '../derived';

/**
 * Test a Garmin personal key (22 Nov 2026, Stage 0). Garmin shows a key once, when it is made, so the page keeps it
 * on this device where it can be shown and copied again later: in the app's own storage, in Back up everything
 * like the Intervals.icu key, never in the note to other devices, and sent nowhere but Garmin.
 */
export function GarminKey() {
  const [saved, setSaved] = useState<SavedGarminKey | null | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [expires, setExpires] = useState('');
  const [shown, setShown] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => { void getSetting<SavedGarminKey | null>(GARMIN_KEY_SETTING, null).then(setSaved); }, []);

  const save = async () => {
    const key = typed.trim();
    if (!key) return;
    const k: SavedGarminKey = { key, savedAt: new Date().toISOString(), ...(expires ? { expires } : {}) };
    await setSetting(GARMIN_KEY_SETTING, k);
    setSaved(k); setTyped(''); setExpires('');
    toast({ ok: true, text: 'Key saved on this device. You can show and copy it here any time.' });
  };
  const copy = async (text: string, what: string) => {
    // A browser that never answers (a permission it is still asking about) falls back to a box to copy from.
    const wrote = await Promise.race([navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);
    if (wrote) toast({ ok: true, text: `${what} copied.` });
    else window.prompt(`Copy the ${what.toLowerCase()}:`, text);
  };
  const forget = async () => {
    if (!confirm('Forget the Garmin key on this device?\n\nIt is removed from this app. Garmin will not show it again: unless you have it somewhere else, you would have to make a new one in Garmin Connect.')) return;
    await db.settings.delete(GARMIN_KEY_SETTING);
    setSaved(null); setShown(false); setSteps([]);
  };
  const run = async () => {
    if (!saved) return;
    setRunning(true); setSteps([]);
    try { await runGarminTest(saved.key, (s) => setSteps((x) => [...x, s])); }
    finally { setRunning(false); }
  };

  const masked = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}${'•'.repeat(Math.min(24, k.length - 8))}${k.slice(-4)}` : '•'.repeat(k.length));

  return (
    <div>
      <PageHead back={{ label: 'Settings', href: '#/settings' }} title="Test a Garmin personal key" />
      <p class="prose" style="margin-top:0">Garmin now lets anyone make a free personal key in Garmin Connect, which reads your own activities and health data (it can't send workouts to a device). This page finds out what it actually returns, how far back it reaches, and whether a web page may use it at all. Nothing in the app uses the key yet.</p>

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
            <p class="faint small" style="margin:10px 0 0">Kept only in this app on this device, and in Back up everything (as your Intervals.icu key is). It never goes in the note your other devices share, and it is sent nowhere but Garmin. It's also worth keeping in your password manager, in case this browser's data is ever cleared.</p>
          </div>
        ) : (
          <div class="panel"><div class="form">
            <p class="small muted" style="margin:0">In Garmin Connect on the web: Settings, then Personal API Key, then Create Key. Garmin shows the key only once: paste it here straight away and save it. You can show and copy it here again whenever you need it.</p>
            <div class="field"><label>Garmin personal key</label><input aria-label="Garmin personal key" type="password" autocomplete="off" spellcheck={false} value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} placeholder="Paste the key" /></div>
            <div class="field"><label>Expires on (optional, as you chose when making it)</label><input aria-label="Expires on" type="date" value={expires} onInput={(e) => setExpires((e.target as HTMLInputElement).value)} /></div>
            <div class="row"><button class="btn primary" disabled={!typed.trim()} onClick={save}>Save on this device</button></div>
          </div></div>
        )}
      </section>

      {saved && (
        <section class="section">
          <h2>The test</h2>
          <p class="faint small" style="margin:4px 0 10px">A few dozen requests to Garmin, reading only. It lists your activities (up to 6,000), opens the newest one's original file, and reads a week of HRV, sleep and daily numbers, then the same week in earlier years.</p>
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
            {!running && <button class="btn sm" style="margin-top:12px" onClick={() => copy(resultsText(steps), 'Results')}>Copy the results</button>}
            {!running && <p class="faint small" style="margin:6px 0 0">The results never include your key. Paste them into a message to Claude.</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
