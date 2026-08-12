/* Homepage multi-step survey — CF ground truth + OWNER attribute keys.
   docs/clickfunnels/cf-survey-ground-truth.md
   docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md
   Contact LAST. Legal Business Name optional. */
(function () {
  var PERSONAL = "No, personal funding only";

  var STEPS = [
    {
      id: "funding_target_amount",
      title: "Set Your Target Amount",
      type: "single",
      options: [
        "Less than $50k",
        "$50k - $100k",
        "$100k - $200k",
        "$200k - $400k",
        "$400k+",
      ],
    },
    {
      id: "planned_use",
      title: "Planned Use",
      type: "single",
      otherEnabled: true,
      options: [
        "Growth (marketing, inventory, hiring)",
        "Equipment or buildout",
        "Debt consolidation",
        "Payroll or rent",
        "Covering a shortfall right now",
        "Not sure yet",
        "Other",
      ],
    },
    {
      id: "money_change_now",
      title: "What Would This Money Change Right Now?",
      subtitle: "Select all that apply.",
      type: "multi",
      options: [
        "Peace of mind (stop stressing about cash)",
        "Grow faster (more customers / more reach)",
        "Pay off pressure (wipe out high-interest debt)",
        "Stability (cover bills / buffer slow weeks)",
        "Fresh start (new business / startup launch)",
      ],
    },
    {
      id: "current_score",
      title: "Your Current Score",
      type: "single",
      options: ["500-579", "580-649", "650-699", "700-749", "750+", "Not sure"],
    },
    {
      id: "has_business",
      title: "Do You Have a Business?",
      type: "single",
      options: [
        "Yes, less than 6 months old",
        "Yes, 6-12 months",
        "Yes, 1-2 years",
        "Yes, 2-5 years",
        "Yes, 5+ years",
        PERSONAL,
      ],
    },
    {
      id: "annual_business_revenue",
      title: "Annual Business Revenue",
      type: "single",
      branch: "business",
      options: [
        "Under $100k",
        "$100k - $249k",
        "$250k - $499k",
        "$500k - $999k",
        "$1M+",
      ],
    },
    {
      id: "verify_revenue",
      title: "Can You Verify Revenue?",
      type: "single",
      branch: "business",
      options: [
        "Yes, bank statements",
        "Yes, tax returns",
        "Yes, both",
        "Not right now",
      ],
    },
    {
      id: "annual_personal_income",
      title: "Annual Personal Income",
      type: "single",
      branch: "personal",
      options: [
        "Less than $50k",
        "$50k-$99k",
        "$100k-$199k",
        "$200k-$499k",
        "$500k+",
      ],
    },
    {
      id: "verify_income",
      title: "Can You Verify Income?",
      type: "single",
      branch: "personal",
      options: [
        "Yes, pay stubs",
        "Yes, W-2 or tax returns",
        "Yes, both",
        "Not right now",
      ],
    },
    {
      id: "available_capital",
      title: "Available Capital",
      type: "single",
      options: [
        "Less than $1k",
        "$1k - $5k",
        "$5k - $25k",
        "$25k - $100k",
        "$100k+",
      ],
    },
    {
      id: "contact",
      title: "Let's Start With Your Info",
      subtitle: "Tell us how to reach you. Soft inquiry. No obligation.",
      type: "contact",
    },
  ];

  // Keep in sync with src/survey/cf-question-map.mjs payloadKey
  var PAYLOAD_KEY = {
    funding_target_amount: "cf_svy_funding_target_amount",
    planned_use: "cf_svy_planned_use",
    money_change_now: "cf_svy_money_change_now",
    current_score: "cf_svy_self_reported_fico",
    has_business: "cf_svy_has_business",
    annual_business_revenue: "cf_svy_business_revenue",
    verify_revenue: "cf_svy_revenue_verifiable",
    annual_personal_income: "cf_svy_annual_income_range",
    verify_income: "cf_svy_income_verifiable",
    available_capital: "cf_svy_available_capital",
  };

  function visibleSteps(answers) {
    var biz = answers.has_business;
    var onPersonal = biz === PERSONAL;
    var onBusiness = typeof biz === "string" && biz.indexOf("Yes") === 0;
    return STEPS.filter(function (s) {
      if (!s.branch) return true;
      if (s.branch === "business") return onBusiness;
      if (s.branch === "personal") return onPersonal;
      return true;
    });
  }

  function toPayloadAnswers(answers) {
    var out = {};
    Object.keys(answers).forEach(function (id) {
      var key = PAYLOAD_KEY[id];
      if (!key) return;
      var v = answers[id];
      if (v == null || v === "") return;
      out[key] = v;
    });
    return out;
  }

  function init() {
    var root = document.getElementById("appform");
    if (!root) return;

    var answers = {};
    var idx = 0;
    var multiPick = {};
    var otherText = "";

    function steps() {
      return visibleSteps(answers);
    }

    function setErr(msg) {
      var el = root.querySelector(".sv-err");
      if (el) el.textContent = msg || "";
    }

    function render() {
      var list = steps();
      if (idx < 0) idx = 0;
      if (idx >= list.length) idx = list.length - 1;
      var step = list[idx];
      var pct = Math.round(((idx + 1) / list.length) * 100);

      var html =
        '<div class="sv-progress" aria-hidden="true"><i style="width:' +
        pct +
        '%"></i></div>' +
        '<div class="sv-meta"><span>Step ' +
        (idx + 1) +
        " of " +
        list.length +
        "</span></div>" +
        '<div class="sv-q">' +
        step.title +
        "</div>" +
        (step.subtitle ? '<div class="sv-sub">' + step.subtitle + "</div>" : "");

      if (step.type === "contact") {
        html +=
          '<div class="field"><label for="sv-name">Full name</label>' +
          '<input type="text" id="sv-name" name="name" autocomplete="name" required></div>' +
          '<div class="field"><label for="sv-business">Legal Business Name <span style="text-transform:none;letter-spacing:0;color:var(--gray2)">(optional)</span></label>' +
          '<input type="text" id="sv-business" name="business" autocomplete="organization"></div>' +
          '<div class="field"><label for="sv-email">Email address</label>' +
          '<input type="email" id="sv-email" name="email" autocomplete="email" required></div>' +
          '<div class="field"><label for="sv-phone">Mobile phone</label>' +
          '<input type="tel" id="sv-phone" name="phone" autocomplete="tel" required></div>' +
          '<div class="consent"><input type="checkbox" id="sv-sms" name="sms_consent">' +
          '<label for="sv-sms">I expressly consent to receive transactional SMS messages from FUNDHUB LLC about my application and account status at the number provided, including messages sent using automated technology. Checking this box constitutes my electronic signature. Message and data rates may apply. Message frequency varies. Reply STOP to opt out, HELP for help. Consent is not a condition of any purchase or service. See our <a href="/privacy/">Privacy Policy</a> and <a href="/terms/#sms">SMS Terms</a>.</label></div>' +
          '<p class="sv-err" role="alert"></p>' +
          '<div class="sv-nav">' +
          (idx > 0
            ? '<button type="button" class="btn btn-ghost" data-act="back">Back</button>'
            : "") +
          '<button type="button" class="btn" data-act="submit">Submit application</button></div>' +
          '<p class="disclaim">By submitting, you confirm the information provided is accurate and that you are the subscriber or authorized user of the phone number entered. Fundhub is not a direct lender and does not guarantee approval or specific terms.</p>';
      } else {
        var selected = answers[step.id];
        var picked = multiPick[step.id] || {};
        html +=
          '<div class="sv-opts" role="listbox" aria-label="' +
          step.title.replace(/"/g, "") +
          '">';
        (step.options || []).forEach(function (opt) {
          var on = step.type === "multi" ? !!picked[opt] : selected === opt;
          html +=
            '<button type="button" class="sv-opt' +
            (on ? " on" : "") +
            '" data-opt="' +
            opt.replace(/"/g, "&quot;") +
            '">' +
            opt +
            "</button>";
        });
        html += "</div>";
        if (step.otherEnabled && selected === "Other") {
          html +=
            '<div class="field" style="margin-top:8px"><label for="sv-other">Other</label>' +
            '<input type="text" id="sv-other" value="' +
            String(otherText || "").replace(/"/g, "&quot;") +
            '"></div>';
        }
        html += '<p class="sv-err" role="alert"></p>';
        html += '<div class="sv-nav">';
        if (idx > 0)
          html +=
            '<button type="button" class="btn btn-ghost" data-act="back">Back</button>';
        html +=
          '<button type="button" class="btn" data-act="next">Next</button></div>';
      }

      root.innerHTML = html;
      bind(step);
    }

    function bind(step) {
      root.querySelectorAll(".sv-opt").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var val = btn.getAttribute("data-opt");
          if (step.type === "multi") {
            multiPick[step.id] = multiPick[step.id] || {};
            multiPick[step.id][val] = !multiPick[step.id][val];
            render();
          } else {
            answers[step.id] = val;
            render();
          }
        });
      });
      var otherInput = document.getElementById("sv-other");
      if (otherInput) {
        otherInput.addEventListener("input", function () {
          otherText = otherInput.value;
        });
      }
      var back = root.querySelector('[data-act="back"]');
      if (back)
        back.addEventListener("click", function () {
          idx -= 1;
          setErr("");
          render();
        });
      var next = root.querySelector('[data-act="next"]');
      if (next)
        next.addEventListener("click", function () {
          if (step.type === "multi") {
            var picks = Object.keys(multiPick[step.id] || {}).filter(function (
              k
            ) {
              return multiPick[step.id][k];
            });
            if (!picks.length) {
              setErr("Select at least one option.");
              return;
            }
            answers[step.id] = picks;
          } else if (!answers[step.id]) {
            setErr("Please select an option to continue.");
            return;
          } else if (step.otherEnabled && answers[step.id] === "Other") {
            var ot = (document.getElementById("sv-other") || {}).value || "";
            ot = String(ot).trim();
            if (!ot) {
              setErr("Please describe Other.");
              return;
            }
            otherText = ot;
            answers[step.id] = ot;
          }
          if (step.id === "has_business") {
            if (answers[step.id] === PERSONAL) {
              delete answers.annual_business_revenue;
              delete answers.verify_revenue;
            } else {
              delete answers.annual_personal_income;
              delete answers.verify_income;
            }
          }
          idx += 1;
          setErr("");
          render();
        });
      var submit = root.querySelector('[data-act="submit"]');
      if (submit)
        submit.addEventListener("click", function () {
          submitForm(submit);
        });
    }

    function submitForm(btn) {
      var name = (document.getElementById("sv-name") || {}).value || "";
      var email = (document.getElementById("sv-email") || {}).value || "";
      var phone = (document.getElementById("sv-phone") || {}).value || "";
      var business = (document.getElementById("sv-business") || {}).value || "";
      var sms = !!(document.getElementById("sv-sms") || {}).checked;
      name = String(name).trim();
      email = String(email).trim();
      phone = String(phone).trim();
      business = String(business).trim();
      if (!name || !email || !phone) {
        setErr("Please complete name, email, and phone.");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Processing…";
      setErr("");

      fetch("/api/public/survey-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          business: business,
          sms_consent: sms,
          source: "website:home",
          answers: toPayloadAnswers(answers),
          answers_by_id: answers,
          page_url: location.href,
          submitted_at: new Date().toISOString(),
        }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, status: r.status, body: j };
          });
        })
        .then(function (res) {
          if (!res.ok || !res.body || !res.body.redirect) {
            btn.disabled = false;
            btn.textContent = "Submit application";
            setErr(
              (res.body && res.body.error) ||
                "Something went wrong. Please try again."
            );
            return;
          }
          window.location.href = res.body.redirect;
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = "Submit application";
          setErr("Network error. Please try again.");
        });
    }

    root.addEventListener("submit", function (e) {
      e.preventDefault();
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
