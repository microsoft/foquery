/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, expect, it, vi } from "vitest";
import { FoQueryRootNode } from "./foquery-root-node";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";
import type * as Types from "./types";
import {
  FOQUERY_FRAME_MESSAGE_SOURCE,
  FOQUERY_FRAME_MESSAGE_VERSION,
  FoQueryIFrameParentNode,
} from "./iframe";
import {
  FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY,
  connectFoQueryChildFrameDevtools,
  installFoQueryIFrameDevtools,
} from "./iframe-devtools";

describe("FoQuery iframe devtools bridge", () => {
  function createButton(label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    document.body.appendChild(button);
    return button;
  }

  function dispatchFrameMessage(iframe: HTMLIFrameElement, data: unknown) {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: iframe.contentWindow,
      }),
    );
  }

  it("adds active-element metadata only to devtools tree-state messages", () => {
    const rootNode = new FoQueryRootNode(window);
    const card = new FoQueryParentNode("Card", rootNode.root);
    const button = createButton("Default target");
    rootNode.appendParent(card);
    card.appendLeaf(new FoQueryLeafNode(["DefaultFocusable"], rootNode.root), button);
    button.focus();

    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    postMessageSpy.mockClear();
    const connection = connectFoQueryChildFrameDevtools(rootNode, { frameId: "child-frame" });
    const treeStateCalls = postMessageSpy.mock.calls.filter(
      ([message]) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: string }).type === "tree-state",
    );
    const treeStateMessages = treeStateCalls.map(([message]) => message as { snapshot?: unknown });
    const devtoolsTreeState = treeStateMessages.find((message) =>
      JSON.stringify(message.snapshot).includes("devtoolsActiveElement"),
    );

    expect(devtoolsTreeState).toBeDefined();
    expect(
      treeStateMessages.every((message) =>
        JSON.stringify(message.snapshot).includes("devtoolsActiveElement"),
      ),
    ).toBe(true);
    expect(devtoolsTreeState?.snapshot).toMatchObject({
      children: [
        {
          children: [
            {
              devtoolsActiveElement: {
                tag: "button",
                text: "Default target",
              },
            },
          ],
        },
      ],
    });

    connection.dispose();
    button.remove();
  });

  it("stores devtools active-element metadata on imported remote XML elements", () => {
    installFoQueryIFrameDevtools();

    const rootNode = new FoQueryRootNode(window);
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const frame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
      frameId: "card-frame",
    });
    rootNode.appendParent(frame);

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "tree-state",
      frameId: "card-frame",
      snapshot: {
        type: "parent",
        name: "FrameRoot",
        children: [
          {
            type: "parent",
            name: "Card",
            children: [
              {
                type: "leaf",
                name: "DefaultFocusable",
                devtoolsActiveElement: { tag: "button", text: "Default target" },
              },
            ],
          },
        ],
      },
    });

    const remoteLeaf = rootNode.query(
      "//CardInIframe//Card/DefaultFocusable",
    )[0] as Types.XmlElement & {
      [FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY]?: { activeElement?: { tag?: string; text?: string } };
    };

    expect(remoteLeaf[FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY]?.activeElement).toEqual({
      tag: "button",
      text: "Default target",
    });

    frame.remove();
    iframe.remove();
  });

  it("does not propagate stale remote active-element metadata after focus leaves a nested iframe", () => {
    installFoQueryIFrameDevtools();

    const rootNode = new FoQueryRootNode(window);
    const nestedCard = new FoQueryParentNode("NestedCard", rootNode.root);
    const localButton = createButton("Deep target");
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const levelThreeFrame = new FoQueryIFrameParentNode("LevelThreeFrame", rootNode.root, iframe, {
      frameId: "level-three-frame",
    });
    rootNode.appendParent(nestedCard);
    nestedCard.appendLeaf(new FoQueryLeafNode(["DeepFocusable"], rootNode.root), localButton);
    nestedCard.appendParent(levelThreeFrame);

    dispatchFrameMessage(iframe, {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "tree-state",
      frameId: "level-three-frame",
      snapshot: {
        type: "parent",
        name: "LevelThreeRoot",
        children: [
          {
            type: "parent",
            name: "LevelThreeCard",
            children: [
              {
                type: "leaf",
                name: "DeepestFocusable",
                devtoolsActiveElement: { tag: "button", text: "Deepest target" },
              },
            ],
          },
        ],
      },
    });

    localButton.focus();

    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    postMessageSpy.mockClear();
    const connection = connectFoQueryChildFrameDevtools(rootNode, { frameId: "nested-frame" });
    const treeStateMessage = postMessageSpy.mock.calls.find(
      ([message]) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: string }).type === "tree-state",
    )?.[0] as { snapshot?: unknown } | undefined;
    const serializedSnapshot = JSON.stringify(treeStateMessage?.snapshot);

    expect(serializedSnapshot).toContain("Deep target");
    expect(serializedSnapshot).not.toContain("Deepest target");

    connection.dispose();
    levelThreeFrame.remove();
    localButton.remove();
    iframe.remove();
  });

  it("posts a devtools tree-state when focus changes without a structural tree update", async () => {
    const rootNode = new FoQueryRootNode(window);
    const card = new FoQueryParentNode("Card", rootNode.root);
    const button = createButton("Default target");
    rootNode.appendParent(card);
    card.appendLeaf(new FoQueryLeafNode(["DefaultFocusable"], rootNode.root), button);

    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    postMessageSpy.mockClear();
    const connection = connectFoQueryChildFrameDevtools(rootNode, { frameId: "child-frame" });
    postMessageSpy.mockClear();

    button.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const focusTreeState = postMessageSpy.mock.calls
      .map(([message]) => message as { type?: string; snapshot?: unknown })
      .find(
        (message) =>
          message.type === "tree-state" &&
          JSON.stringify(message.snapshot).includes("Default target"),
      );

    expect(focusTreeState).toBeDefined();

    connection.dispose();
    button.remove();
  });
});
