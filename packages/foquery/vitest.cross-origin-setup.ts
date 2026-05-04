/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestProject } from "vitest/node";

export interface CrossOriginTestServers {
  primaryOrigin: string;
  siblingOrigin: string;
  nestedOrigin: string;
  levelThreeOrigin: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    trueCrossOriginServers: CrossOriginTestServers;
  }
}

type RouteHandler = (url: URL) => string;

interface TestServer {
  origin: string;
  server: Server;
}

export async function setup(project: TestProject) {
  const levelThreeServer = await startServer({
    "/level-three.html": () => createFrameDocument(levelThreeFrameScript()),
  });
  const nestedServer = await startServer({
    "/nested.html": () => createFrameDocument(nestedFrameScript()),
  });
  const primaryServer = await startServer({
    "/primary.html": () => createFrameDocument(primaryFrameScript()),
  });
  const siblingServer = await startServer({
    "/leaf.html": () => createFrameDocument(leafFrameScript()),
  });

  project.provide("trueCrossOriginServers", {
    primaryOrigin: primaryServer.origin,
    siblingOrigin: siblingServer.origin,
    nestedOrigin: nestedServer.origin,
    levelThreeOrigin: levelThreeServer.origin,
  });

  return async () => {
    await Promise.all([
      closeServer(primaryServer.server),
      closeServer(siblingServer.server),
      closeServer(nestedServer.server),
      closeServer(levelThreeServer.server),
    ]);
  };
}

async function startServer(routes: Record<string, RouteHandler>): Promise<TestServer> {
  const server = createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end("Missing URL");
      return;
    }

    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url, `http://${host}`);
    const route = routes[url.pathname];

    if (!route) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(route(url));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createFrameDocument(script: string): string {
  return `<!doctype html><html><body><script>${script.replace(
    /<\/script/gi,
    "<\\/script",
  )}</script></body></html>`;
}

function leafFrameScript(): string {
  return `
    const params = new URLSearchParams(location.search);
    const frameId = params.get("frameId");
    const parentOrigin = params.get("parentOrigin") || "*";
    const label = params.get("label") || "Default";
    const pendingTestRequests = new Map();

    const button = document.createElement("button");
    button.textContent = label + " focusable";
    document.body.appendChild(button);

    const send = (message) => window.parent.postMessage({
      source: "foquery",
      version: 1,
      frameId,
      ...message,
    }, parentOrigin);

    const postTreeState = () => {
      send({
        type: "tree-state",
        snapshot: {
          type: "parent",
          name: "FrameRoot",
          children: [{
            type: "parent",
            name: "Card",
            children: [{ type: "leaf", name: "DefaultFocusable" }],
          }],
        },
      });
    };

    const announce = () => {
      send({ type: "child-ready" });
      postTreeState();
    };

    window.addEventListener("message", (event) => {
      if (parentOrigin !== "*" && event.origin !== parentOrigin) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.source === "foquery" && message.version === 1 && message.frameId === frameId) {
        if (message.type === "delegate-focus") {
          if (message.xpath === "//Card/DefaultFocusable") {
            button.focus();
            send({ type: "focus-result", requestId: message.requestId, status: 2 });
          } else {
            send({ type: "focus-result", requestId: message.requestId, status: 5 });
          }
        } else if (message.type === "focus-result") {
          const testRequest = pendingTestRequests.get(message.requestId);
          if (!testRequest) return;
          pendingTestRequests.delete(message.requestId);
          window.parent.postMessage({
            source: "foquery-test",
            type: "request-result",
            frameId,
            status: message.status,
            testRequest,
          }, parentOrigin);
        }
        return;
      }

      if (message.source === "foquery-test" && message.type === "request-focus") {
        const requestId = "leaf-test-request-" + Math.random().toString(36).slice(2);
        pendingTestRequests.set(requestId, message.testRequest || message.xpath);
        send({
          type: "request-focus",
          requestId,
          xpath: message.xpath,
          options: { timeout: 3000 },
        });
      }
    });

    announce();
    setTimeout(announce, 0);
    let repeats = 0;
    const interval = setInterval(() => {
      repeats += 1;
      postTreeState();
      if (repeats >= 5) clearInterval(interval);
    }, 50);
  `;
}

