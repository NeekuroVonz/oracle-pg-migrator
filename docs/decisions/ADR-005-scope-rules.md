# ADR-005: Scope is saved as rules, evaluated against inventory

## Status

Accepted

## Date

2026-09-10

## Context

Partial migration is a first-class requirement. Operators include/exclude schemas, object types, glob name patterns (`ORDER_*`, `*_HISTORY`), and exact objects (`CLV.OLD_ORDER`). Before a conversion run they must see Found / Selected / Excluded counts and inspect the included objects.

Discovery inventory can change between runs. Storing a frozen list of object IDs would drift the moment discovery refreshes.

## Decision

- Persist one `migration_scopes` row per project: schemas, object types, include/exclude globs, exact exclusions, and data mode.
- Evaluate those rules in `packages/shared` against the current discovered catalog. The API only loads lightweight `id/owner/name/type` rows and returns a preview.
- Empty schema or object-type lists mean nothing is selected. An unsaved default pre-checks discovered schemas and every object type.
- Data mode (`NONE`, `SELECTED_TABLES`, `ALL_SELECTED_TABLES`) is stored now; row copy is a later phase.

## Alternatives considered

- Persist selected object IDs: rejected; inventory refresh would silently drop or include the wrong set.
- Evaluate filters in the browser only: rejected; the worker/conversion pipeline must use the same function.
- Run preview on a worker: rejected; filtering a few thousand catalog keys is not heavyweight Oracle work.

## Consequences

Conversion (Phase 4+) must call the same matcher. Re-running discovery does not require re-saving scope unless the operator wants newly found schemas included.
