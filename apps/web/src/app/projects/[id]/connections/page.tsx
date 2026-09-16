"use client";

import type { ConnectionDto, ConnectionTestResult } from "@migrator/shared";
import { useParams } from "next/navigation";
import { type FormEvent, type InputHTMLAttributes, useEffect, useState } from "react";
import { ReadOnlyCallout } from "@/components/read-only-callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

export default function ConnectionsPage() {
  const params = useParams<{ id: string }>();
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [oracleResult, setOracleResult] = useState<ConnectionTestResult | null>(null);
  const [postgresResult, setPostgresResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oracleType, setOracleType] = useState<"SID" | "SERVICE_NAME" | "TNS">("SERVICE_NAME");
  const [editingOracle, setEditingOracle] = useState(false);
  const [editingPostgres, setEditingPostgres] = useState(false);
  const [pending, setPending] = useState(false);

  async function refresh() {
    setConnections(await api.listConnections(params.id));
  }

  useEffect(() => {
    let cancelled = false;
    api
      .listConnections(params.id)
      .then((rows) => {
        if (!cancelled) {
          setConnections(rows);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const source = connections.find((connection) => connection.role === "SOURCE");
  const target = connections.find((connection) => connection.role === "TARGET");
  const showOracleForm = !source || editingOracle;
  const showPostgresForm = !target || editingPostgres;

  async function saveOracle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    setError(null);
    setPending(true);
    try {
      const payload = {
        displayName: String(form.get("displayName")),
        host: String(form.get("host") || "") || undefined,
        port: Number(form.get("port") || 1521),
        connectType: oracleType,
        sid: String(form.get("sid") || "") || undefined,
        serviceName: String(form.get("serviceName") || "") || undefined,
        tns: String(form.get("tns") || "") || undefined,
        username: String(form.get("username")),
        schemas: String(form.get("schemas") || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        connectionTimeoutMs: Number(form.get("timeout") || 15000),
        ...(password ? { password } : {}),
      };
      if (source) {
        await api.updateOracle(params.id, source.id, payload);
      } else {
        await api.createOracle(params.id, { ...payload, password });
      }
      setEditingOracle(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function savePostgres(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    setError(null);
    setPending(true);
    try {
      const payload = {
        displayName: String(form.get("displayName")),
        host: String(form.get("host")),
        port: Number(form.get("port") || 5432),
        database: String(form.get("database")),
        schema: String(form.get("schema") || "public"),
        username: String(form.get("username")),
        sslMode: String(form.get("sslMode") || "prefer"),
        postgresVersion: String(form.get("postgresVersion") || "") || undefined,
        ...(password ? { password } : {}),
      };
      if (target) {
        await api.updatePostgres(params.id, target.id, payload);
      } else {
        await api.createPostgres(params.id, { ...payload, password });
      }
      setEditingPostgres(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function test(connectionId: string, kind: "oracle" | "postgres") {
    setError(null);
    try {
      const result = await api.testConnection(params.id, connectionId);
      if (kind === "oracle") {
        setOracleResult(result);
      } else {
        setPostgresResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    }
  }

  async function remove(connectionId: string, kind: "oracle" | "postgres") {
    if (!window.confirm("Delete this connection?")) {
      return;
    }
    setError(null);
    try {
      await api.deleteConnection(params.id, connectionId);
      if (kind === "oracle") {
        setOracleResult(null);
        setEditingOracle(false);
      } else {
        setPostgresResult(null);
        setEditingPostgres(false);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function startOracleEdit(): void {
    setOracleType(
      source?.oracleConnectType === "SID" || source?.oracleConnectType === "TNS"
        ? source.oracleConnectType
        : "SERVICE_NAME",
    );
    setEditingOracle(true);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted">
          Source Oracle is hardcoded read-only. Edit a saved connection to change host, user, or
          password.
        </p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Source Oracle</CardTitle>
          <Badge className="border-warning/50 bg-warning/10 text-warning">🔒 READ ONLY</Badge>
        </div>
        <ReadOnlyCallout />
        {source && !showOracleForm ? (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-muted">Name</span> {source.displayName}
            </p>
            <p>
              <span className="text-muted">User</span> {source.username}
            </p>
            <p>
              <span className="text-muted">Host</span> {source.host}:{source.port}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => test(source.id, "oracle")}>
                Test Oracle connection
              </Button>
              <Button size="sm" variant="secondary" onClick={startOracleEdit}>
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove(source.id, "oracle")}>
                Delete
              </Button>
            </div>
            {oracleResult ? <TestResult result={oracleResult} /> : null}
          </div>
        ) : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={saveOracle}>
            <Field
              label="Display name"
              name="displayName"
              required
              defaultValue={source?.displayName ?? "CLV Oracle"}
            />
            <div className="space-y-1.5">
              <Label htmlFor="connectType">Connect type</Label>
              <Select
                id="connectType"
                value={oracleType}
                onChange={(event) =>
                  setOracleType(event.target.value as "SID" | "SERVICE_NAME" | "TNS")
                }
              >
                <option value="SERVICE_NAME">Service name</option>
                <option value="SID">SID</option>
                <option value="TNS">TNS</option>
              </Select>
            </div>
            <Field label="Host" name="host" defaultValue={source?.host ?? "localhost"} />
            <Field
              label="Port"
              name="port"
              type="number"
              defaultValue={String(source?.port ?? 1521)}
            />
            {oracleType === "SID" ? (
              <Field label="SID" name="sid" required defaultValue={source?.oracleSid ?? ""} />
            ) : null}
            {oracleType === "SERVICE_NAME" ? (
              <Field
                label="Service name"
                name="serviceName"
                required
                defaultValue={source?.oracleServiceName ?? "ORCL"}
              />
            ) : null}
            {oracleType === "TNS" ? (
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="tns">TNS</Label>
                <Textarea id="tns" name="tns" required defaultValue={source?.oracleTns ?? ""} />
              </div>
            ) : null}
            <Field
              label="Username"
              name="username"
              required
              defaultValue={source?.username ?? ""}
            />
            <Field
              label={source ? "Password (blank keeps current)" : "Password"}
              name="password"
              type="password"
              required={!source}
              autoComplete="off"
            />
            <Field
              label="Schemas to migrate (comma-separated)"
              name="schemas"
              placeholder="Leave blank to use the Oracle username"
              defaultValue={(source?.oracleSchemas ?? []).join(", ")}
            />
            <Field
              label="Timeout ms"
              name="timeout"
              type="number"
              defaultValue={String(source?.connectionTimeoutMs ?? 15000)}
            />
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : source ? "Save changes" : "Save Oracle source"}
              </Button>
              {source ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingOracle(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </Card>

      <Card className="space-y-4">
        <CardTitle>Target PostgreSQL</CardTitle>
        <p className="text-sm text-muted">
          Deploy of validated SQL is an explicit action from a conversion run. Connection tests do
          not apply SQL.
        </p>
        {target && !showPostgresForm ? (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-muted">Name</span> {target.displayName}
            </p>
            <p>
              <span className="text-muted">Host</span> {target.host}:{target.port}
            </p>
            <p>
              <span className="text-muted">Database</span> {target.databaseName}
            </p>
            <p>
              <span className="text-muted">User</span> {target.username}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => test(target.id, "postgres")}>
                Test PostgreSQL connection
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingPostgres(true)}>
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove(target.id, "postgres")}>
                Delete
              </Button>
            </div>
            {postgresResult ? <TestResult result={postgresResult} /> : null}
          </div>
        ) : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={savePostgres}>
            <Field
              label="Display name"
              name="displayName"
              required
              defaultValue={target?.displayName ?? "CLV PostgreSQL"}
            />
            <Field label="Host" name="host" required defaultValue={target?.host ?? "localhost"} />
            <Field
              label="Port"
              name="port"
              type="number"
              defaultValue={String(target?.port ?? 5432)}
            />
            <Field
              label="Database"
              name="database"
              required
              defaultValue={target?.databaseName ?? "migrator"}
            />
            <Field label="Schema" name="schema" defaultValue={target?.schemaName ?? "public"} />
            <p className="md:col-span-2 text-xs text-muted">
              Converted objects go into a PostgreSQL schema named after the Oracle owner (WMS1 →
              wms1), not this field. Deploy is what creates that schema on the target.
            </p>
            <Field
              label="Username"
              name="username"
              required
              defaultValue={target?.username ?? "migrator"}
            />
            <Field
              label={target ? "Password (blank keeps current)" : "Password"}
              name="password"
              type="password"
              required={!target}
              autoComplete="off"
            />
            <div className="space-y-1.5">
              <Label htmlFor="sslMode">SSL mode</Label>
              <Select id="sslMode" name="sslMode" defaultValue={target?.sslMode ?? "prefer"}>
                <option value="disable">disable</option>
                <option value="prefer">prefer</option>
                <option value="require">require</option>
                <option value="verify-ca">verify-ca</option>
                <option value="verify-full">verify-full</option>
              </Select>
            </div>
            <Field
              label="PostgreSQL version"
              name="postgresVersion"
              placeholder="16"
              defaultValue={target?.postgresVersion ?? ""}
            />
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : target ? "Save changes" : "Save PostgreSQL target"}
              </Button>
              {target ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingPostgres(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

function Field({
  label,
  name,
  ...props
}: { label: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
    </div>
  );
}

function TestResult({ result }: { result: ConnectionTestResult }) {
  return (
    <div className="rounded-md border border-border bg-background p-3 text-sm">
      <p className="font-medium">{result.ok ? "Connected" : "Failed"}</p>
      <p className="mt-1 text-muted">{result.message}</p>
      {result.serverVersion ? (
        <p className="mt-1 font-mono text-xs">{result.serverVersion}</p>
      ) : null}
      {result.privilegeStatus ? (
        <div className="mt-3 space-y-1">
          <p>Read privileges: {result.privilegeStatus.readPrivileges ? "✓" : "Not detected"}</p>
          <p>
            Write privileges:{" "}
            {result.privilegeStatus.writePrivileges === "DETECTED" ? "Detected" : "Not Detected"}
          </p>
          {result.privilegeStatus.warning ? (
            <p className="text-warning">{result.privilegeStatus.warning}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
