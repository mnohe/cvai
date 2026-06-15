# UC-CV-006: Manage story bank

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in |
| **Milestone** | M2 |
| **Credit cost** | None |
| **LLM** | No |

## Context

The Story Bank holds STAR-format narratives indexed to competencies (leadership,
technical depth, conflict resolution, etc.). Stories are available as candidate context
during bundle generation and interview preparation.

All writes go directly to Firestore. No backend call, no credit.

## Flow

1. User opens `/cv` and selects the **Stories** tab.
2. **Add story**: title, `competencyTags` (multi-select from predefined list), narrative
   (free text). SPA writes to `users/{uid}/candidate.storyBank` (array append).
3. **Edit story**: inline; SPA writes the updated array.
4. **Delete story**: confirmation prompt; SPA removes from array.
5. Profile completion segment 3 (story) is satisfied when ≥ 1 story exists.

## Postconditions

- `candidate.storyBank` reflects the current story list.
- Profile meter segment 3 may now be satisfied.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Add story saves to Firestore | `e2e/cv.spec.ts` | `UC-CV-006 add story` |
| Edit story updates in place | `e2e/cv.spec.ts` | `UC-CV-006 edit story` |
| First story satisfies profile segment 3 | `e2e/cv.spec.ts` | `UC-CV-006 segment 3 satisfied` |
