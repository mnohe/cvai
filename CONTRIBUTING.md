# Contributing

Thanks for helping build CVAI. This document describes the supported local workflow for contributing to the project.

## Ground Rules

- Read the relevant docs before editing behavior: `docs/ARCHITECTURE.md`, `docs/DOMAIN.md`, `docs/UX.adoc`, and the use cases under `docs/use_cases/`.
- Keep changes scoped to the issue or feature at hand.
- Do not rewrite unrelated files or revert work you did not make.
- Prefer existing project patterns over new abstractions.
- Keep generated outputs out of commits unless they are intentionally part of the source tree.

## Prerequisites

- Go 1.23+
- Node.js 22+
- npm
- Firebase CLI
- Java 21+ for Firebase emulators
- Playwright browser binaries

Install the Playwright browser used by the E2E suite:

```bash
cd web
npx playwright install chromium
```

## Local Setup

Install frontend dependencies:

```bash
cd web
npm install
```

Create a local frontend environment file:

```bash
cp web/.env.example web/.env.local
```

Keep `VITE_USE_EMULATOR=true` for development.

Prepare Go dependencies:

```bash
make setup
```

## Running The App For Development

Start Firebase emulators from the repository root:

```bash
make emulate
```

Start the web app in another terminal:

```bash
make dev-web
```

Open the Vite URL printed by that command, usually `http://localhost:5173/`.
Do not use the Firebase Hosting emulator URL for day-to-day frontend development;
Vite is the supported contributor path because it injects `web/.env.local` values
such as `VITE_USE_EMULATOR=true`.

When signing in locally, the Firebase Auth Emulator shows a fake provider flow.
Use any test identity there; it is not a real Google or GitHub OAuth login.

Start the Go service in another terminal when working on backend routes:

```bash
cd functions
go run ./cmd/...
```

## Verification

Run the checks that match your change:

```bash
make lint
make test-functions
make build-web
make test-e2e
```

For frontend-only changes, at minimum run:

```bash
cd web
npm run build
npm run test:e2e
```

`make test-e2e` expects the needed emulators and web server to be available. When in doubt, run `make emulate` first and keep it open while running tests.

## Branch And Commit Hygiene

- Use small, reviewable commits.
- Include tests or a clear reason when tests are not practical.
- Mention the use case or user-facing behavior in the commit message when relevant.
- Be careful to not commit local secrets, `.env.local`, emulator data, Playwright reports, or build outputs.

## Frontend Guidelines

- Follow the CVAI design system in `docs/UX.adoc`.
- No rounded UI by default; use the project shape language for diamonds, rhombuses, and `ThinkButton`.
- Use real product screens as the first view, not marketing pages.
- Keep placeholder routes usable inside the real shell.
- Firebase client configuration must come from `VITE_FIREBASE_*` environment variables.
- Local auth should work with `VITE_USE_EMULATOR=true`.

## Backend Guidelines

- Keep handler code behind the auth middleware unless a route is intentionally public.
- Use repository interfaces for Firestore access; handlers should not hold raw Firestore clients.
- Store enums as strings, not numeric values.
- For LLM-backed work, follow the async Action lifecycle described in `docs/ARCHITECTURE.md`.
- Never block an HTTP handler on an LLM request.

## Type Changes

Domain types are duplicated intentionally:

- Go: `functions/internal/domain/`
- TypeScript: `web/src/lib/types.ts`

When a domain type or enum changes, update both sides in the same change.

## Security And Privacy

- Treat user CVs, account data, role history, and evidence library content as sensitive.
- Do not log raw CV content, job application details, tokens, or billing identifiers unless the log is explicitly designed for that purpose.
- Firestore Security Rules must deny cross-user reads and writes.
- Use recent-auth checks for destructive account actions.

## Review Checklist

Before asking for review, confirm:

- The app builds.
- Relevant unit or E2E tests pass.
- New user-facing behavior matches the UX document.
- Authenticated requests attach an ID token where required.
- Firestore paths and Security Rules agree.
- Contributor docs are updated when setup or development workflow changes.
