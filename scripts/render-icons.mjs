// Renders icons/logo.svg to the PNG sizes Chrome wants.
// Usage: node scripts/render-icons.mjs   (needs: npm i -D sharp)
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = await readFile(path.join(root, "icons/logo.svg"));

for (const size of [16, 32, 48, 128]) {
  const out = path.join(root, `icons/icon${size}.png`);
  await sharp(svg, { density: (72 * size) / 128 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}
