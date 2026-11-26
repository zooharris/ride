import { useEffect, useState } from 'preact/hooks';
import { PageHead } from '../PageHead';
import { appKind, appNotices } from '../../shell';

/**
 * Open-source and third-party notices (24 Nov 2026), as their licences require. The text is made at each build from
 * what that build ships (scripts/noticesPlugin.ts) and packed in with the pages, so reading it fetches nothing from
 * outside. The iPhone and iPad app adds its shell's notices; the Mac app adds its engine's, and opens the full list
 * of Chromium's licences (several megabytes) in the rider's browser.
 */
export function Notices() {
  const [text, setText] = useState<string | null>(null);
  const kind = appKind();
  useEffect(() => {
    void (async () => {
      const read = async (f: string) => { try { const r = await fetch(`${import.meta.env.BASE_URL}${f}`); return r.ok ? await r.text() : ''; } catch { return ''; } };
      const parts = [await read('notices.txt')];
      if (kind === 'ios') parts.push(await read('notices-ios.txt'));
      if (kind === 'mac') parts.push(await read('notices-mac.txt'));
      setText(parts.filter(Boolean).join('\n\n') || 'The notices could not be read.');
    })();
  }, []);
  return (
    <div>
      <PageHead help="settings" back={{ label: 'Settings', href: '#/settings' }} title="Open-source notices" />
      <p class="prose" style="margin-top:0">Antogo is built with open-source software, each part under its own licence. These are the notices and licences that come with them.</p>
      {kind === 'mac' && appNotices.canOpenEngine() && <p class="small"><button class="btn sm" onClick={() => { void appNotices.openEngine(); }}>Open the full list of Chromium's licences</button> <span class="faint">· the engine inside the Mac app; it opens in your browser</span></p>}
      <pre class="notices-text">{text ?? 'Reading…'}</pre>
    </div>
  );
}
