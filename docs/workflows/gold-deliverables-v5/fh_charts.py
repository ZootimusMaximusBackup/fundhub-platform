# fundhub deliverable charts — deterministic SVG generators
# Every function is a pure function of its numeric arguments. No randomness,
# no model in the drawing path. Same inputs always produce identical output.
#
# Design lock (matches the approved print system):
#   ink        #0C0C0D   primary bars, rails, markers
#   track      #E8E8EB   empty bar track / inactive rail
#   hairline   #DDDDE1   separators
#   label      #6E6E76   mono axis + caption text
#   spectrum   thin accents only, never a fill
#   type       JetBrains Mono for every number, Inter for names
# All charts must read correctly in grayscale.

import html

W = 508.0                      # body content width in points
INK = "#0C0C0D"
TRACK = "#E8E8EB"
HAIR = "#DDDDE1"
LABEL = "#6E6E76"
MUTED = "#9A9AA1"

SPEC_DEF = (
    '<defs><linearGradient id="fhspec" x1="0" y1="0" x2="1" y2="0">'
    '<stop offset="0" stop-color="#8B5CF6"/><stop offset="0.22" stop-color="#3B82F6"/>'
    '<stop offset="0.45" stop-color="#22D3EE"/><stop offset="0.66" stop-color="#34D399"/>'
    '<stop offset="0.84" stop-color="#FBBF24"/><stop offset="1" stop-color="#F97066"/>'
    "</linearGradient></defs>"
)


def _e(s):
    return html.escape(str(s), quote=True)


def _mono(x, y, t, size=7.0, fill=LABEL, weight="500", anchor="start", ls=0.6):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="JetBrains Mono" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" '
            f'letter-spacing="{ls}">{_e(t)}</text>')


def _inter(x, y, t, size=8.4, fill=INK, weight="400", anchor="start"):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="Inter" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{_e(t)}</text>')


def _wrap(names, max_chars):
    """Deterministic greedy wrap of a comma-joined name list."""
    lines, cur = [], ""
    for n in names:
        piece = n if not cur else cur + ", " + n
        if len(piece) > max_chars and cur:
            lines.append(cur)
            cur = n
        else:
            cur = piece
    if cur:
        lines.append(cur)
    return lines


def _svg(height, body, cap=None):
    caption = ""
    h = height
    if cap:
        caption = _mono(0, height + 12, cap, size=6.4, fill=MUTED, ls=1.0)
        h = height + 16
    # width/height are declared in points so the chart matches the text column
    # exactly. WeasyPrint reads a unitless SVG width as CSS pixels (0.75pt each),
    # which would render every chart at 75% scale.
    return (f'<div class="chart"><svg width="{W:.0f}pt" height="{h:.0f}pt" '
            f'style="width:{W:.0f}pt;height:{h:.0f}pt" '
            f'viewBox="0 0 {W:.0f} {h:.0f}" xmlns="http://www.w3.org/2000/svg" '
            f'role="img">{SPEC_DEF}{body}{caption}</svg></div>')


# ---------------------------------------------------------------- 1. waterfall
def waterfall(steps, cap=None):
    """steps: [(label, sublabel, value, kind)] where kind is base | gain | total.
    'gain' bars float on top of the running total."""
    total = max(s[2] for s in steps if s[3] == "total")
    top, base_y = 34.0, 176.0
    plot_h = base_y - top
    scale = plot_h / float(total)
    n = len(steps)
    colw = W / n
    barw = min(96.0, colw - 62.0)

    out = [f'<line x1="0" y1="{base_y:.1f}" x2="{W:.0f}" y2="{base_y:.1f}" '
           f'stroke="{INK}" stroke-width="0.9"/>']
    running = 0.0
    prev_top_x = prev_top_y = None

    for i, (lab, sub, val, kind) in enumerate(steps):
        cx = colw * i + colw / 2.0
        x = cx - barw / 2.0
        if kind == "gain":
            y0 = base_y - (running + val) * scale
            h = val * scale
            out.append(f'<rect x="{x:.1f}" y="{y0:.1f}" width="{barw:.1f}" height="{h:.1f}" '
                       f'fill="#F2F2F4" stroke="{INK}" stroke-width="0.8"/>')
            out.append(f'<rect x="{x:.1f}" y="{y0:.1f}" width="{barw:.1f}" height="2" '
                       f'fill="url(#fhspec)"/>')
            running += val
            ty = y0
        else:
            h = val * scale
            y0 = base_y - h
            out.append(f'<rect x="{x:.1f}" y="{y0:.1f}" width="{barw:.1f}" height="{h:.1f}" '
                       f'fill="{INK}"/>')
            running = val
            ty = y0
        out.append(_mono(cx, ty - 8, f"${val:,.0f}" if kind != "gain" else f"+${val:,.0f}",
                         size=11.5, fill=INK, weight="700", anchor="middle", ls=-0.2))
        out.append(_mono(cx, base_y + 15, lab.upper(), size=6.4, fill=LABEL,
                         anchor="middle", ls=1.2))
        if sub:
            out.append(_inter(cx, base_y + 27, sub, size=7.4, fill=MUTED, anchor="middle"))
        if prev_top_x is not None:
            out.append(f'<line x1="{prev_top_x:.1f}" y1="{prev_top_y:.1f}" x2="{x:.1f}" '
                       f'y2="{prev_top_y:.1f}" stroke="{MUTED}" stroke-width="0.7" '
                       f'stroke-dasharray="2.5 2"/>')
        prev_top_x, prev_top_y = x + barw, ty
    return _svg(base_y + 34, "".join(out), cap)


