/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { RequestStatus } from "./consts";
import { generateXPathSimplifications } from "./xpath-utils";
import { evaluateXPath } from "./xpath-eval";

// Only one active request globally — any new requestFocus cancels the previous one
let _activeRequest: FoQueryRequest | undefined;

export class FoQueryRequest implements Types.Request {
  private _root: Types.RootNode;
  private _contextNode: Types.ParentNode;
  private _resolve: ((status: Types.RequestStatus) => void) | undefined;
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
    this._simplifications = generateXPathSimplifications(xpath);

    // Cancel any previous active request globally
    if (_activeRequest && _activeRequest !== this) {
      _activeRequest.cancel();
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
      this._resolve = (status: Types.RequestStatus) => {
        delete this._resolve;
        this.status = status;
        if (this.diagnostics) {
          this.diagnostics.resolvedAt = Date.now();
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
    const cancelHandler = () => {
      if (ownFocus) {
        ownFocus = false;
        return;
      }
      this._resolve?.(RequestStatus.Canceled);
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

  public cancel() {
    this._resolve?.(RequestStatus.Canceled);
  }

  private _cleanup(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;

    this._cancelOnInteraction?.();
    this._cancelOnInteraction = undefined;
    this._markOwnFocus = undefined;

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
    this._effectiveLastFocused.clear();

    const matchedElements = this._query(this.xpath, this._contextNode);
    const candidates = this._collectCandidates(matchedElements);

    this._sortByLastFocused(candidates);

    const winner =
      candidates.length > 1 && this._root.arbiter ? this._root.arbiter(candidates) : candidates[0];

    if (!this.diagnostics) {
      this.diagnostics = {
        startedAt: Date.now(),
        resolvedAt: undefined,
        xpath: this.xpath,
        matchedElements,
        candidates,
        winner,
        progressiveMatches: [],
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
    if (matchedElements.length > 0 && candidates.length === 0 && this._timeoutId === undefined) {
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
        this.diagnostics!.progressiveMatches.push({
          xpath: bestXpath,
          matched: true,
          timestamp: now,
          degraded: true,
        });
      } else if (bestDepth !== this._previousPartialDepth) {
        this.diagnostics!.progressiveMatches.push({
          xpath: bestXpath,
          matched: true,
          timestamp: now,
        });
      }
      this._previousPartialDepth = bestDepth;
    } else if (this._previousPartialDepth >= 0) {
      this.diagnostics!.progressiveMatches.push({
        xpath: "",
        matched: false,
        timestamp: now,
        degraded: true,
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

        if (typeof parentNode.focus === "function") {
          this._setEffectiveLastFocused(xmlElement, fallbackParent);
          candidates.push(xmlElement);
        } else {
          const subCandidates = this._collectCandidates(
            this._query(parentNode.focus, parentNode),
            parentNode,
          );

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
    if (xmlElement.foQueryLeafNode) {
      const leafFocus = xmlElement.foQueryLeafNode.focus;

      if (leafFocus) {
        leafFocus()
          .then((result) => {
            if (result) {
              this._resolve?.(RequestStatus.Succeeded);
            } else {
              this._focusElement(xmlElement.foQueryLeafNode?.element);
            }
          })
          .catch(() => {
            this._focusElement(xmlElement.foQueryLeafNode?.element);
          });
        return;
      }

      this._focusElement(xmlElement.foQueryLeafNode.element);
    } else if (xmlElement.foQueryParentNode) {
      const parentFocus = xmlElement.foQueryParentNode.focus;

      if (typeof parentFocus === "function") {
        parentFocus()
          .then((result) => {
            if (result) {
              this._resolve?.(RequestStatus.Succeeded);
            }
          })
          .catch(() => {
            // Parent focus function failed — nothing to fall back to
          });
      }
    }
  }

  private _focusElement(ref: WeakRef<HTMLElement> | undefined): void {
    const el = ref?.deref();
    if (el) {
      this._markOwnFocus?.();
      el.focus({ focusVisible: true } as FocusOptions);
      this._resolve?.(RequestStatus.Succeeded);
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
