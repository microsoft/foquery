/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { RequestStatus } from "./consts";
import { generateXPathSimplifications } from "./xpath-utils";
import { evaluateXPath } from "./xpath-eval";

// Only one active request globally — a page can only have one focused element at a time,
// so even with multiple FoQuery roots, only one request can be active. Any new
// requestFocus cancels the previous one regardless of which root it belongs to.
let _activeRequest: FoQueryRequest | undefined;

export class FoQueryRequest implements Types.Request {
  private _root: Types.RootNode;
  private _contextNode: Types.ParentNode;
  private _resolve:
    | ((status: Types.RequestStatus, cancelReason?: Types.CancelReason) => void)
    | undefined;
  private _effectiveLastFocused = new Map<Types.XmlElement, number>();
  private _simplifications: string[][];
  private _previousPartialDepth = -1;
  private _pendingProgressiveFlush = false;
  private _pendingBestDepth = -1;
  private _pendingBestXpath = "";
  private _timeoutId: ReturnType<typeof setTimeout> | undefined;
  private _unsubscribe: (() => void) | undefined;
  private _cancelOnInteraction: (() => void) | undefined;
  private _markOwnFocus: (() => void) | undefined;
  private _hasPendingStringFocus = false;
  private _pollTimerId: ReturnType<typeof setInterval> | undefined;
  private _focusOptions: FocusOptions | undefined;

  public readonly xpath: string;
  public readonly promise: Promise<Types.RequestStatus>;
  public status: Types.RequestStatus = RequestStatus.Waiting;
  public diagnostics: Types.RequestDiagnostics | undefined;

  constructor(
    xpath: string,
    node: Types.RootNode | Types.ParentNode,
    options?: Types.RequestFocusOptions,
  ) {
    this.xpath = xpath;
    this._contextNode = node;
    this._root = "subscribe" in node ? (node as Types.RootNode) : findRoot(node);
    this._focusOptions = options?.focusOptions;
    this._simplifications = generateXPathSimplifications(xpath);

    // Cancel any previous active request globally
    if (_activeRequest && _activeRequest !== this) {
      _activeRequest.cancel("superseded");
    }
    _activeRequest = this; // eslint-disable-line @typescript-eslint/no-this-alias

    // Expose active request for devtools polling
    if (this._root.devtools) {
      (this._root.window as unknown as Record<string, unknown>).__FOQUERY_ACTIVE_REQUEST__ = this;
    }

    this._unsubscribe = this._root.subscribe(() => {
      this._matchPath();
    });

    this.promise = new Promise((resolve) => {
      this._resolve = (status: Types.RequestStatus, cancelReason?: Types.CancelReason) => {
        delete this._resolve;
        this.status = status;
        const now = Date.now();
        if (this.diagnostics) {
          this.diagnostics.resolvedAt = now;
          if (cancelReason) {
            this.diagnostics.cancelReason = cancelReason;
          }
          if (status === RequestStatus.Canceled) {
            this.diagnostics.events.push({
              type: "canceled",
              reason: cancelReason ?? "api",
              timestamp: now,
            });
          } else {
            const type: Types.DiagnosticEvent["type"] =
              status === RequestStatus.Succeeded
                ? "succeeded"
                : status === RequestStatus.TimedOut
                  ? "timed-out"
                  : "no-candidates";
            this.diagnostics.events.push({ type, timestamp: now } as Types.DiagnosticEvent);
          }
        }
        resolve(status);
      };
    });

    this.promise.finally(() => {
      this._cleanup();
    });

    if (options?.timeout) {
      this._timeoutId = setTimeout(() => {
        this._resolve?.(RequestStatus.TimedOut);
      }, options.timeout);
    }

    // Cancel on user interaction (click or focus movement not caused by this request)
    const doc = this._root.window.document;
    let ownFocus = false;
    const cancelHandler = (e: Event) => {
      if (ownFocus) {
        ownFocus = false;
        return;
      }
      if (e.target instanceof Element && e.target.closest("[data-foquery-ignore]")) {
        return;
      }
      this._resolve?.(RequestStatus.Canceled, e.type === "focusin" ? "focus-moved" : "user-click");
    };
    this._markOwnFocus = () => {
      ownFocus = true;
    };
    doc.addEventListener("focusin", cancelHandler, true);
    doc.addEventListener("mousedown", cancelHandler, true);
    this._cancelOnInteraction = () => {
      doc.removeEventListener("focusin", cancelHandler, true);
      doc.removeEventListener("mousedown", cancelHandler, true);
    };

    this._matchPath();
  }

  public cancel(reason: Types.CancelReason = "api") {
    this._resolve?.(RequestStatus.Canceled, reason);
  }

