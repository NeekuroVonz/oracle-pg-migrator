# ADR-006: Ora2Pg never opens an Oracle session

## Status

Accepted

## Date

2026-09-10

## Context

Phase 4 requires Ora2Pg / deterministic conversion of tables, sequences, constraints, indexes, and simple views. Ora2Pg’s default mode connects to Oracle with a DSN (`-s` / `ORACLE_DSN`). This repository already extracted DDL through `OracleReadOnlyClient`. Only `packages/oracle` may talk to Oracle, and that client has no generic `execute()`.

Ora2Pg documents file input that disables the Oracle connection:

> `-i | --input file : File containing Oracle PL/SQL code to convert with no Oracle database connection initiated.`

Source: https://ora2pg.darold.net/docs/configuration

## Decision

- Convert **extracted** Oracle DDL only. Never pass a DSN, username, or password to Ora2Pg.
- Ship a TypeScript mapping engine that follows Ora2Pg’s default `DATA_TYPE` / `PG_INTEGER_TYPE` mappings so tests and local runs work without the Perl binary.
- If `ORA2PG_BIN` is set, the worker may call `ora2pg -i <file> -t <TYPE> -o <file>` and fall back to the TypeScript engine on failure.
- Do not call AI for these object types.

## Alternatives considered

- Let Ora2Pg connect to Oracle: rejected; bypasses the read-only client and classifier.
- Require the Ora2Pg binary in every environment: rejected; conversion must be testable in CI without Perl/Oracle client libraries.

## Consequences

Mapping rules live in `@migrator/ora2pg` and must stay versioned (`MAPPING_RULES_VERSION`). PostgreSQL compile (Phase 5) remains the judge of generated SQL.
