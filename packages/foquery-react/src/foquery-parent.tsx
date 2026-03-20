/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as React from "react";
import { useContext, useRef, useMemo, useLayoutEffect } from "react";
import type { Types } from "foquery";
import { FoQueryParentNode } from "foquery";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";

export interface FoQueryParentProps {
  name: string;
  focus?: string | (() => Promise<boolean>);
  arbiter?: (candidates: Types.XmlElement[]) => Types.XmlElement;
  children?: React.ReactNode;
}

export function FoQueryParent({ name, focus, arbiter, children }: FoQueryParentProps) {
  const parentContext = useContext(FoQueryContext);

  const coreNodeRef = useRef<FoQueryParentNode | null>(null);

  if (!coreNodeRef.current && parentContext) {
    coreNodeRef.current = new FoQueryParentNode(name, parentContext.root, { focus, arbiter });
  }

  const coreNode = coreNodeRef.current;

  // Attach to parent on mount, detach on unmount.
  // useLayoutEffect ensures the XML tree is built before children render effects run.
  useLayoutEffect(() => {
    if (!coreNode || !parentContext) return;

    parentContext.appendParent(coreNode);

    return () => {
      coreNode.remove();
    };
  }, [coreNode, parentContext]);

  // Update mutable properties in a layout effect (commit phase), not during render.
  useLayoutEffect(() => {
    if (!coreNode) return;

    coreNode.rename(name);
    coreNode.node.focus = focus;
    coreNode.node.arbiter = arbiter;
  }, [coreNode, name, focus, arbiter]);

  const contextProps = useMemo<FoQueryContextProps | undefined>(() => {
    if (!coreNode || !parentContext) return undefined;

    return {
      root: parentContext.root,
      node: coreNode.node,
      appendParent: (child) => coreNode.appendParent(child),
      appendLeaf: (leaf, element) => coreNode.appendLeaf(leaf, element),
      query: (xpath) => coreNode.query(xpath),
      requestFocus: (xpath, options) => coreNode.requestFocus(xpath, options),
      subscribe: parentContext.subscribe,
      notify: parentContext.notify,
    };
  }, [coreNode, parentContext]);

  return <FoQueryContext.Provider value={contextProps}>{children}</FoQueryContext.Provider>;
}
