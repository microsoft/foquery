/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { FoQueryRootNode } from "./foquery-root-node";
import { FoQueryRequest } from "./foquery-request";

export type FoQueryDevtoolsOption = boolean | string;

const devtoolsRoots = new WeakSet<Types.RootNode>();
let requestPatchInstalled = false;

export function enableFoQueryDevtools(
  rootNode: FoQueryRootNode,
  devtools: FoQueryDevtoolsOption,
): () => void {
  installFoQueryRequestDevtools();

  const globalName = typeof devtools === "string" ? devtools : "__FOQUERY_ROOT__";
  devtoolsRoots.add(rootNode.root);
  (rootNode.root.window as unknown as Record<string, unknown>)[globalName] = rootNode;

  return () => {
    devtoolsRoots.delete(rootNode.root);
    delete (rootNode.root.window as unknown as Record<string, unknown>)[globalName];
  };
}

function installFoQueryRequestDevtools(): void {
  if (requestPatchInstalled) return;
  requestPatchInstalled = true;

  const originalStart = FoQueryRequest.prototype.start;
  FoQueryRequest.prototype.start = function startWithDevtoolsActiveRequest(this: FoQueryRequest) {
    const root = (this as unknown as { _root?: Types.RootNode })._root;
    if (root && devtoolsRoots.has(root)) {
      (root.window as unknown as Record<string, unknown>).__FOQUERY_ACTIVE_REQUEST__ = this;
    }
    return originalStart.call(this);
  };
}
