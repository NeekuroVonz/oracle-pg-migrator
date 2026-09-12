"use client";

import type { ValidatorPoolDto } from "@migrator/shared";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export default function ValidatorPoolPage() {
  const [pool, setPool] = useState<ValidatorPoolDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getValidatorPool()
      .then(setPool)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load validator pool");
      });
  }, []);

  if (error) {
    return <p className="px-8 py-8 text-sm text-danger">{error}</p>;
  }
  if (!pool) {
    return <p className="px-8 py-8 text-sm text-muted">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-semibold">Validator pool</h1>
      <p className="mt-2 text-sm text-muted">
        Pre-warmed PostgreSQL sandboxes used to compile converted SQL. Slots are reset and reused —
        never one container per object. Oracle is never connected from this pool.
      </p>
      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <CardTitle>Pool</CardTitle>
          <Badge>{pool.healthy ? "healthy" : "unhealthy"}</Badge>
        </div>
        <p className="mt-3 text-sm text-muted">{pool.message}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Mode</dt>
            <dd>{pool.mode}</dd>
          </div>
          <div>
            <dt className="text-muted">Size</dt>
            <dd>{pool.size}</dd>
          </div>
          <div>
            <dt className="text-muted">Host</dt>
            <dd>{pool.host ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Port</dt>
            <dd>{pool.port ?? "—"}</dd>
          </div>
        </dl>
      </Card>
      <div className="mt-4 space-y-2">
        {pool.slots.map((slot) => (
          <Card key={slot.id}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono">
                {slot.id} · {slot.database}
              </span>
              <Badge>{slot.status}</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
