# ADR-012: Explicit deploy of validated SQL

## Status

Accepted

## Date

2026-09-11

## Context

Compile and tests run in the validator pool, which is reset. Data copy writes rows to the configured PostgreSQL **target**, but those tables must already exist. Operators need an explicit action that applies validated SQL to the target. Auto-deploy after convert would write to production-shaped databases without a human gate.

## Decision

- Deploy is an explicit API action (`POST /api/projects/:id/runs/:runId/deploy`). It does not start after convert, report, or data copy.
- Only **VALIDATED** objects with a stored reconcile plan (`reconcileSql` or legacy `targetSql`) are applied. `SKIP_UNCHANGED` objects are omitted. Conversion must be finished. The report gate does not have to be `READY_FOR_DEPLOYMENT`; blockers stay undeployed.
- SQL is applied in object DAG order (same as the report SQL bundle). `CREATE SCHEMA IF NOT EXISTS` is already in converted SQL.
- The worker talks only to the project **TARGET** PostgreSQL connection. Oracle is not used. Passwords are never logged or returned.
- Per-object apply splits statements and **stops on the first error** for that object, then continues with later objects. Resume skips `SUCCEEDED` objects. Job id: `deploy-${deployRunId}` (no colons).
- Immediately before apply, the worker re-inspects TARGET. Drift since validation fails that object instead of overwriting.
- DTOs omit the stored SQL body. Operators download SQL from the report.

## Alternatives considered

- Auto-deploy when the gate is `READY_FOR_DEPLOYMENT`: rejected; production writes stay operator-started.
- Require `READY_FOR_DEPLOYMENT` before any deploy: rejected; operators can still apply the validated subset while blockers are reviewed.
- Deploy into the validator pool: rejected; that pool is for compile/tests and is reset.

## Consequences

Typical order is convert → deploy DDL → data copy. Convert inspects the live TARGET catalog first. Deploy applies the stored reconcile plan (`CREATE` or `ALTER`), skips objects that already match, and refuses to overwrite `TARGET_DRIFTED` / `TARGET_CONFLICT`. CDC, cutover, and rollback stay out of scope.
