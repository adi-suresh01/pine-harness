import { useCallback, useEffect, useState } from "react";
import type { GpuRun } from "../../server/gpu";
import { frameUrl, loadTimeline, triageDesktop, type Issue, type TimelineEvent, type TriageStatus } from "./api";
import { LiveDesktop } from "./LiveDesktop";
import { Prose } from "./Prose";
import { checkedLine, firstSentence, gpuLine, headline } from "./verdictText";

interface Props {
  issue: Issue;
  status: TriageStatus | undefined;
  runId: string;
  live: TimelineEvent[];
  gpu: GpuRun | undefined;
  reviewed: string | undefined;
  onPost: (draft: string) => void;
}

export function Stage({ issue, status, runId, live, gpu, reviewed, onPost }: Props) {
  const [history, setHistory] = useState<TimelineEvent[]>([]);
  const [open, setOpen] = useState<"comment" | "evidence" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setOpen(null);
    loadTimeline(runId, issue.key).then((h) => !cancelled && setHistory(h));
    return () => {
      cancelled = true;
    };
  }, [runId, issue.key]);

  const delegate = useCallback(() => triageDesktop(runId, issue.key), [runId, issue.key]);
  const seen = new Set(history.map((e) => e.eventId));
  const events = [...history, ...live.filter((e) => !seen.has(e.eventId))];
  const running = status?.phase === "running" && !!status.sessionName;
  const lastFrame = [...events].reverse().find((e) => e.frame)?.frame?.file ?? status?.lastFrame;
  const lastStep = [...events].reverse().find((e) => e.activity)?.activity?.title;

  const done = status?.phase === "done" && status.verdict;
  const cat = done ? (status.verified?.categoryOut ?? status.verdict!.category) : undefined;
  const draft = done ? (reviewed ?? status.verdict!.draft_comment) : "";
  const gt = issue.groundTruth;
  const g = gpuLine(gpu);

  return (
    <section className="stage" aria-label={`${issue.repo}#${issue.number}`}>
      <div className="stage__left">
      <div className="screen">
        {running ? (
          <LiveDesktop key={`${runId}/${issue.key}`} delegate={delegate} desktopKey={`${runId}/${issue.key}`} />
        ) : lastFrame ? (
          <img src={frameUrl(runId, issue.key, lastFrame)} alt="The agent's last screen" />
        ) : (
          <p className="screen__empty">{status ? "Starting its Computer" : "Not started"}</p>
        )}
      </div>

      <p className="now">
        {running && lastStep ? (
          <>
            <span className="dot is-working" aria-hidden /> {lastStep}
          </>
        ) : done ? (
          `Finished in ${duration(status)}${status.costUsd ? `, $${status.costUsd.toFixed(2)} of agent time` : ""}`
        ) : status?.phase === "failed" ? (
          `No verdict: ${status.error ?? "the agent stopped early"}`
        ) : (
          <a href={issue.url} target="_blank" rel="noreferrer">
            {issue.repo}#{issue.number}
          </a>
        )}
      </p>
      </div>

      {done && cat && (
        <div className={`verdict cat-${cat}`}>
          <h2>{headline(status)}</h2>
          <p className="verdict__why">{firstSentence(status.verdict!.summary)}</p>
          <p className="verdict__meta">
            {checkedLine(status)}.
            {gt && gt.category !== cat && ` My hand triage said ${LOWER[gt.category]}.`}
            {gt && gt.category === cat && " Matches my hand triage."}
          </p>
          {g && <p className="verdict__gpu">{g}.</p>}
          {draft && (
            <button className="btn verdict__post" onClick={() => onPost(draft)}>
              Post comment
            </button>
          )}
          <p className="verdict__more">
            <button className="link" aria-expanded={open === "comment"} onClick={() => setOpen(open === "comment" ? null : "comment")}>
              {reviewed ? "My comment" : "Draft comment"}
            </button>
            <button className="link" aria-expanded={open === "evidence"} onClick={() => setOpen(open === "evidence" ? null : "evidence")}>
              Evidence
            </button>
            <a className="link" href={issue.url} target="_blank" rel="noreferrer">
              Open on GitHub
            </a>
          </p>
          {open === "comment" && <Prose text={draft} />}
          {open === "evidence" && (
            <ul className="evidence">
              {(status.verified?.checks ?? []).map((c, i) => (
                <li key={i} className={`is-${c.status}`}>
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.target ?? c.ref}
                  </a>{" "}
                  {c.facts}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const LOWER: Record<string, string> = {
  already_fixed: "already fixed",
  needs_repro: "needs a GPU repro",
  needs_info: "needs info",
  duplicate: "duplicate",
  not_a_bug: "not a bug",
};

function duration(s: TriageStatus): string {
  if (!s.startedAt || !s.endedAt) return "";
  const sec = Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000);
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}
