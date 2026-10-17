# Demo script

Bold words are the Pine feature on screen at that moment; say them, don't explain them.

## Before going on (20 minutes ahead)

- `cd ~/Desktop/sm120-kit && harness up vllm-60172-stage`: warms the GPU (about 5 minutes, $2.49/hr, 1.5-hour cap).
  `harness down vllm-60172-stage` right after the demo.
- `./scripts/with-env.sh bun run scripts/fleet.ts up 19` so no agent waits on a Computer start.
- Page open at http://localhost:3000 in Brave, full screen (Cmd+Ctrl+F). Poster desktop still signed in.
- If the slot is 3 minutes, see "Short version" at the bottom.

## 0:00 Hook, and start everything

Click **Run 19 agents**.

> This week I fixed LLM serving bugs on Blackwell workstation GPUs, in vLLM and SGLang.
> Most of that time didn't go into GPUs. It went into triage.
> Reading the thread. Finding the PR that already fixed it. Checking which release it shipped in.
> So I gave every open issue its own **Pine Computer**.

## 0:20 The swarm

> 19 open issues, 19 Computers, each with its own **agent** in a real Chrome.
> Every run gets a **fresh session**, so no agent remembers another one's verdict.
> What you're watching is the actual desktop, streamed in with Pine's **Web SDK**.

Point at the dots.

> Each step and screenshot comes in on Pine's **event stream**. When an agent finishes,
> its dot takes the verdict's color and slides into that group.

## 0:45 Start the fix (it runs while you talk)

Pick the 1:15 PM run in the run picker, click the #60172 dot, click **Ask a Pine agent to fix it**.
The main screen switches to that agent's desktop.

> This is a bug I reproduced this afternoon. Now a new Pine agent gets the issue and the exact vLLM 0.31 source,
> as **attachments**. It isn't allowed to look at the open fix PRs. It has to work it out from the error and the code.

## 1:00 Why you can trust the triage

> Every verdict comes back as a file the turn produced, a Pine **artifact**, and every link in it gets checked against
> GitHub. If it says fixed and the PR never merged, it gets moved back to needs info.
> Across three runs it matches my own triage on 4 to 6 of 8, and all 256 links it cited checked out. None made up.
> It also found things I missed: #60172 duplicates an older GB10 report, and there's a third fix PR I never saw.

## 1:45 Test it on the GPU

The diff lands in the verdict column (about 1.5 minutes after you asked). Click **Test it on the warm GPU**.

> That patch already passed one check: it applies to 0.31 and touches only that file.
> Now a real RTX PRO 6000 decides. First the unpatched code with the reporter's fp8 KV cache, then the agent's patch.

## 2:00 Post the comment (while the GPU runs)

Click **Post comment**, then Copy comment, click the comment box on the desktop, Cmd+V, click Comment.

> Agents never post. This one Computer is signed in to my GitHub, and Pine's **persistent identity** keeps that
> sign-in across restarts. No agent ever runs on it.
> Pine **hands me control**, and I'm the one who clicks Comment.
> The comment is this afternoon's GPU run: reproduced on one GPU, fp8 is the trigger, all three open fixes pass.

## 2:45 The skill

> Pine also **learned a skill** from the first good triage run. It made runs about 20 percent faster,
> but it leaned toward calling things duplicates, because it learned from one. Pine makes you **review a skill** before
> any agent uses it, and that review is how I caught it. So it's off for now.

## 3:15 Red, then green (the GPU test lands about 3.5 minutes after the click)

> Unpatched: fails at boot, Required 102400, limit 101376. The agent's patch: serves.

Then, if you want the expert beat:

> And I still wouldn't ship it. It reads the default shared-memory size, which is 48K on every NVIDIA GPU,
> so Hopper would lose a pipeline stage too. The GPU can't see that. That's why agents draft, the GPU checks,
> and I decide.

If the patch is red: "the GPU says no, and that's the point: nothing ships on an agent's word."

## Close

> 19 issues in under 5 minutes, about a dollar fifty of agent time, cents of GPU.
> Maintainers spend days on this. Now the GPU only runs where it settles something.

## Short version (3-minute slot)

Run the fix and the GPU test in the 10 minutes before going on, so #60172 already shows the agent's diff and red/green.
On stage: Run 19 agents, the swarm (0:20), trust (1:00), click #60172 and walk through diff, red, green (1:45),
Post comment (2:15), close (2:45). Mention the skill only if asked.

## If asked

- **Why a browser and not the GitHub API?** The evidence is spread across issue threads, PRs that never cite the
  issue, release pages and FlashInfer. The agent reads them the way I do; the server then checks every claim through
  the API.
- **Which Pine features?** Computers and sessions, the agent with attachments and artifacts, the event stream, the Web
  SDK live desktop, take control, persistent identity, skills (learn, review, activate on 19 Computers), and the
  agent's own shell for curl and patch. Table in the README.
- **The skill numbers.** Median 160 to 167 s per issue with it, 210 s without; 5 and 4 of 8 matches with it, 6 without.
- **Cost.** About 8 cents per issue of agent time. The GPU only for issues that need one: 47 cents for the full
  three-fix comparison, 43 cents for the rehearsal of the live fix.
