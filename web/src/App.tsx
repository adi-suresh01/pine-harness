import { useCallback, useEffect, useMemo, useState } from "react";
import { score } from "../../server/score";
import { getState, startRun, type AppState, type TimelineEvent, type TriageStatus } from "./api";
import { Focus } from "./Focus";
import { PostDialog } from "./PostDialog";
import { SortBar } from "./SortBar";
import { Tile } from "./Tile";
import { VerdictCard } from "./VerdictCard";

function useClock(running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}

function elapsed(fromIso: string, to: number): string {
  const s = Math.max(0, Math.round((to - Date.parse(fromIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function App() {
  const [state, setState] = useState<AppState>();
  const [runId, setRunId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [liveEvents, setLiveEvents] = useState<Record<string, TimelineEvent[]>>({});
  const [posting, setPosting] = useState<{ url: string; draft: string }>();
  const [error, setError] = useState("");

  const refresh = useCallback(() => getState(runId).then(setState).catch((e: Error) => setError(e.message)), [runId]);
  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("status", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as TriageStatus;
      setState((prev) => {
        if (!prev?.run || prev.run.runId !== s.runId) return prev;
        const statuses = prev.statuses.filter((x) => x.issueKey !== s.issueKey).concat(s);
        return { ...prev, statuses };
      });
    });
    es.addEventListener("event", (e) => {
      const { runId: r, issueKey, event } = JSON.parse((e as MessageEvent).data) as { runId: string; issueKey: string; event: TimelineEvent };
      setLiveEvents((prev) => ({ ...prev, [`${r}/${issueKey}`]: [...(prev[`${r}/${issueKey}`] ?? []).slice(-200), event] }));
    });
    es.addEventListener("run", () => void refresh());
    return () => es.close();
  }, [refresh]);

  const run = state?.run ?? null;
  const now = useClock(!!run?.live);
  const byKey = useMemo(() => new Map(state?.statuses.map((s) => [s.issueKey, s]) ?? []), [state?.statuses]);
  const issues = useMemo(
    () => (state ? (run ? state.backlog.filter((i) => run.issueKeys.includes(i.key)) : state.backlog) : []),
    [state, run],
  );
  const sc = state ? score(issues, state.statuses) : undefined;
  const focusKey = selected ?? issues[0]?.key;
  const focusIssue = issues.find((i) => i.key === focusKey);

  if (!state) return <main className="boot">{error || "Loading the backlog"}</main>;

  return (
    <div className="app">
      <header className="top">
        <div className="top__title">
          <h1>Triage swarm</h1>
          <p>
            {issues.length} open sm_120 issues in vLLM and SGLang, one Pine Computer each. Only the ones that need a GPU go to
            my repro harness.
          </p>
        </div>
        <div className="top__run">
          {run && (
            <span className="top__clock" aria-label="Elapsed">
              {elapsed(run.startedAt, run.endedAt ? Date.parse(run.endedAt) : now)}
            </span>
          )}
          {sc && sc.scored > 0 && (
            <span className="top__score">
              Matches my hand triage on {sc.matched} of {sc.scored}
            </span>
          )}
          {state.runs.length > 1 && (
            <select value={run?.runId} onChange={(e) => setRunId(e.target.value)} aria-label="Run">
              {state.runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  Run at {new Date(r.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {r.live ? " (running)" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn"
            disabled={!!run?.live}
            onClick={() =>
              startRun()
                .then((m) => setRunId(m.runId))
                .catch((e: Error) => setError(e.message))
            }
          >
            {run?.live ? "Triaging" : `Triage all ${state.backlog.length}`}
          </button>
          <button className="link" onClick={() => setPosting({ url: "https://github.com/login", draft: "" })}>
            My GitHub desktop
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error} <button className="link" onClick={() => setError("")}>Dismiss</button>
        </p>
      )}

      <SortBar statuses={state.statuses} total={issues.length} />

      <main className="floor">
        <div className="grid">
          {issues.map((issue) => (
            <Tile
              key={issue.key}
              issue={issue}
              status={byKey.get(issue.key)}
              runId={run?.runId}
              selected={issue.key === focusKey}
              onSelect={() => setSelected(issue.key)}
            />
          ))}
        </div>
        <div className="side">
          {focusIssue && run ? (
            <>
              <Focus issue={focusIssue} status={byKey.get(focusIssue.key)} runId={run.runId} live={liveEvents[`${run.runId}/${focusIssue.key}`] ?? []} />
              <VerdictCard
                issue={focusIssue}
                status={byKey.get(focusIssue.key)}
                onPost={() => {
                  const v = byKey.get(focusIssue.key)?.verdict;
                  if (v) setPosting({ url: focusIssue.url, draft: v.draft_comment });
                }}
              />
            </>
          ) : (
            <section className="verdict verdict--empty">Start a run to give every issue its own Computer and agent.</section>
          )}
        </div>
      </main>

      {posting && <PostDialog url={posting.url} draft={posting.draft} onClose={() => setPosting(undefined)} />}
    </div>
  );
}
