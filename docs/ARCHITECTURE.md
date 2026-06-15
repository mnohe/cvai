# CVAI architecture

_Living document — updated as stages are implemented._

---

## Overview

CVAI is a hosted consumer SaaS application for AI-assisted job application management. Each Firebase Auth account belongs to exactly one job seeker — there is no organisation or team sharing model. Multiple users share the same infrastructure (Cloud Run, Firestore), isolated by UID.

```mermaid
graph TD
    subgraph Browser
        SPA["Vite + React 19\n+ Firebase JS SDK"]
    end

    subgraph GCP ["Google Cloud (europe-west1)"]
        CR["Go HTTP service\n(Cloud Run Gen 2)"]
        FS["Firestore"]
        FA["Firebase Auth"]
        GCS["Cloud Storage"]
    end

    subgraph External
        OpenAI["OpenAI API"]
        Stripe["Stripe\nCheckout + Webhooks"]
    end

    SPA -- "REST JSON\nAuthorization: Bearer" --> CR
    SPA -- "onSnapshot\n(real-time)" --> FS
    SPA -- "ID token\n(OAuth)" --> FA

    CR --> FS
    CR --> FA
    CR --> GCS
    CR --> OpenAI
    CR --> Stripe
```

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend runtime | Go — Cloud Run Gen 2 | Statically compiled; cold start <200 ms; scales to zero |
| Database | Firestore | Document model maps to domain aggregates; `onSnapshot` replaces polling |
| Auth | Firebase Auth | Managed OAuth (Google, GitHub); ID token verification in middleware; no session state |
| LLM | OpenAI API | Direct HTTP client (no SDK); function calling for structured output; streaming for status interpretation. Model configured via `OPENAI_MODEL` — use the current flagship non-reasoning model at deploy time. |
| Billing | Stripe Checkout | Hosted payment page; webhook-driven credit fulfilment; idempotent session tracking |
| Frontend | Vite + React 19 + Tailwind | SPA served from Firebase Hosting; every request carries `Authorization: Bearer <idToken>` |
| PDF export | Browser `window.print()` | Zero backend cost; A4 CSS print layout; no server-side renderer needed |

---

## Backend structure

```
functions/
  cmd/
    main.go              # HTTP server entry point; router wiring
  internal/
    auth/                # Firebase ID token middleware; UID context helpers
    domain/              # Go types and string constants (no iota — Firestore stores strings)
    repo/                # Repository interfaces + Firestore implementations
    llm/                 # OpenAI HTTP client; SSRF-safe URL fetcher; prompt templates
    handlers/            # One file per endpoint group
    billing/             # Stripe client
    calibration/         # Deterministic pattern detection (no I/O)
    middleware/          # Logging, panic recovery, rate limiting, CORS
```

### Router structure

Two mux instances are composed at startup, making it structurally impossible to expose a handler without explicitly choosing a path:

```mermaid
graph LR
    Req["HTTP request"] --> Router

    Router -->|"public paths\n/healthz\n/webhooks/stripe"| PublicMux
    Router -->|"all other paths"| AuthMux

    AuthMux -->|"RequireAuth\nverifies Bearer token\nplaces UID in context"| Handler
    PublicMux -->|"no token required"| PubHandler

    AuthMux -->|"no matching route"| 404
```

Any handler not registered on either mux returns 404 — never 200-unauthenticated.

---

## Data model (Firestore)

All user data lives under `users/{uid}/`. Firestore Security Rules enforce that no authenticated user can access another user's subtree.

```mermaid
erDiagram
    USER ||--|| CANDIDATE : has
    USER ||--|| ACCOUNT : has
    USER ||--o{ ROLE : owns
    USER ||--o{ TASK : owns
    USER ||--o{ EVENT : owns
    USER ||--o{ ACTION : owns

    ROLE ||--o| BUNDLE : "has (after generation)"
    BUNDLE ||--|| JOB : contains
    BUNDLE ||--|| ANALYSIS : contains
    BUNDLE ||--o| OUTCOME : "has (when closed)"

    ANALYSIS ||--o{ STRENGTH : has
    ANALYSIS ||--o{ GAP : has
    ANALYSIS ||--o{ REQUIREMENT_COVERAGE : has

    TASK }o--o| ROLE : "linked to (optional)"
    EVENT }o--o| ROLE : "linked to (optional)"

    CANDIDATE ||--|| CV : has
    CANDIDATE ||--o{ EVIDENCE_ITEM : has
    CANDIDATE ||--o{ STORY : has

    ACCOUNT ||--o{ PURCHASE_RECORD : has
```

