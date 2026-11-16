# storyboard-kit

Turns one story file into a one-page scroll story: a static, phone-first page that tells a pitch scene by scene, with generated pictures of how things could look, real app screens and a video from walkthrough-kit recordings, an offer and a call to action. The kit writes the image prompts for a person to approve, runs the image generator once they are, keeps the originals, builds the page and checks it in a browser.

Extracted from Truckbites.

## Needs

- Node 22.18 or later: the story file is TypeScript and Node strips the types itself.
- For app screens and videos, a walkthrough-kit output folder (`flow.json`, `steps/*.jpg`, `<flow>.mp4`, `poster.jpg` per flow).
- For `generate`, an image generator on the machine. The default is the codex-imagegen skill (`~/.agents/skills/codex-imagegen/scripts/codex-imagegen.py`).
- For `check`, `@playwright/test` in the project with Chromium installed (`npx playwright install chromium`).

## Install

```bash
npm install -D "github:axclouddigital/storyboard-kit#v0.1.0"
```

The package builds itself on install (`prepare`). With pnpm 10, allow that build: add `storyboard-kit` to `pnpm.onlyBuiltDependencies`.

Then the scripts, one per command, each taking the story's folder:

```json
"story:prompts": "storyboard prompts",
"story:generate": "storyboard generate",
"story:sheet": "storyboard sheet",
"story:build": "storyboard build",
"story:check": "storyboard check"
```

`npm run story:build -- stories/market`.

## What the project supplies

1. One folder per story, `stories/<id>/`, with its `story.ts`, and the reference images the pictures are made from (stories can share them, for example in `stories/reference/`).
2. Brand settings: name, wordmark, fonts, colours and, if it has them, a mark and a lights strip (SVG).
3. Where the page goes (`outDir`, for example `public/<id>`) and its URL.
4. Git-ignore the store of originals (`stories/*/originals/`) and the work folder (`test-results/`).

## The story file

`stories/<id>/story.ts`; the folder name is the story's id. Paths are relative to `root`.

```ts
import { defineStory } from "storyboard-kit";

export default defineStory({
  root: import.meta.dirname + "/../..",
  audience: "The committee of the Riverside Saturday Market",
  outDir: "public/market",
  walkthroughs: process.env.WALK_OUT || "walkthroughs",
  brand: {
    name: "Brewline",
    wordmark: "brewline",
    wordmarkAccent: "line",
    fonts: {
      heading: { file: "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", weight: "100 900" },
      body: { file: "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", weight: "100 900" },
    },
    palette: { bg: "#10141a", fg: "#f2f4f7", card: "#1a2029", muted: "#232b36", dim: "#a3adbb", line: "#2f3946", accent: "#5cc8ff" },
    mark: "stories/brand/mark.svg",
  },
  page: {
    title: "Coffee without the queue",
    description: "How a Saturday at the Riverside market could work with coffee ordered ahead.",
    url: "https://example.com/market",
    image: "m01-market-morning",                  // the link preview's picture
    imageAlt: "A busy Saturday morning at a riverside market",
  },
  imageStyle: "Photo-real documentary photograph, as if taken on a recent phone …",
  generator: { args: ["--allow-face-changes"] },
  header: { kicker: "For the Riverside Saturday Market", title: "Coffee without the queue.", sub: "Two minutes to scroll." },
  scenes: [
    {
      heading: "Saturday mornings are busy.",
      body: "Stalls open at seven and the coffee cart has a line by ten past.",
      layout: "full",
      pictures: [{
        image: "m01-market-morning",
        orientation: "landscape",
        brief: "Wide shot of a riverside market just after opening. …",
        refs: ["stories/reference/market-morning.jpg"],
        alt: "A busy Saturday morning at a riverside market",
      }],
    },
    { divider: "The same morning, with Brewline" },
    {
      heading: "Order from the stall next door.",
      body: "The menu and the wait, on your phone.",
      pictures: [{
        screen: { flow: "order-a-coffee", step: 1, actor: "customer" },
        alt: "The coffee menu with the current wait",
        inset: { screen: { flow: "order-together", step: 3, actor: "friend" }, alt: "A shared order" },
      }],
    },
  ],
  offer: {
    heading: "A free trial at the market.",
    intro: "We set it up for you.",
    blocks: [{ title: "What we do", items: ["Put up the QR signs"] }, { title: "The one thing we need", text: "Your OK." }],
    fine: "Customers pay a small fee per order, shown before they pay.",
    video: { flow: "order-a-coffee", heading: "One order, start to finish", caption: "60 seconds: …" },
    actions: [
      { label: "Try the demo", href: "https://example.com/demo", note: "Nothing is charged." },
      { label: "Email us", href: "mailto:hello@example.com" },
    ],
  },
  footer: ["Brewline"],
  check: { forbidden: /(?:\+61|\b0\d)[\s-]?\d(?:[\s-]?\d){7}\b/ },   // no phone numbers
});
```

A project with several stories keeps what they share (root, brand, walkthroughs, generator, check) in one module and spreads it into each. `src/story.ts` documents every field.

### Scenes

In order, top to bottom, with `{ divider: "…" }` where the page turns from "now" to "with the product". A scene has a `heading`, optional `body`, an optional `small` line and its pictures. The body is a string, or a list of paragraphs and lists in order: `{ list: ["…", "…"] }` for bullets, `{ list: [...], numbered: true }` for numbered steps. The `layout`:

