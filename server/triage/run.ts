import type { AgentEvent, AgentTurn, Session } from "@pinesandbox/computer";
import { join } from "node:path";
import type { Issue } from "../backlog";
import { publish } from "../bus";
import { ensureComputer, freshSession } from "../pine/fleet";
import { appendJsonl, runDir, writeBytes, writeJson } from "../store";
import { parseVerdict, type Verdict } from "../verdict";
import { verifyVerdict, type Verified } from "../verify";
import { MAX_WALL_MS, triageBrief, triageGoal } from "./brief";

export type Phase = "queued" | "starting" | "running" | "verifying" | "done" | "failed";

export interface TriageStatus {
  runId: string;
  issueKey: string;
  slot: number;
  phase: Phase;
  computerId?: string;
  sessionName?: string;
  turnId?: string;
  turnState?: string;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  verdict?: Verdict;
  verified?: Verified;
  parseError?: string;
  error?: string;
  costUsd?: number | null;
  lastFrame?: string;
}

// What the timeline needs from one agent event; frame bytes go to disk, not into the log.
export interface TimelineEvent {
  eventId: number;
  type: string;
  ts?: string;
  turnId: string;
  progress?: string;
  activity?: { id: string; state: string; kind: string; title: string; page?: string };
  frame?: { file: string; activityId?: string };
  result?: { terminalReason: string; summary: string };
}

export interface TriageOptions {
  skills?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TURN_DEADLINE_MS = MAX_WALL_MS + 4 * 60_000;

export async function runTriage(runId: string, issue: Issue, slot: number, opts: TriageOptions = {}): Promise<TriageStatus> {
  const dir = runDir(runId, issue.key);
  const status: TriageStatus = { runId, issueKey: issue.key, slot, phase: "starting", startedAt: new Date().toISOString() };
  const update = async (patch: Partial<TriageStatus>) => {
    Object.assign(status, patch);
    await writeJson(join(dir, "status.json"), status);
    publish("status", status);
  };
  await update({});

  try {
    const computer = await ensureComputer(slot);
    const session = await freshSession(computer, runId, issue.key);
    await update({ computerId: computer.id, sessionName: session.name });

    await session.writeFile("brief.md", triageBrief(issue));
    const token = process.env.GH_TRIAGE_TOKEN;
    const turn = await session.agent.run(triageGoal(issue), {
      idempotencyKey: `${runId}-${issue.key}`,
      constraints: { maxWallMs: MAX_WALL_MS },
      ...(token ? { secrets: { GH_TOKEN: token } } : {}),
      ...(opts.skills?.length ? { skills: opts.skills } : {}),
    });
    await update({ phase: "running", turnId: turn.turnId, turnState: turn.state });

    const stream = new AbortController();
    const streaming = followEvents(session, turn.turnId, { runId, issueKey: issue.key, dir }, stream.signal, async (frameFile) => {
      await update({ lastFrame: frameFile });
    }).catch((err) => console.warn(`[${issue.key}] event stream ended: ${(err as Error).message}`));

    const ended = await waitForTurn(session, turn);
    // the result event usually lands a beat after the turn ends; give the stream a moment to drain
    await Promise.race([streaming, sleep(3000)]);
    stream.abort();

    await update({
      phase: "verifying",
      turnState: ended.state,
      summary: ended.result?.summary,
      costUsd: ended.result?.usage.cost.total ?? null,
    });

    const text = await readVerdictText(session, ended.turnId);
    if (text === undefined) {
      return await finish(update, { phase: "failed", error: `no verdict.json (turn ${ended.state})` });
    }
    await Bun.write(join(dir, "verdict.raw.json"), text);
    const parsed = parseVerdict(text);
    if (!parsed.ok) return await finish(update, { phase: "failed", parseError: parsed.error, error: "verdict.json failed the schema" });

    const verified = await verifyVerdict(parsed.verdict, `${issue.repo}#${issue.number}`);
    await writeJson(join(dir, "verified.json"), verified);
    return await finish(update, { phase: "done", verdict: parsed.verdict, verified });
  } catch (err) {
    return await finish(update, { phase: "failed", error: (err as Error).message });
  }
}

async function finish(update: (p: Partial<TriageStatus>) => Promise<void>, patch: Partial<TriageStatus>) {
  await update({ ...patch, endedAt: new Date().toISOString() });
  return patch as TriageStatus;
}

async function waitForTurn(session: Session, first: AgentTurn): Promise<AgentTurn> {
  const deadline = Date.now() + TURN_DEADLINE_MS;
  let turn = first;
  let answers = 0;
  while (Date.now() < deadline) {
    turn = await session.agent.wait(turn.turnId, { timeoutMs: 30_000 });
    if (turn.state === "running" || turn.state === "canceling") continue;
    if (turn.state === "answered") {
      turn = await session.agent.wait(turn.nextTurnId, { timeoutMs: 0 });
      continue;
    }
    if (turn.state === "needs_input" && answers < 2) {
      answers++;
      // nobody watches 20 agents live, so a question gets the same answer the brief already gives
      turn = await session.agent.answer(
        turn.turnId,
        "No human is available. Use your best judgment. If unsure, pick needs_info with confidence low, write verdict.json now and name it in your result.",
      );
      continue;
    }
    return turn;
  }
  return session.agent.cancel(turn.turnId);
}

async function readVerdictText(session: Session, turnId: string): Promise<string | undefined> {
  const artifacts = await session.listArtifacts({ turnId }).catch(() => []);
  const art = artifacts.find((a) => a.filename === "verdict.json") ?? artifacts.find((a) => a.filename.endsWith(".json"));
  if (art) return new TextDecoder().decode(await session.readArtifact(art.id));
  // an agent that wrote the file but forgot to name it still left it in the work directory
  const bytes = await session.readFile("verdict.json").catch(() => undefined);
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}

async function followEvents(
  session: Session,
  turnId: string,
  where: { runId: string; issueKey: string; dir: string },
  signal: AbortSignal,
  onFrame: (file: string) => Promise<void>,
): Promise<void> {
  const { dir, runId, issueKey } = where;
  const { taskId } = await session.agent.status();
  for await (const ev of session.agent.events({ expectedTaskId: taskId, signal })) {
    if (ev.turnId && ev.turnId !== turnId) continue;
    const t = await toTimeline(ev, dir);
    await appendJsonl(join(dir, "events.jsonl"), t);
    publish("event", { runId, issueKey, event: t });
    if (t.frame) await onFrame(t.frame.file);
    if (t.result) return;
  }
}

async function toTimeline(ev: AgentEvent, dir: string): Promise<TimelineEvent> {
  const t: TimelineEvent = { eventId: ev.eventId, type: ev.type, ts: ev.ts?.toISOString(), turnId: ev.turnId };
  const progress = ev.progress();
  if (progress) t.progress = progress.text;
  const a = ev.activity();
  if (a) t.activity = { id: a.id, state: a.state, kind: a.kind, title: a.title, page: a.facts?.page?.url };
  const f = ev.frame();
  if (f) {
    const file = `frames/${ev.eventId}.webp`;
    await writeBytes(join(dir, file), f.data);
    t.frame = { file, activityId: f.activity?.id };
  }
  const r = ev.result();
  if (r) t.result = { terminalReason: r.terminalReason, summary: r.summary };
  return t;
}
