/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import { FoQueryDOMRoot } from "./foquery-dom-root";

describe("FoQueryDOMParent", () => {
  it("creates and attaches a parent node", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const headerEl = document.createElement("div");
    container.appendChild(headerEl);
    const header = domRoot.appendParent(headerEl, "header");

    expect(header.node.name).toBe("header");
    expect(header.node.parent).toBe(domRoot.root);
    expect(domRoot.root.children.has(header.node)).toBe(true);
    expect(headerEl.getAttribute("data-foquery-parent")).toBe("header");

    expect(domRoot.query("//header").length).toBe(1);

    header.remove();
    domRoot.dispose();
    container.remove();
  });

  it("removes cleanly", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const headerEl = document.createElement("div");
    container.appendChild(headerEl);
    const header = domRoot.appendParent(headerEl, "header");

    header.remove();

    expect(domRoot.root.children.size).toBe(0);
    expect(header.node.parent).toBeUndefined();
    expect(headerEl.hasAttribute("data-foquery-parent")).toBe(false);

    expect(domRoot.query("//header").length).toBe(0);

    domRoot.dispose();
    container.remove();
  });

  it("builds nested parents via appendParent", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const headerEl = document.createElement("div");
    const navEl = document.createElement("div");
    container.appendChild(headerEl);
    headerEl.appendChild(navEl);

    const header = domRoot.appendParent(headerEl, "header");
    const nav = header.appendParent(navEl, "nav");

    expect(header.node.children.has(nav.node)).toBe(true);
    expect(nav.node.parent).toBe(header.node);

    expect(domRoot.query("//header/nav").length).toBe(1);

    nav.remove();
    header.remove();
    domRoot.dispose();
    container.remove();
  });

  it("builds sibling parents", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const headerEl = document.createElement("div");
    const mainEl = document.createElement("div");
    const footerEl = document.createElement("div");
    container.appendChild(headerEl);
    container.appendChild(mainEl);
    container.appendChild(footerEl);

    const header = domRoot.appendParent(headerEl, "header");
    const main = domRoot.appendParent(mainEl, "main");
    const footer = domRoot.appendParent(footerEl, "footer");

    expect(domRoot.root.children.size).toBe(3);
    expect(domRoot.query("/Root/*[@type='parent']").length).toBe(3);

    header.remove();
    main.remove();
    footer.remove();
    domRoot.dispose();
    container.remove();
  });

  it("auto-removes when DOM element is removed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const headerEl = document.createElement("div");
    container.appendChild(headerEl);
    domRoot.appendParent(headerEl, "header");

    expect(domRoot.root.children.size).toBe(1);

    // Remove from DOM — MutationObserver will fire async
    container.removeChild(headerEl);

    // Wait for MutationObserver callback
    await new Promise((r) => setTimeout(r, 0));

    expect(domRoot.root.children.size).toBe(0);
    expect(domRoot.query("//header").length).toBe(0);

    domRoot.dispose();
    container.remove();
  });

  it("renames a parent and updates query results and data attribute", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const headerEl = document.createElement("div");
    container.appendChild(headerEl);
    const header = domRoot.appendParent(headerEl, "header");

    const navEl = document.createElement("div");
    headerEl.appendChild(navEl);
    header.appendParent(navEl, "nav");

    expect(domRoot.query("//header/nav").length).toBe(1);

    header.rename("sidebar");

    expect(domRoot.query("//header").length).toBe(0);
    expect(domRoot.query("//sidebar/nav").length).toBe(1);
    expect(headerEl.getAttribute("data-foquery-parent")).toBe("sidebar");

    domRoot.dispose();
    container.remove();
  });

  it("auto-removes nested parents when ancestor DOM element is removed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const mainEl = document.createElement("div");
    container.appendChild(mainEl);
    const main = domRoot.appendParent(mainEl, "main");

    const sidebarEl = document.createElement("div");
    mainEl.appendChild(sidebarEl);
    main.appendParent(sidebarEl, "sidebar");

    expect(domRoot.query("//*[@type='parent']").length).toBe(2);

    // Remove the ancestor — MutationObserver should clean up both
    container.removeChild(mainEl);

    await new Promise((r) => setTimeout(r, 0));

    expect(domRoot.root.children.size).toBe(0);
    expect(domRoot.query("//*[@type='parent']").length).toBe(0);

    domRoot.dispose();
    container.remove();
  });
});
