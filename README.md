# pine-harness

Built at the Pine Computer hackathon in San Francisco (Oct 17, 2026).

This week I've been reproducing and fixing LLM serving bugs on NVIDIA sm_120 GPUs (RTX PRO 6000 Blackwell, RTX 5090)
in vLLM and SGLang, with a repro harness that rents a GPU, runs an experiment matrix and tears the pod down inside a
budget: [sm120-kit](https://github.com/adi-suresh01/sm120-kit). Most of the time on each issue went into triage, not
GPU runs: reading the thread, finding the PR that already fixed it, checking which release it landed in.

This repo puts that triage on Pine Computer agents, one per issue, and only sends the issues that need a GPU to the
harness.

Status: design in progress. Nothing here runs yet.

## Rules this project keeps

- Nothing gets posted to GitHub without my approval. Agents draft, I post.
- GPU runs go through the sm120-kit harness, with the hourly price stated and a budget set before any pod exists.
- Numbers in the demo come from real runs. Mockups are labeled.
