# Changelog

## Unreleased

- Add a hosted privacy-settings slot without adding hosted-only behavior to the shared application.
- Let `apiFetch` callers select a longer request timeout and accept successful empty response bodies.

## 0.1.0 - 2026-07-19

- Initial decoupled web foundation for CVAI with a modular application shell.
- Exposes the application shell, route registries, structural slots, API client, Firebase helpers, shared components, CV pages, and default branding.
- Keeps hosted-only billing and credit UI out of the shared/OSS surface; commercial API reason codes are passed through for consuming applications to handle.
- Release commit for publishing `@cvai/core-web` through CI after ADR-002 merge.
