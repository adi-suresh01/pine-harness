import type { Issue } from "../../server/backlog";
import type { Score } from "../../server/score";
import type { RunMeta } from "../../server/swarm";
import type { TimelineEvent, TriageStatus } from "../../server/triage/run";
import type { Category } from "../../server/verdict";

export type { Category, Issue, Score, TimelineEvent, TriageStatus };
export type Run = RunMeta & { live: boolean };

export interface AppState {
  backlog: Issue[];
  runs: Run[];
  run: Run | null;
  statuses: TriageStatus[];
  score: Score;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  already_fixed: "Already fixed",
  needs_repro: "Needs a GPU repro",
  needs_info: "Needs info",
  duplicate: "Duplicate",
  not_a_bug: "Not a bug",
};
export const CATEGORY_ORDER: Category[] = ["already_fixed", "needs_repro", "needs_info", "duplicate", "not_a_bug"];

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `${path} failed (${res.status})`);
  return data as T;
}

export const getState = (runId?: string) =>
  fetch(`/api/state${runId ? `?run=${runId}` : ""}`).then((r) => r.json() as Promise<AppState>);
export const startRun = (issues?: string[]) => post<RunMeta>("/api/runs", { issues });
export const triageDesktop = (runId: string, issueKey: string) => post<Delegation>("/api/desktop", { runId, issueKey });
export const posterDesktop = () => post<Delegation>("/api/poster/desktop", {});
export const posterOpen = (url: string) => post<{ delegation: Delegation }>("/api/poster/open", { url });
export const posterRelease = (postedUrl?: string) => post<{ controller: string }>("/api/poster/release", { postedUrl });

export type Delegation = {
  computer_host: string;
  session: { name: string };
  spec_version: number;
  transports: { desktop_token: { token: string; expires_at: string } };
};

export async function loadTimeline(runId: string, issueKey: string): Promise<TimelineEvent[]> {
  const res = await fetch(`/runs/${runId}/${issueKey}/events.jsonl`);
  if (!res.ok) return [];
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TimelineEvent);
}

export const frameUrl = (runId: string, issueKey: string, file: string) => `/runs/${runId}/${issueKey}/${file}`;

export function finalCategory(s: TriageStatus | undefined): Category | undefined {
  return s?.verified?.categoryOut ?? s?.verdict?.category;
}
