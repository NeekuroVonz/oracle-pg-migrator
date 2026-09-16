"use client";

import {
  missingRelationFromError,
  refsIncludedInScope,
  type DeployObjectDto,
  type DeployRunDto,
  type UpsertScopeInput,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MigrationGuide, MigrationStepCallout } from "@/components/migration-guide";
import { Pagination } from "@/components/pagination";
import { RunNav } from "@/components/run-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { DEFAULT_PAGE_SIZE, pageCount, paginate } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type ObjectFilter = "failed" | "all" | "succeeded";

function missingTableLabel(object: DeployObjectDto): string | null {
  const missing = missingRelationFromError(object.errorMessage, object.owner);
  return missing ? `${missing.owner}.${missing.name}` : null;
}

function isMultiplePrimaryKeyError(message: string | null | undefined): boolean {
  return Boolean(message && /multiple primary keys/i.test(message));
}

function scopeRulesFromDto(scope: {
  includeSchemas: string[];
  includeObjectTypes: UpsertScopeInput["includeObjectTypes"];
  includeNamePatterns: string[];
  excludeNamePatterns: string[];
  excludeObjects: string[];
  dataMode: UpsertScopeInput["dataMode"];
  selectedTables: string[];
}): UpsertScopeInput {
  return {
    includeSchemas: scope.includeSchemas,
    includeObjectTypes: scope.includeObjectTypes,
    includeNamePatterns: scope.includeNamePatterns,
    excludeNamePatterns: scope.excludeNamePatterns,
    excludeObjects: scope.excludeObjects,
    dataMode: scope.dataMode,
    selectedTables: scope.selectedTables,
  };
}

