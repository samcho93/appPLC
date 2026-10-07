/* 래더 편집 도구 · 확대 · 실행 단추의 글자 기호(┤├ ( ) ↶ …)를 SVG 아이콘으로 바꾼다:  node tools/apply-icons.js
 *  글자 기호는 휴대폰마다 다른 대체 글꼴로 그려져 아래위 위치가 들쭉날쭉하므로, 같은 24×24 틀의 선 그림으로 통일한다.
 *  index.html 의 data-tool / data-act 단추 안쪽(단축키 표시 .k · 이름 .lbl 은 유지)을 고친다. 여러 번 실행해도 된다.
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'index.html');

const svg = (d, extra) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/>${extra || ''}</svg>`;
// 접점 기본형: 양쪽 선 + 두 막대 (가운데 y=12)
const contact = (y = 12) => `M1 ${y}h7M16 ${y}h7M8 ${y - 6}v12M16 ${y - 6}v12`;
// 병렬(OR) 접점: 접점을 아래(y=16)에 두고 양쪽에서 위로 올라가 위 행과 잇는다
const orContact = `M2 3v13h6M16 16h6V3M8 11v10M16 11v10`;
const ICONS = {
  edit: svg('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  convert: svg('M4 12.5l5 5L20 6.5'),
  undo: svg('M9 7H4V2M4.5 7A8.5 8.5 0 1 1 6 17'),
  redo: svg('M15 7h5V2M19.5 7A8.5 8.5 0 1 0 18 17'),
  NO: svg(contact()),
  NC: svg(contact() + 'M6.5 18.5l11-13'),
  OR: svg(orContact),
  ORNC: svg(orContact + 'M6.5 21.5l11-11'),
  P: svg(contact() + 'M12 16V8M9.5 10.5L12 8l2.5 2.5'),
  F: svg(contact() + 'M12 8v8M9.5 13.5L12 16l2.5-2.5'),
  coil: svg('M1 12h5M18 12h5M9 5.5a8 8 0 0 0 0 13M15 5.5a8 8 0 0 1 0 13'),
  app: svg('M1 12h4M19 12h4M5 6.5h14v11H5z'),
  H: svg('M2 12h20'),
  V: svg('M12 2v20M7 12h10', ''),
  'edit-cell': svg('M3 21h4l9.5-9.5-4-4L3 17zM14 6l4 4M18 2.5l3.5 3.5'),
  del: svg('M4 6.5h16M9 6.5V4h6v2.5M6.5 6.5l1 14h9l1-14M10 10.5v6M14 10.5v6'),
  insRow: svg('M3 5h18M3 19h18M12 8.5v7M8.5 12h7'),
  delRow: svg('M3 5h18M3 19h18M8.5 12h7'),
  copy: svg('M8 8h12v12H8zM16 8V4H4v12h4'),
  cut: svg('M8.5 8.5L20 20M15.5 8.5L4 20', '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>'),
  paste: svg('M8 4H5v17h14V4h-3M8 2.5h8v4H8z'),
  zoomOut: svg('M5 12h14'),
  zoomIn: svg('M5 12h14M12 5v14'),
  zoomFit: svg('M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6'),
  reset: svg('M4 4v6h6M4.6 10A8 8 0 1 1 6 17'),
  step: svg('M4 5l10 7-10 7zM18 5v14')
};
// 세로선 아이콘은 세로선만 (가로 표시 없이)
ICONS.V = svg('M12 2v20');

let html = fs.readFileSync(FILE, 'utf8');
let n = 0;
html = html.replace(/<button class="ibtn([^"]*)" data-(tool|act)="([^"]+)"([^>]*)>([\s\S]*?)<\/button>/g, (m, cls, kind, name, attrs, inner) => {
  const ic = ICONS[name];
  if (!ic) return m;
  if (kind === 'act' && name !== 'reset' && name !== 'step') return m;
  const keep = (inner.match(/<span class="(k|lbl)"[^>]*>[^<]*<\/span>/g) || []).join('');
  n++;
  return `<button class="ibtn${cls}" data-${kind}="${name}"${attrs}>${ic}${keep}</button>`;
});
fs.writeFileSync(FILE, html);
console.log(`✓ 아이콘 ${n}개를 바꿨습니다`);
