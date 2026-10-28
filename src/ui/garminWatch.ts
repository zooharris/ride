/**
 * The Garmin rule runs at launch and after every pull from Intervals.icu
 * (pressed or automatic): a ride the player uploaded is swapped for the
 * Garmin's recording of the same ride when that has arrived, with a toast and
 * Undo.
 */
import { applyGarminRule, keepVeloiqInstead, markEarlierPlayerRides, type Swap } from '../player/garmin';
import { onSyncRunning, syncRunning } from '../sync/syncService';
import { notify } from './store';
import { toast } from './Toast';

let started = false;
let running = false;

export function swapToast(s: Swap): void {
  if (!s.undo) { toast({ ok: true, text: `Kept your Garmin's recording of ${s.name} and removed VeloIQ's copy.` }); return; }
  toast({
    ok: true,
    text: `Kept your Garmin's recording of ${s.name}: it's the one in Garmin Connect.${s.noPower ? " Your Garmin didn't record power; Undo to keep VeloIQ's instead." : ''}`,
    action: { label: 'Undo', run: async () => { const r = await keepVeloiqInstead(s.recordingId!); notify(); toast({ ok: r.ok, text: r.ok ? `Kept VeloIQ's recording of ${s.name}.` : r.text }); } },
  });
}

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await markEarlierPlayerRides();
    const swaps = await applyGarminRule();
    if (swaps.length) { notify(); swaps.forEach(swapToast); }
  } catch { /* tried again after the next pull */ }
  finally { running = false; }
}

export function watchGarminRule(): void {
  if (started) return;
  started = true;
  void run();
  onSyncRunning(() => { if (!syncRunning()) void run(); });
}
