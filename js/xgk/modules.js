/* LS ELECTRIC XGK 시리즈 모듈 카탈로그와 베이스 구성
 *  - CPU · 베이스 · 전원 · 입력/출력 · A/D · D/A · Cnet 통신 모듈
 *  - 입출력(P) 번호 자동 할당 — 가변식: 모듈 점수만큼, 특수 · 통신 모듈은 16점
 *  - 특수 모듈 메모리는 U 디바이스(U슬롯.워드) 와 GET · PUT 명령으로 읽고 쓴다
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const toS16 = (v) => ((v & 0xFFFF) << 16) >> 16;

  // ==================================================================== 카탈로그
  const CPUS = {
    'XGK-CPUE': { model: 'XGK-CPUE', steps: 16000, pts: 1536, lds: 0.084, exp: 1, port: 'RS-232C · USB', note: '표준형 (경제형) — 프로그램 16k 스텝, 입출력 1,536점' },
    'XGK-CPUS': { model: 'XGK-CPUS', steps: 32000, pts: 3072, lds: 0.084, exp: 3, port: 'RS-232C · USB', note: '표준형 — 프로그램 32k 스텝, 입출력 3,072점' },
    'XGK-CPUA': { model: 'XGK-CPUA', steps: 32000, pts: 3072, lds: 0.084, exp: 3, port: 'RS-232C · USB', note: '고급형 — 프로그램 32k 스텝' },
    'XGK-CPUH': { model: 'XGK-CPUH', steps: 64000, pts: 6144, lds: 0.028, exp: 7, port: 'RS-232C · USB', note: '고급형 — 프로그램 64k 스텝, 입출력 6,144점' },
    'XGK-CPUU': { model: 'XGK-CPUU', steps: 128000, pts: 6144, lds: 0.028, exp: 7, port: 'RS-232C · USB', note: '고급형 — 프로그램 128k 스텝' },
    'XGK-CPUSN': { model: 'XGK-CPUSN', steps: 64000, pts: 3072, lds: 0.0085, exp: 3, port: '이더넷 · USB', note: '신형 — 이더넷 내장 (XGT 서버 · Modbus TCP)' },
    'XGK-CPUHN': { model: 'XGK-CPUHN', steps: 128000, pts: 6144, lds: 0.0085, exp: 7, port: '이더넷 · USB', note: '신형 — 이더넷 내장' },
    'XGK-CPUUN': { model: 'XGK-CPUUN', steps: 256000, pts: 6144, lds: 0.0085, exp: 7, port: '이더넷 · USB', note: '신형 — 이더넷 내장, 프로그램 256k 스텝' }
  };
  const BASES = { 'XGB-M04A': 4, 'XGB-M06A': 6, 'XGB-M08A': 8, 'XGB-M12A': 12 };
  const POWERS = {
    'XGP-ACF1': 'AC 100~240V 입력 · DC5V 3A',
    'XGP-ACF2': 'AC 100~240V 입력 · DC5V 6A',
    'XGP-AC23': 'AC 200~240V 입력 · DC5V 8.5A',
    'XGP-DC42': 'DC 24V 입력 · DC5V 6A'
  };

  /*
   * 모듈 종류
   *  kind: in / out / io / ad / da / serial / empty
   *  pts : 차지하는 입출력(P) 점수 — 가변식 할당 (특수 · 통신 모듈은 16점)
   */
  const MODS = {
    'XGI-D21A': { kind: 'in', pts: 8, n: 8, desc: 'DC 24V 입력 8점 (싱크/소스)' },
    'XGI-D22A': { kind: 'in', pts: 16, n: 16, desc: 'DC 24V 입력 16점 (싱크/소스)' },
    'XGI-D24A': { kind: 'in', pts: 32, n: 32, desc: 'DC 24V 입력 32점 (싱크/소스, 40핀 커넥터)' },
    'XGI-D28A': { kind: 'in', pts: 64, n: 64, desc: 'DC 24V 입력 64점 (싱크/소스)' },
    'XGI-A12A': { kind: 'in', pts: 16, n: 16, desc: 'AC 110V 입력 16점' },
    'XGI-A21A': { kind: 'in', pts: 8, n: 8, desc: 'AC 220V 입력 8점' },
    'XGQ-RY1A': { kind: 'out', pts: 8, n: 8, desc: '릴레이 출력 8점 (독립 접점, AC250V/DC24V 2A)' },
    'XGQ-RY2A': { kind: 'out', pts: 16, n: 16, desc: '릴레이 출력 16점 (AC250V/DC24V 2A)' },
    'XGQ-TR2A': { kind: 'out', pts: 16, n: 16, desc: '트랜지스터 출력 16점 (싱크 0.5A)' },
    'XGQ-TR4A': { kind: 'out', pts: 32, n: 32, desc: '트랜지스터 출력 32점 (싱크 0.1A, 40핀 커넥터)' },
    'XGQ-TR8A': { kind: 'out', pts: 64, n: 64, desc: '트랜지스터 출력 64점 (싱크 0.1A)' },
    'XGQ-SS2A': { kind: 'out', pts: 16, n: 16, desc: 'SSR(트라이악) 출력 16점 (AC100~240V 0.6A)' },
    'XGH-DT4A': { kind: 'io', pts: 32, n: 32, desc: '입력 16점 + 트랜지스터 출력 16점 (혼합)' },
    'XGF-AV8A': { kind: 'ad', pts: 16, ch: 8, volt: true, desc: 'A/D 변환 8채널 (전압 입력, 분해능 1/16000)' },
    'XGF-AC8A': { kind: 'ad', pts: 16, ch: 8, curr: true, desc: 'A/D 변환 8채널 (전류 입력, 분해능 1/16000)' },
    'XGF-AD8A': { kind: 'ad', pts: 16, ch: 8, desc: 'A/D 변환 8채널 (전압 · 전류 선택)' },
    'XGF-AD4S': { kind: 'ad', pts: 16, ch: 4, desc: 'A/D 변환 4채널 (채널간 절연형)' },
    'XGF-DV4A': { kind: 'da', pts: 16, ch: 4, volt: true, desc: 'D/A 변환 4채널 (전압 출력, 분해능 1/16000)' },
    'XGF-DC4A': { kind: 'da', pts: 16, ch: 4, curr: true, desc: 'D/A 변환 4채널 (전류 출력)' },
    'XGF-DV8A': { kind: 'da', pts: 16, ch: 8, volt: true, desc: 'D/A 변환 8채널 (전압 출력)' },
    'XGL-C22A': { kind: 'serial', pts: 16, ch: 2, ifs: ['RS-232C', 'RS-232C'], desc: 'Cnet 통신 2채널 (RS-232C ×2)' },
    'XGL-C42A': { kind: 'serial', pts: 16, ch: 2, ifs: ['RS-422/485', 'RS-422/485'], desc: 'Cnet 통신 2채널 (RS-422/485 ×2)' },
    'XGL-CH2A': { kind: 'serial', pts: 16, ch: 2, ifs: ['RS-232C', 'RS-422/485'], desc: 'Cnet 통신 2채널 (CH1 RS-232C, CH2 RS-422/485)' },
    EMPTY: { kind: 'empty', pts: 16, desc: '빈 슬롯 (가변식 16점 차지)' }
  };

  /** 아날로그 입출력 범위: 코드 → [최소, 최대, 단위, 디지털 최소, 디지털 최대] */
  const RANGES = {
    '4-20mA': { lo: 4, hi: 20, unit: 'mA', dlo: 0, dhi: 16000, code: 0 },
    '0-20mA': { lo: 0, hi: 20, unit: 'mA', dlo: 0, dhi: 16000, code: 1 },
    '1-5V': { lo: 1, hi: 5, unit: 'V', dlo: 0, dhi: 16000, code: 2 },
    '0-5V': { lo: 0, hi: 5, unit: 'V', dlo: 0, dhi: 16000, code: 3 },
    '0-10V': { lo: 0, hi: 10, unit: 'V', dlo: 0, dhi: 16000, code: 4 },
    '-10-10V': { lo: -10, hi: 10, unit: 'V', dlo: -8000, dhi: 8000, code: 5 }
  };

  PLC.CATALOG = { CPUS, BASES, MODS, RANGES, POWERS };

  // ==================================================================== 모듈 인스턴스
  class Module {
    constructor(type, params) {
      this.type = type;
      this.spec = MODS[type];
      this.params = params || {};
      this.head = 0;        // 첫 P 비트 번호 (점)
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

  // ---------------------------------------------------------------- A/D 변환 모듈 (XGF-AV8A 계열)
  /*
   * 메모리 (U슬롯.워드) — XG5000 의 특수 모듈 파라미터에서 채널 사용 · 입력 범위 · 평균 처리를 정하고,
   * 프로그램은 변환값만 읽는다.
   *   U0X.00 ~ U0X.07 : CH0 ~ CH7 디지털 변환값
   *   U0X.08          : 채널별 변환 완료 비트 (b0 ~ b7)
   *   U0X.09          : 채널별 입력 범위 초과 비트
   *   U0X.10 ~        : 채널별 최대값 · 최소값 (2워드씩)
   *   P(첫 비트)      : 모듈 READY
   */
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
      // 채널 사용 (en=1,1,0,0) · 평균 처리 (avg=s,t100,c50,s : 샘플링 · 시간 평균 ms · 횟수 평균)
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
      this.buf = new Int16Array(64);
      this.value = new Array(n).fill(0);
      this.maxv = new Array(n).fill(-32768);
      this.minv = new Array(n).fill(32767);
      this.ready = false;
      this.readyMs = 0;
      this.acc = new Array(n).fill(0);
      this.accN = new Array(n).fill(0);
      this.accMs = new Array(n).fill(0);
    }
    rangeOf(ch) { return RANGES[this.ranges[ch]]; }
    /** 아날로그 값 → 디지털 값 (분해능 1/16000) */
    convert(ch, v) {
      const r = this.rangeOf(ch);
      let d = r.dlo + (v - r.lo) / (r.hi - r.lo) * (r.dhi - r.dlo);
      d = Math.round(d);
      const min = r.dlo < 0 ? -8192 : -192;
      return Math.max(min, Math.min(16384, d));
    }
    update(cpu, dt) {
      const n = this.spec.ch;
      const b = this.buf;
      this.readyMs += dt;
      if (!this.ready && this.readyMs >= 20) this.ready = true;
      let doneBits = 0, overBits = 0;
      for (let i = 0; i < n; i++) {
        if (!this.chEnable[i] || !this.ready) { b[i] = 0; continue; }
        const raw = this.convert(i, this.input[i]);
        const r = this.rangeOf(i);
        if (raw > r.dhi || raw < r.dlo) overBits |= 1 << i;
        const mode = this.avgMode[i];
        let d = raw;
        if (mode.kind !== 's') {
          this.acc[i] += raw;
          this.accN[i]++;
          this.accMs[i] += dt;
          const done = mode.kind === 't' ? this.accMs[i] >= mode.n : this.accN[i] >= mode.n;
          if (done) {
            this.value[i] = Math.round(this.acc[i] / Math.max(1, this.accN[i]));
            this.acc[i] = 0; this.accN[i] = 0; this.accMs[i] = 0;
          }
          d = this.value[i];
        }
        this.value[i] = d;
        b[i] = toS16(d);
        doneBits |= 1 << i;
        if (d > this.maxv[i]) this.maxv[i] = d;
        if (d < this.minv[i]) this.minv[i] = d;
        b[10 + i * 2] = toS16(this.maxv[i]);
        b[11 + i * 2] = toS16(this.minv[i]);
      }
      b[8] = toS16(doneBits);
      b[9] = toS16(overBits);
      this.flags = { ready: this.ready, done: doneBits !== 0, err: overBits !== 0 };
    }
    /** P 신호: 첫 비트 = 모듈 READY, b1 = 변환 완료, bF = 에러 */
    xSignal(i) {
      const f = this.flags || {};
      if (i === 0x0) return f.ready ? 1 : 0;
      if (i === 0x1) return f.done ? 1 : 0;
      if (i === 0xF) return f.err ? 1 : 0;
      return 0;
    }
    bufRead(a) { return a < this.buf.length ? this.buf[a] : 0; }
    bufWrite(a, v) { if (a < this.buf.length) this.buf[a] = v; }
    info() {
      const kind = { s: '샘플링', t: '시간 평균', c: '횟수 평균' };
      return this.input.map((v, i) => ({
        ch: i + 1, range: this.ranges[i], unit: this.rangeOf(i).unit, analog: v, digital: this.value[i],
        enabled: this.chEnable[i], avg: kind[this.avgMode[i].kind], avgN: this.avgMode[i].n || 0
      }));
    }
  }

  // ---------------------------------------------------------------- D/A 변환 모듈 (XGF-DV4A 계열)
  /*
   * 메모리 (U슬롯.워드)
   *   U0X.00 ~ U0X.07 : CH0 ~ CH7 디지털 출력값 (프로그램이 쓴다)
   *   U0X.08          : 채널 출력 허가 비트 (b0 ~ b7) — 파라미터 값으로 시작한다
   *   P(첫 비트)      : 모듈 READY
   */
  class DAModule extends Module {
    constructor(type, params) {
      super(type, params);
      this.analog = true;
      const n = this.spec.ch;
      const def = this.spec.curr ? '4-20mA' : '0-10V';
      const rs = String(this.params.range || '').split(',').map((x) => x.trim()).filter(Boolean);
      this.ranges = [];
      for (let i = 0; i < n; i++) this.ranges.push(RANGES[rs[i] || rs[0] || def] ? (rs[i] || rs[0] || def) : def);
      const en = String(this.params.en || '').split(',').map((x) => x.trim()).filter((x) => x !== '');
      this.chEnable = [];
      for (let i = 0; i < n; i++) this.chEnable.push(en.length ? en[i] !== '0' : true);
      const hd = String(this.params.hold || '').split(',').map((x) => x.trim());
      this.holdMode = [];
      for (let i = 0; i < n; i++) this.holdMode.push((hd[i] || hd[0] || '0') === '1');
      this.reset();
    }
    reset() {
      this.buf = new Int16Array(64);
      this.output = this.ranges.map((x) => (RANGES[x].lo > 0 ? RANGES[x].lo : 0));
      this.enable = new Array(this.spec.ch).fill(0);
      this.ready = false;
      this.readyMs = 0;
      let en = 0;
      (this.chEnable || []).forEach((e, i) => { if (e) en |= 1 << i; });
      this.buf[8] = toS16(en);
    }
    rangeOf(ch) { return RANGES[this.ranges[ch]]; }
    update(cpu, dt) {
      this.readyMs += dt;
      if (!this.ready && this.readyMs >= 20) this.ready = true;
      const n = this.spec.ch;
      for (let i = 0; i < n; i++) {
        const en = (this.buf[8] >> i) & 1;
        this.enable[i] = en;
        const r = this.rangeOf(i);
        let d = this.buf[i];
        const dmin = r.dlo < 0 ? -8192 : -192, dmax = 16384;
        d = Math.max(dmin, Math.min(dmax, d));
        // 출력 허가가 없으면 CLEAR = 오프셋 값(0V · 4mA), HOLD = 직전 값 유지
        const off = this.holdMode[i] ? this.output[i] : (r.lo > 0 ? r.lo : 0);
        this.output[i] = (this.ready && en) ? r.lo + (d - r.dlo) / (r.dhi - r.dlo) * (r.hi - r.lo) : off;
      }
    }
    xSignal(i) {
      if (i === 0x0) return this.ready ? 1 : 0;
      return 0;
    }
    bufRead(a) { return a < this.buf.length ? this.buf[a] : 0; }
    bufWrite(a, v) { if (a < this.buf.length) this.buf[a] = v; }
    info() {
      return this.output.map((v, i) => ({
        ch: i + 1, range: this.ranges[i], unit: this.rangeOf(i).unit, digital: this.buf[i], analog: v,
        enabled: this.enable[i], conv: this.chEnable[i], hold: this.holdMode[i]
      }));
    }
  }

  // ---------------------------------------------------------------- Cnet 통신 모듈 (XGL-C22A, 사용자 정의 통신)
  /*
   * P 신호 (CH1 / CH2)
   *   P(n+0)/P(n+8) 송신 완료   P(n+1)/P(n+9) 송신 이상   P(n+2)/P(n+A) 송신 중
   *   P(n+3)/P(n+B) 수신 데이터 있음   P(n+F) 모듈 READY
   * 수신 종료: 종료 코드(기본 CR LF = h0D0A) 또는 최대 길이
   * 명령: SNDUDATA 슬롯 채널 보낼디바이스 개수 상태디바이스 / RCVUDATA 슬롯 채널 받을디바이스 개수 상태디바이스
   * 모듈 메모리: U0X.00 · U0X.01 = 채널별 마지막 수신 개수
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
      this.buf = new Int16Array(0x200);
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
        if (!frame && c.rx.length >= 256 * 2) frame = true;
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
      const due = this.pendingDone;
      this.pendingDone = [];
      due.forEach((f) => f(cpu));
    }
    xSignal(i) {
      const c1 = this.ch[0], c2 = this.ch[1];
      switch (i) {
        case 0x0: return c1.txDone; case 0x1: return c1.txErr; case 0x2: return c1.txBusy; case 0x3: return c1.readReq;
        case 0x8: return c2.txDone; case 0x9: return c2.txErr; case 0xA: return c2.txBusy; case 0xB: return c2.readReq;
        case 0xF: return this.ready ? 1 : 0;
        default: return 0;
      }
    }
    bufRead(a) { return a < this.buf.length ? this.buf[a] : 0; }
    bufWrite(a, v) { if (a < this.buf.length) this.buf[a] = v; }

    /**
     * SNDUDATA 슬롯 채널 디바이스 개수 상태디바이스
     * RCVUDATA 슬롯 채널 디바이스 개수 상태디바이스
     *   상태디바이스: (D) 완료 비트 · (D+1) 에러 비트 — 완료 다음 스캔에 1 스캔만 ON
     */
    udata(cpu, op, o, pc) {
      const chNo = cpu.readWord(o[1]);
      const c = this.ch[chNo - 1];
      const dev = o[4];
      const nextBit = (o) => {
        if (o.kind !== 'dev' || o.point == null) return o;
        const c = Object.assign({}, o, { point: o.point + 1 });
        c.word = c.point >> 4; c.bit = c.point & 15;
        c.text = PLC.fmtPoint(o.dev, c.point);
        return c;
      };
      const errDev = nextBit(dev);
      const doneLater = (ok) => {
        this.pendingDone.push((cc) => {
          cc.writeBit(dev, 1);
          cc.writeBit(errDev, ok ? 0 : 1);
          this.pendingDone.push((c3) => { c3.writeBit(dev, 0); c3.writeBit(errDev, 0); });
        });
      };
      if (!c) { doneLater(false); return; }
      if (op === 'SNDUDATA') {
        if (c.sending) return;           // 송신 중에는 무시 (완료 뒤 다시 실행)
        const n = cpu.readWord(o[3]);
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
        c.complete = (ok) => doneLater(ok);
        return;
      }
      // RCVUDATA
      const f = c.rxFrames.shift();
      if (!f) { this.buf[chNo - 1] = 0; doneLater(true); return; }
      const allow = cpu.readWord(o[3]) || 256;
      const cnt = this.unitByte ? Math.min(f.length, allow) : Math.min(Math.ceil(f.length / 2), allow);
      const words = this.unitByte ? Math.ceil(cnt / 2) : cnt;
      for (let i = 0; i < words; i++) cpu.writeWord(o[2], (f[i * 2] | 0) | ((f[i * 2 + 1] | 0) << 8), i);
      this.buf[chNo - 1] = cnt;      // U0X.00 · U0X.01 = 채널별 마지막 수신 개수
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

  // ==================================================================== 베이스(랙)
  const DEFAULT_RACK = `CPU XGK-CPUE
BASE XGB-M06A
0 XGI-D24A
1 XGQ-TR4A
2 XGF-AV8A range=0-10V
3 XGF-DV4A range=0-10V
4 XGL-C22A baud=9600 unit=byte`;
  PLC.DEFAULT_RACK = DEFAULT_RACK;

  class Rack {
    constructor(text) {
      this.parse(text || DEFAULT_RACK);
    }
    parse(text) {
      this.cpuType = 'XGK-CPUE';
      this.cpuParams = {};
      this.base = 'XGB-M06A';
      this.power = 'XGP-ACF2';
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
          let c = String(tk[1] || '').toUpperCase();
          if (!CPUS[c] && CPUS['XGK-' + c]) c = 'XGK-' + c;
          if (CPUS[c]) this.cpuType = c; else this.errors.push(`알 수 없는 CPU: ${tk[1]}`);
          this.cpuParams = params;
        } else if (key === 'BASE') {
          const b = String(tk[1] || '').toUpperCase();
          if (BASES[b]) this.base = b; else this.errors.push(`알 수 없는 베이스: ${tk[1]}`);
        } else if (key === 'POWER') {
          const p = String(tk[1] || '').toUpperCase();
          if (POWERS[p]) this.power = p; else this.errors.push(`알 수 없는 전원 모듈: ${tk[1]}`);
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
      this.xmap = new Map();   // P 비트 번호 → [모듈, 번호] (입력)
      this.ymap = new Map();   // P 비트 번호 → [모듈, 번호] (출력)
      this.slots.forEach((m) => {
        const k = m.kind;
        for (let i = 0; i < m.pts; i++) {
          if ((k === 'in' || k === 'io') && i < m.spec.n) this.xmap.set(m.head + i, [m, i]);
          if (k === 'out' && i < m.spec.n) this.ymap.set(m.head + i, [m, i]);
          if (k === 'io' && i >= m.spec.n / 2 && i < m.spec.n) this.ymap.set(m.head + i, [m, i]);
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
    hasInput(point) { return this.xmap.has(point); }
    hasOutput(point) { return this.ymap.has(point); }
    outputPoints() {
      if (!this._outPts) this._outPts = Array.from(this.ymap.keys());
      return this._outPts;
    }
    moduleAt(slot) { const m = this.slots[slot]; return m && m.type !== 'EMPTY' ? m : null; }
    modulesOf(kind) { return this.slots.filter((m) => m.kind === kind); }

    /** 입력 단자(현장 → 모듈) */
    setInput(point, v) {
      const e = this.xmap.get(point);
      if (!e) return false;
      e[0].xin[e[1]] = v ? 1 : 0;
      return true;
    }
    getInput(point) { const e = this.xmap.get(point); return e ? e[0].xin[e[1]] : 0; }
    /** 출력 단자(모듈 → 현장) */
    getOutput(point) { const e = this.ymap.get(point); return e ? e[0].yout[e[1]] : 0; }

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

    /** 입력 리프레시: 모듈 입력 단자 → P, 특수 모듈 신호 → P */
    inputRefresh(cpu, dt) {
      this.slots.forEach((m) => {
        if (m.xin) {
          const src = m.filtered(dt);
          for (let i = 0; i < src.length; i++) cpu.setPoint(m.head + i, src[i]);
        } else if (m.analog || m.serial) {
          if (m.kind === 'ad' || m.kind === 'serial') m.update(cpu, dt);
          for (let i = 0; i < m.pts; i++) cpu.setPoint(m.head + i, m.xSignal(i));
        }
      });
    }
    /** 출력 리프레시: P → 모듈 출력 단자, D/A 모듈 변환 */
    outputRefresh(cpu, force, dt) {
      this.slots.forEach((m) => {
        if (m.yout) for (let i = 0; i < m.yout.length; i++) m.yout[i] = cpu.getPoint(m.head + i);
        if (m.kind === 'da') m.update(cpu, dt || 0);
      });
    }
    readBuffer(slot, addr) { const m = this.moduleAt(slot); return m && m.buf ? m.bufRead(addr) : null; }
    writeBuffer(slot, addr, v) { const m = this.moduleAt(slot); if (!m || !m.buf) return false; m.bufWrite(addr, v); return true; }

    /** 모듈별 입출력 번호 표 */
    ioTable() {
      return this.slots.map((m) => {
        const first = PLC.fmtPoint('P', m.head);
        const last = PLC.fmtPoint('P', m.head + m.pts - 1);
        const u = `U${m.slot.toString(16).toUpperCase().padStart(2, '0')}.00`;
        let xy;
        if (m.kind === 'empty') xy = `(${first}~${last})`;
        else if (m.kind === 'ad' || m.kind === 'da' || m.kind === 'serial') xy = `${first}~${last} · ${u}`;
        else xy = `${first}~${last}`;
        return { slot: m.slot, type: m.type, kind: m.kind, head: m.head, pts: m.pts, xy, desc: m.spec.desc };
      });
    }
  }
  PLC.Rack = Rack;
  PLC.makeModule = makeModule;
})(typeof window !== 'undefined' ? window : globalThis);
