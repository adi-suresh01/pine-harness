import { z } from "zod";

export const CATEGORIES = ["duplicate", "already_fixed", "needs_info", "needs_repro", "not_a_bug"] as const;
export type Category = (typeof CATEGORIES)[number];

const Evidence = z.object({
  kind: z.enum(["pr", "commit", "release", "issue", "comment", "doc"]),
  ref: z.string(),
  url: z.string(),
  claim: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

// agents fill this loosely, so everything but the category and summary has a default
export const VerdictSchema = z.object({
  issue: z.string(),
  category: z.enum(CATEGORIES),
  confidence: z.enum(["low", "medium", "high"]).default("low"),
  summary: z.string(),
  evidence: z.array(Evidence).default([]),
  reporter_setup: z
    .object({
      gpu: z.string().default(""),
      engine: z.string().default(""),
      version: z.string().default(""),
      model: z.string().default(""),
      flags: z.string().default(""),
    })
    .default({ gpu: "", engine: "", version: "", model: "", flags: "" }),
  draft_comment: z.string().default(""),
  repro_plan: z
    .object({
      gpu_count: z.number().int().positive(),
      model: z.string(),
      hypotheses: z.array(z.string()),
    })
    .nullable()
    .default(null),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export type ParseResult = { ok: true; verdict: Verdict } | { ok: false; error: string };

export function parseVerdict(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch (err) {
    return { ok: false, error: `not JSON: ${(err as Error).message}` };
  }
  const parsed = VerdictSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, verdict: parsed.data };
}

// some agents wrap the file in a markdown fence even when told not to
function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m?.[1] ?? text;
}
