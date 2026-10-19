/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

export function serializeTreeExpression(globalName: string): string {
  return `(function() {
    var inst = window[${JSON.stringify(globalName)}];
    if (!inst) return null;
    var root = inst.root;
    ${nodeIdSnippet()}

    function serializeParent(node) {
      var focusType = null;
      if (typeof node.focus === "function") focusType = "function";
      else if (typeof node.focus === "string") focusType = node.focus;

      var result = {
        type: "parent",
        name: node.name,
        parentId: nodeId(node),
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
          leafId: nodeId(leaf)
        });
      });

      Array.prototype.forEach.call(node.xmlElement.children, function(childEl) {
        if (childEl.foQueryRemoteFrameRef) {
          children.push(serializeRemoteElement(childEl));
        }
      });

      result.children = children;
      return result;
    }

    function serializeRemoteElement(el) {
      var type = el.getAttribute("type") === "leaf" ? "leaf" : "parent";
      var remoteRef = el.foQueryRemoteFrameRef;
      var result = {
        type: type,
        name: el.tagName,
        lastFocused: remoteRef && remoteRef.lastFocused,
        remoteFrameId: remoteRef && remoteRef.frameId,
        remoteXPath: remoteRef && remoteRef.childXPath
      };
      if (type === "parent") {
        result.children = Array.prototype.map.call(el.children, serializeRemoteElement);
      }
      return result;
    }

    return serializeParent(root);
  })()`;
}

/**
 * Defines `nodeId(obj)`, which returns an id that stays the same for a parent or leaf node
 * object across evaluations (unlike tree positions, which shift when siblings mount).
 */
export function nodeIdSnippet(): string {
  return `
    var __nodeIds = window.__FOQUERY_DEVTOOLS_NODE_IDS__;
    if (!__nodeIds) {
      __nodeIds = { map: new WeakMap(), next: 1 };
      Object.defineProperty(window, "__FOQUERY_DEVTOOLS_NODE_IDS__", { value: __nodeIds, configurable: true });
    }
    function nodeId(obj) {
      var id = __nodeIds.map.get(obj);
      if (id === undefined) {
        id = __nodeIds.next++;
        __nodeIds.map.set(obj, id);
      }
      return id;
    }
  `;
}

export function serializeElSnippet(): string {
  return `
    function serializeEl(el) {
      if (el.foQueryRemoteFrameRef) {
        return { type: el.getAttribute("type") === "leaf" ? "leaf" : "parent", name: el.tagName, lastFocused: el.foQueryRemoteFrameRef.lastFocused, remoteFrameId: el.foQueryRemoteFrameRef.frameId, remoteXPath: el.foQueryRemoteFrameRef.childXPath };
      } else if (el.foQueryLeafNode) {
        return { type: "leaf", name: el.foQueryLeafNode.names.join(", "), lastFocused: el.foQueryLeafNode.lastFocused, leafId: nodeId(el.foQueryLeafNode) };
      } else if (el.foQueryParentNode) {
        return { type: "parent", name: el.foQueryParentNode.name, lastFocused: el.foQueryParentNode.lastFocused, parentId: nodeId(el.foQueryParentNode) };
      }
      return { type: "unknown", name: el.tagName };
    }
  `;
}

/** Requires nodeIdSnippet(); defines `contextNode`. */
export function findParentByIdSnippet(globalName: string, parentId: number): string {
  return `
    var contextNode = null;
    function findParentById(node) {
      if (nodeId(node) === ${Number(parentId)}) { contextNode = node; return; }
      node.children.forEach(function(child) { if (!contextNode) findParentById(child); });
    }
    findParentById(window[${JSON.stringify(globalName)}].root);
  `;
}

