"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { suffix: "", label: "Objects" },
  { suffix: "/dag", label: "Graph" },
  { suffix: "/report", label: "Report" },
  { suffix: "/deploy", label: "Deploy" },
  { suffix: "/data-copy", label: "Data copy" },
] as const;

export function RunNav() {
  const params = useParams<{ id: string; runId: string }>();
  const pathname = usePathname();
  const base = `/projects/${params.id}/runs/${params.runId}`;

  return (
    <div>
      <Link
        href={`/projects/${params.id}/runs`}
        className="text-sm font-medium text-foreground hover:text-accent"
      >
        ← Runs
      </Link>
      <nav className="mt-3 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const href = `${base}${tab.suffix}`;
          const active =
            tab.suffix === ""
              ? pathname === base || pathname.startsWith(`${base}/objects`)
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium",
                active
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border bg-surface-raised text-foreground hover:border-accent hover:bg-surface hover:text-accent",
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
