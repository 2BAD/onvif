# TS Lib Starter

A lightweight and customizable starter kit for building TypeScript libraries. It comes with ESM support, flexible configuration options, extensive ESLint rules, and built-in Github Actions integration to automate the build checks, tests, and package publishing process. With TypeScript path aliases and speedy test capabilities, developers can easily create high-quality, performant libraries using this starter kit.

# ✨ Features

- 🔥 **ESM First**
- 📝 **Extensive ESLint Rules**
- :octocat: **Github Actions**
- 🪢 **Typescript Path Aliases**
- 🏎️ **Super Fast Tests**

# Using this template

- Search `ts-lib-starter` and replace it with your custom package name.
- Search `2BAD` and replace it with your name. (be careful not to replace `@2bad/tsconfig` references)

# Package Choices

The packages chosen for this project include some of the most popular and widely used tools for TypeScript development:

- **typescript**: a superset of JavaScript that adds type annotations to improve code quality, readability, and maintainability.
- **eslint**: a tool for identifying and reporting on patterns found in code. It's highly configurable and can be customized according to different coding standards. Comes preconfigured with plugins for linting tests, jsdoc blocks, and TypeScript itself.
- **prettier**: an opinionated code formatter that ensures consistent formatting across the entire codebase.
- **npm-run-all**: a CLI tool that allows you to run multiple npm scripts sequentially or in parallel.
- **tsc-alias**: a TypeScript plugin that provides easy-to-use aliases for import statements without requiring complex configurations in Webpack or other build tools.
- **vitest**: a testing framework that includes functionality for both unit and integration tests.

# NPM Scripts

Here are the npm scripts included in this project:

- **build**: cleans the ./build directory, compiles TypeScript code to JavaScript, and applies aliases.
- **format:check**: checks if TypeScript files are formatted according to Prettier standards.
- **format:fix**: automatically fixes formatting issues using Prettier.
- **lint**: lints TypeScript files with eslint (including tests and jsdoc blocks).
- **lint:fix**: automatically fixes linting errors found by eslint.
- **prepublishOnly**: prepares for publishing by running the build scripts.
- **preversion**: runs clean, lint, test, and build scripts before publishing a new version.
