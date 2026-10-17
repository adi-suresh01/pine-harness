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
// set before the first await, so two clicks can't both pass the check
let starting = false;

export class RunBusyError extends Error {}

export function newRunId(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `r${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
}

export function anyLive(): boolean {
  return starting || live.size > 0;
}

/** Starts one triage per issue, each on its own Computer slot, and returns at once. */
export async function startSwarm(issueKeys?: string[], opts: TriageOptions = {}): Promise<RunMeta> {
  // a second run would destroy the first run's sessions on the same Computers
  if (anyLive()) throw new RunBusyError("a run is already going");
  starting = true;
  try {
    const backlog = await loadBacklog();
    const issues = issueKeys?.length ? backlog.filter((i) => issueKeys.includes(i.key)) : backlog;
    const runId = newRunId();
    const slots = Object.fromEntries(issues.map((i, n) => [i.key, n]));
    const meta: RunMeta = { runId, startedAt: new Date().toISOString(), issueKeys: issues.map((i) => i.key), slots, skills: opts.skills ?? [] };
    await writeJson(join(runDir(runId), "run.json"), meta);
    for (const issue of issues) {
      await writeJson(join(runDir(runId, issue.key), "status.json"), { runId, issueKey: issue.key, slot: slots[issue.key], phase: "queued" });
    }
    live.add(runId);
    publish("run", meta);
    void runAll(meta, issues, opts).catch((err) => console.error(`run ${runId} crashed: ${(err as Error).message}`));
    return meta;
  } finally {
    starting = false;
  }
}

async function runAll(meta: RunMeta, issues: Issue[], opts: TriageOptions) {
  try {
    // a small stagger keeps 20 creates and 20 first turns from landing in the same second
    await Promise.allSettled(
      issues.map(async (issue, n) => {
        await new Promise((r) => setTimeout(r, n * 1500));
        await runTriage(meta.runId, issue, meta.slots[issue.key]!, opts);
      }),
    );
  } finally {
    meta.endedAt = new Date().toISOString();
    live.delete(meta.runId);
    await writeJson(join(runDir(meta.runId), "run.json"), meta).catch(() => undefined);
    publish("run", meta);
  }
}

export function isLive(runId: string): boolean {
  return live.has(runId);
}

export async function listRuns(): Promise<RunMeta[]> {
  const entries = await readdir(RUNS_DIR, { withFileTypes: true }).catch(() => []);
  const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const metas = await Promise.all(ids.map((id) => readJson<RunMeta>(join(RUNS_DIR, id, "run.json"))));
  return metas.filter((m): m is RunMeta => !!m).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

const UNFINISHED = new Set(["queued", "starting", "running", "verifying"]);

export async function runStatuses(meta: RunMeta): Promise<TriageStatus[]> {
  const all = await Promise.all(meta.issueKeys.map((k) => readJson<TriageStatus>(join(runDir(meta.runId, k), "status.json"))));
  const statuses = all.filter((s): s is TriageStatus => !!s);
  if (isLive(meta.runId)) return statuses;
  // a run this process isn't driving can't still be working: the server restarted under it
  return statuses.map((s) => (UNFINISHED.has(s.phase) ? { ...s, phase: "failed", error: s.error ?? "stopped when the server restarted" } : s));
}
