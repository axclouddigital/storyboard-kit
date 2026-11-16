/** A throwaway project for the tests: reference images, a walkthrough recording and a story using the fake generator. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { approvalCode, imageStates, resolveStory, type Story } from "../dist/index.js";
import type { Resolved } from "../dist/story.js";

export const FAKE = join(import.meta.dirname, "fake-generator.mjs");

/** The current approval code: what a person approving the prompts would pass. */
export const approve = (story: Resolved) => approvalCode(story, imageStates(story));

const solid = (file: string, width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).toFile(file);

export async function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "storyboard-kit-"));
  for (const dir of ["refs", "walk/demo-flow/steps", "stories/demo", "brand"]) mkdirSync(join(root, dir), { recursive: true });
  await solid(join(root, "refs/a.png"), 40, 30, "#336699");
  await solid(join(root, "refs/b.png"), 40, 30, "#996633");
  await solid(join(root, "walk/demo-flow/steps/01-customer.jpg"), 786, 1704, "#222222");
  await solid(join(root, "walk/demo-flow/steps/02-kitchen.jpg"), 1920, 1200, "#333333");
  await solid(join(root, "walk/demo-flow/poster.jpg"), 1920, 1080, "#111111");
  writeFileSync(join(root, "walk/demo-flow/demo-flow.mp4"), "not really a video");
  writeFileSync(
    join(root, "walk/demo-flow/flow.json"),
    JSON.stringify({
      video: "demo-flow.mp4",
      poster: "poster.jpg",
      steps: [
        { n: 1, caption: "Trucks", shots: [{ actor: "customer", file: "steps/01-customer.jpg" }] },
        { n: 2, caption: "Kitchen", shots: [{ actor: "kitchen", file: "steps/02-kitchen.jpg" }] },
      ],
    }),
  );
  writeFileSync(join(root, "brand/mark.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 94 52" width="94" height="52"><rect width="94" height="52" fill="#ffb547"/></svg>`);
  const log = join(root, "calls.jsonl");
  writeFileSync(log, "");
  process.env.FAKE_LOG = log;

  const story: Story = {
    root,
    audience: "Test readers",
    brand: { name: "Demo", wordmark: "demoapp", wordmarkAccent: "app", mark: "brand/mark.svg", palette: { bg: "#141110", accent: "#ffb547" } },
    page: { title: "A demo night", description: "A test page.", url: "https://example.test/demo", image: "s01-wide", imageAlt: "A wide view" },
    outDir: "public/demo",
    walkthroughs: "walk",
    imageStyle: "Shared style block.",
    generator: { command: FAKE, args: ["--allow-face-changes"] },
    header: { kicker: "For testers", title: "A demo night.", sub: "Two minutes to scroll." },
    scenes: [
      {
        heading: "The wide view.",
        body: "A line of body copy.",
        layout: "full",
        pictures: [{ image: "s01-wide", orientation: "landscape", brief: "A wide view of the market.", refs: ["refs/a.png", "refs/b.png"], alt: "A wide view" }],
      },
      { divider: "The same night, with Demo" },
      {
        heading: "On the phone.",
        body: "The app.",
        pictures: [
          { screen: { flow: "demo-flow", step: 1, actor: "customer" }, alt: "The trucks list" },
          { image: "s02-tall", orientation: "portrait", brief: "A person at a truck window.", refs: ["refs/a.png"], alt: "At the window" },
        ],
      },
      { heading: "In the kitchen.", pictures: [{ screen: { flow: "demo-flow", step: 2, actor: "kitchen" }, alt: "The kitchen board" }] },
    ],
    offer: {
      heading: "A free trial.",
      intro: "I do the work.",
      blocks: [{ title: "What I do", items: ["Set up", "Take down"] }, { title: "The one thing I need", text: "Your OK." }],
      fine: "Small print.",
      video: { flow: "demo-flow", heading: "One order", caption: "A caption." },
      actions: [
        { label: "Try the demo", href: "https://example.test/?src=page", note: "Nothing is charged." },
        { label: "Email me", href: "mailto:someone@example.test" },
      ],
    },
    footer: ["Someone · Somewhere"],
    check: { forbidden: /\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/ },
  };
  const file = join(root, "stories/demo/story.ts");
  return { root, log, story, file, resolved: () => resolveStory(story, file) };
}
