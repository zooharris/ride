import { expect, test, type Page } from '@playwright/test';
import { go, makePlan, openFirstRide, setUp, simulatedTrainer } from './rider';
import { phoneFaults, type Room } from '../src/ui/phoneFit';

/**
 * A phone's screens fit a phone (26 Nov 2026). Each iPhone is stood in for with its real room: the screen less the
 * space the clock, the notch and the home bar take, upright and on its side. Before the ride, the ride's three pages
 * and Ride complete's two must each sit inside that room: nothing below the fold, nothing under the notch, no label
 * cut off, and on its side the same margin above as below. Written after a build that was only ever measured against
 * the bare glass, and did not fit.
 */
interface Phone { name: string; w: number; h: number; top: number; bottom: number; side: number; low: number }
const PHONES: Phone[] = [
  { name: 'iPhone 16 Pro', w: 402, h: 874, top: 62, bottom: 34, side: 62, low: 21 },
  { name: 'iPhone 16', w: 393, h: 852, top: 59, bottom: 34, side: 59, low: 21 },
  { name: 'iPhone 16 Pro Max', w: 440, h: 956, top: 62, bottom: 34, side: 62, low: 21 },
  { name: 'iPhone SE', w: 375, h: 667, top: 20, bottom: 0, side: 0, low: 0 },
];

async function hold(page: Page, p: Phone, side: boolean): Promise<Room> {
  const room = side ? { t: 0, b: p.low, l: p.side, r: p.side } : { t: p.top, b: p.bottom, l: 0, r: 0 };
  await page.setViewportSize(side ? { width: p.h, height: p.w } : { width: p.w, height: p.h });
  await page.evaluate((m) => {
    let el = document.getElementById('stand-in-room');
    if (!el) { el = document.createElement('style'); el.id = 'stand-in-room'; document.head.appendChild(el); }
    el.textContent = `:root { --safe-t: ${m.t}px !important; --safe-b: ${m.b}px !important; --safe-l: ${m.l}px !important; --safe-r: ${m.r}px !important; }`;
  }, room);
  // The page's clock is ours: its timers (the page kept in place when the phone is turned) run when it is moved on.
  await page.clock.runFor(600);
  await page.waitForTimeout(250);
  return room;
}

async function faults(page: Page, room: Room, side: boolean): Promise<string[]> {
  return page.evaluate(phoneFaults, { room, side });
}

const shots = process.env.PHONE_SHOTS;

test('before the ride, the ride and Ride complete each fit every iPhone, upright and on its side', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-night', 'a phone only');
  test.setTimeout(300_000);
  page.on('dialog', (d) => void d.accept());
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  await page.clock.install({ time: noon });
  await setUp(page, 'power');
  await makePlan(page);
  await simulatedTrainer(page);
  await go(page, '#/calendar');
  const list = page.getByRole('button', { name: 'List', exact: true });
  if (await list.isVisible()) await list.click();
  await openFirstRide(page, true);
  await page.getByRole('link', { name: 'Ride indoors on the trainer' }).first().click();
  const wrong: string[] = [];
  const look = async (where: string, pages: string[]) => {
    for (const p of PHONES) for (const side of [false, true]) {
      const room = await hold(page, p, side);
      for (const name of pages.length ? pages : ['']) {
        if (name) {
          await page.locator('.rp-dots button', { hasText: name }).click();
          // The page has arrived when the strip has stopped on it.
          await page.waitForFunction((i) => { const el = document.querySelector('.rp-pages'); return !!el && Math.abs(el.scrollLeft - i * el.clientWidth) < 1; }, pages.indexOf(name));
        }
        const found = await faults(page, room, side);
        const at = `${where}${name ? `, ${name}` : ''} · ${p.name} ${side ? 'on its side' : 'upright'}`;
        for (const f of found) wrong.push(`${at}: ${f}`);
        if (shots) await page.screenshot({ path: `${shots}/${where}${name ? `-${name}` : ''}-${p.name.replace(/ /g, '')}-${side ? 'side' : 'up'}.png`.replace(/ /g, '-') });
      }
    }
  };

  // Nothing connected yet: the screen says what the ride needs, and still fits.
  await expect(page.getByRole('button', { name: 'Choose your trainer' })).toBeVisible();
  await look('Before the ride, nothing connected', []);
  await hold(page, PHONES[0], false);
  await page.getByRole('button', { name: 'Choose your trainer' }).click();
  await page.getByRole('menuitem', { name: /Simulated smart trainer/i }).click();
  await expect(page.getByRole('button', { name: 'Start ride' })).toBeVisible();
  // By heart rate with no heart-rate monitor: what is missing is said in the place of Start ride.
  await page.locator('.pp-row .seg button', { hasText: 'Heart rate' }).click();
  await expect(page.locator('.pl-blocked')).toBeVisible();
  await look('Before the ride, by heart rate with no monitor', []);
  await hold(page, PHONES[0], false);
  await page.locator('.pp-row .seg button', { hasText: 'Power' }).click();
  await expect(page.getByRole('button', { name: 'Start ride' })).toBeVisible();
  await look('Before the ride', []);
  await hold(page, PHONES[0], false);
  await page.getByRole('button', { name: 'Start ride' }).click();
  await page.clock.runFor(9 * 60_000);
  await look('Riding', ['Ride', 'Numbers', 'Workout']);
  await hold(page, PHONES[0], false);
  await page.clock.runFor(8 * 60_000);
  await page.getByRole('button', { name: 'End ride' }).first().click();
  await expect(page.getByRole('button', { name: 'Save ride' }).first()).toBeVisible();
  await look('Ride complete', ['Summary', 'Details']);
  // And with a long name and a long verdict, whatever the day's ride happened to be called (26 Nov 2026: a publish was
  // stopped twice by a ride whose name was longer than the one these screens had been tried with).
  await page.evaluate(() => {
    for (const h of document.querySelectorAll('.rc-head h1, .rp-name')) h.textContent = 'Cowpasture and Taylorstown';
    for (const p of document.querySelectorAll('.rc-pills')) if (p.firstElementChild) p.firstElementChild.textContent = "Goes on today's calendar as done";
  });
  await look('Ride complete, a long name', ['Summary', 'Details']);
  expect(wrong, wrong.join('\n')).toEqual([]);
});

