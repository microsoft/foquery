# foquery-example

React example app demonstrating FoQuery features. Uses `foquery-react` with React 19 in StrictMode.

## Run

```sh
npm run dev
```

Opens at `http://127.0.0.1:5173`.

The dev command starts a fixed set of servers for the cross-origin iframe demo:

- Parent app: `http://127.0.0.1:5173`
- Primary iframe: `http://127.0.0.1:5174`
- Secondary iframe: `http://127.0.0.1:5175`
- Nested iframe: `http://127.0.0.1:5176`
- Level-3 iframe: `http://127.0.0.1:5177`

If any of these ports are already in use, the dev command exits with a clear error instead of falling back to a different port.

## Features

- **Layout with regions** — header, sidebar, content (with nested messages/thread/compose/details), footer
- **Dynamic panels** — add/remove panels at runtime
- **Progressive loading demo** — click "Progressive" or "Progressive IFrame" in the sidebar to watch content build step-by-step with `requestFocus` diagnostics
- **Iframe demo** — focus FoQuery trees running in sibling iframes and nested iframe levels
- **DevTools integration** — in dev mode, the tree is exposed as `window.__FOQUERY_ROOT__`; open the FoQuery DevTools panel to inspect

## Progressive demo

The "Progressive" button demonstrates progressive focus matching:

1. Clears the content section
2. Starts `requestFocus("//content/messages/compose/SelectedItem")` with a 15s timeout
3. Mounts content subsections one per second: messages → thread → compose
4. When compose mounts with the target `SelectedItem` leaf, focus resolves
5. Displays a step-by-step diagnostics table with timestamps

The "Progressive IFrame" button uses the same diagnostics display for the deepest iframe target:

1. Starts `requestFocus("//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable")`
2. Mounts the iframe path one level at a time: parent iframe → nested iframe → level-3 iframe
3. Resolves when the level-3 `DeepestFocusable` leaf appears and receives focus

## Iframe demo

The example includes two sibling iframe-backed parent nodes named `CardInIframe` and `SecondaryCardInIframe`. The first iframe also contains nested iframe levels. The parent app can call:

```ts
ctx.requestFocus("//content/messages/message/CardInIframe//Card/DefaultFocusable");
ctx.requestFocus("//content/messages/message/SecondaryCardInIframe//Card/SecondaryFocusable");
ctx.requestFocus(
  "//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/DeepFocusable",
);
ctx.requestFocus(
  "//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable",
);
```

Each iframe is loaded from a different dev-server port, runs its own FoQuery provider, and reports its tree upward with `postMessage`; child-originated focus requests are forwarded to the owning FoQuery app root for routing. The nested demo also includes buttons inside the child frames for moving focus back to the app header, to the ancestor iframe, to the ancestor iframe's sibling iframe, and down into the level-3 iframe.
