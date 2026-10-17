import type { ReactNode } from "react";

// Just enough markdown for a GitHub comment: paragraphs, `code` and one pipe table. Built from React elements, never
// innerHTML, because the agent's drafts come from threads anyone can write in.
export function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.map((b, i) => (b.trimStart().startsWith("|") ? <Table key={i} md={b} /> : <p key={i}>{inline(b)}</p>))}
    </div>
  );
}

function Table({ md }: { md: string }) {
  const rows = md
    .trim()
    .split("\n")
    .filter((l) => !/^\|\s*-/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
  const [head, ...body] = rows;
  return (
    <table>
      <thead>
        <tr>{head?.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr>
      </thead>
      <tbody>
        {body.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part));
}
