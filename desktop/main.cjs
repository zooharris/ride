// Antogo as an installed app (23 Nov 2026): every page is packed inside and served from the app itself, so nothing is
// hosted and nothing is fetched to run. The app's own side does the few things a web page may not: it keeps the
// Garmin personal key in the computer's password store, and asks Garmin on the pages' behalf. It reaches Garmin's
// address only; it is not a general way out to the internet.
const { app, BrowserWindow, protocol, net, ipcMain, shell, safeStorage, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createUpdater } = require('./update.cjs');

const PAGES = path.join(__dirname, '..', 'dist');
const HOME = 'app://antogo/ride/';
const GARMIN = 'https://personal.connectapi.garmin.com/';
// For the app's own tests only: Garmin's requests go to a stand-in (never in the built app), the data to a scratch
// folder, and downloads into a folder without asking where.
const garminBase = !app.isPackaged && process.env.ANTOGO_GARMIN_BASE ? process.env.ANTOGO_GARMIN_BASE : GARMIN;
// The app's name is Antogo (so the password store's entry says Antogo, 24 Nov 2026), but its data stays where every
// earlier copy kept it, under the folder named after the app's old working name: renaming must never lose a rider's data.
if (process.env.ANTOGO_DATA) app.setPath('userData', process.env.ANTOGO_DATA);
else app.setPath('userData', path.join(app.getPath('appData'), 'ride'));
const downloadsTo = process.env.ANTOGO_DOWNLOADS;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

/** The packed file a page address stands for; anything unknown is the app's one page. Never outside the packed pages. */
function fileFor(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname).replace(/^\/ride(\/|$)/, '/');
  const full = path.normalize(path.join(PAGES, p));
  if (u.host !== 'antogo' || !full.startsWith(PAGES) || p === '/' || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return path.join(PAGES, 'index.html');
  return full;
}

// The Garmin key: encrypted with a secret the computer's own password store holds, in a file only this app reads.
const keyFile = () => path.join(app.getPath('userData'), 'garmin-key');
function readKey() {
  try {
    const saved = JSON.parse(fs.readFileSync(keyFile(), 'utf8'));
    return { key: safeStorage.decryptString(Buffer.from(saved.sealed, 'base64')), savedAt: saved.savedAt, expires: saved.expires };
  } catch { return null; }
}

/** The answer the Bluetooth search is waiting for: the id of the device picked, or nothing to stop looking. */
let choose = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 560, backgroundColor: '#0B0E14', title: 'Antogo Cycling',
    // backgroundThrottling off (26 Nov 2026): a ride carries on at full pace when the window is hidden, minimised or behind another.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // A link to anywhere else opens in the rider's browser; the app's window only ever shows the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://antogo/')) { e.preventDefault(); if (/^https?:\/\//.test(url)) void shell.openExternal(url); } });
  // Choosing a Bluetooth device: a browser shows a list of its own; the app has none, so the pages show Antogo's. Each
  // time the search finds more, the list is sent again; nothing is connected until the rider picks one.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    choose = callback;
    win.webContents.send('bt:devices', devices.map((d) => ({ id: d.deviceId, name: d.deviceName })));
  });
  void win.loadURL(HOME);
  return win;
}

app.whenReady().then(() => {
  // A test machine with no password store of its own may stand one in; the built app never does.
  if (!app.isPackaged && process.env.ANTOGO_TEST_STORE && process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true);
  protocol.handle('app', (req) => net.fetch(pathToFileURL(fileFor(req.url)).toString()));

  if (downloadsTo) session.defaultSession.on('will-download', (_e, item) => item.setSavePath(path.join(downloadsTo, item.getFilename())));

  const fromApp = (e) => { if (!e.senderFrame || !e.senderFrame.url.startsWith('app://antogo/')) throw new Error('not from the app'); };
  // A newer Antogo is downloaded by the app itself, one at a time, and the pages are told how far it has got (26 Nov 2026).
  const updater = createUpdater({
    net,
    folder: () => downloadsTo || app.getPath('downloads'),
    send: (s) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', s); },
    openPath: (p) => shell.openPath(p),
    test: !app.isPackaged && process.env.ANTOGO_UPDATE_LATEST ? { latest: process.env.ANTOGO_UPDATE_LATEST } : {},
  });
  ipcMain.handle('update:state', (e) => { fromApp(e); return updater.state(); });
  ipcMain.handle('update:start', (e) => { fromApp(e); void updater.start(); return true; });
  ipcMain.handle('update:cancel', (e) => { fromApp(e); return updater.cancel(); });
  ipcMain.handle('update:open', (e) => { fromApp(e); return updater.open(); });
  ipcMain.handle('garmin:fetch', async (e, url, init) => {
    fromApp(e);
    if (typeof url !== 'string' || !url.startsWith(GARMIN)) throw new Error('Only Garmin can be asked this way.');
    const res = await net.fetch(garminBase + url.slice(GARMIN.length), { method: init?.method ?? 'GET', headers: init?.headers ?? {} });
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: new Uint8Array(await res.arrayBuffer()) };
  });
  ipcMain.handle('bt:choose', (e, id) => { fromApp(e); const answer = choose; choose = null; if (answer) answer(typeof id === 'string' ? id : ''); return !!answer; });
  // The engine's own notices (Chromium's licences, several megabytes): packed in with the app, opened in the rider's browser.
  ipcMain.handle('notices:engine', async (e) => {
    fromApp(e);
    const file = app.isPackaged ? path.join(process.resourcesPath, 'notices', 'LICENSES.chromium.html') : path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html');
    if (!fs.existsSync(file)) return false;
    return (await shell.openPath(file)) === '';
  });
  ipcMain.handle('key:can', (e) => { fromApp(e); return safeStorage.isEncryptionAvailable(); });
  ipcMain.handle('key:read', (e) => { fromApp(e); return readKey(); });
  // A key kept by an earlier, unsigned copy is sealed with a secret this signed copy is not given: say so, never fail silently.
  ipcMain.handle('key:unreadable', (e) => { fromApp(e); return fs.existsSync(keyFile()) && !readKey(); });
  ipcMain.handle('key:save', (e, key, expires) => {
    fromApp(e);
    if (typeof key !== 'string' || !key.trim()) throw new Error('No key given.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no password store the app can use.');
    const saved = { sealed: safeStorage.encryptString(key.trim()).toString('base64'), savedAt: new Date().toISOString(), ...(expires ? { expires } : {}) };
    fs.writeFileSync(keyFile(), JSON.stringify(saved), { mode: 0o600 });
    return { key: key.trim(), savedAt: saved.savedAt, expires: saved.expires };
  });
  ipcMain.handle('key:forget', (e) => { fromApp(e); try { fs.unlinkSync(keyFile()); } catch { /* none kept */ } return true; });

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
