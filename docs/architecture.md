# Architecture — Oracle PostgreSQL Migration Control Plane

This control plane manages Oracle → PostgreSQL migrations. It is not a SQL syntax converter. It discovers Oracle objects, lets operators choose a partial scope, converts with deterministic rules first, compiles against real PostgreSQL, and only then optionally uses AI.

## Hard rule: Oracle is read-only

```yaml
source:
  engine: oracle
  accessMode: READ_ONLY
  allowWrite: false
```

`allowWrite` is stored internally and is never a user-configurable option. The only Oracle client in this repository is `OracleReadOnlyClient`. It has no generic `execute()`. Compilation, retries, DDL, and destructive work happen only in PostgreSQL sandboxes or an explicitly configured PostgreSQL target.

See [security.md](./security.md).

## Runtime topology

```
┌─────────────┐     REST            ┌──────────────┐
│  apps/web   │ ──────────────────► │   apps/api   │
│  Next.js    │                     │   NestJS     │
└─────────────┘                     └──────┬───────┘
                                           │
                          enqueue jobs     │  metadata SQL
                                           ▼
                                    ┌──────────────┐
                                    │   Redis      │
                                    │   BullMQ     │
                                    └──────┬───────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │ apps/worker  │
                                    │ NestJS       │
                                    └──────┬───────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
     Oracle READ ONLY              metadata PostgreSQL          PG validator pool
     (node-oracledb Thin)          (application state)          (pre-warmed DBs)
```

The API process never runs heavyweight migration work. Workers do.

## Monorepo

| Path | Role | Phase |
|------|------|-------|
| `apps/web` | Next.js App Router UI | 1–11 |
| `apps/api` | NestJS REST | 1–11 |
| `apps/worker` | NestJS BullMQ consumers | 1–11 |
| `packages/shared` | Domain types, Zod contracts, statuses, scope matcher, report scoring | 1–11 |
| `packages/config` | Env loading, secret cipher | 1 |
| `packages/db` | Drizzle schema, repositories, migrations | 1–11 |
| `packages/queue` | BullMQ queue names and factories | 1–11 |
| `packages/oracle` | `OracleReadOnlyClient` + classifier + discovery + table chunks | 1–2, 10 |
| `packages/postgres` | PostgreSQL connection test, target bulk load, target deploy | 1, 10–11 |
| `packages/ora2pg` | Deterministic conversion wrapper | 4 |
| `packages/migration-engine` | Pipeline orchestration | 4–8 |
| `packages/dependency-graph` | Object DAG | 8 |
| `packages/validator` | Compile / structural / behavioral checks | 5–7 |
| `packages/docker-manager` | Pre-warmed PostgreSQL validator pool | 5 |
| `packages/ai-core` | Provider interface + redaction | 6 |
| `packages/ai-*` | Provider adapters | 6 |
| `prompts/` | Converter / fixer / verifier prompts | 6 |
| `infra/docker-compose.yml` | Local metadata Postgres, Redis, apps | 1 |

Workspace protocol: `@migrator/*` via Bun `workspace:*`.

## Phase 1 services (no giant MigrationService)

- `ProjectsService` — project CRUD
- `ConnectionsService` — connection CRUD, password encryption, tests
- `AuditService` — append-only audit events (never passwords)
- `OracleReadOnlyService` — wraps `OracleReadOnlyClient`
- `PostgresConnectionService` — target connection tests
- `HealthService` — API/worker/Postgres/Redis readiness

Later phases add Extraction, Conversion, Validation, Retry, Report, DataCopy, Deploy, and `AIProviderRegistry` as separate modules. `ScopeService` (Phase 3) evaluates saved include/exclude rules against discovered inventory; it does not talk to Oracle. `DataCopyService` (Phase 10) enqueues chunked row copy; the worker talks to Oracle read-only and the PostgreSQL target. `DeployService` (Phase 11) enqueues DAG-ordered VALIDATED reconcile SQL (`CREATE` or `ALTER`) onto the PostgreSQL target after inspecting the live catalog; it never talks to Oracle.

## Metadata data model (Phase 2–3)

Normalized PostgreSQL tables in `packages/db`:

