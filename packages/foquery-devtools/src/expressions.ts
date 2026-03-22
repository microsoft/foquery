/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

export function serializeTreeExpression(globalName: string): string {
  return `(function() {
    var inst = window["${globalName}"];
    if (!inst) return null;
    var root = inst.root;
    var leafIdx = 0;
    var parentIdx = 0;

    function serializeParent(node) {
      var focusType = null;
      if (typeof node.focus === "function") focusType = "function";
      else if (typeof node.focus === "string") focusType = node.focus;

      var result = {
        type: "parent",
        name: node.name,
        parentIndex: parentIdx++,
        lastFocused: node.lastFocused,
        hasFocus: node.focus !== undefined,
        focusType: focusType,
        hasArbiter: !!node.arbiter
      };
      var children = [];

      node.children.forEach(function(child) {
        children.push(serializeParent(child));
      });

      node.leafs.forEach(function(leaf) {
        children.push({
          type: "leaf",
          name: leaf.names.join(", "),
          lastFocused: leaf.lastFocused,
          leafIndex: leafIdx++
        });
      });

      result.children = children;
      return result;
    }

    return serializeParent(root);
  })()`;
}

export function buildLeafIndexMapSnippet(globalName: string): string {
  return `
    var leafIndexMap = new Map();
    var idx = 0;
    function indexLeafs(node) {
      node.children.forEach(function(child) { indexLeafs(child); });
      node.leafs.forEach(function(leaf) {
        leaf.xmlElements.forEach(function(xmlEl) { leafIndexMap.set(xmlEl, idx); });
        idx++;
      });
    }
    indexLeafs(window["${globalName}"].root);
  `;
}

export function serializeElSnippet(): string {
  return `
    function serializeEl(el) {
      if (el.foQueryLeafNode) {
        return { type: "leaf", name: el.foQueryLeafNode.names.join(", "), lastFocused: el.foQueryLeafNode.lastFocused, leafIndex: leafIndexMap.get(el) };
      } else if (el.foQueryParentNode) {
        return { type: "parent", name: el.foQueryParentNode.name, lastFocused: el.foQueryParentNode.lastFocused };
      }
      return { type: "unknown", name: el.tagName };
    }
  `;
}

export function findParentByIndexSnippet(globalName: string, targetIndex: number): string {
  return `
    var contextNode = null;
    var __parentIdx = 0;
    function findParentByIndex(node) {
      if (__parentIdx++ === ${targetIndex}) { contextNode = node; return; }
      node.children.forEach(function(child) { if (!contextNode) findParentByIndex(child); });
    }
    findParentByIndex(window["${globalName}"].root);
  `;
}

export function queryXPathExpression(
  globalName: string,
  xpath: string,
  parentIndex: number | null,
): string {
  const contextSetup =
    parentIndex !== null
      ? findParentByIndexSnippet(globalName, parentIndex) +
        "if (!contextNode) return { error: false, results: [] };"
      : "var contextNode = null;";

  return `(function() {
    var inst = window["${globalName}"];
    if (!inst || !inst.root) return { error: false, results: [] };
    var root = inst.root;
    var xmlDoc = root.xmlDoc;

    function evalXPath(xpath, ctx) {
      var r = xmlDoc.evaluate(xpath, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      var els = [];
      for (var i = 0; i < r.snapshotLength; i++) { var n = r.snapshotItem(i); if (n instanceof Element) els.push(n); }
      return els;
    }

    try {
      ${buildLeafIndexMapSnippet(globalName)}
      ${contextSetup}

      var ctxEl = contextNode ? contextNode.xmlElement : xmlDoc;
      var results = evalXPath(${JSON.stringify(xpath)}, ctxEl);
      return {
        error: false,
        results: results.map(function(el) {
          if (el.foQueryLeafNode) {
            return { type: "leaf", name: el.foQueryLeafNode.names.join(", "), leafIndex: leafIndexMap.get(el) };
          } else if (el.foQueryParentNode) {
            return { type: "parent", name: el.foQueryParentNode.name };
          }
          return { type: "unknown", name: el.tagName };
        })
      };
    } catch (e) {
      return { error: true, results: [] };
    }
  })()`;
}

