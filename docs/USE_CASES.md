# Use cases

## Actors

**User**: a job seeker who signs in via Google or GitHub through Firebase Auth. Each account belongs to one person — there is no organisation or team sharing model.

**LLM**: OpenAI API (current flagship non-reasoning model; configured via `OPENAI_MODEL`). Only involved in use cases that process unstructured input or require reasoning. Every LLM-backed operation except Quick Analysis costs one credit and runs asynchronously. Quick Analysis is free and rate-limited per UID.

**Stripe**: the billing provider. Involved only in the credit purchase flow.

---

## Authentication

### Sign up

**Actor**: user (new)

1. Open the application.
2. Click Sign in with Google or Sign in with GitHub.
3. Firebase Auth completes the OAuth flow and returns an ID token.
4. The SPA writes the token to memory; it is attached to every subsequent backend request as `Authorization: Bearer <idToken>`.
5. The backend creates `users/{uid}/account` (zero credits) and `users/{uid}/candidate` (empty) on first write.

**LLM**: not used.

---

### Sign in

**Actor**: user (returning)

1. Open the application.
2. Click the sign-in button.
3. Firebase Auth completes the OAuth flow; the ID token (1h TTL) is refreshed automatically by the Firebase JS SDK.

**LLM**: not used.

---

### Sign out

**Actor**: user

1. Click Sign out from the account menu.
2. The SPA calls `firebase.auth().signOut()`, clears the token, and redirects to the landing page.

**LLM**: not used.

---

## Dashboard

### Browse the active dashboard

**Actor**: user

**Precondition**: user is signed in.

1. Open the dashboard (`/`).
2. The SPA subscribes to `users/{uid}/roles` via `onSnapshot`.
3. Roles with terminal status (`accepted`, `rejected`, `closed`) are excluded unless the filter toggle is set to show all.
4. Remaining roles are ordered by `priorityRank` (ascending; unranked roles appear last), then alphabetically by company and title within each rank group.
5. Each row shows company, role title, location, application status, open task count, and action buttons.
6. The subscription stays open; status changes update the row in real time without a page reload.

**LLM**: not used.

---

## Candidate profile

### Import a CV from pasted text or a URL

**Actor**: user + LLM

**Precondition**: user has at least one credit.

1. Open the CV section and click Import CV.
2. Choose the source: paste the CV text, or provide a URL pointing to a publicly accessible CV document.
3. Submit the form (`POST /import-cv`).
4. The backend deducts one credit, writes an `Action {status: pending}` document, and returns `202 {actionId}` immediately.
5. The SPA subscribes to the Action document via `onSnapshot` and shows a progress indicator.
6. Background goroutine:
   - If a URL was provided: fetches the URL through the SSRF-safe fetcher; extracts visible text.
   - Calls the LLM to extract structured CV data: personal details, summary, experience, education, skills, certifications, languages, and projects.
   - Validates the structured output against the domain schema.
   - Writes the result to `users/{uid}/candidate`.
   - Updates the Action to `{status: complete}`.
7. On failure the goroutine refunds the credit (best effort) and sets `{status: failed, reason}`.
8. The SPA receives the final Action status via `onSnapshot` and shows a success or error toast.

**LLM**: CV extraction (function calling).

---

### Edit the CV

**Actor**: user

1. Open the CV section (`/cv`).
2. Edit any section: personal details, summary, experience, education, skills, certifications, languages, projects.
3. Submit the form (`PUT /candidate/cv`).
4. The backend validates the full CV structure before writing.
5. The updated CV is visible immediately.

**LLM**: not used.

---

### Export the CV as a PDF

**Actor**: user

1. Open the CV section and click Export PDF.
2. The browser opens a print-optimised view of the CV styled with A4 CSS print rules.
3. The browser's print dialog is invoked. The user saves as PDF.

**LLM**: not used.

---

### Manage the evidence library

**Actor**: user

1. Open the Evidence section (`/evidence`).
2. Add, edit, or remove evidence items (achievement, project, certification, testimonial, publication).
3. Each item has a title, description, date range, and optional tags.
4. Items are available as candidate context when the LLM generates bundles.

**LLM**: not used.

---

### Manage the story bank

**Actor**: user

1. Open the Story Bank section (`/stories`).
2. Add, edit, or remove STAR-format stories.
3. Each story has a situation, task, action, result, and one or more competency tags.
4. Stories are available as candidate context when the LLM generates bundles.

**LLM**: not used.

---

## Roles

### Run a quick analysis

**Actor**: user + LLM

**Precondition**: user is signed in. No credit required. Rate-limited per UID.

1. Click Add Role and submit a URL or paste job description text.
2. The backend validates the URL if provided (SSRF protection) and calls the LLM with the current CV and evidence library as context.
3. Returns immediately with a structured suitability preview: likely fit level, key matching abilities, important gaps, effort estimates to close those gaps, and a continue/abandon recommendation.
4. No Role document is written; the result is ephemeral.
5. The user chooses to continue to full ingestion (one credit) or abandon.
6. If the user continues, the source text captured during QA is reused — the URL is not fetched a second time.

If the URL cannot be fetched or yields no usable text, the call returns an error directing the user to paste the text manually. No rate limit token is consumed on a fetch failure.

**LLM**: suitability assessment.

---

### Ingest a role from a URL

**Actor**: user + LLM

**Precondition**: user has at least one credit.

