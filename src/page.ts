/**
 * The page's HTML: one static file with its CSS inline and a few lines of script for the words'
 * rise into view. Phone first; on wide screens a centred column with picture and words side by
 * side. Fully readable without the script, and still under `prefers-reduced-motion`.
 */
import {
  isDivider,
  isGenerated,
  isScreen,
  isVideo,
  type Divider,
  type GeneratedImage,
  type Picture,
  type Resolved,
  type Scene,
  type Screen,
  type ScreenRef,
} from "./story.js";

export interface Img {
  src: string;
  width: number;
  height: number;
}

interface Font {
  href: string;
  weight?: string;
  ext: string;
}

export interface Assets {
  generated: Map<string, Img>;
  screens: Map<string, Img & { tablet: boolean }>;
  videos: Map<string, { src: string; poster: string; width: number; height: number }>;
  fonts: { heading: Font; body: Font } | null;
  mark: Img | null;
  festoon: Img | null;
}

export const screenKey = (ref: ScreenRef, inset: boolean) => `${ref.flow}/${ref.step}/${ref.actor}${inset ? "/inset" : ""}`;

const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => text(s).replace(/"/g, "&quot;");
/** Text inside an HTML comment, which `--` would end or break. */
const comment = (s: string) => s.replace(/-(?=-)/g, "- ");

/** `#rrggbb` as `rgb(r g b / a)`. */
function rgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

/** Between two `#rrggbb` colours: `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number) {
  const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
  const channel = (shift: number) => Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, "0")).join("")}`;
}

const FORMAT: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

function fontFace(family: string, font: Font) {
  const format = FORMAT[font.ext] ?? font.ext;
  return `@font-face {
  font-family: "${family}";
  font-style: normal;
  font-display: swap;${font.weight ? `\n  font-weight: ${font.weight};` : ""}
  src: url(${font.href}) format("${font.weight ? `${format}-variations` : format}");
}`;
}

function css(story: Resolved, assets: Assets) {
  const p = story.brand.palette;
  const light = story.brand.scheme === "light";
  // On a light page a device frame is the dark thing, a shadow is faint and nothing glows.
  const frame = light ? mix(p.fg, "#000000", 0.3) : mix(p.bg, "#000000", 0.45);
  const shade = (dark: number, onLight: number) => `rgb(0 0 0 / ${light ? onLight : dark})`;
  const festoon = assets.festoon;
  const mark = assets.mark;
  return `${assets.fonts ? `${fontFace("Story Heading", assets.fonts.heading)}\n${fontFace("Story Body", assets.fonts.body)}\n` : ""}:root {
  --background: ${p.bg};
  --foreground: ${p.fg};
  --card: ${p.card};
  --secondary: ${p.muted};
  --muted-foreground: ${p.dim};
  --primary: ${p.accent};
  --primary-foreground: ${p.bg};
  --border: ${p.line};
  --input: ${mix(p.bg, p.dim, 0.6)};
  --font-display: ${assets.fonts ? `"Story Heading", "Story Body", ` : ""}ui-sans-serif, system-ui, sans-serif;
  --font-body: ${assets.fonts ? `"Story Body", ` : ""}ui-sans-serif, system-ui, sans-serif;
  --pad: max(1.25rem, env(safe-area-inset-left, 0px));
  color-scheme: ${light ? "light" : "dark"};
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-body);
  font-size: 1.0625rem;
  line-height: 1.55;
  overflow-x: clip;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { font-family: var(--font-display); font-weight: 800; letter-spacing: -0.02em; line-height: 1.08; margin: 0; text-wrap: balance; }
p { margin: 0; text-wrap: pretty; }
img, video { display: block; max-width: 100%; }
a { color: var(--primary); }
:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }

/* Header: the lights strip over the wordmark. */
.festoon { height: calc(env(safe-area-inset-top, 0px) + ${festoon?.height ?? 0}px); padding-top: env(safe-area-inset-top, 0px); overflow: hidden; pointer-events: none; }
.festoon img { width: ${festoon?.width ?? 0}px; height: ${festoon?.height ?? 0}px; max-width: none; }
.intro { position: relative; max-width: 72rem; margin: 0 auto; padding: 0 var(--pad) 2.25rem; }
.intro .festoon { position: absolute; inset: 0 0 auto; }
.brand { display: inline-flex; align-items: center; gap: 0.28em; padding-top: calc(env(safe-area-inset-top, 0px) + 4.25rem); font-family: var(--font-display); font-weight: 800; font-size: 1.25rem; letter-spacing: -0.02em; }
.brand img { width: ${mark ? ((0.97 * mark.width) / mark.height).toFixed(3) : 0}em; height: 0.97em; }
.brand b { color: var(--primary); font-weight: inherit; }
.kicker { margin-top: 1.75rem; color: var(--primary); font-weight: 700; font-size: 0.9375rem; letter-spacing: 0.01em; }
.intro h1 { margin-top: 0.5rem; font-size: clamp(2.5rem, 11vw, 4.75rem); max-width: 14ch; }
.sub { margin-top: 1rem; color: var(--muted-foreground); font-size: 1.125rem; max-width: 34rem; }

/* Pictures. Generated ones keep their shape before the file loads (a dark panel) and carry a tag. */
.pic { position: relative; margin: 0; overflow: hidden; background: var(--card); border-radius: 1rem; }
.pic > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; color: transparent; }
.land { aspect-ratio: 3 / 2; }
.port { aspect-ratio: 2 / 3; }
.tag {
  position: absolute; left: 0.625rem; bottom: 0.625rem; z-index: 1;
  padding: 0.125rem 0.5rem; border-radius: 999px;
  background: ${rgba(p.bg, 0.72)}; color: var(--foreground);
  font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.02em; line-height: 1.5;
}
.bleed { border-radius: 0; width: 100%; max-height: 88vh; }

