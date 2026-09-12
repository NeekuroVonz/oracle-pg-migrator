# TODO

## Phase 1

- [x] Root monorepo toolchain
- [x] packages/shared
- [x] packages/config
- [x] packages/db
- [x] packages/oracle (classifier + client + tests)
- [x] packages/postgres
- [x] packages/queue
- [x] apps/api
- [x] apps/worker
- [x] apps/web
- [x] Docker Compose
- [x] lint / typecheck / test / build

## Phase 2

- [x] Discovery schema + repositories
- [x] Oracle catalog / DDL / dependencies
- [x] Discovery worker
- [x] Discovery API + UI
- [x] lint / typecheck / test / migrate

## Phase 3

- [x] Scope matcher + Zod contracts
- [x] migration_scopes schema + repository
- [x] Scope API + preview
- [x] Scope UI
- [x] lint / typecheck / test / migrate

## Phase 4

- [x] Mapping rules + DDL converter
- [x] Ora2Pg CLI file-mode wrapper
- [x] conversion tables + repositories
- [x] Worker + runs API
- [x] Runs UI
- [x] lint / typecheck / test / migrate

## Phase 5

- [x] PostgreSQL compile validator
- [x] Reused validator pool (docker-manager)
- [x] Validation worker + compile results
- [x] Validator pool UI
- [x] lint / typecheck / test / migrate

## Phase 6

- [x] AI provider interface, redaction, versioned prompts
- [x] HTTP adapters (OpenAI, Anthropic, Gemini, Cursor, OpenAI-compatible)
- [x] Encrypted `ai_providers` + settings API/UI
- [x] Worker AI convert / fix / verify (compiler still judges VALIDATED)
- [x] lint / typecheck / test / migrate

## Phase 7

- [x] Structural + smoke tests in the validator sandbox
- [x] test_attempts + test status
- [x] VALIDATED only after compile and tests pass
- [x] Run UI test column
- [x] lint / typecheck / test / migrate

## Phase 8

- [x] Object DAG from discovered dependencies
- [x] Convert/compile in topological order
- [x] WAITING_DEPENDENCY + cycle review
- [x] DAG UI
- [x] lint / typecheck / test / migrate

## Phase 9

- [x] Weighted readiness + gate statuses in `@migrator/shared`
- [x] `migration_reports` snapshot + reporting worker
- [x] Report API + DAG-ordered SQL bundle
- [x] Report UI (gate, dimensions, blockers, downloads)
- [x] lint / typecheck / test / migrate

## Phase 10

- [x] Oracle classified table count / chunk SELECT
- [x] PostgreSQL target bulk insert + truncate-on-resume
- [x] data_copy_runs / data_copy_tables + data-copy worker
- [x] Data-copy API + UI
- [x] lint / typecheck / test / migrate

## Phase 11

- [x] Explicit deploy of VALIDATED SQL to the PostgreSQL target
- [x] DAG order, per-object status, resume succeeded objects
- [x] deploy_runs / deploy_objects + deploy worker
- [x] Deploy API + UI
- [x] lint / typecheck / test / migrate
