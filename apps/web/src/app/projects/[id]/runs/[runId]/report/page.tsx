"use client";

import {
  refsIncludedInScope,
  type MigrationReportDto,
  type ReportGateStatus,
  type UpsertScopeInput,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MigrationStepCallout } from "@/components/migration-guide";
import { Pagination } from "@/components/pagination";
import { RunNav } from "@/components/run-nav";
import { StrategyBadge } from "@/components/strategy-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { DEFAULT_PAGE_SIZE, pageCount, paginate } from "@/lib/pagination";

const DIMENSIONS: Array<{
  key:
    | "schemaPercent"
    | "dataPercent"
    | "compilePercent"
    | "behaviorPercent"
    | "performancePercent"
    | "constraintsPercent"
    | "sequencesPercent";
  label: string;
  weight: string;
}> = [
  { key: "schemaPercent", label: "Schema", weight: "15%" },
  { key: "dataPercent", label: "Data", weight: "15%" },
  { key: "compilePercent", label: "Compile", weight: "20%" },
  { key: "behaviorPercent", label: "Behavior", weight: "20%" },
  { key: "performancePercent", label: "Performance", weight: "10%" },
  { key: "constraintsPercent", label: "Constraints", weight: "15%" },
  { key: "sequencesPercent", label: "Sequences", weight: "5%" },
];

function gateClass(status: ReportGateStatus): string {
  if (status === "READY_FOR_DEPLOYMENT") {
    return "border-accent text-accent";
  }
  if (status === "BLOCKED") {
    return "border-danger text-danger";
  }
  return "";
}