**Collection paths:**

```
users/{uid}/
  candidate          (single doc)  CV, EvidenceLibrary, StoryBank
  account            (single doc)  credit balance, Stripe customer ID, purchase history
  roles/{roleId}                   Role metadata and status
  roles/{roleId}/bundle/data       Bundle = Job + Analysis + Outcome
  tasks/{taskId}                   Task (optionally linked to a roleId)
  events/{eventId}                 Append-only event log
  actions/{actionId}               Async operation state machine

_admin/deleted_accounts/{uid}      PII-free tombstone; no client access
```

### Repository pattern

Handlers never hold a `*firestore.Client` reference. All data access goes through typed interfaces in `internal/repo/interfaces.go`. The Firestore implementations live in `internal/repo/firestore/`.

Interface constraints enforced structurally (not by convention):

- `EventRepository` — no `Update` or `Delete`; append-only at the type level
- `CalibrationRepository` — no write methods; read-only at the type level
- `AccountRepository.DeductCredit` — Firestore transaction; returns `ErrInsufficientCredits` when balance is zero

---

## Async action pattern

Every LLM-backed endpoint follows this lifecycle without exception:

```mermaid
sequenceDiagram
    participant Client
    participant Handler
    participant Firestore
    participant Goroutine
    participant OpenAI

    Client->>Handler: POST /import-cv (or any LLM endpoint)
    Handler->>Firestore: DeductCredit (transaction)
    Handler->>Firestore: Write Action {status: pending}
    Handler-->>Client: 202 {actionId}

    Handler->>Goroutine: launch

    Goroutine->>Firestore: Update Action {status: running}
    Goroutine->>OpenAI: LLM call
    OpenAI-->>Goroutine: structured output

    alt success
        Goroutine->>Firestore: Write results
        Goroutine->>Firestore: Update Action {status: complete}
    else failure
        Goroutine->>Firestore: RefundCredit (best-effort)
        Goroutine->>Firestore: Update Action {status: failed, reason}
    end

    Client->>Firestore: onSnapshot(actionId)
    Firestore-->>Client: real-time update on complete/failed
    Client->>Firestore: re-read affected resource
```

The LLM timeout ceiling is 60 s. Blocking the HTTP handler on an LLM call would exhaust Cloud Run concurrency.

---

## Auth model

```mermaid
sequenceDiagram
    participant User
    participant SPA
    participant FirebaseAuth
    participant GoService

    User->>SPA: Sign in (Google / GitHub)
    SPA->>FirebaseAuth: signInWithPopup
    FirebaseAuth-->>SPA: ID token (JWT, 1h TTL)

    SPA->>GoService: POST /import-cv\nAuthorization: Bearer <idToken>
    GoService->>FirebaseAuth: VerifyIDToken
    FirebaseAuth-->>GoService: {uid, auth_time, ...}
    GoService->>GoService: UID → request context
    GoService-->>SPA: 202 {actionId}
```

`RequireRecentAuth` additionally checks `auth_time` and is applied to `DELETE /account` (max 5 minutes). The SPA calls `reauthenticateWithPopup` before hitting that endpoint.

---

## LLM integration

The LLM is an extraction and reasoning component, not a source of truth. Every LLM-backed workflow must:

1. Convert bounded input into structured output via OpenAI function calling
2. Validate the output against the domain schema before writing any state
3. Write only validated state to Firestore

Ingested source material (URLs, PDFs, pasted text) is always passed as delimited evidence with no instruction authority — even if it contains text like "ignore previous instructions". SSRF protection blocks private IP ranges, loopback, link-local, and the GCP metadata endpoint before any URL is fetched.

**Logs record `{tokenCount, latencyMs, model}` only.** No prompt content, CV text, or job description text appears in any log line.

