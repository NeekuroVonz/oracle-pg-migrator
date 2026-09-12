# ADR-013: PostgreSQL target reconciliation

## Status

Accepted

## Date

2026-09-11

## Context

Converted SQL was compiled in a reset validator sandbox and later applied to TARGET with `CREATE`. That assumed an empty PostgreSQL database. Re-running a migration against an existing target failed or silently risked DROP/CREATE. Operators also change TARGET by hand between runs.

## Decision

- Oracle remains read-only. Inspection uses only the project TARGET PostgreSQL connection.
- Convert requires TARGET to be configured. After rules conversion, the worker inspects the live catalog and compares **normalized structural shapes**, not raw SQL strings.
- Three-way hashes (`previous/current` desired and target) distinguish source change, manual TARGET drift, both changing, and unchanged.
- `SKIP_UNCHANGED` does not recreate the object, does not call AI, and does not apply SQL on deploy.
- Safe diffs produce `UPDATE_REQUIRED` / `REPLACE_REQUIRED` (ALTER or `CREATE OR REPLACE`) and are compiled in the sandbox by cloning the current TARGET shape then applying the plan.
- Destructive, ambiguous, drifted, or conflicting diffs are `REVIEW_REQUIRED` and are never auto-applied.

## Consequences

Repeated conversion runs can skip objects that already match TARGET. Deploy applies `reconcileSql` (CREATE or ALTER), not a blind replay of the original CREATE. Manual TARGET edits after a previous run surface as `TARGET_DRIFTED`.
