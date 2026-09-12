"use client";

import type { ProjectDto } from "@migrator/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .getProject(params.id)
      .then(setProject)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [params.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const updated = await api.updateProject(params.id, {
        name,
        description: description.length > 0 ? description : null,
      });
      setProject(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm("Delete this project and its connections, runs, and reports?")) {
      return;
    }
    setError(null);
    try {
      await api.deleteProject(params.id);
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (error && !project) {
    return <p className="px-8 py-8 text-sm text-danger">{error}</p>;
  }
  if (!project) {
    return <p className="px-8 py-8 text-sm text-muted">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      {editing ? (
        <form className="max-w-xl space-y-3" onSubmit={save}>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={200} defaultValue={project.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              maxLength={4000}
              defaultValue={project.description ?? ""}
            />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save project"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <p className="mt-1 text-sm text-muted">{project.description ?? "No description"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit project
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        </div>
      )}
      {error && project && !editing ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Connections</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Configure the Oracle source and PostgreSQL target.
          </p>
          <Link
            href={`/projects/${project.id}/connections`}
            className="mt-4 inline-flex h-9 items-center rounded-md bg-surface-raised px-3 text-sm font-medium hover:bg-zinc-700"
          >
            Open connections
          </Link>
        </Card>
        <Card>
          <CardTitle>Discovery</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Inventory Oracle objects and extract read-only DDL.
          </p>
          <Link
            href={`/projects/${project.id}/discovery`}
            className="mt-4 inline-flex h-9 items-center rounded-md bg-surface-raised px-3 text-sm font-medium hover:bg-zinc-700"
          >
            Open discovery
          </Link>
        </Card>
        <Card>
          <CardTitle>Scope</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Include and exclude schemas, types, and names. Inspect the selection before converting.
          </p>
          <Link
            href={`/projects/${project.id}/scope`}
            className="mt-4 inline-flex h-9 items-center rounded-md bg-surface-raised px-3 text-sm font-medium hover:bg-zinc-700"
          >
            Open scope
          </Link>
        </Card>
        <Card>
          <CardTitle>Dependency graph</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Inspect conversion order, cycles, and objects waiting on out-of-scope prerequisites.
          </p>
          <Link
            href={`/projects/${project.id}/dag`}
            className="mt-4 inline-flex h-9 items-center rounded-md bg-surface-raised px-3 text-sm font-medium hover:bg-zinc-700"
          >
            Open graph
          </Link>
        </Card>
        <Card>
          <CardTitle>Runs</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Convert in-scope objects, then compile PostgreSQL SQL on the validator pool.
          </p>
          <Link
            href={`/projects/${project.id}/runs`}
            className="mt-4 inline-flex h-9 items-center rounded-md bg-surface-raised px-3 text-sm font-medium hover:bg-zinc-700"
          >
            Open runs
          </Link>
        </Card>
        <Card>
          <CardTitle>AI providers</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Optional convert / fix / verify. Compile plus tests decide VALIDATED.
          </p>
          <Link
            href="/settings/ai-providers"
            className="mt-4 inline-flex h-9 items-center rounded-md bg-surface-raised px-3 text-sm font-medium hover:bg-zinc-700"
          >
            Configure providers
          </Link>
        </Card>
      </div>
    </div>
  );
}
