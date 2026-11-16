/**
 * Generated images: the prompt each one gets, the store of originals and what is due.
 *
 * The store (`<store>/`) holds per image `<id>.png` (the original as the generator made it),
 * `<id>.prompt.txt` (the exact prompt) and `<id>.json` (its reference images by content hash,
 * the generator command, when). An image is due when it has no original, or when its prompt
 * or the content of its references differs from what the stored original was made from.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { GeneratedImage, Resolved } from "./story.js";

const ORIENTATION = {
  landscape: "Landscape image, 3:2 aspect ratio.",
  portrait: "Portrait image, 2:3 aspect ratio.",
};

interface StoredInput {
  path: string;
  sha256: string;
}

export interface StoredManifest {
  image: string;
  promptSha256: string;
  inputs: StoredInput[];
  generator: string[];
  createdAt: string;
  /** Where the original came from: a generator run folder, or the folder `adopt` took it from. */
  source: string;
}

type Status = "new" | "changed" | "current";

export interface ImageState {
  image: GeneratedImage;
  prompt: string;
  /** Absolute paths, in the order they are passed. */
  refs: string[];
  inputs: StoredInput[];
  status: Status;
  /** What differs from the stored original, for `changed`. */
  reason?: string;
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function promptFor(story: Resolved, image: GeneratedImage): string {
  return `${ORIENTATION[image.orientation]} ${image.brief.trim()}\n\n${story.imageStyle.trim()}`;
}

export const storePaths = (story: Resolved, id: string) => ({
  png: join(story.store, `${id}.png`),
  prompt: join(story.store, `${id}.prompt.txt`),
  manifest: join(story.store, `${id}.json`),
});

/** Every generated image with its prompt, its references and whether it is due. Throws if a reference is missing. */
export function imageStates(story: Resolved): ImageState[] {
  const missing: string[] = [];
  const states = story.images.map((image): ImageState => {
    const prompt = promptFor(story, image);
    const refs = (image.refs ?? []).map((r) => resolve(story.root, r));
    const inputs = refs.map((ref) => {
      if (!existsSync(ref)) {
        missing.push(`${image.image}: ${relative(story.root, ref)}`);
        return { path: relative(story.root, ref), sha256: "" };
      }
      return { path: relative(story.root, ref), sha256: sha256(readFileSync(ref)) };
    });
    const paths = storePaths(story, image.image);
    if (!existsSync(paths.png) || !existsSync(paths.manifest)) return { image, prompt, refs, inputs, status: "new" };
    const stored = JSON.parse(readFileSync(paths.manifest, "utf8")) as StoredManifest;
    if (stored.promptSha256 !== sha256(prompt)) return { image, prompt, refs, inputs, status: "changed", reason: "prompt" };
    const was = stored.inputs.map((i) => i.sha256).join();
    if (was !== inputs.map((i) => i.sha256).join()) return { image, prompt, refs, inputs, status: "changed", reason: "references" };
    return { image, prompt, refs, inputs, status: "current" };
  });
  if (missing.length) throw new Error(`storyboard-kit: reference images not found:\n  ${missing.join("\n  ")}`);
  return states;
}

/** A short code over every prompt, reference and the generator's extra flags: what `generate --approved` must be given. Any change makes a new one. */
export function approvalCode(story: Resolved, states: ImageState[]): string {
  const images = states.map((s) => [s.image.image, s.prompt, s.inputs.map((i) => i.sha256)]);
  return sha256(JSON.stringify({ args: story.generator.args, images })).slice(0, 10);
}

/** The Markdown file a person reads before approving the prompts. */
export function promptsMarkdown(story: Resolved, states: ImageState[]): string {
  const code = approvalCode(story, states);
  const due = states.filter((s) => s.status !== "current").length;
  const command = [story.generator.command, '"<prompt>"', "--image <ref>…", "--out <dir>", ...story.generator.args].join(" ");
  const lines = [
    `# ${story.page.title}: image prompts for approval`,
    "",
    `For: ${story.audience}`,
    `Story: \`${story.file}\``,
    "",
    `Approval code: \`${code}\`. Once these prompts are approved, \`storyboard generate ${story.file} --approved ${code}\` runs the ${due} image${due === 1 ? "" : "s"} marked new or changed. Any change to a prompt, a reference image or the generator's flags gives a new code.`,
    "",
    `Each image runs as \`${command}\`.`,
    "",
    "## Shared style (ends every prompt)",
    "",
    story.imageStyle.trim(),
    "",
  ];
  for (const s of states) {
    const status = s.status === "changed" ? `changed (${s.reason})` : s.status === "current" ? "unchanged, stored" : "new";
    lines.push(`## ${s.image.image} (${s.image.orientation} ${s.image.orientation === "landscape" ? "3:2" : "2:3"}) · ${status}`, "");
    lines.push(s.inputs.length ? `Inputs: ${s.inputs.map((i) => `\`${i.path}\``).join(", ")}` : "Inputs: none", "");
    lines.push(`Alt text: ${s.image.alt}`, "");
    lines.push("Prompt:", "", ...s.prompt.split("\n").map((l) => (l ? `> ${l}` : ">")), "");
  }
  return lines.join("\n");
}
