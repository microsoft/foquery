/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import type { Types } from "foquery";
import { FoQueryParentNode, FoQueryLeafNode } from "foquery";

const PARENT_ATTR = "data-foquery-parent";

export interface FoQueryDOMParentBinding {
  readonly node: Types.ParentNode;
  remove(): void;
}

export class FoQueryDOMParent {
  private _coreNode: FoQueryParentNode;
  private _root: Types.RootNode;
  private _element: HTMLElement;

  public get node(): Types.ParentNode {
    return this._coreNode.node;
  }

  /** @internal Use appendParent() on a FoQueryDOMParent or FoQueryDOMRoot instead. */
  constructor(element: HTMLElement, coreNode: FoQueryParentNode, root: Types.RootNode) {
    this._element = element;
    this._root = root;
    this._coreNode = coreNode;

    element.setAttribute(PARENT_ATTR, coreNode.node.name);

    const binding: FoQueryDOMParentBinding = {
      node: this._coreNode.node,
      remove: () => this.remove(),
    };
    (element as HTMLElement & { __foQueryParent?: FoQueryDOMParentBinding }).__foQueryParent =
      binding;
  }

  public rename(name: string): void {
    this._coreNode.rename(name);
    this._element.setAttribute(PARENT_ATTR, name);
  }

  public appendParent(
    element: HTMLElement,
    name: string,
    focus?: string | (() => Promise<boolean>),
  ): FoQueryDOMParent {
    const child = new FoQueryParentNode(name, this._root, focus ? { focus } : undefined);
    this._coreNode.appendParent(child);
    return new FoQueryDOMParent(element, child, this._root);
  }

  public appendLeaf(
    element: HTMLElement,
    names: string[],
    focus?: () => Promise<boolean>,
  ): FoQueryDOMLeaf {
    const leaf = new FoQueryLeafNode(names, this._root, focus);
    this._coreNode.appendLeaf(leaf, element);
    return new FoQueryDOMLeaf(element, leaf);
  }

  public remove(): void {
    this._coreNode.remove();

    this._element.removeAttribute(PARENT_ATTR);
    delete (this._element as HTMLElement & { __foQueryParent?: FoQueryDOMParentBinding })
      .__foQueryParent;
  }
}

export class FoQueryDOMLeaf {
  private _coreLeaf: FoQueryLeafNode;
  private _element: HTMLElement;

  public get leaf() {
    return this._coreLeaf.leaf;
  }

  /** @internal Use appendLeaf() on a FoQueryDOMParent or FoQueryDOMRoot instead. */
  constructor(element: HTMLElement, coreLeaf: FoQueryLeafNode) {
    this._element = element;
    this._coreLeaf = coreLeaf;

    element.setAttribute("data-foquery-leaf", coreLeaf.leaf.names.join(","));
    (element as HTMLElement & { __foQueryDOMLeaf?: FoQueryDOMLeaf }).__foQueryDOMLeaf = this;
  }

  public rename(names: string[]): void {
    this._coreLeaf.rename(names);
    this._element.setAttribute("data-foquery-leaf", names.join(","));
  }

  public remove(): void {
    this._coreLeaf.remove();

    this._element.removeAttribute("data-foquery-leaf");
    delete (this._element as HTMLElement & { __foQueryDOMLeaf?: FoQueryDOMLeaf }).__foQueryDOMLeaf;
  }
}
