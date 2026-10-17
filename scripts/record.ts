// bun run scripts/record.ts <out-dir>
// Records the real flow for the demo video: the swarm run, the #60172 verdict, a Pine agent writing the fix, and the
// warm GPU deciding. Drives the page in headless Brave at 1920x1080 and logs when each moment happens, so the edit can
// speed up the waits and keep the moments at real speed. Nothing is staged: it clicks the same buttons a person would.
import { chromium, type Page } from "playwright-core";

const out = process.argv[2] ?? "video";
const base = "http://localhost:3000";
const t0 = Date.now();
const marks: Record<string, number> = {};
const mark = (name: string) => {
  marks[name] = (Date.now() - t0) / 1000;
  console.log(`${marks[name].toFixed(1)}s ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (path: string) => (await fetch(base + path)).json();

async function until(what: string, test: () => Promise<boolean>, maxMs: number) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    if (await test().catch(() => false)) return;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const browser = await chromium.launch({ executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } },
});
const page: Page = await context.newPage();
await page.goto(`${base}/?theme=dark`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".rail__item");
await sleep(2500);
mark("open");

// the swarm
await page.locator(".top .btn").click();
mark("run_clicked");
const runId = await (async () => {
  let id = "";
  await until("the run to start", async () => {
    const s = await api("/api/state");
    id = s.run?.live ? s.run.runId : "";
    return !!id;
  }, 30_000);
  return id;
})();
// show a few different agents while they work; each hold is a few seconds once sped up
const tour = ["#56892", "#60847", "#55757", "#62028", "#58910"];
let i = 0;
await until(
  "all 19 verdicts",
  async () => {
    const s = await api(`/api/state?run=${runId}`);
    const done = s.statuses.filter((x: any) => x.phase === "done" || x.phase === "failed").length;
    if (!marks.first_verdict && done > 0) mark("first_verdict");
    if (done < 19 && Date.now() - t0 > (i + 1) * 50_000 && i < tour.length) {
      await page.locator(`.rail__item[aria-label$="${tour[i++]}"]`).click().catch(() => undefined);
    }
    return done === 19;
  },
  12 * 60_000,
);
mark("run_done");
await sleep(2500);

// the verdict that matters
await page.locator('.rail__item[aria-label$="#60172"]').click();
await sleep(1500);
mark("verdict_shown");
await sleep(4000);
await page.locator(".link", { hasText: "Evidence" }).click();
mark("evidence_open");
await sleep(4000);
await page.locator(".link", { hasText: "Evidence" }).click();

// a Pine agent writes the fix
await page.locator(".fix .btn", { hasText: "fix it" }).click();
mark("fix_clicked");
await until("the agent's patch", async () => (await api("/api/state")).fix?.phase === "done", 8 * 60_000);
mark("fix_done");
await sleep(4000);

// the warm GPU decides
await page.locator(".fix .btn", { hasText: "warm GPU" }).click();
mark("gpu_clicked");
await page.waitForSelector(".fix__results", { timeout: 10 * 60_000 });
mark("gpu_done");
await sleep(6000);
mark("end");

await context.close();
await browser.close();
await Bun.write(`${out}/marks.json`, JSON.stringify(marks, null, 2));
console.log(`video and marks in ${out}/`);
