// 가상 화면에서 앱을 띄워 주요 흐름을 한 번씩 돌려 본다:  GC_SMOKE=test/smoke.js electron .
const fs = require('fs');
const path = require('path');
const http = require('http');
const { app, nativeImage } = require('electron');
const out = process.env.GC_OUT || path.join(__dirname, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

function post(url, buf) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'image/jpeg', 'content-length': buf.length } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.end(buf);
  });
}
function get(url) {
  return new Promise((resolve, reject) => http.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject));
}

exports.run = async (c) => {
  try {
    fs.mkdirSync(out, { recursive: true });
    const js = (code) => c.mainWin.webContents.executeJavaScript(code, true);
    const snap = async (win, name) => fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
    const errors = [];
    c.mainWin.webContents.on('console-message', (e) => { console.log('  [renderer]', e.level, e.message, e.lineNumber, e.sourceId); if (e.level === 'error' || e.level === 3) errors.push(e.message); });
    await sleep(1500);
    c.mainWin.show();

    // 1) 데모 자료 넣기
    for (const f of fs.readdirSync(process.env.GC_DEMO).sort()) {
      c.addImage(fs.readFileSync(path.join(process.env.GC_DEMO, f)), 'png', { source: 'screen', session: '중2 A반', memo: '본문 1단락 — 핵심 문장' });
      await sleep(30);
    }
    check('사진 추가', c.getItems().length >= 3, `(${c.getItems().length}장)`);

    // 2) 폰 업로드
    const info = await c.phoneInfo();
    const base = info.ok ? info.url.replace(/\/\/[^:]+:/, '//127.0.0.1:') : null;
    check('폰 서버 + QR', !!(info.ok && info.qr.includes('<svg')), info.url || '');
    if (base) {
      const page = await get(base);
      check('폰 화면 응답', page.status === 200 && page.body.includes('찍어서 보내기'));
      const bad = await get(base.replace(/\/[^/]+\/$/, '/wrongtoken/'));
      check('틀린 토큰은 거절', bad.status === 404);
      const jpg = nativeImage.createFromPath(path.join(process.env.GC_DEMO, fs.readdirSync(process.env.GC_DEMO)[0])).toJPEG(80);
      const up = await post(base + 'upload?session=' + encodeURIComponent('고1 독해반'), jpg);
      check('폰 사진 올리기', up.status === 200 && JSON.parse(up.body).ok && c.getItems()[0].source === 'phone' && c.getItems()[0].session === '고1 독해반', up.body);
    }
    await sleep(500);
    await snap(c.mainWin, '1-library');

    // 3) 전체 화면 캡처
    const n0 = c.getItems().length;
    await c.captureFull();
    check('전체 화면 캡처', c.getItems().length === n0 + 1, `${c.getItems()[0].w}x${c.getItems()[0].h}`);

    // 4) 영역 캡처 (오버레이)
    await c.captureRegion(false);
    await sleep(1500);
    const ov = c.getOverlay();
    check('오버레이 표시', !!ov && ov.isVisible());
    if (ov) {
      const ojs = (code) => ov.webContents.executeJavaScript(code, true);
      ov.webContents.on('console-message', (e) => console.log('  [overlay]', e.level, e.message, e.lineNumber));
      await ojs(`(()=>{const ev=(t,x,y)=>window.dispatchEvent(new MouseEvent(t,{clientX:x,clientY:y,button:0,bubbles:true}));ev('mousedown',100,120);ev('mousemove',300,260);ev('mousemove',420,330);ev('mouseup',420,330);ev('mousemove',500,400)})()`);
      await sleep(300);
      await snap(ov, '2-overlay');
      const n1 = c.getItems().length;
      await ojs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE'}))`);
      await sleep(1200);
      const it = c.getItems()[0];
      check('영역 저장', c.getItems().length === n1 + 1 && it.w > 300 && it.w < 340, `${it.w}x${it.h}`);
      check('E → 편집기 열림', await js(`!document.getElementById('editor').hidden`));
      const n2 = c.getItems().length;
      await c.captureLast();
      const l = c.getItems()[0];
      check('직전 영역 다시', c.getItems().length === n2 + 1 && l.w === it.w && l.h === it.h);
    }

    // 5) 편집기
    const demoId = c.getItems().find((x) => x.memo).id;
    await js(`Editor.open(${JSON.stringify(demoId)})`);
    await sleep(700);
    await js(`(()=>{const cv=document.getElementById('edCanvas');const r=cv.getBoundingClientRect();
      const ev=(t,fx,fy)=>(t==='mousedown'?cv:window).dispatchEvent(new MouseEvent(t,{clientX:r.left+r.width*fx,clientY:r.top+r.height*fy,button:0,bubbles:true}));
      const key=(code)=>window.dispatchEvent(new KeyboardEvent('keydown',{code,key:code.slice(3).toLowerCase(),bubbles:true}));
      const dragT=(code,a,b,c2,d)=>{key(code);ev('mousedown',a,b);ev('mousemove',c2,d);ev('mouseup',c2,d)};
      key('KeyN');ev('mousedown',.08,.72);ev('mouseup',.08,.72);
      dragT('KeyR',.1,.68,.62,.8);dragT('KeyA',.8,.6,.66,.74);dragT('KeyH',.05,.3,.95,.38);dragT('KeyM',.05,.42,.5,.5);dragT('KeyO',.6,.1,.9,.26);})()`);
    await sleep(300);
    await snap(c.mainWin, '3-editor');
    const n3 = c.getItems().length;
    await js(`document.getElementById('edSave').click()`);
    await sleep(900);
    check('편집본 새로 저장', c.getItems().length === n3 + 1 && c.getItems()[0].edited === true);
    await js(`Editor.close()`);

    // 6) 여러 장 선택 → 보고서
    await js(`(()=>{const cards=[...document.querySelectorAll('.card')];cards[0].querySelector('.chk').click();})()`);
    await js(`document.querySelectorAll('.card')[2].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
    await sleep(200);
    await snap(c.mainWin, '4-select');
    check('Shift 범위 선택', (await js(`document.querySelectorAll('.card.sel').length`)) === 3);
    await js(`document.getElementById('selReport').click()`);
    await sleep(300);
    await js(`(()=>{const set=(id,v)=>{const el=document.getElementById(id);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))};
      set('rAcademy','공감학원');set('rTeacher','공감 선생님');set('rContent','습관의 힘 본문 1단락 독해, 관계대명사 what 예문 정리.\\n판서로 5형식 사역동사 복습.');set('rHomework','워크북 p.24~25 · 단어 Day 12 암기');})()`);
    await sleep(600);
    await snap(c.mainWin, '5-report');
    check('보고서에 3장', (await js(`S.report.photos.length`)) === 3);
    const pdf = await c.renderPdf(await js(`S.report`));
    fs.writeFileSync(path.join(out, 'report.pdf'), pdf);
    check('PDF 생성', pdf.length > 20000 && pdf.slice(0, 4).toString() === '%PDF', `${pdf.length} bytes`);

    // 7) 수업 세션 + 자동 캡처 (같은 화면은 한 장만)
    await js(`Editor.close();nav('session')`);
    const n4 = c.getItems().length;
    c.startSession({ name: '중3 B반', auto: true, interval: 10 });
    await sleep(2600);
    await snap(c.mainWin, '6-session');
    check('세션 시작 + 첫 자동 캡처', c.getSession().active && c.getItems().length === n4 + 1 && c.getItems()[0].session === '중3 B반' && c.getItems()[0].auto);
    c.stopSession(true);

    for (const v of ['phone', 'settings']) { await js(`nav('${v}')`); await sleep(500); await snap(c.mainWin, '7-' + v); }
    await js(`showKeys()`); await sleep(200); await snap(c.mainWin, '8-keys');
    check('화면 오류 없음', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('예외 없이 끝남', false, e.stack);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  app.exit(failed ? 1 : 0);
};
