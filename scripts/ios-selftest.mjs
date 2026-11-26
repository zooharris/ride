// The iPhone and iPad app's self-test in Apple's simulators (24 Nov 2026), run by the publishing machine.
//
// It starts a stand-in for Garmin on this machine, installs the test build of the app in an iPhone and an iPad
// simulator, opens it twice with the self-test asked for (the pages' side is src/selfTestIos.ts), reads the results
// the app writes, and takes a picture of each screen. Anything that fails stops the iOS build being uploaded.
// Then, on the iPhone, the app tours its own ride screens and a picture is taken of each (src/tourIos.ts).
//
//   node scripts/ios-selftest.mjs <path to App.app>
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.argv[2];
const BUNDLE = 'cycling.antogo.app';
const KEY = 'made-up-garmin-key-0123456789';
const OUT = 'ios-report';
mkdirSync(OUT, { recursive: true });

const run = (args, env) => execFileSync('xcrun', args, { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for Garmin: the key for a token, then the token reads a profile and an empty history.
const token = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64')}.y`;
const seen = [];
const srv = createServer((req, res) => {
  const url = req.url ?? '';
  seen.push(`${req.method} ${url.split('?')[0]}`);
  const json = (b) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.includes('personal-api-key/token')) {
    if (req.headers.authorization !== `ApiKey ${KEY}`) { res.writeHead(401); res.end('bad key'); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end(token); return;
  }
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end('no token'); return; }
  if (url.startsWith('/userprofile-service')) return json({ id: 1, measurementSystem: 'statute' });
  if (url.startsWith('/download-service')) { res.writeHead(404); res.end(''); return; }
  return json([]);
});
await new Promise((ok) => srv.listen(0, ok));
const base = `http://localhost:${srv.address().port}/`;

function pick(kind) {
  const all = JSON.parse(run(['simctl', 'list', 'devices', 'available', '-j'])).devices;
  const runtimes = Object.keys(all).filter((r) => /iOS/.test(r)).sort().reverse();
  for (const r of runtimes) {
    const d = all[r].find((x) => (kind === 'iPhone' ? /^iPhone \d+( Pro)?$/.test(x.name) : /^iPad (Pro|Air)/.test(x.name)));
    if (d) return { ...d, runtime: r };
  }
  throw new Error(`No ${kind} simulator available`);
}

async function waitFor(udid, name, seconds) {
  for (let t = 0; t < seconds; t += 2) {
    try {
      const dir = run(['simctl', 'get_app_container', udid, BUNDLE, 'data']).trim();
      const f = join(dir, 'Documents', name);
      if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
    } catch { /* not installed yet */ }
    await sleep(2000);
  }
  throw new Error(`${name} never appeared`);
}

const tourNotes = [];
async function tour(d) {
  run(['simctl', 'uninstall', d.udid, BUNDLE]);
  run(['simctl', 'install', d.udid, APP]);
  run(['simctl', 'launch', '--terminate-running-process', d.udid, BUNDLE], { SIMCTL_CHILD_ANTOGO_TOUR: '1' });
  let docs = '';
  const taken = new Set();
  for (let t = 0; t < 1200; t++) {
    await sleep(400);
    if (!docs) { try { docs = join(run(['simctl', 'get_app_container', d.udid, BUNDLE, 'data']).trim(), 'Documents'); } catch { continue; } }
    if (!existsSync(docs)) continue;
    for (const f of readdirSync(docs).filter((x) => /^antogo-tour-\d\d-.*\.txt$/.test(x)).sort()) {
      if (taken.has(f)) continue;
      taken.add(f);
      const stop = f.replace(/^antogo-tour-/, '').replace(/\.txt$/, '');
      run(['simctl', 'io', d.udid, 'screenshot', join(OUT, `tour-${stop}.png`)]);
      let found = {};
      try { found = JSON.parse(readFileSync(join(docs, f), 'utf8')); } catch { /* still being written */ }
      const faults = found.faults ?? [];
      tourNotes.push(`${stop}: ${found.width}x${found.height}, room ${JSON.stringify(found.room)}: ${faults.length ? faults.join('; ') : 'fits'}`);
      // Tell the app the picture is taken, so it moves on to its next stop.
      writeFileSync(join(docs, `${f}.taken`), '');
    }
    const done = join(docs, 'antogo-tour-done.txt');
    if (existsSync(done)) {
      const r = JSON.parse(readFileSync(done, 'utf8'));
      if (!r.ok) { run(['simctl', 'io', d.udid, 'screenshot', join(OUT, 'tour-stopped.png')]); tourNotes.push(`The tour stopped at ${r.where} (${r.at}): ${r.error}. On the screen: ${r.screen}`); }
      else tourNotes.push(`The tour finished: ${r.stops} stops.`);
      break;
    }
  }
  if (!taken.size) tourNotes.push('The tour made no stops.');
  run(['simctl', 'terminate', d.udid, BUNDLE]);
}

const results = [];
for (const kind of ['iPhone', 'iPad']) {
  const d = pick(kind);
  console.log(`${kind}: ${d.name} (${d.runtime})`);
  try { run(['simctl', 'boot', d.udid]); } catch { /* already booted */ }
  run(['simctl', 'bootstatus', d.udid, '-b']);
  run(['simctl', 'install', d.udid, APP]);
  for (const n of ['1', '2']) {
    run(['simctl', 'launch', '--terminate-running-process', d.udid, BUNDLE], { SIMCTL_CHILD_ANTOGO_SELFTEST: '1', SIMCTL_CHILD_ANTOGO_SELFTEST_RUN: n, SIMCTL_CHILD_ANTOGO_GARMIN_BASE: base });
    const r = await waitFor(d.udid, `antogo-selftest-${n}.json`, 120);
    await sleep(3000);
    run(['simctl', 'io', d.udid, 'screenshot', join(OUT, `${kind}-open-${n}.png`)]);
    results.push({ device: d.name, ...r });
    run(['simctl', 'terminate', d.udid, BUNDLE]);
  }
  // The tour of the phone's ride screens (26 Nov 2026): a fresh copy of the app walks itself through the screen before
  // a ride, the ride's three pages and Ride complete's two, upright and on its side, and a picture is taken at each
  // stop. The pictures are for looking at before a phone build is called ready; nothing here stops a publish.
  if (kind === 'iPhone') {
    try { await tour(d); } catch (e) { tourNotes.push(`The tour did not finish: ${e.message}`); }
  }
  run(['simctl', 'shutdown', d.udid]);
}
srv.close();

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, garminStandInSaw: seen }, null, 2));
let failed = 0;
for (const r of results) {
  console.log(`\n${r.device}, opening ${r.run}: ${r.ok ? 'all passed' : 'FAILED'}   (safe areas ${JSON.stringify(r.insets)})`);
  for (const c of r.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (!r.ok) failed++;
  // An iPhone with a notch or island must show the page clear of it.
  if (/iPhone/.test(r.device) && r.insets && parseFloat(r.insets.top) <= 0) { console.log('  FAIL the page does not know where the notch is'); failed++; }
}
console.log(`\nThe tour of the phone's ride screens (pictures in ${OUT}/tour-*.png):`);
for (const t of tourNotes) console.log(`  ${t}`);
writeFileSync(join(OUT, 'tour.txt'), tourNotes.join('\n'));
console.log(`\nGarmin stand-in was asked: ${seen.join(', ') || 'nothing'}`);
process.exit(failed ? 1 : 0);
