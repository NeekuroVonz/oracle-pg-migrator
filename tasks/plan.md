# Implementation Plan: Phase 1 Foundation

## Overview

Stand up the monorepo, metadata database, Redis/BullMQ, NestJS API and worker, Next.js UI, encrypted connection secrets, and real Oracle/PostgreSQL connection tests with hard read-only Oracle enforcement.

## Architecture Decisions

- Bun workspaces + Turborepo + Biome
- Drizzle + node-postgres for metadata
- NestJS run with Bun watch; `tsc` for typecheck/build
- `OracleReadOnlyClient` with classifier-first SELECT
- AES-256-GCM `SecretCipher`

## Task List

### Phase 1: Foundation

- [x] Task 1: Architecture and security docs
- [x] Task 2: Root toolchain (package.json, turbo, biome, tsconfig, compose, env)
- [x] Task 3: `shared` + `config` (types, Zod, cipher)
- [x] Task 4: `db` schema, migrations, repositories
- [x] Task 5: `oracle` classifier + read-only client + tests
- [x] Task 6: `postgres` + `queue`
- [x] Task 7: NestJS API (CRUD, tests, health)
- [x] Task 8: NestJS worker (boot, Redis ping queue)
- [x] Task 9: Next.js UI (projects + connections, READ ONLY)
- [x] Task 10: Dockerfiles + Compose stack
- [x] Task 11: lint, typecheck, unit tests, build

### Checkpoint: Phase 1 complete

- [x] Monorepo boots; metadata Postgres and Redis work
- [x] API, worker, web boot
- [x] Project and connection CRUD work; secrets encrypted
- [x] Oracle source is hard-enforced READ ONLY
- [x] PostgreSQL connection can be tested
- [x] lint, typecheck, tests, build pass

### Phase 2: Oracle discovery

- [x] Task 12: Discovery types, schema, repositories
- [x] Task 13: `OracleReadOnlyClient` catalog + DDL + dependencies
- [x] Task 14: BullMQ discovery worker
- [x] Task 15: Discovery API + inventory
- [x] Task 16: Discovery UI
- [x] Task 17: lint, typecheck, tests, migrate

### Checkpoint: Phase 2 complete

- [x] Worker discovers inventory through classified SELECT only
- [x] Object definitions hashed for incremental reuse
- [x] Discovery UI lists objects and DDL
- [x] Oracle remains read-only

### Phase 3: Migration scope

- [x] Task 18: Scope types, glob matcher, preview builder
- [x] Task 19: `migration_scopes` table, migration, repository
- [x] Task 20: Scope API (save + selection preview)
- [x] Task 21: Scope UI (include/exclude + preview)
- [x] Task 22: lint, typecheck, tests, migrate

### Checkpoint: Phase 3 complete

- [x] Partial scope is saved as rules, not a one-off object list
- [x] Preview reports Found / Selected / Excluded per object type
- [x] User can inspect included objects before a later migration run
- [x] Data mode is stored (none / selected tables / all selected tables)
- [x] Oracle remains read-only

### Phase 4: Deterministic conversion

- [x] Task 23: Ora2Pg-compatible mapping rules and DDL converter
- [x] Task 24: Optional Ora2Pg CLI file-mode wrapper (never Oracle DSN)
- [x] Task 25: migration_runs / attempts / artifacts + object target SQL
- [x] Task 26: Conversion worker + runs API
- [x] Task 27: Runs UI with Oracle / PostgreSQL side-by-side
- [x] Task 28: lint, typecheck, tests, migrate

### Checkpoint: Phase 4 complete

- [x] Tables, sequences, constraints, indexes, and simple views convert without AI
- [x] Attempts are append-only
- [x] Ora2Pg never opens an Oracle session
- [x] API only enqueues; worker converts
- [x] High-risk syntax is flagged REVIEW_REQUIRED, not guessed

### Phase 5: PostgreSQL compile

- [x] Task 29: `@migrator/validator` compiles generated SQL and captures diagnostics
- [x] Task 30: `@migrator/docker-manager` pre-warmed pool (reused databases, not one container per object)
- [x] Task 31: validation worker + compile status on runs
- [x] Task 32: Validator pool settings UI
- [x] Task 33: lint, typecheck, tests, migrate

### Checkpoint: Phase 5 complete

- [x] Converted SQL is compiled against real PostgreSQL
- [x] Compile failures are stored on append-only validation attempts
- [x] Validator slots are reset and reused
- [x] Oracle remains read-only

### Phase 6: AI convert / fix / verify

