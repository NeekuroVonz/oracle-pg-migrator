"use client";

import { type ConversionTrack, type ObjectDagDto } from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConversionTrackPicker } from "@/components/conversion-tracks";
import { Card } from "@/components/ui/card";
import { DagView } from "@/components/dag-view";
import { api } from "@/lib/api";

export default function ProjectDagPage() {
  const params = useParams<{ id: string }>();
  const [dag, setDag] = useState<ObjectDagDto | null>(null);
  const [tracks, setTracks] = useState<ConversionTrack[]>(["SCHEMA", "VIEWS"]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProjectDag(params.id, { tracks })
      .then(setDag)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load dependency graph");
        setDag(null);
      });
  }, [params.id, tracks]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <p className="text-sm text-muted">
        <Link href={`/projects/${params.id}`} className="hover:underline">
          Project
        </Link>
      </p>
      <div className="mt-2">
        <h1 className="text-2xl font-semibold">Dependency graph</h1>
        <p className="mt-1 text-sm text-muted">
          Preview which objects a conversion run would take. Types you leave unchecked are
          deferred. Convert and compile in-scope objects after their Oracle prerequisites.
        </p>
      </div>
      <Card className="mt-4">
        <ConversionTrackPicker tracks={tracks} onChange={setTracks} />
      </Card>
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
