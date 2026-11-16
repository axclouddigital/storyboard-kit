import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build, check, generate, reviewSheet } from "../dist/index.js";
import { approve, makeProject } from "./fixture.ts";

const quiet = () => {};

async function generated() {
  const p = await makeProject();
  const story = p.resolved();
  await generate(story, { approved: approve(story), log: quiet });
  return { ...p, story };
}

test("a missing screen fails the build, naming the flow, step and actor", async () => {
  const p = await generated();
  p.story.scenes.push({ heading: "Extra.", pictures: [{ screen: { flow: "demo-flow", step: 2, actor: "customer" }, alt: "x" }] });
  p.story.scenes.push({ heading: "More.", pictures: [{ screen: { flow: "no-such-flow", step: 1, actor: "customer" }, alt: "x" }] });
  await assert.rejects(build(p.resolved(), { log: quiet }), (error: Error) => {
    assert.match(error.message, /flow "demo-flow" step 2 \("Kitchen"\) has no screenshot of "customer" \(recorded: kitchen\)/);
    assert.match(error.message, /flow "no-such-flow": no recording at walk\/no-such-flow\/flow\.json/);
    return true;
  });
});

test("a generated image without an original fails the build unless it is a draft", async () => {
  const p = await makeProject();
  await assert.rejects(build(p.resolved(), { log: quiet }), /no stored original for s01-wide, s02-tall/);
  const draft = await build(p.resolved(), { allowMissing: true, log: quiet });
  assert.deepEqual(draft.missingImages, ["s01-wide", "s02-tall"]);
});

test("build writes a static page with its assets, tags and preview metadata", async () => {
  const p = await generated();
  const story = p.resolved();
  const { file } = await build(story, { log: quiet });
  const html = readFileSync(file, "utf8");
  for (const needle of [
    '<meta name="robots" content="noindex">',
    "<title>A demo night</title>",
    '<meta property="og:url" content="https://example.test/demo">',
    '<meta property="og:image" content="https://example.test/demo/img/s01-wide.jpg">',
    '<figure class="media pic land bleed">',
    'fetchpriority="high"',
    '<img src="/demo/screens/demo-flow-01-customer.webp" width="600" height="1301" loading="lazy" alt="The trucks list">',
    '<figure class="tablet">',
    '<div class="media pair">',
    "@media (prefers-reduced-motion: no-preference)",
    'demo<b>app</b>',
    '<a class="address" href="mailto:someone@example.test">someone@example.test</a>',
  ]) {
    assert.ok(html.includes(needle), `index.html has ${needle}`);
  }
  assert.equal(html.match(/<span class="tag">Illustration<\/span>/g)?.length, 2);
  assert.equal(html.match(/loading="lazy"/g)?.length, 3, "everything after the first picture loads lazily");
  for (const asset of ["img/s01-wide.jpg", "img/s02-tall.jpg", "screens/demo-flow-02-kitchen.webp", "video/demo-flow.mp4", "video/demo-flow.jpg", "mark.svg"]) {
    assert.ok(existsSync(join(story.outDir, asset)), asset);
  }
});

test("sheet labels every stored original", async () => {
  const p = await generated();
  const { file, missing } = await reviewSheet(p.resolved());
  assert.ok(existsSync(file));
  assert.deepEqual(missing, []);
});

test("check passes a sound page and catches forbidden text", async () => {
  const p = await generated();
  await build(p.resolved(), { log: quiet });
  const ok = await check(p.resolved());
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.screenshots.length, 2);
  for (const shot of ok.screenshots) assert.ok(existsSync(shot));

  p.story.footer.push("Call 0412 345 678");
  await build(p.resolved(), { log: quiet });
  const bad = await check(p.resolved());
  assert.ok(bad.failures.some((f) => /forbidden text "0412 345 678"/.test(f)), bad.failures.join("\n"));
});

