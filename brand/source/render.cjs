// Render SVGs to exact-size PNGs with Chromium. usage: node render.cjs <svgdir> <pngdir>
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const [svgDir, outDir] = process.argv.slice(2);
const jobs = [
  // [svg, png, width, height]
  ["cusity-icon.svg", "cusity-logo-256.png", 256, 256],
  ["cusity-icon.svg", "cusity-icon-512.png", 512, 512],
  ["cusity-icon.svg", "cusity-icon-1024.png", 1024, 1024],
  ["cusity-icon.svg", "apple-touch-icon-180.png", 180, 180],
  ["cusity-favicon.svg", "favicon-48.png", 48, 48],
  ["cusity-favicon.svg", "favicon-32.png", 32, 32],
  ["cusity-favicon.svg", "favicon-16.png", 16, 16],
  ["cusity-mark.svg", "cusity-mark-1024.png", 1024, 1024],
  ["cusity-avatar.svg", "x-profile-400.png", 400, 400],
  ["cusity-avatar.svg", "telegram-avatar-640.png", 640, 640],
  ["x-header.svg", "x-header-1500x500.png", 1500, 500],
  ["og-image.svg", "og-image-1200x630.png", 1200, 630],
  ["cusity-logo-dark.svg", "cusity-logo-dark.png", null, 320],
  ["cusity-logo-light.svg", "cusity-logo-light.png", null, 320],
];
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [svg, png, w0, h] of jobs) {
    const src = fs.readFileSync(path.join(svgDir, svg), "utf8");
    const m = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const w = w0 ?? Math.round((h * +m[1]) / +m[2]);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;background:transparent">` +
      src.replace(/width="[\d.]+" height="[\d.]+"/, `width="${w}" height="${h}"`) + `</body></html>`);
    await page.locator("svg").screenshot({ path: path.join(outDir, png), omitBackground: true });
    console.log(png, w + "x" + h);
  }
  await browser.close();
})();
