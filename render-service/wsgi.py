#!/usr/bin/env python3
"""
fundhub render service — a thin HTTP wrapper around the printer that already exists.

WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
---------------------------------------------
`scripts/black-reports/fundhub_gen.py` is Chris's designed document printer. It uses
WeasyPrint and it produces the full-length client deliverables. It already works.
Netlify's Node runtime has no Python, so on the live site it never runs and a much
smaller Node printer silently takes its place.

This service exists only so the live site can reach that printer over HTTP.

It does NOT reimplement the generator, import it, or change a single line of its
output. It writes the client JSON to a temp file and runs the generator exactly the
way `src/underwrite/black-report-pdf.mjs` runs it on a developer laptop:

    python fundhub_gen.py --client <tmp>/client.json --out <tmp>

Then it reads the PDFs back and returns them base64-encoded. Same input, same
subprocess, same bytes out. If the generator changes, this file needs no edit.

PRIVACY — READ BEFORE CHANGING ANY LOGGING
------------------------------------------
The request body is consumer financial information: names, addresses, credit scores,
creditor names and balances. So:

  * The body is never logged, never echoed in an error, and never written anywhere
    except the per-request temp directory.
  * That temp directory is removed in a `finally` block, so it goes away on success,
    on failure, and on timeout.
  * Nothing is retained after the response is written. There is no database, no
    cache, no object store, no queue.
  * Access log lines carry method, path, status, duration and byte counts only.

If you add logging here, log a count or a status, never a value.

AUTHENTICATION
--------------
Every /render request must carry `X-Fundhub-Render-Key` matching FUNDHUB_RENDER_KEY.
If FUNDHUB_RENDER_KEY is unset the service refuses every render with 503. There is no
mode in which an unauthenticated render is accepted — a missing key is a broken
deployment, not permission.

RUN IT
------
  Production (in the Docker image):  gunicorn --chdir /app wsgi:application ...
  Locally, no extra packages:        python render-service/wsgi.py --port 8099
"""

import base64
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration. Every value has a safe default except the shared secret, which
# has no default on purpose.
# ---------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent

# Where the generator lives inside the image. The Dockerfile copies the repo's
# scripts/black-reports/ to /app/black-reports/. Running from a checkout, the
# fallback below finds it two directories up.
GENERATOR_CANDIDATES = [
    os.environ.get("FUNDHUB_GENERATOR"),
    str(HERE / "black-reports" / "fundhub_gen.py"),
    str(HERE.parent / "scripts" / "black-reports" / "fundhub_gen.py"),
]

AUTH_HEADER = "X-Fundhub-Render-Key"
# WSGI mangles header names: X-Fundhub-Render-Key -> HTTP_X_FUNDHUB_RENDER_KEY
AUTH_ENVIRON_KEY = "HTTP_" + AUTH_HEADER.upper().replace("-", "_")

# A client JSON payload is a few tens of kilobytes. A megabyte is generous and
# still small enough that a hostile caller cannot exhaust memory.
MAX_BODY_BYTES = int(os.environ.get("RENDER_MAX_BODY_BYTES", str(1024 * 1024)))

# The generator takes single-digit seconds for a normal client. Two minutes is a
# ceiling for a pathological one, not an expectation.
RENDER_TIMEOUT_SECONDS = int(os.environ.get("RENDER_TIMEOUT_SECONDS", "120"))

SERVICE_NAME = "fundhub-render"


def generator_path():
    """First candidate that exists on disk, or None."""
    for candidate in GENERATOR_CANDIDATES:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def weasyprint_version():
    try:
        import weasyprint  # noqa: PLC0415 - probed, not used at module scope
        return getattr(weasyprint, "__version__", "unknown")
    except Exception:
        return None


_FONT_CACHE = {}


def design_fonts_present():
    """Is the face the design asks for actually installed?

    The stylesheet says `font-family: "Inter", "Arial", sans-serif`. If Inter is
    missing the documents still render, but in a substitute face — and a
    different face changes line breaks, which changes page counts. That is
    exactly the kind of silent substitution this whole piece of work exists to
    stop, so /health reports it instead of leaving it to be discovered in a PDF.
    """
    if "inter" not in _FONT_CACHE:
        try:
            listed = subprocess.run(
                ["fc-list", ":", "family"], capture_output=True, text=True, timeout=10
            ).stdout.lower()
            _FONT_CACHE["inter"] = "inter" in listed
            _FONT_CACHE["jetbrains"] = "jetbrains" in listed
        except Exception:
            _FONT_CACHE["inter"] = None
            _FONT_CACHE["jetbrains"] = None
    return _FONT_CACHE.get("inter"), _FONT_CACHE.get("jetbrains")


# ---------------------------------------------------------------------------
# Responses. Small helpers so every exit path has the same shape.
# ---------------------------------------------------------------------------

def _json_response(start_response, status, payload, extra_headers=None):
    body = json.dumps(payload).encode("utf-8")
    headers = [
        ("Content-Type", "application/json"),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
    ]
    if extra_headers:
        headers.extend(extra_headers)
    start_response(status, headers)
    return [body]


def _authorized(environ):
    """Constant-time comparison of the shared secret.

    Returns (ok, http_status_or_None). A missing server-side key is 503, not 401:
    the caller did nothing wrong and retrying with a different key will not help.
    """
    expected = os.environ.get("FUNDHUB_RENDER_KEY") or ""
    if not expected:
        return False, "503 Service Unavailable"
    presented = environ.get(AUTH_ENVIRON_KEY) or ""
    if not presented:
        return False, "401 Unauthorized"
    if not hmac.compare_digest(presented, expected):
        return False, "401 Unauthorized"
    return True, None


# ---------------------------------------------------------------------------
# The render itself.
# ---------------------------------------------------------------------------