export default function DeployPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [deploy, setDeploy] = useState<DeployRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);
  const [filter, setFilter] = useState<ObjectFilter>("failed");
  const [including, setIncluding] = useState<string | null>(null);
  const [includeMessage, setIncludeMessage] = useState<string | null>(null);
  const [includedRefs, setIncludedRefs] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    const data = await api.getRunDeploy(params.id, params.runId);
    setDeploy(data);
    return data;
  }, [params.id, params.runId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load deploy");
    });
  }, [load]);

  const status = deploy?.status;
  useEffect(() => {
    if (status !== "QUEUED" && status !== "RUNNING") {
      return;
    }
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status, load]);

  useEffect(() => {
    if (!deploy) {
      return;
    }
    if (deploy.failedCount > 0) {
      setFilter("failed");
    } else {
      setFilter("all");
    }
    setListPage(1);
    setFailedPage(1);
  }, [deploy?.id, deploy?.failedCount]);

  async function start(): Promise<void> {
    setPending(true);
    setError(null);
    setIncludeMessage(null);
    try {
      const data = await api.startRunDeploy(params.id, params.runId);
      setDeploy(data);
      setListPage(1);
      setFailedPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start deploy");
    } finally {
      setPending(false);
    }
  }

  async function includeMissing(refs: string[]): Promise<void> {
    const unique = [...new Set(refs)].filter((ref) => !includedRefs.has(ref));
    if (unique.length === 0) {
      return;
    }
    setIncluding(unique.join(","));
    setIncludeMessage(null);
    setError(null);
    try {
      const result = await api.includeScopeObjects(params.id, unique);
      setIncludedRefs((prev) => {
        const next = new Set(prev);
        for (const ref of result.included) {
          next.add(ref.toUpperCase());
        }
        return next;
      });
      setIncludeMessage(
        `Included ${result.included.join(", ")} in scope (now selected for conversion). Open Runs → Start Schema run, wait until those tables are VALIDATED, then Deploy again. Include alone does not create tables on TARGET.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not include table in scope");
    } finally {
      setIncluding(null);
    }
  }

  const active = status === "QUEUED" || status === "RUNNING";

  const failedObjects = useMemo(
    () => (deploy?.objects ?? []).filter((object) => object.status === "FAILED"),
    [deploy?.objects],
  );
  const succeededObjects = useMemo(
    () => (deploy?.objects ?? []).filter((object) => object.status === "SUCCEEDED"),
    [deploy?.objects],
  );
  const filteredObjects = useMemo(() => {
    if (!deploy) {
      return [];
    }
    if (filter === "failed") {
      return failedObjects;
    }
    if (filter === "succeeded") {
      return succeededObjects;
    }
    return deploy.objects;
  }, [deploy, filter, failedObjects, succeededObjects]);

  const missingTables = useMemo(() => {
    const refs = new Set<string>();
    for (const object of failedObjects) {
      const label = missingTableLabel(object);
      if (label) {
        refs.add(label);
      }
    }
    return [...refs].sort();
  }, [failedObjects]);

  const pendingMissingTables = useMemo(
    () => missingTables.filter((ref) => !includedRefs.has(ref)),
    [missingTables, includedRefs],
  );

  const tablesInThisDeploy = useMemo(() => {
    const names = new Set<string>();
    for (const object of deploy?.objects ?? []) {
      if (String(object.objectType).toUpperCase() === "TABLE") {
        names.add(`${object.owner.toUpperCase()}.${object.name.toUpperCase()}`);
      }
    }
    return names;
  }, [deploy?.objects]);

  const missingNotInDeploy = useMemo(
    () => missingTables.filter((ref) => !tablesInThisDeploy.has(ref)),
    [missingTables, tablesInThisDeploy],
  );

  const missingTablesKey = missingTables.join(",");
  useEffect(() => {
    if (missingTables.length === 0) {
      return;
    }
    let cancelled = false;
    api
      .getScope(params.id)
      .then(({ scope }) => {
        if (cancelled) {
          return;
        }
        const already = refsIncludedInScope(scopeRulesFromDto(scope), missingTables);
        if (already.length === 0) {
          return;
        }
        setIncludedRefs((prev) => {
          const next = new Set(prev);
          for (const ref of already) {
            next.add(ref);
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params.id, missingTablesKey, missingTables]);

  const failedPages = pageCount(failedObjects.length, DEFAULT_PAGE_SIZE);
  const currentFailedPage = Math.min(failedPage, failedPages);
  const listPages = pageCount(filteredObjects.length, DEFAULT_PAGE_SIZE);
  const currentListPage = Math.min(listPage, listPages);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <RunNav />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Deploy</h1>
          <p className="mt-1 text-sm text-muted">
            Applies VALIDATED SQL in DAG order to the PostgreSQL target. This is explicit and never
            automatic. Existing objects may cause failures. Deploy before data copy so tables exist.
          </p>
        </div>
        <Button onClick={() => void start()} disabled={pending || active}>
          {pending ? "Starting…" : deploy ? "Start new deploy" : "Start deploy"}
        </Button>
      </div>
      <MigrationStepCallout title="Step 5 of 6 — create objects on TARGET">
        <p>
          Deploy applies VALIDATED SQL (schemas, tables, indexes, …) to PostgreSQL. Do this before{" "}
          <Link
            href={`/projects/${params.id}/runs/${params.runId}/data-copy`}
            className="font-medium text-accent hover:underline"
          >
            Data copy
          </Link>
          . Convert alone only validates in the sandbox — it does not create TARGET objects.
        </p>
      </MigrationStepCallout>
      <MigrationGuide
        projectId={params.id}
        runId={params.runId}
        highlight="deploy"
        compact
        className="mt-4"
      />
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {includeMessage ? <p className="mt-4 text-sm text-accent">{includeMessage}</p> : null}
      {!deploy ? (
        <Card className="mt-6">
          <p className="text-sm text-muted">
            No deploy yet. Conversion must finish with at least one VALIDATED object that has target
            SQL.
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Badge>{deploy.status}</Badge>
            <Badge>{deploy.gateStatus}</Badge>
            <p className="text-sm text-muted">
              deployed {deploy.deployedCount}/{deploy.objectCount} · failed {deploy.failedCount}
            </p>
          </div>
          {deploy.gateStatus !== "READY_FOR_DEPLOYMENT" ? (
            <p className="mt-2 text-sm text-muted">
              Gate is {deploy.gateStatus}. Only VALIDATED objects are applied; blockers stay
              undeployed.
            </p>
          ) : null}
          {deploy.errorMessage ? (
            <p
              className={
                deploy.status === "FAILED"
                  ? "mt-2 text-sm text-danger"
                  : "mt-2 text-sm text-muted"
              }
            >
              {deploy.errorMessage}
            </p>
          ) : null}

          {failedObjects.length > 0 ? (
            <Card className="mt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Failed objects ({failedObjects.length})</CardTitle>
                  <p className="mt-1 text-sm text-muted">
                    <strong className="text-foreground">Include ≠ create on TARGET.</strong>{" "}
                    &quot;Already in scope&quot; only means Schema can convert those tables.
                    Convert SUCCEEDED (sandbox) does not put tables on PostgreSQL. Indexes fail
                    until a Deploy actually creates the parent TABLE. Use{" "}
                    <strong className="text-foreground">Latest</strong> run →{" "}
                    <strong className="text-foreground">Start new deploy</strong>. Deploy now
                    force-queues parent TABLEs for failing indexes (even if they were missing from
                    the list before).
                  </p>
                </div>
                {pendingMissingTables.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={including !== null}
                    onClick={() => void includeMissing(pendingMissingTables)}
                  >
                    {including !== null
                      ? "Including…"
                      : `Include all missing (${pendingMissingTables.length})`}
                  </Button>
                ) : missingTables.length > 0 ? (
                  <Button type="button" variant="secondary" disabled>
                    All missing included
                  </Button>
                ) : null}
              </div>
              {missingTables.length > 0 ? (
                <p className="mt-2 text-sm text-muted">
                  Missing relations: {missingTables.join(", ")}
                  {includedRefs.size > 0
                    ? ` · already in scope ${missingTables.filter((ref) => includedRefs.has(ref)).length}/${missingTables.length} (survives refresh)`
                    : " · none of these are in scope yet — Include first"}
                  {missingNotInDeploy.length > 0
                    ? ` · ${missingNotInDeploy.length} parent TABLE(s) are not in this deploy list — use Latest run after Schema, then Start new deploy`
                    : " · parent TABLE(s) are in this deploy list — Start new deploy to create them on TARGET"}
                </p>
              ) : null}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-muted">
                    <tr>
                      <th className="px-2 py-2 font-medium">Oracle</th>
                      <th className="px-2 py-2 font-medium">Type</th>
                      <th className="px-2 py-2 font-medium">Error</th>
                      <th className="px-2 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginate(failedObjects, currentFailedPage, DEFAULT_PAGE_SIZE).map((object) => {
                      const missing = missingTableLabel(object);
                      return (
                        <tr key={object.id} className="border-b border-border last:border-0">
                          <td className="px-2 py-2">
                            {object.owner}.{object.name}
                          </td>
                          <td className="px-2 py-2 text-muted">{object.objectType}</td>
                          <td className="px-2 py-2 text-danger">{object.errorMessage ?? "—"}</td>
                          <td className="px-2 py-2">
                            {missing ? (
                              includedRefs.has(missing) ? (
                                <Button type="button" size="sm" variant="secondary" disabled>
                                  Included
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={including !== null}
                                  onClick={() => void includeMissing([missing])}
                                >
                                  {including?.split(",").includes(missing)
                                    ? "Including…"
                                    : `Include ${missing}`}
                                </Button>
                              )
                            ) : isMultiplePrimaryKeyError(object.errorMessage) ? (
                              <span className="text-muted">
                                PK already on table — re-deploy
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {failedObjects.length > DEFAULT_PAGE_SIZE ? (
                <div className="mt-3">
                  <Pagination
                    page={currentFailedPage}
                    pageSize={DEFAULT_PAGE_SIZE}
                    total={failedObjects.length}
                    onPageChange={setFailedPage}
                    label="failed objects"
                  />
                </div>
              ) : null}
            </Card>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {(
              [
                ["failed", `Failed (${failedObjects.length})`],
                ["all", `All (${deploy.objects.length})`],
                ["succeeded", `Succeeded (${succeededObjects.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setFilter(id);
                  setListPage(1);
                }}
                className={cn(
                  "inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium",
                  filter === id
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-border bg-surface-raised text-foreground hover:border-accent",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {filter !== "failed" || failedObjects.length === 0 ? (
            <Card className="mt-4 overflow-x-auto p-0">
              <CardTitle className="sr-only">Objects</CardTitle>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Oracle</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">PostgreSQL</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(filteredObjects, currentListPage, DEFAULT_PAGE_SIZE).map((object) => (
                    <tr key={object.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        {object.owner}.{object.name}
                      </td>
                      <td className="px-4 py-3 text-muted">{object.objectType}</td>
                      <td className="px-4 py-3 text-muted">
                        {object.targetSchema && object.targetName
                          ? `${object.targetSchema}.${object.targetName}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{object.status}</Badge>
                        {object.errorMessage ? (
                          <p className="mt-1 text-danger">{object.errorMessage}</p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredObjects.length > DEFAULT_PAGE_SIZE ? (
                <div className="border-t border-border px-4 py-3">
                  <Pagination
                    page={currentListPage}
                    pageSize={DEFAULT_PAGE_SIZE}
                    total={filteredObjects.length}
                    onPageChange={setListPage}
                    label="objects"
                  />
                </div>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
