FROM postgres:16-alpine
# Pre-warmed compiler sandbox. Workers check out a pool slot, compile converted SQL, then reset the database.
# Never used as a destination for Oracle credentials.
