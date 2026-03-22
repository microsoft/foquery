import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      foquery: path.resolve(__dirname, "../foquery/src/index.ts"),
      "foquery-react": path.resolve(__dirname, "../foquery-react/src/index.ts"),
    },
  },
});
