"use client";

import type { DataCopyRunDto } from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MigrationGuide, MigrationStepCallout } from "@/components/migration-guide";
import { Pagination } from "@/components/pagination";
import { RunNav } from "@/components/run-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { DEFAULT_PAGE_SIZE, pageCount, paginate } from "@/lib/pagination";

export default function DataCopyPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [copy, setCopy] = useState<DataCopyRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const data = await api.getRunDataCopy(params.id, params.runId);
    setCopy(data);
    return data;
  }, [params.id, params.runId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load data copy");
    });
  }, [load]);

  const status = copy?.status;
  useEffect(() => {
    if (status !== "QUEUED" && status !== "RUNNING") {
      return;
    }
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status, load]);

  async function start(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const data = await api.startRunDataCopy(params.id, params.runId);
      setCopy(data);
      setPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start data copy");
    } finally {
      setPending(false);
    }
  }

  async function resumeFailed(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const data = await api.resumeFailedDataCopy(params.id, params.runId);
      setCopy(data);
      setPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resume failed tables");
    } finally {
      setPending(false);
    }
  }

  async function pause(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const data = await api.pauseDataCopy(params.id, params.runId);
      setCopy(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not pause data copy");
    } finally {
      setPending(false);
    }
  }

  const active = status === "QUEUED" || status === "RUNNING";
  const pauseRequested = Boolean(copy?.cancelRequested);
  const failedFromTables = copy?.tables.filter((t) => t.status === "FAILED").length ?? 0;
  const pendingFromTables = copy?.tables.filter((t) => t.status === "PENDING").length ?? 0;
  const failedCount = Math.max(copy?.failedCount ?? 0, failedFromTables);
  const pendingCount = pendingFromTables;
  const canResume =
    Boolean(copy) &&
    !active &&
    (status === "FAILED" || status === "CANCELLED" || status === "SUCCEEDED") &&
    (failedCount > 0 || pendingCount > 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <RunNav />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Data copy</h1>
          <p className="mt-1 text-sm text-muted">
            Chunked, resumable Oracle SELECT into the PostgreSQL target. No AI on rows. Oracle stays
            read-only. Deploy VALIDATED SQL first so target tables exist.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button variant="danger" onClick={() => void pause()} disabled={pending || pauseRequested}>
              {pauseRequested ? "Pausing…" : pending ? "…" : "Pause"}
            </Button>
          ) : null}
          {canResume ? (
            <Button
              variant="secondary"
              onClick={() => void resumeFailed()}
              disabled={pending || active}
            >
              {pending ? "Resuming…" : `Resume failed (${failedCount + pendingCount})`}
            </Button>
          ) : null}
          <Button onClick={() => void start()} disabled={pending || active}>
            {pending ? "Starting…" : copy ? "Start new copy" : "Start data copy"}
          </Button>
        </div>
      </div>
      {copy ? (
        <p className="mt-2 text-xs text-muted">
          <strong className="text-foreground">Pause</strong> stops after the current chunk/table —
          then use <strong className="text-foreground">Resume failed</strong> for FAILED/PENDING
          only (keeps SUCCEEDED).{" "}
          <strong className="text-foreground">Start new copy</strong> truncates and recopies every
          selected table.
        </p>
      ) : null}
      <MigrationStepCallout title="Step 6 of 6 — requires Deploy first" tone="warn">
        <p>
          Data copy only inserts rows. If you see{" "}
          <code className="text-foreground">schema &quot;…&quot; does not exist</code>, go to{" "}
          <Link
            href={`/projects/${params.id}/runs/${params.runId}/deploy`}
            className="font-medium text-accent hover:underline"
          >
            Deploy
          </Link>{" "}
          and apply VALIDATED SQL to TARGET, then start data copy again.
        </p>
      </MigrationStepCallout>
      <MigrationGuide
        projectId={params.id}
        runId={params.runId}
        highlight="data-copy"
        compact
        className="mt-4"
      />
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {!copy ? (
        <Card className="mt-6">
          <p className="text-sm text-muted">
            No data copy yet. Scope data mode must select tables, and those tables must be
            VALIDATED.
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-6 flex items-center gap-3">
            <Badge>{copy.status}</Badge>
            <p className="text-sm text-muted">
              Mode {copy.dataMode} · chunk {copy.chunkSize} · copied{" "}
              {copy.tables.filter((t) => t.status === "SUCCEEDED").length}/{copy.tableCount} ·
              failed {failedFromTables}
              {pauseRequested ? " · pause requested" : ""} · row counts matched {copy.matchedCount}
            </p>
          </div>
          {copy.errorMessage ? (
            <p className="mt-2 text-sm text-danger">{copy.errorMessage}</p>
          ) : null}
          <Card className="mt-6 overflow-x-auto p-0">
            <CardTitle className="sr-only">Tables</CardTitle>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Oracle</th>
                  <th className="px-4 py-3 font-medium">PostgreSQL</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Copied</th>
                  <th className="px-4 py-3 font-medium">Oracle / PG rows</th>
                </tr>
              </thead>
              <tbody>
                {paginate(copy.tables, page, DEFAULT_PAGE_SIZE).map((table) => (
                  <tr key={table.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {table.owner}.{table.name}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {table.targetSchema}.{table.targetName}
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{table.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {table.copiedRows} (offset {table.lastOffset})
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {table.oracleRows ?? "—"} / {table.postgresRows ?? "—"}
                      {table.errorMessage ? (
                        <p className="mt-1 text-danger">{table.errorMessage}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {copy.tables.length > DEFAULT_PAGE_SIZE ? (
              <div className="border-t border-border px-4 py-3">
                <Pagination
                  page={Math.min(page, pageCount(copy.tables.length, DEFAULT_PAGE_SIZE))}
                  pageSize={DEFAULT_PAGE_SIZE}
                  total={copy.tables.length}
                  onPageChange={setPage}
                  label="tables"
                />
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
