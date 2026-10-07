/* 강좌(studyPLC · studyPLCLS)의 래더 실습을 예제 라이브러리로 모은다.
 *   node tools/harvest-examples.js [../studyPLC] [../studyPLCLS]
 * 결과: js/melsec/examples.js · js/xgk/examples.js  (PLC.EXAMPLES = [...])
 * 강좌 본문(설명 · 퀴즈 · 슬라이드)은 가져오지 않고, 래더 · 현장 설비 · 모듈 구성 · 검사식만 가져온다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = [
  { id: 'melsec', dir: process.argv[2] || path.join(ROOT, '..', 'studyPLC'), out: 'js/melsec/examples.js', name: 'MELSEC' },
  { id: 'xgk', dir: process.argv[3] || path.join(ROOT, '..', 'studyPLCLS'), out: 'js/xgk/examples.js', name: 'XGK' }
];

/** HTML → 한 줄 설명 (태그 · 엔티티 제거) */
function plain(html, max) {
  const t = String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
  return max && t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function loadCourse(dir) {
  const course = { order: [], chapters: {} };
  const courseJs = fs.readFileSync(path.join(dir, 'js/course.js'), 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(courseJs, ctx);
  course.order = ctx.window.PLC_COURSE.order;
  const files = fs.readdirSync(path.join(dir, 'lessons')).filter((f) => /^ch\d+\.js$/.test(f)).sort();
  files.forEach((f) => {
    const c2 = { PLC_COURSE: { addChapter(ch) { course.chapters[ch.id] = ch; } }, console };
    vm.createContext(c2);
    try { vm.runInContext(fs.readFileSync(path.join(dir, 'lessons', f), 'utf8'), c2, { filename: f }); }
    catch (e) { console.error('✗', f, e.message); }
  });
  return course;
}

function harvest(src) {
  const course = loadCourse(src.dir);
  const out = [];
  course.order.forEach((o) => {
    const ch = course.chapters[o.id];
    if (!ch) return;
    (ch.sections || []).forEach((sec, si) => {
      if (sec.hmi) return;                          // HMI(GOT) 화면이 필요한 교시는 뺀다
      let n = 0;
      (sec.content || []).forEach((b) => {
        if (b.type !== 'ladder' || b.hmi) return;
        n++;
        const rack = b.rack != null ? b.rack : sec.rack;
        const io = b.io != null ? b.io : sec.io;
        out.push({
          ch: o.no, chTitle: ch.title, icon: o.icon || '',
          sec: si + 1, secTitle: sec.title,
          title: String(b.title || `실습 ${n}`).replace(/^실습\s*\d+\s*[:：]\s*/, ''),
          desc: plain(b.desc, 160),
          rack: rack || '', io: io || '', program: b.program || '',
          test: b.test || '', monitor: b.monitor || ''
        });
      });
    });
  });
  return out;
}

SRC.forEach((src) => {
  if (!fs.existsSync(path.join(src.dir, 'lessons'))) { console.error(`건너뜀: ${src.dir} 에 lessons 폴더가 없습니다`); return; }
  const list = harvest(src);
  const body = `/* ${src.name} 강좌의 래더 실습 예제 — tools/harvest-examples.js 로 자동 생성 (손으로 고치지 마세요) */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  PLC.EXAMPLES = ${JSON.stringify(list, null, 1)};
})(typeof window !== 'undefined' ? window : globalThis);
`;
  fs.writeFileSync(path.join(ROOT, src.out), body, 'utf8');
  console.log(`✓ ${src.out}: 예제 ${list.length}개 (${new Set(list.map((x) => x.ch)).size} 챕터)`);
});
