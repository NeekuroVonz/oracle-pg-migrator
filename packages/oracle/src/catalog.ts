import { createHash } from "node:crypto";
import type {
  DiscoveredColumn,
  DiscoveredObjectMetadata,
  OracleObjectType,
} from "@migrator/shared";
import { CATALOG_SQL } from "./catalog-sql";
import {
  ddlDictionaryType,
  ddlObjectType,
  mapOracleDictionaryType,
  sourceDictionaryType,
} from "./object-types";
import { isMissingOracleDictionary, wrapOracleQueryError } from "./oracle-errors";
import { quoteOracleIdent } from "./table-chunk";

export type CatalogSelect = (sql: string, binds?: Record<string, string>) => Promise<unknown[][]>;

export interface CatalogObject {
  owner: string;
  name: string;
  objectType: OracleObjectType;
  lastDdlTime: Date | null;
  estimatedRowCount: number | null;
  byteSize: number | null;
  metadata: DiscoveredObjectMetadata;
  inlineDefinition?: ObjectDefinition;
}

export interface CatalogDependency {
  owner: string;
  name: string;
  objectType: OracleObjectType;
  referencedOwner: string;
  referencedName: string;
  referencedType: OracleObjectType;
  dependencyType: string;
}

export interface ObjectDefinition {
  source: string | null;
  hash: string | null;
  error: string | null;
  skipped: boolean;
}

function cell(row: unknown[], index: number): unknown {
  return row[index];
}

