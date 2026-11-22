// THE WORLD IN ONE DAY — Saturday 21 November 2026.
// A broadsheet front page drawn entirely in code (Node 22, standard library only).
// No network, no fonts on disk, no images: every letter and picture is drawn
// by the stroke font and shape routines below. Deterministic output.
//
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Writes $MAKEFUN_OUTPUT_DIR/entry.png (1024x1024, deterministic bytes).

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ canvas
const W = 1024, H = 1024;
const PAPER = [247, 240, 218];   // cream newsprint
const INK = [26, 26, 26];        // near-black
const RED = [166, 30, 34];       // masthead red
const BLUE = [30, 58, 92];       // map navy
const GREY = [90, 86, 76];       // captions
const LIGHT = [232, 222, 196];   // panel tint

class Img {
  constructor() { this.buf = Buffer.alloc(W * H * 3); }
  set(x, y, c) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
  }
  fill(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * W + x0) * 3;
      for (let xx = x0; xx < x1; xx++, i += 3) {
        this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
      }
    }
  }
  disc(cx, cy, r, c) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) this.set(x, y, c);
    }
  }
  // thick polyline: discs along each segment, radius = w/2
  polyline(pts, w, c) {
    const r = Math.max(0.6, w / 2);
    for (let s = 0; s + 1 < pts.length; s++) {
      const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(len));
      for (let i = 0; i <= steps; i++) {
        this.disc(x0 + (dx * i) / steps, y0 + (dy * i) / steps, r, c);
      }
    }
  }
  // filled polygon (scanline)
  poly(pts, c) {
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.fill(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]) + 1, 1, c);
      }
    }
  }
  circle(cx, cy, r, c) { this.disc(cx, cy, r, c); }
  ring(cx, cy, r, w, c) {
    for (let a = 0; a < 360; a += 2) {
      const t = (a * Math.PI) / 180;
      this.disc(cx + r * Math.cos(t), cy + r * Math.sin(t), w / 2, c);
    }
  }
}

// ------------------------------------------------------------- stroke font
// One single-stroke font, drawn fresh here. Grid: x 0..10, y 0..16.
// Cap letters run y=3..13, x-height letters y=6..13, descenders to y=16.
// Each glyph: strokes separated by ';', points as "x,y" pairs separated by ' '.
// Advance is computed from the glyph's widest x (narrow letters advance less).
const GLYPHS = {
  A: '1,13 5,3 9,13;3,9 7,9',
  B: '2,13 2,3 7,3 9,5 9,7 7,8;7,8 9,10 9,12 7,13 2,13',
  C: '9,4 7,3 4,3 2,5 2,11 4,13 7,13 9,12',
  D: '2,13 2,3 6,3 9,6 9,10 6,13 2,13',
  E: '9,3 2,3 2,13 9,13;2,8 7,8',
  F: '2,13 2,3 9,3;2,8 7,8',
  G: '9,4 7,3 4,3 2,5 2,11 4,13 7,13 9,11 9,8 6,8',
  H: '2,3 2,13;8,3 8,13;2,8 8,8',
  I: '5,3 5,13;3,3 7,3;3,13 7,13',
  J: '7,3 7,12 5,13 3,13 2,11',
  K: '2,3 2,13;8,3 2,8 8,13',
  L: '2,3 2,13 9,13',
  M: '2,13 2,3 5,8 8,3 8,13',
  N: '2,13 2,3 8,13 8,3',
  O: '3,4 5,3 7,3 8,5 8,11 7,13 3,13 2,11 2,5 3,4',
  P: '2,13 2,3 7,3 9,5 9,8 7,9 2,9',
  Q: '3,4 5,3 7,3 8,5 8,11 7,13 3,13 2,11 2,5 3,4;6,11 9,14',
  R: '2,13 2,3 7,3 9,5 9,8 7,9 2,9;6,9 9,13',
  S: '8,4 7,3 4,3 2,5 2,7 8,9 8,11 6,13 3,13 2,12',
  T: '1,3 9,3;5,3 5,13',
  U: '2,3 2,11 3,13 7,13 8,11 8,3',
  V: '1,3 5,13 9,3',
  W: '1,3 3,13 5,8 7,13 9,3',
  X: '2,3 8,13;8,3 2,13',
  Y: '2,3 5,8 8,3;5,8 5,13',
  Z: '2,3 8,3 2,13 8,13',
  a: '3,7 5,6 7,6 8,7 8,11 7,13 3,13 2,11 2,7 3,6;8,6 8,13',
  b: '2,3 2,13;2,8 6,6 8,8 8,11 6,13 2,13',
  c: '8,7 7,6 4,6 2,8 2,11 4,13 7,13 8,12',
  d: '8,3 8,13;8,8 4,6 2,8 2,11 4,13 8,13',
  e: '8,11 7,13 3,13 2,11 2,8 3,6 7,6 8,7 8,9 2,9',
  f: '7,3 4,3 3,5 3,13;3,8 7,8',
  g: '3,7 5,6 7,6 8,7 8,11 7,13 3,13 2,11 2,7 3,6;8,10 8,15 6,16 3,16 2,15',
  h: '2,3 2,13;2,8 4,6 6,6 8,8 8,13',
  i: '5,6 5,13;5,3 5,4',
  j: '7,6 7,15 5,16 3,16 2,15;7,3 7,4',
  k: '2,3 2,13;7,6 2,9 7,13',
  l: '5,3 5,13',
  m: '2,13 2,6;2,7 4,6 5,7 5,13;5,7 7,6 8,7 8,13',
  n: '2,13 2,6;2,7 4,6 6,6 8,8 8,13',
  o: '3,7 5,6 7,6 8,7 8,11 7,13 3,13 2,11 2,7 3,6',
  p: '2,6 2,16;2,8 6,6 8,8 8,11 6,13 2,13',
  q: '8,6 8,16;8,8 4,6 2,8 2,11 4,13 8,13',
  r: '2,13 2,6;2,7 4,6 7,6',
  s: '7,7 6,6 3,6 2,7 2,9 8,10 8,12 6,13 3,13 2,12',
  t: '5,3 5,13 7,13 8,12;3,8 7,8',
  u: '2,6 2,11 3,13 7,13 8,11 8,6',
  v: '2,6 5,13 8,6',
  w: '2,6 3,13 5,9 7,13 8,6',
  x: '2,6 8,13;8,6 2,13',
  y: '2,6 5,13 8,6;5,13 5,15 3,16',
  z: '2,6 8,6 2,13 8,13',
  '0': '3,4 5,3 7,3 8,5 8,11 7,13 3,13 2,11 2,5 3,4',
  '1': '4,5 6,3 6,13;3,13 8,13',
  '2': '2,5 3,3 7,3 8,5 8,7 2,13 8,13',
  '3': '2,4 4,3 7,3 8,5 8,7 6,8;6,8 8,10 8,12 6,13 3,13 2,12',
  '4': '7,3 2,9 8,9;7,3 7,13',
  '5': '8,3 2,3 2,7 7,7 8,9 8,12 6,13 3,13 2,12',
  '6': '8,5 6,3 3,3 2,5 2,10 3,13 7,13 8,11 8,8 7,6 3,6',
  '7': '2,3 8,3 4,13',
  '8': '2,5 3,3 7,3 8,5 8,7 7,8 3,8;3,8 2,10 2,12 4,13 6,13 8,12 8,10 7,8',
  '9': '2,11 3,13 6,13 8,11 8,6 7,3 3,3 2,5 2,8 3,10 7,10 8,9',
  '.': '5,12 5,13',
  ',': '5,12 5,13 4,15',
  ':': '5,6 5,7;5,11 5,12',
  ';': '5,6 5,7;5,11 5,12 4,15',
  "'": '6,3 5,6',
  '"': '4,3 4,5;7,3 7,5',
  '!': '5,3 5,10;5,12 5,13',
  '?': '3,5 3,4 5,3 7,3 8,5 8,6 5,9 5,10;5,12 5,13',
  '-': '2,9 8,9',
  '(': '6,3 4,6 4,10 6,13',
  ')': '4,3 6,6 6,10 4,13',
  '/': '8,3 2,13',
  '%': '8,3 2,13;2,4 4,4 4,6 2,6 2,4;6,10 8,10 8,12 6,12 6,10',
  $: '5,2 5,15;8,4 7,3 3,3 2,5 2,7 8,9 8,11 6,13 3,13 2,12',
  '+': '5,5 5,11;2,8 8,8',
  '=': '2,7 8,7;2,11 8,11',
  '*': '5,4 5,12;2,6 8,10;8,6 2,10',
  '#': '4,3 4,13;7,3 7,13;2,6 9,6;2,10 9,10',
  '|': '5,3 5,13',
};
// Parse glyph table once: glyph -> { strokes: number[][][], adv: number }
const FONT = {};
for (const [ch, def] of Object.entries(GLYPHS)) {
  const strokes = def.split(';').map((s) =>
    s.trim().split(/\s+/).map((p) => p.split(',').map(Number)),
  );
  let maxX = 0;
  for (const st of strokes) for (const [x] of st) maxX = Math.max(maxX, x);
  const narrow = '.,:;\'"!|'.includes(ch);
  FONT[ch] = { strokes, adv: narrow ? 6 : Math.min(12, Math.max(7, maxX + 3)) };
}
FONT[' '] = { strokes: [], adv: 6 };

