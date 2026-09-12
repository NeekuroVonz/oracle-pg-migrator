"use client";

import {
  AI_KIND_DEFAULTS,
  type AiProviderDto,
  type AiProviderKind,
  type AiProviderTestResult,
} from "@migrator/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

const KINDS: AiProviderKind[] = ["openai", "anthropic", "gemini", "cursor", "openai_compatible"];

export default function AiProvidersPage() {
  const [providers, setProviders] = useState<AiProviderDto[]>([]);
  const [editing, setEditing] = useState<AiProviderDto | null>(null);
  const [kind, setKind] = useState<AiProviderKind>("openai");
  const [model, setModel] = useState(AI_KIND_DEFAULTS.openai.model);
  const [baseUrl, setBaseUrl] = useState(AI_KIND_DEFAULTS.openai.baseUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testById, setTestById] = useState<Record<string, AiProviderTestResult>>({});

  const refresh = useCallback(async () => {
    setProviders(await api.listAiProviders());
  }, []);

  useEffect(() => {
    refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    });
  }, [refresh]);

  function applyKind(next: AiProviderKind) {
    setKind(next);
    setModel(AI_KIND_DEFAULTS[next].model);
    setBaseUrl(AI_KIND_DEFAULTS[next].baseUrl);
  }

  function resetFormFields() {
    setEditing(null);
    setKind("openai");
    setModel(AI_KIND_DEFAULTS.openai.model);
    setBaseUrl(AI_KIND_DEFAULTS.openai.baseUrl);
  }

  function startEdit(provider: AiProviderDto) {
    setEditing(provider);
    setKind(provider.kind);
    setModel(provider.model);
    setBaseUrl(provider.baseUrl || AI_KIND_DEFAULTS[provider.kind].baseUrl);
    setError(null);
    document
      .getElementById("provider-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEdit() {
    resetFormFields();
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const apiKey = String(form.get("apiKey") || "");
    const nextBaseUrl = baseUrl.trim() || AI_KIND_DEFAULTS[kind].baseUrl;
    setError(null);
    setSaving(true);
    try {
      const fields = {
        name: String(form.get("name")),
        kind,
        baseUrl: nextBaseUrl,
        model: model.trim() || AI_KIND_DEFAULTS[kind].model,
        enabled: form.get("enabled") === "on",
        roleConvert: form.get("roleConvert") === "on",
        roleFix: form.get("roleFix") === "on",
        roleVerify: form.get("roleVerify") === "on",
      };
      if (editing) {
        await api.updateAiProvider(editing.id, {
          ...fields,
          ...(apiKey ? { apiKey } : {}),
        });
        resetFormFields();
      } else {
        await api.createAiProvider({ ...fields, apiKey });
        formEl.reset();
        resetFormFields();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function test(id: string) {
    setError(null);
    try {
      const result = await api.testAiProvider(id);
      setTestById((current) => ({ ...current, [id]: result }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      if (editing?.id === id) {
        cancelEdit();
      }
      await api.deleteAiProvider(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const formKey = editing?.id ?? "new";

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-semibold">AI providers</h1>
      <p className="mt-2 text-sm text-muted">
        Optional convert / fix / verify adapters. API keys are encrypted at rest and never returned.
        AI cannot mark an object VALIDATED — compile plus structural tests are the judge. Max 3 AI
        repair attempts, then REVIEW_REQUIRED.
      </p>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      <Card className="mt-6" id="provider-form">
        <CardTitle>{editing ? `Edit ${editing.name}` : "Add provider"}</CardTitle>
        <form key={formKey} className="mt-4 space-y-3" onSubmit={(event) => void save(event)}>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              className="mt-1"
              defaultValue={editing?.name ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="kind">Kind</Label>
            <Select
              id="kind"
              className="mt-1"
              value={kind}
              onChange={(event) => applyKind(event.target.value as AiProviderKind)}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              name="model"
              className="mt-1"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Model id on this provider. Changing Kind fills a default model and Base URL.
            </p>
          </div>
          <div>
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              name="baseUrl"
              className="mt-1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              required
            />
            <p className="mt-1 text-xs text-muted">
              Auto-filled for {kind}: {AI_KIND_DEFAULTS[kind].baseUrl}. Override only for a proxy or
              compatible server.
            </p>
            {kind === "cursor" ? (
              <p className="mt-2 text-sm text-muted">
                Default Cursor uses Agent.prompt (same as oracle2pg-ai), not Chat Completions. Leave
                Base URL as api.cursor.com. Override only for an OpenAI-compatible proxy.
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="apiKey">API key</Label>
            <Input
              id="apiKey"
              name="apiKey"
              type="password"
              required={!editing}
              className="mt-1"
              placeholder={editing ? "Leave blank to keep the stored key" : undefined}
            />
          </div>
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? true} />
              Enabled
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="roleConvert"
                defaultChecked={editing?.roleConvert ?? true}
              />
              Convert
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="roleFix" defaultChecked={editing?.roleFix ?? true} />
              Fix
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="roleVerify"
                defaultChecked={editing?.roleVerify ?? true}
              />
              Verify
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Save provider"}
            </Button>
            {editing ? (
              <Button type="button" variant="secondary" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
      <div className="mt-4 space-y-3">
        {providers.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              No providers yet. FAST runs still convert with rules and compile without AI.
            </p>
          </Card>
        ) : (
          providers.map((provider) => (
            <Card key={provider.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{provider.name}</CardTitle>
                  <p className="mt-1 text-sm text-muted">
                    {provider.kind} · {provider.model} ·{" "}
                    {provider.baseUrl || AI_KIND_DEFAULTS[provider.kind].baseUrl}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{provider.enabled ? "enabled" : "disabled"}</Badge>
                    {provider.roleConvert ? <Badge>convert</Badge> : null}
                    {provider.roleFix ? <Badge>fix</Badge> : null}
                    {provider.roleVerify ? <Badge>verify</Badge> : null}
                    <Badge>{provider.hasApiKey ? "key stored" : "no key"}</Badge>
                  </div>
                  {provider.lastTestStatus ? (
                    <p className="mt-2 text-xs text-muted">
                      Last test {provider.lastTestStatus}
                      {provider.lastTestedAt ? ` · ${provider.lastTestedAt}` : ""}
                    </p>
                  ) : null}
                  {testById[provider.id] ? (
                    <p className="mt-2 text-sm">
                      {testById[provider.id]?.ok ? "Reachable" : "Unreachable"}:{" "}
                      {testById[provider.id]?.message}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(provider)}>
                    Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void test(provider.id)}>
                    Test
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void remove(provider.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
