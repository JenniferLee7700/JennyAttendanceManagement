// 공감캡처 본 화면: 라이브러리 · 수업 세션 · 폰 · 보고서 · 설정
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = window.gc;

const S = {
  items: [],
  settings: { shortcuts: {}, recentClasses: [] },
  session: { active: false },
  failedShortcuts: [],
  view: 'library',
  q: '',
  src: '',
  cls: '',
  selected: new Set(),
  anchor: null,
  report: null,
};
const SRC_LABEL = { screen: '화면', phone: '폰', import: '가져옴' };
const KIND_LABEL = { screen: '화면 캡처', phone: '폰 사진', import: '가져온 사진' };
const SC_LABEL = {
  region: '영역 캡처', last: '직전 영역 다시', full: '전체 화면',
  edit: '마지막 캡처 편집', session: '수업 세션 시작/종료', phone: '폰 연결(QR)',
};
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

// ───────── 화면 전환 ─────────
function nav(view) {
  S.view = view;
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('on', b.dataset.view === view);
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'v-' + view;
  if (view === 'phone') loadPhone();
  if (view === 'report') renderReport();
  if (view === 'session') { renderSession(); if (!S.session.active) setTimeout(() => $('sName').focus(), 50); }
  if (view === 'settings') renderSettings();
}

function renderChrome() {
  const sc = S.settings.shortcuts;
  for (const el of document.querySelectorAll('[data-sc]')) el.textContent = sc[el.dataset.sc] || '';
  $('live').hidden = !S.session.active;
  if (S.session.active) $('liveText').textContent = `수업 중 · ${S.session.name} · ${S.session.count}장`;
  const classes = allClasses();
  $('classList').innerHTML = classes.map((c) => `<option value="${esc(c)}">`).join('');
  const sel = $('classFilter');
  sel.innerHTML = '<option value="">모든 반</option>' + classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (!classes.includes(S.cls)) S.cls = '';
  sel.value = S.cls;
}
function allClasses() {
  const set = new Set(S.settings.recentClasses || []);
  for (const it of S.items) if (it.session) set.add(it.session);
  return [...set];
}

// ───────── 라이브러리 ─────────
function visibleItems() {
  const q = S.q.trim().toLowerCase();
  return S.items.filter(
    (it) =>
      (!S.src || it.source === S.src) &&
      (!S.cls || it.session === S.cls) &&
      (!q || (it.session || '').toLowerCase().includes(q) || (it.memo || '').toLowerCase().includes(q))
  );
}
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 864e5);
  if (ymd(d) === ymd(today)) return '오늘';
  if (ymd(d) === ymd(yest)) return '어제';
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${'일월화수목금토'[d.getDay()]})`;
}
function renderLibrary() {
  const list = visibleItems();
  const grid = $('grid');
  // 없어진 사진은 선택에서도 뺀다
  for (const id of [...S.selected]) if (!S.items.some((it) => it.id === id)) S.selected.delete(id);
  if (!list.length) {
    const sc = S.settings.shortcuts;
    grid.innerHTML = S.items.length
      ? '<div class="empty"><b>조건에 맞는 사진이 없습니다</b>검색어나 필터를 바꿔 보세요.</div>'
      : `<div class="empty"><b>아직 캡처가 없습니다</b><kbd>${esc(sc.region)}</kbd> 로 화면을 잘라 보세요.<br>왼쪽 위 「영역 캡처」 버튼으로도 시작할 수 있습니다.</div>`;
  } else {
    const groups = [];
    for (const it of list) {
      const key = ymd(new Date(it.ts));
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, label: dayLabel(it.ts), items: [] });
      groups[groups.length - 1].items.push(it);
    }
    grid.innerHTML = groups
      .map(
        (g) =>
          `<div class="day">${esc(g.label)} <span>${g.items.length}장</span></div><div class="cards">${g.items.map(cardHtml).join('')}</div>`
      )
      .join('');
  }
  grid.classList.toggle('selecting', S.selected.size > 0);
  $('selbar').hidden = S.selected.size === 0;
  $('selCount').textContent = `${S.selected.size}장 선택`;
}
function cardHtml(it) {
  const d = new Date(it.ts);
  return `<div class="card${S.selected.has(it.id) ? ' sel' : ''}" data-id="${it.id}">
