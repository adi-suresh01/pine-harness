import { join, normalize } from "node:path";
import { loadBacklog } from "./backlog";
import { STAGE_KITS, approveGpuRun, gpuQuote, gpuRun, testOnWarmPod } from "./gpu";
import { currentFix, fixableIssues, startFix } from "./fix";
import { subscribe } from "./bus";
import { runningComputer } from "./pine/fleet";
import { openForHuman, posterDelegation, releaseHuman } from "./poster";
import { score } from "./score";
import { ROOT, RUNS_DIR, readJson, runDir } from "./store";
import { RunBusyError, isLive, listRuns, runStatuses, startSwarm } from "./swarm";
import type { TriageStatus } from "./triage/run";

const PORT = Number(process.env.PORT ?? 3000);
// issues with an sm120-kit folder; GPU_ISSUES=a,b overrides
// off by default: across three runs the learned skill was faster but leaned toward calling duplicates
const DEFAULT_SKILLS = (process.env.DEFAULT_SKILLS ?? "").split(",").filter(Boolean);
const GPU_ISSUES = [...(process.env.GPU_ISSUES ?? "vllm-60172").split(",").filter(Boolean), ...Object.values(STAGE_KITS)];
const WEB_DIST = join(ROOT, "web", "dist");

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function body<T>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}

// Only this machine's own page may call the API. A JSON content type forces a CORS preflight, so a page on
// another origin can't fire these POSTs blind, and the Origin check covers browsers that send one anyway.
function allowed(req: Request): boolean {
  if (req.method === "GET") return true;
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return false;
  const origin = req.headers.get("origin");
  return !origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}
const guard =
  (fn: (req: Request) => Promise<Response>) =>
  (req: Request): Promise<Response> | Response =>
    allowed(req) ? fn(req) : json({ error: "forbidden" }, 403);

// only files under a root, so a crafted path can't read state/ with the keys in it
function safeFile(root: string, rel: string): string | undefined {
  const p = normalize(join(root, rel));
  return p.startsWith(root + "/") ? p : undefined;
}

// drafts/<issue>.md is a comment I reviewed and edited (for example with GPU numbers); it wins over the agent's draft
async function reviewedDrafts(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const f = Bun.file(join(ROOT, "drafts", `${k}.md`));
    if (await f.exists()) out[k] = (await f.text()).trim();
  }
  return out;
}

async function state(runId?: string) {
  const backlog = await loadBacklog();
  const runs = await listRuns();
  const run = runs.find((r) => r.runId === runId) ?? runs[0];
  const statuses = run ? await runStatuses(run) : [];
  return {
    backlog,
    runs: runs.map((r) => ({ ...r, live: isLive(r.runId) })),
    run: run ? { ...run, live: isLive(run.runId) } : null,
    statuses,
    score: score(backlog, statuses),
    reviewed: await reviewedDrafts(backlog.map((i) => i.key)),
    fix: currentFix() ?? null,
    fixable: fixableIssues(),
  };
}

function sse(): Response {
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          unsubscribe();
        }
      };
      unsubscribe = subscribe(({ topic, data }) => send(topic, data));
      ping = setInterval(() => send("ping", Date.now()), 15_000);
      send("hello", Date.now());
    },
    cancel() {
      unsubscribe();
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } });
}

async function statusFor(runId: string, issueKey: string): Promise<TriageStatus | undefined> {
  return readJson<TriageStatus>(join(runDir(runId, issueKey), "status.json"));
}

