const { app, BrowserWindow, ipcMain, screen, Menu, Notification, powerMonitor, net, dialog, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { createCheckins } = require('./checkins');

const isMac = process.platform === 'darwin';
const PETS_DIR = path.join(__dirname, 'assets', 'pets');
const ACTIONS = ['idle', 'walk', 'sleep', 'remind', 'drag'];
const BUBBLE_H = 130;
const MIN_W = 240;
const PANEL_W = 340;
const PANEL_H = 556;
const TICK_MS = 16;
const WALK_SPEED = 0.8;
const GRAVITY = 0.8;
const SLEEP_AFTER_SEC = 300;
const SNOOZE_MIN = 10;
const WEATHER_EVERY_MS = 15 * 60 * 1000;

let petWin = null;
let panelWin = null;
let quitting = false;
let sprite;
let notes = [];
let notesFile;
let settingsFile;
let settings = { pet: null, quiet: false, city: '', rainSwitch: true, coords: null, checkinRemind: true, qweatherKey: 'b47b9dee79734a288de34f7d08484ff6', qweatherHost: 'p75khyh7ut.re.qweatherapi.com' };
let currentPetId = null;
let checkins = null;
// raining 只记录"上一次查到的状态"，用来判断天气是否发生了变化
const weather = { status: 'unknown', raining: false, checkedAt: null };

const pet = {
  action: 'idle',
  facing: 1,
  x: 0,
  y: 0,
  vy: 0,
  walkUntil: 0,
  nextDecisionAt: 0,
  quiet: false,
  asleep: false,
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  dragStartCursor: null,
  remindQueue: [],
};

// Windows 用户反馈离开座位回来桌宠消失，现场无痕，所以把崩溃、锁屏、睡眠都记到 userData/crash.log
function logEvent(...args) {
  const text = args
    .map((a) => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `[${new Date().toISOString()}] ${text}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => logEvent('uncaughtException', e));
process.on('unhandledRejection', (e) => logEvent('unhandledRejection', e));

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'pet.json'), 'utf8'));
  } catch {
    return {};
  }
}

function listPets() {
  if (!fs.existsSync(PETS_DIR)) return [];
  return fs
    .readdirSync(PETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => {
      const m = readManifest(path.join(PETS_DIR, d.name));
      return { id: d.name, name: m.name || d.name, weather: m.weather || [] };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function loadSprite(id) {
  const petDir = path.join(PETS_DIR, id || '');
  const manifest = id ? readManifest(petDir) : {};
  const frames = {};
  for (const action of id ? ACTIONS : []) {
    const dir = path.join(petDir, action);
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (files.length) frames[action] = files.map((f) => pathToFileURL(path.join(dir, f)).href);
  }
  const singlePath = path.join(petDir, manifest.image || 'pet.png');
  const single =
    id && Object.keys(frames).length === 0 && fs.existsSync(singlePath) ? pathToFileURL(singlePath).href : null;
  const actionImages = {};
  for (const [action, file] of Object.entries((single && manifest.images) || {})) {
    const p = path.join(petDir, file);
    if (ACTIONS.includes(action) && fs.existsSync(p)) actionImages[action] = pathToFileURL(p).href;
  }
  return {
    size: manifest.size || (single ? 120 : 96),
    fps: { idle: 4, walk: 8, sleep: 2, remind: 6, drag: 6, ...(manifest.fps || {}) },
    facing: manifest.facing === 'left' ? -1 : 1,
    flip: manifest.flip !== false,
    pixelArt: manifest.pixelArt ?? !single,
    frames,
    single,
    actionImages,
    props: manifest.props === true,
    theme: manifest.theme || null,
  };
}

// ---------- 设置 ----------

function loadSettings() {
  try {
    return { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    return settings;
  }
}

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

function resolvePetId(wanted) {
  const pets = listPets();
  if (pets.some((p) => p.id === wanted)) return wanted;
  return pets[0]?.id || null;
}

// 用户手动选的角色：记住，并立即显示
function switchPet(id) {
  settings.pet = id;
  saveSettings();
  showPet(id);
}

// 只换当前显示的角色，不改用户的选择（下雨临时换装用）
function showPet(id) {
  if (id === currentPetId) return;
  currentPetId = id;
  sprite = loadSprite(id);
  if (!petWin) return;
  const [oldW, oldH] = petWin.getSize();
  const W = Math.max(MIN_W, sprite.size);
  const H = BUBBLE_H + sprite.size;
  // 换角色时保持脚底中心位置不变
  pet.x += (oldW - W) / 2;
  pet.y += oldH - H;
  petWin.setBounds({ x: Math.round(pet.x), y: Math.round(pet.y), width: W, height: H });
  petWin.webContents.send('pet:config', sprite);
  sendState();
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('panel:theme', sprite.theme);
  if (pinWin && !pinWin.isDestroyed()) pinWin.webContents.send('pin:theme', sprite.theme);
}

// ---------- 天气（和风天气 QWeather）----------
// 降水相关天气代码：300-399 雨类，400-499 雪类
const isRainCode = (code) => code >= 300 && code < 400;

async function getJSON(url, timeoutMs = 10000, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeCity(city) {
  try {
    const q = encodeURIComponent(city);
    const data = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=zh`, 5000);
    const r = data.results?.[0];
    if (r) return { lat: r.latitude, lon: r.longitude };
  } catch {}
  try {
    const q = encodeURIComponent(city);
    const data = await getJSON(
      `https://${settings.qweatherHost}/geo/v2/city/lookup?location=${q}&number=1`,
      5000,
      { 'X-QW-Api-Key': settings.qweatherKey },
    );
    if (data.code === '200' && data.location?.length) {
      return { lat: Number(data.location[0].lat), lon: Number(data.location[0].lon) };
    }
  } catch {}
  throw new Error(`找不到城市：${city}`);
}