function primaryFrameScript(): string {
  return `
    const params = new URLSearchParams(location.search);
    const frameId = params.get("frameId");
    const parentOrigin = params.get("parentOrigin") || "*";
    const nestedOrigin = params.get("nestedOrigin");
    const nestedFrameId = params.get("nestedFrameId");
    const levelThreeOrigin = params.get("levelThreeOrigin");
    const levelThreeFrameId = params.get("levelThreeFrameId");
    const pendingNestedDelegates = new Map();
    const pendingNestedRequests = new Map();
    const pendingTestRequests = new Map();

    let nestedSnapshot = { type: "parent", name: "NestedFrameRoot", children: [] };

    const button = document.createElement("button");
    button.textContent = "Primary focusable";
    document.body.appendChild(button);

    const nestedIframe = document.createElement("iframe");
    nestedIframe.src = nestedOrigin + "/nested.html?frameId=" + encodeURIComponent(nestedFrameId) +
      "&parentOrigin=" + encodeURIComponent(location.origin) +
      "&levelThreeOrigin=" + encodeURIComponent(levelThreeOrigin) +
      "&levelThreeFrameId=" + encodeURIComponent(levelThreeFrameId);

    const send = (message) => window.parent.postMessage({
      source: "foquery",
      version: 1,
      frameId,
      ...message,
    }, parentOrigin);

    const postTreeState = () => {
      send({
        type: "tree-state",
        snapshot: {
          type: "parent",
          name: "FrameRoot",
          children: [{
            type: "parent",
            name: "Card",
            children: [
              { type: "leaf", name: "DefaultFocusable" },
              {
                type: "parent",
                name: "NestedArea",
                children: [{
                  type: "parent",
                  name: "NestedCardInIframe",
                  iframe: true,
                  children: nestedSnapshot.children || [],
                }],
              },
            ],
          }],
        },
      });
    };

    const announce = () => {
      send({ type: "child-ready" });
      postTreeState();
    };

    const toNestedXPath = (xpath) => {
      const prefix = "//Card/NestedArea/NestedCardInIframe";
      if (!xpath.startsWith(prefix)) return undefined;
      return "//" + xpath.slice(prefix.length).replace(/^\\/+/, "");
    };

    const delegateToNested = (topRequestId, xpath, options) => {
      const nestedXPath = toNestedXPath(xpath);
      if (!nestedXPath) return false;
      const nestedRequestId = "primary-nested-delegate-" + Math.random().toString(36).slice(2);
      pendingNestedDelegates.set(nestedRequestId, topRequestId);
      nestedIframe.contentWindow.postMessage({
        source: "foquery",
        version: 1,
        type: "delegate-focus",
        frameId: nestedFrameId,
        requestId: nestedRequestId,
        xpath: nestedXPath,
        options,
      }, nestedOrigin);
      return true;
    };

    const forwardNestedRequest = (message) => {
      const topRequestId = "primary-forwarded-nested-request-" + Math.random().toString(36).slice(2);
      pendingNestedRequests.set(topRequestId, {
        nestedRequestId: message.requestId,
        nestedFrameId: message.frameId,
      });
      send({
        type: "request-focus",
        requestId: topRequestId,
        xpath: message.xpath,
        options: message.options,
      });
    };

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (event.origin === nestedOrigin && message.source === "foquery" && message.version === 1 && message.frameId === nestedFrameId) {
        if (message.type === "tree-state") {
          nestedSnapshot = message.snapshot;
          postTreeState();
        } else if (message.type === "focus-result") {
          const topRequestId = pendingNestedDelegates.get(message.requestId);
          if (!topRequestId) return;
          pendingNestedDelegates.delete(message.requestId);
          send({ type: "focus-result", requestId: topRequestId, status: message.status });
        } else if (message.type === "request-focus") {
          forwardNestedRequest(message);
        }
        return;
      }

      if (event.origin === nestedOrigin && message.source === "foquery-test" && message.type === "request-result") {
        window.parent.postMessage(message, parentOrigin);
        return;
      }

      if (parentOrigin !== "*" && event.origin !== parentOrigin) return;

      if (message.source === "foquery" && message.version === 1 && message.frameId === frameId) {
        if (message.type === "delegate-focus") {
          if (message.xpath === "//Card/DefaultFocusable") {
            button.focus();
            send({ type: "focus-result", requestId: message.requestId, status: 2 });
          } else if (!delegateToNested(message.requestId, message.xpath, message.options)) {
            send({ type: "focus-result", requestId: message.requestId, status: 5 });
          }
        } else if (message.type === "focus-result") {
          const nestedRequest = pendingNestedRequests.get(message.requestId);
          if (nestedRequest) {
            pendingNestedRequests.delete(message.requestId);
            nestedIframe.contentWindow.postMessage({
              source: "foquery",
              version: 1,
              type: "focus-result",
              frameId: nestedRequest.nestedFrameId,
              requestId: nestedRequest.nestedRequestId,
              status: message.status,
            }, nestedOrigin);
            return;
          }

          const testRequest = pendingTestRequests.get(message.requestId);
          if (!testRequest) return;
          pendingTestRequests.delete(message.requestId);
          window.parent.postMessage({
            source: "foquery-test",
            type: "request-result",
            frameId,
            status: message.status,
            testRequest,
          }, parentOrigin);
        }
        return;
      }

      if (message.source === "foquery-test" && message.type === "request-focus") {
        const requestId = "primary-test-request-" + Math.random().toString(36).slice(2);
        pendingTestRequests.set(requestId, message.testRequest || message.xpath);
        send({
          type: "request-focus",
          requestId,
          xpath: message.xpath,
          options: { timeout: 3000 },
        });
      } else if (message.source === "foquery-test" && message.type === "nested-request-focus") {
        nestedIframe.contentWindow.postMessage({
          source: "foquery-test",
          type: "request-focus",
          xpath: message.xpath,
          testRequest: message.testRequest,
        }, nestedOrigin);
      }
    });

    document.body.appendChild(nestedIframe);
    announce();
    setTimeout(announce, 0);
    let repeats = 0;
    const interval = setInterval(() => {
      repeats += 1;
      postTreeState();
      if (repeats >= 5) clearInterval(interval);
    }, 50);
  `;
}

