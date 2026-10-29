import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

// Only scheduled jobs and demo reset may touch cross-tenant queries (CLAUDE.md rule 3).
const adminDbImports = {
  group: ["@/server/db/admin", "@/server/db/admin/*", "**/db/admin", "**/db/admin/*"],
  message: "Cross-tenant DB access is only allowed from src/server/jobs. Use tenant-scoped repos.",
};

// The domain layer is pure: no framework, DB, network, logging or env access (SPEC §7.2).
const domainForbiddenImports = {
  paths: [
    "next",
    "react",
    "react-dom",
    "drizzle-orm",
    "pg",
    "@neondatabase/serverless",
    "pino",
  ].map((name) => ({ name, message: "src/server/domain must stay pure (SPEC §7.2)." })),
  patterns: [
    adminDbImports,
    {
      group: [
        "next/*",
        "drizzle-orm/*",
        "@/server/db",
        "@/server/db/*",
        "@/server/services/*",
        "@/server/authz/*",
        "@/lib/env",
        "@/lib/logger",
        "@/app/*",
        "@/components/*",
        "node:*",
        "fs",
        "http",
        "https",
        "net",
        "child_process",
      ],
      message: "src/server/domain must stay pure (SPEC §7.2).",
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "drizzle/**",
    "next-env.d.ts",
  ]),

  // Type-aware rules for TypeScript sources.
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Import hygiene everywhere.
  {
    rules: {
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
          pathGroups: [{ pattern: "@/**", group: "internal" }],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-duplicates": "error",
      "no-console": "error",
    },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/jobs/**", "src/server/db/admin/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [adminDbImports] }],
    },
  },

  {
    files: ["src/server/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", domainForbiddenImports],
      "no-restricted-globals": [
        "error",
        ...["fetch", "XMLHttpRequest", "WebSocket", "process"].map((name) => ({
          name,
          message: "src/server/domain must stay pure (SPEC §7.2).",
        })),
      ],
    },
  },

  // CLI scripts report to the terminal.
  {
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },

  // Plain JS config files are not part of the TS project.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
]);
