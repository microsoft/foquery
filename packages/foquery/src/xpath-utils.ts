/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Walks an XPath string and reports, for every character outside of string
 * literals, the combined bracket/parenthesis nesting depth and the bracket-only
 * nesting depth before that character.
 * XPath 1.0 string literals have no escape sequences, so a literal ends at the
 * next occurrence of its opening quote.
 */
function scanXPath(
  xpath: string,
  visit: (index: number, char: string, depth: number, bracketDepth: number) => void,
) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let quoteChar = "";

  for (let i = 0; i < xpath.length; i++) {
    const char = xpath[i];

    if (quoteChar) {
      if (char === quoteChar) quoteChar = "";
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }

    visit(i, char, parenDepth + bracketDepth, bracketDepth);

    if (char === "[") bracketDepth++;
    else if (char === "]" && bracketDepth > 0) bracketDepth--;
    else if (char === "(") parenDepth++;
    else if (char === ")" && parenDepth > 0) parenDepth--;
  }
}

export function splitXPathExpressions(xpath: string): string[] {
  const result: string[] = [];
  let start = 0;

  scanXPath(xpath, (i, char, depth) => {
    if (char === "|" && depth === 0) {
      result.push(xpath.slice(start, i).trim());
      start = i + 1;
    }
  });

  const last = xpath.slice(start).trim();
  if (last) result.push(last);
  return result;
}

export function removeLastPredicate(xpath: string): string {
  let lastStart = -1;
  let lastEnd = -1;
  let openStart = -1;

  scanXPath(xpath, (i, char, _depth, bracketDepth) => {
    if (char === "[" && bracketDepth === 0) {
      openStart = i;
    } else if (char === "]" && bracketDepth === 1 && openStart >= 0) {
      lastStart = openStart;
      lastEnd = i;
      openStart = -1;
    }
  });

  if (lastStart < 0) return xpath;
  return xpath.slice(0, lastStart) + xpath.slice(lastEnd + 1);
}

export function removeLastPathStep(xpath: string): string {
  // Find the last top-level step separator ('/' or '//'), ignoring the leading axis.
  let lastSlash = -1;

  scanXPath(xpath, (i, char, depth) => {
    if (char !== "/" || depth !== 0) return;
    // The second '/' of '//' belongs to the separator that starts at i - 1.
    if (xpath[i - 1] === "/") return;
    lastSlash = i;
  });

  if (lastSlash <= 0) return xpath;

  // Don't reduce below the axis (e.g., don't turn "//foo" into "//")
  const result = xpath.slice(0, lastSlash);
  if (result === "/" || result === "//" || result === ".") return xpath;

  return result;
}

export function generateXPathSimplifications(xpath: string): string[][] {
  const expressions = splitXPathExpressions(xpath);
  const allSimplifications: string[][] = [];

  for (const expr of expressions) {
    const steps: string[] = [expr];
    let current = expr;

    // Phase 1: strip predicates from innermost to outermost
    while (true) {
      const next = removeLastPredicate(current);
      if (next === current) break;
      current = next;
      steps.push(current);
    }

    // Phase 2: strip path steps from right to left
    while (true) {
      const next = removeLastPathStep(current);
      if (next === current) break;
      current = next;
      steps.push(current);
    }

    allSimplifications.push(steps);
  }

  return allSimplifications;
}