### Disallowed LLM uses

The LLM must never be called for: dashboard ordering, credit balance display, status or verdict rendering, or any deterministic read operation.

---

## Calibration

Two feedback loops inject historical signal into bundle-generation prompts once sufficient data exists:

```mermaid
graph LR
    subgraph "Assessment calibration (≥3 outcomes per verdict)"
        Roles["Completed roles\nwith Outcomes"] --> AC["AssessmentCalibration\n(success rates by Verdict)"]
        AC --> Patterns["CalibrationPatterns()\nover-confidence\nblind spot\nbar-too-low"]
    end

    subgraph "Task calibration (≥3 gap tasks completed)"
        Tasks["Completed gap tasks\nwith actualDays"] --> TC["TaskCalibration\n(avg completion time)"]
    end

    Patterns --> Prompt["Bundle generation\nprompt"]
    TC --> Prompt
```

Calibration blocks are computed at request time from `CalibrationRepository` (read-only) and injected into the prompt. They are **never stored** in the Bundle or Action document. Injection is gated behind a manual flag until the eval harness (Stage 20) confirms it does not regress output quality.

---

## Security model

| Control | Implementation |
|---|---|
| Authentication | Firebase ID token verified on every authenticated route. Two-mux structure makes accidental public exposure a structural miss, not a runtime risk. |
| Authorisation | Firestore Security Rules enforce `request.auth.uid == uid` on all `users/{uid}/**`. The Go middleware is the primary gate; Rules defend against client-SDK bypass. |
| SSRF | `FetchURL` resolves DNS before connecting and checks all resolved IPs against a blocklist (RFC 1918, loopback, link-local, GCP metadata endpoint). DNS rebinding is mitigated by checking IPs, not the original hostname. |
| Prompt injection | Source material is passed as delimited evidence with an explicit instruction that embedded directives have no authority. Output validation catches injection artefacts; correctness does not depend on detecting every attack string. |
| PII in logs | Structured logging middleware hashes the UID (SHA-256) for correlation. Prompt content, CV text, job descriptions, and email addresses must never appear in any log line. |
| Account deletion | `RequireRecentAuth(300)` enforced server-side. Cascade deletes all Firestore subcollections and Cloud Storage objects. A PII-free tombstone is written to `_admin/deleted_accounts/{uid}`. |

---

## Observability

_Fully implemented in Stage 22. Stubs noted here._

- Structured JSON logs per request: `{requestId, uid_hash, path, method, statusCode, durationMs}`
- LLM calls log `{tokenCount, latencyMs, model}` — nothing else
- Cloud Error Reporting for panics and 5xx errors
- `/healthz` deep check probes Firestore with a 1 s timeout; returns `{"status":"degraded","detail":"firestore"}` on failure
- Alert policies: error rate > 1 %, P99 latency > 5 s, credit deduction failure rate > 0

See `docs/ops.adoc` (Stage 22) for alert configuration commands.

---

## Environment variables

| Variable | Purpose | Required in |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Firebase project identifier | Functions, emulator |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account key path for Firebase Admin SDK | Functions (production) |
| `FIRESTORE_EMULATOR_HOST` | e.g. `localhost:8080` | CI, local dev |
| `FIREBASE_AUTH_EMULATOR_HOST` | e.g. `localhost:9099` | CI, local dev |
| `OPENAI_API_KEY` | OpenAI API key | Functions (production), live eval |
| `OPENAI_MODEL` | Current flagship non-reasoning model (e.g. `gpt-4o`). Set to the latest at deploy time; do not hard-code. | Functions |
| `STRIPE_SECRET_KEY` | Stripe API key | Functions |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | Functions |
| `VITE_FIREBASE_API_KEY` | Firebase JS SDK config | Web SPA |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase JS SDK config | Web SPA |
| `VITE_FIREBASE_PROJECT_ID` | Firebase JS SDK config | Web SPA |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase JS SDK config | Web SPA |
| `VITE_API_BASE_URL` | Go backend Cloud Run URL | Web SPA |

All secrets are stored in Google Cloud Secret Manager in production and mounted into the Cloud Run service. Never committed to source control or placed in `firebase.json`.
