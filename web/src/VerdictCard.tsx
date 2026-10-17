import { CATEGORY_LABEL, type Issue, type TriageStatus } from "./api";

const CHECK_TEXT = { ok: "Checked", failed: "Did not check out", unverified: "Not checkable" } as const;

interface Props {
  issue: Issue;
  status: TriageStatus | undefined;
  reviewed: string | undefined;
  onPost: (draft: string) => void;
}

export function VerdictCard({ issue, status, reviewed, onPost }: Props) {
  if (!status || status.phase !== "done" || !status.verdict) {
    return (
      <section className="verdict verdict--empty">
        {status?.phase === "failed" ? `No verdict: ${status.error ?? "the agent stopped early"}` : "The verdict shows here when the agent finishes."}
      </section>
    );
  }
  const v = status.verdict;
  const ver = status.verified;
  const cat = ver?.categoryOut ?? v.category;
  const draft = reviewed ?? v.draft_comment;

  return (
    <section className={`verdict cat-${cat}`} aria-label="Verdict">
      <header className="verdict__head">
        <h2 className="verdict__cat">{CATEGORY_LABEL[cat]}</h2>
        {/* up here so it stays on screen however long the evidence list gets */}
        {draft && (
          <button className="btn" onClick={() => onPost(draft)}>
            Review and post
          </button>
        )}
      </header>
      <p className="verdict__meta">
        {v.confidence} confidence
        {ver?.downgraded && `, moved from ${CATEGORY_LABEL[ver.categoryIn].toLowerCase()} because ${ver.note}`}
        {issue.groundTruth && `. My hand triage said ${CATEGORY_LABEL[issue.groundTruth.category].toLowerCase()}.`}
      </p>
      <p className="verdict__summary">{v.summary}</p>
      {ver && ver.checks.length > 0 && (
        <ul className="evidence">
          {ver.checks.map((c, i) => (
            <li key={i} className={`evidence__item is-${c.status}`}>
              <a href={c.url} target="_blank" rel="noreferrer">
                {c.ref}
              </a>
              <span className="evidence__check">{CHECK_TEXT[c.status]}</span>
              <span className="evidence__facts">
                {c.facts}
                {c.viaAditya && ", found through my own comment"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <div className="draft">
          <p className="draft__label">{reviewed ? "My reviewed comment, with the GPU results" : "The agent's draft comment"}</p>
          <p className="draft__text">{draft}</p>
        </div>
      )}
    </section>
  );
}
