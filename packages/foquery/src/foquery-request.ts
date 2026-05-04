/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { RequestStatus } from "./consts";
import { generateXPathSimplifications } from "./xpath-utils";
import { evaluateXPath } from "./xpath-eval";

const DELEGATED_FOCUS_HANDOFF_TIMEOUT = 250;

interface FoQueryRequestInternalOptions {
  skipAppCoordination?: boolean;
}

class AppFocusCoordinator {
  private _activeRequest: FoQueryRequest | undefined;
  private _queuedRequest: FoQueryRequest | undefined;

  public enqueue(request: FoQueryRequest): void {
    if (!this._activeRequest) {
      this._start(request);
      return;
    }

    if (this._activeRequest === request) return;

    this._queuedRequest?.cancel("superseded");
    this._queuedRequest = request;

    if (this._activeRequest.isAwaitingDelegatedFocusResult()) {
      this._activeRequest.cancelAfterDelegatedFocusSettles(DELEGATED_FOCUS_HANDOFF_TIMEOUT);
      return;
    }

    this._activeRequest.cancel("superseded");
  }

  public complete(request: FoQueryRequest): void {
    if (this._activeRequest !== request) return;

    this._activeRequest = undefined;
    const nextRequest = this._queuedRequest;
    this._queuedRequest = undefined;
    if (nextRequest) {
      this._start(nextRequest);
    }
  }

  private _start(request: FoQueryRequest): void {
    this._activeRequest = request;
    request.start();
  }
}

const _appFocusCoordinators = new WeakMap<Window & typeof globalThis, AppFocusCoordinator>();

function getAppFocusCoordinator(root: Types.RootNode): AppFocusCoordinator {
  let coordinator = _appFocusCoordinators.get(root.window);
  if (!coordinator) {
    coordinator = new AppFocusCoordinator();
    _appFocusCoordinators.set(root.window, coordinator);
  }
  return coordinator;
}

export class FoQueryRequest implements Types.Request {
  private _root: Types.RootNode;
  private _contextNode: Types.ParentNode;
  private _coordinator: AppFocusCoordinator | undefined;
  private _resolve:
    | ((status: Types.RequestStatus, cancelReason?: Types.CancelReason) => void)
    | undefined;
  private _effectiveLastFocused = new Map<Types.XmlElement, number>();
  private _simplifications: string[][];
  private _previousPartialDepth = -1;
  private _pendingProgressiveFlush = false;
  private _pendingProgressiveFlushTimerId: ReturnType<typeof setTimeout> | undefined;
  private _pendingBestDepth = -1;
  private _pendingBestXpath = "";
  private _timeoutId: ReturnType<typeof setTimeout> | undefined;
  private _unsubscribe: (() => void) | undefined;
  private _cancelOnInteraction: (() => void) | undefined;
  private _markOwnFocus: (() => void) | undefined;
  private _hasPendingStringFocus = false;
  private _pollTimerId: ReturnType<typeof setInterval> | undefined;
  private _focusOptions: FocusOptions | undefined;
  private _requestFocusOptions: Types.RequestFocusOptions | undefined;
  private _delegatedRequest: Types.Request | undefined;
  private _delegatedRemoteKey: string | undefined;
  private _remoteFocusDelegationInProgress = false;
  private _delegatedFocusSupersedeRequested = false;
  private _delegatedFocusHandoffTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private _started = false;

  public readonly xpath: string;
  public readonly promise: Promise<Types.RequestStatus>;
  public status: Types.RequestStatus = RequestStatus.Waiting;
  public diagnostics: Types.RequestDiagnostics | undefined;

  constructor(
    xpath: string,
    node: Types.RootNode | Types.ParentNode,
    options?: Types.RequestFocusOptions,
    internalOptions?: FoQueryRequestInternalOptions,
  ) {
    this.xpath = xpath;
    this._contextNode = node;
    this._root = "subscribe" in node ? (node as Types.RootNode) : findRoot(node);
    this._focusOptions = options?.focusOptions;
    this._requestFocusOptions = options;
    this._simplifications = generateXPathSimplifications(xpath);

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

    if (internalOptions?.skipAppCoordination) {
      this.start();
    } else {
      this._coordinator = getAppFocusCoordinator(this._root);
      this._coordinator.enqueue(this);
    }
  }

