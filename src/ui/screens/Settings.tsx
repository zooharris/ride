import { DAY_SHORT, dayOrder, setFirstDay, fmtDate } from '../derived';
import { useEffect, useState } from 'preact/hooks';
import { formatPace, parsePace } from '../../engine/run';
import type { AppData } from '../store';
import { notify } from '../store';
import { db, getSetting, saveProfile, setSetting } from '../../data/db';
import { autoBackup, downloadBackup, restoreBackup } from '../../data/backup';
import { clearLock, lockStatus, setLock, syncDevices, unlockNote, type DeviceSyncState } from '../../data/devicesync';
import type { Basis, Profile } from '../../engine/types';
import { footHrZones, footLthr as footThreshold, ladderPcts, ladderTops, rideHrZones, ridePowerZones, tableOf, validTops, type Zone, type ZoneMode } from '../../engine/zones';
import { applyAthleteNumbers, numbersToPush, pushAthleteNumbers, testConnection, type IntervalsCredentials } from '../../sync/intervals';
import { runSelfTest, type CheckResult } from '../../sync/selfTest';
import { APP_NAME } from '../../appName';
import { applyUpdate, buildTime, checkForUpdate, updateReady } from '../update';
import { ZONE_VAR } from '../Profile';
import { toast } from '../Toast';
import { PageHead } from '../PageHead';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../theme';
import { historyCoverage, loadHistory } from '../../sync/syncService';
import { addDays, today } from '../../engine/load';


