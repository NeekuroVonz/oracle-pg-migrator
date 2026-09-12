# Security

## Threat model (Phase 1)

Assets: Oracle and PostgreSQL credentials, Oracle source data, migration audit trail.

Trust boundaries:

- Browser → API (untrusted HTTP)
- API/worker → metadata PostgreSQL
- API/worker → Redis
- Worker/API → Oracle (read-only, still untrusted network)
- Worker/API → PostgreSQL targets
- Worker/API → AI providers (prompts must never include secrets)

STRIDE notes:

| Threat | Control |
|--------|---------|
| Tampering of Oracle | Application never issues DML/DDL/PL/SQL; classifier rejects before the driver |
| Information disclosure | Passwords encrypted at rest; APIs never return stored secrets; audit logs omit passwords |
| Elevation | Oracle `allowWrite` is not configurable; source role is hardcoded `READ_ONLY` |
| DoS | Statement timeouts on Oracle validation SELECT; workers own heavy work |
| LLM leakage (Phase 6) | Secret redaction in `@migrator/ai-core`; credentials never in prompts; APIs return `hasApiKey` |

## Oracle read-only enforcement

`packages/oracle` is the only module allowed to talk to Oracle.

Exposed methods:

- `testConnection()`
- `getSchemas()`
- `getObjectDefinition()` (Phase 2) — `SELECT DBMS_METADATA.GET_DDL(...) FROM DUAL`, fallback `ALL_SOURCE`
- `getDependencies()` (Phase 2) — `ALL_DEPENDENCIES`
- `discoverObjects()` (Phase 2) — dictionary `SELECT`s only
- `countTableRows()` (Phase 10) — classified `SELECT COUNT(*)`
- `readTableChunk()` (Phase 10) — classified `SELECT … OFFSET/FETCH`
- `executeValidationSelect()` — classified SELECT only

There is no generic `execute()`.

`executeValidationSelect()`:

1. Strip comments with a string-aware scanner
2. Classify the statement (not `startsWith("SELECT")`)
3. Require exactly one SELECT-compatible statement (`SELECT` or `WITH` … `SELECT`)
4. Reject DML, DDL, PL/SQL, `FOR UPDATE`, `SELECT INTO`, multiple statements
5. Apply a statement timeout
6. Only then call `oracledb`

If classification is uncertain, the statement is **rejected**.

The Oracle account should still be provisioned as a read-only database user. Application enforcement is mandatory regardless. Connection tests that detect write privileges **warn** and still connect; they never grant write access to this application.

## Secrets

- Master key: `SECRETS_MASTER_KEY` (32-byte key, hex-encoded)
- Algorithm: AES-256-GCM
- Stored form: `v1:<iv>:<ciphertext>:<authTag>` (base64url)
- `SecretCipher` is an interface so Vault/KMS can replace the local implementation later

Never:

- commit `.env`
- return ciphertext-decrypted passwords or API keys from REST
- log passwords, connection strings with passwords, master keys, or AI keys
- send credentials to AI providers

## API responses

Connection DTOs include `hasPassword: true` and never `password`. AI provider DTOs include `hasApiKey: true` and never `apiKey`. Updates may send a new secret; omission leaves the stored secret unchanged.

## Audit

Logged: project create/update/delete, connection create/update/delete, connection tests, discovery start/complete/fail, scope updates, conversion start/complete/fail, validation complete/fail, AI provider create/update/delete/test, report.completed, data-copy.started / data-copy.completed / data-copy.failed, deploy.started / deploy.completed / deploy.failed.

Not logged: passwords, decrypted secrets, raw connection URLs with credentials. Report payloads and SQL bundles contain generated DDL only. Data-copy and deploy audit metadata is counts and ids, never passwords or SQL/row payloads.

## Recommended Oracle account

```sql
-- Example intent only; do not run against production from this app.
-- CREATE USER migrator_ro IDENTIFIED BY ...;
-- GRANT CREATE SESSION, SELECT ANY DICTIONARY TO migrator_ro;
-- Grant SELECT on required schemas. Do not grant INSERT/UPDATE/DELETE/ALTER.
```
