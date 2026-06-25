# UC-ROLE-006: Interpret status from free-form prompt

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; role exists; external requests available |
| **Milestone** | M3 |
| **External request** | 1 |
| **LLM** | Yes — prompt interpretation (streaming) |

## Context

The user types a natural-language update ("Got a call back, interview next Thursday at
3 pm") and the LLM interprets it into a structured status change. The write path after
interpretation is identical to [UC-ROLE-005](UC-ROLE-005-record-status.md).

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Backend
    participant Firestore
    participant LLM

    User->>SPA: Click "Interpret update", type free-form prompt
    SPA->>Backend: POST /roles/{roleId}/events {prompt}
    Backend->>Firestore: Reserve external request
    Backend->>Firestore: Create Action {status: pending}
    Backend-->>SPA: 202 {actionId}
    SPA->>Firestore: onSnapshot(Action)

    Note over Backend: goroutine
    Backend->>LLM: Interpret prompt → {status, date?, note}
    LLM-->>Backend: Structured result
    Backend->>Firestore: Apply status change + Event (same path as UC-ROLE-005)
    Backend->>Firestore: Action {status: complete}
    Firestore-->>SPA: onSnapshot fires
    SPA-->>User: Status updated; event visible in timeline
```

## Postconditions

- Same as [UC-ROLE-005](UC-ROLE-005-record-status.md).
- 1 external request reserved.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Free-form prompt updates status and appends event | `e2e/roles.spec.ts` | `UC-ROLE-006 interpret status` |
| External request reserved on success | `e2e/roles.spec.ts` | `UC-ROLE-006 external request reserved` |
