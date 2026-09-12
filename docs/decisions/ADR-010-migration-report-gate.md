# ADR-010: Migration report gate

## Status

Accepted

## Date

2026-09-10

## Context

After convert, compile, and tests, operators need a single readiness view. A compile percentage is not enough: blockers can sit next to a high score, compile success is not `VALIDATED`, and deploying SQL is a later action. Data copy and performance samples do not exist until Phase 10.

## Decision

- Readiness is a weighted percentage. Empty dimensions (no samples) are omitted and remaining weights are renormalized.
- Default weights: schema 15%, data 15%, compile 20%, behavior 20%, performance 10%, constraints 15%, sequences 5%. Data and performance stay omitted until Phase 10.
- Gate statuses: `IN_PROGRESS`, `BLOCKED`, `READY_FOR_DEPLOYMENT`.
- Non-deferred `FAILED`, `REVIEW_REQUIRED`, `REDESIGN_REQUIRED`, and `WAITING_DEPENDENCY` objects are blockers. Deferred unsupported types are not.
- A running run stays `IN_PROGRESS`. Any blocker makes the gate `BLOCKED`, even when compile % is high. Compile success is never `VALIDATED` and never `READY_FOR_DEPLOYMENT` by itself.
- Scoring lives in `@migrator/shared`. The worker snapshots `migration_reports` after validation. GET returns the snapshot for finished runs and a live compute otherwise.
- SQL download is VALIDATED `targetSql` in DAG order. No secrets. HTTP polling; no SSE.

## Alternatives considered

- Percent compiled as the score: rejected; it hides blockers and treats compile as validated.
- SSE progress events in this phase: rejected; polling already covers run and report status.

## Consequences

The run UI shows the gate, per-dimension percents, blockers, compile first-attempt vs after-repair, tests, DAG summary, and JSON/SQL downloads. Production deploy of validated SQL remains a later action.
