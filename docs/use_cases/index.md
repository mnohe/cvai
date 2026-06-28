# Use cases

One file per use case. IDs are stable — order within a domain prefix does not imply implementation sequence.

E2E tests reference use cases by ID in their `describe` block names, making coverage auditable: `grep "UC-CV-002"` across `e2e/` shows every test that exercises import.

## Actors

- **User** — a job seeker authenticated via Google or GitHub through Firebase Auth.
- **LLM** — provider configured via `LLM_PROVIDER` and `LLM_MODEL`. Involved only in
  use cases marked **LLM: Yes**. Each LLM-backed operation reserves an external
  request and, when long-running, uses the Action pattern. The reservation is
  released for program, provider, or infrastructure failures, but not for clearly
  user-caused input failures after provider work starts.

## Auth

| ID | Title | Milestone | LLM | External request |
|---|---|---|---|---|
| [UC-AUTH-001](UC-AUTH-001-sign-up.md) | Sign up | M1 | No | — |
| [UC-AUTH-002](UC-AUTH-002-sign-in.md) | Sign in | M1 | No | — |
| [UC-AUTH-003](UC-AUTH-003-sign-out.md) | Sign out | M1 | No | — |

## Onboarding

| ID | Title | Milestone | LLM | External request |
|---|---|---|---|---|
| [UC-ONBOARD-001](UC-ONBOARD-001-profile-completion.md) | Profile completion meter | M1 | No | — |

## Dashboard

| ID | Title | Milestone | LLM | External request |
|---|---|---|---|---|
| [UC-DASH-001](UC-DASH-001-dashboard.md) | Browse dashboard | M3 | No | — |

## CV and candidate profile

| ID | Title | Milestone | LLM | External request |
|---|---|---|---|---|
| [UC-CV-001](UC-CV-001-cv-page-entry.md) | CV page — entry points and empty state | M1 | No | — |
| [UC-CV-002](UC-CV-002-import-cv.md) | Import CV from PDF | M1 | Yes | 1 |
| [UC-CV-003](UC-CV-003-edit-cv.md) | Edit CV section | M1 | No | — |
| [UC-CV-004](UC-CV-004-export-cv-pdf.md) | Export CV as PDF | M1 | No | — |
| [UC-CV-005](UC-CV-005-evidence-library.md) | Manage evidence library | M2 | No | — |
| [UC-CV-006](UC-CV-006-story-bank.md) | Manage story bank | M2 | No | — |
| [UC-CV-007](UC-CV-007-manual-onboarding.md) | Complete CV manually | M1 | No | — |

## Roles

| ID | Title | Milestone | LLM | External request |
|---|---|---|---|---|
| [UC-ROLE-001](UC-ROLE-001-quick-analysis.md) | Quick analysis | M3 | Yes | 1 |
| [UC-ROLE-002](UC-ROLE-002-ingest-role.md) | Ingest role | M3 | No | — |
| [UC-ROLE-003](UC-ROLE-003-generate-bundle.md) | Generate bundle | M3 | Yes | 1 |
| [UC-ROLE-004](UC-ROLE-004-view-role.md) | View role details | M3 | No | — |
| [UC-ROLE-005](UC-ROLE-005-record-status.md) | Record status update | M3 | No | — |
| [UC-ROLE-006](UC-ROLE-006-interpret-status.md) | Interpret status from prompt | M3 | Yes | 1 |
| [UC-ROLE-007](UC-ROLE-007-regenerate-bundle.md) | Regenerate bundle | M3 | Yes | 1 |

## Tasks

| ID | Title | Milestone | LLM | External request |
|---|---|---|---|---|
| [UC-TASK-001](UC-TASK-001-manage-tasks.md) | View and manage tasks | M3 | No | — |
| [UC-TASK-002](UC-TASK-002-reassess-gap-task.md) | Reassess gap task | M3 | Yes | 1 |
