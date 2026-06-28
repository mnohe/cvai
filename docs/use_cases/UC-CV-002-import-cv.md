# UC-CV-002: Import CV from PDF

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; ≥ 1 credit |
| **Milestone** | M1 |
| **Credit cost** | 1 |
| **LLM** | Yes — CV extraction (structured output) |

## Context

The user uploads a PDF of their existing CV. The LLM extracts structured data and
populates the candidate document. This is an async operation — the user sees live
progress via a Firestore subscription.

PDF bytes are never persisted. They are read from the request, sent to the LLM, then
discarded. Firebase Storage is not involved.

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Backend
    participant Firestore
    participant LLM

    User->>SPA: Click Import from PDF, select file (PDF ≤ 10 MB)
    SPA->>Backend: PUT /cv (Content-Type: application/pdf)
    Backend->>Firestore: DeductCredit(uid) — transactional; fails if balance = 0
    Backend->>Firestore: Create Action {status: pending}
    Backend-->>SPA: 202 {actionId}
    SPA->>Firestore: onSnapshot(users/{uid}/actions/{actionId})
    SPA-->>User: Progress indicator visible

    Note over Backend: goroutine
    Backend->>Backend: Read PDF bytes; base64-encode
    Backend->>LLM: Extract CV (structured output against cv.schema.json)
    LLM-->>Backend: Structured CV JSON
    Backend->>Backend: Decode JSON strictly (unknown fields → fail)
    Backend->>Backend: Validate against domain rules; collect any errors
    Backend->>Firestore: WriteCV(uid, cv, validationErrors)
    Backend->>Firestore: Action {status: complete}
    Firestore-->>SPA: onSnapshot fires
    SPA->>Firestore: Re-read users/{uid}/candidate
    SPA-->>User: CV populated; validation notice shown if fields are incomplete
```

## Validation behaviour

After the LLM extracts the CV, the backend runs the domain validator and collects any errors (e.g. missing `cv.summary`, missing `cv_position.location`). Validation errors do **not** fail the import. Instead, the CV is always saved and the Action completes successfully. The errors are written to `candidate.cv_validation_errors` alongside the CV data.

When the editor reads imported experience dates, year-only values are completed to January 1 of that year, and year-month values are completed to the first day of that month, so the date picker can edit them as full dates.

When `cv_validation_errors` is non-empty, the SPA shows an amber notice at the top of the CV editor. The notice translates validator paths into user-recognisable fields such as "Summary" or "Location for Senior Operations Manager at Paragon Global Brands". Print/export is disabled until a subsequent CV save recomputes an empty validation-error list.

A hard failure, i.e. action `failed` and credit refund, only occurs when:
- The PDF cannot be sent to or parsed by the LLM (`user_input` / `provider_*` failure).
- The LLM output cannot be decoded into the CV struct (unknown fields, malformed JSON).

## Alternative flows

### PDF too large

File picker enforces 10 MB client-side. If bypassed, backend returns `400` before
deducting any credit.

### Insufficient credits

`DeductCredit` returns `ErrInsufficientCredits`; backend returns `402`. SPA shows
"Buy credits" prompt. No Action document is created.

### LLM extraction failure or structurally undecodable output

Goroutine refunds credit (best-effort), sets Action to `{status: failed, reason}`.
SPA shows error toast. No CV data is written.

## Postconditions

- `users/{uid}/candidate.cv` is populated with whatever the LLM extracted.
- `users/{uid}/candidate.cv_validation_errors` is set: empty array if CV is fully valid,
  otherwise a list of human-readable field errors.
- Profile completion segments 1 and 2 may now be satisfied (meter advances).
- 1 credit deducted (no refund on success, even if `cv_validation_errors` is non-empty).

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| PDF upload triggers action progress indicator | `e2e/cv.spec.ts` | `UC-CV-002 progress shown` |
| CV populated after successful import | `e2e/cv.spec.ts` | `UC-CV-002 cv populated on success` |
| Validation notice shown when imported CV has missing fields | `e2e/cv.spec.ts` | `UC-CV-002 validation notice on incomplete import` |
| Error toast shown on LLM failure; credit refunded | `e2e/cv.spec.ts` | `UC-CV-002 error and refund` |
| Oversized PDF rejected before credit deducted | `e2e/cv.spec.ts` | `UC-CV-002 oversized pdf rejected` |
| Import blocked when credits = 0 | `e2e/cv.spec.ts` | `UC-CV-002 blocked at zero credits` |