- `split` (default): one to three pictures beside the words on wide screens, sides alternating; above the words on a phone. Narrow pictures (portrait images, phone screens) sit side by side. Wide ones (landscape images, tablet screens, videos) take a row each, and the narrow ones next to them share a row below or above.
- `full`: one generated image across the whole width, words below.
- `moments`: the words, then a row of generated images each with its own `caption`.

After the scenes comes the `offer`: an optional generated `picture` above its heading, the blocks (two across, an odd last one full width), small print, the video and the buttons (the first is the primary one). Then the `footer` lines.

### Pictures

- A generated image: `image` (its file name), `orientation` (`landscape` 3:2 or `portrait` 2:3), `brief`, `refs` and `alt`. Its prompt is the orientation line, the brief, a blank line and the story's `imageStyle`. Every one carries an "Illustration" tag on the page.
- An app screen: `screen: { flow, step, actor }` names a screenshot in walkthrough-kit's output (`flow.json`'s step `n` and the shot's actor slug), with `alt`. A portrait screen shows in a phone frame, a landscape one in a tablet frame. `inset` adds a smaller phone over its corner, on a screen that is its scene's only picture.
- A video: `video: "<flow id>"`, the flow's MP4 with its poster, optionally a `caption`. The offer's `video` is the same with a heading.

Screens and videos are read from the walkthroughs folder on every build, so a rebuild picks up the latest recording. One that isn't there fails the build with the flow, the step and the actors that were recorded.

## Commands

`storyboard <command> <story>`, where `<story>` is the story's folder or its file.

- `prompts`: writes `<workDir>/prompts.md` with the approval code and, for every image, its full prompt (brief plus style), its inputs, its alt text and whether it is new, changed or stored. Generates nothing.
- `generate --approved <code> [--redo <id,…>]`: runs the generator for each image that is new or whose prompt or reference images changed, one at a time (`generator.concurrency`, default 1). Each original goes to the store with its prompt. `--redo` makes named images again although nothing changed (a result nobody liked). A run that fails, takes longer than `generator.timeout` (default 900 seconds) or names more than one image is reported and leaves its image due; the others are kept.
- `adopt --from <dir> --prompts <dir>`: stores images made before the story existed (`<id>.png`), each only if `<id>.txt` in the prompts folder is exactly the prompt the story gives it now. They then count as current.
- `sheet`: writes `<workDir>/review.jpg`, every stored original labelled with its name, orientation and size, and marked when it is stale.
- `build [--allow-missing]`: writes the page to `outDir`. Fails if a generated image has no original yet; `--allow-missing` builds a draft with empty panels. A draft without the link-preview picture has no `og:image`, so `check` fails it until that picture exists. The page is built in `<workDir>/build` and moved into `outDir` only once it is complete, so a build that fails leaves the page that was there.
- `check`: serves the built page on a free local port and opens it in Chromium at 390x844 and 1280x800. Writes full-page screenshots to `<workDir>/check/phone.png` and `desktop.png`. It fails on a page wider than the 390px phone screen, a picture, video or other file that doesn't load, a generated picture without its tag, text hidden when JavaScript is off (its own opacity or a parent's), a missing title, description, `noindex` or Open Graph tag, or any text or HTML matching `check.forbidden`.

`workDir` defaults to `test-results/storyboard/<id>`.

## Approval

Nothing is generated until a person has read the prompts. `prompts` prints an approval code made from every prompt, the content of every reference image and the generator's extra flags; `generate` runs only with that code. Change a brief, the style, a reference image or `generator.args` and the code changes, so the prompts have to be read and approved again. A new code alone doesn't make stored images due: only a changed prompt or reference image does.

`generator.args` carries extra flags. Pass `--allow-face-changes` to codex-imagegen when the people in the pictures are invented: without it, it tries to keep the faces from the reference photos.

## The generator

`generator.command` (default codex-imagegen) is called as:

```
<command> "<prompt>" --image <ref> … --out <dir> <args…>
```

It must print the path of the image it made, one path a line. codex-imagegen prints every new image in its `--out` folder, oldest first, and when another run (from this kit or anything else using the same Codex account) finishes beside it, that run's image is new there too. So the kit stores an image only when the output names exactly one; an output naming two or more is "ambiguous output", stored nowhere, and the image stays due. Run one at a time (the default) and don't generate from two places at once. Each run's folder (`<workDir>/runs/`) keeps the generator's output in `run.log`.

## Output

- `<outDir>/index.html`, with `img/<image>.jpg` (landscape 1536 wide, portrait 800), `screens/<flow>-<step>-<actor>.webp` (phones 600 wide, insets 360, tablets 1280), `video/<flow>.mp4` and its poster, `fonts/` and the brand's `mark.svg` and `festoon.svg`. Asset paths start with the URL's path (`/market/…`), so the page works at `/market` without a trailing slash. A build replaces those paths and leaves anything else in `outDir` alone.
- The store (default `stories/<id>/originals/`): `<image>.png`, `<image>.prompt.txt` and `<image>.json` (the reference images by content hash, the generator, when).

The page is one HTML file with its CSS inline, `noindex`, with the title, description and Open Graph tags in the HTML for link previews. It reads in full with JavaScript off; the only script is a small rise of the words into view, which `prefers-reduced-motion` turns off. Every image has its size set and everything after the first picture loads lazily.

## Releasing

Projects pin a tag. After a change: `npm version patch` (or `minor`), `git push --follow-tags`, then bump the tag in each project's `package.json` and reinstall.

To try a change in a project before tagging it, use `npm pack` and `npm install --no-save <tarball>` in the project, as with walkthrough-kit. `npm test` builds the kit and runs its tests, with a fake generator in place of the real one; the `check` tests need Chromium (`npx playwright install chromium`).
