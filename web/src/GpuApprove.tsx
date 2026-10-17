import { useState } from "react";
import type { GpuQuote, GpuRun } from "../../server/gpu";

const POD: Record<GpuRun["podState"], string> = {
  none: "",
  quoted: "",
  starting: "Renting the GPU",
  setup: "Pod is up, downloading the model",
  warm: "Warm GPU ready",
  running: "Running the matrix",
  done: "Pod shut down",
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `${path} failed`);
  return j as T;
}

const short = (gpu: string) => gpu.replace("NVIDIA ", "").replace(" Blackwell", "");

/**
 * Starts a real pod from the stage. The quote comes fresh from the RunPod catalog, the price and worst case are on
 * screen before the button, and the server refuses the click if the quote moved or the worst case is over its cap.
 */
export function GpuApprove({ issueKey, stage }: { issueKey: string; stage: GpuRun | undefined }) {
  const [step, setStep] = useState<"idle" | "quoting" | "quoted" | "starting" | "started">("idle");
  const [quote, setQuote] = useState<GpuQuote>();
  const [error, setError] = useState("");

  const live = stage && stage.podState !== "none" && stage.podState !== "quoted" && step === "started";
  const busy = stage && (stage.podState === "starting" || stage.podState === "setup" || stage.podState === "running");

  if (live || (busy && step === "idle")) {
    return (
      <div className="gpu-live">
        <p>
          <span className="pulse" aria-hidden /> {POD[stage!.podState]}
          {stage!.gpu && ` on 1x ${short(stage!.gpu)}`}
          {stage!.podState === "done" && typeof stage!.spentUsd === "number" && `, $${stage!.spentUsd.toFixed(2)}`}
        </p>
        {stage!.variants.length > 0 && (
          <p className="gpu-live__variants">
            {stage!.variants.map((v) => (
              <span key={v.name} className={v.verdict === "OK" ? "is-ok" : v.verdict ? "is-fail" : ""}>
                {v.name}: {v.verdict ?? v.phase ?? "queued"}
                {typeof v.gsm8k === "number" && `, GSM8K ${v.gsm8k.toFixed(2)}`}
              </span>
            ))}
          </p>
        )}
      </div>
    );
  }

  if (step === "idle") {
    return (
      <p className="verdict__more">
        <button
          className="link"
          onClick={() => {
            setError("");
            setStep("quoting");
            post<GpuQuote>("/api/gpu/quote", { issueKey })
              .then((q) => {
                setQuote(q);
                setStep("quoted");
              })
              .catch((e: Error) => {
                setError(e.message);
                setStep("idle");
              });
          }}
        >
          Run it on a GPU now
        </button>
        {error && <span className="gpu-error">{error}</span>}
      </p>
    );
  }

  if (step === "quoting") return <p className="verdict__meta">Reading the RunPod catalog</p>;

  return (
    <div className="gpu-card">
      <p>
        1x {short(quote!.gpu)}, {quote!.cloud.toLowerCase()} cloud, ${quote!.rateUsdHr.toFixed(2)}/hr. Worst case $
        {quote!.worstCaseUsd.toFixed(2)}; the pod shuts itself down when the run ends.
      </p>
      <p className="gpu-card__actions">
        <button
          className="btn"
          disabled={step === "starting"}
          onClick={() => {
            setStep("starting");
            post("/api/gpu/approve", { issueKey, worstCaseUsd: quote!.worstCaseUsd })
              .then(() => setStep("started"))
              .catch((e: Error) => {
                setError(e.message);
                setStep("idle");
              });
          }}
        >
          {step === "starting" ? "Starting" : `Approve $${quote!.worstCaseUsd.toFixed(2)}`}
        </button>
        <button className="link" onClick={() => setStep("idle")}>
          Cancel
        </button>
      </p>
    </div>
  );
}
