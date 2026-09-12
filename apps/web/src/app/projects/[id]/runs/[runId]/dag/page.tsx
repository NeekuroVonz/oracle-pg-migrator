"use client";

import type { ObjectDagDto } from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DagView } from "@/components/dag-view";
import { api } from "@/lib/api";

export default function RunDagPage() {
  const params = useParams<{ id: string; runId: string }>();
  const [dag, setDag] = useState<ObjectDagDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRunDag(params.id, params.runId)
      .then(setDag)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load run DAG");
      });
  }, [params.id, params.runId]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <p className="text-sm text-muted">
        <Link href={`/projects/${params.id}/runs/${params.runId}`} className="hover:underline">
          Run
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Run dependency graph</h1>
      <p className="mt-1 text-sm text-muted">
        Order used for this conversion and compile. Waiting objects were not compiled.
      </p>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      <div className="mt-6">
        {dag ? (
          <DagView
            dag={dag}
            objectHref={(objectId) =>
              `/projects/${params.id}/runs/${params.runId}/objects/${objectId}`
            }
          />
        ) : !error ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : null}
      </div>
    </div>
  );
}
