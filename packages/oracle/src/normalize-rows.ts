/**
 * Oracle LOB handles from node-oracledb are cyclic and break JSON.stringify / pg binds.
 * Prefer fetchAsBuffer / fetchAsString; this normalizes any remaining LOB-like values.
 */
export async function normalizeOracleCell(value: unknown): Promise<unknown> {
  if (value == null) {
    return null;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (value instanceof Date || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value;
  }
  const lob = value as {
    iLob?: unknown;
    type?: number;
    getData?: () => Promise<unknown>;
  };
  // node-oracledb Lob: has getData() and often a cyclic iLob pointer
  if (typeof lob.getData === "function") {
    try {
      return await lob.getData();
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => normalizeOracleCell(item)));
  }
  // Plain objects from OUT_FORMAT_OBJECT are fine; skip cyclic LOB leftovers.
  if ("iLob" in (value as object)) {
    return null;
  }
  return value;
}

export async function normalizeOracleRows(rows: unknown[][]): Promise<unknown[][]> {
  const out: unknown[][] = [];
  for (const row of rows) {
    const next: unknown[] = [];
    for (const cell of row) {
      next.push(await normalizeOracleCell(cell));
    }
    out.push(next);
  }
  return out;
}
