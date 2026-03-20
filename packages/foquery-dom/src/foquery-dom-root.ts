/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import type { Types } from "foquery";
import { FoQueryRootNode, FoQueryParentNode, FoQueryLeafNode } from "foquery";
import { FoQueryDOMParent, FoQueryDOMLeaf } from "./foquery-dom-parent";

const ROOT_ATTR = "data-foquery-root";
const PARENT_ATTR = "data-foquery-parent";

export class FoQueryDOMRoot {
  private _rootNode: FoQueryRootNode;
  private _element: HTMLElement;
  private _observer: MutationObserver;
  private _disposed = false;

  public readonly root: Types.RootNode;

  constructor(element: HTMLElement, rootName?: string) {
    this._element = element;
    this._rootNode = new FoQueryRootNode(rootName);
    this.root = this._rootNode.root;

    element.setAttribute(ROOT_ATTR, rootName ?? "Root");
    (element as HTMLElement & { __foQueryRoot: FoQueryDOMRoot }).__foQueryRoot = this;

    this._observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.removedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            this._handleRemovedSubtree(node);
          }
        });
      }
    });

    this._observer.observe(element, { childList: true, subtree: true });
  }

  public appendParent(
    element: HTMLElement,
    name: string,
    focus?: string | (() => Promise<boolean>),
  ): FoQueryDOMParent {
    const child = new FoQueryParentNode(name, this.root, focus ? { focus } : undefined);
    this._rootNode.appendParent(child);
    return new FoQueryDOMParent(element, child, this.root);
  }

  public appendLeaf(
    element: HTMLElement,
    names: string[],
    focus?: () => Promise<boolean>,
  ): FoQueryDOMLeaf {
    const leaf = new FoQueryLeafNode(names, this.root, focus);
    this._rootNode.appendLeaf(leaf, element);
    return new FoQueryDOMLeaf(element, leaf);
  }

  private _handleRemovedSubtree(element: HTMLElement): void {
    if (element.hasAttribute(PARENT_ATTR)) {
      this._detachParentElement(element);
    }
    element.querySelectorAll(`[${PARENT_ATTR}]`).forEach((parentEl) => {
      this._detachParentElement(parentEl as HTMLElement);
    });
  }

  private _detachParentElement(element: HTMLElement): void {
    const binding = (element as HTMLElement & { __foQueryParent?: { remove: () => void } })
      .__foQueryParent;
    if (binding) {
      binding.remove();
    }
  }

  public query(xpath: string): Types.XmlElement[] {
    return this._rootNode.query(xpath);
  }

  public requestFocus(
    xpath: string,
    options?: Types.RequestFocusOptions,
  ): import("foquery").FoQueryRequest {
    return this._rootNode.requestFocus(xpath, options);
  }

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._observer.disconnect();
    this._element.removeAttribute(ROOT_ATTR);
    delete (this._element as HTMLElement & { __foQueryRoot?: FoQueryDOMRoot }).__foQueryRoot;
  }
}