# ------------------------------------------------------------------- 2. ladder
def unlock_ladder(current, tiers, lo=620, hi=710, cap=None):
    """tiers: [(score, [lender names])] sorted ascending."""
    x0, x1 = 26.0, W - 12.0
    rail_y = 44.0

    def px(s):
        return x0 + (float(s) - lo) / float(hi - lo) * (x1 - x0)

    out = [f'<rect x="{x0:.1f}" y="{rail_y:.1f}" width="{x1-x0:.1f}" height="2.4" fill="{TRACK}"/>']
    cx = px(current)
    out.append(f'<rect x="{x0:.1f}" y="{rail_y:.1f}" width="{cx-x0:.1f}" height="2.4" fill="{INK}"/>')

    for s, _ in tiers:
        gx = px(s)
        out.append(f'<line x1="{gx:.1f}" y1="{rail_y-5:.1f}" x2="{gx:.1f}" y2="{rail_y+8:.1f}" '
                   f'stroke="{INK}" stroke-width="0.9"/>')
        out.append(_mono(gx, rail_y + 19, str(s), size=7.0, fill=LABEL, anchor="middle", ls=0.8))

    out.append(f'<polygon points="{cx:.1f},{rail_y-2:.1f} {cx-4.6:.1f},{rail_y-10:.1f} '
               f'{cx+4.6:.1f},{rail_y-10:.1f}" fill="{INK}"/>')
    # self-describing marker label, clamped so it never overruns either edge
    mark = f"YOUR MEDIAN SCORE  {current}"
    half = len(mark) * (7.2 * 0.6 + 1.0) / 2.0
    if cx - half < 0:
        lx_, anch = 0.0, "start"
    elif cx + half > W:
        lx_, anch = W, "end"
    else:
        lx_, anch = cx, "middle"
    out.append(_mono(lx_, rail_y - 15, mark, size=7.2, fill=INK,
                     weight="700", anchor=anch, ls=1.0))

    y = rail_y + 42
    for s, names in tiers:
        gap = int(s) - int(current)
        out.append(f'<line x1="0" y1="{y-13:.1f}" x2="{W:.0f}" y2="{y-13:.1f}" '
                   f'stroke="{HAIR}" stroke-width="0.7"/>')
        out.append(f'<rect x="0" y="{y-9:.1f}" width="30" height="12.5" fill="{INK}"/>')
        out.append(_mono(15, y, str(s), size=7.2, fill="#FFFFFF", weight="700",
                         anchor="middle", ls=0.4))
        out.append(_mono(38, y, f"+{gap} PTS" if gap > 0 else "UNLOCKED", size=6.6,
                         fill=LABEL, ls=1.0))
        lines = _wrap(names, 58)
        for j, ln in enumerate(lines):
            out.append(_inter(96, y + j * 10.4, ln, size=8.2, fill=INK,
                              weight="600" if j == 0 else "400"))
        out.append(_mono(W, y, f"{len(names)}", size=7.6, fill=MUTED, anchor="end", ls=0))
        y += 14 + 10.4 * (len(lines) - 1) + 12
    return _svg(y - 8, "".join(out), cap)


# --------------------------------------------------------------- 3. util bars
def utilization_bars(rows, target_pct=10, cap=None):
    """rows: [(label, pct, detail)] — pct 0-100, detail is the paydown line."""
    lx, bx = 0.0, 148.0
    bw = W - bx - 46.0
    rowh = 40.0
    out = []
    y = 14.0
    tx = bx + bw * (target_pct / 100.0)

    for lab, pct, detail in rows:
        out.append(_inter(lx, y + 1, lab, size=9.0, fill=INK, weight="700"))
        out.append(f'<rect x="{bx:.1f}" y="{y-8:.1f}" width="{bw:.1f}" height="13" fill="{TRACK}"/>')
        fillw = bw * (min(pct, 100) / 100.0)
        out.append(f'<rect x="{bx:.1f}" y="{y-8:.1f}" width="{fillw:.1f}" height="13" fill="{INK}"/>')
        out.append(_mono(W, y + 1, f"{pct}%", size=10.5, fill=INK, weight="700",
                         anchor="end", ls=-0.2))
        out.append(_inter(lx, y + 14, detail, size=7.6, fill=MUTED))
        y += rowh

    top = 14.0 - 12.0
    bot = y - rowh + 8.0
    out.append(f'<line x1="{tx:.1f}" y1="{top:.1f}" x2="{tx:.1f}" y2="{bot:.1f}" '
               f'stroke="{INK}" stroke-width="0.9" stroke-dasharray="3 2.4"/>')
    out.append(_mono(tx, top - 4, f"TARGET  {target_pct}%", size=6.4, fill=INK,
                     weight="700", anchor="middle", ls=1.0))
    return _svg(y - 14, "".join(out), cap)


