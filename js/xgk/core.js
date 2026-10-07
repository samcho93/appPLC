/* LS ELECTRIC XGK PLC 시뮬레이터 — 핵심 엔진
 *  - 디바이스 표기 해석 (P00020, M0000F, D00010, D00010.A, T0000, C0000, S00.05, U02.00, h00FF, 100, "ABC")
 *  - 디바이스 메모리 (P M K L F / T C S / D R Z)
 *  - 명령어 리스트(IL) 해석 → 실행 단계
 *  - CPU: 입력 리프레시 → 프로그램 실행 → END 처리(출력 리프레시 · 타이머) 의 스캔 반복
 * 브라우저와 Node(검증 도구) 양쪽에서 동작한다.
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};

  // ==================================================================== 디바이스
  /*
   * XGK 의 디바이스는 워드(16비트) 가 기본 단위이고, 비트는 "워드번호 + 비트(16진 한 자리)" 로 가리킨다.
   *   P00020 → 워드 0002 의 비트 0   ·  P0002 (워드 명령에서) → 워드 2
   *   D00010 → 워드 10              ·  D00010.A → 워드 10 의 비트 A
   * 비트 디바이스(P M K L F) 는 워드 명령에도 쓸 수 있다 (MOV M0000 D00000).
   */
  const DEV = {
    P: { bit: true, words: 2048, name: '입출력 릴레이' },
    M: { bit: true, words: 2048, name: '보조 릴레이' },
    K: { bit: true, words: 2048, latch: true, name: '킵 릴레이' },
    L: { bit: true, words: 11264, latch: true, name: '링크 릴레이' },
    F: { bit: true, words: 2048, sys: true, name: '특수 릴레이(플래그)' },
    T: { timer: true, size: 2048, name: '타이머' },
    C: { counter: true, size: 2048, name: '카운터' },
    S: { step: true, blocks: 128, steps: 100, name: '스텝 제어 릴레이' },
    D: { word: true, size: 20000, name: '데이터 레지스터' },
    R: { word: true, size: 32768, name: '파일 레지스터' },
    Z: { word: true, size: 128, name: '인덱스 레지스터' }
  };
  PLC.DEV = DEV;

  /** 타이머 번호 → 시간 단위 (XGK-CPUE 기본 파라미터) */
  function timerUnit(n) {
    if (n < 1000) return 100;      // 100ms  T0000 ~ T0999
    if (n < 1500) return 10;       // 10ms   T1000 ~ T1499
    if (n < 2000) return 1;        // 1ms    T1500 ~ T1999
    return 0.1;                    // 0.1ms  T2000 ~ T2047
  }
  PLC.timerUnit = timerUnit;
  PLC.timerUnitText = (n) => { const u = timerUnit(n); return u >= 1 ? `${u}ms` : '0.1ms'; };

  const toS16 = (v) => ((v & 0xFFFF) << 16) >> 16;
  const toS32 = (v) => v | 0;
  const toU16 = (v) => v & 0xFFFF;
  PLC.toS16 = toS16;
  PLC.toU16 = toU16;

  const pad = (v, n) => String(v).padStart(n, '0');

  /** 비트 표기: P + 워드(4자리) + 비트(16진 1자리) */
  function fmtBit(dev, word, bit) {
    if (dev === 'S') return `S${pad(word, 2)}.${pad(bit, 2)}`;
    if (dev === 'D' || dev === 'R' || dev === 'Z') return `${dev}${pad(word, dev === 'D' ? 5 : dev === 'R' ? 5 : 3)}.${bit.toString(16).toUpperCase()}`;
    return `${dev}${pad(word, 4)}${bit.toString(16).toUpperCase()}`;
  }
  /** 워드 표기 */
  function fmtWord(dev, word) {
    if (dev === 'D') return `D${pad(word, 5)}`;
    if (dev === 'R') return `R${pad(word, 5)}`;
    if (dev === 'Z') return `Z${pad(word, 3)}`;
    if (dev === 'T' || dev === 'C') return `${dev}${pad(word, 4)}`;
    return `${dev}${pad(word, 4)}`;
  }
  /** 점(비트) 번호 → 표기 (모듈 · 랙에서 쓴다) */
  function fmtPoint(dev, point) { return fmtBit(dev, point >> 4, point & 15); }
  PLC.fmtBit = fmtBit;
  PLC.fmtWord = fmtWord;
  PLC.fmtPoint = fmtPoint;
  PLC.fmtAddr = fmtPoint;

  /**
   * 피연산자 하나를 해석한다.
   * kind: 'dev'(디바이스) · 'k'(정수 상수) · 'r'(실수 상수) · 'str'(문자열) · 'u'(특수모듈 U) · 'name'(레이블)
   * 비트 디바이스는 point(비트 번호) 와 word(워드 번호) 를 모두 들고 있다가 명령에 따라 골라 쓴다.
   */
  function parseOperand(tok) {
    const raw = String(tok).trim();
    const t = raw.toUpperCase();
    let m;
    if ((m = /^"(.*)"$/.exec(raw)) || (m = /^'(.*)'$/.exec(raw))) {
      return { kind: 'str', value: m[1].replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t'), text: `"${m[1]}"` };
    }
    // 인덱스 수식: P00001[Z1] · D00010[Z2]
    let z = null;
    let body = t;
    if ((m = /^(.*)\[Z(\d{1,3})\]$/.exec(t))) { body = m[1]; z = +m[2]; }
    const withZ = (o) => { if (z != null) { o.z = z; o.text += `[Z${z}]`; } return o; };

    if ((m = /^H([0-9A-F]+)$/.exec(body))) return { kind: 'k', value: parseInt(m[1], 16) | 0, hex: true, text: 'h' + m[1] };
    if ((m = /^(-?\d+)\.(\d+(E[+-]?\d+)?)$/.exec(body))) return { kind: 'r', value: parseFloat(body), text: body };
    if ((m = /^-?\d+$/.exec(body))) return { kind: 'k', value: parseInt(body, 10), text: body };
    // U 디바이스: U02.00 (베이스+슬롯 16진 두 자리 . 워드 10진)
    if ((m = /^U([0-9A-F]{1,2})\.(\d{1,2})$/.exec(body))) {
      return withZ({ kind: 'u', slot: parseInt(m[1], 16), addr: parseInt(m[2], 10), text: `U${m[1].padStart(2, '0')}.${pad(m[2], 2)}` });
    }
    // 스텝 제어 릴레이: S00.05
    if ((m = /^S(\d{1,3})\.(\d{1,2})$/.exec(body))) {
      const blk = +m[1], stp = +m[2];
      const o = { kind: 'dev', dev: 'S', word: blk, bit: stp, point: blk * 100 + stp, text: fmtBit('S', blk, stp) };
      if (blk >= DEV.S.blocks || stp >= DEV.S.steps) o.range = true;
      return o;
    }
    // 타이머 · 카운터
    if ((m = /^([TC])(\d{1,5})$/.exec(body))) {
      const dev = m[1], n = parseInt(m[2], 10);
      const o = { kind: 'dev', dev, word: n, num: n, text: fmtWord(dev, n) };
      if (n >= DEV[dev].size) o.range = true;
      return withZ(o);
    }
    // 워드 디바이스 D · R · Z (비트 지정 D00010.A 가능)
    if ((m = /^([DRZ])(\d{1,6})(?:\.([0-9A-F]))?$/.exec(body))) {
      const dev = m[1], n = parseInt(m[2], 10);
      const o = { kind: 'dev', dev, word: n, text: fmtWord(dev, n) };
      if (m[3] != null) { o.bit = parseInt(m[3], 16); o.text = fmtBit(dev, n, o.bit); }
      if (n >= DEV[dev].size) o.range = true;
      return withZ(o);
    }
    // 비트 디바이스 P · M · K · L · F
    if ((m = /^([PMKLF])([0-9A-F]{1,6})$/.exec(body))) {
      const dev = m[1], digits = m[2];
      const wordPart = digits.length > 1 ? digits.slice(0, -1) : '0';
      const bitChar = digits[digits.length - 1];
      const o = { kind: 'dev', dev, text: '' };
      if (/^\d*$/.test(wordPart)) {
        o.word = parseInt(wordPart || '0', 10);
        o.bit = parseInt(bitChar, 16);
        o.point = o.word * 16 + o.bit;
      }
      // 워드로 쓸 때의 번호 (모두 10진일 때만)
      o.wordNum = /^\d+$/.test(digits) ? parseInt(digits, 10) : null;
      // 다섯 자리 이상이면 비트 표기(P00020), 네 자리 이하면 워드 표기(P0002) 로 본다
      o.preferBit = digits.length >= 5 || o.wordNum == null;
      if (o.word == null && o.wordNum == null) return null;
      o.text = o.word != null ? fmtBit(dev, o.word, o.bit) : fmtWord(dev, o.wordNum);
      if ((o.word != null && o.word >= DEV[dev].words) || (o.wordNum != null && o.wordNum >= DEV[dev].words)) o.range = true;
      return withZ(o);
    }
    // 레이블 · 서브루틴 이름
    if (/^[A-Z_][A-Z0-9_]{0,15}$/.test(body)) return { kind: 'name', value: body, text: body };
    return null;
  }
  PLC.parseOperand = parseOperand;

  // ==================================================================== 명령어 표
  /*
   * cls: 'ld'(시작 접점) 'and' 'or' 'cmp'(비교 접점)
   *      'blk'(AND LOAD · OR LOAD · MPUSH · MLOAD · MPOP · NOT)
   *      'out'(OUT · SET · RST · 타이머 · 카운터 · MCS)
   *      'app'(응용 명령) 'ctl'(END · MCSCLR · LABEL · SBRT · RET · NEXT · NOP)
   * ops: 피연산자 개수 [최소, 최대]      p: 펄스형(…P) 허용
   */
  const INS = {};
  const def = (names, spec) => names.split('|').forEach((n) => { INS[n.trim()] = Object.assign({ name: n.trim() }, spec); });

  // 접점
  def('LOAD|LOAD NOT|LOADP|LOADN', { cls: 'ld', ops: [1, 1] });
  def('AND|AND NOT|ANDP|ANDN', { cls: 'and', ops: [1, 1] });
  def('OR|OR NOT|ORP|ORN', { cls: 'or', ops: [1, 1] });
  // 결합 · 분기 · 반전
  def('AND LOAD|OR LOAD|MPUSH|MLOAD|MPOP|NOT', { cls: 'blk', ops: [0, 0] });
  // 출력
  def('OUT|OUT NOT|OUTP|OUTN|SET|RST|FF', { cls: 'out', ops: [1, 1] });
  def('MCS', { cls: 'out', ops: [1, 1] });
  def('MCSCLR', { cls: 'ctl', ops: [1, 1] });
  // 타이머 · 카운터 (펑션 블록)
  def('TON|TOFF|TMR|TMON|TRTG', { cls: 'out', fb: 'timer', ops: [2, 2] });
  def('CTU|CTD|CTR', { cls: 'out', fb: 'counter', ops: [2, 2] });
  def('CTUD', { cls: 'out', fb: 'counter', ops: [4, 4] });
  // 제어
  def('END|RET|NEXT|BREAK|NOP|IRET', { cls: 'ctl', ops: [0, 0] });
  def('LABEL|SBRT', { cls: 'ctl', ops: [1, 1] });
  def('JMP|CALL', { cls: 'app', ops: [1, 1], p: true });
  def('FOR', { cls: 'ctl', ops: [1, 1] });
  // 전송
  def('MOV|DMOV|RMOV|CMOV|DCMOV|$MOV|XCHG|DXCHG|SWAP|BCD|DBCD|BIN|DBIN|I2R|D2R|R2I|R2D|NEG|DNEG|ABS|DABS|SEG|BSUM|DBSUM|LEN|BINDA|DBINDA|BINHA|DABIN|DDABIN|HABIN|ASC|HEX', { cls: 'app', ops: [2, 2], p: true });
  def('GMOV|FMOV|BMOV|DIS|UNI|WTOB|BTOW|ENCO|DECO|SUM|DSUM|AVE|DAVE|MAX|MIN|DMAX|DMIN', { cls: 'app', ops: [3, 3], p: true });
  // 사칙 연산 · 논리 연산 (S1 S2 D)
  def('ADD|SUB|MUL|DIV|DADD|DSUB|DMUL|DDIV|ADDU|SUBU|MULU|DIVU|RADD|RSUB|RMUL|RDIV|WAND|WOR|WXOR|WXNR|DWAND|DWOR|DWXOR|$ADD', { cls: 'app', ops: [3, 3], p: true });
  def('INC|DEC|DINC|DDEC|INCU|DECU|RSET|WDT', { cls: 'app', ops: [0, 1], p: true });
  def('CMP|DCMP|RCMP', { cls: 'app', ops: [2, 2], p: true });
  // 회전 · 이동
  def('ROL|ROR|RCL|RCR|DROL|DROR|BSFL|BSFR|WSFT|BSET|BRESET|BRST', { cls: 'app', ops: [2, 2], p: true });
  def('BSFT', { cls: 'app', ops: [2, 2], p: true });
  def('SCAL|LIMIT|DLIMIT|SCH|MUX', { cls: 'app', ops: [4, 4], p: true });
  // 시간 · 시스템
  def('DATERD|DATEWR', { cls: 'app', ops: [1, 1], p: true });
  def('TFLK', { cls: 'app', ops: [4, 4] });
  def('DUTY', { cls: 'app', ops: [3, 3] });
  def('STC|CLC|CLE|OUTOFF|STOP|ESTOP|EI|DI', { cls: 'app', ops: [0, 0] });
  def('FALS', { cls: 'app', ops: [1, 1] });
  // 특수 모듈 · 통신 모듈
  def('GET|PUT', { cls: 'app', ops: [4, 4], p: true });
  def('SNDUDATA|RCVUDATA', { cls: 'app', ops: [5, 5] });
  PLC.INS = INS;

  /** 두 낱말 명령 (LOAD NOT · AND LOAD …) */
  const TWO_WORD = { LOAD: ['NOT'], AND: ['NOT', 'LOAD'], OR: ['NOT', 'LOAD'], OUT: ['NOT'] };
  const CMP_RE = /^(LOAD|AND|OR)(D|R|L|\$|U)?(=|<>|>=|<=|>|<)$/;

  function tokenize(line) {
    const out = [];
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== c) j++;
        out.push(line.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      out.push(line.slice(i, j));
      i = j;
    }
    return out;
  }
  PLC.tokenize = tokenize;

  /** 명령어 이름 찾기 → { base, pulse, info, used(토큰 수) } */
  function lookupOp(first, second) {
    const a = String(first || '').toUpperCase();
    const b = String(second || '').toUpperCase();
    if (TWO_WORD[a] && b && TWO_WORD[a].indexOf(b) >= 0) {
      const n = `${a} ${b}`;
      if (INS[n]) return { base: n, pulse: false, info: INS[n], used: 2 };
    }
    if (INS[a]) return { base: a, pulse: false, info: INS[a], used: 1 };
    const m = CMP_RE.exec(a);
    if (m) return { base: a, pulse: false, used: 1, info: { name: a, cls: 'cmp', ops: [2, 2], pos: m[1], width: m[2] || '', rel: m[3] } };
    if (a.length > 1 && a.endsWith('P')) {
      const bs = a.slice(0, -1);
      if (INS[bs] && INS[bs].p) return { base: bs, pulse: true, info: INS[bs], used: 1 };
    }
    return null;
  }
  PLC.lookupOp = lookupOp;

  function parseInstr(text) {
    const toks = tokenize(text);
    if (!toks.length) return null;
    const lk = lookupOp(toks[0], toks[1]);
    if (!lk) return { error: `알 수 없는 명령어: ${toks[0]}` };
    const rest = toks.slice(lk.used);
    const ops = rest.map((t) => ({ t, o: parseOperand(t) }));
    const bad = ops.find((x) => !x.o);
    if (bad) return { error: `디바이스 표기 오류: ${bad.t}` };
    const oo = ops.map((x) => x.o);
    const rng = oo.find((o) => o.range);
    if (rng) return { error: `디바이스 범위 초과: ${rng.text}` };
    const [mn, mx] = lk.info.ops;
    if (oo.length < mn || oo.length > mx) return { error: `${lk.base} 의 피연산자 수가 맞지 않습니다 (${mn === mx ? mn : mn + '~' + mx}개)` };
    const ins = {
      op: lk.base, name: lk.base + (lk.pulse ? 'P' : ''), pulse: lk.pulse,
      cls: lk.info.cls, fb: lk.info.fb || null, operands: oo
    };
    if (lk.info.cls === 'cmp') Object.assign(ins, { pos: lk.info.pos, width: lk.info.width, rel: lk.info.rel });
    const err = checkInstr(ins);
    if (err) return { error: err };
    return ins;
  }
  PLC.parseInstr = parseInstr;

  const isBit = (o) => o && o.kind === 'dev' && (o.bit != null || o.dev === 'T' || o.dev === 'C');
  const isWordDst = (o) => o && ((o.kind === 'dev' && o.bit == null && (DEV[o.dev].word || DEV[o.dev].timer || DEV[o.dev].counter)) ||
    (o.kind === 'dev' && DEV[o.dev].bit && o.wordNum != null) || o.kind === 'u');
  const isWordSrc = (o) => o && (o.kind === 'k' || o.kind === 'r' || isWordDst(o) || (o.kind === 'dev' && o.bit != null));

  /** 명령별 피연산자 형식 검사 */
  function checkInstr(ins) {
    const o = ins.operands;
    switch (ins.cls) {
      case 'ld': case 'and': case 'or':
        if (!isBit(o[0])) return `${ins.name} 에는 비트 디바이스가 필요합니다: ${o[0].text}`;
        break;
      case 'cmp':
        if (!isWordSrc(o[0]) || !isWordSrc(o[1])) return '비교 명령에는 워드 디바이스나 상수가 필요합니다';
        break;
      case 'out': {
        if (ins.fb === 'timer') {
          if (!(o[0].kind === 'dev' && o[0].dev === 'T')) return `${ins.op} 의 첫 번째 자리는 타이머(T0000)여야 합니다`;
          if (!isWordSrc(o[1])) return `${ins.op} 의 설정값은 상수나 워드 디바이스여야 합니다`;
          break;
        }
        if (ins.fb === 'counter') {
          if (!(o[0].kind === 'dev' && o[0].dev === 'C')) return `${ins.op} 의 첫 번째 자리는 카운터(C0000)여야 합니다`;
          if (ins.op === 'CTUD') {
            if (!isBit(o[1]) || !isBit(o[2])) return 'CTUD 형식: CTUD C0000 <증가접점> <감소접점> <설정값>';
            if (!isWordSrc(o[3])) return 'CTUD 의 설정값은 상수나 워드 디바이스여야 합니다';
          } else if (!isWordSrc(o[1])) return `${ins.op} 의 설정값은 상수나 워드 디바이스여야 합니다`;
          break;
        }
        if (ins.op === 'MCS') { if (o[0].kind !== 'k' || o[0].value < 0 || o[0].value > 15) return 'MCS 형식: MCS 0 (0~15)'; break; }
        if (ins.op === 'RST') { if (!(isBit(o[0]) || isWordDst(o[0]))) return `RST 대상이 올바르지 않습니다: ${o[0].text}`; break; }
        if (!isBit(o[0])) return `${ins.name} 에는 비트 디바이스가 필요합니다: ${o[0].text}`;
        break;
      }
      case 'ctl':
        if (ins.op === 'MCSCLR' && (o[0].kind !== 'k' || o[0].value < 0 || o[0].value > 15)) return 'MCSCLR 형식: MCSCLR 0 (0~15)';
        if ((ins.op === 'LABEL' || ins.op === 'SBRT') && o[0].kind !== 'name') return `${ins.op} 형식: ${ins.op} MAIN`;
        if (ins.op === 'FOR' && !isWordSrc(o[0])) return 'FOR 형식: FOR 5';
        break;
      default:
        if ((ins.op === 'JMP' || ins.op === 'CALL') && o[0].kind !== 'name') return `${ins.op} 형식: ${ins.op} SKIP`;
        break;
    }
    return null;
  }

  /**
   * 명령어 리스트 전체 해석.
   * 줄 형식: 명령어 / "LABEL 이름" / "; 설명문"(렁 설명문) / "@P00020 코멘트"(변수 설명) / "# 주석"
   */
  function parseProgram(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const steps = [];
    const labels = {};
    const comments = {};
    const errors = [];
    let pendingNote = [];
    lines.forEach((raw, li) => {
      const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
      if (!line) return;
      if (line[0] === ';') { pendingNote.push(line.slice(1).trim()); return; }
      if (line[0] === '@') {
        const m = /^@(\S+)\s+(.*)$/.exec(line);
        if (m) { const o = parseOperand(m[1]); if (o) comments[o.text] = m[2].trim(); }
        return;
      }
      const ins = parseInstr(line);
      if (!ins) return;
      if (ins.error) { errors.push({ line: li + 1, text: line, msg: ins.error }); return; }
      ins.line = li + 1;
      ins.src = line;
      if (pendingNote.length) { ins.note = pendingNote.join('\n'); pendingNote = []; }
      steps.push(ins);
    });
    if (!steps.length || steps[steps.length - 1].op !== 'END') steps.push({ op: 'END', name: 'END', cls: 'ctl', operands: [], auto: true });
    // 레이블 모으기
    steps.forEach((s, i) => {
      if (s.op === 'LABEL' || s.op === 'SBRT') {
        const n = s.operands[0].value;
        if (labels[n] != null) errors.push({ line: s.line, text: s.src, msg: `레이블 ${n} 이(가) 두 번 있습니다` });
        labels[n] = i;
      }
    });
    // 구조 검사: 블록 스택 깊이 · MPUSH 짝 · 조건 유무
    let depth = 0, mps = 0, started = false;
    steps.forEach((s, i) => {
      if (s.cls === 'ld' || (s.cls === 'cmp' && s.pos === 'LOAD')) { depth = started ? depth + 1 : 1; started = true; }
      else if (s.op === 'AND LOAD' || s.op === 'OR LOAD') { if (depth < 2) errors.push({ line: s.line, text: s.src, msg: `${s.op} 앞에 묶을 블록이 없습니다` }); else depth--; }
      else if (s.op === 'MPUSH') { mps++; if (mps > 16) errors.push({ line: s.line, text: s.src, msg: 'MPUSH 가 너무 깊습니다 (최대 16)' }); }
      else if (s.op === 'MLOAD') { if (!mps) errors.push({ line: s.line, text: s.src, msg: 'MLOAD 앞에 MPUSH 가 없습니다' }); }
      else if (s.op === 'MPOP') { if (!mps) errors.push({ line: s.line, text: s.src, msg: 'MPOP 앞에 MPUSH 가 없습니다' }); else mps--; }
      else if ((s.cls === 'and' || s.cls === 'or' || (s.cls === 'cmp' && s.pos !== 'LOAD') || s.op === 'NOT') && !started) {
        errors.push({ line: s.line, text: s.src, msg: `${s.name} 앞에 LOAD 가 없습니다` });
      } else if (s.cls === 'out' || s.cls === 'app') {
        if (!started) errors.push({ line: s.line, text: s.src, msg: `${s.name} 앞에 조건(LOAD …)이 없습니다` });
      }
      if (s.cls === 'ctl') { started = false; depth = 0; mps = 0; }
      const next = steps[i + 1];
      if ((s.cls === 'out' || s.cls === 'app') && next && (next.cls === 'ld' || (next.cls === 'cmp' && next.pos === 'LOAD') || next.cls === 'ctl')) {
        if (mps && next.cls !== 'ctl') errors.push({ line: s.line, text: s.src, msg: 'MPUSH 와 MPOP 의 짝이 맞지 않습니다' });
        started = false; depth = 0; mps = 0;
      }
    });
    steps.forEach((s) => {
      if ((s.op === 'JMP' || s.op === 'CALL') && labels[s.operands[0].value] == null) {
        errors.push({ line: s.line, text: s.src, msg: `레이블 ${s.operands[0].value} 이(가) 없습니다` });
      }
    });
    return { steps, labels, comments, errors };
  }
  PLC.parseProgram = parseProgram;

  /** 명령어 한 줄을 표준 표기로 */
  function instrText(ins) {
    return [ins.name].concat(ins.operands.map((o) => o.text)).join(' ');
  }
  PLC.instrText = instrText;

  /** 스텝 수 (교육용 근사: 기본 명령 1 스텝, 응용 명령 1 + 피연산자 수) */
  function stepCount(ins) {
    if (ins.cls === 'ld' || ins.cls === 'and' || ins.cls === 'or' || ins.cls === 'blk') return 1;
    if (ins.op === 'OUT' || ins.op === 'OUT NOT' || ins.op === 'SET' || ins.op === 'RST') return 1;
    if (ins.cls === 'ctl') return 1;
    return 1 + ins.operands.length;
  }
  PLC.stepCount = stepCount;

  // ==================================================================== 실행 오류
  class PlcError extends Error {
    constructor(code, msg, step) { super(msg); this.code = code; this.step = step; }
  }
  PLC.PlcError = PlcError;
  const ERR = { OPERATION: 4100, DIV0: 4100, DEVICE: 4101, WDT: 5001, MCS: 4210, CALL: 4211, FOR: 4200, MODULE: 2110 };

  // ==================================================================== CPU
  class CPU {
    constructor(opts = {}) {
      this.rack = opts.rack || null;
      this.scanMs = opts.scanMs || 10;
      this.state = 'STOP';        // STOP · RUN · ERROR
      this.error = null;
      this.timeMs = 0;
      this.scanCount = 0;
      this.program = { steps: [], labels: {}, comments: {}, errors: [] };
      this.onScan = null;
      this.forcedP = new Map();    // 모듈이 없는 P 를 모니터에서 직접 켠 값
      this.initMemory();
    }

    initMemory() {
      this.w = {};
      Object.keys(DEV).forEach((k) => {
        const d = DEV[k];
        if (d.bit || d.word) this.w[k] = new Int16Array(d.bit ? d.words : d.size);
      });
      this.tmr = { cur: new Int32Array(DEV.T.size), set: new Int32Array(DEV.T.size), contact: new Uint8Array(DEV.T.size), coil: new Uint8Array(DEV.T.size), rem: new Float64Array(DEV.T.size), used: new Uint8Array(DEV.T.size), kind: new Array(DEV.T.size).fill('') };
      this.cnt = { cur: new Int32Array(DEV.C.size), set: new Int32Array(DEV.C.size), contact: new Uint8Array(DEV.C.size), coil: new Uint8Array(DEV.C.size), coil2: new Uint8Array(DEV.C.size), used: new Uint8Array(DEV.C.size), kind: new Array(DEV.C.size).fill('') };
      this.stepS = new Int16Array(DEV.S.blocks);
      this.edge = [];
      this.timeMs = 0;
    }

    load(text) {
      const p = typeof text === 'string' ? parseProgram(text) : text;
      this.program = p;
      this.edge = new Array(p.steps.length).fill(0);
      return p;
    }

    // ---------------------------------------------------------------- 운전 상태
    run() {
      if (this.program.errors.length) { this.setError(3000, '프로그램 오류: ' + this.program.errors[0].msg, null); return false; }
      if (this.state === 'RUN') return true;
      this.clearNonLatch();
      this.state = 'RUN';
      this.error = null;
      this.w.F[2] = 0;
      this.firstScan = true;
      this.runStartMs = this.timeMs;
      if (this.rack) this.rack.onRun(this);
      return true;
    }
    stop() {
      if (this.state === 'RUN') {
        this.clearOutputs();
        if (this.rack) this.rack.outputRefresh(this, true);
      }
      if (this.state !== 'ERROR') this.state = 'STOP';
    }
    /** RESET: 오류 해제 + 래치 이외의 디바이스 초기화 */
    reset() {
      const wasRun = this.state === 'RUN';
      this.state = 'STOP';
      this.error = null;
      this.initMemory();
      if (this.rack) { this.rack.reset(); this.rack.outputRefresh(this, true); }
      return wasRun;
    }
    /** 출력 모듈에 할당된 P 를 모두 끈다 (STOP · 오류 시) */
    clearOutputs() {
      if (!this.rack) { this.w.P.fill(0); return; }
      this.rack.outputPoints().forEach((p) => this.setPoint(p, 0));
    }
    /** STOP → RUN: 래치(K · L)가 아닌 영역과 에지 메모리를 초기화 */
    clearNonLatch() {
      this.edge = new Array(this.program.steps.length).fill(0);
      this.w.M.fill(0);
      this.clearOutputs();
      this.mcsOff = [];
    }
    setError(code, msg, step) {
      this.state = 'ERROR';
      this.error = { code, msg, step, line: step != null && this.program.steps[step] ? this.program.steps[step].line : null, src: step != null && this.program.steps[step] ? this.program.steps[step].src : '' };
      this.setBitAt('F', 0x02, 1);         // F00002 _ERROR
      this.w.F[2] = toS16(code);           // F0002 = 에러 코드
      this.clearOutputs();
      if (this.rack) this.rack.outputRefresh(this, true);
    }

    // ---------------------------------------------------------------- 스캔
    scan(dtMs) {
      const dt = dtMs || this.scanMs;
      if (this.rack) this.rack.inputRefresh(this, dt);
      this.forcedP.forEach((v, p) => { this.setPoint(p, v); });
      this.updateFlags(dt);
      if (this.state === 'RUN') {
        this.dt = dt;
        try {
          this.execute();
        } catch (e) {
          if (e instanceof PlcError) this.setError(e.code, e.message, e.step);
          else { this.setError(9999, '내부 오류: ' + e.message, this.pc); if (typeof console !== 'undefined') console.error(e); }
        }
        this.firstScan = false;
        this.scanCount++;
      }
      if (this.rack) this.rack.outputRefresh(this, false, dt);
      this.timeMs += dt;
      if (this.onScan) this.onScan(this);
    }

    /** F 영역(특수 릴레이) 갱신 */
    updateFlags(dt) {
      const run = this.state === 'RUN';
      const set = (point, v) => this.setBitAt('F', point, v);
      set(0x00, run ? 1 : 0);                       // F00000 _RUN
      set(0x01, run ? 0 : 1);                       // F00001 _STOP
      set(0x02, this.state === 'ERROR' ? 1 : 0);    // F00002 _ERROR
      const t = this.timeMs;
      const clk = (period) => ((t % period) < period / 2 ? 0 : 1);
      set(0x90, clk(20));      // F00090 _T20MS
      set(0x91, clk(100));     // F00091 _T100MS
      set(0x92, clk(200));     // F00092 _T200MS
      set(0x93, clk(1000));    // F00093 _T1S
      set(0x94, clk(2000));    // F00094 _T2S
      set(0x95, clk(10000));   // F00095 _T10S
      set(0x96, clk(20000));   // F00096 _T20S
      set(0x97, clk(60000));   // F00097 _T60S
      set(0x99, 1);            // F00099 _ON  (항상 ON)
      set(0x9A, 0);            // F0009A _OFF (항상 OFF)
      set(0x9B, run && this.firstScan ? 1 : 0);     // F0009B _1ON  첫 스캔 ON
      set(0x9C, run && this.firstScan ? 0 : 1);     // F0009C _1OFF 첫 스캔 OFF
      set(0x9D, this.scanCount % 2 ? 1 : 0);        // F0009D _STOG 매 스캔 반전
      // 스캔 타임 (0.1ms 단위) F0050 최대 · F0051 최소 · F0052 현재
      const cur = Math.round(dt * 10);
      this.w.F[52] = toS16(cur);
      if (!this.scanMax || cur > this.scanMax) this.scanMax = cur;
      if (!this.scanMin || cur < this.scanMin) this.scanMin = cur;
      this.w.F[50] = toS16(this.scanMax);
      this.w.F[51] = toS16(this.scanMin);
      // RTC F0053~F0056 (상위/하위 바이트에 BCD 로 월/년 · 시/일 · 초/분 · 년대/요일)
      const now = PLC.clock ? PLC.clock() : new Date();
      const bcd = (v) => ((Math.floor(v / 10) << 4) | (v % 10)) & 0xFF;
      this.w.F[53] = toS16((bcd(now.getMonth() + 1) << 8) | bcd(now.getFullYear() % 100));
      this.w.F[54] = toS16((bcd(now.getHours()) << 8) | bcd(now.getDate()));
      this.w.F[55] = toS16((bcd(now.getSeconds()) << 8) | bcd(now.getMinutes()));
      this.w.F[56] = toS16((bcd(Math.floor(now.getFullYear() / 100)) << 8) | bcd(now.getDay()));
    }

    // ---------------------------------------------------------------- 디바이스 읽기/쓰기
    idx(o) { return o.z != null ? this.w.Z[o.z] : 0; }

    /** 비트 번호(점)로 직접 읽고 쓰기 — 모듈 · 랙이 쓴다 */
    getPoint(point, dev) {
      const arr = this.w[dev || 'P'];
      const wi = point >> 4;
      if (wi >= arr.length) return 0;
      return (arr[wi] >> (point & 15)) & 1;
    }
    setPoint(point, v, dev) {
      const arr = this.w[dev || 'P'];
      const wi = point >> 4;
      if (wi >= arr.length) return;
      const m = 1 << (point & 15);
      arr[wi] = toS16(v ? (arr[wi] | m) : (arr[wi] & ~m));
    }
    setBitAt(dev, point, v) { this.setPoint(point, v, dev); }

    readBit(o) {
      if (o.kind !== 'dev') throw new PlcError(ERR.DEVICE, `비트로 읽을 수 없는 피연산자: ${o.text}`, this.pc);
      const d = DEV[o.dev];
      if (d.timer) return this.tmr.contact[o.word + this.idx(o)] | 0;
      if (d.counter) return this.cnt.contact[o.word + this.idx(o)] | 0;
      if (d.step) return this.stepS[o.word] === o.bit ? 1 : 0;
      if (o.bit == null) throw new PlcError(ERR.DEVICE, `비트가 아닌 디바이스입니다: ${o.text}`, this.pc);
      if (d.bit) return this.getPoint(o.point + this.idx(o), o.dev);
      // 워드 디바이스의 비트 지정 (D00010.A)
      const a = o.word + this.idx(o);
      return (this.readWordDev(o.dev, a) >> o.bit) & 1;
    }
    writeBit(o, v) {
      const d = DEV[o.dev];
      if (d.timer) { this.tmr.contact[o.word + this.idx(o)] = v ? 1 : 0; return; }
      if (d.counter) { this.cnt.contact[o.word + this.idx(o)] = v ? 1 : 0; return; }
      if (d.step) { if (v) this.stepS[o.word] = o.bit; return; }
      if (d.sys && o.word < 1024) return;         // F0000~F1023 은 읽기 전용
      if (d.bit) { this.setPoint(o.point + this.idx(o), v, o.dev); return; }
      const a = o.word + this.idx(o);
      const w = this.readWordDev(o.dev, a);
      this.writeWordDev(o.dev, a, v ? (w | (1 << o.bit)) : (w & ~(1 << o.bit)));
    }
    readWordDev(dev, a) {
      if (dev === 'T') return this.tmr.cur[a] & 0xFFFF;
      if (dev === 'C') return this.cnt.cur[a] & 0xFFFF;
      const arr = this.w[dev];
      if (!arr || a < 0 || a >= arr.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${dev}${a}`, this.pc);
      return arr[a];
    }
    writeWordDev(dev, a, v) {
      if (dev === 'T') { this.tmr.cur[a] = v & 0xFFFF; return; }
      if (dev === 'C') { this.cnt.cur[a] = v & 0xFFFF; return; }
      const arr = this.w[dev];
      if (!arr || a < 0 || a >= arr.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${dev}${a}`, this.pc);
      if (dev === 'F' && a < 1024) return;        // 시스템 영역 보호
      arr[a] = toS16(v);
    }
    readU(o, off = 0) {
      if (!this.rack) throw new PlcError(ERR.MODULE, `특수 모듈이 없습니다: ${o.text}`, this.pc);
      const v = this.rack.readBuffer(o.slot, o.addr + this.idx(o) + off);
      if (v == null) throw new PlcError(ERR.MODULE, `${o.text}: 해당 슬롯에 특수 모듈이 없습니다`, this.pc);
      return v;
    }
    writeU(o, v, off = 0) {
      if (!this.rack || !this.rack.writeBuffer(o.slot, o.addr + this.idx(o) + off, toS16(v))) {
        throw new PlcError(ERR.MODULE, `${o.text}: 해당 슬롯에 특수 모듈이 없습니다`, this.pc);
      }
    }

    /** 워드 번호 (워드 명령에서 쓰는 번호) */
    wordNumOf(o) {
      const d = DEV[o.dev];
      if (d.bit) {
        if (o.wordNum == null) throw new PlcError(ERR.DEVICE, `워드로 쓸 수 없는 표기입니다: ${o.text} (워드는 ${o.dev}0000 처럼 씁니다)`, this.pc);
        return o.wordNum;
      }
      return o.word;
    }

    /** 16비트 값 읽기 */
    readWord(o, off = 0) {
      switch (o.kind) {
        case 'k': return toS16(o.value);
        case 'r': return toS16(Math.trunc(o.value));
        case 'u': return this.readU(o, off);
        case 'dev': {
          if (o.bit != null && (DEV[o.dev].word || DEV[o.dev].step)) return this.readBit(o);
          const a = this.wordNumOf(o) + this.idx(o) + off;
          return this.readWordDev(o.dev, a);
        }
        default: throw new PlcError(ERR.OPERATION, `워드로 읽을 수 없는 피연산자: ${o.text}`, this.pc);
      }
    }
    writeWord(o, v, off = 0) {
      switch (o.kind) {
        case 'u': this.writeU(o, v, off); return;
        case 'dev': {
          if (o.bit != null && DEV[o.dev].word) { this.writeBit(o, v & 1); return; }
          const a = this.wordNumOf(o) + this.idx(o) + off;
          this.writeWordDev(o.dev, a, toS16(v));
          return;
        }
        default: throw new PlcError(ERR.OPERATION, `쓸 수 없는 피연산자: ${o.text}`, this.pc);
      }
    }
    /** 32비트 값 (하위 워드 + 상위 워드) */
    readDword(o) {
      if (o.kind === 'k') return toS32(o.value);
      if (o.kind === 'r') return Math.trunc(o.value) | 0;
      const lo = this.readWord(o, 0) & 0xFFFF;
      const hi = this.readWord(o, 1) & 0xFFFF;
      return ((hi << 16) | lo) | 0;
    }
    writeDword(o, v) {
      this.writeWord(o, v & 0xFFFF, 0);
      this.writeWord(o, (v >>> 16) & 0xFFFF, 1);
    }
    readReal(o) {
      if (o.kind === 'r' || o.kind === 'k') return o.value;
      const buf = new DataView(new ArrayBuffer(4));
      buf.setUint16(0, this.readWord(o, 0) & 0xFFFF, true);
      buf.setUint16(2, this.readWord(o, 1) & 0xFFFF, true);
      return buf.getFloat32(0, true);
    }
    writeReal(o, f) {
      const buf = new DataView(new ArrayBuffer(4));
      buf.setFloat32(0, f, true);
      this.writeWord(o, buf.getUint16(0, true), 0);
      this.writeWord(o, buf.getUint16(2, true), 1);
    }

    /** 모니터용: 디바이스 표기로 값 읽기 (오류 시 null) */
    peek(text) {
      const o = typeof text === 'string' ? parseOperand(text) : text;
      if (!o || o.kind !== 'dev' && o.kind !== 'u') return null;
      try {
        if (o.kind === 'dev' && DEV[o.dev].bit && o.bit != null && o.preferBit !== false) return this.readBit(o);
        if (o.kind === 'dev' && DEV[o.dev].step) return this.readBit(o);
        if (o.kind === 'dev' && (DEV[o.dev].timer || DEV[o.dev].counter)) return this.readBit(o);
        return this.readWord(o);
      } catch (e) { return null; }
    }
    /** 모니터용: 현재값 변경 */
    poke(text, v) {
      const o = typeof text === 'string' ? parseOperand(text) : text;
      if (!o || o.kind !== 'dev' && o.kind !== 'u') return false;
      try {
        if (o.kind === 'dev' && DEV[o.dev].bit && o.bit != null && o.preferBit !== false) {
          const point = o.point;
          // P 는 입력 단자(모듈)에 직접 쓴다 — 배선된 스위치를 켠 것과 같다
          if (o.dev === 'P' && this.rack && this.rack.hasInput(point)) { this.rack.setInput(point, v); return true; }
          if (o.dev === 'P') { if (v) this.forcedP.set(point, 1); else this.forcedP.delete(point); }
          if (o.dev === 'F' && o.word < 1024) return false;
          this.setPoint(point, v ? 1 : 0, o.dev);
          return true;
        }
        if (o.kind === 'dev' && (DEV[o.dev].timer || DEV[o.dev].counter)) {
          const arr = o.dev === 'T' ? this.tmr : this.cnt;
          arr.cur[o.word] = (+v || 0) & 0xFFFF;
          return true;
        }
        if (o.kind === 'dev' && DEV[o.dev].step) { this.stepS[o.word] = +v || 0; return true; }
        if (o.kind === 'dev' && o.bit != null) { this.writeBit(o, v ? 1 : 0); return true; }
        this.writeWord(o, v);
        return true;
      } catch (e) { return false; }
    }
    /** 타이머/카운터 정보 (모니터 표시용) */
    timerInfo(dev, a) {
      if (dev === 'C') return { cur: this.cnt.cur[a] & 0xFFFF, set: this.cnt.set[a] & 0xFFFF, contact: this.cnt.contact[a], coil: this.cnt.coil[a], kind: this.cnt.kind[a] };
      return { cur: this.tmr.cur[a] & 0xFFFF, set: this.tmr.set[a] & 0xFFFF, contact: this.tmr.contact[a], coil: this.tmr.coil[a], kind: this.tmr.kind[a], unit: timerUnit(a) };
    }

    // ---------------------------------------------------------------- 프로그램 실행
    evalContact(s) {
      const o = s.operands[0];
      const v = this.readBit(o);
      switch (s.op) {
        case 'LOAD': case 'AND': case 'OR': return v;
        case 'LOAD NOT': case 'AND NOT': case 'OR NOT': return v ? 0 : 1;
        default: {   // 펄스 접점: 이 명령이 지난번 실행될 때의 값과 비교
          const prev = this.edge[this.pc];
          this.edge[this.pc] = v;
          const rise = s.op === 'LOADP' || s.op === 'ANDP' || s.op === 'ORP';
          return rise ? (v && !prev ? 1 : 0) : (!v && prev ? 1 : 0);
        }
      }
    }
    evalCompare(s) {
      const [a, b] = s.operands;
      let x, y;
      if (s.width === 'D') { x = this.readDword(a); y = this.readDword(b); }
      else if (s.width === 'R' || s.width === 'L') { x = this.readReal(a); y = this.readReal(b); }
      else if (s.width === 'U') { x = this.readWord(a) & 0xFFFF; y = this.readWord(b) & 0xFFFF; }
      else { x = this.readWord(a); y = this.readWord(b); }
      switch (s.rel) {
        case '=': return x === y ? 1 : 0;
        case '<>': return x !== y ? 1 : 0;
        case '>': return x > y ? 1 : 0;
        case '<': return x < y ? 1 : 0;
        case '>=': return x >= y ? 1 : 0;
        case '<=': return x <= y ? 1 : 0;
      }
      return 0;
    }

    execute() {
      const steps = this.program.steps;
      const labels = this.program.labels;
      let acc = 0;
      let blk = [];
      let mstk = [];
      const callStack = [];
      const forStack = [];
      this.mcsOff = this.mcsOff || [];
      this.mcsOff.length = 0;
      let started = false;
      let budget = 200000;
      let pc = 0;
      while (pc < steps.length) {
        if (--budget < 0) throw new PlcError(ERR.WDT, 'WDT ERROR: 스캔 시간 초과 (무한 반복 · 점프를 확인하세요)', pc);
        const s = steps[pc];
        this.pc = pc;
        let next = pc + 1;
        switch (s.cls) {
          case 'ld':
            if (started) blk.push(acc); else { blk = []; mstk = []; }
            acc = this.evalContact(s);
            started = true;
            break;
          case 'and': acc = acc & this.evalContact(s); break;
          case 'or': acc = acc | this.evalContact(s); break;
          case 'cmp': {
            const v = this.evalCompare(s);
            if (s.pos === 'LOAD') { if (started) blk.push(acc); else { blk = []; mstk = []; } acc = v; started = true; }
            else if (s.pos === 'AND') acc = acc & v;
            else acc = acc | v;
            break;
          }
          case 'blk':
            switch (s.op) {
              case 'AND LOAD': acc = (blk.pop() | 0) & acc; break;
              case 'OR LOAD': acc = (blk.pop() | 0) | acc; break;
              case 'MPUSH': mstk.push(acc); break;
              case 'MLOAD': acc = mstk.length ? mstk[mstk.length - 1] : acc; break;
              case 'MPOP': acc = mstk.length ? mstk.pop() : acc; break;
              case 'NOT': acc = acc ? 0 : 1; break;
            }
            break;
          case 'out': {
            const en = this.mcsEnabled() ? acc : 0;
            this.execOut(s, en, pc);
            break;
          }
          case 'app': {
            const en = this.mcsEnabled() ? acc : 0;
            let run = en;
            if (s.pulse) { const p = this.edge[pc]; this.edge[pc] = en; run = en && !p ? 1 : 0; }
            if (s.op === 'JMP') {
              if (run) { next = labels[s.operands[0].value]; started = false; }
            } else if (s.op === 'CALL') {
              if (run) {
                if (callStack.length > 16) throw new PlcError(ERR.CALL, 'CALL 중첩이 너무 깊습니다', pc);
                callStack.push(pc + 1);
                next = labels[s.operands[0].value];
                started = false;
              }
            } else if (run) {
              this.execApp(s, pc);
            }
            break;
          }
          case 'ctl':
            switch (s.op) {
              case 'END': next = steps.length; break;
              case 'LABEL': break;
              case 'SBRT': break;                          // 서브루틴 시작 표시 (CALL 로 들어온다 · END 뒤에 둔다)
              case 'RET':
                if (!callStack.length) { next = steps.length; break; }
                next = callStack.pop();
                break;
              case 'FOR': {
                const n = Math.max(1, this.readWord(s.operands[0]));
                forStack.push({ pc: pc + 1, left: n });
                break;
              }
              case 'NEXT': {
                const f = forStack[forStack.length - 1];
                if (!f) throw new PlcError(ERR.FOR, 'FOR 없이 NEXT 를 실행했습니다', pc);
                if (--f.left > 0) next = f.pc; else forStack.pop();
                break;
              }
              case 'BREAK': { if (forStack.length) { forStack.pop(); while (next < steps.length && steps[next].op !== 'NEXT') next++; next++; } break; }
              case 'MCSCLR': {
                const n = s.operands[0].value;
                this.mcsOff = this.mcsOff.filter((x) => x < n);
                break;
              }
            }
            if (s.op !== 'FOR' && s.op !== 'NEXT' && s.op !== 'BREAK') { started = false; }
            break;
        }
        pc = next;
      }
      this.acc = acc;
    }
    mcsEnabled() { return !this.mcsOff.length; }

    execOut(s, en, pc) {
      const o = s.operands[0];
      if (s.fb === 'timer') { this.timerFB(s, en); return; }
      if (s.fb === 'counter') { this.counterFB(s, en); return; }
      switch (s.op) {
        case 'OUT':
          if (o.kind === 'dev' && DEV[o.dev].step) { if (en) this.stepS[o.word] = o.bit; return; }   // 후입 우선
          this.writeBit(o, en);
          return;
        case 'OUT NOT': this.writeBit(o, en ? 0 : 1); return;
        case 'OUTP': case 'OUTN': {
          const p = this.edge[pc];
          this.edge[pc] = en;
          const pulse = s.op === 'OUTP' ? (en && !p) : (!en && p);
          this.writeBit(o, pulse ? 1 : 0);
          return;
        }
        case 'SET':
          if (o.kind === 'dev' && DEV[o.dev].step) {   // 순차 제어: 바로 앞 단계에서만 넘어간다
            if (en && (this.stepS[o.word] === o.bit - 1 || o.bit === 0)) this.stepS[o.word] = o.bit;
            return;
          }
          if (en) this.writeBit(o, 1);
          return;
        case 'RST':
          if (!en) return;
          if (o.kind === 'dev' && o.dev === 'T') { const a = o.word + this.idx(o); this.tmr.cur[a] = 0; this.tmr.contact[a] = 0; this.tmr.rem[a] = 0; this.tmr.coil[a] = 0; return; }
          if (o.kind === 'dev' && o.dev === 'C') { const a = o.word + this.idx(o); this.cnt.cur[a] = this.cnt.kind[a] === 'CTD' ? this.cnt.set[a] : 0; this.cnt.contact[a] = 0; return; }
          if (o.kind === 'dev' && DEV[o.dev].step) { this.stepS[o.word] = 0; return; }
          if (o.kind === 'dev' && o.bit != null) this.writeBit(o, 0);
          else this.writeWord(o, 0);
          return;
        case 'FF': {
          const p = this.edge[pc];
          this.edge[pc] = en;
          if (en && !p) this.writeBit(o, this.readBit(o) ? 0 : 1);
          return;
        }
        case 'MCS': {
          const n = o.value;
          if (!en && this.mcsOff.indexOf(n) < 0) this.mcsOff.push(n);
          return;
        }
      }
    }

    /** 타이머 5종 — TON · TOFF · TMR · TMON · TRTG */
    timerFB(s, en) {
      const o = s.operands[0];
      const a = o.word + this.idx(o);
      const t = this.tmr;
      if (a >= t.cur.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${o.text}`, this.pc);
      const set = this.readWord(s.operands[1]) & 0xFFFF;
      t.set[a] = set;
      t.used[a] = 1;
      t.kind[a] = s.op;
      const unit = timerUnit(a);
      const rise = en && !t.coil[a];
      const tick = () => {
        t.rem[a] += this.dt;
        let n = 0;
        while (t.rem[a] >= unit - 1e-9) { t.rem[a] -= unit; n++; if (n > 100000) break; }
        return n;
      };
      switch (s.op) {
        case 'TON':
          if (en) {
            if (rise) { t.cur[a] = 0; t.rem[a] = 0; }
            else { const n = tick(); if (t.cur[a] < set) t.cur[a] = Math.min(set, t.cur[a] + n); }
            if (t.cur[a] >= set) { t.cur[a] = set; t.contact[a] = 1; t.rem[a] = 0; }
          } else { t.cur[a] = 0; t.rem[a] = 0; t.contact[a] = 0; }
          break;
        case 'TOFF':
          if (en) { t.cur[a] = set; t.contact[a] = 1; t.rem[a] = 0; }
          else if (t.contact[a]) {
            const n = tick();
            t.cur[a] = Math.max(0, t.cur[a] - n);
            if (t.cur[a] <= 0) { t.cur[a] = 0; t.contact[a] = 0; t.rem[a] = 0; }
          }
          break;
        case 'TMR':                                   // 적산 타이머 (RST 로만 지움)
          if (en) {
            const n = tick();
            if (t.cur[a] < set) t.cur[a] = Math.min(set, t.cur[a] + n);
            if (t.cur[a] >= set) { t.contact[a] = 1; t.rem[a] = 0; }
          } else t.rem[a] = 0;
          break;
        case 'TMON':                                  // 조건이 들어오면 설정 시간 동안만 ON
          if (rise) { t.cur[a] = set; t.contact[a] = 1; t.rem[a] = 0; }
          else if (t.contact[a]) {
            const n = tick();
            t.cur[a] = Math.max(0, t.cur[a] - n);
            if (t.cur[a] <= 0) { t.cur[a] = 0; t.contact[a] = 0; }
          }
          break;
        case 'TRTG':                                  // 조건이 다시 들어올 때마다 시간이 되살아난다
          if (rise) { t.cur[a] = set; t.contact[a] = 1; t.rem[a] = 0; }
          else if (t.contact[a]) {
            const n = tick();
            t.cur[a] = Math.max(0, t.cur[a] - n);
            if (t.cur[a] <= 0) { t.cur[a] = 0; t.contact[a] = 0; }
          }
          break;
      }
      t.coil[a] = en ? 1 : 0;
    }

    /** 카운터 4종 — CTU · CTD · CTUD · CTR */
    counterFB(s, en) {
      const o = s.operands[0];
      const a = o.word + this.idx(o);
      const c = this.cnt;
      if (a >= c.cur.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${o.text}`, this.pc);
      if (!c.used[a] && s.op === 'CTD') c.cur[a] = this.readWord(s.operands[1]) & 0xFFFF;   // 감산 카운터는 설정값에서 시작
      c.used[a] = 1;
      c.kind[a] = s.op;
      if (s.op === 'CTUD') {
        const set = this.readWord(s.operands[3]) & 0xFFFF;
        c.set[a] = set;
        const up = en ? this.readBit(s.operands[1]) : 0;
        const dn = en ? this.readBit(s.operands[2]) : 0;
        if (up && !c.coil[a]) c.cur[a] = Math.min(65535, c.cur[a] + 1);
        if (dn && !c.coil2[a]) c.cur[a] = Math.max(0, c.cur[a] - 1);
        c.coil[a] = up; c.coil2[a] = dn;
        c.contact[a] = c.cur[a] >= set ? 1 : 0;
        return;
      }
      const set = this.readWord(s.operands[1]) & 0xFFFF;
      c.set[a] = set;
      const rise = en && !c.coil[a];
      switch (s.op) {
        case 'CTU':
          if (rise && c.cur[a] < 65535) c.cur[a]++;
          c.contact[a] = c.cur[a] >= set ? 1 : 0;
          break;
        case 'CTD':
          if (rise && c.cur[a] > 0) c.cur[a]--;
          c.contact[a] = c.cur[a] === 0 ? 1 : 0;
          break;
        case 'CTR':                                    // 링 카운터: 설정값에서 한 번 더 세면 0 으로
          if (rise) { if (c.contact[a]) { c.cur[a] = 0; c.contact[a] = 0; } else { c.cur[a] = Math.min(65535, c.cur[a] + 1); if (c.cur[a] >= set) c.contact[a] = 1; } }
          break;
      }
      c.coil[a] = en ? 1 : 0;
    }

    execApp(s, pc) {
      const o = s.operands;
      const op = s.op;
      const W = (x) => this.readWord(x);
      const U = (x) => this.readWord(x) & 0xFFFF;
      const D = (x) => this.readDword(x);
      const R = (x) => this.readReal(x);
      const bin2bcd = (v, digits) => {
        if (v < 0 || v >= Math.pow(10, digits)) throw new PlcError(ERR.OPERATION, `BCD 변환 범위 초과: ${v}`, pc);
        let r = 0, sh = 0;
        while (v > 0) { r |= (v % 10) << sh; v = Math.floor(v / 10); sh += 4; }
        return r;
      };
      const bcd2bin = (v, digits) => {
        let r = 0, mul = 1;
        for (let i = 0; i < digits; i++) {
          const d = (v >>> (i * 4)) & 0xF;
          if (d > 9) throw new PlcError(ERR.OPERATION, `BCD 가 아닌 값입니다 (자리 ${d.toString(16).toUpperCase()})`, pc);
          r += d * mul; mul *= 10;
        }
        return r;
      };
      switch (op) {
        // ---- 전송
        case 'MOV': this.writeWord(o[1], W(o[0])); return;
        case 'DMOV': this.writeDword(o[1], D(o[0])); return;
        case 'RMOV': this.writeReal(o[1], R(o[0])); return;
        case 'CMOV': this.writeWord(o[1], ~W(o[0])); return;
        case 'DCMOV': this.writeDword(o[1], ~D(o[0])); return;
        case 'XCHG': { const a = W(o[0]), b = W(o[1]); this.writeWord(o[0], b); this.writeWord(o[1], a); return; }
        case 'DXCHG': { const a = D(o[0]), b = D(o[1]); this.writeDword(o[0], b); this.writeDword(o[1], a); return; }
        case 'SWAP': { const v = W(o[0]) & 0xFFFF; this.writeWord(o[0], ((v << 8) | (v >> 8)) & 0xFFFF); return; }
        case 'GMOV': { const n = W(o[2]); const vals = []; for (let i = 0; i < n; i++) vals.push(this.readWord(o[0], i)); vals.forEach((v, i) => this.writeWord(o[1], v, i)); return; }
        case 'FMOV': { const v = W(o[0]), n = W(o[2]); for (let i = 0; i < n; i++) this.writeWord(o[1], v, i); return; }
        case 'BMOV': {   // 지정 비트 전송: 하위 n 비트만 옮긴다
          const n = Math.max(0, Math.min(16, W(o[2])));
          const mask = n >= 16 ? 0xFFFF : ((1 << n) - 1);
          this.writeWord(o[1], (W(o[1]) & ~mask) | (W(o[0]) & mask));
          return;
        }
        case '$MOV': {
          const str = o[0].kind === 'str' ? o[0].value : this.readString(o[0]);
          this.writeString(o[1], str);
          return;
        }
        case '$ADD': {
          const a = o[0].kind === 'str' ? o[0].value : this.readString(o[0]);
          const b = o[1].kind === 'str' ? o[1].value : this.readString(o[1]);
          this.writeString(o[2], a + b);
          return;
        }
        // ---- 사칙 연산 (S1 S2 D)
        case 'ADD': this.writeWord(o[2], W(o[0]) + W(o[1])); return;
        case 'SUB': this.writeWord(o[2], W(o[0]) - W(o[1])); return;
        case 'MUL': this.writeDword(o[2], W(o[0]) * W(o[1])); return;
        case 'DIV': {
          const b = W(o[1]);
          if (b === 0) throw new PlcError(ERR.DIV0, '연산 에러: 0 으로 나눔', pc);
          const a = W(o[0]);
          this.writeWord(o[2], Math.trunc(a / b));
          this.writeWord(o[2], a - Math.trunc(a / b) * b, 1);     // 나머지는 D+1
          return;
        }
        case 'ADDU': this.writeWord(o[2], (U(o[0]) + U(o[1])) & 0xFFFF); return;
        case 'SUBU': this.writeWord(o[2], (U(o[0]) - U(o[1])) & 0xFFFF); return;
        case 'MULU': this.writeDword(o[2], (U(o[0]) * U(o[1])) | 0); return;
        case 'DIVU': {
          const b = U(o[1]);
          if (b === 0) throw new PlcError(ERR.DIV0, '연산 에러: 0 으로 나눔', pc);
          const a = U(o[0]);
          this.writeWord(o[2], Math.trunc(a / b)); this.writeWord(o[2], a % b, 1);
          return;
        }
        case 'DADD': this.writeDword(o[2], (D(o[0]) + D(o[1])) | 0); return;
        case 'DSUB': this.writeDword(o[2], (D(o[0]) - D(o[1])) | 0); return;
        case 'DMUL': this.writeDword(o[2], (D(o[0]) * D(o[1])) | 0); return;
        case 'DDIV': { const b = D(o[1]); if (!b) throw new PlcError(ERR.DIV0, '연산 에러: 0 으로 나눔', pc); this.writeDword(o[2], Math.trunc(D(o[0]) / b)); return; }
        case 'RADD': this.writeReal(o[2], R(o[0]) + R(o[1])); return;
        case 'RSUB': this.writeReal(o[2], R(o[0]) - R(o[1])); return;
        case 'RMUL': this.writeReal(o[2], R(o[0]) * R(o[1])); return;
        case 'RDIV': { const b = R(o[1]); if (!b) throw new PlcError(ERR.DIV0, '연산 에러: 0 으로 나눔', pc); this.writeReal(o[2], R(o[0]) / b); return; }
        case 'INC': this.writeWord(o[0], W(o[0]) + 1); return;
        case 'DEC': this.writeWord(o[0], W(o[0]) - 1); return;
        case 'INCU': this.writeWord(o[0], (U(o[0]) + 1) & 0xFFFF); return;
        case 'DECU': this.writeWord(o[0], (U(o[0]) - 1) & 0xFFFF); return;
        case 'DINC': this.writeDword(o[0], (D(o[0]) + 1) | 0); return;
        case 'DDEC': this.writeDword(o[0], (D(o[0]) - 1) | 0); return;
        case 'NEG': this.writeWord(o[0], -W(o[0])); return;
        case 'DNEG': this.writeDword(o[0], -D(o[0])); return;
        case 'ABS': this.writeWord(o[1], Math.abs(W(o[0]))); return;
        case 'DABS': this.writeDword(o[1], Math.abs(D(o[0]))); return;
        // ---- 논리 연산
        case 'WAND': this.writeWord(o[2], W(o[0]) & W(o[1])); return;
        case 'WOR': this.writeWord(o[2], W(o[0]) | W(o[1])); return;
        case 'WXOR': this.writeWord(o[2], W(o[0]) ^ W(o[1])); return;
        case 'WXNR': this.writeWord(o[2], ~(W(o[0]) ^ W(o[1]))); return;
        case 'DWAND': this.writeDword(o[2], D(o[0]) & D(o[1])); return;
        case 'DWOR': this.writeDword(o[2], D(o[0]) | D(o[1])); return;
        case 'DWXOR': this.writeDword(o[2], D(o[0]) ^ D(o[1])); return;
        // ---- 비교 (CMP: 플래그 F0120~ 에 결과)
        case 'CMP': case 'DCMP': case 'RCMP': {
          const a = op === 'CMP' ? W(o[0]) : op === 'DCMP' ? D(o[0]) : R(o[0]);
          const b = op === 'CMP' ? W(o[1]) : op === 'DCMP' ? D(o[1]) : R(o[1]);
          // F00120 _LT · F00121 _LTE · F00122 _EQU · F00123 _GT · F00124 _GTE · F00125 _NEQ
          const f = [a < b, a <= b, a === b, a > b, a >= b, a !== b];
          f.forEach((v, i) => this.setBitAt('F', 0xC0 + i, v ? 1 : 0));
          return;
        }
        // ---- 변환
        case 'BCD': this.writeWord(o[1], bin2bcd(W(o[0]), 4)); return;
        case 'DBCD': this.writeDword(o[1], bin2bcd(D(o[0]), 8)); return;
        case 'BIN': this.writeWord(o[1], bcd2bin(W(o[0]) & 0xFFFF, 4)); return;
        case 'DBIN': this.writeDword(o[1], bcd2bin(D(o[0]) >>> 0, 8)); return;
        case 'I2R': this.writeReal(o[1], W(o[0])); return;
        case 'D2R': this.writeReal(o[1], D(o[0])); return;
        case 'R2I': { const f = Math.round(R(o[0])); if (f < -32768 || f > 32767) throw new PlcError(ERR.OPERATION, 'R2I 변환 범위 초과', pc); this.writeWord(o[1], f); return; }
        case 'R2D': this.writeDword(o[1], Math.round(R(o[0])) | 0); return;
        case 'SEG': {
          const PAT = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71];
          this.writeWordLow8(o[1], PAT[W(o[0]) & 0xF]);
          return;
        }
        case 'BSUM': { let v = W(o[0]) & 0xFFFF, n = 0; while (v) { n += v & 1; v >>>= 1; } this.writeWord(o[1], n); return; }
        case 'DBSUM': { let v = D(o[0]) >>> 0, n = 0; while (v) { n += v & 1; v >>>= 1; } this.writeWord(o[1], n); return; }
        case 'DECO': {   // DECO S D n : S 의 하위 n 비트를 해독해 D 부터 2^n 비트 중 하나만 1
          const n = Math.max(1, Math.min(8, W(o[2])));
          const v = W(o[0]) & ((1 << n) - 1);
          for (let i = 0; i < (1 << n); i++) this.writeBitOff(o[1], i, i === v ? 1 : 0);
          return;
        }
        case 'ENCO': {
          const n = Math.max(1, Math.min(8, W(o[2])));
          let hi = -1;
          for (let i = 0; i < (1 << n); i++) if (this.readBitOff(o[0], i)) hi = i;
          if (hi < 0) throw new PlcError(ERR.OPERATION, 'ENCO: 켜진 비트가 없습니다', pc);
          this.writeWord(o[1], hi);
          return;
        }
        case 'DIS': { const n = W(o[2]); const v = W(o[0]) & 0xFFFF; for (let i = 0; i < n && i < 4; i++) this.writeWord(o[1], (v >> (i * 4)) & 0xF, i); return; }
        case 'UNI': { const n = W(o[2]); let v = 0; for (let i = 0; i < n && i < 4; i++) v |= (this.readWord(o[0], i) & 0xF) << (i * 4); this.writeWord(o[1], v); return; }
        case 'WTOB': { const n = W(o[2]); for (let i = 0; i < n; i++) { const v = this.readWord(o[0], i) & 0xFFFF; this.writeWord(o[1], v & 0xFF, i * 2); this.writeWord(o[1], (v >> 8) & 0xFF, i * 2 + 1); } return; }
        case 'BTOW': { const n = W(o[2]); for (let i = 0; i < n; i++) this.writeWord(o[1], (this.readWord(o[0], i * 2) & 0xFF) | ((this.readWord(o[0], i * 2 + 1) & 0xFF) << 8), i); return; }
        case 'SUM': { const n = W(o[2]); let v = 0; for (let i = 0; i < n; i++) v += this.readWord(o[0], i); this.writeWord(o[1], v); return; }
        case 'DSUM': { const n = W(o[2]); let v = 0; for (let i = 0; i < n; i++) v += this.readDword(PLC.offsetOp(o[0], i * 2)); this.writeDword(o[1], v | 0); return; }
        case 'AVE': { const n = Math.max(1, W(o[2])); let v = 0; for (let i = 0; i < n; i++) v += this.readWord(o[0], i); this.writeWord(o[1], Math.round(v / n)); return; }
        case 'MAX': case 'MIN': {
          const n = Math.max(1, W(o[2]));
          let best = this.readWord(o[0], 0);
          for (let i = 1; i < n; i++) { const v = this.readWord(o[0], i); best = op === 'MAX' ? Math.max(best, v) : Math.min(best, v); }
          this.writeWord(o[1], best);
          return;
        }
        case 'MUX': { const n = Math.max(1, W(o[3])); const k = Math.max(0, Math.min(n - 1, W(o[0]))); this.writeWord(o[2], this.readWord(o[1], k)); return; }
        case 'SCH': {   // SCH S1 S2 D N : S2 부터 N 개 중 S1 과 같은 값의 위치
          const n = Math.max(1, W(o[3])), target = W(o[0]);
          let pos = 0, cnt = 0;
          for (let i = 0; i < n; i++) if (this.readWord(o[1], i) === target) { if (!cnt) pos = i; cnt++; }
          this.writeWord(o[2], pos); this.writeWord(o[2], cnt, 1);
          return;
        }
        // ---- 회전 · 이동
        case 'ROL': case 'ROR': case 'RCL': case 'RCR': {
          const n = W(o[1]) & 15;
          let v = W(o[0]) & 0xFFFF;
          const right = op === 'ROR' || op === 'RCR';
          for (let i = 0; i < n; i++) {
            if (right) { const b = v & 1; v = (v >>> 1) | (b << 15); this.setBitAt('F', 0xB2, b); }
            else { const b = (v >> 15) & 1; v = ((v << 1) & 0xFFFF) | b; this.setBitAt('F', 0xB2, b); }
          }
          this.writeWord(o[0], v);
          return;
        }
        case 'DROL': case 'DROR': {
          const n = W(o[1]) & 31;
          let v = D(o[0]) >>> 0;
          for (let i = 0; i < n; i++) {
            if (op === 'DROR') { const b = v & 1; v = (v >>> 1) | (b * 0x80000000); }
            else { const b = (v >>> 31) & 1; v = ((v << 1) >>> 0) | b; }
          }
          this.writeDword(o[0], v | 0);
          return;
        }
        case 'BSFL': case 'BSFR': {   // 비트 디바이스 n 점을 1비트 이동 (빈 곳은 0)
          const n = W(o[1]);
          const vals = [];
          for (let i = 0; i < n; i++) vals.push(this.readBitOff(o[0], i));
          for (let i = 0; i < n; i++) this.writeBitOff(o[0], i, op === 'BSFR' ? (i + 1 < n ? vals[i + 1] : 0) : (i > 0 ? vals[i - 1] : 0));
          return;
        }
        case 'BSFT': {   // BSFT St Ed : 시작 비트부터 끝 비트까지 한 칸씩 밀기
          const st = o[0], ed = o[1];
          const from = st.point != null ? st.point : 0, to = ed.point != null ? ed.point : 0;
          const step = to >= from ? 1 : -1;
          for (let p = to; p !== from; p -= step) this.setPoint(p, this.getPoint(p - step, st.dev), st.dev);
          this.setPoint(from, 0, st.dev);
          return;
        }
        case 'WSFT': {
          const n = W(o[1]);
          for (let i = n - 1; i > 0; i--) this.writeWord(o[0], this.readWord(o[0], i - 1), i);
          this.writeWord(o[0], 0, 0);
          return;
        }
        case 'BSET': { const n = W(o[1]) & 15; this.writeWord(o[0], W(o[0]) | (1 << n)); return; }
        case 'BRESET': case 'BRST': { const n = W(o[1]) & 15; this.writeWord(o[0], W(o[0]) & ~(1 << n)); return; }
        // ---- 데이터 제어
        case 'LIMIT': { const v = W(o[0]), lo = W(o[1]), hi = W(o[2]); this.writeWord(o[3], Math.max(lo, Math.min(hi, v))); return; }
        case 'DLIMIT': { const v = D(o[0]), lo = D(o[1]), hi = D(o[2]); this.writeDword(o[3], Math.max(lo, Math.min(hi, v))); return; }
        case 'SCAL': {   // SCAL S1 S2 S3 D : S1 을 (S2 범위 → S3 범위) 로 비례 변환
          const v = W(o[0]);
          const inLo = this.readWord(o[1], 1), inHi = this.readWord(o[1], 0);
          const outLo = this.readWord(o[2], 1), outHi = this.readWord(o[2], 0);
          const span = (inHi - inLo) || 1;
          this.writeWord(o[3], Math.round(outLo + (v - inLo) * (outHi - outLo) / span));
          return;
        }
        // ---- 문자열 · ASCII
        case 'BINDA': { const v = W(o[0]); this.writeString(o[1], (v < 0 ? '-' : ' ') + String(Math.abs(v)).padStart(5, '0')); return; }
        case 'DBINDA': { const v = D(o[0]); this.writeString(o[1], (v < 0 ? '-' : ' ') + String(Math.abs(v)).padStart(10, '0')); return; }
        case 'BINHA': { const v = W(o[0]) & 0xFFFF; this.writeString(o[1], v.toString(16).toUpperCase().padStart(4, '0')); return; }
        case 'DABIN': case 'DDABIN': {
          const txt = this.readString(o[0], op === 'DABIN' ? 6 : 11).replace(/\0.*$/, '').trim();
          const v = parseInt(txt, 10);
          if (!isFinite(v)) throw new PlcError(ERR.OPERATION, `DABIN: 숫자가 아닌 문자열 "${txt}"`, pc);
          if (op === 'DABIN') this.writeWord(o[1], v); else this.writeDword(o[1], v);
          return;
        }
        case 'HABIN': { const txt = this.readString(o[0], 4).trim(); const v = parseInt(txt, 16); if (!isFinite(v)) throw new PlcError(ERR.OPERATION, 'HABIN: 16진 문자열이 아닙니다', pc); this.writeWord(o[1], v); return; }
        case 'ASC': this.writeString(o[1], o[0].kind === 'str' ? o[0].value : this.readString(o[0])); return;
        case 'HEX': { const s = this.readString(o[0]); this.writeWord(o[1], parseInt(s, 16) || 0); return; }
        case 'LEN': this.writeWord(o[1], this.readString(o[0]).length); return;
        // ---- 시간 · 시스템
        case 'DATERD': {   // F0053~F0056 의 시계 데이터를 D ~ D+3 으로
          for (let i = 0; i < 4; i++) this.writeWord(o[0], this.w.F[53 + i], i);
          return;
        }
        case 'DATEWR': return;
        case 'TFLK': {     // TFLK D1 S1 S2 D2 : D1 을 S1 동안 ON, S2 동안 OFF
          const on = W(o[1]), off = W(o[2]);
          const unitW = PLC.offsetOp(o[3], 1);
          const units = [1, 10, 100, 1000];
          const u = units[Math.max(0, Math.min(3, this.readWord(unitW)))] || 100;
          let cur = this.readWord(o[3]) + this.dt / u;
          const state = this.readBit(o[0]);
          let next = state;
          if (state && cur >= on) { next = 0; cur = 0; }
          else if (!state && cur >= off) { next = 1; cur = 0; }
          this.writeWord(o[3], Math.round(cur));
          this.writeBit(o[0], next);
          return;
        }
        case 'DUTY': {     // DUTY D n1 n2 : n1 스캔 ON, n2 스캔 OFF
          const n1 = W(o[1]), n2 = W(o[2]);
          const period = Math.max(1, n1 + n2);
          this.writeBit(o[0], (this.scanCount % period) < n1 ? 1 : 0);
          return;
        }
        case 'STC': this.setBitAt('F', 0xB2, 1); return;
        case 'CLC': this.setBitAt('F', 0xB2, 0); return;
        case 'CLE': this.setBitAt('F', 0xB5, 0); return;
        case 'WDT': return;
        case 'OUTOFF': this.clearOutputs(); return;
        case 'STOP': case 'ESTOP': this.stop(); return;
        case 'EI': case 'DI': return;
        case 'FALS': throw new PlcError(W(o[0]), `FALS: 사용자 지정 에러 ${W(o[0])}`, pc);
        case 'RSET': return;
        // ---- 특수 모듈 (GET · PUT) · 통신 모듈 (SNDUDATA · RCVUDATA)
        case 'GET': {
          const slot = W(o[0]), addr = W(o[1]), n = W(o[3]);
          for (let i = 0; i < n; i++) {
            const v = this.rack ? this.rack.readBuffer(slot, addr + i) : null;
            if (v == null) throw new PlcError(ERR.MODULE, `GET: 슬롯 ${slot} 에 특수 모듈이 없습니다`, pc);
            this.writeWord(o[2], v, i);
          }
          return;
        }
        case 'PUT': {
          const slot = W(o[0]), addr = W(o[1]), n = W(o[3]);
          for (let i = 0; i < n; i++) {
            const val = o[2].kind === 'k' ? W(o[2]) : this.readWord(o[2], i);
            if (!this.rack || !this.rack.writeBuffer(slot, addr + i, val)) throw new PlcError(ERR.MODULE, `PUT: 슬롯 ${slot} 에 특수 모듈이 없습니다`, pc);
          }
          return;
        }
        case 'SNDUDATA': case 'RCVUDATA': {
          const slot = W(o[0]);
          const mod = this.rack && this.rack.slots[slot];
          if (!mod || !mod.serial) throw new PlcError(ERR.MODULE, `${op}: 슬롯 ${slot} 에 통신 모듈이 없습니다`, pc);
          mod.udata(this, op, o, pc);
          return;
        }
      }
      throw new PlcError(4002, `지원하지 않는 명령: ${s.name}`, pc);
    }

    readBitOff(o, i) {
      if (o.kind === 'dev' && DEV[o.dev].bit && o.bit != null) return this.getPoint(o.point + this.idx(o) + i, o.dev);
      return (this.readWord(o, Math.floor(i / 16)) >> (i % 16)) & 1;
    }
    writeBitOff(o, i, v) {
      if (o.kind === 'dev' && DEV[o.dev].bit && o.bit != null) { this.setPoint(o.point + this.idx(o) + i, v, o.dev); return; }
      const w = Math.floor(i / 16), b = i % 16;
      const cur = this.readWord(o, w);
      this.writeWord(o, v ? cur | (1 << b) : cur & ~(1 << b), w);
    }
    writeWordLow8(o, v) {
      // 비트 디바이스에 쓰면 그 비트부터 8점 (7세그먼트 a~g · dp 직접 구동)
      if (o.kind === 'dev' && DEV[o.dev].bit && o.bit != null) {
        for (let i = 0; i < 8; i++) this.writeBitOff(o, i, (v >> i) & 1);
        return;
      }
      this.writeWord(o, (this.readWord(o) & 0xFF00) | (v & 0xFF));
    }
    /** 문자열: 워드당 2문자 (하위 바이트가 앞 문자), 끝에 00H */
    writeString(o, str) {
      const bytes = [];
      for (const ch of String(str)) bytes.push(ch.charCodeAt(0) & 0xFF);
      bytes.push(0);
      if (bytes.length % 2) bytes.push(0);
      for (let i = 0; i < bytes.length; i += 2) this.writeWord(o, bytes[i] | (bytes[i + 1] << 8), i / 2);
    }
    readString(o, maxChars = 64) {
      let s = '';
      for (let i = 0; i < Math.ceil(maxChars / 2); i++) {
        const w = this.readWord(o, i) & 0xFFFF;
        const a = w & 0xFF, b = w >> 8;
        if (!a) break;
        s += String.fromCharCode(a);
        if (!b) break;
        s += String.fromCharCode(b);
      }
      return s;
    }
  }

  /** 디바이스 피연산자를 n 워드 뒤로 */
  function offsetOp(o, n) {
    if (o.kind === 'dev') {
      const c = Object.assign({}, o);
      if (DEV[o.dev].bit) {
        if (o.wordNum != null) { c.wordNum = o.wordNum + n; c.word = c.wordNum; c.point = c.wordNum * 16 + (o.bit || 0); }
        else { c.word = o.word + n; c.point = c.word * 16 + (o.bit || 0); }
        c.text = fmtWord(o.dev, c.wordNum != null ? c.wordNum : c.word);
      } else {
        c.word = o.word + n;
        c.text = fmtWord(o.dev, c.word);
      }
      return c;
    }
    if (o.kind === 'u') return Object.assign({}, o, { addr: o.addr + n });
    return o;
  }
  PLC.offsetOp = offsetOp;

  PLC.CPU = CPU;
})(typeof window !== 'undefined' ? window : globalThis);
