"use client";

import { Database, FolderKanban, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/settings/ai-providers", label: "AI providers", icon: Settings2 },
  { href: "/settings/validator-pool", label: "Validator pool", icon: Database },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border px-4 py-4">
          <p className="font-mono text-xs tracking-wide text-muted">CONTROL PLANE</p>
          <p className="mt-1 text-sm font-semibold leading-snug">Oracle → PostgreSQL</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                  active
                    ? "bg-surface-raised text-foreground"
                    : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 bg-background">{children}</main>
    </div>
  );
}
