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
// the demo leaves Computers idle while people watch, and watching doesn't count as use
const WANTED_IDLE_S = 3600;
// a cached handle is trusted this long before its runtime is read again
const RECHECK_MS = 60_000;

interface FleetEntry {
  slot: number;
  computerId: string;
  credentials: string;
  binding: string | null;
  createdAt: string;
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
  const next = fleetLock.then(async () => fn((await readJson<FleetEntry[]>(FLEET_FILE)) ?? []));
  fleetLock = next.catch(() => undefined);
  return next;
}
function saveEntry(entry: FleetEntry): Promise<void> {
  return withFleet(async (entries) => {
    const rest = entries.filter((e) => e.slot !== entry.slot);
    await writeJson(FLEET_FILE, [...rest, entry].sort((a, b) => a.slot - b.slot));
  });
}

export function fleetEntries(): Promise<FleetEntry[]> {
  return withFleet(async (entries) => entries);
}

let idleSeconds: number | undefined;
async function idleTimeout(): Promise<number> {
  if (idleSeconds) return idleSeconds;
  const policy = await pine().projectPolicy();
  idleSeconds = Math.min(WANTED_IDLE_S, policy.lifecycle?.maxIdleTimeoutSeconds ?? WANTED_IDLE_S);
  return idleSeconds;
}

const cache = new Map<number, { computer: Computer; checkedAt: number }>();
const inflight = new Map<number, Promise<Computer>>();

/** Reads the runtime state; "gone" only when Pine confirms the record no longer exists. */
async function runtimeState(computer: Computer): Promise<string> {
  try {
    return await computer.status();
  } catch (err) {
    if (err instanceof NotFoundError) return "gone";
    throw err;
  }
}

/** The running Computer for a slot: reconnects, restarts or creates it, and saves its keys first. */
export function ensureComputer(slot: number, log: (msg: string) => void = () => {}): Promise<Computer> {
  // two triages, or a triage and a page request, must never create two Computers for one slot
  let p = inflight.get(slot);
  if (!p) {
    p = resolveComputer(slot, log).finally(() => inflight.delete(slot));
    inflight.set(slot, p);
  }
  return p;
}

async function resolveComputer(slot: number, log: (msg: string) => void): Promise<Computer> {
  const hit = cache.get(slot);
  if (hit && Date.now() - hit.checkedAt < RECHECK_MS) return hit.computer;
  if (hit) {
    const state = await runtimeState(hit.computer).catch(() => "unknown");
    if (state === "running") {
      hit.checkedAt = Date.now();
      return hit.computer;
    }
    log(`slot ${slot}: cached runtime is ${state}`);
    cache.delete(slot);
  }

  const entry = (await fleetEntries()).find((e) => e.slot === slot);
  const opts = { idleTimeoutSeconds: await idleTimeout(), location: { country: "US" } as const };
  let computer: Computer;

  if (entry?.binding) {
    const credentials = Credentials.parse(entry.credentials);
    computer = pine().reconnectComputer(credentials, Binding.parse(entry.binding));
    const state = await runtimeState(computer);
    if (state === "running") {
      // keep it
    } else if (state === "paused") {
      log(`slot ${slot}: resuming`);
      await computer.resume();
    } else if (state === "failed" || state === "unavailable") {
      log(`slot ${slot}: runtime ${state}, recovering from saved state`);
      computer = await withCreateRetry(() => pine().recoverComputer(credentials, opts), log);
    } else if (state === "gone" || state === "terminated" || state === "stopped") {
      log(`slot ${slot}: runtime ${state}, starting it again`);
      computer = await withCreateRetry(() => pine().startComputer(credentials, opts), log);
    } else {
      // pending, stopping, saving...: an operation is under way, so don't allocate a second runtime
      throw new Error(`slot ${slot}: runtime is ${state}; try again in a minute`);
    }
  } else if (entry) {
    // keys saved but the create never finished: start the same identity rather than leak a new one
    log(`slot ${slot}: finishing an interrupted create`);
    const credentials = Credentials.parse(entry.credentials);
    computer = await withCreateRetry(() => pine().startComputer(credentials, opts), log).catch(() =>
      withCreateRetry(() => pine().createComputer({ credentials, ...opts }), log),
    );
  } else {
    const credentials = await Credentials.generate();
    await saveEntry({ slot, computerId: credentials.id, credentials: credentials.serialize(), binding: null, createdAt: new Date().toISOString() });
    log(`slot ${slot}: creating ${credentials.id}`);
    computer = await withCreateRetry(() => pine().createComputer({ credentials, ...opts }), log);
  }

  const saved = (await fleetEntries()).find((e) => e.slot === slot)!;
  const binding = computer.binding().serialize();
  // only write on a real change: a CLI script and the server can both hold this file open
  if (saved.binding !== binding) await saveEntry({ ...saved, binding });
  cache.set(slot, { computer, checkedAt: Date.now() });
  return computer;
}

/** The slot's Computer only if it is already running; never starts or creates one. */
export async function runningComputer(slot: number): Promise<Computer | undefined> {
  const hit = cache.get(slot);
  if (hit) return hit.computer;
  const entry = (await fleetEntries()).find((e) => e.slot === slot);
  if (!entry?.binding) return undefined;
  const computer = pine().reconnectComputer(Credentials.parse(entry.credentials), Binding.parse(entry.binding));
  return (await runtimeState(computer).catch(() => "unknown")) === "running" ? computer : undefined;
}

/** Forgets a cached handle after a call says its runtime is gone, so the next use reconnects or restarts. */
export function forget(slot: number): void {
  cache.delete(slot);
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
        throw new Error("the project is at its concurrent Computer limit; stop some with `bun run scripts/fleet.ts down`", { cause: err });
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
      try {
        const c = await ensureComputer(slot, log);
        log(`slot ${slot}: ready ${c.id} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (err) {
        log(`slot ${slot}: failed: ${(err as Error).message}`);
      }
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

/** A fresh browser session for one triage, so the agent starts with no memory of earlier runs. */
export async function freshSession(computer: Computer, runId: string, issueKey: string): Promise<Session> {
  const name = `t-${runId}`;
  for (const s of await computer.sessions()) {
    if (s.name !== name && s.name.startsWith("t-")) await computer.destroySession(s.name).catch(() => undefined);
  }
  return computer.createSession({ name, label: issueKey, browser: true });
}
