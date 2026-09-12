# Oracle PostgreSQL Migration Control Plane

Manages, validates, and reports Oracle → PostgreSQL migrations. Oracle is always read-only.

## Quick start

```bash
cp .env.example .env
# Replace SECRETS_MASTER_KEY with: openssl rand -hex 32

bun install
docker compose -f infra/docker-compose.yml up -d metadata-postgres redis validator-postgres
bun run db:migrate
bun run dev
```

- Web: http://localhost:3000
- API: http://localhost:3001/health
- Worker health: http://localhost:3002/health

Metadata Postgres is mapped to host port **5433** so it does not collide with a local Postgres on 5432. Redis is 6379.

Start the API from `apps/api` (or via `bun run dev`) so Nest parameter decorators pick up `apps/api/tsconfig.json`.

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | API, worker, and web in watch mode |
| `bun run test` | Unit tests |
| `bun run lint` | Biome |
| `bun run typecheck` | `tsc --noEmit` across workspaces |
| `bun run build` | Production builds |
| `bun run db:migrate` | Apply metadata migrations |
| `bun run infra:up` | Start Postgres + Redis |

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).