// Draw one glyph at (x, baselineY) with cap-height scale s, stroke width w.
// shear>0 slants right (italic): x shifts by (baselineY - y) * shear.
function drawGlyph(img, ch, x, baseY, s, w, c, shear = 0) {
  const g = FONT[ch];
  if (!g) return x + 6 * s;
  for (const st of g.strokes) {
    const pts = st.map(([gx, gy]) => {
      const y = baseY + (gy - 13) * s;
      return [x + gx * s + (baseY - y) * shear, y];
    });
    img.polyline(pts, w, c);
  }
  return x + g.adv * s;
}
function textWidth(str, s) {
  let w = 0;
  for (const ch of str) w += (FONT[ch] ? FONT[ch].adv : 6) * s;
  return w;
}
// Draw text; align: 'l' | 'c' | 'r' within x..x+maxW. Returns end x.
function drawText(img, str, x, baseY, s, w, c, align = 'l', maxW = 0, shear = 0) {
  const tw = textWidth(str, s);
  let cx = x;
  if (align === 'c') cx = x + (maxW - tw) / 2;
  if (align === 'r') cx = x + maxW - tw;
  for (const ch of str) cx = drawGlyph(img, ch, cx, baseY, s, w, c, shear);
  return cx;
}
// Word-wrap into lines that fit maxW at scale s.
function wrap(str, s, maxW) {
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const wd of words) {
    const test = cur ? cur + ' ' + wd : wd;
    if (textWidth(test, s) <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// Draw a wrapped paragraph; returns the y just below the last line's baseline.
function drawPara(img, str, x, baseY, s, w, c, maxW, lh, align = 'l', shear = 0) {
  let y = baseY;
  for (const line of wrap(str, s, maxW)) {
    drawText(img, line, x, y, s, w, c, align, maxW, shear);
    y += lh;
  }
  return y;
}

// ------------------------------------------------------- flat illustrations
// Every scene is drawn with plain shapes into a box (x,y,w,h).
// Colours are flat and limited; no gradients, no imported art.
const SKY = [176, 208, 224];
const SKY2 = [240, 196, 120];
const SEA = [64, 110, 150];
const GREEN = [96, 140, 80];
const BROWN = [150, 108, 72];
const ORANGE = [224, 120, 40];
const YELLOW = [240, 200, 60];
const DARK = [48, 48, 48];

function sceneCOP31(g, x, y, w, h) {
  g.fill(x, y, w, h, [214, 196, 150]);
  g.fill(x, y, w, h * 0.55, SKY);
  g.circle(x + w * 0.82, y + h * 0.22, h * 0.16, YELLOW);
  // conference table with flags
  g.fill(x + w * 0.08, y + h * 0.62, w * 0.84, h * 0.1, [120, 70, 40]);
  for (let i = 0; i < 5; i++) {
    const fx = x + w * (0.14 + i * 0.17);
    g.fill(fx, y + h * 0.3, 2, h * 0.32, INK);
    g.poly([[fx, y + h * 0.3], [fx + w * 0.07, y + h * 0.36], [fx, y + h * 0.42]], [RED, [40, 90, 160], GREEN, YELLOW, [120, 60, 140]][i]);
  }
  for (let i = 0; i < 5; i++) {
    const px = x + w * (0.14 + i * 0.17);
    g.circle(px + 3, y + h * 0.56, h * 0.05, DARK);
    g.fill(px - 2, y + h * 0.6, 10, h * 0.04, DARK);
  }
}
function sceneRiyadh(g, x, y, w, h) {
  g.fill(x, y, w, h, [16, 24, 44]);
  for (let i = 0; i < 12; i++) g.disc(x + w * ((i * 0.37) % 1), y + h * ((i * 0.53) % 0.4), 1.2, [255, 255, 255]);
  // skyline
  const bw = w / 7;
  for (let i = 0; i < 7; i++) {
    const bh = h * (0.3 + ((i * 0.29) % 0.35));
    g.fill(x + i * bw + 2, y + h - bh, bw - 4, bh, [40, 52, 78]);
    g.fill(x + i * bw + bw * 0.4, y + h - bh - h * 0.08, 3, h * 0.08, [40, 52, 78]);
  }
  // three missile trails rising, bursting
  for (let i = 0; i < 3; i++) {
    const mx = x + w * (0.22 + i * 0.28);
    g.polyline([[mx, y + h * 0.95], [mx + w * 0.03, y + h * 0.5]], 2, [255, 220, 120]);
    g.disc(mx + w * 0.03, y + h * 0.45, h * 0.09, ORANGE);
    g.disc(mx + w * 0.03, y + h * 0.45, h * 0.05, YELLOW);
  }
}
function scenePeru(g, x, y, w, h) {
  g.fill(x, y, w, h, SKY);
  g.poly([[x, y + h], [x + w * 0.3, y + h * 0.15], [x + w * 0.55, y + h], [x, y + h]], [120, 130, 140]);
  g.poly([[x + w * 0.4, y + h], [x + w * 0.68, y + h * 0.08], [x + w, y + h], [x + w * 0.4, y + h]], [90, 100, 112]);
  g.poly([[x + w * 0.3, y + h * 0.15], [x + w * 0.24, y + h * 0.3], [x + w * 0.36, y + h * 0.3]], [255, 255, 255]);
  // cracked ground + houses
  g.fill(x, y + h * 0.78, w, h * 0.22, [196, 170, 120]);
  g.polyline([[x + w * 0.2, y + h * 0.78], [x + w * 0.3, y + h * 0.88], [x + w * 0.25, y + h]], 2, DARK);
  g.polyline([[x + w * 0.6, y + h * 0.78], [x + w * 0.55, y + h * 0.9], [x + w * 0.65, y + h]], 2, DARK);
  g.fill(x + w * 0.7, y + h * 0.66, w * 0.16, h * 0.14, [200, 90, 60]);
  g.poly([[x + w * 0.68, y + h * 0.66], [x + w * 0.78, y + h * 0.56], [x + w * 0.88, y + h * 0.66]], [140, 50, 40]);
}
function sceneBepi(g, x, y, w, h) {
  g.fill(x, y, w, h, [12, 16, 30]);
  for (let i = 0; i < 10; i++) g.disc(x + w * ((i * 0.41) % 1), y + h * ((i * 0.29) % 0.9), 1, [255, 255, 255]);
  g.circle(x + w * 0.3, y + h * 0.55, h * 0.34, [200, 170, 120]);
  g.disc(x + w * 0.24, y + h * 0.45, h * 0.05, [160, 130, 90]);
  g.disc(x + w * 0.36, y + h * 0.62, h * 0.07, [160, 130, 90]);
  g.disc(x + w * 0.28, y + h * 0.68, h * 0.04, [160, 130, 90]);
  // spacecraft: body + panels + dish
  g.fill(x + w * 0.62, y + h * 0.42, w * 0.1, h * 0.22, [200, 200, 205]);
  g.fill(x + w * 0.56, y + h * 0.48, w * 0.06, h * 0.1, [60, 90, 180]);
  g.fill(x + w * 0.72, y + h * 0.48, w * 0.06, h * 0.1, [60, 90, 180]);
  g.polyline([[x + w * 0.67, y + h * 0.42], [x + w * 0.72, y + h * 0.3]], 2, [200, 200, 205]);
  g.disc(x + w * 0.72, y + h * 0.3, h * 0.05, [220, 220, 220]);
}
function sceneKryvyi(g, x, y, w, h) {
  g.fill(x, y, w, h, [210, 180, 140]);
  g.fill(x + w * 0.08, y + h * 0.3, w * 0.2, h * 0.7, [120, 110, 100]);
  g.fill(x + w * 0.36, y + h * 0.2, w * 0.2, h * 0.8, [100, 92, 86]);
  g.fill(x + w * 0.64, y + h * 0.38, w * 0.24, h * 0.62, [130, 118, 108]);
  for (let i = 0; i < 4; i++) g.fill(x + w * (0.12 + i * 0.2), y + h * 0.4, w * 0.05, h * 0.08, [255, 230, 120]);
  // blast + smoke
  g.disc(x + w * 0.5, y + h * 0.3, h * 0.16, ORANGE);
  g.disc(x + w * 0.5, y + h * 0.3, h * 0.09, YELLOW);
  g.disc(x + w * 0.42, y + h * 0.18, h * 0.1, [90, 90, 90]);
  g.disc(x + w * 0.58, y + h * 0.14, h * 0.08, [110, 110, 110]);
}
function sceneFire(g, x, y, w, h) {
  g.fill(x, y, w, h, [220, 200, 160]);
  g.fill(x + w * 0.1, y + h * 0.45, w * 0.8, h * 0.55, [150, 120, 90]);
  g.fill(x + w * 0.1, y + h * 0.45, w * 0.8, h * 0.08, [110, 80, 60]);
  for (let i = 0; i < 4; i++) g.fill(x + w * (0.16 + i * 0.2), y + h * 0.6, w * 0.08, h * 0.14, [60, 50, 40]);
  // flames
  for (let i = 0; i < 3; i++) {
    const fx = x + w * (0.28 + i * 0.22);
    g.poly([[fx - w * 0.07, y + h * 0.48], [fx, y + h * 0.08], [fx + w * 0.07, y + h * 0.48]], ORANGE);
    g.poly([[fx - w * 0.035, y + h * 0.48], [fx, y + h * 0.26], [fx + w * 0.035, y + h * 0.48]], YELLOW);
  }
  g.disc(x + w * 0.85, y + h * 0.2, h * 0.12, [100, 100, 100]);
}
function sceneTimor(g, x, y, w, h) {
  g.fill(x, y, w, h, SKY);
  g.fill(x, y + h * 0.55, w, h * 0.45, SEA);
  for (let i = 0; i < 3; i++) {
    g.polyline([[x, y + h * (0.62 + i * 0.12)], [x + w * 0.25, y + h * (0.58 + i * 0.12)], [x + w * 0.5, y + h * (0.64 + i * 0.12)], [x + w * 0.75, y + h * (0.58 + i * 0.12)], [x + w, y + h * (0.63 + i * 0.12)]], 2, [255, 255, 255]);
  }
  // crack through the sea floor
  g.polyline([[x + w * 0.45, y + h * 0.55], [x + w * 0.5, y + h * 0.7], [x + w * 0.44, y + h * 0.85], [x + w * 0.52, y + h]], 2, [20, 30, 40]);
  g.disc(x + w * 0.5, y + h * 0.3, h * 0.1, YELLOW);
  g.ring(x + w * 0.5, y + h * 0.3, h * 0.16, 2, [255, 255, 255]);
}
function sceneGaza(g, x, y, w, h) {
  g.fill(x, y, w, h, [228, 210, 170]);
  g.circle(x + w * 0.82, y + h * 0.2, h * 0.14, YELLOW);
  g.fill(x, y + h * 0.72, w, h * 0.28, [140, 120, 90]);
  // van
  g.fill(x + w * 0.16, y + h * 0.42, w * 0.5, h * 0.3, [240, 240, 235]);
  g.fill(x + w * 0.56, y + h * 0.48, w * 0.14, h * 0.24, [200, 200, 195]);
  g.poly([[x + w * 0.56, y + h * 0.48], [x + w * 0.64, y + h * 0.42], [x + w * 0.7, y + h * 0.42], [x + w * 0.7, y + h * 0.48]], [180, 200, 220]);
  g.disc(x + w * 0.26, y + h * 0.74, h * 0.07, DARK);
  g.disc(x + w * 0.58, y + h * 0.74, h * 0.07, DARK);
  g.polyline([[x + w * 0.7, y + h * 0.4], [x + w * 0.8, y + h * 0.3]], 2, [120, 120, 120]);
}
function sceneBahrain(g, x, y, w, h) {
  g.fill(x, y, w, h, [30, 34, 52]);
  for (let i = 0; i < 8; i++) g.disc(x + w * ((i * 0.43) % 1), y + h * ((i * 0.31) % 0.4), 1, [255, 255, 255]);
  // refinery towers + radar
  for (let i = 0; i < 3; i++) g.fill(x + w * (0.12 + i * 0.2), y + h * (0.45 - i * 0.08), w * 0.08, h * (0.55 + i * 0.08), [90, 100, 120]);
  g.polyline([[x + w * 0.72, y + h * 0.85], [x + w * 0.78, y + h * 0.35]], 2, [200, 200, 200]);
  g.poly([[x + w * 0.72, y + h * 0.32], [x + w * 0.86, y + h * 0.28], [x + w * 0.8, y + h * 0.44]], [200, 200, 200]);
  g.disc(x + w * 0.4, y + h * 0.3, h * 0.1, ORANGE);
  g.disc(x + w * 0.4, y + h * 0.3, h * 0.05, YELLOW);
  g.fill(x, y + h * 0.85, w, h * 0.15, [20, 24, 36]);
}
function sceneBorders(g, x, y, w, h) {
  g.fill(x, y, w, h, [200, 214, 190]);
  // rough Europe outline
  g.poly([[x + w * 0.1, y + h * 0.7], [x + w * 0.15, y + h * 0.35], [x + w * 0.35, y + h * 0.15], [x + w * 0.6, y + h * 0.2], [x + w * 0.85, y + h * 0.3], [x + w * 0.9, y + h * 0.55], [x + w * 0.7, y + h * 0.8], [x + w * 0.4, y + h * 0.9], [x + w * 0.2, y + h * 0.85]], [150, 180, 140]);
  // drone + helicopter
  g.fill(x + w * 0.2, y + h * 0.3, w * 0.18, h * 0.06, DARK);
  g.fill(x + w * 0.26, y + h * 0.24, w * 0.06, h * 0.06, DARK);
  g.polyline([[x + w * 0.55, y + h * 0.55], [x + w * 0.62, y + h * 0.5], [x + w * 0.78, y + h * 0.5]], 2, DARK);
  g.disc(x + w * 0.8, y + h * 0.52, h * 0.06, DARK);
  g.polyline([[x + w * 0.55, y + h * 0.5], [x + w * 0.52, y + h * 0.62]], 2, DARK);
}
function sceneWhiteHouse(g, x, y, w, h) {
  g.fill(x, y, w, h, SKY);
  g.fill(x, y + h * 0.8, w, h * 0.2, GREEN);
  // white house block
  g.fill(x + w * 0.2, y + h * 0.35, w * 0.6, h * 0.45, [245, 245, 240]);
  g.poly([[x + w * 0.16, y + h * 0.35], [x + w * 0.5, y + h * 0.18], [x + w * 0.84, y + h * 0.35]], [220, 220, 215]);
  for (let i = 0; i < 4; i++) g.fill(x + w * (0.26 + i * 0.14), y + h * 0.42, w * 0.05, h * 0.38, [200, 200, 195]);
  g.fill(x + w * 0.46, y + h * 0.6, w * 0.08, h * 0.2, [90, 60, 40]);
  // flag
  g.fill(x + w * 0.5, y + h * 0.05, 2, h * 0.14, INK);
  g.fill(x + w * 0.5, y + h * 0.05, w * 0.12, h * 0.09, RED);
}
function sceneSparta(g, x, y, w, h) {
  g.fill(x, y, w, h, SKY);
  g.fill(x, y + h * 0.6, w, h * 0.4, SEA);
  for (let i = 0; i < 3; i++) g.polyline([[x, y + h * (0.66 + i * 0.1)], [x + w * 0.3, y + h * (0.63 + i * 0.1)], [x + w * 0.6, y + h * (0.67 + i * 0.1)], [x + w, y + h * (0.64 + i * 0.1)]], 2, [255, 255, 255]);
  // cargo ship
  g.poly([[x + w * 0.12, y + h * 0.62], [x + w * 0.88, y + h * 0.62], [x + w * 0.8, y + h * 0.78], [x + w * 0.2, y + h * 0.78]], [120, 60, 50]);
  g.fill(x + w * 0.2, y + h * 0.5, w * 0.5, h * 0.12, [200, 190, 170]);
  g.fill(x + w * 0.72, y + h * 0.42, w * 0.05, h * 0.2, [90, 90, 90]);
  g.poly([[x + w * 0.45, y + h * 0.5], [x + w * 0.5, y + h * 0.25], [x + w * 0.55, y + h * 0.5]], ORANGE);
  g.disc(x + w * 0.5, y + h * 0.2, h * 0.08, [90, 90, 90]);
}
function sceneDavao(g, x, y, w, h) {
  g.fill(x, y, w, h, [210, 225, 235]);
  g.fill(x, y + h * 0.7, w, h * 0.3, [110, 110, 110]);
  g.fill(x, y + h * 0.7, w, 2, [255, 255, 255]);
  // plane
  g.poly([[x + w * 0.15, y + h * 0.55], [x + w * 0.85, y + h * 0.55], [x + w * 0.92, y + h * 0.6], [x + w * 0.15, y + h * 0.62]], [240, 240, 240]);
  g.poly([[x + w * 0.82, y + h * 0.55], [x + w * 0.9, y + h * 0.4], [x + w * 0.94, y + h * 0.4], [x + w * 0.88, y + h * 0.55]], [200, 30, 40]);
  g.poly([[x + w * 0.4, y + h * 0.55], [x + w * 0.5, y + h * 0.42], [x + w * 0.58, y + h * 0.55]], [200, 200, 200]);
  // slides
  g.polyline([[x + w * 0.3, y + h * 0.62], [x + w * 0.24, y + h * 0.72]], 3, YELLOW);
  g.polyline([[x + w * 0.6, y + h * 0.62], [x + w * 0.66, y + h * 0.72]], 3, YELLOW);
  g.disc(x + w * 0.85, y + h * 0.2, h * 0.1, [255, 200, 60]);
}

// ------------------------------------------------------------ world map
// Rough continent outlines in [lon, lat]; equirectangular projection.
const CONTINENTS = [
  [[-168, 66], [-140, 70], [-120, 71], [-95, 69], [-85, 66], [-76, 62], [-65, 60], [-55, 52], [-60, 46], [-70, 42], [-75, 35], [-80, 26], [-84, 30], [-90, 21], [-97, 16], [-105, 20], [-114, 28], [-125, 40], [-124, 48], [-140, 60], [-155, 58], [-168, 66]],
  [[-80, 10], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-72, -18], [-70, -23], [-70, -30], [-73, -37], [-73, -44], [-74, -52], [-68, -55], [-65, -45], [-62, -39], [-58, -32], [-52, -32], [-48, -28], [-41, -23], [-35, -9], [-35, -6], [-44, 0], [-50, 4], [-53, 5], [-60, 8], [-70, 11], [-77, 8], [-80, 10]],
  [[-17, 15], [-17, 21], [-10, 31], [-6, 35], [0, 36], [10, 37], [11, 34], [20, 32], [30, 31], [32, 31], [34, 28], [37, 22], [40, 15], [43, 11], [48, 11], [51, 10], [48, 0], [40, -5], [40, -12], [36, -18], [32, -26], [28, -33], [20, -35], [17, -32], [15, -27], [12, -18], [12, -6], [9, 4], [4, 6], [-8, 4], [-13, 8], [-17, 12], [-17, 15]],
  [[-10, 36], [-9, 43], [-2, 44], [-2, 48], [-4, 50], [0, 51], [3, 53], [8, 55], [8, 57], [10, 59], [5, 60], [5, 62], [12, 64], [18, 69], [25, 71], [30, 70], [40, 68], [50, 69], [60, 69], [68, 73], [75, 73], [80, 73], [70, 72], [60, 70], [50, 66], [45, 64], [40, 60], [38, 56], [35, 55], [32, 52], [30, 50], [28, 46], [30, 46], [28, 44], [23, 40], [19, 42], [15, 44], [12, 44], [8, 44], [3, 43], [-2, 37], [-9, 37], [-10, 36]],
  [[30, 70], [40, 68], [50, 68], [60, 69], [70, 73], [80, 73], [90, 75], [100, 77], [110, 74], [120, 73], [130, 72], [140, 72], [150, 70], [158, 66], [162, 60], [158, 52], [150, 60], [142, 55], [140, 50], [135, 44], [130, 42], [127, 40], [122, 38], [120, 32], [122, 28], [118, 25], [110, 20], [108, 12], [105, 9], [100, 8], [98, 12], [95, 16], [92, 21], [88, 22], [85, 19], [80, 15], [77, 8], [74, 20], [70, 24], [66, 25], [62, 25], [58, 26], [56, 27], [52, 26], [50, 29], [48, 30], [44, 29], [40, 30], [38, 32], [36, 36], [30, 36], [28, 38], [30, 41], [32, 44], [30, 46], [28, 45], [26, 41], [23, 40], [22, 38], [26, 38], [28, 41], [30, 44], [32, 46], [35, 48], [38, 50], [40, 52], [42, 54], [45, 56], [48, 58], [50, 60], [52, 62], [55, 64], [58, 66], [60, 68], [55, 68], [50, 68], [45, 68], [40, 68], [35, 69], [30, 70]],
  [[114, -22], [114, -30], [115, -35], [120, -34], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20], [114, -22]],
];
// [number, lon, lat, small nudge dx, dy] — nudges (a few px) separate the
// dense Middle East / Europe pins so the badges do not overlap.
const PINS = [
  [1, 30.7, 36.9, 0, 7], [2, 46.7, 24.7, 7, 3], [3, -76, -11, 0, 0],
  [4, 8.6, 49.9, 0, 0], [5, 33.4, 47.9, 5, -5], [6, 106.3, -6.2, 0, 0],
  [7, 127.5, -7.7, 0, 0], [8, 34.5, 31.5, 9, 6], [9, 50.6, 26.2, 8, -10],
  [10, 28.8, 47, -5, -5], [10, 24, 60.4, -7, -7], [11, -77, 38.9, 0, 0],
  [12, 27, 60, 7, -7], [13, 125.6, 7.1, 0, -12],
];
function drawMap(g, x, y, w, h) {
  g.fill(x, y, w, h, BLUE);
  const px = (lon) => x + ((lon + 180) / 360) * w;
  const py = (lat) => y + ((75 - lat) / 135) * h;
  for (const cont of CONTINENTS) {
    g.poly(cont.map(([lo, la]) => [px(lo), py(la)]), [214, 196, 150]);
  }
  // graticule
  for (let lo = -120; lo <= 120; lo += 60) g.fill(px(lo), y, 1, h, [70, 95, 130]);
  for (let la = -30; la <= 60; la += 30) g.fill(x, py(la), w, 1, [70, 95, 130]);
  for (const [n, lo, la, dx, dy] of PINS) {
    const bx = px(lo) + dx, by = py(la) + dy;
    g.disc(bx, by, 7, RED);
    drawText(g, String(n), bx - 7, by + 3, 0.8, 1.3, [255, 255, 255], 'c', 14);
  }
}

