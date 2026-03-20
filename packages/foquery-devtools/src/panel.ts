/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
const statusEl = document.getElementById("status")!;
const globalNameInput = document.getElementById("global-name") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn")!;
const xpathStatusEl = document.getElementById("xpath-status")!;
const xpathContextEl = document.getElementById("xpath-context")!;
const xpathInput = document.getElementById("xpath-input") as HTMLInputElement;
const xpathResults = document.getElementById("xpath-results")!;
const focusBtn = document.getElementById("focus-btn") as HTMLButtonElement;
const treeEl = document.getElementById("tree")!;
const diagnosticsEl = document.getElementById("diagnostics")!;
const parentInfoEl = document.getElementById("parent-info")!;
const activeElementEl = document.getElementById("active-element")!;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let queryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastQueryMatchKeys: Set<string> = new Set();
let lastQueryValid = false;
let selectedParentName: string | null = null;

const HIGHLIGHT_KEY = "__FOQUERY_DEVTOOLS_HIGHLIGHT__";

function evalInPage(expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
      if (exceptionInfo?.isException) reject(exceptionInfo.value);
      else resolve(result);
    });
  });
}

// --- Types ---

interface SerializedNode {
  type: "parent" | "leaf";
  name: string;
  lastFocused?: number;
  leafIndex?: number;
  hasFocus?: boolean;
  focusType?: string;
  hasArbiter?: boolean;
  children?: SerializedNode[];
}

interface DiagEl {
  type: string;
  name: string;
  lastFocused?: number;
  leafIndex?: number;
}

interface DiagnosticsResult {
  matched: DiagEl[];
  candidates: DiagEl[];
  winner: DiagEl | null;
  status: string;
}

interface ActiveElementInfo {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
}

// --- Page expressions ---

