/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import * as Types from "./types";
import { FoQueryRootNode as BaseFoQueryRootNode } from "./foquery-root-node";
import { enableFoQueryDevtools, type FoQueryDevtoolsOption } from "./devtools";

export class FoQueryRootNode extends BaseFoQueryRootNode {
  private _disableDevtools: (() => void) | undefined;

  constructor(
    win: Window & typeof globalThis,
    rootName: string = "Root",
    options?: {
      arbiter?: (candidates: Types.XmlElement[]) => Types.XmlElement;
      devtools?: FoQueryDevtoolsOption;
    },
  ) {
    super(win, rootName, { arbiter: options?.arbiter });

    if (options?.devtools) {
      this._disableDevtools = enableFoQueryDevtools(this, options.devtools);
    }
  }

  public override dispose(): void {
    this._disableDevtools?.();
    this._disableDevtools = undefined;
    super.dispose();
  }
}
