#!/usr/bin/env node
// Stands in for codex-imagegen in the tests: `<prompt> --image <ref>… --out <dir> [flags]`.
// Prints what the real one prints: every image in --out, oldest first, one path a line.
// FAKE_OVERLAP=1: another run's image lands in --out too, as when runs overlap.
// FAKE_FAIL=<text>: exits 3 when the prompt contains it. FAKE_SLEEP=<ms>: waits first.
// Each call is appended to $FAKE_LOG.
import { appendFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const [prompt, ...rest] = process.argv.slice(2);
const images = [];
let out = "";
const flags = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--image") images.push(rest[++i]);
  else if (rest[i] === "--out") out = rest[++i];
  else flags.push(rest[i]);
}
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ prompt, images, out, flags }) + "\n");
if (process.env.FAKE_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLEEP)));
if (process.env.FAKE_FAIL && prompt.includes(process.env.FAKE_FAIL)) {
  console.error("fake generator: asked to fail");
  process.exit(3);
}
const landscape = prompt.startsWith("Landscape");
const [width, height] = landscape ? [300, 200] : [200, 300];
await sharp({ create: { width, height, channels: 3, background: "#00ff00" } }).png().toFile(join(out, "exec-mine.png"));
if (process.env.FAKE_OVERLAP) {
  await new Promise((r) => setTimeout(r, 20));
  await sharp({ create: { width, height, channels: 3, background: "#ff0000" } }).png().toFile(join(out, "exec-other-run.png"));
}
writeFileSync(join(out, "codex-last-message.txt"), "done");
const found = readdirSync(out)
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  .map((f) => join(out, f))
  .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
for (const f of found) console.log(f);
