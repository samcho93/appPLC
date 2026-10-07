/* 앱 아이콘 만들기 (외부 라이브러리 없이 PNG 를 직접 만든다):  node tools/make-icons.js
 *  icons/icon.svg · icon-192.png · icon-512.png · icon-512-maskable.png
 *  그림: 파란 바탕의 둥근 네모에 래더 기호 — 모선 두 줄, a 접점 ┤├, 코일 ( )
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const OUT = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// ----------------------------------------------------------------- SVG
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <g stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none">
    <path d="M14 22v56M86 22v56"/>
    <path d="M14 50h18M43 50h12M72 50h14"/>
    <path d="M32 38v24M43 38v24"/>
    <path d="M58 38a12 12 0 0 0 0 24M69 38a12 12 0 0 1 0 24"/>
  </g>
  <circle cx="26" cy="29" r="4.5" fill="#fbbf24"/>
</svg>`;
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg.trim() + '\n');

// ----------------------------------------------------------------- 래스터 (간단한 그리기)
function makePng(size, maskable) {
  const px = new Uint8ClampedArray(size * size * 4);
  const S = size / 100;                     // 100 단위 좌표계
  const pad = maskable ? 10 : 0;            // 마스커블은 안전 영역(안쪽 80%)에 그린다
  const sc = (100 - pad * 2) / 100;
  const X = (v) => (pad + v * sc) * S;
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = a / 255, oa = px[i + 3] / 255;
    const ra = na + oa * (1 - na);
    px[i] = (r * na + px[i] * oa * (1 - na)) / (ra || 1);
    px[i + 1] = (g * na + px[i + 1] * oa * (1 - na)) / (ra || 1);
    px[i + 2] = (b * na + px[i + 2] * oa * (1 - na)) / (ra || 1);
    px[i + 3] = ra * 255;
  };
  const mix = (t) => [Math.round(29 + (14 - 29) * t), Math.round(78 + (165 - 78) * t), Math.round(216 + (233 - 216) * t)];
  // 바탕: 둥근 네모 (마스커블은 네모 가득)
  const R = maskable ? 0 : 22 * S;
  const x0 = maskable ? 0 : X(0), x1 = maskable ? size : X(100);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (x < x0 || x >= x1 || y < x0 || y >= x1) continue;
    const dx = Math.max(x0 + R - x, x - (x1 - 1 - R), 0), dy = Math.max(x0 + R - y, y - (x1 - 1 - R), 0);
    const d = Math.hypot(dx, dy);
    const a = R ? Math.max(0, Math.min(1, R - d + 0.5)) : 1;
    if (a <= 0) continue;
    const [r, g, b] = mix((x + y) / (2 * size));
    put(x, y, r, g, b, a * 255);
  }
  // 선 그리기 (둥근 끝)
  const line = (ax, ay, bx, by, w, col) => {
    const hw = w * S * sc / 2;
    const minx = Math.floor(Math.min(X(ax), X(bx)) - hw - 1), maxx = Math.ceil(Math.max(X(ax), X(bx)) + hw + 1);
    const miny = Math.floor(Math.min(X(ay), X(by)) - hw - 1), maxy = Math.ceil(Math.max(X(ay), X(by)) + hw + 1);
    const Ax = X(ax), Ay = X(ay), Bx = X(bx), By = X(by);
    const L2 = (Bx - Ax) ** 2 + (By - Ay) ** 2;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      let t = L2 ? ((x - Ax) * (Bx - Ax) + (y - Ay) * (By - Ay)) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (Ax + t * (Bx - Ax)), y - (Ay + t * (By - Ay)));
      const a = Math.max(0, Math.min(1, hw - d + 0.5));
      if (a > 0) put(x, y, col[0], col[1], col[2], a * 255);
    }
  };
  const arc = (cx, cy, r, a0, a1, w, col) => {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
      line(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1), w, col);
    }
  };
  const W = [255, 255, 255];
  line(14, 22, 14, 78, 5, W); line(86, 22, 86, 78, 5, W);
  line(14, 50, 32, 50, 5, W); line(43, 50, 55, 50, 5, W); line(72, 50, 86, 50, 5, W);
  line(32, 38, 32, 62, 5, W); line(43, 38, 43, 62, 5, W);
  arc(58 + 7, 50, 13, Math.PI * 0.62, Math.PI * 1.38, 5, W);
  arc(69 - 7, 50, 13, -Math.PI * 0.38, Math.PI * 0.38, 5, W);
  // 노란 램프
  const cx = X(26), cy = X(29), rr = 4.5 * S * sc;
  for (let y = Math.floor(cy - rr - 1); y <= cy + rr + 1; y++) for (let x = Math.floor(cx - rr - 1); x <= cx + rr + 1; x++) {
    const a = Math.max(0, Math.min(1, rr - Math.hypot(x - cx, y - cy) + 0.5));
    if (a > 0) put(x, y, 251, 191, 36, a * 255);
  }
  return encodePng(size, size, px);
}

// ----------------------------------------------------------------- PNG 인코더
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.writeFileSync(path.join(OUT, 'icon-192.png'), makePng(192, false));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), makePng(512, false));
fs.writeFileSync(path.join(OUT, 'icon-512-maskable.png'), makePng(512, true));
console.log('✓ icons/icon.svg · icon-192.png · icon-512.png · icon-512-maskable.png');
