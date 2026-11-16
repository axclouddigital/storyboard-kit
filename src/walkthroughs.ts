/** Screens and videos from walkthrough-kit's output: `<walkthroughs>/<flow>/flow.json`, `steps/*.jpg`, `<flow>.mp4`, `poster.jpg`. */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ScreenRef } from "./story.js";

interface FlowJson {
  video: string;
  poster: string;
  steps: { n: number; caption: string; shots: { actor: string; file: string }[] }[];
}

export class Walkthroughs {
  private flows = new Map<string, FlowJson>();
  /** Everything not found, reported together once the whole story has been looked at. */
  readonly missing: string[] = [];

  constructor(private readonly dir: string, private readonly root: string) {}

  private flow(id: string): FlowJson | null {
    if (this.flows.has(id)) return this.flows.get(id)!;
    const file = join(this.dir, id, "flow.json");
    if (!existsSync(file)) {
      this.missing.push(`flow "${id}": no recording at ${relative(this.root, file)} (record it with walkthrough-kit first)`);
      return null;
    }
    const flow = JSON.parse(readFileSync(file, "utf8")) as FlowJson;
    this.flows.set(id, flow);
    return flow;
  }

  /** The screenshot's path, or null (and an entry in `missing`) when the flow, step or actor isn't recorded. */
  screen(ref: ScreenRef): string | null {
    const flow = this.flow(ref.flow);
    if (!flow) return null;
    const step = flow.steps.find((s) => s.n === ref.step);
    if (!step) {
      this.missing.push(`flow "${ref.flow}" has no step ${ref.step} (steps 1 to ${flow.steps.length})`);
      return null;
    }
    const shot = step.shots.find((s) => s.actor === ref.actor);
    const file = shot && join(this.dir, ref.flow, shot.file);
    if (!file || !existsSync(file)) {
      const actors = step.shots.map((s) => s.actor).join(", ") || "none";
      this.missing.push(`flow "${ref.flow}" step ${ref.step} ("${step.caption}") has no screenshot of "${ref.actor}" (recorded: ${actors})`);
      return null;
    }
    return file;
  }

  video(id: string): { video: string; poster: string } | null {
    const flow = this.flow(id);
    if (!flow) return null;
    const video = join(this.dir, id, flow.video);
    const poster = join(this.dir, id, flow.poster);
    for (const file of [video, poster]) {
      if (!existsSync(file)) {
        this.missing.push(`flow "${id}": ${relative(this.root, file)} is missing`);
        return null;
      }
    }
    return { video, poster };
  }
}