/* Real app screens in plain device frames, so they read as the app, not as photos. */
.phone, .tablet { margin: 0; background: ${frame}; border: 1px solid var(--border); box-shadow: 0 0 0 6px var(--secondary), 0 24px 48px -16px ${shade(0.7, 0.28)}; }
.phone { border-radius: 2rem; padding: 6px; width: 100%; max-width: 17.5rem; }
.phone img { width: 100%; height: auto; border-radius: 1.625rem; }
.tablet { border-radius: 1.25rem; padding: 10px; width: 100%; }
.tablet img { width: 100%; height: auto; border-radius: 0.5rem; }

/* Scenes: phone first, picture then words, about a screen each. */
.scene { max-width: 72rem; margin: 0 auto; padding: 3rem var(--pad); }
.scene h2 { font-size: clamp(1.875rem, 7.4vw, 2.75rem); }
.text p { margin-top: 0.875rem; font-size: 1.125rem; max-width: 34rem; }
.text .small { color: var(--muted-foreground); font-size: 1rem; }
.text ul, .text ol { margin: 0.875rem 0 0; padding: 0; list-style: none; font-size: 1.125rem; max-width: 34rem; }
.text ol { counter-reset: step; }
.text ol li { position: relative; padding-left: 1.75rem; margin-top: 0.5rem; counter-increment: step; }
.text ol li::before { content: counter(step); position: absolute; left: 0; color: var(--primary); font-family: var(--font-display); font-weight: 800; }
.media { margin-bottom: 1.75rem; }
.full { padding: 0 0 3rem; max-width: none; }
.full .text { max-width: 72rem; margin: 0 auto; padding: 1.75rem var(--pad) 0; }
.full .media { margin: 0; }

