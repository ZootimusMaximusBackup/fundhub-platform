# fundhub deliverable PDF engine — approved design system (Jul 2026)
# fundhub.ai print translation: dark cover/closing, white body, spectrum hairlines,
# Inter + JetBrains Mono, ink chips + callouts, mono confidential footers.
import html, re
from weasyprint import HTML

SPEC = "linear-gradient(90deg,#8B5CF6 0%,#3B82F6 22%,#22D3EE 45%,#34D399 66%,#FBBF24 84%,#F97066 100%)"
INK = "#0C0C0D"

SOLID = {"DIRTY", "CRITICAL", "URGENT", "CHARGE-OFF", "60-DAY LATES", "120-DAY LATES"}
MID = {"HIGH", "MEDIUM"}
OUTLINE = {"CLEAN", "MONITOR", "CLOSED", "NEUTRAL", "OPEN", "PAID", "TRANSFERRED"}
NUM_RX = re.compile(r"(\$[\d,]+(?:\.\d+)?[KM]?\+?(?:/year|/month)?|(?<![\w$,.])\d+(?:\.\d+)?%|(?<![\w$,.])\d{1,3}(?:,\d{3})+\+?(?![\d]))")
BOLD_RX = re.compile(r"\*\*(.+?)\*\*")


def esc(s):
    return html.escape(s, quote=False)


def rich(s):
    """escape, then apply **bold** and mono numbers"""
    s = esc(s)
    s = BOLD_RX.sub(r"<strong>\1</strong>", s)
    return NUM_RX.sub(r'<span class="m">\1</span>', s)


def cell(s):
    raw = s.strip()
    if raw.startswith("[x] "):
        raw = raw[4:]
    up = raw.upper()
    if up in SOLID | MID | OUTLINE:
        klass = "solid" if up in SOLID else ("mid" if up in MID else "line")
        return f'<span class="chip {klass}">{esc(raw)}</span>'
    for tok, klass in (("CRITICAL", "solid"), ("HIGH", "mid"), ("NEUTRAL", "line")):
        if up.startswith(tok + " - "):
            rest = raw[len(tok) + 3:]
            return f'<span class="chip {klass}">{tok}</span><span class="cellrest">{esc(rest)}</span>'
    m = re.fullmatch(r"([\d.]+%) - (CRITICAL|HIGH)", raw)
    if m:
        return f'<span class="m">{m.group(1)}</span> <span class="chip {"solid" if m.group(2)=="CRITICAL" else "mid"}">{m.group(2)}</span>'
    if re.fullmatch(r"[~+]?\$?[\d,]+(?:\.\d+)?%?", raw):
        return f'<span class="m">{esc(raw)}</span>'
    return rich(raw)


# ------------------------------------------------------------------ blocks --
def r_table(b):
    ths = "".join(f"<th>{esc(h)}</th>" for h in b["headers"])
    trs = []
    for r in b["rows"]:
        tds = "".join(f"<td>{cell(c)}</td>" for c in r)
        trs.append(f"<tr>{tds}</tr>")
    return f'<table class="fh"><thead><tr>{ths}</tr></thead><tbody>{"".join(trs)}</tbody></table>'


def r_metrics(b):
    cards = []
    for m in b["items"]:
        ver = f'<div class="mver">{esc(m["verdict"])}</div>' if m.get("verdict") else ""
        note = f'<div class="mnote">{rich(m["note"])}</div>' if m.get("note") else ""
        cards.append(
            f'<div class="mc"><div class="mlab">{esc(m["label"])}</div>'
            f'<div class="mval">{esc(m["value"])}</div>{ver}{note}</div>')
    return f'<div class="mrow">{"".join(cards)}</div>'


def r_callout(b):
    title = f'<div class="ct">{rich(b["title"])}</div>' if b.get("title") else ""
    inner = ""
    if b.get("body"):
        inner += f'<div class="cb">{rich(b["body"])}</div>'
    for sub in b.get("blocks", []):
        inner += render_block(sub)
    return f'<div class="co {b.get("v","crit")}">{title}{inner}</div>'


