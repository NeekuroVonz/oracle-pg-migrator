"use client";

import {
  MIGRATION_STRATEGY_LABELS,
  type MigrationStrategy,
  type ObjectDagDto,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DagView } from "@/components/dag-view";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

export default function ProjectDagPage() {
  const params = useParams<{ id: string }>();
  const [dag, setDag] = useState<ObjectDagDto | null>(null);
  const [strategy, setStrategy] = useState<MigrationStrategy>("FAST");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProjectDag(params.id, strategy)
      .then(setDag)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load dependency graph");
        setDag(null);
      });
  }, [params.id, strategy]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <p className="text-sm text-muted">
        <Link href={`/projects/${params.id}`} className="hover:underline">
          Project
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dependency graph</h1>
          <p className="mt-1 text-sm text-muted">
            Convert and compile in-scope objects after their Oracle prerequisites. Cycles need
            review. Out-of-scope or deferred prerequisites block dependents.
          </p>
        </div>
        <Select
          value={strategy}
          onChange={(event) => setStrategy(event.target.value as MigrationStrategy)}
          aria-label="Strategy for deferred types"
        >
          <option value="FAST">{MIGRATION_STRATEGY_LABELS.FAST}</option>
          <option value="BALANCED">{MIGRATION_STRATEGY_LABELS.BALANCED}</option>
          <option value="MAXIMUM_ACCURACY">{MIGRATION_STRATEGY_LABELS.MAXIMUM_ACCURACY}</option>
        </Select>
      </div>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      <div className="mt-6">
        {dag ? (
          <DagView dag={dag} />
        ) : !error ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : null}
      </div>
    </div>
  );
}
