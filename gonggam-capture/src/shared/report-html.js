// 수업 보고서 HTML. 미리보기(렌더러)와 PDF(메인)가 같은 함수를 써서 결과가 똑같다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportHTML = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const multiline = (s) => esc(s).replace(/\n/g, '<br>');

  const CSS = `
.rp{font-family:'Pretendard','Malgun Gothic','맑은 고딕','Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#152523;font-size:10.5pt;line-height:1.55}
.rp *{box-sizing:border-box}
.rp .ac{font-size:9pt;font-weight:700;color:#0b7f68}
.rp .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5pt solid #152523;padding-bottom:5pt;margin-bottom:9pt}
.rp h1{font-size:19pt;margin:2pt 0 0;letter-spacing:-.02em}
.rp .dt{font-size:9.5pt;color:#4b5d5a}
.rp table{width:100%;border-collapse:collapse;margin-bottom:9pt}
.rp th,.rp td{border:.75pt solid #cfdad6;padding:5pt 8pt;text-align:left;font-size:9.5pt}
.rp th{background:#e5f5f0;color:#0b7f68;width:14%;white-space:nowrap}
.rp .box{border:.75pt solid #cfdad6;border-radius:4pt;padding:7pt 9pt;margin-bottom:9pt;break-inside:avoid}
.rp .box b{display:block;font-size:9pt;color:#0b7f68;margin-bottom:2pt}
.rp .ph{display:grid;gap:7pt;margin-bottom:9pt}
.rp .ph.c1{grid-template-columns:1fr}
.rp .ph.c2{grid-template-columns:1fr 1fr}
.rp figure{margin:0;border:.75pt solid #cfdad6;border-radius:4pt;overflow:hidden;break-inside:avoid;background:#fff}
.rp figure img{display:block;width:100%;height:auto;max-height:215mm;object-fit:contain;background:#f4f7f6}
.rp .ph.c2 figure img{max-height:105mm}
.rp figcaption{display:flex;gap:6pt;align-items:flex-start;padding:5pt 7pt;font-size:9pt;border-top:.75pt solid #e2eae7}
.rp figcaption i{flex:none;font-style:normal;font-weight:800;font-size:8pt;color:#fff;background:#0f9b7c;border-radius:50%;width:13pt;height:13pt;line-height:13pt;text-align:center}
.rp .ft{text-align:center;color:#8a9a96;font-size:8pt;margin-top:12pt}
`;

  function body(d) {
    const photos = d.photos || [];
    const cols = d.layout === 1 ? 1 : 2;
    const foot = [d.academy, '공감캡처로 작성'].filter(Boolean).join(' · ');
    return `<div class="rp">
<div class="ac">${esc(d.academy)}</div>
<div class="hd"><h1>${esc(d.title || '수업 보고서')}</h1><div class="dt">${esc(d.date)}</div></div>
<table><tr><th>반 / 수업</th><td>${esc(d.className)}</td><th>담당</th><td>${esc(d.teacher)}</td></tr></table>
${d.content ? `<div class="box"><b>수업 내용</b>${multiline(d.content)}</div>` : ''}
${
  photos.length
    ? `<div class="ph c${cols}">${photos
        .map(
          (p, i) =>
            `<figure><img src="${esc(d.imgSrc(p.id))}" alt=""><figcaption><i>${i + 1}</i><span>${multiline(p.caption || '')}</span></figcaption></figure>`
        )
        .join('')}</div>`
    : ''
}
${d.homework ? `<div class="box"><b>과제 · 전달 사항</b>${multiline(d.homework)}</div>` : ''}
<div class="ft">${esc(foot)}</div>
</div>`;
  }

  // PDF 인쇄용 완성 문서
  function page(d) {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(d.title || '수업 보고서')}</title>
<style>@page{size:A4;margin:13mm 13mm 12mm}html,body{margin:0;background:#fff}${CSS}</style></head><body>${body(d)}</body></html>`;
  }

  return { CSS, body, page };
});
