# UC-CV-007: Complete CV manually

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in, no imported CV required |
| **Milestone** | M1 |
| **Credit cost** | None |
| **LLM** | No |

## Context

Manual CV onboarding lets a user create a structured CV without using the PDF import.
The flow is entirely client-side Firestore writes under the user's own
`users/{uid}/candidate/profile` document.

## Fields

The manual editor covers:

- Personal: first name, surname, email, phone prefix, phone number, LinkedIn, GitHub, website.
- Summary: summary text.
- Experience: company, roles, start, end, location, tasks and outcomes.
- Education: qualification, type, issuer, year.
- Skills: one skill per line.
- Certifications: certification, credential ID, issuer, year.
- Languages: language, level.
- Projects: portfolio URL, project name, project URL, project summary, project description.

## Flow

1. User opens `/profile/cv`.
2. User selects **Start from scratch**.
3. User fills each section and saves it.
4. Each save writes directly to Firestore; no Cloud Function or API endpoint is called.
5. The page receives the saved candidate document through `onSnapshot`.
6. User reloads or returns later and sees all manually entered values in the editor.

## Postconditions

- `users/{uid}/candidate/profile.cv` contains every manually entered field.
- `updated_at` is set after meaningful section saves.
- No backend CV update endpoint is called.
- The completion indicator and profile meter advance from the saved CV data.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Manual onboarding saves and reloads every exposed field | `e2e/cv.spec.ts` | `UC-CV-007 complete manual onboarding` |
