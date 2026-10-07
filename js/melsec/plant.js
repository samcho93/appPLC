/* 현장 설비(입출력 장비) 모델
 *  한 줄에 장비 하나:  종류 이름 [주소] 옵션=값 …
 *    PB START X0 label=시작 color=green        푸시 버튼 (누르는 동안 ON)
 *    CYL CYL1 sol=Y21 ext=X4 ret=X5 time=1     실린더
 *  장비는 PLC 입력(X) · 출력(Y) · 아날로그(A/D · D/A 채널) · 시리얼 채널에 연결된다.
 *  새 장비 종류는 PLC.PLANT_TYPES 에 추가하면 된다 (docs/DEVICES.md 참고).
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const addrOf = (t) => {
    if (!t) return null;
    const o = PLC.parseOperand(t);
    return o && o.kind === 'dev' && (o.dev === 'X' || o.dev === 'Y') ? { dev: o.dev, addr: o.addr, text: o.text } : null;
  };
  /** "X10@0.3,X11@0.9" → [{addr, at}] */
  const posList = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [a, at] = x.split('@');
    const ad = addrOf(a);
    return ad ? { a: ad, at: num(at, 0.5) } : null;
  }).filter(Boolean);

  /*
   * 장비 종류 정의
   *  cat   : 'in' 입력 장비 · 'out' 출력 장비 · 'ana' 아날로그 · 'mech' 기계 · 'com' 통신
   *  main  : 위치 인자로 주는 주 주소의 키 (예: PB START X0 → x=X0)
   *  keys  : 연결 키와 방향 (x = PLC 입력, y = PLC 출력, ad = A/D 채널, da = D/A 채널, port = 시리얼 채널)
   *  init(d)          상태 초기화
   *  step(d, io, dt)  한 스캔 동안의 물리 동작 (io.y(addr) 로 출력 읽기)
   *  inputs(d)        PLC 입력으로 보낼 값 [[addr, 0/1]]
   *  analog(d)        A/D 채널로 보낼 값 [[채널, 스팬 비율 0~1]]
   *  set(d, v) / get(d)  검사식 · 조작판에서 쓰는 대표 값
   */
  const T = {};
  PLC.PLANT_TYPES = T;

  // ---------------------------------------------------------------- 입력 장비
  T.PB = {
    name: '푸시 버튼', cat: 'in', main: 'x', keys: { x: 'x' },
    help: 'PB 이름 X0 [nc=1] [color=green|red|yellow|blue|black|white] [label=표시]',
    init(d) { d.on = 0; },
    inputs(d) { return [[d.x, d.p.nc === '1' ? (d.on ? 0 : 1) : d.on]]; },
    set(d, v) { d.on = v ? 1 : 0; }, get(d) { return d.on; }
  };
  T.SEL = {
    name: '셀렉터 스위치', cat: 'in', main: 'x', keys: { x: 'x' },
    help: 'SEL 이름 X2 [on=1] [txt=수동/자동] [label=모드]',
    init(d) { d.on = d.p.on === '1' ? 1 : 0; },
    inputs(d) { return [[d.x, d.on]]; },
    set(d, v) { d.on = v ? 1 : 0; }, get(d) { return d.on; }
  };
  T.TGL = Object.assign({}, T.SEL, { name: '토글 스위치', help: 'TGL 이름 X3 [on=1] [label=표시]' });
  T.EMG = {
    name: '비상 정지', cat: 'in', main: 'x', keys: { x: 'x' },
    help: 'EMG 이름 X1 — b 접점 (평소 ON, 누르면 OFF · 눌린 채 유지, 다시 누르면 해제)',
    init(d) { d.on = 0; },
    inputs(d) { return [[d.x, d.on ? 0 : 1]]; },
    set(d, v) { d.on = v ? 1 : 0; }, get(d) { return d.on; }
  };
  T.LS = {
    name: '리밋 스위치', cat: 'in', main: 'x', keys: { x: 'x' },
    help: 'LS 이름 X6 [nc=1] — 누르는 동안 동작',
    init(d) { d.on = 0; },
    inputs(d) { return [[d.x, d.p.nc === '1' ? (d.on ? 0 : 1) : d.on]]; },
    set(d, v) { d.on = v ? 1 : 0; }, get(d) { return d.on; }
  };
  T.PROX = {
    name: '근접 센서', cat: 'in', main: 'x', keys: { x: 'x' },
    help: 'PROX 이름 X7 — 눌러서 물체 있음/없음 전환',
    init(d) { d.on = d.p.on === '1' ? 1 : 0; },
    inputs(d) { return [[d.x, d.on]]; },
    set(d, v) { d.on = v ? 1 : 0; }, get(d) { return d.on; }
  };
  T.PHOTO = Object.assign({}, T.PROX, { name: '광전 센서', help: 'PHOTO 이름 X8 — 눌러서 물체 있음/없음 전환' });
  T.DSW = {
    name: '디지털 스위치', cat: 'in', main: 'x', keys: { x: 'x' },
    help: 'DSW 이름 X10 [digits=2] [val=0] — BCD 출력 (자리당 4점, 아래 자리부터)',
    init(d) { d.digits = clamp(num(d.p.digits, 1) | 0, 1, 4); d.val = clamp(num(d.p.val, 0) | 0, 0, Math.pow(10, d.digits) - 1); },
    inputs(d) {
      const out = [];
      let v = d.val;
      for (let k = 0; k < d.digits; k++) {
        const dg = v % 10; v = Math.floor(v / 10);
        for (let b = 0; b < 4; b++) out.push([{ dev: 'X', addr: d.x.addr + k * 4 + b }, (dg >> b) & 1]);
      }
      return out;
    },
    set(d, v) { d.val = clamp(v | 0, 0, Math.pow(10, d.digits) - 1); }, get(d) { return d.val; }
  };

  // ---------------------------------------------------------------- 출력 장비
  T.LAMP = {
    name: '표시등', cat: 'out', main: 'y', keys: { y: 'y' },
    help: 'LAMP 이름 Y20 [color=green|red|yellow|blue|white|orange] [label=표시]',
    init(d) { d.on = 0; },
    step(d, io) { d.on = io.y(d.y); },
    get(d) { return d.on; }
  };
  T.BUZ = {
    name: '부저', cat: 'out', main: 'y', keys: { y: 'y' },
    help: 'BUZ 이름 Y2F [label=경보]',
    init(d) { d.on = 0; },
    step(d, io) { d.on = io.y(d.y); },
    get(d) { return d.on; }
  };
  T.SEG7 = {
    name: '7세그먼트 표시기', cat: 'out', main: 'y', keys: { y: 'y' },
    help: 'SEG7 이름 Y30 [digits=2] — BCD 입력 (자리당 4점, 아래 자리부터) · mode=seg 이면 a~g,dp 8점 직접 구동',
    init(d) { d.digits = clamp(num(d.p.digits, 1) | 0, 1, 4); d.vals = new Array(d.digits).fill(0); d.segs = 0; },
    step(d, io) {
      if (d.p.mode === 'seg') {
        let s = 0;
        for (let b = 0; b < 8; b++) s |= io.y({ dev: 'Y', addr: d.y.addr + b }) << b;
        d.segs = s;
        return;
      }
      for (let k = 0; k < d.digits; k++) {
        let v = 0;
        for (let b = 0; b < 4; b++) v |= io.y({ dev: 'Y', addr: d.y.addr + k * 4 + b }) << b;
        d.vals[k] = v;
      }
    },
    get(d) {
      if (d.p.mode === 'seg') return d.segs;
      if (d.vals.some((v) => v > 9)) return -1;
      return d.vals.reduce((acc, v, k) => acc + v * Math.pow(10, k), 0);
    }
  };

  T.SOL = {
    name: '솔레노이드 밸브', cat: 'out', main: 'y', keys: { y: 'y' },
    help: 'SOL 이름 Y21 [type=5/2|3/2] [label=밸브] — 전자밸브 (실린더와 따로 표시할 때)',
    init(d) { d.on = 0; },
    step(d, io) { d.on = io.y(d.y); },
    get(d) { return d.on; }
  };
  T.MC = {
    name: '전자접촉기', cat: 'out', main: 'y', keys: { y: 'y', aux: 'x', thr: 'x' },
    help: 'MC 이름 Y22 [aux=X8 (a접점 보조접점 되먹임)] [thr=X9 (과부하 계전기 b접점)] [label=MC1]',
    init(d) { d.on = 0; d.trip = 0; },
    step(d, io) { d.on = d.trip ? 0 : io.y(d.y); },
    inputs(d) {
      const out = [];
      if (d.aux) out.push([d.aux, d.on]);
      if (d.thr) out.push([d.thr, d.trip ? 0 : 1]);      // 정상이면 ON (b 접점 배선)
      return out;
    },
    set(d, v) { d.trip = v ? 1 : 0; },                    // 조작판에서 누르면 과부하 트립
    get(d) { return d.trip ? 'trip' : d.on; }
  };

  // ---------------------------------------------------------------- 기계 장치
  T.CYL = {
    name: '공압 실린더', cat: 'mech', keys: { sol: 'y', a: 'y', b: 'y', ext: 'x', ret: 'x' },
    help: 'CYL 이름 sol=Y21 ext=X4 ret=X5 [time=1.0]  (편솔: 전자밸브 ON 전진 · OFF 스프링 후진)\n' +
      'CYL 이름 a=Y21 b=Y22 ext=X4 ret=X5          (양솔: a ON 전진 · b ON 후진 · 둘 다 OFF 면 위치 유지)',
    init(d) { d.pos = d.p.pos === '1' ? 1 : 0; d.time = Math.max(0.05, num(d.p.time, 1)); d.dir = 0; d.fault = ''; },
    step(d, io, dt) {
      let target = null;
      if (d.sol) target = io.y(d.sol) ? 1 : 0;
      else {
        const a = d.a ? io.y(d.a) : 0, b = d.b ? io.y(d.b) : 0;
        d.fault = a && b ? '양쪽 솔레노이드 동시 ON' : '';
        if (a && !b) target = 1; else if (b && !a) target = 0;
      }
      if (target == null || d.jam) { d.dir = 0; return; }
      const step = dt / 1000 / d.time;
      if (d.pos < target) { d.pos = Math.min(target, d.pos + step); d.dir = 1; }
      else if (d.pos > target) { d.pos = Math.max(target, d.pos - step); d.dir = -1; }
      else d.dir = 0;
    },
    inputs(d) {
      const out = [];
      if (d.ext) out.push([d.ext, d.pos >= 0.98 ? 1 : 0]);
      if (d.ret) out.push([d.ret, d.pos <= 0.02 ? 1 : 0]);
      return out;
    },
    set(d, v) { d.pos = v ? 1 : 0; },
    get(d) { return d.pos >= 0.98 ? 'ext' : d.pos <= 0.02 ? 'ret' : 'mid'; }
  };
  T.MOTOR = {
    name: 'DC 모터', cat: 'mech', keys: { fwd: 'y', rev: 'y', da: 'da', run: 'x' },
    help: 'MOTOR 이름 fwd=Y22 [rev=Y23] [da=1 (D/A 채널 속도 지령)] [rpm=3000] [run=X9 (회전 중 신호)]',
    init(d) { d.speed = 0; d.angle = 0; d.max = num(d.p.rpm, 3000); d.fault = ''; d.rpm = 0; },
    step(d, io, dt) {
      const f = d.fwd ? io.y(d.fwd) : 0, r = d.rev ? io.y(d.rev) : 0;
      d.fault = f && r ? '정회전 · 역회전 동시 ON (단락!)' : '';
      let target = f && !r ? 1 : r && !f ? -1 : 0;
      if (d.da != null && target) target *= clamp(io.da(d.da), 0, 1);
      const tau = 0.35;
      d.speed += (target - d.speed) * Math.min(1, dt / 1000 / tau);
      if (Math.abs(d.speed) < 1e-3 && !target) d.speed = 0;
      d.rpm = Math.round(d.speed * d.max);
      d.angle = (d.angle + d.speed * d.max / 60 * 360 * dt / 1000) % 360;
    },
    inputs(d) { return d.run ? [[d.run, Math.abs(d.rpm) > 30 ? 1 : 0]] : []; },
    get(d) { return d.rpm; }
  };
  T.CONV = {
    name: '컨베이어', cat: 'mech', wide: true, keys: { run: 'y', rev: 'y', feed: 'y' },
    help: 'CONV 이름 run=Y24 [sens=X10@0.1,X11@0.9 (광전 센서 위치 0~1)] [senA=X12@0.5 (A 제품만 감지)]\n' +
      '     [push=CYL1@0.6 (실린더가 밀어내는 위치)] [len=2 (끝까지 가는 시간 초)] [mix=1 (A/B 제품 섞기)] [end=stop|drop]',
    init(d) {
      d.items = []; d.seq = 0; d.len = Math.max(0.3, num(d.p.len, 3)); d.sens = posList(d.p.sens); d.senA = posList(d.p.sena);
      d.done = 0; d.pushed = 0; d.moving = 0; d.nextKind = 0;
      const pp = String(d.p.push || '').split('@');
      d.push = pp[0] ? { name: pp[0].toUpperCase(), at: num(pp[1], 0.6) } : null;
    },
    step(d, io, dt, plant) {
      const run = d.run ? io.y(d.run) : 0, rev = d.rev ? io.y(d.rev) : 0;
      d.moving = run ? (rev ? -1 : 1) : 0;
      if (d.feed && io.y(d.feed) && !d.feedPrev) this.add(d);
      d.feedPrev = d.feed ? io.y(d.feed) : 0;
      const v = d.moving * dt / 1000 / d.len;
      const W = 0.07;       // 제품 폭
      d.items.sort((a, b) => b.x - a.x);
      d.items.forEach((it, i) => {
        if (!v) return;
        let nx = it.x + v;
        const endStop = d.p.end !== 'drop';
        if (v > 0) {
          const ahead = d.items[i - 1];
          if (ahead && nx > ahead.x - W) nx = Math.max(it.x, ahead.x - W);
          if (endStop && nx > 1) nx = 1;
        } else if (nx < 0) nx = 0;
        it.x = nx;
      });
      if (d.p.end === 'drop') d.items = d.items.filter((it) => { if (it.x > 1.02) { d.done++; return false; } return true; });
      if (d.push) {
        const cyl = plant.byName[d.push.name];
        if (cyl && cyl.pos > 0.5) {
          const before = d.items.length;
          d.items = d.items.filter((it) => Math.abs(it.x - d.push.at) > W * 0.8);
          d.pushed += before - d.items.length;
          cyl.jam = false;
        }
      }
    },
    add(d, kind) {
      if (d.items.some((it) => it.x < 0.08)) return false;
      const mix = d.p.mix === '1';
      const k = kind != null ? kind : mix ? (d.nextKind++ % 3 === 1 ? 'B' : 'A') : 'A';
      d.items.push({ id: ++d.seq, x: 0, kind: k });
      return true;
    },
    inputs(d) {
      const out = [];
      const W = 0.07 / 2;
      d.sens.forEach((s) => out.push([s.a, d.items.some((it) => Math.abs(it.x - s.at) <= W) ? 1 : 0]));
      d.senA.forEach((s) => out.push([s.a, d.items.some((it) => it.kind === 'A' && Math.abs(it.x - s.at) <= W) ? 1 : 0]));
      return out;
    },
    set(d, v) { if (v === 'A' || v === 'B') this.add(d, v); else if (v) this.add(d); else d.items = []; },
    get(d) { return d.items.length; }
  };
  T.TANK = {
    name: '물 탱크', cat: 'mech', keys: { in: 'y', out: 'y', hi: 'x', lo: 'x', ad: 'ad' },
    help: 'TANK 이름 in=Y25 (급수 밸브) out=Y26 (배수 밸브) [hi=X12 lo=X13 (플로트 스위치 80% · 20%)] [ad=3 (수위 → A/D)]\n' +
      '     [fill=10 (초당 급수 %)] [drain=8] [use=0 (항상 빠져나가는 %/초)] [level=30]',
    init(d) { d.level = num(d.p.level, 30); d.fill = num(d.p.fill, 10); d.drain = num(d.p.drain, 8); d.use = num(d.p.use, 0); d.hiAt = num(d.p.hiat, 80); d.loAt = num(d.p.loat, 20); },
    step(d, io, dt) {
      const s = dt / 1000;
      const fin = d.in ? io.y(d.in) : 0, fout = d.out ? io.y(d.out) : 0;
      d.inflow = fin; d.outflow = fout;
      d.level = clamp(d.level + (fin ? d.fill : 0) * s - (fout ? d.drain : 0) * s - d.use * s * (d.level > 0 ? 1 : 0), 0, 100);
    },
    inputs(d) {
      const out = [];
      if (d.hi) out.push([d.hi, d.level >= d.hiAt ? 1 : 0]);
      if (d.lo) out.push([d.lo, d.level >= d.loAt ? 1 : 0]);
      return out;
    },
    analog(d) { return d.ad != null ? [[d.ad, d.level / 100]] : []; },
    set(d, v) { d.level = clamp(+v, 0, 100); }, get(d) { return Math.round(d.level * 10) / 10; }
  };
  T.OVEN = {
    name: '히터 · 온도', cat: 'mech', keys: { heat: 'y', da: 'da', ad: 'ad', fan: 'y' },
    help: 'OVEN 이름 heat=Y27 (히터 ON/OFF) 또는 da=2 (히터 출력 0~100%) ad=4 (온도 0~200℃ → A/D) [fan=Y28 냉각] [amb=20] [temp=20]',
    init(d) { d.temp = num(d.p.temp, num(d.p.amb, 20)); d.amb = num(d.p.amb, 20); d.power = 0; d.tmax = num(d.p.tmax, 200); },
    step(d, io, dt) {
      const s = dt / 1000;
      let p = d.heat ? io.y(d.heat) : 0;
      if (d.da != null) p = Math.max(p, clamp(io.da(d.da), 0, 1));
      d.power = p;
      const loss = 0.02 * (d.fan && io.y(d.fan) ? 3 : 1);
      d.temp += (p * 3.0 - (d.temp - d.amb) * loss) * s;        // 최대 약 170℃ 까지 오른다
    },
    analog(d) { return d.ad != null ? [[d.ad, clamp(d.temp / d.tmax, 0, 1)]] : []; },
    set(d, v) { d.temp = +v; }, get(d) { return Math.round(d.temp * 10) / 10; }
  };

  // ---------------------------------------------------------------- 아날로그 장비
  T.POT = {
    name: '포텐셔미터', cat: 'ana', keys: { ad: 'ad' },
    help: 'POT 이름 ad=1 [val=50 (회전 위치 %)] — 채널 범위 전체(예: 0~10V)를 출력',
    init(d) { d.val = clamp(num(d.p.val, 50), 0, 100); },
    analog(d) { return [[d.ad, d.val / 100]]; },
    set(d, v) { d.val = clamp(+v, 0, 100); }, get(d) { return d.val; }
  };
  T.USONIC = {
    name: '초음파 센서', cat: 'ana', keys: { ad: 'ad', near: 'x' },
    help: 'USONIC 이름 ad=2 [min=50 max=500 (측정 범위 mm → 출력 0~100%)] [dist=200] [near=X9 (가까움 출력)] [nearat=100]',
    init(d) { d.min = num(d.p.min, 50); d.max = num(d.p.max, 500); d.dist = num(d.p.dist, 200); d.nearAt = num(d.p.nearat, 100); },
    analog(d) { return [[d.ad, clamp((d.dist - d.min) / (d.max - d.min), 0, 1)]]; },
    inputs(d) { return d.near ? [[d.near, d.dist <= d.nearAt ? 1 : 0]] : []; },
    set(d, v) { d.dist = clamp(+v, 0, d.max * 1.2); }, get(d) { return d.dist; }
  };
  T.METER = {
    name: '아날로그 미터', cat: 'ana', keys: { da: 'da' },
    help: 'METER 이름 da=1 [scale=0-100] [unit=%] — D/A 출력을 바늘로 표시',
    init(d) { d.frac = 0; const [a, b] = String(d.p.scale || '0-100').split('-').map(Number); d.s0 = isFinite(a) ? a : 0; d.s1 = isFinite(b) ? b : 100; },
    step(d, io) { d.frac = io.da(d.da); d.volt = io.daRaw(d.da); },
    get(d) { return Math.round((d.s0 + d.frac * (d.s1 - d.s0)) * 10) / 10; }
  };

  // ---------------------------------------------------------------- 통신 장비
  T.TERM = {
    name: '시리얼 터미널', cat: 'com', wide: true, keys: { port: 'port' },
    help: 'TERM 이름 port=CH1 [eol=crlf|cr|none] — PC 터미널 (받은 글자 표시 · 입력해서 보내기)',
    init(d) { d.text = ''; d.lines = []; },
    set(d, v) { PLANT_SEND(d, String(v) + eolOf(d)); }, get(d) { return d.text; }
  };
  T.BCR = {
    name: '바코드 리더', cat: 'com', keys: { port: 'port' },
    help: 'BCR 이름 port=CH2 [codes=A100,B200,C300] — 누를 때마다 다음 코드를 CR LF 와 함께 보냄',
    init(d) { d.codes = String(d.p.codes || '4901234567894,8801234000012,A-1001').split(','); d.k = 0; d.last = ''; d.text = ''; },
    set(d, v) { const c = v === 1 || v === '1' || v === true ? d.codes[d.k++ % d.codes.length] : String(v); d.last = c; PLANT_SEND(d, c + '\r\n'); },
    get(d) { return d.last; }
  };
  const eolOf = (d) => ({ cr: '\r', none: '', lf: '\n' }[d.p.eol] != null ? { cr: '\r', none: '', lf: '\n' }[d.p.eol] : '\r\n');
  function PLANT_SEND(d, str) {
    const bytes = [];
    for (const ch of str) bytes.push(ch.charCodeAt(0) & 0xFF);
    if (d._plant) d._plant.serialSend(d, bytes);
  }

  // ==================================================================== 설비 전체
  class Plant {
    constructor(text, rack) {
      this.rack = rack;
      this.devices = [];
      this.byName = {};
      this.errors = [];
      this.parse(text || '');
    }
    parse(text) {
      String(text).replace(/\r/g, '').split('\n').forEach((raw, li) => {
        const line = raw.replace(/(^|\s)#.*$/, '').trim();
        if (!line) return;
        const toks = line.match(/"[^"]*"|\S+/g);
        const type = toks[0].toUpperCase();
        const spec = T[type];
        if (!spec) { this.errors.push(`${li + 1}행: 알 수 없는 장비 ${toks[0]}`); return; }
        const name = (toks[1] || type + (this.devices.length + 1)).toUpperCase();
        const p = {};
        toks.slice(2).forEach((t) => {
          const i = t.indexOf('=');
          if (i > 0) p[t.slice(0, i).toLowerCase()] = t.slice(i + 1).replace(/^"|"$/g, '');
          else if (spec.main && !p[spec.main]) p[spec.main] = t;
        });
        const d = { type, name, p, spec, label: p.label || '', _plant: this };
        // 연결 해석
        for (const k of Object.keys(spec.keys)) {
          const dir = spec.keys[k];
          const v = p[k];
          if (v == null) continue;
          if (dir === 'x' || dir === 'y') {
            const a = addrOf(v);
            if (!a || a.dev.toLowerCase() !== dir) { this.errors.push(`${name}: ${k}=${v} 는 ${dir.toUpperCase()} 주소여야 합니다`); continue; }
            d[k] = a;
          } else d[k] = v;
        }
        if (spec.main && !d[spec.main]) this.errors.push(`${name}: 주소가 없습니다 (${spec.help.split('\n')[0]})`);
        if (spec.keys.ad && p.ad == null && (type === 'POT' || type === 'USONIC')) d.ad = '1';
        if (spec.keys.da && p.da == null && type === 'METER') d.da = '1';
        if (spec.keys.port && p.port == null) d.port = 'CH1';
        spec.init(d);
        if (this.byName[name]) this.errors.push(`장비 이름이 겹칩니다: ${name}`);
        this.byName[name] = d;
        this.devices.push(d);
      });
      this.checkRack();
    }
    checkRack() {
      const r = this.rack;
      if (!r) return;
      this.devices.forEach((d) => {
        Object.keys(d.spec.keys).forEach((k) => {
          const dir = d.spec.keys[k];
          const v = d[k];
          if (v == null) return;
          if (dir === 'x' && !r.hasInput(v.addr) && !(d.type === 'DSW')) this.errors.push(`${d.name}: ${v.text} 에 입력 모듈이 없습니다`);
          if (dir === 'y' && !r.hasOutput(v.addr) && !(d.type === 'SEG7')) this.errors.push(`${d.name}: ${v.text} 에 출력 모듈이 없습니다`);
          if (dir === 'ad' && !r.resolveAnalog('ad', v)) this.errors.push(`${d.name}: A/D 채널 ${v} 이(가) 없습니다`);
          if (dir === 'da' && !r.resolveAnalog('da', v)) this.errors.push(`${d.name}: D/A 채널 ${v} 이(가) 없습니다`);
          if (dir === 'port' && !r.resolveSerial(v)) this.errors.push(`${d.name}: 시리얼 채널 ${v} 이(가) 없습니다`);
        });
      });
      // 시리얼 수신 연결
      r.slots.filter((m) => m.serial).forEach((m) => {
        m.onTransmit = (ch, bytes) => {
          this.devices.forEach((d) => {
            if (!d.port) return;
            const rs = r.resolveSerial(d.port);
            if (!rs || rs.mod !== m || rs.ch !== ch) return;
            const s = bytes.map((b) => String.fromCharCode(b)).join('');
            d.text = (d.text + s).slice(-4000);
            if (this.onSerial) this.onSerial(d, s);
          });
        };
      });
    }
    serialSend(d, bytes) {
      const rs = this.rack && this.rack.resolveSerial(d.port);
      if (!rs) return false;
      rs.mod.receive(rs.ch, bytes);
      d.sent = (d.sent || '') + bytes.map((b) => String.fromCharCode(b)).join('');
      return true;
    }

    /** 한 스캔 동안의 설비 동작: 출력 읽기 → 물리 → 입력 쓰기 */
    step(dt) {
      const r = this.rack;
      const io = {
        y: (a) => (a && r ? r.getOutput(a.addr) : 0),
        da: (ref) => {
          const rr = r && r.resolveAnalog('da', ref);
          if (!rr) return 0;
          const rg = rr.mod.rangeOf(rr.ch);
          return (rr.mod.output[rr.ch] - rg.lo) / (rg.hi - rg.lo);
        },
        daRaw: (ref) => (r ? r.getAnalogOut(ref) : 0)
      };
      this.devices.forEach((d) => { if (d.spec.step) d.spec.step(d, io, dt, this); });
      this.writeInputs();
    }
    writeInputs() {
      const r = this.rack;
      if (!r) return;
      const touched = new Map();
      this.devices.forEach((d) => {
        if (d.spec.inputs) d.spec.inputs(d).forEach(([a, v]) => {
          if (!a) return;
          touched.set(a.addr, (touched.get(a.addr) || 0) | (v ? 1 : 0));   // 같은 입력에 여러 장비 → OR
        });
        if (d.spec.analog) d.spec.analog(d).forEach(([ch, frac]) => {
          const rr = r.resolveAnalog('ad', ch);
          if (!rr) return;
          const rg = rr.mod.rangeOf(rr.ch);
          rr.mod.input[rr.ch] = rg.lo + clamp(frac, 0, 1.02) * (rg.hi - rg.lo);
        });
      });
      touched.forEach((v, a) => r.setInput(a, v));
    }

    set(name, v) {
      const d = this.byName[String(name).toUpperCase()];
      if (!d || !d.spec.set) return false;
      d.spec.set(d, v);
      this.writeInputs();
      return true;
    }
    get(name) {
      const d = this.byName[String(name).toUpperCase()];
      return d && d.spec.get ? d.spec.get(d) : undefined;
    }
    /** 디바이스 코멘트: 장비 이름 · 라벨 */
    comments() {
      const c = {};
      const put = (a, t) => { if (a && !c[a.text]) c[a.text] = t; };
      this.devices.forEach((d) => {
        const lbl = d.label || d.name;
        Object.keys(d.spec.keys).forEach((k) => {
          const v = d[k];
          if (!v || typeof v !== 'object') return;
          const suffix = { ext: ' 전진끝', ret: ' 후진끝', sol: ' 솔레노이드', a: ' 전진 SOL', b: ' 후진 SOL', fwd: ' 정회전', rev: ' 역회전', run: d.type === 'CONV' ? ' 운전' : ' 회전중', hi: ' 상한', lo: ' 하한', in: ' 급수', out: ' 배수', heat: ' 히터', fan: ' 냉각팬', feed: ' 투입', near: ' 근접' }[k] || '';
          put(v, lbl + suffix);
        });
        if (d.sens) d.sens.forEach((s, i) => put(s.a, `${lbl} 센서${i + 1}`));
        if (d.senA) d.senA.forEach((s) => put(s.a, `${lbl} A감지`));
      });
      return c;
    }
  }
  PLC.Plant = Plant;
})(typeof window !== 'undefined' ? window : globalThis);
