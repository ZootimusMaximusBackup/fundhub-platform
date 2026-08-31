/* Fundhub money input — ONE parsing rule for every dollar amount a staff
   member types into a screen.

   THE UNIT IS WHOLE DOLLARS, and that is traced, not assumed. The columns
   these values land in are numeric(14,2) — funding_rounds.funded_amount and
   applications.approved_amount (db/schema/001_init.sql). CLAUDE.md §12's
   "money is integer cents" describes src/commissions/money.mjs, which converts
   INTO cents at its own door (src/commissions/calculate.mjs calls
   toCents(round.funded_amount) — proof the column holds dollars). Cents never
   leave src/commissions/. So this module parses to integer cents to do the
   arithmetic exactly, then hands the caller a fixed 2dp DOLLAR string.

   Why cents in the middle: 450.10 * 100 is 45009.999999999996 in JavaScript.
   Multiplying a typed amount by 100 is how a $450.10 approval becomes $450.09.
   We never multiply — we split the string on the decimal point and read the
   two halves as whole numbers.

   BLANK IS NOT ZERO. A blank, a space, or a cancelled box comes back
   { ok:false, reason:"blank" } and the caller must refuse the save. Never
   default an unknown amount to 0 — a zero is a claim that the bank approved
   nothing, and unknown is not nothing. This is the exact bug
   docs/CLOSEOUT-FEE-BASIS.md records and the reason funded moves are guarded
   at all.

   Shared deliberately: pipeline.html and client-control-panel.html both read
   dollars a person typed, and a money rule that differs between two screens is
   the kind of bug that surfaces months later in a payout report. */
(function (global) {
  "use strict";

  /* $1bn, the same ceiling src/commissions/money.mjs uses, so a typo'd amount
     is refused here rather than becoming garbage further down. */
  var MAX_CENTS = 100000000000;

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /* Integer cents -> fixed 2dp dollar string. Mirrors fromCents() in
     src/commissions/money.mjs, which is what a numeric(14,2) column wants. */
  function centsToDollarString(cents) {
    return String(Math.floor(cents / 100)) + "." + pad2(cents % 100);
  }

  /**
   * Parse what a person typed into a dollar amount.
   *
   * Accepts "45000", "$45,000", "45000.00", " $45,000.50 ".
   * Refuses blank, words, negatives, zero, more than two decimal places, and
   * anything over the ceiling. Never guesses and never returns 0 for unknown.
   *
   * @returns {{ok:true,cents:number,dollars:string}}
   *        | {{ok:false,reason:string,message:string}}
   */
  function parseAmount(raw) {
    var BLANK = "Enter the dollar amount. Leaving it empty is not the same as zero.";
    var NAN_MSG = "That is not an amount. Use numbers only, like 45000 or 45,000.50.";

    if (raw === null || raw === undefined) {
      return { ok: false, reason: "blank", message: BLANK };
    }
    var s = String(raw).trim();
    if (!s) {
      return { ok: false, reason: "blank", message: BLANK };
    }

    /* Strip the things people actually type: a dollar sign, thousands commas,
       spaces inside the number, and a leading plus. */
    s = s.replace(/[$,\s]/g, "").replace(/^\+/, "");

    if (s.charAt(0) === "-") {
      return {
        ok: false,
        reason: "negative",
        message: "The amount cannot be negative. Enter the dollars the bank approved."
      };
    }

    var m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) {
      return { ok: false, reason: "not_a_number", message: NAN_MSG };
    }

    var frac = m[2] || "";
    if (frac.length > 2) {
      /* Refuse rather than round. Silently turning 45000.999 into 45001.00 is
         a wrong number that looks right, which is worse than a refusal. */
      return {
        ok: false,
        reason: "too_precise",
        message: "Use at most two numbers after the decimal point, like 45000.50."
      };
    }
    while (frac.length < 2) frac += "0";

    /* No multiply, no float. Both halves are whole numbers. */
    var cents = Number(m[1]) * 100 + Number(frac);
    if (!isFinite(cents) || cents > Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "not_a_number", message: NAN_MSG };
    }
    if (cents === 0) {
      return {
        ok: false,
        reason: "zero",
        message: "The amount must be more than zero. If nothing funded, do not mark it funded."
      };
    }
    if (cents > MAX_CENTS) {
      return {
        ok: false,
        reason: "too_large",
        message: "That amount is too large. Check for an extra digit."
      };
    }

    return { ok: true, cents: cents, dollars: centsToDollarString(cents) };
  }

  global.FHMoneyInput = {
    parseAmount: parseAmount,
    centsToDollarString: centsToDollarString,
    MAX_CENTS: MAX_CENTS
  };
})(window);
