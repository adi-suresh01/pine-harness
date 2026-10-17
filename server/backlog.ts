import { BACKLOG_FILE, readJson } from "./store";
import type { Category } from "./verdict";

export interface Issue {
  key: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  gpu: string;
  // Aditya's hand triage; only the server sees it, never the agent
  groundTruth: { category: Category; confidence: string; evidence: string } | null;
}

export async function loadBacklog(): Promise<Issue[]> {
  const issues = await readJson<Issue[]>(BACKLOG_FILE);
  if (!issues?.length) throw new Error(`empty backlog: ${BACKLOG_FILE}`);
  return issues;
}