def r_bigstat(b):
    sub = f'<div class="bs-sub">{rich(b["sub"])}</div>' if b.get("sub") else ""
    lab = f'<div class="bs-lab">{esc(b["label"])}</div>' if b.get("label") else ""
    return f'<div class="bigstat">{lab}<div class="bs-val">{esc(b["value"])}</div>{sub}</div>'


def r_list(b, klass="fh-ul"):
    lis = "".join(f"<li>{rich(i)}</li>" for i in b["items"])
    return f'<ul class="{klass}">{lis}</ul>'


def r_ol(b):
    lis = "".join(f"<li>{rich(i)}</li>" for i in b["items"])
    return f'<ol class="fh-ol">{lis}</ol>'


def r_card4(b):
    kv = "".join(f'<div class="kv"><span class="k">{esc(k)}</span><span class="v">{rich(v)}</span></div>' for k, v in b.get("kv", []))
    bl = r_list({"items": b["bullets"]}) if b.get("bullets") else ""
    return f'<div class="card4"><div class="c4t">{rich(b["title"])}</div>{kv}{bl}</div>'


def r_lender(b):
    kv = "".join(f'<div class="kv"><span class="k">{esc(k)}</span><span class="v">{rich(v)}</span></div>' for k, v in b["kv"])
    fit = f'<div class="fit">{rich(b["fit"])}</div>' if b.get("fit") else ""
    return f'<div class="lender"><div class="lname">{esc(b["name"])}</div><div class="kvrow">{kv}</div>{fit}</div>'


def r_cost(b):
    lines = "".join(f'<div class="cline">{rich(l)}</div>' for l in b["lines"])
    num = f'<div class="cnum">{esc(b["num"])}</div>' if b.get("num") else ""
    return (f'<div class="cost">{num}'
            f'<div class="cbody"><div class="ctitle">{rich(b["title"])}</div>{lines}</div></div>')


def r_h3(b):
    return f'<h3>{rich(b["text"])}</h3>'


def r_h4(b):
    return f'<h4>{rich(b["text"])}</h4>'


def r_quote(b):
    return f'<div class="mquote">&#8220;{esc(b["text"])}&#8221;</div>'


def r_mono(b):
    return f'<div class="monoline">{esc(b["text"])}</div>'


def render_block(b):
    t = b["t"]
    if t == "raw":
        return b["html"]
    if t == "chart":
        return b["svg"]
    if t == "table":
        return r_table(b)
    if t == "metrics":
        return r_metrics(b)
    if t == "callout":
        return r_callout(b)
    if t == "bigstat":
        return r_bigstat(b)
    if t == "ul":
        return r_list(b)
    if t == "check":
        return r_list(b, "fh-check")
    if t == "ol":
        return r_ol(b)
    if t == "card":
        return r_card4(b)
    if t == "lender":
        return r_lender(b)
    if t == "cost":
        return r_cost(b)
    if t == "h3":
        return r_h3(b)
    if t == "h4":
        return r_h4(b)
    if t == "quote":
        return r_quote(b)
    if t == "mono":
        return r_mono(b)
    if t == "bold":
        return f'<p class="body b">{rich(b["body"])}</p>'
    if t == "small":
        return f'<p class="small">{rich(b["body"])}</p>'
    return f'<p class="body">{rich(b["body"])}</p>'


def r_section(s):
    blocks = "".join(render_block(b) for b in s["blocks"])
    return (f'<section class="sec"><div class="eyebrow">{s["code"]} / {esc(s["tag"])}</div>'
            f'<h2>{esc(s["title"])}</h2><div class="rule"></div>{blocks}</section>')


