/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { FoQueryProvider } from "./foquery-provider";
import { FoQueryParent } from "./foquery-parent";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";
import { useFoQuery } from "./use-foquery";

describe("useFoQuery", () => {
  it("registers a leaf node in the XML tree", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf() {
      const ref = useFoQuery<HTMLButtonElement>(["SelectedItem"]);
      return <button ref={ref}>Click me</button>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="main">
              <Leaf />
            </FoQueryParent>
          </RootCapture>
        </FoQueryProvider>,
      );
    });

    const results = rootContext!.query("//main/SelectedItem");

    expect(results.length).toBe(1);
    expect(results[0].foQueryLeafNode).toBeDefined();
    expect(results[0].foQueryLeafNode!.element.deref()).toBeInstanceOf(HTMLButtonElement);

    root.unmount();
    container.remove();
  });

  it("registers multiple names for the same element", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf() {
      const ref = useFoQuery<HTMLDivElement>(["SelectedItem", "DefaultItem"]);
      return <div ref={ref}>item</div>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="main">
              <Leaf />
            </FoQueryParent>
          </RootCapture>
        </FoQueryProvider>,
      );
    });

    const selected = rootContext!.query("//main/SelectedItem");
    const defaultItem = rootContext!.query("//main/DefaultItem");

    expect(selected.length).toBe(1);
    expect(defaultItem.length).toBe(1);
    expect(selected[0].foQueryLeafNode).toBe(defaultItem[0].foQueryLeafNode);

    root.unmount();
    container.remove();
  });

  it("cleans up leaf from XML tree on unmount", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf() {
      const ref = useFoQuery<HTMLButtonElement>(["SelectedItem"]);
      return <button ref={ref}>Click me</button>;
    }

    function App({ showLeaf }: { showLeaf: boolean }) {
      return (
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="main">{showLeaf ? <Leaf /> : null}</FoQueryParent>
          </RootCapture>
        </FoQueryProvider>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(<App showLeaf={true} />));

    expect(rootContext!.query("//main/SelectedItem").length).toBe(1);

    flushSync(() => root.render(<App showLeaf={false} />));

    expect(rootContext!.query("//main/SelectedItem").length).toBe(0);

    root.unmount();
    container.remove();
  });

  it("tracks lastFocused on focus events", async () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf() {
      const ref = useFoQuery<HTMLButtonElement>(["SelectedItem"]);
      return <button ref={ref}>Focus me</button>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="main">
              <Leaf />
            </FoQueryParent>
          </RootCapture>
        </FoQueryProvider>,
      );
    });

    // Wait for the setTimeout(0) focus check in the hook
    await new Promise((r) => setTimeout(r, 10));

    const results = rootContext!.query("//main/SelectedItem");
    const xmlEl = results[0];
    const button = xmlEl.foQueryLeafNode!.element.deref()!;

    button.focus();

    expect(xmlEl.foQueryLeafNode!.lastFocused).toBeGreaterThan(0);
    expect(xmlEl.getAttribute("lastFocused")).toBeTruthy();

    const mainNode = [...rootContext!.node.children][0];
    expect(mainNode.lastFocused).toBeGreaterThan(0);

    root.unmount();
    container.remove();
  });

  it("builds a full tree queryable with XPath from React components", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function LeafItem({ name }: { name: string }) {
      const ref = useFoQuery<HTMLDivElement>([name]);
      return <div ref={ref}>{name}</div>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="header">
              <LeafItem name="DefaultItem" />
            </FoQueryParent>
            <FoQueryParent name="main">
              <FoQueryParent name="sidebar">
                <LeafItem name="SelectedItem" />
              </FoQueryParent>
              <FoQueryParent name="content">
                <LeafItem name="SelectedItem" />
                <LeafItem name="DefaultItem" />
              </FoQueryParent>
            </FoQueryParent>
          </RootCapture>
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.query("//SelectedItem").length).toBe(2);
    expect(rootContext!.query("//content/SelectedItem").length).toBe(1);
    expect(rootContext!.query("//header/DefaultItem").length).toBe(1);
    expect(rootContext!.query("//*[@type='parent']").length).toBe(4);

    root.unmount();
    container.remove();
  });

  it("works correctly under StrictMode", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf() {
      const ref = useFoQuery<HTMLButtonElement>(["SelectedItem"]);
      return <button ref={ref}>Click me</button>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <React.StrictMode>
          <FoQueryProvider>
            <RootCapture>
              <FoQueryParent name="main">
                <Leaf />
              </FoQueryParent>
            </RootCapture>
          </FoQueryProvider>
        </React.StrictMode>,
      );
    });

    // Despite double-render, exactly one leaf should be registered
    expect(rootContext!.query("//main/SelectedItem").length).toBe(1);

    root.unmount();
    container.remove();
  });

  it("handles element change when component re-renders with different element", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf({ tag }: { tag: "button" | "div" }) {
      const ref = useFoQuery<HTMLElement>(["SelectedItem"]);
      return tag === "button" ? <button ref={ref}>btn</button> : <div ref={ref}>div</div>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="main">
              <Leaf tag="button" />
            </FoQueryParent>
          </RootCapture>
        </FoQueryProvider>,
      );
    });

    const results1 = rootContext!.query("//main/SelectedItem");
    expect(results1.length).toBe(1);
    expect(results1[0].foQueryLeafNode!.element.deref()).toBeInstanceOf(HTMLButtonElement);

    // Change the underlying element
    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="main">
              <Leaf tag="div" />
            </FoQueryParent>
          </RootCapture>
        </FoQueryProvider>,
      );
    });

    const results2 = rootContext!.query("//main/SelectedItem");
    expect(results2.length).toBe(1);
    expect(results2[0].foQueryLeafNode!.element.deref()).toBeInstanceOf(HTMLDivElement);

    root.unmount();
    container.remove();
  });

  it("handles leaf moving between parents", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf() {
      const ref = useFoQuery<HTMLButtonElement>(["SelectedItem"]);
      return <button ref={ref}>item</button>;
    }

    function App({ inMain }: { inMain: boolean }) {
      return (
        <FoQueryProvider>
          <RootCapture>
            <FoQueryParent name="header">{!inMain ? <Leaf /> : null}</FoQueryParent>
            <FoQueryParent name="main">{inMain ? <Leaf /> : null}</FoQueryParent>
          </RootCapture>
        </FoQueryProvider>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(<App inMain={false} />));

    expect(rootContext!.query("//header/SelectedItem").length).toBe(1);
    expect(rootContext!.query("//main/SelectedItem").length).toBe(0);

    flushSync(() => root.render(<App inMain={true} />));

    expect(rootContext!.query("//header/SelectedItem").length).toBe(0);
    expect(rootContext!.query("//main/SelectedItem").length).toBe(1);

    root.unmount();
    container.remove();
  });

  it("cleans up under StrictMode mount/unmount cycle", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ children }: { children: React.ReactNode }) {
      rootContext = React.useContext(FoQueryContext);
      return <>{children}</>;
    }

    function Leaf() {
      const ref = useFoQuery<HTMLButtonElement>(["SelectedItem"]);
      return <button ref={ref}>item</button>;
    }

    function App({ show }: { show: boolean }) {
      return (
        <React.StrictMode>
          <FoQueryProvider>
            <RootCapture>
              <FoQueryParent name="main">{show ? <Leaf /> : null}</FoQueryParent>
            </RootCapture>
          </FoQueryProvider>
        </React.StrictMode>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(<App show={true} />));

    expect(rootContext!.query("//main/SelectedItem").length).toBe(1);

    flushSync(() => root.render(<App show={false} />));

    expect(rootContext!.query("//main/SelectedItem").length).toBe(0);

    flushSync(() => root.render(<App show={true} />));

    expect(rootContext!.query("//main/SelectedItem").length).toBe(1);

    root.unmount();
    container.remove();
  });
});
