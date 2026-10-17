// bun run scripts/learn.ts <runId> <issueKey> [--activate <version>]
// Asks Pine's skill author to draft a SKILL.md from a finished triage turn, and prints the draft for review.
// Nothing reaches another agent until a person reads the draft and activates it.
import { join } from "node:path";
import { ensureComputer } from "../server/pine/fleet";
import { readJson, runDir } from "../server/store";
import type { TriageStatus } from "../server/triage/run";

const [runId, issueKey, flag, version] = process.argv.slice(2);
const status = await readJson<TriageStatus>(join(runDir(runId!, issueKey!), "status.json"));
if (!status?.sessionName) throw new Error("no session recorded for that triage");

const computer = await ensureComputer(status.slot);
if (flag === "--activate") {
  console.log(await computer.skills.activate("sm120-triage", Number(version)));
  process.exit(0);
}

const session = await computer.session(status.sessionName);
const scaffold = `---
name: sm120-triage
description: "Triage one open GitHub issue about LLM serving on NVIDIA sm_120/sm_121 GPUs into duplicate, already_fixed, needs_info, needs_repro or not_a_bug, with checked evidence, and write verdict.json."
origin: "github.com"
---
`;
const result = await session.learn({ scaffold });
console.log(JSON.stringify({ learned: result.learned, reason: result.reason, draft: result.draft }, null, 2));
for (const d of await computer.skills.drafts()) console.log("\n----- draft -----\n", JSON.stringify(d, null, 2).slice(0, 6000));
