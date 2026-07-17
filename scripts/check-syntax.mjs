import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const sourceRoots = ["src", "scripts", "test"];
const files = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (extname(path) === ".js" || extname(path) === ".mjs") files.push(path);
  }
}

for (const root of sourceRoots) await collect(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax check passed for ${files.length} JavaScript modules.`);
