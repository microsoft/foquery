/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
export type CheckCallback = (element: HTMLElement) => boolean;

export interface LeafNode {
  names: string[];
  xmlElements: Map<string, XmlElement>;
  element: WeakRef<HTMLElement>;
  parent: ParentNode | undefined;
  focus?: () => boolean;
  checkCallbacks: Set<CheckCallback>;
  lastFocused: number | undefined;
}

export interface ParentNode {
  name: string;
  xmlElement: XmlElement;
  parent: ParentNode | undefined;
  children: Set<ParentNode>;
  leafs: Set<LeafNode>;
  focus?: string;
  arbiter?: (candidates: XmlElement[]) => XmlElement;
  checkCallbacks: Set<CheckCallback>;
  lastFocused: number | undefined;
}

export interface RootNode extends ParentNode {
  window: Window & typeof globalThis;
  xmlDoc: Document;
  devtools?: boolean;
  subscribe: (
    callback: (parentOrLeaf: ParentNode | LeafNode, removed?: boolean) => void,
  ) => () => void;
  notify: (parentOrLeaf: ParentNode | LeafNode, removed?: boolean) => void;
  arbiter?: (candidates: XmlElement[]) => XmlElement;
}

export interface XmlElement extends Element {
  foQueryParentNode?: ParentNode;
  foQueryParentInst?: FoQueryParentNode;
  foQueryLeafNode?: LeafNode;
}

export interface RequestFocusOptions {
  timeout?: number;
  focusOptions?: FocusOptions;
}

export interface FoQueryParentNode {
  readonly node: ParentNode;
  readonly xmlElement: Element;
  appendParent(child: FoQueryParentNode): void;
  appendLeaf(leaf: FoQueryLeafNode, element: HTMLElement): void;
  query(xpath: string): XmlElement[];
  requestFocus(xpath: string, options?: RequestFocusOptions): Request;
  registerCheck(callback: CheckCallback): () => void;
  rename(name: string): void;
  remove(): void;
}

export interface FoQueryLeafNode {
  readonly leaf: LeafNode;
  readonly onFocusIn: () => void;
  registerCheck(callback: CheckCallback): () => void;
  rename(names: string[]): void;
  remove(): void;
}

export interface FoQueryRootNode {
  readonly root: RootNode;
  dispose(): void;
  appendParent(child: FoQueryParentNode): void;
  appendLeaf(leaf: FoQueryLeafNode, element: HTMLElement): void;
  query(xpath: string): XmlElement[];
  requestFocus(xpath: string, options?: RequestFocusOptions): Request;
  registerCheck(callback: CheckCallback): () => void;
}

export interface Request {
  readonly xpath: string;
  readonly promise: Promise<RequestStatus>;
  readonly diagnostics: RequestDiagnostics | undefined;
  status: RequestStatus;
  cancel(): void;
}

export type RequestStatus = 1 | 2 | 3 | 4 | 5;

export type CancelReason = "superseded" | "user-click" | "focus-moved" | "api";

export interface RequestDiagnostics {
  startedAt: number;
  resolvedAt: number | undefined;
  cancelReason: CancelReason | undefined;
  xpath: string;
  matchedElements: XmlElement[];
  candidates: XmlElement[];
  winner: XmlElement | undefined;
  events: DiagnosticEvent[];
}

export type DiagnosticEvent =
  | { type: "partial-match"; xpath: string; timestamp: number }
  | { type: "degraded"; xpath: string; timestamp: number }
  | { type: "lost-match"; timestamp: number }
  | { type: "matched-pending-checks"; leafNames: string[]; timestamp: number }
  | { type: "checks-passed"; leafNames: string[]; timestamp: number }
  | { type: "succeeded"; timestamp: number }
  | { type: "canceled"; reason: CancelReason; timestamp: number }
  | { type: "timed-out"; timestamp: number }
  | { type: "no-candidates"; timestamp: number };
