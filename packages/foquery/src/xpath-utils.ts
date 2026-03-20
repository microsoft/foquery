/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
export function splitXPathExpressions(xpath: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < xpath.length; i++) {
    const char = xpath[i];

    if ((char === '"' || char === "'") && xpath[i - 1] !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
        quoteChar = "";
      }
    }

    if (!inQuote) {
      if (char === "[") depth++;
      if (char === "]") depth--;
      if (char === "|" && depth === 0) {
        result.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

export function removeLastPredicate(xpath: string): string {
  let depth = 0;

  for (let i = xpath.length - 1; i >= 0; i--) {
    if (xpath[i] === "]") depth++;
    else if (xpath[i] === "[") {
      depth--;
      if (depth === 0) {
        let closeDepth = 1;
        for (let j = i + 1; j < xpath.length; j++) {
          if (xpath[j] === "[") closeDepth++;
          else if (xpath[j] === "]") closeDepth--;
          if (closeDepth === 0) {
            return xpath.slice(0, i) + xpath.slice(j + 1);
          }
        }
      }
    }
  }

  return xpath;
}

export function removeLastPathStep(xpath: string): string {
  // Find the last '/' that is not inside predicates or at the start of '//'
  let depth = 0;
  let lastSlash = -1;

  for (let i = 0; i < xpath.length; i++) {
    if (xpath[i] === "[") depth++;
    else if (xpath[i] === "]") depth--;
    else if (xpath[i] === "/" && depth === 0) {
      // Skip the second '/' in '//'
      if (i + 1 < xpath.length && xpath[i + 1] === "/") {
        i++; // skip next '/'
        continue;
      }
      lastSlash = i;
    }
  }

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
    while (current.includes("[")) {
      current = removeLastPredicate(current);
      steps.push(current);
    }

    // Phase 2: strip path steps from right to left
    let prev = current;
    while (true) {
      current = removeLastPathStep(current);
      if (current === prev) break;
      steps.push(current);
      prev = current;
    }

    allSimplifications.push(steps);
  }

  return allSimplifications;
}
