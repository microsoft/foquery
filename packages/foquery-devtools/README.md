# foquery-devtools

Chrome DevTools extension for inspecting FoQuery trees.

## Features

- **Live tree view** — polls the inspected page every second, renders the FoQuery tree with parent/leaf distinction and lastFocused timestamps
- **XPath query bar** — auto-evaluates as you type, shows valid/invalid indicator, result count, and highlights matching nodes in the tree. Press Enter to trigger Focus.
- **Context-bound queries** — click a parent node to select it, queries evaluate relative to that parent (e.g., `..` from a child to query its parent)
- **Focus button** — calls `requestFocus(xpath)` on the inspected page, shows diagnostics timeline
- **Diagnostics timeline** — unified event log showing progressive matches, check callback states, and resolution with elapsed times and cancel reasons
- **Active request tracking** — shows status of the current request even if triggered by the app (not the devtools)
- **Parent inspector** — click a parent to see its `focus`, `arbiter`, and `lastFocused` properties. Auto-updates on tree refresh. Clears when the selected node is removed.
- **Element interaction** — hover leaves to highlight on page, click to reveal in Elements panel
- **Active element display** — shows the current `document.activeElement` at the bottom

## Setup

1. Build the extension:

   ```sh
   npx nx run foquery-devtools:build
   ```

2. Load in Chrome/Edge:
   - Go to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `packages/foquery-devtools/dist/`

3. Open DevTools on a page with FoQuery — the "FoQuery" panel appears in the tab bar.

## Requirements

The inspected page must create a `FoQueryRootNode` with `devtools: true` (or a custom global name):

```ts
// Core
const rootNode = new FoQueryRootNode(window, "Root", { devtools: true });

// React
<FoQueryProvider window={window} rootName="Root" devtools>

// Exposes window.__FOQUERY_ROOT__
```

## Build

The extension is built with `tsc` + static asset copy (no bundler). Output goes to `dist/` with:

- `manifest.json` — Chrome MV3 manifest
- `devtools.html/js` — creates the panel
- `panel.html/js/css` — panel UI
- `expressions.js` — shared expression generators (imported by panel.js)
- `icon.svg` — panel tab icon
