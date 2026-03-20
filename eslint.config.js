import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import header from "eslint-plugin-header";
import tseslint from "typescript-eslint";

header.rules.header.meta.schema = false;

// eslint-plugin-header uses context.getSourceCode() which was removed in ESLint 10.
// Shim it via a Proxy so the plugin works with ESLint 10+ (context is frozen).
const originalCreate = header.rules.header.create;
header.rules.header.create = function (context) {
  const wrapped = new Proxy(context, {
    get(target, prop) {
      if (prop === "getSourceCode") return () => target.sourceCode;
      return target[prop];
    },
  });
  return originalCreate(wrapped);
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", ".nx/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      header,
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "header/header": [
        1,
        "block",
        [
          "!",
          " * Copyright (c) Microsoft Corporation. All rights reserved.",
          " * Licensed under the MIT License.",
          " ",
        ],
        1,
      ],
    },
  },
);
