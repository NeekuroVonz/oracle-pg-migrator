"use client";

import {
  type ConversionRunDetailDto,
  parseRunTracks,
  RECONCILE_ACTION_LABELS,
  type ReconcileAction,
  runCancelRequested,
  TARGET_STATE_LABELS,
  type TargetState,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TrackBadges } from "@/components/conversion-tracks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/pagination";
import { RunNav } from "@/components/run-nav";
import { Select } from "@/components/ui/select";
import { StrategyBadge } from "@/components/strategy-badge";
import { api } from "@/lib/api";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

function targetBadge(state: TargetState | null): string {
  if (state === "TARGET_MATCHED") {
    return "border-accent text-accent";
  }
  if (state === "TARGET_DRIFTED" || state === "TARGET_CONFLICT") {
    return "border-danger text-danger";
  }
  return "";
}

export default function RunDetailPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [detail, setDetail] = useState<ConversionRunDetailDto | null>(null);
  const [status, setStatus] = useState("");
  const [reconcileAction, setReconcileAction] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(async () => {
    const data = await api.getRun(params.id, params.runId, {
      status: status || undefined,
      reconcileAction: reconcileAction || undefined,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    setDetail(data);
    return data;
  }, [params.id, params.runId, status, reconcileAction, page]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load run");
    });
  }, [load]);

  const runStatus = detail?.run.status;
  useEffect(() => {
    if (runStatus !== "QUEUED" && runStatus !== "RUNNING") {
      return;
    }
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [runStatus, load]);

  if (error) {
    return <p className="px-8 py-8 text-sm text-danger">{error}</p>;
  }
  if (!detail) {
    return <p className="px-8 py-8 text-sm text-muted">Loading…</p>;
  }

  const run = detail.run;
  const stopRequested = runCancelRequested(run.stats);
  const active = run.status === "QUEUED" || run.status === "RUNNING";

  async function stop(): Promise<void> {
    setStopping(true);
    setActionError(null);
    try {
      await api.stopRun(params.id, params.runId);
      await load();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not stop conversion");
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <RunNav />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Run {run.id.slice(0, 8)}</h1>
        <TrackBadges stats={run.stats} />
        {parseRunTracks(run.stats).includes("PLSQL") ? (
          <StrategyBadge strategy={run.strategy} />
        ) : null}
        <Badge>{stopRequested && run.status === "RUNNING" ? "STOPPING" : run.status}</Badge>
        {active ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => void stop()}
            disabled={stopping || stopRequested}
          >
            {stopping || stopRequested ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </div>
      {actionError ? <p className="mt-2 text-sm text-danger">{actionError}</p> : null}
      <p className="mt-2 text-sm text-muted">
        Mapping {detail.run.mappingRulesVersion} · compiled {detail.run.compiledCount}/
        {detail.run.objectCount} · tested {detail.run.testedCount} · waiting{" "}
        {detail.run.waitingDependencyCount}
      </p>
      {detail.run.errorMessage ? (
        <p
          className={`mt-2 text-sm ${
            detail.run.status === "CANCELLED" || stopRequested ? "text-muted" : "text-danger"
          }`}
        >
          {detail.run.errorMessage}
        </p>
      ) : null}
      {(detail.run.failedCount > 0 ||
        detail.run.compileFailedCount > 0 ||
        detail.run.testFailedCount > 0 ||
        detail.run.reviewRequiredCount > 0) && (
        <Card className="mt-4 border-danger">
          <CardTitle>Failures</CardTitle>
          <p className="mt-2 text-sm text-danger">
            {detail.run.failedCount} failed · {detail.run.compileFailedCount} compile failed ·{" "}
            {detail.run.testFailedCount} test failed · {detail.run.reviewRequiredCount} review
          </p>
          {typeof detail.run.stats.aiError === "string" ? (
            <p className="mt-2 text-sm text-danger">{detail.run.stats.aiError}</p>
          ) : null}
          {Array.isArray(detail.run.stats.issues) && detail.run.stats.issues.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
              {(detail.run.stats.issues as unknown[]).filter(Boolean).slice(0, 8).map((item) => (
                <li key={String(item)}>{String(item)}</li>
              ))}
            </ul>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
              {detail.objects
                .filter(
                  (object) =>
                    object.status === "FAILED" ||
                    object.status === "REVIEW_REQUIRED" ||
                    object.compileStatus === "FAILED" ||
                    object.testStatus === "FAILED",
                )
                .slice(0, 8)
                .map((object) => (
                  <li key={object.id}>
                    {object.owner}.{object.name}:{" "}
                    {object.testError ?? object.compileError ?? object.status}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}
      <div className="mt-4 flex max-w-3xl flex-wrap gap-3">
        <Select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        >
          <option value="">All statuses</option>
          <option value="VALIDATED">VALIDATED</option>
          <option value="FAILED">FAILED</option>
          <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
          <option value="COMPILING">COMPILING</option>
          <option value="TESTING">TESTING</option>
          <option value="WAITING_DEPENDENCY">WAITING_DEPENDENCY</option>
        </Select>
        <Select
          value={reconcileAction}
          onChange={(event) => {
            setPage(1);
            setReconcileAction(event.target.value);
          }}
        >
          <option value="">All target actions</option>
          <option value="CREATE_REQUIRED">needs create</option>
          <option value="SKIP_UNCHANGED">skipped</option>
          <option value="UPDATE_REQUIRED">needs update</option>
          <option value="REPLACE_REQUIRED">needs replace</option>
          <option value="REVIEW_REQUIRED">review required</option>
        </Select>
      </div>
      <Card className="mt-6 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Object</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Compile</th>
              <th className="px-4 py-3 font-medium">Test</th>
              <th className="px-4 py-3 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {detail.objects.map((object) => (
              <tr key={object.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link
                    className="hover:underline"
                    href={`/projects/${params.id}/runs/${params.runId}/objects/${object.id}`}
                  >
                    {object.owner}.{object.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{object.objectType}</td>
                <td className="px-4 py-3">
                  <Badge>{object.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  {object.targetState ? (
                    <Badge className={targetBadge(object.targetState as TargetState)}>
                      {TARGET_STATE_LABELS[object.targetState as TargetState] ?? object.targetState}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  {object.reconcileAction ? (
                    <Badge>
                      {RECONCILE_ACTION_LABELS[object.reconcileAction as ReconcileAction] ??
                        object.reconcileAction}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{object.compileStatus ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{object.testStatus ?? "—"}</td>
                <td className="max-w-sm px-4 py-3 text-danger">
                  {object.testError ?? object.compileError ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {detail.total > detail.pageSize ? (
          <div className="border-t border-border px-4 py-3">
            <Pagination
              page={detail.page}
              pageSize={detail.pageSize}
              total={detail.total}
              onPageChange={setPage}
              label="objects"
            />
          </div>
        ) : null}
      </Card>
      <CardTitle className="sr-only">Objects</CardTitle>
    </div>
  );
}
