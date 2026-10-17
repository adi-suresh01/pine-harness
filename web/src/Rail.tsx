import { useLayoutEffect, useRef } from "react";
import { CATEGORY_ORDER, finalCategory, type Category, type Issue, type TriageStatus } from "./api";

const GROUP: Record<Category, string> = {
  already_fixed: "Already fixed",
  needs_repro: "Needs a GPU",
  needs_info: "Needs info",
  duplicate: "Duplicate",
  not_a_bug: "Not a bug",
};

interface Props {
  issues: Issue[];
  byKey: Map<string, TriageStatus>;
  selected: string | undefined;
  onSelect: (key: string) => void;
}

/**
 * Every issue's number on one line, grouped by verdict. The bar over a number takes its verdict's color when the
 * agent finishes, and the number slides into that group. The slide is a FLIP: measure, re-render, then animate
 * from the old spot.
 */
export function Rail({ issues, byKey, selected, onSelect }: Props) {
  const groups = CATEGORY_ORDER.map((c) => ({
    cat: c as Category | "open",
    items: issues.filter((i) => byKey.get(i.key)?.phase === "done" && finalCategory(byKey.get(i.key)) === c),
  })).filter((g) => g.items.length);
  const open = issues.filter((i) => byKey.get(i.key)?.phase !== "done");
  if (open.length) groups.push({ cat: "open", items: open });
  const working = (i: Issue) => {
    const p = byKey.get(i.key)?.phase;
    return !!p && p !== "done" && p !== "failed";
  };
  const openLabel = open.some(working) ? "Reading" : open.some((i) => byKey.get(i.key)?.phase === "failed") ? "No verdict" : "Waiting";

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
    <nav className="rail" aria-label="Issues by verdict">
      {groups.map((g) => (
        <div key={g.cat} className={`rail__group ${g.cat === "open" ? "rail__group--open" : `cat-${g.cat}`}`}>
          <p className="rail__label">{g.cat === "open" ? openLabel : GROUP[g.cat]}</p>
          <div className="rail__items">
            {g.items.map((issue) => (
              <button
                key={issue.key}
                ref={(el) => {
                  if (el) refs.current.set(issue.key, el);
                  else refs.current.delete(issue.key);
                }}
                className={`rail__item ${issue.key === selected ? "is-selected" : ""} ${working(issue) ? "is-working" : ""}`}
                onClick={() => onSelect(issue.key)}
                title={`${issue.repo.startsWith("vllm") ? "vLLM" : "SGLang"} #${issue.number}`}
                aria-label={`${issue.repo}#${issue.number}`}
                aria-current={issue.key === selected}
              >
                {issue.number}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