export function focusExpression(
  globalName: string,
  xpath: string,
  parentIndex: number | null,
): string {
  const contextSetup =
    parentIndex !== null
      ? findParentByIndexSnippet(globalName, parentIndex) + "if (!contextNode) return null;"
      : "var contextNode = null;";

  return `(function() {
    var inst = window["${globalName}"];
    if (!inst || !inst.requestFocus) return null;
    var root = inst.root;

    ${buildLeafIndexMapSnippet(globalName)}
    ${serializeElSnippet()}
    ${contextSetup}

    var req = contextNode ? contextNode.xmlElement.foQueryParentInst.requestFocus(${JSON.stringify(xpath)}) : inst.requestFocus(${JSON.stringify(xpath)});
    var diag = req.diagnostics;
    if (!diag) return { matched: [], candidates: [], winner: null, status: "waiting" };

    // When the page window is not OS-focused, el.focus() is a no-op and
    // focusin does not fire. Manually dispatch focusin so onFocusIn handler
    // updates lastFocused timestamps. Only do this when the request succeeded.
    if (req.status === 2 && diag.winner && diag.winner.foQueryLeafNode) {
      var winnerEl = diag.winner.foQueryLeafNode.element.deref();
      if (winnerEl) {
        winnerEl.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      }
    }

    // Read diagnostics after focusin dispatch so lastFocused is up to date
    var finalDiag = req.diagnostics;

    return {
      matched: finalDiag.matchedElements.map(serializeEl),
      candidates: finalDiag.candidates.map(serializeEl),
      winner: finalDiag.winner ? serializeEl(finalDiag.winner) : null,
      status: req.status === 2 ? "succeeded" : req.status === 3 ? "canceled" : req.status === 4 ? "timed out" : req.status === 5 ? "no candidates" : "waiting",
      startedAt: finalDiag.startedAt,
      resolvedAt: finalDiag.resolvedAt,
      events: finalDiag.events.map(function(e) {
        var r = { type: e.type, timestamp: e.timestamp };
        if (e.xpath !== undefined) r.xpath = e.xpath;
        if (e.leafNames !== undefined) r.leafNames = e.leafNames;
        return r;
      })
    };
  })()`;
}

function serializeDiagSnippet(): string {
  return `
    function serializeDiag(req) {
      var diag = req.diagnostics;
      if (!diag) return null;
      return {
        matched: diag.matchedElements.map(serializeEl),
        candidates: diag.candidates.map(serializeEl),
        winner: diag.winner ? serializeEl(diag.winner) : null,
        status: req.status === 2 ? "succeeded" : req.status === 3 ? "canceled" : req.status === 4 ? "timed out" : req.status === 5 ? "no candidates" : "waiting",
        startedAt: diag.startedAt,
        resolvedAt: diag.resolvedAt,
        events: diag.events.map(function(e) {
          var r = { type: e.type, timestamp: e.timestamp };
          if (e.xpath !== undefined) r.xpath = e.xpath;
          if (e.leafNames !== undefined) r.leafNames = e.leafNames;
          return r;
        })
      };
    }
  `;
}

export function activeRequestExpression(globalName: string): string {
  return `(function() {
    var req = window.__FOQUERY_ACTIVE_REQUEST__;
    if (!req) return null;

    var inst = window["${globalName}"];
    if (!inst) return null;

    ${buildLeafIndexMapSnippet(globalName)}
    ${serializeElSnippet()}
    ${serializeDiagSnippet()}

    // If resolved and not yet dispatched, dispatch focusin for the winner
    // (page may not be OS-focused, so el.focus() might have been a no-op)
    if (req.status !== 1 && !req.__focusinDispatched) {
      req.__focusinDispatched = true;
      var diag = req.diagnostics;
      if (diag && diag.winner && diag.winner.foQueryLeafNode) {
        var winnerEl = diag.winner.foQueryLeafNode.element.deref();
        if (winnerEl) {
          winnerEl.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        }
      }
    }

    return serializeDiag(req);
  })()`;
}
