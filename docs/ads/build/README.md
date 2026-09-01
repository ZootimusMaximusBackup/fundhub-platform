# Build files for the concept sheet

`concepts.html` is the source for the published concept sheet artifact:
**https://claude.ai/code/artifact/025023f1-ca18-44f2-976b-2a2078cb953a**

Kept here so the page survives the session. To change the sheet, edit
`concepts.data.json` or the HTML and republish to that same URL — publishing
without the URL creates a separate artifact instead of updating this one.

- `concepts.html` — the published page, data embedded
- `concepts.data.json` — the 48 concepts as structured data
- `build-sheet.py` — regenerates the markdown version at `../CONCEPTS.md`

Picks are stored in the viewer's own browser (`localStorage`), so they stay on
Chris's machine and never reach the repo.
