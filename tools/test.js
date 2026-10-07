/* 두 제조사 엔진으로 기본 예제 · 강좌 실습 예제를 모두 돌려 본다:  node tools/test.js
 *  - 프로젝트 해석 오류(랙 · 설비 · 프로그램) 가 없어야 한다
 *  - 검사식이 모두 통과해야 한다
 *  - 래더 격자 → 명령어 리스트 (편집기의 변환) 가 같은 프로그램을 만들어야 한다 (왕복 검사)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

function loadEngine(vendor) {
  const ctx = {
    console, Math, Date, Map, Set, Array, Object, String, Number, JSON, Error, RegExp, TextEncoder, TextDecoder, DataView, ArrayBuffer,
    Uint8Array, Uint8ClampedArray, Int16Array, Int32Array, Float64Array, isFinite, parseInt, parseFloat, performance: { now: () => Date.now() }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ['core', 'modules', 'plant', 'ladder', 'sim', 'samples', 'examples', 'vendor'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', vendor, f + '.js'), 'utf8'), ctx, { filename: `${vendor}/${f}.js` });
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ladderview.js'), 'utf8'), ctx, { filename: 'ladderview.js' });
  return ctx.PLC;
}

let total = 0, bad = 0;
['melsec', 'xgk'].forEach((vendor) => {
  const PLC = loadEngine(vendor);
  const items = [];
  (PLC.SAMPLES || []).forEach((s) => { const p = PLC.parseProject(s.project); items.push(Object.assign({ title: '[기본] ' + s.title }, p)); });
  items.push(Object.assign({ title: '[새 프로그램]' }, PLC.parseProject(PLC.VENDOR.defaultProject(PLC.DEFAULT_RACK))));
  (PLC.EXAMPLES || []).forEach((x) => items.push({ title: `[${x.ch}] ${x.title}`, rack: x.rack, io: x.io, program: x.program, test: x.test }));
  let ok = 0, rt = 0;
  items.forEach((it) => {
    total++;
    const sim = new PLC.Sim({ rack: it.rack, io: it.io, program: it.program });
    const errs = [...sim.rack.errors, ...sim.plant.errors, ...sim.program.errors.map((e) => `${e.line}행 ${e.msg}`)];
    let res = [];
    try { res = it.test ? sim.runTests(it.test) : []; } catch (e) { errs.push('예외: ' + e.message); }
    const fails = res.filter((r) => !r.ok);
    // 왕복: 격자 → IL → 다시 실행해 같은 검사식 통과
    let rtErr = '';
    try {
      const g = PLC.layout(sim.program, 4);
      const il = PLC.gridToIL(g, sim.program.comments);
      const p2 = PLC.parseProgram(il);
      if (p2.errors.length) rtErr = `변환 결과 오류: ${p2.errors[0].line}행 ${p2.errors[0].msg}`;
      else {
        const sim2 = new PLC.Sim({ rack: it.rack, io: it.io, program: il });
        const r2 = it.test ? sim2.runTests(it.test) : [];
        const f2 = r2.filter((r) => !r.ok);
        if (f2.length) rtErr = `변환 뒤 검사 실패: ${f2[0].text} | ${f2[0].msg}`;
        else rt++;
      }
    } catch (e) { rtErr = '변환 예외: ' + e.message; }
    if (errs.length || fails.length || rtErr) {
      bad++;
      console.log(`✗ ${vendor} ${it.title}`);
      errs.forEach((e) => console.log('    ', e));
      fails.forEach((f) => console.log('    ', f.text, '|', f.msg));
      if (rtErr) console.log('    ', rtErr);
    } else ok++;
  });
  console.log(`${vendor}: ${ok}/${items.length} 통과 (왕복 변환 ${rt})`);
});
console.log(bad ? `✗ ${bad}/${total} 실패` : `✓ 모두 통과 (${total})`);
process.exit(bad ? 1 : 0);