async function ensureCoords() {
  if (settings.coords && settings.coords.city === settings.city && settings.coords.lat) return settings.coords;
  if (settings.city) {
    const { lat, lon } = await geocodeCity(settings.city);
    settings.coords = { city: settings.city, lat, lon };
  } else {
    const data = await getJSON(`http://ip-api.com/json/?lang=zh-CN&fields=city,lat,lon,status`, 5000);
    if (data.status !== 'success') throw new Error('IP 定位失败');
    settings.city = data.city;
    settings.coords = { city: data.city, lat: data.lat, lon: data.lon };
  }
  saveSettings();
  return settings.coords;
}

function applyWeather(raining) {
  const changed = raining !== weather.raining;
  weather.raining = raining;
  weather.status = raining ? 'rain' : 'dry';
  weather.checkedAt = new Date();
  if (!changed || !settings.rainSwitch) return;
  if (raining) {
    const rainPets = listPets().filter((p) => p.weather.includes('rain'));
    if (!rainPets.length || rainPets.some((p) => p.id === currentPetId)) return;
    showPet(rainPets[Math.floor(Math.random() * rainPets.length)].id);
  } else {
    showPet(settings.pet);
  }
}

async function checkWeather(retries = 2) {
  if (!settings.rainSwitch || !settings.qweatherKey) return;
  for (let i = 0; i <= retries; i++) {
    try {
      const { lat, lon } = await ensureCoords();
      const data = await getJSON(
        `https://${settings.qweatherHost}/v7/weather/now?location=${lon},${lat}`,
        10000,
        { 'X-QW-Api-Key': settings.qweatherKey },
      );
      if (data.code !== '200') throw new Error(`天气查询失败(${data.code})`);
      const code = Number(data.now.icon);
      const precip = Number(data.now.precip || 0);
      weather.text = data.now.text;
      applyWeather(isRainCode(code) || precip > 0.1);
      return;
    } catch (err) {
      const reason = err.name === 'AbortError' ? '请求超时' : err.message;
      console.error(`[weather] attempt ${i + 1}/${retries + 1}:`, reason);
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      weather.status = 'error';
      weather.errorDetail = reason;
      weather.checkedAt = new Date();
    }
  }
}

function weatherLabel() {
  if (weather.status === 'error') {
    const detail = weather.errorDetail ? `(${weather.errorDetail})` : '';
    const t = weather.checkedAt ? `（${pad(weather.checkedAt.getHours())}:${pad(weather.checkedAt.getMinutes())}）` : '';
    return `天气：${settings.city || '未知'} · 获取失败${detail}${t}`;
  }
  if (weather.status === 'unknown') return `天气：${settings.city || '自动定位'} · 查询中`;
  const t = weather.checkedAt ? `（${pad(weather.checkedAt.getHours())}:${pad(weather.checkedAt.getMinutes())}）` : '';
  return `天气：${settings.city} · ${weather.text || (weather.raining ? '下雨' : '没下雨')}${t}`;
}

