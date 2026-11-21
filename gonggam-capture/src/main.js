const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, desktopCapturer, screen,
  clipboard, nativeImage, shell, dialog, protocol, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const ReportHTML = require('./shared/report-html');
const phone = require('./phone-server');

const APP_NAME = '공감캡처';
const PHONE_PORT = 47800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

protocol.registerSchemesAsPrivileged([
  { scheme: 'gc', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('kr.gonggamedutech.capture');

// ───────────────────────── 저장소 ─────────────────────────
const DEFAULT_SHORTCUTS = {
  region: 'Ctrl+Shift+2',
  last: 'Ctrl+Shift+3',
  full: 'Ctrl+Shift+1',
  edit: 'Ctrl+Shift+4',
  session: 'Ctrl+Shift+5',
  phone: 'Ctrl+Shift+6',
};
const DEFAULTS = {
  academy: '',
  teacher: '',
  saveDir: '',
  shortcuts: { ...DEFAULT_SHORTCUTS },
  recentClasses: [],
  autoStart: false,
  notify: true,
  lastRegion: null,
  phoneToken: '',
};

let settings = { ...DEFAULTS };
let items = []; // 최신이 앞
let reportDraft = null;
let session = { active: false, name: '', auto: false, interval: 30, startedAt: 0, count: 0 };
let failedShortcuts = [];

const dataFile = (name) => path.join(app.getPath('userData'), name);
const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
const pending = new Map();
function writeJSON(file, getValue) {
  clearTimeout(pending.get(file)?.timer);
  const flush = () => {
    pending.delete(file);
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(getValue()));
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('저장 실패', file, e);
    }
  };
  pending.set(file, { timer: setTimeout(flush, 150), flush });
}
function flushAll() {
  for (const p of [...pending.values()]) {
    clearTimeout(p.timer);
    p.flush();
  }
}
const saveSettings = () => writeJSON(dataFile('settings.json'), () => settings);
const saveItems = () => writeJSON(dataFile('library.json'), () => items);

function loadAll() {
  const s = readJSON(dataFile('settings.json'), {});
  settings = { ...DEFAULTS, ...s, shortcuts: { ...DEFAULT_SHORTCUTS, ...(s.shortcuts || {}) } };
  if (!settings.phoneToken) {
    settings.phoneToken = crypto.randomBytes(9).toString('base64url');
    saveSettings();
  }
  // 탐색기에서 지운 사진은 목록에서도 뺀다
  items = readJSON(dataFile('library.json'), []).filter((it) => it && it.file && fs.existsSync(it.file));
  reportDraft = readJSON(dataFile('report.json'), null);
  fs.mkdirSync(thumbDir(), { recursive: true });
}

const saveRoot = () => settings.saveDir || path.join(app.getPath('pictures'), APP_NAME);
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const findItem = (id) => items.find((it) => it.id === id);

function rememberClass(name) {
  name = (name || '').trim();
  if (!name) return;
  settings.recentClasses = [name, ...settings.recentClasses.filter((c) => c !== name)].slice(0, 12);
  saveSettings();
}

// 사진 한 장을 폴더에 쓰고 목록에 올린다
function addImage(buf, ext, meta) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('사진을 읽지 못했습니다');
  const now = new Date();
  const dir = path.join(saveRoot(), dateStr(now));
  fs.mkdirSync(dir, { recursive: true });
  const label = { screen: '화면', phone: '폰', import: '가져옴' }[meta.source] || '화면';
  const base = `${APP_NAME}_${dateStr(now).replace(/-/g, '')}_${timeStr(now)}_${label}${meta.edited ? '_편집' : ''}`;
  let file = path.join(dir, `${base}.${ext}`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}_${n}.${ext}`);
  fs.writeFileSync(file, buf);

  const id = crypto.randomBytes(8).toString('hex');
  const size = img.getSize();
  const thumb = path.join(thumbDir(), `${id}.jpg`);
  try {
    fs.writeFileSync(thumb, (size.width > 560 ? img.resize({ width: 560, quality: 'good' }) : img).toJPEG(82));
  } catch {
    /* 썸네일이 없으면 원본으로 보여 준다 */
  }
  const item = {
    id, file, thumb, ts: now.getTime(), w: size.width, h: size.height,
    source: meta.source, session: meta.session || '', memo: meta.memo || '',
    auto: !!meta.auto, edited: !!meta.edited,
  };
  items.unshift(item);
  saveItems();
  sync();
  return item;
}

// ───────────────────────── 창 ─────────────────────────
let mainWin = null;
let overlayWin = null;
let tray = null;
let quitting = false;
const asset = (name) => path.join(__dirname, 'assets', name);

function publicState() {
  return {
    settings: { ...settings, saveRoot: saveRoot() },
    items,
    session,
    reportDraft,
    failedShortcuts,
    version: app.getVersion(),
  };
}
function sync() {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('sync', { items, session, settings: { ...settings, saveRoot: saveRoot() }, failedShortcuts });
  updateTray();
}
function toMain(channel, ...args) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, ...args);
}
function showMain() {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}
function toast(text) {
  toMain('toast', text);
}
function notify(body) {
  if (!settings.notify || !Notification.isSupported()) return;
  new Notification({ title: APP_NAME, body, silent: true, icon: asset('icon.png') }).show();
}

function createMain(hidden) {
  mainWin = new BrowserWindow({
    width: 1280, height: 840, minWidth: 980, minHeight: 640,
    show: false, backgroundColor: '#f4f7f6', title: APP_NAME, icon: asset('icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWin.setMenu(null);
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => {
    if (!hidden) mainWin.show();
  });
  // 창을 닫아도 알림 영역에 남아 단축키가 계속 동작한다
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function updateTray() {
  if (!tray) return;
  const sc = settings.shortcuts;
  tray.setToolTip(session.active ? `${APP_NAME} — 수업 중: ${session.name}` : APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `영역 캡처\t${sc.region}`, click: () => captureRegion(false) },
      { label: `직전 영역 다시\t${sc.last}`, click: () => captureLast() },
      { label: `전체 화면\t${sc.full}`, click: () => captureFull() },
      { type: 'separator' },
      { label: session.active ? `수업 세션 종료 (${session.name})` : '수업 세션 시작…', click: () => toggleSession() },
      { label: '폰으로 찍기 (QR)', click: () => openView('phone') },
      { type: 'separator' },
      { label: `${APP_NAME} 열기`, click: () => showMain() },
      { label: '저장 폴더 열기', click: () => openSaveFolder() },
      { type: 'separator' },
      { label: '종료', click: () => { quitting = true; app.quit(); } },
    ])
  );
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset('tray.png')));
  tray.on('click', () => showMain());
  updateTray();
}
function openView(view) {
  showMain();
  toMain('nav', view);
}
function openSaveFolder() {
  fs.mkdirSync(saveRoot(), { recursive: true });
  shell.openPath(saveRoot());
}

// ───────────────────────── 캡처 ─────────────────────────
let shot = null; // 멈춘 화면 { img, png, display }
let shotSeq = 0;
let overlayBusy = false;
let restoreMainAfter = false;

async function grabDisplay(display) {
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
  });
  let src = sources.find((s) => String(s.display_id) === String(display.id));
  if (!src) {
    const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id);
    src = sources[idx] || sources[0];
  }
  if (!src || src.thumbnail.isEmpty()) throw new Error('화면을 가져오지 못했습니다');
  return src.thumbnail;
}
const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

function getOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) return Promise.resolve(overlayWin);
  return new Promise((resolve) => {
    overlayWin = new BrowserWindow({
      show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false, enableLargerThanScreen: true,
      backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    overlayWin.setMenu(null);
    overlayWin.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
    overlayWin.webContents.once('did-finish-load', () => resolve(overlayWin));
    overlayWin.on('closed', () => {
      overlayWin = null;
      overlayBusy = false;
    });
  });
}

async function captureRegion(fromUI) {
  if (overlayBusy) return;
  overlayBusy = true;
  try {
    restoreMainAfter = false;
    if (fromUI && mainWin && mainWin.isVisible()) {
      // 앱 창이 화면을 가리지 않게 잠깐 숨긴다
      mainWin.hide();
      restoreMainAfter = true;
      await sleep(260);
    }
    const display = cursorDisplay();
    const img = await grabDisplay(display);
    shot = { img, png: img.toPNG(), display };
    const ov = await getOverlay();
    ov.setBounds(display.bounds);
    const last = settings.lastRegion && settings.lastRegion.displayId === display.id ? settings.lastRegion.rect : null;
    ov.webContents.send('overlay:shot', { n: ++shotSeq, last });
  } catch (e) {
    overlayBusy = false;
    if (restoreMainAfter) mainWin.show();
    notify(String(e.message || e));
  }
}

ipcMain.on('overlay:ready', () => {
  if (!overlayWin || !overlayBusy) return;
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.show();
  overlayWin.focus();
});

ipcMain.on('overlay:done', (_e, result) => {
  if (overlayWin) overlayWin.hide();
  overlayBusy = false;
  const cur = shot;
  shot = null;
  const restore = restoreMainAfter;
  restoreMainAfter = false;
  try {
    if (!cur || !result || result.action === 'cancel') return;
    const size = cur.img.getSize();
    const r = clampRect(result.rect, size);
    if (!r) return;
    settings.lastRegion = { displayId: cur.display.id, rect: r };
    saveSettings();
    finishCapture(cur.img.crop(r), result.action);
    if (result.action === 'edit') return; // 편집기로 가면서 창이 뜬다
  } catch (e) {
    notify(String(e.message || e));
  } finally {
    if (restore && result && result.action !== 'edit') mainWin.showInactive();
  }
});

function clampRect(rect, size) {
  if (!rect) return null;
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)));
  const width = Math.max(0, Math.min(size.width - x, Math.round(rect.width)));
  const height = Math.max(0, Math.min(size.height - y, Math.round(rect.height)));
  return width >= 2 && height >= 2 ? { x, y, width, height } : null;
}

// 클립보드를 다른 프로그램이 잡고 있어도 저장·편집 흐름은 끊기지 않게 한다
function copyImage(img) {
  try {
    clipboard.writeImage(img);
    return true;
  } catch (e) {
    console.error('클립보드 복사 실패', e);
    return false;
  }
}

// action: copy(저장+복사) | edit(저장 후 편집) | report(보고서에 담기)
function finishCapture(img, action) {
  const item = addImage(img.toPNG(), 'png', { source: 'screen', session: session.active ? session.name : '' });
  const copied = copyImage(img);
  if (session.active) {
    session.count++;
    sync();
  }
  if (action === 'edit') {
    showMain();
    toMain('edit', item.id);
  } else if (action === 'report') {
    toMain('report:add', [item.id]);
    notify('보고서에 담았습니다');
  } else {
    notify(`${copied ? '저장하고 클립보드에 복사했습니다' : '저장했습니다'} (${item.w}×${item.h})`);
  }
  return item;
}

async function captureFull() {
  if (overlayBusy) return;
  try {
    finishCapture(await grabDisplay(cursorDisplay()), 'copy');
  } catch (e) {
    notify(String(e.message || e));
  }
}

async function captureLast() {
  if (overlayBusy) return;
  const last = settings.lastRegion;
  if (!last) return captureRegion(false); // 아직 찍은 영역이 없으면 고르게 한다
  try {
    const display = screen.getAllDisplays().find((d) => d.id === last.displayId) || cursorDisplay();
    const img = await grabDisplay(display);
    const r = clampRect(last.rect, img.getSize());
    if (!r) return captureRegion(false);
    finishCapture(img.crop(r), 'copy');
  } catch (e) {
    notify(String(e.message || e));
  }
}

function editLast() {
  const last = items[0];
  showMain();
  if (last) toMain('edit', last.id);
  else toast('아직 캡처가 없습니다');
}

// ───────────────────────── 수업 세션 · 자동 캡처 ─────────────────────────
let autoTimer = null;
let autoPrev = null;
let autoDisplayId = null;

function fingerprint(img) {
  return img.resize({ width: 96, quality: 'good' }).toBitmap();
}
// 같은 화면인지: 줄인 그림에서 눈에 띄게 달라진 픽셀이 1.5% 미만이면 같다고 본다
function sameScreen(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let changed = 0;
  const total = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 26 || Math.abs(a[i + 1] - b[i + 1]) > 26 || Math.abs(a[i + 2] - b[i + 2]) > 26) changed++;
  }
  return changed / total < 0.015;
}
async function autoTick() {
  if (!session.active || overlayBusy) return;
  try {
    const display = screen.getAllDisplays().find((d) => d.id === autoDisplayId) || screen.getPrimaryDisplay();
    const img = await grabDisplay(display);
    const fp = fingerprint(img);
    if (sameScreen(autoPrev, fp)) return;
    autoPrev = fp;
    if (!session.active) return;
    addImage(img.toPNG(), 'png', { source: 'screen', session: session.name, auto: true });
    session.count++;
    sync();
  } catch (e) {
    console.error('자동 캡처 실패', e);
  }
}
function startSession(opts) {
  const name = String(opts.name || '').trim();
  if (!name) throw new Error('반 이름을 적어 주세요');
  stopSession(true);
  const interval = Math.max(10, Math.min(180, Number(opts.interval) || 30));
  session = { active: true, name, auto: !!opts.auto, interval, startedAt: Date.now(), count: 0 };
  rememberClass(name);
  if (session.auto) {
    autoPrev = null;
    autoDisplayId = cursorDisplay().id;
    autoTimer = setInterval(autoTick, interval * 1000);
    setTimeout(autoTick, 1500);
  }
  sync();
}
function stopSession(silent) {
  clearInterval(autoTimer);
  autoTimer = null;
  autoPrev = null;
  if (!session.active) return;
  const ended = session;
  session = { ...session, active: false };
  if (!silent) {
    sync();
    notify(`수업 세션 종료 — ${ended.name} · ${ended.count}장`);
  }
}
function toggleSession() {
  if (session.active) stopSession(false);
  else openView('session');
}

// ───────────────────────── 폰 연결 ─────────────────────────
async function phoneInfo() {
  const info = await phone.ensure({
    token: settings.phoneToken,
    port: PHONE_PORT,
    getInfo: () => ({
      academy: settings.academy,
      session: session.active ? session.name : '',
      classes: settings.recentClasses,
    }),
    onUpload: (buf, type, sessionName) => {
      const ext = /png/i.test(type) ? 'png' : 'jpg';
      const name = sessionName.trim().slice(0, 60) || (session.active ? session.name : '');
      const item = addImage(buf, ext, { source: 'phone', session: name });
      rememberClass(name);
      if (session.active && name === session.name) session.count++;
      sync();
      toast('폰에서 사진이 들어왔습니다');
      return item;
    },
  });
  if (!info.url) return { ok: false };
  const qr = await QRCode.toString(info.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { ok: true, url: info.url, qr };
}

// ───────────────────────── 단축키 ─────────────────────────
function registerShortcuts() {
  globalShortcut.unregisterAll();
  failedShortcuts = [];
  const actions = {
    region: () => captureRegion(false),
    last: () => captureLast(),
    full: () => captureFull(),
    edit: () => editLast(),
    session: () => toggleSession(),
    phone: () => openView('phone'),
  };
  for (const [key, fn] of Object.entries(actions)) {
    const acc = settings.shortcuts[key];
    if (!acc) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(acc, fn);
    } catch {
      ok = false;
    }
    if (!ok) failedShortcuts.push(key);
  }
}

// ───────────────────────── IPC ─────────────────────────
function registerIpc() {
  const h = (ch, fn) =>
    ipcMain.handle(ch, async (_e, ...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        return { error: String(e.message || e) };
      }
    });

  h('state', () => publicState());
  h('capture', (mode) => {
    if (mode === 'region') captureRegion(true);
    else if (mode === 'last') captureLast();
    else if (mode === 'full') {
      // 앱 창 말고 뒤 화면을 찍도록 잠깐 숨긴다
      mainWin.hide();
      setTimeout(async () => {
        await captureFull();
        mainWin.showInactive();
      }, 260);
    }
    return {};
  });

  h('item:update', (id, patch) => {
    const it = findItem(id);
    if (!it) return {};
    if (typeof patch.memo === 'string') it.memo = patch.memo;
    if (typeof patch.session === 'string') {
      it.session = patch.session.trim();
      rememberClass(it.session);
    }
    saveItems();
    sync();
    return {};
  });
  h('item:delete', async (ids) => {
    for (const id of ids) {
      const it = findItem(id);
      if (!it) continue;
      try {
        await shell.trashItem(it.file); // 휴지통으로 — 실수해도 되살릴 수 있다
      } catch {
        try { fs.unlinkSync(it.file); } catch { /* 이미 없음 */ }
      }
      try { fs.unlinkSync(it.thumb); } catch { /* 없음 */ }
    }
    items = items.filter((it) => !ids.includes(it.id));
    saveItems();
    sync();
    return {};
  });
  h('item:copy', (id) => {
    const it = findItem(id);
    return { copied: !!it && copyImage(nativeImage.createFromPath(it.file)) };
  });
  h('item:reveal', (id) => {
    const it = findItem(id);
    if (it) shell.showItemInFolder(it.file);
    return {};
  });
  // 편집본은 원본을 두고 새 파일로 저장한다
  h('item:saveEdit', (id, dataUrl, meta) => {
    const src = findItem(id);
    const img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) throw new Error('편집본을 만들지 못했습니다');
    const item = addImage(img.toPNG(), 'png', {
      source: src ? src.source : 'screen',
      session: meta && typeof meta.session === 'string' ? meta.session : src ? src.session : '',
      memo: meta && typeof meta.memo === 'string' ? meta.memo : src ? src.memo : '',
      edited: true,
    });
    return { id: item.id, copied: copyImage(img) };
  });
  h('copyDataUrl', (dataUrl) => {
    return { copied: copyImage(nativeImage.createFromDataURL(dataUrl)) };
  });
  h('import', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      title: '사진 가져오기',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '사진', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
    });
    if (r.canceled) return { count: 0 };
    let count = 0;
    for (const f of r.filePaths) {
      try {
        let buf = fs.readFileSync(f);
        let ext = path.extname(f).slice(1).toLowerCase();
        if (!['png', 'jpg', 'jpeg'].includes(ext)) {
          buf = nativeImage.createFromBuffer(buf).toPNG();
          ext = 'png';
        }
        addImage(buf, ext === 'jpeg' ? 'jpg' : ext, { source: 'import', session: session.active ? session.name : '' });
        count++;
      } catch (e) {
        console.error('가져오기 실패', f, e);
      }
    }
    return { count };
  });

  h('session:start', (opts) => {
    startSession(opts);
    return {};
  });
  h('session:stop', () => {
    stopSession(false);
    return {};
  });
  h('phone:info', () => phoneInfo());
  h('copyText', (text) => {
    clipboard.writeText(String(text));
    return {};
  });

  h('settings:set', (patch) => {
    for (const k of ['academy', 'teacher', 'notify', 'autoStart', 'saveDir']) {
      if (k in patch) settings[k] = patch[k];
    }
    if (patch.shortcuts) {
      settings.shortcuts = { ...settings.shortcuts, ...patch.shortcuts };
      registerShortcuts();
    }
    if ('autoStart' in patch && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: !!settings.autoStart, args: ['--hidden'] });
    }
    saveSettings();
    sync();
    return { failedShortcuts };
  });
  h('settings:resetShortcuts', () => {
    settings.shortcuts = { ...DEFAULT_SHORTCUTS };
    registerShortcuts();
    saveSettings();
    sync();
    return { failedShortcuts };
  });
  h('chooseFolder', async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: '저장 폴더 고르기', properties: ['openDirectory', 'createDirectory'], defaultPath: saveRoot() });
    if (r.canceled || !r.filePaths[0]) return {};
    settings.saveDir = r.filePaths[0];
    saveSettings();
    sync();
    return { saveDir: settings.saveDir };
  });
  h('openFolder', () => {
    openSaveFolder();
    return {};
  });

  h('report:saveDraft', (draft) => {
    reportDraft = draft;
    writeJSON(dataFile('report.json'), () => reportDraft);
    return {};
  });
  h('report:pdf', async (data) => {
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').trim();
    const name = ['수업보고서', safe(data.className), safe(data.date)].filter(Boolean).join('_') + '.pdf';
    const r = await dialog.showSaveDialog(mainWin, {
      title: '보고서 PDF 저장',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    const pdf = await renderPdf(data);
    fs.writeFileSync(r.filePath, pdf);
    shell.openPath(r.filePath);
    return { file: r.filePath };
  });
}

let reportPage = '';
async function renderPdf(data) {
  const photos = (data.photos || []).filter((p) => findItem(p.id));
  reportPage = ReportHTML.page({ ...data, photos, imgSrc: (id) => `gc://img/${id}` });
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { contextIsolation: true, javascript: true } });
  try {
    await win.loadURL('gc://report/print');
    await win.webContents.executeJavaScript(
      'Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>1)'
    );
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    win.destroy();
  }
}

