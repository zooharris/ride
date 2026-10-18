import { useState } from 'preact/hooks';
import { DEFAULT_PROFILE, saveProfile, setSetting } from '../../data/db';
import type { Basis, Profile } from '../../engine/types';
import { notify } from '../store';
import { APP_NAME } from '../../appName';
import { LIBRARY } from '../../library/workouts';
import { WorkoutProfile } from '../Profile';
import { testConnection, type AthleteNumbers, type IntervalsCredentials } from '../../sync/intervals';
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
  const sample = LIBRARY.find((w) => w.id === 'lib-ss-3x15')!;

  async function connect() {
    setBusy(true); setErr(null);
    try {
      const c = { athleteId: creds.athleteId.trim(), apiKey: creds.apiKey.trim() };
      const a = await testConnection(c);
      await setSetting('intervals', c);
      setFound(a);
      try { setBackup(await fetchAutoBackup(c)); } catch { /* none, or unreadable */ }
      setP({ ...p, name: a.name, ftp: a.ftp ?? p.ftp, lthr: a.lthr ?? p.lthr, maxHr: a.maxHr ?? p.maxHr, restingHr: a.restingHr ?? p.restingHr, weightKg: a.weight ?? p.weightKg });
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
    <main class="main" style="max-width:560px">
      <div style="margin:24px 0 28px"><WorkoutProfile blocks={sample.blocks} height={64} hero /></div>
      <h1 style="font-size:32px">{APP_NAME}</h1>

      {step === 'connect' ? (
        <>
          <p class="muted" style="margin:8px 0 26px;font-size:16px;line-height:1.55">Plan the week, send each ride to your Garmin, and see what the ride did for you. Everything stays on this device.</p>
          <h2>Connect Intervals.icu</h2>
          <p class="muted small" style="margin:6px 0 14px">It already has your FTP, threshold heart rate and ride history from Garmin, so there is nothing to type. On intervals.icu, open Settings and scroll to the Developer section: your athlete ID is there, and a button generates the API key.</p>
          {err && <div class="msg err" style="margin-bottom:12px">{err}</div>}
          <div class="form">
            <div class="field"><label>Athlete ID</label><input placeholder="i123456" value={creds.athleteId} onInput={(e) => setCreds({ ...creds, athleteId: (e.target as HTMLInputElement).value })} autofocus /></div>
            <div class="field"><label>API key</label><input type="password" autocomplete="off" value={creds.apiKey} onInput={(e) => setCreds({ ...creds, apiKey: (e.target as HTMLInputElement).value })} /></div>
          </div>
          <button class="btn primary block" style="margin-top:22px" onClick={connect} disabled={busy || !creds.athleteId || !creds.apiKey}>{busy ? 'Connecting…' : 'Connect'}</button>
          <button class="btn quiet block" style="margin-top:8px" onClick={() => setStep('review')}>No account yet, enter numbers by hand</button>
        </>
      ) : (
        <>
          <p class="muted" style="margin:8px 0 22px;font-size:16px;line-height:1.55">
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
            <div class="field"><label>Train by</label>
              <div class="seg"><button class={p.basis === 'power' ? 'on' : ''} onClick={() => upd('basis', 'power' as Basis)}>Power</button><button class={p.basis === 'hr' ? 'on' : ''} onClick={() => upd('basis', 'hr' as Basis)}>Heart rate</button></div></div>
            <div class="field"><label>Units</label>
              <div class="seg"><button class={p.units === 'imperial' ? 'on' : ''} onClick={() => upd('units', 'imperial')}>Miles</button><button class={p.units === 'metric' ? 'on' : ''} onClick={() => upd('units', 'metric')}>Kilometres</button></div></div>
          </div>
          <button class="btn primary block" style="margin-top:26px" onClick={start} disabled={!p.ftp || !p.lthr}>{found ? 'Start and pull my rides' : 'Start'}</button>
          {!found && <button class="btn quiet block" style="margin-top:8px" onClick={() => setStep('connect')}>Back to connecting Intervals.icu</button>}
        </>
      )}
    </main>
  );
}
