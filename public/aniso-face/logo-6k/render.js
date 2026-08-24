/* Fundhub wordmark, static. Aniso glyphs crawl inside the letters. White field, black glyphs. */
(() => {
  // Exact Aniso/Dragonfly string Chris locked. Do not pad with E.
  const CHARS = "+*,++++./O#DE";
  const LOOP_SEC = 48;
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
  const params = new URLSearchParams(location.search);
  const captureW = Number(params.get("w")) || 0;
  const captureH = Number(params.get("h")) || 0;
  const still = params.get("still") === "1";
  const capture = captureW > 0 && captureH > 0;

  let logoAspect = 2698.148471 / 542.978759;
  let start = 0;
  let raf = 0;
  let maskW = 0;
  let maskH = 0;
  let maskA = null;
  let occW = 0;
  let occH = 0;
  let occGrain = 0;
  let occCols = 0;
  let occRows = 0;
  let occupancy = null;
  let occOx = 0;
  let occOy = 0;
  let occLogoW = 0;
  let occLogoH = 0;

  function size() {
    if (capture) {
      if (canvas.width !== captureW || canvas.height !== captureH) {
        canvas.width = captureW;
        canvas.height = captureH;
      }
      return { w: captureW, h: captureH };
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  }

  function cellSize(w, h) {
    // ~96px at 6K so + * / O # D E read on a 16" wallpaper, not as dither.
    const g = Math.round(96 * (Math.min(w, h) / 3456));
    return Math.max(56, g);
  }

  function glyphAt(gx, gy, t) {
    const n = CHARS.length;
    const loopT = ((t % 1) + 1) % 1;
    // Integer cycles so t=0 and t=1 match. Spatial coeffs are non-integer so
    // neighbors change at different times (crawl / shimmer, not a global flash).
    const crawl = loopT * n * 2;
    const shimmer = Math.sin(loopT * Math.PI * 2 + gy * 0.37 + gx * 0.11) * 0.9;
    const u = gx * 0.71 + gy * 1.37 + crawl + shimmer;
    return CHARS[(((Math.floor(u) % n) + n) % n)];
  }

  function layout(w, h) {
    const logoW = w * 0.9;
    const logoH = logoW / logoAspect;
    return {
      logoW,
      logoH,
      ox: (w - logoW) / 2,
      oy: (h - logoH) / 2,
    };
  }

  function maskAlphaAt(px, py, ox, oy, logoW, logoH) {
    const u = (px - ox) / logoW;
    const v = (py - oy) / logoH;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    const mx = Math.min(maskW - 1, (u * maskW) | 0);
    const my = Math.min(maskH - 1, (v * maskH) | 0);
    return maskA[my * maskW + mx];
  }

  function ensureOccupancy(w, h, grain) {
    if (occupancy && occW === w && occH === h && occGrain === grain) return;
    const { ox, oy, logoW, logoH } = layout(w, h);
    const cols = Math.floor(w / grain);
    const rows = Math.floor(h / grain);
    const occ = new Float32Array(cols * rows);
    const samples = 6;
    const denom = samples * samples * 255;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x0 = gx * grain;
        const y0 = gy * grain;
        let sum = 0;
        for (let sy = 0; sy < samples; sy++) {
          const py = y0 + ((sy + 0.5) / samples) * grain;
          for (let sx = 0; sx < samples; sx++) {
            const px = x0 + ((sx + 0.5) / samples) * grain;
            sum += maskAlphaAt(px, py, ox, oy, logoW, logoH);
          }
        }
        occ[gy * cols + gx] = sum / denom;
      }
    }
    occupancy = occ;
    occW = w;
    occH = h;
    occGrain = grain;
    occCols = cols;
    occRows = rows;
    occOx = ox;
    occOy = oy;
    occLogoW = logoW;
    occLogoH = logoH;
  }

  function occupancyKey() {
    if (!occupancy) return "";
    let filled = 0;
    let acc = 0;
    for (let i = 0; i < occupancy.length; i++) {
      if (occupancy[i] < 0.25) continue;
      filled += 1;
      acc = (acc + (i + 1) * 997) | 0;
    }
    return `${occCols}x${occRows}:${filled}:${acc}`;
  }

  function drawFrame(t) {
    const { w, h } = size();
    const grain = cellSize(w, h);
    ensureOccupancy(w, h, grain);
    const cols = occCols;
    const rows = occRows;
    const loopT = ((t % 1) + 1) % 1;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#000000";
    ctx.font = `${Math.floor(grain * 0.92)}px ui-monospace, Menlo, Monaco, "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const used = Object.create(null);
    let glyphKey = 0;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (occupancy[gy * cols + gx] < 0.25) continue;
        const ch = glyphAt(gx, gy, loopT);
        used[ch] = (used[ch] || 0) + 1;
        glyphKey = (glyphKey + ch.charCodeAt(0) * (gx + 3) * (gy + 5)) | 0;
        ctx.fillText(ch, gx * grain + grain / 2, gy * grain + grain / 2);
      }
    }
    window.__glyphCounts = used;
    window.__occupancyKey = occupancyKey();
    window.__glyphKey = String(glyphKey);
    window.__layout = {
      w,
      h,
      grain,
      cols,
      rows,
      ox: occOx,
      oy: occOy,
      logoW: occLogoW,
      logoH: occLogoH,
    };
  }

  function tick(now) {
    if (!start) start = now;
    drawFrame(((now - start) / 1000 / LOOP_SEC) % 1);
    raf = requestAnimationFrame(tick);
  }

  async function boot() {
    const img = new Image();
    img.src = new URL("./logo.svg", location.href).href;
    await img.decode();
    const nw = img.naturalWidth || 2698.148471;
    const nh = img.naturalHeight || 542.978759;
    logoAspect = nw / nh;
    const ink = document.createElement("canvas");
    maskW = 4096;
    maskH = Math.max(64, Math.round(4096 / logoAspect));
    ink.width = maskW;
    ink.height = maskH;
    const ictx = ink.getContext("2d", { willReadFrequently: true });
    ictx.clearRect(0, 0, maskW, maskH);
    ictx.drawImage(img, 0, 0, maskW, maskH);
    const data = ictx.getImageData(0, 0, maskW, maskH).data;
    maskA = new Uint8Array(maskW * maskH);
    for (let i = 0; i < maskW * maskH; i++) {
      const o = i * 4;
      const a = data[o + 3];
      const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      maskA[i] = a > 40 && luma < 200 ? a : 0;
    }

    await document.fonts.ready;
    window.__drawFrame = drawFrame;
    window.__loopSec = LOOP_SEC;
    window.__rotationOff = true;
    window.__size = () => ({ w: canvas.width, h: canvas.height });
    window.__sceneStats = () => {
      const { w, h } = window.__size();
      const row = ctx.getImageData(0, Math.floor(h / 2), w, 1).data;
      let black = 0;
      for (let x = 0; x < w; x++) {
        if (row[x * 4] < 40) black += 1;
      }
      return {
        ink: black,
        w,
        h,
        grain: window.__layout && window.__layout.grain,
        occupancy: window.__occupancyKey,
        glyphs: window.__glyphCounts,
        rotation: false,
      };
    };
    window.__motionProof = (t0, t1) => {
      drawFrame(t0);
      const occA = window.__occupancyKey;
      const glyA = window.__glyphKey;
      drawFrame(t1);
      const occB = window.__occupancyKey;
      const glyB = window.__glyphKey;
      drawFrame(t0);
      const occC = window.__occupancyKey;
      const glyC = window.__glyphKey;
      return {
        wordStatic: occA === occB && occA === occC,
        glyphsMove: glyA !== glyB,
        glyphsLoop: glyA === glyC,
        occA,
        occB,
        glyA,
        glyB,
      };
    };

    if (!still) raf = requestAnimationFrame(tick);
    else drawFrame(0);

    window.__READY = true;
  }

  boot().catch((err) => {
    console.error(err);
    document.body.style.color = "#000";
    document.body.textContent = String(err && err.message ? err.message : err);
  });
})();
