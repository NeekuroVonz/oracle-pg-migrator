export type DeployCandidate = {
  id: string;
  owner: string;
  name: string;
  objectType: string;
  status: string;
  deferred?: boolean;
  reconcileAction: string | null;
  targetState: string | null;
  targetSql: string | null;
  reconcileSql: string | null;
  targetSchema: string | null;
  targetName: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ParentIssue = {
  parent: string;
  neededBy: string;
  reason: "missing" | "not_validated" | "no_sql";
  parentType?: string;
  parentStatus?: string;
};

const SQL_KEYWORDS = new Set(
  [
    "SELECT",
    "FROM",
    "WHERE",
    "JOIN",
    "LEFT",
    "RIGHT",
    "INNER",
    "OUTER",
    "FULL",
    "CROSS",
    "ON",
    "AND",
    "OR",
    "AS",
    "WITH",
    "UNION",
    "ALL",
    "DISTINCT",
    "GROUP",
    "ORDER",
    "BY",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "NULL",
    "TRUE",
    "FALSE",
    "INSERT",
    "UPDATE",
    "DELETE",
    "INTO",
    "VALUES",
    "SET",
    "CREATE",
    "REPLACE",
    "VIEW",
    "FORCE",
    "TEMPORARY",
    "TEMP",
    "MATERIALIZED",
    "LATERAL",
    "USING",
    "ONLY",
    "TABLE",
    "INDEX",
    "EXISTS",
    "BETWEEN",
    "LIKE",
    "ILIKE",
    "IN",
    "IS",
    "NOT",
    "COALESCE",
    "CAST",
    "OVER",
    "PARTITION",
    "ROWS",
    "RANGE",
    "UNBOUNDED",
    "PRECEDING",
    "FOLLOWING",
    "CURRENT",
    "ROW",
  ].map((value) => value.toUpperCase()),
);

const RELATION_TYPE_RANK: Record<string, number> = {
  TABLE: 1,
  VIEW: 2,
  MATERIALIZED_VIEW: 3,
};

export function deploySql(row: Pick<DeployCandidate, "reconcileSql" | "targetSql">): string | null {
  const sql = row.reconcileSql ?? row.targetSql;
  return sql && sql.trim().length > 0 ? sql : null;
}

function isRelationType(type: string): boolean {
  const upper = type.toUpperCase();
  return upper === "TABLE" || upper === "VIEW" || upper === "MATERIALIZED_VIEW";
}

export function isBaseDeployable(row: DeployCandidate): boolean {
  if (row.status !== "VALIDATED" || row.deferred) {
    return false;
  }
  const type = String(row.objectType).toUpperCase();
  const replaceableView = type === "VIEW" || type === "MATERIALIZED_VIEW";
  // Prior deploy may have marked views TARGET_DRIFTED while refusing overwrite — still redeploy.
  if (
    row.reconcileAction === "REVIEW_REQUIRED" ||
    row.targetState === "TARGET_DRIFTED" ||
    row.targetState === "TARGET_CONFLICT"
  ) {
    if (!replaceableView) {
      return false;
    }
  }
  if (row.reconcileAction === "SKIP_UNCHANGED" && !isRelationType(row.objectType)) {
    return false;
  }
  return Boolean(deploySql(row));
}

/** Parent TABLE for an INDEX/CONSTRAINT from metadata or ON … clause. */
export function parentTableRef(row: DeployCandidate): { owner: string; name: string } | null {
  const refs = requiredTableRefs(row);
  return refs[0] ?? null;
}

/** All relation refs an object needs before it can deploy cleanly. */
export function requiredTableRefs(row: DeployCandidate): Array<{ owner: string; name: string }> {
  const type = String(row.objectType).toUpperCase();
  const owner = row.owner.toUpperCase();
  if (type === "INDEX" || type === "CONSTRAINT") {
    const metadata = row.metadata ?? {};
    const fromMeta = String(metadata.tableName ?? "")
      .replace(/^"|"$/g, "")
      .trim();
    if (fromMeta) {
      return [{ owner, name: fromMeta.toUpperCase() }];
    }
    const sql = deploySql(row) ?? "";
    const on =
      /\bON\s+(?:ONLY\s+)?(?:"?([a-zA-Z_][\w$]*)"?\s*\.\s*)?"?([a-zA-Z_][\w$]*)"?/i.exec(sql);
    if (on?.[2]) {
      return [{ owner: (on[1] ?? row.owner).toUpperCase(), name: on[2].toUpperCase() }];
    }
    return [];
  }
  if (type === "VIEW" || type === "MATERIALIZED_VIEW") {
    return relationRefsFromSql(deploySql(row) ?? "", owner);
  }
  return [];
}

/** Best-effort FROM/JOIN relation extraction for view SQL. */
export function relationRefsFromSql(
  sql: string,
  defaultOwner: string,
): Array<{ owner: string; name: string }> {
  const refs = new Map<string, { owner: string; name: string }>();
  const pattern =
    /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:"?([a-zA-Z_][\w$]*)"?\s*\.\s*)?"?([a-zA-Z_][\w$]*)"?/gi;
  for (const match of sql.matchAll(pattern)) {
    const schema = match[1]?.toUpperCase();
    const name = match[2]?.toUpperCase();
    if (!name || SQL_KEYWORDS.has(name)) {
      continue;
    }
    if (schema && SQL_KEYWORDS.has(schema)) {
      continue;
    }
    const owner = schema ?? defaultOwner.toUpperCase();
    refs.set(`${owner}.${name}`, { owner, name });
  }
  return [...refs.values()];
}

