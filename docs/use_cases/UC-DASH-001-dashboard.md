# UC-DASH-001: Browse the dashboard

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; profile at ≥ 2/5 completion |
| **Milestone** | M3 |
| **External request** | None |
| **LLM** | No |

## Context

The dashboard is the home screen for users who are actively tracking roles. It is not
accessible until the profile completion gate is met (see
[UC-ONBOARD-001](UC-ONBOARD-001-profile-completion.md)) — below 2/5 the user is
redirected to `/cv`.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  Dashboard                                               │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Active   │ │ Applied  │ │Interview │ │  Offers  │  │
│  │    3     │ │    5     │ │    2     │ │    1     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                          │
│  Open tasks due this week                 [View all]    │
│  ◆ Obtain AWS cert        due in 3 days   → Company A  │
│  ◆ Prepare portfolio      due in 6 days   → Company B  │
└──────────────────────────────────────────────────────────┘
```

## Flow

1. SPA subscribes to `users/{uid}/roles` and `users/{uid}/tasks` via `onSnapshot`.
2. Role cards display counts by status (excluding terminal: `rejected`, `withdrawn`,
   `archived`).
3. Tasks section lists open tasks with `dueDate` within 7 days, sorted by due date.
4. Profile completion meter is visible in the sidebar if < 5/5.
5. Subscriptions stay open; the page updates in real time as roles or tasks change.

## Empty state

When no roles have been ingested yet:

```
┌──────────────────────────────────────────────────────────┐
│  Dashboard                                               │
│                                                          │
│  No roles yet. Add your first role to get started.      │
│  [✨ Add role]                                           │
└──────────────────────────────────────────────────────────┘
```

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Dashboard shows role counts by status | `e2e/dashboard.spec.ts` | `UC-DASH-001 role counts by status` |
| Dashboard shows tasks due within 7 days | `e2e/dashboard.spec.ts` | `UC-DASH-001 upcoming tasks` |
| Empty state shown when no roles exist | `e2e/dashboard.spec.ts` | `UC-DASH-001 empty state` |
| Role count updates in real time when status changes | `e2e/dashboard.spec.ts` | `UC-DASH-001 realtime update` |
| Below 2/5 completion redirects to /cv | `e2e/dashboard.spec.ts` | `UC-DASH-001 gate redirect` |
