/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { test, expect, type Page, type BrowserContext, type Frame } from "@playwright/test";

const APP_URL = "http://127.0.0.1:5173";
const PANEL_URL = "http://127.0.0.1:5198/panel.html";
const PRIMARY_FRAME_ID = "example-card-frame";
const PRIMARY_DEFAULT_REMOTE_KEY = `remote:${PRIMARY_FRAME_ID}://Card/DefaultFocusable`;
const PRIMARY_NESTED_REMOTE_KEY = `remote:${PRIMARY_FRAME_ID}://Card/NestedArea/NestedCardInIframe/NestedCard/DeepFocusable`;
const PRIMARY_DEEPEST_REMOTE_KEY = `remote:${PRIMARY_FRAME_ID}://Card/NestedArea/NestedCardInIframe/NestedCard/LevelThreeFrame/LevelThreeCard/DeepestFocusable`;
const LEVEL_THREE_FOCUS_QUERY =
  "//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable";

async function setupPanel(context: BrowserContext): Promise<{ app: Page; panel: Page }> {
  const app = await context.newPage();
  await app.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__FOQUERY_DEVTOOLS_INSPECTED__ = null;
    w.inspect = (el: Element) => {
      w.__FOQUERY_DEVTOOLS_INSPECTED__ = {
        tagName: el.tagName,
        title: el.getAttribute("title"),
        src: el.getAttribute("src"),
      };
    };
  });
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

