// 편집기: 번호·텍스트·화살표·도형·형광펜·모자이크. 원본은 그대로 두고 편집본을 새로 저장한다.
const Editor = (() => {
  const $ = (id) => document.getElementById(id);
  const TOOLS = [
    ['select', 'V', '↖', '선택·이동'],
    ['crop', 'C', '✂', '자르기'],
    null,
    ['number', 'N', '①', '번호'],
    ['text', 'T', 'T', '텍스트'],
    ['arrow', 'A', '↗', '화살표'],
    ['rect', 'R', '□', '사각형'],
    ['ellipse', 'O', '◯', '원'],
    ['highlight', 'H', '▬', '형광펜'],
    ['pen', 'P', '✎', '펜'],
    ['mosaic', 'M', '▦', '모자이크'],
  ];
  const COLORS = ['#e9453a', '#ff9f0a', '#ffd60a', '#149e7f', '#2f6fed', '#151515', '#ffffff'];
  const SIZE = { s: 0.6, m: 1, l: 1.7 };
  const BOXY = ['rect', 'ellipse', 'highlight', 'mosaic'];

  let host = null; // { items(), toast(), addToReport(), kindLabel() }
  let item = null;
  let img = null;
  let shapes = [];
  let crop = null;
  let undo = [];
  let tool = 'number';
  let color = COLORS[0];
  let size = 'm';
  let selected = -1;
  let drag = null;
  let cropDraft = null;
  let textAt = null;
  let dirty = false;

  const canvas = $('edCanvas');
  const ctx = canvas.getContext('2d');
  const stage = $('edStage');
  const textEl = $('edText');

  const unit = () => Math.max(2, Math.round(Math.max(img.naturalWidth, img.naturalHeight) / 330));
  const view = () => crop || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const snapshot = () => JSON.stringify({ shapes, crop });
  function pushUndo() {
    undo.push(snapshot());
    if (undo.length > 80) undo.shift();
    dirty = true;
  }

  // ── 그리기 ──
  function fontOf(s) {
    return `700 ${Math.round(unit() * 7 * s.k)}px 'Pretendard','Malgun Gothic','Noto Sans KR',sans-serif`;
  }
  function bounds(s, c) {
    if (BOXY.includes(s.t)) return { x: s.x, y: s.y, w: s.w, h: s.h };
    if (s.t === 'number') {
      const r = unit() * 4.5 * s.k;
      return { x: s.x - r, y: s.y - r, w: r * 2, h: r * 2 };
    }
    if (s.t === 'text') {
      c.font = fontOf(s);
      const lines = s.text.split('\n');
      const lh = unit() * 7 * s.k * 1.25;
      return { x: s.x, y: s.y, w: Math.max(...lines.map((l) => c.measureText(l).width)), h: lh * lines.length };
    }
    const pts = s.t === 'arrow' ? [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] : s.pts;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  function drawShape(c, s) {
    const u = unit();
    const lw = u * s.k;
    c.lineWidth = lw;
    c.strokeStyle = c.fillStyle = s.color;
    c.lineCap = c.lineJoin = 'round';
    if (s.t === 'rect') {
      c.beginPath();
      c.roundRect(s.x, s.y, s.w, s.h, Math.min(lw * 1.5, s.w / 2, s.h / 2));
      c.stroke();
    } else if (s.t === 'ellipse') {
      c.beginPath();
      c.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
      c.stroke();
    } else if (s.t === 'highlight') {
      c.save();
      c.globalAlpha = 0.36;
      c.fillRect(s.x, s.y, s.w, s.h);
      c.restore();
    } else if (s.t === 'mosaic') {
      const W = img.naturalWidth, H = img.naturalHeight;
      const x = Math.max(0, Math.round(s.x)), y = Math.max(0, Math.round(s.y));
      const w = Math.min(W - x, Math.round(s.w)), h = Math.min(H - y, Math.round(s.h));
      if (w < 2 || h < 2) return;
      const block = Math.max(6, u * 3 * s.k);
      const tw = Math.max(1, Math.round(w / block)), th = Math.max(1, Math.round(h / block));
      const tmp = document.createElement('canvas');
      tmp.width = tw; tmp.height = th;
      tmp.getContext('2d').drawImage(img, x, y, w, h, 0, 0, tw, th);
      c.save();
      c.imageSmoothingEnabled = false;
      c.drawImage(tmp, 0, 0, tw, th, x, y, w, h);
      c.restore();
    } else if (s.t === 'arrow') {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      const head = Math.min(len * 0.6, lw * 5);
      c.beginPath();
      c.moveTo(s.x1, s.y1);
      c.lineTo(s.x2 - Math.cos(ang) * head * 0.7, s.y2 - Math.sin(ang) * head * 0.7);
      c.stroke();
      c.beginPath();
      c.moveTo(s.x2, s.y2);
      c.lineTo(s.x2 - head * Math.cos(ang - 0.42), s.y2 - head * Math.sin(ang - 0.42));
      c.lineTo(s.x2 - head * Math.cos(ang + 0.42), s.y2 - head * Math.sin(ang + 0.42));
      c.closePath();
      c.fill();
    } else if (s.t === 'pen') {
      c.beginPath();
      s.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      if (s.pts.length === 1) c.lineTo(s.pts[0].x + 0.1, s.pts[0].y);
      c.stroke();
    } else if (s.t === 'number') {
      const r = u * 4.5 * s.k;
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = Math.max(1.5, r * 0.14);
      c.strokeStyle = '#fff';
      c.stroke();
      c.fillStyle = s.color === '#ffffff' || s.color === '#ffd60a' ? '#151515' : '#fff';
      c.font = `800 ${Math.round(r * 1.15)}px 'Pretendard','Malgun Gothic',sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(s.n), s.x, s.y + r * 0.06);
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
    } else if (s.t === 'text') {
      c.font = fontOf(s);
      c.textBaseline = 'top';
      const lh = u * 7 * s.k * 1.25;
      s.text.split('\n').forEach((line, i) => {
        c.lineWidth = Math.max(2, u * 0.9 * s.k);
        c.strokeStyle = s.color === '#ffffff' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.9)';
        c.strokeText(line, s.x, s.y + i * lh + lh * 0.1);
        c.fillText(line, s.x, s.y + i * lh + lh * 0.1);
      });
      c.textBaseline = 'alphabetic';
    }
  }
  function paint(c, forExport) {
    const v = view();
    c.canvas.width = v.w;
    c.canvas.height = v.h;
    c.save();
    c.translate(-v.x, -v.y);
    c.drawImage(img, 0, 0);
    const list = drag && drag.shape ? [...shapes, drag.shape] : shapes;
    // 모자이크는 원본을 가리는 것이라 먼저 깐다
    for (const s of list) if (s.t === 'mosaic') drawShape(c, s);
    for (const s of list) if (s.t !== 'mosaic') drawShape(c, s);
    if (!forExport) {
      const px = v.w / (canvas.getBoundingClientRect().width || v.w);
      if (selected >= 0 && shapes[selected]) {
        const b = bounds(shapes[selected], c);
        const m = 4 * px;
        c.setLineDash([6 * px, 4 * px]);
        c.lineWidth = 1.5 * px;
        c.strokeStyle = '#17c49d';
        c.strokeRect(b.x - m, b.y - m, b.w + m * 2, b.h + m * 2);
        c.setLineDash([]);
      }
      if (cropDraft) {
        c.fillStyle = 'rgba(8,20,18,.55)';
        const d = cropDraft;
        c.fillRect(v.x, v.y, v.w, d.y - v.y);
        c.fillRect(v.x, d.y + d.h, v.w, v.y + v.h - d.y - d.h);
        c.fillRect(v.x, d.y, d.x - v.x, d.h);
        c.fillRect(d.x + d.w, d.y, v.x + v.w - d.x - d.w, d.h);
        c.lineWidth = 1.5 * px;
        c.strokeStyle = '#17c49d';
        c.strokeRect(d.x, d.y, d.w, d.h);
      }
    }
    c.restore();
  }
  function fit() {
    if (!img) return;
    const v = view();
    const r = Math.min((stage.clientWidth - 56) / v.w, (stage.clientHeight - 56) / v.h, 2);
    canvas.style.width = Math.max(40, Math.round(v.w * r)) + 'px';
    canvas.style.height = Math.max(40, Math.round(v.h * r)) + 'px';
  }
  function render() {
    if (!img) return;
    fit();
    paint(ctx, false);
    $('edSize').textContent = `${view().w} × ${view().h}px`;
  }

  // ── 마우스 ──
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    const v = view();
    return { x: ((e.clientX - r.left) * v.w) / r.width + v.x, y: ((e.clientY - r.top) * v.h) / r.height + v.y };
  }
  function norm(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }
  function hit(p) {
    const pad = unit() * 2;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const b = bounds(shapes[i], ctx);
      if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return i;
    }
    return -1;
  }
  function moveShape(s, dx, dy) {
    if (s.t === 'arrow') { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
    else if (s.t === 'pen') s.pts.forEach((p) => { p.x += dx; p.y += dy; });
    else { s.x += dx; s.y += dy; }
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !img) return;
    commitText();
    const p = pt(e);
    const base = { color, k: SIZE[size] };
    if (tool === 'select') {
      selected = hit(p);
      if (selected >= 0) drag = { mode: 'move', last: p, moved: false };
    } else if (tool === 'crop') {
      drag = { mode: 'crop', a: p };
    } else if (tool === 'number') {
      pushUndo();
      const n = Math.max(0, ...shapes.filter((s) => s.t === 'number').map((s) => s.n)) + 1;
      shapes.push({ t: 'number', x: p.x, y: p.y, n, ...base });
    } else if (tool === 'text') {
      e.preventDefault();
      startText(p, e);
    } else if (tool === 'arrow') {
      drag = { mode: 'draw', a: p, shape: { t: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...base } };
    } else if (tool === 'pen') {
      drag = { mode: 'draw', a: p, shape: { t: 'pen', pts: [p], ...base } };
    } else {
      drag = { mode: 'draw', a: p, shape: { t: tool, x: p.x, y: p.y, w: 0, h: 0, ...base } };
    }
    render();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag || !img) return;
    const p = pt(e);
    if (drag.mode === 'move') {
      if (!drag.moved) { pushUndo(); drag.moved = true; }
      moveShape(shapes[selected], p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    } else if (drag.mode === 'crop') {
      cropDraft = norm(drag.a, p);
    } else {
      const s = drag.shape;
      if (s.t === 'arrow') { s.x2 = p.x; s.y2 = p.y; }
      else if (s.t === 'pen') s.pts.push(p);
      else Object.assign(s, norm(drag.a, p));
    }
    render();
  });
  window.addEventListener('mouseup', () => {
    if (!drag || !img) return;
    const d = drag;
    drag = null;
    if (d.mode === 'crop') {
      const c = cropDraft;
      cropDraft = null;
      if (c && c.w > 8 && c.h > 8) {
        const v = view();
        const x = Math.max(v.x, Math.round(c.x)), y = Math.max(v.y, Math.round(c.y));
        const w = Math.min(v.x + v.w, Math.round(c.x + c.w)) - x, h = Math.min(v.y + v.h, Math.round(c.y + c.h)) - y;
        if (w > 8 && h > 8) { pushUndo(); crop = { x, y, w, h }; }
      }
    } else if (d.mode === 'draw') {
      const s = d.shape;
      const min = unit() * 1.5;
      const big = s.t === 'arrow' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > min : s.t === 'pen' ? true : s.w > min && s.h > min;
      if (big) { pushUndo(); shapes.push(s); }
    }
    render();
  });

  // ── 텍스트 입력 ──
  function startText(p, e) {
    const sr = stage.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const k = SIZE[size];
    const px = (unit() * 7 * k * cr.width) / view().w;
    textAt = { x: p.x, y: p.y, k, color };
    textEl.value = '';
    textEl.style.left = e.clientX - sr.left + 'px';
    textEl.style.top = e.clientY - sr.top + 'px';
    textEl.style.fontSize = px + 'px';
    textEl.style.color = color === '#ffffff' ? '#151515' : color;
    textEl.style.height = px * 1.25 + 'px';
    textEl.style.width = '160px';
    textEl.hidden = false;
    setTimeout(() => textEl.focus(), 0);
  }
  function commitText() {
    if (!textAt) return;
    const text = textEl.value.replace(/\s+$/, '');
    if (text) { pushUndo(); shapes.push({ t: 'text', x: textAt.x, y: textAt.y, text, color: textAt.color, k: textAt.k }); }
    textAt = null;
    textEl.hidden = true;
    render();
  }
  textEl.addEventListener('input', () => {
    const lines = textEl.value.split('\n');
    textEl.style.height = parseFloat(textEl.style.fontSize) * 1.25 * lines.length + 'px';
    textEl.style.width = Math.max(160, Math.max(...lines.map((l) => l.length)) * parseFloat(textEl.style.fontSize) * 1.05 + 20) + 'px';
  });
  textEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return; // 한글 조합 중 Enter 는 글자 확정
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
    else if (e.key === 'Escape') { textAt = null; textEl.hidden = true; }
  });
  textEl.addEventListener('blur', commitText);

  // ── 도구 막대 ──
  function buildTools() {
    const box = $('edTools');
    box.innerHTML = '';
    for (const t of TOOLS) {
      if (!t) { box.insertAdjacentHTML('beforeend', '<span class="sep"></span>'); continue; }
      const b = document.createElement('button');
      b.className = 't' + (t[0] === tool ? ' on' : '');
      b.textContent = t[2];
      b.title = `${t[3]} (${t[1]})`;
      b.onclick = () => setTool(t[0]);
      box.appendChild(b);
    }
    box.insertAdjacentHTML('beforeend', '<span class="sep"></span>');
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'sw' + (c === color ? ' on' : '');
      b.style.background = c;
      b.onclick = () => {
        color = c;
        if (selected >= 0 && shapes[selected]) { pushUndo(); shapes[selected].color = c; render(); }
        buildTools();
      };
      box.appendChild(b);
    }
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="s">가늘게</option><option value="m">보통</option><option value="l">굵게</option>';
    sel.value = size;
    sel.onchange = () => {
      size = sel.value;
      if (selected >= 0 && shapes[selected]) { pushUndo(); shapes[selected].k = SIZE[size]; render(); }
    };
    box.appendChild(sel);
    box.insertAdjacentHTML('beforeend', '<span class="sep"></span>');
    const u = document.createElement('button');
    u.className = 't';
    u.textContent = '↶';
    u.title = '되돌리기 (Ctrl+Z)';
    u.onclick = doUndo;
    box.appendChild(u);
  }
  function setTool(t) {
    commitText();
    tool = t;
    if (t !== 'select') selected = -1;
    canvas.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    buildTools();
    render();
  }
  function doUndo() {
    const s = undo.pop();
    if (!s) return;
    ({ shapes, crop } = JSON.parse(s));
    selected = -1;
    render();
  }

  // ── 열기 · 저장 ──
  function exportUrl() {
    const c = document.createElement('canvas');
    paint(c.getContext('2d'), true);
    return c.toDataURL('image/png');
  }
  function open(id) {
    const it = host.items().find((x) => x.id === id);
    if (!it) return;
    item = it;
    shapes = []; crop = null; undo = []; selected = -1; drag = null; cropDraft = null; dirty = false;
    textAt = null; textEl.hidden = true;
    $('editor').hidden = false;
    $('edKind').textContent = host.kindLabel(it) + (it.edited ? ' · 편집본' : '');
    $('edWhen').textContent = new Date(it.ts).toLocaleString('ko-KR');
    $('edClass').value = it.session || '';
    $('edMemo').value = it.memo || '';
    buildTools();
    canvas.style.cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { if (item === it) { img = im; render(); } };
    img = null;
    im.src = `gc://img/${it.id}`;
  }
  function close() {
    commitText();
    $('editor').hidden = true;
    item = null;
    img = null;
  }
  async function save() {
    if (!item || !img) return;
    commitText();
    if (!dirty) return host.toast('바뀐 내용이 없습니다 — 원본 그대로입니다');
    const r = await window.gc.invoke('item:saveEdit', item.id, exportUrl(), { memo: $('edMemo').value, session: $('edClass').value.trim() });
    if (r.error) return host.toast(r.error);
    host.toast(r.copied ? '편집본을 저장하고 클립보드에 복사했습니다' : '편집본을 저장했습니다');
    host.afterSave(r.id);
  }
  async function copy() {
    if (!item || !img) return;
    commitText();
    const r = await window.gc.invoke('copyDataUrl', exportUrl());
    host.toast(r.copied ? '클립보드에 복사했습니다' : '클립보드에 복사하지 못했습니다');
  }
  function step(d) {
    const list = host.items();
    const i = list.findIndex((x) => x.id === item.id);
    const next = list[i + d];
    if (next) open(next.id);
  }
  const saveMeta = () => item && window.gc.invoke('item:update', item.id, { memo: $('edMemo').value, session: $('edClass').value });

  function init(h) {
    host = h;
    $('edClose').onclick = close;
    $('edSave').onclick = save;
    $('edCopy').onclick = copy;
    $('edPrev').onclick = () => step(-1);
    $('edNext').onclick = () => step(1);
    $('edMemo').addEventListener('change', saveMeta);
    $('edClass').addEventListener('change', saveMeta);
    $('edReport').onclick = () => { saveMeta(); host.addToReport([item.id]); };
    $('edReveal').onclick = () => window.gc.invoke('item:reveal', item.id);
    $('edDelete').onclick = async () => {
      if (!confirm('이 사진을 휴지통으로 보낼까요?')) return;
      const id = item.id;
      close();
      await window.gc.invoke('item:delete', [id]);
    };
    window.addEventListener('resize', () => !$('editor').hidden && render());
  }

  // 편집기가 열려 있을 때의 키. 처리했으면 true.
  function onKey(e) {
    if ($('editor').hidden) return false;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyS') { e.preventDefault(); save(); return true; }
    if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return true; }
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); doUndo(); return true; }
    if (ctrl && e.code === 'KeyC') { e.preventDefault(); copy(); return true; }
    if (e.key === 'Escape') {
      if (selected >= 0) { selected = -1; render(); } else close();
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) {
      pushUndo();
      shapes.splice(selected, 1);
      selected = -1;
      render();
      return true;
    }
    if (!ctrl && !e.altKey) {
      const t = TOOLS.find((x) => x && 'Key' + x[1] === e.code);
      if (t) { e.preventDefault(); setTool(t[0]); return true; }
    }
    return true;
  }

  return { init, open, close, onKey, isOpen: () => !$('editor').hidden, TOOLS };
})();