- [x] Task 34: `@migrator/ai-core` interface, redaction, versioned JSON prompts
- [x] Task 35: HTTP adapters (no vendor SDKs in migration logic)
- [x] Task 36: encrypted `ai_providers` + CRUD/test API
- [x] Task 37: Worker — FAST/BALANCED/MAXIMUM_ACCURACY AI loop; max 3 fixes; verifier cannot VALIDATED
- [x] Task 38: AI providers UI + run attempt details
- [x] Task 39: lint, typecheck, tests, migrate

### Checkpoint: Phase 6 complete

- [x] Deterministic conversion still runs first
- [x] AI never marks VALIDATED
- [x] Secrets are redacted before prompts
- [x] No provider configured preserves Phase 5 behavior
- [x] Oracle remains read-only

### Phase 7: Structural tests

- [x] Task 40: `@migrator/validator` structural + smoke tests (catalog presence, columns, SELECT LIMIT 0)
- [x] Task 41: `test_attempts` + test status on objects/runs
- [x] Task 42: Validation worker runs tests after compile; VALIDATED only if tests pass
- [x] Task 43: Run UI shows test status and attempt details
- [x] Task 44: lint, typecheck, tests, migrate

### Checkpoint: Phase 7 complete

- [x] Compile success is not VALIDATED
- [x] Tests never talk to Oracle
- [x] AI still cannot mark VALIDATED
- [x] Oracle remains read-only

### Phase 8: Object DAG

- [x] Task 45: `@migrator/dependency-graph` topological order, cycles, waiting deps
- [x] Task 46: Conversion and compile walk the DAG
- [x] Task 47: DAG API + UI (project and run)
- [x] Task 48: lint, typecheck, tests, migrate

### Checkpoint: Phase 8 complete

- [x] Type order is only a tie-breaker
- [x] Out-of-scope prerequisites become WAITING_DEPENDENCY
- [x] Cycles are REVIEW_REQUIRED
- [x] Oracle remains read-only

### Phase 9: Migration report and gate

- [x] Task 49: Weighted readiness scoring + report DTOs (`@migrator/shared`)
- [x] Task 50: `migration_reports` + reporting worker after convert/compile/test
- [x] Task 51: Report GET + DAG-ordered VALIDATED SQL bundle
- [x] Task 52: Report UI (gate, dimensions, blockers, JSON/SQL download)
- [x] Task 53: lint, typecheck, tests, migrate

### Checkpoint: Phase 9 complete

- [x] Readiness is not percent compiled
- [x] Blockers beat a high score
- [x] Compile success is not VALIDATED or READY_FOR_DEPLOYMENT
- [x] Data/performance dimensions omitted until Phase 10
- [x] Oracle remains read-only

### Phase 10: Data copy

- [x] Task 54: Oracle `countTableRows` / `readTableChunk` (classified SELECT only)
- [x] Task 55: PostgreSQL target bulk load + shared copy DTOs / report data score
- [x] Task 56: `data_copy_runs` / `data_copy_tables` + worker `data-copy` job
- [x] Task 57: Data-copy API + UI (status, per-table counts, start, poll)
- [x] Task 58: lint, typecheck, tests, migrate

### Checkpoint: Phase 10 complete

- [x] Data copy is explicit, not automatic after convert
- [x] Oracle remains read-only; no AI on rows
- [x] Copy targets configured PostgreSQL, not the validator pool
- [x] Report data dimension is row-count match; performance still omitted
- [x] Deploy of validated SQL remains a later action

### Phase 11: Deploy to target

- [x] Task 59: Deploy DTOs, `deploy` queue, job ids without colons
- [x] Task 60: `deploy_runs` / `deploy_objects` + worker apply in DAG order
- [x] Task 61: Deploy API + UI (status, per-object errors, start, poll)
- [x] Task 62: lint, typecheck, tests, migrate

### Checkpoint: Phase 11 complete

- [x] Deploy is explicit, not automatic after convert
- [x] Only VALIDATED SQL is applied, in DAG order
- [x] Target is the configured PostgreSQL connection, not the validator pool
- [x] Oracle is not contacted
- [x] Passwords are never returned or logged

| Risk | Impact | Mitigation |
|------|--------|------------|
| No Oracle server in local compose | Med | Classifier unit tests do not need Oracle; connection test uses real driver and fails clearly if unreachable |
| NestJS + Bun watch | Med | Avoid `nest start:dev`; run `bun --watch` |
| oracledb native bits | Low | Thin mode by default |

## Open Questions

None blocking Phase 1. Wizard steps 6–11 wait for later phases.
