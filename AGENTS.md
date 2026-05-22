# Repository Instructions

This repository contains the CVAI core and web application:

- `cvai_web/`: FastAPI routes, Jinja templates, and web composition.
- `cvai_core/`: reusable schema, repository, LLM, and structure code.
- `cvai_core/pdf.py`: Typst invocation code for CV PDF rendering.
- `docs/`: architecture, schema, and use-case documentation.

Operational state belongs in the private directory configured by `CVAI_DATA`.
PDF templates and fonts also belong in `CVAI_DATA/pdf/templates/<template>/`, not in
the Python package.

CVAI must read normal role process state deterministically from `CVAI_DATA`; do not add LLM calls for dashboard/detail/status/task reads.

LLMs may be used only to interpret free-form user input, or unstructured source material into structured data.

Use readable slug role IDs. If a slug collides, add a deterministic human-readable suffix rather than introducing UUIDs.

Use `event-<uuid>` IDs for event records.
