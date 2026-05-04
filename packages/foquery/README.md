# foquery

Core library for building and querying a parallel XML tree. Framework-agnostic — use `foquery-react` or `foquery-dom` for framework bindings.

## Concepts

- **RootNode** — creates the XML document and root element. Requires a `window` reference (no global access). Provides `subscribe`, `notify`, `query`, and `requestFocus`.
- **ParentNode** — named container in the tree. Can have `focus` (string xpath for sub-query resolution) and `arbiter` (resolves multiple candidates).
- **LeafNode** — focusable endpoint. Holds a `WeakRef<HTMLElement>` and tracks `lastFocused` timestamps via `focusin` events. Optional synchronous `focus` function to override default `element.focus()`.
- **FoQueryRequest** — XPath-based focus request with progressive matching, check callback polling, diagnostics, timeout, and single-active-request enforcement.

## API

```ts
import { FoQueryRootNode, FoQueryParentNode, FoQueryLeafNode, FoQueryRequest } from "foquery";
import type { Types } from "foquery";

// Create tree — window is required (no global document/window usage)
const rootNode = new FoQueryRootNode(window, "Root");
const header = new FoQueryParentNode("header", rootNode.root);
rootNode.appendParent(header);

const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
header.appendLeaf(leaf, document.getElementById("btn")!);

// Query
rootNode.query("//header/SelectedItem"); // Types.XmlElement[]

// Focus
rootNode.requestFocus("//header/SelectedItem", { timeout: 5000 });

// Parent-bound query and focus
header.query("./SelectedItem");
header.requestFocus("./SelectedItem");
```

## Optional iframe API

Iframe support lives in `foquery/iframe` and is not imported by the default `foquery` entrypoint.

```ts
import { FoQueryRootNode, FoQueryParentNode, FoQueryLeafNode } from "foquery";
import { FoQueryIFrameParentNode, connectFoQueryChildFrame } from "foquery/iframe";
```

### Parent window

Use `FoQueryIFrameParentNode` when a logical FoQuery parent is backed by an `HTMLIFrameElement`.

```ts
const rootNode = new FoQueryRootNode(window, "Root");
const content = new FoQueryParentNode("content", rootNode.root);
const message = new FoQueryParentNode("message", rootNode.root);
const cardFrame = new FoQueryIFrameParentNode("CardInIframe", rootNode.root, iframe, {
  targetOrigin: "https://card.example",
});

rootNode.appendParent(content);
content.appendParent(message);
message.appendParent(cardFrame);

rootNode.requestFocus("//content/message/CardInIframe//Card/DefaultFocusable");
```

The iframe node receives serialized child tree snapshots through `postMessage` and imports them under its XML element. Queries can return local `Types.XmlElement` objects and remote iframe-backed XML elements in the same result array.

### Child iframe

Inside the iframe, create a normal FoQuery root and connect it to its parent:

```ts
const childRoot = new FoQueryRootNode(window, "FrameRoot");
connectFoQueryChildFrame(childRoot, { parentOrigin: "https://app.example" });

const card = new FoQueryParentNode("Card", childRoot.root);
childRoot.appendParent(card);
card.appendLeaf(new FoQueryLeafNode(["DefaultFocusable"], childRoot.root), button);
```

The child posts its current tree upward whenever it changes. Child-originated `requestFocus()` calls are forwarded upward to the owning FoQuery app root so it can preserve single-active-request behavior within that root window and its iframe subtree while routing through nested iframe boundaries. Children never receive the parent tree.

When a child frame requests focus, absolute paths that match the child snapshot are scoped through the source iframe:

```ts
// Called inside CardInIframe. The child snapshot contains Card/DefaultFocusable.
childRoot.requestFocus("//Card/DefaultFocusable");

// Coordinated by the owning FoQuery app root as:
rootNode.requestFocus("//content/message/CardInIframe//Card/DefaultFocusable");
```

