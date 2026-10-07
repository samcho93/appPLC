/* MELSEC Q 시리즈 모듈 카탈로그와 랙(베이스) 구성
 *  - CPU · 베이스 · 입력/출력 · A/D · D/A · 시리얼 통신 모듈
 *  - 입출력 번호 자동 할당 (슬롯 순서대로 점수만큼)
 *  - 인텔리전트 모듈 버퍼 메모리 (U□\G□) 와 입출력 신호
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const toS16 = (v) => ((v & 0xFFFF) << 16) >> 16;

  // ==================================================================== 카탈로그
  const CPUS = {
    Q00UJ: { model: 'Q00UJCPU', steps: 10000, lds: 0.12, eth: false, note: '베이직 모델 (5슬롯 일체형 베이스)' },
    Q02U: { model: 'Q02UCPU', steps: 20000, lds: 0.04, eth: false, note: '유니버설 모델' },
    Q03UD: { model: 'Q03UDCPU', steps: 30000, lds: 0.02, eth: false, note: '유니버설 모델' },
    Q03UDE: { model: 'Q03UDECPU', steps: 30000, lds: 0.02, eth: true, note: '유니버설 모델 · 내장 이더넷 (MC 프로토콜)' },
    Q03UDV: { model: 'Q03UDVCPU', steps: 30000, lds: 0.0019, eth: true, note: '고속 유니버설 모델 · 내장 이더넷' },
    Q04UDEH: { model: 'Q04UDEHCPU', steps: 40000, lds: 0.0095, eth: true, note: '고성능 유니버설 모델 · 내장 이더넷' },
    Q06UDEH: { model: 'Q06UDEHCPU', steps: 60000, lds: 0.0095, eth: true, note: '고성능 유니버설 모델 · 내장 이더넷' },
    Q13UDEH: { model: 'Q13UDEHCPU', steps: 130000, lds: 0.0095, eth: true, note: '고성능 유니버설 모델 · 내장 이더넷' }
  };
  const BASES = { Q33B: 3, Q35B: 5, Q38B: 8, Q312B: 12 };

  /*
   * 모듈 종류
   *  kind: in / out / io / ad / da / serial / empty
   *  pts : 차지하는 입출력 점수
   */
  const MODS = {
    QX40: { kind: 'in', pts: 16, n: 16, desc: 'DC 24V 입력 16점 (싱크)' },
    QX41: { kind: 'in', pts: 32, n: 32, desc: 'DC 24V 입력 32점 (싱크, 40핀 커넥터)' },
    QX42: { kind: 'in', pts: 64, n: 64, desc: 'DC 24V 입력 64점 (싱크)' },
    QX80: { kind: 'in', pts: 16, n: 16, desc: 'DC 24V 입력 16점 (소스)' },
    QX81: { kind: 'in', pts: 32, n: 32, desc: 'DC 24V 입력 32점 (소스)' },
    QY10: { kind: 'out', pts: 16, n: 16, desc: '릴레이 출력 16점 (AC 240V / DC 24V 2A)' },
    QY40P: { kind: 'out', pts: 16, n: 16, desc: '트랜지스터 출력 16점 (싱크 0.1A)' },
    QY41P: { kind: 'out', pts: 32, n: 32, desc: '트랜지스터 출력 32점 (싱크 0.1A, 40핀 커넥터)' },
    QY42P: { kind: 'out', pts: 64, n: 64, desc: '트랜지스터 출력 64점 (싱크 0.1A)' },
    QY80: { kind: 'out', pts: 16, n: 16, desc: '트랜지스터 출력 16점 (소스 0.5A)' },
    QY81P: { kind: 'out', pts: 32, n: 32, desc: '트랜지스터 출력 32점 (소스 0.1A)' },
    QH42P: { kind: 'io', pts: 32, n: 32, desc: '입력 32점 + 출력 32점 (입출력 혼합, 같은 번호)' },
    Q64AD: { kind: 'ad', pts: 16, ch: 4, desc: 'A/D 변환 4채널 (전압/전류, 분해능 1/4000)' },
    Q68ADV: { kind: 'ad', pts: 16, ch: 8, volt: true, desc: 'A/D 변환 8채널 (전압 전용)' },
    Q68ADI: { kind: 'ad', pts: 16, ch: 8, curr: true, desc: 'A/D 변환 8채널 (전류 전용)' },
    Q62DAN: { kind: 'da', pts: 16, ch: 2, desc: 'D/A 변환 2채널 (전압/전류, 분해능 1/4000)' },
    Q64DAN: { kind: 'da', pts: 16, ch: 4, desc: 'D/A 변환 4채널 (전압/전류)' },
    Q68DAVN: { kind: 'da', pts: 16, ch: 8, volt: true, desc: 'D/A 변환 8채널 (전압 전용)' },
    QJ71C24N: { kind: 'serial', pts: 32, ch: 2, ifs: ['RS-232', 'RS-422/485'], desc: '시리얼 통신 2채널 (CH1 RS-232, CH2 RS-422/485)' },
    'QJ71C24N-R2': { kind: 'serial', pts: 32, ch: 2, ifs: ['RS-232', 'RS-232'], desc: '시리얼 통신 2채널 (RS-232 ×2)' },
    'QJ71C24N-R4': { kind: 'serial', pts: 32, ch: 2, ifs: ['RS-422/485', 'RS-422/485'], desc: '시리얼 통신 2채널 (RS-422/485 ×2)' },
    EMPTY: { kind: 'empty', pts: 16, desc: '빈 슬롯 (16점 차지)' }
  };

  /** 아날로그 입출력 범위: 코드 → [최소, 최대, 단위, 디지털 최소, 디지털 최대] */
  const RANGES = {
    '4-20mA': { lo: 4, hi: 20, unit: 'mA', dlo: 0, dhi: 4000, code: 0 },
    '0-20mA': { lo: 0, hi: 20, unit: 'mA', dlo: 0, dhi: 4000, code: 1 },
    '1-5V': { lo: 1, hi: 5, unit: 'V', dlo: 0, dhi: 4000, code: 2 },
    '0-5V': { lo: 0, hi: 5, unit: 'V', dlo: 0, dhi: 4000, code: 3 },
    '-10-10V': { lo: -10, hi: 10, unit: 'V', dlo: -4000, dhi: 4000, code: 4 },
    '0-10V': { lo: 0, hi: 10, unit: 'V', dlo: 0, dhi: 4000, code: 5 }
  };

  PLC.CATALOG = { CPUS, BASES, MODS, RANGES };

  // ==================================================================== 모듈 인스턴스
  class Module {
    constructor(type, params) {
      this.type = type;
      this.spec = MODS[type];
      this.params = params || {};
      this.head = 0;
      this.slot = 0;
      this.xin = null;      // 입력 단자 상태
      this.yout = null;     // 출력 단자 상태
      this.buf = null;
    }
    get kind() { return this.spec.kind; }
    get pts() { return this.spec.pts; }
    reset() {
      const s = this.spec;
      if (s.kind === 'in' || s.kind === 'io') {
        this.xin = new Uint8Array(s.n);
        this.filter = Math.max(0, +this.params.filter || 0);   // 입력 응답 시간 (ms)
        this.xstate = new Uint8Array(s.n);
        this.xtimer = new Float64Array(s.n);
      }
      if (s.kind === 'out' || s.kind === 'io') this.yout = new Uint8Array(s.n);
    }
    /** 입력 응답 시간(필터)을 거친 입력 상태 */
    filtered(dt) {
      if (!this.filter) return this.xin;
      for (let i = 0; i < this.xin.length; i++) {
        if (this.xin[i] === this.xstate[i]) { this.xtimer[i] = 0; continue; }
        this.xtimer[i] += dt;
        if (this.xtimer[i] >= this.filter) { this.xstate[i] = this.xin[i]; this.xtimer[i] = 0; }
      }
      return this.xstate;
    }
    label() { return this.type === 'EMPTY' ? '빈 슬롯' : this.type; }
  }

  // ---------------------------------------------------------------- A/D 변환 모듈 (Q64AD 계열)
  class ADModule extends Module {
    constructor(type, params) {
      super(type, params);
      this.analog = true;
      const n = this.spec.ch;
      const def = this.spec.curr ? '4-20mA' : '0-10V';
      const rs = String(this.params.range || '').split(',').map((x) => x.trim()).filter(Boolean);
      this.ranges = [];
      for (let i = 0; i < n; i++) this.ranges.push(RANGES[rs[i] || rs[0] || def] ? (rs[i] || rs[0] || def) : def);
      this.input = new Array(n).fill(0);     // 아날로그 입력 (V 또는 mA)
      // 채널 변환 허가 (en=1,1,0,0) · 평균 처리 (avg=s,t100,c50,s : 샘플링 · 시간 평균 ms · 횟수 평균)
      const en = String(this.params.en || '').split(',').map((x) => x.trim()).filter((x) => x !== '');
      this.chEnable = [];
      for (let i = 0; i < n; i++) this.chEnable.push(en.length ? en[i] !== '0' : true);
      const av = String(this.params.avg || '').split(',').map((x) => x.trim().toLowerCase());
      this.avgMode = [];
      for (let i = 0; i < n; i++) {
        const a = av[i] || av[0] || 's';
        const m = /^([stc])(\d+)?$/.exec(a);
        this.avgMode.push(m && m[1] !== 's' ? { kind: m[1], n: +(m[2] || (m[1] === 't' ? 100 : 10)) } : { kind: 's' });
      }
      this.reset();
    }
    reset() {
      const n = this.spec.ch;
      this.buf = new Int16Array(200);
      this.value = new Array(n).fill(0);
      this.maxv = new Array(n).fill(-32768);
      this.minv = new Array(n).fill(32767);
      this.ready = false;
      this.readyMs = 0;
      this.acc = new Array(n).fill(0);
      this.accN = new Array(n).fill(0);
      this.accMs = new Array(n).fill(0);
      // 버퍼 메모리 초기값: G0 변환 허가/금지 · G9 평균 처리 지정 · G1~ 평균 시간/횟수
      let dis = 0, spec = 0;
      this.chEnable.forEach((e, i) => { if (!e) dis |= 1 << i; });
      this.avgMode.forEach((a, i) => {
        if (a.kind === 't') { spec |= 1 << (i * 2); this.buf[1 + i] = a.n; }
        else if (a.kind === 'c') { spec |= 2 << (i * 2); this.buf[1 + i] = a.n; }
      });
      this.buf[0] = dis;
      this.buf[9] = spec;
    }
    rangeOf(ch) { return RANGES[this.ranges[ch]]; }
    /** 아날로그 값 → 디지털 값 (Q64AD 표준 분해능 모드) */
    convert(ch, v) {
      const r = this.rangeOf(ch);
      let d = r.dlo + (v - r.lo) / (r.hi - r.lo) * (r.dhi - r.dlo);
      d = Math.round(d);
      const min = r.dlo < 0 ? -4096 : -96;
      return Math.max(min, Math.min(4095, d));
    }
    update(cpu, dt) {
      const n = this.spec.ch;
      const b = this.buf;
      this.readyMs += dt;
      if (!this.ready && this.readyMs >= 20) this.ready = true;
      let doneAll = true;
      let doneBits = 0;
      for (let i = 0; i < n; i++) {
        const enabled = !((b[0] >> i) & 1);
        if (!enabled || !this.ready) { doneAll = doneAll && !enabled; continue; }
        const raw = this.convert(i, this.input[i]);
        // 평균 처리 (G9 · G1~G4): 0 샘플링 · 1 시간 평균(ms) · 2 횟수 평균
        const mode = (b[9] >> (i * 2)) & 3;
        let d = raw;
        if (mode === 1 || mode === 2) {
          this.acc[i] += raw;
          this.accN[i]++;
          this.accMs[i] += dt;
          const target = b[1 + i] || (mode === 1 ? 100 : 10);
          const done = mode === 1 ? this.accMs[i] >= target : this.accN[i] >= target;
          if (done) {
            this.value[i] = Math.round(this.acc[i] / Math.max(1, this.accN[i]));
            this.acc[i] = 0; this.accN[i] = 0; this.accMs[i] = 0;
          }
          d = this.value[i];
        }
        this.value[i] = d;
        b[11 + i] = d;
        doneBits |= 1 << i;
        if (d > this.maxv[i]) this.maxv[i] = d;
        if (d < this.minv[i]) this.minv[i] = d;
        b[30 + i * 2] = this.maxv[i];
        b[31 + i * 2] = this.minv[i];
      }
      b[10] = doneBits;
      let rc = 0;
      for (let i = 0; i < n; i++) rc |= (RANGES[this.ranges[i]].code & 0xF) << (i * 4);
      b[20] = toS16(rc & 0xFFFF);
      if (n > 4) b[21] = toS16((rc >>> 16) & 0xFFFF);
      this.flags = { ready: this.ready, done: this.ready && doneBits !== 0 && doneAll, setDone: true, err: false };
    }
    /** 입력 신호 X(n+0) READY, X(n+9) 동작 조건 설정 완료, X(n+E) 변환 완료, X(n+F) 에러 */
    xSignal(i) {
      const f = this.flags || {};
      if (i === 0x0) return f.ready ? 1 : 0;
      if (i === 0x9) return f.setDone ? 1 : 0;
      if (i === 0xE) return f.done ? 1 : 0;
      if (i === 0xF) return f.err ? 1 : 0;
      return 0;
    }
    bufRead(a) { return a < this.buf.length ? this.buf[a] : 0; }
    bufWrite(a, v) {
      if (a === 0 || (a >= 1 && a <= 9)) { this.buf[a] = v; return; }
      if (a < this.buf.length) this.buf[a] = v;
    }
    info() {
      const kind = ['샘플링', '시간 평균', '횟수 평균'];
      return this.input.map((v, i) => ({
        ch: i + 1, range: this.ranges[i], unit: this.rangeOf(i).unit, analog: v, digital: this.value[i],
        enabled: !((this.buf[0] >> i) & 1), avg: kind[(this.buf[9] >> (i * 2)) & 3] || '샘플링', avgN: this.buf[1 + i]
      }));
    }
  }

  // ---------------------------------------------------------------- D/A 변환 모듈 (Q62DAN 계열)
  class DAModule extends Module {
    constructor(type, params) {
      super(type, params);
      this.analog = true;
      const n = this.spec.ch;
      const rs = String(this.params.range || '').split(',').map((x) => x.trim()).filter(Boolean);
      this.ranges = [];
      for (let i = 0; i < n; i++) this.ranges.push(RANGES[rs[i] || rs[0] || '0-10V'] ? (rs[i] || rs[0] || '0-10V') : '0-10V');
      const en = String(this.params.en || '').split(',').map((x) => x.trim()).filter((x) => x !== '');
      this.chEnable = [];
      for (let i = 0; i < n; i++) this.chEnable.push(en.length ? en[i] !== '0' : true);
      const hd = String(this.params.hold || '').split(',').map((x) => x.trim());
      this.holdMode = [];
      for (let i = 0; i < n; i++) this.holdMode.push((hd[i] || hd[0] || '0') === '1');
      this.reset();
    }
    reset() {
      this.buf = new Int16Array(200);
      this.output = new Array(this.spec.ch).fill(0);
      this.enable = new Array(this.spec.ch).fill(0);
      this.ready = false;
      this.readyMs = 0;
      const r = this.ranges.map((x) => RANGES[x]);
      this.output = r.map((x) => (x.lo > 0 ? x.lo : 0));
      let dis = 0;
      (this.chEnable || []).forEach((e, i) => { if (!e) dis |= 1 << i; });
      this.buf[0] = dis;
    }
    rangeOf(ch) { return RANGES[this.ranges[ch]]; }
    /** CPU 의 Y(n+1)~ = 채널별 출력 허가 */
    update(cpu, dt, yBits) {
      this.readyMs += dt;
      if (!this.ready && this.readyMs >= 20) this.ready = true;
      const n = this.spec.ch;
      for (let i = 0; i < n; i++) {
        const en = yBits ? yBits(1 + i) : 0;
        this.enable[i] = en;
        const r = this.rangeOf(i);
        let d = this.buf[1 + i];
        const convEnabled = !((this.buf[0] >> i) & 1);
        const dmin = r.dlo < 0 ? -4096 : -96, dmax = 4095;
        const bad = d < dmin || d > dmax;
        d = Math.max(dmin, Math.min(dmax, d));
        this.buf[19] = bad ? 60 + i + 1 : this.buf[19];
        // 출력 허가(Y)가 없으면 CLEAR = 오프셋 값(0V · 4mA), HOLD = 직전 값 유지
        const off = this.holdMode[i] ? this.output[i] : (r.lo > 0 ? r.lo : 0);
        this.output[i] = (this.ready && en && convEnabled) ? r.lo + (d - r.dlo) / (r.dhi - r.dlo) * (r.hi - r.lo) : off;
      }
    }
    xSignal(i) {
      if (i === 0x0) return this.ready ? 1 : 0;
      if (i === 0x9) return 1;
      return 0;
    }
    bufRead(a) { return a < this.buf.length ? this.buf[a] : 0; }
    bufWrite(a, v) { if (a < this.buf.length) this.buf[a] = v; }
    info() {
      return this.output.map((v, i) => ({
        ch: i + 1, range: this.ranges[i], unit: this.rangeOf(i).unit, digital: this.buf[1 + i], analog: v,
        enabled: this.enable[i], conv: !((this.buf[0] >> i) & 1), hold: this.holdMode[i]
      }));
    }
  }

  // ---------------------------------------------------------------- 시리얼 통신 모듈 (QJ71C24N, 무수순 프로토콜)
  /*
   * 입력 신호 (CH1 / CH2)
   *   X(n+0)/X(n+7) 송신 정상 완료   X(n+1)/X(n+8) 송신 이상 완료   X(n+2)/X(n+9) 송신 처리 중
   *   X(n+3)/X(n+A) 수신 데이터 읽기 요구   X(n+4)/X(n+B) 수신 이상 검출
   *   X(n+1E) 모듈 READY
   * 수신 종료: 종료 코드(기본 CR LF = 0D0AH) 또는 수신 종료 데이터 수(기본 511 워드)
   */
  class SerialModule extends Module {
    constructor(type, params) {
      super(type, params);
      this.serial = true;
      this.unitByte = String(this.params.unit || 'word').toLowerCase() === 'byte';
      const list = (v, d) => { const a = String(v == null ? '' : v).split(',').map((x) => x.trim()).filter((x) => x !== ''); return [a[0] || d, a[1] || a[0] || d]; };
      this.bauds = list(this.params.baud, '9600').map((x) => +x || 9600);
      this.fmts = list(this.params.fmt, '8N1');
      this.endCodes = list(this.params.end, '0D0A').map((x) => String(x).toUpperCase());
      this.baud = this.bauds[0];
      this.fmt = this.fmts[0];
      this.endCode = this.endCodes[0];
      this.reset();
    }
    reset() {
      this.buf = new Int16Array(0x800);
      this.ch = [0, 1].map((i) => ({
        n: i + 1, rx: [], rxFrames: [], tx: [], txBusy: 0, txDone: 0, txErr: 0, readReq: 0, log: [], sending: null
      }));
      this.pendingDone = [];
      this.ready = false;
      this.readyMs = 0;
    }
    /** 외부 장치 → 모듈 (수신) */
    receive(chNo, bytes) {
      const c = this.ch[chNo - 1];
      if (!c) return;
      bytes.forEach((b) => {
        c.rx.push(b & 0xFF);
        const end = (this.endCodes[chNo - 1] || this.endCode).toUpperCase();
        let frame = false;
        if (end === '0D0A' && c.rx.length >= 2 && c.rx[c.rx.length - 2] === 0x0D && c.rx[c.rx.length - 1] === 0x0A) frame = true;
        else if (end === '0D' && b === 0x0D) frame = true;
        else if (end === '03' && b === 0x03) frame = true;
        else if (end === '0A' && b === 0x0A) frame = true;
        else if (end === 'NONE' && c.rx.length >= 1) frame = false;
        if (!frame && c.rx.length >= 511 * 2) frame = true;
        if (frame) { c.rxFrames.push(c.rx.slice()); c.rx = []; }
      });
      c.log.push({ dir: 'rx', bytes: bytes.slice(), t: Date.now() });
      if (c.log.length > 200) c.log.shift();
    }
    update(cpu, dt) {
      this.readyMs += dt;
      if (!this.ready && this.readyMs >= 20) this.ready = true;
      this.ch.forEach((c) => {
        c.txDone = 0; c.txErr = 0;
        if (c.sending) {
          c.sending.left -= dt;
          if (c.sending.left <= 0) {
            const bytes = c.sending.bytes;
            c.sending = null;
            c.txBusy = 0;
            c.txDone = 1;
            c.log.push({ dir: 'tx', bytes, t: Date.now() });
            if (c.log.length > 200) c.log.shift();
            if (this.onTransmit) this.onTransmit(c.n, bytes);
            if (c.complete) { c.complete(true); c.complete = null; }
          }
        }
        c.readReq = c.rxFrames.length ? 1 : 0;
      });
      // 전용 명령 완료 디바이스: 완료 다음 스캔에 1 스캔만 ON
      const due = this.pendingDone;
      this.pendingDone = [];
      due.forEach((f) => f(cpu));
    }
    xSignal(i) {
      const c1 = this.ch[0], c2 = this.ch[1];
      switch (i) {
        case 0x0: return c1.txDone; case 0x1: return c1.txErr; case 0x2: return c1.txBusy; case 0x3: return c1.readReq; case 0x4: return 0;
        case 0x7: return c2.txDone; case 0x8: return c2.txErr; case 0x9: return c2.txBusy; case 0xA: return c2.readReq; case 0xB: return 0;
        case 0x1E: return this.ready ? 1 : 0;
        default: return 0;
      }
    }
    bufRead(a) { return a < this.buf.length ? this.buf[a] : 0; }
    bufWrite(a, v) { if (a < this.buf.length) this.buf[a] = v; }

    /** 전용 명령 G.OUTPUT / G.INPUT */
    dedicated(cpu, op, o, pc) {
      const ctrl = o[1];
      const chNo = cpu.readWord(ctrl, 0);
      const c = this.ch[chNo - 1];
      const dev = o[3];
      const doneLater = (ok) => {
        this.pendingDone.push((cc) => {
          cc.writeBit(dev, 1);
          cc.writeBit(PLC.offsetOp(dev, 1), ok ? 0 : 1);
          // 다음 스캔에서 다시 끈다
          this.pendingDone.push((c3) => { c3.writeBit(dev, 0); c3.writeBit(PLC.offsetOp(dev, 1), 0); });
        });
      };
      if (!c) { cpu.writeWord(ctrl, 7400, 1); doneLater(false); return; }
      if (op === 'G.OUTPUT') {
        if (c.sending) return;           // 송신 중에는 무시 (완료 뒤 다시 실행)
        const n = cpu.readWord(ctrl, 2);
        const bytes = [];
        const words = this.unitByte ? Math.ceil(n / 2) : n;
        for (let i = 0; i < words; i++) {
          const w = cpu.readWord(o[2], i) & 0xFFFF;
          bytes.push(w & 0xFF, w >> 8);
        }
        if (this.unitByte) bytes.length = n;
        const ms = Math.max(1, bytes.length * 10 / (this.bauds[chNo - 1] || this.baud) * 1000);
        c.sending = { bytes, left: ms };
        c.txBusy = 1;
        cpu.writeWord(ctrl, 0, 1);
        c.complete = (ok) => doneLater(ok);
        return;
      }
      // G.INPUT
      const f = c.rxFrames.shift();
      if (!f) { cpu.writeWord(ctrl, 0, 2); cpu.writeWord(ctrl, 0, 1); doneLater(true); return; }
      const allow = cpu.readWord(ctrl, 3) || 511;
      const cnt = this.unitByte ? Math.min(f.length, allow) : Math.min(Math.ceil(f.length / 2), allow);
      const words = this.unitByte ? Math.ceil(cnt / 2) : cnt;
      for (let i = 0; i < words; i++) cpu.writeWord(o[2], (f[i * 2] | 0) | ((f[i * 2 + 1] | 0) << 8), i);
      cpu.writeWord(ctrl, cnt, 2);
      cpu.writeWord(ctrl, 0, 1);
      c.readReq = c.rxFrames.length ? 1 : 0;
      doneLater(true);
    }
  }

  function makeModule(type, params) {
    const spec = MODS[type];
    if (!spec) return null;
    if (spec.kind === 'ad') return new ADModule(type, params);
    if (spec.kind === 'da') return new DAModule(type, params);
    if (spec.kind === 'serial') return new SerialModule(type, params);
    const m = new Module(type, params);
    m.reset();
    return m;
  }

  // ==================================================================== 랙
  const DEFAULT_RACK = `CPU Q03UDE
BASE Q35B
0 QX41
1 QY41P
2 Q64AD range=0-10V
3 Q62DAN range=0-10V
4 QJ71C24N baud=9600 unit=byte`;
  PLC.DEFAULT_RACK = DEFAULT_RACK;

  class Rack {
    constructor(text) {
      this.parse(text || DEFAULT_RACK);
    }
    parse(text) {
      this.cpuType = 'Q03UDE';
      this.cpuParams = {};
      this.base = 'Q35B';
      this.slots = [];
      this.errors = [];
      const lines = String(text || '').replace(/\r/g, '').split('\n');
      const slotDefs = {};
      lines.forEach((raw) => {
        const line = raw.replace(/#.*$/, '').trim();
        if (!line) return;
        const tk = line.split(/\s+/);
        const key = tk[0].toUpperCase();
        const params = {};
        tk.slice(2).forEach((p) => { const i = p.indexOf('='); if (i > 0) params[p.slice(0, i).toLowerCase()] = p.slice(i + 1); });
        if (key === 'CPU') {
          const c = String(tk[1] || '').toUpperCase().replace(/CPU$/, '');
          if (CPUS[c]) this.cpuType = c; else this.errors.push(`알 수 없는 CPU: ${tk[1]}`);
          this.cpuParams = params;
        } else if (key === 'BASE') {
          const b = String(tk[1] || '').toUpperCase();
          if (BASES[b]) this.base = b; else this.errors.push(`알 수 없는 베이스: ${tk[1]}`);
        } else if (/^\d+$/.test(key)) {
          const t = String(tk[1] || '').toUpperCase();
          if (!MODS[t]) { this.errors.push(`알 수 없는 모듈: ${tk[1]}`); return; }
          slotDefs[+key] = { type: t, params };
        }
      });
      const nSlots = BASES[this.base];
      let head = 0;
      for (let i = 0; i < nSlots; i++) {
        const d = slotDefs[i] || { type: 'EMPTY', params: {} };
        const m = makeModule(d.type, d.params);
        m.slot = i;
        m.head = head;
        head += m.pts;
        this.slots.push(m);
      }
      Object.keys(slotDefs).forEach((k) => { if (+k >= nSlots) this.errors.push(`슬롯 ${k} 은(는) ${this.base} 에 없습니다 (0~${nSlots - 1})`); });
      this.index();
    }
    index() {
      this.xmap = new Map();   // X 주소 → [모듈, 번호]
      this.ymap = new Map();
      this.slots.forEach((m) => {
        const k = m.kind;
        for (let i = 0; i < m.pts; i++) {
          if (k === 'in' || k === 'io') { if (i < m.spec.n) this.xmap.set(m.head + i, [m, i]); }
          if (k === 'out' || k === 'io') { if (i < m.spec.n) this.ymap.set(m.head + i, [m, i]); }
        }
      });
    }
    serialize() {
      const cp = Object.keys(this.cpuParams || {}).map((k) => `${k}=${this.cpuParams[k]}`).join(' ');
      const out = [`CPU ${this.cpuType}${cp ? ' ' + cp : ''}`, `BASE ${this.base}`];
      this.slots.forEach((m) => {
        if (m.type === 'EMPTY') return;
        const ps = Object.keys(m.params).map((k) => `${k}=${m.params[k]}`).join(' ');
        out.push(`${m.slot} ${m.type}${ps ? ' ' + ps : ''}`);
      });
      return out.join('\n');
    }
    get cpuSpec() { return CPUS[this.cpuType]; }
    hasInput(addr) { return this.xmap.has(addr); }
    hasOutput(addr) { return this.ymap.has(addr); }
    moduleAt(head) { return this.slots.find((m) => m.head === head && m.type !== 'EMPTY') || null; }
    modulesOf(kind) { return this.slots.filter((m) => m.kind === kind); }

    /** 입력 단자(현장 → 모듈) */
    setInput(addr, v) {
      const e = this.xmap.get(addr);
      if (!e) return false;
      e[0].xin[e[1]] = v ? 1 : 0;
      return true;
    }
    getInput(addr) { const e = this.xmap.get(addr); return e ? e[0].xin[e[1]] : 0; }
    /** 출력 단자(모듈 → 현장) */
    getOutput(addr) { const e = this.ymap.get(addr); return e ? e[0].yout[e[1]] : 0; }

    /** 아날로그: ref = 1 (첫 A/D 모듈 CH1) 또는 "S2:1" (슬롯 2 의 CH1) */
    resolveAnalog(kind, ref) {
      const s = String(ref == null ? '1' : ref).toUpperCase().replace(/^CH/, '');
      let m, ch;
      const mm = /^S(\d+):(\d+)$/.exec(s);
      if (mm) { m = this.slots[+mm[1]]; ch = +mm[2]; if (!m || m.kind !== kind) return null; }
      else { m = this.modulesOf(kind)[0]; ch = +s; }
      if (!m || !(ch >= 1 && ch <= m.spec.ch)) return null;
      return { mod: m, ch: ch - 1 };
    }
    setAnalogIn(ref, v) { const r = this.resolveAnalog('ad', ref); if (r) r.mod.input[r.ch] = v; return !!r; }
    getAnalogOut(ref) { const r = this.resolveAnalog('da', ref); return r ? r.mod.output[r.ch] : 0; }
    resolveSerial(ref) {
      const s = String(ref == null ? 'CH1' : ref).toUpperCase();
      let m, ch;
      const mm = /^S(\d+):(?:CH)?(\d+)$/.exec(s);
      if (mm) { m = this.slots[+mm[1]]; ch = +mm[2]; if (!m || !m.serial) return null; }
      else { m = this.slots.find((x) => x.serial); ch = +s.replace(/^CH/, '') || 1; }
      if (!m || ch < 1 || ch > 2) return null;
      return { mod: m, ch };
    }

    reset() { this.slots.forEach((m) => { const keep = m.xin ? m.xin.slice() : null; const ain = m.input ? m.input.slice() : null; m.reset(); if (keep) m.xin.set(keep); if (ain) m.input = ain; }); }
    onRun() { /* 모듈은 CPU RUN 과 관계없이 동작 */ }

    /** 입력 리프레시: 모듈 입력 단자 → X, 인텔리전트 모듈 신호 → X */
    inputRefresh(cpu, dt) {
      const X = cpu.bits.X;
      this.slots.forEach((m) => {
        if (m.xin) {
          const src = m.filtered(dt);
          for (let i = 0; i < src.length; i++) X[m.head + i] = src[i];
        }
        else if (m.analog || m.serial) {
          if (m.kind === 'ad' || m.kind === 'serial') m.update(cpu, dt);
          for (let i = 0; i < m.pts; i++) X[m.head + i] = m.xSignal(i);
        }
      });
    }
    /** 출력 리프레시: Y → 모듈 출력 단자, D/A 모듈 출력 허가 */
    outputRefresh(cpu, force, dt) {
      const Y = cpu.bits.Y;
      this.slots.forEach((m) => {
        if (m.yout) for (let i = 0; i < m.yout.length; i++) m.yout[i] = Y[m.head + i];
        if (m.kind === 'da') m.update(cpu, dt || 0, (i) => Y[m.head + i]);
      });
    }
    readBuffer(head, addr) { const m = this.moduleAt(head); return m && m.buf ? m.bufRead(addr) : null; }
    writeBuffer(head, addr, v) { const m = this.moduleAt(head); if (!m || !m.buf) return false; m.bufWrite(addr, v); return true; }

    /** 모듈별 입출력 번호 표 */
    ioTable() {
      return this.slots.map((m) => {
        const hex = (v) => v.toString(16).toUpperCase().padStart(2, '0');
        const last = m.head + m.pts - 1;
        let xy;
        if (m.kind === 'in') xy = `X${hex(m.head)}~X${hex(last)}`;
        else if (m.kind === 'out') xy = `Y${hex(m.head)}~Y${hex(last)}`;
        else if (m.kind === 'io') xy = `X/Y${hex(m.head)}~${hex(last)}`;
        else if (m.kind === 'empty') xy = `(${hex(m.head)}~${hex(last)})`;
        else xy = `X/Y${hex(m.head)}~${hex(last)} · U${(m.head / 16).toString(16).toUpperCase()}`;
        return { slot: m.slot, type: m.type, kind: m.kind, head: m.head, pts: m.pts, xy, desc: m.spec.desc };
      });
    }
  }
  PLC.Rack = Rack;
  PLC.makeModule = makeModule;
})(typeof window !== 'undefined' ? window : globalThis);
