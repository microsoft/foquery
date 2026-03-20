/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as React from "react";
import type { Types } from "foquery";
import type { FoQueryParentNode, FoQueryLeafNode, FoQueryRequest } from "foquery";

export interface FoQueryContextProps {
  root: Types.RootNode;
  node: Types.ParentNode;
  appendParent: (child: FoQueryParentNode) => void;
  appendLeaf: (leaf: FoQueryLeafNode, element: HTMLElement) => void;
  query: (xpath: string) => Types.XmlElement[];
  requestFocus: (xpath: string, options?: Types.RequestFocusOptions) => FoQueryRequest;
  subscribe: (
    callback: (parentOrLeaf: Types.ParentNode | Types.LeafNode, removed?: boolean) => void,
  ) => () => void;
  notify: (parentOrLeaf: Types.ParentNode | Types.LeafNode, removed?: boolean) => void;
}

export const FoQueryContext = React.createContext<FoQueryContextProps | undefined>(undefined);
