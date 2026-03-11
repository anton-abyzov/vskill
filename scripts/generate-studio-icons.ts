#!/usr/bin/env npx tsx
/**
 * One-time generation script for Skill Studio plugin group icons
 * Uses Nano Banana Pro (gemini-3-pro-image-preview) via VertexAI to generate
 * minimalist line-art icons for each plugin group.
 *
 * Usage: npx tsx scripts/generate-studio-icons.ts [plugin1 plugin2 ...]
 *
 * If no plugins specified, generates icons for common plugin names.
 * Also generates empty-state illustration at public/images/empty-studio.webp.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error("Error: GOOGLE_API_KEY environment variable is required");
  process.exit(1);
}

const MODEL = "gemini-3-pro-image-preview";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
const ICONS_DIR = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../src/eval-ui/public/images/icons",
);
const IMAGES_DIR = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../src/eval-ui/public/images",
);

const DEFAULT_PLUGINS = [
  "core",
  "frontend",
  "backend",
  "testing",
  "security",
  "devops",
  "mobile",
  "data",
  "ai",
  "marketing",
];

async function generateImage(
  prompt: string,
  outputPath: string,
): Promise<void> {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("No content in response");

  const imagePart = parts.find(
    (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData,
  );
  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, buffer);
  console.log(`  Generated: ${outputPath} (${buffer.length} bytes)`);
}

async function main() {
  const args = process.argv.slice(2);
  const plugins = args.length > 0 ? args : DEFAULT_PLUGINS;

  console.log("Generating Skill Studio icons via Nano Banana Pro...\n");

  // Generate plugin icons (32x32)
  for (const plugin of plugins) {
    const outputPath = resolve(ICONS_DIR, `${plugin}.webp`);
    if (existsSync(outputPath)) {
      console.log(`  Skipping ${plugin} (already exists)`);
      continue;
    }
    const prompt = `Minimalist line-art icon representing "${plugin}" software development concept, white lines on transparent background, 32x32 pixels, single subject, no text, clean geometric style`;
    try {
      await generateImage(prompt, outputPath);
    } catch (err) {
      console.error(
        `  Failed: ${plugin} — ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Generate empty-state illustration (128x128)
  const emptyStatePath = resolve(IMAGES_DIR, "empty-studio.webp");
  if (!existsSync(emptyStatePath)) {
    console.log("\nGenerating empty-state illustration...");
    const prompt =
      "Minimalist illustration of a skill workbench or laboratory, soft muted colors, theme-neutral, 128x128 pixels, no text, clean modern design, subtle geometric shapes";
    try {
      await generateImage(prompt, emptyStatePath);
    } catch (err) {
      console.error(
        `  Failed: empty-state — ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
