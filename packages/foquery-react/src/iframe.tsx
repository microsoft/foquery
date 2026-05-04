/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as React from "react";
import { useContext, useLayoutEffect, useMemo, useRef } from "react";
import type { Types } from "foquery";
import { FoQueryRootNode } from "foquery";
import {
  FoQueryIFrameParentNode,
  connectFoQueryChildFrame,
  type FoQueryChildFrameConnection,
} from "foquery/iframe";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";

export interface FoQueryIFrameParentProps {
  name: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  frameId?: string;
  targetOrigin?: string;
  verifySource?: boolean;
  focus?: string;
  arbiter?: (candidates: Types.XmlElement[]) => Types.XmlElement;
  children?: React.ReactNode;
}

export function FoQueryIFrameParent({
  name,
  iframeRef,
  frameId,
  targetOrigin,
  verifySource,
  focus,
  arbiter,
  children,
}: FoQueryIFrameParentProps) {
  const parentContext = useContext(FoQueryContext);
  const coreNodeRef = useRef<FoQueryIFrameParentNode | null>(null);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !parentContext || coreNodeRef.current) return;

    const coreNode = new FoQueryIFrameParentNode(name, parentContext.root, iframe, {
      frameId,
      targetOrigin,
      verifySource,
      focus,
      arbiter,
    });
    coreNodeRef.current = coreNode;
    parentContext.appendParent(coreNode);

    return () => {
      coreNode.remove();
      coreNodeRef.current = null;
    };
  }, [arbiter, focus, frameId, iframeRef, name, parentContext, targetOrigin, verifySource]);

  useLayoutEffect(() => {
    const coreNode = coreNodeRef.current;
    if (!coreNode) return;
    coreNode.rename(name);
    coreNode.node.focus = focus;
    coreNode.node.arbiter = arbiter;
  }, [arbiter, focus, name]);

  return <>{children}</>;
}

export interface FoQueryFrameProviderProps {
  window: Window & typeof globalThis;
  rootName?: string;
  frameId?: string;
  parentOrigin?: string;
  children: React.ReactNode;
}

export function FoQueryFrameProvider({
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
