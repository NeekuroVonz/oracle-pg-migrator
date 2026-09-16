"use client";

import {
  type ConversionObjectDto,
  RECONCILE_ACTION_LABELS,
  type ReconcileAction,
  TARGET_STATE_LABELS,
  type TargetState,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { RunNav } from "@/components/run-nav";
import { api } from "@/lib/api";

type DiffChange = {
  kind?: string;
  path?: string;
  destructive?: boolean;
  from?: unknown;
  to?: unknown;
};

function diffChanges(diff: unknown): DiffChange[] {
  if (!diff || typeof diff !== "object" || !("changes" in diff)) {
    return [];
  }
  const changes = (diff as { changes?: unknown }).changes;
  return Array.isArray(changes) ? (changes as DiffChange[]) : [];
}

export default function RunObjectPage() {
  const params = useParams<{ id: string; runId: string; objectId: string }>();
  const [object, setObject] = useState<ConversionObjectDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRunObject(params.id, params.runId, params.objectId)
      .then(setObject)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load object");
      });
  }, [params.id, params.runId, params.objectId]);

  if (error) {
    return <p className="px-8 py-8 text-sm text-danger">{error}</p>;
  }
  if (!object) {
    return <p className="px-8 py-8 text-sm text-muted">Loading…</p>;
  }

  const changes = diffChanges(object.reconcileDiff);
  const targetLabel = object.targetState
    ? (TARGET_STATE_LABELS[object.targetState as TargetState] ?? object.targetState)
    : null;
  const actionLabel = object.reconcileAction
    ? (RECONCILE_ACTION_LABELS[object.reconcileAction as ReconcileAction] ?? object.reconcileAction)
    : null;
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <RunNav />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {object.owner}.{object.name}
        </h1>
        <Badge>{object.status}</Badge>
        {targetLabel ? <Badge>{targetLabel}</Badge> : null}
        {actionLabel ? <Badge>{actionLabel}</Badge> : null}
        {object.compileStatus ? <Badge>{object.compileStatus}</Badge> : null}
        {object.testStatus ? <Badge>test {object.testStatus}</Badge> : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        {object.objectType}
        {object.riskLevel ? ` · risk ${object.riskLevel}` : ""}
      </p>
      {(() => {
        const issues = [
          object.compileStatus === "FAILED" && object.compileError
            ? `Compile: ${object.compileError}`
            : null,
          object.testStatus === "FAILED" && object.testError ? `Test: ${object.testError}` : null,
          ...object.attempts
            .filter((attempt) => attempt.status === "FAILED" && attempt.errorMessage)
            .map(
              (attempt) =>
                `${attempt.converterType} #${attempt.attemptNumber}: ${attempt.errorMessage}`,
            ),
        ].filter((item): item is string => Boolean(item));
        if (issues.length === 0) {
          return null;
        }
        return (
          <Card className="mt-4 border-danger">
            <CardTitle>Failures</CardTitle>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Card>
        );
      })()}
      {object.status === "WAITING_DEPENDENCY" ? (
        <p className="mt-3 text-sm text-muted">
          Blocked by an out-of-scope or deferred prerequisite. See the{" "}
          <Link
            href={`/projects/${params.id}/runs/${params.runId}/dag`}
            className="hover:underline"
          >
            run dependency graph
          </Link>
          .
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Oracle DDL</CardTitle>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
            {object.sourceText ?? "No extracted source"}
          </pre>
        </Card>
        <Card>
          <CardTitle>Desired PostgreSQL SQL</CardTitle>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
            {object.targetSql ?? object.attempts[0]?.generatedSql ?? "Not converted"}
          </pre>
        </Card>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Planned target change</CardTitle>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
            {object.reconcileSql ??
              (object.reconcileAction === "SKIP_UNCHANGED"
                ? "No change; target already matches."
                : "No automatic plan (review required or not converted).")}
          </pre>
        </Card>
        <Card>
          <CardTitle>Structural diff</CardTitle>
          {changes.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No structural differences recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {changes.map((change) => (
                <li key={`${change.kind}-${change.path}`}>
                  <Badge>{change.kind}</Badge> {change.path}
                  {change.destructive ? " · destructive" : ""}
                  {change.from != null || change.to != null ? (
                    <p className="mt-1 text-xs text-muted">
                      {String(change.from ?? "—")} → {String(change.to ?? "—")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Conversion attempts</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {object.attempts.length === 0 ? (
              <li className="text-muted">None</li>
            ) : (
              object.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <Badge>{attempt.converterType}</Badge> #{attempt.attemptNumber} {attempt.status}
                  {attempt.warnings[0] ? ` · ${attempt.warnings[0]}` : ""}
                  {attempt.errorMessage ? (
                    <p className="mt-1 text-xs text-danger">{attempt.errorMessage}</p>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </Card>
        <Card>
          <CardTitle>Compile attempts</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {object.validations.length === 0 ? (
              <li className="text-muted">None</li>
            ) : (
              object.validations.map((attempt) => (
                <li key={attempt.id}>
                  #{attempt.attemptNumber} {attempt.status}
                  {attempt.errorMessage ? (
                    <p className="mt-1 text-xs text-danger">{attempt.errorMessage}</p>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </Card>
        <Card>
          <CardTitle>Structural tests</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {object.tests.length === 0 ? (
              <li className="text-muted">None</li>
            ) : (
              object.tests.map((attempt) => (
                <li key={attempt.id}>
                  #{attempt.attemptNumber} {attempt.status}
                  {attempt.errorMessage ? (
                    <p className="mt-1 text-xs text-danger">{attempt.errorMessage}</p>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
