"use client";

import {
  MIGRATION_STRATEGY_LABELS,
  type ConversionTrack,
  type MigrationRunDto,
  type MigrationStrategy,
  parseRunTracks,
  runCancelRequested,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConversionTrackPicker, TrackBadges } from "@/components/conversion-tracks";
import { MigrationStepCallout } from "@/components/migration-guide";
import { StrategyBadge } from "@/components/strategy-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

function isActiveRun(run: MigrationRunDto): boolean {
  return run.status === "QUEUED" || run.status === "RUNNING";
}

function runLabel(run: MigrationRunDto): string {
  if (run.status === "RUNNING" && runCancelRequested(run.stats)) {
    return "STOPPING";
  }
  return run.status;
}

export default function RunsPage() {
  const params = useParams<{ id: string }>();
  const [runs, setRuns] = useState<MigrationRunDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<MigrationStrategy>("FAST");
  const [tracks, setTracks] = useState<ConversionTrack[]>(["SCHEMA"]);

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

  const active = runs.some(isActiveRun);
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
    if (tracks.length === 0) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.startRun(params.id, {
        strategy: tracks.includes("PLSQL") ? strategy : "FAST",
        tracks,
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start conversion");
    } finally {
      setPending(false);
    }
  }

  async function stop(runId: string): Promise<void> {
    setStoppingId(runId);
    setError(null);
    try {
      await api.stopRun(params.id, runId);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not stop conversion");
    } finally {
      setStoppingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Conversion and compile</h1>
          <p className="mt-1 text-sm text-muted">
            Step 4: convert and compile in the validator sandbox. After VALIDATED, open the run →
            Deploy (step 5) → Data copy (step 6). Oracle stays read-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tracks.includes("PLSQL") ? (
            <Select
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as MigrationStrategy)}
              aria-label="PL/SQL conversion strategy"
            >
              <option value="FAST">{MIGRATION_STRATEGY_LABELS.FAST}</option>
              <option value="BALANCED">{MIGRATION_STRATEGY_LABELS.BALANCED}</option>
              <option value="MAXIMUM_ACCURACY">{MIGRATION_STRATEGY_LABELS.MAXIMUM_ACCURACY}</option>
            </Select>
          ) : null}
          <Button onClick={() => void start()} disabled={pending || active || tracks.length === 0}>
            {pending ? "Starting…" : active ? "Run in progress" : "Start run"}
          </Button>
        </div>
      </div>
      <Card className="mt-4">
        <ConversionTrackPicker tracks={tracks} onChange={setTracks} disabled={pending || active} />
      </Card>
      <MigrationStepCallout title="After this run finishes">
        <ol className="list-decimal space-y-1 pl-4">
          <li>Open the run → Report: clear blockers (or Include missing tables) until Schema is VALIDATED.</li>
          <li>Open Deploy and apply SQL to TARGET (creates schemas/tables).</li>
          <li>Only then start Data copy for row migration.</li>
        </ol>
      </MigrationStepCallout>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      <p className="mt-4 text-sm text-muted">
        One conversion at a time per project. Stop a run at any time; it finishes the current
        object then exits. Sequential reruns are fine: pick different tracks on the next run.
        The latest run owns live object SQL and status. Finished-run reports stay as snapshots.
      </p>
      <div className="mt-6 space-y-3">
        {runs.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              No runs yet. Save a scope, choose what to convert, then start.
            </p>
          </Card>
        ) : (
          runs.map((run, index) => {
            const stopping = run.status === "RUNNING" && runCancelRequested(run.stats);
            return (
              <Card key={run.id}>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="font-mono text-sm">{run.id.slice(0, 8)}</CardTitle>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {index === 0 ? <Badge className="border-accent text-accent">Latest</Badge> : null}
                    <TrackBadges stats={run.stats} />
                    {parseRunTracks(run.stats).includes("PLSQL") ? (
                      <StrategyBadge strategy={run.strategy} />
                    ) : null}
                    <Badge>{runLabel(run)}</Badge>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted">
                  Converted {run.convertedCount} · compiled {run.compiledCount} · failed{" "}
                  <span className={run.failedCount > 0 ? "text-danger" : ""}>{run.failedCount}</span>{" "}
                  · compile failed{" "}
                  <span className={run.compileFailedCount > 0 ? "text-danger" : ""}>
                    {run.compileFailedCount}
                  </span>{" "}
                  · tested {run.testedCount} · test failed {run.testFailedCount} · review{" "}
                  {run.reviewRequiredCount}
                </p>
                {run.errorMessage ? (
                  <p
                    className={`mt-2 text-sm ${
                      run.status === "CANCELLED" || stopping ? "text-muted" : "text-danger"
                    }`}
                  >
                    {run.errorMessage}
                  </p>
                ) : null}
                {typeof run.stats.aiError === "string" ? (
                  <p className="mt-2 text-sm text-danger">{run.stats.aiError}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                  <Link href={`/projects/${params.id}/runs/${run.id}`} className="hover:underline">
                    Open run
                  </Link>
                  <Link
                    href={`/projects/${params.id}/runs/${run.id}/report`}
                    className="hover:underline"
                  >
                    Report
                  </Link>
                  {isActiveRun(run) ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void stop(run.id)}
                      disabled={stoppingId === run.id || stopping}
                    >
                      {stoppingId === run.id || stopping ? "Stopping…" : "Stop"}
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
