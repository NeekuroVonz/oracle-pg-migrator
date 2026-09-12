# Migration pipeline

Implemented across phases 2–11. Phase 1 only stores projects and connections.

```
DISCOVER → SELECT SCOPE → BUILD DAG → EXTRACT → CLASSIFY → FAST CONVERT
  → POSTGRES COMPILE
      PASS → TEST → VERIFY → VALIDATED
      FAIL → AI CONVERT/FIX → COMPILE → TEST → VERIFY → VALIDATED | REVIEW_REQUIRED
```

The PostgreSQL compiler/runtime is the primary judge. Compile success is not `VALIDATED`. AI never marks an object `VALIDATED` by itself. Conversion and compile follow the object DAG from discovered Oracle dependencies. After tests, a weighted migration report sets `READY_FOR_DEPLOYMENT` or `BLOCKED`. High compile % does not hide blockers. Data copy is a separate, explicit step (Phase 10). Applying validated SQL to the target is a separate, explicit step (Phase 11).

## Strategies

| Strategy | Flow |
|----------|------|
| `FAST` (default) | Deterministic convert → compile → tests → AI only if required |
| `BALANCED` | Deterministic → inspect high-risk → compile → tests → optional AI verify |
| `MAXIMUM_ACCURACY` | Deterministic → AI convert → compile → tests → separate AI verifier |

## Object statuses

`DISCOVERED`, `EXCLUDED`, `WAITING_DEPENDENCY`, `QUEUED`, `EXTRACTING`, `EXTRACTED`, `CLASSIFYING`, `CONVERTING_RULE`, `CONVERTING_AI`, `COMPILING`, `TESTING`, `VERIFYING`, `RETRYING`, `VALIDATED`, `REVIEW_REQUIRED`, `REDESIGN_REQUIRED`, `FAILED`.

## Data copy

Separate from DDL conversion. Operators start it; it does not run automatically after convert.

- Scope `dataMode` selects tables (`NONE` copies nothing). Only `VALIDATED` in-scope tables are included.
- Worker job on the `data-copy` queue. Job id: `data-copy-${copyRunId}` (no colons).
- Oracle: classified `SELECT COUNT(*)` and chunked `SELECT … ORDER BY ROWID OFFSET n FETCH NEXT k`. No AI on rows.
- PostgreSQL **target** (not the validator pool): `TRUNCATE` when resuming from offset 0, then parameterized bulk `INSERT`. Missing tables fail that table.
- Default chunk size 1000 (env `DATA_COPY_CHUNK_SIZE`, max 5000), also capped by bind budget.
- Resume skips `SUCCEEDED` tables and continues from `lastOffset`.
- Report **data** score is Oracle vs PostgreSQL row-count match. Performance stays omitted.

See [ADR-011](./decisions/ADR-011-data-copy.md).

## Deploy

Separate from convert, report, and data copy. Operators start it.

- Worker job on the `deploy` queue. Job id: `deploy-${deployRunId}` (no colons).
- Only `VALIDATED` objects with `targetSql`. Conversion must be finished. Oracle is not contacted.
- SQL is applied to the PostgreSQL **target** in DAG order. Per object, statements stop on the first error.
- Gate `READY_FOR_DEPLOYMENT` is not required; blockers are simply not deployed.
- Typical order: convert → deploy DDL → data copy.

See [ADR-012](./decisions/ADR-012-deploy.md).
