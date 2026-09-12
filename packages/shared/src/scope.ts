import {
  type DataMode,
  ORACLE_OBJECT_TYPES,
  type OracleObjectType,
  type ScopeExclusionReason,
} from "./enums";
import type { ScopeTypeCount, UpsertScopeInput } from "./schemas";
import { assertNever } from "./util";

export interface ScopeCatalogObject {
  id: string;
  owner: string;
  name: string;
  objectType: OracleObjectType;
}

export interface ScopeObjectDecision extends ScopeCatalogObject {
  included: boolean;
  reason: ScopeExclusionReason | null;
}

interface CompiledNamePatterns {
  exactNames: Set<string>;
  exactQualified: Set<string>;
  nameGlobs: RegExp[];
  qualifiedGlobs: RegExp[];
}

interface CompiledScopeRules {
  schemas: Set<string>;
  types: Set<OracleObjectType>;
  exactPairs: Set<string>;
  exactTriples: Set<string>;
  excludePatterns: CompiledNamePatterns;
  includePatterns: CompiledNamePatterns;
  hasIncludePatterns: boolean;
}

export function defaultScopeInput(discoveredSchemas: string[]): UpsertScopeInput {
  return {
    includeSchemas: uniqueUpper(discoveredSchemas),
    includeObjectTypes: [...ORACLE_OBJECT_TYPES],
    includeNamePatterns: [],
    excludeNamePatterns: [],
    excludeObjects: [],
    dataMode: "NONE",
    selectedTables: [],
  };
}

export function normalizeScopeInput(input: UpsertScopeInput): UpsertScopeInput {
  return {
    includeSchemas: uniqueUpper(input.includeSchemas),
    includeObjectTypes: [...new Set(input.includeObjectTypes)],
    includeNamePatterns: uniqueTrim(input.includeNamePatterns),
    excludeNamePatterns: uniqueTrim(input.excludeNamePatterns),
    excludeObjects: uniqueUpper(input.excludeObjects),
    dataMode: input.dataMode,
    selectedTables: uniqueUpper(input.selectedTables),
  };
}

export function matchesGlob(value: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }
  return globToRegExp(trimmed).test(value);
}

export function objectMatchesPattern(
  object: Pick<ScopeCatalogObject, "owner" | "name">,
  pattern: string,
): boolean {
  return nameMatchesCompiled(
    object.owner.toUpperCase(),
    object.name.toUpperCase(),
    compileNamePatterns([pattern]),
  );
}

export function evaluateScopeObject(
  object: ScopeCatalogObject,
  rules: UpsertScopeInput,
): ScopeObjectDecision {
  const [decision] = evaluateScopeCatalog([object], rules);
  if (!decision) {
    throw new Error("scope evaluation returned no decision");
  }
  return decision;
}

export function evaluateScopeCatalog(
  objects: ScopeCatalogObject[],
  rules: UpsertScopeInput,
): ScopeObjectDecision[] {
  const compiled = compileScopeRules(normalizeScopeInput(rules));
  return objects.map((object) => matchCompiled(object, compiled));
}

export function selectDataTables(
  included: ScopeObjectDecision[],
  dataMode: DataMode,
  selectedTables: string[],
): Array<Pick<ScopeCatalogObject, "id" | "owner" | "name">> {
  const tables = included.filter((object) => object.included && object.objectType === "TABLE");
  switch (dataMode) {
    case "NONE":
      return [];
    case "ALL_SELECTED_TABLES":
      return tables.map(toTableRef);
    case "SELECTED_TABLES": {
      const allow = new Set(selectedTables.map((value) => value.toUpperCase()));
      return tables.filter((table) => allow.has(`${table.owner}.${table.name}`)).map(toTableRef);
    }
    default: {
      const exhaustive: never = dataMode;
      return assertNever(exhaustive, "unsupported data mode");
    }
  }
}

export function buildScopePreview(
  objects: ScopeCatalogObject[],
  rules: UpsertScopeInput,
  query: {
    objectType?: OracleObjectType;
    inclusion: "included" | "excluded" | "all";
    q?: string;
    page: number;
    pageSize: number;
  },
): {
  decisions: ScopeObjectDecision[];
  totals: ScopeTypeCount;
  byType: Record<OracleObjectType, ScopeTypeCount>;
  dataTables: Array<Pick<ScopeCatalogObject, "id" | "owner" | "name">>;
  objects: ScopeObjectDecision[];
  total: number;
} {
  const normalized = normalizeScopeInput(rules);
  const decisions = evaluateScopeCatalog(objects, normalized);
  const byType = emptyTypeCounts();
  for (const decision of decisions) {
    const bucket = byType[decision.objectType];
    bucket.found += 1;
    if (decision.included) {
      bucket.selected += 1;
    } else {
      bucket.excluded += 1;
    }
  }
  const totals = Object.values(byType).reduce<ScopeTypeCount>(
    (acc, count) => ({
      found: acc.found + count.found,
      selected: acc.selected + count.selected,
      excluded: acc.excluded + count.excluded,
    }),
    { found: 0, selected: 0, excluded: 0 },
  );
  const search = query.q?.trim().toUpperCase();
  const filtered = decisions.filter((decision) => {
    if (query.objectType && decision.objectType !== query.objectType) {
      return false;
    }
    if (query.inclusion === "included" && !decision.included) {
      return false;
    }
    if (query.inclusion === "excluded" && decision.included) {
      return false;
    }
    if (search && !decision.name.includes(search)) {
      return false;
    }
    return true;
  });
  const start = (query.page - 1) * query.pageSize;
  return {
    decisions,
    totals,
    byType,
    dataTables: selectDataTables(decisions, normalized.dataMode, normalized.selectedTables),
    objects: filtered.slice(start, start + query.pageSize),
    total: filtered.length,
  };
}

