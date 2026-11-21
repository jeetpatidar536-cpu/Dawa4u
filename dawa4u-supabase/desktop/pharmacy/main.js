// dawa4u Pharmacy — Windows desktop app. Opens the live pharmacy panel (https://dawa4u.in/pharmacy/),
// so it is always the latest version. Other websites open in the normal browser.
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');

const HOME = 'https://dawa4u.in/pharmacy/';
const OWN = ['dawa4u.in', 'www.dawa4u.in', 'rgihpkjruoxdxbtpprgd.supabase.co'];
const isOwn = url => { try { const u = new URL(url); return u.protocol === 'https:' && OWN.includes(u.hostname); } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();
let win;

function create() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    title: 'dawa4u Pharmacy', backgroundColor: '#0B1708', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(HOME);

  // Links to other sites (WhatsApp, maps, payment pages…) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (isOwn(url)) return { action: 'allow' }; if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isOwn(url) && !url.startsWith('file:')) { e.preventDefault(); if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); } });

  // No internet: show a friendly page with a retry button
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: url || HOME } });
  });
}

app.whenReady().then(() => {
  // Camera (for prescription photos) and location are allowed only for dawa4u pages
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(isOwn(wc.getURL()) && ['media', 'geolocation', 'notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'dawa4u', submenu: [
      { label: 'Home', accelerator: 'Alt+Home', click: () => win && win.loadURL(HOME) },
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' },
      { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
  ]));
  create();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
