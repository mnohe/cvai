# UC-ACCOUNT-001: Delete account

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; re-authenticated within the last 5 minutes |
| **Milestone** | M1 |
| **Credit cost** | None |
| **LLM** | No |

## Context

Account deletion is irreversible. All user data is erased from Firestore, Cloud Storage,
and Firebase Auth. A PII-free tombstone is written to `_admin/deleted_accounts/{uid}`
for audit purposes.

Re-authentication is required both client-side (Firebase `reauthenticateWithPopup`) and
server-side (`RequireRecentAuth(300)` — token `auth_time` must be within 5 minutes).
Both checks are enforced independently.

## Flow

```mermaid
sequenceDiagram
    actor User
    participant SPA
    participant Firebase Auth
    participant Backend
    participant Firestore
    participant Cloud Storage

    User->>SPA: Click "Delete account" in account settings
    SPA-->>User: Confirmation modal
    User->>SPA: Confirm deletion
    SPA->>Firebase Auth: reauthenticateWithPopup(provider)
    Firebase Auth-->>SPA: Fresh token (auth_time ≤ 5 min ago)
    SPA->>Backend: DELETE /account (Authorization: Bearer <fresh token>)
    Backend->>Backend: RequireRecentAuth(300) — verify auth_time claim
    Backend-->>SPA: 202 {confirmToken} (short-lived, single-use)
    SPA-->>User: Show confirmation code; prompt to re-enter
    User->>SPA: Type confirmation code
    SPA->>Backend: DELETE /account (X-Confirm-Token: <confirmToken>)
    Backend->>Firestore: Delete all subcollections under users/{uid}/
    Backend->>Cloud Storage: Delete all objects under users/{uid}/
    Backend->>Firebase Auth: Delete auth record for uid
    Backend->>Firestore: Write _admin/deleted_accounts/{uid} {deletedAt, reason: user_request}
    Backend-->>SPA: 200
    SPA->>Firebase Auth: signOut()
    SPA-->>User: Redirect to landing page
```

## Postconditions

- All Firestore data under `users/{uid}/` deleted.
- All Cloud Storage objects under `users/{uid}/` deleted.
- Firebase Auth record deleted.
- PII-free tombstone at `_admin/deleted_accounts/{uid}`.
- User is signed out and on the landing page.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Delete account cascade deletes all user data | `e2e/account.spec.ts` | `UC-ACCOUNT-001 cascade delete` |
| Old auth_time token rejected by backend | `e2e/account.spec.ts` | `UC-ACCOUNT-001 stale token rejected` |
| Invalid confirm token rejected | `e2e/account.spec.ts` | `UC-ACCOUNT-001 invalid confirm token rejected` |
| Tombstone written with no PII | `e2e/account.spec.ts` | `UC-ACCOUNT-001 tombstone written` |
| Post-deletion redirect to landing page | `e2e/account.spec.ts` | `UC-ACCOUNT-001 redirect after delete` |
