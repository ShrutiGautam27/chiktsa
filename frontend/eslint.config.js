// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "public", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser }, ecmaVersion: 2022 },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Radix primitives forward focus/keyboard handling; autoFocus is used deliberately in dialogs.
      "jsx-a11y/no-autofocus": "off",
      // WCAG: horizontally scrollable regions must be reachable by keyboard (axe scrollable-region-focusable).
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["tabpanel", "region"] }],
      // Radix <Switch> renders a native <button>, which a wrapping <label> labels correctly.
      "jsx-a11y/label-has-associated-control": ["error", { controlComponents: ["Switch", "Input", "NativeSelect", "Textarea"], depth: 3 }],
    },
  },
);
