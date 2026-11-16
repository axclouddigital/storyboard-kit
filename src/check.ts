/**
 * `check`: serves the built page on a free local port and looks at it in Chromium at a phone
 * and a desktop size. Writes a full-page screenshot of each and asserts what a reader would
 * trip over: sideways scroll on the phone, a broken image or file, text hidden without the
 * script, missing link-preview tags or text matching the story's forbidden pattern.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, relative } from "node:path";
import type { Page } from "@playwright/test";
import type { Resolved } from "./story.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
  ".json": "application/json",
};

const VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false },
} as const;

/**
 * Serves `dir` so that its `index.html` answers at `base` (as the site will). When `dir` ends in
 * `base` (public/market for /market) the folder above is served, so site-wide files the page
 * links (the favicon) resolve too.
 */
async function serve(dir: string, base: string): Promise<{ url: string; server: Server }> {
  const root = base && dir.endsWith(base) ? dir.slice(0, -base.length) : null;
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file: string;
    if (root !== null) file = join(root, normalize(path));
    else if (path === base || path.startsWith(base + "/")) file = join(dir, normalize(path.slice(base.length) || "/"));
    else file = "";
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    else if (file && !existsSync(file) && existsSync(file + ".html")) file += ".html";
    else if (file && !existsSync(file) && path === base) file = join(dir, "index.html");
    if (!file || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": statSync(file).size });
    createReadStream(file).pipe(res);
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${base || "/"}`, server };
}

interface CheckResult {
  screenshots: string[];
  failures: string[];
}

/** Opens the page and scrolls to the end so every lazy picture loads, then waits for them. */
async function loadFully(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => {
        if (img.complete) return null;
        const settled = Promise.withResolvers<void>();
        img.addEventListener("load", () => settled.resolve(), { once: true });
        img.addEventListener("error", () => settled.resolve(), { once: true });
        return settled.promise;
      }),
    );
  });
  await page.waitForLoadState("networkidle");
}

export async function check(story: Resolved): Promise<CheckResult> {
  const index = join(story.outDir, "index.html");
  if (!existsSync(index)) throw new Error(`storyboard-kit: ${relative(story.root, index)} doesn't exist: run build first`);
  // Playwright is an optional peer: only this command needs it.
  const { chromium } = await import("@playwright/test").catch(() => {
    throw new Error("storyboard-kit: check needs @playwright/test in the project, with Chromium installed (npx playwright install chromium)");
  });

  const failures: string[] = [];
  const html = readFileSync(index, "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  for (const [tag, pattern] of [
    ["<title>", /<title>[^<]+<\/title>/],
    ["description", /<meta name="description" content="[^"]+">/],
    ["robots noindex", /<meta name="robots" content="noindex">/],
    ["og:title", /<meta property="og:title" content="[^"]+">/],
    ["og:description", /<meta property="og:description" content="[^"]+">/],
    ["og:url", /<meta property="og:url" content="https?:[^"]+">/],
    ["og:image", /<meta property="og:image" content="https?:[^"]+">/],
  ] as const) {
    if (!pattern.test(head)) failures.push(`head: no ${tag}`);
  }
  const forbidden = story.check?.forbidden;
  const sourceHit = forbidden && html.match(new RegExp(forbidden.source, forbidden.flags.replace("g", "")));
  if (sourceHit) failures.push(`the HTML contains forbidden text "${sourceHit[0]}"`);

  const shots = join(story.workDir, "check");
  mkdirSync(shots, { recursive: true });
  const { url, server } = await serve(story.outDir, story.base);
  const browser = await chromium.launch();
  const screenshots: string[] = [];
  try {
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const broken: string[] = [];
      page.on("response", (r) => {
        if (r.status() >= 400) broken.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      page.on("requestfailed", (r) => {
        // A video with preload="none" may be cancelled; a failure of anything else is a broken file.
        if (r.resourceType() !== "media") broken.push(`failed ${new URL(r.url()).pathname}`);
      });
      await loadFully(page, url);
      const facts = await page.evaluate(async () => ({
        scrollWidth: document.documentElement.scrollWidth,
        badImages: [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.getAttribute("src") ?? ""),
        untagged: [...document.querySelectorAll(".pic")].filter((pic) => pic.querySelector("img") && !pic.querySelector(".tag")).length,
        text: document.body.innerText,
        // preload="none" fetches nothing, so ask for each video file directly.
        badVideos: (
          await Promise.all(
            [...document.querySelectorAll("video source, video[src]")].map(async (el) => {
              const src = el.getAttribute("src") ?? "";
              const response = await fetch(src, { method: "HEAD" }).catch(() => null);
              return response?.ok ? null : `${response?.status ?? "failed"} ${src}`;
            }),
          )
        ).filter((v) => v !== null),
      }));
      // On a phone the browser widens the layout to fit what overflows, so compare with the screen's width.
      if (name === "phone" && facts.scrollWidth > viewport.width) failures.push(`${name}: the page scrolls sideways (${facts.scrollWidth}px wide on a ${viewport.width}px screen)`);
      for (const v of facts.badVideos) failures.push(`${name}: video didn't load: ${v}`);
      for (const src of facts.badImages) failures.push(`${name}: image didn't load: ${src}`);
      for (const b of new Set(broken)) failures.push(`${name}: ${b}`);
      if (facts.untagged) failures.push(`${name}: ${facts.untagged} generated picture(s) without the Illustration tag`);
      const textHit = forbidden && facts.text.match(new RegExp(forbidden.source, forbidden.flags.replace("g", "")));
      if (textHit) failures.push(`${name}: the page shows forbidden text "${textHit[0]}"`);
      const file = join(shots, `${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      screenshots.push(file);
      await context.close();
    }

    // Without the script (or with it blocked) every word must still show.
    const noScript = await browser.newContext({ viewport: VIEWPORTS.phone, javaScriptEnabled: false, reducedMotion: "no-preference" });
    const page = await noScript.newPage();
    await page.goto(url, { waitUntil: "load" });
    // An element shows only as much as its ancestors do: multiply the opacity up the tree.
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll("h1, h2, h3, p, li")].filter((el) => {
        if (getComputedStyle(el).visibility === "hidden") return true;
        let opacity = 1;
        for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return opacity < 1;
      }).length,
    );
    if (hidden) failures.push(`without JavaScript: ${hidden} text element(s) are hidden`);
    await noScript.close();
  } finally {
    await browser.close();
    server.close();
  }
  return { screenshots, failures };
}
