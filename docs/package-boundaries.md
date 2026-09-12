# Package boundaries

Internal packages use the `@migrator/*` scope. Apps depend inward. Domain packages must not import `apps/*`.

```
apps/web ──HTTP──► apps/api ──► packages/db, queue, config, shared, docker-manager, ai-core, dependency-graph
apps/worker ──► packages/db, queue, oracle, postgres, ora2pg, validator, docker-manager, config, shared, ai-core, dependency-graph

packages/oracle ──► packages/shared
packages/postgres ──► packages/shared
packages/ora2pg ──► packages/shared
packages/validator ──► packages/shared
packages/dependency-graph ──► packages/shared
packages/docker-manager ──► packages/shared
packages/db ──► packages/shared, config
packages/queue ──► packages/shared, config
packages/config ──► packages/shared
packages/ai-core ──► packages/shared
packages/ai-* ──► packages/ai-core
```

## Allowed responsibilities

| Package | May do | Must not do |
|---------|--------|-------------|
| `shared` | Types, Zod schemas, status enums, scope matching, report scoring | I/O, NestJS, React |
| `config` | Parse env, encrypt/decrypt secrets | Database or HTTP |
| `db` | Schema, migrations, repositories | Oracle driver, AI, Docker |
| `queue` | Queue names, BullMQ connection factory | Business conversion logic |
| `oracle` | Read-only Oracle access + SQL classification + `readTableChunk` / `countTableRows` | Writes, generic SQL, PostgreSQL |
| `postgres` | PostgreSQL connectivity, connection tests, target bulk load, apply target SQL | Oracle access |
| `ora2pg` | Deterministic DDL conversion from extracted Oracle SQL | Oracle sessions, AI |
| `validator` | Compile SQL and run structural/smoke tests against PostgreSQL | Oracle access, marking VALIDATED via AI |
| `docker-manager` | Reused validator-pool slots | One container per object |
| `ai-core` | Provider interface, redaction, prompts, HTTP adapters | Vendor SDKs, marking VALIDATED, credentials in prompts |
| `ai-*` | Thin factories for a provider kind | Migration pipeline, database |
| `dependency-graph` | Topological order, cycle detection, waiting-deps | Oracle/PostgreSQL I/O, marking VALIDATED |
| `api` | HTTP, validation, enqueue, CRUD | Heavy discovery/conversion loops |
| `worker` | Consume jobs, call domain packages | HTTP controllers for product APIs (health only) |
| `web` | UI | Direct database or Oracle drivers |

## Future packages (directories exist; not wired until their phase)

`migration-engine`.
