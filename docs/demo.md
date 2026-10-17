# Demo script (about 3 minutes)

Before going on (20 minutes ahead):
- `cd ~/Desktop/sm120-kit && harness up vllm-60172-stage` to warm the GPU (about 5 minutes, $2.49/hr, shuts itself
  down at its 1.5-hour deadline; `harness down vllm-60172-stage` right after the demo).
- `./scripts/with-env.sh bun run scripts/fleet.ts up 19` so no agent waits on a Computer start.
- Page open at http://localhost:3000 in Brave, full screen (Cmd+Ctrl+F). Poster desktop still signed in.
- The afternoon run stays in the run picker as the backup.

## 0:00 Hook, and start the run

Click **Run 19 agents** first, then talk.

> This week I fixed LLM serving bugs on Blackwell workstation GPUs, in vLLM and SGLang.
> Most of that time didn't go into GPUs. It went into triage.
> Reading the thread. Finding the PR that already fixed it. Checking which release it shipped in.
> So I gave every open issue its own Pine Computer.

## 0:25 The swarm

Point at the screen.

> That's 19 open sm_120 issues, 19 Computers, 19 agents, each in a real Chrome.
> This one is reading a vLLM issue right now. It searches PRs by the function and kernel names in the traceback,
> because the fix usually never links the issue.

Point at the dots.

> Each dot is an issue. When an agent finishes, its dot takes the verdict's color and moves into that group.

## 0:55 Why you can trust it

> Every link an agent cites gets checked against GitHub before it shows up here.
> If it says fixed and the PR never merged, it gets moved back to needs info.

## 1:15 The result (switch to the afternoon run if the live one is still going)

> I hand-triaged 8 of these this week. Across three runs it matches me on 4 to 6 of them,
> and the misses are judgment calls between duplicate and fixed.
> Every one of the 256 links the agents cited checked out. None were made up.
> And it found things I missed. #60172 is a duplicate of an older GB10 report,
> and there's a third fix PR I never saw.

Click the #60172 dot.

## 1:45 Fix it, live

Click **Ask a Pine agent to fix it**. The main screen switches to that agent's desktop.

> Now a fresh Pine agent gets the issue and the exact vLLM 0.31 source of the file in the traceback.
> It isn't allowed to look at the open fix PRs. It has to work it out from the error and the code.

About 2 minutes. The diff appears in the verdict column, and the server has already checked it applies to v0.31.0
and touches only that file.

Click **Test it on the warm GPU** (the pod was warmed 20 minutes before the demo).

> This is a real RTX PRO 6000 that's been warm since before I came up. First the unpatched code with the reporter's
> fp8 KV cache, then the agent's patch.

About 2 minutes. Red, then green:

> Unpatched: fails at boot, Required 102400, limit 101376. The agent's patch: serves.
> This afternoon the same harness compared all three open fix PRs: all three pass, GSM8K inside noise, 47 cents.

If the agent's patch is red: "the GPU says no, and that's the point: nothing ships on an agent's word."

## 2:15 Post it

Click **Post comment**, then Copy comment, click the comment box on the desktop, Cmd+V, click Comment.

> Agents never post. This Computer is the only one signed in to my GitHub, and no agent runs on it.
> Pine hands me the controls, and I click Comment.

## 2:45 Close

> 19 issues in under 5 minutes, about a dollar fifty of agent time, 47 cents of GPU.
> Maintainers spend days on this. Now the GPU only runs where it settles something.

## If asked

- **Why a browser and not the GitHub API?** The evidence is spread across issue threads, PRs that never cite the
  issue, release pages and FlashInfer. The agent reads them the way I do; the server then checks every claim through
  the API.
- **The skill.** Pine drafted `sm120-triage` from the first good run. With it, runs got about 15 to 20 percent faster
  (median 160 to 167 s against 210 s) but leaned toward duplicates: it had learned from one duplicate. A rule change
  didn't fully fix that, so the live run goes without it. Pine makes you review a skill before agents use it, and
  that review is why I measured it before trusting it.
- **Cost.** About 8 cents per issue of agent time. GPU only for the issues that need one.
