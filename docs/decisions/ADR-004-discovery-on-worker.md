# ADR-004: Discovery runs on workers

## Status

Accepted

## Date

2026-09-10

## Context

Oracle discovery can scan thousands of dictionary rows and extract DDL via `DBMS_METADATA.GET_DDL`. The spec forbids the API process from doing heavyweight migration work.

## Decision

- `GET /discovery/schemas` may call `getSchemas()` from the API (one lightweight SELECT, same class as connection tests).
- `POST /discovery` creates a `discovery_runs` row and enqueues a BullMQ `discovery` job.
- The worker opens Oracle sessions, inventories the dictionary, synthesizes index/constraint/PLSQL text from dictionary views, and batches `GET_DDL` for tables/views/sequences.

## Alternatives considered

- Run discovery in the API request: rejected; long requests and no horizontal scale.
- Extract DDL in a second queue: deferred; one session is simpler for Phase 2.

## Consequences

The web UI polls discovery status every 2 seconds while a run is `QUEUED` or `RUNNING`. Incremental reuse skips `GET_DDL` when `LAST_DDL_TIME` and `source_hash` are unchanged.
