/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect, vi } from "vitest";
import { FoQueryRootNode } from "./foquery-root-node";

describe("FoQueryRootNode", () => {
  it("creates a root node with default name", () => {
    const rootNode = new FoQueryRootNode(window);
    const root = rootNode.root;

    expect(root.name).toBe("Root");
    expect(root.xmlDoc).toBeInstanceOf(Document);
    expect(root.xmlElement.tagName).toBe("Root");
    expect(root.parent).toBeUndefined();
    expect(root.children.size).toBe(0);
    expect(root.leafs.size).toBe(0);
    expect(root.lastFocused).toBeUndefined();
  });

  it("creates a root node with custom name", () => {
    const rootNode = new FoQueryRootNode(window, "App");
    expect(rootNode.root.name).toBe("App");
    expect(rootNode.root.xmlElement.tagName).toBe("App");
  });

  it("subscribe returns an unsubscribe function", () => {
    const rootNode = new FoQueryRootNode(window);
    const callback = vi.fn();

    const unsubscribe = rootNode.root.subscribe(callback);

    rootNode.root.notify(rootNode.root);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(rootNode.root, undefined);

    unsubscribe();

    rootNode.root.notify(rootNode.root);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("notify forwards removed flag to subscribers", () => {
    const rootNode = new FoQueryRootNode(window);
    const callback = vi.fn();

    rootNode.root.subscribe(callback);
    rootNode.root.notify(rootNode.root, true);

    expect(callback).toHaveBeenCalledWith(rootNode.root, true);
  });

  it("supports multiple subscribers", () => {
    const rootNode = new FoQueryRootNode(window);
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    rootNode.root.subscribe(cb1);
    rootNode.root.subscribe(cb2);

    rootNode.root.notify(rootNode.root);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("rootNode.requestFocus is a function", () => {
    const rootNode = new FoQueryRootNode(window);
    expect(typeof rootNode.requestFocus).toBe("function");
  });

  it("root.query is a function", () => {
    const rootNode = new FoQueryRootNode(window);
    expect(typeof rootNode.query).toBe("function");
    expect(rootNode.query("//nonexistent").length).toBe(0);
  });
});
