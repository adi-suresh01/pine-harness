import { useState } from "react";
import type { GpuRun } from "../../server/gpu";
import type { FixStatus } from "./api";
import { GpuApprove } from "./GpuApprove";

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `${path} failed`);
  return j as T;
}

const NAME: Record<string, string> = {
  "fp8-kv": "Unpatched",
  "fp8-kv-agent": "Agent's patch",
  "fp8-kv-pr60173": "PR #60173",
};

interface Props {
  issueKey: string;
  fix: FixStatus | null;
  stage: GpuRun | undefined;
}

/** Ask a Pine agent for a patch, then let the warm GPU decide whether it works. */
export function FixFlow({ issueKey, fix, stage }: Props) {
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const mine = fix && fix.issueKey === issueKey ? fix : null;
  const working = mine && (mine.phase === "starting" || mine.phase === "running" || mine.phase === "checking");

  const ask = () => {
    setError("");
    post("/api/fix", { issueKey }).catch((e: Error) => setError(e.message));
  };

  if (!mine || mine.phase === "failed") {
    return (
      <div className="fix">
        <button className="btn btn--quiet" onClick={ask}>
          {mine ? "Ask again" : "Ask a Pine agent to fix it"}
        </button>
        {(error || mine?.error) && <p className="fix__error">{error || mine?.error}</p>}
      </div>
    );
  }

  if (working) {
    return (
      <div className="fix">
        <p className="fix__line">
          <span className="pulse" aria-hidden />
          {mine.phase === "checking" ? "Checking the patch applies to v0.31.0" : "A Pine agent is writing the fix"}
        </p>
      </div>
    );
  }

  const tested = stage?.variants.filter((v) => v.name === "fp8-kv" || v.name === "fp8-kv-agent") ?? [];
  const running = testing && stage?.podState !== "warm" ? true : stage?.podState === "running";
  const done = tested.length === 2 && tested.every((v) => v.verdict) && !running;

  return (
    <div className="fix">
      {mine.summary && <p className="fix__summary">{mine.summary.replace(/^Created \[?agent-fix\.diff\]?(\([^)]*\))?\.?\s*/, "").split(/(?<=\.)\s/)[0]}</p>}
      {(!!mine.sameAs || !!mine.openedPrs?.length) && (
        <p className="fix__note">
          {mine.sameAs ? `Same change as open PR ${mine.sameAs}.` : ""}
          {mine.openedPrs?.length ? ` It opened ${mine.openedPrs.join(", ")} while working.` : ""}
        </p>
      )}
      <Diff text={mine.patch ?? ""} />
      {done ? (
        <ul className="fix__results">
          {tested.map((v) => (
            <li key={v.name} className={v.verdict === "OK" ? "is-ok" : "is-fail"}>
              <b>{NAME[v.name]}</b>{" "}
              {v.verdict === "OK"
                ? `serves${typeof v.gsm8k === "number" ? `, GSM8K ${v.gsm8k.toFixed(2)}` : ""}`
                : `fails at boot${v.fault ? `: ${v.fault.slice(0, 60)}` : ", Required 102400 > 101376"}`}
            </li>
          ))}
        </ul>
      ) : running ? (
        <p className="fix__line">
          <span className="pulse" aria-hidden /> Running on the GPU
          {tested.find((v) => v.phase && v.phase !== "done") && `: ${NAME[tested.find((v) => v.phase !== "done")!.name]}`}
        </p>
      ) : stage?.podState === "warm" ? (
        <button
          className="btn"
          onClick={() => {
            setError("");
            setTesting(true);
            post("/api/gpu/test", { issueKey }).catch((e: Error) => {
              setError(e.message);
              setTesting(false);
            });
          }}
        >
          Test it on the warm GPU
        </button>
      ) : (
        <GpuApprove issueKey={issueKey} stage={stage} />
      )}
      {error && <p className="fix__error">{error}</p>}
    </div>
  );
}

function Diff({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("diff "));
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <span key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
          {l || " "}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
