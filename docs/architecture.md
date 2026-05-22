# Architecture

## Overview

CVAI is a personal job-application management system. It serves a browser UI for tracking roles, application statuses, and AI-generated artifacts. It reads from and writes to `cvai-data`, a private structured data store the user keeps in a separate private repository. Typst templates stored in the data directory render the candidate CV from YAML source.

```
┌──────────────────────────────────────────────────────────────┐
│                          Browser                             │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP (server-rendered HTML)
┌───────────────────────────▼──────────────────────────────────┐
│                          cvai                                │
│                                                              │
│  ┌─────────────────────┐   ┌──────────────────────────────┐  │
│  │ FastAPI handlers    │   │       LLM provider           │  │
│  │  dashboard          │   │  OpenAIClient                │  │
│  │  cv                 │   │  (OpenAI-compatible chat    │  │
│  │  intake             │   │   completions endpoint)     │  │
│  │  jobs               │◄──│  (any OpenAI-compatible      │  │
│  │  roles              │   │   endpoint via BASE_URL)     │  │
│  │  downloads          │   └──────────────────────────────┘  │
│  └──────────┬──────────┘                                     │
│             │                         ┌──────────────────┐   │
│  ┌──────────▼──────────┐              │   Job manager    │   │
│  │    Repository       │◄─────────────│ worker threads   │   │
│  │  reads YAML indexes │              │ (intake, bundle, │   │
│  │  reads per-role     │              │  prompt update)  │   │
│  │  writes status +    │              └──────────────────┘   │
│  │  event entries      │                                     │
│  └──────────┬──────────┘                                     │
└─────────────┼────────────────────────────────────────────────┘
              │ filesystem  (CVAI_DATA env var)
┌─────────────▼────────────────────────────────────────────────┐
│                        cvai-data                             │
│             (private; mounted at CVAI_DATA)                  │
│                                                              │
│  roles.yaml          applications.yaml                      │
│  tasks.yaml          events.yaml                             │
│  roles/<role_id>/    cv/    context/    library/             │
└──────────────────────────────┬───────────────────────────────┘
                               │ typst subprocess when PDF is missing
                               ▼
                    CVAI_DATA/pdf/templates
```

---

## Components

### `cvai`

The public-safe web application. The only component users interact with directly. It reads `CVAI_DATA` and renders deterministic views without LLM assistance for all normal read operations.

**Hard boundaries:**

- LLMs are permitted only to interpret free-form user input or unstructured source material into structured data. They must never be used for dashboard ordering, task counts, status display, artifact discovery, or any deterministic read operation.
- The `cvai` package must not contain private data, candidate secrets, or any file specific to a particular user's job search.
- All state that must survive a process restart lives in `cvai-data`, not in memory.

**Stack:**

| Layer | Choice |
|---|---|
| HTTP server | FastAPI + Uvicorn |
| Templates | Jinja2 plus server-rendered page functions |
| Interactivity | HTML forms and redirect flows |
| Background tasks | In-process worker threads |
| LLM HTTP | `urllib` (stdlib; no SDK dependency) |
| Data serialisation | PyYAML |

### `cvai-data`

Private structured data store. Canonical source of truth for all runtime state. Should live in a separate private repository and is mounted into `cvai` at runtime via `CVAI_DATA`. Users who publish `cvai` keep their `cvai-data` entirely private; the two repositories are intentionally decoupled.

`cvai-data` is an instance directory, not a public template repository. `cvai` owns the schema, validator, and initializer. If `CVAI_DATA` points at a missing writable directory, startup creates the empty root layout before validating it.

### PDF templates

Typst templates and their fonts are data assets under `cvai-data/pdf/templates/<template>/`. `cvai_core.pdf` reads `cvai-data/cv/cv.yaml`, calls Typst with the selected template's `cv.typ`, and writes PDFs. CVAI invokes it for the generic CV download endpoint when the cached PDF is missing. The runtime needs the `typst` binary for builds; the Docker image installs it.

---

## Data Model

All role process state is stored as structured YAML. Fields are machine-readable; the web app reads them directly and never parses status, verdict, or rationale out of prose text.

### Global indexes (`cvai-data/*.yaml`)

| File | Purpose |
|---|---|
| `roles.yaml` | Ordered role index. |
| `applications.yaml` | Current role process state per role. |
| `tasks.yaml` | Open and closed tasks, optionally linked to a role. |
| `events.yaml` | Append-only event log, optionally linked to a role. |

**`roles.yaml` entry:**

| Field | Type | Notes |
|---|---|---|
| `id` | string | Readable slug — see slug convention below. |
| `company` | string | Display name. |
| `title` | string | Role title as posted. |
| `location` | string | Human-readable location string. |
| `source_url` | string | Original job posting URL. |
| `captured_on` | date | ISO 8601 ingestion date. |
| `priority_rank` | integer or null | Dashboard order; lower = higher priority. Null = unranked, shown below all ranked roles. |
| `active` | boolean | `false` = role is closed or withdrawn; excluded from the active dashboard view. |

