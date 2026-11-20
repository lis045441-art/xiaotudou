const canvas = document.getElementById('sprite');
const ctx = canvas.getContext('2d');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleMore = document.getElementById('bubble-more');
const bubbleActions = document.getElementById('bubble-actions');

let cfg = null;
let state = { action: 'idle', facing: 1 };
let frame = 0;
let timer = null;
const images = {};

// 往素材反方向走时镜像；pet.json 里 flip: false 的角色永远保持原图朝向
const isFlipped = () => cfg.flip !== false && state.facing !== cfg.facing;

let singleImg = null;
const actionImgs = {};

const loaded = (img) => img && img.complete && img.naturalWidth;

// 道具层（pet.json 里 props: true 才画）：提醒举牌、拎起挂环、走路速度线
function drawSign(w, h, sec) {
  const ink = cfg.theme?.ink || '#4a3726';
  const u = w / 10;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = u * 0.35;
  ctx.beginPath();
  ctx.moveTo(w * 0.4, -h * 0.3);
  ctx.lineTo(w * 0.45, -h * 1.0);
  ctx.stroke();
  const bw = u * 2.6;
  const bh = u * 2.2;
  const bx = w * 0.45 - bw / 2;
  const by = -h * 1.0 - bh;
  ctx.fillStyle = '#fff3a8';
  ctx.lineWidth = u * 0.3;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, u * 0.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `900 ${bh * 0.72}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', bx + bw / 2, by + bh * 0.54 + Math.sin(sec * 12) * u * 0.1);
  ctx.restore();
}

function drawHook(s, top) {
  const ink = cfg.theme?.ink || '#4a3726';
  const r = s * 0.035;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.018;
  ctx.setLineDash([s * 0.025, s * 0.025]);
  ctx.beginPath();
  ctx.moveTo(s / 2, top);
  ctx.lineTo(s / 2, s * 0.02 + r * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(s / 2, s * 0.02 + r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSpeedLines(s, w, h, sec) {
  // 画布被 CSS 镜像时，画布里的"后方"和屏幕上的方向相反
  const dir = isFlipped() ? -state.facing : state.facing;
  const back = s / 2 - (dir * w) / 2;
  ctx.save();
  ctx.strokeStyle = '#c9b49c';
  ctx.lineWidth = s * 0.022;
  ctx.lineCap = 'round';
  [0.25, 0.45, 0.65].forEach((fy, i) => {
    const len = s * (0.07 + 0.03 * ((i + 1) % 2));
    const off = s * 0.02 * Math.sin(sec * 10 + i);
    const x0 = back - dir * (s * 0.02 + off);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(sec * 8 + i * 2);
    ctx.beginPath();
    ctx.moveTo(x0, s - h * fy);
    ctx.lineTo(x0 - dir * len, s - h * fy);
    ctx.stroke();
  });
  ctx.restore();
}

// 单图模式：只有一张 PNG，用缩放/摇摆/跳动模拟各个动作
function drawSingle(t) {
  const s = cfg.size;
  ctx.clearRect(0, 0, s, s);
  const img = loaded(actionImgs[state.action]) ? actionImgs[state.action] : singleImg;
  if (!loaded(img)) return;
  // 图画到 80% 大小，四周留空间给摇摆和跳起；有道具时再缩小，给头顶的牌子和挂环留位置
  const base = s * (cfg.props ? 0.62 : 0.8);
  const k = Math.min(base / img.naturalWidth, base / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  const sec = t / 1000;

  ctx.save();
  ctx.imageSmoothingEnabled = !cfg.pixelArt;
  ctx.imageSmoothingQuality = 'high';
  if (state.action === 'drag') {
    if (cfg.props) drawHook(s, s - h);
    // 被拎起来时以头顶为支点晃
    ctx.translate(s / 2, s - h);
    ctx.rotate(Math.sin(sec * 5) * 0.18);
    ctx.scale(0.95, 1.06);
    ctx.drawImage(img, -w / 2, 0, w, h);
  } else {
    let sx = 1;
    let sy = 1;
    let rot = 0;
    let dy = 0;
    if (state.action === 'walk') {
      dy = -Math.abs(Math.sin(sec * 8)) * s * 0.05;
      rot = Math.sin(sec * 8) * 0.06;
    } else if (state.action === 'sleep') {
      sy = 0.94 + Math.sin(sec * 1.5) * 0.03;
      sx = 2 - sy;
      rot = 0.1;
    } else if (state.action === 'remind') {
      dy = -Math.abs(Math.sin(sec * 6)) * s * 0.12;
      rot = Math.sin(sec * 12) * 0.08;
    } else {
      sy = 1 + Math.sin(sec * 2.5) * 0.025;
      sx = 2 - sy;
    }
    // 以脚底中心为支点，压扁和摇摆时脚不离地
    ctx.translate(s / 2, s + dy);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -w / 2, -h, w, h);
    if (cfg.props && state.action === 'remind') drawSign(w, h, sec);
  }
  ctx.restore();
  if (cfg.props && state.action === 'walk') drawSpeedLines(s, w, h, sec);

  if (state.action === 'sleep') {
    const flipped = isFlipped();
    ctx.fillStyle = '#7a5a3a';
    ctx.font = `bold ${s * 0.12}px sans-serif`;
    for (let i = 0; i < 2; i++) {
      const p = (sec * 0.5 + i * 0.5) % 1;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.translate(s * (0.78 + p * 0.1), s * (0.3 - p * 0.2));
      // 画布整体被 CSS 镜像时，字母要再镜像一次才是正的
      if (flipped) ctx.scale(-1, 1);
      ctx.fillText('z', 0, 0);
      ctx.restore();
    }
  }
}

let lastDraw = 0;
let looping = false;
function singleLoop(t) {
  if (!cfg.single) {
    looping = false;
    return;
  }
  if (t - lastDraw >= 33) {
    lastDraw = t;
    drawSingle(t);
  }
  requestAnimationFrame(singleLoop);
}

function framesKey(action) {
  if (cfg.frames[action]) return action;
  if (cfg.frames.idle) return 'idle';
  return null;
}

function draw() {
  const s = cfg.size;
  ctx.clearRect(0, 0, s, s);
  const key = framesKey(state.action);
  if (!key) return drawPlaceholder(state.action, frame, s);
  const list = images[key];
  const img = list[frame % list.length];
  if (!img.complete || !img.naturalWidth) return;
  const k = Math.min(s / img.naturalWidth, s / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  ctx.imageSmoothingEnabled = !cfg.pixelArt;
  ctx.drawImage(img, (s - w) / 2, s - h, w, h);
}

// 没放素材时的占位角色：16x16 网格的小团子，朝右
function drawPlaceholder(action, f, s) {
  const u = s / 16;
  const px = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x * u, y * u, w * u, h * u);
  };
  const body = '#f2b880';
  const dark = '#4a3b2a';
  const blush = '#e8846b';

  if (action === 'sleep') {
    px(2, 9, 12, 7, body);
    px(3, 7, 2, 2, body);
    px(11, 7, 2, 2, body);
    px(6, 12, 2, 1, dark);
    px(10, 12, 2, 1, dark);
    ctx.fillStyle = dark;
    ctx.font = `bold ${4 * u}px sans-serif`;
    ctx.fillText('z', (12 + (f % 2)) * u, (6 - (f % 2)) * u);
    return;
  }

  if (action === 'drag') {
    px(4, 2, 8, 11, body);
    px(5, 0, 2, 2, body);
    px(9, 0, 2, 2, body);
    px(6, 5, 2, 2, dark);
    px(10, 5, 2, 2, dark);
    px(8, 9, 1, 1, dark);
    px(5, 13, 1, 2 + (f % 2), dark);
    px(10, 13, 1, 3 - (f % 2), dark);
    return;
  }

  const bob = action === 'walk' ? f % 2 : action === 'idle' && f % 4 === 0 ? 1 : 0;
  const top = 6 + bob;
  px(3, top, 10, 16 - top, body);
  px(4, top - 2, 2, 2, body);
  px(10, top - 2, 2, 2, body);
  px(6, top + 3, 1, 2, dark);
  px(11, top + 3, 1, 2, dark);
  px(5, top + 5, 1, 1, blush);
  px(12, top + 5, 1, 1, blush);

  if (action === 'walk') {
    px(f % 2 ? 4 : 10, 15, 2, 1, dark);
  }
  if (action === 'remind') {
    const up = f % 2;
    px(1, top + 1 - up * 2, 2, 4, body);
    px(13, top + 1 - (1 - up) * 2, 2, 4, body);
  }
}

function schedule() {
  clearTimeout(timer);
  const fps = cfg.fps[state.action] || 4;
  timer = setTimeout(() => {
    frame++;
    draw();
    schedule();
  }, 1000 / fps);
}

window.pet.onConfig((c) => {
  cfg = c;
  applyTheme(c.theme);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = c.size * dpr;
  canvas.height = c.size * dpr;
  canvas.style.width = `${c.size}px`;
  canvas.style.height = `${c.size}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.style.transform = isFlipped() ? 'scaleX(-1)' : '';
  clearTimeout(timer);
  for (const key of Object.keys(images)) delete images[key];
  for (const key of Object.keys(actionImgs)) delete actionImgs[key];
  if (c.single) {
    singleImg = new Image();
    singleImg.src = c.single;
    for (const [action, url] of Object.entries(c.actionImages || {})) {
      actionImgs[action] = new Image();
      actionImgs[action].src = url;
    }
    if (!looping) {
      looping = true;
      requestAnimationFrame(singleLoop);
    }
    return;
  }
  for (const [action, urls] of Object.entries(c.frames)) {
    images[action] = urls.map((url) => {
      const img = new Image();
      img.onload = draw;
      img.src = url;
      return img;
    });
  }
  draw();
  schedule();
});

