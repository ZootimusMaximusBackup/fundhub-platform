#!/usr/bin/env python3
"""
fundhub_gen.py — regenerates the four UnderwriteIQ client deliverables as PDFs.

  1. credit_analysis_report.pdf   (Financial Profile Assessment)
  2. funding_snapshot.pdf         (Capital Readiness Snapshot)
  3. lender_match_list.pdf        (Capital Partner Shortlist)
  4. optimization_roadmap.pdf     (6-Month Business Readiness Roadmap)

Usage:
    pip install weasyprint
    python fundhub_gen.py --out ./out
    python fundhub_gen.py --client client.json --out ./out

All client-specific values live in CLIENT below (or a JSON file with the same
shape). Everything downstream — score math, deltas, tables, lender gaps — is
derived, so swapping the data swaps the whole deliverable set.
"""

import argparse, json, os, datetime
from weasyprint import HTML, CSS

# ----------------------------------------------------------------------------
# 1. CLIENT DATA
# ----------------------------------------------------------------------------

CLIENT = {
    "applicant": "Jordan Sample",
    "date": "July 25, 2026",
    "outcome": "FUNDING_PLUS_REPAIR",
    "address": "5815 Knoll Krest St, San Antonio, TX 78242",
    "state": "Texas",
    "llc_fee": 300,
    "booking_url": "www.fundhubbookingurl.template",

    "scores": {"experian": 630, "equifax": 636, "transunion": 725},
    "score_targets": {"experian": "690+", "equifax": "670+",
                      "transunion": "725+ (already strong)",
                      "median": "680-710 (projected)"},
    "preapproval_now": 7936,
    "preapproval_after": 19841,

    "bureaus": [
        ("TransUnion", "CLEAN", 0, "No derogatory items. Ready for funding now."),
        ("Experian", "DIRTY", 1, "Charge-off from SIGNET BANK/VIRGINIA. This is the "
         "primary bureau. Priority target for repair."),
        ("Equifax", "DIRTY", 7, "Most damaged bureau. Multiple child support lates, "
         "a charge-off, and a bankruptcy. Needs the most work."),
    ],

    # creditor, bureau, balance, limit, util, target, status
    "revolving": [
        ("SYNCB/LEVITZ", "Experian", 1762, 1894, "93%", "$189 or less", "CRITICAL"),
        ("CITIBANK SD NA", "Equifax", 429, 624, "69%", "$62 or less", "HIGH"),
        ("BENEFICIAL", "Experian", 239, None, "Unknown", "Keep low", "MONITOR"),
        ("CAPITAL ONE", "Experian", 124, "$558 (high bal)", "Closed", "N/A - Closed", "CLOSED"),
        ("DISCOVERCARD (x2)", "TransUnion", 0, None, "0%", "Perfect", "CLEAN"),
        ("SYNCB/LEVITZ (old)", "Experian", 0, "$1,230 (high bal)", "Paid/Closed", "N/A", "CLEAN"),
    ],
    "util_total_balance": 2430,
    "util_total_limit": 2518,
    "util_pct": "97%",
    "util_target_balance": 252,

    "au_account": {"creditor": "CITI", "bureau": "TransUnion", "limit": 8400,
                   "balance": 608, "util": "7%", "age": "~66 months"},

    "negatives": [
        {"n": 1, "creditor": "SIGNET BANK/VIRGINIA", "bureau": "Experian",
         "type": "Charge-Off", "balance": "$4,798",
         "why": "Worst item on your PRIMARY bureau. Must be addressed first.",
         "detail": "This is your most urgent item. It is sitting on Experian, your primary "
                   "bureau. A charge-off means the lender gave up trying to collect and wrote "
                   "off the debt as a loss. We start by disputing it with Experian. If it comes "
                   "back verified, then you negotiate. Offer 40-60 cents on the dollar - "
                   "somewhere between $1,919 and $2,879 - but only in exchange for a written "
                   "pay-for-delete agreement. Payment without deletion does nothing for your score."},
        {"n": 2, "creditor": "CONNECTICUT CHILD SU", "bureau": "Equifax",
         "type": "60-Day Lates (28x)", "balance": "$17,148 past due",
         "why": "28 late payments. Actively reporting. Severe ongoing damage.",
         "detail": "This is your most active wound. Twenty-eight 60-day late payments on "
                   "Equifax, most recent December 2025. Child support obligations are hard to "
                   "remove because they are government-backed. Get current and the lates stop "
                   "adding up. Then dispute the older ones and follow with goodwill letters."},
        {"n": 3, "creditor": "VERMONT OFFICE OF CH", "bureau": "Equifax",
         "type": "120+ Day Lates (4x)", "balance": "$521 balance",
         "why": "120-day lates are near charge-off territory. Recent and damaging.",
         "detail": "Four 120-day lates on another child support obligation, most recent "
                   "October 2025. The $521 balance is small. Pay it current, then send a "
                   "goodwill letter. Dispute first, goodwill letter second."},
        {"n": 4, "creditor": "Unknown Creditor", "bureau": "Equifax",
         "type": "Charge-Off (Medical)", "balance": "$194",
         "why": "Small balance but still a charge-off. Easy target for removal.",
         "detail": "A medical charge-off for $194 with the creditor listed as unknown. "
                   "Dispute this one aggressively. Medical charge-offs with unknown creditors "
                   "are among the easiest to remove because the creditor often cannot verify."},
        {"n": 5, "creditor": "SALLIE MAE STUDENT L", "bureau": "Equifax",
         "type": "90-Day Late (1x)", "balance": "$1,853 balance",
         "why": "One 90-day late. Disputable.",
         "detail": "One 90-day late on a student loan - a single incident. Send a goodwill "
                   "letter to Sallie Mae. Servicers respond to goodwill requests more often "
                   "than you think. If they say no, dispute with Equifax directly."},
        {"n": 6, "creditor": "JC PENNEY", "bureau": "Equifax",
         "type": "Bankruptcy Discharged", "balance": "N/A - Closed",
         "why": "Linked to prior bankruptcy. Shows 14 lates including 12 at 90+ days.",
         "detail": "Included in a prior bankruptcy, closed September 2019. Make sure all "
                   "accounts tied to the bankruptcy show zero balance and correct status. "
                   "Bankruptcy accounts that report incorrectly after discharge are common - "
                   "and disputable."},
        {"n": 7, "creditor": "STUDENT LOAN MARKETI (x2)", "bureau": "Equifax",
         "type": "Transferred / Derogatory Flag", "balance": "$0",
         "why": "Transferred accounts flagged as derogatory. Should be cleaned up.",
         "detail": "Two transferred student loan accounts carrying derogatory flags despite "
                   "$0 balances. Transferred accounts should not carry derogatory ratings. "
                   "Strong dispute candidates - the flag is an error."},
    ],

    "inquiries": [
        ("Experian", 23, "HIGH", "Primary bureau. Includes duplicates from RESIDENTCHECK (3x), "
         "GECS (3x), WASHINGTON MUTUAL FI (2x). Strong removal candidates."),
        ("Equifax", 23, "MEDIUM", "Cluster of auto inquiries on May 28, 2024 from 9 different "
         "lenders. Same-day multiples are highly disputable."),
        ("TransUnion", 0, "CLEAN", "No inquiries to address."),
    ],

    "personal_data": [
        ("Name Variations", "2 different names on file across bureaus",
         "Serious mismatch. Dispute immediately to consolidate to your single legal name.", "HIGH"),
        ("SSN Variations", "Two different SSNs on file: one on Equifax, one on TransUnion",
         "Major red flag. Must be corrected before funding. Send ID verification to each bureau.", "HIGH"),
        ("Multiple Addresses", "5 addresses across bureaus: San Antonio TX (2), Robstown TX, "
         "Wahiawa HI, Denton TX",
         "Consolidate to your single current address.", "MEDIUM"),
        ("Employer Variations", "5 different employers listed",
         "Outdated and inconsistent employment data. Clean up to current employer only.", "MEDIUM"),
        ("DOB", "Only one DOB on file (Equifax). Missing from Experian and TransUnion.",
         "Add consistent DOB across all three bureaus via ID verification letters.", "MEDIUM"),
    ],

    "installments": [
        ("ROCKLAND TRUST COMPANY", "Open", "$17,967", "Auto - paying on time"),
        ("HOLIDAY FINANCE INC", "Open", "$4,559", "Paying on time"),
        ("SALLIE MAE STUDENT L", "Open", "$1,853", "1 late - 90-day"),
        ("SALLIE MAE STUDENT L (2nd)", "Open", "$1,187", "Clean"),
        ("SHARON & CRESCENT UNIT", "Paid", "$0", "Clean"),
        ("FORD MOTOR", "Paid", "$0", "Clean"),
        ("SIGNET BANK/VIRGINIA", "CHARGE-OFF", "$4,798", "On Experian"),
    ],
    "mortgages": [
        ("SERVICE & PROF", "Open", "$134,072", "Paying on time"),
        ("CROSSLAND MTG/FHLMC", "Paid", "$0", "Clean"),
        ("700 CREDIT/ZERO MOTORC", "Transferred", "-", "Clean"),
    ],
    "public_obligations": [
        ("CONNECTICUT CHILD SU", "60-Day Lates", "$17,148", "28 lates - On Equifax"),
        ("VERMONT OFFICE OF CH", "120-Day Lates", "$521", "4 lates - On Equifax"),
        ("NC DEPARTMENT OF HUM", "Open", "$1,842", "Paying on time"),
    ],

    # name, category, type, low, high, score, tib, revenue, why
    "lenders": [
        ("Navy Federal Credit Union", "Personal Loans", "Personal Loan", 5000, 15000, 650, None, None,
         "their score floor is 650 - the closest target to where you are right now, and paying "
         "down SYNCB/LEVITZ alone could get you there fast"),
        ("Marcus by Goldman Sachs", "Personal Loans", "Personal Loan", 3500, 40000, 660, None, None,
         "they charge zero fees and offer solid rates - a clean, simple product for someone "
         "building back after a charge-off"),
        ("Lending Club", "Personal Loans", "Personal Loan", 5000, 40000, 700, None, None,
         "no business is required and their loan range lines up with your projected pre-approval"),
        ("SoFi", "Personal Loans", "Personal Loan", 5000, 100000, 700, None, None,
         "their high loan ceiling gives you room to grow once your score crosses 700"),
        ("Chase Sapphire Preferred", "Personal Cards", "Personal Card", 5000, 25000, 700, None, None,
         "you already have paid auto loans and a clean TransUnion bureau - Chase rewards that "
         "kind of payment history"),
        ("Amex Gold", "Personal Cards", "Personal Card", 5000, 25000, 700, None, None,
         "once the charge-off is removed from Experian, Amex rewards clean files with strong "
         "starting limits"),
        ("Capital One Spark Cash", "Business Cards", "Business Card", 5000, 20000, 680, "6 months minimum", None,
         "their score floor is the lowest of the business cards on this list"),
        ("Chase Ink Preferred", "Business Cards", "Business Card", 10000, 25000, 700, "12 months minimum", None,
         "your clean TransUnion bureau is what Chase pulls most often for business cards"),
        ("Amex Blue Business Plus", "Business Cards", "Business Card", 10000, 30000, 700, "12 months minimum", None,
         "no preset spending limit - purchasing power grows with your revenue"),
        ("Kabbage (Amex)", "Business Lines of Credit", "Line of Credit", 2000, 250000, 640, "12 months minimum", "$50,000/year minimum",
         "their score threshold is 640 - your fastest business funding target once you form an LLC"),
        ("Fundbox", "Business Lines of Credit", "Line of Credit", 1000, 150000, 680, "12 months minimum", None,
         "they weigh business bank account activity heavily - strong cash flow can outweigh a lower score"),
        ("OnDeck", "Business Lines of Credit", "Line of Credit", 5000, 250000, 660, "12 months minimum", "$100,000/year minimum",
         "their approval process is fast and flexible once your score clears 660"),
        ("Bluevine", "Business Lines of Credit", "Line of Credit", 5000, 250000, 700, "24 months minimum", "$120,000/year minimum",
         "they offer some of the highest line amounts at competitive rates"),
        ("Credibly", "Business Term Loans", "Term Loan", 5000, 400000, 650, "12 months minimum", "$180,000/year minimum",
         "their score floor is 650 and they offer flexible repayment terms for newer businesses"),
        ("SBA 7(a) Loan", "Business Term Loans", "Term Loan", 25000, 350000, 680, "24 months minimum", None,
         "it carries the lowest interest rates available anywhere - the best money you can borrow"),
    ],
}

# ----------------------------------------------------------------------------
# 2. HELPERS
# ----------------------------------------------------------------------------

def usd(v):
    if v is None:
        return "-"
    if isinstance(v, str):
        return v
    return "${:,}".format(int(v))

def money_range(lo, hi):
    def k(v):
        return f"${v//1000}K" if v % 1000 == 0 else f"${v:,}"
    return f"{k(lo)}-{k(hi)}"

_QR_CACHE = {}
def qr_html(url):
    if url not in _QR_CACHE:
        try:
            import qrcode, io, base64
            img = qrcode.make(url, box_size=6, border=1)
            buf = io.BytesIO(); img.save(buf, format="PNG")
            uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
            _QR_CACHE[url] = f'<img class="qrimg" src="{uri}">'
        except Exception:
            _QR_CACHE[url] = '<div class="qr">[ QR CODE ]</div>'
    return _QR_CACHE[url]

def median(scores):
    return sorted(scores)[1]

def spaced(s):
    """Uppercase label; letter-spacing handled in CSS so text wraps cleanly."""
    return str(s).upper()

def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def parse_pct(util):
    if util is None or util == "":
        return None
    if isinstance(util, (int, float)):
        return int(util)
    try:
        return int(float(str(util).strip().replace("%", "")))
    except ValueError:
        return None


