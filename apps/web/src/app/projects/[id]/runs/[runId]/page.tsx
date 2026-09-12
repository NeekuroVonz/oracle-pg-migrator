"use client";

import {
  type ConversionRunDetailDto,
  RECONCILE_ACTION_LABELS,
  type ReconcileAction,
  TARGET_STATE_LABELS,
  type TargetState,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.getRun(params.id, params.runId, {
      status: status || undefined,
      reconcileAction: reconcileAction || undefined,
      page: 1,
      pageSize: 100,
    });
    setDetail(data);
    return data;
  }, [params.id, params.runId, status, reconcileAction]);

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

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <p className="text-sm text-muted">
        <Link href={`/projects/${params.id}/runs`} className="hover:underline">
          Runs
        </Link>
      </p>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Run {detail.run.id.slice(0, 8)}</h1>
        <Badge>{detail.run.status}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted">
        Strategy {detail.run.strategy} · mapping {detail.run.mappingRulesVersion} · compiled{" "}
        {detail.run.compiledCount}/{detail.run.objectCount} · tested {detail.run.testedCount} ·
        waiting {detail.run.waitingDependencyCount}
      </p>
      {detail.run.errorMessage ? (
        <p className="mt-2 text-sm text-danger">{detail.run.errorMessage}</p>
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
      <p className="mt-3 text-sm">
        <Link href={`/projects/${params.id}/runs/${params.runId}/dag`} className="hover:underline">
          Dependency graph
        </Link>
        {" · "}
        <Link
          href={`/projects/${params.id}/runs/${params.runId}/report`}
          className="hover:underline"
        >
          Migration report
        </Link>
        {" · "}
        <Link
          href={`/projects/${params.id}/runs/${params.runId}/data-copy`}
          className="hover:underline"
        >
          Data copy
        </Link>
        {" · "}
        <Link
          href={`/projects/${params.id}/runs/${params.runId}/deploy`}
          className="hover:underline"
        >
          Deploy
        </Link>
      </p>
      <div className="mt-4 flex max-w-3xl flex-wrap gap-3">
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
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
          onChange={(event) => setReconcileAction(event.target.value)}
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
      </Card>
      <CardTitle className="sr-only">Objects</CardTitle>
    </div>
  );
}
