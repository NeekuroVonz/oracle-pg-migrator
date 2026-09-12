# Agent notes

## Stack

Bun workspaces, Turborepo, NestJS API/worker (run with `bun --watch`), Next.js App Router, Drizzle + `pg`, BullMQ, Biome.

## Invariants

- Oracle is read-only. Only `packages/oracle` may talk to Oracle. No generic `execute()`.
- Never return or log database passwords.
- API does not run heavyweight migration work.
- Do not call AI for deterministic conversion.
- Validator pool slots are reused. Never start one PostgreSQL container per object.
- AI cannot mark an object `VALIDATED`. PostgreSQL compile is the judge.
- Compile success is not `VALIDATED`. Structural tests must pass too.
- Convert and compile follow the object DAG. Out-of-scope deps wait; cycles need review.
- Readiness is a weighted gate, not percent compiled. Compile success is not READY_FOR_DEPLOYMENT.
- Data copy is explicit, chunked, and resumable. No AI on rows. Oracle stays read-only (`readTableChunk` / `countTableRows`).
- Deploy of validated SQL is explicit, DAG-ordered, and never talks to Oracle.
- Never send credentials in prompts.

## Commands

- `bun run test`
- `bun run lint`
- `bun run typecheck`
- `bun run build`
