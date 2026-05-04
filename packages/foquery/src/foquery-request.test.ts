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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    const customFocus = vi.fn().mockReturnValue(true);
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
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const customFocus = vi.fn().mockReturnValue(false);
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
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const request = new FoQueryRequest("//main", rootNode.root);
    const status = await request.promise;

    expect(status).toBe(RequestStatus.NoCandidates);
    expect(request.diagnostics!.matchedElements.length).toBe(1);
    expect(request.diagnostics!.candidates.length).toBe(0);
    expect(request.diagnostics!.winner).toBeUndefined();
  });

  it("evaluates string focus as relative xpath on parent", async () => {
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
    const request = new FoQueryRequest("//nonexistent", rootNode.root);
    request.cancel();
    const status = await request.promise;
    expect(status).toBe(RequestStatus.Canceled);
  });

  it("recursively evaluates nested parent string focus", async () => {
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window, "Root", { arbiter: rootArbiter });

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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 100 });
    await request.promise;

    expect(request.diagnostics!.resolvedAt).toBeDefined();
    expect(request.diagnostics!.resolvedAt!).toBeGreaterThanOrEqual(request.diagnostics!.startedAt);
  });

  it("diagnostics resolvedAt is set on cancel", async () => {
    const rootNode = new FoQueryRootNode(window);

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });
    request.cancel();
    await request.promise;

    expect(request.diagnostics!.resolvedAt).toBeDefined();
    expect(request.diagnostics!.xpath).toBe("//nonexistent");
  });

  it("diagnostics resolvedAt is undefined while request is pending", () => {
    const rootNode = new FoQueryRootNode(window);

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });

    expect(request.diagnostics).toBeDefined();
    expect(request.diagnostics!.startedAt).toBeGreaterThan(0);
    expect(request.diagnostics!.resolvedAt).toBeUndefined();

    request.cancel();
  });

  it("diagnostics xpath matches for parent-bound request", async () => {
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window, "Root", { arbiter: rootArbiter });
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
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);

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

  it("parent axis (..) waits when parent has string focus with no current sub-candidates", async () => {
    const rootNode = new FoQueryRootNode(window);

    const messages = new FoQueryParentNode("messages", rootNode.root, {
      focus: "./thread/SelectedItem",
    });
    rootNode.appendParent(messages);

    // messages matched but ./thread/SelectedItem doesn't exist yet
    // Should NOT resolve NoCandidates — should wait
    const request = new FoQueryRequest("//messages", rootNode.root);

    // Give it a tick to ensure it doesn't resolve immediately
    await new Promise((r) => setTimeout(r, 50));
    expect(request.status).toBe(RequestStatus.Waiting);

    // Now add thread with SelectedItem — request should resolve
    const thread = new FoQueryParentNode("thread", rootNode.root);
    messages.appendParent(thread);

    const el = document.createElement("button");
    document.body.appendChild(el);
    thread.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const status = await request.promise;
    expect(status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  // --- Parent-bound with string focus ---

  it("parent-bound request resolves via parent string focus", async () => {
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);

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
    expect(request.diagnostics!.events.length).toBeGreaterThan(0);
    expect(request.diagnostics!.events[0].type).toBe("partial-match");

    request.cancel();
    await request.promise;
    document.body.removeChild(el);
  });

  it("progressive: resolves when tree grows to match full xpath", async () => {
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const request = new FoQueryRequest("//main/NonExistent", rootNode.root, { timeout: 200 });
    const status = await request.promise;

    expect(status).toBe(RequestStatus.TimedOut);
    expect(request.diagnostics).toBeDefined();
  });

  it("progressive: records degradation when partial match disappears", async () => {
    const rootNode = new FoQueryRootNode(window);

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
    expect(request.diagnostics!.events.length).toBeGreaterThan(0);

    // Remove main — degradation
    main.remove();

    await new Promise((r) => setTimeout(r, 50));

    const lostOrDegraded = request.diagnostics!.events.filter(
      (m) => m.type === "degraded" || m.type === "lost-match",
    );
    expect(lostOrDegraded.length).toBeGreaterThan(0);

    request.cancel();
    await request.promise;
    document.body.removeChild(el);
  });

  it("progressive: coalesces transient partial regressions before recording degradation", async () => {
    const rootNode = new FoQueryRootNode(window);
    const request = new FoQueryRequest("//main[@x]/sidebar[@y]/SelectedItem", rootNode.root, {
      timeout: 500,
    });
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);
    const sidebar = new FoQueryParentNode("sidebar", rootNode.root);
    main.appendParent(sidebar);

    await new Promise((r) => setTimeout(r, 50));

    sidebar.remove();
    await new Promise((r) => setTimeout(r, 0));
    main.appendParent(new FoQueryParentNode("sidebar", rootNode.root));
    await new Promise((r) => setTimeout(r, 50));

    expect(request.diagnostics!.events.some((event) => event.type === "degraded")).toBe(false);
    expect(request.diagnostics!.events.some((event) => event.type === "lost-match")).toBe(false);

    request.cancel();
    await request.promise;
  });

  // --- Single active request ---

  it("consecutive requestFocus cancels the pending previous request", async () => {
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);
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
    const rootNode = new FoQueryRootNode(window);

    const request = new FoQueryRequest("//main[@x]/SelectedItem", rootNode.root, {
      timeout: 2000,
    });

    // Build tree step by step
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);
    await new Promise((r) => setTimeout(r, 50));

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);
    await new Promise((r) => setTimeout(r, 50));

    // Remove leaf to trigger degradation
    main.node.leafs.forEach((leaf) => {
      leaf.xmlElements.forEach((xmlEl) => xmlEl.remove());
    });
    main.node.leafs.clear();
    rootNode.root.notify(main.node, true);
    await new Promise((r) => setTimeout(r, 50));

    request.cancel();
    await request.promise;

    const timestamps = request.diagnostics!.events.map((m) => m.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }

    document.body.removeChild(el);
  });

  it("progressive: full match at step N stops progressive tracking", async () => {
    const rootNode = new FoQueryRootNode(window);
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
    const progressiveCountAtResolve = request.diagnostics!.events.length;

    const el2 = document.createElement("button");
    document.body.appendChild(el2);
    main.appendLeaf(new FoQueryLeafNode(["DefaultItem"], rootNode.root), el2);

    expect(request.diagnostics!.events.length).toBe(progressiveCountAtResolve);

    document.body.removeChild(el);
    document.body.removeChild(el2);
  });

  it("progressive: partial match depth improves as tree grows", async () => {
    const rootNode = new FoQueryRootNode(window);

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

    const countAfterMain = request.diagnostics!.events.length;

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
    expect(request.diagnostics!.events.length).toBeGreaterThan(countAfterMain);

    // None should be degraded
    const degraded = request.diagnostics!.events.filter((m) => m.type === "degraded");
    expect(degraded.length).toBe(0);

    request.cancel();
    await request.promise;
    document.body.removeChild(el);
  });

  it("timeout cancels and cleans up pending request", async () => {
    const rootNode = new FoQueryRootNode(window);

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
    const rootNode = new FoQueryRootNode(window);

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

  // --- Cancel on user interaction ---

  it("cancels pending request when user clicks on the page", async () => {
    const rootNode = new FoQueryRootNode(window);

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });

    // Simulate a user click
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    const status = await request.promise;
    expect(status).toBe(RequestStatus.Canceled);
  });

  it("cancels pending request when focus moves to another element", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });

    // Simulate focus moving to some other element
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();

    const status = await request.promise;
    expect(status).toBe(RequestStatus.Canceled);
    document.body.removeChild(btn);
  });

  it("does not cancel when focus is caused by the request itself", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    const status = await request.promise;

    // Should succeed, not be canceled by its own focus
    expect(status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("removes interaction listeners after request resolves", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["SelectedItem"], rootNode.root), el);

    const req1 = new FoQueryRequest("//main/SelectedItem", rootNode.root);
    await req1.promise;

    // After resolving, clicking should not affect anything
    const req2 = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });

    // This click should cancel req2, not interfere with the already-resolved req1
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    const status2 = await req2.promise;
    expect(status2).toBe(RequestStatus.Canceled);
    expect(req1.status).toBe(RequestStatus.Succeeded); // unchanged

    document.body.removeChild(el);
  });

  // --- Cancel reasons ---

  it("cancel reason: 'user-click' when mousedown on page", async () => {
    const rootNode = new FoQueryRootNode(window);
    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });

    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await request.promise;

    expect(request.status).toBe(RequestStatus.Canceled);
    expect(request.diagnostics!.cancelReason).toBe("user-click");
    const cancelEvent = request.diagnostics!.events.find((e) => e.type === "canceled");
    expect(cancelEvent).toBeDefined();
    if (cancelEvent?.type === "canceled") {
      expect(cancelEvent.reason).toBe("user-click");
    }
  });

  it("cancel reason: 'focus-moved' when focus moves to another element", async () => {
    const rootNode = new FoQueryRootNode(window);
    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });

    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();

    await request.promise;

    expect(request.status).toBe(RequestStatus.Canceled);
    expect(request.diagnostics!.cancelReason).toBe("focus-moved");
    const cancelEvent = request.diagnostics!.events.find((e) => e.type === "canceled");
    if (cancelEvent?.type === "canceled") {
      expect(cancelEvent.reason).toBe("focus-moved");
    }
    document.body.removeChild(btn);
  });

  it("cancel reason: 'superseded' when a new request replaces the current one", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    const req1 = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 5000 });
    const req2 = new FoQueryRequest("//main/Item", rootNode.root);

    await Promise.all([req1.promise, req2.promise]);

    expect(req1.status).toBe(RequestStatus.Canceled);
    expect(req1.diagnostics!.cancelReason).toBe("superseded");
    const cancelEvent = req1.diagnostics!.events.find((e) => e.type === "canceled");
    if (cancelEvent?.type === "canceled") {
      expect(cancelEvent.reason).toBe("superseded");
    }

    expect(req2.status).toBe(RequestStatus.Succeeded);
    expect(req2.diagnostics!.cancelReason).toBeUndefined();
    document.body.removeChild(el);
  });

  it("cancel reason: 'api' when cancel() is called without a reason", async () => {
    const rootNode = new FoQueryRootNode(window);
    const request = new FoQueryRequest("//nonexistent", rootNode.root);

    request.cancel();
    await request.promise;

    expect(request.status).toBe(RequestStatus.Canceled);
    expect(request.diagnostics!.cancelReason).toBe("api");
    const cancelEvent = request.diagnostics!.events.find((e) => e.type === "canceled");
    if (cancelEvent?.type === "canceled") {
      expect(cancelEvent.reason).toBe("api");
    }
  });

  it("cancel reason: custom reason when cancel() is called with one", async () => {
    const rootNode = new FoQueryRootNode(window);
    const request = new FoQueryRequest("//nonexistent", rootNode.root);

    request.cancel("api");
    await request.promise;

    expect(request.diagnostics!.cancelReason).toBe("api");
  });

  it("no cancelReason on succeeded requests", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    const request = new FoQueryRequest("//main/Item", rootNode.root);
    await request.promise;

    expect(request.status).toBe(RequestStatus.Succeeded);
    expect(request.diagnostics!.cancelReason).toBeUndefined();
    document.body.removeChild(el);
  });

  it("no cancelReason on timed out requests", async () => {
    const rootNode = new FoQueryRootNode(window);
    const request = new FoQueryRequest("//nonexistent", rootNode.root, { timeout: 50 });

    await request.promise;

    expect(request.status).toBe(RequestStatus.TimedOut);
    expect(request.diagnostics!.cancelReason).toBeUndefined();
  });

  // --- Check callbacks ---

  it("check callback on leaf: delays focus until check returns true", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["Item"], rootNode.root);
    main.appendLeaf(leaf, el);

    let ready = false;
    leaf.registerCheck(() => ready);

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    // Should be polling, not yet resolved
    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    // Make check pass
    ready = true;

    // Wait for poll cycle to pick it up
    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("check callback on parent: applies to all leaves under that parent", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    let ready = false;
    main.registerCheck(() => ready);

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    ready = true;

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("check callback on root: applies to all leaves", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    let ready = false;
    rootNode.registerCheck(() => ready);

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    ready = true;

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("all check callbacks must pass: leaf + parent + root", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    let leafReady = false;
    let parentReady = false;
    const rootReady = true;
    rootNode.registerCheck(() => rootReady);
    main.registerCheck(() => parentReady);
    // Register on the leaf via its data node directly
    main.node.leafs.forEach((l) => l.checkCallbacks.add(() => leafReady));

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    // Only leaf ready — not enough
    leafReady = true;
    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    // Leaf + parent ready — still not enough (root blocks... wait, root is true)
    parentReady = true;
    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);

    document.body.removeChild(el);
  });

  it("unregisterCheck removes the callback", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    const unregister = main.registerCheck(() => false);
    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    // Unregister — should now pass
    unregister();

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  it("polling stops when request is canceled", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    const checkSpy = vi.fn().mockReturnValue(false);
    main.registerCheck(checkSpy);

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);
    const callsBefore = checkSpy.mock.calls.length;

    request.cancel();
    await request.promise;

    // Wait to verify polling stopped
    await new Promise((r) => setTimeout(r, 100));
    expect(checkSpy.mock.calls.length).toBe(callsBefore);

    document.body.removeChild(el);
  });

  it("polling with multiple candidates: first to pass check wins", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);
    const leaf1 = new FoQueryLeafNode(["Item"], rootNode.root);
    const leaf2 = new FoQueryLeafNode(["Item"], rootNode.root);
    main.appendLeaf(leaf1, el1);
    main.appendLeaf(leaf2, el2);

    // el1 is not ready, el2 becomes ready
    leaf1.registerCheck(() => false);
    let el2Ready = false;
    leaf2.registerCheck(() => el2Ready);

    const focusSpy1 = vi.spyOn(el1, "focus");
    const focusSpy2 = vi.spyOn(el2, "focus");

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    el2Ready = true;

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);
    expect(focusSpy1).not.toHaveBeenCalled();
    expect(focusSpy2).toHaveBeenCalled();

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("tree mutation during polling cancels poll and re-evaluates", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    document.body.appendChild(el1);
    const leaf1 = new FoQueryLeafNode(["Item"], rootNode.root);
    main.appendLeaf(leaf1, el1);

    // el1 never becomes ready
    leaf1.registerCheck(() => false);

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    // Add a new leaf (tree mutation) — this triggers _matchPath via subscription
    const el2 = document.createElement("button");
    document.body.appendChild(el2);
    const leaf2 = new FoQueryLeafNode(["Item"], rootNode.root);
    main.appendLeaf(leaf2, el2);

    // el2 has no check callbacks, so it should be focusable immediately
    // _matchPath re-evaluates, finds both candidates, el2 passes checks, focuses el2
    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);

    expect(request.diagnostics!.candidates.length).toBe(2);

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("check callback receives the actual HTML element", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    // Check simulating aria-hidden ancestor detection
    main.registerCheck((element) => {
      return !element.closest("[aria-hidden=true]");
    });

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Waiting);

    // Remove aria-hidden
    el.removeAttribute("aria-hidden");

    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);
    document.body.removeChild(el);
  });

  // --- Check callback diagnostics ---

  it("diagnostics: records pending event when check fails, ready event when it passes", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
    main.appendLeaf(leaf, el);

    let ready = false;
    leaf.registerCheck(() => ready);

    const request = new FoQueryRequest("//main/SelectedItem", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.diagnostics!.events.length).toBe(1);
    const evt0 = request.diagnostics!.events[0];
    expect(evt0.type).toBe("matched-pending-checks");
    if (evt0.type === "matched-pending-checks") {
      expect(evt0.leafNames).toEqual(["SelectedItem"]);
    }

    ready = true;
    await new Promise((r) => setTimeout(r, 80));

    expect(request.status).toBe(RequestStatus.Succeeded);
    expect(request.diagnostics!.events.length).toBe(3);
    expect(request.diagnostics!.events[1].type).toBe("checks-passed");
    expect(request.diagnostics!.events[2].type).toBe("succeeded");

    document.body.removeChild(el);
  });

  it("diagnostics: only succeeded event when there are no check callbacks", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    const request = new FoQueryRequest("//main/Item", rootNode.root);
    await request.promise;

    expect(request.diagnostics!.events.length).toBe(1);
    expect(request.diagnostics!.events[0].type).toBe("succeeded");

    document.body.removeChild(el);
  });

  it("diagnostics: pending for multiple candidates, ready for the one that passes first", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    const el2 = document.createElement("button");
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    const leaf1 = new FoQueryLeafNode(["ItemA"], rootNode.root);
    const leaf2 = new FoQueryLeafNode(["ItemB"], rootNode.root);
    main.appendLeaf(leaf1, el1);
    main.appendLeaf(leaf2, el2);

    leaf1.registerCheck(() => false);
    let leaf2Ready = false;
    leaf2.registerCheck(() => leaf2Ready);

    const request = new FoQueryRequest("//main/*", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    // Both should have pending events
    const pending = request.diagnostics!.events.filter(
      (e): e is Extract<typeof e, { type: "matched-pending-checks" }> =>
        e.type === "matched-pending-checks",
    );
    expect(pending.length).toBe(2);
    expect(pending.map((e) => e.leafNames[0]).sort()).toEqual(["ItemA", "ItemB"]);

    leaf2Ready = true;
    await new Promise((r) => setTimeout(r, 80));

    expect(request.status).toBe(RequestStatus.Succeeded);
    const readyEvents = request.diagnostics!.events.filter(
      (e): e is Extract<typeof e, { type: "checks-passed" }> => e.type === "checks-passed",
    );
    expect(readyEvents.length).toBe(1);
    expect(readyEvents[0].leafNames).toEqual(["ItemB"]);

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("diagnostics: tree mutation during polling records new pending and ready events", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el1 = document.createElement("button");
    document.body.appendChild(el1);
    const leaf1 = new FoQueryLeafNode(["BlockedItem"], rootNode.root);
    main.appendLeaf(leaf1, el1);

    leaf1.registerCheck(() => false);

    const request = new FoQueryRequest("//main/*", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.diagnostics!.events.length).toBe(1);
    expect(request.diagnostics!.events[0].type).toBe("matched-pending-checks");

    // Add a new leaf without check callbacks — tree mutation triggers _matchPath
    const el2 = document.createElement("button");
    document.body.appendChild(el2);
    main.appendLeaf(new FoQueryLeafNode(["FreeItem"], rootNode.root), el2);

    // _matchPath re-evaluates: el2 has no checks, passes immediately
    await new Promise((r) => setTimeout(r, 80));
    expect(request.status).toBe(RequestStatus.Succeeded);

    // The original pending event is preserved, plus a new one from re-evaluation
    // after the tree mutation (BlockedItem still fails checks on re-evaluate)
    const pending = request.diagnostics!.events.filter(
      (e): e is Extract<typeof e, { type: "matched-pending-checks" }> =>
        e.type === "matched-pending-checks",
    );
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].leafNames).toEqual(["BlockedItem"]);

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it("diagnostics: canceled request preserves check events recorded before cancellation", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    main.appendLeaf(new FoQueryLeafNode(["Item"], rootNode.root), el);

    main.registerCheck(() => false);

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    expect(request.diagnostics!.events.length).toBe(1);
    expect(request.diagnostics!.events[0].type).toBe("matched-pending-checks");

    request.cancel();
    await request.promise;

    expect(request.status).toBe(RequestStatus.Canceled);
    // Pending event is preserved, plus the canceled resolution event
    expect(request.diagnostics!.events.length).toBe(2);
    expect(request.diagnostics!.events[0].type).toBe("matched-pending-checks");
    expect(request.diagnostics!.events[1].type).toBe("canceled");

    document.body.removeChild(el);
  });

  it("diagnostics: check event timestamps are monotonically increasing", async () => {
    const rootNode = new FoQueryRootNode(window);
    const main = new FoQueryParentNode("main", rootNode.root);
    rootNode.appendParent(main);

    const el = document.createElement("button");
    document.body.appendChild(el);
    const leaf = new FoQueryLeafNode(["Item"], rootNode.root);
    main.appendLeaf(leaf, el);

    let ready = false;
    leaf.registerCheck(() => ready);

    const request = new FoQueryRequest("//main/Item", rootNode.root);

    await new Promise((r) => setTimeout(r, 80));
    ready = true;
    await new Promise((r) => setTimeout(r, 80));

    const events = request.diagnostics!.events;
    expect(events.length).toBe(3);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }

    document.body.removeChild(el);
  });
});
