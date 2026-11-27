/**
 * A tour of the ride's screens inside Apple's iPhone and iPad simulators (26 Nov 2026; the iPad, and a ride by heart
 * rate, from 27 Nov). Runs only in the test build the
 * publishing machine starts there, when that machine asks for it; the app riders get never runs it (its native side
 * always answers "not asked"). It sets up a made-up rider as a rider would, by pressing the app's own buttons, turns
 * on the simulated trainer, and stops at each screen (before the ride, the ride's pages, Ride complete's)
 * upright and on its side. At each stop it writes what it finds; the publishing machine takes a picture of the
 * screen there. Those pictures show the screens with the real clock, notch and home bar, which no browser test has,
 * and are looked at before a phone build is called ready.
 */
import { registerPlugin } from '@capacitor/core';
import { phoneFaults, type Room } from './ui/phoneFit';

export interface TourSide {
  tour(): Promise<{ asked: boolean }>;
  turn(o: { side: boolean }): Promise<void>;
  report(o: { name: string; text: string }): Promise<void>;
  taken(o: { name: string }): Promise<{ yes: boolean }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const said = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ');

async function until<T>(what: string, fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, seconds = 20): Promise<T> {
  for (let t = 0; t < seconds * 4; t++) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`waited ${seconds} s for ${what}`);
}
const find = (sel: string, text: string | RegExp) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => shown(el) && (typeof text === 'string' ? said(el) === text : text.test(said(el))));
async function press(sel: string, text: string | RegExp, seconds = 20): Promise<void> {
  const el = await until(`${sel} "${String(text)}"`, () => find(sel, text), seconds);
  el.click();
  await sleep(400);
}
function type(el: HTMLInputElement, v: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function goTo(hash: string): Promise<void> { location.hash = hash; await sleep(700); }

/** Where the clock, the notch and the home bar are, as the phone itself says. */
function room(): Room {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const r = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  probe.remove();
  return r;
}

export async function runIosTour(): Promise<void> {
  const side = registerPlugin<TourSide>('AntogoNative');
  const asked = await side.tour().catch(() => ({ asked: false }));
  if (asked.asked) await runTour(side);
}

/** The tour itself, given the side that turns the screen and writes what is found (the app's own, or a stand-in when the tour is tried in a browser). */
export async function runTour(side: TourSide): Promise<void> {
  // No one is there to answer "End the ride?": the app's own question is answered OK as soon as it is drawn.
  window.confirm = () => true;
  setInterval(() => { document.querySelector<HTMLButtonElement>('.ask .btn.primary')?.click(); }, 300);
  let n = 0;
  let where = 'opening';
  const stop = async (name: string, sideways: boolean) => {
    n++;
    where = name;
    await sleep(900);
    const rm = room();
    const file = `antogo-tour-${String(n).padStart(2, '0')}-${name}.txt`;
    await side.report({ name: file, text: JSON.stringify({ name, sideways, width: innerWidth, height: innerHeight, room: rm, faults: phoneFaults({ room: rm, side: sideways }) }) });
    // The publishing machine takes its picture here, and says when it has: the tour waits for that, so each picture
    // is of its own stop (the first tour moved on after a few seconds, and the pictures fell behind).
    await until('the picture to be taken', () => side.taken({ name: file }).then((r) => r.yes).catch(() => false), 60).catch(() => undefined);
    await sleep(300);
  };
  const turn = async (sideways: boolean) => {
    await side.turn({ side: sideways });
    await until(sideways ? 'the screen to turn on its side' : 'the screen to turn upright', () => (innerWidth > innerHeight) === sideways, 10).catch(() => undefined);
    await sleep(1200);
  };
  const pageNamed = async (name: string) => { await press('.rp-dots button', name); await sleep(900); };

  try {
    // A made-up rider, set up as a rider would: a name, an FTP, "I don't know" to the rest.
    where = 'first-run setup';
    await press('button', 'Set up Antogo', 40);
    type(await until('the name box', () => document.querySelector<HTMLInputElement>('#ob-name')), 'Nova Example');
    const ftp = await until('the FTP box', () => document.querySelector<HTMLInputElement>('input[aria-label^="FTP"]'));
    type(ftp, '255');
    await sleep(300);
    // The box takes its number when the rider leaves it.
    ftp.dispatchEvent(new FocusEvent('blur'));
    ftp.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await sleep(400);
    for (const box of [...document.querySelectorAll('.ob-number')]) {
      if (/^FTP/.test(said(box))) continue;
      [...box.querySelectorAll('button')].find((b) => said(b) === "I don't know")?.click();
      await sleep(250);
    }
    await press('button', '5 h');
    await press('button', /^Start/);
    await until('Today', () => location.hash.startsWith('#/today'), 30);

    where = 'the simulated trainer';
    await goTo('#/settings');
    await press('button.fold-head', /Ride player/);
    const field = await until('the simulated trainer switch', () => [...document.querySelectorAll('.field')].find((f) => /Practice with a simulated trainer/.test(said(f))));
    [...field.querySelectorAll('button')].find((b) => said(b) === 'On')?.click();
    await sleep(500);

    where = 'a workout from the library';
    await goTo('#/library');
    const links = await until('the library', () => { const a = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="#/workout/"]')]; return a.length ? a : undefined; }, 30);
    const link = links.find((a) => /sweet spot/i.test(said(a))) ?? links.find((a) => /tempo|threshold|endurance/i.test(said(a))) ?? links[0];
    const id = /#\/workout\/([^?]+)/.exec(link.getAttribute('href') ?? '')?.[1];
    if (!id) throw new Error('no workout found in the library');
    await goTo(`#/play/workout/${id}`);

    where = 'before the ride';
    await until('the screen before the ride', () => document.querySelector('.pp'), 30);
    await sleep(800);
    // A rider just set up starts on heart rate; this tour rides by power.
    const byPower = find('.pp-row .seg button', 'Power');
    if (byPower && byPower.getAttribute('aria-pressed') !== 'true') { byPower.click(); await sleep(600); }
    await stop('before-nothing-connected', false);
    await press('button', 'Choose your trainer', 30);
    await press('[role="menuitem"]', /Simulated smart trainer/i);
    // A simulated heart-rate strap too, so the heart-rate readings have something to show.
    const hrBox = [...document.querySelectorAll<HTMLElement>('.pl-dev')].find((d) => /^Heart rate/i.test(said(d)));
    if (hrBox) { hrBox.click(); await sleep(400); find('[role="menuitem"]', /Simulated heart/i)?.click(); await sleep(400); }
    await until('Start ride', () => { const b = find('button', 'Start ride') as HTMLButtonElement | undefined; return b && !b.disabled ? b : undefined; }, 30);
    await stop('before-upright', false);
    await turn(true);
    await stop('before-side', true);
    await turn(false);

    where = 'riding';
    await press('button', 'Start ride');
    await until('the ride to begin', () => document.querySelector('.player.ride') && !document.querySelector('.rd-overlay'), 30);
    await sleep(14000);
    // A phone's ride is two pages; an iPad's is one screen, with no pages to turn.
    const paged = () => !!find('.rp-dots button', /./);
    const each = async (what: string, names: string[], sideways: boolean) => {
      if (!paged()) { await stop(`${what}-${sideways ? 'side' : 'upright'}`, sideways); return; }
      for (const p of names) { await pageNamed(p); await stop(`${what}-${p.toLowerCase()}-${sideways ? 'side' : 'upright'}`, sideways); }
    };
    await each('riding', ['Ride', 'Workout'], false);
    await turn(true);
    await each('riding', ['Workout', 'Ride'], true);
    await turn(false);

    where = 'ending the ride';
    await press('button', 'End ride');
    await until('Ride complete', () => find('button', 'Save ride'), 30);
    await each('complete', ['Summary', 'Details'], false);
    await turn(true);
    await each('complete', ['Details', 'Summary'], true);
    await turn(false);

    // The same ride by heart rate: heart rate is the big number, and power takes a reading's place.
    where = 'a ride by heart rate';
    await press('button', /^Discard ride/);
    await goTo('#/today');
    await goTo(`#/play/workout/${id}`);
    await until('the screen before the ride', () => document.querySelector('.pp'), 30);
    await sleep(800);
    const byHr = find('.pp-row .seg button', 'Heart rate');
    if (byHr) {
      if (byHr.getAttribute('aria-pressed') !== 'true') { byHr.click(); await sleep(600); }
      await until('Start ride', () => { const b = find('button', 'Start ride') as HTMLButtonElement | undefined; return b && !b.disabled ? b : undefined; }, 30);
      await press('button', 'Start ride');
      await until('the ride to begin', () => document.querySelector('.player.ride') && !document.querySelector('.rd-overlay'), 30);
      await sleep(12000);
      await each('riding-by-heart-rate', ['Ride', 'Workout'], false);
      await turn(true);
      await each('riding-by-heart-rate', ['Ride'], true);
      await turn(false);
      await press('button', 'End ride');
      await until('Ride complete', () => find('button', 'Save ride'), 30);
    }
    await side.report({ name: 'antogo-tour-done.txt', text: JSON.stringify({ ok: true, stops: n }) });
  } catch (e) {
    await side.report({ name: 'antogo-tour-done.txt', text: JSON.stringify({ ok: false, stops: n, where, error: (e as Error).message, at: location.hash, screen: said(document.body).slice(0, 600) }) }).catch(() => undefined);
  }
}
