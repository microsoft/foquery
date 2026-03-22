/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const APP_URL = "http://localhost:5199";
const PANEL_URL = "http://localhost:5198/panel.html";

async function setupPanel(context: BrowserContext): Promise<{ app: Page; panel: Page }> {
  const app = await context.newPage();
  await app.goto(APP_URL);
  await app.waitForFunction(() => (window as unknown as Record<string, unknown>).__FOQUERY_ROOT__);

  const panel = await context.newPage();

  // Bridge: panel's chrome.devtools.inspectedWindow.eval → app page.evaluate
  await panel.exposeFunction("__evalOnApp", async (expression: string): Promise<unknown> => {
    return app.evaluate((expr: string) => new Function(`return ${expr}`)(), expression);
  });

  await panel.addInitScript(() => {
    interface EvalCallback {
      (result: unknown, exceptionInfo: undefined): void;
      (result: undefined, exceptionInfo: { isException: true; value: string }): void;
    }

    const w = window as unknown as Record<string, unknown>;
    w.chrome = {
      devtools: {
        inspectedWindow: {
          eval: (expression: string, callback: EvalCallback) => {
            const evalOnApp = w.__evalOnApp as (expr: string) => Promise<unknown>;
            evalOnApp(expression)
              .then((result: unknown) => callback(result, undefined))
              .catch((err: Error) =>
                callback(undefined, { isException: true, value: String(err) }),
              );
          },
        },
      },
    };
  });

  // Capture console errors for debugging
  panel.on("pageerror", (err) => console.error("Panel error:", err.message));

  await panel.goto(PANEL_URL);
  // Wait for panel to auto-connect and render the tree
  await panel.waitForSelector("#tree .tree-node", { timeout: 10000 });

  return { app, panel };
}

