import { CATEGORY_ORDER, finalCategory, type Category, type TriageStatus } from "./api";

const COUNT_WORD: Record<Category, string> = {
  already_fixed: "already fixed",
  needs_repro: "need a GPU",
  needs_info: "need info",
  duplicate: "duplicate",
  not_a_bug: "not a bug",
};

export function Bar({ statuses, total }: { statuses: TriageStatus[]; total: number }) {
  const counts = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const s of statuses) {
    const c = s.phase === "done" ? finalCategory(s) : undefined;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const sorted = [...counts.values()].reduce((a, b) => a + b, 0);
  const open = Math.max(0, total - sorted);

  return (
    <section className="bar" aria-label={`${sorted} of ${total} issues sorted`}>
      <div className="bar__track">
        {CATEGORY_ORDER.map((c) => {
          const n = counts.get(c) ?? 0;
          return n ? <span key={c} className={`bar__seg cat-${c}`} style={{ flexGrow: n }} /> : null;
        })}
        {open > 0 && <span className="bar__seg bar__seg--open" style={{ flexGrow: open }} />}
      </div>
      <p className="bar__legend">
        {CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
          <span key={c} className={`cat-${c}`}>
            <b>{counts.get(c)}</b> {COUNT_WORD[c]}
          </span>
        ))}
        {open > 0 && (
          <span className="bar__open">
            <b>{open}</b> still reading
          </span>
        )}
      </p>
    </section>
  );
}
