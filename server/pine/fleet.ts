import {
  Binding,
  CapacityExceededError,
  Client,
  Computer,
  CreateRateLimitedError,
  Credentials,
  NotFoundError,
  type Session,
} from "@pinesandbox/computer";
import { join } from "node:path";
import { STATE_DIR, readJson, writeJson } from "../store";

const FLEET_FILE = join(STATE_DIR, "fleet.json");
const SESSIONS_FILE = join(STATE_DIR, "sessions.json");
// the demo leaves Computers idle while people watch, and watching doesn't count as use
const WANTED_IDLE_S = 3600;

interface FleetEntry {
  slot: number;
  computerId: string;
  credentials: string;
  binding: string | null;
  createdAt: string;
}
interface SessionEntry {
  computerId: string;
  name: string;
  token: string;
}

let client: Client | undefined;
export function pine(): Client {
  client ??= Client.fromEnv();
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One writer at a time: slots are created concurrently but share one file.
let fleetLock: Promise<unknown> = Promise.resolve();
function withFleet<T>(fn: (entries: FleetEntry[]) => Promise<T>): Promise<T> {
  const next = fleetLock.then(async () => {
    const entries = (await readJson<FleetEntry[]>(FLEET_FILE)) ?? [];
    return fn(entries);
  });
  fleetLock = next.catch(() => undefined);
  return next;
}
async function saveEntry(entry: FleetEntry): Promise<void> {
  await withFleet(async (entries) => {
    const rest = entries.filter((e) => e.slot !== entry.slot);
    await writeJson(FLEET_FILE, [...rest, entry].sort((a, b) => a.slot - b.slot));
  });
}

export async function fleetEntries(): Promise<FleetEntry[]> {
  return withFleet(async (entries) => entries);
}

let idleSeconds: number | undefined;
async function idleTimeout(): Promise<number> {
  if (idleSeconds) return idleSeconds;
  const policy = await pine().projectPolicy();
  idleSeconds = Math.min(WANTED_IDLE_S, policy.lifecycle?.maxIdleTimeoutSeconds ?? WANTED_IDLE_S);
  return idleSeconds;
}

const cache = new Map<number, Computer>();

/** The running Computer for a slot: reconnects, restarts or creates it, and saves its keys first. */
export async function ensureComputer(slot: number, log: (msg: string) => void = () => {}): Promise<Computer> {
  const cached = cache.get(slot);
  if (cached) return cached;

  const entry = (await fleetEntries()).find((e) => e.slot === slot);
  const opts = { idleTimeoutSeconds: await idleTimeout(), location: { country: "US" } as const };
  let computer: Computer;

  if (entry?.binding) {
    computer = pine().reconnectComputer(Credentials.parse(entry.credentials), Binding.parse(entry.binding));
    const state = await computer.status().catch((err) => (err instanceof NotFoundError ? "gone" : "unknown"));
    if (state !== "running") {
      log(`slot ${slot}: runtime ${state}, starting it again`);
      computer = await withCreateRetry(() => pine().startComputer(Credentials.parse(entry.credentials), opts), log);
    }
  } else if (entry) {
    // keys saved but the create never finished: start the same identity rather than leak a new one
    log(`slot ${slot}: resuming an unfinished create`);
    computer = await withCreateRetry(() => pine().startComputer(Credentials.parse(entry.credentials), opts), log).catch(
      () => withCreateRetry(() => pine().createComputer({ credentials: Credentials.parse(entry.credentials), ...opts }), log),
    );
  } else {
    const credentials = await Credentials.generate();
    await saveEntry({ slot, computerId: credentials.id, credentials: credentials.serialize(), binding: null, createdAt: new Date().toISOString() });
    log(`slot ${slot}: creating ${credentials.id}`);
    computer = await withCreateRetry(() => pine().createComputer({ credentials, ...opts }), log);
  }

  const saved = (await fleetEntries()).find((e) => e.slot === slot)!;
  await saveEntry({ ...saved, binding: computer.binding().serialize() });
  cache.set(slot, computer);
  return computer;
}

async function withCreateRetry<T>(fn: () => Promise<T>, log: (msg: string) => void): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CreateRateLimitedError && attempt < 8) {
        const wait = Math.max(5, err.retryAfterSeconds || 15);
        log(`create rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (err instanceof CapacityExceededError) {
        throw new Error("project is at its concurrent Computer limit; stop some with `bun run fleet down`", { cause: err });
      }
      throw err;
    }
  }
}

/** Brings up slots 0..n-1, a few at a time so the create rate limit has room. */
export async function fleetUp(n: number, log: (msg: string) => void = console.log): Promise<void> {
  const slots = Array.from({ length: n }, (_, i) => i);
  const workers = Array.from({ length: Math.min(4, n) }, async () => {
    for (let slot = slots.shift(); slot !== undefined; slot = slots.shift()) {
      const t0 = Date.now();
      const c = await ensureComputer(slot, log);
      log(`slot ${slot}: ready ${c.id} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  });
  await Promise.all(workers);
}

export async function fleetDown(log: (msg: string) => void = console.log): Promise<void> {
  for (const entry of await fleetEntries()) {
    if (!entry.binding) continue;
    const computer = pine().reconnectComputer(Credentials.parse(entry.credentials), Binding.parse(entry.binding));
    const stopped = await computer.stop().catch((err) => {
      log(`slot ${entry.slot}: stop failed: ${(err as Error).message}`);
      return false;
    });
    log(`slot ${entry.slot}: ${stopped ? "stopped" : "stop unconfirmed"}`);
    if (stopped) await saveEntry({ ...entry, binding: null });
    cache.delete(entry.slot);
  }
}

// Session tokens come back only once, at create, so they live in state/ next to the fleet keys.
async function saveSession(key: string, s: SessionEntry): Promise<void> {
  const all = (await readJson<Record<string, SessionEntry>>(SESSIONS_FILE)) ?? {};
  all[key] = s;
  await writeJson(SESSIONS_FILE, all);
}

/** A fresh browser session for one triage, so the agent starts with no memory of earlier runs. */
export async function freshSession(computer: Computer, runId: string, issueKey: string): Promise<Session> {
  const name = `t-${runId}`;
  for (const s of await computer.sessions()) {
    if (s.name !== name && s.name.startsWith("t-")) await computer.destroySession(s.name).catch(() => undefined);
  }
  const session = await computer.createSession({ name, label: issueKey, browser: true });
  await saveSession(`${runId}/${issueKey}`, { computerId: computer.id, name: session.name, token: session.token });
  return session;
}

export async function adoptSession(runId: string, issueKey: string, computer: Computer): Promise<Session | undefined> {
  const all = (await readJson<Record<string, SessionEntry>>(SESSIONS_FILE)) ?? {};
  const s = all[`${runId}/${issueKey}`];
  return s ? computer.adoptSession(s.name, s.token) : undefined;
}
