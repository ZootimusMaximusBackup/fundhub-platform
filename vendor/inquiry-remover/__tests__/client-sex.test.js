"use strict";

const { inferSex, normalizeSex, resolveSex, pickVoice } = require("../src/lib/client-sex");

beforeEach(() => {
  delete process.env.BLAND_VOICE;
  delete process.env.BLAND_VOICE_MALE;
  delete process.env.BLAND_VOICE_FEMALE;
});

describe("inferSex", () => {
  it("infers common male / female first names", () => {
    expect(inferSex("Michael")).toBe("M");
    expect(inferSex("michael")).toBe("M");
    expect(inferSex("Jennifer")).toBe("F");
    expect(inferSex("  Sarah  ")).toBe("F");
    expect(inferSex("Mary Jane")).toBe("F"); // first token
  });

  it("returns unknown for unrecognized or ambiguous names", () => {
    expect(inferSex("Zephyrina")).toBe("unknown");
    expect(inferSex("Jordan")).toBe("unknown"); // ambiguous
    expect(inferSex("Taylor")).toBe("unknown");
    expect(inferSex("")).toBe("unknown");
    expect(inferSex(null)).toBe("unknown");
    expect(inferSex(undefined)).toBe("unknown");
  });
});

describe("normalizeSex", () => {
  it("normalizes stored sex values", () => {
    expect(normalizeSex("male")).toBe("M");
    expect(normalizeSex("F")).toBe("F");
    expect(normalizeSex("Female")).toBe("F");
    expect(normalizeSex("")).toBe("unknown");
    expect(normalizeSex("x")).toBe("unknown");
  });
});

describe("resolveSex", () => {
  it("stored value wins, else infers from name", () => {
    expect(resolveSex("female", "Michael")).toBe("F"); // stored wins
    expect(resolveSex("", "Michael")).toBe("M"); // fall back to inference
    expect(resolveSex(null, "Jennifer")).toBe("F");
    expect(resolveSex("", "Zephyrina")).toBe("unknown");
  });
});

describe("pickVoice", () => {
  it("neutral default until a female id is configured (no regression)", () => {
    expect(pickVoice("F")).toBe("mason");
    expect(pickVoice("M")).toBe("mason");
    expect(pickVoice("unknown")).toBe("mason");
  });

  it("uses env-configured male/female voices when set", () => {
    process.env.BLAND_VOICE_FEMALE = "maya";
    process.env.BLAND_VOICE_MALE = "mason";
    expect(pickVoice("female")).toBe("maya");
    expect(pickVoice("M")).toBe("mason");
    expect(pickVoice("unknown")).toBe("mason");
  });
});
