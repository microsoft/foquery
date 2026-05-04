/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";
import { FoQueryRequest } from "./foquery-request";
import { evaluateXPath } from "./xpath-eval";

export class FoQueryRootNode implements Types.FoQueryRootNode {
  private _subscriptions: Set<
    (parentOrLeaf: Types.ParentNode | Types.LeafNode, removed?: boolean) => void
  > = new Set();

  public readonly root: Types.RootNode;

  constructor(
    win: Window & typeof globalThis,
    rootName: string = "Root",
    options?: {
      arbiter?: (candidates: Types.XmlElement[]) => Types.XmlElement;
    },
  ) {
    const arbiter = options?.arbiter;
    const xmlDoc = win.document.implementation.createDocument(null, rootName);

    this.root = {
      window: win,
      xmlDoc,
      xmlElement: xmlDoc.documentElement,
      name: rootName,
      parent: undefined,
      children: new Set(),
      leafs: new Set(),
      arbiter,
      checkCallbacks: new Set(),
      lastFocused: undefined,

      subscribe: (
        callback: (parentOrLeaf: Types.ParentNode | Types.LeafNode, removed?: boolean) => void,
      ) => {
        this._subscriptions.add(callback);

        return () => {
          this._subscriptions.delete(callback);
        };
      },

      notify: (parentOrLeaf: Types.ParentNode | Types.LeafNode, removed?: boolean) => {
        this._subscriptions.forEach((callback) => {
          callback(parentOrLeaf, removed);
        });
      },

      requestFocus: (xpath: string, requestOptions?: Types.RequestFocusOptions) =>
        this.requestFocus(xpath, requestOptions),
    };
  }

  public dispose(): void {
    // Reserved for subclasses that own disposable resources.
  }

  public appendParent(child: FoQueryParentNode): void {
    child._attach(this.root);
  }

  public appendLeaf(leaf: FoQueryLeafNode, element: HTMLElement): void {
    leaf._attach(this.root, element);
  }

  public query(xpath: string): Types.XmlElement[] {
    return evaluateXPath(this.root.xmlDoc, this.root.xmlDoc, xpath);
  }

  public requestFocus(xpath: string, options?: Types.RequestFocusOptions): FoQueryRequest {
    return new FoQueryRequest(xpath, this.root, options);
  }

  public registerCheck(callback: Types.CheckCallback): () => void {
    this.root.checkCallbacks.add(callback);
    return () => {
      this.root.checkCallbacks.delete(callback);
    };
  }
}
