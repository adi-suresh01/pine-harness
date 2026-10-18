# Submission description

## Discord version (under 2,000 characters)

```
**pine-harness**: Pine Computer agents triage open Blackwell (sm_120) serving bugs in vLLM and SGLang.

**What it does**
Most of my time fixing these bugs goes into triage, not GPUs. So each of 19 open issues gets its own Pine Computer. The agent reads the thread in a real Chrome, digs through vLLM, SGLang and FlashInfer PRs and releases, and returns a verdict with evidence and a draft comment. My server checks every cited link against GitHub before it shows (489 of 489 held up). Issues that need a GPU go to my sm120-kit harness: for vllm#60172 an agent wrote its own patch, and a real RTX PRO 6000 showed unpatched fails at boot, patched serves. Agents never post; I click Comment myself.

**How I used Pine**
- One Pine Computer per issue, 19 at once, fresh session per run
- agent.run for triage and the fix, attachments for the brief and vLLM source, secrets for the GitHub token
- Event stream + Web SDK for the live desktop on the page
- Artifacts for verdict.json and the patch
- Take control + persistent identity: a signed-in Computer I post from by hand
- Learned skill, reviewed before use (that review caught a duplicate bias)

19 issues in ~4 min, ~8 cents an issue.
https://github.com/adi-suresh01/pine-harness
```

## What it does

This week I was fixing GPU serving bugs in vLLM and SGLang on RTX PRO 6000 (Blackwell, sm_120), and most of the time
went into triage, not GPUs: reading a thread, finding the FlashInfer PR that already fixed it, checking which release
it shipped in. pine-harness hands that work to Pine Computer agents.

Each of 19 open sm_120 issues gets its own Pine Computer. The agent reads its issue in a real Chrome, searches issues,
PRs and release notes across vLLM, SGLang and FlashInfer, and comes back with a verdict (already fixed, duplicate,
needs info, not a bug, or needs a GPU repro), the evidence, and a draft comment. Before a verdict shows up, my server
checks every link it cites against the GitHub API: the PR merged, the release actually contains the commit, the
duplicate is a different issue. A verdict that doesn't hold up gets downgraded.

Issues that need a GPU go to sm120-kit, my Rust harness for RTX PRO 6000 pods on RunPod. For vllm#60172 a Pine agent
got the issue and the exact vLLM source file, wrote its own patch, and the harness tested it red/green on a real RTX
PRO 6000: unpatched fails at boot (needs 102,400 bytes of shared memory, the GPU has 101,376), the agent's patch serves
with GSM8K 0.66. For the other GPU issues the agent writes a repro plan (GPU count, model, hypotheses). Today I turn a
plan into a kit by hand, the way I did for #60172; next is the agent writing the kit.

Agents never post. When a comment is ready, Pine hands me control of the one Computer signed in to my GitHub and I
click Comment myself. I posted one live in the demo, on vllm#58910.

## How I used Pine Computer

- **Pine Computer:** one per issue, 19 at once plus one for posting, under a project policy of 20.
- **Agent:** `agent.run` with a wall-clock cap per triage. Follow-up questions get answered automatically so a run
  never stalls.
- **Fresh session** per run, so no agent carries over another run's verdict.
- **Event stream:** every step and screenshot streams to the page. It drives the live view and the verdict count.
- **Artifacts:** `verdict.json` and the agent's patch come back as artifacts, parsed and verified on my server.
- **Attachments:** the triage brief, and for the fix, the exact vLLM source file at v0.31.0.
- **Secrets:** the GitHub token reaches the agent as a secret, never in the prompt.
- **Web SDK:** the live desktop on the page, with delegated desktop tokens.
- **Take control:** Post comment hands me the desktop of the signed-in Computer.
- **Persistent identity:** that Computer stayed signed in to GitHub through a restart.
- **Skills:** Pine learned an sm120-triage skill from my first good run. Reviewing the draft before turning it on is how
  I caught that it leaned toward calling duplicates, so runs default to no skill.

## Results (6 full runs today)

- 19 issues in 3.7 to 5.6 minutes, $1.33 to $1.76 of agent time per run (7 to 9 cents an issue).
- 489 of 489 cited links checked out against GitHub.
- Matched my own hand triage on 4 to 7 of 8 labeled issues; the best run got 7 of 8. The two runs with the learned
  skill scored 5 and 4.
- GPU: $0.47 for the three-fix comparison on vllm#60172, $0.58 for the live test of the agent's patch.

Repo: https://github.com/adi-suresh01/pine-harness

## Short version

pine-harness gives 19 open Blackwell (sm_120) serving issues in vLLM and SGLang their own Pine Computer. Each agent
reads the thread in a real Chrome and returns a verdict with evidence, and every cited link is checked against GitHub
(489 of 489 held up). GPU issues go to my sm120-kit harness: for vllm#60172 a Pine agent wrote its own patch and a real
RTX PRO 6000 showed unpatched fails at boot, patched serves. Agents never post; Pine hands me control of a signed-in
Computer and I click Comment. Pine features: Computers, agents, fresh sessions, event stream, artifacts, attachments,
secrets, Web SDK, take control, persistent identity, learned skills.
