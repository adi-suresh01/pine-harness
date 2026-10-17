import { useCallback, useEffect, useState } from "react";
import { frameUrl, loadTimeline, triageDesktop, type Issue, type TimelineEvent, type TriageStatus } from "./api";
import { LiveDesktop } from "./LiveDesktop";

interface Props {
  issue: Issue;
  status: TriageStatus | undefined;
  runId: string;
  live: TimelineEvent[];
}

export function Focus({ issue, status, runId, live }: Props) {
  const [history, setHistory] = useState<TimelineEvent[]>([]);
  const running = status?.phase === "running" && !!status.sessionName;
  const [watchLive, setWatchLive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    loadTimeline(runId, issue.key).then((h) => !cancelled && setHistory(h));
    return () => {
      cancelled = true;
    };
  }, [runId, issue.key]);

  const delegate = useCallback(() => triageDesktop(runId, issue.key), [runId, issue.key]);
  const events = mergeEvents(history, live);
  const lastFrame = [...events].reverse().find((e) => e.frame)?.frame?.file ?? status?.lastFrame;

  return (
    <section className="focus" aria-label={`Agent working on ${issue.repo}#${issue.number}`}>
      <header className="focus__head">
        <a href={issue.url} target="_blank" rel="noreferrer" className="focus__title">
          {issue.repo.split("/")[1]} #{issue.number}
        </a>
        {running && (
          <button className="link" onClick={() => setWatchLive((v) => !v)}>
            {watchLive ? "Show last screenshot" : "Watch live"}
          </button>
        )}
      </header>
      {running && watchLive ? (
        <LiveDesktop key={`${runId}/${issue.key}`} delegate={delegate} desktopKey={`${runId}/${issue.key}`} />
      ) : lastFrame ? (
        <img className="desktop desktop--frame" src={frameUrl(runId, issue.key, lastFrame)} alt="Last screenshot from the agent's desktop" />
      ) : (
        <div className="desktop desktop--empty">No screenshots yet</div>
      )}
      <Timeline events={events} />
    </section>
  );
}

function mergeEvents(history: TimelineEvent[], live: TimelineEvent[]): TimelineEvent[] {
  const seen = new Set(history.map((e) => e.eventId));
  return [...history, ...live.filter((e) => !seen.has(e.eventId))];
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  // activity rows upsert by id; progress lines stay in order between them
  const rows: { key: string; text: string; state?: string; kind: "step" | "note" }[] = [];
  const index = new Map<string, number>();
  for (const e of events) {
    if (e.activity) {
      const i = index.get(e.activity.id);
      const row = { key: e.activity.id, text: e.activity.title, state: e.activity.state, kind: "step" as const };
      if (i === undefined) {
        index.set(e.activity.id, rows.length);
        rows.push(row);
      } else rows[i] = row;
    } else if (e.progress) rows.push({ key: `p${e.eventId}`, text: e.progress, kind: "note" });
    else if (e.result) rows.push({ key: `r${e.eventId}`, text: e.result.summary || e.result.terminalReason, kind: "note" });
  }
  const recent = rows.slice(-14);
  return (
    <ol className="timeline" aria-live="polite">
      {recent.length === 0 && <li className="timeline__note">Waiting for the agent's first step</li>}
      {recent.map((r) => (
        <li key={r.key} className={r.kind === "step" ? `timeline__step is-${r.state}` : "timeline__note"}>
          {r.text}
        </li>
      ))}
    </ol>
  );
}