test("check catches sideways scroll on a phone, words hidden by a parent and a missing video", async () => {
  const p = await generated();
  const story = p.resolved();
  const { file } = await build(story, { log: quiet });
  const html = readFileSync(file, "utf8")
    .replace("</head>", "<style>body { overflow-x: visible; } .offer .blocks { opacity: 0; }</style>\n</head>")
    .replace("</footer>", `</footer>\n<div style="width: 700px; height: 10px"></div>`);
  writeFileSync(file, html);
  rmSync(join(story.outDir, "video/demo-flow.mp4"));
  const { failures } = await check(story);
  assert.ok(failures.some((f) => /^phone: the page scrolls sideways \(\d+px wide on a 390px screen\)/.test(f)), failures.join("\n"));
  assert.ok(failures.some((f) => /^without JavaScript: \d+ text element\(s\) are hidden/.test(f)), failures.join("\n"));
  assert.ok(failures.some((f) => /video didn't load: 404 \/demo\/video\/demo-flow\.mp4/.test(f)), failures.join("\n"));
});

test("a build that fails part way leaves the page that was there", async () => {
  const p = await generated();
  const story = p.resolved();
  const { file } = await build(story, { log: quiet });
  const before = readFileSync(file, "utf8");
  writeFileSync(join(story.store, "s02-tall.png"), "not an image");
  await assert.rejects(build(story, { log: quiet }));
  assert.equal(readFileSync(file, "utf8"), before);
  assert.ok(existsSync(join(story.outDir, "img/s01-wide.jpg")));
  assert.ok(existsSync(join(story.outDir, "img/s02-tall.jpg")));
});

test("the audience line can't end the comment it sits in", async () => {
  const p = await makeProject();
  p.story.audience = "Owners -- and organisers --> of the market";
  const html = readFileSync((await build(p.resolved(), { allowMissing: true, log: quiet })).file, "utf8");
  const opening = html.slice(html.indexOf("<!--") + 4, html.indexOf("-->"));
  assert.ok(opening.includes("Owners - - and organisers - -> of the market"), opening);
  assert.ok(!opening.includes("--"));
});

test("lists in a scene, three pictures in a split and a picture above the offer", async () => {
  const p = await makeProject();
  const kitchen = p.story.scenes[3];
  assert.ok(!("divider" in kitchen));
  kitchen.body = ["Before.", { list: ["One", "Two"] }, { list: ["First", "Second"], numbered: true }];
  kitchen.pictures.push({ screen: { flow: "demo-flow", step: 1, actor: "customer" }, alt: "Trucks" });
  kitchen.pictures.push({ image: "s03-tall", orientation: "portrait", brief: "A third.", alt: "A third picture" });
  p.story.offer.picture = { image: "s04-after", orientation: "landscape", brief: "After close.", alt: "After close" };
  const story = p.resolved();
  assert.deepEqual(story.images.map((i) => i.image), ["s01-wide", "s02-tall", "s03-tall", "s04-after"]);
  await generate(story, { approved: approve(story), log: quiet });
  const html = readFileSync((await build(story, { log: quiet })).file, "utf8");
  assert.match(html, /<p>Before\.<\/p>\s*<ul>\s*<li>One<\/li>\s*<li>Two<\/li>\s*<\/ul>\s*<ol>\s*<li>First<\/li>/);
  // The tablet has a row of its own; the phone and the portrait share the next.
  assert.match(html, /<div class="media duo">\s*<figure class="tablet">[\s\S]*?<\/figure>\s*<div class="pair">\s*<figure class="phone">[\s\S]*?<figure class="pic port">/);
  assert.match(html, /<section class="scene offer"[^>]*>\s*<figure class="pic land">\s*<img src="\/demo\/img\/s04-after\.jpg"/);
});

test("a light scheme tells the browser so, darkens the device frames and drops the glow", async () => {
  const p = await makeProject();
  await generate(p.resolved(), { approved: approve(p.resolved()), log: quiet });
  p.story.brand.scheme = "light";
  p.story.brand.palette = { bg: "#fbf9f5", fg: "#1b1c1a", card: "#f1edeb", muted: "#e4dfd8", dim: "#5d5a52", line: "#cdc5bb", accent: "#3b4b32" };
  const light = readFileSync((await build(p.resolved(), { log: quiet })).file, "utf8");
  assert.match(light, /color-scheme: light;/);
  // The frame is nearly black on the pale page, and its shadow is a faint one.
  assert.match(light, /\.phone, \.tablet \{[^}]*background: #13141[0-9a-f];[^}]*rgb\(0 0 0 \/ 0\.28\)/);
  assert.doesNotMatch(light, /li::before[^}]*box-shadow/);

  p.story.brand.scheme = undefined;
  const dark = readFileSync((await build(p.resolved(), { log: quiet })).file, "utf8");
  assert.match(dark, /color-scheme: dark;/);
  assert.match(dark, /li::before[^}]*box-shadow/);
});
