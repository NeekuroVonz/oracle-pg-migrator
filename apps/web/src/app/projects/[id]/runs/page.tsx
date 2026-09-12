"use client";

import type { MigrationRunDto, MigrationStrategy } from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

export default function RunsPage() {
  const params = useParams<{ id: string }>();
  const [runs, setRuns] = useState<MigrationRunDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [strategy, setStrategy] = useState<MigrationStrategy>("FAST");

  const load = useCallback(async () => {
    const data = await api.listRuns(params.id);
    setRuns(data);
    return data;
  }, [params.id]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load runs");
    });
  }, [load]);

  const active = runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING");
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  async function start(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.startRun(params.id, { strategy });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start conversion");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Conversion and compile</h1>
          <p className="mt-1 text-sm text-muted">
            Rules first, then PostgreSQL compile, then structural tests. Compile success is not
            VALIDATED. AI fix/verify run only when a provider is configured. Oracle stays read-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as MigrationStrategy)}
            aria-label="Conversion strategy"
          >
            <option value="FAST">FAST</option>
            <option value="BALANCED">BALANCED</option>
            <option value="MAXIMUM_ACCURACY">MAXIMUM_ACCURACY</option>
          </Select>
          <Button onClick={() => void start()} disabled={pending || active}>
            {pending ? "Starting…" : "Start run"}
          </Button>
        </div>
      </div>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      <div className="mt-6 space-y-3">
        {runs.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              No runs yet. Save a scope, then start a conversion.
            </p>
          </Card>
        ) : (
          runs.map((run) => (
            <Card key={run.id}>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="font-mono text-sm">{run.id.slice(0, 8)}</CardTitle>
                <Badge>{run.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">
                Converted {run.convertedCount} · compiled {run.compiledCount} · failed{" "}
                <span className={run.failedCount > 0 ? "text-danger" : ""}>{run.failedCount}</span> ·
                compile failed{" "}
                <span className={run.compileFailedCount > 0 ? "text-danger" : ""}>
                  {run.compileFailedCount}
                </span>{" "}
                · tested {run.testedCount} · test failed {run.testFailedCount} · review{" "}
                {run.reviewRequiredCount}
              </p>
              {run.errorMessage ? <p className="mt-2 text-sm text-danger">{run.errorMessage}</p> : null}
              {typeof run.stats.aiError === "string" ? (
                <p className="mt-2 text-sm text-danger">{run.stats.aiError}</p>
              ) : null}
              <div className="mt-3 flex gap-4 text-sm">
                <Link href={`/projects/${params.id}/runs/${run.id}`} className="hover:underline">
                  Open run
                </Link>
                <Link
                  href={`/projects/${params.id}/runs/${run.id}/report`}
                  className="hover:underline"
                >
                  Report
                </Link>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
