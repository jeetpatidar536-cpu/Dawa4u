// dawa4u Pharmacy — Windows desktop app.
// Opens the live pharmacy dashboard (https://dawa4u.in/pharmacy-dashboard/), so it is always the latest version
// and talks to the same backend as the website. On top of the website it adds what a shop counter needs:
//   - a Windows notification and a flashing taskbar button when a new order or prescription arrives
//   - the order count on the taskbar icon's tooltip
//   - closing the window keeps it running in the tray, so orders keep coming in
//   - "Start with Windows", so the shop never forgets to open it
// Other websites open in the normal browser.
const { app, BrowserWindow, shell, Menu, Tray, Notification, session, nativeImage } = require('electron');
const path = require('path');

const HOME = 'https://dawa4u.in/pharmacy-dashboard/';
const OWN = ['dawa4u.in', 'www.dawa4u.in'];
const isOwn = url => { try { const u = new URL(url); return u.protocol === 'https:' && OWN.includes(u.hostname); } catch { return false; } };
const ICON = path.join(__dirname, 'build', 'icon.png');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('in.dawa4u.pharmacy'); // needed for Windows notifications

let win, tray, quitting = false, lastCount = 0;

function show() {
  if (!win) return create();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// The dashboard puts the number of things waiting in the page title: "(3) Pharmacy · dawa4u"
function onTitle(title) {
  const m = /^\((\d+)\)/.exec(title || '');
  const n = m ? parseInt(m[1], 10) : 0;
  if (tray) tray.setToolTip(n ? `dawa4u Pharmacy — ${n} waiting` : 'dawa4u Pharmacy');
  if (n > lastCount) {
    if (!win.isFocused()) win.flashFrame(true);
    if (Notification.isSupported()) {
      const note = new Notification({
        title: 'New order on dawa4u',
        body: n === 1 ? '1 order or prescription is waiting for you.' : `${n} orders and prescriptions are waiting for you.`,
        icon: ICON,
      });
      note.on('click', show);
      note.show();
    }
  }
  lastCount = n;
}

function create() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    title: 'dawa4u Pharmacy', backgroundColor: '#0B1708', autoHideMenuBar: true, show: false,
    icon: ICON,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: false },
  });
  // Lets the website know it runs inside the desktop app.
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' dawa4uApp/pharmacy-desktop');
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.loadURL(HOME);

  win.on('page-title-updated', (_e, title) => onTitle(title));
  win.on('focus', () => win.flashFrame(false));

  // Closing the window keeps the app in the tray, so new orders still ring.
  win.on('close', e => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
      if (tray && !app.__toldTray) {
        app.__toldTray = true;
        tray.displayBalloon && tray.displayBalloon({ title: 'dawa4u Pharmacy is still running', content: 'New orders will still pop up. Right-click the tray icon to quit.', iconType: 'info' });
      }
    }
  });

  // Links to other sites (WhatsApp, maps, payment pages…) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (isOwn(url)) return { action: 'allow' }; if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isOwn(url) && !url.startsWith('file:')) { e.preventDefault(); if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); } });

  // Downloads (orders CSV, stock template) go to the Downloads folder and open from there
  session.defaultSession.on('will-download', (_e, item) => {
    item.once('done', (_ev, state) => { if (state === 'completed') shell.showItemInFolder(item.getSavePath()); });
  });

  // No internet: show a friendly page that retries by itself
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: url || HOME } });
  });
}

function startsWithWindows() {
  return app.getLoginItemSettings().openAtLogin;
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open dawa4u Pharmacy', click: show },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: startsWithWindows(), click: item => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setToolTip('dawa4u Pharmacy');
  tray.setContextMenu(menu());
  tray.on('click', show);
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

app.whenReady().then(() => {
  // Camera (prescription photos), notifications and location are allowed only for dawa4u pages
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(isOwn(wc.getURL()) && ['media', 'geolocation', 'notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'dawa4u', submenu: [
      { label: 'Home', accelerator: 'Alt+Home', click: () => win && win.loadURL(HOME) },
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' },
      { type: 'separator' }, { label: 'Quit', accelerator: 'Ctrl+Q', click: () => { quitting = true; app.quit(); } }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  // First run: start with Windows by default (a shop should never miss orders); can be turned off in the tray menu.
  if (!app.getLoginItemSettings().openAtLogin && !require('fs').existsSync(path.join(app.getPath('userData'), '.asked'))) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    require('fs').writeFileSync(path.join(app.getPath('userData'), '.asked'), '1');
  }
  buildTray();
  create();
});
app.on('second-instance', show);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* stay in the tray */ });
