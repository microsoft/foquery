/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import {
  serializeTreeExpression,
  queryXPathExpression,
  focusExpression,
  activeRequestExpression,
} from "./expressions.js";

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
let selectedParentIndex: number | null = null;

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
  parentIndex?: number;
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

interface DiagEvent {
  type: string;
  timestamp: number;
  xpath?: string;
  leafNames?: string[];
  reason?: string;
}

interface DiagnosticsResult {
  matched: DiagEl[];
  candidates: DiagEl[];
  winner: DiagEl | null;
  status: string;
  startedAt?: number;
  resolvedAt?: number;
  cancelReason?: string;
  events?: DiagEvent[];
}

interface ActiveElementInfo {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
}

// --- Page expressions (remaining, not in expressions.ts) ---

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
  if (node.parentIndex !== undefined) {
    div.setAttribute("data-parent-index", String(node.parentIndex));
  }

  if (node.type === "parent" && node.parentIndex === selectedParentIndex) {
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
      const deselecting = selectedParentIndex === node.parentIndex;
      selectParent(deselecting ? null : node.name, deselecting ? undefined : node);
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
  if (selectedParentIndex === null) return;
  const el = treeEl.querySelector(`.tree-parent[data-parent-index="${selectedParentIndex}"]`);
  if (el) el.classList.add("selected");
}

function findSerializedNode(node: SerializedNode, parentIndex: number): SerializedNode | undefined {
  if (node.parentIndex === parentIndex) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findSerializedNode(child, parentIndex);
      if (found) return found;
    }
  }
  return undefined;
}

// --- Parent selection ---

function selectParent(name: string | null, node?: SerializedNode): void {
  selectedParentName = name;
  selectedParentIndex = node?.parentIndex ?? null;
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

  const startedAt = diag.startedAt ?? Date.now();
  const elapsed = (diag.resolvedAt ?? Date.now()) - startedAt;

  // Status header
  const statusSection = createDiagSection("Status");
  const statusItem = document.createElement("div");
  statusItem.className = "diag-item";
  const statusLabel = diag.cancelReason
    ? `${diag.status}: ${diag.cancelReason} (${elapsed}ms)`
    : `${diag.status} (${elapsed}ms)`;
  statusItem.textContent = statusLabel;
  statusItem.style.color = diag.status === "succeeded" ? "#4ec9b0" : "#f44747";
  statusSection.appendChild(statusItem);
  diagnosticsEl.appendChild(statusSection);

  // Event timeline
  if (diag.events && diag.events.length > 0) {
    const eventColors: Record<string, string> = {
      "partial-match": "#808080",
      degraded: "#f44747",
      "lost-match": "#f44747",
      "matched-pending-checks": "#dcdcaa",
      "checks-passed": "#4ec9b0",
      succeeded: "#4ec9b0",
      canceled: "#f44747",
      "timed-out": "#f44747",
      "no-candidates": "#f44747",
    };

    const eventSection = createDiagSection("Events");
    for (const evt of diag.events) {
      const item = document.createElement("div");
      item.className = "diag-item";
      const dt = evt.timestamp - startedAt;
      let label = evt.type;
      if (evt.reason) label += ` (${evt.reason})`;
      if (evt.xpath) label += `: ${evt.xpath}`;
      if (evt.leafNames) label += `: ${evt.leafNames.join(", ")}`;
      item.textContent = `+${dt}ms ${label}`;
      item.style.color = eventColors[evt.type] ?? "#808080";
      eventSection.appendChild(item);
    }
    diagnosticsEl.appendChild(eventSection);
  }

  // Matched / Candidates / Winner
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

      // Re-run query to reflect tree changes
      if (xpathInput.value.trim()) {
        void runQuery();
      }

      // Update or clear selection based on whether the selected parent still exists
      if (selectedParentIndex !== null) {
        const selectedNode = findSerializedNode(tree, selectedParentIndex);
        if (selectedNode) {
          renderParentInfo(selectedNode);
        } else {
          selectParent(null);
        }
      }
    } else {
      statusEl.className = "";
      treeEl.innerHTML = '<span style="color:#808080">No FoQuery root found</span>';
    }
  } catch {
    statusEl.className = "";
    treeEl.innerHTML = '<span style="color:#f44747">Error connecting</span>';
  }
  await refreshActiveElement();
  await checkActiveRequest();
}

async function checkActiveRequest(): Promise<void> {
  const globalName = globalNameInput.value;
  try {
    const diag = (await evalInPage(
      activeRequestExpression(globalName),
    )) as DiagnosticsResult | null;
    if (diag) renderDiagnostics(diag);
  } catch {
    // No active request or error — ignore
  }
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
      queryXPathExpression(globalName, xpath, selectedParentIndex),
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
    const diag = (await evalInPage(
      focusExpression(globalName, xpath, selectedParentIndex),
    )) as DiagnosticsResult | null;
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

xpathInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    void runFocus();
  }
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