def parse_money(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return int(v)
    token = str(v).replace("$", "").replace(",", "").split()[0]
    try:
        return int(float(token))
    except ValueError:
        return None


def ranked_revolving(c):
    rows = [r for r in (c.get("revolving") or []) if r and r[0]]
    def key(r):
        p = parse_pct(r[4] if len(r) > 4 else None)
        return p if p is not None else -1
    return sorted(rows, key=key, reverse=True)


def target_bal(row):
    if row and len(row) > 5 and row[5]:
        n = parse_money(row[5])
        if n is not None:
            return n
    lim = parse_money(row[3] if row and len(row) > 3 else None)
    if lim is not None and lim > 0:
        return int(round(lim * 0.1))
    return None


def paydown_amt(row):
    bal = parse_money(row[2] if row and len(row) > 2 else None)
    tgt = target_bal(row)
    if bal is None or tgt is None:
        return None
    return max(0, bal - tgt)


# UNKNOWN READS AS UNKNOWN IN EVERY PLACE THE TARGET IS PRINTED.
#
# target_bal() returns None for a card with no credit limit -- a charge card,
# or an account with no preset spending limit. There is no 10% of a number the
# file does not have. Every site that printed a target used to fall back to
# row[5], which is the EMPTY STRING for exactly that card, so the sentence ran
# off the end: "Pay AMEX PLATINUM (NPSL) from $5,200 down to ". The paydown
# table on the same document printed "-" for the same card.
#
# These two helpers are the only way a target reaches the page now.

TARGET_UNKNOWN = "-"


# THREE STATES, NOT TWO. ZERO IS NOT NULL AND NULL IS NOT ZERO.
#
# F52b. The limit cell holds one of three things:
#   * a positive number -- the file states a ceiling, so 10% of it is a target;
#   * the number ZERO   -- the file states a ceiling of nothing. That is a KNOWN
#                          value, not a missing one, and 10% of it is $0, which
#                          is not a paydown target any client can act on;
#   * None / ""         -- the file does not say.
#
# target_bal() used to ask only `lim is not None`, so the middle case computed
# int(round(0 * 0.1)) = 0 and printed as an instruction: "Pay SECURED CARD from
# $900 down to $0", in all four bodies. Saying "no credit limit is reported"
# about a card whose limit IS reported, as $0, is its own false statement, so
# the two cases share the outcome and not the words.
#
# These words are identical in src/deliverables/derive.mjs (noTargetReason,
# noTargetCell) and src/underwrite/black-report-node.mjs (noTargetReason), and
# src/deliverables/three-printer-wording.test.mjs fails if one of the three
# moves without the other two.


def limit_state(row):
    """'known' (a positive stated ceiling), 'zero' (reported $0), or 'unknown'."""
    lim = parse_money(row[3] if row and len(row) > 3 else None)
    if lim is None:
        return "unknown"
    return "known" if lim > 0 else "zero"


def no_target_reason(row):
    """Why this card has no 10% target, in the client's own words."""
    state = limit_state(row)
    if state == "known":
        return ""
    if state == "zero":
        return "The credit limit reported for this card is $0"
    return "No credit limit is reported for this card"


def no_target_cell(row):
    """The same fact as a table cell."""
    state = limit_state(row)
    if state == "known":
        return ""
    return "limit reported as $0" if state == "zero" else "no limit reported"


def no_target_cell_cap(row):
    """no_target_cell() at the start of a cell: 'Limit reported as $0'."""
    cell = no_target_cell(row)
    return (cell[0].upper() + cell[1:]) if cell else ""


def clean_bureaus(c):
    """Bureau names this file shows as CLEAN, in the mapper's own order."""
    return [str(row[0]) for row in (c.get("bureaus") or [])
            if row and len(row) > 1 and row[1] == "CLEAN" and row[0]]


def account_fact_sentences(c):
    """'You have a mortgage.' and its two siblings -- only for rows that exist."""
    out = []
    if c.get("mortgages"):
        out.append("You have a mortgage.")
    if c.get("installments"):
        out.append("You have installment loans.")
    if c.get("revolving"):
        out.append("You have revolving cards.")
    return out


def file_fact_sentences(c):
    """The accounts AND the clean bureaus. Empty file, empty list."""
    out = account_fact_sentences(c)
    clean = clean_bureaus(c)
    if len(clean) == 1:
        out.append(f"You have a clean {clean[0]}.")
    elif len(clean) > 1:
        out.append("You have clean bureaus: " + ", ".join(clean) + ".")
    return out


def high_util_cards(c):
    """Open cards at 50% utilization or more. Unknown utilization is not high."""
    out = []
    for row in open_revolving(c):
        p = parse_pct(row[4] if len(row) > 4 else None)
        if p is not None and p >= 50:
            out.append(row)
    return out


def holding_you_back(c):
    """The closing sentence, with only the things this file actually shows."""
    bits = []
    high = len(high_util_cards(c))
    if high:
        bits.append("one card carrying a high balance - fixable with a paydown plan"
                    if high == 1 else
                    f"{high} cards carrying high balances - fixable with a paydown plan")
    negs = len(c.get("negatives") or [])
    if negs:
        bits.append("one negative item - fixable with dispute letters" if negs == 1
                    else f"{negs} negative items - fixable with dispute letters")
    if not bits:
        return ""
    if len(bits) == 1:
        return (f"the one thing holding you back right now is {bits[0]}. "
                "It is not permanent. It is on the repair list starting Month 1.")
    return (f"the two things holding you back right now are {bits[0]} and {bits[1]}. "
            "Neither one is permanent. Both are on the repair list starting Month 1.")


def target_text(row):
    """The paydown target as printed, or None when the file cannot know it."""
    tgt = target_bal(row)
    return usd(tgt) if tgt is not None else None


def paydown_sentence(row):
    """One card's paydown instruction. Never invents a target."""
    account = row[0] if row else ""
    bal = usd(row[2]) if row and len(row) > 2 else TARGET_UNKNOWN
    tgt = target_text(row)
    if tgt is not None:
        return f"Pay {account} from {bal} down to {tgt}"
    return (f"{account} - {bal} owed. {no_target_reason(row)}, "
            f"so there is no 10% target to pay down to")


def lender_buckets(c):
    """(open to this client today, still locked) out of the CLIENT dict.

    F45. The vendor matcher answers in two buckets and
    black-report-client.mjs:761-762 carries both across as `lenders_now` and
    `lenders_after`. This printer only ever read the flattened `lenders` list,
    so every document it made said "No lenders are matched for immediate
    funding right now" and filed all fifteen under "after optimization" --
    including for a client with five open to him today.

    A client.json written before those two keys existed carries only the flat
    list. The honest reading of that file is that it does not say which are open
    now, so nothing goes in the "now" bucket.
    """
    if c.get("lenders_now") is not None or c.get("lenders_after") is not None:
        return list(c.get("lenders_now") or []), list(c.get("lenders_after") or [])
    return [], list(c.get("lenders") or [])


def util_totals_known(c):
    """True only when the file supports an OVERALL 10% target.

    F52. black-report-client.mjs used to take 10% of the engine's total limit
    without asking whether that total was real. The engine sums
    `effectiveLimit or 0`, so a file whose only open cards report NO limit gives
    a total limit of 0, and 10% of 0 is 0 -- which made "pay down to $0" and a
    paydown equal to the client's ENTIRE balance. The mapper now leaves both
    null on that file, and every site that prints an overall figure asks here
    first. A total built from unknowns is unknown.
    """
    return c.get("util_total_limit") is not None and c.get("util_target_balance") is not None


def open_revolving(c):
    """Revolving rows that are open and carry a creditor name."""
    return [row for row in (c.get("revolving") or [])
            if row and row[0] and not (len(row) > 6 and row[6] == "CLOSED")]


def cards_with_no_target(c):
    """Open revolving rows whose 10% target the file cannot produce."""
    return sum(1 for row in open_revolving(c) if target_bal(row) is None)


def total_paydown_sentence(c, total_pd, start):
    """The Month 1 paydown total, which is a claim and so has to be earned.

    Three cases, and the middle one is the one that is easy to miss:
      * no open card reports a limit -> there is no total, and saying $0 would
        tell the client they owe nothing;
      * some do and some do not -> the total is real for the cards it covers and
        cannot cover the rest, so it says so;
      * all do -> the sentence as it always read.
    """
    # No open revolving cards at all is not "no limit reported" -- there is
    # simply no paydown plan to describe, so nothing is said about one.
    if not open_revolving(c):
        return ""
    if not util_totals_known(c):
        # F52b. "reports a credit limit" is false for a card reporting one of $0.
        return ("<p><b>No open card on this file reports a credit limit above $0, so there is "
                "no 10% total to work back to.</b> Keep the balances moving down and we will "
                "set a target as soon as a limit reports.</p>")
    missing = cards_with_no_target(c)
    tail = ""
    if missing:
        tail = (f" That covers the cards that report a limit above $0. {missing} "
                f"card{'' if missing == 1 else 's'} on this file "
                f"{'has' if missing == 1 else 'have'} no 10% target, so nothing for "
                f"{'it' if missing == 1 else 'them'} is in this number.")
    return (f"<p><b>Total paydown to reach 10% utilization: {usd(total_pd)}.</b>{tail} "
            f"You do not have to do this all at once. {esc(start)}</p>")


def bureau_status(c, label):
    for name, status, count, note in c.get("bureaus") or []:
        if str(name).lower() == label.lower():
            return status, count, note
    return "", 0, ""


def hero_card(c):
    """The card every paydown narrative is built around.

    Every sentence written about the hero states its utilization and its 10%
    target, so a card that has neither cannot be one. ranked_revolving() sorts
    unknown utilization last, so this only bites when the whole file is cards
    with no reported limit -- and then there is no hero, the narrative is
    skipped, and nothing false is printed in its place.
    """
    for row in ranked_revolving(c):
        if parse_pct(row[4] if len(row) > 4 else None) is None:
            continue
        if target_bal(row) is None:
            continue
        return row
    return None


def fastest_wins(c):
    wins = []
    for row in ranked_revolving(c)[:2]:
        wins.append(paydown_sentence(row))
    negs = c.get("negatives") or []
    if negs:
        n = negs[0]
        wins.append(f"Send dispute letters for {n.get('creditor')} on {n.get('bureau')}")
    return wins

# ----------------------------------------------------------------------------
# 3. SHARED CSS + CHROME
# ----------------------------------------------------------------------------

BASE_CSS = """
@page {
  size: Letter; margin: 22mm 18mm 20mm 18mm;
  @bottom-left {
    content: "fundhub. ·confidential ·prepared for %(applicant_lc)s";
    font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
    color: #9a9a9a; letter-spacing: .06em;
  }
  @bottom-right {
    content: "%(footer)s ·" counter(page) " / " counter(pages);
    font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
    color: #9a9a9a; letter-spacing: .06em;
  }
}
@page cover { margin: 0; background: #0c0c0c;
  @bottom-left { content: ""; } @bottom-right { content: ""; } }

* { box-sizing: border-box; }
body { font-family: "Inter", "Arial", sans-serif; font-size: 10pt;
       color: #111; line-height: 1.62; margin: 0; }
h1 { font-size: 21pt; letter-spacing: -.02em; margin: 0 0 4px; }
h2 { font-size: 15pt; letter-spacing: -.015em; margin: 0 0 2px; }
h3 { font-size: 11pt; margin: 22px 0 8px; }
p  { margin: 0 0 11px; }

.eyebrow { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
           letter-spacing: .28em; color: #999; margin: 34px 0 4px; }
.rule { height: 3px; margin: 6px 0 14px;
        background: linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45); }
.mono { font-family: "JetBrains Mono", monospace; }
.small { font-size: 8pt; color: #666; }
.note { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
        letter-spacing: .12em; color: #a5a5a5; margin: 6px 0 14px; }

.callout { border: 1px solid #ddd; padding: 14px 16px; margin: 16px 0 18px; }
.callout.bar { border: none; border-left: 3px solid #111; background: #f5f5f5;
               padding: 11px 14px; }

table { width: 100%%; border-collapse: collapse; margin: 6px 0 14px; }
th { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
     letter-spacing: .18em; color: #888; text-align: left;
     font-weight: normal; padding: 0 8px 7px 0; border-bottom: 1.5px solid #111; }
td { padding: 12px 8px 12px 0; border-bottom: .5px solid #e2e2e2;
     vertical-align: top; font-size: 9.5pt; }
td.num, th.num { text-align: right; padding-right: 0; }

.tag { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
       letter-spacing: .14em; padding: 2px 6px; border: 1px solid #111;
       white-space: nowrap; }
.tag.solid { background: #111; color: #fff; }
.tag.grey  { background: #7a7a7a; color: #fff; border-color: #7a7a7a; }
.tag.open  { color: #444; border-color: #bbb; }

.cards { display: flex; gap: 10px; margin: 10px 0 14px; }
.card { flex: 1; border: 1px solid #ddd; border-top: 3px solid #111; padding: 14px; }
.card .lbl { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
             letter-spacing: .2em; color: #999; }
.card .big { font-family: "JetBrains Mono", monospace; font-size: 23pt; margin: 6px 0 2px; }
.card .sub { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
             letter-spacing: .14em; color: #444; margin-bottom: 6px; }
.card .body { font-size: 8pt; color: #555; line-height: 1.45; }

.hero { border-top: 3px solid #111; border-bottom: 3px solid #111; padding: 20px 22px;
        margin: 10px 0 18px; }
.hero .amount { font-family: "JetBrains Mono", monospace; font-size: 34pt;
                letter-spacing: -.02em; }

/* utilization bars */
.bar-row { margin: 0 0 12px; }
.bar-row .head { display: flex; justify-content: space-between; font-weight: bold;
                 font-size: 9pt; }
.bar-track { position: relative; height: 15px; background: #e6e6e6; margin-top: 4px; }
.bar-fill  { position: absolute; left: 0; top: 0; bottom: 0; background: #111; }
.bar-mark  { position: absolute; top: -3px; bottom: -3px; width: 0;
             border-left: 1px dashed #111; }

/* stepper */
.steps { margin: 8px 0 14px; }
.step { display: flex; gap: 10px; padding: 7px 0; border-bottom: .5px solid #eee; }
.step .n { width: 20px; height: 20px; border-radius: 50%%; background: #111; color: #fff;
           font-family: "JetBrains Mono", monospace; font-size: 7.5pt;
           text-align: center; line-height: 20px; flex: none; }
.step .t { font-weight: bold; font-size: 9pt; }
.step .d { font-family: "JetBrains Mono", monospace; font-size: 7pt;
           letter-spacing: .1em; color: #888; }

/* timeline */
.tl { display: flex; margin: 12px 0 6px; border-top: 1.5px solid #111; }
.tl .m { flex: 1; padding: 10px 6px 12px; border-right: .5px solid #e2e2e2; }
.tl .m:last-child { border-right: none; }
.tl .m .k { font-family: "JetBrains Mono", monospace; font-size: 6pt;
            letter-spacing: .16em; color: #999; }
.tl .m .h { font-weight: bold; font-size: 9pt; margin: 2px 0 3px; }
.tl .m .b { font-size: 7.5pt; color: #666; line-height: 1.4; }

/* checklist */
.check { margin: 0 0 4px; font-size: 9pt; }
.check::before { content: "☐  "; font-family: "JetBrains Mono", monospace; color: #777; }

ul.plain { margin: 4px 0 12px; padding-left: 16px; }
ul.plain li { margin-bottom: 7px; }

.lender { border: 1px solid #ddd; padding: 16px 16px; margin: 0 0 14px;
          break-inside: avoid; }
.lender .nm { font-weight: bold; font-size: 11pt; margin-bottom: 6px; }
.lender .kv { display: flex; justify-content: space-between; padding: 3px 0;
              border-bottom: .5px solid #eee; font-size: 8.5pt; }
.lender .kv .k { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                 letter-spacing: .16em; color: #888; }
.lender .why { font-size: 8.5pt; color: #444; margin-top: 8px; line-height: 1.45; }

.pagebreak { break-after: page; }

/* --- diagrams --- */
svg text { font-family: "JetBrains Mono", monospace; }
.diagram { margin: 18px 0 20px; }
.flowrow { display: flex; align-items: stretch; gap: 0; margin: 10px 0 8px; }
.flowbox { flex: 1; border: 1.5px solid #111; padding: 12px 10px; text-align: center; }
.flowbox .fl { font-family: "JetBrains Mono", monospace; font-size: 6pt;
               letter-spacing: .2em; color: #999; }
.flowbox .ft { font-weight: bold; font-size: 10pt; margin: 4px 0 2px; }
.flowbox .fs { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
               letter-spacing: .08em; color: #777; }
.flowbox.hl { border-width: 2px;
  border-top: 4px solid; border-image:
  linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45) 1; }
.flowarrow { align-self: center; padding: 0 7px; font-size: 13pt; }
.midlabel { text-align: center; font-family: "JetBrains Mono", monospace;
            font-size: 6.5pt; letter-spacing: .2em; font-weight: bold; }
.midarrow { text-align: center; font-size: 12pt; line-height: 1; margin: 2px 0 6px; }
.scorebox { flex: 1; border: 1px solid #ddd; padding: 14px 10px; text-align: center; }
.scorebox .sl { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                letter-spacing: .22em; color: #999; }
.scorebox .sn { font-family: "JetBrains Mono", monospace; font-size: 26pt; margin: 8px 0 4px; }
.scorebox .ss { font-size: 8pt; color: #777; }
.scorebox .sb { font-family: "JetBrains Mono", monospace; font-size: 6pt;
                letter-spacing: .22em; color: #999; margin-top: 10px; }
.scorebox.hl { border: 2px solid #111; border-top: 4px solid; border-image:
  linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45) 1; }
.scorebox.hl .sb { color: #111; font-weight: bold; }

/* month timeline w/ numbered circles */
.mrow { display: flex; margin: 14px 0 4px; }
.mcol { flex: 1; text-align: center; padding: 0 4px; }
.mcol .circ { width: 17px; height: 17px; border-radius: 50%%; background: #111;
              color: #fff; font-family: "JetBrains Mono", monospace; font-size: 8pt;
              line-height: 17px; margin: 0 auto 8px; }
.mcol .mk { font-family: "JetBrains Mono", monospace; font-size: 6pt;
            letter-spacing: .2em; color: #999; }
.mcol .mt { font-weight: bold; font-size: 9.5pt; margin: 2px 0 3px; }
.mcol .mb { font-size: 7.5pt; color: #888; line-height: 1.45; }
.mcol .mex { font-family: "JetBrains Mono", monospace; font-size: 7pt;
             font-weight: bold; margin-top: 8px; }

.side { display: flex; gap: 20px; align-items: flex-start; }
.side .grow { flex: 1; }

/* v2 variant: rainbow gradient stat cards */
body.v2 .scorebox, body.v2 .card {
  background: linear-gradient(160deg,#7b5cff 0%%,#3aa0ff 26%%,#2fd6c3 50%%,
              #7bd44a 66%%,#f5c542 82%%,#ff7a45 100%%);
  border: 1px solid #bbb; }
body.v2 .scorebox .sl, body.v2 .card .lbl { color: rgba(255,255,255,.85); }
body.v2 .scorebox .ss, body.v2 .card .body { color: #10312b; }
body.v2 .card .sub { color: #0e2a25; }
"""

COVER_CSS = """
/* --- full-bleed BLACK pages: cover + final CTA --- */
.cover, .cta-page { page: cover; height: 100vh; padding: 26mm 20mm;
                    position: relative; background: #0c0c0c; color: #fff; }
.cover { break-after: page; }
.cta-page { break-before: page; }

.cover .brand, .cta-page .brand { font-size: 15pt; font-weight: bold;
                                  letter-spacing: -.02em; color: #fff; }
.cover .kicker { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                 letter-spacing: .3em; color: #7d7d7d; margin-left: 10px; }
.cover .doctype { font-family: "JetBrains Mono", monospace; font-size: 7pt;
                  letter-spacing: .3em; color: #7d7d7d; margin-top: 58mm; }
.cover .accent { height: 3px; width: 46mm; margin: 8px 0 6px;
                 background: linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45); }
.cover h1 { font-size: 34pt; line-height: 1.08; margin: 6px 0 40px;
            max-width: 82%; color: #fff; }
.cover .meta { display: flex; gap: 34px; border-top: 1.5px solid #3a3a3a;
               padding-top: 12px; }
.cover .meta .k { font-family: "JetBrains Mono", monospace; font-size: 6pt;
                  letter-spacing: .22em; color: #7d7d7d; }
.cover .meta .v { font-size: 10pt; margin-top: 3px; color: #fff; }
.foot-dark { position: absolute; bottom: 20mm; left: 20mm; right: 20mm;
             display: flex; justify-content: space-between;
             font-family: "JetBrains Mono", monospace; font-size: 6pt;
             letter-spacing: .22em; color: #7d7d7d; }
.foot-dark .dot { color: #35d07f; letter-spacing: 0; margin-right: 6px; }

.cta-page h2 { font-size: 22pt; color: #fff; margin-top: 42mm; }
.cta-page p { color: #cfcfcf; max-width: 70%; }
.cta-page .rule { width: 46mm; }
.qr { border: 1px solid #3a3a3a; background: #161616; width: 120px; height: 120px;
      margin: 22px 0 10px; font-family: "JetBrains Mono", monospace;
      font-size: 6.5pt; color: #6a6a6a; text-align: center; line-height: 120px;
      letter-spacing: .18em; }
.qrimg { width: 118px; height: 118px; background: #fff; padding: 8px;
         margin: 22px 0 12px; }
.cta-page .url { font-family: "JetBrains Mono", monospace; font-size: 9.5pt;
                 color: #fff; margin-top: 10px; }
.cta-page .small { color: #8a8a8a; }
.cta-page .lbl { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                 letter-spacing: .22em; color: #7d7d7d; }
"""

def cover(c, doctype, title, footer_label):
    return f"""
<div class="cover">
  <div><span class="brand">fundhub.</span>
       <span class="kicker">{spaced('underwrite iq')} / {spaced('client deliverable')}</span></div>
  <div class="doctype">{spaced(doctype)}</div>
  <div class="accent"></div>
  <h1>{esc(title)}</h1>
  <div class="meta">
    <div><div class="k">{spaced('applicant')}</div><div class="v">{esc(c['applicant'])}</div></div>
    <div><div class="k">{spaced('date')}</div><div class="v">{esc(c['date'])}</div></div>
    <div><div class="k">{spaced('outcome')}</div><div class="v">{esc(c['outcome'])}</div></div>
    <div><div class="k">{spaced('median score')}</div>
         <div class="v">{median(list(c['scores'].values()))}</div></div>
  </div>
  <div class="foot-dark">
    <span><span class="dot">●</span>{spaced('diagnostic complete')} · {spaced('underwriteiq')}</span>
    <span>{spaced('fundhub confidential')}</span>
  </div>
</div>"""

def cta_page(c):
    # F53. THE LAST PAGE OF ALL FOUR DOCUMENTS said "You have clean bureaus ready
    # for funding now." to every client, including one whose every bureau this
    # system had just marked DIRTY. The lead now comes off the file.
    clean = clean_bureaus(c)
    open_now, _locked = lender_buckets(c)
    if clean:
        lead = ("You have " + ("a clean bureau" if len(clean) == 1 else "clean bureaus")
                + " ready for funding now - " + ", ".join(clean) + ". Apply on "
                + ("it" if len(clean) == 1 else "those") + " while we repair the rest in "
                "parallel.")
    elif open_now:
        lead = (f"You have {len(open_now)} lender{'' if len(open_now) == 1 else 's'} you can "
                "apply to today. Book the call and we will work the list in the right order.")
    else:
        lead = ("Book the call and we will put the fixes in this pack in the order that "
                "unlocks the most money.")
    return f"""
<div class="cta-page">
  <div><span class="brand">fundhub.</span>
       <span class="kicker" style="font-family:'JetBrains Mono',monospace;font-size:6.5pt;
             letter-spacing:.3em;color:#7d7d7d;margin-left:10px;">{spaced('next steps')}</span></div>
  <h2>Let Us Build Your Game Plan Together</h2>
  <div class="rule"></div>
  <p>{esc(lead)}</p>
  {qr_html(c['booking_url'])}
  <div class="lbl">{spaced('scan to book your call instantly')}</div>
  <p class="url">{esc(c['booking_url'])}</p>
  <p class="small">Or copy this link into your browser</p>
  <div class="foot-dark">
    <span><span class="dot">●</span>{spaced('systems nominal')} · {spaced('fundhub.ai')}</span>
    <span>{spaced('fundhub confidential')}</span>
  </div>
</div>"""

def render(html_body, c, footer_label, outpath, variant=""):
    css = (BASE_CSS % {"applicant_lc": c["applicant"].lower(),
                       "footer": footer_label}) + COVER_CSS
    doc = f"<html><head><meta charset='utf-8'></head><body class='{variant}'>{html_body}</body></html>"
    HTML(string=doc).write_pdf(outpath, stylesheets=[CSS(string=css)])
    return outpath

PB = '<div class="pagebreak"></div>'

def section(num, label, heading):
    return (f'<div class="eyebrow">{num} / {spaced(label)}</div>'
            f'<h2>{esc(heading)}</h2><div class="rule"></div>')

def table(headers, rows, numeric_cols=()):
    th = "".join(f'<th class="{"num" if i in numeric_cols else ""}">{spaced(h)}</th>'
                 for i, h in enumerate(headers))
    trs = []
    for r in rows:
        tds = "".join(f'<td class="{"num" if i in numeric_cols else ""}">{cell}</td>'
                      for i, cell in enumerate(r))
        trs.append(f"<tr>{tds}</tr>")
    return f"<table><thead><tr>{th}</tr></thead><tbody>{''.join(trs)}</tbody></table>"

def util_bar(label, sub, pct):
    return f"""
<div class="bar-row">
  <div class="head"><span>{esc(label)}</span><span>{pct}%</span></div>
  <div class="bar-track">
    <div class="bar-fill" style="width:{min(pct,100)}%"></div>
    <div class="bar-mark" style="left:10%"></div>
  </div>
  <div class="small">{esc(sub)}</div>
</div>"""

# ----------------------------------------------------------------------------
# 2b. SVG DIAGRAMS (matching the original deck's line art)
# ----------------------------------------------------------------------------

ARROW_DEF = ('<defs><marker id="ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" '
             'orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#111"/></marker>'
             '<linearGradient id="rb" x1="0" y1="0" x2="1" y2="0">'
             '<stop offset="0" stop-color="#7b5cff"/><stop offset=".25" stop-color="#3aa0ff"/>'
             '<stop offset=".5" stop-color="#2fd6c3"/><stop offset=".7" stop-color="#7bd44a"/>'
             '<stop offset=".85" stop-color="#f5c542"/><stop offset="1" stop-color="#ff7a45"/>'
             '</linearGradient></defs>')

def _box(x, y, w, h, lines, fill="#fff", stroke="#111", sw=1.5, tcol="#111"):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" '
           f'stroke="{stroke}" stroke-width="{sw}"/>']
    cy = y + h/2 - (len(lines)-1)*6
    for txt, size, weight, col in lines:
        out.append(f'<text x="{x+w/2}" y="{cy}" text-anchor="middle" font-size="{size}" '
                   f'font-weight="{weight}" fill="{col or tcol}" letter-spacing="1">{esc(txt)}</text>')
        cy += 13
    return "".join(out)

