import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CoverType } from "./identity.js";
import { buildCoverSvg } from "./covers.js";
import { logger } from "../utils/logger.js";

const COVERS_DIR = join(process.cwd(), "data", "covers");

export async function generateCoverPng(type: CoverType): Promise<Buffer> {
  const svg = buildCoverSvg(type);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function saveCoverPreview(type: CoverType, buffer: Buffer): Promise<string> {
  await mkdir(COVERS_DIR, { recursive: true });
  const filename = `${type}-${Date.now()}.png`;
  const path = join(COVERS_DIR, filename);
  await writeFile(path, buffer);
  logger.info(`Cover saved: ${path}`);
  return path;
}
