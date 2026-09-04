# The document printer service

**Plain English: this is the machine that prints the good client documents.**

---

## Why this exists

You have two document printers. One is beautiful and one is not.

| | The good printer | The short printer |
|---|---|---|
| Credit Analysis Report | **12 pages** | 5 pages |
| Funding Snapshot | **9 pages** | 4 pages |
| Bank and Lender Match List | **9 pages** | 6 pages |
| Credit Optimization Roadmap | **14 pages** | 4 pages |

The good printer is a program written in Python. It has always worked. It works on
your Mac right now.

The website runs on Netlify, and Netlify's servers cannot run Python. So every time
a real client got their documents, the website quietly used the short printer
instead. It never said so. It never logged anything. Nobody noticed for six weeks.

This folder is the fix. It puts the good printer on its own small computer that the
website can phone up over the internet. The website says "print these documents for
this client", the good printer prints them, and sends them back.

**The short printer stays.** If the good printer is asleep or broken, the website
falls back to the short one so the client still gets something. That is on purpose:
a broken printer should make the documents worse, never stop a credit pull. When
that happens the website writes down that it happened — see "How to tell which
printer ran" at the bottom.

---

## What it does and does not keep

The website sends this service a client's real financial information: their name,
their address, their credit scores, their creditors and balances.

**Kept:** nothing.

* The information is written to a scratch folder while the documents print, and
  that folder is deleted the moment the response goes out. It is deleted whether
  the print worked, failed, or timed out.
* There is no database, no file storage, no queue, no backup, no cache.
* The activity log records only the time, whether it worked, and how many
  documents came out. It never records a name, an address, or a number from the
  file.
* Restart the machine and there is nothing of any client on it.

**Who can call it:** only something holding the shared password. Every request must
carry that password in a header. A request without it is refused. If the password
has not been set up at all, the service refuses *every* print request — there is no
setting where it prints for an anonymous caller.

---

## Deploy it — the numbered steps

**Recommended host: Render.com.** Reason: this service is a Docker container, and
Render builds a Docker container straight from a GitHub repository with no build
scripts, no command line, and no account beyond the one signup. Fly.io and Railway
both work too, but both expect you to install a command-line tool first. Render is
the only one of the three you can do entirely in a web browser.

Do **not** use Render's free tier. Free services go to sleep after 15 minutes and
take about a minute to wake up. A client's credit pull will time out waiting and
they will get the short documents.

### Step 1 — make the password

On your Mac, open Terminal and paste this:

```
openssl rand -hex 32
```

It prints a long line of letters and numbers. **Copy it. You need it twice, in step
5 and step 7.** Do not put it in a document, an email, or a chat message. If you
lose it, just make a new one and redo steps 5 and 7.

### Step 2 — sign in to Render

Go to https://render.com and sign in with the GitHub account that holds this
repository.

### Step 3 — make a new Web Service

Click **New** → **Web Service**. Pick the `fundhub-platform` repository.
Pick the branch `main`.

### Step 4 — tell it this is a Docker service

Set these four fields exactly:

| Field | Value |
|---|---|
| Language / Runtime | `Docker` |
| Dockerfile Path | `render-service/Dockerfile` |
| Docker Build Context Directory | `.` |
| Region | `Oregon (US West)` |

The build context has to be `.` — a single dot, meaning the whole repository. The
printer program lives in `scripts/black-reports/`, outside this folder, and the
build cannot reach it otherwise.

Oregon is chosen because the database is already in US West. Any region works; a
closer one is a little faster.

### Step 5 — set the password on the service

Still on the create screen, find **Environment Variables** and add one:

| Key | Value |
|---|---|
| `FUNDHUB_RENDER_KEY` | the long line you copied in step 1 |

Do not add anything else. Everything else has a working default.

### Step 6 — pick the plan and create it

Choose **Starter — $7 a month**. Click **Create Web Service**. The first build takes
about five minutes because it installs the printing libraries.

When it finishes, Render shows you a web address like
`https://fundhub-render.onrender.com`. **Copy it.**

### Step 7 — tell the website where the printer is

This is the part an agent does for you, or you paste into Terminal. Two settings,
then **one** deploy — never one deploy per setting:

```
netlify env:set BLACK_REPORT_RENDER_URL "https://YOUR-ADDRESS-FROM-STEP-6" --context production --context deploy-preview --context branch-deploy
netlify env:set FUNDHUB_RENDER_KEY "YOUR-PASSWORD-FROM-STEP-1" --context production --context deploy-preview --context branch-deploy --secret
netlify deploy --build --prod
```

### Step 8 — check it worked

Open your service address with `/health` on the end in a browser:

```
https://YOUR-ADDRESS-FROM-STEP-6/health
```

You want to see `"ok": true`. Here is what each line means:

| Line | What it means | If it is wrong |
|---|---|---|
| `"ok": true` | everything below is fine | read the rest of the table |
| `"weasyprint": "69.0"` | the printing engine is installed | rebuild the service |
| `"generator": "present"` | the printer program is on board | the build context in step 4 is not `.` |
| `"key_configured": true` | the password is set | redo step 5 |
| `"fonts_inter": true` | the designed typeface is installed | see "The fonts" below |

Then have someone run a real credit pull and count the pages of the Credit Analysis
Report. **You want 12.** If you get 5, the website did not reach the printer — go to
"When it breaks".

---

## What it costs

| | |
|---|---|
| Render Starter plan | **$7 a month** |
| Traffic | included; these documents are well under a megabyte each |
| Total | **$7 a month** |