def svg_two_track(now, after):
    s = [f'<svg class="diagram" viewBox="0 0 700 210" width="100%">{ARROW_DEF}']
    s.append('<text x="8" y="52" font-size="7" letter-spacing="2" fill="#111" '
             'font-weight="bold">YOU ARE HERE</text>')
    s.append(_box(8, 60, 92, 52, [("START", 9, "bold", "#fff"),
                                  ("DIAGNOSTIC DONE", 5.5, "normal", "#9a9a9a")], fill="#111"))
    s.append('<text x="170" y="30" font-size="6.5" letter-spacing="2" fill="#777">TRACK 1 · FUND NOW</text>')
    s.append(_box(170, 38, 190, 46, [("Apply on your clean file", 9.5, "bold", None),
                                     (f"{now} AVAILABLE TODAY", 6.5, "normal", "#999")]))
    s.append('<text x="170" y="122" font-size="6.5" letter-spacing="2" fill="#777">TRACK 2 · REPAIR</text>')
    for i, x in enumerate((170, 258, 346)):
        s.append(_box(x, 130, 74, 44, [(f"ROUND {i+1}", 8.5, "bold", None),
                                       ("DISPUTE", 5.5, "normal", "#999")]))
        if i < 2:
            s.append(f'<line x1="{x+74}" y1="152" x2="{x+88}" y2="152" stroke="#111" '
                     f'stroke-width="1.5" marker-end="url(#ah)"/>')
    # connectors: start -> both tracks, both tracks -> recheck
    s.append('<path d="M100,74 L134,74 L134,61 L170,61" fill="none" stroke="#111" stroke-width="1.5"/>')
    s.append('<path d="M100,98 L134,98 L134,152 L170,152" fill="none" stroke="#111" stroke-width="1.5"/>')
    s.append('<path d="M360,61 L470,61 L470,96 L492,96" fill="none" stroke="#111" stroke-width="1.5" marker-end="url(#ah)"/>')
    s.append('<path d="M420,152 L470,152 L470,116 L492,116" fill="none" stroke="#111" stroke-width="1.5"/>')
    s.append(_box(492, 82, 76, 48, [("RE-CHECK", 8, "bold", None),
                                    ("FRESH REPORT", 5.5, "normal", "#999")]))
    s.append('<line x1="568" y1="106" x2="588" y2="106" stroke="#111" stroke-width="1.5" marker-end="url(#ah)"/>')
    s.append('<rect x="590" y="78" width="102" height="6" fill="url(#rb)"/>')
    s.append(_box(590, 84, 102, 48, [(after, 12, "bold", None),
                                     ("BIGGER APPROVALS", 5.5, "normal", "#999")], sw=2))
    s.append('<text x="170" y="192" font-size="6" letter-spacing="2" fill="#aaa">'
             'EACH ROUND: DISPUTE · WAIT 30 DAYS · VERIFY · THEN THE NEXT</text>')
    s.append('</svg>')
    return "".join(s)