# --------------------------------------------------------------------- css --
def css(footer_right, plain=False):
    footer = "" if plain else f"""
  @bottom-left {{ content: "fundhub. \\00b7 confidential \\00b7 prepared for jordan sample";
    font-family: "JetBrains Mono"; font-size: 6.4pt; letter-spacing: 0.6pt; color: #9A9AA1; }}
  @bottom-right {{ content: "{footer_right} \\00b7 " counter(page) " / " counter(pages);
    font-family: "JetBrains Mono"; font-size: 6.4pt; letter-spacing: 0.6pt; color: #9A9AA1; }}"""
    return f"""
@page {{
  size: Letter; margin: 58pt 52pt 66pt 52pt;{footer}
}}
@page cover {{ size: Letter; margin: 0; background: #0A0A0A; }}
@page dark  {{ size: Letter; margin: 0; background: #0A0A0A; }}
* {{ box-sizing: border-box; }}
body {{ font-family: "Inter"; color: {INK}; font-size: 9.75pt; line-height: 1.6; margin: 0; }}
.cover {{ page: cover; width: 8.5in; height: 10.98in; background: #0A0A0A; color: #fff; position: relative; }}
.spec-top {{ height: 3.5pt; width: 100%; background: {SPEC}; }}
.cov-in {{ padding: 44pt 52pt 40pt 52pt; height: 10.6in; position: relative; }}
.cov-head {{ display: flex; justify-content: space-between; align-items: baseline; }}
.wordmark {{ font-family: "Inter"; font-weight: 800; font-size: 19pt; letter-spacing: -0.4pt; color: #fff; }}
.cov-tag {{ font-family: "JetBrains Mono"; font-size: 7pt; letter-spacing: 1.6pt; color: #6E6E76; }}
.cov-mid {{ margin-top: 172pt; }}
.cov-eyebrow {{ font-family: "JetBrains Mono"; font-size: 7.5pt; letter-spacing: 2.6pt; color: #8A8A92; }}
.cov-title {{ font-family: "Inter"; font-weight: 800; font-size: 36pt; line-height: 1.08;
  letter-spacing: -1pt; color: #fff; margin: 14pt 0 0 0; max-width: 6.6in; }}
.cov-rule {{ width: 62pt; height: 2.5pt; background: {SPEC}; margin-top: 22pt; }}
.cov-meta {{ position: absolute; left: 52pt; right: 52pt; bottom: 74pt; display: flex; }}
.cm {{ flex: 1; border-left: 0.9pt solid #26262B; padding: 2pt 0 2pt 12pt; }}
.cm .l {{ font-family: "JetBrains Mono"; font-size: 6.2pt; letter-spacing: 1.4pt; color: #6E6E76; }}
.cm .v {{ font-family: "JetBrains Mono"; font-weight: 500; font-size: 8.6pt; color: #F2F2F4; margin-top: 5pt; }}
.cov-foot, .clo-foot {{ position: absolute; left: 52pt; right: 52pt; bottom: 34pt; display: flex;
  justify-content: space-between; border-top: 0.9pt solid #1D1D22; padding-top: 12pt;
  font-family: "JetBrains Mono"; font-size: 6.6pt; letter-spacing: 1pt; color: #6E6E76; }}
.dot {{ color: #34D399; }}
.lead {{ font-size: 11pt; line-height: 1.68; color: #1B1B1E; margin: 6pt 0 0 0; }}
.sec {{ margin-top: 26pt; }}
.sec:first-of-type {{ margin-top: 20pt; }}
.eyebrow {{ font-family: "JetBrains Mono"; font-size: 6.8pt; letter-spacing: 2pt; color: #85858D; break-after: avoid; }}
h2 {{ font-family: "Inter"; font-weight: 800; font-size: 16pt; letter-spacing: -0.4pt;
  margin: 6pt 0 0 0; line-height: 1.2; color: {INK}; break-after: avoid; }}
h3 {{ font-family: "Inter"; font-weight: 700; font-size: 11.6pt; letter-spacing: -0.2pt;
  margin: 15pt 0 6pt 0; color: {INK}; break-after: avoid; }}
h4 {{ font-family: "Inter"; font-weight: 700; font-size: 10pt; margin: 12pt 0 4pt 0; color: {INK}; }}
.rule {{ height: 2pt; background: {SPEC}; margin: 10pt 0 13pt 0; break-after: avoid; }}
.body {{ margin: 0 0 10pt 0; color: #26262A; }}
.body.b {{ font-weight: 600; color: {INK}; }}
.small {{ font-size: 8pt; color: #6E6E76; line-height: 1.5; margin: 6pt 0 10pt 0; }}
.m {{ font-family: "JetBrains Mono"; font-weight: 500; font-size: 0.93em; }}
table.fh {{ width: 100%; border-collapse: collapse; margin: 2pt 0 13pt 0; border-top: 2pt solid transparent;
  border-image: {SPEC} 1; border-left: none; border-right: none; border-bottom: none; }}
table.fh thead th {{ font-family: "JetBrains Mono"; font-weight: 500; font-size: 6.6pt; letter-spacing: 1.1pt;
  text-transform: uppercase; color: #6E6E76; text-align: left; padding: 7pt 9pt 6pt 0;
  border-bottom: 1.1pt solid {INK}; }}
table.fh td {{ font-size: 8.9pt; line-height: 1.45; color: #232327; padding: 6.5pt 9pt 6.5pt 0;
  border-bottom: 0.7pt solid #E7E7EA; vertical-align: top; }}
table.fh tr {{ break-inside: avoid; }}
.cellrest {{ display: block; margin-top: 3pt; font-size: 8.1pt; color: #55555C; }}
.chip {{ font-family: "JetBrains Mono"; font-weight: 500; font-size: 6.4pt; letter-spacing: 0.9pt;
  padding: 2pt 5.5pt; border-radius: 2.5pt; white-space: nowrap; }}
.chip.solid {{ background: {INK}; color: #fff; }}
.chip.mid {{ background: #6A6A72; color: #fff; }}
.chip.line {{ border: 0.9pt solid {INK}; color: {INK}; }}
.co {{ break-inside: avoid; background: #F6F6F8; padding: 11pt 13pt; margin: 0 0 11pt 0;
  border-left: 2.6pt solid {INK}; }}
.co.info {{ background: #fff; border: 0.9pt solid #D8D8DD; border-left: 0.9pt solid #D8D8DD; }}
.co.up {{ border-left: 2.6pt solid transparent; border-image: {SPEC} 1;
  border-top: none; border-right: none; border-bottom: none; background: #F6F6F8; }}
.ct {{ font-weight: 700; font-size: 9.6pt; margin-bottom: 5pt; color: {INK}; }}
.cb {{ font-size: 9.3pt; line-height: 1.58; color: #2A2A2F; }}
.co .fh-ul {{ margin-top: 6pt; margin-bottom: 2pt; }}
.mrow {{ display: flex; gap: 8pt; margin: 2pt 0 13pt 0; break-inside: avoid; }}
.mc {{ flex: 1; border: 0.9pt solid #E3E3E7; border-top: 2pt solid {INK}; padding: 11pt; background: #fff; }}
.mlab {{ font-family: "JetBrains Mono"; font-size: 6.3pt; letter-spacing: 1.2pt; text-transform: uppercase; color: #6E6E76; }}
.mval {{ font-family: "JetBrains Mono"; font-weight: 700; font-size: 19pt; letter-spacing: -0.5pt; color: {INK}; margin-top: 6pt; }}
.mver {{ font-family: "JetBrains Mono"; font-weight: 500; font-size: 6.4pt; letter-spacing: 0.8pt;
  text-transform: uppercase; color: {INK}; margin-top: 5pt; }}
.mnote {{ font-size: 7.6pt; line-height: 1.5; color: #55555C; margin-top: 6pt; }}
.bigstat {{ break-inside: avoid; border: 0.9pt solid #E3E3E7; border-top: 2.6pt solid {INK};
  padding: 16pt 18pt 15pt 18pt; margin: 2pt 0 13pt 0; }}
.bs-lab {{ font-family: "JetBrains Mono"; font-size: 6.8pt; letter-spacing: 1.6pt; text-transform: uppercase; color: #6E6E76; }}
.bs-val {{ font-family: "JetBrains Mono"; font-weight: 700; font-size: 33pt; letter-spacing: -1pt; color: {INK}; margin-top: 7pt; }}
.bs-sub {{ font-size: 9pt; color: #55555C; margin-top: 6pt; }}
.fh-ul, .fh-check, .fh-ol {{ margin: 0 0 10pt 0; padding: 0 0 0 2pt; list-style: none; }}
.fh-ul li, .fh-check li {{ position: relative; padding-left: 13pt; margin-bottom: 4.5pt;
  font-size: 9.3pt; line-height: 1.5; color: #26262A; }}
.fh-ul li::before {{ content: ""; position: absolute; left: 0; top: 5.2pt; width: 3.2pt; height: 3.2pt; background: {INK}; }}
.fh-check li {{ padding-left: 17pt; }}
.fh-check li::before {{ content: ""; position: absolute; left: 0; top: 2.6pt; width: 7pt; height: 7pt;
  border: 0.9pt solid {INK}; }}
.fh-ol {{ counter-reset: fhol; padding-left: 2pt; }}
.fh-ol li {{ position: relative; padding-left: 19pt; margin-bottom: 5pt; font-size: 9.3pt; line-height: 1.5;
  counter-increment: fhol; color: #26262A; }}
.fh-ol li::before {{ content: counter(fhol); position: absolute; left: 0; top: 0.4pt;
  font-family: "JetBrains Mono"; font-weight: 700; font-size: 8pt; color: {INK}; }}
.card4 {{ break-inside: avoid; border: 0.9pt solid #E3E3E7; padding: 10pt 12pt; margin: 0 0 9pt 0; }}
.c4t {{ font-weight: 700; font-size: 9.8pt; margin-bottom: 6pt; color: {INK}; }}
.card4 .fh-ul {{ margin-bottom: 0; }}
.lender {{ break-inside: avoid; border: 0.9pt solid #E3E3E7; border-top: 2pt solid {INK};
  padding: 11pt 13pt 12pt 13pt; margin: 0 0 9pt 0; background: #fff; }}
.lname {{ font-weight: 700; font-size: 10.6pt; letter-spacing: -0.2pt; color: {INK}; }}
.kvrow {{ margin-top: 7pt; }}
.kv {{ display: flex; margin-bottom: 3pt; }}
.kv .k {{ font-family: "JetBrains Mono"; font-size: 6.6pt; letter-spacing: 1pt; text-transform: uppercase;
  color: #6E6E76; width: 108pt; flex: none; padding-top: 1.6pt; }}
.kv .v {{ font-size: 8.8pt; color: #232327; }}
.fit {{ font-size: 8.9pt; line-height: 1.55; color: #45454B; margin-top: 7pt;
  border-top: 0.7pt solid #EDEDEF; padding-top: 7pt; }}
.cost {{ break-inside: avoid; display: flex; margin: 0 0 10pt 0; border-bottom: 0.7pt solid #ECECEF; padding-bottom: 10pt; }}
.cnum {{ font-family: "JetBrains Mono"; font-weight: 700; font-size: 13pt; color: {INK}; width: 26pt; flex: none; }}
.ctitle {{ font-weight: 700; font-size: 10pt; color: {INK}; margin-bottom: 4pt; }}
.cline {{ font-size: 9.1pt; line-height: 1.52; color: #33333A; margin-bottom: 2.5pt; }}
.chart {{ break-inside: avoid; margin: 4pt 0 15pt 0; }}
.chart svg {{ display: block; }}
.mquote {{ font-family: "JetBrains Mono"; font-size: 8.4pt; letter-spacing: 0.4pt; color: #6E6E76; margin: 2pt 0 12pt 0; }}
.monoline {{ font-family: "JetBrains Mono"; font-size: 7.2pt; letter-spacing: 0.8pt; color: #85858D; margin: 4pt 0 10pt 0; }}
.closing {{ page: dark; width: 8.5in; height: 10.98in; background: #0A0A0A; color: #fff;
  position: relative; page-break-before: always; }}
.clo-in {{ padding: 44pt 52pt; height: 10.6in; position: relative; }}
.clo-head {{ display: flex; justify-content: space-between; align-items: baseline; }}
.clo-mid {{ margin-top: 148pt; text-align: center; }}
.clo-title {{ font-family: "Inter"; font-weight: 800; font-size: 27pt; letter-spacing: -0.8pt; color: #fff; margin: 0; }}
.clo-sub {{ font-size: 10.3pt; color: #A9A9B1; margin: 14pt auto 0 auto; max-width: 5.4in; line-height: 1.6; }}
.qr {{ width: 128pt; height: 128pt; border: 1pt dashed #3A3A41; margin: 34pt auto 0 auto;
  display: flex; align-items: center; justify-content: center;
  font-family: "JetBrains Mono"; font-size: 7.5pt; letter-spacing: 1.5pt; color: #6E6E76; }}
.qr-cap {{ font-family: "JetBrains Mono"; font-size: 6.8pt; letter-spacing: 1pt; color: #6E6E76; margin-top: 12pt; }}
.clo-url {{ font-family: "JetBrains Mono"; font-weight: 500; font-size: 11.5pt; color: #fff; margin-top: 16pt; }}
.clo-alt {{ font-size: 8pt; color: #6E6E76; margin-top: 7pt; }}
/* letters */
.lh {{ display: flex; justify-content: space-between; align-items: baseline; }}
.lh .wm {{ font-family: "Inter"; font-weight: 800; font-size: 13.5pt; letter-spacing: -0.3pt; color: {INK}; }}
.lh .tag {{ font-family: "JetBrains Mono"; font-size: 6.6pt; letter-spacing: 1.6pt; color: #85858D; }}
.lrule {{ height: 1.6pt; background: {SPEC}; margin: 10pt 0 24pt 0; }}
.ldate {{ font-size: 9.5pt; color: #26262A; margin: 0 0 16pt 0; }}
.laddr {{ font-size: 9.5pt; line-height: 1.5; color: #26262A; margin-bottom: 16pt; }}
.laddr .who {{ font-weight: 600; color: {INK}; }}
.lre {{ font-weight: 700; font-size: 9.8pt; color: {INK}; margin: 6pt 0 16pt 0; }}
.lbody p {{ font-size: 9.6pt; line-height: 1.66; color: #26262A; margin: 0 0 10pt 0; }}
.litem {{ font-weight: 700; font-size: 9.9pt; color: {INK}; margin: 15pt 0 3pt 0; }}
.lcite {{ font-family: "JetBrains Mono"; font-size: 7.3pt; letter-spacing: 0.4pt; color: #6E6E76; margin: 0 0 7pt 0; }}
.lsig {{ margin-top: 20pt; font-size: 9.6pt; line-height: 1.6; color: #26262A; }}
.lsig .name {{ font-weight: 700; color: {INK}; }}
.lenc {{ margin-top: 18pt; border-top: 0.7pt solid #E7E7EA; padding-top: 10pt; }}
.lenc .t {{ font-family: "JetBrains Mono"; font-size: 6.8pt; letter-spacing: 1.4pt; color: #6E6E76; margin-bottom: 6pt; }}
"""


