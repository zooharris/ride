import { useState } from 'preact/hooks';
import { DEFAULT_PROFILE, saveProfile, setSetting } from '../../data/db';
import type { Basis, Profile } from '../../engine/types';
import { notify } from '../store';
import { Logo } from '../Brand';
import { applyAthleteNumbers, testConnection, type AthleteNumbers, type IntervalsCredentials } from '../../sync/intervals';
import { syncAll } from '../../sync/syncService';
import { fetchAutoBackup, restoreBackup } from '../../data/backup';

/**
 * First run. Step 1 connects Intervals.icu, which already knows the rider's FTP,
 * threshold HR, max HR and weight; step 2 shows what came back for a quick check.
 * Typing the numbers by hand is the fallback for a rider without an account.
 */
export function Onboarding() {
  const [step, setStep] = useState<'connect' | 'review'>('connect');
  const [creds, setCreds] = useState<IntervalsCredentials>({ athleteId: '', apiKey: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<AthleteNumbers | null>(null);
  const [backup, setBackup] = useState<{ text: string; exportedAt: string } | null>(null);
  const [p, setP] = useState<Profile>({ ...DEFAULT_PROFILE });
  const upd = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const num = (k: keyof Profile) => (e: Event) => upd(k, Number((e.target as HTMLInputElement).value) as never);

  async function connect() {
    setBusy(true); setErr(null);
    try {
      const c = { athleteId: creds.athleteId.trim(), apiKey: creds.apiKey.trim() };
      const a = await testConnection(c);
      await setSetting('intervals', c);
      setFound(a);
      try { setBackup(await fetchAutoBackup(c)); } catch { /* none, or unreadable */ }
      setP(applyAthleteNumbers({ ...p, name: a.name }, a));
      setStep('review');
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  async function start() {
    await saveProfile(p);
    notify();
    location.hash = '/today';
    if (found) syncAll().then(notify).catch(() => { /* Today shows the sync state; a failed first pull is retried from the Sync button */ });
  }

  const missing = found ? [!found.ftp && 'FTP', !found.lthr && 'threshold heart rate'].filter(Boolean) : [];

  return (
    <main class="main onboard">
      <div class="ob-brand"><Logo height={40} /></div>
      <p class="ob-lede">Plan your training from your own data, send every session to your Garmin, and see what each one did for you.</p>
      <ol class="ob-steps" aria-label="Setup steps">
        <li class={step === 'connect' ? 'on' : 'done'}><span>1</span>Connect Intervals.icu</li>
        <li class={step === 'review' ? 'on' : ''}><span>2</span>Check your numbers</li>
      </ol>

      {step === 'connect' ? (
        <div class="panel ob-card">
          <h2>Connect Intervals.icu</h2>
          <p class="muted small" style="margin:6px 0 14px">Intervals.icu is the free service that links the app to your Garmin: workouts go out through it and your recordings, sleep and HRV come back through it. It already has your FTP, threshold heart rate and history, so there is nothing to type. On intervals.icu, open <b>Settings</b> and scroll to <b>Developer</b>: your athlete ID is there, and a button makes the API key.</p>
          <details class="ob-help">
            <summary>New to Intervals.icu? How to set it up</summary>
            <ol class="small muted">
              <li>Go to <b>intervals.icu</b> and sign up (free). The quickest way is “Sign in with Garmin”, or sign up with an email and connect Garmin after.</li>
              <li>In Intervals.icu, open <b>Settings</b> and connect <b>Garmin</b>, letting it import your activities and wellness (sleep, HRV, resting heart rate). Then tick <b>Upload planned workouts</b> on the same page and approve it in Garmin Connect: that is how sessions from this app reach your bike computer or watch. If you use an Oura ring or Strava, connect them there too.</li>
              <li>Give it a little while to pull your history from Garmin. Check that Intervals.icu has your FTP and threshold heart rate in its cycling sport settings; set them if they are blank.</li>
              <li>Still in Settings, scroll to <b>Developer</b>. Copy your <b>athlete ID</b> (it starts with i) and press the button to make an <b>API key</b>. Paste both here. The key stays on this device; the app sends it only to Intervals.icu.</li>
            </ol>
          </details>
          {err && <div class="msg err" style="margin-bottom:12px">{err}</div>}
          <div class="form">
            <div class="field"><label>Athlete ID</label><input placeholder="i123456" value={creds.athleteId} onInput={(e) => setCreds({ ...creds, athleteId: (e.target as HTMLInputElement).value })} autofocus /></div>
            <div class="field"><label>API key</label><input type="password" autocomplete="off" value={creds.apiKey} onInput={(e) => setCreds({ ...creds, apiKey: (e.target as HTMLInputElement).value })} /></div>
          </div>
          <button class="btn primary block" style="margin-top:22px" onClick={connect} disabled={busy || !creds.athleteId || !creds.apiKey}>{busy ? 'Connecting…' : 'Connect'}</button>
          <button class="btn quiet block" style="margin-top:8px" onClick={() => setStep('review')}>No account yet, enter numbers by hand</button>
        </div>
      ) : (
        <div class="panel ob-card">
          <h2>Check your numbers</h2>
          <p class="muted small" style="margin:6px 0 18px">
            {found ? `Connected as ${found.name}. These came from Intervals.icu; check them and change anything that is out of date.` : 'A few numbers to start. You can change them any time in Settings.'}
          </p>
          {backup && (
            <div class="panel accent" style="margin-bottom:14px">
              <b>A backup from another device was found</b>
              <p class="muted small" style="margin-top:4px">Saved {new Date(backup.exportedAt).toLocaleString()} in your Intervals.icu account: profile, settings, workouts and plan.</p>
              <button class="btn primary sm" style="margin-top:10px" onClick={async () => { await restoreBackup(backup.text); notify(); location.hash = '/today'; location.reload(); }}>Restore it and continue</button>
            </div>
          )}
          {missing.length > 0 && <div class="msg err" style="margin-bottom:14px">Intervals.icu has no {missing.join(' or ')} set for cycling. Enter a best guess below, or set it on intervals.icu and it will be picked up on the next connect.</div>}
          <div class="form">
            <div class="field"><label>Name</label><input value={p.name} onInput={(e) => upd('name', (e.target as HTMLInputElement).value)} /></div>
            <div class="field"><label>FTP (watts)</label><input type="number" value={p.ftp} onInput={num('ftp')} /></div>
            <div class="field"><label>Threshold heart rate (bpm)</label><input type="number" value={p.lthr} onInput={num('lthr')} /></div>
            <div class="field"><label>Max heart rate</label><input type="number" value={p.maxHr} onInput={num('maxHr')} /></div>
            <div class="field"><label>Weight ({p.units === 'imperial' ? 'lb' : 'kg'})</label>
              <input type="number" value={p.units === 'imperial' ? Math.round(p.weightKg * 2.2046) : Math.round(p.weightKg)} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); upd('weightKg', p.units === 'imperial' ? v / 2.2046 : v); }} /></div>
            <div class="field"><label>Hours per week you can train</label><input type="number" step="0.5" value={p.hoursPerWeek} onInput={num('hoursPerWeek')} /></div>
          </div>
          <div class="row wrap" style="margin-top:16px;gap:18px">
            <div class="field"><label>Targets sent to Garmin</label>
              <div class="seg"><button class={p.basis === 'power' ? 'on' : ''} onClick={() => upd('basis', 'power' as Basis)}>Power</button><button class={p.basis === 'hr' ? 'on' : ''} onClick={() => upd('basis', 'hr' as Basis)}>Heart rate</button></div></div>
            <div class="field"><label>Units</label>
              <div class="seg"><button class={p.units === 'imperial' ? 'on' : ''} onClick={() => upd('units', 'imperial')}>Miles, lb, °F</button><button class={p.units === 'metric' ? 'on' : ''} onClick={() => upd('units', 'metric')}>km, kg, °C</button></div></div>
          </div>
          <button class="btn primary block" style="margin-top:26px" onClick={start} disabled={!p.ftp || !p.lthr}>{found ? 'Start and pull my rides' : 'Start'}</button>
          {!found && <button class="btn quiet block" style="margin-top:8px" onClick={() => setStep('connect')}>Back to connecting Intervals.icu</button>}
        </div>
      )}
      <p class="faint small ob-foot">Your data stays on your devices and in your own Intervals.icu account. Nothing is sent anywhere else.</p>
    </main>
  );
}
