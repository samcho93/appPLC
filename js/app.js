/* appPLC — PLC 래더 편집 · 현장 설비 시뮬레이션 웹앱 (스마트폰 · 태블릿 · PC)
 *  강좌 사이트(studyPLC · studyPLCLS)의 PLC 에디터에서 강좌를 빼고, 작은 화면에 맞게 다시 짠 것.
 *  제조사(MELSEC Q · LS XGK)별 엔진은 js/<제조사>/ 에 그대로 두고, 다른 부분은 PLC.VENDOR 로 읽는다.
 */
(function () {
  'use strict';
  const V = PLC.VENDOR;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    key: (k) => (k.indexOf('app.') === 0 ? 'plcapp.' + k.slice(4) : `plcapp.${V.id}.${k}`),
    get(k, d) { try { const v = localStorage.getItem(store.key(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(store.key(k), v); } catch (e) { /* 저장 불가 */ } },
    remove(k) { try { localStorage.removeItem(store.key(k)); } catch (e) { /* 무시 */ } }
  };
  const ed = { tab: 'ladder' };
  window.PlcApp = ed;
  const DEFAULT_PROJECT = V.defaultProject(PLC.DEFAULT_RACK);

  // ================================================================== 초기화
  function init() {
    const vb = $('vendorBtn');
    vb.textContent = `${V.icon} ${V.name}`;
    vb.className = 'vendor ' + V.id;
    vb.title = `${V.maker} — 눌러서 기종 바꾸기`;
    $('ioHint').textContent = `한 줄에 장비 하나 — 예: ${V.ioExample}`;
    $('rackHint').textContent = `슬롯 번호와 모듈명 — 예: ${V.rackExample}`;
    document.querySelectorAll('[data-k]').forEach((el) => { el.textContent = V.keys[el.dataset.k] || ''; });
    document.title = `appPLC — ${V.maker} 래더 시뮬레이터`;
    ed.panel = new PLC.MonitorPanel($('monitorHost'), { toast, onBridgeHelp: () => help('bridge'), onRack: () => switchTab('rack') });
    placeMonitor();
    const text = fromHash() || store.get('project', '') || DEFAULT_PROJECT;
    open(text);
    bind();
    plantLayout();
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 저장 실패는 무시 */ });
    }
  }
  function fromHash() {
    const h = location.hash.slice(1);
    if (!h) return null;
    const q = new URLSearchParams(h);
    const t = q.get('p') ? decodeProject(q.get('p')) : null;
    if (t) history.replaceState(null, '', location.pathname + location.search);
    return t;
  }

  /** 프로젝트 텍스트로 시뮬레이터 · 화면을 다시 만든다 */
  function open(projectText) {
    const p = PLC.parseProject(projectText);
    ed.proj = p;
    $('edTitle').value = p.title || '새 프로그램';
    if (ed.sim) ed.sim.halt();
    ed.sim = new PLC.Sim({ rack: p.rack, io: p.io, program: p.program });
    $('edList').value = PLC.formatIL(ed.sim.program);
    $('edIo').value = p.io || '';
    $('edRack').value = p.rack && p.rack.trim() ? p.rack : PLC.DEFAULT_RACK;
    $('edTest').value = p.test || '';
    $('edTestOut').classList.add('hidden');
    if (ed.view) ed.view.destroy();
    ed.view = new PLC.LadderView($('edLadder'), ed.sim, {
      editable: true, toast, zoom: +store.get('app.zoom', 1) || 1, maxCols: 16,
      onEditState: (on, st) => syncEditButtons(on, st),
      onConvert: () => { $('edList').value = PLC.formatIL(ed.sim.program); saveLocal(); },
      onZoom: (z) => { store.set('app.zoom', z.toFixed(2)); showZoom(z); },
      onPick: (dev) => pick(dev)
    });
    showZoom(ed.view.zoom);
    syncEditButtons(false, {});
    if (ed.plant) ed.plant.destroy();
    ed.plant = new PLC.PlantView($('edPlant'), ed.sim, {});
    fitPlant();
    ed.panel.attach(ed.sim, (p.monitor || '').split(/\s+/).filter(Boolean));
    let lastStatus = 0;
    ed.sim.on((type) => {
      if (type === 'tick') {
        ed.view.update();
        ed.plant.update();
        const now = performance.now();
        if (now - lastStatus > 120) { lastStatus = now; updateStatus(); }
      }
      if (type === 'reset' || type === 'program') { ed.view.render(); ed.plant.render(); fitPlant(); updateStatus(); }
      if (type === 'state') updateStatus();
    });
    showErrors();
    buildRackForm();
    ed.sim.run();
    ed.sim.start();
    updateStatus();
  }
  function project() {
    return PLC.buildProject({
      title: $('edTitle').value.trim(), rack: $('edRack').value, io: $('edIo').value,
      program: ed.sim.src.program, test: $('edTest').value, monitor: (ed.panel.watch || []).join(' ')
    });
  }
  function saveLocal() { store.set('project', project()); }

  function showErrors() {
    const errs = [...ed.sim.rack.errors, ...ed.sim.plant.errors, ...ed.sim.program.errors.map((e) => `${e.line}행 ${e.msg}`)];
    msg(errs.length ? '⚠ ' + errs.slice(0, 2).join(' · ') : '', !!errs.length);
  }
  function msg(text, bad) {
    const el = $('edMsg');
    el.textContent = text;
    el.title = text;
    el.className = 'msg' + (bad ? ' bad' : text ? ' ok' : '');
  }
  function toast(m, bad) {
    const t = $('toast');
    t.textContent = m;
    t.classList.remove('hidden');
    t.style.background = bad ? 'var(--danger)' : '';
    clearTimeout(ed._t);
    ed._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  function applyTheme(t) { document.documentElement.dataset.theme = t; store.set('app.theme', t); }
  function showZoom(z) { $('zoomVal').textContent = Math.round(z * 100) + '%'; }

  /** 모니터 중 접점을 누르면 그 디바이스를 강제로 바꾼다 (입력 장비가 있는 입력은 장비가 우선) */
  function pick(dev) {
    const o = PLC.parseOperand(dev);
    if (!o || o.kind !== 'dev' || V.forceDevs.indexOf(o.dev) < 0) return;
    if (!V.isBitOperand(o)) return;
    const cur = ed.sim.read(dev);
    if (ed.sim.write(dev, cur ? 0 : 1)) toast(`${o.text} → ${cur ? 'OFF' : 'ON'}`);
  }

  // ================================================================== 상태 띠 · 모니터 위치
  function updateStatus() {
    const sim = ed.sim;
    if (!sim) return;
    const cpu = sim.cpu;
    const run = cpu.state === 'RUN';
    const st = $('status');
    const rb = st.querySelector('[data-act=run]');
    rb.classList.toggle('on', run);
    rb.classList.toggle('off', !run);
    st.querySelector('[data-f=runtext]').textContent = cpu.state;
    st.querySelector('[data-led=run]').classList.toggle('on', run);
    st.querySelector('[data-led=err]').classList.toggle('on', cpu.state === 'ERROR');
    st.querySelector('[data-f=scan]').textContent = `${cpu.scanCount}스캔 · ${(cpu.timeMs / 1000).toFixed(1)}s · ${sim.scanMs}ms`;
    const err = st.querySelector('[data-f=err]');
    const e = cpu.error ? `${cpu.error.code} ${cpu.error.msg}` : sim.program.errors.length ? `${sim.program.errors[0].line}행 ${sim.program.errors[0].msg}` : '';
    err.textContent = e;
    err.title = e;
  }
  /** 넓은 화면이면 모니터를 오른쪽에, 좁으면 탭 안에 둔다 */
  function placeMonitor() {
    const wide = window.innerWidth >= 1000;
    const host = $('monitorHost');
    const target = wide ? $('side') : document.querySelector('[data-pane="monitor"]');
    if (host.parentElement !== target) target.appendChild(host);
    if (wide && ed.tab === 'monitor') switchTab('ladder');
  }

  // ================================================================== 현장 설비 패널 (아래)
  /** 설비 카드가 스크롤 없이 다 보이도록 패널 크기에 맞춰 축소한다 */
  function fitPlant() {
    const wrap = $('plantWrap'), pv = $('edPlant');
    if (!wrap || !pv) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    // 배율 s 에서 카드를 다시 늘어놓았을 때 높이가 패널에 들어가는지 — 들어가는 가장 큰 s 를 찾는다
    const fits = (s) => { pv.style.width = (W / s).toFixed(1) + 'px'; return pv.scrollHeight * s <= H + 1; };
    let s = 1;
    if (!fits(1)) {
      let lo = 0.3, hi = 1;
      if (!fits(lo)) s = lo;
      else {
        for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
        s = lo;
      }
      fits(s);
    }
    pv.style.transform = s < 1 ? `scale(${s.toFixed(4)})` : '';
    ed.plantScale = s;
  }
  function plantLayout() {
    const app = $('app');
    const saved = +store.get('app.plantH', 0);
    if (saved > 60) app.style.setProperty('--plant-h', saved + 'px');
    if (store.get('app.plantOpen', '1') === '0') app.classList.add('plant-collapsed');
    const grip = $('plantGrip');
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('drag');
      const pane = $('plantPane');
      const h0 = pane.getBoundingClientRect().height, y0 = e.clientY;
      const move = (ev) => {
        const h = Math.max(48, Math.min(window.innerHeight * 0.7, h0 + (y0 - ev.clientY)));
        app.style.setProperty('--plant-h', h + 'px');
        app.classList.remove('plant-collapsed');
        fitPlant();
      };
      const up = () => {
        grip.classList.remove('drag');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        store.set('app.plantH', Math.round(pane.getBoundingClientRect().height));
        store.set('app.plantOpen', '1');
        fitPlant();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitPlant()).observe($('plantWrap'));
    window.addEventListener('resize', () => { placeMonitor(); fitPlant(); });
  }
  function togglePlant() {
    const app = $('app');
    app.classList.toggle('plant-collapsed');
    store.set('app.plantOpen', app.classList.contains('plant-collapsed') ? '0' : '1');
    setTimeout(fitPlant, 50);
  }

  // ================================================================== 모듈 구성 화면
  function rackDef() {
    const r = ed.sim.rack;
    return {
      cpu: r.cpuType, cpuParams: Object.assign({}, r.cpuParams), base: r.base, power: r.power,
      slots: r.slots.map((m) => ({ type: m.type, params: Object.assign({}, m.params) }))
    };
  }
  function defText(d) {
    const ps = (o) => Object.keys(o).filter((k) => o[k] !== '' && o[k] != null).map((k) => `${k}=${o[k]}`).join(' ');
    const cp = ps(d.cpuParams);
    const lines = [`CPU ${d.cpu}${cp ? ' ' + cp : ''}`, `BASE ${d.base}`];
    if (d.power && PLC.CATALOG.POWERS) lines.push(`POWER ${d.power}`);
    d.slots.forEach((s, i) => {
      if (!s || s.type === 'EMPTY') return;
      const p = ps(s.params || {});
      lines.push(`${i} ${s.type}${p ? ' ' + p : ''}`);
    });
    return lines.join('\n');
  }
  function applyDef(d) {
    $('edRack').value = defText(d);
    applyRack();
    buildRackForm();
  }
  const KINDS = [['입력', 'in'], ['출력', 'out'], ['입출력', 'io'], ['A/D 변환', 'ad'], ['D/A 변환', 'da'], ['통신', 'serial']];

  function buildRackForm() {
    const host = $('edRackForm');
    const C = PLC.CATALOG;
    const rack = ed.sim.rack;
    const io = rack.ioTable();
    const opts = (obj, cur, fmt) => Object.keys(obj).map((k) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(fmt ? fmt(k, obj[k]) : k)}</option>`).join('');
    const modOptions = (cur) => {
      let h = `<option value="EMPTY"${cur === 'EMPTY' ? ' selected' : ''}>— 빈 슬롯 —</option>`;
      KINDS.forEach(([label, kind]) => {
        const list = Object.keys(C.MODS).filter((k) => C.MODS[k].kind === kind);
        if (!list.length) return;
        h += `<optgroup label="${label}">` + list.map((k) => `<option value="${k}"${k === cur ? ' selected' : ''}>${k} — ${esc(C.MODS[k].desc)}</option>`).join('') + '</optgroup>';
      });
      return h;
    };
    const used = rack.slots.filter((m) => m.type !== 'EMPTY').length;
    host.innerHTML = `
      <div class="row"><label>CPU</label>
        <select data-r="cpu" style="flex:1;min-width:0">${opts(C.CPUS, rack.cpuType, V.cpuLabel)}</select>
        <button class="ibtn" data-mod="cpu" title="스캔 타임 등 CPU 설정">⚙</button></div>
      <div class="row"><label>베이스</label>
        <select data-r="base" style="flex:1;min-width:0">${opts(C.BASES, rack.base, (k, v) => `${k} — 슬롯 ${v}개`)}</select></div>
      ${C.POWERS ? `<div class="row"><label>전원</label>
        <select data-r="power" style="flex:1;min-width:0">${opts(C.POWERS, rack.power, (k, v) => `${k} — ${v}`)}</select></div>` : ''}
      <div class="desc">모듈 ${used}개 장착 · 빈 슬롯 ${rack.slots.length - used}개 · ${esc(rack.cpuSpec.note || '')}</div>
      <div class="rack-slots">
      ${rack.slots.map((m) => `<div class="slot-row${m.type === 'EMPTY' ? ' empty' : ''}">
        <span class="sn">슬롯 ${m.slot}</span>
        <select data-slot="${m.slot}">${modOptions(m.type)}</select>
        <span class="acts">
          <button class="ibtn" data-act2="set:${m.slot}" title="모듈 설정"${m.type === 'EMPTY' ? ' disabled' : ''}>⚙</button>
          <button class="ibtn" data-act2="up:${m.slot}" title="앞 슬롯과 바꾸기"${m.slot === 0 ? ' disabled' : ''}>▲</button>
          <button class="ibtn" data-act2="down:${m.slot}" title="뒤 슬롯과 바꾸기"${m.slot === rack.slots.length - 1 ? ' disabled' : ''}>▼</button>
          <button class="ibtn" data-act2="del:${m.slot}" title="모듈 빼기"${m.type === 'EMPTY' ? ' disabled' : ''}>✕</button>
        </span>
        <span class="xy">${esc(io[m.slot].xy)}</span>
        <span class="desc info">${esc(slotInfo(m))}</span></div>`).join('')}
      </div>
      <div class="row"><button class="btn small" data-act2="add">＋ 모듈 추가</button>
        <button class="btn small ghost" data-act2="reset">기본 구성으로</button></div>
      <div class="desc">※ 입출력 번호는 슬롯 순서대로 자동으로 정해집니다 (빈 슬롯도 16점 차지). ${V.bufferNote}</div>`;
    host.querySelectorAll('[data-r]').forEach((sel) => {
      sel.onchange = () => {
        const d = rackDef();
        if (sel.dataset.r === 'cpu') d.cpu = sel.value;
        else if (sel.dataset.r === 'power') d.power = sel.value;
        else {
          d.base = sel.value;
          const n = C.BASES[sel.value];
          if (d.slots.length > n) {
            const lost = d.slots.slice(n).filter((s) => s && s.type !== 'EMPTY').length;
            if (lost && !confirm(`슬롯이 줄어들어 모듈 ${lost}개가 빠집니다. 계속할까요?`)) { buildRackForm(); return; }
            d.slots = d.slots.slice(0, n);
          }
        }
        applyDef(d);
      };
    });
    host.querySelectorAll('[data-slot]').forEach((sel) => {
      sel.onchange = () => {
        const d = rackDef();
        const i = +sel.dataset.slot;
        if (d.slots[i].type !== sel.value) d.slots[i] = { type: sel.value, params: {} };
        applyDef(d);
        toast(sel.value === 'EMPTY' ? `슬롯 ${i} 를 비웠습니다` : `슬롯 ${i} 에 ${sel.value} 를 장착했습니다`);
      };
    });
    host.querySelectorAll('[data-act2]').forEach((b) => { b.onclick = () => slotAction(b.dataset.act2); });
    const cpuBtn = host.querySelector('[data-mod=cpu]');
    if (cpuBtn) cpuBtn.onclick = () => cpuSettings();
  }
  function slotInfo(m) {
    if (m.type === 'EMPTY') return '';
    if (m.kind === 'ad' || m.kind === 'da') return `${m.spec.ch}채널 · ${m.kind === 'ad' ? '입력' : '출력'} 범위 ${m.ranges.join(' / ')}`;
    if (m.serial) return `CH1 ${m.bauds[0]}bps ${m.fmts[0]} · CH2 ${m.bauds[1]}bps ${m.fmts[1]} · ${m.unitByte ? '바이트' : '워드'} 단위`;
    if (m.kind === 'in') return `${m.spec.n}점 입력${m.filter ? ` · 응답 ${m.filter}ms` : ''}`;
    if (m.kind === 'out') return `${m.spec.n}점 출력`;
    if (m.kind === 'io') return `입출력 혼합 ${m.spec.n}점`;
    return '';
  }
  function slotAction(a) {
    const [kind, sn] = a.split(':');
    const i = +sn;
    const d = rackDef();
    if (kind === 'add') {
      const free = d.slots.findIndex((s) => !s || s.type === 'EMPTY');
      if (free < 0) { toast('빈 슬롯이 없습니다 — 베이스를 더 큰 것으로 바꾸세요', true); return; }
      pickModule((type) => { d.slots[free] = { type, params: {} }; applyDef(d); toast(`슬롯 ${free} 에 ${type} 를 장착했습니다`); });
      return;
    }
    if (kind === 'reset') {
      if (!confirm(`기본 구성(${V.defaultRackText})으로 되돌릴까요?`)) return;
      $('edRack').value = PLC.DEFAULT_RACK;
      applyRack();
      buildRackForm();
      return;
    }
    if (kind === 'del') { d.slots[i] = { type: 'EMPTY', params: {} }; applyDef(d); toast(`슬롯 ${i} 의 모듈을 뺐습니다`); return; }
    if (kind === 'up' || kind === 'down') {
      const j = kind === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= d.slots.length) return;
      const t = d.slots[i];
      d.slots[i] = d.slots[j];
      d.slots[j] = t;
      applyDef(d);
      toast(`슬롯 ${i} ↔ ${j} 모듈을 바꿨습니다 (입출력 번호가 다시 정해집니다)`);
      return;
    }
    if (kind === 'set') moduleSettings(i);
  }
  function pickModule(then) {
    const C = PLC.CATALOG;
    openModal('＋ 모듈 추가', KINDS.map(([label, kind]) => {
      const list = Object.keys(C.MODS).filter((k) => C.MODS[k].kind === kind);
      return list.length ? `<h3>${label}</h3><div class="sample-list">${list.map((k) => `<button data-pick="${k}"><b>${k}</b><span>${esc(C.MODS[k].desc)} · ${C.MODS[k].pts}점</span></button>`).join('')}</div>` : '';
    }).join(''));
    $('modalBody').onclick = (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      closeModal();
      then(b.dataset.pick);
    };
  }
  function cpuSettings() {
    const r = ed.sim.rack;
    const spec = r.cpuSpec;
    const scan = +(r.cpuParams && r.cpuParams.scan) || ed.sim.scanMs;
    openModal(`⚙ ${spec.model} 설정`, `
      <div class="table-wrap"><table><tbody>${V.cpuRows(spec).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
      <div class="meta-row"><label>스캔 타임(시뮬레이션)
        <select id="setScan">${[1, 2, 5, 10, 20, 50, 100].map((v) => `<option value="${v}"${v === scan ? ' selected' : ''}>${v} ms</option>`).join('')}</select></label></div>
      <p class="muted">스캔 타임은 시뮬레이터가 프로그램을 한 바퀴 도는 데 쓰는 시간입니다. 타이머 · 펄스 동작을 관찰하기 쉽게 정해 줍니다 (기본 10ms).</p>
      <div class="meta-row"><button class="btn primary" id="setOk">적용</button><button class="btn ghost" id="setCancel">취소</button></div>`);
    $('setOk').onclick = () => {
      const d = rackDef();
      d.cpuParams.scan = $('setScan').value;
      closeModal();
      applyDef(d);
      toast(`스캔 타임을 ${d.cpuParams.scan}ms 로 바꿨습니다`);
    };
    $('setCancel').onclick = closeModal;
  }
  function moduleSettings(slot) {
    const C = PLC.CATALOG;
    const m = ed.sim.rack.slots[slot];
    if (!m || m.type === 'EMPTY') return;
    const io = ed.sim.rack.ioTable()[slot];
    let body = `<p class="muted">슬롯 ${slot} · ${m.type} — ${esc(m.spec.desc)} · 입출력 번호 <b>${esc(io.xy)}</b></p>`;
    const sel = (name, list, cur, fmt) => `<select id="${name}">${list.map((v) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(fmt ? fmt(v) : v)}</option>`).join('')}</select>`;
    if (m.kind === 'ad') {
      body += `<div class="table-wrap"><table><thead><tr><th>채널</th><th>변환</th><th>입력 범위</th><th>평균 처리</th><th>시간/횟수</th></tr></thead><tbody>
        ${m.ranges.map((rg, i) => `<tr><td>CH${i + 1}</td>
          <td><input type="checkbox" id="en${i}"${m.chEnable[i] ? ' checked' : ''}></td>
          <td>${sel('rg' + i, Object.keys(C.RANGES), rg)}</td>
          <td>${sel('av' + i, ['s', 't', 'c'], m.avgMode[i].kind, (v) => ({ s: '샘플링', t: '시간 평균', c: '횟수 평균' }[v]))}</td>
          <td><input type="number" id="an${i}" value="${m.avgMode[i].n || (m.avgMode[i].kind === 't' ? 100 : 10)}" min="1" max="5000" style="width:76px"></td></tr>`).join('')}</tbody></table></div>
        <p class="muted">${V.adNote(m)} 평균 처리는 시간 평균(ms) · 횟수 평균(회) 동안 모은 값의 평균을 내보냅니다.</p>`;
    } else if (m.kind === 'da') {
      body += `<div class="table-wrap"><table><thead><tr><th>채널</th><th>변환</th><th>출력 범위</th><th>출력 허가 OFF 일 때</th></tr></thead><tbody>
        ${m.ranges.map((rg, i) => `<tr><td>CH${i + 1}</td>
          <td><input type="checkbox" id="en${i}"${m.chEnable[i] ? ' checked' : ''}></td>
          <td>${sel('rg' + i, Object.keys(C.RANGES), rg)}</td>
          <td>${sel('hd' + i, ['0', '1'], m.holdMode[i] ? '1' : '0', (v) => (v === '1' ? 'HOLD (직전 값 유지)' : 'CLEAR (오프셋 값)'))}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted">${V.daNote(m)}</p>`;
    } else if (m.serial) {
      const bauds = [2400, 4800, 9600, 19200, 38400, 57600, 115200];
      const fmts = ['8N1', '8E1', '8O1', '7E1', '7O1', '8N2'];
      const ends = ['0D0A', '0D', '0A', '03', 'NONE'];
      const endName = { '0D0A': 'CR LF (0D0A)', '0D': 'CR (0D)', '0A': 'LF (0A)', '03': 'ETX (03)', NONE: '없음 (수신 수로 구분)' };
      body += `<div class="table-wrap"><table><thead><tr><th>채널</th><th>인터페이스</th><th>전송 속도</th><th>데이터 형식</th><th>수신 종료 코드</th></tr></thead><tbody>
        ${[0, 1].map((i) => `<tr><td>CH${i + 1}</td><td>${esc(m.spec.ifs[i])}</td>
          <td>${sel('bd' + i, bauds, m.bauds[i])}</td><td>${sel('fm' + i, fmts, m.fmts[i])}</td><td>${sel('ec' + i, ends, m.endCodes[i], (v) => endName[v])}</td></tr>`).join('')}</tbody></table></div>
        <div class="meta-row"><label>송수신 데이터 수 단위 ${sel('unit', ['word', 'byte'], m.unitByte ? 'byte' : 'word', (v) => (v === 'byte' ? '바이트' : '워드'))}</label></div>
        <p class="muted">데이터 형식은 데이터 비트 · 패리티(N 없음 · E 짝수 · O 홀수) · 스톱 비트입니다. ${V.serialNote}</p>`;
    } else if (m.kind === 'in' || m.kind === 'io') {
      body += `<div class="meta-row"><label>입력 응답 시간(필터)
        ${sel('filter', [0, 1, 5, 10, 20, 70], m.filter || 0, (v) => (v === 0 ? '없음 (바로 반영)' : v + ' ms'))}</label></div>
        <p class="muted">채터링이나 노이즈를 걸러 냅니다. 응답 시간보다 짧은 신호는 무시됩니다. 펄스 실습을 할 때는 <b>없음</b> 으로 두세요.</p>
        <div class="table-wrap"><table><tbody><tr><th>점수</th><td>${m.spec.n}점</td></tr><tr><th>배선 방식</th><td>${esc(V.inType(m))}</td></tr></tbody></table></div>`;
    } else {
      body += `<div class="table-wrap"><table><tbody><tr><th>점수</th><td>${m.spec.n}점</td></tr><tr><th>출력 방식</th><td>${esc(V.outType(m))}</td></tr></tbody></table></div>
        <p class="muted">출력 모듈에는 따로 설정할 항목이 없습니다.</p>`;
    }
    body += `<div class="meta-row"><button class="btn primary" id="setOk">적용</button><button class="btn ghost" id="setCancel">취소</button></div>`;
    openModal(`⚙ 슬롯 ${slot} · ${m.type} 설정`, body);
    $('setCancel').onclick = closeModal;
    $('setOk').onclick = () => {
      const d = rackDef();
      const p = d.slots[slot].params = {};
      if (m.kind === 'ad') {
        p.range = m.ranges.map((_, i) => $('rg' + i).value).join(',');
        p.en = m.ranges.map((_, i) => ($('en' + i).checked ? 1 : 0)).join(',');
        p.avg = m.ranges.map((_, i) => { const k = $('av' + i).value; return k === 's' ? 's' : k + (+$('an' + i).value || (k === 't' ? 100 : 10)); }).join(',');
      } else if (m.kind === 'da') {
        p.range = m.ranges.map((_, i) => $('rg' + i).value).join(',');
        p.en = m.ranges.map((_, i) => ($('en' + i).checked ? 1 : 0)).join(',');
        p.hold = m.ranges.map((_, i) => $('hd' + i).value).join(',');
      } else if (m.serial) {
        p.baud = [0, 1].map((i) => $('bd' + i).value).join(',');
        p.fmt = [0, 1].map((i) => $('fm' + i).value).join(',');
        p.end = [0, 1].map((i) => $('ec' + i).value).join(',');
        p.unit = $('unit').value;
      } else if (m.kind === 'in' || m.kind === 'io') {
        const f = +$('filter').value;
        if (f) p.filter = f;
      }
      closeModal();
      applyDef(d);
      toast(`슬롯 ${slot} ${m.type} 설정을 적용했습니다`);
    };
  }
  function applyRack() { reopen({ rack: $('edRack').value }); }
  /** 구성 · 설비를 바꾸면 시뮬레이터를 다시 만든다 (프로그램은 유지) */
  function reopen(over) {
    const p = {
      title: $('edTitle').value, rack: $('edRack').value, io: $('edIo').value,
      program: ed.sim.src.program, test: $('edTest').value, monitor: (ed.panel.watch || []).join(' ')
    };
    Object.assign(p, over || {});
    open(PLC.buildProject(p));
    saveLocal();
  }

  // ================================================================== 검사
  function runTest() {
    const sim = new PLC.Sim({ rack: $('edRack').value, io: $('edIo').value, program: ed.sim.src.program });
    const res = sim.runTests($('edTest').value);
    const out = $('edTestOut');
    const bad = res.filter((r) => !r.ok).length;
    out.classList.remove('hidden');
    out.innerHTML = `<b>${bad ? `❌ ${bad}개 항목이 맞지 않습니다` : res.length ? `✅ ${res.length}개 항목 모두 통과` : '검사식이 없습니다'}</b>
      <ul>${res.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔' : '✘'} ${esc(r.text)}${r.check ? ' → ' + esc(r.check) : ''}${r.msg ? ' — ' + esc(r.msg) : ''}</li>`).join('')}</ul>`;
    msg(bad ? `검사 ${bad}개 실패` : res.length ? '검사 통과' : '', !!bad);
  }

  // ================================================================== 파일 · 예제 · 공유
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function ilCsv() {
    const rows = [['Step No.', 'Instruction', 'I/O(Device)', 'Blank', 'Note']];
    let step = 0;
    ed.sim.program.steps.forEach((s) => {
      if (s.auto && s.op === 'END') return;
      rows.push([step, s.name, s.operands.map((o) => o.text).join(' '), '', s.note || '']);
      step += PLC.stepCount(s);
    });
    rows.push([step, 'END', '', '', '']);
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }
  function fileName() { return ($('edTitle').value.trim() || 'program').replace(/[\\/:*?"<>|]/g, '_'); }
  async function shareOrCopy(title, text, isFile) {
    if (navigator.share) {
      try {
        if (isFile && navigator.canShare && navigator.canShare({ files: [new File([text], fileName() + '.plc', { type: 'text/plain' })] })) {
          await navigator.share({ title, files: [new File([text], fileName() + '.plc', { type: 'text/plain' })] });
        } else await navigator.share(isFile ? { title, text } : { title, url: text });
        return true;
      } catch (e) { if (e && e.name === 'AbortError') return true; }
    }
    try { await navigator.clipboard.writeText(text); toast(isFile ? '프로젝트 내용을 복사했습니다' : '공유 링크를 복사했습니다'); return true; }
    catch (e) { prompt(isFile ? '프로젝트' : '링크', text); return false; }
  }
  function exportDialog() {
    openModal('⬇ 내보내기', `<div class="meta-row">
      <button class="btn primary" data-dl="plc">📦 프로젝트 (.plc)</button>
      <button class="btn" data-dl="il">📝 명령어 리스트 (.txt)</button>
      <button class="btn" data-dl="csv">📊 ${esc(V.csvName)}</button>
      <button class="btn ghost" data-dl="copy">📋 리스트 복사</button>
      ${navigator.share ? '<button class="btn ghost" data-dl="share">📤 다른 앱으로 보내기</button>' : ''}</div>
      <p class="muted">프로젝트 파일에는 모듈 구성 · 현장 설비 · 프로그램 · 검사식이 모두 들어 있습니다.<br>
      ${esc(V.tool)} 로 옮길 때는 <b>리스트</b> 내용을 리스트(니모닉) 편집 화면에 붙여 넣는 방법이 가장 확실합니다.</p>`);
    $('modalBody').onclick = (e) => {
      const b = e.target.closest('[data-dl]');
      if (!b) return;
      const name = fileName();
      if (b.dataset.dl === 'plc') download(name + '.plc', project());
      if (b.dataset.dl === 'il') download(name + '.txt', PLC.formatIL(ed.sim.program));
      if (b.dataset.dl === 'csv') download(name + '.csv', '﻿' + ilCsv());
      if (b.dataset.dl === 'copy') { navigator.clipboard.writeText(PLC.formatIL(ed.sim.program)).then(() => toast('명령어 리스트를 복사했습니다'), () => prompt('리스트', PLC.formatIL(ed.sim.program))); }
      if (b.dataset.dl === 'share') shareOrCopy($('edTitle').value, project(), true);
      closeModal();
    };
  }
  function openDialog() {
    openModal('📂 불러오기', `<div class="meta-row">
      <button class="btn primary" data-op="local">💾 브라우저에 저장한 프로그램</button>
      <button class="btn" data-op="file">📄 파일 열기 (.plc · .txt)</button></div>
      <p class="muted">파일은 이 앱이나 강좌 사이트의 PLC 에디터에서 내보낸 프로젝트(.plc) 또는 명령어 리스트(.txt)입니다.</p>`);
    $('modalBody').onclick = (e) => {
      const b = e.target.closest('[data-op]');
      if (!b) return;
      closeModal();
      if (b.dataset.op === 'local') { open(store.get('project', DEFAULT_PROJECT)); toast('저장한 내용을 불러왔습니다'); }
      else $('edFile').click();
    };
  }
  /** 예제: 기본 예제 + 강좌 실습 (챕터별) · 검색 */
  function samples() {
    const base = PLC.SAMPLES || [];
    const ex = PLC.EXAMPLES || [];
    const chaps = [];
    const byCh = {};
    ex.forEach((x, i) => {
      if (!byCh[x.ch]) { byCh[x.ch] = { no: x.ch, title: x.chTitle, icon: x.icon, items: [] }; chaps.push(byCh[x.ch]); }
      byCh[x.ch].items.push({ i, x });
    });
    openModal('📚 예제', `<input class="search" id="exSearch" type="search" placeholder="예제 찾기 (제목 · 설명 · 챕터)" autocomplete="off">
      <h3>기본 예제</h3><div class="sample-list" data-grp="base">${base.map((s, i) => `<button data-s="${i}" data-txt="${esc((s.title + ' ' + (s.desc || '')).toLowerCase())}"><b>${esc(s.title)}</b><span>${esc(s.desc || '')}</span></button>`).join('')}</div>
      <h3>강좌 실습 (${ex.length}개)</h3>
      ${chaps.map((c) => `<details class="chap"><summary><span class="n">${esc(c.no)}</span>${esc(c.icon)} ${esc(c.title)}<span class="cnt">${c.items.length}</span></summary>
        <div class="sample-list">${c.items.map(({ i, x }) => `<button data-ex="${i}" data-txt="${esc((x.title + ' ' + x.desc + ' ' + x.secTitle + ' ' + c.title).toLowerCase())}"><b>${esc(x.title)}</b><span>${esc(x.secTitle)}${x.desc ? ' — ' + esc(x.desc.slice(0, 80)) : ''}</span></button>`).join('')}</div></details>`).join('')}`);
    const body = $('modalBody');
    body.onclick = (e) => {
      const b = e.target.closest('[data-s],[data-ex]');
      if (!b) return;
      closeModal();
      if (b.dataset.s != null) open(base[+b.dataset.s].project);
      else {
        const x = ex[+b.dataset.ex];
        open(PLC.buildProject({ title: x.title, rack: x.rack, io: x.io, program: x.program, test: x.test, monitor: x.monitor }));
      }
      saveLocal();
      switchTab('ladder');
    };
    const search = $('exSearch');
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      body.querySelectorAll('[data-txt]').forEach((b) => { b.classList.toggle('hidden', !!q && b.dataset.txt.indexOf(q) < 0); });
      body.querySelectorAll('details.chap').forEach((d) => {
        const n = [...d.querySelectorAll('[data-txt]')].filter((b) => !b.classList.contains('hidden')).length;
        d.classList.toggle('hidden', !n);
        if (q) d.open = true;
      });
    };
  }
  function vendorDialog() {
    const list = [
      { id: 'melsec', icon: '🟥', name: '미쓰비시 MELSEC Q', desc: 'Q03UDECPU · QX41 · QY41P · Q64AD · Q62DAN · QJ71C24N — GX Works2 식 표기 (LD · OUT · K/H 상수)' },
      { id: 'xgk', icon: '🟩', name: 'LS ELECTRIC XGK', desc: 'XGK-CPUE · XGI-D24A · XGQ-TR4A · XGF-AV8A · XGF-DV4A · XGL-C22A — XG5000 식 표기 (LOAD · P00000 · TON)' }
    ];
    openModal('PLC 기종 (제조사)', `<div class="vendor-list">${list.map((v) => `<button data-v="${v.id}" class="${v.id === V.id ? 'cur' : ''}"><span class="ic">${v.icon}</span><div><b>${esc(v.name)}</b><span>${esc(v.desc)}</span></div></button>`).join('')}</div>
      <p class="muted">기종을 바꾸면 디바이스 · 명령어 · 모듈 카탈로그가 모두 바뀝니다. 지금 프로그램은 현재 기종에 저장되어 있다가 다시 돌아오면 그대로 열립니다.</p>`);
    $('modalBody').onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      if (b.dataset.v === V.id) { closeModal(); return; }
      saveLocal();
      try { localStorage.setItem('plcapp.vendor', b.dataset.v); } catch (err) { /* 무시 */ }
      location.href = location.pathname + '?v=' + b.dataset.v;
    };
  }
  function help(which) {
    if (which === 'io') {
      const rows = Object.keys(PLC.PLANT_TYPES).map((k) => {
        const t = PLC.PLANT_TYPES[k];
        return `<tr><td><b>${k}</b><br><span class="muted">${esc(t.name)}</span></td><td>${t.help.split('\n').map((x) => `<code>${esc(x.trim())}</code>`).join('<br>')}</td></tr>`;
      }).join('');
      openModal('🔌 현장 장비 목록', `<p class="muted">[설비] 화면에 한 줄에 하나씩 적습니다. 이름은 검사식과 조작판에 쓰이고, label= 은 화면 표시 이름입니다. 같은 입력에 여러 장비를 달면 OR 로 합쳐집니다.</p>
        <div class="table-wrap"><table><thead><tr><th>종류</th><th>쓰는 법</th></tr></thead><tbody>${rows}</tbody></table></div>`);
      return;
    }
    if (which === 'bridge') {
      openModal(`🔌 ${esc(V.bridge.title)}`, `<p>브라우저는 PLC 와 직접 통신할 수 없어, PC 에서 브리지를 실행합니다 (강좌 저장소의 <code>bridge/plcbridge.py</code>).</p>
        <ul><li>${V.bridge.note}</li>
        <li><b>모니터</b>: 실제 PLC 의 디바이스를 읽어 이 화면에 표시</li>
        <li><b>가상 설비 연동</b>: 화면의 센서 상태를 실제 PLC 로 쓰고, 실제 출력으로 화면 설비를 움직임</li></ul>
        <p class="muted">스마트폰에서는 같은 네트워크의 PC 에서 브리지를 띄우고, 브리지 주소를 그 PC 의 IP 로 적습니다.</p>`);
      return;
    }
    openModal('❓ 사용 방법', `<h3>래더 편집 (터치)</h3>
      <ul><li><b>✎</b> 를 누르면 편집 모드. 칸을 <b>탭</b>해서 고르고, 도구 모음의 <b>┤├ ┤/├ ( ) [ ]</b> 를 누르면 입력창이 열립니다.</li>
      <li>같은 칸을 <b>다시 탭</b>하면 그 칸의 접점 · 코일을 고칩니다. <b>🗑</b> 지우기 · <b>+≡ −≡</b> 행 삽입 · 삭제.</li>
      <li><b>┤├↓</b> 는 위 행과 세로선으로 이어지는 병렬(OR) 접점, <b>│</b> 는 아래 행과 잇는 세로선입니다.</li>
      <li>다 고쳤으면 <b>✔ ${esc(V.convertName)}</b> — 회로를 명령어로 바꾸고 바로 실행합니다. 오른쪽 칸이 모자라면 열이 자동으로 늘어납니다.</li>
      <li><b>손가락 두 개</b>로 벌리면 확대, 한 손가락으로 끌면 이동, <b>⤢</b> 로 화면 폭에 맞춥니다. (PC: Ctrl+휠)</li>
      <li>모니터 모드에서 접점 · 코일을 탭하면 그 디바이스를 강제로 ON/OFF 합니다 (설비가 달린 입력은 설비가 우선).</li></ul>
      <h3>키보드 (${esc(V.tool)} 단축키)</h3>
      <div class="table-wrap"><table><tbody>${V.helpKeys.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('')}
        <tr><td><kbd>Enter</kbd></td><td>고른 칸 고치기</td></tr><tr><td><kbd>Del</kbd> / <kbd>Insert</kbd></td><td>지우기 / 행 삽입</td></tr>
        <tr><td><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd></td><td>되돌리기 / 다시 실행</td></tr></tbody></table></div>
      <p>비교 접점은 <code>${esc(V.hints.contact.split('·').pop().trim())}</code> 처럼, 펄스 접점은 <code>${esc(V.ld)}P ${esc(V.ioExample.split(' ')[2])}</code> 처럼 입력합니다.</p>
      <h3>화면</h3>
      <ul><li><b>🪜 래더</b> 편집 · 모니터 (통전된 선은 초록) · <b>📝 리스트</b> 명령어 직접 편집</li>
      <li><b>🔌 설비</b> 버튼 · 램프 · 실린더 · 모터 · 컨베이어 · 탱크 · 센서를 한 줄씩 적어 배치 (장비 목록 참고)</li>
      <li><b>🗄 모듈</b> CPU · 베이스 · 입출력 · A/D · D/A · 통신 모듈을 슬롯에 넣고 빼고 ⚙ 설정</li>
      <li><b>✔ 검사</b> 검사식으로 동작 자동 확인 · <b>🔍 모니터</b> 모듈 LED · 디바이스 현재값 · 아날로그 · 통신 로그 · 실제 PLC 연동</li>
      <li>아래 <b>현장 설비</b>는 스크롤 없이 모두 보이도록 자동으로 줄어듭니다. 손잡이를 끌어 높이를 바꾸고, 🔌 로 접습니다.</li>
      <li>위 <b>${esc(V.icon)} ${esc(V.name)}</b> 를 누르면 기종(MELSEC Q ↔ LS XGK)을 바꿉니다. 홈 화면에 추가하면 앱처럼 오프라인에서도 열립니다.</li></ul>`);
  }

  function openModal(title, html) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modalBody').onclick = null;
    $('modalBody').scrollTop = 0;
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  /** 공유 링크: 프로젝트를 주소에 담는다 */
  function encodeProject(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeProject(s) {
    try {
      const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (e) { return null; }
  }
  function shareLink() {
    const url = location.origin + location.pathname + '?v=' + V.id + '#p=' + encodeProject(project());
    shareOrCopy($('edTitle').value, url, false);
  }

  // ================================================================== 이벤트
  function bind() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a) {
        switch (a.dataset.act) {
          case 'new': if (confirm('새 프로그램을 시작할까요? 저장하지 않은 내용은 사라집니다.')) { open(DEFAULT_PROJECT); saveLocal(); switchTab('ladder'); } break;
          case 'samples': samples(); break;
          case 'save': saveLocal(); toast('브라우저에 저장했습니다'); break;
          case 'open': openDialog(); break;
          case 'export': exportDialog(); break;
          case 'share': closeModal(); shareLink(); break;
          case 'help': help(); break;
          case 'more': openModal('⋯ 더 보기', '<div class="more-list"><button class="btn" data-act="export">⬇ 내보내기</button><button class="btn" data-act="share">🔗 공유 링크</button><button class="btn" data-act="help">❓ 도움말</button><button class="btn" data-act="theme">◐ 라이트 / 다크</button><button class="btn" data-act="vendor">🔁 PLC 기종 바꾸기</button><button class="btn" data-act="plant">🔌 설비 패널 접기/펴기</button></div>'); break;
          case 'vendor': vendorDialog(); break;
          case 'theme': closeModal(); applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break;
          case 'run': if (ed.sim.cpu.state === 'RUN') ed.sim.stop(); else { ed.sim.run(); if (ed.sim.cpu.state !== 'RUN') toast('RUN 할 수 없습니다 — 프로그램 오류를 고치세요', true); } updateStatus(); break;
          case 'reset': ed.sim.reset(); ed.sim.run(); updateStatus(); toast('리셋했습니다'); break;
          case 'step': ed.sim.stop(); ed.sim.step(1); ed.view.update(); ed.plant.update(); updateStatus(); break;
          case 'plant': closeModal(); togglePlant(); break;
        }
        return;
      }
      const t = e.target.closest('[data-tool]');
      if (t) { tool(t.dataset.tool); return; }
      const tab = e.target.closest('.tab');
      if (tab) switchTab(tab.dataset.tab);
      if (e.target.id === 'modalClose' || e.target.id === 'modal' || e.target.closest('#modalClose')) closeModal();
      if (e.target.id === 'vendorBtn') vendorDialog();
    });
    const sp = document.querySelector('[data-act=speed]');
    sp.onchange = () => { ed.sim.speed = +sp.value; };
    $('edFile').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { open(String(rd.result)); saveLocal(); toast(f.name + ' 을(를) 열었습니다'); switchTab('ladder'); };
      rd.readAsText(f, 'utf-8');
      e.target.value = '';
    };
    $('edTitle').onchange = saveLocal;
    $('edTitle').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
    document.addEventListener('keydown', (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape') { closeModal(); if (ed.view) ed.view.closeAsk(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveLocal(); toast('저장했습니다'); return; }
      if (inField || !ed.view || ed.tab !== 'ladder') return;
      if (ed.view.editing) ed.view.onKey(e);
      else { const m = V.keymap(e); if (m && m.act === 'convert') e.preventDefault(); }
    });
    window.addEventListener('beforeunload', saveLocal);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveLocal(); });
  }
  /** 편집 도구 모음의 상태 표시 */
  function syncEditButtons(on, st) {
    st = st || {};
    const q = (n) => document.querySelector(`[data-tool="${n}"]`);
    const eb = q('edit');
    if (eb) { eb.classList.toggle('on', !!on); eb.title = on ? '편집 끝내기 (변환되지 않은 내용은 ' + V.convertName + ' 후 반영)' : '편집 모드 켜기 — 회로를 고칠 수 있습니다'; }
    const cb = q('convert');
    if (cb) { cb.disabled = !on; cb.classList.toggle('dirty', !!(on && st.dirty)); }
    const mode = document.querySelector('[data-f=ldmode]');
    if (mode) {
      mode.className = 'mode ' + (on ? (st.dirty ? 'dirty' : 'edit') : 'mon');
      mode.textContent = on ? (st.dirty ? V.convertName + ' 필요' : '편집') : '모니터';
    }
    [['undo', st.undo], ['redo', st.redo], ['paste', st.clip]].forEach(([n, ok]) => { const b = q(n); if (b) b.disabled = !on || !ok; });
    ['copy', 'cut', 'edit-cell', 'del', 'insRow', 'delRow'].forEach((n) => { const b = q(n); if (b) b.disabled = !on; });
  }

  function tool(name) {
    const v = ed.view;
    switch (name) {
      case 'edit':
        if (v.editing && v.dirty && !confirm(`${V.convertName}하지 않은 편집이 있습니다. ${V.convertName}하지 않고 편집을 끝낼까요?`)) return;
        v.setEditing(!v.editing);
        return;
      case 'convert': v.convert(); return;
      case 'undo': v.undo(); return;
      case 'redo': v.redo(); return;
      case 'cut': v.copy(true); return;
      case 'copy': v.copy(false); return;
      case 'paste': v.paste(); return;
      case 'edit-cell': v.dblEdit(); return;
      case 'zoomIn': v.zoomBy(1.25); return;
      case 'zoomOut': v.zoomBy(1 / 1.25); return;
      case 'zoomFit': v.zoomFit(); return;
      case 'applyList': {
        const p = PLC.parseProgram($('edList').value);
        if (p.errors.length) { msg(`⚠ ${p.errors[0].line}행: ${p.errors[0].msg}`, true); toast(`${p.errors[0].line}행: ${p.errors[0].msg}`, true); return; }
        ed.sim.loadProgram($('edList').value);
        if (v.editing) v.setEditing(false);
        msg('프로그램을 반영했습니다');
        saveLocal();
        switchTab('ladder');
        return;
      }
      case 'applyIo': reopen({ io: $('edIo').value }); toast('설비를 적용했습니다'); return;
      case 'applyRack': applyRack(); buildRackForm(); toast('모듈 구성을 적용했습니다'); return;
      case 'rackText': $('edRack').classList.toggle('hidden'); return;
      case 'ioHelp': help('io'); return;
      case 'runTest': runTest(); return;
      default: break;
    }
    if (!v.editing) v.setEditing(true);
    switch (name) {
      case 'NO': case 'NC': case 'OR': case 'ORNC': case 'P': case 'F': v.ask('', name); break;
      case 'coil': v.cur = { r: v.cur.r, c: 'out' }; v.drawCursor(); v.ask('OUT '); break;
      case 'app': v.cur = { r: v.cur.r, c: 'out' }; v.drawCursor(); v.ask('MOV '); break;
      case 'H': v.put('H'); break;
      case 'V': v.put('V'); break;
      case 'del': v.put('del'); break;
      case 'insRow': v.put('insRow'); break;
      case 'delRow': v.put('delRow'); break;
    }
  }
  function switchTab(name) {
    ed.tab = name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
    if (name === 'list') $('edList').value = PLC.formatIL(ed.sim.program);
    if (name === 'rack') buildRackForm();
    if (name === 'ladder' && ed.view) { ed.view.applyZoom(); ed.view.render(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
