/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import { FoQueryRootNode } from "./foquery-root-node";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";

describe("Tree building and XPath queries", () => {
  it("queries leaf nodes by name using XPath", () => {
    const rootNode = new FoQueryRootNode(window);

    const header = new FoQueryParentNode("header", rootNode.root);
    rootNode.appendParent(header);

    const el = document.createElement("button");
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    header.appendLeaf(leaf, el);

    const results = rootNode.query("//SelectedItem");

    expect(results.length).toBe(1);
    expect(results[0].foQueryLeafNode).toBeDefined();
    expect(results[0].foQueryLeafNode!.element.deref()).toBe(el);
  });

  it("queries leaf nodes under a specific parent path", () => {
    const rootNode = new FoQueryRootNode(window);

    const header = new FoQueryParentNode("header", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(header);
    rootNode.appendParent(main);

    const headerBtn = document.createElement("button");
    const mainBtn = document.createElement("button");
    const headerLeaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    const mainLeaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    header.appendLeaf(headerLeaf, headerBtn);
    main.appendLeaf(mainLeaf, mainBtn);

    const results = rootNode.query("//main/SelectedItem");

    expect(results.length).toBe(1);
    expect(results[0].foQueryLeafNode!.element.deref()).toBe(mainBtn);
  });

  it("queries multiple leaf names on same element", () => {
    const rootNode = new FoQueryRootNode(window);

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("div");
    const leaf = new FoQueryLeafNode(["SelectedItem", "DefaultItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    const selected = rootNode.query("//SelectedItem");
    const defaultItem = rootNode.query("//DefaultItem");

    expect(selected.length).toBe(1);
    expect(defaultItem.length).toBe(1);

    // Both point to the same leaf
    expect(selected[0].foQueryLeafNode).toBe(defaultItem[0].foQueryLeafNode);
  });

  it("queries deeply nested tree with XPath", () => {
    const rootNode = new FoQueryRootNode(window);

    const app = new FoQueryParentNode("app", rootNode.root);
    const sidebar = new FoQueryParentNode("sidebar", rootNode.root);
    const content = new FoQueryParentNode("content", rootNode.root);
    const panel = new FoQueryParentNode("panel", rootNode.root);

    rootNode.appendParent(app);
    app.appendParent(sidebar);
    app.appendParent(content);
    content.appendParent(panel);

    const sidebarBtn = document.createElement("button");
    const panelBtn = document.createElement("button");
    const sidebarLeaf = new FoQueryLeafNode(["DefaultItem"], rootNode.root);
    const panelLeaf = new FoQueryLeafNode(["DefaultItem"], rootNode.root);
    sidebar.appendLeaf(sidebarLeaf, sidebarBtn);
    panel.appendLeaf(panelLeaf, panelBtn);

    const results = rootNode.query("//content//DefaultItem");

    expect(results.length).toBe(1);
    expect(results[0].foQueryLeafNode!.element.deref()).toBe(panelBtn);
  });

  it("queries parent nodes by type attribute", () => {
    const rootNode = new FoQueryRootNode(window);

    const header = new FoQueryParentNode("header", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(header);
    rootNode.appendParent(main);

    const el = document.createElement("div");
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    const parents = rootNode.query("//*[@type='parent']");

    expect(parents.length).toBe(2);
  });

  it("reflects tree mutations in subsequent XPath queries", () => {
    const rootNode = new FoQueryRootNode(window);

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    expect(rootNode.query("//SelectedItem").length).toBe(1);

    leaf.remove();

    expect(rootNode.query("//SelectedItem").length).toBe(0);
  });

  it("uses lastFocused attribute in XPath queries", () => {
    const rootNode = new FoQueryRootNode(window);

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    const leaf1 = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    const leaf2 = new FoQueryLeafNode(["DefaultItem"], rootNode.root);
    main.appendLeaf(leaf1, el1);
    main.appendLeaf(leaf2, el2);

    // Simulate focus on leaf1
    const now = Date.now();
    leaf1.leaf.lastFocused = now;
    leaf1.leaf.xmlElements.forEach((xmlEl) => xmlEl.setAttribute("lastFocused", now.toString()));

    const results = rootNode.query("//*[@lastFocused]");

    expect(results.length).toBe(1);
    expect(results[0].foQueryLeafNode!.element.deref()).toBe(el1);
  });

  it("renames a leaf and updates XPath results", () => {
    const rootNode = new FoQueryRootNode(window);

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    expect(rootNode.query("//main/SelectedItem").length).toBe(1);
    expect(rootNode.query("//main/DefaultItem").length).toBe(0);

    leaf.rename(["DefaultItem"]);

    expect(rootNode.query("//main/SelectedItem").length).toBe(0);
    expect(rootNode.query("//main/DefaultItem").length).toBe(1);
    expect(rootNode.query("//main/DefaultItem")[0].foQueryLeafNode!.element.deref()).toBe(el);
  });

  it("renames a leaf preserving shared names", () => {
    const rootNode = new FoQueryRootNode(window);

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    const leaf = new FoQueryLeafNode(["SelectedItem", "DefaultItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    expect(rootNode.query("//main/SelectedItem").length).toBe(1);
    expect(rootNode.query("//main/DefaultItem").length).toBe(1);

    // Keep DefaultItem, replace SelectedItem with FocusedItem
    leaf.rename(["DefaultItem", "FocusedItem"]);

    expect(rootNode.query("//main/SelectedItem").length).toBe(0);
    expect(rootNode.query("//main/DefaultItem").length).toBe(1);
    expect(rootNode.query("//main/FocusedItem").length).toBe(1);

    // Both still reference the same leaf
    expect(rootNode.query("//main/DefaultItem")[0].foQueryLeafNode).toBe(
      rootNode.query("//main/FocusedItem")[0].foQueryLeafNode,
    );
  });

  it("parent.query() evaluates xpath relative to parent", () => {
    const rootNode = new FoQueryRootNode(window);

    const header = new FoQueryParentNode("header", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(header);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    header.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el1);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el2);

    // Root query finds both
    expect(rootNode.query("//SelectedItem").length).toBe(2);

    // Parent query only finds its own
    expect(main.query("./SelectedItem").length).toBe(1);
    expect(header.query("./SelectedItem").length).toBe(1);
    expect(main.query("./DefaultItem").length).toBe(0);
  });

  it("removing a parent cleans up its children and leaves from the XML tree", () => {
    const rootNode = new FoQueryRootNode(window);

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const sidebar = new FoQueryParentNode("sidebar", rootNode.root);
    main.appendParent(sidebar);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el1);
    sidebar.appendLeaf(new FoQueryLeafNode(["DefaultItem"], rootNode.root), el2);

    expect(rootNode.query("//*[@type='parent']").length).toBe(2);
    expect(rootNode.query("//SelectedItem").length).toBe(1);
    expect(rootNode.query("//DefaultItem").length).toBe(1);

    // Remove top-level parent — its XML subtree (including sidebar + leaves) is removed
    main.remove();

    expect(rootNode.query("//*[@type='parent']").length).toBe(0);
    expect(rootNode.query("//SelectedItem").length).toBe(0);
    expect(rootNode.query("//DefaultItem").length).toBe(0);
  });
});
