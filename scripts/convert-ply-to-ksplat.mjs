import { readFile, writeFile } from "node:fs/promises";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

globalThis.window ??= globalThis;

const [inputPath, outputPath, compressionArg = "1", alphaArg = "0"] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/convert-ply-to-ksplat.mjs input.ply output.ksplat [compression=1] [alpha=0]");
  process.exit(1);
}

const compressionLevel = Number(compressionArg);
const alphaThreshold = Number(alphaArg);
const optimizeSplatData = true;
const sphericalHarmonicsDegree = 0;

console.log(`Reading ${inputPath}`);
const fileBuffer = await readFile(inputPath);
const fileData = fileBuffer.buffer.slice(
  fileBuffer.byteOffset,
  fileBuffer.byteOffset + fileBuffer.byteLength
);

console.log(`Converting to KSPLAT (compression ${compressionLevel}, alpha ${alphaThreshold})`);
const splatBuffer = await GaussianSplats3D.PlyLoader.loadFromFileData(
  fileData,
  alphaThreshold,
  compressionLevel,
  optimizeSplatData,
  sphericalHarmonicsDegree
);

console.log("Writing KSPLAT");
await writeFile(outputPath, Buffer.from(splatBuffer.bufferData));

console.log(`Wrote ${outputPath}`);
