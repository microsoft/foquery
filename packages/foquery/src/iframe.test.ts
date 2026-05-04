/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect, inject, vi } from "vitest";
import { FoQueryRootNode } from "./foquery-root-node";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";
import { RequestStatus } from "./consts";
import type * as Types from "./types";
import {
  FOQUERY_FRAME_MESSAGE_SOURCE,
  FOQUERY_FRAME_MESSAGE_VERSION,
  FoQueryIFrameParentNode,
  connectFoQueryChildFrame,
  serializeFoQueryTree,
} from "./iframe";

interface CrossOriginTestServers {
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

describe("FoQuery iframe support", () => {
  function dispatchFrameMessage(
    iframe: HTMLIFrameElement,
    data: unknown,
    origin = window.location.origin,
  ) {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin,
        source: iframe.contentWindow,
      }),
    );
  }

  function createTreeState(frameId: string) {
    return {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "tree-state",
      frameId,
      snapshot: {
        type: "parent",
        name: "FrameRoot",
        children: [
          {
            type: "parent",
            name: "Card",
            children: [{ type: "leaf", name: "DefaultFocusable", lastFocused: 7 }],
          },
        ],
      },
    };
  }

  function createTreeStateWithoutFocusable(frameId: string) {
    return {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "tree-state",
      frameId,
      snapshot: {
        type: "parent",
        name: "FrameRoot",
        children: [
          {
            type: "parent",
            name: "Card",
            children: [],
          },
        ],
      },
    };
  }

  function createButton(doc: Document, label: string): HTMLButtonElement {
    const button = doc.createElement("button");
    button.textContent = label;
    doc.body.appendChild(button);
    return button;
  }

  async function waitForCondition(callback: () => boolean, timeout = 3000): Promise<void> {
    const start = Date.now();
    while (!callback()) {
      if (Date.now() - start > timeout) {
        throw new Error("Timed out waiting for condition");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function createCrossOriginFrameDocument(script: string): string {
    return `<!doctype html><html><body><script type="module">${script.replace(
      /<\/script/gi,
      "<\\/script",
    )}</script></body></html>`;
  }

  function scriptStringLiteral(value: string): string {
    return JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
  }

  function createActualCrossOriginLeafFrame(frameId: string): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.srcdoc = createCrossOriginFrameDocument(`
      const parentOrigin = ${JSON.stringify(window.location.origin)};
      const frameId = ${JSON.stringify(frameId)};
      const pendingRequests = new Map();
      const button = document.createElement("button");
      button.textContent = "Actual cross-origin focusable";
      document.body.appendChild(button);

      const send = (message) => window.parent.postMessage({
        source: "foquery",
        version: 1,
        frameId,
        ...message,
      }, parentOrigin);

      send({
        type: "tree-state",
        snapshot: {
          type: "parent",
          name: "FrameRoot",
          children: [
            {
              type: "parent",
              name: "Card",
              children: [{ type: "leaf", name: "DefaultFocusable" }],
            },
          ],
        },
      });

      window.addEventListener("message", (event) => {
        if (event.origin !== parentOrigin) return;
        const message = event.data;
        if (!message || typeof message !== "object") return;

        if (message.source === "foquery" && message.version === 1 && message.frameId === frameId) {
          if (message.type === "delegate-focus" && message.xpath === "//Card/DefaultFocusable") {
            button.focus();
            send({ type: "focus-result", requestId: message.requestId, status: 2 });
          } else if (message.type === "focus-result") {
            const testRequest = pendingRequests.get(message.requestId);
            if (!testRequest) return;
            pendingRequests.delete(message.requestId);
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
          const requestId = "actual-cross-origin-child-request";
          pendingRequests.set(requestId, message.xpath);
          send({
            type: "request-focus",
            requestId,
            xpath: message.xpath,
            options: { timeout: 3000 },
          });
        }
      });
    `);
    document.body.appendChild(iframe);
    return iframe;
  }

  function createNestedActualCrossOriginFrameDocument(frameId: string): string {
    return createCrossOriginFrameDocument(`
      const frameId = ${JSON.stringify(frameId)};
      const button = document.createElement("button");
      button.textContent = "Actual nested cross-origin focusable";
      document.body.appendChild(button);

      const send = (message) => window.parent.postMessage({
        source: "foquery",
        version: 1,
        frameId,
        ...message,
      }, "*");

      send({
        type: "tree-state",
        snapshot: {
          type: "parent",
          name: "NestedFrameRoot",
          children: [
            {
              type: "parent",
              name: "NestedCard",
              children: [{ type: "leaf", name: "DeepFocusable" }],
            },
          ],
        },
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || message.source !== "foquery" || message.version !== 1) return;
        if (message.frameId !== frameId || message.type !== "delegate-focus") return;
        if (message.xpath !== "//NestedCard/DeepFocusable") return;

        button.focus();
        send({ type: "focus-result", requestId: message.requestId, status: 2 });
      });
    `);
  }

  function createActualCrossOriginNestedFrame(
    frameId: string,
    nestedFrameId: string,
  ): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.srcdoc = createCrossOriginFrameDocument(`
      const parentOrigin = ${JSON.stringify(window.location.origin)};
      const frameId = ${JSON.stringify(frameId)};
      const nestedFrameId = ${JSON.stringify(nestedFrameId)};
      const nestedRequests = new Map();
      let nestedSnapshot = {
        type: "parent",
        name: "NestedFrameRoot",
        children: [
          {
            type: "parent",
            name: "NestedCard",
            children: [{ type: "leaf", name: "DeepFocusable" }],
          },
        ],
      };

      const nestedIframe = document.createElement("iframe");
      nestedIframe.sandbox.add("allow-scripts");
      nestedIframe.srcdoc = ${scriptStringLiteral(
        createNestedActualCrossOriginFrameDocument(nestedFrameId),
      )};
      document.body.appendChild(nestedIframe);

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
            children: [
              {
                type: "parent",
                name: "Card",
                children: [
                  {
                    type: "parent",
                    name: "NestedArea",
                    children: [
                      {
                        type: "parent",
                        name: "NestedCardInIframe",
                        iframe: true,
                        children: nestedSnapshot.children || [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      };

      postTreeState();

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || message.source !== "foquery" || message.version !== 1) return;

        if (message.frameId === nestedFrameId && message.type === "tree-state") {
          nestedSnapshot = message.snapshot;
          postTreeState();
          return;
        }

        if (message.frameId === nestedFrameId && message.type === "focus-result") {
          const topRequestId = nestedRequests.get(message.requestId);
          if (!topRequestId) return;
          nestedRequests.delete(message.requestId);
          send({ type: "focus-result", requestId: topRequestId, status: message.status });
          return;
        }

        if (event.origin !== parentOrigin) return;
        if (message.frameId !== frameId || message.type !== "delegate-focus") return;
        if (!message.xpath.endsWith("NestedCardInIframe/NestedCard/DeepFocusable")) return;

        const nestedRequestId = "actual-nested-delegate-" + message.requestId;
        nestedRequests.set(nestedRequestId, message.requestId);
        nestedIframe.contentWindow.postMessage({
          source: "foquery",
          version: 1,
          type: "delegate-focus",
          frameId: nestedFrameId,
          requestId: nestedRequestId,
          xpath: "//NestedCard/DeepFocusable",
          options: message.options,
        }, "*");
      });
    `);
    document.body.appendChild(iframe);
    return iframe;
  }

  function createFrameUrl(origin: string, path: string, params: Record<string, string>): string {
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.href;
  }

  function createServerBackedFrame(src: string): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.src = src;
    document.body.appendChild(iframe);
    return iframe;
  }

  function hasSucceededTestRequest(messages: unknown[], testRequest: string): boolean {
    return messages.some(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { source?: string }).source === "foquery-test" &&
        (message as { type?: string }).type === "request-result" &&
        (message as { status?: Types.RequestStatus }).status === RequestStatus.Succeeded &&
        (message as { testRequest?: string }).testRequest === testRequest,
    );
  }

  async function expectRequestFocuses(
    request: Types.Request,
    doc: Document,
    button: HTMLButtonElement,
  ) {
    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);
    expect(doc.activeElement).toBe(button);
  }

  it("creates a parent node that is explicitly backed by an iframe element", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const rootNode = new FoQueryRootNode(window);
    const parent = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe);

    rootNode.appendParent(parent);

    expect(parent.node.name).toBe("CardInIframe");
    expect(parent.iframe).toBe(iframe);
    expect(parent.xmlElement.getAttribute("type")).toBe("parent");
    expect(parent.xmlElement.getAttribute("foquery-iframe")).toBe("true");
    expect((parent.xmlElement as Types.XmlElement).foQueryIFrameParentNode).toBe(parent.node);

    parent.remove();
    iframe.remove();
  });

  it("imports child tree-state messages as remote queryable XML elements", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const rootNode = new FoQueryRootNode(window);
    const message = new FoQueryParentNode("message", rootNode.root);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });

    rootNode.appendParent(message);
    message.appendParent(frame);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const results = rootNode.query("//message/CardInIframe//Card/DefaultFocusable");

    expect(results).toHaveLength(1);
    expect(results[0].tagName).toBe("DefaultFocusable");
    expect(results[0].getAttribute("type")).toBe("leaf");
    expect(results[0].foQueryRemoteFrameRef?.iframeParentNode).toBe(frame.node);
    expect(results[0].foQueryRemoteFrameRef?.childXPath).toBe("//Card/DefaultFocusable");

    frame.remove();
    iframe.remove();
  });

  it("keeps production tree snapshots free of devtools active-element data", () => {
    const rootNode = new FoQueryRootNode(window);
    const card = new FoQueryParentNode("Card", rootNode.root);
    const button = createButton(document, "Focusable");
    rootNode.appendParent(card);
    card.appendLeaf(new FoQueryLeafNode(["DefaultFocusable"], rootNode.root), button);
    button.focus();

    const snapshot = serializeFoQueryTree(rootNode.root.xmlElement);

    expect(JSON.stringify(snapshot)).not.toContain("activeElement");
    expect(JSON.stringify(snapshot)).not.toContain("devtoolsActiveElement");

    button.remove();
  });

  it("ignores non-FoQuery, wrong-version, and wrong-frame messages", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);

    dispatchFrameMessage(iframe, { type: "tree-state", frameId: "card-frame" });
    dispatchFrameMessage(iframe, {
      ...createTreeState("card-frame"),
      version: FOQUERY_FRAME_MESSAGE_VERSION + 1,
    });
    dispatchFrameMessage(iframe, createTreeState("other-frame"));

    expect(rootNode.query("//Card/DefaultFocusable")).toHaveLength(0);

    frame.remove();
    iframe.remove();
  });

  it("ignores cross-origin frame messages from untrusted origins", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
      targetOrigin: "https://card.example",
    });
    rootNode.appendParent(frame);

    dispatchFrameMessage(iframe, createTreeState("card-frame"), "https://evil.example");

    expect(rootNode.query("//CardInIframe//Card/DefaultFocusable")).toHaveLength(0);

    dispatchFrameMessage(iframe, createTreeState("card-frame"), "https://card.example");

    expect(rootNode.query("//CardInIframe//Card/DefaultFocusable")).toHaveLength(1);

    frame.remove();
    iframe.remove();
  });

  it("focuses a real sandboxed cross-origin iframe over postMessage only", async () => {
    const rootNode = new FoQueryRootNode(window);
    const iframe = createActualCrossOriginLeafFrame("actual-cross-origin-frame");
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "actual-cross-origin-frame",
      targetOrigin: "*",
    });
    rootNode.appendParent(frame);

    try {
      await waitForCondition(
        () => rootNode.query("//CardInIframe//Card/DefaultFocusable").length === 1,
      );

      const request = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
        timeout: 3000,
      });

      await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);
    } finally {
      frame.remove();
      iframe.remove();
    }
  });

  it("routes child-originated requests from a real sandboxed cross-origin iframe", async () => {
    const testMessages: unknown[] = [];
    const onMessage = (event: MessageEvent) => {
      if (event.data?.source === "foquery-test") {
        testMessages.push(event.data);
      }
    };
    window.addEventListener("message", onMessage);

    const rootNode = new FoQueryRootNode(window);
    const header = new FoQueryParentNode("header", rootNode.root);
    const selected = createButton(document, "Header selected");
    const iframe = createActualCrossOriginLeafFrame("actual-cross-origin-frame");
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "actual-cross-origin-frame",
      targetOrigin: "*",
    });
    rootNode.appendParent(header);
    header.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), selected);
    rootNode.appendParent(frame);

    try {
      await waitForCondition(
        () => rootNode.query("//CardInIframe//Card/DefaultFocusable").length === 1,
      );

      iframe.contentWindow!.postMessage(
        {
          source: "foquery-test",
          type: "request-focus",
          xpath: "//header/SelectedItem",
        },
        "*",
      );

      await waitForCondition(() =>
        testMessages.some(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string; status?: Types.RequestStatus }).type ===
              "request-result" &&
            (message as { type?: string; status?: Types.RequestStatus }).status ===
              RequestStatus.Succeeded,
        ),
      );
      expect(document.activeElement).toBe(selected);
    } finally {
      window.removeEventListener("message", onMessage);
      frame.remove();
      iframe.remove();
      selected.remove();
    }
  });

  it("focuses through nested real sandboxed cross-origin iframes", async () => {
    const rootNode = new FoQueryRootNode(window);
    const iframe = createActualCrossOriginNestedFrame(
      "actual-cross-origin-frame",
      "actual-nested-cross-origin-frame",
    );
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "actual-cross-origin-frame",
      targetOrigin: "*",
    });
    rootNode.appendParent(frame);

    try {
      await waitForCondition(
        () =>
          rootNode.query(
            "//CardInIframe//Card/NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
          ).length === 1,
      );

      const request = rootNode.requestFocus(
        "//CardInIframe//Card/NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
        { timeout: 3000 },
      );

      await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);
    } finally {
      frame.remove();
      iframe.remove();
    }
  });

  it("routes focus across iframes loaded from several server-backed cross-origin ports", async () => {
    const servers = inject("trueCrossOriginServers");
    expect(new Set(Object.values(servers)).size).toBe(4);

    const testMessages: unknown[] = [];
    const onMessage = (event: MessageEvent) => {
      if (event.data?.source === "foquery-test") {
        testMessages.push(event.data);
      }
    };
    window.addEventListener("message", onMessage);

    const rootNode = new FoQueryRootNode(window);
    const parentOrigin = window.location.origin;
    const primaryFrameId = "server-primary-frame";
    const siblingFrameId = "server-sibling-frame";
    const nestedFrameId = "server-nested-frame";
    const levelThreeFrameId = "server-level-three-frame";

    const primaryIframe = createServerBackedFrame(
      createFrameUrl(servers.primaryOrigin, "/primary.html", {
        frameId: primaryFrameId,
        parentOrigin,
        nestedOrigin: servers.nestedOrigin,
        nestedFrameId,
        levelThreeOrigin: servers.levelThreeOrigin,
        levelThreeFrameId,
      }),
    );
    const siblingIframe = createServerBackedFrame(
      createFrameUrl(servers.siblingOrigin, "/leaf.html", {
        frameId: siblingFrameId,
        parentOrigin,
        label: "Sibling",
      }),
    );
    const primaryFrame = new FoQueryIFrameParentNode("PrimaryFrame", rootNode.root, primaryIframe, {
      frameId: primaryFrameId,
      targetOrigin: servers.primaryOrigin,
    });
    const siblingFrame = new FoQueryIFrameParentNode("SiblingFrame", rootNode.root, siblingIframe, {
      frameId: siblingFrameId,
      targetOrigin: servers.siblingOrigin,
    });

    rootNode.appendParent(primaryFrame);
    rootNode.appendParent(siblingFrame);

    try {
      await waitForCondition(
        () => rootNode.query("//PrimaryFrame//Card/DefaultFocusable").length === 1,
      );
      await waitForCondition(
        () => rootNode.query("//SiblingFrame//Card/DefaultFocusable").length === 1,
      );
      await waitForCondition(
        () =>
          rootNode.query(
            "//PrimaryFrame//Card/NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
          ).length === 1,
      );
      await waitForCondition(
        () =>
          rootNode.query(
            "//PrimaryFrame//Card/NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable",
          ).length === 1,
      );

      await expect(
        rootNode.requestFocus("//SiblingFrame//Card/DefaultFocusable", { timeout: 3000 }).promise,
      ).resolves.toBe(RequestStatus.Succeeded);
      expect(document.activeElement).toBe(siblingIframe);

      await expect(
        rootNode.requestFocus("//PrimaryFrame//Card/DefaultFocusable", { timeout: 3000 }).promise,
      ).resolves.toBe(RequestStatus.Succeeded);
      expect(document.activeElement).toBe(primaryIframe);

      await expect(
        rootNode.requestFocus(
          "//PrimaryFrame//Card/NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
          { timeout: 3000 },
        ).promise,
      ).resolves.toBe(RequestStatus.Succeeded);
      expect(document.activeElement).toBe(primaryIframe);

      await expect(
        rootNode.requestFocus(
          "//PrimaryFrame//Card/NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable",
          { timeout: 3000 },
        ).promise,
      ).resolves.toBe(RequestStatus.Succeeded);
      expect(document.activeElement).toBe(primaryIframe);

      primaryIframe.contentWindow!.postMessage(
        {
          source: "foquery-test",
          type: "request-focus",
          xpath: "//Card/DefaultFocusable",
          testRequest: "primary-local",
        },
        servers.primaryOrigin,
      );
      await waitForCondition(() => hasSucceededTestRequest(testMessages, "primary-local"));

      primaryIframe.contentWindow!.postMessage(
        {
          source: "foquery-test",
          type: "request-focus",
          xpath: "//SiblingFrame//Card/DefaultFocusable",
          testRequest: "primary-to-sibling",
        },
        servers.primaryOrigin,
      );
      await waitForCondition(() => hasSucceededTestRequest(testMessages, "primary-to-sibling"));

      primaryIframe.contentWindow!.postMessage(
        {
          source: "foquery-test",
          type: "nested-request-focus",
          xpath: "//SiblingFrame//Card/DefaultFocusable",
          testRequest: "nested-to-sibling",
        },
        servers.primaryOrigin,
      );
      await waitForCondition(() => hasSucceededTestRequest(testMessages, "nested-to-sibling"));
    } finally {
      window.removeEventListener("message", onMessage);
      primaryFrame.remove();
      siblingFrame.remove();
      primaryIframe.remove();
      siblingIframe.remove();
    }
  });

  it("progressively resolves deep focus through server-backed cross-origin iframes", async () => {
    const servers = inject("trueCrossOriginServers");
    const rootNode = new FoQueryRootNode(window);
    const parentOrigin = window.location.origin;
    const primaryFrameId = "server-progressive-primary-frame";
    const nestedFrameId = "server-progressive-nested-frame";
    const levelThreeFrameId = "server-progressive-level-three-frame";
    const primaryIframe = document.createElement("iframe");
    document.body.appendChild(primaryIframe);

    const primaryFrame = new FoQueryIFrameParentNode("PrimaryFrame", rootNode.root, primaryIframe, {
      frameId: primaryFrameId,
      targetOrigin: servers.primaryOrigin,
    });
    rootNode.appendParent(primaryFrame);

    const request = rootNode.requestFocus(
      "//PrimaryFrame//Card/NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable",
      { timeout: 5000 },
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(request.status).toBe(RequestStatus.Waiting);

      primaryIframe.src = createFrameUrl(servers.primaryOrigin, "/primary.html", {
        frameId: primaryFrameId,
        parentOrigin,
        nestedOrigin: servers.nestedOrigin,
        nestedFrameId,
        levelThreeOrigin: servers.levelThreeOrigin,
        levelThreeFrameId,
      });

      await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);
      expect(document.activeElement).toBe(primaryIframe);
      expect(
        request.diagnostics?.events.some(
          (event) =>
            event.type === "canceled" || event.type === "degraded" || event.type === "lost-match",
        ),
      ).toBe(false);
    } finally {
      primaryFrame.remove();
      primaryIframe.remove();
    }
  });

  it("delegates requestFocus into an iframe with the child-local XPath", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const content = new FoQueryParentNode("content", rootNode.root);
    const messages = new FoQueryParentNode("messages", rootNode.root);
    const message = new FoQueryParentNode("message", rootNode.root);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });

    rootNode.appendParent(content);
    content.appendParent(messages);
    messages.appendParent(message);
    message.appendParent(frame);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const request = rootNode.requestFocus(
      "//content/messages/message/CardInIframe//Card/DefaultFocusable",
    );

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const [messageData, targetOrigin] = postMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("*");
    expect(messageData).toMatchObject({
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "delegate-focus",
      frameId: "card-frame",
      xpath: "//Card/DefaultFocusable",
    });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    frame.remove();
    iframe.remove();
  });

  it("runs ancestor check callbacks against the iframe element before delegated focus", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    let checksPass = false;
    const rootCheck = vi.fn((element: HTMLElement) => element === iframe && checksPass);
    const frameCheck = vi.fn((element: HTMLElement) => element === iframe);
    rootNode.registerCheck(rootCheck);
    frame.registerCheck(frameCheck);

    const request = rootNode.requestFocus("//CardInIframe/Card/DefaultFocusable", {
      timeout: 5000,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(postMessageSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "delegate-focus" }),
      expect.any(String),
    );
    expect(rootCheck).toHaveBeenCalledWith(iframe);
    expect(frameCheck).toHaveBeenCalledWith(iframe);

    checksPass = true;

    await new Promise((resolve) => setTimeout(resolve, 100));

    const [messageData] = postMessageSpy.mock.calls.find(
      ([data]) => data && typeof data === "object" && data.type === "delegate-focus",
    )!;
    expect(messageData).toMatchObject({
      type: "delegate-focus",
      xpath: "//Card/DefaultFocusable",
    });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    frame.remove();
    iframe.remove();
  });

  it("runs child-local check callbacks when delegated focus reaches the iframe", async () => {
    const rootNode = new FoQueryRootNode(window);
    const card = new FoQueryParentNode("Card", rootNode.root);
    const button = document.createElement("button");
    const focusSpy = vi.spyOn(button, "focus");
    document.body.appendChild(button);
    rootNode.appendParent(card);
    const leaf = new FoQueryLeafNode(["DefaultFocusable"], rootNode.root);
    card.appendLeaf(leaf, button);

    let checksPass = false;
    const childCheck = vi.fn(() => checksPass);
    card.registerCheck(childCheck);
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const connection = connectFoQueryChildFrame(rootNode, { frameId: "child-frame" });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: FOQUERY_FRAME_MESSAGE_SOURCE,
          version: FOQUERY_FRAME_MESSAGE_VERSION,
          type: "delegate-focus",
          frameId: "child-frame",
          requestId: "request-1",
          xpath: "//Card/DefaultFocusable",
          options: { timeout: 5000 },
        },
        origin: window.location.origin,
        source: window.parent,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(focusSpy).not.toHaveBeenCalled();
    expect(childCheck).toHaveBeenCalledWith(button);

    checksPass = true;

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(focusSpy).toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "focus-result",
        frameId: "child-frame",
        requestId: "request-1",
        status: RequestStatus.Succeeded,
      }),
      "*",
    );

    connection.dispose();
    button.remove();
  });

  it("lets parent arbiters choose among remote iframe candidates", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const arbiter = vi.fn((candidates: Types.XmlElement[]) => candidates[1]);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
      focus: ".//DefaultFocusable",
      arbiter,
    });
    rootNode.appendParent(frame);

    dispatchFrameMessage(iframe, {
      ...createTreeState("card-frame"),
      snapshot: {
        type: "parent",
        name: "FrameRoot",
        children: [
          {
            type: "parent",
            name: "CardA",
            children: [{ type: "leaf", name: "DefaultFocusable" }],
          },
          {
            type: "parent",
            name: "CardB",
            children: [{ type: "leaf", name: "DefaultFocusable" }],
          },
        ],
      },
    });

    const request = rootNode.requestFocus("//CardInIframe");

    expect(arbiter).toHaveBeenCalled();
    expect(arbiter.mock.calls[0][0].map((candidate) => candidate.parentElement?.tagName)).toEqual([
      "CardA",
      "CardB",
    ]);

    const [messageData] = postMessageSpy.mock.calls[0];
    expect(messageData).toMatchObject({
      type: "delegate-focus",
      xpath: "//CardB/DefaultFocusable",
    });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    frame.remove();
    iframe.remove();
  });

  it("lets root arbiters choose among multiple sibling iframe candidates", async () => {
    const leftIframe = document.createElement("iframe");
    const rightIframe = document.createElement("iframe");
    document.body.append(leftIframe, rightIframe);
    const leftPostMessageSpy = vi.spyOn(leftIframe.contentWindow!, "postMessage");
    const rightPostMessageSpy = vi.spyOn(rightIframe.contentWindow!, "postMessage");
    const rootArbiter = vi.fn((candidates: Types.XmlElement[]) => candidates[1]);
    const rootNode = new FoQueryRootNode(window, "Root", { arbiter: rootArbiter });
    const leftFrame = new FoQueryIFrameParentNode("LeftFrame", rootNode.root, leftIframe, {
      frameId: "left-frame",
    });
    const rightFrame = new FoQueryIFrameParentNode("RightFrame", rootNode.root, rightIframe, {
      frameId: "right-frame",
    });
    rootNode.appendParent(leftFrame);
    rootNode.appendParent(rightFrame);
    dispatchFrameMessage(leftIframe, createTreeState("left-frame"));
    dispatchFrameMessage(rightIframe, createTreeState("right-frame"));

    const request = rootNode.requestFocus("//DefaultFocusable");

    expect(rootArbiter).toHaveBeenCalled();
    expect(
      rootArbiter.mock.calls[0][0].map((candidate) => candidate.foQueryRemoteFrameRef?.frameId),
    ).toEqual(["left-frame", "right-frame"]);
    expect(leftPostMessageSpy).not.toHaveBeenCalled();
    const [messageData] = rightPostMessageSpy.mock.calls[0];
    expect(messageData).toMatchObject({
      type: "delegate-focus",
      xpath: "//Card/DefaultFocusable",
    });

    dispatchFrameMessage(rightIframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "right-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    leftFrame.remove();
    rightFrame.remove();
    leftIframe.remove();
    rightIframe.remove();
  });

  it("keeps nested iframe paths transparent to the owning parent", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("OuterFrame", rootNode.root, iframe, {
      frameId: "outer-frame",
    });

    rootNode.appendParent(frame);
    dispatchFrameMessage(iframe, {
      ...createTreeState("outer-frame"),
      snapshot: {
        type: "parent",
        name: "FrameRoot",
        children: [
          {
            type: "parent",
            name: "NestedFrame",
            iframe: true,
            children: [{ type: "leaf", name: "DeepFocusable" }],
          },
        ],
      },
    });

    const request = rootNode.requestFocus("//OuterFrame//NestedFrame//DeepFocusable");

    const [messageData] = postMessageSpy.mock.calls[0];
    expect(messageData).toMatchObject({
      type: "delegate-focus",
      xpath: "//NestedFrame/DeepFocusable",
    });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "outer-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    frame.remove();
    iframe.remove();
  });

  it("progressively resolves a cross-frame request when the iframe snapshot arrives", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);

    const request = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 5000,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(request.status).toBe(RequestStatus.Waiting);
    expect(request.diagnostics).toBeDefined();

    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const [messageData] = postMessageSpy.mock.calls[0];
    expect(messageData).toMatchObject({
      type: "delegate-focus",
      xpath: "//Card/DefaultFocusable",
    });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    frame.remove();
    iframe.remove();
  });

  it("progressively resolves when an existing iframe snapshot grows to the target", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    dispatchFrameMessage(iframe, {
      ...createTreeState("card-frame"),
      snapshot: {
        type: "parent",
        name: "FrameRoot",
        children: [{ type: "parent", name: "Card", children: [] }],
      },
    });

    const request = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 5000,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(request.diagnostics?.events.some((event) => event.type === "partial-match")).toBe(true);

    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const [messageData] = postMessageSpy.mock.calls[0];
    expect(messageData).toMatchObject({
      type: "delegate-focus",
      xpath: "//Card/DefaultFocusable",
    });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    frame.remove();
    iframe.remove();
  });

  it("does not cancel a delegated request when focus enters the remote iframe candidate", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const request = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 5000,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const [messageData] = postMessageSpy.mock.calls[0];
    iframe.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(request.status).toBe(RequestStatus.Waiting);
    expect(request.diagnostics?.cancelReason).toBeUndefined();

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);
    expect(request.diagnostics?.events.some((event) => event.type === "canceled")).toBe(false);

    frame.remove();
    iframe.remove();
  });

  it("does not start duplicate remote delegation for repeated snapshots of the same target", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const request = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 5000,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    dispatchFrameMessage(iframe, createTreeState("card-frame"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(request.status).toBe(RequestStatus.Waiting);

    const [messageData] = postMessageSpy.mock.calls[0];
    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    frame.remove();
    iframe.remove();
  });

  it("treats child-originated focus requests as app-wide transactions that supersede parent requests", async () => {
    const testMessages: unknown[] = [];
    const onMessage = (event: MessageEvent) => {
      if (event.data?.source === "foquery-test") {
        testMessages.push(event.data);
      }
    };
    window.addEventListener("message", onMessage);
    const rootNode = new FoQueryRootNode(window);
    const iframe = createActualCrossOriginLeafFrame("actual-cross-origin-frame");
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "actual-cross-origin-frame",
      targetOrigin: "*",
    });
    rootNode.appendParent(frame);
    try {
      await waitForCondition(
        () => rootNode.query("//CardInIframe//Card/DefaultFocusable").length === 1,
      );

      const parentRequest = rootNode.requestFocus("//Missing", {
        timeout: 5000,
      });
      iframe.contentWindow!.postMessage(
        {
          source: "foquery-test",
          type: "request-focus",
          xpath: "//Card/DefaultFocusable",
        },
        "*",
      );

      await expect(parentRequest.promise).resolves.toBe(RequestStatus.Canceled);
      expect(parentRequest.diagnostics?.cancelReason).toBe("superseded");
      await waitForCondition(() =>
        testMessages.some(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string; status?: Types.RequestStatus }).type ===
              "request-result" &&
            (message as { type?: string; status?: Types.RequestStatus }).status ===
              RequestStatus.Succeeded,
        ),
      );
    } finally {
      window.removeEventListener("message", onMessage);
      frame.remove();
      iframe.remove();
    }
  });

  it("scopes active request coordination to the FoQuery root window, not window.top", async () => {
    const parentRoot = new FoQueryRootNode(window);
    const parentRequest = parentRoot.requestFocus("//Missing", { timeout: 5000 });
    const appIframe = document.createElement("iframe");
    document.body.appendChild(appIframe);

    const appWindow = appIframe.contentWindow as Window & typeof globalThis;
    const appDocument = appIframe.contentDocument!;
    const appRoot = new FoQueryRootNode(appWindow);
    const app = new FoQueryParentNode("App", appRoot.root);
    const button = appDocument.createElement("button");
    const appFocus = vi.fn(() => true);
    appDocument.body.appendChild(button);
    appRoot.appendParent(app);
    app.appendLeaf(new FoQueryLeafNode(["Focusable"], appRoot.root, appFocus), button);

    try {
      const appRequest = appRoot.requestFocus("//App/Focusable", { timeout: 5000 });

      await expect(appRequest.promise).resolves.toBe(RequestStatus.Succeeded);
      expect(appFocus).toHaveBeenCalled();
      expect(parentRequest.status).toBe(RequestStatus.Waiting);
      parentRequest.cancel();
      await expect(parentRequest.promise).resolves.toBe(RequestStatus.Canceled);
    } finally {
      appIframe.remove();
    }
  });

  it("waits for a pending delegated focus result before starting the next app-wide request", async () => {
    const iframe = document.createElement("iframe");
    const localButton = document.createElement("button");
    document.body.append(iframe, localButton);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const local = new FoQueryParentNode("Local", rootNode.root);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    rootNode.appendParent(local);
    local.appendLeaf(new FoQueryLeafNode(["LocalFocusable"], rootNode.root), localButton);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const remoteRequest = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 5000,
    });
    const [messageData] = postMessageSpy.mock.calls[0];

    const localRequest = rootNode.requestFocus("//Local/LocalFocusable", { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(remoteRequest.status).toBe(RequestStatus.Waiting);
    expect(localRequest.status).toBe(RequestStatus.Waiting);
    expect(document.activeElement).not.toBe(localButton);

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(remoteRequest.promise).resolves.toBe(RequestStatus.Succeeded);
    await expect(localRequest.promise).resolves.toBe(RequestStatus.Succeeded);
    expect(document.activeElement).toBe(localButton);

    frame.remove();
    iframe.remove();
    localButton.remove();
  });

  it("cancels a pending delegated focus request after a short handoff timeout before starting the next request", async () => {
    const iframe = document.createElement("iframe");
    const localButton = document.createElement("button");
    document.body.append(iframe, localButton);
    const rootNode = new FoQueryRootNode(window);
    const local = new FoQueryParentNode("Local", rootNode.root);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    rootNode.appendParent(local);
    local.appendLeaf(new FoQueryLeafNode(["LocalFocusable"], rootNode.root), localButton);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const remoteRequest = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 5000,
    });
    const localRequest = rootNode.requestFocus("//Local/LocalFocusable", { timeout: 5000 });

    await expect(remoteRequest.promise).resolves.toBe(RequestStatus.Canceled);
    expect(remoteRequest.diagnostics?.cancelReason).toBe("superseded");
    await expect(localRequest.promise).resolves.toBe(RequestStatus.Succeeded);
    expect(document.activeElement).toBe(localButton);

    frame.remove();
    iframe.remove();
    localButton.remove();
  });

  it("cancels a pending delegated focus request after a failed delegated result when another request is waiting", async () => {
    const iframe = document.createElement("iframe");
    const localButton = document.createElement("button");
    document.body.append(iframe, localButton);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const local = new FoQueryParentNode("Local", rootNode.root);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    rootNode.appendParent(local);
    local.appendLeaf(new FoQueryLeafNode(["LocalFocusable"], rootNode.root), localButton);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const remoteRequest = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 5000,
    });
    const [messageData] = postMessageSpy.mock.calls[0];
    const localRequest = rootNode.requestFocus("//Local/LocalFocusable", { timeout: 5000 });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "card-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Canceled,
    });

    await expect(remoteRequest.promise).resolves.toBe(RequestStatus.Canceled);
    expect(remoteRequest.diagnostics?.cancelReason).toBe("superseded");
    await expect(localRequest.promise).resolves.toBe(RequestStatus.Succeeded);
    expect(document.activeElement).toBe(localButton);

    frame.remove();
    iframe.remove();
    localButton.remove();
  });

  it("reports degradation and continues when a delegated iframe target disappears before focus result", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    try {
      rootNode.appendParent(frame);
      dispatchFrameMessage(iframe, createTreeState("card-frame"));

      const request = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
        timeout: 5000,
      });
      const [firstMessageData] = postMessageSpy.mock.calls[0];

      dispatchFrameMessage(iframe, createTreeStateWithoutFocusable("card-frame"));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(request.status).toBe(RequestStatus.Waiting);
      expect(request.diagnostics?.events.some((event) => event.type === "degraded")).toBe(true);

      dispatchFrameMessage(iframe, {
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "focus-result",
        frameId: "card-frame",
        requestId: firstMessageData.requestId,
        status: RequestStatus.Canceled,
      });
      dispatchFrameMessage(iframe, createTreeState("card-frame"));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(postMessageSpy).toHaveBeenCalledTimes(2);
      const [secondMessageData] = postMessageSpy.mock.calls[1];
      dispatchFrameMessage(iframe, {
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "focus-result",
        frameId: "card-frame",
        requestId: secondMessageData.requestId,
        status: RequestStatus.Succeeded,
      });

      await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);
    } finally {
      frame.remove();
      iframe.remove();
    }
  });

  it("times out a progressive cross-frame request when the iframe target never appears", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);

    const request = rootNode.requestFocus("//CardInIframe//MissingFocusable", {
      timeout: 100,
    });

    const status = await request.promise;

    expect(status).toBe(RequestStatus.TimedOut);
    expect(postMessageSpy).not.toHaveBeenCalled();

    frame.remove();
    iframe.remove();
  });

  it("times out after delegating when a child frame does not return a focus result", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);
    dispatchFrameMessage(iframe, createTreeState("card-frame"));

    const request = rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", {
      timeout: 100,
    });

    const status = await request.promise;

    expect(status).toBe(RequestStatus.TimedOut);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "delegate-focus" }),
      "*",
    );

    frame.remove();
    iframe.remove();
  });

  it("routes requests to the matching iframe among multiple sibling iframes", async () => {
    const leftIframe = document.createElement("iframe");
    const rightIframe = document.createElement("iframe");
    document.body.append(leftIframe, rightIframe);
    const leftPostMessageSpy = vi.spyOn(leftIframe.contentWindow!, "postMessage");
    const rightPostMessageSpy = vi.spyOn(rightIframe.contentWindow!, "postMessage");
    const rootNode = new FoQueryRootNode(window);
    const leftFrame = new FoQueryIFrameParentNode("LeftFrame", rootNode.root, leftIframe, {
      frameId: "left-frame",
    });
    const rightFrame = new FoQueryIFrameParentNode("RightFrame", rootNode.root, rightIframe, {
      frameId: "right-frame",
    });
    rootNode.appendParent(leftFrame);
    rootNode.appendParent(rightFrame);
    dispatchFrameMessage(leftIframe, createTreeState("left-frame"));
    dispatchFrameMessage(rightIframe, createTreeState("right-frame"));

    const request = rootNode.requestFocus("//RightFrame//Card/DefaultFocusable");

    expect(leftPostMessageSpy).not.toHaveBeenCalled();
    const [messageData] = rightPostMessageSpy.mock.calls[0];
    expect(messageData).toMatchObject({
      type: "delegate-focus",
      xpath: "//Card/DefaultFocusable",
    });

    dispatchFrameMessage(rightIframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "focus-result",
      frameId: "right-frame",
      requestId: messageData.requestId,
      status: RequestStatus.Succeeded,
    });

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    leftFrame.remove();
    rightFrame.remove();
    leftIframe.remove();
    rightIframe.remove();
  });

  it("focuses local leaves when a child frame receives delegate-focus", async () => {
    const rootNode = new FoQueryRootNode(window);
    const card = new FoQueryParentNode("Card", rootNode.root);
    const button = document.createElement("button");
    const focusSpy = vi.spyOn(button, "focus");
    document.body.appendChild(button);
    rootNode.appendParent(card);
    card.appendLeaf(new FoQueryLeafNode(["DefaultFocusable"], rootNode.root), button);

    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const connection = connectFoQueryChildFrame(rootNode, { frameId: "child-frame" });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: FOQUERY_FRAME_MESSAGE_SOURCE,
          version: FOQUERY_FRAME_MESSAGE_VERSION,
          type: "delegate-focus",
          frameId: "child-frame",
          requestId: "request-1",
          xpath: "//Card/DefaultFocusable",
        },
        origin: window.location.origin,
        source: window.parent,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(focusSpy).toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "focus-result",
        frameId: "child-frame",
        requestId: "request-1",
        status: RequestStatus.Succeeded,
      }),
      "*",
    );

    connection.dispose();
    button.remove();
  });

  it("posts child-originated requestFocus calls upward", async () => {
    const rootNode = new FoQueryRootNode(window);
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const connection = connectFoQueryChildFrame(rootNode, { frameId: "child-frame" });

    const request = rootNode.requestFocus("//Card/DefaultFocusable");

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "request-focus",
        frameId: "child-frame",
        xpath: "//Card/DefaultFocusable",
      }),
      "*",
    );

    const [messageData] = postMessageSpy.mock.calls.find(
      ([data]) => data && typeof data === "object" && data.type === "request-focus",
    )!;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: FOQUERY_FRAME_MESSAGE_SOURCE,
          version: FOQUERY_FRAME_MESSAGE_VERSION,
          type: "focus-result",
          frameId: "child-frame",
          requestId: messageData.requestId,
          status: RequestStatus.Succeeded,
        },
        origin: window.location.origin,
        source: window.parent,
      }),
    );

    await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);

    connection.dispose();
  });

  it("rejects duplicate child-frame connections on the same root", () => {
    const rootNode = new FoQueryRootNode(window);
    const firstConnection = connectFoQueryChildFrame(rootNode, { frameId: "child-frame" });

    expect(() => connectFoQueryChildFrame(rootNode, { frameId: "duplicate-child-frame" })).toThrow(
      "FoQuery child frame root is already connected",
    );

    firstConnection.dispose();

    const secondConnection = connectFoQueryChildFrame(rootNode, {
      frameId: "replacement-child-frame",
    });
    secondConnection.dispose();
  });

  it("forwards nested child iframe requestFocus calls upward with a transparent iframe path", () => {
    const rootNode = new FoQueryRootNode(window);
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const nestedFrame = new FoQueryIFrameParentNode("NestedFrame", rootNode.root, iframe, {
      frameId: "nested-frame",
    });
    rootNode.appendParent(nestedFrame);
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const connection = connectFoQueryChildFrame(rootNode, { frameId: "child-frame" });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "request-focus",
      frameId: "nested-frame",
      requestId: "nested-request",
      xpath: "//DeepFocusable",
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "request-focus",
        frameId: "child-frame",
        xpath: "//NestedFrame//DeepFocusable",
      }),
      "*",
    );

    connection.dispose();
    nestedFrame.remove();
    iframe.remove();
  });

  it("forwards multi-level nested child iframe requestFocus calls with the full local iframe chain", () => {
    const rootNode = new FoQueryRootNode(window);
    const levelOne = new FoQueryParentNode("LevelOne", rootNode.root);
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const levelTwoFrame = new FoQueryIFrameParentNode("LevelTwoFrame", rootNode.root, iframe, {
      frameId: "level-two-frame",
    });
    rootNode.appendParent(levelOne);
    levelOne.appendParent(levelTwoFrame);
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const connection = connectFoQueryChildFrame(rootNode, { frameId: "child-frame" });

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "request-focus",
      frameId: "level-two-frame",
      requestId: "nested-request",
      xpath: "//LevelThreeFrame//DeepFocusable",
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "request-focus",
        frameId: "child-frame",
        xpath: "//LevelOne/LevelTwoFrame//LevelThreeFrame//DeepFocusable",
      }),
      "*",
    );

    connection.dispose();
    levelTwoFrame.remove();
    iframe.remove();
  });

  it("covers root-routed focus moves across parent, sibling, and nested cross-origin iframes", async () => {
    const rootNode = new FoQueryRootNode(window);
    const header = new FoQueryParentNode("header", rootNode.root);
    const selected = createButton(document, "Header selected");
    const primaryIframe = createActualCrossOriginLeafFrame("actual-primary-frame");
    const siblingIframe = createActualCrossOriginLeafFrame("actual-sibling-frame");
    const nestedIframe = createActualCrossOriginNestedFrame(
      "actual-nested-primary-frame",
      "actual-nested-child-frame",
    );
    const primaryFrame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, primaryIframe, {
      frameId: "actual-primary-frame",
      targetOrigin: "*",
    });
    const siblingFrame = new FoQueryIFrameParentNode(
      "SecondaryCardInIframe",
      rootNode.root,
      siblingIframe,
      { frameId: "actual-sibling-frame", targetOrigin: "*" },
    );
    const nestedFrame = new FoQueryIFrameParentNode(
      "NestedCardInIframe",
      rootNode.root,
      nestedIframe,
      { frameId: "actual-nested-primary-frame", targetOrigin: "*" },
    );
    rootNode.appendParent(header);
    header.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), selected);
    rootNode.appendParent(primaryFrame);
    rootNode.appendParent(siblingFrame);
    rootNode.appendParent(nestedFrame);

    try {
      await waitForCondition(
        () => rootNode.query("//CardInIframe//Card/DefaultFocusable").length === 1,
      );
      await waitForCondition(
        () => rootNode.query("//SecondaryCardInIframe//Card/DefaultFocusable").length === 1,
      );
      await waitForCondition(
        () =>
          rootNode.query(
            "//NestedCardInIframe//Card/NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
          ).length === 1,
      );

      await expectRequestFocuses(
        rootNode.requestFocus("//header/SelectedItem", { timeout: 3000 }),
        document,
        selected,
      );
      await expect(
        rootNode.requestFocus("//CardInIframe//Card/DefaultFocusable", { timeout: 3000 }).promise,
      ).resolves.toBe(RequestStatus.Succeeded);
      await expect(
        rootNode.requestFocus("//SecondaryCardInIframe//Card/DefaultFocusable", { timeout: 3000 })
          .promise,
      ).resolves.toBe(RequestStatus.Succeeded);
      await expect(
        rootNode.requestFocus(
          "//NestedCardInIframe//Card/NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
          { timeout: 3000 },
        ).promise,
      ).resolves.toBe(RequestStatus.Succeeded);
    } finally {
      primaryFrame.remove();
      siblingFrame.remove();
      nestedFrame.remove();
      primaryIframe.remove();
      siblingIframe.remove();
      nestedIframe.remove();
      selected.remove();
    }
  });
});