**`applications.yaml` entry:**

| Field | Type | Notes |
|---|---|---|
| `role_id` | string | Matches a `roles.yaml` `id`. |
| `status` | enum | See status enum below. |
| `status_date` | date or null | ISO 8601 date of the current status. |
| `status_detail` | string | Human detail without status/date prefix. May be empty. |
| `status_artifacts` | list[string] | Relative paths to artifacts associated with the current status. |
| `verdict` | enum | See verdict enum below. |
| `verdict_label` | string | Display label for the verdict. |
| `rationale` | string | Rationale text only; no label prefix, no verdict-only placeholder. |

**`tasks.yaml` entry:**

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique task ID, e.g. `task_0042`. |
| `role_id` | string or null | Linked role, or null for cross-cutting tasks. |
| `status` | enum | `open`, `completed`, or `wont_do`. |
| `title` | string | Short task description. |

**`events.yaml` entry:**

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID with `event-` prefix. |
| `role_id` | string or null | Linked role, or null for general events. |
| `type` | enum | `captured`, `submitted`, `interviewing`, `accepted`, `rejected`, `closed`, `decision`, or `note`. |
| `date` | date or empty string | Event date when known. |
| `detail` | string | Event body. |
| `artifacts` | list[string] | Artifact paths mentioned by the event. |

### Per-role directory (`cvai-data/roles/<role_id>/`)

| Path | Purpose |
|---|---|
| `role.yaml` | Mirrors the entry from `roles.yaml`. |
| `application.yaml` | Mirrors the entry from `applications.yaml`. |
| `job.yaml` | Structured posting data: metadata, source URL, raw source text, responsibilities, requirements, and requirement coverage. |
| `job.md` | Captured job description text; human-readable source artifact. |
| `suitability_report.md` | LLM-generated suitability analysis; human-readable artifact. |
| `role_matrix.md` | Requirements-to-evidence matrix; human-readable artifact. |
| `analysis.yaml` | Structured normalisation of the report: summary, strengths, gaps, requirement coverage, work items, and private LLM context. Detail pages render requirement coverage from this structure rather than parsing raw Markdown. |
| `artifacts/` | Generated materials: `resume.md`, `cover_letter.md`, interview prep files. |
| `tasks.yaml` | Role-specific subset of the global `tasks.yaml`. |
| `events.yaml` | Role-specific subset of the global `events.yaml`. |

Requirement rows in `analysis.yaml` distinguish hard requirements, soft requirements, and inferred requirements. Job responsibilities that are not evidence-addressable requirements are stored as comments or context, not as requirement rows. `job.yaml` also carries `extracted.skills`, a profession-neutral list of role-relevant skills, tools, domains, methods, or technologies named by the posting. Gap tasks link by task ID to the global `tasks.yaml` rather than carrying duplicate gap descriptions.

### Candidate data

| Path | Purpose |
|---|---|
| `cv/cv.yaml` | YAML source of truth for the candidate CV. Schema at `cv/cv-schema.json`. |
| `cv/cv.pdf` | Rendered generic CV (portrait template). |
| `pdf/templates/<template>/cv.typ` | Typst entry point for a CV template. |
| `pdf/templates/<template>/fonts/` | Optional fonts owned by the template. |
| `context/context.yaml` | Structured constraints, preferences, safe metrics, and portfolio inventory. |
| `library/evidence.yaml` | Structured skill evidence pointers, story snippets, and reusable prose blocks. |
| `context/*.md`, `library/*.md` | Human-readable source artifacts for candidate context and prose blocks. |

### Status enum

| Value | Meaning |
|---|---|
| `draft` | Ingested but not yet submitted. |
| `submitted` | Application submitted. |
| `interviewing` | Active interview process in progress. |
| `accepted` | Offer accepted. |
| `rejected` | Rejected by the company. |
| `closed` | Role closed or withdrawn from. |
| `unknown` | Status not yet determined. |

Terminal statuses (`accepted`, `rejected`, `closed`) exclude a role from the active dashboard regardless of the `active` field in `roles.yaml`.

### Verdict enum

| Value | Suggested display label |
|---|---|
| `CLEAR_FIT` | Clear fit |
| `FIT` | Good fit |
| `POSSIBLE_FIT` | Possible fit |
| `WEAK_FIT` | Weak fit |
| `OVERQUALIFIED` | Overqualified fit |
| `UNFIT` | Not a fit |

### Role ID (slug) convention

Role IDs are readable slugs: `{company}_{location}_{role_title}`, all lowercase, spaces and punctuation replaced by underscores, ampersands replaced by `and`.

If a slug collides (same company, location, and normalised title), add a deterministic human-readable suffix such as the posting ID or `_2`. Do not use UUIDs.

Example: `amazon_dublin_software_development_engineer_network_capacity_services`

---

## LLM Integration

### Allowed uses

