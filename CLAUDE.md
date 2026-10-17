# pine-harness - Claude project context

One-day hackathon build (Pine Computer, Sat Oct 17 2026). Submissions close 6:40pm PT, demos 7pm.
Pine agents triage open sm_120 / Blackwell serving issues in vLLM and SGLang; issues that need a GPU go to the
harness in `~/Desktop/sm120-kit` (Rust CLI `harness`, see its `harness/README.md`).

## Rules

- Never post to GitHub (comments, issues, PRs) without Aditya's explicit approval in the same turn. Draft only.
- State GPU type, count and $/hr before creating any paid pod. Budgets go through `harness quote` and
  `harness budget set` in sm120-kit. Shut pods down when a run ends.
- Never wait on a GPU live in the demo: warm or pre-run, keep a recorded run as backup.
- Made-up numbers only in mockups, and labeled. The demo shows real results.
- Anything in Aditya's name (README, comments, commit bodies, pitch): `voice-aditya` skill.
- Plain ASCII. No em dashes, no emojis, no curly quotes.
- Secrets (Pine project key, RunPod key, GitHub token) via env vars, never committed, never pasted into chat.
- Conventional commits, imperative subject under 72 chars, no co-author trailer. Commit often.
