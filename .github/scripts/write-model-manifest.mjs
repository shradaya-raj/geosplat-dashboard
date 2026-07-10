import { readdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const modelsDir = process.argv[2] || "dist/models";
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

const entries = await readdir(modelsDir, { withFileTypes: true }).catch(() => []);

const models = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((filename) => supportedExtensions.has(extname(filename).toLowerCase()))
  .sort((a, b) => a.localeCompare(b))
  .map((filename) => {
    const name = titleFromFilename(filename);

    return {
      name,
      slug: slugify(filename),
      path: `./models/${filename}`,
      progressiveLoad: false,
      alphaThreshold: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1]
    };
  });

await writeFile(
  join(modelsDir, "manifest.json"),
  `${JSON.stringify({ models }, null, 2)}\n`
);

console.log(`Wrote ${models.length} model(s) to ${join(modelsDir, "manifest.json")}`);