.moments { display: grid; gap: 1.25rem; margin-top: 1.75rem; }
.moment { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr); gap: 1rem; align-items: center; margin: 0; }
.moment p { font-size: 1.0625rem; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; align-items: end; }
.screens { display: flex; justify-content: center; }
.screens .stack { position: relative; width: min(64%, 17.5rem); padding-bottom: 1.5rem; margin-right: 18%; }
.screens .inset { position: absolute; right: -32%; bottom: 0; width: 52%; max-width: 9rem; border-radius: 1.25rem; padding: 4px; box-shadow: 0 0 0 4px var(--secondary), 0 16px 32px -8px ${shade(0.8, 0.32)}; }
.screens .inset img { border-radius: 1rem; }
.media .phone { margin: 0 auto; }
.split > .pic.port { width: 100%; max-width: 24rem; margin-inline: auto; }
.duo { display: grid; gap: 1.5rem; }
.pair .phone { max-width: none; }
.clip, .film figure { margin: 0; }
.clip video, .film video { width: 100%; height: auto; background: #000; border-radius: 0.75rem; border: 1px solid var(--border); }
.clip figcaption, .film figcaption { margin-top: 0.625rem; color: var(--muted-foreground); font-size: 0.9375rem; }

/* The turn from "now" to "with the product". */
.turn { position: relative; margin: 2rem 0 0; padding: 0 var(--pad) 1rem; text-align: center; border-top: 1px solid var(--border); background: linear-gradient(to bottom, var(--card), var(--background) 9rem); }
.turn .festoon { margin: 0 calc(-1 * var(--pad)); display: flex; justify-content: center; }
.turn p { margin-top: 1.25rem; font-family: var(--font-display); font-weight: 800; font-size: clamp(1.5rem, 6vw, 2.25rem); letter-spacing: -0.02em; color: var(--primary); line-height: 1.15; text-wrap: balance; }

/* The offer. */
.offer { max-width: 48rem; }
.offer > p { margin-top: 0.875rem; font-size: 1.125rem; }
.offer > .pic { margin-bottom: 2rem; }
.blocks { display: grid; gap: 0.875rem; margin-top: 1.75rem; }
.block { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; padding: 1.125rem 1.25rem 1.25rem; }
.block h3 { font-size: 1.1875rem; color: var(--primary); }
.block ul, .text ul { padding: 0; list-style: none; }
.block li, .text ul li { position: relative; padding-left: 1.125rem; margin-top: 0.375rem; }
.block li::before, .text ul li::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--primary);${light ? "" : ` box-shadow: 0 0 8px ${rgba(p.accent, 0.6)};`} }
.block ul { margin: 0.625rem 0 0; }
.block p { margin-top: 0.625rem; }
.block:last-child:nth-child(odd) { grid-column: 1 / -1; }
.fine { margin-top: 1rem; color: var(--muted-foreground); font-size: 0.9375rem; }
.film { margin-top: 3rem; }
.film h3 { font-size: 1.5rem; }
.film figure { margin-top: 1rem; }
.actions { display: grid; gap: 1.5rem; margin-top: 2.75rem; }
.button {
  display: inline-flex; align-items: center; justify-content: center; min-height: 3.25rem; padding: 0.75rem 1.5rem;
  border-radius: 1rem; font-weight: 700; font-size: 1.0625rem; text-decoration: none; text-align: center;
}
.primary { background: var(--primary); color: var(--primary-foreground); box-shadow: 0 10px 30px -12px ${rgba(p.accent, light ? 0.45 : 0.6)}; }
.secondary { border: 1px solid var(--input); color: var(--foreground); }
.action p { margin-top: 0.5rem; color: var(--muted-foreground); font-size: 0.9375rem; }
.action .button { width: 100%; }
.address { display: inline-block; padding: 0.625rem 0; color: var(--primary); font-weight: 600; overflow-wrap: anywhere; }
footer { max-width: 48rem; margin: 0 auto; padding: 2rem var(--pad) calc(env(safe-area-inset-bottom, 0px) + 2.5rem); border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: 0.875rem; }
footer p + p { margin-top: 0.5rem; }

/* Wider screens: a centred column of alternating picture and words. */
@media (min-width: 48rem) {
  .intro { padding-bottom: 3rem; }
  .scene { padding-top: 4.5rem; padding-bottom: 4.5rem; }
  .split { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 4rem; align-items: center; }
  .split .media { margin: 0; }
  .split.flip .media { order: 2; }
  .full { padding: 0 0 4.5rem; }
  .full .text { padding-top: 2.25rem; }
  .moments { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2rem; margin-top: 2.5rem; }
  .moment { grid-template-columns: 1fr; align-items: start; }
  .blocks { grid-template-columns: 1fr 1fr; }
  .actions { grid-template-columns: 1fr 1fr; align-items: start; }
  .turn { margin-top: 3rem; }
  .sub { font-size: 1.25rem; }
  .text p, .text ul, .text ol { font-size: 1.25rem; }
  .text .small { font-size: 1.0625rem; }
}

