"use strict";

/**
 * Apply-page QR — no npm dependency.
 * Encodes a URL as a QR matrix (byte mode, EC level M) and draws it with pdf-lib.
 * Default destination is the Fundhub application page.
 */

const APPLY_PAGE_URL = "https://apply.fundhub.ai";

const EC_M = { 1: 10, 2: 16, 3: 26, 4: 36, 5: 46, 6: 60, 7: 66, 8: 86, 9: 100, 10: 122 };
const DATA_M = { 1: 16, 2: 28, 3: 44, 4: 64, 5: 86, 6: 108, 7: 124, 8: 154, 9: 182, 10: 216 };
const ALIGN = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50]
};
// [blockCount, dataPerBlock, ecPerBlock] — EC level M, remainder-free versions.
const BLOCKS_M = {
  1: [1, 16, 10],
  2: [1, 28, 16],
  3: [1, 44, 26],
  4: [2, 32, 18],
  5: [2, 43, 22],
  6: [2, 54, 30],
  7: [2, 62, 33],
  8: [2, 76, 43],
  9: [2, 91, 50],
  10: [4, 54, 30]
};

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const ecc = new Array(ecCount).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    if (!factor) continue;
    for (let j = 0; j < gen.length - 1; j++) {
      ecc[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return ecc;
}

function versionFor(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const bits = 4 + 8 + byteLen * 8 + 4;
    const bytes = Math.ceil(bits / 8);
    if (bytes <= DATA_M[v]) return v;
  }
  throw new Error("apply-qr: URL too long for versions 1–10");
}

function encodeData(text, version) {
  const bytes = Array.from(Buffer.from(String(text), "utf8"));
  const capacity = DATA_M[version];
  const bits = [];
  const push = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const maxBits = capacity * 8;
  const term = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  const pad = [0xec, 0x11];
  let p = 0;
  while (data.length < capacity) data.push(pad[p++ % 2]);
  return data;
}

function interleave(data, version) {
  const [blockCount, dataPer, ecPer] = BLOCKS_M[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const chunk = data.slice(offset, offset + dataPer);
    offset += dataPer;
    blocks.push({ data: chunk, ecc: rsEncode(chunk, ecPer) });
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < ecPer; i++) {
    for (const b of blocks) out.push(b.ecc[i]);
  }
  return out;
}

function sizeOf(version) {
  return 21 + 4 * (version - 1);
}

function inFinder(row, col, size) {
  const inBox = (r, c, r0, c0) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
  return inBox(row, col, 0, 0) || inBox(row, col, 0, size - 7) || inBox(row, col, size - 7, 0);
}

function inTiming(row, col, size) {
  return (row === 6 || col === 6) && !inFinder(row, col, size);
}

function inAlign(row, col, version) {
  const pos = ALIGN[version];
  for (const r of pos) {
    for (const c of pos) {
      if (r <= 8 && c <= 8) continue;
      if (r <= 8 && c >= sizeOf(version) - 9) continue;
      if (r >= sizeOf(version) - 9 && c <= 8) continue;
      if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return { r, c };
    }
  }
  return null;
}

function inSeparator(row, col, size) {
  if (row === 7 && col <= 7) return true;
  if (col === 7 && row <= 7) return true;
  if (row === 7 && col >= size - 8) return true;
  if (col === size - 8 && row <= 7) return true;
  if (row === size - 8 && col <= 7) return true;
  if (col === 7 && row >= size - 8) return true;
  return false;
}

function reserved(row, col, version) {
  const size = sizeOf(version);
  if (inFinder(row, col, size)) return true;
  if (inSeparator(row, col, size)) return true;
  if (inTiming(row, col, size)) return true;
  if (inAlign(row, col, version)) return true;
  if (row === 8 && (col <= 8 || col >= size - 8)) return true;
  if (col === 8 && (row <= 8 || row >= size - 8)) return true;
  if (version >= 7) {
    if (row < 6 && col >= size - 11) return true;
    if (col < 6 && row >= size - 11) return true;
  }
  return false;
}

function finderPattern(mod, r0, c0) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const on =
        r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      mod[r0 + r][c0 + c] = on ? 1 : 0;
    }
  }
}

function alignPattern(mod, cy, cx) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const on = Math.max(Math.abs(r), Math.abs(c)) !== 1 || (r === 0 && c === 0);
      const dark = Math.max(Math.abs(r), Math.abs(c)) === 2 || (r === 0 && c === 0);
      if (on) mod[cy + r][cx + c] = dark ? 1 : 0;
    }
  }
}

