import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MigrationGuideStepId =
  | "connections"
  | "discovery"
  | "scope"
  | "convert"
  | "deploy"
  | "data-copy";

const STEPS: Array<{
  id: MigrationGuideStepId;
  n: number;
  title: string;
  body: string;
  href: (projectId: string, runId?: string) => string | null;
  linkLabel: string;
}> = [
  {
    id: "connections",
    n: 1,
    title: "Connections",
    body: "Add Oracle SOURCE (read-only) and PostgreSQL TARGET.",
    href: (projectId) => `/projects/${projectId}/connections`,
    linkLabel: "Open",
  },
  {
    id: "discovery",
    n: 2,
    title: "Discovery",
    body: "Inventory schemas and extract Oracle DDL.",
    href: (projectId) => `/projects/${projectId}/discovery`,
    linkLabel: "Open",
  },
  {
    id: "scope",
    n: 3,
    title: "Scope",
    body: "Choose schemas / types / names. Set data-copy tables if needed.",
    href: (projectId) => `/projects/${projectId}/scope`,
    linkLabel: "Open",
  },
  {
    id: "convert",
    n: 4,
    title: "Convert",
    body: "Start a Schema (+ Views) run. Wait until objects are VALIDATED on the report.",
    href: (projectId) => `/projects/${projectId}/runs`,
    linkLabel: "Runs",
  },
  {
    id: "deploy",
    n: 5,
    title: "Deploy",
    body: "Apply VALIDATED SQL to the PostgreSQL TARGET (creates schemas & tables).",
    href: (projectId, runId) =>
      runId ? `/projects/${projectId}/runs/${runId}/deploy` : `/projects/${projectId}/runs`,
    linkLabel: "Deploy",
  },
  {
    id: "data-copy",
    n: 6,
    title: "Data copy",
    body: "Copy rows only after Deploy. Otherwise TARGET has no schema/tables.",
    href: (projectId, runId) =>
      runId ? `/projects/${projectId}/runs/${runId}/data-copy` : `/projects/${projectId}/runs`,
    linkLabel: "Data copy",
  },
];

export function MigrationGuide(props: {
  projectId: string;
  runId?: string;
  highlight?: MigrationGuideStepId;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn(props.className)}>
      <CardTitle>Migration steps</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Follow in order. Convert validates SQL; Deploy creates objects on TARGET; Data copy fills
        rows.
      </p>
      <ol className={cn("mt-4 space-y-3", props.compact && "space-y-2")}>
        {STEPS.map((step) => {
          const active = props.highlight === step.id;
          const href = step.href(props.projectId, props.runId);
          return (
            <li
              key={step.id}
              className={cn(
                "rounded-md border px-3 py-2",
                active ? "border-accent bg-accent/10" : "border-border",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    <span className="text-muted">{step.n}.</span> {step.title}
                    {active ? (
                      <span className="ml-2 text-xs font-normal text-accent">You are here</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{step.body}</p>
                </div>
                {href ? (
                  <Link
                    href={href}
                    className="shrink-0 text-sm font-medium text-accent hover:underline"
                  >
                    {step.linkLabel} →
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function MigrationStepCallout(props: {
  title: string;
  children: ReactNode;
  tone?: "info" | "warn";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-4 rounded-md border px-3 py-3 text-sm",
        props.tone === "warn"
          ? "border-danger/60 bg-danger/10 text-foreground"
          : "border-accent/50 bg-accent/10 text-foreground",
        props.className,
      )}
    >
      <p className="font-medium">{props.title}</p>
      <div className="mt-1 text-muted">{props.children}</div>
    </div>
  );
}
