#!/usr/bin/env node
/**
 * Builds the installable WordPress plugin zip.
 *
 *   npm run wp:package
 *
 * Output: public/downloads/leadforge-connector-<version>.zip
 *
 * The zip contains a single top-level `leadforge-connector/` directory, which is
 * what WordPress expects when you use Plugins → Add New → Upload Plugin. The zip
 * is also served by the app itself at /downloads/leadforge-connector-<version>.zip,
 * so an operator can hand it to whoever administers the WordPress site.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "wordpress-plugin", "leadforge-connector");
const outDir = path.join(root, "public", "downloads");

function pluginVersion() {
  const main = fs.readFileSync(path.join(source, "leadforge-connector.php"), "utf8");
  const match = main.match(/^\s*\*\s*Version:\s*(.+)$/m);
  if (!match) throw new Error("Could not read Version from leadforge-connector.php");
  return match[1].trim();
}

function main() {
  if (!fs.existsSync(source)) throw new Error(`Plugin source not found at ${source}`);

  const version = pluginVersion();
  const zipName = `leadforge-connector-${version}.zip`;
  fs.mkdirSync(outDir, { recursive: true });

  const zipPath = path.join(outDir, zipName);
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

  // `-x` keeps editor/OS clutter out of the package.
  execFileSync(
    "zip",
    ["-r", "-q", zipPath, "leadforge-connector", "-x", "*.DS_Store", "-x", "*/.*"],
    { cwd: path.join(root, "wordpress-plugin"), stdio: "inherit" },
  );

  // A zip we cannot list is a zip nobody should trust.
  const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
  const entries = listing
    .split("\n")
    .filter((line) => line.includes("leadforge-connector/"))
    .map((line) => line.trim().split(/\s+/).pop());

  const size = fs.statSync(zipPath).size;
  console.log(`\nPackaged ${zipName}`);
  console.log(`  ${entries.length} files · ${(size / 1024).toFixed(1)} KB`);
  console.log(`  ${path.relative(root, zipPath)}`);
  console.log(`  downloadable at /downloads/${zipName}\n`);
  console.log("Install: WordPress → Plugins → Add New → Upload Plugin → choose this zip.");
}

main();
