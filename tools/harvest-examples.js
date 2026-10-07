/* 강좌(studyPLC · studyPLCLS)의 래더 실습을 예제 라이브러리로 모은다.
 *   node tools/harvest-examples.js [../studyPLC] [../studyPLCLS]
 * 결과: js/melsec/examples.js · js/xgk/examples.js  (PLC.EXAMPLES = [...])
 * 강좌 본문(설명 · 퀴즈 · 슬라이드)은 가져오지 않고, 래더 · 현장 설비 · 모듈 구성 · 검사식만 가져온다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { convert } = require('./nc-convert.js');

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

/** 이 앱의 엔진 (js/<제조사>/) — 변환한 예제를 검사식으로 확인하는 데 쓴다 */
function loadEngine(vendor) {
  const ctx = {
    console, Math, Date, Map, Set, Array, Object, String, Number, JSON, Error, RegExp, TextEncoder, TextDecoder, DataView, ArrayBuffer,
    Uint8Array, Int16Array, Int32Array, Float64Array, isFinite, parseInt, parseFloat, performance: { now: () => Date.now() }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ['core', 'modules', 'plant', 'ladder', 'sim', 'samples'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', vendor, f + '.js'), 'utf8'), ctx, { filename: f }));
  return ctx.PLC;
}
/** 프로젝트가 오류 없이 검사식을 모두 통과하는가 */
function passes(PLC, p) {
  const sim = new PLC.Sim({ rack: p.rack, io: p.io, program: p.program });
  if (sim.rack.errors.length || sim.plant.errors.length || sim.program.errors.length) return false;
  try { return (p.test ? sim.runTests(p.test) : []).every((x) => x.ok); } catch (e) { return false; }
}
const legacyEmg = (io) => String(io || '').split('\n')
  .map((l) => (/^\s*EMG\s/i.test(l) && !/nc=1/i.test(l) ? l.replace(/^(\s*EMG\s+\S+\s+\S+)/i, '$1 nc=1') : l)).join('\n');
/** 스위치를 "누르면 ON" 배선으로 바꾸고(래더 접점 a ↔ b), 검사식이 통과할 때만 쓴다. 안 되면 예전 배선(EMG 는 nc=1) 유지 */
function rewire(PLC, vendor, p, stat) {
  const c = convert(PLC, vendor, p);
  if (!c.changed && !c.skipped) return p;
  const out = Object.assign({}, p, { io: c.io, program: c.program, test: c.test });
  if (passes(PLC, out)) { if (c.changed) stat.conv++; if (c.skipped) stat.keep++; return out; }
  stat.fail.push(p.title);
  return Object.assign({}, p, { io: legacyEmg(p.io) });
}

SRC.forEach((src) => {
  if (!fs.existsSync(path.join(src.dir, 'lessons'))) { console.error(`건너뜀: ${src.dir} 에 lessons 폴더가 없습니다`); return; }
  const PLC = loadEngine(src.id);
  const stat = { conv: 0, keep: 0, fail: [] };
  const list = harvest(src).map((x) => Object.assign(x, rewire(PLC, src.id, x, stat)));
  const samples = (PLC.SAMPLES || []).map((s) => {
    const p = PLC.parseProject(s.project);
    const q = rewire(PLC, src.id, Object.assign({}, p, { title: p.title || s.title }), stat);
    return { title: s.title, desc: s.desc, project: PLC.buildProject(Object.assign({}, p, { io: q.io, program: q.program, test: q.test, title: p.title || s.title })) };
  });
  const bad = [...list, ...samples.map((s) => Object.assign({ title: s.title }, PLC.parseProject(s.project)))].filter((p) => !passes(PLC, p)).map((p) => p.title);
  const body = `/* ${src.name} 강좌의 래더 실습 예제 — tools/harvest-examples.js 로 자동 생성 (손으로 고치지 마세요)
 * 스위치는 "누르면 ON" 배선으로 바꿨다 (정지 · 비상정지는 래더에서 b 접점으로 끊는다) — tools/nc-convert.js */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  PLC.EXAMPLES = ${JSON.stringify(list, null, 1)};
  /* 기본 예제 (samples.js) 도 같은 배선으로 바꾼 것 */
  PLC.SAMPLES = ${JSON.stringify(samples, null, 1)};
})(typeof window !== 'undefined' ? window : globalThis);
`;
  fs.writeFileSync(path.join(ROOT, src.out), body, 'utf8');
  console.log(`✓ ${src.out}: 예제 ${list.length}개 (${new Set(list.map((x) => x.ch)).size} 챕터) · 기본 ${samples.length}개`);
  console.log(`   배선 변환 ${stat.conv} · 일부 입력은 원래 배선 유지 ${stat.keep} · 변환 실패로 원래대로 ${stat.fail.length} · 검사 실패 ${bad.length}`);
  stat.fail.forEach((t) => console.log('   ↩', t));
  bad.forEach((t) => console.log('   ✗', t));
});
