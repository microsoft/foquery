/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryRequest } from "./foquery-request";
import { RequestStatus } from "./consts";

export const FOQUERY_FRAME_MESSAGE_SOURCE = "foquery";
export const FOQUERY_FRAME_MESSAGE_VERSION = 1;

type SerializedNodeType = "parent" | "leaf";

export interface SerializedFoQueryNode {
  type: SerializedNodeType;
  name: string;
  lastFocused?: number;
  iframe?: boolean;
  children?: SerializedFoQueryNode[];
}

export interface SerializedRequestFocusOptions {
  timeout?: number;
  focusOptions?: FocusOptions;
}

export type FoQueryFrameMessage =
  | {
      source: typeof FOQUERY_FRAME_MESSAGE_SOURCE;
      version: typeof FOQUERY_FRAME_MESSAGE_VERSION;
      type: "child-ready";
      frameId: string;
    }
  | {
      source: typeof FOQUERY_FRAME_MESSAGE_SOURCE;
      version: typeof FOQUERY_FRAME_MESSAGE_VERSION;
      type: "tree-state";
      frameId: string;
      snapshot: SerializedFoQueryNode;
    }
  | {
      source: typeof FOQUERY_FRAME_MESSAGE_SOURCE;
      version: typeof FOQUERY_FRAME_MESSAGE_VERSION;
      type: "request-focus";
      frameId: string;
      requestId: string;
      xpath: string;
      options?: SerializedRequestFocusOptions;
    }
  | {
      source: typeof FOQUERY_FRAME_MESSAGE_SOURCE;
      version: typeof FOQUERY_FRAME_MESSAGE_VERSION;
      type: "delegate-focus";
      frameId: string;
      requestId: string;
      xpath: string;
      options?: SerializedRequestFocusOptions;
    }
  | {
      source: typeof FOQUERY_FRAME_MESSAGE_SOURCE;
      version: typeof FOQUERY_FRAME_MESSAGE_VERSION;
      type: "focus-result";
      frameId: string;
      requestId: string;
      status: Types.RequestStatus;
    };

export interface FoQueryIFrameParentOptions {
  frameId?: string;
  targetOrigin?: string;
  verifySource?: boolean;
  arbiter?: (candidates: Types.XmlElement[]) => Types.XmlElement;
  focus?: string;
}

export interface FoQueryChildFrameOptions {
  frameId?: string;
  parentOrigin?: string;
}

export interface FoQueryChildFrameConnection {
  readonly frameId: string;
  readonly rootNode: Types.FoQueryRootNode;
  requestFocus(xpath: string, options?: Types.RequestFocusOptions): Types.Request;
  dispose(): void;
}

const REMOTE_FRAME_ID_ATTR = "foquery-remote-frame-id";
let frameIdCounter = 0;
let requestIdCounter = 0;
const activeChildFrameConnections = new WeakMap<
  Types.FoQueryRootNode,
  FoQueryChildFrameConnection
>();

export class FoQueryIFrameParentNode extends FoQueryParentNode {
  private readonly _frameRoot: Types.RootNode;
  private readonly _targetOrigin: string;
  private readonly _verifySource: boolean;
  private readonly _pendingRequests = new Map<string, FoQueryFrameRequest>();
  private readonly _onMessage: (event: MessageEvent) => void;

  public readonly iframe: HTMLIFrameElement;
  public readonly frameId: string;

  constructor(
    name: string,
    root: Types.RootNode,
    iframe: HTMLIFrameElement,
    options?: FoQueryIFrameParentOptions,
  ) {
    super(name, root, options);
    this._frameRoot = root;
    this.iframe = iframe;
    this.frameId = options?.frameId ?? createFrameId();
    this._targetOrigin = options?.targetOrigin ?? "*";
    this._verifySource = options?.verifySource ?? true;

    this.xmlElement.setAttribute("foquery-iframe", "true");
    (this.xmlElement as Types.XmlElement).foQueryIFrameParentNode = this.node;
    this.node.iframeDelegateFocus = (xpath, requestOptions) =>
      this._delegateFocus(xpath, requestOptions);

    this._onMessage = (event) => {
      this._handleMessage(event);
    };
    this._frameRoot.window.addEventListener("message", this._onMessage);
  }

