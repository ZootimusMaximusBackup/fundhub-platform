/* Class quizzes from docs/company-resources/ramp-*.md.
   Scored on this page. No new route. PASS_BAR stays owner-locked.
   Day 5 files say "must miss zero" — that rule is in the packs, not invented. */
(function (root) {
  "use strict";

  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9+$%.\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasAny(text, words) {
    if (!words || !words.length) return true;
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  function hasAllGroups(text, groups) {
    if (!groups || !groups.length) return text.length > 0;
    for (var i = 0; i < groups.length; i++) {
      if (!hasAny(text, groups[i])) return false;
    }
    return true;
  }

  var QUIZZES = [
    {
      id: "closer-d1",
      seat: "closer",
      day: 1,
      title: "Closer · Day 1",
      mustMissZero: false,
      questions: [
        { q: "Are we the bank?", yesNo: "no" },
        { q: "Do they need an LLC first?", yesNo: "no" },
        { q: "What is the $32 for?", accept: [["soft"], ["file", "look", "report", "credit"]] },
        { q: "Name four things you mark on a report.", acceptAny: 3, accept: [["late"], ["card", "util", "full"], ["inquir"], ["bad mark", "derog", "collection"], ["personal"]] }
      ]
    },
    {
      id: "closer-d2",
      seat: "closer",
      day: 2,
      title: "Closer · Day 2",
      mustMissZero: false,
      questions: [
        { q: "Is the $3,000 extra on top of the 10%?", yesNo: "no" },
        { q: "Can they put the funding start on Commas?", yesNo: "no" },
        { q: "What two things can finance?", accept: [["underwrite"], ["mastery"]] },
        { q: "What does “deposit logged” mean in one line?", accept: [["paid", "start", "client"], ["hand"]] }
      ]
    },
    {
      id: "closer-d3",
      seat: "closer",
      day: 3,
      title: "Closer · Day 3",
      mustMissZero: false,
      questions: [
        { q: "Client: “So you’ll get me the money?” What do you say?", accept: [["lender"], ["cannot promise", "can t promise", "no promise", "not promise", "help you apply"]] },
        { q: "Client: “Will my score go up?” What do you say?", accept: [["do not promise", "dont promise", "not promise", "no promise", "cannot promise"]], reject: [["score will go up"], ["yes"]] },
        { q: "When do you stop and get a manager?", accept: [["refund"], ["manager", "playbook", "5%", "10%"]] }
      ]
    },
    {
      id: "closer-d4",
      seat: "closer",
      day: 4,
      title: "Closer · Day 4",
      mustMissZero: false,
      questions: [
        { q: "Who runs the first working call after pay?", accept: [["funding advisor", "fa"]] },
        { q: "How many rounds do we teach as shape (not a buyer promise)?", accept: [["3"], ["4"]] },
        { q: "May you promise a fund date?", yesNo: "no" }
      ]
    },
    {
      id: "closer-d5",
      seat: "closer",
      day: 5,
      title: "Closer · Day 5 (must miss zero)",
      mustMissZero: true,
      questions: [
        { q: "What is funding here?", accept: [["not the bank", "we are not the bank", "lenders decide"], ["help", "apply", "lender"]] },
        { q: "Why does $32 exist?", accept: [["soft"], ["file", "look", "report"]] },
        { q: "Who hears funding vs a course vs cash downsell?", accept: [["700"], ["500"], ["course"], ["cash", "downsell"]] },
        { q: "How do the start and the 10% fit?", accept: [["count", "toward", "part of", "toward the 10"], ["10"]] },
        { q: "Name three things you never promise.", accept: [["score"], ["fund", "yes", "approved"], ["dollar", "amount", "set"]] }
      ]
    },
    {
      id: "fa-d1",
      seat: "funding_advisor",
      day: 1,
      title: "Funding advisor · Day 1",
      mustMissZero: false,
      questions: [
        { q: "Did they already pay the start? What does that make them?", accept: [["yes"], ["client"]] },
        { q: "Are we the lender?", accept: [["lender"], ["decide", "help apply", "not say"]] },
        { q: "Do they need a business?", yesNo: "no" }
      ]
    },
    {
      id: "fa-d2",
      seat: "funding_advisor",
      day: 2,
      title: "Funding advisor · Day 2",
      mustMissZero: false,
      questions: [
        { q: "What holds a new funding file?", accept: [["doc"], ["missing", "unaccept", "wait"]] },
        { q: "Where do tasks live?", accept: [["portal"], ["fundhub", "file"]] },
        { q: "May you start rounds before docs are accepted?", yesNo: "no" }
      ]
    },
    {
      id: "fa-d3",
      seat: "funding_advisor",
      day: 3,
      title: "Funding advisor · Day 3",
      mustMissZero: false,
      questions: [
        { q: "Who wipes inquiries?", accept: [["inquir"], ["specialist"]] },
        { q: "Who runs repair?", accept: [["repair"], ["specialist"]] },
        { q: "What do you say about wait time?", accept: [["expedit"], ["no overnight", "not overnight", "no score"]] }
      ]
    },
    {
      id: "fa-d4",
      seat: "funding_advisor",
      day: 4,
      title: "Funding advisor · Day 4",
      mustMissZero: false,
      questions: [
        { q: "Why not spray every lender at once?", accept: [["inquir"], ["heat", "plan", "round"]] },
        { q: "When does inquiry work usually sit?", accept: [["between"]] },
        { q: "May you promise which card they will get?", yesNo: "no" }
      ]
    },
    {
      id: "fa-d5",
      seat: "funding_advisor",
      day: 5,
      title: "Funding advisor · Day 5 (must miss zero)",
      mustMissZero: true,
      questions: [
        { q: "What is funding here?", accept: [["help apply", "lenders decide", "lender"]] },
        { q: "How do start fee and 10% fit?", accept: [["count", "toward", "part of"], ["10"]] },
        { q: "What is the file clock?", accept: [["15"], ["30"]] },
        { q: "When do you hand inquiry vs repair?", accept: [["inquir"], ["repair"]] },
        { q: "What do you never promise on the start call?", accept: [["score"], ["fund", "yes"], ["overnight", "dollar", "set"]] }
      ]
    },
    {
      id: "inq-d1",
      seat: "inquiry",
      day: 1,
      title: "Inquiry · Day 1",
      mustMissZero: false,
      questions: [
        { q: "What is an inquiry in plain words?", accept: [["hard look", "look"], ["lender", "company"]] },
        { q: "What two things do you mark first on a report?", accept: [["inquir"], ["personal"]] },
        { q: "Do you promise the next round will fund?", yesNo: "no", reject: [["we will get you funded"]] }
      ]
    },
    {
      id: "inq-d2",
      seat: "inquiry",
      day: 2,
      title: "Inquiry · Day 2",
      mustMissZero: false,
      questions: [
        { q: "What does the side menu say?", accept: [["specialist"]] },
        { q: "Which toggle is yours?", accept: [["inquir"]] },
        { q: "May you send without a click?", yesNo: "no" }
      ]
    },
    {
      id: "inq-d3",
      seat: "inquiry",
      day: 3,
      title: "Inquiry · Day 3",
      mustMissZero: false,
      questions: [
        { q: "When do you usually wipe — during a round or between?", accept: [["between"]] },
        { q: "What if you are not sure leave vs wipe?", accept: [["manager"], ["write", "ask"]] },
        { q: "Is there a monthly wipe count?", yesNo: "no" }
      ]
    },
    {
      id: "inq-d4",
      seat: "inquiry",
      day: 4,
      title: "Inquiry · Day 4",
      mustMissZero: false,
      questions: [
        { q: "Who preps the file?", accept: [["funding advisor", "fa"]] },
        { q: "Who funds / runs rounds?", accept: [["funding advisor", "fa"]] },
        { q: "What is your clock?", accept: [["15"], ["30"]] }
      ]
    },
    {
      id: "inq-d5",
      seat: "inquiry",
      day: 5,
      title: "Inquiry · Day 5 (must miss zero)",
      mustMissZero: true,
      questions: [
        { q: "Where do you sit in the CRM?", accept: [["specialist"], ["inquir"]] },
        { q: "When do you wipe vs leave?", accept: [["between"], ["ask", "manager", "unsure"]] },
        { q: "What is the file clock?", accept: [["15"], ["30"]] },
        { q: "What do you never tell a client?", accept: [["score"], ["fund", "sure"]] },
        { q: "What is blocked on your mock file today?", accept: [["block", "dummy", "cannot", "not send", "stuck"]], reject: [["clear file"], ["nothing blocked"], ["all good"]] }
      ]
    },
    {
      id: "repair-d1",
      seat: "repair",
      day: 1,
      title: "Repair · Day 1",
      mustMissZero: false,
      questions: [
        { q: "What do you never promise about a mark?", accept: [["come off", "will come off", "comes off"]] },
        { q: "What do you never promise about a score?", accept: [["go up", "will go up", "goes up"]] },
        { q: "Are you the closer?", yesNo: "no" }
      ]
    },
    {
      id: "repair-d2",
      seat: "repair",
      day: 2,
      title: "Repair · Day 2",
      mustMissZero: false,
      questions: [
        { q: "What does the side menu say?", accept: [["specialist"]] },
        { q: "Which toggle is yours?", accept: [["repair"]] },
        { q: "What if the Repair list is empty?", accept: [["empty"], ["not invent", "do not invent", "real"]] }
      ]
    },
    {
      id: "repair-d3",
      seat: "repair",
      day: 3,
      title: "Repair · Day 3",
      mustMissZero: false,
      questions: [
        { q: "Overnight?", accept: [["no"], ["expedit"]] },
        { q: "May you use Alec’s 5-day knockout as our promise?", accept: [["no"], ["reference"]] },
        { q: "What do you say about wait?", accept: [["honest", "expedit", "no score", "not score"]] }
      ]
    },
    {
      id: "repair-d4",
      seat: "repair",
      day: 4,
      title: "Repair · Day 4",
      mustMissZero: false,
      questions: [
        { q: "Who gets the file after repair work?", accept: [["funding advisor", "fa"]] },
        { q: "Do you run the first card app?", yesNo: "no" },
        { q: "What goes in the hand-back note?", accept: [["worked", "open", "did"], ["no outcome", "no promise", "not promise"]] }
      ]
    },
    {
      id: "repair-d5",
      seat: "repair",
      day: 5,
      title: "Repair · Day 5 (must miss zero)",
      mustMissZero: true,
      questions: [
        { q: "Name three banned lines.", accept: [["score"], ["come off", "mark"], ["fund", "overnight"]] },
        { q: "How do we mail?", accept: [["expedit"], ["us mail", "mail"]] },
        { q: "When does Send letters show?", accept: [["letter"], ["ready", "body"]] },
        { q: "What is the file clock?", accept: [["15"], ["30"]] },
        { q: "Who do you ping when a bureau answer needs a person?", accept: [["manager"], ["specialist", "owner", "admin", "stuck"]] }
      ]
    }
  ];

  function scoreQuestion(q, raw) {
    var text = norm(raw);
    if (!text) return { ok: false, empty: true };
    var reject = q.reject || [];
    for (var i = 0; i < reject.length; i++) {
      if (hasAny(text, reject[i])) return { ok: false, empty: false };
    }
    if (q.yesNo) {
      var wantNo = q.yesNo === "no";
      var hasNo = /\bno\b/.test(text) || text.indexOf("never") !== -1;
      var hasYes = /\byes\b/.test(text);
      if (wantNo) return { ok: hasNo && !hasYes, empty: false };
      return { ok: hasYes && !hasNo, empty: false };
    }
    var groups = q.accept || [];
    var need = q.acceptAny != null ? Number(q.acceptAny) : groups.length;
    var hit = 0;
    for (var j = 0; j < groups.length; j++) {
      if (hasAny(text, groups[j])) hit += 1;
    }
    return { ok: hit >= need && hit > 0, empty: false };
  }

  function scoreRampQuiz(quiz, answers) {
    var list = (quiz && quiz.questions) || [];
    var results = [];
    var correct = 0;
    for (var i = 0; i < list.length; i++) {
      var row = scoreQuestion(list[i], answers && answers[i]);
      if (row.ok) correct += 1;
      results.push(row);
    }
    var mustMissZero = !!(quiz && quiz.mustMissZero);
    return {
      correct: correct,
      total: list.length,
      results: results,
      mustMissZero: mustMissZero,
      passed: mustMissZero ? (correct === list.length && list.length > 0) : null
    };
  }

  function quizzesForRole(role) {
    var r = String(role || "").toLowerCase();
    if (r === "closer") return QUIZZES.filter(function (q) { return q.seat === "closer"; });
    if (r === "funding_advisor") return QUIZZES.filter(function (q) { return q.seat === "funding_advisor"; });
    if (r === "inquiry_specialist") {
      return QUIZZES.filter(function (q) { return q.seat === "inquiry" || q.seat === "repair"; });
    }
    return QUIZZES.slice();
  }

  root.FH_RAMP_QUIZZES = QUIZZES;
  root.scoreRampQuiz = scoreRampQuiz;
  root.quizzesForRole = quizzesForRole;
})(typeof window !== "undefined" ? window : globalThis);