// ------------------------------------------------------------------ content
// Every fact below was verified against a real outlet on 22 Nov 2026.
// Traps respected: Riyadh = 3 missiles, not 5; Kryvyi Rih = 2 killed, 60 hurt
// (reported Saturday); Peru = no casualties; COP31 = overtime on Saturday,
// collapse on Sunday; Indonesia fire = 3 dead, 36 missing (Saturday's count);
// the Banda Sea 6.6 was 16 Nov, so it is NOT a second Saturday quake.
const SCENES = {
  cop31: sceneCOP31, riyadh: sceneRiyadh, peru: scenePeru, bepi: sceneBepi,
  kryvyi: sceneKryvyi, fire: sceneFire, timor: sceneTimor, gaza: sceneGaza,
  bahrain: sceneBahrain, borders: sceneBorders, whitehouse: sceneWhiteHouse,
  sparta: sceneSparta, davao: sceneDavao,
};
const LARGE = [
  { n: 1, tag: 'CLIMATE', scene: 'cop31', region: 'Global', src: 'Reuters',
    title: 'COP31 IN OVERTIME, NO DEAL YET',
    body: 'Day 13 in Antalya, two days past the end. Nearly 200 nations are deadlocked over fossil fuels.' },
  { n: 2, tag: 'RIYADH', scene: 'riyadh', region: 'Middle East', src: 'Al Jazeera',
    title: 'THREE MISSILES STOPPED',
    body: 'The Saudi-led coalition stops three Houthi missiles aimed at Riyadh early on Saturday.' },
  { n: 3, tag: 'PERU', scene: 'peru', region: 'Americas', src: 'AFP',
    title: '6.7 QUAKE SHAKES PERU - NO ONE HURT',
    body: 'A 6.7 quake strikes near Junin on Saturday, shaking Lima. Homes damaged, roads blocked. No one is hurt.' },
];
const SMALL = [
  { n: 4, tag: 'SPACE', scene: 'bepi', region: 'Global', src: 'ESA',
    title: 'BEPICOLOMBO AT MERCURY',
    body: 'ESA\'s craft orbits Mercury, only the second ever.' },
  { n: 5, tag: 'UKRAINE', scene: 'kryvyi', region: 'Europe', src: 'Al Jazeera',
    title: 'DOUBLE-TAP HITS KRYVYI RIH',
    body: 'Two killed, 60 hurt as missiles then drones hit rescuers.' },
  { n: 6, tag: 'INDONESIA', scene: 'fire', region: 'Asia', src: 'Reuters',
    title: 'FIRE KILLS 3, 36 MISSING',
    body: 'Fire at a candy factory kills 3, leaves 36 missing.' },
  { n: 7, tag: 'QUAKE', scene: 'timor', region: 'Asia', src: 'USGS',
    title: '6.8 QUAKE OFF TIMOR-LESTE',
    body: '6.8 quake off Lospalos, deep at 143 km. No tsunami.' },
  { n: 8, tag: 'GAZA', scene: 'gaza', region: 'Middle East', src: 'Reuters',
    title: '4 KILLED IN GAZA',
    body: 'Israeli fire kills 4, 3 in a strike on an aid vehicle.' },
  { n: 9, tag: 'BAHRAIN', scene: 'bahrain', region: 'Middle East', src: 'Al Jazeera',
    title: 'IRAN STRIKES BAHRAIN',
    body: 'Iran claims US radar hits; Bahrain says a site burned.' },
  { n: 10, tag: 'EUROPE', scene: 'borders', region: 'Europe', src: 'Kyiv Independent',
    title: 'TWO BORDERS CROSSED',
    body: 'Drone crosses Moldova twice; copter over Finland.' },
  { n: 11, tag: 'WHITE HOUSE', scene: 'whitehouse', region: 'Americas', src: 'AP',
    title: 'CHECK WITH US FIRST',
    body: 'Contractors must check with the White House first.' },
  { n: 12, tag: 'BALTIC SEA', scene: 'sparta', region: 'Europe', src: 'Kyiv Independent',
    title: 'DRONE HIT SETS SHIP ABLAZE',
    body: 'Drones hit Russian ship Sparta II; it burns in the Gulf.' },
  { n: 13, tag: 'DAVAO', scene: 'davao', region: 'Oceania', src: 'AP',
    title: '146 SAFE AFTER JET SCARE',
    body: 'Jet lands at Davao after an engine scare; all 146 safe.' },
];
const BRIEFS = [
  ['Two missiles stopped over Jizan', 'Times of Israel', 'Middle East'],
  ['Coalition strikes Hodeidah port in reply', 'Al Jazeera', 'Middle East'],
  ['Houthi drone to the Saudi south destroyed', 'Al Jazeera', 'Middle East'],
  ['Bahrain issues an all-clear', 'Al Jazeera', 'Middle East'],
  ['Israel says the Gaza vehicle held militants', 'Haaretz', 'Middle East'],
  ["EU: draft risks a 'fossil summit' COP", 'Al Jazeera', 'Global'],
  ['Oil producers lobbied to keep fossil fuels out', 'Reuters', 'Global'],
  ['BepiColombo fired four thrusters for 37 minutes', 'ESA', 'Global'],
  ['Kryvyi Rih: 28 in hospital, 5 in intensive care', 'CNN', 'Europe'],
  ['25 apartment blocks and a hospital damaged', 'Al Jazeera', 'Europe'],
  ['Peru: landslides block roads, power cut in Junin', 'AFP', 'Americas'],
  ['Carhuamayo mayor: no victims, no damage', 'AP', 'Americas'],
  ['White House order signed Friday, out Saturday', 'AP', 'Americas'],
  ['Sulu Sea: 5.9 quake strikes deep under the sea', 'USGS', 'Asia'],
  ['Qinghai: quake shakes Delingha, no casualties', 'Xinhua', 'Asia'],
  ['No tsunami threat after the 6.8 off Timor-Leste', 'USGS', 'Asia'],
  ['Timor quake shaking felt across the island', 'USGS', 'Asia'],
  ['Indonesia fire: 15 rescued alive, 4 hurt', 'Reuters', 'Asia'],
  ['Davao: passengers slid down emergency chutes', 'AP', 'Oceania'],
  ['Davao airport reopened at 02:05 after checks', 'AP', 'Oceania'],
];
const KPI = [
  ['13', 'DAY OF COP31'],
  ['3', 'MISSILES STOPPED'],
  ['6.7', 'PERU QUAKE'],
  ['6.8', 'TIMOR QUAKE'],
  ['36', 'MISSING IN FIRE'],
  ['$58,983', 'BITCOIN, DOWN 3.9%'],
];
const REGIONS = [
  ['Europe', [59, 110, 165]], ['Asia', [192, 57, 43]], ['Middle East', [212, 136, 6]],
  ['Americas', [125, 60, 152]], ['Oceania', [0, 131, 143]], ['Global', [97, 97, 97]],
];
const DATECHECK = [
  'COP31 COLLAPSE - Sunday 22 Nov, not Saturday.',
  'ICJ Myanmar ruling and Shenzhen summit - Thu 19 Nov.',
  'AI sell-off, Kyiv bridge barrage, Poland missile, UK-EU deal, Akvan - Fri 20 Nov.',
  "Houthi hit on Riyadh's PIF tower - Thu. Iran's F-16 claims - Fri, unverified.",
  "'El Chapo Isidro' captured - Fri. S. Korea minister quits - Sun.",
  'Indonesia fire and Kenya floods toll updates - other days.',
];
const FOOTER = 'Every story here happened, or was first reported, on Saturday 21 November 2026. Counts are as reported; claims are attributed. Sources named beside each story. Original drawings.';

