import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const W = 6144;
const H = 3456;
const FPS = 12;
const SECONDS = 48;
const FRAMES = FPS * SECONDS;
const FRAME_DIR = "/tmp/fundhub-ascii-6k-frames";
const OUT = path.join(ROOT, "fundhub-ascii-6k.mp4");
const PROOF = path.join(ROOT, "frame-proof.png");
const PREVIEW = path.join(ROOT, "frame-preview-1920.png");
const STILL_ONLY = process.argv.includes("--still");

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      const file = path.join(ROOT, path.normalize(rel).replace(/^\/+/, ""));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("no");
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        res.writeHead(200, { "content-type": mime(file) });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code})\n${err}`));
    });
  });
}

async function encode(attempt) {
  if (attempt === 1) {
    return run("ffmpeg", [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      path.join(FRAME_DIR, "frame-%04d.png"),
      "-c:v",
      "libx265",
      "-preset",
      "fast",
      "-crf",
      "12",
      "-tag:v",
      "hvc1",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      OUT,
    ]);
  }
  return run("ffmpeg", [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    path.join(FRAME_DIR, "frame-%04d.png"),
    "-c:v",
    "hevc_videotoolbox",
    "-b:v",
    "24M",
    "-constant_bit_rate",
    "true",
    "-tag:v",
    "hvc1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    OUT,
  ]);
}

const { server, port } = await startServer();
fs.rmSync(FRAME_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"],
});

const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});

const url = `http://127.0.0.1:${port}/index.html?w=${W}&h=${H}&still=1`;
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => window.__READY === true, { timeout: 120000 });

const t0 = Date.now();
await page.evaluate((t) => window.__drawFrame(t), 0);
const firstPng = await page.evaluate(() => document.querySelector("#stage").toDataURL("image/png"));
const firstMs = Date.now() - t0;
const firstBuf = Buffer.from(firstPng.split(",")[1], "base64");
fs.writeFileSync(path.join(FRAME_DIR, "frame-0001.png"), firstBuf);
fs.writeFileSync(PROOF, firstBuf);
const sizeNow = await page.evaluate(() => window.__size());
console.log(`frame1 ${firstBuf.length} bytes in ${firstMs}ms size=${JSON.stringify(sizeNow)}`);

console.log(`scene ${JSON.stringify(await page.evaluate(() => window.__sceneStats()))}`);
console.log(`glyphs ${JSON.stringify(await page.evaluate(() => window.__glyphCounts))}`);
console.log(`rotationOff ${JSON.stringify(await page.evaluate(() => window.__rotationOff === true))}`);

const contrast = await page.evaluate(() => {
  const c = document.querySelector("#stage");
  const c2 = c.getContext("2d");
  const w = c.width;
  const h = c.height;
  const bandH = 128;
  const y0 = Math.max(0, Math.floor(h / 2 - bandH / 2));
  const band = c2.getImageData(0, y0, w, bandH).data;
  const corner = c2.getImageData(8, 8, 1, 1).data;
  let black = 0;
  let white = 0;
  const x0 = Math.floor(w * 0.12);
  const x1 = Math.floor(w * 0.88);
  for (let y = 0; y < bandH; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const luma = 0.299 * band[i] + 0.587 * band[i + 1] + 0.114 * band[i + 2];
      if (luma < 40) black += 1;
      if (luma > 230) white += 1;
    }
  }
  return {
    black,
    white,
    span: (x1 - x0) * bandH,
    corner: [corner[0], corner[1], corner[2], corner[3]],
    size: { w, h },
  };
});
console.log(`contrast ${JSON.stringify(contrast)}`);
if (contrast.black < contrast.span * 0.03) {
  await browser.close();
  server.close();
  throw new Error("word not readable: too few black marks on the center line");
}
if (contrast.corner[0] < 240 || contrast.corner[1] < 240 || contrast.corner[2] < 240) {
  await browser.close();
  server.close();
  throw new Error("empty field is not white");
}

const motion = await page.evaluate(() => window.__motionProof(0, 0.5));
console.log(`motion ${JSON.stringify(motion)}`);
if (!motion.wordStatic) {
  await browser.close();
  server.close();
  throw new Error("word shape moved between frames");
}
if (!motion.glyphsMove) {
  await browser.close();
  server.close();
  throw new Error("glyphs did not change between frames");
}
await page.evaluate((t) => window.__drawFrame(t), 0);

if (STILL_ONLY) {
  await run("ffmpeg", ["-y", "-i", PROOF, "-vf", "scale=1920:-1", PREVIEW]);
  await browser.close();
  server.close();
  console.log(`STILL_ONLY proof ${PROOF}`);
  process.exit(0);
}

const estimate = (firstMs * FRAMES) / 1000;
console.log(`estimate ${FRAMES} frames ≈ ${estimate.toFixed(0)}s`);

for (let i = 1; i < FRAMES; i++) {
  const t = i / FRAMES;
  await page.evaluate((tt) => window.__drawFrame(tt), t);
  const png = await page.evaluate(() => document.querySelector("#stage").toDataURL("image/png"));
  const buf = Buffer.from(png.split(",")[1], "base64");
  fs.writeFileSync(path.join(FRAME_DIR, `frame-${String(i + 1).padStart(4, "0")}.png`), buf);
  if ((i + 1) % 24 === 0 || i + 1 === FRAMES) {
    console.log(`wrote ${i + 1}/${FRAMES}`);
  }
}

await browser.close();

let encoded = false;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    console.log(`encode attempt ${attempt}`);
    await encode(attempt);
    encoded = true;
    break;
  } catch (err) {
    console.error(String(err));
    if (attempt === 2) {
      server.close();
      throw err;
    }
  }
}

const midIdx = Math.floor(FRAMES / 2) + 1;
const midSrc = path.join(FRAME_DIR, `frame-${String(midIdx).padStart(4, "0")}.png`);
const MID = path.join(ROOT, "frame-from-video.png");
fs.copyFileSync(midSrc, MID);
await run("ffmpeg", ["-y", "-i", path.join(FRAME_DIR, "frame-0001.png"), "-vf", "scale=1920:-1", PREVIEW]);
const probe = await run("ffprobe", [
  "-v",
  "error",
  "-select_streams",
  "v:0",
  "-show_entries",
  "stream=width,height,duration,codec_name,avg_frame_rate:format=duration,size",
  "-of",
  "json",
  OUT,
]);
console.log(probe.out);
const st = fs.statSync(OUT);
console.log(`OUT ${OUT}`);
console.log(`size_bytes ${st.size}`);
console.log(`encoded ${encoded}`);

fs.rmSync(FRAME_DIR, { recursive: true, force: true });
server.close();
