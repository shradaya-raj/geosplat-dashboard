import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const modelsDir = process.argv[2] || "dist/models";
const supportedExtensions = new Set([".ply", ".splat", ".ksplat", ".spz"]);

function titleFromFilename(filename) {
  const baseName = basename(filename, extname(filename));
  const qualitySuffix = baseName.toLowerCase().endsWith(".full")
    ? " Full Quality"
    : "";

  return baseName
    .replace(/\.full$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) + qualitySuffix;
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
  .map(async (filename) => {
    const name = titleFromFilename(filename);
    const extension = extname(filename).toLowerCase();
    const modelPath = join(modelsDir, filename);
    const fileStats = await stat(modelPath);

    return {
      name,
      slug: slugify(filename),
      path: `./models/${filename}`,
      filename,
      size: fileStats.size,
      format: extension === ".splat"
        ? "Splat"
        : extension === ".ksplat"
          ? "KSplat"
          : extension === ".spz"
            ? "Spz"
            : extension === ".ply"
              ? "Ply"
              : undefined,
      progressiveLoad: extension === ".splat" || extension === ".ksplat",
      alphaThreshold: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1]
    };
  });

const resolvedModels = await Promise.all(models);

await writeFile(
  join(modelsDir, "manifest.json"),
  `${JSON.stringify({ models: resolvedModels }, null, 2)}\n`
);

console.log(`Wrote ${resolvedModels.length} model(s) to ${join(modelsDir, "manifest.json")}`);
