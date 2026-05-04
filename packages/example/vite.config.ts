import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import path from "path";

export default defineConfig(({ mode }) => {
  const development = mode !== "production";
  const foqueryEntry = development
    ? "../foquery/src/index.development.ts"
    : "../foquery/src/index.ts";
  const foqueryReactEntry = development
    ? "../foquery-react/src/index.development.ts"
    : "../foquery-react/src/index.ts";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "foquery/iframe": path.resolve(
          __dirname,
          development ? "../foquery/src/iframe.development.ts" : "../foquery/src/iframe.ts",
        ),
        "foquery/devtools": path.resolve(__dirname, "../foquery/src/devtools.ts"),
        foquery: path.resolve(__dirname, foqueryEntry),
        "foquery-react/iframe": path.resolve(
          __dirname,
          development
            ? "../foquery-react/src/iframe.development.tsx"
            : "../foquery-react/src/iframe.tsx",
        ),
        "foquery-react": path.resolve(__dirname, foqueryReactEntry),
      },
    },
  };
});