def cover_html(c):
    meta = "".join(f'<div class="cm"><div class="l">{esc(l)}</div><div class="v">{esc(v)}</div></div>' for l, v in c["meta"])
    return f"""
<div class="cover"><div class="spec-top"></div><div class="cov-in">
  <div class="cov-head"><div class="wordmark">fundhub.</div><div class="cov-tag">{esc(c["tag"])}</div></div>
  <div class="cov-mid"><div class="cov-eyebrow">{esc(c["eyebrow"])}</div>
    <h1 class="cov-title">{esc(c["title"])}</h1><div class="cov-rule"></div></div>
  <div class="cov-meta">{meta}</div>
  <div class="cov-foot"><div><span class="dot">&#9679;</span>&nbsp; diagnostic complete &#183; underwriteiq</div>
    <div>fundhub confidential</div></div>
</div></div>"""


CLOSING = """
<div class="closing"><div class="spec-top"></div><div class="clo-in">
  <div class="clo-head"><div class="wordmark">fundhub.</div><div class="cov-tag">NEXT STEPS</div></div>
  <div class="clo-mid">
    <h1 class="clo-title">Let Us Build Your Game Plan Together</h1>
    <div class="clo-sub">You have clean bureaus ready for funding now. Apply on those while we repair the rest in parallel.</div>
    <div class="qr">[ QR CODE ]</div>
    <div class="qr-cap">SCAN TO BOOK YOUR CALL INSTANTLY</div>
    <div class="clo-url">www.fundhubbookingurl.template</div>
    <div class="clo-alt">Or copy this link into your browser</div>
  </div>
  <div class="clo-foot"><div><span class="dot">&#9679;</span>&nbsp; systems nominal &#183; fundhub.ai</div>
    <div>fundhub confidential</div></div>
</div></div>"""


