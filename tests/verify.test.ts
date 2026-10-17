import { expect, test } from "bun:test";
import { parseGithubUrl, verifyVerdict } from "../server/verify";
import type { Verdict } from "../server/verdict";

function verdict(patch: Partial<Verdict>): Verdict {
  return {
    issue: "vllm-58910",
    category: "already_fixed",
    confidence: "medium",
    summary: "",
    evidence: [],
    reporter_setup: { gpu: "", engine: "", version: "", model: "", flags: "" },
    draft_comment: "",
    repro_plan: null,
    ...patch,
  };
}

const fake = (routes: Record<string, any>) => async (path: string) =>
  path in routes ? { status: 200, body: routes[path] } : { status: 404, body: "not found" };

test("parses PR, issue, comment, commit and release URLs", () => {
  expect(parseGithubUrl("https://github.com/vllm-project/vllm/pull/57152")).toEqual({ owner: "vllm-project", repo: "vllm", type: "pull", id: "57152" });
  expect(parseGithubUrl("https://github.com/vllm-project/vllm/issues/1#issuecomment-99")?.type).toBe("comment");
  expect(parseGithubUrl("https://github.com/flashinfer-ai/flashinfer/releases/tag/v0.7.2")?.type).toBe("release");
  expect(parseGithubUrl("https://example.com/x")).toBeUndefined();
});

test("keeps already_fixed when the PR merged, and names the release", async () => {
  const gh = fake({
    "/repos/flashinfer-ai/flashinfer/issues/5197": { pull_request: {}, user: { login: "someone" }, state: "closed" },
    "/repos/flashinfer-ai/flashinfer/pulls/5197": { merged: true, merged_at: "2026-09-18T00:00:00Z", merge_commit_sha: "abc" },
    "/repos/flashinfer-ai/flashinfer/releases/latest": { tag_name: "v0.7.2" },
    "/repos/flashinfer-ai/flashinfer/compare/abc...v0.7.2": { status: "ahead" },
  });
  const v = verdict({ evidence: [{ kind: "pr", ref: "fi#5197", url: "https://github.com/flashinfer-ai/flashinfer/pull/5197", claim: "" }] });
  const r = await verifyVerdict(v, "vllm-project/vllm#58910", gh);
  expect(r.downgraded).toBe(false);
  expect(r.checks[0]?.facts).toContain("in v0.7.2");
});

test("downgrades already_fixed when the cited PR is still open", async () => {
  const gh = fake({
    "/repos/vllm-project/vllm/issues/55758": { pull_request: {}, user: { login: "x" }, state: "open" },
    "/repos/vllm-project/vllm/pulls/55758": { merged: false, state: "open" },
  });
  const v = verdict({ evidence: [{ kind: "pr", ref: "#55758", url: "https://github.com/vllm-project/vllm/pull/55758", claim: "" }] });
  const r = await verifyVerdict(v, "vllm-project/vllm#58910", gh);
  expect(r.categoryOut).toBe("needs_info");
});

test("evidence from Aditya does not back a verdict", async () => {
  const gh = fake({ "/repos/vllm-project/vllm/issues/comments/7": { user: { login: "adi-suresh01" }, created_at: "2026-10-15" } });
  const v = verdict({ evidence: [{ kind: "comment", ref: "c", url: "https://github.com/vllm-project/vllm/issues/1#issuecomment-7", claim: "" }] });
  const r = await verifyVerdict(v, "vllm-project/vllm#58910", gh);
  expect(r.checks[0]?.viaAditya).toBe(true);
  expect(r.categoryOut).toBe("needs_info");
  expect(r.note).toContain("Aditya");
});

test("duplicate needs a real other issue", async () => {
  const gh = fake({ "/repos/flashinfer-ai/flashinfer/issues/3935": { user: { login: "r" }, state: "open", title: "regression" } });
  const v = verdict({
    issue: "vllm-48396",
    category: "duplicate",
    evidence: [{ kind: "issue", ref: "fi#3935", url: "https://github.com/flashinfer-ai/flashinfer/issues/3935", claim: "" }],
  });
  expect((await verifyVerdict(v, "vllm-project/vllm#48396", gh)).downgraded).toBe(false);
});

test("a rate limit leaves the verdict alone instead of downgrading it", async () => {
  const limited = async () => ({ status: 403, body: "rate limited" });
  const v = verdict({ evidence: [{ kind: "pr", ref: "#1", url: "https://github.com/vllm-project/vllm/pull/1", claim: "" }] });
  const r = await verifyVerdict(v, "vllm-project/vllm#58910", limited);
  expect(r.checks[0]?.status).toBe("unverified");
  expect(r.downgraded).toBe(false);
});

test("an issue URL labelled as a comment does not back already_fixed", async () => {
  const gh = fake({ "/repos/vllm-project/vllm/issues/58910": { user: { login: "r" }, state: "open", title: "crash" } });
  const v = verdict({ evidence: [{ kind: "comment", ref: "self", url: "https://github.com/vllm-project/vllm/issues/58910", claim: "" }] });
  expect((await verifyVerdict(v, "vllm-project/vllm#58910", gh)).categoryOut).toBe("needs_info");
});

test("parses API URLs the agents cite from their searches", () => {
  expect(parseGithubUrl("https://api.github.com/repos/vllm-project/vllm/pulls/60173")).toEqual({ owner: "vllm-project", repo: "vllm", type: "pull", id: "60173" });
});
