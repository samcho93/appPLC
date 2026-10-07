/* 래더 ↔ 명령어 리스트
 *  - 명령어 리스트(IL)를 회로(rung) 단위의 나무 구조로 해석 → 격자(래더 그림)로 배치
 *  - 편집한 격자를 다시 명령어 리스트로 "변환(F4)" (직렬 · 병렬 축약, MPS/MRD/MPP · ANB/ORB 자동 생성)
 *
 * 격자 모델
 *   grid.W           : 접점 열 수 (출력 열은 따로)
 *   grid.rows[r]     : { cells: [W], out: '명령어 텍스트' | null, note, label }
 *   cell             : null | { k:'H' } (가로선) | { k:'E', e:{c, ops, rel, wd}, w } (접점) | { k:'SPAN' } (넓은 접점의 나머지 칸)
 *   grid.v           : Set('r,b')  — 행 r 과 r+1 을 경계 b (1…W) 에서 잇는 세로선
 * 접점 종류 c: NO(a접점) NC(b접점) P(상승 펄스) F(하강 펄스) CMP(비교) INV MEP MEF
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};

  // ==================================================================== 요소 ↔ 명령
  const CONTACT = {
    LD: 'NO', AND: 'NO', OR: 'NO', LDI: 'NC', ANI: 'NC', ORI: 'NC',
    LDP: 'P', ANDP: 'P', ORP: 'P', LDF: 'F', ANDF: 'F', ORF: 'F'
  };
  const OPNAME = {
    NO: { LD: 'LD', AND: 'AND', OR: 'OR' }, NC: { LD: 'LDI', AND: 'ANI', OR: 'ORI' },
    P: { LD: 'LDP', AND: 'ANDP', OR: 'ORP' }, F: { LD: 'LDF', AND: 'ANDF', OR: 'ORF' }
  };
  function elemFromIns(ins) {
    if (ins.cls === 'cmp') return { c: 'CMP', rel: ins.rel, wd: ins.width, ops: ins.operands.map((o) => o.text) };
    if (CONTACT[ins.op]) return { c: CONTACT[ins.op], ops: [ins.operands[0].text] };
    if (ins.op === 'INV' || ins.op === 'MEP' || ins.op === 'MEF') return { c: ins.op, ops: [] };
    return null;
  }
  function elemText(e, pos) {
    if (e.c === 'CMP') return `${pos}${e.wd || ''}${e.rel} ${e.ops.join(' ')}`;
    if (e.c === 'INV' || e.c === 'MEP' || e.c === 'MEF') {
      if (pos !== 'AND') throw new Error(`${e.c} 는 접점 뒤(직렬)에만 둘 수 있습니다`);
      return e.c;
    }
    return `${OPNAME[e.c][pos]} ${e.ops[0]}`;
  }
  const elemWidth = (e) => (e.c === 'CMP' ? 2 : 1);
  PLC.elemFromIns = elemFromIns;
  PLC.elemText = elemText;

  // ==================================================================== 식 나무
  const E = (e) => ({ t: 'E', e });
  const H = { t: 'H' };
  function S(a, b) {
    const list = [];
    [a, b].forEach((x) => { if (!x || x.t === 'H') return; if (x.t === 'S') list.push(...x.list); else list.push(x); });
    if (!list.length) return H;
    return list.length === 1 ? list[0] : { t: 'S', list };
  }
  function Pr(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.t === 'H' || b.t === 'H') return H;
    const list = [];
    [a, b].forEach((x) => { if (x.t === 'P') list.push(...x.list); else list.push(x); });
    return { t: 'P', list };
  }

  /** 명령어 리스트 → 회로 목록 [{ root: Branch, ctl, note, label, first, steps }] */
  function toRungs(program) {
    const steps = program.steps;
    const rungs = [];
    let st = null;
    const fresh = (i) => ({ mode: 'cond', stack: [], cur: null, root: null, branch: null, mstack: [], ostack: [], ocur: null, first: i, err: null });
    const finish = (i) => {
      if (!st) return;
      if (st.mode === 'cond' && st.cur) st.err = st.err || '출력 명령이 없습니다';
      rungs.push({ root: st.root, note: steps[st.first].note, label: steps[st.first].label, first: st.first, last: i, err: st.err });
      st = null;
    };
    const enterOut = () => {
      if (st.mode === 'out') return;
      if (st.stack.length) st.err = st.err || '블록(LD)이 ANB/ORB 로 묶이지 않았습니다';
      st.root = { prefix: st.cur, items: [] };
      st.branch = st.root;
      st.mode = 'out';
    };
    const branchAnd = (x) => {
      const b = st.branch;
      if (!b.locked && !b.items.length) b.prefix = S(b.prefix, x);
      else { const nb = { prefix: x, items: [] }; b.items.push(nb); st.branch = nb; }
    };
    steps.forEach((s, i) => {
      if (s.auto) return;
      const startsNew = s.cls === 'ld' || (s.cls === 'cmp' && s.pos === 'LD');
      if (s.cls === 'ctl' || ((s.op === 'FOR' || s.op === 'RTOP') && !st)) {
        finish(i - 1);
        if (s.op !== 'NOP') rungs.push({ root: { prefix: null, items: [{ t: 'O', ins: s }] }, note: s.note, label: s.label, first: i, last: i, bare: true });
        return;
      }
      if (!st) { st = fresh(i); }
      else if (startsNew && st.mode === 'out' && !st.mstack.length && st.ocur == null && st.branch && (st.branch.items.length || st.branch.locked) && !pendingAnb(steps, i)) {
        finish(i - 1);
        st = fresh(i);
      }
      if (s.cls === 'ld' || (s.cls === 'cmp' && s.pos === 'LD')) {
        const x = E(elemFromIns(s));
        if (st.mode === 'cond') { if (st.cur) st.stack.push(st.cur); st.cur = x; }
        else { st.ostack.push(st.ocur); st.ocur = x; }
      } else if (s.cls === 'and' || (s.cls === 'cmp' && s.pos === 'AND') || s.op === 'INV' || s.op === 'MEP' || s.op === 'MEF') {
        const x = E(elemFromIns(s));
        if (st.mode === 'cond') st.cur = S(st.cur, x);
        else if (st.ocur) st.ocur = S(st.ocur, x);
        else branchAnd(x);
      } else if (s.cls === 'or' || (s.cls === 'cmp' && s.pos === 'OR')) {
        const x = E(elemFromIns(s));
        if (st.mode === 'cond') st.cur = Pr(st.cur, x);
        else if (st.ocur) st.ocur = Pr(st.ocur, x);
        else st.err = st.err || `${s.name} 는 출력 뒤에 올 수 없습니다`;
      } else if (s.op === 'ANB' || s.op === 'ORB') {
        const f = s.op === 'ANB' ? S : Pr;
        if (st.mode === 'cond') { const a = st.stack.pop(); st.cur = f(a, st.cur); }
        else {
          const a = st.ostack.pop();
          if (a == null && s.op === 'ANB') { branchAnd(st.ocur); st.ocur = null; }
          else st.ocur = f(a, st.ocur);
        }
      } else if (s.op === 'MPS') {
        enterOut();
        st.mstack.push(st.branch);
        st.branch.locked = true;
      } else if (s.op === 'MRD') {
        if (st.mstack.length) st.branch = st.mstack[st.mstack.length - 1];
      } else if (s.op === 'MPP') {
        if (st.mstack.length) st.branch = st.mstack.pop();
      } else if (s.cls === 'out' || s.cls === 'app') {
        enterOut();
        if (st.ocur) { st.err = st.err || 'LD 블록이 ANB 로 묶이지 않았습니다'; st.ocur = null; }
        st.branch.items.push({ t: 'O', ins: s });
        st.branch.locked = true;
      }
    });
    finish(steps.length - 1);
    return rungs;
  }
  /** 출력 뒤의 LD 가 새 회로의 시작인지, MPS 분기 안의 블록(뒤에 ANB)인지 */
  function pendingAnb(steps, i) {
    let depth = 0;
    for (let k = i; k < steps.length; k++) {
      const s = steps[k];
      if (s.cls === 'ld' || (s.cls === 'cmp' && s.pos === 'LD')) depth++;
      else if (s.op === 'ANB' || s.op === 'ORB') { depth--; if (depth <= 0) return s.op === 'ANB'; }
      else if (s.cls === 'out' || s.cls === 'app' || s.cls === 'ctl' || s.op === 'MPS' || s.op === 'MRD' || s.op === 'MPP') return false;
    }
    return false;
  }
  PLC.toRungs = toRungs;

  // ==================================================================== 배치 (나무 → 격자)
  function exprSize(x) {
    if (!x || x.t === 'H') return { w: 0, h: 1 };
    if (x.t === 'E') return { w: elemWidth(x.e), h: 1 };
    const ss = x.list.map(exprSize);
    if (x.t === 'S') return { w: ss.reduce((a, s) => a + s.w, 0), h: Math.max(...ss.map((s) => s.h)) };
    return { w: Math.max(...ss.map((s) => s.w)), h: ss.reduce((a, s) => a + s.h, 0) };
  }
  function branchSize(b) {
    const p = exprSize(b.prefix);
    let h = 0, w = 0;
    b.items.forEach((it) => {
      if (it.t === 'O') { h += 1; }
      else { const s = branchSize(it); h += s.h; w = Math.max(w, s.w); }
    });
    return { w: p.w + w, h: Math.max(p.h, h || 1) };
  }

  function newGrid(W) { return { W, rows: [], v: new Set() }; }
  function ensureRow(g, r) { while (g.rows.length <= r) g.rows.push({ cells: new Array(g.W).fill(null), out: null }); }
  function vlink(g, r0, r1, b) { for (let r = r0; r < r1; r++) g.v.add(`${r},${b}`); }

  /** 식을 (r, c) 에 그린다. 너비 w 에 맞춰 짧은 병렬 가지는 가로선으로 채운다 */
  function placeExpr(g, x, r, c, w) {
    if (!x || x.t === 'H') { for (let k = 0; k < w; k++) setCell(g, r, c + k, { k: 'H' }); return; }
    const sz = exprSize(x);
    if (x.t === 'E') {
      ensureRow(g, r);
      g.rows[r].cells[c] = { k: 'E', e: x.e, w: sz.w };
      for (let k = 1; k < sz.w; k++) g.rows[r].cells[c + k] = { k: 'SPAN' };
      for (let k = sz.w; k < w; k++) setCell(g, r, c + k, { k: 'H' });
      return;
    }
    if (x.t === 'S') {
      let cc = c;
      x.list.forEach((y, i) => {
        const s = exprSize(y);
        const ww = i === x.list.length - 1 ? w - (cc - c) : s.w;
        placeExpr(g, y, r, cc, ww);
        cc += s.w;
      });
      return;
    }
    // 병렬: 위에서부터 쌓고 왼쪽 · 오른쪽 경계에 세로선
    let rr = r;
    let lastTop = r;
    x.list.forEach((y) => {
      const s = exprSize(y);
      placeExpr(g, y, rr, c, w);
      lastTop = rr;
      rr += s.h;
    });
    if (c > 0) vlink(g, r, lastTop, c);
    vlink(g, r, lastTop, c + w);
  }
  function setCell(g, r, c, v) { ensureRow(g, r); if (!g.rows[r].cells[c]) g.rows[r].cells[c] = v; }

  function placeBranch(g, b, r, c) {
    const W = g.W;
    const p = exprSize(b.prefix);
    placeExpr(g, b.prefix, r, c, p.w);
    const c2 = c + p.w;
    let rr = r, lastTop = r;
    b.items.forEach((it) => {
      lastTop = rr;
      if (it.t === 'O') {
        for (let k = c2; k < W; k++) setCell(g, rr, k, { k: 'H' });
        ensureRow(g, rr);
        g.rows[rr].out = PLC.instrText(it.ins);
        rr += 1;
      } else {
        const s = branchSize(it);
        placeBranch(g, it, rr, c2);
        rr += s.h;
      }
    });
    if (b.items.length > 1) vlink(g, r, lastTop, c2 === 0 ? W : c2);
    if (c2 === 0 && b.items.length > 1) { /* 조건 없는 여러 출력: 출력 열 앞 경계에서 묶는다 */ }
    return Math.max(p.h, rr - r);
  }

  /** 프로그램 → 격자 */
  function layout(program, minW) {
    const rungs = toRungs(program);
    let W = Math.max(minW || 4, 1);
    rungs.forEach((rg) => { if (rg.root) W = Math.max(W, branchSize(rg.root).w + 1); });
    const g = newGrid(W);
    g.rungs = [];
    let r = 0;
    let step = 0;
    const stepsOf = (from, to) => { let n = 0; for (let i = from; i <= to; i++) if (program.steps[i] && !program.steps[i].auto) n += PLC.stepCount(program.steps[i]); return n; };
    rungs.forEach((rg) => {
      if (!rg.root) return;
      // 마지막 END 는 아래에서 따로 그린다
      if (rg.bare && rg.root.items[0] && rg.root.items[0].ins.op === 'END') return;
      const h = placeBranch(g, rg.root, r, 0);
      ensureRow(g, r + h - 1);
      g.rows[r].note = rg.note || '';
      g.rows[r].label = rg.label != null ? rg.label : null;
      g.rungs.push({ r0: r, r1: r + h, step, err: rg.err, first: rg.first, last: rg.last });
      step += stepsOf(rg.first, rg.last);
      r += h;
    });
    // END
    ensureRow(g, r);
    for (let k = 0; k < W; k++) g.rows[r].cells[k] = { k: 'H' };
    g.rows[r].out = 'END';
    g.rows[r].isEnd = true;
    g.rungs.push({ r0: r, r1: r + 1, step, end: true });
    return g;
  }
  PLC.layout = layout;

  // ==================================================================== 변환 (격자 → 명령어 리스트)
  class ConvertError extends Error { constructor(msg, row) { super(msg); this.row = row; } }
  PLC.ConvertError = ConvertError;

  /** 격자를 회로(연결된 행 묶음) 로 나눈다 */
  function splitRungs(g) {
    const W = g.W;
    const n = g.rows.length;
    const used = (r) => g.rows[r] && (g.rows[r].out || g.rows[r].cells.some((c) => c));
    const out = [];
    let r = 0;
    while (r < n) {
      if (!used(r) && !linked(g, r)) { r++; continue; }
      let r1 = r;
      while (r1 + 1 < n && linked(g, r1)) r1++;
      out.push({ r0: r, r1: r1 + 1 });
      r = r1 + 1;
    }
    function linked(gg, rr) { for (let b = 1; b <= W; b++) if (gg.v.has(`${rr},${b}`)) return true; return false; }
    return out;
  }

  /** 한 회로 → 나무 (직렬 · 병렬 축약) */
  function rungTree(g, r0, r1) {
    const W = g.W;
    // 마디 (r, b) 를 합집합-찾기로 묶는다. 경계 0 은 모두 왼쪽 모선.
    const id = (r, b) => (r - r0) * (W + 1) + b;
    const par = new Map();
    const find = (x) => { while (par.has(x) && par.get(x) !== x) x = par.get(x); return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par.set(Math.max(a, b), Math.min(a, b)); };
    for (let r = r0; r < r1; r++) for (let b = 0; b <= W; b++) par.set(id(r, b), id(r, b));
    for (let r = r0; r < r1; r++) uni(id(r, 0), id(r0, 0));
    g.v.forEach((k) => {
      const [r, b] = k.split(',').map(Number);
      if (r >= r0 && r + 1 < r1 && b >= 1) uni(id(r, b), id(r + 1, b));
    });
    const RAIL = find(id(r0, 0));
    let edges = [];
    const minRow = new Map();
    for (let r = r0; r < r1; r++) {
      const cells = g.rows[r].cells;
      for (let c = 0; c < W; c++) {
        const cell = cells[c];
        if (!cell || cell.k === 'SPAN') continue;
        const w = cell.k === 'E' ? (cell.w || 1) : 1;
        if (c + w > W) throw new ConvertError('접점이 출력 열을 넘어갑니다', r);
        for (let k = 1; k < w; k++) if (!cells[c + k] || cells[c + k].k !== 'SPAN') throw new ConvertError('넓은 접점(비교) 뒤 칸이 비어 있어야 합니다', r);
        const u = find(id(r, c)), v = find(id(r, c + w));
        edges.push({ u, v, x: cell.k === 'E' ? E(cell.e) : H, row: r });
      }
    }
    const outs = [];
    for (let r = r0; r < r1; r++) if (g.rows[r].out) outs.push({ node: find(id(r, W)), text: g.rows[r].out, row: r });
    if (!outs.length) throw new ConvertError('출력(코일 · 명령)이 없는 회로입니다', r0);
    const outNodes = new Set(outs.map((o) => o.node));

    // 도달 가능성 검사
    const reach = new Set([RAIL]);
    let changed = true;
    while (changed) { changed = false; edges.forEach((e) => { if (reach.has(e.u) && !reach.has(e.v)) { reach.add(e.v); changed = true; } }); }
    outs.forEach((o) => { if (!reach.has(o.node) && o.node !== RAIL) throw new ConvertError(`출력 ${o.text} 까지 이어지지 않았습니다`, o.row); });
    edges.forEach((e) => { if (!reach.has(e.u)) throw new ConvertError('왼쪽 모선에 연결되지 않은 접점이 있습니다', e.row); });

    // 축약 반복
    edges.forEach((e) => { e.minRow = e.row; });
    let guard = 0;
    for (;;) {
      if (++guard > 5000) throw new ConvertError('변환할 수 없는 회로입니다', r0);
      // 끝이 막힌 가지 (출력으로 가지 않는 접점)
      const outDeg = new Map(), inDeg = new Map();
      edges.forEach((e) => { outDeg.set(e.u, (outDeg.get(e.u) || 0) + 1); inDeg.set(e.v, (inDeg.get(e.v) || 0) + 1); });
      const dead = edges.find((e) => !outNodes.has(e.v) && !outDeg.get(e.v) && e.v !== RAIL);
      if (dead) {
        if (dead.x.t === 'H' && dead.v !== RAIL) { edges = edges.filter((e) => e !== dead); continue; }
        throw new ConvertError('출력으로 이어지지 않는 접점이 있습니다', dead.row);
      }
      // 병렬 합치기
      let merged = false;
      for (let i = 0; i < edges.length && !merged; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          if (edges[i].u === edges[j].u && edges[i].v === edges[j].v) {
            const [a, b] = edges[i].minRow <= edges[j].minRow ? [edges[i], edges[j]] : [edges[j], edges[i]];
            const ne = { u: a.u, v: a.v, x: Pr(a.x, b.x), row: a.row, minRow: Math.min(a.minRow, b.minRow) };
            edges = edges.filter((e) => e !== edges[i] && e !== edges[j]);
            edges.push(ne);
            merged = true;
            break;
          }
        }
      }
      if (merged) continue;
      // 직렬 합치기: 들어오는 선 1개 · 나가는 선 1개 · 출력 없는 마디
      let ser = false;
      for (const [node, din] of inDeg) {
        if (node === RAIL || outNodes.has(node) || din !== 1 || outDeg.get(node) !== 1) continue;
        const a = edges.find((e) => e.v === node);
        const b = edges.find((e) => e.u === node);
        if (a.u === b.v) continue;
        const ne = { u: a.u, v: b.v, x: S(a.x, b.x), row: a.row, minRow: Math.min(a.minRow, b.minRow) };
        edges = edges.filter((e) => e !== a && e !== b);
        edges.push(ne);
        ser = true;
        break;
      }
      if (!ser) break;
    }
    // 나무인지 확인
    const inCount = new Map();
    edges.forEach((e) => inCount.set(e.v, (inCount.get(e.v) || 0) + 1));
    for (const [node, n] of inCount) {
      if (n > 1) {
        const e = edges.find((x) => x.v === node);
        throw new ConvertError('변환할 수 없는 회로입니다 (갈라진 선이 다시 합쳐지는 브리지 모양 — 회로를 나누어 그리세요)', e.row);
      }
    }
    // 나무 → 분기 구조
    const build = (node) => {
      const items = [];
      outs.filter((o) => o.node === node).forEach((o) => items.push({ t: 'O', text: o.text, row: o.row }));
      edges.filter((e) => e.u === node).forEach((e) => {
        const sub = build(e.v);
        items.push({ t: 'B', prefix: e.x, items: sub, row: e.minRow });
      });
      items.sort((a, b) => a.row - b.row);
      return items;
    };
    const items = build(RAIL);
    if (items.length === 1 && items[0].t === 'B') return { prefix: items[0].prefix, items: items[0].items, row: r0 };
    return { prefix: H, items, row: r0 };
  }

  // ---- 나무 → 명령어
  function genLoad(x, out) {
    if (x.t === 'E') { out.push(elemText(x.e, 'LD')); return; }
    if (x.t === 'S') { genLoad(x.list[0], out); x.list.slice(1).forEach((y) => genAnd(y, out)); return; }
    if (x.t === 'P') { genLoad(x.list[0], out); x.list.slice(1).forEach((y) => genOr(y, out)); return; }
    out.push('LD SM400');
  }
  function genAnd(x, out) {
    if (x.t === 'H') return;
    if (x.t === 'E') { out.push(elemText(x.e, 'AND')); return; }
    if (x.t === 'S') { x.list.forEach((y) => genAnd(y, out)); return; }
    genLoad(x, out); out.push('ANB');
  }
  function genOr(x, out) {
    if (x.t === 'E') { out.push(elemText(x.e, 'OR')); return; }
    if (x.t === 'P') { x.list.forEach((y) => genOr(y, out)); return; }
    if (x.t === 'H') { out.push('OR SM400'); return; }
    genLoad(x, out); out.push('ORB');
  }
  /** 가지가 연산 결과를 바꾸는가 (접점이 있는 가지) — 바꾸지 않으면 MPS 없이 출력만 이어 쓴다 */
  function modifies(it) { return it.t === 'B' && ((it.prefix && it.prefix.t !== 'H') || it.items.some(modifies)); }
  function genItems(items, out) {
    const n = items.length;
    const need = items.map((it, k) => k < n - 1 && modifies(it));
    let pushed = false, dirty = false;
    items.forEach((it, k) => {
      if (dirty) {
        let again = false;
        for (let j = k; j < n - 1; j++) if (need[j]) again = true;
        if (again) out.push('MRD'); else { out.push('MPP'); pushed = false; }
        dirty = false;
      }
      if (it.t === 'O') { out.push(it.text); return; }
      if (need[k] && !pushed) { out.push('MPS'); pushed = true; }
      genAnd(it.prefix, out);
      genItems(it.items, out);
      if (need[k]) dirty = true;
    });
  }
  const BARE = /^(END|FEND|RET|NEXT|MCR|FOR|NOP|BREAK|RTOP)\b/i;

  /** 격자 → 명령어 리스트 텍스트 (오류 시 ConvertError) */
  function gridToIL(g, comments) {
    const lines = [];
    if (comments) Object.keys(comments).forEach((k) => lines.push(`@${k} ${comments[k]}`));
    const rungs = splitRungs(g);
    rungs.forEach(({ r0, r1 }) => {
      const rowMeta = g.rows[r0];
      if (rowMeta.isEnd) return;
      const allOuts = [];
      for (let r = r0; r < r1; r++) if (g.rows[r].out) allOuts.push(g.rows[r].out);
      if (allOuts.length === 1 && /^END$/i.test(allOuts[0].trim()) && g.rows.slice(r0, r1).every((row) => row.cells.every((c) => !c || c.k === 'H'))) return;
      const tree = rungTree(g, r0, r1);
      if (rowMeta.note) rowMeta.note.split('\n').forEach((t) => lines.push('; ' + t));
      if (rowMeta.label != null) lines.push(`P${rowMeta.label}`);
      // 출력 명령 검사
      for (let r = r0; r < r1; r++) {
        const t = g.rows[r].out;
        if (!t) continue;
        const ins = PLC.parseInstr(t);
        if (!ins || ins.error) throw new ConvertError(`${t}: ${ins ? ins.error : '명령이 비어 있습니다'}`, r);
        if (ins.cls === 'ld' || ins.cls === 'and' || ins.cls === 'or' || ins.cls === 'cmp' || ins.cls === 'blk') throw new ConvertError(`${t}: 출력 열에는 접점을 둘 수 없습니다`, r);
      }
      const out = [];
      const noCond = !tree.prefix || tree.prefix.t === 'H';
      if (noCond && tree.items.every((it) => it.t === 'O' && BARE.test(it.text))) {
        tree.items.forEach((it) => out.push(it.text));
      } else {
        genLoad(tree.prefix && tree.prefix.t !== 'H' ? tree.prefix : H, out);
        genItems(tree.items, out);
      }
      lines.push(...out);
      lines.push('');
    });
    lines.push('END');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  PLC.gridToIL = gridToIL;
  PLC.splitRungs = splitRungs;

  /** 명령어 리스트 → 보기 좋게 다시 쓰기 (회로 사이 빈 줄) */
  function formatIL(program) {
    const lines = [];
    Object.keys(program.comments || {}).forEach((k) => lines.push(`@${k} ${program.comments[k]}`));
    const rungs = toRungs(program);
    rungs.forEach((rg) => {
      for (let i = rg.first; i <= rg.last; i++) {
        const s = program.steps[i];
        if (!s || s.auto) continue;
        if (s.note) s.note.split('\n').forEach((t) => lines.push('; ' + t));
        if (s.label != null) lines.push(`P${s.label}`);
        lines.push(PLC.instrText(s));
      }
      lines.push('');
    });
    if (!program.steps.length || program.steps[program.steps.length - 1].auto) lines.push('END');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  PLC.formatIL = formatIL;

  /** 격자 복사 */
  PLC.cloneGrid = function (g) {
    return {
      W: g.W, v: new Set(g.v), rungs: g.rungs,
      rows: g.rows.map((r) => ({ cells: r.cells.map((c) => (c ? Object.assign({}, c, c.e ? { e: Object.assign({}, c.e, { ops: c.e.ops.slice() }) } : {}) : null)), out: r.out, note: r.note, label: r.label, isEnd: r.isEnd }))
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
