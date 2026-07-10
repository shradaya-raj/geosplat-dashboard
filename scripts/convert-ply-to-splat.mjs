import { open } from "node:fs/promises";
import { createWriteStream } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/convert-ply-to-splat.mjs input.ply output.splat");
  process.exit(1);
}

const SH_C0 = 0.28209479177387814;
const INPUT_ROW_BYTES = 19 * 4;
const OUTPUT_ROW_BYTES = 32;
const ROWS_PER_CHUNK = 65536;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.floor(value)));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function quatByte(value) {
  return clampByte(value * 128 + 128);
}

function parseHeader(header) {
  const vertexMatch = header.match(/element\s+vertex\s+(\d+)/);
  if (!vertexMatch) throw new Error("Could not find vertex count in PLY header.");

  const properties = [...header.matchAll(/^property\s+\S+\s+(\S+)/gm)].map((match) => match[1]);
  const expected = [
    "x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3", "filter_3D", "gs_depths"
  ];

  for (const [index, name] of expected.entries()) {
    if (properties[index] !== name) {
      throw new Error(`Unexpected property at index ${index}: expected ${name}, got ${properties[index] || "none"}.`);
    }
  }

  return Number(vertexMatch[1]);
}

const input = await open(inputPath, "r");
const probe = Buffer.alloc(64 * 1024);
const { bytesRead } = await input.read(probe, 0, probe.length, 0);
const probeText = probe.subarray(0, bytesRead).toString("ascii");
const marker = "end_header";
const markerIndex = probeText.indexOf(marker);

if (markerIndex < 0) {
  await input.close();
  throw new Error("Could not find PLY end_header marker.");
}

const headerEnd = markerIndex + marker.length;
const dataOffset = headerEnd + (probe[headerEnd] === 13 && probe[headerEnd + 1] === 10 ? 2 : 1);
const header = probeText.slice(0, headerEnd);
const vertexCount = parseHeader(header);
const output = createWriteStream(outputPath);

console.log(`Converting ${vertexCount.toLocaleString()} splats`);

let processed = 0;
let position = dataOffset;
const inputBuffer = Buffer.alloc(ROWS_PER_CHUNK * INPUT_ROW_BYTES);

while (processed < vertexCount) {
  const rows = Math.min(ROWS_PER_CHUNK, vertexCount - processed);
  const bytesToRead = rows * INPUT_ROW_BYTES;
  const { bytesRead: chunkBytesRead } = await input.read(inputBuffer, 0, bytesToRead, position);

  if (chunkBytesRead !== bytesToRead) {
    throw new Error(`Unexpected EOF after ${processed.toLocaleString()} rows.`);
  }

  const outputBuffer = Buffer.allocUnsafe(rows * OUTPUT_ROW_BYTES);

  for (let row = 0; row < rows; row++) {
    const inBase = row * INPUT_ROW_BYTES;
    const outBase = row * OUTPUT_ROW_BYTES;

    const x = inputBuffer.readFloatLE(inBase);
    const y = inputBuffer.readFloatLE(inBase + 4);
    const z = inputBuffer.readFloatLE(inBase + 8);
    const f0 = inputBuffer.readFloatLE(inBase + 24);
    const f1 = inputBuffer.readFloatLE(inBase + 28);
    const f2 = inputBuffer.readFloatLE(inBase + 32);
    const opacity = inputBuffer.readFloatLE(inBase + 36);
    const scale0 = Math.exp(inputBuffer.readFloatLE(inBase + 40));
    const scale1 = Math.exp(inputBuffer.readFloatLE(inBase + 44));
    const scale2 = Math.exp(inputBuffer.readFloatLE(inBase + 48));
    let qx = inputBuffer.readFloatLE(inBase + 52);
    let qy = inputBuffer.readFloatLE(inBase + 56);
    let qz = inputBuffer.readFloatLE(inBase + 60);
    let qw = inputBuffer.readFloatLE(inBase + 64);

    const qLength = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= qLength;
    qy /= qLength;
    qz /= qLength;
    qw /= qLength;

    outputBuffer.writeFloatLE(x, outBase);
    outputBuffer.writeFloatLE(y, outBase + 4);
    outputBuffer.writeFloatLE(z, outBase + 8);
    outputBuffer.writeFloatLE(scale0, outBase + 12);
    outputBuffer.writeFloatLE(scale1, outBase + 16);
    outputBuffer.writeFloatLE(scale2, outBase + 20);
    outputBuffer[outBase + 24] = clampByte((0.5 + SH_C0 * f0) * 255);
    outputBuffer[outBase + 25] = clampByte((0.5 + SH_C0 * f1) * 255);
    outputBuffer[outBase + 26] = clampByte((0.5 + SH_C0 * f2) * 255);
    outputBuffer[outBase + 27] = clampByte(sigmoid(opacity) * 255);
    outputBuffer[outBase + 28] = quatByte(qw);
    outputBuffer[outBase + 29] = quatByte(qx);
    outputBuffer[outBase + 30] = quatByte(qy);
    outputBuffer[outBase + 31] = quatByte(qz);
  }

  if (!output.write(outputBuffer)) {
    await new Promise((resolve) => output.once("drain", resolve));
  }

  processed += rows;
  position += bytesToRead;

  if (processed % (ROWS_PER_CHUNK * 16) === 0 || processed === vertexCount) {
    console.log(`${processed.toLocaleString()} / ${vertexCount.toLocaleString()} splats`);
  }
}

await input.close();
await new Promise((resolve, reject) => {
  output.end(resolve);
  output.on("error", reject);
});

console.log(`Wrote ${outputPath}`);
