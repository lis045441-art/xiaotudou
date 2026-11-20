const list = document.getElementById('list');
const doneList = document.getElementById('done-list');
const doneWrap = document.getElementById('done-wrap');
const doneCount = document.getElementById('done-count');
doneWrap.addEventListener('toggle', autosizeAll);
const empty = document.getElementById('empty');

let allNotes = [];
const cards = new Map();
// 还没存下去的输入。面板失焦后输入框的 blur 事件不一定会触发，关闭时要主动存
const pendingSaves = new Map();

function autosize(ta) {
  // 折叠区或另一个标签页里的输入框没有渲染，量出来的高度是 0，等显示出来再算
  if (!ta.offsetParent) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function autosizeAll() {
  for (const ta of document.querySelectorAll('.card textarea')) autosize(ta);
}

function createCard(note) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <textarea rows="1" placeholder="写点什么…"></textarea>
    <div class="meta">
      <label><input type="checkbox" class="done" /> 完成</label>
      <span class="remind-box">
        <input type="datetime-local" class="remind" title="提醒时间" />
        <button class="clear" title="清除提醒时间">×</button>
      </span>
      <button class="pin-btn" title="固定到桌面">📌</button>
      <button class="del">删除</button>
    </div>`;
  const ta = card.querySelector('textarea');
  const done = card.querySelector('.done');
  const remind = card.querySelector('.remind');
  const id = note.id;

  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    pendingSaves.delete(id);
    window.notes.update(id, { text: ta.value });
  };
  ta.addEventListener('input', () => {
    autosize(ta);
    clearTimeout(saveTimer);
    pendingSaves.set(id, save);
    saveTimer = setTimeout(save, 400);
  });
  ta.addEventListener('blur', save);
  done.addEventListener('change', () => window.notes.update(id, { done: done.checked }));
  remind.addEventListener('change', () => {
    window.notes.update(id, { remindAt: remind.value || null });
    // 选完时间就交出焦点，之后点别处才能正常收起面板
    pickingTime = false;
    remind.blur();
  });
  card.querySelector('.clear').addEventListener('click', () => window.notes.update(id, { remindAt: null }));
  const pinBtn = card.querySelector('.pin-btn');
  pinBtn.addEventListener('click', async () => {
    const pinned = await window.notes.isPinned(id);
    if (pinned) {
      window.notes.unpin(id);
      pinBtn.classList.remove('pinned');
      pinBtn.title = '固定到桌面';
    } else {
      window.notes.pin(id);
      pinBtn.classList.add('pinned');
      pinBtn.title = '取消固定';
    }
  });
  card.querySelector('.del').addEventListener('click', () => {
    if (ta.value.trim() && !confirm('删除这条便利贴？')) return;
    window.notes.remove(id);
  });
  return card;
}

function fill(card, note) {
  const ta = card.querySelector('textarea');
  const remind = card.querySelector('.remind');
  if (document.activeElement !== ta && ta.value !== note.text) ta.value = note.text;
  if (document.activeElement !== remind) remind.value = note.remindAt || '';
  card.querySelector('.done').checked = note.done;
  card.querySelector('.clear').hidden = !note.remindAt;
  card.classList.toggle('fired', !!note.reminded);
  window.notes.isPinned(note.id).then(pinned => {
    const btn = card.querySelector('.pin-btn');
    btn.classList.toggle('pinned', pinned);
  });
  autosize(ta);
}

function syncList(container, items) {
  items.forEach((note, i) => {
    let card = cards.get(note.id);
    if (!card) {
      card = createCard(note);
      cards.set(note.id, card);
    }
    if (container.children[i] !== card) container.insertBefore(card, container.children[i] || null);
    fill(card, note);
  });
}

function render() {
  for (const [id, card] of cards) {
    if (!allNotes.some((n) => n.id === id)) {
      card.remove();
      cards.delete(id);
    }
  }
  const active = allNotes.filter((n) => !n.done);
  const done = allNotes.filter((n) => n.done);
  syncList(list, active);
  syncList(doneList, done);
  empty.hidden = allNotes.length > 0;
  doneWrap.hidden = done.length === 0;
  doneCount.textContent = `(${done.length})`;
}

async function addNote() {
  const note = await window.notes.add();
  allNotes = await window.notes.list();
  render();
  cards.get(note.id)?.querySelector('textarea').focus();
}

window.notes.onChanged((data) => {
  allNotes = data;
  render();
});
window.notes.onNewNote(addNote);
window.notes.onTheme(applyTheme);
window.notes.getTheme().then(applyTheme);

document.getElementById('add').addEventListener('click', addNote);

// 先 blur 触发未保存输入的提交，再关面板
function closePanel() {
  for (const save of [...pendingSaves.values()]) save();
  document.activeElement?.blur();
  window.notes.close();
}

// 点面板以外的地方就收起。稍等一下再确认焦点真的离开了（删除确认框弹出时会短暂失焦）
// 最近一次点击/聚焦的是不是提醒时间输入框：选择器弹出时焦点会转到选择器自己的小窗口，
// 那一刻输入框不一定还是 activeElement，所以单独记一下
let pickingTime = false;
const isRemind = (el) => !!el?.closest?.('.remind');
document.addEventListener('pointerdown', (e) => (pickingTime = isRemind(e.target)), true);
document.addEventListener('focusin', (e) => (pickingTime = isRemind(e.target)));
window.addEventListener('focus', () => {
  if (!isRemind(document.activeElement)) pickingTime = false;
});

window.addEventListener('blur', () => {
  if (pickingTime || isRemind(document.activeElement)) return;
  setTimeout(() => {
    if (!document.hasFocus()) closePanel();
  }, 150);
});

document.getElementById('close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

window.notes.list().then((data) => {
  allNotes = data;
  render();
});

// ---------- 标签页 ----------

const addBtn = document.getElementById('add');

function setTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  document.getElementById('view-notes').hidden = name !== 'notes';
  document.getElementById('view-checkin').hidden = name !== 'checkin';
  addBtn.hidden = name !== 'notes';
  if (name === 'notes') autosizeAll();
}

for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => setTab(t.dataset.tab));
window.notes.onTab(setTab);
window.notes.onNewNote(() => setTab('notes'));

// ---------- 摸鱼打卡 ----------

const ckGrid = document.getElementById('ck-grid');
const ckWeek = document.getElementById('ck-week');
const ckUndo = document.getElementById('ck-undo');
const ckUndoText = document.getElementById('ck-undo-text');
let ckData = null;
let lastEvent = null;
let undoTimer = null;

function renderCheckin() {
  if (!ckData) return;
  const { items, stats } = ckData;

  ckGrid.replaceChildren(
    ...items.map((it) => {
      const n = stats.today[it.id] || 0;
      const btn = document.createElement('button');
      btn.className = 'ck-btn';
      btn.dataset.id = it.id;
      btn.title = it.goal ? `今天目标 ${it.goal} 次` : it.name;
      btn.classList.toggle('met', !!it.goal && n >= it.goal);
      const icon = document.createElement('span');
      icon.className = 'ck-icon';
      icon.innerHTML = iconSvg(it.icon);
      const name = document.createElement('span');
      name.className = 'ck-name';
      name.textContent = it.short || it.name;
      const count = document.createElement('span');
      count.className = 'ck-count';
      count.textContent = it.goal ? `${n}/${it.goal}` : String(n);
      btn.append(icon, name, count);
      if (it.goal) {
        const bar = document.createElement('span');
        bar.className = 'ck-bar';
        bar.style.width = `${Math.min(100, (n / it.goal) * 100)}%`;
        btn.append(bar);
      }
      btn.addEventListener('click', () => doCheckin(it, btn));
      return btn;
    }),
  );

  const head = document.createElement('tr');
  head.append(document.createElement('th'));
  for (const d of stats.week) {
    const th = document.createElement('th');
    th.textContent = d.label;
    th.title = d.key;
    if (d.key === stats.todayKey) th.className = 'today';
    head.append(th);
  }
  const rows = items.map((it) => {
    const tr = document.createElement('tr');
    const label = document.createElement('td');
    label.className = 'label';
    label.innerHTML = iconSvg(it.icon, 'ic sm');
    label.append(` ${it.short || it.name}`);
    tr.append(label);
    // 颜色深浅：有目标按完成度，没目标按这 7 天里的最大值
    const max = it.goal || Math.max(1, ...stats.week.map((d) => d.counts[it.id] || 0));
    for (const d of stats.week) {
      const n = d.counts[it.id] || 0;
      const td = document.createElement('td');
      td.className = 'cell';
      td.textContent = n || '';
      td.title = `${d.key} ${it.name} ${n} 次`;
      td.style.setProperty('--lv', `${n ? 25 + Math.min(1, n / max) * 75 : 0}%`);
      tr.append(td);
    }
    return tr;
  });
  ckWeek.replaceChildren(head, ...rows);
}

async function doCheckin(it, btn) {
  const eventId = await window.checkin.do(it.id);
  if (!eventId) return;
  lastEvent = eventId;
  ckUndoText.textContent = `已打卡：${it.name}`;
  ckUndo.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => (ckUndo.hidden = true), 6000);
  const fresh = ckGrid.querySelector(`[data-id="${it.id}"]`) || btn;
  fresh.classList.remove('bump');
  void fresh.offsetWidth;
  fresh.classList.add('bump');
}

document.getElementById('ck-undo-btn').addEventListener('click', () => {
  if (lastEvent) window.checkin.undo(lastEvent);
  lastEvent = null;
  ckUndo.hidden = true;
});

// ---------- 提醒设置 ----------

const ckSettingsList = document.getElementById('ck-settings-list');

function renderSettings() {
  if (!ckData) return;
  const { items } = ckData;
  ckSettingsList.replaceChildren(
    ...items.map((it) => {
      const row = document.createElement('div');
      row.className = 'ck-setting-row';

      const name = document.createElement('span');
      name.className = 'ck-setting-name';
      name.innerHTML = iconSvg(it.icon, 'ic sm') + ` ${it.name}`;

      row.append(name);

      if (it.remindEvery !== undefined || it.goal !== undefined) {
        if (it.remindEvery !== undefined) {
          const field = document.createElement('span');
          field.className = 'ck-setting-field';
          const input = document.createElement('input');
          input.type = 'number';
          input.min = '0';
          input.max = '480';
          input.value = it.remindEvery || 0;
          input.title = '提醒间隔（分钟），0 = 不提醒';
          const unit = document.createElement('span');
          unit.className = 'unit';
          unit.textContent = '分钟';
          field.append(input, unit);
          row.append(field);

          let timer;
          input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              window.checkin.updateItem(it.id, { remindEvery: Number(input.value) || 0 });
            }, 600);
          });
        }

        if (it.goal !== undefined) {
          const field = document.createElement('span');
          field.className = 'ck-setting-field';
          const input = document.createElement('input');
          input.type = 'number';
          input.min = '0';
          input.max = '99';
          input.value = it.goal || 0;
          input.title = '每日目标次数，0 = 不设目标';
          const unit = document.createElement('span');
          unit.className = 'unit';
          unit.textContent = '次/天';
          field.append(input, unit);
          row.append(field);

          let timer;
          input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              window.checkin.updateItem(it.id, { goal: Number(input.value) || 0 });
            }, 600);
          });
        }
      } else {
        const hint = document.createElement('span');
        hint.className = 'unit';
        hint.textContent = '仅计数';
        row.append(hint);
      }

      return row;
    }),
  );
}

window.checkin.onChanged((data) => {
  ckData = data;
  renderCheckin();
});
window.checkin.get().then((data) => {
  ckData = data;
  renderCheckin();
  renderSettings();
});
