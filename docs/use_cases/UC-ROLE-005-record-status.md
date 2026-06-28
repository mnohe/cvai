# UC-ROLE-005: Record status update

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; role exists |
| **Milestone** | M3 |
| **External request** | None |
| **LLM** | No |

## Context

Structured status changes: the user selects from a predefined transition set. For
free-text interpretation see [UC-ROLE-006](UC-ROLE-006-interpret-status.md).

Valid transitions: `interested → applied → phone_screen → interview → offer →
accepted / rejected / withdrawn`.

## Flow

1. User opens the status selector on the role detail page (inline sharp-rectangle pill).
2. Selects a new status.
3. SPA writes directly to `users/{uid}/roles/{roleId}` and appends an Event document
   to `users/{uid}/events`.
4. If the new status is terminal (`rejected`, `withdrawn`, `accepted`): an Outcome block
   is written to the bundle with `result` derived from the status and `recordedAt` timestamp.
   An `OutcomeRecorded` event is also appended.
5. Page updates in real time via the open `onSnapshot` subscription.

## Postconditions

- `role.status` updated.
- Event appended to `users/{uid}/events`.
- If terminal: Outcome block written to bundle; Assessment Calibration data grows.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Status change updates role and appends event | `e2e/roles.spec.ts` | `UC-ROLE-005 status change` |
| Terminal status writes outcome block | `e2e/roles.spec.ts` | `UC-ROLE-005 terminal status outcome` |