/**
 * The same for an upright iPad (26 Nov 2026): each of the player's screens on one screen, at the three sizes of iPad,
 * with the clock's and the home bar's space taken out. Turned on its side the iPad gets the wide screens.
 */
const PADS: Phone[] = [
  { name: 'iPad 11-inch', w: 820, h: 1180, top: 24, bottom: 20, side: 0, low: 0 },
  { name: 'iPad mini', w: 744, h: 1133, top: 24, bottom: 20, side: 0, low: 0 },
  { name: 'iPad 13-inch', w: 1032, h: 1376, top: 24, bottom: 20, side: 0, low: 0 },
];

test('before the ride, the ride and Ride complete each fit an upright iPad on one screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet-day', 'a tablet only');
  test.setTimeout(300_000);
  page.on('dialog', (d) => void d.accept());
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  await page.clock.install({ time: noon });
  await setUp(page, 'power');
  await makePlan(page);
  await simulatedTrainer(page);
  await go(page, '#/calendar');
  const list = page.getByRole('button', { name: 'List', exact: true });
  if (await list.isVisible()) await list.click();
  await openFirstRide(page, true);
  await page.getByRole('link', { name: 'Ride indoors on the trainer' }).first().click();
  const wrong: string[] = [];
  const look = async (where: string) => {
    for (const p of PADS) {
      const room = await hold(page, p, false);
      for (const f of await faults(page, room, false)) wrong.push(`${where} · ${p.name}: ${f}`);
      if (shots) await page.screenshot({ path: `${shots}/pad-${where}-${p.name}.png`.replace(/ /g, '-') });
    }
    await hold(page, PADS[0], false);
  };
  await expect(page.locator('.pp.pad')).toBeVisible();
  await look('Before the ride, nothing connected');
  await page.getByRole('button', { name: 'Choose your trainer' }).click();
  await page.getByRole('menuitem', { name: /Simulated smart trainer/i }).click();
  await expect(page.getByRole('button', { name: 'Start ride' })).toBeVisible();
  await look('Before the ride');
  await page.getByRole('button', { name: 'Start ride' }).click();
  await page.clock.runFor(9 * 60_000);
  await expect(page.locator('.rpad')).toBeVisible();
  await look('Riding');
  // Turned on its side, the iPad has the wide screen; upright again, the one screen.
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.locator('.rpad')).toHaveCount(0);
  await hold(page, PADS[0], false);
  await expect(page.locator('.rpad')).toBeVisible();
  await page.clock.runFor(8 * 60_000);
  await page.getByRole('button', { name: 'End ride' }).first().click();
  await expect(page.getByRole('button', { name: 'Save ride' }).first()).toBeVisible();
  await expect(page.locator('.rcpad')).toBeVisible();
  await look('Ride complete');
  expect(wrong, wrong.join('\n')).toEqual([]);
});
