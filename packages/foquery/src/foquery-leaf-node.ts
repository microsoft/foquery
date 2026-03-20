/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";

export class FoQueryLeafNode {
  private _root: Types.RootNode;
  private _parent: Types.ParentNode | undefined;
  private _element: HTMLElement | undefined;
  private _attached = false;
  private _focusCheckClearTimeout: (() => void) | null = null;

  public readonly leaf: Types.LeafNode;
  public readonly onFocusIn: () => void;

  constructor(names: string[], root: Types.RootNode, focus?: () => Promise<boolean>) {
    this._root = root;

    this.leaf = {
      xmlElements: new Map(),
      names,
      element: undefined!,
      parent: undefined,
      lastFocused: undefined,
      focus,
    };

    this.onFocusIn = () => {
      const lastFocused = Date.now();
      this.leaf.lastFocused = lastFocused;

      for (let p = this.leaf.parent; p; p = p.parent) {
        p.lastFocused = lastFocused;
        p.xmlElement.setAttribute("lastFocused", lastFocused.toString());
      }

      for (const xmlElement of this.leaf.xmlElements.values()) {
        xmlElement.setAttribute("lastFocused", lastFocused.toString());
      }
    };
  }

  public rename(names: string[]): void {
    if (!this._attached || !this._parent) return;

    const oldXmlElements = this.leaf.xmlElements;
    const newXmlElements = new Map<string, Types.XmlElement>();

    for (const name of names) {
      const existing = oldXmlElements.get(name);
      if (existing) {
        newXmlElements.set(name, existing);
        oldXmlElements.delete(name);
      } else {
        const xmlElement: Types.XmlElement = this._root.xmlDoc.createElement(name);
        xmlElement.setAttribute("type", "leaf");
        xmlElement.foQueryLeafNode = this.leaf;
        if (this.leaf.lastFocused !== undefined) {
          xmlElement.setAttribute("lastFocused", this.leaf.lastFocused.toString());
        }
        newXmlElements.set(name, xmlElement);
        this._parent.xmlElement.appendChild(xmlElement);
      }
    }

    oldXmlElements.forEach((xmlElement) => {
      xmlElement.remove();
      delete (xmlElement as Types.XmlElement).foQueryLeafNode;
    });

    this.leaf.names = names;
    this.leaf.xmlElements = newXmlElements;

    this._root.notify(this.leaf);
  }

  /** @internal Called by FoQueryParentNode/FoQueryRootNode.appendLeaf() */
  _attach(parent: Types.ParentNode, element: HTMLElement): void {
    if (this._attached) return;
    this._attached = true;

    this._parent = parent;
    this._element = element;
    this.leaf.element = new WeakRef(element);

    element.addEventListener("focusin", this.onFocusIn, true);

    this.leaf.parent = parent;
    parent.leafs.add(this.leaf);

    for (const name of this.leaf.names) {
      const xmlElement: Types.XmlElement = this._root.xmlDoc.createElement(name);
      xmlElement.setAttribute("type", "leaf");
      xmlElement.foQueryLeafNode = this.leaf;
      this.leaf.xmlElements.set(name, xmlElement);
      parent.xmlElement.appendChild(xmlElement);
    }

    this._root.notify(this.leaf);

    // Check if element already has focus
    const win = element.ownerDocument.defaultView;
    if (win) {
      const timeout = win.setTimeout(() => {
        if (element.contains(win.document.activeElement)) {
          this.onFocusIn();
        }
        this._focusCheckClearTimeout = null;
      }, 0);

      this._focusCheckClearTimeout = () => {
        win.clearTimeout(timeout);
        this._focusCheckClearTimeout = null;
      };
    }
  }

  public remove(): void {
    if (!this._attached) return;
    this._attached = false;

    this._focusCheckClearTimeout?.();

    this._element?.removeEventListener("focusin", this.onFocusIn, true);

    if (this._parent) {
      this._parent.leafs.delete(this.leaf);
    }

    this.leaf.parent = undefined;
    this.leaf.focus = undefined;

    this.leaf.xmlElements.forEach((xmlElement) => {
      xmlElement.remove();
      delete (xmlElement as Types.XmlElement).foQueryLeafNode;
    });
    this.leaf.xmlElements.clear();

    this._root.notify(this.leaf, true);
  }
}
