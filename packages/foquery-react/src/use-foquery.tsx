/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { useContext, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { FoQueryLeafNode } from "foquery";
import { FoQueryContext } from "./foquery-context";

export function useFoQuery<T extends HTMLElement>(
  names: string[],
  focus?: () => boolean,
): React.RefCallback<T> {
  const foQueryContextProps = useContext(FoQueryContext);
  const leafNodeRef = useRef<FoQueryLeafNode | null>(null);
  const elementRef = useRef<T | null>(null);
  const namesRef = useRef(names);
  const focusRef = useRef(focus);

  // Keep refs current without triggering re-renders or side effects during render
  namesRef.current = names;
  focusRef.current = focus;

  // Stable key for names array
  const namesKey = useMemo(() => names.join(","), [names]);

  // Update mutable leaf properties in commit phase when names/focus change
  useLayoutEffect(() => {
    const leafNode = leafNodeRef.current;
    if (!leafNode) return;

    leafNode.leaf.names = names;
    leafNode.leaf.focus = focus;

    leafNode.rename(names);
  }, [namesKey, focus, names]);

  // Cleanup on unmount
  useLayoutEffect(() => {
    return () => {
      leafNodeRef.current?.remove();
      leafNodeRef.current = null;
    };
  }, []);

  const refCallback = useCallback(
    (element: T | null) => {
      const currentElement = elementRef.current;
      const currentLeafNode = leafNodeRef.current;

      // Element removed
      if (!element && currentElement) {
        currentLeafNode?.remove();
        leafNodeRef.current = null;
      }

      // Element added or changed
      if (element && foQueryContextProps) {
        if (currentLeafNode) {
          if (
            element !== currentElement ||
            currentLeafNode.leaf.parent !== foQueryContextProps.node
          ) {
            currentLeafNode.remove();
            leafNodeRef.current = null;
          }
        }

        if (!leafNodeRef.current) {
          const leafNode = new FoQueryLeafNode(
            namesRef.current,
            foQueryContextProps.root,
            focusRef.current,
          );
          foQueryContextProps.appendLeaf(leafNode, element);
          leafNodeRef.current = leafNode;
        }
      }

      elementRef.current = element;
    },
    [foQueryContextProps],
  );

  return refCallback;
}