<div class="th"><img loading="lazy" src="gc://thumb/${it.id}" alt=""></div>
<span class="chk" data-act="check">✓</span>
<div class="acts"><button data-act="copy">복사</button><button data-act="report">+보고서</button></div>
<div class="mt"><div class="tags"><span class="tag ${it.source}">${SRC_LABEL[it.source] || '화면'}</span>${
    it.session ? `<span class="tag cls">${esc(it.session)}</span>` : ''
  }${it.edited ? '<span class="tag auto">편집</span>' : it.auto ? '<span class="tag auto">자동</span>' : ''}<time>${pad(d.getHours())}:${pad(d.getMinutes())}</time></div>
<div class="memo">${esc(it.memo || '')}</div></div></div>`;
}
function toggleSelect(id, range) {
  const list = visibleItems().map((it) => it.id);
  if (range && S.anchor && list.includes(S.anchor)) {
    const [a, b] = [list.indexOf(S.anchor), list.indexOf(id)].sort((x, y) => x - y);
    for (let i = a; i <= b; i++) S.selected.add(list[i]);
  } else {
    if (S.selected.has(id)) S.selected.delete(id);
    else S.selected.add(id);
    S.anchor = id;
  }
  renderLibrary();
}
async function deleteSelected() {
  const ids = [...S.selected];
  if (!ids.length || !confirm(`${ids.length}장을 휴지통으로 보낼까요?`)) return;
  S.selected.clear();
  await api.invoke('item:delete', ids);
}

// ───────── 수업 세션 ─────────
function renderSession() {
  const s = S.session;
  $('sChips').innerHTML = (S.settings.recentClasses || []).map((c) => `<button>${esc(c)}</button>`).join('');
  $('sName').disabled = $('sAuto').disabled = $('sInterval').disabled = s.active;
  if (s.active) {
    $('sName').value = s.name;
    $('sAuto').checked = s.auto;
    $('sInterval').value = String(s.interval);
  }
  $('sIntervalRow').style.opacity = $('sAuto').checked ? 1 : 0.45;
  const t = $('sToggle');
  t.textContent = s.active ? '수업 종료' : '수업 시작';
  t.classList.toggle('stop', !!s.active);
  t.classList.toggle('primary', !s.active);
  const started = new Date(s.startedAt || 0);
  $('sStatus').textContent = s.active
    ? `${pad(started.getHours())}:${pad(started.getMinutes())} 시작 · ${s.count}장${s.auto ? ' · 자동 캡처 켜짐' : ''}`
    : '';
}
async function toggleSession() {
  if (S.session.active) return api.invoke('session:stop');
  const r = await api.invoke('session:start', { name: $('sName').value, auto: $('sAuto').checked, interval: Number($('sInterval').value) });
  if (r.error) { toast(r.error); $('sName').focus(); } else toast('수업 세션을 시작했습니다');
}

// ───────── 폰 ─────────
let phoneUrl = '';
async function loadPhone() {
  const r = await api.invoke('phone:info');
  if (!r.ok) {
    $('qr').textContent = '네트워크에 연결되어 있지 않습니다. 와이파이를 확인해 주세요.';
    $('phoneUrl').textContent = '';
    phoneUrl = '';
    return;
  }
  $('qr').innerHTML = r.qr; // 메인 프로세스가 만든 QR SVG
  $('phoneUrl').textContent = r.url;
  phoneUrl = r.url;
}

// ───────── 보고서 ─────────
function newReport() {
  return {
    academy: S.settings.academy || '', teacher: S.settings.teacher || '',
    className: S.session.active ? S.session.name : '', date: ymd(new Date()),
    title: '수업 보고서', content: '', homework: '', layout: 2, photos: [],
  };
}
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => api.invoke('report:saveDraft', S.report), 300);
}
function addToReport(ids) {
  const r = S.report;
  let added = 0;
  // 찍은 순서대로 넣는다
  const ordered = S.items.filter((it) => ids.includes(it.id)).sort((a, b) => a.ts - b.ts);
  for (const it of ordered) {
    if (r.photos.some((p) => p.id === it.id)) continue;
    r.photos.push({ id: it.id, caption: it.memo || '' });
    if (!r.className && it.session) r.className = it.session;
    added++;
  }
  saveDraft();
  renderReportBadge();
  if (S.view === 'report') renderReport();
  toast(added ? `보고서에 ${added}장 담았습니다` : '이미 보고서에 있는 사진입니다');
}
function renderReportBadge() {
  const n = S.report.photos.length;
  $('reportBadge').hidden = !n;
  $('reportBadge').textContent = n;
}
const R_FIELDS = { rAcademy: 'academy', rTeacher: 'teacher', rClass: 'className', rDate: 'date', rTitle: 'title', rContent: 'content', rHomework: 'homework' };
function renderReport() {
  const r = S.report;
  r.photos = r.photos.filter((p) => S.items.some((it) => it.id === p.id));
  for (const [id, key] of Object.entries(R_FIELDS)) if (document.activeElement !== $(id)) $(id).value = r[key] || '';
  for (const b of $('rLayout').children) b.classList.toggle('on', Number(b.dataset.l) === r.layout);
  $('rCount').textContent = r.photos.length ? `${r.photos.length}장 · ↑↓ 로 순서 변경` : '';
  $('rPhotos').innerHTML = r.photos.length
    ? r.photos
        .map(
          (p, i) => `<div class="rphoto" data-i="${i}"><img src="gc://thumb/${p.id}" alt="">
