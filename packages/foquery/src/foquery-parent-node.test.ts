/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import { FoQueryRootNode } from "./foquery-root-node";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";

describe("FoQueryParentNode", () => {
  it("creates a parent node with correct XML element", () => {
    const rootNode = new FoQueryRootNode();
    const parent = new FoQueryParentNode("header", rootNode.root);

    expect(parent.node.name).toBe("header");
    expect(parent.xmlElement.tagName).toBe("header");
    expect(parent.xmlElement.getAttribute("type")).toBe("parent");
    expect(parent.node.children.size).toBe(0);
    expect(parent.node.leafs.size).toBe(0);
    expect(parent.node.parent).toBeUndefined();
  });

  it("appends to a parent node", () => {
    const rootNode = new FoQueryRootNode();
    const parent = new FoQueryParentNode("header", rootNode.root);

    rootNode.appendParent(parent);

    expect(parent.node.parent).toBe(rootNode.root);
    expect(rootNode.root.children.has(parent.node)).toBe(true);
    expect(rootNode.root.xmlElement.contains(parent.xmlElement)).toBe(true);
  });

  it("removes from parent node", () => {
    const rootNode = new FoQueryRootNode();
    const parent = new FoQueryParentNode("header", rootNode.root);

    rootNode.appendParent(parent);
    parent.remove();

    expect(parent.node.parent).toBeUndefined();
    expect(rootNode.root.children.has(parent.node)).toBe(false);
    expect(rootNode.root.xmlElement.contains(parent.xmlElement)).toBe(false);
  });

  it("builds a nested tree via appendParent", () => {
    const rootNode = new FoQueryRootNode();

    const header = new FoQueryParentNode("header", rootNode.root);
    const nav = new FoQueryParentNode("nav", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);

    rootNode.appendParent(header);
    header.appendParent(nav);
    rootNode.appendParent(main);

    expect(rootNode.root.children.size).toBe(2);
    expect(header.node.children.size).toBe(1);
    expect(header.node.children.has(nav.node)).toBe(true);
    expect(nav.node.parent).toBe(header.node);

    // XML structure: <Root><header><nav/></header><main/></Root>
    expect(rootNode.root.xmlElement.children.length).toBe(2);
    expect(rootNode.root.xmlElement.children[0].tagName).toBe("header");
    expect(rootNode.root.xmlElement.children[0].children[0].tagName).toBe("nav");
    expect(rootNode.root.xmlElement.children[1].tagName).toBe("main");

    main.remove();
    nav.remove();
    header.remove();
  });

  it("removing a mid-tree node removes it and its XML subtree", () => {
    const rootNode = new FoQueryRootNode();

    const header = new FoQueryParentNode("header", rootNode.root);
    const nav = new FoQueryParentNode("nav", rootNode.root);

    rootNode.appendParent(header);
    header.appendParent(nav);
    header.remove();

    expect(rootNode.root.children.size).toBe(0);
    expect(rootNode.root.xmlElement.children.length).toBe(0);
  });

  it("renames a parent node and updates the XML element", () => {
    const rootNode = new FoQueryRootNode();

    const header = new FoQueryParentNode("header", rootNode.root);
    rootNode.appendParent(header);

    const nav = new FoQueryParentNode("nav", rootNode.root);
    header.appendParent(nav);

    const el = document.createElement("button");
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    nav.appendLeaf(leaf, el);

    // Verify initial state
    expect(rootNode.query("//header/nav/SelectedItem").length).toBe(1);

    // Rename header -> sidebar
    header.rename("sidebar");

    expect(header.node.name).toBe("sidebar");
    expect(header.xmlElement.tagName).toBe("sidebar");
    expect(rootNode.query("//header").length).toBe(0);
    expect(rootNode.query("//sidebar/nav/SelectedItem").length).toBe(1);

    // Children are preserved
    expect(header.node.children.has(nav.node)).toBe(true);
  });

  it("rename is a no-op when name is unchanged", () => {
    const rootNode = new FoQueryRootNode();

    const header = new FoQueryParentNode("header", rootNode.root);
    rootNode.appendParent(header);

    const xmlBefore = header.xmlElement;
    header.rename("header");

    expect(header.xmlElement).toBe(xmlBefore);
  });
});