// ------------------------------------------------------------------- layout
function fitSize(str, maxW, maxS) {
  let s = maxS;
  while (s > 0.5 && textWidth(str, s) > maxW) s -= 0.1;
  return s;
}
function numberBadge(g, x, y, n) {
  const s = String(n);
  g.disc(x, y, 10, RED);
  drawText(g, s, x - 10, y + 3.5, 0.9, 1.4, [255, 255, 255], 'c', 20);
}
function drawLarge(g, x, y, w, h, c) {
  g.fill(x, y, w, h, [250, 246, 232]);
  g.fill(x, y, w, 1, INK); g.fill(x, y + h - 1, w, 1, INK);
  g.fill(x, y, 1, h, INK); g.fill(x + w - 1, y, 1, h, INK);
  g.fill(x + 1, y + 1, w - 2, 17, RED);
  drawText(g, c.tag, x + 7, y + 13, 1.05, 1.5, [255, 255, 255]);
  numberBadge(g, x + w - 14, y + 9, c.n);
  let cy = y + 22;
  SCENES[c.scene](g, x + 6, cy, w - 12, 46);
  cy += 46 + 4;
  cy = drawPara(g, c.title, x + 6, cy + 16, 1.6, 1.6, INK, w - 12, 18) + 2;
  cy = drawPara(g, c.body, x + 6, cy + 9.5, 0.95, 1.0, INK, w - 12, 11) + 2;
  const srcTxt = 'Source: ' + c.src;
  drawText(g, srcTxt, x + 6, y + h - 5, fitSize(srcTxt, w - 12, 0.9), 1.2, GREY);
}
function drawSmall(g, x, y, w, h, c) {
  g.fill(x, y, w, h, [250, 246, 232]);
  g.fill(x, y, w, 1, INK); g.fill(x, y + h - 1, w, 1, INK);
  g.fill(x, y, 1, h, INK); g.fill(x + w - 1, y, 1, h, INK);
  g.fill(x + 1, y + 1, w - 2, 15, RED);
  drawText(g, c.tag, x + 6, y + 11.5, 0.95, 1.4, [255, 255, 255]);
  numberBadge(g, x + w - 12, y + 8, c.n);
  let cy = y + 18;
  SCENES[c.scene](g, x + 5, cy, w - 10, 28);
  cy += 28 + 3;
  cy = drawPara(g, c.title, x + 5, cy + 11.5, 1.15, 1.2, INK, w - 10, 13) + 1;
  cy = drawPara(g, c.body, x + 5, cy + 9, 0.9, 0.9, INK, w - 10, 10) + 1;
  const srcTxt = 'Source: ' + c.src;
  drawText(g, srcTxt, x + 5, y + h - 4, fitSize(srcTxt, w - 10, 0.85), 1.2, GREY);
}

