import { PlayerSettings } from '../PlayerSettings';
import { NumberBox } from '../NumberBox';
import { Fold } from '../Fold';
import { useHasKey } from '../thresholdService';
import { CoachFtp, CoachZones } from '../ThresholdAdvice';
import { DAY_SHORT, dayOrder, setFirstDay, fmtDate } from '../derived';
import { useEffect, useState } from 'preact/hooks';
import { formatPace, parsePace } from '../../engine/run';
import type { AppData } from '../store';
import { notify } from '../store';
import { db, getSetting, saveProfile, setSetting } from '../../data/db';
import { autoBackup, backupSummary, downloadBackup, restoreBackup } from '../../data/backup';
import { clearLock, lockStatus, setLock, syncDevices, unlockNote, type DeviceSyncState } from '../../data/devicesync';
import type { Basis, Profile } from '../../engine/types';
import { breathZones, footHrZones, footLthr as footThreshold, ladderPcts, ladderTops, rideHrZones, ridePowerZones, standardBreathPcts, tableOf, validBreathTops, validTops, type Zone, type ZoneMode } from '../../engine/zones';
import { applyAthleteNumbers, numbersToPush, pushAthleteNumbers, testConnection, type IntervalsCredentials } from '../../sync/intervals';
import { runSelfTest, type CheckResult } from '../../sync/selfTest';
import { APP_NAME, APP_SHORT_NAME } from '../../appName';
import { applyUpdate, buildTime, checkForUpdate, updateReady } from '../update';
import { ZONE_VAR } from '../Profile';
import { toast } from '../Toast';
import { PageHead } from '../PageHead';
import { getHemisphere, getSeasonChoice, getThemeChoice, setHemisphere, setSeasonChoice, setThemeChoice, type Hemisphere, type SeasonChoice, type ThemeChoice } from '../theme';
import { activeSeason, SEASON_NAME } from '../season';
import { breathHistory, type BreathHistory } from '../../engine/breathHistory';
import { applyNumbers } from '../testService';
import { historyCoverage, loadHistory } from '../../sync/syncService';
import { watchPowerCurves, type CurveProgress } from '../powerCurves';
import { coachKey, FAILURES_SETTING, KEY_SETTING, MODEL_SETTING, PROVIDER_SETTING } from '../coachConfig';
import { modelsFor, PROVIDERS, testCoach, type ModelChoice, type Provider } from '../../coach/llm';
import { addDays, today } from '../../engine/load';
import { useMaxHrSeen } from '../maxHrSeen';
import { estimateOf, isUnknown, knownFtp, knownLthr, knownMaxHr, knownWeight, markMine, settleUnsure } from '../../engine/known';
import type { UnsureNumber } from '../../engine/types';
import { distUnitsOf, legacyUnits, miles, pounds, setPackUnit, weightUnitsOf } from '../../engine/units';
import { SEND_GENERAL, UploadSteps, useDestinations } from '../Destinations';
import { destinationWords, lastUploadWords } from '../../sync/destinations';


