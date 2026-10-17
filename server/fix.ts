import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadBacklog } from "./backlog";
import { publish } from "./bus";
import { STAGE_KITS } from "./gpu";
import { ensureComputer } from "./pine/fleet";
import { RUNS_DIR, writeJson } from "./store";
import { followEvents } from "./triage/run";

// A Pine agent writes a patch for an issue whose bug the GPU harness can reproduce. The server checks the patch
// applies to the exact source the pod runs and touches only that file; the GPU then decides whether it works.

const KIT = process.env.SM120_KIT ?? join(homedir(), "Desktop", "sm120-kit");
const MAX_WALL_MS = 5 * 60_000;

interface Target {
  /** the file the fix may change, relative to the vLLM repo root */
  path: string;
  /** the tag the pod's image was built from, so the patch applies to what actually runs */
  ref: string;
}
const TARGETS: Record<string, Target> = {
  "vllm-60172": { path: "vllm/v1/attention/ops/triton_decode_attention.py", ref: "v0.31.0" },
};

export interface FixStatus {
  /** PR pages the agent opened despite the brief, so the page can say so */
  openedPrs?: string[];
  /** an open PR whose change this patch repeats line for line */
  sameAs?: string;
  fixId: string;
  issueKey: string;
  slot: number;
  phase: "starting" | "running" | "checking" | "done" | "failed";
  sessionName?: string;
  startedAt: string;
  endedAt?: string;
  patch?: string;
  summary?: string;
  error?: string;
  lastFrame?: string;
  costUsd?: number | null;
}

let current: FixStatus | undefined;
export const currentFix = () => current;

export function fixableIssues(): string[] {
  return Object.keys(TARGETS);
}

function brief(issueUrl: string, title: string, t: Target): string {
  const file = t.path.split("/").pop();
  return `# Fix brief

Write the smallest correct fix for this GitHub issue, as a unified diff. Draft only: do not post, comment, push, open a
PR or sign in anywhere.

Issue: ${issueUrl}
Title: ${title}

The attached ${file} is \`${t.path}\` from vLLM ${t.ref}, the exact version the GPU test runs. Change only that file.

## Steps

1. Read the issue in the browser: the body and the error. Do not open the pull requests linked from it or search for
   other fixes: this run measures whether you can write the fix yourself from the report and the source. Work from
   the traceback, the numbers in the error and ${file}.
2. Find the code path the traceback names in ${file}, and work out why it needs more shared memory than the GPU has.
3. Make the smallest change that removes the failure on GPUs with a small shared-memory limit (sm_86, sm_89, sm_120,
   101,376 bytes per block) and keeps today's behavior on GPUs with more (Hopper, datacenter Blackwell). Keep the
   file's style. No new dependencies, no unrelated edits.
4. Write the diff with paths relative to the repo root, a/ and b/ prefixes, so \`patch -p1\` applies it from the root:
   mkdir -p a/$(dirname ${t.path}) b/$(dirname ${t.path})
   cp attachments/${file} a/${t.path} && cp attachments/${file} b/${t.path}
   (edit b/${t.path})
   diff -u a/${t.path} b/${t.path} > agent-fix.diff
5. Check it applies: mkdir check && cp -r a/vllm check/ && (cd check && patch -p1 --dry-run < ../agent-fix.diff)
6. End the turn naming agent-fix.diff as your result file, with one sentence on what the change does.

You have at most 5 minutes.
`;
}

export async function startFix(issueKey: string): Promise<FixStatus> {
  if (current && (current.phase === "starting" || current.phase === "running" || current.phase === "checking")) {
    throw new Error("an agent is already writing a fix");
  }
  const t = TARGETS[issueKey];
  if (!t || !STAGE_KITS[issueKey]) throw new Error(`no GPU test is set up for ${issueKey}`);
  const backlog = await loadBacklog();
  const issue = backlog.find((i) => i.key === issueKey)!;
  const slot = backlog.indexOf(issue);
  const d = new Date();
  const fixId = `fix-${[d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join("")}`;
  const status: FixStatus = { fixId, issueKey, slot, phase: "starting", startedAt: d.toISOString() };
  current = status;
  void runFix(status, issue.url, issue.title, t).catch((err) => update(status, { phase: "failed", error: (err as Error).message, endedAt: new Date().toISOString() }));
  return status;
}

async function update(s: FixStatus, patch: Partial<FixStatus>) {
  Object.assign(s, patch);
  await writeJson(join(RUNS_DIR, s.fixId, s.issueKey, "fix.json"), s).catch(() => undefined);
  publish("fix", { ...s });
}

