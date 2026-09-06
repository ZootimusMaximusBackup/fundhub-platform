"""Recapture the captured-Python fixtures under src/deliverables/fixtures/.

    python3 scripts/black-reports/recapture-fixtures.py      # from the repo root

WHY THIS EXISTS AS A FILE. The procedure used to live as a heredoc in a comment
at the top of src/deliverables/port-parity.test.mjs, which meant every person who
changed fundhub_gen.py had to find it, paste it and get it right. Three fixtures
depend on it now, one of them pins a sha, so it is a script.

WHAT IT WRITES

  python-bodies.json            the four bodies for fundhub_gen.py's own CLIENT
                                  -> src/deliverables/port-parity.test.mjs
  no-limit-python-bodies.json   the four bodies for a file where NO open card
                                reports a limit at all
                                  -> src/deliverables/no-limit.test.mjs
  zero-limit-python-bodies.json the four bodies for a file whose one open card
                                reports a limit of ZERO, plus this printer's
                                answers to the three shared wording helpers, plus
                                the sha256 of fundhub_gen.py itself so the capture
                                cannot silently go stale
                                  -> src/deliverables/zero-limit.test.mjs
                                  -> src/deliverables/three-printer-wording.test.mjs

WeasyPrint is stubbed because it is not installed in the test environment and
none of the four builders touch it -- they return strings.
"""
import sys, types, json, pathlib, hashlib

m = types.ModuleType("weasyprint"); m.HTML = object; m.CSS = object
sys.modules["weasyprint"] = m
sys.path.insert(0, "scripts/black-reports")
import fundhub_gen as g  # noqa: E402

GEN = pathlib.Path("scripts/black-reports/fundhub_gen.py")
FIXTURES = pathlib.Path("src/deliverables/fixtures")

# One row per limit state, and the three states are the whole point: a positive
# stated ceiling, a ceiling stated as ZERO, and no statement at all.
POSITIVE = ["TEST CARD", "Experian", 4500, 10000, "45%", "$1,000", "MONITOR"]
ZERO = ["SECURED CARD", "Experian", 900, 0, "", "", "MONITOR"]
UNKNOWN = ["AMEX PLATINUM (NPSL)", "Experian", 5200, None, "", "", "MONITOR"]


def bodies(client):
    return {
        "credit_analysis": g.build_credit_analysis(client),
        "funding_snapshot": g.build_funding_snapshot(client),
        "lender_match": g.build_lender_list(client),
        "roadmap": g.build_roadmap(client),
    }


def load(name):
    return json.loads((FIXTURES / name).read_text())


def write(name, obj):
    (FIXTURES / name).write_text(json.dumps(obj, indent=1))
    print("wrote", FIXTURES / name)


def main():
    if not GEN.exists():
        sys.exit("run this from the repository root: " + str(GEN) + " not found")
    write("python-bodies.json", bodies(g.CLIENT))
    write("no-limit-python-bodies.json", bodies(load("no-limit-client.json")))
    write("zero-limit-python-bodies.json", {
        "generatorSha256": hashlib.sha256(GEN.read_bytes()).hexdigest(),
        "bodies": bodies(load("zero-limit-client.json")),
        "helpers": {
            "no_target_reason": {
                "positive": g.no_target_reason(POSITIVE),
                "zero": g.no_target_reason(ZERO),
                "unknown": g.no_target_reason(UNKNOWN),
            },
            "no_target_cell": {
                "positive": g.no_target_cell(POSITIVE),
                "zero": g.no_target_cell(ZERO),
                "unknown": g.no_target_cell(UNKNOWN),
            },
            "paydown_sentence": {
                "zero": g.paydown_sentence(ZERO),
                "unknown": g.paydown_sentence(UNKNOWN),
            },
        },
    })


if __name__ == "__main__":
    main()
