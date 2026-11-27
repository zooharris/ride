// The newer Antogo, downloaded by the app itself (26 Nov 2026). Until now the app handed the link to the rider's
// browser and could not say whether anything was happening, so a second and third download were easy to start.
// Now one download runs at a time, the pages are told how far it has got, the whole file is checked against what was
// published before it is called downloaded, and nothing already in the Downloads folder is replaced or removed.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { finished } = require('stream/promises');

const LATEST = 'https://api.github.com/repos/zooharris/ride/releases/latest';
const FILE = 'https://github.com/zooharris/ride/releases/latest/download/Antogo.dmg';
const FROM = 'https://github.com/zooharris/ride/releases/';

/** What a published release says of the Mac app's file: where it is, its size, its fingerprint and the release's number. */
function fileOf(release) {
  const a = ((release && release.assets) || []).find((x) => x && x.name === 'Antogo.dmg');
  if (!a || typeof a.browser_download_url !== 'string') return null;
  const n = /(\d+)\s*$/.exec(String(release.tag_name || ''));
  const d = /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''));
  return { url: a.browser_download_url, size: Number(a.size) || 0, sha256: d ? d[1] : undefined, number: n ? n[1] : undefined };
}

/** The file's name in Downloads: "Antogo 316.dmg" when the release's number is known, else "Antogo.dmg". */
const baseName = (number) => (number ? `Antogo ${number}.dmg` : 'Antogo.dmg');

/** The first name of this kind that is not already there: the name itself, then "(2)", "(3)"… Nothing is written over. */
function freeName(base, exists) {
  if (!exists(base)) return base;
  const stem = base.replace(/\.dmg$/, '');
  for (let i = 2; ; i++) { const n = `${stem} (${i}).dmg`; if (!exists(n)) return n; }
}

/** Why a download did not finish, in words for the banner. */
function why(e) {
  const m = String((e && e.message) || e || '');
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ERR_CONNECTION|ERR_TIMED_OUT|ENOTFOUND|ECONNRESET/i.test(m)) return 'the internet could not be reached';
  if (/ENOSPC/i.test(m)) return 'there is not enough room on the disk';
  if (/EACCES|EPERM/i.test(m)) return 'the Downloads folder could not be written to';
  return m || 'something went wrong';
}

/**
 * net: something with fetch (Electron's own); folder(): where downloads go; send(state): tells the pages;
 * quit(): closes the app (after the downloaded file is opened, so it can be replaced);
 * openPath(p): opens a file as the Finder would; test: the app's own tests may name another place to ask.
 */
function createUpdater({ net, folder, send, openPath, quit, test = {} }) {
  let current = { state: 'idle' };
  let busy = false;
  let ctl = null;
  const set = (s) => { current = s; try { send(s); } catch { /* no window to tell */ } };
  const allowed = (url) => (test.latest ? true : typeof url === 'string' && url.startsWith(FROM));

  async function start() {
    if (busy) return current;
    busy = true;
    ctl = new AbortController();
    const signal = ctl.signal;
    set({ state: 'starting' });
    let tmp = null, out = null;
    try {
      const dir = folder();
      // What was published: its size and fingerprint let the app say honestly that the whole file arrived.
      let info = null;
      try {
        const r = await net.fetch(test.latest || LATEST, { signal, headers: { accept: 'application/vnd.github+json' } });
        if (r.ok) info = fileOf(await r.json());
      } catch (e) { if (signal.aborted) throw e; }
      const url = (info && info.url) || FILE;
      if (!allowed(url)) throw new Error('the published file was not where it should be');
      const exists = (n) => fs.existsSync(path.join(dir, n));
      const base = baseName(info && info.number);
      // Already downloaded, whole: nothing to fetch again.
      if (info && info.size && info.number && exists(base) && fs.statSync(path.join(dir, base)).size === info.size) {
        set({ state: 'done', name: base, received: info.size, total: info.size, already: true });
        return current;
      }
      const name = freeName(base, exists);
      const res = await net.fetch(url, { signal });
      if (!res.ok || !res.body) throw new Error(`the download was refused (${res.status})`);
      const total = (info && info.size) || Number(res.headers.get('content-length')) || 0;
      tmp = path.join(dir, `${name}.download`);
      out = fs.createWriteStream(tmp);
      const hash = crypto.createHash('sha256');
      let received = 0, told = 0;
      set({ state: 'downloading', name, received, total });
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        if (Date.now() - told > 250) { told = Date.now(); set({ state: 'downloading', name, received, total }); }
      }
      out.end();
      await finished(out);
      set({ state: 'checking', name, received, total });
      if (total && received !== total) throw new Error('it stopped before the end');
      if (info && info.sha256 && hash.digest('hex') !== info.sha256) throw new Error('the file that arrived was not the one published');
      fs.renameSync(tmp, path.join(dir, name));
      tmp = null;
      set({ state: 'done', name, received, total: received });
    } catch (e) {
      try { if (out) out.destroy(); } catch { /* already closed */ }
      set(signal.aborted ? { state: 'idle' } : { state: 'failed', why: why(e) });
    } finally {
      if (tmp) { try { fs.unlinkSync(tmp); } catch { /* never made */ } }
      busy = false;
    }
    return current;
  }

  return {
    state: () => current,
    start,
    cancel: () => { if (busy && ctl) ctl.abort(); return true; },
    /**
     * Open the downloaded file, as a double-click in the Finder would, then close this app (26 Nov 2026): a running
     * app cannot be replaced, so with it still open the drag into Applications was refused until the rider quit it.
     */
    open: async () => {
      if (current.state !== 'done' || !current.name) return false;
      const p = path.join(folder(), current.name);
      if (!fs.existsSync(p)) { set({ state: 'failed', why: 'the downloaded file is no longer in your Downloads folder' }); return false; }
      const ok = (await openPath(p)) === '';
      // Long enough for the disk image's window to appear before this one goes.
      if (ok && quit) setTimeout(quit, 1500);
      return ok;
    },
  };
}

module.exports = { createUpdater, fileOf, baseName, freeName, why };