If prints start failing and the Render log says "out of memory", move to the
**Standard** plan, $25 a month. That is the only reason to spend more.

---

## When it breaks

**Symptom: clients are getting short documents again (5 pages, not 12).**

Do these in order and stop when it works.

1. **Look at `/health`.** Address from step 6, with `/health` on the end. If it does
   not load at all, the service is down — go to the Render dashboard and click
   **Manual Deploy → Deploy latest commit**.
2. **Check the password matches.** The value in Render (step 5) and the value on
   Netlify (step 7) have to be the same line of text. If you are not sure, make a
   new one with step 1 and set it in both places, then run
   `netlify deploy --build --prod` once.
3. **Check the address is right.** `BLACK_REPORT_RENDER_URL` on Netlify has to be
   the address Render gave you, with `https://` at the front and **no** `/render`
   on the end. The website adds that part itself.
4. **Read the website's log.** In Netlify, open the function logs and search for
   `black-report`. Every print writes one line. It names the printer that ran and
   why. `DEGRADED` in that line means it fell back to the short printer, and the
   `reason=` part says what went wrong.

**Symptom: prints are slow or time out.** The website waits 45 seconds and then
gives up and uses the short printer. On the Starter plan a print takes a few
seconds. If it is taking 45, the service is short of memory — move to the Standard
plan.

**Symptom: the documents look wrong — different typeface, wrong page breaks.** Check
`"fonts_inter"` on `/health`. See below.

---

## The fonts

The documents are designed in two typefaces, Inter and JetBrains Mono. The build
installs them, but if the version of Linux in the image ever stops offering them,
the build carries on with substitute typefaces rather than failing.

A different typeface changes where lines wrap, which changes the page count. So
`/health` reports `"fonts_inter"` and `"fonts_jetbrains_mono"`. If either says
`false`, the documents will still print but they will not match the design, and the
page counts in the table at the top will not be 12 / 9 / 9 / 14.

That is deliberately visible rather than silent. Silent substitution is the exact
problem this whole service exists to fix.

---

## How to tell which printer ran

Three places, from easiest to most permanent.

1. **The website's log.** Netlify function logs, search `black-report`. One line per
   print:

   ```
   [black-report] engine=weasyprint-remote reason=render_service files=4
   [black-report] engine=pdf-lib reason=render_service_failed:http_0 files=4 DEGRADED — short documents, not the designed set
   ```

2. **The pack result.** Every letter pack the system builds now carries
   `deliverableEngine` and `deliverableEngineReason`.

3. **The document row — this is the permanent one.** Every one of the four analysis
   documents is saved with the printer's name on it. In the `documents` table the
   `metadata` column holds `"engine"`, and it is one of:

   | Value | Meaning |
   |---|---|
   | `weasyprint-remote` | this service printed it — the good documents |
   | `weasyprint` | a developer's own Mac printed it — also the good documents |
   | `pdf-lib` | the short printer — **this client's documents are degraded** |

   So "did this client get the real documents?" is a question you answer by looking
   at the row, not by reading code. That was the whole point.

---

## For a developer

Run it locally with nothing but a Python that has WeasyPrint:

```
FUNDHUB_RENDER_KEY=dev-key python render-service/wsgi.py --port 8099
curl -s localhost:8099/health
```

Point the site at it:

```
BLACK_REPORT_RENDER_URL=http://127.0.0.1:8099 FUNDHUB_RENDER_KEY=dev-key BLACK_REPORT_ENGINE=remote npm test
```

Build the image (context is the repository root, not this folder):

```
docker build -f render-service/Dockerfile -t fundhub-render .
docker run -p 8080:8080 -e FUNDHUB_RENDER_KEY=dev-key fundhub-render
```

### Settings

| Name | Where | Default | What it does |
|---|---|---|---|
| `FUNDHUB_RENDER_KEY` | both | none | shared secret. No default on purpose. |
| `BLACK_REPORT_RENDER_URL` | site | none | the service's base address, no `/render` |
| `BLACK_REPORT_ENGINE` | site | `auto` | `auto`, `node`, `python`, `remote` |
| `BLACK_REPORT_RENDER_TIMEOUT_MS` | site | `45000` | how long the site waits |
| `RENDER_TIMEOUT_SECONDS` | service | `120` | how long the print may take |
| `RENDER_MAX_BODY_BYTES` | service | `1048576` | largest accepted request |
| `PORT` | service | `8080` | set by Render automatically |

### The interface

```
GET  /health   -> 200 {"ok":true,"weasyprint":"69.0","generator":"present",...}
                  503 when the engine, the program or the password is missing

POST /render   -> header  X-Fundhub-Render-Key: <FUNDHUB_RENDER_KEY>
                  body    {"client": { ...the same JSON the printer already takes... }}
                  200     {"ok":true,"engine":"weasyprint","files":[
                            {"filename":"credit_analysis_report.pdf",
                             "contentType":"application/pdf",
                             "bytes":130928,
                             "pdf_base64":"..."} ]}
                  401     no password, or the wrong one
                  413     body over the size limit
                  500     the printer program failed
                  503     no password configured on the service
                  504     the print took longer than RENDER_TIMEOUT_SECONDS
```

The service runs `scripts/black-reports/fundhub_gen.py` as a subprocess with exactly
the arguments `src/underwrite/black-report-pdf.mjs` already uses locally. It does not
import it, wrap it, or change it. If the generator changes, nothing here needs to.