Bun.serve({
  // loopback only: the poster desktop is signed in to my GitHub, and the venue Wi-Fi is shared
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 0,
  routes: {
    "/api/state": (req) => state(new URL(req.url).searchParams.get("run") ?? undefined).then((s) => json(s)),
    "/api/gpu": async () => json(await Promise.all(GPU_ISSUES.map(gpuRun))),
    // what a live GPU run would cost, read fresh from the RunPod catalog; rents nothing
    "/api/gpu/quote": {
      POST: guard(async (req) => {
        const b = await body<{ issueKey: string }>(req);
        return json(await gpuQuote(b.issueKey));
      }),
    },
    // a Pine agent writes a patch; the server checks it before anything runs it
    "/api/fix": {
      POST: guard(async (req) => {
        const b = await body<{ issueKey: string }>(req);
        return json(await startFix(b.issueKey));
      }),
    },
    "/api/fix/desktop": {
      POST: guard(async () => {
        const f = currentFix();
        if (!f?.sessionName) return json({ error: "no fix agent running" }, 404);
        const computer = await runningComputer(f.slot);
        if (!computer) return json({ error: "that Computer is not running" }, 404);
        return json((await computer.delegateDesktop(f.sessionName, { create: false })).toJSON());
      }),
    },
    // runs the unpatched fp8 variant and the agent's patch on the pod warmed before the demo; rents nothing new
    "/api/gpu/test": {
      POST: guard(async (req) => {
        const b = await body<{ issueKey: string }>(req);
        return json(await testOnWarmPod(b.issueKey));
      }),
    },
    // the person's click on Approve, at the worst case they were shown
    "/api/gpu/approve": {
      POST: guard(async (req) => {
        const b = await body<{ issueKey: string; worstCaseUsd: number }>(req);
        return json(await approveGpuRun(b.issueKey, Number(b.worstCaseUsd)));
      }),
    },
    "/api/stream": () => sse(),

    "/api/runs": {
      POST: guard(async (req) => {
        const b = await body<{ issues?: string[]; skills?: string[] }>(req);
        try {
          return json(await startSwarm(b.issues, { skills: b.skills ?? DEFAULT_SKILLS }));
        } catch (err) {
          if (err instanceof RunBusyError) return json({ error: "a run is already going; wait for it to finish" }, 409);
          throw err;
        }
      }),
    },

    // a fresh desktop token for one triage tile; the browser gets nothing else
    "/api/desktop": {
      POST: guard(async (req) => {
        const b = await body<{ runId: string; issueKey: string }>(req);
        const s = await statusFor(b.runId, b.issueKey);
        if (!s?.sessionName || s.phase !== "running") return json({ error: "that agent is not running" }, 404);
        // reconnect only: viewing a tile must never start or create a Computer
        const computer = await runningComputer(s.slot);
        if (!computer) return json({ error: "that Computer is not running" }, 404);
        return json((await computer.delegateDesktop(s.sessionName, { create: false })).toJSON());
      }),
    },

    "/api/poster/desktop": { POST: guard(async () => json(await posterDelegation())) },
    // opens the page on the signed-in poster desktop and hands control to Aditya
    "/api/poster/open": {
      POST: guard(async (req) => {
        const b = await body<{ url: string }>(req);
        if (!/^https:\/\/github\.com\//.test(b.url ?? "")) return json({ error: "github.com URLs only" }, 400);
        return json(await openForHuman(b.url));
      }),
    },
    "/api/poster/release": {
      POST: guard(async (req) => {
        const b = await body<{ postedUrl?: string }>(req);
        return json(await releaseHuman(b.postedUrl));
      }),
    },
  },

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/runs/")) {
      const p = safeFile(RUNS_DIR, decodeURIComponent(url.pathname.slice("/runs/".length)));
      const f = p && Bun.file(p);
      // frames never change once written; logs and statuses change every few seconds
      const cache = p?.endsWith(".webp") ? "max-age=3600" : "no-store";
      return f && (await f.exists()) ? new Response(f, { headers: { "Cache-Control": cache } }) : new Response("not found", { status: 404 });
    }
    const p = safeFile(WEB_DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const f = p ? Bun.file(p) : undefined;
    if (f && (await f.exists())) return new Response(f);
    const index = Bun.file(join(WEB_DIST, "index.html"));
    return (await index.exists()) ? new Response(index) : new Response("web not built: bun run build", { status: 404 });
  },

  error(err) {
    console.error(err);
    return json({ error: err.message }, 500);
  },
});

console.log(`pine-harness on http://localhost:${PORT}`);
