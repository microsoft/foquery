/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { FoQueryParentNode } from "./foquery-parent-node";
import { FoQueryLeafNode } from "./foquery-leaf-node";
import { FoQueryRequest } from "./foquery-request";
import { evaluateXPath } from "./xpath-eval";

export class FoQueryRootNode {
  private _subscriptions: Set<
    (parentOrLeaf: Types.ParentNode | Types.LeafNode, removed?: boolean) => void
  > = new Set();

  public readonly root: Types.RootNode;

  private _devtoolsGlobalName: string | undefined;

  constructor(
    rootName: string = "Root",
    options?: {
      arbiter?: (candidates: Types.XmlElement[]) => Types.XmlElement;
      devtools?: boolean | string;
    },
  ) {
    const arbiter = options?.arbiter;
    const xmlDoc = document.implementation.createDocument(null, rootName);

    this.root = {
      xmlDoc,
      xmlElement: xmlDoc.documentElement,
      name: rootName,
      parent: undefined,
      children: new Set(),
      leafs: new Set(),
      arbiter,
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
    };

    if (options?.devtools) {
      this._devtoolsGlobalName =
        typeof options.devtools === "string" ? options.devtools : "__FOQUERY_ROOT__";
      (globalThis as Record<string, unknown>)[this._devtoolsGlobalName] = this;
    }
  }

  public dispose(): void {
    if (this._devtoolsGlobalName) {
      delete (globalThis as Record<string, unknown>)[this._devtoolsGlobalName];
    }
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
}
