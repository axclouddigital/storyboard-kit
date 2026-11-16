/**
 * `generate`: runs the image generator for every image that is due (one at a time unless the
 * story says otherwise) and stores each original with the prompt that made it. `adopt`: stores
 * images made earlier by hand, checking each against the prompt that made it.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { approvalCode, imageStates, sha256, storePaths, type ImageState, type StoredManifest } from "./images.js";
import type { Resolved } from "./story.js";

const IMAGE = /\.(png|jpe?g|webp)$/i;

interface GenerateOptions {
  /** The approval code from the prompts file. Without the current one nothing runs. */
  approved?: string;
  /** Images to make again although nothing changed (a result nobody liked). */
  redo?: string[];
  log?: (line: string) => void;
}

interface GenerateResult {
  made: string[];
  failed: { image: string; error: string }[];
  skipped: string[];
}

/** Saves an original and what made it. Each file is written beside its place and renamed in, the manifest last: an interrupted write leaves the image due. */
async function store(story: Resolved, state: ImageState, file: string, generator: string[], source: string) {
  const paths = storePaths(story, state.image.image);
  mkdirSync(story.store, { recursive: true });
  const tmp = (path: string) => `${path}.${process.pid}.tmp`;
  if (extname(file).toLowerCase() === ".png") copyFileSync(file, tmp(paths.png));
  else await sharp(file).png().toFile(tmp(paths.png));
  renameSync(tmp(paths.png), paths.png);
  writeFileSync(tmp(paths.prompt), state.prompt);
  renameSync(tmp(paths.prompt), paths.prompt);
  const manifest: StoredManifest = {
    image: state.image.image,
    promptSha256: sha256(state.prompt),
    inputs: state.inputs,
    generator,
    createdAt: new Date().toISOString(),
    source,
  };
  writeFileSync(tmp(paths.manifest), JSON.stringify(manifest, null, 2) + "\n");
  renameSync(tmp(paths.manifest), paths.manifest);
}

/** Warns when the generator ignored the orientation; the page crops to the slot either way. */
async function orientationWarning(state: ImageState, file: string): Promise<string | null> {
  const { width = 0, height = 0 } = await sharp(file).metadata();
  const landscape = width > height;
  if (landscape === (state.image.orientation === "landscape")) return null;
  return `${state.image.image}: asked for ${state.image.orientation}, got ${width}x${height}`;
}

function runOnce(command: string, args: string[], logFile: string, timeoutSec: number): Promise<{ code: number; stdout: string; timedOut: boolean }> {
  const { promise, resolve: done, reject: fail } = Promise.withResolvers<{ code: number; stdout: string; timedOut: boolean }>();
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutSec * 1000);
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
  child.on("error", (error: NodeJS.ErrnoException) => {
    clearTimeout(timer);
    fail(error.code === "ENOENT" || error.code === "EACCES" ? new Error(`can't run the generator ${command}: ${error.code}`) : error);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    writeFileSync(
      logFile,
      `$ ${command} ${args.map((a) => JSON.stringify(a)).join(" ")}\n${timedOut ? `\n(stopped after ${timeoutSec}s)\n` : ""}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`,
    );
    done({ code: code ?? 1, stdout, timedOut });
  });
  return promise;
}