function formatPercent(value: number | null): string {
  return value == null ? "n/a" : `${value}%`;
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

export default function ReportPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [report, setReport] = useState<MigrationReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlPending, setSqlPending] = useState(false);
  const [blockerPage, setBlockerPage] = useState(1);
  const [including, setIncluding] = useState<string | null>(null);
  const [includeMessage, setIncludeMessage] = useState<string | null>(null);
  const [includedRefs, setIncludedRefs] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    const data = await api.getRunReport(params.id, params.runId);
    setReport(data);
    return data;
  }, [params.id, params.runId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load report");
    });
  }, [load]);

  const gateStatus = report?.gateStatus;
  useEffect(() => {
    if (gateStatus !== "IN_PROGRESS") {
      return;
    }
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [gateStatus, load]);

  const missingBlockerTables = useMemo(() => {
    if (!report) {
      return [] as string[];
    }
    const refs = new Set<string>();
    for (const item of report.blocking) {
      if (item.missingTable) {
        refs.add(item.missingTable.toUpperCase());
      }
    }
    return [...refs];
  }, [report]);

  const missingBlockerKey = missingBlockerTables.join(",");
  useEffect(() => {
    if (missingBlockerTables.length === 0) {
      return;
    }
    let cancelled = false;
    api
      .getScope(params.id)
      .then(({ scope }) => {
        if (cancelled) {
          return;
        }
        const already = refsIncludedInScope(scopeRulesFromDto(scope), missingBlockerTables);
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
  }, [params.id, missingBlockerKey, missingBlockerTables]);

  async function includeMissingTable(missingTable: string): Promise<void> {
    if (includedRefs.has(missingTable)) {
      return;
    }
    setIncluding(missingTable);
    setIncludeMessage(null);
    setError(null);
    try {
      const result = await api.includeScopeObjects(params.id, [missingTable]);
      setIncludedRefs((prev) => {
        const next = new Set(prev);
        for (const ref of result.included) {
          next.add(ref.toUpperCase());
        }
        return next;
      });
      setIncludeMessage(
        `Included ${result.included.join(", ")} in scope (now selected for conversion). Start a new Schema run, wait until VALIDATED, then Deploy again.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not include table in scope");
    } finally {
      setIncluding(null);
    }
  }

  function downloadJson(): void {
    if (!report) {
      return;
    }
    downloadText(
      `run-${params.runId.slice(0, 8)}-report.json`,
      `${JSON.stringify(report, null, 2)}\n`,
      "application/json",
    );
  }

  async function downloadSql(): Promise<void> {
    setSqlPending(true);
    setError(null);
    try {
      const bundle = await api.getRunReportSql(params.id, params.runId);
      downloadText(bundle.filename, bundle.sql, "text/plain");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not download SQL");
    } finally {
      setSqlPending(false);
    }
  }

  if (error && !report) {
    return <p className="px-8 py-8 text-sm text-danger">{error}</p>;
  }
  if (!report) {
    return <p className="px-8 py-8 text-sm text-muted">Loading…</p>;
  }

  const objectHref = (objectId: string) =>
    `/projects/${params.id}/runs/${params.runId}/objects/${objectId}`;
  const blockerPages = pageCount(report.blocking.length, DEFAULT_PAGE_SIZE);
  const currentBlockerPage = Math.min(blockerPage, blockerPages);
  const blockerRows = paginate(report.blocking, currentBlockerPage, DEFAULT_PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <RunNav />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Migration report</h1>
        <StrategyBadge strategy={report.strategy} />
        <Badge className={gateClass(report.gateStatus)}>{report.gateStatus}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted">
        Weighted readiness {report.readiness.overallPercent}% · {report.validatedCount}/
        {report.inScopeCount} in-scope validated · {report.blockingCount} blockers
      </p>
      <p className="mt-1 text-sm text-muted">
        Compile success is not VALIDATED and is not READY_FOR_DEPLOYMENT. Data is row-count match
        after copy. Performance stays omitted.
      </p>
      <MigrationStepCallout title="Next steps">
        <ol className="list-decimal space-y-1 pl-4">
          <li>Clear blockers below (Include out-of-scope tables if needed, then re-run Schema).</li>
          <li>
            When ready:{" "}
            <Link
              href={`/projects/${params.id}/runs/${params.runId}/deploy`}
              className="font-medium text-accent hover:underline"
            >
              Deploy
            </Link>{" "}
            VALIDATED SQL to TARGET.
          </li>
          <li>
            Then{" "}
            <Link
              href={`/projects/${params.id}/runs/${params.runId}/data-copy`}
              className="font-medium text-accent hover:underline"
            >
              Data copy
            </Link>{" "}
            for rows.
          </li>
        </ol>
      </MigrationStepCallout>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {includeMessage ? <p className="mt-3 text-sm text-accent">{includeMessage}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={downloadJson}>
          Download JSON
        </Button>
        <Button variant="secondary" onClick={() => void downloadSql()} disabled={sqlPending}>
          {sqlPending ? "Preparing SQL…" : "Download SQL"}
        </Button>
        <Link href={`/projects/${params.id}/scope`} className="inline-flex">
          <Button variant="secondary" type="button">
            Open scope
          </Button>
        </Link>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Readiness</CardTitle>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">Dimension</th>
                <th className="py-1 font-medium">Weight</th>
                <th className="py-1 font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {DIMENSIONS.map((dimension) => {
                const value = report.readiness[dimension.key];
                return (
                  <tr key={dimension.key} className="border-t border-border">
                    <td className="py-2">{dimension.label}</td>
                    <td className="py-2 text-muted">{dimension.weight}</td>
                    <td className="py-2">{formatPercent(value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            {report.readiness.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Compile, tests, DAG, AI</CardTitle>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Compile first attempt</dt>
            <dd>{report.compile.firstAttempt}</dd>
            <dt className="text-muted">Compile after repair</dt>
            <dd>{report.compile.afterRepair}</dd>
            <dt className="text-muted">Compile passed / failed</dt>
            <dd>
              {report.compile.passed} / {report.compile.failed}
            </dd>
            <dt className="text-muted">Tests passed / failed / skipped</dt>
            <dd>
              {report.tests.passed} / {report.tests.failed} / {report.tests.skipped}
            </dd>
            <dt className="text-muted">DAG nodes / edges / layers</dt>
            <dd>
              {report.graph.nodeCount} / {report.graph.edgeCount} / {report.graph.layerCount}
            </dd>
            <dt className="text-muted">Cycles / waiting</dt>
            <dd>
              {report.graph.cycleCount} / {report.graph.waitingCount}
            </dd>
            <dt className="text-muted">AI convert / fix / verify</dt>
            <dd>
              {report.ai.convertCount} / {report.ai.fixCount} / {report.ai.verifyCount}
            </dd>
            <dt className="text-muted">Deferred</dt>
            <dd>{report.deferredCount}</dd>
          </dl>
          <p className="mt-3 text-sm">
            <Link
              href={`/projects/${params.id}/runs/${params.runId}/dag`}
              className="hover:underline"
            >
              Open run graph
            </Link>
          </p>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Blockers</CardTitle>
        {report.blocking.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No blocking objects.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              <strong className="text-foreground">REVIEW_REQUIRED on VIEWs:</strong> often means
              convert warnings were sticky, or sandbox compile failed (missing table). Open the
              object for compile error / SQL. Include missing tables if needed, then{" "}
              <Link href={`/projects/${params.id}/runs`} className="text-accent hover:underline">
                Start a new Schema + Views run
              </Link>
              . After the worker fix, views without HIGH-risk Oracle features can reach VALIDATED
              when compile + tests pass.
            </p>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 font-medium">Object</th>
                  <th className="py-1 font-medium">Type</th>
                  <th className="py-1 font-medium">Status</th>
                  <th className="py-1 font-medium">Detail</th>
                  <th className="py-1 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {blockerRows.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="py-2">
                      <Link className="hover:underline" href={objectHref(item.id)}>
                        {item.owner}.{item.name}
                      </Link>
                    </td>
                    <td className="py-2 text-muted">{item.objectType}</td>
                    <td className="py-2">
                      <Badge>{item.status}</Badge>
                    </td>
                    <td className="py-2 text-muted">{item.detail}</td>
                    <td className="py-2">
                      {item.missingTable ? (
                        includedRefs.has(item.missingTable) ? (
                          <Button type="button" size="sm" variant="secondary" disabled>
                            Included
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={including !== null}
                            onClick={() => void includeMissingTable(item.missingTable!)}
                          >
                            {including === item.missingTable
                              ? "Including…"
                              : `Include ${item.missingTable}`}
                          </Button>
                        )
                      ) : (
                        <Link
                          href={objectHref(item.id)}
                          className="text-sm font-medium text-accent hover:underline"
                        >
                          Open →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3">
              <Pagination
                page={currentBlockerPage}
                pageSize={DEFAULT_PAGE_SIZE}
                total={report.blocking.length}
                onPageChange={setBlockerPage}
                label="blockers"
              />
            </div>
          </>
        )}
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>By status</CardTitle>
          <ul className="mt-3 space-y-1 text-sm">
            {Object.entries(report.byStatus).map(([status, count]) => (
              <li key={status} className="flex justify-between gap-4">
                <span>{status}</span>
                <span className="text-muted">{count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Target reconciliation</CardTitle>
          <ul className="mt-3 space-y-1 text-sm">
            {Object.entries(report.byReconcileAction).length === 0 ? (
              <li className="text-muted">No target comparison yet.</li>
            ) : (
              Object.entries(report.byReconcileAction).map(([action, count]) => (
                <li key={action} className="flex justify-between gap-4">
                  <span>{action}</span>
                  <span className="text-muted">{count}</span>
                </li>
              ))
            )}
          </ul>
        </Card>
        <Card>
          <CardTitle>By type</CardTitle>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 font-medium">Validated</th>
                <th className="py-1 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.byType).map(([type, counts]) => (
                <tr key={type} className="border-t border-border">
                  <td className="py-2">{type}</td>
                  <td className="py-2">{counts.validated}</td>
                  <td className="py-2 text-muted">{counts.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted">Generated {report.generatedAt}</p>
    </div>
  );
}