  public start(): void {
    if (this._started || !this._resolve) return;
    this._started = true;

    this._unsubscribe = this._root.subscribe(() => {
      this._matchPath();
    });

    // Cancel on user interaction (click or focus movement not caused by this request)
    const doc = this._root.window.document;
    let ownFocus = false;
    const cancelHandler = (e: Event) => {
      if (ownFocus) {
        ownFocus = false;
        return;
      }
      const target = e.target as { closest?: (selector: string) => Element | null } | null;
      if (target?.closest?.("[data-foquery-ignore]")) {
        return;
      }
      if (e.type === "focusin" && this._isRemoteCandidateFrameElement(e.target)) {
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
    this._remoteFocusDelegationInProgress = false;
    this._delegatedFocusSupersedeRequested = false;
    this._delegatedRequest?.cancel();
    this._delegatedRequest = undefined;
    this._delegatedRemoteKey = undefined;
    this._stopPolling();

    if (this._timeoutId !== undefined) {
      clearTimeout(this._timeoutId);
      this._timeoutId = undefined;
    }

    if (this._delegatedFocusHandoffTimeoutId !== undefined) {
      clearTimeout(this._delegatedFocusHandoffTimeoutId);
      this._delegatedFocusHandoffTimeoutId = undefined;
    }

    if (this._pendingProgressiveFlushTimerId !== undefined) {
      clearTimeout(this._pendingProgressiveFlushTimerId);
      this._pendingProgressiveFlushTimerId = undefined;
      this._pendingProgressiveFlush = false;
    }

    this._coordinator?.complete(this);
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

    // Defer recording briefly so synchronous UI updates and cross-frame snapshot
    // cascades settle before we record. Only the final settled state in a short
    // batch gets recorded, avoiding noisy degrade/restore pairs.
    this._pendingBestDepth = bestDepth;
    this._pendingBestXpath = bestXpath;

    if (!this._pendingProgressiveFlush) {
      this._pendingProgressiveFlush = true;
      this._pendingProgressiveFlushTimerId = setTimeout(() => {
        this._pendingProgressiveFlushTimerId = undefined;
        this._flushProgressiveMatch();
      }, 25);
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
      } else if (xmlElement.foQueryRemoteFrameRef) {
        this._effectiveLastFocused.set(
          xmlElement,
          xmlElement.foQueryRemoteFrameRef.lastFocused ?? fallbackParent?.lastFocused ?? 0,
        );
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
    if (xmlElement.foQueryRemoteFrameRef) {
      const iframeElement = xmlElement.foQueryRemoteFrameRef.iframeElement.deref();
      if (!iframeElement) return;

      if (this._passesAllRemoteChecks(xmlElement.foQueryRemoteFrameRef, iframeElement)) {
        this._delegateRemoteFocus(xmlElement.foQueryRemoteFrameRef);
        return;
      }

      this._recordPendingChecks();
      this._startPolling();
      return;
    }

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

  private _passesAllRemoteChecks(
    remoteRef: Types.RemoteFrameRef,
    iframeElement: HTMLIFrameElement,
  ): boolean {
    for (let p: Types.ParentNode | undefined = remoteRef.iframeParentNode; p; p = p.parent) {
      for (const cb of p.checkCallbacks) {
        if (!cb(iframeElement)) return false;
      }
    }
    return true;
  }

  private _doFocusLeaf(leaf: Types.LeafNode, el: HTMLElement): void {
    if (leaf.focus) {
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

  private _delegateRemoteFocus(remoteRef: Types.RemoteFrameRef): void {
    const delegateFocus = remoteRef.iframeParentNode.iframeDelegateFocus;
    if (!delegateFocus) return;

    const remoteKey = `${remoteRef.frameId}:${remoteRef.childXPath}`;
    if (this._delegatedRequest?.status === RequestStatus.Waiting) {
      if (this._delegatedRemoteKey === remoteKey) {
        return;
      }
      this._delegatedRequest.cancel();
    }

    this._markOwnFocus?.();
    this._remoteFocusDelegationInProgress = true;
    if (this._previousPartialDepth < 0) {
      this._previousPartialDepth = 0;
    }
    const request = delegateFocus(remoteRef.childXPath, this._requestFocusOptions);
    this._delegatedRequest = request;
    this._delegatedRemoteKey = remoteKey;

    request.promise.then((status) => {
      if (this._delegatedRequest !== request) {
        return;
      }
      this._delegatedRequest = undefined;
      this._delegatedRemoteKey = undefined;
      this._remoteFocusDelegationInProgress = false;
      if (this._delegatedFocusHandoffTimeoutId !== undefined) {
        clearTimeout(this._delegatedFocusHandoffTimeoutId);
        this._delegatedFocusHandoffTimeoutId = undefined;
      }
      if (this._resolve) {
        if (status === RequestStatus.Succeeded) {
          this._resolve(status);
        } else if (this._delegatedFocusSupersedeRequested) {
          this._resolve(RequestStatus.Canceled, "superseded");
        } else {
          this._matchPath();
        }
      }
    });
  }

  public isAwaitingDelegatedFocusResult(): boolean {
    return this._delegatedRequest?.status === RequestStatus.Waiting;
  }

  public cancelAfterDelegatedFocusSettles(timeoutMs: number): void {
    if (!this.isAwaitingDelegatedFocusResult()) {
      this.cancel("superseded");
      return;
    }

    this._delegatedFocusSupersedeRequested = true;
    if (this._delegatedFocusHandoffTimeoutId !== undefined) return;
    this._delegatedFocusHandoffTimeoutId = setTimeout(() => {
      this._delegatedFocusHandoffTimeoutId = undefined;
      this._resolve?.(RequestStatus.Canceled, "superseded");
    }, timeoutMs);
  }

  private _isRemoteCandidateFrameElement(target: EventTarget | null): boolean {
    if (!this._remoteFocusDelegationInProgress || !this.diagnostics) return false;

    for (const xmlElement of this.diagnostics.candidates) {
      const iframeElement = xmlElement.foQueryRemoteFrameRef?.iframeElement.deref();
      if (iframeElement && target === iframeElement) {
        return true;
      }
    }

    return false;
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
        const remoteRef = xmlEl.foQueryRemoteFrameRef;
        if (remoteRef) {
          const iframeElement = remoteRef.iframeElement.deref();
          if (!iframeElement) continue;
          if (this._passesAllRemoteChecks(remoteRef, iframeElement)) {
            this._stopPolling();
            this._recordChecksReady({
              names: [xmlEl.tagName],
              xmlElements: new Map(),
              element: remoteRef.iframeElement,
              parent: remoteRef.iframeParentNode,
              focus: undefined,
              checkCallbacks: new Set(),
              lastFocused: remoteRef.lastFocused,
            });
            this._delegateRemoteFocus(remoteRef);
            return;
          }
          continue;
        }

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
      const remoteRef = xmlEl.foQueryRemoteFrameRef;
      if (!leaf && !remoteRef) continue;
      const key = leaf ? leaf.names.join(",") : `${remoteRef!.frameId}:${remoteRef!.childXPath}`;
      if (this._pendingCheckKeys.has(key)) continue;
      const el = leaf?.element.deref() ?? remoteRef!.iframeElement.deref();
      if (!el) continue;
      const checksPass = leaf
        ? this._passesAllChecks(leaf, el)
        : this._passesAllRemoteChecks(remoteRef!, el as HTMLIFrameElement);
      if (!checksPass) {
        this._pendingCheckKeys.add(key);
        this.diagnostics.events.push({
          type: "matched-pending-checks",
          leafNames: leaf?.names ?? [xmlEl.tagName],
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
