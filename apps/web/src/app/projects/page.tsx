"use client";

import type { ProjectDto } from "@migrator/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted">Oracle to PostgreSQL migration workspaces.</p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-teal-400"
        >
          New project
        </Link>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {projects === null && !error ? <p className="text-sm text-muted">Loading…</p> : null}
      {projects?.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted">
            Create a project to configure source and target connections.
          </p>
        </div>
      ) : null}
      {projects && projects.length > 0 ? (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} className="border-b border-border/70">
                <td className="py-3">
                  <Link href={`/projects/${project.id}`} className="font-medium hover:underline">
                    {project.name}
                  </Link>
                  {project.description ? (
                    <p className="text-xs text-muted">{project.description}</p>
                  ) : null}
                </td>
                <td className="py-3 text-muted">{new Date(project.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
