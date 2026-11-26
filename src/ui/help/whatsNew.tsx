import { useEffect, useState } from 'preact/hooks';
import { db, getSetting, setSetting } from '../../data/db';
import { APP_SHORT_NAME } from '../../appName';

/**
 * What's new (25 Nov 2026): shown once after an update, and kept in Help. The newest entry is first. Each entry says
 * what changed for the rider, in the app's own words; an entry is added with every published build that changes what
 * a rider sees.
 */
export interface NewsEntry { id: string; date: string; items: Array<{ title: string; text: string; help?: string }> }

export const WHATS_NEW: NewsEntry[] = [
  {
    id: '2026-11-26d', date: '26 November 2026, night', items: [
      { title: 'Paused, said once', text: 'When you stop pedalling and the ride pauses itself, only the Paused panel appears: the extra message that said the same thing is gone, and so is the one that announced the ride carrying on. Start pedalling and the ride carries on, or press Resume.', help: 'riding' },
      { title: 'Save, Download and Discard on both pages after a ride', text: 'On a phone, Ride complete\'s Details page now ends with the same three buttons as Summary, in the same place.', help: 'riding' },
    ],
  },
  {
    id: '2026-11-26c', date: '26 November 2026, evening', items: [
      { title: 'The phone\'s ride screens, put right', text: 'On an iPhone the screen before a ride now fits every size of iPhone, whatever it is waiting for. Held on its side, each screen sits centred, with the same margin above as below, and no longer leaves the notch\'s space twice. Labels are no longer cut off. On its side, the Workout page gives most of its width to the chart, with the trainer\'s controls on one line beneath it.', help: 'riding' },
      { title: 'Ride complete, on a phone', text: 'After a ride a phone now shows two pages that each fit the screen: Summary, with the ride\'s numbers, its chart, how it felt and Save ride; and Details, with each effort and what the cues said. Swipe between them, or press a page\'s name at the foot.', help: 'riding' },
    ],
  },
  {
    id: '2026-11-26b', date: '26 November 2026, afternoon', items: [
      { title: 'The Mac app downloads its own updates', text: 'When a newer version is ready, press Download once: the app fetches the file to your Downloads folder itself and shows how far it has got, with a Cancel. When the whole file has arrived and been checked, press Open. Nothing already in Downloads is replaced or removed.' },
      { title: 'The ride on a phone, one screen at a time', text: 'While you ride, a phone now shows three pages that each fit the screen, upright or on its side: Ride, Numbers and Workout. Swipe sideways between them, or press a page\'s name at the foot. Nothing sits below the fold.', help: 'riding' },
      { title: 'Before the ride, on one screen', text: 'On a phone the ride, your devices, how the ride runs and Start ride are all on one screen. Press the chart to see the steps, and press a device\'s box to choose or change it.', help: 'riding' },
    ],
  },
  {
    id: '2026-11-26', date: '26 November 2026', items: [
      { title: 'A ride carries on when the app is not in front', text: 'On iPhone and iPad you can switch to another app or lock the screen during a ride: every reading is kept, the trainer keeps to its targets, and the screen catches up when you return. The Mac app and a browser tab carry on when hidden too.', help: 'riding' },
      { title: 'Help, rebuilt as pages', text: 'Help now opens on a few topics. Each page is one task: numbered steps, with a picture of the screen beside each, and the full detail folded away below. Press a picture to see it larger.', help: 'start' },
    ],
  },
  {
    id: '2026-11-25b', date: '25 November 2026, evening', items: [
      { title: 'Ride with your trainer on iPhone and iPad', text: 'The ride player now reaches smart trainers, power meters, heart-rate straps and other sensors through the iPhone\'s or iPad\'s own Bluetooth, and is on the iPhone for the first time. The screen stays on while you ride.', help: 'guide-trainer' },
      { title: 'Restoring a backup never puts older data over newer', text: 'A backup is restored as it was when it was made. If the device is then kept in step with your others, the newer version of each thing is kept. Going back to an old backup on every device is its own action in Settings, and warns first.', help: 'guide-devices' },
      { title: 'Help, with pictures', text: 'Help now starts with short guides, pictures of the app as it looks on the device in your hand, step-by-step fixes for common problems, and Check my setup, which tests each connection you have made.', help: 'check' },
      { title: 'A new app icon', text: `${APP_SHORT_NAME} has a new blue icon on the Mac, iPhone, iPad and in the browser.` },
    ],
  },
  {
    id: '2026-11-25', date: '25 November 2026, morning', items: [
      { title: 'Nothing to connect before you begin', text: `${APP_SHORT_NAME} opens straight into setup. Connecting Intervals.icu, adding a Garmin key and restoring a backup are each optional, and each can be done later in Settings.` },
      { title: 'You choose whether a device joins your others', text: 'A device that finds your saved copy from another device combines nothing until you choose: keep it in step, or keep it separate.', help: 'guide-devices' },
      { title: 'A signed app for the Mac', text: 'The Mac app opens with a double-click, with no warning.' },
    ],
  },
];

const SEEN = 'whatsNewSeen';
export const latestNews = (): NewsEntry => WHATS_NEW[0];

/** Entries newer than the one last seen on this device, newest first. */
export function unseen(seen: string | null): NewsEntry[] {
  if (!seen) return [WHATS_NEW[0]];
  const i = WHATS_NEW.findIndex((e) => e.id === seen);
  return i < 0 ? [WHATS_NEW[0]] : WHATS_NEW.slice(0, i);
}

export function NewsList({ entries }: { entries: NewsEntry[] }) {
  return (
    <div class="news">
      {entries.map((e) => (
        <div key={e.id}>
          <p class="eyebrow" style="margin:0 0 4px">{e.date}</p>
          <ul>{e.items.map((it) => <li key={it.title}><b>{it.title}.</b> {it.text}{it.help && <> <a href={`#/help?s=${it.help}`}>More in Help</a></>}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The sheet shown once after an update. A new installation has nothing to be told is new: it is marked as seen
 * before setup, and the sheet never appears there.
 */
export function WhatsNewSheet() {
  const [show, setShow] = useState<NewsEntry[] | null>(null);
  useEffect(() => {
    void (async () => {
      const seen = await getSetting<string | null>(SEEN, null);
      if (!(await db.profile.get('me'))) { if (seen !== latestNews().id) await setSetting(SEEN, latestNews().id); return; }
      if (seen === latestNews().id) return;
      setShow(unseen(seen));
    })().catch(() => undefined);
  }, []);
  if (!show?.length) return null;
  const close = () => { setShow(null); void setSetting(SEEN, latestNews().id); };
  return (
    <div class="bt-back" onClick={close}>
      <div class="bt-sheet panel" role="dialog" aria-modal="true" aria-label={`What's new in ${APP_SHORT_NAME}`} style="max-width:560px" onClick={(e) => e.stopPropagation()}>
        <h2 style="margin:0 0 10px">What's new in {APP_SHORT_NAME}</h2>
        <div class="prose" onClick={(e) => { if ((e.target as HTMLElement).tagName === 'A') close(); }}><NewsList entries={show} /></div>
        <div class="row" style="margin-top:14px;justify-content:flex-end;gap:8px"><a class="btn quiet" href="#/help?s=new" onClick={close}>All of it, in Help</a><button class="btn primary" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}
