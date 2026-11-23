import { useEffect, useState } from 'preact/hooks';
import { db, getSetting, setSetting } from '../data/db';
import { FTP_SOURCE, type FtpSource } from '../sync/ownService';
import { startChangeOver } from '../sync/syncService';
import { APP_SHORT_NAME } from '../appName';
import { notify } from './store';

/**
 * Which FTP of the day scores the rider's rides (22 Nov 2026). Two places may have one for each ride: the device's own
 * setting, written into the activity's file, and the data service's record. Where they agree it doesn't matter. Where
 * they differ, every load and intensity differs with them, so the rider is shown both and chooses; nothing is changed
 * for anyone until they do. A stop on the way to the app keeping its own dated FTP history.
 */
export interface FtpStats { n: number; device: number; service: number; differ: boolean }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** The two FTPs over the rides of the last 120 days that have both: the typical value of each, and whether they differ by more than 5%. */
export async function ftpStats(): Promise<FtpStats | null> {
  const from = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const recent = new Set((await db.rides.where('date').aboveOrEqual(from).primaryKeys()) as string[]);
  let both = (await db.own.toArray()).filter((r) => r.deviceFtp && r.serviceFtp);
  const near = both.filter((r) => recent.has(r.id));
  if (near.length >= 3) both = near;
  if (!both.length) return null;
  const device = median(both.map((r) => r.deviceFtp!)), service = median(both.map((r) => r.serviceFtp!));
  return { n: both.length, device, service, differ: Math.abs(device - service) > Math.max(device, service) * 0.05 };
}

export function FtpSourceChoice({ mode }: { mode: 'notice' | 'setting' }) {
  const [source, setSource] = useState<FtpSource | undefined | null>(null);
  const [st, setSt] = useState<FtpStats | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getSetting<FtpSource | undefined>(FTP_SOURCE, undefined).then(setSource); void ftpStats().then(setSt); }, []);
  if (source === null || !st) return null;
  if (mode === 'notice' && (source || !st.differ)) return null;
  const choose = async (s: FtpSource) => {
    setBusy(true);
    await setSetting(FTP_SOURCE, s);
    setSource(s);
    try { await startChangeOver(); } finally { setBusy(false); notify(); }
  };
  const btn = (s: FtpSource, label: string) => (
    <button class={`btn sm${source === s ? ' primary' : ''}`} aria-pressed={source === s} disabled={busy} onClick={() => choose(s)}>{label}</button>
  );
  return (
    <div class={`ftp-source${mode === 'notice' ? ' panel' : ''}`} style={mode === 'notice' ? 'margin-bottom:12px' : 'margin-top:12px;padding-top:12px;border-top:1px solid var(--line)'}>
      <p class="small" style="margin:0 0 4px"><b>{mode === 'notice' ? 'Two different FTPs are on record for your rides' : 'The FTP each ride is scored with'}</b></p>
      <p class="small muted" style="margin:0 0 8px">
        {st.differ
          ? <>On your recent rides, your device had your FTP set at <b>{st.device} W</b> and Intervals.icu had <b>{st.service} W</b>. A ride's training load and intensity are measured against the FTP of its day, so they come out differently depending on which is used. Choose the one you kept up to date.</>
          : <>Your device and Intervals.icu each record your FTP for the day of a ride, and on your recent rides they agree ({st.device} W). If they ever differ, this is where you choose which one scores your rides.</>}
        {!source && <> Until you choose, {APP_SHORT_NAME} uses Intervals.icu's, as it always has.</>}
      </p>
      <div class="row wrap" style="gap:8px">
        {btn('device', `My device's (${st.device} W)`)}
        {btn('service', `Intervals.icu's (${st.service} W)`)}
      </div>
      {busy && <p class="faint small" style="margin:6px 0 0">Working your rides out again with it…</p>}
      {source && !busy && <p class="faint small" style="margin:6px 0 0">Each ride's page says which was used, under "FTP used for this ride". Changing this works every ride out again.</p>}
    </div>
  );
}