function asString(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = asString(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function objectKey(owner: string, name: string, objectType: OracleObjectType): string {
  return `${owner}.${name}.${objectType}`;
}

function addAmount(target: Map<string, number>, name: string, amount: number | null): void {
  if (!name || amount == null) {
    return;
  }
  target.set(name, (target.get(name) ?? 0) + amount);
}

function isTableSegment(segmentType: string): boolean {
  return (
    segmentType === "TABLE" ||
    segmentType === "TABLE PARTITION" ||
    segmentType === "TABLE SUBPARTITION" ||
    segmentType === "NESTED TABLE"
  );
}

function isIndexSegment(segmentType: string): boolean {
  return (
    segmentType === "INDEX" ||
    segmentType === "INDEX PARTITION" ||
    segmentType === "INDEX SUBPARTITION"
  );
}

export function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function requiredSelect(
  select: CatalogSelect,
  sql: string,
  binds?: Record<string, string>,
): Promise<unknown[][]> {
  try {
    return await select(sql, binds);
  } catch (error) {
    throw wrapOracleQueryError(sql, error);
  }
}

async function optionalSelect(
  select: CatalogSelect,
  sql: string,
  binds?: Record<string, string>,
): Promise<unknown[][]> {
  try {
    return await select(sql, binds);
  } catch (error) {
    if (isMissingOracleDictionary(error)) {
      return [];
    }
    throw wrapOracleQueryError(sql, error);
  }
}

async function selectConstraints(select: CatalogSelect, owner: string): Promise<unknown[][]> {
  try {
    return await requiredSelect(select, CATALOG_SQL.constraints, { owner });
  } catch (error) {
    if (isMissingOracleDictionary(error)) {
      return requiredSelect(select, CATALOG_SQL.constraintsLegacy, { owner });
    }
    throw error;
  }
}

export async function collectCatalog(
  select: CatalogSelect,
  schemas: string[],
): Promise<CatalogObject[]> {
  const objects = new Map<string, CatalogObject>();

  for (const schema of schemas) {
    const owner = schema.toUpperCase();
    const objectRows = await requiredSelect(select, CATALOG_SQL.objects, { owner });
    for (const row of objectRows) {
      const objectType = mapOracleDictionaryType(asString(cell(row, 2)));
      if (!objectType) {
        continue;
      }
      const catalogObject: CatalogObject = {
        owner: asString(cell(row, 0)).toUpperCase(),
        name: asString(cell(row, 1)),
        objectType,
        lastDdlTime: asDate(cell(row, 4)),
        estimatedRowCount: null,
        byteSize: null,
        metadata: { oracleStatus: asNullableString(cell(row, 3)) ?? undefined },
      };
      objects.set(
        objectKey(catalogObject.owner, catalogObject.name, catalogObject.objectType),
        catalogObject,
      );
    }

    const constraintRows = await selectConstraints(select, owner);
    const constraintInfo = new Map<
      string,
      {
        tableName: string;
        constraintType: string;
        searchCondition: string | null;
        referencedOwner: string | null;
        referencedConstraint: string | null;
        deleteRule: string | null;
      }
    >();
    for (const row of constraintRows) {
      const catalogObject: CatalogObject = {
        owner: asString(cell(row, 0)).toUpperCase(),
        name: asString(cell(row, 1)),
        objectType: "CONSTRAINT",
        lastDdlTime: null,
        estimatedRowCount: null,
        byteSize: null,
        metadata: {
          constraintType: asNullableString(cell(row, 2)) ?? undefined,
          tableName: asNullableString(cell(row, 3)) ?? undefined,
          oracleStatus: asNullableString(cell(row, 4)) ?? undefined,
          searchCondition: asNullableString(cell(row, 5)) ?? undefined,
          referencedOwner: asNullableString(cell(row, 6)) ?? undefined,
          referencedName: asNullableString(cell(row, 7)) ?? undefined,
          deleteRule: asNullableString(cell(row, 8)) ?? undefined,
        },
      };
      objects.set(
        objectKey(catalogObject.owner, catalogObject.name, catalogObject.objectType),
        catalogObject,
      );
      constraintInfo.set(objectKey(catalogObject.owner, catalogObject.name, "CONSTRAINT"), {
        tableName: catalogObject.metadata.tableName ?? "",
        constraintType: catalogObject.metadata.constraintType ?? "",
        searchCondition: catalogObject.metadata.searchCondition ?? null,
        referencedOwner: catalogObject.metadata.referencedOwner ?? null,
        referencedConstraint: catalogObject.metadata.referencedName ?? null,
        deleteRule: catalogObject.metadata.deleteRule ?? null,
      });
    }

    const constraintColumnRows = await requiredSelect(select, CATALOG_SQL.constraintColumns, {
      owner,
    });
    const constraintColumns = new Map<string, string[]>();
    for (const row of constraintColumnRows) {
      const key = objectKey(
        asString(cell(row, 0)).toUpperCase(),
        asString(cell(row, 1)),
        "CONSTRAINT",
      );
      const list = constraintColumns.get(key) ?? [];
      const columnName = asString(cell(row, 2));
      if (columnName) {
        list.push(columnName);
        constraintColumns.set(key, list);
      }
    }

    const columnRows = await requiredSelect(select, CATALOG_SQL.columns, { owner });
    const columnsByTable = new Map<string, DiscoveredColumn[]>();
    for (const row of columnRows) {
      const tableName = asString(cell(row, 1));
      const list = columnsByTable.get(tableName) ?? [];
      list.push({
        name: asString(cell(row, 2)),
        dataType: asString(cell(row, 3)),
        dataLength: asNumber(cell(row, 4)),
        dataPrecision: asNumber(cell(row, 5)),
        dataScale: asNumber(cell(row, 6)),
        nullable: asString(cell(row, 7)).toUpperCase() !== "N",
        columnId: asNumber(cell(row, 8)),
      });
      columnsByTable.set(tableName, list);
    }
    for (const [tableName, columns] of columnsByTable) {
      const table = objects.get(objectKey(owner, tableName, "TABLE"));
      if (table) {
        table.metadata = { ...table.metadata, columns };
      }
    }

    const tableRows = await requiredSelect(select, CATALOG_SQL.tables, { owner });
    for (const row of tableRows) {
      const table = objects.get(objectKey(owner, asString(cell(row, 1)), "TABLE"));
      if (table) {
        table.estimatedRowCount = asNumber(cell(row, 2));
        const blocks = asNumber(cell(row, 3));
        table.byteSize = blocks == null ? null : blocks * 8192;
      }
    }

    const partitionRows = await optionalSelect(select, CATALOG_SQL.partitions, { owner });
    const partitionsByTable = new Map<string, Array<{ name: string; position: number | null }>>();
    const partitionRowCounts = new Map<string, number>();
    const partitionBlocks = new Map<string, number>();
    for (const row of partitionRows) {
      const tableName = asString(cell(row, 1));
      const list = partitionsByTable.get(tableName) ?? [];
      list.push({
        name: asString(cell(row, 2)),
        position: asNumber(cell(row, 3)),
      });
      partitionsByTable.set(tableName, list);
      addAmount(partitionRowCounts, tableName, asNumber(cell(row, 4)));
      addAmount(partitionBlocks, tableName, asNumber(cell(row, 5)));
    }
    for (const [tableName, partitions] of partitionsByTable) {
      const table = objects.get(objectKey(owner, tableName, "TABLE"));
      if (!table) {
        continue;
      }
      table.metadata = { ...table.metadata, partitions };
      if (table.estimatedRowCount == null) {
        table.estimatedRowCount = partitionRowCounts.get(tableName) ?? null;
      }
      if (table.byteSize == null) {
        const blocks = partitionBlocks.get(tableName);
        table.byteSize = blocks == null ? null : blocks * 8192;
      }
    }

    const lobTables = new Map<string, string>();
    const lobRows = await optionalSelect(select, CATALOG_SQL.lobs, { owner });
    for (const row of lobRows) {
      const tableName = asString(cell(row, 1));
      const segmentName = asString(cell(row, 2));
      const indexName = asString(cell(row, 3));
      if (segmentName) {
        lobTables.set(segmentName, tableName);
      }
      if (indexName) {
        lobTables.set(indexName, tableName);
      }
    }

    const tableBytes = new Map<string, number>();
    const indexBytes = new Map<string, number>();
    const segmentRows = await optionalSelect(select, CATALOG_SQL.segments, { owner });
    for (const row of segmentRows) {
      const segmentName = asString(cell(row, 1));
      const segmentType = asString(cell(row, 2)).toUpperCase();
      const bytes = asNumber(cell(row, 3));
      const lobTable = lobTables.get(segmentName);
      if (lobTable) {
        addAmount(tableBytes, lobTable, bytes);
      } else if (isTableSegment(segmentType)) {
        addAmount(tableBytes, segmentName, bytes);
      } else if (isIndexSegment(segmentType)) {
        addAmount(indexBytes, segmentName, bytes);
      }
    }
    for (const [tableName, bytes] of tableBytes) {
      const table = objects.get(objectKey(owner, tableName, "TABLE"));
      if (table) {
        table.byteSize = bytes;
      }
    }
    for (const [indexName, bytes] of indexBytes) {
      const index = objects.get(objectKey(owner, indexName, "INDEX"));
      if (index) {
        index.byteSize = bytes;
      }
    }

    const indexRows = await requiredSelect(select, CATALOG_SQL.indexes, { owner });
    for (const row of indexRows) {
      const index = objects.get(objectKey(owner, asString(cell(row, 1)), "INDEX"));
      if (index) {
        index.metadata = {
          ...index.metadata,
          tableName: asNullableString(cell(row, 2)) ?? undefined,
          uniqueness: asNullableString(cell(row, 3)) ?? undefined,
          oracleStatus: asNullableString(cell(row, 4)) ?? index.metadata.oracleStatus,
          indexType: asNullableString(cell(row, 5)) ?? undefined,
        };
      }
    }

    const indexColumnRows = await requiredSelect(select, CATALOG_SQL.indexColumns, { owner });
    const indexColumns = new Map<string, Array<{ name: string; descend: string | null }>>();
    for (const row of indexColumnRows) {
      const key = objectKey(asString(cell(row, 0)).toUpperCase(), asString(cell(row, 1)), "INDEX");
      const list = indexColumns.get(key) ?? [];
      const columnName = asString(cell(row, 2));
      if (columnName) {
        list.push({ name: columnName, descend: asNullableString(cell(row, 4)) });
        indexColumns.set(key, list);
      }
    }

    const jobRows = await optionalSelect(select, CATALOG_SQL.schedulerJobs, { owner });
    for (const row of jobRows) {
      const catalogObject: CatalogObject = {
        owner: asString(cell(row, 0)).toUpperCase(),
        name: asString(cell(row, 1)),
        objectType: "SCHEDULER_JOB",
        lastDdlTime: null,
        estimatedRowCount: null,
        byteSize: null,
        metadata: {
          enabled: asString(cell(row, 2)).toUpperCase() === "TRUE",
          oracleStatus: asNullableString(cell(row, 3)) ?? undefined,
        },
      };
      objects.set(
        objectKey(catalogObject.owner, catalogObject.name, catalogObject.objectType),
        catalogObject,
      );
    }

    const linkRows = await optionalSelect(select, CATALOG_SQL.dbLinks, { owner });
    for (const row of linkRows) {
      const catalogObject: CatalogObject = {
        owner: asString(cell(row, 0)).toUpperCase(),
        name: asString(cell(row, 1)),
        objectType: "DATABASE_LINK",
        lastDdlTime: null,
        estimatedRowCount: null,
        byteSize: null,
        metadata: { tableName: asNullableString(cell(row, 2)) ?? undefined },
      };
      objects.set(
        objectKey(catalogObject.owner, catalogObject.name, catalogObject.objectType),
        catalogObject,
      );
    }

    const sourceRows = await optionalSelect(select, CATALOG_SQL.sources, { owner });
    const sources = new Map<string, string[]>();
    for (const row of sourceRows) {
      const objectType = mapOracleDictionaryType(asString(cell(row, 1)));
      if (!objectType) {
        continue;
      }
      const key = objectKey(owner, asString(cell(row, 0)), objectType);
      const lines = sources.get(key) ?? [];
      lines.push(asString(cell(row, 2)));
      sources.set(key, lines);
    }

    applyInlineDefinitions(objects, {
      owner,
      constraintInfo,
      constraintColumns,
      indexColumns,
      sources,
    });
  }

  return [...objects.values()].sort((left, right) => {
    const owner = left.owner.localeCompare(right.owner);
    if (owner !== 0) {
      return owner;
    }
    const type = left.objectType.localeCompare(right.objectType);
    if (type !== 0) {
      return type;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function collectDependencies(
  select: CatalogSelect,
  schemas: string[],
): Promise<CatalogDependency[]> {
  const dependencies = new Map<string, CatalogDependency>();
  for (const schema of schemas) {
    const owner = schema.toUpperCase();
    const rows = await optionalSelect(select, CATALOG_SQL.dependencies, { owner });
    for (const row of rows) {
      const objectType = mapOracleDictionaryType(asString(cell(row, 2)));
      const referencedType = mapOracleDictionaryType(asString(cell(row, 5)));
      if (!objectType || !referencedType) {
        continue;
      }
      const dependency: CatalogDependency = {
        owner: asString(cell(row, 0)).toUpperCase(),
        name: asString(cell(row, 1)),
        objectType,
        referencedOwner: asString(cell(row, 3)).toUpperCase(),
        referencedName: asString(cell(row, 4)),
        referencedType,
        dependencyType: asString(cell(row, 6)) || "HARD",
      };
      dependencies.set(
        [
          dependency.owner,
          dependency.name,
          dependency.objectType,
          dependency.referencedOwner,
          dependency.referencedName,
          dependency.referencedType,
          dependency.dependencyType,
        ].join("\0"),
        dependency,
      );
    }
  }
  return [...dependencies.values()];
}

export async function extractDefinition(
  select: CatalogSelect,
  object: Pick<CatalogObject, "owner" | "name" | "objectType">,
): Promise<ObjectDefinition> {
  const ddlType = ddlObjectType(object.objectType);
  if (ddlType) {
    try {
      const rows = await select(CATALOG_SQL.ddl, {
        objectType: ddlType,
        objectName: object.name,
        owner: object.owner,
      });
      const source = asNullableString(cell(rows[0] ?? [], 0));
      if (source) {
        return { source, hash: hashSource(source), error: null, skipped: false };
      }
    } catch (error) {
      const fallback = await extractFromSource(select, object);
      if (fallback.source) {
        return fallback;
      }
      return {
        source: null,
        hash: null,
        error: error instanceof Error ? error.message : "DDL extraction failed",
        skipped: false,
      };
    }
  }
  return extractFromSource(select, object);
}

async function extractFromSource(
  select: CatalogSelect,
  object: Pick<CatalogObject, "owner" | "name" | "objectType">,
): Promise<ObjectDefinition> {
  const dictionaryType = sourceDictionaryType(object.objectType);
  if (!dictionaryType) {
    return { source: null, hash: null, error: null, skipped: false };
  }
  try {
    const rows = await select(CATALOG_SQL.source, {
      owner: object.owner,
      objectName: object.name,
      objectType: dictionaryType,
    });
    const source = rows.map((row) => asString(cell(row, 0))).join("");
    if (!source.trim()) {
      return { source: null, hash: null, error: null, skipped: false };
    }
    return { source, hash: hashSource(source), error: null, skipped: false };
  } catch (error) {
    return {
      source: null,
      hash: null,
      error: error instanceof Error ? error.message : "Source extraction failed",
      skipped: false,
    };
  }
}

export const GET_DDL_BATCH_SIZE = 20;

export function buildBatchDdlSql(nameCount: number): string {
  const inList = Array.from({ length: nameCount }, (_, index) => `:n${index}`).join(", ");
  return `SELECT OBJECT_NAME, DBMS_METADATA.GET_DDL(:ddlType, OBJECT_NAME, :owner)
FROM ALL_OBJECTS
WHERE OWNER = :owner
AND SUBOBJECT_NAME IS NULL
AND OBJECT_TYPE = :dictType
AND OBJECT_NAME IN (${inList})`;
}

export async function extractBatchedDdl(
  select: CatalogSelect,
  input: {
    owner: string;
    objectType: OracleObjectType;
    names: string[];
  },
): Promise<Map<string, ObjectDefinition>> {
  const definitions = new Map<string, ObjectDefinition>();
  const ddlType = ddlObjectType(input.objectType);
  const dictType = ddlDictionaryType(input.objectType);
  if (!ddlType || !dictType || input.names.length === 0) {
    return definitions;
  }
  const binds: Record<string, string> = {
    owner: input.owner,
    ddlType,
    dictType,
  };
  for (const [index, name] of input.names.entries()) {
    binds[`n${index}`] = name;
  }
  const rows = await select(buildBatchDdlSql(input.names.length), binds);
  for (const row of rows) {
    const name = asString(cell(row, 0));
    const source = asNullableString(cell(row, 1));
    if (!name || !source) {
      continue;
    }
    definitions.set(name, { source, hash: hashSource(source), error: null, skipped: false });
  }
  return definitions;
}

function tryQuote(value: string): string | null {
  try {
    return quoteOracleIdent(value);
  } catch {
    return null;
  }
}

function quoteList(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  const quoted = values.map((value) => tryQuote(value));
  if (quoted.some((value) => value == null)) {
    return null;
  }
  return quoted.join(", ");
}

function definitionFromSource(source: string | null): ObjectDefinition | undefined {
  if (!source?.trim()) {
    return undefined;
  }
  return { source, hash: hashSource(source), error: null, skipped: false };
}

export function synthesizeIndexSource(input: {
  owner: string;
  name: string;
  tableName: string;
  uniqueness?: string | null;
  indexType?: string | null;
  columns: Array<{ name: string; descend?: string | null }>;
}): string | null {
  const indexType = (input.indexType ?? "NORMAL").toUpperCase();
  if (indexType !== "NORMAL" && indexType !== "NORMAL/REV" && indexType !== "BITMAP") {
    return null;
  }
  if (input.columns.length === 0) {
    return null;
  }
  const owner = tryQuote(input.owner);
  const name = tryQuote(input.name);
  const table = tryQuote(input.tableName);
  if (!owner || !name || !table) {
    return null;
  }
  const cols: string[] = [];
  for (const column of input.columns) {
    const ident = tryQuote(column.name);
    if (!ident) {
      return null;
    }
    cols.push((column.descend ?? "").toUpperCase() === "DESC" ? `${ident} DESC` : ident);
  }
  const unique =
    indexType === "BITMAP"
      ? ""
      : (input.uniqueness ?? "").toUpperCase() === "UNIQUE"
        ? "UNIQUE "
        : "";
  const bitmap = indexType === "BITMAP" ? "BITMAP " : "";
  return `CREATE ${bitmap}${unique}INDEX ${owner}.${name} ON ${owner}.${table} (${cols.join(", ")})`;
}

export function synthesizeConstraintSource(input: {
  owner: string;
  name: string;
  tableName: string;
  constraintType: string;
  columns: string[];
  searchCondition?: string | null;
  referencedOwner?: string | null;
  referencedTable?: string | null;
  referencedColumns?: string[];
  deleteRule?: string | null;
}): string | null {
  const owner = tryQuote(input.owner);
  const name = tryQuote(input.name);
  const table = tryQuote(input.tableName);
  if (!owner || !name || !table) {
    return null;
  }
  const tableRef = `${owner}.${table}`;
  switch (input.constraintType) {
    case "P": {
      const cols = quoteList(input.columns);
      return cols ? `ALTER TABLE ${tableRef} ADD CONSTRAINT ${name} PRIMARY KEY (${cols})` : null;
    }
    case "U": {
      const cols = quoteList(input.columns);
      return cols ? `ALTER TABLE ${tableRef} ADD CONSTRAINT ${name} UNIQUE (${cols})` : null;
    }
    case "C":
      if (!input.searchCondition?.trim()) {
        return null;
      }
      return `ALTER TABLE ${tableRef} ADD CONSTRAINT ${name} CHECK (${input.searchCondition.trim()})`;
    case "R": {
      const cols = quoteList(input.columns);
      const referencedColumns = quoteList(input.referencedColumns ?? []);
      const referencedOwner = input.referencedOwner ? tryQuote(input.referencedOwner) : null;
      const referencedTable = input.referencedTable ? tryQuote(input.referencedTable) : null;
      if (!cols || !referencedColumns || !referencedOwner || !referencedTable) {
        return null;
      }
      let sql = `ALTER TABLE ${tableRef} ADD CONSTRAINT ${name} FOREIGN KEY (${cols}) REFERENCES ${referencedOwner}.${referencedTable} (${referencedColumns})`;
      const rule = (input.deleteRule ?? "").toUpperCase();
      if (rule === "CASCADE") {
        sql += " ON DELETE CASCADE";
      } else if (rule === "SET NULL") {
        sql += " ON DELETE SET NULL";
      }
      return sql;
    }
    default:
      return null;
  }
}

function applyInlineDefinitions(
  objects: Map<string, CatalogObject>,
  input: {
    owner: string;
    constraintInfo: Map<
      string,
      {
        tableName: string;
        constraintType: string;
        searchCondition: string | null;
        referencedOwner: string | null;
        referencedConstraint: string | null;
        deleteRule: string | null;
      }
    >;
    constraintColumns: Map<string, string[]>;
    indexColumns: Map<string, Array<{ name: string; descend: string | null }>>;
    sources: Map<string, string[]>;
  },
): void {
  for (const object of objects.values()) {
    if (object.owner !== input.owner) {
      continue;
    }
    const key = objectKey(object.owner, object.name, object.objectType);
    if (object.objectType === "INDEX") {
      const source = synthesizeIndexSource({
        owner: object.owner,
        name: object.name,
        tableName: object.metadata.tableName ?? "",
        uniqueness: object.metadata.uniqueness,
        indexType: object.metadata.indexType,
        columns: input.indexColumns.get(key) ?? [],
      });
      object.inlineDefinition = definitionFromSource(source);
      continue;
    }
    if (object.objectType === "CONSTRAINT") {
      const info = input.constraintInfo.get(key);
      const referencedKey =
        info?.referencedOwner && info.referencedConstraint
          ? objectKey(info.referencedOwner.toUpperCase(), info.referencedConstraint, "CONSTRAINT")
          : null;
      const referenced = referencedKey ? input.constraintInfo.get(referencedKey) : undefined;
      const source = synthesizeConstraintSource({
        owner: object.owner,
        name: object.name,
        tableName: info?.tableName ?? object.metadata.tableName ?? "",
        constraintType: info?.constraintType ?? object.metadata.constraintType ?? "",
        columns: input.constraintColumns.get(key) ?? [],
        searchCondition: info?.searchCondition,
        referencedOwner: info?.referencedOwner,
        referencedTable: referenced?.tableName,
        referencedColumns: referencedKey ? (input.constraintColumns.get(referencedKey) ?? []) : [],
        deleteRule: info?.deleteRule,
      });
      object.inlineDefinition = definitionFromSource(source);
      continue;
    }
    const sourceLines = input.sources.get(key);
    if (sourceLines?.join("").trim()) {
      object.inlineDefinition = definitionFromSource(sourceLines.join(""));
      continue;
    }
    if (object.objectType === "SCHEDULER_JOB") {
      object.inlineDefinition = { source: null, hash: null, error: null, skipped: false };
    }
  }
}
