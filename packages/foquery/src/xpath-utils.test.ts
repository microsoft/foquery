/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import {
  splitXPathExpressions,
  removeLastPredicate,
  removeLastPathStep,
  generateXPathSimplifications,
} from "./xpath-utils";

describe("splitXPathExpressions", () => {
  it("splits on | at top level", () => {
    expect(splitXPathExpressions("//a | //b | //c")).toEqual(["//a", "//b", "//c"]);
  });

  it("does not split inside predicates", () => {
    expect(splitXPathExpressions("//a[@x='a|b'] | //b")).toEqual(["//a[@x='a|b']", "//b"]);
  });

  it("does not split inside quotes", () => {
    expect(splitXPathExpressions('//a[contains(@x, "|")] | //b')).toEqual([
      '//a[contains(@x, "|")]',
      "//b",
    ]);
  });

  it("handles single expression", () => {
    expect(splitXPathExpressions("//a/b/c")).toEqual(["//a/b/c"]);
  });

  it("handles nested predicates", () => {
    expect(splitXPathExpressions("//a[b[@c]] | //d")).toEqual(["//a[b[@c]]", "//d"]);
  });

  it("trims whitespace", () => {
    expect(splitXPathExpressions("  //a  |  //b  ")).toEqual(["//a", "//b"]);
  });

  it("does not split inside parenthesized unions", () => {
    expect(splitXPathExpressions("(//a | //b)/c | //d")).toEqual(["(//a | //b)/c", "//d"]);
  });

  it("treats backslashes in string literals as plain characters", () => {
    expect(splitXPathExpressions('//a[@x="\\"] | //b')).toEqual(['//a[@x="\\"]', "//b"]);
  });

  it("does not let brackets inside string literals affect depth", () => {
    expect(splitXPathExpressions("//a[@x='['] | //b")).toEqual(["//a[@x='[']", "//b"]);
  });

  it("drops empty union branches", () => {
    expect(splitXPathExpressions("//a | ")).toEqual(["//a"]);
  });
});

describe("removeLastPredicate", () => {
  it("removes trailing predicate", () => {
    expect(removeLastPredicate("//a[@x]")).toBe("//a");
  });

  it("removes only last predicate", () => {
    expect(removeLastPredicate("//a[@x]/b[@y]")).toBe("//a[@x]/b");
  });

  it("handles nested predicates", () => {
    expect(removeLastPredicate("//a[b[@c]]")).toBe("//a");
  });

  it("returns unchanged if no predicate", () => {
    expect(removeLastPredicate("//a/b/c")).toBe("//a/b/c");
  });

  it("handles predicate in the middle", () => {
    expect(removeLastPredicate("//a[@x]/b")).toBe("//a/b");
  });

  it("ignores brackets inside string literals", () => {
    expect(removeLastPredicate('//a[@x="["]/b')).toBe("//a/b");
    expect(removeLastPredicate("//a[@x=']']")).toBe("//a");
  });

  it("removes predicates inside parentheses", () => {
    expect(removeLastPredicate("(//a[@x])")).toBe("(//a)");
  });

  it("returns unbalanced predicates unchanged", () => {
    expect(removeLastPredicate("//a[")).toBe("//a[");
    expect(removeLastPredicate("//a[@x")).toBe("//a[@x");
  });
});

describe("removeLastPathStep", () => {
  it("removes last path step", () => {
    expect(removeLastPathStep("//a/b/c")).toBe("//a/b");
  });

  it("removes down to double-slash prefix", () => {
    expect(removeLastPathStep("//a/b")).toBe("//a");
  });

  it("does not reduce below axis prefix", () => {
    expect(removeLastPathStep("//a")).toBe("//a");
  });

  it("does not reduce single-slash root", () => {
    expect(removeLastPathStep("/a")).toBe("/a");
  });

  it("handles relative path", () => {
    expect(removeLastPathStep("./a/b")).toBe("./a");
  });

  it("does not reduce relative single step", () => {
    expect(removeLastPathStep("./a")).toBe("./a");
  });

  it("does not strip steps inside predicates", () => {
    expect(removeLastPathStep("//a[@x='y/z']/b")).toBe("//a[@x='y/z']");
  });

  it("treats descendant separators as path steps", () => {
    expect(removeLastPathStep("//content//SelectedItem")).toBe("//content");
    expect(removeLastPathStep("./a//b")).toBe("./a");
  });

  it("does not reduce relative descendant single step", () => {
    expect(removeLastPathStep(".//a")).toBe(".//a");
  });

  it("does not strip steps inside parentheses or string literals", () => {
    expect(removeLastPathStep("(//a/b)")).toBe("(//a/b)");
    expect(removeLastPathStep("(//a | //b)/c")).toBe("(//a | //b)");
    expect(removeLastPathStep('//a[@x="]/["]')).toBe('//a[@x="]/["]');
  });
});

describe("generateXPathSimplifications", () => {
  it("generates predicate-only simplification", () => {
    expect(generateXPathSimplifications("//a[@x]/b[@y]")).toEqual([
      ["//a[@x]/b[@y]", "//a[@x]/b", "//a/b", "//a"],
    ]);
  });

  it("generates path step simplification for predicate-free xpath", () => {
    expect(generateXPathSimplifications("//content/messages/compose/SelectedItem")).toEqual([
      [
        "//content/messages/compose/SelectedItem",
        "//content/messages/compose",
        "//content/messages",
        "//content",
      ],
    ]);
  });

  it("strips predicates first then path steps", () => {
    expect(generateXPathSimplifications("/a[@x]/b[@y]/c[@z]")).toEqual([
      ["/a[@x]/b[@y]/c[@z]", "/a[@x]/b[@y]/c", "/a[@x]/b/c", "/a/b/c", "/a/b", "/a"],
    ]);
  });

  it("generates chains for union expression", () => {
    const result = generateXPathSimplifications(
      "/aa[@aaa]/bb[@bbb]/cc/dd[@ddd] | //ee[@eee] | /dd/ff/gg",
    );

    expect(result).toEqual([
      [
        "/aa[@aaa]/bb[@bbb]/cc/dd[@ddd]",
        "/aa[@aaa]/bb[@bbb]/cc/dd",
        "/aa[@aaa]/bb/cc/dd",
        "/aa/bb/cc/dd",
        "/aa/bb/cc",
        "/aa/bb",
        "/aa",
      ],
      ["//ee[@eee]", "//ee"],
      ["/dd/ff/gg", "/dd/ff", "/dd"],
    ]);
  });

  it("handles relative path", () => {
    expect(generateXPathSimplifications("./messages/compose/SelectedItem")).toEqual([
      ["./messages/compose/SelectedItem", "./messages/compose", "./messages"],
    ]);
  });

  it("single step without predicates returns just itself", () => {
    expect(generateXPathSimplifications("//a")).toEqual([["//a"]]);
  });

  it("handles empty string", () => {
    expect(generateXPathSimplifications("")).toEqual([]);
  });

  it("terminates on malformed xpath with an unbalanced predicate", () => {
    expect(generateXPathSimplifications("//a/b[")).toEqual([["//a/b[", "//a"]]);
  });

  it("simplifies descendant separators", () => {
    expect(generateXPathSimplifications("//content//SelectedItem[@x]")).toEqual([
      ["//content//SelectedItem[@x]", "//content//SelectedItem", "//content"],
    ]);
  });
});
