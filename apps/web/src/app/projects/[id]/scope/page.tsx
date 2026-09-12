"use client";

import {
  DATA_MODES,
  type DataMode,
  ORACLE_OBJECT_TYPES,
  type ScopePreviewDto,
  type UpsertScopeInput,
} from "@migrator/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

function parseLines(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function joinLines(values: string[]): string {
  return values.join("\n");
}

export default function ScopePage() {
  const params = useParams<{ id: string }>();
  const [includeSchemas, setIncludeSchemas] = useState<string[]>([]);
  const [includeObjectTypes, setIncludeObjectTypes] = useState<string[]>([...ORACLE_OBJECT_TYPES]);
  const [includeNamePatterns, setIncludeNamePatterns] = useState("");
  const [excludeNamePatterns, setExcludeNamePatterns] = useState("");
  const [excludeObjects, setExcludeObjects] = useState("");
  const [dataMode, setDataMode] = useState<DataMode>("NONE");
  const [selectedTables, setSelectedTables] = useState("");
  const [discoveredSchemas, setDiscoveredSchemas] = useState<string[]>([]);
  const [objectCount, setObjectCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<ScopePreviewDto | null>(null);
  const [inclusion, setInclusion] = useState<"included" | "excluded" | "all">("included");
  const [objectType, setObjectType] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const previewRequest = useRef(0);

  const input = useMemo<UpsertScopeInput>(
    () => ({
      includeSchemas,
      includeObjectTypes: includeObjectTypes as UpsertScopeInput["includeObjectTypes"],
      includeNamePatterns: parseLines(includeNamePatterns),
      excludeNamePatterns: parseLines(excludeNamePatterns),
      excludeObjects: parseLines(excludeObjects),
      dataMode,
      selectedTables: parseLines(selectedTables),
    }),
    [
      includeSchemas,
      includeObjectTypes,
      includeNamePatterns,
      excludeNamePatterns,
      excludeObjects,
      dataMode,
      selectedTables,
    ],
  );

  const loadPreview = useCallback(async () => {
    const seq = ++previewRequest.current;
    setPreviewing(true);
    setError(null);
    try {
      const data = await api.previewScope(params.id, input, {
        inclusion,
        objectType: objectType || undefined,
        q: query || undefined,
        page: 1,
        pageSize: 50,
      });
      if (seq === previewRequest.current) {
        setPreview(data);
      }
      return data;
    } finally {
      if (seq === previewRequest.current) {
        setPreviewing(false);
      }
    }
  }, [params.id, input, inclusion, objectType, query]);

  useEffect(() => {
    let cancelled = false;
    api
      .getScope(params.id)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setDiscoveredSchemas(result.discoveredSchemas);
        setObjectCount(result.objectCount);
        setSaved(result.scope.saved);
        setIncludeSchemas(result.scope.includeSchemas);
        setIncludeObjectTypes(result.scope.includeObjectTypes);
        setIncludeNamePatterns(joinLines(result.scope.includeNamePatterns));
        setExcludeNamePatterns(joinLines(result.scope.excludeNamePatterns));
        setExcludeObjects(joinLines(result.scope.excludeObjects));
        setDataMode(result.scope.dataMode);
        setSelectedTables(joinLines(result.scope.selectedTables));
        setPreviewing(true);
        setHydrated(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load scope");
          setHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadPreview().catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not preview scope");
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadPreview, hydrated]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveScope(params.id, input);
      setSaved(true);
      setIncludeSchemas(result.includeSchemas);
      setIncludeObjectTypes(result.includeObjectTypes);
      await loadPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save scope");
    } finally {
      setSaving(false);
    }
  }

  const totals = preview?.totals;
  const schemaOptions = [...new Set([...discoveredSchemas, ...includeSchemas])].sort();
  const busy = !hydrated || previewing || saving;
  const busyMessage = saving
    ? "Saving scope…"
    : previewing
      ? "Updating selected objects…"
      : "Loading scope…";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Migration scope</h1>
        <p className="mt-1 text-sm text-muted">
          Choose a partial set of discovered objects. Conversion never assumes the whole database.
        </p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {objectCount === 0 ? (
        <p className="text-sm text-warning">
          No inventory yet.{" "}
          <Link className="underline" href={`/projects/${params.id}/discovery`}>
            Run discovery
          </Link>{" "}
          first, or save rules now and preview after objects appear.
        </p>
      ) : null}

      <div className="relative" aria-busy={busy}>
        {busy ? (
          <div
            className="absolute inset-0 z-20 cursor-wait bg-background/70"
            role="status"
            aria-live="polite"
          >
            <div className="sticky top-32 flex justify-center px-4 pt-8">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg">
                <span
                  className="size-4 animate-spin rounded-full border-2 border-muted border-t-accent"
                  aria-hidden
                />
                <p className="text-sm">{busyMessage}</p>
              </div>
            </div>
          </div>
        ) : null}
        <fieldset disabled={busy} className="min-w-0 space-y-6 border-0 p-0">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Schemas</CardTitle>
              <Badge>{saved ? "Saved" : "Unsaved draft"}</Badge>
            </div>
            {schemaOptions.length === 0 ? (
              <p className="text-sm text-muted">No schemas in inventory.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {schemaOptions.map((schema) => {
                  const checked = includeSchemas.includes(schema);
                  return (
                    <label key={schema} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setIncludeSchemas((current) =>
                            checked
                              ? current.filter((value) => value !== schema)
                              : [...current, schema],
                          );
                        }}
                      />
                      {schema}
                    </label>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <CardTitle>Object types</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ORACLE_OBJECT_TYPES.map((type) => {
                const checked = includeObjectTypes.includes(type);
                return (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setIncludeObjectTypes((current) =>
                          checked ? current.filter((value) => value !== type) : [...current, type],
                        );
                      }}
                    />
                    {type.replaceAll("_", " ")}
                  </label>
                );
              })}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-3">
              <CardTitle>Include name patterns</CardTitle>
              <p className="text-xs text-muted">
                One glob or exact name per line. Empty means all names. Example: ORDER_*
              </p>
              <Textarea
                value={includeNamePatterns}
                onChange={(event) => setIncludeNamePatterns(event.target.value)}
                aria-label="Include name patterns"
              />
            </Card>
            <Card className="space-y-3">
              <CardTitle>Exclude name patterns</CardTitle>
              <p className="text-xs text-muted">Example: *_HISTORY, TMP_*, BACKUP_*</p>
              <Textarea
                value={excludeNamePatterns}
                onChange={(event) => setExcludeNamePatterns(event.target.value)}
                aria-label="Exclude name patterns"
              />
            </Card>
          </div>

          <Card className="space-y-3">
            <CardTitle>Exact exclusions</CardTitle>
            <p className="text-xs text-muted">
              OWNER.NAME or OWNER.NAME.TYPE per line. Example: CLV.OLD_ORDER
            </p>
            <Textarea
              value={excludeObjects}
              onChange={(event) => setExcludeObjects(event.target.value)}
              aria-label="Exact object exclusions"
            />
          </Card>

          <Card className="space-y-3">
            <CardTitle>Data copy</CardTitle>
            <p className="text-xs text-muted">
              Data movement is configured here; copying rows is a later phase.
            </p>
            <div className="flex flex-col gap-2">
              {DATA_MODES.map((mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="dataMode"
                    checked={dataMode === mode}
                    onChange={() => setDataMode(mode)}
                  />
                  {mode === "NONE"
                    ? "No data"
                    : mode === "ALL_SELECTED_TABLES"
                      ? "All selected tables"
                      : "Selected tables"}
                </label>
              ))}
            </div>
            {dataMode === "SELECTED_TABLES" ? (
              <div className="space-y-1.5">
                <Label htmlFor="selected-tables">Tables (OWNER.NAME)</Label>
                <Textarea
                  id="selected-tables"
                  value={selectedTables}
                  onChange={(event) => setSelectedTables(event.target.value)}
                />
              </div>
            ) : null}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={busy}>
              {saving ? "Saving…" : previewing ? "Updating…" : "Save scope"}
            </Button>
            {totals ? (
              <p className="text-sm text-muted">
                Found {totals.found.toLocaleString()} · Selected {totals.selected.toLocaleString()}{" "}
                · Excluded {totals.excluded.toLocaleString()}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ORACLE_OBJECT_TYPES.filter((type) => (preview?.byType[type]?.found ?? 0) > 0).map(
              (type) => {
                const count = preview?.byType[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setObjectType(objectType === type ? "" : type)}
                    className={`rounded-lg border px-3 py-3 text-left ${
                      objectType === type
                        ? "border-accent bg-surface-raised"
                        : "border-border bg-surface hover:bg-surface-raised"
                    }`}
                  >
                    <p className="text-xs text-muted">{type.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-sm">
                      Found {count?.found ?? 0} · Selected {count?.selected ?? 0}
                    </p>
                  </button>
                );
              },
            )}
          </div>

          <Card className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1 space-y-1.5">
                <p className="text-xs text-muted">Search name</p>
                <Input value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <div className="w-40 space-y-1.5">
                <p className="text-xs text-muted">Show</p>
                <Select
                  value={inclusion}
                  onChange={(event) =>
                    setInclusion(event.target.value as "included" | "excluded" | "all")
                  }
                >
                  <option value="included">Included</option>
                  <option value="excluded">Excluded</option>
                  <option value="all">All</option>
                </Select>
              </div>
              <p className="text-sm text-muted">{(preview?.total ?? 0).toLocaleString()} objects</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-muted">
                  <tr>
                    <th className="py-2 font-medium">Owner</th>
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">In scope</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview?.objects ?? []).map((object) => (
                    <tr key={object.id} className="border-b border-border/70">
                      <td className="py-2 font-mono text-xs">{object.owner}</td>
                      <td className="py-2 font-medium">{object.name}</td>
                      <td className="py-2 text-muted">{object.objectType.replaceAll("_", " ")}</td>
                      <td className="py-2 text-muted">
                        {object.included ? "Yes" : (object.reason ?? "No").replaceAll("_", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview && preview.data.selectedTableCount > 0 ? (
              <p className="text-sm text-muted">
                Data copy tables: {preview.data.selectedTableCount.toLocaleString()}
              </p>
            ) : null}
          </Card>
        </fieldset>
      </div>
    </div>
  );
}
