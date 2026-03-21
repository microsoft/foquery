/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect, vi } from "vitest";
import { FoQueryRootNode } from "./foquery-root-node";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";
import { FoQueryRequest } from "./foquery-request";
import { RequestStatus } from "./consts";
import type * as Types from "./types";

describe("FoQueryRequest", () => {
  it("focuses a leaf matched by xpath", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    const focusSpy = vi.spyOn(el, "focus");
    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it("focuses a leaf with custom focus function", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    const customFocus = vi.fn().mockResolvedValue(true);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root, customFocus);
    main.appendLeaf(leaf, el);

    const focusSpy = vi.spyOn(el, "focus");
    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(customFocus).toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("falls back to element.focus when custom focus returns false", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const customFocus = vi.fn().mockResolvedValue(false);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root, customFocus);
    main.appendLeaf(leaf, el);

    const focusSpy = vi.spyOn(el, "focus");
    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(customFocus).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it("resolves NoCandidates when parent matched but has no focus", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const request = new FoQueryRequest("//main", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.NoCandidates);
    expect(request.diagnostics!.matchedElements.length).toBe(1);
    expect(request.diagnostics!.candidates.length).toBe(0);
    expect(request.diagnostics!.winner).toBeUndefined();
  });

  it("focuses parent node with function focus property", async () => {
    const rootNode = new FoQueryRootNode();
    const parentFocus = vi.fn().mockResolvedValue(true);
    const main = new FoQueryParentNode("main", rootNode.root, { focus: parentFocus });
    rootNode.appendParent(main);

    const request = new FoQueryRequest("//main", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(parentFocus).toHaveBeenCalled();
  });

  it("evaluates string focus as relative xpath on parent", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root, { focus: "./SelectedItem" });
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    const focusSpy = vi.spyOn(el, "focus");
    const request = new FoQueryRequest("//main", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it("calls parent arbiter when string focus yields multiple candidates", async () => {
    const rootNode = new FoQueryRootNode();
    const arbiter = vi.fn((candidates: Types.XmlElement[]) => candidates[candidates.length - 1]);
    const main = new FoQueryParentNode("main", rootNode.root, { focus: "./*", arbiter });
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    const leaf1 = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    const leaf2 = new FoQueryLeafNode(["DefaultItem"], rootNode.root);
    main.appendLeaf(leaf1, el1);
    main.appendLeaf(leaf2, el2);

    const focus1Spy = vi.spyOn(el1, "focus");
    const focus2Spy = vi.spyOn(el2, "focus");

    const request = new FoQueryRequest("//main", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(arbiter).toHaveBeenCalled();
    expect(focus1Spy).not.toHaveBeenCalled();
    expect(focus2Spy).toHaveBeenCalled();
    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("resolves when matching leaf is added after request", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    const status = await request.promise;
    expect(status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("can be canceled", async () => {
    const rootNode = new FoQueryRootNode();
    const request = new FoQueryRequest("//nonexistent", rootNode.root);
    request.cancel();
    const status = await request.promise;
    expect(status).toBe(RequestStatus.Canceled);
  });

  it("recursively evaluates nested parent string focus", async () => {
    const rootNode = new FoQueryRootNode();
    const app = new FoQueryParentNode("app", rootNode.root, { focus: "./content" });
    rootNode.appendParent(app);
    const content = new FoQueryParentNode("content", rootNode.root, { focus: "./SelectedItem" });
    app.appendParent(content);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    content.appendLeaf(leaf, el);

    const focusSpy = vi.spyOn(el, "focus");
    const request = new FoQueryRequest("//app", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(el);
  });

  // --- Diagnostics ---

  it("provides diagnostics with matched elements, candidates, and winner", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    await request.promise;

    expect(request.diagnostics).toBeDefined();
    expect(request.diagnostics!.matchedElements.length).toBe(1);
    expect(request.diagnostics!.candidates.length).toBe(1);
    expect(request.diagnostics!.winner).toBeDefined();
    expect(request.diagnostics!.winner!.foQueryLeafNode!.element.deref()).toBe(el);
    document.body.removeChild(el);
  });

  it("diagnostics shows all candidates and arbiter winner", async () => {
    const rootArbiter = vi.fn((candidates: Types.XmlElement[]) => candidates[1]);
    const rootNode = new FoQueryRootNode("Root", { arbiter: rootArbiter });

    const header = new FoQueryParentNode("header", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(header);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    header.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el1);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el2);

    const request = new FoQueryRequest("//SelectedItem", rootNode.root);
    await request.promise;

    expect(request.diagnostics!.matchedElements.length).toBe(2);
    expect(request.diagnostics!.candidates.length).toBe(2);
    expect(request.diagnostics!.winner!.foQueryLeafNode!.element.deref()).toBe(el2);
    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("diagnostics includes startedAt, resolvedAt, and xpath", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const before = Date.now();
    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    await request.promise;
    const after = Date.now();

    expect(request.diagnostics!.xpath).toBe("//main/SelectedItem");
    expect(request.diagnostics!.startedAt).toBeGreaterThanOrEqual(before);
    expect(request.diagnostics!.startedAt).toBeLessThanOrEqual(after);
    expect(request.diagnostics!.resolvedAt).toBeDefined();
    expect(request.diagnostics!.resolvedAt!).toBeGreaterThanOrEqual(request.diagnostics!.startedAt);
    expect(request.diagnostics!.resolvedAt!).toBeLessThanOrEqual(after);

    document.body.removeChild(el);
  });

  it("diagnostics resolvedAt is set on timeout", async () => {
    const rootNode = new FoQueryRootNode();

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 100 });
    await request.promise;

    expect(request.diagnostics!.resolvedAt).toBeDefined();
    expect(request.diagnostics!.resolvedAt!).toBeGreaterThanOrEqual(request.diagnostics!.startedAt);
  });

  it("diagnostics resolvedAt is set on cancel", async () => {
    const rootNode = new FoQueryRootNode();

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });
    request.cancel();
    await request.promise;

    expect(request.diagnostics!.resolvedAt).toBeDefined();
    expect(request.diagnostics!.xpath).toBe("//nonexistent");
  });

  it("diagnostics resolvedAt is undefined while request is pending", () => {
    const rootNode = new FoQueryRootNode();

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });

    expect(request.diagnostics).toBeDefined();
    expect(request.diagnostics!.startedAt).toBeGreaterThan(0);
    expect(request.diagnostics!.resolvedAt).toBeUndefined();

    request.cancel();
  });

  it("diagnostics xpath matches for parent-bound request", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const request = new FoQueryRequest("./SelectedItem", main.node);
    await request.promise;

    expect(request.diagnostics!.xpath).toBe("./SelectedItem");
    expect(request.diagnostics!.resolvedAt).toBeDefined();

    document.body.removeChild(el);
  });

  // --- lastFocused sorting ---

  it("picks the most recently focused candidate", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    const leaf1 = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    const leaf2 = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf1, el1);
    main.appendLeaf(leaf2, el2);

    leaf1.leaf.lastFocused = 100;
    leaf2.leaf.lastFocused = 200;

    const focus1Spy = vi.spyOn(el1, "focus");
    const focus2Spy = vi.spyOn(el2, "focus");

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    await request.promise;

    expect(focus2Spy).toHaveBeenCalled();
    expect(focus1Spy).not.toHaveBeenCalled();
    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("passes candidates sorted by lastFocused to arbiter", async () => {
    const capturedOrder: (number | undefined)[] = [];
    const rootArbiter = vi.fn((candidates: Types.XmlElement[]) => {
      for (const c of candidates) {
        capturedOrder.push(c.foQueryLeafNode?.lastFocused);
      }
      return candidates[0];
    });
    const rootNode = new FoQueryRootNode("Root", { arbiter: rootArbiter });
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    const el3 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    document.body.appendChild(el3);
    const leaf1 = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    const leaf2 = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    const leaf3 = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf1, el1);
    main.appendLeaf(leaf2, el2);
    main.appendLeaf(leaf3, el3);

    await new Promise((r) => setTimeout(r, 10));

    leaf1.leaf.lastFocused = 100;
    leaf2.leaf.lastFocused = 300;
    leaf3.leaf.lastFocused = 200;

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    await request.promise;

    expect(capturedOrder).toEqual([300, 200, 100]);

    document.body.removeChild(el1);
    document.body.removeChild(el2);
    document.body.removeChild(el3);
  });

  it("uses parent lastFocused as fallback when sub-candidates lack it", async () => {
    const rootNode = new FoQueryRootNode();

    const sidebar = new FoQueryParentNode("sidebar", rootNode.root, { focus: "./SelectedItem" });
    const content = new FoQueryParentNode("content", rootNode.root, { focus: "./SelectedItem" });
    rootNode.appendParent(sidebar);
    rootNode.appendParent(content);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    const sLeaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    const cLeaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    sidebar.appendLeaf(sLeaf, el1);
    content.appendLeaf(cLeaf, el2);

    (document.activeElement as HTMLElement)?.blur();
    sLeaf.leaf.lastFocused = undefined;
    cLeaf.leaf.lastFocused = undefined;

    sidebar.node.lastFocused = 100;
    content.node.lastFocused = 200;

    const focus1Spy = vi.spyOn(el1, "focus");
    const focus2Spy = vi.spyOn(el2, "focus");

    const request = new FoQueryRequest("/Root/*", rootNode.root);
    await request.promise;

    expect(focus2Spy).toHaveBeenCalled();
    expect(focus1Spy).not.toHaveBeenCalled();

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  // --- Parent-bound requests ---

  it("evaluates xpath relative to parent when parent-bound", async () => {
    const rootNode = new FoQueryRootNode();

    const header = new FoQueryParentNode("header", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(header);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    header.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el1);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el2);

    const focus1Spy = vi.spyOn(el1, "focus");
    const focus2Spy = vi.spyOn(el2, "focus");

    const request = new FoQueryRequest("./SelectedItem", main.node);
    await request.promise;

    expect(focus2Spy).toHaveBeenCalled();
    expect(focus1Spy).not.toHaveBeenCalled();

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("parent-bound request still reacts to tree changes via subscription", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const request = new FoQueryRequest("./SelectedItem", main.node);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const status = await request.promise;
    expect(status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  // --- requestFocus convenience method ---

  it("root.requestFocus creates a request evaluated from root", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const foQueryRequest = rootNode.requestFocus("//main/SelectedItem");
    const status = await foQueryRequest.promise;
    expect(status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("parent.requestFocus creates a request evaluated from parent", async () => {
    const rootNode = new FoQueryRootNode();
    const header = new FoQueryParentNode("header", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(header);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    header.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el1);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el2);

    const focus1Spy = vi.spyOn(el1, "focus");
    const focus2Spy = vi.spyOn(el2, "focus");

    const foQueryRequest = main.requestFocus("./SelectedItem");
    await foQueryRequest.promise;

    expect(focus2Spy).toHaveBeenCalled();
    expect(focus1Spy).not.toHaveBeenCalled();

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  // --- Parent axis (..) from child context ---

  it("parent axis (..) focuses parent with string focus from child context", async () => {
    const rootNode = new FoQueryRootNode();

    const messages = new FoQueryParentNode("messages", rootNode.root, {
      focus: "./MessageInput",
    });
    rootNode.appendParent(messages);

    const compose = new FoQueryParentNode("compose", rootNode.root);
    messages.appendParent(compose);

    const el = document.createElement("input");
    document.body.appendChild(el);
    messages.appendLeaf(new FoQueryLeafNode(["MessageInput"], rootNode.root), el);

    const focusSpy = vi.spyOn(el, "focus");

    // ".." from compose context should match <messages>, which has string focus
    const request = new FoQueryRequest("..", compose.node);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    expect(focusSpy).toHaveBeenCalled();
    expect(request.diagnostics!.matchedElements.length).toBe(1);
    expect(request.diagnostics!.candidates.length).toBe(1);
    document.body.removeChild(el);
  });

  it("parent axis (..) resolves NoCandidates when parent has no focus", async () => {
    const rootNode = new FoQueryRootNode();

    const messages = new FoQueryParentNode("messages", rootNode.root);
    rootNode.appendParent(messages);

    const compose = new FoQueryParentNode("compose", rootNode.root);
    messages.appendParent(compose);

    // ".." from compose matches <messages>, but messages has no focus property
    // so it should not be a candidate
    const request = new FoQueryRequest("..", compose.node);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.NoCandidates);
    expect(request.diagnostics!.matchedElements.length).toBe(1);
    expect(request.diagnostics!.candidates.length).toBe(0);
  });

  // --- Parent-bound with string focus ---

  it("parent-bound request resolves via parent string focus", async () => {
    const rootNode = new FoQueryRootNode();

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const content = new FoQueryParentNode("content", rootNode.root, { focus: "./SelectedItem" });
    main.appendParent(content);

    const el = document.createElement("button");
    document.body.appendChild(el);
    content.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const focusSpy = vi.spyOn(el, "focus");

    // Request bound to main, matches content which has string focus
    const request = new FoQueryRequest("./content", main.node);
    await request.promise;

    expect(focusSpy).toHaveBeenCalled();
    expect(request.diagnostics!.candidates.length).toBe(1);

    document.body.removeChild(el);
  });

  // --- Edge cases ---

  it("returns empty diagnostics when xpath matches nothing", async () => {
    const rootNode = new FoQueryRootNode();

    const request = new FoQueryRequest("//nonexistent", rootNode.root);
    // No candidates, no matched elements — stays waiting
    request.cancel();
    await request.promise;

    // Diagnostics should still have been set from _matchPath
    expect(request.diagnostics).toBeDefined();
    expect(request.diagnostics!.matchedElements.length).toBe(0);
    expect(request.diagnostics!.candidates.length).toBe(0);
    expect(request.diagnostics!.winner).toBeUndefined();
  });

  it("handles multiple concurrent requests on same tree", async () => {
    const rootNode = new FoQueryRootNode();

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el1);
    main.appendLeaf(new FoQueryLeafNode(["DefaultItem"], rootNode.root), el2);

    const req1 = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    const req2 = new FoQueryRequest("//main/DefaultItem", rootNode.root);

    const [status1, status2] = await Promise.all([req1.promise, req2.promise]);

    expect(status1).toBe(RequestStatus.Succeeded);
    expect(status2).toBe(RequestStatus.Succeeded);

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  // --- Progressive matching ---

  it("progressive: resolves immediately when full xpath matches", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root, { timeout: 5000 });
    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("progressive: tracks partial matches when full xpath doesn't match yet", async () => {
    const rootNode = new FoQueryRootNode();

    // Full query has predicates: //main[@active='true']/SelectedItem
    // Simplification chain: //main[@active='true']/SelectedItem → //main/SelectedItem
    // After adding main + leaf, //main/SelectedItem matches but full query doesn't
    const request = new FoQueryRequest("//main[@active='true']/SelectedItem", rootNode.root, {
      timeout: 1000,
    });

    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    await new Promise((r) => setTimeout(r, 50));

    expect(request.diagnostics).toBeDefined();
    expect(request.diagnostics!.progressiveMatches.length).toBeGreaterThan(0);
    expect(request.diagnostics!.progressiveMatches[0].matched).toBe(true);

    request.cancel();
    await request.promise;
    document.body.removeChild(el);
  });

  it("progressive: resolves when tree grows to match full xpath", async () => {
    const rootNode = new FoQueryRootNode();

    // Query without predicates — no simplification chain, but tests timeout + eventual match
    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root, { timeout: 5000 });

    // Tree grows: first main, then leaf
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const status = await request.promise;

    expect(status).toBe(RequestStatus.Succeeded);

    document.body.removeChild(el);
  });

  it("progressive: times out when full xpath never matches", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const request = new FoQueryRequest("//main/NonExistent", rootNode.root, { timeout: 200 });
    const status = await request.promise;

    expect(status).toBe(RequestStatus.TimedOut);
    expect(request.diagnostics).toBeDefined();
  });

  it("progressive: records degradation when partial match disappears", async () => {
    const rootNode = new FoQueryRootNode();

    // Use predicate so we get simplifications: //main[@x]/SelectedItem → //main/SelectedItem
    const request = new FoQueryRequest("//main[@x]/SelectedItem", rootNode.root, { timeout: 500 });

    // Add main + leaf — //main/SelectedItem matches (partial)
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    await new Promise((r) => setTimeout(r, 50));

    // Verify partial match was recorded
    expect(request.diagnostics!.progressiveMatches.length).toBeGreaterThan(0);

    // Remove main — degradation
    main.remove();

    await new Promise((r) => setTimeout(r, 50));

    const degraded = request.diagnostics!.progressiveMatches.filter((m) => m.degraded);
    expect(degraded.length).toBeGreaterThan(0);

    request.cancel();
    await request.promise;
    document.body.removeChild(el);
  });

  // --- Single active request ---

  it("consecutive requestFocus cancels the pending previous request", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    // req1 targets something that doesn't exist yet — stays pending
    const req1 = rootNode.requestFocus("//main/NonExistent", { timeout: 5000 });

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["DefaultItem"], rootNode.root), el);

    // req2 should cancel req1
    const req2 = rootNode.requestFocus("//main/DefaultItem");

    const [status1, status2] = await Promise.all([req1.promise, req2.promise]);

    expect(status1).toBe(RequestStatus.Canceled);
    expect(status2).toBe(RequestStatus.Succeeded);

    document.body.removeChild(el);
  });

  it("requestFocus on different parents also cancels pending previous", async () => {
    const rootNode = new FoQueryRootNode();
    const header = new FoQueryParentNode("header", rootNode.root);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(header);
    rootNode.appendParent(main);

    // req1 targets something that doesn't exist — stays pending
    const req1 = header.requestFocus("./NonExistent", { timeout: 5000 });

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    // req2 on different parent cancels req1
    const req2 = main.requestFocus("./SelectedItem");

    const [status1, status2] = await Promise.all([req1.promise, req2.promise]);

    expect(status1).toBe(RequestStatus.Canceled);
    expect(status2).toBe(RequestStatus.Succeeded);

    document.body.removeChild(el);
  });

  // --- Corner cases ---

  it("already-resolved request does not block a new requestFocus", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    document.body.appendChild(el1);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el1);

    // req1 resolves immediately (full match exists)
    const req1 = rootNode.requestFocus("//main/SelectedItem");
    await req1.promise;
    expect(req1.status).toBe(RequestStatus.Succeeded);

    // req2 should work fine — req1 is already resolved, shouldn't interfere
    const el2 = document.createElement("button");
    document.body.appendChild(el2);
    main.appendLeaf(new FoQueryLeafNode(["DefaultItem"], rootNode.root), el2);

    const req2 = rootNode.requestFocus("//main/DefaultItem");
    await req2.promise;
    expect(req2.status).toBe(RequestStatus.Succeeded);

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("resolved request unsubscribes and doesn't react to further tree changes", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    await request.promise;

    const diagAfterResolve = request.diagnostics!;
    const matchCountAfterResolve = diagAfterResolve.matchedElements.length;

    // Further tree mutations should not update diagnostics
    const el2 = document.createElement("button");
    document.body.appendChild(el2);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el2);

    expect(request.diagnostics!.matchedElements.length).toBe(matchCountAfterResolve);

    document.body.removeChild(el);
    document.body.removeChild(el2);
  });

  it("progressive: diagnostics timestamps are monotonically increasing", async () => {
    const rootNode = new FoQueryRootNode();

    const request = new FoQueryRequest("//main[@x]/SelectedItem", rootNode.root, {
      timeout: 2000,
    });

    // Build tree step by step
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);
    await new Promise((r) => setTimeout(r, 20));

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);
    await new Promise((r) => setTimeout(r, 20));

    // Remove leaf to trigger degradation
    main.node.leafs.forEach((leaf) => {
      leaf.xmlElements.forEach((xmlEl) => xmlEl.remove());
    });
    main.node.leafs.clear();
    rootNode.root.notify(main.node, true);
    await new Promise((r) => setTimeout(r, 20));

    request.cancel();
    await request.promise;

    const timestamps = request.diagnostics!.progressiveMatches.map((m) => m.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }

    document.body.removeChild(el);
  });

  it("progressive: full match at step N stops progressive tracking", async () => {
    const rootNode = new FoQueryRootNode();
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    // Request with timeout — waits for tree to build
    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root, { timeout: 5000 });

    // Step 1: add leaf — full match, resolves
    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const status = await request.promise;
    expect(status).toBe(RequestStatus.Succeeded);

    // Further tree changes after resolve shouldn't add progressive entries
    const progressiveCountAtResolve = request.diagnostics!.progressiveMatches.length;

    const el2 = document.createElement("button");
    document.body.appendChild(el2);
    main.appendLeaf(new FoQueryLeafNode(["DefaultItem"], rootNode.root), el2);

    expect(request.diagnostics!.progressiveMatches.length).toBe(progressiveCountAtResolve);

    document.body.removeChild(el);
    document.body.removeChild(el2);
  });

  it("progressive: partial match depth improves as tree grows", async () => {
    const rootNode = new FoQueryRootNode();

    // //main[@x]/sidebar[@y]/SelectedItem simplifies to:
    // //main[@x]/sidebar/SelectedItem, //main/sidebar/SelectedItem
    const request = new FoQueryRequest("//main[@x]/sidebar[@y]/SelectedItem", rootNode.root, {
      timeout: 2000,
    });

    // Step 1: add main — matches simplified //main/sidebar/SelectedItem? No, sidebar doesn't exist.
    // Actually //main matches when we strip all predicates from the first expression
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);
    await new Promise((r) => setTimeout(r, 20));

    const countAfterMain = request.diagnostics!.progressiveMatches.length;

    // Step 2: add sidebar — deeper match
    const sidebar = new FoQueryParentNode("sidebar", rootNode.root);
    main.appendParent(sidebar);
    await new Promise((r) => setTimeout(r, 20));

    // Step 3: add leaf — even deeper match
    const el = document.createElement("button");
    document.body.appendChild(el);
    sidebar.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);
    await new Promise((r) => setTimeout(r, 20));

    // We should have progressive entries, each getting closer
    expect(request.diagnostics!.progressiveMatches.length).toBeGreaterThan(countAfterMain);

    // None should be degraded
    const degraded = request.diagnostics!.progressiveMatches.filter((m) => m.degraded);
    expect(degraded.length).toBe(0);

    request.cancel();
    await request.promise;
    document.body.removeChild(el);
  });

  it("timeout cancels and cleans up pending request", async () => {
    const rootNode = new FoQueryRootNode();

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 100 });
    const status = await request.promise;

    expect(status).toBe(RequestStatus.TimedOut);

    // After timeout, a new requestFocus should work without interference
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const req2 = rootNode.requestFocus("//main/SelectedItem");
    const status2 = await req2.promise;
    expect(status2).toBe(RequestStatus.Succeeded);

    document.body.removeChild(el);
  });

  it("multiple concurrent FoQueryRequest constructors — only last one active", async () => {
    const rootNode = new FoQueryRootNode();

    // Three requests created in sequence, all pending
    const req1 = new FoQueryRequest("//a", rootNode.root, { timeout: 5000 });
    const req2 = new FoQueryRequest("//b", rootNode.root, { timeout: 5000 });
    const req3 = new FoQueryRequest("//c", rootNode.root, { timeout: 5000 });

    // req1 and req2 should be canceled by req3
    req3.cancel();

    const [s1, s2, s3] = await Promise.all([req1.promise, req2.promise, req3.promise]);

    expect(s1).toBe(RequestStatus.Canceled);
    expect(s2).toBe(RequestStatus.Canceled);
    expect(s3).toBe(RequestStatus.Canceled);
  });
});