Absolute paths outside the child snapshot are forwarded unchanged, which lets a child request focus in the parent app or a sibling iframe without seeing the parent tree:

```ts
// Called inside CardInIframe. `header` and `SecondaryCardInIframe` are not in
// CardInIframe's child snapshot, so these paths are treated as root-level paths.
childRoot.requestFocus("//header/SelectedItem");
childRoot.requestFocus("//content/message/SecondaryCardInIframe//Card/DefaultFocusable");
```

### Message protocol

Iframe messages use a versioned FoQuery namespace and are ignored when the namespace, version, source window, or configured origin does not match. The protocol includes `child-ready`, `tree-state`, `request-focus`, `delegate-focus`, and `focus-result` messages.

## Focus request features

- **Progressive matching** — when full xpath doesn't match, tries simplified queries (predicates stripped, then path steps removed). Records partial matches with timestamps.
- **Check callbacks** — register validation functions on root, parent, or leaf nodes. A candidate must pass all applicable checks (leaf's own + all ancestor parents + root) before being focused. If checks fail, the request polls at 50ms intervals until a candidate passes or the request is canceled/timed out.
- **Diagnostics** — `request.diagnostics` exposes a unified `events` timeline with all progressive matches, check states, and resolution events. Also exposes `matchedElements`, `candidates`, `winner`, and `cancelReason`.
- **Cancel reasons** — canceled requests include a reason: `superseded` (new request replaced it), `user-click` (mousedown on page), `focus-moved` (focusin on another element), or `api` (explicit `cancel()` call).
- **lastFocused sorting** — candidates sorted by most-recently-focused before picking a winner or passing to arbiter.
- **Arbiter** — parent-level and root-level functions to resolve multiple candidates.
- **Single active request** — public `requestFocus` calls share one app-wide transaction. A new request supersedes the previous one; if the previous request has already delegated final focus into an iframe, the next request waits briefly for the iframe result so the previous transaction can resolve success or cancel cleanly before the next starts.
- **Timeout** — resolves with `TimedOut` if the full query doesn't match within the specified duration.
- **FocusOptions** — pass `{ focusOptions: { focusVisible: true } }` to control how `element.focus()` is called.
- **Cancel on interaction** — requests are automatically canceled when the user clicks or moves focus manually. Elements with `data-foquery-ignore` attribute are excluded from this behavior.

## Check callbacks

Register validation functions that must return `true` before a candidate can be focused:

```ts
// Root-level check — applies to all leaves
rootNode.registerCheck((element) => !element.closest("[aria-hidden=true]"));

// Parent-level check — applies to all leaves under this parent
parent.registerCheck((element) => element.offsetParent !== null);

// Leaf-level check — applies only to this leaf
leaf.registerCheck((element) => !element.disabled);
```

All applicable checks (leaf + ancestor parents + root) must pass. If any fails, the request polls until checks pass or the request is canceled/timed out. Returns an unregister function:

```ts
const unregister = parent.registerCheck(myCheck);
unregister(); // removes the check
```

## Types

All type interfaces live in `types.ts`, imported via `import type { Types } from "foquery"`:

- `Types.RootNode`, `Types.ParentNode`, `Types.LeafNode`, `Types.XmlElement`
- `Types.Request`, `Types.RequestStatus`, `Types.RequestDiagnostics`, `Types.DiagnosticEvent`
- `Types.CheckCallback`, `Types.CancelReason`, `Types.RequestFocusOptions`

Const values live in `consts.ts`:

- `RequestStatus.Waiting`, `.Succeeded`, `.Canceled`, `.TimedOut`, `.NoCandidates`

## XPath utilities

```ts
import { splitXPathExpressions, generateXPathSimplifications } from "foquery";

splitXPathExpressions("//a | //b[@x]"); // ["//a", "//b[@x]"]
generateXPathSimplifications("//a[@x]/b[@y]"); // [["//a[@x]/b[@y]", "//a[@x]/b", "//a/b"]]
```