  public override rename(name: string): void {
    super.rename(name);
    this.xmlElement.setAttribute("foquery-iframe", "true");
    (this.xmlElement as Types.XmlElement).foQueryIFrameParentNode = this.node;
  }

  public override remove(): void {
    this.dispose();
    super.remove();
  }

  public dispose(): void {
    this._frameRoot.window.removeEventListener("message", this._onMessage);
    this._pendingRequests.forEach((request) => request.cancel());
    this._pendingRequests.clear();
    this.node.iframeDelegateFocus = undefined;
  }

  private _handleMessage(event: MessageEvent): void {
    const message = parseFoQueryFrameMessage(event.data);
    if (!message || message.frameId !== this.frameId) return;
    if (!this._acceptsOrigin(event.origin)) return;
    if (
      this._verifySource &&
      this.iframe.contentWindow &&
      event.source !== this.iframe.contentWindow
    )
      return;

    if (message.type === "tree-state") {
      this.handleFrameMessage(message);
    } else if (message.type === "focus-result") {
      this.handleFrameMessage(message);
    } else if (message.type === "request-focus") {
      this.handleFrameMessage(message);
    }
  }

  public handleFrameMessage(message: FoQueryFrameMessage): void {
    if (message.frameId !== this.frameId) return;

    if (message.type === "tree-state") {
      this._importSnapshot(message.snapshot);
    } else if (message.type === "focus-result") {
      this._pendingRequests.get(message.requestId)?.complete(message.status);
      this._pendingRequests.delete(message.requestId);
    } else if (message.type === "request-focus") {
      this._handleChildRequestFocus(message);
    }
  }

  private _acceptsOrigin(origin: string): boolean {
    return this._targetOrigin === "*" || origin === this._targetOrigin;
  }

  private _importSnapshot(snapshot: SerializedFoQueryNode): void {
    this._removeRemoteSnapshot();

    for (const child of snapshot.children ?? []) {
      this.xmlElement.appendChild(this._createRemoteElement(child, []));
    }

    this._frameRoot.notify(this.node);
  }

  private _removeRemoteSnapshot(): void {
    this.xmlElement
      .querySelectorAll(`[${REMOTE_FRAME_ID_ATTR}="${this.frameId}"]`)
      .forEach((node) => node.remove());
  }

  private _createRemoteElement(
    node: SerializedFoQueryNode,
    parentSegments: string[],
  ): Types.XmlElement {
    const xmlElement = this._frameRoot.xmlDoc.createElement(node.name) as Types.XmlElement;
    const segments = [...parentSegments, node.name];
    const childXPath = `//${segments.join("/")}`;

    xmlElement.setAttribute("type", node.type);
    xmlElement.setAttribute(REMOTE_FRAME_ID_ATTR, this.frameId);
    if (node.iframe) {
      xmlElement.setAttribute("foquery-iframe", "true");
    }
    if (node.lastFocused !== undefined) {
      xmlElement.setAttribute("lastFocused", node.lastFocused.toString());
    }

    xmlElement.foQueryRemoteFrameRef = {
      iframeParentNode: this.node,
      iframeElement: new WeakRef(this.iframe),
      frameId: this.frameId,
      targetOrigin: this._targetOrigin,
      childXPath,
      leaf: node.type === "leaf",
      lastFocused: node.lastFocused,
    };

    for (const child of node.children ?? []) {
      xmlElement.appendChild(this._createRemoteElement(child, segments));
    }

    return xmlElement;
  }

  private _delegateFocus(xpath: string, options?: Types.RequestFocusOptions): Types.Request {
    const request = new FoQueryFrameRequest(xpath);
    this._pendingRequests.set(request.requestId, request);

    this._postToChild({
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "delegate-focus",
      frameId: this.frameId,
      requestId: request.requestId,
      xpath,
      options: serializeRequestFocusOptions(options),
    });

    request.promise.finally(() => {
      this._pendingRequests.delete(request.requestId);
    });

    return request;
  }

  private _handleChildRequestFocus(
    message: Extract<FoQueryFrameMessage, { type: "request-focus" }>,
  ): void {
    const coordinatedXPath = isFrameLocalXPath(this.xmlElement, message.xpath)
      ? joinFrameXPath(getNodeXPath(this.node), message.xpath)
      : message.xpath;
    const coordinatedRequest =
      this._frameRoot.requestFocus?.(coordinatedXPath, message.options) ??
      new FoQueryRequest(coordinatedXPath, this._frameRoot, message.options);
    coordinatedRequest.promise.then((status) => {
      this._postToChild({
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "focus-result",
        frameId: this.frameId,
        requestId: message.requestId,
        status,
      });
    });
  }

