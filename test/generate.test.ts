import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { adopt, approvalCode, generate, imageStates, promptsMarkdown, resolveStory } from "../dist/index.js";
import { approve, makeProject } from "./fixture.ts";

const calls = (log: string) =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { prompt: string; images: string[]; out: string; flags: string[] });
const quiet = () => {};

/** Runs `body` with environment variables set for the fake generator. */
async function withEnv(vars: Record<string, string>, body: () => Promise<void>) {
  Object.assign(process.env, vars);
  try {
    await body();
  } finally {
    for (const key of Object.keys(vars)) delete process.env[key];
  }
}

test("prompts file lists every prompt with the style block and inputs, and an approval code", async () => {
  const p = await makeProject();
  const story = p.resolved();
  const states = imageStates(story);
  const md = promptsMarkdown(story, states);
  assert.match(md, /Approval code: `[0-9a-f]{10}`/);
  assert.ok(md.includes(approvalCode(story, states)));
  assert.match(md, /## s01-wide \(landscape 3:2\) · new/);
  assert.match(md, /> Landscape image, 3:2 aspect ratio\. A wide view of the market\.\n>\n> Shared style block\./);
  assert.match(md, /Inputs: `refs\/a\.png`, `refs\/b\.png`/);
  assert.match(md, /## s02-tall \(portrait 2:3\)/);
  assert.equal(calls(p.log).length, 0, "writing prompts runs nothing");
});

test("the generator's flags are part of the approval code, but don't make stored images due", async () => {
  const p = await makeProject();
  const story = p.resolved();
  await generate(story, { approved: approve(story), log: quiet });
  const before = approve(story);
  p.story.generator!.args = [];
  const changed = p.resolved();
  assert.notEqual(approve(changed), before);
  assert.deepEqual(imageStates(changed).map((s) => s.status), ["current", "current"]);
  await assert.rejects(generate(changed, { approved: before, log: quiet }), /not the current code/);
});

test("generate refuses without the current approval code", async () => {
  const p = await makeProject();
  const story = p.resolved();
  await assert.rejects(generate(story, { log: quiet }), /refusing to generate: the prompts haven't been approved/);
  await assert.rejects(generate(story, { approved: "0000000000", log: quiet }), /refusing to generate: --approved 0000000000 is not the current code/);
  assert.equal(calls(p.log).length, 0);
  assert.ok(!existsSync(join(story.store, "s01-wide.png")));
});

test("generate runs one at a time by default and stores the image the generator names, with its prompt", async () => {
  const p = await makeProject();
  const story = p.resolved();
  assert.equal(story.generator.concurrency, 1);
  const result = await generate(story, { approved: approve(story), log: quiet });
  assert.deepEqual(result.made, ["s01-wide", "s02-tall"]);
  const runs = calls(p.log);
  assert.equal(runs.length, 2);
  const wide = runs.find((r) => r.prompt.startsWith("Landscape"))!;
  assert.deepEqual(wide.images, [join(p.root, "refs/a.png"), join(p.root, "refs/b.png")]);
  assert.deepEqual(wide.flags, ["--allow-face-changes"]);
  const { data } = await sharp(join(story.store, "s01-wide.png")).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data.subarray(0, 3)], [0, 255, 0]);
  assert.equal(readFileSync(join(story.store, "s01-wide.prompt.txt"), "utf8"), wide.prompt);
  assert.ok(existsSync(join(wide.out, "run.log")), "each run keeps its log beside its output");
  assert.deepEqual(JSON.parse(readFileSync(join(story.store, "s01-wide.json"), "utf8")).inputs.map((i: { path: string }) => i.path), ["refs/a.png", "refs/b.png"]);
});

test("output naming more than one image is ambiguous: nothing is stored", async () => {
  const p = await makeProject();
  const story = p.resolved();
  // As codex-imagegen does when another run's image lands in its folder: both listed, oldest first.
  await withEnv({ FAKE_OVERLAP: "1" }, async () => {
    const result = await generate(story, { approved: approve(story), log: quiet });
    assert.deepEqual(result.made, []);
    assert.deepEqual(result.failed.map((f) => f.image), ["s01-wide", "s02-tall"]);
    assert.match(result.failed[0].error, /ambiguous output: the generator named 2 images/);
  });
  assert.ok(!existsSync(join(story.store, "s01-wide.png")));
  assert.deepEqual(imageStates(story).map((s) => s.status), ["new", "new"]);
});

test("a run that takes too long is stopped and counted as failed", async () => {
  const p = await makeProject();
  p.story.generator!.timeout = 0.3;
  const story = p.resolved();
  await withEnv({ FAKE_SLEEP: "3000" }, async () => {
    const result = await generate(story, { approved: approve(story), log: quiet });
    assert.deepEqual(result.made, []);
    assert.match(result.failed[0].error, /stopped after 0\.3s/);
  });
  assert.ok(!existsSync(join(story.store, "s01-wide.png")));
});

test("a re-run only redoes images whose prompt or references changed", async () => {
  const p = await makeProject();
  let story = p.resolved();
  await generate(story, { approved: approve(story), log: quiet });
  writeFileSync(p.log, "");

  const again = await generate(story, { approved: approve(story), log: quiet });
  assert.deepEqual(again.made, []);
  assert.equal(calls(p.log).length, 0, "nothing changed: the generator isn't run");

  // A new brief for one image: only it is due, and the old approval no longer counts.
  const oldCode = approve(story);
  // story.images holds the story's own picture objects, so this edits the story.
  story.images.find((i) => i.image === "s02-tall")!.brief = "A person at a truck window, smiling.";
  story = p.resolved();
  assert.deepEqual(imageStates(story).map((s) => s.status), ["current", "changed"]);
  await assert.rejects(generate(story, { approved: oldCode, log: quiet }), /not the current code/);
  const brief = await generate(story, { approved: approve(story), log: quiet });
  assert.deepEqual(brief.made, ["s02-tall"]);
  assert.equal(calls(p.log).length, 1);

  // A reference image's content changes: only the image using it (s01 uses b.png) is due.
  writeFileSync(p.log, "");
  await sharp({ create: { width: 40, height: 30, channels: 3, background: "#000000" } }).toFile(join(p.root, "refs/b.png"));
  const states = imageStates(story);
  assert.deepEqual(states.map((s) => [s.image.image, s.status, s.reason]), [["s01-wide", "changed", "references"], ["s02-tall", "current", undefined]]);
  const refs = await generate(story, { approved: approve(story), log: quiet });
  assert.deepEqual(refs.made, ["s01-wide"]);

  // --redo makes one again although nothing changed.
  writeFileSync(p.log, "");
  const redo = await generate(story, { approved: approve(story), redo: ["s02-tall"], log: quiet });
  assert.deepEqual(redo.made, ["s02-tall"]);
  assert.equal(calls(p.log).length, 1);
});

test("a failed run is reported and nothing is stored for it", async () => {
  const p = await makeProject();
  const story = p.resolved();
  await withEnv({ FAKE_FAIL: "truck window" }, async () => {
    const result = await generate(story, { approved: approve(story), log: quiet });
    assert.deepEqual(result.made, ["s01-wide"]);
    assert.equal(result.failed[0].image, "s02-tall");
    assert.match(result.failed[0].error, /exited with 3/);
  });
  assert.ok(!existsSync(join(story.store, "s02-tall.png")));
  assert.equal(imageStates(story)[1].status, "new");
});

test("adopt stores images made earlier only when their prompt is the story's", async () => {
  const p = await makeProject();
  const story = p.resolved();
  const from = join(p.root, "made-earlier");
  mkdirSync(from);
  const states = imageStates(story);
  for (const s of states) {
    await sharp({ create: { width: 30, height: 20, channels: 3, background: "#0000ff" } }).png().toFile(join(from, `${s.image.image}.png`));
    writeFileSync(join(from, `${s.image.image}.txt`), s.prompt + "\n");
  }
  writeFileSync(join(from, "s02-tall.txt"), "Portrait image, 2:3 aspect ratio. Something else.");
  await assert.rejects(adopt(story, { from, prompts: from, log: quiet }), /s02-tall: the story's prompt differs/);
  assert.deepEqual(imageStates(story).map((s) => s.status), ["current", "new"]);
  assert.equal(calls(p.log).length, 0);
});

test("an inset on a screen that shares its scene is rejected, not dropped", async () => {
  const p = await makeProject();
  const scene = p.story.scenes[2];
  assert.ok(!("divider" in scene));
  scene.pictures[0] = { screen: { flow: "demo-flow", step: 1, actor: "customer" }, alt: "Trucks", inset: { screen: { flow: "demo-flow", step: 1, actor: "customer" }, alt: "x" } };
  assert.throws(() => resolveStory(p.story, p.file), /an inset only shows on a screen that is the scene's one picture/);
});