/* A small rise as words come into view; only with motion allowed and the script running. */
@media (prefers-reduced-motion: no-preference) {
  .reveal-on .reveal { opacity: 0; transform: translateY(0.75rem); transition: opacity 0.6s ease-out, transform 0.6s ease-out; }
  .reveal-on .reveal.in { opacity: 1; transform: none; }
}`;
}

const SCRIPT = `<script>
  // Words rise in as they scroll into view. Without this script (or with reduced motion) they simply show.
  if ("IntersectionObserver" in window && matchMedia("(prefers-reduced-motion: no-preference)").matches) {
    document.documentElement.classList.add("reveal-on");
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        seen.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach(function (el) { seen.observe(el); });
  }
</script>`;

/** Renders the pictures; the first one on the page loads at once, the rest lazily. */
class Pictures {
  private first = true;

  constructor(private readonly assets: Assets) {}

  private loading() {
    if (!this.first) return ` loading="lazy"`;
    this.first = false;
    return ` fetchpriority="high"`;
  }

  /** A generated image's `<img>` and tag, or nothing (an empty panel) in a draft without it. */
  generated(p: GeneratedImage) {
    const img = this.assets.generated.get(p.image);
    const loading = this.loading();
    if (!img) return "";
    return `<img src="${img.src}" width="${img.width}" height="${img.height}"${loading} alt="${attr(p.alt)}">
      <span class="tag">Illustration</span>`;
  }

  screenImg(screen: Screen | NonNullable<Screen["inset"]>, inset = false) {
    const img = this.assets.screens.get(screenKey(screen.screen, inset))!;
    return `<img src="${img.src}" width="${img.width}" height="${img.height}"${this.loading()} alt="${attr(screen.alt)}">`;
  }

  frame(screen: Screen) {
    return this.assets.screens.get(screenKey(screen.screen, false))!.tablet ? "tablet" : "phone";
  }

  video(flow: string, captionId: string | null) {
    const v = this.assets.videos.get(flow)!;
    this.first = false;
    return `<video controls preload="none" playsinline width="${v.width}" height="${v.height}" poster="${v.poster}"${captionId ? ` aria-describedby="${captionId}"` : ""}>
          <source src="${v.src}" type="video/mp4">
        </video>`;
  }

  /** One picture as a figure: in a pair or duo, or (a generated image) as a scene's whole media. */
  figure(p: Picture, media = false, bleed = false) {
    if (isGenerated(p)) {
      return `<figure class="${media ? "media " : ""}pic ${p.orientation === "landscape" ? "land" : "port"}${bleed ? " bleed" : ""}">
        ${this.generated(p)}
      </figure>`;
    }
    if (isScreen(p)) return `<figure class="${this.frame(p)}">
        ${this.screenImg(p)}
      </figure>`;
    return `<figure class="clip">
        ${this.video(p.video, null)}${p.caption ? `\n        <figcaption>${text(p.caption)}</figcaption>` : ""}
      </figure>`;
  }

  /**
   * A split scene's media: one picture, a phone with an inset, two narrow pictures side by side
   * (`pair`), or a stack (`duo`) where each wide picture (landscape, tablet, video) has a row of
   * its own and neighbouring narrow ones share a row.
   */
  media(pictures: Picture[]) {
    if (pictures.length === 1) {
      const [p] = pictures;
      if (isGenerated(p)) return this.figure(p, true);
      if (isScreen(p) && p.inset) {
        return `<div class="media screens">
      <div class="stack">
        <figure class="phone">
          ${this.screenImg(p)}
        </figure>
        <figure class="phone inset">
          ${this.screenImg(p.inset, true)}
        </figure>
      </div>
    </div>`;
      }
      return `<div class="media">
      ${this.figure(p)}
    </div>`;
    }
    const isWide = (p: Picture) => (isGenerated(p) && p.orientation === "landscape") || isVideo(p) || (isScreen(p) && this.frame(p) === "tablet");
    if (!pictures.some(isWide)) {
      return `<div class="media pair">
      ${pictures.map((p) => this.figure(p)).join("\n      ")}
    </div>`;
    }
    const rows: string[] = [];
    let narrow: Picture[] = [];
    const endRow = () => {
      if (narrow.length === 1) rows.push(this.figure(narrow[0]));
      if (narrow.length > 1) rows.push(`<div class="pair">\n        ${narrow.map((p) => this.figure(p)).join("\n        ")}\n      </div>`);
      narrow = [];
    };
    for (const p of pictures) {
      if (!isWide(p)) {
        narrow.push(p);
        continue;
      }
      endRow();
      rows.push(this.figure(p));
    }
    endRow();
    return `<div class="media duo">
      ${rows.join("\n      ")}
    </div>`;
  }
}

function words(scene: Scene, id: string) {
  const body = scene.body === undefined ? [] : Array.isArray(scene.body) ? scene.body : [scene.body];
  const paras = [
    ...body.map((b) => {
      if (typeof b === "string") return `<p>${text(b)}</p>`;
      const tag = b.numbered ? "ol" : "ul";
      return `<${tag}>\n        ${b.list.map((i) => `<li>${text(i)}</li>`).join("\n        ")}\n      </${tag}>`;
    }),
    ...(scene.small ? [`<p class="small">${text(scene.small)}</p>`] : []),
  ];
  const h2 = `<h2 id="${id}">${text(scene.heading)}</h2>`;
  if (paras.length === 0) return `<div class="text reveal">${h2}</div>`;
  return `<div class="text reveal">
      ${h2}
      ${paras.join("\n      ")}
    </div>`;
}

function divider(d: Divider, assets: Assets) {
  const f = assets.festoon;
  return `<div class="turn" role="separator" aria-label="${attr(d.divider)}">${
    f ? `\n    <div class="festoon" aria-hidden="true"><img src="${f.src}" alt="" width="${f.width}" height="${f.height}" loading="lazy"></div>` : ""
  }
    <p aria-hidden="true">${text(d.divider)}</p>
  </div>`;
}

function offer(story: Resolved, pics: Pictures, id: string) {
  const o = story.offer;
  const blocks = o.blocks.map((b) => {
    const body = [
      ...(b.items?.length ? [`<ul>\n          ${b.items.map((i) => `<li>${text(i)}</li>`).join("\n          ")}\n        </ul>`] : []),
      ...(b.text ? [`<p>${text(b.text)}</p>`] : []),
    ];
    return `<div class="block">
        <h3>${text(b.title)}</h3>
        ${body.join("\n        ")}
      </div>`;
  });
  const video = o.video
    ? `

    <div class="film">
      <h3>${text(o.video.heading)}</h3>
      <figure>
        ${pics.video(o.video.flow, "film-caption")}
        <figcaption id="film-caption">${text(o.video.caption)}</figcaption>
      </figure>
    </div>`
    : "";
  const actions = o.actions.map((a, n) => {
    const mail = a.href.startsWith("mailto:") ? a.href.slice("mailto:".length).split("?")[0] : null;
    const note = a.note ? `<p>${text(a.note)}</p>` : mail ? `<p><a class="address" href="${attr(a.href)}">${text(mail)}</a></p>` : "";
    return `<div class="action">
        <a class="button ${n === 0 ? "primary" : "secondary"}" href="${attr(a.href)}">${text(a.label)}</a>${note ? `\n        ${note}` : ""}
      </div>`;
  });
  return `<section class="scene offer" aria-labelledby="${id}">
    ${o.picture ? `${pics.figure(o.picture)}\n    ` : ""}<h2 id="${id}">${text(o.heading)}</h2>${o.intro ? `\n    <p>${text(o.intro)}</p>` : ""}
    <div class="blocks">
      ${blocks.join("\n      ")}
    </div>${o.fine ? `\n    <p class="fine">${text(o.fine)}</p>` : ""}${video}

    <div class="actions">
      ${actions.join("\n      ")}
    </div>
  </section>`;
}

export function pageHtml(story: Resolved, assets: Assets): string {
  const { page, brand, header } = story;
  const pics = new Pictures(assets);
  const origin = new URL(page.url).origin;
  const ogImage = assets.generated.get(page.image);
  const lang = page.lang ?? "en-AU";
  const accent = brand.wordmarkAccent && brand.wordmark.endsWith(brand.wordmarkAccent) ? brand.wordmarkAccent : "";
  const wordmark = `${text(brand.wordmark.slice(0, brand.wordmark.length - accent.length))}${accent ? `<b>${text(accent)}</b>` : ""}`;
  const festoon = assets.festoon
    ? `\n  <div class="festoon" aria-hidden="true"><img src="${assets.festoon.src}" alt="" width="${assets.festoon.width}" height="${assets.festoon.height}"></div>`
    : "";
  const mark = assets.mark ? `<img src="${assets.mark.src}" alt="" width="${assets.mark.width}" height="${assets.mark.height}">` : "";

  let n = 0;
  let splits = 0;
  const sections = story.scenes.map((scene) => {
    if (isDivider(scene)) return divider(scene, assets);
    const id = `s${++n}`;
    const layout = scene.layout ?? "split";
    if (layout === "full") {
      return `<section class="scene full" aria-labelledby="${id}">
    ${pics.figure(scene.pictures[0], true, true)}
    ${words(scene, id)}
  </section>`;
    }
    if (layout === "moments") {
      const moments = scene.pictures.map((p) => {
        const g = p as GeneratedImage;
        return `<figure class="moment">
        <div class="pic ${g.orientation === "landscape" ? "land" : "port"}">
          ${pics.generated(g)}
        </div>
        <figcaption class="reveal"><p>${text(g.caption!)}</p></figcaption>
      </figure>`;
      });
      return `<section class="scene" aria-labelledby="${id}">
    ${words(scene, id)}
    <div class="moments">
      ${moments.join("\n      ")}
    </div>
  </section>`;
    }
    // Split scenes alternate sides on wide screens, words first.
    const flip = splits++ % 2 === 0 ? " flip" : "";
    return `<section class="scene split${flip}" aria-labelledby="${id}">
    ${pics.media(scene.pictures)}
    ${words(scene, id)}
  </section>`;
  });

  const preload = assets.fonts
    ? [assets.fonts.heading, assets.fonts.body]
        .map((f) => `\n<link rel="preload" href="${f.href}" as="font" type="font/${f.ext}" crossorigin>`)
        .join("")
    : "";
  return `<!doctype html>
