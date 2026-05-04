/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { FoQueryParent } from "./foquery-parent";
import { useFoQuery } from "./use-foquery";
import { FoQueryProvider } from "./foquery-provider";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";
import { FoQueryFrameProvider, FoQueryIFrameParent } from "./iframe";
import { RequestStatus } from "foquery";

describe("foquery-react iframe support", () => {
  it("registers an iframe-backed parent in the React tree", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture() {
      const iframeRef = React.useRef<HTMLIFrameElement>(null);
      rootContext = React.useContext(FoQueryContext);

      return (
        <FoQueryParent name="message">
          <FoQueryIFrameParent name="CardInIframe" iframeRef={iframeRef} frameId="card-frame">
            <iframe ref={iframeRef} />
          </FoQueryIFrameParent>
        </FoQueryParent>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        <FoQueryProvider window={window}>
          <RootCapture />
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.query("//message/CardInIframe")).toHaveLength(1);

    root.unmount();
    container.remove();
  });

  it("connects a child frame provider and posts tree state upward", async () => {
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");

    function Leaf() {
      const ref = useFoQuery<HTMLButtonElement>(["DefaultFocusable"]);
      return <button ref={ref}>Focusable</button>;
    }

    function ChildFrame() {
      return (
        <FoQueryFrameProvider window={window} rootName="FrameRoot" frameId="child-frame">
          <FoQueryParent name="Card">
            <Leaf />
          </FoQueryParent>
        </FoQueryFrameProvider>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const messages: unknown[] = [];
    const onMessage = (event: MessageEvent) => messages.push(event.data);
    window.addEventListener("message", onMessage);

    flushSync(() => {
      root.render(<ChildFrame />);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tree-state",
        frameId: "child-frame",
        snapshot: expect.objectContaining({ name: "FrameRoot" }),
      }),
      "*",
    );

    root.unmount();
    container.remove();
  });

  it("imports real iframe child trees and resolves the exact example focus queries", async () => {
    const CARD_FRAME_ID = "react-real-card-frame";
    const SECONDARY_FRAME_ID = "react-real-secondary-frame";
    const NESTED_FRAME_ID = "react-real-nested-frame";
    const LEVEL_THREE_FRAME_ID = "react-real-level-three-frame";
    const FOCUS_QUERIES = [
      "//content/messages/message/CardInIframe//Card/DefaultFocusable",
      "//content/messages/message/SecondaryCardInIframe//Card/SecondaryFocusable",
      "//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
      "//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable",
    ];
    let rootContext: FoQueryContextProps | undefined;

    function FrameLeaf({ name, children }: { name: string; children: string }) {
      const ref = useFoQuery<HTMLButtonElement>([name]);
      return <button ref={ref}>{children}</button>;
    }

    function EmbeddedFrame({
      name,
      frameId,
      children,
    }: {
      name: string;
      frameId: string;
      children: (frameWindow: Window & typeof globalThis) => React.ReactNode;
    }) {
      const iframeRef = React.useRef<HTMLIFrameElement>(null);
      const iframeRootRef = React.useRef<Root | null>(null);

      React.useEffect(() => {
        const iframe = iframeRef.current;
        const frameWindow = iframe?.contentWindow as (Window & typeof globalThis) | null;
        const frameDocument = iframe?.contentDocument;
        if (!iframe || !frameWindow || !frameDocument) return;

        frameDocument.open();
        frameDocument.write("<!doctype html><html><body><div id='root'></div></body></html>");
        frameDocument.close();

        const mount = frameDocument.getElementById("root");
        if (!mount) return;

        const iframeRoot = createRoot(mount);
        iframeRootRef.current = iframeRoot;
        iframeRoot.render(children(frameWindow));

        return () => {
          setTimeout(() => iframeRoot.unmount(), 0);
          iframeRootRef.current = null;
        };
      }, [children]);

      return (
        <FoQueryIFrameParent
          name={name}
          iframeRef={iframeRef}
          frameId={frameId}
          verifySource={false}
        >
          <iframe ref={iframeRef} />
        </FoQueryIFrameParent>
      );
    }

    function LevelThreeCardContent() {
      return (
        <FoQueryParent name="LevelThreeCard">
          <FrameLeaf name="DeepestFocusable">Deepest target</FrameLeaf>
        </FoQueryParent>
      );
    }

    function NestedCardContent() {
      return (
        <FoQueryParent name="NestedCard">
          <FrameLeaf name="DeepFocusable">Deep target</FrameLeaf>
          <EmbeddedFrame name="LevelThreeFrame" frameId={LEVEL_THREE_FRAME_ID}>
            {(frameWindow) => (
              <FoQueryFrameProvider
                window={frameWindow}
                rootName="LevelThreeRoot"
                frameId={LEVEL_THREE_FRAME_ID}
              >
                <LevelThreeCardContent />
              </FoQueryFrameProvider>
            )}
          </EmbeddedFrame>
        </FoQueryParent>
      );
    }

    function CardContent({ includeNested }: { includeNested?: boolean }) {
      return (
        <FoQueryParent name="Card">
          <FrameLeaf name="DefaultFocusable">Default target</FrameLeaf>
          <FrameLeaf name="SecondaryFocusable">Secondary target</FrameLeaf>
          {includeNested && (
            <FoQueryParent name="NestedArea">
              <EmbeddedFrame name="NestedCardInIframe" frameId={NESTED_FRAME_ID}>
                {(frameWindow) => (
                  <FoQueryFrameProvider
                    window={frameWindow}
                    rootName="NestedFrameRoot"
                    frameId={NESTED_FRAME_ID}
                  >
                    <NestedCardContent />
                  </FoQueryFrameProvider>
                )}
              </EmbeddedFrame>
            </FoQueryParent>
          )}
        </FoQueryParent>
      );
    }

    function RootCapture() {
      rootContext = React.useContext(FoQueryContext);
      return (
        <FoQueryParent name="content">
          <FoQueryParent name="messages">
            <FoQueryParent name="message">
              <EmbeddedFrame name="CardInIframe" frameId={CARD_FRAME_ID}>
                {(frameWindow) => (
                  <FoQueryFrameProvider
                    window={frameWindow}
                    rootName="FrameRoot"
                    frameId={CARD_FRAME_ID}
                  >
                    <CardContent includeNested />
                  </FoQueryFrameProvider>
                )}
              </EmbeddedFrame>
              <EmbeddedFrame name="SecondaryCardInIframe" frameId={SECONDARY_FRAME_ID}>
                {(frameWindow) => (
                  <FoQueryFrameProvider
                    window={frameWindow}
                    rootName="SecondaryFrameRoot"
                    frameId={SECONDARY_FRAME_ID}
                  >
                    <CardContent />
                  </FoQueryFrameProvider>
                )}
              </EmbeddedFrame>
            </FoQueryParent>
          </FoQueryParent>
        </FoQueryParent>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider window={window}>
          <RootCapture />
        </FoQueryProvider>,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    for (const query of FOCUS_QUERIES) {
      expect(rootContext!.query(query)).toHaveLength(1);

      const request = rootContext!.requestFocus(query, { timeout: 1000 });
      await expect(request.promise).resolves.toBe(RequestStatus.Succeeded);
    }

    root.unmount();
    container.remove();
  });
});
