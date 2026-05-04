/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as React from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { FoQueryRootNode } from "foquery";
import { connectFoQueryChildFrame, type FoQueryChildFrameConnection } from "foquery/iframe";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";
import type { FoQueryFrameProviderProps } from "./iframe";

export function FoQueryDevtoolsFrameProvider({
  window: win,
  rootName,
  frameId,
  parentOrigin,
  children,
}: FoQueryFrameProviderProps) {
  const rootNodeRef = useRef<FoQueryRootNode | null>(null);
  const connectionRef = useRef<FoQueryChildFrameConnection | null>(null);

  if (!rootNodeRef.current) {
    rootNodeRef.current = new FoQueryRootNode(win, rootName);
  }

  const rootNode = rootNodeRef.current;
  const root = rootNode.root;

  useLayoutEffect(() => {
    const connection = connectFoQueryChildFrame(rootNode, { frameId, parentOrigin });
    connectionRef.current = connection;

    return () => {
      connection.dispose();
      connectionRef.current = null;
    };
  }, [frameId, parentOrigin, rootNode]);

  const contextProps = useMemo<FoQueryContextProps>(
    () => ({
      root,
      node: root,
      appendParent: (child) => rootNode.appendParent(child),
      appendLeaf: (leaf, element) => rootNode.appendLeaf(leaf, element),
      query: (xpath) => rootNode.query(xpath),
      requestFocus: (xpath, options) =>
        connectionRef.current?.requestFocus(xpath, options) ??
        rootNode.requestFocus(xpath, options),
      subscribe: root.subscribe,
      notify: root.notify,
    }),
    [root, rootNode],
  );

  return <FoQueryContext.Provider value={contextProps}>{children}</FoQueryContext.Provider>;
}
