import { useCallback, useEffect, useState } from "react";
import type { GpuRun } from "../../server/gpu";
import { fixDesktop, frameUrl, loadTimeline, triageDesktop, type FixStatus, type Issue, type TimelineEvent, type TriageStatus } from "./api";
import { FixFlow } from "./FixFlow";
import { LiveDesktop } from "./LiveDesktop";
import { Prose } from "./Prose";
import { checkedLine, firstSentence, gpuLine, headline } from "./verdictText";

interface Props {
  issue: Issue;
  status: TriageStatus | undefined;
  runId: string;
  live: TimelineEvent[];
  gpu: GpuRun | undefined;
  /** the short kit a live demo may run for this issue, when there is one */
  stage: GpuRun | undefined;
  fix: FixStatus | null;
  fixable: boolean;
  fixEvents: TimelineEvent[];
  reviewed: string | undefined;
  onPost: (draft: string) => void;
}

export function Stage({ issue, status, runId, live, gpu, stage, fix, fixable, fixEvents, reviewed, onPost }: Props) {
  const [history, setHistory] = useState<TimelineEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<"comment" | "evidence" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setLoaded(false);
    setOpen(null);
    loadTimeline(runId, issue.key).then((h) => {
      if (cancelled) return;
      setHistory(h);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [runId, issue.key]);

  const delegate = useCallback(() => triageDesktop(runId, issue.key), [runId, issue.key]);
  const seen = new Set(history.map((e) => e.eventId));
  const events = [...history, ...live.filter((e) => !seen.has(e.eventId))];
  const running = status?.phase === "running" && !!status.sessionName;
  // An agent usually ends on some other page (a release, a related PR), so a finished one shows its own issue as it
  // read it, labeled, instead of whatever it looked at last.
  const shown = pickFrame(events, issue.number, status?.lastFrame);
  const lastFrame = loaded || running ? shown.file : undefined;
  const lastStep = stepText([...events].reverse().find((e) => e.activity)?.activity);
  // while a Pine agent writes the fix, the hero is its desktop
  const fixing = !!fix && fix.issueKey === issue.key && !!fix.sessionName && (fix.phase === "running" || fix.phase === "starting");
  const fixStep = stepText([...fixEvents].reverse().find((e) => e.activity)?.activity);

  const done = status?.phase === "done" && status.verdict;
  const cat = done ? (status.verified?.categoryOut ?? status.verdict!.category) : undefined;
  const draft = done ? (reviewed ?? status.verdict!.draft_comment) : "";
  const gt = issue.groundTruth;
  const g = gpuLine(gpu);

  return (
    <section className="stage" aria-label={`${issue.repo}#${issue.number}`}>
      <div className="stage__left">
      <div className={`screen ${running || fixing ? "screen--live" : ""}`}>
        {fixing ? (
          <LiveDesktop key={fix!.fixId} delegate={fixDesktop} desktopKey={fix!.fixId} />
        ) : running ? (
          <LiveDesktop key={`${runId}/${issue.key}`} delegate={delegate} desktopKey={`${runId}/${issue.key}`} />
        ) : lastFrame ? (
          <>
            <img src={frameUrl(runId, issue.key, lastFrame)} alt={shown.label} />
            <span className="screen__label">{shown.label}</span>
          </>
        ) : (
          <p className="screen__empty">{status ? "Starting its Computer" : "Not started"}</p>
        )}
      </div>

      <p className="caption">
        <a className="caption__ref" href={issue.url} target="_blank" rel="noreferrer">
          {issue.repo.startsWith("vllm") ? "vLLM" : "SGLang"} #{issue.number}
        </a>
        <span className="caption__title">{issue.title.replace(/^\[[^\]]+\]:?\s*/, "")}</span>
        <span className="caption__now">
          {fixing ? (
            <>
              <span className="pulse" aria-hidden /> Fixing: {fixStep ?? "starting"}
            </>
          ) : running && lastStep ? (
            <>
              <span className="pulse" aria-hidden /> {lastStep}
            </>
          ) : done ? (
            `${duration(status)}${status.costUsd ? `, $${status.costUsd.toFixed(2)}` : ""}`
          ) : status?.phase === "failed" ? (
            "no verdict"
          ) : (
            ""
          )}
        </span>
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
          {fixable && <FixFlow issueKey={issue.key} fix={fix} stage={stage} />}
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
      {!done && (
        <div className="verdict verdict--pending">
          <h2>{status?.phase === "failed" ? "No verdict" : status ? "Reading the thread" : "Waiting to start"}</h2>
          <p className="verdict__meta">{status?.phase === "failed" ? status.error : "The verdict lands here, with every link it cites checked against GitHub."}</p>
        </div>
      )}
    </section>
  );
}

// The caption names what the agent is doing in plain words; a shell step's title is the whole command line.
function stepText(a: TimelineEvent["activity"]): string | undefined {
  if (!a) return undefined;
  if (a.kind === "command") return /verdict|json/i.test(a.title) ? "Checking its verdict file" : "Searching issues and PRs";
  if (a.kind === "file") return /verdict/i.test(a.title) ? "Writing the verdict" : "Taking notes";
  if (a.kind === "skill") return "Following the sm120-triage skill";
  const t = a.title.replace(/\s*·\s*GitHub$/, "").replace(/^Open /, "Reading ");
  return t.length > 90 ? `${t.slice(0, 88)}...` : t;
}

const LOWER: Record<string, string> = {
  already_fixed: "already fixed",
  needs_repro: "needs a GPU repro",
  needs_info: "needs info",
  duplicate: "duplicate",
  not_a_bug: "not a bug",
};

/** The newest screenshot of the issue's own page, else the newest screenshot of anything, with a label saying which. */
function pickFrame(events: TimelineEvent[], number: number, fallback: string | undefined): { file?: string; label: string } {
  const pages = new Map<string, string>();
  for (const e of events) if (e.activity?.page) pages.set(e.activity.id, e.activity.page);
  const frames = events.filter((e) => e.frame);
  const pageOf = (e: TimelineEvent) => (e.frame?.activityId ? pages.get(e.frame.activityId) : undefined) ?? "";
  const own = [...frames].reverse().find((e) => new RegExp(`/(issues|pull)/${number}(\\b|$)`).test(pageOf(e)));
  if (own) return { file: own.frame!.file, label: `The agent reading #${number}` };
  const last = frames[frames.length - 1];
  const page = last ? pageOf(last) : "";
  const m = page.match(/github\.com\/[^/]+\/([^/]+)\/(issues|pull)\/(\d+)/);
  const where = m ? `${m[2] === "pull" ? "PR" : "issue"} ${m[1]}#${m[3]}` : "another page";
  return { file: last?.frame?.file ?? fallback, label: `The agent's last screen: ${where}` };
}

function duration(s: TriageStatus): string {
  if (!s.startedAt || !s.endedAt) return "";
  const sec = Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000);
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}
