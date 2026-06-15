# UC-ROLE-002: Ingest role

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; profile at ≥ 2/5 completion |
| **Milestone** | M3 |
| **Credit cost** | None |
| **LLM** | No |

## Context

Ingestion stores a role as a document with `status: interested` and the raw source text.
No analysis is run here — that is [UC-ROLE-003](UC-ROLE-003-generate-bundle.md).

When preceded by a Quick Analysis ([UC-ROLE-001](UC-ROLE-001-quick-analysis.md)),
the source text captured during that call is reused and the URL is not fetched again.

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Backend
    participant Firestore

    User->>SPA: Submit role (URL or pasted text; optional company/title overrides)
    SPA->>Backend: POST /roles {url? or sourceText? (forwarded from preview)}

    alt URL path (no prior Quick Analysis)
        Backend->>Backend: SSRF-validate URL
        Backend->>Backend: Fetch URL; strip nav/footer/script; cap at 32 KB
    else Source text from Quick Analysis
        Note over Backend: sourceText already in request body; no fetch
    end

    Backend->>Firestore: Create users/{uid}/roles/{roleId} {status: interested, sourceText, createdAt}
    Backend-->>SPA: 200 {roleId}
    SPA-->>User: Navigate to role detail page (UC-ROLE-004)
```

## Alternative flows

### URL fetch fails

Backend returns `400` with a message directing the user to paste the text. No Role
document is created.

### Text too long

Text exceeding 32 KB is truncated at the backend. A warning is shown in the UI.

## Postconditions

- `users/{uid}/roles/{roleId}` exists with `status: interested` and `sourceText`.
- No Bundle document exists yet.
- No credits consumed.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| URL ingestion creates role with sourceText | `e2e/roles.spec.ts` | `UC-ROLE-002 url ingestion` |
| Text ingestion creates role with sourceText | `e2e/roles.spec.ts` | `UC-ROLE-002 text ingestion` |
| Quick Analysis source text reused (no second fetch) | `e2e/roles.spec.ts` | `UC-ROLE-002 reuses quick analysis text` |
| Private IP URL rejected | `e2e/roles.spec.ts` | `UC-ROLE-002 ssrf rejected` |