def svg_paydown_bars(bal, amt, target):
    s = [f'<svg class="diagram" viewBox="0 0 700 265" width="100%">{ARROW_DEF}']
    s.append('<text x="115" y="16" text-anchor="middle" font-size="7" letter-spacing="2" fill="#777">TODAY</text>')
    s.append('<text x="592" y="16" text-anchor="middle" font-size="7" letter-spacing="2" fill="#111" font-weight="bold">THE GOAL</text>')
    s.append('<rect x="55" y="28" width="120" height="212" fill="#111"/>')          # 93% full
    s.append('<line x1="175" y1="34" x2="205" y2="34" stroke="#111" stroke-width="1"/>')
    s.append(f'<text x="212" y="38" font-size="14" font-weight="bold">{esc(bal)}</text>')
    s.append('<text x="212" y="52" font-size="6.5" letter-spacing="2" fill="#999">93% FULL</text>')
    s.append(f'<text x="390" y="118" text-anchor="middle" font-size="8" font-weight="bold" '
             f'letter-spacing="2">PAY DOWN {esc(amt)}</text>')
    s.append('<line x1="255" y1="132" x2="520" y2="132" stroke="#111" stroke-width="2" marker-end="url(#ah)"/>')
    s.append('<text x="390" y="152" text-anchor="middle" font-size="7.5" fill="#999" '
             'font-family="Inter">the fastest win on your entire report</text>')
    s.append('<line x1="20" y1="218" x2="680" y2="218" stroke="#111" stroke-width="1" stroke-dasharray="4,4"/>')
    s.append('<text x="350" y="212" text-anchor="middle" font-size="7" letter-spacing="2" '
             'font-weight="bold">THE SAFE ZONE · UNDER 10%</text>')
    s.append(f'<text x="524" y="224" text-anchor="end" font-size="11" font-weight="bold">{esc(target)}</text>')
    s.append('<rect x="532" y="222" width="120" height="18" fill="#111"/>')          # goal bar
    s.append('<line x1="532" y1="28" x2="532" y2="240" stroke="#111" stroke-width="1"/>')
    s.append('<line x1="652" y1="28" x2="652" y2="240" stroke="#111" stroke-width="1"/>')
    s.append('</svg>')
    return "".join(s)

def svg_severity(items):
    """items: list of (num, name, sub) ordered left(least) -> right(worst)."""
    s = [f'<svg class="diagram" viewBox="0 0 700 190" width="100%">{ARROW_DEF}']
    y = 95
    s.append(f'<line x1="20" y1="{y}" x2="668" y2="{y}" stroke="#111" stroke-width="2"/>')
    s.append(f'<path d="M668,{y-5} L680,{y} L668,{y+5} z" fill="#111"/>')
    n = len(items)
    for i, (num, name, sub) in enumerate(items):
        x = 55 + i * (590 / (n - 1))
        above = (i % 2 == 0)
        ly = y - 42 if above else y + 44
        s.append(f'<line x1="{x}" y1="{y}" x2="{x}" y2="{ly + (8 if above else -14)}" '
                 f'stroke="#ccc" stroke-width="1"/>')
        s.append(f'<circle cx="{x}" cy="{y}" r="9" fill="#111"/>')
        s.append(f'<text x="{x}" y="{y+3}" text-anchor="middle" font-size="7.5" fill="#fff">{num}</text>')
        s.append(f'<text x="{x}" y="{ly}" text-anchor="middle" font-size="8" '
                 f'font-weight="bold" font-family="Inter">{esc(name)}</text>')
        s.append(f'<text x="{x}" y="{ly+11}" text-anchor="middle" font-size="6.8" fill="#999" '
                 f'font-family="Inter">{esc(sub)}</text>')
    s.append(f'<text x="30" y="{y+22}" font-size="6" letter-spacing="2" fill="#999">HURTS LESS · EASIER TO FIX</text>')
    s.append(f'<text x="668" y="{y+22}" text-anchor="end" font-size="6" letter-spacing="2" '
             f'font-weight="bold">HURTS MOST · FIX FIRST</text>')
    s.append('</svg>')
    return "".join(s)

def svg_waterfall(v_now, v_delta, v_after, labels):
    s = [f'<svg class="diagram" viewBox="0 0 700 250" width="100%">{ARROW_DEF}']
    base, top1, top2 = 205, 130, 45
    s.append(f'<text x="130" y="{top1-10}" text-anchor="middle" font-size="13" font-weight="bold">{esc(v_now)}</text>')
    s.append(f'<rect x="65" y="{top1}" width="130" height="{base-top1}" fill="#111"/>')
    s.append(f'<line x1="195" y1="{top1}" x2="290" y2="{top1}" stroke="#aaa" stroke-dasharray="3,3"/>')
    s.append(f'<text x="355" y="{top2-10}" text-anchor="middle" font-size="13" font-weight="bold">{esc(v_delta)}</text>')
    s.append(f'<rect x="290" y="{top2}" width="130" height="4" fill="url(#rb)"/>')
    s.append(f'<rect x="290" y="{top2+4}" width="130" height="{top1-top2-4}" fill="#f4f4f4" stroke="#111" stroke-width="1.2"/>')
    s.append(f'<line x1="420" y1="{top2}" x2="530" y2="{top2}" stroke="#aaa" stroke-dasharray="3,3"/>')
    s.append(f'<text x="595" y="{top2-10}" text-anchor="middle" font-size="13" font-weight="bold">{esc(v_after)}</text>')
    s.append(f'<rect x="530" y="{top2}" width="130" height="{base-top2}" fill="#111"/>')
    s.append(f'<line x1="30" y1="{base}" x2="680" y2="{base}" stroke="#111" stroke-width="1.2"/>')
    for cx, (t, b) in zip((130, 355, 595), labels):
        s.append(f'<text x="{cx}" y="{base+18}" text-anchor="middle" font-size="6.5" '
                 f'letter-spacing="2" fill="#777">{esc(t)}</text>')
        s.append(f'<text x="{cx}" y="{base+31}" text-anchor="middle" font-size="7.5" fill="#999" '
                 f'font-family="Inter">{esc(b)}</text>')
    s.append('</svg>')
    return "".join(s)

def svg_score_ruler(med, ticks=(640, 650, 660, 680, 700), lo=615, hi=712):
    def X(v): return 30 + (v - lo) / (hi - lo) * 630
    s = ['<svg class="diagram" viewBox="0 0 700 60" width="100%">']
    s.append(f'<text x="{X(med)-4}" y="12" font-size="7.5" letter-spacing="2" '
             f'font-weight="bold">YOUR MEDIAN SCORE {med}</text>')
    s.append(f'<line x1="30" y1="30" x2="660" y2="30" stroke="#bbb" stroke-width="1.5"/>')
    s.append(f'<line x1="30" y1="30" x2="{X(med)}" y2="30" stroke="#111" stroke-width="3"/>')
    s.append(f'<path d="M{X(med)-6},19 L{X(med)+6},19 L{X(med)},29 z" fill="#111"/>')
    for t in ticks:
        s.append(f'<line x1="{X(t)}" y1="24" x2="{X(t)}" y2="36" stroke="#888"/>')
        s.append(f'<text x="{X(t)}" y="50" text-anchor="middle" font-size="7.5" fill="#777">{t}</text>')
    s.append('</svg>')
    return "".join(s)

def svg_shotgun():
    s = ['<svg viewBox="0 0 200 190" width="100%">']
    s.append('<rect x="1" y="1" width="198" height="188" fill="#fafafa" stroke="#ddd"/>')
    pts = [(52, 38), (120, 30), (158, 55), (165, 95), (140, 132), (68, 128)]
    for px, py in pts:
        s.append(f'<line x1="100" y1="85" x2="{px}" y2="{py}" stroke="#bbb" stroke-width="1"/>')
        s.append(f'<circle cx="{px}" cy="{py}" r="3.5" fill="#fff" stroke="#999"/>')
    s.append('<circle cx="100" cy="85" r="4" fill="#888"/>')
    s.append('<line x1="18" y1="18" x2="182" y2="152" stroke="#111" stroke-width="5"/>')
    s.append('<line x1="182" y1="18" x2="18" y2="152" stroke="#111" stroke-width="5"/>')
    s.append('<text x="100" y="166" text-anchor="middle" font-size="8.5" letter-spacing="2" '
             'font-weight="bold">THE SHOTGUN</text>')
    s.append('<text x="100" y="179" text-anchor="middle" font-size="6" letter-spacing="1.5" '
             'fill="#999">HARD INQUIRIES · AUTO-DECLINES</text>')
    s.append('</svg>')
    return "".join(s)

def svg_projection(today, projected):
    s = ['<svg class="diagram" viewBox="0 0 700 140" width="100%">']
    s.append('<defs><linearGradient id="rb2" x1="0" y1="0" x2="0" y2="1">'
             '<stop offset="0" stop-color="#7b5cff"/><stop offset=".5" stop-color="#2fd6c3"/>'
             '<stop offset="1" stop-color="#f5c542"/></linearGradient></defs>')
    s.append('<polygon points="90,112 648,42 648,58" fill="#efefef"/>')
    s.append('<line x1="90" y1="112" x2="648" y2="58" stroke="#aaa" stroke-width="1" stroke-dasharray="3,3"/>')
    s.append('<line x1="90" y1="112" x2="648" y2="42" stroke="#111" stroke-width="2"/>')
    s.append('<circle cx="90" cy="112" r="4" fill="#111"/>')
    s.append('<text x="78" y="102" text-anchor="end" font-size="6.5" letter-spacing="2" fill="#999">TODAY</text>')
    s.append(f'<text x="78" y="116" text-anchor="end" font-size="10" font-weight="bold">{today}</text>')
    s.append('<text x="640" y="20" text-anchor="end" font-size="6.5" letter-spacing="2" fill="#999">PROJECTED</text>')
    s.append(f'<text x="640" y="34" text-anchor="end" font-size="10" font-weight="bold">{esc(projected)}</text>')
    s.append('<rect x="648" y="38" width="5" height="24" fill="url(#rb2)"/>')
    s.append('</svg>')
    return "".join(s)

def svg_dispute_flow():
    s = [f'<svg class="diagram" viewBox="0 0 700 200" width="100%">{ARROW_DEF}']
    boxes = [("STEP 1", "Send letters", "round 1 goes out"),
             ("STEP 2", "The 30 day clock", "the law gives|bureaus 30 days"),
             ("STEP 3", "Results come back", "deleted · updated|· verified"),
             ("STEP 4", "Still verified?", "we escalate,|stronger letter")]
    bw, bh, y0, gap = 150, 74, 52, 26
    xs = [12 + i * (bw + gap) for i in range(4)]
    s.append(f'<text x="{xs[1] + bw + gap/2}" y="16" text-anchor="middle" font-size="6.5" '
             f'letter-spacing="2" fill="#999">ROUND 2 · ROUND 3</text>')
    s.append(f'<path d="M{xs[3]+bw/2},{y0} L{xs[3]+bw/2},26 L{xs[1]+bw/2},26 L{xs[1]+bw/2},{y0}" '
             f'fill="none" stroke="#aaa" stroke-width="1" stroke-dasharray="3,3" marker-end="url(#ah)"/>')
    for (lbl, t, sub), x in zip(boxes, xs):
        s.append(f'<rect x="{x}" y="{y0}" width="{bw}" height="{bh}" fill="#fff" stroke="#111" stroke-width="1.5"/>')
        s.append(f'<text x="{x+bw/2}" y="{y0+18}" text-anchor="middle" font-size="6" letter-spacing="2" fill="#999">{lbl}</text>')
        s.append(f'<text x="{x+bw/2}" y="{y0+35}" text-anchor="middle" font-size="9.5" '
                 f'font-weight="bold" font-family="Inter">{esc(t)}</text>')
        for j, ln in enumerate(sub.split("|")):
            s.append(f'<text x="{x+bw/2}" y="{y0+50+j*11}" text-anchor="middle" font-size="6.8" '
                     f'fill="#999">{esc(ln)}</text>')
    for x in xs[:-1]:
        s.append(f'<line x1="{x+bw}" y1="{y0+bh/2}" x2="{x+bw+gap-6}" y2="{y0+bh/2}" '
                 f'stroke="#111" stroke-width="1.8" marker-end="url(#ah)"/>')
    s.append('<circle cx="%d" cy="%d" r="8" fill="#fff" stroke="#111" stroke-width="1.3"/>' % (xs[1]+bw-14, y0+14))
    s.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#111"/>' % (xs[1]+bw-14, y0+14, xs[1]+bw-14, y0+9))
    s.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#111"/>' % (xs[1]+bw-14, y0+14, xs[1]+bw-10, y0+14))
    cx = xs[2] + bw/2
    s.append(f'<line x1="{cx}" y1="{y0+bh}" x2="{cx}" y2="{y0+bh+22}" stroke="#111" '
             f'stroke-width="1.8" marker-end="url(#ah)"/>')
    s.append(f'<text x="{cx}" y="{y0+bh+40}" text-anchor="middle" font-size="7.5" '
             f'letter-spacing="2" font-weight="bold">DELETED = OFF YOUR REPORT</text>')
    s.append('</svg>')
    return "".join(s)

