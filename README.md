# CVAI

[![CI](https://github.com/mnohe/cvai/actions/workflows/ci.yml/badge.svg)](https://github.com/mnohe/cvai/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mnohe/cvai/branch/main/graph/badge.svg)](https://codecov.io/gh/mnohe/cvai)
[![Go Report Card](https://goreportcard.com/badge/github.com/mnohe/cvai/functions)](https://goreportcard.com/report/github.com/mnohe/cvai/functions)

CVAI is an AI-assisted job application management system. It helps a job seeker build a structured CV, track roles, generate role-specific analysis and application bundles, manage gap tasks, and keep application work in one focused workspace.

The hosted product is available at https://cvirgil.com/.

## What It Does

- Maintains a structured candidate profile and CV.
- Tracks job roles and application status.
- Assesses fit between a candidate profile and a role.
- Produces application-supporting artefacts such as suitability analysis and role matrices.
- Turns gaps into actionable tasks.
- Supports a structured evidence library for stronger applications; story capture is deferred pending a compelling use case and accepted privacy design.

## Stack

- Frontend: Vite, React 19, TypeScript, Tailwind, React Router, Firebase JS SDK
- Backend: Go HTTP service
- Auth and data: Firebase Auth and Firestore
- AI: OpenAI API
- Billing: Stripe Checkout

## Repository Layout

```text
functions/              Go backend service
  cmd/                  HTTP entry points
  internal/domain/      Domain types, enums, validation
web/                    Vite React SPA
  src/                  App, components, pages, client libraries
  e2e/                  Playwright end-to-end tests
schemas/                JSON schemas copied from the legacy reference
docs/                   Architecture, UX, domain, and use-case docs
firebase.json           Firebase hosting, rules, and emulator config
firestore.rules         Firestore Security Rules
Makefile                Common contributor commands
```

## Design And Product References

- [Architecture](docs/ARCHITECTURE.md)
- [Domain model](docs/DOMAIN.md)
- [UX strategy](docs/UX.adoc)
- [Coding guidelines](docs/CODING_GUIDELINES.md)
- [Use cases](docs/use_cases/index.md)

For contributor setup and local development commands, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Local Runtime Ports

For local web development, Firebase Auth runs on `9099`, Firestore runs on
`8080`, and the Go API should run on `8081`:

```bash
make emulate
make dev-api
make dev-web
```

The web app proxies `/api/*` to `http://127.0.0.1:8081`. If Firebase is not
reachable, the app shows a critical error page. If only the API is down, the app
shows a sidebar `Status` section that clears when `/api/healthz` responds.
