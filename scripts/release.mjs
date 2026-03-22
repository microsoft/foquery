#!/usr/bin/env node
/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const packages = [
  "packages/foquery/package.json",
  "packages/foquery-react/package.json",
  "packages/foquery-dom/package.json",
];

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(resolve(root, path), JSON.stringify(data, null, 2) + "\n");
}

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

function currentVersion() {
  return readJson(packages[0]).version;
}

function bumpVersion(current, bump) {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (bump) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      // Exact version
      if (!/^\d+\.\d+\.\d+/.test(bump)) {
        throw new Error(`Invalid version: ${bump}`);
      }
      return bump;
  }
}

function updatePackageVersions(newVersion) {
  for (const pkgPath of packages) {
    const pkg = readJson(pkgPath);
    pkg.version = newVersion;

    // Update foquery dependency in foquery-react and foquery-dom
    if (pkg.dependencies?.foquery) {
      pkg.dependencies.foquery = `^${newVersion}`;
    }

    writeJson(pkgPath, pkg);
    console.log(`  ${pkg.name} → ${newVersion}`);
  }
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const current = currentVersion();
  console.log(`Current version: ${current}`);

  // Check for clean working tree
  try {
    execSync("git diff-index --quiet HEAD --", { cwd: root });
  } catch {
    console.error("Error: Working tree has uncommitted changes. Commit or stash them first.");
    process.exit(1);
  }

  // Ask for version bump
  const answer = await prompt("Release type (patch / minor / major) or exact version: ");

  if (!answer) {
    console.log("Aborted.");
    process.exit(0);
  }

  const newVersion = bumpVersion(current, answer);
  console.log(`\nBumping to ${newVersion}:`);
  updatePackageVersions(newVersion);

  // Run full pipeline
  console.log("\nRunning full pipeline...");
  run("npm run all");

  // Copy LICENSE
  run(
    "cp LICENSE packages/foquery/ && cp LICENSE packages/foquery-react/ && cp LICENSE packages/foquery-dom/",
  );

  // Commit and tag
  run(
    `git add packages/foquery/package.json packages/foquery-react/package.json packages/foquery-dom/package.json`,
  );
  run(`git commit -m "v${newVersion}"`);
  run(`git tag v${newVersion}`);

  // Confirm publish
  const confirmPublish = await prompt(
    `\nPublish foquery, foquery-react, foquery-dom@${newVersion} to npm? (y/N) `,
  );

  if (confirmPublish.toLowerCase() !== "y") {
    console.log(
      "Skipped publish. Commit and tag are ready. Run 'git push && git push --tags' when ready.",
    );
    process.exit(0);
  }

  // Publish
  run("npm -w foquery publish");
  run("npm -w foquery-react publish");
  run("npm -w foquery-dom publish");

  // Push
  const confirmPush = await prompt("\nPush commit and tag to origin? (y/N) ");
  if (confirmPush.toLowerCase() === "y") {
    run("git push && git push --tags");
  }

  console.log(`\nReleased v${newVersion}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
