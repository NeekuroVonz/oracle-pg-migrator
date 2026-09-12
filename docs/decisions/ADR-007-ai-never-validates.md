# ADR-007: AI never marks VALIDATED

## Status

Accepted

## Date

2026-09-10

## Context

Phase 6 adds optional AI convert, fix, and verify. Operators may want the model to “sign off” on generated SQL. The compiler already exists and is the only check that the SQL is PostgreSQL.

## Decision

- PostgreSQL compile is the technical judge of SQL. `VALIDATED` also requires structural tests (see [ADR-008](./ADR-008-compiled-is-not-validated.md)). AI still cannot mark `VALIDATED`.
- The verifier may only force `REVIEW_REQUIRED` (or leave the compiler’s status unchanged). It has no `VALIDATED` output.
- After at most three AI fix attempts, remaining compile failures become `REVIEW_REQUIRED`.
- Prompts are versioned JSON contracts. Credentials never enter prompts; adapters live behind `@migrator/ai-core`.
- Migration logic must not import a vendor SDK.

## Alternatives considered

- Let a verifier mark `VALIDATED` when compile already passed: rejected; a model cannot be the judge.
- Call AI on every object in FAST: rejected; FAST is rules → compile, with AI only on failure or high-risk when a provider is configured.

## Consequences

Settings store encrypted API keys (`hasApiKey` in APIs). No provider configured means Phase 5 behavior unchanged.
