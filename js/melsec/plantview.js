/* 현장 설비 조작판 — 장비를 그리고 마우스로 조작한다 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLOR = { green: '#22c55e', red: '#ef4444', yellow: '#facc15', blue: '#3b82f6', white: '#f1f5f9', orange: '#fb923c', black: '#334155' };
  const col = (d, def) => COLOR[d.p.color] || def || COLOR.green;
  const svg = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;

  /* 장비별 그림: html(d) 최초 그리기 · up(d, el) 매 프레임 갱신 */
  const V = {};
  const pressable = ' class="pv-btn" data-press="1"';
  const toggleable = ' class="pv-btn" data-toggle="1"';

  V.PB = {
    html(d) {
      const c = col(d, '#22c55e');
      return svg(52, 40, `<rect x="6" y="20" width="40" height="14" rx="3" fill="#475569"/>
        <g${pressable}><rect class="cap" x="10" y="6" width="32" height="18" rx="6" fill="${c}" stroke="#1e293b" stroke-width="1.5"/></g>`);
    },
    up(d, el) { const c = el.querySelector('.cap'); if (c) c.setAttribute('y', d.on ? 11 : 6); }
  };
  V.LS = {
    html() {
      return svg(52, 40, `<rect x="4" y="24" width="44" height="12" rx="2" fill="#64748b"/>
        <g${pressable}><line class="lever" x1="10" y1="24" x2="42" y2="8" stroke="#334155" stroke-width="3" stroke-linecap="round"/><circle cx="42" cy="8" r="5" fill="#f59e0b"/></g>`);
    },
    up(d, el) { const l = el.querySelector('.lever'); if (l) { l.setAttribute('y2', d.on ? 20 : 8); el.querySelector('circle').setAttribute('cy', d.on ? 20 : 8); } }
  };
  V.SEL = {
    html() {
      return svg(52, 40, `<circle cx="26" cy="22" r="15" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>
        <g${toggleable}><line class="knob" x1="26" y1="22" x2="16" y2="12" stroke="#1e293b" stroke-width="4" stroke-linecap="round"/><circle cx="26" cy="22" r="15" fill="transparent"/></g>`);
    },
    up(d, el) {
      const k = el.querySelector('.knob');
      if (!k) return;
      k.setAttribute('x2', d.on ? 36 : 16);
      k.setAttribute('y2', 12);
    }
  };
  V.TGL = {
    html() {
      return svg(52, 40, `<rect x="12" y="8" width="28" height="26" rx="6" fill="#cbd5e1" stroke="#475569" stroke-width="1.5"/>
        <g${toggleable}><rect class="lev" x="16" y="12" width="20" height="9" rx="4" fill="#334155"/><rect x="12" y="8" width="28" height="26" fill="transparent"/></g>`);
    },
    up(d, el) { const l = el.querySelector('.lev'); if (l) l.setAttribute('y', d.on ? 21 : 12); }
  };
  V.EMG = {
    html() {
      return svg(52, 40, `<circle cx="26" cy="22" r="17" fill="#fbbf24" stroke="#b45309" stroke-width="2"/>
        <g${toggleable}><circle class="cap" cx="26" cy="22" r="12" fill="#dc2626" stroke="#7f1d1d" stroke-width="2"/></g>`);
    },
    up(d, el) { const c = el.querySelector('.cap'); if (c) c.setAttribute('r', d.on ? 9 : 12); }
  };
  V.PROX = {
    html(d) {
      return svg(58, 40, `<rect x="4" y="14" width="22" height="16" rx="3" fill="#64748b"/><circle cx="26" cy="22" r="6" fill="#94a3b8"/>
        <g${toggleable}><rect class="obj" x="36" y="10" width="16" height="22" rx="2" fill="${d.type === 'PHOTO' ? '#f59e0b' : '#38bdf8'}" opacity=".25"/></g>`);
    },
    up(d, el) { const o = el.querySelector('.obj'); if (o) o.setAttribute('opacity', d.on ? '1' : '.22'); }
  };
  V.PHOTO = V.PROX;
  V.DSW = {
    html(d) {
      return `<div style="display:flex;align-items:center;gap:4px">
        <button class="btn small ghost" data-act="dec">−</button>
        <span class="pv-val" data-f="val" style="min-width:34px;text-align:center"></span>
        <button class="btn small ghost" data-act="inc">+</button></div>`;
    },
    up(d, el) { const v = el.querySelector('[data-f=val]'); if (v) v.textContent = String(d.val).padStart(d.digits, '0'); },
    act(d, a, plant) { plant.set(d.name, d.val + (a === 'inc' ? 1 : -1) + Math.pow(10, d.digits)); }
  };
  V.LAMP = {
    html(d) {
      const c = col(d, '#22c55e');
      return svg(46, 40, `<circle cx="23" cy="20" r="15" fill="#1e293b" opacity=".25"/>
        <circle class="bulb" cx="23" cy="20" r="13" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="2"/>`);
    },
    up(d, el) {
      const b = el.querySelector('.bulb');
      if (!b) return;
      b.setAttribute('fill-opacity', d.on ? '1' : '.18');
      b.style.filter = d.on ? 'drop-shadow(0 0 7px currentColor)' : 'none';
      b.style.color = b.getAttribute('stroke');
    }
  };
  V.BUZ = {
    html() { return svg(46, 40, `<path d="M12 14 L20 14 L28 7 L28 33 L20 26 L12 26 Z" fill="#475569"/><g class="wv" opacity=".2"><path d="M32 13 A 10 10 0 0 1 32 27" fill="none" stroke="#f59e0b" stroke-width="2.4"/><path d="M36 9 A 16 16 0 0 1 36 31" fill="none" stroke="#f59e0b" stroke-width="2.4"/></g>`); },
    up(d, el) { const w = el.querySelector('.wv'); if (w) w.setAttribute('opacity', d.on ? '1' : '.15'); }
  };
  V.SOL = {
    html() {
      return svg(64, 42, `<rect x="4" y="12" width="26" height="20" fill="#e2e8f0" stroke="#475569" stroke-width="1.5"/>
        <rect x="30" y="12" width="26" height="20" fill="#e2e8f0" stroke="#475569" stroke-width="1.5"/>
        <path class="p1" d="M8 28 L26 16 M8 16 L26 28" stroke="#64748b" stroke-width="1.6"/>
        <path class="p2" d="M34 22 L52 22" stroke="#64748b" stroke-width="1.6"/>
        <rect class="coil" x="4" y="4" width="10" height="7" fill="#94a3b8"/>`);
    },
    up(d, el) {
      const c = el.querySelector('.coil');
      if (c) c.setAttribute('fill', d.on ? '#22c55e' : '#94a3b8');
      const p1 = el.querySelector('.p1'), p2 = el.querySelector('.p2');
      if (p1) p1.setAttribute('stroke', d.on ? '#94a3b8' : '#1e293b');
      if (p2) p2.setAttribute('stroke', d.on ? '#1e293b' : '#94a3b8');
    }
  };
  V.MC = {
    html() {
      return `${svg(56, 44, `<rect x="6" y="6" width="44" height="32" rx="4" fill="#e2e8f0" stroke="#475569" stroke-width="1.8"/>
        <line class="c1" x1="14" y1="14" x2="14" y2="30" stroke="#64748b" stroke-width="2.5"/>
        <line class="c2" x1="28" y1="14" x2="28" y2="30" stroke="#64748b" stroke-width="2.5"/>
        <line class="c3" x1="42" y1="14" x2="42" y2="30" stroke="#64748b" stroke-width="2.5"/>`)}
        <button class="btn small ghost" data-act="trip" title="과부하 계전기를 트립 · 복귀시킵니다">THR</button>`;
    },
    up(d, el) {
      ['c1', 'c2', 'c3'].forEach((k) => {
        const l = el.querySelector('.' + k);
        if (l) { l.setAttribute('stroke', d.on ? '#22c55e' : '#64748b'); l.setAttribute('transform', d.on ? '' : 'rotate(-18 ' + l.getAttribute('x1') + ' 14)'); }
      });
      const b = el.querySelector('[data-act=trip]');
      if (b) { b.classList.toggle('on', !!d.trip); b.textContent = d.trip ? 'TRIP' : 'THR'; }
    },
    act(d, a, plant) { plant.set(d.name, d.trip ? 0 : 1); }
  };
  const SEG = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];
  function segDigit(x, pat) {
    const S = [[4, 2, 14, 2], [16, 4, 16, 14], [16, 18, 16, 28], [4, 30, 14, 30], [2, 18, 2, 28], [2, 4, 2, 14], [4, 16, 14, 16]];
    return S.map((s, i) => `<line class="sg s${i}" x1="${x + s[0]}" y1="${s[1]}" x2="${x + s[2]}" y2="${s[3]}" stroke="${(pat >> i) & 1 ? '#ff3b30' : '#3a1717'}" stroke-width="4" stroke-linecap="round"/>`).join('');
  }
  V.SEG7 = {
    html(d) {
      const n = d.p.mode === 'seg' ? 1 : d.digits;
      return svg(n * 24 + 8, 36, `<rect x="0" y="0" width="${n * 24 + 8}" height="36" rx="4" fill="#1a0f0f"/>` + new Array(n).fill(0).map((_, i) => `<g data-dg="${i}">${segDigit(6 + i * 24, 0)}</g>`).join(''));
    },
    up(d, el) {
      const n = d.p.mode === 'seg' ? 1 : d.digits;
      for (let i = 0; i < n; i++) {
        const g = el.querySelector(`[data-dg="${i}"]`);
        if (!g) continue;
        const v = d.p.mode === 'seg' ? d.segs : d.vals[n - 1 - i];
        const pat = d.p.mode === 'seg' ? v : (v <= 9 ? SEG[v] : 0x40);
        g.querySelectorAll('.sg').forEach((s, k) => s.setAttribute('stroke', (pat >> k) & 1 ? '#ff3b30' : '#3a1717'));
      }
    }
  };
  V.CYL = {
    wide: false,
    html() {
      return svg(150, 42, `<rect x="4" y="10" width="76" height="22" rx="3" fill="#cbd5e1" stroke="#475569" stroke-width="1.5"/>
        <rect class="rod" x="78" y="17" width="40" height="8" fill="#94a3b8"/>
        <rect class="pis" x="112" y="6" width="12" height="30" rx="2" fill="#64748b"/>
        <circle class="s-ret" cx="16" cy="36" r="4" fill="#334155"/><circle class="s-ext" cx="74" cy="36" r="4" fill="#334155"/>
        <text x="16" y="8" font-size="8" text-anchor="middle" fill="#64748b">후진</text><text x="74" y="8" font-size="8" text-anchor="middle" fill="#64748b">전진</text>`);
    },
    up(d, el) {
      const p = d.pos;
      const rod = el.querySelector('.rod'), pis = el.querySelector('.pis');
      if (rod) { rod.setAttribute('width', 18 + p * 40); pis.setAttribute('x', 92 + p * 40); }
      const se = el.querySelector('.s-ext'), sr = el.querySelector('.s-ret');
      if (se) se.setAttribute('fill', p >= 0.98 ? '#22c55e' : '#334155');
      if (sr) sr.setAttribute('fill', p <= 0.02 ? '#22c55e' : '#334155');
    }
  };
  V.MOTOR = {
    html() {
      return svg(64, 46, `<circle cx="30" cy="22" r="17" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>
        <g class="rot"><line x1="30" y1="22" x2="30" y2="8" stroke="#1e293b" stroke-width="3"/><line x1="30" y1="22" x2="42" y2="29" stroke="#1e293b" stroke-width="3"/><line x1="30" y1="22" x2="18" y2="29" stroke="#1e293b" stroke-width="3"/></g>
        <circle cx="30" cy="22" r="3.5" fill="#334155"/>
        <text class="rpm" x="30" y="44" font-size="9" text-anchor="middle" fill="#64748b">0 rpm</text>`);
    },
    up(d, el) {
      const g = el.querySelector('.rot');
      if (g) g.setAttribute('transform', `rotate(${d.angle.toFixed(0)} 30 22)`);
      const t = el.querySelector('.rpm');
      if (t) t.textContent = `${d.rpm} rpm`;
    }
  };
  V.CONV = {
    wide: true,
    html(d) {
      const W = 300;
      const sens = (d.sens || []).map((s, i) => `<g><line x1="${10 + s.at * (W - 20)}" y1="6" x2="${10 + s.at * (W - 20)}" y2="20" stroke="#0ea5e9" stroke-width="2"/><text x="${10 + s.at * (W - 20)}" y="5" font-size="8" text-anchor="middle" fill="#0284c7">${esc(s.a.text)}</text></g>`).join('')
        + (d.senA || []).map((s) => `<g><line x1="${10 + s.at * (W - 20)}" y1="6" x2="${10 + s.at * (W - 20)}" y2="20" stroke="#a855f7" stroke-width="2"/><text x="${10 + s.at * (W - 20)}" y="5" font-size="8" text-anchor="middle" fill="#9333ea">${esc(s.a.text)}</text></g>`).join('');
      const push = d.push ? `<text x="${10 + d.push.at * (W - 20)}" y="52" font-size="8" text-anchor="middle" fill="#b45309">↑${esc(d.push.name)}</text>` : '';
      return `${svg(W, 56, `<rect x="4" y="26" width="${W - 8}" height="14" rx="7" fill="#475569"/>
        <g class="items"></g>${sens}${push}`)}
        <div style="display:flex;gap:4px;margin-top:2px"><button class="btn small ghost" data-act="feed">📦 제품 투입</button><span class="pv-val" data-f="cnt"></span></div>`;
    },
    up(d, el) {
      const W = 300;
      const g = el.querySelector('.items');
      if (!g) return;
      g.innerHTML = d.items.map((it) => `<rect x="${10 + it.x * (W - 20) - 8}" y="14" width="16" height="14" rx="2" fill="${it.kind === 'B' ? '#a855f7' : '#f59e0b'}" stroke="#1e293b"/>`).join('');
      const c = el.querySelector('[data-f=cnt]');
      if (c) c.textContent = `제품 ${d.items.length}${d.done ? ' · 배출 ' + d.done : ''}${d.pushed ? ' · 분류 ' + d.pushed : ''}`;
    },
    act(d, a, plant) { if (a === 'feed') plant.set(d.name, 1); }
  };
  V.TANK = {
    html() {
      return svg(80, 74, `<rect x="14" y="8" width="52" height="58" rx="3" fill="#0f172a" fill-opacity=".08" stroke="#475569" stroke-width="2"/>
        <rect class="w" x="16" y="30" width="48" height="34" fill="#38bdf8" fill-opacity=".75"/>
        <circle class="hi" cx="70" cy="22" r="3.5" fill="#334155"/><circle class="lo" cx="70" cy="56" r="3.5" fill="#334155"/>
        <text class="lv" x="40" y="42" font-size="11" font-weight="700" text-anchor="middle" fill="#0f172a">0%</text>
        <path class="in" d="M20 8 L20 2 L34 2" fill="none" stroke="#64748b" stroke-width="2.5"/>
        <path class="out" d="M60 66 L60 72 L74 72" fill="none" stroke="#64748b" stroke-width="2.5"/>`);
    },
    up(d, el) {
      const h = 56 * d.level / 100;
      const w = el.querySelector('.w');
      if (w) { w.setAttribute('y', 64 - h); w.setAttribute('height', h); }
      const t = el.querySelector('.lv');
      if (t) t.textContent = Math.round(d.level) + '%';
      const hi = el.querySelector('.hi'), lo = el.querySelector('.lo');
      if (hi) hi.setAttribute('fill', d.level >= d.hiAt ? '#22c55e' : '#334155');
      if (lo) lo.setAttribute('fill', d.level >= d.loAt ? '#22c55e' : '#334155');
      const i = el.querySelector('.in'), o = el.querySelector('.out');
      if (i) i.setAttribute('stroke', d.inflow ? '#22c55e' : '#64748b');
      if (o) o.setAttribute('stroke', d.outflow ? '#ef4444' : '#64748b');
    }
  };
  V.OVEN = {
    html() {
      return svg(70, 56, `<rect x="6" y="6" width="58" height="42" rx="4" fill="#1e293b" fill-opacity=".1" stroke="#475569" stroke-width="2"/>
        <rect class="glow" x="10" y="34" width="50" height="10" rx="2" fill="#ef4444" fill-opacity="0"/>
        <text class="tm" x="35" y="28" font-size="13" font-weight="700" text-anchor="middle" fill="#b45309">20℃</text>`);
    },
    up(d, el) {
      const g = el.querySelector('.glow');
      if (g) g.setAttribute('fill-opacity', String(Math.min(0.9, d.power * 0.9)));
      const t = el.querySelector('.tm');
      if (t) t.textContent = d.temp.toFixed(1) + '℃';
    }
  };
  V.POT = {
    html(d) {
      return `${svg(52, 44, `<circle cx="26" cy="22" r="16" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>
        <line class="kn" x1="26" y1="22" x2="26" y2="8" stroke="#1e293b" stroke-width="3.5" stroke-linecap="round"/>`)}
        <input type="range" min="0" max="100" step="1" value="${d.val}" data-set="val"><span class="pv-val" data-f="v"></span>`;
    },
    up(d, el) {
      const k = el.querySelector('.kn');
      if (k) k.setAttribute('transform', `rotate(${-135 + d.val * 2.7} 26 22)`);
      const v = el.querySelector('[data-f=v]');
      if (v) {
        const r = d._plant.rack.resolveAnalog('ad', d.ad);
        const rg = r && r.mod.rangeOf(r.ch);
        v.textContent = rg ? `${d.val}% · ${(rg.lo + d.val / 100 * (rg.hi - rg.lo)).toFixed(2)}${rg.unit}` : d.val + '%';
      }
      const s = el.querySelector('[data-set=val]');
      if (s && document.activeElement !== s) s.value = d.val;
    },
    set(d, k, v, plant) { plant.set(d.name, +v); }
  };
  V.USONIC = {
    html(d) {
      return `${svg(120, 40, `<rect x="2" y="12" width="20" height="18" rx="3" fill="#0ea5e9"/><circle cx="12" cy="21" r="5" fill="#0369a1"/>
        <g class="wave" opacity=".6"><path d="M24 14 A 10 10 0 0 1 24 28" fill="none" stroke="#38bdf8" stroke-width="2"/><path d="M30 10 A 16 16 0 0 1 30 32" fill="none" stroke="#38bdf8" stroke-width="2"/></g>
        <rect class="tgt" x="90" y="6" width="10" height="30" fill="#f59e0b"/>`)}
        <input type="range" min="0" max="${Math.round(d.max * 1.1)}" step="1" value="${d.dist}" data-set="dist"><span class="pv-val" data-f="v"></span>`;
    },
    up(d, el) {
      const t = el.querySelector('.tgt');
      const x = 34 + Math.min(1, d.dist / (d.max * 1.1)) * 76;
      if (t) t.setAttribute('x', x);
      const v = el.querySelector('[data-f=v]');
      if (v) {
        const r = d._plant.rack.resolveAnalog('ad', d.ad);
        const rg = r && r.mod.rangeOf(r.ch);
        const frac = Math.max(0, Math.min(1, (d.dist - d.min) / (d.max - d.min)));
        v.textContent = `${Math.round(d.dist)}mm` + (rg ? ` · ${(rg.lo + frac * (rg.hi - rg.lo)).toFixed(2)}${rg.unit}` : '');
      }
      const s = el.querySelector('[data-set=dist]');
      if (s && document.activeElement !== s) s.value = Math.round(d.dist);
    },
    set(d, k, v, plant) { plant.set(d.name, +v); }
  };
  V.METER = {
    html() {
      return svg(84, 54, `<path d="M8 46 A 34 34 0 0 1 76 46" fill="none" stroke="#cbd5e1" stroke-width="7"/>
        <line class="nd" x1="42" y1="46" x2="42" y2="16" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="42" cy="46" r="3.5" fill="#334155"/>
        <text class="vt" x="42" y="52" font-size="10" font-weight="700" text-anchor="middle" fill="#334155">0</text>`);
    },
    up(d, el) {
      const n = el.querySelector('.nd');
      if (n) n.setAttribute('transform', `rotate(${-90 + Math.max(0, Math.min(1, d.frac)) * 180} 42 46)`);
      const t = el.querySelector('.vt');
      if (t) t.textContent = `${(d.s0 + d.frac * (d.s1 - d.s0)).toFixed(1)}${d.p.unit || ''}`;
    }
  };
  V.TERM = {
    wide: true,
    html(d) {
      return `<div class="pv-term"><pre data-f="log"></pre>
        <div class="row"><input type="text" data-send="1" placeholder="보낼 글자 (Enter)"><button class="btn small" data-act="send">보내기</button><button class="btn small ghost" data-act="clr">지움</button></div></div>`;
    },
    up(d, el) {
      const p = el.querySelector('[data-f=log]');
      if (p && p.dataset.len !== String(d.text.length)) {
        p.dataset.len = String(d.text.length);
        p.textContent = d.text.replace(/\r/g, '');
        p.scrollTop = p.scrollHeight;
      }
    },
    act(d, a, plant, el) {
      if (a === 'clr') { d.text = ''; const p = el.querySelector('[data-f=log]'); p.dataset.len = '-1'; return; }
      const inp = el.querySelector('[data-send]');
      if (inp && inp.value) { plant.set(d.name, inp.value); inp.value = ''; }
    }
  };
  V.BCR = {
    html() {
      return `${svg(58, 34, `<rect x="4" y="6" width="50" height="22" rx="3" fill="#1e293b"/>${[8, 12, 15, 20, 24, 27, 32, 38, 42, 46].map((x, i) => `<rect x="${x}" y="10" width="${i % 3 ? 2 : 3}" height="14" fill="#f8fafc"/>`).join('')}`)}
        <button class="btn small" data-act="scan">📷 스캔</button><span class="pv-val" data-f="last"></span>`;
    },
    up(d, el) { const l = el.querySelector('[data-f=last]'); if (l) l.textContent = d.last || ''; },
    act(d, a, plant) { plant.set(d.name, 1); }
  };

  // ==================================================================== 조작판
  class PlantView {
    constructor(host, sim, opts = {}) {
      this.host = host;
      this.sim = sim;
      this.opts = opts;
      host.classList.add('pv');
      this.render();
      this.bind();
    }
    get plant() { return this.sim.plant; }
    render() {
      const list = this.plant.devices;
      if (!list.length) {
        this.host.innerHTML = '<div class="pv-empty">연결된 현장 장비가 없습니다. <b>[io]</b> 에 장비를 적으면 여기에서 조작할 수 있습니다.</div>';
        return;
      }
      this.host.innerHTML = list.map((d, i) => {
        const v = V[d.type] || {};
        const addr = ['x', 'y', 'sol', 'a', 'fwd', 'run', 'in', 'heat', 'port', 'ad', 'da'].map((k) => (d[k] && d[k].text ? d[k].text : null)).filter(Boolean)[0]
          || (d.ad ? 'A/D CH' + d.ad : d.da ? 'D/A CH' + d.da : d.port ? String(d.port).toUpperCase() : '');
        return `<div class="pv-dev${v.wide || (d.spec && d.spec.wide) ? ' wide' : ''}" data-i="${i}" title="${esc(d.spec.name + ' ' + d.name)}">
          ${v.html ? v.html(d) : '<div class="pv-empty">?</div>'}
          <div class="nm">${esc(d.label || d.name)}</div>
          <div class="ad" data-f="ad">${esc(addr)}</div>
          <span class="warn hidden">⚠</span>
        </div>`;
      }).join('');
      this.els = [...this.host.querySelectorAll('.pv-dev')];
      this.update();
    }
    update() {
      const list = this.plant.devices;
      this.els && this.els.forEach((el, i) => {
        const d = list[i];
        if (!d) return;
        const v = V[d.type];
        if (v && v.up) v.up(d, el);
        const ad = el.querySelector('[data-f=ad]');
        if (ad) {
          const key = ['x', 'y', 'sol', 'a', 'fwd', 'run', 'in', 'heat'].find((k) => d[k] && d[k].text);
          if (key) {
            const a = d[key];
            const on = a.dev === 'X' ? this.sim.cpu.bits.X[a.addr] : this.sim.rack.getOutput(a.addr);
            ad.classList.toggle('on', !!on);
          }
        }
        const w = el.querySelector('.warn');
        if (w) { w.classList.toggle('hidden', !d.fault); w.title = d.fault || ''; }
        el.classList.toggle('fault', !!d.fault);
      });
    }
    devAt(e) {
      const box = e.target.closest('.pv-dev');
      if (!box) return null;
      return { d: this.plant.devices[+box.dataset.i], el: box };
    }
    bind() {
      // 이 조작판이 붙인 이벤트는 destroy() 때 모두 뗀다 (같은 자리에 새 조작판을 만들 때 옛 처리기가 남지 않게)
      this.ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const on = (target, type, fn, opt) => target.addEventListener(type, fn, Object.assign({}, opt || {}, this.ac ? { signal: this.ac.signal } : {}));
      const set = (d, v) => { this.plant.set(d.name, v); this.update(); if (this.opts.onAct) this.opts.onAct(d); };
      // 짧게 누르면 PLC 가 한 스캔도 못 보고 지나가므로, 최소 150ms 는 눌린 상태로 둔다
      const MIN_PRESS = 150;
      // 카드 어디를 눌러도 버튼 · 스위치가 동작한다 (단추 · 입력칸 · 슬라이더는 제외)
      const hit = (e, it, sel) => e.target.closest(sel) || (!e.target.closest('button,input,select,textarea,[data-act],[data-set]') && it.el.querySelector(sel));
      const press = (d, v) => {
        if (v) { d._pressAt = performance.now(); set(d, 1); return; }
        const dt = performance.now() - (d._pressAt || 0);
        if (dt >= MIN_PRESS) set(d, 0);
        else setTimeout(() => set(d, 0), MIN_PRESS - dt);
      };
      // 누르고 있는 버튼: 손가락(포인터)마다 따로 기억했다가, 어디서 손을 떼든 반드시 놓는다
      const held = new Map();
      const releaseId = (id) => { const h = held.get(id); if (!h) return; held.delete(id); h.el.classList.remove('pressed'); press(h.d, 0); };
      const releaseAll = () => [...held.keys()].forEach(releaseId);
      on(this.host, 'pointerdown', (e) => {
        const it = this.devAt(e);
        if (!it) return;
        if (hit(e, it, '[data-press]')) { e.preventDefault(); releaseId(e.pointerId); held.set(e.pointerId, { d: it.d, el: it.el }); press(it.d, 1); it.el.classList.add('pressed'); }
        else if (hit(e, it, '[data-toggle]')) { e.preventDefault(); set(it.d, it.d.on ? 0 : 1); }
      });
      on(window, 'pointerup', (e) => releaseId(e.pointerId), true);
      on(window, 'pointercancel', (e) => releaseId(e.pointerId), true);
      on(window, 'touchend', (e) => { if (!e.touches || !e.touches.length) releaseAll(); }, true);
      on(window, 'touchcancel', releaseAll, true);
      on(window, 'blur', releaseAll);
      on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') releaseAll(); });
      on(this.host, 'contextmenu', (e) => { if (e.target.closest('.pv-dev')) e.preventDefault(); });
      this.releaseAll = releaseAll;
      on(this.host, 'click', (e) => {
        const it = this.devAt(e);
        if (!it) return;
        const a = e.target.closest('[data-act]');
        if (a) { const v = V[it.d.type]; if (v && v.act) { v.act(it.d, a.dataset.act, this.plant, it.el); this.update(); } }
      });
      on(this.host, 'input', (e) => {
        const it = this.devAt(e);
        const s = e.target.closest('[data-set]');
        if (!it || !s) return;
        const v = V[it.d.type];
        if (v && v.set) v.set(it.d, s.dataset.set, s.value, this.plant);
        this.update();
      });
      on(this.host, 'keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.closest('[data-send]')) return;
        const it = this.devAt(e);
        if (!it) return;
        const v = V[it.d.type];
        if (v && v.act) { v.act(it.d, 'send', this.plant, it.el); this.update(); }
      });
    }
    destroy() {
      if (this.releaseAll) this.releaseAll();
      if (this.ac) this.ac.abort();
      this.host.innerHTML = '';
    }
  }
  PLC.PlantView = PlantView;
  PLC.PLANT_VIEWS = V;
})(typeof window !== 'undefined' ? window : globalThis);
