/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { FoQueryLeafNode } from "./foquery-leaf-node";
import { FoQueryRequest } from "./foquery-request";
import { evaluateXPath } from "./xpath-eval";

export class FoQueryParentNode implements Types.FoQueryParentNode {
  private _root: Types.RootNode;
  private _attached = false;
  private _xmlElement: Types.XmlElement;

  public readonly node: Types.ParentNode;

  public get xmlElement(): Element {
    return this._xmlElement;
  }

  constructor(
    name: string,
    root: Types.RootNode,
    options?: {
      focus?: string;
      arbiter?: (candidates: Types.XmlElement[]) => Types.XmlElement;
    },
  ) {
    this._root = root;

    const xmlElement: Types.XmlElement = root.xmlDoc.createElement(name);
    xmlElement.setAttribute("type", "parent");

    this._xmlElement = xmlElement;

    xmlElement.foQueryParentInst = this;
    xmlElement.foQueryParentNode = this.node = {
      xmlElement,
      name,
      parent: undefined,
      children: new Set(),
      leafs: new Set(),
      focus: options?.focus,
      arbiter: options?.arbiter,
      checkCallbacks: new Set(),
      lastFocused: undefined,
    };
  }

  public appendParent(child: FoQueryParentNode): void {
    child._attach(this.node);
  }

  public appendLeaf(leaf: FoQueryLeafNode, element: HTMLElement): void {
    leaf._attach(this.node, element);
  }

  public query(xpath: string): Types.XmlElement[] {
    return evaluateXPath(this._root.xmlDoc, this._xmlElement, xpath);
  }

  public requestFocus(xpath: string, options?: Types.RequestFocusOptions): FoQueryRequest {
    return new FoQueryRequest(xpath, this.node, options);
  }

  public registerCheck(callback: Types.CheckCallback): () => void {
    this.node.checkCallbacks.add(callback);
    return () => {
      this.node.checkCallbacks.delete(callback);
    };
  }

  public rename(name: string): void {
    if (this.node.name === name) return;

    this.node.name = name;

    const newXmlElement: Types.XmlElement = this._root.xmlDoc.createElement(name);
    newXmlElement.setAttribute("type", "parent");
    if (this.node.lastFocused !== undefined) {
      newXmlElement.setAttribute("lastFocused", this.node.lastFocused.toString());
    }
    newXmlElement.foQueryParentNode = this.node;
    newXmlElement.foQueryParentInst = this;

    while (this._xmlElement.firstChild) {
      newXmlElement.appendChild(this._xmlElement.firstChild);
    }

    if (this._xmlElement.parentNode) {
      this._xmlElement.parentNode.replaceChild(newXmlElement, this._xmlElement);
    }

    delete this._xmlElement.foQueryParentNode;
    delete this._xmlElement.foQueryParentInst;
    this._xmlElement = newXmlElement;
    this.node.xmlElement = newXmlElement;

    this._root.notify(this.node);
  }

  /** @internal Called by parent's appendParent() or FoQueryRootNode.appendParent() */
  _attach(parent: Types.ParentNode): void {
    if (this._attached) return;
    this._attached = true;

    parent.children.add(this.node);
    this.node.parent = parent;
    parent.xmlElement.appendChild(this._xmlElement);
    this._root.notify(this.node);
  }

  public remove(): void {
    if (!this._attached) return;
    this._attached = false;

    this._xmlElement.remove();

    if (this.node.parent) {
      this.node.parent.children.delete(this.node);
    }

    this.node.parent = undefined;

    this._root.notify(this.node, true);
  }
}
