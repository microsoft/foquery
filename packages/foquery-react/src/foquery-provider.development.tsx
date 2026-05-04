/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as React from "react";
import { useEffect, useMemo, useRef } from "react";
import { FoQueryRootNode } from "foquery";
import { enableFoQueryDevtools } from "foquery/devtools";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";
import type { FoQueryProviderProps } from "./foquery-provider";

export function FoQueryProvider({
  window: win,
  rootName,
  devtools,
  children,
}: FoQueryProviderProps) {
  const rootNodeRef = useRef<FoQueryRootNode | null>(null);

  if (!rootNodeRef.current) {
    rootNodeRef.current = new FoQueryRootNode(win, rootName);
  }

  const rootNode = rootNodeRef.current;
  const root = rootNode.root;

  useEffect(() => {
    if (!devtools) return;
    return enableFoQueryDevtools(rootNode, devtools);
  }, [devtools, rootNode]);

  const contextProps = useMemo<FoQueryContextProps>(
    () => ({
      root,
      node: root,
      appendParent: (child) => rootNode.appendParent(child),
      appendLeaf: (leaf, element) => rootNode.appendLeaf(leaf, element),
      query: (xpath) => rootNode.query(xpath),
      requestFocus: (xpath, options) => rootNode.requestFocus(xpath, options),
      subscribe: root.subscribe,
      notify: root.notify,
    }),
    [root, rootNode],
  );

  return <FoQueryContext.Provider value={contextProps}>{children}</FoQueryContext.Provider>;
}