function serializeTreeExpression(globalName: string): string {
  return `(function() {
    var inst = window["${globalName}"];
    if (!inst) return null;
    var root = inst.root;
    var leafIdx = 0;

    function serializeParent(node) {
      var focusType = null;
      if (typeof node.focus === "function") focusType = "function";
      else if (typeof node.focus === "string") focusType = node.focus;

      var result = {
        type: "parent",
        name: node.name,
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

function buildLeafIndexMapSnippet(globalName: string): string {
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

function serializeElSnippet(): string {
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

function findParentSnippet(globalName: string, parentName: string): string {
  return `
    var contextNode = null;
    function findParent(node) {
      if (node.name === ${JSON.stringify(parentName)}) { contextNode = node; return; }
      node.children.forEach(function(child) { findParent(child); });
    }
    findParent(window["${globalName}"].root);
  `;
}

function queryXPathExpression(
  globalName: string,
  xpath: string,
  parentName: string | null,
): string {
  const contextSetup = parentName
    ? findParentSnippet(globalName, parentName) +
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

function focusExpression(globalName: string, xpath: string): string {
  return `(function() {
    var inst = window["${globalName}"];
    if (!inst || !inst.requestFocus) return null;
    var root = inst.root;

    ${buildLeafIndexMapSnippet(globalName)}
    ${serializeElSnippet()}

    var req = inst.requestFocus(${JSON.stringify(xpath)});
    var diag = req.diagnostics;
    if (!diag) return { matched: [], candidates: [], winner: null, status: "waiting" };

    // When the page window is not OS-focused, el.focus() is a no-op and
    // focusin does not fire. Manually dispatch focusin so onFocusIn handler
    // updates lastFocused timestamps.
    if (diag.winner && diag.winner.foQueryLeafNode) {
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
      status: req.status === 2 ? "succeeded" : req.status === 3 ? "canceled" : req.status === 5 ? "no candidates" : "waiting"
    };
  })()`;
}

function activeElementExpression(): string {
  return `(function() {
    var el = document.activeElement;
    if (!el || el === document.body) return null;
    var tag = el.tagName.toLowerCase();
    var id = el.id || undefined;
    var cn = el.className || undefined;
    var text = (el.textContent || "").trim().substring(0, 40) || undefined;
    return { tag: tag, id: id, className: cn, text: text };
  })()`;
}

function highlightActiveElementExpression(): string {
  return `(function() {
    var el = document.activeElement;
    if (!el || el === document.body) return;
    var highlightKey = "${HIGHLIGHT_KEY}";

    var prev = window[highlightKey];
    if (prev && prev.element && prev.element.removeAttribute) {
      if (prev.hadStyle) prev.element.setAttribute("style", prev.savedStyle);
      else prev.element.removeAttribute("style");
    }

    var hadStyle = el.hasAttribute("style");
    var savedStyle = el.getAttribute("style") || "";
    el.setAttribute("style", savedStyle + (savedStyle ? "; " : "") + "outline: 2px solid #38bdf8; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.25);");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window[highlightKey] = { element: el, hadStyle: hadStyle, savedStyle: savedStyle };
  })()`;
}

function inspectActiveElementExpression(): string {
  return `(function() {
    var el = document.activeElement;
    if (el && el !== document.body) inspect(el);
  })()`;
}

function highlightElementExpression(globalName: string, leafIndex: number): string {
  return `(function() {
    var inst = window["${globalName}"];
    if (!inst) return;
    var root = inst.root;
    var highlightKey = "${HIGHLIGHT_KEY}";
    var idx = 0; var targetLeaf = null;
    function findLeaf(node) {
      node.children.forEach(function(child) { findLeaf(child); });
      node.leafs.forEach(function(leaf) { if (idx === ${leafIndex}) targetLeaf = leaf; idx++; });
    }
    findLeaf(root);
    if (!targetLeaf) return;
    var el = targetLeaf.element.deref();
    if (!el) return;

    var prev = window[highlightKey];
    if (prev && prev.element && prev.element.removeAttribute) {
      if (prev.hadStyle) prev.element.setAttribute("style", prev.savedStyle);
      else prev.element.removeAttribute("style");
    }

    var hadStyle = el.hasAttribute("style");
    var savedStyle = el.getAttribute("style") || "";
    el.setAttribute("style", savedStyle + (savedStyle ? "; " : "") + "outline: 2px solid #38bdf8; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.25);");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window[highlightKey] = { element: el, hadStyle: hadStyle, savedStyle: savedStyle };
  })()`;
}

function clearHighlightExpression(): string {
  return `(function() {
    var highlightKey = "${HIGHLIGHT_KEY}";
    var prev = window[highlightKey];
    if (prev && prev.element && prev.element.removeAttribute) {
      if (prev.hadStyle) prev.element.setAttribute("style", prev.savedStyle);
      else prev.element.removeAttribute("style");
    }
    window[highlightKey] = null;
  })()`;
}

function inspectElementExpression(globalName: string, leafIndex: number): string {
  return `(function() {
    var inst = window["${globalName}"];
    if (!inst) return;
    var root = inst.root;
    var idx = 0; var targetLeaf = null;
    function findLeaf(node) {
      node.children.forEach(function(child) { findLeaf(child); });
      node.leafs.forEach(function(leaf) { if (idx === ${leafIndex}) targetLeaf = leaf; idx++; });
    }
    findLeaf(root);
    if (!targetLeaf) return;
    var el = targetLeaf.element.deref();
    if (el) inspect(el);
  })()`;
}

// --- Tree rendering ---

function renderTree(node: SerializedNode, container: HTMLElement): void {
  const div = document.createElement("div");
  div.className = `tree-node tree-${node.type}`;

  const matchKey =
    node.type === "leaf" && node.leafIndex !== undefined
      ? `leaf:${node.leafIndex}`
      : `parent:${node.name}`;
  div.setAttribute("data-match-key", matchKey);

  if (node.type === "parent" && node.name === selectedParentName) {
    div.classList.add("selected");
  }

  const label = document.createElement("span");
  label.className = "tree-node-label";
  label.setAttribute("data-name", node.name);

  const tag = node.type === "parent" ? `<${node.name}>` : node.name;
  label.textContent = tag;

  if (node.lastFocused) {
    const meta = document.createElement("span");
    meta.className = "node-meta";
    meta.textContent = `focused ${formatTime(node.lastFocused)}`;
    label.appendChild(meta);
  }

  if (node.type === "leaf" && node.leafIndex !== undefined) {
    const leafIndex = node.leafIndex;
    label.addEventListener("mouseenter", () => {
      void evalInPage(highlightElementExpression(globalNameInput.value, leafIndex));
    });
    label.addEventListener("mouseleave", () => {
      void evalInPage(clearHighlightExpression());
    });
    label.addEventListener("click", () => {
      void evalInPage(inspectElementExpression(globalNameInput.value, leafIndex));
    });
  }

  if (node.type === "parent") {
    label.addEventListener("click", () => {
      selectParent(selectedParentName === node.name ? null : node.name, node);
    });
  }

  div.appendChild(label);

  if (node.children) {
    for (const child of node.children) {
      renderTree(child, div);
    }
  }

  container.appendChild(div);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function applyHighlights(): void {
  treeEl.querySelectorAll(".xpath-match").forEach((el) => el.classList.remove("xpath-match"));
  if (lastQueryMatchKeys.size === 0) return;
  treeEl.querySelectorAll(".tree-node[data-match-key]").forEach((el) => {
    const key = el.getAttribute("data-match-key");
    if (key && lastQueryMatchKeys.has(key)) el.classList.add("xpath-match");
  });
}

function applyParentSelection(): void {
  treeEl.querySelectorAll(".tree-parent.selected").forEach((el) => el.classList.remove("selected"));
  if (!selectedParentName) return;
  treeEl
    .querySelectorAll(`.tree-parent[data-match-key="parent:${selectedParentName}"]`)
    .forEach((el) => {
      el.classList.add("selected");
    });
}

// --- Parent selection ---

function selectParent(name: string | null, node?: SerializedNode): void {
  selectedParentName = name;
  applyParentSelection();
  renderParentInfo(name ? (node ?? null) : null);
  updateContextLabel();
  // Re-run query in new context
  void runQuery();
}

function updateContextLabel(): void {
  if (selectedParentName) {
    xpathContextEl.textContent = `<${selectedParentName}>`;
  } else {
    xpathContextEl.textContent = "";
  }
}

function renderParentInfo(node: SerializedNode | null): void {
  parentInfoEl.innerHTML = "";
  if (!node) return;

  const header = document.createElement("div");
  header.className = "parent-info-header";

  const title = document.createElement("h3");
  title.textContent = `<${node.name}>`;
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "parent-info-close";
  closeBtn.textContent = "\u00D7";
  closeBtn.addEventListener("click", () => selectParent(null));
  header.appendChild(closeBtn);

  parentInfoEl.appendChild(header);

  // Focus prop
  const focusProp = document.createElement("div");
  focusProp.className = "parent-prop";
  const focusLabel = document.createElement("span");
  focusLabel.className = "parent-prop-name";
  focusLabel.textContent = "focus: ";
  focusProp.appendChild(focusLabel);
  const focusValue = document.createElement("span");
  if (node.hasFocus) {
    focusValue.className = "parent-prop-value";
    focusValue.textContent = node.focusType === "function" ? "() => ..." : `"${node.focusType}"`;
  } else {
    focusValue.className = "parent-prop-value none";
    focusValue.textContent = "undefined";
  }
  focusProp.appendChild(focusValue);
  parentInfoEl.appendChild(focusProp);

  // Arbiter prop
  const arbiterProp = document.createElement("div");
  arbiterProp.className = "parent-prop";
  const arbiterLabel = document.createElement("span");
  arbiterLabel.className = "parent-prop-name";
  arbiterLabel.textContent = "arbiter: ";
  arbiterProp.appendChild(arbiterLabel);
  const arbiterValue = document.createElement("span");
  arbiterValue.className = node.hasArbiter ? "parent-prop-value" : "parent-prop-value none";
  arbiterValue.textContent = node.hasArbiter ? "() => ..." : "undefined";
  arbiterProp.appendChild(arbiterValue);
  parentInfoEl.appendChild(arbiterProp);

  // lastFocused
  if (node.lastFocused) {
    const lfProp = document.createElement("div");
    lfProp.className = "parent-prop";
    const lfLabel = document.createElement("span");
    lfLabel.className = "parent-prop-name";
    lfLabel.textContent = "lastFocused: ";
    lfProp.appendChild(lfLabel);
    const lfValue = document.createElement("span");
    lfValue.className = "parent-prop-value";
    lfValue.textContent = formatTime(node.lastFocused);
    lfProp.appendChild(lfValue);
    parentInfoEl.appendChild(lfProp);
  }
}

// --- Diagnostics rendering ---

function createDiagItem(el: DiagEl, extraClass?: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "diag-item" + (extraClass ? " " + extraClass : "");
  item.textContent = el.type === "parent" ? `<${el.name}>` : el.name;

  if (el.lastFocused) {
    const metaSpan = document.createElement("span");
    metaSpan.className = "diag-meta";
    metaSpan.textContent = ` focused ${formatTime(el.lastFocused)}`;
    item.appendChild(metaSpan);
  }

  if (el.type === "leaf" && el.leafIndex !== undefined) {
    const leafIndex = el.leafIndex;
    item.style.cursor = "pointer";
    item.addEventListener("mouseenter", () => {
      void evalInPage(highlightElementExpression(globalNameInput.value, leafIndex));
    });
    item.addEventListener("mouseleave", () => {
      void evalInPage(clearHighlightExpression());
    });
    item.addEventListener("click", () => {
      void evalInPage(inspectElementExpression(globalNameInput.value, leafIndex));
    });
  }

  return item;
}

function renderDiagnostics(diag: DiagnosticsResult): void {
  diagnosticsEl.innerHTML = "";

  const statusSection = createDiagSection("Status");
  const statusItem = document.createElement("div");
  statusItem.className = "diag-item";
  statusItem.textContent = diag.status;
  statusItem.style.color = diag.status === "succeeded" ? "#4ec9b0" : "#f44747";
  statusSection.appendChild(statusItem);
  diagnosticsEl.appendChild(statusSection);

  const matchedSection = createDiagSection(`Matched (${diag.matched.length})`);
  for (const el of diag.matched) matchedSection.appendChild(createDiagItem(el));
  diagnosticsEl.appendChild(matchedSection);

  const candidatesSection = createDiagSection(`Candidates (${diag.candidates.length})`);
  for (const el of diag.candidates) candidatesSection.appendChild(createDiagItem(el));
  diagnosticsEl.appendChild(candidatesSection);

  const winnerSection = createDiagSection("Winner");
  if (diag.winner) {
    winnerSection.appendChild(createDiagItem(diag.winner, "winner"));
  } else {
    const noneItem = document.createElement("div");
    noneItem.className = "diag-item";
    noneItem.textContent = "none";
    noneItem.style.color = "#808080";
    winnerSection.appendChild(noneItem);
  }
  diagnosticsEl.appendChild(winnerSection);
}

function createDiagSection(title: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "diag-section";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  section.appendChild(h3);
  return section;
}

// --- Active element ---

async function refreshActiveElement(): Promise<void> {
  try {
    const info = (await evalInPage(activeElementExpression())) as ActiveElementInfo | null;
    if (info) {
      let html = `<${info.tag}`;
      if (info.id) html += ` id="${info.id}"`;
      if (info.className) html += ` class="${info.className.split(" ").slice(0, 2).join(" ")}"`;
      html += ">";
      if (info.text) html += info.text.substring(0, 30);
      activeElementEl.textContent = html;
    } else {
      activeElementEl.textContent = "<body>";
    }
  } catch {
    activeElementEl.textContent = "—";
  }
}

// --- Refresh & Query ---

async function refreshTree(): Promise<void> {
  const globalName = globalNameInput.value;
  try {
    const tree = (await evalInPage(serializeTreeExpression(globalName))) as SerializedNode | null;
    if (tree) {
      statusEl.className = "connected";
      treeEl.innerHTML = "";
      renderTree(tree, treeEl);
      applyHighlights();
    } else {
      statusEl.className = "";
      treeEl.innerHTML = '<span style="color:#808080">No FoQuery root found</span>';
    }
  } catch {
    statusEl.className = "";
    treeEl.innerHTML = '<span style="color:#f44747">Error connecting</span>';
  }
  await refreshActiveElement();
}

async function runQuery(): Promise<void> {
  const globalName = globalNameInput.value;
  const xpath = xpathInput.value.trim();

  if (!xpath) {
    xpathStatusEl.className = "";
    xpathInput.className = "";
    xpathResults.textContent = "";
    lastQueryMatchKeys = new Set();
    lastQueryValid = false;
    focusBtn.disabled = true;
    applyHighlights();
    return;
  }

  try {
    const response = (await evalInPage(
      queryXPathExpression(globalName, xpath, selectedParentName),
    )) as {
      error: boolean;
      results: { type: string; name: string; leafIndex?: number }[];
    };

    if (response.error) {
      xpathStatusEl.className = "invalid";
      xpathInput.className = "invalid";
      xpathResults.textContent = "invalid";
      lastQueryMatchKeys = new Set();
      lastQueryValid = false;
      focusBtn.disabled = true;
    } else {
      const count = response.results.length;
      xpathStatusEl.className = "valid";
      xpathInput.className = "valid";
      xpathResults.textContent = `${count} result${count !== 1 ? "s" : ""}`;
      lastQueryMatchKeys = new Set(
        response.results.map((r) =>
          r.type === "leaf" && r.leafIndex !== undefined
            ? `leaf:${r.leafIndex}`
            : `parent:${r.name}`,
        ),
      );
      lastQueryValid = true;
      focusBtn.disabled = false;
    }
    applyHighlights();
  } catch {
    xpathStatusEl.className = "invalid";
    xpathInput.className = "invalid";
    xpathResults.textContent = "error";
    lastQueryMatchKeys = new Set();
    lastQueryValid = false;
    focusBtn.disabled = true;
    applyHighlights();
  }
}

async function runFocus(): Promise<void> {
  const globalName = globalNameInput.value;
  const xpath = xpathInput.value.trim();
  if (!xpath || !lastQueryValid) return;

  try {
    const diag = (await evalInPage(focusExpression(globalName, xpath))) as DiagnosticsResult | null;
    if (diag) renderDiagnostics(diag);

    await refreshTree();
  } catch {
    diagnosticsEl.innerHTML = '<span style="color:#f44747">Focus failed</span>';
  }
}

// --- Connection ---

function connect(): void {
  if (pollInterval) clearInterval(pollInterval);
  refreshTree();
  pollInterval = setInterval(refreshTree, 1000);
}

function disconnect(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  statusEl.className = "";
}

// --- Event listeners ---

connectBtn.addEventListener("click", () => {
  if (pollInterval) {
    disconnect();
    connectBtn.textContent = "Connect";
  } else {
    connect();
    connectBtn.textContent = "Disconnect";
  }
});

xpathInput.addEventListener("input", () => {
  if (queryDebounceTimer) clearTimeout(queryDebounceTimer);
  queryDebounceTimer = setTimeout(() => {
    void runQuery();
  }, 150);
});

focusBtn.addEventListener("click", () => {
  void runFocus();
});

activeElementEl.addEventListener("mouseenter", () => {
  void evalInPage(highlightActiveElementExpression());
});
activeElementEl.addEventListener("mouseleave", () => {
  void evalInPage(clearHighlightExpression());
});
activeElementEl.addEventListener("click", () => {
  void evalInPage(inspectActiveElementExpression());
});

// Auto-connect on panel open
connect();
connectBtn.textContent = "Disconnect";
