import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { notify } from '../store';
import { db, getSetting, saveProfile, setSetting } from '../../data/db';
import { downloadBackup, restoreBackup } from '../../data/backup';
import type { Basis, Profile } from '../../engine/types';
import { zoneTable } from '../../engine/zones';
import { testConnection, type IntervalsCredentials } from '../../sync/intervals';
import { APP_NAME } from '../../appName';
import { ZONE_VAR } from '../Profile';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Settings({ data }: { data: AppData }) {
  const [p, setP] = useState<Profile>(data.profile!);
  const [creds, setCreds] = useState<IntervalsCredentials>({ athleteId: '', apiKey: '' });
  const [claudeKey, setClaudeKey] = useState('');
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSetting<IntervalsCredentials | null>('intervals', null).then((c) => c && setCreds(c));
    getSetting<string>('claudeKey', '').then(setClaudeKey);
    getSetting<string | null>('lastBackup', null).then(setLastBackup);
  }, []);

  const upd = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const num = (k: keyof Profile) => (e: Event) => upd(k, Number((e.target as HTMLInputElement).value) as never);

  async function save() {
    await saveProfile(p);
    await setSetting('claudeKey', claudeKey.trim());
    await setSetting('coachNote', null);
    notify();
    setMsg({ ok: true, text: 'Saved.' });
  }

  async function connect() {
    setBusy(true);
    try {
      const c = { athleteId: creds.athleteId.trim(), apiKey: creds.apiKey.trim() };
      const a = await testConnection(c);
      await setSetting('intervals', c);
      const next = { ...p, name: p.name || a.name, ftp: a.ftp ?? p.ftp, lthr: a.lthr ?? p.lthr, maxHr: a.maxHr ?? p.maxHr, restingHr: a.restingHr ?? p.restingHr, weightKg: a.weight ?? p.weightKg };
      setP(next);
      await saveProfile(next);
      notify();
      setMsg({ ok: true, text: `Connected as ${a.name}.${a.ftp ? ` FTP ${a.ftp} W pulled from Intervals.icu.` : ''} Press Sync on Today to pull rides.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  async function disconnect() {
    await setSetting('intervals', null);
    await db.sync.clear();
    setCreds({ athleteId: '', apiKey: '' });
    notify();
  }

  async function restore(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const r = await restoreBackup(await f.text());
      notify();
      setMsg({ ok: true, text: `Restored ${r.workouts} workouts and ${r.planned} planned sessions. Reloading.` });
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <div>
      <div class="page-head"><h1>Settings</h1><button class="btn primary sm" onClick={save}>Save</button></div>
      {msg && <div class={`msg ${msg.ok ? 'ok' : 'err'}`} style="margin-bottom:14px">{msg.text}</div>}

      <section class="section" style="margin-top:0">
        <h2>Intervals.icu</h2>
        <p class="muted small" style="margin-bottom:12px">The pipe to your Garmin. Find both values on intervals.icu under Settings, in the Developer section near the bottom. Stored only on this device.</p>
        <div class="form">
          <div class="field"><label>Athlete ID</label><input placeholder="i123456" value={creds.athleteId} onInput={(e) => setCreds({ ...creds, athleteId: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label>API key</label><input type="password" autocomplete="off" value={creds.apiKey} onInput={(e) => setCreds({ ...creds, apiKey: (e.target as HTMLInputElement).value })} /></div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" onClick={connect} disabled={busy || !creds.athleteId || !creds.apiKey}>{busy ? 'Checking…' : 'Connect'}</button>
          <button class="btn quiet" onClick={disconnect}>Disconnect</button>
        </div>
      </section>

      <section class="section">
        <h2>You</h2>
        <div class="form">
          <div class="field"><label>Name</label><input value={p.name} onInput={(e) => upd('name', (e.target as HTMLInputElement).value)} /></div>
          <div class="field"><label>FTP (watts)</label><input type="number" value={p.ftp} onInput={num('ftp')} /></div>
          <div class="field"><label>Threshold heart rate (bpm)</label><input type="number" value={p.lthr} onInput={num('lthr')} /></div>
          <div class="field"><label>Max heart rate</label><input type="number" value={p.maxHr} onInput={num('maxHr')} /></div>
          <div class="field"><label>Resting heart rate</label><input type="number" value={p.restingHr} onInput={num('restingHr')} /></div>
          <div class="field"><label>Weight ({p.units === 'imperial' ? 'lb' : 'kg'})</label>
            <input type="number" value={p.units === 'imperial' ? Math.round(p.weightKg * 2.2046) : Math.round(p.weightKg)} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); upd('weightKg', p.units === 'imperial' ? v / 2.2046 : v); }} /></div>
          <div class="field"><label>Hours per week</label><input type="number" step="0.5" value={p.hoursPerWeek} onInput={num('hoursPerWeek')} /></div>
          <div class="field"><label>Birth year</label><input type="number" value={p.birthYear ?? ''} onInput={(e) => upd('birthYear', Number((e.target as HTMLInputElement).value) || undefined)} /></div>
        </div>
        <div class="row wrap" style="margin-top:14px;gap:18px">
          <div class="field"><label>Default basis</label>
            <div class="seg"><button class={p.basis === 'power' ? 'on' : ''} onClick={() => upd('basis', 'power' as Basis)}>Power</button><button class={p.basis === 'hr' ? 'on' : ''} onClick={() => upd('basis', 'hr' as Basis)}>Heart rate</button></div></div>
          <div class="field"><label>Units</label>
            <div class="seg"><button class={p.units === 'imperial' ? 'on' : ''} onClick={() => upd('units', 'imperial')}>Miles, lb, °F</button><button class={p.units === 'metric' ? 'on' : ''} onClick={() => upd('units', 'metric')}>km, kg, °C</button></div></div>
          <div class="field"><label>Masters recovery (over 50)</label>
            <div class="seg"><button class={p.masters ? 'on' : ''} onClick={() => upd('masters', true)}>On</button><button class={!p.masters ? 'on' : ''} onClick={() => upd('masters', false)}>Off</button></div></div>
        </div>
        <div class="field" style="margin-top:14px"><label>Days you can ride</label>
          <div class="chips">{DAYS.map((d, i) => <button key={d} class={`chip${p.rideDays.includes(i) ? ' on' : ''}`} onClick={() => upd('rideDays', p.rideDays.includes(i) ? p.rideDays.filter((x) => x !== i) : [...p.rideDays, i].sort())}>{d}</button>)}</div></div>
      </section>

      <section class="section">
        <h2>Zones</h2>
        <p class="muted small" style="margin-bottom:10px">Derived from FTP and threshold heart rate. Change the numbers above and these follow.</p>
        <table class="steps">
          <tr><td /><td class="faint small">Zone</td><td class="r faint small">Watts</td><td class="r faint small">Heart rate</td></tr>
          {zoneTable(p, 'power').map((z, i) => {
            const h = zoneTable(p, 'hr')[i];
            return (
              <tr key={z.zone.n}>
                <td><span class="z" style={`background:${ZONE_VAR[i]}`} /></td>
                <td>Z{z.zone.n} {z.zone.name}</td>
                <td class="r num">{z.low}{z.high != null ? `–${z.high}` : '+'}</td>
                <td class="r num">{i >= 5 ? <span class="faint">—</span> : `${h.low}${h.high != null ? `–${h.high}` : '+'}`}</td>
              </tr>
            );
          })}
        </table>
      </section>

      <section class="section">
        <h2>Coach (optional)</h2>
        <p class="muted small" style="margin-bottom:12px">With a Claude API key, Today gets a short daily note from a coach who has read your numbers. The key is stored only on this device and calls go straight to Anthropic. Leave blank to skip.</p>
        <div class="field"><label>Claude API key</label><input type="password" autocomplete="off" value={claudeKey} onInput={(e) => setClaudeKey((e.target as HTMLInputElement).value)} placeholder="sk-ant-…" /></div>
      </section>

      <section class="section">
        <h2>Backup</h2>
        <p class="muted small" style="margin-bottom:12px">One file with your profile, settings, keys, workouts and plan. Rides come back from Intervals.icu on their own. {lastBackup ? `Last backup ${new Date(lastBackup).toLocaleDateString()}.` : 'No backup yet.'}</p>
        <div class="row wrap">
          <button class="btn" onClick={() => downloadBackup().then(() => getSetting<string | null>('lastBackup', null).then(setLastBackup))}>Save backup file</button>
          <label class="btn" style="position:relative;overflow:hidden">Restore from file<input type="file" accept="application/json,.json" style="position:absolute;inset:0;opacity:0;cursor:pointer" onChange={restore} /></label>
        </div>
      </section>

      <p class="faint small" style="margin-top:36px">{APP_NAME} 2.0 · phase 1 · all data stays on this device</p>
    </div>
  );
}
