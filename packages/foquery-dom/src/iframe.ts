/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import type { Types } from "foquery";
import { FoQueryIFrameParentNode, connectFoQueryChildFrame } from "foquery/iframe";
import type { FoQueryIFrameParentOptions, FoQueryChildFrameOptions } from "foquery/iframe";
import { FoQueryDOMRoot } from "./foquery-dom-root";
import { FoQueryDOMParent } from "./foquery-dom-parent";

const PARENT_ATTR = "data-foquery-parent";

interface DOMRootWithCore {
  root: Types.RootNode;
  _rootNode: { appendParent(child: FoQueryIFrameParentNode): void };
}

interface DOMParentWithCore {
  node: Types.ParentNode;
  _root: Types.RootNode;
  _coreNode: { appendParent(child: FoQueryIFrameParentNode): void };
}

export class FoQueryDOMIFrameParent {
  private readonly _coreNode: FoQueryIFrameParentNode;
  private readonly _iframe: HTMLIFrameElement;

  public get node(): Types.ParentNode {
    return this._coreNode.node;
  }

  public get iframe(): HTMLIFrameElement {
    return this._iframe;
  }

  constructor(iframe: HTMLIFrameElement, coreNode: FoQueryIFrameParentNode) {
    this._iframe = iframe;
    this._coreNode = coreNode;
    iframe.setAttribute(PARENT_ATTR, coreNode.node.name);
    iframe.setAttribute("data-foquery-iframe-parent", coreNode.frameId);
  }

  public rename(name: string): void {
    this._coreNode.rename(name);
    this._iframe.setAttribute(PARENT_ATTR, name);
  }

  public remove(): void {
    this._coreNode.remove();
    this._iframe.removeAttribute(PARENT_ATTR);
    this._iframe.removeAttribute("data-foquery-iframe-parent");
  }
}

export function appendIFrameParent(
  target: FoQueryDOMRoot | FoQueryDOMParent,
  iframe: HTMLIFrameElement,
  name: string,
  options?: FoQueryIFrameParentOptions,
): FoQueryDOMIFrameParent {
  if (target instanceof FoQueryDOMRoot) {
    const rootTarget = target as unknown as DOMRootWithCore;
    const coreNode = new FoQueryIFrameParentNode(name, rootTarget.root, iframe, options);
    rootTarget._rootNode.appendParent(coreNode);
    return new FoQueryDOMIFrameParent(iframe, coreNode);
  }

  const parentTarget = target as unknown as DOMParentWithCore;
  const coreNode = new FoQueryIFrameParentNode(name, parentTarget._root, iframe, options);
  parentTarget._coreNode.appendParent(coreNode);
  return new FoQueryDOMIFrameParent(iframe, coreNode);
}

export function connectFoQueryDOMChildFrame(
  root: FoQueryDOMRoot,
  options?: FoQueryChildFrameOptions,
) {
  const rootTarget = root as unknown as DOMRootWithCore;
  return connectFoQueryChildFrame(
    rootTarget._rootNode as Parameters<typeof connectFoQueryChildFrame>[0],
    options,
  );
}
