#!/usr/bin/env node
/** `storyboard <command> <story> [options]`: the story is a story file, or the folder holding `story.ts`. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { build } from "./build.js";
import { check } from "./check.js";
import { adopt, generate } from "./generate.js";
import { imageStates, promptsMarkdown } from "./images.js";
import { reviewSheet } from "./sheet.js";
import { loadStory } from "./story.js";

const USAGE = `Usage: storyboard <command> <story> [options]

  prompts   Write every image prompt to <workDir>/prompts.md for approval. Generates nothing.
  generate  --approved <code> [--redo <id,…>]
            Run the image generator for each new or changed image (the code is in prompts.md).
  adopt     --from <dir> --prompts <dir>
            Store images made earlier (<id>.png) whose prompt (<id>.txt) is the story's.
  sheet     Write <workDir>/review.jpg: every stored original, labelled.
  build     [--allow-missing]  Write the page to the story's outDir.
  check     Screenshot the built page at phone and desktop sizes and assert it is sound.

<story> is a story file, or a folder with story.ts in it.`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      approved: { type: "string" },
      redo: { type: "string" },
      from: { type: "string" },
      prompts: { type: "string" },
      "allow-missing": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, path] = positionals;
  if (values.help || !command || !path) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const story = await loadStory(path);
  const show = (file: string) => relative(process.cwd(), file);

  switch (command) {
    case "prompts": {
      const states = imageStates(story);
      mkdirSync(story.workDir, { recursive: true });
      const file = join(story.workDir, "prompts.md");
      writeFileSync(file, promptsMarkdown(story, states));
      const due = states.filter((s) => s.status !== "current");
      console.log(`Wrote ${show(file)}: ${states.length} prompts, ${due.length} due (${due.map((s) => `${s.image.image} ${s.status}`).join(", ") || "none"}).`);
      return;
    }
    case "generate": {
      const result = await generate(story, { approved: values.approved, redo: values.redo?.split(",").filter(Boolean) });
      if (result.failed.length) {
        console.error(`${result.failed.length} failed: ${result.failed.map((f) => f.image).join(", ")}`);
        process.exit(1);
      }
      return;
    }
    case "adopt": {
      if (!values.from || !values.prompts) throw new Error("storyboard-kit: adopt needs --from <dir> and --prompts <dir>");
      const adopted = await adopt(story, { from: values.from, prompts: values.prompts });
      console.log(`Stored ${adopted.length} image${adopted.length === 1 ? "" : "s"} in ${show(story.store)}.`);
      return;
    }
    case "sheet": {
      const { file, missing, stale } = await reviewSheet(story);
      console.log(`Wrote ${show(file)}.`);
      if (missing.length) console.log(`Not generated yet: ${missing.join(", ")}.`);
      if (stale.length) console.log(`Stale (their prompt or references changed): ${stale.join(", ")}.`);
      return;
    }
    case "build": {
      const { file } = await build(story, { allowMissing: values["allow-missing"] });
      console.log(`Wrote ${show(file)}.`);
      return;
    }
    case "check": {
      const { screenshots, failures } = await check(story);
      for (const file of screenshots) console.log(`Screenshot: ${show(file)}`);
      if (failures.length) {
        console.error(`Check failed:\n  ${failures.join("\n  ")}`);
        process.exit(1);
      }
      console.log("Check passed.");
      return;
    }
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
