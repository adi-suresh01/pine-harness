import type { GpuRun } from "../../server/gpu";
import type { TriageStatus } from "./api";

// One line that says what the verdict means, built from evidence that checked out, never from the agent's prose.
export function headline(s: TriageStatus): string {
  const v = s.verdict!;
  const checks = (s.verified?.checks ?? []).filter((c) => c.status === "ok" && !c.viaAditya);
  const cat = s.verified?.categoryOut ?? v.category;
  const num = (target?: string) => target?.split("#")[1];
  if (cat === "duplicate") {
    const dup = checks.find((c) => c.isIssue && num(c.target) !== String(s.issueKey.split("-")[1]));
    return dup ? `Duplicate of #${num(dup.target)}` : "Duplicate";
  }
  if (cat === "already_fixed") {
    const pr = checks.find((c) => c.merged && c.urlType === "pull");
    if (pr) {
      const where = pr.facts.match(/in (v[\w.]+)/)?.[1];
      return `Fixed by #${num(pr.target)}${where ? `, shipped in ${where}` : ", nightly only"}`;
    }
    return checks.some((c) => c.urlType === "comment") ? "Fixed, confirmed on the thread" : "Already fixed";
  }
  if (cat === "needs_repro") {
    const open = checks.filter((c) => c.urlType === "pull" && c.merged === false).length;
    return open ? `Needs a GPU repro: ${open} open fix${open > 1 ? "es" : ""}` : "Needs a GPU repro";
  }
  if (cat === "needs_info") return "Needs a retest from the reporter";
  return "Not a bug";
}

export function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m?.[1] ?? text).trim();
}

export function checkedLine(s: TriageStatus): string {
  const checks = s.verified?.checks ?? [];
  const ok = checks.filter((c) => c.status === "ok").length;
  const conf = s.verdict!.confidence;
  return `${conf[0]!.toUpperCase()}${conf.slice(1)} confidence, ${ok} of ${checks.length} links check out`;
}

export function gpuLine(g: GpuRun | undefined): string | undefined {
  if (!g || !g.variants.length) return undefined;
  const base = g.variants.filter((v) => !v.patched);
  const fixes = g.variants.filter((v) => v.patched);
  const reproduced = base.some((v) => v.verdict && v.verdict !== "OK");
  const passed = fixes.filter((v) => v.verdict === "OK");
  const scores = passed.map((v) => v.gsm8k).filter((x): x is number => typeof x === "number");
  const control = base.find((v) => v.verdict === "OK")?.gsm8k;
  const gpu = g.gpu?.replace("NVIDIA ", "").replace(" Blackwell", "").replace(" Server Edition", "") ?? "GPU";
  const parts = [reproduced ? `Reproduced on 1x ${gpu}` : `Ran on 1x ${gpu}`];
  if (fixes.length) parts.push(`${passed.length} of ${fixes.length} fixes pass`);
  if (scores.length && typeof control === "number") {
    parts.push(`GSM8K ${Math.min(...scores).toFixed(2)} to ${Math.max(...scores).toFixed(2)} vs ${control.toFixed(2)}`);
  }
  if (typeof g.spentUsd === "number") parts.push(`$${g.spentUsd.toFixed(2)}`);
  return parts.join(", ");
}
