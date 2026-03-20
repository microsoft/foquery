import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const srcDir = path.join(packageDir, "src");
const distDir = path.join(packageDir, "dist");

await rm(distDir, { recursive: true, force: true });
await execFileAsync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: packageDir });
await copyStaticAssets(srcDir, distDir);

async function copyStaticAssets(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyStaticAssets(sourcePath, targetPath);
      continue;
    }
    if (path.extname(entry.name) === ".ts" || path.extname(entry.name) === ".d.ts") {
      continue;
    }
    const entryStat = await stat(sourcePath);
    if (!entryStat.isFile()) {
      continue;
    }
    const contents = await readFile(sourcePath);
    await writeFile(targetPath, contents);
  }
}
