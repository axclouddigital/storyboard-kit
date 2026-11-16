/** What a story file says (`defineStory`), and the paths and defaults the commands work from. */
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

/** A font file copied next to the page. */
interface FontFile {
  /** Path to a .woff2, .woff, .ttf or .otf file; relative paths are taken from `root`. */
  file: string;
  /** The `font-weight` range of a variable font, e.g. `"200 800"`. Leave out for a single-weight file. */
  weight?: string;
}

/** The page's colours (dark). Six-digit hex. The same keys as walkthrough-kit's palette. */
interface Palette {
  /** Page background; also the text on the primary button. */
  bg: string;
  fg: string;
  /** Panels: the offer blocks, a picture's slot before it loads. */
  card: string;
  /** The ring around the device frames. */
  muted: string;
  /** Secondary text: the sub line, notes, captions, the footer. */
  dim: string;
  line: string;
  /** Kicker, block titles, the divider label, links, the primary button. */
  accent: string;
  /** Unused by the page; accepted so a walkthrough-kit brand block fits as is. */
  printAccent: string;
}

interface Brand {
  /** The product's name: "Brewline". The link preview's site name. */
  name: string;
  /** The name as the logo writes it: "brewline". */
  wordmark: string;
  /** The tail of the wordmark drawn in the accent colour: "line". */
  wordmarkAccent?: string;
  /** Without them the page falls back to the system sans-serif. */
  fonts?: { heading: FontFile; body: FontFile };
  palette?: Partial<Palette>;
  /** An SVG drawn before the wordmark. */
  mark?: string;
  /** A wide, short SVG strip (the header's string of lights), repeated at the divider. */
  festoon?: string;
}

/** A picture made by the image generator from `brief` plus the story's `imageStyle`. */
export interface GeneratedImage {
  /** File name without extension, unique in the story: "s01-foreshore". */
  image: string;
  orientation: "landscape" | "portrait";
  /** What the picture shows. The prompt is the orientation line, this brief, a blank line and the style block. */
  brief: string;
  /** Images passed to the generator with `--image`, relative to `root`. A change to one of them makes the picture due again. */
  refs?: string[];
  alt: string;
  /** The line under the picture in a `moments` scene. */
  caption?: string;
}

/** One screenshot from a walkthrough-kit recording: `<walkthroughs>/<flow>/flow.json`, step `step`, screen `actor`. */
export interface ScreenRef {
  flow: string;
  step: number;
  /** The actor's slug as walkthrough-kit writes it: "customer", "cart-kitchen". */
  actor: string;
}

/** A real app screen, framed as a phone (portrait) or a tablet (landscape). */
export interface Screen {
  screen: ScreenRef;
  alt: string;
  /** A smaller phone overlapping this one's corner. */
  inset?: { screen: ScreenRef; alt: string };
}

/** A walkthrough-kit flow's video, with its poster. */
interface Video {
  /** The flow id: `<walkthroughs>/<flow>/<flow>.mp4`. */
  video: string;
  caption?: string;
}

export type Picture = GeneratedImage | Screen | Video;

/** A list in a scene's body: bullets, or numbered steps. */
interface List {
  list: string[];
  numbered?: boolean;
}

export interface Scene {
  heading: string;
  /** One paragraph, or several paragraphs and lists in order. */
  body?: string | (string | List)[];
  /** A smaller line after the body. */
  small?: string;
  /**
   * `split` (default): pictures and words side by side on wide screens, alternating sides; up to
   * three pictures. `full`: one picture across the whole width, words below. `moments`: words,
   * then a row of pictures each with its `caption`.
   */
  layout?: "split" | "full" | "moments";
  pictures: Picture[];
}

/** The turn between "now" and "with the product": the lights strip and a label. */
export interface Divider {
  divider: string;
}

interface Action {
  label: string;
  href: string;
  /** A line under the button. Left out on a `mailto:` link, the address shows there instead. */
  note?: string;
}

