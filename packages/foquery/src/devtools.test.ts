/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { describe, expect, it } from "vitest";
import { RequestStatus } from "./consts";
import { FoQueryRootNode } from "./foquery-root-node.development";

describe("FoQuery devtools bridge", () => {
  it("exposes a dev root as a global variable", () => {
    const rootNode = new FoQueryRootNode(window, "Root", { devtools: "__TEST_ROOT__" });

    expect((window as unknown as Record<string, unknown>)["__TEST_ROOT__"]).toBe(rootNode);

    rootNode.dispose();

    expect((window as unknown as Record<string, unknown>)["__TEST_ROOT__"]).toBeUndefined();
  });

  it("uses the default root global name when devtools is true", () => {
    const rootNode = new FoQueryRootNode(window, "Root", { devtools: true });

    expect((window as unknown as Record<string, unknown>).__FOQUERY_ROOT__).toBe(rootNode);

    rootNode.dispose();

    expect((window as unknown as Record<string, unknown>).__FOQUERY_ROOT__).toBeUndefined();
  });

  it("exposes the active request for devtools polling only for dev-enabled roots", async () => {
    const rootNode = new FoQueryRootNode(window, "Root", { devtools: "__TEST_ROOT__" });
    const request = rootNode.requestFocus("//Missing", { timeout: 1 });

    expect((window as unknown as Record<string, unknown>).__FOQUERY_ACTIVE_REQUEST__).toBe(request);
    await expect(request.promise).resolves.toBe(RequestStatus.TimedOut);

    rootNode.dispose();
    delete (window as unknown as Record<string, unknown>).__FOQUERY_ACTIVE_REQUEST__;
  });
});
