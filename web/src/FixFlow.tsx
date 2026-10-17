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
  const [showPatch, setShowPatch] = useState(false);
  const mine = fix && fix.issueKey === issueKey ? fix : null;
  const working = mine && (mine.phase === "starting" || mine.phase === "running" || mine.phase === "checking");

  if (!mine) return null;
  if (mine.phase === "failed") {
    return (
      <div className="fix">
        <p className="fix__error">The fix did not finish: {mine.error}</p>
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
      {/* once the GPU has spoken, red and green say enough; the agent's own description waits behind the patch */}
      {mine.summary && (!done || showPatch) && <p className="fix__summary">{tidy(mine.summary)}</p>}
      {(!!mine.sameAs || !!mine.openedPrs?.length) && (
        <p className="fix__note">
          {mine.sameAs ? `Same change as open PR ${mine.sameAs}.` : ""}
          {mine.openedPrs?.length ? ` It opened ${mine.openedPrs.join(", ")} while working.` : ""}
        </p>
      )}
      {!done && <Diff text={mine.patch ?? ""} />}
      {done ? (
        <>
          <ul className="fix__results">
            {tested.map((v) => (
              <li key={v.name} className={v.verdict === "OK" ? "is-ok" : "is-fail"}>
                <b>{NAME[v.name]}</b>{" "}
                {v.verdict === "OK"
                  ? `serves${typeof v.gsm8k === "number" ? `, GSM8K ${v.gsm8k.toFixed(2)}` : ""}`
                  : v.smem
                    ? `fails at boot: needs ${v.smem.required.toLocaleString()} bytes of shared memory, the GPU has ${v.smem.limit.toLocaleString()}`
                    : `fails at boot${v.fault ? `: ${v.fault.slice(0, 60)}` : ""}`}
              </li>
            ))}
          </ul>
          {/* the result stays on screen, and so does the way to do it again from scratch */}
          <p className="fix__again">
            <button className="link" aria-expanded={showPatch} onClick={() => setShowPatch((v) => !v)}>
              {showPatch ? "Hide the patch" : "Show the patch"}
            </button>
            {stage?.podState === "warm" && (
              <button
                className="link"
                onClick={() => {
                  setError("");
                  setTesting(true);
                  post("/api/gpu/test", { issueKey }).catch((e: Error) => {
                    setError(e.message);
                    setTesting(false);
                  });
                }}
              >
                Test again on the GPU
              </button>
            )}
          </p>
          {showPatch && <Diff text={mine.patch ?? ""} />}
        </>
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

// the agent's result starts with a pointer to the file it wrote; the sentence after it says what the change does
function tidy(summary: string): string {
  const t = summary.replace(/^Created \[?agent-fix\.diff\]?(\([^)]*\))?[\s.;:,]*/i, "").trim();
  const first = t.split(/(?<=\.)\s/)[0] ?? t;
  return first.charAt(0).toUpperCase() + first.slice(1);
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