# ----------------------------------------------------------------------------
# 4. DOCUMENT 1 — CREDIT ANALYSIS REPORT
# ----------------------------------------------------------------------------

def has_entity(c):
    """True only when the file names a business entity. No company row, no claim."""
    return bool((c.get("business") or {}).get("hasEntity"))


def entity_name(c):
    """The entity's own name when the file carries one, else a neutral noun."""
    return str((c.get("business") or {}).get("name") or "").strip() or "A business entity"


def pay_down_cards_line(c):
    """How many open cards there actually are to pay down. Never 'your two'."""
    n = len(open_revolving(c))
    if not n:
        return "There are no open revolving cards on this file to pay down."
    if n == 1:
        return "Pay down your open revolving card."
    return f"Pay down your {n} open revolving cards."


def full_repair_means(c):
    """What 'full repair' means ON THIS FILE, rather than on a template one."""
    bits = []
    kinds = [str(n.get("type") or "").lower() for n in (c.get("negatives") or [])]
    if any("charge" in k for k in kinds):
        bits.append("charge-offs removed")
    if any("late" in k for k in kinds):
        bits.append("lates addressed")
    if kinds and not bits:
        bits.append("the negative items on this file addressed")
    if util_totals_known(c):
        bits.append("utilization under 10%")
    return ", ".join(bits)


def build_credit_analysis(c):
    s = c["scores"]
    med = median(list(s.values()))
    spread = max(s.values()) - min(s.values())
    h = [cover(c, "credit analysis report", "Financial Profile Assessment",
               "financial profile assessment")]

    # Shared with the roadmap's opening paragraph -- one derivation, not two.
    have_txt = " ".join(account_fact_sentences(c)) or "You have real credit activity."
    first = esc((c.get("applicant") or "Client").split()[0])
    h.append(f"""<p>{first}, let me be straight with you. {esc(have_txt)}
    This report breaks down exactly what is on this file: scores, cards, and what to do next.
    You qualify for funding today based on the numbers in this pack.</p>""")
    h.append('<p><b>Your plan runs on two tracks at the same time.</b></p>')
    h.append(svg_two_track(usd(c["preapproval_now"]), usd(c["preapproval_after"])))
    h.append('<p><b>You do not wait for repair to finish before you get money. Both tracks run '
             'at the same time.</b><br><span style="font-size:9pt">Each dispute round makes the '
             'next application round stronger.</span></p>')
    h.append(f'<div class="note">YOUR OUTCOME: {esc(c["outcome"].lower())} · BOTH TRACKS ARE '
             f'ALREADY IN THIS PLAN</div>')

    # 01 bureaus
    h.append(section("01", "bureaus", "Bureau Health Summary"))
    rows = []
    for name, status, neg, note in c["bureaus"]:
        cls = "tag solid" if status == "DIRTY" else "tag"
        rows.append((esc(name), f'<span class="{cls}">{status}</span>', neg, esc(note)))
    h.append(table(["bureau", "status", "negative items", "notes"], rows))
    ex_status, ex_count, _ = bureau_status(c, "Experian")
    if ex_status == "DIRTY":
        h.append('<div class="callout bar">Experian is the primary bureau lenders pull first. '
                 f'It has {ex_count} negative item{"s" if ex_count != 1 else ""} sitting on it '
                 'right now. That is job one for repair.</div>')
    else:
        h.append('<div class="callout bar">Experian is the primary bureau lenders pull first. '
                 'On this file it is clean.</div>')

    # 02 scores
    h.append(section("02", "scores", "Score Breakdown by Bureau"))
    h.append("<p><b>You do not have one credit score. You have three.</b></p>")
    ranked_scores = sorted(s.items(), key=lambda kv: kv[1])
    low_k, _ = ranked_scores[0]
    mid_k, _ = ranked_scores[1]
    high_k, _ = ranked_scores[2]
    def score_sub(label):
        st, cnt, _ = bureau_status(c, label)
        if st == "CLEAN" or cnt == 0:
            return "Nothing negative on it"
        return f"{cnt} negative item{'s' if cnt != 1 else ''}"
    def score_tag(key):
        if key == mid_k:
            return "YOUR MIDDLE SCORE"
        if key == low_k:
            return "LOWEST"
        return "HIGHEST"
    h.append(f"""
<div class="midlabel">LENDERS PICK THE MIDDLE SCORE</div>
<div class="midarrow">&#8595;</div>
<div class="cards" style="margin-top:0">
  <div class="scorebox{" hl" if mid_k == "experian" else ""}"><div class="sl">EXPERIAN</div><div class="sn">{s['experian']}</div>
    <div class="ss">{score_sub("Experian")}</div><div class="sb">{score_tag("experian")}</div></div>
  <div class="scorebox{" hl" if mid_k == "equifax" else ""}"><div class="sl">EQUIFAX</div><div class="sn">{s['equifax']}</div>
    <div class="ss">{score_sub("Equifax")}</div><div class="sb">{score_tag("equifax")}</div></div>
  <div class="scorebox{" hl" if mid_k == "transunion" else ""}"><div class="sl">TRANSUNION</div><div class="sn">{s['transunion']}</div>
    <div class="ss">{score_sub("TransUnion")}</div><div class="sb">{score_tag("transunion")}</div></div>
</div>
<p><b>Line them up from lowest to highest. Lenders use the middle one. Yours is {med}.</b><br>
<span style="font-size:9pt">They do not match because not every company reports to all three
bureaus. Your best and worst are {spread} points apart. Closing that gap is the job.</span></p>
<div class="note">SCORES FROM YOUR TRI-MERGE REPORT · DETAILS IN THE CARDS BELOW</div>""")
    def card_copy(label, key):
        st, cnt, note = bureau_status(c, label)
        if st == "CLEAN" or cnt == 0:
            return "STRONG", "Your cleanest bureau on this file."
        return "NEEDS WORK", (note or f"{cnt} negative item{'s' if cnt != 1 else ''} on this bureau.")
    tu_tag, tu_body = card_copy("TransUnion", "transunion")
    eq_tag, eq_body = card_copy("Equifax", "equifax")
    ex_tag, ex_body = card_copy("Experian", "experian")
    cards = [
        ("transunion", s["transunion"], tu_tag, tu_body),
        ("equifax", s["equifax"], eq_tag, eq_body),
        ("experian", s["experian"], ex_tag, ex_body),
        ("median score", med, "MIDDLE SCORE LENDERS USE",
         "This is the number most lenders read. Your other two scores sit around it."),
    ]
    h.append('<div class="cards">' + "".join(
        f'<div class="card"><div class="lbl">{spaced(k)}</div><div class="big">{v}</div>'
        f'<div class="sub">{spaced(t)}</div><div class="body">{esc(b)}</div></div>'
        for k, v, t, b in cards) + "</div>")
    h.append(f'<div class="callout bar">There is a {spread}-point spread between your best bureau '
             f'({max(s, key=s.get).title()} {max(s.values())}) and your worst '
             f'({min(s, key=s.get).title()} {min(s.values())}). Close that gap and your funding '
             f'picture changes dramatically.</div>')

    # 03 utilization
    h.append(PB)
    h.append(section("03", "utilization", "Primary Revolving Cards - Utilization Analysis"))
    rows = []
    for cr, br, bal, lim, util, tgt, st in c["revolving"]:
        cls = {"CRITICAL": "tag solid", "HIGH": "tag grey"}.get(st, "tag open")
        # util and tgt are the empty string when no limit is reported. A dash
        # says "we do not know"; a blank cell says "nothing to do here".
        rows.append((esc(cr), br, usd(bal), usd(lim), util or TARGET_UNKNOWN,
                     tgt or TARGET_UNKNOWN, f'<span class="{cls}">{st}</span>'))
    h.append(table(["creditor", "bureau", "balance", "limit", "utilization",
                    "target balance", "status"], rows))
    hero = hero_card(c)
    if hero:
        h_tgt = target_bal(hero)
        h_pay = paydown_amt(hero)
        h_pct = parse_pct(hero[4]) or 0
        h.append(f"<p><b>Your {esc(hero[0])} card holds {usd(hero[3])}. Right now it is "
                 f"{hero[4] or 'unknown'} full.</b></p>")
        h.append(svg_paydown_bars(usd(hero[2]), usd(h_pay) if h_pay is not None else "-", usd(h_tgt)))
        h.append("<p><b>A high balance on a revolving card is what lenders read first.</b><br>"
                 "<span style='font-size:9pt'>Get it under the dotted line and your score jumps. "
                 "Your pre-approval jumps with it.</span></p>")
        h.append(f'<div class="note">YOUR NUMBERS FROM THE TABLE ABOVE · {esc(hero[0]).upper()} '
                 f'ON {esc(hero[1] or "").upper()}</div>')
        for row in ranked_revolving(c)[:2]:
            pct = parse_pct(row[4])
            if pct is None:
                continue
            tgt = target_text(row)
            if tgt is None:
                continue
            h.append(util_bar(row[0], f"{usd(row[2])} of {usd(row[3])} · pay down to "
                              f"{tgt}", pct))
    # F52. An overall bar needs an overall percentage AND an overall target. On a
    # file whose cards report no limit the engine gives neither, and drawing the
    # bar anyway put it at 0% next to "pay down to under $0".
    overall_pct = parse_pct(c.get("util_pct"))
    if overall_pct is not None and util_totals_known(c):
        h.append(util_bar("Overall revolving",
                          f"{usd(c['util_total_balance'])} of {usd(c['util_total_limit'])} · "
                          f"pay down to under {usd(c['util_target_balance'])}", overall_pct))
    h.append(f'<div class="note">{spaced("dashed line marks the 10% utilization threshold lenders look for")}</div>')
    if hero:
        # hero_card() only returns a card with a known target, so this is never
        # the empty string that used to end the sentence at "Get that card to ."
        h.append(f"""<p>Right now you are using {c['util_pct']} of your available revolving credit -
          {usd(c['util_total_balance'])} in balances against {usd(c['util_total_limit'])} in limits.
          {esc(hero[0])} is the highest-utilization card at {hero[4]}. Get that card to
          {target_text(hero)}. This is the fastest win on your
          entire report.</p>""")
    if util_totals_known(c) and c.get("util_pct"):
        h.append(f'<div class="callout bar">TARGET: Get total revolving balances from '
                 f'{usd(c["util_total_balance"])} down to under {usd(c["util_target_balance"])}. '
                 f'That moves you from {c["util_pct"]} utilization to under 10%. That one move alone '
                 f'can add 40-80 points to your score.</div>')

    # 04 AU
    au = c["au_account"]
    h.append(section("04", "au accounts", "Authorized User (AU) Accounts"))
    # F53. "But this one is not hurting you either" was printed under an EMPTY
    # table for every client with no authorized-user account.
    if au.get("creditor"):
        h.append(table(["creditor", "bureau", "limit", "balance", "utilization", "age", "impact"],
                       [(au["creditor"], au["bureau"], usd(au["limit"]), usd(au["balance"]),
                         au["util"], au["age"], '<span class="tag open">NEUTRAL</span>')]))
        h.append("<p>AU accounts cannot help you get funded - lenders do not count them in "
                 "funding decisions. But this one is not hurting you either. Leave it "
                 "alone.</p>")
    else:
        h.append("<p>No authorized user accounts are listed on this file.</p>")

    # 05 negatives
    h.append(PB)
    h.append(section("05", "negatives", "Negative Items - One by One"))
    rows = [(n["n"], esc(n["creditor"]), n["bureau"], n["type"], n["balance"], esc(n["why"]))
            for n in c["negatives"]]
    h.append(table(["#", "creditor", "bureau", "type", "balance", "why it matters"], rows))
    if c["negatives"]:
        h.append(f'<p><b>Your {len(c["negatives"])} negative item'
                 f'{"s are" if len(c["negatives"]) != 1 else " is"} not equally bad.</b></p>')
        sev = []
        for n in reversed(c["negatives"]):
            sev.append((n["n"], n["creditor"][:22], n.get("type") or "on file"))
        if len(sev) >= 2:
            h.append(svg_severity(sev))
        first = c["negatives"][0]
        h.append(f'<p><b>Start with {esc(first["creditor"])} on {esc(first["bureau"])}.</b></p>')
        h.append('<div class="note">DOT NUMBERS MATCH THE TABLE ABOVE · ORDER FOLLOWS THIS REPORT</div>')
        for n in c["negatives"]:
            detail = n.get("detail") or n.get("why") or "This item is on the file. Dispute it first."
            h.append(f'<h3>ITEM {n["n"]} - {esc(n["creditor"])} - {n["type"]} - '
                     f'{n["balance"]} - {n["bureau"]}</h3><p>{esc(detail)}</p>')
    else:
        h.append("<p><b>No derogatory items are listed on this file.</b></p>")

    # 06 inquiries
    h.append(PB)
    h.append(section("06", "inquiries", "Inquiries - Cleanup Only. Zero Impact on Funding."))
    h.append("<p><b>IMPORTANT:</b> Inquiries do NOT affect your ability to get funded through "
             "FundHub. This section is cleanup only.</p>")
    h.append(table(["bureau", "total inquiries", "priority for removal", "notes"],
                   [(b, t, f'<span class="tag open">{p}</span>', esc(nt))
                    for b, t, p, nt in c["inquiries"]]))
    total_inq = sum(i[1] for i in c["inquiries"])
    h.append(f"<p>You have {total_inq} total hard inquiries across the bureaus. Same-day clusters "
             f"are the easiest to dispute because creditors often cannot individually verify each "
             f"pull. Do not apply for new credit until your funding is secured.</p>")

    # 07 personal data
    h.append(section("07", "personal data", "Personal Data Cleanup"))
    h.append(table(["item", "issue", "action required", "priority"],
                   [(esc(i), esc(iss), esc(act),
                     f'<span class="tag {"solid" if pr=="HIGH" else "grey"}">{pr}</span>')
                    for i, iss, act, pr in c["personal_data"]]))
    high_pd = [p for p in c["personal_data"] if p[3] == "HIGH"]
    if high_pd:
        h.append('<div class="callout bar">URGENT - ' + esc(high_pd[0][1]) +
                 ' Clean this up before you apply. Mismatched identity data can flag a file.</div>')

    # 08 bottom line
    delta = c["preapproval_after"] - c["preapproval_now"]
    h.append(PB)
    h.append(section("08", "bottom line", "The Bottom Line - Where You Are vs. Where You Are Going"))
    h.append('<div class="cards">' + "".join([
        f'<div class="card"><div class="lbl">{spaced("current pre-approval")}</div>'
        f'<div class="big">{usd(c["preapproval_now"])}</div>'
        f'<div class="sub">{spaced("personal loan - starter band")}</div>'
        # F52. "Your utilization penalty () is cutting your base approval hard" is
        # an accusation built on a figure the file does not have. No percentage,
        # no penalty sentence.
        f'<div class="body">This is what you qualify for right now.'
        + (f' Your utilization penalty ({c["util_pct"]}) is cutting your base approval hard.'
           if c.get("util_pct") else "")
        + '</div></div>',
        f'<div class="card"><div class="lbl">{spaced("projected pre-approval")}</div>'
        f'<div class="big">{usd(c["preapproval_after"])}</div>'
        f'<div class="sub">{spaced("after utilization fix")}</div>'
        # F53. "your two revolving cards" for a file that shows one, or five.
        f'<div class="body">{esc(pay_down_cards_line(c))} That alone moves your pre-approval.</div></div>',
        f'<div class="card"><div class="lbl">{spaced("the delta")}</div>'
        f'<div class="big">+{usd(delta)}</div>'
        f'<div class="sub">{spaced("gained by paying down cards")}</div>'
        f'<div class="body">Additional funding power. Just by moving balances.</div></div>',
    ]) + "</div>")
    top_two = ranked_revolving(c)[:2]
    pay_bits = [usd(paydown_amt(r)) for r in top_two if paydown_amt(r) is not None]
    pay_total = sum(paydown_amt(r) or 0 for r in top_two)
    h.append(f'<p><b>How {usd(pay_total) if pay_total else "a targeted paydown"} becomes '
             f'{usd(delta)} more funding.</b></p>')
    h.append(f"""
<div class="flowrow">
  <div class="flowbox"><div class="fl">STEP 1</div><div class="ft">Pay down cards</div>
      <div class="fs">{" + ".join(pay_bits) if pay_bits else "see table"}</div></div>
  <div class="flowarrow">&#10132;</div>
  <div class="flowbox"><div class="fl">WHAT CHANGES</div><div class="ft">Cards drop under 10%</div>
      <div class="fs">{"utilization falls from " + c["util_pct"] if c.get("util_pct") else "utilization falls"}</div></div>
  <div class="flowarrow">&#10132;</div>
  <div class="flowbox"><div class="fl">WHAT LENDERS SEE</div><div class="ft">Score jumps</div>
      <div class="fs">+40 to 80 points</div></div>
  <div class="flowarrow">&#10132;</div>
  <div class="flowbox hl"><div class="fl">WHAT YOU GET</div><div class="ft">Pre-approval jumps</div>
      <div class="fs">{usd(c['preapproval_now'])} becomes {usd(c['preapproval_after'])}</div></div>
</div>
<p><b>You are not paying to make the debt disappear. You are paying to change what lenders see.</b></p>
<div class="note">EVERY FIGURE COMES FROM SECTIONS 03 AND 08 OF THIS REPORT</div>""")

    stages = [
        ("Right Now", "Apply for personal loan funding", "None needed",
         f"{usd(c['preapproval_now'])} available today"),
    ]
    for row in ranked_revolving(c)[:2]:
        stages.append((
            "Step 1 - Fast Win",
            paydown_sentence(row),
            "Utilization drop",
            f"Pre-approval target {usd(c['preapproval_after'])}"
        ))
    for n in c["negatives"][:3]:
        stages.append((
            "Step 2 - Repair",
            f"Dispute {n['creditor']} on {n['bureau']}",
            n.get("type") or "If removed",
            n.get("why") or "Cleans the file"
        ))
    if c["personal_data"]:
        stages.append((
            "Step 3 - Polish",
            "Clean up identity mismatches across bureaus",
            "Prevents denial flags",
            "Removes application friction"
        ))
    stages.append((
        "After Funding", "Form LLC and build business credit profile", "N/A personal",
        "Unlocks business funding"
    ))
    h.append(table(["stage", "action", "score impact", "funding impact"], stages))
    # F53. Only the repairs this file actually needs are named as repairs.
    repair_means = full_repair_means(c)
    h.append(f"""<p>After full repair{' - ' + esc(repair_means) if repair_means else ''} - your Experian score
      moves from {s['experian']} toward 700+. At that level you unlock
      premium cards, SBA 7(a) loans, and personal loans up to $40,000+. The gap between where you
      are and where you could be is not years of waiting. It is targeted action on a short list.</p>
      <p>Ready to move? Book your strategy call at {esc(c['booking_url'])}.</p>""")

    h.append(cta_page(c))
    return "".join(h)

