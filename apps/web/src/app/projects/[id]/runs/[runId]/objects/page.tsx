"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function RunObjectsRedirect() {
  const params = useParams<{ id: string; runId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/projects/${params.id}/runs/${params.runId}`);
  }, [params.id, params.runId, router]);
  return <p className="px-8 py-8 text-sm text-muted">Opening run…</p>;
}
