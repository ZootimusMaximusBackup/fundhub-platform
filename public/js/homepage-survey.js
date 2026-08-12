/* Homepage multi-step survey — keep step keys/options in sync with
   src/config/homepage-survey-steps.mjs (server classify + redirects). */
(function () {
  var STEPS = [
    {
      key: "cf_svy_funding_target_amount",
      title: "Set Your Target Amount",
      subtitle: "Required to continue.",
      type: "single",
      options: ["Less than $50k", "$50k - $100k", "$100k - $200k", "$200k - $400k", "$400k+"],
    },
    {
      key: "cf_svy_planned_use",
      title: "What will you use the funding for?",
      type: "single",
      options: [
        "Working capital / payroll",
        "Inventory or supplies",
        "Equipment",
        "Marketing / growth",
        "Refinance existing debt",
        "Other",
      ],
    },
    {
      key: "cf_svy_money_change_now",
      title: "What needs to change with money right now?",
      subtitle: "Select all that apply.",
      type: "multi",
      options: [
        "Cash flow is tight",
        "Need to grow faster",
        "Catch up on obligations",
        "Invest in the business",
        "Not sure yet",
      ],
    },
    {
      key: "cf_svy_self_reported_fico",
      title: "What is your current credit score?",
      type: "single",
      options: ["500-579", "580-649", "650-699", "700-749", "750+", "Not sure"],
    },
    {
      key: "cf_svy_annual_income_range",
      title: "What is your annual personal income range?",
      type: "single",
      options: ["Under $50k", "$50k - $100k", "$100k - $150k", "$150k - $250k", "$250k+"],
    },
    {
      key: "cf_svy_income_verifiable",
      title: "Can that income be verified (paystubs, tax returns, or bank deposits)?",
      type: "single",
      options: ["Yes", "No", "Not sure"],
    },
    {
      key: "cf_svy_has_business",
      title: "Do you currently own a business?",
      type: "single",
      options: ["Yes", "No"],
    },
    {
      key: "cf_svy_business_revenue",
      title: "What is your approximate annual business revenue?",
      type: "single",
      showIf: { key: "cf_svy_has_business", equals: "Yes" },
      options: [
        "Pre-revenue / just starting",
        "Under $100k",
        "$100k - $250k",
        "$250k - $500k",
        "$500k - $1M",
        "$1M+",
      ],
    },
    {
      key: "cf_svy_revenue_verifiable",
      title: "Can business revenue be verified (bank statements or tax returns)?",
      type: "single",
      showIf: { key: "cf_svy_has_business", equals: "Yes" },
      options: ["Yes", "No", "Not sure"],
    },
    {
      key: "cf_svy_available_capital",
      title: "How much capital do you have available right now?",
      type: "single",
      options: ["Under $5k", "$5k - $15k", "$15k - $50k", "$50k+", "Prefer not to say"],
    },
    {
      key: "cf_svy_has_negatives",
      title: "Any negatives on your credit report? (collections, charge-offs, late payments)",
      type: "single",
      options: ["Yes", "No"],
    },
    {
      key: "__contact__",
      title: "Begin your application",
      subtitle: "Tell us how to reach you. Soft inquiry. No obligation.",
      type: "contact",
    },
  ];

  function visibleSteps(answers) {
    return STEPS.filter(function (s) {
      if (!s.showIf) return true;
      return String(answers[s.showIf.key] || "") === s.showIf.equals;
    });
  }

  function init() {
    var root = document.getElementById("appform");
    if (!root) return;

    var answers = {};
    var idx = 0;
    var multiPick = {};

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
        '</span></div>' +
        '<div class="sv-q">' +
        step.title +
        "</div>" +
        (step.subtitle ? '<div class="sv-sub">' + step.subtitle + "</div>" : "");

      if (step.type === "contact") {
        html +=
          '<div class="field"><label for="sv-name">Full name</label>' +
          '<input type="text" id="sv-name" name="name" autocomplete="name" required></div>' +
          '<div class="field"><label for="sv-business">Business name</label>' +
          '<input type="text" id="sv-business" name="business" autocomplete="organization"></div>' +
          '<div class="field"><label for="sv-email">Email address</label>' +
          '<input type="email" id="sv-email" name="email" autocomplete="email" required></div>' +
          '<div class="field"><label for="sv-phone">Mobile phone</label>' +
          '<input type="tel" id="sv-phone" name="phone" autocomplete="tel" required></div>' +
          '<div class="consent"><input type="checkbox" id="sv-sms" name="sms_consent">' +
          '<label for="sv-sms">I expressly consent to receive transactional SMS messages from FUNDHUB LLC about my application and account status at the number provided, including messages sent using automated technology. Checking this box constitutes my electronic signature. Message and data rates may apply. Message frequency varies. Reply STOP to opt out, HELP for help. Consent is not a condition of any purchase or service. See our <a href="/privacy/">Privacy Policy</a> and <a href="/terms/#sms">SMS Terms</a>.</label></div>' +
          '<p class="sv-err" role="alert"></p>' +
          '<div class="sv-nav">' +
          (idx > 0 ? '<button type="button" class="btn btn-ghost" data-act="back">Back</button>' : "") +
          '<button type="button" class="btn" data-act="submit">Submit application</button></div>' +
          '<p class="disclaim">By submitting, you confirm the information provided is accurate and that you are the subscriber or authorized user of the phone number entered. Fundhub is not a direct lender and does not guarantee approval or specific terms.</p>';
      } else {
        var selected = answers[step.key];
        var picked = multiPick[step.key] || {};
        html += '<div class="sv-opts" role="listbox" aria-label="' + step.title.replace(/"/g, "") + '">';
        (step.options || []).forEach(function (opt) {
          var on =
            step.type === "multi"
              ? !!picked[opt]
              : selected === opt;
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
        html += '<p class="sv-err" role="alert"></p>';
        html += '<div class="sv-nav">';
        if (idx > 0) html += '<button type="button" class="btn btn-ghost" data-act="back">Back</button>';
        html += '<button type="button" class="btn" data-act="next">Next</button></div>';
      }

      root.innerHTML = html;
      bind(step);
    }

    function bind(step) {
      root.querySelectorAll(".sv-opt").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var val = btn.getAttribute("data-opt");
          if (step.type === "multi") {
            multiPick[step.key] = multiPick[step.key] || {};
            multiPick[step.key][val] = !multiPick[step.key][val];
            render();
          } else {
            answers[step.key] = val;
            render();
          }
        });
      });
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
            var picks = Object.keys(multiPick[step.key] || {}).filter(function (k) {
              return multiPick[step.key][k];
            });
            if (!picks.length) {
              setErr("Select at least one option.");
              return;
            }
            answers[step.key] = picks;
          } else if (!answers[step.key]) {
            setErr("Please select an option to continue.");
            return;
          }
          if (step.key === "cf_svy_has_business" && answers[step.key] === "No") {
            delete answers.cf_svy_business_revenue;
            delete answers.cf_svy_revenue_verifiable;
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
          answers: answers,
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
            setErr((res.body && res.body.error) || "Something went wrong. Please try again.");
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
