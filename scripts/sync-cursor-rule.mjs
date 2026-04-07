/**
 * Copy .cursor/rules/memory-five-layers.mdc → cursor-rules/ (run before publish from repo root).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, ".cursor", "rules", "memory-five-layers.mdc");
const destDir = path.join(root, "cursor-rules");
const dest = path.join(destDir, "memory-five-layers.mdc");

if (!fs.existsSync(src)) {
  console.warn("sync-cursor-rule: source missing:", src);
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("sync-cursor-rule: updated cursor-rules/memory-five-layers.mdc");
