/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import {
  FOQUERY_FRAME_MESSAGE_SOURCE,
  FOQUERY_FRAME_MESSAGE_VERSION,
  FoQueryIFrameParentNode,
  type FoQueryChildFrameConnection,
  type FoQueryChildFrameOptions,
  type FoQueryFrameMessage,
  type SerializedRequestFocusOptions,
  type SerializedFoQueryNode,
} from "./iframe";
import { FoQueryRequest } from "./foquery-request";
import { RequestStatus } from "./consts";

export const FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY = "__FOQUERY_IFRAME_DEVTOOLS_METADATA__";

type DevtoolsFrameMessageType =
  | "devtools-highlight"
  | "devtools-clear-highlight"
  | "devtools-inspect";

interface DevtoolsFrameMessage {
  source: typeof FOQUERY_FRAME_MESSAGE_SOURCE;
  version: typeof FOQUERY_FRAME_MESSAGE_VERSION;
  type: DevtoolsFrameMessageType;
  frameId: string;
  xpath: string;
}

interface SerializedDevtoolsActiveElement {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
}

interface DevtoolsSerializedFoQueryNode extends SerializedFoQueryNode {
  devtoolsActiveElement?: SerializedDevtoolsActiveElement;
  children?: DevtoolsSerializedFoQueryNode[];
}

interface DevtoolsRemoteMetadata {
  activeElement?: SerializedDevtoolsActiveElement;
}

interface DevtoolsXmlElement extends Types.XmlElement {
  [FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY]?: DevtoolsRemoteMetadata;
}

let prototypePatched = false;
let requestIdCounter = 0;
const activeChildFrameConnections = new WeakMap<
  Types.FoQueryRootNode,
  FoQueryChildFrameConnection
>();

export function installFoQueryIFrameDevtools(): void {
  if (prototypePatched) return;
  prototypePatched = true;

  const originalHandleFrameMessage = FoQueryIFrameParentNode.prototype.handleFrameMessage;
  FoQueryIFrameParentNode.prototype.handleFrameMessage = function handleFrameMessageWithDevtools(
    message: FoQueryFrameMessage,
  ) {
    originalHandleFrameMessage.call(this, message);

    if (message.type === "tree-state") {
      storeRemoteDevtoolsMetadata(
        this.xmlElement as Types.XmlElement,
        message.snapshot as DevtoolsSerializedFoQueryNode,
        this.frameId,
      );
      getRootNode(this.node)?.notify(this.node);
    }
  };
}

