# UC-AUTH-001: Sign up

| | |
|---|---|
| **Actor** | User (new) |
| **Preconditions** | No CVAI account exists for this identity |
| **Milestone** | M1 |
| **Credit cost** | None |
| **LLM** | No |

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Firebase Auth
    participant Backend
    participant Firestore

    User->>SPA: Open app, click "Sign in with Google" or "Sign in with GitHub"
    SPA->>Firebase Auth: signInWithPopup(provider)
    Firebase Auth-->>SPA: UserCredential (idToken, uid, displayName, email)
    SPA->>SPA: Store token in memory; attach to all subsequent requests
    SPA->>Backend: Any authenticated request (e.g. GET /account)
    Backend->>Firestore: Create users/{uid}/account {credits: 0} if absent
    Backend->>Firestore: Create users/{uid}/candidate {} if absent
    SPA-->>User: Redirect to /cv (empty state)
```

Account and candidate documents are created lazily on first authenticated backend call,
not as a separate signup step. The SPA navigates to `/cv` on first sign-in so the user
immediately encounters the profile completion flow.

## Postconditions

- Firebase Auth record exists for the uid.
- `users/{uid}/account` exists with `credit_balance: 0`.
- `users/{uid}/candidate` exists (empty).
- User is on `/cv` (empty state — see [UC-CV-001](UC-CV-001-cv-page-entry.md)).

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Sign up with Google creates account and candidate documents | `e2e/auth.spec.ts` | `UC-AUTH-001 google signup creates documents` |
| Post-signup redirect lands on /cv empty state | `e2e/auth.spec.ts` | `UC-AUTH-001 redirect to cv after signup` |
| Unauthenticated navigation to /cv redirects to /login | `e2e/auth.spec.ts` | `UC-AUTH-001 unauthenticated redirect` |
