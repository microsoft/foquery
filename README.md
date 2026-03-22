# FoQuery

A library for building and querying a parallel XML tree that mirrors a UI component hierarchy. Enables XPath-based element discovery and programmatic focus management.

## Packages

| Package                                          | Description                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| [`foquery`](packages/foquery/)                   | Core library — XML tree, node classes, XPath querying, focus requests |
| [`foquery-react`](packages/foquery-react/)       | React bindings — provider, parent component, leaf hook                |
| [`foquery-dom`](packages/foquery-dom/)           | Vanilla DOM bindings — imperative API with MutationObserver cleanup   |
| [`foquery-devtools`](packages/foquery-devtools/) | Chrome DevTools extension for inspecting FoQuery trees                |
| [`example`](packages/example/)                   | React example app demonstrating all features                          |

## How it works

FoQuery maintains an XML document that mirrors your UI's logical focus structure. Parent nodes define regions, leaf nodes define focusable elements. The XML tree can be queried with XPath to find and focus elements programmatically.

```
Root
├── header
│   ├── ◆ DefaultItem (Home button)
│   └── ◆ SelectedItem (Search button)
├── sidebar
│   └── ◆ SelectedItem (Inbox)
├── content [focus=".//SelectedItem"]
│   ├── messages [focus="./thread/SelectedItem"]
│   │   ├── thread
│   │   │   └── ◆ SelectedItem (Message 1)
│   │   └── compose
│   │       └── ◆ SelectedItem (Send)
│   └── details
│       └── ◆ SelectedItem (Edit)
└── footer
    └── ◆ DefaultItem (Action)
```

Query with XPath:

```ts
root.query("//content//SelectedItem"); // all SelectedItems under content
root.query("//compose/SelectedItem"); // Send button
root.requestFocus("//content/messages/compose/SelectedItem"); // focus the Send button
```

## Quick start

### React

```tsx
import { FoQueryProvider, FoQueryParent, useFoQuery } from "foquery-react";

function Leaf({ names, children }) {
  const ref = useFoQuery(names);
  return <button ref={ref}>{children}</button>;
}

function App() {
  return (
    <FoQueryProvider window={window} rootName="Root" devtools>
      <FoQueryParent name="main" focus="./SelectedItem">
        <Leaf names={["SelectedItem"]}>Click me</Leaf>
        <Leaf names={["DefaultItem"]}>Other</Leaf>
      </FoQueryParent>
    </FoQueryProvider>
  );
}
```

### Vanilla DOM

```ts
import { FoQueryDOMRoot } from "foquery-dom";

const domRoot = new FoQueryDOMRoot(container);
const main = domRoot.appendParent(mainEl, "main");
const leaf = main.appendLeaf(btnEl, ["SelectedItem"]);

domRoot.requestFocus("//main/SelectedItem");
```

### Core (no framework)

```ts
import { FoQueryRootNode, FoQueryParentNode, FoQueryLeafNode } from "foquery";

const rootNode = new FoQueryRootNode(window, "Root", { devtools: true });
const main = new FoQueryParentNode("main", rootNode.root, { focus: "./SelectedItem" });
rootNode.appendParent(main);

const leaf = new FoQueryLeafNode(["SelectedItem"], rootNode.root);
main.appendLeaf(leaf, document.getElementById("btn")!);

rootNode.requestFocus("//main/SelectedItem");
```

## Development

```sh
npm install
npm run dev          # start example app
npm run all          # format → lint → typecheck → build → test
npm run test         # run all tests
npm run release      # interactive release (bump version, publish to npm)
npm run graph        # Nx dependency graph
```

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