  private _cleanup(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;

    this._cancelOnInteraction?.();
    this._cancelOnInteraction = undefined;
    this._markOwnFocus = undefined;
    this._stopPolling();

    if (this._timeoutId !== undefined) {
      clearTimeout(this._timeoutId);
      this._timeoutId = undefined;
    }

    if (_activeRequest === this) {
      _activeRequest = undefined;
    }
  }

  private _query(xpath: string, contextNode: Types.ParentNode): Types.XmlElement[] {
    return evaluateXPath(this._root.xmlDoc, contextNode.xmlElement, xpath);
  }

  private _matchPath(): void {
    // Stop any active check polling — tree changed, re-evaluate from scratch
    this._stopPolling();

    this._effectiveLastFocused.clear();

    const matchedElements = this._query(this.xpath, this._contextNode);
    this._hasPendingStringFocus = false;
    const candidates = this._collectCandidates(matchedElements);

    this._sortByLastFocused(candidates);

    const winner =
      candidates.length > 1 && this._root.arbiter ? this._root.arbiter(candidates) : candidates[0];

    if (!this.diagnostics) {
      this.diagnostics = {
        startedAt: Date.now(),
        resolvedAt: undefined,
        cancelReason: undefined,
        xpath: this.xpath,
        matchedElements,
        candidates,
        winner,
        events: [],
      };
    } else {
      this.diagnostics.matchedElements = matchedElements;
      this.diagnostics.candidates = candidates;
      this.diagnostics.winner = winner;
    }

    // Full match — resolve immediately
    if (winner) {
      this._focusCandidate(winner);
      return;
    }

    // No full match, no timeout — resolve NoCandidates if we had matched elements
    // BUT only if no matched parent has a string focus that could produce candidates later
    if (
      matchedElements.length > 0 &&
      candidates.length === 0 &&
      !this._hasPendingStringFocus &&
      this._timeoutId === undefined
    ) {
      this._resolve?.(RequestStatus.NoCandidates);
      return;
    }

    // Progressive matching
    this._evaluateProgressiveMatches();
  }

  private _evaluateProgressiveMatches(): void {
    let bestDepth = -1;
    let bestXpath = "";

    for (const chain of this._simplifications) {
      for (let depth = 0; depth < chain.length; depth++) {
        const results = this._query(chain[depth], this._contextNode);
        if (results.length > 0) {
          if (bestDepth === -1 || depth < bestDepth) {
            bestDepth = depth;
            bestXpath = chain[depth];
          }
          break;
        }
      }
    }

    // Defer recording to microtask so that synchronous unmount+remount cycles
    // (e.g. React StrictMode) settle before we record. Only the final state
    // within a synchronous batch gets recorded.
    this._pendingBestDepth = bestDepth;
    this._pendingBestXpath = bestXpath;

    if (!this._pendingProgressiveFlush) {
      this._pendingProgressiveFlush = true;
      Promise.resolve().then(() => {
        this._flushProgressiveMatch();
      });
    }
  }

  private _flushProgressiveMatch(): void {
    this._pendingProgressiveFlush = false;

    // Request may have resolved during the microtask
    if (!this._resolve) return;

    const bestDepth = this._pendingBestDepth;
    const bestXpath = this._pendingBestXpath;
    const now = Date.now();

    if (bestDepth >= 0) {
      if (bestDepth > this._previousPartialDepth && this._previousPartialDepth >= 0) {
        this.diagnostics!.events.push({
          type: "degraded",
          xpath: bestXpath,
          timestamp: now,
        });
      } else if (bestDepth !== this._previousPartialDepth) {
        this.diagnostics!.events.push({
          type: "partial-match",
          xpath: bestXpath,
          timestamp: now,
        });
      }
      this._previousPartialDepth = bestDepth;
    } else if (this._previousPartialDepth >= 0) {
      this.diagnostics!.events.push({
        type: "lost-match",
        timestamp: now,
      });
      this._previousPartialDepth = -1;
    }
  }

  private _getEffectiveLastFocused(el: Types.XmlElement): number {
    return this._effectiveLastFocused.get(el) ?? 0;
  }

  private _setEffectiveLastFocused(el: Types.XmlElement, fallbackParent?: Types.ParentNode): void {
    const value =
      el.foQueryLeafNode?.lastFocused ??
      el.foQueryParentNode?.lastFocused ??
      fallbackParent?.lastFocused ??
      0;
    this._effectiveLastFocused.set(el, value);
  }

  private _sortByLastFocused(candidates: Types.XmlElement[]): void {
    candidates.sort((a, b) => this._getEffectiveLastFocused(b) - this._getEffectiveLastFocused(a));
  }

