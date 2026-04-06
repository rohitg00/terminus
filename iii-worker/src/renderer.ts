import { chromium, type Browser } from "playwright";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Liquid } from "liquidjs";
import type { DeviceModel } from "./types.js";

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

export async function renderScreen(
  template: string,
  data: Record<string, unknown>,
  model: DeviceModel,
  screenName: string,
): Promise<{ path: string; checksum: string }> {
  await mkdir(SCREENS_DIR, { recursive: true });

  const html = await liquid.parseAndRender(template, data);
  const { width, height } = model;

  const orientation = model.rotation === 0 ? "landscape" : "portrait";
  const bitClass = `screen--${model.bitDepth}bit`;
  const cssClasses = `screen screen--${model.name} ${bitClass} screen--${orientation}`;

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
</head><body class="${cssClasses}">${html}</body></html>`;

  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width, height } });

  let pngPath: string;
  try {
    await page.setContent(fullHtml, { waitUntil: "networkidle", timeout: 30_000 });
    const screenshot = await page.screenshot({ type: "png" });
    pngPath = join(SCREENS_DIR, `tmp-${randomUUID()}.png`);
    await writeFile(pngPath, screenshot);
  } finally {
    await page.close();
  }

  const ext = model.mimeType === "image/bmp" ? "bmp" : "png";
  const outputFile = join(SCREENS_DIR, `tmp-out-${randomUUID()}.${ext}`);

  await convertForEink(pngPath, outputFile, model);

  const outputData = await readFile(outputFile);
  const checksum = createHash("md5").update(outputData).digest("hex");
  const finalFile = `${screenName}-${checksum}.${ext}`;
  const finalPath = join(SCREENS_DIR, finalFile);

  await execFile("mv", [outputFile, finalPath]);
  await execFile("rm", ["-f", pngPath]);

  return { path: finalFile, checksum };
}

async function convertForEink(
  input: string,
  output: string,
  model: DeviceModel,
): Promise<void> {
  const args: string[] = [input];
  const { bitDepth, width, height, rotation, offsetX, offsetY, colors } = model;
  const dither = true;

  if (rotation !== 0) {
    args.push("-rotate", String(rotation));
  }

  args.push("-resize", `${width}x${height}!`);

  if (offsetX > 0 || offsetY > 0) {
    args.push("-crop", `${width}x${height}+${offsetX}+${offsetY}`);
  }

  args.push("-alpha", "off");

  if (dither) {
    if (bitDepth === 1) {
      args.push(
        "-dither", "FloydSteinberg",
        "-remap", "pattern:gray50",
        "-depth", "1",
      );
    } else if (bitDepth <= 4) {
      const grays = colors || Math.pow(2, bitDepth);
      args.push(
        "-colorspace", "Gray",
        "-dither", "FloydSteinberg",
        "-posterize", String(grays),
        "-depth", String(bitDepth),
      );
    } else {
      args.push(
        "-type", "Grayscale",
        "-depth", "8",
      );
    }
  } else {
    if (bitDepth === 1) {
      args.push(
        "-monochrome",
        "-colors", String(colors || 2),
        "-depth", "1",
      );
    } else {
      const grays = colors || Math.pow(2, bitDepth);
      args.push(
        "-colorspace", "Gray",
        "-dither", "None",
        "-posterize", String(grays),
        "-depth", String(bitDepth),
      );
    }
  }

  args.push("-strip");

  const prefix = model.mimeType === "image/bmp" ? "bmp:" : "";
  args.push(`${prefix}${output}`);

  await execFile("convert", args);
}

export async function renderErrorScreen(
  message: string,
  model: DeviceModel,
  screenName: string,
): Promise<{ path: string; checksum: string }> {
  const errorHtml = `
<div class="view">
  <div class="layout layout--col gap--large" style="padding:40px">
    <span class="value value--large">Error</span>
    <span class="description">${message.replace(/</g, "&lt;")}</span>
  </div>
</div>
<div class="title_bar">
  <span class="title">Terminus</span>
</div>`;

  return renderScreen(errorHtml, {}, model, screenName);
}

export async function renderSleepScreen(
  model: DeviceModel,
  screenName: string,
): Promise<{ path: string; checksum: string }> {
  const sleepHtml = `
<div class="view" style="display:flex;align-items:center;justify-content:center;height:100%">
  <span class="value value--xlarge" style="opacity:0.3">sleeping</span>
</div>`;

  return renderScreen(sleepHtml, {}, model, screenName);
}

export async function compressBmpToPng(bmpPath: string): Promise<string> {
  const pngPath = bmpPath.replace(/\.bmp$/, ".png");
  await execFile("convert", [bmpPath, pngPath]);
  return pngPath;
}

export async function shutdownRenderer(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
