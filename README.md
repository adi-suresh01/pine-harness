# pine-harness

Built at the Pine Computer hackathon in San Francisco (Oct 17, 2026).

This week I've been reproducing and fixing LLM serving bugs on NVIDIA sm_120 GPUs (RTX PRO 6000 Blackwell, RTX 5090)
in vLLM and SGLang, with a repro harness that rents a GPU, runs an experiment matrix and tears the pod down inside a
budget: [sm120-kit](https://github.com/adi-suresh01/sm120-kit). Most of the time on each issue went into triage, not
GPU runs: reading the thread, finding the PR that already fixed it, checking which release it landed in.

pine-harness puts that triage on Pine Computer agents. Each open issue gets its own Pine Computer and agent, which
reads the thread in a real browser, searches for duplicates and fixes, and writes a verdict with its evidence. Only
the issues that need a GPU go on to the harness.

## How it works

1. **Backlog.** `backlog/issues.json` holds 19 open sm_120 / sm_121 issues from vLLM and SGLang. 8 of them carry my
   own hand triage from this week, so every run is scored against it. I picked threads I had not commented on, so the
   agent can't just read my answer.
2. **One Computer per issue.** `server/pine/fleet.ts` creates or reconnects one Pine Computer per issue, and each run
   gets a fresh browser session so the agent starts with no memory of earlier verdicts. The project allows 20
   Computers at once: 19 triage, 1 poster.
3. **The agent.** `server/triage/brief.ts` is the brief the agent gets as an attachment. It reads the issue and every
   comment, searches PRs by the traceback's function, kernel and flag names (fixes often never link the issue), opens
   the strongest matches, and writes `verdict.json`: one of duplicate, already_fixed, needs_info, needs_repro or
   not_a_bug, with evidence links, the reporter's setup and a draft comment.
4. **Checked evidence.** `server/verify.ts` checks every PR, issue, commit, release and comment the agent cites
   against the GitHub API: does it exist, did the PR merge, which release contains it. An already_fixed with no
   merged fix behind it drops to needs_info. A rate limit leaves the verdict alone rather than downgrading it.
5. **The skill.** After the first good turn, Pine's skill author drafted `sm120-triage` from what the agent did. I
   reviewed it, fixed the rules that didn't fit (SGLang issues, a reporter saying "no longer reproduces" counts as
   fixed, a merged fix beats an older duplicate) and activated it on all 19 Computers. It made runs faster but leaned
   toward calling duplicates, so runs go without it by default. The draft and my edits are in `skills/sm120-triage/`.
6. **The GPU.** needs_repro issues go to sm120-kit. The harness quotes the pod, I approve the price, it runs the matrix
   and shuts the pod down. The page can start a pod only for a short stage kit, only at the price on screen, and
   never above $3 worst case.
7. **The fix.** "Ask a Pine agent to fix it" gives a fresh agent the issue and the exact source of the file in the
   traceback, and keeps it off the open fix PRs. The server refuses the patch unless it applies to that source and
   touches only that file. "Test it on the warm GPU" runs the unpatched code and the patch on a warm pod.
8. **Posting.** Agents never post. "Post comment" opens the issue on the one Computer signed in to my GitHub and hands
   me the controls through Pine's take-control. I paste the comment and click Comment myself.

## Results from today

Same 19 issues, three runs, all on Pine Computers:

| Run | Skill | Wall time | Median per issue | Agent cost | Matches my hand triage | Cited links that checked out |
|---|---|---|---|---|---|---|
| 1 | none | 5.6 min | 210 s | $1.61 | 6 of 8 | 93 of 93 |
| 2 | learned | 4.5 min | 160 s | $1.53 | 5 of 8 | 85 of 85 |
| 3 | rules fixed | 4.8 min | 167 s | $1.76 | 4 of 8 | 78 of 78 |

- vllm#60172: the swarm matched it to vllm#53748 (the GB10 report of the same overflow) and found a third fix PR,
  #54013. On one RTX PRO 6000 the harness reproduced it (fp8 KV cache fails at boot, `Required: 102400, Hardware
  limit: 101376`) and all three open fixes served, GSM8K-100 0.68 to 0.71 against 0.70 for the control. $0.47.
- The live fix, rehearsed: a Pine agent wrote its own patch in 82 s for $0.03 without opening the PRs. Unpatched fails
  at boot, the patch serves (GSM8K-50 0.66). It reads the 48 KiB default shared-memory size instead of the opt-in
  limit, so it would also slow Hopper down; the GPU can't see that, which is why I review before anything ships.

## Pine Computer features used

| Feature | Where |
|---|---|
| Computers: create, reconnect, start, recover, idle timeout, location, project limit | `server/pine/fleet.ts` |
| Sessions: a fresh one per triage, one for the fixer, a long-lived poster | `fleet.ts`, `fix.ts`, `poster.ts` |
| Pine's agent: run, wait, answer, cancel, wall-time cap, idempotency keys | `server/triage/run.ts`, `server/fix.ts` |
| Attachments and artifacts: the brief and source in, `verdict.json` and `agent-fix.diff` out | `run.ts`, `fix.ts` |
| Event stream: progress, steps and WebP screenshots, live and replayed | `run.ts`, `web/src/Stage.tsx` |
| Web SDK: the live desktop, desktop tokens per connect, drive mode and clipboard | `web/src/LiveDesktop.tsx` |
| Take and release control | `server/poster.ts`, `web/src/PostDialog.tsx` |
| Persistent identity and checkpoints: the GitHub sign-in on the poster | `server/poster.ts` |
| Skills: learn from a turn, review drafts, upload, activate on 19 Computers, select per run | `scripts/learn.ts`, `scripts/skill.ts` |
| Tabs and windows: open the issue in front on the poster | `server/poster.ts` |
| The agent's own shell inside a turn: curl to the GitHub API, diff, patch | the briefs |

## Run it

```bash
bun install
security add-generic-password -a "$USER" -s pine-project-key -w    # your pk_ key, read at run time
bun run build
./scripts/with-env.sh bun run server/index.ts                      # http://localhost:3000
```

One issue from the terminal: `./scripts/with-env.sh bun run scripts/triage-one.ts vllm-60172 0`.
Stop every Computer: `./scripts/with-env.sh bun run scripts/fleet.ts down`.

The server listens on 127.0.0.1 only. Pine keys, bindings and session tokens live in `state/`, which git ignores and
the server never serves.

## Rules this project keeps

- Nothing gets posted to GitHub without my approval. Agents draft, I post.
- GPU runs go through the sm120-kit harness, with the hourly price stated and a budget set before any pod exists.
- Numbers in the demo come from real runs.