function nestedFrameScript(): string {
  return `
    const params = new URLSearchParams(location.search);
    const frameId = params.get("frameId");
    const parentOrigin = params.get("parentOrigin") || "*";
    const levelThreeOrigin = params.get("levelThreeOrigin");
    const levelThreeFrameId = params.get("levelThreeFrameId");
    const pendingLevelThreeDelegates = new Map();
    const pendingLevelThreeRequests = new Map();
    const pendingTestRequests = new Map();

    let levelThreeSnapshot = { type: "parent", name: "LevelThreeFrameRoot", children: [] };

    const button = document.createElement("button");
    button.textContent = "Nested focusable";
    document.body.appendChild(button);

    const levelThreeIframe = document.createElement("iframe");
    levelThreeIframe.src = levelThreeOrigin + "/level-three.html?frameId=" + encodeURIComponent(levelThreeFrameId) +
      "&parentOrigin=" + encodeURIComponent(location.origin);

    const send = (message) => window.parent.postMessage({
      source: "foquery",
      version: 1,
      frameId,
      ...message,
    }, parentOrigin);

    const postTreeState = () => {
      send({
        type: "tree-state",
        snapshot: {
          type: "parent",
          name: "NestedFrameRoot",
          children: [{
            type: "parent",
            name: "NestedCard",
            children: [
              { type: "leaf", name: "DeepFocusable" },
              {
                type: "parent",
                name: "LevelThreeFrame",
                iframe: true,
                children: levelThreeSnapshot.children || [],
              },
            ],
          }],
        },
      });
    };

    const announce = () => {
      send({ type: "child-ready" });
      postTreeState();
    };

    const toLevelThreeXPath = (xpath) => {
      const prefix = "//NestedCard/LevelThreeFrame";
      if (!xpath.startsWith(prefix)) return undefined;
      return "//" + xpath.slice(prefix.length).replace(/^\\/+/, "");
    };

    const delegateToLevelThree = (parentRequestId, xpath, options) => {
      const levelThreeXPath = toLevelThreeXPath(xpath);
      if (!levelThreeXPath) return false;
      const levelThreeRequestId = "nested-level-three-delegate-" + Math.random().toString(36).slice(2);
      pendingLevelThreeDelegates.set(levelThreeRequestId, parentRequestId);
      levelThreeIframe.contentWindow.postMessage({
        source: "foquery",
        version: 1,
        type: "delegate-focus",
        frameId: levelThreeFrameId,
        requestId: levelThreeRequestId,
        xpath: levelThreeXPath,
        options,
      }, levelThreeOrigin);
      return true;
    };

    const forwardLevelThreeRequest = (message) => {
      const parentRequestId = "nested-forwarded-level-three-request-" + Math.random().toString(36).slice(2);
      pendingLevelThreeRequests.set(parentRequestId, {
        levelThreeRequestId: message.requestId,
        levelThreeFrameId: message.frameId,
      });
      send({
        type: "request-focus",
        requestId: parentRequestId,
        xpath: message.xpath,
        options: message.options,
      });
    };

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (event.origin === levelThreeOrigin && message.source === "foquery" && message.version === 1 && message.frameId === levelThreeFrameId) {
        if (message.type === "tree-state") {
          levelThreeSnapshot = message.snapshot;
          postTreeState();
        } else if (message.type === "focus-result") {
          const parentRequestId = pendingLevelThreeDelegates.get(message.requestId);
          if (!parentRequestId) return;
          pendingLevelThreeDelegates.delete(message.requestId);
          send({ type: "focus-result", requestId: parentRequestId, status: message.status });
        } else if (message.type === "request-focus") {
          forwardLevelThreeRequest(message);
        }
        return;
      }

      if (parentOrigin !== "*" && event.origin !== parentOrigin) return;

      if (message.source === "foquery" && message.version === 1 && message.frameId === frameId) {
        if (message.type === "delegate-focus") {
          if (message.xpath === "//NestedCard/DeepFocusable") {
            button.focus();
            send({ type: "focus-result", requestId: message.requestId, status: 2 });
          } else if (!delegateToLevelThree(message.requestId, message.xpath, message.options)) {
            send({ type: "focus-result", requestId: message.requestId, status: 5 });
          }
        } else if (message.type === "focus-result") {
          const levelThreeRequest = pendingLevelThreeRequests.get(message.requestId);
          if (levelThreeRequest) {
            pendingLevelThreeRequests.delete(message.requestId);
            levelThreeIframe.contentWindow.postMessage({
              source: "foquery",
              version: 1,
              type: "focus-result",
              frameId: levelThreeRequest.levelThreeFrameId,
              requestId: levelThreeRequest.levelThreeRequestId,
              status: message.status,
            }, levelThreeOrigin);
            return;
          }

          const testRequest = pendingTestRequests.get(message.requestId);
          if (!testRequest) return;
          pendingTestRequests.delete(message.requestId);
          window.parent.postMessage({
            source: "foquery-test",
            type: "request-result",
            frameId,
            status: message.status,
            testRequest,
          }, parentOrigin);
        }
        return;
      }

      if (message.source === "foquery-test" && message.type === "request-focus") {
        const requestId = "nested-test-request-" + Math.random().toString(36).slice(2);
        pendingTestRequests.set(requestId, message.testRequest || message.xpath);
        send({
          type: "request-focus",
          requestId,
          xpath: message.xpath,
          options: { timeout: 3000 },
        });
      }
    });

    document.body.appendChild(levelThreeIframe);
    announce();
    setTimeout(announce, 0);
    let repeats = 0;
    const interval = setInterval(() => {
      repeats += 1;
      postTreeState();
      if (repeats >= 5) clearInterval(interval);
    }, 50);
  `;
}

