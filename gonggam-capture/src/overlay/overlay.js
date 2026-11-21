// 멈춘 화면 위에서 영역을 고른다. 좌표는 모두 실제 픽셀(이미지 기준).
const view = document.getElementById('view');
const ctx = view.getContext('2d');
const sizeEl = document.getElementById('size');
const mag = document.getElementById('mag');
const magc = document.getElementById('magc');
const mctx = magc.getContext('2d');
const posEl = document.getElementById('pos');
const hexEl = document.getElementById('hex');
const swEl = document.getElementById('sw');

const pix = document.createElement('canvas'); // 색상 읽기용 원본
const pctx = pix.getContext('2d', { willReadFrequently: true });

let img = null;
let W = 0, H = 0;
let sel = null; // {x,y,w,h}
let lastRegion = null;
let drag = null; // {mode:'new'|'move'|'resize', ...}
let mouse = { x: 0, y: 0 };
let active = false;

const scale = () => W / window.innerWidth; // 화면 1px = 이미지 몇 px
const toImg = (e) => ({
  x: Math.max(0, Math.min(W - 1, Math.floor(e.clientX * scale()))),
  y: Math.max(0, Math.min(H - 1, Math.floor(e.clientY * (H / window.innerHeight)))),
});
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function handlePos(h) {
  const { x, y, w, h: hh } = sel;
  return {
    x: h.includes('w') ? x : h.includes('e') ? x + w : x + w / 2,
    y: h.includes('n') ? y : h.includes('s') ? y + hh : y + hh / 2,
  };
}
function hitHandle(p) {
  if (!sel) return null;
  const tol = 7 * scale();
  return HANDLES.find((h) => {
    const q = handlePos(h);
    return Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol;
  });
}
const inside = (p) => sel && p.x >= sel.x && p.x <= sel.x + sel.w && p.y >= sel.y && p.y <= sel.y + sel.h;

function clampSel() {
  if (!sel) return;
  sel.w = Math.max(1, Math.min(W, Math.round(sel.w)));
  sel.h = Math.max(1, Math.min(H, Math.round(sel.h)));
  sel.x = Math.max(0, Math.min(W - sel.w, Math.round(sel.x)));
  sel.y = Math.max(0, Math.min(H - sel.h, Math.round(sel.y)));
}

function draw() {
  if (!img) return;
  const s = scale();
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = 'rgba(8,20,18,.5)';
  if (!sel) {
    ctx.fillRect(0, 0, W, H);
  } else {
    const { x, y, w, h } = sel;
    ctx.fillRect(0, 0, W, y);
    ctx.fillRect(0, y + h, W, H - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, W - x - w, h);
    // 3등분 안내선
    ctx.strokeStyle = 'rgba(23,196,157,.35)';
    ctx.lineWidth = s;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + h);
      ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#17c49d';
    ctx.lineWidth = 1.5 * s;
    ctx.strokeRect(x, y, w, h);
    for (const hd of HANDLES) {
      const q = handlePos(hd);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
    }
  }
  // 크기 표시
  if (sel) {
    sizeEl.textContent = `${sel.w} × ${sel.h}`;
    sizeEl.style.display = 'block';
    const top = sel.y / s - 26;
    sizeEl.style.left = Math.max(4, sel.x / s) + 'px';
    sizeEl.style.top = (top < 4 ? sel.y / s + 6 : top) + 'px';
  } else sizeEl.style.display = 'none';
  drawMag();
}

function drawMag() {
  const N = 17, Z = 10; // 17×17 픽셀을 10배로
  const { x, y } = mouse;
  mctx.imageSmoothingEnabled = false;
  mctx.fillStyle = '#0f1f1d';
  mctx.fillRect(0, 0, 170, 170);
  mctx.drawImage(img, x - 8, y - 8, N, N, 0, 0, N * Z, N * Z);
  mctx.strokeStyle = 'rgba(255,255,255,.08)';
  mctx.lineWidth = 1;
  mctx.beginPath();
  for (let i = 1; i < N; i++) {
    mctx.moveTo(i * Z + 0.5, 0); mctx.lineTo(i * Z + 0.5, 170);
    mctx.moveTo(0, i * Z + 0.5); mctx.lineTo(170, i * Z + 0.5);
  }
  mctx.stroke();
  mctx.strokeStyle = '#17c49d';
  mctx.lineWidth = 2;
  mctx.strokeRect(8 * Z, 8 * Z, Z, Z);
  const d = pctx.getImageData(x, y, 1, 1).data;
  const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  posEl.textContent = `${x}, ${y}`;
  hexEl.textContent = hex;
  swEl.style.background = hex;
  // 커서 옆, 화면 밖으로 나가면 반대편
  const s = scale();
  let left = x / s + 26, top = y / s + 26;
  if (left + 180 > window.innerWidth) left = x / s - 196;
  if (top + 210 > window.innerHeight) top = y / s - 226;
  mag.style.left = left + 'px';
  mag.style.top = top + 'px';
  mag.style.display = 'block';
}

