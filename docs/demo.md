# 90-second demo video

One take, recorded in the browser, real time. Bold words are the Pine feature on screen at that moment: say them as
part of the sentence, don't stop to explain them.

## Before you hit record

1. Brave at http://localhost:3000, full screen (Cmd+Ctrl+F), pine theme. Second tab open on
   https://github.com/vllm-project/vllm/issues/60172, signed in as you.
2. Click **Run 19 agents**, then wait about 2.5 minutes: verdicts start landing at about 2 minutes, so the count climbs
   while you record. (About $1.30 of agent time.)
3. Cmd+Shift+5, Record Entire Screen, microphone on if you narrate live.
4. The post at 0:58 is real and public. For a practice take, stop at GitHub's Comment button and click
   **Close without posting**.

## The take

**0:00, the live run.** Leave the screen on the agent that is working; the verdict count at the bottom climbs.

> This week I fixed GPU serving bugs in vLLM and SGLang. Most of that time went into triage, not GPUs.
> So I gave 19 open issues their own **Pine Computer**, each with its own **agent** in a real Chrome.

**0:12, the swarm.**

> Every run gets a **fresh session**, so no agent remembers another one's verdict.
> That's the actual desktop, streamed in with Pine's **Web SDK**, and every step comes in on the **event stream**.
> That's what moves the count at the bottom.

**0:25, hover Issues at the bottom, click one that just got a verdict.**

> Each verdict comes back as an **artifact**, and every link it cites is checked against GitHub before it shows up.
> Across today's runs, 339 of 339 links checked out.

**0:35, run picker to 3:33 PM, hover Issues, click #60172 under Duplicate.**

> This one is a duplicate I'd missed, with a fix PR I'd never seen.
> A Pine agent got the issue and the exact vLLM source as **attachments** and wrote its own patch.
> Then my **harness** put it on a real RTX PRO 6000: unpatched fails at boot, the patch serves.

Point at **Fix issue**.

> And this button does it again from scratch, live.

**0:50, hover Issues, click one under Needs a GPU, then Find root cause.**

> For the ones that need a GPU, the agent already wrote the experiment plan. My harness runs it once I approve the
> price. Next, the agent writes the kit too.

**0:58, back to #60172, click Post comment.** Copy comment, click the comment box on the desktop, Cmd+V, click
Comment, then **I posted it**.

> Agents never post. Pine **hands me control** of the one Computer signed in to my GitHub.
> Its **persistent identity** kept that sign-in through a restart today. I'm the one who clicks Comment.

**1:15, switch to the GitHub tab, refresh, scroll to the new comment.**

> And it's live on the thread: the repro, the trigger, all three open fixes compared.

**1:25, close.**

> 19 issues in under four minutes, about a dollar of agent time.
> The GPU only runs where it settles something.

Stop recording. Trim the ends in QuickTime (Edit, Trim) if it runs over 90 seconds.

## If a judge asks

- **Why a browser and not the GitHub API?** The evidence is spread across issue threads, PRs that never cite the
  issue, release pages and FlashInfer. The agent reads them the way I do; the server then checks every claim through
  the API.
- **The skill.** Pine **learned a skill** from the first good run. With it, runs got about 20 percent faster but leaned
  toward calling duplicates, because it learned from one. Pine makes you **review a skill** before agents use it, and
  that review is how I caught it. It's off for now.
- **Would you ship the agent's patch?** No. It reads the 48 KiB default shared-memory size instead of the opt-in
  limit, so Hopper would lose a pipeline stage too. The GPU can't see that. Agents draft, the GPU checks, I decide.
- **Cost.** About 7 to 8 cents per issue of agent time; 47 cents of GPU for the three-fix comparison, 58 cents for the
  live fix test.
