/**
 * Install Cursor rule into the consuming project's .cursor/rules/ (npm postinstall).
 * Skip: AGENT_MEMORY_SKIP_CURSOR_RULE=1, CI=true, global install, or when installing deps inside this repo.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

if (process.env.AGENT_MEMORY_SKIP_CURSOR_RULE === "1") process.exit(0);
if (process.env.CI === "true") process.exit(0);
if (process.env.npm_config_global === "true") process.exit(0);

const ruleSrc = path.join(pkgRoot, "cursor-rules", "memory-five-layers.mdc");
if (!fs.existsSync(ruleSrc)) process.exit(0);

/** True when this copy lives under node_modules (installed as a dependency). */
const installedAsDependency = pkgRoot.split(path.sep).includes("node_modules");
try {
  const selfPkg = path.join(pkgRoot, "package.json");
  if (fs.existsSync(selfPkg)) {
    const j = JSON.parse(fs.readFileSync(selfPkg, "utf8"));
    if (j.name === "@inosx/agent-memory" && !installedAsDependency) {
      // Clone / npm pack expanded locally — never write outside this repo
      process.exit(0);
    }
  }
} catch {
  /* ignore */
}

const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : null;
if (initCwd && path.resolve(pkgRoot) === initCwd) {
  // `npm install` run at package root (developing @inosx/agent-memory) — do not copy upward
  process.exit(0);
}

function findConsumerRoot(startFromDir) {
  let d = path.resolve(startFromDir);
  for (;;) {
    const pkgPath = path.join(d, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const j = JSON.parse(raw);
        if (j.name && j.name !== "@inosx/agent-memory") return d;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

function isConsumerPackageRoot(dir) {
  const p = path.join(dir, "package.json");
  if (!fs.existsSync(p)) return false;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.name && j.name !== "@inosx/agent-memory";
  } catch {
    return false;
  }
}

let targetRoot = null;
if (initCwd && isConsumerPackageRoot(initCwd)) targetRoot = initCwd;
if (!targetRoot) targetRoot = findConsumerRoot(path.dirname(pkgRoot));
if (!targetRoot) process.exit(0);

const destDir = path.join(targetRoot, ".cursor", "rules");
const destFile = path.join(destDir, "memory-five-layers.mdc");

try {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(ruleSrc, destFile);
  if (process.env.AGENT_MEMORY_VERBOSE === "1") {
    console.log(`[@inosx/agent-memory] Cursor rule installed: ${destFile}`);
  }
} catch (e) {
  if (process.env.AGENT_MEMORY_VERBOSE === "1") {
    console.warn("[@inosx/agent-memory] postinstall cursor rule:", e);
  }
}