function setCursor(p) {
  const h = hitHandle(p);
  const map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  document.body.style.cursor = h ? map[h] : inside(p) ? 'move' : 'crosshair';
}

window.addEventListener('mousedown', (e) => {
  if (!active) return;
  if (e.button === 2) {
    // 오른쪽 버튼: 영역이 있으면 지우고, 없으면 취소
    if (sel) { sel = null; draw(); } else finish('cancel');
    return;
  }
  if (e.button !== 0) return;
  const p = toImg(e);
  const h = hitHandle(p);
  if (h) drag = { mode: 'resize', h, start: { ...sel } };
  else if (inside(p)) drag = { mode: 'move', ox: p.x - sel.x, oy: p.y - sel.y };
  else { drag = { mode: 'new', ax: p.x, ay: p.y }; sel = null; }
});
window.addEventListener('mousemove', (e) => {
  if (!active) return;
  const p = toImg(e);
  mouse = p;
  if (drag) {
    if (drag.mode === 'new') {
      const x = Math.min(drag.ax, p.x), y = Math.min(drag.ay, p.y);
      const w = Math.abs(p.x - drag.ax) + 1, h = Math.abs(p.y - drag.ay) + 1;
      sel = w > 2 || h > 2 ? { x, y, w, h } : null;
    } else if (drag.mode === 'move') {
      sel.x = p.x - drag.ox; sel.y = p.y - drag.oy;
      clampSel();
    } else {
      const s = drag.start;
      let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
      if (drag.h.includes('w')) x1 = p.x;
      if (drag.h.includes('e')) x2 = p.x + 1;
      if (drag.h.includes('n')) y1 = p.y;
      if (drag.h.includes('s')) y2 = p.y + 1;
      sel = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) };
    }
  } else setCursor(p);
  draw();
});
window.addEventListener('mouseup', () => {
  if (drag && sel) clampSel();
  drag = null;
  draw();
});
window.addEventListener('dblclick', (e) => {
  if (active && inside(toImg(e))) finish('copy');
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (!active) return;
  const k = e.key;
  if (k === 'Escape') return finish('cancel');
  if (k === 'Enter' || k === ' ') return sel && finish('copy');
  const lower = k.toLowerCase();
  // 한글 입력 상태에서도 되도록 물리 키(code)도 본다
  const code = e.code;
  if (lower === 'e' || code === 'KeyE') return sel && finish('edit');
  if (lower === 'b' || code === 'KeyB') return sel && finish('report');
  if (lower === 'f' || code === 'KeyF') { sel = { x: 0, y: 0, w: W, h: H }; return draw(); }
  if (lower === 'l' || code === 'KeyL') {
    if (lastRegion) { sel = { x: lastRegion.x, y: lastRegion.y, w: lastRegion.width, h: lastRegion.height }; clampSel(); draw(); }
    return;
  }
  if (k.startsWith('Arrow') && sel) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
    const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
    if (e.ctrlKey) { sel.w += dx; sel.h += dy; } // Ctrl+방향키: 크기 조정
    else { sel.x += dx; sel.y += dy; }
    clampSel();
    draw();
  }
});

function finish(action) {
  if (!active) return;
  active = false;
  const rect = sel ? { x: sel.x, y: sel.y, width: sel.w, height: sel.h } : null;
  // 다음에 뜰 때 이전 화면이 번쩍이지 않게 비운다
  ctx.clearRect(0, 0, view.width, view.height);
  mag.style.display = 'none';
  sizeEl.style.display = 'none';
  img = null;
  sel = null;
  drag = null;
  requestAnimationFrame(() => window.gc.send('overlay:done', { action: rect ? action : 'cancel', rect }));
}

window.gc.on('overlay:shot', (info) => {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    img = im;
    W = im.naturalWidth; H = im.naturalHeight;
    view.width = W; view.height = H;
    pix.width = W; pix.height = H;
    pctx.drawImage(im, 0, 0);
    sel = null;
    drag = null;
    lastRegion = info.last;
    mouse = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
    active = true;
    ctx.drawImage(im, 0, 0);
    ctx.fillStyle = 'rgba(8,20,18,.5)';
    ctx.fillRect(0, 0, W, H);
    requestAnimationFrame(() => window.gc.send('overlay:ready'));
  };
  im.onerror = () => window.gc.send('overlay:done', { action: 'cancel' });
  im.src = `gc://shot/${info.n}`;
});
