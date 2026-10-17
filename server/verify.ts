import type { Category, Evidence, Verdict } from "./verdict";

export type CheckStatus = "ok" | "failed" | "unverified";

export interface EvidenceCheck extends Evidence {
  status: CheckStatus;
  facts: string;
  merged?: boolean;
  viaAditya: boolean;
  /** owner/repo#id of what the URL points at, lowercased */
  target?: string;
  /** what the URL really is, whatever kind the agent wrote */
  urlType?: GithubRef["type"];
  /** an issue, not a PR */
  isIssue?: boolean;
}

export interface Verified {
  checks: EvidenceCheck[];
  categoryIn: Category;
  categoryOut: Category;
  downgraded: boolean;
  note: string;
}

const ADITYA = "adi-suresh01";

type Fetcher = (path: string) => Promise<{ status: number; body: any }>;

let token: string | undefined;
async function githubToken(): Promise<string> {
  if (token !== undefined) return token;
  token = process.env.GH_VERIFY_TOKEN ?? "";
  if (!token) {
    // server-side only: the agents never see this token, they get the read-only GH_TRIAGE_TOKEN
    const p = Bun.spawnSync(["gh", "auth", "token"]);
    token = p.exitCode === 0 ? p.stdout.toString().trim() : "";
  }
  return token;
}

