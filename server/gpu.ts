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
