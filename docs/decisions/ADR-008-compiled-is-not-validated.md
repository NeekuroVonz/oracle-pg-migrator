# ADR-008: Compile is not VALIDATED

## Status

Accepted

## Date

2026-09-10

## Context

Phase 5 used PostgreSQL `CREATE` success as enough to mark an object `VALIDATED` when it was not high-risk. The product rule is **COMPILED ≠ VERIFIED**. Phase 6 already forbade AI from marking `VALIDATED`. Phase 7 adds structural and smoke tests in the validator sandbox after compile.

## Decision

- After compile passes, the object is `TESTING`, not `VALIDATED`.
- Structural checks inspect `pg_catalog` / `information_schema` (table/view/sequence/index/constraint presence, column names, preserved `NOT NULL`).
- Tables and views also run `SELECT * … LIMIT 0`. No Oracle session. No row copy (Phase 10).
- `VALIDATED` requires compile pass **and** tests pass, and still not high-risk / already `REVIEW_REQUIRED`.
- Test failure or an untested object type is `REVIEW_REQUIRED`. Compile status stays `PASSED` when the SQL compiled.

## Alternatives considered

- Keep compile-as-VALIDATED: rejected; mismatches the migration gate.
- Differential Oracle vs PostgreSQL function fixtures: deferred; needs Oracle round-trips and optional fixtures, not the Phase 7 slice.

## Consequences

Append-only `test_attempts` record checks. Run UI shows test status beside compile.
