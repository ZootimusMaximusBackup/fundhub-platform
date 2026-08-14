import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { APPLY_PAGE_URL, encodeQrMatrix, versionFor, drawQrOnPdfPage } = require(
  "../../vendor/underwriteiq-full/api/lite/crs/apply-qr.js"
);

const ISO_QUIET = 4;
const FORMAT_MASK = 0b101010000010010;
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

function asciiMatrix(mod) {
  return mod.map((row) => row.map((v) => (v ? "#" : ".")).join("")).join("\n");
}

function sizeOf(version) {
  return 21 + 4 * (version - 1);
}

function versionFromSize(size) {
  const v = (size - 21) / 4 + 1;
  if (v < 1 || v > 10 || v !== Math.floor(v)) {
    throw new Error(`decode: unsupported size ${size}`);
  }
  return v;
}

function inFinder(row, col, size) {
  const box = (r0, c0) => row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7;
  return box(0, 0) || box(0, size - 7) || box(size - 7, 0);
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

function inTiming(row, col, size) {
  return (row === 6 || col === 6) && !inFinder(row, col, size);
}

function inAlign(row, col, version) {
  const size = sizeOf(version);
  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      if (r <= 8 && c <= 8) continue;
      if (r <= 8 && c >= size - 9) continue;
      if (r >= size - 9 && c <= 8) continue;
      if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return true;
    }
  }
  return false;
}

function isFunctionModule(row, col, version) {
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

function formatBitsFor(maskId) {
  const data = (0b00 << 3) | maskId; // EC M = 00
  let d = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((d >>> i) & 1) d ^= gen << (i - 10);
  }
  return (data << 10 | d) ^ FORMAT_MASK;
}

function readFormatCopy(mod, coords) {
  let bits = 0;
  for (const [r, c] of coords) bits = (bits << 1) | (mod[r][c] & 1);
  return bits;
}

function decodeFormat(mod) {
  const size = mod.length;
  const copyA = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  const copyB = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8],
    [size - 6, 8], [size - 7, 8], [8, size - 8], [8, size - 7], [8, size - 6],
    [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
  ];
  const a = readFormatCopy(mod, copyA);
  const b = readFormatCopy(mod, copyB);
  assert.equal(a, b, "format copies disagree");
  const raw = a ^ FORMAT_MASK;
  const data = raw >> 10;
  const ec = data >> 3;
  const mask = data & 7;
  assert.equal(ec, 0, "expected EC level M");
  assert.equal(a, formatBitsFor(mask), "format BCH does not round-trip");
  return { mask, ec, bits: a };
}

/**
 * ISO zigzag (Nayuki): two-module columns, direction from the column index,
 * skip the vertical timing pattern at column 6. Independent of the encoder.
 */
function extractDataBits(mod, version, maskId) {
  const size = mod.length;
  const masked = maskFn(maskId);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunctionModule(y, x, version)) continue;
        let v = mod[y][x] & 1;
        if (masked(y, x)) v ^= 1;
        bits.push(v);
      }
    }
  }
  return bits;
}

function takeBits(bits, start, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = (v << 1) | (bits[start + i] || 0);
  return v;
}

function decodeBytePayload(bits) {
  const mode = takeBits(bits, 0, 4);
  const length = takeBits(bits, 4, 8);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(takeBits(bits, 12 + i * 8, 8));
  return { mode, length, text: Buffer.from(bytes).toString("utf8") };
}

function decodeQrMatrix(mod) {
  const version = versionFromSize(mod.length);
  const fmt = decodeFormat(mod);
  const bits = extractDataBits(mod, version, fmt.mask);
  const payload = decodeBytePayload(bits);
  return { version, ...fmt, ...payload, ascii: asciiMatrix(mod) };
}

test("apply page URL is the Fundhub application", () => {
  assert.equal(APPLY_PAGE_URL, "https://apply.fundhub.ai");
});

test("encodeQrMatrix defaults to the apply page URL", () => {
  assert.deepEqual(encodeQrMatrix(), encodeQrMatrix(APPLY_PAGE_URL));
});

test("apply URL fits a scannable QR version", () => {
  const v = versionFor(Buffer.byteLength(APPLY_PAGE_URL));
  assert.ok(v >= 2 && v <= 4, `unexpected version ${v}`);
});

test("matrix is square with finder patterns in three corners", () => {
  const m = encodeQrMatrix(APPLY_PAGE_URL);
  assert.equal(m.length, m[0].length);
  assert.ok(m.length >= 21);
  const n = m.length;
  const finderOk = (r0, c0) => {
    assert.equal(m[r0][c0], 1);
    assert.equal(m[r0][c0 + 6], 1);
    assert.equal(m[r0 + 6][c0], 1);
    assert.equal(m[r0 + 3][c0 + 3], 1);
    assert.equal(m[r0 + 1][c0 + 1], 0);
  };
  finderOk(0, 0);
  finderOk(0, n - 7);
  finderOk(n - 7, 0);
});

test("same URL always yields the same matrix", () => {
  const a = encodeQrMatrix(APPLY_PAGE_URL);
  const b = encodeQrMatrix(APPLY_PAGE_URL);
  assert.deepEqual(a, b);
});

test("matrix decodes to https://apply.fundhub.ai", () => {
  const m = encodeQrMatrix(APPLY_PAGE_URL);
  let decoded;
  try {
    decoded = decodeQrMatrix(m);
  } catch (err) {
    assert.fail(`${err.message}\n${asciiMatrix(m)}`);
  }
  assert.equal(decoded.mode, 0b0100, `mode ${decoded.mode}\n${decoded.ascii}`);
  assert.equal(decoded.length, APPLY_PAGE_URL.length, decoded.ascii);
  assert.equal(
    decoded.text,
    APPLY_PAGE_URL,
    `decoded ${JSON.stringify(decoded.text)}\n${decoded.ascii}`
  );
});

test("drawQrOnPdfPage paints a white quiet zone and black modules", async () => {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  drawQrOnPdfPage(page, {
    x: 20,
    y: 20,
    size: 128,
    black: rgb(0, 0, 0),
    white: rgb(1, 1, 1)
  });
  const bytes = await doc.save();
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");

  const ops = [];
  const mock = {
    drawRectangle(opts) {
      ops.push(opts);
    },
    drawText() {
      assert.fail("must not draw placeholder text");
    }
  };
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const matrix = encodeQrMatrix(APPLY_PAGE_URL);
  drawQrOnPdfPage(mock, { x: 10, y: 20, size: 128, matrix, black, white });
  assert.ok(ops.length > 1);
  assert.equal(ops[0].color, white);
  assert.equal(ops[0].width, 128);
  assert.equal(ops[0].height, 128);
  const total = matrix.length + ISO_QUIET * 2;
  const cell = 128 / total;
  const firstBlack = ops[1];
  assert.equal(firstBlack.color, black);
  assert.ok(Math.abs(firstBlack.x - (10 + ISO_QUIET * cell)) < 1e-9);
  for (const op of ops.slice(1)) {
    assert.equal(op.color, black);
    assert.ok(op.x >= 10 + ISO_QUIET * cell - 1e-9);
    assert.ok(op.y >= 20 + ISO_QUIET * cell - 1e-9);
  }
});
