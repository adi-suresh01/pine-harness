import { CATEGORY_LABEL, finalCategory, frameUrl, type Category, type Issue, type TriageStatus } from "./api";

const PHASE_TEXT: Record<string, string> = {
  queued: "Waiting for its Computer",
  starting: "Starting its Computer",
  running: "Reading the thread",
  verifying: "Checking the evidence",
  failed: "No verdict",
};

// tiles are narrow; the verdict card and the sorting bar carry the full names
const TILE_LABEL: Record<Category, string> = {
  already_fixed: "Already fixed",
  needs_repro: "GPU repro",
  needs_info: "Needs info",
  duplicate: "Duplicate",
  not_a_bug: "Not a bug",
};

interface Props {
  issue: Issue;
  status: TriageStatus | undefined;
  runId: string | undefined;
  selected: boolean;
  onSelect: () => void;
}

export function Tile({ issue, status, runId, selected, onSelect }: Props) {
  const cat = status?.phase === "done" ? finalCategory(status) : undefined;
  const gt = issue.groundTruth;
  const judged = gt && cat;
  const engine = issue.repo.startsWith("vllm") ? "vLLM" : "SGLang";

  return (
    <button className={`tile ${cat ? `cat-${cat} tile--sorted` : ""} ${selected ? "tile--selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <div className="tile__screen">
        {status?.lastFrame && runId ? (
          <img src={frameUrl(runId, issue.key, status.lastFrame)} alt="" loading="lazy" />
        ) : (
          <span className="tile__idle">{status ? PHASE_TEXT[status.phase] ?? "" : "Not started"}</span>
        )}
        {judged && (
          <span
            className={`tile__gt ${gt.category === cat ? "is-same" : "is-diff"}`}
            title={gt.category === cat ? "Matches my hand triage" : `My hand triage said ${CATEGORY_LABEL[gt.category].toLowerCase()}`}
          >
            {gt.category === cat ? "Matches me" : "Differs"}
          </span>
        )}
      </div>
      <div className="tile__body">
        <span className="tile__ref">
          {engine} #{issue.number}
        </span>
        <span className="tile__title">{issue.title.replace(/^\[[^\]]+\]:?\s*/, "")}</span>
      </div>
      <div className="tile__foot">{cat ? TILE_LABEL[cat] : status ? PHASE_TEXT[status.phase] : ""}</div>
    </button>
  );
}