# ---------------------------------------------------------------- 4. timeline
def timeline(months, start_score, end_lo, end_hi, lo=620, hi=720, cap=None):
    """months: [(n, phase, action, note_or_None)]. Band is drawn only between the
    two stated anchors: start_score and the end_lo/end_hi range."""
    n = len(months)
    colw = W / n
    top, band_h = 30.0, 96.0
    rail_y = top + band_h + 16.0

    def py(score):
        return top + band_h - (float(score) - lo) / float(hi - lo) * band_h

    x_first, x_last = colw / 2.0, colw * (n - 1) + colw / 2.0
    y_s, y_lo, y_hi = py(start_score), py(end_lo), py(end_hi)

    out = [f'<polygon points="{x_first:.1f},{y_s:.1f} {x_last:.1f},{y_hi:.1f} '
           f'{x_last:.1f},{y_lo:.1f}" fill="#F2F2F4"/>']
    out.append(f'<line x1="{x_first:.1f}" y1="{y_s:.1f}" x2="{x_last:.1f}" y2="{y_hi:.1f}" '
               f'stroke="{INK}" stroke-width="1.3"/>')
    out.append(f'<line x1="{x_first:.1f}" y1="{y_s:.1f}" x2="{x_last:.1f}" y2="{y_lo:.1f}" '
               f'stroke="{MUTED}" stroke-width="0.9" stroke-dasharray="3 2.4"/>')
    out.append(f'<rect x="{x_last:.1f}" y="{y_hi:.1f}" width="2" '
               f'height="{y_lo-y_hi:.1f}" fill="url(#fhspec)"/>')

    out.append(f'<circle cx="{x_first:.1f}" cy="{y_s:.1f}" r="3.1" fill="{INK}"/>')
    out.append(_mono(x_first + 8, y_s + 3, str(start_score), size=9.5, fill=INK, weight="700", ls=-0.2))
    out.append(_mono(x_first + 8, y_s - 7, "TODAY", size=6.0, fill=MUTED, ls=1.2))
    out.append(_mono(x_last - 8, y_hi + 1, f"{end_lo}-{end_hi}", size=9.5, fill=INK,
                     weight="700", anchor="end", ls=-0.2))
    out.append(_mono(x_last - 8, y_hi - 9, "PROJECTED", size=6.0, fill=MUTED, anchor="end", ls=1.2))

    out.append(f'<line x1="0" y1="{rail_y:.1f}" x2="{W:.0f}" y2="{rail_y:.1f}" '
               f'stroke="{TRACK}" stroke-width="2.4"/>')

    # pass 1: wrap every action so all notes can share one baseline
    wrapped = [_wrap(a.split(" \u00b7 "), 20) for _, _, a, _ in months]
    maxlines = max(len(w) for w in wrapped)
    note_y = rail_y + 40 + maxlines * 9.4 + 2

    # pass 2: draw
    for i, (num, phase, _action, note) in enumerate(months):
        cx = colw * i + colw / 2.0
        out.append(f'<circle cx="{cx:.1f}" cy="{rail_y+1.2:.1f}" r="4.4" fill="{INK}"/>')
        out.append(_mono(cx, rail_y + 3.6, str(num), size=6.0, fill="#FFFFFF",
                         weight="700", anchor="middle", ls=0))
        out.append(_mono(cx, rail_y + 18, f"MONTH {num}", size=6.0, fill=MUTED,
                         anchor="middle", ls=1.1))
        out.append(_inter(cx, rail_y + 29, phase, size=8.4, fill=INK, weight="700", anchor="middle"))
        for j, ln in enumerate(wrapped[i]):
            out.append(_inter(cx, rail_y + 40 + j * 9.4, ln, size=7.2, fill=MUTED, anchor="middle"))
        if note:
            out.append(_mono(cx, note_y, note, size=6.4, fill=INK,
                             weight="700", anchor="middle", ls=0.4))
    return _svg(note_y + 12, "".join(out), cap)


# ============================================================================
# TEACHING DIAGRAMS
# These exist to bridge understanding, not to add analysis. The explanation
# lives inside the picture: plain words, no jargon, and "here is you" marked
# in the same frame. Written to be understood by someone who has never heard
# the word "utilization." Numbers stay exact; only the language gets simple.
# ============================================================================

