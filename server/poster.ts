import type { Session } from "@pinesandbox/computer";
import { join } from "node:path";
import { ensureComputer } from "./pine/fleet";
import { STATE_DIR, readJson, writeJson } from "./store";

// The one Computer signed in to Aditya's GitHub. Triage agents never run on it.
export const POSTER_SLOT = 99;
const POSTER_SESSION = "poster";
const POSTER_FILE = join(STATE_DIR, "poster.json");

interface PosterState {
  name: string;
  token: string;
  posted: { issueUrl: string; at: string }[];
}

async function posterSession(): Promise<{ session: Session; state: PosterState }> {
  const computer = await ensureComputer(POSTER_SLOT);
  let state = await readJson<PosterState>(POSTER_FILE);
  const names = (await computer.sessions()).map((s) => s.name);
  if (!state || !names.includes(state.name)) {
    const s = await computer.createSession({ name: POSTER_SESSION, label: "poster", browser: true });
    state = { name: s.name, token: s.token, posted: state?.posted ?? [] };
    await writeJson(POSTER_FILE, state);
  }
  return { session: computer.adoptSession(state.name, state.token), state };
}

/**
 * Opens a page on the poster desktop and hands control to Aditya. No agent runs here: the
 * page opens by tab call, and Aditya does the typing and clicking himself.
 */
export async function openForHuman(url: string) {
  const { session } = await posterSession();
  await session.createTab(url);
  const computer = await ensureComputer(POSTER_SLOT);
  await computer.takeControl(session.name);
  const delegation = await computer.delegateDesktop(session.name, { create: false });
  return { sessionName: session.name, delegation: delegation.toJSON() };
}

export async function releaseHuman(postedUrl?: string) {
  const { session, state } = await posterSession();
  const computer = await ensureComputer(POSTER_SLOT);
  const control = await computer.releaseControl(session.name);
  if (postedUrl) {
    state.posted.push({ issueUrl: postedUrl, at: new Date().toISOString() });
    await writeJson(POSTER_FILE, state);
  }
  return { controller: control.controller };
}

export async function posterDelegation() {
  const { session } = await posterSession();
  const computer = await ensureComputer(POSTER_SLOT);
  return (await computer.delegateDesktop(session.name, { create: false })).toJSON();
}
