/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
declare namespace chrome {
  namespace devtools {
    namespace panels {
      interface ExtensionPanel {
        onShown: {
          addListener(callback: (window: Window) => void): void;
        };
        onHidden: {
          addListener(callback: () => void): void;
        };
      }

      function create(
        title: string,
        iconPath: string,
        pagePath: string,
        callback?: (panel: ExtensionPanel) => void,
      ): void;
    }

    namespace inspectedWindow {
      const tabId: number;

      interface ExceptionInfo {
        readonly isException: boolean;
        readonly value?: string;
      }

      function eval(
        expression: string,
        callback: (result: unknown, exceptionInfo?: ExceptionInfo) => void,
      ): void;
    }
  }

  namespace runtime {
    function sendMessage(message: unknown): void;
  }

  namespace tabs {
    function update(tabId: number, updateProperties: { active?: boolean }): void;
  }
}
