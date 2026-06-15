# UC-ROLE-003: Generate bundle

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; role exists with `sourceText`; ≥ 1 credit; no bundle generation already in progress for this role |
| **Milestone** | M3 |
| **Credit cost** | 1 |
| **LLM** | Yes — three sequential calls: job extraction, analysis, artifact generation |

## Context

Bundle generation is the core AI pipeline. It produces the structured assessment a user
acts on: Verdict, Strengths, Gaps, Requirement Coverage, and markdown artifacts.

Calibration data is injected into the prompts when sufficient historical data exists
(≥ 3 completed gap tasks for Task Calibration; ≥ 3 role outcomes per verdict group for
Assessment Calibration). Both are omitted silently when data is insufficient.

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Backend
    participant Firestore
    participant LLM

    User->>SPA: Click ✨ Generate analysis on role detail page
    SPA->>Backend: POST /generate-bundle {roleId}
    Backend->>Firestore: Guard: reject 409 if Action in progress for this roleId
    Backend->>Firestore: DeductCredit(uid)
    Backend->>Firestore: Create Action {status: pending}
    Backend-->>SPA: 202 {actionId}
    SPA->>Firestore: onSnapshot(Action) — shows Analysing… state

    Note over Backend: goroutine
    Backend->>Firestore: Read Role.sourceText + candidate.cv + calibration data
    Backend->>LLM: Call 1 — extract structured Job (title, company, requirements list)
    LLM-->>Backend: Job JSON
    Backend->>LLM: Call 2 — generate Analysis (Verdict, Strengths, Gaps, RequirementCoverage)
    LLM-->>Backend: Analysis JSON
    Backend->>LLM: Call 3 — generate markdown artifacts (suitability report, role matrix)
    LLM-->>Backend: Artifacts markdown
    Backend->>Firestore: Write Bundle (atomic batch: Job + Analysis + Artifacts)
    Backend->>Firestore: Action {status: complete}
    Firestore-->>SPA: onSnapshot fires
    SPA->>Firestore: Re-read role + bundle
    SPA-->>User: Analysis displayed
```

## Alternative flows

### Any LLM call fails

Goroutine refunds credit (best-effort), sets Action to `{status: failed, reason: <step name>}`.
SPA shows error toast. No partial Bundle is written.

### Double-click / duplicate request

`409` returned immediately if an Action with type `bundle_generation` is already in
progress for this roleId. No credit deducted.

### Insufficient credits

`DeductCredit` returns `ErrInsufficientCredits`; backend returns `402`. No Action created.

## Postconditions

- `users/{uid}/roles/{roleId}/bundle` written with Job, Analysis, and Artifacts.
- `bundle.generatedAt` set to current time.
- 1 credit deducted.
- Role detail page shows Verdict and full analysis.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Generate bundle shows Analysing… then displays verdict | `e2e/roles.spec.ts` | `UC-ROLE-003 bundle generation flow` |
| Duplicate request returns 409 | `e2e/roles.spec.ts` | `UC-ROLE-003 double click guard` |
| Credit refunded on LLM failure | `e2e/roles.spec.ts` | `UC-ROLE-003 credit refunded on failure` |
| Blocked at zero credits | `e2e/roles.spec.ts` | `UC-ROLE-003 blocked at zero credits` |
