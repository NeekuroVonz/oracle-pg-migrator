# ADR-009: Convert and compile from the object DAG

## Status

Accepted

## Date

2026-09-10

## Context

Discovery already stores `object_dependencies` from Oracle `ALL_DEPENDENCIES`. Conversion and compile used a fixed type order (sequence, table, index, view) and a two-pass compile. That misses view→table edges, out-of-scope blockers, and cycles.

## Decision

- `@migrator/dependency-graph` builds a DAG for the in-scope object set.
- Edge direction: dependent → prerequisite (`from` needs `to` first).
- Conversion and compile walk topological layers. Type rank is only a tie-breaker.
- A prerequisite outside the saved scope, or in-scope but deferred this run, sets the dependent to `WAITING_DEPENDENCY`. Those objects are not compiled and cannot become `VALIDATED`.
- Directed cycles are listed and force `REVIEW_REQUIRED` after a successful convert.

## Alternatives considered

- Type order only: rejected; it ignores real catalog edges.
- Fail the whole run on a cycle: rejected; operators still need converted SQL for review.

## Consequences

Run and project UIs expose the DAG. Oracle stays read-only; the graph is computed from already-discovered metadata.
