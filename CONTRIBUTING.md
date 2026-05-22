# Contributing

## Python version

The only tested and supported Python version is the one bundled in the `alpine:3.23` base image specified in the Dockerfile (Python 3.12).
Running the application outside the container is not a supported workflow; the container makes the version question moot for users.

If you are modifying or testing the application outside the container, use Python 3.12.
Other versions may work but are not tested.

## Boundaries

- This repository contains public-safe web code, templates, schema validation,
  documentation, and tests.
- Private data and secrets live in the directory configured through `CVAI_DATA`.
- PDF rendering code lives in `cvai_core.pdf`; templates and fonts live in
  `CVAI_DATA/pdf/templates/<template>/`.

## Data Rules

- Keep role state structured under `CVAI_DATA/roles/<role_id>/`.
- Keep global indexes in `CVAI_DATA/roles.yaml`, `applications.yaml`, `tasks.yaml`, and `events.yaml`.
- Role IDs are readable slugs. Use deterministic suffixes for collisions.
- Event IDs use `event-<uuid>` and event bodies use `detail`; do not add a
  second narrative field.
- Do not require an LLM for state reads.
- Use ISO8601 dates or datetimes for stored date/time values.

## Web App Rules

- The app receives its data location through `CVAI_DATA`.
- Do not commit private data, `.env`, or generated candidate artifacts.
- Authentication is planned but not implemented.
- The Makefile defaults `CVAI_DATA` to `tests/fixture_data/demo-db` so
  contributors can run `make dev` against realistic public demo data. Override
  `CVAI_DATA` when testing against a private datastore.

## Checks

Run web tests after web or data-model changes:

```bash
python3 -m unittest discover -s tests -v
```

Run the schema validator against a local data directory after changing schemas,
repository code, ingestion, or reassessment logic:

```bash
PYTHONPATH=. python3 -m cvai_core.schema tests/fixture_data/demo-db
```

Run a PDF smoke build after renderer or template-related changes:

```bash
PYTHONPATH=. python3 -m cvai_core.pdf tests/fixture_data/demo-db/cv/cv.yaml /tmp/cvai-smoke.pdf --templates-root tests/fixture_data/demo-db/pdf/templates
```

## LLM Providers

CVAI currently talks to OpenAI-compatible chat-completions APIs through
`cvai_core.llm.OpenAIClient`. The shared runtime variables are:

- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_BASE_URL`

Prefer supporting new OpenAI-compatible providers by documenting the correct
`LLM_BASE_URL` and model name rather than adding a new provider class. Add
provider-prefixed environment variables only when a provider needs values that
do not fit this common shape.

If a provider needs a custom client, keep the web routes unchanged. Add the
provider-specific adapter in `cvai_core.llm`, make it expose the same workflow
methods used by `cvai_web.server.WebApp`, and cover it with tests that avoid
real network calls.
