/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import type * as Types from "./types";

export function evaluateXPath(
  xmlDoc: Document,
  contextNode: Node,
  xpath: string,
): Types.XmlElement[] {
  try {
    const result = xmlDoc.evaluate(
      xpath,
      contextNode,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );

    const elements: Types.XmlElement[] = [];

    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (node instanceof Element) {
        elements.push(node as Types.XmlElement);
      }
    }

    return elements;
  } catch {
    return [];
  }
}