/** The closing section: the offer, the video and the buttons. */
interface Offer {
  /** A generated picture above the heading. */
  picture?: GeneratedImage;
  heading: string;
  intro?: string;
  /** Short blocks, two across on wide screens: a list or a single line each. */
  blocks: { title: string; items?: string[]; text?: string }[];
  /** Small print under the blocks. */
  fine?: string;
  video?: { flow: string; heading: string; caption: string };
  /** The first is the primary button. */
  actions: Action[];
}

export interface Page {
  /** `<title>` and the link preview's title. */
  title: string;
  description: string;
  /** Where the page will live; its path prefixes every asset ("/market/img/…"). */
  url: string;
  /** The generated image (by `image` id) that link previews show. */
  image: string;
  imageAlt: string;
  /** Default `en-AU`. */
  lang?: string;
  /** Site paths of the favicon and the Apple touch icon, if the site has them. */
  icon?: string;
  appleTouchIcon?: string;
}

interface Generator {
  /** An executable called as `<command> "<prompt>" --image <ref>… --out <dir> <args…>` that prints the path of the image it made. Default: codex-imagegen. */
  command?: string;
  /** Extra flags, e.g. `["--allow-face-changes"]` when the people are invented. Part of the approval code. */
  args?: string[];
  /** Runs at once. Default 1: codex-imagegen can't tell its own image from one made beside it. */
  concurrency?: number;
  /** Seconds before a run is stopped and counted as failed. Default 900. */
  timeout?: number;
}

export interface Story {
  /** The project's root; every relative path below starts here. */
  root: string;
  /** Who the page is for, in a line: on the prompts file and in the page's source. */
  audience: string;
  brand: Brand;
  page: Page;
  /** The finished page: index.html and its assets. The kit replaces what it writes there on each build. */
  outDir: string;
  /** walkthrough-kit's output folder, where screens and videos are taken from. */
  walkthroughs: string;
  /** Generated originals with their prompts. Default: `originals/` beside the story file. Git-ignore it. */
  store?: string;
  /** Prompts file, review sheet, generator runs and check screenshots. Default: `test-results/storyboard/<id>`. */
  workDir?: string;
  /** Appended to every brief: the look all the generated pictures share. */
  imageStyle: string;
  generator?: Generator;
  header: { kicker: string; title: string; sub?: string };
  scenes: (Scene | Divider)[];
  offer: Offer;
  footer: string[];
  check?: {
    /** Text that must not appear on the page or in its HTML (a phone number, say). */
    forbidden?: RegExp;
  };
}

/** Types a story file's default export. */
export function defineStory(story: Story): Story {
  return story;
}

const DEFAULT_GENERATOR = join(homedir(), ".agents/skills/codex-imagegen/scripts/codex-imagegen.py");

const DEFAULT_PALETTE: Palette = {
  bg: "#111113",
  fg: "#f4f4f5",
  card: "#1c1c1f",
  muted: "#27272a",
  dim: "#a1a1aa",
  line: "#3f3f46",
  accent: "#f59e0b",
  printAccent: "#b45309",
};

export const isGenerated = (p: Picture): p is GeneratedImage => "image" in p;
export const isScreen = (p: Picture): p is Screen => "screen" in p;
export const isVideo = (p: Picture): p is Video => "video" in p;
export const isDivider = (s: Scene | Divider): s is Divider => "divider" in s;

export interface Resolved extends Omit<Story, "brand" | "generator" | "store" | "workDir"> {
  id: string;
  /** The story file, relative to root. */
  file: string;
  brand: Omit<Brand, "palette" | "fonts"> & { palette: Palette; fonts: { heading: FontFile; body: FontFile } | null };
  generator: Required<Generator>;
  store: string;
  workDir: string;
  /** The page's URL path without a trailing slash: "/market". */
  base: string;
  images: GeneratedImage[];
}

