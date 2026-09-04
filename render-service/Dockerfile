# fundhub render service.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not this directory. The image has to
# carry scripts/black-reports/fundhub_gen.py, which lives outside this folder,
# and Docker cannot copy from above the context. So:
#
#   docker build -f render-service/Dockerfile -t fundhub-render .
#
# On Render.com that is: Dockerfile Path = render-service/Dockerfile,
# Docker Build Context Directory = . (see README.md step 4).

FROM python:3.13-slim-bookworm

# WeasyPrint renders through Pango/Cairo. These are the system libraries it
# loads at import time; without them `from weasyprint import HTML` fails.
# fonts-dejavu-core and fonts-liberation2 are the guaranteed fallbacks.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libharfbuzz0b \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi8 \
      shared-mime-info \
      fontconfig \
      fonts-dejavu-core \
      fonts-liberation2 \
      curl \
    && rm -rf /var/lib/apt/lists/*

# The design specifies Inter and JetBrains Mono. Debian packages them, but the
# names move between releases, so this layer is allowed to fail: the documents
# still render with the fallback faces, and GET /health reports `fonts_inter`
# false so the substitution is visible rather than silent.
RUN apt-get update \
    && (apt-get install -y --no-install-recommends fonts-inter fonts-jetbrains-mono \
        || echo "WARNING: design fonts unavailable in this Debian release; falling back") \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY render-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# The generator, copied verbatim from the repository. Not vendored, not edited.
COPY scripts/black-reports/ /app/black-reports/
COPY render-service/wsgi.py /app/wsgi.py

# Never run as root, and never give the process a writable home it might cache
# client data into. Temp directories are created and destroyed per request.
RUN useradd --create-home --uid 10001 render \
    && chown -R render:render /app
USER render

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FUNDHUB_GENERATOR=/app/black-reports/fundhub_gen.py \
    PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# One worker per CPU is overkill for this load and each one holds a full
# WeasyPrint. Two workers, threaded, with a timeout above RENDER_TIMEOUT_SECONDS
# so gunicorn never kills a render the service is still supervising.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT} --workers 2 --threads 4 --timeout 180 --access-logfile - --error-logfile - wsgi:application"]