function maskFn(id) {
  return {
    0: (r, c) => (r + c) % 2 === 0,
    1: (r, c) => r % 2 === 0,
    2: (r, c) => c % 3 === 0,
    3: (r, c) => (r + c) % 3 === 0,
    4: (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    5: (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    6: (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    7: (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  }[id];
}

function placeData(mod, bits, version) {
  const size = mod.length;
  let bit = 0;
  let dir = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = dir < 0 ? size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (reserved(row, c, version)) continue;
        mod[row][c] = bit < bits.length ? bits[bit++] : 0;
      }
    }
    dir *= -1;
  }
}

function applyMask(mod, version, maskId) {
  const size = mod.length;
  const masked = mod.map((row) => row.slice());
  const fn = maskFn(maskId);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved(r, c, version) && fn(r, c)) masked[r][c] ^= 1;
    }
  }
  return masked;
}

function bchFormat(maskId) {
  const data = (0b00 << 3) | maskId; // EC M = 00
  let d = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((d >>> i) & 1) d ^= gen << (i - 10);
  }
  return (data << 10 | d) ^ 0b101010000010010;
}

function drawFormat(mod, maskId) {
  const size = mod.length;
  const bits = bchFormat(maskId);
  const seq = [];
  for (let i = 14; i >= 0; i--) seq.push((bits >> i) & 1);
  const horiz = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  horiz.forEach(([r, c], i) => { mod[r][c] = seq[i]; });
  const vert = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8],
    [size - 6, 8], [size - 7, 8], [8, size - 8], [8, size - 7], [8, size - 6],
    [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
  ];
  vert.forEach(([r, c], i) => { mod[r][c] = seq[i]; });
  mod[size - 8][8] = 1;
}

function penalty(mod) {
  const size = mod.length;
  let score = 0;
  const runPenalty = (run) => {
    for (const n of run) if (n >= 5) score += n - 2;
  };
  for (let r = 0; r < size; r++) {
    const run = [];
    let last = mod[r][0];
    let n = 1;
    for (let c = 1; c < size; c++) {
      if (mod[r][c] === last) n++;
      else {
        run.push(n);
        last = mod[r][c];
        n = 1;
      }
    }
    run.push(n);
    runPenalty(run);
  }
  for (let c = 0; c < size; c++) {
    const run = [];
    let last = mod[0][c];
    let n = 1;
    for (let r = 1; r < size; r++) {
      if (mod[r][c] === last) n++;
      else {
        run.push(n);
        last = mod[r][c];
        n = 1;
      }
    }
    run.push(n);
    runPenalty(run);
  }
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (mod[r][c]) dark++;
      if (r < size - 1 && c < size - 1) {
        const s = mod[r][c] + mod[r][c + 1] + mod[r + 1][c] + mod[r + 1][c + 1];
        if (s === 0 || s === 4) score += 3;
      }
    }
  }
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

function bytesToBits(bytes) {
  const bits = [];
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  return bits;
}

function buildMatrix(text) {
  const version = versionFor(Buffer.byteLength(String(text), "utf8"));
  const size = sizeOf(version);
  const data = encodeData(text, version);
  const interleaved = interleave(data, version);
  const bits = bytesToBits(interleaved);

  const base = Array.from({ length: size }, () => new Array(size).fill(0));
  finderPattern(base, 0, 0);
  finderPattern(base, 0, size - 7);
  finderPattern(base, size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    base[6][i] = i % 2 === 0 ? 1 : 0;
    base[i][6] = i % 2 === 0 ? 1 : 0;
  }
  const pos = ALIGN[version];
  for (const r of pos) {
    for (const c of pos) {
      if (r <= 8 && c <= 8) continue;
      if (r <= 8 && c >= size - 9) continue;
      if (r >= size - 9 && c <= 8) continue;
      alignPattern(base, r, c);
    }
  }
  placeData(base, bits, version);

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(base, version, mask);
    drawFormat(masked, mask);
    const score = penalty(masked);
    if (score < bestScore) {
      bestScore = score;
      best = masked;
    }
  }
  return best;
}

function encodeQrMatrix(text = APPLY_PAGE_URL) {
  return buildMatrix(text);
}

function drawQrOnPdfPage(page, { x, y, size, matrix, black, white }) {
  const mod = matrix || encodeQrMatrix(APPLY_PAGE_URL);
  const n = mod.length;
  // ISO/IEC 18004 quiet zone is 4 modules. White fill is required: the close
  // page behind this box is dark.
  const quiet = 4;
  const total = n + quiet * 2;
  const cell = size / total;
  // Tiny overlap so adjacent black squares do not leave a white hairline when
  // a phone camera rasterizes the PDF.
  const bleed = cell * 0.05;
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    color: white
  });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!mod[r][c]) continue;
      page.drawRectangle({
        x: x + (c + quiet) * cell,
        y: y + size - (r + 1 + quiet) * cell,
        width: cell + bleed,
        height: cell + bleed,
        color: black
      });
    }
  }
}

module.exports = {
  APPLY_PAGE_URL,
  encodeQrMatrix,
  drawQrOnPdfPage,
  versionFor
};
