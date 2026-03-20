/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import { FoQueryDOMRoot } from "./foquery-dom-root";

describe("FoQueryDOMLeaf", () => {
  it("creates and attaches a leaf node", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const mainEl = document.createElement("div");
    container.appendChild(mainEl);
    const main = domRoot.appendParent(mainEl, "main");

    const btnEl = document.createElement("button");
    mainEl.appendChild(btnEl);
    const leaf = main.appendLeaf(btnEl, ["SelectedItem"]);

    expect(leaf.leaf.parent).toBe(main.node);
    expect(main.node.leafs.has(leaf.leaf)).toBe(true);
    expect(btnEl.getAttribute("data-foquery-leaf")).toBe("SelectedItem");

    const results = domRoot.query("//main/SelectedItem");
    expect(results.length).toBe(1);
    expect(results[0].foQueryLeafNode).toBeDefined();
    expect(results[0].foQueryLeafNode!.element.deref()).toBe(btnEl);

    leaf.remove();
    main.remove();
    domRoot.dispose();
    container.remove();
  });

  it("registers multiple names", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const mainEl = document.createElement("div");
    container.appendChild(mainEl);
    const main = domRoot.appendParent(mainEl, "main");

    const el = document.createElement("div");
    mainEl.appendChild(el);
    const leaf = main.appendLeaf(el, ["SelectedItem", "DefaultItem"]);

    const selected = domRoot.query("//main/SelectedItem");
    const defaultItem = domRoot.query("//main/DefaultItem");

    expect(selected.length).toBe(1);
    expect(defaultItem.length).toBe(1);
    expect(selected[0].foQueryLeafNode).toBe(defaultItem[0].foQueryLeafNode);

    leaf.remove();
    main.remove();
    domRoot.dispose();
    container.remove();
  });

  it("removes cleanly", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const mainEl = document.createElement("div");
    container.appendChild(mainEl);
    const main = domRoot.appendParent(mainEl, "main");

    const btnEl = document.createElement("button");
    mainEl.appendChild(btnEl);
    const leaf = main.appendLeaf(btnEl, ["SelectedItem"]);

    leaf.remove();

    expect(main.node.leafs.size).toBe(0);
    expect(leaf.leaf.parent).toBeUndefined();
    expect(btnEl.hasAttribute("data-foquery-leaf")).toBe(false);

    expect(domRoot.query("//main/SelectedItem").length).toBe(0);

    main.remove();
    domRoot.dispose();
    container.remove();
  });

  it("tracks lastFocused on focus events", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const mainEl = document.createElement("div");
    container.appendChild(mainEl);
    const main = domRoot.appendParent(mainEl, "main");

    const btnEl = document.createElement("button");
    mainEl.appendChild(btnEl);
    const leaf = main.appendLeaf(btnEl, ["SelectedItem"]);

    btnEl.focus();

    expect(leaf.leaf.lastFocused).toBeGreaterThan(0);
    expect(main.node.lastFocused).toBeGreaterThan(0);

    const xmlEl = leaf.leaf.xmlElements.get("SelectedItem")!;
    expect(xmlEl.getAttribute("lastFocused")).toBeTruthy();

    leaf.remove();
    main.remove();
    domRoot.dispose();
    container.remove();
  });

  it("builds a full tree queryable with XPath", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    // Build DOM structure
    const headerEl = document.createElement("div");
    const mainEl = document.createElement("div");
    const sidebarEl = document.createElement("div");
    const contentEl = document.createElement("div");
    container.appendChild(headerEl);
    container.appendChild(mainEl);
    mainEl.appendChild(sidebarEl);
    mainEl.appendChild(contentEl);

    // Build foquery tree
    const header = domRoot.appendParent(headerEl, "header");
    const main = domRoot.appendParent(mainEl, "main");
    const sidebar = main.appendParent(sidebarEl, "sidebar");
    const content = main.appendParent(contentEl, "content");

    // Add leaves
    const headerBtn = document.createElement("button");
    const sidebarBtn = document.createElement("button");
    const contentBtn1 = document.createElement("button");
    const contentBtn2 = document.createElement("button");
    headerEl.appendChild(headerBtn);
    sidebarEl.appendChild(sidebarBtn);
    contentEl.appendChild(contentBtn1);
    contentEl.appendChild(contentBtn2);

    const headerLeaf = header.appendLeaf(headerBtn, ["DefaultItem"]);
    const sidebarLeaf = sidebar.appendLeaf(sidebarBtn, ["SelectedItem"]);
    const contentLeaf1 = content.appendLeaf(contentBtn1, ["SelectedItem"]);
    const contentLeaf2 = content.appendLeaf(contentBtn2, ["DefaultItem"]);

    expect(domRoot.query("//SelectedItem").length).toBe(2);
    expect(domRoot.query("//content/SelectedItem").length).toBe(1);
    expect(domRoot.query("//header/DefaultItem").length).toBe(1);
    expect(domRoot.query("//*[@type='parent']").length).toBe(4);

    // Cleanup
    headerLeaf.remove();
    sidebarLeaf.remove();
    contentLeaf1.remove();
    contentLeaf2.remove();
    content.remove();
    sidebar.remove();
    main.remove();
    header.remove();
    domRoot.dispose();
    container.remove();
  });

  it("renames a leaf and updates query results and data attribute", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const domRoot = new FoQueryDOMRoot(container);

    const mainEl = document.createElement("div");
    container.appendChild(mainEl);
    const main = domRoot.appendParent(mainEl, "main");

    const btnEl = document.createElement("button");
    mainEl.appendChild(btnEl);
    const leaf = main.appendLeaf(btnEl, ["SelectedItem"]);

    expect(domRoot.query("//main/SelectedItem").length).toBe(1);

    leaf.rename(["DefaultItem"]);

    expect(domRoot.query("//main/SelectedItem").length).toBe(0);
    expect(domRoot.query("//main/DefaultItem").length).toBe(1);
    expect(btnEl.getAttribute("data-foquery-leaf")).toBe("DefaultItem");

    leaf.remove();
    main.remove();
    domRoot.dispose();
    container.remove();
  });
});
