// bun run scripts/triage-one.ts <issue-key> [slot]   e.g. vllm-60172 0
import { loadBacklog } from "../server/backlog";
import { subscribe } from "../server/bus";
import { runTriage } from "../server/triage/run";

const [key, slotArg] = process.argv.slice(2);
const issue = (await loadBacklog()).find((i) => i.key === key);
if (!issue) {
  console.error(`unknown issue ${key}`);
  process.exit(2);
}

subscribe(({ topic, data }) => {
  if (topic !== "event") return;
  const e = (data as { event: { type: string; progress?: string; activity?: { state: string; title: string } } }).event;
  if (e.progress) console.log(`  . ${e.progress}`);
  if (e.activity && e.activity.state !== "running") console.log(`  > [${e.activity.state}] ${e.activity.title}`);
});

const runId = `solo-${new Date().toISOString().slice(11, 19).replaceAll(":", "")}`;
const status = await runTriage(runId, issue, Number(slotArg ?? 0));
console.log(JSON.stringify({ phase: status.phase, error: status.error, parseError: status.parseError, verdict: status.verdict, verified: status.verified }, null, 2));
process.exit(0);
