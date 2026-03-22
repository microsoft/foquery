# foquery-dom

Vanilla DOM bindings for FoQuery. Provides an imperative API to build the FoQuery XML tree without any framework, using `appendParent`/`appendLeaf`/`remove`.

## API

### FoQueryDOMRoot

Creates a root node bound to a container element. Derives the `window` reference from the element's `ownerDocument.defaultView`. Uses `MutationObserver` to automatically clean up parent nodes when their DOM elements are removed.

```ts
const domRoot = new FoQueryDOMRoot(container, "Root");
domRoot.query("//main/SelectedItem");
domRoot.requestFocus("//main/SelectedItem");
domRoot.dispose(); // cleanup observer and attributes
```

The container element must be attached to a document with a window (throws if `ownerDocument.defaultView` is null).

### FoQueryDOMParent

Parent node bound to a DOM element. Created via `appendParent` on root or another parent.

```ts
const header = domRoot.appendParent(headerEl, "header");
const nav = header.appendParent(navEl, "nav", "./SelectedItem"); // with string focus

nav.rename("navigation");
nav.remove();
```

### FoQueryDOMLeaf

Leaf node bound to a DOM element. Created via `appendLeaf` on a parent.

```ts
const leaf = header.appendLeaf(btnEl, ["SelectedItem", "DefaultItem"]);

leaf.rename(["FocusedItem"]);
leaf.remove();
```

A custom synchronous focus function can be provided:

```ts
const leaf = header.appendLeaf(btnEl, ["Item"], () => {
  btnEl.scrollIntoView();
  btnEl.focus();
  return true; // signal focus was handled
});
```

## DOM attributes

Nodes are tagged with data attributes for identification:

- `data-foquery-root` on the root container
- `data-foquery-parent` on parent elements
- `data-foquery-leaf` on leaf elements

## Auto-cleanup

When a DOM element with `data-foquery-parent` is removed from the DOM (including nested removals), the `MutationObserver` on the root automatically calls `remove()` on the corresponding parent node.
