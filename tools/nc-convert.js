/* 스위치 배선을 "누르면 ON" 으로 통일하는 변환기
 *  강좌 예제는 정지 버튼 · 리밋을 b 접점으로 배선(nc=1, 평소 ON)하고 래더는 a 접점으로 끊었다.
 *  이 앱은 "b 접점은 누르지 않을 때 도통, 누르면 끊어짐" 이 보이도록, 스위치는 누르면 ON 으로 두고
 *  래더의 접점을 a ↔ b 로 뒤집는다 (상승 ↔ 하강 펄스도 함께).
 *
 *  convert(PLC, vendorId, {io, program, test}) → { io, program, test, changed, skipped }
 *   - PB · LS 의 nc=1 을 지우고, EMG(예전엔 늘 b 접점 배선)는 그대로 둔 채 엔진 기본(누르면 ON)을 쓴다
 *   - 그 입력이 접점이 아닌 곳(워드 명령 · K4X0 · 비교 · 출력)에 쓰이면 바꾸지 않고 원래 배선(nc=1)을 남긴다
 *   - 검사식의 직접 디바이스 확인(X1=1 …)은 값이 뒤집힌다
 */
const FLIP = {
  melsec: { LD: 'LDI', LDI: 'LD', AND: 'ANI', ANI: 'AND', OR: 'ORI', ORI: 'OR', LDP: 'LDF', LDF: 'LDP', ANDP: 'ANDF', ANDF: 'ANDP', ORP: 'ORF', ORF: 'ORP' },
  xgk: { LOAD: 'LOAD NOT', 'LOAD NOT': 'LOAD', AND: 'AND NOT', 'AND NOT': 'AND', OR: 'OR NOT', 'OR NOT': 'OR', LOADP: 'LOADN', LOADN: 'LOADP', ANDP: 'ANDN', ANDN: 'ANDP', ORP: 'ORN', ORN: 'ORP' }
};

function convert(PLC, vendor, proj) {
  const flip = FLIP[vendor];
  const ioLines = String(proj.io || '').split('\n');
  const targets = [];           // { li, type, point, text, nc }
  const pointOf = (o) => (o && o.kind === 'dev' ? (vendor === 'xgk' ? (o.dev === 'P' && o.preferBit !== false ? o.point : null) : (o.dev === 'X' && o.bit == null ? o.addr : null)) : null);
  ioLines.forEach((line, li) => {
    const t = line.replace(/(^|\s)#.*$/, '').trim().split(/\s+/);
    const type = (t[0] || '').toUpperCase();
    if (type !== 'PB' && type !== 'LS' && type !== 'EMG') return;
    const nc = /(^|\s)nc=1(\s|$)/i.test(line);
    if (type !== 'EMG' && !nc) return;
    const addrTok = t.slice(2).find((x) => x.indexOf('=') < 0);
    const o = addrTok ? PLC.parseOperand(addrTok) : null;
    const p = pointOf(o);
    if (p == null) return;
    targets.push({ li, type, point: p, text: o.text, nc });
  });
  if (!targets.length) return Object.assign({}, proj, { changed: 0, skipped: 0 });

  const covers = (o, p) => {
    if (!o) return false;
    if (vendor === 'melsec') {
      if (o.kind === 'digit' && o.dev === 'X') return p >= o.addr && p < o.addr + o.n * 4;
      return o.kind === 'dev' && o.dev === 'X' && o.addr === p;
    }
    if (o.kind !== 'dev' || o.dev !== 'P') return false;
    if (o.preferBit !== false && o.point != null) return o.point === p;
    return o.wordNum != null && p >= o.wordNum * 16 && p < o.wordNum * 16 + 16;
  };
  // 프로그램에서 각 대상 입력이 어디에 쓰이는지 조사
  const progLines = String(proj.program || '').split('\n');
  const opRe = vendor === 'xgk'
    ? /^(\s*)(LOAD NOT|AND NOT|OR NOT|LOADP|LOADN|ANDP|ANDN|ORP|ORN|LOAD|AND|OR)(\s+)(\S+)(.*)$/i
    : /^(\s*)(LDI|ANI|ORI|LDP|LDF|ANDP|ANDF|ORP|ORF|LD|AND|OR)(\s+)(\S+)(.*)$/i;
  const bad = new Set();
  const plan = [];               // [lineIndex, target]
  progLines.forEach((line, i) => {
    const body = line.trim();
    if (!body || body[0] === ';' || body[0] === '@') return;
    const m = opRe.exec(line);
    const contactOp = m ? m[2].toUpperCase().replace(/\s+/g, ' ') : null;
    const contactOpd = m ? PLC.parseOperand(m[4]) : null;
    const isContact = m && flip[contactOp] && contactOpd && contactOpd.kind === 'dev' && !/^\s*\S/.test(m[5].replace(/^\s*;.*$/, ''));
    PLC.tokenize(body.replace(/\s;.*$/, '')).forEach((tok, k) => {
      const o = PLC.parseOperand(tok);
      targets.forEach((tg) => {
        if (!covers(o, tg.point)) return;
        if (isContact && contactOpd && covers(contactOpd, tg.point) && pointOf(contactOpd) === tg.point && tok === m[4]) plan.push([i, tg]);
        else bad.add(tg);
      });
    });
  });
  const ok = targets.filter((tg) => !bad.has(tg));
  const okSet = new Set(ok);
  // 프로그램: 접점 뒤집기
  const out = progLines.slice();
  plan.forEach(([i, tg]) => {
    if (!okSet.has(tg)) return;
    out[i] = out[i].replace(opRe, (all, sp, op, sp2, opd, rest) => `${sp}${flip[op.toUpperCase().replace(/\s+/g, ' ')]}${sp2}${opd}${rest}`);
  });
  // 설비: 바꾼 것은 nc=1 을 지우고, 못 바꾼 EMG 는 nc=1 을 붙여 예전 배선을 유지한다
  const io = ioLines.slice();
  targets.forEach((tg) => {
    if (okSet.has(tg)) io[tg.li] = io[tg.li].replace(/\s+nc=1(?=\s|$)/i, '');
    else if (tg.type === 'EMG' && !tg.nc) io[tg.li] = io[tg.li].replace(/^(\s*EMG\s+\S+\s+\S+)/i, '$1 nc=1');
  });
  // 검사식: 직접 디바이스 값(X1=1, X1=0, X1!=1) 뒤집기
  let test = String(proj.test || '');
  ok.forEach((tg) => {
    const re = new RegExp(`(^|[\\s>])(${tg.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(=|!=)([01])(?=\\s|$)`, 'gim');
    test = test.replace(re, (all, pre, d, op, v) => `${pre}${d}${op}${v === '1' ? '0' : '1'}`);
  });
  return Object.assign({}, proj, { io: io.join('\n'), program: out.join('\n'), test, changed: ok.length, skipped: targets.length - ok.length });
}

module.exports = { convert, FLIP };
