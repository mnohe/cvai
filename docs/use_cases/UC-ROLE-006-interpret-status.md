# UC-ROLE-006: Interpret status from free-form prompt

> **Status: deferred.** Natural-language dispatch is not part of M3. It remains deferred until a compelling product use case is established beyond an authorised CVAI MCP server used from an external chatbot at the user's expense. This document preserves the earlier proposal and is not an implementation contract.

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; role exists; ≥ 1 credit |
| **Milestone** | Deferred |
| **Credit cost** | 1 |
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
    Backend->>Firestore: DeductCredit(uid)
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
- 1 credit deducted.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Free-form prompt updates status and appends event | `e2e/roles.spec.ts` | `UC-ROLE-006 interpret status` |
| Credit deducted on success | `e2e/roles.spec.ts` | `UC-ROLE-006 credit deducted` |
