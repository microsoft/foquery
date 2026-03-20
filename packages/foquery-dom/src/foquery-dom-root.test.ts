/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import { FoQueryDOMRoot } from "./foquery-dom-root";

describe("FoQueryDOMRoot", () => {
  it("creates a root node bound to a DOM element", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const domRoot = new FoQueryDOMRoot(container);

    expect(domRoot.root).toBeDefined();
    expect(domRoot.root.name).toBe("Root");
    expect(domRoot.root.xmlDoc).toBeInstanceOf(Document);
    expect(container.getAttribute("data-foquery-root")).toBe("Root");

    domRoot.dispose();
    container.remove();
  });

  it("accepts a custom root name", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const domRoot = new FoQueryDOMRoot(container, "App");

    expect(domRoot.root.name).toBe("App");
    expect(container.getAttribute("data-foquery-root")).toBe("App");

    domRoot.dispose();
    container.remove();
  });

  it("cleans up on dispose", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const domRoot = new FoQueryDOMRoot(container);
    domRoot.dispose();

    expect(container.hasAttribute("data-foquery-root")).toBe(false);

    container.remove();
  });

  it("auto-removes leafs when their DOM element is removed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const parentEl = document.createElement("div");
    container.appendChild(parentEl);
    const parent = domRoot.appendParent(parentEl, "main");

    const leafEl = document.createElement("button");
    parentEl.appendChild(leafEl);
    parent.appendLeaf(leafEl, ["Action"]);

    expect(domRoot.query("//main/Action").length).toBe(1);

    // Remove the parent element from the DOM — observer should clean up the parent and its leaf
    container.removeChild(parentEl);

    await new Promise((r) => setTimeout(r, 0));

    expect(domRoot.root.children.size).toBe(0);
    expect(domRoot.query("//main/Action").length).toBe(0);

    domRoot.dispose();
    container.remove();
  });

  it("handles rapid add/remove cycles", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    // Rapidly add and remove elements
    for (let i = 0; i < 5; i++) {
      const el = document.createElement("div");
      container.appendChild(el);
      domRoot.appendParent(el, `item${i}`);
      container.removeChild(el);
    }

    await new Promise((r) => setTimeout(r, 0));

    expect(domRoot.root.children.size).toBe(0);

    domRoot.dispose();
    container.remove();
  });

  it("does not throw when disposing twice", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const domRoot = new FoQueryDOMRoot(container);
    domRoot.dispose();
    domRoot.dispose();

    container.remove();
  });
});
