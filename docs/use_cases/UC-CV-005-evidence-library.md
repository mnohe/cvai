# UC-CV-005: Manage evidence library

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in |
| **Milestone** | M2 |
| **Credit cost** | None |
| **LLM** | No |

## Context

The Evidence Library is a collection of the user's proof points — quantified outcomes,
certifications, publications, project results — that the LLM draws on when assessing
Requirement Coverage during bundle generation.

All writes go directly to Firestore. No backend call, no credit.

## Flow

1. User opens `/cv` and selects the **Evidence** tab.
2. Existing evidence items are listed (empty state if none).
3. **Add item**: user fills in description, date, `quantifiedOutcome` (required), and
   optional tags. SPA writes to `users/{uid}/candidate.evidenceLibrary` (array append).
4. **Edit item**: inline edit form; SPA writes the updated array.
5. **Delete item**: confirmation prompt; SPA removes the item from the array.
6. Profile completion segment 5 (portfolio evidence) is satisfied when ≥ 1 item exists.

## Postconditions

- `candidate.evidenceLibrary` reflects the current item list.
- Profile meter segment 5 may now be satisfied.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Add evidence item saves to Firestore | `e2e/cv.spec.ts` | `UC-CV-005 add evidence item` |
| Missing quantifiedOutcome blocks save | `e2e/cv.spec.ts` | `UC-CV-005 required field enforced` |
| Delete item removes it from the list | `e2e/cv.spec.ts` | `UC-CV-005 delete item` |
| First item satisfies profile segment 5 | `e2e/cv.spec.ts` | `UC-CV-005 segment 5 satisfied` |
