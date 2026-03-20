# foquery

Core library for building and querying a parallel XML tree. Framework-agnostic — use `foquery-react` or `foquery-dom` for framework bindings.

## Concepts

- **RootNode** — creates the XML document and root element. Provides `subscribe`, `notify`, `query`, and `requestFocus`.
- **ParentNode** — named container in the tree. Can have `focus` (string xpath or function), `arbiter` (resolves multiple candidates), and `query` (evaluates xpath relative to this parent).
- **LeafNode** — focusable endpoint. Holds a `WeakRef<HTMLElement>` and tracks `lastFocused` timestamps via `focusin` events.
- **FoQueryRequest** — XPath-based focus request with progressive matching, diagnostics, timeout, and single-active-request enforcement.

## API

```ts
import { FoQueryRootNode, FoQueryParentNode, FoQueryLeafNode, FoQueryRequest } from "foquery";
import type { Types } from "foquery";

// Create tree
const rootNode = new FoQueryRootNode("Root", { devtools: true });
const header = new FoQueryParentNode("header", rootNode.root);
rootNode.appendParent(header);

const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
header.appendLeaf(leaf, document.getElementById("btn")!);

// Query
rootNode.root.query("//header/SelectedItem"); // Types.XmlElement[]

// Focus
rootNode.root.requestFocus("//header/SelectedItem", { timeout: 5000 });

// Parent-bound query and focus
header.node.query("./SelectedItem");
header.node.requestFocus("./SelectedItem");
```

## Types

All type interfaces live in `types.ts` with no prefix, imported via `import * as Types from "./types"`:

- `Types.RootNode`, `Types.ParentNode`, `Types.LeafNode`, `Types.XmlElement`
- `Types.Request`, `Types.RequestStatus`, `Types.RequestDiagnostics`, `Types.ProgressiveMatch`

Const values live in `consts.ts`:

- `RequestStatus.Waiting`, `.Succeeded`, `.Canceled`, `.TimedOut`, `.NoCandidates`

## Focus request features

- **Progressive matching** — when full xpath doesn't match, tries simplified queries (predicates stripped). Records partial matches with timestamps.
- **Diagnostics** — `request.diagnostics` exposes `matchedElements`, `candidates`, `winner`, and `progressiveMatches` with timestamps and degradation flags.
- **lastFocused sorting** — candidates sorted by most-recently-focused before picking a winner or passing to arbiter.
- **Arbiter** — parent-level and root-level functions to resolve multiple candidates.
- **Single active request** — creating a new `requestFocus` cancels any pending previous one globally.
- **Timeout** — resolves with `TimedOut` if the full query doesn't match within the specified duration.

## XPath utilities

```ts
import { splitXPathExpressions, generateXPathSimplifications } from "foquery";

splitXPathExpressions("//a | //b[@x]"); // ["//a", "//b[@x]"]
generateXPathSimplifications("//a[@x]/b[@y]"); // [["//a[@x]/b[@y]", "//a[@x]/b", "//a/b"]]
```