def utilization_tank(card_name, limit, balance, target_bal, pay_amount, cap=None):
    """The napkin drawing. A credit card drawn as a tank that can only hold so
    much. Left tank: today, nearly full. Right tank: the goal, nearly empty.
    Arrow between them is the action. The picture teaches before you read."""
    pct = balance / float(limit) * 100.0
    tgt_pct = target_bal / float(limit) * 100.0

    t1x, t2x, tw = 40.0, 372.0, 96.0
    top, bot = 46.0, 214.0
    th = bot - top
    gap_c = (t1x + tw + t2x) / 2.0

    def fill_y(p):
        return bot - (p / 100.0) * th

    out = [_inter(0, 13, f"Your {card_name} card holds ${limit:,}. Right now it is "
                         f"{pct:.0f}% full.", size=11.0, fill=INK, weight="700")]

    out.append(_mono(t1x + tw / 2, 38, "TODAY", size=7.0, fill=LABEL, anchor="middle", ls=1.6))
    out.append(_mono(t2x + tw / 2, 38, "THE GOAL", size=7.0, fill=INK, weight="700",
                     anchor="middle", ls=1.6))

    for tx in (t1x, t2x):
        out.append(f'<path d="M {tx:.1f} {top:.1f} L {tx:.1f} {bot:.1f} '
                   f'L {tx+tw:.1f} {bot:.1f} L {tx+tw:.1f} {top:.1f}" '
                   f'fill="none" stroke="{INK}" stroke-width="1.3"/>')

    fy1 = fill_y(pct)
    out.append(f'<rect x="{t1x+0.7:.1f}" y="{fy1:.1f}" width="{tw-1.4:.1f}" '
               f'height="{bot-fy1-0.7:.1f}" fill="{INK}"/>')
    fy2 = fill_y(tgt_pct)
    out.append(f'<rect x="{t2x+0.7:.1f}" y="{fy2:.1f}" width="{tw-1.4:.1f}" '
               f'height="{bot-fy2-0.7:.1f}" fill="{INK}"/>')

    out.append(f'<line x1="{t1x+tw:.1f}" y1="{fy1:.1f}" x2="{t1x+tw+16:.1f}" y2="{fy1:.1f}" '
               f'stroke="{MUTED}" stroke-width="0.7"/>')
    out.append(_mono(t1x + tw + 20, fy1 + 4, f"${balance:,}", size=12.5, fill=INK,
                     weight="700", ls=-0.3))
    out.append(_mono(t1x + tw + 20, fy1 + 16, f"{pct:.0f}% FULL", size=6.6, fill=LABEL, ls=1.2))

    out.append(_mono(t2x - 10, fy2 + 4, f"${target_bal:,}", size=10.5, fill=INK,
                     weight="700", anchor="end", ls=-0.2))

    sy = fill_y(10.0)
    out.append(f'<line x1="{t1x-8:.1f}" y1="{sy:.1f}" x2="{t2x+tw+8:.1f}" y2="{sy:.1f}" '
               f'stroke="{INK}" stroke-width="0.9" stroke-dasharray="3.2 2.6"/>')
    out.append(_mono(gap_c, sy - 5, "THE SAFE ZONE \u00b7 UNDER 10%", size=6.5, fill=INK,
                     weight="700", anchor="middle", ls=1.1))

    ay = 118.0
    out.append(f'<line x1="{t1x+tw+58:.1f}" y1="{ay:.1f}" x2="{t2x-24:.1f}" y2="{ay:.1f}" '
               f'stroke="{INK}" stroke-width="1.2"/>')
    out.append(f'<polygon points="{t2x-14:.1f},{ay:.1f} {t2x-25:.1f},{ay-4.4:.1f} '
               f'{t2x-25:.1f},{ay+4.4:.1f}" fill="{INK}"/>')
    out.append(_mono(gap_c, ay - 9, f"PAY DOWN ${pay_amount:,}", size=7.6, fill=INK,
                     weight="700", anchor="middle", ls=1.0))
    out.append(_inter(gap_c, ay + 15, "the fastest win on your entire report",
                      size=7.6, fill=MUTED, anchor="middle"))

    ty = bot + 23
    out.append(_inter(0, ty, "A nearly full card tells every lender 'I am maxed out.'",
                      size=9.4, fill=INK, weight="600"))
    out.append(_inter(0, ty + 15, "Get it under the dotted line and your score jumps. "
                                  "Your pre-approval jumps with it.",
                      size=9.0, fill="#45454B"))
    return _svg(ty + 24, "".join(out), cap)


def _wwrap(text, max_chars):
    """Deterministic word wrap for plain phrases."""
    lines, cur = [], ""
    for w_ in str(text).split(" "):
        piece = w_ if not cur else cur + " " + w_
        if len(piece) > max_chars and cur:
            lines.append(cur)
            cur = w_
        else:
            cur = piece
    if cur:
        lines.append(cur)
    return lines


def score_lineup(rows, cap=None):
    """Three bureaus drawn as a lineup. Sorted lowest to highest so the middle
    card is literally the middle score, with an arrow physically picking it.
    The picture performs the rule: lenders line them up and take the middle."""
    ranked = sorted(rows, key=lambda r: int(r[1]))
    spread = int(ranked[2][1]) - int(ranked[0][1])
    mid = ranked[1]

    cw, gap = 150.0, 12.0
    x0 = (W - (cw * 3 + gap * 2)) / 2.0
    top, ch = 62.0, 116.0

    out = [_inter(0, 13, "You do not have one credit score. You have three.",
                  size=11.0, fill=INK, weight="700")]

    mcx = x0 + cw + gap + cw / 2.0
    out.append(_mono(mcx, 34, "LENDERS PICK THE MIDDLE SCORE", size=7.0, fill=INK,
                     weight="700", anchor="middle", ls=1.1))
    out.append(f'<line x1="{mcx:.1f}" y1="{40:.1f}" x2="{mcx:.1f}" y2="{top-7:.1f}" '
               f'stroke="{INK}" stroke-width="1.2"/>')
    out.append(f'<polygon points="{mcx:.1f},{top-2:.1f} {mcx-4.6:.1f},{top-9:.1f} '
               f'{mcx+4.6:.1f},{top-9:.1f}" fill="{INK}"/>')

    tags = ["LOWEST", "YOUR MIDDLE SCORE", "HIGHEST"]
    for i, (name, score, note) in enumerate(ranked):
        x = x0 + i * (cw + gap)
        is_mid = (i == 1)
        out.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{cw:.1f}" height="{ch:.1f}" '
                   f'fill="#FFFFFF" stroke="{INK if is_mid else "#DDDDE1"}" '
                   f'stroke-width="{1.5 if is_mid else 0.9}"/>')
        if is_mid:
            out.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{cw:.1f}" height="2.4" '
                       f'fill="url(#fhspec)"/>')
        cx = x + cw / 2.0
        out.append(_mono(cx, top + 20, str(name).upper(), size=6.8,
                         fill=INK if is_mid else LABEL, anchor="middle", ls=1.4))
        out.append(_mono(cx, top + 58, str(score), size=28, fill=INK, weight="700",
                         anchor="middle", ls=-1.0))
        out.append(_inter(cx, top + 78, note, size=7.6,
                          fill="#45454B" if is_mid else MUTED, anchor="middle"))
        out.append(_mono(cx, top + ch - 8, tags[i], size=6.0,
                         fill=INK if is_mid else MUTED,
                         weight="700" if is_mid else "500", anchor="middle", ls=1.0))

    ty = top + ch + 22
    out.append(_inter(0, ty, f"Line them up from lowest to highest. Lenders use the middle "
                             f"one. Yours is {mid[1]}.", size=9.4, fill=INK, weight="600"))
    out.append(_inter(0, ty + 15, "They do not match because not every company reports to all "
                                  "three bureaus.", size=9.0, fill="#45454B"))
    out.append(_inter(0, ty + 29, f"Your best and worst are {spread} points apart. Closing "
                                  f"that gap is the job.", size=9.0, fill="#45454B"))
    return _svg(ty + 38, "".join(out), cap)


