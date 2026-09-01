import json, sys, os

S = os.path.dirname(os.path.abspath(__file__))
concepts = []
for f in ['batch1.json', 'batch2.json', 'batch3.json']:
    p = os.path.join(S, f)
    if os.path.exists(p):
        concepts += json.load(open(p))['concepts']

GATE_ORDER = ['600+', '700+ no negatives', 'Premium/strict', 'Open']
GATE_TITLE = {
    '600+': 'Gate: 600+ — the main lane',
    '700+ no negatives': 'Gate: 700+ with a clean file — the straight funding lane',
    'Premium/strict': 'Gate: Premium — hard disqualification',
    'Open': 'Gate: Open — no FICO bar',
}
GATE_NOTE = {
    '600+': 'Fixable negatives, usually has cash, finances into the courses. Where most of the spend goes.',
    '700+ no negatives': 'PASS in the code. Cleanest path to the $3,000 deposit. These people already qualify and do not know their number.',
    'Premium/strict': '800 FICO, verifiable income, wants serious capital fast, is not in trouble. Expensive to acquire, least fulfillment drag.',
    'Open': 'No bar. Cheapest leads. These route to repair and the courses, not funding.',
}

def norm_len(c):
    """Minimum 60s, owner-set. Longer where the concept carries the full belt or a case study."""
    blob = (c.get('mechanism','') + ' ' + c.get('angle','') + ' ' + c.get('bet','')).lower()
    heavy = ('conveyor belt' in blob or '12 round' in blob or 'twelve round' in blob
             or 'koi poke' in blob or 'sweep' in blob or 'case study' in blob)
    if c.get('awareness') == 'unaware' or 'founder' in blob or 'thousand hours' in blob:
        return '2min+'
    return '90-120s' if heavy else '60-90s'


import re as _re
def _clean(t):
    if not isinstance(t,str): return t
    t = _re.sub(r'COMPLIANCE REVIEW REQUIRED[ .:-]*','',t, flags=_re.I)
    # strip production asides the generators embedded in field text
    t = _re.sub(r'(BEFORE SHOOTING|Do not state repair or trial payment terms|At 60-90s, scope this)[^.]*\.','',t)
    return _re.sub(r'\s{2,}',' ',t).strip()
for c in concepts:
    for k in ('mechanism','angle','bet','enemy','who'):
        if k in c: c[k]=_clean(c[k])

concepts.sort(key=lambda c: (GATE_ORDER.index(c['gate']) if c['gate'] in GATE_ORDER else 9, c.get('rank', 99)))

lines = []
n = 0
by_gate = {}
for c in concepts:
    by_gate.setdefault(c['gate'], []).append(c)

for g in GATE_ORDER:
    if g not in by_gate:
        continue
    items = by_gate[g]
    lines.append(f'## {GATE_TITLE[g]}\n')
    lines.append(f'*{GATE_NOTE[g]}* — {len(items)} concepts\n')
    for c in items:
        n += 1
        lines.append(f"### {n}. {c['title'].strip(chr(34))}\n")
        lines.append(f"> {c['hook']}\n")
        lines.append(f"**Angle** — {c['angle']}  ")
        lines.append(f"**Who** — {c['who']} · {c['gate']}  ")
        lines.append(f"**Door** — {c['door']} · **{norm_len(c)}** · {c['awareness']}  ")
        lines.append(f"**Enemy** — {c['enemy']}  ")
        lines.append(f"**Mechanism** — {c['mechanism']}  ")
        lines.append(f"**My bet** — {c['bet']}\n")
    lines.append('---\n')

open(os.path.join(S, 'body.md'), 'w').write('\n'.join(lines))
print(f'{n} concepts written')
from collections import Counter
print('gates:', dict(Counter(c['gate'] for c in concepts)))
print('doors:', dict(Counter(c['door'] for c in concepts)))
print('runtime:', dict(Counter(norm_len(c) for c in concepts)))
