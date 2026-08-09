# Changelog

## Unreleased

## 0.1.3 - 2026-08-09

- Gate CV-import file selection behind a first-use AI disclosure and retain only a
  versioned, operation-specific browser acknowledgement.
- Keep the disclosure summary available on repeat use and invalidate acknowledgements
  when its provider, retention reference, data categories, alternative, or version changes.

## 0.1.2 - 2026-08-07

- Add registry-backed, provider-configurable just-in-time LLM disclosure contracts and a reusable confirmation component.

## 0.1.1 - 2026-08-03

- Add a hosted privacy-settings slot without adding hosted-only behavior to the shared application.
- Let `apiFetch` callers select a longer request timeout and accept successful empty response bodies.
- Document registry verification before consumers update their immutable package pin.

## 0.1.0 - 2026-07-19

- Initial decoupled web foundation for CVAI with a modular application shell.
- Exposes the application shell, route registries, structural slots, API client, Firebase helpers, shared components, CV pages, and default branding.
- Keeps hosted-only billing and credit UI out of the shared/OSS surface; commercial API reason codes are passed through for consuming applications to handle.
- Release commit for publishing `@cvai/core-web` through CI after ADR-002 merge.
