import { finalCategory, type Category, type Issue, type TriageStatus } from "./api";

const WORD: Record<Category, string> = {
  already_fixed: "fixed",
  needs_repro: "GPU repro",
  needs_info: "needs info",
  duplicate: "duplicate",
  not_a_bug: "not a bug",
};

const PHASE: Record<string, string> = {
  queued: "waiting",
  starting: "starting",
  running: "reading",
  verifying: "checking",
  failed: "no verdict",
};

interface Props {
  issues: Issue[];
  byKey: Map<string, TriageStatus>;
  selected: string | undefined;
  onSelect: (key: string) => void;
}

export function IssueList({ issues, byKey, selected, onSelect }: Props) {
  return (
    <nav className="list" aria-label="Issues">
      {issues.map((issue) => {
        const s = byKey.get(issue.key);
        const cat = s?.phase === "done" ? finalCategory(s) : undefined;
        const working = s && !cat && s.phase !== "failed";
        return (
          <button
            key={issue.key}
            className={`row ${cat ? `cat-${cat}` : ""} ${issue.key === selected ? "is-selected" : ""}`}
            onClick={() => onSelect(issue.key)}
            aria-current={issue.key === selected}
          >
            <span className="row__num">
              <span className="row__engine">{issue.repo.startsWith("vllm") ? "vLLM" : "SGLang"}</span> {issue.number}
            </span>
            <span className={`row__state ${working ? "is-working" : ""}`}>
              <span className="dot" aria-hidden />
              {cat ? WORD[cat] : s ? PHASE[s.phase] : ""}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
