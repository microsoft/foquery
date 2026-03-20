# foquery-example

React example app demonstrating FoQuery features. Uses `foquery-react` with React 19 in StrictMode.

## Run

```sh
npm run dev
```

Opens at `http://localhost:5173`.

## Features

- **Layout with regions** — header, sidebar, content (with nested messages/thread/compose/details), footer
- **Dynamic panels** — add/remove panels at runtime
- **Progressive loading demo** — click "Progressive" in the sidebar to watch content build step-by-step with `requestFocus` diagnostics
- **DevTools integration** — tree exposed as `window.__FOQUERY_ROOT__`, open the FoQuery DevTools panel to inspect

## Progressive demo

The "Progressive" button demonstrates progressive focus matching:

1. Clears the content section
2. Starts `requestFocus("//content/messages/compose/SelectedItem")` with a 15s timeout
3. Mounts content subsections one per second: messages → thread → compose
4. When compose mounts with the target `SelectedItem` leaf, focus resolves
5. Displays a step-by-step diagnostics table with timestamps
