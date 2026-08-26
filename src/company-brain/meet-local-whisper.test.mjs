import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WHISPER_CREDITS_ERROR, WHISPER_MAX_BYTES } from "./transcribe.mjs";
import {
  processLongPendingMeets,
  probeWhisperWallet,
  whichBin
} from "./meet-local-whisper.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";

function pendingDb(rows) {
  return {
    async query(sql) {
      if (/needs_transcription = true/i.test(sql) && /mime_type LIKE 'video\/%'/i.test(sql)) {
        return { rows };
      }
      return { rows: [] };
    }
  };
}

function ffmpegSpawn() {
  return (cmd, args = []) => {
    if (cmd === "which" && args[0] === "ffmpeg") {
      return { status: 0, stdout: "/usr/bin/ffmpeg\n", stderr: "" };
    }
    const out = args[args.length - 1];
    if (out && typeof out === "string" && !out.includes("%")) {
      fs.writeFileSync(out, Buffer.from("ID3fake-audio"));
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

const creditMiss = async () => ({
  ok: false,
  text: "",
  error: WHISPER_CREDITS_ERROR,
  retryable: true
});

test("whichBin is empty when ffmpeg is missing", () => {
  const spawn = () => ({ status: 1, stdout: "", stderr: "" });
  assert.equal(whichBin("ffmpeg", spawn), null);
});

test("a 429 credit probe does not download Meet files", async () => {
  let downloads = 0;
  const out = await processLongPendingMeets(pendingDb([{
    id: "bf-a",
    drive_file_id: "drv-a",
    name: "Meet Recording - Call A.mp4",
    mime_type: "video/mp4",
    web_view_link: null,
    client_id: null
  }]), {
    orgId: ORG,
    env: { OPENAI_API_KEY: "sk-test" },
    spawn: ffmpegSpawn(),
    pair: async () => ({ applied: 0 }),
    whisper: creditMiss,
    apply: async () => {
      throw new Error("should not apply");
    },
    client: {
      async getFile() { throw new Error("should not size"); },
      async downloadMedia() {
        downloads += 1;
        return Buffer.from("video");
      }
    }
  });
  assert.equal(downloads, 0);
  assert.equal(out.whispered, 0);
  assert.equal(out.reason, WHISPER_CREDITS_ERROR);
});

test("short leftovers stay for the live sweeper", async () => {
  let downloads = 0;
  const out = await processLongPendingMeets(pendingDb([{
    id: "bf-a",
    drive_file_id: "drv-a",
    name: "Meet Recording - Call A.mp4",
    mime_type: "video/mp4",
    web_view_link: null,
    client_id: null
  }]), {
    orgId: ORG,
    env: { OPENAI_API_KEY: "sk-test" },
    spawn: ffmpegSpawn(),
    pair: async () => ({ applied: 0 }),
    probe: false,
    whisper: async () => ({ ok: true, text: "hello" }),
    apply: async () => ({ ok: true }),
    client: {
      async getFile() { return { size: 1_000_000 }; },
      async downloadMedia() {
        downloads += 1;
        return Buffer.from("video");
      }
    }
  });
  assert.equal(downloads, 0);
  assert.equal(out.whispered, 0);
  assert.equal(out.skipped_short, 1);
  assert.equal(out.reason, null);
});

test("a long file is stripped, whispered, and stamped", async () => {
  let applies = 0;
  const out = await processLongPendingMeets(pendingDb([{
    id: "bf-a",
    drive_file_id: "drv-a",
    name: "Meet Recording - Call A.mp4",
    mime_type: "video/mp4",
    web_view_link: "https://drive.example/a",
    client_id: null
  }]), {
    orgId: ORG,
    env: { OPENAI_API_KEY: "sk-test" },
    spawn: ffmpegSpawn(),
    pair: async () => ({ applied: 0 }),
    probe: false,
    whisper: async () => ({ ok: true, text: "closer said three thousand" }),
    apply: async (_db, args) => {
      applies += 1;
      assert.match(args.text, /three thousand/);
      assert.equal(args.extracted.fileId, "drv-a");
      return { ok: true };
    },
    client: {
      async getFile() { return { size: WHISPER_MAX_BYTES + 10 }; },
      async downloadMedia() { return Buffer.from("video-bytes"); }
    }
  });
  assert.equal(applies, 1);
  assert.equal(out.whispered, 1);
  assert.equal(out.reason, null);
});

test("mid-file 429 leaves the row pending", async () => {
  let applies = 0;
  const out = await processLongPendingMeets(pendingDb([{
    id: "bf-a",
    drive_file_id: "drv-a",
    name: "Meet Recording - Call A.mp4",
    mime_type: "video/mp4",
    web_view_link: null,
    client_id: null
  }]), {
    orgId: ORG,
    env: { OPENAI_API_KEY: "sk-test" },
    spawn: ffmpegSpawn(),
    pair: async () => ({ applied: 0 }),
    probe: false,
    whisper: creditMiss,
    apply: async () => {
      applies += 1;
      return { ok: true };
    },
    client: {
      async getFile() { return { size: WHISPER_MAX_BYTES + 10 }; },
      async downloadMedia() { return Buffer.from("video-bytes"); }
    }
  });
  assert.equal(applies, 0);
  assert.equal(out.whispered, 0);
  assert.equal(out.reason, WHISPER_CREDITS_ERROR);
});

test("course videos are not downloaded", async () => {
  let downloads = 0;
  const out = await processLongPendingMeets(pendingDb([{
    id: "bf-course",
    drive_file_id: "drv-course",
    name: "1. Intro to funding.mp4",
    mime_type: "video/mp4",
    web_view_link: null,
    client_id: null
  }]), {
    orgId: ORG,
    env: { OPENAI_API_KEY: "sk-test" },
    spawn: ffmpegSpawn(),
    pair: async () => ({ applied: 0 }),
    probe: false,
    whisper: async () => {
      throw new Error("should not whisper course");
    },
    apply: async () => {
      throw new Error("should not apply course");
    },
    client: {
      async getFile() { throw new Error("should not size course"); },
      async downloadMedia() {
        downloads += 1;
        return Buffer.from("video");
      }
    }
  });
  assert.equal(downloads, 0);
  assert.equal(out.whispered, 0);
  assert.equal(out.skipped, 1);
});

test("wallet probe reports a credit miss", async () => {
  const out = await probeWhisperWallet({
    env: { OPENAI_API_KEY: "sk-test" },
    spawn: ffmpegSpawn(),
    whisper: creditMiss
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, WHISPER_CREDITS_ERROR);
});
