import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoveriesFromFacts, MIN_N_RATE, MIN_N_TIME } from "./discoveries.mjs";

describe("discoveries", () => {
  it("will not invent a rate when n is under the floor", () => {
    const out = discoveriesFromFacts({
      kpis: { new_clients: 3, booked_count: 1, showed_count: 1, funded_count: 0 },
      deposits: 0,
      timedCalls: 0,
      allCalls: 6
    });
    const book = out.all.find((d) => d.id === "lead_to_book");
    assert.equal(book.source, "INSUFFICIENT");
    assert.equal(book.n, 3);
    assert.ok(book.n < MIN_N_RATE);
    assert.match(book.detail, /No invented rate/);
    assert.match(book.headline, /Not enough/);
  });

  it("names the measured leak when n is big enough", () => {
    const out = discoveriesFromFacts({
      kpis: { new_clients: 40, booked_count: 20, showed_count: 10, funded_count: 2 },
      deposits: 8,
      timedCalls: 0,
      allCalls: 10
    });
    const show = out.all.find((d) => d.id === "book_to_show");
    assert.equal(show.source, "MEASURED");
    assert.equal(show.n, 20);
    assert.equal(show.rate, 0.5);
    assert.match(show.headline, /50%/);
  });

  it("refuses to learn call minutes before the time floor", () => {
    const out = discoveriesFromFacts({
      kpis: {},
      timedCalls: MIN_N_TIME - 1,
      allCalls: 40,
      medianCallMinutes: 30
    });
    const t = out.all.find((d) => d.id === "call_minutes");
    assert.equal(t.source, "INSUFFICIENT");
    assert.match(t.headline, /Cannot learn closer call time/);
    assert.ok(!out.top.some((d) => d.kind === "measured_time"));
  });

  it("reports measured call minutes when n hits the floor", () => {
    const out = discoveriesFromFacts({
      kpis: { new_clients: 40, booked_count: 20, showed_count: 12, funded_count: 1 },
      deposits: 4,
      timedCalls: MIN_N_TIME,
      allCalls: 30,
      medianCallMinutes: 38
    });
    const t = out.all.find((d) => d.id === "call_minutes");
    assert.equal(t.source, "MEASURED");
    assert.match(t.headline, /38 minutes/);
    assert.match(t.detail, /not overwritten/);
  });

  it("keeps three top discoveries and a pod finding", () => {
    const out = discoveriesFromFacts({
      kpis: { new_clients: 2, booked_count: 1, showed_count: 0, funded_count: 0 },
      deposits: 0,
      timedCalls: 0,
      allCalls: 0,
      pods: { complete: 1, closer_count: 2, fa_count: 1, complete_with: "funding_advisor" }
    });
    assert.equal(out.top.length, 3);
    assert.ok(out.all.some((d) => d.id === "pod_tandem"));
  });
});
