// Reads the project's limits before we allocate anything. Creates nothing, costs nothing.
import { Client } from "@pinesandbox/computer";

const client = Client.fromEnv();
const [policy, locations] = await Promise.all([client.projectPolicy(), client.availableLocations()]);
console.log(JSON.stringify({ policy, locations }, null, 2));
