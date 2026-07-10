import { readdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const modelsDir = process.argv[2] || "dist/models";
const supportedExtensions = new Set([".ply", ".splat", ".ksplat"]);

function titleFromFilename(filename) {
  return basename(filename, extname(filename))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const entries = await readdir(modelsDir, { withFileTypes: true }).catch(() => []);

const models = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((filename) => supportedExtensions.has(extname(filename).toLowerCase()))
  .sort((a, b) => a.localeCompare(b))
  .map((filename) => ({
    name: titleFromFilename(filename),
    path: `./models/${filename}`,
    progressiveLoad: true,
    alphaThreshold: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1]
  }));

await writeFile(
  join(modelsDir, "manifest.json"),
  `${JSON.stringify({ models }, null, 2)}\n`
);

console.log(`Wrote ${models.length} model(s) to ${join(modelsDir, "manifest.json")}`);