# ----------------------------------------------------------------------------
# 5. DOCUMENT 2 — FUNDING SNAPSHOT
# ----------------------------------------------------------------------------

def build_funding_snapshot(c):
    med = median(list(c["scores"].values()))
    delta = c["preapproval_after"] - c["preapproval_now"]
    h = [cover(c, "funding snapshot", "Capital Readiness Snapshot", "capital readiness snapshot")]

    h.append(section("01", "numbers", "Your Numbers Right Now"))
    h.append(table(["", "today", "after optimization"], [
        ("Median Score", med, "700+ (projected)"),
        ("Experian Score", c["scores"]["experian"], "700+ (projected)"),
        ("Pre-Approval", usd(c["preapproval_now"]), usd(c["preapproval_after"])),
        ("Funding Gap", "", f"{usd(delta)} left on the table"),
    ]))
    h.append(svg_waterfall(usd(c["preapproval_now"]), "+" + usd(delta), usd(c["preapproval_after"]),
                           [("TODAY", "Current pre-approval"),
                            # F53. "Pay down two cards" for a file that shows one, or five.
                            ("UTILIZATION FIX", pay_down_cards_line(c)),
                            ("PROJECTED", "After optimization")]))
    h.append('<div class="note">PERSONAL LOAN PRE-APPROVAL BAND · UNDERWRITEIQ</div>')
    # F53. "You are fundable right now. A personal loan is within reach today."
    # was printed for every client, including one this file gives a pre-approval
    # of nothing. src/underwrite/black-report-node.mjs prints its equivalent only
    # when there is a gap to close; this asks the file the same two questions.
    fundable_now = isinstance(c.get("preapproval_now"), (int, float)) and c["preapproval_now"] > 0
    if fundable_now and delta > 0:
        h.append(f"""<p><b>You are fundable right now at {usd(c["preapproval_now"])}. But you
      are leaving {usd(delta)} on the table by not fixing a few things first. The biggest fixes
      are fast.</b></p>""")
    elif fundable_now:
        h.append(f"""<p><b>You are fundable right now at {usd(c["preapproval_now"])}.</b></p>""")
    elif delta > 0:
        h.append(f"""<p><b>You are leaving {usd(delta)} on the table by not fixing a few things
      first. The biggest fixes are fast.</b></p>""")

    h.append(section("02", "breakdown", "Breakdown by Category"))
    h.append("<h3>Personal Cards</h3>")
    rows = []
    for cr, br, bal, lim, util, tgt, st in c["revolving"]:
        cls = {"CRITICAL": "tag solid", "HIGH": "tag grey"}.get(st, "tag open")
        rows.append((esc(cr), f'<span class="tag open">{st.title()}</span>', usd(bal),
                     usd(lim),
                     # A dash says "we do not know"; a blank cell says "fine".
                     f'{util or TARGET_UNKNOWN} <span class="{cls}">{st}</span>'))
    h.append(table(["account", "status", "balance", "limit", "utilization"], rows))
    # F52. "Overall utilization: - This is your #1 problem right now" calls a
    # figure the file does not have the client's biggest problem. No percentage,
    # no verdict.
    if c.get("util_pct"):
        h.append(f'<p><b>Overall utilization: {c["util_pct"]} - This is your #1 problem right now.</b></p>')

    h.append("<h3>Installment Loans</h3>")
    h.append(table(["account", "status", "balance", "notes"], c["installments"]))
    h.append("<h3>Mortgage / Real Estate</h3>")
    h.append(table(["account", "status", "balance", "notes"], c["mortgages"]))
    h.append("<h3>Child Support / Public Obligations</h3>")
    h.append(table(["account", "status", "balance", "notes"], c["public_obligations"]))
    h.append("<h3>Business Accounts</h3>")
    # F53. "No business entity on file" was printed even for a client whose file
    # names one. The Node printer has always asked c.business first
    # (src/underwrite/black-report-node.mjs businessLine()); this now does too.
    if has_entity(c):
        h.append(f"<p>{esc(entity_name(c))} is on file. The next step is the business credit "
                 "profile: an EIN, a dedicated business checking account, and vendor accounts "
                 "that report.</p>")
    else:
        h.append("<p>No business entity on file. You are leaving a full suite of business funding "
                 "off the table. We cover how to fix this below.</p>")

    h.append(PB)
    h.append(section("03", "costing you", "What Is Costing You Money"))
    h.append("<p>Each item below is hurting your pre-approval. Fix them in this order.</p>")
    costing = []
    for row in ranked_revolving(c):
        pct = parse_pct(row[4])
        if pct is None or pct < 20:
            continue
        tgt = target_text(row)
        if tgt is None:
            # No reported limit, so "on a $X limit" and a 10% target are both
            # figures this file does not have. The row is dropped from a list
            # whose whole point is a number to aim at.
            continue
        costing.append((
            f"{row[0]} - {row[4]} Utilization",
            f"You owe {usd(row[2])} on a {usd(row[3])} limit. Pay it down to {tgt}."
        ))
    if c.get("util_pct"):
        costing.append((
            f"Overall Utilization - {c['util_pct']}",
            f"You are using {usd(c['util_total_balance'])} out of {usd(c['util_total_limit'])} in "
            f"available credit. Get total balances to {usd(c['util_target_balance'])} or less."
        ))
    for n in c.get("negatives") or []:
        costing.append((
            f"{n.get('creditor')} - {n.get('type')} - {n.get('balance')} - {n.get('bureau')}",
            n.get("why") or n.get("detail") or "Dispute this item first."
        ))
    if not has_entity(c):
        costing.append((
            "No Business Entity Registered",
            "Without a business entity you cannot access business credit programs. Forming an LLC "
            "unlocks a whole second tier of funding.",
        ))
    h.append('<div class="steps">' + "".join(
        f'<div class="step"><div class="n">{i}</div><div><div class="t">{esc(t)}</div>'
        f'<div class="small">{esc(d)}</div></div></div>'
        for i, (t, d) in enumerate(costing, 1)) + "</div>")

    h.append(section("04", "not a factor", "What Does Not Affect Your Funding"))
    # F53. Four of these five lines asserted something about this client's file --
    # an authorized-user account, a charge-off, several addresses, several name
    # spellings -- and printed for every client whether or not the file held any
    # of it. Each line now appears only when the row behind it is on the file.
    not_factor = ["<li><b>Inquiries.</b> They do NOT affect funding decisions at FundHub."
                  " Cleanup only.</li>"]
    if (c.get("au_account") or {}).get("creditor"):
        not_factor.append("<li><b>Authorized user account.</b> Cannot help your funding, but"
                          " clean and not hurting you. Keep it.</li>")
    has_charge_off = any("charge" in str(n.get("type") or "").lower()
                         for n in (c.get("negatives") or []))
    not_factor.append(
        "<li><b>Score alone.</b> The charge-off and utilization hurt you more than the number"
        " itself.</li>" if has_charge_off else
        "<li><b>Score alone.</b> What sits behind the number moves your funding more than the"
        " number itself.</li>")
    pd_kinds = [str((p[0] if p else "") or "").lower() for p in (c.get("personal_data") or [])]
    if any("address" in k for k in pd_kinds):
        not_factor.append("<li><b>Multiple addresses.</b> Does not block funding. Cleaned up by"
                          " your personal info letters.</li>")
    if any("name" in k for k in pd_kinds):
        not_factor.append("<li><b>Name variations.</b> Does not block funding, but needs"
                          " consolidating to your legal name.</li>")
    h.append('<ul class="plain">' + "".join(not_factor) + "</ul>")

    h.append(PB)
    # F45. "Where You Could Be" is the LOCKED list. It used to print every lender
    # the matcher knew, including the ones already open today, so a client saw
    # his own available lenders filed under "after optimization".
    # src/underwrite/black-report-node.mjs:821 prints this section only when the
    # locked bucket has something in it.
    _now_unused, locked = lender_buckets(c)
    if locked:
        h.append(section("05", "after optimization", "Where You Could Be - After Optimization"))
        rows = []
        # `*_extra` is load-bearing. These rows are unpacked POSITIONALLY in three
        # places here, and black-report-client.mjs lenderRow() now appends two more
        # columns (bucket, whatNeeded) that only the Node printer reads. Without the
        # star this raises ValueError, black-report-pdf.mjs silently falls back to the
        # Node printer, and no test or log ever says this printer died.
        for nm, cat, typ, lo, hi, sc, tib, rev, why, *_extra in locked:
            need = f"Score {sc}+" if tib is None else f"LLC + Score {sc}+"
            rows.append((esc(nm), typ, money_range(lo, hi), need))
        h.append(table(["lender", "type", "est. range", "what you need"], rows))

    h.append(section("06", "next step", "Your Next Step"))
    h.append("<p><b>Do NOT open new accounts before funding.</b> Every new card or loan drops your "
             "average account age and can trigger automatic declines. Lock in your funding first. "
             "Build after.</p><p><b>Your fastest wins:</b></p>")
    wins = fastest_wins(c)
    h.append("<ul class=\"plain\">" + "".join(f"<li>{esc(w)}</li>" for w in wins) + "</ul>")
    # F53. "Those three moves alone can push your score past 680 and your
    # pre-approval past $15,000" printed under a list of one move, for a client
    # whose median score was already 700 and whose pre-approval was already
    # $50,000. The count is the list's own, and the two figures are this file's.
    if wins:
        moves = ("That one move is what takes" if len(wins) == 1
                 else f"Those {len(wins)} moves are what take")
        h.append(f"<p>{esc(moves)} your pre-approval from "
                 f"{usd(c['preapproval_now'])} toward {usd(c['preapproval_after'])}.</p>")
    h.append(cta_page(c))
    return "".join(h)