1. Click Add Role and submit the URL intake form (`POST /roles` with `sourceKind: url`).
2. The backend validates the URL scheme (`https` only) and checks the resolved IP is not in a private range.
3. The backend deducts one credit, writes an `Action {status: pending}` document, and returns `202 {actionId}`.
4. The SPA subscribes to the Action and shows a progress notice.
5. Background goroutine:
   - Fetches the URL and extracts visible text.
   - Calls the LLM to extract `company`, `role`, `location`, and the full structured job description.
   - If metadata is not clearly recoverable, the action fails with a message directing the user to the paste-text flow.
   - Calls the LLM to generate the full artefact bundle: tailored CV variant, cover letter draft, application analysis (strengths, gaps, requirement coverage), and suggested gap tasks.
   - Writes `users/{uid}/roles/{roleId}` and the bundle sub-document.
   - Updates the Action to `{status: complete, roleId}`.
6. The SPA navigates the user to the new role detail page.

**LLM**: role extraction, bundle generation.

---

### Ingest a role from pasted text

**Actor**: user + LLM

**Precondition**: user has at least one credit.

1. Click Add Role and submit the pasted-text intake form (`POST /roles` with `sourceKind: text`).
2. The form accepts: job description text (required), optional source URL, and optional manual overrides for company, location, and role title.
3. Manual override fields are passed to the LLM as hints and take precedence when provided.
4. The backend deducts one credit and starts the same background goroutine as URL ingestion, skipping the URL fetch step.

**LLM**: role extraction (non-strict mode), bundle generation.

---

### View role details

**Actor**: user

1. Click a role from the dashboard.
2. The role detail page subscribes to `users/{uid}/roles/{roleId}` and the bundle sub-document via `onSnapshot`.
3. The page renders: role metadata, current application status, verdict and rationale, strengths, gaps, requirement coverage, artefact download links, open tasks, and the event log.

**LLM**: not used.

---

### Record a status update (structured form)

**Actor**: user

1. On the role detail page, open the Record Update form.
2. Choose an event type (`submitted`, `interviewing`, `accepted`, `rejected`, `closed`), an exact date, and an optional note.
3. Submit the form (`POST /roles/{roleId}/events`).
4. The backend writes the event to `users/{uid}/events` and updates the role status field.
5. The role detail page updates in real time via the open `onSnapshot` subscription.

**LLM**: not used.

---

### Record a status update from a free-form prompt

**Actor**: user + LLM

**Precondition**: user has at least one credit.

1. On the dashboard, click Update on a role row.
2. Enter a free-form prompt, for example: `"Rejected on 2026-05-16, recruiter said they went with someone with more Go experience."`
3. Submit the form (`POST /actions` with `actionType: roleStatusUpdate`).
4. The backend deducts one credit, writes an Action, and returns `202 {actionId}`.
5. The LLM interprets the prompt and returns structured status fields and any internal notes.
6. The backend applies the result using the same write path as the structured form.

**LLM**: status prompt interpretation.

---

### Regenerate a bundle

**Actor**: user + LLM

**Precondition**: user has at least one credit. A completed bundle already exists for the role.

1. On the role detail page, click Regenerate Bundle.
2. The backend deducts one credit and starts the same bundle-generation goroutine as role ingestion, using the existing job description.
3. If calibration data is available and the feature flag is enabled, calibration patterns are injected into the prompt.
4. On completion, the new bundle replaces the existing one.

**LLM**: bundle generation.

---

## Tasks

### View and manage tasks

**Actor**: user

1. Open the Tasks section (`/tasks`).
2. The SPA subscribes to `users/{uid}/tasks` via `onSnapshot`.
3. Tasks are grouped by status (open, in-progress, complete) and optionally filtered by linked role.
4. Create, edit, or delete tasks manually.
5. Gap tasks created by bundle generation are pre-linked to their role.

**LLM**: not used.

---

### Reassess a gap task

**Actor**: user + LLM

**Precondition**: user has at least one credit.

1. Open a gap task.
2. Click Reassess.
3. The backend deducts one credit and starts an Action.
4. The LLM receives the task description, the current CV, and the role requirements that reference the task.
5. The LLM returns a structured result: `status`, `detail`, and optional `evidenceRefs`.
6. The backend writes the updated task state.

**LLM**: task reassessment.

---

## Billing

### Purchase credits

**Actor**: user + Stripe

1. Open the Account section and click Buy Credits.
2. The backend creates a Stripe Checkout session (`POST /billing/checkout`) and returns the session URL.
3. The SPA redirects the user to the Stripe-hosted payment page.
4. The user completes payment.
5. Stripe sends a `checkout.session.completed` webhook to `POST /webhooks/stripe`.
6. The backend verifies the webhook signature, checks the session has not already been fulfilled (idempotency), and credits the account via Firestore transaction.
7. The user is redirected to the confirmation page. The credit balance updates in real time via `onSnapshot`.

**LLM**: not used.

---

## Account

### Delete account

**Actor**: user

**Precondition**: user has re-authenticated within the last 5 minutes (Firebase `auth_time` check enforced server-side).

1. Open Account settings and click Delete Account.
2. If more than 5 minutes have elapsed since sign-in, the SPA calls `reauthenticateWithPopup` before proceeding.
3. Submit the deletion confirmation (`DELETE /account`).
4. The backend:
   - Verifies `RequireRecentAuth(300)`.
   - Cancels any open Stripe subscriptions.
   - Deletes all Firestore subcollections under `users/{uid}/`.
   - Deletes all Cloud Storage objects under `users/{uid}/`.
   - Deletes the Firebase Auth account.
   - Writes a PII-free tombstone to `_admin/deleted_accounts/{uid}`.
5. The SPA signs out and redirects to the landing page.

**LLM**: not used.