/** Fills in defaults, makes paths absolute and rejects what would build a broken page. */
export function resolveStory(story: Story, file: string): Resolved {
  const fail = (message: string): never => {
    throw new Error(`storyboard-kit: ${message} (${file})`);
  };
  const root = resolve(story.root);
  const id = basename(dirname(file));
  const palette = { ...DEFAULT_PALETTE, ...story.brand.palette };
  for (const [name, value] of Object.entries(palette)) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) fail(`brand.palette.${name} must be a six-digit hex colour, got "${value}"`);
  }
  let url: URL;
  try {
    url = new URL(story.page.url);
  } catch {
    return fail(`page.url isn't an absolute URL: "${story.page.url}"`);
  }

  const images: GeneratedImage[] = [];
  const pictures = [...story.scenes.flatMap((s) => (isDivider(s) ? [] : s.pictures)), ...(story.offer.picture ? [story.offer.picture] : [])];
  for (const p of pictures) {
    if (!isGenerated(p)) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.image)) fail(`image "${p.image}": use lower-case letters, digits and hyphens`);
    if (images.some((i) => i.image === p.image)) fail(`image "${p.image}" appears twice`);
    images.push(p);
  }
  if (!images.some((i) => i.image === story.page.image)) fail(`page.image "${story.page.image}" isn't one of the story's generated images`);
  story.scenes.forEach((scene, n) => {
    if (isDivider(scene)) return;
    const where = `scene ${n + 1} ("${scene.heading}")`;
    const layout = scene.layout ?? "split";
    if (scene.pictures.length === 0) fail(`${where} has no pictures`);
    if (layout === "full" && (scene.pictures.length !== 1 || !isGenerated(scene.pictures[0]))) fail(`${where}: a full scene takes one generated image`);
    if (layout === "moments" && scene.pictures.some((p) => !isGenerated(p) || !p.caption)) fail(`${where}: every picture in a moments scene is a generated image with a caption`);
    if (layout === "split" && scene.pictures.length > 3) fail(`${where}: a split scene takes one to three pictures`);
    if (scene.pictures.length > 1 && scene.pictures.some((p) => isScreen(p) && p.inset)) fail(`${where}: an inset only shows on a screen that is the scene's one picture`);
  });

  const outDir = resolve(root, story.outDir);
  if (outDir === root || !outDir.startsWith(root + "/")) fail(`outDir must be a folder inside root, got "${story.outDir}"`);
  const fonts = story.brand.fonts;
  return {
    ...story,
    id,
    root,
    file: relative(root, file),
    outDir,
    walkthroughs: resolve(root, story.walkthroughs),
    store: story.store ? resolve(root, story.store) : join(dirname(file), "originals"),
    workDir: resolve(root, story.workDir ?? `test-results/storyboard/${id}`),
    base: url.pathname.replace(/\/+$/, ""),
    images,
    generator: {
      command: story.generator?.command ? resolve(root, story.generator.command) : DEFAULT_GENERATOR,
      args: story.generator?.args ?? [],
      concurrency: Math.max(1, story.generator?.concurrency ?? 1),
      timeout: story.generator?.timeout ?? 900,
    },
    brand: {
      ...story.brand,
      palette,
      mark: story.brand.mark && resolve(root, story.brand.mark),
      festoon: story.brand.festoon && resolve(root, story.brand.festoon),
      fonts: fonts
        ? { heading: { ...fonts.heading, file: resolve(root, fonts.heading.file) }, body: { ...fonts.body, file: resolve(root, fonts.body.file) } }
        : null,
    },
  };
}

/** A story path on the command line: the file, or the folder holding `story.ts`. */
function storyFile(path: string): string {
  const full = resolve(path);
  if (existsSync(full) && statSync(full).isDirectory()) return join(full, "story.ts");
  return full;
}

/** Imports a story file (Node strips the TypeScript types itself). */
export async function loadStory(path: string): Promise<Resolved> {
  const file = storyFile(path);
  if (!existsSync(file)) throw new Error(`storyboard-kit: no story file at ${file}`);
  // The story file is named on the command line, so its path is only known at run time.
  const mod = (await import(pathToFileURL(file).href)) as { default?: Story };
  if (!mod.default) throw new Error(`storyboard-kit: ${file} has no default export (export default defineStory({ … }))`);
  return resolveStory(mod.default, file);
}
