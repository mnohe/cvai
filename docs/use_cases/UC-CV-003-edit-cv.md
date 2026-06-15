# UC-CV-003: Edit CV section

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in |
| **Milestone** | M1 |
| **Credit cost** | None |
| **LLM** | No |

## Context

The CV editor allows section-by-section editing of the structured CV. All writes go
directly from the SPA to Firestore — no backend call, no credit. Firestore Security
Rules permit `users/{uid}/candidate` writes by the owning user.

Sections: Personal details, Summary, Experience, Education, Skills, Certifications,
Languages, Projects.

## Flow

1. User opens `/profile/cv`. If a CV exists, the section editor is shown with current values.
2. User edits a section (inline form — no separate edit mode).
3. On save, SPA writes the updated section directly to `users/{uid}/candidate` via
   the Firestore client SDK.
4. The `onSnapshot` subscription fires and the UI reflects the saved state immediately.
5. `cv.updatedAt` is set on every write.
6. Profile completion meter advances if the edit satisfies a previously unmet segment.

## Completeness indicator

A progress bar above the section tabs shows how many of the required CV fields are
filled. This is a UI-only computation — no backend call.

## Postconditions

- Section data saved to `users/{uid}/candidate`.
- `cv.updatedAt` updated.
- If a Bundle exists for any role and the CV has changed since that bundle was generated,
  those role detail pages show a "CV updated — Reassess?" prompt.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Editing personal details saves without a backend call | `e2e/cv.spec.ts` | `UC-CV-003 direct firestore write` |
| Completeness indicator advances after filling experience | `e2e/cv.spec.ts` | `UC-CV-003 completeness advances` |
| Profile meter advances to green after personal + experience saved | `e2e/cv.spec.ts` | `UC-CV-003 meter reaches green` |
