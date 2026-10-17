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
   reviewed it, fixed two rules (SGLang issues, and a reporter saying "no longer reproduces" counts as fixed), and
   activated it on every Computer. The draft and my edit are both in `skills/sm120-triage/`.
6. **The GPU.** needs_repro issues go to sm120-kit. The harness quotes the pod, I approve the budget, it runs the
   matrix and shuts the pod down. The page shows the run read-only; nothing here can rent a GPU.
7. **Posting.** Agents never post. "Review and post" opens the issue on the one Computer signed in to my GitHub and
   hands me the controls through Pine's take-control. I paste the draft and click Comment myself.

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