- `projects`
- `database_connections` — encrypted password ciphertext; never returned by APIs
- `audit_logs`
- `discovery_runs`
- `discovered_objects` — inventory + extracted DDL/source hash
- `object_dependencies` — edges where both ends were discovered
- `migration_scopes` — one saved rule set per project (schemas, types, globs, exact exclusions, data mode)
- `migration_runs` / `conversion_attempts` / `validation_attempts` / `test_attempts` — append-only conversion, compile, and test history
- `migration_reports` — per-run gate snapshot (readiness payload; no secrets)
- `data_copy_runs` / `data_copy_tables` — chunked, resumable Oracle → target PostgreSQL row copy
- `deploy_runs` / `deploy_objects` — explicit DAG-ordered apply of VALIDATED SQL to the PostgreSQL target
- `ai_providers` — encrypted API keys, roles (convert/fix/verify); APIs return `hasApiKey` never the key

Phase 1 services remain. Phase 2 adds `DiscoveryService` on the API (enqueue + inventory reads) and a BullMQ `discovery` worker that calls `OracleReadOnlyClient.discoverInventory()`. Phase 3 adds `ScopeService`: save rules and compute a Found / Selected / Excluded preview against the current catalog. Matching lives in `@migrator/shared` so conversion can reuse it. Phase 4 converts extracted DDL with Ora2Pg-compatible rules (never an Oracle DSN). Phase 5 compiles generated SQL against a reused validator-pool slot. Phase 6 optionally calls AI to convert (MAXIMUM_ACCURACY), fix compile failures (max 3), and verify; AI cannot mark `VALIDATED`. Phase 7 runs structural and smoke tests after compile; `VALIDATED` requires compile **and** tests. Phase 8 orders conversion and compile from the discovered object DAG; out-of-scope prerequisites are `WAITING_DEPENDENCY` and cycles are `REVIEW_REQUIRED`. Phase 9 snapshots a weighted migration report and gate (`READY_FOR_DEPLOYMENT` or `BLOCKED`); compile % is not the score. Phase 10 copies selected `VALIDATED` tables to the configured PostgreSQL target in chunks (`data-copy` queue); the report data dimension is row-count match. No AI on rows. Phase 11 applies VALIDATED SQL to that target (`deploy` queue) in DAG order. Deploy is never automatic.

See [ADR-005](./decisions/ADR-005-scope-rules.md), [ADR-007](./decisions/ADR-007-ai-never-validates.md), [ADR-008](./decisions/ADR-008-compiled-is-not-validated.md), [ADR-009](./decisions/ADR-009-object-dag.md), [ADR-010](./decisions/ADR-010-migration-report-gate.md), [ADR-011](./decisions/ADR-011-data-copy.md), and [ADR-012](./decisions/ADR-012-deploy.md).

## Target modes

1. Existing PostgreSQL (configured connection; SQL is applied only by an explicit Phase 11 deploy)
2. Temporary Docker validator pool (Phase 5) — pre-warmed PostgreSQL databases on `validator-postgres`, reset after each run

Default pipeline outcome is `READY_FOR_DEPLOYMENT`. Deploying validated SQL to the configured target is an explicit operator action.

## Conversion strategy (later phases)

Default: `FAST` (Ora2Pg / rules → PostgreSQL compile → structural tests → AI fix only on compile failure when a provider is configured). `BALANCED` adds AI verify on high-risk. `MAXIMUM_ACCURACY` adds AI convert then a separate verifier. Compile success is not `VALIDATED`. AI output is structured JSON, never free-text pipeline control.

## Real-time progress

HTTP polling on run and report GETs. SSE (`migration.started`, `object.*`, `migration.completed`) can be added later behind the same event types. WebSocket can share those types. Phase 9 does not add SSE.

## Decisions recorded

- [ADR-001](./decisions/ADR-001-stack.md) — stack choices
- [ADR-002](./decisions/ADR-002-oracle-readonly.md) — Oracle access
- [ADR-003](./decisions/ADR-003-secrets.md) — secret storage
- [ADR-004](./decisions/ADR-004-discovery-on-worker.md) — discovery jobs
- [ADR-005](./decisions/ADR-005-scope-rules.md) — migration scope rules
- [ADR-006](./decisions/ADR-006-ora2pg-file-mode.md) — Ora2Pg file mode
- [ADR-007](./decisions/ADR-007-ai-never-validates.md) — AI never marks VALIDATED
- [ADR-008](./decisions/ADR-008-compiled-is-not-validated.md) — compile is not VALIDATED
- [ADR-009](./decisions/ADR-009-object-dag.md) — convert/compile from the object DAG
- [ADR-010](./decisions/ADR-010-migration-report-gate.md) — weighted report gate
- [ADR-011](./decisions/ADR-011-data-copy.md) — chunked data copy, no AI on rows
- [ADR-012](./decisions/ADR-012-deploy.md) — explicit deploy of validated SQL