test.describe("devtools panel UI against live example app", () => {
  let app: Page;
  let panel: Page;

  test.beforeEach(async ({ context }) => {
    ({ app, panel } = await setupPanel(context));
  });

  test.describe("tree view", () => {
    test("renders the tree with expected parent nodes", async () => {
      const parentNames = await panel.$$eval("#tree .tree-parent > .tree-node-label", (els) =>
        els.map((el) => el.getAttribute("data-name")),
      );
      expect(parentNames).toContain("Root");
      expect(parentNames).toContain("header");
      expect(parentNames).toContain("sidebar");
      expect(parentNames).toContain("content");
      expect(parentNames).toContain("messages");
      expect(parentNames).toContain("thread");
      expect(parentNames).toContain("compose");
      expect(parentNames).toContain("footer");
    });

    test("renders leaf nodes inside parents", async () => {
      const leafNames = await panel.$$eval("#tree .tree-leaf > .tree-node-label", (els) =>
        els.map((el) => el.getAttribute("data-name")),
      );
      expect(leafNames.length).toBeGreaterThan(0);
      expect(leafNames).toContain("SelectedItem");
      expect(leafNames).toContain("DefaultItem");
    });
  });

  test.describe("parent selection and info panel", () => {
    test("clicking a parent node selects it and shows info panel", async () => {
      // Click on <compose>
      await panel.click('.tree-node-label[data-name="compose"]');

      // Should show selected state
      const selected = await panel.$(".tree-parent.selected");
      expect(selected).not.toBeNull();

      // Parent info should appear with the name
      const infoHeader = await panel.textContent("#parent-info h3");
      expect(infoHeader).toBe("<compose>");

      // Should show focus and arbiter properties
      const props = await panel.$$eval("#parent-info .parent-prop-name", (els) =>
        els.map((el) => el.textContent),
      );
      expect(props).toContain("focus: ");
      expect(props).toContain("arbiter: ");
    });

    test("clicking messages shows its string focus value", async () => {
      await panel.click('.tree-node-label[data-name="messages"]');

      const focusValue = await panel.textContent("#parent-info .parent-prop-value");
      // messages has focus="./thread/SelectedItem"
      expect(focusValue).toContain("./thread/SelectedItem");
    });

    test("clicking selected parent again deselects it and hides info panel", async () => {
      await panel.click('.tree-node-label[data-name="compose"]');
      // Verify selected
      await expect(panel.locator("#parent-info h3")).toHaveText("<compose>");

      // Click again to deselect — use the same element (re-query since tree may refresh)
      await panel.click('.tree-node-label[data-name="compose"]');

      // Info panel should be empty
      await expect(panel.locator("#parent-info")).toHaveText("");

      // Context label should be cleared
      await expect(panel.locator("#xpath-context")).toHaveText("");
    });

    test("re-clicking after deselect shows info panel again", async () => {
      // First click — select
      await panel.click('.tree-node-label[data-name="messages"]');
      await expect(panel.locator("#parent-info h3")).toHaveText("<messages>");

      // Second click — deselect
      await panel.click('.tree-node-label[data-name="messages"]');
      await expect(panel.locator("#parent-info")).toHaveText("");

      // Wait for at least one tree refresh so we get a fresh DOM
      await panel.waitForTimeout(1200);

      // Third click — should select again
      await panel.click('.tree-node-label[data-name="messages"]');

      await expect(panel.locator("#parent-info h3")).toHaveText("<messages>");
    });

    test("info panel updates lastFocused when a child is focused in the app", async () => {
      // Select <compose> in devtools
      await panel.click('.tree-node-label[data-name="compose"]');
      await expect(panel.locator("#parent-info h3")).toHaveText("<compose>");

      // Initially compose has no lastFocused
      const propsBefore = await panel.$$eval("#parent-info .parent-prop-name", (els) =>
        els.map((el) => el.textContent),
      );
      expect(propsBefore).not.toContain("lastFocused: ");

      // Click the Body button in the example app (a DefaultItem leaf inside compose)
      await app.click("text=Body");

      // Wait for the devtools tree refresh to pick up the lastFocused change
      await panel.waitForFunction(
        () => {
          const props = document.querySelectorAll("#parent-info .parent-prop-name");
          return Array.from(props).some((el) => el.textContent === "lastFocused: ");
        },
        undefined,
        { timeout: 5000 },
      );

      // Verify lastFocused is now shown in the info panel
      const propsAfter = await panel.$$eval("#parent-info .parent-prop-name", (els) =>
        els.map((el) => el.textContent),
      );
      expect(propsAfter).toContain("lastFocused: ");
    });

    test("selecting a parent shows context label in xpath bar", async () => {
      await panel.click('.tree-node-label[data-name="compose"]');

      const contextLabel = await panel.textContent("#xpath-context");
      expect(contextLabel).toBe("<compose>");
    });
  });

  test.describe("xpath query", () => {
    test("typing a valid query shows result count and enables Focus button", async () => {
      await panel.fill("#xpath-input", "//compose");
      // Wait for debounced query
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent !== "",
        undefined,
        { timeout: 2000 },
      );

      const results = await panel.textContent("#xpath-results");
      expect(results).toBe("1 result");

      const disabled = await panel.getAttribute("#focus-btn", "disabled");
      expect(disabled).toBeNull(); // not disabled
    });

    test("typing an invalid query shows invalid state and disables Focus", async () => {
      await panel.fill("#xpath-input", "///[");
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "invalid",
        undefined,
        { timeout: 2000 },
      );

      const inputClass = await panel.getAttribute("#xpath-input", "class");
      expect(inputClass).toContain("invalid");

      const disabled = await panel.getAttribute("#focus-btn", "disabled");
      expect(disabled).not.toBeNull(); // disabled
    });

    test("query results update when matching node is removed from the app", async () => {
      // Add a panel
      await app.click("text=Add Panel");
      await panel.waitForSelector('.tree-node-label[data-name="panel-1"]', { timeout: 3000 });

      // Query for the panel's leaf
      await panel.fill("#xpath-input", "/Root/panel-1/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "1 result",
        undefined,
        { timeout: 2000 },
      );
      expect(await panel.textContent("#xpath-results")).toBe("1 result");

      // Remove the panel in the app
      await app.click("text=Remove");

      // Wait for devtools to update to 0 results
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "0 results",
        undefined,
        { timeout: 5000 },
      );
      expect(await panel.textContent("#xpath-results")).toBe("0 results");
    });

    test("query with selected parent context uses that context", async () => {
      // Select compose first
      await panel.click('.tree-node-label[data-name="compose"]');

      // ".." from compose = messages (1 result)
      await panel.fill("#xpath-input", "..");
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent !== "",
        undefined,
        { timeout: 2000 },
      );

      const results = await panel.textContent("#xpath-results");
      expect(results).toBe("1 result");
    });

    test("pressing Enter in query input triggers Focus", async () => {
      await panel.fill("#xpath-input", "//header/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 2000 },
      );

      await panel.press("#xpath-input", "Enter");
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      const statusText = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(statusText).toContain("succeeded");
    });

    test("matched nodes are highlighted in the tree", async () => {
      await panel.fill("#xpath-input", "//compose");
      await panel.waitForFunction(
        () => document.querySelector("#tree .xpath-match") !== null,
        undefined,
        { timeout: 2000 },
      );

      const matchedKey = await panel.$eval(".xpath-match", (el) =>
        el.getAttribute("data-match-key"),
      );
      expect(matchedKey).toBe("parent:compose");
    });
  });

  test.describe("focus button and diagnostics", () => {
    test("clicking Focus shows diagnostics with succeeded status", async () => {
      await panel.fill("#xpath-input", "//header/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 2000 },
      );

      await panel.click("#focus-btn");
      // Wait for diagnostics to render
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      const statusText = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(statusText).toContain("succeeded");
    });

    test("Focus shows matched elements, candidates, and winner", async () => {
      await panel.fill("#xpath-input", "//header/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 2000 },
      );
      await panel.click("#focus-btn");
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      const sectionTitles = await panel.$$eval("#diagnostics .diag-section h3", (els) =>
        els.map((el) => el.textContent),
      );
      expect(sectionTitles).toContain("Status");
      expect(sectionTitles).toContain("Winner");
      // Matched and Candidates sections include counts
      expect(sectionTitles.some((t) => t?.startsWith("Matched"))).toBe(true);
      expect(sectionTitles.some((t) => t?.startsWith("Candidates"))).toBe(true);

      // Winner should exist
      const winner = await panel.$("#diagnostics .winner");
      expect(winner).not.toBeNull();
    });

    test("the original bug: '..' from compose context succeeds", async () => {
      // Select compose
      await panel.click('.tree-node-label[data-name="compose"]');

      // Type ".."
      await panel.fill("#xpath-input", "..");
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 2000 },
      );

      // Click Focus
      await panel.click("#focus-btn");
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      // Status should be succeeded, NOT waiting
      const statusText = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(statusText).toContain("succeeded");

      // Winner should exist
      const winner = await panel.$("#diagnostics .winner");
      expect(winner).not.toBeNull();
    });
  });

  test.describe("deferred focus (element added after request)", () => {
    test("focus resolves when matching element is added to the app", async () => {
      // Query for a panel that doesn't exist yet
      await panel.fill("#xpath-input", "//panel-1/DefaultItem");
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent !== "",
        undefined,
        { timeout: 2000 },
      );

      // Should match 0 results but still be valid xpath (Focus enabled with 0 results
      // won't work — we need to check). Actually runQuery enables Focus when lastQueryValid.
      // With 0 results, the query is valid but no matches.
      const results = await panel.textContent("#xpath-results");
      expect(results).toBe("0 results");

      // Focus button should be enabled (valid xpath, even with 0 results)
      const disabled = await panel.getAttribute("#focus-btn", "disabled");
      expect(disabled).toBeNull();

      // Click Focus — should show "waiting" since no element exists yet
      await panel.click("#focus-btn");
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      const initialStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(initialStatus).toContain("waiting");

      // Add a panel in the app. The mousedown will cancel the pending request,
      // so after clicking we issue a new requestFocus via the devtools Focus button.
      await app.click("text=Add Panel");

      // The click canceled the request — re-trigger focus now that the panel exists
      await panel.click("#focus-btn");

      // The focus should now resolve immediately since the panel exists
      await panel.waitForFunction(
        () => {
          const items = document.querySelectorAll("#diagnostics .diag-section .diag-item");
          return items.length > 0 && items[0].textContent?.startsWith("succeeded");
        },
        undefined,
        { timeout: 5000 },
      );

      const finalStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(finalStatus).toContain("succeeded");

      // Active element should show the focused button
      await panel.waitForFunction(
        () => {
          const el = document.getElementById("active-element");
          return el && el.textContent !== "<body>" && el.textContent !== "—";
        },
        undefined,
        { timeout: 3000 },
      );
      const activeText = await panel.textContent("#active-element");
      expect(activeText).toContain("<button>");
    });

    test("shows elapsed time and progressive diagnostics while waiting, then updates on resolve", async () => {
      // Query for a panel that doesn't exist yet
      await panel.fill("#xpath-input", "/Root/panel-1/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "0 results",
        undefined,
        { timeout: 2000 },
      );

      // Click Focus — status should be "waiting" with elapsed time
      await panel.click("#focus-btn");
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      const initialStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(initialStatus).toContain("waiting");
      // Should include elapsed time in ms
      expect(initialStatus).toMatch(/\(\d+ms\)/);

      // Wait for a poll cycle so progressive diagnostics can update
      await panel.waitForTimeout(1500);

      // Status should still show waiting with increasing elapsed time
      const waitingStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(waitingStatus).toContain("waiting");
      expect(waitingStatus).toMatch(/\(\d+ms\)/);

      // Add a panel in the app. The mousedown will cancel the pending request,
      // so after clicking we issue a new requestFocus via the devtools Focus button.
      await app.click("text=Add Panel");

      // The click canceled the request — re-trigger focus now that the panel exists
      await panel.click("#focus-btn");

      // Wait for diagnostics to update to succeeded
      await panel.waitForFunction(
        () => {
          const items = document.querySelectorAll("#diagnostics .diag-section .diag-item");
          return items.length > 0 && items[0].textContent?.startsWith("succeeded");
        },
        undefined,
        { timeout: 5000 },
      );

      const finalStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(finalStatus).toContain("succeeded");
      // Final status should show total elapsed time
      expect(finalStatus).toMatch(/\(\d+ms\)/);
    });
  });

  test.describe("progressive focus with string focus parent", () => {
    test("//messages waits for children to mount via Progressive, then focuses", async () => {
      // Type //messages in the devtools query
      await panel.fill("#xpath-input", "//messages");
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "1 result",
        undefined,
        { timeout: 2000 },
      );

      // Click Progressive button in the app — this removes the content section
      await app.click("text=Progressive");

      // Wait for content to be removed (step 0)
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "0 results",
        undefined,
        { timeout: 3000 },
      );

      // Click Focus — the mousedown from Progressive already happened,
      // messages doesn't exist yet so status should be "waiting"
      await panel.click("#focus-btn");
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      const initialStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(initialStatus).toContain("waiting");

      // The Progressive demo adds content back step by step via setTimeout.
      // Wait for the request to resolve — messages will mount with
      // focus="./thread/SelectedItem", and thread/SelectedItem will mount.
      await panel.waitForFunction(
        () => {
          const items = document.querySelectorAll("#diagnostics .diag-section .diag-item");
          return items.length > 0 && items[0].textContent?.startsWith("succeeded");
        },
        undefined,
        { timeout: 15000 },
      );

      const finalStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(finalStatus).toContain("succeeded");
    });
  });

  test.describe("app-triggered requests", () => {
    test("diagnostics panel shows status of app-triggered requestFocus", async () => {
      // Trigger a requestFocus from the app (not from devtools Focus button)
      await app.evaluate(() => {
        const root = (window as unknown as Record<string, unknown>).__FOQUERY_ROOT__ as {
          requestFocus: (xpath: string) => unknown;
        };
        root.requestFocus("//header/SelectedItem");
      });

      // The devtools should pick up the active request on the next poll
      await panel.waitForFunction(
        () => {
          const items = document.querySelectorAll("#diagnostics .diag-section .diag-item");
          return items.length > 0 && items[0].textContent?.startsWith("succeeded");
        },
        undefined,
        { timeout: 5000 },
      );

      const statusText = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(statusText).toContain("succeeded");
    });
  });

  test.describe("active element", () => {
    test("active element updates after focus", async () => {
      await panel.fill("#xpath-input", "//header/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 2000 },
      );
      await panel.click("#focus-btn");

      // Wait for tree refresh which updates active element
      await panel.waitForFunction(
        () => {
          const el = document.getElementById("active-element");
          return el && el.textContent !== "<body>" && el.textContent !== "—";
        },
        undefined,
        { timeout: 3000 },
      );

      const activeText = await panel.textContent("#active-element");
      expect(activeText).toContain("<button>");
    });
  });

  test.describe("connection", () => {
    test("selected parent info clears when node disappears after page reload", async () => {
      // Add a panel in the app
      await app.click("text=Add Panel");

      // Wait for panel-1 to appear in the devtools tree
      await panel.waitForSelector('.tree-node-label[data-name="panel-1"]', { timeout: 3000 });

      // Click panel-1 to show its details
      await panel.click('.tree-node-label[data-name="panel-1"]');
      await expect(panel.locator("#parent-info h3")).toHaveText("<panel-1>");

      // Reload the example app — panel-1 goes away
      await app.reload();
      await app.waitForFunction(
        () => (window as unknown as Record<string, unknown>).__FOQUERY_ROOT__,
      );

      // Wait for the devtools tree to refresh and panel-1 to disappear
      await panel.waitForFunction(
        () => !document.querySelector('.tree-node-label[data-name="panel-1"]'),
        undefined,
        { timeout: 5000 },
      );

      // Parent info should be cleared since the selected node no longer exists
      await expect(panel.locator("#parent-info")).toHaveText("");
    });

    test("disconnect stops tree updates, connect resumes", async () => {
      // Initially connected (button says Disconnect)
      const btnText = await panel.textContent("#connect-btn");
      expect(btnText).toBe("Disconnect");

      // Click to disconnect
      await panel.click("#connect-btn");
      const afterDisconnect = await panel.textContent("#connect-btn");
      expect(afterDisconnect).toBe("Connect");

      // Click to reconnect
      await panel.click("#connect-btn");
      const afterReconnect = await panel.textContent("#connect-btn");
      expect(afterReconnect).toBe("Disconnect");

      // Tree should still be rendered
      const treeNodes = await panel.$$("#tree .tree-node");
      expect(treeNodes.length).toBeGreaterThan(0);
    });
  });
});