  private _postToChild(message: FoQueryFrameMessage): void {
    const childWindow = this.iframe.contentWindow;
    if (!childWindow) return;

    childWindow.postMessage(message, this._targetOrigin);
  }
}

export function connectFoQueryChildFrame(
  rootNode: Types.FoQueryRootNode,
  options?: FoQueryChildFrameOptions,
): FoQueryChildFrameConnection {
  if (activeChildFrameConnections.has(rootNode)) {
    throw new Error("FoQuery child frame root is already connected");
  }

  const frameId = options?.frameId ?? createFrameId();
  const parentOrigin = options?.parentOrigin ?? "*";
  const win = rootNode.root.window;
  const originalRequestFocus = rootNode.requestFocus.bind(rootNode);
  const originalRootRequestFocus = rootNode.root.requestFocus;
  const pendingRequests = new Map<string, FoQueryFrameRequest>();
  let readyTreeStateTimeout: ReturnType<typeof setTimeout> | undefined;
  let readyTreeStateInterval: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  const postToParent = (message: FoQueryFrameMessage) => {
    win.parent.postMessage(message, parentOrigin);
  };

  const postTreeState = () => {
    postToParent({
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "tree-state",
      frameId,
      snapshot: serializeFoQueryTree(rootNode.root.xmlElement),
    });
  };

  const requestFocus = (xpath: string, requestOptions?: Types.RequestFocusOptions) => {
    const request = new FoQueryFrameRequest(xpath);
    pendingRequests.set(request.requestId, request);
    postToParent({
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "request-focus",
      frameId,
      requestId: request.requestId,
      xpath,
      options: serializeRequestFocusOptions(requestOptions),
    });
    request.promise.finally(() => {
      pendingRequests.delete(request.requestId);
    });
    return request;
  };

  const onMessage = (event: MessageEvent) => {
    const message = parseFoQueryFrameMessage(event.data);
    if (!message || message.frameId !== frameId) return;
    if (parentOrigin !== "*" && event.origin !== parentOrigin) return;

    if (message.type === "delegate-focus") {
      const localRequest = new FoQueryRequest(message.xpath, rootNode.root, message.options, {
        skipAppCoordination: true,
      });
      localRequest.promise.then((status) => {
        postToParent({
          source: FOQUERY_FRAME_MESSAGE_SOURCE,
          version: FOQUERY_FRAME_MESSAGE_VERSION,
          type: "focus-result",
          frameId,
          requestId: message.requestId,
          status,
        });
      });
    } else if (message.type === "child-ready") {
      postTreeState();
    } else if (message.type === "focus-result") {
      pendingRequests.get(message.requestId)?.complete(message.status);
      pendingRequests.delete(message.requestId);
    }
  };

  win.addEventListener("message", onMessage);
  const unsubscribe = rootNode.root.subscribe(postTreeState);

  rootNode.requestFocus = requestFocus;
  rootNode.root.requestFocus = requestFocus;

  postToParent({
    source: FOQUERY_FRAME_MESSAGE_SOURCE,
    version: FOQUERY_FRAME_MESSAGE_VERSION,
    type: "child-ready",
    frameId,
  });
  postTreeState();
  readyTreeStateTimeout = setTimeout(postTreeState, 0);
  let readyTreeStateRepeats = 0;
  readyTreeStateInterval = setInterval(() => {
    readyTreeStateRepeats += 1;
    postTreeState();
    if (readyTreeStateRepeats >= 5 && readyTreeStateInterval !== undefined) {
      clearInterval(readyTreeStateInterval);
      readyTreeStateInterval = undefined;
    }
  }, 50);

  const connection: FoQueryChildFrameConnection = {
    frameId,
    rootNode,
    requestFocus,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      win.removeEventListener("message", onMessage);
      unsubscribe();
      if (readyTreeStateTimeout !== undefined) {
        clearTimeout(readyTreeStateTimeout);
        readyTreeStateTimeout = undefined;
      }
      if (readyTreeStateInterval !== undefined) {
        clearInterval(readyTreeStateInterval);
        readyTreeStateInterval = undefined;
      }
      rootNode.requestFocus = originalRequestFocus;
      rootNode.root.requestFocus = originalRootRequestFocus;
      pendingRequests.forEach((request) => request.cancel());
      pendingRequests.clear();
      if (activeChildFrameConnections.get(rootNode) === connection) {
        activeChildFrameConnections.delete(rootNode);
      }
    },
  };

  activeChildFrameConnections.set(rootNode, connection);

  return connection;
}

