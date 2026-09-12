# ADR-001: Monorepo stack

## Status

Accepted

## Date

2026-09-10

## Context

The control plane needs a web UI, HTTP API, horizontally scalable workers, metadata storage, and a job queue. The product spec mandates Bun, Next.js, NestJS, PostgreSQL, Redis/BullMQ, Turborepo, and Biome.

## Decision

- Bun workspaces + Turborepo
- Next.js App Router + Tailwind + shadcn/ui for `apps/web`
- NestJS REST for `apps/api` and `apps/worker`
- Drizzle ORM + `node-postgres` for metadata (spec requires `node-postgres`; Drizzle keeps schema in TypeScript)
- BullMQ + ioredis (BullMQ default adapter)
- `oracledb` Thin mode by default (no Instant Client required for connection tests)
- AES-256-GCM secret cipher behind an interface
- `bun:test` for unit tests
- Run NestJS with Bun from each app directory so `tsconfig.json` is applied (`useDefineForClassFields: false` is required for Nest decorators). Typecheck with `tsc --noEmit`.

## Alternatives considered

- Prisma: rejected for Phase 1 to keep schema as TypeScript colocated with queries
- Kafka: rejected by spec
- Bun SQL driver for metadata: rejected so API/worker stay on the specified `pg` client

## Consequences

Shared packages export TypeScript source and are consumed via `workspace:*`. Next.js uses `transpilePackages`. NestJS decorator metadata is enabled in TypeScript config.
