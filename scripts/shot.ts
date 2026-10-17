// bun run scripts/shot.ts <out-dir> [width] [height]
// Screenshots the page the way the room will see it: the default view, a tile in focus, and a phone width.
// Drives the installed Brave headless; no browser download.
import { chromium } from "playwright-core";

const [out = "shots", w = "1920", h = "1080"] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".tile", { timeout: 15_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/1-overview-${w}.png` });

// the tile the demo opens on: the one with the GPU results and my reviewed comment
const tile = page.locator(".tile", { hasText: "#60172" });
if (await tile.count()) {
  await tile.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/2-focus-60172-${w}.png` });
}
const fixed = page.locator(".tile", { hasText: "#55757" });
if (await fixed.count()) {
  await fixed.first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/3-focus-55757-${w}.png` });
}

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/4-phone.png`, fullPage: true });

console.log(JSON.stringify({ errors }));
await browser.close();
