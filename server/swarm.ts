import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadBacklog, type Issue } from "./backlog";
import { publish } from "./bus";
import { RUNS_DIR, readJson, runDir, writeJson } from "./store";
import { runTriage, type TriageOptions, type TriageStatus } from "./triage/run";

export interface RunMeta {
  runId: string;
  startedAt: string;
  endedAt?: string;
  issueKeys: string[];
  slots: Record<string, number>;
  skills: string[];
}

const live = new Set<string>();

export function newRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `r${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Starts one triage per issue, each on its own Computer slot, and returns at once. */
export async function startSwarm(issueKeys?: string[], opts: TriageOptions = {}): Promise<RunMeta> {
  const backlog = await loadBacklog();
  const issues = issueKeys?.length ? backlog.filter((i) => issueKeys.includes(i.key)) : backlog;
  const runId = newRunId();
  const slots = Object.fromEntries(issues.map((i, n) => [i.key, n]));
  const meta: RunMeta = { runId, startedAt: new Date().toISOString(), issueKeys: issues.map((i) => i.key), slots, skills: opts.skills ?? [] };
  await writeJson(join(runDir(runId), "run.json"), meta);
  for (const issue of issues) {
    await writeJson(join(runDir(runId, issue.key), "status.json"), { runId, issueKey: issue.key, slot: slots[issue.key], phase: "queued" });
  }
  publish("run", meta);
  live.add(runId);
  void runAll(meta, issues, opts);
  return meta;
}

async function runAll(meta: RunMeta, issues: Issue[], opts: TriageOptions) {
  // a small stagger keeps 20 creates and 20 first turns from landing in the same second
  await Promise.all(
    issues.map(async (issue, n) => {
      await new Promise((r) => setTimeout(r, n * 1500));
      await runTriage(meta.runId, issue, meta.slots[issue.key]!, opts);
    }),
  );
  meta.endedAt = new Date().toISOString();
  await writeJson(join(runDir(meta.runId), "run.json"), meta);
  live.delete(meta.runId);
  publish("run", meta);
}

export function isLive(runId: string): boolean {
  return live.has(runId);
}

export async function listRuns(): Promise<RunMeta[]> {
  const ids = await readdir(RUNS_DIR).catch(() => [] as string[]);
  const metas = await Promise.all(ids.map((id) => readJson<RunMeta>(join(RUNS_DIR, id, "run.json"))));
  return metas.filter((m): m is RunMeta => !!m).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function runStatuses(meta: RunMeta): Promise<TriageStatus[]> {
  const all = await Promise.all(meta.issueKeys.map((k) => readJson<TriageStatus>(join(runDir(meta.runId, k), "status.json"))));
  return all.filter((s): s is TriageStatus => !!s);
}
