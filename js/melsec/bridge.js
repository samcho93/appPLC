/* 실제 MELSEC PLC 연동 (로컬 브리지 plcbridge.py 를 통한 MC 프로토콜 통신)
 *  브라우저는 PLC 와 직접 TCP 통신을 할 수 없으므로, 내 PC 에서 실행하는 브리지가 중계한다.
 *    브라우저 ── HTTP/JSON ──▶ 127.0.0.1:8770 (plcbridge) ── MC 프로토콜(3E 프레임) ──▶ PLC
 *  모드
 *    monitor : 실제 PLC 의 디바이스를 읽어 래더 모니터 · 설비 화면에 보여 준다 (읽기 전용)
 *    hil     : 시뮬레이터의 현장 설비를 실제 PLC 에 물린다 (센서 → PLC 입력 쓰기, PLC 출력 → 설비)
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};

  class Bridge {
    constructor(opts = {}) {
      this.url = opts.url || 'http://127.0.0.1:8770';
      this.state = 'idle';          // idle · connecting · online · error
      this.msg = '';
      this.info = null;
      this.listeners = new Set();
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { this.listeners.forEach((f) => f(this)); }
    setState(s, msg) { this.state = s; this.msg = msg || ''; this.emit(); }

    async api(path, body) {
      const res = await fetch(this.url + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const j = await res.json().catch(() => ({ ok: false, error: '응답을 읽을 수 없습니다' }));
      if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`);
      return j;
    }
    async ping() {
      const j = await this.api('/api/status');
      this.info = j;
      return j;
    }
    async connect(target) {
      this.setState('connecting', '브리지에 연결하는 중…');
      try {
        await this.ping();
      } catch (e) {
        this.setState('error', `브리지를 찾을 수 없습니다 (${this.url}). bridge/start_bridge.bat 를 실행하세요.`);
        throw e;
      }
      try {
        const j = await this.api('/api/connect', target);
        this.info = j;
        this.target = target;
        this.setState('online', `${j.cpu || 'PLC'} 연결됨 (${target.host}:${target.port})`);
        return j;
      } catch (e) {
        this.setState('error', 'PLC 연결 실패: ' + e.message);
        throw e;
      }
    }
    async disconnect() {
      try { await this.api('/api/disconnect', {}); } catch (e) { /* 무시 */ }
      this.setState('idle', '');
    }
    /** items: [{dev:'X', addr:0, n:32, type:'bit'}] → [[값…]] */
    read(items) { return this.api('/api/read', { items }).then((j) => j.values); }
    write(dev, addr, type, values) { return this.api('/api/write', { dev, addr, type, values }); }
    remote(cmd) { return this.api('/api/remote', { cmd }); }
  }

  /** 주기적으로 실제 PLC 와 시뮬레이터를 주고받는 연결 담당 */
  class BridgeLink {
    /** sim: PLC.Sim · bridge: Bridge */
    constructor(sim, bridge) {
      this.sim = sim;
      this.bridge = bridge;
      this.mode = 'monitor';
      this.periodMs = 100;
      this.xTarget = 'X';       // 입력을 쓸 곳: 'X'(입력 모듈이 없는 슬롯) 또는 'M1000' 같은 오프셋
      this.extra = ['D0:10'];
      this.running = false;
      this.err = '';
    }
    start(mode) {
      this.mode = mode || this.mode;
      if (this.running) return;
      this.running = true;
      this.loop();
    }
    stop() { this.running = false; }
    /** 읽을 항목: 랙의 X · Y 범위 + 프로그램에서 쓰는 M · D */
    items() {
      const r = this.sim.rack;
      const out = [];
      const xEnd = Math.max(32, ...r.slots.map((m) => m.head + m.pts));
      out.push({ dev: 'X', addr: 0, n: xEnd, type: 'bit' });
      out.push({ dev: 'Y', addr: 0, n: xEnd, type: 'bit' });
      out.push({ dev: 'M', addr: 0, n: 256, type: 'bit' });
      this.extra.forEach((s) => {
        const m = /^([A-Z]+)(\d+):(\d+)$/i.exec(s);
        if (m) out.push({ dev: m[1].toUpperCase(), addr: +m[2], n: +m[3], type: 'word' });
      });
      return out;
    }
    async loop() {
      while (this.running && this.bridge.state === 'online') {
        const t0 = performance.now();
        try {
          if (this.mode === 'hil') await this.writeInputs();
          const its = this.items();
          const vals = await this.bridge.read(its);
          this.apply(its, vals);
          this.err = '';
        } catch (e) {
          this.err = e.message;
          this.bridge.setState('error', '통신 오류: ' + e.message);
          this.running = false;
          break;
        }
        const wait = Math.max(20, this.periodMs - (performance.now() - t0));
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    /** 실제 PLC 의 값 → 시뮬레이터 디바이스 메모리 (화면 표시용) */
    apply(items, values) {
      const cpu = this.sim.cpu;
      items.forEach((it, i) => {
        const v = values[i] || [];
        if (it.type === 'bit') {
          const arr = cpu.bits[it.dev];
          if (!arr) return;
          for (let k = 0; k < v.length; k++) arr[it.addr + k] = v[k] ? 1 : 0;
          if (it.dev === 'Y') for (let k = 0; k < v.length; k++) { const e = this.sim.rack.ymap.get(it.addr + k); if (e) e[0].yout[e[1]] = v[k] ? 1 : 0; }
        } else {
          const arr = cpu.words[it.dev];
          if (!arr) return;
          for (let k = 0; k < v.length; k++) arr[it.addr + k] = PLC.toS16(v[k]);
        }
      });
      // 설비는 실제 PLC 의 출력으로 움직인다
      this.sim.plant.step(this.periodMs);
      this.sim.emit('tick');
    }
    /** 시뮬레이터의 센서 상태 → 실제 PLC */
    async writeInputs() {
      const cpu = this.sim.cpu;
      const r = this.sim.rack;
      const n = Math.max(32, ...r.slots.map((m) => m.head + m.pts));
      const bits = [];
      for (let i = 0; i < n; i++) bits.push(r.hasInput(i) ? r.getInput(i) : cpu.bits.X[i]);
      const m = /^([A-Z]+)(\d+)$/i.exec(this.xTarget);
      if (this.xTarget === 'X') await this.bridge.write('X', 0, 'bit', bits);
      else if (m) await this.bridge.write(m[1].toUpperCase(), +m[2], 'bit', bits);
    }
  }

  PLC.Bridge = Bridge;
  PLC.BridgeLink = BridgeLink;
})(typeof window !== 'undefined' ? window : globalThis);
