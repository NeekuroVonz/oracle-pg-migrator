# ADR-003: AES-256-GCM secrets with replaceable cipher

## Status

Accepted

## Date

2026-09-10

## Context

Connection passwords must not be stored or returned in plaintext. Vault/KMS should be adoptable later without rewriting repositories.

## Decision

`SecretCipher` interface in `packages/config`. Default `AesGcmSecretCipher` uses `SECRETS_MASTER_KEY`. Ciphertext format `v1:iv:ciphertext:tag`. Repositories store only ciphertext.

## Alternatives considered

- Application-level Postgres pgcrypto: couples rotation to SQL
- Plain env-only secrets: cannot persist many project connections

## Consequences

Losing `SECRETS_MASTER_KEY` makes stored passwords unrecoverable. Operators must back up the key. Rotation requires re-encrypting rows (future work).
