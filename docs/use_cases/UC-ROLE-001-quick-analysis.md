# UC-ROLE-001: Quick analysis

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; profile at ≥ 2/5 completion |
| **Milestone** | M3 |
| **Credit cost** | None (rate-limited per UID) |
| **LLM** | Yes — lightweight suitability assessment |

## Context

Quick Analysis is a free pre-ingestion pass that lets the user evaluate fit before
committing a credit to full bundle generation. The result is ephemeral — no Role
document is written. If the user continues to full ingestion, the source text captured
here is reused so the URL is not fetched a second time.

Rate limit: backend enforces a per-UID cap to prevent abuse. A rate limit token is not
consumed when a URL fetch fails — only when the LLM call is initiated.

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Backend
    participant LLM

    User->>SPA: Click "Add role", enter URL or paste text
    SPA->>Backend: POST /quick-analysis {url} or {text}

    alt URL provided
        Backend->>Backend: SSRF-validate URL
        Backend->>Backend: Fetch URL; extract visible text (cap 32 KB)
    end

    Backend->>LLM: Quick suitability assessment (current CV + source text)
    LLM-->>Backend: {fitLevel, matches, gaps, effortEstimates, recommendation}
    Backend-->>SPA: 200 {result, sourceText}
    SPA-->>User: Preview card — fit level, key matches, gaps, recommendation

    alt User continues
        SPA->>SPA: Cache sourceText for IngestRole (UC-ROLE-002)
        User->>SPA: Click "Continue — ingest this role"
    else User abandons
        Note over SPA: Result discarded; no state written
    end
```

## Alternative flows

### URL fetch fails

Backend returns an error directing the user to paste the text manually.
No rate limit token is consumed.

### Rate limit reached

Backend returns `429`. SPA shows "You've run several quick analyses recently — try
again later or paste the text to proceed directly."

## Postconditions

- No Firestore documents written.
- If the user continued: `sourceText` is held in SPA state for [UC-ROLE-002](UC-ROLE-002-ingest-role.md).

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| URL input fetches and returns quick analysis result | `e2e/roles.spec.ts` | `UC-ROLE-001 url quick analysis` |
| Text input returns quick analysis result | `e2e/roles.spec.ts` | `UC-ROLE-001 text quick analysis` |
| Abandoning leaves no role document | `e2e/roles.spec.ts` | `UC-ROLE-001 abandon leaves no document` |
| Rate limit returns 429 with message | `e2e/roles.spec.ts` | `UC-ROLE-001 rate limit` |
| Private IP URL rejected | `e2e/roles.spec.ts` | `UC-ROLE-001 ssrf rejected` |