def render_client(client, script):
    """Run the generator on one client payload and return the PDFs it wrote.

    Everything happens inside a temp directory that is deleted before this
    function returns, on every path including the exception path.
    """
    workdir = tempfile.mkdtemp(prefix="fh-render-")
    try:
        client_json = os.path.join(workdir, "client.json")
        with open(client_json, "w", encoding="utf-8") as handle:
            json.dump(client, handle)

        proc = subprocess.run(
            [sys.executable, script, "--client", client_json, "--out", workdir],
            capture_output=True,
            text=True,
            timeout=RENDER_TIMEOUT_SECONDS,
            cwd=workdir,
        )
        if proc.returncode != 0:
            # stderr can quote the client JSON path but never its contents; the
            # generator prints tracebacks, not payloads. Bounded anyway.
            return None, (proc.stderr or "generator exited non-zero")[-2000:]

        files = []
        for entry in sorted(os.listdir(workdir)):
            if not entry.endswith(".pdf"):
                continue
            raw = Path(workdir, entry).read_bytes()
            if raw[:4] != b"%PDF":
                continue
            files.append({
                "filename": entry,
                "contentType": "application/pdf",
                "bytes": len(raw),
                "pdf_base64": base64.b64encode(raw).decode("ascii"),
            })
        if not files:
            return None, "generator produced no PDF files"
        return files, None
    finally:
        # The only copy of this client's data on this machine dies here.
        shutil.rmtree(workdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# WSGI entry point.
# ---------------------------------------------------------------------------

def application(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    path = environ.get("PATH_INFO", "/") or "/"
    started = time.time()

    if path in ("/health", "/healthz", "/") and method == "GET":
        version = weasyprint_version()
        script = generator_path()
        inter, jetbrains = design_fonts_present()
        ready = bool(version) and bool(script) and bool(os.environ.get("FUNDHUB_RENDER_KEY"))
        return _json_response(start_response, "200 OK" if ready else "503 Service Unavailable", {
            "ok": ready,
            "service": SERVICE_NAME,
            "weasyprint": version,
            "generator": "present" if script else "missing",
            "key_configured": bool(os.environ.get("FUNDHUB_RENDER_KEY")),
            "fonts_inter": inter,
            "fonts_jetbrains_mono": jetbrains,
        })

    if path != "/render":
        return _json_response(start_response, "404 Not Found", {"ok": False, "error": "not_found"})

    if method != "POST":
        return _json_response(start_response, "405 Method Not Allowed", {"ok": False, "error": "method_not_allowed"})

    ok, refusal = _authorized(environ)
    if not ok:
        reason = "service_key_not_configured" if refusal.startswith("503") else "unauthorized"
        _log(method, path, refusal, started, 0)
        return _json_response(start_response, refusal, {"ok": False, "error": reason})

    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length <= 0:
        return _json_response(start_response, "400 Bad Request", {"ok": False, "error": "empty_body"})
    if length > MAX_BODY_BYTES:
        return _json_response(start_response, "413 Payload Too Large", {"ok": False, "error": "body_too_large"})

    raw = environ["wsgi.input"].read(length)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        # Deliberately does not echo the body back.
        return _json_response(start_response, "400 Bad Request", {"ok": False, "error": "invalid_json"})
    finally:
        del raw

    client = payload.get("client") if isinstance(payload, dict) else None
    if not isinstance(client, dict) or not client:
        return _json_response(start_response, "400 Bad Request", {"ok": False, "error": "no_client"})

    script = generator_path()
    if not script:
        return _json_response(start_response, "503 Service Unavailable", {"ok": False, "error": "generator_missing"})

    try:
        files, error = render_client(client, script)
    except subprocess.TimeoutExpired:
        _log(method, path, "504", started, 0)
        return _json_response(start_response, "504 Gateway Timeout", {"ok": False, "error": "render_timeout"})
    except Exception:
        # The traceback goes to the server log; it names this file and the
        # generator, never the payload.
        traceback.print_exc()
        _log(method, path, "500", started, 0)
        return _json_response(start_response, "500 Internal Server Error", {"ok": False, "error": "render_failed"})

    if error:
        _log(method, path, "500", started, 0)
        return _json_response(start_response, "500 Internal Server Error", {"ok": False, "error": error})

    total = sum(f["bytes"] for f in files)
    _log(method, path, "200", started, total, count=len(files))
    return _json_response(start_response, "200 OK", {
        "ok": True,
        "service": SERVICE_NAME,
        "engine": "weasyprint",
        "files": files,
    })


def _log(method, path, status, started, out_bytes, count=None):
    """Access log. Counts and statuses only — never a field from the payload."""
    ms = int((time.time() - started) * 1000)
    extra = f" files={count}" if count is not None else ""
    print(f"[{SERVICE_NAME}] {method} {path} {status} {ms}ms out={out_bytes}b{extra}", flush=True)


# ---------------------------------------------------------------------------
# Local development server. Standard library only, so this file runs under the
# same interpreter that has WeasyPrint installed with nothing extra to install.
# Production uses gunicorn (see the Dockerfile) — this branch is not used there.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    from wsgiref.simple_server import make_server, WSGIRequestHandler

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, *_args):
            # Our own _log line is the access log. The default one prints the
            # request line, which is fine, but two logs per request is noise.
            pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8099")))
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    args = parser.parse_args()

    print(f"[{SERVICE_NAME}] listening on http://{args.host}:{args.port}", flush=True)
    print(f"[{SERVICE_NAME}] generator: {generator_path() or 'MISSING'}", flush=True)
    print(f"[{SERVICE_NAME}] weasyprint: {weasyprint_version() or 'MISSING'}", flush=True)
    make_server(args.host, args.port, application, handler_class=QuietHandler).serve_forever()