async function waitForExampleFrame(app: Page, role: string): Promise<Frame> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const frame = app
      .frames()
      .find((candidate) => candidate.url().includes(`foqueryFrame=${role}`));
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for ${role} example frame`);
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

    test("renders nested cross-origin iframe tree snapshots", async () => {
      const expectedNames = [
        "CardInIframe",
        "Card",
        "DefaultFocusable",
        "SecondaryFocusable",
        "NestedArea",
        "NestedCardInIframe",
        "NestedCard",
        "DeepFocusable",
        "LevelThreeFrame",
        "LevelThreeCard",
        "DeepestFocusable",
        "SecondaryCardInIframe",
      ];

      await panel.waitForFunction(
        (names) => {
          const renderedNames = new Set(
            Array.from(document.querySelectorAll("#tree .tree-node-label")).map((el) =>
              el.getAttribute("data-name"),
            ),
          );
          return names.every((name) => renderedNames.has(name));
        },
        expectedNames,
        { timeout: 10000 },
      );

      const remoteMatchKeys = await panel.$$eval("#tree .tree-node", (els) =>
        els
          .map((el) => el.getAttribute("data-match-key"))
          .filter((key): key is string => key?.startsWith("remote:") ?? false),
      );

      expect(remoteMatchKeys).toContain(PRIMARY_DEFAULT_REMOTE_KEY);
      expect(remoteMatchKeys).toContain(PRIMARY_DEEPEST_REMOTE_KEY);
      expect(remoteMatchKeys).toContain(
        "remote:example-secondary-card-frame://Card/SecondaryFocusable",
      );
    });

    test("querying a remote iframe leaf highlights it in the tree", async () => {
      await panel.fill(
        "#xpath-input",
        "//content/messages/message/CardInIframe//Card/DefaultFocusable",
      );

      await panel.waitForFunction(
        (matchKey) => {
          const results = document.getElementById("xpath-results")?.textContent;
          return (
            results === "1 result" &&
            document
              .querySelector(`.tree-node[data-match-key="${matchKey}"]`)
              ?.classList.contains("xpath-match")
          );
        },
        PRIMARY_DEFAULT_REMOTE_KEY,
        { timeout: 10000 },
      );

      await expect(
        panel.locator(`.tree-node[data-match-key="${PRIMARY_DEFAULT_REMOTE_KEY}"]`),
      ).toHaveClass(/xpath-match/);
    });
  });

  test.describe("cross-origin iframe devtools actions", () => {
    test("remote leaf hover and inspect are routed into the owning iframe chain", async () => {
      await panel.waitForSelector(`.tree-node[data-match-key="${PRIMARY_DEFAULT_REMOTE_KEY}"]`, {
        timeout: 10000,
      });

      const primaryFrame = await waitForExampleFrame(app, "primary");
      const nestedFrame = await waitForExampleFrame(app, "nested");
      const levelThreeFrame = await waitForExampleFrame(app, "level-three");

      const primaryLeafLabel = panel.locator(
        `.tree-node[data-match-key="${PRIMARY_DEFAULT_REMOTE_KEY}"] > .tree-node-label`,
      );
      await primaryLeafLabel.hover();
      await expect(primaryFrame.getByRole("button", { name: "Default target" })).toHaveAttribute(
        "style",
        /outline: 2px solid/,
      );

      const nestedLeafLabel = panel.locator(
        `.tree-node[data-match-key="${PRIMARY_NESTED_REMOTE_KEY}"] > .tree-node-label`,
      );
      await nestedLeafLabel.hover();
      await expect(nestedFrame.getByRole("button", { name: /Deep target/ })).toHaveAttribute(
        "style",
        /outline: 2px solid/,
      );

      const deepestLeafLabel = panel.locator(
        `.tree-node[data-match-key="${PRIMARY_DEEPEST_REMOTE_KEY}"] > .tree-node-label`,
      );
      await deepestLeafLabel.hover();
      await expect(levelThreeFrame.getByRole("button", { name: /Deepest target/ })).toHaveAttribute(
        "style",
        /outline: 2px solid/,
      );

      const highlightedTopIframe = await app.$eval(
        'iframe[title="FoQuery iframe card"]',
        (iframe) => iframe.getAttribute("style"),
      );
      expect(highlightedTopIframe ?? "").not.toContain("outline: 2px solid");

      await primaryLeafLabel.click();
      const inspected = await primaryFrame.waitForFunction(() => {
        const value = (window as unknown as Record<string, unknown>)
          .__FOQUERY_DEVTOOLS_INSPECTED__ as { tagName?: string; text?: string } | null;
        return value?.tagName === "BUTTON" ? value : null;
      });

      expect(await inspected.jsonValue()).toMatchObject({
        tagName: "BUTTON",
      });
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

      const statusItems = await panel.$$eval(
        "#diagnostics .diag-section:first-child .diag-item",
        (els) => els.map((el) => el.textContent),
      );
      expect(statusItems).toContain("request: //header/SelectedItem");

      await panel.fill("#xpath-input", "//footer/DefaultItem");
      await panel.click("#diagnostics .diag-request");
      await expect(panel.locator("#xpath-input")).toHaveValue("//header/SelectedItem");
      await expect(panel.locator("#xpath-results")).toHaveText("1 result");
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

  test.describe("check callback via Focus Ready checkbox", () => {
    test("focus waits while unchecked, resolves when checked", async () => {
      // Type //messages query
      await panel.fill("#xpath-input", "//messages");
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "1 result",
        undefined,
        { timeout: 2000 },
      );

      // Uncheck "Focus Ready" in the app (has data-foquery-ignore, won't cancel requests)
      await app.uncheck("#focus-ready-toggle");

      // Press Focus in devtools
      await panel.click("#focus-btn");
      await panel.waitForSelector("#diagnostics .diag-section", { timeout: 2000 });

      // Should be waiting — check callback blocks
      const initialStatus = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(initialStatus).toContain("waiting");

      // Wait a bit to confirm it stays waiting
      await panel.waitForTimeout(500);
      const stillWaiting = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(stillWaiting).toContain("waiting");

      // Check "Focus Ready" back on
      await app.check("#focus-ready-toggle");

      await panel.waitForTimeout(1000);

      // Should resolve to succeeded
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
    });
  });

  test.describe("check callback diagnostics in devtools", () => {
    test("pending check event is not duplicated on tree mutations", async () => {
      // Uncheck Focus Ready
      await app.uncheck("#focus-ready-toggle");

      // Click Progressive in the app to trigger content rebuild
      await app.click("text=Progressive");

      // Wait for content to be removed
      await panel.waitForFunction(
        () => document.getElementById("xpath-results")?.textContent === "",
        undefined,
        { timeout: 3000 },
      );

      // Type //messages/thread/SelectedItem and Focus
      await panel.fill("#xpath-input", "//messages/thread/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 15000 },
      );
      await panel.click("#focus-btn");

      // Wait for events to appear (SelectedItem matched but blocked by check)
      await panel.waitForFunction(
        () => {
          const headings = document.querySelectorAll("#diagnostics .diag-section h3");
          return Array.from(headings).some((h) => h.textContent === "Events");
        },
        undefined,
        { timeout: 15000 },
      );

      // Wait a couple more poll cycles for potential duplicates
      await panel.waitForTimeout(2000);

      // There should be exactly one "matched-pending-checks" entry, not duplicates
      const pendingItems = await panel.$$eval("#diagnostics .diag-item", (els) =>
        els.map((el) => el.textContent).filter((t) => t?.includes("matched-pending-checks")),
      );

      expect(pendingItems.length).toBe(1);
      expect(pendingItems[0]).toContain("SelectedItem");
    });

    test("timed out request shows 'timed out' in devtools, not 'waiting'", async () => {
      // Uncheck Focus Ready so check callback blocks
      await app.uncheck("#focus-ready-toggle");

      // Query for existing element
      await panel.fill("#xpath-input", "//header/SelectedItem");
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 2000 },
      );

      // Focus with a short timeout via app-side requestFocus
      await app.evaluate(() => {
        const root = (window as unknown as Record<string, unknown>).__FOQUERY_ROOT__ as {
          requestFocus: (xpath: string, options: { timeout: number }) => unknown;
        };
        root.requestFocus("//header/SelectedItem", { timeout: 1000 });
      });

      // Wait for the request to time out
      await panel.waitForFunction(
        () => {
          const items = document.querySelectorAll("#diagnostics .diag-section .diag-item");
          return items.length > 0 && items[0].textContent?.includes("timed out");
        },
        undefined,
        { timeout: 5000 },
      );

      const statusText = await panel.textContent("#diagnostics .diag-section .diag-item");
      expect(statusText).toContain("timed out");
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

    test("active element resolves focused cross-origin iframe leaf", async () => {
      await panel.fill("#xpath-input", LEVEL_THREE_FOCUS_QUERY);
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 10000 },
      );
      await panel.click("#focus-btn");

      await panel.waitForFunction(
        () => {
          const text = document.getElementById("active-element")?.textContent ?? "";
          return text.includes("<button>") && text.includes("Deepest");
        },
        undefined,
        { timeout: 10000 },
      );

      const activeText = await panel.textContent("#active-element");
      expect(activeText).toContain("<button>");
      expect(activeText).toContain("Deepest");
      expect(activeText).not.toContain("<iframe");
    });

    test("active element updates when focus moves from deepest iframe to parent iframe leaf", async () => {
      await panel.fill("#xpath-input", LEVEL_THREE_FOCUS_QUERY);
      await panel.waitForFunction(
        () => document.getElementById("focus-btn")?.hasAttribute("disabled") === false,
        undefined,
        { timeout: 10000 },
      );
      await panel.click("#focus-btn");

      await panel.waitForFunction(
        () => {
          const text = document.getElementById("active-element")?.textContent ?? "";
          return text.includes("<button>") && text.includes("Deepest");
        },
        undefined,
        { timeout: 10000 },
      );

      const nestedFrame = await waitForExampleFrame(app, "nested");
      const levelThreeFrame = await waitForExampleFrame(app, "level-three");
      await levelThreeFrame.getByRole("button", { name: /Deepest target/ }).click();
      await expect(nestedFrame.getByRole("button", { name: /Deep target/ })).toBeFocused();

      await panel.waitForFunction(
        () => {
          const text = document.getElementById("active-element")?.textContent ?? "";
          return text.includes("<button>") && text.includes("Deep target");
        },
        undefined,
        { timeout: 10000 },
      );

      const activeText = await panel.textContent("#active-element");
      expect(activeText).toContain("Deep target");
      expect(activeText).not.toContain("Deepest");
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