| Operation | When called | LLM role |
|---|---|---|
| Role extraction | URL and pasted-text ingestion | Converts unstructured job posting text into `company`, `role`, `location`. |
| Bundle generation | After successful role extraction | Produces structured `job.yaml` and `analysis.yaml` in one LLM pass, plus human-readable artifact files. |
| Status prompt interpretation | Update-prompt form submission, fast-path miss | Converts a free-form phrase into `event_type`, `exact_date`, `note`. |
| Role reassessment | User-triggered re-evaluation | Reassesses `analysis.yaml` from structured YAML, including comments and notes fields, without parsing Markdown artifacts. |
| Gap task reassessment | User-triggered re-evaluation | Reassesses whether a gap task is closed given newly added structured CV or project data. |

### Disallowed uses

The following operations must never invoke the LLM:

- Dashboard ordering or filtering
- Task count computation
- Current status or verdict display
- Artifact path discovery
- Role detail page rendering
- Task list or detail rendering

### Status prompt interpretation

Free-form role update prompts always go through the LLM. Even short prompts can imply changes beyond the displayed status, such as internal notes, task updates, event detail, or related role context.

### LLM client

`OpenAIClient` is the current LLM adapter. It targets OpenAI-compatible chat completions APIs and is configured with common environment variables:

| Variable | Notes |
|---|---|
| `LLM_API_KEY` | API key used for LLM-backed workflows. |
| `LLM_MODEL` | Model name sent to the chat completions endpoint. |
| `LLM_BASE_URL` | API base URL. |

All LLM HTTP uses `urllib` from the Python standard library. The app does not depend on a provider SDK.

---

## Request Lifecycle

### Read request (e.g. dashboard)

1. FastAPI route handler receives `GET /`.
2. `Repository.list_dashboard_roles()` reads `roles.yaml`, `applications.yaml`, and `tasks.yaml` from disk.
3. Roles are filtered to `active=true` and non-terminal status, then sorted by `priority_rank`.
4. Jinja2 renders the dashboard template and returns the response.

No LLM call. No background task.

### Intake (URL ingestion)

1. User submits `POST /ingestions/url` with a `source_url` field.
2. Route handler validates the URL (scheme and SSRF checks), creates a background worker thread, and immediately redirects to `GET /jobs/<job_id>`.
3. The job page polls an HTMX fragment until the task completes or fails.
4. Background task:
   - Fetches the URL; extracts visible text.
   - Calls `OpenAIClient.extract_role()` → `company`, `role`, `location`.
   - Calls `OpenAIClient.generate_bundle()` → all generated artifacts.
   - `Repository.write_bundle()` writes the per-role directory and updates `roles.yaml` and `applications.yaml`.
5. On completion the job page links to `GET /roles/<role_id>`.

### Status update (structured form)

1. User submits `POST /roles/<role_id>/status` with `event_type`, `exact_date`, `note`.
2. Route handler calls `Repository.record_status()`.
3. `record_status()` updates `applications.yaml`, `roles/<role_id>/application.yaml`, appends to `events.yaml`, and appends to `roles/<role_id>/events.yaml`.
4. Redirect to `GET /roles/<role_id>`.

No LLM call.

### Status update (prompt)

1. User submits `POST /roles/<role_id>/update-prompt` with a free-form `prompt`.
2. A background task calls `OpenAIClient.interpret_status_update()`; the user waits on the job page.
3. `Repository.record_status()` and any related structured write helpers are called with the LLM result.
4. Redirect to `GET /roles/<role_id>`.

---

## Security Model

- **Data separation.** `cvai` contains no private data. Secrets and candidate artifacts live in `cvai-data`, mounted at runtime and never committed to the public repository.
- **Authentication.** The initial release is intended for local, single-user deployment and does not implement application-layer authentication. Do not expose CVAI directly to the public internet without a trusted authentication layer in front of it.
- **SSRF protection.** The URL intake endpoint validates that the scheme is `https` and that the resolved IP address is not in an RFC 1918, loopback, or link-local range before fetching.
- **Template escaping.** Jinja2 auto-escaping is enabled on all templates. User-supplied strings are never interpolated raw into HTML.
- **Path traversal.** `Repository.resolve()` checks that every resolved path stays within the configured `CVAI_DATA` root, preventing reads or writes outside it.

---

## Configuration Reference

All configuration uses environment variables. A `.env` file at the root of `CVAI_DATA` is loaded on startup if present; variables already in the process environment take precedence.

| Variable | Required | Default | Description |
|---|---|---|---|
| `CVAI_DATA` | yes | — | Absolute path to the `cvai-data` directory. |
| `PORT` | no | `8080` | HTTP listen port. |
| `LLM_API_KEY` | when using LLM workflows | — | API key for the selected provider. |
| `LLM_MODEL` | no | `gpt-5` | Model name for the selected provider. |
| `LLM_BASE_URL` | no | `https://api.openai.com/v1` | Base URL for the selected provider. |
