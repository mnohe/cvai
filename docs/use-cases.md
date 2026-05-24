# Use cases

## Actors

**User**: the candidate using the tool to manage their own job search. There is only one user per deployment; the tool is not multi-tenant.

**LLM**: a configured language model provider (OpenAI, Anthropic, or any OpenAI-compatible endpoint). Only involved in use cases that process unstructured input.

---

## Browse the active dashboard

**Actor**: user

**Precondition**: `cvai` is running with `CVAI_DATA` pointing at the private data directory.

1. Open the dashboard (`GET /`).
2. The app reads `roles.yaml`, `applications.yaml`, and `tasks.yaml`.
3. Roles with `active=false` or a terminal status (`accepted`, `rejected`, `closed`) are excluded.
4. Remaining roles are ordered by `priority_rank` (ascending; null-ranked roles appear last), then alphabetically by company and title within each rank group.
5. Each row shows company, role title, location, application status pill, open task count, and action buttons.

**LLM**: not used.

---

## View role details

**Actor**: user

1. Click a role title or the Details button from the dashboard.
2. The app reads `roles/<role_id>/role.yaml`, `roles/<role_id>/application.yaml`, `roles/<role_id>/tasks.yaml`, and `roles/<role_id>/events.yaml`.
3. The detail page renders role metadata, current application status, verdict and rationale, artifact download links, open tasks, and the decision event log.

**LLM**: not used.

---

## Download a role artifact

**Actor**: user

1. On the role detail page, click any artifact link (resume, cover letter, interview prep file).
2. The app resolves the path within `CVAI_DATA`, validates it does not escape the data root, and serves the file.

**LLM**: not used.

---

## Edit and download the generic CV

**Actor**: user

1. Open the CV section (`GET /cv/`).
2. If `cv/cv.yaml` is missing, the app shows onboarding guidance.
3. If `cv/cv.yaml` is malformed, the app shows field-level errors and does not render the editor.
4. If the CV is valid, the app renders form controls for summary, contact, languages, certifications, education, experience, and projects.
5. Add, remove, or reorder repeatable entries with the editor controls.
6. Submit the form. The server validates the full CV structure before writing and removes the cached PDF so it can be rebuilt.
7. Click the PDF download link in the CV section.
8. If `CVAI_DATA/cv/cv.pdf` already exists, the app serves it directly.
9. If the PDF is missing, the app triggers the Typst renderer with the configured data layout and serves the result.
10. If Typst is not installed, the app returns a clear error rather than a 500.

**LLM**: not used.

---

## Ingest a role from a URL

**Actor**: user + LLM

**Precondition**: an LLM provider is configured (`LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL` are set).

1. Click Ingest Role and submit the URL intake form (`POST /ingestions/url`).
2. The app validates the URL scheme (`https` only) and checks the resolved IP is not in a private range.
3. A background operation starts; the current page shows an operation notice, linked to an operation detail page, until completion or failure.
4. Background task:
   - Fetches the URL and extracts visible text.
   - Calls the LLM to extract `company`, `role`, and `location`.
   - If metadata is not clearly recoverable, the operation fails with a message directing the user to paste-text intake.
   - Calls the LLM to generate the full artifact bundle.
   - Writes `roles/<role_id>/` and updates `roles.yaml` and `applications.yaml`.
5. On success, the operation page links to the new role's detail page.

**LLM**: role extraction, bundle generation.

---

## Ingest a role from pasted text

**Actor**: user + LLM

**Precondition**: an LLM provider is configured.

1. Click Ingest Role and submit the pasted-text intake form (`POST /ingestions/text`) with the job description text and an optional source URL, company, location, and role title.
2. Manual override fields (company, location, role) are passed to the LLM as hints and take precedence when provided.
3. A background operation starts; the current page shows an operation notice.
4. Background task proceeds the same as URL ingestion from step 4c onward.
5. On success, the operation page links to the new role's detail page.

**LLM**: role extraction (non-strict mode), bundle generation.

---

## Record a status update from the structured form

**Actor**: user