/** Requires nodeIdSnippet(); defines `targetLeaf`. */
export function findLeafByIdSnippet(globalName: string, leafId: number): string {
  return `
    var targetLeaf = null;
    function findLeafById(node) {
      node.leafs.forEach(function(leaf) { if (nodeId(leaf) === ${Number(leafId)}) targetLeaf = leaf; });
      node.children.forEach(function(child) { if (!targetLeaf) findLeafById(child); });
    }
    findLeafById(window[${JSON.stringify(globalName)}].root);
  `;
}

export function queryXPathExpression(
  globalName: string,
  xpath: string,
  parentId: number | null,
): string {
  const contextSetup =
    parentId !== null
      ? findParentByIdSnippet(globalName, parentId) +
        "if (!contextNode) return { error: false, results: [] };"
      : "var contextNode = null;";

  return `(function() {
    var inst = window[${JSON.stringify(globalName)}];
    if (!inst || !inst.root) return { error: false, results: [] };
    var root = inst.root;
    var xmlDoc = root.xmlDoc;

    function evalXPath(xpath, ctx) {
      var r = xmlDoc.evaluate(xpath, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      var els = [];
      for (var i = 0; i < r.snapshotLength; i++) { var n = r.snapshotItem(i); if (n && n.nodeType === 1) els.push(n); }
      return els;
    }

    try {
      ${nodeIdSnippet()}
      ${contextSetup}

      var ctxEl = contextNode ? contextNode.xmlElement : xmlDoc;
      var results = evalXPath(${JSON.stringify(xpath)}, ctxEl);
      return {
        error: false,
        results: results.map(function(el) {
          if (el.foQueryRemoteFrameRef) {
            return { type: el.getAttribute("type") === "leaf" ? "leaf" : "parent", name: el.tagName, remoteFrameId: el.foQueryRemoteFrameRef.frameId, remoteXPath: el.foQueryRemoteFrameRef.childXPath };
          } else if (el.foQueryLeafNode) {
            return { type: "leaf", name: el.foQueryLeafNode.names.join(", "), leafId: nodeId(el.foQueryLeafNode) };
          } else if (el.foQueryParentNode) {
            return { type: "parent", name: el.foQueryParentNode.name, parentId: nodeId(el.foQueryParentNode) };
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
  parentId: number | null,
): string {
  const contextSetup =
    parentId !== null
      ? findParentByIdSnippet(globalName, parentId) + "if (!contextNode) return null;"
      : "var contextNode = null;";

  return `(function() {
    var inst = window[${JSON.stringify(globalName)}];
    if (!inst || !inst.requestFocus) return null;
    var root = inst.root;

    ${nodeIdSnippet()}
    ${serializeElSnippet()}
    ${contextSetup}

    var req = contextNode ? contextNode.xmlElement.foQueryParentInst.requestFocus(${JSON.stringify(xpath)}) : inst.requestFocus(${JSON.stringify(xpath)});
    var diag = req.diagnostics;
    if (!diag) return { matched: [], candidates: [], winner: null, status: "waiting", xpath: ${JSON.stringify(xpath)} };

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
      xpath: finalDiag.xpath,
      startedAt: finalDiag.startedAt,
      resolvedAt: finalDiag.resolvedAt,
      cancelReason: finalDiag.cancelReason,
      events: finalDiag.events.map(function(e) {
        var r = { type: e.type, timestamp: e.timestamp };
        if (e.xpath !== undefined) r.xpath = e.xpath;
        if (e.leafNames !== undefined) r.leafNames = e.leafNames;
        if (e.reason !== undefined) r.reason = e.reason;
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
        xpath: diag.xpath,
        startedAt: diag.startedAt,
        resolvedAt: diag.resolvedAt,
        cancelReason: diag.cancelReason,
        events: diag.events.map(function(e) {
          var r = { type: e.type, timestamp: e.timestamp };
          if (e.xpath !== undefined) r.xpath = e.xpath;
          if (e.leafNames !== undefined) r.leafNames = e.leafNames;
          if (e.reason !== undefined) r.reason = e.reason;
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

    var inst = window[${JSON.stringify(globalName)}];
    if (!inst) return null;

    ${nodeIdSnippet()}
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
