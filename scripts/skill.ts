// bun run scripts/skill.ts upload skills/sm120-triage/SKILL.md   -> a pending draft on every triage Computer
// bun run scripts/skill.ts activate                              -> serves the uploaded drafts (after review)
// bun run scripts/skill.ts status
// Skills belong to one Computer, so the reviewed SKILL.md goes to each of them. Upload never activates.
import { join } from "node:path";
import { ensureComputer, fleetEntries } from "../server/pine/fleet";
import { POSTER_SLOT } from "../server/poster";
import { STATE_DIR, readJson, writeJson } from "../server/store";

const NAME = "sm120-triage";
const FILE = join(STATE_DIR, "skills.json");
const [cmd, path] = process.argv.slice(2);

const slots = (await fleetEntries()).filter((e) => e.binding && e.slot !== POSTER_SLOT).map((e) => e.slot);
const uploaded = (await readJson<Record<string, number>>(FILE)) ?? {};

async function eachSlot(fn: (slot: number) => Promise<string>) {
  const results = await Promise.allSettled(slots.map(async (s) => `slot ${s}: ${await fn(s)}`));
  for (const r of results) console.log(r.status === "fulfilled" ? r.value : `failed: ${(r.reason as Error).message}`);
}

if (cmd === "upload") {
  const md = await Bun.file(path ?? "skills/sm120-triage/SKILL.md").text();
  await eachSlot(async (slot) => {
    const computer = await ensureComputer(slot);
    // authoring starts from a session; any session on the Computer will do
    const [s] = await computer.sessions();
    const session = s ?? (await computer.createSession({ name: "skills", browser: false }));
    const draft = await session.authorSkill(NAME, md, "reviewed edit of the draft Pine learned from the vllm-60172 triage turn");
    uploaded[slot] = Number(draft.version);
    return `pending v${draft.version}`;
  });
  await writeJson(FILE, uploaded);
} else if (cmd === "activate") {
  await eachSlot(async (slot) => {
    const version = uploaded[slot];
    if (!version) return "nothing uploaded";
    await (await ensureComputer(slot)).skills.activate(NAME, version);
    return `active v${version}`;
  });
} else if (cmd === "status") {
  await eachSlot(async (slot) => {
    const list = await (await ensureComputer(slot)).skills.list();
    const mine = list.find((k) => k.name === NAME);
    return mine ? JSON.stringify({ version: mine.version, status: mine.status ?? mine.enabled }) : "not served";
  });
} else {
  console.error("usage: skill.ts upload <SKILL.md> | activate | status");
  process.exit(2);
}
