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
  const [open, setOpen] = useState<"comment" | "evidence" | "plan" | null>(null);
  const [fixError, setFixError] = useState("");

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
  const fixBusy = !!fix && (fix.phase === "starting" || fix.phase === "running" || fix.phase === "checking");

  const done = status?.phase === "done" && status.verdict;
  const cat = done ? (status.verified?.categoryOut ?? status.verdict!.category) : undefined;
  const draft = done ? (reviewed ?? status.verdict!.draft_comment) : "";
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
          <img src={frameUrl(runId, issue.key, lastFrame)} alt={shown.note ?? `The agent reading #${issue.number}`} />
        ) : (
          <p className="screen__empty">{status ? "Starting its Computer" : "Not started"}</p>
        )}
      </div>

      <p className="caption">
        <a className="caption__ref" href={issue.url} target="_blank" rel="noreferrer">
          {issue.repo.startsWith("vllm") ? "vLLM" : "SGLang"} #{issue.number}
        </a>
        {fixing ? (
          <span className="caption__now">
            <span className="pulse" aria-hidden /> Fixing: {fixStep ?? "starting"}
          </span>
        ) : running && lastStep ? (
          <span className="caption__now">
            <span className="pulse" aria-hidden /> {lastStep}
          </span>
        ) : (
          shown.note && !running && <span className="caption__now">{shown.note}</span>
        )}
      </p>
      </div>

      {done && cat && (
        <div className={`verdict cat-${cat}`}>
          <h2>{headline(status)}</h2>
          <p className="verdict__why">{firstSentence(status.verdict!.summary)}</p>
          <p className="verdict__meta">
            {checkedLine(status)}.{g && ` ${g}.`}
          </p>
          {fixable && <FixFlow issueKey={issue.key} fix={fix} stage={stage} />}
          {draft && (
            <button className="btn verdict__post" onClick={() => onPost(draft)}>
              Post comment
            </button>
          )}
          <p className="verdict__more">
            {fixable && (
              <button
                className="link"
                disabled={fixBusy}
                onClick={() => {
                  setFixError("");
                  fetch("/api/fix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueKey: issue.key }) })
                    .then(async (r) => (r.ok ? undefined : setFixError((await r.json()).error ?? "could not start the fix")))
                    .catch((e: Error) => setFixError(e.message));
                }}
              >
                {fixBusy ? "Fixing" : "Fix issue"}
              </button>
            )}
            {/* the agent's repro plan is the input the harness turns into a kit; this shows it */}
            {cat === "needs_repro" && status.verdict!.repro_plan && (
              <button
                className="link"
                aria-expanded={open === "plan"}
                onClick={() => setOpen(open === "plan" ? null : "plan")}
              >
                Find root cause
              </button>
            )}
            {/* a GPU-repro issue without a kit: the fix exists as a capability, but nothing could test the patch yet */}
            {!fixable && cat === "needs_repro" && (
              <button className="link" disabled title="Needs a GPU test kit in sm120-kit first. vllm#60172 has one.">
                Fix issue
              </button>
            )}
            <button className="link" aria-expanded={open === "comment"} onClick={() => setOpen(open === "comment" ? null : "comment")}>
              {reviewed ? "My comment" : "Comment"}
            </button>
            <button className="link" aria-expanded={open === "evidence"} onClick={() => setOpen(open === "evidence" ? null : "evidence")}>
              Evidence
            </button>
            </p>
          {fixError && <p className="fix__error">{fixError}</p>}
          {open === "plan" && status.verdict!.repro_plan && (
            <div className="plan">
              <p className="plan__head">
                {status.verdict!.repro_plan.gpu_count}x GPU, {status.verdict!.repro_plan.model}
              </p>
              <p className="verdict__meta">
                The harness turns this into a kit and runs each experiment once I approve the price, as it did for #60172.
              </p>
              <ol className="plan__list">
                {status.verdict!.repro_plan.hypotheses.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            </div>
          )}
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
          {status?.phase === "failed" && <p className="verdict__meta">{status.error}</p>}
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

/** The newest screenshot of the issue's own page, else the newest of anything, with a note saying which page that is. */
function pickFrame(events: TimelineEvent[], number: number, fallback: string | undefined): { file?: string; note?: string } {
  const pages = new Map<string, string>();
  for (const e of events) if (e.activity?.page) pages.set(e.activity.id, e.activity.page);
  const frames = events.filter((e) => e.frame);
  const pageOf = (e: TimelineEvent) => (e.frame?.activityId ? pages.get(e.frame.activityId) : undefined) ?? "";
  const own = [...frames].reverse().find((e) => new RegExp(`/(issues|pull)/${number}(\\b|$)`).test(pageOf(e)));
  if (own) return { file: own.frame!.file };
  const last = frames[frames.length - 1];
  const page = last ? pageOf(last) : "";
  const m = page.match(/github\.com\/[^/]+\/([^/]+)\/(issues|pull)\/(\d+)/);
  const where = m ? `${m[2] === "pull" ? "PR" : "issue"} ${m[1]}#${m[3]}` : "another page";
  return { file: last?.frame?.file ?? fallback, note: `Its last screen, ${where}` };
}