# ----------------------------------------------------------------------------
# 6. DOCUMENT 3 — LENDER MATCH LIST
# ----------------------------------------------------------------------------

def build_lender_list(c):
    med = median(list(c["scores"].values()))
    h = [cover(c, "bank & lender match list", "Capital Partner Shortlist",
               "capital partner shortlist")]

    h.append(section("01", "available now", "Available Right Now"))
    h.append(f"""<p><b>{esc(c['applicant'].split()[0])}, here's the honest truth.</b></p>
      <p>Your Experian score sits at {c['scores']['experian']}. Your median score is {med}.{
        " And your utilization is at " + c["util_pct"] + " - that's critical." if c.get("util_pct")
        else " No open card on this file reports a credit limit above $0, so there is no overall utilization figure to read."}</p>""")
    # F45, ported from src/underwrite/black-report-node.mjs:861-899. The matcher
    # returns TWO buckets -- availableNow and afterOptimization -- and this
    # printer read only the flattened list, so it told every client "No lenders
    # are matched for immediate funding right now" and showed all fifteen as
    # locked. A client with five lenders open to him today was told he had none.
    # lenders_now / lenders_after are already on the CLIENT dict
    # (black-report-client.mjs:761-762); this printer just never looked.
    now, after = lender_buckets(c)
    if now:
        h.append(table(["lender", "type", "est. range", "score floor"],
                       [(esc(row[0]), row[2] or row[1], money_range(row[3], row[4]), row[5])
                        for row in now]))
        verb = "lender is" if len(now) == 1 else "lenders are"
        h.append(f'<div class="callout bar">{len(now)} {verb} open to you today. Work them in the '
                 f'order in section 03 - one at a time, lowest score floor first.</div>')
    else:
        h.append('<div class="callout bar">No lenders are matched for immediate funding right now. '
                 'You are not far off. The score ladder below shows exactly how many points stand '
                 'between you and each one.</div>')
    hero = hero_card(c)
    if hero:
        h.append(f"<p>But here's the good news. You are not far off. Fix the utilization on "
                 f"{esc(hero[0])} and your score moves fast. Weeks, not years.</p>")
    else:
        h.append("<p>But here's the good news. You are not far off. Weeks, not years.</p>")

    # score ladder — only the lenders still out of reach belong on it.
    tiers = {}
    for nm, cat, typ, lo, hi, sc, tib, rev, why, *_extra in after:
        # scoreLadder() in black-report-client.mjs:776-789 drops any floor at or
        # below the median: a lender the client already clears on score is locked
        # by something else, and "+-45 PTS" is not a gap.
        if sc is None or med == "" or sc <= med:
            continue
        tiers.setdefault(sc, []).append(nm)
    rows = []
    for sc in sorted(tiers):
        rows.append((f'<span class="tag solid mono">{sc}</span>',
                     f'<span class="mono small">+{sc - med} PTS</span>',
                     "<b>" + esc(", ".join(tiers[sc])) + "</b>",
                     len(tiers[sc])))
    h.append(svg_score_ruler(med))
    if rows:
        h.append(table(["score", "gap", "lenders that unlock", "count"], rows, numeric_cols=(3,)))
    h.append(f'<div class="note">{spaced("business products additionally require an llc and time in business")}</div>')

    h.append(PB)
    h.append(section("02", "shortlist", "After Optimization - Your Shortlist"))
    if after:
        h.append(f"<p>These {len(after)} lenders unlock once you repair the key items. "
                 f"Here is who fits you and why.</p>")
    else:
        h.append("<p>Nothing on this list is out of reach. Every lender the matcher knows is "
                 "already open to you.</p>")

    cat_notes = {
        "Personal Loans": "(No business required. These are your fastest path.)",
        "Personal Cards": "(No business required.)",
        "Business Cards": "(Requires LLC or corporation first.)",
        "Business Lines of Credit": "(Requires LLC + revenue documentation.)",
        "Business Term Loans": "",
    }
    seen = []
    for nm, cat, typ, lo, hi, sc, tib, rev, why, *_extra in after:
        if cat not in seen:
            seen.append(cat)
            h.append(f'<h3>{esc(cat)}</h3><p class="small">{cat_notes.get(cat,"")}</p>')
        kvs = [("type", typ), ("range", f"{usd(lo)} - {usd(hi)}"), ("score needed", sc)]
        if tib:
            kvs.append(("time in business", tib))
        if rev:
            kvs.append(("revenue", rev))
        gap = sc - med
        if gap > 0:
            kvs.append(("you need", f"{gap} more points on your median score"))
        kv_html = "".join(f'<div class="kv"><span class="k">{spaced(k)}</span>'
                          f'<span>{v}</span></div>' for k, v in kvs)
        h.append(f'<div class="lender"><div class="nm">{esc(nm)}</div>{kv_html}'
                 f'<div class="why">{esc(nm)} fits you because {esc(why)}.</div></div>')

    h.append(PB)
    h.append(section("03", "application order", "Application Order Warning"))
    h.append("<p>Applying to the wrong lender first can burn hard inquiries AND trigger automatic "
             "declines that follow you to the next application.</p>")
    h.append("<p><b>The order protects your score. Follow it exactly.</b></p>")
    hero = hero_card(c)
    util_line = "PAY DOWN THE HIGHEST CARD FIRST"
    if hero:
        util_line = f"PAY {str(hero[0]).upper()} DOWN TO {target_text(hero)}"
    lowest = sorted(after, key=lambda r: r[5])[0] if after else None
    lowest_line = (f"{str(lowest[0]).upper()} ASKS FOR {lowest[5]}. THAT IS YOUR FIRST TARGET"
                   if lowest else "START WITH THE LOWEST SCORE FLOOR ON THIS LIST")
    order = [
        ("Fix utilization first", util_line),
        ("Lowest score floor first", lowest_line),
        ("One at a time", "WAIT FOR THE DECISION"),
        ("Work up the list", "HIGHER-FLOOR LENDERS ONLY AFTER THE SCORE MOVES"),
        ("Personal before business", "LOCK PERSONAL · THEN FORM THE LLC"),
    ]
    steps_html = '<div class="steps">' + "".join(
        f'<div class="step"><div class="n">{i}</div><div><div class="t">{esc(t)}</div>'
        f'<div class="d">{esc(d)}</div></div></div>'
        for i, (t, d) in enumerate(order, 1)) + "</div>"
    h.append(f'<div class="side"><div class="grow">{steps_html}</div>'
             f'<div style="width:200px">{svg_shotgun()}</div></div>')
    h.append("<p><b>The same five applications in the wrong order get declined. The wrong order "
             "costs you money and time.</b></p>")

    h.append(section("04", "at a glance", "Your Numbers at a Glance"))
    h.append(table(["", "today", "after optimization"], [
        ("Median Score", med, "680-700 projected"),
        ("Utilization", c["util_pct"] or TARGET_UNKNOWN, "Under 10% target"),
        ("Personal Loan Pre-Approval", usd(c["preapproval_now"]), usd(c["preapproval_after"])),
        # F45. "0" said nobody would lend to this client today. Five would.
        ("Lenders Available", len(now), len(now) + len(after)),
    ]))
    h.append(cta_page(c))
    return "".join(h)

# ----------------------------------------------------------------------------
# 7. DOCUMENT 4 — OPTIMIZATION ROADMAP
# ----------------------------------------------------------------------------

