/* PLC 모니터 패널 (오른쪽 창)
 *  - RUN/STOP 스위치 · RESET · 1 스캔 · 속도 · 스캔 타임 · 에러 표시
 *  - 랙 그림: CPU 와 모듈의 입출력 LED (실제 모듈 표시등처럼)
 *  - 디바이스 모니터 (현재값 변경 · 강제 ON/OFF)
 *  - A/D · D/A 채널, 시리얼 통신 로그, 실제 PLC 연동
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, '0');

  class MonitorPanel {
    constructor(host, opts = {}) {
      this.host = host;
      this.opts = opts;
      this.sim = null;
      this.watch = [];
      this.host.classList.add('mp');
      this.build();
    }
    attach(sim, watch) {
      if (this.off) { this.off(); this.off = null; }
      this.sim = sim;
      this.watch = (watch || []).slice();
      if (this.link) { this.link.stop(); this.link = null; }
      this.build();
      if (sim) {
        let last = 0;
        this.off = sim.on((type) => {
          if (type === 'program' || type === 'reset') { this.buildRack(); this.renderWatch(); }
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (type === 'tick' && now - last < 60) return;     // 화면 갱신은 초당 16회 정도면 충분
          last = now;
          this.update();
        });
      }
    }
    build() {
      const sim = this.sim;
      if (!sim) { this.host.innerHTML = '<div class="mp-body"><div class="mp-card"><div class="bd">래더를 선택하면 PLC 상태가 표시됩니다.</div></div></div>'; return; }
      const r = sim.rack;
      const ad = r.modulesOf('ad'), da = r.modulesOf('da'), ser = r.slots.filter((m) => m.serial);
      this.host.innerHTML = `
        <div class="mp-head"><span class="mp-title">⚙ ${esc(r.cpuSpec.model)}</span><span class="spacer"></span>
          <span class="mp-scan" data-f="scan"></span></div>
        <div class="mp-run">
          <button class="btn small" data-act="run">▶ RUN</button>
          <button class="btn small" data-act="stop">■ STOP</button>
          <button class="btn small ghost" data-act="reset" title="CPU 리셋 (모든 디바이스 초기화)">⟲ RESET</button>
          <button class="btn small ghost" data-act="step" title="1 스캔만 실행">⏭ 1스캔</button>
          <div class="mp-leds">
            <span class="led g" data-led="run"><i></i>RUN</span>
            <span class="led r" data-led="err"><i></i>ERR</span>
          </div>
          <select data-act="speed" title="시뮬레이션 속도">
            <option value="0.1">×0.1</option><option value="0.25">×0.25</option><option value="0.5">×0.5</option>
            <option value="1" selected>×1</option><option value="2">×2</option><option value="5">×5</option>
          </select>
        </div>
        <div class="mp-body">
          <div class="mp-err hidden" data-f="err"></div>
          <div class="mp-card"><h4>🗄 랙 구성<span class="spacer"></span><button class="btn small ghost" data-act="rack">모듈 구성</button></h4>
            <div class="bd"><div class="rack" data-f="rack"></div><div class="muted" data-f="racknote" style="font-size:11px;color:#7d8799"></div></div></div>
          <div class="mp-card"><h4>🔍 디바이스 모니터<span class="spacer"></span><button class="btn small ghost" data-act="usedev" title="프로그램에서 쓰는 디바이스 넣기">자동</button></h4>
            <div class="bd"><table class="dm"><tbody data-f="dm"></tbody></table>
              <div class="dm-add"><input type="text" data-f="dmadd" placeholder="디바이스 (예: D0, M100, T0)"><button class="btn small" data-act="dmadd">추가</button></div></div></div>
          ${ad.length || da.length ? `<div class="mp-card"><h4>🎚 아날로그 입출력</h4><div class="bd" data-f="ana"></div></div>` : ''}
          ${ser.length ? `<div class="mp-card"><h4>📡 시리얼 통신<span class="spacer"></span><button class="btn small ghost" data-act="serclr">지움</button></h4><div class="bd"><div class="serlog" data-f="ser"></div></div></div>` : ''}
          <div class="mp-card"><h4>🔌 실제 PLC 연동<span class="spacer"></span><button class="btn small ghost" data-act="brhelp">?</button></h4>
            <div class="bd"><div class="plcbr">
              <div class="row"><label>브리지</label><input type="text" data-f="brurl" value="http://127.0.0.1:8770"></div>
              <div class="row"><label>PLC IP</label><input type="text" data-f="brip" value="192.168.3.39"><input type="text" data-f="brport" value="5007" style="max-width:62px"></div>
              <div class="row"><label>모드</label><select data-f="brmode"><option value="monitor">모니터 (읽기)</option><option value="hil">가상 설비 연동</option></select>
                <select data-f="brx" title="가상 설비의 센서를 쓸 곳"><option value="P">P 그대로</option><option value="M1000">M1000~</option><option value="M2000">M2000~</option></select></div>
              <div class="row"><button class="btn small" data-act="brconn">연결</button><button class="btn small ghost" data-act="brdis">끊기</button>
                <button class="btn small ghost" data-act="brrun" title="원격 RUN">원격 RUN</button><button class="btn small ghost" data-act="brstop">원격 STOP</button></div>
              <div class="st" data-f="brst">연결되지 않음 — 시뮬레이션으로 동작합니다.</div>
            </div></div></div>
        </div>`;
      this.f = {};
      this.host.querySelectorAll('[data-f]').forEach((el) => { this.f[el.dataset.f] = el; });
      this.buildRack();
      this.renderWatch();
      this.bind();
      this.update();
    }

    // ---------------------------------------------------------------- 랙
    buildRack() {
      const r = this.sim.rack;
      const host = this.f.rack;
      if (!host) return;
      host.innerHTML = `<div class="mod psu"><div class="t">${esc(r.power || 'XGP-ACF2')}</div><div class="xy">전원</div></div>
        <div class="mod cpu" data-slot="cpu"><div class="t">${esc(r.cpuSpec.model)}</div><div class="xy" data-f="cpumode">STOP</div></div>` +
        r.slots.map((m) => {
          const t = r.ioTable()[m.slot];
          const pts = (m.kind === 'in' || m.kind === 'out' || m.kind === 'io') ? `<div class="pts">${new Array(Math.min(32, m.spec.n || 0)).fill(0).map((_, i) => `<i data-pt="${m.slot}:${i}"${m.kind === 'out' ? ' class="y"' : ''}></i>`).join('')}</div>` : '';
          return `<div class="mod" data-slot="${m.slot}" title="${esc(m.spec.desc)}"><div class="t">${esc(m.label())}</div>${pts}<div class="xy">${esc(t.xy)}</div></div>`;
        }).join('');
      this.ptEls = {};
      host.querySelectorAll('[data-pt]').forEach((el) => { this.ptEls[el.dataset.pt] = el; });
      this.f.cpumode = host.querySelector('[data-f=cpumode]');
      if (this.f.racknote) this.f.racknote.textContent = `${r.base} (${r.slots.length}슬롯) · ${r.cpuSpec.note}`;
    }

    // ---------------------------------------------------------------- 디바이스 모니터
    renderWatch() {
      const tb = this.f.dm;
      if (!tb) return;
      if (!this.watch.length) { tb.innerHTML = '<tr><td class="c" colspan="4">아래에 디바이스를 추가하거나 [자동] 을 누르세요</td></tr>'; return; }
      const cm = this.sim.comments();
      tb.innerHTML = this.watch.map((w, i) => `<tr data-w="${i}"><td class="n">${esc(w)}</td><td class="v" data-v="${i}">–</td>
        <td class="c">${esc(cm[w] || '')}</td>
        <td class="a"><button data-act="dmset" data-i="${i}" title="현재값 변경 · ON/OFF">✎</button></td>
        <td class="a"><button data-act="dmdel" data-i="${i}" title="빼기">✕</button></td></tr>`).join('');
      this.vEls = [...tb.querySelectorAll('[data-v]')];
    }
    addWatch(text) {
      const t = String(text || '').trim().toUpperCase();
      if (!t) return;
      if (!PLC.parseOperand(t) && !/^(TN|CN|TS|CS)\d+$/.test(t)) { this.toast('디바이스 표기가 올바르지 않습니다'); return; }
      if (this.watch.indexOf(t) < 0) this.watch.push(t);
      this.renderWatch();
    }
    autoWatch() {
      const set = new Set(this.watch);
      this.sim.program.steps.forEach((s) => (s.operands || []).forEach((o) => {
        if (o.kind !== 'dev') return;
        if (['D', 'W', 'R', 'T', 'ST', 'C', 'Z'].indexOf(o.dev) >= 0) set.add(o.text);
        if (o.dev === 'M' && set.size < 24) set.add(o.text);
      }));
      this.watch = [...set].slice(0, 32);
      this.renderWatch();
    }

    // ---------------------------------------------------------------- 갱신
    update() {
      const sim = this.sim;
      if (!sim || !this.f) return;
      const cpu = sim.cpu;
      const run = cpu.state === 'RUN';
      this.host.querySelectorAll('[data-led]').forEach((el) => {
        const k = el.dataset.led;
        el.classList.toggle('on', k === 'run' ? run : cpu.state === 'ERROR');
      });
      const rb = this.host.querySelector('[data-act=run]'), sb = this.host.querySelector('[data-act=stop]');
      if (rb) rb.classList.toggle('run', run);
      if (sb) sb.classList.toggle('stop', !run);
      if (this.f.cpumode) this.f.cpumode.textContent = cpu.state;
      if (this.f.scan) this.f.scan.textContent = `스캔 ${cpu.scanCount} · ${(cpu.timeMs / 1000).toFixed(1)}s · ${sim.scanMs}ms`;
      const err = this.f.err;
      if (err) {
        err.classList.toggle('hidden', !cpu.error && !sim.program.errors.length);
        if (cpu.error) err.textContent = `⚠ CPU 오류 ${cpu.error.code}: ${cpu.error.msg}` + (cpu.error.line ? ` (${cpu.error.line}행 ${cpu.error.src})` : '');
        else if (sim.program.errors.length) err.textContent = `⚠ 프로그램 오류: ${sim.program.errors[0].line}행 ${sim.program.errors[0].msg}`;
      }
      // 모듈 LED
      const r = sim.rack;
      r.slots.forEach((m) => {
        if (!m.xin && !m.yout) return;
        const n = Math.min(32, m.spec.n || 0);
        for (let i = 0; i < n; i++) {
          const el = this.ptEls[`${m.slot}:${i}`];
          if (!el) continue;
          const on = m.kind === 'out' ? m.yout[i] : m.kind === 'io' ? (m.xin[i] || m.yout[i]) : m.xin[i];
          el.classList.toggle('on', !!on);
        }
      });
      // 디바이스 값
      if (this.vEls) this.vEls.forEach((el, i) => {
        const w = this.watch[i];
        const v = sim.read(w);
        const o = PLC.parseOperand(w);
        const bit = o && o.kind === 'dev' && (PLC.DEV[o.dev].bit || o.bit != null || ((o.dev === 'T' || o.dev === 'C' || o.dev === 'ST') && !/^(TN|CN|STN)/.test(w)));
        el.classList.toggle('on', bit && !!v);
        el.classList.toggle('off', bit && !v);
        if (v === undefined) el.textContent = '–';
        else if (bit) el.textContent = v ? 'ON' : 'OFF';
        else if (typeof v === 'number') el.textContent = `${v}  (H${hex(v & 0xFFFF, 4)})`;
        else el.textContent = String(v);
      });
      this.updateAnalog();
      this.updateSerial();
    }
    updateAnalog() {
      const host = this.f.ana;
      if (!host) return;
      const r = this.sim.rack;
      const rows = [];
      r.modulesOf('ad').forEach((m) => m.info().forEach((c) => {
        const rg = PLC.CATALOG.RANGES[m.ranges[c.ch - 1]];
        const frac = (c.analog - rg.lo) / (rg.hi - rg.lo);
        rows.push(`<div class="ach"><span class="nm">${esc(m.type)} CH${c.ch}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, frac * 100))}%"></i></span>
          <span class="v">${c.analog.toFixed(2)}${rg.unit} → ${c.digital}</span></div>`);
      }));
      r.modulesOf('da').forEach((m) => m.info().forEach((c) => {
        const rg = PLC.CATALOG.RANGES[m.ranges[c.ch - 1]];
        const frac = (c.analog - rg.lo) / (rg.hi - rg.lo);
        rows.push(`<div class="ach"><span class="nm">${esc(m.type)} CH${c.ch}</span><span class="bar"><i class="da" style="width:${Math.max(0, Math.min(100, frac * 100))}%"></i></span>
          <span class="v">${c.digital} → ${c.analog.toFixed(2)}${rg.unit}${c.enabled ? '' : ' (출력정지)'}</span></div>`);
      }));
      host.innerHTML = rows.join('');
    }
    updateSerial() {
      const host = this.f.ser;
      if (!host) return;
      const mods = this.sim.rack.slots.filter((m) => m.serial);
      const lines = [];
      mods.forEach((m) => m.ch.forEach((c) => {
        c.log.slice(-40).forEach((e) => {
          const txt = e.bytes.map((b) => (b === 13 ? '␍' : b === 10 ? '␊' : b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
          lines.push(`<div class="${e.dir}">CH${c.n} ${e.dir === 'tx' ? '▶ 송신' : '◀ 수신'} ${esc(txt)}</div>`);
        });
      }));
      const html = lines.join('');
      if (host.dataset.h !== String(html.length)) { host.dataset.h = String(html.length); host.innerHTML = html; host.scrollTop = host.scrollHeight; }
    }
    toast(m) { if (this.opts.toast) this.opts.toast(m); }

    // ---------------------------------------------------------------- 이벤트
    bind() {
      this.host.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const sim = this.sim;
        switch (b.dataset.act) {
          case 'run': sim.run(); break;
          case 'stop': sim.stop(); break;
          case 'reset': sim.reset(); break;
          case 'step': sim.step(1); break;
          case 'rack': if (this.opts.onRack) this.opts.onRack(); break;
          case 'usedev': this.autoWatch(); break;
          case 'dmadd': this.addWatch(this.f.dmadd.value); this.f.dmadd.value = ''; break;
          case 'dmdel': this.watch.splice(+b.dataset.i, 1); this.renderWatch(); break;
          case 'dmset': this.changeValue(+b.dataset.i); break;
          case 'serclr': sim.rack.slots.filter((m) => m.serial).forEach((m) => m.ch.forEach((c) => { c.log = []; })); this.f.ser.dataset.h = ''; break;
          case 'brconn': this.connectBridge(); break;
          case 'brdis': this.disconnectBridge(); break;
          case 'brrun': this.remote('run'); break;
          case 'brstop': this.remote('stop'); break;
          case 'brhelp': if (this.opts.onBridgeHelp) this.opts.onBridgeHelp(); break;
        }
        this.update();
      });
      this.host.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === this.f.dmadd) { this.addWatch(this.f.dmadd.value); this.f.dmadd.value = ''; }
      });
      const sp = this.host.querySelector('[data-act=speed]');
      if (sp) sp.onchange = () => { this.sim.speed = +sp.value; };
    }
    changeValue(i) {
      const w = this.watch[i];
      const cur = this.sim.read(w);
      const o = PLC.parseOperand(w);
      const bit = o && o.kind === 'dev' && (PLC.DEV[o.dev].bit || o.bit != null);
      if (bit) { this.sim.write(w, cur ? 0 : 1); this.update(); return; }
      const v = prompt(`${w} 의 현재값 변경`, String(cur));
      if (v == null) return;
      const n = /^H/i.test(v) ? parseInt(v.slice(1), 16) : parseInt(v, 10);
      if (!isFinite(n)) return;
      this.sim.write(w, n);
      this.update();
    }

    // ---------------------------------------------------------------- 실제 PLC
    async connectBridge() {
      if (!PLC.Bridge) return;
      const url = this.f.brurl.value.trim();
      const host = this.f.brip.value.trim();
      const port = +this.f.brport.value || 5007;
      this.bridge = this.bridge || new PLC.Bridge({ url });
      this.bridge.url = url;
      const st = this.f.brst;
      const show = () => {
        st.textContent = this.bridge.msg || this.bridge.state;
        st.className = 'st ' + (this.bridge.state === 'online' ? 'ok' : this.bridge.state === 'error' ? 'bad' : '');
      };
      this.bridge.on(show);
      try {
        await this.bridge.connect({ host, port, proto: 'tcp' });
        this.sim.stop();
        this.link = new PLC.BridgeLink(this.sim, this.bridge);
        this.link.xTarget = this.f.brx.value;
        this.link.start(this.f.brmode.value);
        st.textContent += ` · ${this.f.brmode.value === 'hil' ? '가상 설비를 실제 PLC 에 연결했습니다' : '모니터 중 (시뮬레이션 CPU 는 정지)'}`;
      } catch (e) { show(); }
    }
    async disconnectBridge() {
      if (this.link) { this.link.stop(); this.link = null; }
      if (this.bridge) await this.bridge.disconnect();
      if (this.f.brst) { this.f.brst.textContent = '연결되지 않음 — 시뮬레이션으로 동작합니다.'; this.f.brst.className = 'st'; }
    }
    async remote(cmd) {
      if (!this.bridge || this.bridge.state !== 'online') { this.toast('먼저 PLC 에 연결하세요'); return; }
      try { await this.bridge.remote(cmd); this.f.brst.textContent = `원격 ${cmd.toUpperCase()} 요청을 보냈습니다`; }
      catch (e) { this.f.brst.textContent = '원격 제어 실패: ' + e.message; this.f.brst.className = 'st bad'; }
    }
  }
  PLC.MonitorPanel = MonitorPanel;
})(typeof window !== 'undefined' ? window : globalThis);
