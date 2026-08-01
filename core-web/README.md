# @cvai/core-web

Shared React web foundation for CVAI applications.

Consumers import the package API and provide their own routes before mounting
`AppShell`. Branding is resolved through a consumer-side `@branding` Vite alias.

Required consumer aliases:

- `@` -> the package source entry resolved by the consuming build
- `@branding` -> the consuming app's branding module
- `@cvai/core-web` -> `@cvai/core-web/src/index.ts`
- `@cvai/core-web/styles.css` -> `@cvai/core-web/src/index.css`

Release flow:

1. Update `version` and `CHANGELOG.md`.
2. Commit with subject `release(core-web): X.Y.Z`.
3. Merge the release commit to the default branch.
4. Let the GitHub Actions `publish-core-web` job publish `@cvai/core-web` to npm.
5. Update consuming apps to the published semver version and refresh their lockfiles.

## Runtime Failure UI

`AuthProvider` blocks application rendering with a critical error page when
Firebase cannot initialize or, in emulator mode, the Auth/Firestore emulators
are unreachable. This is intentionally fatal because the router and Firestore
listeners cannot behave correctly without Firebase.

`AuthProvider` performs one startup emulator reachability check in local
development and then rechecks once per minute, so a vanished emulator still
turns into an explicit fatal page without noisy polling.

`apiFetch` reports backend connectivity failures separately. When the API is
not responding, `RuntimeStatusProvider` exposes a non-dismissible account-panel
`Status` section and polls `/api/healthz` every 10 seconds until the backend
responds again. The status clears automatically on the first healthy
`/api/healthz` response. Backend service calls time out after 15 seconds and
raise the same outage signal.

Callers for deliberately long-running operations may pass `timeoutMs` in the
`apiFetch` options. Account export and deletion use this because their backend
deadlines intentionally exceed the general 15-second request limit.
Successful empty response bodies, including the account-deletion endpoint's
`200 OK`, resolve as `undefined`.

Import start failures that happen before an Action document exists display a
copyable `import-start-*` support reference so users still have an error ID.

## API Failure Reasons

`ApiError.reason` is the stable API-visible discriminator used by host apps to
override generic failure copy. The currently produced hosted-app reason is
`insufficient_credits`, emitted by the CV import start endpoint when the
commercial account cannot authorise the action.

`llm_disabled`, `llm_unavailable`, and `rate_limited` are forward-declared for
future synchronous AI action gates. Today's CV import LLM failures are reported
asynchronously through Action documents and observability attributes rather than
through the import-start HTTP response body. Any future producer must emit these
exact `ApiFailureReason` strings in the JSON `reason` or `code` field.
