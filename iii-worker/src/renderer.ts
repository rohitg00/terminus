import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Liquid } from "liquidjs";

const liquid = new Liquid();
const SCREENS_DIR = join(process.cwd(), "screens");
const FRAMEWORK_CSS = process.env.TRMNL_FRAMEWORK_CSS || "";

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

interface RenderOptions {
  width: number;
  height: number;
  bitDepth: number;
}

export async function renderScreen(
  template: string,
  data: Record<string, unknown>,
  opts: RenderOptions,
): Promise<{ path: string; checksum: string }> {
  mkdirSync(SCREENS_DIR, { recursive: true });

  const html = await liquid.parseAndRender(template, data);
  const { width, height } = opts;

  const fullHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
${FRAMEWORK_CSS ? `<link rel="stylesheet" href="${encodeURI(FRAMEWORK_CSS)}">` : ""}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; background: #fff; color: #000;
         font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
</style>
</head><body>${html}</body></html>`;

  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width, height } });

  try {
    await page.setContent(fullHtml, { waitUntil: "networkidle" });
    const screenshot = await page.screenshot({ type: "png" });

    const colors = Math.pow(2, Math.min(opts.bitDepth, 8));
    const output = await sharp(screenshot)
      .greyscale()
      .threshold(opts.bitDepth === 1 ? 128 : undefined)
      .png({ colours: colors })
      .toBuffer();

    const checksum = createHash("md5").update(output).digest("hex").slice(0, 12);
    const filename = `screen-${checksum}.png`;
    writeFileSync(join(SCREENS_DIR, filename), output);

    return { path: filename, checksum };
  } finally {
    await page.close();
  }
}

export async function shutdownRenderer(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
