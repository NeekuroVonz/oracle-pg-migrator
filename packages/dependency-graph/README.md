# @migrator/dependency-graph

Object DAG scheduler. Builds a conversion/compile order from discovered `ALL_DEPENDENCIES` edges. Does not talk to Oracle or PostgreSQL.

- Topological layers, with object-type rank as a tie-breaker (sequence → table → constraint → index → view)
- Out-of-scope or deferred prerequisites mark dependents `WAITING_DEPENDENCY`
- Directed cycles are detected and must be reviewed; they cannot become `VALIDATED` by compile alone