export function Settings({ data }: { data: AppData }) {
  const [p, setP] = useState<Profile>(data.profile!);
  const [creds, setCreds] = useState<IntervalsCredentials>({ athleteId: '', apiKey: '' });
  const [claudeKey, setClaudeKey] = useState('');
  const [coachAuto, setCoachAuto] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSyncState | null>(null);
  const setMsg = toast;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSetting<IntervalsCredentials | null>('intervals', null).then((c) => c && setCreds(c));
    getSetting<string>('claudeKey', '').then((k) => { setClaudeKey(k); setSavedKey(k); });
    getSetting<boolean>('coachAuto', false).then((v) => { setCoachAuto(v); setSavedAuto(v); });
    getSetting<string | null>('lastBackup', null).then(setLastBackup);
    getSetting<DeviceSyncState | null>('deviceSync', null).then(setDevices);
  }, []);

  const upd = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const [savedKey, setSavedKey] = useState('');
  const [savedAuto, setSavedAuto] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(data.profile) || claudeKey !== savedKey || coachAuto !== savedAuto;
  function discard() {
    if (!confirm('Discard the changes on this page?')) return;
    setP(data.profile!); setClaudeKey(savedKey); setCoachAuto(savedAuto); setMsg(null);
  }
  const num = (k: keyof Profile) => (e: Event) => upd(k, Number((e.target as HTMLInputElement).value) as never);

  async function save() {
    setFirstDay(p.weekStartsOn === 0 ? 0 : 1);
    await saveProfile(p);
    // The database stamps the profile on every write; take the stored copy so the page reads as saved.
    const stored = await db.profile.get('me');
    if (stored) setP(stored);
    await setSetting('claudeKey', claudeKey.trim());
    await setSetting('coachAuto', coachAuto && !!claudeKey.trim());
    // The day's note is rewritten only when something the coach reads changed.
    if (coachFieldsChanged(data.profile!, p) || claudeKey.trim() !== savedKey) await setSetting('coachNote', null);
    setSavedKey(claudeKey.trim()); setSavedAuto(coachAuto && !!claudeKey.trim());
    notify();
    const before = data.profile!;
    const numbers = (x: Profile) => JSON.stringify(numbersToPush(x));
    const changed = numbers(p) !== numbers(before);
    const c = await getSetting<IntervalsCredentials | null>('intervals', null);
    if (changed && c?.apiKey) {
      try {
        await pushAthleteNumbers(c, numbersToPush(p));
        setMsg({ ok: true, text: `Saved, and sent to Intervals.icu: FTP ${p.ftp} W, threshold heart rate ${p.lthr} bpm on the bike and ${footThreshold(p)} on foot, max ${p.maxHr}, and all three zone tables. Garmin workouts and Intervals.icu now use these numbers.` })
      } catch (e) {
        setMsg({ ok: false, text: `Saved here, but Intervals.icu was not updated: ${(e as Error).message} Until it is, workouts sent to Garmin use the numbers Intervals.icu has.` });
      }
    } else {
      setMsg({ ok: true, text: 'Saved.' });
    }
  }

  async function connect() {
    setBusy(true);
    try {
      const c = { athleteId: creds.athleteId.trim(), apiKey: creds.apiKey.trim() };
      const a = await testConnection(c);
      await setSetting('intervals', c);
      const next = applyAthleteNumbers({ ...p, name: p.name || a.name }, a);
      setP(next);
      await saveProfile(next);
      notify();
      setMsg({ ok: true, text: `Connected as ${a.name}.${a.ftp ? ` FTP ${a.ftp} W pulled from Intervals.icu.` : ''} Press Sync on Today to pull rides.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [testing, setTesting] = useState(false);
  async function runChecks() {
    setTesting(true); setChecks([]);
    const c = { athleteId: creds.athleteId.trim(), apiKey: creds.apiKey.trim() };
    try { await runSelfTest(c, (r) => setChecks((prev) => [...prev, r])); } finally { setTesting(false); }
  }

  async function disconnect() {
    if (!confirm('Disconnect Intervals.icu?\n\nThe athlete ID and API key are removed from this device and syncing stops until you connect again. Your activities, calendar and plans stay as they are here.')) return;
    await setSetting('intervals', null);
    await db.sync.clear();
    setCreds({ athleteId: '', apiKey: '' });
    notify();
  }

  async function backupNow() {
    const c = await getSetting<IntervalsCredentials | null>('intervals', null);
    if (!c?.apiKey) { setMsg({ ok: false, text: 'Connect Intervals.icu first; the automatic backup is kept in your account there.' }); return; }
    setBusy(true);
    const r = await autoBackup(c, true);
    getSetting<DeviceSyncState | null>('deviceSync', null).then(setDevices);
    setBusy(false);
    if (r.ok) { notify(); setMsg({ ok: true, text: 'Synced with your Intervals.icu account: this device and the note there now match.' }); }
    else setMsg({ ok: false, text: `Sync across devices failed: ${r.error}. The file backup below still works.` });
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
      <PageHead title="Settings" help="settings">
        {dirty && <button class="btn sm quiet" onClick={discard}>Discard changes</button>}<button class="btn primary sm" onClick={save} disabled={!dirty}>Save</button>
      </PageHead>

      <Appearance />

      <section class="section">
        <h2>Intervals.icu</h2>
        <p class="muted small" style="margin-bottom:12px">The pipe to your Garmin. Find both values on intervals.icu under Settings, in the Developer section near the bottom. Stored only on this device. FTP, threshold heart rates, max heart rate and the zone tables are kept in step both ways: change them here and Save sends them to Intervals.icu; change them there and the next sync brings them here.</p>
        <div class="form">
          <div class="field"><label>Athlete ID</label><input placeholder="i123456" value={creds.athleteId} onInput={(e) => setCreds({ ...creds, athleteId: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label>API key</label><input type="password" autocomplete="off" value={creds.apiKey} onInput={(e) => setCreds({ ...creds, apiKey: (e.target as HTMLInputElement).value })} /></div>
        </div>
        <div class="row wrap" style="margin-top:12px">
          <button class="btn" onClick={connect} disabled={busy || !creds.athleteId || !creds.apiKey}>{busy ? 'Checking…' : 'Connect'}</button>
          <button class="btn danger" onClick={disconnect}>Disconnect</button>
          <button class="btn quiet" onClick={runChecks} disabled={testing || !creds.athleteId || !creds.apiKey} style="margin-left:auto">{testing ? 'Running checks…' : 'Run connection checks'}</button>
        </div>
        {checks.length > 0 && (
          <div class="panel" style="margin-top:12px;padding:10px 14px">
            <div class="row between"><b class="small">Connection checks</b><span class="faint small">{checks.filter((c) => c.ok).length} of {checks.length} passed{testing ? '…' : ''}</span></div>
            <div class="stack" style="gap:6px;margin-top:8px">
              {checks.map((c) => (
                <div key={c.name} class="row" style="align-items:flex-start;gap:10px">
                  <span class="tick" style={`width:18px;height:18px;border-radius:50%;flex:0 0 18px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px;background:${c.ok ? 'var(--good)' : 'var(--bad)'};color:var(--on-color)`}>{c.ok ? '✓' : '!'}</span>
                  <div class="small"><b>{c.name}</b><div class="muted" style="line-height:1.45">{c.detail}</div></div>
                </div>
              ))}
            </div>
            <p class="faint small" style="margin:10px 0 0">Every kind of call the app makes, tried for real. Writes are limited to a test note and a one-minute test session on 30 Dec 2099, both deleted again at once, and your backup.</p>
          </div>
        )}
      </section>

      <HistoryLoader />

      <section class="section">
        <h2>You</h2>
        <div class="form">
          <div class="field"><label>Name</label><input value={p.name} onInput={(e) => upd('name', (e.target as HTMLInputElement).value)} /></div>
          <div class="field"><label>Resting heart rate</label><input type="number" value={p.restingHr} onInput={num('restingHr')} /></div>
          <div class="field"><label>Weight ({p.units === 'imperial' ? 'lb' : 'kg'})</label>
            <input type="number" value={p.units === 'imperial' ? Math.round(p.weightKg * 2.2046) : Math.round(p.weightKg)} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); upd('weightKg', p.units === 'imperial' ? v / 2.2046 : v); }} /></div>
          <div class="field"><label>Hours per week</label><input type="number" step="0.5" value={p.hoursPerWeek} onInput={num('hoursPerWeek')} /></div>
          <div class="field"><label>Birth year</label><input type="number" value={p.birthYear ?? ''} onInput={(e) => upd('birthYear', Number((e.target as HTMLInputElement).value) || undefined)} /></div>
        </div>
        <div class="row wrap" style="margin-top:14px;gap:18px">
          <div class="field"><label>Targets sent to Garmin</label>
            <div class="seg"><button class={p.basis === 'power' ? 'on' : ''} onClick={() => upd('basis', 'power' as Basis)}>Power</button><button class={p.basis === 'hr' ? 'on' : ''} onClick={() => upd('basis', 'hr' as Basis)}>Heart rate</button></div></div>
          <div class="field"><label>Units</label>
            <div class="seg"><button class={p.units === 'imperial' ? 'on' : ''} onClick={() => upd('units', 'imperial')}>Miles, lb, °F</button><button class={p.units === 'metric' ? 'on' : ''} onClick={() => upd('units', 'metric')}>km, kg, °C</button></div></div>
          <div class="field"><label>Week starts on</label>
            <div class="seg"><button class={(p.weekStartsOn ?? 1) === 1 ? 'on' : ''} onClick={() => upd('weekStartsOn', 1)}>Monday</button><button class={p.weekStartsOn === 0 ? 'on' : ''} onClick={() => upd('weekStartsOn', 0)}>Sunday</button></div></div>
          <div class="field"><label>Masters recovery (over 50)</label>
            <div class="seg"><button class={p.masters ? 'on' : ''} onClick={() => upd('masters', true)}>On</button><button class={!p.masters ? 'on' : ''} onClick={() => upd('masters', false)}>Off</button></div></div>
        </div>
        <div class="field" style="margin-top:14px"><label>Days you can ride</label>
          <div class="chips">{dayOrder().map((i) => <button key={i} class={`chip${p.rideDays.includes(i) ? ' on' : ''}`} onClick={() => upd('rideDays', p.rideDays.includes(i) ? p.rideDays.filter((x) => x !== i) : [...p.rideDays, i].sort())}>{DAY_SHORT[i]}</button>)}</div></div>
      </section>

      <section class="section">
        <h2>Thresholds and zones</h2>
        <p class="muted small" style="margin-bottom:12px">Your numbers live here. Save sends them to Intervals.icu, which uses them for every workout it passes to your Garmin and for how it files your recordings. Set the same zones on the Garmin itself once (it keeps its own copy), and all three agree. Each table can be entered as shares of its threshold, which move when the threshold changes, or as watts or beats per minute, which stay where you put them. Threshold heart rate on foot is usually a few beats above the bike's, so runs and walks have their own.</p>

        <div class="panel" style="margin-top:4px;border-left:4px solid var(--ride)">
          <div class="row between wrap" style="align-items:baseline;gap:10px;margin-bottom:10px">
            <h3 style="margin:0;font-size:17px">On the bike</h3>
            <span class="muted small">Rides: FTP, threshold heart rate, max, and the power and heart-rate tables.</span>
          </div>
        <div class="form">
          <div class="field"><label>FTP (watts)</label><input type="number" value={p.ftp} onInput={num('ftp')} /></div>
          <div class="field"><label>Threshold heart rate (bpm)</label><input type="number" value={p.lthr} onInput={num('lthr')} /></div>
          <div class="field"><label>Max heart rate</label><input type="number" value={p.maxHr} onInput={num('maxHr')} /></div>
        </div>
        <ZoneEditor title="Power zones" unit="W" threshold={p.ftp} zones={ridePowerZones(p)} mode={p.powerZoneMode ?? 'pct'} custom={!!(p.powerZonePcts || p.powerZoneWatts)}
          onMode={(m) => setP({ ...p, powerZoneMode: m, powerZonePcts: ladderPcts(ridePowerZones(p)), powerZoneWatts: ladderTops(ridePowerZones(p), p.ftp) })}
          onPcts={(v) => setP({ ...p, powerZoneMode: 'pct', powerZonePcts: v })} onAbs={(v) => setP({ ...p, powerZoneMode: 'abs', powerZoneWatts: v })}
          onStandard={() => setP({ ...p, powerZoneMode: undefined, powerZonePcts: undefined, powerZoneWatts: undefined })} />
        <ZoneEditor title="Heart-rate zones" unit="bpm" threshold={p.lthr} max={p.maxHr} zones={rideHrZones(p)} mode={p.hrZoneMode ?? (p.hrZoneTops ? 'abs' : 'pct')} custom={!!(p.hrZonePcts || p.hrZoneTops)}
          onMode={(m) => setP({ ...p, hrZoneMode: m, hrZonePcts: ladderPcts(rideHrZones(p)), hrZoneTops: ladderTops(rideHrZones(p), p.lthr) })}
          onPcts={(v) => setP({ ...p, hrZoneMode: 'pct', hrZonePcts: v })} onAbs={(v) => setP({ ...p, hrZoneMode: 'abs', hrZoneTops: v })}
          onStandard={() => setP({ ...p, hrZoneMode: undefined, hrZonePcts: undefined, hrZoneTops: undefined })} />

        </div>

        <div class="panel" style="margin-top:16px;border-left:4px solid var(--walk)">
          <div class="row between wrap" style="align-items:baseline;gap:10px;margin-bottom:10px">
            <h3 style="margin:0;font-size:17px">On foot</h3>
            <span class="muted small">Runs and walks: their own threshold heart rate, the run pace, and their own heart-rate table.</span>
          </div>
        <div class="form">
          <div class="field"><label>Threshold heart rate (bpm)</label><input type="number" value={footThreshold(p)} onInput={(e) => upd('footLthr', Number((e.target as HTMLInputElement).value) || undefined)} />
            {!p.footLthr && <span class="faint small">Not set yet: the bike's number is used. Most people run 3 to 6 beats higher.</span>}</div>
          <PaceField key={p.units} value={p.thresholdPaceSec} imperial={p.units === 'imperial'} onChange={(v) => upd('thresholdPaceSec', v)} />
        </div>
        <ZoneEditor title="Heart-rate zones on foot" unit="bpm" threshold={footThreshold(p)} max={p.maxHr} zones={footHrZones(p)} mode={p.footHrZoneMode ?? (p.footHrZoneTops ? 'abs' : 'pct')} custom={!!(p.footHrZonePcts || p.footHrZoneTops)}
          onMode={(m) => setP({ ...p, footHrZoneMode: m, footHrZonePcts: ladderPcts(footHrZones(p)), footHrZoneTops: ladderTops(footHrZones(p), footThreshold(p)) })}
          onPcts={(v) => setP({ ...p, footHrZoneMode: 'pct', footHrZonePcts: v })} onAbs={(v) => setP({ ...p, footHrZoneMode: 'abs', footHrZoneTops: v })}
          onStandard={() => setP({ ...p, footHrZoneMode: undefined, footHrZonePcts: undefined, footHrZoneTops: undefined })} />
        </div>
      </section>

      <section class="section">
        <h2>Coach (optional)</h2>
        <p class="muted small" style="margin-bottom:12px">With a Claude API key, Today gets a coach who has read your numbers: a short daily note, a review after each sync, and answers to your questions. The daily note reads your notes from the last three months; the review after a sync reads the last two weeks. The key is stored only on this device and calls go straight to Anthropic. Leave blank to skip.</p>
        <div class="field"><label>Claude API key</label><input type="password" autocomplete="off" value={claudeKey} onInput={(e) => setClaudeKey((e.target as HTMLInputElement).value)} placeholder="sk-ant-…" /></div>
        <div class="field" style="margin-top:12px"><label>The coach reviews your new activities and decides which plan changes to recommend</label>
          <div class="seg"><button class={coachAuto ? 'on' : ''} onClick={() => setCoachAuto(true)} disabled={!claudeKey.trim()}>On</button><button class={!coachAuto ? 'on' : ''} onClick={() => setCoachAuto(false)}>Off</button></div>
          <p class="faint small" style="margin-top:6px">On: each time a sync brings in new rides or sessions, the coach reviews them on Today; and whenever the plan finds something to change, the coach decides which changes to recommend and says why beside each. Off: the app's own list of changes is shown, with its reasons. Either way, nothing changes on the plan until you accept it.</p></div>
      </section>

      <section class="section">
        <h2>Across your devices, and backup</h2>
        <p class="muted small" style="margin-bottom:12px">Your plans, calendar, workouts, day notes and settings are kept in step between every device signed in to the same Intervals.icu account, through a private note in that account dated far in the future. Your API keys never go into the note; each device keeps its own. Each device merges with the note when the app opens, comes back to the front, syncs, and a few seconds after any change; the newest change to each record wins, and deletions carry across. A new device picks everything up from the note on its first merge. Activities come back from Intervals.icu on their own.</p>
        <p class="small" style="margin-bottom:12px">{devices?.last ? <>Last merged {new Date(devices.last).toLocaleString()}{devices.device ? ` · the note was last written by ${devices.device}` : ''}.</> : 'Not merged with the note yet.'}{devices?.error && (!devices.last || devices.error > devices.last) ? <span style="color:var(--bad)"> Last attempt failed: {devices.error.replace(/^\S+ /, '')}</span> : null}{devices?.locked ? <span style="color:var(--warn)"> The note is encrypted and this device has not unlocked it yet; see below.</span> : null}</p>
        <div class="row wrap">
          <button class="btn" onClick={backupNow} disabled={busy}>Sync now</button>
        </div>
        <NoteLock devices={devices} onChange={() => getSetting<DeviceSyncState | null>('deviceSync', null).then(setDevices)} busy={busy} setBusy={setBusy} setMsg={setMsg} />
        <p class="muted small" style="margin:16px 0 8px">A file copy as well, for your own keeping; unlike the note, the file includes your API keys, so keep it where you keep passwords. {lastBackup ? `Last file backup ${new Date(lastBackup).toLocaleDateString()}.` : ''}</p>
        <div class="row wrap">
          <button class="btn" onClick={() => downloadBackup().then(() => getSetting<string | null>('lastBackup', null).then(setLastBackup))}>Save backup file</button>
          <label class="btn" style="position:relative;overflow:hidden">Restore from file<input type="file" accept="application/json,.json" style="position:absolute;inset:0;opacity:0;cursor:pointer" onChange={restore} /></label>
        </div>
      </section>

      <p class="faint small" style="margin-top:36px">{APP_NAME} 2.0 · your data stays on your devices and in your Intervals.icu account</p>
      <UpdateCheck />
    </div>
  );
}


/**
 * The lock on the note in Intervals.icu. Three states: not locked (set it up),
 * locked on this device (unlock with the passphrase or the answer), locked and
 * open here (change or turn off). The passphrase and answer never leave the
 * browser; only wrapped copies of the data key travel with the note.
 */
function NoteLock({ devices, onChange, busy, setBusy, setMsg }: { devices: DeviceSyncState | null; onChange: () => void; busy: boolean; setBusy: (b: boolean) => void; setMsg: (m: { ok: boolean; text: string } | null) => void }) {
  const [status, setStatus] = useState<{ on: boolean; question?: string } | null>(null);
  const [mode, setMode] = useState<'view' | 'setup' | 'change'>('view');
  const [pass, setPass] = useState(''); const [pass2, setPass2] = useState('');
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState('');
  const [unlockPass, setUnlockPass] = useState(''); const [unlockAnswer, setUnlockAnswer] = useState('');
  const refresh = () => lockStatus().then(setStatus);
  useEffect(() => { refresh(); }, [devices?.locked?.at]);
  const locked = !!devices?.locked && !status?.on;

  async function save() {
    if (pass.length < 8) { setMsg({ ok: false, text: 'Use a passphrase of at least 8 characters.' }); return; }
    if (pass !== pass2) { setMsg({ ok: false, text: 'The two passphrases do not match.' }); return; }
    if (!question.trim() || !answer.trim()) { setMsg({ ok: false, text: 'Add a question and its answer, so you can get back in if you forget the passphrase.' }); return; }
    setBusy(true);
    try {
      await setLock(pass, question, answer);
      const c = await getSetting<IntervalsCredentials | null>('intervals', null);
      if (c?.apiKey) await syncDevices(c);
      setPass(''); setPass2(''); setQuestion(''); setAnswer(''); setMode('view'); refresh(); onChange();
      setMsg({ ok: true, text: mode === 'change' ? 'Passphrase and question changed. Your other devices keep working; a new device will need the new passphrase or answer.' : 'The note is now encrypted. Your other devices will ask for the passphrase, or the answer to your question, the next time they open the app.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function unlock(by: 'passphrase' | 'answer') {
    const c = await getSetting<IntervalsCredentials | null>('intervals', null);
    if (!c?.apiKey) return;
    setBusy(true);
    try {
      const ok = await unlockNote(c, by === 'passphrase' ? unlockPass : unlockAnswer, by);
      if (!ok) { setMsg({ ok: false, text: by === 'passphrase' ? 'That passphrase does not open the note.' : 'That answer does not open the note. Spelling counts, but not capitals, spaces or punctuation.' }); return; }
      await syncDevices(c);
      notify();
      setUnlockPass(''); setUnlockAnswer(''); refresh(); onChange();
      setMsg({ ok: true, text: 'Unlocked. This device now opens the note on its own.' });
    } finally { setBusy(false); }
  }

  async function turnOff() {
    if (!confirm('Turn encryption off? The note in Intervals.icu will be written in the clear on the next sync, and your other devices will stop asking for the passphrase. Are you sure?')) return;
    setBusy(true);
    try {
      await clearLock();
      const c = await getSetting<IntervalsCredentials | null>('intervals', null);
      if (c?.apiKey) await syncDevices(c);
      refresh(); onChange();
      setMsg({ ok: true, text: 'Encryption is off.' });
    } finally { setBusy(false); }
  }

  if (!status) return null;
  const form = (
    <div class="stack" style="gap:10px;margin-top:10px;max-width:520px">
      <div class="field"><label>Passphrase</label><input type="password" autocomplete="new-password" value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} /></div>
      <div class="field"><label>Passphrase again</label><input type="password" autocomplete="new-password" value={pass2} onInput={(e) => setPass2((e.target as HTMLInputElement).value)} /></div>
      <div class="field"><label>A question only you can answer, for when you forget the passphrase</label><input placeholder="e.g. Name of my first bike?" value={question} onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} /></div>
      <div class="field"><label>Its answer</label><input autocomplete="off" value={answer} onInput={(e) => setAnswer((e.target as HTMLInputElement).value)} /></div>
      <p class="faint small">Pick a question whose answer someone who knows you could not guess; anyone who can read the note could try it. Capitals, spaces and punctuation in the answer do not matter.</p>
      <div class="row" style="gap:8px">
        <button class="btn primary" onClick={save} disabled={busy}>{mode === 'change' ? 'Change' : 'Encrypt the note'}</button>
        <button class="btn quiet" onClick={() => { setMode('view'); setPass(''); setPass2(''); setQuestion(''); setAnswer(''); }} disabled={busy}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
      <h3>Encryption of the note</h3>
      {locked ? (
        <div style="margin-top:8px">
          <p class="small" style="color:var(--warn)">The note in Intervals.icu is encrypted and this device cannot open it yet. Nothing is synced until you unlock it; nothing here is lost.</p>
          <div class="stack" style="gap:10px;margin-top:10px;max-width:520px">
            <div class="field"><label>Passphrase</label><div class="row" style="gap:8px"><input type="password" autocomplete="current-password" value={unlockPass} onInput={(e) => setUnlockPass((e.target as HTMLInputElement).value)} style="flex:1" /><button class="btn" onClick={() => unlock('passphrase')} disabled={busy || !unlockPass}>Unlock</button></div></div>
            <div class="field"><label>Or answer your question: <b>{devices!.locked!.question}</b></label><div class="row" style="gap:8px"><input autocomplete="off" value={unlockAnswer} onInput={(e) => setUnlockAnswer((e.target as HTMLInputElement).value)} style="flex:1" /><button class="btn" onClick={() => unlock('answer')} disabled={busy || !unlockAnswer}>Unlock</button></div></div>
          </div>
        </div>
      ) : status.on ? (
        <div style="margin-top:8px">
          <p class="muted small">The note is encrypted before it leaves this browser; Intervals.icu holds only the scrambled copy. Your question: <b>{status.question}</b>. A new device opens the note with the passphrase or the answer.</p>
          {mode === 'change' ? form : (
            <div class="row wrap" style="margin-top:10px;gap:8px">
              <button class="btn" onClick={() => setMode('change')} disabled={busy}>Change passphrase or question</button>
              <button class="btn danger" onClick={turnOff} disabled={busy}>Turn off</button>
            </div>
          )}
        </div>
      ) : (
        <div style="margin-top:8px">
          <p class="muted small">The note is stored compressed but readable by anyone who can see your Intervals.icu calendar. Encrypt it with a passphrase you choose; the passphrase stays in this browser and you type it once on each other device. If you forget it, a question you set here gets you back in.</p>
          {mode === 'setup' ? form : <button class="btn" style="margin-top:10px" onClick={() => setMode('setup')} disabled={busy}>Encrypt the note</button>}
        </div>
      )}
    </div>
  );
}

/** Light, dark, or whatever the device is set to. Applies at once; no Save needed. */
function Appearance() {
  const [t, setT] = useState<ThemeChoice>(getThemeChoice());
  const pick = (c: ThemeChoice) => { setT(c); setThemeChoice(c); };
  return (
    <section class="section" style="margin-top:0">
      <h2>Appearance</h2>
      <div class="panel row between wrap" style="gap:12px">
        <p class="muted small" style="max-width:46ch">Dark, light, or follow the setting on this device. Takes effect at once.</p>
        <div class="seg theme" role="radiogroup" aria-label="Theme">
          {([['system', 'System'], ['dark', 'Dark'], ['light', 'Light']] as Array<[ThemeChoice, string]>).map(([c, l]) => (
            <button key={c} role="radio" aria-checked={t === c} class={t === c ? 'on' : ''} onClick={() => pick(c)}>{l}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Older history on demand. The first sync brings 120 days and later ones the
 * last two weeks; this pulls further back, for the long Progress ranges, the
 * power curve and a fitness number built on the full record.
 */
function HistoryLoader() {
  const [cov, setCov] = useState<{ from?: string; wellnessFrom?: string; activities: number } | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [custom, setCustom] = useState('');
  const refresh = () => historyCoverage().then(setCov);
  useEffect(() => { refresh(); }, []);
  const t = today();
  async function load(back: string) {
    setProg({ done: 0, total: 1 });
    try {
      const r = await loadHistory(back, (done, total) => setProg({ done, total }));
      notify();
      toast({ ok: true, text: r.activities || r.wellness ? `Loaded ${r.activities} more activities and ${r.wellness} more days of wellness.` : 'Nothing new: this device already has everything Intervals.icu holds for that span. If a Garmin history import is still running there, try again once it has finished.' });
    } catch (e) {
      toast({ ok: false, text: `Stopped part-way: ${(e as Error).message} What arrived is kept; try again to continue.` });
    } finally { setProg(null); refresh(); }
  }
  const busy = prog != null;
  return (
    <section class="section">
      <h2>History</h2>
      <p class="muted small" style="margin:4px 0 12px;max-width:70ch">The first sync brings the last 120 days; every sync after that brings the last two weeks. Load older history for the long ranges on Progress, a fuller power curve, and a fitness number built on your whole record. It only adds what this device does not have, so it is safe to run again, for example after importing older history into Intervals.icu. <b>Your other devices follow</b>: load history on one and the rest load back to the same date on their own the next time they open, so fitness, readiness and the plan's suggestions are the same everywhere.</p>
      <div class="panel">
        <p class="small" style="margin-bottom:10px">{cov?.from ? <>This device has <b>{cov.activities}</b> activities, back to <b>{fmtDate(cov.from, { month: 'long', day: 'numeric', year: 'numeric' })}</b>{cov.wellnessFrom ? <>, and wellness (sleep, HRV, resting heart rate) back to <b>{fmtDate(cov.wellnessFrom, { month: 'long', day: 'numeric', year: 'numeric' })}</b></> : ''}.</> : 'Nothing synced yet. Press Sync on Today first.'}</p>
        <div class="row wrap" style="gap:8px">
          <button class="btn sm" disabled={busy || !cov?.from} onClick={() => load(addDays(t, -365))}>Back one year</button>
          <button class="btn sm" disabled={busy || !cov?.from} onClick={() => load(addDays(t, -730))}>Back two years</button>
          <span class="faint small">or from</span>
          <input type="date" value={custom} max={t} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} style="width:auto;min-height:32px;padding:4px 8px" aria-label="Load history from this date" />
          <button class="btn sm" disabled={busy || !custom || !cov?.from} onClick={() => load(custom)}>Load</button>
        </div>
        {busy && <div style="margin-top:12px"><div class="ws-track"><div class="ws-fill" style={`width:${prog!.total ? (prog!.done / prog!.total) * 100 : 0}%`} /></div><p class="faint small">Loading… {prog!.done} of {prog!.total} two-month pieces. You can keep using the app.</p></div>}
        <p class="faint small" style="margin-top:10px">Fitness and the charts count up to two years back. The power curve reads each newly loaded ride in the background the next time you open Progress.</p>
        <p class="faint small" style="margin-top:6px">This can only bring what Intervals.icu holds. Its Garmin link fetches at most a year of history from before you connected it; for older years, use <b>Import all Garmin Data</b> in Intervals.icu's Garmin settings, then load here again. Activities that reached Intervals.icu only from Strava are not shared with other apps.</p>
      </div>
    </section>
  );
}

/** Which build this is, and a button to look for a newer one now. */
function UpdateCheck() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'ready'>(updateReady() ? 'ready' : 'idle');
  const [updating, setUpdating] = useState(false);
  const check = async () => { setState('checking'); setState((await checkForUpdate(true)) ? 'ready' : 'latest'); };
  return (
    <div class="row wrap" style="gap:8px 14px;margin-top:28px;align-items:center">
      <p class="faint small" style="margin:0">This version of {APP_NAME} was built {buildTime()}.</p>
      {state === 'ready'
        ? <button class="btn primary sm" disabled={updating} onClick={() => { setUpdating(true); void applyUpdate(); }}>{updating ? 'Updating…' : 'A newer version is ready: reload'}</button>
        : <button class="btn sm" disabled={state === 'checking'} onClick={check}>{state === 'checking' ? 'Checking…' : 'Check for updates'}</button>}
      {state === 'latest' && <span class="small muted">You have the latest version.</span>}
    </div>
  );
}

/** Profile fields the coach is told about: a change to any of them means the day's note is out of date. */
export const COACH_FIELDS = ['name', 'birthYear', 'masters', 'units', 'ftp', 'lthr', 'footLthr', 'hoursPerWeek', 'basis'] as const;
export function coachFieldsChanged(before: Profile, after: Profile): boolean {
  // The coach is told the zone tops too, so a changed table rewrites its note; max HR alone is not something it reads.
  const tops = (p: Profile) => JSON.stringify([ladderTops(rideHrZones(p), p.lthr), ladderPcts(ridePowerZones(p))]);
  return COACH_FIELDS.some((k) => before[k] !== after[k]) || tops(before) !== tops(after);
}

/**
 * Threshold run pace as m:ss per mile or km (stored per km). Typed as text and read
 * when it makes sense, so "8:" on the way to "8:05" is not thrown away.
 */
function PaceField({ value, imperial, onChange }: { value?: number; imperial: boolean; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(formatPace(value, imperial));
  const bad = text.trim() !== '' && parsePace(text, imperial) == null;
  return (
    <div class="field"><label>Threshold run pace (min per {imperial ? 'mile' : 'km'})</label>
      <input value={text} placeholder="e.g. 8:30" inputMode="numeric" aria-invalid={bad} onInput={(e) => { const t = (e.target as HTMLInputElement).value; setText(t); if (!t.trim()) onChange(undefined); else { const v = parsePace(t, imperial); if (v) onChange(v); } }} />
      <span class={`small ${bad ? '' : 'faint'}`} style={bad ? 'color:var(--bad)' : ''}>{bad ? 'Minutes and seconds, like 8:30.' : 'The pace you could hold for about an hour. Leave it blank and runs are by heart rate only.'}</span>
    </div>
  );
}

const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic', 'Neuromuscular'];

/**
 * One zone table the rider can type into: the top of zones 1 to 6, zone 7 open
 * (to max heart rate, or upwards for power). A switch chooses whether the tops
 * are entered as shares of the threshold or as absolute numbers; the table
 * always shows both. "Standard" puts back the usual shares.
 */
function ZoneEditor({ title, unit, threshold, max, zones, mode, custom, onMode, onPcts, onAbs, onStandard }: {
  title: string; unit: 'W' | 'bpm'; threshold: number; max?: number; zones: Zone[]; mode: ZoneMode; custom: boolean;
  onMode: (m: ZoneMode) => void; onPcts: (v: number[]) => void; onAbs: (v: number[]) => void; onStandard: () => void;
}) {
  const pcts = ladderPcts(zones), tops = ladderTops(zones, threshold);
  const rows = tableOf(zones, threshold);
  const ok = validTops(mode === 'pct' ? pcts : tops) && (unit === 'W' || !max || tops[5] < max);
  const set = (i: number, v: number) => { const next = [...(mode === 'pct' ? pcts : tops)]; next[i] = v; (mode === 'pct' ? onPcts : onAbs)(next); };
  const absLabel = unit === 'W' ? 'Watts' : 'Beats per minute';
  return (
    <div style="margin-top:14px">
      <div class="row between wrap" style="align-items:center;gap:10px;margin-bottom:6px">
        <b class="small">{title}</b>
        <div class="seg"><button class={mode === 'pct' ? 'on' : ''} onClick={() => onMode('pct')}>% of threshold</button><button class={mode === 'abs' ? 'on' : ''} onClick={() => onMode('abs')}>{absLabel}</button></div>
      </div>
      <table class={`steps zone-ed mode-${mode}`}>
        <tr><td /><td class="faint small">Zone</td><td class="r faint small zone-pct">% of threshold</td><td class="r faint small zone-abs">{unit === 'W' ? 'Watts' : 'Heart rate'}</td><td class="r faint small">Top ({mode === 'pct' ? '%' : unit})</td></tr>
        {ZONE_NAMES.map((name, i) => {
          const r = rows[i];
          const pctText = i < 6 ? `${i === 0 ? 'up to ' : `${pcts[i - 1] + 1}–`}${pcts[i]}%` : `${pcts[5] + 1}%+`;
          const absText = i < 6 ? `${i === 0 ? 'up to ' : `${r.low}–`}${r.high}` : unit === 'bpm' && max ? `${r.low}–${max}` : `${r.low}+`;
          return (
            <tr key={i}>
              <td><span class="z" style={`background:${ZONE_VAR[i]}`} /></td>
              <td>Z{i + 1} {name}</td>
              <td class="r num muted zone-pct">{pctText}</td>
              <td class="r num zone-abs">{absText}</td>
              <td class="r">{i < 6 ? <input type="number" class="num zone-top" style="text-align:right" value={mode === 'pct' ? pcts[i] : tops[i]} onInput={(e) => set(i, Number((e.target as HTMLInputElement).value))} /> : <span class="faint small">{unit === 'bpm' ? 'max' : 'open'}</span>}</td>
            </tr>
          );
        })}
      </table>
      <div class="row wrap" style="margin-top:8px;gap:12px;align-items:center">
        {!ok && <span class="small" style="color:var(--bad)">Each top must be higher than the one before{unit === 'bpm' ? ' and below max heart rate' : ''}; until it is, the standard shares are used.</span>}
        <span class="faint small">{mode === 'pct' ? 'Shares of the threshold: change the threshold and these move with it.' : `${absLabel}: these stay where you put them when the threshold changes.`}</span>
        {custom && <button class="btn sm quiet" style="margin-left:auto" onClick={onStandard}>Back to standard shares</button>}
      </div>
    </div>
  );
}