def severity_scale(items, cap=None):
    """items: [(table_num, short_name, plain_note, fx, side)] where fx is the
    0..1 position on the hurts-less to hurts-most rail and side is 'a' or 'b'.
    Positions come from the report's own ranking, never computed here."""
    rail_y = 118.0
    rx0, rx1 = 10.0, W - 10.0

    out = [_inter(0, 13, "Your 7 negative items are not equally bad.",
                  size=11.0, fill=INK, weight="700")]
    out.append(f'<line x1="{rx0:.1f}" y1="{rail_y:.1f}" x2="{rx1:.1f}" y2="{rail_y:.1f}" '
               f'stroke="{TRACK}" stroke-width="2.6"/>')
    out.append(f'<polygon points="{rx1+6:.1f},{rail_y:.1f} {rx1-3:.1f},{rail_y-4.2:.1f} '
               f'{rx1-3:.1f},{rail_y+4.2:.1f}" fill="{INK}"/>')
    out.append(_mono(rx0, rail_y + 15, "HURTS LESS \u00b7 EASIER TO FIX", size=6.2,
                     fill=MUTED, ls=1.1))
    out.append(_mono(rx1, rail_y + 15, "HURTS MOST \u00b7 FIX FIRST", size=6.2,
                     fill=INK, weight="700", anchor="end", ls=1.1))

    for num, name, note, fx, side in items:
        x = rx0 + fx * (rx1 - rx0)
        lx = min(max(x, 58.0), W - 58.0)
        if side == "a":
            ly = 52.0
            out.append(f'<line x1="{x:.1f}" y1="{rail_y-8:.1f}" x2="{x:.1f}" y2="{ly+16:.1f}" '
                       f'stroke="{HAIR}" stroke-width="0.8"/>')
        else:
            ly = 160.0
            out.append(f'<line x1="{x:.1f}" y1="{rail_y+8:.1f}" x2="{x:.1f}" y2="{ly-10:.1f}" '
                       f'stroke="{HAIR}" stroke-width="0.8"/>')
        out.append(f'<circle cx="{x:.1f}" cy="{rail_y:.1f}" r="7.2" fill="{INK}"/>')
        out.append(_mono(x, rail_y + 2.6, str(num), size=6.6, fill="#FFFFFF",
                         weight="700", anchor="middle", ls=0))
        out.append(_inter(lx, ly, name, size=7.9, fill=INK, weight="700", anchor="middle"))
        for j, ln in enumerate(_wwrap(note, 20)):
            out.append(_inter(lx, ly + 10 + j * 9.0, ln, size=7.0, fill=MUTED, anchor="middle"))

    ty = 206.0
    out.append(_inter(0, ty, "Start on the right. The SIGNET BANK charge-off sits on the file "
                             "most lenders read first.", size=9.4, fill=INK, weight="600"))
    out.append(_inter(0, ty + 15, "The two on the far left are paperwork errors. Letters get "
                                  "them removed.", size=9.0, fill="#45454B"))
    return _svg(ty + 24, "".join(out), cap)


