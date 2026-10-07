/* 프로젝트(랙 + 설비 + 프로그램) · 시뮬레이션 루프 · 검사식 실행
 *
 * 프로젝트 텍스트:
 *   [rack]      CPU · 베이스 · 슬롯별 모듈 (생략하면 기본 구성)
 *   [io]        현장 장비 (plant.js)
 *   [program]   명령어 리스트
 *   [test]      검사식
 *   [monitor]   디바이스 모니터에 처음 띄울 디바이스 (공백 구분)
 *   [title]     제목 한 줄
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};

  function parseProject(text) {
    const src = String(text || '').replace(/\r/g, '');
    const sec = { rack: '', io: '', program: '', test: '', monitor: '', title: '' };
    if (!/^\s*\[(rack|io|program|test|monitor|title)\]/im.test(src)) { sec.program = src; return sec; }
    let cur = 'program';
    src.split('\n').forEach((line) => {
      const m = /^\s*\[(rack|io|program|test|monitor|title)\]\s*$/i.exec(line);
      if (m) { cur = m[1].toLowerCase(); return; }
      sec[cur] += line + '\n';
    });
    Object.keys(sec).forEach((k) => { sec[k] = sec[k].replace(/\s+$/, ''); });
    sec.title = sec.title.trim();
    return sec;
  }
  function buildProject(p) {
    const parts = [];
    if (p.title) parts.push('[title]\n' + p.title);
    if (p.rack && p.rack.trim()) parts.push('[rack]\n' + p.rack.trim());
    if (p.io && p.io.trim()) parts.push('[io]\n' + p.io.trim());
    parts.push('[program]\n' + String(p.program || '').trim());
    if (p.monitor && p.monitor.trim()) parts.push('[monitor]\n' + p.monitor.trim());
    if (p.test && p.test.trim()) parts.push('[test]\n' + p.test.trim());
    return parts.join('\n\n') + '\n';
  }
  PLC.parseProject = parseProject;
  PLC.buildProject = buildProject;

  // ==================================================================== 시뮬레이션
  class Sim {
    /** p: { rack, io, program, scanMs } (문자열) */
    constructor(p = {}) {
      this.scanMs = p.scanMs || 10;
      this.speed = 1;
      this.listeners = new Set();
      this.setup(p);
    }
    setup(p) {
      this.src = { rack: p.rack || '', io: p.io || '', program: p.program || '' };
      this.rack = new PLC.Rack(p.rack && p.rack.trim() ? p.rack : PLC.DEFAULT_RACK);
      // CPU 파라미터의 스캔 타임 (CPU XGK-CPUE scan=10)
      const sc = +(this.rack.cpuParams && this.rack.cpuParams.scan);
      if (isFinite(sc) && sc >= 1 && sc <= 500) this.scanMs = sc;
      this.cpu = new PLC.CPU({ rack: this.rack, scanMs: this.scanMs });
      this.plant = new PLC.Plant(p.io || '', this.rack);
      this.loadProgram(p.program || '');
      this.plant.writeInputs();
    }
    loadProgram(text) {
      const wasRun = this.cpu.state === 'RUN';
      this.src.program = text;
      this.program = this.cpu.load(text);
      this.grid = null;
      if (wasRun && this.program.errors.length) this.cpu.stop();
      this.emit('program');
      return this.program;
    }
    /** 격자 (지연 계산) */
    getGrid() {
      if (!this.grid) this.grid = PLC.layout(this.program);
      return this.grid;
    }
    /** 디바이스 코멘트: 프로그램(@) + 설비 이름 */
    comments() {
      return Object.assign({}, this.plant.comments(), this.program.comments || {});
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type) { this.listeners.forEach((fn) => { try { fn(type, this); } catch (e) { if (typeof console !== 'undefined') console.error(e); } }); }

    run() { const ok = this.cpu.run(); this.emit('state'); return ok; }
    stop() { this.cpu.stop(); this.emit('state'); }
    reset() {
      this.cpu.reset();
      this.plant = new PLC.Plant(this.src.io, this.rack);
      this.plant.writeInputs();
      this.emit('reset');
    }
    /** 한 스캔: 설비(이전 출력) → 입력 → 프로그램 → 출력 */
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        this.plant.step(this.scanMs);
        this.cpu.scan(this.scanMs);
      }
    }
    /** 시뮬레이션 시간 ms 만큼 진행 */
    advance(ms) {
      this.accum = (this.accum || 0) + ms;
      let n = 0;
      while (this.accum >= this.scanMs && n < 2000) { this.step(1); this.accum -= this.scanMs; n++; }
      if (n >= 2000) this.accum = 0;
      return n;
    }

    // ---------------------------------------------------------------- 실시간 루프 (브라우저)
    start() {
      if (this.raf || typeof requestAnimationFrame === 'undefined') return;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(100, now - last);
        last = now;
        if (!this.paused) this.advance(dt * this.speed);
        this.emit('tick');
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
    halt() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

    // ---------------------------------------------------------------- 값 읽기 (검사식 · 모니터)
    read(name) {
      const up = String(name).toUpperCase();
      if (this.plant.byName[up]) return this.plant.get(up);
      // T0000 · C0000 은 래더에서처럼 접점 상태, TN0000 · CN0000 은 현재값
      let m = /^(TN|CN|TS|CS|T|C)(\d+)$/.exec(up);
      if (m) {
        const i = this.cpu.timerInfo(m[1][0], +m[2]);
        return /^(TN|CN)$/.test(m[1]) ? i.cur : i.contact;
      }
      if ((m = /^(D|R)(\w+):(D|E|R)$/.exec(up))) {
        const o = PLC.parseOperand(m[1] + m[2]);
        return m[3] === 'D' ? this.cpu.readDword(o) : this.cpu.readReal(o);
      }
      if ((m = /^\$(.+)$/.exec(up))) {
        const o = PLC.parseOperand(m[1]);
        return o ? this.cpu.readString(o) : undefined;
      }
      if ((m = /^AD(\d)$/.exec(up))) { const r = this.rack.resolveAnalog('ad', m[1]); return r ? r.mod.input[r.ch] : undefined; }
      if ((m = /^DA(\d)$/.exec(up))) { const r = this.rack.resolveAnalog('da', m[1]); return r ? r.mod.output[r.ch] : undefined; }
      if (up === 'STATE') return this.cpu.state;
      const v = this.cpu.peek(up);
      return v == null ? undefined : v;
    }
    write(name, v) {
      const up = String(name).toUpperCase();
      if (this.plant.byName[up]) return this.plant.set(up, v);
      return this.cpu.poke(up, v);
    }

    // ---------------------------------------------------------------- 검사식
    /**
     * 한 줄 형식
     *   START=1 -> P00020=1 M00000=1   설비 · 디바이스를 정하고 (기본 0.3초 진행) 확인
     *   START=1 t=2 -> T0000=1         t=초 만큼 진행
     *   START=1 scan=1 -> M00000=1     n 스캔만 진행
     *   wait 1.5                       시간만 진행
     *   -> P00020=0                    진행 없이 확인만
     *   reset / run / stop
     *   TERM1="hello"                터미널에서 글자 보내기 (CR LF 자동)
     * 비교: = != > < >= <= ~(포함 · 근사)
     */
    runTests(text, opts = {}) {
      const results = [];
      const lines = String(text || '').replace(/\r/g, '').split('\n');
      if (opts.fresh !== false) { this.reset(); }
      if (opts.autoRun !== false && !this.run()) {
        results.push({ ok: false, line: 0, text: 'RUN', msg: 'RUN 할 수 없습니다: ' + (this.cpu.error ? this.cpu.error.msg : '') });
        return results;
      }
      if (opts.settle !== false) this.advance(opts.settle || 200);   // RUN 직후 안정화
      for (let li = 0; li < lines.length; li++) {
        let line = lines[li].replace(/^\s*!\s*/, '').replace(/\s+#.*$/, '').trim();
        if (!line || line[0] === '#') continue;
        const low = line.toLowerCase();
        if (low === 'reset') { this.reset(); this.run(); continue; }
        if (low === 'run') { this.run(); continue; }
        if (low === 'stop') { this.stop(); continue; }
        line = line.replace(/^wait\s+([\d.]+)\s*->/i, 't=$1 ->').replace(/^scan\s+(\d+)\s*->/i, 'scan=$1 ->');
        let m = /^wait\s+([\d.]+)$/i.exec(line);
        if (m) { this.advance(parseFloat(m[1]) * 1000); continue; }
        m = /^scan\s+(\d+)$/i.exec(line);
        if (m) { this.step(+m[1]); continue; }
        const arrow = line.indexOf('->');
        const left = arrow >= 0 ? line.slice(0, arrow).trim() : line;
        const right = arrow >= 0 ? line.slice(arrow + 2).trim() : '';
        let tsec = arrow >= 0 && !left ? 0 : 0.3, scans = null;
        const toks = left.match(/\S+?="[^"]*"|\S+/g) || [];
        let bad = null;
        toks.forEach((tk) => {
          const i = tk.indexOf('=');
          if (i <= 0) { bad = bad || `형식 오류: ${tk}`; return; }
          const k = tk.slice(0, i), vs = tk.slice(i + 1);
          if (k.toLowerCase() === 't') { tsec = parseFloat(vs); return; }
          if (k.toLowerCase() === 'scan') { scans = +vs; return; }
          const v = parseVal(vs);
          if (!this.write(k, v)) bad = bad || `설정할 수 없습니다: ${k}`;
        });
        if (bad) { results.push({ ok: false, line: li + 1, text: line, msg: bad }); continue; }
        if (scans != null) this.step(scans); else if (tsec > 0) this.advance(tsec * 1000);
        if (this.cpu.state === 'ERROR' && !/STATE/i.test(right)) {
          results.push({ ok: false, line: li + 1, text: line, msg: `CPU 오류 ${this.cpu.error.code}: ${this.cpu.error.msg}` });
          break;
        }
        const checks = right.match(/\S+?(?:>=|<=|!=|=|>|<|~)"[^"]*"|\S+/g) || [];
        checks.forEach((c) => {
          const cm = /^(.+?)(>=|<=|!=|=|>|<|~)(.*)$/.exec(c);
          if (!cm) { results.push({ ok: false, line: li + 1, text: line, msg: `확인식 오류: ${c}` }); return; }
          const got = this.read(cm[1]);
          const want = parseVal(cm[3]);
          const ok = compare(got, cm[2], want);
          results.push({ ok, line: li + 1, text: line, check: c, got, msg: ok ? '' : `${cm[1]} = ${fmtVal(got)} (기대: ${cm[2]} ${fmtVal(want)})` });
        });
      }
      return results;
    }
  }
  function parseVal(s) {
    const t = String(s).trim();
    if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\r/g, '\r').replace(/\\n/g, '\n');
    if (/^(ON|TRUE)$/i.test(t)) return 1;
    if (/^(OFF|FALSE)$/i.test(t)) return 0;
    if (/^H[0-9A-F]+$/i.test(t)) return parseInt(t.slice(1), 16);
    if (/^0x[0-9A-F]+$/i.test(t)) return parseInt(t, 16);
    if (/^h[0-9A-F]+$/i.test(t)) return parseInt(t.slice(1), 16);
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    return t.toLowerCase();
  }
  function compare(got, op, want) {
    if (got === undefined || got === null) return false;
    if (typeof want === 'string' || typeof got === 'string') {
      const g = String(got), w = String(want);
      if (op === '~') return g.indexOf(w) >= 0 || g.toLowerCase().indexOf(w.toLowerCase()) >= 0;
      if (op === '=') return g.toLowerCase() === w.toLowerCase();
      if (op === '!=') return g.toLowerCase() !== w.toLowerCase();
      return false;
    }
    const g = +got, w = +want;
    switch (op) {
      case '=': return g === w || Math.abs(g - w) < 1e-6;
      case '!=': return g !== w;
      case '>': return g > w;
      case '<': return g < w;
      case '>=': return g >= w;
      case '<=': return g <= w;
      case '~': return Math.abs(g - w) <= Math.max(2, Math.abs(w) * 0.02);
    }
    return false;
  }
  const fmtVal = (v) => (typeof v === 'string' ? JSON.stringify(v) : v === undefined ? '(없음)' : String(v));
  PLC.Sim = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
