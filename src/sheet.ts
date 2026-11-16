/** `sheet`: one contact sheet of every stored original, each labelled, for a person to review. */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { imageStates, storePaths } from "./images.js";
import type { Resolved } from "./story.js";

const COLUMNS = 4;
const BOX = 420;
const PAD = 20;
const LABEL = 54;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Writes `<workDir>/review.jpg` and returns its path, with the images that have no original yet. */
export async function reviewSheet(story: Resolved): Promise<{ file: string; missing: string[]; stale: string[] }> {
  const states = imageStates(story);
  const missing = states.filter((s) => s.status === "new").map((s) => s.image.image);
  const stale = states.filter((s) => s.status === "changed").map((s) => s.image.image);
  const shown = states.filter((s) => existsSync(storePaths(story, s.image.image).png));
  if (shown.length === 0) throw new Error("storyboard-kit: no generated images are stored yet: nothing to put on a review sheet");

  const cellW = BOX + PAD;
  const cellH = BOX + LABEL + PAD;
  const rows = Math.ceil(shown.length / COLUMNS);
  const width = PAD + Math.min(COLUMNS, shown.length) * cellW;
  const height = PAD + rows * cellH;
  const { bg, fg, dim } = story.brand.palette;

  const layers = await Promise.all(
    shown.map(async (state, n) => {
      const file = storePaths(story, state.image.image).png;
      const { width: w = 0, height: h = 0 } = await sharp(file).metadata();
      const thumb = await sharp(file).resize(BOX, BOX, { fit: "inside" }).toBuffer({ resolveWithObject: true });
      const x = PAD + (n % COLUMNS) * cellW;
      const y = PAD + Math.floor(n / COLUMNS) * cellH;
      const note = state.status === "changed" ? ` · stale (${state.reason} changed)` : "";
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${LABEL}">` +
          `<text x="0" y="22" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="700" fill="${fg}">${escapeXml(state.image.image)}</text>` +
          `<text x="0" y="45" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="${dim}">${state.image.orientation} · ${w}x${h}${escapeXml(note)}</text>` +
          `</svg>`,
      );
      return [
        { input: thumb.data, left: x + Math.round((BOX - thumb.info.width) / 2), top: y + Math.round((BOX - thumb.info.height) / 2) },
        { input: label, left: x, top: y + BOX + 6 },
      ];
    }),
  );

  mkdirSync(story.workDir, { recursive: true });
  const out = join(story.workDir, "review.jpg");
  await sharp({ create: { width, height, channels: 3, background: bg } })
    .composite(layers.flat())
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  return { file: out, missing, stale };
}