function build() {
  const g = new Img();
  g.fill(0, 0, W, H, PAPER);
  const M = 26, CW = W - 2 * M;
  let y = 12;

  // Masthead
  const mast = 'THE WORLD IN ONE DAY';
  const ms = fitSize(mast, CW, 3.4);
  drawText(g, mast, M, y + 10 * ms, ms, ms * 0.55, RED, 'c', CW);
  y += 10 * ms + 6;
  g.fill(M, y, CW, 3, RED); y += 6;
  g.fill(M, y, CW, 1, INK); y += 6;

  // Count line
  const count = '33 STORIES | 6 REGIONS | EVERY ONE DATED SATURDAY 21 NOVEMBER 2026';
  const cs = fitSize(count, CW, 1.15);
  drawText(g, count, M, y + 10 * cs, cs, cs * 0.35, INK, 'c', CW);
  y += 10 * cs + 6;

  // Date headline
  const date = 'Saturday 21 November 2026';
  const ds = fitSize(date, CW, 3.5);
  drawText(g, date, M, y + 10 * ds, ds, ds * 0.55, INK, 'c', CW);
  y += 10 * ds + 4;

  // Subhead (italic)
  const sub = 'COP31 deadlocked in overtime as three missiles are stopped over Riyadh, and a 6.7 quake shakes Peru with no one hurt';
  y = drawPara(g, sub, M, y + 14, 1.4, 0.5, INK, CW, 16, 'c', 0.18) + 3;

  // KPI strip
  const kpiH = 38, kgap = 5;
  const kbw = (CW - kgap * 5) / 6;
  for (let i = 0; i < 6; i++) {
    const bx = M + i * (kbw + kgap);
    g.fill(bx, y, kbw, kpiH, [255, 255, 255]);
    g.fill(bx, y, kbw, 1, INK); g.fill(bx, y + kpiH - 1, kbw, 1, INK);
    g.fill(bx, y, 1, kpiH, INK); g.fill(bx + kbw - 1, y, 1, kpiH, INK);
    const [num, lab] = KPI[i];
    const ns = fitSize(num, kbw - 10, 2.2);
    drawText(g, num, bx, y + 10 * ns + 2, ns, ns * 0.5, RED, 'c', kbw);
    drawText(g, lab, bx, y + kpiH - 4, 0.75, 0.9, INK, 'c', kbw);
  }
  y += kpiH + 6;

  // Region bar
  const counts = {};
  for (const [name] of REGIONS) counts[name] = 0;
  for (const c of [...LARGE, ...SMALL]) counts[c.region]++;
  for (const b of BRIEFS) counts[b[2]]++;
  let bx = M;
  for (const [name, col] of REGIONS) {
    const segW = (counts[name] / 33) * CW;
    g.fill(bx, y, segW, 14, col);
    bx += segW;
  }
  y += 14 + 4;
  let lx = M;
  for (const [name, col] of REGIONS) {
    g.fill(lx, y, 9, 9, col);
    const lab = name + ' ' + counts[name];
    drawText(g, lab, lx + 12, y + 9.5, 0.95, 1.2, INK);
    lx += 12 + textWidth(lab, 0.95) + 18;
  }
  y += 11 + 4;

  // Three large cards
  const lw = (CW - 2 * 12) / 3;
  for (let i = 0; i < 3; i++) drawLarge(g, M + i * (lw + 12), y, lw, 188, LARGE[i]);
  y += 188 + 6;

  // Ten small cards, two rows of five
  const sw = (CW - 4 * 6) / 5;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      drawSmall(g, M + c * (sw + 6), y + r * (134 + 8), sw, 134, SMALL[r * 5 + c]);
    }
  }
  y += 2 * 134 + 8 + 6;

  // Map + DATE CHECK side by side
  const mapW = 500, dcW = CW - mapW - 12;
  const bandY = y, bandH = 128;
  drawText(g, 'WHERE IT HAPPENED', M, bandY + 12, 1.3, 1.8, INK);
  drawMap(g, M, bandY + 18, mapW, bandH - 18);
  const dx = M + mapW + 12;
  g.fill(dx, bandY, dcW, 2, RED);
  g.fill(dx, bandY + bandH - 2, dcW, 2, RED);
  g.fill(dx, bandY, 2, bandH, RED);
  g.fill(dx + dcW - 2, bandY, 2, bandH, RED);
  drawText(g, 'DATE CHECK - NOT SATURDAY NEWS', dx + 8, bandY + 13, 1.15, 1.6, RED);
  let dTop = bandY + 16;
  for (const item of DATECHECK) {
    const endY = drawPara(g, item, dx + 8, dTop + 8.5, 0.85, 0.9, INK, dcW - 16, 10);
    dTop = endY + 1 - 8.5;
  }
  y = bandY + bandH + 6;

  // Briefs, two columns
  drawText(g, 'ALSO ON SATURDAY 21 NOVEMBER 2026', M, y + 12, 1.3, 1.8, INK);
  y += 16;
  const colW = (CW - 12) / 2;
  const colTop = [y, y];
  BRIEFS.forEach((b, i) => {
    const col = i % 2;
    const cx = M + col * (colW + 12);
    const baseY = colTop[col] + 8;
    g.disc(cx + 3, baseY - 3, 2.5, RED);
    const endY = drawPara(g, b[0] + ' - ' + b[1], cx + 10, baseY, 0.8, 0.9, INK, colW - 12, 10);
    colTop[col] = endY + 1 - 8;
  });
  y = Math.max(colTop[0], colTop[1]) + 6;

  // Footer
  drawPara(g, FOOTER, M, y + 9.5, 0.95, 1.0, GREY, CW, 11, 'c');
  y += 18;
  console.log('layout final y =', y);
  return g;
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const img = build();
const png = encodePNG(W, H, img.buf);
writeFileSync(join(outDir, 'entry.png'), png);
console.log('wrote', join(outDir, 'entry.png'), png.length, 'bytes');
