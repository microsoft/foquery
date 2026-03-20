/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, it, expect } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { FoQueryProvider } from "./foquery-provider";
import { FoQueryContext, FoQueryContextProps } from "./foquery-context";

describe("FoQueryProvider", () => {
  it("provides context to children", () => {
    let contextValue: FoQueryContextProps | undefined;

    function Consumer() {
      contextValue = React.useContext(FoQueryContext);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider>
          <Consumer />
        </FoQueryProvider>,
      );
    });

    expect(contextValue).toBeDefined();
    expect(contextValue!.root).toBeDefined();
    expect(contextValue!.root.xmlDoc).toBeInstanceOf(Document);
    expect(contextValue!.node).toBeDefined();
    expect(contextValue!.node.name).toBe("Root");
    expect(typeof contextValue!.subscribe).toBe("function");
    expect(typeof contextValue!.notify).toBe("function");

    root.unmount();
    container.remove();
  });

  it("accepts custom root name", () => {
    let contextValue: FoQueryContextProps | undefined;

    function Consumer() {
      contextValue = React.useContext(FoQueryContext);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <FoQueryProvider rootName="App">
          <Consumer />
        </FoQueryProvider>,
      );
    });

    expect(contextValue!.node.name).toBe("App");

    root.unmount();
    container.remove();
  });
});
