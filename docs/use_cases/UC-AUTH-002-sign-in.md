# UC-AUTH-002: Sign in

| | |
|---|---|
| **Actor** | User (returning) |
| **Preconditions** | User has an existing CVAI account |
| **Milestone** | M1 |
| **Credit cost** | None |
| **LLM** | No |

## Flow

1. User opens the app or navigates to `/login`.
2. Clicks "Sign in with Google" or "Sign in with GitHub".
3. Firebase Auth completes the OAuth flow and returns a fresh ID token (1 h TTL).
4. The Firebase JS SDK handles silent token refresh automatically thereafter.
5. SPA attaches the token to all backend requests via `Authorization: Bearer <idToken>`.
6. Redirect to `/dashboard` if a CV exists; to `/cv` if not.

The redirect destination is determined by reading `users/{uid}/candidate` — if
`cv.personal` is absent or empty the user has not started their profile and lands on `/cv`.

## Postconditions

- User is authenticated; token in memory.
- User is on `/dashboard` or `/cv` depending on profile state.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Returning user with CV lands on /dashboard | `e2e/auth.spec.ts` | `UC-AUTH-002 signin redirects to dashboard` |
| Returning user without CV lands on /cv | `e2e/auth.spec.ts` | `UC-AUTH-002 signin redirects to cv when no profile` |
| Token is attached to backend requests after sign-in | `e2e/auth.spec.ts` | `UC-AUTH-002 token attached to requests` |
