# UC-AUTH-003: Sign out

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in |
| **Milestone** | M1 |
| **External request** | None |
| **LLM** | No |

## Flow

1. User clicks **Sign out** from the account panel (opened from the sidebar footer on
   desktop, or from the avatar diamond in the top nav on mobile).
2. SPA calls `firebase.auth().signOut()`.
3. ID token is cleared from memory. No further backend requests can succeed.
4. SPA redirects to `/login`.

## Postconditions

- No auth token in memory.
- User is on `/login`.
- All Firestore `onSnapshot` subscriptions are unsubscribed.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Sign out clears auth and redirects to /login | `e2e/auth.spec.ts` | `UC-AUTH-003 signout redirects to login` |
| Post-signout navigation to /dashboard redirects to /login | `e2e/auth.spec.ts` | `UC-AUTH-003 protected routes inaccessible after signout` |
