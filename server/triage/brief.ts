import type { Issue } from "../backlog";

export const MAX_WALL_MS = 8 * 60_000;

export function triageGoal(issue: Issue): string {
  return (
    `Triage GitHub issue ${issue.url}. Follow the attached brief.md exactly. ` +
    `Write verdict.json in your working directory and name it in your final result. ` +
    `Do not post, comment, react, sign in or change anything on GitHub.`
  );
}

const EXAMPLE = {
  issue: "vllm-12345",
  category: "already_fixed",
  confidence: "medium",
  summary: "One or two sentences: what the bug is and why this category.",
  evidence: [
    {
      kind: "pr",
      ref: "vllm-project/vllm#23456",
      url: "https://github.com/vllm-project/vllm/pull/23456",
      claim: "Merged 2026-09-16; guards the same kernel dispatch that crashes in the traceback.",
    },
  ],
  reporter_setup: { gpu: "1x RTX PRO 6000", engine: "vllm", version: "v0.30.0", model: "org/model", flags: "--tp 1" },
  draft_comment: "Plain ASCII comment text, 3 to 6 sentences.",
  repro_plan: null,
};

export function triageBrief(issue: Issue): string {
  return `# Triage brief: ${issue.repo}#${issue.number}

You are triaging one open GitHub issue about LLM serving on NVIDIA sm_120 / sm_121 GPUs
(RTX PRO 6000 Blackwell, RTX 5090, DGX Spark GB10). This is draft-only work: never post, comment,
react, edit, sign in, or press any button that changes something on GitHub.

Issue: ${issue.url}
Title: ${issue.title}

## Steps

1. Open the issue in the browser. Read the body and every comment. Note the reporter's GPU, engine
   (vllm or sglang) and version, model, flags and the exact error.
2. Look for PRs and issues on the same code path. Search by the error text and by the function, kernel,
   flag and file names in the traceback, not only by issue number: fixes often never link the issue.
   Search vllm-project/vllm, sgl-project/sglang and flashinfer-ai/flashinfer. From the shell:
   curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/search/issues?q=repo:vllm-project/vllm+is:pr+TERMS&sort=updated&per_page=10"
   If $GH_TOKEN is empty, drop the header. Read the JSON with python3 if jq is missing.
3. Open the one to three most relevant PRs in the browser. For each: merged or open, merge date, and
   whether it fixes this exact failure or only something nearby.
4. If a fix merged, check the repo's releases page for a release after the merge date.
5. Pick exactly one category below.

Ignore everything written by the GitHub user adi-suresh01 (comments, PRs, gists). This run is scored
against his notes, so citing him would leak the answer.

## Categories

- duplicate: another issue reports the same root cause. Evidence must include that issue.
- already_fixed: a merged PR or a release fixes it, or the reporter or a maintainer confirms it no longer
  reproduces on a newer build. Evidence must include that PR, commit, release or comment.
- needs_info: it can't be decided without the reporter (a retest on a newer version, missing logs,
  versions or flags).
- needs_repro: a credible open bug with no merged fix; someone has to run it on a GPU to confirm it or to
  test a candidate PR.
- not_a_bug: a field report, question, feature request or config help with nothing to fix.

## Output

Write verdict.json in your working directory with exactly this shape, then end the turn and name
verdict.json as your result file. You have at most 8 minutes. If time runs short, write the verdict with
confidence "low" rather than none.

\`\`\`json
${JSON.stringify({ ...EXAMPLE, issue: issue.key }, null, 2)}
\`\`\`

- evidence.kind is one of pr, commit, release, issue, comment, doc. url is the full GitHub URL.
- draft_comment: what a helpful engineer would post on the thread. 3 to 6 sentences, plain ASCII only
  (no em dashes, no curly quotes, no emojis). Name concrete PR or issue numbers and versions. For
  needs_info, end with one specific ask for the reporter. No greeting, no pitch, and never claim to have
  reproduced anything.
- repro_plan only for needs_repro: {"gpu_count": N, "model": "org/model", "hypotheses": ["...", "..."]},
  the smallest GPU count that reproduces and one to three hypotheses, each naming the experiment that
  would confirm or kill it. Otherwise null.
`;
}