export function Settings({ data }: { data: AppData }) {
  // Part A5: the highest heart rate seen in the last 12 months of rides, shown under the max-heart-rate box (information only).
  const maxSeen = useMaxHrSeen();
  const [p, setP] = useState<Profile>(data.profile!);
  const hasKey = useHasKey();
  // A card that saved numbers itself (Update, Apply, Use): bring those into this page's copy, so Save never puts the old ones back.
  const SAVED_BY_CARDS = ['ftp', 'ftpSetOn', 'lthr', 'lthrSetOn', 'powerZoneMode', 'powerZonePcts', 'powerZoneWatts', 'hrZoneMode', 'hrZonePcts', 'hrZoneTops', 'vt1Ve', 'vt2Ve', 'breathSetOn', 'breathZoneMode', 'breathZonePcts', 'breathZoneTops', 'updatedAt'] as const;
  const takeSaved = async () => {
    const stored = await db.profile.get('me');
    if (!stored) return;
    setP((cur) => { const next = { ...cur }; for (const k of SAVED_BY_CARDS) (next as Record<string, unknown>)[k] = stored[k]; return next; });
  };
  const [creds, setCreds] = useState<IntervalsCredentials>({ athleteId: '', apiKey: '' });
  const [claudeKey, setClaudeKey] = useState('');
  // Part F (1 Nov 2026): the coach on any of three providers, with a choice of model.
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [savedProvider, setSavedProvider] = useState<Provider>('anthropic');
  const [model, setModel] = useState('');
  const [savedModel, setSavedModel] = useState('');
  const [models, setModels] = useState<ModelChoice | null>(null);
  const [otherModel, setOtherModel] = useState(false);
  const [coachTesting, setCoachTesting] = useState(false);
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  const [modelFailures, setModelFailures] = useState(0);
  const [coachAuto, setCoachAuto] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSyncState | null>(null);
  const setMsg = toast;
  const [busy, setBusy] = useState(false);
  // One zone table at a time: Power, Heart rate (bike and foot) or Breathing. The other tabs stay mounted, so nothing typed is lost by switching.
  const [zoneTab, setZoneTab] = useState<'power' | 'hr' | 'breath'>('power');
  const pane = (t: typeof zoneTab) => `margin-top:12px${zoneTab === t ? '' : ';display:none'}`;

  useEffect(() => {
    getSetting<IntervalsCredentials | null>('intervals', null).then((c) => c && setCreds(c));
    void coachKey().then((k) => { setClaudeKey(k); setSavedKey(k); });
    getSetting<Provider>(PROVIDER_SETTING, 'anthropic').then((v) => { setProvider(v); setSavedProvider(v); });
    getSetting<string>(MODEL_SETTING, '').then((v) => { setModel(v); setSavedModel(v); });
    getSetting<number>(FAILURES_SETTING, 0).then(setModelFailures);
    getSetting<boolean>('coachAuto', false).then((v) => { setCoachAuto(v); setSavedAuto(v); });
    getSetting<string | null>('lastBackup', null).then(setLastBackup);
    getSetting<DeviceSyncState | null>('deviceSync', null).then(setDevices);
  }, []);

  // The provider's own list of models, read when there is a key (the known names otherwise).
  useEffect(() => {
    let alive = true;
    setModels(null); setTested(null);
    const k = claudeKey.trim();
    if (k.length < 20) return;   // not while the key is still being typed or pasted in parts
    const t = setTimeout(() => { void modelsFor({ provider, key: k }).then((m) => { if (alive) { setModels(m); if (model && model !== 'faster' && !m.all.includes(model)) setOtherModel(true); } }); }, 400);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, claudeKey]);
  async function test() {
    setCoachTesting(true); setTested(null);
    setTested(await testCoach({ provider, key: claudeKey.trim(), model: model.trim() }));
    setCoachTesting(false);
  }
  const upd = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const [savedKey, setSavedKey] = useState('');
  const [savedAuto, setSavedAuto] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(data.profile) || claudeKey !== savedKey || coachAuto !== savedAuto || provider !== savedProvider || model !== savedModel;
  function discard() {
    if (!confirm('Discard the changes on this page?')) return;
    setP(data.profile!); setClaudeKey(savedKey); setCoachAuto(savedAuto); setProvider(savedProvider); setModel(savedModel); setMsg(null);
  }
  // Sense checks for the single-number boxes (12 Nov): wide human ranges, never one rider's numbers.
  const within = (lo: number, hi: number, what: string) => (v: number) => v < lo || v > hi ? `${what} is usually between ${lo} and ${hi}.` : undefined;
  const firstOf = (...cs: Array<(v: number) => string | undefined>) => (v: number) => { for (const c of cs) { const m = c(v); if (m) return m; } return undefined; };
  const thisYear = new Date().getFullYear();
  const num = (k: keyof Profile) => (v: number | undefined) => { if (v != null) upd(k, v as never); };

  async function save() {
    setFirstDay(p.weekStartsOn === 0 ? 0 : 1);
    setPackUnit(weightUnitsOf(p));
    await saveProfile(p);
    // The database stamps the profile on every write; take the stored copy so the page reads as saved.
    const stored = await db.profile.get('me');
    if (stored) setP(stored);
    await setSetting(KEY_SETTING, claudeKey.trim());
    await setSetting(PROVIDER_SETTING, provider);
    await setSetting(MODEL_SETTING, model.trim());
    await setSetting('coachAuto', coachAuto && !!claudeKey.trim());
    if (provider !== savedProvider || model.trim() !== savedModel) await setSetting(FAILURES_SETTING, 0);
    // The day's note is rewritten only when something the coach reads changed.
    if (coachFieldsChanged(data.profile!, p) || claudeKey.trim() !== savedKey) await setSetting('coachNote', null);
    setSavedKey(claudeKey.trim()); setSavedAuto(coachAuto && !!claudeKey.trim()); setSavedProvider(provider); setSavedModel(model.trim());
    notify();
    const before = data.profile!;
    // A number typed in place of an unknown or estimated one is the rider's own from now (13 Nov 2026).
    const mineNow = settleUnsure(before, p).profile;
    const numbers = (x: Profile) => JSON.stringify(numbersToPush(x));
    const changed = numbers(mineNow) !== numbers(before);
    const c = await getSetting<IntervalsCredentials | null>('intervals', null);
    if (changed && c?.apiKey) {
      try {
        const sent = numbersToPush(mineNow);
        await pushAthleteNumbers(c, sent);
        const parts = [sent.ftp && `FTP ${sent.ftp} W`, sent.lthr && `threshold heart rate ${sent.lthr} bpm on the bike`, sent.footLthr && `${sent.footLthr} on foot`, sent.maxHr && `max ${sent.maxHr}`].filter(Boolean);
        setMsg({ ok: true, text: `Saved, and sent to Intervals.icu: ${parts.length ? `${parts.join(', ')}, and the zone tables` : 'the zone tables'}. Workouts sent to your devices and Intervals.icu now use these numbers.${mineNow.unsure ? ' Numbers not known yet, and estimates, stay here until a test or you set them.' : ''}` })
      } catch (e) {
        setMsg({ ok: false, text: `Saved here, but Intervals.icu was not updated: ${(e as Error).message} Until it is, workouts sent to your devices use the numbers Intervals.icu has.` });
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
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      // Restoring replaces this device's own data, so it asks first and says what (12 Nov 2026).
      const sum = backupSummary(text);
      if (!sum.ok) { setMsg({ ok: false, text: sum.words }); input.value = ''; return; }
      const made = sum.exportedAt ? ` made ${new Date(sum.exportedAt).toLocaleString()}` : '';
      if (!confirm(`Restore from this backup${made}?\n\nIt holds ${sum.words}.\n\nYour profile, settings, calendar, workouts, plans and day notes on this device are replaced with the backup's. Activities and wellness come back from your account on the next sync. Ride recordings already on this device are kept. Your other devices follow at their next merge.`)) { input.value = ''; return; }
      const r = await restoreBackup(text);
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
        <h2>You</h2>
        <div class="form">
          <div class="field"><label>Name</label><input value={p.name} onInput={(e) => upd('name', (e.target as HTMLInputElement).value)} /></div>
          <div class="field"><label>Resting heart rate</label><NumberBox value={p.restingHr} onValue={num('restingHr')} check={firstOf(within(25, 120, 'Resting heart rate'), (v) => knownLthr(p) && v >= p.lthr ? `It must be below your threshold heart rate (${p.lthr}).` : undefined)} /></div>
          <div class="field"><label>Weight ({pounds(p) ? 'lb' : 'kg'})</label>
            <NumberBox value={knownWeight(p) == null ? undefined : pounds(p) ? Math.round(p.weightKg * 2.2046) : Math.round(p.weightKg)} placeholder={knownWeight(p) == null ? 'not known yet' : undefined} onValue={(v) => { if (v) setP(markMine({ ...p, weightKg: pounds(p) ? v / 2.2046 : v }, ['weightKg'])); }} check={pounds(p) ? within(66, 550, 'Weight in pounds') : within(30, 250, 'Weight in kilograms')} />
            <Unsure p={p} k="weightKg" unknown="Not known yet: watts per kilogram are not shown until you add it." /></div>
          <div class="field"><label>Hours per week</label><NumberBox decimals value={p.hoursPerWeek} onValue={num('hoursPerWeek')} check={within(0.5, 40, 'Hours per week')} /></div>
          <div class="field"><label>Birth year</label><NumberBox value={p.birthYear} onValue={(v) => upd('birthYear', v || undefined)} check={within(1920, thisYear - 10, 'Birth year')} /></div>
        </div>
        <div class="row wrap" style="margin-top:14px;gap:18px">
          <div class="field"><label>Targets sent to your devices</label>
            <div class="seg"><button class={p.basis === 'power' ? 'on' : ''} onClick={() => upd('basis', 'power' as Basis)}>Power</button><button class={p.basis === 'hr' ? 'on' : ''} onClick={() => upd('basis', 'hr' as Basis)}>Heart rate</button></div></div>
          {/* Step 5 (11 Nov 2026): Breathing as the player's starting choice, offered only with breathing zones; the Garmin keeps power or heart rate. */}
          {breathZones(p) && <div class="field"><label>In the ride player, start on</label>
            <div class="seg"><button class={!p.preferBreath ? 'on' : ''} onClick={() => upd('preferBreath', undefined)}>{p.basis === 'hr' ? 'Heart rate' : 'Power'}</button><button class={p.preferBreath ? 'on' : ''} onClick={() => upd('preferBreath', true)}>Breathing</button></div>
            {p.preferBreath && <span class="faint small">When a breathing strap is connected and the ride works by breathing; otherwise {p.basis === 'hr' ? 'heart rate' : 'power'}.</span>}</div>}
          <div class="field"><label>Distance</label>
            <div class="seg"><button class={miles(p) ? 'on' : ''} aria-pressed={miles(p)} onClick={() => setP({ ...p, distUnits: 'mi', weightUnits: weightUnitsOf(p), units: legacyUnits('mi', weightUnitsOf(p)) })}>Miles</button><button class={!miles(p) ? 'on' : ''} aria-pressed={!miles(p)} onClick={() => setP({ ...p, distUnits: 'km', weightUnits: weightUnitsOf(p), units: legacyUnits('km', weightUnitsOf(p)) })}>Kilometres</button></div></div>
          <div class="field"><label>Weight</label>
            <div class="seg"><button class={pounds(p) ? 'on' : ''} aria-pressed={pounds(p)} onClick={() => setP({ ...p, weightUnits: 'lb', distUnits: distUnitsOf(p), units: legacyUnits(distUnitsOf(p), 'lb') })}>Pounds</button><button class={!pounds(p) ? 'on' : ''} aria-pressed={!pounds(p)} onClick={() => setP({ ...p, weightUnits: 'kg', distUnits: distUnitsOf(p), units: legacyUnits(distUnitsOf(p), 'kg') })}>Kilograms</button></div></div>
          <div class="field"><label>Week starts on</label>
            <div class="seg"><button class={(p.weekStartsOn ?? 1) === 1 ? 'on' : ''} onClick={() => upd('weekStartsOn', 1)}>Monday</button><button class={p.weekStartsOn === 0 ? 'on' : ''} onClick={() => upd('weekStartsOn', 0)}>Sunday</button></div></div>
          <div class="field"><label>Masters recovery (40 and over)</label>
            <div class="seg"><button class={p.masters ? 'on' : ''} onClick={() => upd('masters', true)}>On</button><button class={!p.masters ? 'on' : ''} onClick={() => upd('masters', false)}>Off</button></div></div>
        </div>
        <div class="field" style="margin-top:14px"><label>Days you can ride</label>
          <div class="chips">{dayOrder().map((i) => <button key={i} class={`chip${p.rideDays.includes(i) ? ' on' : ''}`} onClick={() => upd('rideDays', p.rideDays.includes(i) ? p.rideDays.filter((x) => x !== i) : [...p.rideDays, i].sort())}>{DAY_SHORT[i]}</button>)}</div></div>
      </section>

      <section class="section">
        <h2>Thresholds and zones</h2>
        <p class="muted small" style="margin-bottom:12px">Your numbers live here. Save sends them to Intervals.icu, which uses them for every workout it passes to your devices and for how it files your recordings. Set the same zones on your bike computer or watch once (it keeps its own copy), and all three agree. Each table can be entered as shares of its threshold, which move when the threshold changes, or as watts or beats per minute, which stay where you put them.</p>

        <div class="seg" role="tablist" aria-label="Zone tables">
          <button role="tab" aria-selected={zoneTab === 'power'} class={zoneTab === 'power' ? 'on' : ''} onClick={() => setZoneTab('power')}>Power</button>
          <button role="tab" aria-selected={zoneTab === 'hr'} class={zoneTab === 'hr' ? 'on' : ''} onClick={() => setZoneTab('hr')}>Heart rate</button>
          <button role="tab" aria-selected={zoneTab === 'breath'} class={zoneTab === 'breath' ? 'on' : ''} onClick={() => setZoneTab('breath')}>Breathing</button>
        </div>

        <div class="panel" style={pane('power')} role="tabpanel">
          <div class="form">
            <div class="field"><label>FTP (watts)</label><NumberBox value={knownFtp(p)} placeholder={knownFtp(p) == null ? 'not known yet' : undefined} onValue={(v) => { if (v) setP(markMine({ ...p, ftp: v }, ['ftp'])); }} check={within(50, 600, 'FTP')} />
              <Unsure p={p} k="ftp" unknown="Not known yet: a power test sets it (the Ramp Test on a smart trainer, or the 20-minute FTP test). Until then rides have no watts." /></div>
          </div>
          {hasKey && <CoachFtp profile={data.profile!} data={data} onChanged={() => void takeSaved()} />}
          {knownFtp(p) != null && <ZoneEditor title="Power zones" unit="W" threshold={p.ftp} zones={ridePowerZones(p)} mode={p.powerZoneMode ?? 'pct'} custom={!!(p.powerZonePcts || p.powerZoneWatts)}
            onMode={(m) => setP({ ...p, powerZoneMode: m, powerZonePcts: ladderPcts(ridePowerZones(p)), powerZoneWatts: ladderTops(ridePowerZones(p), p.ftp) })}
            onPcts={(v) => setP({ ...p, powerZoneMode: 'pct', powerZonePcts: v })} onAbs={(v) => setP({ ...p, powerZoneMode: 'abs', powerZoneWatts: v })}
            onStandard={() => setP({ ...p, powerZoneMode: undefined, powerZonePcts: undefined, powerZoneWatts: undefined })} />}
        </div>

        <div class="panel" style={pane('hr')} role="tabpanel">
          <div class="form">
            <div class="field"><label>Threshold heart rate (bpm)</label><NumberBox value={knownLthr(p)} placeholder={knownLthr(p) == null ? 'not known yet' : undefined} onValue={(v) => { if (v) setP(markMine({ ...p, lthr: v }, ['lthr'])); }} check={firstOf(within(80, 220, 'Threshold heart rate'), (v) => knownMaxHr(p) && v >= p.maxHr ? `It must be below your max heart rate (${p.maxHr}).` : undefined, (v) => p.restingHr && v <= p.restingHr ? `It must be above your resting heart rate (${p.restingHr}).` : undefined)} />
              <Unsure p={p} k="lthr" unknown="Not known yet: the threshold heart-rate test sets it, or the Ramp Test ridden with a heart-rate strap. Until then rides have no beats per minute." /></div>
            <div class="field"><label>Max heart rate</label><NumberBox value={knownMaxHr(p)} placeholder={knownMaxHr(p) == null ? 'not known yet' : undefined} onValue={(v) => { if (v) setP(markMine({ ...p, maxHr: v }, ['maxHr'])); }} check={firstOf(within(100, 230, 'Max heart rate'), (v) => knownLthr(p) && v <= p.lthr ? `It must be above your threshold heart rate (${p.lthr}).` : undefined, (v) => p.footLthr && v <= p.footLthr ? `It must be above your threshold heart rate on foot (${p.footLthr}).` : undefined)} />
              <Unsure p={p} k="maxHr" unknown="Not known yet: it is set the first time a recording shows it." />
              {maxSeen && <div class="faint small" style="margin-top:4px">Highest seen in your rides: {maxSeen.bpm} bpm ({fmtDate(maxSeen.date, { month: 'short', day: 'numeric', year: 'numeric' })})</div>}
            </div>
          </div>
          {knownLthr(p) != null && <ZoneEditor title="Heart-rate zones on the bike" unit="bpm" threshold={p.lthr} max={p.maxHr} zones={rideHrZones(p)} mode={p.hrZoneMode ?? (p.hrZoneTops ? 'abs' : 'pct')} custom={!!(p.hrZonePcts || p.hrZoneTops)}
            onMode={(m) => setP({ ...p, hrZoneMode: m, hrZonePcts: ladderPcts(rideHrZones(p)), hrZoneTops: ladderTops(rideHrZones(p), p.lthr) })}
            onPcts={(v) => setP({ ...p, hrZoneMode: 'pct', hrZonePcts: v })} onAbs={(v) => setP({ ...p, hrZoneMode: 'abs', hrZoneTops: v })}
            onStandard={() => setP({ ...p, hrZoneMode: undefined, hrZonePcts: undefined, hrZoneTops: undefined })} />}
          <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
            <b class="small">On foot</b>
            <p class="muted small" style="margin:4px 0 10px">Runs and walks have their own numbers: threshold heart rate on foot is usually a few beats above the bike's.</p>
            <div class="form">
              <div class="field"><label>Threshold heart rate (bpm)</label><NumberBox value={!p.footLthr && isUnknown(p, 'lthr') ? undefined : footThreshold(p)} placeholder={!p.footLthr && isUnknown(p, 'lthr') ? 'not known yet' : undefined} onValue={(v) => upd('footLthr', v || undefined)} check={firstOf(within(80, 220, 'Threshold heart rate on foot'), (v) => p.maxHr && v >= p.maxHr ? `It must be below your max heart rate (${p.maxHr}).` : undefined)} />
                {!p.footLthr && <span class="faint small">{isUnknown(p, 'lthr') ? 'Not known yet, nor the bike\'s: walks and runs show zones until one is set.' : 'Not set yet: the bike\'s number is used. Most people run 3 to 6 beats higher.'}</span>}</div>
              <PaceField key={distUnitsOf(p)} value={p.thresholdPaceSec} imperial={miles(p)} onChange={(v) => upd('thresholdPaceSec', v)} />
            </div>
            {!(isUnknown(p, 'lthr') && !p.footLthr) && <ZoneEditor title="Heart-rate zones on foot" unit="bpm" threshold={footThreshold(p)} max={p.maxHr} zones={footHrZones(p)} mode={p.footHrZoneMode ?? (p.footHrZoneTops ? 'abs' : 'pct')} custom={!!(p.footHrZonePcts || p.footHrZoneTops)}
              onMode={(m) => setP({ ...p, footHrZoneMode: m, footHrZonePcts: ladderPcts(footHrZones(p)), footHrZoneTops: ladderTops(footHrZones(p), footThreshold(p)) })}
              onPcts={(v) => setP({ ...p, footHrZoneMode: 'pct', footHrZonePcts: v })} onAbs={(v) => setP({ ...p, footHrZoneMode: 'abs', footHrZoneTops: v })}
              onStandard={() => setP({ ...p, footHrZoneMode: undefined, footHrZonePcts: undefined, footHrZoneTops: undefined })} />}
          </div>
        </div>

        <div class="panel" style={pane('breath')} role="tabpanel">
          <p class="muted small" style="margin:0 0 10px">Your two breathing thresholds, in litres of air a minute, from a breathing strap. A Ramp Test ridden with the strap sets the second; your easy and steady rides with the strap find the first; you can also type them in. They stand in for your lactate thresholds: the first (VT1) is the top of all-day endurance riding, the second (VT2) the most you can sustain for long. Kept on your devices; Intervals.icu has no breathing zones.</p>
          <div class="form">
            <div class="field"><label>First threshold, VT1 (L/min)</label><NumberBox decimals value={p.vt1Ve} onValue={(v) => setP({ ...p, vt1Ve: v || undefined, breathSetOn: today() })} check={firstOf(within(5, 250, 'The first threshold'), (v) => p.vt2Ve && v >= p.vt2Ve ? `It must be below your second threshold (${p.vt2Ve} L/min).` : undefined)} /></div>
            <div class="field"><label>Second threshold, VT2 (L/min)</label><NumberBox decimals value={p.vt2Ve} onValue={(v) => setP({ ...p, vt2Ve: v || undefined, breathSetOn: today() })} check={firstOf(within(10, 300, 'The second threshold'), (v) => p.vt1Ve && v <= p.vt1Ve ? `It must be above your first threshold (${p.vt1Ve} L/min).` : undefined)} />
              {p.breathSetOn && <span class="faint small">Set {fmtDate(p.breathSetOn, { month: 'long', day: 'numeric' })}.</span>}</div>
          </div>
          <BreathFromRides p={p} setP={setP} data={data} />
          {p.vt2Ve ? <BreathEditor p={p} setP={setP} /> : <p class="faint small" style="margin:8px 0 0">The breathing zone table appears once the second threshold is set.</p>}
        </div>

        {hasKey && <CoachZones profile={data.profile!} data={data} onChanged={() => void takeSaved()} onEditFirst={(pt, ht) => {
          setP({ ...p, ...(pt ? { powerZoneMode: 'abs' as const, powerZoneWatts: pt } : {}), ...(ht ? { hrZoneMode: 'abs' as const, hrZoneTops: ht } : {}) });
          setZoneTab(pt ? 'power' : 'hr');
          toast({ ok: true, text: 'The suggested zones are in the Power and Heart rate tabs above. Change any number, then press Save.' });
        }} />}
      </section>

      <section class="section">
        <h2>Coach (optional)</h2>
        <p class="muted small" style="margin-bottom:12px">With an API key from Anthropic (Claude), OpenAI (ChatGPT) or Google (Gemini), Today gets a coach who has read your numbers: its view of the day and answers to your questions. The key is stored only on this device and calls go straight from the app to the provider; every device shows the coach's latest view, and a device needs its own key only to ask. Leave blank to skip.</p>
        <div class="field"><label>Provider</label>
          <select value={provider} onChange={(e) => { setProvider((e.target as HTMLSelectElement).value as Provider); setModel(''); setOtherModel(false); }}>
            {PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <span class="faint small">Get a key at {PROVIDERS.find((x) => x.id === provider)!.where}.</span>
        </div>
        <div class="field" style="margin-top:12px"><label>API key</label><input type="password" autocomplete="off" value={claudeKey} onInput={(e) => setClaudeKey((e.target as HTMLInputElement).value)} placeholder={PROVIDERS.find((x) => x.id === provider)!.keyHint} /></div>
        <div class="field" style="margin-top:12px"><label>Model</label>
          <select value={otherModel ? '__other' : model} disabled={!claudeKey.trim()} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v === '__other') { setOtherModel(true); setModel(''); } else { setOtherModel(false); setModel(v); } }}>
            <option value="">Most capable (recommended){models ? `: ${models.best}` : ''}</option>
            <option value="faster">Faster{models ? `: ${models.faster}` : ''}</option>
            {models && models.all.filter((m) => m !== models.best && m !== models.faster).length > 0 && (
              <optgroup label="More">{models.all.filter((m) => m !== models.best && m !== models.faster).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
            )}
            <option value="__other">Other model…</option>
          </select>
          {otherModel && <input style="margin-top:6px" value={model} placeholder="The model's name, as the provider writes it" onInput={(e) => setModel((e.target as HTMLInputElement).value)} />}
          <span class="faint small">One model serves everything the coach does. The most capable model judges best and costs a few cents a day; it follows the provider's newest as they release them. Faster is cheaper and quicker, and may keep less well to the form the app needs.</span>
          {modelFailures >= 2 && model !== '' && <span class="small" style="color:var(--warn)">This model has twice not answered in the form the app needs. Most capable (recommended) is the safer choice.</span>}
        </div>
        <div class="row wrap" style="gap:8px;margin-top:12px;align-items:center">
          <button class="btn sm" disabled={!claudeKey.trim() || coachTesting} onClick={() => void test()}>{coachTesting ? 'Testing…' : 'Test'}</button>
          {tested && <span class="small" style={`color:${tested.ok ? 'var(--good)' : 'var(--bad)'}`}>{tested.text}</span>}
        </div>
        <div class="field" style="margin-top:12px"><label>The coach judges your plan</label>
          <div class="seg"><button class={coachAuto ? 'on' : ''} onClick={() => setCoachAuto(true)} disabled={!claudeKey.trim()}>On</button><button class={!coachAuto ? 'on' : ''} onClick={() => setCoachAuto(false)}>Off</button></div>
          <p class="faint small" style="margin-top:6px">On: each morning, and whenever a new activity arrives or the calendar or your notes change, the coach looks at how you have been riding, your overnight numbers, your notes and your plan, and recommends changes only when the evidence calls for them, saying why beside each. Off: the app's own check of the day recommends changes instead, with its reasons. Either way, nothing changes on the plan until you accept it.</p></div>
      </section>

      <Fold title="Intervals.icu" summary={creds.apiKey && creds.athleteId ? (p.name ? `Connected as ${p.name}` : 'Connected') : 'Not connected yet'} later={creds.apiKey && creds.athleteId ? <WhereWorkoutsGo /> : undefined}>
        <p class="muted small" style="margin-bottom:12px">The link to your devices: workouts go out through it and recordings come back. Find both values on intervals.icu under Settings, in the Developer section near the bottom. Stored only on this device. FTP, threshold heart rates, max heart rate and the zone tables are kept in step both ways: change them here and Save sends them to Intervals.icu; change them there and the next sync brings them here.</p>
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
      </Fold>


      <Fold title="Across your devices, and backup" summary={devices?.error && (!devices.last || devices.error > devices.last) ? <span style="color:var(--bad)">The last sync failed</span> : devices?.locked && !devices?.last ? <span style="color:var(--warn)">The note is encrypted and not unlocked here</span> : devices?.last ? `Last merged ${new Date(devices.last).toLocaleString()}` : 'Not merged with the note yet'}>
        <p class="muted small" style="margin-bottom:12px">Your plans, calendar, workouts, day notes and settings are kept in step between every device signed in to the same Intervals.icu account, through a private note in that account dated far in the future. Your API keys never go into the note; each device keeps its own. Each device merges with the note when the app opens, comes back to the front, syncs, and a few seconds after any change; the newest change to each record wins, and deletions carry across. A new device picks everything up from the note on its first merge. Activities come back from Intervals.icu on their own.</p>
        <p class="small" style="margin-bottom:12px">{devices?.last ? <>Last merged {new Date(devices.last).toLocaleString()}{devices.device ? ` · the note was last written by ${devices.device}` : ''}.</> : 'Not merged with the note yet.'}{devices?.error && (!devices.last || devices.error > devices.last) ? <span style="color:var(--bad)"> Last attempt failed: {devices.error.replace(/^\S+ /, '')}</span> : null}{devices?.locked ? <span style="color:var(--warn)"> The note is encrypted and this device has not unlocked it yet; see below.</span> : null}</p>
        <div class="row wrap">
          <button class="btn" onClick={backupNow} disabled={busy}>Sync now</button>
        </div>
        <NoteLock devices={devices} onChange={() => getSetting<DeviceSyncState | null>('deviceSync', null).then(setDevices)} busy={busy} setBusy={setBusy} setMsg={setMsg} />
        <p class="muted small" style="margin:16px 0 8px">A file copy of everything as well, for moving {APP_SHORT_NAME} to another device or keeping it safe: plans, calendar, workouts, settings, favourites, what the app has learned about you (such as the watts that hold each heart-rate zone), notes and efforts, and ride recordings still on this device. Unlike the note, the file includes your API keys, so keep it where you keep passwords. {lastBackup ? `Last file backup ${new Date(lastBackup).toLocaleDateString()}.` : ''}</p>
        <div class="row wrap">
          <button class="btn" onClick={() => downloadBackup().then(() => getSetting<string | null>('lastBackup', null).then(setLastBackup))}>Back up everything</button>
          <label class="btn" style="position:relative;overflow:hidden">Restore from a backup<input type="file" accept="application/json,.json" style="position:absolute;inset:0;opacity:0;cursor:pointer" onChange={restore} /></label>
        </div>
        <p class="faint small" style="margin:8px 0 0">To take rides and workouts to other apps instead, use <a href="#/export">Export</a>.</p>
      </Fold>

      <Fold title="Export to other apps" summary="Activities and workouts as files">
        <p class="muted small" style="margin-bottom:12px">Download finished activities and workouts to ride, many at once, as files other apps import: .fit, .zwo and others. One at a time, use Download on any ride's or activity's page.</p>
        <a class="btn" href="#/export">Open Export</a>
      </Fold>

      <HistoryLoader />

      <PlayerSettings />

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

/**
 * Light, dark, or whatever the device is set to; and the season's colours. Both apply at once; no Save needed.
 * The hemisphere is preset from the device's time zone and shown only when the season follows the date.
 */
function Appearance() {
  const [t, setT] = useState<ThemeChoice>(getThemeChoice());
  const [s, setS] = useState<SeasonChoice>(getSeasonChoice());
  const [h, setH] = useState<Hemisphere>(getHemisphere());
  const pick = (c: ThemeChoice) => { setT(c); setThemeChoice(c); };
  const pickSeason = (c: SeasonChoice) => { setS(c); setSeasonChoice(c); };
  const pickHemisphere = (c: Hemisphere) => { setH(c); setHemisphere(c); };
  const now = SEASON_NAME[activeSeason(s, h)];
  return (
    <section class="section" style="margin-top:0">
      <h2>Appearance</h2>
      <div class="panel stack" style="gap:14px">
        <div class="row between wrap" style="gap:12px">
          <p class="muted small" style="max-width:46ch">Dark, light, or follow the setting on this device. Takes effect at once.</p>
          <div class="seg theme" role="radiogroup" aria-label="Theme">
            {([['system', 'System'], ['dark', 'Dark'], ['light', 'Light']] as Array<[ThemeChoice, string]>).map(([c, l]) => (
              <button key={c} role="radio" aria-checked={t === c} class={t === c ? 'on' : ''} onClick={() => pick(c)}>{l}</button>
            ))}
          </div>
        </div>
        <div class="row between wrap" style="gap:12px">
          <p class="muted small" style="max-width:46ch">Season colours. The app's colours change with the seasons{s === 'auto' ? `; it is ${now.toLowerCase()} now` : ''}. Choose one season to keep it all year.</p>
          <div class="seg theme wrap" role="radiogroup" aria-label="Season colours">
            {([['auto', 'Automatic'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']] as Array<[SeasonChoice, string]>).map(([c, l]) => (
              <button key={c} role="radio" aria-checked={s === c} class={s === c ? 'on' : ''} onClick={() => pickSeason(c)}>{l}</button>
            ))}
          </div>
        </div>
        {s === 'auto' && (
          <div class="row between wrap" style="gap:12px">
            <p class="muted small" style="max-width:46ch">Hemisphere, for the seasons. Set from this device's time zone; change it if it is wrong.</p>
            <div class="seg theme" role="radiogroup" aria-label="Hemisphere">
              {([['north', 'Northern'], ['south', 'Southern']] as Array<[Hemisphere, string]>).map(([c, l]) => (
                <button key={c} role="radio" aria-checked={h === c} class={h === c ? 'on' : ''} onClick={() => pickHemisphere(c)}>{l}</button>
              ))}
            </div>
          </div>
        )}
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
      toast({ ok: true, text: r.activities || r.wellness ? `Loaded ${r.activities} more activities and ${r.wellness} more days of wellness.` : 'Nothing new: this device already has everything Intervals.icu holds for that span. If a history import from your device’s maker is still running there, try again once it has finished.' });
    } catch (e) {
      toast({ ok: false, text: `Stopped part-way: ${(e as Error).message} What arrived is kept; try again to continue.` });
    } finally { setProg(null); refresh(); }
  }
  const busy = prog != null;
  // Step 2b (30 Oct 2026): the one-time re-read of rides that keeps heart rate alongside power.
  const [reread, setReread] = useState<CurveProgress | null>(null);
  useEffect(() => watchPowerCurves((p) => setReread(p.rebuilding && p.total > 0 && p.done < p.total && !p.error ? p : null)), []);
  const summary = busy ? `Loading… ${prog!.done} of ${prog!.total}`
    : cov?.from ? `${cov.activities} activities, back to ${fmtDate(cov.from, { month: 'short', year: 'numeric' })}` : 'Nothing synced yet';
  return (
    <Fold title="History" summary={summary}>
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
        {reread && <div style="margin-top:12px"><div class="ws-track"><div class="ws-fill" style={`width:${(reread.done / reread.total) * 100}%`} /></div><p class="faint small">Updating your ride history: {reread.done} of {reread.total}</p></div>}
        <p class="faint small" style="margin-top:10px">Fitness and the charts count up to two years back. The power curve reads each newly loaded ride in the background the next time you open Progress.</p>
        <p class="faint small" style="margin-top:6px">This can only bring what Intervals.icu holds. If your device is a Garmin: Intervals.icu's Garmin link fetches at most a year of history from before you connected it; for older years, use <b>Import all Garmin Data</b> in Intervals.icu's Garmin settings, then load here again. Activities that reached Intervals.icu only from Strava are not shared with other apps.</p>
      </div>
    </Fold>
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
export const COACH_FIELDS = ['name', 'birthYear', 'masters', 'units', 'distUnits', 'weightUnits', 'ftp', 'lthr', 'footLthr', 'hoursPerWeek', 'basis'] as const;
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
              <td class="r">{i < 6 ? <NumberBox class="num zone-top" style="text-align:right" value={mode === 'pct' ? pcts[i] : tops[i]} onValue={(v) => { if (v != null) set(i, v); }} /> : <span class="faint small">{unit === 'bpm' ? 'max' : 'open'}</span>}</td>
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


/**
 * Step 2c, Part C (7 Nov 2026): Antogo's read of the rider's rides with the strap, under the breathing thresholds:
 * a first threshold with Use it (and the power and heart-rate zone 2 tops it implies, each offered on its own), or
 * the plain sentence saying what more riding would be enough. Worked out from the stored bands when the page opens.
 * Nothing changes until the rider presses a button, and then only in the form, saved with Save.
 */
function BreathFromRides({ p, setP, data }: { p: Profile; setP: (p: Profile) => void; data: AppData }) {
  const [h, setH] = useState<BreathHistory | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // A recording left out of training load (the Garmin's twin of a player ride, until the rider chooses) is not a ride of its own.
  const excluded = new Set(data.edits.filter((e) => e.excluded).map((e) => e.id));
  useEffect(() => { void db.powerCurves.toArray().then((rs) => setH(breathHistory(rs.filter((r) => !excluded.has(r.id)), p.ftp, today()))); }, [p.ftp, data.edits.length]);
  if (!h || !(p.ftp > 0)) return null;
  const v = h.vt1;
  // Review fix (7 Nov): the first threshold must sit below the second.
  const fitsBelowVt2 = !!v && (!p.vt2Ve || v.ve < p.vt2Ve);
  const pz = ridePowerZones(p), hz = rideHrZones(p);
  const pTops = ladderTops(pz, p.ftp), hTops = ladderTops(hz, p.lthr);
  const withZ2 = (tops: number[], at: number) => { const t = [...tops]; t[1] = Math.round(at); return validTops(t) ? t : undefined; };
  const nextP = v ? withZ2(pTops, v.watts) : undefined;
  const nextH = v?.hr ? withZ2(hTops, v.hr) : undefined;
  // Zone 2's new top in the rider's own mode: as a share of the threshold when the zones are shares, in watts or beats when fixed.
  const z2Patch = (kind: 'power' | 'hr', tops: number[]): Partial<Profile> => {
    const anchor = kind === 'power' ? p.ftp : p.lthr;
    const mode = kind === 'power' ? (p.powerZoneMode ?? 'pct') : (p.hrZoneMode ?? 'pct');
    if (mode === 'pct') {
      const pcts = ladderPcts(kind === 'power' ? pz : hz);
      pcts[1] = Math.round((tops[1] / anchor) * 100);
      return kind === 'power' ? { powerZoneMode: 'pct', powerZonePcts: pcts } : { hrZoneMode: 'pct', hrZonePcts: pcts };
    }
    return kind === 'power' ? { powerZoneMode: 'abs', powerZoneWatts: tops } : { hrZoneMode: 'abs', hrZoneTops: tops };
  };
  // Saved at once, as Use on the test screen is; the form follows.
  const apply = async (patch: Partial<Profile>, what: string) => {
    setBusy(true);
    const res = await applyNumbers(patch, what);
    toast(res);
    if (res.ok) setP({ ...p, ...patch });
    setBusy(false);
  };
  return (
    <div class="breath-rides" style="margin-top:12px">
      {v ? <>
        <p class="small" style="margin:0">From your rides with the strap (last 12 weeks, {h.rides} ride{h.rides === 1 ? '' : 's'}, {h.minutes} minutes): first threshold about <b class="num">{v.watts} W</b>{v.hr ? <>, <b class="num">{v.hr} bpm</b></> : null}, <b class="num">{Math.round(v.ve * 10) / 10} L/min</b>{v.certainty === 'unsure' ? <> <span class="pill">less certain</span></> : null}.</p>
        <div class="row wrap" style="gap:8px;margin-top:8px">
          {fitsBelowVt2 && Math.abs((p.vt1Ve ?? 0) - v.ve) >= 0.1 && <button class="btn sm" disabled={busy} onClick={() => void apply({ vt1Ve: Math.round(v.ve * 10) / 10, breathSetOn: today() }, 'your first breathing threshold')}>Use it</button>}
          {nextP && Math.round(pTops[1]) !== Math.round(v.watts) && <button class="btn sm quiet" disabled={busy} onClick={() => void apply(z2Patch('power', nextP), `power zone 2 ending at ${Math.round(v.watts)} W`)}>End power zone 2 at {Math.round(v.watts)} W</button>}
          {nextH && Math.round(hTops[1]) !== v.hr && <button class="btn sm quiet" disabled={busy} onClick={() => void apply(z2Patch('hr', nextH), `heart-rate zone 2 ending at ${v.hr} bpm`)}>End heart-rate zone 2 at {v.hr} bpm</button>}
        </div>
        {!fitsBelowVt2 && <p class="faint small" style="margin:6px 0 0">That is at or above your second threshold, so it isn't offered; a later ramp test, whenever it suits you, would settle which is right.</p>}
      </> : <p class="faint small" style="margin:0">{h.notYet}</p>}
      {h.vt2Check != null && <p class="faint small" style="margin:6px 0 0">Your rides with the strap put the second threshold at about {h.vt2Check} W.</p>}
    </div>
  );
}

/**
 * The breathing zone table (Step 4, 3 Nov 2026): the tops of zones 1 to 4,
 * zone 5 open, entered as shares of the second threshold or in litres a
 * minute; the table always shows both. "Standard" puts back the shares the
 * two thresholds give (zone 2 ends at VT1, zone 3 at VT2).
 */
function BreathEditor({ p, setP }: { p: Profile; setP: (p: Profile) => void }) {
  const zones = breathZones(p)!;
  const vt2 = p.vt2Ve!;
  const mode: ZoneMode = p.breathZoneMode ?? 'pct';
  const tops = zones.slice(0, 4).map((z) => z.high);
  const pcts = tops.map((t) => Math.round((t / vt2) * 100));
  const entered = mode === 'pct' ? (p.breathZonePcts ?? pcts) : (p.breathZoneTops ?? tops);
  const ok = validBreathTops(entered);
  const set = (i: number, v: number) => { const next = [...entered]; next[i] = v; setP(mode === 'pct' ? { ...p, breathZoneMode: 'pct', breathZonePcts: next } : { ...p, breathZoneMode: 'abs', breathZoneTops: next }); };
  const custom = !!(p.breathZonePcts || p.breathZoneTops);
  const std = standardBreathPcts(p.vt1Ve ?? 0, vt2);
  const one = (x: number) => Math.round(x * 10) / 10;
  return (
    <div style="margin-top:14px">
      <div class="row between wrap" style="align-items:center;gap:10px;margin-bottom:6px">
        <b class="small">Breathing zones</b>
        <div class="seg">
          <button class={mode === 'pct' ? 'on' : ''} onClick={() => mode !== 'pct' && setP({ ...p, breathZoneMode: 'pct', breathZonePcts: pcts })}>% of VT2</button>
          <button class={mode === 'abs' ? 'on' : ''} onClick={() => mode !== 'abs' && setP({ ...p, breathZoneMode: 'abs', breathZoneTops: tops.map(one) })}>Litres a minute</button>
        </div>
      </div>
      <table class={`steps zone-ed mode-${mode}`}>
        <tr><td /><td class="faint small">Zone</td><td class="r faint small zone-pct">% of VT2</td><td class="r faint small zone-abs">Breathing</td><td class="r faint small">Top ({mode === 'pct' ? '%' : 'L/min'})</td></tr>
        {zones.map((z, i) => (
          <tr key={i}>
            <td><span class="z" style={`background:${ZONE_VAR[Math.min(6, [0, 1, 3, 4, 6][i])]}`} /></td>
            <td>Z{i + 1} {z.name}</td>
            <td class="r num muted zone-pct">{i < 4 ? `${i === 0 ? 'up to ' : `${pcts[i - 1]}–`}${pcts[i]}%` : `${pcts[3]}%+`}</td>
            <td class="r num zone-abs">{i < 4 ? `${i === 0 ? 'up to ' : `${one(z.low)}–`}${one(z.high)}` : `${one(z.low)}+`}</td>
            <td class="r">{i < 4 ? <NumberBox decimals={mode !== 'pct'} class="num zone-top" style="text-align:right" value={entered[i]} onValue={(v) => { if (v != null) set(i, v); }} /> : <span class="faint small">open</span>}</td>
          </tr>
        ))}
      </table>
      <div class="row wrap" style="margin-top:8px;gap:12px;align-items:center">
        {!ok && <span class="small" style="color:var(--bad)">Each top must be higher than the one before; until it is, the standard shares are used.</span>}
        <span class="faint small">{mode === 'pct' ? 'Shares of VT2: change VT2 and these move with it.' : 'Litres a minute: these stay where you put them when VT2 changes.'}</span>
        {custom && std && <button class="btn sm quiet" style="margin-left:auto" onClick={() => setP({ ...p, breathZoneMode: undefined, breathZonePcts: undefined, breathZoneTops: undefined })}>Back to standard shares</button>}
      </div>
    </div>
  );
}

/** Under a number the setup left unknown or estimated: what it is now and how it gets set (13 Nov 2026). */
function Unsure({ p, k, unknown }: { p: Profile; k: UnsureNumber; unknown: string }) {
  const est = estimateOf(p, k);
  if (est) return <div class="faint small" style="margin-top:4px"><span class="est-tag">estimate</span> from {est}. Type your own to replace it; a test replaces it too.</div>;
  if (isUnknown(p, k)) return <div class="faint small" style="margin-top:4px">{unknown}</div>;
  return null;
}

/** Where sent workouts go, read from Intervals.icu when this part of Settings is opened, with Check again (13 Nov 2026). */
function WhereWorkoutsGo() {
  const [again, setAgain] = useState(0);
  const dest = useDestinations(true, again);
  return (
    <div class="panel" style="margin-top:12px;padding:10px 14px">
      <div class="row between" style="gap:8px"><b class="small">Where your workouts go</b><button class="btn sm quiet" disabled={dest.kind === 'loading'} onClick={() => setAgain(again + 1)}>{dest.kind === 'loading' ? 'Checking…' : 'Check again'}</button></div>
      <p class="faint small" style="margin:4px 0 8px">{SEND_GENERAL} The app only reads these settings; change them on intervals.icu.</p>
      {dest.kind === 'error' && <p class="small" style="margin:0">Your Intervals.icu settings couldn't be read just now. Sending still works.</p>}
      {dest.kind === 'ok' && (() => {
        const w = destinationWords(dest.d);
        return (
          <div class="stack" style="gap:4px">
            {dest.d.makers.length > 0 && <ul class="small dest-makers">{dest.d.makers.map((m) => <li key={m.maker}><b>{m.name}</b>: {m.connected ? (m.uploads ? 'connected, uploads on' : 'connected, uploads off') : 'uploads on, but not connected'}{m.filtered ? ', with an upload filter' : ''}</li>)}</ul>}
            <p class="small" style="margin:0">{w.line}</p>
            {w.extra.map((x) => <p key={x} class="faint small" style="margin:0">{x}</p>)}
            {lastUploadWords(dest.d).map((x) => <p key={x} class="faint small" style="margin:0">{x}</p>)}
            {w.none && <UploadSteps />}
          </div>
        );
      })()}
    </div>
  );
}
