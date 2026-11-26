/**
 * The line between the iPhone and iPad app's Bluetooth search and Antogo's own "Choose a device" list (25 Nov 2026).
 * It depends on nothing, so the app's own side (src/shell.ts) and the Bluetooth layer (ble/native.ts) can both use it.
 */
export interface FoundDevice { id: string; name: string }
/** Why a search could not start, for the rider: Bluetooth off, not allowed for Antogo, or not present. */
export type BluetoothProblem = 'off' | 'denied' | 'unsupported';

let watcher: ((found: FoundDevice[]) => void) | undefined;
let picker: ((id: string) => void) | undefined;
let problemWatcher: ((p: BluetoothProblem) => void) | undefined;

export const chooserBus = {
  /** The list on screen asks to hear of every device found. */
  watch(fn: (found: FoundDevice[]) => void): void { watcher = fn; },
  /** The search tells the list what it has found so far. */
  publish(found: FoundDevice[]): void { watcher?.(found); },
  /** The search waits for the rider's pick; an empty id means the list was closed. */
  onPick(fn: ((id: string) => void) | undefined): void { picker = fn; },
  pick(id: string): boolean { const p = picker; if (!p) return false; p(id); return true; },
  watchProblems(fn: (p: BluetoothProblem) => void): void { problemWatcher = fn; },
  problem(p: BluetoothProblem): void { problemWatcher?.(p); },
};
