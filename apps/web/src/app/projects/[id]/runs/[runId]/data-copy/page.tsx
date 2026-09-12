"use client";

import type { DataCopyRunDto } from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export default function DataCopyPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [copy, setCopy] = useState<DataCopyRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start data copy");
    } finally {
      setPending(false);
    }
  }

  const active = status === "QUEUED" || status === "RUNNING";

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <p className="text-sm text-muted">
        <Link href={`/projects/${params.id}/runs/${params.runId}`} className="hover:underline">
          Run
        </Link>
        {" · "}
        <Link
          href={`/projects/${params.id}/runs/${params.runId}/report`}
          className="hover:underline"
        >
          Report
        </Link>
        {" · "}
        <Link
          href={`/projects/${params.id}/runs/${params.runId}/deploy`}
          className="hover:underline"
        >
          Deploy
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Data copy</h1>
          <p className="mt-1 text-sm text-muted">
            Chunked, resumable Oracle SELECT into the PostgreSQL target. No AI on rows. Oracle stays
            read-only. Deploy VALIDATED SQL first so target tables exist.
          </p>
        </div>
        <Button onClick={() => void start()} disabled={pending || active}>
          {pending ? "Starting…" : copy ? "Start new copy" : "Start data copy"}
        </Button>
      </div>
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
              Mode {copy.dataMode} · chunk {copy.chunkSize} · copied {copy.copiedCount}/
              {copy.tableCount} · failed {copy.failedCount} · row counts matched {copy.matchedCount}
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
                {copy.tables.map((table) => (
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
          </Card>
        </>
      )}
    </div>
  );
}
