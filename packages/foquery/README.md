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
const rootNode = new FoQueryRootNode(window, "Root", { devtools: true });
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

## Focus request features

- **Progressive matching** — when full xpath doesn't match, tries simplified queries (predicates stripped, then path steps removed). Records partial matches with timestamps.
- **Check callbacks** — register validation functions on root, parent, or leaf nodes. A candidate must pass all applicable checks (leaf's own + all ancestor parents + root) before being focused. If checks fail, the request polls at 50ms intervals until a candidate passes or the request is canceled/timed out.
- **Diagnostics** — `request.diagnostics` exposes a unified `events` timeline with all progressive matches, check states, and resolution events. Also exposes `matchedElements`, `candidates`, `winner`, and `cancelReason`.
- **Cancel reasons** — canceled requests include a reason: `superseded` (new request replaced it), `user-click` (mousedown on page), `focus-moved` (focusin on another element), or `api` (explicit `cancel()` call).
- **lastFocused sorting** — candidates sorted by most-recently-focused before picking a winner or passing to arbiter.
- **Arbiter** — parent-level and root-level functions to resolve multiple candidates.
- **Single active request** — creating a new `requestFocus` cancels any pending previous one globally. A page can only have one focused element, so even with multiple roots only one request is active.
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
