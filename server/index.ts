import { join, normalize } from "node:path";
import { loadBacklog } from "./backlog";
import { subscribe } from "./bus";
import { ensureComputer } from "./pine/fleet";
import { openForHuman, posterDelegation, releaseHuman } from "./poster";
import { score } from "./score";
import { ROOT, RUNS_DIR, readJson, runDir } from "./store";
import { isLive, listRuns, runStatuses, startSwarm } from "./swarm";
import type { TriageStatus } from "./triage/run";

const PORT = Number(process.env.PORT ?? 3000);
const WEB_DIST = join(ROOT, "web", "dist");

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function body<T>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}

// only files under a root, so a crafted path can't read state/ with the keys in it
function safeFile(root: string, rel: string): string | undefined {
  const p = normalize(join(root, rel));
  return p.startsWith(root + "/") ? p : undefined;
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
  port: PORT,
  idleTimeout: 0,
  routes: {
    "/api/state": (req) => state(new URL(req.url).searchParams.get("run") ?? undefined).then((s) => json(s)),
    "/api/stream": () => sse(),

    "/api/runs": {
      POST: async (req) => {
        const b = await body<{ issues?: string[]; skills?: string[] }>(req);
        return json(await startSwarm(b.issues, { skills: b.skills }));
      },
    },

    // a fresh desktop token for one triage tile; the browser gets nothing else
    "/api/desktop": {
      POST: async (req) => {
        const b = await body<{ runId: string; issueKey: string }>(req);
        const s = await statusFor(b.runId, b.issueKey);
        if (!s?.sessionName) return json({ error: "no session for that issue yet" }, 404);
        const computer = await ensureComputer(s.slot);
        return json((await computer.delegateDesktop(s.sessionName, { create: false })).toJSON());
      },
    },

    "/api/poster/desktop": { POST: async () => json(await posterDelegation()) },
    // opens the page on the signed-in poster desktop and hands control to Aditya
    "/api/poster/open": {
      POST: async (req) => {
        const b = await body<{ url: string }>(req);
        if (!/^https:\/\/github\.com\//.test(b.url ?? "")) return json({ error: "github.com URLs only" }, 400);
        return json(await openForHuman(b.url));
      },
    },
    "/api/poster/release": {
      POST: async (req) => {
        const b = await body<{ postedUrl?: string }>(req);
        return json(await releaseHuman(b.postedUrl));
      },
    },
  },

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/runs/")) {
      const p = safeFile(RUNS_DIR, decodeURIComponent(url.pathname.slice("/runs/".length)));
      const f = p && Bun.file(p);
      return f && (await f.exists()) ? new Response(f, { headers: { "Cache-Control": "max-age=3600" } }) : new Response("not found", { status: 404 });
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