<textarea placeholder="사진 설명">${esc(p.caption)}</textarea>
<div class="ord"><button data-o="up" title="위로">↑</button><button data-o="down" title="아래로">↓</button><button data-o="del" title="빼기">✕</button></div></div>`
        )
        .join('')
    : '<div class="rempty">아직 사진이 없습니다.<br>라이브러리에서 사진을 골라 「보고서로 보내기」를 누르세요.</div>';
  renderReportBadge();
  renderPreview();
}
let sheetRoot;
function renderPreview() {
  const sheet = $('rSheet');
  if (!sheetRoot) sheetRoot = sheet.attachShadow({ mode: 'open' });
  sheetRoot.innerHTML = `<style>${ReportHTML.CSS}</style>` + ReportHTML.body({ ...S.report, imgSrc: (id) => `gc://img/${id}` });
  // A4 폭(210mm)을 미리보기 칸에 맞춰 줄인다
  const box = sheet.parentElement;
  sheet.style.zoom = 1;
  const z = Math.min(1, (box.clientWidth - 28) / sheet.offsetWidth);
  sheet.style.zoom = z > 0 ? z : 1;
}
async function savePdf() {
  if (!S.report.photos.length && !S.report.content) return toast('수업 내용이나 사진을 먼저 넣어 주세요');
  $('rPdf').disabled = true;
  const r = await api.invoke('report:pdf', S.report);
  $('rPdf').disabled = false;
  if (r.error) toast('PDF 저장 실패 — ' + r.error);
  else if (!r.canceled) toast('PDF 로 저장했습니다');
}

// ───────── 설정 ─────────
function renderSettings() {
  const st = S.settings;
  if (document.activeElement !== $('setAcademy')) $('setAcademy').value = st.academy || '';
  if (document.activeElement !== $('setTeacher')) $('setTeacher').value = st.teacher || '';
  $('setDir').value = st.saveRoot || '';
  $('setNotify').checked = st.notify !== false;
  $('setAuto').checked = !!st.autoStart;
  $('setKeys').innerHTML = Object.keys(SC_LABEL)
    .map(
      (k) => `<div class="keyrow"><span>${SC_LABEL[k]}</span>${
        S.failedShortcuts.includes(k) ? '<em class="bad">다른 프로그램이 쓰는 중</em>' : ''
      }<input readonly data-k="${k}" value="${esc(st.shortcuts[k] || '')}"></div>`
    )
    .join('');
}
function acceleratorOf(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key = '';
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (/^Numpad\d$/.test(c)) key = 'num' + c.slice(6);
  else key = { PrintScreen: 'PrintScreen', Space: 'Space', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Backquote: '`' }[c] || '';
  if (!key) return null;
  // 글자·숫자 한 키만으로는 전역 단축키를 걸지 않는다 (타자가 막힌다)
  if (!mods.length && !/^F\d|PrintScreen|Insert/.test(key)) return null;
  return [...mods, key].join('+');
}

// ───────── 단축키 안내 ─────────
function showKeys() {
  const sc = S.settings.shortcuts;
  const rows = (list) => `<div class="kgrid">${list.map(([k, v]) => `<div><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}</div>`;
  $('keysBox').innerHTML = `<h2>단축키 한눈에</h2><div class="hint">앱 어디서나 ? 를 누르면 뜹니다. Esc 로 닫습니다.</div>
