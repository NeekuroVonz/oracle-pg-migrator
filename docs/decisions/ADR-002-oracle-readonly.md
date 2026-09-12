# ADR-002: Oracle is always read-only

## Status

Accepted

## Date

2026-09-10

## Context

A migration tool with write access to the source Oracle database is an unacceptable production risk.

## Decision

- Single client: `OracleReadOnlyClient`
- No generic `execute()`
- SQL classification before any operator-supplied SELECT
- Source connections persist `accessMode=READ_ONLY` and `allowWrite=false`
- Detect write privileges during tests and warn; do not reject the account
- Application-level enforcement even if the DB user is over-privileged

## Consequences

Discovery, extraction, and data copy must be expressed as dedicated methods. Adding a new Oracle operation requires a new typed method and a review that it is read-only.
