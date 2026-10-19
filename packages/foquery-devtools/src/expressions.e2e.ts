/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { test, expect } from "@playwright/test";
import {
  activeRequestExpression,
  buildLeafIndexMapSnippet,
  findParentByIndexSnippet,
  focusExpression,
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
      `(function() { ${buildLeafIndexMapSnippet(MALICIOUS_GLOBAL_NAME)} })()`,
      `(function() { ${findParentByIndexSnippet(MALICIOUS_GLOBAL_NAME, 0)} })()`,
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
});
