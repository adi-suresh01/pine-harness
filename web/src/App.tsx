import { useCallback, useEffect, useMemo, useState } from "react";
import type { GpuRun } from "../../server/gpu";
import { getState, startRun, type AppState, type TimelineEvent, type TriageStatus } from "./api";
import { PostDialog } from "./PostDialog";
import { Rail } from "./Rail";
import { Stage } from "./Stage";

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

function useGpu(): GpuRun[] {
  const [runs, setRuns] = useState<GpuRun[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/gpu")
        .then((r) => (r.ok ? r.json() : []))
        .then((r: GpuRun[]) => alive && setRuns(r))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return runs;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useTheme() {
  useEffect(() => {
    const forced = new URLSearchParams(location.search).get("theme");
    let theme = forced ?? (() => {
      try {
        return localStorage.getItem("theme") ?? "dark";
      } catch {
        return "dark";
      }
    })();
    document.documentElement.dataset.theme = theme;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "t" || e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest("input, textarea, pine-desktop")) return;
      theme = theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem("theme", theme);
      } catch {
        // private window: the switch still works for this visit
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  useTheme();
  const [state, setState] = useState<AppState>();
  const [runId, setRunId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [liveEvents, setLiveEvents] = useState<Record<string, TimelineEvent[]>>({});
  const [posting, setPosting] = useState<{ url: string; draft: string }>();
  const [error, setError] = useState("");
  const gpu = useGpu();

  const refresh = useCallback(() => getState(runId).then(setState).catch((e: Error) => setError(e.message)), [runId]);
  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("status", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as TriageStatus;
      setState((prev) =>
        prev?.run && prev.run.runId === s.runId ? { ...prev, statuses: prev.statuses.filter((x) => x.issueKey !== s.issueKey).concat(s) } : prev,
      );
    });
    es.addEventListener("event", (e) => {
      const { runId: r, issueKey, event } = JSON.parse((e as MessageEvent).data) as { runId: string; issueKey: string; event: TimelineEvent };
      const k = `${r}/${issueKey}`;
      setLiveEvents((prev) => ({ ...prev, [k]: [...(prev[k] ?? []).slice(-200), event] }));
    });
    es.addEventListener("fix", (e) => {
      const f = JSON.parse((e as MessageEvent).data);
      setState((prev) => (prev ? { ...prev, fix: f } : prev));
    });
    es.addEventListener("run", () => void refresh());
    // the stream reconnects on its own; whatever happened while it was down only shows in a fresh read
    es.addEventListener("hello", () => void refresh());
    return () => es.close();
  }, [refresh]);

  const run = state?.run ?? null;
  const now = useNow(!!run?.live);
  const byKey = useMemo(() => new Map(state?.statuses.map((s) => [s.issueKey, s]) ?? []), [state?.statuses]);
  const issues = useMemo(() => (state ? (run ? state.backlog.filter((i) => run.issueKeys.includes(i.key)) : state.backlog) : []), [state, run]);

  if (!state) return <main className="boot">{error || "Loading"}</main>;

  // any run, not just the one on screen: a second run would take over the first one's Computers
  const anyLive = state.runs.some((r) => r.live);
  const focusKey = selected && issues.some((i) => i.key === selected) ? selected : issues[0]?.key;
  const focus = issues.find((i) => i.key === focusKey);

  return (
    <div className="app">
      <header className="top">
        <h1>Triage swarm</h1>
        <div className="top__right">
          <button className="link" onClick={() => setPosting({ url: "https://github.com/login", draft: "" })}>
            GitHub desktop
          </button>
          {/* a ticking clock while the agents work; a finished run doesn't need one */}
          {run?.live && <span className="top__clock">{clock(now - Date.parse(run.startedAt))}</span>}
          {state.runs.length > 1 && (
            <select className="top__run" value={run?.runId} onChange={(e) => setRunId(e.target.value)} aria-label="Run">
              {state.runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {new Date(r.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {r.live ? ", running" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn btn--quiet"
            disabled={anyLive}
            onClick={() =>
              startRun()
                .then((m) => setRunId(m.runId))
                .catch((e: Error) => setError(e.message))
            }
          >
            {anyLive ? "Agents working" : `Run ${state.backlog.length} agents`}
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button className="link" onClick={() => setError("")}>
            Dismiss
          </button>
        </p>
      )}

      <Rail issues={issues} byKey={byKey} selected={focusKey} onSelect={setSelected} />

      {focus && run ? (
        <Stage
          issue={focus}
          status={byKey.get(focus.key)}
          runId={run.runId}
          live={liveEvents[`${run.runId}/${focus.key}`] ?? []}
          gpu={gpu.find((g) => g.issueKey === focus.key && g.kitReady)}
          stage={gpu.find((g) => g.issueKey === `${focus.key}-stage`)}
          fix={state.fix}
          fixable={state.fixable?.includes(focus.key) ?? false}
          fixEvents={state.fix ? (liveEvents[`${state.fix.fixId}/${state.fix.issueKey}`] ?? []) : []}
          reviewed={state.reviewed?.[focus.key]}
          onPost={(draft) => setPosting({ url: focus.url, draft })}
        />
      ) : (
        <p className="screen__empty">Run the agents to give every issue its own Pine Computer.</p>
      )}

      {posting && <PostDialog url={posting.url} draft={posting.draft} onClose={() => setPosting(undefined)} />}
    </div>
  );
}
