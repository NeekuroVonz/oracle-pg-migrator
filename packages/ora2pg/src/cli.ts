import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OracleObjectType } from "@migrator/shared";

const ORA2PG_TYPES: Record<string, string> = {
  TABLE: "TABLE",
  SEQUENCE: "SEQUENCE",
  INDEX: "INDEX",
  VIEW: "VIEW",
};

function run(
  bin: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ORACLE_DSN: "", ORACLE_USER: "", ORACLE_PWD: "" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function convertWithOra2pgCli(input: {
  bin: string;
  sourceText: string;
  objectType: OracleObjectType;
}): Promise<string> {
  const type = ORA2PG_TYPES[input.objectType];
  if (!type) {
    throw new Error(`Ora2Pg file mode does not convert ${input.objectType}`);
  }
  const dir = await mkdtemp(join(tmpdir(), "ora2pg-"));
  const inputFile = join(dir, "source.sql");
  const outputFile = join(dir, "out.sql");
  try {
    await writeFile(inputFile, input.sourceText, "utf8");
    const result = await run(input.bin, ["-i", inputFile, "-t", type, "-o", outputFile]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `ora2pg exited ${result.code}`);
    }
    return (await readFile(outputFile, "utf8")).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
