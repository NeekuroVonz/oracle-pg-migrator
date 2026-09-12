"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

export default function NewProjectPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const project = await api.createProject({
        name,
        description: description.length > 0 ? description : undefined,
      });
      router.push(`/projects/${project.id}/connections`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-8 py-8">
      <h1 className="text-2xl font-semibold">New project</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Step 1 of the migration wizard — name the workspace.
      </p>
      <Card>
        <CardTitle className="mb-4">Project</CardTitle>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              placeholder="CLV Oracle to PostgreSQL"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" maxLength={4000} />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create and configure connections"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
