import { chromium, type Browser } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Liquid } from "liquidjs";

const execFile = promisify(execFileCb);
const liquid = new Liquid();
const SCREENS_DIR = join(process.cwd(), "screens");
const FRAMEWORK_CSS = process.env.TRMNL_FRAMEWORK_CSS || "";
const FONTS_PATH = process.env.FONTS_PATH || "";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch({
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    }).then(b => { browser = b; launching = null; return b; })
      .catch(err => { launching = null; throw err; });
  }
  return launching;
}

export interface RenderOptions {
  width: number;
  height: number;
  bitDepth: number;
  rotation?: number;
  format?: "bmp" | "png";
  dither?: boolean;
}

export async function renderScreen(
  template: string,
  data: Record<string, unknown>,
  opts: RenderOptions,
): Promise<{ path: string; checksum: string }> {
  await mkdir(SCREENS_DIR, { recursive: true });

  const html = await liquid.parseAndRender(template, data);
  const { width, height } = opts;

  const fullHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
${FRAMEWORK_CSS ? `<link rel="stylesheet" href="${encodeURI(FRAMEWORK_CSS)}">` : ""}
<style>
  ${FONTS_PATH ? `@font-face { font-family: 'TRMNL'; src: url('file://${FONTS_PATH}/trmnl.woff2'); }` : ""}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; background: #fff; color: #000;
         font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
</style>
</head><body>${html}</body></html>`;

  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width, height } });

  let pngPath: string;
  try {
    await page.setContent(fullHtml, { waitUntil: "networkidle" });
    const screenshot = await page.screenshot({ type: "png" });
    pngPath = join(SCREENS_DIR, `tmp-${Date.now()}.png`);
    await writeFile(pngPath, screenshot);
  } finally {
    await page.close();
  }

  const format = opts.format || "bmp";
  const outputFile = join(SCREENS_DIR, `screen-${Date.now()}.${format}`);

  await convertForEink(pngPath, outputFile, opts);

  const outputData = await readFile(outputFile);
  const checksum = createHash("md5").update(outputData).digest("hex").slice(0, 12);
  const finalFile = `screen-${checksum}.${format}`;
  const finalPath = join(SCREENS_DIR, finalFile);

  await execFile("mv", [outputFile, finalPath]);
  await execFile("rm", ["-f", pngPath]);

  return { path: finalFile, checksum };
}

async function convertForEink(
  input: string,
  output: string,
  opts: RenderOptions,
): Promise<void> {
  const args: string[] = [input];

  if (opts.rotation) {
    args.push("-rotate", String(opts.rotation));
  }

  args.push("-resize", `${opts.width}x${opts.height}!`);
  args.push("-alpha", "off");

  if (opts.bitDepth === 1) {
    // 1-bit monochrome — Floyd-Steinberg dither, same as Terminus Ruby
    args.push(
      "-colorspace", "Gray",
      "-fill", "gray50", "-opaque", "none",
      "-dither", "FloydSteinberg",
      "-remap", "pattern:gray50",
      "-depth", "1",
    );
  } else if (opts.bitDepth <= 4) {
    // 2-4 bit grayscale with dithering
    const colors = Math.pow(2, opts.bitDepth);
    args.push(
      "-colorspace", "Gray",
      "-dither", "FloydSteinberg",
      "+dither",
      "-posterize", String(colors),
      "-depth", String(opts.bitDepth),
    );
  } else {
    // 8-bit grayscale
    args.push(
      "-colorspace", "Gray",
      "-depth", "8",
    );
  }

  args.push("-strip", output);

  await execFile("convert", args);
}

export async function shutdownRenderer(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