  private _collectCandidates(
    elements: Types.XmlElement[],
    fallbackParent?: Types.ParentNode,
  ): Types.XmlElement[] {
    const candidates: Types.XmlElement[] = [];

    for (const xmlElement of elements) {
      if (xmlElement.foQueryLeafNode) {
        this._setEffectiveLastFocused(xmlElement, fallbackParent);
        candidates.push(xmlElement);
      } else if (xmlElement.foQueryParentNode) {
        const parentNode = xmlElement.foQueryParentNode;

        if (parentNode.focus === undefined) continue;

        const subCandidates = this._collectCandidates(
          this._query(parentNode.focus, parentNode),
          parentNode,
        );

        if (subCandidates.length === 0) {
          // String focus didn't match yet — children may mount later
          this._hasPendingStringFocus = true;
        } else {
          this._sortByLastFocused(subCandidates);

          if (subCandidates.length > 1 && parentNode.arbiter) {
            candidates.push(parentNode.arbiter(subCandidates));
          } else {
            for (const c of subCandidates) {
              candidates.push(c);
            }
          }
        }
      }
    }

    return candidates;
  }

  private _focusCandidate(xmlElement: Types.XmlElement): void {
    if (!xmlElement.foQueryLeafNode) return;

    const leaf = xmlElement.foQueryLeafNode;
    const el = leaf.element.deref();
    if (!el) return;

    if (this._passesAllChecks(leaf, el)) {
      this._doFocusLeaf(leaf, el);
      return;
    }

    // Record pending for all candidates that failed checks
    this._recordPendingChecks();

    // Some check failed — start polling all current candidates
    this._startPolling();
  }

  private _passesAllChecks(leaf: Types.LeafNode, el: HTMLElement): boolean {
    // Leaf's own check callbacks
    for (const cb of leaf.checkCallbacks) {
      if (!cb(el)) return false;
    }
    // Walk up parent chain — each parent's check callbacks apply to all its leaves
    for (let p = leaf.parent; p; p = p.parent) {
      for (const cb of p.checkCallbacks) {
        if (!cb(el)) return false;
      }
    }
    return true;
  }

  private _doFocusLeaf(leaf: Types.LeafNode, el: HTMLElement): void {
    if (leaf.focus) {
      // Mark own focus before the callback so that any .focus() call inside
      // the callback (on a child element) is recognized as ours and doesn't
      // trigger a "focus-moved" cancellation.
      this._markOwnFocus?.();
      const result = leaf.focus();
      if (result) {
        this._resolve?.(RequestStatus.Succeeded);
        return;
      }
    }
    this._markOwnFocus?.();
    el.focus(this._focusOptions);
    this._resolve?.(RequestStatus.Succeeded);
  }

  private _startPolling(): void {
    this._stopPolling();

    const CHECK_INTERVAL = 50;

    this._pollTimerId = setInterval(() => {
      if (!this._resolve || !this.diagnostics) {
        this._stopPolling();
        return;
      }

      // Poll all current candidates
      for (const xmlEl of this.diagnostics.candidates) {
        const leaf = xmlEl.foQueryLeafNode;
        if (!leaf) continue;
        const el = leaf.element.deref();
        if (!el) continue;

        if (this._passesAllChecks(leaf, el)) {
          this._stopPolling();
          this._recordChecksReady(leaf);
          this._doFocusLeaf(leaf, el);
          return;
        }
      }
    }, CHECK_INTERVAL);
  }

  private _pendingCheckKeys = new Set<string>();

  private _recordPendingChecks(): void {
    if (!this.diagnostics) return;
    const now = Date.now();
    for (const xmlEl of this.diagnostics.candidates) {
      const leaf = xmlEl.foQueryLeafNode;
      if (!leaf) continue;
      const key = leaf.names.join(",");
      if (this._pendingCheckKeys.has(key)) continue;
      const el = leaf.element.deref();
      if (!el) continue;
      if (!this._passesAllChecks(leaf, el)) {
        this._pendingCheckKeys.add(key);
        this.diagnostics.events.push({
          type: "matched-pending-checks",
          leafNames: leaf.names,
          timestamp: now,
        });
      }
    }
  }

  private _recordChecksReady(leaf: Types.LeafNode): void {
    if (!this.diagnostics) return;
    this.diagnostics.events.push({
      type: "checks-passed",
      leafNames: leaf.names,
      timestamp: Date.now(),
    });
  }

  private _stopPolling(): void {
    if (this._pollTimerId !== undefined) {
      clearInterval(this._pollTimerId);
      this._pollTimerId = undefined;
    }
  }
}

function findRoot(node: Types.ParentNode): Types.RootNode {
  let current = node;
  while (current.parent) {
    current = current.parent;
  }
  return current as Types.RootNode;
}
