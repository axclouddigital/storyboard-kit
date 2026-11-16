/**
 * `build`: the story's page in `outDir`: index.html plus `img/` (generated pictures as JPEG),
 * `screens/` (app screens as WebP), `video/`, `fonts/` and the brand's SVG marks. Each picture
 * is sized for the largest it is shown at on a 2x screen. The kit owns those paths: a build
 * replaces them, and leaves anything else in `outDir` alone.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { imageStates, storePaths } from "./images.js";
import { pageHtml, screenKey, type Assets, type Img } from "./page.js";
import { isDivider, isScreen, isVideo, type Resolved, type ScreenRef } from "./story.js";
import { Walkthroughs } from "./walkthroughs.js";

/** Widths written, in pixels: twice the widest each is shown at. */
const WIDTH = { landscape: 1536, portrait: 800, phone: 600, inset: 360, tablet: 1280, poster: 1280 };
/** What a build writes in outDir; everything else there is left alone. */
const OWNED = ["index.html", "mark.svg", "festoon.svg", "img", "screens", "video", "fonts"];

interface BuildOptions {
  /** Build with an empty panel where a generated image has no original yet (a draft); otherwise that fails. */
  allowMissing?: boolean;
  log?: (line: string) => void;
}

async function resized(from: string, to: string, width: number, format: "jpeg" | "webp", src: string): Promise<Img> {
  const pipeline = sharp(from).resize({ width, withoutEnlargement: true });
  const out = await (format === "jpeg" ? pipeline.jpeg({ quality: 80, mozjpeg: true }) : pipeline.webp({ quality: 82 })).toFile(to);
  return { src, width: out.width, height: out.height };
}

async function svg(from: string, outDir: string, name: string, base: string): Promise<Img> {
  copyFileSync(from, join(outDir, name));
  const { width = 0, height = 0 } = await sharp(from).metadata();
  return { src: `${base}/${name}`, width, height };
}

export async function build(story: Resolved, options: BuildOptions = {}): Promise<{ file: string; missingImages: string[] }> {
  const log = options.log ?? console.log;
  const { outDir, base } = story;

  // Find everything first, so one run reports every missing piece.
  const walks = new Walkthroughs(story.walkthroughs, story.root);
  const screens: { ref: ScreenRef; inset: boolean; file: string }[] = [];
  const videoIds = new Set<string>();
  for (const scene of story.scenes) {
    if (isDivider(scene)) continue;
    for (const p of scene.pictures) {
      if (isScreen(p)) {
        for (const [ref, inset] of [[p.screen, false], ...(p.inset ? [[p.inset.screen, true]] : [])] as [ScreenRef, boolean][]) {
          const file = walks.screen(ref);
          if (file) screens.push({ ref, inset, file });
        }
      }
      if (isVideo(p)) videoIds.add(p.video);
    }
  }
  if (story.offer.video) videoIds.add(story.offer.video.flow);
  const videos = [...videoIds].map((id) => ({ id, files: walks.video(id) }));
  const states = imageStates(story);
  const missingImages = states.filter((s) => !existsSync(storePaths(story, s.image.image).png)).map((s) => s.image.image);
  const problems = [...walks.missing];
  if (missingImages.length && !options.allowMissing) {
    problems.push(`no stored original for ${missingImages.join(", ")}: run generate (or build --allow-missing for a draft)`);
  }
  for (const font of story.brand.fonts ? [story.brand.fonts.heading, story.brand.fonts.body] : []) {
    if (!existsSync(font.file)) problems.push(`font file not found: ${font.file}`);
  }
  for (const file of [story.brand.mark, story.brand.festoon]) if (file && !existsSync(file)) problems.push(`brand file not found: ${file}`);
  if (problems.length) throw new Error(`storyboard-kit: can't build ${story.file}:\n  ${problems.join("\n  ")}`);
  for (const s of states.filter((s) => s.status === "changed")) log(`  note: ${s.image.image}'s ${s.reason} changed since its original was made; generate makes a new one`);

  // Everything is written to a staging folder first and moved into outDir only once it all
  // exists, so a build that fails part way leaves the page that was there.
  const stage = join(story.workDir, "build");
  rmSync(stage, { recursive: true, force: true });
  for (const dir of ["img", "screens", "video", "fonts"]) mkdirSync(join(stage, dir), { recursive: true });

  const assets: Assets = { generated: new Map(), screens: new Map(), videos: new Map(), fonts: null, mark: null, festoon: null };
  await Promise.all([
    ...states
      .filter((s) => !missingImages.includes(s.image.image))
      .map(async (s) => {
        const id = s.image.image;
        const img = await resized(storePaths(story, id).png, join(stage, "img", `${id}.jpg`), WIDTH[s.image.orientation], "jpeg", `${base}/img/${id}.jpg`);
        assets.generated.set(id, img);
      }),
    ...screens.map(async ({ ref, inset, file }) => {
      const { width = 0, height = 0 } = await sharp(file).metadata();
      const tablet = width > height;
      const name = `${ref.flow}-${String(ref.step).padStart(2, "0")}-${ref.actor}${inset ? "-inset" : ""}.webp`;
      const img = await resized(file, join(stage, "screens", name), inset ? WIDTH.inset : tablet ? WIDTH.tablet : WIDTH.phone, "webp", `${base}/screens/${name}`);
      assets.screens.set(screenKey(ref, inset), { ...img, tablet });
    }),
    ...videos.map(async ({ id, files }) => {
      const { video, poster } = files!;
      copyFileSync(video, join(stage, "video", `${id}${extname(video)}`));
      const { width = 0, height = 0 } = await sharp(poster).metadata();
      const posterImg = await resized(poster, join(stage, "video", `${id}.jpg`), WIDTH.poster, "jpeg", `${base}/video/${id}.jpg`);
      assets.videos.set(id, { src: `${base}/video/${id}${extname(video)}`, poster: posterImg.src, width, height });
    }),
    (async () => {
      if (story.brand.mark) assets.mark = await svg(story.brand.mark, stage, "mark.svg", base);
      if (story.brand.festoon) assets.festoon = await svg(story.brand.festoon, stage, "festoon.svg", base);
    })(),
  ]);
  const fonts = story.brand.fonts;
  if (fonts) {
    const copy = (font: typeof fonts.heading) => {
      copyFileSync(font.file, join(stage, "fonts", basename(font.file)));
      return { href: `${base}/fonts/${basename(font.file)}`, weight: font.weight, ext: extname(font.file).slice(1).toLowerCase() };
    };
    assets.fonts = { heading: copy(fonts.heading), body: copy(fonts.body) };
  }

  writeFileSync(join(stage, "index.html"), pageHtml(story, assets));

  mkdirSync(outDir, { recursive: true });
  for (const path of OWNED) {
    rmSync(join(outDir, path), { recursive: true, force: true });
    if (!existsSync(join(stage, path))) continue;
    try {
      renameSync(join(stage, path), join(outDir, path));
    } catch (error) {
      // The work folder may sit on another disk.
      if (!(error instanceof Error && "code" in error && error.code === "EXDEV")) throw error;
      cpSync(join(stage, path), join(outDir, path), { recursive: true });
    }
  }
  rmSync(stage, { recursive: true, force: true });
  const file = join(outDir, "index.html");
  if (missingImages.length) log(`  draft: no original yet for ${missingImages.join(", ")} (empty panels)`);
  return { file, missingImages };
}
