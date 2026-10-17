import { expect, test } from "bun:test";
import { parseVerdict } from "../server/verdict";

const minimal = { issue: "vllm-60172", category: "needs_repro", summary: "two open PRs, none reviewed" };

test("fills defaults on a minimal verdict", () => {
  const r = parseVerdict(JSON.stringify(minimal));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.verdict.confidence).toBe("low");
  expect(r.verdict.evidence).toEqual([]);
  expect(r.verdict.repro_plan).toBeNull();
});

test("accepts a fenced file", () => {
  const r = parseVerdict("```json\n" + JSON.stringify(minimal) + "\n```");
  expect(r.ok).toBe(true);
});

test("rejects an unknown category with the field path", () => {
  const r = parseVerdict(JSON.stringify({ ...minimal, category: "wontfix" }));
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toContain("category");
});

test("rejects non-JSON", () => {
  expect(parseVerdict("the issue is fixed").ok).toBe(false);
});
