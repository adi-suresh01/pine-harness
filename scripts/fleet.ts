// bun run scripts/fleet.ts up <n> | down | status
import { fleetDown, fleetEntries, fleetUp, pine } from "../server/pine/fleet";
import { Binding, Credentials } from "@pinesandbox/computer";

const [cmd, arg] = process.argv.slice(2);

if (cmd === "up") {
  await fleetUp(Number(arg ?? 1));
} else if (cmd === "down") {
  await fleetDown();
} else if (cmd === "status") {
  for (const e of await fleetEntries()) {
    if (!e.binding) {
      console.log(`slot ${e.slot}: ${e.computerId} stopped`);
      continue;
    }
    const c = pine().reconnectComputer(Credentials.parse(e.credentials), Binding.parse(e.binding));
    const d = await c.runtimeDetails().catch((err) => ({ state: `error: ${(err as Error).message}`, expiresAt: undefined }));
    console.log(`slot ${e.slot}: ${e.computerId} ${d.state} expires ${d.expiresAt?.toISOString() ?? "?"}`);
  }
} else {
  console.error("usage: fleet.ts up <n> | down | status");
  process.exit(2);
}
