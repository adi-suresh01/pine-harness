// bun run video/edit.ts <raw-dir> [post-clip]
// Cuts the recorded run into a 90-second video. Waits are sped up to fixed lengths; the moments that matter (the
// verdict, red and green landing) stay at real speed. Each segment gets a caption and a short fade, then they join.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const raw = process.argv[2] ?? "video/raw";
const post = process.argv[3];
const cards = "video/out";
const out = "video/out";
const marks: Record<string, number> = await Bun.file(join(raw, "marks.json")).json();
const webm = readdirSync(raw).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error(`no recording in ${raw}`);
const src = join(raw, webm);

interface Seg {
  name: string;
  /** a card image, or a span of the recording */
  card?: string;
  from?: number;
  to?: number;
  /** length in the final video, seconds */
  len: number;
  caption?: string;
  file?: string;
  /** crop=w:h:x:y applied to the recording before scaling, to zoom into one part of the page */
  crop?: string;
  /** a still image, shown with a slow push-in */
  still?: string;
}

// the swarm shot ends before the tour reaches an agent that hit GitHub's rate limit; the verdict shot after it
// shows all 19 dots sorted anyway
const swarmEnd = Math.min(marks.run_done! + 2, Number(process.env.SWARM_END ?? 196));
const swarmStart = marks.run_clicked! + 8;
const mid = (swarmStart + swarmEnd) / 2;
const segs: Seg[] = [
  { name: "title", card: "title", len: 4.5 },
  { name: "swarm-a", from: swarmStart, to: mid, len: 9, caption: "cap-swarm-top" },
  { name: "swarm-b", from: mid, to: swarmEnd, len: 9, caption: "cap-dots-top" },
  { name: "verdict", from: marks.verdict_shown! - 0.5, to: marks.fix_clicked! + 0.5, len: 9.5, caption: "cap-verdict-bottom" },
  { name: "fix", from: marks.fix_clicked! + 0.5, to: marks.fix_done! + 3, len: 13, caption: "cap-fix-bottom" },
  // zoom into the verdict column, where "Running on the GPU" changes from the unpatched run to the patch
  { name: "gpu-run", from: marks.gpu_clicked! - 0.5, to: marks.gpu_done! - 1, len: 9, crop: "800:450:1120:420", caption: "cap-gpu-bottom" },
  { name: "gpu-land", still: "land-2x", len: 5.5, caption: "cap-gpu-bottom" },
];
if (post) segs.push({ name: "post", file: post, len: 14, caption: "cap-post-bottom" });
segs.push({ name: "review", card: "review", len: 6 });
segs.push({ name: "end", card: "end", len: 6.5 });

function run(args: string[]) {
  const p = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (p.exitCode !== 0) throw new Error(`ffmpeg failed: ${p.stderr.toString().slice(-600)}`);
}

function duration(file: string): number {
  const p = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(p.stdout.toString().trim());
}

const fade = 0.25;
const parts: string[] = [];
for (const s of segs) {
  const file = join(out, `seg-${s.name}.mp4`);
  const fades = `fade=t=in:st=0:d=${fade},fade=t=out:st=${(s.len - fade).toFixed(2)}:d=${fade}`;
  const norm = "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0c1512,fps=30,format=yuv420p";
  if (s.still) {
    // the lower part of the column: the diff and red/green, pushed in slowly
    const frames = Math.round(s.len * 30);
    const cap = s.caption ? join(cards, `${s.caption}.png`) : undefined;
    const graph =
      `[0:v]crop=iw:min(ih\\,880):0:ih-min(ih\\,880)-170,scale=-2:900,` +
      `zoompan=z='1+0.04*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1100x900:fps=30,` +
      `pad=1920:1080:(ow-iw)/2:(oh-ih)/2-40:color=0x0c1512,format=yuv420p` +
      (cap ? `[v];[v][1:v]overlay=0:0,${fades}[o]` : `,${fades}[o]`);
    run(["-loop", "1", "-i", join(cards, `${s.still}.png`), ...(cap ? ["-loop", "1", "-i", cap] : []), "-filter_complex", graph, "-map", "[o]", "-t", String(s.len), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", file]);
  } else if (s.card) {
    run(["-loop", "1", "-t", String(s.len), "-i", join(cards, `${s.card}.png`), "-vf", `${norm},${fades}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", file]);
  } else {
    const input = s.file ?? src;
    const from = s.from ?? 0;
    const span = (s.to ?? from + duration(input)) - from;
    const speed = span / s.len;
    const cap = s.caption ? join(cards, `${s.caption}.png`) : undefined;
    const crop = s.crop ? `crop=${s.crop},` : "";
    const graph = cap
      ? `[0:v]setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${crop}${norm}[v];[v][1:v]overlay=0:0,${fades}[o]`
      : `[0:v]setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${crop}${norm},${fades}[o]`;
    run([
      "-ss", from.toFixed(2), "-t", span.toFixed(2), "-i", input,
      ...(cap ? ["-loop", "1", "-i", cap] : []),
      "-filter_complex", graph, "-map", "[o]", "-t", String(s.len),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", file,
    ]);
    console.log(`${s.name}: ${span.toFixed(1)}s of recording at ${speed.toFixed(1)}x`);
  }
  parts.push(file);
}

const list = join(out, "parts.txt");
await Bun.write(list, parts.map((p) => `file '${p.split("/").pop()}'`).join("\n"));
const final = join(out, "triage-swarm-90s.mp4");
// re-encode the join: image and video segments carry different timebases, and a stream copy drops time at the seams
run(["-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", final]);
console.log(`${final}: ${duration(final).toFixed(1)}s`);
