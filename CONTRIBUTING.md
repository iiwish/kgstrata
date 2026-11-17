# Contributing

Thanks for looking. kgstrata is still at 0.x, so the API can still change; issues that question the design are as welcome as pull requests.

## Setup

You need Node 22.12 or later and pnpm (the version is in `packageManager` in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm dev             # demo page, http://localhost:5207
pnpm typecheck       # tsc -b
pnpm test            # vitest
pnpm build           # library: dist/ (js + .d.ts)
pnpm check:pack      # checks the build output and the package contents (run build first)
pnpm build:demo      # demo page: demo/dist/
pnpm build:examples  # type-checks and builds examples/* (run build first)
```

Before sending a change, run `pnpm typecheck && pnpm test && pnpm build && pnpm check:pack && pnpm build:examples`. CI runs the same commands on Node 22 and 24.

Demo page query parameters: `?lang=zh|en`, `?layers=2|3|4`, `?stress=3000` (synthetic data), `?hero=table`, `?follow=1`, `?hidden=onto`.

## Layout of the repository

- `src/`: the library, and only the library: everything here is built into `dist/` (`vite.config.ts` for the js, `tsconfig.build.json` for the `.d.ts`). The engine does not depend on React. Four entry points: `index.ts` (core), `path/index.ts` (path replay), `diff/index.ts` (version comparison), `headless.ts` (no rendering).
- `src/react/`: React wrapper and panels. Three entry points: `index.ts`, `path.tsx`, `diff.tsx`; plus the optional `styles.css`.
- `demo/`: the demo page (React), with its own `index.html` and `vite.config.ts`. It imports the library by package name (`kgstrata`, `kgstrata/react`…) like any user would; the config's aliases (and `paths` in `tsconfig.json`) point those names at `src/`. Not part of the package.
- `examples/`: small standalone apps, pnpm workspace packages linked to the root's `dist/`.
- `docs/`: documentation. English pages with a `*.zh-CN.md` counterpart. Read `docs/design.md` before changing how things look.
- `tests/`: tests. Library tests use the fixed data in `tests/fixtures/`, not the demo data; `tests/data.test.ts` covers the demo data.
- `scripts/check-pack.mjs`: checks on the built package.
- `.github/workflows/`: `ci.yml` runs the checks below; `release.yml` publishes to npm when a `v*` tag is pushed.

## Module boundaries

Someone who only wants the 3D view should not have to ship kgdiff and its WebAssembly. Someone who only needs the layout should not have to ship three.js. The import graph enforces this:

```
kgstrata/headless          validate, normalize, layout, stage, bridges, locale, theme, types
  ▲                        no three, no kgdiff, no react
  │
kgstrata                   Strata, renderer, plugin contract   (+ three)
  ▲
  ├── kgstrata/path        pathPlugin                          no kgdiff
  ├── kgstrata/diff        diffPlugin, kgdiff adapter          the only user of @kgdiff/*
  └── kgstrata/react       StrataCanvas, hooks, panels         (+ react), no kgdiff
        ├── kgstrata/react/path   PathList                     (+ kgstrata/path), no kgdiff
        └── kgstrata/react/diff   DiffPanel                    (+ kgstrata/diff)
```

| Entry (source file) | three | react | kgdiff | path code | diff code |
|---|---|---|---|---|---|
| `kgstrata/headless` (`headless.ts`) | no | no | no | no | no |
| `kgstrata` (`index.ts`) | yes | no | no | no | no |
| `kgstrata/path` (`path/index.ts`) | yes | no | no | yes | no |
| `kgstrata/diff` (`diff/index.ts`) | yes | no | yes | no | yes |
| `kgstrata/react` (`react/index.ts`) | yes | yes | no | no | no |
| `kgstrata/react/path` (`react/path.tsx`) | yes | yes | no | yes | no |
| `kgstrata/react/diff` (`react/diff.tsx`) | yes | yes | via `../diff` | no | yes |

Each entry may import the ones above it in the tree. Rules:

- **Only `src/diff/` may import `@kgdiff/*`.** Not the core, not path replay, not headless, not even with `import type` (type imports pull declarations into the `.d.ts` closure too).
- **The import closure of `headless.ts` must not contain `three`** and must not touch `renderer/`.
- The core entry does not import `path/` or `diff/`. Plugins talk to the core only through `StrataPlugin` / `StrataContext`.
- **The four core entries must not import `react`.** `react/index.ts` and `react/path.tsx` must not reach kgdiff; `react/diff.tsx` gets it only through `../diff`.

`tests/modules.test.ts` walks the source imports and enforces these rules; `pnpm check:pack` checks them again on the build output (including shared chunks). A new entry point needs entries in both places, in `vite.config.ts`, in `package.json` `exports`, in `scripts/pack-types/check.ts`, and in the alias table in `demo/vite.config.ts` plus `paths` in `tsconfig.json`.

## Dependencies

- `d3-force` is a runtime dependency.
- `three` is a peer dependency; `@kgdiff/*`, `react`, `react-dom` and `@types/three` are optional peers. They are also dev dependencies for development.
- The library build (`vite.config.ts`) treats all of them as external.

## Adding a language

1. In `src/locale.ts`, add the code to the `Locale` union.
2. Add a table typed `Record<MessageKey, string>` next to `ZH_CN`, translating every key of the English table. The compiler rejects a table with a missing key. Keep every `{placeholder}`.
3. Register it in `MESSAGES`.
4. Extend `tests/locale.test.ts` (all keys present, placeholders preserved, codes unchanged).
5. Version comparison descriptions are written by kgdiff, whose `Locale` is `'en' | 'zh-CN'` today. A new language there needs a change in [kgdiff](https://github.com/iiwish/kgdiff) first.
6. Mention the language in `docs/theming-and-i18n.md` (and its Chinese counterpart) and in `CHANGELOG.md`.

## Running the examples

The examples use the built library, so build first:

```sh
pnpm install
pnpm build
pnpm build:examples          # all of them: tsc --noEmit + vite build
cd examples/react && pnpm dev   # one of them, with a dev server
```

When you change a public API, update the examples and the docs in the same change. The plugin example (`examples/plugin/src/highlight-type.ts`) is also quoted in full in `docs/plugins.md` and `docs/plugins.zh-CN.md`; keep the three in sync.

## Documentation

- Every page in `docs/` exists in English (`name.md`) and Simplified Chinese (`name.zh-CN.md`). Change both.
- Code samples import from package names (`kgstrata`, `kgstrata/react`, …), never from `src/`.
- Option names, events, error codes and issue codes in the docs must exist in the source. Check them when you rename something.
- Be concrete and plain. State limits plainly.

## Code style

Relative imports inside `src/` carry the `.js` extension (`import { resolve } from './resolve.js'`, `from '../diff/index.js'`). The `.d.ts` files keep these paths as written, and TypeScript projects using `"module": "NodeNext"` reject extensionless ones. `tests/modules.test.ts` and `pnpm check:pack` both check this.

Never index a plain object with a string that comes from the data (ids, types, layer or grouping ids): `constructor` or `__proto__` would read the prototype. Use a `Map`, an `Object.create(null)` record, or `Object.hasOwn`.

Source comments are in Simplified Chinese. Comments explain why, not what the code does.

## Releasing

1. Move the entries under `## [Unreleased]` in `CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section and update the links at the bottom.
2. Set `version` in `package.json` to the same `x.y.z`, and commit.
3. Push a tag `vx.y.z`. `.github/workflows/release.yml` checks that the tag matches `version`, runs the checks and publishes to npm with provenance. It needs an `NPM_TOKEN` secret in the repository.

`publishConfig.registry` pins publishing to the public npm registry, so a mirror configured in your global `.npmrc` does not matter.
