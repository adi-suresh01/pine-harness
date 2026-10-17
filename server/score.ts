import type { Issue } from "./backlog";
import type { TriageStatus } from "./triage/run";
import type { Category } from "./verdict";

export interface ScoreRow {
  issueKey: string;
  expected: Category;
  got: Category | null;
  match: boolean;
}

export interface Score {
  matched: number;
  scored: number;
  rows: ScoreRow[];
}

/** Compares the verified category (after any downgrade) with Aditya's hand triage. */
export function score(issues: Issue[], statuses: TriageStatus[]): Score {
  const byKey = new Map(statuses.map((s) => [s.issueKey, s]));
  const rows: ScoreRow[] = [];
  for (const issue of issues) {
    if (!issue.groundTruth) continue;
    const s = byKey.get(issue.key);
    if (!s || (s.phase !== "done" && s.phase !== "failed")) continue;
    const got = s.verified?.categoryOut ?? null;
    rows.push({ issueKey: issue.key, expected: issue.groundTruth.category, got, match: got === issue.groundTruth.category });
  }
  return { matched: rows.filter((r) => r.match).length, scored: rows.length, rows };
}
