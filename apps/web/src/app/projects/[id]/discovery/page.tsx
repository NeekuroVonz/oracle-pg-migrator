"use client";

import {
  DISCOVERED_OBJECT_SORT_FIELDS,
  type DiscoveredObjectDto,
  type DiscoveredObjectSortField,
  type DiscoveredObjectSummaryDto,
  type DiscoveryInventoryDto,
  type DiscoveryRunDto,
  type ObjectDependencyDto,
  ORACLE_OBJECT_TYPES,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ReadOnlyCallout } from "@/components/read-only-callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const INVENTORY_PAGE_SIZE = 100;

export default function DiscoveryPage() {
  const params = useParams<{ id: string }>();
  const [schemas, setSchemas] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [inventory, setInventory] = useState<DiscoveryInventoryDto | null>(null);
  const [objectType, setObjectType] = useState<string>("");
  const [owner, setOwner] = useState("");
  const [query, setQuery] = useState("");
  const [extracted, setExtracted] = useState("");
  const [hasRows, setHasRows] = useState("");
  const [sortBy, setSortBy] = useState<DiscoveredObjectSortField>("owner");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DiscoveredObjectDto | null>(null);
  const [dependencies, setDependencies] = useState<ObjectDependencyDto[]>([]);
  const [pending, setPending] = useState(false);

  const loadInventory = useCallback(async () => {
    const data = await api.getInventory(params.id, {
      objectType: objectType || undefined,
      owner: owner || undefined,
      q: query.trim() || undefined,
      extracted: extracted || undefined,
      hasRows: hasRows || undefined,
      sortBy,
      sortDir,
      page,
      pageSize: INVENTORY_PAGE_SIZE,
    });
    setInventory(data);
    return data;
  }, [params.id, objectType, owner, query, extracted, hasRows, sortBy, sortDir, page]);

  function changeObjectType(nextType: string) {
    setObjectType(nextType);
    setPage(1);
  }

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function changeSort(field: DiscoveredObjectSortField, direction?: "asc" | "desc") {
    if (direction) {
      setSortBy(field);
      setSortDir(direction);
    } else if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir(
        field === "estimatedRowCount" || field === "byteSize" || field === "lastDdlTime"
          ? "desc"
          : "asc",
      );
    }
    setPage(1);
  }

  function resetFilters() {
    setObjectType("");
    setOwner("");
    setQuery("");
    setExtracted("");
    setHasRows("");
    setSortBy("owner");
    setSortDir("asc");
    setPage(1);
  }

  const filtersActive =
    Boolean(objectType || owner || query || extracted || hasRows) ||
    sortBy !== "owner" ||
    sortDir !== "asc";

  useEffect(() => {
    let cancelled = false;
    api
      .listDiscoverySchemas(params.id)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSchemas(result.schemas);
        setSuggested(result.suggested);
        setSelected(result.suggested);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not list Oracle schemas");
        }
      });
    loadInventory().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Could not load inventory");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [params.id, loadInventory]);

  const runStatus = inventory?.run?.status;
  useEffect(() => {
    if (runStatus !== "QUEUED" && runStatus !== "RUNNING") {
      return;
    }
    const timer = window.setInterval(() => {
      loadInventory().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [runStatus, loadInventory]);

  async function startDiscovery() {
    setPending(true);
    setError(null);
    try {
      await api.startDiscovery(params.id, selected);
      await loadInventory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed to start");
    } finally {
      setPending(false);
    }
  }

  async function openObject(object: DiscoveredObjectSummaryDto) {
    setError(null);
    try {
      const [full, deps] = await Promise.all([
        api.getDiscoveredObject(params.id, object.id),
        api.getObjectDependencies(params.id, object.id),
      ]);
      setDetail(full);
      setDependencies(deps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load object");
    }
  }

  const totals = inventory?.totals ?? {};
  const running = runStatus === "QUEUED" || runStatus === "RUNNING";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Discovery</h1>
        <p className="mt-1 text-sm text-muted">
          Inventory Oracle schemas and object definitions. Source access stays read-only. The first
          run calls <span className="font-mono">GET_DDL</span> in batches for tables, views, and
          sequences. Index and constraint DDL is built from the Oracle dictionary, which is much
          faster. Later runs skip unchanged objects.
        </p>
      </div>
      <ReadOnlyCallout />
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Schemas</CardTitle>
          <Badge>{progressBadge(inventory?.run)}</Badge>
        </div>
        {schemas.length === 0 ? (
          <p className="text-sm text-muted">
            No schemas loaded. Test the Oracle connection first, or wait until a listener is
            available.{" "}
            <Link className="underline" href={`/projects/${params.id}/connections`}>
              Open connections
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Only checked schemas are scanned. Other names are users visible on this Oracle
              instance (for example HR sample schema). They are not selected just because the login
              can see them.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {schemas.map((schema) => {
                const checked = selected.includes(schema);
                const extra = !suggested.includes(schema);
                return (
                  <label key={schema} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelected((current) =>
                          checked
                            ? current.filter((value) => value !== schema)
                            : [...current, schema],
                        );
                      }}
                    />
                    <span>{schema}</span>
                    {extra ? <span className="text-xs text-muted">visible on instance</span> : null}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <Button onClick={startDiscovery} disabled={pending || running || selected.length === 0}>
          {running ? "Discovery running…" : pending ? "Starting…" : "Start discovery"}
        </Button>
        {running ? <p className="text-sm text-muted">{progressMessage(inventory?.run)}</p> : null}
        {inventory?.run?.errorMessage ? (
          <p className="text-sm text-danger">{inventory.run.errorMessage}</p>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ORACLE_OBJECT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => changeObjectType(objectType === type ? "" : type)}
            className={`rounded-lg border px-3 py-3 text-left ${
              objectType === type
                ? "border-accent bg-surface-raised"
                : "border-border bg-surface hover:bg-surface-raised"
            }`}
          >
            <p className="text-xs text-muted">{type.replaceAll("_", " ")}</p>
            <p className="mt-1 text-xl font-semibold">{(totals[type] ?? 0).toLocaleString()}</p>
          </button>
        ))}
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="Search name or owner" className="min-w-48 flex-[2]">
            <Input value={query} onChange={(event) => changeFilter(setQuery, event.target.value)} />
          </FilterField>
          <FilterField label="Owner">
            <Select value={owner} onChange={(event) => changeFilter(setOwner, event.target.value)}>
              <option value="">All owners</option>
              {(inventory?.owners ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Object type">
            <Select value={objectType} onChange={(event) => changeObjectType(event.target.value)}>
              <option value="">All types</option>
              {ORACLE_OBJECT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Extracted">
            <Select
              value={extracted}
              onChange={(event) => changeFilter(setExtracted, event.target.value)}
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </FilterField>
          <FilterField label="Rows">
            <Select
              value={hasRows}
              onChange={(event) => changeFilter(setHasRows, event.target.value)}
            >
              <option value="">All</option>
              <option value="yes">Has rows</option>
              <option value="no">Empty / unknown</option>
            </Select>
          </FilterField>
          <FilterField label="Sort by">
            <Select
              value={sortBy}
              onChange={(event) =>
                changeSort(event.target.value as DiscoveredObjectSortField, sortDir)
              }
            >
              {DISCOVERED_OBJECT_SORT_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {sortFieldLabel(field)}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Direction">
            <Select
              value={sortDir}
              onChange={(event) => changeSort(sortBy, event.target.value as "asc" | "desc")}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </Select>
          </FilterField>
          <div className="flex items-center gap-3 pb-0.5">
            {filtersActive ? (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Clear
              </Button>
            ) : null}
            <p className="text-sm text-muted">
              {inventoryRange(page, INVENTORY_PAGE_SIZE, inventory?.total ?? 0)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted">
          Rows come from Oracle optimizer stats, not a live COUNT(*). Size uses allocated segments
          when available. Temp and unanalyzed tables often have no stats.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <SortHeader
                  field="owner"
                  label="Owner"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={changeSort}
                />
                <SortHeader
                  field="name"
                  label="Name"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={changeSort}
                />
                <SortHeader
                  field="objectType"
                  label="Type"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={changeSort}
                />
                <SortHeader
                  field="estimatedRowCount"
                  label="Rows"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={changeSort}
                />
                <SortHeader
                  field="byteSize"
                  label="Size"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={changeSort}
                />
                <SortHeader
                  field="lastDdlTime"
                  label="Last DDL"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={changeSort}
                />
                <SortHeader
                  field="extracted"
                  label="Extracted"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={changeSort}
                />
              </tr>
            </thead>
            <tbody>
              {(inventory?.objects ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-muted">
                    {(inventory?.total ?? 0) === 0
                      ? "No objects match this filter."
                      : "No objects on this page."}
                  </td>
                </tr>
              ) : (
                (inventory?.objects ?? []).map((object) => (
                  <tr key={object.id} className="border-b border-border/70">
                    <td className="py-2 font-mono text-xs">{object.owner}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => openObject(object)}
                      >
                        {object.name}
                      </button>
                    </td>
                    <td className="py-2 text-muted">{object.objectType.replaceAll("_", " ")}</td>
                    <td
                      className="py-2 text-muted"
                      title={
                        object.estimatedRowCount == null
                          ? "Oracle has no optimizer stats (NUM_ROWS) for this object."
                          : undefined
                      }
                    >
                      {object.estimatedRowCount?.toLocaleString() ?? "No stats"}
                    </td>
                    <td
                      className="py-2 text-muted"
                      title={
                        object.byteSize == null
                          ? "Oracle has no segment size or block stats for this object."
                          : undefined
                      }
                    >
                      {formatBytes(object.byteSize)}
                    </td>
                    <td className="py-2 text-muted" title={object.lastDdlTime ?? undefined}>
                      {formatTimestamp(object.lastDdlTime)}
                    </td>
                    <td className="py-2 text-muted">{object.sourceHash ? "Yes" : "No"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <InventoryPagination
          page={page}
          pageSize={INVENTORY_PAGE_SIZE}
          total={inventory?.total ?? 0}
          onPageChange={setPage}
        />
      </Card>

      {detail ? (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>
              {detail.owner}.{detail.name}
            </CardTitle>
            <Badge>{detail.objectType.replaceAll("_", " ")}</Badge>
          </div>
          {detail.metadata.columns && detail.metadata.columns.length > 0 ? (
            <p className="text-sm text-muted">
              {detail.metadata.columns.length} columns
              {detail.metadata.partitions?.length
                ? ` · ${detail.metadata.partitions.length} partitions`
                : ""}
            </p>
          ) : null}
          {detail.metadata.extractError ? (
            <p className="text-sm text-warning">{detail.metadata.extractError}</p>
          ) : null}
          <pre className="max-h-80 overflow-auto rounded-md bg-background p-3 font-mono text-xs">
            {detail.sourceText ?? "No DDL extracted."}
          </pre>
          {dependencies.length > 0 ? (
            <div className="text-sm">
              <p className="mb-2 font-medium">Dependencies</p>
              <ul className="space-y-1 text-muted">
                {dependencies.map((dependency) => (
                  <li key={dependency.id}>
                    {dependency.fromOwner}.{dependency.fromName} → {dependency.toOwner}.
                    {dependency.toName} ({dependency.dependencyType})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function FilterField(props: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-36 flex-1 space-y-1.5", props.className)}>
      <p className="text-xs text-muted">{props.label}</p>
      {props.children}
    </div>
  );
}

function SortHeader(props: {
  field: DiscoveredObjectSortField;
  label: string;
  sortBy: DiscoveredObjectSortField;
  sortDir: "asc" | "desc";
  onSort: (field: DiscoveredObjectSortField) => void;
}) {
  const active = props.sortBy === props.field;
  return (
    <th className="py-2 font-medium">
      <button
        type="button"
        className={`hover:text-foreground ${active ? "text-foreground" : ""}`}
        onClick={() => props.onSort(props.field)}
      >
        {props.label}
        {active ? (props.sortDir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function sortFieldLabel(field: DiscoveredObjectSortField): string {
  switch (field) {
    case "owner":
      return "Owner";
    case "name":
      return "Name";
    case "objectType":
      return "Type";
    case "estimatedRowCount":
      return "Rows";
    case "byteSize":
      return "Size";
    case "lastDdlTime":
      return "Last DDL";
    case "extracted":
      return "Extracted";
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

function formatBytes(value: number | null): string {
  if (value == null) {
    return "No stats";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return parsed.toLocaleDateString();
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function inventoryRange(page: number, pageSize: number, total: number): string {
  if (total === 0) {
    return "0 objects";
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`;
}

function InventoryPagination(props: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = pageCount(props.total, props.pageSize);
  if (props.total <= props.pageSize) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        Page {props.page} of {pages.toLocaleString()}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={props.page <= 1}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.page >= pages}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function runStats(run: DiscoveryRunDto | null | undefined): {
  phase?: string;
  processed?: number;
  total?: number;
} {
  const stats = run?.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return {};
  }
  const record = stats as { phase?: unknown; processed?: unknown; total?: unknown };
  return {
    phase: typeof record.phase === "string" ? record.phase : undefined,
    processed: typeof record.processed === "number" ? record.processed : undefined,
    total: typeof record.total === "number" ? record.total : undefined,
  };
}

function progressBadge(run: DiscoveryRunDto | null | undefined): string {
  if (!run) {
    return "Not started";
  }
  if (run.status !== "QUEUED" && run.status !== "RUNNING") {
    return run.status;
  }
  const stats = runStats(run);
  const total = stats.total ?? run.objectCount;
  const done = stats.processed ?? Math.min(run.extractedCount + run.skippedUnchangedCount, total);
  if (total > 0) {
    return `${run.status} · ${done}/${total}`;
  }
  return run.status;
}

function progressMessage(run: DiscoveryRunDto | null | undefined): string {
  const stats = runStats(run);
  if (stats.phase === "catalog" || !run || run.objectCount === 0) {
    return "Reading Oracle data dictionary (objects, columns, constraints, indexes). Object counts appear after this step.";
  }
  if (stats.phase === "dependencies") {
    return "Reading ALL_DEPENDENCIES…";
  }
  const total = stats.total ?? run.objectCount;
  const done = stats.processed ?? Math.min(run.extractedCount + run.skippedUnchangedCount, total);
  return `Extracting remaining table/view/sequence DDL ${done} / ${total} in batches. Indexes and constraints are already built from the dictionary.`;
}
