"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const tabs = [
  { suffix: "", label: "Overview" },
  { suffix: "/connections", label: "Connections" },
  { suffix: "/discovery", label: "Discovery" },
  { suffix: "/scope", label: "Scope" },
  { suffix: "/dag", label: "Graph" },
  { suffix: "/runs", label: "Runs" },
] as const;

export function ProjectNav() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const [name, setName] = useState<string | null>(null);
  const projectId = params.id;
  const base = `/projects/${projectId}`;

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;
    api
      .getProject(projectId)
      .then((project) => {
        if (!cancelled) {
          setName(project.name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setName(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) {
    return null;
  }

  return (
    <div className="border-b border-border bg-surface px-8 py-3">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Projects
      </Link>
      {name ? <p className="mt-1 text-sm font-medium">{name}</p> : null}
      <nav className="mt-3 flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const href = `${base}${tab.suffix}`;
          const active =
            tab.suffix === ""
              ? pathname === base
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium",
                active
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border bg-surface-raised text-foreground hover:border-accent hover:text-accent",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