def build_roadmap(c):
    med = median(list(c["scores"].values()))
    delta = c["preapproval_after"] - c["preapproval_now"]
    first = c["applicant"].split()[0]
    h = [cover(c, "credit optimization roadmap",
               f"{first}'s 6-Month Business Readiness Roadmap", "business readiness roadmap")]

    # F53. This paragraph used to assert a mortgage, paid-off auto loans and a
    # clean TransUnion for EVERY client, whatever the file said. It now says only
    # what this file carries, and on a file that carries none of it, it says that
    # instead of inventing something.
    facts = file_fact_sentences(c)
    facts_txt = (" ".join(facts) + " You are not starting from zero." if facts
                 else "There is not much on this file yet, and that is the starting point we "
                      "work from.")
    h.append(f'<div class="callout"><p style="margin:0">A note before we dive in: {esc(first)}, '
             f'I have looked at every inch of your credit file. {esc(facts_txt)} '
             f'What we are doing over the next 6 months is clearing the road so the money can '
             f'flow.</p></div>')

    h.append(section("01", "projection", "Your Projected Pre-Approval"))
    h.append(f'<div class="hero"><div class="amount">{usd(c["preapproval_after"])}</div>'
             f'<div class="small">Up from {usd(c["preapproval_now"])} today - a {usd(delta)} '
             f'increase</div></div>')

    h.append(svg_projection(med, "680-710"))
    months = [
        ("month 1", "Launch", "Paydowns<br>Round 1 disputes<br>File LLC", ""),
        ("month 2", "Results", "Balances report<br>Dispute results", ""),
        ("month 3", "Results", "Round 2 escalation<br>Goodwill letters", "EX 650-665"),
        ("month 4", "Final push", "Round 3, CFPB<br>Settlement", ""),
        ("month 5", "Business", "EIN, DUNS<br>Net-30 vendors", "EX 665-680"),
        ("month 6", "Reveal", "Re-pull all three<br>Reapply", ""),
    ]
    h.append('<div class="mrow">' + "".join(
        f'<div class="mcol"><div class="circ">{i}</div><div class="mk">{spaced(k)}</div>'
        f'<div class="mt">{t}</div><div class="mb">{b}</div>'
        + (f'<div class="mex">{ex}</div>' if ex else '') + '</div>'
        for i, (k, t, b, ex) in enumerate(months, 1)) + "</div>")
    h.append(f'<div class="note">{spaced("projected median score range · anchored at month 1 and month 6 targets")}</div>')

    h.append("<h3>Where You Stand Right Now vs. Where You're Going</h3>")
    # F55. `score_targets` is initialised to four empty strings in
    # src/underwrite/black-report-client.mjs:32 and is never assigned anywhere in
    # this repository, so the whole "month 6" column was four BLANK cells on
    # every real client -- which reads as a broken document rather than as an
    # unknown. The Node printer already answers this exact field in words
    # (black-report-node.mjs afterScore()); its words are used here and in
    # src/deliverables/roadmap.mjs so the three printers agree.
    NO_SCORE_TARGET = "Set at your next pull"
    st = c["score_targets"]
    stand = [
        ("Median Score", med, st.get("median") or NO_SCORE_TARGET),
        ("Experian Score", c["scores"]["experian"], st.get("experian") or NO_SCORE_TARGET),
        ("TransUnion Score", c["scores"]["transunion"], st.get("transunion") or NO_SCORE_TARGET),
        ("Equifax Score", c["scores"]["equifax"], st.get("equifax") or NO_SCORE_TARGET),
    ]
    for row in ranked_revolving(c)[:2]:
        tgt = target_text(row)
        # A card with no reported limit has no utilization to state today and no
        # 10% to reach by month 6. "Under 10%" of an unknown limit is not a goal
        # anyone can act on, so the row says so instead.
        stand.append((
            f"{row[0]} Utilization",
            f"{row[4]} ({usd(row[2])} / {usd(row[3])})" if tgt is not None
            else f"{usd(row[2])} owed, {no_target_cell(row)}",
            f"Under 10% ({tgt})" if tgt is not None
            else f"{no_target_cell_cap(row)} - no target"
        ))
    # F45. lenders_now are open TODAY. Printing 0 told a client with five
    # matches that nobody would lend to him.
    _now_rows, _after_rows = lender_buckets(c)
    now_n = len(_now_rows)
    after_n = len(_after_rows)
    stand.extend([
        ("Overall Utilization", c["util_pct"] or TARGET_UNKNOWN, "Under 10%"),
        ("Negative items", len(c.get("negatives") or []), 0),
        ("Pre-Approval Estimate", usd(c["preapproval_now"]), usd(c["preapproval_after"])),
        ("Lenders on this shortlist", now_n, now_n + after_n),
    ])
    h.append(table(["", "today", "month 6"], stand))

    # Month 1
    h.append(PB)
    h.append(section("02", "month 1", "Month 1 - Launch"))
    h.append('<p class="mono small">"We fire on all cylinders. Everything starts now."</p>')
    h.append("<h3>Step 1: The Paydown Plan</h3>")
    h.append(f"<p>This is your single biggest score lever. Lenders see {c.get('util_pct') or 'your'} "
             f"utilization and they slow down.</p>")
    pay_rows = []
    for row in ranked_revolving(c):
        tgt = target_text(row)
        pd = paydown_amt(row)
        # A blank cell reads as "nothing to do here". A dash reads as "we do not
        # know", which is the truth for a card with no reported limit, and is
        # what the Node printer has always put in the same two cells.
        pay_rows.append((row[0], usd(row[2]), usd(row[3]),
                         tgt if tgt is not None else TARGET_UNKNOWN,
                         usd(pd) if pd is not None else TARGET_UNKNOWN))
    h.append(table(["account", "balance", "limit", "pay down to", "amount to pay"], pay_rows))
    total_pd = sum(paydown_amt(r) or 0 for r in ranked_revolving(c))
    hero = hero_card(c)
    start = f"Even getting {hero[0]} down first moves your score." if hero else "Start with the highest card."
    h.append(total_paydown_sentence(c, total_pd, start))
    h.append("<h3>Step 2: Round 1 Dispute Letters - Experian First</h3>")
    ex_negs = [n for n in c["negatives"] if str(n.get("bureau") or "").lower() == "experian"]
    if ex_negs:
        h.append("<ul class=\"plain\">" + "".join(
            f"<li>{esc(n['creditor'])} - {esc(n.get('type') or '')} - {esc(n.get('balance') or '')}.</li>"
            for n in ex_negs) + "</ul>")
    else:
        h.append("<p>No Experian negatives are listed on this file.</p>")
    if c.get("personal_data"):
        h.append("<ul class=\"plain\">" + "".join(
            f"<li>{esc(p[0])} - {esc(p[1])}</li>" for p in c["personal_data"]) + "</ul>")
    h.append("<h3>Step 3: Round 1 Dispute Letters - Equifax</h3>")
    h.append('<ul class="plain">' + "".join(
        f'<li><b>{esc(n["creditor"])}</b> - {esc(n["why"])}</li>'
        for n in c["negatives"] if n["bureau"] == "Equifax") + "</ul>")
    h.append("<h3>Step 4: Inquiry Removal Letters - Experian</h3>")
    h.append("<p>Inquiries do NOT affect your funding. But clean is clean. Send removal letters "
             "for duplicates and for any inquiry that did not result in an open account.</p>")
    # F54. `llc_fee` is initialised to null in
    # src/underwrite/black-report-client.mjs:29 and is never assigned anywhere in
    # this repository, so usd() rendered "-" and every real client read "with the
    # Secretary of State for -." A dash inside a sentence is not an honest
    # rendering of unknown. No fee on the file, no fee in the sentence.
    llc_fee = parse_money(c.get("llc_fee"))
    llc_fee_clause = "" if llc_fee is None else f" for {usd(llc_fee)}"
    h.append(f"<h3>Step 5: Form Your LLC</h3><ul class='plain'>"
             f"<li>File your LLC in {c['state']} online with the Secretary of State"
             f"{llc_fee_clause}.</li>"
             f"<li>Use your address at {esc(c['address'])}.</li>"
             f"<li>Once filed, the clock starts. LLC age matters for lenders.</li>"
             f"<li>Open a dedicated business checking account. Even $100 in it is fine to start.</li></ul>")
    # F53. "You qualify for a personal loan right now" was an assertion of
    # current eligibility printed for every client, including one whose file
    # gives a pre-approval of nothing. The claim is now made only when the file
    # carries a pre-approval above zero.
    pre_now = c.get("preapproval_now")
    qualifies_now = isinstance(pre_now, (int, float)) and pre_now > 0
    h.append(f"<h3>Step 6: Secure Your Personal Loan NOW</h3>"
             + (f"<p>You qualify for a personal loan right now, before any repairs. Current "
                f"pre-approval estimate: {usd(pre_now)}. "
                if qualifies_now else
                "<p>Lock in whatever personal loan you can get before any repairs. ")
             + f"Do NOT open any new credit "
             f"cards or accounts before you lock this in - new accounts lower your average "
             f"account age and trigger hard inquiries. Get the funding first. Build the credit "
             f"profile after.</p>")

    # Months 2-3
    h.append(PB)
    h.append(section("03", "months 2-3", "Months 2-3 - Results"))
    h.append('<p class="mono small">"The work starts paying off. Numbers move."</p>')
    h.append("<h3>Why disputes take rounds, not days.</h3>")
    h.append(svg_dispute_flow())
    h.append("<p><b>One round rarely clears everything. Three rounds is normal.</b><br>"
             "<span style='font-size:9pt'>The 30 day clock is set by law. That is why this takes "
             "months, not days.</span></p>")
    h.append('<div class="note">THE PROCESS BEHIND EVERY DISPUTE ROUND IN THIS PLAN</div>')
    h.append("<h3>What to Expect in Month 2</h3>")
    h.append("<p>Utilization paydowns hit your score first - balance updates report within 30-45 "
             "days. Estimated score movement from utilization alone: <b>+25 to +45 points</b>. "
             "Dispute results start coming back at day 30-45.</p>")
    h.append("<h3>What to Expect in Month 3</h3>")
    h.append("<p>Round 2 escalation letters go out for anything that came back verified. Round 2 "
             "requests the method of verification, cites specific FCRA violations where the "
             "process was improper, and escalates the charge-off.</p>")
    # F53. This read "TransUnion holding at 725" for every client, which states a
    # score this file may not carry, and "$12,000-$15,000" regardless of the
    # pre-approval already on the file. The projection now names only the bureaus
    # this file actually scores, and the pre-approval figure is this client's.
    proj_bits = []
    for label, key in (("Experian", "experian"), ("Equifax", "equifax"),
                       ("TransUnion", "transunion")):
        v = (c.get("scores") or {}).get(key)
        if not isinstance(v, (int, float)):
            continue
        proj_bits.append(f"{label} holding at or above {v}")
    if proj_bits:
        h.append(f"<p><b>Month 3 score projection:</b> {esc(', '.join(proj_bits))}. Pre-approval "
                 f"estimate climbs toward {usd(c['preapproval_after'])}.</p>")

    # Month 4
    h.append(PB)
    h.append(section("04", "month 4", "Month 4 - Final Push"))
    h.append('<p class="mono small">"We go after what\'s left. No item gets a free pass."</p>')
    h.append("""<ul class="plain">
      <li>CFPB complaints filed alongside disputes - bureaus respond faster when regulators are watching.</li>
      <li>Direct creditor disputes, not just bureau disputes.</li>
      <li>Procedural challenges where a bureau took longer than 30 days to respond.</li>
      </ul>""")
    charge = next((n for n in c["negatives"] if "charge" in str(n.get("type") or "").lower()), None)
    if charge:
        bal = parse_money(charge.get("balance"))
        low = int(round(bal * 0.4)) if bal else None
        high = int(round(bal * 0.6)) if bal else None
        h.append(f'<h3>Settlement Negotiation - {esc(charge["creditor"])}</h3>')
        h.append('<div class="callout">"I am calling to discuss this account. '
                 'I am prepared to settle. I can only do so if you agree in '
                 'writing to delete this account from all three credit bureaus upon payment."</div>')
        if low is not None:
            h.append(f"<p><b>Your offer range: {usd(low)} to {usd(high)} "
                     f"(40%-60% of the {usd(bal)} balance).</b></p>")
        h.append("""<ul class="plain">
          <li>Do NOT pay without a written pay-for-delete agreement first.</li>
          <li>Get the agreement via email or certified mail.</li>
          <li>Do NOT give bank account numbers over the phone - use a money order or prepaid card.</li>
          <li>Once they confirm deletion in writing, pay and keep the receipt.</li>
          </ul>""")
    child = any("child" in str(n.get("creditor") or n.get("type") or "").lower()
                for n in (c.get("negatives") or []) + [
                    {"creditor": r[0], "type": r[1]} for r in (c.get("public_obligations") or [])
                ])
    if child:
        h.append("<h3>Child Support Accounts - Strategic Note</h3>")
        h.append("<p>Government child support accounts are harder to delete and rarely do "
                 "pay-for-delete. What works: get current so no new lates are added, request a "
                 "payment plan in writing confirmed as current, and dispute individual late payment "
                 "dates for accuracy.</p>")

    # Month 5
    h.append(PB)
    h.append(section("05", "month 5", "Month 5 - Business Milestone"))
    h.append("""<ul class="plain">
      <li>Get your EIN from the IRS - free at IRS.gov.</li>
      <li>Register with Dun &amp; Bradstreet for your DUNS number.</li>
      <li>Open a dedicated business checking account under your LLC name.</li>
      <li>Get net-30 vendor accounts (Uline, Quill, Grainger) and start building Paydex.</li>
      </ul>""")
    h.append("<p>Most business lenders require 6-12 months of business age. By Month 5 you are "
             "halfway to the 12-month threshold that unlocks the larger lines of credit.</p>")

    # Month 6
    h.append(PB)
    h.append(section("06", "month 6", "Month 6 - The Reveal"))
    h.append("<p>Pull a fresh tri-merge report and compare it side by side with Month 1.</p>")
    reveal = []
    for n in c.get("negatives") or []:
        reveal.append((f"{n.get('creditor')} {n.get('type')}", n.get("balance") or "showing", "Deleted or settled"))
    for row in ranked_revolving(c)[:2]:
        # A card with no reported limit has no utilization today and no 10% to
        # reach by month 6. "Under 10%" beside a blank cell is a target the
        # client cannot check themselves against.
        if target_text(row) is None:
            reveal.append((f"{row[0]} balance", usd(row[2]),
                           f"Lower - {no_target_cell(row)}, so no 10% target"))
            continue
        reveal.append((f"{row[0]} utilization", row[4], "Under 10%"))
    reveal.append(("Overall utilization", c["util_pct"] or TARGET_UNKNOWN, "Under 10%"))
    ex_s, ex_c, _ = bureau_status(c, "Experian")
    eq_s, eq_c, _ = bureau_status(c, "Equifax")
    reveal.append(("Experian negatives", ex_c, 0))
    reveal.append(("Equifax negatives", eq_c, "reduced"))
    h.append(table(["item", "month 1", "month 6 (target)"], reveal))
    h.append(f'<div class="hero"><div class="mono small">'
             f'{spaced("projected personal loan pre-approval")}</div>'
             f'<div class="amount">{usd(c["preapproval_after"])}</div></div>')

    # Transformation
    h.append(PB)
    h.append(section("07", "transformation", "Before &amp; After Transformation Table"))
    h.append(table(["category", "before", "after (month 6)"], [
        ("Median Score", med, "680-710"),
        ("Experian Score", c["scores"]["experian"], "690+"),
        ("Equifax Score", c["scores"]["equifax"], "670+"),
        ("TransUnion Score", c["scores"]["transunion"], "725+"),
        ("Overall Utilization", c["util_pct"] or TARGET_UNKNOWN, "Under 10%"),
        ("Negative items", len(c.get("negatives") or []), 0),
        ("Experian Negatives", ex_c, 0),
        ("Equifax Negatives", eq_c, "reduced"),
        ("Identity mismatches", len(c.get("personal_data") or []), 0 if c.get("personal_data") else 0),
        ("Personal Pre-Approval", usd(c["preapproval_now"]), usd(c["preapproval_after"])),
        ("Business Pre-Approval", "$0", "$5K-$20K (LLC dependent)"),
        ("Lenders Available", now_n, f"{now_n + after_n} unlocked"),
        ("LLC Formed", "No", "Yes (4-6 months old)"),
        ("Business Credit Profile", "None", "Active (Paydex building)"),
    ]))

    # Checklist
    h.append(PB)
    h.append(section("08", "checklist", "Your 6-Month Checklist"))
    month1 = fastest_wins(c)
    if c.get("negatives"):
        month1.append("Send Round 1 dispute letters for items on this file")
    month1.extend([
        "Send inquiry removal letters for duplicate pulls",
        f"File LLC in {c['state']}" if c.get("state") else "File LLC",
        "Open business checking account",
        "Apply for personal loan pre-approval NOW",
    ])
    month2 = ["Check dispute results (30-45 days after sending)",
              "Document every deletion and every verification"]
    if hero:
        month2.append(f"Keep {hero[0]} balance low")
    month4 = ["Send Round 3 letters + CFPB complaints for stubborn items"]
    if charge:
        month4.append(f"Negotiate pay-for-delete with {charge['creditor']} if still showing")
    checklist = {
        "Month 1": month1,
        "Month 2": month2,
        "Month 3": ["Send Round 2 escalation letters for any verified items",
                    "Pull updated scores and compare to Month 1"],
        "Month 4": month4,
        "Month 5": ["Get EIN from IRS.gov",
                    "Register with Dun & Bradstreet for DUNS number",
                    "Open net-30 vendor accounts",
                    "Pull scores and check milestone progress"],
        "Month 6": ["Pull fresh tri-merge report",
                    "Compare to Month 1 baseline",
                    "Submit for updated pre-approval",
                    "Apply for business funding if LLC is 6+ months old"],
    }
    for m, items in checklist.items():
        h.append(f"<h3>{m}</h3>" + "".join(f'<div class="check">{esc(i)}</div>' for i in items))

    h.append(PB)
    h.append(section("09", "call to action", "Your Call to Action"))
    # F53. This named maxed-out cards and old negatives for every client. On a
    # file with neither it was simply untrue, so the count and the kind now come
    # off the file, and a file with neither gets no such sentence at all.
    back = holding_you_back(c) or (
        "there is nothing on this file to dispute or pay down, so the six months ahead are "
        "about building the business side rather than repairing the personal one.")
    h.append(f"""<p>{esc(first)}, {esc(back)}</p>
      <p>Book your strategy call at {esc(c['booking_url'])}.</p>""")
    h.append('<p class="small">This roadmap was prepared by your FundHub advisor based on your '
             'current credit profile. Projected scores and pre-approval amounts are estimates '
             'based on historical outcomes. Individual results may vary.</p>')
    h.append(cta_page(c))
    return "".join(h)

# ----------------------------------------------------------------------------
# 8. MAIN
# ----------------------------------------------------------------------------

DOCS = [
    ("credit_analysis_report.pdf",    build_credit_analysis, "financial profile assessment", ""),
    ("credit_analysis_report_v2.pdf", build_credit_analysis, "financial profile assessment", "v2"),
    ("funding_snapshot.pdf",          build_funding_snapshot, "capital readiness snapshot", ""),
    ("lender_match_list.pdf",         build_lender_list,      "capital partner shortlist", ""),
    ("optimization_roadmap.pdf",      build_roadmap,          "business readiness roadmap", ""),
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", help="JSON file matching the CLIENT dict shape")
    ap.add_argument("--out", default="out", help="output directory")
    ap.add_argument("--only", help="generate one doc, e.g. --only lender_match_list")
    args = ap.parse_args()

    c = dict(CLIENT)
    if args.client:
        with open(args.client) as f:
            # Live clients must not keep Jordan Sample leftovers.
            c = json.load(f)
    c.setdefault("date", datetime.date.today().strftime("%B %-d, %Y"))

    os.makedirs(args.out, exist_ok=True)
    made = []
    for fname, builder, footer, variant in DOCS:
        if args.only and args.only not in fname:
            continue
        path = os.path.join(args.out, fname)
        render(builder(c), c, footer, path, variant)
        made.append(path)
        print("wrote", path)
    return made

if __name__ == "__main__":
    main()