async function runFix(s: FixStatus, issueUrl: string, title: string, t: Target) {
  const dir = join(RUNS_DIR, s.fixId, s.issueKey);
  const src = await fetch(`https://raw.githubusercontent.com/vllm-project/vllm/${t.ref}/${t.path}`);
  if (!src.ok) throw new Error(`could not fetch ${t.path} at ${t.ref} (${src.status})`);
  const source = await src.text();

  const computer = await ensureComputer(s.slot);
  // a session of its own: the triage session on this Computer may still be working
  for (const old of await computer.sessions()) {
    if (old.name.startsWith("fix-")) await computer.destroySession(old.name).catch(() => undefined);
  }
  const session = await computer.createSession({ name: s.fixId, label: `fix ${s.issueKey}`, browser: true });
  await update(s, { sessionName: session.name });
  await session.writeFile(t.path.split("/").pop()!, source);
  await session.writeFile("fix-brief.md", brief(issueUrl, title, t));

  const turn = await session.agent.run(`Write a minimal fix for ${issueUrl} as agent-fix.diff. Follow the attached fix-brief.md.`, {
    idempotencyKey: s.fixId,
    constraints: { maxWallMs: MAX_WALL_MS },
  });
  await update(s, { phase: "running" });

  const stream = new AbortController();
  const streaming = followEvents(session, { runId: s.fixId, issueKey: s.issueKey, dir }, stream.signal, (frame) => update(s, { lastFrame: frame })).catch(
    () => undefined,
  );
  let ended = turn;
  const deadline = Date.now() + MAX_WALL_MS + 3 * 60_000;
  while (Date.now() < deadline) {
    ended = await session.agent.wait(ended.turnId, { timeoutMs: 30_000 });
    if (ended.state !== "running" && ended.state !== "canceling") break;
  }
  await Promise.race([streaming, new Promise((r) => setTimeout(r, 3000))]);
  stream.abort();
  await update(s, { phase: "checking", summary: ended.result?.summary, costUsd: ended.result?.usage.cost.total ?? null });

  const arts = await session.listArtifacts({ turnId: ended.turnId }).catch(() => []);
  const art = arts.find((a) => a.filename.endsWith(".diff")) ?? arts.find((a) => a.filename.endsWith(".patch"));
  const bytes = art ? await session.readArtifact(art.id) : await session.readFile("agent-fix.diff").catch(() => undefined);
  if (!bytes) throw new Error(`the agent ended (${ended.state}) without agent-fix.diff`);
  const patch = new TextDecoder().decode(bytes);

  const problem = await checkPatch(patch, t, source);
  if (problem) throw new Error(problem);
  const openedPrs = await prsOpened(dir);
  const sameAs = await matchingPr(patch, STAGE_KITS[s.issueKey]!);
  await update(s, { openedPrs, sameAs });
  await writeFile(join(KIT, "issues", STAGE_KITS[s.issueKey]!, "patches", "agent-fix.diff"), patch);
  await update(s, { phase: "done", patch, endedAt: new Date().toISOString() });
}

/** Undefined when the patch is safe to put on the pod; otherwise why not. */
export async function checkPatch(patch: string, t: Target, source: string): Promise<string | undefined> {
  if (patch.length > 20_000) return "the patch is over 20 KB";
  const files = [...patch.matchAll(/^\+\+\+ (\S+)/gm)].map((m) => m[1]!.replace(/^b\//, ""));
  if (!files.length) return "that is not a unified diff";
  if (files.some((f) => f !== t.path)) return `the patch touches ${files.join(", ")}; only ${t.path} is allowed`;
  const root = await mkdtemp(join(tmpdir(), "fixcheck-"));
  try {
    const target = join(root, t.path);
    await Bun.write(target, source);
    const p = Bun.spawnSync(["patch", "-p1", "--dry-run", "--batch"], { cwd: root, stdin: new TextEncoder().encode(patch) });
    return p.exitCode === 0 ? undefined : `the patch does not apply to ${t.ref}: ${p.stdout.toString().slice(0, 200)}`;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// the changed lines only, so timestamps and hunk offsets don't hide a copy
function changedLines(patch: string): string {
  return patch
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
    .map((l) => l.trimEnd())
    .join("\n");
}

async function matchingPr(patch: string, kit: string): Promise<string | undefined> {
  const mine = changedLines(patch);
  const known: Record<string, string> = { "pr60173-smem-guard": "#60173", "pr54013-fp8-mla-stages": "#54013", "pr61068-oor-fallback": "#61068" };
  for (const [file, pr] of Object.entries(known)) {
    for (const k of [kit, kit.replace(/-stage$/, "")]) {
      const f = Bun.file(join(KIT, "issues", k, "patches", `${file}.diff`));
      if ((await f.exists()) && changedLines(await f.text()) === mine) return pr;
    }
  }
  return undefined;
}

async function prsOpened(dir: string): Promise<string[]> {
  const text = await Bun.file(join(dir, "events.jsonl")).text().catch(() => "");
  const prs = new Set<string>();
  for (const m of text.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g)) prs.add(`#${m[1]}`);
  return [...prs];
}