export function serializeFoQueryTree(xmlElement: Types.XmlElement): SerializedFoQueryNode {
  const type = xmlElement.getAttribute("type") === "leaf" ? "leaf" : "parent";
  const lastFocusedAttr = xmlElement.getAttribute("lastFocused");
  const lastFocused = lastFocusedAttr === null ? undefined : Number(lastFocusedAttr);

  return {
    type,
    name: xmlElement.tagName,
    lastFocused: Number.isFinite(lastFocused) ? lastFocused : undefined,
    iframe: xmlElement.getAttribute("foquery-iframe") === "true",
    children: Array.from(xmlElement.children).map((child) =>
      serializeFoQueryTree(child as Types.XmlElement),
    ),
  };
}

function parseFoQueryFrameMessage(data: unknown): FoQueryFrameMessage | undefined {
  if (!data || typeof data !== "object") return undefined;
  const message = data as Partial<FoQueryFrameMessage>;
  if (message.source !== FOQUERY_FRAME_MESSAGE_SOURCE) return undefined;
  if (message.version !== FOQUERY_FRAME_MESSAGE_VERSION) return undefined;
  if (typeof message.type !== "string") return undefined;
  if (typeof message.frameId !== "string") return undefined;
  return message as FoQueryFrameMessage;
}

function serializeRequestFocusOptions(
  options: Types.RequestFocusOptions | undefined,
): SerializedRequestFocusOptions | undefined {
  if (!options) return undefined;
  return {
    timeout: options.timeout,
    focusOptions: options.focusOptions,
  };
}

function createFrameId(): string {
  frameIdCounter += 1;
  return `foquery-frame-${frameIdCounter}`;
}

function createRequestId(): string {
  requestIdCounter += 1;
  return `foquery-request-${requestIdCounter}`;
}

function getNodeXPath(node: Types.ParentNode): string {
  const segments: string[] = [];
  for (
    let current: Types.ParentNode | undefined = node;
    current?.parent;
    current = current.parent
  ) {
    segments.unshift(current.name);
  }
  return `//${segments.join("/")}`;
}

function joinFrameXPath(frameXPath: string, childXPath: string): string {
  if (childXPath.startsWith("//")) {
    return `${frameXPath}//${childXPath.slice(2)}`;
  }
  if (childXPath.startsWith("./")) {
    return `${frameXPath}/${childXPath.slice(2)}`;
  }
  return `${frameXPath}/${childXPath}`;
}

function isFrameLocalXPath(frameElement: Element, xpath: string): boolean {
  if (xpath.startsWith("./") || !xpath.startsWith("//")) return true;

  const firstSegment = getFirstAbsoluteXPathSegment(xpath);
  if (!firstSegment) return true;
  if (frameElement.children.length === 0) return true;

  return hasDescendantWithTagName(frameElement, firstSegment);
}

function getFirstAbsoluteXPathSegment(xpath: string): string | undefined {
  const match = /^\/\/([^/[\s]+)/.exec(xpath);
  return match?.[1];
}

function hasDescendantWithTagName(element: Element, tagName: string): boolean {
  for (const child of Array.from(element.children)) {
    if (child.tagName === tagName || hasDescendantWithTagName(child, tagName)) {
      return true;
    }
  }
  return false;
}

class FoQueryFrameRequest implements Types.Request {
  private _resolve: ((status: Types.RequestStatus) => void) | undefined;

  public readonly requestId = createRequestId();
  public readonly promise: Promise<Types.RequestStatus>;
  public readonly diagnostics = undefined;
  public status: Types.RequestStatus = RequestStatus.Waiting;

  constructor(public readonly xpath: string) {
    this.promise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  public complete(status: Types.RequestStatus): void {
    if (!this._resolve) return;
    this.status = status;
    this._resolve(status);
    this._resolve = undefined;
  }

  public cancel(): void {
    this.complete(RequestStatus.Canceled);
  }
}
