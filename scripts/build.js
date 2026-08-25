/**
 * Build script for MCP Inspector → Langfuse Chrome extension.
 * Run after `tsc`. Copies static files + icons into dist/ and packs a Chrome Web Store zip.
 */

import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "dist");
const assetsIconsDir = join(rootDir, "assets", "icons");

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const version = packageJson.version || "1.0.0";
const zipName = `mcp-inspector-to-langfuse-v${version}.zip`;
const zipPath = join(rootDir, zipName);

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest, label) {
  copyFileSync(src, dest);
  console.log(`✓ Copied ${label}`);
}

ensureDir(distDir);

const filesToCopy = ["manifest.json", "converter.html", "converter.css"];
for (const file of filesToCopy) {
  const src = join(rootDir, file);
  if (!existsSync(src)) {
    console.error(`✗ Missing required file: ${file}`);
    process.exit(1);
  }
  copyFile(src, join(distDir, file), file);
}

const compiledJs = ["background.js", "convert.js", "ui.js"];
for (const file of compiledJs) {
  if (!existsSync(join(distDir, file))) {
    console.error(
      `✗ Missing compiled ${file}. Run \`tsc\` before this script (use \`npm run build\`).`,
    );
    process.exit(1);
  }
  console.log(`✓ Found compiled ${file}`);
}

const iconsDir = join(distDir, "icons");
ensureDir(iconsDir);

const iconMappings = [
  { src: "icon_16px.png", dest: "icon16.png" },
  { src: "icon_32px.png", dest: "icon32.png" },
  { src: "icon_48px.png", dest: "icon48.png" },
  { src: "icon_128px.png", dest: "icon128.png" },
];

if (!existsSync(assetsIconsDir)) {
  console.error(`✗ Missing icons folder: assets/icons`);
  console.error(
    "  Add icon_16px.png, icon_32px.png, icon_48px.png, icon_128px.png there.",
  );
  process.exit(1);
}

let missingIcons = 0;
for (const { src, dest } of iconMappings) {
  const srcPath = join(assetsIconsDir, src);
  const destPath = join(iconsDir, dest);
  if (!existsSync(srcPath)) {
    console.error(`✗ Missing icon: assets/icons/${src}`);
    missingIcons += 1;
    continue;
  }
  copyFile(srcPath, destPath, `icons/${dest}`);
}

if (missingIcons > 0) {
  console.error(
    `\n✗ ${missingIcons} icon(s) missing. Chrome Web Store requires all four sizes.`,
  );
  process.exit(1);
}

if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

const zipResult = spawnSync(
  "zip",
  ["-r", "-X", zipPath, ".", "-x", "*.DS_Store", "*__MACOSX*"],
  { cwd: distDir, encoding: "utf8" },
);

if (zipResult.status !== 0) {
  console.error("✗ Failed to create zip:", zipResult.stderr || zipResult.error);
  process.exit(1);
}

const zipSizeKb = Math.round(statSync(zipPath).size / 1024);
console.log(`\n✓ Packed ${zipName} (${zipSizeKb} KB)`);
console.log("📦 Build complete.");
console.log(
  '   Load "dist/" as an unpacked extension, or upload the zip to the Chrome Web Store.',
);
