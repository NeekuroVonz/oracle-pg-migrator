# @migrator/validator

PostgreSQL compile and structural validation. Compile success is not `VALIDATED`. Workers compile and test against a reused validator-pool slot; never against Oracle.

## Compile

`compileSql` runs converted DDL in a transaction and rolls back on failure. Presence in PostgreSQL after `CREATE` is not enough to mark the object validated.

## Structural tests (Phase 7)

`runStructuralTests` uses catalog metadata already stored on the discovered object. It does not open an Oracle session and does not copy rows.

| Type | Checks |
|------|--------|
| TABLE | `pg_class` relkind `r`, column names vs Oracle metadata, preserved `NOT NULL`, `SELECT * … LIMIT 0` |
| VIEW | relkind `v` plus smoke `SELECT` |
| SEQUENCE | relkind `S` |
| INDEX | `pg_indexes` |
| CONSTRAINT | `information_schema.table_constraints` |
| Other / no target name | `SKIPPED` — does not promote to `VALIDATED` |
