# Coding guidelines

These guidelines describe the house style for CVAI. Where this document is silent, follow the official guidance for the language or framework in use.

## Source guidance

- Go: follow Effective Go and the Go Code Review Comments.
  - https://go.dev/doc/effective_go
  - https://go.dev/wiki/CodeReviewComments
- TypeScript: follow the TypeScript Handbook.
  - https://www.typescriptlang.org/docs/handbook/intro.html
- React: follow the official React documentation.
  - https://react.dev/learn
- CSS: follow MDN CSS guidance.
  - https://developer.mozilla.org/en-US/docs/Web/CSS

Project-specific docs take precedence when they describe product behavior,
architecture, domain terms, security rules, or UX decisions.

## General style

- Prefer existing project patterns over new abstractions.
- Keep changes scoped to the behavior being implemented.
- Use descriptive names for exported types, public functions, cross-module values, and non-obvious local values.
- Short local names are acceptable for small, idiomatic scopes, such as `r` for an HTTP request or `tx` for a transaction. Prefer fuller names when a value lives across multiple branches or when its role is not immediately clear.
- Avoid cleverness. Code should make the next maintenance step easier.

## Documentation style

- Use sentence case for document headings and prose-style labels unless a proper noun, UI label, or existing external title requires different casing.
- The documents written by the project's original author may use British spelling. Code identifiers, third-party API names, quoted source text, protocol fields, and existing user-facing copy must use American spelling.

## Comments

CVAI should not be comment-free by default. Use comments to reduce the amount of code a reader must parse before understanding the intent. It also helps in quickly identifying whether a piece of code is doing what it should, or saying what it does.

Add a short orienting comment before a block when:

- the block is coordinating multiple operations;
- the code is implementing a policy, security rule, or product workflow;
- the order of operations matters;
- the code is adapting one API shape to another;
- a reader would otherwise need to parse several lines before understanding the goal.

For a block of roughly 3 to 20 lines, a useful comment often answers:

- what the block is trying to achieve;
- why this shape is necessary;
- how it works, when the mechanism is not straightforward.

Avoid comments that merely restate syntax or obvious assignments. Prefer:

```go
// Convert OpenAI strict-schema nulls back into omitted optional fields before
// decoding into the canonical CV domain type.
rawCV, err = llm.NormalizeStructuredOutput(rawCV)
```

over:

```go
// Normalize rawCV.
rawCV, err = llm.NormalizeStructuredOutput(rawCV)
```

## Go

- Use `gofmt` and `go vet`.
- Keep handlers behind repository interfaces; handlers should not hold raw
  Firestore clients.
- Return wrapped errors at package boundaries when context helps diagnosis.
- Do not log prompt content, CV text, job descriptions, tokens, or other sensitive user data.
- Preserve the LLM-backed Action lifecycle: validate preflight inputs before credit deduction; reserve credit by deducting it transactionally; create Action; return immediately; run model work in a goroutine; complete or fail the Action; and refund only for program, provider, persistence, or infrastructure failures, not for errors clearly tied to user input after the paid workflow starts.

## TypeScript and React

- Keep Firebase reads and subscriptions close to the component or hook that owns the UI state.
- Unsubscribe from Firestore listeners on unmount and when terminal Action states are reached.
- Prefer explicit types at module boundaries and for shared domain values.
- Follow `docs/UX.adoc` for product UI decisions.

## Tests

- Add focused tests for behaviour changes.
- Prefer mock or in-process HTTP tests for provider clients; CI must not call real LLM providers.
- E2E tests should reference use-case IDs in their describe names.
- Pure-function utilities in `web/src/lib/` must have Vitest unit tests. The web project has no test runner configured yet; add one before writing the first test.
- LLM golden and eval tests live under `eval/`. They are opt-in (`make test-eval`) and must not block CI, because they may require a live API key or produce non-deterministic output. Fixtures go in `eval/fixtures/`.
- API contract validation between the frontend and backend is schema-based: `schemas/cv.schema.json` is the source of truth. A separate contract test suite is not needed; validate the schema itself at build time rather than duplicating its assertions in tests.

## Before repository-wide edits

Do not perform broad rewrites, naming sweeps, formatting churn, or style-only repository-wide edits without first calling out the scope and getting explicit approval.
