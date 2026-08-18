import io, sys

P = "/Users/zootimusmaximus/fundhub-platform/public/app/contracts.html"
src = io.open(P, encoding="utf-8").read()
lines = src.split("\n")

def idx(prefix, start=0):
    hits = [i for i in range(start, len(lines)) if lines[i].startswith(prefix)]
    if len(hits) != 1:
        raise SystemExit("EXPECTED 1 line starting %r, found %d" % (prefix, len(hits)))
    return hits[0]

def rep(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        raise SystemExit("EXPECTED %d occurrence(s), found %d for: %r" % (count, n, old[:90]))
    src = src.replace(old, new)

# ---------- markup splices (line based) ----------
a = idx('      <div class="stats">')
b = idx('      <!-- ── the wording library: owner/admin only')
new_block = [
 '      <div class="card" id="explainCard">',
 '        <div class="card-hd"><span class="badge b-info">How this works</span></div>',
 '        <div class="card-bd note">',
 '          <p><strong>Build a contract once. Use it many times.</strong> Upload a PDF, or type the words here. Add the blanks people fill in. Say who has to sign.</p>',
 '          <p style="margin-top:8px"><strong>Staff pick it later.</strong> When they send a contract from a client’s screen, this one shows up in their list. They never have to write it again.</p>',
 '          <p style="margin-top:8px">To see contracts you already sent, and who has signed them, go to <a href="documents.html" style="text-decoration:underline">Documents</a>.</p>',
 '        </div>',
 '      </div>',
 '',
]
lines = lines[:a] + new_block + lines[b:]
src = "\n".join(lines)

# ---------- css ----------
rep('.eyebrow{display:block}\n.eyebrow .sep{color:var(--line);margin:0 6px}\n', '')
rep('.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}\n'
    '.stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;position:relative;overflow:hidden}\n'
    '.stat::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:var(--spectrum)}\n'
    '.stat .sv{font-family:var(--mono);font-size:22px;font-weight:600;margin-top:8px;letter-spacing:-.02em}\n'
    '.stat .sd{font-size:11px;color:var(--gray);margin-top:2px}\n', '')
rep('.doc{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px 20px;font-family:var(--mono);font-size:12px;line-height:1.75;white-space:pre-wrap;word-break:break-word;max-height:460px;overflow:auto}\n', '')
rep('@media(max-width:1180px){.layout{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}',
    '@media(max-width:1180px){.layout{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}}')

# ---------- copy ----------
rep('<title>Fundhub — Contracts</title>', '<title>Fundhub — Contract templates</title>')
rep('      <span class="crumb">Work</span><h1>Contracts</h1>',
    '      <span class="crumb">Setup</span><h1>Contract templates</h1>')

# ---------- tplCard visible on load ----------
rep('<div class="card" id="tplCard" style="display:none;margin-top:14px">',
    '<div class="card" id="tplCard" style="margin-top:14px">')

# ---------- js ----------
rep('  function norm(v) { return String(v == null ? "" : v).trim().toLowerCase(); }\n', '')
rep('  var templates = [], contracts = [], isAdmin = false;\n  var selContract = null, editing = null;\n',
    '  var templates = [], editing = null;\n')

lines = src.split("\n")
# resolveRole (comment through end of function) .. up to STATE
a = idx('  /* Same role resolution finance-os.html and template-editor.html use, and for')
b = idx('  var STATE = {')
lines = lines[:a] + lines[b:]
src = "\n".join(lines)

lines = src.split("\n")
# STATE / stateBadge / whenDay / when  .. up to say()
a = idx('  var STATE = {')
b = idx('  function say(el, kind, text) {')
lines = lines[:a] + lines[b:]
src = "\n".join(lines)

lines = src.split("\n")
# the queue + detail card js .. up to the wording library
a = idx('  /* ── the queue ')
b = idx('  /* ── the wording library ')
lines = lines[:a] + lines[b:]
src = "\n".join(lines)

rep('    $("kTpl").textContent = templates.filter(function (t) { return t.active; }).length;\n', '')

rep('      templates = (data && data.items) || [];\n      renderTplList();\n',
    '      templates = (data && data.items) || [];\n      renderTplList();\n      $("liveTxt").textContent = "— live";\n')

rep('''
  function loadContracts() {
    return FHData.wire(FHData.read("contracts", { view: "contracts", limit: 200 }), "contracts", function (data) {
      contracts = (data && data.items) || [];
      renderList();
      $("liveTxt").textContent = "— live";
      return "live contracts · " + contracts.length;
    });
  }
''', '')

lines = src.split("\n")
a = idx('  $("selStatus").addEventListener("change", renderList);')
b = idx('  $("btnNewTpl").onclick = newTemplate;')
lines = lines[:a] + lines[b:]
src = "\n".join(lines)

rep('  resolveRole();\n  loadTemplates();\n  loadContracts();\n', '  loadTemplates();\n')

io.open(P, "w", encoding="utf-8").write(src)
print("OK  %d -> %d lines" % (len(open(P).read().split("\n")), len(src.split("\n"))))