export async function generate(story: Resolved, options: GenerateOptions = {}): Promise<GenerateResult> {
  const log = options.log ?? console.log;
  const states = imageStates(story);
  const code = approvalCode(story, states);
  if (options.approved !== code) {
    const why = options.approved ? `--approved ${options.approved} is not the current code (the prompts or references changed since)` : "the prompts haven't been approved";
    throw new Error(
      `storyboard-kit: refusing to generate: ${why}. Run \`storyboard prompts ${story.file}\`, have the prompts file read and approved, then pass the approval code it shows: --approved <code>.`,
    );
  }
  const redo = new Set(options.redo ?? []);
  for (const id of redo) if (!states.some((s) => s.image.image === id)) throw new Error(`storyboard-kit: --redo ${id}: no such image in the story`);
  const due = states.filter((s) => s.status !== "current" || redo.has(s.image.image));
  const skipped = states.filter((s) => !due.includes(s)).map((s) => s.image.image);
  if (due.length === 0) {
    log(`Nothing to generate: all ${states.length} images are stored and current.`);
    return { made: [], failed: [], skipped };
  }
  log(`Generating ${due.length} of ${states.length} images, ${story.generator.concurrency} at a time.`);

  const result: GenerateResult = { made: [], failed: [], skipped };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const queue = [...due];
  const worker = async () => {
    for (let state = queue.shift(); state; state = queue.shift()) {
      const id = state.image.image;
      const dir = join(story.workDir, "runs", `${stamp}-${id}`);
      mkdirSync(dir, { recursive: true });
      const args = [state.prompt, ...state.refs.flatMap((r) => ["--image", r]), "--out", dir, ...story.generator.args];
      log(`  ${id}: ${state.status === "current" ? "redo" : state.status}…`);
      try {
        const runLog = relative(story.root, join(dir, "run.log"));
        const { code, stdout, timedOut } = await runOnce(story.generator.command, args, join(dir, "run.log"), story.generator.timeout);
        if (timedOut) throw new Error(`the generator was stopped after ${story.generator.timeout}s; see ${runLog}`);
        if (code !== 0) throw new Error(`the generator exited with ${code}; see ${runLog}`);
        // codex-imagegen lists every new image in its --out folder, and a run beside it (from this
        // or any other process) can put its image there too. Only an output naming exactly one
        // image is known to be this run's; anything else is stored nowhere.
        const listed = stdout.split("\n").map((l) => l.trim()).filter((l) => IMAGE.test(l));
        if (listed.length === 0) throw new Error(`the generator named no image file; see ${runLog}`);
        if (listed.length > 1) throw new Error(`ambiguous output: the generator named ${listed.length} images, so which is this run's is unknown; nothing stored (see ${runLog})`);
        const file = resolve(dir, listed[0]);
        if (!existsSync(file)) throw new Error(`the generator named ${listed[0]}, which doesn't exist`);
        const warning = await orientationWarning(state, file);
        if (warning) log(`  warning: ${warning}`);
        await store(story, state, file, [story.generator.command, ...story.generator.args], relative(story.root, dir));
        result.made.push(id);
        log(`  ${id}: stored`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({ image: id, error: message });
        log(`  ${id}: failed: ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(story.generator.concurrency, due.length) }, worker));
  return result;
}

interface AdoptOptions {
  /** Folder of finished images named `<id>.png`. */
  from: string;
  /** Folder of the prompts that made them, `<id>.txt`. Each must equal the prompt the story gives now. */
  prompts: string;
  log?: (line: string) => void;
}

/** Stores images made outside the kit, so `generate` counts them as current. Refuses one whose prompt differs from the story's. */
export async function adopt(story: Resolved, options: AdoptOptions): Promise<string[]> {
  const log = options.log ?? console.log;
  const adopted: string[] = [];
  const problems: string[] = [];
  for (const state of imageStates(story)) {
    const id = state.image.image;
    const png = join(options.from, `${id}.png`);
    const txt = join(options.prompts, `${id}.txt`);
    if (!existsSync(png)) {
      log(`  ${id}: no ${id}.png in ${options.from}, skipped`);
      continue;
    }
    if (!existsSync(txt)) {
      problems.push(`${id}: no ${id}.txt in ${options.prompts}`);
      continue;
    }
    if (readFileSync(txt, "utf8").trim() !== state.prompt.trim()) {
      problems.push(`${id}: the story's prompt differs from ${txt}`);
      continue;
    }
    await store(story, state, png, ["adopted"], options.from);
    adopted.push(id);
    log(`  ${id}: stored`);
  }
  if (problems.length) throw new Error(`storyboard-kit: not adopted:\n  ${problems.join("\n  ")}`);
  return adopted;
}
