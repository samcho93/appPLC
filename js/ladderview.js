/* 래더 화면 (제조사 공용 · 모바일)
 *  - 그리기 · 모니터(통전 표시) · 편집 (강좌 에디터의 래더 화면을 스마트폰 · 태블릿에 맞게 고친 것)
 *  - 가로 스크롤 없이 화면 폭에 맞추고, 손가락 두 개(핀치) · 단추 · Ctrl+휠로 확대 · 축소
 *  - 한 손가락 끌기 = 화면 이동, 탭 = 칸 선택, 같은 칸 다시 탭 = 내용 고치기
 *  - 편집 중 오른쪽 칸이 모자라면 열을 자동으로 늘린다
 *  - 제조사마다 다른 표기 · 단축키는 PLC.VENDOR (js/<제조사>/vendor.js) 에서 읽는다
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const V = () => PLC.VENDOR || {};

  const CW = 70, CH = 52, RAIL = 36, MID = 25, NOTE_H = 20;
  /** 출력 열 폭 — 좁은 화면에서는 조금 줄인다 */
  const outW = () => (typeof window !== 'undefined' && window.innerWidth < 520 ? 160 : 190);

  // ------------------------------------------------------------------ 통전 계산
  function computeFlow(g, evalElem) {
    const W = g.W;
    const rungs = PLC.splitRungs(g);
    const cellOn = g.rows.map(() => new Array(W).fill(false));
    const nodeOn = g.rows.map(() => new Array(W + 1).fill(false));
    const outOn = g.rows.map(() => false);
    const inv = V().inv || {};
    rungs.forEach(({ r0, r1 }) => {
      for (let r = r0; r < r1; r++) nodeOn[r][0] = true;
      for (let b = 0; b <= W; b++) {
        if (b > 0) {
          for (let r = r0; r < r1; r++) {
            const cell = g.rows[r].cells[b - 1];
            if (!cell || cell.k === 'SPAN') continue;
            const w = cell.k === 'E' ? (cell.w || 1) : 1;
            const from = b - w;
            if (from < 0) continue;
            const inOn = nodeOn[r][from];
            const pass = cell.k === 'H' ? inOn
              : (inv[cell.e.c] && cell.e.c !== 'MEP' && cell.e.c !== 'MEF') ? !inOn
                : inOn && evalElem(cell.e, inOn);
            if (pass) nodeOn[r][b] = true;
            for (let k = 0; k < w; k++) cellOn[r][from + k] = pass;
          }
        }
        let changed = true;
        while (changed) {
          changed = false;
          for (let r = r0; r < r1 - 1; r++) {
            if (!g.v.has(`${r},${b}`)) continue;
            if (nodeOn[r][b] !== nodeOn[r + 1][b]) { nodeOn[r][b] = nodeOn[r + 1][b] = true; changed = true; }
          }
        }
      }
      for (let r = r0; r < r1; r++) if (g.rows[r].out) outOn[r] = nodeOn[r][W];
    });
    return { cellOn, nodeOn, outOn };
  }
  PLC.computeFlow = computeFlow;

  // ------------------------------------------------------------------ 값 표시
  function devValue(cpu, text) {
    const o = PLC.parseOperand(text);
    if (!o) return null;
    const vd = V();
    if ((vd.noValueKinds || []).indexOf(o.kind) >= 0) return null;
    if (o.kind !== 'dev' && o.kind !== 'u' && o.kind !== 'buf' && o.kind !== 'digit') return null;
    try {
      if (vd.isTC && vd.isTC(o)) {
        const i = cpu.timerInfo(o.dev, vd.tcIndex(o));
        return `${i.cur}/${i.set}`;
      }
      if (vd.isBitOperand && vd.isBitOperand(o)) return cpu.readBit(o) ? 'ON' : 'OFF';
      return String(cpu.readWord(o));
    } catch (e) { return null; }
  }

  /** 격자의 접점 열을 n 개 늘린다 (출력 쪽 경계의 세로선도 따라간다) */
  function growGrid(g, n) {
    const W0 = g.W;
    g.rows.forEach((row) => {
      const fillH = !!row.out || (row.cells[W0 - 1] && row.cells[W0 - 1].k === 'H');
      for (let k = 0; k < n; k++) row.cells.push(fillH ? { k: 'H' } : null);
    });
    const nv = new Set();
    g.v.forEach((key) => { const [r, b] = key.split(',').map(Number); nv.add(`${r},${b === W0 ? W0 + n : b}`); });
    g.v = nv;
    g.W = W0 + n;
  }

  // ------------------------------------------------------------------ 화면
  class LadderView {
    /**
     * opts: editable · toast(msg, bad) · onEditState(on, st) · onConvert(il) · onPick(dev) · onZoom(z)
     *       zoom (처음 배율) · maxCols (편집 때 최대 열 수)
     */
    constructor(host, sim, opts = {}) {
      this.host = host;
      this.sim = sim;
      this.opts = opts;
      this.editable = !!opts.editable;
      this.editing = false;
      this.cur = { r: 0, c: 0 };
      this.zoom = Math.max(0.4, Math.min(3, +opts.zoom || 1));
      this.host.classList.add('lv', 'fit');
      this.host.innerHTML = '<div class="lv-scroll"><svg class="lv-svg" xmlns="http://www.w3.org/2000/svg"></svg></div>';
      this.scroll = this.host.firstChild;
      this.svg = this.scroll.firstChild;
      this.bind();
      this.render();
      if (typeof ResizeObserver !== 'undefined') {
        this.ro = new ResizeObserver(() => {
          const cols = this.fitColumns();
          if (this.editing) { this.applyZoom(); return; }
          if (cols && cols !== this.fitW) {
            clearTimeout(this._rt);
            this._rt = setTimeout(() => this.render(), 60);
          } else this.applyZoom();
        });
        this.ro.observe(this.host);
      }
    }
    get grid() { return this.editing ? this.egrid : (this.fitGrid || this.sim.getGrid()); }

    /** 화면 폭에 맞는 접점 열 수 — 글자가 너무 작아지지 않게 (배율 0.85 기준) 오른쪽을 열로 채운다 */
    fitColumns() {
      const avail = this.scroll.clientWidth || this.host.clientWidth || 0;
      if (avail < 120) return 0;
      const maxCols = this.opts.maxCols || 11;
      return Math.max(3, Math.min(maxCols, Math.floor((avail / 0.85 - RAIL - outW() - 30) / CW)));
    }

    // ---------------------------------------------------------------- 확대 · 축소
    /** 배율 적용: 1 이하이면 가로 스크롤 없이 폭에 맞고, 1 보다 크면 그만큼 넓어져 손가락으로 끌어 본다 */
    applyZoom() {
      const avail = this.scroll.clientWidth || this.host.clientWidth || 0;
      if (!avail || !this.width) return;
      const w = Math.round(avail * this.zoom);
      this.svg.style.width = w + 'px';
      this.svg.style.height = Math.round(w * this.height / this.width) + 'px';
      this.host.classList.toggle('zoomed', this.zoom > 1.001);
    }
    setZoom(z, anchor) {
      const nz = Math.max(0.4, Math.min(3, +z || 1));
      if (Math.abs(nz - this.zoom) < 1e-4) return;
      const sc = this.scroll;
      const ax = anchor ? anchor.x : sc.clientWidth / 2, ay = anchor ? anchor.y : sc.clientHeight / 2;
      const px = (sc.scrollLeft + ax) / this.zoom, py = (sc.scrollTop + ay) / this.zoom;
      this.zoom = nz;
      this.applyZoom();
      sc.scrollLeft = px * nz - ax;
      sc.scrollTop = py * nz - ay;
      if (this.opts.onZoom) this.opts.onZoom(this.zoom);
    }
    zoomBy(f, anchor) { this.setZoom(this.zoom * f, anchor); }
    zoomFit() { this.setZoom(1); this.scroll.scrollLeft = 0; }

    // ---------------------------------------------------------------- 그리기
    render() {
      const OUTW = outW();
      if (!this.editing) {
        const cols = this.fitColumns();
        this.fitW = cols;
        this.fitGrid = cols ? PLC.layout(this.sim.program, cols) : null;
      } else this.fitGrid = null;
      const g = this.grid;
      const W = g.W;
      const comments = this.opts.comments === false ? {} : this.sim.comments();
      const width = RAIL + W * CW + OUTW + 24;
      const rowY = [];
      let y = 6;
      const rungs = g.rungs || PLC.splitRungs(g).map((x) => ({ r0: x.r0, r1: x.r1 }));
      const rungAt = {};
      rungs.forEach((rg) => { rungAt[rg.r0] = rg; });
      g.rows.forEach((row, r) => {
        const rg = rungAt[r];
        if (rg && (row.note || row.label != null)) y += NOTE_H * ((row.note ? row.note.split('\n').length : 0) + (row.label != null ? 1 : 0));
        rowY.push(y);
        y += CH;
      });
      const height = y + 10;
      const S = [];
      const push = (s) => S.push(s);
      push(`<rect class="lv-bg" x="0" y="0" width="${width}" height="${height}"/>`);
      rungs.forEach((rg) => {
        const y0 = rowY[rg.r0], y1 = rowY[rg.r1 - 1] + CH;
        push(`<line class="lv-rail" x1="${RAIL}" y1="${y0}" x2="${RAIL}" y2="${y1 - 4}"/>`);
        push(`<line class="lv-rail" x1="${RAIL + W * CW + OUTW}" y1="${y0}" x2="${RAIL + W * CW + OUTW}" y2="${y1 - 4}"/>`);
        push(`<line class="lv-sep" x1="0" y1="${y1 - 2}" x2="${width}" y2="${y1 - 2}"/>`);
        if (rg.step != null) push(`<text class="lv-step" x="${RAIL - 5}" y="${rowY[rg.r0] + MID + 4}" text-anchor="end">${rg.step}</text>`);
        if (rg.err) push(`<text class="lv-err" x="${RAIL + 6}" y="${rowY[rg.r0] - 4}">⚠ ${esc(rg.err)}</text>`);
      });
      g.rows.forEach((row, r) => {
        const yy = rowY[r];
        if (row.note) row.note.split('\n').forEach((t, i) => push(`<text class="lv-note" x="${RAIL}" y="${yy - 6 - NOTE_H * (row.note.split('\n').length - 1 - i)}">${esc('; ' + t)}</text>`));
        if (row.label != null) push(`<text class="lv-label" x="4" y="${yy - 4}">P${row.label}</text>`);
        for (let c = 0; c < W; c++) {
          const cell = row.cells[c];
          const x = RAIL + c * CW;
          if (!cell || cell.k === 'SPAN') continue;
          const w = cell.k === 'E' ? (cell.w || 1) : 1;
          push(`<g class="lv-cell" data-r="${r}" data-c="${c}">${cellSvg(cell, x, yy, w, comments)}</g>`);
        }
        for (let b = 0; b <= W; b++) {
          if (!g.v.has(`${r},${b}`)) continue;
          const x = RAIL + b * CW;
          push(`<line class="lv-v" data-vr="${r}" data-vb="${b}" x1="${x}" y1="${yy + MID}" x2="${x}" y2="${rowY[r + 1] != null ? rowY[r + 1] + MID : yy + CH + MID}"/>`);
        }
        if (row.out) {
          const x = RAIL + W * CW;
          push(`<g class="lv-cell lv-out" data-r="${r}" data-c="out">${outSvg(row.out, x, yy, comments, OUTW)}</g>`);
        }
        // 편집 중에는 빈 칸도 누를 수 있게 격자 점을 찍는다
        if (this.editing) {
          for (let c = 0; c < W; c++) if (!row.cells[c]) push(`<circle class="lv-dot" cx="${RAIL + c * CW + CW / 2}" cy="${yy + MID}" r="1.6"/>`);
        }
      });
      this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      this.svg.innerHTML = S.join('');
      this.rowY = rowY;
      this.width = width;
      this.height = height;
      this.outW = OUTW;
      this.applyZoom();
      this.drawCursor();
      this.update();
    }

    /** 모니터 갱신 (통전 · 현재값) */
    update() {
      const g = this.grid;
      const cpu = this.sim.cpu;
      const mon = this.opts.monitor !== false && !this.editing;
      this.host.classList.toggle('mon', mon);
      if (!mon) return;
      const vd = V();
      const ev = (e, inOn) => {
        try {
          if (e.c === 'CMP') {
            const ins = PLC.parseInstr(`${vd.ld || 'LD'}${e.wd || ''}${e.rel} ${e.ops.join(' ')}`);
            return ins && !ins.error ? !!cpu.evalCompare(ins) : false;
          }
          if (vd.inv && vd.inv[e.c]) return e.c === 'MEP' || e.c === 'MEF' ? inOn : !inOn;
          const o = PLC.parseOperand(e.ops[0]);
          const v = cpu.readBit(o);
          return e.c === 'NC' ? !v : !!v;
        } catch (err) { return false; }
      };
      const f = computeFlow(g, ev);
      this.svg.querySelectorAll('.lv-cell').forEach((el) => {
        const r = +el.dataset.r;
        const c = el.dataset.c;
        const on = c === 'out' ? f.outOn[r] : f.cellOn[r][+c];
        el.classList.toggle('on', !!on);
        const cell = c === 'out' ? null : g.rows[r].cells[+c];
        if (cell && cell.k === 'E' && (cell.e.c === 'NO' || cell.e.c === 'NC')) {
          const o = PLC.parseOperand(cell.e.ops[0]);
          let live = false;
          try { live = !!cpu.readBit(o); } catch (e) { /* 무시 */ }
          el.classList.toggle('dev-on', live);
        }
        const iv = el.querySelector('.lv-inv');
        if (iv) {
          const dev = iv.dataset.dev;
          let t = '';
          const o = dev ? PLC.parseOperand(dev) : null;
          if (o && o.kind === 'dev') {
            try {
              if (vd.isTC && vd.isTC(o)) { const i = cpu.timerInfo(o.dev, vd.tcIndex(o)); t = `${i.cur}`; }
              else t = cpu.readBit(o) ? 'ON' : 'OFF';
            } catch (e2) { t = ''; }
          }
          if (iv.textContent !== t) iv.textContent = t;
          iv.classList.toggle('on', t === 'ON');
        }
        const vt = el.querySelector('.lv-val');
        if (vt) {
          const list = (vt.dataset.ops || '').split('|').filter(Boolean);
          const txt = list.map((t) => { const v = devValue(cpu, t); return v == null ? null : `${t}=${v}`; }).filter(Boolean).join('  ');
          if (vt.textContent !== txt) vt.textContent = txt;
        }
      });
      this.svg.querySelectorAll('.lv-v').forEach((el) => {
        const r = +el.dataset.vr, b = +el.dataset.vb;
        el.classList.toggle('on', !!(f.nodeOn[r] && f.nodeOn[r][b]));
      });
    }

    // ---------------------------------------------------------------- 커서 · 편집
    setEditing(on) {
      if (on) {
        // 편집 격자: 프로그램에 필요한 열 + 여유 한 열, 화면 폭에 맞는 열 수 중 큰 쪽
        const cols = Math.max(this.fitColumns() || 4, PLC.layout(this.sim.program, 1).W + 1);
        this.egrid = PLC.cloneGrid(PLC.layout(this.sim.program, cols));
        if (!this.egrid.rows.length) this.egrid.rows.push({ cells: new Array(this.egrid.W).fill(null), out: null });
        this.dirty = false;
        this.undoStack = [];
        this.redoStack = [];
        this.cur = { r: Math.min(this.cur.r, this.egrid.rows.length - 1), c: this.cur.c };
      } else { this.egrid = null; this.fitGrid = null; this.dirty = false; }
      this.editing = !!on;
      this.host.classList.toggle('editing', this.editing);
      this.render();
      this.syncEdit();
    }
    drawCursor() {
      const old = this.svg.querySelector('.lv-cursor');
      if (old) old.remove();
      if (!this.editing) return;
      const g = this.grid;
      const r = Math.min(this.cur.r, g.rows.length - 1);
      const c = this.cur.c;
      const y = this.rowY[r];
      if (y == null) return;
      const x = c === 'out' ? RAIL + g.W * CW : RAIL + c * CW;
      const w = c === 'out' ? this.outW : CW;
      const el = document.createElementNS(SVGNS, 'rect');
      el.setAttribute('class', 'lv-cursor');
      el.setAttribute('x', x + 1);
      el.setAttribute('y', y + 2);
      el.setAttribute('width', w - 2);
      el.setAttribute('height', CH - 6);
      el.setAttribute('rx', 4);
      this.svg.appendChild(el);
      // 커서가 보이도록 스크롤
      const box = el.getBoundingClientRect();
      const host = this.scroll.getBoundingClientRect();
      if (box.left < host.left) this.scroll.scrollLeft += box.left - host.left - 20;
      else if (box.right > host.right) this.scroll.scrollLeft += box.right - host.right + 20;
      if (box.top < host.top) this.scroll.scrollTop += box.top - host.top - 20;
      else if (box.bottom > host.bottom) this.scroll.scrollTop += box.bottom - host.bottom + 20;
    }
    moveCur(dr, dc) {
      const g = this.grid;
      let { r, c } = this.cur;
      if (c === 'out') c = g.W;
      c += dc;
      r = Math.max(0, r + dr);
      while (r >= g.rows.length) {
        const blank = { cells: new Array(g.W).fill(null), out: null };
        const ei = g.rows.findIndex((x) => x.isEnd);
        if (ei >= 0) g.rows.splice(ei, 0, blank); else g.rows.push(blank);
      }
      c = Math.max(0, Math.min(g.W, c));
      this.cur = { r, c: c === g.W ? 'out' : c };
      if (this.grid.rows.length !== (this.svg.querySelectorAll('.lv-cell').length)) this.render();
      this.drawCursor();
    }

    /** 칸에 내용 넣기 */
    put(kind, text) {
      const g = this.egrid;
      if (!g) return;
      this.pushUndo();
      let { r } = this.cur;
      let c = this.cur.c;
      if (g.rows[r] && g.rows[r].isEnd && kind !== 'delRow') {
        g.rows.splice(r, 0, { cells: new Array(g.W).fill(null), out: null });
        const nv = new Set();
        g.v.forEach((k) => { const [rr, b] = k.split(',').map(Number); nv.add(`${rr >= r ? rr + 1 : rr},${b}`); });
        g.v = nv;
        this.cur = { r, c };
      }
      const row = g.rows[r] || (g.rows[r] = { cells: new Array(g.W).fill(null), out: null });
      if (kind === 'out') {
        row.out = text;
        let last = -1;
        for (let i = 0; i < g.W; i++) if (row.cells[i]) last = i;
        for (let i = last + 1; i < g.W; i++) row.cells[i] = { k: 'H' };
        this.cur = { r, c: 'out' };
      } else if (kind === 'H') {
        if (c === 'out') return;
        row.cells[c] = { k: 'H' };
        this.cur = { r, c: c + 1 >= g.W ? 'out' : c + 1 };
      } else if (kind === 'V') {
        const b = c === 'out' ? g.W : c;
        const key = `${r},${b}`;
        if (g.v.has(key)) g.v.delete(key); else g.v.add(key);
      } else if (kind === 'E' || kind === 'EOR') {
        if (c === 'out') c = g.W - 1;
        const e = text;
        const w = e.c === 'CMP' ? 2 : 1;
        // 오른쪽 칸이 모자라면 열을 늘린다 (출력 열 앞에 가로선 한 칸은 남긴다)
        const maxCols = this.opts.maxCols || 16;
        if (c + w >= g.W && g.W < maxCols) growGrid(g, Math.min(maxCols - g.W, c + w + 1 - g.W));
        if (c + w > g.W) { this.toast('오른쪽 공간이 모자랍니다'); return; }
        row.cells[c] = { k: 'E', e, w };
        for (let k = 1; k < w; k++) row.cells[c + k] = { k: 'SPAN' };
        if (kind === 'EOR') {
          if (r > 0) { g.v.add(`${r - 1},${c}`); g.v.add(`${r - 1},${c + w}`); }
        }
        this.cur = { r, c: Math.min(g.W, c + w) === g.W ? 'out' : c + w };
      } else if (kind === 'del') {
        if (c === 'out') row.out = null;
        else {
          const cell = row.cells[c];
          if (cell && cell.k === 'SPAN') { let i = c; while (i >= 0 && row.cells[i].k === 'SPAN') i--; row.cells[i] = null; row.cells[c] = null; }
          else if (cell && cell.k === 'E' && cell.w > 1) { for (let k = 0; k < cell.w; k++) row.cells[c + k] = null; }
          else row.cells[c] = null;
        }
      } else if (kind === 'delV') {
        const b = c === 'out' ? g.W : c;
        g.v.delete(`${r},${b}`);
        if (r > 0) g.v.delete(`${r - 1},${b}`);
      } else if (kind === 'insRow') {
        g.rows.splice(r, 0, { cells: new Array(g.W).fill(null), out: null });
        const nv = new Set();
        g.v.forEach((k) => { const [rr, b] = k.split(',').map(Number); nv.add(`${rr >= r ? rr + 1 : rr},${b}`); });
        g.v = nv;
      } else if (kind === 'delRow') {
        g.rows.splice(r, 1);
        const nv = new Set();
        g.v.forEach((k) => { const [rr, b] = k.split(',').map(Number); if (rr === r) return; nv.add(`${rr > r ? rr - 1 : rr},${b}`); });
        g.v = nv;
        if (!g.rows.length) g.rows.push({ cells: new Array(g.W).fill(null), out: null });
        this.cur = { r: Math.min(r, g.rows.length - 1), c };
      }
      const ei = g.rows.findIndex((x) => x.isEnd);
      if (ei >= 0 && ei !== g.rows.length - 1) {
        const [endRow] = g.rows.splice(ei, 1);
        g.rows.push(endRow);
      }
      this.setDirty(true);
      this.render();
      if (this.opts.onChange) this.opts.onChange();
    }

    // ---------------------------------------------------------------- 되돌리기 · 클립보드
    pushUndo() {
      if (!this.egrid) return;
      this.undoStack = this.undoStack || [];
      this.redoStack = [];
      this.undoStack.push({ g: PLC.cloneGrid(this.egrid), cur: Object.assign({}, this.cur) });
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.syncEdit();
    }
    undo() {
      if (!this.editing || !(this.undoStack || []).length) { this.toast('되돌릴 편집이 없습니다'); return; }
      this.redoStack = this.redoStack || [];
      this.redoStack.push({ g: PLC.cloneGrid(this.egrid), cur: Object.assign({}, this.cur) });
      const s = this.undoStack.pop();
      this.egrid = s.g;
      this.cur = s.cur;
      this.setDirty(true);
      this.render();
    }
    redo() {
      if (!this.editing || !(this.redoStack || []).length) { this.toast('다시 실행할 편집이 없습니다'); return; }
      this.undoStack = this.undoStack || [];
      this.undoStack.push({ g: PLC.cloneGrid(this.egrid), cur: Object.assign({}, this.cur) });
      const s = this.redoStack.pop();
      this.egrid = s.g;
      this.cur = s.cur;
      this.setDirty(true);
      this.render();
    }
    copy(cut) {
      if (!this.editing) return;
      const row = this.grid.rows[this.cur.r];
      if (!row) return;
      if (this.cur.c === 'out') LadderView.clip = { kind: 'out', text: row.out };
      else {
        let c = this.cur.c;
        const cell = row.cells[c];
        if (cell && cell.k === 'SPAN') { while (c >= 0 && row.cells[c].k === 'SPAN') c--; }
        LadderView.clip = { kind: 'cell', cell: row.cells[c] ? JSON.parse(JSON.stringify(row.cells[c])) : null };
      }
      if (cut) this.put('del');
      this.toast(cut ? '잘라냈습니다' : '복사했습니다');
      this.syncEdit();
    }
    paste() {
      if (!this.editing || !LadderView.clip) { this.toast('붙여넣을 내용이 없습니다'); return; }
      const cl = LadderView.clip;
      if (cl.kind === 'out') { if (cl.text) this.put('out', cl.text); return; }
      if (!cl.cell) { this.put('del'); return; }
      if (cl.cell.k === 'H') { this.put('H'); return; }
      if (cl.cell.k === 'E') { this.put('E', JSON.parse(JSON.stringify(cl.cell.e))); return; }
      this.toast('붙여넣을 수 없습니다');
    }
    setDirty(v) { this.dirty = !!v; this.syncEdit(); }
    syncEdit() {
      if (this.opts.onEditState) {
        this.opts.onEditState(this.editing, {
          dirty: !!this.dirty,
          undo: (this.undoStack || []).length,
          redo: (this.redoStack || []).length,
          clip: !!LadderView.clip
        });
      }
    }

    /** 변환(적용): 격자 → 명령어 리스트 → 실행 */
    convert() {
      if (!this.editing) return true;
      try {
        const il = PLC.gridToIL(this.egrid, this.sim.program.comments);
        const p = PLC.parseProgram(il);
        if (p.errors.length) throw new PLC.ConvertError(p.errors[0].msg, 0);
        this.sim.loadProgram(il);
        this.setDirty(false);
        this.undoStack = [];
        this.redoStack = [];
        const cols = Math.max(this.fitColumns() || 4, PLC.layout(this.sim.program, 1).W + 1);
        this.egrid = PLC.cloneGrid(PLC.layout(this.sim.program, cols));
        this.cur = { r: Math.min(this.cur.r, this.egrid.rows.length - 1), c: this.cur.c };
        this.render();
        this.toast((V().convertName || '변환') + '했습니다');
        if (this.opts.onConvert) this.opts.onConvert(il);
        return true;
      } catch (e) {
        this.toast('⚠ ' + e.message, true);
        if (e.row != null) { this.cur = { r: e.row, c: 0 }; this.drawCursor(); }
        return false;
      }
    }
    toast(msg, bad) {
      if (this.opts.toast) { this.opts.toast(msg, bad); return; }
      let t = this.host.querySelector('.lv-toast');
      if (!t) { t = document.createElement('div'); t.className = 'lv-toast'; this.host.appendChild(t); }
      t.textContent = msg;
      t.classList.toggle('bad', !!bad);
      t.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => t.classList.remove('show'), 2200);
    }

    // ---------------------------------------------------------------- 입력 상자 (화면 아래 고정)
    ask(preset, kind) {
      this.closeAsk();
      const vd = V();
      const hint = kind === 'SET' || kind === 'RST' ? `${kind} 할 디바이스` : this.cur.c === 'out' || /^(OUT|MOV|SET|RST)/.test(preset || '') ? (/^(OUT|SET|RST)/.test(preset || '') ? vd.hints.out : vd.hints.app) : vd.hints.contact;
      const label = { NO: 'a 접점', NC: 'b 접점', OR: 'a 접점 병렬', ORNC: 'b 접점 병렬', P: '상승 펄스 접점', F: '하강 펄스 접점', ORP: '상승 펄스 병렬', ORF: '하강 펄스 병렬', SET: 'SET 코일', RST: 'RST 코일' }[kind]
        || (this.cur.c === 'out' ? '출력 · 명령' : '접점');
      const box = document.createElement('div');
      box.className = 'lv-input';
      box.innerHTML = `<div class="lv-input-row"><span class="lbl">${esc(label)}</span>
          <input type="text" spellcheck="false" autocapitalize="characters" autocomplete="off" autocorrect="off" value="${esc(preset || '')}">
          <button class="ok" type="button" title="넣기 (Enter)">↵</button><button class="cancel" type="button" title="취소 (Esc)">✕</button></div>
        <div class="hint">${esc(hint || '')}</div>`;
      this.host.appendChild(box);
      this.askBox = box;
      const inp = box.querySelector('input');
      inp.focus();
      const len = inp.value.length;
      try { inp.setSelectionRange(len, len); } catch (e) { /* 무시 */ }
      const commit = () => {
        const txt = inp.value.trim();
        this.closeAsk();
        if (!txt) return;
        this.enterText(txt, kind);
      };
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { this.closeAsk(); return; }
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
      };
      box.querySelector('.ok').onclick = commit;
      box.querySelector('.cancel').onclick = () => this.closeAsk();
    }
    closeAsk() {
      if (this.askBox) { this.askBox.remove(); this.askBox = null; }
    }
    /** "X0" · "LD X0" · "OUT Y20" · "MOV K10 D0" · "= D0 K5" 입력 처리 (제조사 표기는 PLC.VENDOR) */
    enterText(txt, kind) {
      const vd = V();
      const t = txt.trim();
      const first = t.split(/\s+/)[0].toUpperCase();
      // 두 낱말 명령 (LOAD NOT · AND LOAD …) 도 찾는다
      const two = t.split(/\s+/).slice(0, 2).join(' ').toUpperCase();
      const lk = PLC.lookupOp(two) || PLC.lookupOp(first);
      if (lk && (lk.info.cls === 'out' || lk.info.cls === 'app' || lk.info.cls === 'ctl')) {
        const ins = PLC.parseInstr(t);
        if (!ins || ins.error) { this.toast('⚠ ' + (ins ? ins.error : '명령 오류'), true); return; }
        this.put('out', PLC.instrText(ins));
        return;
      }
      let c = kind === 'NC' || kind === 'ORNC' ? 'NC' : kind === 'P' || kind === 'ORP' ? 'P' : kind === 'F' || kind === 'ORF' ? 'F' : 'NO';
      const orMode = kind === 'OR' || kind === 'ORNC' || kind === 'ORP' || kind === 'ORF';
      if (lk && (lk.info.cls === 'ld' || lk.info.cls === 'and' || lk.info.cls === 'or')) {
        const ins = PLC.parseInstr(t);
        if (!ins || ins.error) { this.toast('⚠ ' + (ins ? ins.error : '명령 오류'), true); return; }
        const e = PLC.elemFromIns(ins);
        this.put(ins.cls === 'or' || orMode ? 'EOR' : 'E', e);
        return;
      }
      if (lk && lk.info.cls === 'cmp') {
        const ins = PLC.parseInstr(t);
        if (!ins || ins.error) { this.toast('⚠ ' + (ins ? ins.error : '명령 오류'), true); return; }
        this.put(orMode ? 'EOR' : 'E', PLC.elemFromIns(ins));
        return;
      }
      if (lk && lk.info.cls === 'blk' && vd.inv && vd.inv[first]) {
        this.put('E', { c: first, ops: [] });
        return;
      }
      const cm = (vd.cmpRe || /^(D|E)?(=|<>|>=|<=|>|<)\s+(.+)$/).exec(t.toUpperCase());
      if (cm) {
        const ins = PLC.parseInstr(`${vd.ld || 'LD'}${cm[1] || ''}${cm[2]} ${cm[3]}`);
        if (!ins || ins.error) { this.toast('⚠ ' + (ins ? ins.error : '비교 접점 오류'), true); return; }
        this.put(orMode ? 'EOR' : 'E', PLC.elemFromIns(ins));
        return;
      }
      const o = PLC.parseOperand(t);
      if (!o || o.kind !== 'dev') { this.toast(`⚠ 디바이스 표기 오류: ${t}`, true); return; }
      if (kind === 'SET' || kind === 'RST') { this.cur = { r: this.cur.r, c: 'out' }; this.put('out', `${kind} ${o.text}`); return; }
      if (this.cur.c === 'out') { this.put('out', `OUT ${o.text}`); return; }
      this.put(orMode ? 'EOR' : 'E', { c, ops: [o.text] });
    }

    // ---------------------------------------------------------------- 이벤트 (터치 · 마우스)
    bind() {
      this.svg.setAttribute('tabindex', '0');
      const ptrs = new Map();
      let gesture = null;     // { kind: 'pan'|'pinch', ... }
      const sc = this.scroll;
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const local = (p) => { const r = sc.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };

      sc.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.lv-input')) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: e.target });
        try { sc.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          gesture = { kind: 'pinch', d0: dist(a, b), z0: this.zoom, m0: local(mid(a, b)) };
        } else if (ptrs.size === 1) {
          gesture = { kind: 'tap', sl: sc.scrollLeft, st: sc.scrollTop, moved: false };
        }
      });
      sc.addEventListener('pointermove', (e) => {
        const p = ptrs.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX; p.y = e.clientY;
        if (!gesture) return;
        if (gesture.kind === 'pinch' && ptrs.size >= 2) {
          const [a, b] = [...ptrs.values()];
          const d = dist(a, b);
          if (gesture.d0 > 0) this.setZoom(gesture.z0 * d / gesture.d0, gesture.m0);
          e.preventDefault();
          return;
        }
        if (gesture.kind === 'tap' || gesture.kind === 'pan') {
          const dx = p.x - p.x0, dy = p.y - p.y0;
          if (gesture.kind === 'tap' && Math.hypot(dx, dy) > 7) gesture.kind = 'pan';
          if (gesture.kind === 'pan') {
            sc.scrollLeft = gesture.sl - dx;
            sc.scrollTop = gesture.st - dy;
            e.preventDefault();
          }
        }
      });
      const end = (e) => {
        const p = ptrs.get(e.pointerId);
        ptrs.delete(e.pointerId);
        if (!p) return;
        if (gesture && gesture.kind === 'tap' && ptrs.size === 0) this.tap(e, p);
        if (ptrs.size === 0) gesture = null;
        else if (ptrs.size === 1) { const [q] = [...ptrs.values()]; q.x0 = q.x; q.y0 = q.y; gesture = { kind: 'pan', sl: sc.scrollLeft, st: sc.scrollTop }; }
      };
      sc.addEventListener('pointerup', end);
      sc.addEventListener('pointercancel', end);
      // Ctrl + 휠 = 확대 · 축소
      sc.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, local({ x: e.clientX, y: e.clientY }));
      }, { passive: false });
      this.svg.addEventListener('keydown', (e) => this.onKey(e));
    }
    /** 탭(클릭): 편집 중이면 칸 선택 · 같은 칸 다시 탭이면 수정, 모니터 중이면 디바이스 강제 변경 */
    tap(e, p) {
      const pt = this.locate(e);
      if (!pt) return;
      if (this.editing) {
        const same = this.cur && this.cur.r === pt.r && String(this.cur.c) === String(pt.c);
        const now = performance.now();
        const quick = same && this._tapAt && now - this._tapAt < 700;
        this._tapAt = now;
        this.cur = pt;
        this.drawCursor();
        if (!('ontouchstart' in window) || window.innerWidth > 900) this.svg.focus({ preventScroll: true });
        if (quick || (same && this.hasContent(pt))) this.dblEdit();
        return;
      }
      if (this.opts.onPick) {
        const row = this.grid.rows[pt.r];
        const cell = pt.c !== 'out' && row ? row.cells[pt.c] : null;
        const out = pt.c === 'out' && row ? row.out : null;
        const dev = cell && cell.k === 'E' && cell.e.ops[0] ? cell.e.ops[0] : out ? (PLC.tokenize(out)[1] || '') : '';
        if (dev) this.opts.onPick(dev, e);
      }
    }
    locate(e) {
      const rect = this.svg.getBoundingClientRect();
      const scale = rect.width / this.width;
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      let r = -1;
      for (let i = 0; i < this.rowY.length; i++) if (y >= this.rowY[i] && y < this.rowY[i] + CH) r = i;
      if (r < 0) {
        // 마지막 줄 아래를 누르면 (편집 중) 새 줄
        if (this.editing && this.rowY.length && y >= this.rowY[this.rowY.length - 1] + CH) r = this.rowY.length - 1; else return null;
      }
      const g = this.grid;
      if (x < RAIL) return { r, c: 0 };
      const c = Math.floor((x - RAIL) / CW);
      return { r, c: c >= g.W ? 'out' : c };
    }
    onKey(e) {
      if (!this.editing) return;
      const k = e.key;
      const sh = e.shiftKey, ct = e.ctrlKey || e.metaKey;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (ct && /^[zZ]$/.test(k)) { stop(); if (sh) this.redo(); else this.undo(); return; }
      if (ct && /^[yY]$/.test(k)) { stop(); this.redo(); return; }
      if (ct && /^[cC]$/.test(k)) { stop(); this.copy(false); return; }
      if (ct && /^[xX]$/.test(k)) { stop(); this.copy(true); return; }
      if (ct && /^[vV]$/.test(k)) { stop(); this.paste(); return; }
      if (k === 'ArrowRight') { stop(); this.moveCur(0, 1); return; }
      if (k === 'ArrowLeft') { stop(); this.moveCur(0, -1); return; }
      if (k === 'ArrowDown') { stop(); this.moveCur(1, 0); return; }
      if (k === 'ArrowUp') { stop(); this.moveCur(-1, 0); return; }
      if (k === 'Delete' || k === 'Backspace') { stop(); this.put(ct ? 'delRow' : 'del'); return; }
      if (k === 'Insert') { stop(); this.put('insRow'); return; }
      if (k === 'Enter' && !ct) { stop(); this.dblEdit(); return; }
      if (k === 'F2') { stop(); this.dblEdit(); return; }
      const m = V().keymap ? V().keymap(e) : null;
      if (m) {
        stop();
        if (m.act === 'convert') this.convert();
        else if (m.act === 'ask') this.ask('', m.kind);
        else if (m.act === 'out') { this.cur = { r: this.cur.r, c: 'out' }; this.ask(m.preset); }
        else if (m.act === 'put') this.put(m.kind);
        return;
      }
      if (/^[a-zA-Z0-9=<>$]$/.test(k) && !ct && !e.altKey) { stop(); this.ask(k.toUpperCase()); }
    }
    hasContent(pt) {
      const row = this.grid.rows[pt.r];
      if (!row) return false;
      if (pt.c === 'out') return !!row.out;
      const cell = row.cells[pt.c];
      return !!(cell && (cell.k === 'E' || cell.k === 'SPAN'));
    }
    dblEdit() {
      const row = this.grid.rows[this.cur.r];
      if (!row) return;
      let c = this.cur.c;
      if (c !== 'out' && row.cells[c] && row.cells[c].k === 'SPAN') {
        while (c >= 0 && row.cells[c] && row.cells[c].k === 'SPAN') c--;
        this.cur = { r: this.cur.r, c };
      }
      const cell = this.cur.c === 'out' ? null : row.cells[this.cur.c];
      let pre = '';
      if (this.cur.c === 'out') pre = row.out || 'OUT ';
      else if (cell && cell.k === 'E') { try { pre = PLC.elemText(cell.e, V().ld || 'LD'); } catch (e) { pre = cell.e.c; } }
      this.ask(pre);
    }
    destroy() {
      if (this.ro) this.ro.disconnect();
      clearTimeout(this._rt);
      this.closeAsk();
      this.host.innerHTML = '';
      this.host.classList.remove('lv', 'fit', 'mon', 'editing', 'zoomed');
    }
  }

  // ------------------------------------------------------------------ 기호 그리기
  function contactSvg(e, x, y, w, comments) {
    const cx = x + (w * CW) / 2;
    const my = y + MID;
    const dev = e.ops[0] || '';
    const cm = comments[dev] || '';
    const g = [];
    const inv = V().inv || {};
    if (e.c === 'CMP') {
      const bw = w * CW - 18;
      g.push(`<rect class="lv-cmp" x="${cx - bw / 2}" y="${my - 13}" width="${bw}" height="26" rx="3"/>`);
      g.push(`<line class="lv-w" x1="${x}" y1="${my}" x2="${cx - bw / 2}" y2="${my}"/><line class="lv-w" x1="${cx + bw / 2}" y1="${my}" x2="${x + w * CW}" y2="${my}"/>`);
      const txt = (e.wd || '') + e.rel + ' ' + e.ops.join(' ');
      const fs = Math.max(8, Math.min(12.5, (bw - 8) / Math.max(1, txt.length) / 0.6));
      g.push(`<text class="lv-cmp-t" x="${cx}" y="${my + 5}" text-anchor="middle" font-size="${fs.toFixed(1)}">${esc(txt)}</text>`);
      return g.join('');
    }
    if (inv[e.c]) {
      g.push(`<line class="lv-w" x1="${x}" y1="${my}" x2="${x + w * CW}" y2="${my}"/>`);
      g.push(`<rect class="lv-hit" x="${cx - 12}" y="${my - 13}" width="24" height="26"/>`);
      g.push(`<text class="lv-sym" x="${cx}" y="${my - 4}" text-anchor="middle">${esc(inv[e.c].sym)}</text>`);
      g.push(`<text class="lv-dev" x="${cx}" y="${my + 17}" text-anchor="middle">${esc(inv[e.c].label)}</text>`);
      return g.join('');
    }
    g.push(`<line class="lv-w" x1="${x}" y1="${my}" x2="${cx - 9}" y2="${my}"/><line class="lv-w" x1="${cx + 9}" y1="${my}" x2="${x + w * CW}" y2="${my}"/>`);
    g.push(`<rect class="lv-hit" x="${cx - 12}" y="${my - 13}" width="24" height="26"/>`);
    g.push(`<line class="lv-bar" x1="${cx - 9}" y1="${my - 11}" x2="${cx - 9}" y2="${my + 11}"/><line class="lv-bar" x1="${cx + 9}" y1="${my - 11}" x2="${cx + 9}" y2="${my + 11}"/>`);
    if (e.c === 'NC') g.push(`<line class="lv-bar" x1="${cx - 10}" y1="${my + 11}" x2="${cx + 10}" y2="${my - 11}"/>`);
    if (e.c === 'P' || e.c === 'F') g.push(`<text class="lv-sym" x="${cx}" y="${my + 5}" text-anchor="middle">${e.c === 'P' ? '↑' : '↓'}</text>`);
    const fs = Math.max(8, Math.min(12.5, (CW - 6) / Math.max(1, dev.length) / 0.62));
    g.push(`<text class="lv-dev" x="${cx}" y="${my - 15}" text-anchor="middle" font-size="${fs.toFixed(1)}">${esc(dev)}</text>`);
    if (cm) g.push(`<text class="lv-cmt" x="${cx}" y="${my + 24}" text-anchor="middle">${esc(cm.slice(0, 9))}</text>`);
    const od = PLC.parseOperand(dev);
    if (od && !(V().isBitOperand && V().isBitOperand(od))) g.push(`<text class="lv-val" data-ops="${esc(dev)}" x="${cx}" y="${my + 23}" text-anchor="middle"></text>`);
    return g.join('');
  }
  function cellSvg(cell, x, y, w, comments) {
    if (cell.k === 'H') return `<line class="lv-w" x1="${x}" y1="${y + MID}" x2="${x + CW}" y2="${y + MID}"/>`;
    return contactSvg(cell.e, x, y, w, comments);
  }
  function outSvg(text, x, y, comments, OUTW) {
    const vd = V();
    const my = y + MID;
    const toks = PLC.tokenize(text);
    const ins = PLC.parseInstr(text);
    const op = (ins && !ins.error && ins.op ? ins.op : (toks[0] || '')).toUpperCase();
    const g = [];
    const ops = (ins && !ins.error ? ins.operands.map((o) => o.text) : toks.slice(1));
    const valOps = ops.filter((t) => (vd.valRe || /^(D|W|R|SD|Z|T|ST|C)/i).test(t)).join('|');
    const coil = vd.coilOps || { OUT: 1, SET: 1, RST: 1 };
    if (coil[op] && !(vd.isTimerOp && vd.isTimerOp(op, ops))) {
      const cx = x + OUTW / 2;
      const CHORD = 16, BULGE = 6;
      g.push(`<line class="lv-w" x1="${x}" y1="${my}" x2="${cx - CHORD - BULGE}" y2="${my}"/>`);
      g.push(`<path class="lv-coil" d="M ${cx - CHORD} ${my - 13} A 17 17 0 0 0 ${cx - CHORD} ${my + 13}"/>`);
      g.push(`<path class="lv-coil" d="M ${cx + CHORD} ${my - 13} A 17 17 0 0 1 ${cx + CHORD} ${my + 13}"/>`);
      if (op === 'OUT NOT') g.push(`<line class="lv-bar" x1="${cx - 8}" y1="${my + 10}" x2="${cx + 8}" y2="${my - 10}"/>`);
      g.push(`<line class="lv-w" x1="${cx + CHORD + BULGE}" y1="${my}" x2="${x + OUTW}" y2="${my}"/>`);
      const label = op === 'OUT' ? (ops[0] || '') : `${op} ${ops.join(' ')}`;
      const fs = Math.max(8, Math.min(12.5, (OUTW - 10) / Math.max(1, label.length) / 0.62));
      g.push(`<text class="lv-dev" x="${cx}" y="${my - 17}" text-anchor="middle" font-size="${fs.toFixed(1)}">${esc(label)}</text>`);
      const cm = comments[ops[0]] || '';
      if (cm) g.push(`<text class="lv-cmt" x="${cx}" y="${my + 25}" text-anchor="middle">${esc(cm.slice(0, 12))}</text>`);
      g.push(`<text class="lv-inv" data-dev="${esc(ops[0] || '')}" x="${cx}" y="${my + 5}" text-anchor="middle"></text>`);
      return g.join('');
    }
    const bw = Math.max(84, Math.min(OUTW - 18, 14 + text.length * 8.2));
    const fs = Math.max(8, Math.min(12.5, (bw - 10) / Math.max(1, text.length) / 0.62));
    const bx = x + OUTW - bw - 6;
    g.push(`<line class="lv-w" x1="${x}" y1="${my}" x2="${bx}" y2="${my}"/>`);
    g.push(`<rect class="lv-box" x="${bx}" y="${my - 14}" width="${bw}" height="28" rx="3"/>`);
    g.push(`<text class="lv-boxt" x="${bx + bw / 2}" y="${my + 5}" text-anchor="middle" font-size="${fs.toFixed(1)}">${esc(text)}</text>`);
    g.push(`<line class="lv-w" x1="${bx + bw}" y1="${my}" x2="${x + OUTW}" y2="${my}"/>`);
    g.push(`<text class="lv-val" data-ops="${esc(valOps)}" x="${bx + bw / 2}" y="${my + 25}" text-anchor="middle"></text>`);
    return g.join('');
  }

  PLC.LadderView = LadderView;
  PLC.growGrid = growGrid;
})(typeof window !== 'undefined' ? window : globalThis);