export function connectFoQueryChildFrameDevtools(
  rootNode: Types.FoQueryRootNode,
  options?: FoQueryChildFrameOptions,
): FoQueryChildFrameConnection {
  if (activeChildFrameConnections.has(rootNode)) {
    throw new Error("FoQuery child frame root is already connected");
  }

  installFoQueryIFrameDevtools();

  const frameId = options?.frameId ?? createRequestId("foquery-frame");
  const parentOrigin = options?.parentOrigin ?? "*";
  const win = rootNode.root.window;
  const originalRequestFocus = rootNode.requestFocus.bind(rootNode);
  const originalRootRequestFocus = rootNode.root.requestFocus;
  const pendingRequests = new Map<string, FoQueryFrameRequest>();
  let readyTreeStateTimeout: ReturnType<typeof setTimeout> | undefined;
  let readyTreeStateInterval: ReturnType<typeof setInterval> | undefined;
  let focusTreeStateTimeout: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const postTreeState = () => {
    win.parent.postMessage(
      {
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "tree-state",
        frameId,
        snapshot: serializeFoQueryDevtoolsTree(rootNode.root.xmlElement),
      },
      parentOrigin,
    );
  };

  const requestFocus = (xpath: string, requestOptions?: Types.RequestFocusOptions) => {
    const request = new FoQueryFrameRequest(xpath);
    pendingRequests.set(request.requestId, request);
    win.parent.postMessage(
      {
        source: FOQUERY_FRAME_MESSAGE_SOURCE,
        version: FOQUERY_FRAME_MESSAGE_VERSION,
        type: "request-focus",
        frameId,
        requestId: request.requestId,
        xpath,
        options: serializeRequestFocusOptions(requestOptions),
      },
      parentOrigin,
    );
    request.promise.finally(() => {
      pendingRequests.delete(request.requestId);
    });
    return request;
  };

  const scheduleFocusTreeState = () => {
    if (focusTreeStateTimeout !== undefined) {
      clearTimeout(focusTreeStateTimeout);
    }
    focusTreeStateTimeout = setTimeout(() => {
      focusTreeStateTimeout = undefined;
      postTreeState();
    }, 0);
  };

  const onMessage = (event: MessageEvent) => {
    const message = parseFrameMessage(event.data);
    if (!message || message.frameId !== frameId) return;
    if (parentOrigin !== "*" && event.origin !== parentOrigin) return;

    if (message.type === "delegate-focus") {
      const localRequest = new FoQueryRequest(message.xpath, rootNode.root, message.options, {
        skipAppCoordination: true,
      });
      localRequest.promise.then((status) => {
        win.parent.postMessage(
          {
            source: FOQUERY_FRAME_MESSAGE_SOURCE,
            version: FOQUERY_FRAME_MESSAGE_VERSION,
            type: "focus-result",
            frameId,
            requestId: message.requestId,
            status,
          },
          parentOrigin,
        );
      });
    } else if (message.type === "child-ready") {
      postTreeState();
    } else if (message.type === "focus-result") {
      pendingRequests.get(message.requestId)?.complete(message.status);
      pendingRequests.delete(message.requestId);
    } else if (message.type === "devtools-highlight") {
      highlightDevtoolsTarget(rootNode, message.xpath);
    } else if (message.type === "devtools-clear-highlight") {
      clearDevtoolsTarget(rootNode, message.xpath);
    } else if (message.type === "devtools-inspect") {
      inspectDevtoolsTarget(rootNode, message.xpath);
    }
  };

  win.addEventListener("message", onMessage);
  win.document.addEventListener("focusin", scheduleFocusTreeState, true);
  const unsubscribe = rootNode.root.subscribe(postTreeState);

  rootNode.requestFocus = requestFocus;
  rootNode.root.requestFocus = requestFocus;

  win.parent.postMessage(
    {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type: "child-ready",
      frameId,
    },
    parentOrigin,
  );
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
      win.document.removeEventListener("focusin", scheduleFocusTreeState, true);
      unsubscribe();
      if (readyTreeStateTimeout !== undefined) {
        clearTimeout(readyTreeStateTimeout);
        readyTreeStateTimeout = undefined;
      }
      if (readyTreeStateInterval !== undefined) {
        clearInterval(readyTreeStateInterval);
        readyTreeStateInterval = undefined;
      }
      if (focusTreeStateTimeout !== undefined) {
        clearTimeout(focusTreeStateTimeout);
        focusTreeStateTimeout = undefined;
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

function serializeFoQueryDevtoolsTree(xmlElement: Types.XmlElement): DevtoolsSerializedFoQueryNode {
  const type = xmlElement.getAttribute("type") === "leaf" ? "leaf" : "parent";
  const lastFocusedAttr = xmlElement.getAttribute("lastFocused");
  const lastFocused = lastFocusedAttr === null ? undefined : Number(lastFocusedAttr);
  const activeElement = getSerializedActiveElement(xmlElement);

  return {
    type,
    name: xmlElement.tagName,
    lastFocused: Number.isFinite(lastFocused) ? lastFocused : undefined,
    devtoolsActiveElement: activeElement,
    iframe: xmlElement.getAttribute("foquery-iframe") === "true",
    children: Array.from(xmlElement.children).map((child) =>
      serializeFoQueryDevtoolsTree(child as Types.XmlElement),
    ),
  };
}

function getSerializedActiveElement(
  xmlElement: Types.XmlElement,
): SerializedDevtoolsActiveElement | undefined {
  const remoteRef = xmlElement.foQueryRemoteFrameRef;
  const remoteActiveElement = getDevtoolsRemoteMetadata(xmlElement)?.activeElement;
  if (remoteActiveElement && remoteRef) {
    const iframe = remoteRef.iframeElement.deref();
    if (iframe?.ownerDocument.activeElement === iframe) return remoteActiveElement;
  }

  const leafElement = xmlElement.foQueryLeafNode?.element.deref();
  if (!leafElement || leafElement.ownerDocument.activeElement !== leafElement) return undefined;

  return serializeActiveElement(leafElement);
}

function serializeActiveElement(element: HTMLElement): SerializedDevtoolsActiveElement {
  const className = typeof element.className === "string" ? element.className : undefined;
  const text = (element.textContent ?? "").trim().substring(0, 40) || undefined;
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    className: className || undefined,
    text,
  };
}

function storeRemoteDevtoolsMetadata(
  frameElement: Types.XmlElement,
  snapshot: DevtoolsSerializedFoQueryNode,
  frameId: string,
): void {
  const remoteChildren = Array.from(frameElement.children).filter(
    (child) => (child as Types.XmlElement).foQueryRemoteFrameRef?.frameId === frameId,
  ) as Types.XmlElement[];

  for (const [index, childSnapshot] of (snapshot.children ?? []).entries()) {
    const remoteChild = remoteChildren[index];
    if (remoteChild) storeRemoteNodeDevtoolsMetadata(remoteChild, childSnapshot);
  }
}

function storeRemoteNodeDevtoolsMetadata(
  xmlElement: Types.XmlElement,
  snapshot: DevtoolsSerializedFoQueryNode,
): void {
  const devtoolsXmlElement = xmlElement as DevtoolsXmlElement;
  if (snapshot.devtoolsActiveElement) {
    devtoolsXmlElement[FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY] = {
      activeElement: snapshot.devtoolsActiveElement,
    };
  } else {
    delete devtoolsXmlElement[FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY];
  }

  const childElements = Array.from(xmlElement.children) as Types.XmlElement[];
  for (const [index, childSnapshot] of (snapshot.children ?? []).entries()) {
    const childElement = childElements[index];
    if (childElement) storeRemoteNodeDevtoolsMetadata(childElement, childSnapshot);
  }
}

function getDevtoolsRemoteMetadata(
  xmlElement: Types.XmlElement,
): DevtoolsRemoteMetadata | undefined {
  return (xmlElement as DevtoolsXmlElement)[FOQUERY_IFRAME_DEVTOOLS_METADATA_KEY];
}

function getRootNode(node: Types.ParentNode): Types.RootNode | undefined {
  let current = node;
  while (current.parent) current = current.parent;
  return "notify" in current ? (current as Types.RootNode) : undefined;
}

function highlightDevtoolsTarget(rootNode: Types.FoQueryRootNode, xpath: string): void {
  const target = rootNode.query(xpath)[0];
  if (!target) return;

  const remoteRef = target.foQueryRemoteFrameRef;
  if (remoteRef && postDevtoolsMessageToRemoteFrame(remoteRef, "devtools-highlight")) return;

  const element = getLocalDevtoolsTarget(target);
  if (!element) return;

  clearDevtoolsHighlight(rootNode.root.window);
  const hadStyle = element.hasAttribute("style");
  const savedStyle = element.getAttribute("style") ?? "";
  element.setAttribute(
    "style",
    `${savedStyle}${savedStyle ? "; " : ""}outline: 2px solid #38bdf8; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.25);`,
  );
  element.scrollIntoView({ block: "nearest", behavior: "smooth" });
  (rootNode.root.window as unknown as Record<string, unknown>).__FOQUERY_DEVTOOLS_HIGHLIGHT__ = {
    element,
    hadStyle,
    savedStyle,
  };
}

function clearDevtoolsTarget(rootNode: Types.FoQueryRootNode, xpath: string): void {
  const target = rootNode.query(xpath)[0];
  const remoteRef = target?.foQueryRemoteFrameRef;
  if (remoteRef) {
    postDevtoolsMessageToRemoteFrame(remoteRef, "devtools-clear-highlight");
  }
  clearDevtoolsHighlight(rootNode.root.window);
}

function inspectDevtoolsTarget(rootNode: Types.FoQueryRootNode, xpath: string): void {
  const target = rootNode.query(xpath)[0];
  if (!target) return;

  const remoteRef = target.foQueryRemoteFrameRef;
  if (remoteRef && postDevtoolsMessageToRemoteFrame(remoteRef, "devtools-inspect")) return;

  const element = getLocalDevtoolsTarget(target);
  if (!element) return;

  const inspect = (rootNode.root.window as unknown as { inspect?: (element: Element) => void })
    .inspect;
  inspect?.(element);
}

function postDevtoolsMessageToRemoteFrame(
  remoteRef: Types.RemoteFrameRef,
  type: DevtoolsFrameMessageType,
): boolean {
  const iframe = remoteRef.iframeElement.deref();
  const childWindow = iframe?.contentWindow;
  if (!childWindow) return false;

  childWindow.postMessage(
    {
      source: FOQUERY_FRAME_MESSAGE_SOURCE,
      version: FOQUERY_FRAME_MESSAGE_VERSION,
      type,
      frameId: remoteRef.frameId,
      xpath: remoteRef.childXPath,
    } satisfies DevtoolsFrameMessage,
    remoteRef.targetOrigin,
  );
  return true;
}

function getLocalDevtoolsTarget(xmlElement: Types.XmlElement): HTMLElement | undefined {
  if (xmlElement.foQueryLeafNode) {
    return xmlElement.foQueryLeafNode.element.deref();
  }
  return xmlElement.foQueryRemoteFrameRef?.iframeElement.deref();
}

function clearDevtoolsHighlight(win: Window & typeof globalThis): void {
  const state = (win as unknown as Record<string, unknown>).__FOQUERY_DEVTOOLS_HIGHLIGHT__ as
    | { element?: Element; hadStyle?: boolean; savedStyle?: string }
    | undefined;
  const element = state?.element;
  if (element?.removeAttribute) {
    if (state.hadStyle) element.setAttribute("style", state.savedStyle ?? "");
    else element.removeAttribute("style");
  }
  (win as unknown as Record<string, unknown>).__FOQUERY_DEVTOOLS_HIGHLIGHT__ = undefined;
}

function parseFrameMessage(data: unknown): FoQueryFrameMessage | DevtoolsFrameMessage | undefined {
  if (!data || typeof data !== "object") return undefined;
  const message = data as Partial<FoQueryFrameMessage | DevtoolsFrameMessage>;
  if (message.source !== FOQUERY_FRAME_MESSAGE_SOURCE) return undefined;
  if (message.version !== FOQUERY_FRAME_MESSAGE_VERSION) return undefined;
  if (typeof message.frameId !== "string") return undefined;
  if (typeof message.type !== "string") return undefined;
  return message as FoQueryFrameMessage | DevtoolsFrameMessage;
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

function createRequestId(prefix: string): string {
  requestIdCounter += 1;
  return `${prefix}-${requestIdCounter}`;
}

class FoQueryFrameRequest implements Types.Request {
  private _resolve: ((status: Types.RequestStatus) => void) | undefined;

  public readonly requestId = createRequestId("foquery-request");
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
