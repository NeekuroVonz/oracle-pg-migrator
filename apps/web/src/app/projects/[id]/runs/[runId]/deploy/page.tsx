"use client";

import type { DeployRunDto } from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export default function DeployPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [deploy, setDeploy] = useState<DeployRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  async function start(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const data = await api.startRunDeploy(params.id, params.runId);
      setDeploy(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start deploy");
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
          href={`/projects/${params.id}/runs/${params.runId}/data-copy`}
          className="hover:underline"
        >
          Data copy
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
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
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
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
            <p className="mt-2 text-sm text-danger">{deploy.errorMessage}</p>
          ) : null}
          <Card className="mt-6 overflow-x-auto p-0">
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
                {deploy.objects.map((object) => (
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
          </Card>
        </>
      )}
    </div>
  );
}
