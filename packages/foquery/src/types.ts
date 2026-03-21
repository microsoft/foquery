/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
export interface LeafNode {
  names: string[];
  xmlElements: Map<string, XmlElement>;
  element: WeakRef<HTMLElement>;
  parent: ParentNode | undefined;
  focus?: () => Promise<boolean>;
  lastFocused: number | undefined;
}

export interface ParentNode {
  name: string;
  xmlElement: XmlElement;
  parent: ParentNode | undefined;
  children: Set<ParentNode>;
  leafs: Set<LeafNode>;
  focus?: string | (() => Promise<boolean>);
  arbiter?: (candidates: XmlElement[]) => XmlElement;
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
}

export interface FoQueryParentNode {
  readonly node: ParentNode;
  readonly xmlElement: Element;
  appendParent(child: FoQueryParentNode): void;
  appendLeaf(leaf: FoQueryLeafNode, element: HTMLElement): void;
  query(xpath: string): XmlElement[];
  requestFocus(xpath: string, options?: RequestFocusOptions): Request;
  rename(name: string): void;
  remove(): void;
}

export interface FoQueryLeafNode {
  readonly leaf: LeafNode;
  readonly onFocusIn: () => void;
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
}

export interface Request {
  readonly xpath: string;
  readonly promise: Promise<RequestStatus>;
  readonly diagnostics: RequestDiagnostics | undefined;
  status: RequestStatus;
  cancel(): void;
}

export type RequestStatus = 1 | 2 | 3 | 4 | 5;

export interface RequestDiagnostics {
  startedAt: number;
  resolvedAt: number | undefined;
  xpath: string;
  matchedElements: XmlElement[];
  candidates: XmlElement[];
  winner: XmlElement | undefined;
  progressiveMatches: ProgressiveMatch[];
}

export interface ProgressiveMatch {
  xpath: string;
  matched: boolean;
  timestamp: number;
  degraded?: boolean;
}
