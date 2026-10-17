// bun run video/cards.ts <out-dir>
// Renders the title card, end card and caption overlays as 1920x1080 PNGs in the app's own font and colors.
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "video/out";
// inlined: a page set from about:blank may not load file:// fonts
const fontFile = `${process.cwd()}/node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2`;
const font = `data:font/woff2;base64,${Buffer.from(await Bun.file(fontFile).arrayBuffer()).toString("base64")}`;

const css = `
@font-face { font-family: S; src: url("${font}") format("woff2"); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; font-family: S, sans-serif; -webkit-font-smoothing: antialiased; }
.full { background: #0c1512; color: #e6ede8; padding: 150px 160px; display: flex; flex-direction: column; justify-content: center; height: 100%; }
h1 { font-size: 112px; font-weight: 760; letter-spacing: -0.03em; line-height: 1; }
.sub { margin-top: 36px; font-size: 44px; color: #8c9b93; max-width: 1400px; line-height: 1.25; }
.dots { display: flex; gap: 14px; margin-top: 70px; }
.dots i { width: 30px; height: 30px; border-radius: 50%; display: block; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 56px 80px; margin-top: 30px; }
.stat b { display: block; font-size: 88px; font-weight: 760; letter-spacing: -0.02em; line-height: 1; }
.stat span { display: block; margin-top: 12px; font-size: 32px; color: #8c9b93; }
.url { margin-top: 80px; font-size: 34px; color: #8c9b93; }
body.cap { background: transparent; }
.band.bottom { top: auto; bottom: 0; }
.band { position: absolute; left: 0; right: 0; top: 0; padding: 30px 48px 34px; background: rgba(9, 16, 13, 0.92);
        box-shadow: 0 1px 0 rgba(230, 237, 232, 0.08);
        font-size: 44px; font-weight: 600; color: #e6ede8; letter-spacing: -0.01em; line-height: 1.2; }
`;

const palette = ["#4cc38a", "#ff6f61", "#f0b44c", "#9099ff", "#8c9b93"];
const dots = (n: number[]) => n.map((c, i) => `<i style="background:${palette[c]}" data-i="${i}"></i>`).join("");

const cards: Record<string, { body: string; cls?: string }> = {
  title: {
    body: `<div class="full"><h1>Triage swarm</h1>
      <p class="sub">Pine Computer agents triage open GPU serving bugs in vLLM and SGLang. Only the ones that need a GPU get one.</p>
      <div class="dots">${dots([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 4])}</div></div>`,
  },
  review: {
    body: `<div class="full"><h1 style="font-size:84px">The GPU says it works.<br>I still wouldn't ship it.</h1>
      <p class="sub">It reads the 48 KiB default instead of the opt-in shared-memory limit, so Hopper would lose a pipeline
      stage too. Agents draft, the GPU checks, I decide.</p></div>`,
  },
  end: {
    body: `<div class="full"><div class="stats">
      <div class="stat"><b>19 issues, 3.7 min</b><span>triaged at once, one Pine Computer each</span></div>
      <div class="stat"><b>339 of 339</b><span>links the agents cited today checked out against GitHub</span></div>
      <div class="stat"><b>$1.33</b><span>of agent time for the whole backlog</span></div>
      <div class="stat"><b>58 cents</b><span>of GPU to watch an agent's patch go from red to green</span></div>
      </div><p class="url">github.com/adi-suresh01/pine-harness</p></div>`,
  },
};
const captions: Record<string, string> = {
  "cap-swarm": "19 open GPU serving bugs. Each gets its own Pine Computer and agent.",
  "cap-dots": "Every step streams in live. Each dot takes its verdict's color.",
  "cap-verdict": "Every cited link is checked against GitHub. It found a duplicate I missed.",
  "cap-fix": "A fresh Pine agent writes the fix from the issue and the source alone.",
  "cap-gpu": "A real RTX PRO 6000 decides. Unpatched fails at boot. The patch serves.",
  "cap-post": "Agents never post. Pine hands me control, and I click Comment.",
};
// top over the swarm (the dots at the bottom are the point there), bottom everywhere else (the verdict is at the top)
for (const [k, text] of Object.entries(captions)) {
  cards[`${k}-top`] = { cls: "cap", body: `<div class="band">${text}</div>` };
  cards[`${k}-bottom`] = { cls: "cap", body: `<div class="band bottom">${text}</div>` };
}

const browser = await chromium.launch({ executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, c] of Object.entries(cards)) {
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body class="${c.cls ?? ""}">${c.body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png`, omitBackground: c.cls === "cap" });
}
await browser.close();
console.log(`cards in ${out}/`);
