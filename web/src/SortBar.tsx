import { CATEGORY_LABEL, CATEGORY_ORDER, finalCategory, type TriageStatus } from "./api";

export function SortBar({ statuses, total }: { statuses: TriageStatus[]; total: number }) {
  const counts = new Map(CATEGORY_ORDER.map((c) => [c, 0]));
  let failed = 0;
  for (const s of statuses) {
    const c = finalCategory(s);
    if (s.phase === "done" && c) counts.set(c, (counts.get(c) ?? 0) + 1);
    else if (s.phase === "failed") failed++;
  }
  const sorted = [...counts.values()].reduce((a, b) => a + b, 0);
  const open = Math.max(0, total - sorted - failed);

  return (
    <section className="sortbar" aria-label="How the backlog sorted">
      <div className="sortbar__track">
        {CATEGORY_ORDER.map((c) => {
          const n = counts.get(c) ?? 0;
          return n ? <div key={c} className={`sortbar__seg cat-${c}`} style={{ flexGrow: n }} title={`${CATEGORY_LABEL[c]}: ${n}`} /> : null;
        })}
        {failed > 0 && <div className="sortbar__seg sortbar__seg--failed" style={{ flexGrow: failed }} />}
        {open > 0 && <div className="sortbar__seg sortbar__seg--open" style={{ flexGrow: open }} />}
      </div>
      <ul className="sortbar__legend">
        {CATEGORY_ORDER.map((c) => (
          <li key={c} className={`cat-${c}`}>
            <span className="sortbar__n">{counts.get(c) ?? 0}</span> {CATEGORY_LABEL[c].toLowerCase()}
          </li>
        ))}
        <li className="sortbar__pending">
          <span className="sortbar__n">{open}</span> still triaging{failed ? `, ${failed} without a verdict` : ""}
        </li>
      </ul>
    </section>
  );
}