function registerProtocol() {
  protocol.handle('gc', (req) => {
    const u = new URL(req.url);
    const id = u.pathname.replace(/^\//, '');
    if (u.host === 'img' || u.host === 'thumb') {
      const it = findItem(id);
      if (!it) return new Response('', { status: 404 });
      const p = u.host === 'thumb' && it.thumb && fs.existsSync(it.thumb) ? it.thumb : it.file;
      // 편집기 캔버스에서 다시 내보낼 수 있게 CORS 헤더를 붙인다
      return fs.promises.readFile(p).then(
        (buf) => new Response(buf, { headers: { 'content-type': /\.png$/i.test(p) ? 'image/png' : 'image/jpeg', 'access-control-allow-origin': '*' } }),
        () => new Response('', { status: 404 })
      );
    }
    if (u.host === 'shot') {
      if (!shot) return new Response('', { status: 404 });
      return new Response(shot.png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    }
    if (u.host === 'report') {
      return new Response(reportPage, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return new Response('', { status: 404 });
  });
}

// ───────────────────────── 시작 ─────────────────────────
app.on('second-instance', () => showMain());
app.on('window-all-closed', () => {
  /* 알림 영역에 상주 */
});
app.on('before-quit', () => {
  quitting = true;
  flushAll();
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  phone.stop();
});

app.whenReady().then(() => {
  loadAll();
  registerProtocol();
  registerIpc();
  createMain(process.argv.includes('--hidden'));
  createTray();
  registerShortcuts();
  // 개발 중 자동 점검용 (설치본에서는 동작하지 않는다)
  if (!app.isPackaged && process.env.GC_SMOKE) {
    require(path.resolve(process.env.GC_SMOKE)).run({
      mainWin, renderPdf, addImage, phoneInfo, captureRegion, captureFull, captureLast, startSession, stopSession,
      getItems: () => items, getOverlay: () => overlayWin, getSession: () => session,
    });
  }
});
