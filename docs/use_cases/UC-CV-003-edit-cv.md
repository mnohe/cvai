# UC-CV-003: Edit CV section

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in |
| **Milestone** | M1 |
| **External request** | None |
| **LLM** | No |

## Context

The CV editor allows section-by-section editing of the structured CV. All writes go
directly from the SPA to Firestore — no backend call, no external request. Firestore Security
Rules permit `users/{uid}/candidate` writes by the owning user.

Sections: Personal details, Summary, Experience, Education, Skills, Certifications,
Languages, Projects.

## Flow

1. User opens `/profile/cv`. If a CV exists, the section editor is shown with current values.
2. If `candidate.cv_validation_errors` is non-empty (set after a PDF import that left fields incomplete), an amber notice is shown at the top of the editor listing user-recognisable fields to fix. Print/export is disabled while the notice is visible.
3. User edits a section. Single-value sections use inline forms; multi-entry sections use Add/Edit/Remove panels with Save and Cancel while editing. Add opens the new entry at the top of the list so it is immediately visible. User-ordered lists such as links, skills, and languages can be reordered with drag handles; dated sections such as education and certifications remain sorted newest first by year. Experience entries and positions with no end date are treated as current, sorted before ended roles, and then ordered by most recent start date.
4. On save, SPA writes the updated section directly to `users/{uid}/candidate` via the Firestore client SDK. The write always includes freshly recomputed `cv_validation_errors`; incomplete CVs remain saved but gated, and complete CVs store an empty error list.
5. The `onSnapshot` subscription fires and the UI reflects the saved state immediately.
6. `updated_at` is set on every write.
7. Profile completion meter advances if the edit satisfies a previously unmet segment.

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
