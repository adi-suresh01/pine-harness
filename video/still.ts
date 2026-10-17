// bun run video/still.ts <out-dir>
// A 2x render of the #60172 verdict column after the GPU test: the agent's diff, red, green. The recording shows the
// same state at 1x in a narrow column, which is too small to read once the video is scaled down.
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "video/out";
const browser = await chromium.launch({ executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/?theme=dark", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".dotbtn");
await page.locator('.dotbtn[aria-label$="#60172"]').click();
await page.waitForSelector(".fix__results", { timeout: 20_000 });
await page.waitForTimeout(800);
const box = (await page.locator(".verdict").boundingBox())!;
await page.screenshot({ path: `${out}/land-2x.png`, clip: { x: box.x - 24, y: box.y - 8, width: box.width + 48, height: Math.min(box.height + 16, 1000) } });
console.log(await page.locator(".fix__results").innerText());
await browser.close();
