# foquery-react

React bindings for FoQuery. Provides components and hooks to build the FoQuery XML tree declaratively within a React application.

Compatible with React 17+ and React Concurrent Mode (StrictMode safe).

## API

### FoQueryProvider

Root provider. Creates the `FoQueryRootNode` and provides context to the tree.

```tsx
<FoQueryProvider window={window} rootName="Root">
  {children}
</FoQueryProvider>
```

Props:

- `window` — **required**. The `Window` object to use for document access and event listeners. Enables iframe and testing scenarios.
- `rootName` — XML root element name (default: `"Root"`)
- `devtools` — development-only. When the `"development"` conditional export is active, `true` exposes the root as `window.__FOQUERY_ROOT__` for the FoQuery DevTools panel, or pass a custom global name string. Production builds ignore this prop and do not include devtools runtime code.

### FoQueryParent

Declares a parent node in the FoQuery tree. Nesting `FoQueryParent` components builds the tree hierarchy.

```tsx
<FoQueryParent name="content" focus=".//SelectedItem" arbiter={(candidates) => candidates[0]}>
  {children}
</FoQueryParent>
```

Props:

- `name` — parent node name (becomes the XML element tag)
- `focus` — optional string (relative XPath). When this parent is matched by a focus request, the XPath is evaluated to find focusable leaves underneath.
- `arbiter` — optional function to resolve multiple candidates under this parent's focus query

### useFoQuery

Hook that registers a leaf node. Returns a `RefCallback` to attach to the DOM element.

```tsx
function Leaf() {
  const ref = useFoQuery<HTMLButtonElement>(["SelectedItem", "DefaultItem"]);
  return <button ref={ref}>Click me</button>;
}
```

Parameters:

- `names` — array of leaf name strings (each becomes an XML element)
- `focus` — optional synchronous custom focus function `() => boolean`. Return `true` to signal focus was handled, `false` to fall back to `element.focus()`.

### FoQueryContext

React context providing access to the current parent node, root, and tree manipulation methods. Useful for calling `requestFocus` imperatively.

```tsx
const ctx = useContext(FoQueryContext);
ctx.requestFocus("//main/SelectedItem", { timeout: 5000 });
```

## Concurrent Mode

All components are function components using `useLayoutEffect` for tree mutations (commit phase only). No side effects during render. Safe with `<StrictMode>` and concurrent features.

## Optional iframe API

Iframe support is available from `foquery-react/iframe` so apps that do not import it do not include cross-frame messaging code.

```tsx
import { FoQueryProvider, FoQueryParent, useFoQuery } from "foquery-react";
import { FoQueryIFrameParent, FoQueryFrameProvider } from "foquery-react/iframe";

function ParentApp() {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  return (
    <FoQueryProvider window={window} rootName="Root">
      <FoQueryParent name="message">
        <FoQueryIFrameParent
          name="CardInIframe"
          iframeRef={iframeRef}
          targetOrigin="https://card.example"
        >
          <iframe ref={iframeRef} src="https://card.example/card.html" />
        </FoQueryIFrameParent>
      </FoQueryParent>
    </FoQueryProvider>
  );
}

function FrameLeaf() {
  const ref = useFoQuery<HTMLButtonElement>(["DefaultFocusable"]);
  return <button ref={ref}>Default focus target</button>;
}

function ChildFrameApp() {
  return (
    <FoQueryFrameProvider window={window} rootName="FrameRoot" parentOrigin="https://app.example">
      <FoQueryParent name="Card">
        <FrameLeaf />
      </FoQueryParent>
    </FoQueryFrameProvider>
  );
}
```

The parent can focus into the iframe with `//message/CardInIframe//Card/DefaultFocusable`. Requests made inside the child frame are posted upward to the owning FoQuery app root and routed back down without exposing the parent tree to the child.