const cache = new Map<string, Promise<{ status: number; body: any }>>();
export const githubFetch: Fetcher = (path) => {
  let hit = cache.get(path);
  if (!hit) {
    hit = (async () => {
      const t = await githubToken();
      try {
        const res = await fetch(`https://api.github.com${path}`, {
          headers: { Accept: "application/vnd.github+json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
          // a hung request would leave the triage in "verifying" and the run live forever
          signal: AbortSignal.timeout(15_000),
        });
        return { status: res.status, body: res.ok ? await res.json() : await res.text() };
      } catch (err) {
        return { status: 599, body: (err as Error).message };
      }
    })();
    cache.set(path, hit);
    // never keep a failure: a 403 from a burst should not stick for the whole run
    hit.then((r) => r.status >= 400 && r.status !== 404 && cache.delete(path), () => cache.delete(path));
  }
  return hit;
};

export interface GithubRef {
  owner: string;
  repo: string;
  type: "pull" | "issues" | "commit" | "release" | "comment";
  id: string;
}

const API_TYPES: Record<string, GithubRef["type"]> = { pulls: "pull", issues: "issues", commits: "commit" };

export function parseGithubUrl(url: string): GithubRef | undefined {
  // the brief has agents search through the API, so some cite api.github.com/repos/... URLs
  const api = url.match(/api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)\/(pulls|issues|commits)\/([^/#?\s]+)/);
  if (api) {
    const [, owner, repo, kind, id] = api as unknown as [string, string, string, string, string];
    return { owner, repo, type: API_TYPES[kind]!, id };
  }
  const m = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues|commit|releases\/tag)\/([^/#?\s]+)(?:[^#]*#issuecomment-(\d+))?/);
  if (!m) return undefined;
  const [, owner, repo, kind, id, commentId] = m as unknown as [string, string, string, string, string, string?];
  if (commentId) return { owner, repo, type: "comment", id: commentId };
  const type = kind === "releases/tag" ? "release" : (kind as GithubRef["type"]);
  return { owner, repo, type, id };
}

// Only a 404 says the thing doesn't exist. A 403, 429, 5xx or timeout says nothing about the claim.
function miss(base: EvidenceCheck, status: number, what: string): EvidenceCheck {
  return status === 404
    ? { ...base, status: "failed", facts: `${what} not found` }
    : { ...base, status: "unverified", facts: `${what}: GitHub answered ${status}` };
}

async function checkOne(ev: Evidence, gh: Fetcher): Promise<EvidenceCheck> {
  const ref = parseGithubUrl(ev.url);
  if (!ref) return { ...ev, viaAditya: false, status: "unverified", facts: "not a GitHub issue, PR, commit, release or comment URL" };
  const base: EvidenceCheck = {
    ...ev,
    viaAditya: false,
    status: "unverified",
    facts: "",
    urlType: ref.type,
    target: `${ref.owner}/${ref.repo}#${ref.id}`.toLowerCase(),
  };
  const r = `/repos/${ref.owner}/${ref.repo}`;

  if (ref.type === "pull" || ref.type === "issues") {
    const issue = await gh(`${r}/issues/${ref.id}`);
    if (issue.status !== 200) return miss(base, issue.status, `${ref.repo}#${ref.id}`);
    const viaAditya = issue.body.user?.login === ADITYA;
    if (!issue.body.pull_request) {
      return { ...base, viaAditya, isIssue: true, status: "ok", facts: `issue ${ref.repo}#${ref.id} ${issue.body.state}: ${issue.body.title}` };
    }
    const pr = await gh(`${r}/pulls/${ref.id}`);
    if (pr.status !== 200) return miss({ ...base, viaAditya }, pr.status, `PR #${ref.id}`);
    if (!pr.body.merged) {
      return { ...base, viaAditya, merged: false, status: "ok", facts: `PR #${ref.id} ${pr.body.state}, not merged` };
    }
    const mergedOn = String(pr.body.merged_at).slice(0, 10);
    const release = await releaseContaining(r, pr.body.merge_commit_sha, gh);
    return { ...base, viaAditya, merged: true, status: "ok", facts: `PR #${ref.id} merged ${mergedOn}; ${release}` };
  }

  if (ref.type === "commit") {
    const c = await gh(`${r}/commits/${ref.id}`);
    if (c.status !== 200) return miss(base, c.status, `commit ${ref.id.slice(0, 10)}`);
    const release = await releaseContaining(r, c.body.sha, gh);
    return { ...base, merged: true, status: "ok", facts: `commit ${ref.id.slice(0, 10)} on ${String(c.body.commit?.committer?.date).slice(0, 10)}; ${release}` };
  }

  if (ref.type === "release") {
    const rel = await gh(`${r}/releases/tags/${ref.id}`);
    if (rel.status !== 200) return miss(base, rel.status, `release ${ref.id}`);
    return { ...base, status: "ok", facts: `release ${ref.id} published ${String(rel.body.published_at).slice(0, 10)}` };
  }

  const cm = await gh(`${r}/issues/comments/${ref.id}`);
  if (cm.status !== 200) return miss(base, cm.status, `comment ${ref.id}`);
  const login = cm.body.user?.login ?? "?";
  return { ...base, viaAditya: login === ADITYA, status: "ok", facts: `comment by ${login} on ${String(cm.body.created_at).slice(0, 10)}` };
}

// compare tag against the merge commit: "ahead" or "identical" means the tag already contains it
async function releaseContaining(r: string, sha: string | undefined, gh: Fetcher): Promise<string> {
  if (!sha) return "release unknown";
  const latest = await gh(`${r}/releases/latest`);
  if (latest.status !== 200) return "no releases";
  const tag = latest.body.tag_name as string;
  const cmp = await gh(`${r}/compare/${sha}...${encodeURIComponent(tag)}`);
  if (cmp.status !== 200) return `release check failed (${cmp.status})`;
  return cmp.body.status === "ahead" || cmp.body.status === "identical" ? `in ${tag}` : `after ${tag} (nightly only)`;
}

/** `self` is the triaged issue as owner/repo#number, so a verdict can't cite itself as its own duplicate. */
export async function verifyVerdict(v: Verdict, self: string, gh: Fetcher = githubFetch): Promise<Verified> {
  const checks: EvidenceCheck[] = await Promise.all(
    v.evidence.map((e) =>
      checkOne(e, gh).catch((err): EvidenceCheck => ({ ...e, viaAditya: false, status: "unverified", facts: `check error: ${(err as Error).message}` })),
    ),
  );
  const clean = checks.filter((c) => c.status === "ok" && !c.viaAditya);
  const selfRef = self.toLowerCase();
  let categoryOut: Category = v.category;
  let note = "";
  // when GitHub couldn't be read at all, the agent's call stands; a downgrade needs evidence that failed
  const nothingReadable = checks.length > 0 && checks.every((c) => c.status === "unverified");

  if (nothingReadable) {
    note = "GitHub could not be read, so the evidence is unchecked";
  } else if (v.category === "already_fixed") {
    // what the URL really is decides this, not the kind the agent wrote next to it
    const backed = clean.some((c) => c.merged === true || c.urlType === "release" || c.urlType === "comment");
    if (!backed) {
      categoryOut = "needs_info";
      note = "no merged fix, release or confirming comment checked out, so this needs a retest from the reporter";
    }
  } else if (v.category === "duplicate") {
    const backed = clean.some((c) => c.isIssue === true && c.target !== selfRef);
    if (!backed) {
      categoryOut = "needs_info";
      note = "the duplicate it names did not check out";
    }
  }
  if (checks.some((c) => c.viaAditya)) note = [note, "some evidence came from Aditya's own comments"].filter(Boolean).join("; ");

  return { checks, categoryIn: v.category, categoryOut, downgraded: categoryOut !== v.category, note };
}
