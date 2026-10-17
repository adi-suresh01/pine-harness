import { useLayoutEffect, useRef } from "react";
import { CATEGORY_ORDER, finalCategory, type Category, type Issue, type TriageStatus } from "./api";

const GROUP_WORD: Record<Category, string> = {
  already_fixed: "already fixed",
  needs_repro: "need a GPU",
  needs_info: "need info",
  duplicate: "duplicate",
  not_a_bug: "not a bug",
};

interface Props {
  issues: Issue[];
  byKey: Map<string, TriageStatus>;
  selected: string | undefined;
  onSelect: (key: string) => void;
}

/**
 * One dot per issue. A dot fills with its verdict's color and moves into that verdict's group as the agent
 * finishes, so the row sorts itself while the room watches. The move is a FLIP: measure, re-render, then
 * animate from the old spot.
 */
export function Dots({ issues, byKey, selected, onSelect }: Props) {
  const groups = CATEGORY_ORDER.map((c) => ({
    cat: c as Category | "open",
    items: issues.filter((i) => byKey.get(i.key)?.phase === "done" && finalCategory(byKey.get(i.key)) === c),
  })).filter((g) => g.items.length);
  const open = issues.filter((i) => byKey.get(i.key)?.phase !== "done");
  if (open.length) groups.push({ cat: "open", items: open });

  const refs = useRef(new Map<string, HTMLButtonElement>());
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [key, el] of refs.current) {
      const now = el.getBoundingClientRect();
      const before = last.current.get(key);
      if (before && !reduce && (before.left !== now.left || before.top !== now.top)) {
        el.animate(
          [{ transform: `translate(${before.left - now.left}px, ${before.top - now.top}px)` }, { transform: "translate(0, 0)" }],
          { duration: 650, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
      last.current.set(key, now);
    }
  });

  return (
    <nav className="dots" aria-label="Issues by verdict">
      {groups.map((g) => (
        <div key={g.cat} className={`group ${g.cat === "open" ? "group--open" : `cat-${g.cat}`}`}>
          <div className="group__dots">
            {g.items.map((issue) => {
              const s = byKey.get(issue.key);
              const working = s && s.phase !== "done" && s.phase !== "failed";
              return (
                <button
                  key={issue.key}
                  ref={(el) => {
                    if (el) refs.current.set(issue.key, el);
                    else refs.current.delete(issue.key);
                  }}
                  className={`dotbtn ${issue.key === selected ? "is-selected" : ""} ${working ? "is-working" : ""} ${s?.phase === "failed" ? "is-failed" : ""}`}
                  onClick={() => onSelect(issue.key)}
                  title={`${issue.repo.startsWith("vllm") ? "vLLM" : "SGLang"} #${issue.number}`}
                  aria-label={`${issue.repo}#${issue.number}`}
                  aria-current={issue.key === selected}
                />
              );
            })}
          </div>
          <p className="group__label">
            <b>{g.items.length}</b> {g.cat === "open" ? "still reading" : GROUP_WORD[g.cat]}
          </p>
        </div>
      ))}
    </nav>
  );
}
