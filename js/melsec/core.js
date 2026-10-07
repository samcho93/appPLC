/* MELSEC PLC 시뮬레이터 — 핵심 엔진
 *  - 디바이스 표기 해석 (X1F, K4M0, D0.5, D0Z1, U4\G11, T0, K10, H1F, E1.5, "ABC")
 *  - 디바이스 메모리 (X Y M L B F SM V / D W R SD Z / T ST C)
 *  - 명령어 리스트(IL) 해석 → 실행 단계
 *  - CPU: 입력 리프레시 → 프로그램 실행 → END 처리(출력 리프레시 · 타이머) 의 스캔 반복
 * 브라우저와 Node(검증 도구) 양쪽에서 동작한다.
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};

  // ==================================================================== 디바이스
  /** 디바이스 종류: 번호 체계(16진/10진) · 비트/워드 · 점수 */
  const DEV = {
    X: { hex: true, bit: true, size: 8192, name: '입력' },
    Y: { hex: true, bit: true, size: 8192, name: '출력' },
    M: { bit: true, size: 32768, name: '내부 릴레이' },
    L: { bit: true, size: 8192, name: '래치 릴레이' },
    B: { hex: true, bit: true, size: 8192, name: '링크 릴레이' },
    F: { bit: true, size: 2048, name: '어넌시에이터' },
    V: { bit: true, size: 2048, name: '에지 릴레이' },
    SM: { bit: true, size: 2048, name: '특수 릴레이' },
    D: { word: true, size: 12288, name: '데이터 레지스터' },
    W: { hex: true, word: true, size: 8192, name: '링크 레지스터' },
    R: { word: true, size: 32768, name: '파일 레지스터' },
    SD: { word: true, size: 2048, name: '특수 레지스터' },
    Z: { word: true, size: 20, name: '인덱스 레지스터' },
    T: { timer: true, size: 2048, name: '타이머' },
    ST: { timer: true, size: 64, name: '적산 타이머' },
    C: { counter: true, size: 1024, name: '카운터' }
  };
  const PREFIXES = ['SM', 'SD', 'ST', 'X', 'Y', 'M', 'L', 'B', 'F', 'V', 'D', 'W', 'R', 'Z', 'T', 'C'];
  PLC.DEV = DEV;

  const toS16 = (v) => ((v & 0xFFFF) << 16) >> 16;
  const toS32 = (v) => v | 0;
  PLC.toS16 = toS16;

  function fmtAddr(dev, addr) {
    const d = DEV[dev];
    return dev + (d && d.hex ? addr.toString(16).toUpperCase() : String(addr));
  }
  PLC.fmtAddr = fmtAddr;

  /**
   * 피연산자 하나를 해석한다.
   * 결과 kind: 'dev'(디바이스) · 'k'(정수 상수) · 'e'(실수 상수) · 'str' · 'digit'(K4X0) · 'buf'(U4\G11) · 'ptr'(P0) · 'nest'(N0)
   */
  function parseOperand(tok) {
    const raw = String(tok).trim();
    const t = raw.toUpperCase();
    let m;
    if ((m = /^"(.*)"$/.exec(raw))) return { kind: 'str', value: m[1].replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t'), text: raw };
    if ((m = /^K(-?\d+)$/.exec(t))) return { kind: 'k', value: parseInt(m[1], 10), text: t };
    if ((m = /^H([0-9A-F]+)$/.exec(t))) return { kind: 'k', value: parseInt(m[1], 16), hex: true, text: t };
    if ((m = /^E(-?\d+(\.\d*)?(E[+-]?\d+)?)$/.exec(t))) return { kind: 'e', value: parseFloat(m[1]), text: t };
    if ((m = /^K([1-8])(X|Y|M|L|B|F|SM|V)([0-9A-F]+)(Z(\d+))?$/.exec(t))) {
      const dev = m[2];
      const addr = parseInt(m[3], DEV[dev].hex ? 16 : 10);
      if (!isFinite(addr)) return null;
      return { kind: 'digit', n: +m[1], dev, addr, z: m[5] != null ? +m[5] : null, text: t };
    }
    if ((m = /^U([0-9A-F]{1,3})\\G(\d+)(Z(\d+))?$/.exec(t))) return { kind: 'buf', head: parseInt(m[1], 16) * 16, addr: parseInt(m[2], 10), z: m[4] != null ? +m[4] : null, text: t };
    if ((m = /^U([0-9A-F]{1,3})$/.exec(t))) return { kind: 'unit', head: parseInt(m[1], 16) * 16, text: t };
    if ((m = /^P(\d+)$/.exec(t))) return { kind: 'ptr', value: +m[1], text: t };
    if ((m = /^N(\d+)$/.exec(t))) return { kind: 'nest', value: +m[1], text: t };
    for (const p of PREFIXES) {
      if (t.indexOf(p) !== 0) continue;
      const rest = t.slice(p.length);
      const d = DEV[p];
      const re = d.hex ? /^([0-9A-F]+)(\.([0-9A-F]))?(Z(\d+))?$/ : /^(\d+)(\.([0-9A-F]))?(Z(\d+))?$/;
      m = re.exec(rest);
      if (!m) continue;
      // 16진 디바이스에서 'Z' 인덱스와 숫자의 구분: X1FZ0 → X1F + Z0 (정규식이 처리)
      const addr = parseInt(m[1], d.hex ? 16 : 10);
      const o = { kind: 'dev', dev: p, addr, text: t };
      if (m[3] != null) o.bit = parseInt(m[3], 16);
      if (m[5] != null) o.z = +m[5];
      if (o.bit != null && !d.word) return null;
      if (addr >= d.size) o.range = true;
      return o;
    }
    return null;
  }
  PLC.parseOperand = parseOperand;

  // ==================================================================== 명령어 표
  /*
   * cls: 'ld'(시작 접점) 'and' 'or' 'cmp'(비교 접점) 'blk'(ANB ORB MPS MRD MPP INV MEP MEF)
   *      'out'(OUT SET RST PLS PLF FF) 'app'(응용 명령) 'ctl'(END FEND CJ CALL RET MC MCR FOR NEXT NOP)
   * ops: 피연산자 개수 [최소, 최대]
   * p: 펄스형(…P) 허용
   */
  const INS = {};
  const def = (names, spec) => names.split(' ').forEach((n) => { INS[n] = Object.assign({ name: n }, spec); });
  def('LD LDI LDP LDF', { cls: 'ld', ops: [1, 1] });
  def('AND ANI ANDP ANDF', { cls: 'and', ops: [1, 1] });
  def('OR ORI ORP ORF', { cls: 'or', ops: [1, 1] });
  def('ANB ORB MPS MRD MPP INV MEP MEF', { cls: 'blk', ops: [0, 0] });
  def('OUT', { cls: 'out', ops: [1, 2] });
  def('OUTH', { cls: 'out', ops: [2, 2] });
  def('SET RST PLS PLF FF', { cls: 'out', ops: [1, 1] });
  def('MC', { cls: 'out', ops: [2, 2] });
  def('MCR', { cls: 'ctl', ops: [1, 1] });
  def('END FEND RET NEXT NOP BREAK', { cls: 'ctl', ops: [0, 0] });
  def('CJ SCJ CALL', { cls: 'app', ops: [1, 1] });
  def('FOR', { cls: 'app', ops: [1, 1] });
  // 전송
  def('MOV DMOV CML DCML EMOV $MOV XCH DXCH NEG DNEG BCD DBCD BIN DBIN FLT DFLT INT DINT DECO ENCO SEG SUM DSUM', { cls: 'app', ops: [2, 3], p: true });
  def('BMOV FMOV', { cls: 'app', ops: [3, 3], p: true });
  // 사칙 연산
  def('+ - D+ D- E+ E- * / D* D/ E* E/ WAND WOR WXOR DAND DOR DXOR', { cls: 'app', ops: [2, 3], p: true });
  def('INC DEC DINC DDEC', { cls: 'app', ops: [1, 1], p: true });
  // 회전 · 이동 · 비트 처리
  def('ROR ROL RCR RCL SFR SFL BSFR BSFL DSFR DSFL', { cls: 'app', ops: [2, 2], p: true });
  def('SFT', { cls: 'app', ops: [1, 1], p: true });
  def('BSET BRST', { cls: 'app', ops: [2, 2], p: true });
  def('LIMIT DLIMIT', { cls: 'app', ops: [4, 4], p: true });
  def('SQR ESQR ABS', { cls: 'app', ops: [2, 2], p: true });
  // 문자열 · ASCII
  def('BINDA DBINDA DABIN DDABIN ASC', { cls: 'app', ops: [2, 2], p: true });
  // 인텔리전트 모듈
  def('FROM TO DFRO DTO', { cls: 'app', ops: [4, 4], p: true });
  def('G.OUTPUT', { cls: 'app', ops: [4, 4] });
  def('G.INPUT', { cls: 'app', ops: [4, 4] });
  def('RTOP', { cls: 'app', ops: [0, 0] });
  PLC.INS = INS;

  const CMP_RE = /^(LD|AND|OR)(D|E)?(=|<>|>=|<=|>|<)$/;

  /** 한 줄의 명령어를 해석한다 → { op, pulse, operands[], cls, ... } 또는 { error } */
  function tokenize(line) {
    const out = [];
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j++;
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

  function lookupOp(name) {
    const n = name.toUpperCase();
    if (INS[n]) return { base: n, pulse: false, info: INS[n] };
    let m = CMP_RE.exec(n);
    if (m) return { base: n, pulse: false, info: { name: n, cls: 'cmp', ops: [2, 2], pos: m[1], width: m[2] || '', rel: m[3] } };
    if (n.length > 1 && n.endsWith('P')) {
      const b = n.slice(0, -1);
      if (INS[b] && INS[b].p) return { base: b, pulse: true, info: INS[b] };
    }
    return null;
  }
  PLC.lookupOp = lookupOp;

  function parseInstr(text) {
    const toks = tokenize(text);
    if (!toks.length) return null;
    const name = toks[0];
    const lk = lookupOp(name);
    if (!lk) return { error: `알 수 없는 명령어: ${name}` };
    const ops = toks.slice(1).map((t) => ({ t, o: parseOperand(t) }));
    const bad = ops.find((x) => !x.o);
    if (bad) return { error: `디바이스 표기 오류: ${bad.t}` };
    const oo = ops.map((x) => x.o);
    const rng = oo.find((o) => o.range);
    if (rng) return { error: `디바이스 범위 초과: ${rng.text}` };
    const [mn, mx] = lk.info.ops;
    if (oo.length < mn || oo.length > mx) return { error: `${name.toUpperCase()} 의 피연산자 수가 맞지 않습니다 (${mn === mx ? mn : mn + '~' + mx}개)` };
    const ins = { op: lk.base, name: name.toUpperCase(), pulse: lk.pulse, cls: lk.info.cls, operands: oo };
    if (lk.info.cls === 'cmp') Object.assign(ins, { pos: lk.info.pos, width: lk.info.width, rel: lk.info.rel });
    const err = checkInstr(ins);
    if (err) return { error: err };
    return ins;
  }
  PLC.parseInstr = parseInstr;

  const isBitOperand = (o) => o && ((o.kind === 'dev' && (DEV[o.dev].bit || DEV[o.dev].timer || DEV[o.dev].counter || o.bit != null)));
  const isWordDst = (o) => o && ((o.kind === 'dev' && (DEV[o.dev].word || DEV[o.dev].timer || DEV[o.dev].counter) && o.bit == null) || o.kind === 'digit' || o.kind === 'buf');
  const isWordSrc = (o) => o && (o.kind === 'k' || o.kind === 'e' || isWordDst(o));

  /** 명령별 피연산자 형식 검사 */
  function checkInstr(ins) {
    const o = ins.operands;
    switch (ins.cls) {
      case 'ld': case 'and': case 'or':
        if (!isBitOperand(o[0])) return `${ins.name} 에는 비트 디바이스가 필요합니다: ${o[0].text}`;
        break;
      case 'cmp':
        if (!isWordSrc(o[0]) || !isWordSrc(o[1])) return `비교 명령에는 워드 디바이스/상수가 필요합니다`;
        break;
      case 'out':
        if (ins.op === 'MC') { if (o[0].kind !== 'nest' || !isBitOperand(o[1])) return 'MC 형식: MC N0 M100'; break; }
        if (ins.op === 'RST') { if (!(isBitOperand(o[0]) || isWordDst(o[0]))) return `RST 대상이 올바르지 않습니다: ${o[0].text}`; break; }
        if (!isBitOperand(o[0])) return `${ins.name} 에는 비트 디바이스가 필요합니다: ${o[0].text}`;
        if (o[0].kind === 'dev' && (o[0].dev === 'X') && ins.op === 'OUT') return null;
        if (ins.op === 'OUT' || ins.op === 'OUTH') {
          const d = o[0].kind === 'dev' ? o[0].dev : '';
          if (d === 'T' || d === 'ST' || d === 'C') {
            if (o.length < 2) return `${o[0].text} 에는 설정값이 필요합니다 (예: OUT ${o[0].text} K10)`;
            if (!(o[1].kind === 'k' || (o[1].kind === 'dev' && DEV[o[1].dev].word))) return `설정값은 K 상수나 D 레지스터여야 합니다`;
          } else if (o.length > 1) return `${ins.name} ${o[0].text} 에는 설정값이 필요 없습니다`;
          if (ins.op === 'OUTH' && d !== 'T' && d !== 'ST') return 'OUTH 는 고속 타이머 전용입니다 (OUTH T0 K100)';
        }
        break;
      case 'ctl':
        if (ins.op === 'MCR' && o[0].kind !== 'nest') return 'MCR 형식: MCR N0';
        break;
      default:
        if ((ins.op === 'CJ' || ins.op === 'SCJ' || ins.op === 'CALL') && o[0].kind !== 'ptr') return `${ins.op} 형식: ${ins.op} P0`;
        break;
    }
    return null;
  }

  /**
   * 명령어 리스트 전체 해석.
   * 줄 형식: 명령어 / "P0" 또는 "P0:" (포인터 라벨) / "; 설명문" (회로 설명) / "@X0 코멘트" (디바이스 코멘트) / "# 주석"
   */
  function parseProgram(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const steps = [];
    const labels = {};
    const comments = {};
    const errors = [];
    let pendingNote = [];
    let pendingLabel = null;
    lines.forEach((raw, li) => {
      const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
      if (!line) return;
      if (line[0] === ';') { pendingNote.push(line.slice(1).trim()); return; }
      if (line[0] === '@') {
        const m = /^@(\S+)\s+(.*)$/.exec(line);
        if (m) { const o = parseOperand(m[1]); if (o) comments[o.text] = m[2].trim(); }
        return;
      }
      let m = /^P(\d+):?$/i.exec(line);
      if (m) { labels[+m[1]] = steps.length; pendingLabel = +m[1]; return; }
      const ins = parseInstr(line);
      if (!ins) return;
      if (ins.error) { errors.push({ line: li + 1, text: line, msg: ins.error }); return; }
      ins.line = li + 1;
      ins.src = line;
      if (pendingNote.length) { ins.note = pendingNote.join('\n'); pendingNote = []; }
      if (pendingLabel != null) { ins.label = pendingLabel; pendingLabel = null; }
      steps.push(ins);
    });
    if (!steps.length || steps[steps.length - 1].op !== 'END') steps.push({ op: 'END', name: 'END', cls: 'ctl', operands: [], auto: true });
    // 구조 검사: 블록 스택 깊이 · MPS 짝
    let depth = 0, mps = 0, started = false;
    steps.forEach((s, i) => {
      if (s.cls === 'ld' || (s.cls === 'cmp' && s.pos === 'LD')) { depth = started ? depth + 1 : 1; started = true; }
      else if (s.op === 'ANB' || s.op === 'ORB') { if (depth < 2) errors.push({ line: s.line, text: s.src, msg: `${s.op} 앞에 묶을 블록이 없습니다` }); else depth--; }
      else if (s.op === 'MPS') { mps++; if (mps > 16) errors.push({ line: s.line, text: s.src, msg: 'MPS 가 너무 깊습니다 (최대 16)' }); }
      else if (s.op === 'MRD') { if (!mps) errors.push({ line: s.line, text: s.src, msg: 'MRD 앞에 MPS 가 없습니다' }); }
      else if (s.op === 'MPP') { if (!mps) errors.push({ line: s.line, text: s.src, msg: 'MPP 앞에 MPS 가 없습니다' }); else mps--; }
      else if ((s.cls === 'and' || s.cls === 'or' || (s.cls === 'cmp' && s.pos !== 'LD') || s.op === 'INV' || s.op === 'MEP' || s.op === 'MEF') && !started) {
        errors.push({ line: s.line, text: s.src, msg: `${s.name} 앞에 LD 가 없습니다` });
      } else if (s.cls === 'out' || s.cls === 'app') {
        const needCond = !(s.op === 'FOR' && !started);
        if (!started && s.op !== 'FOR' && s.op !== 'RTOP') errors.push({ line: s.line, text: s.src, msg: `${s.name} 앞에 조건(LD …)이 없습니다` });
        void needCond;
      }
      if (s.cls === 'ctl' && s.op !== 'NOP') { started = false; depth = 0; mps = 0; }
      const next = steps[i + 1];
      if ((s.cls === 'out' || s.cls === 'app') && next && (next.cls === 'ld' || (next.cls === 'cmp' && next.pos === 'LD') || next.cls === 'ctl')) {
        if (mps && next.cls !== 'ctl') errors.push({ line: s.line, text: s.src, msg: 'MPS 와 MPP 의 짝이 맞지 않습니다' });
        started = false; depth = 0; mps = 0;
      }
    });
    Object.keys(labels).forEach((k) => { if (labels[k] >= steps.length) labels[k] = steps.length - 1; });
    steps.forEach((s) => {
      if ((s.op === 'CJ' || s.op === 'SCJ' || s.op === 'CALL') && labels[s.operands[0].value] == null) {
        errors.push({ line: s.line, text: s.src, msg: `포인터 P${s.operands[0].value} 가 없습니다` });
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
    if (ins.cls === 'ld' || ins.cls === 'and' || ins.cls === 'or' || ins.cls === 'blk') return ins.operands.length && ins.operands[0].kind === 'dev' && ins.operands[0].addr > 0x7FF ? 2 : 1;
    if (ins.op === 'OUT' && ins.operands.length === 2) return 4;
    if (ins.op === 'OUT' || ins.op === 'SET' || ins.op === 'RST') return 1;
    if (ins.op === 'END') return 1;
    return 1 + ins.operands.length;
  }
  PLC.stepCount = stepCount;

  // ==================================================================== 실행 오류
  class PlcError extends Error {
    constructor(code, msg, step) { super(msg); this.code = code; this.step = step; }
  }
  PLC.PlcError = PlcError;
  const ERR = {
    OPERATION: 4100, DIV0: 4100, DEVICE: 4101, WDT: 5001, MC: 4210, CALL: 4210, FOR: 4200, NOEND: 3000, BCD: 4100
  };

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
      this.forcedX = new Map();    // 모듈이 없는 X 를 모니터에서 직접 켠 값
      this.initMemory();
    }

    initMemory() {
      this.bits = {};
      this.words = {};
      Object.keys(DEV).forEach((k) => {
        const d = DEV[k];
        if (d.bit) this.bits[k] = new Uint8Array(d.size);
        if (d.word) this.words[k] = new Int16Array(d.size);
      });
      this.tmr = { T: this.mkTimers(DEV.T.size), ST: this.mkTimers(DEV.ST.size) };
      this.cnt = { cur: new Int16Array(DEV.C.size), set: new Int16Array(DEV.C.size), contact: new Uint8Array(DEV.C.size), coil: new Uint8Array(DEV.C.size) };
      this.edge = [];
      this.timeMs = 0;
    }
    mkTimers(n) {
      return { cur: new Int16Array(n), set: new Int16Array(n), contact: new Uint8Array(n), coil: new Uint8Array(n), rem: new Float64Array(n), used: new Uint8Array(n), hs: new Uint8Array(n) };
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
      this.firstScan = true;
      this.runStartMs = this.timeMs;
      this.bits.SM[0] = 0; this.bits.SM[1] = 0; this.words.SD[0] = 0;
      if (this.rack) this.rack.onRun(this);
      return true;
    }
    stop() {
      if (this.state === 'RUN') {
        // STOP 하면 출력(Y)은 모두 꺼진다
        this.bits.Y.fill(0);
        if (this.rack) this.rack.outputRefresh(this, true);
      }
      if (this.state !== 'ERROR') this.state = 'STOP';
      this.words.SD[200] = 2;
    }
    /** RESET: 오류 해제 + 래치 이외의 디바이스 초기화 */
    reset() {
      const wasRun = this.state === 'RUN';
      this.state = 'STOP';
      this.error = null;
      this.initMemory();
      this.bits.SM[0] = 0; this.bits.SM[1] = 0;
      if (this.rack) { this.rack.reset(); this.rack.outputRefresh(this, true); }
      return wasRun;
    }
    /** STOP → RUN 때: 래치(L)가 아닌 비트 · 워드와 타이머 · 카운터는 그대로 두되 출력 Y 와 에지 메모리를 초기화 */
    clearNonLatch() {
      this.edge = new Array(this.program.steps.length).fill(0);
      this.bits.Y.fill(0);
      this.bits.SM.fill(0);
      this.mcOff = [];
    }
    setError(code, msg, step) {
      this.state = 'ERROR';
      this.error = { code, msg, step, line: step != null && this.program.steps[step] ? this.program.steps[step].line : null, src: step != null && this.program.steps[step] ? this.program.steps[step].src : '' };
      this.bits.SM[0] = 1; this.bits.SM[1] = 1; this.words.SD[0] = code;
      this.bits.Y.fill(0);
      if (this.rack) this.rack.outputRefresh(this, true);
    }

    // ---------------------------------------------------------------- 스캔
    /** 1 스캔 (dtMs = 이번 스캔 시간) */
    scan(dtMs) {
      const dt = dtMs || this.scanMs;
      if (this.rack) this.rack.inputRefresh(this, dt);
      this.forcedX.forEach((v, a) => { this.bits.X[a] = v; });
      this.updateSpecial(dt);
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

    updateSpecial(dt) {
      const SM = this.bits.SM, SD = this.words.SD;
      const run = this.state === 'RUN';
      SM[400] = 1; SM[401] = 0;
      SM[402] = run && this.firstScan ? 1 : 0;
      SM[403] = run && this.firstScan ? 0 : 1;
      const t = this.timeMs;
      const clk = (period) => ((t % period) < period / 2 ? 0 : 1);
      SM[409] = clk(10); SM[410] = clk(100); SM[411] = clk(200); SM[412] = clk(1000); SM[413] = clk(2000);
      SD[520] = Math.round(dt); SD[521] = 0; SD[524] = Math.round(dt); SD[526] = Math.round(dt);
      SD[200] = run ? 0 : 2; SD[203] = run ? 0 : 2;
      if (run) SD[412] = Math.floor((t - (this.runStartMs || 0)) / 1000) & 0x7FFF;
      // 시계 데이터 SD210~SD216 (년 월 일 시 분 초 요일)
      const now = PLC.clock ? PLC.clock() : new Date();
      SD[210] = now.getFullYear(); SD[211] = now.getMonth() + 1; SD[212] = now.getDate();
      SD[213] = now.getHours(); SD[214] = now.getMinutes(); SD[215] = now.getSeconds(); SD[216] = now.getDay();
    }

    // ---------------------------------------------------------------- 디바이스 읽기/쓰기
    idx(o) { return o.z != null ? this.words.Z[o.z] : 0; }

    readBit(o) {
      if (o.kind !== 'dev') throw new PlcError(ERR.DEVICE, `비트로 읽을 수 없는 피연산자: ${o.text}`, this.pc);
      const a = o.addr + this.idx(o);
      if (o.bit != null) return (this.readWordDev(o.dev, a) >> o.bit) & 1;
      if (o.dev === 'T' || o.dev === 'ST') return this.tmr[o.dev].contact[a] | 0;
      if (o.dev === 'C') return this.cnt.contact[a] | 0;
      const arr = this.bits[o.dev];
      if (!arr || a < 0 || a >= arr.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${o.text}`, this.pc);
      return arr[a];
    }
    writeBit(o, v) {
      const a = o.addr + this.idx(o);
      if (o.bit != null) {
        const w = this.readWordDev(o.dev, a);
        this.writeWordDev(o.dev, a, v ? (w | (1 << o.bit)) : (w & ~(1 << o.bit)));
        return;
      }
      if (o.dev === 'T' || o.dev === 'ST') { this.tmr[o.dev].contact[a] = v ? 1 : 0; return; }
      if (o.dev === 'C') { this.cnt.contact[a] = v ? 1 : 0; return; }
      const arr = this.bits[o.dev];
      if (!arr || a < 0 || a >= arr.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${o.text}`, this.pc);
      arr[a] = v ? 1 : 0;
    }
    readWordDev(dev, a) {
      if (dev === 'T' || dev === 'ST') return this.tmr[dev].cur[a];
      if (dev === 'C') return this.cnt.cur[a];
      const arr = this.words[dev];
      if (!arr || a < 0 || a >= arr.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${dev}${a}`, this.pc);
      return arr[a];
    }
    writeWordDev(dev, a, v) {
      if (dev === 'T' || dev === 'ST') { this.tmr[dev].cur[a] = v; return; }
      if (dev === 'C') { this.cnt.cur[a] = v; return; }
      const arr = this.words[dev];
      if (!arr || a < 0 || a >= arr.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${dev}${a}`, this.pc);
      if (dev === 'SD' && a < 200) return;   // 시스템 영역 보호
      arr[a] = v;
    }
    readBuf(o, off = 0) {
      if (!this.rack) throw new PlcError(ERR.DEVICE, `모듈이 없습니다: ${o.text}`, this.pc);
      const v = this.rack.readBuffer(o.head, o.addr + this.idx(o) + off);
      if (v == null) throw new PlcError(2110, `${o.text}: 해당 슬롯에 인텔리전트 모듈이 없습니다`, this.pc);
      return v;
    }
    writeBuf(o, v, off = 0) {
      if (!this.rack || !this.rack.writeBuffer(o.head, o.addr + this.idx(o) + off, toS16(v))) throw new PlcError(2110, `${o.text}: 해당 슬롯에 인텔리전트 모듈이 없습니다`, this.pc);
    }

    /** 16비트 값 읽기 */
    readWord(o, off = 0) {
      switch (o.kind) {
        case 'k': return toS16(o.value);
        case 'e': return toS16(Math.trunc(o.value));
        case 'dev': {
          if (o.bit != null) return this.readBit(o);
          const a = o.addr + this.idx(o) + off;
          if (DEV[o.dev].bit) {            // 비트 디바이스 16점을 워드로 (예: MOV M0 → K4M0 로 해석)
            let v = 0;
            for (let i = 0; i < 16; i++) v |= (this.bits[o.dev][a * 1 + i] ? 1 : 0) << i;
            return toS16(v);
          }
          return this.readWordDev(o.dev, a);
        }
        case 'digit': {
          let v = 0;
          const base = o.addr + (o.z != null ? this.words.Z[o.z] : 0) + off * o.n * 4;
          const arr = this.bits[o.dev];
          for (let i = 0; i < o.n * 4 && i < 16; i++) v |= (arr[base + i] ? 1 : 0) << i;
          return o.n >= 4 ? toS16(v) : v;
        }
        case 'buf': return this.readBuf(o, off);
        default: throw new PlcError(ERR.OPERATION, `워드로 읽을 수 없는 피연산자: ${o.text}`, this.pc);
      }
    }
    writeWord(o, v, off = 0) {
      switch (o.kind) {
        case 'dev': {
          if (o.bit != null) { this.writeBit(o, v & 1); return; }
          const a = o.addr + this.idx(o) + off;
          if (DEV[o.dev].bit) {
            for (let i = 0; i < 16; i++) this.bits[o.dev][a + i] = (v >> i) & 1;
            return;
          }
          this.writeWordDev(o.dev, a, toS16(v));
          return;
        }
        case 'digit': {
          const base = o.addr + (o.z != null ? this.words.Z[o.z] : 0) + off * o.n * 4;
          const arr = this.bits[o.dev];
          for (let i = 0; i < o.n * 4 && i < 16; i++) {
            if (base + i >= arr.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${o.text}`, this.pc);
            arr[base + i] = (v >> i) & 1;
          }
          return;
        }
        case 'buf': this.writeBuf(o, v, off); return;
        default: throw new PlcError(ERR.OPERATION, `쓸 수 없는 피연산자: ${o.text}`, this.pc);
      }
    }
    /** 32비트 값 (하위 워드 + 상위 워드) */
    readDword(o) {
      if (o.kind === 'k') return toS32(o.value);
      if (o.kind === 'e') return Math.trunc(o.value) | 0;
      if (o.kind === 'digit') {
        let v = 0;
        const base = o.addr + (o.z != null ? this.words.Z[o.z] : 0);
        for (let i = 0; i < o.n * 4; i++) v |= (this.bits[o.dev][base + i] ? 1 : 0) << i;
        return o.n >= 8 ? (v | 0) : v;
      }
      const lo = this.readWord(o, 0) & 0xFFFF;
      const hi = this.readWord(o, 1) & 0xFFFF;
      return ((hi << 16) | lo) | 0;
    }
    writeDword(o, v) {
      if (o.kind === 'digit') {
        const base = o.addr + (o.z != null ? this.words.Z[o.z] : 0);
        for (let i = 0; i < o.n * 4; i++) this.bits[o.dev][base + i] = (v >>> i) & 1;
        return;
      }
      this.writeWord(o, v & 0xFFFF, 0);
      this.writeWord(o, (v >>> 16) & 0xFFFF, 1);
    }
    readFloat(o) {
      if (o.kind === 'e' || o.kind === 'k') return o.value;
      const buf = new DataView(new ArrayBuffer(4));
      buf.setUint16(0, this.readWord(o, 0) & 0xFFFF, true);
      buf.setUint16(2, this.readWord(o, 1) & 0xFFFF, true);
      return buf.getFloat32(0, true);
    }
    writeFloat(o, f) {
      const buf = new DataView(new ArrayBuffer(4));
      buf.setFloat32(0, f, true);
      this.writeWord(o, buf.getUint16(0, true), 0);
      this.writeWord(o, buf.getUint16(2, true), 1);
    }

    /** 모니터용: 디바이스 표기로 값 읽기 (오류 시 null) */
    peek(text) {
      const o = typeof text === 'string' ? parseOperand(text) : text;
      if (!o) return null;
      try {
        if (o.kind === 'dev' && (DEV[o.dev].bit || o.bit != null)) return this.readBit(o);
        if (o.kind === 'dev' && (o.dev === 'T' || o.dev === 'ST' || o.dev === 'C')) return this.readWordDev(o.dev, o.addr);
        return this.readWord(o);
      } catch (e) { return null; }
    }
    /** 모니터용: 현재값 변경 */
    poke(text, v) {
      const o = typeof text === 'string' ? parseOperand(text) : text;
      if (!o) return false;
      try {
        if (o.kind === 'dev' && (DEV[o.dev].bit || o.bit != null)) {
          this.writeBit(o, v ? 1 : 0);
          // X 는 입력 단자(모듈)에 직접 쓴다 — 배선된 스위치를 켠 것과 같다
          if (o.dev === 'X') {
            if (this.rack && this.rack.hasInput(o.addr)) this.rack.setInput(o.addr, v);
            else if (v) this.forcedX.set(o.addr, 1); else this.forcedX.delete(o.addr);
          }
          return true;
        }
        this.writeWord(o, v);
        return true;
      } catch (e) { return false; }
    }
    /** 타이머/카운터 설정값 (모니터 표시용) */
    timerInfo(dev, a) {
      if (dev === 'C') return { cur: this.cnt.cur[a], set: this.cnt.set[a], contact: this.cnt.contact[a], coil: this.cnt.coil[a] };
      const t = this.tmr[dev];
      return { cur: t.cur[a], set: t.set[a], contact: t.contact[a], coil: t.coil[a], hs: t.hs[a] };
    }

    // ---------------------------------------------------------------- 프로그램 실행
    evalContact(s) {
      const o = s.operands[0];
      const v = this.readBit(o);
      switch (s.op) {
        case 'LD': case 'AND': case 'OR': return v;
        case 'LDI': case 'ANI': case 'ORI': return v ? 0 : 1;
        default: {   // 펄스 접점: 이 명령이 지난번 실행될 때의 값과 비교
          const prev = this.edge[this.pc];
          this.edge[this.pc] = v;
          const rise = s.op === 'LDP' || s.op === 'ANDP' || s.op === 'ORP';
          return rise ? (v && !prev ? 1 : 0) : (!v && prev ? 1 : 0);
        }
      }
    }
    evalCompare(s) {
      const [a, b] = s.operands;
      let x, y;
      if (s.width === 'D') { x = this.readDword(a); y = this.readDword(b); }
      else if (s.width === 'E') { x = this.readFloat(a); y = this.readFloat(b); }
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
      this.mcOff = this.mcOff || [];
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
            if (s.pos === 'LD') { if (started) blk.push(acc); else { blk = []; mstk = []; } acc = v; started = true; }
            else if (s.pos === 'AND') acc = acc & v;
            else acc = acc | v;
            break;
          }
          case 'blk':
            switch (s.op) {
              case 'ANB': acc = (blk.pop() | 0) & acc; break;
              case 'ORB': acc = (blk.pop() | 0) | acc; break;
              case 'MPS': mstk.push(acc); break;
              case 'MRD': acc = mstk.length ? mstk[mstk.length - 1] : acc; break;
              case 'MPP': acc = mstk.length ? mstk.pop() : acc; break;
              case 'INV': acc = acc ? 0 : 1; break;
              case 'MEP': { const p = this.edge[pc]; this.edge[pc] = acc; acc = acc && !p ? 1 : 0; break; }
              case 'MEF': { const p = this.edge[pc]; this.edge[pc] = acc; acc = !acc && p ? 1 : 0; break; }
            }
            break;
          case 'out': {
            // 코일 뒤에도 연산 결과는 그대로 남는다 — 이어지는 명령이 같은 조건으로 실행된다
            const en = this.mcEnabled() ? acc : 0;
            this.execOut(s, en, pc);
            break;
          }
          case 'app': {
            const en = (started || s.op === 'FOR') ? (this.mcEnabled() ? acc : 0) : 1;
            let run = en;
            if (s.pulse) { const p = this.edge[pc]; this.edge[pc] = en; run = en && !p ? 1 : 0; }
            if (s.op === 'CJ' || s.op === 'SCJ') {
              if (s.op === 'SCJ') { const p = this.edge[pc] || 0; this.edge[pc] = en; run = p && en; }
              if (run) { next = labels[s.operands[0].value]; started = false; }
            } else if (s.op === 'CALL') {
              if (run) {
                if (callStack.length > 16) throw new PlcError(4211, 'CALL 중첩이 너무 깊습니다', pc);
                callStack.push(pc + 1);
                next = labels[s.operands[0].value];
                started = false;
              }
            } else if (s.op === 'FOR') {
              const n = Math.max(1, this.readWord(s.operands[0]));
              forStack.push({ pc: pc + 1, left: n });
            } else if (run) {
              this.execApp(s, pc);
            }
            break;
          }
          case 'ctl':
            switch (s.op) {
              case 'END': next = steps.length; break;
              case 'FEND': next = steps.length; break;
              case 'RET':
                if (!callStack.length) throw new PlcError(4211, 'CALL 없이 RET 를 실행했습니다', pc);
                next = callStack.pop();
                break;
              case 'NEXT': {
                const f = forStack[forStack.length - 1];
                if (!f) throw new PlcError(ERR.FOR, 'FOR 없이 NEXT 를 실행했습니다', pc);
                if (--f.left > 0) next = f.pc; else forStack.pop();
                break;
              }
              case 'BREAK': break;
              case 'MCR': {
                const n = s.operands[0].value;
                this.mcOff = this.mcOff.filter((x) => x < n);
                break;
              }
            }
            started = false;
            break;
        }
        pc = next;
      }
      this.acc = acc;
    }
    mcEnabled() { return !this.mcOff.length; }

    execOut(s, en, pc) {
      const o = s.operands[0];
      switch (s.op) {
        case 'OUT': case 'OUTH': {
          if (o.kind === 'dev' && (o.dev === 'T' || o.dev === 'ST')) { this.timerCoil(o, s.operands[1], en, s.op === 'OUTH'); return; }
          if (o.kind === 'dev' && o.dev === 'C') { this.counterCoil(o, s.operands[1], en); return; }
          this.writeBit(o, en);
          return;
        }
        case 'SET': if (en) this.writeBit(o, 1); return;
        case 'RST':
          if (!en) return;
          if (o.kind === 'dev' && (o.dev === 'T' || o.dev === 'ST')) {
            const a = o.addr + this.idx(o), t = this.tmr[o.dev];
            t.cur[a] = 0; t.contact[a] = 0; t.rem[a] = 0;
          } else if (o.kind === 'dev' && o.dev === 'C') {
            const a = o.addr + this.idx(o);
            this.cnt.cur[a] = 0; this.cnt.contact[a] = 0;
          } else if (o.kind === 'dev' && (DEV[o.dev].bit || o.bit != null)) this.writeBit(o, 0);
          else this.writeWord(o, 0);
          return;
        case 'PLS': case 'PLF': {
          const p = this.edge[pc];
          this.edge[pc] = en;
          const pulse = s.op === 'PLS' ? (en && !p) : (!en && p);
          this.writeBit(o, pulse ? 1 : 0);
          return;
        }
        case 'FF': {
          const p = this.edge[pc];
          this.edge[pc] = en;
          if (en && !p) this.writeBit(o, this.readBit(o) ? 0 : 1);
          return;
        }
        case 'MC': {
          const n = o.value;
          this.writeBit(s.operands[1], en);
          if (!en && this.mcOff.indexOf(n) < 0) this.mcOff.push(n);
          return;
        }
      }
    }

    timerCoil(o, setOp, en, hs) {
      const a = o.addr + this.idx(o);
      const t = this.tmr[o.dev];
      if (a >= t.cur.length) throw new PlcError(ERR.DEVICE, `디바이스 범위 초과: ${o.text}`, this.pc);
      const set = this.readWord(setOp);
      t.set[a] = set;
      t.used[a] = 1;
      t.hs[a] = hs ? 1 : 0;
      const unit = hs ? 10 : 100;
      const retentive = o.dev === 'ST';
      if (en) {
        if (!t.coil[a]) { t.coil[a] = 1; if (!retentive) { t.cur[a] = 0; t.rem[a] = 0; } }
        else {
          t.rem[a] += this.dt;
          while (t.rem[a] >= unit - 1e-9 && t.cur[a] < set) { t.cur[a]++; t.rem[a] -= unit; }
          if (t.cur[a] >= set) t.rem[a] = 0;
        }
        if (t.cur[a] >= set) t.contact[a] = 1;
      } else {
        t.coil[a] = 0;
        if (!retentive) { t.cur[a] = 0; t.rem[a] = 0; t.contact[a] = 0; }
      }
    }

    counterCoil(o, setOp, en) {
      const a = o.addr + this.idx(o);
      const c = this.cnt;
      const set = this.readWord(setOp);
      c.set[a] = set;
      if (en && !c.coil[a]) {
        if (c.cur[a] < set) c.cur[a]++;
      }
      c.coil[a] = en ? 1 : 0;
      c.contact[a] = c.cur[a] >= set ? 1 : 0;
    }

    execApp(s, pc) {
      const o = s.operands;
      const op = s.op;
      const W = (x) => this.readWord(x);
      const D = (x) => this.readDword(x);
      const F = (x) => this.readFloat(x);
      const bin2bcd = (v, digits) => {
        if (v < 0 || v >= Math.pow(10, digits)) throw new PlcError(4100, `BCD 변환 범위 초과: ${v}`, pc);
        let r = 0, sh = 0;
        while (v > 0) { r |= (v % 10) << sh; v = Math.floor(v / 10); sh += 4; }
        return r;
      };
      const bcd2bin = (v, digits) => {
        let r = 0, mul = 1;
        for (let i = 0; i < digits; i++) {
          const d = (v >>> (i * 4)) & 0xF;
          if (d > 9) throw new PlcError(4100, `BCD 가 아닌 값입니다 (자리 ${d.toString(16).toUpperCase()})`, pc);
          r += d * mul; mul *= 10;
        }
        return r;
      };
      switch (op) {
        // ---- 전송
        case 'MOV': this.writeWord(o[1], W(o[0])); return;
        case 'DMOV': this.writeDword(o[1], D(o[0])); return;
        case 'EMOV': this.writeFloat(o[1], F(o[0])); return;
        case 'CML': this.writeWord(o[1], ~W(o[0])); return;
        case 'DCML': this.writeDword(o[1], ~D(o[0])); return;
        case 'NEG': this.writeWord(o[0], -W(o[0])); return;
        case 'DNEG': this.writeDword(o[0], -D(o[0])); return;
        case 'XCH': { const a = W(o[0]), b = W(o[1]); this.writeWord(o[0], b); this.writeWord(o[1], a); return; }
        case 'DXCH': { const a = D(o[0]), b = D(o[1]); this.writeDword(o[0], b); this.writeDword(o[1], a); return; }
        case 'BMOV': {
          const n = W(o[2]);
          const vals = [];
          for (let i = 0; i < n; i++) vals.push(this.readWord(o[0], i));
          vals.forEach((v, i) => this.writeWord(o[1], v, i));
          return;
        }
        case 'FMOV': { const v = W(o[0]), n = W(o[2]); for (let i = 0; i < n; i++) this.writeWord(o[1], v, i); return; }
        case '$MOV': {
          const str = o[0].kind === 'str' ? o[0].value : this.readString(o[0]);
          this.writeString(o[1], str);
          return;
        }
        // ---- 사칙 연산 (2개: D = D op S / 3개: D = S1 op S2)
        case '+': case '-': case '*': case '/': case 'D+': case 'D-': case 'D*': case 'D/':
        case 'E+': case 'E-': case 'E*': case 'E/': {
          const three = o.length === 3;
          const s1 = three ? o[0] : o[1];
          const s2 = three ? o[1] : o[0];
          const dst = three ? o[2] : o[1];
          const kind = op[0] === 'D' ? 'D' : op[0] === 'E' ? 'E' : '';
          const sym = op.slice(-1);
          if (kind === 'E') {
            const a = F(s1), b = F(s2);
            if (sym === '/' && b === 0) throw new PlcError(ERR.DIV0, 'OPERATION ERROR: 0 으로 나눔', pc);
            this.writeFloat(dst, sym === '+' ? a + b : sym === '-' ? a - b : sym === '*' ? a * b : a / b);
            return;
          }
          if (kind === 'D') {
            const a = D(s1), b = D(s2);
            if (sym === '+') this.writeDword(dst, (a + b) | 0);
            else if (sym === '-') this.writeDword(dst, (a - b) | 0);
            else if (sym === '*') { const r = a * b; this.writeDword(dst, r | 0); this.writeDword(offsetOp(dst, 2), Math.floor(r / 4294967296) | 0); }
            else {
              if (b === 0) throw new PlcError(ERR.DIV0, 'OPERATION ERROR: 0 으로 나눔', pc);
              const q = Math.trunc(a / b); this.writeDword(dst, q); this.writeDword(offsetOp(dst, 2), a - q * b);
            }
            return;
          }
          const a = W(s1), b = W(s2);
          if (sym === '+') this.writeWord(dst, a + b);
          else if (sym === '-') this.writeWord(dst, a - b);
          else if (sym === '*') this.writeDword(dst, a * b);    // 결과는 32비트 (D, D+1)
          else {
            if (b === 0) throw new PlcError(ERR.DIV0, 'OPERATION ERROR: 0 으로 나눔', pc);
            const q = Math.trunc(a / b);
            this.writeWord(dst, q);
            this.writeWord(dst, a - q * b, 1);                   // 나머지는 D+1
          }
          return;
        }
        case 'INC': this.writeWord(o[0], W(o[0]) + 1); return;
        case 'DEC': this.writeWord(o[0], W(o[0]) - 1); return;
        case 'DINC': this.writeDword(o[0], (D(o[0]) + 1) | 0); return;
        case 'DDEC': this.writeDword(o[0], (D(o[0]) - 1) | 0); return;
        case 'WAND': case 'WOR': case 'WXOR': {
          const three = o.length === 3;
          const a = W(three ? o[0] : o[1]), b = W(three ? o[1] : o[0]);
          const r = op === 'WAND' ? a & b : op === 'WOR' ? a | b : a ^ b;
          this.writeWord(three ? o[2] : o[1], r);
          return;
        }
        case 'DAND': case 'DOR': case 'DXOR': {
          const three = o.length === 3;
          const a = D(three ? o[0] : o[1]), b = D(three ? o[1] : o[0]);
          const r = op === 'DAND' ? a & b : op === 'DOR' ? a | b : a ^ b;
          this.writeDword(three ? o[2] : o[1], r);
          return;
        }
        // ---- 변환
        case 'BCD': this.writeWord(o[1], bin2bcd(W(o[0]), 4)); return;
        case 'DBCD': this.writeDword(o[1], bin2bcd(D(o[0]), 8)); return;
        case 'BIN': this.writeWord(o[1], bcd2bin(W(o[0]) & 0xFFFF, 4)); return;
        case 'DBIN': this.writeDword(o[1], bcd2bin(D(o[0]) >>> 0, 8)); return;
        case 'FLT': this.writeFloat(o[1], W(o[0])); return;
        case 'DFLT': this.writeFloat(o[1], D(o[0])); return;
        case 'INT': { const f = Math.round(F(o[0])); if (f < -32768 || f > 32767) throw new PlcError(4140, 'INT 변환 범위 초과', pc); this.writeWord(o[1], f); return; }
        case 'DINT': this.writeDword(o[1], Math.round(F(o[0])) | 0); return;
        case 'ABS': this.writeWord(o[1], Math.abs(W(o[0]))); return;
        case 'SQR': this.writeWord(o[1], Math.floor(Math.sqrt(Math.max(0, W(o[0]))))); return;
        case 'ESQR': this.writeFloat(o[1], Math.sqrt(Math.max(0, F(o[0])))); return;
        case 'LIMIT': { const lo = W(o[0]), hi = W(o[1]), v = W(o[2]); this.writeWord(o[3], Math.max(lo, Math.min(hi, v))); return; }
        case 'DLIMIT': { const lo = D(o[0]), hi = D(o[1]), v = D(o[2]); this.writeDword(o[3], Math.max(lo, Math.min(hi, v))); return; }
        case 'DECO': {   // DECO S D n : S 의 하위 n 비트를 해독해 D 부터 2^n 비트 중 하나만 1
          const n = Math.max(1, Math.min(8, o.length > 2 ? W(o[2]) : 4));
          const v = W(o[0]) & ((1 << n) - 1);
          for (let i = 0; i < (1 << n); i++) this.writeBitOff(o[1], i, i === v ? 1 : 0);
          return;
        }
        case 'ENCO': {
          const n = Math.max(1, Math.min(8, o.length > 2 ? W(o[2]) : 4));
          let hi = -1;
          for (let i = 0; i < (1 << n); i++) if (this.readBitOff(o[0], i)) hi = i;
          if (hi < 0) throw new PlcError(4100, 'ENCO: 켜진 비트가 없습니다', pc);
          this.writeWord(o[1], hi);
          return;
        }
        case 'SEG': {
          const PAT = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71];
          this.writeWordLow8(o[1], PAT[W(o[0]) & 0xF]);
          return;
        }
        case 'SUM': { let v = W(o[0]) & 0xFFFF, n = 0; while (v) { n += v & 1; v >>>= 1; } this.writeWord(o[1], n); return; }
        case 'DSUM': { let v = D(o[0]) >>> 0, n = 0; while (v) { n += v & 1; v >>>= 1; } this.writeWord(o[1], n); return; }
        // ---- 회전 · 이동
        case 'ROR': case 'ROL': case 'RCR': case 'RCL': {
          const n = W(o[1]) & 15;
          let v = W(o[0]) & 0xFFFF;
          const right = op === 'ROR' || op === 'RCR';
          for (let i = 0; i < n; i++) {
            if (right) { const b = v & 1; v = (v >>> 1) | (b << 15); this.bits.SM[700] = b; }
            else { const b = (v >> 15) & 1; v = ((v << 1) & 0xFFFF) | b; this.bits.SM[700] = b; }
          }
          this.writeWord(o[0], v);
          return;
        }
        case 'SFR': case 'SFL': {
          const n = W(o[1]) & 15;
          const v = W(o[0]) & 0xFFFF;
          this.writeWord(o[0], op === 'SFR' ? v >>> n : (v << n) & 0xFFFF);
          return;
        }
        case 'BSFR': case 'BSFL': {   // 비트 디바이스 n 점을 1비트 이동 (빈 곳은 0)
          const n = W(o[1]);
          const vals = [];
          for (let i = 0; i < n; i++) vals.push(this.readBitOff(o[0], i));
          for (let i = 0; i < n; i++) this.writeBitOff(o[0], i, op === 'BSFR' ? (i + 1 < n ? vals[i + 1] : 0) : (i > 0 ? vals[i - 1] : 0));
          return;
        }
        case 'DSFR': case 'DSFL': {
          const n = W(o[1]);
          const vals = [];
          for (let i = 0; i < n; i++) vals.push(this.readWord(o[0], i));
          for (let i = 0; i < n; i++) this.writeWord(o[0], op === 'DSFR' ? (i + 1 < n ? vals[i + 1] : 0) : (i > 0 ? vals[i - 1] : 0), i);
          return;
        }
        case 'SFT': {     // SFT D: D-1 의 상태를 D 로 옮기고 D-1 은 0
          const cur = o[0];
          if (cur.kind !== 'dev' || cur.addr === 0) throw new PlcError(4100, 'SFT 대상 앞의 디바이스가 없습니다', pc);
          const prev = Object.assign({}, cur, { addr: cur.addr - 1 });
          this.writeBit(cur, this.readBit(prev));
          this.writeBit(prev, 0);
          return;
        }
        case 'BSET': { const n = W(o[1]) & 15; this.writeWord(o[0], W(o[0]) | (1 << n)); return; }
        case 'BRST': { const n = W(o[1]) & 15; this.writeWord(o[0], W(o[0]) & ~(1 << n)); return; }
        // ---- ASCII
        case 'BINDA': {   // 부호 + 5자리 10진 ASCII (6문자) + 00H
          const v = W(o[0]);
          const txt = (v < 0 ? '-' : ' ') + String(Math.abs(v)).padStart(5, '0');
          this.writeString(o[1], txt);
          return;
        }
        case 'DBINDA': {
          const v = D(o[0]);
          const txt = (v < 0 ? '-' : ' ') + String(Math.abs(v)).padStart(10, '0');
          this.writeString(o[1], txt);
          return;
        }
        case 'DABIN': case 'DDABIN': {
          const txt = this.readString(o[0], op === 'DABIN' ? 6 : 11).replace(/\0.*$/, '').trim();
          const v = parseInt(txt, 10);
          if (!isFinite(v)) throw new PlcError(4100, `DABIN: 숫자가 아닌 문자열 "${txt}"`, pc);
          if (op === 'DABIN') this.writeWord(o[1], v); else this.writeDword(o[1], v);
          return;
        }
        case 'ASC': this.writeString(o[1], o[0].kind === 'str' ? o[0].value : ''); return;
        // ---- 인텔리전트 모듈 버퍼 메모리
        case 'FROM': case 'DFRO': {
          const head = W(o[0]) * 16, addr = W(o[1]), n = W(o[3]);
          const words = op === 'DFRO' ? n * 2 : n;
          for (let i = 0; i < words; i++) {
            const v = this.rack ? this.rack.readBuffer(head, addr + i) : null;
            if (v == null) throw new PlcError(2110, `FROM: 헤드 주소 H${(head / 16).toString(16).toUpperCase()} 에 인텔리전트 모듈이 없습니다`, pc);
            this.writeWord(o[2], v, i);
          }
          return;
        }
        case 'TO': case 'DTO': {
          const head = W(o[0]) * 16, addr = W(o[1]), n = W(o[3]);
          if (op === 'DTO') {
            const v = D(o[2]);
            for (let i = 0; i < n; i++) {
              if (!this.rack || !this.rack.writeBuffer(head, addr + i * 2, toS16(v & 0xFFFF)) || !this.rack.writeBuffer(head, addr + i * 2 + 1, toS16(v >>> 16))) throw new PlcError(2110, 'TO: 인텔리전트 모듈이 없습니다', pc);
            }
            return;
          }
          const v = W(o[2]);
          for (let i = 0; i < n; i++) {
            const val = o[2].kind === 'k' ? v : this.readWord(o[2], i);
            if (!this.rack || !this.rack.writeBuffer(head, addr + i, val)) throw new PlcError(2110, 'TO: 인텔리전트 모듈이 없습니다', pc);
          }
          return;
        }
        case 'G.OUTPUT': case 'G.INPUT': {
          const u = o[0];
          const head = u.kind === 'unit' ? u.head : (u.kind === 'k' ? u.value * 16 : null);
          const mod = this.rack && this.rack.moduleAt(head);
          if (!mod || !mod.serial) throw new PlcError(2112, `${op}: ${u.text} 에 시리얼 통신 모듈이 없습니다`, pc);
          mod.dedicated(this, op, o, pc);
          return;
        }
        case 'RTOP': return;
      }
      throw new PlcError(4002, `지원하지 않는 명령: ${s.name}`, pc);
    }

    readBitOff(o, i) {
      if (o.kind === 'digit') o = { kind: 'dev', dev: o.dev, addr: o.addr, z: o.z, text: o.text };
      if (o.kind === 'dev' && o.bit == null && DEV[o.dev].bit) return this.readBit(Object.assign({}, o, { addr: o.addr + i }));
      if (o.kind === 'dev' && o.bit == null) return (this.readWord(o, Math.floor(i / 16)) >> (i % 16)) & 1;
      return (this.readWord(o) >> i) & 1;
    }
    writeBitOff(o, i, v) {
      if (o.kind === 'digit') o = { kind: 'dev', dev: o.dev, addr: o.addr, z: o.z, text: o.text };
      if (o.kind === 'dev' && o.bit == null && DEV[o.dev].bit) { this.writeBit(Object.assign({}, o, { addr: o.addr + i }), v); return; }
      const w = Math.floor(i / 16), b = i % 16;
      const cur = this.readWord(o, w);
      this.writeWord(o, v ? cur | (1 << b) : cur & ~(1 << b), w);
    }
    writeWordLow8(o, v) {
      if (o.kind === 'digit' || (o.kind === 'dev' && DEV[o.dev].bit)) {
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
    if (o.kind === 'dev') return Object.assign({}, o, { addr: o.addr + n, text: fmtAddr(o.dev, o.addr + n) });
    if (o.kind === 'buf') return Object.assign({}, o, { addr: o.addr + n });
    if (o.kind === 'digit') return Object.assign({}, o, { addr: o.addr + n * o.n * 4 });
    return o;
  }
  PLC.offsetOp = offsetOp;

  PLC.CPU = CPU;
})(typeof window !== 'undefined' ? window : globalThis);