def money_chain(steps, headline, teach, cap=None):
    """steps: [(kicker, bold_line, sub_line)] drawn as a four-panel chain with
    arrows. Cause and effect, left to right, comic-strip causality."""
    n = len(steps)
    bw, bh = 112.0, 90.0
    agap = (W - bw * n) / (n - 1)
    top = 30.0

    out = [_inter(0, 13, headline, size=11.0, fill=INK, weight="700")]
    for i, (kick, bold, sub) in enumerate(steps):
        x = i * (bw + agap)
        last = (i == n - 1)
        out.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{bw:.1f}" height="{bh:.1f}" '
                   f'fill="{"#F6F6F8" if last else "#FFFFFF"}" '
                   f'stroke="{INK if last else "#DDDDE1"}" '
                   f'stroke-width="{1.4 if last else 0.9}"/>')
        if last:
            out.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{bw:.1f}" height="2.4" '
                       f'fill="url(#fhspec)"/>')
        cx = x + bw / 2.0
        out.append(_mono(cx, top + 15, kick, size=5.8, fill=LABEL, anchor="middle", ls=1.3))
        blines = _wwrap(bold, 13)
        for j, ln in enumerate(blines):
            out.append(_inter(cx, top + 32 + j * 11.0, ln, size=8.8, fill=INK,
                              weight="700", anchor="middle"))
        sy = top + 32 + len(blines) * 11.0 + 3
        for j, ln in enumerate(_wwrap(sub, 16)):
            out.append(_mono(cx, sy + j * 9.6, ln, size=6.9, fill="#45454B",
                             anchor="middle", ls=0.2))
        if not last:
            ax0, ax1 = x + bw + 4, x + bw + agap - 4
            ay = top + bh / 2.0
            out.append(f'<line x1="{ax0:.1f}" y1="{ay:.1f}" x2="{ax1-6:.1f}" y2="{ay:.1f}" '
                       f'stroke="{INK}" stroke-width="1.2"/>')
            out.append(f'<polygon points="{ax1:.1f},{ay:.1f} {ax1-8:.1f},{ay-4:.1f} '
                       f'{ax1-8:.1f},{ay+4:.1f}" fill="{INK}"/>')

    ty = top + bh + 24
    out.append(_inter(0, ty, teach, size=9.4, fill=INK, weight="600"))
    return _svg(ty + 10, "".join(out), cap)


def journey_map(cap=None):
    """The fundability journey. Two tracks running at the same time: fund now
    on the clean file while repair rounds run in parallel, merging at the
    re-check into the bigger number. Draws the plan the pack only states."""
    out = [_inter(0, 13, "Your plan runs on two tracks at the same time.",
                  size=11.0, fill=INK, weight="700")]

    t1y, t2y, my = 64.0, 156.0, 110.0

    # start node
    out.append(_mono(0, 82, "YOU ARE HERE", size=6.0, fill=INK, weight="700", ls=1.2))
    out.append(f'<rect x="0" y="88" width="70" height="44" fill="{INK}"/>')
    out.append(_mono(35, 107, "START", size=7.4, fill="#FFFFFF", weight="700",
                     anchor="middle", ls=1.4))
    out.append(_mono(35, 120, "DIAGNOSTIC DONE", size=4.9, fill="#B9B9C0",
                     anchor="middle", ls=0.8))

    # split connectors
    for yy in (t1y, t2y):
        out.append(f'<path d="M 70 {my:.0f} L 82 {my:.0f} L 82 {yy:.0f} L 94 {yy:.0f}" '
                   f'fill="none" stroke="{INK}" stroke-width="1.1"/>')

    # track 1: fund now
    out.append(_mono(96, t1y - 14, "TRACK 1 \u00b7 FUND NOW", size=6.4, fill=INK,
                     weight="700", ls=1.3))
    out.append(f'<rect x="96" y="{t1y-18+2:.0f}" width="0" height="0" fill="none"/>')
    out.append(f'<rect x="96" y="{t1y-16+8:.0f}" width="140" height="40" fill="#FFFFFF" '
               f'stroke="{INK}" stroke-width="1.1"/>')
    out.append(_inter(166, t1y + 8, "Apply on your clean file", size=7.6, fill=INK,
                      weight="700", anchor="middle"))
    out.append(_mono(166, t1y + 20, "$7,936 AVAILABLE TODAY", size=5.9, fill=LABEL,
                     anchor="middle", ls=0.7))
    out.append(f'<line x1="236" y1="{t1y+4:.0f}" x2="330" y2="{t1y+4:.0f}" '
               f'stroke="{INK}" stroke-width="1.1"/>')

    # track 2: repair rounds
    out.append(_mono(96, t2y - 14, "TRACK 2 \u00b7 REPAIR", size=6.4, fill=INK,
                     weight="700", ls=1.3))
    for i in range(3):
        bx = 96 + i * 76
        out.append(f'<rect x="{bx}" y="{t2y-8:.0f}" width="60" height="40" fill="#FFFFFF" '
                   f'stroke="{INK}" stroke-width="1.1"/>')
        out.append(_mono(bx + 30, t2y + 8, f"ROUND {i+1}", size=6.4, fill=INK,
                         weight="700", anchor="middle", ls=0.8))
        out.append(_mono(bx + 30, t2y + 19, "DISPUTE", size=5.2, fill=MUTED,
                         anchor="middle", ls=1.0))
        if i < 2:
            out.append(f'<line x1="{bx+60}" y1="{t2y+12:.0f}" x2="{bx+74}" y2="{t2y+12:.0f}" '
                       f'stroke="{INK}" stroke-width="1.1"/>')
            out.append(f'<polygon points="{bx+76},{t2y+12:.0f} {bx+69},{t2y+9:.0f} '
                       f'{bx+69},{t2y+15:.0f}" fill="{INK}"/>')
    out.append(_mono(96, t2y + 46, "EACH ROUND: DISPUTE \u00b7 WAIT 30 DAYS \u00b7 VERIFY \u00b7 THEN THE NEXT",
                     size=5.6, fill=MUTED, ls=0.9))
    out.append(f'<line x1="308" y1="{t2y+12:.0f}" x2="330" y2="{t2y+12:.0f}" '
               f'stroke="{INK}" stroke-width="1.1"/>')

    # merge
    for yy in (t1y + 4, t2y + 12):
        out.append(f'<path d="M 330 {yy:.0f} L 342 {yy:.0f} L 342 {my:.0f} L 352 {my:.0f}" '
                   f'fill="none" stroke="{INK}" stroke-width="1.1"/>')
    out.append(f'<polygon points="356,{my:.0f} 348,{my-3.6:.0f} 348,{my+3.6:.0f}" fill="{INK}"/>')
    out.append(f'<rect x="356" y="{my-20:.0f}" width="62" height="40" fill="#FFFFFF" '
               f'stroke="{INK}" stroke-width="1.1"/>')
    out.append(_mono(387, my - 3, "RE-CHECK", size=6.2, fill=INK, weight="700",
                     anchor="middle", ls=0.7))
    out.append(_mono(387, my + 9, "FRESH REPORT", size=5.0, fill=MUTED,
                     anchor="middle", ls=0.7))
    out.append(f'<line x1="418" y1="{my:.0f}" x2="432" y2="{my:.0f}" '
               f'stroke="{INK}" stroke-width="1.1"/>')
    out.append(f'<polygon points="436,{my:.0f} 428,{my-3.6:.0f} 428,{my+3.6:.0f}" fill="{INK}"/>')

    # destination
    out.append(f'<rect x="436" y="{my-24:.0f}" width="72" height="48" fill="#F6F6F8" '
               f'stroke="{INK}" stroke-width="1.4"/>')
    out.append(f'<rect x="436" y="{my-24:.0f}" width="72" height="2.4" fill="url(#fhspec)"/>')
    out.append(_mono(472, my - 2, "$19,841", size=9.8, fill=INK, weight="700",
                     anchor="middle", ls=-0.3))
    out.append(_mono(472, my + 12, "BIGGER APPROVALS", size=4.9, fill=LABEL,
                     anchor="middle", ls=0.7))

    ty = t2y + 68
    out.append(_inter(0, ty, "You do not wait for repair to finish before you get money. "
                             "Both tracks run at the same time.", size=9.4, fill=INK, weight="600"))
    out.append(_inter(0, ty + 15, "Each dispute round makes the next application round stronger.",
                      size=9.0, fill="#45454B"))
    return _svg(ty + 24, "".join(out), cap)


