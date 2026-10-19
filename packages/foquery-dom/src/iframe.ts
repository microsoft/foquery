/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import type { Types } from "foquery";
import { FoQueryIFrameParentNode, connectFoQueryChildFrame } from "foquery/iframe";
import type { FoQueryIFrameParentOptions, FoQueryChildFrameOptions } from "foquery/iframe";
import { FoQueryDOMRoot } from "./foquery-dom-root";
import { FoQueryDOMParent, type FoQueryDOMParentBinding } from "./foquery-dom-parent";

const PARENT_ATTR = "data-foquery-parent";
const FRAME_ID_ATTR = "data-foquery-iframe-parent";

type IFrameWithBinding = HTMLIFrameElement & { __foQueryParent?: FoQueryDOMParentBinding };

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
  private _unsubscribe: (() => void) | undefined;

  public get node(): Types.ParentNode {
    return this._coreNode.node;
  }

  public get iframe(): HTMLIFrameElement {
    return this._iframe;
  }

  constructor(iframe: HTMLIFrameElement, coreNode: FoQueryIFrameParentNode, root?: Types.RootNode) {
    this._iframe = iframe;
    this._coreNode = coreNode;
    iframe.setAttribute(PARENT_ATTR, coreNode.node.name);
    iframe.setAttribute(FRAME_ID_ATTR, coreNode.frameId);
    // Without an explicit frameId the core node adopts the one announced by the child.
    this._unsubscribe = root?.subscribe((changed) => {
      if (changed === coreNode.node && iframe.getAttribute(FRAME_ID_ATTR) !== coreNode.frameId) {
        iframe.setAttribute(FRAME_ID_ATTR, coreNode.frameId);
      }
    });
    // Lets FoQueryDOMRoot's MutationObserver clean this node up when the iframe is removed.
    (iframe as IFrameWithBinding).__foQueryParent = {
      node: coreNode.node,
      remove: () => this.remove(),
    };
  }

  public rename(name: string): void {
    this._coreNode.rename(name);
    this._iframe.setAttribute(PARENT_ATTR, name);
  }

  public get frameId(): string {
    return this._coreNode.frameId;
  }

  public remove(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._coreNode.remove();
    this._iframe.removeAttribute(PARENT_ATTR);
    this._iframe.removeAttribute(FRAME_ID_ATTR);
    if ((this._iframe as IFrameWithBinding).__foQueryParent?.node === this._coreNode.node) {
      delete (this._iframe as IFrameWithBinding).__foQueryParent;
    }
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
    return new FoQueryDOMIFrameParent(iframe, coreNode, rootTarget.root);
  }

  const parentTarget = target as unknown as DOMParentWithCore;
  const coreNode = new FoQueryIFrameParentNode(name, parentTarget._root, iframe, options);
  parentTarget._coreNode.appendParent(coreNode);
  return new FoQueryDOMIFrameParent(iframe, coreNode, parentTarget._root);
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
