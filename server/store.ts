import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const STATE_DIR = join(ROOT, "state");
export const RUNS_DIR = join(ROOT, "runs");
export const BACKLOG_FILE = join(ROOT, "backlog", "issues.json");

export function runDir(runId: string, issueKey?: string): string {
  return issueKey ? join(RUNS_DIR, runId, issueKey) : join(RUNS_DIR, runId);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

// write-then-rename so a crash mid-write never leaves half a fleet file, which holds the only copy of the keys
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}

export async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(value) + "\n");
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