def dispute_clock(cap=None):
    """How a dispute round actually works, with the 30-day clock drawn in.
    Kills the 'why is this taking months' anxiety by showing the law's clock
    and the loop for anything that comes back verified."""
    bw, bh, top = 112.0, 64.0, 42.0
    agap = (W - bw * 4) / 3.0
    xs = [i * (bw + agap) for i in range(4)]
    cyc = top + bh / 2.0

    out = [_inter(0, 13, "Why disputes take rounds, not days.", size=11.0, fill=INK,
                  weight="700")]

    boxes = [
        ("STEP 1", "Send letters", "round 1 goes out"),
        ("STEP 2", "The 30 day clock", "the law gives bureaus 30 days"),
        ("STEP 3", "Results come back", "deleted \u00b7 updated \u00b7 verified"),
        ("STEP 4", "Still verified?", "we escalate, stronger letter"),
    ]
    for i, (kick, bold, sub) in enumerate(boxes):
        x = xs[i]
        out.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{bw:.1f}" height="{bh:.1f}" '
                   f'fill="#FFFFFF" stroke="{INK}" stroke-width="0.9"/>')
        cx = x + bw / 2.0
        out.append(_mono(cx, top + 13, kick, size=5.6, fill=LABEL, anchor="middle", ls=1.3))
        out.append(_inter(cx, top + 28, bold, size=8.2, fill=INK, weight="700", anchor="middle"))
        for j, ln in enumerate(_wwrap(sub, 17)):
            out.append(_mono(cx, top + 41 + j * 9.2, ln, size=6.0, fill="#45454B",
                             anchor="middle", ls=0.2))
        if i < 3:
            ax0, ax1 = x + bw + 4, x + bw + agap - 4
            out.append(f'<line x1="{ax0:.1f}" y1="{cyc:.1f}" x2="{ax1-6:.1f}" y2="{cyc:.1f}" '
                       f'stroke="{INK}" stroke-width="1.1"/>')
            out.append(f'<polygon points="{ax1:.1f},{cyc:.1f} {ax1-8:.1f},{cyc-4:.1f} '
                       f'{ax1-8:.1f},{cyc+4:.1f}" fill="{INK}"/>')

    # the clock face on box 2
    ccx, ccy, r = xs[1] + bw - 16, top + 14, 8.0
    out.append(f'<circle cx="{ccx:.1f}" cy="{ccy:.1f}" r="{r:.1f}" fill="#FFFFFF" '
               f'stroke="{INK}" stroke-width="1.0"/>')
    out.append(f'<line x1="{ccx:.1f}" y1="{ccy:.1f}" x2="{ccx:.1f}" y2="{ccy-5.4:.1f}" '
               f'stroke="{INK}" stroke-width="1.0"/>')
    out.append(f'<line x1="{ccx:.1f}" y1="{ccy:.1f}" x2="{ccx+3.8:.1f}" y2="{ccy+1.6:.1f}" '
               f'stroke="{INK}" stroke-width="1.0"/>')

    # deleted exit from box 3
    ex = xs[2] + bw / 2.0
    out.append(f'<line x1="{ex:.1f}" y1="{top+bh:.1f}" x2="{ex:.1f}" y2="{top+bh+16:.1f}" '
               f'stroke="{INK}" stroke-width="1.1"/>')
    out.append(f'<polygon points="{ex:.1f},{top+bh+20:.1f} {ex-3.6:.1f},{top+bh+12:.1f} '
               f'{ex+3.6:.1f},{top+bh+12:.1f}" fill="{INK}"/>')
    out.append(_mono(ex, top + bh + 31, "DELETED = OFF YOUR REPORT", size=6.2, fill=INK,
                     weight="700", anchor="middle", ls=0.9))

    # loop back from box 4 over the top to box 1
    lx0 = xs[3] + bw / 2.0
    lx1 = xs[0] + bw / 2.0
    ly = 28.0
    out.append(f'<path d="M {lx0:.1f} {top:.1f} L {lx0:.1f} {ly:.1f} L {lx1:.1f} {ly:.1f} '
               f'L {lx1:.1f} {top-4:.1f}" fill="none" stroke="{MUTED}" '
               f'stroke-width="0.9" stroke-dasharray="3 2.4"/>')
    out.append(f'<polygon points="{lx1:.1f},{top-1:.1f} {lx1-3.6:.1f},{top-8:.1f} '
               f'{lx1+3.6:.1f},{top-8:.1f}" fill="{MUTED}"/>')
    out.append(_mono((lx0 + lx1) / 2.0, ly - 5, "ROUND 2 \u00b7 ROUND 3", size=6.0,
                     fill=MUTED, anchor="middle", ls=1.1))

    ty = top + bh + 50
    out.append(_inter(0, ty, "One round rarely clears everything. Three rounds is normal.",
                      size=9.4, fill=INK, weight="600"))
    out.append(_inter(0, ty + 15, "The 30 day clock is set by law. That is why this takes "
                                  "months, not days.", size=9.0, fill="#45454B"))
    return _svg(ty + 24, "".join(out), cap)


