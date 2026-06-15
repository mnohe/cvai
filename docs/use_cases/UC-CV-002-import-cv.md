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
    Backend->>Backend: Validate against cv.schema.json
    Backend->>Firestore: WriteCV(uid, cv)
    Backend->>Firestore: Action {status: complete}
    Firestore-->>SPA: onSnapshot fires
    SPA->>Firestore: Re-read users/{uid}/candidate
    SPA-->>User: CV populated; success toast
```

## Alternative flows

### PDF too large

File picker enforces 10 MB client-side. If bypassed, backend returns `400` before
deducting any credit.

### Insufficient credits

`DeductCredit` returns `ErrInsufficientCredits`; backend returns `402`. SPA shows
"Buy credits" prompt. No Action document is created.

### LLM extraction failure or schema-invalid output

Goroutine refunds credit (best-effort), sets Action to `{status: failed, reason}`.
SPA shows error toast. Partial data is never written.

## Postconditions

- `users/{uid}/candidate.cv` is populated with structured data.
- `candidate.cv.updatedAt` is set.
- Profile completion segments 1 and 2 may now be satisfied (meter advances).
- 1 credit deducted (no refund on success).

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| PDF upload triggers action progress indicator | `e2e/cv.spec.ts` | `UC-CV-002 progress shown` |
| CV populated after successful import | `e2e/cv.spec.ts` | `UC-CV-002 cv populated on success` |
| Error toast shown on LLM failure; credit refunded | `e2e/cv.spec.ts` | `UC-CV-002 error and refund` |
| Oversized PDF rejected before credit deducted | `e2e/cv.spec.ts` | `UC-CV-002 oversized pdf rejected` |
| Import blocked when credits = 0 | `e2e/cv.spec.ts` | `UC-CV-002 blocked at zero credits` |