async function promptCity() {
  const { response, checkboxChecked } = await dialog.showMessageBox(petWin, {
    type: 'question',
    title: '设置城市',
    message: '输入城市名称，留空则自动定位',
    detail: `当前：${settings.city || '自动定位'}`,
    buttons: ['确定', '取消'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 1) return;
  const { response: inputResponse } = await dialog.showMessageBox(petWin, {
    type: 'question',
    title: '设置城市',
    message: '请在下方输入城市名（如：北京、上海、深圳）\n留空=自动定位',
    buttons: ['确定'],
  });
  // Electron 的 showMessageBox 没有输入框，用 BrowserWindow 做个简单输入
  return new Promise((resolve) => {
    const inputWin = new BrowserWindow({
      width: 320, height: 160, resizable: false, minimizable: false, maximizable: false,
      parent: petWin, modal: true, show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    inputWin.removeMenu();
    const currentCity = settings.city || '';
    inputWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:system-ui;padding:16px;margin:0;background:#f5f5f5}
input{width:100%;padding:6px;font-size:14px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
.btns{margin-top:12px;text-align:right}
button{padding:4px 16px;margin-left:8px;font-size:13px;border:1px solid #ccc;border-radius:4px;cursor:pointer}
button.primary{background:#4a90d9;color:#fff;border-color:#4a90d9}
p{margin:0 0 8px;font-size:13px;color:#666}
</style></head><body>
<p>输入城市名，留空则自动定位（当前：${currentCity || '自动定位'}）</p>
<input id="c" value="${currentCity}" placeholder="如：北京、上海、深圳" autofocus>
<div class="btns"><button onclick="close()">取消</button><button class="primary" onclick="ok()">确定</button></div>
<script>
const {ipcRenderer}=require('electron');
function ok(){ipcRenderer.send('city-input',document.getElementById('c').value.trim())}
function close(){window.close()}
document.getElementById('c').addEventListener('keydown',e=>{if(e.key==='Enter')ok();if(e.key==='Escape')close()});
</script></body></html>`)}`);
    inputWin.once('ready-to-show', () => inputWin.show());
    ipcMain.once('city-input', (_e, val) => {
      inputWin.close();
      resolve(val);
    });
    inputWin.once('closed', () => resolve(undefined));
  });
}

// ---------- 便利贴存储 ----------

function loadNotes() {
  if (!fs.existsSync(notesFile)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
    if (Array.isArray(data)) return data;
  } catch {}
  // 文件损坏时改名保留，否则下次保存会用空列表把它覆盖掉
  fs.renameSync(notesFile, `${notesFile}.broken-${Date.now()}`);
  return [];
}

function saveNotes() {
  const tmp = `${notesFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 2));
  fs.renameSync(tmp, notesFile);
}

function commitNotes() {
  saveNotes();
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('notes:changed', notes);
  sendBubble();
}

// ---------- 固定便利贴 ----------

let pinWin = null;
const pinnedIds = new Set();

function sendPinList() {
  if (!pinWin || pinWin.isDestroyed()) return;
  const list = notes.filter((n) => pinnedIds.has(n.id));
  pinWin.webContents.send('pin:list', list);
}

function ensurePinWin() {
  if (pinWin && !pinWin.isDestroyed()) { pinWin.show(); raisePetAbovePin(); return; }
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = 260, h = 300;
  pinWin = new BrowserWindow({
    width: w, height: h, x: sw - w - 20, y: 80,
    frame: false, transparent: true, alwaysOnTop: true, resizable: true,
    minimizable: false, maximizable: false, skipTaskbar: true,
    minWidth: 180, minHeight: 100,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  pinWin.setAlwaysOnTop(true, 'floating');
  pinWin.loadFile('pin.html');
  pinWin.webContents.once('did-finish-load', () => {
    sendPinList();
    pinWin.webContents.send('pin:theme', sprite.theme);
  });
  pinWin.on('blur', raisePetAbovePin);
  const win = pinWin;
  win.once('closed', () => { if (pinWin === win) pinWin = null; });
}

function raisePetAbovePin() {
  if (petWin && !petWin.isDestroyed()) petWin.moveTop();
}

function pinNote(id) {
  if (!notes.find((n) => n.id === id)) return;
  pinnedIds.add(id);
  ensurePinWin();
  sendPinList();
}

function unpinNote(id) {
  pinnedIds.delete(id);
  sendPinList();
  if (!pinnedIds.size && pinWin && !pinWin.isDestroyed()) pinWin.hide();
}

function updatePinnedNote(id) {
  if (pinnedIds.has(id)) sendPinList();
}

// ---------- 提醒 ----------

function dropFromQueue(id) {
  pet.remindQueue = pet.remindQueue.filter((x) => x !== id);
}

function checkReminders() {
  const now = Date.now();
  for (const n of notes) {
    const due = !n.done && !n.reminded && n.remindAt && Date.parse(n.remindAt) - 30 * 60000 <= now;
    if (due && !pet.remindQueue.includes(n.id)) {
      pet.remindQueue.push(n.id);
      if (Notification.isSupported()) {
        const diff = Math.round((Date.parse(n.remindAt) - now) / 60000);
        const title = diff > 0 ? `便利贴提醒（还有 ${diff} 分钟）` : '便利贴提醒（到时间了）';
        new Notification({ title, body: n.text || '(空便利贴)' }).show();
      }
    }
  }
  sendBubble();
}

// 气泡优先级：便利贴提醒 > 打卡提醒 > 打卡后的 +1 反馈
function currentBubble() {
  pet.remindQueue = pet.remindQueue.filter((id) => notes.some((n) => n.id === id));
  const note = notes.find((n) => n.id === pet.remindQueue[0]);
  if (note) {
    return {
      text: note.text || '(空便利贴)',
      more: pet.remindQueue.length - 1,
      actions: [
        { id: 'note-snooze', label: `${SNOOZE_MIN}分钟后再提醒` },
        { id: 'note-ack', label: '知道了', primary: true },
      ],
    };
  }
  const dueItem = checkins && checkins.item(checkins.due[0]);
  if (dueItem) {
    return {
      icon: dueItem.icon,
      text: dueItem.remindText || `该${dueItem.name}啦`,
      more: checkins.due.length - 1,
      actions: [
        { id: `checkin-later:${dueItem.id}`, label: '稍后' },
        { id: `checkin-do:${dueItem.id}`, label: '打卡', primary: true },
      ],
    };
  }
  if (pet.toast && pet.toast.until > Date.now()) {
    return { icon: pet.toast.icon, text: pet.toast.text, actions: [{ id: `checkin-undo:${pet.toast.eventId}`, label: '撤销' }] };
  }
  return null;
}

function needsAttention() {
  return pet.remindQueue.length > 0 || (checkins && checkins.due.length > 0);
}

function sendBubble() {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.webContents.send('pet:bubble', currentBubble());
  if (currentBubble()) raisePetAbovePin();
}

// ---------- 摸鱼打卡 ----------

function checkinSnapshot() {
  return { items: checkins.items, stats: checkins.stats() };
}

function broadcastCheckins() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('checkin:changed', checkinSnapshot());
}

function doCheckin(itemId) {
  const r = checkins.add(itemId);
  if (!r) return null;
  const it = checkins.item(itemId);
  const progress = it.goal ? `${r.count}/${it.goal}` : `今天第 ${r.count} 次`;
  pet.toast = { icon: it.icon, text: `+1 ${it.name}  ${progress}`, eventId: r.event.id, until: Date.now() + 4000 };
  pet.cheerUntil = Date.now() + 1200;
  clearTimeout(pet.toastTimer);
  pet.toastTimer = setTimeout(sendBubble, 4100);
  sendBubble();
  broadcastCheckins();
  return r.event.id;
}

function undoCheckin(eventId) {
  if (!checkins.undo(eventId)) return;
  if (pet.toast?.eventId === eventId) pet.toast = null;
  sendBubble();
  broadcastCheckins();
}

function checkinTick() {
  if (settings.checkinRemind === false) return;
  if (checkins.tick(10, powerMonitor.getSystemIdleTime())) sendBubble();
}

// ---------- 桌宠行为 ----------

function workArea() {
  try {
    const b = petWin.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      const wa = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }).workArea;
      if (wa && Number.isFinite(wa.x) && Number.isFinite(wa.width)) return wa;
    }
  } catch {}
  return screen.getPrimaryDisplay().workArea;
}

function sendState() {
  petWin.webContents.send('pet:state', { action: pet.action, facing: pet.facing });
}

function setAction(action) {
  if (pet.action === action) return;
  pet.action = action;
  sendState();
}

function place() {
  if (!Number.isFinite(pet.x) || !Number.isFinite(pet.y)) {
    const wa = screen.getPrimaryDisplay().workArea;
    pet.x = wa.x + wa.width / 2;
    pet.y = wa.y + wa.height - (BUBBLE_H + (sprite?.size || 100));
  }
  const x = Math.round(pet.x);
  const y = Math.round(pet.y);
  const [cx, cy] = petWin.getPosition();
  if (cx !== x || cy !== y) petWin.setPosition(x, y);
}

let lastIdleCheck = 0;

function tick() {
  if (!petWin || petWin.isDestroyed()) return;
  const now = Date.now();

  if (pet.dragging) {
    const c = screen.getCursorScreenPoint();
    pet.x = c.x - pet.dragOffset.x;
    pet.y = c.y - pet.dragOffset.y;
    const s = pet.dragStartCursor;
    if (Math.hypot(c.x - s.x, c.y - s.y) >= 4) setAction('drag');
    return place();
  }

  const [W, H] = petWin.getSize();
  const wa = workArea();
  const ground = wa.y + wa.height - H;
  // 窗口比角色宽，留出这段边距让角色本身能走到屏幕边缘
  const margin = (W - (sprite?.size || W)) / 2;
  const minX = wa.x - margin;
  const maxX = wa.x + wa.width - W + margin;

  if (now - lastIdleCheck > 1000) {
    lastIdleCheck = now;
    pet.asleep = powerMonitor.getSystemIdleTime() >= SLEEP_AFTER_SEC;
  }

  if (pet.y < ground) {
    pet.vy += GRAVITY;
    pet.y = Math.min(ground, pet.y + pet.vy);
    setAction('drag');
    return place();
  }
  pet.y = ground;
  pet.vy = 0;
  pet.x = clamp(pet.x, minX, maxX);

  const panelOpen = panelWin.isVisible();
  if (needsAttention() || pet.cheerUntil > now) {
    setAction('remind');
  } else if (pet.asleep) {
    setAction('sleep');
  } else if (pet.action === 'walk') {
    if (now > pet.walkUntil || panelOpen || pet.quiet) {
      setAction('idle');
      pet.nextDecisionAt = now + rand(3000, 8000);
    } else {
      pet.x += WALK_SPEED * pet.facing;
      if (pet.x <= minX || pet.x >= maxX) {
        pet.x = clamp(pet.x, minX, maxX);
        pet.facing *= -1;
        sendState();
      }
    }
  } else if (pet.action !== 'idle') {
    setAction('idle');
    pet.nextDecisionAt = now + rand(1000, 3000);
  } else if (now > pet.nextDecisionAt) {
    if (!pet.quiet && !panelOpen && Math.random() < 0.6) {
      pet.facing = Math.random() < 0.5 ? -1 : 1;
      pet.walkUntil = now + rand(2000, 6000);
      pet.action = 'walk';
      sendState();
    } else {
      pet.nextDecisionAt = now + rand(3000, 8000);
    }
  }
  place();
}

// ---------- 窗口 ----------

function createPetWindow() {
  const W = Math.max(MIN_W, sprite.size);
  const H = BUBBLE_H + sprite.size;
  const wa = screen.getPrimaryDisplay().workArea;
  pet.x = wa.x + wa.width - W - 40;
  pet.y = wa.y + wa.height - H;

  petWin = new BrowserWindow({
    width: W,
    height: H,
    x: pet.x,
    y: pet.y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    focusable: false,
    acceptFirstMouse: true,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  petWin.setAlwaysOnTop(true, 'floating');
  if (isMac) petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.setIgnoreMouseEvents(true, { forward: true });
  // Windows "显示桌面"会把它一起收起来，桌宠没有任务栏图标，收起后用户找不回来
  if (!isMac) petWin.on('minimize', () => petWin.restore());
  petWin.loadFile(path.join(__dirname, 'pet.html'));
}

function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  panelWin.setAlwaysOnTop(true, 'floating');
  if (isMac) panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWin.loadFile(path.join(__dirname, 'panel.html'));
  panelWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    hidePanel();
  });
}

function showPanel(newNote = false, tab = null) {
  // 清理空便利贴放在打开时而不是关闭时：关闭瞬间面板里可能还有没保存完的输入
  const before = notes.length;
  notes = notes.filter((n) => n.text.trim() || n.remindAt);
  if (notes.length !== before) commitNotes();

  const wa = workArea();
  const [W] = petWin.getSize();
  const x = clamp(pet.x + W / 2 - PANEL_W / 2, wa.x + 8, wa.x + wa.width - PANEL_W - 8);
  const y = Math.max(pet.y + BUBBLE_H - PANEL_H - 4, wa.y + 8);
  panelWin.setPosition(Math.round(x), Math.round(y));
  if (isMac) app.focus({ steal: true });
  panelWin.show();
  panelWin.focus();
  if (newNote) panelWin.webContents.send('panel:new-note');
  if (tab) panelWin.webContents.send('panel:tab', tab);
  broadcastCheckins();
}

let panelHiddenAt = 0;

function hidePanel() {
  if (!panelWin.isVisible()) return;
  panelWin.hide();
  panelHiddenAt = Date.now();
}

// ---------- IPC ----------

ipcMain.on('pet:ready', () => {
  petWin.webContents.send('pet:config', sprite);
  sendState();
  sendBubble();
});

ipcMain.on('pet:hover', (_, on) => {
  // Windows 走 pollCursor 主进程命中测试，不依赖渲染进程的 IPC 往返
  if (isMac && !pet.dragging) petWin.setIgnoreMouseEvents(!on, { forward: true });
});

// Windows 上浏览器在前台时 forward 转发的 mousemove 会整段丢失（0.1.3 用户视频：动画在跑但指针移上去没反应），
// 页面拿不到坐标就永远关不掉穿透；主进程自己问指针位置喂给页面，不依赖转发
let cursorInPet = false;
let cursorHit = false;
function pollCursor() {
  if (!petWin || petWin.isDestroyed() || !petWin.isVisible() || pet.dragging) return;
  const c = screen.getCursorScreenPoint();
  const b = petWin.getBounds();
  const inside = c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height;

  // 主进程直接做命中测试，省掉渲染进程 IPC 往返；
  // 解决 Windows 上浏览器前台时 forward 转发丢失导致无法点击/拖拽的问题
  let hit = false;
  if (inside) {
    const lx = c.x - b.x;
    const ly = c.y - b.y;
    const s = sprite?.size || 96;
    const spriteLeft = (b.width - s) / 2;
    const spriteTop = b.height - s;
    const onSprite = lx >= spriteLeft && lx < spriteLeft + s && ly >= spriteTop;
    const onBubble = !!currentBubble() && ly < spriteTop;
    hit = onSprite || onBubble;
  }
  if (hit !== cursorHit) {
    cursorHit = hit;
    petWin.setIgnoreMouseEvents(!hit, { forward: true });
  }

  if (!inside && !cursorInPet) return;
  cursorInPet = inside;
  petWin.webContents.send('pet:cursor', inside ? { x: c.x - b.x, y: c.y - b.y } : null);
}

ipcMain.on('pet:drag-start', () => {
  const c = screen.getCursorScreenPoint();
  pet.dragging = true;
  pet.dragStartCursor = c;
  pet.dragOffset = { x: c.x - pet.x, y: c.y - pet.y };
  pet.vy = 0;
});

ipcMain.on('pet:drag-end', () => {
  if (!pet.dragging) return;
  pet.dragging = false;
  const c = screen.getCursorScreenPoint();
  const s = pet.dragStartCursor;
  if (Math.hypot(c.x - s.x, c.y - s.y) < 4) {
    // 点桌宠时面板会先因失焦收起，这次点击就当作"关闭"，不要再打开
    if (panelWin.isVisible()) hidePanel();
    else if (Date.now() - panelHiddenAt > 400) showPanel();
  }
});

ipcMain.on('pet:context-menu', () => {
  const pets = listPets();
  const today = checkins.stats().today;
  Menu.buildFromTemplate([
    { label: '新建便利贴', click: () => showPanel(true) },
    { label: '打开便利贴', click: () => showPanel() },
    { type: 'separator' },
    {
      label: '摸鱼打卡',
      submenu: [
        ...checkins.items.map((it) => ({
          label: `${it.name}（${it.goal ? `${today[it.id]}/${it.goal}` : today[it.id]}）`,
          click: () => doCheckin(it.id),
        })),
        { type: 'separator' },
        { label: '查看统计…', click: () => showPanel(false, 'checkin') },
        {
          label: '定时提醒喝水 / 走动 / 站起来',
          type: 'checkbox',
          checked: settings.checkinRemind !== false,
          click: (item) => {
            settings.checkinRemind = item.checked;
            saveSettings();
            if (!item.checked) checkins.clearDue();
            sendBubble();
          },
        },
      ],
    },
    { type: 'separator' },
    {
      label: '切换角色',
      enabled: pets.length > 1,
      submenu: pets.map((p) => ({
        label: p.name,
        type: 'radio',
        checked: p.id === currentPetId,
        click: () => switchPet(p.id),
      })),
    },
    { type: 'separator' },
    { label: weatherLabel(), enabled: false },
    {
      label: '切换城市…',
      click: async () => {
        const city = await promptCity();
        if (city === undefined) return;
        settings.city = city;
        settings.coords = null;
        saveSettings();
        weather.status = 'unknown';
        checkWeather();
      },
    },
    {
      label: '下雨自动换成打伞的熊',
      type: 'checkbox',
      checked: settings.rainSwitch,
      click: (item) => {
        settings.rainSwitch = item.checked;
        saveSettings();
        if (item.checked) {
          weather.raining = false;
          checkWeather();
        } else {
          weather.status = 'unknown';
          showPet(settings.pet);
        }
      },
    },
    { type: 'separator' },
    {
      label: app.isPackaged ? '开机自动启动' : '开机自动启动（打包后可用）',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      label: '安静模式（不走动）',
      type: 'checkbox',
      checked: pet.quiet,
      click: (item) => {
        pet.quiet = item.checked;
        settings.quiet = item.checked;
        saveSettings();
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]).popup({ window: petWin });
});

ipcMain.on('pet:bubble-action', (_, action) => {
  const [kind, arg] = String(action).split(':');
  if (kind === 'note-ack' || kind === 'note-snooze') {
    const n = notes.find((x) => x.id === pet.remindQueue[0]);
    if (n && kind === 'note-ack') n.reminded = true;
    if (n && kind === 'note-snooze') n.remindAt = toLocalInput(new Date(Date.now() + SNOOZE_MIN * 60000));
    pet.remindQueue.shift();
    commitNotes();
  } else if (kind === 'checkin-do') {
    doCheckin(arg);
  } else if (kind === 'checkin-later') {
    checkins.later(arg);
    sendBubble();
  } else if (kind === 'checkin-undo') {
    undoCheckin(arg);
  }
});

ipcMain.handle('checkin:get', () => checkinSnapshot());
ipcMain.handle('checkin:do', (_, itemId) => doCheckin(itemId));
ipcMain.handle('checkin:undo', (_, eventId) => undoCheckin(eventId));
ipcMain.handle('checkin:updateItem', (_, itemId, changes) => {
  checkins.updateItem(itemId, changes);
  broadcastCheckins();
});

ipcMain.on('panel:close', hidePanel);

ipcMain.handle('notes:list', () => notes);

ipcMain.handle('panel:get-theme', () => sprite.theme);

ipcMain.handle('notes:add', () => {
  const note = {
    id: crypto.randomUUID(),
    text: '',
    remindAt: null,
    reminded: false,
    done: false,
    createdAt: new Date().toISOString(),
  };
  notes.unshift(note);
  commitNotes();
  return note;
});

ipcMain.handle('notes:update', (_, id, patch) => {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  if (typeof patch.text === 'string') n.text = patch.text;
  if ('remindAt' in patch) {
    n.remindAt = patch.remindAt || null;
    n.reminded = false;
    dropFromQueue(id);
  }
  if (typeof patch.done === 'boolean') {
    n.done = patch.done;
    if (n.done) dropFromQueue(id);
  }
  commitNotes();
  updatePinnedNote(id);
});

ipcMain.handle('notes:delete', (_, id) => {
  notes = notes.filter((x) => x.id !== id);
  dropFromQueue(id);
  unpinNote(id);
  commitNotes();
});

ipcMain.handle('notes:pin', (_, id) => pinNote(id));
ipcMain.handle('notes:unpin', (_, id) => unpinNote(id));
ipcMain.handle('notes:isPinned', (_, id) => pinnedIds.has(id));
ipcMain.on('pin:unpin', (_, id) => unpinNote(id));
ipcMain.on('pin:done', (_, id) => {
  const n = notes.find((x) => x.id === id);
  if (n) { n.done = true; dropFromQueue(id); commitNotes(); }
  unpinNote(id);
});
ipcMain.on('pin:hide', () => { if (pinWin && !pinWin.isDestroyed()) pinWin.hide(); });

// ---------- 启动 ----------

// 打包后 App 名字变了，数据目录也会跟着变；固定成 package.json 的 dataDir，便利贴和打卡记录才能沿用
const { dataDir } = require('./package.json');
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), dataDir || 'desk-pet'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (isMac) app.dock.hide();
    if (process.platform === 'win32') app.setAppUserModelId('com.deskpet.app');
    // macOS 没有 Edit 菜单时 Cmd+C/V 在输入框里不生效
    Menu.setApplicationMenu(
      isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null,
    );

    notesFile = path.join(app.getPath('userData'), 'notes.json');
    notes = loadNotes();
    checkins = createCheckins({
      configFile: path.join(__dirname, 'checkins.json'),
      overridesFile: path.join(app.getPath('userData'), 'checkin-config.json'),
      dataFile: path.join(app.getPath('userData'), 'checkins.json'),
    });
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    settings = loadSettings();
    settings.pet = resolvePetId(settings.pet);
    pet.quiet = settings.quiet;
    currentPetId = settings.pet;
    sprite = loadSprite(settings.pet);

    createPetWindow();
    createPanelWindow();
    setInterval(tick, TICK_MS);
    setInterval(checkReminders, 10000);
    setInterval(checkinTick, 10000);
    checkReminders();
    petWin.webContents.once('did-finish-load', checkWeather);
    setInterval(checkWeather, WEATHER_EVERY_MS);
    // 电脑睡眠唤醒后天气可能早变了，马上查一次
    powerMonitor.on('resume', () => {
      logEvent('power', 'resume');
      checkWeather();
      checkins.onResume();
    });
    for (const ev of ['suspend', 'lock-screen', 'unlock-screen']) powerMonitor.on(ev, () => logEvent('power', ev));
    screen.on('display-removed', (_e, d) => logEvent('display-removed', d.id));
    screen.on('display-added', (_e, d) => logEvent('display-added', d.id));
  });

  // Windows 的置顶只在设置那一刻生效，之后别的置顶窗口、锁屏回来、"显示桌面"都会把它压下去或收起来，
  // 所以定时抢回；置顶标志先关再开，因为同值重设会被直接忽略。面板最后抬，免得被桌宠窗口透明的气泡区域盖住
  function keepOnTop() {
    // 用户正在面板里操作时不动，否则日期选择这类弹层会被压到下面
    if (panelWin && !panelWin.isDestroyed() && panelWin.isFocused()) return;
    if (panelWin && !panelWin.isDestroyed() && panelWin.isMinimized()) {
      panelWin.restore();
      hidePanel();
    }
    for (const w of [pinWin, petWin, panelWin]) {
      if (!w || w.isDestroyed()) continue;
      if (w.isMinimized()) w.restore();
      if (!w.isVisible()) continue;
      w.setAlwaysOnTop(false);
      w.setAlwaysOnTop(true, 'floating');
      w.moveTop();
    }
  }

  if (!isMac) {
    app.whenReady().then(() => {
      setInterval(keepOnTop, 2000);
      setInterval(pollCursor, 50);
      powerMonitor.on('unlock-screen', keepOnTop);
      powerMonitor.on('resume', keepOnTop);
    });
  }

  crashReporter.start({ uploadToServer: false });
  logEvent('start', app.getVersion(), process.platform, process.getSystemVersion());

  app.on('child-process-gone', (_e, details) => logEvent('child-process-gone', details));

  // 页面进程挂了窗口还在但是透明空白，看起来就像桌宠没了；重新加载把它救回来
  app.on('render-process-gone', (_e, wc, details) => {
    logEvent('render-process-gone', details);
    if (quitting || details.reason === 'clean-exit') return;
    if (petWin && !petWin.isDestroyed() && wc === petWin.webContents) {
      petWin.reload();
      petWin.setIgnoreMouseEvents(true, { forward: true });
    } else if (panelWin && !panelWin.isDestroyed() && wc === panelWin.webContents) {
      panelWin.reload();
    } else if (pinWin && !pinWin.isDestroyed() && wc === pinWin.webContents) {
      pinWin.destroy();
      pinWin = null;
      if (pinnedIds.size) ensurePinWin();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    logEvent('before-quit');
  });
  app.on('window-all-closed', () => app.quit());
}