<!--
  Built by storyboard-kit from ${comment(story.file)}: change the story and rebuild rather than editing this file.
  For ${comment(story.audience)}.
-->
<html lang="${attr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${text(page.title)}</title>
<meta name="description" content="${attr(page.description)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${brand.palette.bg}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(brand.name)}">
<meta property="og:locale" content="${attr(lang.replace("-", "_"))}">
<meta property="og:url" content="${attr(page.url)}">
<meta property="og:title" content="${attr(page.title)}">
<meta property="og:description" content="${attr(page.description)}">${
    ogImage ? `\n<meta property="og:image" content="${attr(origin + ogImage.src)}">\n<meta property="og:image:alt" content="${attr(page.imageAlt)}">` : ""
  }
<meta name="twitter:card" content="summary_large_image">${page.icon ? `\n<link rel="icon"${page.icon.endsWith(".svg") ? ` type="image/svg+xml"` : ""} href="${attr(page.icon)}">` : ""}${
    page.appleTouchIcon ? `\n<link rel="apple-touch-icon" sizes="180x180" href="${attr(page.appleTouchIcon)}">` : ""
  }${preload}
<style>
${css(story, assets)}
</style>
</head>
<body>
<header class="intro">${festoon}
  <div class="brand">${mark}<span>${wordmark}</span></div>
  <p class="kicker">${text(header.kicker)}</p>
  <h1>${text(header.title)}</h1>${header.sub ? `\n  <p class="sub">${text(header.sub)}</p>` : ""}
</header>

<main>
  ${sections.join("\n\n  ")}

  ${offer(story, pics, `s${n + 1}`)}
</main>

<footer>
  ${story.footer.map((line) => `<p>${text(line)}</p>`).join("\n  ")}
</footer>

${SCRIPT}
</body>
</html>
`;
}
