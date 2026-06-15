# UC-TASK-002: Reassess gap task

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; gap task exists and is linked to a role with a bundle; ≥ 1 credit |
| **Milestone** | M3 |
| **Credit cost** | 1 |
| **LLM** | Yes — gap reassessment |

## Context

After completing a gap task (e.g. obtaining a certification), the user can ask the LLM
whether their CV and evidence library now satisfy the linked gap requirement.
If yes, the gap is closed in the Analysis and the Verdict may improve.

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Backend
    participant Firestore
    participant LLM

    User->>SPA: Click ✨ Reassess on a completed gap task
    SPA->>Backend: POST /tasks/{taskId}/reassessments
    Backend->>Firestore: DeductCredit(uid)
    Backend->>Firestore: Create Action {status: pending}
    Backend-->>SPA: 202 {actionId}
    SPA->>Firestore: onSnapshot(Action)

    Note over Backend: goroutine
    Backend->>Firestore: Read linked Role's Bundle + Gap at gapIndex
    Backend->>Firestore: Read candidate.cv + candidate.evidenceLibrary
    Backend->>LLM: Does current CV/evidence meet this requirement?
    LLM-->>Backend: {met: bool, reason, evidenceRefs?}

    alt Gap now met
        Backend->>Firestore: Update RequirementCoverage[gapIndex].status = met
        Backend->>Firestore: Recalculate and update Verdict if warranted
        Backend->>Firestore: Action {status: complete, result: {met: true}}
    else Gap still open
        Backend->>Firestore: Action {status: complete, result: {met: false, reason}}
    end

    Firestore-->>SPA: onSnapshot fires
    SPA-->>User: Result shown inline on task
```

## Postconditions

- If met: gap closed in Analysis; Verdict may have improved; 1 credit deducted.
- If still open: no Analysis change; 1 credit deducted; reason shown to user.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Reassess closes gap and updates verdict | `e2e/tasks.spec.ts` | `UC-TASK-002 gap closed` |
| Reassess returns still-open with reason | `e2e/tasks.spec.ts` | `UC-TASK-002 still open` |
| Credit deducted in both outcomes | `e2e/tasks.spec.ts` | `UC-TASK-002 credit deducted` |
