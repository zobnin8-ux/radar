import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CoverType } from "./identity.js";
import { generateCoverPng } from "./generateCover.js";

const ALL_TYPES: CoverType[] = [
  "observation",
  "signal",
  "impact",
  "breakthrough",
  "failure",
  "digest",
  "trends",
  "in-the-box",
];

export async function generateAllCoverPreviews(): Promise<void> {
  const dir = join(process.cwd(), "data", "covers");
  await mkdir(dir, { recursive: true });

  for (const type of ALL_TYPES) {
    const buffer = await generateCoverPng(type);
    await writeFile(join(dir, `preview-${type}.png`), buffer);
    console.log(`Generated: data/covers/preview-${type}.png`);
  }
}

const isMain = process.argv[1]?.includes("previewCovers");
if (isMain) {
  generateAllCoverPreviews().catch(console.error);
}
