/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect, vi } from "vitest";
import { FoQueryRootNode } from "./foquery-root-node";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";

describe("FoQueryLeafNode", () => {
  it("deduplicates names so remove() leaves no orphaned XML elements", () => {
    const rootNode = new FoQueryRootNode(window);
    const leaf = new FoQueryLeafNode(["A", "B", "A"], rootNode.root);
    rootNode.appendLeaf(leaf, document.createElement("button"));

    expect(leaf.leaf.names).toEqual(["A", "B"]);
    expect(rootNode.query("//A")).toHaveLength(1);

    leaf.remove();

    expect(rootNode.query("//A")).toHaveLength(0);
    expect(rootNode.query("//B")).toHaveLength(0);
  });

  it("deduplicates names on rename", () => {
    const rootNode = new FoQueryRootNode(window);
    const leaf = new FoQueryLeafNode(["A"], rootNode.root);
    rootNode.appendLeaf(leaf, document.createElement("button"));

    leaf.rename(["B", "B"]);

    expect(leaf.leaf.names).toEqual(["B"]);
    expect(rootNode.query("//B")).toHaveLength(1);

    leaf.remove();

    expect(rootNode.query("//*[@type='leaf']")).toHaveLength(0);
  });

  it("applies rename() called before the leaf is attached", () => {
    const rootNode = new FoQueryRootNode(window);
    const leaf = new FoQueryLeafNode(["Old"], rootNode.root);

    leaf.rename(["New"]);
    rootNode.appendLeaf(leaf, document.createElement("button"));

    expect(rootNode.query("//Old")).toHaveLength(0);
    expect(rootNode.query("//New")).toHaveLength(1);
  });

  it("does not notify subscribers when renamed to the same names", () => {
    const rootNode = new FoQueryRootNode(window);
    const leaf = new FoQueryLeafNode(["A", "B"], rootNode.root);
    rootNode.appendLeaf(leaf, document.createElement("button"));
    const listener = vi.fn();
    rootNode.root.subscribe(listener);

    leaf.rename(["A", "B"]);

    expect(listener).not.toHaveBeenCalled();

    leaf.rename(["B", "A"]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not keep the caller's names array by reference", () => {
    const rootNode = new FoQueryRootNode(window);
    const names = ["A"];
    const leaf = new FoQueryLeafNode(names, rootNode.root);
    rootNode.appendLeaf(leaf, document.createElement("button"));

    names.push("B");
    leaf.rename(names);

    expect(rootNode.query("//B")).toHaveLength(1);
  });

  it("preserves lastFocused when renamed after focus", () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);
    const leaf = new FoQueryLeafNode(["A"], rootNode.root);
    main.appendLeaf(leaf, document.createElement("button"));

    leaf.onFocusIn();
    leaf.rename(["A", "B"]);

    const [b] = rootNode.query("//main/B");
    expect(b.getAttribute("lastFocused")).toBe(String(leaf.leaf.lastFocused));
  });

  it("can be re-attached after remove()", () => {
    const rootNode = new FoQueryRootNode(window);
    const leaf = new FoQueryLeafNode(["A"], rootNode.root);
    const el = document.createElement("button");

    rootNode.appendLeaf(leaf, el);
    leaf.remove();
    rootNode.appendLeaf(leaf, el);

    expect(rootNode.query("//A")).toHaveLength(1);
    expect(rootNode.root.leafs.has(leaf.leaf)).toBe(true);
  });

  it("ignores repeated attach and remove calls", () => {
    const rootNode = new FoQueryRootNode(window);
    const leaf = new FoQueryLeafNode(["A"], rootNode.root);
    const el = document.createElement("button");

    rootNode.appendLeaf(leaf, el);
    rootNode.appendLeaf(leaf, el);
    expect(rootNode.query("//A")).toHaveLength(1);

    leaf.remove();
    leaf.remove();
    expect(rootNode.query("//A")).toHaveLength(0);
  });
});
