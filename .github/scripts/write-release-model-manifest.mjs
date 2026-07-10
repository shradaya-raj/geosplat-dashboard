import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";

const [assetsPath = "release-assets.json", manifestPath = "dist/models/manifest.json"] =
  process.argv.slice(2);
const supportedExtensions = new Set([".ply", ".splat", ".ksplat", ".spz"]);

function titleFromFilename(filename) {
  return basename(filename, extname(filename))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const assets = JSON.parse(await readFile(assetsPath, "utf8"));

const models = assets
  .filter((asset) => supportedExtensions.has(extname(asset.name || "").toLowerCase()))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((asset) => ({
    name: titleFromFilename(asset.name),
    slug: slugify(asset.name),
    path: asset.browser_download_url,
    filename: asset.name,
    size: asset.size,
    progressiveLoad: false,
    alphaThreshold: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1]
  }));

await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify({ models }, null, 2)}\n`);

console.log(`Wrote ${models.length} release model(s) to ${manifestPath}`);
