# ADR-011: Chunked Oracle → PostgreSQL data copy

## Status

Accepted

## Date

2026-09-11

## Context

DDL conversion, compile, and tests do not move rows. Operators still need a bulk load of selected tables onto the configured PostgreSQL **target**. Row copy must stay separate from conversion, must not use AI, and must keep Oracle read-only. Applying validated DDL to production is a later action (Phase 11).

## Decision

- Data copy is an explicit API action (`POST /api/projects/:id/runs/:runId/data-copy`). It does not start automatically after convert.
- Scope `dataMode` (`NONE` | `SELECTED_TABLES` | `ALL_SELECTED_TABLES`) chooses tables. Only **VALIDATED**, in-scope tables are copied.
- The worker copies into the project **TARGET** PostgreSQL connection, not the validator pool. Tables must already exist there. A missing table fails that table with a clear error.
- Oracle access is `countTableRows` and `readTableChunk` only. Both build classified `SELECT` statements (`COUNT(*)` and `ORDER BY ROWID OFFSET … FETCH NEXT …`). There is no generic execute and no Oracle DML.
- PostgreSQL writes use parameterized multi-row `INSERT`, plus `TRUNCATE` only on the target table when `lastOffset === 0`. Resume skips `SUCCEEDED` tables and continues from `lastOffset`.
- Default chunk size is 1000 (`DATA_COPY_CHUNK_SIZE`, max 5000). Chunks are also capped by a PostgreSQL bind budget (~60k parameters / column count).
- No AI on rows. Passwords are never logged or returned. BullMQ job ids are `data-copy-${copyRunId}` (no colons).
- The report **data** dimension (15%) is Oracle vs PostgreSQL **row-count match** after copy. Performance stays omitted.

## Alternatives considered

- Auto-copy after convert: rejected; data movement is a separate, operator-started step.
- `COPY` from a client-side stream: allowed by earlier docs, but parameterized bulk `INSERT` is enough, testable, and stays inside `@migrator/postgres`.
- Copy into the validator pool: rejected; that pool is for compile/tests and is reset. Production-shaped data belongs on the configured target.
- One job per table: rejected; one resumable run tracks all selected tables.

## Consequences

Operators start copy from the run UI after tables are `VALIDATED`. Failed tables can be retried by starting a new copy (active `QUEUED`/`RUNNING` copies are rejected). Deploying validated SQL to the target remains Phase 11; if the target has no tables yet, copy fails per table instead of creating them.
