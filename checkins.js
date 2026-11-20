const fs = require('fs');
const crypto = require('crypto');

const IDLE_PAUSE_SEC = 300;
const KEEP_DAYS = 60;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const EDITABLE = ['remindEvery', 'goal'];

// configFile 打包后在只读的 app.asar 里，只当默认值；用户改过的字段单独存 overridesFile，
// 只存差异是为了新版本加的打卡项老用户也能看到
function createCheckins({ configFile, overridesFile, dataFile }) {
  const config = { remindHours: [9, 21], snoozeMin: 10, items: [], ...readJSON(configFile, {}) };
  const items = config.items;
  let overrides = readJSON(overridesFile, {});
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) overrides = {};
  for (const it of items) {
    const o = overrides[it.id];
    if (!o) continue;
    for (const key of EDITABLE) if (key in o) it[key] = o[key] || undefined;
  }
  let events = readJSON(dataFile, []);
  if (!Array.isArray(events)) events = [];
  // 距上次打卡累计的"在用电脑"秒数；闲置时不累计
  const active = {};
  const due = [];

  function save() {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    events = events.filter((e) => Date.parse(e.at) >= cutoff);
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(events, null, 2));
    fs.renameSync(tmp, dataFile);
  }

  const item = (id) => items.find((i) => i.id === id);

  function countOn(itemId, key) {
    return events.filter((e) => e.item === itemId && dayKey(new Date(e.at)) === key).length;
  }

  function stats(now = new Date()) {
    const today = dayKey(now);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = dayKey(d);
      const counts = {};
      for (const it of items) counts[it.id] = countOn(it.id, key);
      week.push({ key, label: i === 0 ? '今' : WEEKDAYS[d.getDay()], counts });
    }
    return { today: week[6].counts, week, todayKey: today };
  }

  function add(itemId, now = new Date()) {
    if (!item(itemId)) return null;
    const ev = { id: crypto.randomUUID(), item: itemId, at: now.toISOString() };
    events.push(ev);
    save();
    active[itemId] = 0;
    const i = due.indexOf(itemId);
    if (i >= 0) due.splice(i, 1);
    return { event: ev, count: countOn(itemId, dayKey(now)) };
  }

  function undo(eventId) {
    const before = events.length;
    events = events.filter((e) => e.id !== eventId);
    if (events.length !== before) save();
    return events.length !== before;
  }

  function later(itemId) {
    const it = item(itemId);
    const i = due.indexOf(itemId);
    if (i >= 0) due.splice(i, 1);
    if (it?.remindEvery) active[itemId] = Math.max(0, it.remindEvery * 60 - config.snoozeMin * 60);
  }

  // 返回是否有新的提醒冒出来
  function tick(stepSec, idleSec, now = new Date()) {
    if (idleSec >= IDLE_PAUSE_SEC) return false;
    const h = now.getHours();
    const inHours = h >= config.remindHours[0] && h < config.remindHours[1];
    let fresh = false;
    for (const it of items) {
      if (!it.remindEvery) continue;
      active[it.id] = (active[it.id] || 0) + stepSec;
      if (inHours && active[it.id] >= it.remindEvery * 60 && !due.includes(it.id)) {
        due.push(it.id);
        fresh = true;
      }
    }
    return fresh;
  }

  function clearDue() {
    due.length = 0;
  }

  function updateItem(itemId, changes) {
    const it = item(itemId);
    if (!it) return false;
    const o = (overrides[itemId] ||= {});
    for (const key of EDITABLE) {
      if (changes[key] === undefined) continue;
      it[key] = changes[key] || undefined;
      o[key] = changes[key] || null;
    }
    const tmp = `${overridesFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(overrides, null, 2));
    fs.renameSync(tmp, overridesFile);
    return true;
  }

  function onResume() {
    let delay = 0;
    for (const it of items) {
      if (it.remindEvery) {
        active[it.id] = it.remindEvery * 60 - delay;
        delay += 90;
      }
    }
  }

  return { items, item, due, stats, add, undo, later, tick, clearDue, updateItem, onResume, _active: active };
}

module.exports = { createCheckins };
