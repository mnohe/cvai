# UC-ROLE-004: View role details

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; role exists |
| **Milestone** | M3 |
| **External request** | None |
| **LLM** | No |

## Bundle state machine

The role detail page renders differently depending on bundle state:

```
┌─────────────────────────────────────────────────────────┐
│  No bundle          │  ✨ Generate analysis             │
├─────────────────────┼─────────────────────────────────────┤
│  Action in progress │  Analysing…  ████░░░░ (progress)  │
├─────────────────────┼─────────────────────────────────────┤
│  Bundle current     │  Full analysis display             │
├─────────────────────┼─────────────────────────────────────┤
│  Bundle outdated    │  Analysis display + ✨ Reassess    │
│  (CV updated since  │  banner at top                     │
│   bundle.generatedAt)│                                   │
└─────────────────────┴─────────────────────────────────────┘
```

"Outdated" is determined client-side: `bundle.generatedAt < candidate.cv.updatedAt`.

## Flow

1. User navigates to `/roles/{roleId}`.
2. SPA subscribes to `users/{uid}/roles/{roleId}` and its bundle sub-document via
   `onSnapshot`. Both subscriptions stay open for the lifetime of the page.
3. Page renders the appropriate bundle state (see above).
4. If bundle exists, displays: Verdict (prominent, top), Strengths, Gaps, Requirement
   Coverage table, markdown artifacts (rendered), event timeline.
5. Status selector (sharp rectangle pill) is inline — change writes directly to Firestore.

## Postconditions

- No state changes unless the user takes an action (status change, generate, reassess).

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| No-bundle state shows generate button | `e2e/roles.spec.ts` | `UC-ROLE-004 no bundle state` |
| In-progress state shows analysing indicator | `e2e/roles.spec.ts` | `UC-ROLE-004 in progress state` |
| Bundle displayed after generation completes | `e2e/roles.spec.ts` | `UC-ROLE-004 bundle displayed` |
| Outdated banner shown when CV updated after bundle | `e2e/roles.spec.ts` | `UC-ROLE-004 outdated banner` |
| Verdict is the first prominent element on the page | `e2e/roles.spec.ts` | `UC-ROLE-004 verdict first` |