<h3>전역 단축키 — 설정에서 바꿀 수 있습니다</h3>${rows(Object.keys(SC_LABEL).map((k) => [sc[k] || '-', SC_LABEL[k]]))}
<h3>영역 선택 중</h3>${rows([['Enter / Space', '저장 + 복사'], ['E', '저장 후 편집'], ['B', '보고서에 담기'], ['L', '직전 영역'], ['F', '모니터 전체'], ['방향키', '1px 이동 · Shift 10px'], ['Ctrl+방향키', '크기 조정'], ['Esc', '취소']])}
<h3>라이브러리</h3>${rows([['Ctrl+클릭', '여러 장 고르기'], ['Shift+클릭', '사이 전부 고르기'], ['Ctrl+A', '전체 선택'], ['Delete', '선택 삭제'], ['Esc', '선택 해제']])}
<h3>편집기</h3>${rows([...Editor.TOOLS.filter(Boolean).map((t) => [t[1], t[3]]), ['Ctrl+S', '편집본 저장 + 복사'], ['Ctrl+Z', '되돌리기'], ['Delete', '고른 표시 지우기']])}`;
  $('keys').hidden = false;
}

// ───────── 이벤트 ─────────
function bind() {
  $('btnRegion').onclick = () => api.invoke('capture', 'region');
  $('btnLast').onclick = () => api.invoke('capture', 'last');
  $('btnFull').onclick = () => api.invoke('capture', 'full');
  $('btnFolder').onclick = () => api.invoke('openFolder');
  $('btnKeys').onclick = showKeys;
  $('liveStop').onclick = () => api.invoke('session:stop');
  for (const b of document.querySelectorAll('nav button')) b.onclick = () => nav(b.dataset.view);

  // 라이브러리
  $('q').addEventListener('input', (e) => { S.q = e.target.value; renderLibrary(); });
  $('srcFilter').onclick = (e) => {
    if (e.target.dataset.src === undefined) return;
    S.src = e.target.dataset.src;
    for (const b of $('srcFilter').children) b.classList.toggle('on', b === e.target);
    renderLibrary();
  };
  $('classFilter').onchange = (e) => { S.cls = e.target.value; renderLibrary(); };
  $('btnImport').onclick = async () => {
    const r = await api.invoke('import');
    if (r.count) toast(`${r.count}장 가져왔습니다`);
  };
  $('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.dataset.act;
    if (act === 'copy') api.invoke('item:copy', id).then((r) => toast(r.copied ? '클립보드에 복사했습니다' : '클립보드에 복사하지 못했습니다'));
    else if (act === 'report') addToReport([id]);
    else if (act === 'check' || e.ctrlKey || e.metaKey) toggleSelect(id, false);
    else if (e.shiftKey) toggleSelect(id, true);
    else if (S.selected.size) toggleSelect(id, false);
    else Editor.open(id);
  });
  $('selReport').onclick = () => { addToReport([...S.selected]); S.selected.clear(); nav('report'); renderLibrary(); };
  $('selDelete').onclick = deleteSelected;
  $('selClear').onclick = () => { S.selected.clear(); renderLibrary(); };

  // 세션
  $('sChips').onclick = (e) => { if (e.target.tagName === 'BUTTON' && !S.session.active) $('sName').value = e.target.textContent; };
  $('sAuto').onchange = renderSession;
  $('sToggle').onclick = toggleSession;
  $('sName').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) toggleSession(); });

  // 폰
  $('phoneCopy').onclick = () => { if (phoneUrl) { api.invoke('copyText', phoneUrl); toast('주소를 복사했습니다'); } };

  // 보고서
  for (const [id, key] of Object.entries(R_FIELDS)) {
    $(id).addEventListener('input', (e) => { S.report[key] = e.target.value; saveDraft(); renderPreview(); });
  }
  $('rLayout').onclick = (e) => {
    if (!e.target.dataset.l) return;
    S.report.layout = Number(e.target.dataset.l);
    saveDraft();
    renderReport();
  };
  $('rPhotos').addEventListener('input', (e) => {
    const row = e.target.closest('.rphoto');
    if (!row) return;
    S.report.photos[Number(row.dataset.i)].caption = e.target.value;
    saveDraft();
    renderPreview();
  });
  $('rPhotos').addEventListener('click', (e) => {
    const o = e.target.dataset.o;
    if (!o) return;
    const i = Number(e.target.closest('.rphoto').dataset.i);
    const p = S.report.photos;
    if (o === 'up' && i > 0) [p[i - 1], p[i]] = [p[i], p[i - 1]];
    else if (o === 'down' && i < p.length - 1) [p[i + 1], p[i]] = [p[i], p[i + 1]];
    else if (o === 'del') p.splice(i, 1);
    saveDraft();
    renderReport();
  });
  $('rClear').onclick = () => {
    if (!confirm('보고서 내용을 비울까요? (사진 파일은 지워지지 않습니다)')) return;
    S.report = newReport();
    saveDraft();
    renderReport();
  };
  $('rPdf').onclick = savePdf;

  // 설정
  $('setAcademy').addEventListener('change', (e) => api.invoke('settings:set', { academy: e.target.value.trim() }));
  $('setTeacher').addEventListener('change', (e) => api.invoke('settings:set', { teacher: e.target.value.trim() }));
  $('setNotify').onchange = (e) => api.invoke('settings:set', { notify: e.target.checked });
  $('setAuto').onchange = (e) => api.invoke('settings:set', { autoStart: e.target.checked });
  $('setDirPick').onclick = () => api.invoke('chooseFolder');
  $('setDirOpen').onclick = () => api.invoke('openFolder');
  $('setKeysReset').onclick = () => api.invoke('settings:resetShortcuts');
  $('setKeys').addEventListener('focusin', (e) => { if (e.target.dataset.k) { e.target.classList.add('rec'); e.target.value = '키 조합을 누르세요'; } });
  $('setKeys').addEventListener('focusout', () => renderSettings());
  $('setKeys').addEventListener('keydown', async (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return e.target.blur();
    const acc = acceleratorOf(e);
    if (!acc) return;
    const dup = Object.entries(S.settings.shortcuts).find(([kk, v]) => kk !== k && v === acc);
    if (dup) return toast(`「${SC_LABEL[dup[0]]}」에서 이미 쓰는 조합입니다`);
    const r = await api.invoke('settings:set', { shortcuts: { [k]: acc } });
    e.target.blur();
    if (r.failedShortcuts && r.failedShortcuts.includes(k)) toast('다른 프로그램이 쓰는 조합이라 등록하지 못했습니다');
  });

  $('keys').onclick = (e) => { if (e.target === $('keys')) $('keys').hidden = true; };
  window.addEventListener('resize', () => S.view === 'report' && renderPreview());

  window.addEventListener('keydown', (e) => {
    if (!$('keys').hidden) { if (e.key === 'Escape' || e.key === '?') $('keys').hidden = true; return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '?' && !typing) { e.preventDefault(); return showKeys(); }
    if (Editor.onKey(e)) return;
    if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (S.view !== 'library') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
      e.preventDefault();
      for (const it of visibleItems()) S.selected.add(it.id);
      renderLibrary();
    } else if (e.key === 'Delete') deleteSelected();
    else if (e.key === 'Escape' && S.selected.size) { S.selected.clear(); renderLibrary(); }
  });
}

function applySync(data) {
  S.items = data.items;
  S.session = data.session;
  S.settings = data.settings;
  S.failedShortcuts = data.failedShortcuts || [];
  renderChrome();
  renderLibrary();
  if (S.view === 'session') renderSession();
  if (S.view === 'settings' && !document.activeElement.dataset.k) renderSettings();
  if (S.view === 'report') renderReport();
  else { S.report.photos = S.report.photos.filter((p) => S.items.some((it) => it.id === p.id)); renderReportBadge(); }
}

async function start() {
  const st = await api.invoke('state');
  S.items = st.items;
  S.settings = st.settings;
  S.session = st.session;
  S.failedShortcuts = st.failedShortcuts || [];
  S.report = { ...newReport(), ...(st.reportDraft || {}) };
  if (!Array.isArray(S.report.photos)) S.report.photos = [];
  $('ver').textContent = 'v' + st.version;
  Editor.init({
    items: () => S.items,
    toast,
    addToReport,
    kindLabel: (it) => KIND_LABEL[it.source] || '화면 캡처',
    afterSave: (id) => Editor.open(id),
  });
  bind();
  renderChrome();
  renderLibrary();
  renderReportBadge();
  if (st.failedShortcuts.length) toast('일부 단축키를 다른 프로그램이 쓰고 있습니다 — 설정에서 바꿔 주세요');

  api.on('sync', applySync);
  api.on('toast', toast);
  api.on('nav', (view) => { Editor.close(); nav(view); });
  api.on('edit', (id) => { nav('library'); Editor.open(id); });
  api.on('report:add', (ids) => addToReport(ids));
}
start();
