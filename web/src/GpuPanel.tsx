import { useEffect, useState } from "react";
import type { GpuRun } from "../../server/gpu";

const POD_TEXT: Record<GpuRun["podState"], string> = {
  none: "Kit ready, no pod yet",
  quoted: "Quoted, waiting for my approval",
  starting: "Renting the GPU",
  setup: "Downloading the model",
  running: "Running the matrix",
  done: "Pod shut down",
};

function verdictClass(v: string | undefined): string {
  if (!v) return "is-pending";
  return v === "OK" ? "is-ok" : "is-fail";
}

export function GpuPanel() {
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

  const shown = runs.filter((r) => r.kitReady);
  if (!shown.length) return null;

  return (
    <section className="gpu" aria-label="GPU repro runs">
      <h2 className="gpu__title">Sent to the GPU</h2>
      {shown.map((r) => (
        <div key={r.issueKey} className="gpu__run">
          <div className="gpu__head">
            <strong>{r.issueKey.replace("-", " #")}</strong>
            <span>
              {POD_TEXT[r.podState]}
              {r.gpu && `, 1x ${r.gpu.replace("NVIDIA ", "").replace(" Blackwell", "")}`}
              {r.rateUsdHr && ` at $${r.rateUsdHr.toFixed(2)}/hr`}
              {r.spentUsd !== undefined && `, spent $${r.spentUsd.toFixed(2)}`}
            </span>
          </div>
          {r.variants.length > 0 && (
            <ul className="gpu__variants">
              {r.variants.map((v) => (
                <li key={v.name} className={verdictClass(v.verdict)} title={v.fault ?? undefined}>
                  <span className="gpu__name">{v.name}</span>
                  <span className="gpu__verdict">
                    {v.verdict ?? v.phase ?? "queued"}
                    {typeof v.gsm8k === "number" && `, GSM8K ${v.gsm8k.toFixed(2)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
