import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Read-only view of sm120-kit harness runs. Pods only ever start from a terminal, after Aditya
// approves the budget; the page just shows what the harness logged.
const KIT = process.env.SM120_KIT ?? join(homedir(), "Desktop", "sm120-kit");

export interface GpuVariant {
  name: string;
  /** true when the variant applied a fix PR */
  patched?: boolean;
  phase?: string;
  verdict?: string;
  bootS?: number;
  fault?: string | null;
  gsm8k?: number | null;
}

export interface GpuRun {
  issueKey: string;
  kitReady: boolean;
  podState: "none" | "quoted" | "starting" | "setup" | "running" | "done";
  gpu?: string;
  rateUsdHr?: number;
  spentUsd?: number;
  variants: GpuVariant[];
  updatedAt?: string;
}

async function lines(path: string): Promise<Record<string, any>[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  const out: Record<string, any>[] = [];
  for (const l of text.split("\n")) {
    try {
      if (l) out.push(JSON.parse(l));
    } catch {
      // a line still being written
    }
  }
  return out;
}

export async function gpuRun(issueKey: string): Promise<GpuRun> {
  const kitReady = await Bun.file(join(KIT, "issues", issueKey, "harness.toml")).exists();
  const events = await lines(join(KIT, "results", issueKey, "events.jsonl"));
  const run: GpuRun = { issueKey, kitReady, podState: "none", variants: [] };
  const byName = new Map<string, GpuVariant>();
  const variant = (name: string) => {
    let v = byName.get(name);
    if (!v) byName.set(name, (v = { name }));
    return v;
  };

  // only the latest pod's story: everything after the last create
  const lastCreate = events.map((e) => e.kind).lastIndexOf("create");
  const recent = lastCreate >= 0 ? events.slice(lastCreate) : events;
  for (const e of events) if (e.kind === "quote" && run.podState === "none") Object.assign(run, { podState: "quoted", gpu: e.gpu, rateUsdHr: e.rate_usd_hr });
  for (const e of recent) {
    run.updatedAt = e.ts;
    if (e.kind === "create") Object.assign(run, { podState: "starting", gpu: e.gpu ?? run.gpu, rateUsdHr: e.rate_usd_hr ?? run.rateUsdHr });
    else if (e.kind === "ready" || e.kind === "setup") run.podState = "setup";
    else if (e.kind === "variant_start") {
      run.podState = "running";
      Object.assign(variant(e.variant), { phase: "starting", patched: Array.isArray(e.patches) && e.patches.length > 0 });
    } else if (e.kind === "phase" && e.variant) variant(e.variant).phase = e.phase;
    else if (e.kind === "verdict" && e.variant) {
      Object.assign(variant(e.variant), { verdict: e.verdict, bootS: e.boot_s, fault: e.fault, gsm8k: e.gsm8k, phase: "done" });
    } else if (e.kind === "terminate") Object.assign(run, { podState: "done", spentUsd: e.cost_usd });
    else if (e.kind === "budget" && typeof e.spent_usd === "number") run.spentUsd = e.spent_usd;
  }
  run.variants = [...byName.values()];
  return run;
}

// ---- live runs from the page -------------------------------------------------------------------------------
// The page may start a pod only for a stage kit, only at the price the person just saw, and never above
// MAX_STAGE_USD. The click is the approval; it goes into the harness ledger as such.

/** Triage issue -> the short sm120-kit folder a live demo may run. */
export const STAGE_KITS: Record<string, string> = { "vllm-60172": "vllm-60172-stage" };
const MAX_STAGE_USD = 3;

export interface GpuQuote {
  kit: string;
  gpu: string;
  cloud: string;
  rateUsdHr: number;
  worstCaseUsd: number;
}

const running = new Map<string, Bun.Subprocess>();

// async on purpose: a quote reads the RunPod catalog, and a blocking spawn would stall every live stream meanwhile
async function harness(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(["harness", ...args], { cwd: KIT, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

function lastEvent(out: string, kind: string): Record<string, any> | undefined {
  const lines = out.split("\n").filter((l) => l.includes(`"kind":"${kind}"`));
  try {
    return lines.length ? JSON.parse(lines[lines.length - 1]!) : undefined;
  } catch {
    return undefined;
  }
}

export async function gpuQuote(issueKey: string): Promise<GpuQuote> {
  const kit = STAGE_KITS[issueKey];
  if (!kit) throw new Error(`no stage kit for ${issueKey}`);
  const q = lastEvent((await harness(["quote", kit])).out, "quote");
  if (!q) throw new Error("harness quote returned nothing; is the RunPod key set?");
  return { kit, gpu: q.gpu, cloud: q.cloud, rateUsdHr: q.rate_usd_hr, worstCaseUsd: q.worst_case_usd };
}

export function gpuLive(kit: string): boolean {
  const p = running.get(kit);
  return !!p && p.exitCode === null;
}

/** Records the approval in the kit's ledger and starts `harness run`, which terminates the pod on every exit. */
let approving = false;

export async function approveGpuRun(issueKey: string, shownWorstCaseUsd: number): Promise<GpuQuote> {
  // one approval at a time: two quick clicks must not start two pods
  if (approving) throw new Error("already starting a pod");
  approving = true;
  try {
    return await approve(issueKey, shownWorstCaseUsd);
  } finally {
    approving = false;
  }
}

async function approve(issueKey: string, shownWorstCaseUsd: number): Promise<GpuQuote> {
  const q = await gpuQuote(issueKey);
  if (gpuLive(q.kit)) throw new Error("a pod for this kit is already running");
  // the price must still be the one on screen: stock and rates move
  if (Math.abs(q.worstCaseUsd - shownWorstCaseUsd) > 0.01) throw new Error(`the quote changed to $${q.worstCaseUsd.toFixed(2)}; look again`);
  if (q.worstCaseUsd > MAX_STAGE_USD) throw new Error(`worst case $${q.worstCaseUsd.toFixed(2)} is over the $${MAX_STAGE_USD} stage cap`);

  const shown = lastEvent((await harness(["budget", "show", q.kit])).out, "budget");
  const spent = typeof shown?.spent_usd === "number" ? shown.spent_usd : 0;
  const budget = Math.ceil((spent + q.worstCaseUsd + 0.25) * 100) / 100;
  const note =
    `Approved by Aditya on the pine-harness page ${new Date().toISOString()}: 1x ${q.gpu} ${q.cloud} ` +
    `$${q.rateUsdHr}/hr, worst case $${q.worstCaseUsd.toFixed(2)}`;
  const set = await harness(["budget", "set", q.kit, budget.toFixed(2), "--note", note]);
  if (set.code !== 0) throw new Error(`harness budget set failed: ${set.out.slice(-200)}`);

  const log = Bun.file(join(KIT, "results", `${q.kit}.stage-run.log`));
  const p = Bun.spawn(["harness", "run", q.kit], { cwd: KIT, env: process.env, stdout: log, stderr: log });
  running.set(q.kit, p);
  return q;
}
