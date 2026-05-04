/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import { FOQUERY_FRAME_MESSAGE_SOURCE, FOQUERY_FRAME_MESSAGE_VERSION } from "foquery/iframe";
import { FoQueryDOMRoot } from "./foquery-dom-root";
import { appendIFrameParent } from "./iframe";

describe("foquery-dom iframe support", () => {
  it("appends an iframe-backed parent and imports child tree state", () => {
    const container = document.createElement("div");
    const iframe = document.createElement("iframe");
    document.body.appendChild(container);
    container.appendChild(iframe);
    const domRoot = new FoQueryDOMRoot(container);
    const messageEl = document.createElement("div");
    container.appendChild(messageEl);
    const message = domRoot.appendParent(messageEl, "message");

    const frame = appendIFrameParent(message, iframe, "CardInIframe", {
      frameId: "card-frame",
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: window.location.origin,
        data: {
          source: FOQUERY_FRAME_MESSAGE_SOURCE,
          version: FOQUERY_FRAME_MESSAGE_VERSION,
          type: "tree-state",
          frameId: "card-frame",
          snapshot: {
            type: "parent",
            name: "FrameRoot",
            children: [
              {
                type: "parent",
                name: "Card",
                children: [{ type: "leaf", name: "DefaultFocusable" }],
              },
            ],
          },
        },
      }),
    );

    expect(iframe.getAttribute("data-foquery-parent")).toBe("CardInIframe");
    expect(iframe.getAttribute("data-foquery-iframe-parent")).toBe("card-frame");
    expect(domRoot.query("//message/CardInIframe//Card/DefaultFocusable")).toHaveLength(1);

    frame.remove();
    domRoot.dispose();
    container.remove();
  });
});
