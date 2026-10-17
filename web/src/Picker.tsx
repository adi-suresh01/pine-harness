import { useEffect, useRef } from "react";
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

/** The issue list, folded into one button at the foot of the page. It opens upward, one column per verdict. */
export function Picker({ issues, byKey, selected, onSelect }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // the menu lives in the top layer, so it is placed against the button each time it opens
  useEffect(() => {
    const m = menu.current;
    if (!m) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open" || !button.current) return;
      const r = button.current.getBoundingClientRect();
      m.style.left = `${r.left}px`;
      m.style.bottom = `${window.innerHeight - r.top + 10}px`;
    };
    m.addEventListener("beforetoggle", place);
    return () => m.removeEventListener("beforetoggle", place);
  }, []);

  const groups = CATEGORY_ORDER.map((c) => ({
    cat: c as Category | "open",
    items: issues.filter((i) => byKey.get(i.key)?.phase === "done" && finalCategory(byKey.get(i.key)) === c),
  })).filter((g) => g.items.length);
  const open = issues.filter((i) => byKey.get(i.key)?.phase !== "done");
  if (open.length) groups.push({ cat: "open", items: open });
  const working = open.some((i) => {
    const p = byKey.get(i.key)?.phase;
    return !!p && p !== "failed";
  });
  const openLabel = working ? "Reading" : open.some((i) => byKey.get(i.key)?.phase === "failed") ? "No verdict" : "Waiting";
  const done = issues.length - open.length;

  return (
    <div className="picker">
      <button ref={button} className="picker__btn" popoverTarget="issue-menu" aria-haspopup="true">
        Issues
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 6.5 5 3.5 8 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="picker__count">
        {working && <span className="pulse" aria-hidden />}
        {done} of {issues.length} verdicts in
      </span>
      <div ref={menu} id="issue-menu" popover="auto" className="picker__menu" aria-label="Issues by verdict">
        {groups.map((g) => (
          <section key={g.cat} className={`picker__group ${g.cat === "open" ? "picker__group--open" : `cat-${g.cat}`}`}>
            <p className="picker__label">{g.cat === "open" ? openLabel : GROUP[g.cat]}</p>
            <ul>
              {g.items.map((issue) => (
                <li key={issue.key}>
                  <button
                    className="picker__item"
                    aria-label={`${issue.repo}#${issue.number}`}
                    aria-current={issue.key === selected}
                    onClick={() => {
                      onSelect(issue.key);
                      menu.current?.hidePopover();
                    }}
                  >
                    #{issue.number}
                    {issue.repo.startsWith("sgl") && <span className="picker__repo">SGLang</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
