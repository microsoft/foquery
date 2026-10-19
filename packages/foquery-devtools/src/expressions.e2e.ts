/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { test, expect } from "@playwright/test";
import {
  activeRequestExpression,
  findLeafByIdSnippet,
  findParentByIdSnippet,
  focusExpression,
  nodeIdSnippet,
  queryXPathExpression,
  serializeTreeExpression,
} from "./expressions";

const MALICIOUS_GLOBAL_NAME = 'x"]; globalThis.__foqueryInjected = true; //';

test.describe("devtools expressions", () => {
  test("treat the user-provided global name as data, not code", () => {
    const expressions = [
      serializeTreeExpression(MALICIOUS_GLOBAL_NAME),
      queryXPathExpression(MALICIOUS_GLOBAL_NAME, "//a", null),
      queryXPathExpression(MALICIOUS_GLOBAL_NAME, "//a", 0),
      focusExpression(MALICIOUS_GLOBAL_NAME, "//a", null),
      focusExpression(MALICIOUS_GLOBAL_NAME, "//a", 0),
      activeRequestExpression(MALICIOUS_GLOBAL_NAME),
      `(function() { ${nodeIdSnippet()}${findParentByIdSnippet(MALICIOUS_GLOBAL_NAME, 1)} })()`,
      `(function() { ${nodeIdSnippet()}${findLeafByIdSnippet(MALICIOUS_GLOBAL_NAME, 1)} })()`,
    ];
    const globals = globalThis as Record<string, unknown>;

    try {
      for (const expression of expressions) {
        try {
          new Function("window", `return ${expression}`)({});
        } catch {
          // Missing FoQuery instance is fine; only injected code execution matters.
        }
      }

      expect(globals.__foqueryInjected).toBeUndefined();
    } finally {
      delete globals.__foqueryInjected;
    }
  });

  test("keeps tree node ids stable when earlier siblings are added", () => {
    const leaf = (names: string[]) => ({ names, lastFocused: undefined, xmlElements: new Map() });
    const parent = (name: string, children: unknown[] = [], leafs: unknown[] = []) => ({
      name,
      children,
      leafs,
      xmlElement: { children: [] },
    });
    const target = parent("Target", [], [leaf(["Item"])]);
    const root = parent("Root", [target]);
    const win: Record<string, unknown> = { foquery: { root } };
    const serialize = () =>
      new Function("window", `return ${serializeTreeExpression("foquery")}`)(win) as {
        children: { name: string; parentId: number; children: { leafId: number }[] }[];
      };
    const findTarget = (tree: ReturnType<typeof serialize>) =>
      tree.children.find((child) => child.name === "Target")!;

    const before = findTarget(serialize());
    root.children.unshift(parent("Inserted", [], [leaf(["Other"])]));
    const after = findTarget(serialize());

    expect(after.parentId).toBe(before.parentId);
    expect(after.children[0].leafId).toBe(before.children[0].leafId);

    const query = new Function(
      "window",
      `return (function() { ${nodeIdSnippet()}${findParentByIdSnippet("foquery", after.parentId)} return contextNode; })()`,
    )(win);
    expect(query).toBe(target);
  });
});