def render_doc(spec):
    body = ""
    for b in spec["body"]:
        if b.get("t") == "lead":
            body += f'<p class="lead">{rich(b["body"])}</p>'
        elif b.get("t") == "sec":
            body += r_section(b)
        else:
            body += render_block(b)
    doc = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>{esc(spec["title"])} &#183; Jordan Sample</title>
<meta name="author" content="fundhub">
<meta name="description" content="{esc(spec.get("subject","UnderwriteIQ client deliverable"))}">
<style>{css(spec["footer"])}</style></head><body>
{cover_html(spec["cover"]) if spec.get("cover") else ""}
{body}
{CLOSING if spec.get("closing") else ""}
</body></html>"""
    HTML(string=doc).write_pdf(spec["file"])
    return spec["file"]


def render_letter(spec):
    """spec: file, tag, footer, date, sender[], recipient[], re, body(list of blocks or None), sig, enclosures[]"""
    body = ""
    for b in spec.get("body") or []:
        t = b["t"]
        if t == "p":
            body += f'<p>{rich(b["text"])}</p>'
        elif t == "item":
            body += f'<div class="litem">{rich(b["text"])}</div>'
        elif t == "cite":
            body += f'<div class="lcite">{esc(b["text"])}</div>'
        elif t == "ol":
            body += r_ol(b)
        elif t == "ul":
            body += r_list(b)
    sig = ""
    if spec.get("sig"):
        lines = "<br>".join(esc(x) for x in spec["sig"][1:])
        sig = f'<div class="lsig">Sincerely,<br><br><span class="name">{esc(spec["sig"][0])}</span><br>{lines}</div>'
    enc = ""
    if spec.get("enclosures"):
        enc = ('<div class="lenc"><div class="t">ENCLOSURES</div>'
               + r_list({"items": spec["enclosures"]}) + "</div>")
    sender = "<br>".join(esc(x) for x in spec["sender"])
    recipient = "<br>".join(esc(x) for x in spec["recipient"])
    # Letters carry NO Fundhub branding. They are mailed to credit bureaus, where
    # broker-looking mail gets routed to the third-party pile and the dispute is
    # weakened. No wordmark, no spectrum rule, no footer, no author metadata.
    doc = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>{esc(spec["title"])}</title>
<style>{css(spec["footer"], plain=True)}</style></head><body>
<div class="laddr">{sender}</div>
<div class="ldate">{esc(spec["date"])}</div>
<div class="laddr">{recipient}</div>
<div class="lre">{rich(spec["re"])}</div>
<div class="lbody">{body}</div>
{sig}{enc}
</body></html>"""
    HTML(string=doc).write_pdf(spec["file"])
    return spec["file"]
