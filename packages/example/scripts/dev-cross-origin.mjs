#!/usr/bin/env node
/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { get } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(__dirname, "..");
const viteBin = resolve(exampleRoot, "../../node_modules/vite/bin/vite.js");
const servers = [
  { name: "parent app", port: 5173 },
  { name: "primary iframe app", port: 5174 },
  { name: "secondary iframe app", port: 5175 },
  { name: "nested iframe app", port: 5176 },
  { name: "level-3 iframe app", port: 5177 },
];
let shuttingDown = false;
const children = [];

try {
  await assertPortsAvailable();
  startServers();
  await waitForServers();
  printReadySummary();
} catch (error) {
  shutdown();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function startServers() {
  for (const server of servers) {
    const child = spawn(
      process.execPath,
      [viteBin, "--host", "127.0.0.1", "--port", String(server.port), "--strictPort"],
      {
        cwd: exampleRoot,
        env: {
          ...process.env,
          FORCE_COLOR: "1",
        },
        stdio: ["inherit", "pipe", "pipe"],
      },
    );

    const output = [];
    const recordOutput = (data) => {
      output.push(data.toString());
      if (output.length > 20) output.shift();
    };

    child.stdout.on("data", recordOutput);
    child.stderr.on("data", recordOutput);

    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      stopChildren(child);
      console.error(
        `FoQuery ${server.name} dev server exited unexpectedly` +
          ` (${signal ? `signal ${signal}` : `code ${code ?? 0}`}).`,
      );
      const details = output.join("").trim();
      if (details) console.error(details);
      process.exitCode = code ?? (signal ? 1 : 0);
    });

    children.push(child);
  }
}

async function assertPortsAvailable() {
  const unavailablePorts = [];
  for (const server of servers) {
    const available = await isPortAvailable(server.port);
    if (!available) unavailablePorts.push(server);
  }

  if (unavailablePorts.length === 0) return;

  console.error("FoQuery example dev servers require fixed ports for cross-origin iframe demos.");
  for (const server of unavailablePorts) {
    console.error(`Port ${server.port} is already in use (${server.name}).`);
  }
  console.error("Stop the process using the port and run npm run dev again.");
  process.exit(1);
}

function isPortAvailable(port) {
  return new Promise((resolveAvailable) => {
    const server = createServer()
      .once("error", () => resolveAvailable(false))
      .once("listening", () => {
        server.close(() => resolveAvailable(true));
      })
      .listen(port, "127.0.0.1");
  });
}

async function waitForServers() {
  await Promise.all(servers.map((server) => waitForHttpReady(`http://127.0.0.1:${server.port}/`)));
}

function waitForHttpReady(url) {
  const startedAt = Date.now();
  const timeoutMs = 15000;

  return new Promise((resolveReady, rejectReady) => {
    const check = () => {
      const req = get(url, (res) => {
        res.resume();
        resolveReady();
      });

      req.on("error", (error) => {
        if (Date.now() - startedAt > timeoutMs) {
          rejectReady(new Error(`Timed out waiting for ${url}: ${error.message}`));
          return;
        }
        setTimeout(check, 100);
      });
      req.setTimeout(1000, () => {
        req.destroy(new Error(`Timed out connecting to ${url}`));
      });
    };

    check();
  });
}

function printReadySummary() {
  console.log("\nFoQuery cross-origin example is ready.");
  console.log(`Open: http://127.0.0.1:${servers[0].port}/`);
  console.log("\nFixed dev server ports:");
  for (const server of servers) {
    console.log(`- ${server.name}: http://127.0.0.1:${server.port}/`);
  }
  console.log("\nPress Ctrl+C to stop all servers.");
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) continue;
    child.kill();
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChildren();
}

process.on("SIGINT", () => {
  shutdown();
  process.exit();
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit();
});

process.on("SIGHUP", () => {
  shutdown();
  process.exit();
});

process.on("exit", shutdown);
