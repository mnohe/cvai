# UC-ACCOUNT-001: Delete account

| | |
|---|---|
| **Actor** | User |
| **Status** | Hosted extension; not implemented by CVAI |
| **Milestone** | M1 hosted product |
| **Credit cost** | None |
| **LLM** | No |

## Open-core boundary

CVAI does not provide an account-deletion endpoint, UI flow, deletion tombstone,
or Firebase Auth administration. A self-hosting operator owns account lifecycle
and data-retention procedures for their deployment. CVAI must not claim a
particular cascade, confirmation-token protocol, audit schema, or end-to-end test
until such a capability is deliberately designed and implemented in this
repository.

The hosted CVirgil product implements its own deletion workflow in the companion
`cvirgil` repository. Its canonical specification is
`docs/use_cases/UC-ACCOUNT-001-delete-account.md` in that repository. At the time
this boundary note was reconciled, CVirgil uses one recently authenticated
`DELETE /account` request and a non-PII write barrier at
`_admin/deleted_accounts/records/{uid}` with fields `deleted_at` and `reason`.
Those details describe CVirgil, not an API or storage contract exported by CVAI.

## CVAI acceptance

- CVAI documentation does not advertise an unimplemented deletion endpoint or
  confirmation-token exchange.
- CVAI architecture does not reserve a malformed or hosted-only tombstone path.
- Any future open-core deletion capability requires its own design, security
  review, implementation, and executable tests before this use case can become
  active.

## E2E scenarios

None in CVAI. Hosted deletion scenarios belong to CVirgil and are verified there.
