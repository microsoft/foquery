/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as React from "react";
import { useRef, useMemo, useEffect } from "react";
import { FoQueryRootNode } from "foquery";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";

export interface FoQueryProviderProps {
  window: Window & typeof globalThis;
  rootName?: string;
  devtools?: boolean | string;
  children: React.ReactNode;
}

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
    if (devtools) {
      const globalName = typeof devtools === "string" ? devtools : "__FOQUERY_ROOT__";
      rootNode.root.devtools = true;
      (win as unknown as Record<string, unknown>)[globalName] = rootNode;

      return () => {
        rootNode.root.devtools = false;
        delete (win as unknown as Record<string, unknown>)[globalName];
      };
    }
  }, [devtools, rootNode, win]);

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
