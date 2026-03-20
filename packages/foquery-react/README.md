# foquery-react

React bindings for FoQuery. Provides components and hooks to build the FoQuery XML tree declaratively within a React application.

Compatible with React 17+ and React Concurrent Mode (StrictMode safe).

## API

### FoQueryProvider

Root provider. Creates the `FoQueryRootNode` and provides context to the tree.

```tsx
<FoQueryProvider rootName="Root" devtools>
  {children}
</FoQueryProvider>
```

Props:

- `rootName` — XML root element name (default: `"Root"`)
- `devtools` — expose root as `window.__FOQUERY_ROOT__` for devtools (default: `false`, or pass a custom global name string)

### FoQueryParent

Declares a parent node in the FoQuery tree. Nesting `FoQueryParent` components builds the tree hierarchy.

```tsx
<FoQueryParent name="content" focus=".//SelectedItem" arbiter={(candidates) => candidates[0]}>
  {children}
</FoQueryParent>
```

Props:

- `name` — parent node name (becomes the XML element tag)
- `focus` — optional. String (relative xpath) or function `() => Promise<boolean>` for focus resolution
- `arbiter` — optional. Resolves multiple candidates under this parent's string focus

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
- `focus` — optional custom focus function `() => Promise<boolean>`

### FoQueryContext

React context providing access to the current parent node, root, and tree manipulation methods. Useful for calling `requestFocus` imperatively.

```tsx
const ctx = useContext(FoQueryContext);
ctx.root.requestFocus("//main/SelectedItem", { timeout: 5000 });
```

## Concurrent Mode

All components are function components using `useLayoutEffect` for tree mutations (commit phase only). No side effects during render. Safe with `<StrictMode>` and concurrent features.