function levelThreeFrameScript(): string {
  return `
    const params = new URLSearchParams(location.search);
    const frameId = params.get("frameId");
    const parentOrigin = params.get("parentOrigin") || "*";
    const pendingTestRequests = new Map();

    const button = document.createElement("button");
    button.textContent = "Level three focusable";
    document.body.appendChild(button);

    const send = (message) => window.parent.postMessage({
      source: "foquery",
      version: 1,
      frameId,
      ...message,
    }, parentOrigin);

    const postTreeState = () => {
      send({
        type: "tree-state",
        snapshot: {
          type: "parent",
          name: "LevelThreeFrameRoot",
          children: [{
            type: "parent",
            name: "LevelThreeCard",
            children: [{ type: "leaf", name: "DeepestFocusable" }],
          }],
        },
      });
    };

    const announce = () => {
      send({ type: "child-ready" });
      postTreeState();
    };

    window.addEventListener("message", (event) => {
      if (parentOrigin !== "*" && event.origin !== parentOrigin) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.source === "foquery" && message.version === 1 && message.frameId === frameId) {
        if (message.type === "delegate-focus") {
          if (message.xpath === "//LevelThreeCard/DeepestFocusable") {
            button.focus();
            send({ type: "focus-result", requestId: message.requestId, status: 2 });
          } else {
            send({ type: "focus-result", requestId: message.requestId, status: 5 });
          }
        } else if (message.type === "focus-result") {
          const testRequest = pendingTestRequests.get(message.requestId);
          if (!testRequest) return;
          pendingTestRequests.delete(message.requestId);
          window.parent.postMessage({
            source: "foquery-test",
            type: "request-result",
            frameId,
            status: message.status,
            testRequest,
          }, parentOrigin);
        }
        return;
      }

      if (message.source === "foquery-test" && message.type === "request-focus") {
        const requestId = "level-three-test-request-" + Math.random().toString(36).slice(2);
        pendingTestRequests.set(requestId, message.testRequest || message.xpath);
        send({
          type: "request-focus",
          requestId,
          xpath: message.xpath,
          options: { timeout: 3000 },
        });
      }
    });

    announce();
    setTimeout(announce, 0);
    let repeats = 0;
    const interval = setInterval(() => {
      repeats += 1;
      postTreeState();
      if (repeats >= 5) clearInterval(interval);
    }, 50);
  `;
}
