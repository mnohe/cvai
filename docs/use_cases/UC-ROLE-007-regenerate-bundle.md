# UC-ROLE-007: Regenerate bundle

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; role has an existing bundle; external requests available |
| **Milestone** | M3 |
| **External request** | 1 |
| **LLM** | Yes — analysis and artifact generation (skips job extraction) |

## Context

Used when the CV has been updated since the last bundle was generated. The Job struct
(extracted in the original bundle generation) is reused — only the Analysis and
Artifacts are regenerated.

The "outdated" signal on the role detail page ([UC-ROLE-004](UC-ROLE-004-view-role.md))
triggers the user to reassess.

## Flow

`PUT /roles/{roleId}/bundle` — same goroutine as [UC-ROLE-003](UC-ROLE-003-generate-bundle.md) with one difference:
the goroutine skips LLM Call 1 (job extraction) and uses the existing `bundle.job`
struct directly. Calls 2 (Analysis) and 3 (Artifacts) run as normal.

Returns `409` if no bundle exists (nothing to reassess — use Generate instead).

## Postconditions

- Bundle updated with new Analysis and Artifacts; `bundle.generatedAt` refreshed.
- `bundle.job` unchanged.
- 1 external request reserved.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Reassess updates analysis, preserves job struct | `e2e/roles.spec.ts` | `UC-ROLE-007 reassess updates analysis` |
| 409 when no bundle exists | `e2e/roles.spec.ts` | `UC-ROLE-007 409 without bundle` |
| External request released on failure | `e2e/roles.spec.ts` | `UC-ROLE-007 external request released on failure` |
