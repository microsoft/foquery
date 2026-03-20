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

describe("FoQueryParent", () => {
  it("registers itself as a child of the root node", () => {
    let innerContext: FoQueryContextProps | undefined;
    let rootContext: FoQueryContextProps | undefined;

    function RootInspector() {
      rootContext = React.useContext(FoQueryContext);
      return (
        <FoQueryParent name="header">
          <Inspector />
        </FoQueryParent>
      );
    }

    function Inspector() {
      innerContext = React.useContext(FoQueryContext);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootInspector />
        </FoQueryProvider>,
      );
    });

    expect(innerContext).toBeDefined();
    expect(innerContext!.node.name).toBe("header");

    expect(rootContext!.node.children.size).toBe(1);
    const child = [...rootContext!.node.children][0];
    expect(child.name).toBe("header");

    root.unmount();
    container.remove();
  });

  it("builds nested parent structure in the XML tree", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture() {
      rootContext = React.useContext(FoQueryContext);
      return (
        <FoQueryParent name="header">
          <FoQueryParent name="nav">
            <div />
          </FoQueryParent>
        </FoQueryParent>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture />
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.query("//header/nav").length).toBe(1);

    root.unmount();
    container.remove();
  });

  it("builds sibling parents in the XML tree", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture() {
      rootContext = React.useContext(FoQueryContext);
      return (
        <>
          <FoQueryParent name="header">
            <div />
          </FoQueryParent>
          <FoQueryParent name="main">
            <div />
          </FoQueryParent>
          <FoQueryParent name="footer">
            <div />
          </FoQueryParent>
        </>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture />
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.node.children.size).toBe(3);
    expect(rootContext!.query("/Root/*[@type='parent']").length).toBe(3);

    root.unmount();
    container.remove();
  });

  it("cleans up XML tree on unmount", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ show }: { show: boolean }) {
      rootContext = React.useContext(FoQueryContext);
      return show ? (
        <FoQueryParent name="header">
          <div />
        </FoQueryParent>
      ) : null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture show={true} />
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.node.children.size).toBe(1);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture show={false} />
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.node.children.size).toBe(0);
    expect(rootContext!.query("//header").length).toBe(0);

    root.unmount();
    container.remove();
  });

  it("updates XML tree when name prop changes", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ name }: { name: string }) {
      rootContext = React.useContext(FoQueryContext);
      return (
        <FoQueryParent name={name}>
          <div />
        </FoQueryParent>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture name="header" />
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.query("//header").length).toBe(1);
    expect(rootContext!.query("//sidebar").length).toBe(0);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture name="sidebar" />
        </FoQueryProvider>,
      );
    });

    expect(rootContext!.query("//header").length).toBe(0);
    expect(rootContext!.query("//sidebar").length).toBe(1);

    root.unmount();
    container.remove();
  });

  it("works correctly under StrictMode (double render)", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture() {
      rootContext = React.useContext(FoQueryContext);
      return (
        <FoQueryParent name="header">
          <FoQueryParent name="nav">
            <div />
          </FoQueryParent>
        </FoQueryParent>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <React.StrictMode>
          <FoQueryProvider>
            <RootCapture />
          </FoQueryProvider>
        </React.StrictMode>,
      );
    });

    // Despite double-render in StrictMode, tree should have exactly one header with one nav
    expect(rootContext!.node.children.size).toBe(1);
    const header = [...rootContext!.node.children][0];
    expect(header.name).toBe("header");
    expect(header.children.size).toBe(1);
    expect([...header.children][0].name).toBe("nav");

    expect(rootContext!.query("//header").length).toBe(1);
    expect(rootContext!.query("//header/nav").length).toBe(1);

    root.unmount();
    container.remove();
  });

  it("works under StrictMode with conditional rendering", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture({ show }: { show: boolean }) {
      rootContext = React.useContext(FoQueryContext);
      return show ? (
        <FoQueryParent name="header">
          <div />
        </FoQueryParent>
      ) : null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <React.StrictMode>
          <FoQueryProvider>
            <RootCapture show={true} />
          </FoQueryProvider>
        </React.StrictMode>,
      );
    });

    expect(rootContext!.query("//header").length).toBe(1);

    flushSync(() => {
      root.render(
        <React.StrictMode>
          <FoQueryProvider>
            <RootCapture show={false} />
          </FoQueryProvider>
        </React.StrictMode>,
      );
    });

    expect(rootContext!.query("//header").length).toBe(0);

    // Re-add
    flushSync(() => {
      root.render(
        <React.StrictMode>
          <FoQueryProvider>
            <RootCapture show={true} />
          </FoQueryProvider>
        </React.StrictMode>,
      );
    });

    expect(rootContext!.query("//header").length).toBe(1);

    root.unmount();
    container.remove();
  });

  it("passes focus and arbiter props to the core node", () => {
    let rootContext: FoQueryContextProps | undefined;

    function RootCapture() {
      rootContext = React.useContext(FoQueryContext);
      return (
        <FoQueryParent name="main" focus="./SelectedItem" arbiter={(c) => c[0]}>
          <div />
        </FoQueryParent>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <RootCapture />
        </FoQueryProvider>,
      );
    });

    const mainNode = [...rootContext!.node.children][0];
    expect(mainNode.focus).toBe("./SelectedItem");
    expect(typeof mainNode.arbiter).toBe("function");

    root.unmount();
    container.remove();
  });
});
