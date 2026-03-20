# foquery-devtools

Chrome DevTools extension for inspecting FoQuery trees.

## Features

- **Live tree view** — polls the inspected page every second, renders the FoQuery tree with parent/leaf distinction and lastFocused timestamps
- **XPath query bar** — auto-evaluates as you type, shows valid/invalid indicator, result count, and highlights matching nodes in the tree
- **Context-bound queries** — click a parent node to select it, queries evaluate relative to that parent
- **Focus button** — calls `requestFocus(xpath)` on the inspected page, shows diagnostics (matched elements, candidates, winner)
- **Parent inspector** — click a parent to see its `focus`, `arbiter`, and `lastFocused` properties
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
const rootNode = new FoQueryRootNode("Root", { devtools: true });
// Exposes window.__FOQUERY_ROOT__
```

## Build

The extension is built with `tsc` + static asset copy (no bundler). Output goes to `dist/` with:

- `manifest.json` — Chrome MV3 manifest
- `devtools.html/js` — creates the panel
- `panel.html/js/css` — panel UI
- `icon.svg` — panel tab icon