function compileScopeRules(rules: UpsertScopeInput): CompiledScopeRules {
  const exactPairs = new Set<string>();
  const exactTriples = new Set<string>();
  for (const raw of rules.excludeObjects) {
    const parts = raw
      .trim()
      .toUpperCase()
      .split(".")
      .filter((part) => part.length > 0);
    if (parts.length === 2 && parts[0] && parts[1]) {
      exactPairs.add(`${parts[0]}.${parts[1]}`);
    } else if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      exactTriples.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }
  return {
    schemas: new Set(rules.includeSchemas.map((schema) => schema.toUpperCase())),
    types: new Set(rules.includeObjectTypes),
    exactPairs,
    exactTriples,
    excludePatterns: compileNamePatterns(rules.excludeNamePatterns),
    includePatterns: compileNamePatterns(rules.includeNamePatterns),
    hasIncludePatterns: rules.includeNamePatterns.length > 0,
  };
}

function compileNamePatterns(patterns: string[]): CompiledNamePatterns {
  const exactNames = new Set<string>();
  const exactQualified = new Set<string>();
  const nameGlobs: RegExp[] = [];
  const qualifiedGlobs: RegExp[] = [];
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) {
      continue;
    }
    const glob = isGlob(trimmed);
    const qualified = trimmed.includes(".");
    if (!glob) {
      const upper = trimmed.toUpperCase();
      if (qualified) {
        exactQualified.add(upper);
      } else {
        exactNames.add(upper);
      }
      continue;
    }
    const regex = globToRegExp(trimmed);
    if (qualified) {
      qualifiedGlobs.push(regex);
    } else {
      nameGlobs.push(regex);
    }
  }
  return { exactNames, exactQualified, nameGlobs, qualifiedGlobs };
}

function matchCompiled(object: ScopeCatalogObject, rules: CompiledScopeRules): ScopeObjectDecision {
  const owner = object.owner.toUpperCase();
  const name = object.name.toUpperCase();
  const normalized: ScopeCatalogObject = {
    ...object,
    owner,
    name,
    objectType: object.objectType,
  };
  if (rules.schemas.size === 0 || !rules.schemas.has(owner)) {
    return { ...normalized, included: false, reason: "schema" };
  }
  if (!rules.types.has(object.objectType)) {
    return { ...normalized, included: false, reason: "object_type" };
  }
  const qualified = `${owner}.${name}`;
  if (
    rules.exactPairs.has(qualified) ||
    rules.exactTriples.has(`${qualified}.${object.objectType}`)
  ) {
    return { ...normalized, included: false, reason: "exact_exclusion" };
  }
  if (nameMatchesCompiled(owner, name, rules.excludePatterns)) {
    return { ...normalized, included: false, reason: "exclude_pattern" };
  }
  if (rules.hasIncludePatterns && !nameMatchesCompiled(owner, name, rules.includePatterns)) {
    return { ...normalized, included: false, reason: "include_pattern" };
  }
  return { ...normalized, included: true, reason: null };
}

function nameMatchesCompiled(owner: string, name: string, patterns: CompiledNamePatterns): boolean {
  if (patterns.exactNames.has(name) || patterns.exactQualified.has(`${owner}.${name}`)) {
    return true;
  }
  for (const glob of patterns.nameGlobs) {
    if (glob.test(name)) {
      return true;
    }
  }
  if (patterns.qualifiedGlobs.length === 0) {
    return false;
  }
  const qualified = `${owner}.${name}`;
  for (const glob of patterns.qualifiedGlobs) {
    if (glob.test(qualified)) {
      return true;
    }
  }
  return false;
}

function emptyTypeCounts(): Record<OracleObjectType, ScopeTypeCount> {
  const counts = {} as Record<OracleObjectType, ScopeTypeCount>;
  for (const type of ORACLE_OBJECT_TYPES) {
    counts[type] = { found: 0, selected: 0, excluded: 0 };
  }
  return counts;
}

function isGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const translated = escaped.replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${translated}$`, "i");
}

function uniqueUpper(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function uniqueTrim(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toTableRef(
  object: ScopeObjectDecision,
): Pick<ScopeCatalogObject, "id" | "owner" | "name"> {
  return { id: object.id, owner: object.owner, name: object.name };
}