def application_order(steps, cap=None):
    """steps: [(bold, sub)] drawn as the numbered path, with the shotgun
    anti-pattern crossed out beside it. Order is the strategy."""
    out = [_inter(0, 13, "The order protects your score. Follow it exactly.",
                  size=11.0, fill=INK, weight="700")]
    top, rowh = 36.0, 37.0
    cxch = 11.0

    n = len(steps)
    out.append(f'<line x1="{cxch:.1f}" y1="{top+6:.1f}" x2="{cxch:.1f}" '
               f'y2="{top+(n-1)*rowh+6:.1f}" stroke="{TRACK}" stroke-width="2"/>')
    for i, (bold, sub) in enumerate(steps):
        y = top + i * rowh
        out.append(f'<circle cx="{cxch:.1f}" cy="{y+6:.1f}" r="8" fill="{INK}"/>')
        out.append(_mono(cxch, y + 8.8, str(i + 1), size=7.2, fill="#FFFFFF",
                         weight="700", anchor="middle", ls=0))
        out.append(_inter(28, y + 5, bold, size=8.8, fill=INK, weight="700"))
        out.append(_mono(28, y + 17, sub, size=6.3, fill=LABEL, ls=0.5))

    # the shotgun, crossed out
    px, pw = 330.0, 178.0
    py, ph = top - 2, (n - 1) * rowh + 16
    out.append(f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="{ph:.1f}" '
               f'fill="#F6F6F8" stroke="#DDDDE1" stroke-width="0.9"/>')
    ccx, ccy = px + pw / 2.0, py + ph / 2.0 - 12
    out.append(f'<circle cx="{ccx:.1f}" cy="{ccy:.1f}" r="4" fill="{MUTED}"/>')
    import math
    for k in range(6):
        ang = -80 + k * 33
        a = math.radians(ang)
        ex_, ey_ = ccx + 52 * math.cos(a), ccy + 52 * math.sin(a)
        out.append(f'<line x1="{ccx:.1f}" y1="{ccy:.1f}" x2="{ex_:.1f}" y2="{ey_:.1f}" '
                   f'stroke="{MUTED}" stroke-width="0.9"/>')
        out.append(f'<circle cx="{ex_:.1f}" cy="{ey_:.1f}" r="2.2" fill="none" '
                   f'stroke="{MUTED}" stroke-width="0.9"/>')
    out.append(f'<line x1="{px+14:.1f}" y1="{py+12:.1f}" x2="{px+pw-14:.1f}" '
               f'y2="{py+ph-30:.1f}" stroke="{INK}" stroke-width="2.2"/>')
    out.append(f'<line x1="{px+pw-14:.1f}" y1="{py+12:.1f}" x2="{px+14:.1f}" '
               f'y2="{py+ph-30:.1f}" stroke="{INK}" stroke-width="2.2"/>')
    out.append(_mono(ccx, py + ph - 16, "THE SHOTGUN", size=6.6, fill=INK, weight="700",
                     anchor="middle", ls=1.2))
    out.append(_mono(ccx, py + ph - 6, "HARD INQUIRIES \u00b7 AUTO-DECLINES", size=5.4,
                     fill=MUTED, anchor="middle", ls=0.8))

    ty = top + (n - 1) * rowh + 40
    out.append(_inter(0, ty, "The same five applications in the wrong order get declined.",
                      size=9.4, fill=INK, weight="600"))
    return _svg(ty + 10, "".join(out), cap)