1. On the role detail page, open the Record Status Update form.
2. Choose an event type (`submitted`, `interviewing`, `accepted`, `rejected`, `closed`), an exact date, and an optional note.
3. Submit the form (`POST /roles/<role_id>/status`).
4. The app writes structured fields to `applications.yaml` and `roles/<role_id>/application.yaml` and appends a new event to `events.yaml` and `roles/<role_id>/events.yaml`.
5. Redirect to the role detail page; the updated status is immediately visible.

**LLM**: not used.

---

## Record a status update from a free-form prompt

**Actor**: user + LLM

1. On the dashboard, click Update on a role row to open the update dialog.
2. Enter a free-form prompt, for example: `"Rejected on 2026-05-16, recruiter said they went with someone with more Go experience."`
3. Submit the form (`POST /roles/<role_id>/update-prompt`).
4. A background operation starts, the current page shows an operation notice, and the LLM interprets the prompt.
5. The LLM returns structured status fields and any internal notes; the repository write path applies them.

**LLM**: status prompt interpretation.

---

## Initialize a new data directory

**Actor**: user (first-time setup)

1. Run `cvai init <path>` from the command line.
2. The command scaffolds an empty `CVAI_DATA`-compatible directory at `<path>`: empty `roles.yaml`, `applications.yaml`, `tasks.yaml`, `events.yaml`, a `cv/` subdirectory with a schema file, and a `context/` and `library/` subdirectory.
3. The user sets `CVAI_DATA=<path>` in their environment or `.env` file.
4. The user populates `cv/cv.yaml` with their CV data, then starts `cvai`.

**LLM**: not used.

---

## Build or rebuild a CV PDF

**Actor**: user

Two paths are available:

**Via the local renderer**:

1. Edit the CV through `/cv/`, or update `CVAI_DATA/cv/cv.yaml` directly if you are working outside the web UI.
2. Run the PDF renderer or click the CV page's PDF download link.
3. The data-owned Typst templates render the YAML and write `CVAI_DATA/cv/cv.pdf`.

**Via web UI (on demand)**:

1. Open `/cv/`.
2. If `CVAI_DATA/cv/cv.pdf` is absent, `cvai` triggers the Typst renderer and serves the result.
3. Subsequent downloads serve the cached PDF until `cv.yaml` changes and the file is deleted or rebuilt.

**LLM**: not used.

---

## Import a PDF template

**Actor**: user

1. Obtain a template pack directory. It must contain `template.yaml` and the Typst entry point declared by that manifest.
2. Run `cvai templates import /path/to/template-pack tests/fixture_data/demo-db`.
3. CVAI validates the manifest and copies the pack into `CVAI_DATA/pdf/templates/<template_id>`.
4. The imported template is available to PDF rendering commands.

**LLM**: not used.

---

## Configure the LLM provider

**Actor**: user

1. Set `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`.
2. To use a third-party OpenAI-compatible endpoint (e.g. Mistral or a local gateway), set `LLM_BASE_URL` to that endpoint's base URL and set `LLM_MODEL` to a model it supports.
3. Restart `cvai`. The client is loaded once at startup; no reload is needed for model or key changes if the variables are set before the process starts.

**LLM**: not used during configuration; the provider is exercised only when an intake or prompt update is submitted.

---

## Reassess a gap task

**Actor**: user + LLM

1. Open the task detail page (`GET /tasks/<task_id>`).
2. Click Reassess.
3. The app starts a background operation and sends the task, current CV YAML, and role requirements that reference the task to the LLM.
4. The LLM returns a structured result with `status`, `detail`, and optional `evidence_refs`.
5. The app writes the updated task state to `tasks.yaml`.
6. The task page shows the new status and evidence detail.

**LLM**: task reassessment only.

---

## Add a new LLM provider (contributor)

**Actor**: contributor

1. Add a new client in `cvai_core` with the same public workflow methods currently implemented by `OpenAIClient`: `extract_role`, `generate_bundle`, `interpret_status_update`, `assess_gap_task`, and `reassess_role_analysis`.
2. Keep `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL` as the common configuration names whenever possible.
3. Document any provider-specific environment variables in `.env.example` and `docs/architecture.md`.
4. Add a small factory only if the provider cannot be adapted through the OpenAI-compatible client.
5. Add tests covering response parsing and error handling.

**LLM**: the new implementation will call the target API; normal read-only pages remain provider-agnostic.