export function preferRelation(candidates: DeployCandidate[]): DeployCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort((left, right) => {
    const leftRank = RELATION_TYPE_RANK[String(left.objectType).toUpperCase()] ?? 99;
    const rightRank = RELATION_TYPE_RANK[String(right.objectType).toUpperCase()] ?? 99;
    return leftRank - rightRank;
  })[0]!;
}

function resolveRelation(
  owner: string,
  name: string,
  memberRelations: Map<string, DeployCandidate[]>,
  catalogRelationsByOwnerName?: Map<string, DeployCandidate[]>,
): DeployCandidate | null {
  const key = `${owner}.${name}`;
  return (
    preferRelation(memberRelations.get(key) ?? []) ??
    preferRelation(catalogRelationsByOwnerName?.get(key) ?? []) ??
    null
  );
}

function parentReady(parent: DeployCandidate | null): parent is DeployCandidate {
  return Boolean(parent && !parent.deferred && parent.status === "VALIDATED" && deploySql(parent));
}

function describeParentIssue(
  parentKey: string,
  neededBy: string,
  parent: DeployCandidate | null,
): ParentIssue {
  if (!parent) {
    return { parent: parentKey, neededBy, reason: "missing" };
  }
  if (parent.status !== "VALIDATED") {
    return {
      parent: parentKey,
      neededBy,
      reason: "not_validated",
      parentType: parent.objectType,
      parentStatus: parent.status,
    };
  }
  return {
    parent: parentKey,
    neededBy,
    reason: "no_sql",
    parentType: parent.objectType,
    parentStatus: parent.status,
  };
}

export function formatParentIssue(issue: ParentIssue): string {
  if (issue.reason === "missing") {
    return `${issue.parent} not in catalog (needed by ${issue.neededBy})`;
  }
  if (issue.reason === "not_validated") {
    return `${issue.parent} is included/discovered as ${issue.parentType ?? "object"} but status=${issue.parentStatus ?? "?"} — not VALIDATED yet (needed by ${issue.neededBy})`;
  }
  return `${issue.parent} has no deploy SQL (needed by ${issue.neededBy})`;
}

/**
 * Deployable objects plus parent TABLE/VIEW relations required by indexes/views.
 * Dependents whose parents are not ready are omitted (deploy continues for the rest).
 */
export function selectDeployableWithParents(input: {
  members: DeployCandidate[];
  catalogRelationsByOwnerName?: Map<string, DeployCandidate[]>;
}): {
  selected: DeployCandidate[];
  skippedDependents: string[];
  parentIssues: ParentIssue[];
} {
  const selected = new Map<string, DeployCandidate>();
  for (const row of input.members) {
    if (isBaseDeployable(row)) {
      selected.set(row.id, row);
    }
  }

  const memberRelations = new Map<string, DeployCandidate[]>();
  for (const row of input.members) {
    if (!isRelationType(row.objectType)) {
      continue;
    }
    const key = `${row.owner.toUpperCase()}.${row.name.toUpperCase()}`;
    const list = memberRelations.get(key) ?? [];
    list.push(row);
    memberRelations.set(key, list);
  }

  const dependents = input.members.filter((row) => {
    const type = String(row.objectType).toUpperCase();
    return (
      (type === "INDEX" ||
        type === "CONSTRAINT" ||
        type === "VIEW" ||
        type === "MATERIALIZED_VIEW") &&
      row.status === "VALIDATED" &&
      !row.deferred &&
      Boolean(deploySql(row))
    );
  });

  const skippedDependents: string[] = [];
  const parentIssues: ParentIssue[] = [];
  const issueKeys = new Set<string>();

  for (const row of dependents) {
    const parents = requiredTableRefs(row);
    let ready = true;
    for (const parent of parents) {
      const key = `${parent.owner}.${parent.name}`;
      const relation = resolveRelation(
        parent.owner,
        parent.name,
        memberRelations,
        input.catalogRelationsByOwnerName,
      );
      if (parentReady(relation)) {
        selected.set(relation.id, relation);
        continue;
      }
      ready = false;
      const issueKey = `${key}|${row.owner}.${row.name}`;
      if (!issueKeys.has(issueKey)) {
        issueKeys.add(issueKey);
        parentIssues.push(describeParentIssue(key, `${row.owner}.${row.name}`, relation));
      }
    }
    if (!ready) {
      selected.delete(row.id);
      skippedDependents.push(`${row.owner}.${row.name}`);
    }
  }

  return {
    selected: [...selected.values()],
    skippedDependents,
    parentIssues,
  };
}
