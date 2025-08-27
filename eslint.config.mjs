import pluginJs from "@eslint/js";
import eslintPluginImport from "eslint-plugin-import";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
	{
		ignores: [
			"node_modules",
			"__tests__/**/*.test.js",
			// ignore __mocks__ directory
			"*/__mocks__/",
		],
	},
	{ languageOptions: { globals: globals.node } },
	pluginJs.configs.recommended,
	{
		rules: {
			curly: ["error"],
			"no-else-return": ["error", { allowElseIf: false }],
			quotes: ["error", "double", { avoidEscape: true }],
			semi: ["error", "always"],
			"space-before-function-paren": [
				"error",
				{
					anonymous: "always",
					named: "never",
					asyncArrow: "always",
				},
			],
			"arrow-parens": ["error", "always"],
			"no-mixed-spaces-and-tabs": ["error", "smart-tabs"],
			"no-unused-vars": [
				"warn",
				{
					vars: "all",
					args: "after-used",
					ignoreRestSiblings: true,
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
		},
	},
	{
		plugins: {
			// @ts-ignore
			import: eslintPluginImport,
		},
		rules: {
			"import/extensions": [
				"error",
				"ignorePackages",
				{
					js: "never",
					mjs: "never",
				},
			],
			"import/no-unresolved": ["error", { ignore: ["^#"] }],
		},
		settings: {
			"import/resolver": {
				node: {
					extensions: [".js", ".mjs"],
				},
				alias: {
					map: [
						["#lib", "./src/lib"],
						["#config", "./src/config"],
						["#auth", "./src/auth"],
						["#core", "./src/core"],
						["#utils", "./src/utils"],
						["#plugins", "./src/plugins"],
					],
					extensions: [".js", ".mjs", ".ts", ".tsx", ".json"],
				},
			},
		},
	},
	{
		plugins: {
			// @ts-ignore
			prettier: eslintPluginPrettier.plugins.prettier,
		},
		rules: {
			"prettier/prettier": [
				"error",
				{
					plugins: ["@trivago/prettier-plugin-sort-imports"],
					useTabs: true,
					tabWidth: 4,
					semi: true,
					singleQuote: false,
					quoteProps: "as-needed",
					jsxSingleQuote: false,
					trailingComma: "es5",
					bracketSpacing: true,
					arrowParens: "always",
					endOfLine: "lf",
				},
			],
		},
	},
];