window.pet.onState((s) => {
  const changed = s.action !== state.action;
  state = s;
  if (cfg) {
    canvas.style.transform = isFlipped() ? 'scaleX(-1)' : '';
    if (changed && !cfg.single) {
      frame = 0;
      draw();
      schedule();
    }
  }
});

window.pet.onBubble((b) => {
  bubble.hidden = !b;
  if (!b) return;
  bubbleText.textContent = b.text;
  if (b.icon) bubbleText.insertAdjacentHTML('afterbegin', `${iconSvg(b.icon, 'ic md')} `);
  bubbleMore.hidden = !b.more;
  bubbleMore.textContent = `还有 ${b.more} 条提醒`;
  bubbleActions.replaceChildren(
    ...(b.actions || []).map((a) => {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      if (a.primary) btn.className = 'primary';
      btn.addEventListener('click', () => window.pet.bubbleAction(a.id));
      return btn;
    }),
  );
});

// 窗口默认鼠标穿透，只有指针落在角色或气泡上时才接管点击
let lastHover = null;
let dragging = false;

function setHover(on) {
  if (on === lastHover) return;
  lastHover = on;
  window.pet.hover(on);
}

function hoverAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return !!(el && el.closest('.hit'));
}

function endDrag(e) {
  dragging = false;
  window.pet.dragEnd();
  lastHover = null;
  setHover(hoverAt(e.clientX, e.clientY));
}

document.addEventListener('mousemove', (e) => {
  if (dragging) {
    if (e.buttons === 0) endDrag(e);
    return;
  }
  setHover(hoverAt(e.clientX, e.clientY));
});

document.addEventListener('mouseleave', () => {
  if (!dragging) setHover(false);
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  window.pet.dragStart();
});

document.addEventListener('mouseup', (e) => {
  if (dragging) endDrag(e);
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.contextMenu();
});

window.pet.ready();
